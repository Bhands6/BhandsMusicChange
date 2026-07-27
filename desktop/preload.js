/**
 * 主窗口预加载脚本
 *
 * 通过 contextBridge 向渲染进程暴露 window.desktopWindow API，
 * 提供窗口控制、音乐平台登录、桌面歌词、壁纸模式等功能的 IPC 调用接口。
 * 遵循 contextIsolation 安全策略，渲染进程无法直接访问 Node.js API。
 */

const { contextBridge, ipcRenderer } = require('electron');

// 向渲染进程全局对象 window.desktopWindow 暴露完整 API
contextBridge.exposeInMainWorld('desktopWindow', {
  // ==================== 环境标识 ====================
  /** 标识当前运行在 Electron 桌面环境中（渲染进程可据此判断环境） */
  isDesktop: true,

  // ==================== 窗口控制 ====================
  /** 最小化窗口 */
  minimize: () => ipcRenderer.invoke('desktop-window-minimize'),
  /** 切换最大化/窗口化 */
  toggleMaximize: () => ipcRenderer.invoke('desktop-window-toggle-maximize'),
  /** 切换全屏/窗口化 */
  toggleFullscreen: () => ipcRenderer.invoke('desktop-window-toggle-fullscreen'),
  /** 从全屏退出到窗口化模式 */
  exitFullscreenWindowed: () => ipcRenderer.invoke('desktop-window-exit-fullscreen-windowed'),
  /** 获取当前窗口状态（最大化、全屏、焦点、显示器信息等） */
  getState: () => ipcRenderer.invoke('desktop-window-get-state'),
  /** 关闭窗口 */
  close: () => ipcRenderer.invoke('desktop-window-close'),

  // ==================== 音乐平台登录 ====================
  /** 打开网易云音乐登录窗口 */
  openNeteaseMusicLogin: () => ipcRenderer.invoke('netease-music-open-login'),
  /** 清除网易云音乐登录状态（Cookie 等） */
  clearNeteaseMusicLogin: () => ipcRenderer.invoke('netease-music-clear-login'),
  /** 打开 QQ 音乐登录窗口 */
  openQQMusicLogin: () => ipcRenderer.invoke('qq-music-open-login'),
  /** 清除 QQ 音乐登录状态 */
  clearQQMusicLogin: () => ipcRenderer.invoke('qq-music-clear-login'),

  // ==================== 应用更新 ====================
  /** 打开更新安装程序（路径安全校验在主进程执行） */
  openUpdateInstaller: (filePath) => ipcRenderer.invoke('bhandsmusic-open-update-installer', filePath),
  /** 重启应用 */
  restartApp: () => ipcRenderer.invoke('bhandsmusic-restart-app'),

  // ==================== 全局快捷键 ====================
  /** 配置全局快捷键绑定（bindings: [{action, accelerator}]） */
  configureGlobalHotkeys: (bindings) => ipcRenderer.invoke('bhandsmusic-hotkeys-configure-global', bindings || []),
  /** 导出数据为 JSON 文件（弹出保存对话框） */
  exportJsonFile: (payload) => ipcRenderer.invoke('bhandsmusic-export-json-file', payload || {}),
  /** 导入 JSON 数据文件（弹出打开对话框） */
  importJsonFile: () => ipcRenderer.invoke('bhandsmusic-import-json-file'),

  /**
   * 监听全局快捷键触发事件
   * @param {Function} callback - 回调函数，接收 { action } 参数
   * @returns {Function} 取消订阅函数
   */
  onGlobalHotkey: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on('bhandsmusic-global-hotkey', listener);
    return () => ipcRenderer.removeListener('bhandsmusic-global-hotkey', listener);
  },

  // ==================== 桌面歌词 ====================
  /** 启用/禁用桌面歌词（payload 包含 y、opacity、clickThrough 等配置） */
  setDesktopLyricsEnabled: (enabled, payload) => ipcRenderer.invoke('bhandsmusic-desktop-lyrics-set-enabled', !!enabled, payload || {}),
  /** 更新桌面歌词配置（透明度、位置、锁定状态等） */
  updateDesktopLyrics: (payload) => ipcRenderer.invoke('bhandsmusic-desktop-lyrics-update', payload || {}),

  /**
   * 监听桌面歌词锁定状态变化
   * @param {Function} callback - 回调函数，接收 { locked } 参数
   * @returns {Function} 取消订阅函数
   */
  onDesktopLyricsLockState: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on('bhandsmusic-desktop-lyrics-lock-state', listener);
    return () => ipcRenderer.removeListener('bhandsmusic-desktop-lyrics-lock-state', listener);
  },

  /**
   * 监听桌面歌词启用/禁用状态变化
   * @param {Function} callback - 回调函数，接收 { enabled } 参数
   * @returns {Function} 取消订阅函数
   */
  onDesktopLyricsEnabledState: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on('bhandsmusic-desktop-lyrics-enabled-state', listener);
    return () => ipcRenderer.removeListener('bhandsmusic-desktop-lyrics-enabled-state', listener);
  },

  // ==================== 壁纸模式 ====================
  /** 启用/禁用壁纸模式 */
  setWallpaperMode: (enabled, payload) => ipcRenderer.invoke('bhandsmusic-wallpaper-set-enabled', !!enabled, payload || {}),
  /** 更新壁纸配置 */
  updateWallpaperMode: (payload) => ipcRenderer.invoke('bhandsmusic-wallpaper-update', payload || {}),

  // ==================== 系统设置 ====================
  /** 保存系统设置（关闭行为等） */
  saveSystemSettings: (settings) => ipcRenderer.send('save-system-settings', settings),
  /** 获取系统设置 */
  getSystemSettings: () => ipcRenderer.invoke('get-system-settings'),
  /** 监听系统设置变化（对话框选择后同步） */
  onSystemSettingsChanged: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = () => callback();
    ipcRenderer.on('system-settings-changed', listener);
    return () => ipcRenderer.removeListener('system-settings-changed', listener);
  },

  // ==================== 窗口状态监听 ====================
  /**
   * 监听窗口状态变化（最大化、全屏、焦点、显示器信息等）
   * @param {Function} callback - 回调函数，接收窗口状态对象
   * @returns {Function} 取消订阅函数
   */
  onStateChange: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('desktop-window-state', listener);
    return () => ipcRenderer.removeListener('desktop-window-state', listener);
  },
});

// ==================== DOM 初始化 ====================
// 页面加载完成后为根元素添加桌面环境标识类名，供 CSS 适配
window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.classList.add('desktop-shell-root');
  document.body.classList.add('desktop-shell');
});
