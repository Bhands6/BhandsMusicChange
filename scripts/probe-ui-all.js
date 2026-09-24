'use strict';
/**
 * 依次跑完 `scripts/` 下所有**离屏 Electron** 探针，汇总通过情况。
 *
 * 为什么需要它：单个探针必须用
 *   `./node_modules/electron/dist/electron.exe scripts/probe-xxx.js`
 * 启动（`node_modules/.bin/electron` 会让 require('electron').app 变 undefined），
 * 8 个探针手敲 8 次容易漏。这里统一 spawn，并在跑完后读 `scripts/out/*.json`
 * 做一次冒烟判定：最后一条日志必须是 `RESULT ...`（而不是 `ERROR ...`），
 * 且载荷里的 `fails[]` 必须为空 / `verdict` 不能以 FAIL 开头。
 *
 * 第一个探针 `probe-app-load.js` 是**加载期零错误闸门**：它用 preload 在主文档脚本之前
 * 挂错误监听，专门堵「应用起不来但探针全绿」这个盲区（2026-09-24 拆分 main.js 就是这么
 * 漏掉跨 script 函数提升 ReferenceError 的，见 scripts/probe-app-load.js 头部）。
 * 它挂了，后面 7 个的结论都不作数。
 *
 * 更细的断言在各探针内部（它们自己会打印期望/实际），这里只管「有没有崩 + 有没有自判失败」。
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
  // 加载期零错误闸门：必须排第一 —— 它挂了，后面 7 个探针的结论都不作数
  // （2026-09-24 拆分 main.js 引入跨 script 提升 ReferenceError，应用黑屏而探针全绿，
  //   根因就是缺这道闸；详见 scripts/probe-app-load.js 头部）
  ['probe-app-load.js', 'app-load-probe.json'],
  ['probe-playback-token.js', 'playback-token-probe.json'],
  ['probe-music-sources-panel.js', 'music-sources-panel-probe.json'],
  ['probe-quality-display.js', 'quality-display-probe.json'],
  ['probe-thirdparty-notice.js', 'thirdparty-notice-probe.json'],
  ['probe-kugou-row.js', 'kugou-row-probe.json'],
  ['probe-local-beat-trigger.js', 'local-beat-trigger-probe.json'],
  // 取景探针（最慢，放最后）：判「预设机位确实被 setPreset 应用 + readPixels 测量链路有效」。
  // 刻意**不**锁 radius 具体值 —— 那是审美参数，用户随时会调；它只堵「跑完但什么都没测到」的假绿。
  ['probe-preset-framing.js', 'preset-framing-probe.json'],
];

const bin = electronBin();
if (!bin) {
  console.error('❌ 找不到 Electron 可执行文件。先 `npm install`（本仓库 devDependencies 里有 electron）。');
  process.exit(2);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

/* ⚠️ ELECTRON_RUN_AS_NODE=1 会让 electron.exe 退化成纯 node：
 *   `require('electron')` 返回的是二进制路径字符串，解构出来的 `app` 是 undefined，
 *   探针第 21 行 `app.commandLine.appendSwitch` 直接 TypeError。
 *   某些 CI / 宿主 shell 会带这个变量，所以这里显式剥掉再 spawn。 */
const childEnv = Object.assign({}, process.env);
delete childEnv.ELECTRON_RUN_AS_NODE;
delete childEnv.NODE_OPTIONS;

let failed = 0;
for (const [script, outFile] of PROBES) {
  const outPath = path.join(OUT_DIR, outFile);
  try { fs.rmSync(outPath, { force: true }); } catch (e) {}

  process.stdout.write(script.padEnd(34));
  const r = spawnSync(bin, [path.join(__dirname, script)], { cwd: REPO, stdio: 'ignore', timeout: 120000, env: childEnv });

  if (!fs.existsSync(outPath)) {
    console.log('❌ 未产出结果文件（退出码 ' + r.status + '）');
    failed++;
    continue;
  }
  const log = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  const last = String(log[log.length - 1] || '');
  if (!last.startsWith('RESULT ')) {
    console.log('❌ 最后一条日志不是 RESULT: ' + last.slice(0, 160));
    failed++;
    continue;
  }
  /* 探针自己也会判失败：RESULT 载荷里带 fails[] / verdict 时以它为准，
     否则「跑完了」会被误当成「断言都过了」。 */
  let verdict = '';
  let fails = null;
  try {
    const payload = JSON.parse(last.slice(7));
    if (payload && Array.isArray(payload.fails)) fails = payload.fails;
    if (payload && typeof payload.verdict === 'string') verdict = payload.verdict;
  } catch (e) { /* 载荷不是 JSON 就走原来的口径 */ }
  if (fails && fails.length) {
    console.log('❌ 探针自判失败 ' + fails.length + ' 条：' + String(fails[0]).slice(0, 150));
    failed++;
    continue;
  }
  if (/^FAIL/.test(verdict)) {
    console.log('❌ 探针 verdict=' + verdict);
    failed++;
    continue;
  }
  console.log('✅ ' + last.slice(7, 130).replace(/\n/g, ' '));
}

console.log(failed ? `\n${failed} / ${PROBES.length} 个探针失败` : `\n✅ ${PROBES.length} / ${PROBES.length} 个探针通过`);
process.exit(failed ? 1 : 0);
