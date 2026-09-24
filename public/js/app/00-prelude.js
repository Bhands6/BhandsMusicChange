'use strict';

// ============================================================
//  00-prelude.js  ←  源 main.js 全文件（基线 784afe6）
//  被更早文件的顶层语句（含其调用链）依赖的 function 声明 —— 原先靠单 script 全文件提升
// ============================================================

// 为什么要单独一个文件：原 main.js 是**单个 script**，顶层 `function` 声明会被提升到
// 整个文件顶部，所以第 85 行的顶层语句可以调用第 2 万行才定义的函数。切成 17 个 script
// 后提升只在各自文件内生效 —— 前一个文件看不到后一个文件里的函数声明，直接 ReferenceError，
// 而且该 script **剩余的顶层语句全部不执行**（连带一串假故障，表现为黑屏、鼠标不显示）。
// 所以「被更早文件的顶层语句（含其同步调用链）依赖」的 function 必须最先可用。
//
// 为什么搬运是零语义改动：function 声明位置无关（提升），可见范围只增不减。
// 判定的权威实现在 `scripts/check-app-hoisting.js`（AST + 作用域分析），
// 运行期闸门是 `scripts/probe-app-load.js`（preload 抓加载期错误）—— 两者都要绿。
// 新增代码后先跑前者，它会把漏项列全并给出修法。
//
// 文件末尾还有一节「提升垫片」：顶层 `var` 的对应处理（不能搬声明，只能加裸 var）。

// ↓ 原属 09-api-search.js
function readCustomCoverMap() {
  try {
    var raw = localStorage.getItem(CUSTOM_COVER_STORE_KEY);
    var parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    return {};
  }
}

// ↓ 原属 09-api-search.js
function readCustomLyricMap() {
  try {
    var raw = JSON.parse(localStorage.getItem(CUSTOM_LYRIC_STORE_KEY) || '{}') || {};
    var out = {};
    Object.keys(raw).forEach(function(key){
      var item = raw[key];
      if (typeof item === 'string') out[key] = { text: item, updatedAt: 0 };
      else if (item && typeof item.text === 'string') out[key] = { text: item.text, updatedAt: item.updatedAt || 0 };
    });
    return out;
  } catch (e) {
    return {};
  }
}

// ↓ 原属 09-api-search.js
function readCustomLyricPrefs() {
  try { return JSON.parse(localStorage.getItem(CUSTOM_LYRIC_PREF_STORE_KEY) || '{}') || {}; }
  catch (e) { return {}; }
}

// ↓ 原属 09-api-search.js
function readPlaybackQualityPreference() {
  try {
    return normalizePlaybackQuality(localStorage.getItem(PLAYBACK_QUALITY_STORE_KEY) || 'hires');
  } catch (e) {
    return 'hires';
  }
}

// ↓ 原属 09-api-search.js
function loadListenStatsState() {
  try {
    var raw = localStorage.getItem(HOME_LISTEN_STATS_KEY);
    if (!raw) return { history: [], songs: {}, artists: {}, updatedAt: 0 };
    var data = JSON.parse(raw);
    return {
      history: Array.isArray(data.history) ? data.history.slice(0, 180) : [],
      songs: data.songs && typeof data.songs === 'object' ? data.songs : {},
      artists: data.artists && typeof data.artists === 'object' ? data.artists : {},
      updatedAt: Number(data.updatedAt) || 0,
    };
  } catch (e) {
    return { history: [], songs: {}, artists: {}, updatedAt: 0 };
  }
}

// ↓ 原属 07-beat.js
function readLocalBeatMapCache() {
  var out = {};
  try {
    var raw = JSON.parse(localStorage.getItem(LOCAL_BEATMAP_STORE_KEY) || '{}') || {};
    Object.keys(raw).forEach(function(key){
      var entry = raw[key] || {};
      out[key] = { updatedAt: entry.updatedAt || 0 };
      if (entry.mr) out[key].mr = unpackLocalBeatMap(entry.mr);
      if (entry.dj) out[key].dj = unpackLocalBeatMap(entry.dj);
    });
  } catch (e) {
    out = {};
  }
  return out;
}

// ↓ 原属 07-beat.js
function readLocalBeatPrefs() {
  try { return JSON.parse(localStorage.getItem(LOCAL_BEAT_PREF_STORE_KEY) || '{}') || {}; }
  catch (e) { return {}; }
}

