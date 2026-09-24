'use strict';

// ============================================================
//  12-system-panels.js  ←  源 main.js §30–§33（基线 784afe6）
//  输出设备 / 本地缓存面板 / 内存管家 / 第三方音源设置
// ============================================================

// ============================================================
// 播放输出设备（移植自上游 api-quality-output；渲染进程直接枚举 + setSinkId）
// ============================================================
var AUDIO_OUTPUT_STORE_KEY = 'bhandsmusic-audio-output-v1';
function readSavedAudioOutputId() {
  try { return String(localStorage.getItem(AUDIO_OUTPUT_STORE_KEY) || ''); } catch (e) { return ''; }
}
function saveAudioOutputId(deviceId) {
  try {
    if (deviceId) localStorage.setItem(AUDIO_OUTPUT_STORE_KEY, deviceId);
    else localStorage.removeItem(AUDIO_OUTPUT_STORE_KEY);
  } catch (e) {}
}
/** 把播放路由切到指定输出设备；deviceId 为空 = 系统默认 */
function applyAudioOutputDevice(deviceId, silent) {
  if (!audio || typeof audio.setSinkId !== 'function') return Promise.resolve(false);
  var target = String(deviceId || '');
  try {
    return Promise.resolve(audio.setSinkId(target)).then(function () {
      saveAudioOutputId(target);
      if (!silent) showToast(target ? '播放输出设备已切换' : '播放输出已恢复系统默认');
      return true;
    }, function () {
      if (!silent) showToast('切换输出设备失败');
      return false;
    });
  } catch (e) {
    return Promise.resolve(false);
  }
}
function renderAudioOutputList(devices) {
  var list = document.getElementById('audio-output-list');
  if (!list) return;
  var saved = readSavedAudioOutputId();
  var items = [{ deviceId: '', label: '系统默认' }].concat(devices || []);
  list.innerHTML = '';
  items.forEach(function (d) {
    var row = document.createElement('button');
    row.type = 'button';
    row.className = 'audio-output-item' + ((d.deviceId || '') === (saved || '') ? ' active' : '');
    row.setAttribute('data-device-id', d.deviceId || '');
    row.textContent = d.label || (d.deviceId ? '输出设备 ' + String(d.deviceId).slice(0, 8) : '系统默认');
    row.addEventListener('click', function () {
      applyAudioOutputDevice(d.deviceId).then(function (ok) { if (ok) renderAudioOutputList(devices); });
    });
    list.appendChild(row);
  });
}
function refreshAudioOutputDevices() {
  var list = document.getElementById('audio-output-list');
  if (!list) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
    list.innerHTML = '<div class="audio-output-empty">当前环境不支持设备枚举</div>';
    return;
  }
  navigator.mediaDevices.enumerateDevices().then(function (devices) {
    var outs = (devices || []).filter(function (d) { return d && d.kind === 'audiooutput'; })
      .map(function (d, i) { return { deviceId: d.deviceId, label: d.label || (d.deviceId ? '输出设备 ' + (i + 1) : '') }; });
    renderAudioOutputList(outs);
  }).catch(function () {
    list.innerHTML = '<div class="audio-output-empty">设备枚举失败，请点「刷新」重试</div>';
  });
}
// ============================================================
// 本地缓存面板（桌面端经 IPC 读取；Web 模式降级提示）
// ============================================================
var cacheStorageLastInfo = null;
function fmtCacheBytes(n) {
  var v = Number(n) || 0;
  if (v >= 1024 * 1024 * 1024) return (v / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  if (v >= 1024 * 1024) return (v / (1024 * 1024)).toFixed(1) + ' MB';
  if (v >= 1024) return (v / 1024).toFixed(1) + ' KB';
  return v + ' B';
}
function setCacheStorageText(id, text) {
  var el = document.getElementById(id);
  if (el) el.textContent = text;
}
function refreshCacheStoragePanel() {
  var api = window.desktopWindow;
  if (!api || !api.isDesktop || typeof api.getCacheInfo !== 'function') {
    setCacheStorageText('cache-storage-total', '不可用');
    setCacheStorageText('cache-storage-note', '缓存面板仅在桌面版可用。');
    return;
  }
  setCacheStorageText('cache-storage-total', '读取中...');
  api.getCacheInfo().then(function (info) {
    cacheStorageLastInfo = info || {};
    var beat = cacheStorageLastInfo.beatmaps || {};
    var net = cacheStorageLastInfo.networkCache || {};
    var user = cacheStorageLastInfo.userData || {};
    setCacheStorageText('cache-storage-total', fmtCacheBytes((beat.bytes || 0) + (net.bytes || 0)));
    setCacheStorageText('cache-storage-root', cacheStorageLastInfo.cacheRoot || '—');
    setCacheStorageText('cache-storage-beatmaps-size', fmtCacheBytes(beat.bytes));
    setCacheStorageText('cache-storage-beatmaps-path', beat.path || '—');
    setCacheStorageText('cache-storage-chromium-size', fmtCacheBytes(net.bytes));
    setCacheStorageText('cache-storage-chromium-path', net.path || '—');
    setCacheStorageText('cache-storage-userdata-size', fmtCacheBytes(user.bytes));
    setCacheStorageText('cache-storage-userdata-path', user.path || '—');
    var openBtn = document.getElementById('cache-storage-open');
    if (openBtn) openBtn.hidden = !cacheStorageLastInfo.cacheRoot;
  }).catch(function () {
    setCacheStorageText('cache-storage-total', '读取失败');
  });
}
function openCacheStorageDir() {
  var api = window.desktopWindow;
  if (api && api.isDesktop && typeof api.openCachePath === 'function' && cacheStorageLastInfo && cacheStorageLastInfo.cacheRoot) {
    api.openCachePath(cacheStorageLastInfo.cacheRoot);
  }
}
// ============================================================
// 内存管家 / Mem Reduct（移植自上游 Mineradio 2.2.0 的 11-system-memory-controls.js）
// 依赖主进程 bhandsmusic-memory-* IPC（desktop/system-memory.js）
// ============================================================
var MEMORY_REDUCT_MASK_BITS = { workingSet: 1, modifiedList: 4, standbyList: 8, standbyLow: 16 };
var MEMORY_REDUCT_MASK_DEFAULT = 29;
var memorySnapshotTimer = 0;
var memoryLastSnapshotAt = 0;
var memoryLastStatusPayload = null;

function normalizeMemorySystemMask(mask) {
  var value = Math.round(Number(mask) || MEMORY_REDUCT_MASK_DEFAULT) & MEMORY_REDUCT_MASK_DEFAULT;
  return value > 0 ? value : MEMORY_REDUCT_MASK_DEFAULT;
}

function ensureMemoryFxDefaults() {
  if (!fx) return;
  if (fx.memoryAutoTrimApp !== false) fx.memoryAutoTrimApp = true;
  if (fx.memoryAutoTrimOnBackground !== false) fx.memoryAutoTrimOnBackground = true;
  fx.memoryAutoSystemTrim = fx.memoryAutoSystemTrim === true;
  fx.memorySystemAutoElevate = fx.memorySystemAutoElevate === true;
  fx.memorySystemIntervalMin = clampRange(Math.round(fx.memorySystemIntervalMin == null ? fxDefaults.memorySystemIntervalMin : Number(fx.memorySystemIntervalMin)), 5, 180);
  fx.memorySystemThresholdPercent = clampRange(Math.round(fx.memorySystemThresholdPercent == null ? fxDefaults.memorySystemThresholdPercent : Number(fx.memorySystemThresholdPercent)), 50, 98);
  fx.memorySystemMask = normalizeMemorySystemMask(fx.memorySystemMask == null ? fxDefaults.memorySystemMask : fx.memorySystemMask);
}

function memoryAutoConfigPayload(runNow) {
  ensureMemoryFxDefaults();
  return {
    appTrimEnabled: !(fx && fx.memoryAutoTrimApp === false),
    backgroundTrimEnabled: !(fx && fx.memoryAutoTrimOnBackground === false),
    enabled: !!(fx && fx.memoryAutoSystemTrim && fx.memoryAutoTrimOnBackground !== false),
    mask: normalizeMemorySystemMask(fx && fx.memorySystemMask),
    intervalMin: Math.max(5, Math.round(Number(fx && fx.memorySystemIntervalMin) || 30)),
    thresholdPercent: Math.max(50, Math.min(98, Math.round(Number(fx && fx.memorySystemThresholdPercent) || 78))),
    autoElevate: !!(fx && fx.memorySystemAutoElevate),
    runNow: runNow === true
  };
}

function rememberMemoryStatusPayload(payload) {
  if (!payload) return;
  if (payload.snapshot || Object.prototype.hasOwnProperty.call(payload, 'systemPurgeAvailable')) {
    memoryLastStatusPayload = Object.assign({}, memoryLastStatusPayload || {}, payload);
    return;
  }
  if (memoryLastStatusPayload) {
    memoryLastStatusPayload.auto = payload.state || payload.auto || memoryLastStatusPayload.auto;
  }
}

/** 把 fx 里的内存设置同步给主进程（非桌面版静默跳过） */
function configureMemoryReductFromFx(reason, runNow) {
  if (!window.desktopWindow || typeof window.desktopWindow.configureMemoryReduct !== 'function') return Promise.resolve(null);
  return window.desktopWindow.configureMemoryReduct(memoryAutoConfigPayload(runNow)).then(function (payload) {
    rememberMemoryStatusPayload(payload);
    updateMemoryControls();
    return payload;
  }).catch(function (error) {
    updateMemoryStatusText('内存管家配置失败: ' + String(error && error.message || error || ''));
    return null;
  });
}

function memoryFormatSnapshot(snapshot) {
  if (!snapshot) return '系统内存读取中...';
  var total = Math.round(Number(snapshot.totalMB) || 0);
  var used = Math.round(Number(snapshot.usedMB) || 0);
  var free = Math.round(Number(snapshot.freeMB) || 0);
  var percent = Math.round(Number(snapshot.usedPercent) || 0);
  var proc = snapshot.process || {};
  var rss = Math.round(Number(proc.rssMB) || 0);
  return '系统 ' + used + '/' + total + ' MB (' + percent + '%), 可用 ' + free + ' MB, 播放器 ' + rss + ' MB';
}

function updateMemoryStatusText(text) {
  var chip = document.getElementById('memory-status-chip');
  if (chip) chip.textContent = text || '系统内存读取中...';
}

function refreshMemorySnapshot(force) {
  if (!window.desktopWindow || typeof window.desktopWindow.getMemorySnapshot !== 'function') {
    updateMemoryStatusText('当前不是桌面版，系统内存优化不可用');
    return Promise.resolve(null);
  }
  var now = performance.now();
  if (!force && now - memoryLastSnapshotAt < 5000 && memoryLastStatusPayload) {
    return Promise.resolve(memoryLastStatusPayload);
  }
  memoryLastSnapshotAt = now;
  return window.desktopWindow.getMemorySnapshot().then(function (payload) {
    if (payload) rememberMemoryStatusPayload(payload);
    else memoryLastStatusPayload = null;
    var status = payload && payload.ok ? memoryFormatSnapshot(payload.snapshot) : '系统内存读取失败';
    if (payload && payload.elevated) status += ' | 管理员';
    updateMemoryStatusText(status);
    updateMemoryControls();
    return payload;
  }).catch(function (error) {
    updateMemoryStatusText('系统内存读取失败: ' + String(error && error.message || error || ''));
    return null;
  });
}

function updateMemoryControls() {
  ensureMemoryFxDefaults();
  [
    ['memoryAutoTrimApp', 't-memoryAutoTrimApp'],
    ['memoryAutoTrimOnBackground', 't-memoryAutoTrimOnBackground'],
    ['memoryAutoSystemTrim', 't-memoryAutoSystemTrim'],
    ['memorySystemAutoElevate', 't-memorySystemAutoElevate']
  ].forEach(function (pair) {
    var el = document.getElementById(pair[1]);
    if (el) el.classList.toggle('on', !!fx[pair[0]]);
  });
  var systemAvailable = !memoryLastStatusPayload || memoryLastStatusPayload.systemPurgeAvailable !== false;
  ['t-memoryAutoSystemTrim', 't-memorySystemAutoElevate'].forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('dev-locked');
    el.setAttribute('aria-disabled', 'false');
    el.title = systemAvailable
      ? '系统级释放只在 BhandsMusic 隐藏/最小化且阈值、间隔允许时执行。'
      : '系统级释放尚未获得桌面进程确认；播放器进程压缩仍然生效。';
  });
  document.querySelectorAll('#memory-mask-seg [data-memory-mask]').forEach(function (btn) {
    var bit = MEMORY_REDUCT_MASK_BITS[btn.getAttribute('data-memory-mask')] || 0;
    btn.classList.toggle('active', !!(normalizeMemorySystemMask(fx.memorySystemMask) & bit));
  });
  var maskSeg = document.getElementById('memory-mask-seg');
  if (maskSeg) maskSeg.classList.remove('dev-locked');
  document.querySelectorAll('.memory-action-row button').forEach(function (btn, index) {
    if (index === 1) {
      btn.disabled = !systemAvailable;
      btn.classList.toggle('dev-locked', !systemAvailable);
      btn.title = systemAvailable
        ? '手动系统内存释放；BhandsMusic 前台可见时会自动跳过，避免卡顿。'
        : '系统级释放不可用；后台播放器压缩仍然生效。';
    } else if (index > 1) {
      btn.disabled = !systemAvailable;
      btn.classList.toggle('dev-locked', !systemAvailable);
      btn.title = systemAvailable
        ? '提权释放；请先最小化或隐藏 BhandsMusic，前台可见时会跳过。'
        : '系统级释放不可用；后台播放器压缩仍然生效。';
    }
  });
  setRange('fx-memory-interval', fx.memorySystemIntervalMin);
  setRange('fx-memory-threshold', fx.memorySystemThresholdPercent);
  if (!memoryLastStatusPayload && !memorySnapshotTimer) {
    memorySnapshotTimer = setTimeout(function () {
      memorySnapshotTimer = 0;
      refreshMemorySnapshot(false);
    }, 300);
  }
}

