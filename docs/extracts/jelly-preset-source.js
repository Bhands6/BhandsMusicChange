// ============================================================
//  水母花（Jelly，桌面预设 14 / Web 索引 8）代码提取
//  ============================================================
//  本文件是「提取稿」——仅供阅读 / 移植研究，不参与应用加载。
//  水母不是独立文件，而是分散在共享粒子 shader 的 else-if 分支里，
//  以下各段均从源码逐字拷贝，来源与行号见各节标注。
//
//  来源链：BhandsMusic_Web/apps/web/src/components/particleShaders.ts
//          → 桌面版 public/js/web-fx-presets.js（Web 索引 8 = uEff < 11.5 分支）
//
//  ── 运行时依赖（提取稿未包含，移植时需自备）──
//  · GLSL：snoise(vec3)          —— 主粒子着色器自带的 3D simplex noise
//  · GLSL：hash11 / gaussRand    —— hash11 在主着色器；gaussRand 见下（同文件提取）
//  · GLSL：aUv / aRand / uGrid   —— 主粒子几何的顶点属性（网格坐标 + 随机种子）
//  · GLSL：uPixel / uPointScale  —— 点尺寸换算 uniform
//  · GLSL：coverColor / uHasCover —— 封面取色混色
//  · GLSL：uBass / uMid / uTreble / uBeat / uEnergy —— 音频 uniform
//  · GLSL：PI                    —— 主着色器常量
//  · 宿主：uJellyAura uniform（03-particles.js 声明、18-session-boot.js 按窗口高度赋值）
//  · 输出约定：pos / vColor / vAlpha / vPack1.w(sizeTag) / sizeOverride / maxRippleAmp
// ============================================================

// ------------------------------------------------------------
//  1. 预设注册（web-fx-presets.js:18,39,51,64）
// ------------------------------------------------------------
// WEB_FX.JELLY = 14   —— 桌面索引；shader 内 uEff = uPreset - 3 = 11
//                     —— Web 源码里是分支 8（阈值 uEff < 11.5）
var JELLY_META   = { name: '水母花', desc: '伞盖 · 触须' };
var JELLY_ICON   = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M8 9c0-2.2 1.8-4 4-4s4 1.8 4 4c0 1.5-.8 2.5-2 3.2V18"/><path d="M10 21v-3"/><path d="M7 12c-1 .8-1.5 1.8-1.5 3M17 12c1 .8 1.5 1.8 1.5 3"/></svg>';
var JELLY_CAMERA = { radius: 10.6, phi: 0.06 };   // 最远的机位之一（水母群铺得开）

// 主层需 Additive 混合（水母/玫瑰/心跳/字符雨同组，web-fx-presets.js:23-25）
function jellyNeedsAdditive(preset) { return preset === 14; }

// ------------------------------------------------------------
//  2. GLSL 常量（web-fx-presets.js:91-95）
// ------------------------------------------------------------
var JELLY_GLSL_CONSTANTS = [
  '#define JELLY_COUNT 10.0',        // 水母数量
  '#define JELLY_TENDRILS 4.0',      // 每只触须根数
  '#define JELLY_HEAD_SHARE 0.05',   // role<0.05   的粒子 → 头部核心（亮）
  '#define JELLY_HAZE_SHARE 0.05',   // +0.05       → 体外雾晕（大而淡）
  '#define JELLY_DOME_SHARE 0.50',   // +0.50       → 伞盖（球面壳，主体）
  // 其余 0.40        → 触须（下坠摆动 + curl 噪声漂移）
  // aura 点：每个 creature 固定吃走 jpid<10 的 2 个网格点 → 内/外两层光晕
].join('\n');

// ------------------------------------------------------------
//  3. curl 噪声助手（web-fx-presets.js:133-140，依赖 snoise）
// ------------------------------------------------------------
var JELLY_GLSL_CURL = [
  'vec2 jellyCurl(vec2 p, float tt){',
  '  float e = 0.35;',
  '  float n1 = snoise(vec3(p.x, p.y + e, tt));',
  '  float n2 = snoise(vec3(p.x, p.y - e, tt));',
  '  float n3 = snoise(vec3(p.x + e, p.y, tt));',
  '  float n4 = snoise(vec3(p.x - e, p.y, tt));',
  '  return vec2(n1 - n2, n4 - n3) / (2.0 * e);',
  '}'
].join('\n');

