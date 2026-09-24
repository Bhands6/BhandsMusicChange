# `public/js/app/*.js` 按职责重排（**已执行** · 2026-09-24）

> 这是 `docs/MAIN_JS_SPLIT_PLAN.md` 里反复提到的「第二步」。
> 第一步（`d84ee11` 按写入时间机械切成 16 个 + `a750fcc` 补 `00-prelude.js`）只解决了
> 「main.js 太大」，**没有**解决「同一个功能散在好几个文件里」。
> 本文记录第二步做了什么、怎么证明它是零语义改动、以及踩到的坑。
>
> 相关文档：`docs/MAIN_JS_SPLIT_PLAN.md`（第一步）、项目记忆 `topics/frontend-ui.md`。

---

## 一、一句话结论

把 `public/js/app/` 从 **17 个「按写入时间切」的文件** 重排成 **19 个「按职责分」的文件**
（`00-prelude.js` + `01-state.js` … `18-session-boot.js`），
**跨文件搬移 245 个顶层条目**（219 `function` / 24 `var` / 2 条语句），
并用「加载期读写顺序等价」校验器证明**语义零改动**。

| | 重排前 | 重排后 |
|---|---|---|
| 文件数 | 17（`00-prelude` + `01`…`16`） | **19**（`00-prelude` + `01`…`18`） |
| 总行数 | 27695 | 28478 |
| 顶层条目 | 1863（1211 fn / 494 var / 158 语句） | 1863（**一个不多一个不少**） |
| 跨文件搬移 | — | 245 条 |

---

## 二、为什么要重排：摸底结果比文档记的严重

`topics/upstream-mineradio.md` 原来记的是「歌词三处、封面两处」。实测（按函数名 + 引用清点）：

| 功能 | 重排前散在几个文件 | 具体 |
|---|---|---|
| 歌词 | **10 个** | `00/01/02/04/05/08/10/11/12/15`，194 个含 `lyric` 的函数 |
| 封面 | **10 个** | `00/01/03/04/05/06/07/08/11/16`，63 个含 `cover` 的函数 |
| 歌单架 | **9 个** | `02/04/07/08/12/13/…` |
| 快捷键 | **2 个** | `12-system-panels.js`（整套键位处理）+ `15-shell.js` |

另外发现两处「明显错位」：

- `12-system-panels.js` 是个大杂烩：系统面板 + **fx 面板机制** + **整套快捷键** + 音源设置 + 歌单架控件 + 沉浸模式。
- `06-beat.js` 后半段（2114 行起）**整段是封面裁剪弹窗**，与节拍分析无关。

---

## 三、目标结构（19 个）

| 文件 | 职责 | 行数 |
|---|---|---|
| `00-prelude.js` | **跨 script 提升垫片**（第一步的产物，本次不动）：46 个前置 `function` + 2 条 `var` 垫片 | 652 |
| `01-state.js` | 全局状态 / 常量表 / store key / 热键表 / 预设（**中央状态文件，全量保留**） | 1148 |
| `02-scene.js` | three.js 场景 / 相机系统 / 指针拖拽 / 粒子点纹理 | 1987 |
| `03-particles.js` | 粒子系统：主粒子 / 背景星河 / 浮空层 / 安魂层 / 封面背面层 / **涟漪** | 1882 |
| `04-lyrics.js` | 歌词：解析 / 自定义歌词 / 面板 / 显示模式 / 动画 / 校准 / 时间偏移 | 1794 |
| `05-lyrics-stage.js` | 歌词舞台渲染：three.js mesh / 纹理 / 字体 / mask / glow / 调色 | 1273 |
| `06-cover.js` | 封面：加载 / **裁剪弹窗** / 边缘与深度 / AI 深度 / 画布 | 840 |
| `07-beat.js` | 节拍分析：离线预解析 / podcast DJ / 本地节拍 | 2451 |
| `08-shelf.js` | 3D 歌单架：双模式 / 二级内容框 / PSP 卡片交互 / 控件 | 2500 |
| `09-api-search.js` | API 助手（网易云 / QQ 请求封装）/ 搜索 / 首页发现 | 2515 |
| `10-audio-queue.js` | 音频上下文 / 频谱分析 / 播放队列 | 1587 |
| `11-playlist.js` | 播放列表面板 / 拖放 / 本地音乐导入 / 播放进度 | 963 |
| `12-fx-console.js` | 控制台：面板机制 / 预设卡片 / 主滑块 / 开关 / **调色台** / 歌词控件 / **自定义背景** | 2519 |
| `13-system-panels.js` | 输出设备 / 本地缓存 / 内存管家 / 第三方音源设置 / 系统设置 | 596 |
| `14-account.js` | 登录 / 会员：网易云 / QQ / 酷狗扫码 / 账号胶囊 | 788 |
| `15-update.js` | 更新提示预览 / 下载 / 补丁 | 585 |
| `16-idle-toast-libs.js` | 空场待机引导 / 视觉引导 / 手势 / toast / 动态库加载 | 1218 |
| `17-shell.js` | 外壳：Resize / **快捷键** / UI 半隐藏 / splash / 加载过渡 / **沉浸模式** / 桌面 overlay | 1955 |
| `18-session-boot.js` | 会话持久化 / 启动自动播放 / 酷狗扫码 / 恢复态预解析 / 启动序列 / 主循环 | 1225 |

