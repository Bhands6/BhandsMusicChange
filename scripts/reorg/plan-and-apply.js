'use strict';
/**
 * 「按职责重排」落地器（一次性迁移工具，2026-09-24 第二步）。
 *
 * 把 `public/js/app/*.js` 从「按写入时间切的 17 个文件」重排成「按职责分的 18 个文件」。
 *
 * ── 两条硬约束 ────────────────────────────────────────────────────────
 * 1. **顶层 `function` 声明位置无关**（提升），跨文件搬是零语义改动 —— 但拆成多个
 *    `<script>` 后提升只在各自文件内生效，所以搬完必须跑 `scripts/check-app-hoisting.js`。
 * 2. **顶层 `var/let/const` 与顶层语句不能随便搬**：`var` 只提升绑定不提升初始化，
 *    `let/const` 有 TDZ。搬它们会改变「某个读取点看到的是 undefined 还是真值」。
 *    本脚本只负责**产出计划**，安全性由 `scripts/check-app-reorg.js` 判定。
 *
 * ── 切块方式 ──────────────────────────────────────────────────────────
 * 按 AST 顶层节点的**字符 range** 切「块」：第 i 块 = 上一块结束处 .. 本节点 range 末尾。
 * 这样**注释与空行会跟着它后面的那个声明走**，整份文件被无损地切成若干块（含尾部残余块）。
 * 拼回去时直接字符串相接（不加分隔符）—— 每块自带的换行就是原来的换行。
 *
 * ⚠️ 不能用「按行切」：源文件里存在**同一行有两个顶层语句**的情况
 *    （`03-particles.js:91` 的 `rippleTex.magFilter = …; rippleTex.minFilter = …;`），
 *    按行切会让第二个语句切出空块并多插一个换行 —— 实测就是这么发现 +5 字符偏差的。
 *
 * 用法：
 *   node scripts/reorg/plan-and-apply.js            # dry-run：只写 scripts/out/reorg-plan.json
 *   node scripts/reorg/plan-and-apply.js --apply    # 真正落盘
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const REPO = path.resolve(__dirname, '..', '..');
const APP_DIR = path.join(REPO, 'public', 'js', 'app');
const OUT_DIR = path.join(REPO, 'scripts', 'out');

let esprima;
try {
  esprima = require('esprima');
} catch (e) {
  throw new Error('需要 esprima：npm install --save-dev esprima');
}
const { makeParser, refsOf, calledRefsOf, hasSideEffect, declaredNames } = require(path.join(REPO, 'scripts', 'lib', 'ast-scan'));
const parse = makeParser(esprima);

/* ==================================================================== */
/*  目标结构                                                             */
/* ==================================================================== */

const PRELUDE = '00-prelude.js';

const TARGETS = [
  ['01-state.js', '全局状态 / 常量表 / store key / 热键表 / 预设'],
  ['02-scene.js', 'three.js 场景 / 相机系统 / 指针拖拽 / 粒子点纹理'],
  ['03-particles.js', '粒子系统：主粒子 / 背景星河 / 浮空层 / 安魂层 / 封面背面层 / 涟漪'],
  ['04-lyrics.js', '歌词：解析 / 自定义歌词 / 面板 / 显示模式 / 动画 / 校准 / 时间偏移'],
  ['05-lyrics-stage.js', '歌词舞台渲染：three.js mesh / 纹理 / 字体 / mask / glow / 调色'],
  ['06-cover.js', '封面：加载 / 裁剪弹窗 / 边缘与深度 / AI 深度 / 画布'],
  ['07-beat.js', '节拍分析：离线预解析 / podcast DJ / 本地节拍'],
  ['08-shelf.js', '3D 歌单架：双模式 / 二级内容框 / PSP 卡片交互 / 控件'],
  ['09-api-search.js', 'API 助手（网易云 / QQ 请求封装）/ 搜索 / 首页发现'],
  ['10-audio-queue.js', '音频上下文 / 频谱分析 / 播放队列'],
  ['11-playlist.js', '播放列表面板 / 拖放 / 本地音乐导入 / 播放进度'],
  ['12-fx-console.js', '控制台：面板机制 / 预设卡片 / 主滑块 / 开关 / 调色台 / 歌词控件 / 自定义背景'],
  ['13-system-panels.js', '输出设备 / 本地缓存 / 内存管家 / 第三方音源设置 / 系统设置'],
  ['14-account.js', '登录 / 会员：网易云 / QQ / 酷狗扫码 / 账号胶囊'],
  ['15-update.js', '更新提示预览 / 下载 / 补丁'],
  ['16-idle-toast-libs.js', '空场待机引导 / 视觉引导 / 手势 / toast / 动态库加载'],
  ['17-shell.js', '外壳：Resize / 快捷键 / UI 半隐藏 / splash / 加载过渡 / 沉浸模式 / 桌面 overlay'],
  ['18-session-boot.js', '会话持久化 / 启动自动播放 / 酷狗扫码 / 恢复态预解析 / 启动序列 / 主循环'],
];
const TARGET_ORDER = TARGETS.map((t) => t[0]);

