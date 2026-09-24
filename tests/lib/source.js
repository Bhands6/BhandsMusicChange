'use strict';
/**
 * 测试公用：从**真实源码**里抽出函数 / 常量声明，让断言跑在真代码上而不是复刻副本。
 *
 * 为什么不直接 require：
 *   - 应用主体脚本（`public/js/app/*.js`，原 `public/js/main.js`）是浏览器端经典脚本，
 *     没有 `module.exports`；
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

/**
 * 应用主体脚本：原 `public/js/main.js`（28117 行单文件）于 2026-09-24
 * 先按自带的 48 个分区切成 16 个文件，随后按**职责**重排成 18 个（`01-state.js` … `18-session-boot.js`），
 * 外加最先加载的 `00-prelude.js`（见下），共 19 个，都在 `public/js/app/`。
 * **数组顺序 = index.html 里的加载顺序，不可调换。**
 *
 * 跨文件的测试用 `readAppSource()` 取「逻辑上的 main.js」—— 它是这 19 个文件
 * 按序拼接的结果。
 *
 * ⚠️ 00-prelude.js 是什么：原 main.js 是**单个 script**，顶层 `function` 声明会被提升到
 * 整个文件顶部，所以第 85 行的顶层语句能调用第 2 万行才定义的函数。切成多个独立 script 后
 * 提升只在各自文件内生效 —— 凡是「被更早文件的顶层语句（含其同步调用链）依赖」的
 * function 必须最先可用，都放在 prelude。判定与校验见 `scripts/check-app-hoisting.js`。
 * 所以 `readAppSource()` **不等于**原 main.js 的逐字节拼接（函数位置变了），但语义等价；
 * 「按职责重排」这一步的加载期读写顺序等价性由 `scripts/check-app-reorg.js` 对基线校验。
 */
const APP_JS_FILES = [
  '00-prelude.js',
  '01-state.js',
  '02-scene.js',
  '03-particles.js',
  '04-lyrics.js',
  '05-lyrics-stage.js',
  '06-cover.js',
  '07-beat.js',
  '08-shelf.js',
  '09-api-search.js',
  '10-audio-queue.js',
  '11-playlist.js',
  '12-fx-console.js',
  '13-system-panels.js',
  '14-account.js',
  '15-update.js',
  '16-idle-toast-libs.js',
  '17-shell.js',
  '18-session-boot.js',
].map((name) => 'public/js/app/' + name);

/** 读仓库内文件（相对仓库根的路径，正斜杠） */
function readSource(relPath) {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
}

/** 读全部 19 个应用主体脚本并按加载顺序拼接（≈ 拆分前的 main.js，函数位置已重排） */
function readAppSource() {
  return APP_JS_FILES.map(readSource).join('\n');
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
  APP_JS_FILES,
  readSource,
  readAppSource,
  stripComments,
  matchBracket,
  extractFunction,
  extractConst,
  extractScalar,
  lineOf,
};
