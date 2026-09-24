/**
 * 加载期零错误闸门 —— 「应用主体脚本能不能正常跑起来」的探针。
 *
 * 为什么单独做这一个：2026-09-24 把 `public/js/main.js` 拆成 `public/js/app/*.js` 后，
 * 跨 script 的函数提升失效 → `01-state.js` 顶层抛 ReferenceError → 该 script 剩余顶层语句
 * **全部不执行** → 应用黑屏、鼠标不显示。而当时 6 个探针**全绿**，因为它们都在
 * `loadFile()` 之后才挂 `window.addEventListener('error')`，看不到加载期错误。
 *
 * 本探针补上这个盲区：
 *   ① 用 `webPreferences.preload` 在**任何文档脚本之前**挂错误监听（见 probe-app-load-preload.js）
 *   ② 主进程再挂 `console-message` / `did-fail-load`，双保险
 *   ③ 加载完断言：**没有**来自 `/js/app/` 的未捕获异常 / 未处理 rejection / console.error
 *   ④ 顺带断言「应用真的起来了」：scene / renderer / camera / animate / audio 等全局都在
 *
 * 判定口径（重要）：
 *   - `kind === 'resource'` 一律**不计**（离屏环境缺图，基线同样报 3 条）
 *   - 只把**栈或来源指向 `/js/app/` 或 index.html 内联脚本**的 error/rejection 算失败，
 *     Electron 自身 `renderer_init` 的内部 rejection（基线同样有）不算
 *   - `window.__LOAD_ERRORS` 缺失 = preload 没跑起来 → 直接判失败，防止「监听没挂上」
 *     又被当成全绿（这正是上次假绿的形态）
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'out', 'app-load-probe.json');
try { fs.mkdirSync(path.dirname(OUT), { recursive: true }); } catch (e) {}
const LOG = [];
function LOGLINE(s) { LOG.push(s); try { fs.writeFileSync(OUT, JSON.stringify(LOG, null, 2)); } catch (e) {} }

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('in-process-gpu');

/** 主进程侧收到的 console 消息（含加载期，executeJavaScript 挂的监听看不到这些） */
const consoleMsgs = [];
const failLoads = [];

/** 该错误是否归因到应用主体脚本（而非 Electron 内部 / 离屏环境噪声） */
function blamesApp(text) {
  const s = String(text || '');
  return s.indexOf('/js/app/') >= 0 || s.indexOf('js/app/') >= 0;
}

app.whenReady().then(async function () {
  const win = new BrowserWindow({
    width: 1440, height: 900, show: false,
    webPreferences: {
      sandbox: false, nodeIntegration: false, contextIsolation: false, offscreen: true,
      preload: path.join(__dirname, 'probe-app-load-preload.js'),
    },
  });

  win.webContents.on('console-message', function () {
    const a = arguments;
    const ev = a[0] && typeof a[0] === 'object' ? a[0] : null;
    if (ev && ev.message !== undefined) {
      consoleMsgs.push({ level: ev.level, source: String(ev.sourceId || ''), line: ev.lineNumber || 0, msg: String(ev.message) });
    } else {
      consoleMsgs.push({ level: a[1], source: String(a[4] || ''), line: a[3] || 0, msg: String(a[2]) });
    }
  });
  win.webContents.on('did-fail-load', function (e, code, desc, url) {
    failLoads.push({ code: code, desc: String(desc), url: String(url) });
  });

  let out = { errors: [], consoleErrors: [], globals: {}, verdict: '' };
  try {
    await win.loadFile(path.join(ROOT, 'public', 'index.html'));
    LOGLINE('loaded');
    await new Promise((r) => setTimeout(r, 3000));

    out.errors = await win.webContents.executeJavaScript('JSON.stringify(window.__LOAD_ERRORS || null)');
    out.errors = out.errors === null ? null : JSON.parse(out.errors);
    out.globals = JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify({
      scene: typeof window.scene, renderer: typeof window.renderer, camera: typeof window.camera,
      animate: typeof window.animate, audio: typeof window.audio, FFT_SIZE: typeof window.FFT_SIZE,
      playQueueAt: typeof window.playQueueAt, organizeFxPanel: typeof window.organizeFxPanel,
      appScripts: Array.prototype.map.call(document.querySelectorAll('script[src^="js/app/"]'), function(s){ return s.getAttribute('src'); })
    })`));
    out.bodyClass = await win.webContents.executeJavaScript('document.body.className');

    const fails = [];

    /* ① 监听必须真的挂上了 —— 否则「没错误」毫无意义 */
    if (out.errors === null) fails.push('window.__LOAD_ERRORS 不存在：preload 没跑起来，错误监听是空的（假绿形态）');

    /* ② 未捕获异常 / 未处理 rejection：只认归因到应用脚本的 */
    const errs = Array.isArray(out.errors) ? out.errors : [];
    const appErrs = errs.filter((e) => (e.kind === 'error' || e.kind === 'rejection') && (blamesApp(e.stack) || blamesApp(e.file)));
    for (const e of appErrs) fails.push('加载期 ' + e.kind + '：' + (e.msg || '') + '  @ ' + (e.file || '') + ':' + (e.line || 0));

    /* ③ 主进程侧的 console.error 也只看应用脚本来的 */
    out.consoleErrors = consoleMsgs.filter((m) => String(m.level) === 'error' && blamesApp(m.source));
    for (const m of out.consoleErrors) fails.push('console.error：' + m.source + ':' + m.line + ' ' + m.msg);

    /* ④ 应用真的起来了 */
    for (const k of ['scene', 'renderer', 'camera', 'audio']) {
      if (out.globals[k] !== 'object') fails.push('启动后 window.' + k + ' 不是 object（实际 ' + out.globals[k] + '）');
    }
    for (const k of ['animate', 'playQueueAt', 'organizeFxPanel']) {
      if (out.globals[k] !== 'function') fails.push('启动后 window.' + k + ' 不是 function（实际 ' + out.globals[k] + '）');
    }
    if (out.globals.FFT_SIZE !== 'number') fails.push('启动后 window.FFT_SIZE 不是 number（实际 ' + out.globals.FFT_SIZE + '）');
    if (!out.globals.appScripts || out.globals.appScripts.length < 17) {
      fails.push('index.html 只加载了 ' + ((out.globals.appScripts || []).length) + ' 个 js/app/*.js（应 ≥17）');
    }

    /* ⑤ 资源类噪声只报告不判失败（离屏环境缺图，基线同样有） */
    const noise = errs.filter((e) => e.kind === 'resource' || (e.kind === 'rejection' && !blamesApp(e.stack)));
    out.noise = noise.map((e) => e.kind + (e.tag ? ':' + e.tag : '') + (e.msg ? ':' + e.msg : ''));
    if (failLoads.length) fails.push('did-fail-load：' + JSON.stringify(failLoads));

    out.fails = fails;
    out.verdict = fails.length ? 'FAIL ' + fails.length + ' 条' : 'OK';
    for (const f of fails) LOGLINE('FAIL ' + f);
    LOGLINE('噪声（不计失败，供漂移对照）：' + JSON.stringify(out.noise));
    LOGLINE('RESULT ' + JSON.stringify(out));
  } catch (e) {
    LOGLINE('ERROR ' + (e && e.stack || e));
  }
  app.quit();
});
