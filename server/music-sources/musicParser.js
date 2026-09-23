'use strict';

/**
 * 音乐解析策略编排器
 * 管理多个音源解析策略，按优先级依次尝试
 */

const { parseFromGDMusic } = require('./gdmusic');
const { parseFromUnblockMusic } = require('./unblockMusic');
const { parseFromLxMusic, listRunners } = require('./lxMusicRunner');
const { parseFromKugou, readKugouVipCredentials } = require('./kugou');
const { tryGoMusicSwitch } = require('./goMusicSwitch');
const { probeAudio, acceptProbe } = require('./durationProbe');

// ============================================================
// 缓存配置
// ============================================================

/** 成功缓存时间：10 分钟（对齐 Bhands_Web）
 *  外站直链与网易 URL 都带时效 token，缓存过长会供出已过期死链；
 *  原 30 分钟偏长，播放失败重试依赖前端 fresh 绕过。 */
const SUCCESS_CACHE_TTL = 10 * 60 * 1000;

/** 失败缓存时间：1 分钟 */
const FAILED_CACHE_TTL = 1 * 60 * 1000;

/** 成功缓存 Map: key = songId, value = { data, sources, time } */
const successCache = new Map();

/**
 * 失败缓存 Map: key = "songId_strategyName", value = { at, neutral }
 *
 * neutral 必须存下来：策略在**早退**（命中失败缓存）时也要能告诉编排器
 * 「这次是中性失败」。否则同一首歌 60 秒内被解析两次（重播 / 切音质重试），
 * 第一次中性（不计数）、第二次早退返回 null 被当成**真实故障**计数 ——
 * 两首无版权的歌各解析两次就够把完全正常的策略打进 5 分钟冷却，
 * noteStrategyResult 的中性豁免等于白做。
 */
const failedCache = new Map();

// ============================================================
// 缓存管理
// ============================================================

/**
 * 成功缓存 key = 歌曲 id + 音质 + 排序后的音源列表。
 * ⚠️ quality 必须进 key（对齐 Bhands_Web 的 id_quality_vip_cookieMD5）：此前漏了这一维，
 * 用户切音质后第三方源在 10 分钟内仍命中旧音质结果（表现为「切了无损还是 128k」）。
 * 官方音源（/api/song/url）不走这层缓存，所以只有第三方路径会中招。
 */
function getSuccessCacheKey(id, sources, quality) {
  return String(id) + '_' + String(quality || '') + '_' + (sources || []).sort().join(',');
}

function getSuccessCache(id, sources, quality) {
  const key = getSuccessCacheKey(id, sources, quality);
  const cached = successCache.get(key);
  if (!cached) return null;

  // 检查是否过期
  if (Date.now() - cached.time > SUCCESS_CACHE_TTL) {
    successCache.delete(key);
    return null;
  }

  // 检查音源配置是否一致
  const cachedSources = (cached.sources || []).slice().sort();
  const currentSources = (sources || []).slice().sort();
  if (JSON.stringify(cachedSources) !== JSON.stringify(currentSources)) {
    successCache.delete(key);
    return null;
  }

  console.log('[MusicParser] 命中成功缓存, 歌曲:', id);
  return cached.data;
}

function setSuccessCache(id, data, sources, quality) {
  const key = getSuccessCacheKey(id, sources, quality);
  successCache.set(key, {
    data: data,
    sources: sources || [],
    time: Date.now()
  });
}

function isInFailedCache(id, strategyName) {
  return !!readFailedCache(id, strategyName);
}

/**
 * 读失败缓存，带上「当时是不是中性失败」。
 *
 * 给策略的早退分支用：中性失败要**原样回放**成 { url:'', neutralFailure:true }，
 * 而不是简单的 null（见 failedCache 的注释）。
 * @returns {{neutral: boolean} | null}
 */
function readFailedCache(id, strategyName) {
  const key = String(id) + '_' + strategyName;
  const entry = failedCache.get(key);
  if (!entry) return null;

  if (Date.now() - entry.at > FAILED_CACHE_TTL) {
    failedCache.delete(key);
    return null;
  }

  return { neutral: !!entry.neutral };
}

/**
 * 记一次失败缓存。
 * @param {boolean} [neutral] 这次失败是否与策略健康无关（版权/无资源等）。
 *   必须与 noteStrategyResult 的判定保持一致，否则早退时会错误计数。
 */
