/**
 * 声波球壳 (Pulse Orb) — 预设 20
 *
 * 与音浪环阵 / 音浪隧道同一套几何体渲染（InstancedMesh + 顶点位移 + 端面/侧面分离着色），
 * 形态是经纬球面上长满朝外的尖刺：赤道吃低频（整体隆起），极区吃高频（尖刺闪烁），
 * 上半球冷蓝、下半球暖橙，随鼓点整体呼吸。
 */
(function (global) {
  'use strict';

  var INDEX = 20;

  var LAT = 24;              // 纬度行数
  var LON = 48;              // 经度列数
  var ORB_R = 3.40;          // 球半径
  var THETA_MIN = 0.10;      // 纬度范围（×π），避开极点堆积
  var THETA_MAX = 0.90;
  var SPIKE_W = 0.155;
  var MAX_SPIKE = 1.90;

  var state = {
    root: null,
    shell: null,
    shellMat: null,
    scene: null,
    opacity: 0,
    initialized: false,
    time: 0,
    spin: 0,
    pulse: 0,
    lastBeat: false,
    dummyMat: null,
    dummyPos: null,
    dummyQuat: null,
    dummyScale: null,
    upAxis: null,
    upFrom: null,
    smooth: { bass: 0, mid: 0, treble: 0, beat: 0, energy: 0 }
  };

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function clamp01(v) { return clamp(Number.isFinite(v) ? v : 0, 0, 1); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function buildShellVertexShader() {
    return [
      'precision highp float;',
      'uniform float uTime;',
      'uniform float uBass;',
      'uniform float uMid;',
      'uniform float uTreble;',
      'uniform float uBeat;',
      'uniform float uPulse;',
      'varying vec3 vCol;',
      'varying float vSpike;',
      'varying float vRelY;',
      'varying vec3 vNormalL;',
      'varying float vLat;',
      'void main(){',
      '  vNormalL = normal;',
      // 实例中心就在球面上，方向即法线
      '  vec4 ipos = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);',
      '  vec3 nrm = normalize(ipos.xyz);',
      '  float polar = abs(nrm.y);',                    // 0 赤道 → 1 极点
      '  float lon = atan(nrm.z, nrm.x);',
      '  float latNorm = clamp(nrm.y * 0.5 + 0.5, 0.0, 1.0);',  // 0 南极 → 1 北极
      '  vLat = latNorm;',
      '  float seed = fract(sin(dot(ipos.xyz, vec3(12.9898, 78.233, 37.719))) * 43758.5453);',
      // 沿经度传播的波
      '  float waveLon = sin(lon * 3.0 - uTime * 1.55) * 0.5 + 0.5;',
      '  float waveLon2 = sin(lon * 7.0 + uTime * 2.35) * 0.5 + 0.5;',
      '  float waveLat = sin(latNorm * 9.0 - uTime * 1.10) * 0.5 + 0.5;',
      '  float belt = 1.0 - polar;',                    // 赤道权重
      '  float h = 0.06 + waveLat * 0.10 + seed * 0.04;',
      // 低频：赤道整圈隆起
      '  h += uBass * belt * (waveLon * 0.85 + 0.35) * 2.00;',
      // 高频：极区尖刺
      '  h += uTreble * polar * pow(waveLon2, 3.0) * 1.70;',
      // 中频：纬度方向的波纹
      '  h += uMid * waveLat * 0.48;',
      // 鼓点：整体外扩
      '  h += uBeat * (0.35 + belt * 0.40) + uPulse * 0.30;',
      '  h = clamp(h, 0.04, ' + MAX_SPIKE.toFixed(2) + ');',
      '  vSpike = h;',
      // 冷暖分区：下半球暖橙，上半球冷蓝
      '  vec3 lowC = vec3(1.00, 0.40, 0.13);',
      '  vec3 highC = vec3(0.20, 0.64, 1.00);',
      '  vec3 baseCol = mix(lowC, highC, smoothstep(0.15, 0.85, latNorm));',
      '  float hot = clamp(h / ' + MAX_SPIKE.toFixed(2) + ', 0.0, 1.0);',
      '  vCol = mix(baseCol, mix(baseCol, vec3(1.0, 0.95, 0.86), 0.62), hot * hot);',
      '  float yRel = position.y + 0.5;',
      '  vRelY = yRel;',
      '  vec3 p = position;',
      '  p.y = -0.5 + yRel * h;',
      '  vec4 world = modelMatrix * instanceMatrix * vec4(p, 1.0);',
      '  gl_Position = projectionMatrix * viewMatrix * world;',
      '}'
    ].join('\n');
  }

  function buildShellFragmentShader() {
    return [
      'precision highp float;',
      'varying vec3 vCol;',
      'varying float vSpike;',
      'varying float vRelY;',
      'varying vec3 vNormalL;',
      'varying float vLat;',
      'void main(){',
      // local +y 朝球外，+y 面就是尖刺的外端面
      '  bool isTip = vNormalL.y > 0.5;',
      '  float hot = clamp(vSpike / ' + MAX_SPIKE.toFixed(2) + ', 0.0, 1.0);',
      '  vec3 col;',
      '  if (isTip) {',
      '    col = vCol * (0.78 + hot * 1.45);',
      // 端面四周描边，让每根尖刺的轮廓立起来
      '    float ex = smoothstep(0.12, 0.0, abs(vRelY - 0.5) * 2.0);',
      '    col += vCol * ex * 0.25;',
      '  } else {',
      // 侧面：根部近黑、尖端亮
      '    float grad = mix(0.05, 0.46, pow(vRelY, 1.30));',
      '    col = vCol * grad * (0.62 + hot * 1.00);',
      '    col += vCol * smoothstep(0.86, 1.0, vRelY) * 0.60;',
      '  }',
      '  gl_FragColor = vec4(col, 1.0);',
      '}'
    ].join('\n');
  }

  function buildShell() {
    var total = LAT * LON;
    var geo = new THREE.BoxGeometry(SPIKE_W, 1, SPIKE_W);
    var mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uBass: { value: 0 },
        uMid: { value: 0 },
        uTreble: { value: 0 },
        uBeat: { value: 0 },
        uPulse: { value: 0 }
      },
      vertexShader: buildShellVertexShader(),
      fragmentShader: buildShellFragmentShader(),
      transparent: false,
      depthWrite: true,
      depthTest: true
    });

    var mesh = new THREE.InstancedMesh(geo, mat, total);
    mesh.frustumCulled = false;

    var n = 0;
    for (var i = 0; i < LAT; i++) {
      // theta 用等面积分布，避免极区方块堆积成一块白斑
      var u = (i + 0.5) / LAT;
      var theta = Math.acos(1 - 2 * u);
      // 映射到 [THETA_MIN, THETA_MAX]·π，跳过极点
      theta = THETA_MIN * Math.PI + theta * (THETA_MAX - THETA_MIN) * Math.PI;
      var sinT = Math.sin(theta);
      var cosT = Math.cos(theta);
      for (var j = 0; j < LON; j++) {
        var phi = (j / LON) * Math.PI * 2;
        var nx = sinT * Math.cos(phi);
        var ny = cosT;
        var nz = sinT * Math.sin(phi);
        state.dummyPos.set(nx * ORB_R, ny * ORB_R, nz * ORB_R);
        state.upAxis.set(nx, ny, nz);
        state.dummyQuat.setFromUnitVectors(state.upFrom, state.upAxis);
        state.dummyScale.set(1, 1, 1);
        state.dummyMat.compose(state.dummyPos, state.dummyQuat, state.dummyScale);
        mesh.setMatrixAt(n++, state.dummyMat);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  }

  function ensureLayer(scene) {
    if (state.initialized) return;
    state.scene = scene;
    state.dummyPos = new THREE.Vector3();
    state.dummyQuat = new THREE.Quaternion();
    state.dummyScale = new THREE.Vector3();
    state.dummyMat = new THREE.Matrix4();
    state.upAxis = new THREE.Vector3();
    state.upFrom = new THREE.Vector3(0, 1, 0);

    state.root = new THREE.Group();
    state.root.name = 'audio-orb-root';
    state.root.position.set(0, 0, 0);

    state.shell = buildShell();
    state.shellMat = state.shell.material;
    state.root.add(state.shell);

    state.root.visible = false;
    scene.add(state.root);
    state.initialized = true;
  }

  function clearLayer() {
    if (!state.root) return;
    if (state.scene) state.scene.remove(state.root);
    if (state.shell) { state.shell.geometry.dispose(); state.shell.material.dispose(); }
    state.root = null;
    state.shell = null;
    state.shellMat = null;
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
    state.opacity += ((active ? 1 : 0) - state.opacity) * Math.min(1, dt * (active ? 3.2 : 2.4));
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

    state.spin += dt * lerp(0.06, 0.30, clamp01((fx.speed || 1) / 2));
    var rot = ctx.visualRotation;
    state.root.rotation.y = state.spin +
      (rot && Number.isFinite(Number(rot.y)) ? Number(rot.y) * 0.45 : 0);
    if (rot && Number.isFinite(Number(rot.x))) state.root.rotation.x = Number(rot.x) * 0.45;

    var u = state.shellMat.uniforms;
    u.uTime.value = state.time;
    u.uBass.value = audio.bass;
    u.uMid.value = audio.mid;
    u.uTreble.value = audio.treble;
    u.uBeat.value = audio.beat;
    u.uPulse.value = state.pulse;

    // 整体呼吸：鼓点时球体轻轻胀大
    var breathe = 0.94 + 0.06 * state.opacity + state.pulse * 0.06 + audio.bass * 0.04;
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

  global.MineradioAudioOrb = {
    INDEX: INDEX,
    isActive: isActive,
    update: update,
    clear: clearLayer,
    onPresetChange: onPresetChange
  };
})(typeof window !== 'undefined' ? window : globalThis);
