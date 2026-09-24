'use strict';

// ============================================================
//  03-particles.js  ←  源 main.js §6–§11（基线 784afe6）
//  主粒子 shader / 背景星河 / 浮空粒子 / 安魂层 / 封面背面粒子
// ============================================================

// ============================================================
//  主粒子系统
//   - 预设 0–5 原 shader + 9–17 Web 移植（极光…字符雨）；6–8 为安魂/音域回响独立层
//   - 共享: 封面色采样, 鼠标交互, 粒子大小限制
// ============================================================
var PLANE_SIZE = 4.8;
var RIPPLE_MAX = 12;

var GRID_X = coverParticleGridForResolution(fx.coverResolution), GRID_Y = GRID_X;
var PCOUNT = GRID_X * GRID_Y;
var positions = null, uvs = null, aRand = null;
var coverResolutionReloadTimer = null;
var currentCoverSource = null;
var coverPickerCanvas = null;

function buildCoverParticleGeometry(grid) {
  grid = coverParticleGridForResolution(grid / 118);
  var count = grid * grid;
  var nextGeo = new THREE.BufferGeometry();
  var nextPositions = new Float32Array(count * 3);
  var nextUvs = new Float32Array(count * 2);
  var nextRand = new Float32Array(count);
  var texelStep = 1 / grid;
  for (var i = 0; i < count; i++) {
    var gx = i % grid, gy = Math.floor(i / grid);
    var u = (gx + 0.5) * texelStep, v = (gy + 0.5) * texelStep;
    var px = gx / (grid - 1), py = gy / (grid - 1);
    nextPositions[i*3]   = (px - 0.5) * PLANE_SIZE;
    nextPositions[i*3+1] = (py - 0.5) * PLANE_SIZE;
    nextPositions[i*3+2] = 0;
    nextUvs[i*2]   = u;
    nextUvs[i*2+1] = v;
    nextRand[i]   = Math.random();
  }
  nextGeo.setAttribute('position', new THREE.BufferAttribute(nextPositions, 3));
  nextGeo.setAttribute('aUv',      new THREE.BufferAttribute(nextUvs, 2));
  nextGeo.setAttribute('aRand',    new THREE.BufferAttribute(nextRand, 1));
  nextGeo.userData.grid = grid;
  nextGeo.userData.count = count;
  positions = nextPositions;
  uvs = nextUvs;
  aRand = nextRand;
  return nextGeo;
}

var geo = buildCoverParticleGeometry(GRID_X);

function applyCoverParticleResolution(value, opts) {
  opts = opts || {};
  fx.coverResolution = normalizeCoverResolution(value);
  var grid = coverParticleGridForResolution(fx.coverResolution);
  if (grid === GRID_X && geo && geo.userData && geo.userData.grid === grid) return;
  var oldGeo = geo;
  var nextGeo = buildCoverParticleGeometry(grid);
  geo = nextGeo;
  GRID_X = GRID_Y = grid;
  PCOUNT = grid * grid;
  if (particles) particles.geometry = nextGeo;
  if (bloomParticles) bloomParticles.geometry = nextGeo;
  if (oldGeo && oldGeo !== nextGeo) oldGeo.dispose();
  uniforms.uBurstAmt.value = Math.max(uniforms.uBurstAmt.value, 0.18);
  if (uniforms.uGrid) uniforms.uGrid.value = grid;
  if (typeof WebFxPresets !== 'undefined') WebFxPresets.state.activeGrid = grid;
  if (opts.reload !== false) scheduleCoverResolutionReload();
}

function scheduleCoverResolutionReload() {
  if (!currentCoverSource || !currentCoverSource.src) return;
  if (coverResolutionReloadTimer) clearTimeout(coverResolutionReloadTimer);
  coverResolutionReloadTimer = setTimeout(function(){
    coverResolutionReloadTimer = null;
    if (!currentCoverSource || !currentCoverSource.src) return;
    if (currentCoverSource.kind === 'url') {
      loadCoverFromUrl(currentCoverSource.src, { trackToken: trackSwitchToken, fromResolutionChange: true });
    } else if (currentCoverSource.kind === 'data') {
      applyCoverDataUrl(currentCoverSource.src, { trackToken: trackSwitchToken, fromResolutionChange: true });
    }
  }, 260);
}

// 涟漪数据纹理 (1×N, RGBA: x, y, age, str)
var rippleData = new Float32Array(RIPPLE_MAX * 4);
var rippleTex  = new THREE.DataTexture(rippleData, 1, RIPPLE_MAX, THREE.RGBAFormat, THREE.FloatType);
rippleTex.magFilter = THREE.NearestFilter; rippleTex.minFilter = THREE.NearestFilter;
var ripples = [];
for (var ri = 0; ri < RIPPLE_MAX; ri++) ripples.push({ x:0, y:0, age:-10, str:0 });

// 封面纹理 + 边缘/深度纹理
var coverTex = new THREE.Texture();
coverTex.minFilter = THREE.LinearFilter; coverTex.magFilter = THREE.LinearFilter;
coverTex.wrapS = THREE.ClampToEdgeWrapping; coverTex.wrapT = THREE.ClampToEdgeWrapping;

var coverEdgeTex = new THREE.Texture();  // R=depth, G=edge, B=fg-mask, A=lum
coverEdgeTex.minFilter = THREE.LinearFilter; coverEdgeTex.magFilter = THREE.LinearFilter;

// 初始 1×1 像素
(function(){
  var c = document.createElement('canvas'); c.width = c.height = 4;
  var x = c.getContext('2d'); x.fillStyle = '#1c1c28'; x.fillRect(0,0,4,4);
  coverTex.image = c; coverTex.needsUpdate = true;
  var d = document.createElement('canvas'); d.width = d.height = 4;
  var dx = d.getContext('2d'); dx.fillStyle = 'rgba(128,0,0,255)'; dx.fillRect(0,0,4,4);
  coverEdgeTex.image = d; coverEdgeTex.needsUpdate = true;
})();

// 前一首封面纹理 (用于切歌渐变)
var prevCoverTex = new THREE.Texture();
prevCoverTex.minFilter = THREE.LinearFilter; prevCoverTex.magFilter = THREE.LinearFilter;
(function(){
  var c = document.createElement('canvas'); c.width = c.height = 4;
  var x = c.getContext('2d'); x.fillStyle = '#1c1c28'; x.fillRect(0,0,4,4);
  prevCoverTex.image = c; prevCoverTex.needsUpdate = true;
})();

var uniforms = {
  uTime:       { value: 0 },
  uBass:       { value: 0 },
  uMid:        { value: 0 },
  uTreble:     { value: 0 },
  uBeat:       { value: 0 },
  uEnergy:     { value: 0 },
  uBurstAmt:   { value: 0 },          // 通用预设切换脉冲 0..1
  uVinylSpin:  { value: 0 },
  uPreset:     { value: 0 },
  uIntensity:  { value: 0.85 },
  uDepth:      { value: 1.0 },
  uPointScale: { value: 1.0 },
  uSpeed:      { value: 1.0 },
  uTwist:      { value: 0 },
  uColorBoost: { value: 1.1 },
  uScatter:    { value: 0 },
  uCoverRes:   { value: 1.0 },
  uBgFade:     { value: 0.20 },
  uBloomStrength:{ value: 0.62 },
  uBloomSize:  { value: 2.65 },
  uTintColor:  { value: new THREE.Color('#9db8cf') },
  uTintStrength:{ value: 0 },
  uCoverTex:   { value: coverTex },
  uPrevCoverTex:{ value: prevCoverTex },
  uColorMixT:  { value: 1.0 },        // 0=显示旧封面 → 1=显示新封面
  uEdgeTex:    { value: coverEdgeTex },
  uRippleTex:  { value: rippleTex },
  uRippleCount:{ value: 0 },
  uDotTex:     { value: dotTexture },
  uHasCover:   { value: 0 },
  uHasDepth:   { value: 0 },
  uEdgeEnabled:{ value: 1 },
  uAiBoost:    { value: 0 },          // AI 深度增益, 当 AI 接管时升至 1
  uMouseXY:    { value: new THREE.Vector2(-999, -999) },
  uMouseActive:{ value: 0 },
  uHandXY:     { value: new THREE.Vector2(-999, -999) },
  uHandActive: { value: 0 },
  uGestureGrip:{ value: 0 },
  uPixel:      { value: renderer.getPixelRatio() },
  uAlpha:      { value: 0 },          // 整体粒子透明度 (启动 fade-in)
  uParticleDim:{ value: 1 },          // 覆盖层打开时只压低粒子背景, 不影响 3D 卡片
  uFloatAlpha: { value: 0 },          // 空场/浮空粒子透明度
  uLoading:    { value: 0 },          // 加载动画混合度 0..1 (1 = 完全聚成圆环)
  // Web 移植特效（预设 9–17）
  uBurstAge:   { value: 0 },
  uGalaxyAge:  { value: 0 },
  uMeteorSize: { value: 140 },
  uGrid:       { value: GRID_X },
  uJellyAura:  { value: 240 },
  uResolution: { value: new THREE.Vector2(1, 1) },
  uGlyphAtlas: { value: null },
};
uniforms.uGlyphAtlas.value = glyphAtlasTexture;
uniforms.uGrid.value = GRID_X;
installRenderPowerHooks();
applyRendererPowerMode();

