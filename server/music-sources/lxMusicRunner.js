'use strict';

/**
 * LX Music 脚本执行器（worker_threads 沙盒版）
 *
 * 每个脚本跑在独立 worker 线程里（vm 沙盒 + 桥接对象整体都在子线程）：
 *  - 脚本 handler 里的**同步 while(true)** 只会烧子线程，主线程超时后直接 terminate，
 *    不再像旧的进程内 vm 那样把整个本地服务卡死（vm 的 timeout 只护 runInContext，
 *    后续 handler 调用没有保护）；
 *  - never-resolve 的 Promise / 永久 setInterval 随 terminate 一起销毁，主进程无泄漏面；
 *  - worker 意外死亡后，下次调用用存档脚本自动重建（self-heal）；
 *  - 沙盒 HTTP 响应体上限 2MB，防脚本无界累积 OOM；worker 堆上限 256MB。
 *
 * 脚本格式（两种都支持）：
 *  ① 旧版：module.exports = { sources: { wy: { getMusicUrl(songInfo, quality) }, ... } }
 *         也兼容「IIFE 返回对象」和「直接导出音源映射」两种写法；
 *  ② 事件式：lx.on('request', (info) => ...) —— 对齐真实 LX 客户端 2.x。
 *
 * 支持音源 key：wy 网易云 / kw 酷我 / mg 咪咕 / kg 酷狗 / tx QQ音乐
 */

const { Worker } = require('worker_threads');

/** 音源中文名称映射 */
const SOURCE_NAMES = {
  wy: '网易云',
  kw: '酷我',
  mg: '咪咕',
  kg: '酷狗',
  tx: 'QQ音乐'
};

/** 音质映射（用户音质 → LX Music 音质标识） */
const QUALITY_MAP = {
  standard: '128k',
  higher: '320k',
  exhigh: '320k',
  lossless: 'flac',
  hires: 'flac',
  jymaster: 'flac'
};

/** 音质降级链：从高到低 */
const QUALITY_CASCADE = ['flac', '320k', '128k'];

/** 旧版脚本音源优先级（对齐 Bhands_Web 实测正确率排序） */
const LX_SOURCE_PRIORITY = ['wy', 'kw', 'kg', 'tx', 'mg'];

/** 事件式脚本显式请求顺序：wy 实测 100% 正确，kw 仅 60%（脚本默认落到 kw） */
const EVENT_SOURCE_ORDER = ['wy', 'kw'];

/** 脚本数量上限（防启动时间膨胀） */
const MAX_SCRIPTS = 12;

/** 单脚本大小上限（与前端/Web 版一致，500KB） */
const MAX_SCRIPT_BYTES = 512 * 1024;

/** 沙盒 HTTP 响应体上限：脚本（互联网上的第三方 LX 源）无界累积可 OOM */
const MAX_SANDBOX_BODY_BYTES = 2 * 1024 * 1024;

/** worker 堆上限（默认会与主进程共享上限） */
const WORKER_HEAP_MB = 256;

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
 * 沙盒预置脚本：在沙盒 realm 内部安装 console / 定时器 / lx API / module。
 * 所有包装函数都在沙盒内创建，桥接对象只经闭包触达、不直接暴露。
 * 整体包裹在 IIFE 中：顶层 const/let 会留在沙盒全局词法作用域，
 * 会与用户脚本自身的同名顶层声明（如 const b）冲突。
 * （本字符串原样经 workerData 传入 worker，注意保持其中无反引号与模板插值。）
 */
