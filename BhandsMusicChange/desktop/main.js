/**
 * BhandsMusic 桌面播放器 - Electron 主进程
 * 负责窗口管理、桌面歌词、壁纸模式、音乐平台登录、全局热键等功能
 */

// ==================== 依赖导入 ====================
const { app, BrowserWindow, ipcMain, shell, screen, session, globalShortcut, dialog } = require('electron');
const net = require('net');
const path = require('path');
const fs = require('fs');
const { execFile, spawn } = require('child_process');

// ==================== 全局状态变量 ====================
let mainWindow = null;                    // 主窗口实例
let localServer = null;                   // 本地 HTTP 服务器实例
let mainServerPort = 0;                   // 本地服务器监听端口
let desktopLyricsWindow = null;           // 桌面歌词窗口实例
let desktopLyricsState = {};              // 桌面歌词状态（启用、透明度、点击穿透等）
let desktopLyricsUserBounds = null;       // 用户手动拖拽后的歌词窗口位置
let desktopLyricsProgrammaticMove = false; // 是否正在程序化移动窗口（防止触发用户位置记忆）
let desktopLyricsPointerCapture = false;  // 鼠标指针是否捕获在歌词窗口内
let desktopLyricsMouseIgnored = null;     // 当前鼠标事件是否被忽略
let desktopLyricsMousePoller = null;      // 鼠标中键轮询子进程（Windows 专用）
let desktopLyricsMousePollerBuffer = '';   // 鼠标轮询输出缓冲区
let desktopLyricsHotBounds = null;        // 歌词窗口的可交互热区（相对坐标）
let desktopLyricsLastMiddleAt = 0;        // 上次中键点击时间戳（防抖）
let wallpaperWindow = null;               // 壁纸窗口实例
let wallpaperState = {};                  // 壁纸模式状态
let htmlFullscreenActive = false;         // HTML5 全屏是否激活（如视频全屏）
let windowFullscreenActive = false;       // 窗口原生全屏是否激活
let mainWindowStateTimer = null;          // 主窗口状态发送防抖定时器
const registeredGlobalHotkeys = new Map(); // 已注册的全局快捷键映射（accelerator -> action）

// ==================== 窗口尺寸常量 ====================
const WINDOWED_ASPECT = 16 / 9;       // 窗口宽高比（16:9）
const WINDOWED_SCALE = 3 / 4;         // 窗口占屏幕工作区的比例
const WINDOWED_MARGIN = 32;           // 窗口与屏幕边缘的最小间距（像素）
const MIN_WINDOWED_WIDTH = 960;       // 窗口最小宽度
const MIN_WINDOWED_HEIGHT = 540;      // 窗口最小高度

// ==================== 应用信息常量 ====================
const APP_NAME = 'BhandsMusic';                                   // 应用名称
const APP_USER_MODEL_ID = 'com.bhandsmusic.desktop';              // Windows 任务栏分组标识
const APP_ICON_ICO = path.join(__dirname, '..', 'build', 'icon.ico'); // 应用图标路径

// ==================== 音乐平台登录配置 ====================
const NETEASE_LOGIN_PARTITION = 'persist:bhandsmusic-netease-login'; // 网易云登录的 session 分区（持久化）
const NETEASE_LOGIN_URL = 'https://music.163.com/#/login';        // 网易云登录页地址
const QQ_LOGIN_PARTITION = 'persist:bhandsmusic-qqmusic-login';     // QQ 音乐登录的 session 分区（持久化）
const QQ_LOGIN_URL = 'https://y.qq.com/n/ryqq/profile';           // QQ 音乐登录页地址

// ==================== Chromium 性能优化开关 ====================
// 在应用启动前设置 Chromium 命令行参数，优化音视频播放和渲染性能
const CHROMIUM_PERFORMANCE_SWITCHES = [
  ['autoplay-policy', 'no-user-gesture-required'], // 允许自动播放音频，无需用户交互
  ['ignore-gpu-blocklist'],                         // 忽略 GPU 黑名单，强制使用硬件加速
  ['enable-gpu-rasterization'],                     // 启用 GPU 光栅化
  ['enable-oop-rasterization'],                     // 启用进程外光栅化（更稳定）
  ['enable-zero-copy'],                             // 启用零拷贝纹理共享（减少内存拷贝）
  ['enable-accelerated-2d-canvas'],                 // 启用 2D Canvas 硬件加速
  ['disable-background-timer-throttling'],          // 禁止后台标签页定时器节流（保持音乐播放）
  ['disable-renderer-backgrounding'],               // 禁止后台渲染器降级
  ['disable-backgrounding-occluded-windows'],       // 禁止被遮挡窗口进入后台模式
  ['force_high_performance_gpu'],                   // 强制使用高性能独立显卡
  ['use-angle', 'd3d11'],                           // 使用 ANGLE D3D11 后端（Windows 图形兼容层）
];
for (const [name, value] of CHROMIUM_PERFORMANCE_SWITCHES) {
  if (value == null) app.commandLine.appendSwitch(name);
  else app.commandLine.appendSwitch(name, value);
}

// 请求单实例锁，防止多开
const gotSingleInstanceLock = app.requestSingleInstanceLock();

// ==================== Cookie 优先级配置 ====================
// QQ 音乐登录 Cookie 名称优先级，用于构建请求头时排序
const QQ_LOGIN_COOKIE_PRIORITY = [
  'uin',                      // QQ 号
  'qqmusic_uin',              // QQ 音乐用户标识
  'wxuin',                    // 微信登录的 uin
  'login_type',               // 登录类型（1=QQ, 2=微信）
  'qm_keyst',                 // QQ 音乐核心密钥
  'qqmusic_key',              // QQ 音乐密钥
  'p_skey',                   // QQ 平台 skey
  'skey',                     // skey
  'psrf_qqopenid',            // QQ OpenID
  'psrf_qqunionid',           // QQ UnionID
  'psrf_qqaccess_token',      // QQ Access Token
  'psrf_qqrefresh_token',     // QQ Refresh Token
  'wxopenid',                 // 微信 OpenID
  'wxunionid',                // 微信 UnionID
  'wxrefresh_token',          // 微信 Refresh Token
  'wxskey',                   // 微信 skey
  'p_uin',                    // 平台 uin
  'ptcz',                     // QQ 登录 token
  'RK',                       // QQ 登录 token
];
// 网易云音乐登录 Cookie 名称优先级
const NETEASE_LOGIN_COOKIE_PRIORITY = [
  'MUSIC_U',                  // 网易云核心登录 token
  '__csrf',                   // CSRF 防护 token
  'NMTID',                    // 网易云音乐设备 ID
  'MUSIC_A',                  // 音乐 A 类 token
  '__remember_me',            // 记住登录状态
  '_ntes_nuid',               // 网易用户 ID
  '_ntes_nnid',               // 网易网络 ID
  'WEVNSM',                   // 网易云会话标记
  'WNMCID',                   // 网易云客户端 ID
  'JSESSIONID-WYYY',         // 网易云会话 ID
];

// ==================== 网络工具函数 ====================

/**
 * 从指定端口开始查找可用端口
 * @param {number} startPort - 起始端口号
 * @returns {Promise<number>} 可用的端口号
 */
function findOpenPort(startPort) {
  return new Promise((resolve, reject) => {
    function tryPort(port) {
      const tester = net.createServer();
      tester.once('error', (err) => {
        if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
          tryPort(port + 1); // 端口被占用，尝试下一个
          return;
        }
        reject(err);
      });
      tester.once('listening', () => {
        tester.close(() => resolve(port)); // 端口可用，关闭测试服务器后返回
      });
      tester.listen(port, '127.0.0.1');
    }
    tryPort(startPort);
  });
}

/**
 * 等待服务器开始监听
 * @param {object} server - HTTP 服务器实例
 * @returns {Promise<void>}
 */
function waitForServer(server) {
  if (!server || server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
}

// ==================== 窗口状态通信 ====================

/**
 * 向渲染进程发送窗口状态信息（最大化、全屏、焦点等）
 * @param {BrowserWindow} win - 目标窗口
 */
function sendWindowState(win) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('desktop-window-state', getWindowState(win));
}

/**
 * 向主窗口发送全局快捷键触发的动作
 * @param {string} action - 动作名称
 */
function sendGlobalHotkeyAction(action) {
  if (!mainWindow || mainWindow.isDestroyed() || !action) return;
  mainWindow.webContents.send('bhandsmusic-global-hotkey', { action });
}

// ==================== 全局快捷键管理 ====================

/** 注销所有已注册的全局快捷键 */
function unregisterBhandsMusicGlobalHotkeys() {
  for (const accelerator of registeredGlobalHotkeys.keys()) {
    try { globalShortcut.unregister(accelerator); } catch (e) {}
  }
  registeredGlobalHotkeys.clear();
}

/**
 * 配置全局快捷键绑定
 * @param {Array<{action: string, accelerator: string}>} bindings - 快捷键绑定列表
 * @returns {{ok: boolean, results: Array}} 注册结果，包含每个快捷键的成功/失败状态及冲突信息
 */
