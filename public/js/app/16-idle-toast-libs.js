'use strict';

// ============================================================
//  16-idle-toast-libs.js  —  空场待机引导 / 视觉引导 / 手势 / toast / 动态库加载
//  由 public/js/app/*.js 于 2026-09-24「按职责重排」生成（零逻辑改动）。
//  规则与验证见 docs/APP_REORG_PLAN.md 与 scripts/check-app-reorg.js。
// ============================================================



// ============================================================
//  14-idle-toast-libs.js  ←  源 main.js §36–§38（基线 784afe6）
//  空场待机引导 / toast / 动态库加载
// ============================================================

// ============================================================
//  空场待机引导
// ============================================================
var idleGuideCanvas = null;
var idleGuideCtx = null;
var idleGuideW = 0, idleGuideH = 0, idleGuideDpr = 1;
var idleGuideParticles = [];
var idleGuideTrails = [[], [], [], []];
var idleGuideStartedAt = performance.now();
var idleGuideVisible = false;
var idleGuideLastFrameAt = performance.now();
var idleGuideDelayTimer = null;
// Keep Wallpaper as the only startup idle background.
var IDLE_GUIDE_BACKGROUND_ENABLED = false;
var idleGuideInteraction = {
  angle: 0,
  velocity: 0,
  rotX: -0.12,
  rotY: 0,
  spinX: 0,
  spinY: 0,
  zoom: 1,
  zoomTarget: 1,
  zoomPulse: 0,
  dragging: false,
  lastX: 0,
  lastY: 0,
  lastT: 0,
  pointerX: 0.5,
  pointerY: 0.5,
  pointerActive: false,
  focus: 0,
  press: 0,
  tiltX: 0,
  tiltY: 0
};
function setIdleGuideVisible(show, interactive) {
  document.body.classList.toggle('idle-guide-on', show);
  document.body.classList.toggle('idle-guide-interactive', !!interactive);
  if (!interactive) document.body.classList.remove('idle-guide-dragging');
  if (idleGuideVisible === show) return;
  idleGuideVisible = show;
}
function shouldShowIdleGuide() {
  if (!IDLE_GUIDE_BACKGROUND_ENABLED) return false;
  if (document.body.classList.contains('splash-active')) return false;
  if (immersiveMode) return false;
  if (playing) return false;
  if (loginGuideAnimating) return false;
  if (document.querySelector('.modal-mask.show')) return false;
  if (uniforms && uniforms.uHasCover && uniforms.uHasCover.value > 0.5) return false;
  return true;
}
function shouldShowShelfHoverCue(value) {
  if (document.body.classList.contains('splash-active')) return false;
  if (!shelfHoverCue.guide && document.querySelector('.modal-mask.show')) return false;
  if (!shelfHoverCue.guide) {
    if (shelfPinnedOpen) return false;
    if (!shelfManager || !shelfManager.canInteract || !shelfManager.canInteract()) return false;
    if (shelfManager.hasOpenContent && shelfManager.hasOpenContent()) return false;
    if (!shelfManager.getMode || shelfManager.getMode() !== 'side') return false;
  }
  return shelfHoverCue.guide || shelfHoverCue.target > 0 || (value || shelfHoverCue.value) > 0.015;
}
function shouldHandleIdleGuidePointer(e) {
  if (!idleGuideCanvas || !shouldShowIdleGuide()) return false;
  if (isPointerOverUi(e)) return false;
  return true;
}
function clampIdleGuideSpin(v) {
  if (!isFinite(v)) return 0;
  return Math.max(-4.8, Math.min(4.8, v));
}
function idleGuidePointerDown(e) {
  if (!shouldHandleIdleGuidePointer(e)) return;
  idleGuideInteraction.dragging = true;
  idleGuideInteraction.pointerActive = true;
  idleGuideInteraction.lastX = e.clientX;
  idleGuideInteraction.lastY = e.clientY;
  idleGuideInteraction.lastT = performance.now();
  idleGuideInteraction.pointerX = e.clientX / Math.max(1, idleGuideW || innerWidth);
  idleGuideInteraction.pointerY = e.clientY / Math.max(1, idleGuideH || innerHeight);
  document.body.classList.add('idle-guide-dragging');
}
function idleGuidePointerMove(e) {
  if (!idleGuideCanvas) return;
  var canReact = shouldHandleIdleGuidePointer(e) || idleGuideInteraction.dragging;
  idleGuideInteraction.pointerActive = canReact;
  if (canReact) {
    idleGuideInteraction.pointerX = e.clientX / Math.max(1, idleGuideW || innerWidth);
    idleGuideInteraction.pointerY = e.clientY / Math.max(1, idleGuideH || innerHeight);
  }
  if (!idleGuideInteraction.dragging) return;
  var now = performance.now();
  var dt = Math.max(1 / 120, Math.min(0.08, (now - idleGuideInteraction.lastT) / 1000 || 1 / 60));
  var dx = e.clientX - idleGuideInteraction.lastX;
  var dy = e.clientY - idleGuideInteraction.lastY;
  var rx = -dy * 0.0032;
  var ry = dx * 0.0034;
  idleGuideInteraction.rotX += rx;
  idleGuideInteraction.rotY += ry;
  idleGuideInteraction.angle += ry * 0.22;
  idleGuideInteraction.spinX = clampIdleGuideSpin(rx / dt * 0.46);
  idleGuideInteraction.spinY = clampIdleGuideSpin(ry / dt * 0.46);
  idleGuideInteraction.velocity = Math.sqrt(idleGuideInteraction.spinX * idleGuideInteraction.spinX + idleGuideInteraction.spinY * idleGuideInteraction.spinY);
  idleGuideInteraction.lastX = e.clientX;
  idleGuideInteraction.lastY = e.clientY;
  idleGuideInteraction.lastT = now;
}
function idleGuidePointerUp() {
  if (!idleGuideInteraction.dragging) return;
  idleGuideInteraction.dragging = false;
  document.body.classList.remove('idle-guide-dragging');
}
function idleGuidePointerLeave() {
  if (!idleGuideInteraction.dragging) idleGuideInteraction.pointerActive = false;
}
function idleGuideWheel(e) {
  if (!shouldHandleIdleGuidePointer(e)) return false;
  var guide = idleGuideInteraction;
  guide.pointerActive = true;
  guide.pointerX = e.clientX / Math.max(1, idleGuideW || innerWidth);
  guide.pointerY = e.clientY / Math.max(1, idleGuideH || innerHeight);
  var nextZoom = guide.zoomTarget * Math.exp(-e.deltaY * 0.0012);
  guide.zoomTarget = Math.max(0.58, Math.min(1.82, nextZoom));
  guide.zoomPulse = Math.min(1, guide.zoomPulse + Math.min(0.28, Math.abs(e.deltaY) * 0.0014));
  return true;
}
function resizeIdleGuideCanvas() {
  if (!idleGuideCanvas) return;
  idleGuideDpr = Math.min(window.devicePixelRatio || 1, 1.6);
  idleGuideW = window.innerWidth;
  idleGuideH = window.innerHeight;
  idleGuideCanvas.width = Math.max(1, Math.floor(idleGuideW * idleGuideDpr));
  idleGuideCanvas.height = Math.max(1, Math.floor(idleGuideH * idleGuideDpr));
  idleGuideCanvas.style.width = idleGuideW + 'px';
  idleGuideCanvas.style.height = idleGuideH + 'px';
  idleGuideCtx.setTransform(idleGuideDpr, 0, 0, idleGuideDpr, 0, 0);
  idleGuideParticles = [];
  resetIdleGuideTrails();
  if (!IDLE_GUIDE_BACKGROUND_ENABLED) return;
  var minDim = Math.min(idleGuideW, idleGuideH);
  var maxDim = Math.max(idleGuideW, idleGuideH);
  var count = idleGuideW < 800 ? 150 : 240;
  for (var i = 0; i < count; i++) {
    var ring = i < count * 0.76;
    var a = Math.random() * Math.PI * 2;
    var r = ring
      ? (minDim * 0.035 + Math.pow(Math.random(), 0.58) * minDim * 0.335)
      : (Math.pow(Math.random(), 0.82) * maxDim * 0.58);
    var wobbleAmp = minDim * (ring ? (0.012 + Math.random() * 0.035) : (0.010 + Math.random() * 0.055));
    idleGuideParticles.push({
      a: a,
      r: r,
      cx: ring ? 0.5 : Math.random(),
      cy: ring ? 0.5 : Math.random(),
      size: ring ? (0.30 + Math.random() * 0.62) : (0.18 + Math.random() * 0.44),
      speed: ((ring ? 0.018 : 0.010) + Math.random() * (ring ? 0.045 : 0.030)) * (Math.random() < 0.5 ? -1 : 1),
      phase: Math.random() * Math.PI * 2,
      wobbleAmp: wobbleAmp,
      wobbleSpeed: 0.18 + Math.random() * 0.76,
      oval: 0.56 + Math.random() * 0.36,
      zAmp: 0.34 + Math.random() * 0.82,
      driftX: (Math.random() * 2 - 1) * wobbleAmp * 0.75,
      driftY: (Math.random() * 2 - 1) * wobbleAmp * 0.75,
      layer: Math.random(),
      z: (Math.random() * 2 - 1) * (ring ? minDim * 0.28 : maxDim * 0.42),
      ring: ring
    });
  }
}
function projectIdleGuidePoint(x, y, z, rot, cx, cy, depth) {
  var x1 = x * rot.cy + z * rot.sy;
  var z1 = -x * rot.sy + z * rot.cy;
  var y1 = y * rot.cx - z1 * rot.sx;
  var z2 = y * rot.sx + z1 * rot.cx;
  var scale = depth / (depth - z2 * 0.72);
  scale = Math.max(0.52, Math.min(1.74, scale));
  return {
    x: cx + x1 * scale,
    y: cy + y1 * scale,
    z: z2,
    scale: scale
  };
}
function resetIdleGuideTrails() {
  idleGuideTrails = [[], [], [], []];
}
function pushIdleGuideTrail(index, pt, alpha, now) {
  var trail = idleGuideTrails[index];
  if (!trail) trail = idleGuideTrails[index] = [];
  var last = trail[trail.length - 1];
  var dx = last ? pt.x - last.x : 999;
  var dy = last ? pt.y - last.y : 999;
  if (!last || Math.sqrt(dx * dx + dy * dy) > 1.4 || now - last.t > 42) {
    trail.push({ x: pt.x, y: pt.y, scale: pt.scale || 1, alpha: alpha || 1, t: now });
  }
  while (trail.length > 26) trail.shift();
}
function drawIdleGuideTrail(ctx, trail, now, alpha, energy) {
  if (!trail || trail.length < 2) return;
  while (trail.length && now - trail[0].t > 680) trail.shift();
  if (trail.length < 2) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (var i = 1; i < trail.length; i++) {
    var prev = trail[i - 1];
    var cur = trail[i];
    var age = (now - cur.t) / 680;
    var order = i / Math.max(1, trail.length - 1);
    var fade = Math.max(0, 1 - age) * order;
    if (fade <= 0) continue;
    ctx.strokeStyle = 'rgba(255,255,255,' + (alpha * fade * (0.18 + energy * 0.24)).toFixed(3) + ')';
    ctx.lineWidth = (0.7 + cur.scale * 0.9 + energy * 1.2) * fade;
    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    var mx = (prev.x + cur.x) * 0.5;
    var my = (prev.y + cur.y) * 0.5;
    ctx.quadraticCurveTo(mx, my, cur.x, cur.y);
    ctx.stroke();
  }
  ctx.restore();
}
function scheduleIdleGuideFrame(delay) {
  if (idleGuideDelayTimer) {
    clearTimeout(idleGuideDelayTimer);
    idleGuideDelayTimer = null;
  }
  if (delay && delay > 0) {
    idleGuideDelayTimer = setTimeout(function(){
      idleGuideDelayTimer = null;
      requestAnimationFrame(drawIdleGuideFrame);
    }, delay);
  } else {
    requestAnimationFrame(drawIdleGuideFrame);
  }
}
function drawIdleGuideFrame() {
  if (!idleGuideCanvas || !idleGuideCtx) return;
  var ctx = idleGuideCtx;
  var nowFrame = performance.now();
  var dtFrame = Math.max(1 / 120, Math.min(0.05, (nowFrame - idleGuideLastFrameAt) / 1000 || 1 / 60));
  idleGuideLastFrameAt = nowFrame;
  var idleShow = shouldShowIdleGuide();
  var shelfCueValue = tickShelfHoverCue(dtFrame);
  var shelfCueShow = shouldShowShelfHoverCue(shelfCueValue);
  var show = idleShow || shelfCueShow;
  setIdleGuideVisible(show, idleShow);
  if (!show) {
    idleGuideCtx.clearRect(0, 0, idleGuideW, idleGuideH);
    resetIdleGuideTrails();
    scheduleIdleGuideFrame(140);
    return;
  }
  var t = (nowFrame - idleGuideStartedAt) / 1000;
  if (!idleShow) {
    ctx.clearRect(0, 0, idleGuideW, idleGuideH);
    resetIdleGuideTrails();
    ctx.globalCompositeOperation = 'lighter';
    drawShelfGuideCue(ctx, t, shelfCueValue);
    ctx.globalCompositeOperation = 'source-over';
    scheduleIdleGuideFrame(0);
    return;
  }
  var cx = idleGuideW * 0.5;
  var cy = idleGuideH * 0.50;
  var guide = idleGuideInteraction;
  if (!guide.dragging) {
    guide.rotX += guide.spinX * dtFrame;
    guide.rotY += guide.spinY * dtFrame;
    guide.spinX *= Math.pow(0.90, dtFrame * 60);
    guide.spinY *= Math.pow(0.90, dtFrame * 60);
    if (Math.abs(guide.spinX) < 0.01) guide.spinX = 0;
    if (Math.abs(guide.spinY) < 0.01) guide.spinY = 0;
  }
  guide.rotY += 0.012 * dtFrame;
  guide.angle += guide.spinY * dtFrame * 0.20 + 0.010 * dtFrame;
  guide.velocity = Math.sqrt(guide.spinX * guide.spinX + guide.spinY * guide.spinY);
  var targetFocus = guide.pointerActive ? 1 : 0;
  var targetPress = guide.dragging ? 1 : 0;
  guide.focus += (targetFocus - guide.focus) * 0.10;
  guide.press += (targetPress - guide.press) * 0.16;
  guide.zoom += (guide.zoomTarget - guide.zoom) * 0.13;
  guide.zoomPulse *= Math.pow(0.84, dtFrame * 60);
  if (guide.zoomPulse < 0.002) guide.zoomPulse = 0;
  guide.tiltX += (((guide.pointerX - 0.5) * 0.26) - guide.tiltX) * 0.08;
  guide.tiltY += (((guide.pointerY - 0.5) * 0.18) - guide.tiltY) * 0.08;
  ctx.clearRect(0, 0, idleGuideW, idleGuideH);
  ctx.globalCompositeOperation = 'lighter';

  var breathe = 0.5 + 0.5 * Math.sin(t * 0.72);
  var zoom = guide.zoom;
  var zoomBoost = guide.zoomPulse;
  var halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(idleGuideW, idleGuideH) * ((0.36 + breathe * 0.035 + guide.press * 0.018) * zoom));
  halo.addColorStop(0, 'rgba(255,255,255,' + (0.034 + breathe * 0.020 + guide.focus * 0.014 + guide.press * 0.018 + zoomBoost * 0.018).toFixed(3) + ')');
  halo.addColorStop(0.44, 'rgba(255,255,255,' + (0.014 + guide.focus * 0.010).toFixed(3) + ')');
  halo.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, idleGuideW, idleGuideH);

  var ringPts = [];
  var pointerX = guide.pointerX * idleGuideW;
  var pointerY = guide.pointerY * idleGuideH;
  var spinEnergy = Math.min(1, guide.velocity / 1.5 + guide.press * 0.42);
  var rot = {
    sx: Math.sin(guide.rotX),
    cx: Math.cos(guide.rotX),
    sy: Math.sin(guide.rotY),
    cy: Math.cos(guide.rotY)
  };
  var depth = Math.max(520, Math.min(idleGuideW, idleGuideH) * 0.92);
  for (var i = 0; i < idleGuideParticles.length; i++) {
    var p = idleGuideParticles[i];
    var localA = p.a + t * p.speed;
    var wanderA = p.phase + t * p.wobbleSpeed;
    var wobble = Math.sin(wanderA) * p.wobbleAmp + Math.sin(t * (p.wobbleSpeed * 0.57 + 0.11) + p.phase * 1.7) * p.wobbleAmp * 0.45;
    var x, y;
    var projected = null;
    var pointScale = 1;
    if (p.ring) {
      var rr = (p.r + wobble + breathe * 12) * zoom * (1 + guide.press * 0.030 + zoomBoost * 0.018);
      var baseX = Math.cos(localA) * rr + Math.sin(wanderA * 0.73) * p.wobbleAmp * 0.54 + p.driftX;
      var baseY = Math.sin(localA + Math.sin(wanderA) * 0.10) * rr * p.oval + Math.sin(t * 0.33 + p.phase) * p.wobbleAmp * 0.68 + p.driftY;
      var baseZ = (Math.sin(localA * 0.84 + p.phase * 0.31) * rr * p.zAmp + p.z * 0.54 + Math.cos(wanderA * 0.91) * p.wobbleAmp) * zoom;
      projected = projectIdleGuidePoint(baseX, baseY, baseZ, rot, cx, cy, depth);
      pointScale = projected.scale;
      x = projected.x + guide.tiltX * projected.z * 0.020;
      y = projected.y + guide.tiltY * projected.z * 0.018;
      var nDx = pointerX - x, nDy = pointerY - y;
      var near = guide.focus * Math.max(0, 1 - Math.sqrt(nDx * nDx + nDy * nDy) / 210);
      x += nDx * near * 0.040;
      y += nDy * near * 0.040;
      ringPts.push({ x:x, y:y, z:projected.z, scale:projected.scale, alpha:0.08 + breathe * 0.04 + near * 0.08 });
    } else {
      var driftX = ((p.cx - 0.5) * idleGuideW * 0.92 + Math.cos(localA) * (12 + p.wobbleAmp * 0.28) + wobble * 0.28) * zoom;
      var driftY = ((p.cy - 0.5) * idleGuideH * 0.72 + Math.sin(localA * 0.8 + p.phase * 0.2) * (12 + p.wobbleAmp * 0.24)) * zoom;
      var driftZ = (p.z + Math.sin(localA + p.phase) * (32 + p.wobbleAmp * 0.32)) * zoom;
      var fieldPt = projectIdleGuidePoint(driftX, driftY, driftZ, rot, cx, cy, depth * 1.16);
      pointScale = fieldPt.scale;
      x = fieldPt.x;
      y = fieldPt.y;
    }
    var depthGlow = p.ring && projected ? (0.66 + projected.scale * 0.20) : 1;
    var aP = p.ring ? ((0.070 + breathe * 0.065 + Math.sin(t * (0.8 + p.layer) + p.phase) * 0.024 + spinEnergy * 0.032) * depthGlow) : (0.034 + guide.focus * 0.010);
    ctx.beginPath();
    ctx.arc(x, y, p.size * pointScale * Math.sqrt(zoom) * (1 + spinEnergy * (p.ring ? 0.24 : 0.08) + zoomBoost * 0.12), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,' + Math.max(0, aP).toFixed(3) + ')';
    ctx.fill();
  }

  ctx.lineWidth = 1;
  for (var j = 0; j < ringPts.length; j += 3) {
    var aPt = ringPts[j];
    var bPt = ringPts[(j + 7) % ringPts.length];
    if (!aPt || !bPt) continue;
    var dx = aPt.x - bPt.x, dy = aPt.y - bPt.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > Math.min(idleGuideW, idleGuideH) * 0.17) continue;
    ctx.strokeStyle = 'rgba(255,255,255,' + (0.018 + breathe * 0.020 + guide.focus * 0.012 + spinEnergy * 0.018).toFixed(3) + ')';
    ctx.beginPath();
    ctx.moveTo(aPt.x, aPt.y);
    ctx.lineTo(bPt.x, bPt.y);
    ctx.stroke();
  }

  if (guide.focus > 0.03 || spinEnergy > 0.05) {
    var orbitR = Math.min(idleGuideW, idleGuideH) * (0.305 + guide.press * 0.018) * zoom;
    var anchorAlpha = Math.min(0.68, 0.16 + guide.focus * 0.24 + spinEnergy * 0.38);
    for (var k = 0; k < 4; k++) {
      var anchorA = guide.angle + t * 0.08 + k * 1.72 + (k === 2 ? 0.38 : 0);
      var anchorPt = projectIdleGuidePoint(
        Math.cos(anchorA) * orbitR,
        Math.sin(anchorA) * orbitR * 0.52,
        Math.sin(anchorA + k * 0.54) * orbitR * 0.48,
        rot, cx, cy, depth
      );
      pushIdleGuideTrail(k, anchorPt, anchorAlpha, nowFrame);
      drawIdleGuideTrail(ctx, idleGuideTrails[k], nowFrame, anchorAlpha, spinEnergy);
      ctx.beginPath();
      ctx.arc(anchorPt.x, anchorPt.y, (2.0 + spinEnergy * 1.8 + (k === 0 ? guide.press * 1.8 : 0)) * anchorPt.scale, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,' + anchorAlpha.toFixed(3) + ')';
      ctx.fill();
    }
  }

  if (guide.focus > 0.03) {
    var handleA = guide.angle + t * 0.36;
    var handleR = Math.min(idleGuideW, idleGuideH) * (0.315 + breathe * 0.012 + guide.press * 0.012) * zoom;
    var handlePt = projectIdleGuidePoint(
      Math.cos(handleA) * handleR,
      Math.sin(handleA) * handleR * 0.52,
      Math.sin(handleA + 0.62) * handleR * 0.48,
      rot, cx, cy, depth
    );
    var hx = handlePt.x;
    var hy = handlePt.y;
    var handleGlow = ctx.createRadialGradient(hx, hy, 0, hx, hy, 28 + guide.press * 12);
    handleGlow.addColorStop(0, 'rgba(255,255,255,' + (0.22 * guide.focus + 0.16 * guide.press).toFixed(3) + ')');
    handleGlow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = handleGlow;
    ctx.beginPath();
    ctx.arc(hx, hy, 28 + guide.press * 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(hx, hy, 2.4 + guide.press * 1.6, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,' + (0.54 * guide.focus + 0.24 * guide.press).toFixed(3) + ')';
    ctx.fill();
  }

  if (shelfCueShow) drawShelfGuideCue(ctx, t, shelfCueValue);
  ctx.globalCompositeOperation = 'source-over';
  scheduleIdleGuideFrame(0);
}
function drawShelfGuideCue(ctx, t, strength) {
  strength = Math.max(0, Math.min(1, strength == null ? shelfHoverCue.value : strength));
  if (strength <= 0.01) return;
  var r = shelfCueRect();
  var c = shelfCueCenter();
  var pulse = 0.5 + 0.5 * Math.sin(t * 1.55);
  var floatY = Math.sin(t * 0.92) * 8 * strength;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  var glow = ctx.createLinearGradient(r.left, 0, r.right, 0);
  glow.addColorStop(0, 'rgba(255,255,255,0)');
  glow.addColorStop(0.58, 'rgba(255,255,255,' + (0.010 * strength).toFixed(3) + ')');
  glow.addColorStop(0.82, 'rgba(244,210,138,' + (0.024 * strength + pulse * 0.012 * strength).toFixed(3) + ')');
  glow.addColorStop(1, 'rgba(255,255,255,' + (0.035 * strength).toFixed(3) + ')');
  ctx.fillStyle = glow;
  ctx.fillRect(r.left, r.top - 26, r.width + 18, r.height + 52);

  var halo = ctx.createRadialGradient(c.x + r.width * 0.18, c.y + floatY, 0, c.x + r.width * 0.18, c.y + floatY, r.width * 0.62);
  halo.addColorStop(0, 'rgba(244,210,138,' + (0.070 * strength + pulse * 0.026 * strength).toFixed(3) + ')');
  halo.addColorStop(0.45, 'rgba(255,255,255,' + (0.020 * strength).toFixed(3) + ')');
  halo.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(r.left, r.top - 40, r.width, r.height + 80);

  for (var i = 0; i < 10; i++) {
    var seed = i * 19.17;
    var phase = (t * (0.10 + (i % 4) * 0.014) + i * 0.113) % 1;
    var x = r.left + r.width * (0.45 + (i % 4) * 0.13) + Math.sin(t * 0.44 + seed) * 12;
    var y = r.top + r.height * (0.18 + ((i * 0.137 + Math.sin(seed)) % 0.64)) + floatY * (0.42 + (i % 3) * 0.10);
    var alpha = (0.035 + Math.sin(Math.PI * phase) * 0.050) * strength;
    if (alpha <= 0) continue;
    ctx.beginPath();
    ctx.arc(x, y, 0.9 + (i % 3) * 0.26 + pulse * 0.18, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(244,210,138,' + alpha.toFixed(3) + ')';
    ctx.fill();
  }
  ctx.restore();
}
function initIdleGuideCanvas() {
  idleGuideCanvas = document.getElementById('idle-guide-canvas');
  if (!idleGuideCanvas) return;
  idleGuideCtx = idleGuideCanvas.getContext('2d');
  if (!idleGuideCtx) return;
  idleGuideStartedAt = performance.now();
  resizeIdleGuideCanvas();
  window.addEventListener('resize', resizeIdleGuideCanvas);
  drawIdleGuideFrame();
}

// ============================================================
//  toast
// ============================================================
var toastTimer = null;

var visualGuideSteps = [
  {
    target: 'stage',
    kicker: '01 / Welcome',
    title: 'BhandsMusic 是用来听歌的视觉播放器',
    body: '它不是单纯歌单页：搜索或导入一首歌后，封面、歌词、粒子和镜头会跟着音乐一起动。'
  },
  {
    selector: '#search-box',
    kicker: '02 / Play',
    title: '从搜索或导入开始',
    body: '输入歌名、歌手或关键词即可播放；如果有本地音乐，也可以用导入入口直接放进舞台。'
  },
  {
    selector: '#bottom-bar',
    kicker: '03 / Control',
    title: '播放以后看底部控制台',
    body: '播放、切歌、进度、队列和歌词都集中在底部，先把它当作一个正常播放器使用就可以。'
  },
  {
    selector: '#user-btn',
    kicker: '04 / Account',
    title: '登录只是为了同步你的音乐库',
    body: '登录后会同步歌单、红心和播客；不登录也可以搜索和播放，不会强制卡住你。'
  },
  {
    target: 'shelf',
    kicker: '05 / Visual',
    title: '进阶视觉都放在舞台周围',
    body: '右侧 3D 歌单架和 DIY 玩家模式是进阶入口；先播放一首歌，再慢慢调视觉效果。'
  },
  {
    selector: '#fx-fab',
    kicker: '06 / Visual Lab',
    title: '视觉控制台在右上角',
    body: '点击主页按钮左边的按钮弹出视觉控制台：粒子、歌词、镜头、音源和更多设置都在里面。'
  }
];
var visualGuideStepsDiy = [
  {
    selector: '#fx-fab',
    kicker: '01 / Visual Lab',
    title: '视觉控制台入口',
    body: '右上角主页按钮左边的按钮可以随时打开/收起视觉控制台；DIY 模式开关也在控制台里。'
  },
  {
    selector: '#search-box',
    kicker: '02 / Search',
    title: '搜索源和导入入口会展开',
    body: '顶部搜索支持更多来源切换，上传歌曲、封面等入口也会在 DIY 模式中显示。'
  },
  {
    selector: '#playlist-panel',
    kicker: '03 / Library',
    title: '左侧是完整歌单和队列',
    body: '靠近左侧边缘可以打开歌单/队列面板，在这里管理队列、个人歌单和播客。'
  },
  {
    selector: '#fx-panel',
    kicker: '04 / Visual Lab',
    title: '右侧是视觉控制台',
    body: '靠近右下角或点击视觉按钮，可以调节粒子、歌词、镜头、3D 歌单架和更多视觉参数。'
  },
  {
    selector: '#quality-control',
    kicker: '05 / Controls',
    title: '高级播放控制会补全',
    body: '音质、播放顺序、收藏、歌词源和更多按钮会在 DIY 模式中完整显示。'
  },
  {
    target: 'shelf',
    kicker: '06 / Shelf',
    title: '3D 歌单架支持直接打开',
    body: '右侧的 3D 歌单架会在靠近时半透明浮现，点击卡片可打开歌单，点卡片里的播放按钮可直接播放整张歌单。'
  }
];
function activeVisualGuideSteps() {
  return diyPlayerMode ? visualGuideStepsDiy : visualGuideSteps;
}
function visualGuideWasSeen() {
  try { return localStorage.getItem(VISUAL_GUIDE_SEEN_STORE_KEY) === '1'; } catch (e) { return true; }
}
function markVisualGuideSeen() {
  try { localStorage.setItem(VISUAL_GUIDE_SEEN_STORE_KEY, '1'); } catch (e) {}
}
function maybeRunStartupVisualGuide(source) {
  if (visualGuideWasSeen() || visualGuideActive || immersiveMode || playing) return false;
  if (source !== 'manual' && !hasAnyPlatformLogin()) return false;
  setTimeout(function(){
    if (!visualGuideWasSeen() || source === 'manual') startVisualGuide({ source: source || 'startup' });
  }, source === 'splash' ? 3600 : 1400);
  return true;
}
function startVisualGuide(opts) {
  opts = opts || {};
  if (document.body.classList.contains('splash-active')) {
    setTimeout(function(){ startVisualGuide(opts); }, 700);
    return;
  }
  if (immersiveMode) setImmersiveMode(false);
  closeMiniQueue();
  closeUploadTip(false);
  visualGuideActive = true;
  document.body.classList.add('visual-guide-active');
  visualGuideStep = 0;
  visualGuideState = {
    bottomWasVisible: !!(document.getElementById('bottom-bar') && document.getElementById('bottom-bar').classList.contains('visible')),
    searchWasPeek: !!(document.getElementById('search-area') && document.getElementById('search-area').classList.contains('peek')),
    fxWasPeek: !!(document.getElementById('fx-panel') && document.getElementById('fx-panel').classList.contains('peek')),
    plWasPeek: !!(document.getElementById('playlist-panel') && document.getElementById('playlist-panel').classList.contains('peek')),
    mode: diyPlayerMode ? 'diy' : 'simple',
    manual: !!opts.manual
  };
  var guide = document.getElementById('visual-guide');
  if (guide) {
    guide.classList.add('show');
    guide.setAttribute('aria-hidden', 'false');
  }
  if (!visualGuideResizeBound) {
    visualGuideResizeBound = true;
    window.addEventListener('resize', positionVisualGuideStep);
    window.addEventListener('scroll', positionVisualGuideStep, true);
  }
  showVisualGuideStep(0);
}
function prepareVisualGuideStep(step) {
  var search = document.getElementById('search-area');
  var bottom = document.getElementById('bottom-bar');
  var fxPanel = document.getElementById('fx-panel');
  var playlistPanel = document.getElementById('playlist-panel');
  var wantShelf = !!(step && step.target === 'shelf');
  if (typeof setShelfGuideCueActive === 'function') setShelfGuideCueActive(wantShelf);
  // 引导最后一步临时打开 3D 歌单架；完成后若不是用户本来就开着，再关掉
  if (wantShelf) {
    if (visualGuideState && visualGuideState.shelfOpenedForGuide == null) {
      visualGuideState.shelfWasPinned = !!shelfPinnedOpen;
      visualGuideState.shelfOpenedForGuide = false;
      visualGuideState.shelfModeBeforeGuide = (shelfManager && shelfManager.getMode) ? shelfManager.getMode() : null;
    }
    // 仅在非 side 时临时切到 side 演示；完成后按 shelfModeBeforeGuide 还原（含 off/隐藏）
    if (shelfManager && shelfManager.setMode && (!shelfManager.getMode || shelfManager.getMode() !== 'side')) {
      try { shelfManager.setMode('side'); } catch (err) {}
    }
    if (!shelfPinnedOpen) {
      if (typeof setShelfPinnedOpen === 'function') setShelfPinnedOpen(true, true);
      if (visualGuideState) visualGuideState.shelfOpenedForGuide = true;
    }
    if (typeof dismissHomePage === 'function' && emptyHomeActive) dismissHomePage({ reason: 'guide-shelf' });
  }
  if (step && step.selector === '#search-box') setPeek(search, true, 'search');
  if (step && step.selector === '#playlist-panel') setPeek(playlistPanel, true, 'pl');
  else if (playlistPanel && !visualGuideState.plWasPeek) setPeek(playlistPanel, false, 'pl');
  if (step && step.selector === '#fx-panel') setPeek(fxPanel, true, 'fx');
  else if (fxPanel && !visualGuideState.fxWasPeek) setPeek(fxPanel, false, 'fx');
  if (step && (step.selector === '#bottom-bar' || step.selector === '#mini-queue-btn' || step.selector === '#immersive-btn' || step.selector === '#quality-control')) {
    if (bottom) bottom.classList.add('visible');
    revealBottomControls(1500);
  }
}
function scheduleVisualGuidePositioning() {
  requestAnimationFrame(positionVisualGuideStep);
  setTimeout(positionVisualGuideStep, 180);
  setTimeout(positionVisualGuideStep, 620);
}
function showVisualGuideStep(index) {
  var steps = activeVisualGuideSteps();
  visualGuideStep = Math.max(0, Math.min(steps.length - 1, index));
  var step = steps[visualGuideStep];
  prepareVisualGuideStep(step);
  var title = document.getElementById('visual-guide-title');
  var body = document.getElementById('visual-guide-body');
  var kicker = document.getElementById('visual-guide-kicker');
  var hint = document.getElementById('visual-guide-hint');
  var progress = document.getElementById('visual-guide-progress');
  var next = document.getElementById('visual-guide-next');
  if (title) title.textContent = step.title;
  if (body) body.textContent = step.body;
  if (kicker) kicker.textContent = step.kicker;
  if (hint) hint.textContent = visualGuideStep === steps.length - 1 ? '点击空白处完成引导' : '点击空白处也可以继续';
  if (progress) progress.textContent = (visualGuideStep + 1) + ' / ' + steps.length;
  if (next) next.textContent = visualGuideStep === steps.length - 1 ? '完成' : '下一步';
  scheduleVisualGuidePositioning();
}
function guideTargetRect(step) {
  if (step && step.target === 'stage') {
    var stageW = Math.min(620, Math.max(260, innerWidth - 72));
    var stageH = Math.min(310, Math.max(178, innerHeight * 0.34));
    var stageLeft = innerWidth * 0.5 - stageW * 0.5;
    var stageTop = Math.max(116, innerHeight * 0.32 - stageH * 0.5);
    return { left: stageLeft, top: stageTop, width: stageW, height: stageH, right: stageLeft + stageW, bottom: stageTop + stageH };
  }
  if (step && step.target === 'shelf') {
    var shelfContentOpen = !!(typeof shelfManager !== 'undefined' && shelfManager && shelfManager.hasOpenContent && shelfManager.hasOpenContent());
    // 货架已打开时：圈住真实卡片列/详情，而不是右侧 hover 热区（否则聚焦框会飘在空处）
    if (shelfPinnedOpen || shelfContentOpen) {
      var openEdge = Math.min(390, Math.max(210, innerWidth * 0.22));
      var openLeft = shelfContentOpen ? Math.max(12, innerWidth * 0.04) : Math.max(12, innerWidth - openEdge - 24);
      var openTop = Math.max(88, innerHeight * 0.20);
      var openRight = Math.min(innerWidth - 10, innerWidth - 6);
      var openBottom = Math.min(innerHeight - 72, innerHeight * 0.86);
      return { left: openLeft, top: openTop, width: openRight - openLeft, height: openBottom - openTop, right: openRight, bottom: openBottom };
    }
    if (typeof shelfCueRect === 'function') {
      var shelfRect = shelfCueRect();
      var shelfLeft = shelfRect.left;
      var shelfTop = shelfRect.top - 26;
      var shelfRight = Math.min(innerWidth - 12, shelfRect.right + 18);
      var shelfBottom = shelfRect.bottom + 26;
      return { left: shelfLeft, top: shelfTop, width: shelfRight - shelfLeft, height: shelfBottom - shelfTop, right: shelfRight, bottom: shelfBottom };
    }
  }
  if (step && step.selector === '#bottom-bar') {
    var bar = document.getElementById('bottom-bar');
    var progress = document.getElementById('progress-bar');
    var controls = document.getElementById('controls');
    if (bar) {
      var br = bar.getBoundingClientRect();
      var left = br.left, top = br.top, right = br.right, bottom = br.bottom;
      [progress, controls].forEach(function(el){
        if (!el) return;
        var r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return;
        left = Math.min(left, r.left);
        top = Math.min(top, r.top);
        right = Math.max(right, r.right);
        bottom = Math.max(bottom, r.bottom);
      });
      return { left: left, top: top, width: right - left, height: bottom - top, right: right, bottom: bottom };
    }
  }
  var isFullscreenDiyStep = !!(step && step.selector === '#diy-mode-btn' && (desktopRuntimeState.fullscreen || desktopFullscreenActive || document.fullscreenElement || document.body.classList.contains('desktop-fullscreen')));
  var useFullscreenDiyTarget = isFullscreenDiyStep && !shouldSuppressFullscreenDiyPeek();
  if (useFullscreenDiyTarget) {
    layoutFullscreenDiyZone();
    document.body.classList.add('fullscreen-diy-peek');
  }
  var target = step && step.selector ? document.querySelector(useFullscreenDiyTarget ? '#fullscreen-diy-btn' : step.selector) : null;
  if (target) {
    var style = window.getComputedStyle(target);
    var rect = target.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden') return rect;
  }
  if (step && step.selector === '#diy-mode-btn') {
    var fallbackRight = Math.max(116, innerWidth - 26);
    var fallbackTop = 16;
    return { left: fallbackRight - 88, top: fallbackTop, width: 88, height: 38, right: fallbackRight, bottom: fallbackTop + 38 };
  }
  return { left: innerWidth * 0.5 - 120, top: innerHeight * 0.5 - 40, width: 240, height: 80, right: innerWidth * 0.5 + 120, bottom: innerHeight * 0.5 + 40 };
}
function positionVisualGuideStep() {
  if (!visualGuideActive) return;
  var guide = document.getElementById('visual-guide');
  var ring = document.getElementById('visual-guide-ring');
  var card = document.getElementById('visual-guide-card');
  if (!guide || !ring || !card) return;
  var step = activeVisualGuideSteps()[visualGuideStep];
  var rect = guideTargetRect(step);
  ring.classList.toggle('shelf-target', !!(step && step.target === 'shelf'));
  var pad = step && step.target === 'shelf' ? 14 : (step && step.selector === '#bottom-bar' ? 10 : 8);
  var left = Math.max(12, rect.left - pad);
  var top = Math.max(12, rect.top - pad);
  var width = Math.min(innerWidth - left - 12, rect.width + pad * 2);
  var height = Math.min(innerHeight - top - 12, rect.height + pad * 2);
  ring.style.left = left + 'px';
  ring.style.top = top + 'px';
  ring.style.width = Math.max(44, width) + 'px';
  ring.style.height = Math.max(38, height) + 'px';
  ring.style.borderRadius = step && step.target === 'shelf' ? '28px' : ((step && step.selector === '#bottom-bar') ? '20px' : '16px');
  var scrim = guide.querySelector('.visual-guide-scrim');
  if (scrim) {
    scrim.style.setProperty('--gx', ((rect.left + rect.width / 2) / Math.max(1, innerWidth) * 100).toFixed(2) + '%');
    scrim.style.setProperty('--gy', ((rect.top + rect.height / 2) / Math.max(1, innerHeight) * 100).toFixed(2) + '%');
  }
  var cardW = Math.min(326, innerWidth - 32);
  var cardH = card.offsetHeight || 170;
  var cardLeft = rect.left + rect.width / 2 - cardW / 2;
  cardLeft = Math.max(16, Math.min(innerWidth - cardW - 16, cardLeft));
  var below = rect.bottom + 18;
  var above = rect.top - cardH - 18;
  var cardTop = below + cardH < innerHeight - 16 ? below : Math.max(16, above);
  card.style.left = cardLeft + 'px';
  card.style.top = cardTop + 'px';
}
function nextVisualGuideStep() {
  var steps = activeVisualGuideSteps();
  if (visualGuideStep >= steps.length - 1) {
    closeVisualGuide(true);
    return;
  }
  showVisualGuideStep(visualGuideStep + 1);
}
function closeVisualGuide(markSeen) {
  var guide = document.getElementById('visual-guide');
  visualGuideActive = false;
  if (markSeen) markVisualGuideSeen();
  if (guide) {
    guide.classList.remove('show');
    guide.setAttribute('aria-hidden', 'true');
  }
  document.body.classList.remove('visual-guide-active');
  document.body.classList.remove('fullscreen-diy-peek');
  var search = document.getElementById('search-area');
  var bottom = document.getElementById('bottom-bar');
  var fxPanel = document.getElementById('fx-panel');
  var playlistPanel = document.getElementById('playlist-panel');
  if (typeof setShelfGuideCueActive === 'function') setShelfGuideCueActive(false);
  // 3D 歌单架本身（不是详情）：引导前隐藏/关闭的，完成后必须整架收起
  if (visualGuideState) {
    var restoreMode = visualGuideState.shelfModeBeforeGuide;
    var wasHidden = !visualGuideState.shelfWasPinned && (restoreMode == null || restoreMode === 'off' || restoreMode !== 'side');
    if (visualGuideState.shelfOpenedForGuide || wasHidden) {
      if (shelfManager && shelfManager.hasOpenContent && shelfManager.hasOpenContent() && typeof safeShelfCloseContent === 'function') {
        safeShelfCloseContent('guide-complete');
      }
      if (typeof setShelfPinnedOpen === 'function') setShelfPinnedOpen(false, true);
      if (shelfManager && shelfManager.setMode && restoreMode && restoreMode !== 'side') {
        try { shelfManager.setMode(restoreMode); } catch (err) {}
      }
      shelfHoverCue.target = 0;
      shelfHoverCue.value = 0;
      shelfHoverCue.guide = false;
      shelfHoverCue.zoneActive = false;
      shelfVisibility = 0;
    }
    visualGuideState.shelfOpenedForGuide = false;
    visualGuideState.shelfWasPinned = false;
    visualGuideState.shelfModeBeforeGuide = null;
  }
  if (search && !visualGuideState.searchWasPeek && document.activeElement !== $input) setPeek(search, false, 'search');
  if (fxPanel && !visualGuideState.fxWasPeek) setPeek(fxPanel, false, 'fx');
  if (playlistPanel && !visualGuideState.plWasPeek) setPeek(playlistPanel, false, 'pl');
  if (bottom && !visualGuideState.bottomWasVisible && !playing) bottom.classList.remove('visible', 'soft-hidden');
}
function handleVisualGuideSurfaceClick(e) {
  if (!visualGuideActive) return;
  if (e && e.target && e.target.closest && e.target.closest('button')) return;
  if (e && e.preventDefault) e.preventDefault();
  nextVisualGuideStep();
}
(function bindVisualGuideSurfaceClick(){
  var guide = document.getElementById('visual-guide');
  if (guide) guide.addEventListener('click', handleVisualGuideSurfaceClick);
})();

// ============================================================
//  动态库加载
// ============================================================
function loadScriptOnce(src) {
  return new Promise(function(resolve, reject){
    var hit = document.querySelector('script[src="' + src + '"]');
    if (hit) { resolve(); return; }
    var sc = document.createElement('script'); sc.src = src; sc.async = true;
    sc.onload = resolve; sc.onerror = reject;
    document.head.appendChild(sc);
  });
}


var gestureVideo = null, gestureCamera = null, gestureHands = null;
var gestureActive = false;
// 21 个关键点的平滑缓存 (EMA): [{x,y}, ...]
var handLmSmooth = null;
var handLmLastSeen = 0;
// 捏合状态
var pinchState = { active:false, lastX:0, lastY:0, lastT:0 };
// 物理旋转: 给 particles 一个角速度, 每帧衰减
var particleSpin = { vx: 0, vy: 0, damping: 0.90 };
// 手势驱动的总旋转 (累计角度), 输出到 particles
var gestureRotation = { x: 0, y: 0 };
var gestureGrip = { value: 0, target: 0, openness: 1, lastState: 'open', pulse: 0 };
var PARTICLE_POINTER_SPIN_X = 0.0032;
var PARTICLE_POINTER_SPIN_Y = 0.0034;
var PARTICLE_HAND_SPIN_X = 4.15;
var PARTICLE_HAND_SPIN_Y = 4.30;
var PARTICLE_SPIN_MAX = 6.2;

function clampParticleSpinVelocity(v) {
  if (!isFinite(v)) return 0;
  return Math.max(-PARTICLE_SPIN_MAX, Math.min(PARTICLE_SPIN_MAX, v));
}

function applyParticleSpinDrag(dx, dy, dt) {
  var rx = dy * PARTICLE_POINTER_SPIN_X;
  var ry = dx * PARTICLE_POINTER_SPIN_Y;
  gestureRotation.x += rx;
  gestureRotation.y += ry;
  if (dt > 0) {
    particleSpin.vx = clampParticleSpinVelocity(rx / dt * 0.46);
    particleSpin.vy = clampParticleSpinVelocity(ry / dt * 0.46);
  }
}

function resetParticleRotationTarget(syncVisual) {
  gestureRotation.x = 0;
  gestureRotation.y = 0;
  particleSpin.vx = 0;
  particleSpin.vy = 0;
  if (syncVisual && particles) {
    particles.rotation.set(0, 0, 0);
    if (bloomParticles) bloomParticles.rotation.set(0, 0, 0);
    if (floatGroup) floatGroup.rotation.set(0, 0, 0);
    if (backCoverGroup) backCoverGroup.rotation.set(0, 0, 0);
  }
}

function rebaseParticleRotationAxis(axis) {
  var limit = Math.PI * 10;
  if (Math.abs(gestureRotation[axis]) < limit) return;
  var offset = Math.round(gestureRotation[axis] / (Math.PI * 2)) * Math.PI * 2;
  gestureRotation[axis] -= offset;
  if (particles) particles.rotation[axis] -= offset;
  if (bloomParticles) bloomParticles.rotation[axis] -= offset;
  if (floatGroup) floatGroup.rotation[axis] -= offset;
  if (backCoverGroup) backCoverGroup.rotation[axis] -= offset;
  if (skullParticleGroup) skullParticleGroup.rotation[axis] -= offset;
  if (stageLyrics.group) stageLyrics.group.rotation[axis] -= offset;
}

function rebaseParticleRotationIfNeeded() {
  rebaseParticleRotationAxis('x');
  rebaseParticleRotationAxis('y');
}
// 手骨架 canvas
var handCanvas = null, handCanvasCtx = null;
// 平滑系数 (越小越平滑, 但反应越慢)
var HAND_SMOOTH_ALPHA = 0.35;

async function startGestureControl() {
  if (gestureActive) return;
  showToast('正在加载手势识别…');
  try {
    await loadScriptOnce('https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js');
    await loadScriptOnce('https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js');
    gestureVideo = document.createElement('video');
    gestureVideo.playsInline = true; gestureVideo.muted = true;
    gestureVideo.style.display = 'none';
    document.body.appendChild(gestureVideo);
    gestureHands = new Hands({ locateFile: function(f){ return 'https://cdn.jsdelivr.net/npm/@mediapipe/hands/' + f; } });
    // modelComplexity:1 比 0 更稳定, 但仍流畅. 提高 confidence 减少误检
    gestureHands.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.7, minTrackingConfidence: 0.7 });
    gestureHands.onResults(function(res){
      if (!gestureActive) return;
      var lm = res.multiHandLandmarks && res.multiHandLandmarks[0];
      if (!lm) { onHandLost(); return; }
      processHandFrame(lm);
    });
    gestureCamera = new Camera(gestureVideo, { onFrame: async function(){ if (gestureHands) await gestureHands.send({ image: gestureVideo }); }, width: 480, height: 360 });
    await gestureCamera.start();
    gestureActive = true;
    // 准备 hand canvas
    handCanvas = document.getElementById('hand-canvas');
    handCanvasCtx = handCanvas.getContext('2d');
    resizeHandCanvas();
    handCanvas.classList.add('show');
    showToast('手势已开启: 手掌推开 · 捏合旋转 · 握拳收束');
    showGestureHUD('待命', 0, '把手放进视野');
  } catch (e) {
    console.warn('Gesture failed:', e);
    showToast('手势启动失败 (需要摄像头权限)');
    fx.cam = 'off';
    document.querySelectorAll('#cam-seg button').forEach(function(b){ b.classList.toggle('active', b.dataset.cam === 'off'); });
  }
}