function toggleMemoryMaskPart(part) {
  ensureMemoryFxDefaults();
  var bit = MEMORY_REDUCT_MASK_BITS[part] || 0;
  if (!bit) return;
  var next = normalizeMemorySystemMask(fx.memorySystemMask) ^ bit;
  fx.memorySystemMask = normalizeMemorySystemMask(next);
  saveLyricLayout();
  updateMemoryControls();
  configureMemoryReductFromFx('mask', false);
}

/** 手动压缩播放器进程工作集（面板按钮） */
function runAppMemoryTrim(reason) {
  if (!window.desktopWindow || typeof window.desktopWindow.trimAppMemory !== 'function') {
    showToast('桌面版才支持进程内存压缩');
    return;
  }
  updateMemoryStatusText('正在压缩播放器工作集...');
  window.desktopWindow.trimAppMemory({ reason: reason || 'manual' }).then(function (payload) {
    if (payload && payload.ok && payload.after) updateMemoryStatusText('播放器已压缩: ' + memoryFormatSnapshot(payload.after));
    else if (payload && payload.skipped && payload.reason === 'foreground-visible') updateMemoryStatusText('前台可见时不压缩，避免操作卡顿；最小化/隐藏后自动处理');
    else updateMemoryStatusText('播放器压缩未完成');
    refreshMemorySnapshot(true);
  }).catch(function (error) {
    updateMemoryStatusText('播放器压缩失败: ' + String(error && error.message || error || ''));
  });
}

/** 手动系统级内存释放（面板按钮；autoElevate 时可请求 UAC） */
function runSystemMemoryPurge(autoElevate) {
  ensureMemoryFxDefaults();
  if (!window.desktopWindow || typeof window.desktopWindow.purgeSystemMemory !== 'function') {
    showToast('桌面版才支持系统级释放');
    return;
  }
  updateMemoryStatusText(autoElevate ? '正在请求提权系统释放（前台可见时会跳过）...' : '正在尝试系统级手动释放（前台可见时会跳过）...');
  window.desktopWindow.purgeSystemMemory({
    mask: normalizeMemorySystemMask(fx && fx.memorySystemMask),
    autoElevate: !!autoElevate,
    manual: true
  }).then(function (payload) {
    rememberMemoryStatusPayload(payload);
    var result = payload && payload.result;
    if (result && result.skipped && result.reason === 'foreground-visible') {
      updateMemoryStatusText('前台可见时不执行系统释放；先最小化/隐藏再用，避免操作卡顿');
      showToast('前台已跳过系统释放，最小化后再用');
    } else if (result && result.ok) {
      updateMemoryStatusText('系统释放完成，约释放 ' + (result.freedMB || 0) + ' MB' + (result.partial ? '（部分权限）' : ''));
      showToast('系统释放完成');
    } else if (result && result.needAdmin) {
      updateMemoryStatusText(autoElevate ? '提权释放未完成：可能取消了管理员权限或被系统拦截' : '当前权限只能完成部分释放；需要时可最小化后点提权释放');
      showToast(autoElevate ? '提权释放未完成' : '需要管理员权限的部分已跳过');
    } else {
      updateMemoryStatusText('系统释放未完成: ' + String(result && result.message || payload && payload.error || ''));
    }
    refreshMemorySnapshot(true);
  }).catch(function (error) {
    updateMemoryStatusText('系统释放失败: ' + String(error && error.message || error || ''));
  });
}

