'use strict';

// ============================================================
//  04-lyrics.js  —  歌词：解析 / 自定义歌词 / 面板 / 显示模式 / 动画 / 校准 / 时间偏移
//  由 public/js/app/*.js 于 2026-09-24「按职责重排」生成（零逻辑改动）。
//  ⚠️ 下方 `// <旧文件名> ← 源 main.js §NN` 横幅是**第一步拆分**留下的「来源」标注，
//     重排会把条目搬到职责文件里 —— 横幅里的文件名与本文件不一致是正常的。
//     找函数请按**函数名 grep**，别按文件名推断。
//  规则与验证见 docs/APP_REORG_PLAN.md 与 scripts/check-app-reorg.js。
// ============================================================



// ============================================================
//  05-lyric-modes-cover.js  ←  源 main.js §13–§17（基线 784afe6）
//  歌词显示模式 / 动画 / 校准 / 涟漪触发 / 封面深度处理
// ============================================================

// ============ 歌词显示模式（对齐上游 Minera 五态体系） ============
function lyricCustomLineCountValue() {
  var raw = fx && fx.lyricCustomLineCount != null ? Number(fx.lyricCustomLineCount) : fxDefaults.lyricCustomLineCount;
  if (!isFinite(raw)) raw = fxDefaults.lyricCustomLineCount;
  return clampRange(Math.round(raw), 1, 10);
}
function lyricDisplayLineCountForMode(mode) {
  mode = normalizeLyricDisplayMode(mode);
  if (mode === 'single') return 1;
  if (mode === 'dual') return 2;
  if (mode === 'triple') return 3;
  if (mode === 'cinema') return 5;
  return lyricCustomLineCountValue();
}
function stageLyricLineCount() {
  return lyricDisplayLineCountForMode(fx && fx.lyricDisplayMode);
}
// 上方停驻行数（当前行居中，上下对称）；dual 只有一行预告、无停驻（对齐上游 offsets [0,1]）
function stageLyricParkCount() {
  var count = stageLyricLineCount();
  if (count < 3) return 0;
  return Math.floor((count - 1) / 2);
}
function stageLyricUpcomingCount() {
  return Math.max(0, stageLyricLineCount() - 1 - stageLyricParkCount());
}
// ============ 歌词动画（对齐上游 Minera motion 体系） ============
function lyricContextOpacityValue() {
  return clampRange(fx && fx.lyricContextOpacity == null ? fxDefaults.lyricContextOpacity : Number(fx && fx.lyricContextOpacity), 0.25, 1);
}
function lyricContextSpreadValue() {
  return clampRange(fx && fx.lyricContextSpread == null ? fxDefaults.lyricContextSpread : Number(fx && fx.lyricContextSpread), 0.60, 2.40);
}
/** 亮底避光强度：总开关关闭时返回 0（可读性衬底完全隐藏），否则取滑块值 */
function lyricBackdropAdaptStrengthValue() {
  if (typeof fx === 'undefined' || !fx || fx.lyricBackdropAdapt === false) return 0;
  return clampRange(fx.lyricBackgroundAdapt == null ? fxDefaults.lyricBackgroundAdapt : Number(fx.lyricBackgroundAdapt), 0, 1);
}
function lyricTranslationModeValue() {
  return normalizeLyricTranslationMode(fx && fx.lyricTranslationMode);
}
function lyricTranslationGapValue() {
  return clampRange(fx && fx.lyricTranslationGap == null ? fxDefaults.lyricTranslationGap : Number(fx && fx.lyricTranslationGap), 0.28, 2.20);
}
function lyricTranslationScaleValue() {
  return clampRange(fx && fx.lyricTranslationScale == null ? fxDefaults.lyricTranslationScale : Number(fx && fx.lyricTranslationScale), 0.46, 1.12);
}
function lyricTranslationOpacityValue() {
  return clampRange(fx && fx.lyricTranslationOpacity == null ? fxDefaults.lyricTranslationOpacity : Number(fx && fx.lyricTranslationOpacity), 0.20, 1);
}
function lyricEdgeFadeValue() {
  return clampRange(fx && fx.lyricEdgeFade == null ? fxDefaults.lyricEdgeFade : Number(fx && fx.lyricEdgeFade), 0, 1);
}
function lyricMotionSoftnessValue() {
  return clampRange(fx && fx.lyricMotionSoftness == null ? fxDefaults.lyricMotionSoftness : Number(fx && fx.lyricMotionSoftness), 0.15, 1.2);
}
function lyricGlitchIntensityValue() {
  return clampRange(fx && fx.lyricGlitchIntensity == null ? fxDefaults.lyricGlitchIntensity : Number(fx && fx.lyricGlitchIntensity), 0, 1.5);
}
function lyricGlitchSliceValue() {
  return clampRange(fx && fx.lyricGlitchSlice == null ? fxDefaults.lyricGlitchSlice : Number(fx && fx.lyricGlitchSlice), 0, 1.4);
}
function lyricGlitchChromaValue() {
  return clampRange(fx && fx.lyricGlitchChroma == null ? fxDefaults.lyricGlitchChroma : Number(fx && fx.lyricGlitchChroma), 0, 1.6);
}
function lyricGlitchRateValue() {
  return clampRange(fx && fx.lyricGlitchRate == null ? fxDefaults.lyricGlitchRate : Number(fx && fx.lyricGlitchRate), 0.45, 2.2);
}
function lyricGlitchJitterValue() {
  return clampRange(fx && fx.lyricGlitchJitter == null ? fxDefaults.lyricGlitchJitter : Number(fx && fx.lyricGlitchJitter), 0, 1.8);
}
// 动画参数画像（对齐上游 lyricMotionProfile）：enter/exit 为时长权重，
// fork 基准换算 current 0.84*enter / 其他 0.68*enter / 退场 0.73*exit（glass 态 = 现状手感）
function lyricMotionProfile() {
  var style = normalizeLyricMotionStyle(fx && fx.lyricMotionStyle);
  var soft = lyricMotionSoftnessValue();
  var profile = {
    style: style,
    enter: 0.62,
    exit: 0.52,
    slide: 0.34,
    progressEase: lyricsHasNativeKaraoke ? 0.34 : 0.18,
    contextDrift: 0.060,
    edgeBoost: 1.0,
    sweep: 0.62,
    shimmer: 0.24,
    glitch: 0.0,
    glitchSlice: 0.0,
    glitchChroma: 0.0,
    glitchRate: 1.0,
    glitchJitter: 0.0,
    glitchCameraBind: false,
    glowLift: 1.0,
    floatAmp: 1.0
  };
  if (style === 'smooth') {
    profile.enter = 0.72; profile.exit = 0.62; profile.slide = 0.24; profile.progressEase *= 0.72; profile.contextDrift = 0.030; profile.edgeBoost = 0.62; profile.sweep = 0.18; profile.shimmer = 0.05; profile.glowLift = 0.74; profile.floatAmp = 0.55;
  } else if (style === 'float') {
    profile.enter = 0.86; profile.exit = 0.76; profile.slide = 0.54; profile.progressEase *= 0.66; profile.contextDrift = 0.120; profile.edgeBoost = 1.04; profile.sweep = 0.36; profile.shimmer = 0.14; profile.glowLift = 1.16; profile.floatAmp = 1.45;
  } else if (style === 'shine') {
    profile.enter = 0.50; profile.exit = 0.44; profile.slide = 0.34; profile.progressEase *= 1.02; profile.contextDrift = 0.052; profile.edgeBoost = 1.42; profile.sweep = 1.22; profile.shimmer = 0.34; profile.glowLift = 1.30; profile.floatAmp = 0.82;
  } else if (style === 'glitch') {
    profile.enter = 0.40; profile.exit = 0.36; profile.slide = 0.30; profile.progressEase *= 1.24; profile.contextDrift = 0.035; profile.edgeBoost = 1.18; profile.sweep = 0.54; profile.shimmer = 0.28; profile.glitch = lyricGlitchIntensityValue(); profile.glitchSlice = lyricGlitchSliceValue(); profile.glitchChroma = lyricGlitchChromaValue(); profile.glitchRate = lyricGlitchRateValue(); profile.glitchJitter = lyricGlitchJitterValue(); profile.glitchCameraBind = !!(fx && fx.lyricGlitchCameraBind); profile.glowLift = 1.08 + profile.glitch * 0.10; profile.floatAmp = 0.70;
  } else if (style === 'quick') {
    profile.enter = 0.36; profile.exit = 0.32; profile.slide = 0.22; profile.progressEase *= 1.34; profile.contextDrift = 0.034; profile.edgeBoost = 0.70; profile.sweep = 0.28; profile.shimmer = 0.10; profile.glowLift = 0.86; profile.floatAmp = 0.62;
  }
  profile.enter *= soft;
  profile.exit *= soft;
  profile.slide *= clampRange(0.80 + soft * 0.35, 0.75, 1.28);
  profile.progressEase = clampRange(profile.progressEase / clampRange(soft, 0.35, 1.2), 0.08, 0.72);
  return profile;
}
function expireParkedLyricLines() {
  var keep = stageLyricParkCount();   // 上方保留的已唱停驻行数
  var parked = 0;
  var i, m;
  for (i = 0; i < stageLyrics.outgoing.length; i++) {
    m = stageLyrics.outgoing[i];
    if (m && m.userData && m.userData.parked) parked++;
  }
  for (i = 0; i < stageLyrics.outgoing.length && parked > keep; i++) {
    m = stageLyrics.outgoing[i];
    if (m && m.userData && m.userData.parked) {
      m.userData.parked = false;   // 转普通退场淡出
      m.userData.age = 0;
      parked--;
    }
  }
}
function unparkAllLyricLines() {
  if (!stageLyrics.outgoing || !stageLyrics.outgoing.length) return;
  for (var i = 0; i < stageLyrics.outgoing.length; i++) {
    var m = stageLyrics.outgoing[i];
    if (m && m.userData && m.userData.parked) {
      m.userData.parked = false;
      m.userData.age = 0;
    }
  }
}
/** 只回收「停驻」上文行（普通退场行不动），供行数切换后按历史重建 */
function disposeParkedLyricLines() {
  if (!Array.isArray(stageLyrics.outgoing)) return;
  for (var i = stageLyrics.outgoing.length - 1; i >= 0; i--) {
    var m = stageLyrics.outgoing[i];
    if (m && m.userData && m.userData.parked) {
      disposeLyricMesh(m);
      stageLyrics.outgoing.splice(i, 1);
    }
  }
}
/**
 * 按当前行号 + 新的 park 槽位数，从歌词历史重建上方停驻行。
 * 行数切换时不能只 unpark 旧上文：那会把「前面的歌词」全部退场且不会自动回来，
 * 必须从 lyricsLines[currentIdx-rank] 补建。push 顺序从远到近，
 * 与 showStageLine 自然滚动时的 outgoing 顺序一致（expire 从头卸下最旧）。
 */
function rebuildParkedLyricLines(idx) {
  disposeParkedLyricLines();
  var keep = stageLyricParkCount();
  if (keep <= 0) return;
  if (typeof idx !== 'number' || idx < 0) {
    if (stageLyrics.current && stageLyrics.current.userData && typeof stageLyrics.current.userData.lineIdx === 'number') {
      idx = stageLyrics.current.userData.lineIdx;
    } else {
      return;
    }
  }
  if (!Array.isArray(lyricsLines) || !lyricsLines.length) return;
  for (var rank = keep; rank >= 1; rank--) {
    var lineIdx = idx - rank;
    if (lineIdx < 0) continue;
    var line = lyricsLines[lineIdx];
    if (!line || !line.text) continue;
    var mesh = buildLyricMesh(String(line.text), true);
    if (!mesh) continue;
    mesh.userData.parked = true;
    mesh.userData.lineIdx = lineIdx;
    mesh.userData.age = 0.42;
    var ps = parkLyricStyleFor(rank);
    mesh.position.set(0, ps.y, ps.z);
    mesh.scale.setScalar(ps.scale);
    stageLyrics.outgoing.push(mesh);
    if (stageLyrics.group) stageLyrics.group.add(mesh);
    syncMeshTranslation(mesh, line, 'parked');
  }
}
// 多行歌词布局样式：当前行居中，上下按档位递减（rank/slot 1 起计；公式与上游 cinema 两档吻合，更高档平滑外推）
// 上下句间距乘 contextSpread、清晰度乘 contextOpacity（1.0 = fork 现状）
function parkLyricStyleFor(rank) {
  var f = Math.max(0, Math.round(rank) - 1);
  var spread = lyricContextSpreadValue();
  var ctxOpacity = lyricContextOpacityValue();
  return {
    y: 0.76 + f * 0.56 * spread,
    z: Math.max(0.62, 1.33 - f * 0.15),
    scale: Math.max(0.34, 0.90 * Math.pow(0.912, f)),
    opacity: Math.max(0.08, (0.55 - f * 0.13) * ctxOpacity),
    readability: Math.max(0.08, (0.46 - f * 0.10) * ctxOpacity)
  };
}
function upcomingLyricStyleFor(slot) {
  var s = Math.max(0, Math.round(slot));
  var spread = lyricContextSpreadValue();
  var ctxOpacity = lyricContextOpacityValue();
  return {
    y: -(0.40 + s * 0.56 * spread),
    z: Math.max(0.62, 1.33 - s * 0.15),
    scale: Math.max(0.34, 0.90 * Math.pow(0.912, s)),
    opacity: Math.max(0.08, (0.52 - s * 0.14) * ctxOpacity),
    readability: Math.max(0.08, (0.46 - s * 0.10) * ctxOpacity)
  };
}
/**
 * 为一行歌词挂上译文（双语翻译，移植自上游）。
 *
 * 译文作为该行 group 的**子节点**：自动继承父行的位置/缩放/浮动/镜头绑定动画，
 * 且不在 stageLyrics.current/outgoing/upcoming 的动画跟踪表里 —— 保持静态，
 * 不各自播放入场/退场。所以模式为 off 时（默认）对既有歌词观感零影响。
 * disposeLyricMesh 会 traverse 子节点，译文随父行一起回收，无泄漏。
 */