// gaussRand（web-fx-presets.js:124-128，头部/雾晕的高斯散布用；hash11 为主着色器自带）
var JELLY_GLSL_GAUSS = [
  'float gaussRand(float seed){',
  '  float h1 = max(hash11(seed), 0.0001);',
  '  float h2 = hash11(seed + 17.17);',
  '  return sqrt(-2.0 * log(h1)) * cos(6.2831853 * h2);',
  '}'
].join('\n');

// ------------------------------------------------------------
//  4. 顶点着色器水母分支（web-fx-presets.js:309-412，逐字提取）
//     入口条件：uEff < 11.5（uEff = uPreset - 3，桌面预设 14 时 uEff = 11）
// ------------------------------------------------------------
var JELLY_GLSL_BRANCH = [
'  else if (uEff < 11.5) {',
'    float t6 = t * 0.55;',
'    float creature = floor(hash11(aRand * 101.0) * JELLY_COUNT);',
'    float role = hash11(aRand * 211.0);',
'    float jgx = floor(aUv.x * uGrid);',
'    float jgy = floor(aUv.y * uGrid);',
'    float jpid = jgy * uGrid + jgx;',
'    float auraKind = -1.0;',
'    if (jpid < JELLY_COUNT * 2.0) {',
'      creature = floor(jpid / 2.0);',
'      auraKind = mod(jpid, 2.0);',
'    }',
'    float cx = (hash11(creature * 17.0 + 3.0) - 0.5) * 10.0;',
'    float cy = (hash11(creature * 29.0 + 5.0) - 0.5) * 4.4 + 0.8;',
'    float cz = (hash11(creature * 43.0 + 7.0) - 0.5) * 3.0;',
'    cx += sin(t6 * 0.24 + creature * 2.1) * 1.50 + sin(t6 * 0.11 + creature * 3.7) * 0.80;',
'    cy += sin(t6 * 0.31 + creature * 1.3) * 0.90 + sin(t6 * 0.17 + creature * 4.3) * 0.45;',
'    cz += cos(t6 * 0.20 + creature * 2.9) * 0.80 + sin(t6 * 0.13 + creature * 5.1) * 0.40;',
'    float breath = 0.82 + 0.18 * sin(t6 * 1.5 + creature * 2.4);',
'    float cphase = t6 * 1.4 + hash11(creature * 131.0) * 6.2831853;',
'    float contract = pow(0.5 - 0.5 * cos(cphase), 1.8);',
'    cy += contract * 0.35;',
'    vec3 jp = vec3(cx, cy, cz);',
'    vec3 jc = vec3(0.62, 0.78, 1.0);',
'    float jellyAlpha = 0.0;',
'    float sizeTag = 0.45;',
'    if (auraKind >= 0.0) {',
'      bool inner = auraKind < 0.5;',
'      jc = inner ? vec3(0.88, 0.94, 1.0) : vec3(0.62, 0.78, 1.0);',
'      jellyAlpha = (inner ? 0.11 : 0.055) * (0.85 + 0.15 * breath);',
'      sizeOverride = uJellyAura * (inner ? 0.58 : 1.0) / max(0.0001, uPixel * uPointScale);',
'      maxRippleAmp = max(maxRippleAmp, uBass * 0.04);',
'    } else if (role < JELLY_HEAD_SHARE) {',
'      vec3 g = vec3(',
'        gaussRand(aRand * 13.3 + 1.1),',
'        gaussRand(aRand * 17.7 + 2.2),',
'        gaussRand(aRand * 19.9 + 3.3)',
'      ) * 0.20;',
'      jp += g;',
'      jellyAlpha = (0.50 + hash11(aRand * 23.0) * 0.28) * breath;',
'      jc = mix(vec3(0.97, 0.99, 1.0), vec3(0.85, 0.92, 1.0), hash11(aRand * 29.0) * 0.5);',
'      jc = mix(jc, vec3(1.0, 0.87, 0.66), uBass * 0.35);',
'      sizeTag = 1.35;',
'      maxRippleAmp = max(maxRippleAmp, uMid * 0.08 + uBass * 0.05);',
'    } else if (role < JELLY_HEAD_SHARE + JELLY_HAZE_SHARE) {',
'      vec3 g = vec3(',
'        gaussRand(aRand * 31.1 + 4.4),',
'        gaussRand(aRand * 37.3 + 5.5),',
'        gaussRand(aRand * 41.9 + 6.6)',
'      ) * vec3(0.85, 0.70, 0.55);',
'      jp += g;',
'      jellyAlpha = 0.05 + hash11(aRand * 43.0) * 0.05;',
'      jc = vec3(0.72, 0.84, 1.0);',
'      sizeTag = 1.60;',
'      maxRippleAmp = max(maxRippleAmp, uMid * 0.03);',
'    } else if (role < JELLY_HEAD_SHARE + JELLY_HAZE_SHARE + JELLY_DOME_SHARE) {',
'      float du = hash11(aRand * 431.0);',
'      float dphi = hash11(aRand * 437.0) * 6.2831853;',
'      float isInner = step(0.82, hash11(aRand * 449.0));',
'      float domeR = (0.95 + hash11(creature * 83.0) * 0.40) * breath * (1.0 - 0.12 * contract);',
'      float theta = acos(max(1.0 - du, 0.0));',
'      float rr = domeR * mix(1.0, pow(max(hash11(aRand * 457.0), 0.0), 0.3333) * 0.96, isInner);',
'      float skirt = 1.0 - smoothstep(0.78, 1.0, du) * 0.12;',
'      float sth = sin(theta);',
'      jp.x += sth * cos(dphi) * rr * skirt;',
'      jp.z += sth * sin(dphi) * rr * skirt;',
'      jp.y += cos(theta) * rr * (0.90 - 0.20 * contract);',
'      jellyAlpha = (0.24 - du * 0.09) * mix(1.0, 0.55, isInner) * (1.0 + contract * 0.25);',
'      jc = mix(vec3(0.97, 0.99, 1.0), vec3(0.60, 0.76, 1.0), smoothstep(0.15, 0.85, du));',
'      jc = mix(jc, vec3(0.83, 0.72, 1.0), smoothstep(0.75, 1.0, du));',
'      sizeTag = 0.80;',
'      maxRippleAmp = max(maxRippleAmp, uMid * 0.09);',
'    } else {',
'      float tt = fract(hash11(aRand * 601.0) + jpid * 0.618034);',
'      float tn = floor(hash11(aRand * 503.0) * JELLY_TENDRILS);',
'      float ta0 = (tn / JELLY_TENDRILS) * 6.2831853 + (hash11(creature * 91.0) - 0.5) * 0.8;',
'      float ta = ta0 + sin(t6 * 0.42 + creature * 1.1 + tn * 2.3) * 0.45 * (0.30 + 0.70 * tt);',
'      float tl = 1.8 + hash11(creature * 97.0 + tn * 13.0) * 1.1;',
'      float bend = sin(t6 * 0.42 + creature * 1.3 - tt * 2.6 + tn * 1.7) * 0.30 * tt;',
'      float sway = sin(tt * 3.4 - t6 * 1.05 + ta0 * 3.0 + creature) * (0.16 + 0.34 * tt);',
'      float sway2 = cos(tt * 6.1 - t6 * 1.9 + ta0 * 4.7) * 0.07 * tt;',
'      float spread = 0.30 + tt * 0.50 + sin(t6 * 0.5 + ta0 * 2.0) * 0.08;',
'      jp.x += cos(ta) * spread + bend + sway + sway2 * 0.6;',
'      jp.y += -(tt * tt) * tl + sin(tt * 3.0 - t6 * 0.8 + ta0) * 0.10 * tt;',
'      jp.y -= contract * 0.30 * tt;',
'      jp.z += sin(ta) * spread * 0.6 + cos(tt * 5.0 - t6 * 1.5 + ta0 * 2.0) * 0.12 * tt;',
'      vec2 cr = jellyCurl(vec2(ta0 * 1.7, tt * 1.3 + creature * 3.1), t6 * 0.50);',
'      cr = clamp(cr, vec2(-1.0), vec2(1.0));',
'      jp.x += cr.x * 0.34 * tt;',
'      jp.z += cr.y * 0.22 * tt;',
'      jellyAlpha = (0.40 - tt * 0.26) * (0.7 + hash11(aRand * 613.0) * 0.3);',
'      jc = mix(vec3(0.70, 0.83, 1.0), vec3(0.48, 0.64, 0.96), tt * 0.6);',
'      sizeTag = 0.58;',
'      maxRippleAmp = max(maxRippleAmp, uMid * 0.06 + (1.0 - tt) * 0.04);',
'    }',
'    float fogT = clamp((jp.z + 2.8) / 5.8, 0.0, 1.0);',
'    jellyAlpha *= mix(0.50, 1.0, fogT);',
'    jc = mix(jc * vec3(0.60, 0.74, 1.05) * 0.82, jc, fogT);',
'    pos = jp;',
'    vColor = mix(jc, coverColor, 0.12 + 0.16 * uHasCover);',
'    vAlpha = jellyAlpha * (1.0 + uBass * 0.18);',
'    vPack1.w = sizeTag;',
'    maxRippleAmp = max(maxRippleAmp, uBass * 0.06 + uEnergy * 0.04);',
'  }'
].join('\n');

