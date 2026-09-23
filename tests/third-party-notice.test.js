'use strict';
/**
 * 校验「第三方音源的解析状态提示」。
 *
 * 锁住的不变量：
 *   1. `tryThirdPartyParse` 传 `silent` 时**不**提示（启动预解析用，不能刷屏）。
 *   2. 不传 `silent` 时提示两次：解析中 → 可用。
 *   3. 播放主流程里「第三方优先」那个调用点**必须不静默** ——
 *      用户明确要求解析提示要在每首歌播放前显示（第三方解析可能 1~2s，
 *      没提示的话点播放后界面像卡住）。**别把它改成 `{ silent: true }`。**
 *   4. 预解析命中会跳过整段解析链，必须由 `notifyPreparsedSourceNotice` 单独补提示，
 *      否则那条路径下顶部一条提示都没有（用户要求「每首歌播放前都有提示」）。
 *
 * 全部断言跑在**从真实源码抽出来的函数**上。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { readSource, extractFunction } = require('./lib/source');

const src = readSource('public/js/main.js');

/** 造一个只装了 tryThirdPartyParse 及其桩的沙箱；每次调用独立，测试之间不串状态 */
function makeRunner() {
  const notices = [];
  const fn = new Function('__notices', `
    var window = { AbortController: function () { this.signal = null; this.abort = function () {}; } };
    function showSourceFallbackNotice(t, b) { __notices.push(t + ' / ' + b); }
    function extractArtistNames(s) { return ['周杰伦']; }
    function extractAlbumName(s) { return ''; }
    var fetch = function () { return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ url: 'http://x/a.flac', source: 'kugou', level: 'lossless', br: 999000 }); } }); };
    var setTimeout = function () { return 0; };
    var clearTimeout = function () {};
    var console = { log: function () {}, warn: function () {} };
    ${extractFunction(src, 'tryThirdPartyParse')}
    return tryThirdPartyParse;
  `);
  return { run: fn(notices), notices };
}

/** 造一个只装了 notifyPreparsedSourceNotice 及其依赖的沙箱 */
function makePreparseRunner() {
  const notices = [];
  const fn = new Function('__notices', `
    function showSourceFallbackNotice(t, b) { __notices.push(t + ' / ' + b); }
    function playbackQualityLabel(level) {
      return ({ jymaster: '超清母带', hires: '高清臻音', lossless: '无损', exhigh: '极高', standard: '标准' })[level] || level || '';
    }
    function playbackBitrateLabel(br) { br = Number(br) || 0; return br > 0 ? Math.round(br / 1000) + ' kbps' : ''; }
    ${extractFunction(src, 'playbackResolvedQualityText')}
    ${extractFunction(src, 'notifyPreparsedSourceNotice')}
    return notifyPreparsedSourceNotice;
  `);
  return { run: fn(notices), notices };
}

const SONG = { id: 1, name: '晴天', artists: [{ name: '周杰伦' }] };

// ============================================================
// [1] tryThirdPartyParse 的提示行为
// ============================================================

test('[1] silent:true → 0 条提示（启动预解析用），但仍返回档位对象', async () => {
  const r = makeRunner();
  const out = await r.run(SONG, 'hires', { silent: true });
  assert.equal(r.notices.length, 0, '静默模式下不该有任何提示，实际 ' + JSON.stringify(r.notices));
  assert.equal(out && out.level, 'lossless');
});

test('[1] 第三方优先（不传 silent）→ 提示 2 次：解析中 + 可用', async () => {
  const r = makeRunner();
  const out = await r.run(SONG, 'hires');
  assert.equal(r.notices.length, 2, '实际 ' + JSON.stringify(r.notices));
  assert.equal(r.notices[0], '正在尝试第三方音源 / 正在搜索可用音源...',
    '第三方优先路径下官方源压根没试过，文案不能说「官方音源不可用」');
  assert.match(r.notices[1], /^第三方音源可用 \/ /);
  assert.equal(out && out.level, 'lossless');
});

test('[1] 官方失败兜底（officialFailed）→ 文案保留「官方音源不可用」', async () => {
  const r = makeRunner();
  await r.run(SONG, 'hires', { officialFailed: true });
  assert.equal(r.notices[0], '正在尝试第三方音源 / 官方音源不可用，正在搜索其他来源...');
});

// ============================================================
// [2] 调用点静态检查
// ============================================================

/** 扫出 tryThirdPartyParse 的全部调用点（排除函数声明本身） */
function callSites() {
  const sites = [];
  const re = /tryThirdPartyParse\(([^)]*)\)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (src.slice(Math.max(0, m.index - 9), m.index) === 'function ') continue;
    sites.push({
      line: src.slice(0, m.index).split('\n').length,
      args: m[1],
      silent: /silent\s*:\s*true/.test(m[1]),
    });
  }
  return sites;
}
const lineOf = (needle) => src.slice(0, src.indexOf(needle)).split('\n').length;

