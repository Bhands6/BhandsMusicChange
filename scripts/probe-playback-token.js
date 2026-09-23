/**
 * 离屏 Electron 实测：播放路径的 `trackSwitchToken` 是否真的可用。
 *
 * 背景：一次批量死代码移除里，`var volumeTween = null, trackSwitchToken = 0;`
 * 被整行删掉（trackSwitchToken 是**在用**的），运行时点歌直接弹
 * 「播放失败: trackSwitchToken is not defined」。
 * 本探针复现该场景：真跑一次 playQueueAt(0)，断言抛出的错误**不是** ReferenceError。
 *
 * 姿势见 MEMORY.md：直调 electron.exe、no-sandbox、结果落盘（别靠 stdout）。
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'out', 'playback-token-probe.json');
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
    // 先挂错误收集：main.js 是普通脚本，load 期间任何未捕获错误都记下来
    await win.loadFile(path.join(ROOT, 'public/index.html'));
    LOGLINE('loaded');
    await new Promise(r => setTimeout(r, 2500));

    const result = await win.webContents.executeJavaScript(`(async function(){
      var out = { errors: [] };
      window.addEventListener('error', function(e){ out.errors.push(String(e.message || e)); });

      // ① 全局是否存在（main.js 顶层 var 会挂到 window）
      out.typeofToken = typeof window.trackSwitchToken;
      out.tokenValue = window.trackSwitchToken;
      out.tokenIsNumber = typeof window.trackSwitchToken === 'number' && window.trackSwitchToken === 0;

      // ② 播放路径上的关键函数是否都在
      out.fns = {};
      ['playQueueAt','playbackFailureToastText','scheduleCoverResolutionReload','applyCoverDataUrl']
        .forEach(function(n){ out.fns[n] = typeof window[n]; });

      // ③ 复现用户场景：真跑一次 playQueueAt(0)，看抛出来的错是不是 ReferenceError
      document.body.classList.remove('splash-active','simple-mode');
      document.body.classList.add('desktop-shell');
      try {
        playQueue[0] = { id: 1, name: '__probe__', artists: 'probe', localKey: 'probe' };
        currentIdx = 0;
        await playQueueAt(0);
        out.playOutcome = 'no-throw';
      } catch (e) {
        out.playOutcome = 'threw';
        out.playErrorName = e && e.name;
        out.playErrorMsg = String(e && e.message || e);
      }
      out.refErrorOnToken = /is not defined/.test(String(out.playErrorMsg || '')) &&
                            /trackSwitchToken/.test(String(out.playErrorMsg || ''));
      return out;
    })()`);

    LOGLINE('RESULT ' + JSON.stringify(result));
  } catch (e) {
    LOGLINE('FATAL ' + (e && e.stack || e));
  }
  app.quit();
});