const SANDBOX_PRELUDE = `
(() => {
const b = globalThis.__bridge;
globalThis.console = { log(){}, warn(){}, error(){}, info(){}, debug(){} };
globalThis.setTimeout = (fn, ms, ...args) => b.setTimeout(fn, ms, ...args);
globalThis.clearTimeout = (t) => b.clearTimeout(t);
globalThis.setInterval = (fn, ms, ...args) => b.setInterval(fn, ms, ...args);
globalThis.clearInterval = (t) => b.clearInterval(t);
globalThis.fetch = (url, opts) => b.httpRequest(String(url), opts || {});
globalThis.module = { exports: {} };
globalThis.exports = globalThis.module.exports;
const ci = b.scriptInfo;
globalThis.lx = {
  EVENT_NAMES: { inited: 'inited', request: 'request', updateAlert: 'updateAlert' },
  version: '2.9.0',
  currentScriptInfo: {
    name: ci.name || '', description: ci.description || '', version: ci.version || '',
    author: ci.author || '', homepage: ci.homepage || '', rawScript: ci.rawScript || ''
  },
  env: 'node',
  utils: {
    buffer: {
      from: (s, enc) => b.bufFrom(s, enc),
      bufToString: (buf, enc) => b.bufToString(buf, enc)
    },
    crypto: {
      md5: (str) => b.md5(str),
      randomBytes: (size) => b.randomBytes(size),
      rsaEncrypt: (data, key) => b.rsaEncrypt(data, key),
      aesEncrypt: (data, mode, key, iv) => b.aesEn(data, mode, key, iv),
      aesEn: (data, mode, key, iv) => b.aesEn(data, mode, key, iv),
      aesDe: (data, mode, key, iv) => b.aesDe(data, mode, key, iv),
      aesDecrypt: (data, mode, key, iv) => b.aesDe(data, mode, key, iv)
    },
    zlib: {
      inflate: (buf) => b.zlibInflate(buf),
      deflate: (buf) => b.zlibDeflate(buf)
    }
  },
  request: (url, opts, cb) => b.request(String(url), opts || {}, cb),
  on: (event, handler) => { (b.handlers[event] = b.handlers[event] || []).push(handler); },
  send: (event, ...args) => {
    const hs = b.handlers[event] || [];
    return hs.length ? hs[0](...args) : undefined;
  }
};
delete globalThis.__bridge;
})();
`;

/**
 * worker 线程代码（new Worker(code, { eval: true })）—— 整个 LX 沙盒都活在子线程里。
 *
 * 为什么搬进 worker（对齐 Bhands_Web 2026-09-11 的结论）：
 *  ① 脚本 handler 里的同步 while(true) 曾能阻塞整个事件循环；现在只烧 worker 线程，
 *     主线程超时后 terminate；
 *  ② never-resolve 的 Promise / 永久 setInterval 随 terminate 一起销毁；
 *  ③ vm 逃逸（.constructor.constructor）即使发生也只落到一次性 worker 的 Node 环境，
 *     拿不到主进程的会话/缓存/路由状态。
 *
 * ⚠️ 本字符串内禁用反引号与模板插值（${）—— 全部用单引号 + 字符串拼接。
 */
