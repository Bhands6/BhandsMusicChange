'use strict';

/* ============================================================================
 *  19-splash-video.js  —  启动页视频：清单 / 下载 / 切换（2026-10-23 新增）
 *
 *  安装包内置只有默认那条（滑雪，public/media/splash-bg.mp4）。
 *  其余候选放在 CNB 资源仓库（BhandsCnb/BhandsMusicVideo），用户点「下载」后由
 *  server.js 落到 userData/splash-videos/<id>.mp4，选择记 userData/splash-video.json，
 *  启动页（17-shell.js 的 initSplashBgVideoFallback）按记录决定播哪条。
 *
 *  面板挂在控制台「动效」页最上方，容器 #splash-video-grid 由 fx-console-workspace 搬过去。
 *
 *  ⚠️ app/*.js 的加载期顺序由 scripts/check-app-reorg.js 的基线守着：
 *     本文件末尾只允许「var 初始化 + setTimeout 延后绑定」，不要在加载期直接读 DOM。
 * ========================================================================== */

var splashVideoPanel = {
  items: [],          // 远端清单 items
  selected: 'builtin',
  downloaded: [],
  error: '',
  loading: false,
  loadedOnce: false,
  busy: {},           // id -> { status: downloading|done|error, received, total, error }
  pollTimer: null
};

function splashVideoBytes(n) {
  n = Number(n) || 0;
  if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
  if (n >= 1024) return Math.round(n / 1024) + ' KB';
  return n + ' B';
}

function splashVideoThumbHtml(item) {
  if (item && item.thumb) {
    return '<img src="' + escHtml(item.thumb) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">';
  }
  // 内置那条没有远端缩略图：画一个雪花占位
  return '<svg viewBox="0 0 48 48" class="sv-placeholder" aria-hidden="true">' +
    '<g stroke="rgba(210,232,255,.55)" stroke-width="1.6" stroke-linecap="round">' +
    '<path d="M24 8v32M9.2 16l29.6 16M38.8 16L9.2 32"/></g></svg>';
}

function splashVideoActionHtml(item) {
  var p = splashVideoPanel;
  var busy = p.busy[item.id];
  var downloaded = item.id === 'builtin' || p.downloaded.indexOf(item.id) >= 0 || item.downloaded;
  var current = p.selected === item.id;

  if (busy && busy.status === 'downloading') {
    var pct = busy.total ? Math.max(1, Math.round((busy.received / busy.total) * 100)) : 0;
    return '<div class="sv-progress"><i style="width:' + pct + '%"></i></div>' +
           '<button class="sv-btn" type="button" disabled>' + (busy.total ? '下载中 ' + pct + '%' : '下载中…') + '</button>';
  }
  if (busy && busy.status === 'error') {
    return '<button class="sv-btn danger" type="button" onclick="startSplashVideoDownload(\'' + item.id + '\')" title="' +
           escHtml(busy.error || '下载失败') + '">重试</button>';
  }
  if (current) return '<button class="sv-btn current" type="button" disabled>使用中</button>';
  if (downloaded) return '<button class="sv-btn primary" type="button" onclick="selectSplashVideo(\'' + item.id + '\')">使用</button>';
  return '<button class="sv-btn primary" type="button" onclick="startSplashVideoDownload(\'' + item.id + '\')">下载</button>';
}

function renderSplashVideoPanel() {
  var host = document.getElementById('splash-video-grid');
  if (!host) return;
  var p = splashVideoPanel;
  if (p.loading && !p.items.length) {
    host.innerHTML = '<div class="splash-video-hint">正在读取视频清单…</div>';
    return;
  }

  var list = [{ id: 'builtin', name: '滑雪（内置）', desc: '', bytes: 0, thumb: 'media/splash-bg-thumb.jpg' }]
    .concat(p.items.filter(function (it) { return it && it.id && it.id !== 'builtin'; }));

  var cards = list.map(function (item) {
    var current = p.selected === item.id;
    var meta = item.id === 'builtin'
      ? '内置 · 随包分发'
      : (splashVideoBytes(item.bytes) + (item.desc ? ' · ' + item.desc : ''));
    return '<div class="splash-video-card' + (current ? ' current' : '') + '">' +
      '<div class="sv-thumb">' + splashVideoThumbHtml(item) +
        (current ? '<span class="sv-badge">使用中</span>' : '') +
      '</div>' +
      '<div class="sv-meta"><b>' + escHtml(item.name || item.id) + '</b><small>' + escHtml(meta) + '</small></div>' +
      splashVideoActionHtml(item) +
    '</div>';
  }).join('');

  host.innerHTML =
    '<div class="splash-video-head">' +
      '<span class="splash-video-note">' + (p.error
        ? '离线：' + escHtml(p.error)
        : '内置默认之外，点下载后即可切换') + '</span>' +
      '<button class="fx-mini-btn ghost" type="button" onclick="fetchSplashVideoList(true)">刷新</button>' +
    '</div>' +
    '<div class="splash-video-list">' + cards + '</div>';
}

