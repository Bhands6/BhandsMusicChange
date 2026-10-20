# BhandsMusic iOS 版 · 移植方案与实施计划

> 文档版本：v1.0 · 2026-10-16
> 目标读者：项目负责人 / 开发执行人
> 结论一句话：**用 Capacitor 把现有 Web 前端包成 iOS App，把本地 Node 服务搬到云端或用户自托管，用原生插件补齐音频后台播放与系统集成。不重写前端，不重写视觉。**

---

## 一、现状盘点（决定方案的事实）

### 1.1 架构分层

```
┌──────────────────────────────────────────────┐
│  Electron 主进程  desktop/main.js  2791 行    │  ← 平台相关，iOS 全部要换
│  窗口/托盘/全局快捷键/桌面歌词/壁纸/更新/本地库 │
├──────────────────────────────────────────────┤
│  渲染层  public/  （纯 Web，无框架）           │  ← ★ 可直接复用
│  index.html 92KB + 19 个 app/*.js 共 ~3.1 万行 │
│  Three.js r128 · GSAP · music-tempo · GLSL    │
├──────────────────────────────────────────────┤
│  本地 HTTP 服务  server/server.js  5397 行    │  ← 搬到云端 / 自托管
│  ~80 个 /api/* 端点（网易云/QQ/酷狗/播客/换源）│
├──────────────────────────────────────────────┤
│  Cuefield 自动混音内核  cuefield/  ~4.7k 行    │  ← 纯 JS，两端都能跑
└──────────────────────────────────────────────┘
```

### 1.2 关键判断依据

| 事实 | 影响 |
|---|---|
| 前端是**纯 Web**（HTML + 原生 JS + Three.js + GLSL），零框架、零 Node 依赖 | ★ 可直接塞进 WKWebView，18 个粒子视觉、3D 歌词舞台、3D 歌单架**无需重写** |
| 前端所有请求都是**同源相对路径**（`fetch('/api/...')`） | ★ 后端换域名即可，前端**不用改一行 API 代码** |
| 后端是**本地 Node HTTP 服务**，`server.listen(PORT)` | 必须外置（云端或用户自托管），iOS 不能跑常驻 Node 进程 |
| `window.desktopWindow` 被引用 **88 处**（preload.js 暴露） | 加一层适配层即可，业务代码不用大改 |
| 桌面专属能力：托盘 / 桌面歌词窗口 / 壁纸模式 / 全局快捷键 / 内存管家 / 增量补丁 | iOS 上**不存在**，需替换或砍掉 |
| `vendor/go-music-api`、`vendor/kugou-api` 是**平台二进制** | iOS 无法运行，必须由服务端承担 |
| 交互重度依赖**右键 / hover / 滚轮 / 拖拽** | 移动端改造的最大工作量在这里 |
| 登录靠 Electron 打开登录窗抓 Cookie | 改用**已有的扫码登录接口**（`/api/login/qr/*`、`/api/kugou/login/qr/*`） |

---

## 二、三条路线对比与选型

| 维度 | **A. Capacitor 包壳** | B. nodejs-mobile 本地跑 | C. SwiftUI 原生重写 |
|---|---|---|---|
| 前端复用 | **100%** | 100% | 0% |
| 18 个 GLSL 视觉 | **直接可用** | 直接可用 | 需全部翻译成 Metal |
| 3D 歌词舞台 / 歌单架 | **直接可用** | 直接可用 | 需重写（SceneKit/Metal） |
| 后端位置 | 云端 / 用户自托管 | 设备内（Node 运行时） | 云端 / 自托管 |
| iOS JIT 限制 | 无影响 | **致命**（只能解释执行，性能腰斩） | 无 |
| Go/二进制换源 | 服务端承担 | **无法运行** | 服务端承担 |
| 后台播放 | 需原生插件 | 需原生插件 | 原生最佳 |
| 性能 / 耗电 | 中（WebGL） | 中低 | 最佳 |
| 上架风险 | 中（取决于功能裁剪） | 高（内置爬取逻辑更敏感） | 低 |
| 工作量 | **13～18 人周** | 16～22 人周 | 40+ 人周 |
| 长期维护 | **单一前端，一份代码** | 双运行时，升级易踩坑 | 双代码库，成本翻倍 |