function configureBhandsMusicGlobalHotkeys(bindings = []) {
  unregisterBhandsMusicGlobalHotkeys(); // 先清除旧的绑定
  const results = [];
  const seen = new Set(); // 去重，防止同一快捷键注册多次
  for (const item of Array.isArray(bindings) ? bindings : []) {
    const action = item && String(item.action || '').trim();
    const accelerator = item && String(item.accelerator || '').trim();
    if (!action || !accelerator || seen.has(accelerator)) continue;
    seen.add(accelerator);
    let registered = false;
    try {
      // 注册全局快捷键，触发时通知渲染进程
      registered = globalShortcut.register(accelerator, () => sendGlobalHotkeyAction(action));
    } catch (error) {
      registered = false;
    }
    if (registered) {
      registeredGlobalHotkeys.set(accelerator, action);
      results.push({ action, accelerator, ok: true });
    } else {
      // 注册失败，返回冲突信息
      results.push({
        action,
        accelerator,
        ok: false,
        conflict: {
          sourceName: '系统 / 其他软件',
          sourceIcon: 'warning',
          reason: '该组合键已被占用或被系统保留',
        },
      });
    }
  }
  return { ok: true, results };
}

/**
 * 延迟发送窗口状态（防抖），用于 move/resize 等高频事件
 * @param {BrowserWindow} win - 目标窗口
 * @param {number} delay - 延迟毫秒数，默认 80ms
 */
function scheduleWindowStateSend(win, delay = 80) {
  if (!win || win.isDestroyed()) return;
  if (mainWindowStateTimer) clearTimeout(mainWindowStateTimer);
  mainWindowStateTimer = setTimeout(() => {
    mainWindowStateTimer = null;
    sendWindowState(win);
  }, delay);
}

/**
 * 判断两个矩形在 Y 轴上是否有重叠
 * @param {object} a - 矩形 A（含 y, height）
 * @param {object} b - 矩形 B（含 y, height）
 * @returns {boolean}
 */
function rectsOverlapOnY(a, b) {
  if (!a || !b) return false;
  const aTop = Number(a.y) || 0;
  const bTop = Number(b.y) || 0;
  const aBottom = aTop + (Number(a.height) || 0);
  const bBottom = bTop + (Number(b.height) || 0);
  return aBottom > bTop && bBottom > aTop;
}

/**
 * 获取窗口所在显示器的状态信息
 * 用于判断多显示器布局，辅助桌面歌词定位
 * @param {BrowserWindow} win - 目标窗口
 * @returns {object} 显示器状态（ID、是否主屏、左右是否有其他显示器、显示器边界）
 */
function getDisplayState(win) {
  const displays = screen.getAllDisplays();
  const primary = screen.getPrimaryDisplay();
  // 获取窗口所在显示器，若窗口无效则使用主显示器
  const display = win && !win.isDestroyed()
    ? screen.getDisplayMatching(win.getBounds())
    : primary;
  const bounds = display && display.bounds ? display.bounds : primary.bounds;
  const displayId = display && display.id;
  const primaryId = primary && primary.id;
  const edgeTolerance = 2; // 边缘容差（像素），用于判断显示器是否紧密排列

  // 检查当前显示器左侧是否有其他显示器（用于窗口吸附判断）
  const hasDisplayOnLeft = displays.some((candidate) => {
    if (!candidate || candidate.id === displayId || !candidate.bounds) return false;
    return rectsOverlapOnY(bounds, candidate.bounds)
      && Math.abs((candidate.bounds.x + candidate.bounds.width) - bounds.x) <= edgeTolerance;
  });
  // 检查当前显示器右侧是否有其他显示器
  const hasDisplayOnRight = displays.some((candidate) => {
    if (!candidate || candidate.id === displayId || !candidate.bounds) return false;
    return rectsOverlapOnY(bounds, candidate.bounds)
      && Math.abs((bounds.x + bounds.width) - candidate.bounds.x) <= edgeTolerance;
  });

  return {
    displayId,
    primaryDisplayId: primaryId,
    isPrimaryDisplay: !!(display && primary && display.id === primary.id),
    hasDisplayOnLeft,
    hasDisplayOnRight,
    displayBounds: bounds ? {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    } : null,
  };
}

/**
 * 获取窗口的完整状态信息，发送给渲染进程用于 UI 适配
 * @param {BrowserWindow} win - 目标窗口
 * @returns {object} 窗口状态对象
 */
function getWindowState(win) {
  if (!win || win.isDestroyed()) return {
    isMaximized: false,
    isNativeFullScreen: false,
    isHtmlFullScreen: false,
    isWindowFullScreen: false,
    isFullScreen: false,
    isMinimized: false,
    isVisible: false,
    isFocused: false,
    isPrimaryDisplay: true,
    hasDisplayOnLeft: false,
    hasDisplayOnRight: false,
    displayBounds: null,
  };
  return {
    isMaximized: win.isMaximized(),
    isNativeFullScreen: win.isFullScreen(),
    isHtmlFullScreen: htmlFullscreenActive,
    isWindowFullScreen: windowFullscreenActive,
    // 综合判断：原生全屏 || HTML全屏 || 窗口全屏
    isFullScreen: win.isFullScreen() || htmlFullscreenActive || windowFullscreenActive,
    isMinimized: win.isMinimized(),
    isVisible: win.isVisible(),
    isFocused: win.isFocused(),
    ...getDisplayState(win), // 合并显示器状态
  };
}

/**
 * 从 IPC 事件中获取发送者的窗口实例
 * @param {Electron.IpcMainInvokeEvent} event - IPC 事件
 * @returns {BrowserWindow|undefined}
 */
function getSenderWindow(event) {
  return BrowserWindow.fromWebContents(event.sender);
}

/**
 * 聚焦主窗口（如最小化则恢复，如隐藏则显示）
 * @returns {boolean} 是否成功聚焦
 */
function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
  sendWindowState(mainWindow);
  return true;
}

// ==================== 更新与快捷方式 ====================

/**
 * 获取更新包下载目录路径
 * @returns {string} 更新目录的绝对路径
 */
function getUpdateDownloadDir() {
  return path.join(app.getPath('userData'), 'updates');
}

/**
 * 判断是否应该创建桌面快捷方式
 * 仅在 Windows 打包环境下且未禁用时创建
 * @returns {boolean}
 */
function shouldEnsureDesktopShortcut() {
  if (process.platform !== 'win32') return false;
  if (process.env.BHANDSMUSIC_NO_DESKTOP_SHORTCUT === '1') return false;
  return app.isPackaged || process.env.BHANDSMUSIC_CREATE_DESKTOP_SHORTCUT === '1';
}

/**
 * 确保桌面快捷方式存在
 * 如果已存在且指向相同目标则跳过，否则创建或更新
 * @returns {object} 创建结果
 */
function ensureDesktopShortcut() {
  if (!shouldEnsureDesktopShortcut()) return { ok: false, skipped: true };
  try {
    const shortcutPath = path.join(app.getPath('desktop'), `${APP_NAME}.lnk`);
    const target = process.execPath;
    const shortcut = {
      target,
      cwd: path.dirname(target),
      args: '',
      description: 'BhandsMusic desktop music player',
      icon: fs.existsSync(APP_ICON_ICO) ? APP_ICON_ICO : target,
      iconIndex: 0,
      appUserModelId: APP_USER_MODEL_ID,
    };

    if (fs.existsSync(shortcutPath) && shell.readShortcutLink) {
      try {
        const existing = shell.readShortcutLink(shortcutPath);
        // 快捷方式已存在且目标一致，无需更新
        if (existing && path.resolve(existing.target || '') === path.resolve(target) && String(existing.args || '') === '') {
          return { ok: true, path: shortcutPath, existing: true };
        }
      } catch (_) {}
      shell.writeShortcutLink(shortcutPath, 'replace', shortcut);
    } else {
      shell.writeShortcutLink(shortcutPath, 'create', shortcut);
    }
    return { ok: true, path: shortcutPath, created: true };
  } catch (e) {
    console.warn('Desktop shortcut creation skipped:', e.message);
    return { ok: false, error: e.message || 'DESKTOP_SHORTCUT_FAILED' };
  }
}

// ==================== Cookie 工具函数 ====================

/**
 * 解析 Cookie 字符串为键值对对象
 * @param {string} cookieText - Cookie 字符串（如 "name1=val1; name2=val2"）
 * @returns {object} 解析后的键值对
 */
function parseCookieHeader(cookieText) {
  const out = {};
  String(cookieText || '').split(';').forEach((part) => {
    const raw = String(part || '').trim();
    if (!raw) return;
    const idx = raw.indexOf('=');
    if (idx <= 0) return;
    out[raw.slice(0, idx).trim()] = raw.slice(idx + 1).trim();
  });
  return out;
}

/**
 * 检查 QQ 音乐 Cookie 是否包含登录凭据
 * 根据 login_type 区分 QQ 登录和微信登录，提取对应的 uin 和密钥
 * @param {string} cookieText - Cookie 字符串
 * @returns {boolean} 是否已登录
 */
function qqCookieHasLogin(cookieText) {
  const obj = parseCookieHeader(cookieText);
  // login_type=2 为微信登录，优先取 wxuin；否则为 QQ 登录
  const rawUin = Number(obj.login_type) === 2
    ? (obj.wxuin || obj.uin || obj.p_uin || '')
    : (obj.uin || obj.qqmusic_uin || obj.wxuin || obj.p_uin || '');
  const uin = String(rawUin).replace(/\D/g, '');
  // 检查是否存在任意一种有效的密钥
  const musicKey = obj.qm_keyst || obj.qqmusic_key || obj.music_key || obj.p_skey || obj.skey ||
    obj.psrf_qqaccess_token || obj.psrf_qqrefresh_token || obj.wxrefresh_token || obj.wxskey || '';
  return !!(uin && musicKey);
}