搬移量分布：`06-cover` 51 · `12-fx-console` 48 · `17-shell` 44 · `04-lyrics` 42 · `15-update` 24 · `08-shelf` 21 · `03-particles` 15。

---

## 四、安全模型：`function` 能随便搬，`var/let/const` 不能

这是本次重排唯一的真实风险，也是为什么第一步**故意**没做重排。

| 条目类型 | 提升行为 | 跨文件搬移 |
|---|---|---|
| 顶层 `function` 声明 | 提升到**整个 script 顶部**，位置无关 | ✅ 零语义改动（可见范围只增不减） |
| 顶层 `var` | 只提升**绑定**，不提升**初始化** | ⚠️ 读取点看到 `undefined` 还是真值，取决于初始化有没有跑过 |
| 顶层 `let/const/class` | **TDZ** | ⚠️ 初始化前读取直接 `ReferenceError` |
| 顶层**语句** | 立即执行 | ⚠️ 执行时刻变了就是行为改动 |

所以重排必须证明：**每一个加载期读取点，看到的初始化状态与重排前完全一致。**

### 「加载期读取」的判定口径

条目自身的引用 **∪** 它**同步调用**到的顶层函数体内的引用（继续下钻）。
嵌套回调体不算（之后才跑），例外是 `forEach/map/filter/reduce/some/every/sort/flatMap/keys/values/entries/from/apply/call/then/catch/finally` 这类**同步高阶函数**传入的回调。
这套口径与 `scripts/check-app-hoisting.js` 完全一致（共用 `scripts/lib/ast-scan.js`）。

### 两条闸门，各守一半

| 闸门 | 守什么 | 实现 |
|---|---|---|
| `npm run check:hoisting` | **跨 script 提升**：拆成多个 `<script>` 后提升范围变小 | `scripts/check-app-hoisting.js` |
| `npm run check:reorg` | **加载期读写顺序**：`var/let/const` 与语句的搬移是否可观测 | `scripts/check-app-reorg.js` + `scripts/reorg/load-order-baseline.json` |

`check-app-reorg.js` 的做法不是去证明「任意 `var` 可交换」这种通用定理（含副作用的初始化器是陷阱），
而是**记录优化**：把执行序形式化成一串「有加载期副作用的条目」（顶层语句 + 带初始化的 `var/let/const` + `class`），
对每个名字 X 记录 `读取点 → 那一刻 X 是否已初始化` 的映射，与基线逐项比对。
只有读取点顺序真的变了才报警 —— 而这恰好就是可安全重排的范围。

用法：

```bash
node scripts/check-app-reorg.js --write-baseline   # 改布局**前**跑一次，落基线
npm run check:reorg                                # 改完跑，验证等价
node scripts/check-app-reorg.js --detail           # 打印每个名字的观测序列
```

**再改布局时的正确姿势**：先 `--write-baseline`（用**改之前**的代码），再动手，再 `npm run check:reorg`。
基线是「上一次布局」的快照，不是「原始 main.js」的快照。

---

## 五、工具链

| 文件 | 作用 |
|---|---|
| `scripts/lib/ast-scan.js` | esprima 作用域分析公共库（`refsOf` / `calledRefsOf` / `hasSideEffect` / `declaredNames` / `makeParser`…）。`check-app-hoisting.js` 与 `check-app-reorg.js` 共用，避免复制 175 行 |
| `scripts/check-app-reorg.js` | 加载期读写顺序等价校验器（**入库**，`npm test` 会跑，见 `tests/app-reorg.test.js`） |
| `scripts/reorg/load-order-baseline.json` | 重排**前**的观测基线（**入库**，191 KB） |
| `scripts/reorg/plan-and-apply.js` | **一次性**迁移工具：dry-run 出计划 / `--apply` 落盘。已加前置守卫 —— 检测到旧文件名不存在时直接提示「已经重排过了」并退出，不会抛 `未知源文件` 那种天书 |
| `scripts/out/reorg-plan.json` | dry-run 产物（被 `.gitignore` 忽略；**不要**写进 `scripts/reorg/`） |
| `scripts/out/reorg-backup/` | 落盘前对 16 个旧文件的备份（忽略） |