const T = {
  STATE: '01-state.js',
  SCENE: '02-scene.js',
  PART: '03-particles.js',
  LYR: '04-lyrics.js',
  LYRS: '05-lyrics-stage.js',
  COVER: '06-cover.js',
  BEAT: '07-beat.js',
  SHELF: '08-shelf.js',
  API: '09-api-search.js',
  AUDIO: '10-audio-queue.js',
  PL: '11-playlist.js',
  FX: '12-fx-console.js',
  SYS: '13-system-panels.js',
  ACC: '14-account.js',
  UPD: '15-update.js',
  IDLE: '16-idle-toast-libs.js',
  SHELL: '17-shell.js',
  BOOT: '18-session-boot.js',
};

/* ==================================================================== */
/*  分类规则                                                             */
/* ==================================================================== */

const set = (a) => new Set(a);

/* --- 歌单架（散在 02 / 04 / 12 / 14） --- */
const SHELF_FNS = set([
  // 02-scene-camera：相机与控件抑制策略
  'shouldUseWallpaperSafeShelfCamera', 'shouldUseSkullSafeShelfCamera', 'shouldDimWallpaperForShelf',
  'shouldOffsetLyricsForShelfDetail', 'shouldAvoidStageLyricsForShelf',
  'isBottomControlsSuppressedForShelf', 'suppressBottomControlsForShelf',
  // 04-stage-lyrics：歌单架相机基准与强调色
  'applyShelfCameraDefaultAngle', 'normalizedShelfNumber', 'shelfSettings', 'shelfAlwaysVisible',
  'shouldUseShelfDynamicCamera', 'shelfAccentHex', 'shelfAccentRgba',
  // 12-system-panels：歌单架控件
  'setShelfMode', 'updateShelfControlUi', 'refreshShelfVisuals', 'setShelfCameraMode',
  'setShelfPresence', 'setShelfAccentColor', 'resetShelfAccentColor',
]);

/* --- 调色台 colorLab + 自定义背景（散在 04）→ 控制台 --- */
const FX_FNS = set([
  // 04-stage-lyrics：调色台
  'rgbToHsl', 'hslToRgb', 'rgbCss', 'hexToRgb', 'rgbToHsv', 'hsvToHex',
  'applyColorLabValue', 'syncColorLabUi', 'closeColorLab', 'placeFxFloatingPanel',
  'openColorLabForPicker', 'updateColorLabFromSv', 'bindColorLabPicker',
  'liftFxFloatingPopups', 'bindColorLabRows', 'repositionFxFloatingPanels',
  // 04-stage-lyrics：自定义背景
  'customBackgroundMediaLabel', 'openCustomBackgroundDb', 'putCustomBackgroundBlob', 'getCustomBackgroundBlob',
  // 12-system-panels：控制台面板机制
  'updateFxInputs', 'animateFxResetButton', 'resetFxSliderValue', 'ensureFxSliderResetButton',
  'setFxPanelTab', 'fxPanelInputId', 'fxPanelTargetForNode', 'organizeFxPanel', 'fxControlBlock',
  'setFxSectionBefore', 'setFxSliderLabel', 'setFxSectionBeforeNode', 'moveToggleToGrid',
  'ensureLyricPrimaryControls', 'applyBackgroundMediaHint', 'relabelFxPanelControls',
  'bindFxPanel', 'toggleFx', 'toggleFxPanel', 'resetFx',
]);
const FX_VARS = set([
  'colorLabState', 'COLOR_LAB_PRESETS',
  'CUSTOM_BG_DB_NAME', 'CUSTOM_BG_STORE', 'customBgObjectUrl', 'customBgApplyToken',
  'fxPanelTab', 'fxPanelTabScroll',
]);

