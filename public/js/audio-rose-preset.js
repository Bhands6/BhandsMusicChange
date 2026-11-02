/**
 * 玫瑰绽放 (Rose Bloom) — 预设 21
 *
 * 画法 = **音域回响（Sonic-Topography）那一套**：InstancedMesh 实体小柱，
 * 顶面/侧面分离着色，柱高随音频律动（每根柱子都是一个小均衡器）。
 * 区别只在「骨架」：音域回响的柱子长在平面网格上，这里的柱子长在玫瑰上——
 * 花瓣按圈包裹（内层直立包心、外层翻过水平线下垂）、加花萼/花茎/两片叶子。
 *
 * 结构（自上而下，全部由小柱组成）：
 *   花头  8 圈花瓣（4/6/8/10/12/14/16/16 片），柱色深红 → 玫红 → 粉白
 *   花萼  花头底部一圈翠绿尖刺 + 蓝紫色花心点缀
 *   花茎  微 S 形曲线柱列
 *   叶子  右上 / 左下 / 小叶，黄绿色
 *
 * 踩坑记录（修了一下午的三个）：
 *   1. makeSpine 查找表只累加不 push → 表永远只有 1 项，spineAt 越界读 undefined；
 *   2. pitch 约定写反：本实现 pitch 是「与水平面夹角」，cos(pitch) 加半径、sin(pitch) 加高度，
 *      内圈要陡直就给大 pitch（≈π/2），外圈平摊给小 pitch，垂下给负值；
 *   3. Matrix4.makeBasis 的基必须右手系（Z = X×Y），否则 setFromRotationMatrix
 *      解出长度 0.785 的坏四元数，朝向全乱（平面卡片那版踩的，这里柱子不需要旋转）。
 */