---

## 六、验收（实测）

| 闸门 | 结果 |
|---|---|
| 无损切分（每源文件按块拼回逐字符一致） | ✅ 17/17 |
| 条目守恒（hash 多重集） | ✅ 1863 条，不丢不重 |
| `node --check` × 19 | ✅ 19/19 |
| `npm run check:hoisting` | ✅ prelude 覆盖全部 46 个前置依赖（顶层 function 1257 个，prelude 承载 46 个） |
| `npm run check:reorg` | ✅ 652 个有副作用条目 / 1110 个名字 / **3104 处读取点逐一比对通过** |
| `npm test` | ✅ **95/95**（新增 `tests/app-reorg.test.js` 3 条） |
| `npm run probe:ui` | ✅ **7/7**；`probe-app-load` → `verdict: "OK"`、`consoleErrors: []`、`fails: []`、8 个关键全局齐全、`appScripts` 19 个顺序正确 |
| `npm run probe:static` | ✅ **38/38**（19 个 `js/app/*.js` 逐个 HTTP 200） |
| **基线对照**（`a750fcc` worktree 跑同一套离屏探针） | ✅ 7 个载荷在归一化路径/文件名后，**除 `appScripts` 个数 17→19 外逐字节一致**（`errors` / `consoleErrors` / `globals` / `verdict` / `bodyClass` / `noise` / `fails` 全同） |
| 变异验证 ①：把 `var scene = new THREE.Scene();` 从 `02-scene.js` 搬到 `18-session-boot.js` 末尾 | ✅ `check:reorg` 报 12 条「`scene` 的读取观测变了（已初始化 → 未初始化）」，还原后 sha256 一致 |
| 变异验证 ②：从 `index.html` 删掉 `00-prelude.js` 的 `<script>` 行 | ✅ `npm test` 6 条红（`app-hoisting` / `app-reorg` / `app-script-order` 三个测试文件），`check:hoisting` 报红，还原后 sha256 一致 |

### 基线对照里的「噪声」是既有的，不是本次引入

`probe-app-load` 的 `noise` 数组在重排前后**完全一致**：

```
["resource:IMG","resource:IMG","resource:IMG","rejection:Failed to construct 'URL': Invalid URL"]
```

3 条 `IMG` 资源错 + 1 条 Electron 内部 `URL` rejection，来源是 `index.html` 里的空 `src` 占位图。
探针把它们归为「噪声（不计失败，供漂移对照）」——**正是为了让这类既有噪声在重排前后可对照**。

---

## 七、踩到的坑（都值得记住）

### 7.1 ⚠️ `makeParser` 的 `import(` 替换必须**等长**（最严重）

esprima 4 不支持动态 `import()`，所以解析前要先替换掉。原实现用 `'__dynImport('` —— **长度变了**。
`05-lyric-modes-cover.js` 里有 1 处 `import(`，导致该文件里 `range` 之后**全部偏移 10 字符**；
按 `range` 切块时块被切坏，坏块又被搬进别的文件 → 落盘后 4 个文件语法错
（`funcction setCoverDepthState(...)`、注释丢了 `//`、函数名多一个字）。

**修法**：等长替换。

```js
const sanitize = (s) => s.replace(/\bimport\s*\(/g, (m) => '_'.repeat(m.length - 1) + '(');
```

**教训**：任何「解析前改写源码」的预处理，只要结果会喂给按 `range` 取原文的调用方，就必须等长。

### 7.2 ⚠️ 切块必须按**字符 range**，不能按行

`03-particles.js:91` 有**同一行两个顶层语句**：

```js
rippleTex.magFilter = THREE.NearestFilter; rippleTex.minFilter = THREE.NearestFilter;
```

esprima 报两者 `loc` 都是 91-91。按行切会给第二个切出空块并多插一个换行 → 拼接回验报 −66 字符。
改用 `raw.slice(prevChar, st.range[1])` 切、`join('')` 拼，`prevChar` 用 `range[1]` 推进。

### 7.3 ⚠️ 条目 hash 只能取**条目自身源码**，不能含前导注释/空行

