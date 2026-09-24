'use strict';
/**
 * 「音质提示文案」的语义闸。
 *
 * 沙箱：从真实应用源码抽出 12 个档位/账号相关函数 + 提示判定块本身，跑 8 个场景。
 * 判定块是**按行区间**从源码里切的（不是复刻），所以源码改了文案这个测试立刻会红。
 *
 * 锁住的不变量：
 *   - 请求「超清母带」（jymaster，SVIP 专属）而账号不是 SVIP 时，要提示
 *     「超清母带需要 SVIP，已用 X」并给出**实际**档位与码率；
 *   - 同一会话只提示一次（不刷屏）；
 *   - 第三方音源 / 试听片段 / 偏好档位命中 都不该报「降级」；
 *   - VIP 请求无损实际拿到 128k → 要报真降级；
 *   - 只有中文 `quality` 没有 `level` 时，**不能**把「极高」显示成「高清臻音」；
 *   - 手动切档位（`opts.qualitySwitch`）走「音质已切换」文案。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { readAppSource, extractFunction } = require('./lib/source');

// main.js 已拆成 public/js/app/*.js；readAppSource() = 19 文件按加载顺序拼接，等价于原整份文件
const src = readAppSource();

/** 判定块依赖的函数（顺序无关，new Function 里都是声明提升） */
const NOTICE_FNS = [
  'normalizePlaybackQuality', 'playbackQualityLabel', 'playbackQualityRank',
  'playbackQualityWasDowngraded', 'isSvipOnlyQuality', 'playbackBitrateLabel',
  'playbackResolvedQualityText', 'platformStatus', 'providerVipType', 'providerVipLevel',
  'hasProviderVip', 'hasProviderSvip',
];
const FNS_SRC = NOTICE_FNS.map((n) => extractFunction(src, n)).join('\n\n');

/** 按行区间切出「解析完成后决定要不要弹提示」那段真实代码 */
function extractNoticeBlock() {
  const lines = src.split('\n');
  const start = lines.findIndex((l) => l.includes('var resolvedQualityText = playbackResolvedQualityText(data);'));
  if (start < 0) throw new Error('未找到提示判定块起点（锚点 var resolvedQualityText = ...）');
  let end = -1;
  for (let i = start; i < start + 40; i++) {
    if (lines[i] && lines[i].includes("showSourceFallbackNotice('音质已切换'")) { end = i + 1; break; }
  }
  if (end < 0) throw new Error('未找到提示判定块结尾（锚点 showSourceFallbackNotice(\'音质已切换\')）');
  return { text: lines.slice(start, end + 1).join('\n'), from: start + 1, to: end + 1 };
}
const NOTICE_BLOCK = extractNoticeBlock();

/** 每个场景都拿全新沙箱，避免场景之间串状态（node:test 不保证跨文件执行顺序） */
function makeSandbox() {
  const body = `
var SVIP_ONLY_QUALITIES = ['jymaster'];
var svipQualityNoticeShown = false;
var playbackQuality = 'hires';
var loginStatus = { loggedIn: true, vipType: 0, vipLevel: 'none', isVip: false, isSvip: false };
var qqLoginStatus = { loggedIn: false, vipType: 0 };
var isQQPlayback = false;
var requestedQuality = 'hires';
var opts = {};
var notices = [];
function showSourceFallbackNotice(title, txt) { notices.push(title + ' / ' + txt); }
// 判定块里会调它（记录实际档位并刷新音质按钮）——本文件只测提示文案，桩掉即可
function noteResolvedPlaybackQuality() {}
${FNS_SRC}
function run(data) {
${NOTICE_BLOCK.text}
}
return {
  run: run,
  notices: notices,
  set: function (o) {
    if ('requestedQuality' in o) requestedQuality = o.requestedQuality;
    if ('isQQPlayback' in o) isQQPlayback = o.isQQPlayback;
    if ('opts' in o) opts = o.opts;
    if ('loginStatus' in o) loginStatus = o.loginStatus;
    if ('svipQualityNoticeShown' in o) svipQualityNoticeShown = o.svipQualityNoticeShown;
  }
};
`;
  return new Function(body)();
}

/** 跑一个场景，返回「实际提示」文本（无提示时返回 '(静默)'） */
function notice(setup, data) {
  const S = makeSandbox();
  S.set(setup);
  S.run(data);
  return S.notices.length ? S.notices.join(' | ') : '(静默)';
}