function addFailedCache(id, strategyName, neutral) {
  const key = String(id) + '_' + strategyName;
  failedCache.set(key, { at: Date.now(), neutral: !!neutral });
}

function clearCacheForSong(id) {
  // 清除成功缓存
  for (const key of successCache.keys()) {
    if (key.startsWith(String(id) + '_')) {
      successCache.delete(key);
    }
  }

  // 清除失败缓存
  for (const key of failedCache.keys()) {
    if (key.startsWith(String(id) + '_')) {
      failedCache.delete(key);
    }
  }
}

// 定期清理过期缓存
setInterval(function () {
  const now = Date.now();
  for (const [key, cached] of successCache) {
    if (now - cached.time > SUCCESS_CACHE_TTL) successCache.delete(key);
  }
  for (const [key, entry] of failedCache) {
    if (now - entry.at > FAILED_CACHE_TTL) failedCache.delete(key);
  }
}, 5 * 60 * 1000); // 每 5 分钟清理一次

// ============================================================
// 音质档位映射（对齐 Bhands_Web）
// ============================================================

/**
 * 用户音质档位 → GDMusic 的 br 参数：999=无损, 320/128=有损。
 * 原实现把 br 写死 '999'，导致用户选「标准」也会去要无损档（拿不到时白等一轮）。
 */
function gdQualityOf(tier) {
  if (tier === 'standard') return '128';
  if (tier === 'lossless' || tier === 'hires' || tier === 'jymaster') return '999';
  return '320';
}

/**
 * 请求档位 → 前端档位键。第三方源没给出任何可判定的证据时用它兜底
 * （注意：这只是「拿不到证据」时的保守估计，不是真实档位）。
 */
function tierOfRequest(tier) {
  if (tier === 'standard') return 'standard';
  if (tier === 'exhigh') return 'exhigh';
  return 'lossless';
}

/**
 * 把第三方源返回的音质信息归一成前端认识的档位键
 * （'lossless' | 'exhigh' | 'standard'，与网易云官方源 `d.level` 同语义，
 *   前端 `playbackQualityLabel()` 可直接用）。
 *
 * ⚠️ 各源的 `br` 语义**并不统一**，这里必须都兜住：
 *  - `lxMusic`：`quality` 直接是 'flac' / '320k' / '128k'
 *  - `gdmusic`：`br` 是**档位码**（'999' = 无损 / '320' / '128'）
 *  - `kugou`：现在透传真实档位（flac/320/128）+ 对应码率
 *  - `goMusic` / `custom` / `unblock`：`br` 是**真实 bps**（如 320000）
 * 判定办法：br ≤ 1000 一律按档位码解释，否则按 bps 解释。
 *
 * 为什么要做这件事：前端音质按钮要显示「实际解析出来的档位」
 * （非会员走第三方源，与网易云账号权限无关），而 `tryThirdPartyParse`
 * 此前只把 url 带回去，档位信息在服务端就被丢掉了。
 *
 * @returns {string} 'lossless' | 'exhigh' | 'standard'
 */
function normalizeSourceQuality(result, requestedQuality) {
  if (!result) return tierOfRequest(requestedQuality);
  const raw = String(result.quality || '').trim().toLowerCase();
  if (raw) {
    if (raw === 'flac' || raw === 'lossless' || raw === 'sq' || raw === '999') return 'lossless';
    if (raw === '320k' || raw === 'exhigh' || raw === 'hq' || raw === '320') return 'exhigh';
    if (raw === '128k' || raw === 'standard' || raw === 'std' || raw === '128') return 'standard';
  }
  const br = Number(result.br) || 0;
  if (br > 0) {
    if (br <= 1000) return br >= 900 ? 'lossless' : (br >= 256 ? 'exhigh' : 'standard');
    if (br >= 900000) return 'lossless';
    if (br >= 256000) return 'exhigh';
    return 'standard';
  }
  return tierOfRequest(requestedQuality);
}

// ============================================================
// 解析策略定义
// ============================================================

/**
 * @typedef {Object} ParseStrategy
 * @property {string} name - 策略名称
 * @property {number} priority - 排序权重（越小越靠前）。
 *   注意：编排器已是**并发竞速**，priority 只决定启动顺序与日志/冷却惩罚的排序，
 *   不再决定「谁先返回」——竞速下最快通过校验者胜出。保留该字段用于：
 *   ① 同刻完成的稳定排序；② 冷却期策略排到队尾的观测依据。
 * @property {function(Object): boolean} canHandle - 是否可以处理
 * @property {function(Object): Promise<{url: string, source: string, size?: number} | null>} parse - 执行解析
 */

