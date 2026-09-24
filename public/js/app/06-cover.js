'use strict';

// ============================================================
//  06-cover.js  —  封面：加载 / 裁剪弹窗 / 边缘与深度 / AI 深度 / 画布
//  由 public/js/app/*.js 于 2026-09-24「按职责重排」生成（零逻辑改动）。
//  ⚠️ 下方 `// <旧文件名> ← 源 main.js §NN` 横幅是**第一步拆分**留下的「来源」标注，
//     重排会把条目搬到职责文件里 —— 横幅里的文件名与本文件不一致是正常的。
//     找函数请按**函数名 grep**，别按文件名推断。
//  规则与验证见 docs/APP_REORG_PLAN.md 与 scripts/check-app-reorg.js。
// ============================================================


function coverParticleCountLabel(v) {
  var grid = coverParticleGridForResolution(v);
  return grid + 'x' + grid;
}
function coverTextureSizeForResolution(v) {
  v = normalizeCoverResolution(v);
  if (v >= 1.32) return 512;
  if (v >= 1.10) return 384;
  return 256;
}

// ============================================================
//  封面 + 边缘 + 启发式深度 处理 (CPU 端)
//   生成 256×256 RGBA 纹理: R=depth G=edge B=fg-mask A=lum
// ============================================================
function coverDepthCacheId(raw) {
  var str = String(raw || '');
  if (!str) return '';
  var h = 2166136261;
  for (var i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return str.length + ':' + (h >>> 0).toString(36);
}
function getCoverDepthCache(raw) {
  var id = coverDepthCacheId(raw);
  if (!id || !coverDepthCache[id]) return null;
  coverDepthCache[id].at = Date.now();
  var idx = coverDepthCacheKeys.indexOf(id);
  if (idx >= 0) {
    coverDepthCacheKeys.splice(idx, 1);
    coverDepthCacheKeys.push(id);
  } else coverDepthCacheKeys.push(id);
  return coverDepthCache[id];
}
function setCoverDepthCache(raw, canvas, aiEnhanced) {
  var id = coverDepthCacheId(raw);
  if (!id || !canvas) return;
  var idx = coverDepthCacheKeys.indexOf(id);
  if (idx >= 0) coverDepthCacheKeys.splice(idx, 1);
  coverDepthCacheKeys.push(id);
  coverDepthCache[id] = { canvas: canvas, ai: !!aiEnhanced, at: Date.now() };
  while (coverDepthCacheKeys.length > 18) {
    var drop = coverDepthCacheKeys.shift();
    delete coverDepthCache[drop];
  }
}

function buildEdgeAndDepth(srcCanvas) {
  var W = 256, H = 256, N = W * H;
  var normalized = document.createElement('canvas');
  normalized.width = W;
  normalized.height = H;
  var sctx = normalized.getContext('2d');
  sctx.drawImage(srcCanvas, 0, 0, W, H);
  var src = sctx.getImageData(0, 0, W, H).data;
  var lum = new Float32Array(N), blur = new Float32Array(N), tmp = new Float32Array(N);
  // 1) Luminance
  for (var i = 0; i < N; i++) {
    var di = i * 4;
    lum[i] = (src[di] * 0.299 + src[di+1] * 0.587 + src[di+2] * 0.114) / 255;
  }
  // 2) Box blur 2 次 (深度基础)
  function blurH(s, d, r) {
    for (var y = 0; y < H; y++) {
      var sum = 0;
      for (var x = -r; x <= r; x++) sum += s[y * W + Math.max(0, Math.min(W-1, x))];
      for (var x = 0; x < W; x++) {
        d[y * W + x] = sum / (2*r + 1);
        var xR = Math.min(W-1, x + r + 1), xL = Math.max(0, x - r);
        sum += s[y * W + xR] - s[y * W + xL];
      }
    }
  }
  function blurV(s, d, r) {
    for (var x = 0; x < W; x++) {
      var sum = 0;
      for (var y = -r; y <= r; y++) sum += s[Math.max(0, Math.min(H-1, y)) * W + x];
      for (var y = 0; y < H; y++) {
        d[y * W + x] = sum / (2*r + 1);
        var yD = Math.min(H-1, y + r + 1), yU = Math.max(0, y - r);
        sum += s[yD * W + x] - s[yU * W + x];
      }
    }
  }
  blurH(lum, tmp, 4); blurV(tmp, blur, 4);

  // 3) Sobel 边缘 (在 blur 上做 - 减少噪声)
  var edge = new Float32Array(N);
  for (var y = 1; y < H-1; y++) for (var x = 1; x < W-1; x++) {
    var gx = -blur[(y-1)*W + (x-1)] - 2*blur[y*W + (x-1)] - blur[(y+1)*W + (x-1)]
            + blur[(y-1)*W + (x+1)] + 2*blur[y*W + (x+1)] + blur[(y+1)*W + (x+1)];
    var gy = -blur[(y-1)*W + (x-1)] - 2*blur[(y-1)*W + x] - blur[(y-1)*W + (x+1)]
            + blur[(y+1)*W + (x-1)] + 2*blur[(y+1)*W + x] + blur[(y+1)*W + (x+1)];
    edge[y*W + x] = Math.min(1.0, Math.sqrt(gx*gx + gy*gy) * 1.4);
  }
  // 4) 启发式深度:亮度 + 中心 mask + 边缘累积
  var depth = new Float32Array(N);
  for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
    var i = y*W + x;
    var cx = (x / (W-1) - 0.5) * 2.0;
    var cy = (y / (H-1) - 0.5) * 2.0;
    var rr = Math.sqrt(cx*cx + cy*cy);
    var centerBias = 1.0 - Math.min(1, rr * 0.75);
    var bright = blur[i];
    depth[i] = Math.min(1.0, bright * 0.45 + centerBias * 0.55);
  }
  // 5) fg-mask: 中心 + 高对比区
  var fg = new Float32Array(N);
  for (var i = 0; i < N; i++) {
    var d = depth[i];
    var e = edge[i];
    fg[i] = Math.min(1.0, d * 0.6 + e * 0.5);
  }

  // 输出 256×256 RGBA
  var out = document.createElement('canvas'); out.width = W; out.height = H;
  var octx = out.getContext('2d'), imgOut = octx.createImageData(W, H);
  for (var i = 0; i < N; i++) {
    var di = i * 4;
    imgOut.data[di]   = Math.round(depth[i] * 255);
    imgOut.data[di+1] = Math.round(edge[i] * 255);
    imgOut.data[di+2] = Math.round(fg[i] * 255);
    imgOut.data[di+3] = Math.round(lum[i] * 255);
  }
  octx.putImageData(imgOut, 0, 0);
  return out;
}

