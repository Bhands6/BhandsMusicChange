'use strict';
/**
 * 验证 goMusic 换源的「中性失败」链路。
 *
 * 中性失败 = 「这首歌在换源平台上没有可用资源」，属于**正常结论**，
 * 不能算作服务故障；而超时 / 服务不可用才是真实故障，要计入连败、触发冷却。
 *
 * 覆盖两处真实源码：
 *   A. `server/music-sources/goMusicSwitch.js`（真实 require，只桩掉 global.fetch）
 *      —— 四个「这首歌没有可用资源」分支必须返回 `{url:'', neutralFailure:true}`，
 *         超时/服务不可用仍返回 `null`。
 *   B. `server/music-sources/musicParser.js`（按大括号配对抽真实源码）
 *      —— goMusicStrategy 要透传中性标记，且**早退**（命中失败缓存）也要回放成中性。
 *         这是核心回归点：旧代码里第二次解析返回 null，被当成真实故障计数，
 *         于是「一首歌本来就换不到源」会把 goMusic 整条策略打成冷却。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { REPO_ROOT, readSource, extractConst, extractFunction, extractScalar } = require('./lib/source');

const SWITCH_PATH = path.join(REPO_ROOT, 'server/music-sources/goMusicSwitch.js');

// ============================================================
// [A] goMusicSwitch.js —— 真实模块 + 桩 fetch
// ============================================================

delete require.cache[require.resolve(SWITCH_PATH)];
const gomusic = require(SWITCH_PATH);

/** 依次返回预设响应；每次调用消费一个。元素是 Error 时走 reject 分支 */
let fetchQueue = [];
let fetchCalls = [];
global.fetch = function (url) {
  fetchCalls.push(String(url));
  const next = fetchQueue.shift();
  if (next instanceof Error) return Promise.reject(next);
  return Promise.resolve({
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: () => Promise.resolve(next),
  });
};

const baseParams = { id: 2623517920, name: '其实都没有', artists: ['杨宗纬'], duration: 255000, quality: 'lossless' };