/**
 * LxMusic 策略
 */
const lxMusicStrategy = {
  name: 'lxMusic',
  priority: 0,
  canHandle: function (params) {
    return params.enabledSources.includes('lxMusic') && listRunners().length > 0;
  },
  parse: async function (params) {
    if (isInFailedCache(params.id, 'lxMusic')) return null;

    const result = await parseFromLxMusic({
      id: params.id,
      name: params.name,
      artists: (params.artists || []).join('、'),
      album: params.album,
      duration: params.duration,
      quality: params.quality,
      scriptId: params.lxMusicScriptId
    });

    if (result && result.url) {
      return { url: result.url, source: result.source, quality: result.quality };
    }

    addFailedCache(params.id, 'lxMusic');
    return null;
  }
};

/**
 * 自定义 API 策略已于 2026-09-23 **整体移除**。
 *
 * 它的唯一开关是 `customApiUrl` 配置项（面板上的「自定义 API」开关与地址块
 * 在更早一轮就已删除），所以那个配置项一去掉，`canHandle` 永远返回 false ——
 * 留着就是一段永远不执行的死代码。`customApi.js` 同时删除。
 * 想恢复：git 里有，且 `params.customApiUrl` / `params.customApiMethod` 两条
 * 入参链路需要一并接回（server.js 的 parseMusic 调用点）。
 */

/**
 * 酷狗音源策略（移植自上游 Mineradio 2.2.0，免登录解析）
 * 链路：酷狗搜索（按歌名/歌手匹配）→ mobile 播放接口（标准音质 128k）
 * 优先级 3.5：排在 gdmusic（可拿高音质）之后作兜底，避免抢占 320k/无损；
 * 免登录只能拿免费曲目 128k，VIP 曲目自动落到 unblockMusic
 */
const kugouStrategy = {
  name: 'kugou',
  priority: 3.5,
  canHandle: function (params) {
    return params.enabledSources.includes('kugou');
  },
  parse: async function (params) {
    // 早退也要回放中性标记（见 failedCache 注释）：否则 60 秒内重播同一首无版权歌，
    // 第二次会被当成真实故障计数。
    const cachedFail = readFailedCache(params.id, 'kugou');
    if (cachedFail) return cachedFail.neutral ? { url: '', neutralFailure: true } : null;

    const result = await parseFromKugou({
      id: params.id,
      name: params.name,
      artists: params.artists,
      album: params.album,
      duration: params.duration,
      timeout: 15000
    });

    if (result && result.url) {
      return { url: result.url, source: result.source || 'kugou', br: result.br, quality: result.quality };
    }

    // 版权/无资源类失败（kugou.js 的 unavailableResult）不是服务故障 →
    // 标记为中性失败，让 noteStrategyResult 不动连败计数。
    const neutral = !!(result && result.reason === 'unavailable');
    addFailedCache(params.id, 'kugou', neutral);
    return neutral ? { url: '', neutralFailure: true } : null;
  }
};

/**
 * GD音乐台策略
 */
const gdmusicStrategy = {
  name: 'gdmusic',
  priority: 3,
  canHandle: function (params) {
    return params.enabledSources.includes('gdmusic');
  },
  parse: async function (params) {
    // 失败缓存按「歌曲 + 音质档位」隔离（对齐 Bhands_Web）：
    // 无损档失败不应连带封禁有损档，反之亦然。
    // 同时检查不带档位的基础 key —— 编排器在「探测校验拒绝」时会按策略名
    // （addFailedCache(id, 'gdmusic')）记一次，那条记忆与音质档无关，
    // 不检查就会漏掉（表现为：外层刚拒过，下一轮解析又完整重跑一遍）。
    const br = gdQualityOf(params.quality);
    const failKey = 'gdmusic_' + br;
    if (isInFailedCache(params.id, failKey) || isInFailedCache(params.id, 'gdmusic')) return null;

    const result = await parseFromGDMusic({
      id: params.id,
      name: params.name,
      artists: params.artists,
      duration: params.duration,
      quality: br,
      timeout: 6000  // 整体竞速超时：上游挂掉时不让后续策略久等（原 15s 太长）
    });

    if (result && result.url) {
      return { url: result.url, source: result.source || 'gdmusic', br: result.br, size: result.size || 0 };
    }

    addFailedCache(params.id, failKey);
    return null;
  }
};

