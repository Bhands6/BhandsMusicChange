# 隐私与用户数据说明

BhandsMusic 是本地桌面应用。项目不应把用户登录状态、Cookie、播放历史、搜索历史、自定义封面、自定义歌词或本地缓存提交到 GitHub。

## 本地数据

应用可能在本机保存以下数据：

- 网易云音乐登录 Cookie
- QQ 音乐登录 Cookie
- 搜索历史
- 自定义专辑封面
- 自定义歌词
- 歌词布局与视觉控制设置
- 本地节奏分析缓存
- 更新安装包下载缓存
- 第三方音源配置（`.music-sources.json`）
- LX Music 脚本文件
- 解析缓存（内存中，应用重启后自动清除）

这些数据用于本地体验，不属于开源仓库内容。

## 不应上传的内容

以下内容不应提交到 GitHub：

- `.cookie`
- `.qq-cookie`
- `.music-sources.json`
- `updates/`
- `node_modules/`
- Electron 打包产物
- 用户上传的本地音乐文件
- 用户上传的 LX Music 脚本
- 用户账号信息、Cookie、Token、二维码登录状态

## 第三方平台

用户通过网易云音乐、QQ 音乐等第三方平台登录时，应遵守对应平台的用户协议。BhandsMusic 不提供绕过付费、绕过会员、破解音质或重新分发音乐内容的能力。

## 第三方音源

用户配置的第三方音源（GD音乐台、UnblockNeteaseMusic、LX Music 脚本、自定义 API）仅在本地运行，不会上传到任何服务器。LX Music 脚本在沙盒环境中执行，无法访问 Node.js 原生模块。