// ↓ 原属 05-lyrics-stage.js
function readSavedLyricLayout() {
  try {
    var savedLayoutRaw = localStorage.getItem(LYRIC_LAYOUT_STORE_KEY);
    var raw = savedLayoutRaw ? (JSON.parse(savedLayoutRaw) || {}) : packagedDefaultLyricLayoutRaw();
    var savedPreset = clampRange(Number(raw.preset) || 0, 0, VISUAL_PRESET_INDEX_MAX);
    if (savedPreset === 3 && raw.visualPresetSchema !== VISUAL_PRESET_SCHEMA) {
      savedPreset = 5;
    }
    var savedBgColor = normalizeHexColor(raw.backgroundColor || '#000000', '#000000');
    var savedBgOpacity = clampRange(raw.backgroundOpacity == null ? fxDefaults.backgroundOpacity : Number(raw.backgroundOpacity), 0, 1);
    var savedGlassOffset = clampRange(raw.controlGlassChromaticOffset == null ? fxDefaults.controlGlassChromaticOffset : Number(raw.controlGlassChromaticOffset), 0, 140);
    var savedBgMode = /^(cover|custom)$/.test(String(raw.backgroundColorMode || '')) ? String(raw.backgroundColorMode) : '';
    var savedBgCustom = savedBgMode
      ? savedBgMode === 'custom'
      : (raw.backgroundColorCustom === true || (raw.backgroundColorCustom !== false && savedBgColor !== '#000000') || savedBgOpacity < 1);
    var desktopLyricsSchemaReady = raw.desktopLyricsSchema === 'desktop-lyrics-v3';
    var savedShelfCameraMode = normalizeShelfCameraMode(raw.shelfCameraMode || fxDefaults.shelfCameraMode);
    var savedShelfAngleManual = raw.shelfAngleYManual === true;
    var savedShelfAngle = savedShelfAngleManual
      ? clampRange(raw.shelfAngleY == null ? shelfDefaultAngleForCameraMode(savedShelfCameraMode) : Number(raw.shelfAngleY), -30, 30)
      : shelfDefaultAngleForCameraMode(savedShelfCameraMode);
    return {
      preset: savedPreset,
      intensity: clampRange(Number(raw.intensity) || fxDefaults.intensity, 0.2, 1.6),
      cinemaShake: clampRange(Number(raw.cinemaShake) || fxDefaults.cinemaShake, 0, 1.8),
      depth: clampRange(Number(raw.depth) || fxDefaults.depth, 0.2, 1.8),
      point: clampRange(Number(raw.point) || fxDefaults.point, 0.5, 2.2),
      speed: clampRange(Number(raw.speed) || fxDefaults.speed, 0.2, 2.5),
      twist: clampRange(Number(raw.twist) || fxDefaults.twist, 0, 0.6),
      color: clampRange(Number(raw.color) || fxDefaults.color, 0.5, 2.0),
      scatter: clampRange(Number(raw.scatter) || fxDefaults.scatter, 0, 0.5),
      bgFade: clampRange(Number(raw.bgFade) || fxDefaults.bgFade, 0, 1.2),
      bloomStrength: clampRange(Number(raw.bloomStrength) || fxDefaults.bloomStrength, 0, 1.6),
      lyricGlowStrength: clampRange(Number(raw.lyricGlowStrength) || fxDefaults.lyricGlowStrength, 0, 0.85),
      lyricScale: clampRange(Number(raw.lyricScale) || 1, 0.35, 1.65),
      lyricOffsetX: clampRange(Number(raw.lyricOffsetX) || 0, -2.0, 2.0),
      lyricOffsetY: clampRange(Number(raw.lyricOffsetY) || 0, -1.2, 1.35),
      lyricOffsetZ: clampRange(Number(raw.lyricOffsetZ) || 0, -1.6, 1.6),
      lyricTiltX: clampRange(Number(raw.lyricTiltX) || 0, -42, 42),
      lyricTiltY: clampRange(Number(raw.lyricTiltY) || 0, -42, 42),
      lyricCameraLock: !!raw.lyricCameraLock,
      lyricColorMode: raw.lyricColorMode === 'custom' ? 'custom' : 'auto',
      lyricColor: normalizeHexColor(raw.lyricColor || '#a9b8c8'),
      lyricHighlightMode: raw.lyricHighlightMode === 'custom' ? 'custom' : 'auto',
      lyricHighlightColor: normalizeHexColor(raw.lyricHighlightColor || '#fff0b8'),
      lyricGlowLinked: raw.lyricGlowLinked !== false,
      lyricGlowColor: normalizeHexColor(raw.lyricGlowColor || '#9db8cf'),
      lyricFont: normalizeLyricFontKey(raw.lyricFont),
      lyricLetterSpacing: clampRange(Number(raw.lyricLetterSpacing) || 0, -0.04, 0.18),
      lyricLineHeight: clampRange(Number(raw.lyricLineHeight) || 1, 0.86, 1.35),
      lyricWeight: clampRange(Number(raw.lyricWeight) || 900, 500, 900),
      lyricGlow: raw.lyricGlow !== false,
      lyricGlowBeat: raw.lyricGlowBeat !== false,
      lyricGlowParticles: !!raw.lyricGlowParticles,
      cinema: raw.cinema !== false,
      bloom: raw.bloom === true,
      edge: raw.edge === true,
      visualTintMode: raw.visualTintMode === 'custom' ? 'custom' : 'auto',
      visualTintColor: normalizeHexColor(raw.visualTintColor || '#9db8cf'),
      uiAccentColor: normalizeHexColor(raw.uiAccentColor || '#00f5d4', '#00f5d4'),
      homeAccentColor: normalizeHexColor(raw.homeAccentColor || '#00f5d4'),
      homeIconColor: normalizeHexColor(raw.homeIconColor || fxDefaults.homeIconColor || '#f4d28a', '#f4d28a'),
      visualIconColor: normalizeHexColor(raw.visualIconColor || fxDefaults.visualIconColor || '#7fd8ff', '#7fd8ff'),
      backgroundColorMode: savedBgCustom ? 'custom' : 'cover',
      backgroundColor: savedBgColor,
      backgroundOpacity: savedBgOpacity,
      controlGlassChromaticOffset: savedGlassOffset,
      backgroundColorCustom: savedBgCustom,
      backgroundImage: normalizeCustomBackgroundImage(raw.backgroundImage),
      backgroundMedia: normalizeCustomBackgroundMedia(raw.backgroundMedia || raw.backgroundImage),
      desktopLyrics: raw.desktopLyrics === true,
      desktopLyricsSize: clampRange(Number(raw.desktopLyricsSize) || fxDefaults.desktopLyricsSize, 0.72, 1.55),
      desktopLyricsOpacity: clampRange(raw.desktopLyricsOpacity == null ? fxDefaults.desktopLyricsOpacity : Number(raw.desktopLyricsOpacity), 0.28, 1),
      desktopLyricsY: clampRange(raw.desktopLyricsY == null ? fxDefaults.desktopLyricsY : Number(raw.desktopLyricsY), 0.08, 0.92),
      desktopLyricsClickThrough: desktopLyricsSchemaReady ? raw.desktopLyricsClickThrough === true : fxDefaults.desktopLyricsClickThrough,
      desktopLyricsCinema: desktopLyricsSchemaReady ? raw.desktopLyricsCinema !== false : fxDefaults.desktopLyricsCinema,
      desktopLyricsHighlight: desktopLyricsSchemaReady ? raw.desktopLyricsHighlight === true : fxDefaults.desktopLyricsHighlight,
      desktopLyricsFps: desktopLyricsSchemaReady ? normalizeDesktopLyricsFps(raw.desktopLyricsFps) : fxDefaults.desktopLyricsFps,
      performanceBackground: normalizePerformanceBackgroundMode(raw.performanceBackground, raw.liveBackgroundKeep === true),
      performanceQuality: normalizePerformanceQuality(raw.performanceQuality),
      liveBackgroundKeep: normalizePerformanceBackgroundMode(raw.performanceBackground, raw.liveBackgroundKeep === true) === 'keep',
      foregroundFpsMode: normalizeForegroundFpsMode(raw.foregroundFpsMode),
      lyricTextureClarity: normalizeLyricTextureClarity(raw.lyricTextureClarity),
      lyricBackgroundAdapt: clampRange(raw.lyricBackgroundAdapt == null ? fxDefaults.lyricBackgroundAdapt : Number(raw.lyricBackgroundAdapt), 0, 1),
      backgroundStarRiver: raw.backgroundStarRiver !== false,
      lyricLiveViewportFit: raw.lyricLiveViewportFit !== false,
      lyricContextHighQuality: raw.lyricContextHighQuality !== false,
      lyricBackdropAdapt: raw.lyricBackdropAdapt !== false,
      coverBackdropAdapt: raw.coverBackdropAdapt !== false,
      wallpaperMode: false,
      wallpaperOpacity: clampRange(raw.wallpaperOpacity == null ? fxDefaults.wallpaperOpacity : Number(raw.wallpaperOpacity), 0.35, 1),
      coverResolution: normalizeCoverResolution(raw.coverResolution),
      shelf: /^(off|side|stage)$/.test(String(raw.shelf || '')) ? raw.shelf : fxDefaults.shelf,
      shelfCameraMode: savedShelfCameraMode,
      shelfPresence: normalizeShelfPresence(raw.shelfPresence || fxDefaults.shelfPresence),
      shelfShowPodcasts: raw.shelfShowPodcasts !== false,
      shelfMergeCollections: raw.shelfMergeCollections === true,
      shelfSize: clampRange(raw.shelfSize == null ? fxDefaults.shelfSize : Number(raw.shelfSize), 0.65, 1.45),
      shelfOffsetX: clampRange(raw.shelfOffsetX == null ? fxDefaults.shelfOffsetX : Number(raw.shelfOffsetX), -1.2, 1.2),
      shelfOffsetY: clampRange(raw.shelfOffsetY == null ? fxDefaults.shelfOffsetY : Number(raw.shelfOffsetY), -0.9, 0.9),
      shelfOffsetZ: clampRange(raw.shelfOffsetZ == null ? fxDefaults.shelfOffsetZ : Number(raw.shelfOffsetZ), -0.9, 0.9),
      shelfAngleY: savedShelfAngle,
      shelfAngleYManual: savedShelfAngleManual,
      shelfOpacity: clampRange(raw.shelfOpacity == null ? fxDefaults.shelfOpacity : Number(raw.shelfOpacity), 0.25, 1),
      shelfBgOpacity: clampRange(raw.shelfBgOpacity == null ? fxDefaults.shelfBgOpacity : Number(raw.shelfBgOpacity), 0.25, 0.98),
      shelfAccentColor: normalizeHexColor(raw.shelfAccentColor || fxDefaults.shelfAccentColor, fxDefaults.shelfAccentColor),
      memoryAutoTrimApp: raw.memoryAutoTrimApp !== false,
      memoryAutoTrimOnBackground: raw.memoryAutoTrimOnBackground !== false,
      memoryAutoSystemTrim: raw.memoryAutoSystemTrim === true,
      memorySystemAutoElevate: raw.memorySystemAutoElevate === true,
      memorySystemIntervalMin: clampRange(raw.memorySystemIntervalMin == null ? fxDefaults.memorySystemIntervalMin : Number(raw.memorySystemIntervalMin), 5, 180),
      memorySystemThresholdPercent: clampRange(raw.memorySystemThresholdPercent == null ? fxDefaults.memorySystemThresholdPercent : Number(raw.memorySystemThresholdPercent), 50, 98),
      memorySystemMask: normalizeMemorySystemMask(raw.memorySystemMask == null ? fxDefaults.memorySystemMask : raw.memorySystemMask),
      cam: /^(off|gesture)$/.test(String(raw.cam || '')) ? raw.cam : fxDefaults.cam,
      particleLyrics: raw.particleLyrics !== false,
      lyricDisplayMode: normalizeLyricDisplayMode(raw.lyricDisplayMode || (raw.particleLyricLines === 5 ? 'cinema' : raw.particleLyricLines === 2 ? 'dual' : raw.particleLyricLines === 1 ? 'single' : fxDefaults.lyricDisplayMode)),
      lyricCustomLineCount: clampRange(Math.round(Number(raw.lyricCustomLineCount) || fxDefaults.lyricCustomLineCount), 1, 10),
      lyricPauseHold: raw.lyricPauseHold != null ? raw.lyricPauseHold !== false : raw.lyricShowOnPause !== false,
      lyricMotionStyle: normalizeLyricMotionStyle(raw.lyricMotionStyle || fxDefaults.lyricMotionStyle),
      lyricMotionSoftness: clampRange(Number(raw.lyricMotionSoftness) || fxDefaults.lyricMotionSoftness, 0.15, 1.2),
      lyricContextOpacity: clampRange(raw.lyricContextOpacity == null ? fxDefaults.lyricContextOpacity : Number(raw.lyricContextOpacity), 0.25, 1),
      lyricContextSpread: clampRange(raw.lyricContextSpread == null ? fxDefaults.lyricContextSpread : Number(raw.lyricContextSpread), 0.60, 2.40),
      lyricTranslationMode: normalizeLyricTranslationMode(raw.lyricTranslationMode),
      lyricTranslationGap: clampRange(raw.lyricTranslationGap == null ? fxDefaults.lyricTranslationGap : Number(raw.lyricTranslationGap), 0.28, 2.20),
      lyricTranslationScale: clampRange(raw.lyricTranslationScale == null ? fxDefaults.lyricTranslationScale : Number(raw.lyricTranslationScale), 0.46, 1.12),
      lyricTranslationOpacity: clampRange(raw.lyricTranslationOpacity == null ? fxDefaults.lyricTranslationOpacity : Number(raw.lyricTranslationOpacity), 0.20, 1),
      lyricEdgeFade: clampRange(raw.lyricEdgeFade == null ? fxDefaults.lyricEdgeFade : Number(raw.lyricEdgeFade), 0, 1),
      lyricGlitchIntensity: clampRange(raw.lyricGlitchIntensity == null ? fxDefaults.lyricGlitchIntensity : Number(raw.lyricGlitchIntensity), 0, 1.5),
      lyricGlitchSlice: clampRange(raw.lyricGlitchSlice == null ? fxDefaults.lyricGlitchSlice : Number(raw.lyricGlitchSlice), 0, 1.4),
      lyricGlitchChroma: clampRange(raw.lyricGlitchChroma == null ? fxDefaults.lyricGlitchChroma : Number(raw.lyricGlitchChroma), 0, 1.6),
      lyricGlitchRate: clampRange(raw.lyricGlitchRate == null ? fxDefaults.lyricGlitchRate : Number(raw.lyricGlitchRate), 0.45, 2.2),
      lyricGlitchJitter: clampRange(raw.lyricGlitchJitter == null ? fxDefaults.lyricGlitchJitter : Number(raw.lyricGlitchJitter), 0, 1.8),
      lyricGlitchCameraBind: raw.lyricGlitchCameraBind === true,
      lyricVerticalFloat: raw.lyricVerticalFloat !== false
    };
  } catch (e) {
    // 静默回退默认会掩盖"启动读取失败"（曾因常量时序抛 TypeError 导致整套 fx 回默认且被写档固化）
    try { console.error('[readSavedLyricLayout] 读取失败，已回退默认:', e && e.message); } catch (e2) {}
    return {};
  }
}

