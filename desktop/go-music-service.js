'use strict';

/**
 * 内置 go-music-api 换源服务的生命周期托管。
 *
 * 背景：go-music-api 是独立 Go 服务（上游 guohuiyuan/go-music-api），原本需要用户自己
 * 用 Docker 起。现在把官方预编译的 Windows 二进制随包分发（vendor/go-music-api/，
 * 由 build/fetch-go-music-api.js 在构建前拉取），由主进程负责启动/守护/退出清理，
 * 用户侧零配置、不需要 Docker。
 *
 * ⚠️ 上游把端口**硬编码为 8080**（main.go 的 r.Run(":8080")，无环境变量、无命令行参数），
 * 所以这里不能自由选端口，只能按「8080 已被占用就用现成的」来处理：
 *   1. 先探测 8080 是不是一个真的 go-music-api；
 *   2. 是 → 直接用（兼容用户自己跑的 Docker 实例，也避免重复启动）；
 *   3. 不是 → 启动内置二进制（它会绑定 8080）；
 *   4. 启动失败（如被别的程序占用）→ 只记日志，不抛错；换源策略自身有健康记忆，
 *      探测不到服务会自动跳过，不影响其它音源。
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
// 复用 server 层的身份探活实现（两个廉价端点），避免两处逻辑漂移
const { checkService, resetServiceHealth } = require('../server/music-sources/goMusicSwitch');

/** 上游硬编码的监听地址 */
const SERVICE_URL = 'http://127.0.0.1:8080';
/** 就绪探测：总时长与间隔 */
const READY_TIMEOUT_MS = 15000;
const READY_INTERVAL_MS = 400;
/** 启动后意外退出时的自动重启上限 */
const MAX_RESTARTS = 2;
const RESTART_DELAY_MS = 3000;

let child = null;
let spawnedByUs = false;
let stopping = false;
/** 每次 ensureRunning / stop 递增；用于作废"上一代"遗留的重启定时器（否则会级联启动多个副本） */
let epoch = 0;
let restarts = 0;
/** 本会话是否成功就绪过：只有就绪后的意外退出才值得自动重启 */
let everReady = false;
let logFd = null;
let options = null;

/**
 * 判断某地址上跑的是不是 go-music-api。
 *
 * 复用 server 层的 `checkService`（两个廉价端点组合，约 175ms），避免两处实现漂移。
 * ⚠️ 绝不能改用 /api/v1/music/switch 做探测：它对不存在的歌做多平台搜索，
 * 实测 8.7~10.8s，会把**已经健康启动**的实例误判成"没起来"，
 * 进而误杀进程并判为启动失败（2026-09-21 实测踩坑）。
 *
 * @param {string} [baseUrl]
 * @returns {Promise<boolean>}
 */
async function isGoMusicApi(baseUrl) {
  const r = await checkService(baseUrl || SERVICE_URL);
  return !!(r && r.reachable);
}