function attachLyricTranslation(parentMesh, translationText) {
  if (!parentMesh || !translationText) return null;
  var group = buildLyricMesh(String(translationText));
  if (!group) return null;
  var data = group.userData.lyric || {};
  // 记录文本：切模式/换行时据此判断要不要重建网格（文本没变只切 visible）
  group.userData.translationText = String(translationText);
  // 静态化：不让它走入场动画
  group.userData.state = 'idle';
  group.userData.age = 99;
  group.userData.staticTranslationChild = true;
  group.position.set(0, -0.46 * lyricTranslationGapValue(), 0.015);
  group.scale.setScalar(lyricTranslationScaleValue());
  // 译文只保留文字层：可读性底衬/辉光/太阳/光粒全关，避免压住主行
  if (data.readabilityMat) data.readabilityMat.opacity = 0;
  if (data.glowMat) data.glowMat.opacity = 0;
  if (data.sunMat) data.sunMat.opacity = 0;
  if (data.sparkMat) data.sparkMat.opacity = 0;
  if (data.sparks) data.sparks.visible = false;
  if (data.textMat && data.textMat.uniforms) {
    // uProgress=1：整句统一底色，不做跟唱高亮
    if (data.textMat.uniforms.uProgress) data.textMat.uniforms.uProgress.value = 1;
    if (data.textMat.uniforms.uOpacity) data.textMat.uniforms.uOpacity.value = lyricTranslationOpacityValue();
  }
  parentMesh.add(group);
  return group;
}

/**
 * 译文该不该在某个位置显示（按模式 + 位置判定）。
 *
 * 位置分三种，对应沉浸/多行模式下屏幕上的三段：
 *  - current ：当前唱到的那一行
 *  - parked  ：**上方**已唱过的停驻行（stageLyrics.outgoing 里 userData.parked 的那些）
 *  - upcoming：**下方**还没唱到的预告行
 *
 * 修过的坑（2026-09-21 用户实测）：早期实现只给 current + upcoming 挂译文，
 * 于是「多行」模式下**上方停驻行永远没有译文**，看起来像"只翻译了后面的歌词"。
 *
 * @param {'current'|'parked'|'upcoming'} slotKind
 * @param {number} [slot] upcoming 的槽位（0 起）
 */
function lyricTranslationWantedAt(slotKind, slot) {
  var mode = lyricTranslationModeValue();
  if (mode === 'off') return false;
  if (slotKind === 'current') return true;
  if (mode === 'current') return false;      // 仅当前行
  if (mode === 'dual') return slotKind === 'upcoming' && slot === 0;   // 当前 + 下方第一行
  return true;                                // multi：上方停驻行 + 下方预告行全要
}

/** 取第 idx 行的歌词对象（越界/非法返回 null） */
function lyricLineAt(idx) {
  if (typeof idx !== 'number' || idx < 0 || !Array.isArray(lyricsLines)) return null;
  return lyricsLines[idx] || null;
}

/**
 * 同步某行 mesh 的译文子节点：需要则挂上并显示，不需要则隐藏。
 * 文本变了才重建网格（重建要重绘文字纹理）；否则只切 visible —— 所以切模式是瞬时的。
 */
function syncMeshTranslation(mesh, line, slotKind, slot) {
  if (!mesh || !mesh.userData) return;
  var wanted = lyricTranslationWantedAt(slotKind, slot);
  var text = (wanted && line && line.translation) ? String(line.translation) : '';
  var child = mesh.userData.translationMesh;
  if (!text) {
    if (child) child.visible = false;
    return;
  }
  if (child && child.userData && child.userData.translationText === text) {
    child.visible = true;
    return;
  }
  if (child) {
    mesh.remove(child);
    disposeLyricMesh(child);
    mesh.userData.translationMesh = null;
  }
  var built = attachLyricTranslation(mesh, text);
  if (built) mesh.userData.translationMesh = built;
}

/**
 * 重建/同步所有活跃行的译文（切模式、切字体、行滚动时调用）。
 * 覆盖当前行 + 全部 outgoing（停驻行与退场行）+ 全部预告行。
 */
function refreshLyricTranslations() {
  if (!stageLyrics) return;
  syncMeshTranslation(stageLyrics.current, lyricLineAt(stageLyrics.currentIdx), 'current');
  if (Array.isArray(stageLyrics.outgoing)) {
    for (var i = 0; i < stageLyrics.outgoing.length; i++) {
      var m = stageLyrics.outgoing[i];
      if (!m || !m.userData) continue;
      syncMeshTranslation(m, lyricLineAt(m.userData.lineIdx), 'parked');
    }
  }
  if (Array.isArray(stageLyrics.upcoming)) {
    for (var j = 0; j < stageLyrics.upcoming.length; j++) {
      var um = stageLyrics.upcoming[j];
      if (!um || !um.userData) continue;
      syncMeshTranslation(um, lyricLineAt(um.userData.lineIdx), 'upcoming', j);
    }
  }
}

/**
 * 拖动译文滑块时**就地**更新已有译文子节点（间距/字号/透明度）。
 * 不重建网格：buildLyricMesh 要重绘文字纹理，滑块拖动时会卡。
 */
function applyLyricTranslationStyle() {
  if (!stageLyrics) return;
  var gap = lyricTranslationGapValue();
  var scale = lyricTranslationScaleValue();
  var alpha = lyricTranslationOpacityValue();
  function apply(mesh) {
    if (!mesh || !mesh.userData) return;
    var t = mesh.userData.translationMesh;
    if (!t) return;
    t.position.y = -0.46 * gap;
    t.scale.setScalar(scale);
    var d = t.userData.lyric || {};
    if (d.textMat && d.textMat.uniforms && d.textMat.uniforms.uOpacity) d.textMat.uniforms.uOpacity.value = alpha;
  }
  apply(stageLyrics.current);
  // 上方停驻/退场行也要跟着调（multi 模式下它们同样有译文）
  if (Array.isArray(stageLyrics.outgoing)) stageLyrics.outgoing.forEach(apply);
  if (Array.isArray(stageLyrics.upcoming)) stageLyrics.upcoming.forEach(apply);
}

/**
 * 双语翻译模式（上游同款四态）：off 关闭 / current 当前 / dual 双行 / multi 多行
 * @param {string} mode
 */
function setLyricTranslationMode(mode) {
  fx.lyricTranslationMode = normalizeLyricTranslationMode(mode);
  syncLyricTranslationControls();
  refreshLyricTranslations();
  saveLyricLayout({ user: true, reason: 'lyricTranslationMode' });
  showToast(fx.lyricTranslationMode === 'off' ? '双语翻译：关闭'
    : fx.lyricTranslationMode === 'current' ? '双语翻译：仅当前行'
      : fx.lyricTranslationMode === 'dual' ? '双语翻译：当前 + 下一行'
        : '双语翻译：当前 + 全部上下文行');
}

/** 同步「双语翻译」四态按钮（3 个滑块的同步走 updateFxControls 的 setRange 表） */
function syncLyricTranslationControls() {
  var seg = document.getElementById('lyric-translation-mode-seg');
  if (!seg) return;
  var mode = lyricTranslationModeValue();
  Array.prototype.forEach.call(seg.querySelectorAll('button[data-translation]'), function(b){
    b.classList.toggle('active', b.getAttribute('data-translation') === mode);
  });
}

function showStageLine(text, redrawOnly) {
  createLyricsParticles();
  if (!stageLyrics.group) return;
  if (!text) { clearStageLyrics(); return; }
  if (redrawOnly && stageLyrics.current) {
    disposeLyricMesh(stageLyrics.current);
    stageLyrics.current = null;
  } else if (stageLyrics.current) {
    var outgoingMesh = stageLyrics.current;
    outgoingMesh.userData.state = 'out';
    if (stageLyricParkCount() > 0) {
      // 多行模式：旧行不立刻淡出，缩小上移停驻到当前行上方
      outgoingMesh.userData.parked = true;
      outgoingMesh.userData.age = 0;
      stageLyrics.outgoing.push(outgoingMesh);
      expireParkedLyricLines();
    } else {
      outgoingMesh.userData.age = 0;
      stageLyrics.outgoing.push(outgoingMesh);
    }
    // 这行刚从「当前行」变成「上方停驻/退场行」：按新身份重新同步译文
    // （multi 模式要保留译文，current/dual 模式要隐藏 —— 早期实现漏了这一步，
    //   导致上方停驻行永远没有译文）
    syncMeshTranslation(outgoingMesh, lyricLineAt(outgoingMesh.userData.lineIdx), 'parked');
  }
  stageLyrics.currentText = text;
  var mesh = buildLyricMesh(text);
  stageLyrics.group.add(mesh);
  stageLyrics.current = mesh;
  // 记录行号：这行之后会变成「停驻行」，那时要靠它找回自己的译文
  mesh.userData.lineIdx = stageLyrics.currentIdx;
  // 双语翻译：按模式给当前行挂/显示译文（off 时不挂，零额外开销）
  syncMeshTranslation(mesh, lyricLineAt(stageLyrics.currentIdx), 'current');
}

function refreshCurrentLyricStyle() {
  if (!stageLyrics || !stageLyrics.currentText || !stageLyrics.current) return;
  var progress = stageLyrics.current.userData ? (stageLyrics.current.userData.lastLyricProgress || 0) : 0;
  showStageLine(stageLyrics.currentText, true);
  updateLyricMeshProgress(stageLyrics.current, progress);
  if (stageLyrics.current && stageLyrics.current.userData) stageLyrics.current.userData.age = 0.48;
}
// 字体/排版类设置变化时重建全部活跃行（旧版只换当前行，停驻/预告行要等行滚动才逐行替换，被感知为"没全变"）
function refreshAllLyricLineFonts() {
  refreshCurrentLyricStyle();
  // 当前行：按原文本重建（纹理清晰度/避光强度变化需要重绘纹理），保留动画状态
  var cur = stageLyrics.current;
  if (cur && cur.userData && cur.userData.text) {
    var curLineIdx = cur.userData.lineIdx;
    var keepState = cur.userData.state;
    var keepAge = cur.userData.age;
    var keepProgress = cur.userData.lastLyricProgress;
    var curPos = cur.position.clone();
    var curScale = cur.scale.x;
    disposeLyricMesh(cur);
    var nc = buildLyricMesh(cur.userData.text);
    nc.userData.state = keepState || 'in';
    nc.userData.age = keepAge || 0;
    if (keepProgress != null) nc.userData.lastLyricProgress = keepProgress;
    nc.userData.lineIdx = curLineIdx;
    nc.position.copy(curPos);
    nc.scale.setScalar(curScale);
    stageLyrics.current = nc;
    if (stageLyrics.group) stageLyrics.group.add(nc);
    syncMeshTranslation(nc, lyricLineAt(curLineIdx), 'current');
  }
  // 停驻行：按原文本与档位重建，渐显直接置满（不重播入场动画）、位置给目标值
  var out = stageLyrics.outgoing;
  if (Array.isArray(out)) {
    for (var i = 0; i < out.length; i++) {
      var m = out[i];
      if (!m || !m.userData || !m.userData.parked || !m.userData.text) continue;
      var parkRank = 1;
      for (var pi = out.length - 1; pi >= 0; pi--) {
        if (out[pi] === m) break;
        if (out[pi] && out[pi].userData && out[pi].userData.parked) parkRank++;
      }
      var ps = parkLyricStyleFor(parkRank);
      var oldLineIdx = m.userData.lineIdx;
      disposeLyricMesh(m);
      var nm = buildLyricMesh(m.userData.text, true);
      nm.userData.parked = true;
      nm.userData.lineIdx = oldLineIdx;             // 保留行号：双语翻译要靠它找回译文
      nm.userData.age = 0.42;                       // 渐显置满
      nm.position.set(0, ps.y, ps.z);
      nm.scale.setScalar(ps.scale);
      out[i] = nm;
      if (stageLyrics.group) stageLyrics.group.add(nm);
      // 重建后译文子节点已随旧网格销毁，按新身份重新同步
      syncMeshTranslation(nm, lyricLineAt(oldLineIdx), 'parked');
    }
  }
  // 预告行：清掉后按槽位重建（播放中由 tick 主分支驱动，暂停中由下方 sync 直接重建）
  clearUpcomingLyricLines();
  if (stageLyricUpcomingCount() > 0 && stageLyrics.currentIdx >= 0 && lyricsLines.length) {
    syncUpcomingLyricLines(stageLyrics.currentIdx);
  }
}

