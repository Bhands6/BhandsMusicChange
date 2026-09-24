'use strict';

// ============================================================
//  12-fx-console.js  —  控制台：面板机制 / 预设卡片 / 主滑块 / 开关 / 调色台 / 歌词控件 / 自定义背景
//  由 public/js/app/*.js 于 2026-09-24「按职责重排」生成（零逻辑改动）。
//  ⚠️ 下方 `// <旧文件名> ← 源 main.js §NN` 横幅是**第一步拆分**留下的「来源」标注，
//     重排会把条目搬到职责文件里 —— 横幅里的文件名与本文件不一致是正常的。
//     找函数请按**函数名 grep**，别按文件名推断。
//  规则与验证见 docs/APP_REORG_PLAN.md 与 scripts/check-app-reorg.js。
// ============================================================


function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  var max = Math.max(r, g, b), min = Math.min(r, g, b);
  var h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    var d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return { h:h, s:s, l:l };
}
function hslToRgb(h, s, l) {
  function hue2rgb(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  }
  var r, g, b;
  if (s === 0) r = g = b = l;
  else {
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    var p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  return { r:Math.round(r * 255), g:Math.round(g * 255), b:Math.round(b * 255) };
}
function rgbCss(c, a) {
  if (a == null) return 'rgb(' + c.r + ',' + c.g + ',' + c.b + ')';
  return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + a + ')';
}
function hexToRgb(hex) {
  hex = normalizeHexColor(hex).slice(1);
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16)
  };
}
function customBackgroundMediaLabel(media) {
  media = normalizeCustomBackgroundMedia(media);
  if (!media) return '未设置';
  return media.type === 'video' ? '视频已设置' : '图片已设置';
}
var CUSTOM_BG_DB_NAME = 'bhandsmusic-custom-background-v1';
var CUSTOM_BG_STORE = 'media';
var customBgObjectUrl = '';
var customBgApplyToken = 0;
function openCustomBackgroundDb() {
  return new Promise(function(resolve, reject){
    if (!window.indexedDB) { reject(new Error('indexedDB unavailable')); return; }
    var req = indexedDB.open(CUSTOM_BG_DB_NAME, 1);
    req.onupgradeneeded = function(){
      var db = req.result;
      if (!db.objectStoreNames.contains(CUSTOM_BG_STORE)) db.createObjectStore(CUSTOM_BG_STORE, { keyPath: 'id' });
    };
    req.onsuccess = function(){ resolve(req.result); };
    req.onerror = function(){ reject(req.error || new Error('indexedDB open failed')); };
  });
}
async function putCustomBackgroundBlob(id, blob, meta) {
  var db = await openCustomBackgroundDb();
  return new Promise(function(resolve, reject){
    var tx = db.transaction(CUSTOM_BG_STORE, 'readwrite');
    tx.objectStore(CUSTOM_BG_STORE).put(Object.assign({ id: id, blob: blob, savedAt: Date.now() }, meta || {}));
    tx.oncomplete = function(){ db.close(); resolve(); };
    tx.onerror = function(){ db.close(); reject(tx.error || new Error('indexedDB put failed')); };
  });
}
async function getCustomBackgroundBlob(id) {
  var db = await openCustomBackgroundDb();
  return new Promise(function(resolve, reject){
    var tx = db.transaction(CUSTOM_BG_STORE, 'readonly');
    var req = tx.objectStore(CUSTOM_BG_STORE).get(id);
    req.onsuccess = function(){ resolve(req.result && req.result.blob ? req.result.blob : null); };
    req.onerror = function(){ reject(req.error || new Error('indexedDB get failed')); };
    tx.oncomplete = function(){ db.close(); };
  });
}
var colorLabState = { picker: null, id: '', h: 0, s: 1, v: 1, dragging: false };
var COLOR_LAB_PRESETS = [
  { name: '极黑', color: '#000000' },
  { name: '极白', color: '#ffffff' },
  { name: '克莱因蓝', color: '#002fa7' },
  { name: '法拉利红', color: '#f00000' },
  { name: '香槟金', color: '#c8a96a' },
  { name: '孔雀绿', color: '#006b5b' },
  { name: '午夜紫', color: '#2b164f' },
  { name: '银雾', color: '#d9dde2' }
];
function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  var max = Math.max(r, g, b), min = Math.min(r, g, b);
  var d = max - min, h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return { h: h, s: max === 0 ? 0 : d / max, v: max };
}
function hsvToHex(h, s, v) {
  h = ((h % 1) + 1) % 1; s = clampRange(s, 0, 1); v = clampRange(v, 0, 1);
  var i = Math.floor(h * 6), f = h * 6 - i;
  var p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  var r, g, b;
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    default: r = v; g = p; b = q; break;
  }
  return rgbToHexColor(r * 255, g * 255, b * 255);
}
function applyColorLabValue(hex, silent) {
  hex = normalizeHexColor(hex || '#000000', '#000000');
  var id = colorLabState.id;
  if (id === 'ui-accent-picker') setUiAccentColor(hex, true);
  else if (id === 'visual-tint-picker') setVisualTintCustom(hex, true);
  else if (id === 'home-accent-picker') setHomeAccentColor(hex, true);
  else if (id === 'home-icon-picker') setHomeIconColor(hex, true);
  else if (id === 'visual-icon-picker') setVisualIconColor(hex, true);
  else if (id === 'bg-color-picker') setCustomBackgroundColor(hex, true, true);
  else if (id === 'shelf-accent-picker') setShelfAccentColor(hex, true);
  else if (id === 'lyric-color-picker') setLyricColorCustom(hex, true);
  else if (id === 'lyric-highlight-picker') setLyricHighlightCustom(hex, true);
  else if (id === 'lyric-glow-picker') setLyricGlowCustom(hex, true);
  if (!silent) showToast('颜色: ' + hex.toUpperCase());
}
function syncColorLabUi(hex) {
  hex = normalizeHexColor(hex || '#000000', '#000000');
  var rgb = hexToRgb(hex);
  var hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
  colorLabState.h = hsv.h; colorLabState.s = hsv.s; colorLabState.v = hsv.v;
  var pop = document.getElementById('color-lab-pop');
  var sv = document.getElementById('color-lab-sv');
  var cursor = document.getElementById('color-lab-cursor');
  var hue = document.getElementById('color-lab-hue');
  var hexInput = document.getElementById('color-lab-hex');
  var preview = document.getElementById('color-lab-preview');
  var hueHex = hsvToHex(colorLabState.h, 1, 1);
  if (pop) {
    pop.style.setProperty('--lab-color', hex);
    pop.style.setProperty('--lab-hue', hueHex);
  }
  if (sv) sv.style.setProperty('--lab-hue', hueHex);
  if (cursor) { cursor.style.left = (colorLabState.s * 100).toFixed(2) + '%'; cursor.style.top = ((1 - colorLabState.v) * 100).toFixed(2) + '%'; }
  if (hue) hue.value = Math.round(colorLabState.h * 360);
  if (hexInput) hexInput.value = hex.toUpperCase();
  if (preview) preview.style.setProperty('--lab-color', hex);
}
function closeColorLab() {
  var pop = document.getElementById('color-lab-pop');
  if (pop) pop.classList.remove('show');
  colorLabState.picker = null;
  colorLabState.id = '';
}
function placeFxFloatingPanel(pop, anchor, opts) {
  if (!pop || !anchor || !anchor.getBoundingClientRect) return;
  opts = opts || {};
  var gap = opts.gap == null ? 12 : opts.gap;
  var pad = opts.pad == null ? 14 : opts.pad;
  var rect = anchor.getBoundingClientRect();
  var vw = Math.max(320, window.innerWidth || document.documentElement.clientWidth || 320);
  var vh = Math.max(320, window.innerHeight || document.documentElement.clientHeight || 320);
  var pw = Math.min(pop.offsetWidth || pop.getBoundingClientRect().width || 330, vw - pad * 2);
  var ph = Math.min(pop.offsetHeight || pop.getBoundingClientRect().height || 260, vh - pad * 2);
  var left;
  var top;
  if (vw < 760) {
    left = Math.max(pad, Math.min(vw - pw - pad, rect.left + rect.width / 2 - pw / 2));
    top = rect.bottom + gap;
    if (top + ph > vh - pad) top = Math.max(pad, rect.top - ph - gap);
  } else {
    var roomRight = vw - rect.right - pad;
    var roomLeft = rect.left - pad;
    if (roomRight >= pw + gap || roomRight >= roomLeft) left = rect.right + gap;
    else left = rect.left - pw - gap;
    left = Math.max(pad, Math.min(vw - pw - pad, left));
    top = rect.top + rect.height / 2 - ph / 2;
    top = Math.max(pad, Math.min(vh - ph - pad, top));
  }
  pop.style.left = Math.round(left) + 'px';
  pop.style.top = Math.round(top) + 'px';
  pop.style.transform = 'none';
}
function openColorLabForPicker(picker) {
  var pop = document.getElementById('color-lab-pop');
  if (!picker || !pop) return;
  if (pop.classList.contains('show') && colorLabState.picker === picker) {
    closeColorLab();
    return;
  }
  colorLabState.picker = picker;
  colorLabState.id = picker.id || '';
  var label = picker.closest('.lyric-color-row');
  var title = document.getElementById('color-lab-title');
  if (title) title.textContent = label ? (label.textContent || 'Color').replace(/#[0-9a-f]{6}/ig, '').trim().slice(0, 24) : 'Color';
  syncColorLabUi(picker.value || '#000000');
  var presets = document.getElementById('color-lab-presets');
  if (presets) {
    presets.innerHTML = COLOR_LAB_PRESETS.map(function(p){
      return '<button type="button" title="' + escHtml(p.name) + '" style="--c:' + p.color + '" data-color="' + p.color + '"></button>';
    }).join('');
  }
  pop.classList.add('show');
  placeFxFloatingPanel(pop, label || picker, { gap: 12, pad: 14 });
}
function updateColorLabFromSv(e) {
  var sv = document.getElementById('color-lab-sv');
  if (!sv) return;
  var rect = sv.getBoundingClientRect();
  colorLabState.s = clampRange((e.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
  colorLabState.v = 1 - clampRange((e.clientY - rect.top) / Math.max(1, rect.height), 0, 1);
  var hex = hsvToHex(colorLabState.h, colorLabState.s, colorLabState.v);
  syncColorLabUi(hex);
  applyColorLabValue(hex, true);
}
function bindColorLabPicker(picker) {
  if (!picker || picker._colorLabBound) return;
  picker._colorLabBound = true;
  picker.setAttribute('aria-haspopup', 'dialog');
  picker.setAttribute('data-color-lab-picker', '1');
  function openFromPickerEvent(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    picker._colorLabOpenedAt = Date.now();
    openColorLabForPicker(picker);
  }
  picker.addEventListener('pointerdown', openFromPickerEvent);
  picker.addEventListener('mousedown', function(e){ e.preventDefault(); e.stopPropagation(); });
  picker.addEventListener('click', function(e){
    e.preventDefault();
    e.stopPropagation();
    if (Date.now() - (picker._colorLabOpenedAt || 0) < 260) return;
    openColorLabForPicker(picker);
  });
  picker.addEventListener('keydown', function(e){
    if (e.key === 'Enter' || e.key === ' ') openFromPickerEvent(e);
  });
}
function liftFxFloatingPopups() {
  ['cover-color-pop', 'color-lab-pop', 'cover-color-loupe'].forEach(function(id){
    var el = document.getElementById(id);
    if (el && el.parentElement !== document.body) document.body.appendChild(el);
  });
}
function bindColorLabRows() {
  document.querySelectorAll('.lyric-color-row').forEach(function(row){
    if (!row || row._colorLabRowBound || row.classList.contains('linked')) return;
    var picker = row.querySelector('.lyric-color-picker');
    if (!picker) return;
    row._colorLabRowBound = true;
    row.addEventListener('pointerdown', function(e){
      if (!e || !e.target) return;
      if (e.target.closest('button,.fx-mini-btn,input[type="range"],select,textarea')) return;
      e.preventDefault();
      e.stopPropagation();
      picker._colorLabOpenedAt = Date.now();
      openColorLabForPicker(picker);
    });
  });
}
function repositionFxFloatingPanels() {
  var colorPop = document.getElementById('color-lab-pop');
  if (colorPop && colorPop.classList.contains('show') && colorLabState.picker) {
    placeFxFloatingPanel(colorPop, colorLabState.picker.closest('.lyric-color-row') || colorLabState.picker, { gap: 12, pad: 14 });
  }
  var coverPop = document.getElementById('cover-color-pop');
  if (coverPop && coverPop.classList.contains('show')) {
    placeFxFloatingPanel(coverPop, document.getElementById('visual-tint-auto-btn') || document.getElementById('visual-tint-picker') || coverPop, { gap: 12, pad: 14 });
  }
}

// ============================================================
//  11-fx-console.js  ←  源 main.js §29（基线 784afe6）
//  控制台：预设卡片 + 主滑块 + 开关 + 三态
// ============================================================

// ============================================================
//  控制台 — 预设卡片 + 主滑块 + 开关 + 三态
// ============================================================
var presetMeta = [
  { name: 'emily专辑封面',  desc: '封面粒子 · 快速入场' },
  { name: '滚筒', desc: '隧道 · 沉浸感' },
  { name: '星球',  desc: '星球 · 雕塑感' },
  { name: '虚空', desc: '无粒子 · 自定义背景' },
  { name: '唱片', desc: '唱片 · 圆形封面' },
  { name: '星河', desc: '壁纸粒子 · 音乐律动' },
  { name: '安魂', desc: '骷髅·YUI7W', descHtml: '骷髅·<span class="pc-yui7w">YUI7W</span>' },
  { name: '音域回响', nameHtml: '音域回响 <span class="pc-name-en">Sonic-Topography</span>', desc: '作者 Ajin', descHtml: '作者 <span class="pc-author-ajin">Ajin</span>' },
  { name: '音域回响', nameHtml: '音域回响 <span class="pc-name-en">Wallpaper Engine</span>', desc: '作者 CmzYa' },
];
if (typeof WebFxPresets !== 'undefined' && WebFxPresets.PRESET_META) {
  for (var wfi = 0; wfi < WebFxPresets.PRESET_META.length; wfi++) presetMeta.push(WebFxPresets.PRESET_META[wfi]);
}
var presetIcons = [
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 14c3-2 5-2 8 0s5 2 8 0M3 10c3-2 5-2 8 0s5 2 8 0M3 18c3-2 5-2 8 0s5 2 8 0"/></svg>',
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>',
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="7"/><path d="M5 12a7 7 0 0 0 14 0"/></svg>',
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="7"/><path d="M8.8 8.8l6.4 6.4"/></svg>',
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.4"/><path d="M16.5 5.2c2.1.9 3.4 2.4 4 4.5"/><path d="M18.8 3.2l1.5 4.8"/></svg>',
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 15c2.2-4.4 4.4-4.4 6.6 0s4.4 4.4 6.6 0S20.6 10.6 23 15"/><path d="M3 9c2.2 2.2 4.4 2.2 6.6 0s4.4-2.2 6.6 0S20.6 11.2 23 9"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/></svg>',
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3.2h4v6.2h4.2v3.8H14v7.6h-4v-7.6H5.8V9.4H10z"/></svg>',
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18c2-3 4-3 6 0s4 3 6 0 4-3 6 0"/><path d="M3 12c2-2.5 4-2.5 6 0s4 2.5 6 0 4-2.5 6 0"/><path d="M3 6c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/><circle cx="18" cy="5" r="1.2" fill="currentColor"/></svg>',
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18h18"/><path d="M5 15c1.4-4 2.8-4 4.2 0s2.8 4 4.2 0 2.8-4 4.6 0"/><path d="M4 10c2-2 4-2 6 0s4 2 6 0 3-2 4 0"/><path d="M7 6h10"/><circle cx="18.2" cy="5.8" r="1.35" fill="currentColor"/></svg>',
];
if (typeof WebFxPresets !== 'undefined' && WebFxPresets.PRESET_ICONS) {
  for (var wfic = 0; wfic < WebFxPresets.PRESET_ICONS.length; wfic++) presetIcons.push(WebFxPresets.PRESET_ICONS[wfic]);
}
var presetDisplayOrder = [0, 6, 7, 8, 5, 4, 2, 1, 3, 9, 10, 11, 12, 13, 14, 15, 16, 17];
// presetMeta 已就绪：校准头部兜底的预设索引上限（启动恢复读取端使用），新增预设时只需维护 presetMeta 本身
VISUAL_PRESET_INDEX_MAX = presetMeta.length - 1;
var lyricColorPresets = [
  { name:'雾蓝', color:'#a9b8c8' },
  { name:'银蓝', color:'#9db8cf' },
  { name:'冰川', color:'#7ec8d8' },
  { name:'青绿', color:'#66d2b5' },
  { name:'松针', color:'#7fa894' },
  { name:'月白', color:'#d7d2c4' },
  { name:'岩金', color:'#c3ae7c' },
  { name:'琥珀', color:'#d9a45f' },
  { name:'暮粉', color:'#c78aa4' },
  { name:'玫红', color:'#d76a8d' },
  { name:'烟紫', color:'#9b83d3' },
  { name:'电紫', color:'#8d70ff' },
  { name:'靛蓝', color:'#5e78d8' },
  { name:'海蓝', color:'#3c9fe0' },
  { name:'霓青', color:'#28c5c3' },
  { name:'夜绿', color:'#245c49' },
  { name:'酒红', color:'#6d1f35' },
  { name:'墨黑', color:'#111318' },
];
var USER_FX_ARCHIVE_STORE_KEY = 'bhandsmusic-user-fx-archives-v1';
var USER_FX_ARCHIVE_EXPORT_TYPE = 'bhandsmusic-user-fx-archive';
var USER_FX_ARCHIVE_SCHEMA = 1;
function archiveNumber(raw, key, fallback, min, max) {
  var value = raw && raw[key] != null ? Number(raw[key]) : fallback;
  if (!isFinite(value)) value = fallback;
  return clampRange(value, min, max);
}
function archiveMode(raw, key, pattern, fallback) {
  var value = String(raw && raw[key] != null ? raw[key] : fallback);
  return pattern.test(value) ? value : fallback;
}
function normalizeFxArchiveSnapshot(raw) {
  if (!raw || typeof raw !== 'object') return null;
  var savedPreset = clampRange(Number(raw.preset) || 0, 0, presetMeta.length - 1);
  if (savedPreset === 3 && raw.visualPresetSchema !== VISUAL_PRESET_SCHEMA) savedPreset = 5;
  return {
    visualPresetSchema: VISUAL_PRESET_SCHEMA,
    preset: savedPreset,
    intensity: archiveNumber(raw, 'intensity', fxDefaults.intensity, 0.2, 1.6),
    cinemaShake: archiveNumber(raw, 'cinemaShake', fxDefaults.cinemaShake, 0, 1.8),
    depth: archiveNumber(raw, 'depth', fxDefaults.depth, 0.2, 1.8),
    coverResolution: normalizeCoverResolution(raw.coverResolution),
    point: archiveNumber(raw, 'point', fxDefaults.point, 0.5, 2.2),
    speed: archiveNumber(raw, 'speed', fxDefaults.speed, 0.2, 2.5),
    twist: archiveNumber(raw, 'twist', fxDefaults.twist, 0, 0.6),
    color: archiveNumber(raw, 'color', fxDefaults.color, 0.5, 2.0),
    scatter: archiveNumber(raw, 'scatter', fxDefaults.scatter, 0, 0.5),
    bgFade: archiveNumber(raw, 'bgFade', fxDefaults.bgFade, 0, 1.2),
    bloomStrength: archiveNumber(raw, 'bloomStrength', fxDefaults.bloomStrength, 0, 1.6),
    lyricGlowStrength: archiveNumber(raw, 'lyricGlowStrength', fxDefaults.lyricGlowStrength, 0, 0.85),
    lyricScale: archiveNumber(raw, 'lyricScale', fxDefaults.lyricScale, 0.35, 1.65),
    lyricOffsetX: archiveNumber(raw, 'lyricOffsetX', fxDefaults.lyricOffsetX, -2.0, 2.0),
    lyricOffsetY: archiveNumber(raw, 'lyricOffsetY', fxDefaults.lyricOffsetY, -1.2, 1.35),
    lyricOffsetZ: archiveNumber(raw, 'lyricOffsetZ', fxDefaults.lyricOffsetZ, -1.6, 1.6),
    lyricTiltX: archiveNumber(raw, 'lyricTiltX', fxDefaults.lyricTiltX, -42, 42),
    lyricTiltY: archiveNumber(raw, 'lyricTiltY', fxDefaults.lyricTiltY, -42, 42),
    lyricCameraLock: !!raw.lyricCameraLock,
    lyricColorMode: raw.lyricColorMode === 'custom' ? 'custom' : 'auto',
    lyricColor: normalizeHexColor(raw.lyricColor || fxDefaults.lyricColor),
    lyricHighlightMode: raw.lyricHighlightMode === 'custom' ? 'custom' : 'auto',
    lyricHighlightColor: normalizeHexColor(raw.lyricHighlightColor || fxDefaults.lyricHighlightColor),
    lyricGlowLinked: raw.lyricGlowLinked !== false,
    lyricGlowColor: normalizeHexColor(raw.lyricGlowColor || fxDefaults.lyricGlowColor),
    lyricFont: normalizeLyricFontKey(raw.lyricFont),
    lyricLetterSpacing: archiveNumber(raw, 'lyricLetterSpacing', fxDefaults.lyricLetterSpacing, -0.04, 0.18),
    lyricLineHeight: archiveNumber(raw, 'lyricLineHeight', fxDefaults.lyricLineHeight, 0.86, 1.35),
    lyricWeight: archiveNumber(raw, 'lyricWeight', fxDefaults.lyricWeight, 500, 900),
    visualTintMode: raw.visualTintMode === 'custom' ? 'custom' : 'auto',
    visualTintColor: normalizeHexColor(raw.visualTintColor || fxDefaults.visualTintColor),
    uiAccentColor: normalizeHexColor(raw.uiAccentColor || fxDefaults.uiAccentColor, fxDefaults.uiAccentColor),
    homeAccentColor: normalizeHexColor(raw.homeAccentColor || fxDefaults.homeAccentColor, fxDefaults.homeAccentColor),
    homeIconColor: normalizeHexColor(raw.homeIconColor || fxDefaults.homeIconColor, fxDefaults.homeIconColor),
    visualIconColor: normalizeHexColor(raw.visualIconColor || fxDefaults.visualIconColor, fxDefaults.visualIconColor),
    backgroundColorMode: raw.backgroundColorMode === 'custom' || raw.backgroundColorCustom ? 'custom' : 'cover',
    backgroundColor: normalizeHexColor(raw.backgroundColor || fxDefaults.backgroundColor, fxDefaults.backgroundColor),
    backgroundOpacity: archiveNumber(raw, 'backgroundOpacity', fxDefaults.backgroundOpacity, 0, 1),
    controlGlassChromaticOffset: archiveNumber(raw, 'controlGlassChromaticOffset', fxDefaults.controlGlassChromaticOffset, 0, 140),
    backgroundColorCustom: raw.backgroundColorMode === 'custom' || !!raw.backgroundColorCustom,
    floatLayer: !!raw.floatLayer,
    cinema: raw.cinema !== false,
    edge: !!raw.edge,
    aiDepth: !!raw.aiDepth,
    bloom: !!raw.bloom,
    lyricGlow: raw.lyricGlow !== false,
    lyricGlowBeat: raw.lyricGlowBeat !== false,
    lyricGlowParticles: !!raw.lyricGlowParticles,
    desktopLyrics: !!raw.desktopLyrics,
    desktopLyricsSize: archiveNumber(raw, 'desktopLyricsSize', fxDefaults.desktopLyricsSize, 0.72, 1.55),
    desktopLyricsOpacity: archiveNumber(raw, 'desktopLyricsOpacity', fxDefaults.desktopLyricsOpacity, 0.28, 1),
    desktopLyricsY: archiveNumber(raw, 'desktopLyricsY', fxDefaults.desktopLyricsY, 0.08, 0.92),
    desktopLyricsClickThrough: raw.desktopLyricsClickThrough === true,
    desktopLyricsCinema: raw.desktopLyricsCinema !== false,
    desktopLyricsHighlight: raw.desktopLyricsHighlight === true,
    desktopLyricsFps: normalizeDesktopLyricsFps(Object.prototype.hasOwnProperty.call(raw, 'desktopLyricsFps') ? raw.desktopLyricsFps : fxDefaults.desktopLyricsFps),
    performanceBackground: normalizePerformanceBackgroundMode(raw.performanceBackground, raw.liveBackgroundKeep === true),
    performanceQuality: normalizePerformanceQuality(raw.performanceQuality),
    liveBackgroundKeep: normalizePerformanceBackgroundMode(raw.performanceBackground, raw.liveBackgroundKeep === true) === 'keep',
    foregroundFpsMode: normalizeForegroundFpsMode(Object.prototype.hasOwnProperty.call(raw, 'foregroundFpsMode') ? raw.foregroundFpsMode : fxDefaults.foregroundFpsMode),
    lyricTextureClarity: normalizeLyricTextureClarity(Object.prototype.hasOwnProperty.call(raw, 'lyricTextureClarity') ? raw.lyricTextureClarity : fxDefaults.lyricTextureClarity),
    lyricBackgroundAdapt: clampRange(raw.lyricBackgroundAdapt == null ? fxDefaults.lyricBackgroundAdapt : Number(raw.lyricBackgroundAdapt), 0, 1),
    backgroundStarRiver: raw.backgroundStarRiver !== false,
    lyricLiveViewportFit: raw.lyricLiveViewportFit !== false,
    lyricContextHighQuality: raw.lyricContextHighQuality !== false,
    lyricBackdropAdapt: raw.lyricBackdropAdapt !== false,
    coverBackdropAdapt: raw.coverBackdropAdapt !== false,
    particleLyrics: raw.particleLyrics !== false,
    lyricDisplayMode: normalizeLyricDisplayMode(raw.lyricDisplayMode || (raw.particleLyricLines === 5 ? 'cinema' : raw.particleLyricLines === 2 ? 'dual' : fxDefaults.lyricDisplayMode)),
    lyricCustomLineCount: clampRange(Math.round(Number(raw.lyricCustomLineCount) || fxDefaults.lyricCustomLineCount), 1, 10),
    lyricPauseHold: raw.lyricPauseHold !== false,
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
    lyricVerticalFloat: raw.lyricVerticalFloat !== false,
    backCover: !!raw.backCover,
    shelf: archiveMode(raw, 'shelf', /^(off|side|stage)$/, fxDefaults.shelf),
    shelfCameraMode: archiveMode(raw, 'shelfCameraMode', /^(dynamic|static)$/, fxDefaults.shelfCameraMode),
    shelfPresence: archiveMode(raw, 'shelfPresence', /^(auto|always)$/, fxDefaults.shelfPresence),
    shelfShowPodcasts: raw.shelfShowPodcasts !== false,
    shelfMergeCollections: raw.shelfMergeCollections === true,
    shelfSize: archiveNumber(raw, 'shelfSize', fxDefaults.shelfSize, 0.65, 1.45),
    shelfOffsetX: archiveNumber(raw, 'shelfOffsetX', fxDefaults.shelfOffsetX, -1.2, 1.2),
    shelfOffsetY: archiveNumber(raw, 'shelfOffsetY', fxDefaults.shelfOffsetY, -0.9, 0.9),
    shelfOffsetZ: archiveNumber(raw, 'shelfOffsetZ', fxDefaults.shelfOffsetZ, -0.9, 0.9),
    shelfAngleY: archiveNumber(raw, 'shelfAngleY', fxDefaults.shelfAngleY, -30, 30),
    shelfAngleYManual: raw.shelfAngleYManual === true,
    shelfOpacity: archiveNumber(raw, 'shelfOpacity', fxDefaults.shelfOpacity, 0.25, 1),
    shelfBgOpacity: archiveNumber(raw, 'shelfBgOpacity', fxDefaults.shelfBgOpacity, 0.25, 0.98),
    shelfAccentColor: normalizeHexColor(raw.shelfAccentColor || fxDefaults.shelfAccentColor, fxDefaults.shelfAccentColor),
    memoryAutoTrimApp: raw.memoryAutoTrimApp !== false,
    memoryAutoTrimOnBackground: raw.memoryAutoTrimOnBackground !== false,
    memoryAutoSystemTrim: raw.memoryAutoSystemTrim === true,
    memorySystemAutoElevate: raw.memorySystemAutoElevate === true,
    memorySystemIntervalMin: archiveNumber(raw, 'memorySystemIntervalMin', fxDefaults.memorySystemIntervalMin, 5, 180),
    memorySystemThresholdPercent: archiveNumber(raw, 'memorySystemThresholdPercent', fxDefaults.memorySystemThresholdPercent, 50, 98),
    memorySystemMask: normalizeMemorySystemMask(raw.memorySystemMask == null ? fxDefaults.memorySystemMask : raw.memorySystemMask),
    cam: archiveMode(raw, 'cam', /^(off|gesture)$/, fxDefaults.cam)
  };
}
function readUserFxArchives() {
  var raw = [];
  try {
    raw = JSON.parse(localStorage.getItem(USER_FX_ARCHIVE_STORE_KEY) || '[]') || [];
  } catch (e) {
    raw = [];
  }
  if (!Array.isArray(raw)) raw = [];
  return raw.map(function(slot, index){
    slot = slot && typeof slot === 'object' ? slot : {};
    var snapshot = normalizeFxArchiveSnapshot(slot.snapshot);
    return {
      name: normalizeUserFxArchiveName(slot.name, index),
      createdAt: Number(slot.createdAt) || (snapshot ? (Number(slot.savedAt) || Date.now()) : 0),
      savedAt: snapshot ? (Number(slot.savedAt) || Date.now()) : 0,
      snapshot: snapshot
    };
  }).filter(function(slot){
    return !!(slot.snapshot || slot.savedAt || slot.createdAt);
  });
}
function saveUserFxArchives() {
  try {
    localStorage.setItem(USER_FX_ARCHIVE_STORE_KEY, JSON.stringify(userFxArchives));
  } catch (e) {
    showToast('用户存档保存失败，本地存储空间可能不足');
  }
}
function hasStoredUserFxArchives() {
  try {
    return localStorage.getItem(USER_FX_ARCHIVE_STORE_KEY) != null;
  } catch (e) {
    return true;
  }
}
function createPackagedDefaultUserFxArchiveSlot() {
  return {
    name: normalizeUserFxArchiveName(PACKAGED_DEFAULT_USER_FX_ARCHIVE_NAME, 0),
    createdAt: PACKAGED_DEFAULT_USER_FX_ARCHIVE_EXPORTED_AT,
    savedAt: PACKAGED_DEFAULT_USER_FX_ARCHIVE_SAVED_AT,
    snapshot: normalizeFxArchiveSnapshot(clonePackagedDefaultFxSnapshot())
  };
}
function formatUserArchiveTime(ts) {
  ts = Number(ts) || 0;
  if (!ts) return '空槽位';
  var diff = Date.now() - ts;
  if (diff < 60000) return '刚刚保存';
  if (diff < 3600000) return Math.max(1, Math.round(diff / 60000)) + ' 分钟前';
  var d = new Date(ts);
  function pad(v) { return String(v).padStart(2, '0'); }
  return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}
function captureFxArchiveSnapshot() {
  return normalizeFxArchiveSnapshot(Object.assign({ visualPresetSchema: VISUAL_PRESET_SCHEMA }, fx));
}
function applySavedLyricPaletteState() {
  if (!stageLyrics) return;
  setStageLyricPalette(fx.lyricColorMode === 'custom'
    ? lyricPaletteFromHex(fx.lyricColor)
    : (stageLyrics.coverPalette || stageLyrics.palette));
  updateLyricColorControls();
  updateLyricHighlightControls();
  updateLyricGlowControls();
}
function applyFxArchiveSnapshot(snapshot) {
  var data = normalizeFxArchiveSnapshot(snapshot);
  if (!data) return false;
  var targetPreset = data.preset;
  Object.keys(data).forEach(function(key){
    if (key === 'visualPresetSchema' || key === 'preset') return;
    fx[key] = data[key];
  });
  normalizeDevelopmentLockedFxState();
  setPreset(targetPreset, { silent: true, preserveCamera: false, skipTransition: false, noSave: true, commitPlaybackPreset: true });
  applyCoverParticleResolution(fx.coverResolution, { reload: true });
  if (fx.floatLayer) createFloatLayer(); else destroyFloatLayer();
  setParticleLyricsSilently(fx.particleLyrics);
  if (fx.backCover) createBackCoverLayer(); else destroyBackCoverLayer();
  if (fx.aiDepth) {
    aiDepthFailUntil = 0;
    queueAIDepthForCurrentCover(true);
  }
  setShelfMode(fx.shelf);
  if (shelfManager && shelfManager.rebuild) shelfManager.rebuild(true);
  if (shelfManager && shelfManager.refreshTheme) shelfManager.refreshTheme();
  setCamMode(fx.cam);
  updateFxInputs();
  applySystemSettingsUI();
  loadMusicSourcesConfig();
  if (typeof window.desktopWindow !== 'undefined') {
    // 对话框选择后同步
    if (window.desktopWindow.onSystemSettingsChanged) {
      window.desktopWindow.onSystemSettingsChanged(function() {
        applySystemSettingsUI();
      });
    }
    // 窗口获得焦点时也刷新设置（兜底同步）
    window.addEventListener('focus', function() {
      applySystemSettingsUI();
    });
  }
  applySavedLyricPaletteState();
  refreshAllLyricLineFonts();
  applyDesktopLyricsState(true);
  applyWallpaperModeState(true);
  updateRenderPowerClasses();
  applyRendererPowerMode();
  updateMemoryControls();
  configureMemoryReductFromFx('fx-archive', false);
  saveLyricLayout();
  return true;
}
var hadStoredUserFxArchives = hasStoredUserFxArchives();
var userFxArchives = readUserFxArchives();
if (!hadStoredUserFxArchives) {
  userFxArchives = [createPackagedDefaultUserFxArchiveSlot()];
  saveUserFxArchives();
}
var userFxArchiveEditing = -1;
function handleUserFxArchiveRenameKey(e, index) {
  if (e.key === 'Enter') {
    e.preventDefault();
    commitUserFxArchiveRename(index);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    cancelUserFxArchiveRename();
  }
}

function defaultUserFxArchiveName(index) {
  return '用户存档 ' + (Number(index) + 1);
}
function normalizeUserFxArchiveName(name, index) {
  name = String(name || '').replace(/\s+/g, ' ').trim();
  if (!name) name = defaultUserFxArchiveName(index);
  return name.slice(0, 28);
}
function userFxArchiveAt(index) {
  index = Number(index);
  if (!isFinite(index)) return null;
  index = Math.floor(index);
  return index >= 0 && index < userFxArchives.length ? userFxArchives[index] : null;
}
function renderUserFxArchives() {
  var grid = document.getElementById('user-archive-grid');
  if (!grid) return;
  var toolbar =
    '<div class="user-archive-toolbar">' +
      '<div class="user-archive-note">空白新建，保存当前视觉参数；支持拖拽 JSON 导入，也可以导出为文件备份。</div>' +
      '<div class="user-archive-tools">' +
        '<button class="fx-mini-btn ghost" type="button" onclick="createUserFxArchive()">新建</button>' +
        '<button class="fx-mini-btn ghost" type="button" onclick="importUserFxArchiveFromDialog()">导入</button>' +
      '</div>' +
    '</div>';
  var cards = userFxArchives.map(function(slot, index){
    var hasSave = !!slot.snapshot;
    var editing = userFxArchiveEditing === index;
    var nameHtml = editing
      ? '<input class="user-archive-input" id="user-archive-input-' + index + '" type="text" maxlength="28" value="' + escHtml(slot.name) + '" onkeydown="handleUserFxArchiveRenameKey(event,' + index + ')">'
      : '<div class="user-archive-name" title="' + escHtml(slot.name) + '">' + escHtml(slot.name) + '</div>';
    var actionsHtml = editing
      ? '<button type="button" onclick="commitUserFxArchiveRename(' + index + ')">确定</button>' +
        '<button type="button" onclick="cancelUserFxArchiveRename()">取消</button>'
      : '<button type="button" onclick="applyUserFxArchive(' + index + ')"' + (hasSave ? '' : ' disabled') + '>应用</button>' +
        '<button type="button" onclick="saveUserFxArchive(' + index + ')">保存</button>' +
        '<button type="button" onclick="renameUserFxArchive(' + index + ')">命名</button>' +
        '<button type="button" onclick="exportUserFxArchive(' + index + ')"' + (hasSave ? '' : ' disabled') + '>导出</button>' +
        '<button type="button" onclick="removeUserFxArchive(' + index + ')">删除</button>';
    return '<div class="user-archive-slot' + (hasSave ? ' has-save' : '') + '" data-slot="' + index + '">' +
      nameHtml +
      '<div class="user-archive-meta">' + (hasSave ? formatUserArchiveTime(slot.savedAt) : '空白存档，点击保存写入当前视觉') + '</div>' +
      '<div class="user-archive-actions">' + actionsHtml + '</div>' +
    '</div>';
  }).join('');
  var addCard = '<button class="user-archive-slot is-new" type="button" onclick="createUserFxArchive()"><strong>＋ 新建空白存档</strong><span class="user-archive-meta">可继续创建，不限制 4 个</span></button>';
  grid.innerHTML = toolbar + cards + addCard;
  bindUserFxArchiveDrop();
  if (userFxArchiveEditing >= 0) {
    setTimeout(function(){
      var input = document.getElementById('user-archive-input-' + userFxArchiveEditing);
      if (input) {
        input.focus();
        input.select();
      }
    }, 0);
  }
}
function createUserFxArchive() {
  var index = userFxArchives.length;
  userFxArchives.push({
    name: normalizeUserFxArchiveName('', index),
    createdAt: Date.now(),
    savedAt: 0,
    snapshot: null
  });
  userFxArchiveEditing = index;
  saveUserFxArchives();
  renderUserFxArchives();
  showToast('已新建空白用户存档');
}
function saveUserFxArchive(index) {
  var slot = userFxArchiveAt(index);
  if (!slot) return;
  slot.snapshot = captureFxArchiveSnapshot();
  slot.savedAt = Date.now();
  slot.createdAt = slot.createdAt || slot.savedAt;
  slot.name = normalizeUserFxArchiveName(slot.name, index);
  saveUserFxArchives();
  renderUserFxArchives();
  showToast('已保存到 ' + slot.name);
}
function applyUserFxArchive(index) {
  var slot = userFxArchiveAt(index);
  if (!slot || !slot.snapshot) {
    showToast('这个用户存档还是空白');
    return;
  }
  if (applyFxArchiveSnapshot(slot.snapshot)) showToast('已应用 ' + slot.name);
}
function renameUserFxArchive(index) {
  if (!userFxArchiveAt(index)) return;
  userFxArchiveEditing = Math.floor(Number(index) || 0);
  renderUserFxArchives();
}
function commitUserFxArchiveRename(index) {
  var slot = userFxArchiveAt(index);
  if (!slot) return;
  var input = document.getElementById('user-archive-input-' + index);
  slot.name = normalizeUserFxArchiveName(input && input.value, index);
  slot.createdAt = slot.createdAt || Date.now();
  userFxArchiveEditing = -1;
  saveUserFxArchives();
  renderUserFxArchives();
  showToast('已命名为 ' + slot.name);
}
function cancelUserFxArchiveRename() {
  userFxArchiveEditing = -1;
  renderUserFxArchives();
}
function removeUserFxArchive(index) {
  if (!userFxArchiveAt(index)) return;
  userFxArchives.splice(index, 1);
  userFxArchiveEditing = -1;
  saveUserFxArchives();
  renderUserFxArchives();
  showToast('已删除用户存档');
}
function userFxArchiveExportPayload(slot) {
  return {
    type: USER_FX_ARCHIVE_EXPORT_TYPE,
    schema: USER_FX_ARCHIVE_SCHEMA,
    exportedAt: Date.now(),
    name: slot.name,
    savedAt: slot.savedAt,
    snapshot: slot.snapshot
  };
}
function safeArchiveFileName(name) {
  return String(name || 'BhandsMusic 用户存档').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 48) + '.json';
}
function exportUserFxArchive(index) {
  var slot = userFxArchiveAt(index);
  if (!slot || !slot.snapshot) {
    showToast('空白存档不能导出');
    return;
  }
  var payload = userFxArchiveExportPayload(slot);
  var text = JSON.stringify(payload, null, 2);
  var api = getDesktopWindowApi && getDesktopWindowApi();
  if (api && typeof api.exportJsonFile === 'function') {
    api.exportJsonFile({ defaultName: safeArchiveFileName(slot.name), text: text }).then(function(res){
      if (res && res.ok) showToast('用户存档已导出');
      else if (!res || !res.canceled) showToast('用户存档导出失败');
    }).catch(function(){ showToast('用户存档导出失败'); });
    return;
  }
  var blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = safeArchiveFileName(slot.name);
  a.click();
  setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
}
function normalizeImportedFxArchivePayload(payload, fileName) {
  if (!payload || typeof payload !== 'object') return null;
  var snapshot = payload.snapshot ? normalizeFxArchiveSnapshot(payload.snapshot) : normalizeFxArchiveSnapshot(payload);
  if (!snapshot) return null;
  var baseName = String(fileName || '').split(/[\\/]/).pop().replace(/\.json$/i, '');
  return {
    name: normalizeUserFxArchiveName(payload.name || baseName, userFxArchives.length),
    createdAt: Date.now(),
    savedAt: Number(payload.savedAt) || Date.now(),
    snapshot: snapshot
  };
}
function importUserFxArchiveText(text, fileName) {
  var payload = null;
  try { payload = JSON.parse(String(text || '')); } catch (e) {}
  var slot = normalizeImportedFxArchivePayload(payload, fileName);
  if (!slot) {
    showToast('导入失败，文件不是有效的用户存档');
    return false;
  }
  userFxArchives.push(slot);
  saveUserFxArchives();
  renderUserFxArchives();
  showToast('已导入 ' + slot.name);
  return true;
}
function importUserFxArchiveFromDialog() {
  var api = getDesktopWindowApi && getDesktopWindowApi();
  if (api && typeof api.importJsonFile === 'function') {
    api.importJsonFile().then(function(res){
      if (res && res.ok) importUserFxArchiveText(res.text, res.filePath || '用户存档.json');
      else if (!res || !res.canceled) showToast('导入失败');
    }).catch(function(){ showToast('导入失败'); });
    return;
  }
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = function(){
    var file = input.files && input.files[0];
    if (file) readUserFxArchiveImportFile(file);
  };
  input.click();
}
function readUserFxArchiveImportFile(file) {
  if (!file || !/\.json$/i.test(file.name || '')) {
    showToast('请导入 JSON 用户存档');
    return;
  }
  var reader = new FileReader();
  reader.onload = function(e){ importUserFxArchiveText(e.target && e.target.result, file.name); };
  reader.onerror = function(){ showToast('导入失败'); };
  reader.readAsText(file, 'utf-8');
}
function bindUserFxArchiveDrop() {
  var grid = document.getElementById('user-archive-grid');
  if (!grid || grid._archiveDropBound) return;
  grid._archiveDropBound = true;
  grid.addEventListener('dragover', function(e){
    if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
    e.preventDefault();
    grid.classList.add('dragover');
  });
  grid.addEventListener('dragleave', function(e){
    if (!grid.contains(e.relatedTarget)) grid.classList.remove('dragover');
  });
  grid.addEventListener('drop', function(e){
    if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
    e.preventDefault();
    grid.classList.remove('dragover');
    Array.prototype.forEach.call(e.dataTransfer.files, readUserFxArchiveImportFile);
  });
}

function buildLyricColorControls() {
  var grid = document.getElementById('lyric-color-grid');
  if (!grid) return;
  var html = '<button class="lyric-swatch auto" type="button" data-auto="1" onclick="setLyricColorAuto()" title="封面取色">AUTO</button>';
  html += lyricColorPresets.map(function(p, i){
    return '<button class="lyric-swatch" type="button" data-color="' + p.color + '" onclick="setLyricColorPreset(' + i + ')" title="' + escHtml(p.name) + '" style="--swatch:' + p.color + '"></button>';
  }).join('');
  grid.innerHTML = html;
}
function updateLyricColorControls() {
  var picker = document.getElementById('lyric-color-picker');
  var value = document.getElementById('lyric-color-value');
  var autoBtn = document.getElementById('lyric-auto-btn');
  var color = normalizeHexColor(fx.lyricColor);
  if (picker) picker.value = color;
  if (value) value.textContent = fx.lyricColorMode === 'custom' ? color.toUpperCase() : '封面取色';
  if (autoBtn) autoBtn.classList.toggle('active', fx.lyricColorMode !== 'custom');
  document.querySelectorAll('.lyric-swatch').forEach(function(btn){
    var isAuto = btn.dataset.auto === '1';
    var isColor = normalizeHexColor(btn.dataset.color || '') === color;
    btn.classList.toggle('active', isAuto ? fx.lyricColorMode !== 'custom' : (fx.lyricColorMode === 'custom' && isColor));
  });
}
function updateLyricHighlightControls() {
  var picker = document.getElementById('lyric-highlight-picker');
  var value = document.getElementById('lyric-highlight-value');
  var autoBtn = document.getElementById('lyric-highlight-auto-btn');
  var color = normalizeHexColor(fx.lyricHighlightColor);
  if (picker) picker.value = color;
  if (value) value.textContent = fx.lyricHighlightMode === 'custom' ? color.toUpperCase() : '跟随歌词';
  if (autoBtn) autoBtn.classList.toggle('active', fx.lyricHighlightMode !== 'custom');
}
function updateLyricGlowControls() {
  var row = document.getElementById('lyric-glow-row');
  var picker = document.getElementById('lyric-glow-picker');
  var value = document.getElementById('lyric-glow-value');
  var linkBtn = document.getElementById('lyric-glow-link-btn');
  var linked = fx.lyricGlowLinked !== false;
  var color = normalizeHexColor(fx.lyricGlowColor || '#9db8cf');
  if (picker) picker.value = color;
  if (row) row.classList.toggle('linked', linked);
  if (value) value.textContent = linked ? '跟随高亮' : color.toUpperCase();
  if (linkBtn) {
    linkBtn.classList.toggle('active', linked);
    linkBtn.textContent = linked ? '链接' : '独立';
    linkBtn.title = linked ? '点击后单独设置溢光颜色' : '点击后让溢光跟随高亮';
  }
}
function applyHomeAccentColor() {
  var color = normalizeHexColor(fx.homeAccentColor || '#00f5d4');
  var rgb = hexToRgb(color);
  document.documentElement.style.setProperty('--home-accent', color);
  document.documentElement.style.setProperty('--home-accent-rgb', rgb.r + ',' + rgb.g + ',' + rgb.b);
}
function updateHomeAccentControls() {
  applyHomeAccentColor();
  var color = normalizeHexColor(fx.homeAccentColor || '#00f5d4');
  var picker = document.getElementById('home-accent-picker');
  var value = document.getElementById('home-accent-value');
  if (picker) picker.value = color;
  if (value) value.textContent = color.toUpperCase();
}
function setHomeAccentColor(color, silent) {
  fx.homeAccentColor = normalizeHexColor(color || '#00f5d4');
  updateHomeAccentControls();
  saveLyricLayout();
  if (!silent) showToast('Home 填充: ' + fx.homeAccentColor.toUpperCase());
}
function resetHomeAccentColor() {
  setHomeAccentColor(fxDefaults.homeAccentColor || '#00f5d4');
}
function applyIconAccentColors() {
  var homeColor = normalizeHexColor(fx.homeIconColor || fxDefaults.homeIconColor || '#f4d28a', '#f4d28a');
  var visualColor = normalizeHexColor(fx.visualIconColor || fxDefaults.visualIconColor || '#7fd8ff', '#7fd8ff');
  var homeRgb = hexToRgb(homeColor);
  var visualRgb = hexToRgb(visualColor);
  var root = document.documentElement;
  root.style.setProperty('--home-icon-color', homeColor);
  root.style.setProperty('--home-icon-rgb', homeRgb.r + ',' + homeRgb.g + ',' + homeRgb.b);
  root.style.setProperty('--visual-icon-color', visualColor);
  root.style.setProperty('--visual-icon-rgb', visualRgb.r + ',' + visualRgb.g + ',' + visualRgb.b);
}
function updateIconAccentControls() {
  applyIconAccentColors();
  var homeColor = normalizeHexColor(fx.homeIconColor || fxDefaults.homeIconColor || '#f4d28a', '#f4d28a');
  var visualColor = normalizeHexColor(fx.visualIconColor || fxDefaults.visualIconColor || '#7fd8ff', '#7fd8ff');
  var homePicker = document.getElementById('home-icon-picker');
  var homeValue = document.getElementById('home-icon-value');
  var visualPicker = document.getElementById('visual-icon-picker');
  var visualValue = document.getElementById('visual-icon-value');
  if (homePicker) homePicker.value = homeColor;
  if (homeValue) homeValue.textContent = homeColor.toUpperCase();
  if (visualPicker) visualPicker.value = visualColor;
  if (visualValue) visualValue.textContent = visualColor.toUpperCase();
}
function setHomeIconColor(color, silent) {
  fx.homeIconColor = normalizeHexColor(color || fxDefaults.homeIconColor || '#f4d28a', '#f4d28a');
  updateIconAccentControls();
  saveLyricLayout();
  if (!silent) showToast('主页图标: ' + fx.homeIconColor.toUpperCase());
}
function resetHomeIconColor() {
  setHomeIconColor(fxDefaults.homeIconColor || '#f4d28a');
}
function setVisualIconColor(color, silent) {
  fx.visualIconColor = normalizeHexColor(color || fxDefaults.visualIconColor || '#7fd8ff', '#7fd8ff');
  updateIconAccentControls();
  saveLyricLayout();
  if (!silent) showToast('视觉图标: ' + fx.visualIconColor.toUpperCase());
}
function resetVisualIconColor() {
  setVisualIconColor(fxDefaults.visualIconColor || '#7fd8ff');
}
function applyCustomBackground() {
  var color = normalizeHexColor(fx.backgroundColor || '#000000', '#000000');
  var media = normalizeCustomBackgroundMedia(fx.backgroundMedia || fx.backgroundImage);
  var image = media && media.type === 'image' ? media.src : '';
  var hasVideo = !!(media && media.type === 'video');
  var opacity = clampRange(fx.backgroundOpacity == null ? 1 : Number(fx.backgroundOpacity), 0, 1);
  var customColor = fx.backgroundColorMode === 'custom' || !!fx.backgroundColorCustom;
  var override = !!media || customColor || opacity < 1;
  var root = document.documentElement;
  var layer = document.getElementById('custom-bg');
  var video = document.getElementById('custom-bg-video');
  root.style.setProperty('--custom-bg-color', color);
  document.body.classList.toggle('custom-background-override', override);
  document.body.classList.toggle('custom-background-flat', override && !media);
  document.body.classList.toggle('custom-background-video', hasVideo);
  if (layer) {
    layer.style.setProperty('--custom-bg-image', image ? 'url("' + cssImageUrl(image) + '")' : 'none');
    layer.style.setProperty('--custom-bg-image-opacity', image ? opacity.toFixed(3) : '0');
    layer.style.setProperty('--custom-bg-video-opacity', hasVideo ? opacity.toFixed(3) : '0');
    layer.style.setProperty('--custom-bg-overlay-opacity', media ? '0.18' : '0');
  }
  var token = ++customBgApplyToken;
  if (!video) return;
  if (!hasVideo) {
    video.pause();
    video.removeAttribute('src');
    video.load();
    if (customBgObjectUrl) { URL.revokeObjectURL(customBgObjectUrl); customBgObjectUrl = ''; }
    return;
  }
  function setVideoSrc(src) {
    if (token !== customBgApplyToken || !src) return;
    if (customBgObjectUrl && customBgObjectUrl !== src) { URL.revokeObjectURL(customBgObjectUrl); customBgObjectUrl = ''; }
    if (video.getAttribute('src') !== src) {
      video.setAttribute('src', src);
      video.load();
    }
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    var p = video.play();
    if (p && p.catch) p.catch(function(){});
  }
  if (media.src) {
    setVideoSrc(media.src);
  } else if (media.id) {
    getCustomBackgroundBlob(media.id).then(function(blob){
      if (token !== customBgApplyToken || !blob) return;
      if (customBgObjectUrl) URL.revokeObjectURL(customBgObjectUrl);
      customBgObjectUrl = URL.createObjectURL(blob);
      setVideoSrc(customBgObjectUrl);
    }).catch(function(err){ console.warn('background video load failed:', err); });
  }
}
function updateCustomBackgroundControls() {
  applyCustomBackground();
  var color = normalizeHexColor(fx.backgroundColor || '#000000', '#000000');
  var picker = document.getElementById('bg-color-picker');
  var value = document.getElementById('bg-color-value');
  var imageValue = document.getElementById('bg-image-value');
  var customColor = fx.backgroundColorMode === 'custom' || !!fx.backgroundColorCustom;
  if (picker) picker.value = color;
  if (value) value.textContent = customColor ? color.toUpperCase() : '\u5c01\u9762\u6e10\u53d8';
  if (picker && picker.closest) {
    var row = picker.closest('.lyric-color-row');
    if (row) row.classList.toggle('bg-cover-mode', !customColor);
  }
  setRange('fx-bgopacity', fx.backgroundOpacity == null ? 1 : fx.backgroundOpacity);
  if (imageValue) imageValue.textContent = customBackgroundMediaLabel(fx.backgroundMedia || fx.backgroundImage);
  applyBackgroundMediaHint();
}
function setCustomBackgroundColor(color, silent, customFlag) {
  fx.backgroundColor = normalizeHexColor(color || '#000000', '#000000');
  fx.backgroundColorMode = customFlag === false ? 'cover' : 'custom';
  fx.backgroundColorCustom = customFlag !== false;
  updateCustomBackgroundControls();
  saveLyricLayout();
  if (!silent) showToast('背景颜色: ' + fx.backgroundColor.toUpperCase());
}
function setCustomBackgroundCoverMode(silent) {
  fx.backgroundColorMode = 'cover';
  fx.backgroundColorCustom = false;
  fx.backgroundColor = normalizeHexColor(fx.backgroundColor || fxDefaults.backgroundColor || '#000000', '#000000');
  updateCustomBackgroundControls();
  saveLyricLayout();
  if (!silent) showToast('\u80cc\u666f\u989c\u8272: \u5c01\u9762\u6e10\u53d8');
}
function resetCustomBackgroundColor() {
  setCustomBackgroundCoverMode(false);
}
function setCustomBackgroundImage(src, silent) {
  var image = normalizeCustomBackgroundImage(src);
  fx.backgroundImage = image;
  fx.backgroundMedia = image ? { type: 'image', src: image } : null;
  updateCustomBackgroundControls();
  saveLyricLayout();
  if (!silent) showToast(fx.backgroundImage ? '背景图片已应用' : '背景图片已清除');
}
function setCustomBackgroundMedia(media, silent) {
  media = normalizeCustomBackgroundMedia(media);
  fx.backgroundMedia = media;
  fx.backgroundImage = media && media.type === 'image' ? media.src : '';
  updateCustomBackgroundControls();
  saveLyricLayout();
  if (!silent) showToast(media ? (media.type === 'video' ? '背景视频已应用' : '背景图片已应用') : '背景媒体已清除');
}
function readBackgroundImageFile(file) {
  if (!file || !/^image\//i.test(file.type || '')) {
    showToast('请选择图片文件');
    return;
  }
  var reader = new FileReader();
  reader.onload = function(e) {
    var img = new Image();
    img.onload = function() {
      var maxSide = 2200;
      var iw = img.naturalWidth || img.width || 1;
      var ih = img.naturalHeight || img.height || 1;
      var scale = Math.min(1, maxSide / Math.max(iw, ih));
      var w = Math.max(1, Math.round(iw * scale));
      var h = Math.max(1, Math.round(ih * scale));
      var cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      var cx = cv.getContext('2d');
      cx.drawImage(img, 0, 0, w, h);
      var out = '';
      try { out = cv.toDataURL('image/webp', 0.84); } catch (err) {}
      if (!/^data:image\/webp/i.test(out)) {
        try { out = cv.toDataURL('image/jpeg', 0.86); } catch (err2) { out = String(e.target.result || ''); }
      }
      setCustomBackgroundImage(out);
    };
    img.onerror = function(){ showToast('背景图片读取失败'); };
    img.src = e.target.result;
  };
  reader.onerror = function(){ showToast('背景图片读取失败'); };
  reader.readAsDataURL(file);
}
function readBackgroundVideoFile(file) {
  if (!file || !/^video\//i.test(file.type || '')) {
    showToast('请选择视频文件');
    return;
  }
  var id = 'bg-video-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  putCustomBackgroundBlob(id, file, { name: file.name || '', mime: file.type || '', size: file.size || 0 }).then(function(){
    setCustomBackgroundMedia({ type: 'video', id: id, name: file.name || '', mime: file.type || '', size: file.size || 0 });
  }).catch(function(err){
    console.warn('background video store failed:', err);
    if ((file.size || 0) > 18 * 1024 * 1024) {
      showToast('视频较大，当前环境无法保存，请换小一点的视频');
      return;
    }
    var reader = new FileReader();
    reader.onload = function(e){
      setCustomBackgroundMedia({ type: 'video', src: String(e.target.result || ''), name: file.name || '', mime: file.type || '', size: file.size || 0 });
    };
    reader.onerror = function(){ showToast('背景视频读取失败'); };
    reader.readAsDataURL(file);
  });
}
function readBackgroundMediaFile(file) {
  if (!file) return;
  if (/^image\//i.test(file.type || '')) readBackgroundImageFile(file);
  else if (/^video\//i.test(file.type || '')) readBackgroundVideoFile(file);
  else showToast('请选择图片或视频文件');
}
function applyUiAccentColor() {
  var color = normalizeHexColor(fx.uiAccentColor || '#00f5d4', '#00f5d4');
  var rgb = hexToRgb(color);
  var root = document.documentElement;
  root.style.setProperty('--fc-accent', color);
  root.style.setProperty('--fc-accent-hov', color);
  root.style.setProperty('--fc-accent-rgb', rgb.r + ',' + rgb.g + ',' + rgb.b);
  root.style.setProperty('--glass-border', 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',.30)');
  root.style.setProperty('--glass-shadow-focus', '0 24px 72px rgba(0,0,0,.34),0 0 0 1px rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',.13),0 0 42px rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',.075),inset 0 1px 0 rgba(255,255,255,.20)');
}
function updateUiAccentControls() {
  applyUiAccentColor();
  var color = normalizeHexColor(fx.uiAccentColor || '#00f5d4', '#00f5d4');
  var picker = document.getElementById('ui-accent-picker');
  var value = document.getElementById('ui-accent-value');
  if (picker) picker.value = color;
  if (value) value.textContent = color.toUpperCase();
}
function setUiAccentColor(color, silent) {
  fx.uiAccentColor = normalizeHexColor(color || '#00f5d4', '#00f5d4');
  updateUiAccentControls();
  if (shelfManager && shelfManager.refreshTheme) shelfManager.refreshTheme();
  saveLyricLayout();
  if (!silent) showToast('界面高亮: ' + fx.uiAccentColor.toUpperCase());
}
function resetUiAccentColor() {
  setUiAccentColor(fxDefaults.uiAccentColor || '#00f5d4');
}
function updateVisualTintControls() {
  var picker = document.getElementById('visual-tint-picker');
  var value = document.getElementById('visual-tint-value');
  var autoBtn = document.getElementById('visual-tint-auto-btn');
  var color = normalizeHexColor(fx.visualTintColor || '#9db8cf');
  document.documentElement.style.setProperty('--visual-tint', color);
  if (picker) picker.value = color;
  if (value) value.textContent = fx.visualTintMode === 'custom' ? color.toUpperCase() : '封面取色';
  if (autoBtn) autoBtn.classList.toggle('active', fx.visualTintMode !== 'custom');
}
function setVisualTintAuto() {
  fx.visualTintMode = 'auto';
  updateVisualTintControls();
  syncFxUniforms();
  saveLyricLayout();
  showToast('视觉主色: 封面取色');
}
function resetVisualTintColor() {
  fx.visualTintMode = 'auto';
  fx.visualTintColor = normalizeHexColor(fxDefaults.visualTintColor || '#9db8cf');
  updateVisualTintControls();
  syncFxUniforms();
  saveLyricLayout();
  showToast('视觉主色已恢复默认');
}
function setVisualTintCustom(color, silent) {
  fx.visualTintMode = 'custom';
  fx.visualTintColor = normalizeHexColor(color || '#9db8cf');
  updateVisualTintControls();
  syncFxUniforms();
  saveLyricLayout();
  if (!silent) showToast('视觉主色: ' + fx.visualTintColor.toUpperCase());
}
var coverColorPickerState = { target: 'visualTint', canvas: null };
function currentCoverPickerCanvas() {
  if (coverPickerCanvas && coverPickerCanvas.getContext) return coverPickerCanvas;
  if (coverTex && coverTex.image && coverTex.image.getContext) return coverTex.image;
  return null;
}
function coverPickerSwatchColors() {
  var pal = stageLyrics.coverPalette || stageLyrics.palette || {};
  var list = [pal.primary, pal.secondary, pal.highlight, fx.visualTintColor, fx.uiAccentColor, fx.homeAccentColor]
    .map(function(c){ return normalizeHexColor(c || '', ''); })
    .filter(function(c){ return /^#[0-9a-f]{6}$/i.test(c); });
  var seen = {};
  return list.filter(function(c){
    if (seen[c]) return false;
    seen[c] = true;
    return true;
  }).slice(0, 5);
}
function setCoverPickerPreview(hex) {
  var preview = document.getElementById('cover-color-preview');
  if (preview) preview.style.setProperty('--picked', normalizeHexColor(hex || '#9db8cf'));
}
function renderCoverPickerSwatches() {
  var wrap = document.getElementById('cover-color-swatches');
  if (!wrap) return;
  var colors = coverPickerSwatchColors();
  wrap.innerHTML = colors.map(function(c){
    return '<button type="button" style="--c:' + c + '" title="' + c.toUpperCase() + '" onclick="applyCoverPickerColor(\'' + c + '\')"></button>';
  }).join('');
}
function openCoverColorPicker(target) {
  target = target || 'visualTint';
  var pop = document.getElementById('cover-color-pop');
  var art = document.getElementById('cover-color-art');
  var hint = document.getElementById('cover-color-hint');
  if (pop && pop.classList.contains('show') && coverColorPickerState.target === target) {
    closeCoverColorPicker();
    return;
  }
  var cv = currentCoverPickerCanvas();
  coverColorPickerState.target = target;
  coverColorPickerState.canvas = cv;
  if (!pop || !art) return;
  if (!cv) {
    setVisualTintAuto();
    closeCoverColorPicker();
    showToast('暂无封面，已切换为自动封面取色');
    return;
  }
  var imgSrc = '';
  try { imgSrc = cv.toDataURL('image/jpeg', 0.84); } catch (e) {}
  if (!imgSrc && currentCoverSource && currentCoverSource.src) imgSrc = currentCoverSource.src;
  art.style.backgroundImage = imgSrc ? 'url("' + cssImageUrl(imgSrc) + '")' : '';
  setCoverPickerPreview(fx.visualTintColor || (stageLyrics.coverPalette && stageLyrics.coverPalette.primary) || '#9db8cf');
  renderCoverPickerSwatches();
  if (hint) hint.textContent = '点击专辑封面任意位置取色，或使用下方推荐色。';
  pop.classList.add('show');
  placeFxFloatingPanel(pop, document.getElementById('visual-tint-auto-btn') || document.getElementById('visual-tint-picker') || art, { gap: 12, pad: 14 });
}
function closeCoverColorPicker() {
  var pop = document.getElementById('cover-color-pop');
  if (pop) pop.classList.remove('show');
  hideCoverColorLoupe();
}
function applyCoverPickerColor(hex) {
  hex = normalizeHexColor(hex || '#9db8cf');
  setCoverPickerPreview(hex);
  if (coverColorPickerState.target === 'visualTint') {
    setVisualTintCustom(hex, true);
    showToast('视觉主色: ' + hex.toUpperCase());
  }
  closeCoverColorPicker();
}
function moveCoverColorLoupe(e) {
  var cv = coverColorPickerState.canvas || currentCoverPickerCanvas();
  var loupe = document.getElementById('cover-color-loupe');
  var art = document.getElementById('cover-color-art');
  if (!cv || !loupe || !art) return;
  var rect = art.getBoundingClientRect();
  var x = clampRange((e.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
  var y = clampRange((e.clientY - rect.top) / Math.max(1, rect.height), 0, 1);
  var imgSrc = '';
  try { imgSrc = cv.toDataURL('image/jpeg', 0.84); } catch (err) {}
  if (imgSrc) {
    loupe.style.backgroundImage = 'url("' + cssImageUrl(imgSrc) + '")';
    loupe.style.backgroundSize = '680% 680%';
    loupe.style.backgroundPosition = (x * 100).toFixed(2) + '% ' + (y * 100).toFixed(2) + '%';
  }
  loupe.style.left = Math.min(window.innerWidth - 128, e.clientX + 18) + 'px';
  loupe.style.top = Math.min(window.innerHeight - 128, e.clientY + 18) + 'px';
  loupe.classList.add('show');
}
function hideCoverColorLoupe() {
  var loupe = document.getElementById('cover-color-loupe');
  if (loupe) loupe.classList.remove('show');
}
function pickCoverColorFromArt(e) {
  var cv = coverColorPickerState.canvas || currentCoverPickerCanvas();
  if (!cv || !cv.getContext) return;
  var rect = e.currentTarget.getBoundingClientRect();
  var x = clampRange((e.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
  var y = clampRange((e.clientY - rect.top) / Math.max(1, rect.height), 0, 1);
  var sx = Math.max(0, Math.min(cv.width - 1, Math.floor(x * cv.width)));
  var sy = Math.max(0, Math.min(cv.height - 1, Math.floor(y * cv.height)));
  try {
    var data = cv.getContext('2d').getImageData(sx, sy, 1, 1).data;
    applyCoverPickerColor(rgbToHexColor(data[0], data[1], data[2]));
  } catch (err) {
    showToast('封面取色不可用，已保留自动取色');
    setVisualTintAuto();
    closeCoverColorPicker();
  }
}
function updateLyricFontControls() {
  document.querySelectorAll('#lyric-font-grid button').forEach(function(btn){
    btn.classList.toggle('active', btn.dataset.font === normalizeLyricFontKey(fx.lyricFont));
  });
}
function setLyricFont(key) {
  fx.lyricFont = normalizeLyricFontKey(key);
  updateLyricFontControls();
  refreshAllLyricLineFonts();
  saveLyricLayout();
  pushDesktopLyricsState(true);
  showToast('歌词字体已切换');
}
function setLyricGlowLinked(linked, openPicker) {
  fx.lyricGlowLinked = linked !== false;
  if (!fx.lyricGlowLinked) fx.lyricGlowColor = normalizeHexColor(fx.lyricGlowColor || fx.lyricHighlightColor || '#9db8cf');
  setStageLyricPalette(fx.lyricColorMode === 'custom' ? lyricPaletteFromHex(fx.lyricColor) : (stageLyrics.coverPalette || stageLyrics.palette));
  updateLyricGlowControls();
  saveLyricLayout();
  if (openPicker) {
    setTimeout(function(){
      var picker = document.getElementById('lyric-glow-picker');
      if (picker) picker.click();
    }, 0);
  }
}
function toggleLyricGlowLink(e) {
  if (e && e.stopPropagation) e.stopPropagation();
  setLyricGlowLinked(fx.lyricGlowLinked === false);
}
function handleLyricGlowRowClick(e) {
  if (fx.lyricGlowLinked !== false) {
    if (e && e.preventDefault) e.preventDefault();
    setLyricGlowLinked(false, true);
  }
}
function setLyricGlowCustom(color, silent) {
  fx.lyricGlowLinked = false;
  fx.lyricGlowColor = normalizeHexColor(color || '#9db8cf');
  setStageLyricPalette(fx.lyricColorMode === 'custom' ? lyricPaletteFromHex(fx.lyricColor) : (stageLyrics.coverPalette || stageLyrics.palette));
  updateLyricGlowControls();
  saveLyricLayout();
  pushDesktopLyricsState(true);
  if (!silent) showToast('溢光颜色: ' + fx.lyricGlowColor.toUpperCase());
}
function setLyricColorAuto() {
  fx.lyricColorMode = 'auto';
  setStageLyricPalette(stageLyrics.coverPalette || stageLyrics.palette);
  updateLyricColorControls();
  updateLyricHighlightControls();
  updateLyricGlowControls();
  saveLyricLayout();
  pushDesktopLyricsState(true);
  showToast('歌词颜色: 封面取色');
}
function setLyricColorCustom(color, silent) {
  fx.lyricColorMode = 'custom';
  fx.lyricColor = normalizeHexColor(color);
  setStageLyricPalette(lyricPaletteFromHex(fx.lyricColor));
  updateLyricColorControls();
  updateLyricHighlightControls();
  updateLyricGlowControls();
  saveLyricLayout();
  pushDesktopLyricsState(true);
  if (!silent) showToast('歌词颜色: ' + fx.lyricColor.toUpperCase());
}
function setLyricColorPreset(i) {
  var p = lyricColorPresets[i];
  if (!p) return;
  setLyricColorCustom(p.color);
}
function setLyricHighlightAuto() {
  fx.lyricHighlightMode = 'auto';
  setStageLyricPalette(fx.lyricColorMode === 'custom' ? lyricPaletteFromHex(fx.lyricColor) : (stageLyrics.coverPalette || stageLyrics.palette));
  updateLyricHighlightControls();
  updateLyricGlowControls();
  saveLyricLayout();
  pushDesktopLyricsState(true);
  showToast('高亮颜色: 跟随歌词');
}
function setLyricHighlightCustom(color, silent) {
  fx.lyricHighlightMode = 'custom';
  fx.lyricHighlightColor = normalizeHexColor(color);
  setStageLyricPalette(fx.lyricColorMode === 'custom' ? lyricPaletteFromHex(fx.lyricColor) : (stageLyrics.coverPalette || stageLyrics.palette));
  updateLyricHighlightControls();
  updateLyricGlowControls();
  saveLyricLayout();
  pushDesktopLyricsState(true);
  if (!silent) showToast('高亮颜色: ' + fx.lyricHighlightColor.toUpperCase());
}

function buildPresetGrid() {
  var grid = document.getElementById('preset-grid');
  if (!grid) return;
  var seen = {};
  var order = presetDisplayOrder.filter(function(id){
    var ok = id >= 0 && id < presetMeta.length && !seen[id];
    seen[id] = true;
    return ok;
  });
  presetMeta.forEach(function(_, id){
    if (!seen[id]) order.push(id);
  });
  grid.innerHTML = order.map(function(i){
    var p = presetMeta[i];
    var desc = p.descHtml || p.desc;
    return '<div class="preset-card" data-preset="' + i + '" onclick="setPreset(' + i + ')">' +
      '<div class="pc-icon">' + presetIcons[i] + '</div>' +
      '<div class="pc-name">' + p.name + '</div>' +
      '<div class="pc-desc">' + desc + '</div>' +
    '</div>';
  }).join('');
  refreshPresetGrid();
}
function refreshPresetGrid() {
  document.querySelectorAll('.preset-card').forEach(function(el){
    el.classList.toggle('active', Number(el.dataset.preset) === fx.preset);
  });
}
function triggerPresetParticleTransition(fromPreset, toPreset) {
  presetTransition.active = true;
  presetTransition.start = uniforms.uTime.value;
  presetTransition.duration = toPreset === 5 ? 0.30 : 0.24;
  presetTransition.from = fromPreset;
  presetTransition.to = toPreset;
  var newVisual = toPreset >= 4;
  var wallpaperFlow = toPreset === 5;
  uniforms.uScatter.value = Math.max(uniforms.uScatter.value, fx.scatter + (newVisual ? (wallpaperFlow ? 0.008 : 0.024) : 0.12));
  uniforms.uBurstAmt.value = Math.max(uniforms.uBurstAmt.value, wallpaperFlow ? 0.05 : 0.15);
  camPunch = Math.max(camPunch, wallpaperFlow ? 0.04 : 0.12);
  for (var i = 0; i < 3; i++) {
    triggerRipple((Math.random() - 0.5) * 3.4, (Math.random() - 0.5) * 3.4, 0.58 + Math.random() * 0.32);
  }
  var card = document.querySelector('.preset-card[data-preset="' + toPreset + '"]');
  if (card) {
    card.classList.remove('switching');
    void card.offsetWidth;
    card.classList.add('switching');
    setTimeout(function(){ card.classList.remove('switching'); }, 760);
  }
}
function tickPresetTransition() {
  if (!presetTransition.active) return;
  var raw = (uniforms.uTime.value - presetTransition.start) / presetTransition.duration;
  var t = Math.max(0, Math.min(1, raw));
  var wave = Math.sin(t * Math.PI);
  var newVisual = presetTransition.to >= 4;
  var wallpaperFlow = presetTransition.to === 5;
  uniforms.uScatter.value = Math.max(uniforms.uScatter.value, fx.scatter + wave * (newVisual ? (wallpaperFlow ? 0.008 : 0.026) : 0.16));
  uniforms.uBurstAmt.value = Math.max(uniforms.uBurstAmt.value, wave * (wallpaperFlow ? 0.045 : (newVisual ? 0.12 : 0.15)));
  uniforms.uPointScale.value = fx.point * (1 + wave * (wallpaperFlow ? 0.016 : 0.048));
  if (raw >= 1) {
    presetTransition.active = false;
    syncFxUniforms();
  }
}
function setPreset(p, opts) {
  opts = opts || {};
  p = Math.max(0, Math.min(presetMeta.length - 1, Number(p) || 0));
  var prev = fx.preset;
  var changed = prev !== p;
  fx.preset = p;
  // 音域回响两预设的清场/预热钩子（对齐上游 preset-grid onPresetChange）
  if (changed) {
    if (window.MineradioSonicTopography) MineradioSonicTopography.onPresetChange(prev, p, { scene: scene, fx: fx });
    if (window.MineradioSonicWorkshop) MineradioSonicWorkshop.onPresetChange(prev, p, { scene: scene, fx: fx });
  }
  if (changed && prev === SKULL_PRESET_INDEX && p !== SKULL_PRESET_INDEX) clearSkullPresetResidue();
  if (p === SKULL_PRESET_INDEX) loadSkullParticleAsset();
  uniforms.uPreset.value = p;
  if (typeof WebFxPresets !== 'undefined') {
    WebFxPresets.onPresetChanged(prev, p, {
      material: material,
      boostGrid: function (mul) {
        var base = coverParticleGridForResolution(fx.coverResolution);
        var next = mul === 1 ? base : (Math.round(base * mul) | 1);
        if (next === GRID_X) return false;
        var oldGeo = geo;
        var nextGeo = buildCoverParticleGeometry(next);
        geo = nextGeo;
        GRID_X = GRID_Y = next;
        PCOUNT = next * next;
        if (particles) particles.geometry = nextGeo;
        if (bloomParticles) bloomParticles.geometry = nextGeo;
        if (oldGeo && oldGeo !== nextGeo) oldGeo.dispose();
        uniforms.uGrid.value = next;
        return true;
      }
    });
  }
  refreshPresetGrid();
  if (changed && !opts.skipTransition) triggerPresetParticleTransition(prev, p);
  // 每个预设对应的相机基线 (改 userOrbit)
  if (changed && !opts.preserveCamera && p !== 5) {
    var webCam = (typeof WebFxPresets !== 'undefined' && WebFxPresets.PRESET_CAMERA) ? WebFxPresets.PRESET_CAMERA[p] : null;
    if (webCam) {
      orbit.userRadius = webCam.radius; orbit.userPhi = webCam.phi; orbit.userTheta = 0.0;
      orbit.baselineRadius = webCam.radius; orbit.baselinePhi = webCam.phi;
      orbit.baselineTheta = 0.0;
    } else if (p === 1)      { orbit.userRadius = 6.2; orbit.userPhi = 0.03; orbit.userTheta = 0.0; orbit.baselineRadius = 6.2; orbit.baselinePhi = 0.03; }
    else if (p === 2) { orbit.userRadius = 7.0; orbit.userPhi = 0.15; orbit.userTheta = 0.0; orbit.baselineRadius = 7.0; orbit.baselinePhi = 0.15; }
    else if (p === 3) { orbit.userRadius = 8.0; orbit.userPhi = 0.05; orbit.userTheta = 0.0; orbit.baselineRadius = 8.0; orbit.baselinePhi = 0.05; }
    else if (p === 4) { orbit.userRadius = 6.5; orbit.userPhi = 0.04; orbit.userTheta = 0.0; orbit.baselineRadius = 6.5; orbit.baselinePhi = 0.04; }
    else if (p === 6) { orbit.userRadius = 7.4; orbit.userPhi = 0.10; orbit.userTheta = 0.18; orbit.baselineRadius = 7.4; orbit.baselinePhi = 0.10; }
    else              { orbit.userRadius = 6.6; orbit.userPhi = 0.08; orbit.userTheta = 0.0; orbit.baselineRadius = 6.6; orbit.baselinePhi = 0.08; }
    orbit.baselineTheta = p === 6 ? 0.18 : 0.0;
    if (webCam) orbit.baselineTheta = 0.0;
  }
  if (changed && !opts.silent) showToast('视觉预设: ' + presetMeta[p].name);
  var shouldCommitPlaybackPreset = !!opts.commitPlaybackPreset || !opts.noSave;
  if (shouldCommitPlaybackPreset) {
    playbackVisualPreset = p;
    startupVisualPreviewActive = false;
  }
  if (!opts.noSave) {
    saveLyricLayout();
  }
}

function syncFxUniforms() {
  uniforms.uPreset.value = fx.preset;
  uniforms.uIntensity.value = fx.intensity;
  uniforms.uDepth.value = fx.depth;
  uniforms.uPointScale.value = fx.point;
  uniforms.uSpeed.value = fx.speed;
  uniforms.uTwist.value = fx.twist;
  uniforms.uColorBoost.value = fx.color;
  uniforms.uScatter.value = fx.scatter;
  uniforms.uCoverRes.value = normalizeCoverResolution(fx.coverResolution);
  uniforms.uBgFade.value = fx.bgFade;
  uniforms.uBloomStrength.value = fx.bloom ? fx.bloomStrength : 0;
  if (bloomParticles) bloomParticles.visible = fx.bloom && fx.bloomStrength > 0.01;
  uniforms.uEdgeEnabled.value = fx.edge ? 1 : 0;
  if (uniforms.uTintColor) uniforms.uTintColor.value.set(normalizeHexColor(fx.visualTintColor || '#9db8cf'));
  if (uniforms.uTintStrength) uniforms.uTintStrength.value = fx.visualTintMode === 'custom' ? 0.42 : 0;
  syncSkullParticleColors();
}
var homeWaveTrackState = { bars: 0, smooth: [] };
function ensureHomeWaveTrackBars() {
  var el = document.getElementById('home-wave-track');
  if (!el) return;
  var count = 24;
  if (homeWaveTrackState.bars === count && el.children.length === count) return;
  homeWaveTrackState.bars = count;
  homeWaveTrackState.smooth = new Array(count).fill(0);
  el.innerHTML = new Array(count + 1).join('<span></span>');
}
function updateHomeAudioVisual(dt) {
  if (!emptyHomeActive) return;
  var wave = document.getElementById('home-wave-track');
  if (!wave) return;
  var nowMs = performance.now();
  if (homeWaveTrackState.lastAt && nowMs - homeWaveTrackState.lastAt < 80) return;
  homeWaveTrackState.lastAt = nowMs;
  ensureHomeWaveTrackBars();
  var bars = wave.children;
  var nowT = uniforms && uniforms.uTime ? uniforms.uTime.value : performance.now() / 1000;
  for (var i = 0; i < bars.length; i++) {
    var ratio = bars.length > 1 ? i / (bars.length - 1) : 0;
    var bin = 0;
    if (frequencyData && frequencyData.length) {
      bin = (frequencyData[Math.min(frequencyData.length - 1, Math.floor(Math.pow(ratio, 1.2) * (frequencyData.length - 1)))] || 0) / 255;
    } else {
      bin = 0.16 + Math.sin(nowT * 1.4 + i * 0.34) * 0.06;
    }
    var target = clampRange(Math.max(bin, smoothBass * 0.35 + smoothMid * 0.18 + beatPulse * 0.24), 0.03, 1);
    var prev = homeWaveTrackState.smooth[i] || 0;
    prev += (target - prev) * (target > prev ? 0.34 : 0.12);
    homeWaveTrackState.smooth[i] = prev;
    bars[i].style.height = Math.max(4, prev * 18) + 'px';
    bars[i].style.opacity = String(clampRange(0.36 + prev * 0.68, 0.32, 1));
  }
}
function setRange(id, value) {
  var el = document.getElementById(id);
  if (!el) return;
  if (id === 'fx-lyricglow') value = Math.min(0.85, Math.max(0, value));
  if (id === 'fx-coverres') value = normalizeCoverResolution(value);
  if (id === 'fx-glassaberration') value = normalizeControlGlassChromaticOffset(value);
  el.value = value;
  var out = el.parentElement.querySelector('output');
  if (out) out.textContent = id === 'fx-coverres'
    ? coverParticleCountLabel(value)
    : (id === 'fx-lyricweight' || id === 'fx-glassaberration' || id === 'fx-lyrictiltx' || id === 'fx-lyrictilty' || id === 'fx-shelfangle' ? String(Math.round(Number(value) || 0)) : Number(value).toFixed(id === 'fx-lyricspacing' ? 3 : 2));
}
function updateDevelopmentFxControls() {
  [
    ['desktopLyrics', 't-desktopLyrics', '全屏幕置顶歌词'],
    ['desktopLyricsClickThrough', 't-desktopLyricsClickThrough', '锁定后防误触；鼠标移到桌面歌词上按中键可锁定/解锁'],
    ['desktopLyricsCinema', 't-desktopLyricsCinema', '桌面歌词绑定鼓点电影震动，基础漂浮始终保留'],
    ['desktopLyricsHighlight', 't-desktopLyricsHighlight', '桌面歌词按播放进度高亮'],
    ['wallpaperMode', 't-wallpaperMode', '开发中，暂不可用']
  ].forEach(function(item){
    var locked = isDevelopmentLockedFx(item[0]);
    var el = document.getElementById(item[1]);
    if (!el) return;
    el.classList.toggle('dev-locked', locked);
    if (locked) {
      el.classList.remove('on');
      el.setAttribute('aria-disabled', 'true');
      el.title = '开发中，暂不可用';
    } else {
      el.removeAttribute('aria-disabled');
      el.title = item[2];
    }
  });
  [
    ['desktopLyrics', 'fx-desktoplyricssize'],
    ['desktopLyrics', 'fx-desktoplyricsopacity'],
    ['desktopLyrics', 'fx-desktoplyricsy'],
    ['wallpaperMode', 'fx-wallpaperopacity']
  ].forEach(function(item){
    var locked = isDevelopmentLockedFx(item[0]);
    var input = document.getElementById(item[1]);
    if (!input) return;
    input.disabled = locked;
    var row = input.closest && input.closest('.fx-slider');
    if (row) row.classList.toggle('dev-locked', locked);
  });
}
function updateDesktopLyricsFpsControls() {
  var fps = normalizeDesktopLyricsFps(fx.desktopLyricsFps);
  document.querySelectorAll('#desktop-lyrics-fps-seg [data-desktop-lyrics-fps]').forEach(function(btn){
    btn.classList.toggle('active', normalizeDesktopLyricsFps(btn.getAttribute('data-desktop-lyrics-fps')) === fps);
  });
}
function updatePerformanceControls() {
  fx.performanceBackground = normalizePerformanceBackgroundMode(fx.performanceBackground, fx.liveBackgroundKeep === true);
  fx.liveBackgroundKeep = fx.performanceBackground === 'keep';
  fx.performanceQuality = normalizePerformanceQuality(fx.performanceQuality);
  fx.foregroundFpsMode = normalizeForegroundFpsMode(fx.foregroundFpsMode);
  fx.lyricTextureClarity = normalizeLyricTextureClarity(fx.lyricTextureClarity);
  document.querySelectorAll('#performance-background-seg [data-performance-background]').forEach(function(btn){
    btn.classList.toggle('active', btn.getAttribute('data-performance-background') === fx.performanceBackground);
  });
  document.querySelectorAll('#performance-quality-seg [data-performance-quality]').forEach(function(btn){
    btn.classList.toggle('active', btn.getAttribute('data-performance-quality') === fx.performanceQuality);
  });
  document.querySelectorAll('#foreground-fps-seg [data-foreground-fps]').forEach(function(btn){
    btn.classList.toggle('active', normalizeForegroundFpsMode(btn.getAttribute('data-foreground-fps')) === fx.foregroundFpsMode);
  });
  document.querySelectorAll('#lyric-texture-quality-seg [data-lyric-texture-clarity]').forEach(function(btn){
    btn.classList.toggle('active', Number(btn.getAttribute('data-lyric-texture-clarity')) === fx.lyricTextureClarity);
  });
  var liveBackgroundKeepToggle = document.getElementById('t-liveBackgroundKeep');
  if (liveBackgroundKeepToggle) liveBackgroundKeepToggle.classList.toggle('on', fx.liveBackgroundKeep === true);
  // 默认开启型开关：'on' 类跟随 fx[key] !== false
  [['t-backgroundStarRiver','backgroundStarRiver'],['t-lyricLiveViewportFit','lyricLiveViewportFit'],['t-lyricContextHighQuality','lyricContextHighQuality'],['t-lyricBackdropAdapt','lyricBackdropAdapt'],['t-coverBackdropAdapt','coverBackdropAdapt']].forEach(function(pair){
    var el = document.getElementById(pair[0]);
    if (el) el.classList.toggle('on', fx[pair[1]] !== false);
  });
}
function setPerformanceBackgroundMode(mode, silent) {
  var next = normalizePerformanceBackgroundMode(mode, false);
  fx.performanceBackground = next;
  fx.liveBackgroundKeep = next === 'keep';
  updatePerformanceControls();
  saveLyricLayout();
  updateRenderPowerClasses();
  applyRendererPowerMode();
  if (next === 'keep') recoverVisualsAfterBackground('performance-background-keep');
  else if (next === 'release' && isDeepBackgroundMode()) trimRuntimeCaches('performance-release', true);
  if (!silent) {
    showToast(next === 'keep' ? '后台策略: 保持运行' : (next === 'release' ? '后台策略: 停止并释放' : '后台策略: 自动优化'));
  }
}
function setPerformanceQualityMode(mode, silent) {
  var next = normalizePerformanceQuality(mode);
  fx.performanceQuality = next;
  updatePerformanceControls();
  applyRendererPowerMode();
  saveLyricLayout();
  if (!silent) {
    var label = next === 'eco' ? '低' : (next === 'balanced' ? '中' : (next === 'ultra' ? '超高' : '高'));
    showToast('画质档位: ' + label);
  }
}
function setForegroundFpsMode(mode, silent) {
  var next = normalizeForegroundFpsMode(mode);
  fx.foregroundFpsMode = next;
  updatePerformanceControls();
  saveLyricLayout();
  if (!silent) showToast(next === 'vsync' ? '前台帧率: 跟随屏幕' : ('前台帧率上限: ' + next + ' FPS'));
}
function setLyricTextureClarity(n, silent) {
  var next = normalizeLyricTextureClarity(n);
  var changed = next !== fx.lyricTextureClarity;
  fx.lyricTextureClarity = next;
  updatePerformanceControls();
  saveLyricLayout();
  if (changed) refreshAllLyricLineFonts();
  if (!silent) showToast('歌词清晰度: ' + next + '×');
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
