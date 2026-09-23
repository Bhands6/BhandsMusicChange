/**
 * 离屏 Electron 实测：音源解析面板移除两组设置后的真实 DOM。
 * 移除内容（用户红框）：
 *   ① UnblockMusic / 自定义 API 两个开关
 *   ② 「智能换源服务地址（go-music-api）」整块 + 「缓存维护」整块
 * 关键姿势见 MEMORY.md：直调 electron.exe、no-sandbox、结果落盘。
 */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'out', 'music-sources-panel-probe.json');
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
      // ⚠️ html.simple-mode-preload #fx-panel{display:none!important} —— 不清掉这个类
      // 面板整体 display:none，所有 getBoundingClientRect 都返回 0（踩过）
      document.documentElement.classList.remove('simple-mode-preload');
      document.body.offsetHeight;

      // 打开控制台 + 切到「音源解析」tab + 展开第三方音源分组
      var panel = document.getElementById('fx-panel');
      // ⚠️ 分组 key 是 bhands-advanced，但它挂在 tab 页 system 下（id=fx-console-page-system），
      //    传分组 key 给 setFxPanelTab 无效 → 页面 display:none → 尺寸全 0（踩过）
      if (typeof setFxPanelTab === 'function') setFxPanelTab('system');
      panel.classList.add('show');
      var ms = document.getElementById('fx-music-sources');
      var fold = ms && ms.closest ? ms.closest('.fx-fold') : null;
      if (fold) fold.classList.add('open');
      document.body.offsetHeight;

      // ① 被移除的元素必须不存在
      out.removed = {
        tSrcUnblockMusic: !!document.getElementById('t-src-unblockMusic'),
        tSrcCustom: !!document.getElementById('t-src-custom'),
        goMusicBlock: !!document.getElementById('go-music-block'),
        goMusicApiUrl: !!document.getElementById('go-music-api-url'),
        goMusicApiStatus: !!document.getElementById('go-music-api-status'),
        customApiBlock: !!document.getElementById('custom-api-block'),
        customApiUrl: !!document.getElementById('custom-api-url'),
        customApiMethod: !!document.getElementById('custom-api-method'),
      };
      // ② 文案层面也不该残留
      var allText = document.body.textContent || '';
      out.textLeftover = {
        hasCacheMaintain: allText.indexOf('缓存维护') >= 0,
        hasClearParseCache: allText.indexOf('清除解析缓存') >= 0,
        hasTestConn: allText.indexOf('测试连接') >= 0,
        hasGoMusicApiLabel: allText.indexOf('go-music-api') >= 0,
        hasUnblockLabel: allText.indexOf('UnblockMusic') >= 0,
        hasCustomApiLabel: allText.indexOf('自定义 API') >= 0,
      };
      // ③ 保留的开关必须都在
      out.kept = {
        gdmusic: !!document.getElementById('t-src-gdmusic'),
        goMusic: !!document.getElementById('t-src-goMusic'),
        kugou: !!document.getElementById('t-src-kugou'),
        lxMusic: !!document.getElementById('t-src-lxMusic'),
        uploadBtn: (function(){
          var b = ms ? ms.querySelectorAll('.fx-mini-btn') : [];
          for (var i = 0; i < b.length; i++) if (b[i].textContent.indexOf('上传脚本') >= 0) return true;
          return false;
        })(),
      };
      // ④ 关键约束：解析顺序 seg 必须仍在 #fx-music-sources 内部
      //    （若被 workspace 注册表拽走，面板顶部会留一个没控件的空标题）
      var seg = document.getElementById('source-parse-order-seg');
      out.segInsideBlock = !!(seg && ms && ms.contains(seg));
      out.segInsidePanel = !!(seg && panel && panel.contains(seg));
      out.msInsidePanel = !!(ms && panel && panel.contains(ms));
      // ⑤ 布局：开关网格应只剩 4 个，且能排成 2 行
      var grid = ms ? ms.querySelector('.fx-toggle-grid') : null;
      out.gridChildren = grid ? grid.children.length : -1;
      if (grid) {
        var rects = Array.prototype.slice.call(grid.children).map(function(c){
          var r = c.getBoundingClientRect();
          return { text: (c.textContent || '').trim(), w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) };
        });
        out.gridRects = rects;
        out.gridRows = rects.reduce(function(acc, r){ return acc.indexOf(r.top) < 0 ? acc.concat([r.top]) : acc; }, []).length;
        out.gridWidth = Math.round(grid.getBoundingClientRect().width);
      }
      // ⑥ 折叠逻辑：syncSourceConfigVisibility 现在只该管 LX 脚本块
      if (typeof syncSourceConfigVisibility === 'function') {
        _musicSourcesConfig = { enabledSources: ['gdmusic', 'goMusic', 'kugou', 'lxMusic'] };
        syncSourceConfigVisibility();
        out.lxBlockWhenLxEnabled = getComputedStyle(document.getElementById('lx-script-block')).display;
        _musicSourcesConfig = { enabledSources: ['gdmusic', 'goMusic', 'kugou'] };
        syncSourceConfigVisibility();
        out.lxBlockWhenLxDisabled = getComputedStyle(document.getElementById('lx-script-block')).display;
        out.syncSurvivesRemovedIds = true;
      }
      // ⑦ 面板里不应有空标题（有 .fx-section-label 但其后没有任何控件）
      out.orphanLabels = [];
      if (ms) {
        var kids = Array.prototype.slice.call(ms.querySelectorAll(':scope > .fx-section-label'));
        kids.forEach(function(lbl, i){
          var next = lbl.nextElementSibling;
          var hasControl = next && !next.classList.contains('fx-section-label') &&
            (next.querySelector('input,button,select,.fx-toggle,.fx-seg') || next.matches('input,button,select,.fx-toggle,.fx-seg'));
          if (!hasControl) out.orphanLabels.push((lbl.textContent || '').trim());
        });
      }
      // ⑥b 「音源解析顺序」随官方源会员态显隐 + 开关改名
      if (typeof syncSourceParseOrderVisibility === 'function') {
        var pob = document.getElementById('source-parse-order-block');
        function pobDisplay(ls, qs) {
          loginStatus = ls; qqLoginStatus = qs;
          syncSourceParseOrderVisibility();
          return pob ? getComputedStyle(pob).display : null;
        }
        out.pobNoVip = pobDisplay(
          { loggedIn: true, vipType: 0, isVip: false, isSvip: false },
          { provider: 'qq', loggedIn: false, vipType: 0 });
        out.pobNeteaseVip = pobDisplay(
          { loggedIn: true, vipType: 1, isVip: true, isSvip: false },
          { provider: 'qq', loggedIn: false, vipType: 0 });
        out.pobNeteaseSvip = pobDisplay(
          { loggedIn: true, vipType: 10, isVip: true, isSvip: true },
          { provider: 'qq', loggedIn: false, vipType: 0 });
        out.pobQqVip = pobDisplay(
          { loggedIn: false, vipType: 0 },
          { provider: 'qq', loggedIn: true, vipType: 1 });
        out.pobNoLogin = pobDisplay(
          { loggedIn: false, vipType: 0 },
          { provider: 'qq', loggedIn: false, vipType: 0 });
      }
      out.goMusicLabel = ((document.getElementById('t-src-goMusic') || {}).textContent || '').trim();
      out.hasOldGoMusicName = (document.body.textContent || '').indexOf('智能换源') >= 0;

      out.panelH = Math.round(panel.getBoundingClientRect().height);
      // ⑧ 关键回归：我改过的 syncMusicSourcesUI 在「所有已删元素都不存在」时不能抛异常
      if (typeof syncMusicSourcesUI === 'function') {
        _musicSourcesConfig = {
          enabledSources: ['gdmusic', 'goMusic', 'kugou', 'lxMusic'],
          lxMusicScripts: [], activeLxMusicApiId: null,
          customApiUrl: '', customApiMethod: 'GET', goMusicApiUrl: ''
        };
        try { syncMusicSourcesUI(); out.syncUiOk = true; }
        catch (e) { out.syncUiOk = false; out.syncUiErr = e.message; }
        out.toggleOnState = ['gdmusic','goMusic','kugou','lxMusic'].map(function(s){
          var el = document.getElementById('t-src-' + s);
          return el ? el.classList.contains('on') : null;
        });
      }
      // 诊断：网格的祖先链为什么量不到尺寸
      out.chain = [];
      var cur = grid;
      while (cur && cur !== document.body) {
        var cs = getComputedStyle(cur);
        var r = cur.getBoundingClientRect();
        out.chain.push({
          tag: cur.tagName.toLowerCase(),
          id: cur.id || '',
          cls: (cur.className || '').toString().slice(0, 70),
          display: cs.display,
          visibility: cs.visibility,
          w: Math.round(r.width), h: Math.round(r.height),
        });
        cur = cur.parentElement;
      }
      out.activeTab = (typeof fxPanelTab !== 'undefined') ? fxPanelTab : '(undef)';
      out.tabPages = Array.prototype.slice.call(document.querySelectorAll('#fx-panel .fx-tab-page')).map(function(p){
        return { key: p.getAttribute('data-fx-tab-page') || p.getAttribute('data-fx-tab') || '', display: getComputedStyle(p).display, cls: (p.className||'').toString().slice(0,60) };
      });
      return JSON.stringify(out);
    })()`);
    LOGLINE('RESULT ' + result);
  } catch (e) {
    LOGLINE('ERROR ' + (e && e.message));
  }
  app.quit();
});
app.on('window-all-closed', function () { app.quit(); });
