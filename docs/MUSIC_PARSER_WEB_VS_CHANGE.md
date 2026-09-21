# 音源解析逻辑对比：Bhands_Web（Web 版） vs BhandsMusicChange（桌面版）

生成时间：2026-09-20
对比范围：
- Web 版：`BhandsMusic_Web/Bhands_Web/apps/server/src/services/`（`musicParser.ts` / `music-sources/*` / `durationProbe.ts`）+ `routes/music.ts`
- 桌面版：`BhandsMusic/BhandsMusicChange/server/music-sources/*`（`musicParser.js` / `gdmusic.js` / `kugou.js` / `unblockMusic.js` / `lxMusicRunner.js` / `customApi.js` / `durationProbe.js`）+ `public/js/server.js` + `public/js/main.js`

> 背景：桌面版最近两批提交（`b88ce4e` 播放提速批次 1、`258fe04` 移植 Web 版音源探测与竞速编排批次 2）正在把 Web 版的音源逻辑往桌面版搬，所以两边现在是「同源不同步」的状态。

---

## 0. 修复进度（2026-09-20）

已按第八节清单落地以下修改：

| # | 项 | 状态 | 改动位置 |
|---|---|---|---|
| 1 | 垫片回落漏洞 | ✅ 已修 | `musicParser.js` 新增 `isHardRejected` 前置过滤 + `isShimProbe` 探测侧兜底，垫片不再进 `fallback` |
| 2 | GDMusic 子源对齐 | ✅ 已改 | `gdmusic.js`：`['joox','tidal','netease']` → `['netease','joox']` |
| 3 | Unblock 平台对齐 | ✅ 已改 | `unblockMusic.js` `ALL_PLATFORMS`、`server.js` 两处默认值、`.music-sources.json` 均收敛为 `['kugou','kuwo']` |
| 4 | GDMusic 音质档位化 | ✅ 已改 | `musicParser.js` 新增 `gdQualityOf()`；失败缓存 key 也按档位隔离（`gdmusic_{br}`） |
| 8 | 缓存 TTL 收敛 | ✅ 已改 | `musicParser.js`：成功缓存 30 分钟 → 10 分钟 |
| 7 | 优先级注册表说明 | ✅ 已注明 | `musicParser.js` 的 `ParseStrategy` typedef 澄清 priority 在竞速下只影响排序/日志 |
| 5 | LX 沙盒 worker 隔离 | ✅ 已改 | `lxMusicRunner.js` 重写为 worker_threads 沙盒（详见第 6 节） |
| 6 | go-music-api 换源 | ✅ 已改 | 新增 `goMusicSwitch.js` + 接入 `musicParser` 策略链（详见第 9 节） |

验证：
- 音源解析：4 个改动文件 `node --check` 通过；`musicParser` 模块可正常加载；垫片/回落/档位映射共 9 条断言全部通过（含「声明 185KB 垫片不再回落」与「未声明体积但探测出垫片也不回落」两条回归用例）。
- LX 沙盒：`node --check` 通过；30 条断言全部通过，覆盖旧版 IIFE / `module.exports` / 事件式三种脚本格式、音质降级链、`interval` 换算、脚本数量上限、脚本大小上限、`removeRunner`，以及三条安全性用例——**同步死循环**（1503ms 超时返回 null 且主线程心跳持续前进，证明未卡死主进程）、**never-resolve Promise + 永久 setInterval**（超时 terminate）、**一个 runner 被 terminate 不影响其它 runner**。
- go-music-api：`node --check` 通过；mock 契约测试 21 条断言全过（含必填 `source=netease` 参数、`{code,data}` 包装兼容、平台白名单、歌手一致性、离线健康记忆）；**真实服务端到端验证通过**，见第 9 节。

> 关于「超清母带 SVIP 限制」：复查后确认**前端（`main.js:8377`）与后端（`server.js:3148`）是一致的**——非 SVIP 会把 `jymaster` 降级为 `hires`。所以这不是代码 bug，而是 README / PROJECT_MEMORY 里「移除 SVIP 限制」的表述已经过期，建议改文档而不是改代码。

---

## 一、一句话结论

两边已经共用同一套**竞速编排 + 时长/类型探测校验**骨架（`durationProbe` 几乎是逐行移植），但桌面版是**半迁移状态**：骨架搬过来了，Web 版后来补的几个关键修正没跟上，同时还保留了 Web 版已经删掉的旧音源。

---

## 二、整体架构差异