// ============ 歌词校准（对齐上游 Minera lyric-timing-offset 体系） ============
// 按歌曲记忆歌词偏移（±5s，0.1s 步进），播放栏"词"按钮 hover 展开校准面板
var LYRIC_TIMING_OFFSET_STORE_KEY = 'bhandsmusic-lyric-timing-offsets-v1';
var LYRIC_TIMING_OFFSET_LIMIT = 500;
var lyricTimingOffsetMap = readLyricTimingOffsetMap();
var lyricTimingPopoverCloseTimer = null;

function normalizeLyricTimingOffsetSeconds(value) {
  var raw = Number(value);
  if (!isFinite(raw)) raw = 0;
  return Math.round(clampRange(raw, -5, 5) * 10) / 10;
}

function lyricTimingOffsetEntryValue(entry) {
  if (entry && typeof entry === 'object') return normalizeLyricTimingOffsetSeconds(entry.offset);
  return normalizeLyricTimingOffsetSeconds(entry);
}

function readLyricTimingOffsetMap() {
  try {
    var raw = JSON.parse(localStorage.getItem(LYRIC_TIMING_OFFSET_STORE_KEY) || '{}');
    var items = raw && raw.version === 1 && raw.items ? raw.items : raw;
    var out = {};
    Object.keys(items || {}).forEach(function (key) {
      var entry = items[key];
      var offset = lyricTimingOffsetEntryValue(entry);
      if (offset) {
        out[key] = {
          offset: offset,
          updatedAt: Number(entry && entry.updatedAt) || 0,
          title: String(entry && entry.title || '').slice(0, 80),
          artist: String(entry && entry.artist || '').slice(0, 80)
        };
      }
    });
    return out;
  } catch (e) {
    return {};
  }
}

function writeLyricTimingOffsetMap() {
  try {
    var keys = Object.keys(lyricTimingOffsetMap || {}).sort(function (a, b) {
      return (Number(lyricTimingOffsetMap[b] && lyricTimingOffsetMap[b].updatedAt) || 0) - (Number(lyricTimingOffsetMap[a] && lyricTimingOffsetMap[a].updatedAt) || 0);
    }).slice(0, LYRIC_TIMING_OFFSET_LIMIT);
    var items = {};
    keys.forEach(function (key) { items[key] = lyricTimingOffsetMap[key]; });
    lyricTimingOffsetMap = items;
    if (!keys.length) {
      localStorage.removeItem(LYRIC_TIMING_OFFSET_STORE_KEY);
      return;
    }
    localStorage.setItem(LYRIC_TIMING_OFFSET_STORE_KEY, JSON.stringify({ version: 1, savedAt: Date.now(), items: items }));
  } catch (e) { }
}

function lyricTimingCurrentSong() {
  if (typeof currentCoverSong === 'function') return currentCoverSong();
  if (currentIdx >= 0 && playQueue && playQueue[currentIdx]) return playQueue[currentIdx];
  return currentLocalSong || null;
}

function lyricTimingSongKey(song) {
  song = song || lyricTimingCurrentSong();
  if (!song) return '';
  if (typeof queueItemKey === 'function') return queueItemKey(song);
  if (song.localKey) return 'local:' + song.localKey;
  if (song.id != null && song.id !== '') return 'song:' + song.id;
  return String(song.name || '') + '|' + String(song.artist || '');
}

function getLyricTimingOffsetForSong(song) {
  var key = lyricTimingSongKey(song);
  return key && lyricTimingOffsetMap && lyricTimingOffsetMap[key] ? lyricTimingOffsetEntryValue(lyricTimingOffsetMap[key]) : 0;
}

function getActiveLyricTimingOffsetSeconds() {
  return getLyricTimingOffsetForSong(lyricTimingCurrentSong());
}

function getAdjustedLyricPlaybackTime(rawTime) {
  var t = Number(rawTime);
  if (!isFinite(t)) t = 0;
  return Math.max(0, t + getActiveLyricTimingOffsetSeconds());
}

function formatLyricTimingOffset(offset) {
  offset = normalizeLyricTimingOffsetSeconds(offset);
  if (!offset) return '0.0s';
  return (offset > 0 ? '+' : '-') + Math.abs(offset).toFixed(1) + 's';
}

function lyricTimingToastText(offset) {
  offset = normalizeLyricTimingOffsetSeconds(offset);
  if (!offset) return '歌词校准已重置';
  return offset > 0 ? ('歌词提前 ' + Math.abs(offset).toFixed(1) + 's') : ('歌词延后 ' + Math.abs(offset).toFixed(1) + 's');
}

function releaseLyricTimingPopoverFocus(root) {
  root = root || document.getElementById('lyric-timing-control');
  var active = document.activeElement;
  if (!root || !active || !root.contains(active) || typeof active.blur !== 'function') return;
  try { active.blur(); } catch (e) { }
}

function clearLyricTimingPopoverClose() {
  if (lyricTimingPopoverCloseTimer) {
    clearTimeout(lyricTimingPopoverCloseTimer);
    lyricTimingPopoverCloseTimer = null;
  }
  var root = document.getElementById('lyric-timing-control');
  if (root) root.classList.remove('closing');
}

// fork 无音量面板 sibling 联动，保留空实现以对齐上游调用结构
function suppressLyricTimingSiblingPanels(suppressed) { }

function lyricTimingControlIsActive(root) {
  root = root || document.getElementById('lyric-timing-control');
  if (!root) return false;
  var active = document.activeElement;
  return !!((root.matches && root.matches(':hover')) || (active && root.contains(active)));
}

function releaseLyricTimingSiblingPanelsSoon(root) {
  setTimeout(function () {
    if (!lyricTimingControlIsActive(root)) suppressLyricTimingSiblingPanels(false);
  }, 70);
}

function closeLyricTimingPopover(force) {
  var root = document.getElementById('lyric-timing-control');
  if (!root) return;
  if (lyricTimingPopoverCloseTimer) {
    clearTimeout(lyricTimingPopoverCloseTimer);
    lyricTimingPopoverCloseTimer = null;
  }
  releaseLyricTimingPopoverFocus(root);
  root.classList.add('closing');
  lyricTimingPopoverCloseTimer = setTimeout(function () {
    lyricTimingPopoverCloseTimer = null;
    root.classList.remove('closing');
  }, force ? 220 : 160);
  suppressLyricTimingSiblingPanels(false);
}

function updateLyricTimingOffsetUi(songOverride) {
  var song = songOverride || lyricTimingCurrentSong();
  var key = lyricTimingSongKey(song);
  var offset = getLyricTimingOffsetForSong(song);
  var root = document.getElementById('lyric-timing-control');
  var value = document.getElementById('lyric-timing-value');
  var songEl = document.getElementById('lyric-timing-song');
  if (root) root.classList.toggle('has-offset', !!offset);
  if (value) value.textContent = formatLyricTimingOffset(offset);
  if (songEl) songEl.textContent = song ? (song.name || song.title || '当前歌曲') : '未选择歌曲';
  document.querySelectorAll('[data-lyric-offset-step],[data-lyric-offset-reset]').forEach(function (btn) {
    btn.disabled = !key;
  });
}

function refreshLyricTimingAfterOffsetChange() {
  if (stageLyrics) {
    stageLyrics.currentIdx = -999;   // 强制 tick 主分支按新偏移重建当前行
  }
  if (typeof pushDesktopLyricsState === 'function') pushDesktopLyricsState(true);
}

function setCurrentLyricTimingOffset(offset, opts) {
  opts = opts || {};
  var song = lyricTimingCurrentSong();
  var key = lyricTimingSongKey(song);
  if (!key || !song) {
    updateLyricTimingOffsetUi(song);
    if (!opts.silent) showToast('请先播放歌曲');
    return 0;
  }
  offset = normalizeLyricTimingOffsetSeconds(offset);
  var previous = key && lyricTimingOffsetMap && lyricTimingOffsetMap[key] ? lyricTimingOffsetEntryValue(lyricTimingOffsetMap[key]) : 0;
  var hadEntry = !!(key && lyricTimingOffsetMap && lyricTimingOffsetMap[key]);
  if (!offset && !hadEntry) {
    updateLyricTimingOffsetUi(song);
    refreshLyricTimingAfterOffsetChange();
    if (!opts.silent) showToast(lyricTimingToastText(0));
    return 0;
  }
  if (offset && hadEntry && previous === offset) {
    updateLyricTimingOffsetUi(song);
    if (!opts.silent) showToast(lyricTimingToastText(offset));
    return offset;
  }
  if (offset) {
    lyricTimingOffsetMap[key] = {
      offset: offset,
      updatedAt: Date.now(),
      title: String(song.name || song.title || '').slice(0, 80),
      artist: String(song.artist || '').slice(0, 80)
    };
  } else if (lyricTimingOffsetMap && lyricTimingOffsetMap[key]) {
    delete lyricTimingOffsetMap[key];
  }
  writeLyricTimingOffsetMap();
  updateLyricTimingOffsetUi(song);
  refreshLyricTimingAfterOffsetChange();
  if (!opts.silent) showToast(lyricTimingToastText(offset));
  return offset;
}

function adjustCurrentLyricTimingOffset(delta) {
  var next = getActiveLyricTimingOffsetSeconds() + (Number(delta) || 0);
  return setCurrentLyricTimingOffset(next);
}

function handleLyricTimingOffsetClick(e) {
  if (e && e._bhandsmusicLyricTimingHandled) return;
  var stepBtn = e && e.target && e.target.closest ? e.target.closest('[data-lyric-offset-step]') : null;
  var resetBtn = e && e.target && e.target.closest ? e.target.closest('[data-lyric-offset-reset]') : null;
  if (!stepBtn && !resetBtn) return;
  if (e) {
    e._bhandsmusicLyricTimingHandled = true;
    e.preventDefault();
    e.stopPropagation();
  }
  if (resetBtn) setCurrentLyricTimingOffset(0);
  else adjustCurrentLyricTimingOffset(Number(stepBtn.getAttribute('data-lyric-offset-step')) || 0);
  releaseLyricTimingPopoverFocus(document.getElementById('lyric-timing-control'));
}

function bindLyricTimingOffsetControls() {
  var root = document.getElementById('lyric-timing-control');
  if (!root || root._bhandsmusicLyricTimingBound) return;
  root._bhandsmusicLyricTimingBound = true;
  root.addEventListener('mouseenter', function () {
    suppressLyricTimingSiblingPanels(true);
    clearLyricTimingPopoverClose();
    updateLyricTimingOffsetUi();
  });
  root.addEventListener('focusin', function () {
    suppressLyricTimingSiblingPanels(true);
    clearLyricTimingPopoverClose();
    updateLyricTimingOffsetUi();
  });
  root.addEventListener('mouseleave', function () { releaseLyricTimingSiblingPanelsSoon(root); });
  root.addEventListener('focusout', function () { releaseLyricTimingSiblingPanelsSoon(root); });
  root.addEventListener('click', handleLyricTimingOffsetClick);
  root.querySelectorAll('[data-lyric-offset-step],[data-lyric-offset-reset]').forEach(function (btn) {
    btn.addEventListener('click', handleLyricTimingOffsetClick);
  });
  document.addEventListener('pointerdown', function (e) {
    if (!root.contains(e.target)) closeLyricTimingPopover(false);
  }, true);
  updateLyricTimingOffsetUi();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindLyricTimingOffsetControls);
else bindLyricTimingOffsetControls();