/** 这几个子测试共享 goMusicSwitch 的模块内失败缓存，所以必须顺序执行、不能拆成独立 test */
test('[A] goMusicSwitch：中性失败返回 neutralFailure，真实故障返回 null', async (t) => {
  await t.test('A1 歌手不一致 → 中性，且拿到候选就拒、不再取直链', async () => {
    fetchQueue = [{ source: 'qq', id: 'song1', artist: '别人的名字' }];
    fetchCalls = [];
    const r = await gomusic.tryGoMusicSwitch({ ...baseParams, id: 1 });
    assert.equal(r && r.url, '', '实际 ' + JSON.stringify(r));
    assert.equal(r && r.neutralFailure, true, '实际 ' + JSON.stringify(r));
    assert.equal(r && r.reason, 'artist-mismatch');
    assert.equal(fetchCalls.length, 1, '拿到候选就拒，不该再打第二次');
  });

  await t.test('A2 换源没找到候选 → 中性', async () => {
    fetchQueue = [null];
    const r = await gomusic.tryGoMusicSwitch({ ...baseParams, id: 2 });
    assert.equal(r && r.neutralFailure, true, '实际 ' + JSON.stringify(r));
    assert.equal(r && r.reason, 'no-candidate');
  });

  await t.test('A3 平台不在白名单 → 中性', async () => {
    fetchQueue = [{ source: 'bilibili', id: 'b1', artist: '杨宗纬' }];
    const r = await gomusic.tryGoMusicSwitch({ ...baseParams, id: 3 });
    assert.equal(r && r.neutralFailure, true, '实际 ' + JSON.stringify(r));
    assert.equal(r && r.reason, 'platform-not-allowed');
  });

  await t.test('A4 有候选但拿不到直链 → 中性', async () => {
    fetchQueue = [
      { source: 'qq', id: 'q1', artist: '杨宗纬' },
      { code: 200, data: { url: '' } },
    ];
    const r = await gomusic.tryGoMusicSwitch({ ...baseParams, id: 4 });
    assert.equal(r && r.neutralFailure, true, '实际 ' + JSON.stringify(r));
    assert.equal(r && r.reason, 'no-direct-url');
  });

  await t.test('A5 换源超时 → null（真实故障，要计数）', async () => {
    const timeoutErr = new Error('timeout');
    timeoutErr.name = 'TimeoutError';
    fetchQueue = [timeoutErr];
    const r = await gomusic.tryGoMusicSwitch({ ...baseParams, id: 5 });
    assert.equal(r, null);
  });

  await t.test('A6 成功路径不受影响', async () => {
    fetchQueue = [
      { source: 'kugou', id: 'k1', artist: '杨宗纬' },
      { code: 200, data: { url: 'https://cdn.example.com/a.flac', bitrate: 999, size: 30000000 } },
    ];
    const r = await gomusic.tryGoMusicSwitch({ ...baseParams, id: 6 });
    assert.match((r && r.url) || '', /^https:\/\//, '实际 ' + JSON.stringify(r));
    assert.equal(r && r.source, 'gomusic-kugou');
    assert.equal(r && r.br, 999000);
    assert.equal(r && r.size, 30000000);
  });

  await t.test('A7 5 分钟内重播同一首（命中失败缓存）→ 早退仍回放成中性', async () => {
    fetchCalls = [];
    const r = await gomusic.tryGoMusicSwitch({ ...baseParams, id: 4 });
    assert.equal(r && r.neutralFailure, true, '实际 ' + JSON.stringify(r));
    assert.equal(fetchCalls.length, 0, '命中缓存不该打上游');
  });

  await t.test('A8 真实故障被缓存后，早退仍是 null（不能被中性污染）', async () => {
    const r = await gomusic.tryGoMusicSwitch({ ...baseParams, id: 5 });
    assert.equal(r, null);
  });
});

// ============================================================
// [B] musicParser.js —— 抽真实源码跑 goMusicStrategy
// ============================================================

/** 造一个只装了 goMusicStrategy + 失败缓存 + 连败计数的沙箱 */
function makeParserSandbox() {
  const parserSrc = readSource('server/music-sources/musicParser.js');
  const pieces = [
    'const FAILED_CACHE_TTL = ' + extractScalar(parserSrc, 'FAILED_CACHE_TTL') + ';',
    'const failedCache = new Map();',
    extractFunction(parserSrc, 'readFailedCache'),
    extractFunction(parserSrc, 'isInFailedCache'),
    extractFunction(parserSrc, 'addFailedCache'),
    'const STRATEGY_COOLDOWN_THRESHOLD = ' + extractScalar(parserSrc, 'STRATEGY_COOLDOWN_THRESHOLD') + ';',
    'const STRATEGY_COOLDOWN_MS = ' + extractScalar(parserSrc, 'STRATEGY_COOLDOWN_MS') + ';',
    'const strategyFailStreak = new Map();',
    extractFunction(parserSrc, 'noteStrategyResult'),
    extractConst(parserSrc, 'goMusicStrategy'),
  ];

  // tryGoMusicSwitch 由桩提供（真实实现在 [A] 段已单独验过）。
  // ⚠️ 桩必须读**共享对象**里的值：new Function 的函数体不是严格模式，
  // 在里面直接给外部 let 赋值会落到全局，桩闭包读到的还是 null（踩过）。
  const holder = { result: null };
  const sandbox = new Function('tryGoMusicSwitch', pieces.join('\n') + `
    return {
      goMusicStrategy: goMusicStrategy,
      noteStrategyResult: noteStrategyResult,
      streak: strategyFailStreak,
    };
  `)(function () { return Promise.resolve(holder.result); });

  /**
   * 模拟编排器：跑一次策略，再按 musicParser 里编排器的原样把结果喂给 noteStrategyResult。
   * 策略本身**不**调 noteStrategyResult —— 那是编排器的职责，不模拟就测不到计数。
   */
  async function runOnce(id, name, artists) {
    const r = await sandbox.goMusicStrategy.parse({ id, name, artists, quality: 'lossless' });
    sandbox.noteStrategyResult('goMusic', !!(r && r.url), !!(r && r.neutralFailure));
    return r;
  }
  const streakCount = () => {
    const s = sandbox.streak.get('goMusic');
    return s ? s.count : 0;
  };
  return { sandbox, holder, runOnce, streakCount };
}

/** 共享失败缓存与连败计数，必须顺序执行 */
test('[B] musicParser：中性标记透传 + 早退回放 + 连败计数', async (t) => {
  const { sandbox, holder, runOnce, streakCount } = makeParserSandbox();

  await t.test('B1 parse 透传 neutralFailure', async () => {
    holder.result = { url: '', neutralFailure: true, reason: 'artist-mismatch' };
    const out = await runOnce(101, 'x', ['a']);
    assert.equal(out && out.url, '', '实际 ' + JSON.stringify(out));
    assert.equal(out && out.neutralFailure, true);
  });

  await t.test('B2 中性失败后连败计数 = 0', () => {
    assert.equal(streakCount(), 0);
  });

  await t.test('B3 同一首歌第二次解析（命中失败缓存早退）仍回放成中性，且不计数', async () => {
    const out = await runOnce(101, 'x', ['a']);
    assert.equal(out && out.url, '', '实际 ' + JSON.stringify(out));
    assert.equal(out && out.neutralFailure, true);
    assert.equal(streakCount(), 0, '早退不能被当成真实故障');
  });

  await t.test('B4 连遇 3 首中性失败、每首解析两次 → 仍不进冷却', async () => {
    holder.result = { url: '', neutralFailure: true, reason: 'no-candidate' };
    await runOnce(102, 'y', ['b']); await runOnce(102, 'y', ['b']);
    await runOnce(103, 'z', ['c']); await runOnce(103, 'z', ['c']);
    assert.equal(streakCount(), 0);
    assert.equal(sandbox.streak.get('goMusic'), undefined, '不该有冷却标记');
  });

  await t.test('B5 真实故障（超时 → null）照常计数', async () => {
    holder.result = null;
    await runOnce(201, 'p', ['d']);
    assert.equal(streakCount(), 1);
  });

  await t.test('B6 真实故障第二次解析（早退）也要计数，不能因为「缓存里有」就豁免', async () => {
    await runOnce(201, 'p', ['d']);
    const st = sandbox.streak.get('goMusic');
    assert.ok(st && st.cooldownUntil > Date.now(), '实际 ' + JSON.stringify(st));
  });

  await t.test('B7 中性标记不会被早退冲掉成真实故障', async () => {
    holder.result = { url: '', neutralFailure: true };
    await runOnce(301, 'q', ['e']);
    const before = streakCount();
    await runOnce(301, 'q', ['e']);
    assert.equal(streakCount(), before);
  });

  await t.test('B8 中性不计数、真实故障计数（换一首没缓存过的）', async () => {
    holder.result = { url: '', neutralFailure: true };
    await runOnce(401, 'r', ['f']);
    const c1 = streakCount();
    holder.result = null;
    await runOnce(402, 's', ['g']);
    assert.equal(streakCount(), c1 + 1);
  });
});
