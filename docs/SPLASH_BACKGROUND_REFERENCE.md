# 启动页背景特效 — 完整代码汇总

> 用于移植/二次创作。全部代码自包含（WebGL shader + 2D 回退双路径），无外部依赖。
> 采集自 `BhandsMusicChange`（2026-09-22，已与 Web 版逐字对齐）。
>
> ⚠️ 下表里的 `public/js/main.js` 行号对应**拆分前的基线 `784afe6`**。该文件已于 2026-09-24
> 先按 48 个分区拆成 `public/js/app/01…16`、再按职责重排成 `00-prelude.js` + `01…18`（共 19 个），
> 下表内容落在 `public/js/app/17-shell.js`（原 `15-shell.js`，§41 启动页；重排后外壳/启动页相关都在 17-shell）。

## 1. 结构概览（四层叠加，从下到上）

```
┌─ z-index 0  #splash::before   静态底：网格线 + 斜向色带 + 垂直渐变，7s 呼吸（blur .4px）
├─ z-index 1  #splash-canvas    动态层：WebGL shader（主）/ 2D canvas（回退）
├─ z-index 2  #splash::after    暗角：左右 + 上下双向 vignette
├─ z-index 3  .splash-bg-noise 噪点：SVG feTurbulence 平铺，screen 混合，透明度 .038
└─ z-index 10 .splash-content  内容层：品牌字 / 光带 / 副标题（本次不涉及）
```

## 2. 文件与行号索引

| 内容 | 文件 | 行号 |
|---|---|---|
| CSS 背景四层 | `public/styles/main.css` | 150-158 |
| CSS 呼吸关键帧 | `public/styles/main.css` | 173 |
| JS 状态变量 + 工具函数 | `public/js/main.js` | 25532-25557 |
| JS WebGL 初始化（含 shader 源码） | `public/js/main.js` | 25558-25729 |
| JS WebGL 每帧绘制 | `public/js/main.js` | 25730-25742 |
| JS 初始化 + resize + 数据生成 | `public/js/main.js` | 25743-25812 |
| JS 2D canvas 回退绘制 | `public/js/main.js` | 25814-25977 |

## 3. CSS 层（背景四层 + 呼吸）

```css
#splash{position:fixed;inset:0;z-index:300;background:#010304;display:flex;align-items:center;justify-content:center;pointer-events:auto;opacity:1;overflow:hidden;transition:opacity 1180ms cubic-bezier(.16,1,.3,1),transform 1180ms cubic-bezier(.16,1,.3,1);box-shadow:inset 0 0 180px rgba(0,0,0,.88)}
#splash::before{content:'';position:absolute;inset:-8%;z-index:0;background:linear-gradient(115deg,transparent 0%,rgba(255,83,103,.055) 24%,transparent 42%,rgba(244,210,138,.052) 62%,transparent 82%),repeating-linear-gradient(90deg,rgba(255,255,255,.030) 0 1px,transparent 1px 54px),repeating-linear-gradient(0deg,rgba(255,255,255,.020) 0 1px,transparent 1px 46px),linear-gradient(180deg,#020606 0%,#050607 42%,#000 100%);filter:blur(.4px);opacity:.90;animation:splash-field-breathe 7s ease-in-out infinite alternate;pointer-events:none}
#splash::after{content:'';position:absolute;inset:0;z-index:2;background:linear-gradient(90deg,rgba(0,0,0,.82),transparent 21%,transparent 79%,rgba(0,0,0,.82)),linear-gradient(180deg,rgba(0,0,0,.68),transparent 32%,transparent 64%,rgba(0,0,0,.74));pointer-events:none}
#splash.hide{pointer-events:none}
#splash.ready{cursor:pointer}
#splash.exiting{pointer-events:none;opacity:0;transform:scale(1.018)}
#splash-canvas{position:absolute;inset:0;z-index:1;opacity:1;transition:opacity 1100ms cubic-bezier(.22,1,.36,1),transform 1100ms cubic-bezier(.22,1,.36,1)}
#splash.exiting #splash-canvas{opacity:.30;transform:scale(1.012)}
.splash-bg-noise{position:absolute;inset:0;z-index:3;opacity:.038;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.55'/%3E%3C/svg%3E");background-size:180px 180px;mix-blend-mode:screen;pointer-events:none}
```

