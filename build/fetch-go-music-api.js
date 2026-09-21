'use strict';

/**
 * 拉取 go-music-api 的 Windows 二进制到 vendor/go-music-api/。
 *
 * 为什么需要这个脚本：go-music-api 是独立 Go 服务，桌面版把它作为「内置换源服务」
 * 随包分发。但项目约定 Git 不跟踪 .exe/.dll（见 docs/HANDOFF_NEXT_CHAT.md 的
 * 高风险残留检查），所以二进制不进仓库，改为构建前按需拉取。
 *
 * 用法：
 *   node build/fetch-go-music-api.js           # 已存在且校验通过则跳过
 *   node build/fetch-go-music-api.js --force   # 强制重新下载
 *
 * 由 package.json 的 prebuild:win / prebuild:win:dir 自动调用。
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const VERSION = 'v1.0.1';
const ASSET = 'go-music-api_windows_amd64.zip';
/** 官方 Release 页公布的 sha256（releases/download/<tag>/go-music-api_checksums.txt） */
const ZIP_SHA256 = 'ef9c1585991469cf4df918111cc3f622a64dec8c2d91749820d19567853687f5';
const RAW_URL = 'https://github.com/guohuiyuan/go-music-api/releases/download/' + VERSION + '/' + ASSET;

/**
 * 下载候选：直连 + 国内镜像回退（沿用 package.json 里 bhandsmusic.update.mirrors 的约定）。
 * 实测 GitHub Release 的 CDN 在国内经常 UND_ERR_CONNECT_TIMEOUT，镜像通常更快。
 */
const CANDIDATES = [
  RAW_URL,
  'https://gh-proxy.com/' + RAW_URL,
  'https://ghfast.top/' + RAW_URL,
  'https://gh.llkk.cc/' + RAW_URL
];

const OUT_DIR = path.join(__dirname, '..', 'vendor', 'go-music-api');
const OUT_EXE = path.join(OUT_DIR, 'go-music-api.exe');

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * 从 zip 里取出指定后缀的条目内容（纯 Node 实现，不依赖 PowerShell / 外部工具）。
 * 只支持 goreleaser 产物会用的 stored(0) 与 deflate(8) 两种压缩方式。
 * 之所以不调 PowerShell Expand-Archive：项目历史上存在中文路径（如 E:\桌面\...），
 * 经 -Command 传参会乱码。
 * @param {Buffer} zip
 * @param {string} suffix - 例如 '.exe'
 * @returns {Buffer}
 */
function extractFromZip(zip, suffix) {
  // 1. 从尾部往前找 End of Central Directory (0x06054b50)
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0 && i > zip.length - 22 - 65536; i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 zip：找不到 EOCD');
  const entryCount = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16); // central directory 起始偏移

  for (let n = 0; n < entryCount; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('central directory 头损坏');
    const method = zip.readUInt16LE(p + 10);
    const compressedSize = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const localOffset = zip.readUInt32LE(p + 42);
    const name = zip.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    if (!name.toLowerCase().endsWith(suffix)) continue;

    // 2. 读 local file header，跳过它自己的 name/extra
    if (zip.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('local file header 损坏');
    const lNameLen = zip.readUInt16LE(localOffset + 26);
    const lExtraLen = zip.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const raw = zip.subarray(dataStart, dataStart + compressedSize);

    if (method === 0) return Buffer.from(raw);
    if (method === 8) return zlib.inflateRawSync(raw);
    throw new Error('不支持的压缩方式: ' + method);
  }
  throw new Error('zip 里没有找到 ' + suffix + ' 条目');
}

/**
 * 按候选顺序下载（每个候选重试 2 次）。
 * 注意：不做整体超时上限——镜像转存大文件可能耗时 1 分钟以上，
 * 连接阶段的失败由系统 connect timeout（约 10s）自然兜住。
 */
async function downloadWithFallback() {
  let lastErr = null;
  for (const url of CANDIDATES) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const t0 = Date.now();
      try {
        const resp = await fetch(url, { redirect: 'follow' });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const buf = Buffer.from(await resp.arrayBuffer());
        console.log('[fetch-go-music-api] 下载成功（' + (Date.now() - t0) + 'ms，' + (buf.length / 1048576).toFixed(1) + ' MB）');
        return buf;
      } catch (e) {
        lastErr = e;
        const cause = e && e.cause && (e.cause.code || e.cause.message);
        console.warn('[fetch-go-music-api] 失败 ' + url + ' (第 ' + attempt + '/2 次): ' + e.message + (cause ? ' (' + cause + ')' : ''));
        if (attempt < 2) await new Promise((r) => setTimeout(r, 1200));
      }
    }
  }
  throw lastErr || new Error('所有下载地址均失败');
}

async function main() {
  const force = process.argv.includes('--force');

  if (!force && fs.existsSync(OUT_EXE)) {
    const size = fs.statSync(OUT_EXE).size;
    console.log('[fetch-go-music-api] 已存在，跳过下载: ' + OUT_EXE + ' (' + (size / 1048576).toFixed(1) + ' MB)');
    console.log('[fetch-go-music-api] 如需强制更新请加 --force');
    return;
  }

  console.log('[fetch-go-music-api] 开始下载（' + CANDIDATES.length + ' 个地址回退）…');
  const zip = await downloadWithFallback();
  console.log('[fetch-go-music-api] 校验 sha256…');

  const got = sha256(zip);
  if (got !== ZIP_SHA256) {
    throw new Error('sha256 不匹配！\n  期望 ' + ZIP_SHA256 + '\n  实际 ' + got + '\n  已中止，未写入任何文件。');
  }
  console.log('[fetch-go-music-api] sha256 校验通过');

  const exe = extractFromZip(zip, '.exe');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_EXE, exe);
  console.log('[fetch-go-music-api] 已写入 ' + OUT_EXE + ' (' + (exe.length / 1048576).toFixed(1) + ' MB)');
}

main().catch((e) => {
  console.error('[fetch-go-music-api] 失败: ' + (e && e.message ? e.message : e));
  console.error('[fetch-go-music-api] 换源服务将不可用（应用不会崩溃，该音源会自动跳过）');
  process.exit(1);
});
