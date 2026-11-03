/**
 * 音浪环阵 (Audio Ring) — 预设 18
 *
 * 渲染思路沿用「音域回响 Sonic-Topography」那一套：
 *   InstancedMesh 实心几何体 + 顶点高度位移 + 顶面/侧面分离着色。
 * 区别在形态：音域回响是平面方阵地形，这里是三层同心环形柱阵。
 *
 * 结构分层：
 *   1) 柱阵       3 环 × (72 / 96 / 120) 根，共 288 实例
 *   2) 中心核心   圆盘 + 同心涟漪，随低频脉冲
 *   3) 地面光环   3 条细环带，随音频呼吸
 *   4) 顶部辉光   环阵正上方一层加法混合光斑
 *
 * 音频映射：内环响应 bass、外环响应 treble，中频驱动沿环传播的行波。
 */
(function (global) {
  'use strict';

  var INDEX = 18;

  // 三环定义：半径 / 柱数 / 高度权重 / 冷暖插值位置
  var RINGS = [
    { radius: 2.05, count: 72, hMul: 1.00, warm: 0.00 },
    { radius: 3.45, count: 96, hMul: 0.82, warm: 0.55 },
    { radius: 5.00, count: 120, hMul: 0.66, warm: 1.00 }
  ];
  var RING_INNER_R = 2.05;
  var RING_OUTER_R = 5.00;
  var BAR_W = 0.155;
  var CORE_RADIUS = 1.75;
  var MAX_HEIGHT = 2.30;

  var state = {
    root: null,
    bars: null,
    barsMat: null,
    ground: null,
    groundMat: null,
    core: null,
    coreMat: null,
    halo: null,
    haloMat: null,
    scene: null,
    opacity: 0,
    initialized: false,
    time: 0,
    yaw: 0,
    pulse: 0,
    lastBeat: false,
    dummyMat: null,
    dummyPos: null,
    dummyQuat: null,
    dummyScale: null,
    smooth: { bass: 0, mid: 0, treble: 0, beat: 0, energy: 0 }
  };

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function clamp01(v) { return clamp(Number.isFinite(v) ? v : 0, 0, 1); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // ---------------------------------------------------------------
  //  着色器
  // ---------------------------------------------------------------

  function buildBarVertexShader() {
    return [
      'precision highp float;',
      'uniform float uTime;',
      'uniform float uBass;',
      'uniform float uMid;',
      'uniform float uTreble;',
      'uniform float uBeat;',
      'uniform float uEnergy;',
      'uniform float uCore;',
      'varying vec3 vCol;',
      'varying float vHeight;',
      'varying float vRelY;',
      'varying vec3 vNormalV;',
      'varying vec2 vUvV;',
      'float hash11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }',
      'void main(){',
      '  vNormalV = normal;',
      '  vUvV = uv;',
      // 实例中心（仅平移，无旋转）→ 用极坐标取半径和角度
      '  vec4 ipos = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);',
      '  vec2 pos2D = ipos.xz;',
      '  float ringR = length(pos2D);',
      '  float ang = atan(pos2D.y, pos2D.x);',
      '  float ringNorm = clamp((ringR - ' + RING_INNER_R.toFixed(2) + ') / ' + (RING_OUTER_R - RING_INNER_R).toFixed(2) + ', 0.0, 1.0);',
      '  float seed = hash11(ringR * 131.0 + ang * 57.0);',
      // 沿环传播的行波：中频驱动，速度随半径变化形成"外圈慢、内圈快"的差速感
      '  float waveSpeed = mix(2.30, 1.35, ringNorm);',
      '  float wave = sin(ang * 5.0 - uTime * waveSpeed + ringR * 0.85) * 0.5 + 0.5;',
      '  float wave2 = sin(ang * 11.0 + uTime * (1.10 + ringNorm * 0.35) - ringR * 1.7) * 0.5 + 0.5;',
      '  float wave3 = sin(ang * 2.0 - uTime * 0.62 + seed * 6.28) * 0.5 + 0.5;',
      // 基础层：柱子本身保持稳定高度，不做无音频时的一潭死水
      '  float baseH = 0.10 + wave * 0.16 + wave3 * 0.07;',
      // 低频：内环暴涨（近场冲击），外环衰减
      '  float bassGain = mix(1.85, 0.42, ringNorm);',
      '  float bassH = uBass * bassGain * (wave * 1.30 + wave3 * 0.55);',
      // 高频：外环尖刺闪烁，内环克制
      '  float trebGain = mix(0.18, 1.55, ringNorm);',
      '  float trebH = uTreble * trebGain * pow(wave2, 3.0) * 1.55;',
      // 中频：行波主体
      '  float midH = uMid * mix(0.72, 1.05, ringNorm) * wave2 * 0.62;',
      // 鼓点：整体上冲，内环更明显
      '  float beatH = uBeat * mix(0.85, 0.40, ringNorm) * (0.55 + wave3 * 0.65);',
      '  float h = baseH + bassH + trebH + midH + beatH;',
      // 中心核心脉冲时，整环被"点亮"抬高一点
      '  h += uCore * mix(0.30, 0.10, ringNorm);',
      '  h = clamp(h, 0.04, ' + MAX_HEIGHT.toFixed(2) + ');',
      // 冷 → 暖：内环冰蓝，外环暖橙；高度越高越亮（偏白热）
      '  vec3 coolC = vec3(0.10, 0.52, 1.00);',
      '  vec3 warmC = vec3(1.00, 0.42, 0.10);',
      '  vec3 baseCol = mix(coolC, warmC, ringNorm * ringNorm);',
      '  float hot = clamp(h / ' + MAX_HEIGHT.toFixed(2) + ', 0.0, 1.0);',
      '  vCol = mix(baseCol, mix(baseCol, vec3(1.0, 0.92, 0.78), 0.55), hot * hot);',
      '  vHeight = h;',
      '  float yRel = position.y + 0.5;',
      '  vRelY = yRel;',
      '  vec3 p = position;',
      '  p.y = -0.5 + yRel * h;',
      '  vec4 world = modelMatrix * instanceMatrix * vec4(p, 1.0);',
      '  gl_Position = projectionMatrix * viewMatrix * world;',
      '}'
    ].join('\n');
  }

  function buildBarFragmentShader() {
    return [
      'precision highp float;',
      'varying vec3 vCol;',
      'varying float vHeight;',
      'varying float vRelY;',
      'varying vec3 vNormalV;',
      'varying vec2 vUvV;',
      'void main(){',
      '  bool isTop = vNormalV.y > 0.5;',
      '  float hot = clamp(vHeight / ' + MAX_HEIGHT.toFixed(2) + ', 0.0, 1.0);',
      '  vec3 col;',
      '  if (isTop) {',
      // 顶面：高度越高越亮，形成"发光帽"
      '    col = vCol * (0.62 + hot * 1.25);',
      // 顶面四周描边，让每根柱子轮廓立起来
      '    float ex = smoothstep(0.10, 0.0, vUvV.x) + smoothstep(0.90, 1.0, vUvV.x);',
      '    float ez = smoothstep(0.10, 0.0, vUvV.y) + smoothstep(0.90, 1.0, vUvV.y);',
      '    col += vCol * clamp(ex + ez, 0.0, 1.0) * 0.62;',
      '  } else {',
      // 侧面：底部近黑、顶部亮，柱子才有体积
      '    float grad = mix(0.05, 0.44, pow(vRelY, 1.35));',
      '    col = vCol * grad * (0.55 + hot * 0.95);',
      // 柱顶一条亮线，强化高度台阶
      '    col += vCol * smoothstep(0.82, 1.0, vRelY) * 0.58;',
      '  }',
      '  gl_FragColor = vec4(col, 1.0);',
      '}'
    ].join('\n');
  }

  // 中心核心：径向渐变 + 向外扩散的同心涟漪
  function buildCoreVertexShader() {
    return [
      'precision highp float;',
      'varying vec2 vUvC;',
      'void main(){',
      '  vUvC = uv;',
      '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
      '}'
    ].join('\n');
  }

  function buildCoreFragmentShader() {
    return [
      'precision highp float;',
      'uniform float uTime;',
      'uniform float uBass;',
      'uniform float uBeat;',
      'uniform float uPulse;',
      'uniform float uOpacity;',
      'varying vec2 vUvC;',
      'void main(){',
      '  vec2 p = vUvC * 2.0 - 1.0;',
      '  float d = length(p);',
      '  if (d > 1.0) discard;',
      // 中心实心热核
      '  float core = pow(max(0.0, 1.0 - d), 3.2);',
      // 三道向外扩散的环
      '  float rings = 0.0;',
      '  for (int i = 0; i < 3; i++) {',
      '    float ph = fract(uTime * 0.55 + float(i) * 0.3333);',
      '    float rr = ph * 1.05;',
      '    float w = 0.055 + 0.02 * (1.0 - ph);',
      '    float t = (d - rr) / w;',
      '    float band = exp(-t * t);',
      '    rings += band * (1.0 - ph) * (0.55 + uBass * 0.85);',
      '  }',
      '  vec3 hot = vec3(1.0, 0.86, 0.62);',
      '  vec3 cool = vec3(0.16, 0.62, 1.0);',
      '  vec3 col = mix(cool, hot, clamp(core * 1.5 + uPulse * 0.35, 0.0, 1.0));',
      '  float a = core * (0.85 + uPulse * 0.9) + rings * 0.42;',
      '  a *= smoothstep(1.0, 0.86, d);',
      '  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0) * uOpacity);',
      '}'
    ].join('\n');
  }

  // 地面光池：给环阵一个落地的光源，同时填补中心黑洞
  function buildGroundGlow() {
    var geo = new THREE.CircleGeometry(9.2, 64);
    geo.rotateX(-Math.PI / 2);
    var mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uBass: { value: 0 },
        uBeat: { value: 0 },
        uOpacity: { value: 1 }
      },
      vertexShader: buildCoreVertexShader(),
      fragmentShader: [
        'precision highp float;',
        'uniform float uTime;',
        'uniform float uBass;',
        'uniform float uBeat;',
        'uniform float uOpacity;',
        'varying vec2 vUvC;',
        'void main(){',
        '  vec2 p = vUvC * 2.0 - 1.0;',
        '  float d = length(p);',
        '  if (d > 1.0) discard;',
        '  float pool = pow(max(0.0, 1.0 - d), 2.6);',
        '  float breathe = 0.62 + 0.38 * sin(d * 9.0 - uTime * 1.1);',
        '  float a = pool * (0.34 + uBass * 0.30 + uBeat * 0.10) * breathe;',
        '  vec3 inner = vec3(0.30, 0.72, 1.00);',
        '  vec3 outer = vec3(1.00, 0.50, 0.16);',
        '  vec3 col = mix(inner, outer, smoothstep(0.15, 0.95, d));',
        '  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0) * uOpacity * 0.85);',
        '}'
      ].join('\n'),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    return new THREE.Mesh(geo, mat);
  }

  // 地面光环：一圈薄环，亮度随音频呼吸
  function buildHaloFragmentShader() {
    return [
      'precision highp float;',
      'uniform float uTime;',
      'uniform float uBeat;',
      'uniform float uOpacity;',
      'varying vec2 vUvC;',
      'void main(){',
      '  float shift = 0.55 + 0.45 * sin(vUvC.x * 18.849556 - uTime * 2.2);',
      '  float a = (0.16 + uBeat * 0.42) * shift;',
      '  vec3 col = mix(vec3(0.16, 0.60, 1.0), vec3(1.0, 0.55, 0.18), vUvC.y);',
      '  gl_FragColor = vec4(col, a * uOpacity);',
      '}'
    ].join('\n');
  }

  function buildHaloVertexShader() {
    return [
      'precision highp float;',
      'varying vec2 vUvC;',
      'void main(){',
      '  vUvC = uv;',
      '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
      '}'
    ].join('\n');
  }

  // ---------------------------------------------------------------
  //  构建
  // ---------------------------------------------------------------

  function buildBars() {
    var total = 0;
    for (var i = 0; i < RINGS.length; i++) total += RINGS[i].count;

    var geo = new THREE.BoxGeometry(BAR_W, 1, BAR_W);
    var mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uBass: { value: 0 },
        uMid: { value: 0 },
        uTreble: { value: 0 },
        uBeat: { value: 0 },
        uEnergy: { value: 0 },
        uCore: { value: 0 }
      },
      vertexShader: buildBarVertexShader(),
      fragmentShader: buildBarFragmentShader(),
      transparent: false,
      depthWrite: true,
      depthTest: true
    });

    var mesh = new THREE.InstancedMesh(geo, mat, total);
    mesh.frustumCulled = false;

    var n = 0;
    for (var r = 0; r < RINGS.length; r++) {
      var ring = RINGS[r];
      for (var k = 0; k < ring.count; k++) {
        var ang = (k / ring.count) * Math.PI * 2;
        state.dummyPos.set(Math.cos(ang) * ring.radius, 0.5, Math.sin(ang) * ring.radius);
        state.dummyQuat.identity();
        state.dummyScale.set(1, 1, 1);
        state.dummyMat.compose(state.dummyPos, state.dummyQuat, state.dummyScale);
        mesh.setMatrixAt(n++, state.dummyMat);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }

  function buildCore() {
    var geo = new THREE.CircleGeometry(CORE_RADIUS, 64);
    geo.rotateX(-Math.PI / 2);
    var mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uBass: { value: 0 },
        uBeat: { value: 0 },
        uPulse: { value: 0 },
        uOpacity: { value: 1 }
      },
      vertexShader: buildCoreVertexShader(),
      fragmentShader: buildCoreFragmentShader(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    return new THREE.Mesh(geo, mat);
  }

  function buildHalo() {
    var group = new THREE.Group();
    var radii = [
      { inner: 2.02, outer: 2.16, warm: 0.0 },
      { inner: 3.42, outer: 3.56, warm: 0.5 },
      { inner: 4.96, outer: 5.12, warm: 1.0 }
    ];
    var mats = [];
    for (var i = 0; i < radii.length; i++) {
      var g = new THREE.RingGeometry(radii[i].inner, radii[i].outer, 128, 1);
      g.rotateX(-Math.PI / 2);
      var uv = g.attributes.uv;
      var cols = new Float32Array(uv.count);
      for (var v = 0; v < uv.count; v++) cols[v] = radii[i].warm;
      g.setAttribute('aWarm', new THREE.BufferAttribute(cols, 1));
      var m = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uBeat: { value: 0 },
          uOpacity: { value: 1 }
        },
        vertexShader: [
          'precision highp float;',
          'attribute float aWarm;',
          'varying vec2 vUvC;',
          'void main(){',
          // RingGeometry 的 uv 是笛卡尔映射，不是极坐标，这里自己用角度重算
          '  float ang = atan(position.z, position.x);',
          '  vUvC = vec2(ang / 6.2831853 + 0.5, aWarm);',
          '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
          '}'
        ].join('\n'),
        fragmentShader: buildHaloFragmentShader(),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide
      });
      mats.push(m);
      group.add(new THREE.Mesh(g, m));
    }
    group.userData.mats = mats;
    return group;
  }

  function ensureLayer(scene) {
    if (state.initialized) return;
    state.scene = scene;
    state.dummyPos = new THREE.Vector3();
    state.dummyQuat = new THREE.Quaternion();
    state.dummyScale = new THREE.Vector3();
    state.dummyMat = new THREE.Matrix4();

    state.root = new THREE.Group();
    state.root.name = 'audio-ring-root';
    state.root.position.set(0, -1.55, 0);

    state.bars = buildBars();
    state.barsMat = state.bars.material;
    state.root.add(state.bars);

    state.ground = buildGroundGlow();
    state.ground.position.set(0, -0.52, 0);
    state.ground.renderOrder = -1;
    state.groundMat = state.ground.material;
    state.root.add(state.ground);

    state.core = buildCore();
    state.core.position.set(0, -0.48, 0);
    state.coreMat = state.core.material;
    state.root.add(state.core);

    state.halo = buildHalo();
    state.halo.position.set(0, -0.47, 0);
    state.root.add(state.halo);

    state.root.visible = false;
    scene.add(state.root);
    state.initialized = true;
  }

  function clearLayer() {
    if (!state.root) return;
    if (state.scene) state.scene.remove(state.root);
    var i;
    if (state.bars) { state.bars.geometry.dispose(); state.bars.material.dispose(); }
    if (state.ground) { state.ground.geometry.dispose(); state.ground.material.dispose(); }
    if (state.core) { state.core.geometry.dispose(); state.core.material.dispose(); }
    if (state.halo) {
      for (i = 0; i < state.halo.children.length; i++) {
        var c = state.halo.children[i];
        if (c.geometry) c.geometry.dispose();
        if (c.material) c.material.dispose();
      }
    }
    state.root = null;
    state.bars = null;
    state.ground = null;
    state.core = null;
    state.halo = null;
    state.initialized = false;
    state.opacity = 0;
  }

  // ---------------------------------------------------------------
  //  每帧
  // ---------------------------------------------------------------

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
    var rate = 14.0;
    var k = 1 - Math.exp(-rate * Math.max(0.001, dt || 1 / 60));
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
    var target = active ? 1 : 0;
    state.opacity += (target - state.opacity) * Math.min(1, dt * (active ? 3.2 : 2.4));

    if (!active && state.opacity < 0.01) {
      if (state.root) state.root.visible = false;
      return;
    }

    ensureLayer(scene);
    if (!state.root) return;

    state.time += dt;
    var audio = smoothAudio(readAudio(ctx.audio), dt);

    // 节拍脉冲：只在上升沿触发一次
    var beatOn = audio.beat > 0.55;
    if (beatOn && !state.lastBeat) state.pulse = 1.0;
    state.lastBeat = beatOn;
    state.pulse *= Math.pow(0.02, Math.max(0.001, dt));

    // 缓慢自转 + 跟随宿主旋转
    var speed = lerp(0.02, 0.16, clamp01((fx.speed || 1) / 2));
    state.yaw += dt * speed;
    var rot = ctx.visualRotation;
    state.root.rotation.y = state.yaw +
      (rot && Number.isFinite(Number(rot.y)) ? Number(rot.y) * 0.35 : 0);
    state.root.rotation.x = rot && Number.isFinite(Number(rot.x)) ? Number(rot.x) * 0.35 : 0;
    // 入场时轻微"长出来"，避免硬切
    state.root.scale.setScalar(0.88 + 0.12 * state.opacity);

    var u = state.barsMat.uniforms;
    u.uTime.value = state.time;
    u.uBass.value = audio.bass;
    u.uMid.value = audio.mid;
    u.uTreble.value = audio.treble;
    u.uBeat.value = audio.beat;
    u.uEnergy.value = audio.energy;
    u.uCore.value = state.pulse;

    var cu = state.coreMat.uniforms;
    cu.uTime.value = state.time;
    cu.uBass.value = audio.bass;
    cu.uBeat.value = audio.beat;
    cu.uPulse.value = state.pulse;
    cu.uOpacity.value = state.opacity;

    if (state.groundMat) {
      var gu = state.groundMat.uniforms;
      gu.uTime.value = state.time;
      gu.uBass.value = audio.bass;
      gu.uBeat.value = audio.beat;
      gu.uOpacity.value = state.opacity;
    }

    var mats = state.halo.userData.mats || [];
    for (var i = 0; i < mats.length; i++) {
      mats[i].uniforms.uTime.value = state.time;
      mats[i].uniforms.uBeat.value = audio.beat;
      mats[i].uniforms.uOpacity.value = state.opacity;
    }

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

  global.MineradioAudioRing = {
    INDEX: INDEX,
    isActive: isActive,
    update: update,
    clear: clearLayer,
    onPresetChange: onPresetChange
  };
})(typeof window !== 'undefined' ? window : globalThis);