/* --- 封面（散在 01 / 03 / 04 / 05 / 06 / 07 / 08 / 11） --- */
const COVER_FNS = set([
  // 04-stage-lyrics
  'coverParticleCountLabel', 'coverTextureSizeForResolution',
  // 05-lyric-modes-cover：深度 / 边缘 / AI 深度 / 画布
  'coverDepthCacheId', 'getCoverDepthCache', 'setCoverDepthCache', 'buildEdgeAndDepth',
  'ensureAIDepthPipeline', 'makeAIDepthInputCanvas', 'estimateAIDepth', 'mergeAIDepthIntoEdgeTexture',
  'queueAIDepthForCover', 'queueAIDepthForCurrentCover', 'setCoverDepthState', 'coverApplyStillCurrent',
  'setControlCoverSrc', 'updateControlTrackInfo', 'applyCoverCanvas',
  // 06-beat：封面裁剪弹窗（原 main.js §18 里混进来的）
  'showAIDepthChip', 'hideAIDepthChip', 'loadCoverFromUrl', 'setAlbumBackground',
  'makeSquareCoverCanvas', 'coverCanvasToDataUrl', 'applyCoverDataUrl', 'commitCustomCoverCanvas',
  'loadCoverFromFile', 'bindCoverCropModal', 'openCoverCropModal', 'initCoverCropGeometry',
  'clampCoverCropPan', 'updateCoverCropTransform', 'currentCoverCropRect', 'drawCoverCropPreview',
  'pulseCoverCropStage', 'closeCoverCropModal', 'commitCoverCrop',
  // 08-api-search：封面 URL 与自定义封面存储
  'saveCustomCoverMap', 'isInlineCoverSrc', 'isProxyableCoverUrl', 'coverProxySrc', 'coverUrlWithSize',
  'songCustomCoverKey', 'getCustomCoverForSong', 'hydrateCustomCover', 'songCoverSrc', 'homeTileCover',
  'setCustomCoverForCurrent', 'updateCustomCoverButton', 'clearCustomCoverForCurrent',
  'searchLooksLikeSameTitleCover',
]);
const COVER_VARS = set(['coverDepthTween']);

/* --- 歌词（散在 04 / 05 / 08 / 10） --- */
const LYR_FNS = set([
  // 08-api-search：自定义歌词
  'saveCustomLyricMap', 'saveCustomLyricPrefs', 'songCustomLyricKey', 'currentLyricSong',
  'getCustomLyricEntry', 'hasCustomLyricForSong', 'cloneLyricLine', 'cloneLyricLines',
  'setOriginalLyricsState', 'applyLyricsState', 'applyOriginalLyricsState', 'parseCustomLyricText',
  'applyCustomLyricState', 'preferredLyricSourceForSong', 'applyPreferredLyricsForCurrent',
  'setLyricSourceMode', 'updateCustomLyricControls', 'setCustomLyricStatus', 'openCustomLyricModal',
  'closeCustomLyricModal', 'saveCustomLyricForCurrent', 'deleteCustomLyricForCurrent',
  // 10-lyrics-panel-playlist：解析 / 面板
  'fetchLyric', 'currentLyricFallbackText', 'isNoLyricText', 'withLyricFallback',
  'lyricTagTimeToSeconds', 'finalizeLyricLineDurations', 'parseLyricText', 'parseLyricTranslationLines',
  'mergeLyricTranslations', 'parseYrcText', 'renderLyrics', 'toggleLyricsPanel',
  'updateLyricsToggleButton', 'syncLyricDisplayModeSeg', 'refreshStageLyricDisplayMode',
  'setLyricDisplayMode', 'setLyricMotionStyle', 'syncLyricMotionStyleSeg', 'updateLyricsHighlight',
]);
const LYR_VARS = set([
  'LYRIC_TIMING_OFFSET_STORE_KEY', 'LYRIC_TIMING_OFFSET_LIMIT', 'lyricTimingOffsetMap',
  'lyricTimingPopoverCloseTimer', 'LYRIC_TRANSLATION_TIME_TOLERANCE',
]);

/* --- 涟漪 + 粒子 alpha 过渡（散在 05）→ 粒子 --- */
const PART_FNS = set([
  'triggerRipple', 'updateRipples',
  'tweenParticleAlpha', 'tweenFloatAlpha', 'revealIdleParticles',
]);
const PART_VARS = set([
  'rippleIdx', 'lastRippleAt', 'lastBassRising', 'BASS_THRESHOLD', 'RIPPLE_COOLDOWN', 'regions',
  'alphaTween', 'floatAlphaTween', 'IDLE_PARTICLE_ALPHA',
]);

