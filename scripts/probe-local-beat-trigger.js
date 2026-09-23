/**
 * 断言「本地歌曲播放 → 本地节拍分析」这条接线真的接上了。
 *
 * 背景：移植上游「本地音乐库」时把本地播放折进 playQueueAt 的 isLocalPlayback 分支，
 * 漏掉了 currentLocalSong = song 和那个 setTimeout → 本地节拍功能静默失效 6 天，
 * 直到对比上游 05-playback/13-playback-start-audio.js 才发现。
 *
 * 本探针只验**接线**（不验音频管线）：
 *   ① playQueueAt 播本地曲时把 currentLocalSong 赋上
 *   ② 520/680ms 后确实调到 prepareLocalBeatAnalysis，且拿到正确的 localKey / localUrl
 * 音频相关的外部依赖（playAudio / fetchLyric / beginListenSession）用桩绕开，
 * prepareLocalBeatAnalysis 本身也换成 spy —— 内部要读盘/弹窗，不该由接线测试承担。
 *
 * 姿势见 SKILL.md：直调 electron.exe、no-sandbox、结果落盘（别靠 stdout）。
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'out', 'local-beat-trigger-probe.json');
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
    await new Promise((r) => setTimeout(r, 2500));

    const result = await win.webContents.executeJavaScript(`(async function(){
      var out = { errors: [] };
      window.addEventListener('error', function(e){ out.errors.push(String(e.message || e)); });

      document.body.classList.remove('splash-active', 'simple-mode');
      document.body.classList.add('desktop-shell');

      out.typeofFn = typeof window.prepareLocalBeatAnalysis;
      out.typeofOpen = typeof window.openLocalBeatModal;
      if (out.typeofFn !== 'function') { out.verdict = 'FATAL 函数不存在'; return out; }

      // 桩：绕开真实音频管线与网络，只验接线
      window.playAudio = async function(){ return true; };
      window.fetchLyric = function(){};
      window.beginListenSession = function(){};

      var calls = [];
      window.prepareLocalBeatAnalysis = function(song, url){ calls.push({ key: song && song.localKey, url: url }); };

      out.currentLocalSongBefore = currentLocalSong ? currentLocalSong.localKey : null;

      playQueue[0] = { id: 1, name: '__probe_local__', artists: 'probe', type: 'local',
                       localKey: 'probe-local-key', localUrl: 'file:///nonexistent-probe.mp3', duration: 0 };
      currentIdx = 0;
      try { await playQueueAt(0, {}); out.playOutcome = 'no-throw'; }
      catch (e) { out.playOutcome = 'threw'; out.playError = String((e && e.message) || e); }

      out.currentLocalSongAfter = currentLocalSong ? currentLocalSong.localKey : null;

      await new Promise(function(r){ setTimeout(r, 1000); });   // 等 520/680ms 的 setTimeout
      out.calls = calls;
      out.called = calls.length > 0;
      out.argKeyOk = calls.length > 0 && calls[0].key === 'probe-local-key';
      out.argUrlOk = calls.length > 0 && calls[0].url === 'file:///nonexistent-probe.mp3';
      return out;
    })()`);

    LOGLINE('RESULT ' + JSON.stringify(result));
  } catch (e) {
    LOGLINE('FATAL ' + ((e && e.stack) || e));
  }
  app.quit();
});
app.on('window-all-closed', () => app.quit());