```css
@keyframes splash-field-breathe{0%{opacity:.72;transform:scale(1)}100%{opacity:1;transform:scale(1.035)}}
```

要点：
- `#splash` 自带 `box-shadow: inset 0 0 180px rgba(0,0,0,.88)` 形成屏幕内缘压暗。
- `::before` 用 `inset:-8%` 外扩，呼吸时 `scale(1→1.035)` 不会露边。
- `filter: blur(.4px)` 只做轻微柔化（值大很贵，勿加大）。
- 噪点用内联 SVG `feTurbulence`（baseFrequency .9 / numOctaves 2），`mix-blend-mode:screen`。

## 4. JS 完整代码（状态 → 工具 → WebGL → 2D）

```javascript
var splashAnimating = true;
var splashCanvas = null, splashCtx = null;
var splashGl = null, splashGlProgram = null, splashGlBuffer = null, splashGlUniforms = null;
var splashW = 0, splashH = 0;
var splashDust = [];
var splashStreaks = [];
var splashShards = [];
var splashPixelRatio = 1;
var splashStartedAt = performance.now();
var splashSoundPlayed = false;
var splashAudioCtx = null;
var splashSoundFallbackArmed = false;
var splashTimer = null;
var reduceSplashMotion = false;
var splashReadyToEnter = false;

function splashClamp01(v) { return Math.max(0, Math.min(1, v)); }
function splashSmoothstep(edge0, edge1, x) {
  var t = splashClamp01((x - edge0) / Math.max(0.0001, edge1 - edge0));
  return t * t * (3 - 2 * t);
}
function splashEaseOutCubic(t) {
  t = splashClamp01(t);
  return 1 - Math.pow(1 - t, 3);
}

function initBhandsMusicSplashWebgl(canvas) {
  var gl = null;
  try {
    gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance'
    }) || canvas.getContext('experimental-webgl');
  } catch (e) {
    gl = null;
  }
  if (!gl) return false;

  var vertexSource = [
    'attribute vec2 aPosition;',
    'varying vec2 vUv;',
    'void main(){',
    '  vUv = aPosition * 0.5 + 0.5;',
    '  gl_Position = vec4(aPosition, 0.0, 1.0);',
    '}'
  ].join('\n');

  var fragmentSource = [
    'precision highp float;',
    'varying vec2 vUv;',
    'uniform vec2 uResolution;',
    'uniform float uTime;',
    '',
    'float saturate(float v){ return clamp(v, 0.0, 1.0); }',
    'float ease(float v){ v = saturate(v); return v * v * (3.0 - 2.0 * v); }',
    'mat2 rot(float a){ float c = cos(a); float s = sin(a); return mat2(c, -s, s, c); }',
    'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }',
    'float noise(vec2 p){',
    '  vec2 i = floor(p);',
    '  vec2 f = fract(p);',
    '  vec2 u = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(hash(i), hash(i + vec2(1.0,0.0)), u.x), mix(hash(i + vec2(0.0,1.0)), hash(i + vec2(1.0,1.0)), u.x), u.y);',
    '}',
    '',
    'float animatedLoop(vec2 uv, float t, float channel){',
    '  vec2 q = uv;',
    '  q *= rot(0.28 + sin(t * 0.18) * 0.12);',
    '  q.x += 0.055 * sin(t * 0.30 + channel);',
    '  q.y += 0.040 * cos(t * 0.24 + channel * 1.7);',
    '  float ang = atan(q.y, q.x);',
    '  float angularShift = sin(ang * 3.0 + t * 0.72 + channel * 1.9) * 0.078;',
    '  angularShift += sin(ang * 7.0 - t * 0.54 + channel) * 0.020;',
    '  float neonD = length(q) + angularShift;',
    '  float warpD = length(q * vec2(1.34 + 0.06 * sin(t * 0.25), 0.82 + 0.04 * cos(t * 0.31)));',
    '  warpD += 0.026 * sin(q.x * 4.4 + t * 0.62) + 0.018 * sin(q.y * 5.2 - t * 0.45);',
    '  float diamondD = abs(q.x) * 1.20 + abs(q.y) * 0.84;',
    '  float d = mix(warpD, diamondD, 0.32);',
    '  d = mix(d, neonD, 0.20 + 0.04 * sin(t * 0.18 + channel));',
    '  float pattern = mod((q.x + q.y) * 0.62 + sin(q.x * 5.5 + t) * 0.015 + sin(q.y * 7.0 - t * 0.75) * 0.012, 0.20);',
    '  float acc = 0.0;',
    '  for (int i = 1; i <= 6; i++) {',
    '    float fi = float(i);',
    '    float f = fract(t * 0.152 - channel * 0.018 + 0.011 * fi) * 4.70 - d + pattern;',
    '    acc += 0.00110 * fi * fi / max(abs(f), 0.0065);',
    '  }',
    '  float threadCoord = q.x * 0.92 - q.y * 0.58 + 0.030 * sin(q.x * 5.2 + t * 0.72);',
    '  float threadLines = 0.0065 / max(abs(sin((threadCoord + t * 0.10 + channel * 0.035) * 27.0)), 0.070);',
    '  acc += threadLines * (0.50 + 0.30 * sin(ang * 1.2 + t + channel));',
    '  return min(acc, 1.95);',
    '}',
    '',
    'void main(){',
    '  vec2 p = vUv * 2.0 - 1.0;',
    '  p.x *= uResolution.x / max(uResolution.y, 1.0);',
    '  float t = uTime;',
    '  float intro = ease(t / 0.72);',
    '  float bloomIn = ease((t - 0.10) / 1.10);',
    '  float climax = exp(-pow((t - 3.62) / 0.58, 2.0));',
    '  float preClimax = ease((t - 2.15) / 1.25) * (1.0 - ease((t - 3.86) / 0.72));',
    '  float afterglow = exp(-pow((t - 4.14) / 0.62, 2.0));',
    '  float calm = 1.0 - 0.22 * ease((t - 4.75) / 0.70);',
    '  float settle = 1.0 - 0.34 * ease((t - 5.05) / 0.52);',
    '  vec2 uv = p * (0.98 + 0.05 * sin(t * 0.25));',
    '  uv += vec2(0.0, -0.025);',
    '  vec2 flowAxis = normalize(vec2(0.86, -0.50));',
    '  vec2 crossAxis = vec2(-flowAxis.y, flowAxis.x);',
    '  float lane = dot(p, flowAxis);',
    '  float crossLane = dot(p, crossAxis);',
    '  float syncWave = sin(crossLane * 5.4 + lane * 1.1 - t * 1.85);',
    '  uv += flowAxis * syncWave * 0.055 * climax;',
    '  uv += crossAxis * sin(lane * 7.2 + t * 1.25) * 0.034 * climax;',
    '  uv *= 1.0 + 0.045 * preClimax - 0.020 * climax;',
    '  vec3 ch1 = vec3(1.00, 0.13, 0.31);',
    '  vec3 ch2 = vec3(0.16, 1.00, 0.86);',
    '  vec3 ch3 = vec3(1.00, 0.76, 0.28);',
    '  float a = animatedLoop(uv, t, 0.0);',
    '  float b = animatedLoop(uv * 1.018 + vec2(0.012, -0.008), t + 0.18, 1.0);',
    '  float c = animatedLoop(uv * 0.986 + vec2(-0.010, 0.010), t + 0.35, 2.0);',
    '  vec3 loopCol = ch1 * a + ch2 * b + ch3 * c;',
    '  float tunnel = animatedLoop(uv * 1.42 + vec2(sin(t * 0.2) * 0.08, cos(t * 0.17) * 0.05), t * 1.12 + 1.7, 2.7);',
    '  loopCol += mix(ch2, ch3, 0.35 + 0.25 * sin(t)) * tunnel * (0.30 + 0.24 * preClimax);',
    '  float syncBand = exp(-pow((lane + 0.08 * sin(t * 0.72)) / 0.62, 2.0));',
    '  float phaseThread = pow(0.5 + 0.5 * sin(crossLane * 13.5 + lane * 2.2 - t * 3.1), 8.0);',
    '  float phaseThread2 = pow(0.5 + 0.5 * sin(crossLane * 9.0 - lane * 5.4 + t * 2.4), 10.0);',
    '  vec3 climaxCol = (mix(ch2, ch3, 0.36) * phaseThread + ch1 * phaseThread2 * 0.52) * syncBand * climax;',
    '  float afterBand = exp(-pow((lane - 0.34) / 0.72, 2.0));',
    '  climaxCol += mix(ch1, ch2, vUv.x) * afterBand * afterglow * 0.13;',
    '  float centerBeam = exp(-abs(p.y + 0.005 * sin(t * 3.0)) * 24.0) * (0.14 + 0.52 * exp(-pow((t - 0.74) / 0.34, 2.0)));',
    '  float bladeMask = smoothstep(-1.55, -0.08, p.x) * (1.0 - smoothstep(0.08, 1.55, p.x));',
    '  vec3 blade = mix(ch1, ch2, vUv.x) * centerBeam * bladeMask * (0.40 + 0.28 * climax);',
    '  float flare = exp(-dot(p, p) * 3.6) * exp(-pow((t - 0.88) / 0.40, 2.0));',
    '  vec3 col = vec3(0.002, 0.004, 0.005);',
    '  col += loopCol * (0.56 + 0.46 * bloomIn) * calm * settle;',
    '  col += climaxCol * 0.22;',
    '  float diagonalGlint = exp(-pow(lane * 1.2 + crossLane * 0.10, 2.0) / 0.030) * climax;',
    '  col += blade + vec3(1.0, 0.78, 0.42) * flare * 0.18 + vec3(1.0, 0.86, 0.58) * diagonalGlint * 0.07;',
    '  float scan = 0.92 + 0.08 * sin((vUv.y * uResolution.y + t * 52.0) * 0.72);',
    '  float grain = noise(vUv * uResolution.xy * 0.52 + t * 17.0) - 0.5;',
    '  col *= scan;',
    '  col += grain * 0.018;',
    '  col *= intro;',
    '  col = max(col - vec3(0.010, 0.012, 0.012), 0.0);',
    '  col = vec3(1.0) - exp(-max(col, 0.0) * (0.62 + 0.18 * climax));',
    '  float vignette = smoothstep(1.52, 0.20, length(p * vec2(0.78, 1.04)));',
    '  col *= 0.38 + 0.86 * vignette;',
    '  col += vec3(0.020, 0.010, 0.014) * (1.0 - vignette);',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  function compile(type, source) {
    var shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn('Splash shader compile failed:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  var vertexShader = compile(gl.VERTEX_SHADER, vertexSource);
  var fragmentShader = compile(gl.FRAGMENT_SHADER, fragmentSource);
  if (!vertexShader || !fragmentShader) return false;

  var program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('Splash shader link failed:', gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return false;
  }

  splashGl = gl;
  splashGlProgram = program;
  splashGlBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, splashGlBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  splashGlUniforms = {
    position: gl.getAttribLocation(program, 'aPosition'),
    resolution: gl.getUniformLocation(program, 'uResolution'),
    time: gl.getUniformLocation(program, 'uTime')
  };
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  return true;
}

function drawBhandsMusicSplashWebgl(elapsed) {
  var gl = splashGl;
  if (!gl || !splashGlProgram || !splashGlUniforms) return;
  gl.viewport(0, 0, splashCanvas.width, splashCanvas.height);
  gl.useProgram(splashGlProgram);
  gl.bindBuffer(gl.ARRAY_BUFFER, splashGlBuffer);
  gl.enableVertexAttribArray(splashGlUniforms.position);
  gl.vertexAttribPointer(splashGlUniforms.position, 2, gl.FLOAT, false, 0, 0);
  gl.uniform2f(splashGlUniforms.resolution, splashCanvas.width, splashCanvas.height);
  gl.uniform1f(splashGlUniforms.time, elapsed);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

(function initBhandsMusicSplashCanvas() {
  splashCanvas = document.getElementById('splash-canvas');
  if (!splashCanvas) return;
  if (!reduceSplashMotion && initBhandsMusicSplashWebgl(splashCanvas)) {
    splashCtx = null;
  } else {
    splashCtx = splashCanvas.getContext('2d');
  }
  function resize() {
    // DPR 上限按渲染路径区分（对齐 Web 版 SplashCanvas）：
    //   WebGL 路径 1.25 —— 全屏 shader 像素量比 1.6 少约 39%，启动页动画明显更丝滑；
    //   2D 回退路径 1.6 —— CPU 绘制时高 DPR 影响较小，保持清晰度。
    var splashDpr = Math.max(1, window.devicePixelRatio || 1);
    splashPixelRatio = splashGl ? Math.min(1.25, splashDpr) : Math.min(1.6, splashDpr);
    splashW = window.innerWidth;
    splashH = window.innerHeight;
    splashCanvas.width = Math.max(1, Math.floor(splashW * splashPixelRatio));
    splashCanvas.height = Math.max(1, Math.floor(splashH * splashPixelRatio));
    if (splashCtx) splashCtx.setTransform(splashPixelRatio, 0, 0, splashPixelRatio, 0, 0);
    if (splashGl) splashGl.viewport(0, 0, splashCanvas.width, splashCanvas.height);
    splashDust = [];
    splashStreaks = [];
    splashShards = [];
    var count = reduceSplashMotion ? 28 : 84;
    for (var i = 0; i < count; i++) {
      splashDust.push({
        x: Math.random() * splashW,
        y: Math.random() * splashH,
        vx: (Math.random() - 0.5) * 0.18,
        vy: (Math.random() - 0.5) * 0.11,
        r: Math.random() * 1.35 + 0.28,
        a: Math.random() * 0.105 + 0.025,
        p: Math.random() * Math.PI * 2
      });
    }
    var streakColors = [
      'rgba(244,210,138,',
      'rgba(122,215,194,',
      'rgba(255,83,103,',
      'rgba(157,184,207,'
    ];
    var streakCount = reduceSplashMotion ? 6 : 22;
    for (var s = 0; s < streakCount; s++) {
      splashStreaks.push({
        x: Math.random() * splashW,
        y: splashH * (0.20 + Math.random() * 0.62),
        len: splashW * (0.12 + Math.random() * 0.24),
        width: 0.75 + Math.random() * 2.1,
        speed: splashW * (0.00028 + Math.random() * 0.00042),
        angle: (-10 + Math.random() * 20) * Math.PI / 180,
        phase: Math.random() * Math.PI * 2,
        color: streakColors[s % streakColors.length],
        delay: Math.random() * 1.1,
        alpha: 0.18 + Math.random() * 0.36
      });
    }
    var shardCount = reduceSplashMotion ? 10 : 34;
    for (var h = 0; h < shardCount; h++) {
      splashShards.push({
        ox: (Math.random() - 0.5) * splashW * 0.92,
        oy: (Math.random() - 0.5) * splashH * 0.22,
        w: 18 + Math.random() * 86,
        h: 1 + Math.random() * 5,
        skew: (Math.random() - 0.5) * 20,
        phase: Math.random() * Math.PI * 2,
        color: streakColors[h % streakColors.length],
        alpha: 0.10 + Math.random() * 0.24
      });
    }
  }
  resize();
  window.addEventListener('resize', resize);
  drawBhandsMusicSplash();
})();

function drawBhandsMusicSplash() {
  if (!splashAnimating || (!splashCtx && !splashGl)) return;
  requestAnimationFrame(drawBhandsMusicSplash);
  var elapsed = (performance.now() - splashStartedAt) / 1000;
  if (splashGl && splashGlProgram) {
    drawBhandsMusicSplashWebgl(elapsed);
    return;
  }
  splashCtx.clearRect(0, 0, splashW, splashH);

  var base = splashCtx.createLinearGradient(0, 0, splashW, splashH);
  base.addColorStop(0, 'rgba(1,6,7,0.68)');
  base.addColorStop(0.45, 'rgba(10,9,12,0.74)');
  base.addColorStop(1, 'rgba(0,0,0,0.84)');
  splashCtx.fillStyle = base;
  splashCtx.fillRect(0, 0, splashW, splashH);

  splashCtx.save();
  splashCtx.globalAlpha = 0.22;
  splashCtx.fillStyle = 'rgba(255,255,255,0.035)';
  var scanOffset = (elapsed * 28) % 36;
  for (var sy = -scanOffset; sy < splashH; sy += 36) splashCtx.fillRect(0, sy, splashW, 1);
  splashCtx.restore();

  for (var i = 0; i < splashDust.length; i++) {
    var d = splashDust[i];
    d.x += d.vx;
    d.y += d.vy;
    d.p += 0.018;
    if (d.x < -10) d.x = splashW + 10;
    if (d.x > splashW + 10) d.x = -10;
    if (d.y < -10) d.y = splashH + 10;
    if (d.y > splashH + 10) d.y = -10;
    var alpha = d.a * (0.58 + Math.sin(d.p + elapsed * 0.8) * 0.34);
    splashCtx.beginPath();
    splashCtx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
    splashCtx.fillStyle = 'rgba(255,255,255,' + Math.max(0, alpha) + ')';
    splashCtx.fill();
  }

  splashCtx.save();
  splashCtx.globalCompositeOperation = 'lighter';
  for (var k = 0; k < splashStreaks.length; k++) {
    var st = splashStreaks[k];
    var travel = (elapsed * st.speed * 240 + st.x + Math.sin(elapsed * 0.8 + st.phase) * 28) % (splashW + st.len + 180);
    var px = travel - st.len - 90;
    var py = st.y + Math.sin(elapsed * 0.75 + st.phase) * 18;
    var fade = splashSmoothstep(st.delay * 0.55, st.delay * 0.55 + 0.52, elapsed) * (1 - splashSmoothstep(3.52, 4.12, elapsed));
    if (fade <= 0) continue;
    splashCtx.save();
    splashCtx.translate(px, py);
    splashCtx.rotate(st.angle);
    var sg = splashCtx.createLinearGradient(-st.len * 0.5, 0, st.len * 0.5, 0);
    sg.addColorStop(0, st.color + '0)');
    sg.addColorStop(0.52, st.color + (st.alpha * fade).toFixed(3) + ')');
    sg.addColorStop(1, 'rgba(255,255,255,0)');
    splashCtx.strokeStyle = sg;
    splashCtx.lineWidth = st.width;
    splashCtx.shadowColor = st.color + (0.34 * fade).toFixed(3) + ')';
    splashCtx.shadowBlur = 18;
    splashCtx.beginPath();
    splashCtx.moveTo(-st.len * 0.5, 0);
    splashCtx.lineTo(st.len * 0.5, 0);
    splashCtx.stroke();
    splashCtx.restore();
  }

  var lineT = splashEaseOutCubic((elapsed - 0.12) / 1.18);
  var exitFade = 1 - splashSmoothstep(3.58, 4.12, elapsed);
  if (lineT > 0 && exitFade > 0) {
    var centerY = splashH * 0.5 + Math.sin(elapsed * 1.4) * 1.6;
    var slitW = splashW * (0.16 + lineT * 0.72);
    var left = splashW * 0.5 - slitW * 0.5;
    var right = splashW * 0.5 + slitW * 0.5;
    var coreAlpha = (0.34 + lineT * 0.58) * exitFade;
    var slitGrad = splashCtx.createLinearGradient(left, centerY, right, centerY);
    slitGrad.addColorStop(0, 'rgba(255,83,103,0)');
    slitGrad.addColorStop(0.18, 'rgba(255,83,103,' + (0.18 * exitFade).toFixed(3) + ')');
    slitGrad.addColorStop(0.50, 'rgba(255,255,255,' + coreAlpha.toFixed(3) + ')');
    slitGrad.addColorStop(0.68, 'rgba(244,210,138,' + (0.38 * exitFade).toFixed(3) + ')');
    slitGrad.addColorStop(0.84, 'rgba(122,215,194,' + (0.20 * exitFade).toFixed(3) + ')');
    slitGrad.addColorStop(1, 'rgba(122,215,194,0)');
    splashCtx.shadowColor = 'rgba(244,210,138,' + (0.48 * exitFade).toFixed(3) + ')';
    splashCtx.shadowBlur = 42 + lineT * 42;
    splashCtx.lineCap = 'round';
    splashCtx.strokeStyle = slitGrad;
    splashCtx.lineWidth = 1.4 + lineT * 2.2;
    splashCtx.beginPath();
    splashCtx.moveTo(left, centerY);
    splashCtx.lineTo(right, centerY);
    splashCtx.stroke();

    var ignition = Math.exp(-Math.pow((elapsed - 0.72) / 0.26, 2));
    if (ignition > 0.018) {
      var ig = splashCtx.createLinearGradient(0, centerY, splashW, centerY);
      ig.addColorStop(0, 'rgba(122,215,194,0)');
      ig.addColorStop(0.46, 'rgba(122,215,194,' + (0.07 * ignition).toFixed(3) + ')');
      ig.addColorStop(0.50, 'rgba(255,255,255,' + (0.16 * ignition).toFixed(3) + ')');
      ig.addColorStop(0.54, 'rgba(255,83,103,' + (0.08 * ignition).toFixed(3) + ')');
      ig.addColorStop(1, 'rgba(244,210,138,0)');
      splashCtx.fillStyle = ig;
      splashCtx.fillRect(0, centerY - 48 * ignition, splashW, 96 * ignition);
    }

    var waveAlpha = splashSmoothstep(0.72, 1.95, elapsed) * exitFade;
    if (waveAlpha > 0) {
      splashCtx.shadowBlur = 20;
      splashCtx.strokeStyle = 'rgba(244,210,138,' + (0.22 * waveAlpha).toFixed(3) + ')';
      splashCtx.lineWidth = 1;
      splashCtx.beginPath();
      var steps = 82;
      for (var wi = 0; wi <= steps; wi++) {
        var u = wi / steps;
        var x = left + slitW * u;
        var edge = 1 - Math.abs(u - 0.5) * 2;
        var amp = (4 + 18 * lineT) * Math.pow(Math.max(0, edge), 1.4) * waveAlpha;
        var y = centerY + Math.sin(u * 34 + elapsed * 8.2) * amp + Math.sin(u * 87 - elapsed * 5.1) * amp * 0.18;
        if (wi === 0) splashCtx.moveTo(x, y);
        else splashCtx.lineTo(x, y);
      }
      splashCtx.stroke();
    }

    var shardT = splashSmoothstep(0.72, 2.45, elapsed) * exitFade;
    for (var si = 0; si < splashShards.length; si++) {
      var sh = splashShards[si];
      var drift = Math.sin(elapsed * 1.7 + sh.phase) * 22;
      var sx = splashW * 0.5 + sh.ox * (0.18 + shardT * 0.82) + drift;
      var sy2 = centerY + sh.oy * (0.20 + shardT * 0.92);
      var localAlpha = sh.alpha * shardT * (0.62 + Math.sin(elapsed * 5 + sh.phase) * 0.38);
      if (localAlpha <= 0) continue;
      splashCtx.save();
      splashCtx.translate(sx, sy2);
      splashCtx.rotate((-6 + sh.skew * 0.10) * Math.PI / 180);
      splashCtx.fillStyle = sh.color + Math.max(0, localAlpha).toFixed(3) + ')';
      splashCtx.shadowColor = sh.color + Math.min(0.38, localAlpha * 1.2).toFixed(3) + ')';
      splashCtx.shadowBlur = 14;
      splashCtx.beginPath();
      splashCtx.moveTo(-sh.w * 0.5, -sh.h * 0.5);
      splashCtx.lineTo(sh.w * 0.5, -sh.h * 0.5);
      splashCtx.lineTo(sh.w * 0.5 + sh.skew, sh.h * 0.5);
      splashCtx.lineTo(-sh.w * 0.5 + sh.skew, sh.h * 0.5);
      splashCtx.closePath();
      splashCtx.fill();
      splashCtx.restore();
    }

    var flash = Math.exp(-Math.pow((elapsed - 2.52) / 0.38, 2));
    if (flash > 0.015) {
      var fg = splashCtx.createLinearGradient(0, centerY, splashW, centerY);
      fg.addColorStop(0, 'rgba(255,83,103,0)');
      fg.addColorStop(0.48, 'rgba(255,255,255,' + (0.20 * flash).toFixed(3) + ')');
      fg.addColorStop(0.52, 'rgba(244,210,138,' + (0.24 * flash).toFixed(3) + ')');
      fg.addColorStop(1, 'rgba(122,215,194,0)');
      splashCtx.fillStyle = fg;
      splashCtx.fillRect(0, centerY - 46 * flash, splashW, 92 * flash);
    }
  }
  splashCtx.restore();
}
```