/**
 * go-music-api 智能换源策略（移植自 Bhands_Web）
 * 独立 Go 服务，用酷狗/酷我/QQ/咪咕的**官方真实音源**替代——远优于 unblock 的 128k 错配。
 * 优先级 3.7：排在 gdmusic/kugou 之后、unblock 之前（与 Web 的链路位置一致）。
 * 服务离线时策略内部会短路 3 分钟（健康记忆），不会拖慢解析。
 * 「这首歌没有可用资源」类失败标记为中性（见 parse 内注释），不计入策略冷却。
 */
const goMusicStrategy = {
  name: 'goMusic',
  priority: 3.7,
  canHandle: function (params) {
    return params.enabledSources.includes('goMusic');
  },
  parse: async function (params) {
    // 早退也要回放中性标记（见 failedCache 注释）
    const cachedFail = readFailedCache(params.id, 'goMusic');
    if (cachedFail) return cachedFail.neutral ? { url: '', neutralFailure: true } : null;

    const result = await tryGoMusicSwitch({
      id: params.id,
      name: params.name,
      artists: params.artists,
      album: params.album,
      duration: params.duration,
      quality: params.quality
    });

    if (result && result.url) {
      return { url: result.url, source: result.source, br: result.br, size: result.size || 0 };
    }

    // 「换源搜不到 / 命中平台不在白名单 / 候选歌手对不上 / 拿不到直链」都是
    // **这首歌在 goMusic 侧没有可用资源**，与策略健康无关 → 中性失败，不动连败计数。
    // 不豁免的话，连遇两首同名错配或无版权歌就能把 goMusic 打进 5 分钟冷却。
    // 超时与服务不可用仍返回 null（goMusicSwitch 那边判的），照常计真实故障。
    const neutral = !!(result && result.neutralFailure);
    addFailedCache(params.id, 'goMusic', neutral);
    return neutral ? { url: '', neutralFailure: true } : null;
  }
};

/**
 * UnblockNeteaseMusic 策略
 */
const unblockMusicStrategy = {
  name: 'unblockMusic',
  priority: 4,
  canHandle: function (params) {
    return params.enabledSources.includes('unblockMusic');
  },
  parse: async function (params) {
    if (isInFailedCache(params.id, 'unblockMusic')) return null;

    const result = await parseFromUnblockMusic({
      id: params.id,
      name: params.name,
      artists: params.artists,
      album: params.album,
      enabledPlatforms: params.unblockPlatforms,
      retryCount: 1
    });

    if (result && result.url) {
      return {
        url: result.url,
        source: 'unblock-' + (result.platform || 'unknown'),
        br: result.br,
        size: result.size || 0
      };
    }

    addFailedCache(params.id, 'unblockMusic');
    return null;
  }
};

/** 所有策略列表（`custom` 已于 2026-09-23 移除，见 customApiStrategy 处的注释） */
const ALL_STRATEGIES = [
  lxMusicStrategy,
  gdmusicStrategy,
  kugouStrategy,
  goMusicStrategy,
  unblockMusicStrategy
];

// ============================================================
// 策略健康记忆：连败冷却（策略级、跨歌曲）
// 某策略连续失败达到阈值后，冷却期内把该策略排到队尾——
// 上游源临时挂掉（如 GD音乐台 503）时不再让每首歌都白等它超时，
// 但不彻底跳过：冷却结束自动恢复原优先级，恢复后成功会清零。
// ============================================================

/** 连败多少次进入冷却 */
const STRATEGY_COOLDOWN_THRESHOLD = 2;

/** 冷却时长：5 分钟 */
const STRATEGY_COOLDOWN_MS = 5 * 60 * 1000;

/** 冷却期排序惩罚值：大于任何优先级差，确保排到队尾 */
const STRATEGY_COOLDOWN_PENALTY = 100;

/** name -> { count, cooldownUntil } */
const strategyFailStreak = new Map();

/**
 * 记录策略健康结果。
 * @param {string} name 策略名
 * @param {boolean} ok 是否产出了可用结果
 * @param {boolean} [neutralFailure] 是否为「中性失败」—— 与策略健康无关的失败
 *   （典型：版权/无资源，即搜索服务本身完全正常、只是这首歌确实没有）。
 *   此时**不改变连败计数**：否则连遇几首无版权的歌，会把完全正常的策略
 *   打进 5 分钟冷却，白丢它的先手优势（2026-09-23 kugou 实测）。
 */