function fetchSplashVideoList(force) {
  var p = splashVideoPanel;
  p.loading = true;
  renderSplashVideoPanel();
  var url = '/api/splash/videos' + (force ? '?refresh=1' : '');
  fetch(url, { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      p.loading = false;
      p.loadedOnce = true;
      p.error = d && d.ok === false ? (d.error || '清单不可用') : '';
      p.items = (d && d.items) || [];
      p.downloaded = (d && d.downloaded) || [];
      p.selected = (d && d.selected) || 'builtin';
      p.busy = {};
      renderSplashVideoPanel();
    })
    .catch(function (e) {
      p.loading = false;
      p.loadedOnce = true;
      p.error = (e && e.message) || '网络错误';
      renderSplashVideoPanel();
    });
}

function startSplashVideoDownload(id) {
  var p = splashVideoPanel;
  p.busy[id] = { status: 'downloading', received: 0, total: 0, error: '' };
  renderSplashVideoPanel();
  fetch('/api/splash/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: id })
  })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!d || !d.ok) throw new Error((d && d.error) || '下载启动失败');
      if (d.already) { p.busy[id] = { status: 'done' }; fetchSplashVideoList(); return; }
      startSplashVideoPoll();
    })
    .catch(function (e) {
      p.busy[id] = { status: 'error', error: (e && e.message) || '下载失败' };
      renderSplashVideoPanel();
    });
}

function startSplashVideoPoll() {
  var p = splashVideoPanel;
  if (p.pollTimer) return;
  var tick = function () {
    fetch('/api/splash/progress', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var downloading = false;
        var states = (d && d.states) || {};
        Object.keys(states).forEach(function (id) {
          var s = states[id];
          p.busy[id] = s;
          if (s && s.status === 'downloading') downloading = true;
        });
        if (Array.isArray(d && d.downloaded)) p.downloaded = d.downloaded;
        renderSplashVideoPanel();
        if (downloading) {
          p.pollTimer = setTimeout(tick, 400);
        } else {
          p.pollTimer = null;
          fetchSplashVideoList();      // 收尾：重新拉清单，让「下载」变「使用」
        }
      })
      .catch(function () {
        p.pollTimer = setTimeout(tick, 1200);
      });
  };
  p.pollTimer = setTimeout(tick, 300);
}

function selectSplashVideo(id) {
  fetch('/api/splash/select', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: id })
  })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!d || !d.ok) throw new Error((d && d.error) || '切换失败');
      splashVideoPanel.selected = d.selected;
      renderSplashVideoPanel();
      showToast(id === 'builtin' ? '已切回内置启动视频' : '已切换启动页视频，下次启动生效');
    })
    .catch(function (e) {
      showToast('切换失败：' + ((e && e.message) || '未知错误'));
    });
}

function initSplashVideoPanel() {
  if (splashVideoPanel.loadedOnce || splashVideoPanel.loading) return;
  fetchSplashVideoList();
}

/* 控制台平时隐藏：用户第一次把鼠标移进面板 / 点 FAB 时才拉清单，别抢启动带宽。
 * 延后到 setTimeout 里绑定，避免在脚本加载期读 DOM（加载期顺序由基线守着）。 */
setTimeout(function () {
  var panel = document.getElementById('fx-panel');
  if (!panel) return;
  var kick = function () {
    initSplashVideoPanel();
  };
  panel.addEventListener('mouseenter', kick, { once: true });
  panel.addEventListener('click', kick, { once: true });
  var fab = document.getElementById('fx-fab');
  if (fab) fab.addEventListener('click', kick, { once: true });
}, 0);