/* --- 加载过渡 / 缓动（散在 05）→ 外壳 --- */
const SHELL_FNS = set([
  'startColorMixTween', 'visualEase', 'tweenLoading', 'showLoading', 'hideLoading',
  'forceLoadingSettled', 'recoverVisualsAfterBackground',
  // 12-system-panels：快捷键
  'saveHotkeySettings', 'hotkeyActionMeta', 'isModifierKeyCode', 'normalizeHotkeyEvent',
  'hotkeyDisplayPart', 'formatHotkey', 'hotkeyToAccelerator', 'hotkeyDuplicateMap',
  'executeHotkeyAction', 'handleConfiguredLocalHotkey', 'shouldSuppressDefaultConfiguredHotkey',
  'ensureHotkeySettingsButton', 'ensureHotkeyModal', 'hotkeyStatusMarkup', 'renderHotkeyScope',
  'renderHotkeySettings', 'setHotkeyModalScope', 'openHotkeySettings', 'closeHotkeySettings',
  'startHotkeyCapture', 'setHotkeyBinding', 'resetHotkeyBinding', 'registerGlobalHotkeys',
  'bindHotkeySettings',
  // 12-system-panels：沉浸模式 / 控件自动隐藏
  'syncControlsAutoHideButton', 'setParticleLyricsSilently', 'updateImmersiveButton',
  'closeImmersiveInterference', 'setImmersiveMode', 'toggleImmersiveMode', 'setCamMode',
]);
const SHELL_VARS = set([
  'colorMixTween', 'loadingTween', 'loadingShownAt', 'loadingHideTimer', 'globalHotkeyListenerBound',
]);

/* --- 更新（13 前半） --- */
const UPD_FNS = set([
  'formatUpdateBytes', 'formatUpdateSpeed', 'updateProgressDetailText', 'initUpdatePreview',
  'setUpdatePreviewVisible', 'checkLatestUpdate', 'applyLatestUpdateInfo', 'startUpdateIconBreathing',
  'renderUpdatePreviewPanel', 'syncUpdatePreviewStateClass', 'updateUpdatePreviewProgress',
  'openUpdatePanel', 'animateUpdatePanelContents', 'startRealUpdateDownload', 'startRealUpdatePatch',
  'pollUpdateDownloadJob', 'pollUpdatePatchJob', 'applyUpdateDownloadJob', 'restartForAppliedPatch',
  'openDownloadedUpdateInstaller', 'startUpdatePreviewDownload', 'pulseUpdateReady',
  'openGsapModal', 'closeGsapModal',
]);

/** 每个源文件「默认」的职责继任者 */
const DEFAULT_TARGET = {
  '01-state.js': T.STATE,
  '02-scene-camera.js': T.SCENE,
  '03-particles.js': T.PART,
  '04-stage-lyrics.js': T.LYRS,          // 剩余的都是舞台 3D 渲染
  '05-lyric-modes-cover.js': T.LYR,      // 剩余的都是歌词模式/动画/校准/时间偏移
  '06-beat.js': T.BEAT,                  // 封面段已在上面被摘走
  '07-shelf.js': T.SHELF,
  '08-api-search.js': T.API,             // 歌词/封面已在上面被摘走
  '09-audio-queue.js': T.AUDIO,
  '10-lyrics-panel-playlist.js': T.PL,   // 歌词已在上面被摘走
  '11-fx-console.js': T.FX,
  '12-system-panels.js': T.SYS,          // 控制台/快捷键/歌单架/沉浸已在上面被摘走
  '13-update-account.js': T.ACC,         // 更新已在上面被摘走
  '14-idle-toast-libs.js': T.IDLE,
  '15-shell.js': T.SHELL,
  '16-session-boot.js': T.BOOT,
};