// AI 深度估计 (Xenova/depth-anything-small) - 异步加载, 失败回退
async function ensureAIDepthPipeline() {
  if (aiDepthReady && aiDepthPipeline) return aiDepthPipeline;
  if (aiDepthBusy) return null;
  aiDepthBusy = true;
  try {
    showAIDepthChip('加载 AI 深度模型 (首次需下载 50MB)…');
    var mod = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');
    mod.env.allowLocalModels = false;
    if (mod.env.backends && mod.env.backends.onnx && mod.env.backends.onnx.wasm) mod.env.backends.onnx.wasm.numThreads = 1;
    aiDepthPipeline = await mod.pipeline('depth-estimation', 'Xenova/depth-anything-small-hf');
    aiDepthReady = true;
    return aiDepthPipeline;
  } catch (e) {
    console.warn('AI depth pipeline failed:', e);
    return null;
  } finally {
    aiDepthBusy = false;
  }
}

function makeAIDepthInputCanvas(srcCanvas) {
  if (!srcCanvas) return srcCanvas;
  var size = 160;
  var cv = document.createElement('canvas');
  cv.width = cv.height = size;
  var ctx = cv.getContext('2d');
  try {
    ctx.drawImage(srcCanvas, 0, 0, size, size);
    return cv;
  } catch (e) {
    return srcCanvas;
  }
}

async function estimateAIDepth(srcCanvas, token) {
  if (!fx.aiDepth) return null;
  if (performance.now() < aiDepthFailUntil) return null;
  showAIDepthChip('后台增强封面深度…');
  try {
    var pipe = await ensureAIDepthPipeline();
    if (!pipe) { hideAIDepthChip(); return null; }
    if (token !== coverProcessToken) { hideAIDepthChip(); return null; }
    var inputCanvas = makeAIDepthInputCanvas(srcCanvas);
    var input = inputCanvas;
    try {
      if (inputCanvas && inputCanvas.toDataURL) input = inputCanvas.toDataURL('image/jpeg', 0.82);
    } catch (e) {
      input = inputCanvas;
    }
    var result = await pipe(input);
    if (token !== coverProcessToken) { hideAIDepthChip(); return null; }
    var raw = result && (result.depth || result.predicted_depth || result);
    var rawCv = raw && raw.toCanvas ? await raw.toCanvas() : raw;
    hideAIDepthChip();
    return rawCv;
  } catch (e) {
    console.warn('AI depth estimation failed:', e);
    aiDepthFailUntil = performance.now() + 120000;
    hideAIDepthChip();
    return null;
  }
}