function stopGestureControl() {
  if (!gestureActive) return;
  try { if (gestureCamera && gestureCamera.stop) gestureCamera.stop(); } catch(e){}
  try { if (gestureVideo && gestureVideo.srcObject) gestureVideo.srcObject.getTracks().forEach(function(t){ t.stop(); }); } catch(e){}
  try { if (gestureVideo) gestureVideo.remove(); } catch(e){}
  gestureVideo = null; gestureHands = null; gestureCamera = null;
  gestureActive = false;
  pinchState.active = false;
  handLmSmooth = null;
  uniforms.uHandActive.value = 0;
  if (uniforms.uGestureGrip) uniforms.uGestureGrip.value = 0;
  gestureGrip.value = 0;
  gestureGrip.target = 0;
  gestureGrip.openness = 1;
  document.getElementById('gesture-hud').classList.remove('show');
  if (handCanvas) {
    handCanvas.classList.remove('show');
    if (handCanvasCtx) handCanvasCtx.clearRect(0, 0, handCanvas.width, handCanvas.height);
  }
}

function resizeHandCanvas() {
  if (!handCanvas) return;
  var dpr = Math.min(devicePixelRatio || 1, 2);
  handCanvas.width = innerWidth * dpr;
  handCanvas.height = innerHeight * dpr;
  handCanvas.style.width = innerWidth + 'px';
  handCanvas.style.height = innerHeight + 'px';
  handCanvasCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resizeHandCanvas);