/**
 * 检查 QQ 音乐 Cookie 是否具备播放权限（比登录检查更严格）
 * @param {string} cookieText - Cookie 字符串
 * @returns {boolean} 是否具备播放权限
 */
function qqCookieHasPlaybackLogin(cookieText) {
  const obj = parseCookieHeader(cookieText);
  const rawUin = Number(obj.login_type) === 2
    ? (obj.wxuin || obj.uin || obj.p_uin || '')
    : (obj.uin || obj.qqmusic_uin || obj.wxuin || obj.p_uin || '');
  const uin = String(rawUin).replace(/\D/g, '');
  // 播放权限只需要核心密钥，不包含 access_token 等
  const playbackKey = obj.qm_keyst || obj.qqmusic_key || obj.music_key || obj.wxskey || '';
  return !!(uin && playbackKey);
}

/**
 * 检查网易云音乐 Cookie 是否包含登录凭据
 * @param {string} cookieText - Cookie 字符串
 * @returns {boolean} 是否已登录
 */
function neteaseCookieHasLogin(cookieText) {
  const obj = parseCookieHeader(cookieText);
  return !!obj.MUSIC_U; // MUSIC_U 是网易云的核心登录 token
}

/**
 * 判断域名是否属于 QQ 音乐
 * @param {string} domain - Cookie 的 domain 字段
 * @returns {boolean}
 */
function isQQCookieDomain(domain) {
  const normalized = String(domain || '').replace(/^\./, '').toLowerCase();
  return normalized === 'qq.com' || normalized.endsWith('.qq.com') || normalized.endsWith('qqmusic.qq.com');
}

/**
 * 判断域名是否属于网易云音乐
 * @param {string} domain - Cookie 的 domain 字段
 * @returns {boolean}
 */
function isNeteaseCookieDomain(domain) {
  const normalized = String(domain || '').replace(/^\./, '').toLowerCase();
  return normalized === '163.com' || normalized.endsWith('.163.com') ||
    normalized === 'music.163.com' || normalized.endsWith('.music.163.com') ||
    normalized === 'netease.com' || normalized.endsWith('.netease.com');
}

/**
 * 从 Electron session cookies 构建 HTTP Cookie 请求头
 * 按优先级排序，确保关键 Cookie 排在前面
 * @param {Array} cookies - Electron cookie 对象数组
 * @param {Function} isAllowedDomain - 域名过滤函数
 * @param {Array<string>} priority - Cookie 名称优先级列表
 * @returns {string} 格式化的 Cookie 字符串
 */
function buildCookieHeaderFor(cookies, isAllowedDomain, priority) {
  const picked = new Map();
  // 筛选属于目标域名的 Cookie
  (cookies || []).forEach((cookie) => {
    if (!cookie || !cookie.name || !isAllowedDomain(cookie.domain)) return;
    picked.set(cookie.name, cookie.value || '');
  });

  // 按优先级排列，未在优先级列表中的排在后面
  const ordered = [];
  (priority || []).forEach((name) => {
    if (picked.has(name)) {
      ordered.push([name, picked.get(name)]);
      picked.delete(name);
    }
  });
  picked.forEach((value, name) => ordered.push([name, value]));

  // 过滤空值并拼接为 Cookie 字符串
  return ordered
    .filter(([name, value]) => name && value != null && String(value) !== '')
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

/** 构建 QQ 音乐的 Cookie 请求头 */
function buildCookieHeader(cookies) {
  return buildCookieHeaderFor(cookies, isQQCookieDomain, QQ_LOGIN_COOKIE_PRIORITY);
}

/** 从 QQ 音乐登录 session 读取 Cookie 并构建请求头 */
async function readQQLoginCookieHeader(cookieSession) {
  const cookies = await cookieSession.cookies.get({});
  return buildCookieHeader(cookies);
}

/** 从网易云音乐登录 session 读取 Cookie 并构建请求头 */
async function readNeteaseLoginCookieHeader(cookieSession) {
  const cookies = await cookieSession.cookies.get({});
  return buildCookieHeaderFor(cookies, isNeteaseCookieDomain, NETEASE_LOGIN_COOKIE_PRIORITY);
}

// ==================== 网易云音乐登录 ====================

/**
 * 打开网易云音乐登录窗口
 * 如果已有有效 Cookie 则直接复用，否则弹出登录窗口并轮询 Cookie 直到登录成功
 * @param {BrowserWindow} owner - 父窗口
 * @returns {Promise<{ok: boolean, cookie?: string, reused?: boolean, cancelled?: boolean}>}
 */
async function openNeteaseMusicLoginWindow(owner) {
  const cookieSession = session.fromPartition(NETEASE_LOGIN_PARTITION);
  const initialCookie = await readNeteaseLoginCookieHeader(cookieSession);
  // 如果已有有效的登录 Cookie，直接返回复用
  if (neteaseCookieHasLogin(initialCookie)) return { ok: true, cookie: initialCookie, reused: true };

  return new Promise((resolve) => {
    let settled = false;   // 是否已结算（防止重复 resolve）
    let pollTimer = null;  // Cookie 轮询定时器

    // 创建登录窗口
    const loginWindow = new BrowserWindow({
      width: 940,
      height: 760,
      minWidth: 780,
      minHeight: 580,
      parent: owner && !owner.isDestroyed() ? owner : undefined,
      modal: false,
      show: false,
      autoHideMenuBar: true,
      title: '网易云音乐登录',
      backgroundColor: '#111111',
      icon: APP_ICON_ICO,
      webPreferences: {
        partition: NETEASE_LOGIN_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    // 完成登录流程，关闭窗口并返回结果
    const finish = async (result) => {
      if (settled) return;
      settled = true;
      if (pollTimer) clearInterval(pollTimer);
      if (loginWindow && !loginWindow.isDestroyed()) {
        loginWindow.close();
      }
      resolve(result);
    };

    // 轮询检查 Cookie，判断登录是否成功
    const checkCookies = async () => {
      try {
        const cookie = await readNeteaseLoginCookieHeader(cookieSession);
        if (neteaseCookieHasLogin(cookie)) {
          finish({ ok: true, cookie });
        }
      } catch (e) {
        console.warn('Netease login cookie check failed:', e.message);
      }
    };

    // 拦截弹窗：网易云域名内导航，外部链接用系统浏览器打开
    loginWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\/([^/]+\.)?(163|music\.163|netease)\.com/i.test(url)) {
        loginWindow.loadURL(url).catch((e) => console.warn('Netease login popup navigation failed:', e.message));
      } else if (/^https?:\/\//i.test(url)) {
        shell.openExternal(url).catch(() => {});
      }
      return { action: 'deny' };
    });

    // 页面加载完成后检查 Cookie 并自动点击登录按钮
    loginWindow.webContents.on('did-finish-load', () => {
      checkCookies();
      // 注入脚本：在页面和 iframe 中查找并点击"登录"按钮
      loginWindow.webContents.executeJavaScript(`
        setTimeout(() => {
          const docs = [document];
          document.querySelectorAll('iframe').forEach((frame) => {
            try { if (frame.contentDocument) docs.push(frame.contentDocument); } catch (_) {}
          });
          for (const doc of docs) {
            const nodes = Array.from(doc.querySelectorAll('a, button, span, div'));
            const loginNode = nodes.find((node) => {
              const text = (node.textContent || '').trim();
              if (!/登录|立即登录/.test(text)) return false;
              const rect = node.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            });
            if (loginNode) { loginNode.click(); return true; }
          }
          return false;
        }, 900);
      `, true).catch(() => {});
    });

    loginWindow.on('ready-to-show', () => loginWindow.show());
    // 窗口关闭时检查最终 Cookie 状态
    loginWindow.on('closed', async () => {
      if (settled) return;
      if (pollTimer) clearInterval(pollTimer);
      try {
        const cookie = await readNeteaseLoginCookieHeader(cookieSession);
        resolve(neteaseCookieHasLogin(cookie)
          ? { ok: true, cookie, partial: !qqCookieHasPlaybackLogin(cookie) }
          : { ok: false, cancelled: true, message: '网易云登录窗口已关闭' });
      } catch (e) {
        resolve({ ok: false, error: e.message || '网易云登录窗口已关闭' });
      }
    });

    // 每 1.2 秒轮询一次 Cookie，检测登录成功
    pollTimer = setInterval(checkCookies, 1200);
    loginWindow.loadURL(NETEASE_LOGIN_URL).catch((e) => finish({ ok: false, error: e.message }));
  });
}

// ==================== QQ 音乐登录 ====================

/**
 * 打开 QQ 音乐登录窗口
 * 逻辑与网易云类似，额外处理微信登录和播放权限预热
 * @param {BrowserWindow} owner - 父窗口
 * @returns {Promise<{ok: boolean, cookie?: string, reused?: boolean, cancelled?: boolean}>}
 */
async function openQQMusicLoginWindow(owner) {
  const cookieSession = session.fromPartition(QQ_LOGIN_PARTITION);
  const initialCookie = await readQQLoginCookieHeader(cookieSession);
  if (qqCookieHasPlaybackLogin(initialCookie)) return { ok: true, cookie: initialCookie, reused: true };

  return new Promise((resolve) => {
    let settled = false;       // 是否已结算
    let pollTimer = null;      // Cookie 轮询定时器
    let warmupStarted = false; // 是否已触发播放页预热（用于获取播放权限 Cookie）

    const loginWindow = new BrowserWindow({
      width: 900,
      height: 720,
      minWidth: 760,
      minHeight: 560,
      parent: owner && !owner.isDestroyed() ? owner : undefined,
      modal: false,
      show: false,
      autoHideMenuBar: true,
      title: 'QQ 音乐登录',
      backgroundColor: '#111111',
      icon: APP_ICON_ICO,
      webPreferences: {
        partition: QQ_LOGIN_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    const finish = async (result) => {
      if (settled) return;
      settled = true;
      if (pollTimer) clearInterval(pollTimer);
      if (loginWindow && !loginWindow.isDestroyed()) {
        loginWindow.close();
      }
      resolve(result);
    };

    // 轮询检查 QQ 音乐 Cookie
    const checkCookies = async () => {
      try {
        const cookie = await readQQLoginCookieHeader(cookieSession);
        if (qqCookieHasPlaybackLogin(cookie)) {
          // 已具备播放权限，登录完成
          finish({ ok: true, cookie });
        } else if (qqCookieHasLogin(cookie) && !warmupStarted) {
          // 已登录但缺少播放权限 Cookie，导航到播放页触发 Cookie 生成（预热）
          warmupStarted = true;
          setTimeout(() => {
            if (!settled && loginWindow && !loginWindow.isDestroyed()) {
              loginWindow.loadURL('https://y.qq.com/n/ryqq/player').catch((e) => console.warn('QQ login warmup navigation failed:', e.message));
            }
          }, 900);
        }
      } catch (e) {
        console.warn('QQ login cookie check failed:', e.message);
      }
    };

    // 拦截弹窗：所有 HTTP 链接在窗口内导航，非 HTTP 用系统浏览器打开
    loginWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) {
        loginWindow.loadURL(url).catch((e) => console.warn('QQ login popup navigation failed:', e.message));
      } else {
        shell.openExternal(url).catch(() => {});
      }
      return { action: 'deny' };
    });

    // 页面加载完成后检查 Cookie 并自动点击登录按钮
    loginWindow.webContents.on('did-finish-load', () => {
      checkCookies();
      loginWindow.webContents.executeJavaScript(`
        setTimeout(() => {
          const nodes = Array.from(document.querySelectorAll('a, button, span, div'));
          const loginNode = nodes.find((node) => {
            const text = (node.textContent || '').trim();
            if (!/登录|登陆/.test(text)) return false;
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
          if (loginNode) loginNode.click();
        }, 700);
      `, true).catch(() => {});
    });

    loginWindow.on('ready-to-show', () => loginWindow.show());
    // 窗口关闭时的最终检查
    loginWindow.on('closed', async () => {
      if (settled) return;
      if (pollTimer) clearInterval(pollTimer);
      try {
        const cookie = await readQQLoginCookieHeader(cookieSession);
        resolve(qqCookieHasLogin(cookie)
          ? { ok: true, cookie }
          : { ok: false, cancelled: true, message: 'QQ 登录窗口已关闭' });
      } catch (e) {
        resolve({ ok: false, error: e.message || 'QQ 登录窗口已关闭' });
      }
    });

    // 每 1.2 秒轮询 Cookie
    pollTimer = setInterval(checkCookies, 1200);
    loginWindow.loadURL(QQ_LOGIN_URL).catch((e) => finish({ ok: false, error: e.message }));
  });
}

// ==================== 登录会话清除 ====================

/** 清除 QQ 音乐登录 session 的所有存储数据（Cookie、localStorage 等） */
async function clearQQMusicLoginSession() {
  const cookieSession = session.fromPartition(QQ_LOGIN_PARTITION);
  await cookieSession.clearStorageData({
    storages: ['cookies', 'localstorage', 'indexdb', 'cachestorage'],
  });
  return { ok: true };
}

/** 清除网易云音乐登录 session 的所有存储数据 */
async function clearNeteaseMusicLoginSession() {
  const cookieSession = session.fromPartition(NETEASE_LOGIN_PARTITION);
  await cookieSession.clearStorageData({
    storages: ['cookies', 'localstorage', 'indexdb', 'cachestorage'],
  });
  return { ok: true };
}

// ==================== 窗口尺寸与全屏管理 ====================

/**
 * 计算窗口化的理想尺寸和位置（居中显示在当前显示器工作区）
 * @param {BrowserWindow} win - 参考窗口（用于确定所在显示器）
 * @returns {{x: number, y: number, width: number, height: number}} 窗口边界
 */
function getWindowedBounds(win) {
  const display = win && !win.isDestroyed()
    ? screen.getDisplayMatching(win.getBounds())
    : screen.getPrimaryDisplay();
  const area = display.workArea;      // 可用工作区（排除任务栏）
  const basis = display.bounds || area;
  const maxWidth = Math.max(640, area.width - WINDOWED_MARGIN);
  const maxHeight = Math.max(360, area.height - WINDOWED_MARGIN);

  // 基于屏幕宽度计算初始尺寸，保持 16:9 宽高比
  let width = Math.round(basis.width * WINDOWED_SCALE);
  let height = Math.round(width / WINDOWED_ASPECT);
  const scaledHeight = Math.round(basis.height * WINDOWED_SCALE);

  // 如果高度超出，改为基于高度计算
  if (height > scaledHeight) {
    height = scaledHeight;
    width = Math.round(height * WINDOWED_ASPECT);
  }

  // 确保不小于最小尺寸
  if (width < MIN_WINDOWED_WIDTH && maxWidth >= MIN_WINDOWED_WIDTH && maxHeight >= MIN_WINDOWED_HEIGHT) {
    width = MIN_WINDOWED_WIDTH;
    height = MIN_WINDOWED_HEIGHT;
  }

  // 确保不超过最大可用区域
  if (width > maxWidth) {
    width = maxWidth;
    height = Math.round(width / WINDOWED_ASPECT);
  }
  if (height > maxHeight) {
    height = maxHeight;
    width = Math.round(height * WINDOWED_ASPECT);
  }

  width = Math.round(width);
  height = Math.round(height);

  // 居中定位
  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    width,
    height,
  };
}

