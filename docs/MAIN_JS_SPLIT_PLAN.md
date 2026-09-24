# main.js 拆分方案（**已执行 + 已修回归** · 2026-09-24）

> 生成于 2026-09-23，基线提交 `784afe6`。**本方案已于 2026-09-24 按"推荐项"全部执行完毕。**
> 相关文档：`docs/PROJECT_AUDIT_2026-09-21.md`（历史审计）、项目记忆 `topics/upstream-mineradio.md`（上游对照）。
>
> ⚠️ **第一次拆完是坏的，而且当时的验收全绿。** 下面第 1 节是**被推翻的**验收记录，
> 第 2 节是真实的回归、根因与修法。留档的原因：这个坑的形态（验收假绿）比坑本身更值钱。

## 一、第一次拆分（`d84ee11`）的验收记录 —— **已被推翻**

拍板走的是全部推荐项：`public/js/app/01-state.js` … `16-session-boot.js` / 不保留 `main.js` 兼容入口 /
一次切完 / 不做按职责重排。

| 闸门 | 当时的结果 | 事后结论 |
|---|---|---|
| 16 个区间首尾相接 | ✅ 覆盖 28115 行 + 原文件头 2 行 = 28117 | 成立 |
| **拼接回验**（16 文件剥掉注入头按序拼回 == 原 `main.js`） | ✅ 逐字节一致（1243520 字符） | 成立（但只证明「文本没丢」，**证明不了运行期等价**） |
| `node --check` × 16 | ✅ 16/16 | 成立（语法对 ≠ 能跑） |
| 每个文件自带 `'use strict';` | ✅ 16/16 | 成立 |
| `npm test` | ✅ 87/87 | 成立 |
| `npm run probe:ui`（6 个离屏探针） | ✅ 6/6，`errors` 全空 | ❌ **假绿**，见第 2 节 |
| `npm run probe:static` | ✅ 32/32 | 成立 |
| `probe:cuefield-api` / `cuefield-e2e` / `parse` | ✅ 全绿 | 成立 |
| 变异验证 | ✅ 打乱 index.html 顺序 / 删 `'use strict'` → 均红 | 成立，但**没覆盖真正会炸的那一类** |

**结论：这份验收清单缺一条「应用到底能不能正常启动」的闸门。** 它把「文件内容正确」当成了
「应用正确」，于是漏掉了本轮唯一的真实语义差异。

**落地时发现的两处与本文原稿不符的地方**（已按实际调整）：

1. 「48 个分区横幅」里**只有 16 条是真正的切点**（= 16 个目标文件的首行），其余 32 条只是文档表格里的
   分区标记，落在文件内部。而且 §7(3332) 是 `// ----- 顶点 Shader -----` 子标题、§33(22402) 用块注释起手、
   §13/§14/§15 是 `// ==== 标题 ====` 单行样式 —— 都不是「分隔线 + 两空格标题」。所以脚本的校验规则
   改成「16 个切点是注释行」+ 靠 `node --check` 兜底结构安全。
2. 原文件头不是「两行横幅」，是 `'use strict';` + 一个空行。

---

## 二、回归、根因、修法（2026-09-24，`d84ee11` 之后）

### 现象

拆分提交后启动应用：**黑屏 + 鼠标不显示**。

### 根因：跨 script 函数提升边界

原 `main.js` 是**单个 `<script>`**。单个 script 里顶层 `function` 声明会被提升到**整个 script 顶部**，
所以第 85 行的顶层语句可以调用第 2 万行才定义的函数 —— 老代码大量依赖这一点。

切成 16 个独立 `<script>` 后，**提升只在各自文件内生效**：前面的文件看不到后面文件里的函数声明。

而且失败形态比单个报错更糟：**一个顶层语句抛 `ReferenceError`，该 script 剩余的顶层语句全部不执行**
（函数因为提升仍可调用，但所有 `var` 赋值都丢了）→ 连带产生一串「Cannot read properties of undefined」，
把真实原因埋掉。实测 10 条错误里只有 3 条是「真错误」，其余 7 条是连带症状。

离屏实测（`01-state.js` 是第 2 个文件）：