const WORKER_CODE = `
(async () => {
  var wt = await import('node:worker_threads');
  var parentPort = wt.parentPort;
  var workerData = wt.workerData;
  var vm = (await import('node:vm')).default;
  var crypto = (await import('node:crypto')).default;
  var http = (await import('node:http')).default;
  var https = (await import('node:https')).default;
  var zlib = (await import('node:zlib')).default;
  var dnsPromises = (await import('node:dns')).promises;
  var net = (await import('node:net')).default;

  var MAX_BODY = workerData.maxBody || 2097152;
  var CALL_TIMEOUT = workerData.callTimeout || 12000;
  var BLOCK_PRIVATE = !!workerData.blockPrivateIp;

  function toBuf(v) {
    if (v && v.bufToArray) return Buffer.from(v.bufToArray());
    if (typeof v === 'string') return Buffer.from(v, 'utf8');
    return Buffer.from(String(v), 'utf8');
  }
  function bufferView(buf) {
    return {
      toString: function (enc) { return buf.toString(enc || 'utf8'); },
      length: buf.length,
      slice: function (a, b) { return bufferView(buf.subarray(a, b)); },
      bufToArray: function () { return Array.from(buf); }
    };
  }
  function parseScriptInfo(s) {
    var info = {};
    var re = /@(name|description|version|author|homepage)\\s+(.+)/gi;
    var m;
    while ((m = re.exec(s))) {
      var k = m[1].toLowerCase();
      if (!info[k]) info[k] = m[2].trim();
    }
    return info;
  }

  // ---- 内网地址判定（仅在 blockPrivateIp 开启时拦截）----
  // 桌面版默认不拦：用户可能自建 LAN 音源服务；开启后与 Web 版行为一致。
  function isPrivateIp(ip) {
    if (net.isIPv4(ip)) {
      var p = ip.split('.');
      var a = +p[0], b = +p[1];
      if (a === 0 || a === 10 || a === 127) return true;
      if (a === 169 && b === 254) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 192 && b === 168) return true;
      if (a === 100 && b >= 64 && b <= 127) return true;
      if (a >= 224) return true;
      return false;
    }
    var s = String(ip).toLowerCase();
    if (s === '::1' || s === '::') return true;
    if (s.indexOf('::ffff:127.') === 0 || s.indexOf('::ffff:10.') === 0 || s.indexOf('::ffff:192.168.') === 0) return true;
    if (s.indexOf('fc') === 0 || s.indexOf('fd') === 0) return true;
    if (s.indexOf('fe8') === 0 || s.indexOf('fe9') === 0 || s.indexOf('fea') === 0 || s.indexOf('feb') === 0) return true;
    return false;
  }
  // 解析目标主机并把连接钉在解析结果上，防 DNS rebinding 二次解析
  function publicLookup(hostname) {
    return dnsPromises.lookup(hostname, { all: true, verbatim: true }).then(function (addrs) {
      if (!addrs || !addrs.length) throw new Error('DNS 解析失败: ' + hostname);
      if (BLOCK_PRIVATE) {
        for (var i = 0; i < addrs.length; i++) {
          if (isPrivateIp(addrs[i].address)) throw new Error('内网地址不可访问: ' + hostname + ' -> ' + addrs[i].address);
        }
      }
      return addrs[0];
    });
  }
  function pinnedLookup(addr) {
    return function (host, opts, cb) {
      process.nextTick(function () { cb(null, addr.address, addr.family); });
    };
  }

  function sandboxHttpRequest(url, options) {
    options = options || {};
    return new Promise(function (resolve, reject) {
      var urlObj = new URL(url);
      if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
        reject(new Error('不支持的协议: ' + urlObj.protocol));
        return;
      }
      var client = urlObj.protocol === 'https:' ? https : http;
      publicLookup(urlObj.hostname).then(function (addr) {
        var reqOpts = {
          hostname: urlObj.hostname,
          port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
          path: urlObj.pathname + urlObj.search,
          method: options.method || 'GET',
          headers: options.headers || {},
          timeout: options.timeout || 15000,
          lookup: pinnedLookup(addr)
        };
        var req = client.request(reqOpts, function (res) {
          var body = '';
          var bytes = 0;
          res.setEncoding('utf8');
          res.on('data', function (chunk) {
            bytes += Buffer.byteLength(chunk);
            if (bytes > MAX_BODY) { req.destroy(); reject(new Error('Response too large')); return; }
            body += chunk;
          });
          res.on('end', function () { resolve({ status: res.statusCode || 0, headers: res.headers, body: body }); });
        });
        req.on('error', reject);
        req.on('timeout', function () { req.destroy(); reject(new Error('Request timeout')); });
        if (options.body) req.write(options.body);
        req.end();
      }).catch(reject);
    });
  }

  // 沙盒定时器登记表（worker 内）：terminate 会整体回收，这里再兜一层显式清理
  var sandboxTimers = new Set();
  function trackedTimeout(fn, ms) {
    var rest = Array.prototype.slice.call(arguments, 2);
    var t = setTimeout(function () { sandboxTimers.delete(t); fn.apply(null, rest); }, ms);
    sandboxTimers.add(t);
    return t;
  }
  function trackedInterval(fn, ms) {
    var rest = Array.prototype.slice.call(arguments, 2);
    var t = setInterval(function () { fn.apply(null, rest); }, ms);
    sandboxTimers.add(t);
    return t;
  }
  function clearTracked(t) {
    if (t == null) return;
    sandboxTimers.delete(t);
    clearTimeout(t); clearInterval(t);
  }

  var lxHandlers = {};
  var bridge = {
    handlers: lxHandlers,
    setTimeout: trackedTimeout, clearTimeout: clearTracked,
    setInterval: trackedInterval, clearInterval: clearTracked,
    httpRequest: sandboxHttpRequest,
    scriptInfo: (function () {
      var info = parseScriptInfo(workerData.script);
      info.rawScript = workerData.script;
      return info;
    })(),
    request: function (url, opts, cb) {
      try {
        var urlObj = new URL(url);
        var client = urlObj.protocol === 'https:' ? https : http;
        var method = ((opts && opts.method) || 'GET').toUpperCase();
        var headers = Object.assign({}, (opts && opts.headers) || {});
        var body = opts && opts.body;
        if (opts && opts.form && typeof opts.form === 'object') {
          body = new URLSearchParams(opts.form).toString();
          headers['Content-Type'] = headers['Content-Type'] || 'application/x-www-form-urlencoded';
        } else if (opts && opts.formData && typeof opts.formData === 'object') {
          var boundary = '----lxform' + crypto.randomBytes(8).toString('hex');
          var parts = [];
          var keys = Object.keys(opts.formData);
          for (var i = 0; i < keys.length; i++) {
            parts.push('--' + boundary + '\\r\\nContent-Disposition: form-data; name="' + keys[i] + '"\\r\\n\\r\\n' + String(opts.formData[keys[i]]) + '\\r\\n');
          }
          parts.push('--' + boundary + '--\\r\\n');
          body = parts.join('');
          headers['Content-Type'] = headers['Content-Type'] || ('multipart/form-data; boundary=' + boundary);
        }
        publicLookup(urlObj.hostname).then(function (addr) {
          var reqOpts = {
            hostname: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: method,
            headers: headers,
            timeout: (opts && opts.timeout) || 15000,
            lookup: pinnedLookup(addr)
          };
          var req = client.request(reqOpts, function (res) {
            var data = '';
            var bytes = 0;
            res.setEncoding('utf8');
            res.on('data', function (chunk) {
              bytes += Buffer.byteLength(chunk);
              if (bytes > MAX_BODY) { req.destroy(); cb(new Error('Response too large')); return; }
              data += chunk;
            });
            res.on('end', function () {
              var parsed = data;
              try { parsed = JSON.parse(data); } catch (e) {}
              res.body = parsed;
              cb(null, res, parsed);
            });
          });
          req.on('error', function (e) { cb(e); });
          req.on('timeout', function () { req.destroy(); cb(new Error('timeout')); });
          if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
          req.end();
          // 契约：返回取消函数
          return function () { req.destroy(); };
        }).catch(function (e) { cb(e); });
        return function () {};
      } catch (e) { cb(e); return function () {}; }
    },
    bufFrom: function (s, enc) { return bufferView(Buffer.from(s, enc || 'utf8')); },
    bufToString: function (buf, enc) {
      var b = (buf && buf.bufToArray) ? Buffer.from(buf.bufToArray()) : toBuf(buf);
      return b.toString(enc || 'utf8');
    },
    md5: function (str) { return crypto.createHash('md5').update(toBuf(str)).digest('hex'); },
    randomBytes: function (size) { return bufferView(crypto.randomBytes(size)); },
    rsaEncrypt: function (data, key) {
      var pem = Buffer.isBuffer(key) ? key : Buffer.from(String(key));
      return bufferView(crypto.publicEncrypt({ key: pem, padding: crypto.constants.RSA_PKCS1_PADDING }, toBuf(data)));
    },
    aesEn: function (data, mode, key, iv) {
      var cipher = crypto.createCipheriv(mode, toBuf(key), iv != null ? toBuf(iv) : null);
      return bufferView(Buffer.concat([cipher.update(toBuf(data)), cipher.final()]));
    },
    aesDe: function (data, mode, key, iv) {
      var decipher = crypto.createDecipheriv(mode, toBuf(key), iv != null ? toBuf(iv) : null);
      return bufferView(Buffer.concat([decipher.update(toBuf(data)), decipher.final()]));
    },
    zlibInflate: function (buf) {
      return new Promise(function (resolve, reject) {
        zlib.inflate(toBuf(buf), function (e, r) { if (e) reject(e); else resolve(bufferView(r)); });
      });
    },
    zlibDeflate: function (buf) {
      return new Promise(function (resolve, reject) {
        zlib.deflate(toBuf(buf), function (e, r) { if (e) reject(e); else resolve(bufferView(r)); });
      });
    }
  };

  var context = vm.createContext({});
  context.__bridge = bridge;
  vm.runInContext(workerData.prelude, context, { timeout: 5000 });

  // 执行用户脚本。包一层 IIFE 以兼容「脚本直接 return 对象」的写法
  // （module.exports 写法不受影响：module 在沙盒全局，IIFE 内赋值依然可见）。
  var wrapped =
    '(function(){\\n' +
    '  var __r__ = null, __e__ = null;\\n' +
    '  try { __r__ = (function(){\\n' + workerData.script + '\\n  })(); } catch (e) { __e__ = e; }\\n' +
    '  if (__r__ && typeof __r__ === "object") module.exports = __r__;\\n' +
    '  return __e__ ? String((__e__ && __e__.message) || __e__) : null;\\n' +
    '})()';
  var scriptError = vm.runInContext(wrapped, context, { timeout: 15000 });

  // 事件式脚本（lx.on(request)）优先；否则按旧版 module.exports 提取 sources
  var isEvent = !!(lxHandlers['request'] && lxHandlers['request'].length);
  var legacySources = {};
  var sourceKeys = [];
  if (isEvent) {
    sourceKeys = ['_lxEvent'];
  } else {
    var exported = (context.module && context.module.exports) || {};
    if (exported.sources && typeof exported.sources === 'object') {
      legacySources = exported.sources;
    } else if (exported.default && exported.default.sources && typeof exported.default.sources === 'object') {
      legacySources = exported.default.sources;
    } else {
      var eks = Object.keys(exported);
      for (var k = 0; k < eks.length; k++) {
        var v = exported[eks[k]];
        if (v && typeof v === 'object') {
          var hasMethod = Object.keys(v).some(function (kk) { return typeof v[kk] === 'function'; });
          if (hasMethod) { legacySources = v; break; }
        }
      }
    }
    sourceKeys = Object.keys(legacySources);
  }
  if (!sourceKeys.length) {
    parentPort.postMessage({ type: 'init-error', message: scriptError || '脚本未导出有效音源' });
    return;
  }

  parentPort.on('message', function (msg) {
    if (!msg || msg.type !== 'musicUrl') return;
    var p;
    if (isEvent) {
      var handler = lxHandlers['request'][0];
      var info = {
        source: msg.sourceKey === '_lxEvent' ? 'kw' : msg.sourceKey,
        action: 'musicUrl',
        info: { musicInfo: msg.songInfo, type: msg.quality }
      };
      p = Promise.resolve().then(function () { return handler(info); }).then(function (url) {
        return (typeof url === 'string' && url.indexOf('http') === 0) ? url : null;
      }).catch(function () { return null; });
    } else {
      var source = legacySources[msg.sourceKey];
      var fn = source && (source.getMusicUrl || source.get_url || source.getUrl);
      if (typeof fn !== 'function') { p = Promise.resolve(null); }
      else {
        p = Promise.resolve().then(function () { return fn(msg.songInfo, msg.quality); }).then(function (r) {
          if (r && typeof r === 'string' && r.indexOf('http') === 0) return r;
          if (r && r.url && typeof r.url === 'string') return r.url;
          return null;
        }).catch(function () { return null; });
      }
    }
    var done = false;
    var t = setTimeout(function () {
      if (done) return;
      done = true;
      parentPort.postMessage({ type: 'musicUrl-result', seq: msg.seq, url: null });
    }, CALL_TIMEOUT);
    p.then(function (url) {
      if (done) return;
      done = true; clearTimeout(t);
      parentPort.postMessage({ type: 'musicUrl-result', seq: msg.seq, url: url });
    }, function () {
      if (done) return;
      done = true; clearTimeout(t);
      parentPort.postMessage({ type: 'musicUrl-result', seq: msg.seq, url: null });
    });
  });

  parentPort.postMessage({ type: 'ready', sources: sourceKeys, isEvent: isEvent, scriptError: scriptError || null });
})().catch(function (e) {
  import('node:worker_threads').then(function (wt) {
    wt.parentPort.postMessage({ type: 'init-error', message: String((e && e.message) || e) });
  }).catch(function () {});
});
`;