/**
 * 将窗口切换为窗口化模式（退出最大化/全屏，应用窗口化尺寸）
 * @param {BrowserWindow} win - 目标窗口
 */
function applyWindowedBounds(win) {
  if (!win || win.isDestroyed()) return;
  if (win.isMaximized()) win.unmaximize();
  win.setMinimumSize(MIN_WINDOWED_WIDTH, MIN_WINDOWED_HEIGHT);
  win.setBounds(getWindowedBounds(win), false);
  sendWindowState(win);
}

/**
 * 从全屏模式退出到窗口化模式
 * 处理原生全屏退出的异步延迟，确保窗口尺寸正确应用
 * @param {BrowserWindow} win - 目标窗口
 */
function exitFullscreenToWindow(win) {
  if (!win || win.isDestroyed()) return;
  windowFullscreenActive = false;

  if (!win.isFullScreen()) {
    applyWindowedBounds(win);
    return;
  }

  // 防止重复应用
  let applied = false;
  const applyOnce = () => {
    if (applied || !win || win.isDestroyed() || win.isFullScreen()) return;
    applied = true;
    applyWindowedBounds(win);
  };

  // 监听离开全屏事件，延迟 50ms 应用窗口化尺寸
  win.once('leave-full-screen', () => setTimeout(applyOnce, 50));
  win.setFullScreen(false);
  setTimeout(applyOnce, 500); // 500ms 超时保底，防止事件丢失
}

/**
 * 切换全屏/窗口化模式
 * @param {BrowserWindow} win - 目标窗口
 */
function toggleFullscreen(win) {
  if (!win || win.isDestroyed()) return;
  if (win.isFullScreen() || windowFullscreenActive) {
    exitFullscreenToWindow(win);
    return;
  }
  windowFullscreenActive = true;
  win.setFullScreen(true);
  sendWindowState(win);
}

// ==================== 通用工具函数 ====================

/**
 * 生成覆盖层页面的本地 URL
 * @param {string} page - 页面路径（如 'desktop-lyrics.html'）
 * @returns {string} 完整的本地 URL
 */
function overlayUrl(page) {
  const port = mainServerPort || process.env.PORT || 3000;
  return `http://127.0.0.1:${port}/${page}`;
}

/**
 * 将数值限制在指定范围内
 * @param {*} value - 输入值
 * @param {number} min - 最小值
 * @param {number} max - 最大值
 * @param {number} fallback - 非有限数时的默认值
 * @returns {number}
 */
function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

// ==================== 桌面歌词窗口位置管理 ====================

/**
 * 计算桌面歌词的默认位置和尺寸
 * 根据用户设置的 Y 轴比例和屏幕尺寸自动计算，居中显示
 * @param {object} payload - 歌词状态（含 y 比例参数）
 * @returns {{x: number, y: number, width: number, height: number}}
 */
