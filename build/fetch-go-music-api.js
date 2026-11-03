'use strict';

/**
 * 拉取 go-music-api 的对应平台二进制到 vendor/go-music-api/。
 *
 * 为什么需要这个脚本：go-music-api 是独立 Go 服务，桌面版把它作为「内置换源服务」
 * 随包分发。但项目约定 Git 不跟踪二进制（见 docs/HANDOFF_NEXT_CHAT.md 的
 * 高风险残留检查），所以二进制不进仓库，改为构建前按需拉取。
 *
 * 平台产物（默认跟随当前主机，可用 --platform/--arch 交叉拉取）：
 *   win32  x64   → go-music-api_windows_amd64.zip    → go-music-api.exe
 *   darwin arm64 → go-music-api_darwin_arm64.tar.gz  → go-music-api
 *   darwin x64   → go-music-api_darwin_amd64.tar.gz  → go-music-api
 *   linux  x64   → go-music-api_linux_amd64.tar.gz   → go-music-api
 *   linux  arm64 → go-music-api_linux_arm64.tar.gz   → go-music-api
 *
 * 用法：
 *   node build/fetch-go-music-api.js                 # 已存在且校验通过则跳过
 *   node build/fetch-go-music-api.js --force         # 强制重新下载
 *   node build/fetch-go-music-api.js --platform darwin --arch arm64
 *
 * 由 package.json 的 prebuild:win / prebuild:win:dir / prebuild:mac 自动调用。
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const VERSION = 'v1.0.1';
const RELEASE_BASE = 'https://github.com/guohuiyuan/go-music-api/releases/download/' + VERSION + '/';
const CHECKSUMS_ASSET = 'go-music-api_checksums.txt';

/**
 * 下载候选前缀：直连 + 国内镜像回退（沿用 package.json 里 bhandsmusic.update.mirrors 的约定）。
 * 实测 GitHub Release 的 CDN 在国内经常 UND_ERR_CONNECT_TIMEOUT，镜像通常更快。
 */
const MIRROR_PREFIXES = ['', 'https://gh-proxy.com/', 'https://ghfast.top/', 'https://gh.llkk.cc/'];

/**
 * 各平台目标产物。sha256 为官方 Release 页公布的校验值
 * （releases/download/<tag>/go-music-api_checksums.txt），
 * 运行时仍会优先用在线校验和文件覆盖，硬编码值只作离线兜底。
 */
const TARGETS = {
  'win32-x64': {
    asset: 'go-music-api_windows_amd64.zip',
    kind: 'zip',
    out: 'go-music-api.exe',
    mode: 0o644,
    sha256: 'ef9c1585991469cf4df918111cc3f622a64dec8c2d91749820d19567853687f5'
  },
  'darwin-arm64': {
    asset: 'go-music-api_darwin_arm64.tar.gz',
    kind: 'targz',
    out: 'go-music-api',
    mode: 0o755,
    sha256: '051886172a5ba20b0812289a557951fff298639fc0403f5e534a21540ce21038'
  },
  'darwin-x64': {
    asset: 'go-music-api_darwin_amd64.tar.gz',
    kind: 'targz',
    out: 'go-music-api',
    mode: 0o755,
    sha256: 'bad64165b1eaad1845781fd594bf3355daa52f70c79030693a18df5ca531b6db'
  },
  'linux-x64': {
    asset: 'go-music-api_linux_amd64.tar.gz',
    kind: 'targz',
    out: 'go-music-api',
    mode: 0o755,
    sha256: 'd167244301232d17fb446de545193ed50c9829b08fc513447a408c51a029e43d'
  },
  'linux-arm64': {
    asset: 'go-music-api_linux_arm64.tar.gz',
    kind: 'targz',
    out: 'go-music-api',
    mode: 0o755,
    sha256: 'dfda44ab79f1306c38888445e5a177e0a7af5f299bbaa6001c387d1f5d361d24'
  }
};

const OUT_DIR = path.join(__dirname, '..', 'vendor', 'go-music-api');

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : '';
}