**选型结论：走 A（Capacitor）。** 理由：这个项目 60% 的价值在视觉层，而视觉层已经是 Web 资产；C 路线的投入产出比极差，B 路线被 iOS 的运行时限制和二进制换源卡死。

---

## 三、目标架构

```
┌───────────────────────── iOS App (Capacitor) ─────────────────────────┐
│                                                                       │
│  WKWebView  ←  public/ 原样复用 + 移动端适配层                          │
│  ┌───────────────────────────────────────────────────────────────┐   │
│  │ public/js/platform/bridge.js    ★ 新增：桥接适配层              │   │
│  │   接口与 desktopWindow 完全一致 → 业务代码 0 改动                │   │
│  │   ├─ window/全屏        → 空实现                                │   │
│  │   ├─ 桌面歌词/壁纸      → 灵动岛 Live Activity                  │   │
│  │   ├─ 本地音乐库         → Capacitor Filesystem + 沙盒           │   │
│  │   ├─ 全局快捷键         → 空实现 / 耳机控制                      │   │
│  │   ├─ 内存管家           → 空实现                                │   │
│  │   └─ 更新               → App Store 更新                        │   │
│  └───────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  原生插件层（Swift）                                                    │
│   ├─ BhandsAudio     AVAudioSession(.playback) + AVPlayer             │
│   │                  + 后台播放 + MPNowPlayingInfoCenter              │
│   │                  + MPRemoteCommandCenter（锁屏/耳机/控制中心）      │
│   ├─ BhandsLyric     Live Activity（灵动岛 + 锁屏歌词，iOS 16.1+）      │
│   ├─ SecureStore     Keychain 存 token                                │
│   ├─ Files           UIDocumentPicker → 沙盒导入本地音乐               │
│   └─ StatusBar/Haptics/Network                                        │
│                                                                       │
└───────────────────────────────┬───────────────────────────────────────┘
                                │ HTTPS
                                ▼
        ┌────────── 模式一：用户自托管 ──────────┐   ┌────── 模式二：官方云 ──────┐
        │ 用户自己的服务器跑 server.js           │   │ 官方托管 API + 多用户隔离   │
        │ App 内填 baseURL                       │   │ 上架版需裁剪第三方换源      │
        │ 合规风险最低 · 成本为零 · 开发量最小    │   │ 体验最好 · 版权风险集中      │
        └────────────────────────────────────────┘   └────────────────────────────┘
```

---

## 四、后端策略（必须先定，影响全局）

现有 `server/server.js` 是**单用户本地服务**：Cookie 存本地、缓存写本地目录、无鉴权、无用户维度。搬到 iOS 前必须做一次「服务化」。

### 4.1 两种形态

| | **模式一：用户自托管** | **模式二：官方云托管** |
|---|---|---|
| 形态 | App 是纯客户端，用户填自己的服务器地址 | 官方跑 API，App 连官方 |
| 后端改造量 | **≈0**（加一个「自定义 baseURL」入口 + CORS） | 大（多用户隔离 + 鉴权 + 限流 + 存储） |
| 版权/合规 | 换源逻辑在用户自己的机器上，App 本身只做播放器 | **风险全部集中在官方** |
| 上架可行性 | 中（类比 VLC / Infuse 这类「连你自己服务器的播放器」） | 低（上架版必须裁剪换源） |
| 成本 | 0（用户自己出） | 服务器 + 带宽 + 流量 |
| 适合 | 个人自用、技术用户、小圈子分发 | 面向大众 |