function desktopLyricsDefaultBounds(payload = desktopLyricsState) {
  const display = desktopLyricsUserBounds
    ? screen.getDisplayMatching(desktopLyricsUserBounds)
    : screen.getPrimaryDisplay();
  const bounds = display.bounds;
  const yRatio = clampNumber(payload.y, 0.08, 0.92, 0.76); // Y 轴位置比例（屏幕高度的百分比）
  // 宽度：屏幕宽度的 72%，限制在 880px ~ 屏幕宽度-96px
  const width = Math.round(Math.min(Math.max(880, bounds.width * 0.72), bounds.width - 96));
  // 高度：屏幕高度的 38%，限制在 340px ~ 560px ~ 屏幕高度-96px
  const height = Math.round(Math.min(Math.max(340, bounds.height * 0.38), 560, bounds.height - 96));
  return {
    x: Math.round(bounds.x + (bounds.width - width) / 2),           // 水平居中
    y: Math.round(bounds.y + bounds.height * yRatio - height / 2),   // 垂直位置按比例
    width,
    height,
  };
}

/**
 * 将桌面歌词窗口边界约束在屏幕范围内
 * @param {object} bounds - 目标边界
 * @returns {object} 约束后的边界
 */
function constrainDesktopLyricsBounds(bounds) {
  const display = screen.getDisplayMatching(bounds);
  const area = display.bounds;
  const next = {
    ...bounds,
    width: Math.round(Math.min(Math.max(320, bounds.width), area.width)),   // 最小宽度 320
    height: Math.round(Math.min(Math.max(180, bounds.height), area.height)), // 最小高度 180
  };
  // 确保窗口不会超出屏幕边界
  const maxX = area.x + Math.max(0, area.width - next.width);
  const maxY = area.y + Math.max(0, area.height - next.height);
  next.x = Math.round(clampNumber(next.x, area.x, maxX, area.x));
  next.y = Math.round(clampNumber(next.y, area.y, maxY, area.y));
  return next;
}

/**
 * 设置桌面歌词窗口的位置（带动画保护）
 * 如果新位置与当前位置相同则跳过，避免不必要的重绘
 * @param {object} bounds - 目标边界
 */
function setDesktopLyricsBounds(bounds) {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return;
  const nextBounds = constrainDesktopLyricsBounds(bounds);
  const currentBounds = desktopLyricsWindow.getBounds();
  // 位置和尺寸均未变化，跳过
  if (
    currentBounds.x === nextBounds.x
    && currentBounds.y === nextBounds.y
    && currentBounds.width === nextBounds.width
    && currentBounds.height === nextBounds.height
  ) {
    return;
  }
  desktopLyricsProgrammaticMove = true; // 标记为程序化移动，防止触发用户位置记忆
  desktopLyricsWindow.setBounds(nextBounds, false);
  setTimeout(() => {
    desktopLyricsProgrammaticMove = false;
  }, 120);
}

/**
 * 记忆用户手动拖拽后的桌面歌词窗口位置
 * 程序化移动时不记录，避免覆盖用户的拖拽偏好
 */
function rememberDesktopLyricsBounds() {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed() || desktopLyricsProgrammaticMove) return;
  desktopLyricsUserBounds = desktopLyricsWindow.getBounds();
}

// ==================== 桌面歌词鼠标交互 ====================

/**
 * 应用桌面歌词窗口的鼠标事件行为
 * 锁定模式下忽略鼠标事件（点击穿透），解锁模式下正常响应
 * forward: true 表示即使忽略鼠标事件，仍能接收鼠标位置信息（用于 hover 效果）
 */
function applyDesktopLyricsMouseBehavior() {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return;
  const locked = desktopLyricsState.clickThrough !== false;
  const shouldIgnore = locked || !desktopLyricsPointerCapture;
  if (desktopLyricsMouseIgnored === shouldIgnore) return; // 状态未变，跳过
  desktopLyricsMouseIgnored = shouldIgnore;
  desktopLyricsWindow.setIgnoreMouseEvents(shouldIgnore, { forward: true });
}

/**
 * 获取桌面歌词热区在屏幕上的绝对坐标
 * 热区是歌词窗口内的一个子区域，用于判断鼠标中键点击位置
 * @returns {object|null} 屏幕坐标边界
 */
function desktopLyricsHotBoundsOnScreen() {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return null;
  const winBounds = desktopLyricsWindow.getBounds();
  const rel = desktopLyricsHotBounds;
  if (!rel) return winBounds; // 未设置热区时使用整个窗口
  return {
    x: winBounds.x + rel.left,
    y: winBounds.y + rel.top,
    width: Math.max(1, rel.right - rel.left),
    height: Math.max(1, rel.bottom - rel.top),
  };
}

/**
 * 判断点是否在矩形范围内
 * @param {{x: number, y: number}} point - 屏幕坐标点
 * @param {object} bounds - 矩形边界
 * @returns {boolean}
 */
function pointInBounds(point, bounds) {
  if (!point || !bounds) return false;
  return point.x >= bounds.x
    && point.x <= bounds.x + bounds.width
    && point.y >= bounds.y
    && point.y <= bounds.y + bounds.height;
}

/**
 * 处理全局鼠标中键点击事件（用于切换桌面歌词锁定状态）
 * 仅在歌词窗口热区内点击时生效，260ms 防抖防止误触
 */
function handleDesktopLyricsGlobalMiddleClick() {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return;
  if (!desktopLyricsState.enabled) return;
  const now = Date.now();
  if (now - desktopLyricsLastMiddleAt < 260) return; // 防抖
  const point = screen.getCursorScreenPoint();
  if (!pointInBounds(point, desktopLyricsHotBoundsOnScreen())) return; // 不在热区内，忽略
  desktopLyricsLastMiddleAt = now;
  // 切换锁定状态
  const nextLocked = desktopLyricsState.clickThrough === false;
  desktopLyricsState = { ...desktopLyricsState, clickThrough: nextLocked };
  desktopLyricsPointerCapture = !nextLocked;
  applyDesktopLyricsMouseBehavior();
  broadcastDesktopLyricsLockState();
}

// ==================== Windows 鼠标中键轮询器 ====================
// 由于 Electron 无法在 setIgnoreMouseEvents 模式下捕获鼠标按键，
// 通过 PowerShell 子进程调用 Win32 API GetAsyncKeyState 轮询鼠标中键状态

/**
 * 启动鼠标中键轮询器（仅 Windows）
 * 使用 PowerShell 调用 user32.dll 的 GetAsyncKeyState 检测鼠标中键按下
 */
function startDesktopLyricsMousePoller() {
  if (process.platform !== 'win32' || desktopLyricsMousePoller) return;
  const script = `
$ErrorActionPreference = "SilentlyContinue"
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class BhandsMusicMousePoll {
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
}
"@
$prev = $false
while ($true) {
  $down = (([BhandsMusicMousePoll]::GetAsyncKeyState(4) -band 0x8000) -ne 0)
  if ($down -and -not $prev) {
    [Console]::Out.WriteLine("MMB")
    [Console]::Out.Flush()
  }
  $prev = $down
  Start-Sleep -Milliseconds 24
}
`;
  try {
    desktopLyricsMousePoller = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    desktopLyricsMousePoller.stdout.on('data', (chunk) => {
      desktopLyricsMousePollerBuffer += chunk.toString('utf8');
      const lines = desktopLyricsMousePollerBuffer.split(/\r?\n/);
      desktopLyricsMousePollerBuffer = lines.pop() || '';
      lines.forEach((line) => {
        if (line.trim() === 'MMB') handleDesktopLyricsGlobalMiddleClick();
      });
    });
    desktopLyricsMousePoller.on('exit', () => {
      desktopLyricsMousePoller = null;
      desktopLyricsMousePollerBuffer = '';
    });
    desktopLyricsMousePoller.on('error', () => {
      desktopLyricsMousePoller = null;
      desktopLyricsMousePollerBuffer = '';
    });
  } catch (e) {
    desktopLyricsMousePoller = null;
    desktopLyricsMousePollerBuffer = '';
  }
}

/** 停止鼠标中键轮询器 */
function stopDesktopLyricsMousePoller() {
  if (!desktopLyricsMousePoller) return;
  try {
    desktopLyricsMousePoller.kill();
  } catch (e) {}
  desktopLyricsMousePoller = null;
  desktopLyricsMousePollerBuffer = '';
}

/**
 * 向主窗口和歌词窗口广播锁定状态变化
 * 主窗口用于更新 UI 指示器，歌词窗口用于更新交互行为
 */
function broadcastDesktopLyricsLockState() {
  const locked = desktopLyricsState.clickThrough !== false;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('bhandsmusic-desktop-lyrics-lock-state', { locked });
  }
  sendDesktopLyricsState();
}

/**
 * 向主窗口广播桌面歌词启用/禁用状态
 * @param {boolean} enabled - 是否启用
 */
function broadcastDesktopLyricsEnabledState(enabled) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('bhandsmusic-desktop-lyrics-enabled-state', { enabled: !!enabled });
  }
}

/**
 * 定位桌面歌词窗口
 * 优先使用用户手动拖拽的位置，否则使用默认居中位置
 * @param {object} payload - 歌词状态
 * @param {object} options - 选项（force: 强制使用默认位置）
 */
