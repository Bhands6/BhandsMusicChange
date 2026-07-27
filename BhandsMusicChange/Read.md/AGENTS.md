# BhandsMusic Project Rules

## Project Identity

BhandsMusic 是 Windows Electron 桌面音乐播放器，核心体验包括搜索、播放、歌单、歌词、3D 歌单架、粒子视觉预设、DIY 视觉控制台、多音源解析和 GitHub 自动更新。


- GitHub 仓库：`https://github.com/Bhands6/BhandsMusicChange.git`
- 当前源码版本：`v1.4.0`


## Start Every New Codex Thread Here

新对话开始处理 BhandsMusic 前，读这些文件：

- `AGENTS.md`
- `docs/PROJECT_MEMORY.md`
- 涉及玻璃 SVG 质感时读取 `docs/GLASS_SVG_TEXTURE.md`
- 涉及发布时读取 `CHANGELOG.md`、`RELEASE.md`、`package.json`
- 涉及音源解析时读取 `server/music-sources/musicParser.js`

## Repository Layout

```text
BhandsMusic/resources/app/
├─ public/
│  ├─ index.html           # 主 UI、CSS、歌词、粒子、3D 歌单架、视觉控制台
│  ├─ js/
│  │  ├─ main.js           # 前端主逻辑（播放、WebAudio、节拍分析、歌词、3D 可视化）
│  │  ├─ server.js         # 本地 API、音乐源、更新检查、补丁应用
│  │  └─ dj-analyzer.js    # 播客 DJ 节拍分析（mpg123-decoder）
│  ├─ styles/main.css      # 全局样式
│  └─ vendor/              # 本地 vendor 依赖（three.js, gsap, music-tempo）
├─ desktop/
│  ├─ main.js              # Electron 主进程（窗口管理、桌面歌词、壁纸模式）
│  └─ preload.js           # contextBridge 暴露 IPC
├─ server/
│  └─ music-sources/       # 多音源解析模块
│     ├─ musicParser.js    # 策略编排器（优先级、缓存、统一入口）
│     ├─ gdmusic.js        # GD音乐台解析（joox/tidal/netease 搜索匹配）
│     ├─ unblockMusic.js   # UnblockNeteaseMusic（咪咕/酷我/酷狗/pyncmd）
│     ├─ lxMusicRunner.js  # LX Music 脚本沙盒执行器（vm 模块）
│     └─ customApi.js      # 自定义 API 解析
├─ build/                  # 打包资源和 installer 脚本
├─ docs/                   # 项目记忆、设计偏好、长期约束
├─ package.json            # 版本号、构建命令、electron-builder 配置
└─ CHANGELOG.md            # 中文更新说明优先写在顶部
```

## Architecture

### 三层架构

1. **Electron 主进程** (`desktop/main.js`)：窗口管理、平台登录、桌面歌词
2. **Node.js HTTP 服务** (`server.js` + `server/music-sources/`)：API 代理、音频代理、多音源解析
3. **浏览器渲染层** (`public/js/main.js`)：播放、WebAudio、节拍分析、3D 可视化

### 播放流程

```
播放歌曲
    │
    ├── ① tryThirdPartyParse() → /api/parse/music
    │     ├── LxMusic (优先级 0)
    │     ├── 自定义 API (优先级 1)
    │     ├── GD音乐台 (优先级 3)
    │     └── UnblockMusic (优先级 4)
    │
    ├── ② 官方 API（网易云/QQ音乐）
    │
    └── ③ tryAutoPlaybackFallback() → 跨平台搜索替换
```

VIP/SVIP 用户：官方 API 优先 → 第三方 → 跨平台换源
非 VIP 用户：第三方优先 → 官方 API → 跨平台换源

### 音质策略

- 用户可选择：超清母带 / 高清臻音 / 无损 SQ / 极高 HQ / 标准
- 第三方音源尽量使用最高质量，自动降级（LX Music: flac → 320k → 128k）
- GD音乐台使用 `br=999` 请求最高可用质量
- 所有音源对所有用户开放，无 SVIP 锁定

## Commands

```powershell
npm start                       # 启动应用
node --check public/js/server.js  # 检查 server.js 语法
node -c public/js/main.js       # 检查前端 JS 语法
npm run build:win:dir           # 构建目录版
npm run build:win               # 构建安装包
```

前端主逻辑在 `public/index.html`。这个目录是正在运行的 `BhandsMusic.exe` 使用的 app 目录，所以改完后重启外层 `E:\桌面\播放器软件\BhandsMusic\BhandsMusic.exe` 就能及时检查效果。没有独立 npm test，改动后至少做：