// ↓ 原属 13-system-panels.js
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

// ↓ 原属 05-lyrics-stage.js
function coverParticleGridForResolution(v) {
  var grid = Math.round(118 * normalizeCoverResolution(v));
  grid = Math.max(88, Math.min(183, grid));
  return grid % 2 ? grid : grid + 1;
}

// ↓ 原属 14-account.js
function bindModalBackdropClose() {
  [
    ['track-detail-modal', closeTrackDetailModal],
    ['login-modal', closeLoginModal],
    ['user-modal', closeUserModal],
    ['custom-lyric-modal', closeCustomLyricModal],
    ['update-modal', closeUpdatePanel]
  ].forEach(function(pair){
    var mask = document.getElementById(pair[0]);
    var close = pair[1];
    if (!mask || mask.__backdropCloseBound) return;
    mask.__backdropCloseBound = true;
    mask.addEventListener('click', function(e){
      if (e.target === mask) close();
    });
  });
}

// ↓ 原属 10-audio-queue.js
function updateSearchPillGlassDisplacementMap() {
  var img = document.getElementById('search-pill-glass-map');
  if (!img) return;
  var nodes = Array.prototype.slice.call(document.querySelectorAll('.search-mode-tabs button,.search-history-chip'));
  if (!nodes.length) return;
  var maxW = 0, maxH = 0, maxRadius = 14;
  nodes.forEach(function(el){
    if (!el || el.offsetParent === null) return;
    var rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    maxW = Math.max(maxW, rect.width);
    maxH = Math.max(maxH, rect.height);
    maxRadius = Math.max(maxRadius, parseFloat(getComputedStyle(el).borderRadius) || Math.round(rect.height / 2) || 14);
  });
  if (maxW < 2 || maxH < 2) return;
  var width = Math.max(96, Math.round(maxW));
  var height = Math.max(32, Math.round(maxH));
  var radius = Math.max(12, Math.min(Math.round(maxRadius), Math.round(height / 2) + 10));
  var key = width + 'x' + height + ':' + radius;
  if (key === controlGlassState.searchPillKey) return;
  controlGlassState.searchPillKey = key;
  var href = generateControlGlassDisplacementMap(width, height, radius);
  img.setAttribute('href', href);
  try { img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', href); } catch (e) {}
}

// ↓ 原属 05-lyrics-stage.js
function normalizePerformanceBackgroundMode(v, liveKeepFallback) {
  var value = String(v || '');
  if (value === 'keep' || liveKeepFallback === true) return 'keep';
  if (value === 'release') return 'release';
  return 'auto';
}

// ↓ 原属 05-lyrics-stage.js
function clampRange(v, min, max) { return Math.max(min, Math.min(max, v)); }

// ↓ 原属 14-account.js
function closeLoginModal() {
  stopQrPoll();
  closeGsapModal(document.getElementById('login-modal'));
}

// ↓ 原属 14-account.js
function closeUpdatePanel() {
  closeGsapModal(document.getElementById('update-modal'), function(){
    updatePreviewState.open = false;
  });
}

// ↓ 原属 14-account.js
function closeUserModal() { closeGsapModal(document.getElementById('user-modal')); }

// ↓ 原属 09-api-search.js
function currentCoverSong() {
  if (currentIdx >= 0 && playQueue[currentIdx]) return playQueue[currentIdx];
  return currentLocalSong || null;
}

// ↓ 原属 13-system-panels.js
function getHotkeyDefaults() {
  var defaults = { local: {}, global: {} };
  HOTKEY_ACTIONS.forEach(function(action){
    defaults.local[action.key] = action.local || '';
    defaults.global[action.key] = action.global || '';
  });
  return defaults;
}

// ↓ 原属 14-account.js
function hasProviderVip(provider, status) {
  return providerVipLevel(provider, status) !== 'none';
}

// ↓ 原属 05-lyrics-stage.js
function normalizeCoverResolution(v) {
  return clampRange(Number(v) || 1, 0.75, 1.55);
}

// ↓ 原属 05-lyrics-stage.js
function normalizeCustomBackgroundImage(value) {
  var src = String(value || '').trim();
  if (!src) return '';
  if (/^data:image\/(png|jpe?g|webp);base64,/i.test(src)) return src;
  if (/^https?:\/\//i.test(src)) return src;
  return '';
}

// ↓ 原属 05-lyrics-stage.js
function normalizeCustomBackgroundMedia(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    var img = normalizeCustomBackgroundImage(value);
    if (img) return { type: 'image', src: img };
    if (/^data:video\/(mp4|webm|quicktime);base64,/i.test(value) || /^https?:\/\//i.test(value)) return { type: 'video', src: String(value) };
    return null;
  }
  if (typeof value !== 'object') return null;
  var type = value.type === 'video' ? 'video' : (value.type === 'image' ? 'image' : '');
  if (type === 'image') {
    var imageSrc = normalizeCustomBackgroundImage(value.src || value.url || '');
    return imageSrc ? { type: 'image', src: imageSrc } : null;
  }
  if (type === 'video') {
    var src = String(value.src || '').trim();
    var id = String(value.id || '').trim();
    if (!id && !/^data:video\/(mp4|webm|quicktime);base64,/i.test(src) && !/^https?:\/\//i.test(src)) return null;
    return {
      type: 'video',
      id: id,
      src: src,
      name: String(value.name || '').slice(0, 120),
      mime: String(value.mime || '').slice(0, 80),
      size: Math.max(0, Number(value.size) || 0)
    };
  }
  return null;
}

// ↓ 原属 05-lyrics-stage.js
function normalizeDesktopLyricsFps(value) {
  var n = Number(value);
  if (!isFinite(n) || n <= 0) return 0;
  if (n <= 26) return 24;
  if (n <= 45) return 30;
  if (n <= 90) return 60;
  return 120;
}

// ↓ 原属 05-lyrics-stage.js
function normalizeForegroundFpsMode(v) {
  var value = String(v == null ? '' : v).toLowerCase();
  if (/^(45|60|75|90|120)$/.test(value)) return Number(value);
  return 'vsync';
}

// ↓ 原属 05-lyrics-stage.js
function normalizeHexColor(value, fallback) {
  var hex = String(value || '').trim();
  if (/^#[0-9a-f]{3}$/i.test(hex)) {
    hex = '#' + hex.charAt(1) + hex.charAt(1) + hex.charAt(2) + hex.charAt(2) + hex.charAt(3) + hex.charAt(3);
  }
  fallback = /^#[0-9a-f]{6}$/i.test(String(fallback || '')) ? String(fallback).toLowerCase() : '#a9b8c8';
  return /^#[0-9a-f]{6}$/i.test(hex) ? hex.toLowerCase() : fallback;
}

// ↓ 原属 04-lyrics.js
// single=单行 / dual=双行 / triple=三行 / cinema=沉浸(5行) / custom=自定义(1-10行)
// 合法值表 STAGE_LYRIC_DISPLAY_MODES 定义在文件头部（启动恢复先于本区执行）
function normalizeLyricDisplayMode(mode) {
  mode = String(mode || 'single');
  return STAGE_LYRIC_DISPLAY_MODES[mode] ? mode : 'single';
}

// ↓ 原属 05-lyrics-stage.js
function normalizeLyricFontKey(value) {
  value = String(value || 'sans');
  return /^(sans|hei|song|bold-song|stone-song|kai-song|serif-en|gothic|editorial|humanist|round|mono|display)$/.test(value) ? value : 'sans';
}

// ↓ 原属 04-lyrics.js
// 合法值表 STAGE_LYRIC_MOTION_STYLES 定义在文件头部（同 DISPLAY_MODES 时序处理）
function normalizeLyricMotionStyle(style) {
  style = String(style || 'glass');
  return STAGE_LYRIC_MOTION_STYLES[style] ? style : 'glass';
}

// ↓ 原属 05-lyrics-stage.js
function normalizeLyricTextureClarity(v) {
  var n = Math.round(Number(v) || 0);
  return (n >= 1 && n <= 4) ? n : fxDefaults.lyricTextureClarity;
}

// ↓ 原属 04-lyrics.js
/**
 * 双语翻译模式（移植自上游 setLyricTranslationMode）：
 * off 关闭 / current 仅当前行 / dual 双行 / multi 多行。
 * 默认 off —— 不影响任何既有歌词观感。
 */
function normalizeLyricTranslationMode(value) {
  var v = String(value == null ? '' : value).toLowerCase();
  return (v === 'current' || v === 'dual' || v === 'multi') ? v : 'off';
}

// ↓ 原属 13-system-panels.js
function normalizeMemorySystemMask(mask) {
  var value = Math.round(Number(mask) || MEMORY_REDUCT_MASK_DEFAULT) & MEMORY_REDUCT_MASK_DEFAULT;
  return value > 0 ? value : MEMORY_REDUCT_MASK_DEFAULT;
}

// ↓ 原属 05-lyrics-stage.js
function normalizePerformanceQuality(v) {
  var value = String(v || '');
  return /^(eco|balanced|high|ultra)$/.test(value) ? value : fxDefaults.performanceQuality;
}

// ↓ 原属 09-api-search.js
function normalizePlaybackQuality(value) {
  value = String(value || '').toLowerCase();
  if (value === 'jymaster' || value === 'master' || value === 'svip') return 'jymaster';
  if (value === 'hires' || value === 'hi-res' || value === 'highres' || value === 'highest') return 'hires';
  if (value === 'lossless' || value === 'flac' || value === 'sq') return 'lossless';
  if (value === 'exhigh' || value === 'high' || value === '320k' || value === 'hq') return 'exhigh';
  if (value === 'standard' || value === 'normal' || value === 'std') return 'standard';
  return 'hires';
}

// ↓ 原属 05-lyrics-stage.js
function normalizeShelfCameraMode(value) {
  return String(value || '') === 'static' ? 'static' : 'dynamic';
}

// ↓ 原属 05-lyrics-stage.js
function normalizeShelfPresence(value) {
  return String(value || '') === 'always' ? 'always' : 'auto';
}

// ↓ 原属 14-account.js
function platformStatus(provider) {
  return provider === 'qq' ? qqLoginStatus : loginStatus;
}

// ↓ 原属 14-account.js
function providerVipLevel(provider, status) {
  status = status || platformStatus(provider) || {};
  var raw = String(status.vipLevel || status.vip_level || '').toLowerCase();
  if (raw === 'svip' || raw === 'vip' || raw === 'none') return raw;
  var vip = providerVipType(provider, status);
  if (provider === 'netease') {
    if (status.isSvip || status.is_svip || vip >= 10) return 'svip';
    if (status.isVip || status.is_vip || vip > 0) return 'vip';
    return 'none';
  }
  return vip > 0 ? 'vip' : 'none';
}

// ↓ 原属 14-account.js
function providerVipType(provider, status) {
  status = status || platformStatus(provider) || {};
  return Number(status.vipType || status.vip_type || status.vip || status.isVip || status.is_vip || 0) || 0;
}

// ↓ 原属 10-audio-queue.js
function queueItemKey(song) {
  if (!song) return '';
  if (song.provider === 'qq' || song.source === 'qq' || song.type === 'qq') return 'qq:' + (song.mid || song.songmid || song.id || (song.name + '|' + song.artist));
  if (song.type === 'podcast' && song.programId) return 'podcast:' + song.programId;
  if (song.localKey) return 'local:' + song.localKey;
  if (song.id != null && song.id !== '') return 'song:' + song.id;
  return String(song.name || '') + '|' + String(song.artist || '');
}

// ↓ 原属 05-lyrics-stage.js
function shelfDefaultAngleForCameraMode(mode) {
  return normalizeShelfCameraMode(mode) === 'static' ? -15 : 0;
}

// ↓ 原属 16-idle-toast-libs.js
function showToast(msg) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ t.classList.remove('show'); }, 2600);
}