/** 单次 handler 调用超时（默认 12s） */
function callTimeoutMs() {
  const v = Number(process.env.BHANDSMUSIC_LX_CALL_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : 12000;
}

/** 脚本初始化看门狗超时（默认 20s） */
function initTimeoutMs() {
  const v = Number(process.env.BHANDSMUSIC_LX_INIT_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : 20000;
}

/**
 * LX Music 脚本执行器（worker 线程句柄）
 * 沙盒（vm + 桥接 + 脚本）整体活在子线程；超时/删除时 terminate。
 */
class LxMusicRunner {
  /**
   * @param {string} id - 脚本 ID
   * @param {string} script - 脚本内容
   * @param {string} name - 脚本名称
   */
  constructor(id, script, name) {
    this._id = id;
    this._script = script;
    this._name = name || 'unknown';
    this._sources = [];
    this._isEvent = false;
    this._worker = null;
    this._seq = 0;
    this._pending = new Map();
    this._dead = false;
  }

  /** 是否已初始化（拿到音源或识别为事件式脚本） */
  isInitialized() {
    return this._sources.length > 0 || this._isEvent;
  }

  /** 可用音源 key 列表 */
  getAvailableSourceKeys() {
    return this._sources.slice();
  }

  /** 事件式脚本（lx.on('request')）*/
  isEventScript() {
    return this._isEvent;
  }

  /** 起一个 worker 并等到 ready / init-error / 看门狗超时 */
  _spawn() {
    return new Promise((resolve, reject) => {
      let settled = false;
      let worker;
      try {
        worker = new Worker(WORKER_CODE, {
          eval: true,
          workerData: {
            prelude: SANDBOX_PRELUDE,
            script: this._script,
            name: this._name,
            maxBody: MAX_SANDBOX_BODY_BYTES,
            callTimeout: callTimeoutMs(),
            blockPrivateIp: process.env.BHANDSMUSIC_LX_BLOCK_PRIVATE_IP === '1'
          },
          resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB }
        });
      } catch (err) {
        reject(err);
        return;
      }

      // unref：worker 不参与「保持事件循环存活」的引用计数。
      // 服务正常运行时 HTTP listener 撑着进程，worker 照常工作；
      // 服务关闭/进程退出时 worker 不再拖住退出（旧版进程内 vm 的定时器会拖住）。
      try { worker.unref(); } catch (e) { /* 旧版本 Node 无 unref 则忽略 */ }

      const watchdog = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { worker.terminate(); } catch (e) { /* 已退出 */ }
        reject(new Error('脚本初始化超时'));
      }, initTimeoutMs());

      worker.on('message', (msg) => {
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'ready') {
          if (settled) return;
          settled = true;
          clearTimeout(watchdog);
          this._sources = Array.isArray(msg.sources) ? msg.sources : [];
          this._isEvent = !!msg.isEvent;
          this._worker = worker;
          this._dead = false;
          if (msg.scriptError) {
            console.warn('[LxMusicRunner] 脚本顶层抛错（已按导出内容继续）:', msg.scriptError);
          }
          resolve();
          return;
        }
        if (msg.type === 'init-error') {
          if (settled) return;
          settled = true;
          clearTimeout(watchdog);
          try { worker.terminate(); } catch (e) { /* 已退出 */ }
          reject(new Error(String(msg.message || '脚本初始化失败')));
          return;
        }
        if (msg.type === 'musicUrl-result') {
          const resolveUrl = this._pending.get(msg.seq);
          if (resolveUrl) {
            this._pending.delete(msg.seq);
            resolveUrl(typeof msg.url === 'string' ? msg.url : null);
          }
        }
      });

      worker.on('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(watchdog);
          try { worker.terminate(); } catch (e) { /* 已退出 */ }
          reject(err);
          return;
        }
        console.warn('[LxMusicRunner] worker 异常退出，下次调用时自动重建:', (err && err.message) || err);
        this.kill();
      });

      worker.on('exit', () => {
        if (!settled) {
          settled = true;
          clearTimeout(watchdog);
          reject(new Error('worker 在初始化期间退出'));
        }
      });
    });
  }

  /**
   * 初始化执行器，加载并执行脚本
   * @param {string} [scriptContent] - 不传则用构造时的脚本
   * @param {string} [scriptName]
   * @returns {Promise<boolean>}
   */
  async init(scriptContent, scriptName) {
    if (typeof scriptContent === 'string') this._script = scriptContent;
    if (scriptName) this._name = scriptName;
    try {
      await this._spawn();
      console.log(
        '[LxMusicRunner] worker 沙盒加载成功:',
        this._name,
        '音源:',
        this._sources.length
          ? this._sources.map((k) => k + '(' + (SOURCE_NAMES[k] || k) + ')').join(', ')
          : '(事件式)'
      );
      return true;
    } catch (error) {
      console.error('[LxMusicRunner] 脚本执行失败:', (error && error.message) || error);
      return false;
    }
  }

  /** 调用前确保 worker 存活；死亡则用存档脚本自动重建 */
  async _ensureAlive() {
    if (this._worker && !this._dead) return true;
    this._worker = null;
    this._dead = false;
    for (const resolve of this._pending.values()) resolve(null);
    this._pending.clear();
    try {
      await this._spawn();
      return this.isInitialized();
    } catch (e) {
      return false;
    }
  }

  /**
   * 获取音乐 URL
   * @param {string} sourceKey - 音源 key (wy, kw, mg, kg, tx) 或事件式 '_lxEvent'
   * @param {Object} songInfo - 歌曲信息
   * @param {string} quality - 音质 (128k, 320k, flac)
   * @returns {Promise<string|null>}
   */
  async getMusicUrl(sourceKey, songInfo, quality) {
    if (!(await this._ensureAlive())) return null;
    const worker = this._worker;
    if (!worker) return null;
    const seq = ++this._seq;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        // 同步死循环 / never-resolve：整个 worker 直接 terminate（只烧子线程）；
        // 下次调用 _ensureAlive 会用存档脚本自动重建
        console.warn('[LxMusicRunner] 调用超时（' + callTimeoutMs() + 'ms），terminate worker:', this._name);
        this._pending.delete(seq);
        this.kill();
        resolve(null);
      }, callTimeoutMs());

      this._pending.set(seq, (url) => {
        clearTimeout(timer);
        resolve(url);
      });

      try {
        worker.postMessage({ type: 'musicUrl', seq, sourceKey, songInfo, quality });
      } catch (e) {
        clearTimeout(timer);
        this._pending.delete(seq);
        this.kill();
        resolve(null);
      }
    });
  }

  /** 回收资源：terminate worker —— 同步循环/定时器/泄漏面随线程一起销毁 */
  dispose() {
    this.kill();
  }

  kill() {
    if (this._worker) {
      try { this._worker.terminate(); } catch (e) { /* 已退出 */ }
    }
    this._worker = null;
    this._dead = true;
    for (const resolve of this._pending.values()) resolve(null);
    this._pending.clear();
  }
}

