'use strict';

// ============================================================
//  17-shell.js  —  外壳：Resize / 快捷键 / UI 半隐藏 / splash / 加载过渡 / 沉浸模式 / 桌面 overlay
//  由 public/js/app/*.js 于 2026-09-24「按职责重排」生成（零逻辑改动）。
//  ⚠️ 下方 `// <旧文件名> ← 源 main.js §NN` 横幅是**第一步拆分**留下的「来源」标注，
//     重排会把条目搬到职责文件里 —— 横幅里的文件名与本文件不一致是正常的。
//     找函数请按**函数名 grep**，别按文件名推断。
//  规则与验证见 docs/APP_REORG_PLAN.md 与 scripts/check-app-reorg.js。
// ============================================================



// 颜色渐变 tween (切歌时旧封面→新封面)
var colorMixTween = null;
function startColorMixTween(durationMs) {
  if (colorMixTween) cancelAnimationFrame(colorMixTween.raf);
  durationMs = Math.max(1, durationMs || 1);
  var start = performance.now();
  uniforms.uColorMixT.value = 0;
  function step(now) {
    var t = Math.min(1, (now - start) / durationMs);
    t = visualEase(t);
    uniforms.uColorMixT.value = t;
    if (t < 1) colorMixTween = { raf: requestAnimationFrame(step) };
    else colorMixTween = null;
  }
  colorMixTween = { raf: requestAnimationFrame(step) };
}

// 加载形态 tween (uLoading 0..1)
var loadingTween = null;
var loadingShownAt = 0;
var loadingHideTimer = null;
function visualEase(t) {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
}
function tweenLoading(to, durationMs, onComplete) {
  if (loadingTween) cancelAnimationFrame(loadingTween.raf);
  durationMs = Math.max(1, durationMs || 1);
  if (isHiddenForBackgroundOptimization() || isDeepBackgroundMode()) {
    uniforms.uLoading.value = to;
    loadingTween = null;
    if (onComplete) onComplete();
    return;
  }
  var start = performance.now();
  var from = uniforms.uLoading.value;
  function step(now) {
    var t = Math.min(1, (now - start) / durationMs);
    var eased = visualEase(t);
    uniforms.uLoading.value = from + (to - from) * eased;
    if (t < 1) loadingTween = { raf: requestAnimationFrame(step) };
    else {
      uniforms.uLoading.value = to;
      loadingTween = null;
      if (onComplete) onComplete();
    }
  }
  loadingTween = { raf: requestAnimationFrame(step) };
}
function showLoading() {
  loadingShownAt = performance.now();
  if (loadingHideTimer) {
    clearTimeout(loadingHideTimer);
    loadingHideTimer = null;
  }
  var current = uniforms.uLoading.value || 0;
  tweenLoading(Math.max(current, 0.56), current > 0.04 ? 86 : 118);
}
function hideLoading() {
  if (loadingHideTimer) clearTimeout(loadingHideTimer);
  if (isHiddenForBackgroundOptimization() || isDeepBackgroundMode()) {
    forceLoadingSettled('background-hide');
    return;
  }
  var elapsed = loadingShownAt ? performance.now() - loadingShownAt : 999;
  var wait = Math.max(0, 72 - elapsed);
  loadingHideTimer = setTimeout(function(){
    loadingHideTimer = null;
    var current = uniforms.uLoading.value || 0;
    if (current <= 0.015 || isHiddenForBackgroundOptimization() || isDeepBackgroundMode()) {
      if (loadingTween) {
        cancelAnimationFrame(loadingTween.raf);
        loadingTween = null;
      }
      uniforms.uLoading.value = 0;
      return;
    }
    tweenLoading(0, current > 0.38 ? 126 : 96);
  }, wait);
}
function forceLoadingSettled(reason) {
  if (loadingHideTimer) {
    clearTimeout(loadingHideTimer);
    loadingHideTimer = null;
  }
  if (loadingTween) {
    cancelAnimationFrame(loadingTween.raf);
    loadingTween = null;
  }
  uniforms.uLoading.value = 0;
  loadingShownAt = 0;
  if (reason && window.__bhandsmusicDebugLoading) console.log('[LoadingSettled]', reason);
}
function recoverVisualsAfterBackground(reason) {
  applyRendererPowerMode();
  if (typeof scheduleMainRendererViewportRefresh === 'function') scheduleMainRendererViewportRefresh(reason || 'restore');
  if (audio && audio.src && !audio.paused && ((uniforms.uLoading.value || 0) > 0.015 || loadingTween || loadingHideTimer)) {
    forceLoadingSettled(reason || 'restore');
  }
  if (typeof markRenderInteraction === 'function') markRenderInteraction('restore', 1100);
}

