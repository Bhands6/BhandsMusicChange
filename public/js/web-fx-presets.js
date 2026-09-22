// ============================================================
//  Web 版新增 9 个粒子特效 · 移植到桌面版
//  极光 / 万花筒 / 迸发 / 声波地形 / 螺旋星云 / 水母花 / 玫瑰 / 心跳 / 字符雨
//
//  来源：BhandsMusic_Web/apps/web/src/components/particleShaders.ts + ParticleStage.tsx
//  桌面预设索引（保留 0–5 原 shader + 6 安魂 + 7/8 音域回响）：
//    9 极光 · 10 万花筒 · 11 迸发 · 12 声波地形 · 13 螺旋星云
//    14 水母花 · 15 玫瑰 · 16 心跳 · 17 字符雨
//  shader 内用 uEff = desktopIndex - 3 映射到 Web 的 6–14 分支阈值。
// ============================================================
(function (global) {
  'use strict';

  var WEB_FX = {
    DESKTOP_BASE: 9,          // 桌面第一个新预设
    WEB_BASE: 6,              // Web 对应起始
    AURORA: 9, KALEIDO: 10, BURST: 11, SONIC: 12, SPIRAL: 13,
    JELLY: 14, ROSE: 15, HEART: 16, RAIN: 17,
    ROSE_GRID_BOOST: 1.5
  };

  // 主层需 Additive 的预设（水母/玫瑰/心跳/字符雨）
  function webFxNeedsAdditive(preset) {
    return preset === WEB_FX.JELLY || preset === WEB_FX.ROSE || preset === WEB_FX.HEART || preset === WEB_FX.RAIN;
  }
  function webFxNeedsGalaxyReset(preset) {
    return preset === WEB_FX.SPIRAL || preset === WEB_FX.ROSE || preset === WEB_FX.HEART || preset === WEB_FX.RAIN;
  }
  function webFxIsNewPreset(preset) {
    return preset >= WEB_FX.DESKTOP_BASE && preset <= WEB_FX.RAIN;
  }

  var PRESET_META = [
    { name: '极光', desc: '光幕 · 流星' },
    { name: '万花筒', desc: '径向镜像 · 十瓣' },
    { name: '迸发', desc: '换歌爆开 · 常驻云' },
    { name: '声波地形', desc: '音乐山脊 · 扫描' },
    { name: '螺旋星云', desc: '双旋臂 · 差速自转' },
    { name: '水母花', desc: '伞盖 · 触须' },
    { name: '玫瑰', desc: '数学玫瑰 · 绽放' },
    { name: '心跳', desc: '爱心粒子 · 星空' },
    { name: '字符雨', desc: 'Matrix 字形雨' }
  ];

  var PRESET_ICONS = [
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 17c2-5 3.5-7 5-7s2.5 3 4 3 2.5-5 4.5-5 3.5 3 4.5 6"/><path d="M3 20c2-3 4-3 6 0"/></svg>',
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="3"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/></svg>',
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="2.2"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/></svg>',
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 16c2-4 4-4 6 0s4 4 6 0 3-3 6 0"/><path d="M3 10c2 3 4 3 6 0s4-3 6 0 3 2 6 0"/></svg>',
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="2"/><path d="M12 10c4-6 9-4 8 1-1 4-6 5-8 1z"/><path d="M12 14c-4 6-9 4-8-1 1-4 6-5 8-1z"/></svg>',
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M8 9c0-2.2 1.8-4 4-4s4 1.8 4 4c0 1.5-.8 2.5-2 3.2V18"/><path d="M10 21v-3"/><path d="M7 12c-1 .8-1.5 1.8-1.5 3M17 12c1 .8 1.5 1.8 1.5 3"/></svg>',
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M12 20c-4-3-7-6.2-7-9.5C5 7.5 7.5 5 10 5c1 0 1.7.4 2 1 .3-.6 1-1 2-1 2.5 0 5 2.5 5 5.5 0 3.3-3 6.5-7 9.5z"/><path d="M12 11c1.2-1 2.2-1.2 3.2-.6"/></svg>',
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M12 20s-6.5-4.2-8.2-8.1C2.5 9 4.2 6 7.2 6c1.6 0 2.7.8 3.3 1.8C11.1 6.8 12.2 6 13.8 6c3 0 4.7 3 3.4 5.9C15.5 15.8 12 20 12 20z"/><path d="M8 12h1.5l1-2 1.5 4 1-2H16"/></svg>',
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M7 4v14M7 20h.01"/><path d="M12 6v10M12 20h.01"/><path d="M17 3v12M17 20h.01"/><path d="M5 6h4M10 9h4M15 5h4"/></svg>'
  ];

  // 相机机位（对齐 Web PRESET_CAMERA；键为桌面索引）
  var PRESET_CAMERA = {
    9:  { radius: 8.4, phi: 0.05 },  // aurora
    10: { radius: 6.8, phi: 0.07 },  // kaleido
    11: { radius: 6.6, phi: 0.06 },  // burst
    12: { radius: 9.2, phi: 0.30 },  // sonic
    13: { radius: 8.8, phi: 0.34 },  // spiral
    14: { radius: 10.6, phi: 0.06 }, // jelly
    15: { radius: 8.2, phi: 0.05 },  // rose
    16: { radius: 9.0, phi: 0.03 },  // heart
    17: { radius: 9.5, phi: 0.02 }   // rain
  };

  // ---- GLSL：常量 + 辅助（插在 hash11 之后）----
  var GLSL_CONSTANTS = [
    '#define METEOR_SLOTS 5.0',
    '#define METEOR_WAVE_PERIOD 7.0',
    '#define SPIRAL_RMAX 7.4',
    '#define GALAXY_BRANCHES 2.0',
    '#define GALAXY_SPIN 1.4',
    '#define GALAXY_RANDOMNESS 0.45',
    '#define GALAXY_RANDOMNESS_POWER 3.2',
    '#define GALAXY_THICKNESS 0.4',
    '#define GALAXY_RADIAL_POW 1.25',
    '#define GALAXY_BASE_SPIN 0.05',
    '#define GALAXY_DIFF_SPEED 0.08',
    '#define GALAXY_FLATTEN 0.42',
    '#define GALAXY_BULGE_TIGHT 0.55',
    '#define GALAXY_BULGE_XY 0.19',
    '#define GALAXY_BULGE_Z 0.55',
    '#define GALAXY_CORE_R 0.52',
    '#define GALAXY_CORE_DIM 0.58',
    '#define GALAXY_CORE_SHRINK 0.74',
    '#define GALAXY_CORE_PULSE 0.4',
    '#define JELLY_COUNT 10.0',
    '#define JELLY_TENDRILS 4.0',
    '#define JELLY_HEAD_SHARE 0.05',
    '#define JELLY_HAZE_SHARE 0.05',
    '#define JELLY_DOME_SHARE 0.50',
    '#define ROSE_SIZE 500.0',
    '#define ROSE_H -250.0',
    '#define ROSE_LAYERS 46.0',
    '#define ROSE_SCREEN_W 640.0',
    '#define ROSE_SCREEN_H 480.0',
    '#define ROSE_WORLD_H 5.2',
    '#define ROSE_DEPTH_SCALE 0.0028',
    '#define ROSE_DIST_NORM 300.0',
    '#define ROSE_APPEAR 1.8',
    '#define ROSE_SPIN_DOMAIN 0.18',
    '#define ROSE_WRAP_FADE 0.06',
    '#define ROSE_LEAF_CENTER vec2(325.0, 210.0)',
    '#define ROSE_CROWN_SCALE 1.22',
    '#define ROSE_CROWN_SHARE 0.88',
    '#define HEART_SCALE 0.0145',
    '#define HEART_LIFE 2.0',
    '#define HEART_V0 100.0',
    '#define HEART_DRAG 0.75',
    '#define HEART_APPEAR 1.6',
    '#define HEART_STAR_SHARE 0.22',
    '#define HEART_DUST_SHARE 0.18',
    '#define RAIN_COLS 120.0',
    '#define RAIN_ROWS 72.0',
    '#define RAIN_W 15.0',
    '#define RAIN_H 8.8',
    '#define RAIN_TRAIL 0.78',
    '#define RAIN_APPEAR 1.2',
    'float triWave(float x){ float f = fract(x); return abs(f * 2.0 - 1.0); }',
    'float gaussRand(float seed){',
    '  float h1 = max(hash11(seed), 0.0001);',
    '  float h2 = hash11(seed + 17.17);',
    '  return sqrt(-2.0 * log(h1)) * cos(6.2831853 * h2);',
    '}',
    'float armScatter(float seed, float r){',
    '  float mag = pow(max(hash11(seed), 0.0), GALAXY_RANDOMNESS_POWER) * GALAXY_RANDOMNESS * r;',
    '  return mag * mix(-1.0, 1.0, step(0.5, hash11(seed + 7.77)));',
    '}',
    'vec2 jellyCurl(vec2 p, float tt){',
    '  float e = 0.35;',
    '  float n1 = snoise(vec3(p.x, p.y + e, tt));',
    '  float n2 = snoise(vec3(p.x, p.y - e, tt));',
    '  float n3 = snoise(vec3(p.x + e, p.y, tt));',
    '  float n4 = snoise(vec3(p.x - e, p.y, tt));',
    '  return vec2(n1 - n2, n4 - n3) / (2.0 * e);',
    '}'
  ].join('\n');

  // ---- GLSL：9 个预设分支（else-if 链；uEff 为 Web 索引 6–14）----
  // 注：源码注释中不得出现反引号。
  var GLSL_BRANCHES = [
'  else if (uEff < 6.5) {',
'    float gx = floor(aUv.x * uGrid);',
'    float gy = floor(aUv.y * uGrid);',
'    float pid = gy * uGrid + gx;',
'    float waveIdx = floor(t / METEOR_WAVE_PERIOD);',
'    float wphase = fract(t / METEOR_WAVE_PERIOD);',
'    float meteorsThisWave = 3.0 + floor(hash11(waveIdx * 13.71 + 3.3) * 3.0);',
'    if (pid < meteorsThisWave) {',
'      float s1 = hash11(waveIdx * 31.7 + pid * 12.9898 + 1.7);',
'      float s2 = hash11(waveIdx * 57.3 + pid * 78.233 + 4.1);',
'      float s3 = hash11(waveIdx * 91.1 + pid * 37.719 + 8.3);',
'      float mph = (wphase - pid * 0.055) / 0.34;',
'      float life = smoothstep(0.0, 0.06, mph) * (1.0 - smoothstep(0.86, 1.0, mph));',
'      float ang = PI + 0.38 + s1 * 0.18;',
'      vec2 dir = vec2(cos(ang), sin(ang));',
'      vec2 p0 = vec2(4.2 + s2 * 4.6, 4.6 - s3 * 1.2);',
'      vec2 headP = p0 + dir * (mph * (16.0 + s3 * 3.0));',
'      pos = vec3(headP, 1.0 - s2 * 1.6);',
'      vMeteor = life;',
'      vPack1.z = ang;',
'      vColor = mix(vec3(0.74, 0.87, 1.0), coverColor, 0.30);',
'      vAlpha = 1.0;',
'      sizeOverride = uMeteorSize / max(0.0001, uPixel * uPointScale);',
'    } else {',
'      float layer = floor(aUv.y * 3.0);',
'      float ly = fract(aUv.y * 3.0);',
'      float lseed = hash11(layer * 17.3 + aRand * 3.1);',
'      float x = (aUv.x - 0.5) * 11.0;',
'      float floorY = -3.2 + lseed * 1.0;',
'      float height = 3.0 + lseed * 1.5 + uBass * 0.9 * K;',
'      float phase = t * (0.20 + lseed * 0.14) + aRand * 6.28;',
'      float wave = snoise(vec3(aUv.x * 3.4 + lseed * 9.0, layer * 2.3, t * 0.16 + lseed * 4.0)) * 1.15',
'                 + sin(aUv.x * 9.0 + t * 0.7 + lseed * 6.0) * 0.40;',
'      pos.x = x + wave * ly * 1.05 + sin(phase) * 0.18;',
'      pos.y = floorY + ly * height + sin(aUv.x * 12.0 - t * 1.3 + lseed * 3.0) * 0.22 * (0.4 + ly);',
'      pos.z = -3.4 + layer * 1.7 + wave * 0.70 + snoise(vec3(aUv.x * 2.0, ly * 3.0, t * 0.24)) * 0.80;',
'      float spark = pow(max(0.0, sin(t * (3.2 + lseed * 4.0) + aRand * 31.0)), 12.0);',
'      float shimmer = 0.55 + 0.45 * sin(t * (2.0 + lseed * 1.6) + aUv.x * 22.0 + layer * 2.0);',
'      float hMix = clamp(ly * 1.15, 0.0, 1.0);',
'      vec3 auroraCol = mix(vec3(0.22, 0.98, 0.66), vec3(0.62, 0.42, 1.0), hMix);',
'      auroraCol = mix(auroraCol, vec3(0.98, 0.55, 0.82), pow(hMix, 3.0) * 0.55);',
'      vColor = mix(auroraCol, coverColor, 0.34) * (0.72 + shimmer * 0.34 + spark * 0.9);',
'      float curtainFade = smoothstep(0.0, 0.20, ly) * (1.0 - smoothstep(0.74, 1.0, ly));',
'      vAlpha = (0.10 + ly * 0.34 + spark * 0.50 + uTreble * 0.16) * curtainFade;',
'      maxRippleAmp = max(maxRippleAmp, ly * uBass * 0.34 + spark * 0.34 + shimmer * uMid * 0.10 + uBeat * 0.12);',
'    }',
'  }',
'  else if (uEff < 7.5) {',
'    float secAngle = PI * 2.0 / 10.0;',
'    float sector = floor(aUv.y * 10.0);',
'    float a0 = fract(aUv.y * 10.0) * secAngle;',
'    float a = (mod(sector, 2.0) < 0.5) ? a0 : (secAngle - a0);',
'    float ang = sector * secAngle + a + t * 0.10;',
'    float rr = pow(aUv.x, 0.72) * 4.6 + 0.20;',
'    pos.x = cos(ang) * rr;',
'    pos.y = sin(ang) * rr * 0.62;',
'    pos.z = snoise(vec3(cos(ang) * rr * 0.45, sin(ang) * rr * 0.45, t * 0.12)) * 1.35',
'          + (1.0 - aUv.x) * 0.85 + uBass * 0.50 * K;',
'    float ring = 0.5 + 0.5 * sin(aUv.x * 26.0 - t * 0.9 + sector * 1.7);',
'    vec3 kaleCol = mix(vec3(0.86, 0.72, 1.0), vec3(0.18, 0.96, 0.84), fract(sector * 0.37));',
'    kaleCol = mix(kaleCol, coverColor, 0.46 + aUv.x * 0.20);',
'    vColor = kaleCol * (0.78 + ring * 0.28 + uBeat * 0.12);',
'    vAlpha = (0.16 + ring * 0.30 + (1.0 - aUv.x) * 0.22 + uMid * 0.12)',
'           * (1.0 - smoothstep(0.88, 1.0, aUv.x));',
'    maxRippleAmp = max(maxRippleAmp, ring * uMid * 0.30 + uBass * 0.12 + (1.0 - aUv.x) * uBeat * 0.18);',
'  }',
'  else if (uEff < 8.5) {',
'    float wave = floor(hash11(aRand * 137.0) * 4.0);',
'    float lph = clamp((uBurstAge - wave * 0.075) / 0.80, 0.0, 1.0);',
'    float orbitR = (0.14 + hash11(aRand * 71.0) * 0.85) * 4.0;',
'    float rr = (0.10 + 0.90 * pow(lph, 0.62)) * orbitR;',
'    float ang = hash11(aRand * 37.0) * PI * 2.0 + t * 0.10;',
'    float driftY = sin(t * 0.35) * 0.12;',
'    pos.x = cos(ang) * rr;',
'    pos.y = sin(ang) * rr * 0.62 + driftY;',
'    pos.z = (hash11(aRand * 91.0) - 0.5) * 1.6 + (1.0 - lph) * 0.80;',
'    float dz = (lph - 0.90) / 0.18;',
'    float shell = exp(-dz * dz) * (1.0 - smoothstep(0.90, 1.0, lph));',
'    float lumC = dot(coverColor, vec3(0.299, 0.587, 0.114));',
'    vec3 coverC = max(mix(vec3(lumC), coverColor, 1.45), vec3(0.0));',
'    coverC = coverC * 0.86 + 0.14;',
'    vec3 toneA = mix(coverC, vec3(1.0), 0.22);',
'    vec3 toneB = mix(coverC, vec3(1.0, 0.72, 0.38), 0.38);',
'    vec3 coverTone = mix(toneA, toneB, hash11(aRand * 53.0));',
'    float radT = clamp(rr / 4.2, 0.0, 1.0);',
'    coverTone = mix(mix(coverTone, vec3(1.0), 0.22), coverTone * 0.92, radT);',
'    vec3 burstCol = mix(vec3(0.20, 0.96, 0.86), vec3(1.0, 0.60, 0.78), hash11(aRand * 53.0) * 0.5);',
'    vColor = mix(burstCol, coverTone, uHasCover) * (0.80 + shell * 0.75);',
'    vAlpha = smoothstep(0.0, 0.10, lph) * (0.34 + hash11(aRand * 19.0) * 0.42 + shell * 0.55);',
'    maxRippleAmp = max(maxRippleAmp, uBass * 0.20 + uMid * 0.10 + shell * 0.45 + uBeat * 0.06);',
'  }',
'  else if (uEff < 9.5) {',
'    float gx = aUv.x;',
'    float gz = aUv.y;',
'    float worldX = (gx - 0.5) * 13.0;',
'    float worldZ = (gz - 0.5) * 7.0;',
'    float tSeed1 = triWave(t / 27.0) * 0.62;',
'    float tSeed2 = triWave(t / 19.0) * 1.10;',
'    float tSeed3 = triWave(t / 13.0) * 3.30;',
'    float ridge = snoise(vec3(worldX * 0.55, worldZ * 0.42 + tSeed1, tSeed1)) * 1.28',
'                + snoise(vec3(worldX * 1.60, worldZ * 1.25 + tSeed2, tSeed2)) * 0.49',
'                + snoise(vec3(worldX * 4.20, worldZ * 3.40, tSeed3)) * 0.16;',
'    float depthShape = (0.5 - gz) * 1.05;',
'    float bassLift = uBass * 0.95 * clamp(1.0 - gz * 0.7, 0.3, 1.0);',
'    float h = ridge * (0.92 + uMid * 0.42) + depthShape + bassLift;',
'    h -= 0.42;',
'    float scanPos = triWave(t / 36.0);',
'    float dz = (gz - scanPos) * 4.2;',
'    float scanBand = min(1.0, exp(-dz * dz) * (0.72 + uBeat * 0.42));',
'    pos.x = worldX;',
'    pos.y = h;',
'    pos.z = worldZ - 4.0;',
'    float hN = clamp(h * 0.26 + 0.5, 0.0, 1.0);',
'    vec3 sonicCol = mix(vec3(0.10, 0.52, 0.62), vec3(0.86, 0.94, 0.98), hN);',
'    sonicCol = mix(sonicCol, vec3(0.72, 0.48, 1.0), scanBand * 0.55);',
'    vColor = mix(sonicCol, coverColor, 0.30) * (0.78 + hN * 0.30 + scanBand * 0.55);',
'    vAlpha = (0.10 + hN * 0.30 + scanBand * 0.52 + uTreble * 0.10)',
'           * (1.0 - smoothstep(0.86, 1.0, gz));',
'    maxRippleAmp = max(maxRippleAmp, scanBand * 0.55 + hN * uBass * 0.28 + uTreble * 0.14);',
'  }',
'  else if (uEff < 10.5) {',
'    float rr = pow(clamp(aUv.x, 0.0, 1.0), GALAXY_RADIAL_POW) * SPIRAL_RMAX + 0.05;',
'    float tN = clamp(rr / SPIRAL_RMAX, 0.0, 1.0);',
'    float armPick = floor(hash11(aRand * 313.0) * GALAXY_BRANCHES);',
'    float armOffset = (armPick / GALAXY_BRANCHES) * 2.0 * PI;',
'    float ang = armOffset + rr * GALAXY_SPIN;',
'    float scX = armScatter(aRand * 57.7 + 1.1, rr);',
'    float scZ = armScatter(aRand * 77.9 + 3.3, rr);',
'    float scY = armScatter(aRand * 97.1 + 5.5, rr) * GALAXY_THICKNESS;',
'    vec2 diskP = vec2(cos(ang) * rr + scX, sin(ang) * rr + scZ);',
'    float dSafe = max(length(diskP), 0.45);',
'    float dAng = uGalaxyAge * uSpeed * (GALAXY_BASE_SPIN + GALAXY_DIFF_SPEED / dSafe);',
'    float ca = cos(dAng);',
'    float sa = sin(dAng);',
'    diskP = mat2(ca, -sa, sa, ca) * diskP;',
'    float jitX = gaussRand(aRand * 11.1 + 9.9) * 0.08;',
'    float jitY = gaussRand(aRand * 22.2 + 4.4) * 0.05;',
'    float jitZ = gaussRand(aRand * 33.3 + 6.6) * 0.08;',
'    pos = vec3(',
'      diskP.x + jitX,',
'      diskP.y * GALAXY_FLATTEN + jitY * GALAXY_FLATTEN,',
'      scY + jitZ - 1.6',
'    );',
'    float bulge = exp(-rr * rr * GALAXY_BULGE_TIGHT);',
'    pos += vec3(',
'      gaussRand(aRand * 44.4 + 8.8) * GALAXY_BULGE_XY,',
'      gaussRand(aRand * 55.5 + 2.2) * GALAXY_BULGE_XY,',
'      gaussRand(aRand * 66.6 + 3.3) * GALAXY_BULGE_Z',
'    ) * bulge;',
'    vec3 coreCol = vec3(1.00, 0.84, 0.96);',
'    vec3 midCol  = vec3(0.37, 0.85, 1.00);',
'    vec3 edgeCol = vec3(0.13, 0.27, 0.80);',
'    vec3 spCol = (tN < 0.35)',
'      ? mix(coreCol, midCol, tN / 0.35)',
'      : mix(midCol, edgeCol, (tN - 0.35) / 0.65);',
'    vColor = mix(spCol, coverColor, 0.12);',
'    galaxyStar = pow(clamp(hash11(aRand * 731.0), 0.0, 1.0), 3.0) * 2.0 + 0.3;',
'    galaxyTwinkle = 0.5 + 0.5 * sin(t * 2.0 + jitX * 100.0);',
'    galaxyCore = smoothstep(0.03, GALAXY_CORE_R, tN);',
'    vAlpha = (0.80 * mix(GALAXY_CORE_DIM, 1.0, galaxyCore) + (galaxyStar - 0.3) * 0.10)',
'           * (1.0 - smoothstep(0.94, 1.0, aUv.x));',
'    maxRippleAmp = max(maxRippleAmp, uMid * 0.14 + uBass * 0.10 + galaxyTwinkle * 0.10 + (galaxyStar - 0.3) * 0.06);',
'  }',
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
'  }',
'  else if (uEff < 12.5) {',
'    float appearRaw = clamp(uGalaxyAge / ROSE_APPEAR, 0.0, 1.0);',
'    float appear = 1.0 - pow(1.0 - appearRaw, 3.0);',
'    float ra = fract(aUv.x + uGalaxyAge * ROSE_SPIN_DOMAIN);',
'    float rb = aUv.y;',
'    float layerRnd = hash11(aRand * 97.0);',
'    float layerF = layerRnd < ROSE_CROWN_SHARE',
'      ? (layerRnd / ROSE_CROWN_SHARE) * 28.0',
'      : 28.0 + ((layerRnd - ROSE_CROWN_SHARE) / (1.0 - ROSE_CROWN_SHARE)) * 18.0;',
'    float cc = floor(layerF) / 0.74;',
'    float edgeFade = smoothstep(0.0, ROSE_WRAP_FADE, min(ra, 1.0 - ra));',
'    vec3 rp = vec3(0.0);',
'    float rC = 0.0;',
'    float gC = 0.0;',
'    float valid = 0.0;',
'    if (cc > 60.0) {',
'      float spike = 13.0 + 5.0 / (0.2 + pow(clamp(rb * 4.0, 0.0, 4.0), 4.0));',
'      rp = vec3(',
'        sin(ra * 7.0) * spike - sin(rb) * 50.0,',
'        rb * ROSE_SIZE + 50.0,',
'        625.0 + cos(ra * 7.0) * spike + rb * 400.0',
'      );',
'      rC = ra - rb / 2.0;',
'      gC = ra;',
'      valid = 1.0;',
'    } else {',
'      float A = ra * 2.0 - 1.0;',
'      float B = rb * 2.0 - 1.0;',
'      if (A * A + B * B < 1.0) {',
'        valid = 1.0;',
'        if (cc > 37.0) {',
'          float j = mod(floor(cc), 2.0);',
'          float n = mix(4.0, 6.0, j);',
'          float o = 0.5 / (ra + 0.01) + cos(rb * 125.0) * 3.0 - ra * 300.0;',
'          float w = rb * ROSE_H;',
'          rp = vec3(',
'            o * cos(n) + w * sin(n) + j * 610.0 - 390.0,',
'            o * sin(n) - w * cos(n) + 550.0 - j * 350.0,',
'            1180.0 + cos(B + A) * 99.0 - j * 300.0',
'          );',
'          rC = 0.4 - ra * 0.1',
'             + pow(clamp(1.0 - B * B, 0.0, 1.0), 1500.0) * 0.15',
'             - ra * rb * 0.4',
'             + cos(ra + rb) / 5.0',
'             + pow(abs(cos((o * (ra + 1.0) + (B > 0.0 ? w : -w)) / 25.0)), 30.0) * 0.1 * (1.0 - B * B);',
'          gC = o / 1000.0 + 0.7 - o * w * 0.000003;',
'        } else if (cc > 32.0) {',
'          float c2 = cc * 1.16 - 0.15;',
'          float o = ra * 45.0 - 20.0;',
'          float w = rb * rb * ROSE_H;',
'          float z2 = o * sin(c2) + w * cos(c2) + 620.0;',
'          rp = vec3(',
'            o * cos(c2) - w * sin(c2),',
'            28.0 + cos(B * 0.5) * 99.0 - rb * rb * rb * 60.0 - z2 / 2.0 - ROSE_H,',
'            z2',
'          );',
'          rC = (rb * rb * 0.3 + pow(clamp(1.0 - A * A, 0.0, 1.0), 7.0) * 0.15 + 0.3) * rb;',
'          gC = rb * 0.7;',
'        } else {',
'          float o = A * (2.0 - rb) * (80.0 - cc * 2.0);',
'          float w = 99.0 - cos(A) * 120.0 - cos(rb) * (-ROSE_H - cc * 4.9)',
'                  + cos(pow(clamp(1.0 - rb, 0.0, 1.0), 7.0)) * 50.0 + cc * 2.0;',
'          float z3 = o * sin(cc) + w * cos(cc) + 700.0;',
'          rp = vec3(',
'            o * cos(cc) - w * sin(cc),',
'            B * 99.0 - cos(pow(clamp(1.0 - rb, 0.0, 1.0), 7.0)) * 50.0 - cc / 3.0 - z3 / 1.35 + 450.0,',
'            z3',
'          );',
'          rC = (1.0 - rb / 1.2) * 0.9 + ra * 0.1;',
'          gC = pow(clamp(1.0 - rb, 0.0, 1.0), 20.0) / 4.0 + 0.05;',
'        }',
'      }',
'    }',
'    if (valid < 0.5) {',
'      pos = vec3(0.0, 0.0, -90.0);',
'      vAlpha = 0.0;',
'    } else {',
'      float pz = max(rp.z, 1.0);',
'      float psc = ROSE_SIZE / pz;',
'      float pxs = rp.x * psc + 320.0;',
'      float pys = rp.y * psc + 240.0;',
'      if (cc <= 37.0) {',
'        pxs = ROSE_LEAF_CENTER.x + (pxs - ROSE_LEAF_CENTER.x) * ROSE_CROWN_SCALE;',
'        pys = ROSE_LEAF_CENTER.y + (pys - ROSE_LEAF_CENTER.y) * ROSE_CROWN_SCALE;',
'      }',
'      float inFrame = step(0.0, pxs) * step(pxs, ROSE_SCREEN_W) * step(0.0, pys) * step(pys, ROSE_SCREEN_H);',
'      if (inFrame < 0.5) {',
'        pos = vec3(0.0, 0.0, -90.0);',
'        vAlpha = 0.0;',
'      } else {',
'        pos = vec3(',
'          (pxs - 320.0) / ROSE_SCREEN_H * ROSE_WORLD_H,',
'          (240.0 - pys) / ROSE_SCREEN_H * ROSE_WORLD_H,',
'          (pz - 888.0) * ROSE_DEPTH_SCALE',
'        );',
'        pos *= 1.0 + uBeat * 0.03;',
'        float dist01 = clamp(length(vec2(pxs - ROSE_LEAF_CENTER.x, pys - ROSE_LEAF_CENTER.y)) / ROSE_DIST_NORM, 0.0, 1.0);',
'        float bloomIn = clamp((appear * 1.25 - dist01) * 5.0, 0.0, 1.0);',
'        float rc = mod(255.0 - sign(rC * ROSE_H) * floor(abs(rC * ROSE_H)), 256.0) / 255.0;',
'        float gc = mod(255.0 - sign(gC * ROSE_H) * floor(abs(gC * ROSE_H)), 256.0) / 255.0;',
'        float bc = mod(255.0 - sign(rC * rC * -80.0) * floor(abs(rC * rC * -80.0)), 256.0) / 255.0;',
'        vColor = vec3(rc, gc, bc);',
'        vAlpha = bloomIn * (0.85 + 0.15 * appear) * (1.0 + uBass * 0.10) * edgeFade;',
'        maxRippleAmp = max(maxRippleAmp, uBass * 0.05 + uMid * 0.03);',
'      }',
'    }',
'  }',
'  else if (uEff < 13.5) {',
'    float appearRaw = clamp(uGalaxyAge / HEART_APPEAR, 0.0, 1.0);',
'    float appear = 1.0 - pow(1.0 - appearRaw, 3.0);',
'    float hphase = mod(uGalaxyAge, 1.5) / 1.5;',
'    float thump = sin(clamp(hphase / 0.16, 0.0, 1.0) * 3.14159) * 0.62',
'                + sin(clamp((hphase - 0.30) / 0.20, 0.0, 1.0) * 3.14159) * 0.38;',
'    float beatScale = 1.0 + thump * 0.05 + uBeat * 0.055;',
'    float bucket = hash11(aRand * 41.3);',
'    bool isStar = bucket < HEART_STAR_SHARE;',
'    bool isDust = !isStar && bucket < HEART_STAR_SHARE + HEART_DUST_SHARE;',
'    if (isStar) {',
'      float sr1 = hash11(aRand * 13.7);',
'      float sr2 = hash11(aRand * 29.1);',
'      float zc = fract(hash11(aRand * 47.9) + uGalaxyAge * 0.045);',
'      pos = vec3((sr1 * 2.0 - 1.0) * 5.6, (sr2 * 2.0 - 1.0) * 3.2, -6.5 + zc * 5.5);',
'      float twinkle = 0.55 + 0.45 * sin(uGalaxyAge * (1.2 + sr1 * 2.4) + sr2 * 6.28);',
'      vec3 sc1 = vec3(0.30, 0.90, 1.00);',
'      vec3 sc2 = vec3(0.62, 0.45, 1.00);',
'      vColor = mix(mix(sc1, vec3(0.92, 0.96, 1.00), sr1), sc2, step(0.75, sr2));',
'      vPack1.w = 0.55 + 0.35 * zc;',
'      vAlpha = appear * twinkle * (0.45 + 0.45 * zc) * (1.0 + uBass * 0.10);',
'      maxRippleAmp = max(maxRippleAmp, uBass * 0.04);',
'    } else if (isDust) {',
'      float dt1 = (hash11(aRand * 7.7) * 2.0 - 1.0) * 3.14159;',
'      float dst = sin(dt1);',
'      float dx = 160.0 * dst * dst * dst;',
'      float dy = 130.0 * cos(dt1) - 50.0 * cos(2.0 * dt1) - 20.0 * cos(3.0 * dt1) - 10.0 * cos(4.0 * dt1) + 25.0;',
'      float s = 0.12 + 0.66 * hash11(aRand * 61.1);',
'      vec2 dpos = vec2(dx, dy) * s',
'                + vec2(hash11(aRand * 23.7) - 0.5, hash11(aRand * 31.9) - 0.5) * 13.0;',
'      pos = vec3(dpos * HEART_SCALE * beatScale, 0.0);',
'      vColor = mix(vec3(0.95, 0.42, 0.60), vec3(0.66, 0.42, 0.98), step(0.5, hash11(aRand * 53.7)));',
'      float tw = 0.5 + 0.5 * sin(uGalaxyAge * (0.9 + hash11(aRand * 13.7) * 1.8) + hash11(aRand * 29.1) * 6.28);',
'      vPack1.w = 0.40;',
'      vAlpha = appear * tw * (0.14 + 0.10 * thump) * (1.0 + uBass * 0.10);',
'      maxRippleAmp = max(maxRippleAmp, uBass * 0.03);',
'    } else {',
'      float ht = (hash11(aRand * 7.7) * 2.0 - 1.0) * 3.14159;',
'      float st = sin(ht);',
'      float hx = 160.0 * st * st * st;',
'      float hy = 130.0 * cos(ht) - 50.0 * cos(2.0 * ht) - 20.0 * cos(3.0 * ht) - 10.0 * cos(4.0 * ht) + 25.0;',
'      float life = fract(uGalaxyAge / HEART_LIFE + hash11(aRand * 19.3));',
'      float tau = life * HEART_LIFE;',
'      float hr = length(vec2(hx, hy));',
'      vec2 hdir = hr > 0.001 ? vec2(hx, hy) / hr : vec2(0.0, 1.0);',
'      float travel = HEART_V0 * (tau - 0.5 * HEART_DRAG * tau * tau);',
'      vec2 hpos = (vec2(hx, hy) + hdir * travel) * HEART_SCALE * beatScale;',
'      pos = vec3(hpos, 0.0);',
'      float dist01 = clamp(length(vec2(hx, hy)) / 190.0, 0.0, 1.0);',
'      float bloomIn = clamp((appear * 1.3 - dist01) * 4.0, 0.0, 1.0);',
'      vPack1.w = 0.35 + 0.80 * (1.0 - pow(clamp(1.0 - life, 0.0, 1.0), 3.0));',
'      vColor = mix(vec3(0.98, 0.28, 0.46), vec3(1.00, 0.52, 0.72), clamp(0.5 + 0.5 * hy / 145.0, 0.0, 1.0));',
'      vAlpha = bloomIn * (1.0 - life) * (1.0 + uBass * 0.12);',
'      maxRippleAmp = max(maxRippleAmp, uBass * 0.05 + uBeat * 0.04);',
'    }',
'  }',
'  else {',
'    float rainGx = floor(aUv.x * uGrid);',
'    float rainGy = floor(aUv.y * uGrid);',
'    float rainPid = rainGy * uGrid + rainGx;',
'    float rainCell = mod(rainPid, RAIN_COLS * RAIN_ROWS);',
'    float kept = step(rainPid, RAIN_COLS * RAIN_ROWS - 0.5);',
'    float rcol = mod(rainCell, RAIN_COLS);',
'    float rrow = floor(rainCell / RAIN_COLS);',
'    float colSpeed = 0.55 + hash11(rcol * 17.1) * 0.75;',
'    float head01 = fract(hash11(rcol * 5.3) - uGalaxyAge * colSpeed * 0.38);',
'    float crow01 = (rrow + 0.5) / RAIN_ROWS;',
'    float ccol01 = (rcol + 0.5) / RAIN_COLS;',
'    float dist01 = crow01 - head01;',
'    float trail = 1.0 - clamp(dist01 / RAIN_TRAIL, 0.0, 1.0);',
'    float body = step(0.0, dist01) * (0.34 + 0.66 * pow(clamp(trail, 0.0, 1.0), 2.2)) * smoothstep(0.0, 0.05, trail);',
'    float isHead = step(0.0, dist01) * (1.0 - step(0.022, dist01));',
'    float flicker = floor(uGalaxyAge * (0.6 + hash11(rcol * 3.7) * 1.4));',
'    float bandRoll = hash11(rcol * 91.7 + rrow * 7.31 + flicker * 0.617);',
'    float band = 1.0 - crow01;',
'    float glyph;',
'    if (band < 0.321) {',
'      glyph = floor(bandRoll * 26.0);',
'    } else if (band < 0.444) {',
'      glyph = 26.0 + floor(bandRoll * 10.0);',
'    } else if (band < 0.593) {',
'      glyph = 36.0 + floor(bandRoll * 12.0);',
'    } else if (band < 0.704) {',
'      glyph = 48.0 + floor(bandRoll * 9.0);',
'    } else {',
'      glyph = 57.0 + floor(bandRoll * 24.0);',
'    }',
'    vPack1.w = clamp(glyph, 0.0, 80.0);',
'    pos = mix(',
'      vec3(0.0, 0.0, -90.0),',
'      vec3((ccol01 - 0.5) * RAIN_W, (crow01 - 0.5) * RAIN_H, 0.0),',
'      kept',
'    );',
'    vec3 green = mix(vec3(0.07, 0.80, 0.20), vec3(0.55, 1.00, 0.60), trail);',
'    vColor = mix(green, vec3(0.92, 1.00, 0.90), isHead);',
'    float md = distance(pos.xy, uMouseXY);',
'    float gold = (1.0 - smoothstep(0.6, 2.0, md)) * kept;',
'    vColor = mix(vColor, vec3(1.00, 0.85, 0.25), gold * 0.85);',
'    float appearRaw = clamp(uGalaxyAge / RAIN_APPEAR, 0.0, 1.0);',
'    float appear = 1.0 - pow(1.0 - appearRaw, 3.0);',
'    vAlpha = appear * body * (1.00 + uBass * 0.25 + uEnergy * 0.15) * (1.0 + gold * 0.8 + isHead * 0.7) * kept;',
'    maxRippleAmp = max(maxRippleAmp, uBass * 0.05 + uEnergy * 0.05);',
'  }'
  ].join('\n');

  // ---- GLSL：亮度 / 尺寸后处理（插在 vBright 赋值附近）----
  // 使用桌面 uPreset（9–17），不是 uEff。
  var GLSL_BRIGHT_PATCH = [
    '  if (uPreset > 8.5) {',
    '    vBright = 0.94 + maxRippleAmp * 0.72 + uBass * 0.055 + uEnergy * 0.055 + uBurstAmt * 0.26;',
    '    if (uPreset > 11.5 && uPreset < 12.5) {',
    '      vBright = 0.86 + maxRippleAmp * 0.42 + uBass * 0.045 + uEnergy * 0.030;',
    '    } else if (uPreset > 12.5 && uPreset < 13.5) {',
    '      vBright = 1.02 + maxRippleAmp * 0.50 + uBass * 0.040 + uEnergy * 0.035;',
    '    } else if (uPreset > 13.5 && uPreset < 14.5) {',
    '      vBright = 0.92 + maxRippleAmp * 0.60 + uBass * 0.05 + uEnergy * 0.04;',
    '    } else if (uPreset > 14.5 && uPreset < 15.5) {',
    '      vBright = 1.18 + maxRippleAmp * 0.50 + uBass * 0.06 + uEnergy * 0.04;',
    '    } else if (uPreset > 15.5 && uPreset < 16.5) {',
    '      vBright = 1.12 + maxRippleAmp * 0.50 + uBass * 0.06 + uBeat * 0.10;',
    '    } else if (uPreset > 16.5) {',
    '      vBright = 1.35 + maxRippleAmp * 0.40 + uBass * 0.06 + uEnergy * 0.05;',
    '    }',
    '  } else if (uPreset > 4.5) {'
  ].join('\n');

  var GLSL_SIZE_PATCH = [
    '  if (uPreset > 8.5 && uPreset < 9.5) {',
    '    float auroraDrive = maxRippleAmp * 0.28 + uBass * 0.10 + uMid * 0.06 + uBeat * 0.10;',
    '    sz = clamp(depthSize * 0.62 * (1.0 + auroraDrive), 0.72, 2.60);',
    '  } else if (uPreset > 12.5 && uPreset < 13.5) {',
    '    float galaxyDrive = (0.80 + galaxyTwinkle * 0.5)',
    '                      * (1.0 + uBeat * 0.6 * mix(GALAXY_CORE_PULSE, 1.0, galaxyCore));',
    '    sz = clamp(depthSize * galaxyStar * galaxyDrive * mix(GALAXY_CORE_SHRINK, 1.0, galaxyCore), 0.35, 6.00);',
    '  } else if (uPreset > 13.5 && uPreset < 14.5) {',
    '    sz = clamp(depthSize * vPack1.w * (1.0 + maxRippleAmp * 0.22), 0.40, 3.40);',
    '  } else if (uPreset > 14.5 && uPreset < 15.5) {',
    '    sz = clamp(depthSize * 0.44 * (1.0 + uBass * 0.10 + uMid * 0.06), 0.40, 1.85);',
    '  } else if (uPreset > 15.5 && uPreset < 16.5) {',
    '    sz = clamp(depthSize * vPack1.w * (1.0 + uBass * 0.10 + uBeat * 0.06), 0.30, 3.20);',
    '  } else if (uPreset > 16.5) {',
    '    sz = clamp(depthSize * 3.5 * (1.0 + uBass * 0.08), 6.00, 16.00);',
    '  } else if (uPreset > 11.5) {',
    '    sz = clamp(depthSize * 0.52 * (1.0 + uTreble * 0.12), 0.62, 2.30);',
    '  } else if (uPreset > 8.5) {',
    '    float punchDrive = uBass * 0.075 + uMid * 0.050 + uTreble * 0.070 + maxRippleAmp * 0.30 + uBurstAmt * 0.120;',
    '    sz = clamp(depthSize * (1.05 + punchDrive), 1.00, 5.45);',
    '  } else if (uPreset > 4.5) {'
  ].join('\n');

  function makeGlyphAtlasTexture(THREE) {
    var GLYPHS =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' +
      '春夏秋冬风雨雷电日月星辰' +
      '♡★☆♠♣♥♦♪♫' +
      'αβγδεζηθικλμνξοπρστυφχψω';
    var cv = document.createElement('canvas');
    cv.width = cv.height = 288;
    var ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, 288, 288);
    ctx.font = '28px "Courier New", monospace';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (var i = 0; i < 81; i++) {
      var ch = GLYPHS.charAt(i);
      if (!ch) break;
      ctx.fillText(ch, (i % 9) * 32 + 16, Math.floor(i / 9) * 32 + 17);
    }
    var tex = new THREE.CanvasTexture(cv);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    return tex;
  }

  var state = {
    burstAt: 0,
    galaxyAt: 0,
    burstRequested: true,
    galaxyResetRequested: true,
    baseGrid: 0,
    activeGrid: 0,
    roseBoosted: false
  };

  function tickAges(uniforms, time) {
    if (state.burstRequested) {
      state.burstAt = time;
      state.burstRequested = false;
    }
    uniforms.uBurstAge.value = time - state.burstAt;
    if (state.galaxyResetRequested) {
      state.galaxyAt = time;
      state.galaxyResetRequested = false;
    }
    uniforms.uGalaxyAge.value = time - state.galaxyAt;
  }

  function onTrackSwitch(uniforms, time) {
    state.burstRequested = true;
    state.burstAt = time;
    if (uniforms.uBurstAge) uniforms.uBurstAge.value = 0;
  }

  function onPresetChanged(prev, next, ctx) {
    if (webFxNeedsGalaxyReset(next)) state.galaxyResetRequested = true;
    if (next === WEB_FX.BURST) state.burstRequested = true;
    if (next === WEB_FX.ROSE && !state.roseBoosted && ctx && typeof ctx.boostGrid === 'function') {
      if (ctx.boostGrid(WEB_FX.ROSE_GRID_BOOST)) state.roseBoosted = true;
    } else if (next !== WEB_FX.ROSE && state.roseBoosted && ctx && typeof ctx.boostGrid === 'function') {
      if (ctx.boostGrid(1)) state.roseBoosted = false;
    }
    if (ctx && ctx.material) {
      var THREE = global.THREE;
      var want = webFxNeedsAdditive(next)
        ? (THREE ? THREE.AdditiveBlending : 2)
        : (THREE ? THREE.NormalBlending : 1);
      if (ctx.material.blending !== want) {
        ctx.material.blending = want;
        ctx.material.needsUpdate = true;
      }
    }
  }

  // 音频重映射（对齐 Web ParticleStage preset>5.5 段）
  function remapAudio(preset, smoothBass, smoothMid, smoothTreb, intensity) {
    if (preset < 9) return null;
    var webIdx = preset - 3;
    var bass = Math.pow(Math.max(0, Math.min(1, (smoothBass - 0.05) / 0.55)), 0.80) * intensity;
    var mid = Math.pow(Math.max(0, Math.min(1, (smoothMid - 0.04) / 0.45)), 0.82) * intensity;
    var treble = Math.pow(Math.max(0, Math.min(1, (smoothTreb - 0.02) / 0.30)), 0.78) * intensity;
    if (webIdx < 6.5) mid = Math.min(0.9, mid * 1.15);
    else if (webIdx < 7.5) treble = Math.min(0.85, treble * 1.12);
    else if (webIdx > 8.5 && webIdx < 9.5) {
      bass = Math.min(1.0, bass * 1.32);
      treble = Math.min(0.72, treble * 0.82);
    } else if (webIdx > 9.5 && webIdx < 10.5) {
      mid = Math.min(1.0, mid * 1.26);
      bass = Math.min(0.62, bass * 0.84);
    } else if (webIdx > 10.5) {
      mid = Math.min(0.95, mid * 1.10);
      bass = Math.min(0.60, bass * 0.88);
    }
    return { bass: bass, mid: mid, treble: treble };
  }

  global.WebFxPresets = {
    ID: WEB_FX,
    PRESET_META: PRESET_META,
    PRESET_ICONS: PRESET_ICONS,
    PRESET_CAMERA: PRESET_CAMERA,
    GLSL_CONSTANTS: GLSL_CONSTANTS,
    GLSL_BRANCHES: GLSL_BRANCHES,
    GLSL_BRIGHT_PATCH: GLSL_BRIGHT_PATCH,
    GLSL_SIZE_PATCH: GLSL_SIZE_PATCH,
    makeGlyphAtlasTexture: makeGlyphAtlasTexture,
    state: state,
    tickAges: tickAges,
    onTrackSwitch: onTrackSwitch,
    onPresetChanged: onPresetChanged,
    remapAudio: remapAudio,
    isWebFxPreset: webFxIsNewPreset,
    needsAdditive: webFxNeedsAdditive
  };
})(typeof window !== 'undefined' ? window : globalThis);
