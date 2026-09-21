# BhandsMusicChange 全盘扫描报告

扫描时间：2026-09-21 10:0x
扫描范围：`BhandsMusic/BhandsMusicChange`（活跃仓库）+ 对照 `BhandsMusic_Web/Bhands_Web`、`MineraMusic/Mineradio`
扫描方式：静态检查（重复声明 / 重复 id / 死选择器 / 文档漂移 / git 卫生）+ Electron 真实加载页面抓控制台错误

> 每条都附了**验证方法**，你回来可以直接照着复核。

---

## A. 真 bug（建议修）

### A1. main.js 有 8 个函数被声明两次，前一份是死代码（约 300 行）

`public/js/main.js` 里这 8 个函数各有**两个定义**，且**内容不同**：

| 函数 | 第 1 处（死代码） | 第 2 处（生效） |
|---|---|---|
| `defaultUserFxArchiveName` | 18932 | 19261 |
| `normalizeUserFxArchiveName` | 18935 | 19264 |
| `saveUserFxArchive` | 19213 | 19332 |
| `applyUserFxArchive` | 19222 | 19343 |
| `renameUserFxArchive` | 19233 | 19351 |
| `commitUserFxArchiveRename` | 19238 | 19356 |
| `cancelUserFxArchiveRename` | 19247 | 19367 |
| `renderUserFxArchives` | 19180 | 19275 |

JS 里函数声明提升，**后者覆盖前者** —— 所以 18932~19260 这一整段（约 300 行）是**永远不会执行的死代码**。两版行数还不一样（例：`renderUserFxArchives` 33 行 vs 44 行、`applyUserFxArchive` 11 行 vs 8 行），说明是两次不同实现被叠加，前一份里可能有被丢弃的意图。

**影响**：代码体积 + 维护困惑；如果前一份里有后来没搬过去的逻辑，那个功能就是静默缺失的。

**验证**：
```bash
grep -n "^function applyUserFxArchive\|^function renderUserFxArchives" public/js/main.js
# 看两处的函数体是否不同
sed -n '19222,19232p' public/js/main.js   # 死代码版
sed -n '19343,19351p' public/js/main.js   # 生效版
```

---

### A2. WebGL 初始化失败会让 main.js 后续代码全部不执行（无降级）

`main.js` 在顶层同步创建 `THREE.WebGLRenderer`。一旦创建失败（抛 `Uncaught Error: Error creating WebGL context.`），**脚本从该行往后全部不再执行**：函数因声明提升仍可调用，但所有 `var` 赋值丢失。

我在禁用 GPU 的环境下实测到的后果：
- `typeof startupAutoplayPreference` / `startupFastSkipPreference` 等后段变量全部 `undefined`
- `stageLyrics` 也是 `undefined` → 歌词/视觉系统整体不可用
- 启动页 DOMContentLoaded 处理器虽已注册，但它依赖的后段状态全是空

**触发场景**（真实用户会遇到）：远程桌面 / 虚拟机、老显卡或驱动异常、GPU 被组策略或杀软禁用、显卡驱动崩溃后重启应用。

**影响**：这类机器上应用会**半死状态**（能开窗口但视觉与播放初始化缺失），且没有任何提示。

**验证**：
```bash
# 用禁用 GPU 的 Electron 打开，抓控制台
# 会看到：Uncaught Error: Error creating WebGL context.
```
或在浏览器里 `chrome://gpu` 确认 WebGL 不可用后打开 `http://127.0.0.1:<port>`。

**建议**：把 WebGL 创建包进 try/catch，失败时走降级分支（跳过视觉初始化但保留播放/UI），并在界面上给一次明确提示。

---

### A3. 网易云歌词接口的 `lyric` 字段偶发返回 YRC JSON 而非 LRC

