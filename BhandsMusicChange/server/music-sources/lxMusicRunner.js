'use strict';

/**
 * LX Music 脚本执行器
 * 在沙盒环境中执行 LX Music 音源脚本，获取音乐 URL
 *
 * LX Music 脚本格式说明：
 * 脚本需要导出一个对象，包含 sources 音源映射。
 * 每个音源需要实现 getMusicUrl(songInfo, quality) 方法。
 *
 * 支持的音源 key：
 * - wy: 网易云
 * - kw: 酷我
 * - mg: 咪咕
 * - kg: 酷狗
 * - tx: QQ音乐
 */

const vm = require('vm');
const https = require('https');
const http = require('http');

// 音源中文名称映射
const SOURCE_NAMES = {
  wy: '网易云',
  kw: '酷我',
  mg: '咪咕',
  kg: '酷狗',
  tx: 'QQ音乐'
};

// 音质映射（用户音质 → LX Music 音质标识）
const QUALITY_MAP = {
  standard: '128k',
  higher: '320k',
  exhigh: '320k',
  lossless: 'flac',
  hires: 'flac',
  jymaster: 'flac'
};

// 音质降级链：从高到低
const QUALITY_CASCADE = ['flac', '320k', '128k'];

/**
 * 根据用户音质获取降级链（从请求的音质开始往下试）
 * @param {string} quality - 用户请求的音质
 * @returns {string[]} 音质列表
 */
function getQualityCascade(quality) {
  const mapped = QUALITY_MAP[quality] || '320k';
  const idx = QUALITY_CASCADE.indexOf(mapped);
  if (idx < 0) return [mapped];
  return QUALITY_CASCADE.slice(idx);
}

/**
 * 创建沙盒环境
 * 提供 LX Music 脚本运行所需的基础 API
 */
function createSandbox() {
  return {
    // 基础 JS 全局对象
    console: {
      log: function () {},
      warn: function () {},
      error: function () {}
    },
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: setInterval,
    clearInterval: clearInterval,
    Promise: Promise,
    Date: Date,
    Math: Math,
    JSON: JSON,
    RegExp: RegExp,
    Array: Array,
    Object: Object,
    String: String,
    Number: Number,
    Boolean: Boolean,
    Error: Error,
    TypeError: TypeError,
    RangeError: RangeError,
    encodeURIComponent: encodeURIComponent,
    decodeURIComponent: decodeURIComponent,
    parseInt: parseInt,
    parseFloat: parseFloat,
    isNaN: isNaN,
    isFinite: isFinite,
    Buffer: Buffer,
    // HTTP 请求函数（脚本可能需要）
    fetch: undefined, // 下面会设置
    // 模块导出占位
    module: { exports: {} },
    exports: {}
  };
}

/**
 * 发送 HTTP/HTTPS 请求（提供给沙盒的 fetch 替代品）
 * @param {string} url
 * @param {Object} options
 * @returns {Promise<{status: number, headers: Object, body: string}>}
 */
