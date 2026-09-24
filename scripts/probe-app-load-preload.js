/**
 * probe-app-load.js 的 preload —— 唯一目的是**在主文档脚本之前**挂上错误监听。
 *
 * 为什么必须用 preload：现有 6 个探针都是在 `win.loadFile()` **完成之后**才
 * `executeJavaScript` 挂 `window.addEventListener('error')`，那时加载期错误早就报完了
 * —— 于是 `errors: []` 是**假绿**。2026-09-24 拆分 main.js 引入跨 script 函数提升
 * ReferenceError、应用黑屏，探针却全绿，根因就在这里。
 *
 * preload 在文档任何脚本之前执行，且 contextIsolation:false 下与页面同处一个
 * JS 世界，所以 `window.__LOAD_ERRORS` 能被主进程读到。
 *
 * 落盘不在这里做：preload 里拿不到 fs（sandbox 关闭时能拿到，但没必要），
 * 统一由主进程读走。
 */
(function () {
  'use strict';

  var errors = [];
  window.__LOAD_ERRORS = errors;

  function push(entry) {
    try {
      entry.at = Date.now();
      errors.push(entry);
    } catch (e) { /* 极端情况下别再抛，否则又变成加载期错误 */ }
  }

  // 捕获阶段监听：资源加载失败（img/script）不会冒泡，必须 capture
  window.addEventListener('error', function (e) {
    var t = e && e.target;
    if (t && t !== window && (t.tagName || t.src || t.href)) {
      push({
        kind: 'resource',
        tag: t.tagName || '',
        src: String(t.src || t.href || ''),
        stack: null,
      });
      return;
    }
    push({
      kind: 'error',
      msg: String((e && e.message) || e),
      file: String((e && e.filename) || ''),
      line: (e && e.lineno) || 0,
      col: (e && e.colno) || 0,
      stack: (e && e.error && e.error.stack) ? String(e.error.stack) : null,
    });
  }, true);

  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    push({
      kind: 'rejection',
      msg: String((r && r.message) || r),
      stack: (r && r.stack) ? String(r.stack) : null,
    });
  });
})();
