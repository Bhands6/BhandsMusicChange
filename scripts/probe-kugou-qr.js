/**
 * 诊断探针：酷狗扫码登录点击后 UI 是否有反应。
 * 用法：node_modules/electron/dist/electron.exe scripts/probe-kugou-qr.js
 */
const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 3996;
const OUT = path.join(__dirname, 'out', 'kugou-qr-probe.json');
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
  win.webContents.on('console-message', function () {
    const a = arguments;
    const ev = a[0] && typeof a[0] === 'object' ? a[0] : null;
    const s = String(ev && ev.message !== undefined ? ev.message : a[2]);
    if (/kugou|Kugou|未捕获|Uncaught|error/i.test(s)) log('console: ' + s.slice(0, 300));
  });

  const snap = async (tag) => {
    const r = await win.webContents.executeJavaScript(`(function(){
      var ov = document.getElementById('kugou-qr-overlay');
      var box = document.getElementById('kugou-qr-img');
      var note = document.getElementById('kugou-qr-note');
      var img = box ? box.querySelector('img') : null;
      return JSON.stringify({
        overlay: !!ov,
        boxText: box ? box.textContent.slice(0, 80) : null,
        hasImg: !!img,
        imgLen: img ? String(img.src).length : 0,
        imgComplete: img ? img.complete : null,
        imgW: img ? img.naturalWidth : null,
        note: note ? note.textContent : null,
        tabQr: !!document.getElementById('kugou-tab-qr')
      });
    })()`);
    log(tag + ' -> ' + r);
    return JSON.parse(r);
  };

  try {
    await win.loadURL('http://127.0.0.1:' + PORT + '/');
    await new Promise((r) => setTimeout(r, 5000));
    const before = await win.webContents.executeJavaScript(
      'JSON.stringify({ fn: typeof openKugouQrLogin, row: !!document.getElementById("kugou-qr-login-row") })');
    log('before click -> ' + before);

    await win.webContents.executeJavaScript('openKugouQrLogin(); "called"');
    await new Promise((r) => setTimeout(r, 800));
    await snap('after 0.8s');
    await new Promise((r) => setTimeout(r, 4000));
    await snap('after 4.8s');

    // 点击「验证码登录」标签，确认弹窗交互正常（对照）
    await win.webContents.executeJavaScript('document.getElementById("kugou-tab-sms").click(); "ok"');
    await new Promise((r) => setTimeout(r, 800));
    const sms = await win.webContents.executeJavaScript(
      'JSON.stringify({ bodyHasMobile: !!document.getElementById("kugou-sms-mobile"), body: document.getElementById("kugou-qr-body").textContent.slice(0,60) })');
    log('sms tab -> ' + sms);
  } catch (e) {
    log('ERROR ' + (e && e.stack || e));
  }
  try { if (serverProc) serverProc.kill(); } catch (e) {}
  app.quit();
});
