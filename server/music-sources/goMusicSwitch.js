'use strict';

/**
 * go-music-api 智能换源策略（移植自 Bhands_Web 的 goMusicSwitch.ts，参数按官方 Swagger 校正）
 *
 * 独立 Go 服务（Docker 部署，默认 http://127.0.0.1:8080）：
 *   GET /api/v1/music/switch?name=&artist=&source=&duration=
 *        → 并发搜多平台，按「歌名+歌手匹配 × 时长差」打分，200 时**直接返回 model.Song**（不包 Response）
 *   GET /api/v1/music/url?id=&source=
 *        → 目标平台裸直链，返回 handler.Response（{code,data:{url,...},msg}）
 *
 * 定位：外站链路的**高质量兜底**——gdmusic 上游抖动 / LX 脚本缺失时，用酷狗/酷我/QQ/咪咕的
 * 官方真实音源替代（远优于 unblock 的 128k 错配）。
 *
 * 与 Web 版的三处差异（按 Swagger 修正 + 桌面版适配）：
 *  ① switch 补上必填的 `source` 参数（= netease，即"当前失效的源"，服务端会跳过它再换源）；
 *  ② url 接口官方文档没有 `quality` 参数，仍然发送只为向前兼容（服务端忽略未知参数）；
 *  ③ 新增**服务健康记忆**：服务离线时短路 3 分钟，避免每首歌都白等超时
 *     （桌面版这个服务是可选的，Docker 没开时不能拖慢解析）。
 *
 * 配置：环境变量 GO_MUSIC_API_URL（留空则用默认 http://127.0.0.1:8080）。
 * 2026-09-23：`.music-sources.json` 的 `goMusicApiUrl` 配置项已移除（面板入口早先已删，
 * 该键实际已无人能改），服务地址现在只由环境变量决定。
 */

const DEFAULT_BASE_URL = 'http://127.0.0.1:8080';

/**
 * 超时预算。上游 /switch 会对多个平台并发搜索，耗时受**平台网络状况**影响很大：
 * 实测同一台机器，网络好时 ~1.8s，网络差时 9.6~10.8s（2026-09-21）。
 * 所以默认放宽到 8s，并允许用环境变量调。
 */
function envTimeout(key, def) {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : def;
}
const SWITCH_TIMEOUT = () => envTimeout('BHANDSMUSIC_GO_MUSIC_SWITCH_TIMEOUT_MS', 8000);
const URL_TIMEOUT = () => envTimeout('BHANDSMUSIC_GO_MUSIC_URL_TIMEOUT_MS', 6000);

/**
 * 判断异常是不是「超时」。
 * 超时和「服务不在」是两回事：服务可能好好活着，只是平台搜索慢。
 */
function isTimeoutError(e) {
  return !!e && (e.name === 'TimeoutError' || e.name === 'AbortError');
}

/**
 * 只接受这些平台的换源结果（对齐 Web 版实测结论）：
 *  - netease：跳过——官方自己更快，换源没意义
 *  - bilibili / qianqian / soda / joox / fivesing / jamendo：不在白名单，CDN 与防盗链情况未经实测
 */
const ALLOWED_PLATFORMS = ['qq', 'kugou', 'kuwo', 'migu'];

/**
 * 失败缓存：某曲不可换源时防反复打（5 分钟）。value = { at, neutral }。
 *
 * neutral 必须一起记：5 分钟里同一首歌再被解析时走的是**早退**分支，
 * 那次也得知道「上次是中性失败」，否则中性豁免只生效一次（第二次早退返回 null
 * 会被 musicParser 当成真实故障计数）。
 */
const failedCache = new Map();
const FAILED_TTL = 5 * 60 * 1000;

function markFailed(cacheKey, neutral) {
  failedCache.set(cacheKey, { at: Date.now(), neutral: !!neutral });
}

/** @returns {{at: number, neutral: boolean} | null} */
function readFailed(cacheKey) {
  const entry = failedCache.get(cacheKey);
  if (!entry) return null;
  if (Date.now() - entry.at >= FAILED_TTL) {
    failedCache.delete(cacheKey);
    return null;
  }
  return entry;
}

/** 服务健康记忆：连不上时短路一段时间，别让每首歌都白等 */
let serviceDownUntil = 0;
const SERVICE_DOWN_COOLDOWN_MS = 3 * 60 * 1000;

/** 解析服务地址：显式传入 > 环境变量 > 默认 */
function resolveBaseUrl(explicit) {
  const raw = explicit || process.env.GO_MUSIC_API_URL || DEFAULT_BASE_URL;
  return String(raw).replace(/\/+$/, '');
}

/**
 * 「这首歌在 goMusic 侧没有可用资源」的中性失败标记。
 *
 * 与「服务故障」严格区分：策略健康计数只看后者，否则连遇几首无版权 / 同名错配的歌，
 * 就能把完全正常的策略打进 5 分钟冷却（排到队尾，白丢先手）。
 * 调用方（musicParser 的 goMusicStrategy）会把它转成 { url:'', neutralFailure:true }，
 * 并让失败缓存记住这个标记 —— 60 秒内重播同一首歌时早退也要回放成中性。
 */
