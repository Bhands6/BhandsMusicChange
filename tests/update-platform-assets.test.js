/**
 * 更新链路「平台感知」回归闸门（Windows / macOS）。
 *
 * ── 为什么要有这个测试 ────────────────────────────────────────────────
 * 更新链路历史上是纯 Windows 口径：`pickReleaseAsset` 只认 `.exe/.msi`、
 * 备用清单只读 `latest.yml`、兜底文件名写死 `-Setup.exe`。Release 里同时挂着
 * `...-mac-arm64.dmg` / `...-mac-x64.dmg` / `...-Setup.exe` 时，**Mac 用户会下到 exe**。
 *
 * 这里从 `server/server.js` 源码里抽出平台相关的纯函数，分别在 darwin/win32 × arm64/x64
 * 四种组合下执行，钉死三类容易复发的错误：
 *   1. 资产按平台/架构选错（含「误选 blockmap / 清单文件」）；
 *   2. 多架构 `latest-mac.yml` 里选到非本机架构的 dmg；
 *   3. 清单顶层的 `sha512`（它属于 `path`）覆盖掉 files 条目自己的 sha512。
 *
 * ⚠️ 抽取用「行首 `function NAME(` 到行首 `}`」定位：server.js 用了 esprima 4 不支持的
 *    语法（对象展开 / 动态 import），没法整文件解析；而这些顶层函数内部的花括号都有缩进，
 *    所以这个定位是可靠的。抽不到函数会直接抛错，不会静默跑空。
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SERVER_SRC = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');

const WANTED_FUNCTIONS = [
  'yamlScalar', 'normalizeVersion', 'compareVersions',
  'installerAssetPatterns', 'isInstallerAssetName', 'assetArchMatches',
  'preferCurrentArch', 'defaultInstallerName', 'pickReleaseAsset',
  'parseYmlFileEntries', 'pickYmlInstallerEntry', 'parseLatestYmlUpdateInfo',
];

function extractFunctions() {
  const chunks = [];
  for (const name of WANTED_FUNCTIONS) {
    const match = SERVER_SRC.match(new RegExp('^function ' + name + '\\([\\s\\S]*?^\\}$', 'm'));
    assert.ok(match, '未能在 server/server.js 里抽到函数 ' + name + '（函数被改名或挪走了？）');
    chunks.push(match[0]);
  }
  return chunks.join('\n');
}

const FUNCTION_SOURCE = extractFunctions();

/** 按指定平台/架构构建一套被测函数（依赖用最小桩替代） */
function buildFor(platform, arch) {
  const code = `
    const IS_MAC = ${platform === 'darwin'}, IS_WIN = ${platform === 'win32'};
    const UPDATE_ARCH = ${JSON.stringify(arch)};
    const APP_VERSION = '2.2.0';
    // parseLatestYmlUpdateInfo 只拿 owner/repo 拼 htmlUrl，给个最小桩即可
    const UPDATE_CONFIG = { owner: 'o', repo: 'r', provider: 'github', configured: true, preview: false, mirrors: [] };
    function assetDigestInfo(){ return { sha256: '', sha512: '' }; }
    function uniqueDownloadCandidates(u){ return [{ url: u, label: 'GitHub' }]; }
    function publicDownloadUrls(c){ return c.map(x => x.url); }
    function updateAssetNameFromUrl(v){
      try { return decodeURIComponent(new URL(v).pathname.split('/').pop()); } catch (e) { return ''; }
    }
    function normalizeDigest(v){ return String(v || ''); }
    function githubReleaseDownloadUrl(ver, name){
      return 'https://github.com/o/r/releases/download/BhandsMusic-V' + ver + '/' + name;
    }
    ${FUNCTION_SOURCE}
    return {
      pickReleaseAsset, pickYmlInstallerEntry, parseYmlFileEntries,
      parseLatestYmlUpdateInfo, defaultInstallerName, isInstallerAssetName,
    };
  `;
  return new Function(code)();
}