| 维度 | Web 版 | 桌面版 Change |
|---|---|---|
| 语言/模块 | TypeScript + ESM | JavaScript + CommonJS |
| 运行形态 | 独立 Fastify 服务（端口 6628，浏览器访问） | 内嵌 Electron 本地 http 服务（`public/js/server.js`） |
| 解析入口 | `resolveSongUrl()`（官方+第三方统一入口） | `parseMusic()`（只管第三方；官方在 `server.js` 的 `/api/song/url`） |
| 官方/第三方分流 | **服务端**按 `vip` 参数分流 | **前端** `main.js` 的 `shouldPreferThirdPartyParse()` 决定顺序 |
| 音源配置 | 环境变量 + 管理员面板 | `.music-sources.json`（`enabledSources` / `quality` / `unblockPlatforms`…） |

**分流逻辑的具体差异：**

- Web：`resolveSongUrl` 里 `vip ? 官方→第三方 : 官方→(试听则继续)第三方→回落试听`。
- 桌面版：前端三档设置 `sourceParseOrder`（`official` / `third-party` / `auto`，存 localStorage），auto 下还有**会话级官方失败记忆**：VIP 用户官方失败 1 次后本会话切第三方优先（`officialSourceFailStreak`）。这是 Web 版没有的。

---

## 三、编排器：竞速 vs 优先级

| 维度 | Web `tryStrategies` | 桌面版 `parseMusic` |
|---|---|---|
| 执行方式 | **全部策略并发竞速**，第一个「成功 + 通过探测校验」者胜出 | 同样**并发竞速**（批次 2 刚移植） |
| 策略顺序 | 数组顺序只决定启动顺序，按**音质档位**分两套（无损档 gdmusic 优先，有损档 lx 优先） | 保留了**优先级注册表** `priority`（lx 0 / custom 1 / gdmusic 3 / kugou 3.5 / unblock 4），但注释明确说**并发下只影响日志，不影响启动顺序** |
| 策略健康记忆 | 无（只有 per-song failedCache） | 有：`strategyFailStreak` 连败 2 次进 5 分钟冷却，加 100 惩罚值排队尾（并发下同样只记录不生效） |
| 硬拒绝前置 | 有 `isHardRejected()`：声明大小 <400KB 且期望 ≥90s 的候选**直接丢弃且不进宽容回落** | **没有**——见第五节，这是移植缺口 |
| 宽容回落 | 第一个「未通过校验但非硬拒绝」的候选 | 第一个「未通过 `acceptProbe`」的候选（含被大小拒绝的垫片） |
| 成功缓存 | 10 分钟；key = `id_quality_vip_cookieMD5` | 30 分钟；key = `id_排序后的enabledSources` |

> 桌面版优先级注册表现在是「历史遗留的装饰」——迁移时没有把 Web 的「按音质档位决定顺序」逻辑一起搬，而是保留了旧的 priority 字段。

---

## 四、音源清单差异（这是最需要对齐的部分）

| 音源 | Web 版 | 桌面版 Change | 说明 |
|---|---|---|---|
| GDMusic | ✅ 子源 `['netease','joox']`，**tidal 已移除**（实测 0/20） | ✅ 子源 `['joox','tidal','netease']` | **两处不一致**：① 桌面版仍带 tidal（已知全失败，白等超时）；② 顺序把 joox 排在最前（Web 实测 joox 仅 ~20% 命中、netease 100%） |
| LX Music | ✅ `worker_threads` 子线程沙盒 | ✅ 进程内 `vm.createContext` 沙盒 | 隔离强度差一档，详见第六节 |
| go-music-api 换源 | ✅ `goMusicSwitch.ts`（独立 Go 服务，酷狗/酷我/QQ/咪咕官方直链兜底） | ❌ 没有 | 桌面版缺少这一档高质量兜底 |
| UnblockNeteaseMusic | ✅ 平台 `['kugou','kuwo']`（migu/pyncmd 实测 0/20 已移除，kuwo 21% 仅作兜底） | ✅ 平台默认 `['migu','kugou','kuwo','pyncmd']`（`.music-sources.json` 里配的是 `['migu','kugou','pyncmd']`） | 桌面版仍带 migu/pyncmd（Web 实测全失败） |
| 酷狗直连 | ❌ | ✅ `kugou.js`（免登录搜索+128k 播放，移植自上游 Mineradio） | 桌面版独有 |
| 自定义 API | ❌ | ✅ `customApi.js` | 桌面版独有 |

**GDMusic 音质档位处理也不一致：**
- Web：`gdQualityOf(quality)` 按档位传 br（standard→128 / 无损三档→999 / 其他→320）。
- 桌面版：`gdmusicStrategy` 里 **br 写死 `'999'`**，忽略用户请求档位——即使用户选「标准」，也去要无损。

---

