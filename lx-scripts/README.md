# 落雪（LX Music）音源脚本

这个目录放两份**实测可用**的落雪音源脚本，供 BhandsMusic 的 LX Music 沙盒加载。

> 脚本由第三方作者编写，仅用于个人学习与本地试听。它们依赖各自作者或公开聚合服务的后端，随时可能失效；请支持正版。

## 文件

| 文件 | 名称 | 版本 / 作者 | 特点 |
|---|---|---|---|
| `xinghai.js` | 星海音乐源 | v3.2.15 · 万去了了 / 科学大魔王 | 声明支持网易 / QQ / 酷狗 / 酷我 / 咪咕 / 汽水，网易侧可出**至臻母带 24bit/192kHz**。当前唯一能稳定拿到母带的一份 |
| `quandouyao.js` | 全豆要[聚合音源] | 9.3 · 全豆要（Toskysun 去混淆） | 聚合星海 / 溯音 / 念心 / 长青四条链路自动回退，无损档稳定，酷我侧可用；`master` 档多为有损伪装 |

## 实测（2026-11-02，曲目：薛之谦《像风一样》255s）

用 `server/music-sources/lxMusicRunner.js` 直接调用，再用 `durationProbe` 读文件头确认真实规格——**不看脚本自报的 quality**。

### 星海音乐源

| 音源 | 请求 `master` | 请求 `flac` |
|---|---|---|
| `wy` 网易 | **24bit/192kHz · 139MB**（4.5s） | 24bit/44.1kHz · 46MB（0.5s） |
| `tx` QQ | 偶发可用（探针判不出规格） | 该曲无返回 |
| `kg` 酷狗 | 无返回 | 无返回 |
| `kw` 酷我 | 无返回 | 无返回 |

### 全豆要聚合音源

| 音源 | 请求 `master` | 请求 `flac` |
|---|---|---|
| `wy` 网易 | mp3 · 4MB（约 128kbps，**虚报成母带**） | 24bit/44.1kHz · 46MB |
| `kw` 酷我 | mp3 · 4MB（同上） | 24bit/44.1kHz · 45MB |
| `tx` / `kg` | 探针判不出规格 | 探针判不出规格 |

结论：**母带只有星海 + 网易这一条路**。全豆要适合当星海额度耗尽时的无损备用。

## 为什么「虚报」不会骗到界面

播放链路对每个候选地址都跑一次 `probeAudio`：

- FLAC 读 `STREAMINFO` 的位深与采样率
- 有损容器按 `字节 × 8 ÷ 时长` 反推码率

达不到目标档位就继续降级，全都不达标时返回实测最好的那一档。所以全豆要把 4MB 的 mp3 标成 `master` 也没用——会被判定成 `standard` 并降级到它真正的无损档。

## 导入

1. 右键 →「视觉控制台 → 系统 → 第三方音源」
2. 「上传脚本」选择本目录的 `.js`（`.txt` 亦可）
3. 打开 **LX Music** 开关（没有脚本时开关点不亮）
4. 导入多个脚本后，点脚本名切换活跃脚本；新导入的不会抢占正在用的那个

接口方式：

```bash
node -e "const fs=require('fs');fetch('http://127.0.0.1:3000/api/parse/lx/upload',
  {method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({name:'星海音乐源',script:fs.readFileSync('lx-scripts/xinghai.js','utf8')})})
  .then(r=>r.json()).then(console.log)"
```

## 失效长什么样

| 现象 | 含义 |
|---|---|
| 所有档位、所有音源都返回空，日志 `[LxMusic] 无档位达标` | 后端额度用完或域名失效。等几分钟再试；持续为空说明脚本已废 |
| 返回 30/60 秒的 mp3 | 只给试听片段（后端没会员权限），不能作为完整播放源 |
| `master` 拿到 3~4MB 的 mp3 | 有损伪装，链路会自动降级，不影响正确性 |

## 自己测一遍

```bash
node -e "
const fs=require('fs');
const runner=require('./server/music-sources/lxMusicRunner.js');
(async()=>{
  const inst=await runner.initRunner('t', fs.readFileSync('lx-scripts/xinghai.js','utf8'), '星海', false);
  await new Promise(r=>setTimeout(r,1800));
  console.log(await inst.getMusicUrl('wy',
    {songmid:'516657051',name:'像风一样',singer:'薛之谦',album:'像风一样',interval:'04:15'},
    'master'));
  runner.disposeAll(); setTimeout(()=>process.exit(0),300);
})();"
```

返回 `null` 时先等几分钟——母带额度是按小时放的，不代表脚本坏了。