/* ==================================================================== */
/*  前置检查：本脚本是**一次性**迁移工具，只在「重排前」的布局上运行        */
/* ==================================================================== */
/* ⚠️ 重排已经落盘过（a750fcc 之后的工作区），此时旧文件名一个都不在了。
 *    不拦的话，下面 classify() 会抛 `未知源文件：02-scene.js` ——
 *    看起来像脚本坏了，其实是「已经重排过、无需再跑」。
 *    这类「工具在目标状态下只会报天书」的坑，一律在入口处拦掉并说清状态。 */
{
  const missing = Object.keys(DEFAULT_TARGET).filter((f) => !fs.existsSync(path.join(APP_DIR, f)));
  if (missing.length) {
    const now = fs.readdirSync(APP_DIR).filter((n) => n.endsWith('.js')).sort();
    console.log('ℹ️  看起来已经重排过了 —— 本脚本只在「按职责重排之前」的布局上运行。');
    console.log('   缺失的旧文件 ' + missing.length + ' 个：' + missing.join(', '));
    console.log('   当前 public/js/app/ 实际是：' + now.join(' → '));
    console.log('\n   重排后的校验请改用：npm run check:reorg（加载期读写顺序等价）');
    console.log('                            npm run check:hoisting（跨 script 提升）');
    process.exit(0);
  }
}


