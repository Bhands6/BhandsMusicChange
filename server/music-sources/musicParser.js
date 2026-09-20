'use strict';

/**
 * 音乐解析策略编排器
 * 管理多个音源解析策略，按优先级依次尝试
 */

const { parseFromGDMusic } = require('./gdmusic');
const { parseFromUnblockMusic } = require('./unblockMusic');
const { parseFromLxMusic, listRunners } = require('./lxMusicRunner');
const { parseFromCustomApi } = require('./customApi');
const { parseFromKugou } = require('./kugou');
const { probeAudio, acceptProbe } = require('./durationProbe');

// ============================================================
// 缓存配置
// ============================================================

/** 成功缓存时间：30 分钟 */
const SUCCESS_CACHE_TTL = 30 * 60 * 1000;

/** 失败缓存时间：1 分钟 */
const FAILED_CACHE_TTL = 1 * 60 * 1000;

/** 成功缓存 Map: key = songId, value = { data, sources, time } */
const successCache = new Map();

/** 失败缓存 Map: key = "songId_strategyName", value = timestamp */
const failedCache = new Map();

// ============================================================
// 缓存管理
// ============================================================

function getSuccessCacheKey(id, sources) {
  return String(id) + '_' + (sources || []).sort().join(',');
}

function getSuccessCache(id, sources) {
  const key = getSuccessCacheKey(id, sources);
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

function setSuccessCache(id, data, sources) {
  const key = getSuccessCacheKey(id, sources);
  successCache.set(key, {
    data: data,
    sources: sources || [],
    time: Date.now()
  });
}

function isInFailedCache(id, strategyName) {
  const key = String(id) + '_' + strategyName;
  const time = failedCache.get(key);
  if (!time) return false;

  if (Date.now() - time > FAILED_CACHE_TTL) {
    failedCache.delete(key);
    return false;
  }

  return true;
}

function addFailedCache(id, strategyName) {
  const key = String(id) + '_' + strategyName;
  failedCache.set(key, Date.now());
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
  for (const [key, time] of failedCache) {
    if (now - time > FAILED_CACHE_TTL) failedCache.delete(key);
  }
}, 5 * 60 * 1000); // 每 5 分钟清理一次

// ============================================================
// 解析策略定义
// ============================================================

/**
 * @typedef {Object} ParseStrategy
 * @property {string} name - 策略名称
 * @property {number} priority - 优先级（越小越优先）
 * @property {function(Object): boolean} canHandle - 是否可以处理
 * @property {function(Object): Promise<{url: string, source: string} | null>} parse - 执行解析
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
 * 自定义 API 策略
 */
const customApiStrategy = {
  name: 'custom',
  priority: 1,
  canHandle: function (params) {
    return params.enabledSources.includes('custom') && !!params.customApiUrl;
  },
  parse: async function (params) {
    if (isInFailedCache(params.id, 'custom')) return null;

    const result = await parseFromCustomApi({
      id: params.id,
      name: params.name,
      artists: params.artists,
      album: params.album,
      quality: params.quality,
      apiUrl: params.customApiUrl,
      apiMethod: params.customApiMethod || 'GET'
    });

    if (result && result.url) {
      return { url: result.url, source: 'custom', br: result.br };
    }

    addFailedCache(params.id, 'custom');
    return null;
  }
};

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
    if (isInFailedCache(params.id, 'kugou')) return null;

    const result = await parseFromKugou({
      id: params.id,
      name: params.name,
      artists: params.artists,
      album: params.album,
      duration: params.duration,
      timeout: 15000
    });

    if (result && result.url) {
      return { url: result.url, source: result.source || 'kugou', br: result.br };
    }

    addFailedCache(params.id, 'kugou');
    return null;
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
    if (isInFailedCache(params.id, 'gdmusic')) return null;

    const result = await parseFromGDMusic({
      id: params.id,
      name: params.name,
      artists: params.artists,
      duration: params.duration,
      quality: '999',
      timeout: 6000  // 整体竞速超时：上游挂掉时不让后续策略久等（原 15s 太长）
    });

    if (result && result.url) {
      return { url: result.url, source: result.source || 'gdmusic', br: result.br };
    }

    addFailedCache(params.id, 'gdmusic');
    return null;
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
      return { url: result.url, source: 'unblock-' + (result.platform || 'unknown'), br: result.br };
    }

    addFailedCache(params.id, 'unblockMusic');
    return null;
  }
};

/** 所有策略列表 */
const ALL_STRATEGIES = [lxMusicStrategy, customApiStrategy, kugouStrategy, gdmusicStrategy, unblockMusicStrategy];

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

function noteStrategyResult(name, ok) {
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
 * @param {string} [params.customApiUrl] - 自定义 API 地址
 * @param {string} [params.customApiMethod] - 自定义 API 请求方法
 * @param {string} [params.lxMusicScriptId] - LX Music 脚本 ID
 * @param {string[]} [params.unblockPlatforms] - UnblockNeteaseMusic 平台列表
 * @returns {Promise<{url: string, source: string, quality?: string, br?: number} | null>}
 */
async function parseMusic(params) {
  const startTime = Date.now();

  const enabledSources = params.enabledSources || ['gdmusic', 'unblockMusic'];

  // 检查成功缓存
  const cached = getSuccessCache(params.id, enabledSources);
  if (cached) {
    return cached;
  }

  // 获取可用策略并按优先级排序（冷却期策略加惩罚值排到队尾）
  const availableStrategies = ALL_STRATEGIES
    .filter(function (s) { return s.canHandle(params); })
    .map(function (s) { return { strategy: s, penalty: strategyCooldownPenalty(s.name) }; })
    .sort(function (a, b) { return (a.strategy.priority + a.penalty) - (b.strategy.priority + b.penalty); })
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
      const elapsed = Date.now() - startTime;
      console.log('[MusicParser] 解析成功! 策略: ' + strategyName + ', 耗时: ' + elapsed + 'ms');
      setSuccessCache(params.id, result, enabledSources);
      resolve(result);
    }
    function settleFallback() {
      if (settled) return;
      settled = true;
      const elapsed = Date.now() - startTime;
      if (fallback) {
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

    availableStrategies.forEach(function (strategy) {
      strategy.parse(params).then(function (result) {
        noteStrategyResult(strategy.name, !!(result && result.url));
        if (!result || !result.url) {
          console.log('[MusicParser] 策略 ' + strategy.name + ' 未返回有效 URL');
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
          console.warn(
            '[MusicParser] 候选音源 ' + strategy.name + ' 未通过校验丢弃' +
            (probe.status === 'not-audio' ? '（返回的不是音频）' :
              probe.durationSec ? '（实际 ' + Math.round(probe.durationSec) + 's vs 期望 ' + Math.round(expectedMs / 1000) + 's）' : '')
          );
          if (!fallback) fallback = result;
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