// 下方预告行维护：槽位数由显示模式决定；行号对不上（自然推进/seek）就重建对应槽位
function clearUpcomingLyricLines() {
  if (!Array.isArray(stageLyrics.upcoming)) { stageLyrics.upcoming = []; return; }
  for (var i = 0; i < stageLyrics.upcoming.length; i++) {
    if (stageLyrics.upcoming[i]) disposeLyricMesh(stageLyrics.upcoming[i]);
    stageLyrics.upcoming[i] = null;
  }
}
function syncUpcomingLyricLines(idx) {
  if (!stageLyrics.group) return;
  var upcomingCount = stageLyricUpcomingCount();
  if (!Array.isArray(stageLyrics.upcoming) || stageLyrics.upcoming.length !== upcomingCount) {
    var next = [];
    for (var n = 0; n < upcomingCount; n++) next.push(null);
    if (Array.isArray(stageLyrics.upcoming)) {
      for (var old = upcomingCount; old < stageLyrics.upcoming.length; old++) {
        if (stageLyrics.upcoming[old]) disposeLyricMesh(stageLyrics.upcoming[old]);
      }
      for (var cp = 0; cp < upcomingCount && cp < stageLyrics.upcoming.length; cp++) next[cp] = stageLyrics.upcoming[cp];
    }
    stageLyrics.upcoming = next;
  }
  for (var slot = 0; slot < upcomingCount; slot++) {
    var lineIdx = idx + 1 + slot;
    var line = lyricsLines[lineIdx];
    var wantText = line ? String(line.text || '') : '';
    var mesh = stageLyrics.upcoming[slot];
    if (mesh && mesh.userData.lineIdx !== lineIdx) {
      disposeLyricMesh(mesh);
      mesh = null;
      stageLyrics.upcoming[slot] = null;
    }
    if (!wantText) {
      if (mesh) { disposeLyricMesh(mesh); stageLyrics.upcoming[slot] = null; }
      continue;
    }
    if (!mesh) {
      mesh = buildLyricMesh(wantText, true);
      mesh.userData.lineIdx = lineIdx;
      mesh.userData.upcoming = true;
      var ps = upcomingLyricStyleFor(slot);
      mesh.position.set(0, ps.y, ps.z);
      mesh.scale.setScalar(ps.scale);
      stageLyrics.group.add(mesh);
      stageLyrics.upcoming[slot] = mesh;
      // 双语翻译：dual 只给第一行预告行，multi 给全部（off/current 不挂）
      syncMeshTranslation(mesh, line, 'upcoming', slot);
    }
  }
}

function clearStageLyrics() {
  disposeLyricMesh(stageLyrics.current);
  stageLyrics.current = null;
  stageLyrics.currentIdx = -1;
  stageLyrics.currentText = '';
  while (stageLyrics.outgoing.length) disposeLyricMesh(stageLyrics.outgoing.pop());
  clearUpcomingLyricLines();
}

