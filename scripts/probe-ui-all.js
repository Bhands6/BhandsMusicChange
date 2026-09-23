'use strict';
/**
 * 依次跑完 `scripts/` 下所有**离屏 Electron** 探针，汇总通过情况。
 *
 * 为什么需要它：单个探针必须用
 *   `./node_modules/electron/dist/electron.exe scripts/probe-xxx.js`
 * 启动（`node_modules/.bin/electron` 会让 require('electron').app 变 undefined），
 * 6 个探针手敲 6 次容易漏。这里统一 spawn，并在跑完后读 `scripts/out/*.json`
 * 做一次冒烟判定：最后一条日志必须是 `RESULT ...`（而不是 `ERROR ...`）。
 *
 * 更细的断言在各探针内部（它们自己会打印期望/实际），这里只管「有没有崩」。
 * 非 Electron 的探针（static / cuefield / e2e-parse-level）用 `npm run probe:*` 单独跑。
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '..');
const OUT_DIR = path.join(__dirname, 'out');

/** Electron 可执行文件（按平台取；本仓库只出 Windows 包，其余平台给个兜底） */
function electronBin() {
  const base = path.join(REPO, 'node_modules', 'electron', 'dist');
  const candidates = process.platform === 'win32'
    ? [path.join(base, 'electron.exe')]
    : [
        path.join(base, 'Electron.app', 'Contents', 'MacOS', 'Electron'),
        path.join(base, 'electron'),
      ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

const PROBES = [
  ['probe-playback-token.js', 'playback-token-probe.json'],
  ['probe-music-sources-panel.js', 'music-sources-panel-probe.json'],
  ['probe-quality-display.js', 'quality-display-probe.json'],
  ['probe-thirdparty-notice.js', 'thirdparty-notice-probe.json'],
  ['probe-kugou-row.js', 'kugou-row-probe.json'],
  ['probe-local-beat-trigger.js', 'local-beat-trigger-probe.json'],
];

const bin = electronBin();
if (!bin) {
  console.error('❌ 找不到 Electron 可执行文件。先 `npm install`（本仓库 devDependencies 里有 electron）。');
  process.exit(2);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

let failed = 0;
for (const [script, outFile] of PROBES) {
  const outPath = path.join(OUT_DIR, outFile);
  try { fs.rmSync(outPath, { force: true }); } catch (e) {}

  process.stdout.write(script.padEnd(34));
  const r = spawnSync(bin, [path.join(__dirname, script)], { cwd: REPO, stdio: 'ignore', timeout: 120000 });

  if (!fs.existsSync(outPath)) {
    console.log('❌ 未产出结果文件（退出码 ' + r.status + '）');
    failed++;
    continue;
  }
  const log = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  const last = String(log[log.length - 1] || '');
  if (last.startsWith('RESULT ')) {
    console.log('✅ ' + last.slice(7, 130).replace(/\n/g, ' '));
  } else {
    console.log('❌ 最后一条日志不是 RESULT: ' + last.slice(0, 160));
    failed++;
  }
}

console.log(failed ? `\n${failed} / ${PROBES.length} 个探针失败` : `\n✅ ${PROBES.length} / ${PROBES.length} 个探针通过`);
process.exit(failed ? 1 : 0);
