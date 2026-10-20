/**
 * 诊断探针：升级弹窗更新内容条数与滚动。
 * 用法：node_modules/electron/dist/electron.exe scripts/probe-update-notes.js
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 3984;
const OUT = path.join(__dirname, 'out', 'update-notes-probe.json');
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
  serverProc = spawnServer();
  if (!await waitForServer(20000)) { log('server not ready'); app.quit(); return; }

  const win = new BrowserWindow({
    width: 1440, height: 900, show: false,
    webPreferences: { sandbox: false, nodeIntegration: false, contextIsolation: false, offscreen: true }
  });

  try {
    await win.loadURL('http://127.0.0.1:' + PORT + '/');
    await new Promise((r) => setTimeout(r, 5000));
    const longLine = '这是一条特别长的更新说明，用来验证超过七十二个字符的行不会再被整行丢弃，而是会正常折行展示，'.repeat(4);
    const r = await win.webContents.executeJavaScript(`(function(){
      var notes = [];
      for (var i = 1; i <= 5; i++) notes.push('测试更新条目 ' + i + '：修复若干问题');
      notes.splice(2, 0, ${JSON.stringify(longLine)});
      for (var j = 6; j <= 8; j++) notes.push('测试更新条目 ' + j + '：修复若干问题');
      applyLatestUpdateInfo({
        configured: true, preview: true, updateAvailable: true,
        currentVersion: '2.2.4', latestVersion: '2.2.5',
        release: { version: '2.2.5', notes: notes, summary: '汇总一句话' }
      });
      var list = document.getElementById('update-list');
      var items = list ? list.querySelectorAll('.update-item') : [];
      var modal = document.querySelector('#update-modal .update-modal');
      if (modal) modal.style.opacity = '1';
      return JSON.stringify({
        itemsRendered: items.length,
        firstText: items[0] ? items[0].textContent.slice(0, 30) : null,
        lastText: items[items.length - 1] ? items[items.length - 1].textContent.slice(0, 40) : null,
        longLineRendered: Array.prototype.some.call(items, function (it) { return it.textContent.indexOf('…') >= 0 && it.textContent.length > 100; }),
        scrollable: list ? (list.scrollHeight > list.clientHeight) : null,
        listClientH: list ? list.clientHeight : null,
        hero: (document.getElementById('update-hero-main') || {}).textContent || null
      });
    })()`);
    log('result -> ' + r);
  } catch (e) {
    log('ERROR ' + (e && e.stack || e));
  }
  try { if (serverProc) serverProc.kill(); } catch (e) {}
  app.quit();
});

function spawnServer() {
  const { spawn } = require('child_process');
  return spawn(process.execPath, ['server/server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1', PORT: String(PORT), HOST: '127.0.0.1' }),
    stdio: 'ignore'
  });
}
