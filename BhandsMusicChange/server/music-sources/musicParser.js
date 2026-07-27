'use strict';

/**
 * 音乐解析策略编排器
 * 管理多个音源解析策略，按优先级依次尝试
 */

const { parseFromGDMusic } = require('./gdmusic');
const { parseFromUnblockMusic } = require('./unblockMusic');
const { parseFromLxMusic, listRunners } = require('./lxMusicRunner');
const { parseFromCustomApi } = require('./customApi');

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
      quality: '999',
      timeout: 15000
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
const ALL_STRATEGIES = [lxMusicStrategy, customApiStrategy, gdmusicStrategy, unblockMusicStrategy];

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

  // 获取可用策略并按优先级排序
  const availableStrategies = ALL_STRATEGIES
    .filter(function (s) { return s.canHandle(params); })
    .sort(function (a, b) { return a.priority - b.priority; });

  if (availableStrategies.length === 0) {
    console.log('[MusicParser] 没有可用的解析策略');
    return null;
  }

  console.log(
    '[MusicParser] 开始解析歌曲 ' + params.id + ', 可用策略:',
    availableStrategies.map(function (s) { return s.name; }).join(', ')
  );

  // 按优先级依次尝试
  for (const strategy of availableStrategies) {
    try {
      const result = await strategy.parse(params);
      if (result && result.url) {
        const elapsed = Date.now() - startTime;
        console.log(
          '[MusicParser] 解析成功! 策略: ' + strategy.name +
          ', 耗时: ' + elapsed + 'ms'
        );

        // 缓存成功结果
        setSuccessCache(params.id, result, enabledSources);

        return result;
      }
      console.log('[MusicParser] 策略 ' + strategy.name + ' 未返回有效 URL');
    } catch (error) {
      console.error('[MusicParser] 策略 ' + strategy.name + ' 异常:', error.message);
    }
  }

  const elapsed = Date.now() - startTime;
  console.log('[MusicParser] 所有策略均失败, 耗时: ' + elapsed + 'ms');
  return null;
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