function onHandLost() {
  // 平滑淡出, 不立即清零 — 给一点缓冲
  if (pinchState.active) pinchState.active = false;
  gestureGrip.target = 0;
  uniforms.uHandActive.value *= 0.9;
  if (uniforms.uHandActive.value < 0.02) uniforms.uHandActive.value = 0;
  if (performance.now() - handLmLastSeen > 600) {
    handLmSmooth = null;
    if (handCanvasCtx) handCanvasCtx.clearRect(0, 0, innerWidth, innerHeight);
    showGestureHUD('待命', 0, '把手放进视野');
  }
}

// 把单帧 21 个 landmark 平滑到 handLmSmooth, 镜像 X (摄像头是反的)
function smoothLandmarks(lm) {
  if (!handLmSmooth) {
    handLmSmooth = lm.map(function(p){ return { x: 1 - p.x, y: p.y, z: p.z || 0 }; });
    return handLmSmooth;
  }
  var a = HAND_SMOOTH_ALPHA;
  for (var i = 0; i < 21; i++) {
    var srcX = 1 - lm[i].x;
    handLmSmooth[i].x += (srcX - handLmSmooth[i].x) * a;
    handLmSmooth[i].y += (lm[i].y - handLmSmooth[i].y) * a;
    handLmSmooth[i].z += ((lm[i].z || 0) - handLmSmooth[i].z) * a;
  }
  return handLmSmooth;
}

