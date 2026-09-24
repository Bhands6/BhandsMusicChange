/**
 * 校验 `public/js/app/00-prelude.js` 的**完整性**：跨 script 函数提升依赖有没有漏。
 *
 * ── 为什么需要这个脚本 ────────────────────────────────────────────────
 * 原 `public/js/main.js` 是**单个 <script>**，顶层 `function` 声明会被提升到整个文件顶部，
 * 所以第 85 行的顶层语句可以调用第 2 万行才定义的函数。2026-09-24 把它拆成
 * `public/js/app/*.js` 多个 <script> 之后，**提升只在各自文件内生效**：
 * 前面的文件看不到后面文件里的函数声明 → `ReferenceError: xxx is not defined`，
 * 而且**该 script 剩余的顶层语句全部不执行**（`var` 赋值全丢），连带产生一串
 * 「Cannot read properties of undefined」的假故障 —— 实测表现为应用黑屏、鼠标不显示。
 *
 * 修法：凡是「被更早文件的顶层语句（含其同步调用链）依赖」的 function，都放进
 * 最先加载的 `00-prelude.js`（`function` 声明位置无关，搬运是零语义改动）。
 * 本脚本就是那个判定的**权威实现**：新增代码后跑一次，漏了就红。
 *
 * ── 判定口径（为什么这样切分）────────────────────────────────────────
 * 文件按 index.html 的顺序执行，记为 0..N（0 = prelude）。文件 k 执行时，只有 0..k 的
 * 声明存在。于是：
 *
 *   A 类（必搬）：文件 k 的顶层语句里出现的**任何**标识符 —— 引用本身就在那一刻求值，
 *                 哪怕是当回调传出去（`addEventListener('click', onX)`），onX 也必须已存在。
 *   B 类（下钻）：A 类里**处于调用位置**的函数当场执行，它的函数体内一切引用同样当场求值；
 *                 其中又处于调用位置的，继续下钻。
 *                 嵌套回调体**不**下钻（`onclick` 那种之后才跑），
 *                 例外是 forEach/map/reduce 这类**同步**高阶函数传入的回调。
 *
 * 必须做作用域分析：`function updatePlayModeButton(animate) {...}` 里的 animate 是形参，
 * 不做作用域就会把局部名误判成全局顶层函数（假阳性，会把 animate 主循环搬进 prelude）。
 *
 * 顶层 `var` 同理：文件 k 执行时读到「声明在后部文件的 var」，原单 script 下它是
 * hoisted 的 `undefined`，拆开后变成 ReferenceError。这类**不搬声明**（搬了会把
 * undefined 变成真值，属于行为改动），而是在 prelude 里加一条裸 `var NAME;` 精确复刻。
 *
 * ⚠️ 本脚本是**静态**分析，覆盖不到「只在特定交互下才走到的路径」。
 *    运行期闸门是 `scripts/probe-app-load.js`（preload 抓加载期错误），
 *    两者一起跑才算完：`npm run probe:ui` 会带上它。
 *
 * 用法：node scripts/check-app-hoisting.js
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..');
const APP_DIR = path.join(REPO, 'public', 'js', 'app');
const PRELUDE = '00-prelude.js';

/**
 * 跑一遍校验。既被 CLI 用，也被 `tests/app-hoisting.test.js` require —— 这样 `npm test`
 * 就能拦住回归（脚本自己 process.exit 的话没法进单测）。
 * @returns {{files:string[], fails:string[], notes:string[], need:string[], inPrelude:number, shimNames:string[]}}
 */
