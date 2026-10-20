/**
 * 诊断探针：酷狗登录弹窗里的「退出登录」按钮。
 * 运行前把配置指向临时副本，避免真的删掉本机凭据：
 *   cp .music-sources.json %TEMP%\bm-logout-test.json
 *   BHANDSMUSIC_MUSIC_SOURCES_CONFIG=%TEMP%\bm-logout-test.json \
 *     node_modules/electron/dist/electron.exe scripts/probe-kugou-logout.js
 */
const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 3989;
const OUT = path.join(__dirname, 'out', 'kugou-logout-probe.json');
try { fs.mkdirSync(path.dirname(OUT), { recursive: true }); } catch (e) {}
const LOG = [];
function log(s) { LOG.push(s); try { fs.writeFileSync(OUT, JSON.stringify(LOG, null, 2)); } catch (e) {} }

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('in-process-gpu');

let serverProc = null;
function waitForServer(ms) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = async () => {
      try { const r = await fetch('http://127.0.0.1:' + PORT + '/api/kugou/login/status'); if (r.ok) return resolve(true); } catch (e) {}
      if (Date.now() - t0 > ms) return resolve(false);
      setTimeout(tick, 300);
    };
    tick();
  });
}

app.whenReady().then(async () => {
  log('config: ' + (process.env.BHANDSMUSIC_MUSIC_SOURCES_CONFIG || '(默认仓库路径)'));
  serverProc = spawn(process.execPath, ['server/server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1', PORT: String(PORT), HOST: '127.0.0.1' }),
    stdio: 'ignore'
  });
  if (!await waitForServer(20000)) { log('server not ready'); app.quit(); return; }

  const win = new BrowserWindow({
    width: 1440, height: 900, show: false,
    webPreferences: { sandbox: false, nodeIntegration: false, contextIsolation: false, offscreen: true }
  });

  const snap = async (tag) => {
    const r = await win.webContents.executeJavaScript(`(function(){
      var s = document.getElementById('kugou-login-status');
      var b = document.getElementById('kugou-logout-btn');
      var body = document.getElementById('kugou-qr-body');
      return JSON.stringify({
        status: s ? s.textContent : null,
        overlay: !!document.getElementById('kugou-qr-overlay'),
        btnExists: !!b,
        btnVisible: b ? (b.style.display !== 'none' && b.offsetParent !== null) : null,
        btnText: b ? b.textContent : null,
        bodyText: body ? (body.textContent || '').slice(0, 60) : null,
        hasQrImg: !!(body && body.querySelector('img')),
        rowOn: (document.getElementById('kugou-qr-login-row') || {}).className || null
      });
    })()`);
    log(tag + ' -> ' + r);
    return JSON.parse(r);
  };

  try {
    await win.loadURL('http://127.0.0.1:' + PORT + '/');
    await new Promise((r) => setTimeout(r, 5000));
    await snap('0. 页面加载后（弹窗关闭）');

    await win.webContents.executeJavaScript('openKugouQrLogin(); "ok"');
    await new Promise((r) => setTimeout(r, 1200));
    await snap('1. 打开登录弹窗');

    await win.webContents.executeJavaScript('logoutKugou(); "ok"');
    await new Promise((r) => setTimeout(r, 400));
    await snap('2. 第一次点击（应进入确认态）');

    await win.webContents.executeJavaScript('logoutKugou(); "ok"');
    await new Promise((r) => setTimeout(r, 2200));
    await snap('3. 第二次点击后（应已退出并关闭弹窗）');

    const api = await win.webContents.executeJavaScript('fetch("/api/kugou/login/status").then(r=>r.text())');
    log('api after logout: ' + api);
  } catch (e) {
    log('ERROR ' + (e && e.stack || e));
  }
  try { if (serverProc) serverProc.kill(); } catch (e) {}
  app.quit();
});