```
01-state.js:85   Uncaught ReferenceError: readCustomCoverMap is not defined
01-state.js:874  Uncaught ReferenceError: normalizePerformanceBackgroundMode is not defined
                 at currentPerformanceBackgroundMode (01-state.js:874)
                 at isLiveBackgroundKeepMode (01-state.js:877)
                 at isDeepBackgroundMode (01-state.js:870)
                 at getRenderPixelRatio (02-scene-camera.js:37)
                 at 02-scene-camera.js:99          ← ★ 02 死在这里，指针/拖拽系统没绑定 → 鼠标不显示
03-particles.js:16    ReferenceError: coverParticleGridForResolution is not defined
11-fx-console.js:81   TypeError: Cannot read properties of undefined (reading 'intensity')   ← 连带
12-system-panels.js:976 TypeError: Cannot read properties of undefined (reading 'local')     ← 连带
bodyClass = "splash-active simple-mode"             ← 启动流程没走完
```

### 为什么当时 6 个探针全绿（假绿的机制）

现有探针都是在 `win.loadFile()` **完成之后**才 `executeJavaScript` 挂
`window.addEventListener('error')` —— 那时加载期错误早就报完了，所以 `errors: []` 什么都看不到。

**修法：用 `webPreferences.preload` 在主文档脚本之前挂监听。** 见
`scripts/probe-app-load-preload.js` + `scripts/probe-app-load.js`，已加进 `probe:ui` 并排第一位。

### 修法：`public/js/app/00-prelude.js`（提升垫片文件）

`function` 声明**位置无关**（提升），所以把「被更早文件的顶层语句（含其同步调用链）依赖」的
function 声明搬进最先加载的 `00-prelude.js`，是**零语义改动**（可见范围只增不减）。

顶层 `var` 不能这么搬（搬了会把原单 script 下的 `undefined` 变成真值，属于行为改动），
改为在 prelude 末尾加**裸 `var NAME;`** —— 精确复刻原提升语义：

```js
var MEMORY_REDUCT_MASK_DEFAULT;   // 原声明在 12-system-panels.js，但 01-state.js:807 的调用链会读它
var toastTimer;                   // 原声明在 14-idle-toast-libs.js，但 11-fx-console.js 的加载期调用链会读它
```

搬运结果：**46 个顶层 function（258 行）+ 2 条 var 垫片** → `00-prelude.js` 共 646 行。
贡献最大的两个源头：`readSavedLyricLayout()`（那个 140 行的 fx 设置大函数，拉进 16 个 `normalize*`）
和 `bindModalBackdropClose()`（关窗回调表，拉进 4 个 `close*`）。

### 判定口径（`scripts/check-app-hoisting.js`，入库）

文件按 index.html 顺序执行，记为 0..N（0 = prelude）。文件 k 执行时只有 0..k 的声明存在：

- **A 类（必搬）**：文件 k 顶层语句里出现的**任何**标识符 —— 引用本身就在那一刻求值，
  哪怕当回调传出去（`addEventListener('click', onX)`，`requestAnimationFrame(fn)` 同理），onX/fn 也必须已存在。
- **B 类（下钻）**：A 类里**处于调用位置**的函数当场执行，其函数体内一切引用同样当场求值；
  其中又处于调用位置的继续下钻。嵌套回调体不下钻（之后才跑），例外是
  `forEach/map/reduce` 这类**同步**高阶函数传入的回调。
- **必须做作用域分析**：`function updatePlayModeButton(animate) {...}` 里的 `animate` 是形参，
  不做作用域就会把局部名误判成全局顶层函数（实测会把 `animate` 主循环误搬进 prelude）。

用 esprima 做 AST。**手写词法扫描不可信** —— 试过两版，在正则字面量/模板字符串插值处会失同步，
报出 `data` / `quality` / `animate` 这类假阳性；结论以 AST 与运行期错误为准。

### 修复后的验收