function unavailableResult(reason) {
  return { url: '', neutralFailure: true, reason: reason || 'unavailable' };
}

function isServiceDown() {
  return Date.now() < serviceDownUntil;
}

function markServiceDown(reason) {
  serviceDownUntil = Date.now() + SERVICE_DOWN_COOLDOWN_MS;
  console.warn(
    '[GoMusic] 换源服务不可用，冷却 ' + (SERVICE_DOWN_COOLDOWN_MS / 60000) + ' 分钟：' + reason
  );
}

/**
 * 手动重置健康记忆。
 * 2026-09-23 起 goMusicApiUrl 配置项已移除，唯一的调用方是
 * `GET /api/parse/go-music/status` 探活成功后调用（让服务恢复可用不用等冷却到期）。
 */
function resetServiceHealth() {
  serviceDownUntil = 0;
}

async function getJson(url, timeout) {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(timeout) });
    if (!resp.ok) return null;
    return await resp.json();
  } catch (e) {
    throw e;
  }
}

/**
 * 音质档位 → go-music-api 的 quality 参数。
 * 官方文档未列出该参数（服务端自行取该平台可用最高档），发送只为向前兼容。
 */
const LOSSLESS_TIERS = new Set(['lossless', 'hires', 'jymaster']);
function qualityOf(quality) {
  return LOSSLESS_TIERS.has(quality) ? '999' : '320';
}

/** 从 switch 的返回里取出候选（兼容 model.Song 直出 / {code,data} 包装两种形状） */
function pickCandidate(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.source && payload.id) return payload;                       // model.Song 直出
  if (payload.data && payload.data.source && payload.data.id) return payload.data; // {code,data}
  return null;
}

/**
 * 智能换源解析
 * @param {Object} params
 * @param {number|string} params.id - 网易云歌曲 ID（仅日志用；换源按歌名+歌手）
 * @param {string} params.name - 歌曲名称
 * @param {string[]} params.artists - 歌手列表
 * @param {number} [params.duration] - 时长（毫秒）
 * @param {string} [params.quality] - 音质档位
 * @returns {Promise<{url: string, source: string, br: number, size: number}
 *   | {url: '', neutralFailure: true} | null>}
 *   null = 真实故障（超时 / 服务不可用），计入策略健康；
 *   `{url:'', neutralFailure:true}` = 这首歌在 goMusic 侧没有可用资源，**不计入**策略健康。
 */
async function tryGoMusicSwitch(params) {
  const name = params.name || '';
  if (!name) return null;

  const base = resolveBaseUrl();
  const br = qualityOf(params.quality);
  const cacheKey = 'go_' + params.id + '_' + br;

  // 早退要**回放**上次的「中性」标记（见 failedCache 注释），
  // 否则 5 分钟内重播同一首无版权歌时，这次早退会被算成真实故障。
  const failed = readFailed(cacheKey);
  if (failed) return failed.neutral ? unavailableResult('cached') : null;
  if (isServiceDown()) return null;

  const artist = (params.artists || [])[0] || '';
  const durationSec = params.duration ? Math.round(Number(params.duration) / 1000) : 0;

  // ① 换源：拿最佳候选。source=netease 表示"当前失效的源"，服务端会跳过它
  const q =
    'name=' + encodeURIComponent(name) +
    (artist ? '&artist=' + encodeURIComponent(artist) : '') +
    '&source=netease' +
    (durationSec ? '&duration=' + durationSec : '');

  let sw;
  try {
    sw = await getJson(base + '/api/v1/music/switch?' + q, SWITCH_TIMEOUT());
  } catch (e) {
    if (isTimeoutError(e)) {
      // 超时 ≠ 服务不可用：只记本次失败（5 分钟内不再试这首），不要把服务冷却掉。
      // 但超时**不是**中性失败 —— 它是我们这边等不到响应，属于真实故障，照常计数。
      console.warn('[GoMusic] 换源搜索超时（' + SWITCH_TIMEOUT() + 'ms），本次跳过；服务未标记为不可用');
      markFailed(cacheKey, false);
      return null;
    }
    markServiceDown((e && e.message) || e);
    return null;
  }

  // ①' 换源没找到候选：这首歌在聚合的平台里确实搜不到 → 中性失败
  const cand = pickCandidate(sw);
  if (!cand) {
    markFailed(cacheKey, true);
    return unavailableResult('no-candidate');
  }

  // ② 平台白名单过滤：搜到了但我们不支持的平台，等于没有可用资源 → 中性失败
  const platform = String(cand.source || '').toLowerCase();
  if (!ALLOWED_PLATFORMS.includes(platform)) {
    console.log('[GoMusic] 换源命中平台 ' + platform + ' 不在白名单，跳过');
    markFailed(cacheKey, true);
    return unavailableResult('platform-not-allowed');
  }

  // ②' 歌手一致性校验：候选歌手与期望歌手无交集 → 同名错配
  //（实战：Pretty Ugly 匹配到 Saint Vane 的同名歌，score 0.73 放出去用户会听到"别人的歌"）
  // 包含式比较兼容「i-dle」vs「(G)I-DLE」这类写法差异
  const candArtist = String(cand.artist || '').trim().toLowerCase();
  const wantArtists = (params.artists || []).map(function (a) {
    return String(a).trim().toLowerCase();
  }).filter(Boolean);
  if (wantArtists.length && candArtist && !wantArtists.some(function (a) {
    return candArtist.includes(a) || a.includes(candArtist);
  })) {
    // 同名错配 = 这首歌没有**对的**版本可换 → 中性失败（用户点名的场景）：
    // 不豁免的话，连遇两首同名错配就能把 goMusic 打进 5 分钟冷却。
    console.log('[GoMusic] 候选歌手不一致（' + cand.artist + '），丢弃避免货不对版');
    markFailed(cacheKey, true);
    return unavailableResult('artist-mismatch');
  }

  // ③ 取直链
  let u;
  try {
    u = await getJson(
      base + '/api/v1/music/url?source=' + encodeURIComponent(platform) +
      '&id=' + encodeURIComponent(cand.id) +
      '&quality=' + br,
      URL_TIMEOUT()
    );
  } catch (e) {
    if (isTimeoutError(e)) {
      // 同 ①：超时是真实故障，不算中性
      console.warn('[GoMusic] 取直链超时（' + URL_TIMEOUT() + 'ms），本次跳过；服务未标记为不可用');
      markFailed(cacheKey, false);
      return null;
    }
    markServiceDown((e && e.message) || e);
    return null;
  }

  // ③' 有候选但拿不到直链（该平台无版权 / 无该档位）→ 中性失败
  const data = (u && u.data) || null;
  const direct = (data && data.url) || (u && u.url) || '';
  if (!direct || !/^https?:\/\//i.test(direct)) {
    markFailed(cacheKey, true);
    return unavailableResult('no-direct-url');
  }

  console.log('[GoMusic] 换源成功, 平台:', platform, '原曲:', name, '-', artist);

  return {
    url: direct,
    source: 'gomusic-' + platform,
    // model.Song.bitrate 单位 kbps
    br: (Number(data && data.bitrate) || 0) * 1000 || 320000,
    // size 供 musicParser 的垫片硬拒绝使用（model.Song.size，字节）
    size: Number(data && data.size) || 0
  };
}