## 五、防「货不对版」校验差异（桌面版更严，但有 1 个回归）

### 5.1 歌名匹配
- Web `gdmusic.ts`：`isNameMatched` 用**无长度限制的双向 includes**。
- 桌面版 `gdmusic.js` / `kugou.js`：加了 `expected.length >= 5` / `candidate.length >= 5` 门槛，**短歌名禁止单向包含匹配**（对应提交 `8a0c58f`）。桌面版更严、更正确。

### 5.2 搜索阶段时长硬校验
- Web：`pickBestCandidate` **只校验歌名+歌手，不校验时长**。
- 桌面版 `gdmusic.js` / `kugou.js`：`pickBestCandidate` 内已加时长硬校验 `|Δ| > max(10s, 12%)` 直接拒绝。桌面版更严。

### 5.3 酷狗特有的打分降权（桌面版独有）
`kugou.js` 的 `pickBestCandidate` 额外有：变体降权（`VARIANT_NAME_RE` 命中 Live/翻唱/伴奏/DJ/remix 扣 2 分）、免费曲目 +1、时长接近度 +1/+0.5、搜索排序微加分。

### 5.4 ⚠️ 回归点：垫片「宽容回落」漏洞
- Web `tryStrategies` 有 `isHardRejected`：声明大小 <400KB 且期望 ≥90s 的候选**直接丢弃且不写入 fallback**。注释明确记录了生产事故（2026-09-15「晴天」185KB 广告垫片靠宽容回落漏网）。
- 桌面版 `parseMusic` **没有这层前置过滤**：候选被 `acceptProbe` 因大小拒绝后，仍会 `if (!fallback) fallback = result;` 进入宽容回落，全部策略失败时 `resolve(fallback)` **会把垫片放回去**。
- **即 Web 已修的这个坑，桌面版在移植时又踩回去了。**（`durationProbe.js` 的 `acceptProbe` 里有大小判断，但它返回 `false` 后仍被当成 fallback。）

### 5.5 探测对象不同
- Web：解析器把 URL 包成 `/api/music/stream?url=...`，探测前要用 `upstreamOf()` 剥回上游直链。
- 桌面版：解析器返回**原始上游 URL**，探测直接打原始地址；代理包裹推迟到前端播放时（`main.js:16934` 拼 `/api/audio?url=`）。桌面版这层更简洁。

---

## 六、LX Music 沙盒：隔离强度差一档

> **状态：2026-09-20 已对齐。** 下表左列为 Web 现状，右列为 Change **改造前**的状态；改造后 Change 已按 worker_threads 方案重写 `lxMusicRunner.js`，行为与 Web 一致（差异仅：默认不拦内网地址、脚本存储仍在 `.music-sources.json`，见本节末）。

| 维度 | Web `lxMusicRunner.ts` | 桌面版 Change（改造前） | 桌面版 Change（改造后） |
|---|---|---|---|
| 隔离载体 | `worker_threads` 子线程 | 主进程内 `vm.createContext` | ✅ `worker_threads` 子线程 |
| 死循环/泄漏防护 | `resourceLimits` + 超时 `terminate()` | 只有 `vm` 的 `timeout`，同步死循环卡死整个服务 | ✅ `resourceLimits: 256MB` + 调用超时 `terminate()` |
| 定时器 | 沙盒内登记表，terminate 整体回收 | 直接暴露宿主定时器，无回收 | ✅ 沙盒内登记表 + terminate |
| `lx` API 仿真 | 完整（`EVENT_NAMES`/`currentScriptInfo`/`rawScript`/`utils.crypto`/`zlib`…） | 无 `lx` 对象，只认老式导出 `sources` | ✅ 完整仿真 + 事件式脚本支持 |
| 脚本来源 | 用户上传 + `lx-builtin` 目录 | 仅 `.music-sources.json` | 不变（仍由 `server.js` 管理） |
| 数量/体积上限 | 12 个 / 500KB / 响应体 2MB | 无 | ✅ 12 个 / 500KB / 2MB |
| 音源优先级 | `['wy','kw','kg','tx','mg']` + 事件式 `['wy','kw']` | 无显式优先级 | ✅ 同上 |
| worker 堆上限 | 256MB | — | ✅ 256MB |
| 自愈 | worker 死亡后下次调用自动重建 | — | ✅ 同上 |

两处**刻意保留的差异**：
1. **内网地址拦截默认关闭**。Web 是公网服务，必须拦 SSRF；桌面版是单机自用，用户可能自建 LAN 音源服务，所以拦截做成开关 `BHANDSMUSIC_LX_BLOCK_PRIVATE_IP=1`（开启后与 Web 完全一致）。DNS 解析结果始终被「钉住」（防 rebinding）。
2. **脚本持久化位置不变**：仍由 `server.js` 写 `.music-sources.json`，没有引入 Web 的 `DATA_DIR/lx-scripts.json` + `lx-builtin/` 目录。

