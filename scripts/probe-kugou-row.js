/**
 * 离屏 Electron 实测：酷狗扫码登录行的文字排版。
 * 目标 = 标签「酷狗扫码登录」一行，状态文案（蓝色）另起一行。
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'out', 'kugou-row-probe.json');
try { fs.mkdirSync(path.dirname(OUT), { recursive: true }); } catch (e) {}
const LOG = [];
function LOGLINE(s) { LOG.push(s); try { fs.writeFileSync(OUT, JSON.stringify(LOG, null, 2)); } catch (e) {} }

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('in-process-gpu');

app.whenReady().then(async function () {
  const win = new BrowserWindow({
    width: 1440, height: 900, show: false,
    webPreferences: { sandbox: false, nodeIntegration: false, contextIsolation: false, offscreen: true },
  });
  try {
    await win.loadFile(path.join(ROOT, 'public/index.html'));
    LOGLINE('loaded');
    await new Promise(r => setTimeout(r, 2500));

    const result = await win.webContents.executeJavaScript(`(function(){
      var out = {};
      document.body.classList.remove('splash-active', 'simple-mode');
      document.body.classList.add('desktop-shell', 'diy-mode');
      document.documentElement.classList.remove('simple-mode-preload');
      if (typeof setFxPanelTab === 'function') setFxPanelTab('system');
      var panel = document.getElementById('fx-panel');
      panel.classList.add('show');
      var ms = document.getElementById('fx-music-sources');
      var fold = ms && ms.closest ? ms.closest('.fx-fold') : null;
      if (fold) fold.classList.add('open');
      document.body.offsetHeight;

      var row = document.getElementById('kugou-qr-login-row');
      if (!row) { out.error = 'kugou-qr-login-row 不存在'; return JSON.stringify(out); }
      var label = row.querySelector('span:first-child');
      var dot = row.querySelector('.dot');
      var status = document.getElementById('kugou-login-status');
      // 模拟「已登录 · 音质已启用」（file:// 下拉不到真实状态）
      status.textContent = '已登录 · 音质已启用';
      status.style.color = 'rgb(0,245,212)';
      document.body.offsetHeight;
      var raf2 = new Promise(function(res){ requestAnimationFrame(function(){ requestAnimationFrame(res); }); });
      return raf2.then(function(){
        var rr = row.getBoundingClientRect();
        var lr = label.getBoundingClientRect();
        var dr = dot.getBoundingClientRect();
        var sr = status.getBoundingClientRect();
        out.row = { w: Math.round(rr.width), h: Math.round(rr.height), left: Math.round(rr.left) };
        out.parentGrid = {
          cls: (row.parentElement.className || '').toString(),
          cols: getComputedStyle(row.parentElement).gridTemplateColumns,
        };
        out.rowFlex = {
          display: getComputedStyle(row).display,
          wrap: getComputedStyle(row).flexWrap,
          justify: getComputedStyle(row).justifyContent,
          align: getComputedStyle(row).alignItems,
        };
        out.label = {
          text: label.textContent,
          truncated: label.scrollWidth > label.clientWidth + 1,
          scrollW: label.scrollWidth, clientW: label.clientWidth,
          top: Math.round(lr.top), w: Math.round(lr.width),
        };
        out.dot = { top: Math.round(dr.top), left: Math.round(dr.left) };
        out.status = {
          text: status.textContent,
          top: Math.round(sr.top), w: Math.round(sr.width), h: Math.round(sr.height),
          color: getComputedStyle(status).color,
          fontSize: getComputedStyle(status).fontSize,
        };
        // 关键判定
        out.labelAndStatusSameLine = Math.abs(lr.top - sr.top) < 3;
        out.labelAndDotSameLine = Math.abs(lr.top - dr.top) < 4;
        out.statusBelowLabel = sr.top > lr.bottom - 2;
        out.statusStartsAtLeft = Math.abs(sr.left - lr.left) < 4;

        // 三种真实状态文案逐一体检：标签不许截断、状态行数、卡片高度
        out.states = ['未登录', '已登录 · 音源未开', '已登录 · 音质已启用'].map(function (txt) {
          status.textContent = txt;
          document.body.offsetHeight;
          var st = status.getBoundingClientRect();
          var lb = label.getBoundingClientRect();
          var rb = row.getBoundingClientRect();
          return {
            text: txt,
            labelTruncated: label.scrollWidth > label.clientWidth + 1,
            statusLines: Math.round(st.height / (parseFloat(getComputedStyle(status).lineHeight) || 14)),
            statusW: Math.round(st.width),
            statusBelow: st.top > lb.bottom - 2,
            statusLeftAligned: Math.abs(st.left - lb.left) < 4,
            rowH: Math.round(rb.height),
          };
        });
        status.textContent = '已登录 · 音质已启用';
        return JSON.stringify(out);
      });
    })()`);
    LOGLINE('RESULT ' + result);
  } catch (e) {
    LOGLINE('ERROR ' + (e && e.message));
  }
  app.quit();
});
app.on('window-all-closed', function () { app.quit(); });