function sandboxHttpRequest(url, options) {
  return new Promise(function (resolve, reject) {
    options = options || {};
    const isHttps = url.startsWith('https');
    const client = isHttps ? https : http;
    const urlObj = new (require('url').URL)(url);

    const reqOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: options.timeout || 15000
    };

    const req = client.request(reqOptions, function (res) {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', function (chunk) { body += chunk; });
      res.on('end', function () {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: body
        });
      });
    });

    req.on('error', reject);
    req.on('timeout', function () {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

/**
 * LX Music 脚本执行器类
 */
class LxMusicRunner {
  constructor() {
    this._script = null;
    this._sources = {};
    this._initialized = false;
    this._scriptName = '';
  }

  /**
   * 初始化执行器，加载并执行脚本
   * @param {string} scriptContent - LX Music 脚本内容
   * @param {string} [scriptName] - 脚本名称
   * @returns {Promise<boolean>} 是否初始化成功
   */
  async init(scriptContent, scriptName) {
    try {
      this._scriptName = scriptName || 'unknown';
      console.log('[LxMusicRunner] 初始化脚本:', this._scriptName);

      // 创建沙盒
      const sandbox = createSandbox();
      sandbox.fetch = sandboxHttpRequest;

      // 创建上下文
      const context = vm.createContext(sandbox);

      // 执行脚本
      let scriptCode = scriptContent;

      // 兼容不同格式的脚本：
      // 1. 直接导出 sources 对象
      // 2. 通过 module.exports 导出
      // 3. IIFE 返回对象
      // 4. 赋值给全局变量

      // 包装脚本以捕获导出
      const wrappedScript =
        '(function() {\n' +
        '  var __result__;\n' +
        '  try {\n' +
        '    __result__ = (function() {\n' +
        '      ' + scriptCode + '\n' +
        '    })();\n' +
        '  } catch(e) {\n' +
        '    __result__ = null;\n' +
        '  }\n' +
        '  if (__result__) module.exports = __result__;\n' +
        '  return module.exports;\n' +
        '})()';

      const script = new vm.Script(wrappedScript, {
        filename: 'lx-music-' + this._scriptName + '.js',
        timeout: 10000
      });

      const result = script.runInContext(context, { timeout: 10000 });

      // 解析音源
      this._sources = {};

      if (result && typeof result === 'object') {
        // 尝试多种导出格式
        const sources = result.sources || result;

        if (sources && typeof sources === 'object') {
          for (const key of Object.keys(sources)) {
            const source = sources[key];
            if (source && typeof source === 'object') {
              // 检查是否有 getMusicUrl 方法
              if (typeof source.getMusicUrl === 'function') {
                this._sources[key] = source;
              }
              // 也可能嵌套在 info 或 handler 中
              else if (source.info && typeof source.info.getMusicUrl === 'function') {
                this._sources[key] = source.info;
              }
            }
          }
        }
      }

      const sourceKeys = Object.keys(this._sources);
      if (sourceKeys.length === 0) {
        console.warn('[LxMusicRunner] 脚本未导出有效的音源, 脚本:', this._scriptName);
        this._initialized = false;
        return false;
      }

      this._initialized = true;
      console.log(
        '[LxMusicRunner] 脚本加载成功, 可用音源:',
        sourceKeys.map(function (k) { return k + '(' + (SOURCE_NAMES[k] || k) + ')'; }).join(', ')
      );
      return true;
    } catch (error) {
      console.error('[LxMusicRunner] 脚本执行失败:', error.message);
      this._initialized = false;
      return false;
    }
  }

  /**
   * 是否已初始化
   * @returns {boolean}
   */
  isInitialized() {
    return this._initialized;
  }

  /**
   * 获取可用音源列表
   * @returns {Object} 音源 key 到音源对象的映射
   */
  getSources() {
    return this._sources;
  }

  /**
   * 获取可用音源 key 列表
   * @returns {string[]}
   */
  getAvailableSourceKeys() {
    return Object.keys(this._sources);
  }

  /**
   * 获取音乐 URL
   * @param {string} sourceKey - 音源 key (wy, kw, mg, kg, tx)
   * @param {Object} songInfo - 歌曲信息
   * @param {string} songInfo.songmid - 歌曲 ID
   * @param {string} songInfo.name - 歌曲名称
   * @param {string} songInfo.singer - 歌手名称
   * @param {string} songInfo.album - 专辑名称
   * @param {string} songInfo.interval - 时长 (mm:ss)
   * @param {string} quality - 音质 (128k, 320k, flac)
   * @param {Object} [options] - 额外选项
   * @returns {Promise<string|null>} 音乐 URL，失败返回 null
   */
  async getMusicUrl(sourceKey, songInfo, quality, options) {
    if (!this._initialized) {
      console.error('[LxMusicRunner] 未初始化');
      return null;
    }

    const source = this._sources[sourceKey];
    if (!source) {
      console.error('[LxMusicRunner] 未知音源:', sourceKey);
      return null;
    }

    if (typeof source.getMusicUrl !== 'function') {
      console.error('[LxMusicRunner] 音源', sourceKey, '缺少 getMusicUrl 方法');
      return null;
    }

    try {
      console.log(
        '[LxMusicRunner] 获取 URL, 音源:',
        SOURCE_NAMES[sourceKey] || sourceKey,
        '音质:',
        quality
      );

      const url = await source.getMusicUrl(songInfo, quality, options || {});

      if (url && typeof url === 'string' && url.startsWith('http')) {
        console.log('[LxMusicRunner] 获取成功');
        return url;
      }

      // 有些脚本返回对象格式 { url: '...' }
      if (url && typeof url === 'object' && url.url) {
        return url.url;
      }

      console.warn('[LxMusicRunner] 音源返回无效数据:', typeof url);
      return null;
    } catch (error) {
      console.error('[LxMusicRunner] 获取 URL 失败:', error.message);
      return null;
    }
  }
}

// 全局执行器实例（支持多脚本管理）
let _runners = {};
let _activeRunnerId = null;

/**
 * 获取当前活跃的执行器
 * @returns {LxMusicRunner|null}
 */
function getActiveRunner() {
  if (_activeRunnerId && _runners[_activeRunnerId]) {
    return _runners[_activeRunnerId];
  }
  return null;
}

/**
 * 初始化并注册一个脚本执行器
 * @param {string} scriptId - 脚本 ID
 * @param {string} scriptContent - 脚本内容
 * @param {string} [scriptName] - 脚本名称
 * @param {boolean} [activate] - 是否设为活跃执行器
 * @returns {Promise<LxMusicRunner|null>}
 */
async function initRunner(scriptId, scriptContent, scriptName, activate) {
  const runner = new LxMusicRunner();
  const success = await runner.init(scriptContent, scriptName);

  if (success) {
    _runners[scriptId] = runner;
    if (activate || !_activeRunnerId) {
      _activeRunnerId = scriptId;
    }
    return runner;
  }

  return null;
}

/**
 * 设置活跃执行器
 * @param {string} scriptId
 * @returns {boolean}
 */
function setActiveRunner(scriptId) {
  if (_runners[scriptId]) {
    _activeRunnerId = scriptId;
    return true;
  }
  return false;
}

/**
 * 移除一个执行器
 * @param {string} scriptId
 */
function removeRunner(scriptId) {
  delete _runners[scriptId];
  if (_activeRunnerId === scriptId) {
    const keys = Object.keys(_runners);
    _activeRunnerId = keys.length > 0 ? keys[0] : null;
  }
}

/**
 * 获取所有已注册的执行器信息
 * @returns {Object[]}
 */
function listRunners() {
  return Object.keys(_runners).map(function (id) {
    const runner = _runners[id];
    return {
      id: id,
      initialized: runner.isInitialized(),
      sources: runner.getAvailableSourceKeys(),
      active: id === _activeRunnerId
    };
  });
}

/**
 * 使用 LX Music 解析音乐 URL
 * @param {Object} params
 * @param {number} params.id - 歌曲 ID
 * @param {string} params.name - 歌曲名称
 * @param {string} params.artists - 歌手名称（多个用逗号分隔）
 * @param {string} [params.album] - 专辑名称
 * @param {string} [params.duration] - 时长（毫秒）
 * @param {string} [params.quality] - 音质
 * @param {string} [params.scriptId] - 指定使用的脚本 ID
 * @returns {Promise<{url: string, source: string, quality: string} | null>}
 */
async function parseFromLxMusic(params) {
  const {
    id,
    name,
    artists,
    album = '',
    duration = 0,
    quality = '320k',
    scriptId
  } = params;

  // 选择执行器
  let runner = null;
  if (scriptId && _runners[scriptId]) {
    runner = _runners[scriptId];
  } else {
    runner = getActiveRunner();
  }

  if (!runner || !runner.isInitialized()) {
    console.log('[LxMusic] 没有可用的脚本执行器');
    return null;
  }

  // 获取可用音源
  const availableSources = runner.getAvailableSourceKeys();
  if (availableSources.length === 0) {
    console.log('[LxMusic] 没有可用的音源');
    return null;
  }

  // 音源优先级
  const sourcePriority = ['wy', 'kw', 'mg', 'kg', 'tx'];
  let bestSource = null;

  for (const source of sourcePriority) {
    if (availableSources.includes(source)) {
      bestSource = source;
      break;
    }
  }

  if (!bestSource) {
    bestSource = availableSources[0];
  }

  // 构造歌曲信息
  const minutes = Math.floor(duration / 60000);
  const seconds = Math.floor((duration % 60000) / 1000);
  const interval =
    String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');

  const songInfo = {
    songmid: String(id),
    name: name || '',
    singer: artists || '',
    album: album || '',
    interval: interval,
    img: ''
  };

  // 获取音质降级链（从最高到最低）
  const cascade = getQualityCascade(quality);
  console.log('[LxMusic] 音质降级链:', cascade.join(' → '));

  // 对每个音质级别，依次尝试所有音源
  for (const lxQuality of cascade) {
    console.log('[LxMusic] 尝试音质:', lxQuality);

    // 先试最佳音源
    const url = await runner.getMusicUrl(bestSource, songInfo, lxQuality);
    if (url) {
      console.log('[LxMusic] 成功, 音源:', bestSource, '音质:', lxQuality);
      return { url: url, source: 'lx-' + bestSource, quality: lxQuality };
    }

    // 再试其他音源
    for (const source of availableSources) {
      if (source === bestSource) continue;
      try {
        const altUrl = await runner.getMusicUrl(source, songInfo, lxQuality);
        if (altUrl) {
          console.log('[LxMusic] 成功, 音源:', source, '音质:', lxQuality);
          return { url: altUrl, source: 'lx-' + source, quality: lxQuality };
        }
      } catch (e) {
        // 忽略单个音源失败
      }
    }
  }

  return null;
}

module.exports = {
  LxMusicRunner,
  SOURCE_NAMES,
  QUALITY_MAP,
  getActiveRunner,
  initRunner,
  setActiveRunner,
  removeRunner,
  listRunners,
  parseFromLxMusic
};
