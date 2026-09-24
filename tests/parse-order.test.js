'use strict';
/**
 * 「音源解析顺序」（sourceParseOrder）的语义闸。
 *
 * 锁住的不变量：
 *   1. 非会员（hasVip=false）时 auto / official / third-party **三档必须完全等价** ——
 *      非会员没有官方音源可用，解析顺序不改变任何结果。所以控制台上那一整块
 *      「音源解析顺序」seg 对非会员必须隐藏；如果不隐藏，用户看到的是一个假开关。
 *   2. VIP 时三档**必须产生区别**，否则这个选择器同样是摆设。
 *   3. VIP + auto + 官方刚失败过 → 必须切第三方优先（否则用户会一直卡在坏源上）。
 *
 * 为什么不能改：这三条是「seg 该不该显示」这个 UI 决策的唯一依据。
 * 若哪天有人改 shouldPreferThirdPartyParse 让非会员三档产生差异，seg 的隐藏逻辑
 * 就变成了 bug（把有效开关藏起来了），这个测试会拦下来。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { readAppSource, extractFunction } = require('./lib/source');

// main.js 已拆成 public/js/app/*.js；readAppSource() = 19 文件按加载顺序拼接，等价于原整份文件
const body = extractFunction(readAppSource(), 'shouldPreferThirdPartyParse');
const ORDERS = ['auto', 'official', 'third-party'];

/** 在干净沙箱里跑一次真实实现：probe(顺序, 官方失败记录, 是否会员) */
function probe(order, failStreak, vip) {
  const fn = new Function('sourceParseOrder', 'officialSourceFailStreak',
    body + '\n return shouldPreferThirdPartyParse;')(order, failStreak);
  return fn('netease', vip);
}

function rowFor(vip) {
  const row = {};
  for (const o of ORDERS) row[o] = probe(o, {}, vip);
  return row;
}

test('非会员：三档完全等价（解析顺序对非会员没有意义）', () => {
  const row = rowFor(false);
  assert.equal(new Set(Object.values(row)).size, 1,
    '非会员三档必须等价，实际 ' + JSON.stringify(row));
});

test('VIP：三档有区别（否则选择器是摆设）', () => {
  const row = rowFor(true);
  assert.ok(new Set(Object.values(row)).size > 1,
    'VIP 三档必须产生不同结果，实际 ' + JSON.stringify(row));
});

test('VIP + auto + 官方失败过 1 次 → 切第三方优先', () => {
  assert.equal(probe('auto', { netease: 1 }, true), true);
});
