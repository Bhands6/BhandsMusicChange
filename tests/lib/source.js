'use strict';
/**
 * 测试公用：从**真实源码**里抽出函数 / 常量声明，让断言跑在真代码上而不是复刻副本。
 *
 * 为什么不直接 require：
 *   - `public/js/main.js` 是浏览器端经典脚本，没有 `module.exports`；
 *   - `server/server.js` 一旦 require 就会真的起 http 服务、spawn 内置酷狗子进程。
 * 所以统一走「抽文本 → `new Function` 执行」这条路。
 *
 * ⚠️ 抽函数必须把 `async ` 前缀一起带上 —— 只按 `'function NAME('` 切片会丢掉它，
 * 函数体里的 `await` 立刻变成 SyntaxError（踩过）。
 */
const fs = require('node:fs');
const path = require('node:path');

/** 仓库根。tests/ 与 scripts/ 都在根下，所以向上两级 */
const REPO_ROOT = path.resolve(__dirname, '..', '..');

/** 读仓库内文件（相对仓库根的路径，正斜杠） */
function readSource(relPath) {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
}

/**
 * 剥掉注释，剩下的才算「代码」。
 * 断言「某个键只出现在注释里」时必须先过这一层，否则说明性注释会被算成命中。
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')   // /* */ 与 /** */
    .replace(/^\s*\/\/.*$/gm, '');      // 整行 //
}

/** 从 openIdx（'{' 或 '[' 的位置）配对到闭合括号，返回闭合括号之后的下标 */
function matchBracket(src, openIdx) {
  const open = src[openIdx];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close) { depth--; if (depth === 0) return i + 1; }
  }
  throw new Error('括号不配对（起点 ' + openIdx + '）');
}

/** 抽 `function NAME(...) {...}` 的完整声明文本，含可能的 `async ` 前缀 */
function extractFunction(src, name) {
  const marker = 'function ' + name + '(';
  const at = src.indexOf(marker);
  if (at < 0) throw new Error('未找到 function ' + name);
  const start = src.slice(Math.max(0, at - 6), at) === 'async ' ? at - 6 : at;
  return src.slice(start, matchBracket(src, src.indexOf('{', at)));
}

/** 抽 `const NAME = {...};` / `const NAME = [...];` 的完整声明文本 */
function extractConst(src, name) {
  const start = src.indexOf('const ' + name + ' = ');
  if (start < 0) throw new Error('未找到 const ' + name);
  let openIdx = -1;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{' || src[i] === '[') { openIdx = i; break; }
    if (src[i] === ';') break;
  }
  if (openIdx < 0) throw new Error('const ' + name + ' 不是对象/数组字面量');
  return src.slice(start, matchBracket(src, openIdx)) + ';';
}

/** 抽标量常量的**表达式文本**：`const NAME = <expr>;` → `<expr>`（不含分号） */
function extractScalar(src, name) {
  const m = new RegExp('const ' + name + ' = ([^;]+);').exec(src);
  if (!m) throw new Error('未找到 const ' + name);
  return m[1];
}

/** needle 首次出现处的行号（1 起）。找不到直接抛，别静默返回 -1 让断言跑空 */
function lineOf(src, needle) {
  const at = src.indexOf(needle);
  if (at < 0) throw new Error('未找到: ' + needle);
  return src.slice(0, at).split('\n').length;
}

module.exports = {
  REPO_ROOT,
  readSource,
  stripComments,
  matchBracket,
  extractFunction,
  extractConst,
  extractScalar,
  lineOf,
};