/** 判断一个顶层条目应该落在哪个新文件 */
function classify(srcFile, item) {
  const name = item.name;
  const def = DEFAULT_TARGET[srcFile];
  if (!def) throw new Error('未知源文件：' + srcFile);

  if (item.kind === 'statement') {
    if (srcFile === '05-lyric-modes-cover.js') {
      return /bindLyricTimingOffsetControls/.test(item.text) ? T.LYR : T.PART;   // 涟漪 3×3 网格
    }
    if (srcFile === '12-system-panels.js') {
      return /addEventListener\('keydown'/.test(item.text) ? T.SHELL : T.SYS;
    }
    return def;
  }

  // 01-state.js 全量保留（中央状态文件；见 docs/APP_REORG_PLAN.md 的说明）
  if (srcFile === '01-state.js') return T.STATE;

  if (name && SHELF_FNS.has(name)) return T.SHELF;
  if (name && FX_FNS.has(name)) return T.FX;
  if (name && COVER_FNS.has(name)) return T.COVER;
  if (name && LYR_FNS.has(name)) return T.LYR;
  if (name && PART_FNS.has(name)) return T.PART;
  if (name && SHELL_FNS.has(name)) return T.SHELL;
  if (name && UPD_FNS.has(name)) return T.UPD;
  if (name && FX_VARS.has(name)) return T.FX;
  if (name && COVER_VARS.has(name)) return T.COVER;
  if (name && LYR_VARS.has(name)) return T.LYR;
  if (name && PART_VARS.has(name)) return T.PART;
  if (name && SHELL_VARS.has(name)) return T.SHELL;

  return def;
}

/* ==================================================================== */
/*  主流程                                                               */
/* ==================================================================== */

const APPLY = process.argv.includes('--apply');

const htmlPath = path.join(REPO, 'public', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const srcFiles = [...html.matchAll(/<script\s+src="js\/app\/([^"]+)"><\/script>/g)].map((m) => m[1]);
if (!srcFiles.length) throw new Error('index.html 里没找到 js/app/*.js');
if (srcFiles[0] !== PRELUDE) throw new Error('第一个 js/app 脚本不是 ' + PRELUDE);

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

/* ---------- 逐文件切块 ---------- */
const oldItems = [];      // 全局顺序的顶层条目
const blocksByTarget = new Map();   // target -> [{srcFile, srcIdx, block}]
for (const t of TARGET_ORDER) blocksByTarget.set(t, []);
const droppedStrict = [];
const strictEndByFile = new Map();   // 源文件 -> 第 1 行 'use strict'; 结束处的字符偏移

for (let si = 0; si < srcFiles.length; si++) {
  const f = srcFiles[si];
  if (f === PRELUDE) continue;                       // prelude 保持不动
  const raw = fs.readFileSync(path.join(APP_DIR, f), 'utf8');
  const lines = raw.split('\n');
  const ast = parse(raw, { loc: true, range: true });

  let prevChar = 0;
  for (let ii = 0; ii < ast.body.length; ii++) {
    const st = ast.body[ii];
    const block = raw.slice(prevChar, st.range[1]);
    const startLine = (raw.slice(0, prevChar).match(/\n/g) || []).length + 1;
    prevChar = st.range[1];

    const isStrict = st.type === 'ExpressionStatement' && st.expression.type === 'Literal' &&
      st.expression.value === 'use strict';
    if (isStrict) { droppedStrict.push(f); strictEndByFile.set(f, st.range[1]); continue; }

    const names = declaredNames(st);
    const item = {
      srcFile: f, srcIdx: si, itemIdx: ii,
      startLine, endLine: st.loc.end.line,
      type: st.type,
      kind: st.type === 'VariableDeclaration' ? st.kind
        : (st.type === 'FunctionDeclaration' ? 'function'
          : (st.type === 'ClassDeclaration' ? 'class' : 'statement')),
      name: names.length === 1 ? names[0] : null,
      names,
      hash: sha(block.replace(/\s+/g, ' ').trim()),
      node: st,
      text: block,
    };
    oldItems.push(item);

    const target = classify(f, item);
    if (!target) throw new Error('未分类：' + f + ':' + st.loc.end.line + ' (' + item.type + ' ' + (item.name || '') + ')');
    if (!blocksByTarget.has(target)) throw new Error('未知目标文件：' + target);
    blocksByTarget.get(target).push({ srcFile: f, srcIdx: si, itemIdx: ii, block, item });
  }
  // 尾部残余块（最后一个声明之后的注释/空行）跟着最后一个条目走
  const tail = raw.slice(prevChar);
  if (tail.trim()) {
    const owner = oldItems.filter((x) => x.srcFile === f).pop();
    const target = owner ? classify(f, owner) : DEFAULT_TARGET[f];
    blocksByTarget.get(target).push({ srcFile: f, srcIdx: si, itemIdx: 1e6, block: tail, item: null });
  }
}

/* ---------- 组装新文件 ---------- */
const newFiles = new Map();
for (const [name, desc] of TARGETS) {
  const blocks = blocksByTarget.get(name).slice().sort((a, b) =>
    a.srcIdx - b.srcIdx || a.itemIdx - b.itemIdx);
  const header = [
    "'use strict';",
    '',
    '// ============================================================',
    '//  ' + name + '  —  ' + desc,
    '//  由 public/js/app/*.js 于 2026-09-24「按职责重排」生成（零逻辑改动）。',
    '//  规则与验证见 docs/APP_REORG_PLAN.md 与 scripts/check-app-reorg.js。',
    '// ============================================================',
  ].join('\n');
  newFiles.set(name, header + '\n\n' + blocks.map((b) => b.block).join('').replace(/\n+$/, '') + '\n');
}

/* ---------- 校验：无损切分 ---------- */
const oldLineTotal = srcFiles.filter((f) => f !== PRELUDE)
  .reduce((a, f) => a + fs.readFileSync(path.join(APP_DIR, f), 'utf8').split('\n').length, 0);
const newLineTotal = [...newFiles.values()].reduce((a, s) => a + s.split('\n').length, 0);
// 断言 1：每个源文件「去掉第 1 行 'use strict'; 后」的全文，必须等于它所有块（含尾部残余块）
//         按原序**字符串相接**。这证明切块是无损的（不丢字符、不重复、不改内容）。
const allBlocks = [...blocksByTarget.values()].flat();
const losslessFails = [];
for (const f of srcFiles) {
  if (f === PRELUDE) continue;
  const raw = fs.readFileSync(path.join(APP_DIR, f), 'utf8');
  const trimEnd = (s) => s.replace(/\s+$/, '');
  const expect = trimEnd(raw.slice(strictEndByFile.get(f)));
  const got = trimEnd(allBlocks.filter((b) => b.srcFile === f)
    .sort((a, b) => a.itemIdx - b.itemIdx)
    .map((b) => b.block)
    .join(''));
  if (got !== expect) {
    losslessFails.push(f + '：重构不一致（期望 ' + expect.length + ' 字符，实际 ' + got.length + '）');
  }
}
// 断言 2：新布局里每个条目的 hash 多重集，必须与原布局完全一致（不丢条目、不重复）。
const hashCount = (arr) => arr.reduce((m, h) => (m[h] = (m[h] || 0) + 1, m), {});
const oldHashes = hashCount(oldItems.map((x) => x.hash));
const newHashes = hashCount([...blocksByTarget.values()].flat().filter((b) => b.item).map((b) => b.item.hash));
const hashFails = [];
for (const h of new Set([...Object.keys(oldHashes), ...Object.keys(newHashes)])) {
  if ((oldHashes[h] || 0) !== (newHashes[h] || 0)) {
    hashFails.push(h + '：旧 ' + (oldHashes[h] || 0) + ' 新 ' + (newHashes[h] || 0));
  }
}

/* ---------- 计划产物 ---------- */
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(__dirname, { recursive: true });
const plan = {
  generatedFrom: srcFiles,
  targets: TARGET_ORDER,
  items: oldItems.map((it) => ({
    srcFile: it.srcFile, srcIdx: it.srcIdx, itemIdx: it.itemIdx,
    startLine: it.startLine, endLine: it.endLine,
    type: it.type, kind: it.kind, names: it.names, hash: it.hash,
    target: classify(it.srcFile, it),
  })),
  stats: {
    oldFiles: srcFiles.length, newFiles: TARGETS.length,
    oldLineTotal, newLineTotal, droppedStrict: droppedStrict.length,
    oldItems: oldItems.length,
    losslessFails, hashFails,
  },
  fileSizes: TARGETS.map(([n]) => [n, newFiles.get(n).split('\n').length]),
};
// ⚠️ 计划产物（几百 KB）写进 scripts/out/（被 .gitignore 忽略），**不要**写进 scripts/reorg/ ——
//    那里只放需要入库的东西（load-order-baseline.json）。plan.json 是每次 dry-run 都会重算的中间产物。
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'reorg-plan.json'), JSON.stringify(plan, null, 2));