function positionDesktopLyricsWindow(payload = desktopLyricsState, options = {}) {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return;
  const shouldUseManualBounds = desktopLyricsUserBounds && !options.force;
  setDesktopLyricsBounds(shouldUseManualBounds ? desktopLyricsUserBounds : desktopLyricsDefaultBounds(payload));
  // 设置窗口透明度（0.28 ~ 1.0）
  if (typeof desktopLyricsWindow.setOpacity === 'function') {
    desktopLyricsWindow.setOpacity(clampNumber(payload.opacity, 0.28, 1, 0.92));
  }
}

/** 向歌词渲染进程发送当前歌词状态 */
function sendDesktopLyricsState() {
  if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return;
  desktopLyricsWindow.webContents.send('bhandsmusic-desktop-lyrics-state', desktopLyricsState);
}

// ==================== 桌面歌词窗口生命周期 ====================

/**
 * 创建或更新桌面歌词窗口
 * 如果窗口已存在则更新状态；否则创建新的透明无边框窗口
 * @param {object} payload - 歌词配置（enabled, y, opacity, clickThrough 等）
 * @returns {BrowserWindow} 歌词窗口实例
 */
function createDesktopLyricsWindow(payload = {}) {
  const previousY = desktopLyricsState.y;
  const previousOpacity = desktopLyricsState.opacity;
  desktopLyricsState = { ...desktopLyricsState, ...payload, enabled: true };

  // 检测 Y 轴位置是否发生变化（用户调整了歌词垂直位置）
  const hasY = Object.prototype.hasOwnProperty.call(payload || {}, 'y');
  const nextY = clampNumber(desktopLyricsState.y, 0.08, 0.92, 0.76);
  const yChanged = hasY && Number.isFinite(Number(previousY)) && Math.abs(nextY - clampNumber(previousY, 0.08, 0.92, 0.76)) > 0.001;
  // 检测透明度是否发生变化
  const opacityChanged = Object.prototype.hasOwnProperty.call(payload || {}, 'opacity')
    && Math.abs(clampNumber(desktopLyricsState.opacity, 0.28, 1, 0.92) - clampNumber(previousOpacity, 0.28, 1, 0.92)) > 0.001;

  if (yChanged) desktopLyricsUserBounds = null; // Y 轴变化时清除用户手动位置记忆

  // 窗口已存在，更新状态即可
  if (desktopLyricsWindow && !desktopLyricsWindow.isDestroyed()) {
    if (yChanged) {
      positionDesktopLyricsWindow(desktopLyricsState, { force: yChanged });
    } else if (opacityChanged && typeof desktopLyricsWindow.setOpacity === 'function') {
      desktopLyricsWindow.setOpacity(clampNumber(desktopLyricsState.opacity, 0.28, 1, 0.92));
    }
    applyDesktopLyricsMouseBehavior();
    sendDesktopLyricsState();
    return desktopLyricsWindow;
  }

  // 创建透明无边框歌词窗口
  desktopLyricsWindow = new BrowserWindow({
    width: 920,
    height: 190,
    frame: false,              // 无边框
    transparent: true,         // 透明背景
    backgroundColor: '#00000000', // 完全透明
    hasShadow: false,          // 无阴影
    resizable: false,          // 不可调整大小
    movable: true,             // 允许拖拽移动
    focusable: false,          // 不抢焦点
    skipTaskbar: true,         // 不在任务栏显示
    show: false,               // 初始隐藏，等 ready 后再显示
    title: 'BhandsMusic Desktop Lyrics',
    webPreferences: {
      preload: path.join(__dirname, 'overlay-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false, // 禁止后台节流，保证歌词动画流畅
    },
  });

  try {
    // 设置窗口置顶（最高层级，高于普通置顶）
    desktopLyricsWindow.setAlwaysOnTop(true, 'screen-saver');
    // 在所有工作区（含全屏应用）上可见
    desktopLyricsWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch (e) {
    console.warn('Desktop lyrics topmost setup skipped:', e.message);
  }

  startDesktopLyricsMousePoller(); // 启动鼠标中键轮询
  applyDesktopLyricsMouseBehavior();
  positionDesktopLyricsWindow(desktopLyricsState, { force: yChanged || !desktopLyricsUserBounds });

  desktopLyricsWindow.once('ready-to-show', () => {
    if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return;
    desktopLyricsWindow.showInactive(); // 显示但不抢焦点
    sendDesktopLyricsState();
  });
  desktopLyricsWindow.webContents.once('did-finish-load', sendDesktopLyricsState);
  desktopLyricsWindow.on('closed', () => {
    desktopLyricsWindow = null;
    desktopLyricsMouseIgnored = null;
  });
  // 用户拖拽移动窗口时记录位置
  desktopLyricsWindow.on('moved', rememberDesktopLyricsBounds);
  desktopLyricsWindow.loadURL(overlayUrl('desktop-lyrics.html')).catch((e) => console.warn('Desktop lyrics load failed:', e.message));
  return desktopLyricsWindow;
}

/** 关闭桌面歌词窗口并清理所有相关状态 */
function closeDesktopLyricsWindow() {
  desktopLyricsState = { ...desktopLyricsState, enabled: false };
  desktopLyricsPointerCapture = false;
  desktopLyricsMouseIgnored = null;
  desktopLyricsHotBounds = null;
  stopDesktopLyricsMousePoller();
  if (desktopLyricsWindow && !desktopLyricsWindow.isDestroyed()) {
    sendDesktopLyricsState();
    desktopLyricsWindow.close();
  }
  desktopLyricsWindow = null;
  broadcastDesktopLyricsEnabledState(false);
}

// ==================== 壁纸模式（Windows 专用）====================

/**
 * 获取窗口的原生 Win32 句柄（十进制字符串）
 * 用于 PowerShell 调用 Win32 API 时传递窗口句柄
 * @param {BrowserWindow} win - 目标窗口
 * @returns {string} 十进制窗口句柄
 */
function nativeWindowHandleDecimal(win) {
  const handle = win.getNativeWindowHandle();
  // x64 架构使用 64 位句柄，x86 使用 32 位
  if (process.arch === 'x64') return handle.readBigUInt64LE(0).toString();
  return String(handle.readUInt32LE(0));
}

/**
 * 将壁纸窗口嵌入 Windows 桌面的 WorkerW 层
 * 实现原理：利用 Windows 的 "显示桌面图标" 功能创建的 WorkerW 窗口，
 * 通过 SendMessage(0x052C) 使 Progman 创建一个子 WorkerW，
 * 然后将壁纸窗口设置为该 WorkerW 的子窗口，实现"壁纸"效果
 * @param {BrowserWindow} win - 壁纸窗口
 */
function attachWallpaperToWorkerW(win) {
  if (process.platform !== 'win32' || !win || win.isDestroyed()) return;
  const hwnd = nativeWindowHandleDecimal(win);
  const script = `
$ErrorActionPreference = "Stop"
if (-not ("BhandsMusicNativeWin" -as [type])) {
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class BhandsMusicNativeWin {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr childAfter, string className, string windowName);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam, uint fuFlags, uint uTimeout, out IntPtr lpdwResult);
}
"@
}
$progman = [BhandsMusicNativeWin]::FindWindow("Progman", $null)
$result = [IntPtr]::Zero
[BhandsMusicNativeWin]::SendMessageTimeout($progman, 0x052C, [IntPtr]::Zero, [IntPtr]::Zero, 0, 1000, [ref]$result) | Out-Null
$script:workerw = [IntPtr]::Zero
$enum = [BhandsMusicNativeWin+EnumWindowsProc]{
  param([IntPtr]$top, [IntPtr]$param)
  $shell = [BhandsMusicNativeWin]::FindWindowEx($top, [IntPtr]::Zero, "SHELLDLL_DefView", $null)
  if ($shell -ne [IntPtr]::Zero) {
    $script:workerw = [BhandsMusicNativeWin]::FindWindowEx([IntPtr]::Zero, $top, "WorkerW", $null)
  }
  return $true
}
[BhandsMusicNativeWin]::EnumWindows($enum, [IntPtr]::Zero) | Out-Null
if ($script:workerw -eq [IntPtr]::Zero) { $script:workerw = $progman }
$target = [IntPtr]::new([Int64]${hwnd})
[BhandsMusicNativeWin]::SetParent($target, $script:workerw) | Out-Null
[BhandsMusicNativeWin]::SetWindowPos($target, [IntPtr]::Zero, 0, 0, 0, 0, 0x0013) | Out-Null
`;
  execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    windowsHide: true,
    timeout: 5000,
  }, (error) => {
    if (error) console.warn('Wallpaper WorkerW attach failed:', error.message);
  });
}

/** 将壁纸窗口定位到主显示器全屏尺寸 */
function positionWallpaperWindow() {
  if (!wallpaperWindow || wallpaperWindow.isDestroyed()) return;
  const bounds = screen.getPrimaryDisplay().bounds;
  wallpaperWindow.setBounds(bounds, false);
}

/** 向壁纸渲染进程发送当前壁纸状态 */
function sendWallpaperState() {
  if (!wallpaperWindow || wallpaperWindow.isDestroyed()) return;
  wallpaperWindow.webContents.send('bhandsmusic-wallpaper-state', wallpaperState);
}

/**
 * 创建或更新壁纸窗口
 * 壁纸窗口覆盖整个主显示器，嵌入桌面 WorkerW 层实现动态壁纸效果
 * @param {object} payload - 壁纸配置
 * @returns {BrowserWindow} 壁纸窗口实例
 */