// 手掌中心 ≈ wrist(0) 和 mcp 平均 (5,9,13,17 是各指根)
function palmCenter(lm) {
  var px = (lm[0].x + lm[5].x + lm[9].x + lm[13].x + lm[17].x) / 5;
  var py = (lm[0].y + lm[5].y + lm[9].y + lm[13].y + lm[17].y) / 5;
  return { x: px, y: py };
}

function handOpenness(lm, palm) {
  var span = Math.hypot(lm[5].x - lm[17].x, lm[5].y - lm[17].y);
  span = Math.max(0.055, span);
  var tips = [8, 12, 16, 20];
  var avg = 0;
  for (var i = 0; i < tips.length; i++) avg += Math.hypot(lm[tips[i]].x - palm.x, lm[tips[i]].y - palm.y);
  avg /= tips.length;
  return clampRange((avg / span - 0.62) / 0.78, 0, 1);
}

function processHandFrame(rawLm) {
  handLmLastSeen = performance.now();
  var lm = smoothLandmarks(rawLm);

  // 推开粒子位置: 手掌中心 (而非单一食指)
  var palm = palmCenter(lm);
  var openness = handOpenness(lm, palm);
  gestureGrip.openness += (openness - gestureGrip.openness) * 0.28;
  var gripTarget = clampRange(1 - openness, 0, 1);
  gestureGrip.target = gripTarget > 0.55 ? gripTarget : 0;
  var ndcX = palm.x * 2 - 1;
  var ndcY = -(palm.y * 2 - 1);
  var handLocalX = ndcX * PLANE_SIZE * 0.62;
  var handLocalY = ndcY * PLANE_SIZE * 0.62;
  if (particleLocalPointFromNdc(ndcX, ndcY, particlePointerLocalHit)) {
    // 平滑推动 (避免 uHandXY 跳变)
    handLocalX = particlePointerLocalHit.x;
    handLocalY = particlePointerLocalHit.y;
  }
  var cur = uniforms.uHandXY.value;
  cur.x += (handLocalX - cur.x) * 0.48;
  cur.y += (handLocalY - cur.y) * 0.48;
  var tgtActive = 0.44 + openness * 0.56;
  uniforms.uHandActive.value += (tgtActive - uniforms.uHandActive.value) * 0.26;

  // 捏合检测 (拇指 4 与食指 8)
  var pinchDist = Math.hypot(lm[8].x - lm[4].x, lm[8].y - lm[4].y);
  var isPinch = pinchDist < 0.075 && openness > 0.28;
  var isFist = !isPinch && gripTarget > 0.68;

  if (isPinch && !pinchState.active) {
    unlockCenteredView();
    pinchState.active = true;
    pinchState.lastX = palm.x;
    pinchState.lastY = palm.y;
    pinchState.lastT = performance.now();
    particleSpin.vx = particleSpin.vy = 0;
    gestureGrip.target = Math.min(0.34, gestureGrip.target);
    showGestureHUD('捏合拖动', 1, '移动手掌 -> 旋转封面');
  } else if (isPinch && pinchState.active) {
    unlockCenteredView();
    var dx = palm.x - pinchState.lastX;
    var dy = palm.y - pinchState.lastY;
    var nowPinch = performance.now();
    var pinchDt = Math.max(1 / 120, Math.min(0.08, (nowPinch - pinchState.lastT) / 1000 || 1 / 60));
    // v8: 方向修正 - 上下手与封面旋转同向
    var spinY = dx * PARTICLE_HAND_SPIN_Y;
    var spinX = dy * PARTICLE_HAND_SPIN_X;
    gestureRotation.y += spinY;
    gestureRotation.x += spinX;
    particleSpin.vy = clampParticleSpinVelocity(spinY / pinchDt * 0.48);
    particleSpin.vx = clampParticleSpinVelocity(spinX / pinchDt * 0.48);
    pinchState.lastX = palm.x;
    pinchState.lastY = palm.y;
    pinchState.lastT = nowPinch;
    gestureGrip.target = Math.min(0.34, gestureGrip.target);
    showGestureHUD('拖动中', 1, '松手后保留惯性');
  } else if (!isPinch && pinchState.active) {
    pinchState.active = false;
    showGestureHUD('松开', 0.4, '可继续触碰或捏合');
  } else if (isFist) {
    if (gestureGrip.lastState !== 'fist') {
      gestureGrip.pulse = 1;
      uniforms.uBurstAmt.value = Math.max(uniforms.uBurstAmt.value, 0.26);
    }
    gestureGrip.lastState = 'fist';
    showGestureHUD('握拳收束', Math.max(0.55, gripTarget), '粒子向中心收缩');
  } else {
    if (gestureGrip.lastState === 'fist' && openness > 0.58) {
      uniforms.uBurstAmt.value = Math.max(uniforms.uBurstAmt.value, 0.18);
    }
    gestureGrip.lastState = openness > 0.62 ? 'open' : 'hover';
    showGestureHUD(openness > 0.62 ? '张开恢复' : '悬停', 0.30 + openness * 0.34, '手掌推开粒子 / 捏合旋转 / 握拳收束');
  }

  drawHandSkeleton(lm, isPinch, openness, isFist);
}