/** 轮询等待服务就绪；子进程提前退出则立刻失败 */
function waitReady(probeUrl, getExitInfo) {
  return new Promise((resolve) => {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    const tick = async () => {
      if (await isGoMusicApi(probeUrl)) {
        resolve({ ok: true });
        return;
      }
      const exit = getExitInfo();
      if (exit) {
        resolve({ ok: false, reason: '进程已退出 code=' + exit.code + '（端口 ' + SERVICE_URL + ' 可能被占用）' });
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
    console.warn('[GoMusicService] 无法打开日志文件，改用忽略输出:', e.message);
    return null;
  }
}

/**
 * 启动内置换源服务（若目标地址上已有可用实例则直接复用）。
 *
 * @param {Object} opts
 * @param {string} opts.exePath - go-music-api.exe 的真实路径（asar 外）
 * @param {string} opts.dataDir - 服务的工作目录（cookies.json 会落在这里）
 * @param {string} [opts.logFile] - 日志文件路径
 * @param {string} [opts.probeUrl] - 「是否已有实例」的探测地址，默认 SERVICE_URL。
 *   仅用于诊断/自测：上游端口写死 8080，所以当 8080 被一个**可用的**实例占着时，
 *   正常路径会直接复用、永远走不到启动分支；传入一个空闲地址即可强制验证启动流程。
 * @returns {Promise<{ok: boolean, url: string, spawned: boolean, reason?: string, pid?: number}>}
 */
async function ensureRunning(opts) {
  options = opts || {};
  stopping = false;
  const probeUrl = options.probeUrl || SERVICE_URL;

  // 1. 已有可用实例（用户自己的 Docker / 上次残留）→ 直接复用
  if (await isGoMusicApi(probeUrl)) {
    console.log('[GoMusicService] ' + probeUrl + ' 已有 go-music-api 实例，直接复用');
    return { ok: true, url: SERVICE_URL, spawned: false, reason: '已有外部实例' };
  }

  // 2. 内置二进制缺失（未执行 fetch 脚本）→ 优雅降级
  const exePath = options.exePath;
  if (!exePath || !fs.existsSync(exePath)) {
    const msg = '内置二进制不存在: ' + (exePath || '(未提供)') + '，请先执行 node build/fetch-go-music-api.js';
    console.warn('[GoMusicService] ' + msg);
    return { ok: false, url: SERVICE_URL, spawned: false, reason: msg };
  }

  // 3. 启动
  try {
    fs.mkdirSync(options.dataDir, { recursive: true });
  } catch (e) {
    console.warn('[GoMusicService] 创建工作目录失败:', e.message);
  }
  logFd = openLog(options.logFile || path.join(options.dataDir || '.', 'go-music-api.log'));

  let exitInfo = null;
  try {
    child = spawn(exePath, [], {
      cwd: options.dataDir,
      env: Object.assign({}, process.env, { GIN_MODE: 'release' }),  // 关掉 GIN debug 刷屏
      stdio: ['ignore', logFd == null ? 'ignore' : logFd, logFd == null ? 'ignore' : logFd],
      windowsHide: true
    });
  } catch (e) {
    console.warn('[GoMusicService] 启动失败:', e.message);
    return { ok: false, url: SERVICE_URL, spawned: false, reason: e.message };
  }

  spawnedByUs = true;
  const pid = child.pid;
  const myEpoch = epoch;
  console.log('[GoMusicService] 已启动内置换源服务 pid=' + pid + '，等待就绪…');

  child.on('exit', (code) => {
    // 已被 stop() 或新一轮 ensureRunning 取代 → 不处理，避免级联重启
    if (myEpoch !== epoch) return;
    child = null;
    exitInfo = { code };
    if (stopping) return;
    console.warn('[GoMusicService] 进程退出 code=' + code);
    // 只有"曾经就绪过"的意外退出才自动重启；启动阶段就失败的直接交给 waitReady 报错
    if (!everReady) return;
    if (restarts < MAX_RESTARTS) {
      restarts += 1;
      console.warn('[GoMusicService] ' + (RESTART_DELAY_MS / 1000) + 's 后尝试自动重启（第 ' + restarts + '/' + MAX_RESTARTS + ' 次）');
      setTimeout(() => {
        if (myEpoch !== epoch) return;
        ensureRunning(options).catch(() => {});
      }, RESTART_DELAY_MS);
    } else {
      console.warn('[GoMusicService] 重启次数已达上限，本会话不再尝试（换源策略会自动跳过该音源）');
    }
  });

  const ready = await waitReady(probeUrl, () => exitInfo);
  if (ready.ok) {
    everReady = true;
    restarts = 0;
    // 启动期间若有解析请求先打到 8080，会被策略记成「服务离线」并冷却 3 分钟；
    // 服务既然已就绪，就把这个冷却清掉，避免"服务起来了但一直不走换源"。
    resetServiceHealth();
    console.log('[GoMusicService] 就绪: ' + SERVICE_URL + '（pid=' + pid + '）');
    return { ok: true, url: SERVICE_URL, spawned: true, pid: pid };
  }

  console.warn('[GoMusicService] 启动失败: ' + ready.reason);
  stop();
  return { ok: false, url: SERVICE_URL, spawned: false, reason: ready.reason };
}

/** 退出清理：只杀自己启动的进程，不动用户自己的 Docker 实例 */
function stop() {
  stopping = true;
  epoch += 1;   // 作废所有在途的重启定时器
  if (child && spawnedByUs) {
    try { child.kill(); } catch (e) { /* 已退出 */ }
    console.log('[GoMusicService] 已停止内置换源服务');
  }
  child = null;
  spawnedByUs = false;
  everReady = false;
  if (logFd != null) {
    try { fs.closeSync(logFd); } catch (e) { /* ignore */ }
    logFd = null;
  }
}

/** 当前状态（供诊断/日志用） */
function getStatus() {
  return {
    url: SERVICE_URL,
    spawnedByUs: spawnedByUs,
    running: !!child,
    pid: child ? child.pid : null,
    restarts: restarts
  };
}

module.exports = {
  SERVICE_URL,
  ensureRunning,
  isGoMusicApi,
  stop,
  getStatus
};