/** Release 上真实存在的资产形态：两个 mac dmg + Windows exe + 附属产物 */
const RELEASE_ASSETS = [
  { name: 'BhandsMusic-2.3.0-Setup.exe', size: 180000000, browser_download_url: 'https://github.com/o/r/releases/download/BhandsMusic-V2.3.0/BhandsMusic-2.3.0-Setup.exe' },
  { name: 'BhandsMusic-2.3.0-Setup.exe.blockmap', size: 190000, browser_download_url: 'https://x/BhandsMusic-2.3.0-Setup.exe.blockmap' },
  { name: 'BhandsMusic-2.3.0-mac-arm64.dmg', size: 177000000, browser_download_url: 'https://github.com/o/r/releases/download/BhandsMusic-V2.3.0/BhandsMusic-2.3.0-mac-arm64.dmg' },
  { name: 'BhandsMusic-2.3.0-mac-x64.dmg', size: 178000000, browser_download_url: 'https://github.com/o/r/releases/download/BhandsMusic-V2.3.0/BhandsMusic-2.3.0-mac-x64.dmg' },
  { name: 'latest-mac.yml', size: 400, browser_download_url: 'https://x/latest-mac.yml' },
  { name: 'BhandsMusic-2.2.0→2.3.0.patch.json', size: 900000, browser_download_url: 'https://x/BhandsMusic-2.2.0.2.3.0.patch.json' },
];

const MULTI_ARCH_MAC_YML = [
  'version: 2.3.0',
  'files:',
  '  - url: BhandsMusic-2.3.0-mac-x64.dmg',
  '    sha512: X64HASH',
  '    size: 111',
  '  - url: BhandsMusic-2.3.0-mac-arm64.dmg',
  '    sha512: ARMHASH',
  '    size: 222',
  'path: BhandsMusic-2.3.0-mac-x64.dmg',
  'sha512: X64HASH',
  'releaseDate: 2026-10-16T00:00:00.000Z',
].join('\n');

const WINDOWS_YML = [
  'version: 2.3.0',
  'files:',
  '  - url: BhandsMusic-2.3.0-Setup.exe',
  '    sha512: WINHASH',
  '    size: 333',
  'path: BhandsMusic-2.3.0-Setup.exe',
  'sha512: WINHASH',
  'releaseDate: 2026-10-16T00:00:00.000Z',
].join('\n');

const macArm = buildFor('darwin', 'arm64');
const macX64 = buildFor('darwin', 'x64');
const winX64 = buildFor('win32', 'x64');

test('选资产：mac 拿 dmg（按架构），win 拿 exe，不会误选附属产物', () => {
  assert.equal(macArm.pickReleaseAsset(RELEASE_ASSETS).name, 'BhandsMusic-2.3.0-mac-arm64.dmg');
  assert.equal(macX64.pickReleaseAsset(RELEASE_ASSETS).name, 'BhandsMusic-2.3.0-mac-x64.dmg');
  assert.equal(winX64.pickReleaseAsset(RELEASE_ASSETS).name, 'BhandsMusic-2.3.0-Setup.exe');
  // 关键回归：mac 绝不能下到 Windows 安装包
  assert.ok(!/\.exe$/i.test(macArm.pickReleaseAsset(RELEASE_ASSETS).name), 'mac 选到了 exe');
  // 附属产物（blockmap / 清单 / patch）不能被当成安装包
  assert.ok(!/blockmap|\.ya?ml|patch/i.test(macArm.pickReleaseAsset(RELEASE_ASSETS).name));
  assert.ok(!/blockmap|\.ya?ml|patch/i.test(winX64.pickReleaseAsset(RELEASE_ASSETS).name));
  // 没有任何本平台安装包时返回 null（前端会退回打开 Release 页面），而不是随便挑一个
  assert.equal(macArm.pickReleaseAsset([{ name: 'notes.txt', browser_download_url: 'https://x/notes.txt' }]), null);
});

test('兜底安装包文件名按平台给扩展名', () => {
  assert.equal(macArm.defaultInstallerName('2.3.0'), 'BhandsMusic-2.3.0-mac-arm64.dmg');
  assert.equal(macX64.defaultInstallerName('2.3.0'), 'BhandsMusic-2.3.0-mac-x64.dmg');
  assert.equal(winX64.defaultInstallerName('2.3.0'), 'BhandsMusic-2.3.0-Setup.exe');
});

