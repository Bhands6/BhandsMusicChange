/**
 * 玫瑰花瓣 (Rose Petals) — 预设 21
 *
 * 效果 = **玫瑰花瓣飘落**：约 1600 片**实体花瓣**从画面上方纷落，
 * 旋转、摇曳、飘忽落地后回到顶部循环。深红 → 玫红 → 粉的配色随机分布，
 * 瓣缘透光。
 *
 * 关键改动（对比上一版柱阵玫瑰）：
 *   - 实体不再是长方体柱：每片是一个**参数化花瓣曲面**
 *     （宽度轮廓 sin 包络 + 杯状凹陷 + 尖端外卷 + 中脉隆起），
 *     轮廓剪影天然就是花瓣 —— 不需要 alpha 遮罩，侧面看也是一片花瓣。
 *   - 运动在 CPU 逐实例更新（1600 片，每帧 1600 次 compose，开销可忽略）：
 *     下落速度随低频呼吸、鼓点脉冲整体放大，横向正弦摇曳，随机轴自转。
 *
 * 音频映射（沿用音域回响口径的「场」版）：
 *   低频 → 下落加速 + 整体尺寸呼吸；鼓点 → 脉冲（尺寸/亮度踢一脚）；
 *   高频 → 瓣尖颤动幅度；fx.speed → 自转速度。
 */