console.log('=== 重排计划 ===');
console.log('旧文件 ' + srcFiles.length + ' 个（' + oldLineTotal + ' 行）→ 新文件 ' + TARGETS.length + ' 个（' + newLineTotal + ' 行）');
console.log('无损切分：' + (losslessFails.length ? '❌ ' + losslessFails.join(' / ') : '✅ ' + srcFiles.length + ' 个源文件按块重构逐字符一致'));
console.log('条目守恒：' + (hashFails.length ? '❌ ' + hashFails.join(' / ') : '✅ ' + oldItems.length + ' 个顶层条目一一对应（无丢失/重复）'));
console.log('');
for (const [n, l] of plan.fileSizes) console.log('  ' + n.padEnd(24) + String(l).padStart(6) + ' 行');
console.log('');
console.log('跨文件搬移的顶层条目：');
const moved = plan.items.filter((it) => it.target !== DEFAULT_TARGET[it.srcFile]);
console.log('  共 ' + moved.length + ' 个');
const byPair = {};
for (const it of moved) {
  const k = it.srcFile + ' → ' + it.target;
  (byPair[k] = byPair[k] || []).push(it);
}
for (const k of Object.keys(byPair).sort()) {
  const arr = byPair[k];
  const fns = arr.filter((x) => x.kind === 'function').length;
  const vars = arr.filter((x) => x.kind === 'var' || x.kind === 'let' || x.kind === 'const').length;
  const stmts = arr.filter((x) => x.kind === 'statement').length;
  console.log('  ' + k.padEnd(42) + ' fn=' + fns + ' var=' + vars + ' stmt=' + stmts);
}

if (!APPLY) {
  console.log('\n（dry-run，未落盘。计划已写 scripts/out/reorg-plan.json）');
  process.exit(0);
}

/* ---------- 落盘 ---------- */
const backupDir = path.join(OUT_DIR, 'reorg-backup');
fs.mkdirSync(backupDir, { recursive: true });
for (const f of srcFiles) {
  if (f === PRELUDE) continue;
  fs.copyFileSync(path.join(APP_DIR, f), path.join(backupDir, f));
}
for (const [name, content] of newFiles) {
  fs.writeFileSync(path.join(APP_DIR, name), content);
}
for (const f of srcFiles) {
  if (f === PRELUDE || newFiles.has(f)) continue;
  fs.unlinkSync(path.join(APP_DIR, f));
}

/* ---------- 更新 index.html 的 script 清单 ---------- */
// ⚠️ index.html 的实际结构是：
//      [应用主体脚本 注释块]  →  [cuefield / fx-console-workspace / sonic / web-fx-presets]  →  [js/app/*]
//    中间那批非 app 脚本必须原样保留，所以只替换「注释块」和「app script 段」两段。
const newComment = [
  '<!-- ==================== 应用主体脚本 ==================== -->',
  '<!-- 原 public/js/main.js（28117 行单文件）于 2026-09-24 拆成 17 个文件，',
  '     随后按职责重排为 18 个（见 docs/APP_REORG_PLAN.md）。',
  '     **顺序即执行顺序，不可调换、不可加 defer/async/module**。',
  '     ⚠️ 00-prelude.js 必须排第一：原 main.js 是单个 script，顶层 function 声明提升到整个',
  '     文件顶部；拆成多个独立 script 后提升只在各自文件内生效 —— 被更早文件顶层语句',
  '     （含同步调用链）依赖的 46 个声明都放在 prelude 里。',
  '     判定见 scripts/check-app-hoisting.js，运行期闸门见 scripts/probe-app-load.js。',
  '     加载期读写顺序由 scripts/check-app-reorg.js 对基线校验。 -->',
];
const newScriptTags = [
  '<script src="js/app/00-prelude.js"></script>'.padEnd(78) +
    '<!-- 被更早文件顶层语句依赖的 function 声明（原靠单 script 全文件提升） -->',
];
for (const [n, desc] of TARGETS) {
  newScriptTags.push(('<script src="js/app/' + n + '"></script>').padEnd(78) + '<!-- ' + desc + ' -->');
}