## 5. 移植指南

### 5.1 最小依赖

- 一个容器元素（`position:relative`）+ 一个 `<canvas>` 子元素（`position:absolute; inset:0; z-index:1`）。
- 代码只用到 `document.getElementById`、`requestAnimationFrame`、`performance.now`，无框架/库依赖。
- WebGL 失败自动回退 2D canvas（`splashGl` 为 null 即走 2D），无需额外处理。

### 5.2 需要改的接入点

| 变量/函数 | 作用 | 移植时改成 |
|---|---|---|
| `splashCanvas` | canvas 引用 | 你的 canvas 元素 |
| `splashStartedAt` | 动画起点时间 | 你的启动时刻 |
| `splashAnimating` | 运行开关 | 你的显示/隐藏状态 |
| `drawBhandsMusicSplash()` | 每帧入口（自驱动 rAF 循环） | 直接调用即可启动 |
| `splashW / splashH` | 视口尺寸（resize 时更新） | 容器尺寸（若不满屏） |
| `splashPixelRatio` | DPR 上限（WebGL 1.25 / 2D 1.6） | 保持或按性能调 |

### 5.3 可直接调的效果参数

| 想改什么 | 位置 | 说明 |
|---|---|---|
| 整体时长 | shader 内 `t` 的时间轴断点（2.15 / 3.86 / 4.14 / 4.75 / 5.05） | 单位秒，等比缩放即可 |
| 粒子/光带/碎片数量 | `resize()` 内 `count`(84) / `streakCount`(22) / `shardCount`(34) | 降低可省性能 |
| 色板 | shader 内 `ch1/ch2` 与 `streakColors` 数组 | 金 #F4D28A / 青 #7AD7C2 / 红 #FF5367 / 蓝灰 #9DB8CF |
| 中央闪光时刻 | 2D 路径 `Math.exp(-((elapsed - 2.52)/0.38)^2)` | 高斯峰值时间（秒） |
| 关闭动画（省电） | `reduceSplashMotion` | 置 true 走精简路径（28 粒子/6 光带/10 碎片） |

### 5.4 性能注意（踩过的坑）

1. **DPR 上限**：全屏 shader 用 1.25（原 1.6 时像素量多 64%，明显掉帧）；2D 回退用 1.6。
2. **避免在动画元素上加 `filter: drop-shadow`**：会导致每帧重算（父级 filter 同样影响子元素动画）。
3. **`will-change` 只写 `opacity,transform`**：不要加 `letter-spacing` 等会触发布局的属性。
4. **启动期别抢主线程**：网络请求 / 音频探测等重活推迟到动画结束后（本项目把音源预解析移到 splash 结束 +700ms）。
5. **分段缓动**：多个关键帧各自指定 `animation-timing-function`（如 `.22,1,.36,1` / `.4,0,.6,1` / `.6,.02,.25,1`）比全局一条曲线自然得多。

### 5.5 与内容层的联动（可选）

- 动画结束（`splashAnimating = false`）时给 `#splash` 加 `.exiting`：canvas 变 `opacity:.30; scale(1.012)`。
- 退出序列：`.splash-content` 淡出 680ms → `#splash` 整体 opacity/scale 过渡 1180ms。