实测 `GET /api/lyric?id=186016`（晴天）时，`lyric` 字段返回的是：
```
{"t":0,"c":[{"tx":"作词: "},{"tx":"周杰伦","li":"...","or":"..."}]}
```
每行一个 JSON 对象 —— 这是网易云的 **YRC 格式**，不是 LRC。而同一接口对 Lemon / 打上花火 / Dynamite 返回的是正常 LRC。

现有解析路径 `parseLyricText(r.lyric)` 用 `/\[(\d{1,2}):(\d{1,2})/` 匹配时间戳，对 YRC JSON **一行都匹配不到** → `lines` 为空 → 走 `withLyricFallback` 兜底成「歌名 - 歌手」占位文本，用户看到的是**假歌词**而不是真歌词。

**验证**：
```bash
# 起服务后
curl "http://127.0.0.1:3099/api/lyric?id=186016" | head -c 300
# 观察 lyric 字段是 LRC 还是 {"t":0,"c":[...]} 形式
```
多请求几次/换几首歌，会看到两种格式交替出现。

**建议**：`fetchLyric` 里加一个 YRC-JSON 分支解析（检测 `{"t":` 开头就走 JSON 解析），或服务端在返回前统一转成 LRC。

---

### A4. `.music-sources.json` 未被 gitignore（含用户配置，有误提交风险）

该文件保存**用户的音源配置**（`customApiUrl` 自定义接口地址、`lxMusicScripts` 脚本元信息、`goMusicApiUrl` 等），目前处于**未跟踪但未被忽略**状态：
```bash
git check-ignore -v .music-sources.json   # 无输出 = 未被忽略
```
一次 `git add -A` 就会把用户配置提交进仓库。

**验证**：上面那条命令无输出即确认。

**建议**：加进 `.gitignore`，并在仓库里放一份 `.music-sources.example.json` 作模板。

---

### A5. 版本号三处不一致

| 位置 | 值 |
|---|---|
| `package.json` `version` | **1.5.0** |
| `README.md`「当前版本」 | v1.4.0 |
| README 里的安装包名 | `BhandsMusic-1.4.0-Setup.exe` |

**验证**：
```bash
node -e "console.log(require('./package.json').version)"
grep -n "当前版本\|Setup.exe" README.md | head
```

---

## B. 视觉控制台的遗留问题（我已在分批修，进度 5/17）

### B1. 还有 12 个条目引用了不存在的控件

已确认这 12 项对应的功能**在本 fork 里从未移植**（上游有实现，本 fork 拍平 main.js 时只搬了注册表）：

| 分组 | 缺失项 |
|---|---|
| 颜色与光效 | 亮底避光 |
| 字体与排版 | 歌词清晰度 |
| 粒子与光影 | 背景星河 |
| 启动与退出 | 秒启动跳过启动页 ✅本轮已补 · 恢复播放位置 ✅本轮已补 |
| 播放输出 | 播放输出设备 ⚠️（需枚举真实声卡，我无法验证）|
| 性能与后台 | 前台帧率上限 · 歌词实时边界 · 上下句高清纹理 · 全局歌词避光 · 封面粒子避光 |
| 缓存与存储 | 本地缓存 |

**验证**：打开软件 → 视觉控制台，这些分组标题点开会是空的（或部分空）。

### B2. 注册表里 3 个死选择器

`fx-console-workspace.js` 的 `blockSelector` 里 `.sonic-audio-monitor` / `.audio-output-section` / `.cache-storage-panel` 在 DOM 中**都不存在**（对应分组本来就是空的），属于无效条目，匹配不到任何元素（无副作用，但会误导后续维护）。

**验证**：
```bash
for s in sonic-audio-monitor audio-output-section cache-storage-panel; do
  echo "$s: DOM=$(grep -c "class=\"[^\"]*$s" public/index.html) 注册表=$(grep -c "$s" public/js/fx-console-workspace.js)"
done
```

### B3. 上游本身就没做「译文字号 / 译文透明」的 UI