function mergeAIDepthIntoEdgeTexture(heuristicCanvas, aiCanvas) {
  // 把 AI 深度 (灰度) 写入 R 通道, 保留启发式的 G/B/A
  var W = heuristicCanvas.width || 256, H = heuristicCanvas.height || 256;
  var hctx = heuristicCanvas.getContext('2d');
  var hImg = hctx.getImageData(0, 0, W, H);

  var aiTmp = document.createElement('canvas'); aiTmp.width = W; aiTmp.height = H;
  var actx = aiTmp.getContext('2d');
  actx.drawImage(aiCanvas, 0, 0, W, H);
  var aData = actx.getImageData(0, 0, W, H).data;

  // 归一化 AI 深度
  var aiVals = new Float32Array(W * H), minV = 1, maxV = 0;
  for (var i = 0; i < aiVals.length; i++) {
    var di = i * 4;
    var v = (aData[di] * 0.299 + aData[di+1] * 0.587 + aData[di+2] * 0.114) / 255;
    aiVals[i] = v; if (v < minV) minV = v; if (v > maxV) maxV = v;
  }
  var range = Math.max(0.001, maxV - minV);
  // 判断是否反相 (中心应该比边缘深, 表示前景在中)
  var centerSum = 0, centerCount = 0, edgeSum = 0, edgeCount = 0;
  for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
    var i = y * W + x;
    var cx = x / (W-1) - 0.5, cy = y / (H-1) - 0.5;
    var rr = Math.sqrt(cx*cx + cy*cy);
    if (rr < 0.22) { centerSum += aiVals[i]; centerCount++; }
    else if (rr > 0.46) { edgeSum += aiVals[i]; edgeCount++; }
  }
  var invert = (centerSum / Math.max(1, centerCount)) < (edgeSum / Math.max(1, edgeCount));

  for (var i = 0; i < aiVals.length; i++) {
    var n = (aiVals[i] - minV) / range;
    if (invert) n = 1.0 - n;
    hImg.data[i*4] = Math.round(n * 255);
  }
  hctx.putImageData(hImg, 0, 0);
  return heuristicCanvas;
}

function queueAIDepthForCover(srcCanvas, edgeCanvas, token, opts, cacheSeed, force) {
  opts = opts || {};
  if (!fx.aiDepth || !srcCanvas || !edgeCanvas) return;
  if (!force && isHiddenForBackgroundOptimization()) return;
  if (performance.now() < aiDepthFailUntil || aiDepthBusy) return;
  var now = performance.now();
  if (!force && now - aiDepthLastRunAt < aiDepthMinGapMs) return;
  aiDepthLastRunAt = now;
  scheduleVisualApply(async function(){
    if (!fx.aiDepth || token !== coverProcessToken || !coverApplyStillCurrent(opts)) return;
    await yieldToIdle(force ? 900 : 2600);
    if (!fx.aiDepth || token !== coverProcessToken || !coverApplyStillCurrent(opts)) return;
    var aiCanvas = await estimateAIDepth(srcCanvas, token);
    if (!aiCanvas || token !== coverProcessToken || !coverApplyStillCurrent(opts)) return;
    mergeAIDepthIntoEdgeTexture(edgeCanvas, aiCanvas);
    coverEdgeTex.image = edgeCanvas;
    coverEdgeTex.needsUpdate = true;
    setCoverDepthState(1, 1.0, 360);
    setCoverDepthCache(cacheSeed, edgeCanvas, true);
    showToast('AI 深度已后台增强');
  }, force ? 240 : 1800, force ? 1200 : 3000);
}

function queueAIDepthForCurrentCover(force) {
  if (!coverTex || !coverTex.image || !coverEdgeTex || !coverEdgeTex.image) return;
  if (!uniforms.uHasCover.value || !uniforms.uHasDepth.value) return;
  queueAIDepthForCover(coverTex.image, coverEdgeTex.image, coverProcessToken, {}, '', !!force);
}
var coverDepthTween = null;

function setCoverDepthState(depthTo, aiTo, durationMs) {
  depthTo = Math.max(0, Math.min(1, Number(depthTo) || 0));
  aiTo = Math.max(0, Math.min(1, Number(aiTo) || 0));
  if (coverDepthTween) {
    cancelAnimationFrame(coverDepthTween.raf);
    coverDepthTween = null;
  }
  durationMs = Math.max(1, durationMs || 1);
  var depthFrom = uniforms.uHasDepth.value || 0;
  var aiFrom = uniforms.uAiBoost.value || 0;
  if (durationMs <= 1 || (Math.abs(depthFrom - depthTo) < 0.001 && Math.abs(aiFrom - aiTo) < 0.001)) {
    uniforms.uHasDepth.value = depthTo;
    uniforms.uAiBoost.value = aiTo;
    return;
  }
  var start = performance.now();
  function step(now) {
    var t = Math.min(1, (now - start) / durationMs);
    var eased = visualEase(t);
    uniforms.uHasDepth.value = depthFrom + (depthTo - depthFrom) * eased;
    uniforms.uAiBoost.value = aiFrom + (aiTo - aiFrom) * eased;
    if (t < 1) coverDepthTween = { raf: requestAnimationFrame(step) };
    else {
      uniforms.uHasDepth.value = depthTo;
      uniforms.uAiBoost.value = aiTo;
      coverDepthTween = null;
    }
  }
  coverDepthTween = { raf: requestAnimationFrame(step) };
}