function noteStrategyResult(name, ok, neutralFailure) {
  if (neutralFailure && !ok) return;
  if (ok) {
    strategyFailStreak.delete(name);
    return;
  }
  const cur = strategyFailStreak.get(name) || { count: 0, cooldownUntil: 0 };
  cur.count += 1;
  if (cur.count >= STRATEGY_COOLDOWN_THRESHOLD) {
    cur.cooldownUntil = Date.now() + STRATEGY_COOLDOWN_MS;
    cur.count = 0;  // 冷却结束后重新计数
    console.log('[MusicParser] 策略 ' + name + ' 连续失败，进入冷却 ' + (STRATEGY_COOLDOWN_MS / 60000) + ' 分钟（期间排到队尾）');
  }
  strategyFailStreak.set(name, cur);
}

function strategyCooldownPenalty(name) {
  const cur = strategyFailStreak.get(name);
  return cur && cur.cooldownUntil > Date.now() ? STRATEGY_COOLDOWN_PENALTY : 0;
}

// ============================================================
// 硬拒绝（垫片 / 伪音频）——不进「宽容回落」
// ============================================================

/** 垫片大小阈值：400KB ≈ 128kbps 下 25 秒；期望 ≥90s 的歌不可能只有这点数据 */
const SHIM_MAX_BYTES = 400 * 1000;
const SHIM_MIN_EXPECTED_MS = 90 * 1000;

/**
 * 声明大小硬防御（对齐 Bhands_Web 的 isHardRejected）：
 * 上游自己声明了体积，且体积小得离谱 → 必是碎片/广告垫片，直接丢弃。
 * expectedMs 为 0（时长未知）时同样生效——此时没有时长可依，声明体积是唯一证据。
 */
function isHardRejected(result, expectedMs) {
  const size = Number(result && result.size) || 0;
  return size > 0 && size < SHIM_MAX_BYTES && (expectedMs >= SHIM_MIN_EXPECTED_MS || expectedMs === 0);
}

/**
 * 探测结果确认是垫片：物理体积是绝对证据，不依赖上游声明。
 * 用于「未声明体积」的音源（LX / 自定义 API）——它们在 isHardRejected 上 fail-open，
 * 但探测拿到的 totalBytes 仍能识别垫片。
 */
function isShimProbe(probe, expectedMs) {
  return expectedMs >= SHIM_MIN_EXPECTED_MS
    && !!probe && probe.totalBytes > 0 && probe.totalBytes < SHIM_MAX_BYTES;
}

// ============================================================
// 主解析函数
// ============================================================

/**
 * 使用多策略解析音乐 URL
 * @param {Object} params
 * @param {number} params.id - 歌曲 ID
 * @param {string} params.name - 歌曲名称
 * @param {string[]} params.artists - 歌手列表
 * @param {string} [params.album] - 专辑名称
 * @param {number} [params.duration] - 时长(毫秒)
 * @param {string} [params.quality] - 音质
 * @param {string[]} [params.enabledSources] - 启用的音源列表
 * @param {string} [params.lxMusicScriptId] - LX Music 脚本 ID
 * @param {string[]} [params.unblockPlatforms] - UnblockNeteaseMusic 平台列表
 * @returns {Promise<{url: string, source: string, quality?: string, br?: number} | null>}
 *
 * 注：`customApiUrl` / `customApiMethod` / `goMusicApiUrl` 三个入参已于 2026-09-23 移除
 * （面板入口早已删掉、无人能改）。go-music-api 的服务地址现在只看环境变量
 * GO_MUSIC_API_URL，留空即默认 http://127.0.0.1:8080。
 */
