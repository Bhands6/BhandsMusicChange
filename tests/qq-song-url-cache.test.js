'use strict';
/**
 * 验证 QQ 直链缓存。
 *
 * 抽 `server/server.js` 的**真实** handleQQSongUrl + 缓存三件套跑，只桩掉上游
 * （qqMusicRequest）与 cookie 解析。
 *
 * 核心不变量：同一首歌第二次请求必须**不打上游**；而档位 / 媒体版本 / 登录态
 * 任一变化都必须缓存 miss —— 否则会串味，把 128k 的 vkey 喂给无损请求。
 * 失败结果**不**入缓存，否则一次上游抽风会被钉住 5 分钟。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { readSource, extractConst, extractFunction, extractScalar } = require('./lib/source');

const src = readSource('server/server.js');

/**
 * 每个测试拿一份全新沙箱（含独立的上游调用计数与登录态），互不干扰。
 * `state.musicKey` 置空即可模拟「掉登录态」—— cacheKey 的 login/guest 维度只看它。
 */
function makeSandbox() {
  const state = { uin: '123', musicKey: 'MK' };
  let upstreamCalls = 0;
  let upstreamImpl = null;

  function stubQQMusicRequest(payload) {
    upstreamCalls++;
    if (upstreamImpl) return upstreamImpl(payload);
    // 注意形状：handleQQSongUrl 传的是 { comm, req_0: { module, method, param } }，
    // param 在 req_0 里面，不在顶层（第一次写错踩过）。
    const p = payload.req_0.param;
    const firstFile = (p.filename && p.filename[0]) || 'M500x.mp3';
    return Promise.resolve({
      req_0: {
        data: {
          sip: ['https://ws.stream.qqmusic.qq.com/'],
          midurlinfo: [{ filename: firstFile, purl: firstFile + '?vkey=VK&guid=G&uin=123' }],
        },
      },
    });
  }

  const body = [
    'let qqCookie = "";',
    'const QQ_COOKIE_FILE = "";',
    // 真实源码
    'const QQ_SONG_URL_CACHE_TTL = ' + extractScalar(src, 'QQ_SONG_URL_CACHE_TTL') + ';',
    'const QQ_SONG_URL_CACHE_MAX = ' + extractScalar(src, 'QQ_SONG_URL_CACHE_MAX') + ';',
    'const qqSongUrlCache = new Map();',
    extractFunction(src, 'readQqSongUrlCache'),
    extractFunction(src, 'writeQqSongUrlCache'),
    extractFunction(src, 'saveQQCookie'),
    extractConst(src, 'QQ_QUALITY_CANDIDATE_TEMPLATES'),
    extractFunction(src, 'normalizeQualityPreference'),
    extractFunction(src, 'qualityCandidatesFrom'),
    extractFunction(src, 'handleQQSongUrl'),
    `return {
      handleQQSongUrl: handleQQSongUrl,
      saveQQCookie: saveQQCookie,
      cache: qqSongUrlCache,
      readCache: readQqSongUrlCache,
      writeCache: writeQqSongUrlCache,
      TTL: QQ_SONG_URL_CACHE_TTL,
      MAX: QQ_SONG_URL_CACHE_MAX,
      getCookie: function () { return qqCookie; },
    };`,
  ].join('\n');

  const api = new Function(
    'qqCookieObject', 'qqCookieUin', 'qqCookieMusicKey', 'qqCookiePlaybackKey',
    'qqMusicRequest', 'classifyQQPlaybackRestriction', 'normalizeCookieHeader', 'rawCookieFallback',
    'fs',
    body
  )(
    () => ({ uin: state.uin, musicKey: state.musicKey }),
    () => state.uin,
    () => state.musicKey,
    () => 'PK',
    stubQQMusicRequest,
    () => ({ category: 'vip' }),
    (c) => c,
    (c) => c,
    { writeFileSync: () => {} }   // 不碰真实磁盘
  );

  return {
    api,
    state,
    get upstreamCalls() { return upstreamCalls; },
    /** 让下一次上游返回「有 sip 但 purl 为空」→ 拿不到直链 */
    failNext() {
      upstreamImpl = () => Promise.resolve({
        req_0: { data: { sip: ['https://s/'], midurlinfo: [{ filename: 'x.mp3', purl: '' }] } },
      });
    },
  };
}

