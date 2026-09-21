'use strict';

/**
 * 内置酷狗 API 服务（vendor/kugou-api，MakcRe/KuGouMusicApi）的生命周期托管。
 *
 * 与 go-music-service 的差异：
 *  - 这是 Node 项目（非 Go 二进制），直接 spawn node app.js；
 *  - 端口可自选（3656），不与用户其它实例冲突；
 *  - 必须以 platform=lite（酷狗概念版）运行——用户的会员是概念版，
 *    ⚠️ 概念版与手机版的 token 不通用，切换平台会导致已保存的登录态失效；
 *  - 必须剥离 HTTP(S)_PROXY 代理变量：酷狗是国内服务，走用户本机代理
 *    （经常间歇掉线）反而会"目标计算机积极拒绝"，导致整层 502。
 *
 * 启动失败一律优雅降级：kugou 策略自身有免登录回退路径，不影响其它音源。
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

/** 内置服务的监听地址 */
const SERVICE_URL = 'http://127.0.0.1:3656';
const READY_TIMEOUT_MS = 15000;
const READY_INTERVAL_MS = 400;
const MAX_RESTARTS = 2;
const RESTART_DELAY_MS = 3000;

let child = null;
let spawnedByUs = false;
let stopping = false;
let epoch = 0;
let restarts = 0;
let everReady = false;
let logFd = null;
let options = null;

/** 探活：/login/qr/key 是免登录端点，200 即服务就绪 */
async function isKugouApi(baseUrl) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    const r = await fetch((baseUrl || SERVICE_URL) + '/login/qr/key', { signal: ctrl.signal });
    clearTimeout(timer);
    if (!r.ok) return false;
    const j = await r.json().catch(() => null);
    return !!(j && (j.status === 1 || j.data));
  } catch (e) {
    return false;
  }
}

function waitReady(getExitInfo) {
  return new Promise((resolve) => {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    const tick = async () => {
      if (await isKugouApi(SERVICE_URL)) {
        resolve({ ok: true });
        return;
      }
      const exit = getExitInfo();
      if (exit) {
        resolve({ ok: false, reason: '进程已退出 code=' + exit.code });
        return;
      }
      if (Date.now() >= deadline) {
        resolve({ ok: false, reason: '启动超时（' + READY_TIMEOUT_MS + 'ms 内未就绪）' });
        return;
      }
      setTimeout(tick, READY_INTERVAL_MS);
    };
    tick();
  });
}

function openLog(logFile) {
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    return fs.openSync(logFile, 'a');
  } catch (e) {
    return null;
  }
}

/** 剥离代理变量 + 设置概念版平台与端口 */
function buildEnv() {
  const env = Object.assign({}, process.env);
  delete env.HTTP_PROXY; delete env.HTTPS_PROXY;
  delete env.http_proxy; delete env.https_proxy;
  env.NO_PROXY = '*'; env.no_proxy = '*';
  env.platform = 'lite';
  env.PORT = '3656';
  env.HOST = '127.0.0.1';
  return env;
}

/**
 * 启动内置酷狗 API 服务（若已有可用实例则复用）。
 * @param {Object} opts
 * @param {string} opts.appDir  - vendor/kugou-api 的真实路径（asar 外）
 * @param {string} [opts.nodeExe] - node 可执行文件路径（缺省用 process.execPath）
 * @param {string} [opts.logFile]
 */
async function ensureRunning(opts) {
  options = opts || {};
  stopping = false;

  if (await isKugouApi(SERVICE_URL)) {
    return { ok: true, url: SERVICE_URL, spawned: false, reason: '已有实例' };
  }

  const appDir = options.appDir;
  const appEntry = appDir ? path.join(appDir, 'app.js') : '';
  if (!appDir || !fs.existsSync(appEntry)) {
    const msg = 'vendor/kugou-api 不存在: ' + (appDir || '(未提供)') + '（需要先拉取 KuGouMusicApi 并安装依赖）';
    console.warn('[KugouService] ' + msg);
    return { ok: false, url: SERVICE_URL, spawned: false, reason: msg };
  }
  const depsDir = path.join(appDir, 'node_modules');
  if (!fs.existsSync(depsDir)) {
    const msg = 'vendor/kugou-api 依赖未安装（node_modules 缺失），请执行 npm install';
    console.warn('[KugouService] ' + msg);
    return { ok: false, url: SERVICE_URL, spawned: false, reason: msg };
  }

  logFd = openLog(options.logFile || path.join(options.dataDir || appDir, 'kugou-api.log'));

  let exitInfo = null;
  try {
    // spawn 'node' 走 PATH（desktop 模式由 npm start 启动，PATH 里必有 node）；
    // KUGOU_NODE_EXE 环境变量可显式指定
    child = spawn(options.nodeExe || 'node', [appEntry], {
      cwd: appDir,
      env: buildEnv(),
      stdio: ['ignore', logFd == null ? 'ignore' : logFd, logFd == null ? 'ignore' : logFd],
      windowsHide: true
    });
  } catch (e) {
    return { ok: false, url: SERVICE_URL, spawned: false, reason: e.message };
  }

  spawnedByUs = true;
  const pid = child.pid;
  const myEpoch = epoch;
  console.log('[KugouService] 已启动内置酷狗 API（概念版） pid=' + pid + '，等待就绪…');

  child.on('exit', (code) => {
    if (myEpoch !== epoch) return;
    child = null;
    exitInfo = { code };
    if (stopping) return;
    console.warn('[KugouService] 进程退出 code=' + code);
    if (!everReady) return;
    if (restarts < MAX_RESTARTS) {
      restarts += 1;
      setTimeout(() => {
        if (myEpoch !== epoch) return;
        ensureRunning(options).catch(() => {});
      }, RESTART_DELAY_MS);
    }
  });

  const ready = await waitReady(() => exitInfo);
  if (ready.ok) {
    everReady = true;
    restarts = 0;
    console.log('[KugouService] 就绪: ' + SERVICE_URL + '（pid=' + pid + '）');
    return { ok: true, url: SERVICE_URL, spawned: true, pid: pid };
  }

  console.warn('[KugouService] 启动失败: ' + ready.reason);
  stop();
  return { ok: false, url: SERVICE_URL, spawned: false, reason: ready.reason };
}

function stop() {
  stopping = true;
  epoch += 1;
  if (child && spawnedByUs) {
    try { child.kill(); } catch (e) { /* 已退出 */ }
  }
  child = null;
  spawnedByUs = false;
  everReady = false;
  if (logFd != null) {
    try { fs.closeSync(logFd); } catch (e) { /* ignore */ }
    logFd = null;
  }
}

function getStatus() {
  return { url: SERVICE_URL, running: !!child, pid: child ? child.pid : null };
}

/** 对内置服务发起 GET（pathAndQuery 已含 query；headers 可带 Cookie 等） */
async function apiGet(pathAndQuery, timeoutMs, headers) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || 10000);
  try {
    const r = await fetch(SERVICE_URL + pathAndQuery, { signal: ctrl.signal, headers: headers || {} });
    return await r.json().catch(() => null);
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  SERVICE_URL,
  ensureRunning,
  isKugouApi,
  apiGet,
  stop,
  getStatus
};
