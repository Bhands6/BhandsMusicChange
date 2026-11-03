//  audio-butterfly-preset.js — 预设 22 蓝光蝶群 Butterfly Swarm
//  「把实体柱替换成蝴蝶」+「随机飞动」：音域回响的技术口径（InstancedMesh 实体蝴蝶 +
//  GPU 扑翅顶点位移 + 正/背面分离着色），运动 = 慢速自由飞舞——
//  多频正弦游走 + 朝向跟随速度方向 + 空间环绕循环（无鼠标交互，2026-11-03 用户要求）。
//
//  · 56 只低模实体蝴蝶（4 翅面 + 身体 + 头，12 三角），稀疏空灵口径；加色混合自发光
//  · 扑翅全 GPU：翅膀绕身体纵轴上下拍（aWingV 权重，翅尖最大），个体相位/速度各异
//  · CPU 每帧只做 160 次位置/朝向积分（对齐参考稿的 wander 算法），开销可忽略
//  · 姿态「背上对镜头」：翅膀平摊正对机位、头朝上（复刻参考稿 2D 俯视画面），
//    仅随横向航向在屏幕平面内轻微转头
//  · 配色多彩随机（参考稿 hues 口径），背景为几何体家族同款星野
(function (global) {
  'use strict';

  var INDEX = 22;

  var COUNT = 400;           // 蝴蝶数量（编队放大后按密度要求同步加量）
  // 活动域（参考稿 x:rand(0,W) / y:rand(0,H) 全屏均匀分布 → 世界尺度方形域）
  var SPAN_X = 6.4;          // 横向半宽（可见宽 13.9 的一半再略收）
  var SPAN_Y = 3.6;          // 纵向半高（可见高 ~7.8 的一半再略收）
  var SPAN_Z = 3.5;          // 景深半深（参考稿用 depth 做层次，这里给 3D 纵深）

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
    flies: [],               // CPU 侧飞行状态
    dummy: null,
    qBase: null,             // 「背上对镜头」基准姿态四元数（翅膀平摊正对镜头、头朝上）
    zAxis: null,             // 世界 z 轴：贴屏姿态下绕它旋转 = 蝴蝶在屏幕平面内转头
    formActive: false,       // 开场编队：小蝴蝶先组成一只大蝴蝶
    formT: 0,                // 编队阶段计时（秒）
    FORM_HOLD: 3.4,          // 编队总时长：~1.2s 成形保持 + 2.2s 基本同步打乱
    smooth: { bass: 0, mid: 0, treble: 0, beat: 0, energy: 0 }
  };

  function clamp01(v) { return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rnd(i) { var x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

  /** hsl → rgb（参考稿用 hsla 多彩蝴蝶） */
  function hsl2rgb(h, s, l) {
    h = ((h % 360) + 360) % 360;
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var hp = h / 60;
    var x = c * (1 - Math.abs(hp % 2 - 1));
    var r = 0, g = 0, b = 0;
    if (hp < 1) { r = c; g = x; }
    else if (hp < 2) { r = x; g = c; }
    else if (hp < 3) { g = c; b = x; }
    else if (hp < 4) { g = x; b = c; }
    else if (hp < 5) { r = x; b = c; }
    else { r = c; b = x; }
    var m = l - c / 2;
    return [r + m, g + m, b + m];
  }

  /**
   * 单只蝴蝶的静态几何。
   * 翅形直接取自参考稿（生灵·Creatures）的贝塞尔曲线控制点——上翅大而尖、
   * 下翅圆润，轮廓采样后以翅根为扇心做三角扇。飞行姿态：身体水平沿 +z（头朝 +z），
   * 翅膀面在 XZ 水平面，扑翅 = 绕身体纵轴（z）上下拍。
   * 每顶点：aWingV（扑翅权重，翅尖 1）+ aShade（上翅 1 / 下翅 0.8 / 身体 0.9）。
   */
  function buildButterflyUnit() {
    var pos = [], wing = [], shade = [], idx = [];

    function cubic(p0, c1, c2, p1, n, out) {
      for (var i = 1; i <= n; i++) {
        var t = i / n, mt = 1 - t;
        out.push([
          mt * mt * mt * p0[0] + 3 * mt * mt * t * c1[0] + 3 * mt * t * t * c2[0] + t * t * t * p1[0],
          mt * mt * mt * p0[1] + 3 * mt * mt * t * c1[1] + 3 * mt * t * t * c2[1] + t * t * t * p1[1]
        ]);
      }
    }

    var S = 1 / 20;   // 参考稿 canvas 单位 → 模型单位

    function addWing(points, cx, cy, wMax, shadeV) {
      // 轮廓点 → 以翅根附近 (cx,cy) 为扇心的三角扇；右侧 x<0，左侧镜像
      for (var side = 0; side < 2; side++) {
        var m = side === 0 ? 1 : -1;
        var base = pos.length / 3;
        // 扇心
        pos.push(cx * S, 0, -cy * S);
        wing.push(0);
        shade.push(shadeV);
        for (var i = 0; i < points.length; i++) {
          var px = points[i][0] * S * m;
          var pz = -points[i][1] * S;
          pos.push(px, 0, pz);
          wing.push(Math.min(1, Math.abs(px) / wMax));
          shade.push(shadeV);
        }
        for (var k = 1; k < points.length; k++) {
          if (side === 0) idx.push(base, base + k, base + k + 1);
          else idx.push(base, base + k + 1, base + k);   // 镜像反转绕序，法线保持朝上
        }
      }
    }

    // 参考稿翅形（w=1 最大展开，右侧控制点）
    var upper = [[0, -2]];
    cubic([0, -2], [-5, -14], [-13, -11], [-8, -1.5], 16, upper);
    cubic([-8, -1.5], [-5, 1.5], [-2.5, 0.5], [0, -2], 16, upper);
    var lower = [[0, -0.5]];
    cubic([0, -0.5], [-4, 3], [-9, 8], [-5.5, 10], 12, lower);
    cubic([-5.5, 10], [-2, 7], [-1, 3], [0, -0.5], 12, lower);

    addWing(upper, 0, -2, 0.48, 1.0);    // 上翅：大而尖
    addWing(lower, 0, -0.5, 0.48, 0.80); // 下翅：圆润、略暗

    // 身体（沿 z，头 +z）+ 头——位置按参考稿身体椭圆比例
    function quad(a, b, c, d, sh) {
      var base = pos.length / 3;
      [a, b, c, d].forEach(function (pt) {
        pos.push(pt[0], 0, pt[1]);
        wing.push(0);
        shade.push(sh);
      });
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    quad([-0.055, -0.40], [0.055, -0.40], [0.055, 0.12], [-0.055, 0.12], 0.9);
    quad([-0.045, 0.12], [0.045, 0.12], [0.045, 0.21], [-0.045, 0.21], 0.9);

    return { position: new Float32Array(pos), wing: new Float32Array(wing), shade: new Float32Array(shade), index: new Uint16Array(idx) };
  }

  /**
   * 大蝴蝶编队目标点（网格抖动面填充）：放大「单只蝴蝶」的同源贝塞尔翅形，
   * 4 片翅闭合环按面积配额，网格+抖动布点（类泊松）——均匀铺满、互不叠堆，
   * 轮廓圆润（细分 36/段），另加少量身体带上的点。
   * 世界坐标：py 负（参考稿头侧）→ y 正（画面上方）。
   */
  function buildFormationTargets() {
    function cubic(p0, c1, c2, p1, n, out) {
      for (var i = 1; i <= n; i++) {
        var t = i / n, mt = 1 - t;
        out.push([
          mt * mt * mt * p0[0] + 3 * mt * mt * t * c1[0] + 3 * mt * t * t * c2[0] + t * t * t * p1[0],
          mt * mt * mt * p0[1] + 3 * mt * mt * t * c1[1] + 3 * mt * t * t * c2[1] + t * t * t * p1[1]
        ]);
      }
    }
    function polyArea(poly) {
      var a = 0;
      for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
      }
      return Math.abs(a) / 2;
    }
    function polyContains(poly, x, y) {
      var inside = false;
      for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
        if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
      }
      return inside;
    }
    var S2 = 0.30;   // 大蝴蝶缩放：翅展 ±13 → ±3.9 units、总高 ~7.2 units（近乎满屏高，用户要求放大）
    var Y_OFF = -0.55; // 图案垂直居中：蝴蝶 py 范围 -14~10，中心偏移补偿到画面正中
    var wings = [
      { segs: [[[0, -2], [-5, -14], [-13, -11], [-8, -1.5]], [[-8, -1.5], [-5, 1.5], [-2.5, 0.5], [0, -2]]] },
      // 下翅恢复参考稿原本的弯月形（用户要求按原本蝴蝶形状；2026-11-03 曾试改圆鼓被否）
      { segs: [[[0, -0.5], [-4, 3], [-9, 8], [-5.5, 10]], [[-5.5, 10], [-2, 7], [-1, 3], [0, -0.5]]] }
    ];
    // 只生成**左侧**上下两片翅的多边形——右翅由左翅点镜像（x 取反），左右严格对称
    var polys = [];
    for (var w = 0; w < wings.length; w++) {
      var pts = [];
      for (var s = 0; s < 2; s++) {
        var g = wings[w].segs[s];
        if (s === 0) pts.push([g[0][0], g[0][1]]);
        cubic(g[0], g[1], g[2], g[3], 36, pts);
      }
      polys.push(pts.map(function (p) {
        return [p[0] * S2, -p[1] * S2 + Y_OFF];
      }));
    }
    // 按面积配额撒点（网格抖动，类泊松）：格距 ≈ sqrt(翅面积/配额)，每格至多一只
    // ——分布均匀无空洞、互不叠堆；网格铺到边界，轮廓由形状本身决定（圆润）
    var WING_N = 388, BODY_N = 12;   // 400 只 = 翅面 388 + 身体带 12
    // 配额按**包围盒面积**分配（与网格行列同尺度）——两片翅格距一致、视觉密度统一；
    // 若按翅形实际面积，弯月形的下翅会配到很少的蝴蝶而显得空
    var bboxAreas = [];
    for (var pa = 0; pa < polys.length; pa++) {
      var bx0 = 9, bx1 = -9, by0 = 9, by1 = -9;
      for (var pb = 0; pb < polys[pa].length; pb++) {
        bx0 = Math.min(bx0, polys[pa][pb][0]); bx1 = Math.max(bx1, polys[pa][pb][0]);
        by0 = Math.min(by0, polys[pa][pb][1]); by1 = Math.max(by1, polys[pa][pb][1]);
      }
      bboxAreas.push((bx1 - bx0) * (by1 - by0));
    }
    var areaSum = bboxAreas.reduce(function (a, b) { return a + b; }, 0);
    var quota = bboxAreas.map(function (a) { return Math.floor(WING_N / 2 * a / areaSum); });
    var used = quota.reduce(function (a, b) { return a + b; }, 0);
    quota[0] += WING_N / 2 - used;   // 取整差额补给最大的上翅（每片翅的点会左右镜像成对）
    var targets = [], seed = 1;
    for (var pi = 0; pi < polys.length; pi++) {
      var poly = polys[pi];
      var x0 = 9, x1 = -9, y0 = 9, y1 = -9;
      for (var q = 0; q < poly.length; q++) {
        x0 = Math.min(x0, poly[q][0]); x1 = Math.max(x1, poly[q][0]);
        y0 = Math.min(y0, poly[q][1]); y1 = Math.max(y1, poly[q][1]);
      }
      var bw = x1 - x0, bh = y1 - y0;
      var cols = Math.max(1, Math.round(Math.sqrt(quota[pi] * bw / bh)));
      var rows = Math.max(1, Math.round(quota[pi] / cols));
      var cw = bw / cols, ch = bh / rows;
      var got = 0;
      for (var r2 = 0; r2 < rows && got < quota[pi]; r2++) {
        for (var c2 = 0; c2 < cols && got < quota[pi]; c2++) {
          // 每格 6 个抖动候选（提高边角格命中率、防空洞），取第一个落在翅面内的
          for (var a2 = 0; a2 < 6; a2++) {
            var gx = x0 + (c2 + 0.5 + (rnd(seed++ * 1.7) - 0.5) * 0.85) * cw;
            var gy = y0 + (r2 + 0.5 + (rnd(seed++ * 2.3) - 0.5) * 0.85) * ch;
            if (polyContains(poly, gx, gy)) {
              // 成对镜像：右翅 = 左翅 x 取反（z 抖动独立）→ 左右严格对称
              targets.push({ x: gx, y: gy, z: (rnd(seed++ * 3.1) - 0.5) * 1.6 });
              targets.push({ x: -gx, y: gy, z: (rnd(seed++ * 3.1) - 0.5) * 1.6 });
              got++;
              break;
            }
          }
        }
      }
      // 网格覆盖不满（边角格全在形外）时随机补足
      var guard = 0;
      while (got < quota[pi] && guard < quota[pi] * 300) {
        guard++;
        var rx = lerp(x0, x1, rnd(seed++ * 1.7));
        var ry = lerp(y0, y1, rnd(seed++ * 2.3));
        if (polyContains(poly, rx, ry)) {
          targets.push({ x: rx, y: ry, z: (rnd(seed++ * 3.1) - 0.5) * 1.6 });
          targets.push({ x: -rx, y: ry, z: (rnd(seed++ * 3.1) - 0.5) * 1.6 });
          got++;
        }
      }
    }
    // 身体带 + 腰部过渡（上下翅之间的凹缺区）：稍宽的窄条把腰连起来，避免左右断开
    // 同样成对镜像，保证左右对称（坐标随 S2 放大同步扩）
    for (var b = 0; b < BODY_N / 2; b++) {
      var bxp = (rnd(seed++ * 4.9) - 0.5) * 1.45;
      var byp = -1.75 + rnd(seed++ * 5.9) * 2.85;
      targets.push({ x: bxp, y: byp, z: (rnd(seed++ * 3.1) - 0.5) * 1.6 });
      targets.push({ x: -bxp, y: byp, z: (rnd(seed++ * 3.1) - 0.5) * 1.6 });
    }
    return targets;
  }

  function buildButterflyVertexShader() {
    return [
      'precision highp float;',
      'uniform float uTime;',
      'uniform float uBass;',
      'uniform float uMid;',
      'uniform float uTreble;',
      'uniform float uBeat;',
      'uniform float uPulse;',
      'attribute float aWingV;',
      'attribute float aShade;',
      'attribute float aPhase;',      // 个体扑翅初相
      'attribute vec3 aTintC;',
      'varying vec3 vCol;',
      'varying vec3 vNormalV;',
      'varying float vWing;',
      'varying float vShade;',
      'varying float vGlow;',
      'varying float vFlapW;',
      'void main(){',
      '  vNormalV = normal;',
      '  vWing = aWingV;',
      '  vShade = aShade;',
      // 扑翅（参考稿原口径）：不做 3D 旋转——翅膀以横向收拢系数 w 在画面平面内
      // 「收拢↔展开」，w = 0.18 + 0.82*(0.5-0.5*flap) ∈ [0.18,1]，贝塞尔控制点全乘 w
      '  float flapSpeed = 6.5 + fract(aPhase * 13.7) * 6.5;',   // 参考稿原值
      '  float wave = sin(uTime * flapSpeed + aPhase * 6.28);',
      '  float w = 0.18 + 0.82 * (0.5 - 0.5 * wave);',
      '  w = max(0.10, w - uBass * 0.15 - uBeat * 0.10);',       // 低音/鼓点扑得更深
      '  vec3 p = position;',
      // 横向收拢：翅膀沿 ±x 展开，相对身体中轴缩放（翅根 x=0 天然不动）
      '  p.x *= w;',
      // 前后方向按翅尖权重收缩（对应参考稿控制点 y 也乘 w）
      '  p.z *= 1.0 - (1.0 - w) * aWingV * 0.6;',
      // 高频：翅缘细颤
      '  p.y += uTreble * aWingV * sin(uTime * 21.0 + aPhase * 9.0) * 0.02;',
      '  vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);',
      '  gl_Position = projectionMatrix * viewMatrix * wp;',
      // 亮度：扑翅相位 + 鼓点脉冲（群体明暗呼吸错落）
      '  vGlow = wave * 0.35 + 0.5 + uBeat * 0.40 + uPulse * 0.25;',
      '  vFlapW = w;',
      '  vCol = aTintC;',
      '}'
    ].join('\n');
  }

  function buildButterflyFragmentShader() {
    return [
      'precision highp float;',
      'uniform float uTreble;',
      'uniform float uOpacity;',
      'varying vec3 vCol;',
      'varying vec3 vNormalV;',
      'varying float vWing;',
      'varying float vShade;',
      'varying float vGlow;',
      'varying float vFlapW;',
      'void main(){',
      '  vec3 col;',
      '  if (vWing < 0.01) {',
      // 身体/头：几乎不发光（加色混合下深色≈隐身，与参考稿一致）
      '    col = vec3(0.06, 0.05, 0.10) * vGlow;',
      '  } else {',
      // 翅面：法线朝上亮 / 朝下暗（DoubleSide 翻拍仍有体积）
      '    bool up = vNormalV.y > 0.0;',
      '    col = vCol * (up ? 1.15 : 0.62);',
      // 上翅亮 / 下翅暗（参考稿 uc/lc 双色）+ 靠身体深、翅缘浅
      '    col *= vShade * mix(0.70, 1.14, vWing);',
      // 发光主项：扑翅相位驱动整体明暗呼吸（参考稿小蝶的「呼吸光」）
      '    col *= 0.55 + vGlow * 1.05;',
      // 翅缘白闪（高频驱动；参考稿 w>0.5 翅膀展开时才出现翅点 → 用 vFlapW 门控）
      '    col += vec3(0.88, 0.93, 1.0) * smoothstep(0.68, 1.0, vWing) * smoothstep(0.45, 0.9, vFlapW) * (0.20 + uTreble * 0.45);',
      '  }',
      // 加色混合下 alpha 不参与混色——渐隐直接乘颜色（切预设淡入淡出用）
      '  gl_FragColor = vec4(col * uOpacity, 1.0);',
      '}'
    ].join('\n');
  }

  /** 初始化 CPU 侧飞行状态（分布对齐参考稿：全域均匀 + size 两倍差 + depth 亮度层次） */
  function initFlies() {
    state.flies = [];
    var hues = [25, 210, 285, 340, 45, 170, 310];
    var targets = buildFormationTargets();   // 开场大蝴蝶编队目标
    for (var i = 0; i < COUNT; i++) {
      var hue = hues[i % hues.length] + (rnd(i * 5.1) - 0.5) * 24;
      var depth = rnd(i * 17.3);   // 参考稿 depth：远暗近亮
      var dim = 0.5 + depth * 0.5; // 参考稿 alpha = .5 + depth*.5 → 融进 tint 亮度
      var t = targets[i % targets.length];
      state.flies.push({
        // 参考稿 x:rand(0,W), y:rand(0,H) —— 全域均匀（不是环形带）
        x: (rnd(i * 3.3) - 0.5) * SPAN_X * 2,
        y: (rnd(i * 2.7) - 0.5) * SPAN_Y * 2,
        z: (rnd(i * 23.7) - 0.5) * SPAN_Z * 2,
        vx: 0, vy: 0, vz: 0,
        angle: rnd(i * 11.3) * Math.PI * 2,   // 参考稿 angle：平面内朝向（完整跟随飞行方向）
        // 开场编队目标 + 个体散开节奏（前 1.2s 图案完整保持，之后基本同步错落散开、3.4s 内全散；
        // 个体延迟/历时差异压小——差异大会出现「个别蝴蝶提前出列」的游离观感）
        tx: t.x, ty: t.y, tz: t.z,
        formDelay: 1.2 + rnd(i * 13.7) * 0.4,
        formDur: 1.4 + rnd(i * 19.3) * 0.4,
        formE: 0,
        // 参考稿 size:rand(7,15) → 约 2 倍大小差（两轮各加大 40%/35%：用户逐步要求）
        scale: 0.19 + rnd(i * 9.7) * 0.19,
        wanderPhase: rnd(i * 4.3) * Math.PI * 2,
        wanderSpeed: 0.22 + rnd(i * 6.1) * 0.40,   // 参考稿原值
        flapPhase: rnd(i * 8.9) * Math.PI * 2,
        tint: hsl2rgb(hue, 0.52 + rnd(i * 3.9) * 0.30, 0.55 + rnd(i * 13.1) * 0.10)
          .map(function (c) { return c * dim; })
      });
    }
  }

  function ensureLayer(scene) {
    if (state.initialized) return;
    state.scene = scene;

    var unit = buildButterflyUnit();
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(unit.position, 3));
    geo.setAttribute('aWingV', new THREE.BufferAttribute(unit.wing, 1));
    geo.setIndex(new THREE.BufferAttribute(unit.index, 1));
    geo.computeVertexNormals();

    var mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uBass: { value: 0 },
        uMid: { value: 0 },
        uTreble: { value: 0 },
        uBeat: { value: 0 },
        uEnergy: { value: 0 },
        uPulse: { value: 0 },
        uOpacity: { value: 0 }
      },
      vertexShader: buildButterflyVertexShader(),
      fragmentShader: buildButterflyFragmentShader(),
      side: THREE.DoubleSide,
      // 发光口径（参考稿「Dandelion 蝴蝶」）：加色混合 + 关深度写——黑星野上翅面自发光，
      // 重叠处自然增亮，正是参考稿那种「若隐若现的小光蝶」质感
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      depthTest: true
    });

    var mesh = new THREE.InstancedMesh(geo, mat, COUNT);
    mesh.frustumCulled = false;

    var tintArr = new Float32Array(COUNT * 3);
    var phaseArr = new Float32Array(COUNT);

    initFlies();
    state.dummy = new THREE.Object3D();
    state.dummy.rotation.order = 'YXZ';
    // 基准姿态：模型里大上翅和头在 +z 端、下翅/尾在 -z 端、背朝 +y；
    // 只需绕 x 轴 -90°：头（大翅端）翘到屏幕上方，背翻向镜头 -z
    // → 从机位看过去正是参考稿的 2D 俯视画面：看见蝴蝶的背，大翅/头朝上
    state.qBase = new THREE.Quaternion()
      .setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0, 'YXZ'));
    state.zAxis = new THREE.Vector3(0, 0, 1);

    for (var i = 0; i < COUNT; i++) {
      var f = state.flies[i];
      state.dummy.position.set(f.x, f.y, f.z);
      state.dummy.quaternion.copy(state.qBase);
      state.dummy.scale.setScalar(f.scale);
      state.dummy.updateMatrix();
      mesh.setMatrixAt(i, state.dummy.matrix);
      tintArr[i * 3] = f.tint[0]; tintArr[i * 3 + 1] = f.tint[1]; tintArr[i * 3 + 2] = f.tint[2];
      phaseArr[i] = f.flapPhase;
    }
    geo.setAttribute('aTintC', new THREE.InstancedBufferAttribute(tintArr, 3));
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phaseArr, 1));
    geo.setAttribute('aShade', new THREE.BufferAttribute(unit.shade, 1));
    mesh.instanceMatrix.needsUpdate = true;

    state.mesh = mesh;
    state.mat = mat;
    state.root = new THREE.Group();
    state.root.name = 'audio-butterfly-root';
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
    state.opacity = 0;   // 清掉淡出残量，防止下次切入瞬间半亮
  }

  function isActive(fx) {
    return !!(fx && Number(fx.preset) === INDEX);
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

  function smoothAudio(a, dt) {
    var k = Math.min(1, dt * 60 * 0.18);
    var s = state.smooth;
    s.bass += (a.bass - s.bass) * k;
    s.mid += (a.mid - s.mid) * k;
    s.treble += (a.treble - s.treble) * k;
    s.beat += (a.beat - s.beat) * Math.min(1, dt * 60 * 0.4);
    s.energy += (a.energy - s.energy) * k;
    return s;
  }

  /**
   * 飞行积分（慢速随机飞舞）：多频正弦游走 + 阻尼 + 空间环绕；
   * 速度方向平滑带动朝向。无鼠标交互（2026-11-03 用户要求去除）。
   */
  function integrate(dt) {
    // 编队阶段计时：~3 秒内逐渐打乱
    if (state.formActive) {
      state.formT += dt;
      if (state.formT >= state.FORM_HOLD) state.formActive = false;
    }
    for (var i = 0; i < state.flies.length; i++) {
      var f = state.flies[i];
      // 个体散开系数 e：0=压在编队目标点上，1=完全自由飞行（smoothstep 缓动）
      if (state.formActive) {
        var k = clamp01((state.formT - f.formDelay) / f.formDur);
        f.formE = k * k * (3 - 2 * k);
      } else {
        f.formE = 1;
      }
      f.wanderPhase += f.wanderSpeed * dt;   // 参考稿原式（无额外扰动）
      // 参考稿 wander 原式（逐行照抄）——只有横向 wx 与垂直 wy 两轴，没有第三轴
      var wx = Math.sin(f.wanderPhase * 1.1) * 0.55 + Math.sin(f.wanderPhase * 0.37 + 1.2) * 0.32;
      var wy = Math.cos(f.wanderPhase * 0.83) * 0.42 + Math.sin(f.wanderPhase * 0.29 + 2.1) * 0.22;

      // 参考稿的「世界」是 1920px 宽屏幕，稳态速度 1.71 px/帧 = 屏宽 5%/秒（很慢）；
      // 我们的世界可见宽只有约 13.9 units（fov45 / 半径9.4 / 16:9）——同样参数稳态
      // 位移是 1.71 units/帧 = 每秒横穿屏幕 7 遍！这就是此前怎么减速都「还是快」的
      // 真凶：单位尺度差 138 倍。力按视野宽度换算（0.032 × 13.9/1920 ≈ 0.000232），
      // 阻尼/频率/朝向均保持参考稿原值 → 观感速度与参考稿一致。
      f.vx += wx * 0.032 * 0.00724 * dt * 60;
      f.vy += wy * 0.032 * 0.00724 * dt * 60;
      f.vx *= 0.984; f.vy *= 0.984; f.vz *= 0.984;   // 阻尼参考稿原值；vz 无力自然归零
      f.x += f.vx * dt * 60;
      f.y += f.vy * dt * 60;
      f.z += f.vz * dt * 60;

      // 空间环绕（参考稿方形域 wrap，m=50px → 世界约 0.4）
      var mx = SPAN_X + 0.4, my = SPAN_Y + 0.4, mz = SPAN_Z + 0.4;
      if (f.x < -mx) f.x = SPAN_X; if (f.x > mx) f.x = -SPAN_X;
      if (f.z < -mz) f.z = SPAN_Z; if (f.z > mz) f.z = -SPAN_Z;
      if (f.y < -SPAN_Y - 0.9) f.y = SPAN_Y; if (f.y > SPAN_Y + 0.9) f.y = -SPAN_Y;

      // 朝向（参考稿原式）：头完整转向飞行方向，向右飞头朝右、向下飞头朝下——
      // 原稿「随机飞动」的观感主要来自这个平面内旋转，而非位置轨迹。
      // 编队期统一头朝上（速度接近 0 时 atan2 是纯噪声，不能混）；散开后正常跟随
      if (f.formE < 1) {
        var diffU = Math.PI / 2 - f.angle;
        while (diffU > Math.PI) diffU -= Math.PI * 2;
        while (diffU < -Math.PI) diffU += Math.PI * 2;
        f.angle += diffU * Math.min(1, dt * 3.0);
      } else if (Math.abs(f.vx) > 0.0001 || Math.abs(f.vy) > 0.0001) {
        var ta = Math.atan2(f.vy, f.vx);          // 世界 XY 平面飞行方向角（y 向上系）
        var diff = ta - f.angle;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        f.angle += diff * Math.min(1, dt * 1.8);  // 参考稿原值
      }
    }
  }

  function update(dt, ctx) {
    ctx = ctx || {};
    var fx = ctx.fx || {};
    var scene = ctx.scene;
    if (!scene) return;

    var active = isActive(fx);
    // 切走：立即消失（用户要求，不做渐隐）；切入：opacity 从 0 淡入
    if (!active) {
      if (state.initialized) clearLayer();
      return;
    }
    state.opacity += (1 - state.opacity) * Math.min(1, dt * 3.0);

    ensureLayer(scene);
    if (!state.root) return;

    state.time += dt;
    var audio = smoothAudio(readAudio(ctx.audio), dt);

    var beatOn = audio.beat > 0.55;
    if (beatOn && !state.lastBeat) state.pulse = 1.0;
    state.lastBeat = beatOn;
    state.pulse *= Math.pow(0.02, Math.max(0.001, dt));

    integrate(dt);

    var u = state.mat.uniforms;
    u.uTime.value = state.time;
    u.uOpacity.value = state.opacity;
    u.uBass.value = audio.bass;
    u.uMid.value = audio.mid;
    u.uTreble.value = audio.treble;
    u.uBeat.value = Math.min(1, audio.beat + state.pulse * 0.35);
    u.uEnergy.value = audio.energy;
    u.uPulse.value = state.pulse;

    // 逐实例写矩阵（160 次 compose 可忽略）
    var dummy = state.dummy;
    for (var i = 0; i < state.flies.length; i++) {
      var f = state.flies[i];
      // 编队混合：e=0 压在大蝴蝶轮廓目标点上，e=1 完全自由（位置随散开进度过渡）
      var rx = f.tx + (f.x - f.tx) * f.formE;
      var ry = f.ty + (f.y - f.ty) * f.formE;
      var rz = f.tz + (f.z - f.tz) * f.formE;
      dummy.position.set(rx, ry, rz);
      // 贴屏基准姿态（背对镜头、大翅朝上）× 平面内完整旋转：头始终转向飞行方向
      // （integrate 里 f.angle 已按参考稿平滑更新）——参考稿「随机飞动」的核心观感
      dummy.quaternion.setFromAxisAngle(state.zAxis, f.angle - Math.PI / 2).multiply(state.qBase);
      dummy.scale.setScalar(f.scale);
      dummy.updateMatrix();
      state.mesh.setMatrixAt(i, dummy.matrix);
    }
    state.mesh.instanceMatrix.needsUpdate = true;

    // 跟随宿主拖拽旋转（与 ring/orb/rose 同口径）
    var hostRot = ctx.visualRotation;
    state.root.rotation.y = hostRot && Number.isFinite(Number(hostRot.y)) ? Number(hostRot.y) * 0.35 : 0;
    state.root.rotation.x = hostRot && Number.isFinite(Number(hostRot.x)) ? Number(hostRot.x) * 0.35 : 0;

    state.root.visible = state.opacity > 0.02;
  }

  function onPresetChange(prev, next, ctx) {
    // 切走：不在这里销毁——交给 update 立即清场（否则淡出期间 ensureLayer
    // 会把蝶群原样重建，造成「切走后蝴蝶滞留几秒才硬消失」）
    // 切入：立即重建并显示，同时启动「大蝴蝶编队 → 3 秒打乱」开场
    if (Number(next) === INDEX && ctx && ctx.scene) {
      if (state.initialized) clearLayer();
      ensureLayer(ctx.scene);
      state.root.visible = true;
      state.formActive = true;
      state.formT = 0;
    }
  }

  global.MineradioAudioButterfly = {
    INDEX: INDEX,
    isActive: isActive,
    update: update,
    clear: clearLayer,
    onPresetChange: onPresetChange,
    /** 调试/验证出口：CPU 侧飞行状态（位置、速度、朝向） */
    getFlies: function () { return state.flies; },
    /** 调试/验证出口：渲染层状态（是否初始化、可见性、淡入淡出系数） */
    getStatus: function () {
      return {
        initialized: state.initialized,
        visible: !!(state.root && state.root.visible),
        opacity: Number(state.opacity.toFixed(3))
      };
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