function createWallpaperWindow(payload = {}) {
  wallpaperState = { ...wallpaperState, ...payload, enabled: true };
  // 窗口已存在，更新位置和状态
  if (wallpaperWindow && !wallpaperWindow.isDestroyed()) {
    positionWallpaperWindow();
    sendWallpaperState();
    return wallpaperWindow;
  }

  // 创建全屏无边框窗口
  const bounds = screen.getPrimaryDisplay().bounds;
  wallpaperWindow = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: false,
    backgroundColor: '#050608', // 深色背景
    hasShadow: false,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    show: false,
    title: 'BhandsMusic Wallpaper',
    webPreferences: {
      preload: path.join(__dirname, 'overlay-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false, // 禁止后台节流，保证壁纸动画流畅
    },
  });

  // 壁纸窗口完全忽略鼠标事件（不可交互）
  wallpaperWindow.setIgnoreMouseEvents(true, { forward: true });

  wallpaperWindow.once('ready-to-show', () => {
    if (!wallpaperWindow || wallpaperWindow.isDestroyed()) return;
    positionWallpaperWindow();
    wallpaperWindow.showInactive();
    attachWallpaperToWorkerW(wallpaperWindow); // 嵌入桌面 WorkerW 层
    sendWallpaperState();
  });
  wallpaperWindow.webContents.once('did-finish-load', sendWallpaperState);
  wallpaperWindow.on('closed', () => {
    wallpaperWindow = null;
  });
  wallpaperWindow.loadURL(overlayUrl('wallpaper.html')).catch((e) => console.warn('Wallpaper load failed:', e.message));
  return wallpaperWindow;
}

/** 关闭壁纸窗口并清理状态 */
function closeWallpaperWindow() {
  wallpaperState = { ...wallpaperState, enabled: false };
  if (wallpaperWindow && !wallpaperWindow.isDestroyed()) {
    sendWallpaperState();
    wallpaperWindow.close();
  }
  wallpaperWindow = null;
}

/** 关闭所有覆盖层窗口（桌面歌词 + 壁纸） */
function closeOverlayWindows() {
  closeDesktopLyricsWindow();
  closeWallpaperWindow();
}

// ==================== IPC 处理器：窗口控制 ====================
// 渲染进程通过 ipcRenderer.invoke() 调用这些处理器

/** 最小化窗口 */
ipcMain.handle('desktop-window-minimize', (event) => {
  getSenderWindow(event)?.minimize();
});

/** 切换最大化/窗口化 */
ipcMain.handle('desktop-window-toggle-maximize', (event) => {
  toggleFullscreen(getSenderWindow(event));
});

/** 切换全屏/窗口化 */
ipcMain.handle('desktop-window-toggle-fullscreen', (event) => {
  toggleFullscreen(getSenderWindow(event));
});

/** 从全屏退出到窗口化模式 */
ipcMain.handle('desktop-window-exit-fullscreen-windowed', (event) => {
  exitFullscreenToWindow(getSenderWindow(event));
});

/** 获取当前窗口状态 */
ipcMain.handle('desktop-window-get-state', (event) => {
  return getWindowState(getSenderWindow(event));
});

/** 关闭窗口 */
ipcMain.handle('desktop-window-close', (event) => {
  getSenderWindow(event)?.close();
});

// ==================== IPC 处理器：全局快捷键 ====================

/** 配置全局快捷键绑定 */
ipcMain.handle('bhandsmusic-hotkeys-configure-global', (_event, bindings) => {
  return configureBhandsMusicGlobalHotkeys(bindings);
});

// ==================== IPC 处理器：数据导入导出 ====================

/**
 * 导出 JSON 文件（弹出保存对话框）
 * @param {object} payload - { defaultName: string, text?: string, data?: object }
 */