/** 绑定内存管家面板事件（幂等；由设置面板绑定流程调用） */
function bindSystemMemoryControls() {
  document.querySelectorAll('#memory-mask-seg [data-memory-mask]').forEach(function (btn) {
    if (btn._bhandsmusicMemoryBound) return;
    btn._bhandsmusicMemoryBound = true;
    btn.addEventListener('click', function () {
      toggleMemoryMaskPart(btn.getAttribute('data-memory-mask'));
    });
  });
  [
    ['fx-memory-interval', 'memorySystemIntervalMin', 5, 180],
    ['fx-memory-threshold', 'memorySystemThresholdPercent', 50, 98]
  ].forEach(function (item) {
    var input = document.getElementById(item[0]);
    if (!input || input._bhandsmusicMemoryBound) return;
    input._bhandsmusicMemoryBound = true;
    input.addEventListener('input', function () {
      fx[item[1]] = clampRange(Math.round(Number(input.value) || fxDefaults[item[1]]), item[2], item[3]);
      setRange(item[0], fx[item[1]]);
      saveLyricLayout();
      configureMemoryReductFromFx('slider', false);
    });
  });
  refreshMemorySnapshot(false);
  configureMemoryReductFromFx('bind', false);
}
function updateFxInputs() {
  normalizeDevelopmentLockedFxState();
  applyShelfCameraDefaultAngle(false);
  setRange('fx-intensity', fx.intensity);
  setRange('fx-cineshake', fx.cinemaShake);
  setRange('fx-depth', fx.depth);
  setRange('fx-coverres', fx.coverResolution);
  setRange('fx-lyricglow', fx.lyricGlowStrength);
  setRange('fx-lyricbgadapt', fx.lyricBackgroundAdapt == null ? fxDefaults.lyricBackgroundAdapt : fx.lyricBackgroundAdapt);
  setRange('fx-bgopacity', fx.backgroundOpacity == null ? 1 : fx.backgroundOpacity);
  setRange('fx-glassaberration', fx.controlGlassChromaticOffset);
  setRange('fx-desktoplyricssize', fx.desktopLyricsSize);
  setRange('fx-desktoplyricsopacity', fx.desktopLyricsOpacity);
  setRange('fx-desktoplyricsy', fx.desktopLyricsY);
  setRange('fx-wallpaperopacity', fx.wallpaperOpacity);
  setRange('fx-shelfsize', fx.shelfSize);
  setRange('fx-shelfx', fx.shelfOffsetX);
  setRange('fx-shelfy', fx.shelfOffsetY);
  setRange('fx-shelfz', fx.shelfOffsetZ);
  setRange('fx-shelfangle', fx.shelfAngleY);
  setRange('fx-shelfopacity', fx.shelfOpacity);
  setRange('fx-shelfbgalpha', fx.shelfBgOpacity);
  setRange('fx-lyricspacing', fx.lyricLetterSpacing);
  setRange('fx-lyriclineheight', fx.lyricLineHeight);
  setRange('fx-lyricweight', fx.lyricWeight);
  setRange('fx-lyriccustomlines', lyricCustomLineCountValue());
  setRange('fx-lyricscale', fx.lyricScale);
  setRange('fx-lyriccontextopacity', lyricContextOpacityValue());
  setRange('fx-lyriccontextspread', lyricContextSpreadValue());
  setRange('fx-lyrictranslationgap', lyricTranslationGapValue());
  setRange('fx-lyrictranslationscale', lyricTranslationScaleValue());
  setRange('fx-lyrictranslationopacity', lyricTranslationOpacityValue());
  syncLyricTranslationControls();
  setRange('fx-lyricedgefade', lyricEdgeFadeValue());
  setRange('fx-lyricmotionsoftness', lyricMotionSoftnessValue());
  setRange('fx-lyricglitchintensity', lyricGlitchIntensityValue());
  setRange('fx-lyricglitchslice', lyricGlitchSliceValue());
  setRange('fx-lyricglitchchroma', lyricGlitchChromaValue());
  setRange('fx-lyricglitchrate', lyricGlitchRateValue());
  setRange('fx-lyricglitchjitter', lyricGlitchJitterValue());
  setRange('fx-lyricx', fx.lyricOffsetX);
  setRange('fx-lyricy', fx.lyricOffsetY);
  setRange('fx-lyricz', fx.lyricOffsetZ);
  setRange('fx-lyrictiltx', fx.lyricTiltX);
  setRange('fx-lyrictilty', fx.lyricTiltY);
  setRange('fx-point', fx.point);
  setRange('fx-speed', fx.speed);
  setRange('fx-twist', fx.twist);
  setRange('fx-color', fx.color);
  setRange('fx-bloom', fx.bloomStrength);
  setRange('fx-scatter', fx.scatter);
  setRange('fx-bgfade', fx.bgFade);
  updateLyricGlowControls();
  // 同步开关
  document.getElementById('t-float').classList.toggle('on', fx.floatLayer);
  var floatToggle = document.getElementById('t-float');
  if (floatToggle) floatToggle.classList.toggle('on', fx.floatLayer);
  document.getElementById('t-cinema').classList.toggle('on', fx.cinema);
  var lyricGlowToggle = document.getElementById('t-lyricGlow');
  if (lyricGlowToggle) lyricGlowToggle.classList.toggle('on', fx.lyricGlow);
  // 溢光快捷按钮行（上游同款入口，与控制台「歌词溢光开关」条目对应）
  var lyricGlowEnableBtn = document.getElementById('lyric-glow-enable-btn');
  if (lyricGlowEnableBtn) lyricGlowEnableBtn.classList.toggle('active', !!fx.lyricGlow);
  var lyricGlowBeatBtn = document.getElementById('lyric-glow-beat-btn');
  if (lyricGlowBeatBtn) lyricGlowBeatBtn.classList.toggle('active', !!fx.lyricGlowBeat);
  var lyricGlowBeatToggle = document.getElementById('t-lyricGlowBeat');
  if (lyricGlowBeatToggle) lyricGlowBeatToggle.classList.toggle('on', fx.lyricGlowBeat);
  var lyricGlowParticlesToggle = document.getElementById('t-lyricGlowParticles');
  if (lyricGlowParticlesToggle) lyricGlowParticlesToggle.classList.toggle('on', fx.lyricGlowParticles);
  var lyricCameraLockToggle = document.getElementById('t-lyricCameraLock');
  if (lyricCameraLockToggle) lyricCameraLockToggle.classList.toggle('on', fx.lyricCameraLock);
  var lyricPauseHoldToggle = document.getElementById('t-lyricPauseHold');
  if (lyricPauseHoldToggle) lyricPauseHoldToggle.classList.toggle('on', fx.lyricPauseHold !== false);
  var lyricVerticalFloatToggle = document.getElementById('t-lyricVerticalFloat');
  if (lyricVerticalFloatToggle) lyricVerticalFloatToggle.classList.toggle('on', fx.lyricVerticalFloat !== false);
  syncLyricMotionStyleSeg();
  document.getElementById('t-bloom').classList.toggle('on', fx.bloom);
  document.getElementById('t-edge').classList.toggle('on', fx.edge);
  var desktopLyricsToggle = document.getElementById('t-desktopLyrics');
  if (desktopLyricsToggle) desktopLyricsToggle.classList.toggle('on', fx.desktopLyrics);
  var desktopLyricsClickToggle = document.getElementById('t-desktopLyricsClickThrough');
  if (desktopLyricsClickToggle) desktopLyricsClickToggle.classList.toggle('on', fx.desktopLyricsClickThrough !== false);
  var desktopLyricsCinemaToggle = document.getElementById('t-desktopLyricsCinema');
  if (desktopLyricsCinemaToggle) desktopLyricsCinemaToggle.classList.toggle('on', fx.desktopLyricsCinema !== false);
  var desktopLyricsHighlightToggle = document.getElementById('t-desktopLyricsHighlight');
  if (desktopLyricsHighlightToggle) desktopLyricsHighlightToggle.classList.toggle('on', fx.desktopLyricsHighlight === true);
  updateDesktopLyricsFpsControls();
  var wallpaperModeToggle = document.getElementById('t-wallpaperMode');
  if (wallpaperModeToggle) wallpaperModeToggle.classList.toggle('on', fx.wallpaperMode);
  var shelfPodcastsToggle = document.getElementById('t-shelfShowPodcasts');
  if (shelfPodcastsToggle) shelfPodcastsToggle.classList.toggle('on', fx.shelfShowPodcasts !== false);
  var shelfMergeToggle = document.getElementById('t-shelfMergeCollections');
  if (shelfMergeToggle) shelfMergeToggle.classList.toggle('on', fx.shelfMergeCollections === true);
  var liveBackgroundKeepToggle = document.getElementById('t-liveBackgroundKeep');
  if (liveBackgroundKeepToggle) liveBackgroundKeepToggle.classList.toggle('on', fx.liveBackgroundKeep === true);
  updatePerformanceControls();
  updateMemoryControls();
  updateDevelopmentFxControls();
  var aiDepthToggle = document.getElementById('t-aidepth');
  if (aiDepthToggle) aiDepthToggle.classList.toggle('on', fx.aiDepth);
  // 三态
  document.querySelectorAll('#shelf-seg button').forEach(function(b){ b.classList.toggle('active', b.dataset.shelf === fx.shelf); });
  updateShelfControlUi();
  document.querySelectorAll('#cam-seg button').forEach(function(b){ b.classList.toggle('active', b.dataset.cam === fx.cam); });
  refreshPresetGrid();
  updateLyricColorControls();
  updateLyricHighlightControls();
  updateLyricGlowControls();
  updateLyricFontControls();
  updateUiAccentControls();
  updateHomeAccentControls();
  updateIconAccentControls();
  updateCustomBackgroundControls();
  updateVisualTintControls();
  applyControlGlassChromaticOffset();
  syncFxUniforms();
}
function animateFxResetButton(btn) {
  if (!btn || !window.gsap) return;
  window.gsap.fromTo(btn, { rotate: -120, scale: 0.88 }, { rotate: 0, scale: 1, duration: 0.48, ease: 'expo.out', overwrite: true });
  window.gsap.fromTo(btn, { boxShadow: '0 0 0 0 rgba(244,210,138,.38)' }, { boxShadow: '0 0 0 8px rgba(244,210,138,0)', duration: 0.55, ease: 'sine.out', overwrite: true });
}
function resetFxSliderValue(id, key, btn) {
  if (!Object.prototype.hasOwnProperty.call(fxDefaults, key)) return;
  if (key === 'shelfAngleY') {
    fx.shelfAngleYManual = false;
    fx.shelfAngleY = shelfDefaultAngleForCameraMode(fx.shelfCameraMode);
  } else {
    fx[key] = fxDefaults[key];
  }
  setRange(id, fx[key]);
  if (key === 'coverResolution') applyCoverParticleResolution(fx[key], { reload: true });
  if (key === 'controlGlassChromaticOffset') applyControlGlassChromaticOffset();
  syncFxUniforms();
  if (key === 'lyricLetterSpacing' || key === 'lyricLineHeight' || key === 'lyricWeight') refreshAllLyricLineFonts();
  saveLyricLayout();
  animateFxResetButton(btn);
  showToast('已恢复默认数值');
}
function ensureFxSliderResetButton(id, key) {
  var el = document.getElementById(id);
  if (!el || !el.parentElement || el.parentElement.querySelector('.fx-reset-one')) return;
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'fx-reset-one';
  btn.title = '恢复当前滑条默认值';
  btn.setAttribute('aria-label', '恢复当前滑条默认值');
  btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>';
  btn.addEventListener('click', function(e){
    e.preventDefault();
    e.stopPropagation();
    resetFxSliderValue(id, key, btn);
  });
  el.parentElement.appendChild(btn);
}
var fxPanelTab = 'home';
var fxPanelTabScroll = {};
function setFxPanelTab(tab) {
  var allowed = { home:1, lyrics:1, motion:1, shelf:1, system:1 };
  var panel = document.getElementById('fx-panel');
  var nextTab = allowed[tab] ? tab : 'home';
  var previousTab = fxPanelTab;
  if (panel && previousTab !== nextTab && panel.getAttribute('data-console-layout') === 'task-first-v2') {
    fxPanelTabScroll[previousTab] = panel.scrollTop;
  }
  fxPanelTab = nextTab;
  if (panel) panel.setAttribute('data-active-tab', fxPanelTab);
  document.querySelectorAll('#fx-panel-tabs [data-fx-tab]').forEach(function(btn){
    var active = btn.getAttribute('data-fx-tab') === fxPanelTab;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
    btn.setAttribute('tabindex', active ? '0' : '-1');
    if (active && previousTab !== fxPanelTab && btn.scrollIntoView) btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
  document.querySelectorAll('#fx-panel .fx-tab-page').forEach(function(page){
    var active = page.getAttribute('data-fx-page') === fxPanelTab;
    page.classList.toggle('active', active);
    page.setAttribute('aria-hidden', active ? 'false' : 'true');
  });
  if (panel && previousTab !== fxPanelTab && panel.getAttribute('data-console-layout') === 'task-first-v2') {
    requestAnimationFrame(function () {
      panel.scrollTop = Object.prototype.hasOwnProperty.call(fxPanelTabScroll, fxPanelTab) ? fxPanelTabScroll[fxPanelTab] : 0;
    });
  }
  repositionFxFloatingPanels();
}
function fxPanelInputId(node) {
  var input = node && node.querySelector ? node.querySelector('input[id]') : null;
  return input ? input.id : '';
}
function fxPanelTargetForNode(node, current) {
  if (!node) return current || 'presets';
  var id = node.id || '';
  var inputId = fxPanelInputId(node);
  if (id === 'preset-grid' || id === 'user-archive-grid') return 'presets';
  if (id === 'fx-lyric-fold') return 'lyrics';
  if (id === 'fx-overlay-fold' || id === 'fx-stage-fold') return 'motion';
  if (id === 'fx-advanced' || node.classList.contains('fx-actions')) return 'advanced';
  if (node.classList.contains('lyric-color-row') || node.classList.contains('cover-color-pop') || node.classList.contains('color-lab-pop') || node.classList.contains('cover-color-loupe')) return 'appearance';
  if (inputId === 'fx-bgopacity' || inputId === 'fx-glassaberration') return 'appearance';
  if (inputId === 'fx-lyricglow') return 'lyrics';
  if (/^fx-(intensity|depth|coverres|cineshake)$/.test(inputId)) return 'motion';
  return current || 'presets';
}
function organizeFxPanel() {
  if (typeof organizeFxConsoleWorkspace === 'function') {
    organizeFxConsoleWorkspace();
    if (typeof initFxConsoleSearchAndHistory === 'function') initFxConsoleSearchAndHistory();
    return;
  }
  var panel = document.getElementById('fx-panel');
  if (!panel) return;
  if (panel._fxPanelOrganized) {
    setFxPanelTab(fxPanelTab);
    return;
  }
  var head = panel.querySelector('.fx-head');
  var tabMeta = [
    ['presets', '\u9884\u8bbe'],
    ['appearance', '\u5916\u89c2'],
    ['lyrics', '\u6b4c\u8bcd'],
    ['motion', '\u52a8\u6001'],
    ['advanced', '\u9ad8\u7ea7']
  ];
  var tabs = document.createElement('div');
  tabs.className = 'fx-panel-tabs';
  tabs.id = 'fx-panel-tabs';
  tabMeta.forEach(function(meta){
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('data-fx-tab', meta[0]);
    btn.textContent = meta[1];
    tabs.appendChild(btn);
  });
  if (head && head.nextSibling) panel.insertBefore(tabs, head.nextSibling);
  else panel.insertBefore(tabs, panel.firstChild);
  var pages = {};
  var insertAfter = tabs;
  tabMeta.forEach(function(meta){
    var page = document.createElement('div');
    page.className = 'fx-tab-page';
    page.setAttribute('data-fx-page', meta[0]);
    insertAfter.parentNode.insertBefore(page, insertAfter.nextSibling);
    insertAfter = page;
    pages[meta[0]] = page;
  });
  var original = Array.prototype.slice.call(panel.children).filter(function(child){
    return child !== head && child !== tabs && !child.classList.contains('fx-tab-page');
  });
  var current = 'presets';
  original.forEach(function(node, idx){
    var target;
    if (node.classList.contains('fx-section-label')) {
      target = fxPanelTargetForNode(original[idx + 1], current);
      current = target;
    } else {
      target = fxPanelTargetForNode(node, current);
      current = target;
    }
    (pages[target] || pages.presets).appendChild(node);
  });
  ['fx-lyric-fold','fx-overlay-fold','fx-stage-fold','fx-advanced'].forEach(function(id){
    var fold = document.getElementById(id);
    if (fold) fold.classList.add('open');
  });
  tabs.addEventListener('click', function(e){
    var btn = e.target && e.target.closest ? e.target.closest('[data-fx-tab]') : null;
    if (!btn) return;
    setFxPanelTab(btn.getAttribute('data-fx-tab'));
  });
  panel._fxPanelOrganized = true;
  setFxPanelTab(fxPanelTab);
}

function fxControlBlock(id) {
  var el = document.getElementById(id);
  if (!el) return null;
  return el.closest('.fx-slider,.lyric-color-row,.lyric-color-grid,.fx-seg,.preset-grid,.user-archive-grid,.fx-font-grid') || el;
}
function setFxSectionBefore(id, text) {
  var block = fxControlBlock(id);
  if (!block || !block.parentNode) return;
  var prev = block.previousElementSibling;
  if (!prev || !prev.classList || !prev.classList.contains('fx-section-label')) {
    prev = document.createElement('div');
    prev.className = 'fx-section-label';
    block.parentNode.insertBefore(prev, block);
  }
  prev.textContent = text;
}
function setFxSliderLabel(id, text) {
  var block = fxControlBlock(id);
  var label = block && block.querySelector ? block.querySelector('label') : null;
  if (label) label.textContent = text;
}
function setFxSectionBeforeNode(node, text) {
  if (!node || !node.parentNode) return;
  var prev = node.previousElementSibling;
  if (!prev || !prev.classList || !prev.classList.contains('fx-section-label')) {
    prev = document.createElement('div');
    prev.className = 'fx-section-label';
    node.parentNode.insertBefore(prev, node);
  }
  prev.textContent = text;
}
function moveToggleToGrid(toggleId, grid) {
  var node = document.getElementById(toggleId);
  if (!node || !grid || node.parentNode === grid) return;
  grid.appendChild(node);
}
function ensureLyricPrimaryControls() {
  var body = document.querySelector('#fx-lyric-fold .fx-fold-body');
  if (!body) return;
  var grid = document.getElementById('fx-lyric-primary-controls');
  if (!grid) {
    var label = document.createElement('div');
    label.className = 'fx-section-label';
    label.id = 'fx-lyric-primary-label';
    label.textContent = '歌词开关';
    grid = document.createElement('div');
    grid.className = 'fx-toggle-grid lyric-primary-toggle-grid';
    grid.id = 'fx-lyric-primary-controls';
    body.insertBefore(grid, body.firstChild);
    body.insertBefore(label, grid);
  }
  [
    't-desktopLyrics',
    't-desktopLyricsClickThrough',
    't-desktopLyricsCinema',
    't-desktopLyricsHighlight',
    't-lyricCameraLock',
    't-lyricGlow',
    't-lyricGlowBeat',
    't-lyricGlowParticles'
  ].forEach(function(id){ moveToggleToGrid(id, grid); });
}
function applyBackgroundMediaHint() {
  var value = document.getElementById('bg-image-value');
  if (value && !value.dataset.mediaHint) {
    value.dataset.mediaHint = '1';
    value.title = '支持图片 JPG / PNG / WebP 与视频 MP4 / WebM / MOV 上传';
  }
  var label = value && value.closest ? value.closest('.fx-color-row-label') : null;
  if (label && !document.getElementById('bg-media-hint')) {
    var hint = document.createElement('small');
    hint.id = 'bg-media-hint';
    hint.textContent = '支持图片 / 视频上传';
    label.appendChild(hint);
  }
}
function relabelFxPanelControls() {
  var title = document.querySelector('#fx-panel .fx-title');
  if (title) title.textContent = '视觉控制台';
  ensureLyricPrimaryControls();
  applyBackgroundMediaHint();
  var overlayGrid = document.getElementById('t-cinema');
  overlayGrid = overlayGrid && overlayGrid.closest('.fx-toggle-grid');
  setFxSectionBeforeNode(overlayGrid, '镜头与叠加');
  setFxSectionBefore('preset-grid', '预设与存档');
  setFxSectionBefore('user-archive-grid', '用户存档');
  setFxSectionBefore('ui-accent-picker', '界面与背景');
  setFxSectionBefore('fx-intensity', '画面基础');
  setFxSectionBefore('fx-lyricglow', '歌词溢光强度');
  setFxSectionBefore('lyric-color-grid', '文字颜色');
  setFxSectionBefore('lyric-highlight-picker', '跟唱高亮');
  setFxSectionBefore('lyric-glow-row', '歌词溢光颜色');
  setFxSectionBefore('lyric-source-seg', '歌词来源');
  setFxSectionBefore('lyric-font-grid', '字体与字距');
  setFxSectionBefore('fx-lyricscale', '位置与角度');
  setFxSectionBefore('fx-desktoplyricssize', '桌面歌词');
  setFxSectionBefore('desktop-lyrics-fps-seg', '桌面歌词帧率');
  setFxSectionBefore('shelf-seg', '3D 歌单架');
  setFxSectionBefore('shelf-camera-seg', '歌单架镜头');
  setFxSectionBefore('shelf-presence-seg', '歌单架显示');
  setFxSectionBefore('shelf-accent-picker', '歌单架外观');
  setFxSectionBefore('fx-shelfsize', '歌单架参数');
  setFxSectionBefore('cam-seg', '摄像头交互');
  setFxSectionBefore('fx-point', '粒子高级参数');
  setFxSliderLabel('fx-intensity', '律动强度');
  setFxSliderLabel('fx-depth', '画面景深');
  setFxSliderLabel('fx-coverres', '封面清晰度');
  setFxSliderLabel('fx-cineshake', '电影镜头');
  setFxSliderLabel('fx-lyricglow', '溢光强度');
  setFxSliderLabel('fx-bgopacity', '背景透明度');
  setFxSliderLabel('fx-glassaberration', '玻璃色差');
  setFxSliderLabel('fx-lyricspacing', '字间距');
  setFxSliderLabel('fx-lyriclineheight', '行距');
  setFxSliderLabel('fx-lyricweight', '字重');
  setFxSliderLabel('fx-lyricscale', '歌词大小');
  setFxSliderLabel('fx-lyricx', '左右位置');
  setFxSliderLabel('fx-lyricy', '上下位置');
  setFxSliderLabel('fx-lyricz', '前后景深');
  setFxSliderLabel('fx-lyrictiltx', '上下旋转');
  setFxSliderLabel('fx-lyrictilty', '左右旋转');
  setFxSliderLabel('fx-desktoplyricssize', '桌面歌词大小');
  setFxSliderLabel('fx-desktoplyricsopacity', '桌面歌词透明度');
  setFxSliderLabel('fx-desktoplyricsy', '桌面歌词高度');
  setFxSliderLabel('fx-wallpaperopacity', '壁纸透明度');
  setFxSliderLabel('fx-shelfsize', '歌单架大小');
  setFxSliderLabel('fx-shelfx', '左右位置');
  setFxSliderLabel('fx-shelfy', '上下位置');
  setFxSliderLabel('fx-shelfz', '前后景深');
  setFxSliderLabel('fx-shelfangle', '侧向角度');
  setFxSliderLabel('fx-shelfopacity', '整体透明度');
  setFxSliderLabel('fx-shelfbgalpha', '背景透明度');
  setFxSliderLabel('fx-point', '粒子尺寸');
  setFxSliderLabel('fx-speed', '运动速度');
  setFxSliderLabel('fx-twist', '粒子扭曲');
  setFxSliderLabel('fx-color', '色彩张力');
  setFxSliderLabel('fx-bloom', '光晕强度');
  setFxSliderLabel('fx-scatter', '离散感');
  setFxSliderLabel('fx-bgfade', '背景压暗');
}

function getHotkeyDefaults() {
  var defaults = { local: {}, global: {} };
  HOTKEY_ACTIONS.forEach(function(action){
    defaults.local[action.key] = action.local || '';
    defaults.global[action.key] = action.global || '';
  });
  return defaults;
}
function readHotkeySettings() {
  var defaults = getHotkeyDefaults();
  try {
    var raw = JSON.parse(localStorage.getItem(HOTKEY_SETTINGS_STORE_KEY) || '{}') || {};
    return {
      local: Object.assign({}, defaults.local, raw.local || {}),
      global: Object.assign({}, defaults.global, raw.global || {})
    };
  } catch (e) {
    return defaults;
  }
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
function bindFxPanel() {
  liftFxFloatingPopups();
  organizeFxPanel();
  relabelFxPanelControls();
  bindHotkeySettings();
  buildPresetGrid();
  renderUserFxArchives();
  buildLyricColorControls();
  var ids = [
    ['fx-intensity','intensity'],['fx-depth','depth'],['fx-coverres','coverResolution'],['fx-cineshake','cinemaShake'],['fx-lyricglow','lyricGlowStrength'],['fx-bgopacity','backgroundOpacity'],['fx-glassaberration','controlGlassChromaticOffset'],
    ['fx-desktoplyricssize','desktopLyricsSize'],['fx-desktoplyricsopacity','desktopLyricsOpacity'],['fx-desktoplyricsy','desktopLyricsY'],['fx-wallpaperopacity','wallpaperOpacity'],
    ['fx-shelfsize','shelfSize'],['fx-shelfx','shelfOffsetX'],['fx-shelfy','shelfOffsetY'],['fx-shelfz','shelfOffsetZ'],['fx-shelfangle','shelfAngleY'],['fx-shelfopacity','shelfOpacity'],['fx-shelfbgalpha','shelfBgOpacity'],
    ['fx-lyricspacing','lyricLetterSpacing'],['fx-lyriclineheight','lyricLineHeight'],['fx-lyricweight','lyricWeight'],
    ['fx-lyriccustomlines','lyricCustomLineCount'],
    ['fx-lyriccontextopacity','lyricContextOpacity'],['fx-lyriccontextspread','lyricContextSpread'],
    ['fx-lyrictranslationgap','lyricTranslationGap'],['fx-lyrictranslationscale','lyricTranslationScale'],['fx-lyrictranslationopacity','lyricTranslationOpacity'],
    ['fx-lyricedgefade','lyricEdgeFade'],['fx-lyricmotionsoftness','lyricMotionSoftness'],
    ['fx-lyricglitchintensity','lyricGlitchIntensity'],['fx-lyricglitchslice','lyricGlitchSlice'],['fx-lyricglitchchroma','lyricGlitchChroma'],['fx-lyricglitchrate','lyricGlitchRate'],['fx-lyricglitchjitter','lyricGlitchJitter'],
    ['fx-lyricscale','lyricScale'],['fx-lyricx','lyricOffsetX'],['fx-lyricy','lyricOffsetY'],['fx-lyricz','lyricOffsetZ'],['fx-lyrictiltx','lyricTiltX'],['fx-lyrictilty','lyricTiltY'],
    ['fx-point','point'],['fx-speed','speed'],['fx-twist','twist'],
    ['fx-lyricbgadapt','lyricBackgroundAdapt'],
    ['fx-color','color'],['fx-bloom','bloomStrength'],['fx-scatter','scatter'],['fx-bgfade','bgFade'],
  ];
  ids.forEach(function(pair){
    var el = document.getElementById(pair[0]);
    if (!el) return;
    ensureFxSliderResetButton(pair[0], pair[1]);
    el.addEventListener('input', function(){
      fx[pair[1]] = parseFloat(el.value);
      var out = el.parentElement.querySelector('output');
      if (pair[1] === 'coverResolution') {
        fx.coverResolution = normalizeCoverResolution(fx.coverResolution);
        applyCoverParticleResolution(fx.coverResolution, { reload: true });
      }
      if (pair[1] === 'lyricWeight') fx.lyricWeight = Math.round(clampRange(fx.lyricWeight, 500, 900) / 50) * 50;
      // 译文三个滑块：就地更新已有译文子节点，避免重建网格（拖动手感）
      if (pair[1] === 'lyricTranslationGap' || pair[1] === 'lyricTranslationScale' || pair[1] === 'lyricTranslationOpacity') {
        applyLyricTranslationStyle();
      }
      if (pair[1] === 'backgroundOpacity') {
        fx.backgroundOpacity = clampRange(fx.backgroundOpacity, 0, 1);
        fx.backgroundColorMode = 'custom';
        fx.backgroundColorCustom = true;
        updateCustomBackgroundControls();
      }
      if (pair[1] === 'controlGlassChromaticOffset') {
        fx.controlGlassChromaticOffset = normalizeControlGlassChromaticOffset(fx.controlGlassChromaticOffset);
        applyControlGlassChromaticOffset();
      }
      if (pair[1] === 'desktopLyricsSize') fx.desktopLyricsSize = clampRange(fx.desktopLyricsSize, 0.72, 1.55);
      // 亮底避光：0~1，拖动时实时刷新各行可读性衬底（下一帧 tick 重算，无需重建网格）
      if (pair[1] === 'lyricBackgroundAdapt') fx.lyricBackgroundAdapt = clampRange(fx.lyricBackgroundAdapt, 0, 1);
      if (pair[1] === 'desktopLyricsOpacity') fx.desktopLyricsOpacity = clampRange(fx.desktopLyricsOpacity, 0.28, 1);
      if (pair[1] === 'desktopLyricsY') fx.desktopLyricsY = clampRange(fx.desktopLyricsY, 0.08, 0.92);
      if (pair[1] === 'wallpaperOpacity') fx.wallpaperOpacity = clampRange(fx.wallpaperOpacity, 0.35, 1);
      if (pair[1] === 'shelfSize') fx.shelfSize = clampRange(fx.shelfSize, 0.65, 1.45);
      if (pair[1] === 'shelfOffsetX') fx.shelfOffsetX = clampRange(fx.shelfOffsetX, -1.2, 1.2);
      if (pair[1] === 'shelfOffsetY') fx.shelfOffsetY = clampRange(fx.shelfOffsetY, -0.9, 0.9);
      if (pair[1] === 'shelfOffsetZ') fx.shelfOffsetZ = clampRange(fx.shelfOffsetZ, -0.9, 0.9);
      if (pair[1] === 'shelfAngleY') {
        fx.shelfAngleYManual = true;
        fx.shelfAngleY = Math.round(clampRange(fx.shelfAngleY, -30, 30));
      }
      if (pair[1] === 'shelfOpacity') fx.shelfOpacity = clampRange(fx.shelfOpacity, 0.25, 1);
      if (pair[1] === 'shelfBgOpacity') fx.shelfBgOpacity = clampRange(fx.shelfBgOpacity, 0.25, 0.98);
      if (pair[1] === 'lyricTiltX' || pair[1] === 'lyricTiltY') fx[pair[1]] = Math.round(clampRange(fx[pair[1]], -42, 42));
      if (pair[1] === 'lyricCustomLineCount') {
        fx.lyricCustomLineCount = clampRange(Math.round(fx.lyricCustomLineCount), 1, 10);
        refreshStageLyricDisplayMode();
      }
      if (pair[1] === 'lyricEdgeFade') refreshAllLyricLineFonts();
      if (out) out.textContent = pair[1] === 'coverResolution'
        ? coverParticleCountLabel(fx.coverResolution)
        : (pair[1] === 'lyricWeight' || pair[1] === 'controlGlassChromaticOffset' || pair[1] === 'lyricTiltX' || pair[1] === 'lyricTiltY' || pair[1] === 'shelfAngleY' || pair[1] === 'lyricCustomLineCount' ? String(Math.round(fx[pair[1]])) : Number(el.value).toFixed(pair[1] === 'lyricLetterSpacing' ? 3 : 2));
      syncFxUniforms();
      if (/^shelf(Size|OffsetX|OffsetY|OffsetZ|AngleY|Opacity|BgOpacity)$/.test(pair[1]) && shelfManager && shelfManager.refreshTheme) shelfManager.refreshTheme();
      if (pair[1] === 'lyricLetterSpacing' || pair[1] === 'lyricLineHeight' || pair[1] === 'lyricWeight') refreshAllLyricLineFonts();
      if (pair[1] === 'lyricLetterSpacing' || pair[1] === 'lyricLineHeight' || pair[1] === 'lyricWeight' || pair[1] === 'lyricScale' || pair[1] === 'lyricGlowStrength') pushDesktopLyricsState(true);
      if (/^(desktopLyricsSize|desktopLyricsOpacity|desktopLyricsY)$/.test(pair[1])) pushDesktopLyricsState(true);
      if (pair[1] === 'wallpaperOpacity') pushWallpaperState(true);
      saveLyricLayout();
    });
  });
  var lyricPicker = document.getElementById('lyric-color-picker');
  if (lyricPicker) {
    lyricPicker.addEventListener('input', function(){ setLyricColorCustom(lyricPicker.value, true); });
    lyricPicker.addEventListener('change', function(){ showToast('歌词颜色: ' + normalizeHexColor(lyricPicker.value).toUpperCase()); });
  }
  var lyricHighlightPicker = document.getElementById('lyric-highlight-picker');
  if (lyricHighlightPicker) {
    lyricHighlightPicker.addEventListener('input', function(){ setLyricHighlightCustom(lyricHighlightPicker.value, true); });
    lyricHighlightPicker.addEventListener('change', function(){ showToast('高亮颜色: ' + normalizeHexColor(lyricHighlightPicker.value).toUpperCase()); });
  }
  var lyricGlowPicker = document.getElementById('lyric-glow-picker');
  if (lyricGlowPicker) {
    lyricGlowPicker.addEventListener('input', function(){ setLyricGlowCustom(lyricGlowPicker.value, true); });
    lyricGlowPicker.addEventListener('change', function(){ showToast('溢光颜色: ' + normalizeHexColor(lyricGlowPicker.value).toUpperCase()); });
  }
  var uiAccentPicker = document.getElementById('ui-accent-picker');
  if (uiAccentPicker) {
    uiAccentPicker.addEventListener('input', function(){ setUiAccentColor(uiAccentPicker.value, true); });
    uiAccentPicker.addEventListener('change', function(){ showToast('界面高亮: ' + normalizeHexColor(uiAccentPicker.value, '#00f5d4').toUpperCase()); });
  }
  var visualTintPicker = document.getElementById('visual-tint-picker');
  if (visualTintPicker) {
    visualTintPicker.addEventListener('input', function(){ setVisualTintCustom(visualTintPicker.value, true); });
    visualTintPicker.addEventListener('change', function(){ showToast('视觉主色: ' + normalizeHexColor(visualTintPicker.value).toUpperCase()); });
  }
  var homeAccentPicker = document.getElementById('home-accent-picker');
  if (homeAccentPicker) {
    homeAccentPicker.addEventListener('input', function(){ setHomeAccentColor(homeAccentPicker.value, true); });
    homeAccentPicker.addEventListener('change', function(){ showToast('Home 填充: ' + normalizeHexColor(homeAccentPicker.value).toUpperCase()); });
  }
  var homeIconPicker = document.getElementById('home-icon-picker');
  if (homeIconPicker) {
    homeIconPicker.addEventListener('input', function(){ setHomeIconColor(homeIconPicker.value, true); });
    homeIconPicker.addEventListener('change', function(){ showToast('主页图标: ' + normalizeHexColor(homeIconPicker.value, '#f4d28a').toUpperCase()); });
  }
  var visualIconPicker = document.getElementById('visual-icon-picker');
  if (visualIconPicker) {
    visualIconPicker.addEventListener('input', function(){ setVisualIconColor(visualIconPicker.value, true); });
    visualIconPicker.addEventListener('change', function(){ showToast('视觉图标: ' + normalizeHexColor(visualIconPicker.value, '#7fd8ff').toUpperCase()); });
  }
  var bgColorPicker = document.getElementById('bg-color-picker');
  if (bgColorPicker) {
    bgColorPicker.addEventListener('input', function(){ setCustomBackgroundColor(bgColorPicker.value, true); });
    bgColorPicker.addEventListener('change', function(){ showToast('背景颜色: ' + normalizeHexColor(bgColorPicker.value, '#000000').toUpperCase()); });
  }
  var shelfAccentPicker = document.getElementById('shelf-accent-picker');
  if (shelfAccentPicker) {
    shelfAccentPicker.addEventListener('input', function(){ setShelfAccentColor(shelfAccentPicker.value, true); });
    shelfAccentPicker.addEventListener('change', function(){ showToast('歌单架颜色: ' + shelfAccentHex().toUpperCase()); });
  }
  var bgImageInput = document.getElementById('background-image-input');
  if (bgImageInput) {
    bgImageInput.addEventListener('change', function(e){
      var file = e.target.files && e.target.files[0];
      if (file) readBackgroundMediaFile(file);
      e.target.value = '';
    });
  }
  ['ui-accent-picker','visual-tint-picker','home-accent-picker','home-icon-picker','visual-icon-picker','bg-color-picker','shelf-accent-picker','lyric-color-picker','lyric-highlight-picker','lyric-glow-picker'].forEach(function(id){
    bindColorLabPicker(document.getElementById(id));
  });
  bindColorLabRows();
  var sv = document.getElementById('color-lab-sv');
  if (sv && !sv._bound) {
    sv._bound = true;
    sv.addEventListener('pointerdown', function(e){
      e.preventDefault();
      colorLabState.dragging = true;
      sv.setPointerCapture && sv.setPointerCapture(e.pointerId);
      updateColorLabFromSv(e);
    });
    sv.addEventListener('pointermove', function(e){ if (colorLabState.dragging) updateColorLabFromSv(e); });
    sv.addEventListener('pointerup', function(){ colorLabState.dragging = false; });
    sv.addEventListener('pointercancel', function(){ colorLabState.dragging = false; });
  }
  var hue = document.getElementById('color-lab-hue');
  if (hue && !hue._bound) {
    hue._bound = true;
    hue.addEventListener('input', function(){
      colorLabState.h = clampRange(Number(hue.value) || 0, 0, 360) / 360;
      var hex = hsvToHex(colorLabState.h, colorLabState.s, colorLabState.v);
      syncColorLabUi(hex);
      applyColorLabValue(hex, true);
    });
  }
  var hexInput = document.getElementById('color-lab-hex');
  if (hexInput && !hexInput._bound) {
    hexInput._bound = true;
    hexInput.addEventListener('change', function(){
      var hex = normalizeHexColor(hexInput.value || '#000000', '#000000');
      syncColorLabUi(hex);
      applyColorLabValue(hex);
    });
  }
  var presets = document.getElementById('color-lab-presets');
  if (presets && !presets._bound) {
    presets._bound = true;
    presets.addEventListener('click', function(e){
      var btn = e.target && e.target.closest ? e.target.closest('[data-color]') : null;
      if (!btn) return;
      var hex = normalizeHexColor(btn.getAttribute('data-color') || '#000000', '#000000');
      syncColorLabUi(hex);
      applyColorLabValue(hex);
    });
  }
  if (!document._colorLabOutsideBound) {
    document._colorLabOutsideBound = true;
    document.addEventListener('mousedown', function(e){
      var pop = document.getElementById('color-lab-pop');
      if (!pop || !pop.classList.contains('show')) return;
      if (e.target && (e.target.closest('#color-lab-pop') || e.target.closest('.lyric-color-picker') || e.target.closest('.lyric-color-row'))) return;
      closeColorLab();
    }, true);
    document.addEventListener('mousedown', function(e){
      var pop = document.getElementById('cover-color-pop');
      if (!pop || !pop.classList.contains('show')) return;
      if (e.target && (e.target.closest('#cover-color-pop') || e.target.closest('#visual-tint-auto-btn'))) return;
      closeCoverColorPicker();
    }, true);
  }
  // 三态
  document.querySelectorAll('#shelf-seg button').forEach(function(b){
    b.addEventListener('click', function(){ setShelfMode(b.dataset.shelf); });
  });
  document.querySelectorAll('#shelf-camera-seg [data-shelf-camera]').forEach(function(b){
    b.addEventListener('click', function(){ setShelfCameraMode(b.getAttribute('data-shelf-camera')); });
  });
  document.querySelectorAll('#shelf-presence-seg [data-shelf-presence]').forEach(function(b){
    b.addEventListener('click', function(){ setShelfPresence(b.getAttribute('data-shelf-presence')); });
  });
  document.querySelectorAll('#cam-seg button').forEach(function(b){
    b.addEventListener('click', function(){ setCamMode(b.dataset.cam); });
  });
  document.querySelectorAll('#desktop-lyrics-fps-seg [data-desktop-lyrics-fps]').forEach(function(btn){
    btn.addEventListener('click', function(){
      fx.desktopLyricsFps = normalizeDesktopLyricsFps(btn.getAttribute('data-desktop-lyrics-fps'));
      updateDesktopLyricsFpsControls();
      saveLyricLayout();
      pushDesktopLyricsState(true);
      showToast(fx.desktopLyricsFps ? ('桌面歌词帧数 ' + fx.desktopLyricsFps) : '桌面歌词帧数无上限');
    });
  });
  document.querySelectorAll('#performance-background-seg [data-performance-background]').forEach(function(btn){
    btn.addEventListener('click', function(){
      setPerformanceBackgroundMode(btn.getAttribute('data-performance-background'));
    });
  });
  document.querySelectorAll('#performance-quality-seg [data-performance-quality]').forEach(function(btn){
    btn.addEventListener('click', function(){
      setPerformanceQualityMode(btn.getAttribute('data-performance-quality'));
    });
  });
  document.querySelectorAll('#foreground-fps-seg [data-foreground-fps]').forEach(function(btn){
    btn.addEventListener('click', function(){
      setForegroundFpsMode(btn.getAttribute('data-foreground-fps'));
    });
  });
  document.querySelectorAll('#lyric-texture-quality-seg [data-lyric-texture-clarity]').forEach(function(btn){
    btn.addEventListener('click', function(){
      setLyricTextureClarity(Number(btn.getAttribute('data-lyric-texture-clarity')));
    });
  });
  bindSystemMemoryControls();
  refreshAudioOutputDevices();
  refreshCacheStoragePanel();
  updateFxInputs();
}
function toggleFx(key) {
  if (isDevelopmentLockedFx(key)) {
    normalizeDevelopmentLockedFxState();
    saveLyricLayout();
    updateFxInputs();
    applyDesktopLyricsState(true);
    applyWallpaperModeState(true);
    showToast('开发中，暂不可用');
    return;
  }
  fx[key] = !fx[key];
  var toggleId = 't-' + (key === 'floatLayer' ? 'float' : key === 'aiDepth' ? 'aidepth' : key);
  var toggle = document.getElementById(toggleId);
  if (toggle) toggle.classList.toggle('on', fx[key]);
  syncFxUniforms();
  if (key === 'lyricCameraLock' || key === 'lyricGlow' || key === 'lyricGlowBeat' || key === 'lyricGlowParticles' || key === 'bloom' || key === 'edge' || key === 'cinema' || key === 'desktopLyrics' || key === 'desktopLyricsClickThrough' || key === 'desktopLyricsCinema' || key === 'desktopLyricsHighlight' || key === 'wallpaperMode' || key === 'shelfShowPodcasts' || key === 'shelfMergeCollections' || key === 'liveBackgroundKeep' || key === 'memoryAutoTrimApp' || key === 'memoryAutoTrimOnBackground' || key === 'memoryAutoSystemTrim' || key === 'memorySystemAutoElevate' || key === 'lyricPauseHold' || key === 'lyricVerticalFloat' || key === 'lyricGlitchCameraBind' || key === 'backgroundStarRiver' || key === 'lyricLiveViewportFit' || key === 'lyricContextHighQuality' || key === 'lyricBackdropAdapt' || key === 'coverBackdropAdapt') saveLyricLayout();
  if (key === 'floatLayer') { if (fx.floatLayer) createFloatLayer(); else destroyFloatLayer(); }
  if (key === 'desktopLyrics') applyDesktopLyricsState(true);
  if (key === 'desktopLyricsClickThrough' || key === 'desktopLyricsCinema' || key === 'desktopLyricsHighlight') pushDesktopLyricsState(true);
  if (key === 'lyricGlow' || key === 'lyricGlowBeat' || key === 'lyricGlowParticles') pushDesktopLyricsState(true);
  if (key === 'wallpaperMode') applyWallpaperModeState(true);
  if (key === 'shelfShowPodcasts' || key === 'shelfMergeCollections') {
    if (shelfManager && shelfManager.rebuild) shelfManager.rebuild(true);
    if (shelfManager && shelfManager.refreshTheme) shelfManager.refreshTheme();
  }
  if (key === 'liveBackgroundKeep') {
    fx.performanceBackground = fx.liveBackgroundKeep ? 'keep' : 'auto';
    updatePerformanceControls();
    saveLyricLayout();
    if (fx.liveBackgroundKeep && backgroundCacheTrimTimer) {
      clearTimeout(backgroundCacheTrimTimer);
      backgroundCacheTrimTimer = 0;
    }
    updateRenderPowerClasses();
    applyRendererPowerMode();
    if (fx.liveBackgroundKeep) recoverVisualsAfterBackground('live-background-keep');
  }
  if (key === 'memoryAutoTrimApp') showToast(fx.memoryAutoTrimApp !== false ? '自动压缩播放器已开启' : '自动压缩播放器已关闭');
  if (key === 'memoryAutoTrimOnBackground') showToast(fx.memoryAutoTrimOnBackground !== false ? '仅后台触发压缩' : '后台压缩触发已关闭');
  if (key === 'memoryAutoSystemTrim') {
    updateMemoryControls();
    configureMemoryReductFromFx('toggle', false);
    showToast(fx.memoryAutoSystemTrim === true ? '系统级定时释放已开启' : '系统级定时释放已关闭');
  }
  if (key === 'memorySystemAutoElevate') {
    updateMemoryControls();
    configureMemoryReductFromFx('toggle', false);
    showToast(fx.memorySystemAutoElevate === true ? '需要时将请求管理员权限' : '不再自动请求管理员权限');
  }
  if (key === 'lyricGlow') showToast(fx.lyricGlow ? '歌词溢光已开启' : '歌词溢光已关闭');
  if (key === 'lyricGlowBeat') showToast(fx.lyricGlowBeat ? '歌词溢光跟随鼓点' : '歌词溢光已脱离鼓点');
  if (key === 'lyricGlowParticles') showToast(fx.lyricGlowParticles ? '歌词光粒已开启' : '歌词光粒已关闭');
  if (key === 'desktopLyrics') showToast(fx.desktopLyrics ? '桌面歌词已开启' : '桌面歌词已关闭');
  if (key === 'desktopLyricsClickThrough') showToast(fx.desktopLyricsClickThrough !== false ? '桌面歌词已锁定' : '桌面歌词可移动');
  if (key === 'desktopLyricsCinema') showToast(fx.desktopLyricsCinema !== false ? '桌面歌词电影震动已开启' : '桌面歌词电影震动已关闭，基础漂浮保留');
  if (key === 'desktopLyricsHighlight') showToast(fx.desktopLyricsHighlight === true ? '桌面歌词高亮跟随已开启' : '桌面歌词高亮跟随已关闭');
  if (key === 'wallpaperMode') showToast(fx.wallpaperMode ? '壁纸模式已开启' : '壁纸模式已关闭');
  if (key === 'shelfShowPodcasts') showToast(fx.shelfShowPodcasts !== false ? '3D歌单架已显示播客歌单' : '3D歌单架已隐藏播客歌单');
  if (key === 'shelfMergeCollections') showToast(fx.shelfMergeCollections === true ? '我的歌单与收藏歌单已合并滚动' : '收藏歌单恢复滚到底切页');
  if (key === 'liveBackgroundKeep') showToast(fx.liveBackgroundKeep ? '直播后台保持已开启' : '直播后台保持已关闭');
  if (key === 'lyricCameraLock') showToast(fx.lyricCameraLock ? '歌词已绑定镜头' : '歌词已恢复自由漂浮');
  if (key === 'lyricPauseHold') showToast(fx.lyricPauseHold !== false ? '暂停时保留歌词' : '暂停时隐藏歌词');
  if (key === 'lyricVerticalFloat') showToast(fx.lyricVerticalFloat !== false ? '歌词上下浮动已开启' : '歌词上下浮动已关闭');
  if (key === 'backgroundStarRiver') {
    // 对齐上游：切换瞬间立即把 alpha 跳到目标值（不渐变），视觉反馈更直接
    if (typeof updateBackgroundStarRiverState === 'function') updateBackgroundStarRiverState(0.016, true);
    showToast(fx.backgroundStarRiver !== false ? '背景星河已开启' : '背景星河已关闭');
  }
  if (key === 'lyricLiveViewportFit') showToast(fx.lyricLiveViewportFit !== false ? '歌词实时边界已开启' : '歌词实时边界已关闭');
  if (key === 'lyricContextHighQuality') {
    // 上下句纹理倍率变化：重建已有歌词行纹理（当前行用满倍率，上下句按开关回落）
    refreshAllLyricLineFonts();
    showToast(fx.lyricContextHighQuality !== false ? '上下句高清纹理已开启' : '上下句高清纹理已关闭（省显存）');
  }
  if (key === 'lyricBackdropAdapt') showToast(fx.lyricBackdropAdapt !== false ? '全局歌词避光已开启' : '全局歌词避光已关闭');
  if (key === 'coverBackdropAdapt') showToast(fx.coverBackdropAdapt !== false ? '封面粒子避光已开启' : '封面粒子避光已关闭');
  if (key === 'lyricGlitchCameraBind') {
    var glitchBindBtn = document.getElementById('lyric-glitch-camera-bind');
    if (glitchBindBtn) glitchBindBtn.classList.toggle('active', !!fx.lyricGlitchCameraBind);
    showToast(fx.lyricGlitchCameraBind ? '故障跟随鼓点已开启' : '故障跟随鼓点已关闭');
  }
  if (key === 'bloom') showToast(fx.bloom ? '溢光已开启' : '溢光已关闭');
  if (key === 'edge') showToast(fx.edge ? '已开启轮廓高亮' : '已关闭轮廓高亮');
  if (key === 'cinema') showToast(fx.cinema ? '已开启电影镜头' : '已关闭电影镜头');
  if (key === 'aiDepth') {
    if (fx.aiDepth) {
      aiDepthFailUntil = 0;
      queueAIDepthForCurrentCover(true);
    }
    showToast(fx.aiDepth ? '已开启后台 AI 立体增强' : '已关闭 AI 立体增强, 使用轻量弧面');
  }
}
// ---- 系统设置：关闭行为 ----
var systemSettings = { behavior: 'ask', remember: false };
function setCloseBehavior(behavior) {
  systemSettings.behavior = behavior;
  document.querySelectorAll('#close-behavior-seg button').forEach(function(btn) {
    btn.classList.toggle('active', btn.getAttribute('data-close-behavior') === behavior);
  });
  if (typeof window.desktopWindow !== 'undefined' && window.desktopWindow.saveSystemSettings) {
    window.desktopWindow.saveSystemSettings(systemSettings);
  }
  showToast('关闭行为: ' + (behavior === 'ask' ? '每次询问' : behavior === 'minimize' ? '最小化到托盘' : '直接退出'));
}
function toggleRememberClose() {
  systemSettings.remember = !systemSettings.remember;
  var toggle = document.getElementById('t-rememberClose');
  if (toggle) toggle.classList.toggle('on', systemSettings.remember);
  if (typeof window.desktopWindow !== 'undefined' && window.desktopWindow.saveSystemSettings) {
    window.desktopWindow.saveSystemSettings(systemSettings);
  }
  showToast(systemSettings.remember ? '已记住关闭选择' : '取消记住关闭选择');
}
function applySystemSettingsUI() {
  if (typeof window.desktopWindow !== 'undefined' && window.desktopWindow.getSystemSettings) {
    window.desktopWindow.getSystemSettings().then(function(settings) {
      if (settings) {
        systemSettings.behavior = settings.behavior || 'ask';
        systemSettings.remember = settings.remember === true;
      }
      syncSystemSettingsUI();
    });
  } else {
    syncSystemSettingsUI();
  }
}
function syncSystemSettingsUI() {
  document.querySelectorAll('#close-behavior-seg button').forEach(function(btn) {
    btn.classList.toggle('active', btn.getAttribute('data-close-behavior') === systemSettings.behavior);
  });
  var rememberToggle = document.getElementById('t-rememberClose');
  if (rememberToggle) rememberToggle.classList.toggle('on', systemSettings.remember);
}
/* ============================================================
 *  第三方音源设置
 * ============================================================ */
var _musicSourcesConfig = null;
var _musicSourcesLoaded = false;

/**
 * 加载音源配置
 */
async function loadMusicSourcesConfig() {
  try {
    var resp = await fetch('/api/parse/config');
    if (resp.ok) {
      _musicSourcesConfig = await resp.json();
      _musicSourcesLoaded = true;
      syncMusicSourcesUI();
    }
  } catch (e) {
    console.warn('[MusicSources] 加载配置失败:', e);
  }
}

// 启动时无条件加载一次音源配置。
// 此前该调用只挂在 applyFxArchiveSnapshot（手动「应用存档」）路径上，
// 正常启动永远不执行 → _musicSourcesConfig 为 null → 所有音源开关点击静默失效、状态全灰。
loadMusicSourcesConfig();

/**
 * 保存音源配置到服务端
 */
async function saveMusicSourcesConfigToServer() {
  if (!_musicSourcesConfig) return;
  try {
    await fetch('/api/parse/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(_musicSourcesConfig)
    });
  } catch (e) {
    console.warn('[MusicSources] 保存配置失败:', e);
  }
}

/**
 * 同步音源设置 UI
 */
function syncMusicSourcesUI() {
  if (!_musicSourcesConfig) return;
  var enabled = _musicSourcesConfig.enabledSources || [];
  ['gdmusic', 'goMusic', 'kugou', 'lxMusic', 'unblockMusic', 'custom'].forEach(function (src) {
    var el = document.getElementById('t-src-' + src);
    if (el) el.classList.toggle('on', enabled.includes(src));
  });
  // LX Music 脚本状态
  var scripts = _musicSourcesConfig.lxMusicScripts || [];
  var activeId = _musicSourcesConfig.activeLxMusicApiId;
  var statusEl = document.getElementById('lx-script-status');
  if (statusEl) {
    if (scripts.length > 0) {
      var active = scripts.find(function (s) { return s.id === activeId; });
      statusEl.textContent = active ? '已加载: ' + active.name : scripts.length + ' 个脚本';
    } else {
      statusEl.textContent = '未加载';
    }
  }
  var listEl = document.getElementById('lx-scripts-list');
  if (listEl) {
    if (scripts.length > 0) {
      listEl.innerHTML = scripts.map(function (s) {
        var isActive = s.id === activeId;
        return '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">' +
          '<span style="flex:1;' + (isActive ? 'color:var(--c-accent,#7cf);' : '') + '">' +
          (isActive ? '● ' : '') + escHtml(s.name) + '</span>' +
          '<button class="fx-mini-btn" style="font-size:10px;padding:2px 6px;" onclick="activateLxScript(\'' + s.id + '\')">激活</button>' +
          '<button class="fx-mini-btn" style="font-size:10px;padding:2px 6px;color:#f66;" onclick="deleteLxScript(\'' + s.id + '\')">删除</button>' +
          '</div>';
      }).join('');
    } else {
      // 无脚本时留空：「未加载」已由上方 #lx-script-status 表达，不重复一遍「暂无脚本」
      listEl.innerHTML = '';
    }
  }
  // 注：自定义 API 地址 / go-music-api 服务地址的输入框与对应配置项
  //     （customApiUrl / customApiMethod / goMusicApiUrl）已于 2026-09-23 全部移除，
  //     这里不再回填。go-music-api 的服务地址现在只看环境变量 GO_MUSIC_API_URL。
  // 配置块跟随开关折叠（目前只剩 LX 脚本块）
  syncSourceConfigVisibility();
  // 「音源解析顺序」随官方源会员态显隐（非会员三档等价，整块隐藏）
  syncSourceParseOrderVisibility();
  // 酷狗登录文案依赖 kugou 是否启用：开关一变就重算
  if (typeof updateKugouLoginStatusText === 'function') updateKugouLoginStatusText();
}

/**
 * 配置区跟随音源开关折叠：只有启用对应音源时才展开它的配置块。
 * 之前三块（LX 脚本 / 自定义 API 地址 / go-music-api 地址）无条件展开，开关全关时面板
 * 仍是一整屏配置项 —— 既冗余，又容易让人误以为「填了地址就等于启用了」。
 * 2026-09-23：自定义 API 地址块与 go-music-api 地址块已从面板移除，map 只剩 LX 脚本。
 */
function syncSourceConfigVisibility() {
  if (!_musicSourcesConfig) return;
  var enabled = _musicSourcesConfig.enabledSources || [];
  var map = { lxMusic: 'lx-script-block' };
  Object.keys(map).forEach(function (src) {
    var el = document.getElementById(map[src]);
    if (el) el.style.display = enabled.indexOf(src) >= 0 ? '' : 'none';
  });
}

/**
 * 切换音源启用状态
 */
function toggleMusicSource(source) {
  if (!_musicSourcesConfig) {
    showToast('音源配置尚未加载完成，请稍后再试');
    return;
  }
  var enabled = _musicSourcesConfig.enabledSources || [];
  var idx = enabled.indexOf(source);
  if (idx >= 0) {
    enabled.splice(idx, 1);
  } else {
    enabled.push(source);
  }
  _musicSourcesConfig.enabledSources = enabled;
  syncMusicSourcesUI();
  saveMusicSourcesConfigToServer();
}

/**
 * 上传 LX Music 脚本
 */
function uploadLxMusicScript() {
  var input = document.getElementById('lx-script-file-input');
  if (input) input.click();
}

/**
 * 处理 LX Music 脚本文件上传
 */
async function handleLxScriptUpload(event) {
  var file = event.target.files[0];
  if (!file) return;
  try {
    var text = await file.text();
    var resp = await fetch('/api/parse/lx/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: file.name.replace(/\.(js|txt)$/, ''), script: text })
    });
    var result = await resp.json();
    if (result.success) {
      showToast('脚本上传成功: ' + (result.sources || []).join(', '));
      await loadMusicSourcesConfig();
    } else {
      showToast('脚本上传失败: ' + (result.error || '未知错误'));
    }
  } catch (e) {
    showToast('脚本上传失败: ' + e.message);
  }
  event.target.value = '';
}

/**
 * 激活 LX Music 脚本
 */
async function activateLxScript(scriptId) {
  if (!_musicSourcesConfig) return;
  _musicSourcesConfig.activeLxMusicApiId = scriptId;
  syncMusicSourcesUI();
  await saveMusicSourcesConfigToServer();
  showToast('已切换脚本');
}

/**
 * 删除 LX Music 脚本
 */
async function deleteLxScript(scriptId) {
  try {
    await fetch('/api/parse/lx/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: scriptId })
    });
    await loadMusicSourcesConfig();
    showToast('脚本已删除');
  } catch (e) {
    showToast('删除失败: ' + e.message);
  }
}

