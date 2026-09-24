'use strict';

// ============================================================
//  13-system-panels.js  —  输出设备 / 本地缓存 / 内存管家 / 第三方音源设置 / 系统设置
//  由 public/js/app/*.js 于 2026-09-24「按职责重排」生成（零逻辑改动）。
//  规则与验证见 docs/APP_REORG_PLAN.md 与 scripts/check-app-reorg.js。
// ============================================================



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
