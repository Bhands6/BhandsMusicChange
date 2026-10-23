# BhandsMusic Next Chat Handoff

更新时间：2026-10-23 ｜ 当前版本：`2.2.7`

## 新对话先执行

```powershell
cd F:\UE\Bhands_Music_Window\BhandsMusic\BhandsMusicChange
git status --short --branch
git log --oneline -8 --decorate
```

按需再读：

| 文档 | 用途 |
|---|---|
| `README.md` | 功能全貌、构建 / 更新机制、数据目录、常见问题 |
| `docs/PROJECT_MEMORY.md` | 历史决策与不可回退的约定 |
| `docs/APP_REORG_PLAN.md` | `public/js/app/*.js` 拆分规则与加载顺序闸门 |
| `docs/INSTALLER_STYLE.md` | 安装包视觉规范（改 `build/installer.nsh` 前必读） |
| `docs/3D_PLAYLIST_SHELF_MEMORY.md` | 3D 歌单架坐标 / 相机历史 |
| `docs/MUSIC_PARSER_WEB_VS_CHANGE.md` | 多音源解析改动边界 |

## 仓库与运行环境

- 源码仓库：`F:\UE\Bhands_Music_Window\BhandsMusic\BhandsMusicChange`
- GitHub：`https://github.com/Bhands6/BhandsMusicChange`（推送用 `git@github.com:Bhands6/BhandsMusicChange.git`）
- 本机安装版：`D:\BhandsMusic\BhandsMusic.exe` —— **跑的是打包产物，不是仓库代码**；改完源码必须重新打包 + 重装才生效
- 上游参考：`F:\UE\Bhands_Music_Window\MineraMusic\Mineradio`（Mineradio 2.2.0，模块化结构，与本仓库的拆分方案不同）
- 用户运行环境：Windows 11 + PowerShell；端到端验收由用户本人完成

## 结构要点

- `desktop/main.js`：Electron 主进程（窗口 / IPC / 托盘 / 更新 / 桌面歌词 / 壁纸 / GPU 守卫）
- `server/server.js`：原生 http 本地服务（端口自动探测 + `/__bhands_identity` 身份校验）
- `public/js/app/*.js`：19 个前端文件，由原 `main.js` 按职责拆分，**加载期读写顺序有基线锁定**
- `public/js/fx-console-workspace.js`：视觉控制台面板注册表（必须早于 `app/*.js` 加载）
- `server/music-sources/`：多音源解析（gdmusic / goMusic / kugou / lxMusic / unblockMusic）

## 提交前必跑的闸门

```powershell
npm test                  # 101 个用例（含更新链路平台感知）
npm run check:hoisting    # 跨 script 函数提升
npm run check:reorg       # 加载期读写顺序等价
```

- 只改函数体 / CSS → `check:reorg` 不会误报
- 新增顶层 `var` / `const` / `function` → 闸门会拦下；确认改动合法后执行
  `node scripts/check-app-reorg.js --write-baseline`，**基线文件与代码同一次提交**
- 视觉 / 交互由用户自己启动软件验收，不要代替用户下"视觉通过"的结论

## 环境坑（本机实测）