ipcMain.handle('bhandsmusic-export-json-file', async (event, payload = {}) => {
  try {
    const owner = getSenderWindow(event);
    const defaultName = String(payload.defaultName || 'bhandsmusic-export.json').replace(/[\\/:*?"<>|]+/g, '-');
    const result = await dialog.showSaveDialog(owner, {
      title: '导出 BhandsMusic 存档',
      defaultPath: defaultName.toLowerCase().endsWith('.json') ? defaultName : `${defaultName}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    const text = typeof payload.text === 'string' ? payload.text : JSON.stringify(payload.data || {}, null, 2);
    fs.writeFileSync(result.filePath, text, 'utf8');
    return { ok: true, filePath: result.filePath };
  } catch (e) {
    return { ok: false, error: e.message || 'EXPORT_FAILED' };
  }
});

/**
 * 导入 JSON 文件（弹出打开对话框）
 * @returns {{ok: boolean, filePath?: string, text?: string}}
 */
ipcMain.handle('bhandsmusic-import-json-file', async (event) => {
  try {
    const owner = getSenderWindow(event);
    const result = await dialog.showOpenDialog(owner, {
      title: '导入 BhandsMusic 存档',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePaths || !result.filePaths[0]) return { ok: false, canceled: true };
    const filePath = result.filePaths[0];
    const text = fs.readFileSync(filePath, 'utf8');
    return { ok: true, filePath, text };
  } catch (e) {
    return { ok: false, error: e.message || 'IMPORT_FAILED' };
  }
});

// ==================== IPC 处理器：音乐平台登录 ====================

/** 打开网易云音乐登录窗口 */
ipcMain.handle('netease-music-open-login', async (event) => {
  return openNeteaseMusicLoginWindow(getSenderWindow(event));
});

/** 清除网易云音乐登录状态 */
ipcMain.handle('netease-music-clear-login', async () => {
  return clearNeteaseMusicLoginSession();
});

/** 打开 QQ 音乐登录窗口 */
ipcMain.handle('qq-music-open-login', async (event) => {
  return openQQMusicLoginWindow(getSenderWindow(event));
});

/** 清除 QQ 音乐登录状态 */
ipcMain.handle('qq-music-clear-login', async () => {
  return clearQQMusicLoginSession();
});

// ==================== IPC 处理器：应用更新 ====================

/**
 * 打开更新安装程序
 * 安全校验：路径必须在更新目录内，防止任意文件执行
 * @param {string} filePath - 更新安装包路径
 */
ipcMain.handle('bhandsmusic-open-update-installer', async (_event, filePath) => {
  try {
    const target = path.resolve(String(filePath || ''));
    const updateDir = path.resolve(getUpdateDownloadDir());
    // 安全检查：确保文件在更新目录内
    if (!target || !target.startsWith(updateDir + path.sep)) {
      return { ok: false, error: 'INVALID_UPDATE_PATH' };
    }
    if (!fs.existsSync(target)) return { ok: false, error: 'UPDATE_FILE_MISSING' };
    const error = await shell.openPath(target);
    return error ? { ok: false, error } : { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'OPEN_UPDATE_FAILED' };
  }
});

/** 重启应用 */
ipcMain.handle('bhandsmusic-restart-app', async () => {
  try {
    app.relaunch();
    app.exit(0);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'RESTART_FAILED' };
  }
});

// ==================== IPC 处理器：桌面歌词 ====================

/** 启用/禁用桌面歌词 */
ipcMain.handle('bhandsmusic-desktop-lyrics-set-enabled', async (_event, enabled, payload) => {
  try {
    if (enabled) {
      createDesktopLyricsWindow(payload || {});
      broadcastDesktopLyricsEnabledState(true);
    } else {
      closeDesktopLyricsWindow();
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'DESKTOP_LYRICS_FAILED' };
  }
});

/** 更新桌面歌词配置（透明度、位置、锁定状态等） */
ipcMain.handle('bhandsmusic-desktop-lyrics-update', async (_event, payload) => {
  try {
    const nextState = { ...desktopLyricsState, ...(payload || {}) };
    if (nextState.enabled) {
      createDesktopLyricsWindow(payload || {});
    } else if (desktopLyricsWindow && !desktopLyricsWindow.isDestroyed()) {
      desktopLyricsState = nextState;
      sendDesktopLyricsState();
    } else {
      desktopLyricsState = nextState;
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'DESKTOP_LYRICS_UPDATE_FAILED' };
  }
});

/** 设置歌词窗口拖拽状态（预留接口） */
ipcMain.handle('bhandsmusic-desktop-lyrics-set-dragging', async () => {
  return { ok: true };
});

/** 设置鼠标指针捕获状态（解锁时需要捕获以响应交互） */
ipcMain.handle('bhandsmusic-desktop-lyrics-set-pointer-capture', async (_event, active) => {
  try {
    desktopLyricsPointerCapture = !!active;
    applyDesktopLyricsMouseBehavior();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'DESKTOP_LYRICS_POINTER_FAILED' };
  }
});

/** 设置歌词窗口的可交互热区（相对窗口坐标） */
ipcMain.handle('bhandsmusic-desktop-lyrics-set-hot-bounds', async (_event, bounds) => {
  try {
    const left = clampNumber(bounds && bounds.left, -2000, 4000, 0);
    const top = clampNumber(bounds && bounds.top, -2000, 4000, 0);
    const right = clampNumber(bounds && bounds.right, left + 1, 6000, left + 1);
    const bottom = clampNumber(bounds && bounds.bottom, top + 1, 6000, top + 1);
    desktopLyricsHotBounds = { left, top, right, bottom };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'DESKTOP_LYRICS_HOT_BOUNDS_FAILED' };
  }
});

/** 设置歌词窗口锁定状态（锁定=点击穿透，解锁=可交互） */
ipcMain.handle('bhandsmusic-desktop-lyrics-set-lock-state', async (_event, locked) => {
  try {
    desktopLyricsState = { ...desktopLyricsState, clickThrough: !!locked };
    if (desktopLyricsState.clickThrough !== false) desktopLyricsPointerCapture = false;
    applyDesktopLyricsMouseBehavior();
    broadcastDesktopLyricsLockState();
    return { ok: true, locked: desktopLyricsState.clickThrough !== false };
  } catch (e) {
    return { ok: false, error: e.message || 'DESKTOP_LYRICS_LOCK_FAILED' };
  }
});

/** 移动歌词窗口（相对偏移量，限制单次最大 160px） */
ipcMain.handle('bhandsmusic-desktop-lyrics-move-by', async (_event, dx, dy) => {
  try {
    if (!desktopLyricsWindow || desktopLyricsWindow.isDestroyed()) return { ok: false, error: 'NO_DESKTOP_LYRICS_WINDOW' };
    if (desktopLyricsState.clickThrough !== false) return { ok: false, error: 'DESKTOP_LYRICS_LOCKED' };
    const bounds = desktopLyricsWindow.getBounds();
    const next = {
      ...bounds,
      x: Math.round(bounds.x + clampNumber(dx, -160, 160, 0)),
      y: Math.round(bounds.y + clampNumber(dy, -160, 160, 0)),
    };
    desktopLyricsWindow.setBounds(next, false);
    desktopLyricsUserBounds = desktopLyricsWindow.getBounds();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'DESKTOP_LYRICS_MOVE_FAILED' };
  }
});

// ==================== IPC 处理器：壁纸模式 ====================

/** 启用/禁用壁纸模式 */
ipcMain.handle('bhandsmusic-wallpaper-set-enabled', async (_event, enabled, payload) => {
  try {
    if (enabled) createWallpaperWindow(payload || {});
    else closeWallpaperWindow();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'WALLPAPER_FAILED' };
  }
});

/** 更新壁纸配置 */
ipcMain.handle('bhandsmusic-wallpaper-update', async (_event, payload) => {
  try {
    wallpaperState = { ...wallpaperState, ...(payload || {}) };
    if (wallpaperState.enabled) {
      createWallpaperWindow(wallpaperState);
      if (wallpaperWindow && !wallpaperWindow.isDestroyed()) {
        positionWallpaperWindow();
        sendWallpaperState();
      }
    } else if (wallpaperWindow && !wallpaperWindow.isDestroyed()) {
      sendWallpaperState();
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'WALLPAPER_UPDATE_FAILED' };
  }
});

// ==================== 主窗口创建与应用生命周期 ====================

/**
 * 创建主窗口和本地服务器
 * 这是应用启动的核心函数，负责：
 * 1. 查找可用端口并启动本地 HTTP 服务器
 * 2. 配置环境变量（Cookie 文件路径、更新目录等）
 * 3. 迁移旧版 Cookie 文件
 * 4. 创建无边框主窗口并加载本地服务页面
 * 5. 注册所有窗口事件监听器
 */
async function createWindow() {
  htmlFullscreenActive = false;
  windowFullscreenActive = false;

  // 查找可用端口并启动本地服务器
  const port = await findOpenPort(3000);
  mainServerPort = port;

  // 配置环境变量，供 server.js 读取
  process.env.HOST = '127.0.0.1';
  process.env.PORT = String(port);
  process.env.COOKIE_FILE = path.join(app.getPath('userData'), '.cookie');
  process.env.QQ_COOKIE_FILE = path.join(app.getPath('userData'), '.qq-cookie');
  process.env.BHANDSMUSIC_UPDATE_DIR = getUpdateDownloadDir();

  // 迁移旧版 QQ Cookie 文件到新位置
  try {
    const legacyQQCookie = path.join(__dirname, '..', '.qq-cookie');
    if (fs.existsSync(legacyQQCookie)) {
      if (!fs.existsSync(process.env.QQ_COOKIE_FILE)) {
        fs.copyFileSync(legacyQQCookie, process.env.QQ_COOKIE_FILE);
      }
      fs.unlinkSync(legacyQQCookie); // 删除旧文件
    }
  } catch (e) {
    console.warn('QQ cookie migration skipped:', e.message);
  }

  // 启动本地 HTTP 服务器（提供前端页面和 API）
  localServer = require(path.join(__dirname, '..', 'server.js'));
  await waitForServer(localServer);

  // 计算初始窗口尺寸
  const initialBounds = getWindowedBounds();

  // 创建无边框透明主窗口
  mainWindow = new BrowserWindow({
    ...initialBounds,
    minWidth: 960,
    minHeight: 540,
    show: false,               // 初始隐藏，等 ready 后显示
    frame: false,              // 无边框（自定义标题栏）
    fullscreen: false,
    transparent: true,         // 透明背景（支持圆角等自定义外观）
    backgroundColor: '#00000000',
    hasShadow: true,
    autoHideMenuBar: true,     // 隐藏菜单栏
    title: APP_NAME,
    icon: APP_ICON_ICO,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,  // 渲染进程隔离，安全策略
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false, // 禁止后台节流，保持音乐播放
    },
  });

  // 拦截新窗口打开请求，用系统浏览器打开外部链接
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // 页面加载完成后发送窗口状态
  mainWindow.webContents.once('did-finish-load', () => {
    sendWindowState(mainWindow);
  });

  // 全屏时按 Escape 退出全屏
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (input.key === 'Escape' || input.code === 'Escape') && mainWindow.isFullScreen()) {
      event.preventDefault();
      exitFullscreenToWindow(mainWindow);
    }
  });

  // 窗口准备好后显示
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    sendWindowState(mainWindow);
  });

  // 注册窗口状态变化事件，实时同步给渲染进程
  mainWindow.on('maximize', () => sendWindowState(mainWindow));
  mainWindow.on('unmaximize', () => sendWindowState(mainWindow));
  mainWindow.on('minimize', () => sendWindowState(mainWindow));
  mainWindow.on('restore', () => sendWindowState(mainWindow));
  mainWindow.on('show', () => sendWindowState(mainWindow));
  mainWindow.on('hide', () => sendWindowState(mainWindow));
  mainWindow.on('focus', () => sendWindowState(mainWindow));
  mainWindow.on('blur', () => sendWindowState(mainWindow));
  // move/resize 使用防抖，避免高频发送
  mainWindow.on('move', () => scheduleWindowStateSend(mainWindow));
  mainWindow.on('resize', () => scheduleWindowStateSend(mainWindow));
  // 窗口关闭时清理所有资源
  mainWindow.on('closed', () => {
    if (mainWindowStateTimer) {
      clearTimeout(mainWindowStateTimer);
      mainWindowStateTimer = null;
    }
    closeOverlayWindows();
    mainWindow = null;
  });
  // 原生全屏事件
  mainWindow.on('enter-full-screen', () => {
    windowFullscreenActive = true;
    sendWindowState(mainWindow);
  });
  mainWindow.on('leave-full-screen', () => {
    windowFullscreenActive = false;
    setTimeout(() => applyWindowedBounds(mainWindow), 50);
  });
  // HTML5 全屏事件（如视频全屏）
  mainWindow.on('enter-html-full-screen', () => {
    htmlFullscreenActive = true;
    sendWindowState(mainWindow);
  });
  mainWindow.on('leave-html-full-screen', () => {
    htmlFullscreenActive = false;
    setTimeout(() => applyWindowedBounds(mainWindow), 50);
  });

  // 加载本地服务器页面
  await mainWindow.loadURL(`http://127.0.0.1:${port}`);
}

// ==================== 应用生命周期 ====================

// 设置应用名称和 Windows 任务栏标识
app.setName(APP_NAME);
if (process.platform === 'win32') app.setAppUserModelId(APP_USER_MODEL_ID);

if (!gotSingleInstanceLock) {
  // 未获取到单实例锁，说明已有实例在运行，退出当前实例
  app.quit();
} else {
  // 第二个实例启动时，聚焦到已有实例的窗口
  app.on('second-instance', () => {
    if (!focusMainWindow()) {
      app.whenReady().then(() => createWindow()).catch((e) => console.error('Second instance window restore failed:', e));
    }
  });

  // 应用就绪后初始化
  app.whenReady().then(async () => {
    // 监听显示器变化事件，重新定位覆盖层窗口
    screen.on('display-metrics-changed', () => {
      positionDesktopLyricsWindow();
      positionWallpaperWindow();
      scheduleWindowStateSend(mainWindow);
    });
    screen.on('display-added', () => scheduleWindowStateSend(mainWindow));
    screen.on('display-removed', () => scheduleWindowStateSend(mainWindow));
    await createWindow();
  });

  // macOS：点击 dock 图标时重新创建窗口或聚焦
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else focusMainWindow();
  });

  // 所有窗口关闭时退出应用（非 macOS）
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  // 退出前清理资源
  app.on('before-quit', () => {
    unregisterBhandsMusicGlobalHotkeys(); // 注销全局快捷键
    closeOverlayWindows();              // 关闭覆盖层窗口
    if (localServer && localServer.close) localServer.close(); // 关闭本地服务器
  });
}