/** 解析目标平台/架构（默认跟随主机） */
function resolveTarget() {
  const platform = (argValue('--platform') || process.platform).toLowerCase();
  const arch = (argValue('--arch') || process.arch).toLowerCase();
  // Node 里 x86_64 不会出现，但统一一下更稳
  const normalizedArch = arch === 'x86_64' ? 'x64' : arch;
  const key = platform + '-' + normalizedArch;
  const target = TARGETS[key];
  if (!target) {
    throw new Error('不支持的平台组合: ' + key + '（可选: ' + Object.keys(TARGETS).join(', ') + '）');
  }
  return { platform, arch: normalizedArch, key, target };
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
 * 从 tar.gz 里取出可执行文件的内容（goreleaser 的 darwin/linux 产物）。
 *
 * 归档里除了二进制还带 LICENSE / README.md，所以不能简单地取第一个普通文件：
 * 优先按 basename 精确匹配期望的可执行文件名，其次取"带可执行位且最大"的文件，
 * 最后才退化为最大的普通文件。
 *
 * 只实现 ustar 头部解析：跳过目录与 pax/gnu 扩展头，取 typeFlag 为 0 的条目。
 * @param {Buffer} gz
 * @param {string} [preferredName] - 期望的可执行文件名，如 'go-music-api'
 * @returns {{name: string, size: number, data: Buffer}}
 */
function extractFromTarGz(gz, preferredName) {
  const tar = zlib.gunzipSync(gz);
  const BLOCK = 512;
  const files = [];
  let offset = 0;

  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);
    // 两个连续的全零块表示归档结束
    if (header.every((b) => b === 0)) break;

    const name = header.toString('utf8', 0, 100).replace(/\0.*$/, '');
    const modeField = header.toString('utf8', 100, 108).replace(/\0.*$/, '').trim();
    const sizeField = header.toString('utf8', 124, 136).replace(/\0.*$/, '').trim();
    const mode = parseInt(modeField, 8) || 0;
    const size = parseInt(sizeField, 8) || 0;
    const typeFlag = String.fromCharCode(header[156]);
    const dataStart = offset + BLOCK;
    const isRegularFile = typeFlag === '0' || typeFlag === '\0' || typeFlag === '';

    if (isRegularFile && size > 0) {
      files.push({
        name: name.split('/').pop(),
        size,
        mode,
        data: Buffer.from(tar.subarray(dataStart, dataStart + size))
      });
    }
    offset = dataStart + Math.ceil(size / BLOCK) * BLOCK;
  }

  if (!files.length) throw new Error('tar.gz 里没有找到可执行文件');

  const byName = preferredName ? files.find((f) => f.name === preferredName) : null;
  if (byName) return byName;

  const byExecBit = files
    .filter((f) => (f.mode & 0o111) !== 0)
    .sort((a, b) => b.size - a.size)[0];
  if (byExecBit) return byExecBit;

  return files.sort((a, b) => b.size - a.size)[0];
}

/** 单次下载（超时交给 fetch 自身的连接超时兜住） */
async function fetchOnce(url) {
  const resp = await fetch(url, { redirect: 'follow' });
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  return Buffer.from(await resp.arrayBuffer());
}

/**
 * 按候选顺序下载（每个候选重试 2 次）。
 * 注意：不做整体超时上限——镜像转存大文件可能耗时 1 分钟以上，
 * 连接阶段的失败由系统 connect timeout（约 10s）自然兜住。
 */
async function downloadWithFallback(asset) {
  const pathPart = RELEASE_BASE + asset;
  let lastErr = null;
  for (const prefix of MIRROR_PREFIXES) {
    const url = prefix + pathPart;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const t0 = Date.now();
      try {
        const buf = await fetchOnce(url);
        console.log('[fetch-go-music-api] 下载成功（' + (Date.now() - t0) + 'ms，' + (buf.length / 1048576).toFixed(1) + ' MB）');
        return buf;
      } catch (e) {
        lastErr = e;
        const cause = e && e.cause && (e.cause.code || e.cause.message);
        const label = prefix ? prefix : '(直连) ';
        console.warn('[fetch-go-music-api] 失败 ' + label + ' (第 ' + attempt + '/2 次): ' + e.message + (cause ? ' (' + cause + ')' : ''));
        if (attempt < 2) await new Promise((r) => setTimeout(r, 1200));
      }
    }
  }
  throw lastErr || new Error('所有下载地址均失败');
}

/**
 * 解析官方 checksums 文件，取指定产物的 sha256。
 * 拿不到就返回 null，由调用方回退到脚本内硬编码值。
 * @returns {Promise<string|null>}
 */
async function resolveExpectedSha256(asset) {
  try {
    const text = (await downloadWithFallback(CHECKSUMS_ASSET)).toString('utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/i);
      if (m && m[2].trim() === asset) return m[1].toLowerCase();
    }
    console.warn('[fetch-go-music-api] 在线校验和里没有 ' + asset + '，改用脚本内置值');
  } catch (e) {
    console.warn('[fetch-go-music-api] 校验和文件获取失败（' + e.message + '），改用脚本内置值');
  }
  return null;
}

