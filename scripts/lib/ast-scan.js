/**
 * 经典脚本的 AST 作用域分析工具（esprima 版）。
 *
 * 供 `scripts/check-app-hoisting.js`（跨 script 函数提升校验）与
 * `scripts/check-app-reorg.js`（按职责重排的加载期顺序等价校验）共用。
 *
 * ⚠️ 为什么必须用真 parser + 作用域分析，而不是手写词法扫描：
 *    手写扫描在正则字面量 / 模板字符串插值处会失同步（实测报出 `data` / `quality` / `animate`
 *    假阳性）；不做作用域会把形参（`function f(animate)`）误判成全局顶层函数。
 */
'use strict';

/** 同步高阶函数：传给它们的回调会**当场**执行，所以要下钻其函数体 */
const SYNC_HOF = new Set([
  'forEach', 'map', 'filter', 'reduce', 'reduceRight', 'some', 'every', 'find', 'findIndex',
  'sort', 'flatMap', 'keys', 'values', 'entries', 'from', 'apply', 'call', 'then', 'catch', 'finally',
]);

/**
 * 动态 import() esprima 4 不支持，替换成占位调用再解析。
 *
 * ⚠️ **替换必须等长**：任何按 `range` 偏移去切原文的调用方（如
 * `scripts/reorg/plan-and-apply.js`）都会被不等长的替换搞错位 —— 实测表现是切出来的块
 * 里注释丢了 `//`、函数名多一个字符。所以把 `import(` 换成同长度的 `______(`。
 * （只影响列号，不影响行号；也不影响标识符分析 —— 占位符不是合法标识符引用。）
 */
function makeParser(esprima) {
  const sanitize = (s) => s.replace(/\bimport\s*\(/g, (m) => '_'.repeat(m.length - 1) + '(');
  return (src, opts) => esprima.parseScript(sanitize(src), opts || {});
}

function eachChild(node, fn) {
  for (const k of Object.keys(node)) {
    if (k === 'type' || k === 'loc' || k === 'range') continue;
    const v = node[k];
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) if (v[i] && typeof v[i].type === 'string') fn(v[i], node, k, i);
    } else if (v && typeof v.type === 'string') fn(v, node, k, null);
  }
}

function isBinding(node, parent, key) {
  if (!parent) return false;
  switch (parent.type) {
    case 'VariableDeclarator': return key === 'id';
    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'ArrowFunctionExpression': return key === 'id' || key === 'params';
    case 'CatchClause': return key === 'param';
    case 'ClassDeclaration':
    case 'ClassExpression': return key === 'id';
    case 'Property': return key === 'key' && !parent.computed && !parent.shorthand;
    case 'MemberExpression': return key === 'property' && !parent.computed;
    case 'MethodDefinition': return key === 'key' && !parent.computed;
    case 'LabeledStatement': return key === 'label';
    case 'BreakStatement':
    case 'ContinueStatement': return key === 'label';
    default: return false;
  }
}