const VIP = { loggedIn: true, vipType: 11, vipLevel: 'vip', isVip: true, isSvip: false };
const NOVIP = { loggedIn: true, vipType: 0, vipLevel: 'none', isVip: false, isSvip: false };

test('提示判定块的锚点仍能切出非空代码（防止锚点漂移后断言跑空）', () => {
  assert.ok(NOTICE_BLOCK.text.length > 200,
    `切出的判定块只有 ${NOTICE_BLOCK.text.length} 字符（main.js:${NOTICE_BLOCK.from}-${NOTICE_BLOCK.to}），锚点可能已漂移`);
  assert.match(NOTICE_BLOCK.text, /showSourceFallbackNotice/);
});

test('① 官方 非SVIP 请求超清母带 → 上游实为 exhigh/320k（会话首次）', () => {
  const got = notice(
    { requestedQuality: 'jymaster', svipQualityNoticeShown: false, loginStatus: NOVIP, isQQPlayback: false, opts: {} },
    { level: 'exhigh', quality: '极高', br: 320000 }
  );
  assert.ok(got.includes('超清母带需要 SVIP'), '实际: ' + got);
  assert.ok(got.includes('极高 · 320 kbps'), '实际: ' + got);
});

test('② 同会话第二首（应静默）', () => {
  const got = notice(
    { requestedQuality: 'jymaster', svipQualityNoticeShown: true, loginStatus: NOVIP, isQQPlayback: false, opts: {} },
    { level: 'exhigh', quality: '极高', br: 320000 }
  );
  assert.equal(got, '(静默)');
});

test('③ 第三方音源命中（data 无 level/br）→ 静默', () => {
  const got = notice(
    { requestedQuality: 'jymaster', svipQualityNoticeShown: false, loginStatus: NOVIP, isQQPlayback: false, opts: {} },
    { url: 'http://x/a.mp3', trial: false, playable: true, source: 'third-party' }
  );
  assert.equal(got, '(静默)');
});

test('④ 试听片段（trial）→ 静默', () => {
  const got = notice(
    { requestedQuality: 'jymaster', svipQualityNoticeShown: false, loginStatus: NOVIP, isQQPlayback: false, opts: {} },
    { level: 'standard', quality: '标准', br: 128012, trial: true }
  );
  assert.equal(got, '(静默)');
});

test('⑤ 偏好=极高，实际 exhigh/320k → 静默（不算降级）', () => {
  const got = notice(
    { requestedQuality: 'exhigh', svipQualityNoticeShown: false, loginStatus: NOVIP, isQQPlayback: false, opts: {} },
    { level: 'exhigh', quality: '极高', br: 320000 }
  );
  assert.equal(got, '(静默)');
});

test('⑥ VIP 请求无损 → 实际 标准/128k（报真降级）', () => {
  const got = notice(
    { requestedQuality: 'lossless', svipQualityNoticeShown: false, loginStatus: VIP, isQQPlayback: false, opts: {} },
    { level: 'standard', quality: '标准', br: 128000 }
  );
  assert.ok(got.includes('网易云音质自动降级'), '实际: ' + got);
  assert.ok(got.includes('请求 无损，实际播放 标准 · 128 kbps'), '实际: ' + got);
});

test('⑦ 只有中文 quality=极高（无 level）→ 不再误显示成「高清臻音」', () => {
  const got = notice(
    { requestedQuality: 'jymaster', svipQualityNoticeShown: false, loginStatus: NOVIP, isQQPlayback: false, opts: {} },
    { quality: '极高', br: 320000 }
  );
  assert.ok(got.includes('极高 · 320 kbps'), '实际: ' + got);
  assert.equal(got.includes('高清臻音'), false, '没有 level 时不能按中文猜成更高档位，实际: ' + got);
});

test('⑧ 手动切音质（opts.qualitySwitch）→ 「音质已切换」文案', () => {
  const got = notice(
    { requestedQuality: 'lossless', svipQualityNoticeShown: false, loginStatus: VIP, isQQPlayback: false, opts: { qualitySwitch: true } },
    { level: 'lossless', quality: '无损', br: 1411000 }
  );
  assert.ok(got.includes('音质已切换'), '实际: ' + got);
  assert.ok(got.includes('无损 · 1.41 Mbps'), '实际: ' + got);
});
