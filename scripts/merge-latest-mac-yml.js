'use strict';

/**
 * 合并 macOS 双架构安装清单（dist/latest-mac.yml）。
 *
 * ── 为什么需要这个脚本 ──────────────────────────────────────────────
 * electron-builder 每次构建都会**整份覆盖** latest-mac.yml。而本项目的
 * vendor/go-music-api 是单架构二进制（darwin-arm64 与 darwin-amd64 是两份不同文件，
 * 落到同一个路径），所以 arm64 / x64 必须分两次构建（prebuild:mac / prebuild:mac:x64
 * 各自拉对应架构的二进制）。结果是：后构建的那次把清单写成单条目，
 * 另一架构走「备用更新线路」（GitHub API 不可达时读 latest-mac.yml）就会拿到错误架构的包。
 *
 * 本脚本在两次构建都完成后，直接按磁盘上的 dmg 文件重算 sha512 / size，
 * 写成包含两个架构的清单。这样备用线路也能按架构正确分发。
 *
 * 用法：
 *   node scripts/merge-latest-mac-yml.js          # 合并 dist 下当前版本的两个 dmg
 *   npm run build:mac:all                        # 依次构建 arm64 + x64 后自动合并
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const ARCHES = ['arm64', 'x64'];

function readVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  return String(pkg.version || '').trim();
}

/** 流式计算 sha512（dmg 约 180MB，避免整文件读进内存），输出与 electron-builder 一致的 base64 */
function sha512Of(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha512');
    const stream = fs.createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('base64')));
  });
}

async function main() {
  const version = readVersion();
  if (!version) throw new Error('package.json 里没有 version');
  if (!fs.existsSync(DIST)) throw new Error('dist 目录不存在，请先构建 mac 包');

  const entries = [];
  const missing = [];
  for (const arch of ARCHES) {
    const name = `BhandsMusic-${version}-mac-${arch}.dmg`;
    const file = path.join(DIST, name);
    if (!fs.existsSync(file)) {
      missing.push(name);
      continue;
    }
    const size = fs.statSync(file).size;
    const sha512 = await sha512Of(file);
    entries.push({ url: name, sha512, size });
    console.log('[merge-latest-mac-yml] ' + name + ' · ' + (size / 1048576).toFixed(1) + ' MB');
  }

  if (!entries.length) {
    throw new Error('dist 下没有 ' + version + ' 的 mac dmg，请先跑 build:mac / build:mac:x64');
  }
  if (missing.length) {
    // 单架构也照样写：至少保证清单与磁盘产物一致，不会指到不存在的文件
    console.warn('[merge-latest-mac-yml] 缺少：' + missing.join(', ') + '（清单将只含已构建的架构）');
  }

  // 主条目（path / 顶层 sha512）取 arm64：与 build:mac 的默认产物一致，且本项目主要发布 arm64
  const primary = entries[0];
  const lines = [
    'version: ' + version,
    'files:',
  ];
  for (const entry of entries) {
    lines.push('  - url: ' + entry.url);
    lines.push('    sha512: ' + entry.sha512);
    lines.push('    size: ' + entry.size);
  }
  lines.push('path: ' + primary.url);
  lines.push('sha512: ' + primary.sha512);
  lines.push("releaseDate: '" + new Date().toISOString() + "'");

  const target = path.join(DIST, 'latest-mac.yml');
  fs.writeFileSync(target, lines.join('\n') + '\n', 'utf8');
  console.log('[merge-latest-mac-yml] 已写入 dist/latest-mac.yml（' + entries.length + ' 个架构，主条目 ' + primary.url + '）');
}

main().catch((err) => {
  console.error('[merge-latest-mac-yml] 失败: ' + (err && err.message ? err.message : err));
  process.exit(1);
});