// ============================================================
// 全局执行器实例（支持多脚本管理）
// ============================================================
const _runners = {};
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

/** 脚本数量是否未达上限 */
function canAddScript() {
  return Object.keys(_runners).length < MAX_SCRIPTS;
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
  if (!canAddScript()) {
    console.warn('[LxMusicRunner] 脚本数量已达上限（' + MAX_SCRIPTS + '），拒绝加载:', scriptName || scriptId);
    return null;
  }
  if (typeof scriptContent !== 'string' || scriptContent.length > MAX_SCRIPT_BYTES) {
    console.warn('[LxMusicRunner] 脚本内容为空或超过 ' + Math.round(MAX_SCRIPT_BYTES / 1024) + 'KB，拒绝加载:', scriptName || scriptId);
    return null;
  }

  const runner = new LxMusicRunner(scriptId, scriptContent, scriptName);
  const success = await runner.init();

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
 * 移除一个执行器（terminate 其 worker）
 * @param {string} scriptId
 */
function removeRunner(scriptId) {
  const runner = _runners[scriptId];
  if (runner && typeof runner.dispose === 'function') {
    runner.dispose();
  }
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

/** 回收所有 worker（进程退出 / 重载时调用） */
function disposeAll() {
  for (const id of Object.keys(_runners)) {
    const runner = _runners[id];
    if (runner && typeof runner.dispose === 'function') runner.dispose();
  }
  _activeRunnerId = null;
}

// 进程退出兜底：worker 不 unref 时可能拖住退出，这里尽力 terminate
process.on('exit', function () {
  for (const id of Object.keys(_runners)) {
    try { _runners[id].kill(); } catch (e) { /* ignore */ }
  }
});

/**
 * 级联解析核心：音质降级 × 音源顺序逐个尝试，直到拿到可用直链
 * @param {LxMusicRunner} runner
 * @param {Object} p
 * @returns {Promise<{url: string, source: string, quality: string} | null>}
 */
async function resolveWithRunner(runner, p) {
  if (!runner || !runner.isInitialized()) return null;

  const available = runner.getAvailableSourceKeys();
  if (available.length === 0) return null;

  const isEvent = available.length === 1 && available[0] === '_lxEvent';

  /**
   * 事件式脚本内部按 `source` 字段路由到具体音源，**默认落到 kw**。
   * 实测（对齐 Bhands_Web）：wy 成功率 100% / 时长正确率 100% / 320k；
   * kw 成功率 100% 但时长正确率仅 60%（常匹配到 MV 或翻唱版本）。
   * 故事件式脚本显式按 wy → kw 顺序请求，不依赖脚本的默认路由。
   * mg / kg / tx 实测多返回 HTML 404 / JSON 401（非音频），排最后，由上层非音频校验拦下。
   */
  const order = isEvent
    ? EVENT_SOURCE_ORDER
    : [
      ...LX_SOURCE_PRIORITY.filter(function (s) { return available.includes(s); }),
      ...available.filter(function (s) { return !LX_SOURCE_PRIORITY.includes(s); })
    ];

  const duration = Number(p.duration) || 0;
  const minutes = Math.floor(duration / 60000);
  const seconds = Math.floor((duration % 60000) / 1000);
  const interval =
    String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');

  const songInfo = {
    songmid: String(p.id),
    name: p.name || '',
    singer: p.artists || '',
    album: p.album || '',
    interval: interval,
    img: ''
  };

  const cascade = getQualityCascade(p.quality || '320k');
  console.log('[LxMusic] 音质降级链:', cascade.join(' → '), '音源顺序:', order.join(' → '));

  for (const lxQuality of cascade) {
    for (const sourceKey of order) {
      try {
        const url = await runner.getMusicUrl(sourceKey, songInfo, lxQuality);
        if (url) {
          console.log('[LxMusic] 成功, 音源:', sourceKey, '音质:', lxQuality);
          return { url: url, source: 'lx-' + sourceKey, quality: lxQuality };
        }
      } catch (e) {
        // 忽略单个音源失败，继续下一个
      }
    }
  }

  return null;
}

/**
 * 使用 LX Music 解析音乐 URL
 * @param {Object} params
 * @param {number} params.id - 歌曲 ID
 * @param {string} params.name - 歌曲名称
 * @param {string} params.artists - 歌手名称（多个用逗号分隔）
 * @param {string} [params.album] - 专辑名称
 * @param {number} [params.duration] - 时长（毫秒）
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

  return resolveWithRunner(runner, { id, name, artists, album, duration, quality });
}

module.exports = {
  LxMusicRunner,
  SOURCE_NAMES,
  QUALITY_MAP,
  MAX_SCRIPTS,
  MAX_SCRIPT_BYTES,
  getActiveRunner,
  canAddScript,
  initRunner,
  setActiveRunner,
  removeRunner,
  listRunners,
  disposeAll,
  parseFromLxMusic
};