另外新增两个可调超时（默认与 Web 一致）：`BHANDSMUSIC_LX_CALL_TIMEOUT_MS`（默认 12000）、`BHANDSMUSIC_LX_INIT_TIMEOUT_MS`（默认 20000）。

---

## 七、其它

| 项 | Web 版 | 桌面版 Change |
|---|---|---|
| 限流 | `limitedByIp` 60 次/分钟（`/song/:id/url`、`/stream`） | 无（本地单机，无必要） |
| 上传鉴权 | `ADMIN_TOKEN`（`assertAdmin`） | 无 |
| 流白名单 | `streamHostAllowlist()` 域名白名单 | 无（`/api/audio` 任意 url 代理） |
| 缓存 key 安全 | 含 cookie MD5 指纹，防他账号复用 VIP 直链 | 无 cookie 概念 |
| 缓存 TTL | 成功 10 分钟（考虑直链 token 时效） | 成功 30 分钟（直链失效风险更高） |
| 超清母带（jymaster） | 对所有用户开放 | `server.js:3148` 仍按 `hasNeteaseSvip` 过滤——**与 README「移除 SVIP 限制」的表述不符，值得复核** |

---

## 八、建议的移植清单（按收益排序）

1. **修回垫片回落漏洞**：在 `musicParser.js` 的 `parseMusic` 里补 `isHardRejected` 前置过滤，被大小拒绝的候选不进 `fallback`。
2. **对齐 GDMusic 子源**：桌面版改为 `['netease','joox']`，移除 tidal（0% 命中，纯浪费超时预算）。
3. **对齐 Unblock 平台**：桌面版收敛为 `['kugou','kuwo']`（或至少把 kuwo 提到 kugou 之后、去掉 migu/pyncmd）。
4. **GDMusic 音质档位化**：`gdmusicStrategy` 按请求档位传 br，别写死 `999`。
5. **LX 沙盒升级**：从 `vm` 换成 `worker_threads`（防脚本同步死循环卡死本地服务），并补 `lx` API 仿真以支持事件式脚本。
6. **考虑引入 go-music-api 换源**：作为 gdmusic 抖动时的高质量兜底（需在桌面版内起/连 Go 服务，成本较高，可后置）。
7. **清理优先级注册表**：既然已改并发竞速，`priority` 字段要么改成「按音质档位决定启动顺序」，要么明确标注为日志用途。
8. **缓存 TTL 收敛**：成功缓存 30 分钟对带时效 token 的直链偏长，建议降到 10 分钟。

---

## 九、go-music-api 智能换源（2026-09-20 已接入）

### 9.1 服务契约（按官方 Swagger 校正，与 Web 版实现有两处不同）

新增 `server/music-sources/goMusicSwitch.js`。服务地址解析优先级：`params.goMusicApiUrl`（配置）> `GO_MUSIC_API_URL`（环境变量）> `http://127.0.0.1:8080`。

| 接口 | 参数 | 响应 |
|---|---|---|
| `GET /api/v1/music/switch` | `name`(必填)、`artist`、**`source`(必填)**、`target`、`duration`(秒) | 200 时**直接返回 `model.Song`**（不包 Response），含 `id` / `source` / `artist` / `size` / `bitrate` / `ext` |
| `GET /api/v1/music/url` | `id`(必填)、`source`(必填) | `handler.Response` → `data.url` / `data.size` / `data.bitrate` |

**与 Web 版实现的差异（Web 的写法有 bug 风险）：**
1. Web 没传 `source`，而 Swagger 标注它是必填（语义是「当前失效的源，服务端会跳过它再换源」）。本实现显式传 `source=netease`（我们的歌曲 ID 来自网易云）。
2. Web 给 `/api/v1/music/url` 传了 `quality`，但官方文档**没有这个参数**（服务端自行取该平台可用最高档）。本实现仍然发送只为向前兼容，服务端会忽略未知参数。
3. 新增**服务健康记忆**：服务不可达时冷却 3 分钟并短路，避免每首歌都白等超时（桌面版这个服务是可选的，Docker 没开时不能拖慢解析）。改配置里的地址会重置健康记忆。

**平台白名单**：只接受 `qq` / `kugou` / `kuwo` / `migu`。`netease` 跳过（官方自己更快）；`bilibili` / `qianqian` / `soda` / `joox` 等未经实测，暂不纳入。