// ----- 顶点 Shader -----
//   v7.1: 律动幅度 ×2.5, Tunnel 自旋, 虚空预设, 切歌颜色渐变
var vs = `
precision highp float;
uniform float uTime, uBass, uMid, uTreble, uBeat, uEnergy, uBurstAmt;
uniform float uPreset, uIntensity, uDepth, uPointScale, uSpeed, uTwist;
uniform float uVinylSpin;
uniform float uColorBoost, uScatter, uCoverRes, uBgFade;
uniform float uHasCover, uHasDepth, uEdgeEnabled, uAiBoost;
uniform float uMouseActive, uPixel, uColorMixT, uLoading;
uniform float uBurstAge, uGalaxyAge, uMeteorSize, uGrid, uJellyAura;
uniform vec2 uResolution;
uniform sampler2D uCoverTex, uPrevCoverTex, uEdgeTex, uRippleTex;
uniform int uRippleCount;
uniform vec2 uMouseXY, uHandXY;
uniform float uHandActive, uGestureGrip;
uniform vec3 uTintColor;
uniform float uTintStrength;
attribute vec2 aUv;
attribute float aRand;
varying vec3 vColor;
// ANGLE/D3D11 下 MAX_VARYING_VECTORS=8，多个 varying float 不会合并；打包省槽位
varying vec4 vPack0;   // .x=vBright .y=vRipple .z=vEdgeBoost .w=vAlpha
varying vec4 vPack1;   // .x=vSourceLum .y=vMeteor .z=拖尾方向角 .w=尺寸档位/字形索引
varying vec2 vMeteorCenter;
#define vBright    vPack0.x
#define vRipple    vPack0.y
#define vEdgeBoost vPack0.z
#define vAlpha     vPack0.w
#define vSourceLum vPack1.x
#define vMeteor    vPack1.y

#define PI 3.14159265359

vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289v(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 perm(vec4 x){return mod289v(((x*34.0)+1.0)*x);}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);
  const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));
  vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g;
  vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;
  vec3 x2=x0-i2+C.yyy;
  vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=perm(perm(perm(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;
  vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy;
  vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0;
  vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=inversesqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
  m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}

float hash11(float p) {
  return fract(sin(p * 127.1) * 43758.5453123);
}

// ---- Web 移植特效常量 / 辅助（极光…字符雨）----
${typeof WebFxPresets !== 'undefined' ? WebFxPresets.GLSL_CONSTANTS : ''}

vec2 safeCoverUv(vec2 uv) {
  return clamp(uv, vec2(0.0012), vec2(0.9988));
}

vec3 sampleNewCoverColor(vec2 uv) {
  return texture2D(uCoverTex, safeCoverUv(uv)).rgb;
}

vec3 samplePrevCoverColor(vec2 uv) {
  return texture2D(uPrevCoverTex, safeCoverUv(uv)).rgb;
}

vec4 sampleEdgeColor(vec2 uv) {
  return texture2D(uEdgeTex, safeCoverUv(uv));
}

float rippleSumAt(vec2 p, out float maxAmp) {
  float sum = 0.0; maxAmp = 0.0;
  for (int ri = 0; ri < 12; ri++) {
    if (ri >= uRippleCount) break;
    float vCoord = (float(ri) + 0.5) / 12.0;
    vec4 rd = texture2D(uRippleTex, vec2(0.5, vCoord));
    float age = rd.z; float str = rd.w;
    if (str < 0.005 || age < 0.0 || age > 2.0) continue;
    float dx = p.x - rd.x, dy = p.y - rd.y;
    float dist = sqrt(dx*dx + dy*dy);
    float lifeN = age / 2.0;
    float fadeIn  = smoothstep(0.0, 0.06, age);
    float fadeOut = 1.0 - smoothstep(0.7, 1.0, lifeN);
    float env = fadeIn * fadeOut;
    // v7.1: 把幅度放大 — 中心凸起更高更宽
    float bulgeW = 0.55 + age * 0.80;
    float bulge  = exp(-dist*dist / (2.0 * bulgeW * bulgeW)) * (1.0 - smoothstep(0.0, 0.55, lifeN));
    float waveR  = age * 2.10;
    float ringW  = 0.40 + age * 0.22;
    float ring   = exp(-pow((dist - waveR) / ringW, 2.0));
    // v7.1: 提升整体幅度 ×2
    float local  = (bulge * 2.4 + ring * 1.30) * env * str;
    sum += local;
    maxAmp = max(maxAmp, abs(local));
  }
  return sum;
}

void main(){
  float t = uTime * uSpeed;
  vec3 pos;
  vec2 sampleUv = safeCoverUv(aUv);
  // 切歌颜色渐变: 在新旧封面间 mix
  vec3 newCol = sampleNewCoverColor(sampleUv);
  vec3 prevCol = samplePrevCoverColor(sampleUv);
  vec3 coverColor = mix(prevCol, newCol, clamp(uColorMixT, 0.0, 1.0));
  vec4 edge = sampleEdgeColor(sampleUv);
  float depthVal = edge.r;
  float edgeVal  = edge.g;
  float fgMask   = edge.b;
  float lumVal   = edge.a;
  float maxRippleAmp = 0.0;
  float rippleZ = 0.0;
  // Web 移植：桌面 9–17 映射到 Web 分支索引 6–14；6–8 走壁纸底
  float uEff = uPreset;
  if (uPreset > 8.5) uEff = uPreset - 3.0;
  else if (uPreset > 5.5) uEff = 5.0;
  float galaxyStar = 1.0;
  float galaxyTwinkle = 0.5;
  float galaxyCore = 1.0;
  vMeteor = 0.0;
  vMeteorCenter = vec2(0.0);
  vPack1.z = 0.0;
  vPack1.w = 0.0;
  float sizeOverride = -1.0;

  vec3 defaultColor = mix(
    vec3(0.36, 0.28, 0.72),
    mix(vec3(0.85, 0.55, 0.95), vec3(0.45, 0.78, 0.95), aUv.x),
    aUv.y
  );
  vColor = mix(defaultColor, coverColor, uHasCover);
  vAlpha = 1.0;

  // 律动强度的真实倍数 (放大 intensity 滑块的影响)
  float K = uIntensity * 1.6;   // 滑块 1.0 → K=1.6, 滑块 1.6 → K=2.56

  // ====================================================
  //  Preset 0: SILK — 丝绸 (xy 平面, z 涟漪)
  //  v7.1: 全部位移 ×2.5
  // ====================================================
  if (uPreset < 0.5) {
    pos = position;
    rippleZ = rippleSumAt(pos.xy, maxRippleAmp);

    float midN = snoise(vec3(pos.x*1.4, pos.y*1.4, t*0.55)) * 0.6
               + snoise(vec3(pos.x*2.8+5.0, pos.y*2.8-3.0, t*0.85)) * 0.4;
    float midMask = 0.55 + 0.45 * snoise(vec3(pos.x*0.4, pos.y*0.4, t*0.18));
    float midDisp = midN * uMid * 0.55 * midMask * K;       // 0.20 → 0.55

    float trebleJ = snoise(vec3(pos.x*6.5, pos.y*6.5, t*3.5 + aRand*4.0)) * uTreble * 0.18 * K;  // 0.06→0.18
    float bassBreath = snoise(vec3(pos.x*0.35, pos.y*0.35, t*0.4)) * uBass * 0.42 * K;          // 0.14→0.42

    // AI 深度: 显著强化 (0.85 → 1.4)
    float depthZ = (depthVal - 0.5) * uAiBoost * uDepth * 1.40 * uHasDepth;

    pos.z = rippleZ * 1.30 + midDisp + trebleJ + bassBreath + depthZ;
  }

  // ====================================================
  //  Preset 1: TUNNEL — 隧道 + 自旋
  // ====================================================
  else if (uPreset < 1.5) {
    // v7.1: 整体自旋 — 整管缓慢绕 Z 轴
    float spin = t * 0.12;
    float angle = aUv.x * 2.0 * PI + spin;
    float flow = aUv.y - t * 0.08 * (1.0 + uBass * 0.55);
    flow = fract(flow);
    float zPos = (flow - 0.5) * 9.0;
    float baseR = 2.0 - uBass * 0.28 * K;                  // bass 收缩更明显
    float ripG  = sin(angle * 5.0 + zPos * 1.4 + t * 2.2) * 0.10 * (uMid + uTreble) * K;   // 0.04→0.10
    float r = baseR + ripG;
    pos.x = cos(angle) * r;
    pos.y = sin(angle) * r;
    pos.z = zPos;

    sampleUv = vec2(aUv.x, flow);
    sampleUv = safeCoverUv(sampleUv);
    newCol = sampleNewCoverColor(sampleUv);
    prevCol = samplePrevCoverColor(sampleUv);
    coverColor = mix(prevCol, newCol, clamp(uColorMixT, 0.0, 1.0));
    vColor = mix(defaultColor, coverColor, uHasCover);

    float depthFade = smoothstep(-4.5, 4.5, zPos);
    vColor *= 0.4 + depthFade * 0.7;
  }

  // ====================================================
  //  Preset 2: ORBIT — 星球 (保留自转)
  //  v7.1: 律动幅度加大
  // ====================================================
  else if (uPreset < 2.5) {
    float theta = aUv.x * 2.0 * PI;
    float phi   = (aUv.y - 0.5) * PI;
    float baseR = 2.2;
    float trebFlare = snoise(vec3(theta * 1.5, phi * 1.5, t * 0.7)) * uTreble * 0.85 * K;   // 0.40→0.85
    float bassExpand = uBass * 0.35 * K;                                                      // 0.18→0.35
    float r = baseR * (1.0 + bassExpand) + trebFlare;

    pos.x = r * cos(phi) * cos(theta);
    pos.y = r * sin(phi);
    pos.z = r * cos(phi) * sin(theta);

    float yaw = t * 0.18;
    float cy = cos(yaw), sy = sin(yaw);
    pos.xz = mat2(cy, -sy, sy, cy) * pos.xz;
  }

  // ====================================================
  //  Preset 3: VOID — 虚空 (无粒子, 适合自定义背景)
  // ====================================================
  else if (uPreset < 3.5) {
    pos = vec3((aUv.x - 0.5) * 0.01, (aUv.y - 0.5) * 0.01, -90.0);
    vAlpha = 0.0;
    vColor = vec3(0.0);
    maxRippleAmp = 0.0;
  }

  // ====================================================
  //  Preset 4: VINYL RECORD
  //  A real record layout: circular album cover in the center, black vinyl
  //  grooves outside, and a complete white particle rim.
  // ====================================================
  else if (uPreset < 4.5) {
    float bassDrive = smoothstep(0.08, 0.78, uBass + uBeat * 0.82);
    float highDrive = smoothstep(0.05, 0.46, uTreble);
    float hiResGuard = smoothstep(1.08, 1.55, uCoverRes);
    float edgeGuard = mix(1.0, 0.38, hiResGuard);
    float depthGuard = mix(1.0, 0.44, hiResGuard);
    float grooveGuard = mix(1.0, 0.48, hiResGuard);
    float beatGuard = mix(1.0, 0.36, hiResGuard);

    vec2 p = (aUv - 0.5) * 5.12;
    float spin = uVinylSpin;
    float cs = cos(spin), sn = sin(spin);
    vec2 rp = mat2(cs, -sn, sn, cs) * p;
    float d = length(p);
    float angle0 = atan(p.y, p.x);
    float recordR = 2.46;
    float coverR = 1.18;
    float recordAlpha = 1.0 - smoothstep(recordR - 0.02, recordR + 0.05, d);
    float coverMask = 1.0 - smoothstep(coverR - 0.012, coverR + 0.018, d);
    float border = exp(-pow((d - coverR) / 0.064, 2.0)) * edgeGuard;
    float outerRim = exp(-pow((d - (recordR - 0.050)) / 0.055, 2.0)) * edgeGuard;
    float vinylN = clamp((d - coverR) / max(0.001, recordR - coverR), 0.0, 1.0);

    pos = vec3(rp * (1.0 + bassDrive * 0.012 * beatGuard + uBeat * 0.026 * beatGuard), 0.0);
    vAlpha = recordAlpha;

    if (coverMask > 0.02) {
      vec2 coverUv = p / (coverR * 2.0) + 0.5;
      newCol = sampleNewCoverColor(coverUv);
      prevCol = samplePrevCoverColor(coverUv);
      coverColor = mix(prevCol, newCol, clamp(uColorMixT, 0.0, 1.0));
      if (hiResGuard > 0.001) {
        vec2 sx = vec2(0.0026, 0.0);
        vec2 sy = vec2(0.0, 0.0026);
        vec3 softNew = (sampleNewCoverColor(coverUv + sx) + sampleNewCoverColor(coverUv - sx) + sampleNewCoverColor(coverUv + sy) + sampleNewCoverColor(coverUv - sy)) * 0.25;
        vec3 softPrev = (samplePrevCoverColor(coverUv + sx) + samplePrevCoverColor(coverUv - sx) + samplePrevCoverColor(coverUv + sy) + samplePrevCoverColor(coverUv - sy)) * 0.25;
        coverColor = mix(coverColor, mix(softPrev, softNew, clamp(uColorMixT, 0.0, 1.0)), hiResGuard * 0.42);
      }
      vColor = mix(defaultColor, coverColor, uHasCover);
      float coverShade = 1.02 + 0.10 * (1.0 - smoothstep(0.0, coverR, d));
      vColor *= coverShade;
      vColor = mix(vColor, vec3(1.0), border * 0.54);
      pos.z = 0.040 + border * 0.026 * depthGuard + uBeat * 0.018 * beatGuard;
      maxRippleAmp = max(maxRippleAmp, border * 0.30 + bassDrive * 0.075 * beatGuard + uBeat * 0.075 * beatGuard);
    } else {
      float groove = 0.5 + 0.5 * sin((d - coverR) * mix(98.0, 58.0, hiResGuard));
      float fineGroove = 0.5 + 0.5 * sin((d - coverR) * mix(170.0, 92.0, hiResGuard) + aRand * 3.0);
      float tick = smoothstep(0.82, 0.995, hash11(floor((angle0 + PI) * 38.0) + floor(d * 72.0) * 2.1));
      vec3 vinyl = vec3(0.052, 0.054, 0.058) + vec3(0.052 * grooveGuard) * groove + vec3(0.026 * grooveGuard) * fineGroove;
      vinyl = mix(vinyl, coverColor * 0.32, 0.18 * (1.0 - vinylN));
      float whiteRing = max(border * 0.92, outerRim * 0.26);
      vColor = mix(vinyl, vec3(0.92, 0.94, 0.94), whiteRing);
      vColor = mix(vColor, vec3(1.0), tick * highDrive * (0.06 + border * 0.12) * grooveGuard);
      pos.z = groove * 0.010 * grooveGuard + border * 0.024 * depthGuard + bassDrive * vinylN * 0.016 * K * beatGuard + tick * highDrive * 0.010 * grooveGuard;
      maxRippleAmp = max(maxRippleAmp, border * 0.32 + outerRim * 0.12 + bassDrive * vinylN * 0.11 * beatGuard + tick * highDrive * 0.10 * grooveGuard + uBeat * vinylN * 0.08 * beatGuard);
    }
  }

  // ====================================================
  //  Preset 5: WALLPAPER PULSE + 桌面 6–8（安魂/音域回响）主粒子底
  // ====================================================
  else if (uPreset < 8.5) {
    float bassGlow = smoothstep(0.07, 0.78, uBass) * 0.34 + uBeat * 0.014;
    float midGlow = smoothstep(0.07, 0.62, uMid) * 0.42;
    float highGlow = smoothstep(0.04, 0.46, uTreble) * 0.46;
    float lane = aUv.y;
    float transition = clamp(uBurstAmt, 0.0, 1.0);

    if (lane < 0.80) {
      float laneWarp = snoise(vec3(aUv.x * 0.42, lane * 1.7, t * 0.026)) * 0.11 + (hash11(aRand * 73.1) - 0.5) * 0.045;
      float warpedLane = clamp(lane + laneWarp, 0.0, 0.80);
      float bandCoord = warpedLane / 0.80 * 5.65 + snoise(vec3(aUv.x * 0.82, lane * 2.25, t * 0.032)) * 0.62;
      float band = floor(bandCoord);
      float local = fract(bandCoord + hash11(band * 9.13 + aRand * 2.4) * 0.18);
      float bandN = clamp((band + 0.5) / 5.65, 0.0, 1.0);
      float seed = hash11(band * 19.17 + aRand * 31.0);
      float flow = fract(aUv.x + t * (0.0034 + bandN * 0.0038 + seed * 0.0022) + seed * 0.53);
      float arc = (flow - 0.5) * PI * (1.35 + bandN * 0.72 + seed * 0.24);
      float armCurve = sin(arc + bandN * 2.2 + seed * 5.3);
      float spiralRadius = 9.2 + bandN * 11.8 + seed * 6.0 + local * 2.9;
      float x = cos(arc * 0.72 + bandN * 0.92 + seed * 1.3) * spiralRadius + (flow - 0.5) * (13.5 + bandN * 9.5);
      float ribbonPhase = flow * PI * 2.0 * (0.55 + bandN * 0.24 + seed * 0.10) + t * (0.010 + bandN * 0.007) + seed * 5.7;
      float broadWave = sin(ribbonPhase) * 0.92;
      float fineWave = sin(ribbonPhase * (1.36 + seed * 0.62) - t * 0.044 + seed * 5.0) * 0.045;
      float yBase = (bandN - 0.5) * 13.2 + armCurve * (2.3 + bandN * 1.6) + (seed - 0.5) * 1.85 + snoise(vec3(bandN * 2.0, flow * 0.62, seed)) * 0.92;
      float ridgeCenter = 0.43 + (seed - 0.5) * 0.18;
      float ridge = exp(-pow((local - ridgeCenter) / (0.25 + seed * 0.04), 2.0));
      float softMask = smoothstep(0.010, 0.12, lane) * (1.0 - smoothstep(0.72, 0.81, lane));
      float ribbonNoise = snoise(vec3(flow * 1.18 + seed, bandN * 2.0, t * 0.018)) * 0.74;
      float zLayer = mix(-23.5, 15.5, bandN) + (seed - 0.5) * 6.0;

      pos.x = x + ribbonNoise * 1.40 + sin(t * 0.012 + seed * 8.0) * 0.22;
      pos.y = yBase + broadWave + fineWave + (local - 0.5) * (0.58 + ridge * 0.14);
      pos.z = zLayer + broadWave * 1.35 + ribbonNoise * 1.85;

      float pulseLine = 0.5 + 0.5 * sin(ribbonPhase * (1.7 + seed * 0.9) - t * 0.32 + seed * 6.0);
      vec3 aurora = mix(vec3(0.52, 0.86, 1.0), vec3(0.70, 0.58, 1.0), bandN);
      aurora = mix(aurora, vec3(0.96, 0.98, 0.92), bassGlow * 0.05);
      vAlpha = (0.18 + ridge * 0.78 + pulseLine * highGlow * 0.035 + bassGlow * 0.025) * softMask * (0.96 + transition * 0.02);
      vColor = mix(coverColor, aurora, 0.62 + ridge * 0.22) * (0.76 + ridge * 0.86 + pulseLine * highGlow * 0.05 + bassGlow * 0.04);
      maxRippleAmp = max(maxRippleAmp, ridge * (0.12 + midGlow * 0.05) + pulseLine * highGlow * 0.045 + bassGlow * 0.030);
    } else {
      float q = (lane - 0.80) / 0.20;
      float seed = hash11(aRand * 917.0 + floor(q * 130.0));
      float depth = mix(-32.0, 18.0, seed);
      float drift = fract(aUv.x + t * (0.0014 + seed * 0.0048) + seed * 0.63);
      float cluster = snoise(vec3(seed * 2.0, q * 3.2, t * 0.007));
      float x = (drift - 0.5) * (45.0 + seed * 22.0) + cluster * 3.4;
      float y = (hash11(aRand * 331.0 + seed * 5.0) - 0.5) * 22.0 + sin(t * (0.018 + seed * 0.028) + seed * 7.0) * 0.86;
      float z = depth + sin(t * (0.020 + seed * 0.032) + aRand * 8.0) * 1.05;
      float twinkle = pow(0.5 + 0.5 * sin(t * (0.24 + seed * 0.42) + aRand * 17.0), 5.0);
      float dust = smoothstep(0.22, 0.98, hash11(aRand * 661.0 + floor(q * 160.0)));

      pos = vec3(x, y, z);
      vAlpha = dust * (0.16 + twinkle * 0.46 + highGlow * 0.025 + bassGlow * 0.018) * (1.0 - q * 0.06);
      vColor = mix(coverColor, vec3(0.92, 0.97, 1.0), 0.62 + twinkle * 0.14) * (0.72 + twinkle * 0.62 + bassGlow * 0.025);
      maxRippleAmp = max(maxRippleAmp, twinkle * highGlow * 0.055 + dust * bassGlow * 0.030);
    }

    if (transition > 0.001) {
      float bloom = smoothstep(0.0, 1.0, transition);
      vec2 burstVec = pos.xy + vec2(hash11(aRand * 31.0) - 0.5, hash11(aRand * 47.0) - 0.5) * 0.75;
      vec2 burstDir = burstVec / max(length(burstVec), 0.001);
      pos.xy += burstDir * bloom * 0.026;
      pos.xy += vec2(snoise(vec3(aRand, t * 0.014, 1.0)), snoise(vec3(aRand, t * 0.014, 5.0))) * bloom * 0.06;
      pos.xy *= 1.0 + bloom * 0.014;
      pos.z += (hash11(aRand * 123.0) - 0.5) * bloom * 0.18;
      vAlpha *= 0.86 + bloom * 0.22;
      maxRippleAmp = max(maxRippleAmp, bloom * 0.10);
    }
  }

  // ---- Web 移植 9 预设分支（uEff = 6..14）----
${typeof WebFxPresets !== 'undefined' ? WebFxPresets.GLSL_BRANCHES : ''}

  // ====================================================
  //  鼠标交互 (仅 SILK)
  // ====================================================
  if (uMouseActive > 0.5 && uPreset < 0.5) {
    float mdx = pos.x - uMouseXY.x;
    float mdy = pos.y - uMouseXY.y;
    float md = sqrt(mdx*mdx + mdy*mdy);
    if (md < 1.0) {
      float push = (1.0 - md) * (1.0 - md);
      pos.z += push * 0.55;
    }
  }

  // ====================================================
  //  v8 手势遮挡 — uHandActive 是 0..1 平滑过渡, 大半径推开
  // ====================================================
  if (uHandActive > 0.01) {
    float hdx = pos.x - uHandXY.x;
    float hdy = pos.y - uHandXY.y;
    float hd = sqrt(hdx*hdx + hdy*hdy);
    float rad = 1.55;
    if (hd < rad) {
      float push = (rad - hd) / rad;
      push = push * push * uHandActive;
      pos.z += push * 1.10;
      vec2 outDir = vec2(hdx, hdy) / max(0.001, hd);
      pos.xy += outDir * push * 0.28;
    }
  }
  if (uGestureGrip > 0.001) {
    float grip = clamp(uGestureGrip, 0.0, 1.0);
    float gripWave = 0.5 + 0.5 * sin(uTime * 2.2 + aRand * 6.2831);
    pos.xy *= mix(1.0, 0.66 + gripWave * 0.035, grip);
    pos.z += grip * (0.18 + uBass * 0.22 + gripWave * 0.10);
  }

  // ====================================================
  //  通用: 离散感 / 扭曲
  // ====================================================
  if (uScatter > 0.001) {
    vec2 jdir = vec2(cos(aRand * 6.2831), sin(aRand * 6.2831));
    pos.xy += jdir * uScatter * (0.05 + uTreble * 0.10);
  }
  if (uTwist > 0.001 && uPreset < 0.5) {
    float ta = uTwist * pos.z * 0.6;
    float cs = cos(ta), sn = sin(ta);
    pos.xy = mat2(cs, -sn, sn, cs) * pos.xy;
  }

  // 颜色
  float vinylHiResGuard = smoothstep(1.08, 1.55, uCoverRes) * step(3.5, uPreset) * (1.0 - step(4.5, uPreset));
  float edgeBoost = uEdgeEnabled * edgeVal * mix(1.0, 0.42, vinylHiResGuard);
  vSourceLum = dot(max(vColor, vec3(0.0)), vec3(0.299, 0.587, 0.114));
  float blackParticleGuard = 1.0 - smoothstep(0.025, 0.115, vSourceLum);
  vEdgeBoost = edgeBoost * (uPreset > 3.5 ? 0.22 : 1.0) * (1.0 - blackParticleGuard);
  vColor = pow(max(vColor, vec3(0.0)), vec3(1.0 / max(0.35, uColorBoost)));
  float edgeColorMix = edgeBoost * (uPreset > 3.5 ? 0.20 : 0.50) * (1.0 - blackParticleGuard);
  vColor = mix(vColor, vColor + vec3(0.20), edgeColorMix);
  float tintLum = max(max(vColor.r, vColor.g), vColor.b);
  vec3 tintedColor = uTintColor * max(0.24, tintLum * 1.12);
  vColor = mix(vColor, tintedColor, clamp(uTintStrength, 0.0, 1.0) * (1.0 - blackParticleGuard));

  vBright = 0.82 + maxRippleAmp * 0.55 + uBass * 0.10 + edgeBoost * 0.30 + uEnergy * 0.05 + uBurstAmt * 0.40;
${typeof WebFxPresets !== 'undefined' ? WebFxPresets.GLSL_BRIGHT_PATCH : '  if (uPreset > 4.5) {'}
    vBright = 0.94 + maxRippleAmp * 0.34 + uBass * 0.020 + uEnergy * 0.026 + uBurstAmt * 0.025;
  } else if (uPreset > 3.5) {
    vBright = 0.94 + maxRippleAmp * 0.64 + uBass * 0.08 + edgeBoost * 0.12 + uEnergy * 0.05 + uBeat * 0.16 + uBurstAmt * 0.16;
  }
  vRipple = clamp(maxRippleAmp * 1.5, 0.0, 1.0);

  if (uHasDepth > 0.5 && uPreset < 0.5) {
    float bgMul = mix(1.0, 0.55, uBgFade * (1.0 - fgMask));
    vBright *= bgMul;
  }
  vBright += uGestureGrip * 0.22;
  float loadingMistSize = 1.0;

  // 加载形态: 雾状微尘流，避免廉价旋转圆环
  if (uLoading > 0.001) {
    float mistSeed = hash11(aRand * 931.7);
    float mistLayer = floor(mistSeed * 4.0);
    float layerN = (mistLayer + 0.5) / 4.0;
    float mistAngle = aRand * 6.2831 + uTime * (0.16 + mistSeed * 0.18) + snoise(vec3(aRand * 2.1, uTime * 0.24, 2.0)) * 1.85;
    float mistR = mix(1.35, 3.15, sqrt(hash11(aRand * 127.3))) * (1.0 + sin(uTime * 0.42 + aRand * 7.0) * 0.13);
    vec2 mistCurl = vec2(
      snoise(vec3(aRand * 4.1, uTime * 0.32, 3.0)),
      snoise(vec3(aRand * 4.7, uTime * 0.30, 8.0))
    );
    float mistBreath = 0.5 + 0.5 * sin(uTime * (0.82 + mistSeed * 0.55) + aRand * 17.0);
    float mistRibbon = sin(mistAngle * (1.35 + layerN * 0.55) + uTime * 0.34 + mistSeed * 4.0);
    float glowPick = smoothstep(0.88, 0.997, hash11(aRand * 1501.0 + mistLayer * 17.0));
    float dustPick = 0.34 + glowPick * 0.66;
    vec3 mistPos = vec3(
      cos(mistAngle) * mistR * (1.24 + mistCurl.x * 0.16) + mistCurl.x * 0.72,
      sin(mistAngle * 0.82 + mistRibbon * 0.25) * mistR * (0.56 + layerN * 0.10) + mistCurl.y * 0.62,
      (layerN - 0.5) * 4.85 + mistCurl.x * 0.56 + mistBreath * 0.36 + mistRibbon * 0.24
    );
    vec3 mistCol = mix(vec3(0.62, 0.86, 0.84), vec3(0.36, 0.46, 0.78), mistSeed);
    mistCol = mix(mistCol, vec3(0.94, 1.0, 0.97), glowPick * (0.45 + mistBreath * 0.35));
    vColor = mix(vColor, mistCol, uLoading * 0.78);
    vBright = mix(vBright, 0.20 + mistBreath * 0.18 + abs(mistCurl.x) * 0.06 + glowPick * (0.72 + abs(mistRibbon) * 0.24), uLoading);
    vAlpha = mix(vAlpha, 0.08 + mistBreath * 0.11 + dustPick * 0.11 + glowPick * 0.30, uLoading);
    pos = mix(pos, mistPos, uLoading);
    loadingMistSize = 1.26 + mistBreath * 0.24 + abs(mistRibbon) * 0.14 + glowPick * 0.78;
  }

  vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
  float depthSize = 36.0 / max(0.5, -mvPos.z);
  float audioBoost = 1.0 + maxRippleAmp * 0.7 + edgeBoost * 0.55 + uBeat * 0.30 + uBurstAmt * 0.5;
  float sz = clamp(depthSize * audioBoost, 1.05, 4.95);
${typeof WebFxPresets !== 'undefined' ? WebFxPresets.GLSL_SIZE_PATCH : '  if (uPreset > 4.5) {'}
    float flowDrive = uBass * 0.070 + uMid * 0.046 + uTreble * 0.060 + uBurstAmt * 0.090 + uBeat * 0.055;
    sz = clamp(depthSize * (1.05 + flowDrive), 1.00, 5.45);
  } else if (uPreset > 3.5) {
    float ringDrive = uBass * 0.30 + uMid * 0.18 + uTreble * 0.22 + uBeat * 0.30;
    sz = clamp(depthSize * (0.90 + ringDrive * 0.62), 1.05, 3.90);
  }
  if (sizeOverride > 0.0) sz = sizeOverride;
  // 加载态下粒子稍大
  sz = mix(sz, sz * loadingMistSize, uLoading);
  gl_PointSize = sz * uPixel * uPointScale;
  gl_Position = projectionMatrix * mvPos;
  vMeteorCenter = (gl_Position.xy / gl_Position.w * 0.5 + 0.5) * uResolution;
}
`;