async function main() {
  const force = process.argv.includes('--force');
  const { key, target } = resolveTarget();
  const outFile = path.join(OUT_DIR, target.out);

  console.log('[fetch-go-music-api] 目标平台: ' + key + ' → ' + target.asset);

  // 旁路记录「这个二进制是从哪个压缩包解出来的」：
  // 脚本里的 target.sha256 是**压缩包**的哈希，不能直接和二进制比对，
  // 所以解包时把来源哈希写进 sidecar，下次用它判断缓存是否可复用（同时能识别换架构）。
  const sourceShaFile = outFile + '.source-sha256';

  if (fs.existsSync(outFile)) {
    // 避免 prebuild 每次都重新拉 30MB —— 网络被墙时这正是「构建卡死在下载」的根源。
    // 2026-11-03：此前只判断「存在即跳过」，prebuild 又带 --force，等于每次强制重下。
    let cachedSource = '';
    try {
      cachedSource = fs.readFileSync(sourceShaFile, 'utf8').trim();
    } catch (e) {}
    if (cachedSource && cachedSource === target.sha256) {
      if (!force) {
        console.log('[fetch-go-music-api] 已存在且来源校验通过，跳过下载: ' + outFile);
        return;
      }
      console.log('[fetch-go-music-api] 已存在文件校验通过，但指定了 --force，仍重新下载');
    } else if (!cachedSource) {
      console.log('[fetch-go-music-api] 已有二进制但缺少来源记录（旧版本留下的），需要重新下载');
    } else {
      console.log('[fetch-go-music-api] 已存在文件来源不匹配（' + cachedSource.slice(0, 16) + '…），需要重新下载');
    }
  } else if (force) {
    console.log('[fetch-go-music-api] --force：本地无缓存，正常下载');
  }

  // 按架构的本地缓存：arm64 / x64 交替构建时，另一架构的二进制不会被覆盖丢失，
  // 第二次起直接复用，不再联网（30MB 的下载在墙内经常断流，这是构建卡死的主因）。
  const cacheBin = path.join(OUT_DIR, '.cache', key + '-' + target.out);
  const cacheSha = cacheBin + '.source-sha256';
  if (!force) {
    try {
      const cachedSha = fs.readFileSync(cacheSha, 'utf8').trim();
      if (cachedSha === target.sha256 && fs.existsSync(cacheBin)) {
        fs.mkdirSync(OUT_DIR, { recursive: true });
        fs.copyFileSync(cacheBin, outFile);
        fs.chmodSync(outFile, target.mode);
        fs.writeFileSync(sourceShaFile, target.sha256 + '\n', 'utf8');
        console.log('[fetch-go-music-api] 命中本地架构缓存，无需联网: ' + cacheBin);
        return;
      }
    } catch (e) {}
  }

  const expected = (await resolveExpectedSha256(target.asset)) || target.sha256;
  console.log('[fetch-go-music-api] 开始下载（' + MIRROR_PREFIXES.length + ' 个地址回退）…');
  const archive = await downloadWithFallback(target.asset);
  console.log('[fetch-go-music-api] 校验 sha256…');

  const got = sha256(archive);
  if (got !== expected) {
    throw new Error('sha256 不匹配！\n  期望 ' + expected + '\n  实际 ' + got + '\n  已中止，未写入任何文件。');
  }
  console.log('[fetch-go-music-api] sha256 校验通过');

  const binary = target.kind === 'zip'
    ? extractFromZip(archive, '.exe')
    : extractFromTarGz(archive, target.out).data;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(outFile, binary, { mode: target.mode });
  // writeFileSync 的 mode 只在新建文件时生效；显式再设一次，保证覆盖场景下也有可执行位
  fs.chmodSync(outFile, target.mode);
  // 记录来源压缩包哈希，供下次构建判断缓存可复用（见上面的 sourceShaFile）
  try {
    fs.writeFileSync(sourceShaFile, target.sha256 + '\n', 'utf8');
  } catch (e) {}
  // 同时留一份按架构的缓存，供另一架构构建后切回来时复用
  try {
    fs.mkdirSync(path.dirname(cacheBin), { recursive: true });
    fs.copyFileSync(outFile, cacheBin);
    fs.writeFileSync(cacheSha, target.sha256 + '\n', 'utf8');
  } catch (e) {}
  console.log('[fetch-go-music-api] 已写入 ' + outFile + ' (' + (binary.length / 1048576).toFixed(1) + ' MB)');
}

main().catch((e) => {
  console.error('[fetch-go-music-api] 失败: ' + (e && e.message ? e.message : e));
  console.error('[fetch-go-music-api] 换源服务将不可用（应用不会崩溃，该音源会自动跳过）');
  process.exit(1);
});