// ------------------------------------------------------------
//  5. 亮度 / 点尺寸后处理（web-fx-presets.js:634-635, 654-655；用桌面 uPreset=14）
// ------------------------------------------------------------
var JELLY_GLSL_BRIGHT = [
  'else if (uPreset > 13.5 && uPreset < 14.5) {',
  '  vBright = 0.92 + maxRippleAmp * 0.60 + uBass * 0.05 + uEnergy * 0.04;',
  '}'
].join('\n');
var JELLY_GLSL_SIZE = [
  'else if (uPreset > 13.5 && uPreset < 14.5) {',
  '  sz = clamp(depthSize * vPack1.w * (1.0 + maxRippleAmp * 0.22), 0.40, 3.40);',
  '}'
].join('\n');

// ------------------------------------------------------------
//  6. 宿主侧：uJellyAura uniform（光晕点屏上大小，随窗口高度缩放）
// ------------------------------------------------------------
// 声明（public/js/app/03-particles.js:182）：
var JELLY_UNIFORM_DECL = 'uJellyAura: { value: 240 },';
// 每帧 / resize 赋值（public/js/app/18-session-boot.js:1242）：
var JELLY_UNIFORM_UPDATE = 'uniforms.uJellyAura.value = Math.min(dbSize.y * 0.25, maxPointSize);';

