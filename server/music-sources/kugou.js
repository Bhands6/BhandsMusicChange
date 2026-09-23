'use strict';

/**
 * 酷狗音源解析服务（免登录解析策略）
 * 移植自上游 Mineradio 2.2.0 kugou-api.js 的最小可用链路：
 *   搜索: songsearch.kugou.com/song_search_v2 （免登录）
 *   播放: m.kugou.com/app/i/getSongInfo.php    （免登录，标准音质 128k）
 *
 * 定位：作为 musicParser 的按歌名匹配解析策略（priority 2），
 * 与 gdmusic 策略同一模式 —— 严格校验歌名/歌手，宁可失败也不货不对版。
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { isCandidateDurationPlausible } = require('./durationProbe');

const KUGOU_SEARCH_URL = 'https://songsearch.kugou.com/song_search_v2';
const KUGOU_PLAY_MOBILE = 'https://m.kugou.com/app/i/getSongInfo.php';

const KUGOU_HEADERS = {
  Referer: 'https://www.kugou.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

/** 免登录搜索用的游客 mid（随机 md5，进程内复用） */
const GUEST_MID = crypto.createHash('md5').update(String(Date.now()) + Math.random()).digest('hex');

// ============================================================
// TTL 缓存（对齐上游策略：搜索 2 分钟 / 播放地址 15 分钟）
// ============================================================

function createTtlCache(maxEntries, ttlMs) {
  const store = new Map();
  return {
    get(key) {
      const hit = store.get(key);
      if (!hit || Date.now() - hit.at > ttlMs) {
        if (hit) store.delete(key);
        return null;
      }
      return hit.value;
    },
    set(key, value) {
      store.set(key, { at: Date.now(), value: value });
      if (store.size > maxEntries) {
        const oldest = store.keys().next().value;
        if (oldest !== undefined) store.delete(oldest);
      }
    }
  };
}

const searchCache = createTtlCache(120, 2 * 60 * 1000);
const playUrlCache = createTtlCache(240, 15 * 60 * 1000);

// ============================================================
// 文本归一化与匹配（与 gdmusic.js 同一套防"货不对版"规则）
// ============================================================