**防「货不对版」**：候选歌手与期望歌手做包含式比对（兼容 `i-dle` vs `(G)I-DLE`），无交集直接丢弃。

**与前置校验联动**：`model.Song.size` / `bitrate` 被透传给 `musicParser`，所以第 0 节的垫片硬拒绝（声明体积 <400KB 且期望 ≥90s）对这个源同样生效。

### 9.2 验证步骤

**① 验证服务本身（在宿主机终端，注意绕开系统代理）**

```bash
# 换源：拿候选（返回 model.Song，需含 id + source）
curl "http://127.0.0.1:8080/api/v1/music/switch?name=晴天&artist=周杰伦&source=netease&duration=269"

# 取直链：把上一步的 id / source 填进去
curl "http://127.0.0.1:8080/api/v1/music/url?source=kuwo&id=<上一步的id>"

# Swagger 交互文档（最直观）
# 浏览器打开 http://localhost:8080/swagger/index.html
```

若 Docker 里服务正常但宿主机连不上，检查端口是否发布：`docker ps` 应显示 `0.0.0.0:8080->8080/tcp`；没发布就补 `-p 8080:8080` 重启容器。

**② 验证本项目集成（一行命令，不启动 Electron）**

```bash
node -e "const g=require('./server/music-sources/goMusicSwitch');(async()=>{console.log('探活=',JSON.stringify(await g.probeService()));console.log('换源=',JSON.stringify(await g.tryGoMusicSwitch({id:186016,name:'晴天',artists:['周杰伦'],duration:269000,quality:'higher'})));})();"
```

**③ 验证完整竞速链 + 音频真实性（推荐）**

把「换源拿到的 URL」再喂给 `durationProbe`，比对探测时长与期望时长——这一步能同时验证「换源匹配正确」和「直链是真实音频」：

```bash
node -e "const g=require('./server/music-sources/goMusicSwitch');const p=require('./server/music-sources/durationProbe');(async()=>{const s={id:186016,name:'晴天',artists:['周杰伦'],duration:269000};const r=await g.tryGoMusicSwitch({...s,quality:'higher'});console.log('换源=',r&&r.source);if(!r)return;const pr=await p.probeAudio(r.url);console.log('探测=',pr.status,'时长=',pr.durationSec,'期望=',s.duration/1000,'通过=',p.acceptProbe(pr,s.duration));})();"
```

**④ 应用内验证**：`npm start` 启动后，服务端监听 `PORT`（默认 3000），直接打解析接口：

```bash
curl -X POST "http://127.0.0.1:3000/api/parse/music" -H "Content-Type: application/json" \
  -d "{\"id\":186016,\"name\":\"晴天\",\"artists\":[\"周杰伦\"],\"duration\":269000,\"quality\":\"higher\"}"
```

返回体的 `source` 字段即命中音源（`gomusic-kuwo` / `gomusic-qq` / `gdmusic-*` / `lx-*` / `kugou` / `unblock-*`）。

### 9.3 实测结果（2026-09-20，本机 127.0.0.1:8080）

| 歌曲 | 命中音源 | 探测时长 | 期望时长 | 文件大小 | 校验 |
|---|---|---|---|---|---|
| 晴天 - 周杰伦 | gomusic-kuwo | 269.8s | 269s | 4.32 MB | ✅ |
| 海阔天空 - Beyond | gomusic-kuwo | 324.9s | 326s | 5.20 MB | ✅ |
| 起风了 - 买辣椒也用券 | gomusic-qq | 325.9s | 325s | 5.22 MB | ✅ |

完整竞速链（按实际 `.music-sources.json` 配置）下，`goMusic` 约 **1.7~1.9s** 胜出，均快于同场的 gdmusic / kugou / unblock。

### 9.4 设置面板 UI（2026-09-20 已加）

设置 → 视觉控制台 → 第三方音源面板内：

- **音源开关**新增「智能换源」开关（`t-src-goMusic`），与其它音源一起存 `enabledSources`。
- 新增 **「go-music-api 换源服务地址」** 输入框（`#go-music-api-url`，留空用默认 `http://127.0.0.1:8080`）+ **「测试连接」** 按钮 + 状态行（`#go-music-api-status`）。
- 「测试连接」由**服务端代探**，走新接口 `GET /api/parse/go-music/status` → `{reachable, status, baseUrl, elapsedMs}` 或 `{reachable:false, error}`。
  - 为什么不让浏览器直连：go-music-api 虽有 CORS 头，但地址可能是内网/容器地址，由服务端探测才准。
  - **探活成功会顺带清掉策略内的「服务离线」冷却**，所以「服务起晚了 → 测试连接」这条路径能立刻恢复可用，不用等 3 分钟。