function saveHotkeySettings() {
  try { localStorage.setItem(HOTKEY_SETTINGS_STORE_KEY, JSON.stringify(hotkeySettings || getHotkeyDefaults())); } catch (e) {}
}
function hotkeyActionMeta(actionKey) {
  for (var i = 0; i < HOTKEY_ACTIONS.length; i++) {
    if (HOTKEY_ACTIONS[i].key === actionKey) return HOTKEY_ACTIONS[i];
  }
  return null;
}
function isModifierKeyCode(code) {
  return /^(ControlLeft|ControlRight|ShiftLeft|ShiftRight|AltLeft|AltRight|MetaLeft|MetaRight)$/i.test(String(code || ''));
}
function normalizeHotkeyEvent(e) {
  if (!e || isModifierKeyCode(e.code)) return '';
  var mods = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Meta');
  var code = e.code || '';
  if (!code && e.key) code = String(e.key).length === 1 ? 'Key' + String(e.key).toUpperCase() : String(e.key);
  if (!code) return '';
  return mods.concat([code]).join('+');
}
function hotkeyDisplayPart(part) {
  if (part === 'Ctrl') return 'Ctrl';
  if (part === 'Alt') return 'Alt';
  if (part === 'Shift') return 'Shift';
  if (part === 'Meta') return 'Win';
  if (part === 'Space') return 'Space';
  if (part === 'ArrowLeft') return 'Left';
  if (part === 'ArrowRight') return 'Right';
  if (part === 'ArrowUp') return 'Up';
  if (part === 'ArrowDown') return 'Down';
  if (/^Key[A-Z]$/.test(part)) return part.slice(3);
  if (/^Digit[0-9]$/.test(part)) return part.slice(5);
  if (/^Numpad[0-9]$/.test(part)) return 'Num' + part.slice(6);
  return part.replace(/^Equal$/, '=').replace(/^Minus$/, '-');
}
function formatHotkey(hotkey) {
  hotkey = String(hotkey || '').trim();
  if (!hotkey) return '未设置';
  return hotkey.split('+').map(hotkeyDisplayPart).join(' + ');
}
function hotkeyToAccelerator(hotkey) {
  var parts = String(hotkey || '').split('+').filter(Boolean);
  if (!parts.length) return '';
  return parts.map(function(part){
    if (part === 'Ctrl') return 'Control';
    if (part === 'Alt') return 'Alt';
    if (part === 'Shift') return 'Shift';
    if (part === 'Meta') return 'Super';
    if (part === 'Space') return 'Space';
    if (part === 'ArrowLeft') return 'Left';
    if (part === 'ArrowRight') return 'Right';
    if (part === 'ArrowUp') return 'Up';
    if (part === 'ArrowDown') return 'Down';
    if (/^Key[A-Z]$/.test(part)) return part.slice(3);
    if (/^Digit[0-9]$/.test(part)) return part.slice(5);
    return part;
  }).join('+');
}
function hotkeyDuplicateMap(scope) {
  var map = {};
  var source = (hotkeySettings && hotkeySettings[scope]) || {};
  Object.keys(source).forEach(function(action){
    var key = String(source[action] || '').trim();
    if (!key) return;
    map[key] = (map[key] || 0) + 1;
  });
  return map;
}
function executeHotkeyAction(actionKey, source) {
  if (actionKey === 'togglePlay') return togglePlay();
  if (actionKey === 'prevTrack') return prevTrack();
  if (actionKey === 'nextTrack') return nextTrack();
  if (actionKey === 'volumeUp') return adjustVolumeByKeyboard(0.05);
  if (actionKey === 'volumeDown') return adjustVolumeByKeyboard(-0.05);
  if (actionKey === 'toggleFullscreen') return toggleFullscreen();
  if (actionKey === 'toggleDesktopLyrics') return toggleFx('desktopLyrics');
}
function handleConfiguredLocalHotkey(e) {
  if (!hotkeySettings || !hotkeySettings.local || isTypingTarget(e.target)) return false;
  if (hotkeyCaptureState || document.getElementById('hotkey-modal') && document.getElementById('hotkey-modal').classList.contains('show')) return false;
  if (freeCamera && freeCamera.active && /^(KeyW|KeyA|KeyS|KeyD|KeyQ|KeyE|Space|ShiftLeft|ShiftRight|ControlLeft|ControlRight)$/.test(e.code)) return false;
  var combo = normalizeHotkeyEvent(e);
  if (!combo) return false;
  var duplicate = hotkeyDuplicateMap('local');
  for (var i = 0; i < HOTKEY_ACTIONS.length; i++) {
    var action = HOTKEY_ACTIONS[i];
    if (hotkeySettings.local[action.key] !== combo) continue;
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat && !/^volume/.test(action.key)) return true;
    if (duplicate[combo] > 1) return true;
    executeHotkeyAction(action.key, 'local');
    return true;
  }
  return false;
}
function shouldSuppressDefaultConfiguredHotkey(e) {
  if (!hotkeySettings || !hotkeySettings.local) return false;
  var combo = normalizeHotkeyEvent(e);
  if (!combo) return false;
  for (var i = 0; i < HOTKEY_ACTIONS.length; i++) {
    var action = HOTKEY_ACTIONS[i];
    if (action.local === combo && hotkeySettings.local[action.key] !== combo) return true;
  }
  return false;
}
function ensureHotkeySettingsButton() {
  var panel = document.getElementById('fx-panel');
  var head = panel && panel.querySelector('.fx-head');
  if (!head || document.getElementById('hotkey-settings-btn')) return;
  if (head.firstElementChild) head.firstElementChild.classList.add('fx-head-main');
  var actions = document.createElement('div');
  actions.className = 'fx-head-actions';
  var btn = document.createElement('button');
  btn.id = 'hotkey-settings-btn';
  btn.type = 'button';
  btn.className = 'fx-mini-btn ghost';
  btn.textContent = '热键';
  btn.addEventListener('click', function(e){ e.preventDefault(); e.stopPropagation(); openHotkeySettings(); });
  actions.appendChild(btn);
  head.appendChild(actions);
}
function ensureHotkeyModal() {
  var modal = document.getElementById('hotkey-modal');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = 'hotkey-modal';
  modal.className = 'hotkey-modal';
  modal.innerHTML =
    '<div class="hotkey-dialog" role="dialog" aria-modal="true" aria-label="热键设置">' +
      '<div class="hotkey-head">' +
        '<div><div class="hotkey-title">热键设置</div><div class="hotkey-sub">局内热键只在 BhandsMusic 窗口内生效；全局热键会向系统注册，并检测是否被占用。</div></div>' +
        '<button class="hotkey-close" type="button" data-hotkey-close aria-label="关闭">×</button>' +
      '</div>' +
      '<div class="hotkey-toolbar">' +
        '<div class="hotkey-tabs"><button type="button" data-hotkey-scope="local" class="active">局内热键</button><button type="button" data-hotkey-scope="global">全局热键</button></div>' +
        '<div class="hotkey-note">按 Backspace / Delete 可清空当前功能热键</div>' +
      '</div>' +
      '<div id="hotkey-local-section" class="hotkey-section active"></div>' +
      '<div id="hotkey-global-section" class="hotkey-section"></div>' +
      '<div class="hotkey-capture-tip" id="hotkey-capture-tip">正在录入组合键，按 Esc 取消。</div>' +
    '</div>';
  document.body.appendChild(modal);
  modal.addEventListener('click', function(e){
    if (e.target === modal || e.target.closest('[data-hotkey-close]')) closeHotkeySettings();
    var scopeBtn = e.target.closest('[data-hotkey-scope]');
    if (scopeBtn) setHotkeyModalScope(scopeBtn.getAttribute('data-hotkey-scope'));
    var bindBtn = e.target.closest('[data-hotkey-bind]');
    if (bindBtn) startHotkeyCapture(bindBtn.getAttribute('data-hotkey-action'), bindBtn.getAttribute('data-hotkey-bind'));
    var resetBtn = e.target.closest('[data-hotkey-reset]');
    if (resetBtn) resetHotkeyBinding(resetBtn.getAttribute('data-hotkey-action'), resetBtn.getAttribute('data-hotkey-reset'));
  });
  return modal;
}
function hotkeyStatusMarkup(scope, actionKey, binding, duplicate) {
  if (!binding) return '<span class="hotkey-status">未设置</span>';
  if (duplicate && duplicate[binding] > 1) return '<span class="hotkey-status conflict"><span class="source-icon">!</span>BhandsMusic 内部重复</span>';
  if (scope === 'local') return '<span class="hotkey-status ok">可用</span>';
  var status = hotkeyGlobalStatus[actionKey];
  if (!status) return '<span class="hotkey-status">待检测</span>';
  if (status.ok) return '<span class="hotkey-status ok">可用</span>';
  var source = status.conflict && status.conflict.sourceName || '系统 / 其他软件';
  return '<span class="hotkey-status conflict"><span class="source-icon">!</span>' + escHtml(source) + '</span>';
}
function renderHotkeyScope(scope) {
  var wrap = document.getElementById(scope === 'global' ? 'hotkey-global-section' : 'hotkey-local-section');
  if (!wrap) return;
  var duplicate = hotkeyDuplicateMap(scope);
  var html = '';
  var groups = {};
  HOTKEY_ACTIONS.forEach(function(action){
    (groups[action.category] = groups[action.category] || []).push(action);
  });
  Object.keys(groups).forEach(function(category){
    html += '<div class="hotkey-group"><div class="hotkey-group-title">' + escHtml(category) + '</div>';
    groups[category].forEach(function(action){
      var binding = (hotkeySettings[scope] && hotkeySettings[scope][action.key]) || '';
      html += '<div class="hotkey-row">' +
        '<div class="hotkey-name">' + escHtml(action.label) + '</div>' +
        '<button class="hotkey-key' + (hotkeyCaptureState && hotkeyCaptureState.scope === scope && hotkeyCaptureState.action === action.key ? ' capturing' : '') + '" type="button" data-hotkey-bind="' + scope + '" data-hotkey-action="' + action.key + '">' + escHtml(hotkeyCaptureState && hotkeyCaptureState.scope === scope && hotkeyCaptureState.action === action.key ? '按下组合键...' : formatHotkey(binding)) + '</button>' +
        '<button class="hotkey-reset" type="button" data-hotkey-reset="' + scope + '" data-hotkey-action="' + action.key + '">默认</button>' +
        hotkeyStatusMarkup(scope, action.key, binding, duplicate) +
      '</div>';
    });
    html += '</div>';
  });
  wrap.innerHTML = html;
}
function renderHotkeySettings() {
  var modal = ensureHotkeyModal();
  var active = modal.getAttribute('data-scope') || 'local';
  modal.classList.toggle('capturing', !!hotkeyCaptureState);
  modal.querySelectorAll('[data-hotkey-scope]').forEach(function(btn){
    btn.classList.toggle('active', btn.getAttribute('data-hotkey-scope') === active);
  });
  var local = document.getElementById('hotkey-local-section');
  var global = document.getElementById('hotkey-global-section');
  if (local) local.classList.toggle('active', active === 'local');
  if (global) global.classList.toggle('active', active === 'global');
  renderHotkeyScope('local');
  renderHotkeyScope('global');
}
function setHotkeyModalScope(scope) {
  var modal = ensureHotkeyModal();
  modal.setAttribute('data-scope', scope === 'global' ? 'global' : 'local');
  renderHotkeySettings();
}
function openHotkeySettings() {
  var modal = ensureHotkeyModal();
  modal.classList.add('show');
  modal.setAttribute('data-scope', modal.getAttribute('data-scope') || 'local');
  renderHotkeySettings();
  registerGlobalHotkeys();
}
function closeHotkeySettings() {
  hotkeyCaptureState = null;
  var modal = document.getElementById('hotkey-modal');
  if (modal) modal.classList.remove('show', 'capturing');
}
function startHotkeyCapture(action, scope) {
  hotkeyCaptureState = { action: action, scope: scope === 'global' ? 'global' : 'local' };
  var modal = ensureHotkeyModal();
  modal.setAttribute('data-scope', hotkeyCaptureState.scope);
  renderHotkeySettings();
}
function setHotkeyBinding(action, scope, value) {
  if (!hotkeySettings) hotkeySettings = getHotkeyDefaults();
  if (!hotkeySettings[scope]) hotkeySettings[scope] = {};
  hotkeySettings[scope][action] = value || '';
  saveHotkeySettings();
  renderHotkeySettings();
  if (scope === 'global') registerGlobalHotkeys();
}
function resetHotkeyBinding(action, scope) {
  var meta = hotkeyActionMeta(action);
  if (!meta) return;
  setHotkeyBinding(action, scope, scope === 'global' ? meta.global : meta.local);
}
function registerGlobalHotkeys() {
  var api = getDesktopWindowApi && getDesktopWindowApi();
  if (!api || typeof api.configureGlobalHotkeys !== 'function') {
    hotkeyGlobalStatus = {};
    renderHotkeySettings();
    return Promise.resolve();
  }
  var duplicate = hotkeyDuplicateMap('global');
  var bindings = [];
  HOTKEY_ACTIONS.forEach(function(action){
    var key = hotkeySettings.global && hotkeySettings.global[action.key];
    if (!key || duplicate[key] > 1) return;
    var accelerator = hotkeyToAccelerator(key);
    if (accelerator) bindings.push({ action: action.key, accelerator: accelerator });
  });
  return api.configureGlobalHotkeys(bindings).then(function(res){
    var next = {};
    (res && res.results || []).forEach(function(item){
      next[item.action] = item;
    });
    hotkeyGlobalStatus = next;
    renderHotkeySettings();
  }).catch(function(){
    hotkeyGlobalStatus = {};
    renderHotkeySettings();
  });
}
var globalHotkeyListenerBound = false;
function bindHotkeySettings() {
  ensureHotkeySettingsButton();
  ensureHotkeyModal();
  if (!globalHotkeyListenerBound) {
    var api = getDesktopWindowApi && getDesktopWindowApi();
    if (api && typeof api.onGlobalHotkey === 'function') {
      globalHotkeyListenerBound = true;
      api.onGlobalHotkey(function(payload){
        if (!payload || !payload.action) return;
        executeHotkeyAction(payload.action, 'global');
      });
    }
  }
  registerGlobalHotkeys();
}
document.addEventListener('keydown', function(e){
  var hotkeyModal = document.getElementById('hotkey-modal');
  if (!hotkeyCaptureState) {
    if (hotkeyModal && hotkeyModal.classList.contains('show') && e.code === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeHotkeySettings();
    }
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  if (e.code === 'Escape') {
    hotkeyCaptureState = null;
    renderHotkeySettings();
    return;
  }
  if (e.code === 'Backspace' || e.code === 'Delete') {
    var clearTarget = hotkeyCaptureState;
    hotkeyCaptureState = null;
    setHotkeyBinding(clearTarget.action, clearTarget.scope, '');
    return;
  }
  var combo = normalizeHotkeyEvent(e);
  if (!combo) return;
  var target = hotkeyCaptureState;
  hotkeyCaptureState = null;
  setHotkeyBinding(target.action, target.scope, combo);
}, true);

function syncControlsAutoHideButton() {
  var btn = document.getElementById('controls-hide-btn');
  if (btn) btn.classList.toggle('active', controlsAutoHide);
  if (!controlsAutoHide && controlsHideTimer) {
    clearTimeout(controlsHideTimer);
    controlsHideTimer = null;
  }
}

function setParticleLyricsSilently(on) {
  fx.particleLyrics = !!on;
  if (fx.particleLyrics) createLyricsParticles();
  else clearStageLyrics();
  lyricsVisible = fx.particleLyrics;
  updateLyricsToggleButton();
}

function updateImmersiveButton() {
  var btn = document.getElementById('immersive-btn');
  if (!btn) return;
  btn.classList.toggle('active', immersiveMode);
  btn.setAttribute('aria-pressed', immersiveMode ? 'true' : 'false');
  btn.title = immersiveMode ? '退出全沉浸式' : '全沉浸式';
  btn.setAttribute('aria-label', btn.title);
}

function closeImmersiveInterference() {
  closeMiniQueue();
  toggleFxPanel(false);
  closeUploadTip(false);
  closeLoginModal();
  closeUserModal();
  closeCollectModal();
  closeCoverCropModal();
  closeCustomLyricModal();
  closeTrackDetailModal();
  if (!localBeatAnalysis.active) closeLocalBeatModal();
  ['search-area', 'fx-panel', 'trial-banner', 'ai-depth-chip', 'beat-chip'].forEach(function(id){
    var el = document.getElementById(id);
    if (el) el.classList.remove('peek', 'show', 'closing');
  });
  var fab = document.getElementById('fx-fab');
  if (fab) fab.classList.remove('active');
  document.body.classList.remove('login-guide-active');
  setFocusZone(null, true);
}

function setImmersiveMode(on) {
  on = !!on;
  if (immersiveMode === on) return;

  if (on) {
    immersiveState = {
      shelfMode: fx.shelf,
      shelfPinnedOpen: shelfPinnedOpen,
      lyrics: fx.particleLyrics,
      controlsAutoHide: controlsAutoHide,
      bottomVisible: !!(document.getElementById('bottom-bar') && document.getElementById('bottom-bar').classList.contains('visible'))
    };
    immersiveMode = true;
    document.body.classList.add('immersive-mode');
    var bottomBarEnter = document.getElementById('bottom-bar');
    if (bottomBarEnter) bottomBarEnter.classList.add('visible');
    closeImmersiveInterference();
    if (!fx.particleLyrics) setParticleLyricsSilently(true);
    controlsAutoHide = true;
    syncControlsAutoHideButton();
    updateImmersiveButton();
    syncCursorAutoHideMode();
    revealBottomControls(720);
    setTimeout(function(){
      if (immersiveMode && !controlsHovering) setControlsHidden(true);
    }, 980);
    return;
  }

  immersiveMode = false;
  document.body.classList.remove('immersive-mode');
  closeMiniQueue();
  if (immersiveState.shelfMode) setShelfMode(immersiveState.shelfMode);
  if (immersiveState.shelfMode === 'side' && immersiveState.shelfPinnedOpen) setShelfPinnedOpen(true, true);
  else setShelfPinnedOpen(false, true);
  if (immersiveState.lyrics === false) setParticleLyricsSilently(false);
  controlsAutoHide = immersiveState.controlsAutoHide !== false;
  syncControlsAutoHideButton();
  updateImmersiveButton();
  syncCursorAutoHideMode();
  var bottomBarExit = document.getElementById('bottom-bar');
  if (immersiveState.bottomVisible) revealBottomControls(900);
  else if (bottomBarExit) bottomBarExit.classList.remove('visible', 'soft-hidden');
  showToast('已退出全沉浸式');
}

function toggleImmersiveMode() {
  setImmersiveMode(!immersiveMode);
}

function setCamMode(m) {
  if (m === 'head') m = 'gesture'; // v8: 头部追踪已下线, 兼容旧设置
  fx.cam = m;
  document.querySelectorAll('#cam-seg button').forEach(function(b){ b.classList.toggle('active', b.dataset.cam === m); });
  if (m === 'off') stopGestureControl();
  else if (m === 'gesture') startGestureControl();
  saveLyricLayout();
}

// ============================================================
//  15-shell.js  ←  源 main.js §39–§41（基线 784afe6）
//  Resize 快捷键 / UI 半隐藏 v8 / 启动页 splash
// ============================================================

// ============================================================
//  Resize / 快捷键
// ============================================================
function refreshMainRendererViewport(reason) {
  if (typeof camera !== 'undefined' && camera) {
    camera.aspect = Math.max(1, innerWidth) / Math.max(1, innerHeight);
    camera.updateProjectionMatrix();
  }
  applyRendererPowerMode();
  if (typeof requestStageLyricCameraSnap === 'function' && (desktopRuntimeState.fullscreen || document.fullscreenElement)) {
    requestStageLyricCameraSnap(reason === 'resize' ? 4 : 10);
  }
}
function scheduleMainRendererViewportRefresh(reason) {
  refreshMainRendererViewport(reason || 'sync');
  [48, 140, 320].forEach(function(delay){
    setTimeout(function(){ refreshMainRendererViewport(reason || 'sync'); }, delay);
  });
}
window.addEventListener('resize', function(){
  scheduleMainRendererViewportRefresh('resize');
  if (desktopRuntimeState.fullscreen || desktopFullscreenActive || document.fullscreenElement || document.body.classList.contains('desktop-fullscreen')) layoutFullscreenDiyZone();
});
document.addEventListener('keydown', function(e){
  if (isTypingTarget(e.target)) return;
  if (handleConfiguredLocalHotkey(e)) return;
  if (shouldSuppressDefaultConfiguredHotkey(e)) return;
  if (e.code === 'Space') {
    if (freeCamera && freeCamera.active) { e.preventDefault(); return; }
    e.preventDefault(); togglePlay();
  }
  else if (e.code === 'Home') { e.preventDefault(); goHome(); }
  else if (e.code === 'ArrowUp') { e.preventDefault(); adjustVolumeByKeyboard(0.05); }
  else if (e.code === 'ArrowDown') { e.preventDefault(); adjustVolumeByKeyboard(-0.05); }
  else if (e.code === 'ArrowRight') nextTrack();
  else if (e.code === 'ArrowLeft')  prevTrack();
  else if (e.code === 'Escape')     {
    if (immersiveMode) {
      e.preventDefault();
      setImmersiveMode(false);
      return;
    }
    if (window.desktopWindow && window.desktopWindow.isDesktop && desktopFullscreenActive && !document.fullscreenElement && window.desktopWindow.exitFullscreenWindowed) {
      e.preventDefault();
      window.desktopWindow.exitFullscreenWindowed();
      return;
    }
    if (document.fullscreenElement) {
      e.preventDefault();
      document.exitFullscreen();
      return;
    }
    var localBeatModal = document.getElementById('local-beat-modal');
    if (localBeatModal && localBeatModal.classList.contains('show')) {
      e.preventDefault();
      if (localBeatAnalysis.active) cancelLocalBeatAnalysis();
      else closeLocalBeatModal();
      return;
    }
    var customLyricModal = document.getElementById('custom-lyric-modal');
    if (customLyricModal && customLyricModal.classList.contains('show')) {
      e.preventDefault();
      closeCustomLyricModal();
      return;
    }
    var trackDetailModal = document.getElementById('track-detail-modal');
    if (trackDetailModal && trackDetailModal.classList.contains('show')) {
      e.preventDefault();
      closeTrackDetailModal();
      return;
    }
    if (miniQueueOpen) { closeMiniQueue(); return; }
    if (shelfManager && shelfManager.hasOpenContent()) { safeShelfCloseContent('escape-key'); return; }
    closeLoginModal(); closeUserModal(); toggleFxPanel(false); togglePlaylistPanel(false);
  }
  else if (e.code === 'KeyL') { if (!immersiveMode) toggleLyricsPanel(); }
  else if (e.code === 'KeyP') {
    if (!immersiveMode && diyPlayerMode) toggleFxPanel();
    else if (!immersiveMode) showToast('开启 DIY 玩家模式后可打开视觉控制台');
  }
  else if (e.code === 'KeyI') toggleImmersiveMode();
  else if (e.code === 'KeyF') toggleFullscreen();
});

// ============================================================
//  UI 半隐藏 v8 — 三个面板的触发/隐藏体验完全统一
//   - 搜索栏 (顶部): y < 80 进入, y > 96 离开
//   - 控制台 (右侧): x > w-48 进入, x < w-380 离开
//   - 歌单 (左侧): x < 48 进入, x > 380 离开
//   - 进入立即显示, 离开延迟 500ms (统一)
// ============================================================
var PEEK_HIDE_DELAY = 170;
var peekTimers = { search:null, fx:null, pl:null };
function setPeek(el, on, key) {
  if (!el) return;
  if (immersiveMode && on && (key === 'search' || key === 'fx')) return;
  if (on && !diyPlayerMode && key === 'fx') return;
  if (!on && key === 'search' && emptyHomeActive && !immersiveMode) return;
  if (!on && key === 'pl' && playlistPanelPinned) return;
  if (on && key === 'fx') document.body.classList.remove('fullscreen-diy-peek');
  if (on) {
    var wasPeek = el.classList.contains('peek');
    if (peekTimers[key]) { clearTimeout(peekTimers[key]); peekTimers[key] = null; }
    if (key === 'fx') el.classList.remove('closing');
    if (key === 'pl' && !wasPeek && !playQueue.length && queueViewTab === 'queue') switchPlaylistTab('playlists');
    if (key === 'pl' && !wasPeek && playQueue.length && currentIdx >= 0) {
      if (el.dataset && el.dataset.preserveTabOnOpen === '1') delete el.dataset.preserveTabOnOpen;
      else if (queueViewTab !== 'queue') switchPlaylistTab('queue');
      scrollPlaylistPanelToCurrent();
    } else if (key === 'pl' && el.dataset && el.dataset.preserveTabOnOpen === '1') {
      delete el.dataset.preserveTabOnOpen;
    }
    el.classList.add('peek');
    if (key === 'pl' && !wasPeek) {
      scheduleUiWarmTask(function(){
        flushDeferredQueuePanel('playlist-panel-peek');
        if (queueViewTab === 'queue') animateVisiblePanelList(document.getElementById('queue-list'), '.queue-item', el, '.queue-item.now', { scrollActive: false });
      }, 180);
    }
    if (key === 'fx') {
      var fabOn = document.getElementById('fx-fab');
      if (fabOn) fabOn.classList.add('active');
    }
  } else {
    if (peekTimers[key]) clearTimeout(peekTimers[key]);
    peekTimers[key] = setTimeout(function(){
      el.classList.remove('peek');
      if (key === 'fx') {
        var fabOff = document.getElementById('fx-fab');
        if (fabOff && !el.classList.contains('show')) fabOff.classList.remove('active');
      }
      peekTimers[key] = null;
    }, PEEK_HIDE_DELAY);
  }
}
function uploadTipWasSeen() {
  try { return localStorage.getItem(UPLOAD_TIP_STORE_KEY) === '1'; } catch (e) { return true; }
}
function markUploadTipSeen() {
  try { localStorage.setItem(UPLOAD_TIP_STORE_KEY, '1'); } catch (e) {}
}
function closeUploadTip(manual) {
  var tip = document.getElementById('upload-tip');
  if (uploadTipTimer) { clearTimeout(uploadTipTimer); uploadTipTimer = null; }
  if (manual) markUploadTipSeen();
  if (!tip || !tip.classList.contains('show')) return;
  if (window.gsap) {
    window.gsap.killTweensOf(tip);
    window.gsap.to(tip, {
      autoAlpha: 0,
      y: -8,
      scale: 0.98,
      duration: 0.24,
      ease: 'power2.in',
      overwrite: true,
      onComplete: function(){
        tip.classList.remove('show');
        window.gsap.set(tip, { clearProps: 'opacity,visibility,transform,filter' });
      }
    });
  } else {
    tip.classList.remove('show');
  }
}
function maybeShowUploadTipOnce() {
  if (!diyPlayerMode) return;
  if (uploadTipWasSeen()) return;
  if (immersiveMode) {
    setTimeout(maybeShowUploadTipOnce, 1800);
    return;
  }
  if (document.body.classList.contains('splash-active') || loginGuideAnimating) {
    setTimeout(maybeShowUploadTipOnce, 900);
    return;
  }
  var loginModal = document.getElementById('login-modal');
  var userModal = document.getElementById('user-modal');
  var coverModal = document.getElementById('cover-crop-modal');
  var hasModal = (loginModal && loginModal.classList.contains('show')) ||
    (userModal && userModal.classList.contains('show')) ||
    (coverModal && coverModal.classList.contains('show'));
  if (hasModal) {
    uploadTipAttempts++;
    if (uploadTipAttempts < 18) setTimeout(maybeShowUploadTipOnce, 1800);
    return;
  }
  var area = document.getElementById('search-area');
  var tip = document.getElementById('upload-tip');
  if (!area || !tip) return;
  markUploadTipSeen();
  setPeek(area, true, 'search');
  tip.classList.add('show');
  if (window.gsap) {
    window.gsap.killTweensOf(tip);
    window.gsap.fromTo(tip,
      { autoAlpha: 0, y: -10, scale: 0.975 },
      { autoAlpha: 1, y: 0, scale: 1, duration: 0.62, ease: 'expo.out', overwrite: true }
    );
    var uploadBtn = document.getElementById('upload-btn');
    if (uploadBtn) {
      window.gsap.fromTo(uploadBtn,
        { scale: 1, boxShadow: '0 10px 32px rgba(0,0,0,.22)' },
        { scale: 1.07, boxShadow: '0 0 0 8px rgba(244,210,138,0),0 16px 46px rgba(244,210,138,.14)', duration: 0.58, ease: 'sine.inOut', yoyo: true, repeat: 3, overwrite: true }
      );
    }
  }
  uploadTipTimer = setTimeout(function(){
    uploadTipTimer = null;
    closeUploadTip(false);
    setPeek(area, false, 'search');
  }, 6800);
}
var secondaryPlaylistEdgeGuard = { enteredAt:0, timer:null, x:0, y:0, H:0 };
var SECONDARY_PLAYLIST_EDGE_MIN_X = 36;
var SECONDARY_PLAYLIST_EDGE_MAX_X = 96;
var SECONDARY_PLAYLIST_EDGE_DWELL_MS = 220;
function isSecondaryLeftDisplaySeamGuardActive() {
  var state = (typeof desktopWindowState !== 'undefined' && desktopWindowState) ? desktopWindowState : {};
  return !!(window.desktopWindow && window.desktopWindow.isDesktop && state.isPrimaryDisplay === false && state.hasDisplayOnLeft);
}
function resetSecondaryPlaylistEdgeGuard() {
  if (secondaryPlaylistEdgeGuard.timer) {
    clearTimeout(secondaryPlaylistEdgeGuard.timer);
    secondaryPlaylistEdgeGuard.timer = null;
  }
  secondaryPlaylistEdgeGuard.enteredAt = 0;
}
function isSecondaryPlaylistSafeBandPoint(ex, ey, H) {
  return ey > 132 && ey < H - 132 && ex >= SECONDARY_PLAYLIST_EDGE_MIN_X && ex < SECONDARY_PLAYLIST_EDGE_MAX_X;
}
function armSecondaryPlaylistEdgeDwell() {
  if (secondaryPlaylistEdgeGuard.timer) return;
  secondaryPlaylistEdgeGuard.timer = setTimeout(function(){
    secondaryPlaylistEdgeGuard.timer = null;
    if (!isSecondaryLeftDisplaySeamGuardActive()) return;
    if (!isSecondaryPlaylistSafeBandPoint(secondaryPlaylistEdgeGuard.x, secondaryPlaylistEdgeGuard.y, secondaryPlaylistEdgeGuard.H)) return;
    var panel = document.getElementById('playlist-panel');
    if (panel) setPeek(panel, true, 'pl');
  }, SECONDARY_PLAYLIST_EDGE_DWELL_MS);
}
function isPlaylistEdgeTrigger(ex, ey, H) {
  var inVerticalBand = ey > 132 && ey < H - 132;
  if (!inVerticalBand) {
    resetSecondaryPlaylistEdgeGuard();
    return false;
  }
  if (!isSecondaryLeftDisplaySeamGuardActive()) {
    return ex >= 14 && ex < 78;
  }
  var inSafeBand = isSecondaryPlaylistSafeBandPoint(ex, ey, H);
  if (!inSafeBand) {
    resetSecondaryPlaylistEdgeGuard();
    return false;
  }
  secondaryPlaylistEdgeGuard.x = ex;
  secondaryPlaylistEdgeGuard.y = ey;
  secondaryPlaylistEdgeGuard.H = H;
  var now = performance.now();
  if (!secondaryPlaylistEdgeGuard.enteredAt) secondaryPlaylistEdgeGuard.enteredAt = now;
  armSecondaryPlaylistEdgeDwell();
  return now - secondaryPlaylistEdgeGuard.enteredAt >= SECONDARY_PLAYLIST_EDGE_DWELL_MS;
}
function shouldClosePlaylistPanelFromPointer(ppOn, ex, ppRect) {
  if (!ppOn) return false;
  // 鼠标不在歌单列表上就收起（是否在列表由调用方 inPanel 判定；常开由 setPeek 拦截）
  return true;
}
function isPlaylistPanelFocusActive(inTrigger, inPanel, pp, ex, ppRect) {
  return !!(inTrigger || inPanel);
}
function collapsePlaylistPanelIfPointerGone() {
  var pp = document.getElementById('playlist-panel');
  if (!pp || !pp.classList.contains('peek')) {
    // 即使面板已收起，也要把 queue 镜头焦点退掉，否则快速左甩后镜头不回正
    if (typeof setFocusZone === 'function' && (!focusHover || !focusHover.wantType || focusHover.wantType === 'queue')) {
      setFocusZone(null, true);
    }
    return;
  }
  if (playlistPanelPinned) return;
  if (typeof visualGuideActive !== 'undefined' && visualGuideActive) return;
  if (pp.matches(':hover')) return;
  setPeek(pp, false, 'pl');
  // 与 mousemove 收起路径一致：退出 queue focus，镜头插值回主姿态
  if (typeof setFocusZone === 'function') {
    if (!focusHover || !focusHover.wantType || focusHover.wantType === 'queue') setFocusZone(null, true);
  }
}
// 快速从左/任意一侧甩出窗口时可能不再触发 mousemove，必须在离开文档时收起
document.addEventListener('mouseleave', function (e) {
  if (e && e.relatedTarget) return;
  collapsePlaylistPanelIfPointerGone();
});
document.addEventListener('mouseout', function (e) {
  if (e && (e.relatedTarget || e.toElement)) return;
  collapsePlaylistPanelIfPointerGone();
});
window.addEventListener('blur', function () {
  collapsePlaylistPanelIfPointerGone();
});
window.addEventListener('mousemove', function(e){
  var sa = document.getElementById('search-area');
  var fp = document.getElementById('fx-panel');
  var pp = document.getElementById('playlist-panel');
  var ex = e.clientX, ey = e.clientY, W = innerWidth, H = innerHeight;
  updateUserCapsuleAutoHideFromPointer(ex, ey);
  updateFxFabAutoHideFromPointer(ex, ey);
  updateFullscreenDiyPeekFromPointer(ex, ey);
  if (document.body.classList.contains('splash-active')) {
    updateShelfHoverCueFromPointer(null);
    updateShelfCardHoverSelection(null);
    setFocusZone(null);
    return;
  }
  if (immersiveMode) {
    updateShelfHoverCueFromPointer(e);
    updateShelfCardHoverSelection(e);
    updateControlsAutoHideFromPointer(ex, ey);
    var ppOnImm = pp.classList.contains('peek');
    var ppRectImm = pp.getBoundingClientRect();
    var inQueueTriggerImm = isPlaylistEdgeTrigger(ex, ey, H);
    var inQueuePanelImm = ppOnImm && ex >= ppRectImm.left - 18 && ex <= ppRectImm.right + 24 && ey >= ppRectImm.top - 22 && ey <= ppRectImm.bottom + 22;
    if (inQueueTriggerImm || inQueuePanelImm) setPeek(pp, true, 'pl');
    else if (shouldClosePlaylistPanelFromPointer(ppOnImm, ex, ppRectImm)) setPeek(pp, false, 'pl');
    var shelfCanFocusImm = !!(shelfManager && shelfManager.canInteract && shelfManager.canInteract());
    var newFocusImm = null;
    var queueFocusImm = isPlaylistPanelFocusActive(inQueueTriggerImm, inQueuePanelImm, pp, ex, ppRectImm);
    var shelfHoverFocusImm = !!(shelfCanFocusImm && isSideShelfFocusHit(e));
    if (queueFocusImm) newFocusImm = 'queue';
    else if (shelfManager && shelfManager.hasOpenContent && shelfManager.hasOpenContent()) newFocusImm = 'shelf-detail';
    else if (shelfHoverFocusImm) newFocusImm = 'shelf-side';
    else if (shelfCanFocusImm && shelfManager.getMode() === 'stage' && ey > H * 0.55) newFocusImm = 'shelf-stage';
    setFocusZone(newFocusImm, newFocusImm === 'queue');
    return;
  }
  updateShelfHoverCueFromPointer(e);
  updateShelfCardHoverSelection(e);
  // 搜索 (上): 顶部 48px 内进入; 已显示时鼠标在 280px 内保留
  var saOn = sa.classList.contains('peek');
  var saRect = sa.getBoundingClientRect();
  var searchFocused = document.activeElement === $input;
  var uploadTip = document.getElementById('upload-tip');
  var uploadTipOpen = !!(uploadTip && uploadTip.classList.contains('show'));
  var inSearchPanel = saOn && ex >= saRect.left - 24 && ex <= saRect.right + 24 && ey >= saRect.top - 22 && ey <= saRect.bottom + 42;
  if (ey < 66 || inSearchPanel || searchFocused || uploadTipOpen) setPeek(sa, true, 'search');
  else if (saOn && !emptyHomeActive) setPeek(sa, false, 'search');
  // 控制台: 仅由右上角入口点击打开（toggleFxPanel）。
  // 原设计是「鼠标靠近右下角 fx-fab 自动 peek」——入口移到右上角后，鼠标悬停按钮
  // 会误触发弹出（用户要求改为点击才弹），因此移除 inFxFab / inFxBridge 的 hover 触发；
  // 保留 inFxPanel：面板已打开时鼠标在面板内维持显示，移开自动收起。
  var fpOn = fp.classList.contains('peek') || fp.classList.contains('show');
  var fpRect = fp.getBoundingClientRect();
  var fabEl = document.getElementById('fx-fab');
  var fabRect = fabEl ? fabEl.getBoundingClientRect() : null;
  // 维持区域 = 面板矩形 ∪「右上角入口 → 面板」的右侧过渡竖条
  // （入口在右上角、面板在右侧中部，鼠标从按钮移向面板的途中不能提前收起）
  var inFxPanel = fpOn && (
    (ex >= fpRect.left - 24 && ex <= fpRect.right + 24 && ey >= fpRect.top - 24 && ey <= fpRect.bottom + 24) ||
    (fabRect && ex >= fabRect.left - 24 && ex <= W && ey >= fabRect.top - 24 && ey <= Math.max(fpRect.bottom, fabRect.bottom) + 24)
  );
  if (!diyPlayerMode) inFxPanel = false;
  if (inFxPanel) setPeek(fp, true, 'fx');
  else if (fpOn) setPeek(fp, false, 'fx');
  // 歌单/队列 DOM 面板只在左侧明确停留时出现，避免和右侧 3D 架抢焦点
  var ppOn = pp.classList.contains('peek');
  var ppRect = pp.getBoundingClientRect();
  var inQueueTrigger = isPlaylistEdgeTrigger(ex, ey, H);
  var inQueuePanel = ppOn && ex >= ppRect.left - 18 && ex <= ppRect.right + 24 && ey >= ppRect.top - 22 && ey <= ppRect.bottom + 22;
  if (inQueueTrigger || inQueuePanel) setPeek(pp, true, 'pl');
  else if (shouldClosePlaylistPanelFromPointer(ppOn, ex, ppRect)) setPeek(pp, false, 'pl');

  // v8: 镜头跟拍触发判断
  //   - 队列面板 peek 时 → queue focus
  //   - 3D shelf side 模式只在点击展开后 → shelf-side
  //   - 3D shelf stage 模式 + 鼠标在下 35% → shelf-stage
  var shelfCanFocus = !!(shelfManager && shelfManager.canInteract && shelfManager.canInteract());
  if (!shelfCanFocus && !(shelfManager && shelfManager.hasOpenContent && shelfManager.hasOpenContent())) {
    shelfPinnedOpen = false;
  }

  var newFocus = null;
  var queueFocusActive = isPlaylistPanelFocusActive(inQueueTrigger, inQueuePanel, pp, ex, ppRect);
  var shelfHoverFocus = !!(shelfCanFocus && isSideShelfFocusHit(e));
  if (queueFocusActive) {
    newFocus = 'queue';
  } else if (shelfManager && shelfManager.hasOpenContent && shelfManager.hasOpenContent()) {
    newFocus = 'shelf-detail';
  } else if (shelfHoverFocus) {
    newFocus = 'shelf-side';
  } else if (shelfCanFocus && shelfManager.getMode() === 'stage' && ey > H * 0.55) {
    newFocus = 'shelf-stage';
  }
  setFocusZone(newFocus, newFocus === 'queue');
});

// ============================================================
//  启动页 (splash) 控制
// ============================================================

document.body.classList.add('splash-active');
var splashAnimating = true;
var splashCanvas = null, splashCtx = null;
var splashGl = null, splashGlProgram = null, splashGlBuffer = null, splashGlUniforms = null;
var splashW = 0, splashH = 0;
var splashDust = [];
var splashStreaks = [];
var splashShards = [];
var splashPixelRatio = 1;
var splashStartedAt = performance.now();
var splashSoundPlayed = false;
var splashAudioCtx = null;
var splashSoundFallbackArmed = false;
var splashTimer = null;
var reduceSplashMotion = false;
var splashReadyToEnter = false;

function splashClamp01(v) { return Math.max(0, Math.min(1, v)); }
function splashSmoothstep(edge0, edge1, x) {
  var t = splashClamp01((x - edge0) / Math.max(0.0001, edge1 - edge0));
  return t * t * (3 - 2 * t);
}
function splashEaseOutCubic(t) {
  t = splashClamp01(t);
  return 1 - Math.pow(1 - t, 3);
}

function initBhandsMusicSplashWebgl(canvas) {
  var gl = null;
  try {
    gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance'
    }) || canvas.getContext('experimental-webgl');
  } catch (e) {
    gl = null;
  }
  if (!gl) return false;

  var vertexSource = [
    'attribute vec2 aPosition;',
    'varying vec2 vUv;',
    'void main(){',
    '  vUv = aPosition * 0.5 + 0.5;',
    '  gl_Position = vec4(aPosition, 0.0, 1.0);',
    '}'
  ].join('\n');

  var fragmentSource = [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform vec2 uResolution;',
    'uniform float uTime;',
    '',
    'float saturate(float v){ return clamp(v, 0.0, 1.0); }',
    'float ease(float v){ v = saturate(v); return v * v * (3.0 - 2.0 * v); }',
    'mat2 rot(float a){ float c = cos(a); float s = sin(a); return mat2(c, -s, s, c); }',
    'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }',
    'float noise(vec2 p){',
    '  vec2 i = floor(p);',
    '  vec2 f = fract(p);',
    '  vec2 u = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(hash(i), hash(i + vec2(1.0,0.0)), u.x), mix(hash(i + vec2(0.0,1.0)), hash(i + vec2(1.0,1.0)), u.x), u.y);',
    '}',
    '',
    'float animatedLoop(vec2 uv, float t, float channel){',
    '  vec2 q = uv;',
    '  q *= rot(0.28 + sin(t * 0.18) * 0.12);',
    '  q.x += 0.055 * sin(t * 0.30 + channel);',
    '  q.y += 0.040 * cos(t * 0.24 + channel * 1.7);',
    '  float ang = atan(q.y, q.x);',
    '  float angularShift = sin(ang * 3.0 + t * 0.72 + channel * 1.9) * 0.078;',
    '  angularShift += sin(ang * 7.0 - t * 0.54 + channel) * 0.020;',
    '  float neonD = length(q) + angularShift;',
    '  float warpD = length(q * vec2(1.34 + 0.06 * sin(t * 0.25), 0.82 + 0.04 * cos(t * 0.31)));',
    '  warpD += 0.026 * sin(q.x * 4.4 + t * 0.62) + 0.018 * sin(q.y * 5.2 - t * 0.45);',
    '  float diamondD = abs(q.x) * 1.20 + abs(q.y) * 0.84;',
    '  float d = mix(warpD, diamondD, 0.32);',
    '  d = mix(d, neonD, 0.20 + 0.04 * sin(t * 0.18 + channel));',
    '  float pattern = mod((q.x + q.y) * 0.62 + sin(q.x * 5.5 + t) * 0.015 + sin(q.y * 7.0 - t * 0.75) * 0.012, 0.20);',
    '  float acc = 0.0;',
    '  for (int i = 1; i <= 6; i++) {',
    '    float fi = float(i);',
    '    float f = fract(t * 0.152 - channel * 0.018 + 0.011 * fi) * 4.70 - d + pattern;',
    '    acc += 0.00110 * fi * fi / max(abs(f), 0.0065);',
    '  }',
    '  float threadCoord = q.x * 0.92 - q.y * 0.58 + 0.030 * sin(q.x * 5.2 + t * 0.72);',
    '  float threadLines = 0.0065 / max(abs(sin((threadCoord + t * 0.10 + channel * 0.035) * 27.0)), 0.070);',
    '  acc += threadLines * (0.50 + 0.30 * sin(ang * 1.2 + t + channel));',
    '  return min(acc, 1.95);',
    '}',
    '',
    'void main(){',
    '  vec2 p = vUv * 2.0 - 1.0;',
    '  p.x *= uResolution.x / max(uResolution.y, 1.0);',
    '  float t = uTime;',
    '  float intro = ease(t / 0.72);',
    '  float bloomIn = ease((t - 0.10) / 1.10);',
    '  float climax = exp(-pow((t - 3.62) / 0.58, 2.0));',
    '  float preClimax = ease((t - 2.15) / 1.25) * (1.0 - ease((t - 3.86) / 0.72));',
    '  float afterglow = exp(-pow((t - 4.14) / 0.62, 2.0));',
    '  float calm = 1.0 - 0.22 * ease((t - 4.75) / 0.70);',
    '  float settle = 1.0 - 0.34 * ease((t - 5.05) / 0.52);',
    '  vec2 uv = p * (0.98 + 0.05 * sin(t * 0.25));',
    '  uv += vec2(0.0, -0.025);',
    '  vec2 flowAxis = normalize(vec2(0.86, -0.50));',
    '  vec2 crossAxis = vec2(-flowAxis.y, flowAxis.x);',
    '  float lane = dot(p, flowAxis);',
    '  float crossLane = dot(p, crossAxis);',
    '  float syncWave = sin(crossLane * 5.4 + lane * 1.1 - t * 1.85);',
    '  uv += flowAxis * syncWave * 0.055 * climax;',
    '  uv += crossAxis * sin(lane * 7.2 + t * 1.25) * 0.034 * climax;',
    '  uv *= 1.0 + 0.045 * preClimax - 0.020 * climax;',
    '  vec3 ch1 = vec3(1.00, 0.13, 0.31);',
    '  vec3 ch2 = vec3(0.16, 1.00, 0.86);',
    '  vec3 ch3 = vec3(1.00, 0.76, 0.28);',
    '  float a = animatedLoop(uv, t, 0.0);',
    '  float b = animatedLoop(uv * 1.018 + vec2(0.012, -0.008), t + 0.18, 1.0);',
    '  float c = animatedLoop(uv * 0.986 + vec2(-0.010, 0.010), t + 0.35, 2.0);',
    '  vec3 loopCol = ch1 * a + ch2 * b + ch3 * c;',
    '  float tunnel = animatedLoop(uv * 1.42 + vec2(sin(t * 0.2) * 0.08, cos(t * 0.17) * 0.05), t * 1.12 + 1.7, 2.7);',
    '  loopCol += mix(ch2, ch3, 0.35 + 0.25 * sin(t)) * tunnel * (0.30 + 0.24 * preClimax);',
    '  float syncBand = exp(-pow((lane + 0.08 * sin(t * 0.72)) / 0.62, 2.0));',
    '  float phaseThread = pow(0.5 + 0.5 * sin(crossLane * 13.5 + lane * 2.2 - t * 3.1), 8.0);',
    '  float phaseThread2 = pow(0.5 + 0.5 * sin(crossLane * 9.0 - lane * 5.4 + t * 2.4), 10.0);',
    '  vec3 climaxCol = (mix(ch2, ch3, 0.36) * phaseThread + ch1 * phaseThread2 * 0.52) * syncBand * climax;',
    '  float afterBand = exp(-pow((lane - 0.34) / 0.72, 2.0));',
    '  climaxCol += mix(ch1, ch2, vUv.x) * afterBand * afterglow * 0.13;',
    '  float centerBeam = exp(-abs(p.y + 0.005 * sin(t * 3.0)) * 24.0) * (0.14 + 0.52 * exp(-pow((t - 0.74) / 0.34, 2.0)));',
    '  float bladeMask = smoothstep(-1.55, -0.08, p.x) * (1.0 - smoothstep(0.08, 1.55, p.x));',
    '  vec3 blade = mix(ch1, ch2, vUv.x) * centerBeam * bladeMask * (0.40 + 0.28 * climax);',
    '  float flare = exp(-dot(p, p) * 3.6) * exp(-pow((t - 0.88) / 0.40, 2.0));',
    '  vec3 col = vec3(0.002, 0.004, 0.005);',
    '  col += loopCol * (0.56 + 0.46 * bloomIn) * calm * settle;',
    '  col += climaxCol * 0.22;',
    '  float diagonalGlint = exp(-pow(lane * 1.2 + crossLane * 0.10, 2.0) / 0.030) * climax;',
    '  col += blade + vec3(1.0, 0.78, 0.42) * flare * 0.18 + vec3(1.0, 0.86, 0.58) * diagonalGlint * 0.07;',
    '  float scan = 0.92 + 0.08 * sin((vUv.y * uResolution.y + t * 52.0) * 0.72);',
    '  float grain = noise(vUv * uResolution.xy * 0.52 + t * 17.0) - 0.5;',
    '  col *= scan;',
    '  col += grain * 0.018;',
    '  col *= intro;',
    '  col = max(col - vec3(0.010, 0.012, 0.012), 0.0);',
    '  col = vec3(1.0) - exp(-max(col, 0.0) * (0.62 + 0.18 * climax));',
    '  float vignette = smoothstep(1.52, 0.20, length(p * vec2(0.78, 1.04)));',
    '  col *= 0.38 + 0.86 * vignette;',
    '  col += vec3(0.020, 0.010, 0.014) * (1.0 - vignette);',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  function compile(type, source) {
    var shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn('Splash shader compile failed:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  var vertexShader = compile(gl.VERTEX_SHADER, vertexSource);
  var fragmentShader = compile(gl.FRAGMENT_SHADER, fragmentSource);
  if (!vertexShader || !fragmentShader) return false;

  var program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('Splash shader link failed:', gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return false;
  }

  splashGl = gl;
  splashGlProgram = program;
  splashGlBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, splashGlBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  splashGlUniforms = {
    position: gl.getAttribLocation(program, 'aPosition'),
    resolution: gl.getUniformLocation(program, 'uResolution'),
    time: gl.getUniformLocation(program, 'uTime')
  };
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  return true;
}

function drawBhandsMusicSplashWebgl(elapsed) {
  var gl = splashGl;
  if (!gl || !splashGlProgram || !splashGlUniforms) return;
  gl.viewport(0, 0, splashCanvas.width, splashCanvas.height);
  gl.useProgram(splashGlProgram);
  gl.bindBuffer(gl.ARRAY_BUFFER, splashGlBuffer);
  gl.enableVertexAttribArray(splashGlUniforms.position);
  gl.vertexAttribPointer(splashGlUniforms.position, 2, gl.FLOAT, false, 0, 0);
  gl.uniform2f(splashGlUniforms.resolution, splashCanvas.width, splashCanvas.height);
  gl.uniform1f(splashGlUniforms.time, elapsed);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

(function initBhandsMusicSplashCanvas() {
  splashCanvas = document.getElementById('splash-canvas');
  if (!splashCanvas) return;
  if (!reduceSplashMotion && initBhandsMusicSplashWebgl(splashCanvas)) {
    splashCtx = null;
  } else {
    splashCtx = splashCanvas.getContext('2d');
  }
  function resize() {
    // DPR 上限按渲染路径区分（对齐 Web 版 SplashCanvas）：
    //   WebGL 路径 1.25 —— 全屏 shader 像素量比 1.6 少约 39%，启动页动画明显更丝滑；
    //   2D 回退路径 1.6 —— CPU 绘制时高 DPR 影响较小，保持清晰度。
    var splashDpr = Math.max(1, window.devicePixelRatio || 1);
    splashPixelRatio = splashGl ? Math.min(1.25, splashDpr) : Math.min(1.6, splashDpr);
    splashW = window.innerWidth;
    splashH = window.innerHeight;
    splashCanvas.width = Math.max(1, Math.floor(splashW * splashPixelRatio));
    splashCanvas.height = Math.max(1, Math.floor(splashH * splashPixelRatio));
    if (splashCtx) splashCtx.setTransform(splashPixelRatio, 0, 0, splashPixelRatio, 0, 0);
    if (splashGl) splashGl.viewport(0, 0, splashCanvas.width, splashCanvas.height);
    splashDust = [];
    splashStreaks = [];
    splashShards = [];
    var count = reduceSplashMotion ? 28 : 84;
    for (var i = 0; i < count; i++) {
      splashDust.push({
        x: Math.random() * splashW,
        y: Math.random() * splashH,
        vx: (Math.random() - 0.5) * 0.18,
        vy: (Math.random() - 0.5) * 0.11,
        r: Math.random() * 1.35 + 0.28,
        a: Math.random() * 0.105 + 0.025,
        p: Math.random() * Math.PI * 2
      });
    }
    var streakColors = [
      'rgba(244,210,138,',
      'rgba(122,215,194,',
      'rgba(255,83,103,',
      'rgba(157,184,207,'
    ];
    var streakCount = reduceSplashMotion ? 6 : 22;
    for (var s = 0; s < streakCount; s++) {
      splashStreaks.push({
        x: Math.random() * splashW,
        y: splashH * (0.20 + Math.random() * 0.62),
        len: splashW * (0.12 + Math.random() * 0.24),
        width: 0.75 + Math.random() * 2.1,
        speed: splashW * (0.00028 + Math.random() * 0.00042),
        angle: (-10 + Math.random() * 20) * Math.PI / 180,
        phase: Math.random() * Math.PI * 2,
        color: streakColors[s % streakColors.length],
        delay: Math.random() * 1.1,
        alpha: 0.18 + Math.random() * 0.36
      });
    }
    var shardCount = reduceSplashMotion ? 10 : 34;
    for (var h = 0; h < shardCount; h++) {
      splashShards.push({
        ox: (Math.random() - 0.5) * splashW * 0.92,
        oy: (Math.random() - 0.5) * splashH * 0.22,
        w: 18 + Math.random() * 86,
        h: 1 + Math.random() * 5,
        skew: (Math.random() - 0.5) * 20,
        phase: Math.random() * Math.PI * 2,
        color: streakColors[h % streakColors.length],
        alpha: 0.10 + Math.random() * 0.24
      });
    }
  }
  resize();
  window.addEventListener('resize', resize);
  drawBhandsMusicSplash();
})();

function drawBhandsMusicSplash() {
  if (!splashAnimating || (!splashCtx && !splashGl)) return;
  requestAnimationFrame(drawBhandsMusicSplash);
  var elapsed = (performance.now() - splashStartedAt) / 1000;
  if (splashGl && splashGlProgram) {
    drawBhandsMusicSplashWebgl(elapsed);
    return;
  }
  splashCtx.clearRect(0, 0, splashW, splashH);

  var base = splashCtx.createLinearGradient(0, 0, splashW, splashH);
  base.addColorStop(0, 'rgba(1,6,7,0.68)');
  base.addColorStop(0.45, 'rgba(10,9,12,0.74)');
  base.addColorStop(1, 'rgba(0,0,0,0.84)');
  splashCtx.fillStyle = base;
  splashCtx.fillRect(0, 0, splashW, splashH);

  splashCtx.save();
  splashCtx.globalAlpha = 0.22;
  splashCtx.fillStyle = 'rgba(255,255,255,0.035)';
  var scanOffset = (elapsed * 28) % 36;
  for (var sy = -scanOffset; sy < splashH; sy += 36) splashCtx.fillRect(0, sy, splashW, 1);
  splashCtx.restore();

  for (var i = 0; i < splashDust.length; i++) {
    var d = splashDust[i];
    d.x += d.vx;
    d.y += d.vy;
    d.p += 0.018;
    if (d.x < -10) d.x = splashW + 10;
    if (d.x > splashW + 10) d.x = -10;
    if (d.y < -10) d.y = splashH + 10;
    if (d.y > splashH + 10) d.y = -10;
    var alpha = d.a * (0.58 + Math.sin(d.p + elapsed * 0.8) * 0.34);
    splashCtx.beginPath();
    splashCtx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
    splashCtx.fillStyle = 'rgba(255,255,255,' + Math.max(0, alpha) + ')';
    splashCtx.fill();
  }

  splashCtx.save();
  splashCtx.globalCompositeOperation = 'lighter';
  for (var k = 0; k < splashStreaks.length; k++) {
    var st = splashStreaks[k];
    var travel = (elapsed * st.speed * 240 + st.x + Math.sin(elapsed * 0.8 + st.phase) * 28) % (splashW + st.len + 180);
    var px = travel - st.len - 90;
    var py = st.y + Math.sin(elapsed * 0.75 + st.phase) * 18;
    var fade = splashSmoothstep(st.delay * 0.55, st.delay * 0.55 + 0.52, elapsed) * (1 - splashSmoothstep(3.52, 4.12, elapsed));
    if (fade <= 0) continue;
    splashCtx.save();
    splashCtx.translate(px, py);
    splashCtx.rotate(st.angle);
    var sg = splashCtx.createLinearGradient(-st.len * 0.5, 0, st.len * 0.5, 0);
    sg.addColorStop(0, st.color + '0)');
    sg.addColorStop(0.52, st.color + (st.alpha * fade).toFixed(3) + ')');
    sg.addColorStop(1, 'rgba(255,255,255,0)');
    splashCtx.strokeStyle = sg;
    splashCtx.lineWidth = st.width;
    splashCtx.shadowColor = st.color + (0.34 * fade).toFixed(3) + ')';
    splashCtx.shadowBlur = 18;
    splashCtx.beginPath();
    splashCtx.moveTo(-st.len * 0.5, 0);
    splashCtx.lineTo(st.len * 0.5, 0);
    splashCtx.stroke();
    splashCtx.restore();
  }

  var lineT = splashEaseOutCubic((elapsed - 0.12) / 1.18);
  var exitFade = 1 - splashSmoothstep(3.58, 4.12, elapsed);
  if (lineT > 0 && exitFade > 0) {
    var centerY = splashH * 0.5 + Math.sin(elapsed * 1.4) * 1.6;
    var slitW = splashW * (0.16 + lineT * 0.72);
    var left = splashW * 0.5 - slitW * 0.5;
    var right = splashW * 0.5 + slitW * 0.5;
    var coreAlpha = (0.34 + lineT * 0.58) * exitFade;
    var slitGrad = splashCtx.createLinearGradient(left, centerY, right, centerY);
    slitGrad.addColorStop(0, 'rgba(255,83,103,0)');
    slitGrad.addColorStop(0.18, 'rgba(255,83,103,' + (0.18 * exitFade).toFixed(3) + ')');
    slitGrad.addColorStop(0.50, 'rgba(255,255,255,' + coreAlpha.toFixed(3) + ')');
    slitGrad.addColorStop(0.68, 'rgba(244,210,138,' + (0.38 * exitFade).toFixed(3) + ')');
    slitGrad.addColorStop(0.84, 'rgba(122,215,194,' + (0.20 * exitFade).toFixed(3) + ')');
    slitGrad.addColorStop(1, 'rgba(122,215,194,0)');
    splashCtx.shadowColor = 'rgba(244,210,138,' + (0.48 * exitFade).toFixed(3) + ')';
    splashCtx.shadowBlur = 42 + lineT * 42;
    splashCtx.lineCap = 'round';
    splashCtx.strokeStyle = slitGrad;
    splashCtx.lineWidth = 1.4 + lineT * 2.2;
    splashCtx.beginPath();
    splashCtx.moveTo(left, centerY);
    splashCtx.lineTo(right, centerY);
    splashCtx.stroke();

    var ignition = Math.exp(-Math.pow((elapsed - 0.72) / 0.26, 2));
    if (ignition > 0.018) {
      var ig = splashCtx.createLinearGradient(0, centerY, splashW, centerY);
      ig.addColorStop(0, 'rgba(122,215,194,0)');
      ig.addColorStop(0.46, 'rgba(122,215,194,' + (0.07 * ignition).toFixed(3) + ')');
      ig.addColorStop(0.50, 'rgba(255,255,255,' + (0.16 * ignition).toFixed(3) + ')');
      ig.addColorStop(0.54, 'rgba(255,83,103,' + (0.08 * ignition).toFixed(3) + ')');
      ig.addColorStop(1, 'rgba(244,210,138,0)');
      splashCtx.fillStyle = ig;
      splashCtx.fillRect(0, centerY - 48 * ignition, splashW, 96 * ignition);
    }

    var waveAlpha = splashSmoothstep(0.72, 1.95, elapsed) * exitFade;
    if (waveAlpha > 0) {
      splashCtx.shadowBlur = 20;
      splashCtx.strokeStyle = 'rgba(244,210,138,' + (0.22 * waveAlpha).toFixed(3) + ')';
      splashCtx.lineWidth = 1;
      splashCtx.beginPath();
      var steps = 82;
      for (var wi = 0; wi <= steps; wi++) {
        var u = wi / steps;
        var x = left + slitW * u;
        var edge = 1 - Math.abs(u - 0.5) * 2;
        var amp = (4 + 18 * lineT) * Math.pow(Math.max(0, edge), 1.4) * waveAlpha;
        var y = centerY + Math.sin(u * 34 + elapsed * 8.2) * amp + Math.sin(u * 87 - elapsed * 5.1) * amp * 0.18;
        if (wi === 0) splashCtx.moveTo(x, y);
        else splashCtx.lineTo(x, y);
      }
      splashCtx.stroke();
    }

    var shardT = splashSmoothstep(0.72, 2.45, elapsed) * exitFade;
    for (var si = 0; si < splashShards.length; si++) {
      var sh = splashShards[si];
      var drift = Math.sin(elapsed * 1.7 + sh.phase) * 22;
      var sx = splashW * 0.5 + sh.ox * (0.18 + shardT * 0.82) + drift;
      var sy2 = centerY + sh.oy * (0.20 + shardT * 0.92);
      var localAlpha = sh.alpha * shardT * (0.62 + Math.sin(elapsed * 5 + sh.phase) * 0.38);
      if (localAlpha <= 0) continue;
      splashCtx.save();
      splashCtx.translate(sx, sy2);
      splashCtx.rotate((-6 + sh.skew * 0.10) * Math.PI / 180);
      splashCtx.fillStyle = sh.color + Math.max(0, localAlpha).toFixed(3) + ')';
      splashCtx.shadowColor = sh.color + Math.min(0.38, localAlpha * 1.2).toFixed(3) + ')';
      splashCtx.shadowBlur = 14;
      splashCtx.beginPath();
      splashCtx.moveTo(-sh.w * 0.5, -sh.h * 0.5);
      splashCtx.lineTo(sh.w * 0.5, -sh.h * 0.5);
      splashCtx.lineTo(sh.w * 0.5 + sh.skew, sh.h * 0.5);
      splashCtx.lineTo(-sh.w * 0.5 + sh.skew, sh.h * 0.5);
      splashCtx.closePath();
      splashCtx.fill();
      splashCtx.restore();
    }

    var flash = Math.exp(-Math.pow((elapsed - 2.52) / 0.38, 2));
    if (flash > 0.015) {
      var fg = splashCtx.createLinearGradient(0, centerY, splashW, centerY);
      fg.addColorStop(0, 'rgba(255,83,103,0)');
      fg.addColorStop(0.48, 'rgba(255,255,255,' + (0.20 * flash).toFixed(3) + ')');
      fg.addColorStop(0.52, 'rgba(244,210,138,' + (0.24 * flash).toFixed(3) + ')');
      fg.addColorStop(1, 'rgba(122,215,194,0)');
      splashCtx.fillStyle = fg;
      splashCtx.fillRect(0, centerY - 46 * flash, splashW, 92 * flash);
    }
  }
  splashCtx.restore();
}

function playBhandsMusicIntroSound() {
  if (splashSoundPlayed) return;
  try {
    var AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return;
    var ctx = splashAudioCtx || new AudioContextCtor();
    splashAudioCtx = ctx;
    if (ctx.state === 'suspended' && ctx.resume) {
      ctx.resume().then(function(){
        if (!splashSoundPlayed) playBhandsMusicIntroSound();
      }).catch(function(){});
      if (ctx.state === 'suspended') return;
    }
    splashSoundPlayed = true;

    var now = ctx.currentTime + 0.02;
    var master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.062, now + 0.16);
    master.gain.exponentialRampToValueAtTime(0.040, now + 3.35);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 5.28);
    master.connect(ctx.destination);

    var noiseBuffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2.45), ctx.sampleRate);
    var data = noiseBuffer.getChannelData(0);
    for (var i = 0; i < data.length; i++) {
      var tail = 1 - i / data.length;
      data[i] = (Math.random() * 2 - 1) * Math.pow(tail, 1.35);
    }
    var noise = ctx.createBufferSource();
    var noiseGain = ctx.createGain();
    var noiseFilter = ctx.createBiquadFilter();
    noise.buffer = noiseBuffer;
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.setValueAtTime(720, now);
    noiseFilter.frequency.exponentialRampToValueAtTime(2400, now + 2.2);
    noiseFilter.Q.setValueAtTime(0.72, now);
    noiseGain.gain.setValueAtTime(0.0001, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.020, now + 0.12);
    noiseGain.gain.exponentialRampToValueAtTime(0.010, now + 1.60);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 2.42);
    noise.connect(noiseFilter); noiseFilter.connect(noiseGain); noiseGain.connect(master);
    noise.start(now); noise.stop(now + 2.46);

    var low = ctx.createOscillator();
    var lowGain = ctx.createGain();
    low.type = 'sine';
    low.frequency.setValueAtTime(86, now + 0.18);
    low.frequency.exponentialRampToValueAtTime(43, now + 1.18);
    lowGain.gain.setValueAtTime(0.0001, now + 0.12);
    lowGain.gain.exponentialRampToValueAtTime(0.032, now + 0.30);
    lowGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.34);
    low.connect(lowGain); lowGain.connect(master);
    low.start(now + 0.12); low.stop(now + 1.40);

    function softTone(type, f0, f1, startAt, dur, peak) {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      var filter = ctx.createBiquadFilter();
      osc.type = type;
      osc.frequency.setValueAtTime(f0, now + startAt);
      osc.frequency.exponentialRampToValueAtTime(f1, now + startAt + dur * 0.72);
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(3400, now + startAt);
      gain.gain.setValueAtTime(0.0001, now + startAt);
      gain.gain.exponentialRampToValueAtTime(peak, now + startAt + 0.08);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + startAt + dur);
      osc.connect(filter); filter.connect(gain); gain.connect(master);
      osc.start(now + startAt);
      osc.stop(now + startAt + dur + 0.04);
    }
    softTone('triangle', 440, 660, 1.05, 0.72, 0.018);
    softTone('sine', 880, 1320, 2.10, 0.86, 0.013);
    softTone('triangle', 1180, 1760, 2.72, 0.52, 0.010);
    softTone('triangle', 660, 1180, 3.32, 0.82, 0.014);
    softTone('sine', 1760, 1040, 3.64, 0.46, 0.010);
  } catch (e) {}
}
function armSplashSoundFallback() {
  if (splashSoundFallbackArmed) return;
  splashSoundFallbackArmed = true;
  function unlock() {
    if (!splashSoundPlayed) playBhandsMusicIntroSound();
    document.removeEventListener('pointerdown', unlock, true);
    document.removeEventListener('keydown', unlock, true);
  }
  document.addEventListener('pointerdown', unlock, true);
  document.addEventListener('keydown', unlock, true);
}