上游 `public/index.html` 里只有「译文间距」一个滑块，`fx-lyrictranslationscale` / `fx-lyrictranslationopacity` 只有**状态定义和注册表条目**。本轮我按上游的状态默认值与范围（0.65 / 0.46–1.12、0.86 / 0.20–1）自己补了这两个滑块。**这两项不是"移植"，是我设计的**，观感请你重点看一下。

### B4. 重复入口（上游设计如此，非 bug）

`.lyric-glow-effect-row`（两个按钮：后层溢光 / 跟随鼓点）与 `t-lyricGlow` / `t-lyricGlowBeat` / `t-lyricGlowParticles`（三个开关）是**两套并存入口**，上游就是这样。控制台里会同时出现「歌词溢光开关」和「歌词溢光 / 鼓点溢光 / 歌词光粒」，看着重复但功能一致。

---

## C. 文档漂移

### C1. 5 个文档仍写旧机器路径

以下文件里仍是 `E:\桌面\播放器软件\...`，与当前工作区 `F:\UE\Bhands_Music_Window` 不符：

- `docs/HANDOFF_NEXT_CHAT.md`
- `docs/PROJECT_MEMORY.md`
- `docs/SECURITY_REBUILD_2026-06-24.md`
- `docs/MUSIC_PARSER_WEB_VS_CHANGE.md`（我本轮新写的，引用了旧路径）
- `README.md`

**验证**：
```bash
grep -rln "桌面" docs/ README.md
```

### C2. `docs/HANDOFF_NEXT_CHAT.md` 内容整体过期

文档里写「当前版本 v1.4.0」「`/releases/latest` 仍返回 v1.0.10 是刻意设置」「新对话先执行 `cd E:\桌面\...`」等，都与现状（1.5.0、多音源已集成、路径已变）不符。这份是新对话的入口文档，过期影响最大。

**验证**：打开该文件对照 `package.json` 与当前路径。

### C3. Web 版 README 与 docker-compose 不符

`BhandsMusic_Web/Bhands_Web/README.md`：
- 第 127 行：`GO_MUSIC_API_URL` 说明写「容器编排内自动注入」
- 第 162 行：结构树写 `docker-compose.yml # 生产部署编排（web + caddy + go-music-api）`

但 `docker-compose.yml` 里 **`go-music-api` 出现 0 次**（只有 `bhandsmusic` 和 `caddy`）。

**验证**：
```bash
grep -c "go-music-api" BhandsMusic_Web/Bhands_Web/docker-compose.yml   # 0
grep -n "go-music-api" BhandsMusic_Web/Bhands_Web/README.md            # 127 / 162 行
```

---

## D. 卫生 / 风险

### D1. ⚠️ Change 仓库有 54 个提交未推送

```bash
git -C BhandsMusic/BhandsMusicChange rev-list --count @{u}..HEAD   # 54
```
本地领先远端 54 个提交（含今天全部工作），**只存在于这台机器上**。

**建议**：确认没问题后尽快 `git push`。另外本轮新增的 5 个文件（`build/fetch-go-music-api.js`、`desktop/go-music-service.js`、`server/music-sources/goMusicSwitch.js`、`docs/MUSIC_PARSER_WEB_VS_CHANGE.md`、`.music-sources.json`）还是**未跟踪**状态，push 前记得 `git add`（`.music-sources.json` 见 A4，建议先忽略）。

### D2. 工作区根目录 3 个残留笔记文件

| 文件 | 大小 | 内容 |
|---|---|---|
| `__dirs.txt` | 214 B | 一堆目录名清单 |
| `__web.txt` | 272 B | 一堆文件名清单 |
| `lock-commit.txt` | 208 B | 提交记录，且**是乱码**（GBK 当 UTF-8 读） |

**验证**：`head -3 lock-commit.txt`

### D3. 工作区里有个 39MB 的 Chrome 诊断 profile