**建议：以模式一为主线，模式二作为后续可选。** 原因是它同时把「开发量」「成本」「版权」三个最大风险一起按下去了。

### 4.2 服务化改造清单（若走模式二）

- [ ] 路由前置鉴权中间件：`/api/*` 校验 `Authorization: Bearer <token>`（`/api/app/version`、`/api/login/*` 白名单放行）
- [ ] 用户会话隔离：网易云/QQ/酷狗 Cookie 按 `userId` 加密落库（AES + 独立密钥），不再写单例内存
- [ ] 缓存分层：`/api/beatmap/cache`、封面、音频代理的缓存 key 全部加 `userId` 前缀；音频代理走对象存储 + CDN
- [ ] 限流与防滥用：`/api/parse/music`（换源，最贵）、`/api/search`、`/api/song/url` 分别限流；异常流量熔断
- [ ] 登录改造：**废弃「打开登录窗抓 Cookie」，改用项目已有的扫码登录**（`/api/login/qr/key|create|check`、`/api/kugou/login/qr/*`），服务端拿 Cookie 并返回 token 给客户端
- [ ] 部署：Docker 镜像 + 反向代理（Nginx/Caddy）+ HTTPS + 健康检查 `/__bhands_identity`
- [ ] 配置外置：`GO_MUSIC_API_URL`、代理、缓存目录全部走环境变量

---

## 五、前端改造清单（按文件）

> 原则：**业务逻辑不动，只改「壳」和「交互」**。所有平台差异收敛到新增的 `public/js/platform/` 适配层。

### 5.1 新增

| 文件 | 作用 |
|---|---|
| `public/js/platform/bridge.js` | 平台桥：按 `window.Capacitor` 是否存在，注入 `iosBridge` 或复用 `desktopWindow`，**接口签名完全一致** |
| `public/js/platform/audio-native.js` | 把 `new Audio()` 换成原生播放器代理，保留同一套事件（`timeupdate`/`ended`/`loadedmetadata`） |
| `public/js/platform/gestures.js` | 统一触摸手势：长按 = 右键、双指 = 缩放、下滑 = 关闭抽屉 |
| `public/js/styles/mobile.css` | 移动端覆盖样式：safe-area、底部导航、触摸目标 ≥44pt、全屏沉浸 |

### 5.2 修改（按工作量排序）

| 文件 | 行数 | 改造内容 | 工作量 |
|---|---|---|---|
| `17-shell.js` | 1982 | 自定义标题栏 → 移除；`Resize` → `visualViewport`；快捷键 → 触摸；splash 适配竖屏 | **高** |
| `12-fx-console.js` | 2522 | 右键唤出 → 长按/悬浮按钮；面板 → 全屏底部抽屉；滑块改触摸拖拽 | **高** |
| `08-shelf.js` | 2503 | 3D 歌单架：滚轮/鼠标拖拽 → 触摸手势；卡片尺寸按屏宽自适应 | **高** |
| `10-audio-queue.js` | 1590 | `new Audio()` → `audio-native.js`；补后台播放状态机；`AudioContext` 需用户手势解锁（iOS 强制） | 中 |
| `index.html` | 92KB | 移动端结构：底部导航、safe-area 容器、移除桌面壳容器 | 中 |
| `styles/main.css` | 232KB | 响应式断点、hover 样式降级为 `:active`、滚动惯性 | 中 |
| `02-scene.js` / `03-particles.js` | 3875 | `setPixelRatio(min(dpr, 2))`、粒子数分级、预设白名单（见 §7） | 中 |
| `14-account.js` | 818 | 登录 → 扫码流程 UI；会员态展示调整 | 中 |
| `13-system-panels.js` | 599 | 砍掉内存管家/输出设备；新增「服务器地址」配置 | 低 |
| `15-update.js` | 636 | 移除补丁/安装包逻辑，改「跳 App Store」 | 低 |
| `16-idle-toast-libs.js` | 1221 | 引导文案改触摸版；`contextmenu` 监听改长按 | 低 |
| `18-session-boot.js` | 1228 | 启动序列适配（启动视频 22MB 需考虑体积/首帧） | 低 |
| `04/05/06/07/09/11` | 9500+ | 基本不动，仅个别尺寸常量 | 低 |

