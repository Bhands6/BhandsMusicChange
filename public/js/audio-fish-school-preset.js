//  audio-fish-school-preset.js — 预设 23 深海鱼群 Fish School（水下光束版）
//  按用户提供的参考稿《水下光束 · 鱼群》重做（2026-11-03 用户拍板：重做预设 23 /
//  程序化鱼体 / 完整水下背景）：
//  · 全屏水下光柱背景 shader：光柱摇曳 + 水面亮面 + 底部焦散 + 尘埃 + 暗角，
//    逐行移植参考稿 FS；做成挂机位跟随的满屏 quad（depthTest 关，renderOrder 最先）
//  · boids 群游：150px 邻域 alignment+cohesion、2.2r 分离、个体 wander、
//    软墙推回 + 硬边界、速度平滑钳制 30~90 px/s（×K 换算世界单位）——参考稿逐式移植
//  · 受光：鱼按屏幕投影算 lit（光柱内亮 / 光柱外压暗到 0.25），lit 高加 additive 提亮
//  · 音频：bass 提升游速上限与摆尾幅度；beat 按「点击惊散」口径从群质心注入径向冲量
//  · 鱼体沿用程序化几何（用户选定）：正弦波动 u² 摆尾 + 三色板 5 段渐变 + 背亮腹暗
//  注意：v1 的 integrate() 用了未声明的 ax/ay（strict 模式每帧 ReferenceError，
//  会打断整条 animate 渲染循环）——本版全部局部变量显式声明，bug 随重写消除。
(function (global) {
  'use strict';

  var INDEX = 23;

  // ---------- 参考稿口径常量（px → 世界单位换算 K = 13.9 units / 1920px） ----------
  var COUNT = 30;            // 参考稿路径绘鱼 30 条
  var K = 0.00724;
  var SPAN_X = 6.2;          // 参考稿出生域 x∈(0,W) → ±半屏宽
  var SPAN_Y = 3.6;
  var NEIGHBOR_R = 150 * K;  // boids 邻域（align+cohesion）
  var EDGE_MARGIN = 70 * K;  // 软墙边距
  var EDGE_HARD = 30 * K;    // 硬边界外扩（参考稿 ±30px 钳制）
  var SCARE_R = 260 * K;     // beat 惊散半径（参考稿点击 260px）
  var SCARE_K = 180 * K;     // 惊散冲量峰值（参考稿 (R-d)/R*180）
  var BG_DIST = 14;          // 背景 quad 距机位的距离（机位跟随，满屏覆盖与距离无关）

  var PALETTES = [
    ['#f5a33a', '#a94a19', '#ffe0a0'],
    ['#f28a43', '#a83e20', '#ffd0a0'],
    ['#e8c968', '#a8792f', '#fff0be'],
    ['#d9e7ef', '#718da4', '#ffffff'],
    ['#9cc9e8', '#426d98', '#e1f2ff'],
    ['#e87960', '#8d3028', '#ffc1a1'],
    ['#e8c1a0', '#9f7055', '#fff0d9']
  ];
  // 三种体型（参考稿 SPECIES 口径：slender 细长 / deep 深身 / longfin 长鳍）
  var SPECIES = [
    { lenK: [0.80, 1.10], wid: 0.90 },
    { lenK: [0.62, 0.88], wid: 1.20 },
    { lenK: [0.70, 1.00], wid: 1.03 }
  ];

  var state = {
    root: null,
    bgMesh: null,
    bgMat: null,
    mesh: null,
    mat: null,
    scene: null,
    camera: null,
    opacity: 0,
    initialized: false,
    time: 0,
    fishes: [],
    dummy: null,
    litArr: null,   // 已废弃（属性数超 r128 上限），占位防旧引用
    scratchV: null,
    scratchDir: null,
    smooth: { bass: 0, mid: 0, treble: 0, beat: 0, energy: 0 }
  };

  function clamp01(v) { return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rnd(i) { var x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
  function smooth(e0, e1, x) {
    var t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  }
  function hex2rgb(h) {
    return [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
  }

  // ---------- 水下光柱背景 shader（参考稿 FS 逐行移植，gl_FragCoord → vUv） ----------
  function buildWaterFS() {
    return [
      'precision highp float;',
      'uniform float uTime;',
      'uniform float uAspect;',
      'uniform float uOpacity;',
      'varying vec2 vUv;',
      'float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
      'float noise(vec2 p){',
      '  vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f);',
      '  return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),f.x),mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0,1.0)),f.x),f.y);',
      '}',
      'float fbm(vec2 p){float v=0.0;float a=0.5;for(int i=0;i<4;i++){v+=a*noise(p);p*=2.02;a*=0.5;}return v;}',
      'float caustic(vec2 uv,float t){',
      '  vec2 p=mod(uv*6.2831853,6.2831853)-250.0;',
      '  vec2 i=p; float c=1.0; float inten=0.005;',
      '  for(int n=0;n<5;n++){',
      '    float tt=t*(1.0-(3.5/float(n+1)));',
      '    i=p+vec2(cos(tt-i.x)+sin(tt+i.y),sin(tt-i.y)+cos(tt+i.x));',
      '    c+=1.0/length(vec2(p.x/(sin(i.x+tt)/inten),p.y/(cos(i.y+tt)/inten)));',
      '  }',
      '  c/=5.0; c=1.17-pow(c,1.4);',
      '  return pow(abs(c),8.0);',
      '}',
      'void main(){',
      '  vec2 uv=vUv;',
      '  float asp=uAspect;',
      '  vec2 p=vec2((uv.x-0.5)*asp,uv.y-0.5);',
      '  float t=uTime;',
      '  vec3 col=mix(vec3(0.008,0.03,0.05),vec3(0.0,0.09,0.13),uv.y);',
      // 光柱（含横向 sway，鱼体受光用同一条公式）
      '  float sway=sin(t*0.13)*0.025*(1.0-uv.y);',
      '  float spread=0.14+0.50*(1.0-uv.y)*(1.0-uv.y);',
      '  float shaft=1.0-smoothstep(spread*0.12,spread,abs(p.x-sway));',
      '  float rays=smoothstep(0.30,0.85,fbm(vec2(p.x*9.0+t*0.05,p.y*0.6-t*0.08)));',
      '  float fine=0.5+0.5*sin(p.x*70.0+fbm(vec2(p.x*4.0,t*0.1))*8.0);',
      '  float beam=shaft*(0.35+0.65*rays)*(0.7+0.3*fine);',
      '  beam*=smoothstep(0.0,0.9,uv.y)*0.95;',
      '  col+=vec3(0.50,0.85,1.0)*beam*0.85;',
      // 水面亮面
      '  float surf=smoothstep(0.80,0.97,uv.y)*(1.0-smoothstep(0.12,0.46,abs(p.x)));',
      '  float ripple=0.5+0.5*sin(p.x*38.0+fbm(vec2(p.x*6.0,t*0.4))*9.0+t*1.5);',
      '  col+=vec3(0.7,0.95,1.0)*surf*(0.4+0.45*ripple);',
      // 底部焦散
      '  float floorM=1.0-smoothstep(0.0,0.30,uv.y);',
      '  float cz=caustic(vec2(p.x*0.9+0.5,p.y*0.9)*0.9,t*0.35);',
      '  col+=vec3(0.55,0.9,1.0)*cz*floorM*0.6*(0.6+0.4*fbm(p*3.0+t*0.1));',
      // 尘埃（光柱内可见）
      '  vec2 g=uv*vec2(asp,1.0)*vec2(40.0,26.0)+vec2(0.0,-t*0.6);',
      '  vec2 id=floor(g); vec2 f=fract(g)-0.5;',
      '  float h=hash(id);',
      '  vec2 off=(vec2(hash(id+3.1),hash(id+7.7))-0.5)*0.6;',
      '  float dust=(1.0-smoothstep(0.0,0.08,length(f-off)))*step(0.93,h);',
      '  col+=vec3(0.8,0.95,1.0)*dust*shaft*0.7;',
      // 暗角（减弱）
      '  vec2 q=p*vec2(0.8,1.0);',
      '  col*=1.0-0.45*dot(q,q);',
      '  gl_FragColor=vec4(col,uOpacity);',
      '}'
    ].join('\n');
  }

  // ---------- 鱼体几何（程序化鱼：全长≈0.88+尾鳍，头在 +x；2026-11-03 对齐参考稿
  // 「纯路径绘鱼」口径：纺锤形+肩部隆起+尾柄收细、分叉尾鳍两片、背/臀/胸鳍、眼+鳃由片元着色器画） ----------
  function buildFishUnit() {
    var pos = [], bodyU = [], sideFin = [], idx = [];
    var N = 40;
    function sstep(e0, e1, x) {
      var t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
      return t * t * (3 - 2 * t);
    }
    // 身体半高：峰值 ≈0.22（体长:体高 ≈ 2:1）+ 肩部隆起，尾柄收窄到 ≈0.01
    function profile(u) {
      var shape = Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(u, 0.85))), 0.9);
      var shoulder = 0.028 * Math.exp(-Math.pow((u - 0.24) / 0.15, 2));
      var taper = 1 - 0.72 * sstep(0.55, 1.0, u);
      return (0.022 + 0.185 * shape + shoulder) * taper;
    }
    function vx(u, y, sy, f) {
      pos.push(0.47 - u * 0.88, y, 0);
      bodyU.push(u);
      sideFin.push(sy >= 0 ? 1 : -1, f);
    }
    // 身体三角带（上轮廓 → 下轮廓）
    var topBase = 0;
    for (var i = 0; i <= N; i++) {
      var u = i / N, w = profile(u);
      vx(u, w, 1, 0);
    }
    var botBase = pos.length / 3;
    for (var i2 = 0; i2 <= N; i2++) {
      var u2 = i2 / N, w2 = profile(u2);
      vx(u2, -w2, -1, 0);
    }
    for (var k = 0; k < N; k++) {
      idx.push(topBase + k, botBase + k, topBase + k + 1);
      idx.push(topBase + k + 1, botBase + k, botBase + k + 1);
    }
    // 分叉尾鳍（四点扇形：尾柄A→上叉尖B→叉底M→下叉尖D，两个三角拼出实心扇+
    // 外缘 V 型缺口——双三角窄瓣会读成两根尖刺，实测踩坑；aBodyU>1 摆幅放大）
    var tB = 0.47 - 0.88;   // -0.41 尾柄端
    var fBase = pos.length / 3;
    pos.push(tB + 0.02, 0.0, 0); bodyU.push(1.0); sideFin.push(1, 1);
    pos.push(-0.62, 0.26, 0); bodyU.push(1.4); sideFin.push(1, 1);
    pos.push(-0.55, 0.0, 0); bodyU.push(1.2); sideFin.push(1, 1);
    idx.push(fBase, fBase + 1, fBase + 2);
    pos.push(tB + 0.02, 0.0, 0); bodyU.push(1.0); sideFin.push(-1, 1);
    pos.push(-0.55, 0.0, 0); bodyU.push(1.2); sideFin.push(-1, 1);
    pos.push(-0.62, -0.26, 0); bodyU.push(1.4); sideFin.push(-1, 1);
    idx.push(fBase + 3, fBase + 4, fBase + 5);
    // 背鳍（贴背小三角）
    var dBase = pos.length / 3;
    pos.push(0.10, 0.19, 0); bodyU.push(0.42); sideFin.push(1, 1);
    pos.push(-0.04, 0.31, 0); bodyU.push(0.52); sideFin.push(1, 1);
    pos.push(-0.17, 0.12, 0); bodyU.push(0.62); sideFin.push(1, 1);
    idx.push(dBase, dBase + 1, dBase + 2);
    // 臀鳍（腹侧小三角）
    var aBase = pos.length / 3;
    pos.push(-0.08, -0.14, 0); bodyU.push(0.62); sideFin.push(-1, 1);
    pos.push(-0.20, -0.255, 0); bodyU.push(0.72); sideFin.push(-1, 1);
    pos.push(-0.26, -0.07, 0); bodyU.push(0.80); sideFin.push(-1, 1);
    idx.push(aBase, aBase + 2, aBase + 1);
    // 胸鳍（腹侧头部小三角，随身体摆动）
    var pBase = pos.length / 3;
    pos.push(0.02, -0.03, 0); bodyU.push(0.30); sideFin.push(-1, 1);
    pos.push(-0.14, -0.21, 0); bodyU.push(0.38); sideFin.push(-1, 1);
    pos.push(-0.16, -0.04, 0); bodyU.push(0.46); sideFin.push(-1, 1);
    idx.push(pBase, pBase + 2, pBase + 1);
    return {
      position: new Float32Array(pos),
      bodyU: new Float32Array(bodyU),
      sideFin: new Float32Array(sideFin),
      index: new Uint16Array(idx)
    };
  }

  function buildFishVS() {
    return [
      'precision highp float;',
      'uniform float uTime;',
      'uniform float uBendAmp;',
      'uniform float uAspect;',
      'attribute float aBodyU;',
      'attribute vec2 aSideFin;',   // x: 背侧(+1)/腹侧(-1)，y: 鳍(1)
      'attribute float aPhase;',
      'attribute float aFlapSpeed;',
      'attribute float aWidK;',
      'attribute vec3 aTint0;',
      'attribute vec3 aTint1;',
      'attribute vec3 aTint2;',
      'varying float vU;',
      'varying float vSideY;',
      'varying float vFin;',
      'varying vec3 vT0;',
      'varying vec3 vT1;',
      'varying vec3 vT2;',
      'varying float vLit;',
      'varying float vLy;',   // 鱼体局部 y（体宽单位，眼睛/鳃盖定位用）
      'void main(){',
      // 参考稿切片摆尾口径：bend = sin(time*flap + phase - u*3.25) * amp * u²（尾鳍 u>1 摆更大）
      '  vec3 p = position;',
      '  vLy = position.y;',
      '  p.y *= aWidK;',
      '  float bend = sin(uTime * aFlapSpeed + aPhase - aBodyU * 3.25) * uBendAmp * aBodyU * aBodyU;',
      '  p.y += bend;',
      '  vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);',
      '  gl_Position = projectionMatrix * viewMatrix * wp;',
      // 受光（逐顶点）：裁剪空间 → 屏幕uv → 与背景 shader 同一条光柱公式（含 sway）。
      // 2026-11-03：改为内置计算——独立 aLit 实例属性会把活动属性顶到 r128 上限
      // （Too many attributes (aLit)，program 创建失败 → 鱼整群不渲染，实测踩坑）。
      '  vec2 suv = clamp(gl_Position.xy / max(gl_Position.w, 0.0001) * 0.5 + 0.5, 0.0, 1.0);',
      '  float sway = sin(uTime * 0.13) * 0.025 * (1.0 - suv.y);',
      '  float spread = 0.14 + 0.50 * (1.0 - suv.y) * (1.0 - suv.y);',
      '  float pxN = abs((suv.x - 0.5) * uAspect - sway);',
      '  vLit = 1.0 - smoothstep(spread * 0.12, spread, pxN);',
      '  vU = clamp(aBodyU, 0.0, 1.0);',
      '  vSideY = aSideFin.x;',
      '  vFin = aSideFin.y;',
      '  vT0 = aTint0; vT1 = aTint1; vT2 = aTint2;',
      '}'
    ].join('\n');
  }

  function buildFishFS() {
    return [
      'precision highp float;',
      'uniform float uBeat;',
      'uniform float uOpacity;',
      'varying float vU;',
      'varying float vSideY;',
      'varying float vFin;',
      'varying vec3 vT0; varying vec3 vT1; varying vec3 vT2;',
      'varying float vLit;',
      'varying float vLy;',
      'void main(){',
      // 五段渐变：暗-主-亮-主-暗
      '  vec3 c;',
      '  if (vU < 0.22) c = mix(vT0, vT1, vU / 0.22);',
      '  else if (vU < 0.49) c = mix(vT1, vT2, (vU - 0.22) / 0.27);',
      '  else if (vU < 0.72) c = mix(vT2, vT1, (vU - 0.49) / 0.23);',
      '  else c = mix(vT1, vT0, (vU - 0.72) / 0.28);',
      '  c *= 1.0 + vSideY * 0.16;',
      '  c *= mix(1.0, 0.86, vFin);',
      // 鳃盖弧线（参考稿 gill 口径：头部一条竖向浅弧）
      '  float gill = smoothstep(0.045, 0.0, abs(vU - 0.155)) * (1.0 - vFin);',
      '  c *= 1.0 - gill * 0.22;',
      // 眼睛（瞳孔 + 高光点；参考稿 eye ≈ 2.7% 体长，头背侧）
      '  vec2 dEye = vec2((vU - 0.085) * 0.88, vLy - 0.052);',
      '  float dE = length(dEye);',
      '  float eye = (1.0 - smoothstep(0.014, 0.022, dE)) * (1.0 - vFin);',
      '  c = mix(c, vec3(0.015, 0.035, 0.06), eye);',
      '  vec2 dHi = vec2((vU - 0.078) * 0.88, vLy - 0.059);',
      '  float hi = (1.0 - smoothstep(0.004, 0.008, length(dHi))) * (1.0 - vFin);',
      '  c = mix(c, vec3(0.85, 0.92, 1.0), hi * 0.85);',
      // 受光：光柱内全亮，光柱外压暗到 0.32（0.25 实测过暗，暗处鱼几乎看不见）
      '  c *= mix(0.32, 1.0, vLit);',
      // 光柱内的柔和提亮（参考稿 lighter 叠加口径，随 lit² 收口防过曝）
      '  c += c * vLit * vLit * 0.20;',
      // 鼓点闪光
      '  c += c * uBeat * 0.16;',
      '  gl_FragColor = vec4(c * uOpacity, 1.0);',
      '}'
    ].join('\n');
  }

  /** 初始化鱼群（参考稿 makeFish 口径：len=(26+depth*44)*lenK 近大远小、
   *  alpha=0.48+depth*0.5 深处更透明、speed=0.62+depth*1.05 深处更慢） */
  function initFishes() {
    state.fishes = [];
    for (var i = 0; i < COUNT; i++) {
      var depth = rnd(i * 17.3);
      var pal = PALETTES[Math.floor(rnd(i * 7.7) * PALETTES.length) % PALETTES.length];
      var sp = SPECIES[Math.floor(rnd(i * 11.1) * SPECIES.length) % SPECIES.length];
      var dir = rnd(i * 19.9) * Math.PI * 2;
      var lenPx = (26 + depth * 44) * lerp(sp.lenK[0], sp.lenK[1], rnd(i * 5.3));
      var spLen = lenPx * K;                        // 世界单位全长 ≈ 18~88px
      var t0 = hex2rgb(pal[1]), t1 = hex2rgb(pal[0]), t2 = hex2rgb(pal[2]);
      var dim = 0.48 + depth * 0.52;                // 参考稿 alpha 口径（受光另外由 lit 驱动）
      var f = {
        x: (rnd(i * 3.3) - 0.5) * SPAN_X * 1.9,
        y: (rnd(i * 2.7) - 0.5) * SPAN_Y * 1.5,
        z: (depth - 0.5) * 1.0,                     // 贴屏 depth 层（分离只在 XY 做）
        depth: depth,
        vx: Math.cos(dir) * lerp(40, 70, rnd(i * 9.1)) * K,
        vy: Math.sin(dir) * lerp(20, 40, rnd(i * 4.1)) * K,
        t: 0,
        angle: 0,                                   // tilt 俯仰（flip+tilt 口径，初始下方积分首帧收敛）
        flip: 1,
        len: spLen,
        widK: sp.wid * lerp(0.92, 1.08, rnd(i * 6.7)),   // 体型体宽系数
        maxS: (0.62 + depth * 1.05) * 60 * K,            // 参考稿 speed：px/frame → units/s
        r: spLen * 0.55,                            // 参考稿 r = size*s*0.5 口径
        phase: rnd(i * 15.1) * Math.PI * 2,
        flap: 6.2 + rnd(i * 8.3) * 1.8              // 参考稿侧身鱼 sin(t*7) 口径
      };
      f.t0 = [t0[0] * dim, t0[1] * dim, t0[2] * dim];
      f.t1 = [t1[0] * dim, t1[1] * dim, t1[2] * dim];
      f.t2 = [t2[0] * dim, t2[1] * dim, t2[2] * dim];
      state.fishes.push(f);
    }
    // 按 depth 升序 = 远→近绘制顺序（参考稿 sorted 绘制口径；数组序即实例槽位序）
    state.fishes.sort(function (a, b) { return a.depth - b.depth; });
  }

  function ensureLayer(scene) {
    if (state.initialized) return;
    state.scene = scene;

    // 背景满屏 quad：PlaneGeometry 2×2，每帧按 fov/aspect 摆到机位前方
    var bgGeo = new THREE.PlaneGeometry(2, 2);
    var bgMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uAspect: { value: 1.78 },
        uOpacity: { value: 0 }
      },
      vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: buildWaterFS(),
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    var bgMesh = new THREE.Mesh(bgGeo, bgMat);
    bgMesh.frustumCulled = false;
    bgMesh.renderOrder = -10;   // 透明队列里最先画，鱼与后续元素都叠在水景之上

    // 鱼群 InstancedMesh
    var unit = buildFishUnit();
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(unit.position, 3));
    geo.setAttribute('aBodyU', new THREE.BufferAttribute(unit.bodyU, 1));
    geo.setAttribute('aSideFin', new THREE.BufferAttribute(unit.sideFin, 2));
    geo.setIndex(new THREE.BufferAttribute(unit.index, 1));

    var mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uBendAmp: { value: 0.07 },
        uAspect: { value: 1.78 },
        uBeat: { value: 0 },
        uOpacity: { value: 0 }
      },
      vertexShader: buildFishVS(),
      fragmentShader: buildFishFS(),
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: true,
      depthTest: true
    });

    var mesh = new THREE.InstancedMesh(geo, mat, COUNT);
    mesh.frustumCulled = false;
    mesh.renderOrder = 0;

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
      flapArr[i] = f.flap;
      widArr[i] = f.widK;
    }
    geo.setAttribute('aTint0', new THREE.InstancedBufferAttribute(t0Arr, 3));
    geo.setAttribute('aTint1', new THREE.InstancedBufferAttribute(t1Arr, 3));
    geo.setAttribute('aTint2', new THREE.InstancedBufferAttribute(t2Arr, 3));
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phaseArr, 1));
    geo.setAttribute('aFlapSpeed', new THREE.InstancedBufferAttribute(flapArr, 1));
    geo.setAttribute('aWidK', new THREE.InstancedBufferAttribute(widArr, 1));
    mesh.instanceMatrix.needsUpdate = true;

    state.bgMesh = bgMesh;
    state.bgMat = bgMat;
    state.mesh = mesh;
    state.mat = mat;
    state.scratchDir = new THREE.Vector3();
    state.root = new THREE.Group();
    state.root.name = 'audio-fish-school-root';
    state.root.add(bgMesh);
    state.root.add(mesh);
    state.root.visible = false;
    scene.add(state.root);
    state.initialized = true;
  }

  function clearLayer() {
    if (!state.root) return;
    if (state.scene) state.scene.remove(state.root);
    if (state.bgMesh) {
      state.bgMesh.geometry.dispose();
      state.bgMat.dispose();
    }
    if (state.mesh) {
      state.mesh.geometry.dispose();
      state.mat.dispose();
    }
    state.root = null;
    state.bgMesh = null;
    state.bgMat = null;
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
   * boids 群游（参考稿 step() 逐式移植，px→世界单位 ×K）：
   * 150px 邻域 align+cohesion、2.2r 分离、个体 wander、软墙推回 + 硬边界钳制、
   * 速度平滑钳制（30~90 px/s）；无阻尼——参考稿靠速度钳制收敛。
   * beat 惊散：替代参考稿的点击交互，从群质心按「点击冲量」公式注入径向速度。
   */
  function integrate(dt, audio) {
    var fishes = state.fishes;
    // 群质心（惊散 epicenter）
    var cx = 0, cy = 0;
    for (var c = 0; c < fishes.length; c++) { cx += fishes[c].x; cy += fishes[c].y; }
    cx /= fishes.length; cy /= fishes.length;

    var sepRBoost = 1 + audio.beat * 0.8;   // 鼓点分离半径炸大（炸开再聚拢）
    var maxScale = 1 + audio.bass * 0.5;    // bass 提升游速上限

    for (var i = 0; i < fishes.length; i++) {
      var a = fishes[i];
      var sepX = 0, sepY = 0, alignX = 0, alignY = 0, cohX = 0, cohY = 0, n = 0;
      var sepR = a.r * 2.2 * sepRBoost;
      for (var j = 0; j < fishes.length; j++) {
        if (i === j) continue;
        var b = fishes[j];
        var dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
        if (d2 < NEIGHBOR_R * NEIGHBOR_R) {
          n++;
          alignX += b.vx; alignY += b.vy;
          cohX += b.x; cohY += b.y;
          if (d2 < sepR * sepR) { sepX -= dx; sepY -= dy; }
        }
      }
      var fxF = 0, fyF = 0;
      if (n) {
        fxF += (alignX / n - a.vx) * 0.04 + (cohX / n - a.x) * 0.004;
        fyF += (alignY / n - a.vy) * 0.04 + (cohY / n - a.y) * 0.004;
      }
      fxF += sepX * 0.06;
      fyF += sepY * 0.06;

      // 个体 wander（参考稿原式）
      a.t += dt;
      fxF += Math.cos(a.t * 0.4 + a.phase) * 10 * K;
      fyF += Math.sin(a.t * 0.6 + a.phase) * 6 * K;

      // 软墙推回（参考稿 m=70px，力 (m-x)*0.8）
      var m = EDGE_MARGIN;
      if (a.x < -m) fxF += (-m - a.x) * 0.8 * K;
      if (a.x > m) fxF -= (a.x - m) * 0.8 * K;
      if (a.y < -m) fyF += (-m - a.y) * 0.8 * K;
      if (a.y > m) fyF -= (a.y - m) * 0.8 * K;

      // beat 惊散（参考稿点击冲量：(R-d)/R * 180）
      if (audio.beat > 0.6 && a.beatKick !== true) {
        var sdx = a.x - cx, sdy = a.y - cy;
        var sd = Math.hypot(sdx, sdy);
        if (sd < SCARE_R && sd > 0.001) {
          var kk = (SCARE_R - sd) / SCARE_R * SCARE_K;
          a.vx += sdx / sd * kk;
          a.vy += sdy / sd * kk;
        }
        a.beatKick = true;
      } else if (audio.beat <= 0.6) {
        a.beatKick = false;
      }

      // 积分（参考稿无阻尼）
      a.vx += fxF * dt;
      a.vy += fyF * dt;

      // 速度平滑钳制（每条鱼上限 = maxS×(1+bass×0.5)，下限 = maxS×0.45；深处更慢）
      var sp = Math.hypot(a.vx, a.vy) || 0.0001;
      var target = Math.min(a.maxS * maxScale, Math.max(a.maxS * 0.45, sp));
      target = sp + (target - sp) * Math.min(1, dt * 0.8);
      var scl = target / sp;
      a.vx *= scl; a.vy *= scl;

      a.x += a.vx * dt;
      a.y += a.vy * dt;
      // 硬边界（参考稿 ±30px 钳制）
      var hx = SPAN_X + EDGE_HARD, hy = SPAN_Y + EDGE_HARD;
      a.x = Math.max(-hx, Math.min(hx, a.x));
      a.y = Math.max(-hy, Math.min(hy, a.y));

      // 朝向（参考稿 flip+tilt 口径）：rotation.z 只做 ±0.6 限幅俯仰，左右由
      // scale.x 镜像承担——直接转 atan2(vy,vx) 会让向左游的鱼转 180° 肚皮朝上
      var spd = Math.hypot(a.vx, a.vy);
      if (spd > 0.05 * K) {
        var ta = Math.atan2(a.vy, Math.abs(a.vx));
        var df = ta - a.angle;
        while (df > Math.PI) df -= Math.PI * 2;
        while (df < -Math.PI) df += Math.PI * 2;
        a.angle += df * Math.min(1, dt * 3.4);
        a.angle = Math.max(-0.6, Math.min(0.6, a.angle));
      }
      a.flip = a.vx < 0 ? -1 : 1;   // 参考稿 flip 口径：vx 变号瞬间镜像
    }
  }

  /** 背景 quad 摆到机位前方（满屏覆盖，与机位距离/朝向无关） */
  function placeBackdrop(camera) {
    var h = 2 * BG_DIST * Math.tan(camera.fov * Math.PI / 360);
    var w = h * (camera.aspect || 1.78);
    camera.getWorldDirection(state.scratchDir);
    state.bgMesh.position.copy(camera.position).addScaledVector(state.scratchDir, BG_DIST);
    state.bgMesh.quaternion.copy(camera.quaternion);
    state.bgMesh.scale.set(w, h, 1);
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
    var camera = ctx.camera || null;
    state.camera = camera;

    integrate(dt, audio);

    if (camera) {
      placeBackdrop(camera);
      state.mat.uniforms.uAspect.value = camera.aspect || 1.78;
    }

    var u = state.mat.uniforms;
    u.uTime.value = state.time;
    u.uOpacity.value = state.opacity;
    u.uBendAmp.value = 0.07 * (1 + audio.bass * 0.8);   // bass：摆尾更有力
    u.uBeat.value = audio.beat;
    state.bgMat.uniforms.uTime.value = state.time;
    state.bgMat.uniforms.uOpacity.value = state.opacity;

    var dummy = state.dummy;
    for (var i = 0; i < state.fishes.length; i++) {
      var f = state.fishes[i];
      dummy.position.set(f.x, f.y, f.z);
      // 参考稿组合：rotate(tilt) → scale(flip,1)——tilt 符号随镜像翻转，头始终朝速度方向且背鳍朝上
      var tilt = f.flip < 0 ? -f.angle : f.angle;
      dummy.rotation.set(0, 0, tilt);
      dummy.scale.set(f.flip * f.len, f.len, f.len);
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