function normalizeText(text) {
  if (!text) return '';
  const stripped = String(text)
    .toLowerCase()
    .replace(/[（(【[].*?[)）】\]]/g, '')
    .replace(/[\s\-—_·・'"''""!！?？.,，。&＆+]/g, '');
  return stripped || String(text).toLowerCase().replace(/[\s\-—_·・'"''""!！?？.,，。&＆+]/g, '');
}

/**
 * 拆开聚合形态的歌手串。
 *
 * 同一首歌的歌手列表，网易云给的是「杨宗纬 / 杨旭 / 于冬然 / 范甲君」（斜杠），
 * 酷狗给的是「杨宗纬、杨旭、于冬然、范甲君」（顿号）—— 而 `normalizeText` 的
 * 清理字符集里**没有**斜杠和顿号，整串比对必然失败。
 * 2026-09-23「其实都没有」即此：真正的对应版本（4 人 Live，255s vs 期望 256s）
 * 因为分隔符不一致被歌手校验拒掉，只剩时长不符的独唱版可挑，最后 kugou 整个放弃。
 * 拆成单个歌手后逐个比对即可。
 */
function splitArtistNames(raw) {
  return String(raw || '')
    .split(/[\/、;；,，&＆|·]+/)
    .map(function (s) { return s.trim(); })
    .filter(Boolean);
}

function isNameMatched(expectedName, candidateName) {
  const expected = normalizeText(expectedName);
  const candidate = normalizeText(candidateName);
  if (!expected || !candidate) return false;
  if (expected === candidate) return true;
  // 包含式匹配仅限较长歌名（≥5 字）：短歌名（如"爱是什么"）同名前缀歌太多，
  // 单向 includes 极易匹配到不同歌曲（货不对版，歌词时间轴必然对不上）
  if (expected.length >= 5 && candidate.includes(expected)) return true;
  if (candidate.length >= 5 && expected.includes(candidate)) return true;
  return false;
}

/** 酷狗搜索结果里的歌名可能带 <em> 高亮标签和转义，需要清洗 */
function stripKugouHtml(text) {
  let raw = String(text || '').trim();
  if (/%u[0-9a-fA-F]{4}/.test(raw)) {
    raw = raw.replace(/%u([0-9a-fA-F]{4})/g, function (_, hex) {
      return String.fromCharCode(parseInt(hex, 16));
    });
  }
  if (/%[0-9a-fA-F]{2}/.test(raw) && !/[\u3400-\u9fff]/.test(raw)) {
    try { raw = decodeURIComponent(raw.replace(/\+/g, ' ')); } catch (e) { /* 保持原样 */ }
  }
  return raw.replace(/<[^>]+>/g, '').trim();
}

// ============================================================
// 酷狗搜索（免登录）
// ============================================================

/**
 * 搜索酷狗曲库
 * @returns {Promise<Array<{hash, albumId, name, artist, album, durationMs, privilege, fee}>>}
 */
async function kugouSearch(keywords, limit, timeoutMs) {
  const cacheKey = keywords.toLowerCase() + ':' + limit;
  const cached = searchCache.get(cacheKey);
  if (cached) return cached;

  const resp = await axios.get(KUGOU_SEARCH_URL, {
    timeout: timeoutMs || 8000,
    headers: KUGOU_HEADERS,
    params: {
      keyword: keywords,
      page: 1,
      pagesize: Math.max(1, Math.min(limit || 10, 20)),
      userid: '-1',
      clientver: '2000',
      platform: 'WebFilter',
      tag: 'em',
      filter: '2',
      iscorrection: '1',
      privilege_filter: '0',
      filter_ver: '2',
      appid: '1014',
      mid: GUEST_MID
    }
  });

  const json = resp && resp.data;
  if (!json || Number(json.status) !== 1 || !json.data || !Array.isArray(json.data.lists)) {
    throw new Error('酷狗搜索服务暂时不可用');
  }

  const list = json.data.lists.map(function (item) {
    const hash = item.FileHash || '';
    const name = stripKugouHtml(item.SongName || item.FileName || item.OriSongName || '');
    const artist = stripKugouHtml(item.SingerName || '');
    const privilege = Number(item.Privilege || 0) || 0;
    return {
      hash: hash,
      albumId: item.AlbumID != null ? String(item.AlbumID) : '0',
      name: name,
      artist: artist,
      album: stripKugouHtml(item.AlbumName || ''),
      durationMs: (Number(item.Duration) || 0) * 1000,
      privilege: privilege,
      fee: privilege >= 10 ? 1 : 0,
      playableGuess: privilege <= 8
    };
  }).filter(function (s) { return s.hash && s.name; });

  searchCache.set(cacheKey, list);
  return list;
}

// ============================================================
// 候选挑选（严格校验：歌名必须匹配，歌手能对上则加分）
// ============================================================

/** 变体标注（Live/翻唱/伴奏/乐器改编版等）——这类版本不能冒充原曲 */
const VARIANT_NAME_RE = /[(（【\[][^\)）\]]*(live|现场|演唱会|翻唱|cover|伴奏|remix|dj|混音|铃声|试听|纯音乐|acoustic|instrumental|karaoke|demo|翻录|重制|remaster|架子鼓|钢琴|吉他|古筝|小提琴|八音盒|口琴|尤克里里|纯享|重置|女声|男声|童声|合唱|对唱|降压|助眠)[^\)）\]]*[)）\]]/i;

/**
 * 候选名的括号后缀在原曲名里不存在 → 判为变体。
 *
 * 词表式 VARIANT_NAME_RE 永远补不全：2026-09-23「座位 (架子鼓版)」就是漏网的
 *（当时词表里没有"架子鼓"），它靠 12% 的时长容差被选中，白拿了一次 FLAC 地址。
 * 通用兜底：「后缀是否为原曲名的一部分」——
 *   原曲「座位」      vs 候选「座位 (架子鼓版)」→ 后缀不在原名里 → 变体
 *   原曲「晴天 (Live)」vs 候选「晴天 (Live)」   → 后缀在原名里   → 非变体
 * 用**原始**歌名比对（normalizeText 会把括号整段删掉，比不出来）。
 */
function hasUnmatchedVariantSuffix(expectedName, candidateName) {
  const segs = String(candidateName || '').match(/[（(【\[]([^)）】\]]*)[)）】\]]/g);
  if (!segs || !segs.length) return false;
  const expectedRaw = String(expectedName || '').toLowerCase();
  return segs.some(function (seg) {
    const inner = seg.replace(/[（(【\[\])）】\]]/g, '').trim().toLowerCase();
    if (!inner) return false;
    return expectedRaw.indexOf(inner) < 0;
  });
}

