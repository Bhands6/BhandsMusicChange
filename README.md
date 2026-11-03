<h1 align="center">
  <span style="background: linear-gradient(90deg, #00f5d4, #00bbf9, #9b5de5, #f15bb5); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-size: 3em;">✦ BhandsMusic ✦</span>
  <br>
  <sub style="color: #888; font-size: 0.4em;">沉浸式音乐播放器 · 粒子视觉 · 3D 歌单架 · 多音源解析</sub>
</h1>

BhandsMusic 是一款沉浸式桌面音乐播放器，把「听歌」做成一个完整的现场：多音源解析兜住曲库，24 种视觉预设随节拍实时生长，3D 歌词舞台与歌单架让界面本身成为演出的一部分。

本项目基于开源项目 [Mineradio](https://github.com/XxHuberrr/Mineradio) 二次开发。

<p align="center">
  <img src="docs/screenshots/00-hero.jpg" width="720" alt="BhandsMusic 启动页"/>
</p>

## 🎬 启动页背景视频

启动页背景为无缝循环视频：「滑雪」随安装包内置，其余 6 条放在仓库 `splash/` 目录按需下载；在「视觉控制台 → 启动页视频」面板可下载、切换、上传本地 MP4，也能关闭水波动效只留视频与文字。

| | | |
|:---:|:---:|:---:|
| ![](docs/screenshots/splash-02-meadow.jpg)<br>**风起草浪** | ![](docs/screenshots/splash-03-vaultra.jpg)<br>**点阵地球** | ![](docs/screenshots/splash-04-neural.jpg)<br>**光纤热核** |
| ![](docs/screenshots/splash-05-lumen.jpg)<br>**暗夜花光**  | ![](docs/screenshots/splash-06-nexum.jpg)<br>**巨木森林**   | ![](docs/screenshots/splash-07-vortx.jpg)<br>**夕阳花海**  |


## ✨ 界面预览

**首页**（未登录 / 登录）

<p align="center">
  <img src="docs/screenshots/home.jpg" width="48%" alt="首页：我的歌单 / 每日推荐 / 继续听 / 听歌画像 / 排行榜">
  <img src="docs/screenshots/01-splash.jpg" width="48%" alt="启动动画">
</p>

## 🌌 视觉效果

播放态共 24 个视觉预设，右键唤出「视觉控制台」即可切换、搜索与收藏；效果由 GLSL 粒子着色器与 InstancedMesh 几何体实时驱动，随音乐节拍与频谱联动：

| | | |
|:---:|:---:|:---:|
| ![](docs/screenshots/02-emily-cover.jpg)<br>**emily专辑封面** | ![](docs/screenshots/03-drum.jpg)<br>**滚筒** | ![](docs/screenshots/04-planet.jpg)<br>**星球** |
| ![](docs/screenshots/05-void.png)<br>**虚空** | ![](docs/screenshots/06-vinyl.jpg)<br>**唱片** | ![](docs/screenshots/07-galaxy.png)<br>**星河** |
| ![](docs/screenshots/08-requiem.png)<br>**安魂** | ![](docs/screenshots/09-sonic-topography.jpg)<br>**音域回响** | ![](docs/screenshots/10-wallpaper-engine.jpg)<br>**音域回响** |
| ![](docs/screenshots/11-aurora.jpg)<br>**极光** | ![](docs/screenshots/12-kaleido.jpg)<br>**万花筒** | ![](docs/screenshots/13-burst.jpg)<br>**迸发** |
| ![](docs/screenshots/14-sonic.png)<br>**声波地形** | ![](docs/screenshots/15-spiral.jpg)<br>**螺旋星云** | ![](docs/screenshots/16-jelly.jpg)<br>**水母花** |
| ![](docs/screenshots/17-rose.jpg)<br>**玫瑰** | ![](docs/screenshots/18-heart.jpg)<br>**心跳** | ![](docs/screenshots/19-rain.png)<br>**字符雨** |
| ![](docs/screenshots/20-audio-ring.jpg)<br>**音浪环阵** | ![](docs/screenshots/21-audio-colonnade.jpg)<br>**音浪回廊** | ![](docs/screenshots/22-pulse-orb.jpg)<br>**声波球壳** |
| ![](docs/screenshots/23-rose-bloom.jpg)<br>**玫瑰花瓣** | ![](docs/screenshots/24-butterfly-swarm.jpg)<br>**蓝光蝶群** | ![](docs/screenshots/25-fish-school.jpg)<br>**深海鱼群** |

### 几何体预设族（18–20）

后三个预设换了渲染路子：不再是满屏粒子，而是用 `InstancedMesh` 摆出上万根实体柱／尖刺，再按频谱做顶点位移、顶面与侧面分离着色。构图分别是「俯视同心环」「沿视线穿行」「球面放射」：

| 预设 | 形态 | 音频映射 | 观感 |
|:---:|---|---|---|
| **音浪环阵**<br>Audio Ring | 三层同心环柱阵，72 / 96 / 120 根共 288 实例；中心圆盘涟漪 + 地面光环 + 顶部辉光 | 内环吃低频、外环吃高频，中频驱动沿环传播的行波；配色由内冷蓝渐变到外暖橙 | 声浪从中心一圈圈向外推开，像站在环形看台中央 |
| **音浪回廊**<br>Audio Colonnade | 46 圈 × 24 根柱环沿 z 轴排成一条纵深隧道（近端 3.0 → 远端 −48.0），柱体朝隧心伸出 | 低频让隧道整体收窄、高频让近处壁面闪烁；冷白柱面 + 暖金端面 | 正面看是放射状光针，像被声音推着往前穿行 |
| **声波球壳**<br>Pulse Orb | 24 × 48 的经纬网格，半径 3.4 的球面上长满朝外尖刺 | 赤道吃低频（整圈隆起）、极区吃高频（尖刺闪烁），鼓点让整体呼吸；上半球冷蓝、下半球暖橙 | 悬浮的音符刺球，冷暖对撞，适合安静段落 |

三者共用一套几何体管线（机位、点尺寸补偿、透明度淡入淡出都对齐音域回响），切换时不会有突兀的镜头跳动。

**玫瑰花瓣（Rose Petals，预设 21）**也在这一族里，但玩的是「飘落」：约 1400 片**参数化花瓣曲面**（宽度 sin 包络 + 杯状凹陷 + 尖端外卷 + 中脉隆起，剪影天然是花瓣，不是长方体）从画面上方纷落，旋转、摇曳、落地循环；深红 → 玫红 → 粉随机分布，远处花瓣压暗做景深。低频让花瓣落得更快、整场呼吸，鼓点踢一脚尺寸与亮度，高频驱动瓣尖颤动。

**蓝光蝶群（Butterfly Swarm，预设 22）**是「背上对镜头」的发光小蝶：56 只低模实体蝴蝶（4 翅面 + 身体 + 头，12 三角）铺满全屏，扑翅全 GPU——翅膀在画面平面内「收拢 ↔ 展开」（18% ↔ 100%），翅缘随展开度泛白光；多彩随机配色 + 加色混合自发光，背景是几何体家族同款星野。个体按参考稿 wander 算法慢速自由飞舞，开场先组成一只大蝴蝶再散开。

**深海鱼群（Fish School，预设 23）**自带一整片**满屏水下光柱水景**：光柱摇曳、水面亮面、底部焦散与光柱内尘埃由一块机位跟随的 shader 背景绘制；30 条程序化小鱼（纺锤体 + 分叉扇尾 + 背/臀/胸鳍，眼睛与鳃盖由着色器点出）按 boids 规则群游——邻域对齐 + 聚合 + 分离、个体 wander、软墙推回，远小暗慢、近大亮快；鱼身在光柱内被照亮、游出光柱压暗，低频加快摆尾与游速，鼓点像一声惊扰把鱼群炸开再聚拢。

## 立即下载

**当前版本：`v2.3.0`** → [点击下载最新版](https://github.com/Bhands6/BhandsMusicChange/releases/latest)

在 Release 页面认准对应平台的文件名：

| 平台 | 下载这个 | 说明 |
|---|---|---|
| **Windows 10 / 11**（x64） | `…-Setup.exe` | NSIS 安装包，支持轻量补丁增量更新 |
| **macOS**（Apple 芯片：M1 / M2 / M3 / M4…） | `…-mac-arm64.dmg` | 拖入「应用程序」即可 |
| **macOS**（Intel 芯片） | `…-mac-x64.dmg` | 拖入「应用程序」即可 |

> **macOS 首次打开被拦截？** 应用为 ad-hoc 签名、未做 Apple 公证，请在「系统设置 → 隐私与安全性」中点击「仍要打开」，或右键应用图标选择「打开」。


## 核心特性

- **多音源解析**：GD音乐台、GoMusic 换源（内置 go-music-api，用酷狗 / 酷我 / QQ / 咪咕官方源兜底）、酷狗音源、LX Music 脚本、UnblockNeteaseMusic 五种第三方音源
- **酷狗会员音质**：扫码或手机验证码登录酷狗概念版后，kugou 策略优先命中会员 FLAC / 320k；凭据持久化在本机用户数据目录，重启不掉登录
- **智能音源选择**：VIP/SVIP 用户优先走官方高质量音源，非 VIP 用户优先走第三方免费音源
- **音质自动降级**：第三方音源尽量使用最高质量（flac），不可用时自动降级到 320k、128k
- **LX Music 脚本支持**：在 worker 沙盒里执行落雪（LX Music）音源脚本，仓库自带[星海 / 全豆要](./lx-scripts/)两份实测可用的脚本，最高可取 24bit/192kHz 母带；档位按文件真实规格判定，不采信脚本自报
- **AI 深度估计**：专辑封面深度图由 `Xenova/depth-anything-small` 在本地推理（首次使用下载约 50MB，可随时关闭；加载失败或超时自动回退启发式边缘，不影响播放）
- **Cuefield AutoMix**：实验性自动过渡（默认关闭），过渡完成后弹出本地反馈卡片，评价只留在本机
- Open-Meteo 天气电台，根据当前位置、城市和天气 mood 生成更合适的播放队列
- 首页包含天气电台、每日推荐、私人电台、继续听、听歌画像和我的歌单入口
- Wallpaper 银河首页背景，未播放状态保持干净的星河氛围
- **启动页背景视频**：内置「滑雪」默认视频，另有 6 条可下载切换，支持上传本地 MP4 与水波动效开关
- 播放后切换到 Emily / 默认播放态视觉，歌词舞台与粒子舞台同步工作
- 基于节奏的电影镜头视觉系统
- 面向长播客和 DJ 曲目的专属视觉模式
- 歌词舞台、自定义歌词、歌词位置与视觉控制；**独立桌面歌词窗口**与**壁纸模式窗口**
- 自定义专辑封面上传与裁剪
- 右键唤起 3D 歌单架，支持歌单队列浏览
- 网易云音乐账号、搜索、歌单、播客等体验接入
- QQ 音乐搜索、登录态与音源补充接入
- GitHub Releases 更新检测与下载入口（Windows 支持轻量补丁增量更新与完整安装包、多线路自动切换；macOS 走完整 dmg）
- **更新下载可暂停 / 续传 / 取消**：暂停保留断点，继续时重新测速选线并断点续传，取消清掉临时文件与进度；国内默认优先走 CNB 镜像
- 跨平台桌面应用：Windows 10 / 11（x64）与 macOS（Apple 芯片 / Intel）双平台安装包
- 首次启动内置「默认测试」视觉用户存档，软件内默认视觉参数与该存档一致



## 🎧 落雪（LX Music）音源脚本

LX Music 脚本是社区里最常见的第三方音源形态：一份 `.js` 文件，通过协议回调向上层交出可直接播放的音频地址。BhandsMusic 在 **worker 线程沙盒**里执行它们（`server/music-sources/lxMusicRunner.js`），只注入 `lx.request` / `lx.fetch` / `lx.utils` / `lx.on` / `lx.send`，脚本碰不到文件系统和 Electron API。

仓库 [`lx-scripts/`](./lx-scripts/) 放了两份 2026-11 实测可用的脚本，导入后即可取到比官方试听更好的音质：

| 脚本 | 版本 / 作者 | 覆盖平台 | 实测表现 |
|---|---|---|---|
| [`xinghai.js`](./lx-scripts/xinghai.js)<br>**星海音乐源** | v3.2.15<br>万去了了 / 科学大魔王 | 网易 / QQ / 酷狗 / 酷我 / 咪咕 / 汽水 | `master` 档 24bit/192kHz FLAC（单曲 100~200MB）；`flac` 档 24bit/44.1kHz（约 46MB）。**唯一能稳定出母带的一份** |
| [`quandouyao.js`](./lx-scripts/quandouyao.js)<br>**全豆要聚合音源** | 9.3<br>全豆要（Toskysun 去混淆） | 聚合星海 / 溯音 / 念心 / 长青，多链路回退 | 无损档可用；`master` 档实际只给 ~128kbps 的 mp3，会被探针识别成 standard 并继续降级 |

### 导入与启用

1. 右键唤出「视觉控制台 → 系统 → 第三方音源」
2. 点「上传脚本」，选 `lx-scripts/xinghai.js`（`.txt` 也接受）
3. 打开 **LX Music** 开关——注意**没有脚本时这个开关是点不亮的**，会提示先导入
4. 导入多个脚本时，点脚本名切换活跃脚本；新导入的脚本**不会**抢占当前在用的那个

也可以直接走接口（应用运行时）：

```bash
node -e "const fs=require('fs');fetch('http://127.0.0.1:3000/api/parse/lx/upload',
  {method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({name:'星海音乐源',script:fs.readFileSync('lx-scripts/xinghai.js','utf8')})})
  .then(r=>r.json()).then(console.log)"
```

### 档位是怎么判定的

脚本自报的 `quality` **不可信**——它可能把 128kbps 的 mp3 标成「母带」。所以每拿到一个地址都会先探一次真实规格（FLAC 读 STREAMINFO 的位深与采样率，有损容器按 `字节 × 8 ÷ 时长` 反推码率）：

| 实测规格 | 判定档位 | 界面显示 |
|---|---|---|
| 24bit 且采样率 ≥ 176.4kHz | `jymaster` | 超清母带 |
| 24bit 且采样率 ≥ 88.2kHz | `hires` | 高清臻音 |
| 其余 FLAC（含 24bit/44.1k、24bit/48k） | `lossless` | 无损 SQ |
| 有损码率 ≥ 900kbps | `lossless` | 无损 SQ |
| 有损码率 ≥ 256kbps | `exhigh` | 极高 HQ |
| 有损码率 ≥ 64kbps | `standard` | 标准 |

注意 24bit/44.1kHz **不算**母带也不算臻音——位深够了但采样率没到，一律按无损标注，避免在音质按钮上夸大。

降级链是 `master → atmos → flac → 320k → 128k`，每档都要求「实测达到目标等级」，达不到就继续降；全都不达标时返回实测最好的那一档（有总比没有强）。两层记忆避免重复踩坑：

- **假档位记忆**：某脚本的某档位被证实给不出高解析，5 分钟内直接跳过（按脚本隔离，换脚本不互相影响）
- **成功缓存**：`歌曲 + 档位 + 活跃脚本` 三维 key，10 分钟内复用；切脚本不会串用上一条结果

另外，脚本活着但返回空（冷门歌确实没资源）算**中性失败**，不会让整个策略进冷却——只有 worker 崩了才计连败。

### 已知限制

- **母带额度按小时 / 天波动**：同一首歌不同时间可能给 24bit/192kHz，也可能全档为空。等几分钟会自动恢复，不需要改配置。
- **音源是消耗品**：这类脚本依赖作者的后端，随时可能失效（长青、ikun、Huibq 等在 2026-11 已不可用）。失效表现是「所有档位返回空」或「返回试听片段」。
- **只有高码率文件**：第三方源通常不提供 128k/320k 的精细档位，选了「标准」也可能拿到整轨 FLAC，流量按实际文件大小算。
- 仅供个人学习与本地试听，请支持正版。

## 开发运行

需要 Node.js 20+ 与 npm（Electron 42 自带 Node 运行时，不需要全局装 Electron）。

```bash
npm ci                   # 按 lockfile 安装依赖（首次推荐）
npm start                # 本地启动（Electron）
npm run start:win        # Windows 启动（额外把控制台代码页切到 UTF-8，避免中文日志乱码）

npm run build:win        # Windows NSIS 安装包（x64）
npm run build:mac        # macOS 安装包（Apple 芯片 / arm64）
npm run build:mac:x64    # macOS 安装包（Intel / x64）
npm run build:mac:dir    # 只解包不做 dmg，便于本地调试
```

仓库自带 `.npmrc`，把 Electron 二进制与 electron-builder 资源指向 npmmirror：

```ini
electron_mirror=https://npmmirror.com/mirrors/electron/
electron_builder_binaries_mirror=https://npmmirror.com/mirrors/electron-builder-binaries/
```

若安装时仍报 `Electron failed to install correctly`，见下方「常见问题」。

桌面版入口由 Electron 主进程加载本地服务，产物统一落在 `dist/`：

| 命令 | 说明 | 产物 |
|---|---|---|
| `build:win` | Windows NSIS 安装包 | `BhandsMusic-<版本>-Setup.exe` + `latest.yml` |
| `build:mac` / `build:mac:x64` | macOS dmg | `BhandsMusic-<版本>-mac-<架构>.dmg` + `latest-mac.yml` |

> 打包前会自动执行对应的 `prebuild:*`：按目标平台与架构拉取内置换源二进制、酷狗 API 与启动动画素材。

## 更新机制

应用启动后会检测 GitHub Releases 上的新版本，两个平台走不同的路径：

| 平台 | 更新方式 |
|---|---|
| **Windows** | 支持「轻量补丁」增量更新与完整安装包两条路径，多线路（含国内镜像）自动切换 |
| **macOS** | 仅支持完整 dmg：应用下载 dmg 后自动打开它、同时打开「应用程序」文件夹，把 BhandsMusic 拖进去覆盖即可 |

> macOS 走手动替换是刻意的：macOS 不允许替换正在运行的 `.app`，未做 Apple 公证的应用也无法静默自更新；而且补丁需要写入已签名的应用包内部，会直接破坏代码签名。因此 macOS 版不提供轻量补丁，发布时也不会上传 `.patch.json`。

### 下载线路与断点续传

完整安装包的下载候选按下面的顺序准备，并在开始前对每条线路做 1MB 探测测速：

| 顺序 | 线路 | 说明 |
|---|---|---|
| 1 | **CNB 国内直连** | `cnb.cool/BhandsCnb/BhandsMusic` 同版本 Release 资产，国内速度最好；即使测速也固定排第一 |
| 2 | 国内加速镜像 | ghfast 等前缀镜像，按实测速度排序 |
| 3 | GitHub 直连 | 兜底 |

下载过程中可以随时控制：

- **暂停**：保留 `.download` 临时文件与已下载字节数，按钮变成「继续下载」
- **继续**：重新测速选线，用 `Range: bytes=N-` 从断点续传；线路不支持 Range 时自动整段重下
- **取消**：终止任务并删除临时文件与进度，之后重新下载是新任务（重新测速选线）

> **发布约定**：每个版本都要在 CNB 建同名 tag `BhandsMusic-V<版本>` 并上传同名资产（`Setup.exe` / 两个 dmg / `latest.yml`）。缺了不会出错——该线路 404 后会自动回落到 GitHub，只是失去国内加速。

## 本机数据存哪里

`userData` 在 Windows 上是 `%APPDATA%\BhandsMusic`，macOS 上是 `~/Library/Application Support/BhandsMusic`。打包后程序目录（`resources/app.asar`）是只读的，所有可写数据都落在 userData：

| 内容 | 位置 |
|---|---|
| 网易云 / QQ 登录 Cookie | `userData/.cookie`、`userData/.qq-cookie` |
| 音源配置（含酷狗会员凭据） | `userData/music-sources.json` |
| 更新包与补丁备份 | `userData/updates` |
| Cuefield 反馈记录 | `userData/cuefield-feedback.jsonl` |
| 浏览器缓存 | `userData/Cache` |
| 节拍分析缓存 | Windows：`D:\BhandsMusicCache\beatmaps`；macOS / Linux：`userData/beatmaps`（可用 `BHANDSMUSIC_BEAT_CACHE_DIR` 覆盖） |

节拍缓存在 Windows 上默认放 D 盘以避开系统盘；机器没有 D 盘时缓存入口会提示不可用，不影响播放。以上路径都不要提交到仓库。

## 常见问题

**`npm start` 报 `Electron failed to install correctly` / `Downloading Electron binary... fetch failed`**

GitHub 不可达时会出现。仓库 `.npmrc` 已把下载源指向 npmmirror；仍然失败时可离线安装：把 `%LOCALAPPDATA%\electron\Cache\` 下对应版本的 zip 解压到 `node_modules\electron\dist`，并在该目录写 `path.txt`（内容为 `electron.exe`）。`dist/win-unpacked` 里也有一份可直接复用的运行时。

**老显卡上粒子 / 3D 视觉错乱（画面整体偏转、文字只显示上半截）**

这是 Chromium 纹理合成问题，不是播放逻辑。应用已不再强制忽略 GPU 黑名单；如仍异常，设置环境变量 `BHANDSMUSIC_NO_GPU=1` 以软件渲染启动（会自动跳过 GPU 相关初始化）。

**打包版登录成功但状态显示未登录 / 重启掉登录**

登录凭据必须写进 userData。确认 `userData/music-sources.json` 存在且可写；主进程启动时会把项目根的旧配置迁移过去一次。

**换了图标但资源管理器里还是旧的**

Windows 会缓存图标，重启资源管理器或重新登录即可；安装包与 exe 的图标由 `build/icon.ico` 决定，必须重新打包才会更新。

## 测试与校验

```bash
npm test                  # 单元测试（node --test，含更新链路平台感知闸门）
npm run check:hoisting    # 跨 script 函数提升校验
npm run check:reorg       # 加载期读写顺序等价校验
```

离屏 Electron 探针（需要本机 Electron 二进制可运行）：

| 命令 | 覆盖范围 |
|---|---|
| `npm run probe:ui` | UI 全量探针（视觉控制台 / 面板 / 取景） |
| `npm run probe:static` | 服务端静态资源暴露范围 |
| `npm run probe:nsis` | `build/installer.nsh` 语法与安装器逻辑 |
| `npm run probe:cuefield-api` / `probe:cuefield-e2e` | Cuefield AutoMix 接口与过渡链路 |
| `npm run probe:parse` | 多音源解析端到端 |

还有几个独立诊断脚本（纯 node，直接运行，结果写到 `scripts/out/*.json`）：

| 脚本 | 覆盖范围 |
|---|---|
| `node scripts/probe-update-pause.js` | 升级下载的暂停 / 取消 / 断点续传（本地清单 + 限速假源，不依赖 GitHub） |
| `node scripts/probe-update-notes.js` | 升级弹窗的更新内容条数与长行折行 |
| `node scripts/probe-kugou-qr.js` / `probe-kugou-logout.js` / `probe-kugou-status.js` | 酷狗扫码弹窗 / 退出登录 / 登录态同步 |

`public/js/app/` 下的 21 个前端文件由原 `main.js` 按职责拆分而来，**加载期读写顺序有基线锁定**（`scripts/reorg/load-order-baseline.json`）。改动其中任何顶层代码后请跑一遍 `npm run check:reorg`，顺序不等价会被直接拦下；新增顶层函数同样会触发该闸门（函数声明哈希只取函数名，改函数体不会误报）。确认是有意的结构调整后，用 `node scripts/check-app-reorg.js --write-baseline` 刷新基线，并在同一次提交里带上基线文件。

## 📁 项目结构

```
BhandsMusicChange/
├── desktop/                          # Electron 主进程
│   ├── main.js                       # 窗口 / IPC / 托盘 / 更新 / 桌面歌词 / 壁纸
│   ├── preload.js                    # 渲染进程安全桥（desktopWindow API）
│   ├── overlay-preload.js            # 桌面歌词 / 壁纸窗口桥
│   ├── go-music-service.js           # 内置换源服务托管
│   ├── local-music-library.js        # 本地音乐库
│   └── system-memory.js              # 系统资源监控
│
├── public/                           # 渲染端（界面 + 视觉）
│   ├── index.html                    # 主界面
│   ├── close-dialog.html             # 关闭确认对话框
│   ├── desktop-lyrics.html           # 桌面歌词独立窗口
│   ├── wallpaper.html                # 壁纸模式窗口
│   ├── default-user-fx-archive.json  # 内置「默认测试」视觉存档
│   ├── js/
│   │   ├── app/                      # 前端主体（原 main.js 按职责拆成 21 个文件）
│   │   │   ├── 00-prelude.js         # 跨 script 函数提升垫片（必须排第一）
│   │   │   ├── 01-state.js           # 全局状态与默认参数
│   │   │   ├── 02-scene.js           # Three.js 场景 / 相机 / 轨道
│   │   │   ├── 03-particles.js       # 粒子几何与着色器
│   │   │   ├── 04-lyrics.js          # 歌词渲染与舞台布局
│   │   │   ├── 05-lyrics-stage.js    # 歌词 3D 舞台（mesh / 纹理 / 光晕）
│   │   │   ├── 06-cover.js           # 专辑封面
│   │   │   ├── 07-beat.js            # 节拍与频谱分析
│   │   │   ├── 08-shelf.js           # 3D 歌单架
│   │   │   ├── 09-api-search.js      # 搜索
│   │   │   ├── 10-audio-queue.js     # 音频与播放队列
│   │   │   ├── 11-playlist.js        # 歌单
│   │   │   ├── 12-fx-console.js      # 视觉控制台
│   │   │   ├── 13-system-panels.js   # 系统面板
│   │   │   ├── 14-account.js         # 账号（网易云 / QQ）
│   │   │   ├── 15-update.js          # 更新检测与下载
│   │   │   ├── 16-idle-toast-libs.js # 空闲态 / 提示 / 第三方库
│   │   │   ├── 17-shell.js           # 窗口外壳（标题栏 / 沉浸式 / 控制按钮）
│   │   │   ├── 18-session-boot.js    # 会话恢复与启动流程
│   │   │   ├── 19-splash-video.js    # 启动页视频库（下载 / 上传 / 选择）
│   │   │   └── 20-window-gesture.js  # 自绘窗口拖动 / 缩放手势（frame:false 下必需）
│   │   ├── web-fx-presets.js         # 9 个 Web 移植粒子预设（GLSL 分支 + 机位表）
│   │   ├── audio-ring-preset.js      # 预设 18 音浪环阵 Audio Ring（三层环形柱阵）
│   │   ├── audio-tunnel-preset.js    # 预设 19 音浪回廊 Audio Colonnade（z 轴环栈隧道）
│   │   ├── audio-orb-preset.js       # 预设 20 声波球壳 Pulse Orb（经纬球面尖刺）
│   │   ├── audio-rose-preset.js      # 预设 21 玫瑰花瓣 Rose Petals（参数化花瓣曲面飘落）
│   │   ├── audio-butterfly-preset.js # 预设 22 蓝光蝶群 Butterfly Swarm（GPU 扑翅自发光蝶群）
│   │   ├── audio-fish-school-preset.js # 预设 23 深海鱼群 Fish School（水下光柱背景 + boids 鱼群）
│   │   ├── sonic-topography-preset.js # 预设 7 音域回响（作者 Ajin，移植自上游）
│   │   ├── sonic-workshop-preset.js  # 预设 8 音域回响（Wallpaper Engine 桥接）
│   │   ├── fx-console-workspace.js   # 视觉控制台面板注册表
│   │   └── cuefield-*.js             # Cuefield 自动混音桥接
│   ├── styles/main.css               # 主样式
│   ├── assets/                       # 图标 / 点云等资源
│   ├── media/                        # 启动动画视频
│   └── vendor/                       # 前端第三方资源
│
├── server/                           # 本地服务
│   ├── server.js                     # HTTP 服务 / 更新 / 音乐接口
│   ├── dj-analyzer.js                # DJ 长曲分析
│   └── music-sources/                # 多音源解析
│       ├── musicParser.js            # 解析编排与失败冷却
│       ├── gdmusic.js                # GD音乐台
│       ├── unblockMusic.js           # UnblockNeteaseMusic
│       ├── lxMusicRunner.js          # LX Music 脚本沙盒
│       ├── kugou.js                  # 酷狗音源
│       ├── kugouService.js           # 内置酷狗 API 服务
│       ├── goMusicSwitch.js          # 换源匹配（防货不对版）
│       └── durationProbe.js          # 时长探测
│
├── cuefield/                         # Cuefield 自动混音内核（规划 / 结构 / 桥接）
├── build/                            # 打包辅助
│   ├── fetch-go-music-api.js         # 拉取内置换源二进制
│   ├── fetch-kugou-api.js            # 拉取酷狗概念版 API
│   ├── fetch-splash-video.js         # 拉取启动动画
│   ├── after-pack.js                 # 打包后处理（含 macOS ad-hoc 签名）
│   ├── installer.nsh                 # NSIS 安装脚本定制
│   ├── icon.icns / icon.ico / icon.png   # 应用图标（macOS / Windows / 通用）
│   └── tray-icon.png（+ @2x）         # 托盘图标（macOS / Linux）
│
├── scripts/                          # 验证探针与闸门
│   ├── probe-*.js                    # 离屏 Electron 实测探针（UI / 取景 / 歌词）
│   ├── check-app-hoisting.js         # 跨 script 函数提升校验
│   ├── check-app-reorg.js            # 加载期读写顺序等价校验
│   ├── create-self-signed-cert.sh    # 本机自签名证书生成（macOS 打包辅助）
│   ├── lib/                          # 公共库（AST 扫描等）
│   └── reorg/                        # 重排基线与迁移工具
│
├── tests/                            # 单元测试（node --test，含更新链路平台感知闸门）
├── lx-scripts/                       # 落雪（LX Music）音源脚本，导入后可取 24bit 母带
│   ├── xinghai.js                    # 星海音乐源 v3.2.15（网易/QQ/酷狗/酷我/咪咕/汽水）
│   └── quandouyao.js                 # 全豆要聚合音源 9.3（星海/溯音/念心/长青多链路回退）
├── docs/                             # 项目文档与界面截图
├── vendor/                           # 构建前按需拉取的内置服务（不入库）
└── dist/                             # 打包产物（NSIS 安装包 / dmg / 更新清单）
```

## 第三方音乐平台说明

BhandsMusic 不是网易云音乐、QQ 音乐或腾讯音乐娱乐集团的官方客户端，也不隶属于任何音乐平台。

项目中的第三方平台接入仅用于个人学习、本地客户端体验和用户自有账号的播放辅助。请遵守对应平台的用户协议、版权规则和会员权益规则。

## 用户数据与隐私

登录 Cookie、搜索历史、自定义封面、自定义歌词、节奏分析缓存等数据只保存在本机用户数据目录或浏览器本地存储中，**不随仓库分发**（`.gitignore` 已排除 `.cookie`、`.qq-cookie`、`.music-sources.json` 等）。具体路径见上方「本机数据存哪里」。


## 版权与授权

Copyright (C) 2026 XxHuberrr.

本项目采用 GPL-3.0 授权。详见 [LICENSE](./LICENSE)。

BM Logo、BhandsMusic 名称、界面视觉设计与原创视觉表达归作者所有；第三方依赖和第三方服务分别遵循其各自授权与服务条款。