test('首次请求：打 1 次上游 + 写缓存 + 返回可用直链', async () => {
  const S = makeSandbox();
  const r = await S.api.handleQQSongUrl('MID_A', 'MM_A', 'lossless');
  assert.equal(S.upstreamCalls, 1);
  assert.match(r.url, /^https:\/\/ws\.stream\.qqmusic\.qq\.com\//);
  assert.equal(S.api.cache.size, 1);
});

test('同参数第二次：命中缓存，不打上游，url 与档位元信息一致', async () => {
  const S = makeSandbox();
  const first = await S.api.handleQQSongUrl('MID_A', 'MM_A', 'lossless');
  const again = await S.api.handleQQSongUrl('MID_A', 'MM_A', 'lossless');
  assert.equal(S.upstreamCalls, 1, '第二次不该再打上游');
  assert.equal(again.url, first.url);
  assert.equal(again.level, 'lossless');
});

test('换音质档位 → 必须 miss（否则 128k 的结果会喂给无损请求）', async () => {
  const S = makeSandbox();
  await S.api.handleQQSongUrl('MID_A', 'MM_A', 'lossless');
  await S.api.handleQQSongUrl('MID_A', 'MM_A', 'standard');
  assert.equal(S.upstreamCalls, 2);
  assert.equal(S.api.cache.size, 2, '不同档位各一条');
});

test('换 mediaMid → 必须 miss', async () => {
  const S = makeSandbox();
  await S.api.handleQQSongUrl('MID_A', 'MM_A', 'lossless');
  await S.api.handleQQSongUrl('MID_A', 'MM_B', 'lossless');
  assert.equal(S.upstreamCalls, 2);
});

test('登录态未变 → 仍命中缓存', async () => {
  const S = makeSandbox();
  await S.api.handleQQSongUrl('MID_A', 'MM_A', 'lossless');
  await S.api.handleQQSongUrl('MID_A', 'MM_A', 'lossless');
  assert.equal(S.upstreamCalls, 1);
  assert.equal(S.api.cache.size, 1);
});

test('登录态变化 → 必须 miss（vkey 与登录态强绑定）', async () => {
  const S = makeSandbox();
  await S.api.handleQQSongUrl('MID_A', 'MM_A', 'lossless');   // cacheKey 带 login
  assert.equal(S.upstreamCalls, 1);
  S.state.musicKey = '';                                      // 掉登录态 → guest
  await S.api.handleQQSongUrl('MID_A', 'MM_A', 'lossless');
  assert.equal(S.upstreamCalls, 2, '登录态变了必须重新取 vkey');
  assert.equal(S.api.cache.size, 2);
});

test('失败结果不写缓存（否则一次抽风会被钉住）', async () => {
  const S = makeSandbox();
  S.failNext();
  const r = await S.api.handleQQSongUrl('MID_FAIL', 'MM_F', 'lossless');
  assert.equal(r.playable, false);
  assert.equal(S.api.cache.size, 0, '失败不该写进缓存');
  await S.api.handleQQSongUrl('MID_FAIL', 'MM_F', 'lossless');
  assert.equal(S.upstreamCalls, 2, '第二次仍要打上游');
  assert.equal(S.api.cache.size, 0);
});

test('TTL 过期 → 读不到，且顺手从 Map 移除', () => {
  const S = makeSandbox();
  const key = 'MID_TTL|MM_T|lossless|login';
  S.api.writeCache(key, { url: 'https://old/' });
  assert.ok(S.api.readCache(key), '刚写入应能读到');
  // 把时间戳改老（超过 TTL）
  S.api.cache.set(key, { at: Date.now() - S.api.TTL - 1000, value: { url: 'https://old/' } });
  assert.equal(S.api.readCache(key), null);
  assert.equal(S.api.cache.has(key), false);
});

test('容量上限：超过 MAX 后淘汰最旧', () => {
  const S = makeSandbox();
  for (let i = 0; i < S.api.MAX + 5; i++) S.api.writeCache('k' + i, { url: 'u' + i });
  assert.equal(S.api.cache.size, S.api.MAX);
  assert.equal(S.api.cache.has('k0'), false, '最旧的应被淘汰');
  assert.ok(S.api.cache.has('k' + (S.api.MAX + 4)), '最新的应还在');
});

test('saveQQCookie 必须清空缓存（登录态变了 vkey 完全不同）', () => {
  const S = makeSandbox();
  S.api.writeCache('whatever', { url: 'https://x/' });
  S.api.saveQQCookie('uin=123; qm_keyst=MK');
  assert.equal(S.api.cache.size, 0);
  assert.equal(S.api.getCookie(), 'uin=123; qm_keyst=MK');
});

test('源码接线顺序：读缓存在音质归一化之后、写缓存在拿到 purl 之后', () => {
  const fnSrc = extractFunction(src, 'handleQQSongUrl');
  const iQuality = fnSrc.indexOf('normalizeQualityPreference(qualityPreference)');
  const iRead = fnSrc.indexOf('readQqSongUrlCache(cacheKey)');
  const iWrite = fnSrc.indexOf('writeQqSongUrlCache(cacheKey, ok)');
  const iPurl = fnSrc.indexOf('if (purl) {');
  assert.ok(iQuality > 0 && iRead > iQuality, `读缓存必须在音质归一化之后：q=${iQuality} read=${iRead}`);
  assert.ok(iPurl > 0 && iWrite > iPurl, `写缓存必须在 purl 判定之后：purl=${iPurl} write=${iWrite}`);
  assert.match(fnSrc, /uin && musicKey \? 'login' : 'guest'/, 'cacheKey 必须含登录态维度');
});