| 闸门 | 结果 |
|---|---|
| `node scripts/check-app-hoisting.js` | ✅ prelude 覆盖全部 46 个前置依赖，0 漏 0 多 |
| **基线对照**（`d84ee11^` 单文件 worktree 跑同一离屏诊断） | ✅ 13 行控制台输出**完全同构**，差异仅为文件名+行号 |
| 离屏加载错误 | ✅ 与基线一致：3 条 IMG 资源错 + 1 条 Electron 内部 rejection，**0 条应用脚本错误** |
| `npm run probe:ui` | ✅ **7/7**（新增 `probe-app-load.js` 加载期零错误闸门） |
| `npm test` | ✅ **88/88**（`APP_JS_FILES` 17 个 + 新增「prelude 必须排第一」） |
| `npm run probe:static` | ✅ 全过（17 个 `js/app/*.js` 逐个 HTTP 200） |
| `probe:cuefield-api` / `cuefield-e2e` / `parse` | ✅ 全绿 |
| **独立回验**（17 文件 vs `784afe6:public/js/main.js` 的代码行多重集） | ✅ 唯一差异 = 那 2 条 var 垫片（26481 → 26482 行） |
| 变异验证 ① 把 prelude 标签挪到 `01-state.js` 之后 | ✅ 探针 FAIL 10 条 + 单测 2 条红 |
| 变异验证 ② 在 16 号文件加新函数、01 号文件顶层调用 | ✅ `check-app-hoisting` 报「漏在 prelude 外」+ 探针 FAIL 2 条 |

### 后续加代码时的规矩

1. 改了 `public/js/app/*.js` 后跑 `node scripts/check-app-hoisting.js` —— 漏了就红，并给出修法。
2. 再跑 `npm run probe:ui`（含加载期零错误闸门）。
3. **不要**用 `defer` / `async` / `type="module"` 改这 17 行 script：parser-blocking 顺序执行是硬约束。

---

## 三、原方案正文（保留，供核对切分依据）

**拆完后不再有 `public/js/main.js`**。测试侧统一用 `tests/lib/source.js` 的
`readAppSource()`（17 文件按加载顺序拼接）当「逻辑上的 main.js」。注意它**不再**逐字节等于原文件
（46 个函数位置变了），但语义等价 —— 等价性由上面两条独立回验证实。

---

## 一句话结论（原稿）

按 `main.js` **自带的 48 个分区**做**连续区间**切分，产出 **16 个文件**（1134–2923 行/个），
`index.html` 把一行 `<script src="js/main.js">` 换成 16 行、**顺序与原文件完全一致**。
**不跨区搬任何函数** —— 顶层执行顺序、`let`/`const` 的 TDZ 关系全部保持不变。

当前：`public/js/main.js` = **28117 行 / 1803 个顶层声明 / 159 条顶层可执行语句**。
拆分后最大文件 2923 行（`08-api-search.js`），**体积降到 1/10**。

> ⚠️ 原稿这句「不跨区搬任何函数」在修复回归时被打破了：46 个 function + 2 条 var 垫片
> 被搬进了 `00-prelude.js`。这是**必须**的 —— 见第 2 节。

---

## 一、为什么不照搬上游的 12 组命名

上游 2.2.0 是按**职责**分的（`00-state` / `01-scene` / `02-visual` / `03-beat` / `04-shelf` /
`05-playback` / `06-lyrics` / `07-fx` / `08-account` / `09-idle-toast` / `10-shell` / `11-main-loop`）。
我们**不能直接抄**，原因是两边代码的"生长方式"不同：

| | 上游 | 本项目 |
|---|---|---|
| 组织依据 | 按职责重组过 | 按**写入时间**顺序堆出来的，职责是散落的 |
| 歌词 | 全在 `06-lyrics` | **散在三处**：§12 舞台 3D 渲染（4925–6755）、§13–15 显示模式/动画/校准（6756–8045）、§26 歌词面板（18292–18572） |
| 节拍 | 全在 `03-beat` | §18 离线预解析（8634–11435）+ §16 附近的本地节拍弹窗 |
| 封面 | 在 `02-visual` | §17 CPU 端深度/边缘（8108–8633）+ §2 附近的贴图 |

按职责归并就**必须把函数从原位置搬到别的文件**，代价是：