// ----- 片元 Shader -----
var fs = `
precision highp float;
uniform sampler2D uDotTex, uGlyphAtlas;
uniform float uAlpha, uPreset, uParticleDim, uMeteorSize;
varying vec3 vColor;
varying vec4 vPack0;
varying vec4 vPack1;
varying vec2 vMeteorCenter;
#define vBright    vPack0.x
#define vRipple    vPack0.y
#define vEdgeBoost vPack0.z
#define vAlpha     vPack0.w
#define vSourceLum vPack1.x
#define vMeteor    vPack1.y

void main(){
  if (vMeteor > 0.002) {
    vec2 vMeteorAxis = vec2(cos(vPack1.z), sin(vPack1.z));
    vec2 d = gl_FragCoord.xy - vMeteorCenter;
    float along = dot(d, vMeteorAxis);
    float perp  = dot(d, vec2(-vMeteorAxis.y, vMeteorAxis.x));
    float L  = max(uMeteorSize, 1.0) * 0.82;
    float hf = L * 0.5;
    float axialT = (hf - along) / L;
    float u  = clamp(axialT, 0.0, 1.0);
    float wMax = max(uMeteorSize * 0.013, 1.4);
    float profileW = 0.62 + 0.38 * sin(u * 3.14159 * 0.92) - 0.38 * u;
    float w  = wMax * clamp(profileW, 0.10, 1.2);
    float headCut = clamp(1.0 + axialT * 14.0, 0.0, 1.0);
    w *= mix(0.20, 1.0, headCut);
    float cc = perp / max(w, 0.0001);
    float tail = 1.0 - u;
    float prof = tail * tail * tail * tail * headCut;
    float body = exp(-cc * cc) * prof;
    float ha = along - hf;
    float hr = max(uMeteorSize * 0.018, 1.5);
    float headW = max(wMax * 0.62, 0.8);
    float head = exp(-(ha * ha) / (hr * hr) - (perp * perp) / (headW * headW)) * headCut;
    float a = clamp(body * 0.90 + head * 0.50, 0.0, 1.0) * vMeteor * uAlpha;
    if (a < 0.004) discard;
    vec3 col = mix(vColor, vec3(1.0), clamp(prof * 0.30 + head * 0.95, 0.0, 1.0));
    gl_FragColor = vec4(col * (0.95 + head * 0.45), a);
    return;
  }
  vec3 col = vColor * vBright;
  float spriteAlpha;
  if (uPreset > 16.5) {
    float g = clamp(vPack1.w, 0.0, 80.0);
    float gx = mod(g, 9.0);
    float gy = floor(g / 9.0);
    vec2 auv = vec2((gx + gl_PointCoord.x) / 9.0, 1.0 - (gy + gl_PointCoord.y) / 9.0);
    vec4 tex = texture2D(uGlyphAtlas, auv);
    spriteAlpha = tex.a;
    if (spriteAlpha < 0.02) discard;
    col = mix(col, col * 1.3 + vec3(0.04), vRipple * 0.35);
  } else if (uPreset > 13.5) {
    float d = distance(gl_PointCoord, vec2(0.5));
    spriteAlpha = pow(max(0.0, 1.0 - d), 2.6);
    if (spriteAlpha < 0.004) discard;
    col = mix(col, col * 1.25 + vec3(0.04), vRipple * 0.3);
  } else if (uPreset > 12.5 && uPreset < 13.5) {
    float d = distance(gl_PointCoord, vec2(0.5));
    spriteAlpha = pow(max(0.0, 1.0 - d), 8.0);
    if (spriteAlpha < 0.004) discard;
    col = mix(col, col * 1.2, vRipple * 0.4);
  } else {
    vec4 tex = texture2D(uDotTex, gl_PointCoord);
    if (tex.a < 0.02) discard;
    spriteAlpha = tex.a;
    col = mix(col, col * 1.3 + vec3(0.05), vEdgeBoost * 0.35);
    col = mix(col, col * 1.2, vRipple * 0.4);
    float keepBlack = 1.0 - smoothstep(0.025, 0.115, vSourceLum);
    float nonBlack = 1.0 - keepBlack;
    float dotDist = length(gl_PointCoord - vec2(0.5)) * 2.0;
    float readableRim = smoothstep(0.44, 0.94, dotDist) * (1.0 - smoothstep(0.94, 1.08, dotDist)) * tex.a;
    float rimKeep = (uPreset > 3.5 && uPreset < 4.5) ? 0.30 : 1.0;
    readableRim *= rimKeep;
    float outLum = dot(col, vec3(0.299, 0.587, 0.114));
    float lightParticle = smoothstep(0.50, 0.82, outLum) * nonBlack;
    float darkParticle = (1.0 - smoothstep(0.20, 0.50, outLum)) * nonBlack;
    col = mix(col, vec3(0.0), readableRim * lightParticle * 0.38);
    col = mix(col, vec3(1.0), readableRim * darkParticle * 0.20);
  }
  col = clamp(col, vec3(0.0), vec3(1.6));
  gl_FragColor = vec4(col, spriteAlpha * uAlpha * uParticleDim * vAlpha);
}
`;