// ↓ 原属 18-session-boot.js
/**
 * 「音源解析顺序」整块的显隐：只有账号在**官方源**上有会员时才显示。
 *
 * 为什么隐藏：shouldPreferThirdPartyParse 在 hasVip=false 时三档全部返回 true ——
 * 非会员切「自动 / 官方优先 / 第三方优先」行为完全一致，是个无效控件。
 * 实测（check-parse-order.js 抽真实源码跑）：hasVip=false → auto/official/third-party 全 true；
 * hasVip=true → auto=false official=false third-party=true（这时才有区别）。
 *
 * ⚠️ hasVip 只看**网易云 / QQ** 的登录态，**酷狗会员不算**（酷狗是第三方源）。
 * 任一官方源有会员就显示 —— seg 是全局设置，而 hasVip 是按歌曲所属平台算的。
 */
function syncSourceParseOrderVisibility() {
  var block = document.getElementById('source-parse-order-block');
  if (!block) return;
  var vip = hasProviderVip('netease', loginStatus) || hasProviderVip('qq', qqLoginStatus);
  block.style.display = vip ? '' : 'none';
}

// ↓ 原属 07-beat.js
function unpackLocalBeatEvent(row) {
  if (typeof row === 'number') return row;
  if (!Array.isArray(row)) return row;
  var flags = row[8] || 0;
  return {
    time: row[0] || 0,
    strength: row[1] == null ? 0.42 : row[1],
    confidence: row[2] == null ? 0.72 : row[2],
    impact: row[3] == null ? (row[1] || 0.42) : row[3],
    low: row[4] == null ? 0.62 : row[4],
    body: row[5] == null ? 0.22 : row[5],
    snap: row[6] == null ? 0.16 : row[6],
    combo: LOCAL_BEAT_COMBOS[row[7] || 0] || undefined,
    primary: !!(flags & 1),
    camera: !!(flags & 2),
    pulse: !!(flags & 4),
    dj: !!(flags & 8),
    grid: !!(flags & 16),
    kickOnly: !!(flags & 32),
    mass: row[9] == null ? 0.62 : row[9],
    sharpness: row[10] == null ? 0.12 : row[10],
    step: row[11] || 0
  };
}