function coverApplyStillCurrent(opts) {
  opts = opts || {};
  return !opts.trackToken || opts.trackToken === trackSwitchToken;
}

function setControlCoverSrc(src) {
  var cover = document.getElementById('control-cover');
  if (!cover) return;
  if (!src) {
    cover.style.backgroundImage = '';
    cover.classList.add('cover-empty');
    return;
  }
  cover.style.backgroundImage = 'url("' + String(src).replace(/"/g, '\\"') + '")';
  cover.classList.remove('cover-empty');
}

function updateControlTrackInfo(song) {
  song = song || {};
  var title = document.getElementById('control-title');
  var artist = document.getElementById('control-artist');
  if (title) title.textContent = song.name || '';
  if (artist) artist.textContent = song.artist || '';
}

function applyCoverCanvas(cv, thumbSrc, opts) {
  opts = opts || {};
  if (!cv || !coverApplyStillCurrent(opts)) return;
  var token = ++coverProcessToken;
  if (opts.coverSource && opts.coverSourceKind) {
    currentCoverSource = { kind: opts.coverSourceKind, src: opts.coverSource };
  }
  var cacheSeed = (opts.coverKey || thumbSrc || '') + '|tex=' + (cv.width || 0) + 'x' + (cv.height || 0);
  var cachedDepth = getCoverDepthCache(cacheSeed);
  // 切歌颜色渐变: 把当前 coverTex 当作 prevCoverTex
  if (uniforms.uHasCover.value > 0.5 && coverTex.image) {
    var prevW = coverTex.image.width || 256;
    var prevH = coverTex.image.height || 256;
    var prevScale = Math.min(1, 256 / Math.max(prevW, prevH, 1));
    var prevCv = document.createElement('canvas');
    prevCv.width = Math.max(1, Math.round(prevW * prevScale));
    prevCv.height = Math.max(1, Math.round(prevH * prevScale));
    try {
      prevCv.getContext('2d').drawImage(coverTex.image, 0, 0, prevCv.width, prevCv.height);
      prevCoverTex.image = prevCv;
      prevCoverTex.needsUpdate = true;
    } catch (e) {}
  }
  coverTex.image = cv; coverTex.needsUpdate = true;
  coverPickerCanvas = cv;
  uniforms.uHasCover.value = 1;
  if (cachedDepth && cachedDepth.canvas) {
    coverEdgeTex.image = cachedDepth.canvas;
    coverEdgeTex.needsUpdate = true;
    setCoverDepthState(1, cachedDepth.ai ? 1.0 : 0.55, opts.deferHeavy ? 180 : 120);
  } else {
    setCoverDepthState(opts.deferHeavy ? (uniforms.uHasDepth.value > 0.5 ? 0.22 : 0) : 0, opts.deferHeavy ? 0.20 : 0, opts.deferHeavy ? 120 : 1);
  }

  if (thumbSrc) {
    document.getElementById('thumb-cover').src = thumbSrc;
    setControlCoverSrc(thumbSrc);
  }
  if (shelfManager) shelfManager.onCoverChange(thumbSrc);

  // 启动颜色渐变 (1.4 秒)
  var colorMixMs = opts.colorMixDuration || (fx.preset === 0 ? 520 : 1400);
  startColorMixTween(opts.fromResolutionChange ? (fx.preset === 0 ? 300 : 520) : colorMixMs);

  function refreshCoverDependentColors() {
    if (token !== coverProcessToken || !coverApplyStillCurrent(opts)) return;
    if (floatGroup) refreshFloatColorsFromCover(cv);
    if (backCoverGroup) refreshBackCoverColorsFromCanvas(cv);
    updateLyricPaletteFromCover(cv);
  }

  function runHeavyCoverWork() {
    if (token !== coverProcessToken || !coverApplyStillCurrent(opts)) return;
    if (opts.deferHeavy && typeof isRenderInteractionActive === 'function' && isRenderInteractionActive()) {
      scheduleVisualApply(runHeavyCoverWork, 420, heavyTimeout || 1800);
      return;
    }
    var edgeCv = buildEdgeAndDepth(cv);
    if (token !== coverProcessToken || !coverApplyStillCurrent(opts)) return;
    setCoverDepthCache(cacheSeed, edgeCv, false);
    coverEdgeTex.image = edgeCv; coverEdgeTex.needsUpdate = true;
    setCoverDepthState(1, 0.55, opts.deferHeavy ? 260 : 180);
    refreshCoverDependentColors();

    queueAIDepthForCover(cv, edgeCv, token, opts, cacheSeed, false);
  }
  if (cachedDepth && cachedDepth.canvas) {
    scheduleVisualApply(refreshCoverDependentColors, opts.deferHeavy ? 260 : 90, opts.deferHeavy ? 1200 : 700);
    if (!cachedDepth.ai) queueAIDepthForCover(cv, cachedDepth.canvas, token, opts, cacheSeed, false);
    return;
  }
  var heavyDelay = opts.deferHeavy ? (opts.delay || 620) : (opts.delay || 120);
  var heavyTimeout = opts.deferHeavy ? (opts.timeout || 1800) : (opts.timeout || 900);
  scheduleVisualApply(runHeavyCoverWork, heavyDelay, heavyTimeout);
}

function showAIDepthChip(text) {
  document.getElementById('ai-depth-text').textContent = text || 'AI 深度估计…';
  document.getElementById('ai-depth-chip').classList.add('show');
}
function hideAIDepthChip() {
  document.getElementById('ai-depth-chip').classList.remove('show');
}

function loadCoverFromUrl(directUrl, opts) {
  opts = opts || {};
  if (!directUrl || typeof directUrl !== 'string' || !/^https?:\/\//i.test(directUrl)) {
    if (!coverApplyStillCurrent(opts)) return;
    currentCoverSource = null;
    coverProcessToken++;
    uniforms.uHasCover.value = 0; setCoverDepthState(0, 0, 1);
    resetFloatColorsToIdle();
    document.getElementById('album-bg').classList.remove('visible');
    document.getElementById('thumb-cover').removeAttribute('src');
    setControlCoverSrc('');
    return;
  }
  document.getElementById('album-bg').style.backgroundImage = "url(" + directUrl + ")";
  document.getElementById('album-bg').classList.add('visible');
  var proxiedUrl = coverProxySrc(directUrl);
  if (!proxiedUrl) {
    uniforms.uHasCover.value = 0; setCoverDepthState(0, 0, 1);
    resetFloatColorsToIdle();
    setControlCoverSrc('');
    return;
  }
  var img = new Image(); img.crossOrigin = 'anonymous'; img.decoding = 'async';
  img.onload = function() {
    if (!coverApplyStillCurrent(opts)) return;
    var size = coverTextureSizeForResolution(fx.coverResolution);
    var cv = document.createElement('canvas'); cv.width = cv.height = size;
    var cx = cv.getContext('2d');
    var iw = img.naturalWidth, ih = img.naturalHeight, s = Math.min(iw, ih);
    cx.drawImage(img, (iw-s)/2, (ih-s)/2, s, s, 0, 0, size, size);
    applyCoverCanvas(cv, proxiedUrl || directUrl, Object.assign({}, opts, { coverKey: directUrl || proxiedUrl || '', coverSourceKind: 'url', coverSource: directUrl }));
  };
  img.onerror = function() {
    var img2 = new Image(); img2.crossOrigin = 'anonymous'; img2.decoding = 'async';
    img2.onload = function() {
      if (!coverApplyStillCurrent(opts)) return;
      var size = coverTextureSizeForResolution(fx.coverResolution);
      var cv = document.createElement('canvas'); cv.width = cv.height = size;
      cv.getContext('2d').drawImage(img2, 0, 0, size, size);
      applyCoverCanvas(cv, directUrl, Object.assign({}, opts, { coverKey: directUrl || '', coverSourceKind: 'url', coverSource: directUrl }));
    };
    img2.onerror = function() {
      if (!coverApplyStillCurrent(opts)) return;
      currentCoverSource = null;
      uniforms.uHasCover.value = 0; setCoverDepthState(0, 0, 1);
      resetFloatColorsToIdle();
      setControlCoverSrc('');
    };
    img2.src = directUrl;
  };
  img.src = proxiedUrl;
}

function setAlbumBackground(src) {
  var bg = document.getElementById('album-bg');
  if (!bg) return;
  if (!src) {
    bg.classList.remove('visible');
    bg.style.backgroundImage = '';
    return;
  }
  bg.style.backgroundImage = "url(" + src + ")";
  bg.classList.add('visible');
}

function makeSquareCoverCanvas(img, size, crop) {
  size = size || 512;
  var cv = document.createElement('canvas');
  cv.width = cv.height = size;
  var cx = cv.getContext('2d');
  cx.clearRect(0, 0, size, size);
  var iw = img.naturalWidth || img.width;
  var ih = img.naturalHeight || img.height;
  if (crop) {
    cx.drawImage(img, crop.sx, crop.sy, crop.sSize, crop.sSize, 0, 0, size, size);
  } else {
    var s = Math.min(iw, ih);
    cx.drawImage(img, (iw - s) / 2, (ih - s) / 2, s, s, 0, 0, size, size);
  }
  return cv;
}

function coverCanvasToDataUrl(cv) {
  try {
    var webp = cv.toDataURL('image/webp', 0.88);
    if (/^data:image\/webp/i.test(webp)) return webp;
  } catch (e) {}
  return cv.toDataURL('image/jpeg', 0.88);
}

function applyCoverDataUrl(dataUrl, opts) {
  opts = opts || {};
  if (!dataUrl) return;
  var img = new Image();
  img.decoding = 'async';
  img.onload = function() {
    if (!coverApplyStillCurrent(opts)) return;
    var cv = makeSquareCoverCanvas(img, coverTextureSizeForResolution(fx.coverResolution));
    setAlbumBackground(dataUrl);
    applyCoverCanvas(cv, dataUrl, Object.assign({}, opts, { coverSourceKind: 'data', coverSource: dataUrl }));
  };
  img.src = dataUrl;
}

function commitCustomCoverCanvas(cv, opts) {
  var out = document.createElement('canvas');
  out.width = out.height = 512;
  out.getContext('2d').drawImage(cv, 0, 0, 512, 512);
  setCustomCoverForCurrent(coverCanvasToDataUrl(out), opts);
}

function loadCoverFromFile(file, opts) {
  var reader = new FileReader();
  reader.onload = function(e) {
    var img = new Image();
    img.onload = function() {
      var iw = img.naturalWidth || img.width;
      var ih = img.naturalHeight || img.height;
      if (Math.abs(iw - ih) <= 1) {
        commitCustomCoverCanvas(makeSquareCoverCanvas(img, 512), opts);
      } else {
        openCoverCropModal(img, e.target.result);
      }
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function bindCoverCropModal() {
  if (coverCropBound) return;
  coverCropBound = true;
  var stage = document.getElementById('cover-crop-stage');
  var zoom = document.getElementById('cover-crop-zoom');
  if (!stage || !zoom) return;
  stage.addEventListener('pointerdown', function(e) {
    if (!coverCropState) return;
    e.preventDefault();
    coverCropState.dragging = true;
    coverCropState.lastX = e.clientX;
    coverCropState.lastY = e.clientY;
    stage.classList.add('dragging');
    if (stage.setPointerCapture) {
      try { stage.setPointerCapture(e.pointerId); } catch (err) {}
    }
  });
  stage.addEventListener('pointermove', function(e) {
    if (!coverCropState || !coverCropState.dragging) return;
    e.preventDefault();
    var dx = e.clientX - coverCropState.lastX;
    var dy = e.clientY - coverCropState.lastY;
    coverCropState.lastX = e.clientX;
    coverCropState.lastY = e.clientY;
    coverCropState.x += dx;
    coverCropState.y += dy;
    updateCoverCropTransform();
  });
  function stopDrag() {
    if (!coverCropState) return;
    coverCropState.dragging = false;
    stage.classList.remove('dragging');
  }
  stage.addEventListener('pointerup', stopDrag);
  stage.addEventListener('pointercancel', stopDrag);
  stage.addEventListener('wheel', function(e) {
    if (!coverCropState) return;
    e.preventDefault();
    var next = coverCropState.scaleFactor + (e.deltaY < 0 ? 0.10 : -0.10);
    coverCropState.scaleFactor = Math.max(1, Math.min(3.2, next));
    zoom.value = coverCropState.scaleFactor;
    updateCoverCropTransform();
  }, { passive: false });
  zoom.addEventListener('input', function() {
    if (!coverCropState) return;
    coverCropState.scaleFactor = Math.max(1, Math.min(3.2, parseFloat(zoom.value) || 1));
    updateCoverCropTransform();
  });
}

function openCoverCropModal(img, dataUrl) {
  bindCoverCropModal();
  var modal = document.getElementById('cover-crop-modal');
  var stage = document.getElementById('cover-crop-stage');
  var imgEl = document.getElementById('cover-crop-img');
  var zoom = document.getElementById('cover-crop-zoom');
  if (!modal || !stage || !imgEl || !zoom) return;
  imgEl.src = dataUrl;
  zoom.value = '1';
  coverCropState = {
    img: img,
    dataUrl: dataUrl,
    naturalW: img.naturalWidth || img.width,
    naturalH: img.naturalHeight || img.height,
    stageSize: 0,
    baseScale: 1,
    scaleFactor: 1,
    x: 0,
    y: 0,
    dragging: false,
    lastX: 0,
    lastY: 0
  };
  openGsapModal(modal);
  requestAnimationFrame(function(){
    initCoverCropGeometry();
    pulseCoverCropStage();
  });
}

function initCoverCropGeometry() {
  if (!coverCropState) return;
  var stage = document.getElementById('cover-crop-stage');
  var rect = stage ? stage.getBoundingClientRect() : null;
  var size = rect ? Math.max(220, Math.round(rect.width)) : 312;
  coverCropState.stageSize = size;
  coverCropState.baseScale = size / Math.min(coverCropState.naturalW, coverCropState.naturalH);
  coverCropState.x = 0;
  coverCropState.y = 0;
  updateCoverCropTransform();
}

function clampCoverCropPan() {
  if (!coverCropState) return;
  var s = coverCropState.baseScale * coverCropState.scaleFactor;
  var rw = coverCropState.naturalW * s;
  var rh = coverCropState.naturalH * s;
  var maxX = Math.max(0, (rw - coverCropState.stageSize) / 2);
  var maxY = Math.max(0, (rh - coverCropState.stageSize) / 2);
  coverCropState.x = Math.max(-maxX, Math.min(maxX, coverCropState.x));
  coverCropState.y = Math.max(-maxY, Math.min(maxY, coverCropState.y));
}

function updateCoverCropTransform() {
  if (!coverCropState) return;
  clampCoverCropPan();
  var imgEl = document.getElementById('cover-crop-img');
  if (!imgEl) return;
  var baseW = coverCropState.naturalW * coverCropState.baseScale;
  var baseH = coverCropState.naturalH * coverCropState.baseScale;
  imgEl.style.width = baseW + 'px';
  imgEl.style.height = baseH + 'px';
  imgEl.style.transform = 'translate(-50%, -50%) translate(' + coverCropState.x + 'px,' + coverCropState.y + 'px) scale(' + coverCropState.scaleFactor + ')';
  drawCoverCropPreview();
}

function currentCoverCropRect() {
  if (!coverCropState) return null;
  var s = coverCropState.baseScale * coverCropState.scaleFactor;
  var rw = coverCropState.naturalW * s;
  var rh = coverCropState.naturalH * s;
  var left = coverCropState.stageSize / 2 - rw / 2 + coverCropState.x;
  var top = coverCropState.stageSize / 2 - rh / 2 + coverCropState.y;
  var sx = (0 - left) / s;
  var sy = (0 - top) / s;
  var sSize = coverCropState.stageSize / s;
  sx = Math.max(0, Math.min(coverCropState.naturalW - sSize, sx));
  sy = Math.max(0, Math.min(coverCropState.naturalH - sSize, sy));
  return { sx: sx, sy: sy, sSize: sSize };
}

function drawCoverCropPreview() {
  if (!coverCropState) return;
  var preview = document.getElementById('cover-crop-preview');
  var crop = currentCoverCropRect();
  if (!preview || !crop) return;
  var ctx = preview.getContext('2d');
  ctx.clearRect(0, 0, preview.width, preview.height);
  ctx.drawImage(coverCropState.img, crop.sx, crop.sy, crop.sSize, crop.sSize, 0, 0, preview.width, preview.height);
}

function pulseCoverCropStage() {
  var stage = document.getElementById('cover-crop-stage');
  if (!stage || !window.gsap) return;
  window.gsap.fromTo(stage, { scale: 0.985 }, { scale: 1, duration: 0.72, ease: 'expo.out', overwrite: true });
}

function closeCoverCropModal() {
  var modal = document.getElementById('cover-crop-modal');
  closeGsapModal(modal, function(){
    var imgEl = document.getElementById('cover-crop-img');
    if (imgEl) imgEl.removeAttribute('src');
    coverCropState = null;
  });
}

function commitCoverCrop() {
  if (!coverCropState) return;
  var crop = currentCoverCropRect();
  if (!crop) return;
  var cv = makeSquareCoverCanvas(coverCropState.img, 512, crop);
  commitCustomCoverCanvas(cv);
  closeCoverCropModal();
}
function saveCustomCoverMap() {
  try {
    localStorage.setItem(CUSTOM_COVER_STORE_KEY, JSON.stringify(customCoverMap || {}));
    return true;
  } catch (e) {
    console.warn('custom cover save failed:', e);
    return false;
  }
}
function isInlineCoverSrc(src) {
  return typeof src === 'string' && (/^data:image\//i.test(src) || /^blob:/i.test(src));
}
function isProxyableCoverUrl(url) {
  return /^https?:\/\//i.test(String(url || ''));
}
function coverProxySrc(url, cacheBust) {
  if (!url) return '';
  if (isInlineCoverSrc(url)) return url;
  if (!isProxyableCoverUrl(url)) return '';
  return '/api/cover?url=' + encodeURIComponent(url) + (cacheBust ? '&v=' + Date.now() : '');
}
function coverUrlWithSize(url, size) {
  if (!url || isInlineCoverSrc(url) || !/^https?:\/\//i.test(url)) return url || '';
  if (!size) return url;
  var param = 'param=' + size + 'y' + size;
  if (/[?&]param=\d+y\d+/i.test(url)) return url.replace(/([?&])param=\d+y\d+/i, '$1' + param);
  return url + (url.indexOf('?') >= 0 ? '&' : '?') + param;
}
function songCustomCoverKey(song) {
  if (!song) return '';
  if (song.customCoverKey) return String(song.customCoverKey);
  if (song.provider === 'qq' || song.source === 'qq' || song.type === 'qq') return 'qq:' + (song.mid || song.songmid || song.id || (song.name + '|' + song.artist));
  if (song.localKey) return 'local:' + song.localKey;
  if (song.type === 'podcast' && song.programId) return 'podcast:' + song.programId;
  if (song.id != null && song.id !== '') return 'id:' + song.id;
  var title = String(song.name || song.title || '').trim();
  var artist = String(song.artist || '').trim();
  return (title || artist) ? ('meta:' + (title + '|' + artist).slice(0, 220)) : '';
}
function getCustomCoverForSong(song) {
  if (!song) return '';
  if (song.customCover) return song.customCover;
  var key = songCustomCoverKey(song);
  return key && customCoverMap[key] ? customCoverMap[key] : '';
}
function hydrateCustomCover(song) {
  if (!song) return song;
  var custom = getCustomCoverForSong(song);
  if (custom) song.customCover = custom;
  return song;
}
function songCoverSrc(song, size) {
  var custom = getCustomCoverForSong(song);
  if (custom) return custom;
  return song && song.cover ? coverUrlWithSize(song.cover, size) : '';
}
function homeTileCover(item) {
  if (!item) return '';
  if (item.kind === 'song' || item.kind === 'weatherSong') return songCoverSrc(item.song, 220);
  return item.cover ? coverUrlWithSize(item.cover, 220) : '';
}
function setCustomCoverForCurrent(dataUrl, opts) {
  if (!dataUrl) return;
  var song = currentCoverSong();
  var saved = false;
  var hasKey = false;
  if (song) {
    var key = songCustomCoverKey(song);
    song.customCover = dataUrl;
    if (key) {
      hasKey = true;
      customCoverMap[key] = dataUrl;
      saved = saveCustomCoverMap();
      for (var i = 0; i < playQueue.length; i++) {
        if (songCustomCoverKey(playQueue[i]) === key) playQueue[i].customCover = dataUrl;
      }
      if (currentLocalSong && songCustomCoverKey(currentLocalSong) === key) currentLocalSong.customCover = dataUrl;
    }
  }
  applyCoverDataUrl(dataUrl, opts);
  safeRenderQueuePanel('custom-cover-apply', { scrollCurrent: miniQueueOpen });
  safeShelfRebuild('custom-cover-apply');
  updateCustomCoverButton();
  showToast(song ? (!hasKey ? '封面已应用' : (saved ? '封面已保存' : '封面已应用，存储空间不足')) : '已应用临时封面');
}
function updateCustomCoverButton() {
  var btn = document.getElementById('clear-cover-btn');
  var hasCover = !!getCustomCoverForSong(currentCoverSong());
  var area = document.getElementById('search-area');
  if (area) area.classList.toggle('has-cover-action', hasCover);
  if (!btn) return;
  btn.classList.toggle('has-cover', hasCover);
  btn.title = hasCover ? '取消自定义封面' : '当前没有自定义封面';
  btn.setAttribute('aria-label', btn.title);
}
function clearCustomCoverForCurrent() {
  var song = currentCoverSong();
  if (!song) {
    showToast('先播放或选择一首歌');
    updateCustomCoverButton();
    return;
  }
  var custom = getCustomCoverForSong(song);
  if (!custom) {
    showToast('当前没有自定义封面');
    updateCustomCoverButton();
    return;
  }
  var key = songCustomCoverKey(song);
  if (key && customCoverMap[key]) {
    delete customCoverMap[key];
    saveCustomCoverMap();
  }
  delete playlistCoverCache[custom];
  delete song.customCover;
  if (key) {
    for (var i = 0; i < playQueue.length; i++) {
      if (songCustomCoverKey(playQueue[i]) === key) delete playQueue[i].customCover;
    }
  }
  if (key && currentLocalSong && songCustomCoverKey(currentLocalSong) === key) delete currentLocalSong.customCover;
  if (currentIdx >= 0 && playQueue[currentIdx] && playQueue[currentIdx].cover) loadCoverFromUrl(coverUrlWithSize(playQueue[currentIdx].cover, 400));
  else loadCoverFromUrl('');
  safeRenderQueuePanel('custom-cover-clear', { scrollCurrent: miniQueueOpen });
  safeShelfRebuild('custom-cover-clear');
  updateCustomCoverButton();
  showToast('已恢复默认封面');
}
function searchLooksLikeSameTitleCover(song, nq, name, album, raw, originalArtistMatch, sourceIndex) {
  if (!song || !nq || !name || originalArtistMatch) return false;
  var sameTitle = name === nq || nq.indexOf(name) >= 0 || name.indexOf(nq) === 0;
  if (!sameTitle) return false;
  var selfTitledSingle = !!(album && (album === name || album === nq || album.indexOf(name) >= 0 || name.indexOf(album) >= 0));
  return selfTitledSingle || searchLooksLikeDerivative(raw) || (sourceIndex || 0) > 0;
}