function updateStageLyrics3D(dt) {
  if (!stageLyrics.group) return;
  if (!fx.particleLyrics && !stageLyrics.current && (!stageLyrics.outgoing || !stageLyrics.outgoing.length)) return;
  if (!isFinite(stageLyrics.highBloom)) stageLyrics.highBloom = 0;
  if (!isFinite(stageLyrics.beatGlow)) stageLyrics.beatGlow = 0;
  if (!isFinite(stageLyrics.glowFollowX)) stageLyrics.glowFollowX = 0;
  if (!isFinite(stageLyrics.glowFollowY)) stageLyrics.glowFollowY = 0;
  if (!isFinite(stageLyrics.glowFollowRoll)) stageLyrics.glowFollowRoll = 0;
  var t = uniforms.uTime.value;
  var lyricGlowStrength = fx.lyricGlow ? Math.min(0.85, Math.max(0, fx.lyricGlowStrength)) : 0;
  var glowDrive = Math.min(1.7, Math.max(0, lyricGlowStrength / 0.50));
  var glowBreath = lyricGlowStrength > 0 ? (0.5 + 0.5 * Math.sin(t * 1.05)) : 0;
  var musicBloom = Math.max(lyricSunEnergy, beatPulse * 0.10);
  var beatGlowRaw = fx.lyricGlowBeat && lyricGlowStrength > 0
    ? Math.max(beatPulse * 1.22, beatCam.punch * 0.86 + beatCam.radiusKick * 1.85)
    : 0;
  stageLyrics.beatGlow += (beatGlowRaw - stageLyrics.beatGlow) * (beatGlowRaw > stageLyrics.beatGlow ? 0.32 : 0.10);
  if (!isFinite(stageLyrics.beatGlow)) stageLyrics.beatGlow = 0;
  var skullLyricPreset = !!(fx && fx.preset === SKULL_PRESET_INDEX);
  var solarBloom = lyricGlowStrength > 0 ? (0.18 + glowBreath * 0.16 + musicBloom * 0.90 + stageLyrics.beatGlow * 1.18 + Math.sin(t * 0.37 + 1.2) * 0.035) * glowDrive : 0;
  if (skullLyricPreset && lyricGlowStrength > 0) {
    solarBloom = (0.035 + glowBreath * 0.030 + musicBloom * 0.11 + Math.pow(Math.max(0, stageLyrics.beatGlow), 1.26) * 1.45 + Math.pow(Math.max(0, skullBeatFlash || 0), 1.08) * 1.18) * glowDrive;
  }
  solarBloom = Math.max(0, Math.min(1.45, solarBloom));
  stageLyrics.highBloom += (solarBloom - stageLyrics.highBloom) * (solarBloom > stageLyrics.highBloom ? (skullLyricPreset ? 0.22 : 0.075) : (skullLyricPreset ? 0.070 : 0.050));
  if (!isFinite(stageLyrics.highBloom)) stageLyrics.highBloom = 0;
  updateLyricStarRiver(dt);
  var followDrive = fx.lyricGlowBeat && lyricGlowStrength > 0 ? Math.min(1.35, stageLyrics.beatGlow) : 0;
  var followXTarget = followDrive * (beatCam.thetaKick * 34 + beatCam.rollKick * 8);
  var followYTarget = followDrive * (beatCam.phiKick * 42 - beatCam.radiusKick * 0.48);
  var followRollTarget = followDrive * (beatCam.rollKick * 22 + beatCam.thetaKick * 10);
  stageLyrics.glowFollowX += (followXTarget - stageLyrics.glowFollowX) * 0.26;
  stageLyrics.glowFollowY += (followYTarget - stageLyrics.glowFollowY) * 0.24;
  stageLyrics.glowFollowRoll += (followRollTarget - stageLyrics.glowFollowRoll) * 0.22;
  stageLyrics.glowFollowX *= 0.92;
  stageLyrics.glowFollowY *= 0.92;
  stageLyrics.glowFollowRoll *= 0.90;
  var layoutScale = clampRange(Number(fx.lyricScale) || 1, 0.35, 1.65);
  var layoutX = clampRange(Number(fx.lyricOffsetX) || 0, -2.0, 2.0);
  var layoutY = clampRange(Number(fx.lyricOffsetY) || 0, -1.2, 1.35);
  var layoutZ = clampRange(Number(fx.lyricOffsetZ) || 0, -1.6, 1.6);
  var layoutTiltX = clampRange(Number(fx.lyricTiltX) || 0, -42, 42);
  var layoutTiltY = clampRange(Number(fx.lyricTiltY) || 0, -42, 42);
  var skullMouthLyrics = !!(camera && fx && fx.preset === SKULL_PRESET_INDEX && skullParticleGroup && skullParticleGroup.visible);
  var shelfDetailOpen = !!(shelfManager && shelfManager.hasOpenContent && shelfManager.hasOpenContent());
  var skullShelfDetailOpen = !!(fx && fx.preset === SKULL_PRESET_INDEX && shelfDetailOpen);
  var normalShelfDetailOpen = !!(shelfDetailOpen && !skullShelfDetailOpen);
  stageLyrics.group.renderOrder = shelfDetailOpen ? 24 : 38;
  var shelfDetailLyricProfile = shelfDetailOpen ? {
    opacity: skullShelfDetailOpen ? 0.30 : 0.38,
    readability: skullShelfDetailOpen ? 0.20 : 0.26,
    bloom: skullShelfDetailOpen ? 0.20 : 0.24,
    glowCap: skullShelfDetailOpen ? 0.050 : 0.070,
    outgoing: skullShelfDetailOpen ? 0.34 : 0.42,
    easeDown: 0.34
  } : {
    opacity: 0.96,
    readability: 0.86,
    bloom: 1,
    glowCap: 1.0,
    outgoing: 1,
    easeDown: 0.16
  };
  var shelfLyricAvoid = shouldAvoidStageLyricsForShelf();
  var wallpaperLyricLock = shouldUseWallpaperLyricCameraLock();
  var wallpaperShelfLyrics = wallpaperLyricLock && shouldDimWallpaperForShelf();
  if (wallpaperLyricLock) {
    layoutScale *= wallpaperShelfLyrics ? 0.60 : 0.84;
    layoutX = clampRange(layoutX + (wallpaperShelfLyrics ? -1.34 : 0), -2.0, 2.0);
    layoutY = clampRange(layoutY + (wallpaperShelfLyrics ? -0.04 : 0.08), -1.2, 1.35);
    layoutZ = clampRange(layoutZ + (wallpaperShelfLyrics ? 1.02 : 1.15), -1.6, 1.6);
  } else if (!skullMouthLyrics && shelfLyricAvoid && fx.lyricCameraLock) {
    layoutScale *= 0.72;
    layoutX = clampRange(layoutX - 1.36, -2.0, 2.0);
    layoutY = clampRange(layoutY + 0.06, -1.2, 1.35);
    layoutZ = clampRange(layoutZ + 0.72, -1.6, 1.6);
  } else if (!skullMouthLyrics && shouldOffsetLyricsForShelfDetail()) {
    layoutScale *= normalShelfDetailOpen ? 0.56 : 0.70;
    layoutX = clampRange(layoutX - (normalShelfDetailOpen ? 1.78 : 1.58), -2.0, 2.0);
    layoutY = clampRange(layoutY + (normalShelfDetailOpen ? 0.18 : 0.08), -1.2, 1.35);
    layoutZ = clampRange(layoutZ + 0.84, -1.6, 1.6);
  }
  if (skullMouthLyrics) {
    layoutScale *= skullShelfDetailOpen ? 0.52 : (shelfLyricAvoid ? 0.58 : 0.66);
    if (shelfLyricAvoid && !skullShelfDetailOpen) {
      layoutX = clampRange(layoutX - 0.36, -2.0, 2.0);
      layoutY = clampRange(layoutY + 0.02, -1.2, 1.35);
      layoutZ = clampRange(layoutZ + 0.18, -1.6, 1.6);
    }
  }
  var lockBaseDistance = wallpaperShelfLyrics ? 5.58 : 4.85;
  var lockDistance = lockBaseDistance + layoutZ;
  var cameraLockedLyrics = (fx.lyricCameraLock || wallpaperLyricLock) && camera;
  var skullLyricEdgeGuard = !!(fx && fx.preset === SKULL_PRESET_INDEX && (orbit.centerLocked || orbit.recentering));
  var lockFit = (cameraLockedLyrics || skullLyricEdgeGuard || skullMouthLyrics) ? lyricCameraLockFit(layoutScale, layoutX, layoutY, skullMouthLyrics ? Math.max(2.2, 4.4 + layoutZ) : lockDistance) : 1;
  if (skullMouthLyrics) lockFit = Math.min(lockFit, 1.12);
  if (!isFinite(stageLyrics.lockFitScale)) stageLyrics.lockFitScale = 1;
  stageLyrics.lockFitScale += (lockFit - stageLyrics.lockFitScale) * (lockFit < stageLyrics.lockFitScale ? 0.18 : 0.10);
  /* 歌词与场景主体同步（2026-09-24）：场景主体的屏上占比由各预设「几何+机位」配套设计
   * （实测 9-17 号全部 96-100%），而歌词文本平面世界尺寸恒定（worldW=6.10×0.96）、
   * 屏上大小 ∝ 1/(相机到歌词的距离) —— 切预设时歌词屏宽极差 1.84 倍（jelly ↔ burst），
   * 用户感知为「每个场景歌词大小都不一样」。
   * 补偿锚定 **baselineRadius（setPreset 写入的预设基准机位）** 而非缓动中的 orbit.radius：
   *  - 切预设进入时：baseline=预设机位 → 补偿随预设变 → 歌词屏宽跨预设归一（用户确认的效果）；
   *  - 滚轮缩放时：滚轮只改 userRadius、不碰 baseline → 补偿不变 → 歌词世界尺寸固定，
   *    与粒子背景一起被透视缩放 —— 保持用户习惯的原始滚轮行为（歌词不钉在屏幕上）。
   * 基准 6.97 = 9-17 号「radius−1.46」均值（rose 附近观感不变）；基准/公式用解析模型而非
   * Box3 实测反推 —— spark 装饰环每次随机重排，Box3 噪声 ±15%，不可定标。
   * 只作用于默认漂浮分支：锁定分支已有 lyricCameraLockFit 视口适配、骷髅分支有自己的布局。 */
  if (!skullMouthLyrics && !cameraLockedLyrics) {
    /* 分母 6.97 = 9-17 号「radius−1.46」均值（ rose 附近为原观感基准）；
     * 再除以 0.87 = 整体再放大 ~15%（2026-09-24 用户要求「歌词初始预设再放大一点」）。
     * 想整体调大/调小歌词：改这个 0.87（越小歌词越大）。 */
    layoutScale *= clampRange((orbit.baselineRadius - 1.46) / 6.97, 0.5, 2.0) / 0.87;
  }
  stageLyrics.group.scale.setScalar(layoutScale * stageLyrics.lockFitScale);
  if (skullMouthLyrics) {
    stageLyrics.snapCameraLockFrames = 0;
    skullParticleGroup.updateMatrixWorld(true);
    skullLyricMouthTarget.copy(skullLyricMouthLocal).applyMatrix4(skullParticleGroup.matrixWorld);
    skullParticleGroup.getWorldQuaternion(skullLyricMouthQuat);
    skullLyricMouthForward.set(0, 0, 1).applyQuaternion(skullLyricMouthQuat);
    skullLyricMouthTarget.addScaledVector(skullLyricMouthForward, 0.020);
    skullLyricReadableQuat.copy(skullLyricMouthQuat);
    setStageLyricViewBasisFromCameraOrQuaternion(skullLyricMouthQuat);
    lyricLayoutTarget.copy(skullLyricMouthTarget);
    applyStageLyricLayoutOffset(lyricLayoutTarget, layoutX, layoutY, layoutZ);
    stageLyricTargetQuaternion(skullLyricReadableQuat, layoutTiltX, layoutTiltY);
    stageLyrics.group.userData = stageLyrics.group.userData || {};
    if (!stageLyrics.group.userData.skullMouthLocked) {
      stageLyrics.group.position.copy(lyricLayoutTarget);
      stageLyrics.group.quaternion.copy(lyricTargetQuat);
      stageLyrics.group.userData.skullMouthLocked = true;
    } else {
      stageLyrics.group.position.lerp(lyricLayoutTarget, 0.26);
      stageLyrics.group.quaternion.slerp(lyricTargetQuat, 0.30);
    }
  } else if (cameraLockedLyrics) {
    if (stageLyrics.group.userData) stageLyrics.group.userData.skullMouthLocked = false;
    setStageLyricViewBasisFromCameraOrQuaternion(null);
    lyricLayoutBase.copy(camera.position).addScaledVector(lyricCameraDir, lockBaseDistance);
    lyricCameraTarget.copy(lyricLayoutBase);
    applyStageLyricLayoutOffset(lyricCameraTarget, layoutX, layoutY, layoutZ);
    stageLyricTargetQuaternion(camera.quaternion, layoutTiltX, layoutTiltY);
    if (stageLyrics.snapCameraLockFrames > 0) {
      stageLyrics.group.position.copy(lyricCameraTarget);
      stageLyrics.group.quaternion.copy(lyricTargetQuat);
      stageLyrics.snapCameraLockFrames -= 1;
    } else {
      var lockPosEase = wallpaperLyricLock ? (wallpaperShelfLyrics ? 0.42 : 0.34) : 0.24;
      var lockQuatEase = wallpaperLyricLock ? (wallpaperShelfLyrics ? 0.44 : 0.36) : 0.22;
      stageLyrics.group.position.lerp(lyricCameraTarget, lockPosEase);
      stageLyrics.group.quaternion.slerp(lyricTargetQuat, lockQuatEase);
    }
  } else {
    if (stageLyrics.group.userData) stageLyrics.group.userData.skullMouthLocked = false;
    stageLyrics.snapCameraLockFrames = 0;
    if (particles) {
      particles.updateMatrixWorld(true);
      particles.getWorldPosition(lyricCoverWorldPos);
      particles.getWorldQuaternion(lyricCoverWorldQuat);
    } else {
      lyricCoverWorldPos.set(0, 0, 0);
      lyricCoverWorldQuat.identity();
    }
    // ⚠️ 2026-09-24：歌词朝向改用**相机**，不再用粒子的世界四元数。
    // 原实现 `stageLyricTargetQuaternion(lyricCoverWorldQuat, ...)`：粒子静止时其世界四元数是
    // identity（平面法线 +Z），而相机是俯视的（预设 phi 0.30~0.34），于是歌词相对镜头恒定歪 ≈phi
    // —— 实测螺旋星云下 19.7°，用户反馈「歌词不是正对着镜头」。
    // 现在位置仍跟随粒子（lyricCoverWorldPos），只把朝向与布局 basis 换到相机坐标系：
    // 拖动/头部追踪时歌词不再跟着粒子转，换来始终正对镜头、可读。
    setStageLyricViewBasisFromCameraOrQuaternion(null);
    lyricLayoutBase.copy(lyricCoverWorldPos);
    lyricLayoutTarget.copy(lyricLayoutBase);
    applyStageLyricLayoutOffset(lyricLayoutTarget, layoutX, layoutY, layoutZ);
    stageLyrics.group.position.copy(lyricLayoutTarget);
    stageLyricTargetQuaternion(camera.quaternion, layoutTiltX, layoutTiltY);
    stageLyrics.group.quaternion.copy(lyricTargetQuat);
  }
  var lyricMotion = lyricMotionProfile();
  function tickMesh(mesh, isCurrent) {
    if (!mesh) return false;
    mesh.userData.age += dt;
    var a = Math.min(1, mesh.userData.age / (isCurrent ? Math.max(0.16, 0.84 * lyricMotion.enter) : Math.max(0.14, 0.73 * lyricMotion.exit)));
    a = a * a * (3 - 2 * a);
    var data = mesh.userData.lyric || {};
    var followMix = isCurrent ? 1.0 : 0.64;
    // 歌词动画：故障态时间触发的抖动/闪烁（shader 级切片/色散预留后续批次）
    // 位置抖动仅当前行（停驻/退场行 position.y 是驻留位/演进位，绝不可绝对覆写）
    var glitchPulse = 0;
    if (lyricMotion.glitch > 0 && !mesh.userData.upcoming) {
      var gT = uniforms.uTime.value * lyricMotion.glitchRate * 2.4;
      var gPhase = Math.sin(gT * 7.3) * Math.sin(gT * 3.1);
      var gGate = 0.92 - lyricMotion.glitch * 0.24 - (lyricMotion.glitchCameraBind ? beatPulse * 0.10 : 0);
      if (gPhase > gGate) glitchPulse = (gPhase - gGate) / Math.max(0.02, 1 - gGate);
    }
    if (isCurrent) {
      if (glitchPulse > 0) {
        mesh.position.x = Math.sin(gT * 41.7) * lyricMotion.glitch * lyricMotion.glitchJitter * 0.024 * (0.55 + beatPulse * 0.8) * glitchPulse;
      } else if (mesh.position.x) {
        mesh.position.x = 0;
      }
    }
    var glowX = stageLyrics.glowFollowX * followMix;
    var glowY = stageLyrics.glowFollowY * followMix;
    var glowRoll = stageLyrics.glowFollowRoll * followMix;
    if (data.glow) {
      data.glow.position.set(glowX * 0.14, glowY * 0.12, -0.006);
      data.glow.rotation.z = glowRoll * 0.30;
    }
    if (data.sun) {
      data.sun.position.set(glowX * 0.42, 0.02 + glowY * 0.34, -0.035);
      data.sun.rotation.z = glowRoll * 0.36;
    }
    if (data.sparks) {
      data.sparks.position.set(glowX * 0.24, glowY * 0.22, 0.010);
      data.sparks.rotation.z = glowRoll * 0.22;
    }
    var opacity = 0;
    if (isCurrent) {
      var shelfDetailLyricDim = shelfDetailLyricProfile.bloom;
      var lyricOpacityTarget = shelfDetailLyricProfile.opacity;
      var currentOpacity = data.textMat ? data.textMat.uniforms.uOpacity.value : 0;
      var opacityEase = shelfDetailOpen && currentOpacity > lyricOpacityTarget ? shelfDetailLyricProfile.easeDown : 0.16;
      opacity = clampRange(currentOpacity + (lyricOpacityTarget - currentOpacity) * opacityEase, 0, 1);
      if (glitchPulse > 0) opacity *= 1 - lyricMotion.glitch * 0.22 * glitchPulse;
      if (data.textMat) data.textMat.uniforms.uOpacity.value = opacity;
      if (data.readabilityMat) {
        var readabilityTarget = opacity * shelfDetailLyricProfile.readability * lyricBackdropAdaptStrengthValue();
        var readabilityEase = shelfDetailOpen && data.readabilityMat.opacity > readabilityTarget ? 0.28 : 0.16;
        data.readabilityMat.opacity += (readabilityTarget - data.readabilityMat.opacity) * readabilityEase;
      }
      if (data.textMat && data.textMat.uniforms.uSolar) {
        var solarTarget = stageLyrics.highBloom * shelfDetailLyricDim;
        var solarEase = shelfDetailOpen && data.textMat.uniforms.uSolar.value > solarTarget ? 0.26 : 0.12;
        data.textMat.uniforms.uSolar.value += (solarTarget - data.textMat.uniforms.uSolar.value) * solarEase;
      }
      var solar = stageLyrics.highBloom * shelfDetailLyricDim;
      var warmth = Math.max(0, Math.min(1, solar * 1.10));
      if (data.glowMat) {
        var glowTarget = lyricGlowStrength > 0 ? Math.min(shelfDetailLyricProfile.glowCap, (0.075 + solar * 0.34 + stageLyrics.beatGlow * 0.16 * shelfDetailLyricDim) * Math.min(3.0, glowDrive)) : 0;
        data.glowMat.opacity += (glowTarget - data.glowMat.opacity) * (glowTarget > data.glowMat.opacity ? 0.095 : (shelfDetailOpen ? 0.20 : 0.055));
        data.glowMat.color.copy(lyricThreeColor(stageLyrics.palette.glowColor || stageLyrics.palette.secondary, '#9cffdf', 0.36)).lerp(lyricSunHotColor, warmth);
      }
      if (data.sparkMat) {
        var sparkTarget = lyricGlowStrength > 0 && fx.lyricGlowParticles && !shelfDetailOpen ? Math.min(0.42, (0.10 + solar * 0.14 + stageLyrics.beatGlow * 0.10) * Math.min(1.6, glowDrive)) : 0;
        var sparkOpacity = getLyricSparkOpacity(data);
        sparkOpacity += (sparkTarget - sparkOpacity) * (sparkTarget > sparkOpacity ? 0.13 : (shelfDetailOpen ? 0.22 : 0.075));
        setLyricSparkOpacity(data, sparkOpacity);
        var sparkSizeTarget = fx.lyricGlowParticles && !shelfDetailOpen ? (0.050 + solar * 0.016 + stageLyrics.beatGlow * 0.026 + bass * 0.008) : 0.035;
        setLyricSparkSize(data, getLyricSparkSize(data) + (sparkSizeTarget - getLyricSparkSize(data)) * 0.12);
        var sparkColor = lyricSunHotColor.clone().lerp(lyricSunColor, 0.22 + solar * 0.18);
        setLyricSparkColor(data, sparkColor);
      }
      var seed = mesh.userData.floatSeed || 0;
      if (data.sunMat) {
        var sunTarget = lyricGlowStrength > 0 && !shelfDetailOpen ? Math.min(0.88, (Math.pow(Math.min(1.35, solar), 1.08) * 0.28 + stageLyrics.beatGlow * 0.20) * Math.min(2.4, glowDrive)) : 0;
        data.sunMat.opacity += (sunTarget - data.sunMat.opacity) * (shelfDetailOpen ? 0.18 : 0.055);
        data.sunMat.color.copy(lyricSunColor).lerp(lyricSunHotColor, solar * 0.55);
      }
      if (data.sun) {
        var sunPulse = solar;
        var beatScale = fx.lyricGlowBeat ? stageLyrics.beatGlow * 0.24 : 0;
        data.sun.scale.set(0.82 + sunPulse * 0.36 + beatScale + Math.sin(t * 1.6) * sunPulse * 0.018, 0.60 + sunPulse * 0.34 + beatScale * 0.72 + Math.cos(t * 1.25) * sunPulse * 0.020, 1);
        data.sun.rotation.z += Math.sin(t * 0.32 + seed) * 0.010 * sunPulse;
      }
      var breathe = Math.sin(t * 0.92 + seed) * 0.050 + Math.sin(t * 0.41 + seed * 0.7) * 0.028;
      if (skullMouthLyrics) {
        var mouthMeshY = -0.070 + Math.sin(t * 0.50 + seed) * 0.018 + Math.sin(t * 1.12 + seed) * 0.006;
        var mouthMeshZ = 0.018 + Math.cos(t * 0.46 + seed) * 0.007;
        var mouthMeshScale = 1.08 + a * 0.040 + breathe * 0.12 + bass * 0.024 + beatPulse * 0.014;
        if (!mesh.userData.skullMouthMeshLocked) {
          mesh.position.set(0, mouthMeshY, mouthMeshZ);
          mesh.userData.skullMouthMeshLocked = true;
        } else {
          mesh.position.x += (0 - mesh.position.x) * 0.18;
          mesh.position.y += (mouthMeshY - mesh.position.y) * 0.16;
          mesh.position.z += (mouthMeshZ - mesh.position.z) * 0.18;
        }
        mesh.scale.setScalar(mouthMeshScale);
        mesh.rotation.z = Math.sin(t * 0.30 + seed) * 0.010;
      } else {
        mesh.userData.skullMouthMeshLocked = false;
        mesh.scale.setScalar(0.96 + a * 0.055 + breathe + bass * 0.038 + beatPulse * 0.014);
        var floatOn = fx.lyricVerticalFloat !== false ? 1 : 0;
        var floatAmp = 0.055 * lyricMotion.floatAmp * floatOn;
        mesh.position.y += ((0.18 + Math.sin(t * 0.55 + seed) * floatAmp + Math.sin(t * 1.35 + seed) * 0.014 * floatOn) - mesh.position.y) * 0.075;
        mesh.position.z += ((1.48 + Math.cos(t * 0.48 + seed) * 0.080) - mesh.position.z) * 0.080;
        mesh.rotation.z = Math.sin(t * 0.34 + seed) * 0.018;
      }
      if (data.sparks && data.sparkMat) data.sparks.visible = fx.lyricGlowParticles || getLyricSparkOpacity(data) > 0.015;
      if (data.sparks && data.basePositions) {
        var pos = data.sparks.geometry.attributes.position;
        var arr = pos.array, base = data.basePositions;
        data.sparks.rotation.z += ((fx.lyricGlowParticles ? 0.0009 : 0.00025) + stageLyrics.beatGlow * 0.0007) * (dt * 60);
        data.sparks.rotation.x = Math.sin(t * 0.12 + seed) * 0.012;
        for (var si = 0; si < arr.length / 3; si++) {
          var s = si * 12.989 + seed;
          var particleBeat = fx.lyricGlowParticles ? stageLyrics.beatGlow : 0;
          var dustBreath = fx.lyricGlowParticles ? (0.62 + 0.38 * Math.sin(t * (0.32 + (si % 7) * 0.025) + s)) : 0.18;
          var drift = fx.lyricGlowParticles ? 1 : 0.30;
          arr[si*3] = base[si*3] + Math.sin(t * (0.18 + (si % 5) * 0.025) + s) * (0.045 + bass * 0.030 + particleBeat * 0.052) * drift + Math.cos(t * 0.11 + s) * 0.018 * dustBreath;
          arr[si*3+1] = base[si*3+1] + Math.cos(t * (0.16 + (si % 6) * 0.024) + s) * (0.042 + mid * 0.026 + particleBeat * 0.046) * drift + Math.sin(t * 0.13 + s) * 0.016 * dustBreath;
          arr[si*3+2] = base[si*3+2] + Math.sin(t * (0.24 + (si % 4) * 0.035) + s) * (0.036 + particleBeat * 0.028) * drift;
        }
        pos.needsUpdate = true;
      }
      return true;
    }
    if (mesh.userData.parked) {
      // 多行模式停驻行：按停驻序缩小上移到当前行上方，透明度逐行递减，常驻不退场
      var pa = Math.min(1, mesh.userData.age / Math.max(0.16, 0.68 * lyricMotion.enter));
      pa = pa * pa * (3 - 2 * pa);
      var parkRank = 1;
      for (var pi = stageLyrics.outgoing.length - 1; pi >= 0; pi--) {
        var pm = stageLyrics.outgoing[pi];
        if (pm === mesh) break;
        if (pm && pm.userData && pm.userData.parked) parkRank++;
      }
      var ps = parkLyricStyleFor(parkRank);
      if (data.textMat) data.textMat.uniforms.uOpacity.value = ps.opacity * pa * shelfDetailLyricProfile.outgoing * (1 - lyricMotion.glitch * 0.28 * glitchPulse);
      if (data.readabilityMat) data.readabilityMat.opacity = ps.readability * pa * (shelfDetailOpen ? shelfDetailLyricProfile.readability : 0.62) * lyricBackdropAdaptStrengthValue();
      if (data.textMat && data.textMat.uniforms.uSolar) data.textMat.uniforms.uSolar.value *= 0.80;
      if (data.glowMat) data.glowMat.opacity = 0;
      if (data.sparkMat) setLyricSparkOpacity(data, 0);
      if (data.sunMat) data.sunMat.opacity = 0;
      if (data.sparks) data.sparks.visible = false;
      mesh.position.x += (0 - mesh.position.x) * 0.2;
      mesh.position.y += (ps.y - mesh.position.y) * 0.10;
      mesh.position.z += (ps.z - mesh.position.z) * 0.08;
      mesh.scale.setScalar(mesh.scale.x + (ps.scale - mesh.scale.x) * 0.12);
      return true;
    }
    opacity = (1 - a) * 0.72 * shelfDetailLyricProfile.outgoing * (1 - lyricMotion.glitch * 0.28 * glitchPulse);
    if (data.textMat) data.textMat.uniforms.uOpacity.value = opacity;
    if (data.readabilityMat) data.readabilityMat.opacity = opacity * (shelfDetailOpen ? shelfDetailLyricProfile.readability : 0.58) * lyricBackdropAdaptStrengthValue();
    if (data.textMat && data.textMat.uniforms.uSolar) data.textMat.uniforms.uSolar.value *= shelfDetailOpen ? 0.72 : 0.86;
    if (data.glowMat) data.glowMat.opacity = lyricGlowStrength > 0 ? (shelfDetailOpen ? Math.min(shelfDetailLyricProfile.glowCap * 0.40, opacity * 0.05 * lyricGlowStrength) : opacity * 0.08 * lyricGlowStrength) : 0;
    if (data.sparkMat) {
      var outgoingSpark = lyricGlowStrength > 0 && fx.lyricGlowParticles && !shelfDetailOpen ? Math.max(opacity * 0.24 * lyricGlowStrength, (1 - a) * 0.18 * lyricGlowStrength) : 0;
      setLyricSparkOpacity(data, outgoingSpark);
      setLyricSparkSize(data, 0.046 + (1 - a) * 0.020);
    }
    if (data.sunMat) data.sunMat.opacity = lyricGlowStrength > 0 && !shelfDetailOpen ? opacity * 0.08 * lyricGlowStrength : 0;
    mesh.position.z -= dt * 0.26;
    mesh.position.y += dt * 0.08;
    mesh.scale.setScalar(0.98 - a * 0.06);
    return a < 1;
  }
  // 五行模式：下方预告行常驻动画（渐显后保持，无卡拉OK/光效）
  function tickUpcoming(mesh, slot) {
    if (!mesh) return;
    mesh.userData.age += dt;
    var a = Math.min(1, mesh.userData.age / Math.max(0.16, 0.68 * lyricMotion.enter));
    a = a * a * (3 - 2 * a);
    var data = mesh.userData.lyric || {};
    var ps = upcomingLyricStyleFor(slot);
    if (data.glow) data.glow.position.set(stageLyrics.glowFollowX * 0.14, stageLyrics.glowFollowY * 0.12, -0.006);
    if (data.textMat) data.textMat.uniforms.uOpacity.value = ps.opacity * a * shelfDetailLyricProfile.outgoing;
    if (data.readabilityMat) data.readabilityMat.opacity = ps.readability * a * (shelfDetailOpen ? shelfDetailLyricProfile.readability : 0.62) * lyricBackdropAdaptStrengthValue();
    if (data.textMat && data.textMat.uniforms.uSolar) data.textMat.uniforms.uSolar.value *= 0.80;
    if (data.glowMat) data.glowMat.opacity = 0;
    if (data.sparkMat) setLyricSparkOpacity(data, 0);
    if (data.sunMat) data.sunMat.opacity = 0;
    if (data.sparks) data.sparks.visible = false;
    mesh.position.y += (ps.y - mesh.position.y) * 0.10;
    mesh.position.z += (ps.z - mesh.position.z) * 0.08;
    mesh.scale.setScalar(mesh.scale.x + (ps.scale - mesh.scale.x) * 0.12);
  }
  tickMesh(stageLyrics.current, true);
  for (var i = stageLyrics.outgoing.length - 1; i >= 0; i--) {
    if (!tickMesh(stageLyrics.outgoing[i], false)) {
      disposeLyricMesh(stageLyrics.outgoing[i]);
      stageLyrics.outgoing.splice(i, 1);
    }
  }
  if (Array.isArray(stageLyrics.upcoming)) {
    for (var ui = 0; ui < stageLyrics.upcoming.length; ui++) {
      if (stageLyrics.upcoming[ui]) tickUpcoming(stageLyrics.upcoming[ui], ui);
    }
  }
}

