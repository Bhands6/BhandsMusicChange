/**
 * 音浪隧道 (Audio Tunnel) — 预设 19
 *
 * 与音浪环阵同源（InstancedMesh 几何体 + 顶点位移 + 顶面/侧面分离着色），
 * 但构图完全不同：环阵是水平同心环俯视，这里是把环竖起来沿 z 轴排成一条隧道，
 * 方块沿半径方向朝隧道中心伸出，低频让隧道"收窄"，高频让近处壁面闪烁。
 */
(function (global) {
  'use strict';

  var INDEX = 19;

  var RING_COUNT = 46;       // 沿 z 排列的环数
  var PER_RING = 24;         // 每环方块数
  var Z_NEAR = 3.0;          // 最近的环（靠近相机）
  var Z_FAR = -48.0;         // 最远的环
  var TUNNEL_R = 5.6;        // 隧道基础半径
  var BAR_W = 0.30;
  var MAX_HEIGHT = 2.60;

  var state = {
    root: null,
    bars: null,
    barsMat: null,
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
    smooth: { bass: 0, mid: 0, treble: 0, beat: 0, energy: 0 }
  };

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function clamp01(v) { return clamp(Number.isFinite(v) ? v : 0, 0, 1); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function buildBarVertexShader() {
    return [
      'precision highp float;',
      'uniform float uTime;',
      'uniform float uBass;',
      'uniform float uMid;',
      'uniform float uTreble;',
      'uniform float uBeat;',
      'varying vec3 vCol;',
      'varying float vHeight;',
      'varying float vRelY;',
      'varying vec3 vNormalL;',
      'varying float vNear;',
      'varying float vBand;',
      'float hash11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }',
      'void main(){',
      '  vNormalL = normal;',
      // 实例中心：xy 是环平面坐标，z 是深度
      '  vec4 ipos = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);',
      '  float radius = length(ipos.xy);',
      '  float ang = atan(ipos.y, ipos.x);',
      '  float depth = ipos.z;',
      // 0 = 最远，1 = 最近
      '  float nearF = clamp((depth - (' + Z_FAR.toFixed(1) + ')) / ' + (Z_NEAR - Z_FAR).toFixed(1) + ', 0.0, 1.0);',
      '  vNear = nearF;',
      // 沿隧道传播的波：相位跟 depth 走，形成"声音往深处推"的感觉
      '  float waveZ = sin(depth * 0.42 - uTime * 2.60) * 0.5 + 0.5;',
      '  float waveRing = sin(ang * 3.0 + depth * 0.18 + uTime * 1.15) * 0.5 + 0.5;',
      '  float seed = hash11(depth * 17.0 + ang * 31.0);',
      // 每 7 环一条亮带，随低频脉冲
      '  float bandPos = fract(-depth / 7.0);',
      '  vBand = smoothstep(0.80, 1.0, bandPos) * (0.45 + uBass * 0.85);',
      // 高度：低频让隧道整体收窄（内壁向中心冲），近处最猛
      '  float h = 0.08 + waveRing * 0.14 + seed * 0.05;',
      '  h += uBass * (0.55 + nearF * 1.45) * (waveZ * 0.75 + waveRing * 0.45) * 1.55;',
      '  h += uMid * waveZ * 0.42;',
      '  h += uTreble * pow(waveRing, 3.0) * nearF * 0.95;',
      '  h += uBeat * nearF * 0.55;',
      '  h += vBand * 0.35;',
      '  h = clamp(h, 0.05, ' + MAX_HEIGHT.toFixed(2) + ');',
      '  vHeight = h;',
      // 配色：远处紫，近处青白；高处再往白热推
      '  vec3 farC = vec3(0.30, 0.16, 0.82);',
      '  vec3 nearC = vec3(0.66, 0.94, 1.00);',
      '  vec3 baseCol = mix(farC, nearC, pow(nearF, 0.85));',
      '  float hot = clamp(h / ' + MAX_HEIGHT.toFixed(2) + ', 0.0, 1.0);',
      '  vCol = mix(baseCol, mix(baseCol, vec3(1.0, 0.96, 0.88), 0.60), hot * hot);',
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
      'varying vec3 vNormalL;',
      'varying float vNear;',
      'varying float vBand;',
      'void main(){',
      // local +y 朝隧道中心，所以 +y 面就是"内端面"
      '  bool isCap = vNormalL.y > 0.5;',
      '  float hot = clamp(vHeight / ' + MAX_HEIGHT.toFixed(2) + ', 0.0, 1.0);',
      '  vec3 col;',
      '  float alpha;',
      '  if (isCap) {',
      '    col = vCol * (0.70 + hot * 1.35);',
      '    alpha = (0.30 + hot * 0.55) * (0.35 + vNear * 0.65);',
      '  } else {',
      '    float grad = mix(0.04, 0.38, pow(vRelY, 1.30));',
      '    col = vCol * grad * (0.60 + hot * 0.90);',
      '    col += vCol * smoothstep(0.84, 1.0, vRelY) * 0.55;',
      '    alpha = (0.10 + grad * 0.55) * (0.30 + vNear * 0.70);',
      '  }',
      // 亮带整圈提亮
      '  col += vCol * vBand * 0.85;',
      '  alpha += vBand * 0.28;',
      // 远端雾化：越深越透明，形成隧道消隐
      '  alpha *= smoothstep(0.0, 0.22, vNear);',
      '  if (alpha < 0.004) discard;',
      '  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));',
      '}'
    ].join('\n');
  }

  function buildBars() {
    var total = RING_COUNT * PER_RING;
    var geo = new THREE.BoxGeometry(BAR_W, 1, BAR_W);
    var mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uBass: { value: 0 },
        uMid: { value: 0 },
        uTreble: { value: 0 },
        uBeat: { value: 0 }
      },
      vertexShader: buildBarVertexShader(),
      fragmentShader: buildBarFragmentShader(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    var mesh = new THREE.InstancedMesh(geo, mat, total);
    mesh.frustumCulled = false;

    var axisZ = new THREE.Vector3(0, 0, 1);
    var n = 0;
    for (var r = 0; r < RING_COUNT; r++) {
      var t = RING_COUNT > 1 ? r / (RING_COUNT - 1) : 0;
      var z = lerp(Z_NEAR, Z_FAR, t);
      for (var k = 0; k < PER_RING; k++) {
        var ang = (k / PER_RING) * Math.PI * 2;
        state.dummyPos.set(Math.cos(ang) * TUNNEL_R, Math.sin(ang) * TUNNEL_R, z);
        // local +y 指向隧道中心
        state.dummyQuat.setFromAxisAngle(axisZ, ang + Math.PI / 2);
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

    state.root = new THREE.Group();
    state.root.name = 'audio-tunnel-root';
    state.root.position.set(0, 0, 0);

    state.bars = buildBars();
    state.barsMat = state.bars.material;
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
    state.barsMat = null;
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

    // 隧道绕自身轴缓慢旋转，强化"正在穿行"的感觉
    state.spin += dt * lerp(0.04, 0.22, clamp01((fx.speed || 1) / 2));
    state.root.rotation.z = state.spin;

    var u = state.barsMat.uniforms;
    u.uTime.value = state.time;
    u.uBass.value = audio.bass;
    u.uMid.value = audio.mid;
    u.uTreble.value = audio.treble;
    u.uBeat.value = Math.min(1, audio.beat + state.pulse * 0.35);

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

  global.MineradioAudioTunnel = {
    INDEX: INDEX,
    isActive: isActive,
    update: update,
    clear: clearLayer,
    onPresetChange: onPresetChange
  };
})(typeof window !== 'undefined' ? window : globalThis);