1. **顶层执行顺序被打乱** —— 文件里有 159 条顶层可执行语句，其中 §47「启动」区就有 **40 条 init 调用**（`applyDiyMode` → `bindFxPanel` → … → `animate()`）。搬动会改这些调用的相对顺序。
2. **`let`/`const` 的 TDZ 关系被破坏** —— 顶层 `const A = 1` 在文件 1、被文件 9 的顶层语句读取，今天就已经是 TDZ 报错；搬到一起可能"碰巧修好"，也可能反过来引入新错。**这种行为变化不该混在一次结构重构里。**
3. **diff 不可评审** —— 一次提交里既有"移动"又有"改动"，review 时无法区分。

所以分两步：

- **第一步（本方案）**：纯机械切割，只解决"2.8 万行单文件"。**零搬移 = 零行为变化**，可验证。
- **第二步（以后）**：等 `tests/` + 探针能守住行为，再按职责重排。那时才是"像上游"。

---

## 二、映射表（48 分区 → 16 文件）

`main.js` 里本来就有 **48 个分区横幅**（`// =====` + 标题），本方案**只在这 48 个边界上落刀**。

| # | 目标文件 | main.js 行区间 | 行数 | 覆盖分区 | 主要内容 | 顶层语句 |
|---|---|---|---|---|---|---|
| 1 | `app/01-state.js` | 3 – 1136 | 1134 | §1 | Global State：全局状态、localStorage key、常量表、热键表 | 5 |
| 2 | `app/02-scene-camera.js` | 1137 – 3159 | 2023 | §2–§5 | Three.js 场景初始化、相机系统 v7.1、指针/拖拽控制、粒子点纹理 | 24 |
| 3 | `app/03-particles.js` | 3160 – 4924 | 1765 | §6–§11 | 主粒子 shader、背景星河、浮空粒子、安魂层、封面背面粒子 | 22 |
| 4 | `app/04-stage-lyrics.js` | 4925 – 6755 | 1831 | §12 | 舞台歌词系统 v9（Three.js 文字平面、纹理、3D 运动） | 1 |
| 5 | `app/05-lyric-modes-cover.js` | 6756 – 8633 | 1878 | §13–§17 | 歌词显示模式/动画/校准、涟漪触发、封面+边缘+深度处理 | 3 |
| 6 | `app/06-beat.js` | 8634 – 11435 | 2802 | §18 | 离线节拍预解析 v7.2、podcast DJ 节拍、本地节拍分析 | **0** |
| 7 | `app/07-shelf.js` | 11436 – 13762 | 2327 | §19–§21 | 3D 歌单架双模式、二级内容框、PSP 风格卡片交互 | 16 |
| 8 | `app/08-api-search.js` | 13763 – 16685 | 2923 | §22–§23 | API 助手（网易云/QQ 请求封装）、搜索 | 10 |
| 9 | `app/09-audio-queue.js` | 16686 – 18291 | 1606 | §24–§25 | 音频上下文 & 频谱分析、播放队列 | 1 |
| 10 | `app/10-lyrics-panel-playlist.js` | 18292 – 19526 | 1235 | §26–§28 | 歌词面板、播放列表面板、文件拖放 | 17 |
| 11 | `app/11-fx-console.js` | 19527 – 20916 | 1390 | §29 | 控制台：预设卡片 + 主滑块 + 开关 + 三态 | 4 |
| 12 | `app/12-system-panels.js` | 20917 – 22837 | 1921 | §30–§33 | 播放输出设备、本地缓存面板、内存管家、第三方音源设置 | 2 |
| 13 | `app/13-update-account.js` | 22838 – 24236 | 1399 | §34–§35 | 更新提示预览、登录系统 | **0** |
| 14 | `app/14-idle-toast-libs.js` | 24237 – 25448 | 1212 | §36–§38 | 空场待机引导、toast、动态库加载 | 2 |
| 15 | `app/15-shell.js` | 25449 – 26866 | 1418 | §39–§41 | Resize/快捷键、UI 半隐藏 v8、启动页 splash 控制 | 11 |
| 16 | `app/16-session-boot.js` | 26867 – 28117 | 1251 | §42–§48 | 会话持久化、启动自动播放、酷狗扫码、恢复态预解析、解析顺序、**启动序列**、主循环 | 40 |

