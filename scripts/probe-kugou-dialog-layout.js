/**
 * 诊断探针：酷狗登录弹窗里状态文字的对齐/尺寸。
 * 用法：node_modules/electron/dist/electron.exe scripts/probe-kugou-dialog-layout.js
 */
const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 3988;
const OUT = path.join(__dirname, 'out', 'kugou-dialog-layout.json');
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
  try {
    await win.loadURL('http://127.0.0.1:' + PORT + '/');
    await new Promise((r) => setTimeout(r, 5000));
    await win.webContents.executeJavaScript('openKugouQrLogin(); "ok"');
    await new Promise((r) => setTimeout(r, 1500));
    const r = await win.webContents.executeJavaScript(`(function(){
      var note = document.getElementById('kugou-qr-note');
      var body = document.getElementById('kugou-qr-body');
      var card = note ? note.closest('div[style*="width:320px"]') : null;
      function info(el){
        if (!el) return null;
        var cs = getComputedStyle(el), b = el.getBoundingClientRect();
        return {
          tag: el.tagName, cls: el.className, id: el.id,
          textAlign: cs.textAlign, display: cs.display, width: Math.round(b.width),
          left: Math.round(b.left), right: Math.round(b.right),
          padding: cs.padding, lineHeight: cs.lineHeight, fontSize: cs.fontSize,
          text: (el.textContent || '').slice(0, 40)
        };
      }
      return JSON.stringify({ note: info(note), body: info(body), card: info(card) }, null, 2);
    })()`);
    log(r);
  } catch (e) {
    log('ERROR ' + (e && e.stack || e));
  }
  try { if (serverProc) serverProc.kill(); } catch (e) {}
  app.quit();
});