### 5.3 桌面能力映射表

| 桌面功能 | iOS 处理方式 |
|---|---|
| 桌面歌词独立窗口 | → **灵动岛 Live Activity + 锁屏歌词**（iOS 16.1+），加分项 |
| 壁纸模式窗口 | → 无对应能力，砍掉 |
| 系统托盘 / 菜单栏 | → 无，砍掉 |
| 全局快捷键 | → 无；可用 Siri 快捷指令 / 耳机线控替代 |
| 内存管家 | → 无，砍掉 |
| 增量补丁更新 | → App Store 自动更新 |
| 自定义标题栏 | → 移除，改用安全区 + 沉浸模式 |
| 右键菜单 | → 长按（`touchstart` 长按 500ms 触发 `contextmenu`） |
| hover 态 | → `:active` / 首次点击展示 |
| 滚轮 | → 触摸滚动 / 双指 |
| 本地文件绝对路径 | → `UIDocumentPicker` 导入沙盒 + Capacitor Filesystem |
| `go-music-api` / 酷狗二进制 | → 由服务端承担（App 侧完全不需要） |

---

## 六、iOS 工程骨架

```
ios/                                  # 新增，Capacitor 工程
├── App/
│   ├── App.xcodeproj
│   ├── App/
│   │   ├── Info.plist               # UIBackgroundModes: audio / NSMicrophoneUsageDescription
│   │   ├── capacitor.config.json    # 指向打包进 bundle 的 public/
│   │   └── Plugins/
│   │       ├── BhandsAudio.swift     # AVPlayer + AVAudioSession + NowPlaying + RemoteCommand
│   │       ├── BhandsLyric.swift     # Live Activity（灵动岛/锁屏）
│   │       ├── SecureStore.swift     # Keychain
│   │       └── BhandsFiles.swift     # 本地音乐导入
│   └── Podfile
└── README.md
```

关键 `Info.plist` 项：

```xml
<key>UIBackgroundModes</key>
<array><string>audio</string></array>
<key>NSMicrophoneUsageDescription</key>
<string>用于音频可视化与 DJ 分析功能采集音频输入。</string>
<key>NSLocalNetworkUsageDescription</key>
<string>用于连接你自建的 BhandsMusic 服务器。</string>
```

### 音频方案要点（最容易踩坑）

1. **必须用原生播放器**。WKWebView 里的 `<audio>` 进入后台会被系统挂起，`AudioContext` 也会被中断 → 后台播放 + 锁屏控制必须走 `AVAudioSession(.playback)` + `AVPlayer`。
2. **`AudioContext` 需要用户手势解锁**。iOS 上 `AudioContext` 初始为 `suspended`，必须绑定到真实的点击事件里 `resume()`，否则频谱/节拍分析静默失效。
3. **节拍分析链路要保住**。`07-beat.js` 依赖 `decodeAudioData` 做离线预解析，原生播放器需把音频数据回灌给 Web 层（走本地代理 URL 或分块传给 JS）。
4. **锁屏元数据**：`MPNowPlayingInfoCenter` 填标题/艺术家/封面/时长/进度；`MPRemoteCommandCenter` 接管播放/暂停/上下曲/快进。
5. **音频中断与路由**：来电、拔耳机要正确 pause/resume（`AVAudioSession.interruptionNotification`、`routeChangeNotification`）。

---

## 七、性能与功耗策略

iPhone GPU 跑「18 个 GLSL 粒子 + 3D 歌词舞台 + 3D 歌单架 + 频谱」是重负载，必须有分级。