var material = new THREE.ShaderMaterial({
  uniforms: uniforms, vertexShader: vs, fragmentShader: fs,
  transparent: true, depthWrite: false, blending: THREE.NormalBlending,
});

var bloomVs = vs
  .replace('uniform float uMouseActive, uPixel, uColorMixT, uLoading;', 'uniform float uMouseActive, uPixel, uColorMixT, uLoading, uBloomSize;')
  .replace('gl_PointSize = sz * uPixel * uPointScale;', 'gl_PointSize = sz * uPixel * uPointScale * uBloomSize;');
var bloomFs = `
precision highp float;
uniform sampler2D uDotTex;
uniform float uAlpha, uBloomStrength, uPreset, uParticleDim;
varying vec3 vColor;
varying vec4 vPack0;
varying vec4 vPack1;
#define vBright    vPack0.x
#define vRipple    vPack0.y
#define vEdgeBoost vPack0.z
#define vAlpha     vPack0.w
#define vSourceLum vPack1.x
#define vMeteor    vPack1.y

void main(){
  float soft;
  if (uPreset > 13.5 && uPreset < 16.5) {
    float d = distance(gl_PointCoord, vec2(0.5));
    soft = pow(max(0.0, 1.0 - d), 2.6);
    if (soft < 0.004) discard;
  } else if (uPreset > 12.5 && uPreset < 13.5) {
    float d = distance(gl_PointCoord, vec2(0.5));
    soft = pow(max(0.0, 1.0 - d), 8.0);
    if (soft < 0.004) discard;
  } else {
    vec4 tex = texture2D(uDotTex, gl_PointCoord);
    if (tex.a < 0.01) discard;
    soft = tex.a * tex.a;
  }
  vec3 col = vColor * (0.55 + vBright * 0.62);
  col = mix(col, col + vec3(0.22, 0.18, 0.10), vEdgeBoost * 0.35);
  col = clamp(col, vec3(0.0), vec3(1.8));
  float pulse = 1.0 + vRipple * 0.65;
  float keepBlack = 1.0 - smoothstep(0.025, 0.115, vSourceLum);
  float bloomKeep = 1.0 - keepBlack * 0.92;
  bloomKeep *= 1.0 - vMeteor * 0.92;
  bloomKeep *= 1.0 - step(16.5, uPreset);
  gl_FragColor = vec4(col, soft * uAlpha * uBloomStrength * uParticleDim * pulse * 0.55 * vAlpha * bloomKeep);
}
`;
var bloomMaterial = new THREE.ShaderMaterial({
  uniforms: uniforms, vertexShader: bloomVs, fragmentShader: bloomFs,
  transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
});
var bloomParticles = new THREE.Points(geo, bloomMaterial);
bloomParticles.frustumCulled = false;
bloomParticles.renderOrder = 0;
scene.add(bloomParticles);
var particles = new THREE.Points(geo, material);
particles.frustumCulled = false;
particles.renderOrder = 1;
scene.add(particles);

// ============================================================
//  背景星河（移植自上游 00-pointer-cover-particles.js，t-backgroundStarRiver 开关的门控对象）
//  独立的整屏背景星河粒子层：renderOrder -2 垫在最底层，additive 发光，
//  透明度按预设差异化（backgroundStarRiverTargetAlpha），随音频能量/鼓点呼吸。
//  注意：这不是歌词区光带（那是 updateLyricStarRiver），此前开关门控错了对象导致"没作用"。
// ============================================================
var BACKGROUND_STAR_RIVER_COUNT = 1400;
function buildBackgroundStarRiverGeometry(count) {
  var bgGeo = new THREE.BufferGeometry();
  var seeds = new Float32Array(count);
  var lanes = new Float32Array(count);
  var depths = new Float32Array(count);
  var positions = new Float32Array(count * 3); // THREE 依赖 position attribute 决定 drawCount，缺失会导致整个层一个粒子都不画
  for (var i = 0; i < count; i++) {
    seeds[i] = Math.random() * 1000 + i * 0.37;
    lanes[i] = Math.random();
    depths[i] = Math.random();
  }
  bgGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  bgGeo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  bgGeo.setAttribute('aLane', new THREE.BufferAttribute(lanes, 1));
  bgGeo.setAttribute('aDepthSeed', new THREE.BufferAttribute(depths, 1));
  return bgGeo;
}

var backgroundStarRiverUniforms = {
  uDotTex: uniforms.uDotTex,
  uTime: uniforms.uTime,
  uBass: uniforms.uBass,
  uTreble: uniforms.uTreble,
  uBeat: uniforms.uBeat,
  uEnergy: uniforms.uEnergy,
  uPixel: uniforms.uPixel,
  uPointScale: uniforms.uPointScale,
  uParticleDim: uniforms.uParticleDim,
  uTintColor: uniforms.uTintColor,
  uAlpha: { value: 0 }
};

var backgroundStarRiverVs = `
precision highp float;
attribute float aSeed, aLane, aDepthSeed;
uniform float uTime, uBass, uTreble, uBeat, uEnergy, uPixel, uPointScale, uAlpha, uParticleDim;
uniform vec3 uTintColor;
varying vec3 vColor;
varying float vAlpha, vTwinkle;

float hash11(float p){ return fract(sin(p * 127.1) * 43758.5453123); }

void main(){
  float band = floor(aLane * 6.0);
  float local = fract(aLane * 6.0);
  float bandN = (band + 0.5) / 6.0;
  float seed = aSeed + band * 19.17;
  float flow = fract(hash11(seed * 2.13) + uTime * (0.0022 + bandN * 0.0028 + hash11(seed * 5.1) * 0.0034));
  float arc = (flow - 0.5) * 6.2831853 * (0.68 + bandN * 0.46) + bandN * 2.4 + hash11(seed) * 6.2831853;
  float wave = sin(arc * (1.18 + bandN * 0.28) + uTime * (0.014 + bandN * 0.012) + seed * 0.07);
  float radius = 7.2 + bandN * 15.8 + hash11(seed * 3.7) * 6.2 + local * 1.8;
  vec3 pos;
  pos.x = cos(arc * 0.76 + bandN * 0.84) * radius + (flow - 0.5) * (18.0 + bandN * 14.0);
  pos.y = (bandN - 0.5) * 13.2 + wave * (1.5 + bandN * 1.4) + (local - 0.5) * 1.2;
  pos.z = mix(-31.0, -4.8, aDepthSeed) + wave * 1.2 + sin(uTime * (0.018 + hash11(seed) * 0.032) + seed) * 1.0;

  float twinkle = pow(0.5 + 0.5 * sin(uTime * (0.22 + hash11(seed * 4.0) * 0.44) + seed * 9.0), 5.0);
  float ridge = exp(-pow((local - (0.42 + hash11(seed * 6.0) * 0.16)) / (0.22 + hash11(seed * 7.0) * 0.10), 2.0));
  float dust = smoothstep(0.20, 0.98, hash11(seed * 8.0 + band));
  vec3 cool = mix(vec3(0.34, 0.76, 1.0), vec3(0.60, 0.44, 1.0), bandN);
  vec3 warm = vec3(1.0, 0.78, 0.58);
  vec3 tint = max(uTintColor, vec3(0.08));
  vColor = mix(cool, warm, ridge * 0.35 + uBass * 0.06);
  vColor = mix(vColor, tint, 0.22);
  vTwinkle = twinkle;
  vAlpha = uAlpha * uParticleDim * dust * (0.10 + ridge * 0.52 + twinkle * 0.32 + uBeat * 0.05) * (0.88 + uEnergy * 0.18);

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  float depthSize = 30.0 / max(0.65, -mv.z);
  float size = 1.10 + ridge * 2.40 + twinkle * 2.80 + uTreble * 0.80 + uBeat * 0.50;
  gl_PointSize = clamp(size * depthSize * uPixel * uPointScale, 0.75, 5.60);
  gl_Position = projectionMatrix * mv;
}
`;