`.workbuddy/chrome_diag_profile2/` 占 **39MB**，是浏览器自动化诊断留下的 profile，不是项目内容。
（注意：`.workbuddy-ai/` 才是助手记忆目录，别删错。）

**验证**：`du -sh .workbuddy/chrome_diag_profile2`

### D4. 仓库体积

| 仓库 | 体积 |
|---|---|
| `BhandsMusicChange` | **563 MB**（主要是 node_modules）|
| `BhandsMusic_Web` | 24 MB |
| `MineraMusic/Mineradio` | 21 MB |

`MineraMusic/Mineradio` 是上游参考基线，当前**没有任何改动**（0 未推送、无脏文件）。如果不再需要对照，可以移出工作区省空间。

---

## E. 已确认**没有**问题的项

避免你重复查：

- ✅ 无 `TODO` / `FIXME` / `HACK` / `XXX` 残留（全仓库 0 处）
- ✅ `index.html` 无重复 `id`（0 处）
- ✅ `main.js` 里 `console.log` 仅 20 处，无调试刷屏
- ✅ 内置换源二进制 `vendor/go-music-api/` 已被正确 gitignore
- ✅ `BhandsMusic_Web` / `MineraMusic` 两个仓库干净（0 脏文件、0 未推送）

---

## F. 本轮已改动、请你重点验证的功能

| 批次 | 内容 | 需要你验证什么 |
|---|---|---|
| 音源解析 | 垫片硬拒绝、GDMusic 子源/音质档位、Unblock 平台、缓存 TTL | 播放正常、不再出现「歌词跟曲不对」 |
| LX 沙盒 | 进程内 vm → worker_threads（脚本死循环不再卡死应用） | 若有 LX 脚本，上传后能正常解析 |
| 内置换源服务 | go-music-api 随包分发 + 主进程托管 | 设置 → 第三方音源 → 「测试连接」应显示正常；关掉 Docker 后重启应用仍可用 |
| 控制台清理 | 歌单架 tab 删 4 组、动效 tab 删 4 组 | 这两个 tab 的分组数量对不对 |
| 双语翻译 | 4 项（译文数据早已在接口里） | **放一首外文歌（Lemon / 打上花火），模式切「当前」，看译文位置/大小是否顺眼**（3D 观感我这边验证不了）|
| 双语翻译 · 补漏 | 修了「上方停驻行没有译文」（见 G） | 沉浸/多行模式下切「多行」，**上方已唱过的那几行也应该出现译文** |
| 启动与退出 | 秒启动跳过启动页、恢复播放位置 | 开启「秒启动」后重启应直接进主页；「重播整首」生效 |
| 歌词溢光开关 | 补了上游的按钮行 | 歌词页多了一排「后层溢光 / 跟随鼓点」按钮 |

> 其中 **双语翻译的 3D 观感** 和 **播放输出设备** 是我明确无法验证的两项，麻烦你亲自看。

---

## G. 用户实测报障后的补修：双语翻译漏了「上方停驻行」

**现象**（用户截图，沉浸 5 行模式）：切到「多行/全部翻译」后，**只有下方后面的歌词有译文，上方已唱过的几行没有**。

**根因**：沉浸/多行模式下屏幕上是三段 —— 当前行 + **上方停驻行**（`stageLyrics.outgoing` 里 `userData.parked === true`）+ 下方预告行。上一轮实现只给「当前行」和「预告行」挂了译文，**停驻行完全没处理**。

**修法（顺带把设计改对）**：不再「按模式决定要不要挂」，改成**统一挂 + 用 `visible` 控制可见**。这样切模式是瞬时的（不用重建网格），也不会再漏行。