/**
 * 关闭启动页。
 * @param {{instant?: boolean}} [opts] instant=true 时不播退场动画、立刻进主页（秒启动用，对齐上游 dismissSplash({instant:true})）
 */
// 启动预解析延迟到 splash 动画结束后执行：
// 原实现在启动 900ms 后触发，与 5.2s 的品牌字动画重叠——预解析的网络请求 + 音频探测
// 抢占主线程，导致启动页动画掉帧（用户反馈“不够丝滑”，Web 版无此桌面版特性）。
var startupPreparseDone = false;
function runStartupPreparse() {
  if (startupPreparseDone) return;
  startupPreparseDone = true;
  try { preparseRestoredSongSource(); } catch (e) { console.warn('[StartupPreparse] 触发失败:', e && e.message); }
}
function requestStartupPreparseAfterSplash() {
  if (startupPreparseDone) return;
  // 兜底：9s 后无论如何执行（splash 长时间未被点击进入等极端情况）
  setTimeout(runStartupPreparse, 9000);
}
function dismissSplash(opts) {
  var instant = !!(opts && opts.instant);
  var s = document.getElementById('splash');
  if (!s || s.classList.contains('hide') || s.classList.contains('exiting')) return;
  markAppPerf('splash-dismiss');
  if (splashTimer) { clearTimeout(splashTimer); splashTimer = null; }
  splashReadyToEnter = false;
  s.classList.remove('ready');
  if (typeof shouldUseIdleWallpaperPreview === 'function'
    ? shouldUseIdleWallpaperPreview(true)
    : (typeof shouldShowEmptyHomeAfterSplash === 'function' && shouldShowEmptyHomeAfterSplash())) {
    activateHomeWallpaperPreview();
  }
  revealIdleParticles(0, instant ? 0 : (reduceSplashMotion ? 700 : 2400));
  document.body.classList.add('splash-revealing');
  s.classList.add('exiting');

  var content = s.querySelector('.splash-content');
  if (content) {
    content.style.opacity = '0';
    if (!instant) {
      content.style.transition = 'opacity 680ms cubic-bezier(.22,1,.36,1), transform 980ms cubic-bezier(.22,1,.36,1)';
      content.style.transform = 'translateY(-14px) scale(.986)';
    }
  }

  var finishReveal = function() {
    s.classList.add('hide');
    splashAnimating = false;
    document.body.classList.remove('splash-active');
    document.body.classList.remove('splash-revealing');
    flushStartupAutoplayAfterSplash();  // 启动自动播放：splash 结束即发起（恢复态已在 restore 时排队）
    setTimeout(runStartupPreparse, 700);  // 启动页动画结束后再预解析（保证动画期间主线程空闲）
    markAppPerf('home-revealed');
    if (s && s.parentNode) s.style.display = 'none';
    requestAnimationFrame(function(){
      var homeShown = updateEmptyHomeVisibility({ forceLoad: true });
      if (!homeShown && shouldForceEmptyHomeAfterSplash()) {
        homeSuppressed = false;
        homeForcedOpen = true;
        homeShown = updateEmptyHomeVisibility({ forceLoad: true });
      }
      requestAnimationFrame(function(){
        var guideStarted = maybeRunStartupVisualGuide('splash');
        if (!guideStarted && !hasAnyPlatformLogin()) maybeRunStartupLoginGuide('splash');
        else if (!guideStarted && !homeShown) maybeRunStartupLoginGuide('splash');
        setTimeout(maybeShowUploadTipOnce, 5200);
      });
    });
  };

  if (instant) finishReveal(); else setTimeout(finishReveal, 1180);
}