function drawHandSkeleton(lm, isPinch, openness, isFist) {
  if (!handCanvasCtx) return;
  var ctx = handCanvasCtx;
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  var W = innerWidth, H = innerHeight;
  openness = clampRange(openness == null ? 1 : openness, 0, 1);
  var palm = palmCenter(lm);
  var px = palm.x * W, py = palm.y * H;
  var primary = isFist ? 'rgba(244,210,138,0.92)' : (isPinch ? 'rgba(156,255,223,0.95)' : 'rgba(226,247,255,0.92)');
  var soft = isFist ? 'rgba(244,210,138,0.18)' : (isPinch ? 'rgba(156,255,223,0.20)' : 'rgba(143,233,255,0.18)');
  var coreR = 26 + openness * 34;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  var aura = ctx.createRadialGradient(px, py, 0, px, py, coreR * 2.15);
  aura.addColorStop(0, isFist ? 'rgba(244,210,138,0.26)' : 'rgba(255,255,255,0.22)');
  aura.addColorStop(0.28, soft);
  aura.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = aura;
  ctx.beginPath();
  ctx.arc(px, py, coreR * 2.15, 0, Math.PI * 2);
  ctx.fill();

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  var ringR = 34 + openness * 48;
  for (var r = 0; r < 3; r++) {
    var alpha = (0.18 - r * 0.045) + (isFist ? 0.08 : 0);
    ctx.strokeStyle = primary.replace(/0\.\d+\)/, alpha.toFixed(3) + ')');
    ctx.lineWidth = 1.2 + r * 0.55;
    ctx.beginPath();
    ctx.arc(px, py, ringR + r * 13 + Math.sin(uniforms.uTime.value * 1.5 + r) * 2, 0, Math.PI * 2);
    ctx.stroke();
  }

  var tips = [4, 8, 12, 16, 20];
  for (var i = 0; i < tips.length; i++) {
    var p = lm[tips[i]];
    var tx = p.x * W, ty = p.y * H;
    var dx = tx - px, dy = ty - py;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var beamAlpha = clampRange(0.26 - dist / 720, 0.045, 0.18) * (0.55 + openness * 0.45);
    var grad = ctx.createLinearGradient(px, py, tx, ty);
    grad.addColorStop(0, 'rgba(255,255,255,' + (beamAlpha * 0.20).toFixed(3) + ')');
    grad.addColorStop(0.65, 'rgba(255,255,255,' + (beamAlpha * 0.42).toFixed(3) + ')');
    grad.addColorStop(1, primary.replace(/0\.\d+\)/, Math.min(0.72, beamAlpha + 0.14).toFixed(3) + ')'));
    ctx.strokeStyle = grad;
    ctx.lineWidth = tips[i] === 8 || tips[i] === 4 ? 1.7 : 1.05;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.quadraticCurveTo(px + dx * 0.42 - dy * 0.05, py + dy * 0.42 + dx * 0.05, tx, ty);
    ctx.stroke();
    var dotR = (tips[i] === 8 || tips[i] === 4 ? 4.2 : 3.0) + (isFist ? 0.8 : 0);
    var dot = ctx.createRadialGradient(tx, ty, 0, tx, ty, dotR * 4.2);
    dot.addColorStop(0, 'rgba(255,255,255,0.92)');
    dot.addColorStop(0.32, primary);
    dot.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = dot;
    ctx.beginPath();
    ctx.arc(tx, ty, dotR * 4.2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.beginPath();
  ctx.arc(px, py, isFist ? 7.2 : 5.4, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,' + (isFist ? 0.82 : 0.62).toFixed(3) + ')';
  ctx.fill();

  if (isPinch) {
    var t1 = lm[4], t2 = lm[8];
    ctx.strokeStyle = 'rgba(220,255,241,0.88)';
    ctx.lineWidth = 2.0;
    ctx.shadowColor = 'rgba(126,226,168,0.82)';
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.moveTo(t1.x * W, t1.y * H);
    ctx.lineTo(t2.x * W, t2.y * H);
    ctx.stroke();
  }
  ctx.restore();
}