var backgroundStarRiverFs = `
precision highp float;
uniform sampler2D uDotTex;
varying vec3 vColor;
varying float vAlpha, vTwinkle;

void main(){
  vec4 tex = texture2D(uDotTex, gl_PointCoord);
  if (tex.a < 0.02) discard;
  vec3 col = clamp(vColor * (0.66 + vTwinkle * 0.72), vec3(0.0), vec3(1.45));
  gl_FragColor = vec4(col, tex.a * vAlpha);
}
`;

var backgroundStarRiverMaterial = new THREE.ShaderMaterial({
  uniforms: backgroundStarRiverUniforms,
  vertexShader: backgroundStarRiverVs,
  fragmentShader: backgroundStarRiverFs,
  transparent: true,
  depthWrite: false,
  depthTest: false,
  blending: THREE.AdditiveBlending
});
var backgroundStarRiverParticles = new THREE.Points(buildBackgroundStarRiverGeometry(BACKGROUND_STAR_RIVER_COUNT), backgroundStarRiverMaterial);
backgroundStarRiverParticles.frustumCulled = false;
// fork 主粒子是 NormalBlending（上游为 additive）——后画会覆盖先画的星河像素，
// 因此星河必须在最后画（renderOrder 大值），用加色叠上去；视觉上仍是远景背景层
backgroundStarRiverParticles.renderOrder = 200;
scene.add(backgroundStarRiverParticles);

// 上游默认 0.34 的星河透明度叠加 dust/ridge/twinkle 三重衰减后单粒子平均 alpha 仅 ~0.07，
// 实测（readPixels on-off 差 0.86）在真实画面上完全不可见 —— fork 提亮 6 倍到可感知水平
var STAR_RIVER_BRIGHTNESS = 6.0;
function backgroundStarRiverTargetAlpha() {
  if (!fx || fx.backgroundStarRiver === false) return 0;
  if (Number(fx.preset) === 5) return 0; // 星河预设自带星野粒子，背景星河自动禁用避免重复（上游同款语义）
  // 骷髅预设自带暗色氛围，压低星河；sonic 系预设自带地形背景，同理
  if (Number(fx.preset) === SKULL_PRESET_INDEX) return 0.38 * STAR_RIVER_BRIGHTNESS;
  if (typeof window !== 'undefined' && window.MineradioSonicWorkshop && MineradioSonicWorkshop.isActive(fx)) return 0.28 * STAR_RIVER_BRIGHTNESS;
  if (typeof window !== 'undefined' && window.MineradioSonicTopography && MineradioSonicTopography.isActive(fx)) return 0.28 * STAR_RIVER_BRIGHTNESS;
  return 0.34 * STAR_RIVER_BRIGHTNESS;
}

function updateBackgroundStarRiverState(dt, immediate) {
  if (!backgroundStarRiverParticles || !backgroundStarRiverUniforms) return;
  var target = backgroundStarRiverTargetAlpha();
  if (immediate) {
    backgroundStarRiverUniforms.uAlpha.value = target;
  } else {
    var ease = target > backgroundStarRiverUniforms.uAlpha.value ? 0.085 : 0.16;
    backgroundStarRiverUniforms.uAlpha.value += (target - backgroundStarRiverUniforms.uAlpha.value) * Math.min(1, ease * Math.max(1, (dt || 0.016) * 60));
  }
  backgroundStarRiverParticles.visible = backgroundStarRiverUniforms.uAlpha.value > 0.006;
}

console.log('v7 shell loaded, JS pending');

// ============================================================
//  浮空粒子层 (独立 Points)
//   v7.1: 速度大幅放慢, 改用 sin/cos 长周期漂移 (优雅而非乱飞)
// ============================================================
var FLOAT_COUNT = 1300;
var floatGroup = null;
var floatPositionsArr = null, floatBaseArr = null, floatPhaseArr = null, floatColorArr = null;

function createFloatLayer() {
  fx.floatLayer = false;
  uniforms.uFloatAlpha.value = 0;
  if (floatGroup) destroyFloatLayer();
  return;
  if (floatGroup) return;
  var fgeo = new THREE.BufferGeometry();
  floatPositionsArr = new Float32Array(FLOAT_COUNT * 3);
  floatBaseArr      = new Float32Array(FLOAT_COUNT * 3);  // 基准位置
  floatPhaseArr     = new Float32Array(FLOAT_COUNT * 3);  // 每粒子相位 (0..2π)
  floatColorArr     = new Float32Array(FLOAT_COUNT * 3);
  var floatRandArr  = new Float32Array(FLOAT_COUNT);
  var floatAmpArr   = new Float32Array(FLOAT_COUNT);      // 漂移幅度 (0.15-0.45)
  for (var i = 0; i < FLOAT_COUNT; i++) {
    var halo = i < FLOAT_COUNT * 0.76;
    var bx, by, bz;
    if (halo) {
      var a = Math.random() * Math.PI * 2;
      var r = 0.62 + Math.pow(Math.random(), 0.72) * 2.75;
      var lane = (Math.random() - 0.5) * 0.62;
      bx = Math.cos(a) * r;
      by = Math.sin(a) * r * 0.54 + lane;
      bz = (Math.random() - 0.5) * 2.4 - 0.25;
    } else {
      bx = (Math.random() - 0.5) * 8.4;
      by = (Math.random() - 0.5) * 5.8;
      bz = (Math.random() - 0.5) * 5.6;
    }
    floatBaseArr[i*3]   = bx; floatBaseArr[i*3+1] = by; floatBaseArr[i*3+2] = bz;
    floatPositionsArr[i*3]   = bx;
    floatPositionsArr[i*3+1] = by;
    floatPositionsArr[i*3+2] = bz;
    floatPhaseArr[i*3]   = Math.random() * Math.PI * 2;
    floatPhaseArr[i*3+1] = Math.random() * Math.PI * 2;
    floatPhaseArr[i*3+2] = Math.random() * Math.PI * 2;
    floatAmpArr[i] = 0.15 + Math.random() * 0.35;
    var white = 0.88 + Math.random() * 0.12;
    floatColorArr[i*3]   = white;
    floatColorArr[i*3+1] = white;
    floatColorArr[i*3+2] = white;
    floatRandArr[i] = Math.random();
  }
  fgeo.setAttribute('position', new THREE.BufferAttribute(floatPositionsArr, 3));
  fgeo.setAttribute('aColor',   new THREE.BufferAttribute(floatColorArr, 3));
  fgeo.setAttribute('aRand',    new THREE.BufferAttribute(floatRandArr, 1));

  // 把 amp + phase 存到 attribute 让 shader 端做漂移 (避免 JS 每帧改 buffer)
  fgeo.setAttribute('aAmp',     new THREE.BufferAttribute(floatAmpArr, 1));
  fgeo.setAttribute('aPhase',   new THREE.BufferAttribute(floatPhaseArr, 3));

  var fvs = `
    precision highp float;
    uniform float uTime, uBass, uPixel, uFloatAlpha;
    attribute vec3 aColor;
    attribute vec3 aPhase;
    attribute float aRand, aAmp;
    varying vec3 vC;
    varying float vA;
    void main(){
      vec3 pos = position;
      float orbit = uTime * (0.030 + aRand * 0.034);
      float cs = cos(orbit), sn = sin(orbit);
      pos.xy = mat2(cs, -sn, sn, cs) * pos.xy;
      float breathe = 1.0 + sin(uTime * 0.34 + aPhase.x) * 0.045;
      pos.xy *= breathe;
      pos.x += sin(uTime * (0.18 + aRand * 0.05) + aPhase.x) * aAmp * 0.34;
      pos.y += cos(uTime * (0.15 + aRand * 0.06) + aPhase.y) * aAmp * 0.30;
      pos.z += sin(uTime * (0.11 + aRand * 0.04) + aPhase.z) * aAmp * 0.68 + uBass * 0.10 * sin(aRand * 12.0);
      vC = aColor;
      vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
      float dist = -mvPos.z;
      float twinkle = 0.62 + 0.38 * sin(uTime * (0.42 + aRand * 0.34) + aPhase.z);
      vA = clamp(0.22 + (5.0 - dist) * 0.10, 0.055, 0.58) * twinkle;
      float sz = clamp(40.0 / max(0.5, dist), 1.3, 4.1);
      gl_PointSize = sz * uPixel;
      gl_Position = projectionMatrix * mvPos;
    }
  `;
  var ffs = `
    precision highp float;
    uniform sampler2D uDotTex;
    uniform float uFloatAlpha;
    varying vec3 vC;
    varying float vA;
    void main(){
      vec4 tex = texture2D(uDotTex, gl_PointCoord);
      if (tex.a < 0.02) discard;
      gl_FragColor = vec4(vC, tex.a * vA * uFloatAlpha);
    }
  `;
  var fmat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: uniforms.uTime,
      uBass: uniforms.uBass,
      uPixel: uniforms.uPixel,
      uDotTex: uniforms.uDotTex,
      uFloatAlpha: uniforms.uFloatAlpha,
    },
    vertexShader: fvs, fragmentShader: ffs,
    transparent:true, depthWrite:false, blending: THREE.AdditiveBlending,
  });
  floatGroup = new THREE.Points(fgeo, fmat);
  floatGroup.frustumCulled = false;
  scene.add(floatGroup);
}
function destroyFloatLayer() {
  if (!floatGroup) return;
  scene.remove(floatGroup);
  floatGroup.geometry.dispose(); floatGroup.material.dispose();
  floatGroup = null;
}

// ============================================================
//  安魂 — 3D 粒子建模层
// ============================================================
var SKULL_PRESET_INDEX = 6;
var SKULL_MODEL_BASE_ROTATION_X = -0.26;
var SKULL_MODEL_BASE_ROTATION_Y = 0.00;
var SKULL_MODEL_SCALE = 2.34;
var SKULL_MODEL_BASE_POSITION = { x: 0, y: 0.22, z: 0.10 };
var skullAmpPulse = 0;
var skullBeatFlash = 0;
var skullJawOpen = 0;
var skullCameraBlend = 0;
var skullWheelZoom = 0;
var skullWheelZoomTarget = 0;
var skullCameraTargetPos = new THREE.Vector3();
var skullCameraTargetLook = new THREE.Vector3();
var skullCameraBasePos = new THREE.Vector3();
var skullCameraBaseLook = new THREE.Vector3();
var skullCameraShelfPos = new THREE.Vector3();
var skullCameraShelfLook = new THREE.Vector3();
var skullCameraMixedLook = new THREE.Vector3();
var skullShelfCameraMix = 0;
var skullLyricMouthLocal = new THREE.Vector3(0.025, -0.72, 0.62);
var skullLyricMouthTarget = new THREE.Vector3();
var skullLyricMouthForward = new THREE.Vector3();
var skullLyricMouthQuat = new THREE.Quaternion();
var skullLyricReadableQuat = new THREE.Quaternion();
var skullParticleGroup = null;
var skullParticleOpacity = 0;
var skullParticleAsset = { data: null, promise: null, failed: false };
var skullBaseColors = {
  boneA: new THREE.Color('#b8ae98'),
  boneB: new THREE.Color('#fff4d8'),
  shadow: new THREE.Color('#100d0d'),
  light: new THREE.Color('#ffe3a0'),
  neutralBoneA: new THREE.Color('#9fb7c8'),
  neutralBoneB: new THREE.Color('#eef9ff'),
  neutralShadow: new THREE.Color('#070b12'),
  neutralLight: new THREE.Color('#d6f3ff')
};
var skullTintScratch = {
  tint: new THREE.Color(),
  soft: new THREE.Color(),
  bright: new THREE.Color(),
  dark: new THREE.Color(),
  boneA: new THREE.Color(),
  boneB: new THREE.Color(),
  shadow: new THREE.Color(),
  light: new THREE.Color()
};

function effectiveSkullVisualTint() {
  var pal = stageLyrics && (stageLyrics.coverPalette || stageLyrics.palette) || {};
  var custom = fx && fx.visualTintMode === 'custom';
  var color = custom
    ? fx.visualTintColor
    : (pal.secondary || pal.primary || fx.visualTintColor || fxDefaults.visualTintColor || '#9db8cf');
  color = normalizeHexColor(color || '#9db8cf', '#9db8cf');
  var strength = custom ? 0.98 : (pal && (pal.secondary || pal.primary) ? 0.30 : 0.14);
  return { color: color, strength: strength, custom: custom };
}