/**
 * 时长接近度的打分尺度（毫秒）：差值 0 → +1.0，差值越大线性递减到 0。
 * 必须连续打分：分段加分（如「±3s 内都是 +1」）会让"差 2 秒"和"差 0 秒"同分，
 * 然后被搜索顺序微调翻盘 —— 2026-09-20 实测「明天天明」正确版（海洋Bo 213s）
 * 就是这样以 4.03 输给了 2 秒偏差的翻唱版（山清 215s）4.05。
 */
const DURATION_PROXIMITY_MS = 12000;

function pickBestCandidate(candidates, expected) {
  let best = null;
  let bestScore = -1;

  for (let i = 0; i < candidates.length; i++) {
    const item = candidates[i];
    if (!item || !item.hash) continue;
    if (!isNameMatched(expected.name, item.name)) continue;

    // 时长硬校验：容差 max(8s, 6%)，比下游 durationProbe 的 max(5s, 4%) 宽 2 个百分点。
    // ⚠ 必须比 probe 严（原来是 max(10s, 12%)）：2026-09-23「座位」候选
    //   「座位 (架子鼓版)」225s vs 期望 208s（差 16.7s）被 12% 放行，这里选中后
    //   白拿了一次 FLAC 地址，紧接着被 probe 以「实际 225s vs 期望 208s」拒掉。
    //   收紧后此处直接 continue，不再为注定被拒的候选请求播放地址。
    if (!isCandidateDurationPlausible(item.durationMs, expected.durationMs)) continue;

    const candidateArtists = splitArtistNames(item.artist);
    let score;

    if (expected.artists.length === 0) {
      score = 2;
    } else if (!candidateArtists.length) {
      score = 1;
    } else {
      // 双方都拆成单个歌手后逐个比对（分隔符不一致见 splitArtistNames 注释）
      const artistMatched = expected.artists.some(function (name) {
        return splitArtistNames(name).some(function (expectName) {
          const normalized = normalizeText(expectName);
          if (!normalized) return false;
          return candidateArtists.some(function (candidateName) {
            const candidateNorm = normalizeText(candidateName);
            return !!candidateNorm && (
              candidateNorm.includes(normalized) || normalized.includes(candidateNorm)
            );
          });
        });
      });
      // 有歌手信息但对不上 → 拒绝（防止货不对版）
      if (!artistMatched) continue;
      score = 3;
    }

    // 变体强降权：即使免费，Live/翻唱/DJ 版/乐器改编版也不能优先于原曲（权重必须压过免费加分）。
    // ⚠ 但「时长与期望高度吻合」的变体必须豁免 —— 那说明原曲本身就是这个变体：
    //   网易云「其实都没有」歌名不带 Live，实际却是 4 人合作 Live 版（256s），
    //   酷狗上真正对应的正是「其实都没有 (Live)」255s。若无条件降权 2 分，
    //   它会输给时长差 15s 的另一版（241s），而那一版才是货不对版。
    const isVariantName = VARIANT_NAME_RE.test(item.name) || hasUnmatchedVariantSuffix(expected.name, item.name);
    const variantDurationMatches = expected.durationMs > 0 && item.durationMs > 0 &&
      Math.abs(expected.durationMs - item.durationMs) <= Math.max(2000, expected.durationMs * 0.02);
    if (isVariantName && !variantDurationMatches) score -= 2;

    // 免费曲目优先（VIP 曲目免登录大概率拿不到完整播放地址）
    if (item.playableGuess) score += 1;

    // 时长接近度：连续打分，保证「最接近原曲时长」的候选胜出
    // （不能用分段加分，见 DURATION_PROXIMITY_MS 注释里的实测翻盘案例）
    if (expected.durationMs > 0 && item.durationMs > 0) {
      const diff = Math.abs(expected.durationMs - item.durationMs);
      score += Math.max(0, 1 - diff / DURATION_PROXIMITY_MS);
    }

    // 搜索顺序靠前说明热度更高，但只能作为「完全同分」时的稳定排序：
    // 量级必须远小于时长接近度，否则会再次把正确答案翻盘
    score += (candidates.length - i) * 0.001;

    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }

  return best;
}

// ============================================================
// 播放地址解析（免登录 mobile 接口，标准音质）
// ============================================================

function kugouCloudKey(hash) {
  return crypto.createHash('md5').update(String(hash || '') + 'kgcloud').digest('hex');
}