/**
 * 服务身份探活（约 175ms）。给 UI「测试连接」与内置服务托管共用。
 *
 * 用两个**廉价**端点判定，而不是 /switch：
 *  - `/api/v1/system/cookies`：200 + JSON 对象（27ms）
 *  - `/api/v1/music/url?source=netease&id=1`：JSON 且含数字 code（147ms，handler.Response 形状）
 *
 * ⚠️ 不要用 /switch 做探活：它对不存在的歌做多平台搜索，实测 8.7~10.8s，
 * 会把「服务正常但平台慢」误报成连不上。
 *
 * 两个端点都要过，是因为 8080 是常见端口，单看「200 + JSON」容易把占用该端口的
 * 无关服务误认成换源服务。
 *
 * @param {string} [baseUrl]
 * @returns {Promise<{reachable: boolean, baseUrl: string, elapsedMs: number, status?: number, error?: string}>}
 */
async function checkService(baseUrl) {
  const base = resolveBaseUrl(baseUrl);
  const started = Date.now();
  const done = (extra) => Object.assign({ baseUrl: base, elapsedMs: Date.now() - started }, extra);

  try {
    const c = await fetch(base + '/api/v1/system/cookies', { signal: AbortSignal.timeout(2500) });
    if (c.status !== 200) return done({ reachable: false, status: c.status, error: '不是换源服务（cookies 端点返回 ' + c.status + '）' });
    if (!(c.headers.get('content-type') || '').includes('application/json')) {
      return done({ reachable: false, status: c.status, error: '不是换源服务（cookies 端点不是 JSON）' });
    }
    const cb = await c.json().catch(() => null);
    if (!cb || typeof cb !== 'object' || Array.isArray(cb)) {
      return done({ reachable: false, status: c.status, error: '不是换源服务（cookies 端点返回结构不符）' });
    }

    const u = await fetch(base + '/api/v1/music/url?source=netease&id=1', { signal: AbortSignal.timeout(3000) });
    if (!(u.headers.get('content-type') || '').includes('application/json')) {
      return done({ reachable: false, status: u.status, error: '不是换源服务（url 端点不是 JSON）' });
    }
    const ub = await u.json().catch(() => null);
    if (!ub || typeof ub.code !== 'number') {
      return done({ reachable: false, status: u.status, error: '不是换源服务（url 端点缺少 code 字段）' });
    }

    return done({ reachable: true, status: 200 });
  } catch (e) {
    return done({ reachable: false, error: (e && e.message) || String(e) });
  }
}

/** 兼容旧名（server.js 的「测试连接」接口用的就是它） */
const probeService = checkService;

module.exports = {
  tryGoMusicSwitch,
  checkService,
  probeService,
  resolveBaseUrl,
  resetServiceHealth,
  ALLOWED_PLATFORMS,
  DEFAULT_BASE_URL
};
