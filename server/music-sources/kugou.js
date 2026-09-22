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

/** 变体标注（Live/翻唱/伴奏等括号后缀）——这类版本不能冒充原曲 */
const VARIANT_NAME_RE = /[(（【\[][^\)）\]]*(live|翻唱|cover|伴奏|dj|remix|现场|演唱会|铃声|试听|纯音乐|降压|助眠)[^\)）\]]*[)）\]]/i;

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

    // 时长硬校验：偏差超过 max(10s, 12%) 直接拒绝——不同版本（Live/remix/
    // 合作版）时长差异大，音频与原曲歌词时间轴必然对不上（货不对版）
    if (expected.durationMs > 0 && item.durationMs > 0) {
      const durationDiff = Math.abs(expected.durationMs - item.durationMs);
      if (durationDiff > Math.max(10000, expected.durationMs * 0.12)) continue;
    }

    const candidateArtist = normalizeText(item.artist);
    let score;

    if (expected.artists.length === 0) {
      score = 2;
    } else if (!candidateArtist) {
      score = 1;
    } else {
      const artistMatched = expected.artists.some(function (name) {
        const normalized = normalizeText(name);
        return !!normalized && (
          candidateArtist.includes(normalized) || normalized.includes(candidateArtist)
        );
      });
      // 有歌手信息但对不上 → 拒绝（防止货不对版）
      if (!artistMatched) continue;
      score = 3;
    }

    // 变体强降权：即使免费，Live/翻唱/DJ 版也不能优先于原曲（权重必须压过免费加分）
    if (VARIANT_NAME_RE.test(item.name)) score -= 2;

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
 */
function pickVipPlayUrl(json) {
  if (!json) return '';
  const data = json.data || {};
  const fields = [data.extra2, json.extra2, data.extra1, json.extra1];
  for (let i = 0; i < fields.length; i++) {
    const v = fields[i];
    if (Array.isArray(v)) {
      for (let j = v.length - 1; j >= 0; j--) {
        const candidate = typeof v[j] === 'string' ? v[j].replace(/\\/g, '').trim() : '';
        if (/^https?:\/\/[^\s,]+$/i.test(candidate)) return candidate;
      }
    } else if (typeof v === 'string') {
      const candidate = v.replace(/\\/g, '').trim();
      if (/^https?:\/\/[^\s,]+$/i.test(candidate)) return candidate;
    }
  }
  return pickPlayUrl(json);
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

/**
 * 会员播放地址：走本地 KuGouMusicApi 服务的 /song/url（带登录态 Cookie）。
 * quality 从 FLAC 递减到 320；服务不可用或全部失败返回 ''（回退免登录）。
 */
async function tryKugouLocalSongUrl(hash, albumId, timeoutMs) {
  const cred = readKugouVipCredentials();
  if (!cred || !cred.cookie) return '';
  const ready = await kugouService.ensureRunning({ appDir: KUGOU_LOCAL_APP_DIR, dataDir: KUGOU_LOCAL_APP_DIR });
  if (!ready.ok) return '';
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
      return url;
    }
    console.log('[KugouVIP] quality=' + q + ' 无地址' + (j && j.error_code ? '（error_code=' + j.error_code + '）' : '') + '，降档重试');
  }
  console.log('[KugouVIP] 会员路径全部失败，回退免登录 128k');
  return '';
}

async function kugouPlayUrlByHash(hash, albumId, timeoutMs) {
  const cacheKey = hash.toLowerCase();
  const cached = playUrlCache.get(cacheKey);
  if (cached !== null) return cached;

  // ① 会员路径：本地 KuGouMusicApi 服务 + 扫码登录态（FLAC → 320）
  try {
    const localUrl = await tryKugouLocalSongUrl(hash, albumId, timeoutMs);
    if (localUrl) {
      playUrlCache.set(cacheKey, localUrl);
      return localUrl;
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
      const vipUrl = pickVipPlayUrl(json);
      if (json && Number(json.status) === 1 && vipUrl) {
        playUrlCache.set(cacheKey, vipUrl);
        return vipUrl;
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
    playUrlCache.set(cacheKey, url);
    return url;
  }
  return '';
}

// ============================================================
// 主入口：与 gdmusic.js 的 parseFromGDMusic 同一契约
// ============================================================

/**
 * 从酷狗解析音乐 URL
 * @param {Object} params
 * @param {number} params.id - 歌曲 ID（仅日志用）
 * @param {string} params.name - 歌曲名称
 * @param {string[]} params.artists - 歌手列表
 * @param {string} [params.album] - 专辑名
 * @param {number} [params.duration] - 时长(毫秒)
 * @param {number} [params.timeout] - 超时(ms)，默认 15000
 * @returns {Promise<{url: string, source: string, br: number} | null>}
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
      return null;
    }

    const matched = pickBestCandidate(list, { name: name, artists: artists, durationMs: params.duration || 0 });
    if (!matched) {
      console.log('[Kugou] 搜索结果与原曲不匹配，已拒绝（避免货不对版）');
      return null;
    }

    const remaining = deadline - Date.now();
    if (remaining < 500) {
      console.warn('[Kugou] 剩余时间不足，放弃播放地址请求');
      return null;
    }

    const url = await kugouPlayUrlByHash(matched.hash, matched.albumId, Math.min(8000, remaining));
    if (!url) {
      console.log('[Kugou] 未获取到有效播放地址 (hash:', matched.hash, ')');
      return null;
    }

    console.log('[Kugou] 解析成功:', matched.name, '-', matched.artist);
    return {
      url: url,
      source: 'kugou',
      br: 128000
    };
  } catch (error) {
    console.error('[Kugou] 解析异常:', error.message);
    return null;
  }
}

module.exports = { parseFromKugou, pickVipPlayUrl, readKugouVipCredentials };