function pickPlayUrl(json) {
  if (!json) return '';
  const pick = function (val) {
    if (Array.isArray(val)) {
      for (let i = 0; i < val.length; i++) {
        const found = pick(val[i]);
        if (found) return found;
      }
      return '';
    }
    const candidate = typeof val === 'string' ? val.replace(/\\\//g, '/').trim() : '';
    return /^https?:\/\/[^\s,]+$/i.test(candidate) ? candidate : '';
  };
  const data = json.data || {};
  return String(
    pick(json.url) || pick(json.play_url) || pick(json.backupUrl) || pick(json.backup_url) || pick(json.play_backup_url) ||
    pick(data.url) || pick(data.play_url) || pick(data.backupUrl) || pick(data.backup_url) || pick(data.play_backup_url) || ''
  ).replace(/\\\//g, '/').trim();
}

/**
 * 会员路径的播放地址解析：优先 extra2（FLAC）→ extra1（320k）→ 普通字段回退。
 * 带 token 的 getSongInfo 登录态响应里，extra1/extra2 为高品质地址（数组或字符串）。
 * @returns {{url: string, quality: string}} quality 为 flac/320/128
 */
function pickVipPlayHit(json) {
  if (!json) return { url: '', quality: '128' };
  const data = json.data || {};
  const fields = [
    { v: data.extra2, q: 'flac' }, { v: json.extra2, q: 'flac' },
    { v: data.extra1, q: '320' }, { v: json.extra1, q: '320' }
  ];
  for (let i = 0; i < fields.length; i++) {
    const v = fields[i].v;
    if (Array.isArray(v)) {
      for (let j = v.length - 1; j >= 0; j--) {
        const candidate = typeof v[j] === 'string' ? v[j].replace(/\\/g, '').trim() : '';
        if (/^https?:\/\/[^\s,]+$/i.test(candidate)) return { url: candidate, quality: fields[i].q };
      }
    } else if (typeof v === 'string') {
      const candidate = v.replace(/\\/g, '').trim();
      if (/^https?:\/\/[^\s,]+$/i.test(candidate)) return { url: candidate, quality: fields[i].q };
    }
  }
  return { url: pickPlayUrl(json), quality: '128' };
}

function pickVipPlayUrl(json) {
  return pickVipPlayHit(json).url;
}

// ============================================================
// 酷狗会员凭据（可选）：扫码登录（推荐）或手动配置。
// 配置方式（二选一，.music-sources.json 优先）：
//   1. 扫码登录（控制台「音源解析」→ 酷狗扫码登录）→ 自动写入 kugouCookie
//   2. 手动填  →  "kugouVipToken": "...", "kugouVipMid": "..."
//   3. 环境变量 →  KUGOU_VIP_TOKEN / KUGOU_VIP_MID
// 有登录态时播放地址走本地 KuGouMusicApi 服务的 /song/url（FLAC → 320 递减），
// 登录态失效或未配置时自动回退免登录 128k 路径。
// ============================================================
const PROJECT_ROOT_FOR_KUGOU = path.resolve(__dirname, '..', '..');
const kugouService = require('./kugouService');
const KUGOU_LOCAL_APP_DIR = path.join(PROJECT_ROOT_FOR_KUGOU, 'vendor', 'kugou-api');
let cachedVipCredentials = null;
let cachedVipCredentialsAt = 0;

function readKugouVipCredentials() {
  // 配置文件 5 分钟重读一次，扫码登录后无需等太久
  if (cachedVipCredentials && Date.now() - cachedVipCredentialsAt < 5 * 60 * 1000) return cachedVipCredentials;
  let token = process.env.KUGOU_VIP_TOKEN || '';
  let mid = process.env.KUGOU_VIP_MID || '';
  let cookie = '';
  try {
    const file = path.join(PROJECT_ROOT_FOR_KUGOU, '.music-sources.json');
    if (fs.existsSync(file)) {
      const cfg = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
      if (!token && cfg.kugouVipToken) token = String(cfg.kugouVipToken).trim();
      if (!mid && cfg.kugouVipMid) mid = String(cfg.kugouVipMid).trim();
      if (cfg.kugouCookie) cookie = String(cfg.kugouCookie).trim();
    }
  } catch (e) { /* 配置损坏按未配置处理 */ }
  if (cookie) {
    cachedVipCredentials = { cookie: cookie, token: token, mid: mid || GUEST_MID };
  } else if (token) {
    cachedVipCredentials = { cookie: 'token=' + token + (mid ? '; kg_mid=' + mid : ''), token: token, mid: mid || GUEST_MID };
  } else {
    cachedVipCredentials = null;
  }
  cachedVipCredentialsAt = Date.now();
  return cachedVipCredentials;
}

/** 档位 → 真实码率（bps）。前端音质按钮要用它显示「实际播放的档位」。 */
const KUGOU_QUALITY_BR = { flac: 999000, '320': 320000, '128': 128000 };

/**
 * 会员播放地址：走本地 KuGouMusicApi 服务的 /song/url（带登录态 Cookie）。
 * quality 从 FLAC 递减到 320；服务不可用或全部失败返回 null（回退免登录）。
 *
 * ⚠️ 返回 `{ url, quality }` 而不是裸 url：调用方需要知道**真实命中的档位**
 * （flac/320/128）才能把 `br` 如实回给前端。此前 br 写死 128000，
 * 拿到 FLAC 也报 128kbps，前端音质按钮就会显示错档。
 */
async function tryKugouLocalSongUrl(hash, albumId, timeoutMs) {
  const cred = readKugouVipCredentials();
  if (!cred || !cred.cookie) return null;
  const ready = await kugouService.ensureRunning({ appDir: KUGOU_LOCAL_APP_DIR, dataDir: KUGOU_LOCAL_APP_DIR });
  if (!ready.ok) return null;
  const qualities = ['flac', '320', '128'];
  for (let i = 0; i < qualities.length; i++) {
    const q = qualities[i];
    const j = await kugouService.apiGet(
      '/song/url?hash=' + encodeURIComponent(hash) + '&album_id=' + encodeURIComponent(albumId || '0') +
      '&quality=' + q + '&isFreePart=1',
      timeoutMs || 10000,
      { Cookie: cred.cookie }
    );
    if (!j) continue;
    const url = pickPlayUrl(j);
    if (url) {
      console.log('[KugouVIP] 会员音质命中: quality=' + q + ' url=' + url.slice(0, 80));
      return { url: url, quality: q };
    }
    // status=3 = **无播放权限**（响应里带 priv_status / auth_through / fail_process）。
    // 此时 flac / 320 / 128 三个档位会给出**完全相同**的结果，继续降档只是白打两次上游。
    // 2026-09-23 实测「冷冰冰」「Kung Fu Jumpstyle」：三档全 status=3，日志里三轮
    // 「无地址，降档重试」全是无用功（对照「六月的雨」是 status=1 且带 url）。
    // 这里直接跳出降档链，保留后面的免登录回退（那是另一个接口，权限判定不同）。
    if (Number(j.status) === 3) {
      console.log('[KugouVIP] 无播放权限（status=3），跳过降档');
      break;
    }
    console.log('[KugouVIP] quality=' + q + ' 无地址（status=' +
      (j.status != null ? j.status : '?') + '），降档重试');
  }
  console.log('[KugouVIP] 会员路径全部失败，回退免登录 128k');
  return null;
}

/**
 * 取酷狗播放地址。
 * @returns {Promise<{url: string, quality: string} | null>} quality 为 flac/320/128
 */
async function kugouPlayUrlByHash(hash, albumId, timeoutMs) {
  const cacheKey = hash.toLowerCase();
  const cached = playUrlCache.get(cacheKey);
  if (cached !== null) return cached;

  // ① 会员路径：本地 KuGouMusicApi 服务 + 扫码登录态（FLAC → 320）
  try {
    const localHit = await tryKugouLocalSongUrl(hash, albumId, timeoutMs);
    if (localHit && localHit.url) {
      playUrlCache.set(cacheKey, localHit);
      return localHit;
    }
  } catch (e) { /* 会员路径失败回退免登录 */ }

  // ② 直连官方带 token（旧手动配置路径，保留兼容）
  const vip = readKugouVipCredentials();
  if (vip && vip.token && !vip.cookie) {
    try {
      const resp = await axios.get(KUGOU_PLAY_MOBILE, {
        timeout: timeoutMs || 8000,
        headers: { Referer: 'https://m.kugou.com/', 'User-Agent': KUGOU_HEADERS['User-Agent'] },
        params: {
          cmd: 'playInfo',
          hash: hash,
          key: kugouCloudKey(hash),
          album_id: albumId || '0',
          pid: '1',
          forceDown: '0',
          vip: '65530',
          mid: vip.mid,
          token: vip.token
        }
      });
      const json = resp && resp.data;
      const vipHit = pickVipPlayHit(json);
      if (json && Number(json.status) === 1 && vipHit.url) {
        playUrlCache.set(cacheKey, vipHit);
        return vipHit;
      }
    } catch (e) { /* 回退免登录 */ }
  }

  // ③ 免登录回退：标准音质 128k
  const resp = await axios.get(KUGOU_PLAY_MOBILE, {
    timeout: timeoutMs || 8000,
    headers: { Referer: 'https://m.kugou.com/', 'User-Agent': KUGOU_HEADERS['User-Agent'] },
    params: {
      cmd: 'playInfo',
      hash: hash,
      key: kugouCloudKey(hash),
      album_id: albumId || '0',
      pid: '1',
      forceDown: '0',
      vip: '65530'
    }
  });

  const json = resp && resp.data;
  const url = pickPlayUrl(json);
  if (json && Number(json.status) === 1 && url) {
    // 免登录路径固定标准音质
    const hit = { url: url, quality: '128' };
    playUrlCache.set(cacheKey, hit);
    return hit;
  }
  return null;
}

// ============================================================
// 主入口：与 gdmusic.js 的 parseFromGDMusic 同一契约
// ============================================================

/**
 * 「这首歌酷狗确实没有」类失败的统一返回：搜索无结果 / 无匹配候选 / 拿到 hash 但无播放权限。
 *
 * 刻意**不返回 null**，而是带上 reason 标记 —— 编排器据此把它归为「中性失败」，
 * 不计入策略冷却。否则连遇几首无版权/无资源的歌，完全正常的 kugou 会被打进
 * 5 分钟冷却（2026-09-23 实测：「冷冰冰」+「Kung Fu Jumpstyle」两首就触发，
 * 之后 5 分钟内 kugou 被排到队尾，白丢会员 FLAC 的先手优势）。
 * 真正的服务故障（搜索接口报错 / 超时 / 异常）仍然返回 null，照常计冷却。
 */
function unavailableResult() {
  return { url: '', reason: 'unavailable' };
}

/**
 * 从酷狗解析音乐 URL
 * @param {Object} params
 * @param {number} params.id - 歌曲 ID（仅日志用）
 * @param {string} params.name - 歌曲名称
 * @param {string[]} params.artists - 歌手列表
 * @param {string} [params.album] - 专辑名
 * @param {number} [params.duration] - 时长(毫秒)
 * @param {number} [params.timeout] - 超时(ms)，默认 15000
 * @returns {Promise<{url: string, source: string, br: number, quality: string} | {url: '', reason: 'unavailable'} | null>}
 */
async function parseFromKugou(params) {
  const name = params.name || '';
  const artists = params.artists || [];
  const timeout = params.timeout || 15000;

  const searchQuery = (name + ' ' + artists.join(' ')).trim();
  if (!searchQuery || searchQuery.length < 2) {
    console.error('[Kugou] 搜索查询过短:', { name: name, artists: artists });
    return null;
  }

  const deadline = Date.now() + timeout;

  try {
    console.log('[Kugou] 开始搜索:', searchQuery);

    const list = await kugouSearch(searchQuery, 10, Math.min(8000, deadline - Date.now()));
    if (!list.length) {
      console.log('[Kugou] 搜索结果为空');
      return unavailableResult();
    }

    const matched = pickBestCandidate(list, { name: name, artists: artists, durationMs: params.duration || 0 });
    if (!matched) {
      console.log('[Kugou] 搜索结果与原曲不匹配，已拒绝（避免货不对版）');
      return unavailableResult();
    }

    const remaining = deadline - Date.now();
    if (remaining < 500) {
      console.warn('[Kugou] 剩余时间不足，放弃播放地址请求');
      return null;
    }

    const hit = await kugouPlayUrlByHash(matched.hash, matched.albumId, Math.min(8000, remaining));
    if (!hit || !hit.url) {
      console.log('[Kugou] 未获取到有效播放地址 (hash:', matched.hash, ')');
      return unavailableResult();
    }

    console.log('[Kugou] 解析成功:', matched.name, '-', matched.artist, '(quality=' + hit.quality + ')');
    return {
      url: hit.url,
      source: 'kugou',
      // 如实回报命中档位对应的码率（此前写死 128000，拿到 FLAC 也报 128k，
      // 前端音质按钮会显示错档位）
      br: KUGOU_QUALITY_BR[hit.quality] || 128000,
      quality: hit.quality
    };
  } catch (error) {
    console.error('[Kugou] 解析异常:', error.message);
    return null;
  }
}

module.exports = { parseFromKugou, pickVipPlayUrl, readKugouVipCredentials };