- 顺带修正了两处过期的开关提示文案（GD音乐台由 `joox/tidal/netease` 改为 `netease/joox`；UnblockMusic 由「咪咕/酷我/酷狗」改为「酷狗/酷我」）。

实测：`GET /api/parse/go-music/status` → `{"reachable":true,"status":200,"elapsedMs":1892}`；配置写入/读回/还原均正常，`lxMusicScripts` 未被覆盖（`POST /api/parse/config` 仍是白名单式合并）。

---

## 十、「货不对版」实战修复：歌词跟曲不对（2026-09-20）

### 10.1 现象与定位

用户反馈歌曲 `2756052140「明天天明」` 播放的曲目与歌词不匹配。日志关键行：

```
[GDMusic] 开始搜索: 明天天明          ← 搜索词里没有歌手！
[Kugou]   开始搜索: 明天天明
[Kugou]   解析成功: 明天天明 - 山清    ← 选中了翻唱版
```

真实数据比对（网易云 + 酷狗实测）：

| 来源 | 歌名 | 歌手 | 时长 |
|---|---|---|---|
| 网易云 2756052140（原曲） | 明天天明 | **海洋Bo** | **213s** |
| 酷狗搜索结果 [7] | 明天天明 | **海洋Bo** | **213s** ← 正确 |
| 酷狗搜索结果 [5] | 明天天明 | 山清 | 215s ← 被选中 |
| 酷狗搜索结果 [0/1/3] | 明天天明 (DJ xxx版) | 海洋Bo、DJ… | 251s / 270s / 234s |

### 10.2 三层根因

1. **歌手参数丢失（根因）**：`artists` 为空 → 所有音源的歌手匹配整条失效。
   - 前端 `tryThirdPartyParse` 只认 `song.ar[i].name`；若 `ar` 是**字符串数组**（或歌手只存在于 `singer`/`artist` 字段），`.map(a => a.name).filter(Boolean)` 会**静默得到空数组**。
   - 服务端从不回查元数据 —— Web 版是在路由层预取 `song_detail` 的，桌面版把这个保障漏了。
2. **打分把正确答案输掉**：酷狗的时长加分是**分段**的（±3s 内都是 `+1`），于是山清（差 2s）与海洋Bo（差 0s）**同分**，最后被「搜索顺序微调」`0.01 × 位置` 翻盘 —— 海洋Bo 以 **4.03 : 4.05** 落败。GD音乐台更彻底：只按 1/2/3 分级，同分时「搜索结果排最前的」胜出。
3. **探测拦不住**：213s vs 215s 只差 2s，远在 `durationProbe` 的 8% 容差内，所以校验会放行（这类近时长错版本来就无法靠时长区分，只能靠歌手匹配 + 打分偏好）。

### 10.3 修复（四处）

| 层 | 文件 | 改动 |
|---|---|---|
| 服务端兜底 | `public/js/server.js` | 新增 `fillMetaFromNetease()`：**歌手为空时**按网易云 ID 回查详情补齐 name/artists/album/duration。触发条件刻意收紧——仅在歌手为空时调用（正常路径零额外延迟）、id 必须是纯数字（QQ mid 是字母数字混合，避免张冠李戴）、详情歌名必须与请求歌名一致。`/api/parse/music` 改为使用补齐后的元数据 |
| 前端容错 | `public/js/main.js` | 新增 `extractArtistNames()` / `extractAlbumName()`：兼容对象数组、**字符串数组**、`singer`/`artist` 单字段、合并串。**刻意不按 `&`/`,` 拆分**（会误伤 `Simon & Garfunkel`），合并串靠服务端双向包含匹配即可命中。歌手为空时打一条 warn 便于排查调用路径 |
| 酷狗打分 | `server/music-sources/kugou.js` | 时长接近度改为**连续打分** `max(0, 1 - diff/12000)`；搜索顺序微调从 `0.01×位置` 降到 `0.001×位置`（只作为完全同分时的稳定排序） |
| GD音乐台打分 | `server/music-sources/gdmusic.js` | 同样加连续时长接近度，让「最接近原曲时长」的候选胜出，而不是「搜索结果里排最前的」 |

### 10.4 验证

- 前端 `extractArtistNames` 单测 8 条全过（字符串数组、合并串、`singer` 字段、含 `&` 歌手名不被拆坏、去重等）。
- 酷狗打分：**传歌手与不传歌手现在选中同一个 hash**（修复前不传时会选到山清），证明打分不再被搜索顺序翻盘。
- 端到端（故意不传 artists，复刻线上请求）：