- **GitHub 不可达、npmmirror 可达**：仓库 `.npmrc` 已配 `electron_mirror` 与 `electron_builder_binaries_mirror`。`npm start` 报 `Electron failed to install correctly` 时，把 `%LOCALAPPDATA%\electron\Cache\` 里对应版本的 zip 解压到 `node_modules\electron\dist`，并写 `path.txt`（内容 `electron.exe`）
- **打包后 `PROJECT_ROOT` 是 `resources/app.asar`（只读）**：任何"写项目根"的配置都会静默失败。可写数据一律通过 env 注入到 `userData`（cookie / qq-cookie / updates / cuefield-feedback / beat-cache / music-sources）
- 提交中文信息：写 UTF-8 文件后 `git commit -F <file>`，here-string 直接传参会变 GBK
- 关闭本地服务按端口查 PID 杀，Bash 的 SIGTERM 不会带走 node 子进程

## 2026-10-19 已落地

1. **应用图标**换成 BM 金色字母设计（`36aa760` 为旧图标回退点）
2. **首页 hero 兜底图**：`IdleIcon.png` 的品牌字会被 `cover` 裁切 → 改为「清晰 `contain` + 同图模糊铺底 + 上下 16% 渐隐蒙版」；真实每日封面仍走 `cover`
3. **移除全部强制 GPU 开关**（`ignore-gpu-blocklist` 等 7 个）：老核显纹理合成错乱不会触发进程崩溃，原崩溃守卫覆盖不到；保留崩溃降级守卫与 `BHANDSMUSIC_NO_GPU=1`
4. **节拍缓存跨平台**：非 Windows 改 `userData/beatmaps`；此前 `D:\` 会被 resolve 成畸形路径导致缓存静默失效
5. **完整安装包下载加中途体积上限**（已声明大小 + 4MB / 未声明 1GB），超限立即中断
6. **AI 深度模型加载超时**（45s + 120s 冷却），避免 CDN 挂起导致本会话永久失效
7. **酷狗登录凭据落到 `userData/music-sources.json`**：此前打包版写进只读 asar，扫码提示成功但状态永远「未登录」；同时修复登录行圆点永远灰色
8. 版本号 `2.2.3 → 2.2.4`

## 2026-10-20 已落地

1. **macOS 标题栏平台化（用户视觉反馈驱动）**：主窗口 mac 改为 `frame:true + titleBarStyle:'hiddenInset'`，窗口控制全部交给原生交通灯（红=关闭/黄=最小化/绿=全屏），自绘 min/max/close 在 mac 全部隐藏；「?」引导按钮移到标题栏左上角（交通灯右侧）；mac 原生全屏时悬浮自绘按钮整体隐藏。preload 新增 `platform-<platform>` 根类名作为 CSS 平台适配入口
2. **绿灯点了没反应的真正根因（已实证）**：主窗口原来写死 `fullscreen:false`，官方文档明确「显式 false 时 macOS 上全屏按钮会被隐藏或禁用」——与 frameless / 透明背景无关。现 darwin 不传该键（`...(darwin ? {} : {fullscreen:false})`）。Electron 42 实测：`transparent:true + frame:true + hiddenInset` 下 `setFullScreen(true)` 正常，`isFullScreen=true`、bounds 撑满 2560×1440、`enter-full-screen` 事件触发
3. **mac 升级时自动退出应用**：打开 dmg 后 2.5 秒 `app.quit()`（`bhandsmusic-open-update-installer` 返回 `autoQuitInMs`）。此前应用在运行，Finder 拖拽替换会卡在「正在等待其他程序退出 / 结束再运行」，需要用户手动结束进程；面板文案「替换前请先退出当前应用」同步去掉
4. **mac 双架构安装清单合并**：`scripts/merge-latest-mac-yml.js` 按磁盘 dmg 重算 sha512/size，把 arm64 + x64 写进同一份 `dist/latest-mac.yml`（此前每次构建整份覆盖，只剩最后构建的架构，备用更新线路会给错架构）。新增 `npm run build:mac:all` 一键双架构 + 合并
5. **酷狗扫码登录闭环（两处根因，缺一不可）**：① 二维码改用上游 `/login/qr/key` 自带的 `qrcode_img`（编码 `appid=3116`，此前内置 API 重编码的图丢 appid）；② 扫码三条链路（qr/key、qr/create、qr/check）补 `timestamp=` 绕过内置 API 的 2 分钟 apicache——否则首次轮询的「等待扫码」被缓存 2 分钟，扫码成功后轮询仍返回旧 status=1。**扫码必须用酷狗概念版 App**（酷狗音乐标准版平台不匹配，预期失败）；官方登录页用的是 `appid=1014`（网页端），其 web token 与 lite 解析链路平台不通用，不能照抄
6. **退出登录**：登录弹窗底部新增「退出登录」（两次点击确认），已登录时弹窗显示「已登录酷狗概念版」提示块而非二维码；退出后自动关掉「酷狗音源」开关（`disableKugouSourceOnLogout`，与登录自动开启互为反向）
7. **升级弹窗更新内容不再被静默截断**：`extractReleaseNotes` 此前丢弃 >72 字符的行 + 只留 4 条；现改为 >160 字符截断加省略号、条数上限 4 → 6（前后端对齐），列表加滚动上限防撑爆
8. **下载可暂停 / 继续 / 取消**：主按钮下载中点击 = 暂停（保留 `.download` 与进度），暂停中 = 继续（重新测速选线 + `Range` 断点续传），「取消」删除临时文件与进度（`/api/update/download/{pause,resume,cancel}`）。快速补丁是内存缓冲下载，不支持暂停
9. **CNB 国内镜像作为首选下载线路**：候选列表第 0 位插入 `https://cnb.cool/BhandsCnb/BhandsMusic/-/releases/download/BhandsMusic-V<版本>/<同名安装包>`，测速后仍固定第一，失败自动回落 GitHub；`BHANDSMUSIC_UPDATE_CNB_BASE` 可覆盖/置空。**发新版必须在 CNB 建同名 tag 并上传同名资产**
10. 版本号 `2.2.5 → 2.2.6`

## 发布流程

```powershell
# 1. 改版本（package.json / package-lock.json / README 当前版本行）
npm version 2.2.7 --no-git-tag-version

# 2. 跑闸门
npm test; npm run check:hoisting; npm run check:reorg

# 3. 打包
npm run build:win        # 产物在 dist/，含 latest.yml
npm run build:mac:all    # mac：arm64 + x64 依次构建并合并 latest-mac.yml（双架构清单）

# 4. 用户重装验证；真正发布 / 上传资产等用户明确指令
```

## 已知遗留

- **在 mac 上打 win 包必须先手动拉 win 版 go-music-api 二进制**：`node build/fetch-go-music-api.js --platform win32 --arch x64 --force`。`prebuild:win` 未传 `--platform`，该脚本默认跟随主机平台且"存在即跳过"（不校验平台），在 mac 上直接 `npm run build:win` 会把 Mach-O 二进制打进 win 安装包，Windows 上内置换源服务不可用。根治办法是给 `prebuild:win` 补 `--platform win32 --arch x64`（未改，待确认）
- 首页 hero 兜底图目前是「模糊铺底 + 缩小的清晰图」，视觉比原满铺弱一档；彻底解法是重画一张不含文字的兜底图
- 酷狗登录态没有并入顶部账号按钮（`14-account.js` 只聚合网易云 / QQ）
- `docs/PROJECT_MEMORY.md` 中 2026-06 前后的历史条目仍引用 `E:\桌面\播放器软件\...` 旧路径，仅作历史参考
- **macOS 主窗口不要加回 `fullscreen:false`**：会让绿灯全屏失效（官方文档行为），Windows/Linux 保留该键无副作用

## 不要做

- 不要从旧 `dist/`、旧 `node_modules`、旧 packaged build 或历史备份里恢复可执行产物
- 不要用 `git reset --hard` / `git checkout --` 回滚用户改动
- 不要为了跑通测试而删除或放宽闸门（`check:reorg` / `check:hoisting` / `npm test`）
- 不要代替用户执行发布（上传 Release 资产、改 `latest.yml` 等等明确指令）
