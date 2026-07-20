/**
 * 覆盖层预加载脚本（桌面歌词 & 壁纸窗口）
 *
 * 通过 contextBridge 向渲染进程暴露安全的 IPC 通信接口。
 * 桌面歌词和壁纸窗口使用此脚本与主进程通信，
 * 而非直接访问 Node.js API（遵循 contextIsolation 安全策略）。
 */

const { contextBridge, ipcRenderer } = require('electron');

/**
 * 绑定 IPC 事件监听器，返回取消订阅函数
 * @param {string} channel - IPC 频道名称
 * @param {Function} callback - 收到消息时的回调函数
 * @returns {Function} 取消订阅的清理函数
 */
function bind(channel, callback) {
  if (typeof callback !== 'function') return () => {};
  // 包装回调，确保传入的 payload 始终为对象
  const listener = (_event, payload) => callback(payload || {});
  ipcRenderer.on(channel, listener);
  // 返回取消订阅函数，防止内存泄漏
  return () => ipcRenderer.removeListener(channel, listener);
}

// 向渲染进程全局对象 window.desktopOverlay 暴露 API
contextBridge.exposeInMainWorld('desktopOverlay', {
  // ==================== 事件监听（主进程 -> 渲染进程）====================

  /** 监听桌面歌词状态更新（歌词内容、锁定状态、透明度等） */
  onLyricsState: (callback) => bind('mineradio-desktop-lyrics-state', callback),

  /** 监听壁纸状态更新 */
  onWallpaperState: (callback) => bind('mineradio-wallpaper-state', callback),

  // ==================== 操作指令（渲染进程 -> 主进程）====================

  /** 设置歌词窗口拖拽状态 */
  setLyricsDrag: (dragging) => ipcRenderer.invoke('mineradio-desktop-lyrics-set-dragging', !!dragging),

  /** 设置鼠标指针捕获状态（解锁时捕获以响应交互） */
  setLyricsPointerCapture: (active) => ipcRenderer.invoke('mineradio-desktop-lyrics-set-pointer-capture', !!active),

  /** 设置歌词窗口的可交互热区（相对窗口坐标） */
  setLyricsHotBounds: (bounds) => ipcRenderer.invoke('mineradio-desktop-lyrics-set-hot-bounds', bounds || {}),

  /** 设置歌词锁定状态（锁定=点击穿透，解锁=可交互） */
  setLyricsLockState: (locked) => ipcRenderer.invoke('mineradio-desktop-lyrics-set-lock-state', !!locked),

  /** 移动歌词窗口（相对偏移量 dx, dy） */
  moveLyricsBy: (dx, dy) => ipcRenderer.invoke('mineradio-desktop-lyrics-move-by', Number(dx) || 0, Number(dy) || 0),

  /** 关闭桌面歌词 */
  closeLyrics: () => ipcRenderer.invoke('mineradio-desktop-lyrics-set-enabled', false, {}),
});
