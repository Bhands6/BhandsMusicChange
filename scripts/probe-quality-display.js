/**
 * 离屏 Electron 实测：音质面板「只列账号存在的档位 + 高亮跟随实际播放」的真实渲染。
 * 关键姿势见 MEMORY.md：直调 electron.exe、no-sandbox、结果落盘。
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'out', 'quality-display-probe.json');
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
      document.body.classList.add('desktop-shell');
      document.body.offsetHeight;
      var opts = function(){ return Array.prototype.slice.call(document.querySelectorAll('.quality-option')); };
      function snap(tag){
        return {
          tag: tag,
          label: document.getElementById('quality-btn-label').textContent,
          visible: opts().filter(function(o){ return getComputedStyle(o).display !== 'none'; }).map(function(o){ return o.dataset.quality; }),
          active: (opts().filter(function(o){ return o.classList.contains('active'); })[0] || {}).dataset
            ? opts().filter(function(o){ return o.classList.contains('active'); })[0].dataset.quality : null,
          popoverH: Math.round(document.querySelector('.quality-popover').getBoundingClientRect().height),
        };
      }
      out.hasFn = (typeof updatePlaybackQualityUi === 'function') && (typeof availableQualityTiers === 'function');

      // 非会员 + 实际解析出无损
      loginStatus = { loggedIn: true, vipType: 0, isVip: false, isSvip: false };
      playbackQuality = 'jymaster';
      noteResolvedPlaybackQuality({ url: 'x', level: 'lossless', br: 879000, thirdPartySource: 'kugou' });
      out.free = snap('非会员');
      out.freeTitle = document.getElementById('quality-btn').title;
      // 被隐藏项的 computed display 必须是 none（验证 CSS 特异性）
      var jy = opts().filter(function(o){ return o.dataset.quality === 'jymaster'; })[0];
      out.hiddenDisplay = jy ? getComputedStyle(jy).display : null;
      out.hiddenAttr = jy ? jy.hidden : null;

      // 实际降到 320k → 高亮应跟过去
      noteResolvedPlaybackQuality({ url: 'x', level: 'exhigh', br: 320000, thirdPartySource: 'gdmusic' });
      out.free320 = snap('非会员320k');

      // VIP（非 SVIP）
      loginStatus = { loggedIn: true, vipType: 1, isVip: true, isSvip: false };
      playbackQuality = 'jymaster';
      updatePlaybackQualityUi();
      out.vip = snap('VIP');

      // SVIP
      loginStatus = { loggedIn: true, vipType: 10, isVip: true, isSvip: true };
      updatePlaybackQualityUi();
      out.svip = snap('SVIP');

      // 非会员无实际数据 + 偏好母带 → 收敛到无损
      loginStatus = { loggedIn: true, vipType: 0, isVip: false, isSvip: false };
      noteResolvedPlaybackQuality({ url: 'local', source: 'local' });  // 清空实际
      playbackQuality = 'jymaster';
      updatePlaybackQualityUi();
      out.freeNoData = snap('非会员无数据');
      return JSON.stringify(out);
    })()`);
    LOGLINE('RESULT ' + result);
  } catch (e) {
    LOGLINE('ERROR ' + (e && e.message));
  }
  app.quit();
});
app.on('window-all-closed', function () { app.quit(); });