function syncSkullParticleColors() {
  if (!skullParticleGroup || !skullParticleGroup.material || !skullParticleGroup.material.uniforms) return;
  var u = skullParticleGroup.material.uniforms;
  var tint = effectiveSkullVisualTint();
  var custom = !!tint.custom;
  var strength = clampRange(Number(tint.strength) || 0, 0, custom ? 0.99 : 0.78);
  skullTintScratch.tint.set(tint.color);
  skullTintScratch.soft.copy(skullTintScratch.tint).lerp(new THREE.Color('#e8f5ff'), custom ? 0.05 : 0.28);
  skullTintScratch.bright.copy(skullTintScratch.tint).lerp(new THREE.Color(custom ? '#f6fbff' : '#fff7d6'), custom ? 0.14 : 0.46);
  skullTintScratch.dark.copy(skullTintScratch.tint).lerp(new THREE.Color('#05070c'), custom ? 0.74 : 0.72);
  skullTintScratch.boneA.copy(custom ? skullBaseColors.neutralBoneA : skullBaseColors.boneA).lerp(skullTintScratch.soft, strength * (custom ? 0.99 : 0.64));
  skullTintScratch.boneB.copy(custom ? skullBaseColors.neutralBoneB : skullBaseColors.boneB).lerp(skullTintScratch.bright, strength * (custom ? 0.94 : 0.46));
  skullTintScratch.shadow.copy(custom ? skullBaseColors.neutralShadow : skullBaseColors.shadow).lerp(skullTintScratch.dark, strength * (custom ? 0.72 : 0.42));
  skullTintScratch.light.copy(custom ? skullBaseColors.neutralLight : skullBaseColors.light).lerp(skullTintScratch.bright, strength * (custom ? 0.98 : 0.76));
  if (u.uColorA) u.uColorA.value.copy(skullTintScratch.boneA);
  if (u.uColorB) u.uColorB.value.copy(skullTintScratch.boneB);
  if (u.uShadow) u.uShadow.value.copy(skullTintScratch.shadow);
  if (u.uLight) u.uLight.value.copy(skullTintScratch.light);
}

function buildSkullParticleGeometryFromAsset(points) {
  var count = Math.floor((points && points.length || 0) / 5);
  var geo = new THREE.BufferGeometry();
  var positions = new Float32Array(count * 3);
  var seeds = new Float32Array(count);
  var kinds = new Float32Array(count);
  for (var i = 0; i < count; i++) {
    positions[i * 3] = points[i * 5];
    positions[i * 3 + 1] = points[i * 5 + 1];
    positions[i * 3 + 2] = points[i * 5 + 2];
    kinds[i] = points[i * 5 + 3];
    seeds[i] = points[i * 5 + 4];
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));
  geo.setAttribute('kind', new THREE.BufferAttribute(kinds, 1));
  return geo;
}

function loadSkullParticleAsset() {
  if (skullParticleAsset.data || skullParticleAsset.promise || skullParticleAsset.failed) return skullParticleAsset.promise || Promise.resolve(skullParticleAsset.data);
  if (typeof fetch !== 'function') {
    skullParticleAsset.failed = true;
    return Promise.resolve(null);
  }
  skullParticleAsset.promise = fetch('assets/skull-decimation-points.bin?v=regular-surface-teeth-soften-20260621', { cache: 'reload' })
    .then(function(res){
      if (!res.ok) throw new Error('skull asset ' + res.status);
      return res.arrayBuffer();
    })
    .then(function(buf){
      if (!buf || buf.byteLength < 20 || buf.byteLength % 20 !== 0) throw new Error('invalid skull asset');
      skullParticleAsset.data = new Float32Array(buf);
      skullParticleAsset.promise = null;
      return skullParticleAsset.data;
    })
    .catch(function(err){
      console.warn('skull particle asset load failed:', err);
      skullParticleAsset.failed = true;
      skullParticleAsset.promise = null;
      return null;
    });
  return skullParticleAsset.promise;
}