| # | 改动 | 说明 |
|---|---|---|
| 1 | 新增 `lyricTranslationWantedAt(slotKind, slot)` | 唯一的位置判定表（`current` / `parked` / `upcoming`）|
| 2 | 新增 `lyricLineAt()` + `syncMeshTranslation()` | 需要则挂/显示、不需要则隐藏；**文本变了才重建**（比对 `userData.translationText`），否则只切 `visible` |
| 3 | `refreshLyricTranslations()` 重写 | 遍历三段：当前行 + **全部 outgoing** + 全部 upcoming |
| 4 | `showStageLine()` | 给当前行 mesh 补 `userData.lineIdx`（它之后会变成停驻行，要靠这个找回译文）；旧当前行转停驻时按 `'parked'` 重新同步 |
| 5 | **`refreshAllLyricLineFonts()`** | 重建停驻行时补 `nm.userData.lineIdx = oldLineIdx` —— 原来重建后行号丢了，**换字体后停驻行的译文也会丢** |
| 6 | `applyLyricTranslationStyle()` | 遍历补上 `stageLyrics.outgoing`（拖滑块时停驻行也跟随）|
| 7 | 删除 `currentLineTranslationText()` / `upcomingLineTranslationText()` | 已被新实现取代 |

**定稿的模式语义**：

| 模式 | 当前行 | 上方停驻行 | 预告0 | 预告1+ |
|---|---|---|---|---|
| 关闭 | ✗ | ✗ | ✗ | ✗ |
| 当前 | ✓ | ✗ | ✗ | ✗ |
| 双行 | ✓ | ✗ | ✓ | ✗ |
| **多行** | ✓ | **✓** | ✓ | ✓ |

**验证**：决策表 **6/6 通过**（4 个模式 × [当前,停驻,预告0,预告1]，含非法值回落 `off`、`refreshLyricTranslations` / `applyLyricTranslationStyle` 不抛错）。语法通过。

**请复核**：沉浸/多行模式下切「多行」，**上方已唱过的那几行也应该出现译文**。

---

## H. 用户实测报障后的补修：歌词「前半对得上、后面全飘」

**现象**（用户日志，歌曲 4173190「Take Me To Your Heart」）：解析出的音乐**前面歌词速度对得上，后面对不上** —— 累积漂移。

**根因（三层叠加，已用真实数据锁定）**：

| # | 层 | 事实 |
|---|---|---|
| 1 | GD 接口 | `/api.php?types=search` 的返回**根本没有 `duration` 字段**（只有 `id/name/artist/album/pic_id/url_id/lyric_id/source/from`）→ gdmusic 里所有基于 `item.duration` 的时长校验**从未生效** |
| 2 | 歌名归一化 | `normalizeText` 会把**括号内容整段删掉** → 「Take Me To Your Heart **(Live)**」与原曲归一化后完全相同；歌手也相同 → 选中了排在**第一个**的 Live 版（id 26655379） |
| 3 | 下游探测 | `durationProbe` 容差 `max(10s, 8%)` → 238.8s 的歌容差 **19.1s**，而 Live 版音频实测 **221.9s**（差 **16.9s**）→ **放行** → 漂移 |

> 而搜索结果里的 `[1] id=4173190` 正是歌词所属的那首歌。

**修法（两处）**：

1. `server/music-sources/gdmusic.js`
   - **新增最强匹配信号**：GD 接口的 `id` / `url_id` / `lyric_id` **就是网易云歌曲 id**，而解析请求本来就知道目标 id。`pickBestCandidate(candidates, expected, source)` 中，`source === 'netease'` 且 `item.id === expected.targetId` → **直接返回**（必须放在歌名/变体判断之前，否则同名变体会抢先）。
   - **新增 `VARIANT_NAME_RE` 变体降权**（Live/现场/翻唱/伴奏/Remix/DJ/混音/acoustic/remaster… → `score -= 2`）。必须对**原始**歌名判断 —— `normalizeText` 已经把括号删了。
2. `server/music-sources/durationProbe.js`
   - `isDurationPlausible` 容差 **`max(10s, 8%)` → `max(5s, 4%)`**。长歌 19s 的容差太松。最坏情况只是换成别的音源；全部候选都不过时仍有 `settleFallback` 兜底，不会反而没得播。