const htmlLines = html.split('\n');
const commentStart = htmlLines.findIndex((l) => /应用主体脚本/.test(l));
const firstAppTag = htmlLines.findIndex((l) => /<script src="js\/app\/00-prelude\.js"><\/script>/.test(l));
const lastAppTag = htmlLines.map((l, i) => (/<script src="js\/app\//.test(l) ? i : -1)).filter((i) => i >= 0).pop();
if (commentStart < 0 || firstAppTag < 0 || lastAppTag < 0) {
  throw new Error('index.html 里定位不到「应用主体脚本」注释块或 js/app script 段');
}
let commentEnd = commentStart;
while (commentEnd < firstAppTag && !/-->/.test(htmlLines[commentEnd])) commentEnd++;
if (commentEnd >= firstAppTag) throw new Error('index.html 的「应用主体脚本」注释块没有正常闭合');

const newHtml = [
  ...htmlLines.slice(0, commentStart),        // 注释块之前
  ...newComment,                              // 新注释块
  ...htmlLines.slice(commentEnd + 1, firstAppTag),  // 中间那批非 app 脚本，原样保留
  ...newScriptTags,                           // 新的 app script 段
  ...htmlLines.slice(lastAppTag + 1),         // 之后
].join('\n');
fs.writeFileSync(htmlPath, newHtml);
console.log('✅ index.html：注释块 ' + (commentEnd - commentStart + 1) + ' 行重写；app script ' +
  (lastAppTag - firstAppTag + 1) + ' 行 → ' + newScriptTags.length + ' 行（中间 ' +
  (firstAppTag - commentEnd - 1) + ' 行非 app 脚本原样保留）');

/* ---------- 更新 prelude 的 `// ↓ 原属 X.js` 标签 ---------- */
// 标签只用于 check-app-hoisting.js 的「prelude 里有没有白搬」判定，所以改成**新文件名**即可；
// 但必须指向真实存在的文件，否则那个校验会直接抛「指向未知文件」。
// ⚠️ 改的是**标签那一行**，不是它后面紧跟的 function 声明行。
const preludePath = path.join(APP_DIR, PRELUDE);
const preludeLines = fs.readFileSync(preludePath, 'utf8').split('\n');
const TAG_RE = /^\/\/ ↓ 原属 (.+\.js)\s*$/;
let tagIdx = -1;
let tagChanges = 0;
for (let i = 0; i < preludeLines.length; i++) {
  const m = TAG_RE.exec(preludeLines[i]);
  if (m) { tagIdx = i; continue; }
  if (tagIdx < 0) continue;
  const fm = /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/.exec(preludeLines[i]);
  if (!fm) continue;                                  // 标签与函数之间还有注释/空行，继续找
  const oldFile = TAG_RE.exec(preludeLines[tagIdx])[1];
  const target = classify(oldFile, { kind: 'function', name: fm[1], text: '', names: [fm[1]] });
  if (!TARGET_ORDER.includes(target)) throw new Error('prelude 标签映射到未知文件：' + oldFile + ' → ' + target);
  if (target !== oldFile) { preludeLines[tagIdx] = '// ↓ 原属 ' + target; tagChanges++; }
  tagIdx = -1;
}
fs.writeFileSync(preludePath, preludeLines.join('\n'));
console.log('✅ 00-prelude.js：重写 ' + tagChanges + ' 条 `// ↓ 原属` 标签为新文件名');
console.log('\n✅ 落盘完成（旧文件备份在 scripts/out/reorg-backup/）');
console.log('   接下来：node scripts/check-app-hoisting.js && node scripts/check-app-reorg.js && npm test');