否则给每个新文件加一行 header、或改写 prelude 的 `// ↓ 原属 X.js` 标签，就会把「条目没变」误报成
「条目消失」——`check-app-reorg.js` 曾因此报出 100 条假红。

```js
const code = raw.slice(st.range[0], st.range[1]);   // ✅ range 之内
const hash = sha(code.replace(/\s+/g, ' ').trim());
```

### 7.4 ⚠️ 改 prelude 标签要改**标签行**，不是紧跟的 function 声明行

第一版重写脚本把 `function xxx(` 那一行整个换成了 `// ↓ 原属 09-api-search.js`，
`46 insertions / 46 deletions` —— **函数名全被吃掉**，于是又出现一批语法错。
改成只匹配 `^// ↓ 原属 (.+\.js)$` 那一行，再往下找紧跟的 function 声明行取函数名。

### 7.5 ⚠️ `probe-static-exposure.js` 的「假红」与「删真文件」双重隐患

[3] 段会**故意**往 `public/js/` 里种两个假文件（`server.js` / `dj-analyzer.js`）来验证 `serveStatic` 拦截。
两个问题：

1. **假红**：进程若在 [3] 与它的 `finally` 之间被打断（超时 kill / stdout 被 `| head` 提前关闭 → EPIPE），
   占位文件留在磁盘上，**下一次**运行的 [1] 段会报「不存在 `public/js/server.js` 期望 false / 实际 true」——
   报的是上一次的残骸，不是真的有人把 Node 模块放回了 `public/`。
2. **删真文件**：`writeFileSync` 会直接**覆盖**已存在的真文件，`finally` 再把它删掉 ——
   等于「跑一次探针把人家的 `server.js` 删了」。

**修法（两层）**：

- 开跑前先自愈：只删**内容等于本探针占位串**（`PLANT_MARK`）的文件，绝不碰真文件；
  同时把残骸的诊断打出来（大小 + 首行 + 「是残骸」还是「真的是真源码」）。
- 种植前先判断：目标路径已有**非占位**文件就 `SKIP` 不覆盖、不删除；
  该路径依然做 HTTP 断言（那时拦的正是**真文件**，是更硬的验证）。

变异验证：种入占位残骸 → 自愈 + 全绿（exit 0）；种入「像真源码」的文件 → [1] 报红、`SKIP` 不覆盖、文件原样保留。

### 7.6 ⚠️ 一次性工具要在入口拦住「已经做过了」

`plan-and-apply.js` 只认旧文件名。重排落盘后再跑，`classify()` 会抛
`未知源文件：02-scene.js` —— 看起来像脚本坏了，其实是「已经重排过、无需再跑」。
已在入口加守卫：检测旧文件名缺失 → 打印当前实际布局 + 指向 `npm run check:reorg`，`exit 0`。

---

## 八、以后再动布局的规矩

1. 改了 `public/js/app/*.js` 的**文件划分**（搬条目跨文件）→ 先 `node scripts/check-app-reorg.js --write-baseline`
   用**改之前**的代码落基线，改完 `npm run check:reorg`。
   只改函数体、不搬条目 → 不用重落基线（hash 会变，但读观测不变；`check:reorg` 会因条目 hash 变化报红，
   那时按提示重落基线即可）。
2. 跑 `npm run check:hoisting`。
3. 跑 `npm test`（含 `tests/app-reorg.test.js`）。
4. 跑 `npm run probe:ui` —— **`probe-app-load.js` 排第一位，是唯一能看见加载期错误的闸门**。
5. 跑 `npm run probe:static`。
6. **不要**给这 19 行 `<script>` 加 `defer` / `async` / `type="module"`：
   parser-blocking 顺序执行是硬约束（跨 script 提升垫片依赖它）。
7. 跨文件改代码时按**函数名** grep，别再找行号。

---

## 九、诚实的代价

- 一个函数现在**只在一个文件里**，但 `01-state.js` 依然是 1148 行的中央状态文件 ——
  本次**没有**拆它（它是 `var` 最密集的地方，拆它风险最高、收益最低）。
- `check-app-reorg.js` 证明的是「加载期读写语义等价」，**不证明**运行期行为等价。
  运行期那半边靠 `probe-app-load.js` 的离屏加载 + 基线对照。
  **「内容没坏」≠「应用能跑」**，两类闸门缺一不可。
- 基线文件 191 KB 入库。换来的是「任何一次布局调整都能在 1 秒内证明没有引入加载期顺序回归」。