合计 28115 行（文件 28117 行，差 2 行是文件头两行横幅）。

**注意第 6、13 号文件顶层语句为 0** —— 它们内部只有函数/变量声明，是**最安全的切割点**。

### 48 分区明细（供你核对归并是否合理）

| # | 行区间 | 行数 | 标题 | 归入 |
|---|---|---|---|---|
| §1 | 3 – 1136 | 1134 | Global State | 01 |
| §2 | 1137 – 1243 | 107 | Three.js 场景初始化（渲染器、相机、像素比、画质档位） | 02 |
| §3 | 1244 – 2955 | 1712 | 相机系统 v7.1 — 分离 user offset / cinema offset | 02 |
| §4 | 2956 – 3137 | 182 | 指针 / 拖拽控制 v7.1 | 02 |
| §5 | 3138 – 3159 | 22 | 粒子点纹理（干净圆点，无 glow） | 02 |
| §6 | 3160 – 3331 | 172 | 主粒子系统 | 03 |
| §7 | 3332 – 3985 | 654 | 主粒子 v7.1：律动幅度 ×2.5 / Tunnel 自旋 / 虚空预设 | 03 |
| §8 | 3986 – 4124 | 139 | 背景星河（移植自上游 `00-pointer-cover-particles.js`） | 03 |
| §9 | 4125 – 4244 | 120 | 浮空粒子层（独立 Points） | 03 |
| §10 | 4245 – 4782 | 538 | 安魂 — 3D 粒子建模层 | 03 |
| §11 | 4783 – 4924 | 142 | 封面背面粒子层 v7.2 | 03 |
| §12 | 4925 – 6755 | 1831 | 舞台歌词系统 v9 | 04 |
| §13 | 6756 – 6787 | 32 | 歌词显示模式（对齐上游五态体系） | 05 |
| §14 | 6788 – 7249 | 462 | 歌词动画（对齐上游 motion 体系） | 05 |
| §15 | 7250 – 8045 | 796 | 歌词校准（对齐上游 lyric-timing-offset） | 05 |
| §16 | 8046 – 8107 | 62 | 涟漪触发系统（3×3 九宫格 + bass 上升沿） | 05 |
| §17 | 8108 – 8633 | 526 | 封面 + 边缘 + 启发式深度处理（CPU 端） | 05 |
| §18 | 8634 – 11435 | 2802 | 离线节拍预解析 v7.2 | 06 |
| §19 | 11436 – 12609 | 1174 | 3D 歌单架 — 双模式（off / side / stage） | 07 |
| §20 | 12610 – 13479 | 870 | 二级内容框（歌单内歌曲列表） | 07 |
| §21 | 13480 – 13762 | 283 | 3D 卡片交互 - PSP 风格 | 07 |
| §22 | 13763 – 16142 | 2380 | API 助手 | 08 |
| §23 | 16143 – 16685 | 543 | 搜索 | 08 |
| §24 | 16686 – 17002 | 317 | 音频上下文 & 频谱分析 | 09 |
| §25 | 17003 – 18291 | 1289 | 播放队列 | 09 |
| §26 | 18292 – 18572 | 281 | 歌词 | 10 |
| §27 | 18573 – 19425 | 853 | 播放列表面板 | 10 |
| §28 | 19426 – 19526 | 101 | 文件拖放 | 10 |
| §29 | 19527 – 20916 | 1390 | 控制台 — 预设卡片 + 主滑块 + 开关 + 三态 | 11 |
| §30 | 20917 – 20979 | 63 | 播放输出设备（`setSinkId`） | 12 |
| §31 | 20980 – 21027 | 48 | 本地缓存面板 | 12 |
| §32 | 21028 – 22401 | 1374 | 内存管家 / Mem Reduct | 12 |
| §33 | 22402 – 22837 | 436 | 第三方音源设置 | 12 |
| §34 | 22838 – 23356 | 519 | 更新提示预览 | 13 |
| §35 | 23357 – 24236 | 880 | 登录系统 | 13 |
| §36 | 24237 – 24700 | 464 | 空场待机引导 | 14 |
| §37 | 24701 – 25056 | 356 | toast | 14 |
| §38 | 25057 – 25448 | 392 | 动态库加载 | 14 |
| §39 | 25449 – 25532 | 84 | Resize / 快捷键 | 15 |
| §40 | 25533 – 25843 | 311 | UI 半隐藏 v8 | 15 |
| §41 | 25844 – 26866 | 1023 | 启动页（splash）控制 | 15 |
| §42 | 26867 – 27075 | 209 | 上次播放会话持久化 | 16 |
| §43 | 27076 – 27173 | 98 | 启动自动播放 | 16 |
| §44 | 27174 – 27434 | 261 | 酷狗会员扫码登录 | 16 |
| §45 | 27435 – 27602 | 168 | 恢复态音源预解析 | 16 |
| §46 | 27603 – 27684 | 82 | 音源解析顺序 | 16 |
| §47 | 27685 – 27763 | 79 | **启动**（40 条 init 调用） | 16 |
| §48 | 27764 – 28117 | 354 | 主循环 | 16 |