test('解析真实产物 dist/latest-mac.yml：选中条目、取该条目自己的 sha512/size', () => {
  const ymlPath = path.join(ROOT, 'dist', 'latest-mac.yml');
  if (!fs.existsSync(ymlPath)) return;   // 未构建过 mac 包时跳过
  const yml = fs.readFileSync(ymlPath, 'utf8');
  // ⚠️ 版本号从清单里现取，不硬编码 —— 否则每次发版重新打包后这个测试都会误报失败
  const manifestVersion = (yml.match(/^version:\s*(.+?)\s*$/m) || [])[1];
  assert.ok(manifestVersion, 'latest-mac.yml 里没解析到 version');
  // 条目数由构建方式决定：单架构构建 1 条；跑过 scripts/merge-latest-mac-yml.js 后 2 条。
  // 这里只断言「至少 1 条 + 本机架构能选对」，不把构建方式写死进测试。
  const entries = macArm.parseYmlFileEntries(yml);
  assert.ok(entries.length >= 1, 'latest-mac.yml 里没解析到 files 条目');
  const armName = 'BhandsMusic-' + manifestVersion + '-mac-arm64.dmg';
  const x64Name = 'BhandsMusic-' + manifestVersion + '-mac-x64.dmg';
  const hasArm = entries.some(entry => entry.url === armName);
  const hasX64 = entries.some(entry => entry.url === x64Name);
  if (hasArm) assert.equal(macArm.pickYmlInstallerEntry(yml).url, armName, 'arm64 机器应选中 arm64 包');
  if (hasX64) assert.equal(macX64.pickYmlInstallerEntry(yml).url, x64Name, 'x64 机器应选中 x64 包');
  // 双架构清单是发布目标形态：合并脚本跑过后两个架构都应存在，且不应混入多余条目
  if (hasArm && hasX64) assert.equal(entries.length, 2, '双架构清单不应包含多余条目');
  const expectedName = hasArm ? armName : x64Name;
  const info = macArm.parseLatestYmlUpdateInfo(yml, '');
  assert.equal(info.release.asset.name, expectedName);
  // dmg 体积断言用范围而不是精确值：精确值会随每次重新构建而变
  assert.ok(info.release.asset.size > 100 * 1024 * 1024, 'dmg 体积异常：' + info.release.asset.size);
  assert.ok(info.release.asset.sha512.length > 20, 'sha512 没解析出来');
  // macOS 不提供快速补丁（补丁会写进已签名 bundle，破坏代码签名）
  assert.equal(info.release.patchAvailable, false);
});

test('多架构 latest-mac.yml：按本机架构选条目，且不被顶层 sha512 污染', () => {
  assert.equal(macArm.pickYmlInstallerEntry(MULTI_ARCH_MAC_YML).url, 'BhandsMusic-2.3.0-mac-arm64.dmg');
  assert.equal(macX64.pickYmlInstallerEntry(MULTI_ARCH_MAC_YML).url, 'BhandsMusic-2.3.0-mac-x64.dmg');

  const arm = macArm.parseLatestYmlUpdateInfo(MULTI_ARCH_MAC_YML, '');
  assert.equal(arm.release.asset.name, 'BhandsMusic-2.3.0-mac-arm64.dmg');
  assert.equal(arm.release.asset.sha512, 'ARMHASH', '顶层 sha512 覆盖了条目自己的 sha512');
  assert.equal(arm.release.asset.size, 222);

  const x64 = macX64.parseLatestYmlUpdateInfo(MULTI_ARCH_MAC_YML, '');
  assert.equal(x64.release.asset.name, 'BhandsMusic-2.3.0-mac-x64.dmg');
  assert.equal(x64.release.asset.sha512, 'X64HASH');
  assert.equal(x64.release.asset.size, 111);
});

test('Windows latest.yml 不回归', () => {
  const info = winX64.parseLatestYmlUpdateInfo(WINDOWS_YML, '');
  assert.equal(info.release.asset.name, 'BhandsMusic-2.3.0-Setup.exe');
  assert.equal(info.release.asset.sha512, 'WINHASH');
  assert.equal(info.release.asset.size, 333);
});

test('server.js 里 macOS 补丁开关确实被关掉', () => {
  assert.match(SERVER_SRC, /const PATCH_SUPPORTED = !IS_MAC;/, 'PATCH_SUPPORTED 定义被改动');
  assert.match(SERVER_SRC, /if \(!PATCH_SUPPORTED\) return null;/, 'pickPatchAsset 没在 mac 上短路');
  assert.match(SERVER_SRC, /PATCH_UNSUPPORTED_PLATFORM/, '/api/update/patch 没有拒绝 mac');
  assert.match(SERVER_SRC, /IS_MAC \? 'latest-mac\.yml' : 'latest\.yml'/, '备用清单没有按平台分流');
});