// ↓ 原属 07-beat.js
function unpackLocalBeatMap(stored) {
  if (!stored) return null;
  if (stored.v && stored.v !== 1 && stored.v !== 2) return stored;
  var camera = (stored.cameraBeats || []).map(unpackLocalBeatEvent);
  var pulse = (stored.pulseBeats || []).map(unpackLocalBeatEvent);
  return {
    kicks: camera.map(function(b){ return typeof b === 'number' ? b : b.time; }),
    beats: camera,
    pulseBeats: pulse,
    cameraBeats: camera,
    gridStep: stored.gridStep || 0,
    sectionSteps: stored.sectionSteps || [],
    tempoSource: stored.tempoSource || 'local',
    duration: stored.duration || 0,
    visualBeatCount: stored.visualBeatCount || camera.length,
    analyzedAt: stored.analyzedAt || Date.now(),
    partial: !!stored.partial,
    partialUntilSec: stored.partialUntilSec || 0
  };
}

// ↓ 原属 18-session-boot.js
function updateKugouLoginStatusText() {
  var el = document.getElementById('kugou-login-status');
  if (!el) return;
  var row = document.getElementById('kugou-qr-login-row');
  fetch('/api/kugou/login/status').then(function (r) { return r.json(); }).then(function (j) {
    var loggedIn = !!(j && j.loggedIn);
    // 会员 FLAC 只在 kugou 策略参与解析时才生效（musicParser.js canHandle 要求
    // enabledSources 含 'kugou'，默认配置里没有它）——所以状态文案必须跟着开关走，
    // 否则会出现「已登录（会员音质已启用）」但实际还在跑 128k 的空头支票。
    var enabled = (_musicSourcesConfig && _musicSourcesConfig.enabledSources) || [];
    var sourceOn = enabled.indexOf('kugou') >= 0;
    // 文案保持短：这行右侧空间有限，太长会把左侧「酷狗扫码登录」挤成省略号
    el.textContent = !loggedIn ? '未登录' : (sourceOn ? '已登录 · 音质已启用' : '已登录 · 音源未开');
    el.style.color = (loggedIn && sourceOn) ? 'var(--c-accent,#7cf)' : 'rgba(255,255,255,.45)';
    if (row) {
      row.title = !loggedIn
        ? '扫码登录酷狗概念版，解锁会员音质（FLAC/320k）'
        : (sourceOn
          ? '已登录酷狗概念版，会员音质已参与解析（点击可重新登录）'
          : '已登录，但「酷狗音源」开关没打开，会员音质不会生效 —— 点下方开关开启');
    }
  }).catch(function () { el.textContent = ''; });
}

// ============================================================
//  提升垫片：下面这些顶层 var 声明在源 main.js 的**后部**（如 02/12/14 区），
//  而 prelude 里的函数会在更早的顶层语句（01-state.js 第 807 / 823 行等）就被调用。
//  原单 script 下它们被提升为 undefined；这里用裸 var 精确复刻同一语义。
//  ⚠️ 不要把它们带初始化的声明搬过来 —— 那会把 undefined 变成真值，属于行为改动。
// ============================================================
var MEMORY_REDUCT_MASK_DEFAULT;
var toastTimer;