| | 修复前 | 修复后 |
|---|---|---|
| 搜索词 | `明天天明` | `明天天明 海洋Bo`（服务端已补齐） |
| 酷狗 | 选中山清 215s 翻唱版 | 正确版无免费直链 → **正确失败**，不返回错版 |
| 最终结果 | ❌ 翻唱版 | ✅ `gdmusic-netease`，实际音频 **213.4s = 期望 213.4s** |

传歌手 / 不传歌手两条路径现在结果完全一致。

### 10.5 已知残留（未做，供后续判断）

酷狗免登录只能拿免费曲目，`海洋Bo` 原版是付费曲（privilege=5）→ 酷狗必然失败，改由 gdmusic / goMusic 覆盖。**没有**加「候选逐个重试」：因为严格集里只有这一个候选，加了也救不了这个 case；而放宽重试会把 DJ 版/翻唱版重新放回来，反而危险。若后续要加，重试集必须限制为「歌手集合相同 且 时长落在 max(5s, 2%) 内」。

---

## 十一、内置换源服务：go-music-api 随包分发 + 主进程托管（2026-09-21）

### 11.1 决策

用户希望「不要单独起一个服务」。对比两条路后选定**内置官方预编译二进制 + 主进程托管**：

- ✅ 保留上游 `music-lib` 的匹配质量与后续更新（换二进制即可）
- ✅ 用户侧零配置、不需要 Docker
- ❌ 安装包变大（zip 11.3MB → 解出 exe 31.8MB；NSIS 会再压缩，实际增量接近压缩后体积）
- ❌ 多一个未签名 exe（本项目有过杀软误报史，需留意）

放弃的备选是「用 Node 重写酷我/QQ/咪咕的搜索+直链」：那等于自己实现 4 个平台的签名与防盗链，工作量大、平台一改就失效，长期维护成本高于收益。

### 11.2 关键约束：端口硬编码

上游 `main.go` 是 `r.Run(":8080")`，**没有环境变量也没有命令行参数**。所以不能自由选端口，托管策略只能设计成：

1. 先探测 8080 上是否已有**真的** go-music-api → 是则直接复用（兼容用户自己的 Docker 实例，也避免重复启动）；
2. 不是 → 启动内置二进制（它会绑定 8080）；
3. 启动失败（被别的程序占用 / 二进制缺失）→ 只记日志、不抛错；换源策略自身有健康记忆，会自动跳过该音源。

### 11.3 二进制不入库（遵循项目约定）

`docs/HANDOFF_NEXT_CHAT.md` 明确要求 Git 不跟踪 `.exe/.dll`，且 `.gitignore` 里已有 `*.exe`/`*.zip`。所以二进制改为**构建前按需拉取**：

- 新增 `build/fetch-go-music-api.js`：下载官方 Release → 校验 sha256（写死官方公布的 `ef9c1585…687f5`）→ **纯 Node 解 zip** 取出 exe 写到 `vendor/go-music-api/`。
  - 不调 PowerShell `Expand-Archive`：项目历史路径含中文（`E:\桌面\播放器软件\...`），经 `-Command` 传参会乱码。
  - 带镜像回退（沿用 `package.json` 里既有的镜像约定）：实测直连与 `ghfast.top`/`gh.llkk.cc` 均 `UND_ERR_CONNECT_TIMEOUT`，`gh-proxy.com` 可用。
- `package.json` 加 `prebuild:win` / `prebuild:win:dir` 钩子，`npm run build:win` 会自动先拉取；已存在则跳过（`--force` 强制更新）。
- `.gitignore` 加 `vendor/go-music-api/` 显式说明。
- `files` 与 `asarUnpack` 都加 `vendor/go-music-api/**/*` —— 可执行文件不能留在 asar 虚拟包内，必须解到 `app.asar.unpacked`。主进程用 `toUnpackedPath()` 把 `app.asar` 重写成 `app.asar.unpacked`（已断言 4 种路径形态）。

### 11.4 主进程托管

新增 `desktop/go-music-service.js`（独立模块，便于单测）：

- `isGoMusicApi()`：身份判定，复用 server 层的 `checkService()`，避免两处实现漂移。
- `ensureRunning({exePath, dataDir, logFile})`：复用 / 启动 / 等就绪（15s 上限，400ms 轮询）。
- `stop()`：**只杀自己启动的进程**，不动用户的 Docker 实例；并递增 `epoch` 作废在途的重启定时器。
- 崩溃自动重启：**仅在「曾经就绪过」之后**才重启，上限 2 次。
- `cwd` 设为 `userData/go-music-api/`（服务的 `cookies.json` 与日志都落在这里，不污染安装目录）；`GIN_MODE=release` 关掉 GIN debug 刷屏。
- 就绪时调用 `resetServiceHealth()`：启动期间若有解析请求先打到 8080，会被策略记成「服务离线」冷却 3 分钟，就绪后要清掉。
- `desktop/main.js`：`createWindow()` 里**不 await**（实测就绪约 600ms，不拖慢窗口），`before-quit` 里 `stop()`。

