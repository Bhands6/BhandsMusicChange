/**
 * 诊断探针：标题栏「?」按钮的平台归属（Windows 应在右侧窗口按钮组首位）。
 * 用法：node_modules/electron/dist/electron.exe scripts/probe-titlebar-guide.js
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = 39780;
const OUT = path.join(__dirname, 'out', 'titlebar-guide-probe.json');
try { fs.mkdirSync(path.dirname(OUT), { recursive: true }); } catch (e) {}
const LOG = [];
function log(s) { LOG.push(s); try { fs.writeFileSync(OUT, JSON.stringify(LOG, null, 2)); } catch (e) {} }

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('in-process-gpu');

app.whenReady().then(async () => {
  const server = spawn(process.execPath, ['server/server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1', PORT: String(PORT), HOST: '127.0.0.1' }),
    stdio: 'ignore'
  });
  const win = new BrowserWindow({
    width: 1440, height: 900, show: false,
    webPreferences: { sandbox: false, nodeIntegration: false, contextIsolation: false, offscreen: true }
  });
  try {
    await win.loadURL('http://127.0.0.1:' + PORT + '/');
    await new Promise((r) => setTimeout(r, 5000));
    const r = await win.webContents.executeJavaScript(`(function(){
      var btn = document.getElementById('visual-guide-btn');
      var left = document.querySelector('.desktop-titlebar-left');
      var b = btn ? btn.getBoundingClientRect() : null;
      var cs = btn ? getComputedStyle(btn) : null;
      return JSON.stringify({
        platformClass: document.documentElement.className,
        parentClass: btn ? btn.parentElement.className : null,
        firstInParent: btn && btn.parentElement ? btn.parentElement.firstElementChild === btn : null,
        leftSlotChildren: left ? left.children.length : null,
        rect: b ? { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } : null,
        isRightHalf: b ? b.x > (window.innerWidth / 2) : null,
        display: cs ? cs.display : null,
        opacity: cs ? cs.opacity : null
      });
    })()`);
    log('result -> ' + r);
  } catch (e) {
    log('ERROR ' + (e && e.stack || e));
  }
  try { server.kill(); } catch (e) {}
  app.quit();
});