// ------------------------------------------------------------
//  7. 音频重映射（web-fx-presets.js:759-761，webIdx = preset - 3 ∈ (10.5, 11.5)）
//     水母落在最后的通用分支：mid 略提、bass 略压
// ------------------------------------------------------------
var JELLY_AUDIO_REMAP = [
  '} else if (webIdx > 10.5) {',
  '  mid = Math.min(0.95, mid * 1.10);',
  '  bass = Math.min(0.60, bass * 0.88);',
  '}'
].join('\n');

// ------------------------------------------------------------
//  8. 结构速记（移植时的心智模型）
//  ------------------------------------------------------------
//  每只水母 = ① 光晕点 ×2（jpid<10 的网格点固定认领，内圈小亮 / 外圈大淡，
//              屏上大小由 uJellyAura 直接给）
//            ② 头部核心（role<0.05，高斯散布在中心，低频泛暖金）
//            ③ 体外雾晕（role<0.10，散布 ±(0.85,0.70,0.55)，1.6 倍大点）
//            ④ 伞盖（role<0.60，球面壳：acos 均匀采样 + breath 呼吸 +
//              contract 收缩抬起，裙边 du>0.78 微收，顶部 18% 内层更亮）
//            ⑤ 触须（其余 40%，4 根/只，golden-ratio 沿须分布，
//              下坠 tt²×tl + 摆动 bend/sway + jellyCurl 噪声漂移，
//              前端粗后端淡）
//  整体：个体多频正弦游移 + 呼吸 + 收缩相位；z 做 fog 压暗（0.50~1.0）；
//        颜色与封面取色混 12%~28%；Additive 混合发光。
module.exports = {
  JELLY_META: JELLY_META,
  JELLY_ICON: JELLY_ICON,
  JELLY_CAMERA: JELLY_CAMERA,
  JELLY_GLSL_CONSTANTS: JELLY_GLSL_CONSTANTS,
  JELLY_GLSL_CURL: JELLY_GLSL_CURL,
  JELLY_GLSL_GAUSS: JELLY_GLSL_GAUSS,
  JELLY_GLSL_BRANCH: JELLY_GLSL_BRANCH,
  JELLY_GLSL_BRIGHT: JELLY_GLSL_BRIGHT,
  JELLY_GLSL_SIZE: JELLY_GLSL_SIZE,
  JELLY_UNIFORM_DECL: JELLY_UNIFORM_DECL,
  JELLY_UNIFORM_UPDATE: JELLY_UNIFORM_UPDATE,
  JELLY_AUDIO_REMAP: JELLY_AUDIO_REMAP
};