function markSplashReadyToEnter() {
  var s = document.getElementById('splash');
  if (!s || s.classList.contains('hide') || s.classList.contains('exiting')) return;
  markAppPerf('splash-ready');
  splashReadyToEnter = true;
  splashTimer = null;
  s.classList.add('ready');
  s.setAttribute('role', 'button');
  s.setAttribute('tabindex', '0');
  s.setAttribute('aria-label', '点击进入 BhandsMusic');
}

document.addEventListener('DOMContentLoaded', function(){
  var s = document.getElementById('splash');
  if (!s) return;
  markAppPerf('dom-content-loaded');
  // 秒启动跳过启动页（移植自上游 10-shell/03-splash.js）：直接进主页，不等待启动动画
  if (startupFastSkipPreference) {
    dismissSplash({ instant: true });
    return;
  }
  armSplashSoundFallback();
  prewarmHomeWallpaperPreview();
  function requestSplashEnter() {
    playBhandsMusicIntroSound();
    if (splashReadyToEnter) dismissSplash();
  }
  s.addEventListener('click', requestSplashEnter);
  document.addEventListener('keydown', function(e){
    if (!document.body.classList.contains('splash-active')) return;
    if (e.key === 'Enter' || e.code === 'Space') {
      e.preventDefault();
      requestSplashEnter();
    }
  });
  if (reduceSplashMotion) {
    s.classList.add('reduce-motion');
    splashTimer = setTimeout(markSplashReadyToEnter, 900);
    return;
  }
  playBhandsMusicIntroSound();
  splashTimer = setTimeout(markSplashReadyToEnter, 5000);
});