/**
 * 2026-09-23：`saveCustomApiUrl` / `saveGoMusicApiUrl` / `setGoMusicStatus` /
 * `testGoMusicService` 四个函数已**整体删除**。
 *
 * 它们的面板入口更早一轮就已移除，而要写的三个配置项
 * （customApiUrl / customApiMethod / goMusicApiUrl）本身也已从服务端配置里删掉 ——
 * 留着就是四个永远调不到、也写不出任何东西的死函数。
 * 想恢复：git 里有；同时要把 server.js 的 DEFAULT_MUSIC_SOURCES_CONFIG、
 * POST /api/parse/config 合并分支、parseMusic 入参一起接回来。
 */


function toggleFxPanel(force) {
  var el = document.getElementById('fx-panel');
  if (!el) return;
  if (!diyPlayerMode && force !== false) {
    // 右上角入口在简约模式下也可见：点击自动进入 DIY 玩家模式再打开控制台
    // （原右下角悬浮入口仅 DIY 模式显示，移入右上角后成为默认可见的主入口）
    toggleDiyMode();
    if (!diyPlayerMode) { showToast('开启 DIY 玩家模式后可打开视觉控制台'); return; }
  }
  var currentlyOpen = el.classList.contains('show') || el.classList.contains('peek');
  if (peekTimers && peekTimers.fx) { clearTimeout(peekTimers.fx); peekTimers.fx = null; }
  fxPanelPinned = false;
  if (force === false) {
    el.classList.remove('show', 'peek');
    el.classList.toggle('closing', currentlyOpen);
    setTimeout(function(){ el.classList.remove('closing'); }, 280);
    var fab = document.getElementById('fx-fab');
    if (fab) fab.classList.remove('active');
    return;
  }
  // 已打开时点击同一入口 → 收起（toggle 语义；原实现只负责打开，
  // 收起依赖鼠标移开/点外部，右上角常显入口需要显式切换）
  if (currentlyOpen && force === undefined) {
    el.classList.remove('show', 'peek');
    el.classList.add('closing');
    setTimeout(function(){ el.classList.remove('closing'); }, 280);
    var fabBtn = document.getElementById('fx-fab');
    if (fabBtn) fabBtn.classList.remove('active');
    return;
  }
  el.classList.remove('show', 'closing');
  // 打开前刷一次「音源解析顺序」显隐：登录态可能是在面板关着的时候变的
  if (typeof syncSourceParseOrderVisibility === 'function') syncSourceParseOrderVisibility();
  setPeek(el, true, 'fx');
}
function resetFx() {
  var savedCam = fx.cam;
  var savedShelf = fx.shelf;
  var savedShelfCameraMode = normalizeShelfCameraMode(fx.shelfCameraMode || fxDefaults.shelfCameraMode);
  var savedShelfPresence = normalizeShelfPresence(fx.shelfPresence || fxDefaults.shelfPresence);
  fx = Object.assign({}, fxDefaults, {
    cam: savedCam,
    shelf: savedShelf,
    shelfCameraMode: savedShelfCameraMode,
    shelfPresence: savedShelfPresence,
    shelfAngleY: shelfDefaultAngleForCameraMode(savedShelfCameraMode),
    shelfAngleYManual: false
  });
  applyCoverParticleResolution(fx.coverResolution, { reload: true });
  updateFxInputs();
  applyDesktopLyricsState(true);
  applyWallpaperModeState(true);
  updateRenderPowerClasses();
  applyRendererPowerMode();
  setStageLyricPalette(stageLyrics.coverPalette || stageLyrics.palette);
  setPreset(fx.preset, { silent: true, preserveCamera: true, skipTransition: true });
  if (fx.floatLayer) createFloatLayer(); else destroyFloatLayer();
  if (shelfManager && shelfManager.rebuild) shelfManager.rebuild(true);
  if (shelfManager && shelfManager.refreshTheme) shelfManager.refreshTheme();
  saveLyricLayout();
  showToast('已恢复默认参数');
}