const isFnNode = (n) =>
  n && (n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression' || n.type === 'FunctionDeclaration');

/** 这个函数节点是不是「立刻执行」（IIFE / 同步 HOF 的回调） */
function isImmediatelyInvoked(fnNode, parent, key) {
  if (!parent) return false;
  if (parent.type === 'CallExpression' || parent.type === 'NewExpression') {
    if (key === 'callee') return true;                                  // (function(){})()
    if (key === 'arguments') {                                          // arr.forEach(function(){})
      let c = parent.callee;
      while (c && c.type === 'MemberExpression') {
        if (c.property && c.property.name && SYNC_HOF.has(c.property.name)) return true;
        c = c.object;
      }
      if (c && c.type === 'Identifier' && SYNC_HOF.has(c.name)) return true;
    }
  }
  if (parent.type === 'Property' && parent.value === fnNode) return false;  // { onClick: fn } 不当场跑
  return false;
}

function addPatternNames(pat, set) {
  if (!pat) return;
  if (pat.type === 'Identifier') set.add(pat.name);
  else if (pat.type === 'ObjectPattern') for (const p of pat.properties) addPatternNames(p.type === 'RestElement' ? p.argument : p.value, set);
  else if (pat.type === 'ArrayPattern') for (const el of pat.elements) addPatternNames(el, set);
  else if (pat.type === 'AssignmentPattern') addPatternNames(pat.left, set);
  else if (pat.type === 'RestElement') addPatternNames(pat.argument, set);
}

/** 当前函数作用域内的 var / function 声明（不下钻嵌套函数） */
function collectVarFns(node, set) {
  (function w(n) {
    if (!n || typeof n.type !== 'string') return;
    if (isFnNode(n)) { if (n.id) set.add(n.id.name); return; }
    if (n.type === 'ClassDeclaration' || n.type === 'ClassExpression') { if (n.id) set.add(n.id.name); return; }
    if (n.type === 'VariableDeclaration' && n.kind === 'var') for (const d of n.declarations) addPatternNames(d.id, set);
    eachChild(n, w);
  })(node);
}

function collectBlockBindings(blockBody) {
  const s = new Set();
  for (const st of blockBody) {
    if (!st) continue;
    if (st.type === 'VariableDeclaration' && st.kind !== 'var') for (const d of st.declarations) addPatternNames(d.id, s);
    else if (st.type === 'FunctionDeclaration' && st.id) s.add(st.id.name);
    else if (st.type === 'ClassDeclaration' && st.id) s.add(st.id.name);
  }
  return s;
}

/**
 * 作用域感知扫描。把「非局部」的标识符交给 add(name, isCallPosition)。
 * @param {object} opts { fnNode } —— 以某个函数自身为入口（要先压形参 + var/function 帧）
 */
function scanScoped(root, calledOnly, add, opts) {
  const frames = [];
  const isLocal = (name) => { for (let i = frames.length - 1; i >= 0; i--) if (frames[i].has(name)) return true; return false; };

  function walk(n, parent, key) {
    if (!n || typeof n.type !== 'string') return;

    if (isFnNode(n)) {
      if (!isImmediatelyInvoked(n, parent, key)) {
        if (n.type === 'FunctionDeclaration' && n.id && !isLocal(n.id.name)) add(n.id.name, false);
        return;
      }
      const s = new Set();
      for (const p of n.params) addPatternNames(p, s);
      if (n.body && n.body.type === 'BlockStatement') collectVarFns(n.body, s);
      frames.push(s);
      for (const p of n.params) walk(p, n, 'params');
      walk(n.body, n, 'body');
      frames.pop();
      return;
    }
    if (n.type === 'BlockStatement' || n.type === 'Program') {
      const s = n.type === 'BlockStatement' ? collectBlockBindings(n.body) : new Set();
      frames.push(s);
      for (const st of n.body) walk(st, n, 'body');
      frames.pop();
      return;
    }
    if (n.type === 'CatchClause') {
      const s = new Set();
      addPatternNames(n.param, s);
      frames.push(s);
      walk(n.body, n, 'body');
      frames.pop();
      return;
    }
    if (n.type === 'ForStatement' || n.type === 'ForInStatement' || n.type === 'ForOfStatement') {
      const s = new Set();
      const decl = n.init && n.init.type === 'VariableDeclaration' ? n.init
        : (n.left && n.left.type === 'VariableDeclaration' ? n.left : null);
      if (decl && decl.kind !== 'var') for (const d of decl.declarations) addPatternNames(d.id, s);
      frames.push(s);
      eachChild(n, function (c, p, k) { walk(c, p, k); });
      frames.pop();
      return;
    }
    if (n.type === 'Identifier') {
      if (!isBinding(n, parent, key) && !isLocal(n.name)) add(n.name, false);
      return;
    }
    if (n.type === 'CallExpression' || n.type === 'NewExpression') {
      let c = n.callee;
      while (c && c.type === 'MemberExpression') {
        if (c.computed && c.property) walk(c.property, c, 'property');
        c = c.object;
      }
      if (c && c.type === 'Identifier') { if (!isLocal(c.name)) add(c.name, true); }
      else if (c) walk(c, n, 'callee');
      for (const a of n.arguments) walk(a, n, 'arguments');
      return;
    }
    eachChild(n, function (c, p, k) { walk(c, p, k); });
  }

  if (opts && opts.fnNode) {
    const fn = opts.fnNode;
    const s = new Set();
    for (const p of fn.params) addPatternNames(p, s);
    if (fn.body && fn.body.type === 'BlockStatement') collectVarFns(fn.body, s);
    frames.push(s);
    for (const p of fn.params) walk(p, fn, 'params');
    walk(fn.body, fn, 'body');
    frames.pop();
    return;
  }
  walk(root, null, null);
}

/** 节点里引用到的所有「非局部」标识符 */
function refsOf(node) {
  const out = new Set();
  const isFn = isFnNode(node);
  scanScoped(isFn ? null : node, false, (name) => out.add(name), isFn ? { fnNode: node } : null);
  return out;
}

/** 节点里**处于调用位置**的「非局部」标识符 */
function calledRefsOf(node) {
  const out = new Set();
  const isFn = isFnNode(node);
  scanScoped(isFn ? null : node, true, (name, isCall) => { if (isCall) out.add(name); }, isFn ? { fnNode: node } : null);
  return out;
}

/** 节点是否含「调用/新建/await/yield/自增自减/赋值」这类有副作用的子表达式（不含自身顶层） */
function hasSideEffect(node) {
  let found = false;
  (function w(n, isRoot) {
    if (!n || typeof n.type !== 'string' || found) return;
    if (!isRoot) {
      if (n.type === 'CallExpression' || n.type === 'NewExpression' ||
          n.type === 'AwaitExpression' || n.type === 'YieldExpression' ||
          n.type === 'UpdateExpression' || n.type === 'AssignmentExpression' ||
          n.type === 'TaggedTemplateExpression') { found = true; return; }
    }
    if (isFnNode(n) && !isRoot) return;   // 函数体不在声明期执行
    eachChild(n, (c) => w(c, false));
  })(node, true);
  return found;
}

/** 从一个顶层节点取出它「初始化」的全局名字 */
function declaredNames(node) {
  const out = [];
  if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') {
    if (node.id) out.push(node.id.name);
  } else if (node.type === 'VariableDeclaration') {
    for (const d of node.declarations) {
      const s = new Set();
      addPatternNames(d.id, s);
      for (const n of s) out.push(n);
    }
  }
  return out;
}

module.exports = {
  SYNC_HOF, makeParser, eachChild, isBinding, isFnNode, isImmediatelyInvoked,
  addPatternNames, collectVarFns, collectBlockBindings, scanScoped,
  refsOf, calledRefsOf, hasSideEffect, declaredNames,
};