var desktopOverlayPushState = {
  lyricsAt: 0,
  wallpaperAt: 0,
  lastLyricsKey: '',
  lastLyricsBeatKey: '',
  lastWallpaperKey: ''
};
function getDesktopWindowApi() {
  return window.desktopWindow && window.desktopWindow.isDesktop ? window.desktopWindow : null;
}
function currentDesktopSongMeta() {
  var song = playQueue && currentIdx >= 0 ? playQueue[currentIdx] : null;
  song = song || currentLyricSong && currentLyricSong() || {};
  return {
    title: song.name || song.title || 'BhandsMusic',
    artist: song.artist || song.ar || song.author || '',
    cover: (typeof songCoverSrc === 'function' && song) ? (songCoverSrc(song, 360) || song.cover || '') : (song.cover || '')
  };
}
function normalizeDesktopLyricText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}
function currentDesktopLyricSnapshot() {
  var t = audio && isFinite(audio.currentTime) ? Number(audio.currentTime) : 0;
  var lines = Array.isArray(lyricsLines) ? lyricsLines : [];
  if (playing && audio && lines.length) {
    var idx = -1;
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].t <= t + 0.05) idx = i;
      else break;
    }
    if (idx >= 0) {
      var curLine = lines[idx] || { t:t, text:'' };
      var nextLine = lines[idx + 1];
      var nextT = nextLine && nextLine.t > curLine.t ? nextLine.t : Math.min((audio && audio.duration) || t + 4, curLine.t + (curLine.duration || 4.8));
      var span = Math.max(0.75, nextT - curLine.t);
      return {
        text: normalizeDesktopLyricText(curLine.text || currentLyricFallbackText()),
        progress: getLyricLineProgress(curLine, nextLine, t),
        progressSpan: span
      };
    }
    var introText = normalizeDesktopLyricText(currentLyricFallbackText());
    if (introText) {
      var firstLine = lines[0];
      var introEnd = firstLine && firstLine.t > 0 ? firstLine.t : Math.min((audio && audio.duration) || 4.8, 4.8);
      return {
        text: introText,
        progress: getLyricLineProgress({ t:0, text:introText, duration:Math.max(0.8, introEnd), charCount:Math.max(1, introText.length), fallback:true }, null, t),
        progressSpan: Math.max(0.8, introEnd)
      };
    }
  }
  if (stageLyrics && stageLyrics.currentText) {
    return {
      text: normalizeDesktopLyricText(stageLyrics.currentText),
      progress: stageLyrics.current && stageLyrics.current.userData ? clampRange(Number(stageLyrics.current.userData.lastLyricProgress) || 0, 0, 1) : 0,
      progressSpan: 4.8
    };
  }
  return { text: normalizeDesktopLyricText(currentDesktopSongMeta().title || 'BhandsMusic'), progress: 0, progressSpan: 4.8 };
}
function desktopOverlayColorValue(value, fallback) {
  var raw = String(value || '').trim();
  fallback = String(fallback || '#d6f8ff').trim();
  if (/^#[0-9a-f]{3}$/i.test(raw) || /^#[0-9a-f]{6}$/i.test(raw)) return normalizeHexColor(raw, fallback);
  if (/^rgba?\(/i.test(raw) || /^hsla?\(/i.test(raw)) return raw;
  return normalizeHexColor(raw, fallback);
}
function desktopOverlayColors() {
  var pal = stageLyrics && stageLyrics.palette || {};
  return {
    primary: desktopOverlayColorValue(pal.primary || fx.lyricColor || '#d6f8ff', '#d6f8ff'),
    secondary: desktopOverlayColorValue(pal.secondary || fx.visualTintColor || '#9cffdf', '#9cffdf'),
    highlight: desktopOverlayColorValue(pal.highlight || fx.lyricHighlightColor || '#fff0b8', '#fff0b8'),
    glow: desktopOverlayColorValue(pal.glowColor || pal.secondary || pal.primary || fx.lyricGlowColor || '#9cffdf', '#9cffdf')
  };
}
function desktopLyricsMotionPayload() {
  return {
    lyricGlow: !!fx.lyricGlow,
    lyricGlowBeat: !!fx.lyricGlowBeat,
    lyricGlowStrength: fx.lyricGlow ? clampRange(Number(fx.lyricGlowStrength) || 0, 0, 0.85) : 0,
    highBloom: stageLyrics && isFinite(stageLyrics.highBloom) ? clampRange(stageLyrics.highBloom, 0, 1.45) : 0,
    beatGlow: stageLyrics && isFinite(stageLyrics.beatGlow) ? clampRange(stageLyrics.beatGlow, 0, 1.7) : 0,
    beatPulse: isFinite(beatPulse) ? clampRange(beatPulse, 0, 1.4) : 0,
    bass: isFinite(bass) ? clampRange(bass, 0, 1.2) : 0
  };
}
function desktopLyricsPlaybackPayload() {
  var time = audio && isFinite(audio.currentTime) ? Number(audio.currentTime) : 0;
  var duration = audio && isFinite(audio.duration) ? Number(audio.duration) : 0;
  var rate = audio && isFinite(audio.playbackRate) && audio.playbackRate > 0 ? Number(audio.playbackRate) : 1;
  return {
    time: Math.max(0, time),
    duration: Math.max(0, duration),
    rate: clampRange(rate, 0.25, 4)
  };
}
function desktopLyricsActiveBeatMap() {
  var useDj = !!(djMode && djMode.active && currentDjBeatMap);
  return {
    source: useDj ? 'dj' : 'mr',
    map: useDj ? currentDjBeatMap : currentBeatMap
  };
}
function desktopLyricsBeatMapPayload(force) {
  var selected = desktopLyricsActiveBeatMap();
  var map = selected && selected.map;
  var source = selected && selected.source || 'mr';
  var cameraCount = map ? ((map.cameraBeats && map.cameraBeats.length) || (map.beats && map.beats.length) || (map.kicks && map.kicks.length) || 0) : 0;
  var pulseCount = map ? ((map.pulseBeats && map.pulseBeats.length) || (map.kicks && map.kicks.length) || 0) : 0;
  var duration = map && isFinite(map.duration) ? Number(map.duration) : 0;
  var partialUntil = map && isFinite(map.partialUntilSec) ? Number(map.partialUntilSec) : 0;
  var key = map
    ? [source, map.analyzedAt || 0, cameraCount, pulseCount, Math.round(duration * 10), Math.round(partialUntil * 10), map.tempoSource || 'local'].join('|')
    : 'none';
  var shouldSendMap = !!force || key !== desktopOverlayPushState.lastLyricsBeatKey;
  desktopOverlayPushState.lastLyricsBeatKey = key;
  var payload = { beatMapKey: key };
  if (shouldSendMap) payload.beatMap = map ? packLocalBeatMap(map) : null;
  return payload;
}
function notifyDesktopLyricsBeatMapReady() {
  try {
    if (fx && fx.desktopLyrics) pushDesktopLyricsState(true);
  } catch (e) {}
}
function desktopLyricsPushInterval() {
  var fps = normalizeDesktopLyricsFps(fx && fx.desktopLyricsFps);
  if (!fps) return 8;
  return Math.max(8, Math.min(42, 1000 / fps));
}
function desktopLyricsPayload(forceBeatMap) {
  var meta = currentDesktopSongMeta();
  var lyric = currentDesktopLyricSnapshot();
  var beatPayload = desktopLyricsBeatMapPayload(!!forceBeatMap);
  var payload = {
    enabled: !!fx.desktopLyrics && !isDevelopmentLockedFx('desktopLyrics'),
    text: lyric.text,
    progress: lyric.progress,
    progressSpan: lyric.progressSpan,
    title: meta.title,
    artist: meta.artist,
    playing: !!playing,
    size: clampRange(Number(fx.desktopLyricsSize) || fxDefaults.desktopLyricsSize, 0.72, 1.55),
    opacity: clampRange(fx.desktopLyricsOpacity == null ? fxDefaults.desktopLyricsOpacity : Number(fx.desktopLyricsOpacity), 0.28, 1),
    y: clampRange(fx.desktopLyricsY == null ? fxDefaults.desktopLyricsY : Number(fx.desktopLyricsY), 0.08, 0.92),
    clickThrough: isDevelopmentLockedFx('desktopLyricsClickThrough') ? true : fx.desktopLyricsClickThrough !== false,
    lyricGlowParticles: !!fx.lyricGlowParticles,
    cinema: fx.desktopLyricsCinema !== false,
    highlightFollow: fx.desktopLyricsHighlight === true,
    frameRate: normalizeDesktopLyricsFps(fx.desktopLyricsFps),
    fontFamily: lyricFontStackForKey(fx.lyricFont),
    fontWeight: lyricFontWeightValue(),
    letterSpacing: clampRange(Number(fx.lyricLetterSpacing) || 0, -0.04, 0.18),
    lineHeight: lyricLineHeightFactor(),
    lyricScale: clampRange(Number(fx.lyricScale) || 1, 0.35, 1.65),
    feather: lyricsHasNativeKaraoke ? 0.030 : 0.055,
    motion: desktopLyricsMotionPayload(),
    playback: desktopLyricsPlaybackPayload(),
    beatMapKey: beatPayload.beatMapKey,
    colors: desktopOverlayColors()
  };
  if (Object.prototype.hasOwnProperty.call(beatPayload, 'beatMap')) payload.beatMap = beatPayload.beatMap;
  return payload;
}
function wallpaperPayload() {
  var meta = currentDesktopSongMeta();
  return {
    enabled: !!fx.wallpaperMode && !isDevelopmentLockedFx('wallpaperMode'),
    title: meta.title,
    artist: meta.artist,
    cover: meta.cover,
    playing: !!playing,
    preset: fx.preset,
    opacity: clampRange(fx.wallpaperOpacity == null ? fxDefaults.wallpaperOpacity : Number(fx.wallpaperOpacity), 0.35, 1),
    colors: desktopOverlayColors()
  };
}
function pushDesktopLyricsState(force) {
  var api = getDesktopWindowApi();
  if (!api || typeof api.updateDesktopLyrics !== 'function') return;
  var now = performance.now();
  if (!force && now - desktopOverlayPushState.lyricsAt < desktopLyricsPushInterval()) return;
  var payload = desktopLyricsPayload(!!force);
  var colors = payload.colors || {};
  var motion = payload.motion || {};
  var key = payload.enabled + '|' + payload.text + '|' + Math.round(payload.progress * 1000) + '|' + Math.round((payload.progressSpan || 0) * 100) + '|' + payload.playing + '|' + payload.size + '|' + payload.opacity + '|' + payload.y + '|' + payload.clickThrough + '|' + payload.cinema + '|' + payload.highlightFollow + '|' + payload.frameRate + '|' + payload.fontFamily + '|' + payload.fontWeight + '|' + payload.letterSpacing + '|' + payload.lineHeight + '|' + payload.lyricScale + '|' + payload.feather + '|' + payload.beatMapKey + '|' + colors.primary + '|' + colors.secondary + '|' + colors.highlight + '|' + colors.glow + '|' + motion.lyricGlow + '|' + motion.lyricGlowBeat + '|' + Math.round((motion.lyricGlowStrength || 0) * 100) + '|' + Math.round((motion.highBloom || 0) * 100) + '|' + Math.round((motion.beatGlow || 0) * 100) + '|' + Math.round((motion.beatPulse || 0) * 100) + '|' + Math.round((motion.bass || 0) * 100);
  if (!force && key === desktopOverlayPushState.lastLyricsKey && now - desktopOverlayPushState.lyricsAt < 900) return;
  desktopOverlayPushState.lyricsAt = now;
  desktopOverlayPushState.lastLyricsKey = key;
  api.updateDesktopLyrics(payload).catch(function(e){ console.warn('desktop lyrics update failed:', e); });
}
function applyDesktopLyricsState(force) {
  var api = getDesktopWindowApi();
  if (!api) return;
  normalizeDevelopmentLockedFxState();
  var payload = desktopLyricsPayload(true);
  if (typeof api.setDesktopLyricsEnabled === 'function') {
    api.setDesktopLyricsEnabled(!!payload.enabled, payload).catch(function(e){ console.warn('desktop lyrics state failed:', e); });
  }
  pushDesktopLyricsState(!!force);
}
function pushWallpaperState(force) {
  var api = getDesktopWindowApi();
  if (!api || typeof api.updateWallpaperMode !== 'function') return;
  var now = performance.now();
  if (!force && now - desktopOverlayPushState.wallpaperAt < 260) return;
  var payload = wallpaperPayload();
  var key = payload.enabled + '|' + payload.title + '|' + payload.artist + '|' + payload.cover + '|' + payload.playing + '|' + payload.preset + '|' + payload.opacity;
  if (!force && key === desktopOverlayPushState.lastWallpaperKey && now - desktopOverlayPushState.wallpaperAt < 1400) return;
  desktopOverlayPushState.wallpaperAt = now;
  desktopOverlayPushState.lastWallpaperKey = key;
  api.updateWallpaperMode(payload).catch(function(e){ console.warn('wallpaper update failed:', e); });
}
function applyWallpaperModeState(force) {
  var api = getDesktopWindowApi();
  if (!api) return;
  normalizeDevelopmentLockedFxState();
  var payload = wallpaperPayload();
  if (typeof api.setWallpaperMode === 'function') {
    api.setWallpaperMode(!!payload.enabled, payload).catch(function(e){ console.warn('wallpaper state failed:', e); });
  }
  pushWallpaperState(!!force);
}
function syncDesktopOverlayState() {
  if (fx.desktopLyrics) pushDesktopLyricsState(false);
  if (fx.wallpaperMode) pushWallpaperState(false);
}
setInterval(function(){
  if (fx && (fx.desktopLyrics || fx.wallpaperMode)) syncDesktopOverlayState();
}, 320);

// 全屏
var desktopFullscreenActive = false;
var documentFullscreenActive = false;
var desktopWindowState = {};

function toggleFullscreen() {
  var api = window.desktopWindow;
  if (api && api.isDesktop && typeof api.toggleFullscreen === 'function') {
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(function(){});
      scheduleMainRendererViewportRefresh('document-fullscreen-exit');
      return;
    }
    api.toggleFullscreen();
    scheduleMainRendererViewportRefresh('desktop-fullscreen-toggle');
    return;
  }
  if (api && api.isDesktop && desktopFullscreenActive && !document.fullscreenElement && typeof api.exitFullscreenWindowed === 'function') {
    api.exitFullscreenWindowed();
    scheduleMainRendererViewportRefresh('desktop-fullscreen-exit');
    return;
  }
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(function(){
      if (api && api.isDesktop && typeof api.toggleFullscreen === 'function') api.toggleFullscreen();
      else showToast('全屏被浏览器拒绝');
    });
  } else {
    document.exitFullscreen();
    scheduleMainRendererViewportRefresh('document-fullscreen-exit');
  }
}

(function initDesktopWindowShell(){
  var api = window.desktopWindow;
  if (!api || !api.isDesktop) return;

  document.documentElement.classList.add('desktop-shell-root');
  document.body.classList.add('desktop-shell');
  document.body.classList.remove('desktop-fullscreen');
  desktopFullscreenActive = false;
  syncCursorAutoHideMode();

  var maxBtn = document.querySelector('[data-window-action="maximize"]');
  var maxIcon = maxBtn && maxBtn.querySelector('.icon-maximize');
  var restoreIcon = maxBtn && maxBtn.querySelector('.icon-restore');
  function applyState(state) {
    desktopWindowState = Object.assign(desktopWindowState, state || {});
    var isMaximized = !!desktopWindowState.isMaximized;
    var isFullScreen = !!desktopWindowState.isFullScreen || !!desktopWindowState.isNativeFullScreen || !!desktopWindowState.isHtmlFullScreen || !!desktopWindowState.isWindowFullScreen || !!document.fullscreenElement;
    var wasFullScreen = desktopFullscreenActive;
    desktopFullscreenActive = isFullScreen;
    document.body.classList.toggle('desktop-maximized', isMaximized);
    document.body.classList.toggle('desktop-fullscreen', isFullScreen);
    desktopRuntimeState.fullscreen = isFullScreen;
    if (isFullScreen) layoutFullscreenDiyZone();
    if (isFullScreen !== wasFullScreen) {
      scheduleMainRendererViewportRefresh('desktop-shell-state');
      if (document.body.classList.contains('empty-home-active')) renderHomeTiles();
      if (!isFullScreen) {
        document.body.classList.remove('fullscreen-diy-peek');
        setTimeout(function(){ clearPlayerControlFocusState('desktop-fullscreen-exit'); }, 80);
      }
    }
    syncCursorAutoHideMode();
    if (maxBtn) {
      maxBtn.title = isFullScreen ? '退出全屏' : '全屏';
      maxBtn.setAttribute('aria-label', maxBtn.title);
    }
    if (maxIcon) maxIcon.style.display = isFullScreen ? 'none' : '';
    if (restoreIcon) restoreIcon.style.display = isFullScreen ? '' : 'none';
    // 同步全屏窗口控制按钮的图标
    var fsMaxBtn = document.querySelector('#fullscreen-window-controls [data-window-action="maximize"]');
    if (fsMaxBtn) {
      var fsMaxIcon = fsMaxBtn.querySelector('.icon-maximize');
      var fsRestoreIcon = fsMaxBtn.querySelector('.icon-restore');
      if (fsMaxIcon) fsMaxIcon.style.display = isFullScreen ? 'none' : '';
      if (fsRestoreIcon) fsRestoreIcon.style.display = isFullScreen ? '' : 'none';
    }
  }

  document.querySelectorAll('[data-window-action]').forEach(function(btn){
    btn.addEventListener('click', function(e){
      e.preventDefault();
      e.stopPropagation();
      var action = btn.getAttribute('data-window-action');
      if (action === 'minimize') api.minimize();
      if (action === 'maximize') toggleFullscreen();
      if (action === 'close') api.close();
    });
  });

  if (typeof api.onDesktopLyricsLockState === 'function') {
    api.onDesktopLyricsLockState(function(payload){
      var locked = !payload || payload.locked !== false;
      if (fx.desktopLyricsClickThrough === locked) return;
      fx.desktopLyricsClickThrough = locked;
      updateFxInputs();
      saveLyricLayout();
      pushDesktopLyricsState(true);
      showToast(locked ? '桌面歌词已锁定' : '桌面歌词可移动');
    });
  }
  if (typeof api.onDesktopLyricsEnabledState === 'function') {
    api.onDesktopLyricsEnabledState(function(payload){
      var enabled = !!(payload && payload.enabled);
      if (fx.desktopLyrics === enabled) return;
      fx.desktopLyrics = enabled;
      updateFxInputs();
      saveLyricLayout();
      showToast(enabled ? '桌面歌词已开启' : '桌面歌词已关闭');
    });
  }

  api.onStateChange(applyState);
  if (typeof api.getState === 'function') {
    api.getState().then(applyState).catch(function(){ applyState({}); });
  } else {
    applyState({});
  }
  document.addEventListener('fullscreenchange', function(){
    var wasDocumentFullscreen = documentFullscreenActive;
    documentFullscreenActive = !!document.fullscreenElement;
    desktopWindowState.isHtmlFullScreen = documentFullscreenActive;
    if (wasDocumentFullscreen && !documentFullscreenActive && typeof api.exitFullscreenWindowed === 'function') {
      api.exitFullscreenWindowed();
    }
    applyState({});
  });
})();