function setShelfMode(m) {
  m = /^(off|side|stage)$/.test(String(m || '')) ? m : fxDefaults.shelf;
  fx.shelf = m;
  document.querySelectorAll('#shelf-seg button').forEach(function(b){ b.classList.toggle('active', b.dataset.shelf === m); });
  if (shelfManager) shelfManager.setMode(m);
  // 舞台模式: 顶部搜索、底部控件让位
  var searchArea = document.getElementById('search-area');
  var bottomBar = document.getElementById('bottom-bar');
  if (searchArea) searchArea.classList.toggle('stage-mode', m === 'stage');
  if (bottomBar) bottomBar.classList.toggle('stage-mode', m === 'stage');
  saveLyricLayout();
}

function updateShelfControlUi() {
  fx.shelfCameraMode = normalizeShelfCameraMode(fx.shelfCameraMode || fxDefaults.shelfCameraMode);
  fx.shelfPresence = normalizeShelfPresence(fx.shelfPresence || fxDefaults.shelfPresence);
  document.querySelectorAll('#shelf-camera-seg [data-shelf-camera]').forEach(function(btn){
    btn.classList.toggle('active', btn.getAttribute('data-shelf-camera') === fx.shelfCameraMode);
  });
  document.querySelectorAll('#shelf-presence-seg [data-shelf-presence]').forEach(function(btn){
    btn.classList.toggle('active', btn.getAttribute('data-shelf-presence') === fx.shelfPresence);
  });
  var color = shelfAccentHex();
  var picker = document.getElementById('shelf-accent-picker');
  var value = document.getElementById('shelf-accent-value');
  if (picker) picker.value = color;
  if (value) value.textContent = color.toUpperCase();
}
function refreshShelfVisuals(reason) {
  updateShelfControlUi();
  if (shelfManager && shelfManager.refreshTheme) shelfManager.refreshTheme();
  if (shelfManager && shelfManager.rebuild && reason === 'mode') shelfManager.rebuild(true);
}
function setShelfCameraMode(mode) {
  fx.shelfCameraMode = normalizeShelfCameraMode(mode);
  applyShelfCameraDefaultAngle(true);
  setRange('fx-shelfangle', fx.shelfAngleY);
  updateShelfControlUi();
  if (fx.shelfCameraMode === 'static' && orbit && orbit.focus && /^shelf-/.test(String(orbit.focus.type || ''))) {
    setFocusZone(null, true);
  }
  saveLyricLayout();
  showToast(fx.shelfCameraMode === 'static' ? '3D歌单架: 静态镜头' : '3D歌单架: 动态镜头');
}
function setShelfPresence(mode) {
  fx.shelfPresence = normalizeShelfPresence(mode);
  updateShelfControlUi();
  if (shelfManager && shelfManager.setMode) shelfManager.setMode(fx.shelf);
  if (fx.shelfPresence === 'auto' && !shelfPinnedOpen) {
    shelfHoverCue.target = 0;
  }
  saveLyricLayout();
  showToast(fx.shelfPresence === 'always' ? '3D歌单架: 常驻' : '3D歌单架: 自动隐藏');
}
function setShelfAccentColor(color, silent) {
  fx.shelfAccentColor = normalizeHexColor(color || fxDefaults.shelfAccentColor, fxDefaults.shelfAccentColor);
  refreshShelfVisuals('color');
  saveLyricLayout();
  if (!silent) showToast('歌单架颜色: ' + fx.shelfAccentColor.toUpperCase());
}
function resetShelfAccentColor() {
  setShelfAccentColor(fxDefaults.shelfAccentColor || '#f4d28a');
}

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
