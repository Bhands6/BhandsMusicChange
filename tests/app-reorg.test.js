/**
 * 按职责重排（2026-09-24 第二步）的安全闸门 —— 把 `scripts/check-app-reorg.js` 接进 `npm test`。
 *
 * ── 为什么要有这个测试 ────────────────────────────────────────────────
 * `public/js/app/*.js` 的文件划分（哪个函数在哪个文件）**随时会再被调整**。
 * 跨文件搬 `function` 是零语义改动（靠提升），但搬 `var/let/const` 与顶层语句会改变
 * 「加载期读取点看到的初始化状态」，那是能直接把应用搞黑屏的一类回归。
 * 这个测试用「重排前」的基线逐项比对，把这类回归钉死在 CI 里。
 *
 * ⚠️ 本测试**只**证明「文件划分变了但加载期读写语义没变」。
 *    它不证明跨 script 提升仍然成立（那是 `scripts/check-app-hoisting.js`），
 *    也不证明应用真的能跑（那是 `scripts/probe-app-load.js` 离屏加载闸门）。三者缺一不可。
 *
 * ⚠️ 直接 require 校验器复用同一份判定，不 spawn 子进程 ——
 *    沙箱里 `spawnSync`/`execFileSync` 一律 EBUSY；复制一份判定逻辑则迟早漂移。
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const reorg = require('../scripts/check-app-reorg.js');

/* verify() 要 esprima 解析 19 个文件（≈2.8 万行），别在三个用例里各跑一遍。 */
let _r = null;
function result() {
  if (!_r) _r = reorg.verify();
  return _r;
}

test('基线文件存在且含观测数据', () => {
  assert.ok(fs.existsSync(reorg.BASELINE), '缺少 ' + reorg.BASELINE + '，先跑 --write-baseline');
  const base = JSON.parse(fs.readFileSync(reorg.BASELINE, 'utf8'));
  assert.ok(Object.keys(base.itemHashes).length > 0, '基线里没有条目 hash');
  assert.ok(Object.keys(base.obs).length > 0, '基线里没有读取观测');
  assert.ok(Array.isArray(base.files) && base.files.length > 0, '基线里没有文件列表');
});

test('当前布局与基线「加载期读写顺序」完全等价', () => {
  const r = result();
  assert.equal(r.fails.length, 0, '顺序等价校验失败：\n  ' + r.fails.slice(0, 20).join('\n  '));
  assert.ok(r.checked > 0, '没有比对到任何读取点 —— 校验器本身可能失效了（假绿）');
  assert.ok(r.names > 0, '没有被观测的名字');
});

test('条目守恒，且 index.html 引用的每个 app 脚本都真的存在', () => {
  const r = result();
  const total = (m) => Object.values(m).reduce((a, b) => a + b, 0);
  const curCounts = r.cur.items.reduce((m, it) => (m[it.hash] = (m[it.hash] || 0) + 1, m), {});
  assert.equal(total(r.base.itemHashes), total(curCounts), '有加载期副作用的条目总数变了');
  assert.equal(total(r.base.fnHashes), r.cur.fnDecls.length, 'function 声明总数变了');
  assert.ok(r.cur.files.length >= 1 && r.base.files.length >= 1);
  for (const f of r.cur.files) {
    assert.ok(fs.existsSync(path.join(reorg.APP_DIR, f)), 'index.html 引用了不存在的 ' + f);
  }
});
