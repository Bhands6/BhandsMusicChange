/**
 * 诊断探针：酷狗登录状态文案为什么停在「未登录」。
 * 用法：node_modules/electron/dist/electron.exe scripts/probe-kugou-status.js
 * 步骤：起本地服务 → 离屏加载首页 → 读初始文案 → 主动调用刷新函数 → 再读。
 */
const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 3998;
const OUT = path.join(__dirname, 'out', 'kugou-status-probe.json');
try { fs.mkdirSync(path.dirname(OUT), { recursive: true }); } catch (e) {}
const LOG = [];
function log(s) { LOG.push(s); try { fs.writeFileSync(OUT, JSON.stringify(LOG, null, 2)); } catch (e) {} }

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('in-process-gpu');

let serverProc = null;

function waitForServer(timeoutMs) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = async () => {
      try {
        const r = await fetch('http://127.0.0.1:' + PORT + '/api/kugou/login/status');
        if (r.ok) return resolve(true);
      } catch (e) {}
      if (Date.now() - t0 > timeoutMs) return resolve(false);
      setTimeout(tick, 300);
    };
    tick();
  });
}

app.whenReady().then(async () => {
  serverProc = spawn(process.execPath, ['server/server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1', PORT: String(PORT), HOST: '127.0.0.1' }),
    stdio: 'ignore'
  });
  const ready = await waitForServer(20000);
  log('server ready: ' + ready);
  if (!ready) { app.quit(); return; }

  const win = new BrowserWindow({
    width: 1440, height: 900, show: false,
    webPreferences: { sandbox: false, nodeIntegration: false, contextIsolation: false, offscreen: true }
  });
  win.webContents.on('console-message', function () {
    const a = arguments;
    const ev = a[0] && typeof a[0] === 'object' ? a[0] : null;
    const msg = ev && ev.message !== undefined ? ev.message : a[2];
    log('console: ' + String(msg).slice(0, 300));
  });

  try {
    await win.loadURL('http://127.0.0.1:' + PORT + '/');
    log('loaded');
    await new Promise((r) => setTimeout(r, 4000));

    const snap = async (tag) => {
      const r = await win.webContents.executeJavaScript(`(function(){
        var el = document.getElementById('kugou-login-status');
        var row = document.getElementById('kugou-qr-login-row');
        return JSON.stringify({
          exists: !!el,
          text: el ? el.textContent : null,
          color: el ? getComputedStyle(el).color : null,
          rowClass: row ? row.className : null,
          fnType: typeof updateKugouLoginStatusText,
          cfgLoaded: typeof _musicSourcesConfig !== 'undefined' ? !!_musicSourcesConfig : 'undefined',
          enabled: (typeof _musicSourcesConfig !== 'undefined' && _musicSourcesConfig) ? _musicSourcesConfig.enabledSources : null
        });
      })()`);
      log(tag + ': ' + r);
      return JSON.parse(r);
    };

    await snap('initial(after 4s)');

    // 主动调用一次刷新函数，看它本身是否有效
    await win.webContents.executeJavaScript('updateKugouLoginStatusText(); "called"');
    await new Promise((r) => setTimeout(r, 2500));
    await snap('after manual call');

    // 直接确认接口返回
    const api = await win.webContents.executeJavaScript(
      'fetch("/api/kugou/login/status").then(r=>r.text())');
    log('api from page: ' + api);
  } catch (e) {
    log('ERROR ' + (e && e.stack || e));
  }
  try { if (serverProc) serverProc.kill(); } catch (e) {}
  app.quit();
});