function skullPushPoint(pos, seed, kind, x, y, z, k) {
  pos.push(x, y, z);
  seed.push(Math.random() * 1000);
  kind.push(k == null ? 0 : k);
}
function skullPushCurve(pos, seed, kind, count, fn, k, jitter) {
  jitter = jitter == null ? 0.012 : jitter;
  for (var i = 0; i < count; i++) {
    var t = count > 1 ? i / (count - 1) : 0;
    var p = fn(t);
    skullPushPoint(pos, seed, kind, p.x + (Math.random() - 0.5) * jitter, p.y + (Math.random() - 0.5) * jitter, p.z + (Math.random() - 0.5) * jitter, k);
  }
}
function createSkullParticleLayer() {
  if (skullParticleGroup) return skullParticleGroup;
  var asset = skullParticleAsset.data;
  if (!asset) return null;
  var pos = [];
  var seed = [];
  var kind = [];
  if (!asset) {

  function rotate2(x, y, a) {
    var c = Math.cos(a), s = Math.sin(a);
    return { x:x * c - y * s, y:x * s + y * c };
  }
  function eyeCut(x, y, z, side) {
    if (z < 0.16) return false;
    var p = rotate2(x - side * 0.38, y - 0.02, side * 0.10);
    var almond = Math.pow(Math.abs(p.x) / 0.34, 1.70) + Math.pow(Math.abs(p.y) / 0.215, 1.34);
    var slantGate = p.y < 0.22 - Math.abs(p.x) * 0.12 && p.y > -0.24 + Math.abs(p.x) * 0.10;
    return almond < 1.0 && slantGate;
  }
  function noseCut(x, y, z) {
    if (z < 0.20 || y > -0.12 || y < -0.62) return false;
    var t = clampRange((-0.12 - y) / 0.50, 0, 1);
    var half = 0.050 + t * 0.185;
    return Math.abs(x) < half && z > 0.38 + t * 0.18;
  }
  function mouthGap(x, y, z) {
    return z > 0.18 && y < -0.66 && y > -1.03 && Math.abs(x) < 0.30;
  }
  function addEllipsoidSurface(count, cx, cy, cz, rx, ry, rz, yMin, yMax, k, frontBias) {
    var made = 0, guard = 0;
    while (made < count && guard < count * 8) {
      guard++;
      var theta = frontBias
        ? (-Math.PI * 0.07 + Math.random() * Math.PI * 1.14)
        : (Math.random() * Math.PI * 2);
      var phi = Math.acos(1 - Math.random() * 2);
      var sx = Math.sin(phi) * Math.cos(theta);
      var sy = Math.cos(phi);
      var sz = Math.sin(phi) * Math.sin(theta);
      var x = cx + sx * rx * (0.96 + Math.max(0, -sy) * 0.12);
      var y = cy + sy * ry;
      var z = cz + sz * rz;
      if (y < yMin || y > yMax) continue;
      if (eyeCut(x, y, z, -1) || eyeCut(x, y, z, 1) || noseCut(x, y, z) || mouthGap(x, y, z)) continue;
      var cheekCarve = z > 0.18 && y < -0.18 && y > -0.66 && Math.abs(x) > 0.26 && Math.abs(x) < 0.58 && Math.random() < 0.36;
      if (cheekCarve) continue;
      skullPushPoint(pos, seed, kind, x, y, z, k + Math.random() * 0.08);
      made++;
    }
  }

  addEllipsoidSurface(3150, 0, 0.46, 0.00, 0.93, 0.88, 0.58, -0.16, 1.35, 0.055, true);
  addEllipsoidSurface(2100, 0, -0.34, 0.10, 0.70, 0.66, 0.46, -0.95, 0.14, 0.10, true);
  for (var j = 0; j < 1450; j++) {
    var a = Math.random() * Math.PI * 2;
    var v = Math.random();
    var y = -1.16 + v * 0.48;
    var taper = clampRange((y + 1.16) / 0.48, 0, 1);
    var rx = 0.32 + taper * 0.31;
    var rz = 0.22 + taper * 0.18;
    var x = Math.cos(a) * rx;
    var z = 0.22 + Math.sin(a) * rz;
    if (mouthGap(x, y, z)) continue;
    if (y > -0.94 && Math.abs(x) < 0.22 && z > 0.18) continue;
    skullPushPoint(pos, seed, kind, x, y, z, 0.15 + Math.random() * 0.10);
  }

  [-1, 1].forEach(function(side){
    var cx = side * 0.38;
    skullPushCurve(pos, seed, kind, 520, function(t){
      var a = t * Math.PI * 2;
      var px = Math.cos(a) * (0.345 + Math.sin(a * 2.0) * 0.012);
      var py = Math.sin(a) * (0.205 + Math.cos(a * 2.0) * 0.010);
      var r = rotate2(px, py, -side * 0.10);
      return {
        x: cx + r.x,
        y: 0.02 + r.y - Math.max(0, Math.cos(a)) * 0.018,
        z: 0.72 + Math.sin(a * 2.0) * 0.030
      };
    }, 0.96, 0.010);
    skullPushCurve(pos, seed, kind, 330, function(t){
      var x = side * (0.13 + t * 0.58);
      var y = 0.245 - t * 0.085 + Math.sin(t * Math.PI) * 0.055;
      return { x:x, y:y, z:0.66 + Math.sin(t * Math.PI) * 0.055 };
    }, 0.98, 0.010);
    skullPushCurve(pos, seed, kind, 300, function(t){
      return {
        x: side * (0.30 + t * 0.47),
        y: -0.18 - t * 0.25 + Math.sin(t * Math.PI) * 0.070,
        z: 0.69 - t * 0.095
      };
    }, 0.84, 0.012);
    skullPushCurve(pos, seed, kind, 330, function(t){
      return {
        x: side * (0.62 - t * 0.20),
        y: -0.28 - t * 0.55 + Math.sin(t * Math.PI) * 0.065,
        z: 0.50 + Math.sin(t * Math.PI) * 0.070
      };
    }, 0.72, 0.014);
  });

  skullPushCurve(pos, seed, kind, 360, function(t){
    var x = -0.72 + t * 1.44;
    return { x:x, y:0.235 - Math.abs(x) * 0.055 + Math.sin(t * Math.PI) * 0.035, z:0.62 + Math.sin(t * Math.PI) * 0.040 };
  }, 0.86, 0.012);
  [-1, 1].forEach(function(side){
    skullPushCurve(pos, seed, kind, 260, function(t){
      return { x:side * (0.035 + t * 0.205), y:-0.15 - t * 0.43, z:0.79 - t * 0.035 };
    }, 0.98, 0.007);
  });
  skullPushCurve(pos, seed, kind, 240, function(t){
    var x = -0.25 + t * 0.50;
    return { x:x, y:-0.62 + Math.sin(t * Math.PI) * 0.030, z:0.70 };
  }, 0.86, 0.008);
  skullPushCurve(pos, seed, kind, 420, function(t){
    var a = Math.PI + t * Math.PI;
    return { x: Math.cos(a) * 0.50, y: -0.98 + Math.sin(a) * 0.205, z: 0.46 + Math.sin(t * Math.PI) * 0.075 };
  }, 0.82, 0.014);
  skullPushCurve(pos, seed, kind, 360, function(t){
    var x = -0.39 + t * 0.78;
    return { x:x, y:-0.70 + Math.sin(t * Math.PI) * 0.018, z:0.73 };
  }, 0.96, 0.006);
  skullPushCurve(pos, seed, kind, 320, function(t){
    var x = -0.36 + t * 0.72;
    return { x:x, y:-1.005 - Math.sin(t * Math.PI) * 0.018, z:0.70 };
  }, 0.78, 0.008);
  for (var tooth = -4; tooth <= 4; tooth++) {
    var tx = tooth * 0.082;
    var height = tooth === 0 ? 0.30 : (0.25 + (4 - Math.abs(tooth)) * 0.012);
    skullPushCurve(pos, seed, kind, 58, function(t){
      return { x: tx + Math.sin(t * Math.PI) * 0.006, y: -0.715 - t * height, z: 0.735 - t * 0.020 };
    }, 0.94, 0.004);
  }
  skullPushCurve(pos, seed, kind, 520, function(t){
    var a = Math.PI * 0.12 + t * Math.PI * 0.76;
    return { x: Math.cos(a) * 0.98, y: 0.42 + Math.sin(a) * 0.92, z: 0.48 + Math.sin(t * Math.PI) * 0.10 };
  }, 0.70, 0.012);
  skullPushCurve(pos, seed, kind, 360, function(t){
    var a = t * Math.PI * 2;
    return { x: Math.cos(a) * 0.52, y: -1.19 + Math.sin(a) * 0.082, z: 0.24 + Math.sin(a * 2.0) * 0.028 };
  }, 0.72, 0.010);
  }

  var geo = asset ? buildSkullParticleGeometryFromAsset(asset) : new THREE.BufferGeometry();
  if (!asset) {
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(new Float32Array(seed), 1));
    geo.setAttribute('kind', new THREE.BufferAttribute(new Float32Array(kind), 1));
  }
  var mat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: dotTexture },
      uTime: uniforms.uTime,
      uPixel: uniforms.uPixel,
      uBass: uniforms.uBass,
      uMid: uniforms.uMid,
      uTreble: uniforms.uTreble,
      uBeat: uniforms.uBeat,
      uJawOpen: { value: 0 },
      uSkullFlash: { value: 0 },
      uPointScale: uniforms.uPointScale,
      uBloomStrength: uniforms.uBloomStrength,
      uColorBoost: uniforms.uColorBoost,
      uOpacity: { value: 0 },
      uColorA: { value: new THREE.Color('#b8ae98') },
      uColorB: { value: new THREE.Color('#fff4d8') },
      uShadow: { value: new THREE.Color('#100d0d') },
      uLight: { value: new THREE.Color('#ffe3a0') }
    },
    vertexShader: [
      'precision highp float;',
      'attribute float seed,kind;',
      'uniform float uTime,uPixel,uPointScale,uBloomStrength,uColorBoost;',
      'uniform float uBass,uMid,uTreble,uBeat,uJawOpen,uSkullFlash;',
      'varying float vKind,vLight,vRim,vAmp,vDensity,vFlash;',
      'void main(){',
      '  vec3 pos = position;',
      '  float jawGroup = step(1.0, kind);',
      '  float boneKind = fract(kind);',
      '  vKind = boneKind;',
      '  vec3 n = normalize(vec3(position.x * 0.82, position.y * 0.68, position.z * 1.22 + 0.16));',
      '  float toothBand = smoothstep(0.48, 0.70, position.z) * (1.0 - smoothstep(0.27, 0.48, abs(position.x))) * (1.0 - smoothstep(0.18, 0.46, abs(position.y + 0.72)));',
      '  float toothNoise = fract(sin(seed * 21.731 + floor((position.x + 0.52) * 21.0) * 5.137) * 43758.5453);',
      '  pos.y += toothBand * (toothNoise - 0.5) * 0.020;',
      '  pos.z += toothBand * (fract(sin(seed * 17.923 + position.y * 31.0) * 24634.6345) - 0.5) * 0.012;',
      '  float jawSidePull = jawGroup * smoothstep(-0.42, -1.06, position.y) * smoothstep(0.24, 0.62, abs(position.x)) * (1.0 - smoothstep(0.78, 1.04, abs(position.x))) * smoothstep(0.16, 0.70, position.z);',
      '  pos.x *= 1.0 - jawSidePull * 0.10;',
      '  float fallbackJaw = smoothstep(-0.48, -0.90, position.y) * smoothstep(0.08, 0.52, position.z) * (1.0 - smoothstep(0.62, 0.96, abs(position.x)));',
      '  float jawMask = jawGroup;',
      '  float jawSideAnchor = smoothstep(0.36, 0.66, abs(position.x)) * (1.0 - smoothstep(0.78, 0.98, abs(position.x))) * smoothstep(-0.34, -0.74, position.y) * (1.0 - smoothstep(0.62, 0.86, position.z));',
      '  float jawMotion = jawMask * (1.0 - jawSideAnchor * 0.32);',
      '  vec2 jawHinge = vec2(-0.45, 0.18);',
      '  float jawAngle = uJawOpen * 0.52 * jawMotion;',
      '  float jc = cos(jawAngle);',
      '  float js = sin(jawAngle);',
      '  vec2 jr = pos.yz - jawHinge;',
      '  vec2 openedJaw = vec2(jr.x * jc - jr.y * js, jr.x * js + jr.y * jc) + jawHinge;',
      '  pos.yz = mix(pos.yz, openedJaw, jawMotion);',
      '  float jawDrop = jawMotion * smoothstep(-0.32, -0.88, position.y) * (0.58 + smoothstep(0.18, 0.62, abs(position.x)) * 0.04);',
      '  float openDrive = clamp(uJawOpen, 0.0, 1.25);',
      '  pos.y -= jawDrop * (0.038 + openDrive * 0.100);',
      '  pos.z += jawDrop * (0.003 + openDrive * 0.014);',
      '  float ampDrive = smoothstep(0.20, 0.82, uBass * 0.44 + uMid * 0.22 + uBeat * 0.72);',
      '  float ampPhase = 0.50 + 0.50 * sin(uTime * (1.05 + uMid * 0.30) + seed * 6.2831);',
      '  vFlash = clamp(uSkullFlash * (0.68 + ampPhase * 0.32), 0.0, 1.0);',
      '  vAmp = clamp(ampDrive * 0.045 + vFlash * 0.92 + uTreble * 0.012, 0.0, 1.0);',
      '  vec4 mv = modelViewMatrix * vec4(pos, 1.0);',
      '  float dist = max(0.55, -mv.z);',
      '  vec3 vn = normalize(normalMatrix * n);',
      '  vec3 keyDir = normalize(vec3(-0.48, 0.64, 0.60));',
      '  vec3 lowDir = normalize(vec3(-0.10, -0.78, 0.34));',
      '  vec3 fillDir = normalize(vec3(0.36, -0.04, 0.64));',
      '  vec3 rimDir = normalize(vec3(0.88, 0.18, -0.44));',
      '  float key = pow(max(dot(vn, keyDir), 0.0), 1.18);',
      '  float low = pow(max(dot(vn, lowDir), 0.0), 1.34) * 0.10;',
      '  float fill = max(dot(vn, fillDir), 0.0) * 0.055;',
      '  float gothicShadow = smoothstep(-0.10, 0.36, dot(vn, normalize(vec3(0.44, -0.06, -0.58))));',
      '  float dentalLift = smoothstep(0.48, 0.72, position.z) * (1.0 - smoothstep(0.30, 0.54, abs(position.x))) * (1.0 - smoothstep(0.18, 0.48, abs(position.y + 0.70))) * (0.62 + toothNoise * 0.20);',
      '  vRim = pow(max(dot(vn, rimDir), 0.0), 2.50) * (0.24 + uBloomStrength * 0.08 + vFlash * 0.62);',
      '  float dust = fract(sin(seed * 13.871 + position.x * 19.7 + position.y * 7.1) * 43758.5453);',
      '  vDensity = clamp(0.30 + key * 0.70 + vRim * 0.24 - gothicShadow * 0.24 + dust * 0.025 + vFlash * 0.08, 0.16, 1.20);',
      '  vLight = clamp(0.115 + key * 1.02 + low + fill + dentalLift * 0.20 + boneKind * 0.070 + vAmp * 0.56 - gothicShadow * 0.08, 0.035, 1.72);',
      '  float scaleCtl = clamp(uPointScale, 0.48, 2.35);',
      '  float size = (0.035 + boneKind * 0.026) * (0.84 + vDensity * 0.22 + vLight * 0.13 + uBloomStrength * 0.030 + vFlash * 0.18);',
      '  gl_PointSize = clamp(size * uPixel * scaleCtl * 128.0 / dist, 0.95, 7.60);',
      '  gl_Position = projectionMatrix * mv;',
      '}'
    ].join('\n'),
    fragmentShader: [
      'precision highp float;',
      'uniform sampler2D uMap;',
      'uniform vec3 uColorA,uColorB,uShadow,uLight;',
      'uniform float uOpacity,uBloomStrength,uColorBoost;',
      'varying float vKind,vLight,vRim,vAmp,vDensity,vFlash;',
      'void main(){',
      '  vec4 tex = texture2D(uMap, gl_PointCoord);',
      '  if(tex.a < 0.070) discard;',
      '  float contrast = clamp(uColorBoost, 0.50, 2.00);',
      '  float lit = clamp(pow(vLight, mix(1.18, 0.74, (contrast - 0.50) / 1.50)), 0.0, 1.28);',
      '  vec3 bone = mix(uColorA, uColorB, clamp((vKind - 0.34) * 2.0 + lit * 0.18, 0.0, 1.0));',
      '  vec3 col = mix(uShadow, bone, clamp(lit, 0.0, 1.0));',
      '  col = mix(col, uLight, clamp(vRim * (0.14 + uBloomStrength * 0.035 + vFlash * 0.40), 0.0, 0.54));',
      '  col = mix(col, uLight, clamp(vAmp * (0.09 + uBloomStrength * 0.025) + vFlash * 0.56, 0.0, 0.68));',
      '  float alpha = tex.a * uOpacity * clamp(0.20 + lit * 0.44 + vDensity * 0.40 + vRim * 0.10 + vFlash * 0.46, 0.12, 1.56);',
      '  gl_FragColor = vec4(col, alpha);',
      '}'
    ].join('\n'),
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending
  });
  skullParticleGroup = new THREE.Points(geo, mat);
  skullParticleGroup.frustumCulled = false;
  skullParticleGroup.visible = false;
  skullParticleGroup.userData.source = asset ? 'asset' : 'fallback';
  skullParticleGroup.position.set(SKULL_MODEL_BASE_POSITION.x, SKULL_MODEL_BASE_POSITION.y, SKULL_MODEL_BASE_POSITION.z);
  skullParticleGroup.scale.setScalar(SKULL_MODEL_SCALE);
  skullParticleGroup.rotation.x = SKULL_MODEL_BASE_ROTATION_X;
  skullParticleGroup.rotation.y = SKULL_MODEL_BASE_ROTATION_Y;
  skullParticleGroup.renderOrder = 32;
  syncSkullParticleColors();
  scene.add(skullParticleGroup);
  return skullParticleGroup;
}
function isSkullShelfCompositionActive() {
  if (!(fx && fx.preset === SKULL_PRESET_INDEX)) return false;
  if (!shelfManager || !shelfManager.getMode || shelfManager.getMode() !== 'side') return false;
  if (shelfPinnedOpen || shelfVisibility > 0.18) return true;
  return !!(shelfManager.hasOpenContent && shelfManager.hasOpenContent());
}
function clearSkullPresetResidue() {
  skullParticleOpacity = 0;
  skullAmpPulse = 0;
  skullBeatFlash = 0;
  skullJawOpen = 0;
  skullCameraBlend = 0;
  if (!skullParticleGroup) return;
  skullParticleGroup.visible = false;
  if (skullParticleGroup.material && skullParticleGroup.material.uniforms) {
    if (skullParticleGroup.material.uniforms.uOpacity) skullParticleGroup.material.uniforms.uOpacity.value = 0;
    if (skullParticleGroup.material.uniforms.uJawOpen) skullParticleGroup.material.uniforms.uJawOpen.value = 0;
    if (skullParticleGroup.material.uniforms.uSkullFlash) skullParticleGroup.material.uniforms.uSkullFlash.value = 0;
  }
}
function resetSkullPresetView(immediate, opts) {
  opts = opts || {};
  if (!(fx && fx.preset === SKULL_PRESET_INDEX)) return;
  skullWheelZoomTarget = 0;
  if (!opts.smooth) skullWheelZoom = 0;
  skullCameraBlend = Math.max(skullCameraBlend, 1);
  if (!opts.keepLyricLock && typeof stageLyrics !== 'undefined' && stageLyrics && stageLyrics.group && stageLyrics.group.userData) stageLyrics.group.userData.skullMouthLocked = false;
  if (!opts.keepLyricLock && typeof requestStageLyricCameraSnap === 'function') requestStageLyricCameraSnap(10);
  if (!immediate || !skullParticleGroup) return;
  var shelfComposition = isSkullShelfCompositionActive();
  skullShelfCameraMix = shelfComposition ? 1 : 0;
  skullParticleGroup.position.set(shelfComposition ? -1.18 : SKULL_MODEL_BASE_POSITION.x, shelfComposition ? 0.32 : SKULL_MODEL_BASE_POSITION.y, SKULL_MODEL_BASE_POSITION.z);
  skullParticleGroup.scale.setScalar(shelfComposition ? 3.02 : SKULL_MODEL_SCALE);
  skullParticleGroup.rotation.set(SKULL_MODEL_BASE_ROTATION_X, SKULL_MODEL_BASE_ROTATION_Y, 0);
  skullParticleGroup.updateMatrixWorld(true);
  if (camera && typeof setSkullCameraTargetVectors === 'function') {
    var portrait = innerHeight > innerWidth * 1.08;
    setSkullCameraTargetVectors(skullCameraTargetPos, skullCameraTargetLook, portrait, shelfComposition, 0);
    camera.position.copy(skullCameraTargetPos);
    skullCameraMixedLook.copy(skullCameraTargetLook);
    camera.lookAt(skullCameraMixedLook);
    camera.updateProjectionMatrix();
  }
}
function skullBreathOffset(t, shelfComposition) {
  var strength = shelfComposition ? 0.70 : 1.0;
  return {
    x: strength * (Math.sin(t * 0.33 + 1.7) * 0.028 + Math.sin(t * 0.61 + 0.4) * 0.010),
    y: strength * (Math.sin(t * 0.38 + 0.2) * 0.036 + Math.sin(t * 0.83 + 2.1) * 0.012),
    z: strength * (Math.sin(t * 0.24 + 2.6) * 0.026)
  };
}
function setSkullCameraTargetVectors(pos, look, portrait, shelfComposition, zoom) {
  zoom = Number(zoom) || 0;
  if (shelfComposition) {
    pos.set(portrait ? -0.06 : 0.00, portrait ? -2.36 : -2.50, (portrait ? 4.88 : 4.96) + zoom * 0.78);
    look.set(portrait ? -0.04 : 0.00, portrait ? -0.26 : -0.20, 0.03);
    return;
  }
  pos.set(0.00, portrait ? -2.38 : -2.52, (portrait ? 4.92 : 4.98) + zoom);
  look.set(0.00, portrait ? -0.28 : -0.20, 0.02);
}
function applySkullCameraPose(dt) {
  if (freeCamera && (freeCamera.active || freeCamera.locked || freeCamera.resetTween)) return;
  var active = fx && fx.preset === SKULL_PRESET_INDEX;
  skullCameraBlend += ((active ? 1 : 0) - skullCameraBlend) * Math.min(1, dt * (active ? 4.8 : 7.2));
  if (skullCameraBlend < 0.002) return;
  skullWheelZoom += (skullWheelZoomTarget - skullWheelZoom) * Math.min(1, dt * 8.0);
  var portrait = innerHeight > innerWidth * 1.08;
  var shelfComposition = isSkullShelfCompositionActive();
  var shelfMixTarget = shelfComposition ? 1 : 0;
  skullShelfCameraMix += (shelfMixTarget - skullShelfCameraMix) * Math.min(1, dt * (shelfMixTarget > skullShelfCameraMix ? 4.6 : 5.8));
  if (Math.abs(skullShelfCameraMix - shelfMixTarget) < 0.002) skullShelfCameraMix = shelfMixTarget;
  setSkullCameraTargetVectors(skullCameraBasePos, skullCameraBaseLook, portrait, false, skullWheelZoom);
  setSkullCameraTargetVectors(skullCameraShelfPos, skullCameraShelfLook, portrait, true, skullWheelZoom);
  skullCameraTargetPos.copy(skullCameraBasePos).lerp(skullCameraShelfPos, skullShelfCameraMix);
  skullCameraTargetLook.copy(skullCameraBaseLook).lerp(skullCameraShelfLook, skullShelfCameraMix);
  camera.position.lerp(skullCameraTargetPos, skullCameraBlend);
  skullCameraMixedLook.set(orbit.lookAt.x, orbit.lookAt.y, orbit.lookAt.z).lerp(skullCameraTargetLook, skullCameraBlend);
  camera.lookAt(skullCameraMixedLook);
  camera.updateProjectionMatrix();
}
function updateSkullParticleLayer(dt) {
  var active = fx && fx.preset === SKULL_PRESET_INDEX;
  if (active && !skullParticleAsset.data && !skullParticleAsset.failed) {
    loadSkullParticleAsset();
    return;
  }
  if (active && !skullParticleAsset.data) return;
  if (active) createSkullParticleLayer();
  if (!skullParticleGroup) return;
  var target = active ? 1 : 0;
  skullParticleOpacity += (target - skullParticleOpacity) * Math.min(1, dt * (active ? 3.2 : 2.4));
  if (skullParticleOpacity < 0.006 && !active) {
    skullParticleGroup.visible = false;
    return;
  }
  skullParticleGroup.visible = true;
  skullParticleGroup.material.uniforms.uOpacity.value = skullParticleOpacity * clampRange(0.78 + (fx.intensity || 0.85) * 0.18, 0.56, 1.0);
  var beatTransient = clampRange(Math.max(0, beatPulse - 0.16) / 0.84, 0, 1.35);
  var flashTarget = clampRange(Math.pow(beatTransient, 1.34) * 1.08 + Math.max(0, bass - 0.60) * 0.18 * beatTransient, 0, 1);
  skullBeatFlash += (flashTarget - skullBeatFlash) * Math.min(1, dt * (flashTarget > skullBeatFlash ? 24.0 : 6.2));
  if (skullParticleGroup.material.uniforms.uSkullFlash) skullParticleGroup.material.uniforms.uSkullFlash.value = skullBeatFlash;
  var jawTarget = clampRange(0.60 + (0.5 + 0.5 * Math.sin(uniforms.uTime.value * 0.50)) * 0.050 + bass * 0.060 + skullBeatFlash * 0.090, 0.52, 0.88);
  skullJawOpen += (jawTarget - skullJawOpen) * Math.min(1, dt * (jawTarget > skullJawOpen ? 7.8 : 3.4));
  if (skullParticleGroup.material.uniforms.uJawOpen) skullParticleGroup.material.uniforms.uJawOpen.value = skullJawOpen;
  var shelfComposition = isSkullShelfCompositionActive();
  var shelfMix = clampRange(skullShelfCameraMix || (shelfComposition ? 1 : 0), 0, 1);
  var drift = skullBreathOffset(uniforms.uTime.value, shelfComposition);
  var ampTarget = clampRange(bass * 0.006 + mid * 0.004 + skullBeatFlash * 0.070, 0, 0.090);
  skullAmpPulse += (ampTarget - skullAmpPulse) * Math.min(1, dt * (ampTarget > skullAmpPulse ? 11.0 : 4.0));
  var shelfScale = 3.02;
  var targetScale = (SKULL_MODEL_SCALE + (shelfScale - SKULL_MODEL_SCALE) * shelfMix) * (1 + skullAmpPulse) * clampRange(1 - skullWheelZoom * 0.055, 0.92, 1.08);
  var shelfX = -1.18;
  var shelfY = 0.32;
  var targetX = (SKULL_MODEL_BASE_POSITION.x + (shelfX - SKULL_MODEL_BASE_POSITION.x) * shelfMix) + drift.x;
  var targetY = (SKULL_MODEL_BASE_POSITION.y + (shelfY - SKULL_MODEL_BASE_POSITION.y) * shelfMix) + drift.y;
  var targetZ = SKULL_MODEL_BASE_POSITION.z + drift.z;
  skullParticleGroup.position.x += (targetX - skullParticleGroup.position.x) * Math.min(1, dt * 4.2);
  skullParticleGroup.position.y += (targetY - skullParticleGroup.position.y) * Math.min(1, dt * 4.8);
  skullParticleGroup.position.z += (targetZ - skullParticleGroup.position.z) * Math.min(1, dt * 4.2);
  skullParticleGroup.scale.x += (targetScale - skullParticleGroup.scale.x) * Math.min(1, dt * 4.6);
  skullParticleGroup.scale.y = skullParticleGroup.scale.x;
  skullParticleGroup.scale.z = skullParticleGroup.scale.x;
  var targetRotY = SKULL_MODEL_BASE_ROTATION_Y + (orbit.centerLocked ? 0 : (headParallax.active ? headParallax.x * 0.5 : 0) + gestureRotation.y);
  var targetRotX = SKULL_MODEL_BASE_ROTATION_X + (orbit.centerLocked ? 0 : (headParallax.active ? -headParallax.y * 0.35 : 0) + gestureRotation.x);
  var rotEase = Math.min(1, dt * 7.4);
  skullParticleGroup.rotation.y += (targetRotY - skullParticleGroup.rotation.y) * rotEase;
  skullParticleGroup.rotation.x += (targetRotX - skullParticleGroup.rotation.x) * rotEase;
  skullParticleGroup.rotation.z += (0 - skullParticleGroup.rotation.z) * Math.min(1, dt * 6.0);
}

