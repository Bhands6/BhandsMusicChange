/**
 * 自绘窗口手势：标题栏拖动 + 八方向拉边缩放
 *
 * 为什么要自绘（而不是继续用 -webkit-app-region / 系统边框）：
 * 1) 主窗口是 frame:false + transparent:true。Windows 下透明无边框窗口不带系统 resize 边框，
 *    用户拉窗口边缘不会有任何反应（Electron 官方限制：transparent 窗口不可 resize）。
 * 2) -webkit-app-region: drag 在部分 Electron / Chromium 组合下会整体失效
 *    —— 实测现象：标题栏按钮能点，但按住拖动毫无反应。
 *
 * 分工：本文件只负责「判定手势起止」，窗口怎么动全在主进程
 * （desktop/main.js 的 desktop-window-gesture-* 处理器，用 screen.getCursorScreenPoint()
 *  轮询光标再 setPosition / setBounds）。之所以不在这里上报位移：窗口跟着鼠标走时，
 * 光标相对窗口几乎不动，pointermove 会变稀疏甚至断流，靠它拖动会一卡一卡。
 *
 * 依赖：desktop/preload.js 暴露的 beginWindowGesture / endWindowGesture。
 */
(function initWindowGesture() {
  var api = window.desktopWindow;
  if (!api || !api.isDesktop) return;
  if (typeof api.beginWindowGesture !== 'function') return;
  // macOS 是原生 titled 窗口（隐藏标题栏 + 交通灯），拖动与缩放由系统接管，自绘会打架
  if (api.platform === 'darwin') return;

  var RESIZE_DIRS = ['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se'];

  /** 当前手势：{ mode, dir, pointerId, target } */
  var gesture = null;

  /** 全屏时没有标题栏/边框，手势一律忽略 */
  function isFullscreenNow() {
    return document.body.classList.contains('desktop-fullscreen') || !!document.fullscreenElement;
  }

  function endGesture() {
    if (!gesture) return;
    var target = gesture.target;
    var pointerId = gesture.pointerId;
    gesture = null;
    document.body.classList.remove('window-gesture-active');
    if (target && pointerId != null && target.releasePointerCapture) {
      try { target.releasePointerCapture(pointerId); } catch (err) {}
    }
    api.endWindowGesture();
  }

  function beginGesture(event, mode, dir) {
    if (event.button !== 0) return;
    if (gesture) return;
    if (isFullscreenNow()) return;
    gesture = {
      mode: mode,
      dir: dir || '',
      pointerId: event.pointerId,
      target: event.target,
    };
    document.body.classList.add('window-gesture-active');
    api.beginWindowGesture({ mode: mode, dir: dir || '' });
    // 指针捕获：拖到窗口外（或窗口被拖走）时仍能收到 pointerup，避免手势状态粘住
    try {
      var target = event.target;
      if (target && target.setPointerCapture) target.setPointerCapture(event.pointerId);
    } catch (err) {}
    // 刻意不 preventDefault：点标题栏仍要能把焦点交给窗口（否则拖完窗口键盘快捷键可能不生效），
    // 文本选中已由 body.window-gesture-active 的 user-select:none 挡掉
  }

  // ==================== 拖动：标题栏除按钮外的任意空白区 ====================
  // 不用 .desktop-drag-region 做唯一入口：它是空壳元素（子元素都被 display:none），
  // 一旦有可见层叠上来就会收不到事件。改成按「命中标题栏且不是交互控件」判定，更抗变化。
  var TITLEBAR_EXCLUDE = 'button, a, input, textarea, select, [data-window-action], .desktop-window-controls, .desktop-titlebar-left';

  function isTitlebarBlank(target) {
    if (!target || !target.closest) return false;
    if (!target.closest('#desktop-titlebar')) return false;
    return !target.closest(TITLEBAR_EXCLUDE);
  }

  document.addEventListener('pointerdown', function (event) {
    if (!isTitlebarBlank(event.target)) return;
    beginGesture(event, 'drag', '');
  }, true);

  // 刻意不做「双击标题栏切换全屏」：用户按住标题栏试拖动时会形成 down-up-down 序列，
  // 很容易被判定成双击，窗口突然全屏，看起来就像"长按不动窗口自己放大了"。
  // 全屏入口保留在右上角的窗口按钮里。

  // ==================== 缩放：8 个透明热区 ====================

  // 与 CSS 的 #desktop-titlebar height 保持一致
  var TITLEBAR_HEIGHT = 44;

  var layer = document.getElementById('window-gesture-layer');
  if (layer && layer.parentNode) layer.parentNode.removeChild(layer); // 重复注入时先清掉旧层
  layer = document.createElement('div');
  layer.id = 'window-gesture-layer';
  document.body.appendChild(layer);
  RESIZE_DIRS.forEach(function (dir) {
    var handle = document.createElement('i');
    handle.setAttribute('data-dir', dir);
    handle.addEventListener('pointerdown', function (event) {
      // 标题栏高度范围内一律按"移动窗口"处理。
      // 原因：n / nw / ne 手柄横在标题栏顶部（w / e 手柄的上段也伸进标题栏），
      // 用户在标题栏框内按下拖动时经常先命中手柄，结果变成缩放而不是移动 ——
      // 表现就是"在框里一拖，窗口自己变高/变宽"。标题栏是拖动区，不是缩放区。
      // 缩放请用标题栏以下的左右边缘、底边和下方两个角。
      if (event.clientY <= TITLEBAR_HEIGHT) {
        beginGesture(event, 'drag', '');
        return;
      }
      beginGesture(event, 'resize', dir);
    });
    layer.appendChild(handle);
  });

  window.addEventListener('pointerup', endGesture, true);
  window.addEventListener('pointercancel', endGesture, true);
  window.addEventListener('blur', endGesture);
})();