---

## 三、拆分后 `index.html` 的加载顺序

`main.js` 现在是**最后一个** `<script>`（`index.html:1139`），前面 9 个脚本的注释明确写着
"`fx-console-workspace.js` **须在 main.js 前加载**"。16 个新文件必须**整体占住原来那一行的位置**：

```html
<!-- ……前面 13 个 script 不动…… -->
<script src="js/web-fx-presets.js"></script>
<script src="js/app/01-state.js"></script>
<script src="js/app/02-scene-camera.js"></script>
<script src="js/app/03-particles.js"></script>
<script src="js/app/04-stage-lyrics.js"></script>
<script src="js/app/05-lyric-modes-cover.js"></script>
<script src="js/app/06-beat.js"></script>
<script src="js/app/07-shelf.js"></script>
<script src="js/app/08-api-search.js"></script>
<script src="js/app/09-audio-queue.js"></script>
<script src="js/app/10-lyrics-panel-playlist.js"></script>
<script src="js/app/11-fx-console.js"></script>
<script src="js/app/12-system-panels.js"></script>
<script src="js/app/13-update-account.js"></script>
<script src="js/app/14-idle-toast-libs.js"></script>
<script src="js/app/15-shell.js"></script>
<script src="js/app/16-session-boot.js"></script>
```

**不加 `defer` / `async` / `type="module"`** —— 任何一个都会改变执行时机。

每个新文件**开头都要保留 `'use strict';`**：现在整份 `main.js` 是严格模式，拆开后如果漏掉某个文件，
那个文件会退回**非严格模式**（例如给未声明变量赋值会静默创建全局变量，而不是抛错）。

---

## 四、外部改动面（精确清单）

我逐个查过了，改动面**很小**：

| 位置 | 现状 | 要改什么 |
|---|---|---|
| `public/index.html:1139` | `<script src="js/main.js">` | 换成 16 行（见上） |
| `tests/parse-order.test.js:20` | `readSource('public/js/main.js')` | 指向 `app/09-audio-queue.js`（`shouldPreferThirdPartyParse` 在 §25 播放队列里） |
| `tests/quality-notice.test.js:21` | 同上 | 指向提示判定块所在文件（§25/§26 附近，切割后精确定位） |
| `tests/third-party-notice.test.js:20` | 同上 | 指向 `tryThirdPartyParse` 所在文件（§25） |
| `tests/source-config-removal.test.js:22` | `MAIN_JS` 常量 | 同上；另有 4 条"已删除 function"断言，需按新文件逐个查 |
| `scripts/probe-static-exposure.js:101` | 断言 `/js/main.js` 返回 200 | 改成断言某个新文件（或保留 `main.js` 作为兼容入口，见"待拍板"） |
| `docs/*.md`（4 处） | 引用 `public/js/main.js` 的**具体行号** | 行号会全部失效，加一句"行号对应 `784afe6` 基线"即可 |

**不需要改**（已确认）：

- `desktop/`、`build/` —— **零引用** `public/js/*`
- `server/server.js:259` 的 `PATCH_ALLOWED_FILES` —— 只含 `server/server.js` / `server/dj-analyzer.js` / `package.json` / `package-lock.json`，**不含 main.js**
- `package.json` 的 `build.files` 有 `public/**/*`（自动覆盖新文件）；`asarUnpack` 不含 main.js
- `desktop/preload.js` —— 只有 `DOMContentLoaded` 监听，而它在**所有** parser-blocking script 之后才触发