async function parseMusic(params) {
  const startTime = Date.now();

  // 默认值必须与 server/server.js 的 DEFAULT_MUSIC_SOURCES_CONFIG 保持一致
  // （那里是 ['gdmusic','goMusic']）。此前这里少一个 goMusic，
  // 同一份配置出现两个默认值，改动很容易只改一处（2026-09-23 对齐）；
  // 同日起 unblockMusic 从默认值摘掉（实测恒返回酷我试听垫片，见 server.js 注释）。
  const enabledSources = params.enabledSources || ['gdmusic', 'goMusic'];
  // ⚠️ 必须写回 params：各策略的 canHandle(params) 读的是 params.enabledSources，
  // 不写回的话「调用方没传 enabledSources」会直接抛
  // TypeError: Cannot read properties of undefined (reading 'includes')。
  //（server.js 那条路径总是显式传值，所以这个坑一直没暴露；直接调 parseMusic
  //  或将来新增调用点就会踩到。）
  params.enabledSources = enabledSources;

  // 检查成功缓存（key 含音质：切音质后不会复用旧音质的结果）
  const cached = getSuccessCache(params.id, enabledSources, params.quality);
  if (cached) {
    return cached;
  }

  // 获取可用策略并按优先级排序（冷却期策略加惩罚值排到队尾）
  // 会员优先：已登录酷狗会员（扫码/验证码）时 kugou 策略提前（FLAC 无损 > 其它源的试听/128k）；
  // 偏移量 1.0 让 kugou 排到 gdmusic(3.5)/goMusic(3.7)/unblock(4) 之前，
  // 但仍在用户显式配置的 lxMusic(0)/customApi(1) 之后——显式配置的自定义源优先级更高
  const kugouVip = readKugouVipCredentials();
  const kugouVipBoost = (kugouVip && kugouVip.cookie) ? 1.0 : 0;
  const strategyPriority = function (s) {
    return (s.name === 'kugou' ? s.priority - kugouVipBoost : s.priority);
  };
  const availableStrategies = ALL_STRATEGIES
    .filter(function (s) { return s.canHandle(params); })
    .map(function (s) { return { strategy: s, penalty: strategyCooldownPenalty(s.name) }; })
    .sort(function (a, b) { return (strategyPriority(a.strategy) + a.penalty) - (strategyPriority(b.strategy) + b.penalty); })
    .map(function (x) { return x.strategy; });

  if (availableStrategies.length === 0) {
    console.log('[MusicParser] 没有可用的解析策略');
    return null;
  }

  console.log(
    '[MusicParser] 开始解析歌曲 ' + params.id + ', 可用策略:',
    availableStrategies.map(function (s) { return s.name; }).join(', ')
  );

  // 竞速版（移植自 Bhands_Web）：全部策略并发启动，第一个「成功 + 通过时长/类型
  // 探测校验」的胜出即返回——单源挂死/超时不再拖慢整条链（串行版在 gdmusic
  // 上游挂掉时每首歌白等 6~15s）。全部完成仍无校验通过者 → 宽容回落第一个
  // 成功候选（duration 缺失时校验恒过，行为同旧版串行）。
  // 冷却惩罚（strategyCooldownPenalty）在并发下不影响启动顺序，保留记录供日志观测。
  const expectedMs = Number(params.duration) || 0;
  return new Promise(function (resolve) {
    let settled = false;
    let pending = availableStrategies.length;
    let fallback = null;

    function settleWith(result, strategyName) {
      if (settled) return;
      settled = true;
      // 补上归一化档位键（前端音质按钮显示「实际解析档位」用），随结果一起进成功缓存
      if (result && !result.level) result.level = normalizeSourceQuality(result, params.quality);
      const elapsed = Date.now() - startTime;
      console.log('[MusicParser] 解析成功! 策略: ' + strategyName + ', 耗时: ' + elapsed + 'ms' +
        (result && result.level ? ', 档位: ' + result.level : ''));
      setSuccessCache(params.id, result, enabledSources, params.quality);
      resolve(result);
    }
    function settleFallback() {
      if (settled) return;
      settled = true;
      const elapsed = Date.now() - startTime;
      if (fallback) {
        if (!fallback.level) fallback.level = normalizeSourceQuality(fallback, params.quality);
        console.log('[MusicParser] 无候选通过时长校验，宽容回落首个成功候选（' + fallback.source + '），耗时: ' + elapsed + 'ms');
      } else {
        console.log('[MusicParser] 所有策略均失败, 耗时: ' + elapsed + 'ms');
      }
      resolve(fallback);
    }
    function onPendingDone() {
      pending--;
      if (pending === 0 && !settled) settleFallback();
    }

    availableStrategies.forEach(function (strategy, launchIdx) {
      // 会员窗口（kugouVipBoost 激活时）：按排序错峰启动——第一名（会员 FLAC）独享
      // 约 300ms 先手窗口，避免被 405ms 级的 unblock/kuwo mp3 抢跑（实测「沧海一粟」
      // unblock 405ms 先胜、kugou flac 慢一步没用上）。非会员模式保持全并发不变。
      // 延迟上限 900ms：kugou flac 失败时其它源最多晚 0.9s 启动，可接受。
      var launchDelay = (kugouVipBoost > 0 && launchIdx > 0) ? Math.min(launchIdx * 300, 900) : 0;
      var launch = function () {
      strategy.parse(params).then(function (result) {
        noteStrategyResult(strategy.name, !!(result && result.url), !!(result && result.neutralFailure));
        if (!result || !result.url) {
          console.log('[MusicParser] 策略 ' + strategy.name +
            (result && result.neutralFailure ? ' 无可用资源（不计入冷却）' : ' 未返回有效 URL'));
          onPendingDone();
          return;
        }
        // 声明体积硬防御（前置）：碎片/广告垫片直接丢弃且**不进宽容回落**。
        // 回落本意是兜「时长元数据误差误杀的正确源」，但垫片（声明体积是绝对证据）
        // 被拒后若也进回落，全部源完成时 settleFallback 会把它又放回来
        // —— 对齐 Bhands_Web 的 isHardRejected（2026-09-15「晴天」185KB 垫片漏网即此）。
        if (isHardRejected(result, expectedMs)) {
          console.warn(
            '[MusicParser] 声明大小 ' + result.size + 'B 过小（expectedMs=' + expectedMs +
            '），疑似广告垫片，丢弃 ' + strategy.name
          );
          // 同样记失败缓存：声明体积是上游自己给的、确定性高，
          // 没必要 1 分钟内对同一首歌反复撞同一块垫片。
          addFailedCache(params.id, strategy.name);
          onPendingDone();
          return;
        }
        // 候选探测校验（真实音频 + 时长可信），通过即胜出
        probeAudio(result.url).then(function (probe) {
          if (settled) return;
          if (acceptProbe(probe, expectedMs)) {
            settleWith(result, strategy.name);
            return;
          }
          const shim = isShimProbe(probe, expectedMs);
          console.warn(
            '[MusicParser] 候选音源 ' + strategy.name + ' 未通过校验丢弃' +
            (probe.status === 'not-audio' ? '（返回的不是音频）' :
              shim ? '（探测体积仅 ' + probe.totalBytes + 'B，疑似垫片）' :
                probe.durationSec ? '（实际 ' + Math.round(probe.durationSec) + 's vs 期望 ' + Math.round(expectedMs / 1000) + 's）' : '')
          );
          // 垫片不进宽容回落（未声明体积的音源只能靠探测识别，见 isShimProbe）
          if (!shim && !fallback) fallback = result;
          // 探测拒绝 → 记住「这首歌 + 该策略」不可用（TTL 1 分钟）。
          // probeAudio 每次都真发 Range 请求、没有缓存，不记的话同一首歌每次解析
          // 都会重跑一遍注定失败的策略（2026-09-23「座位」实测：kugou 每次都匹配到
          // 「座位 (架子鼓版)」、每次都被探测量出 225s vs 208s 拒掉）。
          // 只记**确定性**拒绝（不是音频 / 时长不符 / 垫片体积），unreachable 走的是
          // acceptProbe 的 fail-open 分支，不会走到这里。
          addFailedCache(params.id, strategy.name);
          onPendingDone();
        }).catch(function () {
          // 探测自身异常：fail-open 放行（与 unreachable 同语义）
          if (!settled) settleWith(result, strategy.name);
          else onPendingDone();
        });
      }).catch(function (error) {
        noteStrategyResult(strategy.name, false);
        console.error('[MusicParser] 策略 ' + strategy.name + ' 异常:', error.message);
        onPendingDone();
      });
      };
      if (launchDelay > 0) { setTimeout(launch, launchDelay); } else { launch(); }
    });
  });
}

// ============================================================
// 模块导出
// ============================================================

module.exports = {
  parseMusic,
  clearCacheForSong,
  getSuccessCache,
  listRunners,
  // 缓存管理（供 API 使用）
  clearAllCache: function () {
    successCache.clear();
    failedCache.clear();
    console.log('[MusicParser] 已清除所有缓存');
  },
  getCacheStats: function () {
    return {
      successCacheSize: successCache.size,
      failedCacheSize: failedCache.size
    };
  }
};