// ============================================================
//  封面背面粒子层 (v7.2)
//   - 独立 Points, 放在 z=-1.5 (主封面平面背面)
//   - 颜色取自封面镜像 UV
//   - 慢呼吸 + 小幅 noise 漂移
//   - 跟主粒子同步旋转 (在主循环里赋值)
//   - 视角转到背面才能看到 — 不需要手动控制 visible
// ============================================================
var BACK_COVER_COUNT = 3000;
var backCoverGroup = null;
var backCoverColorArr = null;

function createBackCoverLayer() {
  if (backCoverGroup) return;
  var bg = new THREE.BufferGeometry();
  var bp = new Float32Array(BACK_COVER_COUNT * 3);
  var bc = new Float32Array(BACK_COVER_COUNT * 3);
  var br = new Float32Array(BACK_COVER_COUNT);
  var bu = new Float32Array(BACK_COVER_COUNT * 2);  // 镜像 UV 用于采样封面
  for (var i = 0; i < BACK_COVER_COUNT; i++) {
    var u = Math.random();
    var v = Math.random();
    // 在 PLANE_SIZE 范围内分布
    bp[i*3]   = (u - 0.5) * PLANE_SIZE;
    bp[i*3+1] = (v - 0.5) * PLANE_SIZE;
    bp[i*3+2] = -1.5 - Math.random() * 0.4;  // 在主平面后方
    bu[i*2]   = 1.0 - u;  // 镜像 X
    bu[i*2+1] = v;
    br[i] = Math.random();
    bc[i*3] = 0.7; bc[i*3+1] = 0.6; bc[i*3+2] = 0.8;  // 占位
  }
  bg.setAttribute('position', new THREE.BufferAttribute(bp, 3));
  bg.setAttribute('aColor',   new THREE.BufferAttribute(bc, 3));
  bg.setAttribute('aRand',    new THREE.BufferAttribute(br, 1));
  bg.setAttribute('aUv',      new THREE.BufferAttribute(bu, 2));

  var vs = `
    precision highp float;
    uniform float uTime, uBass, uPixel, uAlpha;
    attribute vec3 aColor;
    attribute vec2 aUv;
    attribute float aRand;
    varying vec3 vC;
    varying float vA;
    void main(){
      vec3 pos = position;
      // 缓慢呼吸
      pos.x += sin(uTime * 0.20 + aRand * 8.0) * 0.20;
      pos.y += cos(uTime * 0.18 + aRand * 6.0) * 0.22;
      pos.z += sin(uTime * 0.12 + aRand * 5.0) * 0.18 + uBass * 0.12 * sin(aRand * 11.0);
      vC = aColor;
      vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
      float dist = -mvPos.z;
      vA = clamp(0.30 + 0.4 * sin(uTime * 0.6 + aRand * 5.0), 0.10, 0.65);
      float sz = clamp(46.0 / max(0.5, dist), 1.4, 4.5);
      gl_PointSize = sz * uPixel;
      gl_Position = projectionMatrix * mvPos;
    }
  `;
  var fs = `
    precision highp float;
    uniform sampler2D uDotTex;
    uniform float uAlpha;
    varying vec3 vC;
    varying float vA;
    void main(){
      vec4 tex = texture2D(uDotTex, gl_PointCoord);
      if (tex.a < 0.02) discard;
      gl_FragColor = vec4(vC, tex.a * vA * uAlpha);
    }
  `;
  var mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: uniforms.uTime,
      uBass: uniforms.uBass,
      uPixel: uniforms.uPixel,
      uDotTex: uniforms.uDotTex,
      uAlpha: uniforms.uAlpha,
    },
    vertexShader: vs, fragmentShader: fs,
    transparent:true, depthWrite:false, blending: THREE.NormalBlending,
  });
  backCoverGroup = new THREE.Points(bg, mat);
  backCoverGroup.frustumCulled = false;
  backCoverColorArr = bc;
  scene.add(backCoverGroup);
}

function destroyBackCoverLayer() {
  if (!backCoverGroup) return;
  scene.remove(backCoverGroup);
  backCoverGroup.geometry.dispose(); backCoverGroup.material.dispose();
  backCoverGroup = null; backCoverColorArr = null;
}

function refreshBackCoverColorsFromCanvas(coverCanvas) {
  if (!backCoverGroup || !coverCanvas || !backCoverColorArr) return;
  var ctx = coverCanvas.getContext('2d');
  var img = ctx.getImageData(0, 0, coverCanvas.width, coverCanvas.height).data;
  var w = coverCanvas.width, h = coverCanvas.height;
  var attr = backCoverGroup.geometry.attributes;
  var uvA = attr.aUv.array;
  for (var i = 0; i < BACK_COVER_COUNT; i++) {
    var u = uvA[i*2], v = uvA[i*2+1];
    var sx = Math.floor(u * w);
    var sy = Math.floor(v * h);
    var di = (sy * w + sx) * 4;
    backCoverColorArr[i*3]   = img[di]   / 255 * 0.85;
    backCoverColorArr[i*3+1] = img[di+1] / 255 * 0.85;
    backCoverColorArr[i*3+2] = img[di+2] / 255 * 0.85;
  }
  attr.aColor.needsUpdate = true;
}
function updateFloatLayer(dt) {
  // 漂移已在 shader 中完成, JS 不需要每帧改 buffer
}
function refreshFloatColorsFromCover(coverCanvas) {
  if (!floatGroup || !coverCanvas) return;
  var ctx = coverCanvas.getContext('2d');
  var img = ctx.getImageData(0, 0, coverCanvas.width, coverCanvas.height).data;
  var w = coverCanvas.width, h = coverCanvas.height;
  for (var i = 0; i < FLOAT_COUNT; i++) {
    var sx = Math.floor(Math.random() * w);
    var sy = Math.floor(Math.random() * h);
    var di = (sy * w + sx) * 4;
    floatColorArr[i*3]   = img[di]   / 255 * 0.95;
    floatColorArr[i*3+1] = img[di+1] / 255 * 0.95;
    floatColorArr[i*3+2] = img[di+2] / 255 * 0.95;
  }
  floatGroup.geometry.attributes.aColor.needsUpdate = true;
}
function resetFloatColorsToIdle() {
  if (!floatGroup || !floatColorArr) return;
  for (var i = 0; i < FLOAT_COUNT; i++) {
    var white = 0.88 + (i % 17) / 17 * 0.12;
    floatColorArr[i*3] = white;
    floatColorArr[i*3+1] = white;
    floatColorArr[i*3+2] = white;
  }
  floatGroup.geometry.attributes.aColor.needsUpdate = true;
}