---

## 五、风险与为什么可控

### 5.1 唯一的真实语义差异：文件之间会不会插进别的任务？

今天 `main.js` 是一个 1259 KB 的文件，**一次性执行完**。拆成 16 个 `<script>` 后，浏览器在取下一个
脚本时会回到事件循环，理论上可能有 pending 任务插进来读到"半初始化"的全局状态。

**我逐个查过，这个窗口里没有任何东西能跑：**

| 潜在来源 | 实测结果 |
|---|---|
| 前面 9 个脚本（cuefield×5 / fx-console-workspace / sonic×2 / web-fx-presets）的顶层异步注册 | **0 条**（`setTimeout` / `setInterval` / `requestAnimationFrame` / `fetch` / `MutationObserver` / `WebSocket` 全部为 0） |
| `index.html:23` 的内联 `<script>` | 只往 `documentElement` 加一个 class，无定时器无监听 |
| `desktop/preload.js` | `DOMContentLoaded` 监听（在全部脚本之后才触发）+ IPC 监听（由渲染进程按需注册，非加载期） |
| `fx-console-workspace.js` 的顶层语句 | 只有 2 条 `window.xxx = ...` 赋值；`organizeFxConsoleWorkspace()` 是 `main.js:21477` 在**运行时**调的 |

→ **结论：文件之间没有可插入的任务，切分对执行时序是透明的。**

### 5.2 跨文件函数/变量引用

- 顶层 `function foo(){}` → 挂在 `window` 上，**所有文件加载完后全局可见**。调用都发生在
  `DOMContentLoaded` 之后或用户交互时，那时 16 个文件全部就绪 → 安全。
- 顶层 `var x` → 同样挂在 `window` 上。
- 顶层 `let`/`const` → 进**全局词法环境**（不在 `window` 上），**跨 script 可见**，且 TDZ 行为与今天完全一致（因为顺序没变）。
- 唯一要防的：某个文件的**顶层语句**调用了后面文件里的函数。因为顺序不变，今天能跑的顺序拆完还是能跑；今天会 TDZ 报错的，拆完一样报错 —— **行为等价**。

### 5.3 已知的机械风险（靠工具消除）

| 风险 | 对策 |
|---|---|
| 切割点落进函数体 / 模板字符串中间 | 只允许在 48 个分区横幅处落刀；切完跑 `node --check` 逐个验语法 |
| 某个文件漏掉 `'use strict'` | 脚本统一注入，并逐个 `grep -c "^'use strict';"` 核对 = 16 |
| 首尾行错位、内容丢失/重复 | 切完做**拼接回验**：16 个文件按序拼起来，必须与原 `main.js` **逐字节一致**（除了插入的 `'use strict'` 和文件头注释） |
| 函数被跨文件"劈开" | 用大括号配对数每个文件的顶层声明数，与 §附录 B 的预期值比对 |

### 5.4 代价（诚实说）

- **`git blame` 会变难**：跨文件移动 git 追踪不了。但 `git log -S "函数名"` 仍可用，而且以后每个文件只有 1000–2900 行，反而更好定位。
- **一次提交动 28117 行**：review 时请按"纯移动"看，我会在提交信息里写明"零逻辑改动"，并附拼接回验的证据。
- **启动多 15 次本地 HTTP 请求**：Electron 走本地 `http://127.0.0.1`，字节数不变，影响可忽略（真要优化可以合并成 1 次请求，见"待拍板"）。

---

## 六、验证方案

拆完必须全绿才算过：

