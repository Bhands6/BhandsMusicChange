//  audio-fish-school-preset.js — 预设 23 深海鱼群 Fish School
//  移植自用户提供的参考稿「水下光影 · The School」：
//  · 鱼群绕一个缓慢漂移的虚拟中心群游（向心力 0.00052）+ 个体 wander + 局部分离力
//  · 速度上限 maxS=0.62+depth*1.05、阻尼 0.966、头始终平滑转向速度方向（dt*3.4）
//  · 身体正弦波动：bend(u)=sin(phase-u*3.25)*amp*u²（越靠尾摆幅越大），GPU 顶点位移
//  · 7 色板 × 3 体型 → 个体色/长/宽随机；depth 层次（远小暗慢、近大亮快）
//  · 音频：bass 提升摆尾幅度与游速、beat 扩大分离半径（鼓点鱼群炸开再聚拢）
//  · 3D 姿态：鱼身侧视贴屏（身体在 XY 平面），头朝速度方向；z 仅作 depth 层
(function (global) {
  'use strict';

  var INDEX = 23;

  var COUNT = 36;            // 鱼数量（参考稿口径；贴屏 2D 观感下 36 只分布最舒展）
  var SPAN_X = 6.2;          // 活动域半宽/半高（软边界推回）
  var SPAN_Y = 3.6;
  var SEP_R = 1.0;           // 分离半径（>鱼体长，防穿模叠堆）
  var K = 0.00724;           // px → 世界单位换算（视野宽度 13.9 units / 1920px）

  var PALETTES = [
    ['#f5a33a', '#a94a19', '#ffe0a0'],
    ['#f28a43', '#a83e20', '#ffd0a0'],
    ['#e8c968', '#a8792f', '#fff0be'],
    ['#d9e7ef', '#718da4', '#ffffff'],
    ['#9cc9e8', '#426d98', '#e1f2ff'],
    ['#e87960', '#8d3028', '#ffc1a1'],
    ['#e8c1a0', '#9f7055', '#fff0d9']
  ];
  var SPECIES = [
    { body: 0.25, lenK: [0.78, 1.08] },
    { body: 0.33, lenK: [0.62, 0.88] },
    { body: 0.29, lenK: [0.66, 0.96] }
  ];

  var state = {
    root: null,
    mesh: null,
    mat: null,
    scene: null,
    opacity: 0,
    initialized: false,
    time: 0,
    schoolPhase: 0,
    fishes: [],
    dummy: null,
    smooth: { bass: 0, mid: 0, treble: 0, beat: 0, energy: 0 }
  };

  function clamp01(v) { return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rnd(i) { var x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
  function hex2rgb(h) {
    return [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
  }

  /**
   * 鱼体几何（模型单位，全长 ≈ 1）：照抄参考稿 profile 公式——
   * shape=sin(πu^0.76)^0.78 包络 + 肩部隆起 + 尾柄收窄；头在 +x（u=0），尾在 -x（u=1）。
   * 属性：aBodyU（波动驱动，尾鳍>1）、aSideY（+1 背侧亮 / -1 腹侧暗）、aFin（鳍半透明）。
   */
  function buildFishUnit() {
    var pos = [], bodyU = [], sideY = [], fin = [], idx = [];
    var N = 36;
    function profile(u) {
      var shape = Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(u, 0.76))), 0.78);
      var shoulder = 0.08 * Math.exp(-Math.pow((u - 0.18) / 0.16, 2));
      var peduncle = 1 - 0.68 * Math.pow(Math.max(0, (u - 0.73) / 0.27), 1.35);
      return (0.018 + shape * 0.49 + shoulder * 0.25) * peduncle;
    }
    function vx(u, sy, fu, f) {
      pos.push(0.47 - u * 0.88, sy, 0);
      bodyU.push(fu);
      sideY.push(sy >= 0 ? 1 : -1);
      fin.push(f);
    }
    // 身体三角带（上轮廓 → 下轮廓）
    var topBase = 0;
    for (var i = 0; i <= N; i++) {
      var u = i / N, w = profile(u);
      vx(u, w, u, 0);
    }
    var botBase = pos.length / 3;
    for (var i2 = 0; i2 <= N; i2++) {
      var u2 = i2 / N, w2 = profile(u2);
      vx(u2, -w2, u2, 0);
    }
    for (var k = 0; k < N; k++) {
      idx.push(topBase + k, botBase + k, topBase + k + 1);
      idx.push(topBase + k + 1, botBase + k, botBase + k + 1);
    }
    // 分叉尾鳍（尾柄点 u=1，两片叉尾三角，aBodyU>1 让摆幅更大）
    var tX = 0.47 - 0.88, tip1 = -0.68 + 0.13, tip2 = -0.68 - 0.045, tip3 = -0.68 + 0.025;
    var fBase = pos.length / 3;
    // 上叉
    pos.push(tX, 0, 0); bodyU.push(1.0); sideY.push(1); fin.push(1);
    pos.push(tip1, 0.25, 0); bodyU.push(1.25); sideY.push(1); fin.push(1);
    pos.push(tip2, 0.62, 0); bodyU.push(1.3); sideY.push(1); fin.push(1);
    idx.push(fBase, fBase + 1, fBase + 2);
    // 下叉
    pos.push(tX, 0, 0); bodyU.push(1.0); sideY.push(-1); fin.push(1);
    pos.push(tip1, -0.25, 0); bodyU.push(1.25); sideY.push(-1); fin.push(1);
    pos.push(tip2, -0.62, 0); bodyU.push(1.3); sideY.push(-1); fin.push(1);
    idx.push(fBase + 3, fBase + 5, fBase + 4);
    // 背鳍（+y 侧，世界向上）与臀鳍（-y 侧）
    var dX = 0.47 - 0.47 * 0.88, dW = profile(0.47);
    var dBase = pos.length / 3;
    pos.push(dX + 0.13, dW * 0.6, 0); bodyU.push(0.42); sideY.push(1); fin.push(1);
    pos.push(dX - 0.01, dW + 0.30, 0); bodyU.push(0.5); sideY.push(1); fin.push(1);
    pos.push(dX - 0.34, dW * 0.2, 0); bodyU.push(0.6); sideY.push(1); fin.push(1);
    idx.push(dBase, dBase + 1, dBase + 2);
    var aX = 0.47 - 0.68 * 0.88, aW = profile(0.68);
    var aBase = pos.length / 3;
    pos.push(aX + 0.02, -aW * 0.7, 0); bodyU.push(0.66); sideY.push(-1); fin.push(1);
    pos.push(aX - 0.13, -aW - 0.16, 0); bodyU.push(0.72); sideY.push(-1); fin.push(1);
    pos.push(aX - 0.29, -aW * 0.24, 0); bodyU.push(0.78); sideY.push(-1); fin.push(1);
    idx.push(aBase, aBase + 2, aBase + 1);
    return {
      position: new Float32Array(pos),
      bodyU: new Float32Array(bodyU),
      sideY: new Float32Array(sideY),
      fin: new Float32Array(fin),
      index: new Uint16Array(idx)
    };
  }

  function buildFishVertexShader() {
    return [
      'precision highp float;',
      'uniform float uTime;',
      'uniform float uBendAmp;',   // 摆尾幅度（bass 驱动）
      'attribute float aBodyU;',
      'attribute float aSideY;',
      'attribute float aFin;',
      'attribute float aPhase;',
      'attribute float aFlapSpeed;',
      'attribute float aWidK;',
      'attribute vec3 aTint0;',   // 暗色（尾/背缘）
      'attribute vec3 aTint1;',   // 主色
      'attribute vec3 aTint2;',   // 亮腹色
      'varying float vU;',
      'varying float vSideY;',
      'varying float vFin;',
      'varying vec3 vT0;',
      'varying vec3 vT1;',
      'varying vec3 vT2;',
      'void main(){',
      // 身体波动（参考稿 bend：sin(phase - u*3.25) * amp * u²，u>1 的尾鳍摆幅更大）
      '  vec3 p = position;',
      '  p.y *= aWidK;',
      '  float bend = sin(uTime * aFlapSpeed + aPhase - aBodyU * 3.25) * uBendAmp * aBodyU * aBodyU;',
      '  p.y += bend;',
      '  vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);',
      '  gl_Position = projectionMatrix * viewMatrix * wp;',
      '  vU = clamp(aBodyU, 0.0, 1.0);',
      '  vSideY = aSideY;',
      '  vFin = aFin;',
      '  vT0 = aTint0; vT1 = aTint1; vT2 = aTint2;',
      '}'
    ].join('\n');
  }

  function buildFishFragmentShader() {
    return [
      'precision highp float;',
      'uniform float uBeat;',
      'uniform float uOpacity;',
      'varying float vU;',
      'varying float vSideY;',
      'varying float vFin;',
      'varying vec3 vT0; varying vec3 vT1; varying vec3 vT2;',
      'void main(){',
      // 参考稿身体五段渐变：暗-主-亮-主-暗
      '  vec3 c;',
      '  if (vU < 0.22) c = mix(vT0, vT1, vU / 0.22);',
      '  else if (vU < 0.49) c = mix(vT1, vT2, (vU - 0.22) / 0.27);',
      '  else if (vU < 0.72) c = mix(vT2, vT1, (vU - 0.49) / 0.23);',
      '  else c = mix(vT1, vT0, (vU - 0.72) / 0.28);',
      // 背亮腹暗（参考稿 shade 上下渐变）；鳍略暗
      '  c *= 1.0 + vSideY * 0.16;',
      '  c *= mix(1.0, 0.86, vFin);',
      // 鼓点闪光（减半防过曝：银白板 + 中心重叠区容易推到全白）
      '  c += c * uBeat * 0.16;',
      '  gl_FragColor = vec4(c * uOpacity, 1.0);',
      '}'
    ].join('\n');
  }

  /** 初始化鱼群状态（参考稿 makeFish：depth 层次 + 色板/体型随机） */
  function initFishes() {
    state.fishes = [];
    for (var i = 0; i < COUNT; i++) {
      var depth = rnd(i * 17.3);
      var pal = PALETTES[Math.floor(rnd(i * 7.7) * PALETTES.length) % PALETTES.length];
      var sp = SPECIES[Math.floor(rnd(i * 11.1) * SPECIES.length) % SPECIES.length];
      var spLen = lerp(sp.lenK[0], sp.lenK[1], rnd(i * 5.3));
      var t0 = hex2rgb(pal[1]), t1 = hex2rgb(pal[0]), t2 = hex2rgb(pal[2]);
      var dim = 0.45 + depth * 0.55;   // depth 层次：远暗近亮
      state.fishes.push({
        // 初始即全屏均匀铺开（切入立见分散鱼群；强阻尼下从收缩到力学平衡要数分钟）
        x: (rnd(i * 3.3) - 0.5) * SPAN_X * 1.7,
        y: (rnd(i * 2.7) - 0.5) * SPAN_Y * 1.7,
        z: (depth - 0.5) * 1.0,   // 压扁到贴屏平面附近（3D 深度投影必然重叠，参考稿是纯 2D）
        vx: (rnd(i * 9.1) - 0.5) * 1.2 * K,
        vy: (rnd(i * 4.1) - 0.5) * 0.6 * K,
        ix: 0, iy: 0,
        angle: rnd(i * 13.7) * Math.PI * 2,
        len: (0.45 + depth * 0.5) * spLen,          // 世界单位全长（屏宽 3~7%）
        widK: sp.body * lerp(0.88, 1.12, rnd(i * 6.7)) / 0.27,
        depth: depth,
        speed: (0.62 + depth * 1.05) * K,           // units/frame
        swim: 1.1 + rnd(i * 8.3) * 1.3,
        phase: rnd(i * 15.1) * Math.PI * 2,
        wp: rnd(i * 2.9) * Math.PI * 2,
        ws: 0.16 + rnd(i * 12.3) * 0.34
      });
      var f = state.fishes[state.fishes.length - 1];
      f.t0 = [t0[0] * dim, t0[1] * dim, t0[2] * dim];
      f.t1 = [t1[0] * dim, t1[1] * dim, t1[2] * dim];
      f.t2 = [t2[0] * dim, t2[1] * dim, t2[2] * dim];
    }
  }

  function ensureLayer(scene) {
    if (state.initialized) return;
    state.scene = scene;

    var unit = buildFishUnit();
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(unit.position, 3));
    geo.setAttribute('aBodyU', new THREE.BufferAttribute(unit.bodyU, 1));
    geo.setAttribute('aSideY', new THREE.BufferAttribute(unit.sideY, 1));
    geo.setAttribute('aFin', new THREE.BufferAttribute(unit.fin, 1));
    geo.setIndex(new THREE.BufferAttribute(unit.index, 1));

    var mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uBendAmp: { value: 0.026 },
        uBeat: { value: 0 },
        uOpacity: { value: 0 }
      },
      vertexShader: buildFishVertexShader(),
      fragmentShader: buildFishFragmentShader(),
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: true,
      depthTest: true
    });

    var mesh = new THREE.InstancedMesh(geo, mat, COUNT);
    mesh.frustumCulled = false;

    var t0Arr = new Float32Array(COUNT * 3);
    var t1Arr = new Float32Array(COUNT * 3);
    var t2Arr = new Float32Array(COUNT * 3);
    var phaseArr = new Float32Array(COUNT);
    var flapArr = new Float32Array(COUNT);
    var widArr = new Float32Array(COUNT);

    initFishes();
    state.dummy = new THREE.Object3D();
    for (var i = 0; i < COUNT; i++) {
      var f = state.fishes[i];
      state.dummy.position.set(f.x, f.y, f.z);
      state.dummy.rotation.set(0, 0, f.angle);
      state.dummy.scale.setScalar(f.len);
      state.dummy.updateMatrix();
      mesh.setMatrixAt(i, state.dummy.matrix);
      t0Arr[i * 3] = f.t0[0]; t0Arr[i * 3 + 1] = f.t0[1]; t0Arr[i * 3 + 2] = f.t0[2];
      t1Arr[i * 3] = f.t1[0]; t1Arr[i * 3 + 1] = f.t1[1]; t1Arr[i * 3 + 2] = f.t1[2];
      t2Arr[i * 3] = f.t2[0]; t2Arr[i * 3 + 1] = f.t2[1]; t2Arr[i * 3 + 2] = f.t2[2];
      phaseArr[i] = f.phase;
      flapArr[i] = 3.3 + (f.swim - 1.1) * 1.0;   // 参考稿 flap 频率 2.2+swim
      widArr[i] = f.widK;
    }
    geo.setAttribute('aTint0', new THREE.InstancedBufferAttribute(t0Arr, 3));
    geo.setAttribute('aTint1', new THREE.InstancedBufferAttribute(t1Arr, 3));
    geo.setAttribute('aTint2', new THREE.InstancedBufferAttribute(t2Arr, 3));
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phaseArr, 1));
    geo.setAttribute('aFlapSpeed', new THREE.InstancedBufferAttribute(flapArr, 1));
    geo.setAttribute('aWidK', new THREE.InstancedBufferAttribute(widArr, 1));
    mesh.instanceMatrix.needsUpdate = true;

    state.mesh = mesh;
    state.mat = mat;
    state.root = new THREE.Group();
    state.root.name = 'audio-fish-school-root';
    state.root.add(mesh);
    state.root.visible = false;
    scene.add(state.root);
    state.initialized = true;
  }

  function clearLayer() {
    if (!state.root) return;
    if (state.scene) state.scene.remove(state.root);
    if (state.mesh) {
      state.mesh.geometry.dispose();
      state.mesh.material.dispose();
    }
    state.root = null;
    state.mesh = null;
    state.mat = null;
    state.initialized = false;
    state.opacity = 0;
  }

  function isActive(fx) {
    return !!(fx && Number(fx.preset) === INDEX);
  }

  function smoothAudio(a, dt) {
    var k = Math.min(1, dt * 60 * 0.18);
    var s = state.smooth;
    s.bass += (a.bass - s.bass) * k;
    s.beat += (a.beat - s.beat) * Math.min(1, dt * 60 * 0.4);
    return s;
  }

  /**
   * 鱼群积分（参考稿 updateFish 逐行移植，px→世界单位换算）：
   * 群中心向心力 + wander + 局部分离 + 软边界 + 速度上限 + 朝向跟随。
   * 分离只在 XY 平面做（z 是 depth 层，独立不推挤）。
   */
  function integrate(dt, audio) {
    state.schoolPhase += dt * 0.16;
    var ph = state.schoolPhase;
    // 群中心缓慢漂移（参考稿：绕光柱中心 ±W*0.17/±H*0.16 → 世界 ±2.4/±2.2）
    var cx = Math.sin(ph * 0.85) * 2.36 + Math.sin(ph * 0.33 + 1.4) * 1.11;
    var cy = Math.cos(ph * 0.66) * 2.13;
    var sepR = SEP_R * (1 + audio.beat * 0.8);       // 鼓点：分离半径炸大
    var step = Math.min(dt * 60, 2.5);
    var damp = Math.pow(0.978, step);   // 参考稿 0.966 偏黏：分离冲量推不动鱼、群会塌缩
    var dampI = Math.pow(0.94, step);
    var m = 0.48;                                     // 软边界（参考稿 66px）

    for (var i = 0; i < state.fishes.length; i++) {
      var f = state.fishes[i];
      // 巡游圈软墙（替代参考稿的全局向心力——全局向心会把鱼群压成一团，
      // 分离力是局部的顶不住；改为只在鱼游出巡游圈时拉回，圈内完全自由+分离防叠）
      var dcx = cx - f.x, dcy = cy - f.y;
      var dc = Math.hypot(dcx, dcy);
      var CRUISE_R = 4.5;
      if (dc > CRUISE_R) {
        // 拉力系数取小：稳态速度落在 maxS 量级即被限速平滑接管（过大会过冲震荡）
        var pull = (dc - CRUISE_R) * 0.0004;
        ax += dcx / dc * pull; ay += dcy / dc * pull;
      }
      // 个体 wander（参考稿原式，绝对力 ×K）
      f.wp += f.ws * dt;
      ax += Math.sin(f.wp * 1.13 + f.phase) * 0.032 * K;
      ay += Math.cos(f.wp * 0.87 + f.phase * 1.3) * 0.026 * K;
      // 局部分离（O(n²)；XY 平面；贴屏 2D 口径下分离充分作用）
      for (var j = 0; j < state.fishes.length; j++) {
        if (j === i) continue;
        var g = state.fishes[j];
        var dx = f.x - g.x, dy = f.y - g.y, d2 = dx * dx + dy * dy, R = sepR;
        if (d2 < R * R && d2 > 0.0001) {
          var d = Math.sqrt(d2), p = (1 - d / R) * 0.25 * K;
          ax += dx / d * p; ay += dy / d * p;
        }
      }
      // impulse 衰减 + 注入（参考稿保留衰减；本项目用鼓点注入「惊散」脉冲）
      f.ix *= dampI; f.iy *= dampI;
      if (audio.beat > 0.6 && f.beatKick !== true) {
        var ka = rnd(i * 31.7 + Math.floor(state.time * 2)) * Math.PI * 2;
        f.ix += Math.cos(ka) * 0.02 * K;
        f.iy += Math.sin(ka) * 0.02 * K;
        f.beatKick = true;
      } else if (audio.beat <= 0.6) {
        f.beatKick = false;
      }
      ax += f.ix; ay += f.iy;
      // 软边界
      if (f.x < -m) ax += (-m - f.x) * 0.0024; if (f.x > m) ax -= (f.x - m) * 0.0024;
      if (f.y < -m) ay += (-m - f.y) * 0.0024; if (f.y > m) ay -= (f.y - m) * 0.0024;
      // 积分 + 阻尼 + 速度上限
      f.vx += ax * step; f.vy += ay * step;
      f.vx *= damp; f.vy *= damp;
      var sp2 = Math.hypot(f.vx, f.vy), maxS = f.speed * (1 + audio.bass * 0.5);
      if (sp2 > maxS) { f.vx = f.vx / sp2 * maxS; f.vy = f.vy / sp2 * maxS; }
      f.x += f.vx * step; f.y += f.vy * step;
      // 朝向：头平滑转向速度方向（参考稿 dt*3.4）
      var spd = Math.hypot(f.vx, f.vy);
      if (spd > 0.05 * K) {
        var ta = Math.atan2(f.vy, f.vx);
        var df = ta - f.angle;
        while (df > Math.PI) df -= Math.PI * 2;
        while (df < -Math.PI) df += Math.PI * 2;
        f.angle += df * Math.min(1, dt * 3.4);
      }
    }
  }

  function update(dt, ctx) {
    ctx = ctx || {};
    var fx = ctx.fx || {};
    var scene = ctx.scene;
    if (!scene) return;

    var active = isActive(fx);
    // 切走立即消失（同蝶群口径）；切入 opacity 从 0 淡入
    if (!active) {
      if (state.initialized) clearLayer();
      return;
    }
    state.opacity += (1 - state.opacity) * Math.min(1, dt * 3.0);

    ensureLayer(scene);
    if (!state.root) return;

    state.time += dt;
    var audio = smoothAudio({ bass: clamp01(ctx.audio && ctx.audio.bass), beat: clamp01(ctx.audio && ctx.audio.beat) }, dt);

    integrate(dt, audio);

    var u = state.mat.uniforms;
    u.uTime.value = state.time;
    u.uOpacity.value = state.opacity;   // 淡入淡出（漏写会让整群鱼乘 0 隐形）
    u.uBendAmp.value = 0.026 * (1 + audio.bass * 0.8);   // bass：摆尾更有力
    u.uBeat.value = audio.beat;

    var dummy = state.dummy;
    for (var i = 0; i < state.fishes.length; i++) {
      var f = state.fishes[i];
      dummy.position.set(f.x, f.y, f.z);
      dummy.rotation.set(0, 0, f.angle);   // 侧视贴屏，头朝速度方向
      dummy.scale.setScalar(f.len);
      dummy.updateMatrix();
      state.mesh.setMatrixAt(i, dummy.matrix);
    }
    state.mesh.instanceMatrix.needsUpdate = true;

    state.root.visible = state.opacity > 0.02;
  }

  function onPresetChange(prev, next, ctx) {
    // 切走：立即清场交给 update（对齐蝶群口径）；切入：重建并淡入
    if (Number(next) === INDEX && ctx && ctx.scene) {
      if (state.initialized) clearLayer();
      ensureLayer(ctx.scene);
      state.root.visible = true;
    }
  }

  global.MineradioAudioFishSchool = {
    INDEX: INDEX,
    isActive: isActive,
    update: update,
    clear: clearLayer,
    onPresetChange: onPresetChange,
    /** 调试/验证出口 */
    getFishes: function () { return state.fishes; },
    getStatus: function () {
      return {
        initialized: state.initialized,
        visible: !!(state.root && state.root.visible),
        opacity: Number(state.opacity.toFixed(3))
      };
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