function getLyricLineProgress(line, nextLine, now) {
  if (!line) return 0;
  now += line.words && line.words.length ? 0.030 : 0.020;
  if (line.words && line.words.length && line.charCount > 0) {
    var lastP = 0;
    for (var i = 0; i < line.words.length; i++) {
      var w = line.words[i];
      var ws = w.t;
      var we = w.t + Math.max(0.08, w.d || 0.24);
      if (now < ws) return lastP;
      var local = now >= we ? 1 : (now - ws) / Math.max(0.08, we - ws);
      local = Math.max(0, Math.min(1, local));
      var p = (w.c0 + (w.c1 - w.c0) * local) / line.charCount;
      lastP = Math.max(lastP, p);
      if (now < we) return lastP;
    }
    return 1;
  }
  var nextT = nextLine && nextLine.t > line.t ? nextLine.t : Math.min((audio && audio.duration) || now + 4, line.t + (line.duration || 4.8));
  var span = Math.max(0.75, nextT - line.t);
  var prog = Math.max(0, Math.min(1, (now - line.t) / span));
  return prog * prog * (3 - 2 * prog);
}

function clearCurrentLyricLineToOutgoing() {
  if (!stageLyrics.current) return;
  stageLyrics.current.userData.state = 'out';
  stageLyrics.current.userData.age = 0;
  stageLyrics.outgoing.push(stageLyrics.current);
  stageLyrics.current = null;
  stageLyrics.currentIdx = -1;
  stageLyrics.currentText = '';
}
function tickLyricsParticles() {
  if (!fx.particleLyrics) {
    if (stageLyrics.current || stageLyrics.currentText || (stageLyrics.outgoing && stageLyrics.outgoing.length)) clearStageLyrics();
    return;
  }
  if (!lyricsLines.length) {
    // 无歌词：无论暂停开关一律退场，不残留上一首的词
    unparkAllLyricLines();
    clearUpcomingLyricLines();
    clearCurrentLyricLineToOutgoing();
    return;
  }
  if (!playing || !audio) {
    if (!fx.lyricPauseHold) {
      // 暂停即退场：停驻行/预告行/当前行全部淡出
      unparkAllLyricLines();
      clearUpcomingLyricLines();
      clearCurrentLyricLineToOutgoing();
      return;
    }
    // 恢复态（重启后未点播）：歌词预取完成后按保存进度定位显示，延续"暂停保留歌词"体验
    if (restoredIdleSession && pendingResumeAt && pendingResumeAt.position > 0 && lyricsLines.length && stageLyrics.currentIdx < 0) {
      var resumeTime = getAdjustedLyricPlaybackTime(pendingResumeAt.position);
      var resumeIdx = -1;
      for (var ri = 0; ri < lyricsLines.length; ri++) {
        if (lyricsLines[ri].t <= resumeTime + 0.05) resumeIdx = ri; else break;
      }
      if (resumeIdx >= 0) {
        stageLyrics.currentIdx = resumeIdx;
        showStageLine(lyricsLines[resumeIdx].text || '');
      }
    }
    if (stageLyrics.current && stageLyricUpcomingCount() > 0 && stageLyrics.currentIdx >= 0) {
      syncUpcomingLyricLines(stageLyrics.currentIdx);
    }
    // lyricPauseHold（暂停保留歌词，上游同款开关）：整体冻结——当前行/停驻行/预告行原样保留，
    // 恢复播放后由主分支继续推进（seek 错位时预告行自动重建）
    return;
  }
  var t = getAdjustedLyricPlaybackTime(audio.currentTime);   // 歌词校准偏移已计入
  var newIdx = -1;
  for (var i = 0; i < lyricsLines.length; i++) {
    if (lyricsLines[i].t <= t + 0.05) newIdx = i; else break;
  }
  if (newIdx < 0) {
    var introText = currentLyricFallbackText();
    if (!introText) {
      clearStageLyrics();
      return;
    }
    if (stageLyrics.currentIdx !== -2 || stageLyrics.currentText !== introText) {
      stageLyrics.currentIdx = -2;
      showStageLine(introText);
    }
    if (stageLyrics.current) {
      var firstLine = lyricsLines[0];
      var introEnd = firstLine && firstLine.t > 0 ? firstLine.t : Math.min((audio && audio.duration) || 4.8, 4.8);
      var introLine = { t:0, text:introText, duration:Math.max(0.8, introEnd), charCount:Math.max(1, introText.length), fallback:true };
      updateLyricMeshProgress(stageLyrics.current, getLyricLineProgress(introLine, null, t));
    }
    return;
  }
  if (newIdx !== stageLyrics.currentIdx) {
    stageLyrics.currentIdx = newIdx;
    showStageLine(lyricsLines[newIdx].text || '');
  }
  if (stageLyrics.current) {
    var curLine = lyricsLines[newIdx] || { t:t };
    var nextLine = lyricsLines[newIdx + 1];
    var progress = getLyricLineProgress(curLine, nextLine, t);
    updateLyricMeshProgress(stageLyrics.current, progress);
  }
  // 多行模式：同步下方预告行；无预告槽位时兜底清理
  if (stageLyricUpcomingCount() > 0) {
    syncUpcomingLyricLines(newIdx);
  } else if (Array.isArray(stageLyrics.upcoming)) {
    var staleUpcoming = false;
    for (var su = 0; su < stageLyrics.upcoming.length; su++) {
      if (stageLyrics.upcoming[su]) { staleUpcoming = true; break; }
    }
    if (staleUpcoming) clearUpcomingLyricLines();
  }
}
function saveCustomLyricMap() {
  try {
    localStorage.setItem(CUSTOM_LYRIC_STORE_KEY, JSON.stringify(customLyricMap || {}));
    return true;
  } catch (e) {
    console.warn('custom lyric save failed:', e);
    return false;
  }
}
function saveCustomLyricPrefs() {
  try { localStorage.setItem(CUSTOM_LYRIC_PREF_STORE_KEY, JSON.stringify(customLyricPrefs || {})); } catch (e) {}
}
function songCustomLyricKey(song) {
  return songCustomCoverKey(song);
}
function currentLyricSong() {
  if (currentIdx >= 0 && playQueue[currentIdx]) return playQueue[currentIdx];
  return currentLocalSong || null;
}
function getCustomLyricEntry(song) {
  var key = songCustomLyricKey(song);
  return key && customLyricMap[key] ? customLyricMap[key] : null;
}
function hasCustomLyricForSong(song) {
  var entry = getCustomLyricEntry(song);
  return !!(entry && String(entry.text || '').trim());
}
function cloneLyricLine(line) {
  var copy = Object.assign({}, line || {});
  if (line && Array.isArray(line.words)) copy.words = line.words.map(function(w){ return Object.assign({}, w); });
  return copy;
}
function cloneLyricLines(lines) {
  return (Array.isArray(lines) ? lines : []).map(cloneLyricLine);
}
function setOriginalLyricsState(lines, hasNativeKaraoke, timingSource) {
  originalLyricsState = {
    lines: cloneLyricLines(lines || []),
    hasNativeKaraoke: !!hasNativeKaraoke,
    timingSource: timingSource || 'fallback'
  };
}
function applyLyricsState(lines, hasNativeKaraoke, timingSource) {
  lyricsHasNativeKaraoke = !!hasNativeKaraoke;
  lyricsTimingSource = timingSource || 'fallback';
  lyricsLines = cloneLyricLines(lines || []);
  if (!lyricsLines.length) lyricsLines = withLyricFallback([]);
  if (lyricsLines.length && lyricsLines[0].fallback) lyricsTimingSource = 'fallback';
  renderLyrics();
  updateCustomLyricControls();
}
function applyOriginalLyricsState() {
  lyricSourceMode = 'original';
  applyLyricsState(originalLyricsState.lines, originalLyricsState.hasNativeKaraoke, originalLyricsState.timingSource);
}
function parseCustomLyricText(text) {
  var raw = String(text || '').trim();
  if (!raw) return [];
  var lrcLines = parseLyricText(raw);
  if (lrcLines.length && !lrcLines.every(function(line){ return isNoLyricText(line.text); })) {
    return lrcLines.map(function(line){
      var copy = cloneLyricLine(line);
      copy.source = 'custom-lrc';
      return copy;
    });
  }
  var rows = raw.split(/\r?\n/).map(function(line){ return line.trim(); }).filter(function(line){ return line && !isNoLyricText(line); });
  if (!rows.length) return [];
  var duration = audio && isFinite(audio.duration) && audio.duration > 8 ? audio.duration : 0;
  var gap = duration ? Math.max(2.8, Math.min(7.2, duration / Math.max(1, rows.length))) : 4.8;
  return finalizeLyricLineDurations(rows.map(function(line, i){
    return { t: i * gap, duration: gap, text: line, source: 'custom-text', charCount: Math.max(1, line.length) };
  }));
}
function applyCustomLyricState(song, silent) {
  song = song || currentLyricSong();
  var entry = getCustomLyricEntry(song);
  if (!entry || !String(entry.text || '').trim()) {
    if (!silent) openCustomLyricModal();
    updateCustomLyricControls();
    return false;
  }
  var lines = parseCustomLyricText(entry.text);
  if (!lines.length) {
    if (!silent) showToast('自定义歌词内容为空');
    updateCustomLyricControls();
    return false;
  }
  lyricSourceMode = 'custom';
  lyricsHasNativeKaraoke = false;
  lyricsTimingSource = lines[0] && lines[0].source === 'custom-lrc' ? 'custom-lrc' : 'custom-text';
  lyricsLines = withLyricFallback(lines);
  if (lyricsLines.length && lyricsLines[0].fallback) lyricsTimingSource = 'fallback';
  renderLyrics();
  updateCustomLyricControls();
  return true;
}
function preferredLyricSourceForSong(song) {
  var key = songCustomLyricKey(song);
  var hasCustom = hasCustomLyricForSong(song);
  if (!hasCustom) return 'original';
  var pref = key ? customLyricPrefs[key] : '';
  if (pref === 'custom') return 'custom';
  if (pref === 'original') return 'original';
  return originalLyricsState.timingSource === 'fallback' ? 'custom' : 'original';
}
function applyPreferredLyricsForCurrent(silent) {
  var song = currentLyricSong();
  if (preferredLyricSourceForSong(song) === 'custom' && applyCustomLyricState(song, true)) return;
  applyOriginalLyricsState();
  if (!silent) updateCustomLyricControls();
}
function setLyricSourceMode(mode, silent) {
  var song = currentLyricSong();
  var key = songCustomLyricKey(song);
  mode = mode === 'custom' ? 'custom' : 'original';
  if (mode === 'custom') {
    if (!applyCustomLyricState(song, true)) {
      if (!silent) openCustomLyricModal();
      return false;
    }
    if (!silent) openCustomLyricModal();
  } else {
    applyOriginalLyricsState();
  }
  if (key) {
    customLyricPrefs[key] = mode;
    saveCustomLyricPrefs();
  }
  if (!silent) showToast(mode === 'custom' ? '已切换到自定义歌词' : '已切换到原歌词');
  updateCustomLyricControls();
  return true;
}
function updateCustomLyricControls() {
  var song = currentLyricSong();
  var hasCustom = hasCustomLyricForSong(song);
  var originalBtn = document.getElementById('lyric-source-original');
  var customBtn = document.getElementById('lyric-source-custom');
  if (originalBtn) {
    originalBtn.classList.toggle('active', lyricSourceMode !== 'custom');
    originalBtn.title = '使用网易云或本地解析歌词';
  }
  if (customBtn) {
    customBtn.classList.toggle('active', lyricSourceMode === 'custom');
    customBtn.classList.toggle('has-custom', hasCustom);
    customBtn.title = hasCustom ? '打开并编辑自定义歌词' : '新增自定义歌词';
  }
}
function setCustomLyricStatus(text, tone) {
  var el = document.getElementById('custom-lyric-status');
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('good', tone === 'good');
  el.classList.toggle('fail', tone === 'fail');
}
function openCustomLyricModal() {
  var song = currentLyricSong();
  if (!song) {
    showToast('先播放或选择一首歌');
    return;
  }
  if (immersiveMode) setImmersiveMode(false);
  var entry = getCustomLyricEntry(song);
  var title = document.getElementById('custom-lyric-title');
  var sub = document.getElementById('custom-lyric-sub');
  var input = document.getElementById('custom-lyric-input');
  if (title) title.textContent = song.name || '当前歌曲';
  if (sub) sub.textContent = (song.artist || (song.type === 'podcast' ? 'Podcast' : '')) + (entry ? ' · 已保存自定义歌词' : ' · 可粘贴 LRC 或逐行输入');
  if (input) input.value = entry ? (entry.text || '') : '';
  setCustomLyricStatus(entry ? '已读取本地自定义歌词' : '提示：带 [00:12.00] 时间轴会更精准；纯文本会自动铺开', entry ? 'good' : '');
  openGsapModal(document.getElementById('custom-lyric-modal'));
  setTimeout(function(){ if (input) input.focus(); }, 120);
}
function closeCustomLyricModal() {
  closeGsapModal(document.getElementById('custom-lyric-modal'));
}
function saveCustomLyricForCurrent() {
  var song = currentLyricSong();
  var key = songCustomLyricKey(song);
  var input = document.getElementById('custom-lyric-input');
  var text = input ? String(input.value || '').trim() : '';
  if (!song || !key) {
    setCustomLyricStatus('请先播放或选择一首歌', 'fail');
    showToast('先播放或选择一首歌');
    return;
  }
  if (!text) {
    setCustomLyricStatus('请输入歌词内容', 'fail');
    return;
  }
  var lines = parseCustomLyricText(text);
  if (!lines.length) {
    setCustomLyricStatus('没有识别到可显示的歌词行', 'fail');
    return;
  }
  customLyricMap[key] = { text: text, updatedAt: Date.now() };
  customLyricPrefs[key] = 'custom';
  var saved = saveCustomLyricMap();
  saveCustomLyricPrefs();
  applyCustomLyricState(song, true);
  setCustomLyricStatus(saved ? ('已保存 ' + lines.length + ' 行，并切换为自定义歌词') : '已应用，但本地存储空间不足', saved ? 'good' : 'fail');
  showToast(saved ? '自定义歌词已保存' : '自定义歌词已应用');
  setTimeout(function(){ closeCustomLyricModal(); }, 520);
}
function deleteCustomLyricForCurrent() {
  var song = currentLyricSong();
  var key = songCustomLyricKey(song);
  if (!song || !key) {
    setCustomLyricStatus('请先播放或选择一首歌', 'fail');
    return;
  }
  if (!customLyricMap[key]) {
    setCustomLyricStatus('当前歌曲没有自定义歌词', 'fail');
    return;
  }
  delete customLyricMap[key];
  delete customLyricPrefs[key];
  saveCustomLyricMap();
  saveCustomLyricPrefs();
  applyOriginalLyricsState();
  var input = document.getElementById('custom-lyric-input');
  if (input) input.value = '';
  setCustomLyricStatus('已删除，恢复原歌词', 'good');
  showToast('已恢复原歌词');
}

