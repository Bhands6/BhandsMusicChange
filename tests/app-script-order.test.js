'use strict';
/**
 * 锁住「应用主体脚本」的加载契约。
 *
 * `public/js/main.js`（28117 行单文件）已按自带的 48 个分区拆成
 * `public/js/app/01…16`。拆分本身是纯机械的，但它引入了三条新不变量：
 *
 *   1. `index.html` 必须**恰好**按顺序列出这 16 个文件 —— 一个不多、一个不少、顺序不变。
 *   2. 每个文件必须**自带** `'use strict';`（漏一个，那个文件会静默退回非严格模式：
 *      给未声明变量赋值不再抛错，而是悄悄创建全局变量）。
 *   3. 这 16 行 `<script>` 不能带 `defer` / `async` / `type="module"`。
 *
 * 为什么顺序是硬约束：它们是 **parser-blocking** 顺序执行的 —— 顶层 `var`/`function`
 * 依次挂到 `window`，顶层 `let`/`const` 依次进全局词法环境。顺序错了就是
 * TDZ / `undefined is not a function`，而且**只在运行时才炸**，静态检查看不出来。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { REPO_ROOT, APP_JS_FILES, readSource } = require('./lib/source');

const html = readSource('public/index.html');

/** index.html 里按出现顺序列出的 js/app/*.js（就是真实加载顺序） */
const LISTED = [...html.matchAll(/<script\s+src="(js\/app\/[^"]+)"><\/script>/g)]
  .map((m) => 'public/' + m[1]);

test('index.html 恰好按顺序列出 16 个应用主体脚本', () => {
  assert.deepEqual(LISTED, APP_JS_FILES,
    'index.html 的 js/app/*.js 列表与 tests/lib/source.js 的 APP_JS_FILES 不一致（顺序即执行顺序）');
});

test('public/js/app 目录下没有多余/缺失的脚本', () => {
  const onDisk = fs.readdirSync(path.join(REPO_ROOT, 'public', 'js', 'app'))
    .filter((n) => n.endsWith('.js'))
    .sort()
    .map((n) => 'public/js/app/' + n);
  assert.deepEqual(onDisk, APP_JS_FILES.slice().sort());
});

test('每个应用主体脚本都存在、非空、首行是 use strict', () => {
  for (const rel of APP_JS_FILES) {
    const src = readSource(rel);
    assert.ok(src.length > 1000, rel + ' 只有 ' + src.length + ' 字符，像被截断了');
    assert.equal(src.split('\n')[0], "'use strict';",
      rel + ' 首行不是 \'use strict\';（漏了会静默退回非严格模式）');
  }
});

test('index.html 里 16 个 script 标签都不带 defer / async / type=module', () => {
  const tags = [...html.matchAll(/<script[^>]*src="js\/app\/[^"]+"[^>]*>/g)].map((m) => m[0]);
  assert.equal(tags.length, 16, '匹配到 ' + tags.length + ' 个 js/app 的 script 标签');
  for (const tag of tags) {
    assert.doesNotMatch(tag, /\bdefer\b/, '不能加 defer：' + tag);
    assert.doesNotMatch(tag, /\basync\b/, '不能加 async：' + tag);
    assert.doesNotMatch(tag, /type\s*=\s*["']module["']/, '不能改成 module：' + tag);
  }
});

test('原 public/js/main.js 已删除（别再被"顺手"加回来）', () => {
  assert.equal(fs.existsSync(path.join(REPO_ROOT, 'public', 'js', 'main.js')), false);
});
