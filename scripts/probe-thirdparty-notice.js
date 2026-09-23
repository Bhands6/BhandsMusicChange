/**
 * 离屏 Electron 实测：真实页面里调 tryThirdPartyParse，读 #source-fallback-notice 的
 * 真实 title/body，确认第三方优先路径的文案不再说「官方音源不可用」。
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'out', 'thirdparty-notice-probe.json');
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

    const result = await win.webContents.executeJavaScript(`(async function(){
      document.body.classList.remove('splash-active', 'simple-mode');
      document.body.classList.add('desktop-shell');
      document.body.offsetHeight;
      var out = {};
      var notice = document.getElementById('source-fallback-notice');
      var titleEl = document.getElementById('source-fallback-title');
      var bodyEl = document.getElementById('source-fallback-body');
      var song = { id: 2623517920, name: '晴天', artist: '周杰伦', artists: [{ name: '周杰伦' }], dt: 269000 };
      var realFetch = window.fetch;
      window.fetch = function () {
        return Promise.resolve({ ok: true, json: function () {
          return Promise.resolve({ url: 'http://127.0.0.1:9/fake.flac', source: 'kugou', level: 'lossless', br: 999000 });
        } });
      };
      function snap(tag){ return { tag: tag, shown: notice.classList.contains('show'), title: titleEl.textContent, body: bodyEl.textContent }; }
      // 记录每一次提示调用（否则只能看到最后一条，中间那条被覆盖了）
      var calls = [];
      var origNotice = window.showSourceFallbackNotice;
      window.showSourceFallbackNotice = function (t, b) { calls.push(t + ' / ' + b); return origNotice(t, b); };
      try {
        // ① 第三方优先路径（不传 opts）：不应出现「官方音源不可用」
        calls.length = 0;
        notice.classList.remove('show'); titleEl.textContent = ''; bodyEl.textContent = '';
        await tryThirdPartyParse(song, 'hires');
        out.thirdPartyFirst = snap('第三方优先');
        out.thirdPartyFirstCalls = calls.slice();
        out.firstBodyHasWrongText = calls.some(function (c) { return /官方音源不可用/.test(c); });

        // ② 官方失败兜底路径：文案应保留「官方音源不可用」
        calls.length = 0;
        notice.classList.remove('show'); titleEl.textContent = ''; bodyEl.textContent = '';
        await tryThirdPartyParse(song, 'hires', { officialFailed: true });
        out.officialFailed = snap('官方失败兜底');
        out.officialFailedCalls = calls.slice();

        // ③ 静默（预解析）：不应出现提示
        calls.length = 0;
        notice.classList.remove('show'); titleEl.textContent = ''; bodyEl.textContent = '';
        await tryThirdPartyParse(song, 'hires', { silent: true });
        out.silent = snap('静默预解析');
        out.silentCalls = calls.slice();

        // ④ 预解析命中补提示（播放时补报，不重新解析）
        out.preparse = {};
        function probePreparse(tag, data) {
          calls.length = 0;
          notice.classList.remove('show'); titleEl.textContent = ''; bodyEl.textContent = '';
          notifyPreparsedSourceNotice(data);
          return { tag: tag, calls: calls.slice(), shown: notice.classList.contains('show'),
                   title: titleEl.textContent, body: bodyEl.textContent };
        }
        out.preparse.thirdParty = probePreparse('第三方', { url: 'http://127.0.0.1:9/a.flac', source: 'third-party', thirdPartySource: 'kugou', level: 'lossless', br: 999000 });
        out.preparse.official = probePreparse('官方', { url: 'http://127.0.0.1:9/b.flac', source: 'netease', level: 'lossless', br: 999000 });
        out.preparse.officialNoQuality = probePreparse('官方无档位', { url: 'http://127.0.0.1:9/c.mp3', source: 'netease' });
        out.preparse.trial = probePreparse('试听', { url: 'http://127.0.0.1:9/d.mp3', trial: true, source: 'netease', level: 'standard', br: 128000 });
        out.preparse.none = probePreparse('无 url', null);
      } finally {
        window.showSourceFallbackNotice = origNotice;
        window.fetch = realFetch;
      }
      return JSON.stringify(out);
    })()`);
    LOGLINE('RESULT ' + result);
  } catch (e) {
    LOGLINE('ERROR ' + (e && e.message));
  }
  app.quit();
});
app.on('window-all-closed', function () { app.quit(); });