(function (global) {
  'use strict';

  var INDEX = 21;

  var HEAD_CY = 1.15;        // 花头中心高度
  var STEM_TOP = 0.92;       // 花茎起点（接花头）
  var STEM_BOTTOM = -2.35;   // 花茎终点
  var STAMEN_BLUE = 150;     // 花心蓝紫点缀
  var SEPAL_COUNT = 6;

  var state = {
    root: null,
    bars: null,
    mat: null,
    scene: null,
    opacity: 0,
    initialized: false,
    time: 0,
    pulse: 0,
    open: 0,
    lastBeat: false,
    smooth: { bass: 0, mid: 0, treble: 0, beat: 0, energy: 0 }
  };

  function clamp01(v) { return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rnd(seed) { return (Math.abs(Math.sin(seed) * 43758.5453)) % 1; }

  /**
   * 花瓣圈：pitch = 与水平面的夹角。
   *   cos(pitch) → 半径增量、sin(pitch) → 高度增量；
   *   内圈要「直立包心」就给大 pitch（≈1.4≈82°），外圈平摊给小 pitch，垂下给负值。
   * curl 让花瓣沿 u（根部→外缘）逐渐放平 —— 玫瑰花瓣「根部立、梢部翻」的曲线。
   */
  var WHORLS = [
    { count: 4,  pitch: 1.05, curl: 0.45, len: 0.70, rBase: 0.02, hBase: 0.42, arc: 1.60 },
    { count: 6,  pitch: 0.95, curl: 0.55, len: 0.78, rBase: 0.06, hBase: 0.34, arc: 1.50 },
    { count: 8,  pitch: 0.85, curl: 0.62, len: 0.86, rBase: 0.12, hBase: 0.26, arc: 1.40 },
    { count: 10, pitch: 0.72, curl: 0.68, len: 0.92, rBase: 0.18, hBase: 0.18, arc: 1.28 },
    { count: 12, pitch: 0.55, curl: 0.72, len: 0.96, rBase: 0.25, hBase: 0.10, arc: 1.14 },
    { count: 14, pitch: 0.34, curl: 0.75, len: 0.98, rBase: 0.32, hBase: 0.03, arc: 1.00 },
    { count: 16, pitch: 0.10, curl: 0.78, len: 0.98, rBase: 0.38, hBase: -0.04, arc: 0.88 },
    { count: 16, pitch: -0.18, curl: 0.85, len: 0.96, rBase: 0.43, hBase: -0.10, arc: 0.76 }
  ];

  /** 沿花瓣中心线积分：pitch 随 u 递减，得到 R(u)/Y(u) 查找表（注意：必须 push！） */
  function makeSpine(whorl) {
    var steps = 20;
    var R = whorl.rBase;
    var Y = 0;
    var table = [{ r: R, y: Y }];
    for (var i = 0; i < steps; i++) {
      var t = (i + 0.5) / steps;
      var pitch = Math.min(1.55, whorl.pitch + whorl.curl * t);   // 梢部上翘 → 杯形
      R += Math.cos(pitch) * (whorl.len / steps);
      Y += Math.sin(pitch) * (whorl.len / steps);
      table.push({ r: R, y: Y });   // ⭐ 之前漏了这行，表只有 1 项
    }
    return table;
  }

  function spineAt(table, u) {
    var steps = table.length - 1;
    var f = Math.min(0.9999, Math.max(0, u)) * steps;
    var i = Math.floor(f);
    var t = f - i;
    var a = table[i], b = table[i + 1];
    return { r: lerp(a.r, b.r, t), y: lerp(a.y, b.y, t) };
  }

  function pushBar(list, x, y, z, color, width, height, group, phase) {
    list.x.push(x); list.y.push(y); list.z.push(z);
    list.c.push(color[0], color[1], color[2]);
    list.w.push(width);
    list.h.push(height);
    list.g.push(group);
    list.p.push(phase);
  }

  function leafColor(t) {
    // 茎叶：黄绿
    return [0.28 + t * 0.36, 0.50 + t * 0.36, 0.05 + t * 0.10];
  }

  function petalColor(wf, u, jitter) {
    // 内层亮玫红（花心受光）→ 外层深红，参考图就是这个配色
    var r = lerp(1.00, 0.62, Math.pow(wf, 0.75));
    var g = lerp(0.18, 0.03, Math.pow(wf, 0.75));
    var b = lerp(0.26, 0.08, Math.pow(wf, 0.75));
    var v = (jitter - 0.5) * 0.10;
    return [clamp01(r + v), clamp01(g + v * 0.6), clamp01(b + v * 0.8)];
  }

  /** 一片叶子：沿 dir 长出，宽随 sin 收放，尖端自然收细，带下垂 */
  function leaf(list, dirX, stemY, len, maxW, dz, droop) {
    var dirLen = Math.sqrt(dirX * dirX + dz * dz);
    var ux = dirX / dirLen, uz = dz / dirLen;
    var px = -uz, pz = ux;
    var count = 2400;
    for (var i = 0; i < count; i++) {
      var t = Math.pow(rnd(i * 1.7), 0.85);
      var s = (rnd(i * 3.9 + 0.5) * 2 - 1);
      var w = Math.sin(Math.PI * Math.pow(t, 0.72)) * maxW;
      var sy = stemY - droop * t * t;
      var vein = 1 - Math.min(1, Math.abs(s)) * 0.45;
      pushBar(
        list,
        ux * t * len + px * s * w,
        sy,
        uz * t * len + pz * s * w,
        leafColor((0.45 + t * 0.4) * vein),
        0.024 + rnd(i * 2.3) * 0.014,
        0.10 + rnd(i * 8.1) * 0.06,
        2,
        (t + s * 0.3) % 1
      );
    }
  }

  function buildData() {
    var list = { x: [], y: [], z: [], c: [], w: [], h: [], g: [], p: [] };
    var i, w, k;

    // ---------- 花头：8 圈花瓣，每圈错半瓣 ----------
    for (w = 0; w < WHORLS.length; w++) {
      var whorl = WHORLS[w];
      var wf = w / (WHORLS.length - 1);
      var spine = makeSpine(whorl);
      for (k = 0; k < whorl.count; k++) {
        var phi0 = (k / whorl.count) * Math.PI * 2 + (w % 2 ? Math.PI / whorl.count : 0) + w * 0.27;
        var lenMul = 0.92 + rnd(w * 31.7 + k * 7.7) * 0.16;
        var band = 0.86 + 0.14 * ((w + k) % 2);   // 圈间明暗条纹：让「一层层花瓣」可分辨
        var spine2 = makeSpine({
          pitch: whorl.pitch, curl: whorl.curl,
          len: whorl.len * lenMul, rBase: whorl.rBase
        });

        var NU = 9, NS = 8;
        for (var iu = 0; iu < NU; iu++) {
          var u = 0.10 + 0.90 * ((iu + rnd(w * 13.1 + k * 3.7 + iu)) / NU);
          for (var is = 0; is < NS; is++) {
            var s = ((is + rnd(k * 91.3 + iu * 7.9 + is)) / NS) * 2 - 1;
            // ⭐ 圆瓣：横向越靠边瓣越短，外缘才是弧线
            var lobe = Math.sqrt(Math.max(0.02, 1 - 0.62 * s * s));
            var sp = spineAt(spine2, u * lobe);
            var halfArc = (Math.PI / whorl.count) * whorl.arc * (0.86 + 0.28 * u);
            var th = phi0 + s * halfArc;
            var ruffleR = 0.022 * Math.sin(s * 7.0 + w) * u;
            var ruffleY = -0.05 * (1 - Math.abs(s)) * Math.pow(u, 3.0) * (wf > 0.5 ? 1.5 : 0.7);
            var rr = sp.r + ruffleR;
            var jx = (rnd(iu * 53.7 + is * 11.3 + w) - 0.5) * 0.02;
            var jy = (rnd(iu * 17.9 + is * 71.3 + k) - 0.5) * 0.02;
            // 行波相位：绕花一圈 + 沿瓣一点，柱子的律动会像波浪一样绕着花转
            var phase = (th / (Math.PI * 2) + u * 0.5) % 1;
            pushBar(
              list,
              Math.cos(th) * rr + jx,
              HEAD_CY + whorl.hBase + sp.y + ruffleY + jy,
              Math.sin(th) * rr,
              [petalColor(wf, u, rnd(k * 3.1 + iu + is * 2.7 + w))[0] * band,
               petalColor(wf, u, rnd(k * 3.1 + iu + is * 2.7 + w))[1] * band,
               petalColor(wf, u, rnd(k * 3.1 + iu + is * 2.7 + w))[2] * band],
              0.038 + rnd(k * 5.7 + iu * 3.3 + is) * 0.020,
              0.16 + rnd(iu * 3.7 + is) * 0.11 + (1 - wf) * 0.06,
              0,
              phase
            );
          }
        }
      }
    }

    // ---------- 花萼（花头底部一圈翠绿尖刺）----------
    for (k = 0; k < SEPAL_COUNT; k++) {
      var sa = (k / SEPAL_COUNT) * Math.PI * 2 + 0.4;
      var sepalSteps = 26;
      for (i = 0; i < sepalSteps; i++) {
        var t = i / sepalSteps;
        var t0 = t * 0.34;
        var sr = lerp(0.10, 0.34, t0) + (rnd(k * 9.7 + i) - 0.5) * 0.012;
        pushBar(
          list,
          Math.cos(sa) * sr,
          STEM_TOP - 0.02 - t * 0.30,
          Math.sin(sa) * sr,
          leafColor(0.9 - t * 0.35),
          0.016 + rnd(i * 5.1 + k * 2.3) * 0.008,
          0.09 + rnd(i * 3.3 + k) * 0.04,
          2,
          (k / SEPAL_COUNT + t * 0.2) % 1
        );
      }
    }

    // ---------- 蓝紫色花心点缀（萼片交界处那撮蓝）----------
    for (i = 0; i < STAMEN_BLUE; i++) {
      var a = rnd(i * 12.9898) * Math.PI * 2;
      var rr2 = rnd(i * 7.7) * 0.12;
      pushBar(
        list,
        Math.cos(a) * rr2,
        STEM_TOP - rnd(i * 3.7) * 0.14,
        Math.sin(a) * rr2,
        [0.38 + rnd(i) * 0.2, 0.30, 0.95],
        0.014,
        0.07 + rnd(i * 2.9) * 0.05,
        2,
        rnd(i)
      );
    }

    // ---------- 花茎（微 S 形柱列）----------
    var stemSteps = 1300;
    for (i = 0; i < stemSteps; i++) {
      var ty = i / stemSteps;
      var sy = lerp(STEM_TOP, STEM_BOTTOM, ty);
      var bend = 0.16 * Math.sin((sy - STEM_TOP) * 1.15);
      var rad = 0.020 + rnd(i) * 0.012;
      var aa = rnd(i * 3.1) * Math.PI * 2;
      pushBar(
        list,
        bend + Math.cos(aa) * rad,
        sy,
        Math.sin(aa) * rad,
        leafColor(0.55 + rnd(i * 7.7) * 0.45),
        0.015 + rnd(i * 1.9) * 0.008,
        0.10 + rnd(i * 4.3) * 0.05,
        1,
        (ty * 0.6) % 1
      );
    }

    // ---------- 叶子 ----------
    leaf(list,  0.92,  0.60, 1.05, 0.38, 0.20, -0.55);   // 右上
    leaf(list, -1.02, -1.10, 0.95, 0.34, 0.18, -0.62);   // 左下
    leaf(list, -0.55, -0.12, 0.70, 0.24, 0.14, -0.30);   // 小叶（左）

    var count = list.x.length;
    var position = new Float32Array(count * 3);
    for (var i = 0; i < count; i++) {
      position[i * 3] = list.x[i];
      position[i * 3 + 1] = list.y[i];
      position[i * 3 + 2] = list.z[i];
    }

    return {
      position: position,
      color: new Float32Array(list.c),
      width: new Float32Array(list.w),
      height: new Float32Array(list.h),
      group: new Float32Array(list.g),
      phase: new Float32Array(list.p),
      count: count
    };
  }

  function buildBarsVertexShader() {
    return [
      'precision highp float;',
      'uniform float uTime, uBass, uPulse, uTreble, uOpen;',
      'attribute vec3 aColor;',
      'attribute float aPhase, aGroup, aHeight;',
      'varying vec3 vCol;',
      'varying float vTop;',
      'varying float vH;',
      'void main(){',
      '  vec3 p = position;',
      // 每根柱 = 一个小均衡器：绕花传播的行波 + 低频整体律动
      '  float wave = 0.5 + 0.5 * sin(uTime * 2.1 + aPhase * 6.2831);',
      '  float headK = aGroup < 0.5 ? 1.0 : 0.35;',
      '  float h = aHeight * (1.0 + (uBass * 0.95 + 0.28) * wave * headK + uPulse * 0.5 * headK);',
      '  p.y *= h;',
      // 鼓点：整朵沿水平面轻微张开
      '  p.xz *= 1.0 + uOpen * 0.05 * headK;',
      '  vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);',
      '  vTop = step(0.5, normal.y);',                 // 顶面亮、侧面暗（音域回响的着色口径）
      '  vH = clamp(p.y / max(aHeight, 0.001), 0.0, 1.5);',
      '  vCol = aColor * (0.72 + 0.38 * vH);',         // 柱根暗、柱头亮
      '  gl_Position = projectionMatrix * viewMatrix * wp;',
      '}'
    ].join('\n');
  }

  function buildBarsFragmentShader() {
    return [
      'precision highp float;',
      'varying vec3 vCol;',
      'varying float vTop;',
      'varying float vH;',
      'void main(){',
      '  vec3 col = vCol * (0.60 + 0.45 * vTop);',     // 顶面略亮
      '  col += vCol * smoothstep(0.75, 1.2, vH) * 0.30;',  // 柱头泛光
      '  gl_FragColor = vec4(col, 1.0);',
      '}'
    ].join('\n');
  }

  function buildBars() {
    var data = buildData();

    // 单位柱：x/z 宽度用实例矩阵缩放，y ∈ [0,1] 用着色器按 aHeight 拉伸
    var geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(data.color, 3));
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(data.phase, 1));
    geo.setAttribute('aGroup', new THREE.InstancedBufferAttribute(data.group, 1));
    geo.setAttribute('aHeight', new THREE.InstancedBufferAttribute(data.height, 1));

    var mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uBass: { value: 0 },
        uPulse: { value: 0 },
        uTreble: { value: 0 },
        uOpen: { value: 0 }
      },
      vertexShader: buildBarsVertexShader(),
      fragmentShader: buildBarsFragmentShader(),
      side: THREE.FrontSide,
      transparent: false,
      depthWrite: true,
      depthTest: true
    });

    var mesh = new THREE.InstancedMesh(geo, mat, data.count);
    mesh.frustumCulled = false;

    var dummy = new THREE.Object3D();
    for (var i = 0; i < data.count; i++) {
      dummy.position.set(data.position[i * 3], data.position[i * 3 + 1], data.position[i * 3 + 2]);
      dummy.rotation.set(0, 0, 0);
      var wv = data.width[i];
      dummy.scale.set(wv, 1, wv);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }

  function ensureLayer(scene) {
    if (state.initialized) return;
    state.scene = scene;

    state.root = new THREE.Group();
    state.root.name = 'audio-rose-root';

    state.bars = buildBars();
    state.mat = state.bars.material;
    state.root.add(state.bars);

    state.root.visible = false;
    scene.add(state.root);
    state.initialized = true;
  }

  function clearLayer() {
    if (!state.root) return;
    if (state.scene) state.scene.remove(state.root);
    if (state.bars) { state.bars.geometry.dispose(); state.bars.material.dispose(); }
    state.root = null;
    state.bars = null;
    state.mat = null;
    state.initialized = false;
    state.opacity = 0;
  }

  function readAudio(raw) {
    raw = raw || {};
    return {
      bass: clamp01(raw.bass),
      mid: clamp01(raw.mid),
      treble: clamp01(raw.treble),
      beat: clamp01(raw.beat),
      energy: clamp01(raw.energy)
    };
  }

  function smoothAudio(target, dt) {
    var k = 1 - Math.exp(-14.0 * Math.max(0.001, dt || 1 / 60));
    var s = state.smooth;
    s.bass += (target.bass - s.bass) * k;
    s.mid += (target.mid - s.mid) * k;
    s.treble += (target.treble - s.treble) * k;
    s.beat += (target.beat - s.beat) * k;
    s.energy += (target.energy - s.energy) * k;
    return s;
  }

  function isActive(fx) {
    return !!(fx && Number(fx.preset) === INDEX);
  }

  function update(dt, ctx) {
    ctx = ctx || {};
    var fx = ctx.fx || {};
    var scene = ctx.scene;
    if (!scene) return;

    var active = isActive(fx);
    state.opacity += ((active ? 1 : 0) - state.opacity) * Math.min(1, dt * (active ? 3.0 : 2.2));
    if (!active && state.opacity < 0.01) {
      if (state.root) state.root.visible = false;
      return;
    }

    ensureLayer(scene);
    if (!state.root) return;

    state.time += dt;
    var audio = smoothAudio(readAudio(ctx.audio), dt);

    var beatOn = audio.beat > 0.55;
    if (beatOn && !state.lastBeat) state.pulse = 1.0;
    state.lastBeat = beatOn;
    state.pulse *= Math.pow(0.02, Math.max(0.001, dt));

    var targetOpen = state.pulse * 0.8 + audio.bass * 0.35;
    state.open += (targetOpen - state.open) * Math.min(1, dt * 8.0);

    // 整枝轻摆 + 缓慢自转（音域回响也有缓慢旋转）
    state.root.rotation.y += dt * lerp(0.03, 0.15, clamp01((fx.speed || 1) / 2));
    state.root.rotation.z = Math.sin(state.time * 0.42) * 0.025;
    state.root.rotation.x = Math.sin(state.time * 0.31) * 0.018;

    var u = state.mat.uniforms;
    u.uTime.value = state.time;
    u.uBass.value = audio.bass;
    u.uPulse.value = state.pulse;
    u.uTreble.value = audio.treble;
    u.uOpen.value = state.open;

    // 整体呼吸
    var breathe = 0.98 + 0.02 * state.opacity + audio.bass * 0.03 + state.pulse * 0.03;
    state.root.scale.setScalar(breathe);

    state.root.visible = state.opacity > 0.02;
  }

  function onPresetChange(prev, next, ctx) {
    if (Number(prev) === INDEX && Number(next) !== INDEX) clearLayer();
    if (Number(next) === INDEX && ctx && ctx.scene) {
      if (state.initialized) clearLayer();
      ensureLayer(ctx.scene);
      state.root.visible = true;
    }
  }

  global.MineradioAudioRose = {
    INDEX: INDEX,
    isActive: isActive,
    update: update,
    clear: clearLayer,
    onPresetChange: onPresetChange
  };
})(typeof window !== 'undefined' ? window : globalThis);