**验证**：

| 项 | 修复前 | 修复后 |
|---|---|---|
| Take Me To Your Heart | 选中 Live 版，音频 **221.9s**（差 16.9s）| 音频 **238.8s**，差 **0.0s** ✅ |

- 容差单测 **8/8**（差 1/5/9s 放行；差 16.9/25s 拒绝；`acceptProbe` 拒绝 Live 版、放行正确版）
- 回归 5 首：海阔天空 326.0s、Lemon 256.0s、Take Me To Your Heart 238.8s **全部差 0.0s**

**关于晴天 / 打上花火「未解析到」（不是 bug）**：GD 接口对这两首**只返回翻唱**（晴天的候选是 Lucky小爱 / 梦里啥都有 / GYBeat / 钢琴版…；打上花火是 甜豆茜Akane / 萧狼琥珀 / シンシン…），**原唱不在结果里**，歌手匹配全部不通过 → 正确拒绝（防货不对版），解析链会继续走 kugou / goMusic / unblock。与本次改动无关 —— 歌手不匹配的拒绝逻辑是既有的。

**顺带印证**：日志里 `[MusicParser] 声明大小 185336B 过小（expectedMs=238760），疑似广告垫片，丢弃 unblockMusic` —— 之前做的**垫片硬拒绝在真实流量里生效了**，unblock 返回的 185KB 广告垫片被正确拦下。

**请复核**：再放一次「Take Me To Your Heart」，歌词应全程对得上。

## I. 修复记录（2026-09-21 11:45，A 节 5 个 bug 全部处理完毕）

| # | 结论 | 处理方式 | 验证 |
|---|---|---|---|
| A1 重复函数 | ✅ 已修 | 删除 8 个死函数共 79 行（按 span 精确删，保留了夹在中间的 archiveNumber/archiveMode 等活代码） | 语法 OK；每函数仅剩 1 份；存档功能冒烟 3/3 |
| A2 WebGL 无降级 | ✅ 已修 | 顶层创建包进 try/catch，失败时造 no-op 桩 renderer + `stageWebglFailed` 标志 + 3.2s 后 toast 提示；后续初始化全部照常 | 禁 GPU 环境（原崩溃复现环境）：桩生效、`startupAutoplayPreference` 等赋值恢复、splash 点击退场、无 Uncaught，4/4 |
| A3 YRC 假歌词 | ✅ 已修 | `parseLyricText` 逐行检测 `{"t":...,"c":[{"tx":...}]}` JSON 行并提取文本，其余仍走 LRC；非法 JSON 安全丢弃 | 单测 13/13（LRC 不回归 / YRC 提取 / 混合 / duration 推断） |
| A4 gitignore | ✅ 已修（随提交推送时顺带） | `.music-sources.json` 与 `vendor/go-music-api/` 已入 `.gitignore` | `git check-ignore` 生效 |
| A5 版本号 | ✅ 已修 | README 与 HANDOFF「当前版本」统一到 1.5.0（package.json 为准）；PROJECT_MEMORY / SECURITY_REBUILD 里的历史快照刻意不动 | 脚本校验 README 与 package.json 一致 |

**新发现的小问题（本轮扫描补充，未修）**：`public/js/server.js` 里多处裸 `new URL(...)`（如 L559 `String(value || '')` 空串即抛）产生 `Uncaught (in promise) TypeError: Failed to construct 'URL'`。仅出现在特定环境/入参下，不阻塞启动，属低优先级健壮性问题。

**A2 修复的边界说明**：降级模式下 3D 更新逻辑（animate 循环体）仍会执行 CPU 计算，只是 `renderer.render` 为 no-op —— 属"保命降级"而非"完整 2D 模式"。如需省 CPU，后续可做真正的 2D 分支。