| 措施 | 具体做法 |
|---|---|
| 渲染分辨率 | `renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))`，低端机降到 1.5 |
| 粒子数分级 | 按 `navigator.deviceMemory` / 首帧耗时动态降档（如 20 万 → 8 万 → 4 万） |
| 预设分级 | 重预设（星河/极光/万花筒/螺旋星云）标记为「高负载」，低端机默认隐藏或降采样 |
| 帧率 | 低电量模式 / 后台 → 降到 30fps 或暂停渲染循环（`visibilitychange`） |
| 离屏优化 | 不可见时停 `requestAnimationFrame`；歌词舞台纹理按需重建 |
| 包体积 | `public/media` 启动视频 22MB 是最大头，考虑压缩为 H.265 或改为首帧静态图 + 短动画 |

---

## 八、合规与分发（最大风险，必须提前决策）

### 8.1 风险本质

项目核心卖点之一是「**多音源解析**」：GD音乐台、UnblockNeteaseMusic、LX Music 脚本，本质是**绕过官方会员限制获取版权音乐**。同时项目不是任何平台的官方客户端。

- App Store 审核：极高概率被拒（Guideline 5.2.1 第三方内容、5.2.3 知识产权、4.7）。官方声明「非官方客户端」不构成免责。
- 版权方投诉风险：应用公开分发后可能收到 DMCA / 律师函。

### 8.2 双轨分发策略（建议）

| 轨道 | 目标 | 功能 | 渠道 |
|---|---|---|---|
| **轨道 A · 完整版** | 自用 + 小圈子 | 全功能（含第三方换源、多音源解析） | TestFlight 内测 / Ad Hoc 自签（AltStore、Sideloadly）/ 自托管后端 |
| **轨道 B · 上架版** | App Store 公开 | 裁掉第三方换源：只保留「用户自有账号的官方音源 + 本地音乐库 + 视觉播放器 + 自托管服务器」 | App Store |

> 关键：**代码库保持一份**，通过构建开关（`BUILD_CHANNEL=appstore|full`）控制是否加载 `server/music-sources/*` 与「第三方音源」设置面板。

### 8.3 分发渠道对比

| 渠道 | 名额 | 有效期 | 成本 | 适用 |
|---|---|---|---|---|
| TestFlight | 1 万测试员 | 每版本 90 天 | $99/年 | 内测、小圈子（推荐起点） |
| Ad Hoc | 100 台设备 UDID | 1 年 | $99/年 | 固定设备自用 |
| AltStore / Sideloadly 自签 | 无限 | 7 天（需重签） | 免费 / $99 | 极客自用 |
| App Store | 无限 | 永久 | $99/年 | 需裁剪功能 |
| 企业分发 | 无限 | 1 年 | $299/年 | 需企业资质，违规会被吊销，不建议 |

---

## 九、分阶段实施计划

| 阶段 | 目标 | 交付物 | 工期 |
|---|---|---|---|
| **P0 · 决策** | 锁定分发路线与后端形态 | 本文档确认版 + 功能裁剪清单 | 3 天 |
| **P1 · 可行性验证** | 证明「粒子视觉能跑 + 后台能播 + 能连上服务端」 | Capacitor 空壳 + WebGL 预设跑通 + 原生音频后台播放 Demo + 自托管后端连通 | **2 周** |
| **P2 · 前端移动化** | 竖屏 UI 可用、触屏交互替换完毕 | 移动端布局 + 手势层 + FX 控制台移动版 + 3D 歌单架触摸化 | **4～5 周** |
| **P3 · 原生能力** | 后台播放、锁屏控制、扫码登录、本地音乐导入 | `BhandsAudio` / `BhandsLyric` / `SecureStore` / `BhandsFiles` 四个插件 + 登录流程 | **3～4 周** |
| **P4 · 后端服务化** | （模式二才需要）多用户隔离 + 鉴权 + 限流 + 部署 | 服务化版 server + Docker + 线上环境 | **2～3 周** |
| **P5 · 性能与打磨** | 发热/耗电达标、包体积达标 | 性能分级策略 + 启动优化 + 崩溃/卡顿监控 | **2 周** |
| **P6 · 分发** | TestFlight 内测 → （可选）App Store | 上架版构建 + 隐私清单 + 审核材料 | **2～3 周** |