function runCheck() {
  /* ---------- 加载顺序：以 index.html 为唯一事实来源 ---------- */
  const html = fs.readFileSync(path.join(REPO, 'public', 'index.html'), 'utf8');
  const files = [...html.matchAll(/<script\s+src="js\/app\/([^"]+)"><\/script>/g)].map((m) => m[1]);
  if (!files.length) throw new Error('index.html 里没找到任何 js/app/*.js');

  /* ---------- 解析器 ---------- */
  let esprima;
  try {
    esprima = require('esprima');
  } catch (e) {
    throw new Error('需要 esprima 做 AST 分析（手写词法扫描在正则/模板插值处会失同步，假阳性太多）。装一下：npm install --save-dev esprima');
  }

/** 动态 import() esprima 4 不支持，替换成占位调用再解析（只影响列号，不影响行号） */
const parse = (src) => esprima.parseScript(src.replace(/\bimport\s*\(/g, '__dynImport('));

/* ---------- AST 工具 ---------- */
const SYNC_HOF = new Set([
  'forEach', 'map', 'filter', 'reduce', 'reduceRight', 'some', 'every', 'find', 'findIndex',
  'sort', 'flatMap', 'keys', 'values', 'entries', 'from', 'apply', 'call', 'then', 'catch', 'finally',
]);

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
const isFnNode = (n) => n && (n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression' || n.type === 'FunctionDeclaration');

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
function refsOf(node) {
  const out = new Set();
  const isFn = isFnNode(node);
  scanScoped(isFn ? null : node, false, (name) => out.add(name), isFn ? { fnNode: node } : null);
  return out;
}
function calledRefsOf(node) {
  const out = new Set();
  const isFn = isFnNode(node);
  scanScoped(isFn ? null : node, true, (name, isCall) => { if (isCall) out.add(name); }, isFn ? { fnNode: node } : null);
  return out;
}

/* ---------- 建索引 ---------- */
const src = {};
const ast = {};
for (const f of files) {
  const raw = fs.readFileSync(path.join(APP_DIR, f), 'utf8');
  src[f] = raw;
  try {
    ast[f] = parse(raw);
  } catch (e) {
    throw new Error('解析失败 ' + f + '：' + e.message);
  }
}

const fnHome = {};
const fnNode = {};
const fnDup = [];
const varHome = {};
const directRefs = {};
const directCalls = {};
const inPrelude = new Set();

for (let i = 0; i < files.length; i++) {
  const f = files[i];
  const refs = new Set();
  const calls = new Set();
  for (const st of ast[f].body) {
    if (st.type === 'FunctionDeclaration') {
      const nm = st.id && st.id.name;
      if (!nm) continue;
      if (fnHome[nm] !== undefined) fnDup.push(nm + '：' + files[fnHome[nm]] + ' / ' + f);
      fnHome[nm] = i;
      fnNode[nm] = st;
      if (i === 0) inPrelude.add(nm);
      continue;
    }
    if (st.type === 'VariableDeclaration') {
      for (const d of st.declarations) {
        (function collectIds(pat) {
          if (!pat) return;
          if (pat.type === 'Identifier') {
            const rec = varHome[pat.name] = varHome[pat.name] || { idx: i, kinds: new Set() };
            rec.kinds.add(st.kind);
          } else if (pat.type === 'ObjectPattern') {
            for (const p of pat.properties) collectIds(p.type === 'RestElement' ? p.argument : p.value);
          } else if (pat.type === 'ArrayPattern') {
            for (const el of pat.elements) collectIds(el);
          } else if (pat.type === 'AssignmentPattern') {
            collectIds(pat.left);
          }
        })(d.id);
      }
    }
    for (const id of refsOf(st)) refs.add(id);
    for (const id of calledRefsOf(st)) calls.add(id);
  }
  directRefs[i] = refs;
  directCalls[i] = calls;
}

/* prelude 里搬来的函数：从 `// ↓ 原属 X.js` 标签还原原始归属，否则会被误报成「多余」 */
let tagFile = null;
let restored = 0;
for (const line of src[PRELUDE].split('\n')) {
  const m = /^\/\/ ↓ 原属 (.+\.js)\s*$/.exec(line);
  if (m) { tagFile = m[1]; continue; }
  if (!tagFile) continue;
  const fm = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/.exec(line);
  if (fm && fnHome[fm[1]] === 0) {
    const idx = files.indexOf(tagFile);
    if (idx < 0) throw new Error('prelude 的 `// ↓ 原属` 指向未知文件：' + tagFile);
    fnHome[fm[1]] = idx;
    restored++;
  }
}

/* ---------- 逐文件求必须前置的集合 ---------- */
const mustPrelude = new Map();
const mustShim = new Map();
const why = new Map();
let cur = '';

for (let k = 0; k < files.length; k++) {
  if (k === 0) continue;
  const visited = new Set();
  const mark = (id) => {
    const hi = fnHome[id];
    if (hi !== undefined) {
      if (hi > k) {
        if (!mustPrelude.has(id)) mustPrelude.set(id, new Set());
        mustPrelude.get(id).add(files[k]);
        if (!why.has(id)) why.set(id, cur + ' @' + files[k]);
      }
      return;
    }
    const vh = varHome[id];
    if (vh && vh.idx > k && vh.kinds.has('var')) {
      if (!mustShim.has(id)) mustShim.set(id, new Set());
      mustShim.get(id).add(files[k]);
      if (!why.has(id)) why.set(id, cur + ' @' + files[k]);
    }
  };

  cur = '[' + files[k] + ' 顶层语句]';
  for (const id of directRefs[k]) mark(id);

  const stack = [];
  for (const id of directCalls[k]) if (fnHome[id] !== undefined) stack.push(id);
  while (stack.length) {
    const id = stack.pop();
    if (visited.has(id)) continue;
    visited.add(id);
    const body = fnNode[id];
    cur = id + '()';
    for (const r of refsOf(body)) mark(r);
    for (const c of calledRefsOf(body)) if (fnHome[c] !== undefined) stack.push(c);
  }
}

/* ---------- 断言 ---------- */
const fails = [];
const notes = [];

if (files[0] !== PRELUDE) fails.push('index.html 第一个 js/app 脚本是 ' + files[0] + '，必须是 ' + PRELUDE);

for (const n of fnDup) fails.push('顶层同名 function 重复声明（拆成多文件后「后者覆盖前者」的顺序会变）：' + n);

const need = Array.from(mustPrelude.keys()).sort();
const missing = need.filter((n) => !inPrelude.has(n));
for (const n of missing) {
  fails.push('漏在 prelude 外：' + n + '（声明于 ' + files[fnHome[n]] + '，' + why.get(n) + ' 需要它）');
}
const extra = Array.from(inPrelude).filter((n) => !mustPrelude.has(n)).sort();
for (const n of extra) notes.push('prelude 里多带了 ' + n + '（分析认为不必，留着无害，只是白搬）');
if (restored !== inPrelude.size) {
  notes.push('prelude 里 ' + inPrelude.size + ' 个顶层 function，其中 ' + restored + ' 个能从 `// ↓ 原属 X.js` 标签还原原始归属；' +
    '剩下 ' + (inPrelude.size - restored) + ' 个按「本来就在 prelude」处理（会影响判定精度）');
}

const shimsInPrelude = new Set();
for (const st of ast[PRELUDE].body) {
  if (st.type === 'VariableDeclaration') {
    for (const d of st.declarations) if (d.id && d.id.type === 'Identifier') shimsInPrelude.add(d.id.name);
  }
}
for (const n of mustShim.keys()) {
  if (!shimsInPrelude.has(n)) {
    fails.push('缺 var 提升垫片：prelude 里要有裸 `var ' + n + ';`（声明于 ' + files[varHome[n].idx] + '，' + why.get(n) + ' 需要它；' +
      '原单 script 下它此时是 undefined，不加垫片会直接 ReferenceError）');
  }
}

  return {
    files,
    fails,
    notes,
    need,
    extra,
    inPrelude: inPrelude.size,
    fnTotal: Object.keys(fnHome).length,
    shimNames: Array.from(mustShim.keys()).sort(),
    shimsInPrelude: Array.from(shimsInPrelude).sort(),
  };
}

module.exports = { runCheck };

/* ---------- CLI ---------- */
if (require.main === module) {
  let r;
  try {
    r = runCheck();
  } catch (e) {
    console.error('❌ ' + (e && e.message || e));
    process.exit(1);
  }
  console.log('加载顺序：' + r.files.join(' → '));
  console.log('顶层 function ' + r.fnTotal + ' 个；prelude 承载 ' + r.inPrelude + ' 个；必须前置 ' + r.need.length + ' 个');
  console.log('prelude 里的 var 垫片：' + (r.shimsInPrelude.join(', ') || '（无）'));
  console.log('本轮分析判定需要垫片的 var：' + (r.shimNames.join(', ') || '（无）'));
  for (const s of r.notes) console.log('  NOTE  ' + s);
  if (r.fails.length) {
    console.error('\n❌ 跨 script 提升校验失败 ' + r.fails.length + ' 条：');
    for (const f of r.fails) console.error('   ' + f);
    console.error('\n修法：把缺的声明搬进 public/js/app/00-prelude.js（`function` 位置无关，零语义改动），' +
      '或在 prelude 里加裸 `var NAME;` 垫片。\n再跑 `npm run probe:ui` 用离屏加载确认运行期也干净。');
    process.exit(1);
  }
  console.log('\n✅ 跨 script 提升校验通过：prelude 覆盖了全部 ' + r.need.length + ' 个前置依赖');
}