### 11.5 测试中发现并修掉的两个真 bug

**① 身份探测端点选错（严重）**：最初用 `/api/v1/music/switch?name=probe` 探活，实测该请求要 **8.7~10.6s**（对不存在的歌做多平台搜索），远超 3s 超时 → **把已经健康启动的实例误判成"没起来"，然后杀掉并判为启动失败**。

实测各端点耗时后换成两个廉价端点组合：

| 端点 | 耗时 | 用途 |
|---|---|---|
| `/api/v1/system/cookies` | **27ms** | 200 + JSON 对象 |
| `/api/v1/music/url?source=netease&id=1` | 147ms | JSON 且含数字 `code`（handler.Response 形状） |
| `/api/v1/music/switch?name=probe` | **8700ms** | ❌ 不可用于探活 |

改完后冷启动从「15s 超时失败」变成 **590ms 成功**。两个端点都要过，是因为 8080 是常见端口，单看「200 + JSON」容易把占用该端口的无关服务误认成换源服务。

**② 自动重启级联**：`exit` 处理器无条件调度重启，导致启动阶段的失败也会触发重启，日志里出现 3 个进程互相叠加、最终报错原因还变成了「启动超时」。修法：加 `epoch` 代号作废过期定时器 + 只有 `everReady` 之后才允许重启。

**③ 顺带修掉的设计缺陷：超时 ≠ 服务不可用**。原实现里任何异常都会 `markServiceDown()` 冷却 3 分钟。但上游 `/switch` 耗时受**平台网络**影响极大（同一台机器：网络好 ~1.8s，网络差 9.6~10.8s，2026-09-21 实测）。现在超时只记 per-song 失败缓存，不再冷却服务；超时预算也改为可配（默认 switch 8s / url 6s，环境变量 `BHANDSMUSIC_GO_MUSIC_SWITCH_TIMEOUT_MS` / `BHANDSMUSIC_GO_MUSIC_URL_TIMEOUT_MS`）。

同时 `probeService`（UI「测试连接」用的）也换成了同一套廉价端点：从「依赖平台网络、可能 10s 且误报」变成 **约 60ms 稳定可用**。

### 11.6 验证结果

| 用例 | 结果 |
|---|---|
| 冷启动（8080 空闲） | ✅ 590ms 就绪 |
| 幂等（再次 ensureRunning） | ✅ 复用，不重复启动；8080 上仅 1 个进程（`0.0.0.0` + `[::]` 是同一 PID） |
| `checkService()` 探活 | ✅ 62ms 可达 |
| 换源超时后不被冷却 | ✅ 第二次仍真实发起请求（8.0s 而非 0ms 短路），且仍报告可达 |
| 退出清理 | ✅ 8080 释放、无残留进程 |
| 8080 被无关服务占用 | ✅ 不误判、不级联重启 |
| **内置服务端到端换源** | ✅ 4 首歌命中 4 个平台，时长全部吻合（见下表） |

内置服务端到端（当前网络下 `switch` 约 10s，故把超时预算临时放宽到 25s）：

| 歌曲 | 平台 | 探测时长 | 期望 | 大小 |
|---|---|---|---|---|
| 海阔天空 - Beyond | gomusic-kuwo | 324.9s | 326s | 5.0MB |
| 起风了 - 买辣椒也用券 | gomusic-migu | 325.9s | 325s | 5.0MB |
| 晴天 - 周杰伦 | gomusic-kuwo | 269.8s | 269s | 4.1MB |
| 孤勇者 - 陈奕迅 | gomusic-kugou | 256.0s | 256s | 3.9MB |

> 期间还观察到一次「晴天」被上游匹配到**张信哲**的版本，被本项目第 10 节的歌手一致性校验正确拦下 —— 说明那道防线在真实流量里确实在起作用。

### 11.7 已知限制

- **端口写死 8080**：若被无关程序长期占用，内置服务无法启动（会优雅降级，日志可见）。上游如支持端口参数即可解除。
- **当前网络下 goMusic 常输掉竞速**（10s vs gdmusic 2s）：这是网络问题不是代码问题，且输掉不影响正确性；网络正常时约 1.8s 可胜出。
- 二进制为上游 v1.0.1，更新需改 `build/fetch-go-music-api.js` 里的 `VERSION` 与 `ZIP_SHA256`。
