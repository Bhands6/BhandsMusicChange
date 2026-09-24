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
 * ⚠️ 按职责重排（2026-09-24 第二步）改的是**文件划分**，本脚本依然适用 —— 它只依赖
 *    index.html 的顺序，不依赖文件名。重排后 prelude 里的 `// ↓ 原属 X.js` 标签要同步
 *    改成新的文件名，否则会报「指向未知文件」。
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

  /* ---------- 解析器 + AST 工具（共用 scripts/lib/ast-scan.js） ---------- */
  let esprima;
  try {
    esprima = require('esprima');
  } catch (e) {
    throw new Error('需要 esprima 做 AST 分析（手写词法扫描在正则/模板插值处会失同步，假阳性太多）。装一下：npm install --save-dev esprima');
  }
  const { makeParser, refsOf, calledRefsOf } = require('./lib/ast-scan');
  const parse = makeParser(esprima);

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
// ⚠️ 先确认 prelude 真的在加载顺序里。否则 src[PRELUDE] 是 undefined，
//    下一行 `.split('\n')` 会抛 `Cannot read properties of undefined (reading 'split')` ——
//    那是最该给出人话诊断的场景（prelude 被从 index.html 删掉/改了名），却报成一句天书。
if (!(PRELUDE in src)) {
  throw new Error('index.html 的 js/app 加载顺序里没有 ' + PRELUDE + '（实际是：' + files.join(' → ') +
    '）。跨 script 函数提升依赖它排第一，必须先把它加回去。');
}
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