**合计：约 13～18 人周**（单人全职 ≈ 3.5～4.5 个月；两人并行 ≈ 2～2.5 个月）

### P1 里程碑验收标准（最关键的一道闸）

- [ ] Capacitor 工程能在真机（非模拟器）跑起来
- [ ] 18 个粒子预设中至少 5 个在 iPhone 上稳定 ≥30fps
- [ ] 3D 歌词舞台与 3D 歌单架正常渲染、触摸可交互
- [ ] 音频能在**锁屏后继续播放**，锁屏界面显示歌曲信息与进度
- [ ] App 能连上外部服务端并成功搜索、播放一首歌
- [ ] 已测量：冷启动时间、内存峰值、10 分钟播放耗电

> 若 P1 出现「粒子视觉性能不可接受」或「后台播放无法稳定」，立即止损，回到方案评审，不要进入 P2。

---

## 十、风险矩阵

| 风险 | 等级 | 影响 | 缓解措施 |
|---|---|---|---|
| **版权 / 上架被拒** | 🔴 高 | 项目无法公开分发 | 双轨策略（§8.2）；上架版裁剪换源；完整版走 TestFlight/侧载 |
| **第三方接口变更/封禁** | 🟠 中 | 换源失效 | 服务端集中适配（已有 `musicParser` 冷却机制）；多音源互备 |
| **云服务成本 / 被滥用** | 🟠 中 | 成本失控 | 主推自托管模式；云端做限流 + 熔断 + 用户配额 |
| **WebGL 性能 / 发热** | 🟠 中 | 体验差、被系统杀 | 分级策略（§7）；低电量降帧；重预设白名单 |
| **后台播放被系统挂起** | 🟠 中 | 核心体验失败 | 原生 `AVAudioSession` + `UIBackgroundModes` + 真机长测 |
| **前端 50k 行迁移回归** | 🟠 中 | 桌面版被改坏 | 桥接适配层隔离平台差异；桌面版保持为 CI 基线；`npm run check:reorg` 继续守门 |
| **登录 Cookie 迁移** | 🟡 低 | 登录态丢失 | 改用已有扫码登录接口，token 存 Keychain |
| **Apple 审核周期** | 🟡 低 | 上线延迟 | 先走 TestFlight，审核并行准备 |
| **账号与费用** | 🟢 低 | — | Apple Developer $99/年；云服务器约 ¥100～300/月 |

---

## 十一、成本估算

| 项目 | 费用 |
|---|---|
| Apple Developer Program | $99 / 年 |
| 云服务器（模式二，2C4G + 带宽） | ¥100～300 / 月 |
| 对象存储 + CDN（音频/封面代理） | 按量，初期 < ¥50 / 月 |
| 域名 + SSL | ¥50～100 / 年 |
| 人力 | 13～18 人周 |

---

## 十二、下一步行动（本周）

1. **决策**：确认分发路线（TestFlight 先行？是否做上架版？）与后端形态（自托管 / 官方云）。
2. **建骨架**：`npm i @capacitor/core @capacitor/cli @capacitor/ios` → `npx cap init` → `npx cap add ios`。
3. **跑 P1 验证**：把 `public/` 打进 bundle，真机验证 WebGL 视觉与音频链路。
4. **定裁剪清单**：列出上架版要移除的模块（`server/music-sources/*`、「第三方音源」面板、`15-update.js` 的补丁逻辑）。
5. **写适配层**：先落 `public/js/platform/bridge.js` 的空实现，让桌面版与 iOS 版共用同一套接口。