// 每帧调用 — 应用惯性旋转 + handActive 衰减
function tickGestureRotation(dt) {
  if (Math.abs(particleSpin.vx) > 0.0001 || Math.abs(particleSpin.vy) > 0.0001) {
    var rx = particleSpin.vx * dt;
    var ry = particleSpin.vy * dt;
    gestureRotation.x += rx;
    gestureRotation.y += ry;
    rebaseParticleRotationIfNeeded();
  }
  particleSpin.vx *= Math.pow(particleSpin.damping, dt * 60);
  particleSpin.vy *= Math.pow(particleSpin.damping, dt * 60);
  if (Math.abs(particleSpin.vx) < 0.01) particleSpin.vx = 0;
  if (Math.abs(particleSpin.vy) < 0.01) particleSpin.vy = 0;
  gestureGrip.value += (gestureGrip.target - gestureGrip.value) * (gestureGrip.target > gestureGrip.value ? 0.18 : 0.10);
  gestureGrip.pulse *= Math.pow(0.84, dt * 60);
  if (uniforms.uGestureGrip) uniforms.uGestureGrip.value = clampRange(gestureGrip.value + gestureGrip.pulse * 0.16, 0, 1);
  // hand active 自然衰减 (无手时)
  if (gestureActive && handLmSmooth && performance.now() - handLmLastSeen > 200) {
    uniforms.uHandActive.value *= 0.94;
    gestureGrip.target *= 0.92;
    if (uniforms.uHandActive.value < 0.02) uniforms.uHandActive.value = 0;
  }
}

function showGestureHUD(label, progress, detail) {
  var hud = document.getElementById('gesture-hud');
  if (!hud) return;
  document.getElementById('gesture-label').textContent = label || '待命';
  document.getElementById('gesture-confirm').textContent = detail || '将手放进摄像头视野';
  var fill = document.getElementById('gesture-fill');
  if (fill) fill.style.width = Math.max(0, Math.min(100, (progress || 0) * 100)) + '%';
  hud.classList.add('show');
}
