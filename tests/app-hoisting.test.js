'use strict';
/**
 * 把「跨 script 函数提升」的校验接进 `npm test`。
 *
 * 背景：原 `public/js/main.js` 是单个 <script>，顶层 `function` 声明提升到整个文件顶部，
 * 所以第 85 行的顶层语句能调用第 2 万行才定义的函数。拆成 `public/js/app/*.js` 多个独立
 * script 后提升只在各自文件内生效 → ReferenceError，而且该 script 剩余顶层语句全部不执行，
 * 实测表现为**黑屏 + 鼠标不显示**（2026-09-24 事故）。
 * 修法是把这些声明搬进最先加载的 `00-prelude.js`，本测试锁住它不再被改坏。
 *
 * 判定逻辑在 `scripts/check-app-hoisting.js`（AST + 作用域分析）。这里只负责：
 *   ① 校验真的通过（fails 为空）
 *   ② 分析结果**不是空集**（否则「没漏项」是假绿 —— 分析器坏了也会全绿）
 *   ③ prelude 排第一、两条 var 提升垫片还在
 *
 * 运行期闸门是 `scripts/probe-app-load.js`（离屏加载零错误），在 `npm run probe:ui` 里。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { runCheck } = require('../scripts/check-app-hoisting.js');

const result = runCheck();

test('跨 script 提升校验：没有「该在 prelude 里却漏了」的顶层 function', () => {
  assert.deepEqual(result.fails, [],
    'prelude 漏了前置依赖（应用会在加载期 ReferenceError，且该 script 剩余顶层语句全部不执行）：\n  ' +
    result.fails.join('\n  '));
});

test('分析结果不是空集（防「分析器坏了 → 没漏项 → 假绿」）', () => {
  // 这几个是当前代码库的稳定事实：声明在后面的文件，却被 01-state / 02-scene 的顶层调用链依赖
  for (const name of ['clampRange', 'readCustomCoverMap', 'getHotkeyDefaults', 'normalizeMemorySystemMask']) {
    assert.ok(result.need.indexOf(name) >= 0,
      name + ' 应该在「必须前置」集合里；不在说明分析器没正常工作（need 共 ' + result.need.length + ' 个）');
  }
  assert.ok(result.need.length >= 30, '必须前置的声明只有 ' + result.need.length + ' 个，明显偏少，分析器可能没跑对');
  assert.equal(result.need.length, result.inPrelude,
    'prelude 承载 ' + result.inPrelude + ' 个，但分析认为必须前置 ' + result.need.length + ' 个');
});

test('index.html 第一个 js/app 脚本必须是 00-prelude.js', () => {
  assert.equal(result.files[0], '00-prelude.js',
    'prelude 不在第一位：后面文件的顶层语句会在它之前执行，跨 script 提升的函数仍会 ReferenceError');
});

test('两条顶层 var 提升垫片还在 prelude 里', () => {
  for (const name of ['MEMORY_REDUCT_MASK_DEFAULT', 'toastTimer']) {
    assert.ok(result.shimsInPrelude.indexOf(name) >= 0,
      'prelude 里缺裸 `var ' + name + ';` 垫片 —— 原单 script 下它此时是 undefined，' +
      '不加垫片会直接 ReferenceError。当前 prelude 里的 var 垫片：' + result.shimsInPrelude.join(', '));
  }
});