注意：运行版 `resources\app\node_modules` 可能只包含运行依赖。如果发布打包时缺少 `electron-builder`，先在 `E:\桌面\播放器软件\BhandsMusic\resources\app` 执行 `npm install`，再执行 `npm run build:win`。

```powershell
git diff --check
node --check server.js
```

并用实际 Electron 或浏览器检查关键交互。

## Multi-Source Music Parsing

### 添加新音源策略

在 `server/music-sources/musicParser.js` 中：

1. 创建策略对象（实现 `name`、`priority`、`canHandle`、`parse`）
2. 添加到 `ALL_STRATEGIES` 数组
3. 如需新模块，在 `server/music-sources/` 下创建并 `require`

### API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/parse/music` | POST | 统一音源解析 |
| `/api/parse/config` | GET/POST | 获取/更新音源配置 |
| `/api/parse/lx/upload` | POST | 上传 LX Music 脚本 |
| `/api/parse/lx/list` | GET | 获取脚本列表 |
| `/api/parse/lx/delete` | POST | 删除脚本 |
| `/api/parse/cache/clear` | POST | 清除解析缓存 |

### 缓存机制

- 成功缓存：30 分钟（按歌曲 ID + 音源配置）
- 失败缓存：1 分钟（按歌曲 ID + 策略名）
- 配置变更自动失效

### 依赖

- `axios` — HTTP 请求（GD音乐台、自定义 API）
- `@unblockneteasemusic/server` — 多平台音乐匹配
- Node.js `vm` 模块 — LX Music 脚本沙盒执行

## Release Workflow

发布新版本时：

1. 更新 `package.json` 和 `package-lock.json` 版本号。
2. 更新 `CHANGELOG.md` 顶部中文说明。
3. 运行语法/空白检查。
4. 执行 `npm run build:win`。
5. 上传 GitHub Release 资产：
   - `dist/BhandsMusic-x.y.z-Setup.exe`
   - `dist/BhandsMusic-x.y.z-Setup.exe.blockmap`
   - `dist/latest.yml`
   - 需要的 `BhandsMusic-旧版本-x.y.z.json` 轻量补丁
6. 0.9 系列补丁跳过；1.0.x 系列可按需生成跨小版本补丁。

GitHub CLI / `gh auth` / Release 上传需要代理时，优先使用可用本机代理 `127.0.0.1:10808`；不要再走旧代理 `127.0.0.1:26001`，该端口会连接拒绝。临时命令可先清空 `HTTP_PROXY`/`HTTPS_PROXY`，再设为 `http://127.0.0.1:10808`。

## User Preferences

- 交流语言：中文。
- 用户偏好：少废话，直接做，修完验证，能发布就一起发布。
- UI 审美：精致、暗色、高级、流畅，拒绝廉价渐变、过度透明、错位、闪烁和卡顿。
- 视觉质量定义：质感、丝滑度、帧数稳定同时成立；性能优化不能牺牲既有质感。
- 玻璃质感：当前播放器 SVG 玻璃质感是黄金版本，详见 `docs/GLASS_SVG_TEXTURE.md`。
- 备份策略：不要删除旧资料；重复和历史内容移动到 `E:\桌面\播放器软件\工作区备份`。
- 重要：不要再改旧外层源码目录。旧的 `E:\桌面\播放器软件\BhandsMusic\public` / `desktop` 已经归档；现在只有 `E:\桌面\播放器软件\BhandsMusic\resources\app\public` / `desktop` 会影响运行版。

## Memory Protocol

当用户说”保留””这个做得很好””我喜欢””记住这个””保存一下””以后别忘了”或同类表达时：

1. 判断用户认可的是代码、视觉效果、交互流程、发布流程还是工作习惯。
2. 将结论追加到 `docs/PROJECT_MEMORY.md` 的对应区块。
3. 如果是玻璃 SVG、粒子预设、3D 歌单架等脆弱视觉实现，同时更新对应专项文档。
4. 记录日期、涉及文件、关键参数、不要再改坏的边界。
5. 如果本轮有代码提交，把记忆文档一起提交；如果只是记忆整理，单独提交也可以。

## Guardrails

- 不要随意重写 `public/index.html` 的大块视觉系统；先定位已有函数和状态。
- 不要动电影视觉系统，除非用户明确点名。
- 不要恢复旧的侧边栏闪烁、控制台播放暂停失效、3D 歌单架强制切回星河等问题。
- 不要把搜索结果、左侧歌单、3D 歌单架的性能优化做成一次性渲染全部内容。
- 不要把用户认可的玻璃质感改成普通毛玻璃或廉价透明面板。
- 修改音源解析策略时，不要破坏缓存机制和策略优先级。
- LX Music 脚本在沙盒中运行，不要给脚本暴露 Node.js 原生模块。