| 层 | 命令 | 期望 |
|---|---|---|
| 语法 | `for f in public/js/app/*.js; do node --check "$f"; done` | 16/16 OK |
| **等价性（关键）** | 拼接回验脚本 | 16 文件按序拼接 == 原 `main.js`（除注入的 `'use strict'` + 文件头） |
| 结构 | 顶层声明数 / 顶层语句数 与拆分前逐项比对 | 1803 / 159 |
| 单测 | `npm test` | 82/82 |
| 离屏实测 | `npm run probe:ui` | 6/6，`errors` 全空 |
| 接口 | `npm run probe:static` + `npm run probe:cuefield-api` | 16/16 + 三接口 200 |
| 端到端 | `npm run probe:parse` | kugou 解析成功 |
| 静态暴露 | `npm run probe:static` 的对照组 | 新 `app/*.js` 可访问（200） |
| 人工 | 起 Electron 跑一遍：切歌 / 切预设 / 开控制台 / 本地歌 / 登录 | 无异常 |

**拼接回验**是这次的关键闸门：它把"有没有改坏内容"变成可判定的，而不是靠肉眼。

---

## 七、要你拍板的 4 个点

1. **文件放哪 / 叫什么**
   - 方案 A（推荐）：`public/js/app/01-state.js` … `16-session-boot.js` —— 独立目录，数字前缀表达顺序
   - 方案 B：`public/js/modules/<组>/<NN>-<名>.js` —— 和上游命名一致，但会让人误以为也是按职责分的
   - 方案 C：`public/js/` 平铺 `main-01-state.js` … —— 不改目录结构，但 `js/` 下会有 16 个新文件

2. **要不要保留 `public/js/main.js` 作为兼容入口**
   - 保留：`main.js` 变成一行 `document.write` 或 16 个 `<script>` 注入 → 但**动态注入会破坏顺序保证**，只能 `document.write`，很脆。**我不推荐。**
   - 不保留（推荐）：直接删，`index.html` 列 16 行。简单、可 grep、顺序显式。

3. **一次切完，还是分两批**
   - 一次切完（推荐）：一次提交、一次验证，`tests/` 改动也只做一遍。
   - 分两批：先切 §1–§18（上半，纯视觉/渲染，无外部引用），确认没问题再切下半。稳妥但要做两轮验证。
   - 我倾向**一次切完** —— 因为切割是纯机械的，分两批反而增加"半拆状态"的时间窗口。

4. **要不要顺带做「按职责重排」（第二步）**
   - 我建议**先不做**。等这次落地、`tests/` + 探针跑顺了，再单独评估。理由见第一节。

---

## 附录 B：顶层可执行语句分布（拆分时唯一要盯的东西）

159 条顶层可执行语句里，50 条是 `addEventListener`。其余 109 条按文件分布：

| 文件 | 条数 | 行号 |
|---|---|---|
| 01-state.js | 5 | 137, 151, 275, 803, 1039 |
| 02-scene-camera.js | 24 | 1141, 1227–1237, 1529, 1530, 2682, 2878, 2951, 2954, 3043, 3046, 3051, 3090, 3095, 3101, 3121 |
| 03-particles.js | 22 | 3243–3330, 3978–3984, 4092–4096, 4123 |
| 04-stage-lyrics.js | 1 | 6033 |
| 05-lyric-modes-cover.js | 3 | 7505, 7506, 8056 |
| 06-beat.js | **0** | — |
| 07-shelf.js | 16 | 12190–12203（着色器，扫描误收）, 12535, 12604–12606, 13550–13759 |
| 08-api-search.js | 10 | 14696, 15130, 16159, 16404–16467 |
| 09-audio-queue.js | 1 | 18079 |
| 10-lyrics-panel-playlist.js | 17 | 18808–19522 |
| 11-fx-console.js | 4 | 19541, 19555, 19560, 19827 |
| 12-system-panels.js | 2 | 21990, 22427 |
| 13-update-account.js | **0** | — |
| 14-idle-toast-libs.js | 2 | 25052, 25207 |
| 15-shell.js | 11 | 25468–26769 |
| 16-session-boot.js | **40** | 27179–28116（含 §47「启动」整段 init 序列 + 28116 `animate()`） |

> 统计口径：列 0 且不在字符串/模板字符串/注释内、非声明、非闭合括号。
> 列 0 命中共 247 条，剔除 88 条位于模板字符串内的 GLSL 着色器源码后剩 159 条。
> 另有 4 条（12190/12191/12202/12203）是扫描器未识别出的着色器文本，实际约 155 条。