test('[2] 共 4 个调用点，且静默的只有启动预解析那 2 个', () => {
  const sites = callSites();
  assert.equal(sites.length, 4, '实际 ' + JSON.stringify(sites));
  const quiet = sites.filter((s) => s.silent);
  assert.equal(quiet.length, 2, '静默的应只有 resolveSongSourceQuietly 里那 2 个，实际 ' + JSON.stringify(quiet));
  const officialFirstLine = lineOf('// 官方优先（VIP + 未触发降级）');
  assert.ok(quiet.every((s) => s.line > officialFirstLine),
    '静默调用点都应在「官方优先」分支之后，实际 ' + JSON.stringify(quiet));
});

test('[2] 第三方优先分支：调用点未静默、未标 officialFailed', () => {
  const sites = callSites();
  const thirdPartyFirstLine = lineOf('} else if (!data && (preferThirdParty || !hasVip)) {');
  const officialFirstLine = lineOf('// 官方优先（VIP + 未触发降级）');
  const inBranch = sites.filter((s) => s.line > thirdPartyFirstLine && s.line < officialFirstLine);
  assert.equal(inBranch.length, 1, '该分支里应恰好 1 个调用点，实际 ' + JSON.stringify(inBranch));
  // 这条是**用户要求的**行为：解析提示必须显示，别改成 silent
  assert.equal(inBranch[0].silent, false, '第三方优先调用点必须不静默（播放前要显示解析提示）');
  assert.equal(/officialFailed/.test(inBranch[0].args), false, '官方源没试过，不能标 officialFailed');
});

test('[2] 官方失败兜底分支：不静默 + 标 officialFailed（文案才成立）', () => {
  const sites = callSites();
  const officialFirstLine = lineOf('// 官方优先（VIP + 未触发降级）');
  const fallback = sites.filter((s) => s.line > officialFirstLine && !s.silent)[0];
  assert.ok(fallback, '应有 1 个非静默的官方失败兜底调用点');
  assert.match(fallback.args, /officialFailed\s*:\s*true/);
});

// ============================================================
// [3] data 可能为 null 的解引用防护
// ============================================================

test('[3] 源解析块内没有裸 if (!data.url) 解引用', () => {
  const block = src.slice(
    src.indexOf('} else if (!data && (preferThirdParty'),
    src.indexOf('var proxyAudioUrl')
  );
  assert.ok(block.length > 0, '没切到源解析块 —— 锚点字符串变了，先修锚点再改断言');
  const guarded = (block.match(/if \(!data \|\| !data\.url\)/g) || []).length;
  const rawDerefs = (block.match(/if \(!data\.url\)/g) || []).length;
  assert.ok(guarded >= 4, '源解析块内至少 4 处 `!data || !data.url` 防护（≥4，不卡死具体数），实际 ' + guarded);
  assert.equal(rawDerefs, 0, '源解析块内不该有裸 `if (!data.url)`');
});

// ============================================================
// [4] 预解析命中补提示 notifyPreparsedSourceNotice
// ============================================================

test('[4] 第三方预解析命中 → 1 条提示', () => {
  const r = makePreparseRunner();
  r.run({ url: 'http://x/a.flac', source: 'third-party', thirdPartySource: 'kugou', level: 'lossless', br: 999000 });
  assert.deepEqual(r.notices, ['第三方音源已就绪 / 已通过 kugou 获取到音频。']);
});

test('[4] 官方预解析命中 → 1 条提示且带档位', () => {
  const r = makePreparseRunner();
  r.run({ url: 'http://x/b.flac', source: 'netease', level: 'lossless', br: 999000 });
  assert.deepEqual(r.notices, ['音源已就绪 / 官方音源 · 无损 · 999 kbps。']);
});

test('[4] 官方预解析无档位 → 兜底文案', () => {
  const r = makePreparseRunner();
  r.run({ url: 'http://x/c.mp3', source: 'netease' });
  assert.deepEqual(r.notices, ['音源已就绪 / 官方音源，可立即播放。']);
});

test('[4] 试听预解析命中 → 试听文案', () => {
  const r = makePreparseRunner();
  r.run({ url: 'http://x/d.mp3', trial: true, source: 'netease', level: 'standard', br: 128000 });
  assert.deepEqual(r.notices, ['试听片段可用 / 完整版不可用，当前播放官方 30 秒试听。']);
});

test('[4] 无 url / null / 空串 → 不提示', () => {
  const r = makePreparseRunner();
  r.run(null);
  r.run({ source: 'netease' });
  r.run({ url: '', source: 'netease' });
  assert.equal(r.notices.length, 0, '实际 ' + JSON.stringify(r.notices));
});

test('[4] 预解析命中点确实调用了 notifyPreparsedSourceNotice（且在 take 之后）', () => {
  const callIdx = src.indexOf('notifyPreparsedSourceNotice(data);');
  const takeIdx = src.indexOf('takePreparsedSongSource(song, requestedQuality)');
  assert.ok(callIdx > 0, '没找到调用点 —— 预解析命中的提示可能被删了');
  assert.ok(takeIdx > 0, '没找到 takePreparsedSongSource 调用点');
  assert.ok(callIdx > takeIdx, '调用位置应在 takePreparsedSongSource 之后（同一分支内）');
});