// ============================================================
//  10-lyrics-panel-playlist.js  ←  源 main.js §26–§28（基线 784afe6）
//  歌词面板 / 播放列表面板 / 文件拖放
// ============================================================

// ============================================================
//  歌词
// ============================================================
async function fetchLyric(songOrId, token) {
  try {
    var song = (songOrId && typeof songOrId === 'object') ? songOrId : null;
    // 本地曲目：歌词来自导入时提取的 .lrc sidecar / 内嵌歌词（持久化本地音乐库）
    if (song && song.type === 'local' && (song.localFileId || song.localKey) && window.desktopWindow &&
        typeof window.desktopWindow.readLocalMusicLyric === 'function') {
      var localLyric = await window.desktopWindow.readLocalMusicLyric(song.localFileId || song.localKey);
      if (token !== trackSwitchToken) return;
      var localLines = parseLyricText((localLyric && localLyric.lyric) || '');
      var localState = withLyricFallback(localLines);
      setOriginalLyricsState(localState, false, localLines.length ? 'lrc-line' : 'fallback');
      applyPreferredLyricsForCurrent(true);
      return;
    }
    var provider = songProviderKey(song);
    var endpoint;
    if (provider === 'qq') {
      var mid = song.mid || song.songmid || song.id || '';
      var qqId = song.qqId || (/^\d+$/.test(String(song.id || '')) ? song.id : '');
      endpoint = '/api/qq/lyric?mid=' + encodeURIComponent(mid) + '&id=' + encodeURIComponent(qqId);
    } else {
      var songId = song ? song.id : songOrId;
      endpoint = '/api/lyric?id=' + encodeURIComponent(songId);
    }
    var r = await apiJson(endpoint);
    if (token !== trackSwitchToken) return;
    var nativeLines = parseYrcText(r.yrc || '');
    var lrcLines = parseLyricText(r.lyric || '');
    var hasNativeKaraoke = nativeLines.some(function(line){ return line.words && line.words.length; });
    var timingSource = hasNativeKaraoke ? 'yrc-word' : (nativeLines.length ? 'yrc-line' : (lrcLines.length ? 'lrc-line' : 'fallback'));
    var lines = withLyricFallback(nativeLines.length ? nativeLines : lrcLines);
    if (lines.length && lines[0].fallback) timingSource = 'fallback';
    // 双语翻译：接口早已返回 tlyric（netease / QQ 都有），此前客户端未消费；
    // 这里并进 line.translation，渲染层按 fx.lyricTranslationMode 决定是否显示
    mergeLyricTranslations(lines, parseLyricTranslationLines(r.tlyric || ''));
    setOriginalLyricsState(lines, hasNativeKaraoke, timingSource);
    applyPreferredLyricsForCurrent(true);
  } catch (e) {
    if (token !== trackSwitchToken) return;
    var fallbackLines = withLyricFallback([]);
    setOriginalLyricsState(fallbackLines, false, 'fallback');
    applyPreferredLyricsForCurrent(true);
  }
}
function currentLyricFallbackText() {
  var song = currentLyricSong() || {};
  var title = (song.name || document.getElementById('thumb-title').textContent || '').trim();
  var artist = (song.artist || document.getElementById('thumb-artist').textContent || '').trim();
  if (!title) return '';
  return artist ? title + ' - ' + artist : title;
}
function isNoLyricText(text) {
  var compact = String(text || '').replace(/\s+/g, '').replace(/[，,。.!！?？、~～]/g, '');
  return !compact ||
    compact === '纯音乐请欣赏' ||
    compact === '暂无歌词' ||
    compact === '暂无歌词敬请期待' ||
    compact === '此歌曲为没有填词的纯音乐请您欣赏';
}
function withLyricFallback(lines) {
  lines = Array.isArray(lines) ? lines.filter(function(line){ return line && String(line.text || '').trim(); }) : [];
  if (lines.length && !lines.every(function(line){ return isNoLyricText(line.text); })) return lines;
  var text = currentLyricFallbackText();
  return text ? [{ t:0, text:text, duration:9999, charCount:Math.max(1, text.length), fallback:true }] : [];
}
function lyricTagTimeToSeconds(min, sec, frac) {
  var t = (parseInt(min, 10) || 0) * 60 + (parseInt(sec, 10) || 0);
  if (frac) t += (parseInt(frac, 10) || 0) / Math.pow(10, Math.min(3, frac.length));
  return t;
}
function finalizeLyricLineDurations(lines) {
  lines.sort(function(a, b){ return a.t - b.t; });
  for (var i = 0; i < lines.length; i++) {
    var next = lines[i + 1];
    var inferred = next && next.t > lines[i].t ? next.t - lines[i].t : 4.8;
    if (!isFinite(lines[i].duration) || lines[i].duration <= 0) lines[i].duration = inferred;
    lines[i].duration = Math.max(0.45, Math.min(12, lines[i].duration));
    lines[i].charCount = Math.max(1, lines[i].charCount || String(lines[i].text || '').length);
  }
  return lines;
}
function parseLyricText(text) {
  var lines = [], reg = /\[(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?\]/g;
  text.split(/\r?\n/).forEach(function(line){
    line = String(line);
    // 网易云 /api/lyric 的 lyric 字段偶发返回 YRC JSON 行（{"t":ms,"c":[{"tx":"..."}]}），
    // LRC 时间戳正则一行都匹配不到 → 整首解析为空 → 回退成「歌名-歌手」假歌词。
    // 逐行检测：命中 JSON 行就地提取文本，其余行仍走下方 LRC 路径。
    var trimmed = line.trim();
    if (trimmed.charAt(0) === '{' && trimmed.indexOf('"t"') !== -1) {
      try {
        var obj = JSON.parse(trimmed);
        var ms = Number(obj && obj.t);
        var txt = Array.isArray(obj && obj.c)
          ? obj.c.map(function (seg) { return (seg && seg.tx != null) ? String(seg.tx) : ''; }).join('')
          : '';
        txt = txt.trim();
        if (isFinite(ms) && ms >= 0 && txt) lines.push({ t: ms / 1000, text: txt, source: 'yrc-json' });
      } catch (e) { /* 非法 JSON 行：走下方 LRC 路径，匹配不到即丢弃 */ }
      return;
    }
    var times = [], m;
    reg.lastIndex = 0;
    while ((m = reg.exec(line))) times.push(lyricTagTimeToSeconds(m[1], m[2], m[3]));
    if (!times.length) return;
    var txt = line.replace(reg, '').trim();
    if (!txt) return;
    times.forEach(function(t){ lines.push({ t: t, text: txt, source:'lrc' }); });
  });
  return finalizeLyricLineDurations(lines);
}
/**
 * 解析译文歌词文本（上游 tlyric 与主歌词同为 LRC 格式）。
 * @returns {{t:number, text:string}[]} 按时间升序
 */
function parseLyricTranslationLines(text) {
  var out = [], reg = /\[(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?\]/g;
  String(text || '').split(/\r?\n/).forEach(function(line){
    var times = [], m;
    reg.lastIndex = 0;
    while ((m = reg.exec(line))) times.push(lyricTagTimeToSeconds(m[1], m[2], m[3]));
    if (!times.length) return;
    var txt = line.replace(reg, '').trim();
    if (!txt) return;
    times.forEach(function(t){ out.push({ t: t, text: txt }); });
  });
  out.sort(function(a, b){ return a.t - b.t; });
  return out;
}

/** 译文与原文行的时间容差（秒）：两边时间戳一般完全一致，容差只兜浮点/毫秒截断 */
var LYRIC_TRANSLATION_TIME_TOLERANCE = 0.6;

/**
 * 把译文按时间就近合并进主歌词行（写入 line.translation）。
 * 上游做法是在解析阶段就把译文并进行对象，这里保持同样的数据形态，
 * 渲染层只读 line.translation，不再关心数据来源。
 * @param {Array} lines 主歌词行（会被就地修改）
 * @param {Array} transLines parseLyricTranslationLines 的结果
 */
function mergeLyricTranslations(lines, transLines) {
  if (!Array.isArray(lines) || !lines.length) return lines;
  if (!Array.isArray(transLines) || !transLines.length) return lines;
  for (var i = 0; i < lines.length; i++) {
    var best = null, bestDiff = Infinity;
    for (var j = 0; j < transLines.length; j++) {
      var diff = Math.abs(transLines[j].t - lines[i].t);
      if (diff < bestDiff) { bestDiff = diff; best = transLines[j]; }
      // 已按时间升序：一旦超出容差且时间在原文之后，再往后只会更远
      if (transLines[j].t > lines[i].t + LYRIC_TRANSLATION_TIME_TOLERANCE) break;
    }
    if (best && bestDiff <= LYRIC_TRANSLATION_TIME_TOLERANCE) lines[i].translation = best.text;
  }
  return lines;
}

function parseYrcText(text) {
  var lines = [];
  String(text || '').split(/\r?\n/).forEach(function(line){
    var m = line.match(/^\[(\d+),(\d+)\](.*)$/);
    if (!m) return;
    var lineStartMs = parseInt(m[1], 10) || 0;
    var lineDurMs = parseInt(m[2], 10) || 0;
    var body = m[3] || '';
    var words = [], fullText = '';
    var reg = /\((\d+),(\d+),\d+\)([^()]*)/g, wm;
    while ((wm = reg.exec(body))) {
      var txt = (wm[3] || '').replace(/\s+/g, ' ');
      if (!txt) continue;
      var rawStart = parseInt(wm[1], 10) || 0;
      var rawDur = parseInt(wm[2], 10) || 0;
      var absStartMs = rawStart >= lineStartMs - 500 ? rawStart : lineStartMs + rawStart;
      var c0 = fullText.length;
      fullText += txt;
      words.push({ text:txt, t:absStartMs / 1000, d:Math.max(0.06, rawDur / 1000), c0:c0, c1:fullText.length });
    }
    if (!fullText) fullText = body.replace(/\(\d+,\d+,\d+\)/g, '').replace(/\s+/g, ' ');
    var leading = (fullText.match(/^\s+/) || [''])[0].length;
    fullText = fullText.replace(/\s+/g, ' ').trim();
    if (!fullText) return;
    if (words.length) {
      words.forEach(function(w){
        w.c0 = Math.max(0, Math.min(fullText.length, w.c0 - leading));
        w.c1 = Math.max(w.c0, Math.min(fullText.length, w.c1 - leading));
      });
      words = words.filter(function(w){ return w.c1 > w.c0; });
    }
    lines.push({ t:lineStartMs / 1000, duration:lineDurMs / 1000, text:fullText, words:words, charCount:Math.max(1, fullText.length), source: words.length ? 'yrc-word' : 'yrc-line' });
  });
  return finalizeLyricLineDurations(lines);
}
function renderLyrics() {
  // v8: 歌词渲染由 stageLyrics 在每帧 tickLyricsParticles 里推动
  clearStageLyrics();
}
function toggleLyricsPanel(force) {
  // 控制栏"词"按钮：纯显示/隐藏两态（对齐上游）；行数由控制台"歌词行数"切换
  if (force === false) fx.particleLyrics = false;
  else if (force === true) fx.particleLyrics = true;
  else fx.particleLyrics = !fx.particleLyrics;
  if (fx.particleLyrics) {
    createLyricsParticles();
    showToast('歌词已开启');
  } else {
    clearStageLyrics();
    showToast('歌词已关闭');
  }
  lyricsVisible = fx.particleLyrics;
  updateLyricsToggleButton();
  saveLyricLayout();
}
function updateLyricsToggleButton() {
  var btn = document.getElementById('lyrics-toggle-btn');
  if (!btn) return;
  var on = !!fx.particleLyrics;
  btn.classList.toggle('active', on);
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  btn.title = on ? '歌词' : '歌词（已隐藏）';
}
// 视觉控制台"歌词行数"五态分段高亮（single/dual/triple/cinema/custom）
function syncLyricDisplayModeSeg() {
  var seg = document.getElementById('lyric-display-mode-seg');
  if (!seg) return;
  var current = normalizeLyricDisplayMode(fx.lyricDisplayMode);
  var buttons = seg.querySelectorAll('button[data-mode]');
  for (var i = 0; i < buttons.length; i++) {
    buttons[i].classList.toggle('active', buttons[i].getAttribute('data-mode') === current);
  }
}
function refreshStageLyricDisplayMode() {
  // 行数变化：上方停驻行按歌词历史重建（不能只 unpark —— 前文会消失且不会自动回来），
  // 预告行按新槽位重建，当前行保留。
  rebuildParkedLyricLines(stageLyrics.currentIdx);
  clearUpcomingLyricLines();
  if (stageLyricUpcomingCount() > 0 && stageLyrics.currentIdx >= 0 && lyricsLines.length) {
    syncUpcomingLyricLines(stageLyrics.currentIdx);
  }
  if (stageLyrics.current && stageLyrics.current.userData) stageLyrics.current.userData.age = 0.48;
}
// 控制台"歌词行数"五态切换（对齐上游 setLyricDisplayMode）
function setLyricDisplayMode(mode) {
  fx.lyricDisplayMode = normalizeLyricDisplayMode(mode);
  syncLyricDisplayModeSeg();
  refreshStageLyricDisplayMode();
  saveLyricLayout();
  showToast('歌词行数已切换');
}
// 控制台"歌词动画"五态切换（对齐上游 setLyricMotionStyle）
function setLyricMotionStyle(style) {
  fx.lyricMotionStyle = normalizeLyricMotionStyle(style);
  if (fx.lyricMotionStyle === 'glitch' && lyricGlitchIntensityValue() <= 0 && lyricGlitchJitterValue() <= 0) {
    // 故障参数从未调过（全 0）：切到故障态自动填入上游默认，保证立即可见
    fx.lyricGlitchIntensity = 1.0;
    fx.lyricGlitchSlice = 0.72;
    fx.lyricGlitchChroma = 0.86;
    fx.lyricGlitchRate = 1.0;
    fx.lyricGlitchJitter = 0.72;
    updateFxInputs();
  }
  syncLyricMotionStyleSeg();
  saveLyricLayout();
  showToast('歌词动画已切换');
}
function syncLyricMotionStyleSeg() {
  var seg = document.getElementById('lyric-motion-style-seg');
  if (!seg) return;
  var current = normalizeLyricMotionStyle(fx.lyricMotionStyle);
  var buttons = seg.querySelectorAll('button[data-motion]');
  for (var i = 0; i < buttons.length; i++) {
    buttons[i].classList.toggle('active', buttons[i].getAttribute('data-motion') === current);
  }
  var glitchControls = document.getElementById('lyric-glitch-controls');
  if (glitchControls) glitchControls.classList.toggle('show', current === 'glitch');
  var bindBtn = document.getElementById('lyric-glitch-camera-bind');
  if (bindBtn) bindBtn.classList.toggle('active', !!fx.lyricGlitchCameraBind);
}
function updateLyricsHighlight() { /* v8: 由 tickLyricsParticles 接管 */ }