(function (global) {
  'use strict';

  var INDEX = 21;

  var COUNT = 1400;          // 花瓣数量（太密会糊成一片，单片可读性优先）
  var TOP = 3.2;             // 生成高度
  var BOTTOM = -3.3;         // 循环底线
  var X_SPAN = 3.5;          // 横向分布半径
  var Z_SPAN = 1.9;          // 纵深分布（近大远小的视差感）
  var U_SEG = 10;            // 花瓣长度分段
  var S_SEG = 8;             // 宽度分段

  var state = {
    root: null,
    mesh: null,
    mat: null,
    scene: null,
    opacity: 0,
    initialized: false,
    time: 0,
    pulse: 0,
    lastBeat: false,
    petals: null,            // 每片花瓣的运动状态
    dummy: null,
    smooth: { bass: 0, mid: 0, treble: 0, beat: 0, energy: 0 }
  };

  function clamp01(v) { return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rnd(seed) { return (Math.abs(Math.sin(seed) * 43758.5453)) % 1; }

  /**
   * 单片花瓣曲面：y ∈ [0,1] 是长度（根→尖），x ∈ [-0.5, 0.5] 是宽度。
   * 宽度轮廓用 sin 包络（根部收、中上部最宽、尖端圆钝），
   * z 方向 = 杯状凹陷 + 尖端外卷 + 中脉隆起 —— 剪影和侧影都是花瓣。
   */
  function buildPetalGeometry() {
    var cols = S_SEG + 1;
    var rows = U_SEG + 1;
    var pos = new Float32Array(cols * rows * 3);
    var uvs = new Float32Array(cols * rows * 2);
    var indices = [];
    var i, j, k = 0;

    for (i = 0; i < rows; i++) {
      var t = i / U_SEG;                               // 0 根 → 1 尖
      // 宽度轮廓：^0.8 让最宽点靠中上部，^0.42 让两端圆钝（不是尖三角）
      var halfW = Math.pow(Math.sin(Math.PI * Math.pow(t, 0.8)), 0.42) * 0.5;
      for (j = 0; j < cols; j++) {
        var s = j / S_SEG * 2 - 1;                     // -1..1
        var x = s * halfW;
        var y = t;
        // 杯状凹陷（横向）+ 尖端外卷（纵向）+ 中脉隆起（沿中线一条浅棱）
        var z = -0.38 * s * s * halfW
          + 0.20 * Math.pow(t, 2.6)
          + 0.035 * (1 - Math.abs(s)) * Math.sin(Math.PI * t) * 0.5;
        pos[k * 3] = x;
        pos[k * 3 + 1] = y;
        pos[k * 3 + 2] = z;
        uvs[k * 2] = s * 0.5 + 0.5;
        uvs[k * 2 + 1] = t;
        k++;
      }
    }
    for (i = 0; i < U_SEG; i++) {
      for (j = 0; j < S_SEG; j++) {
        var a = i * cols + j;
        var b = a + 1;
        var c = a + cols;
        var d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  function buildPetalVertexShader() {
    return [
      'precision highp float;',
      'uniform float uTime, uTreble, uPulse;',
      'attribute vec3 aColor;',
      'attribute float aPhase;',
      'varying vec3 vCol;',
      'varying vec3 vNrm;',
      'varying float vFres;',
      'varying float vTip;',
      'varying float vDepth;',
      'void main(){',
      '  float t = uv.y;',
      '  vec3 p = position;',
      // 瓣尖颤动：越靠尖端越明显，高频驱动
      '  p.z += sin(uTime * 3.1 + aPhase * 12.0) * (0.04 + uTreble * 0.14) * t * t;',
      // 鼓点：整片轻微鼓起
      '  p.z += uPulse * 0.05 * t;',
      '  vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);',
      '  vec4 mv = viewMatrix * wp;',
      '  vDepth = -mv.z;',
      '  vec3 wn = normalize(mat3(modelMatrix) * mat3(instanceMatrix[0].xyz, instanceMatrix[1].xyz, instanceMatrix[2].xyz) * normal);',
      '  vec3 vdir = normalize(cameraPosition - wp.xyz);',
      '  vFres = 1.0 - abs(dot(wn, vdir));',
      '  vNrm = wn;',
      '  vTip = t;',
      '  vCol = aColor;',
      '  gl_Position = projectionMatrix * mv;',
      '}'
    ].join('\n');
  }

  function buildPetalFragmentShader() {
    return [
      'precision highp float;',
      'varying vec3 vCol;',
      'varying vec3 vNrm;',
      'varying float vFres;',
      'varying float vTip;',
      'varying float vDepth;',
      'void main(){',
      '  vec3 n = normalize(vNrm);',
      '  if (!gl_FrontFacing) n = -n;',                 // 双面：背面翻法线
      '  float lam = max(dot(n, normalize(vec3(0.30, 0.86, 0.40))), 0.0);',
      '  float diff = 0.40 + 0.78 * lam;',
      '  vec3 col = vCol * diff;',
      // 纵深雾化：远处的瓣更暗，空间感全靠这一层
      '  col *= mix(0.52, 1.0, clamp((10.8 - vDepth) / 4.2, 0.0, 1.0));',
      // 瓣尖偏粉更亮（受光面）
      '  col = mix(col, col * 1.30 + vec3(0.22, 0.10, 0.10), vTip * 0.55);',
      // 瓣缘透光
      '  col += vCol * pow(vFres, 2.0) * 0.55;',
      '  gl_FragColor = vec4(col, 1.0);',
      '}'
    ].join('\n');
  }

  function petalColor(k) {
    // k ∈ [0,1]：0 深红 → 0.6 正红 → 1 粉
    var r = lerp(0.58, 1.00, Math.pow(k, 0.9));
    var g = lerp(0.015, 0.30, Math.pow(k, 1.6));
    var b = lerp(0.06, 0.36, Math.pow(k, 1.5));
    return [r, g, b];
  }

  /** 单片花瓣的运动状态 */
  function makePetal(seed) {
    return {
      x: (rnd(seed * 1.7) * 2 - 1) * X_SPAN,
      y: TOP - rnd(seed * 2.3) * (TOP - BOTTOM),       // 初始铺满全高
      z: (rnd(seed * 3.1) * 2 - 1) * Z_SPAN,
      speed: 0.34 + rnd(seed * 4.3) * 0.55,            // 下落速度
      swayFreq: 0.55 + rnd(seed * 5.9) * 0.9,          // 摇曳频率
      swayPhase: rnd(seed * 6.7) * Math.PI * 2,
      swayAmp: 0.10 + rnd(seed * 7.3) * 0.26,          // 摇曳幅度
      axis: new THREE.Vector3(
        rnd(seed * 8.1) - 0.5,
        rnd(seed * 9.7) - 0.5,
        rnd(seed * 10.3) - 0.5
      ).normalize(),
      angle: rnd(seed * 11.9) * Math.PI * 2,
      rotSpeed: (0.6 + rnd(seed * 12.7) * 2.0) * (rnd(seed * 13.1) > 0.5 ? 1 : -1),
      scale: 0.13 + Math.pow(rnd(seed * 14.9), 1.6) * 0.20,
      k: rnd(seed * 15.3)                              // 颜色档
    };
  }

  function respawn(p) {
    p.y = TOP + rnd(p.x * 31.7 + p.z * 7.7) * 0.5;
    p.x = (rnd(p.y * 91.3 + p.speed * 13.7) * 2 - 1) * X_SPAN;
    p.z = (rnd(p.x * 17.9 + p.speed) * 2 - 1) * Z_SPAN;
  }

  function buildPetals() {
    var geo = buildPetalGeometry();
    var mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uBass: { value: 0 },
        uPulse: { value: 0 },
        uTreble: { value: 0 }
      },
      vertexShader: buildPetalVertexShader(),
      fragmentShader: buildPetalFragmentShader(),
      side: THREE.DoubleSide,
      transparent: false,
      depthWrite: true,
      depthTest: true
    });

    var mesh = new THREE.InstancedMesh(geo, mat, COUNT);
    mesh.frustumCulled = false;

    var colors = new Float32Array(COUNT * 3);
    var phases = new Float32Array(COUNT);
    state.petals = [];

    var dummy = state.dummy;
    for (var i = 0; i < COUNT; i++) {
      var p = makePetal(i * 3.77 + 1.0);
      state.petals.push(p);

      // 初始姿态：随机朝向
      dummy.position.set(p.x, p.y, p.z);
      dummy.quaternion.setFromAxisAngle(p.axis, p.angle);
      dummy.scale.set(p.scale, p.scale, p.scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      var c = petalColor(p.k);
      colors[i * 3] = c[0]; colors[i * 3 + 1] = c[1]; colors[i * 3 + 2] = c[2];
      phases[i] = rnd(i * 2.9) * Math.PI * 2;
    }

    geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(colors, 3));
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }

  function ensureLayer(scene) {
    if (state.initialized) return;
    state.scene = scene;
    state.dummy = new THREE.Object3D();

    state.root = new THREE.Group();
    state.root.name = 'audio-rose-root';

    state.mesh = buildPetals();
    state.mat = state.mesh.material;
    state.root.add(state.mesh);

    state.root.visible = false;
    scene.add(state.root);
    state.initialized = true;
  }

  function clearLayer() {
    if (!state.root) return;
    if (state.scene) state.scene.remove(state.root);
    if (state.mesh) { state.mesh.geometry.dispose(); state.mesh.material.dispose(); }
    state.root = null;
    state.mesh = null;
    state.mat = null;
    state.petals = null;
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

    var u = state.mat.uniforms;
    u.uTime.value = state.time;
    u.uBass.value = audio.bass;
    u.uPulse.value = state.pulse;
    u.uTreble.value = audio.treble;

    // ---- 逐花瓣运动更新（CPU，1600 次 compose 可忽略）----
    var dummy = state.dummy;
    var petals = state.petals;
    var fallK = 1.0 + audio.bass * 0.65 + state.pulse * 0.35;   // 低频/鼓点 → 落得更快
    var breathe = 1.0 + audio.bass * 0.05 + state.pulse * 0.05;

    for (var i = 0; i < petals.length; i++) {
      var p = petals[i];
      p.y -= p.speed * fallK * dt;
      if (p.y < BOTTOM) respawn(p);

      var swayX = Math.sin(state.time * p.swayFreq + p.swayPhase) * p.swayAmp;
      var swayZ = Math.cos(state.time * p.swayFreq * 0.8 + p.swayPhase) * p.swayAmp * 0.6;

      p.angle += p.rotSpeed * dt * (0.7 + audio.energy * 0.8);

      dummy.position.set(p.x + swayX, p.y, p.z + swayZ);
      dummy.quaternion.setFromAxisAngle(p.axis, p.angle);
      dummy.scale.set(p.scale * breathe, p.scale * breathe, p.scale * breathe);
      dummy.updateMatrix();
      state.mesh.setMatrixAt(i, dummy.matrix);
    }
    state.mesh.instanceMatrix.needsUpdate = true;

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
