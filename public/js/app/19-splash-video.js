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
  refreshing: false,
  busy: {},           // id -> { status: downloading|done|error, received, total, error }
  pollTimer: null,
  source: '',         // 实际用的源：cnb | github
  sourceLabel: '',
  sourcePref: 'auto', // 用户偏好：auto | cnb | github
  uploading: false
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
  var isBuiltin = item.id === 'builtin';
  var downloaded = isBuiltin || p.downloaded.indexOf(item.id) >= 0 || item.downloaded;
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

  var useBtn = current
    ? '<button class="sv-btn current" type="button" disabled>使用中</button>'
    : '<button class="sv-btn primary" type="button" onclick="selectSplashVideo(\'' + item.id + '\')">使用</button>';

  // 内置那条在安装包里，删不掉，只给一个按钮
  if (isBuiltin) return useBtn;

  // 还没下载：只给「下载」
  if (!downloaded) {
    return '<button class="sv-btn primary" type="button" onclick="startSplashVideoDownload(\'' + item.id + '\')">下载</button>';
  }

  // 已下载（含自己上传的）：左「删除」右「使用 / 使用中」
  return '<div class="sv-actions">' +
    '<button class="sv-btn danger" type="button" onclick="deleteSplashVideo(\'' + item.id + '\')">删除</button>' +
    useBtn +
  '</div>';
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

  var prefText = p.sourcePref === 'auto' ? '自动' : '锁定';
  var srcText = p.sourceLabel || '未连接';
  host.innerHTML =
    '<div class="splash-video-head">' +
      '<button class="sv-src" type="button" onclick="cycleSplashSource()" ' +
        'title="点击切换下载源：自动（竞速）/ CNB / GitHub。国内用 CNB，开 VPN 用 GitHub">' +
        '源 ' + escHtml(srcText) + ' · ' + prefText +
      '</button>' +
      '<div class="sv-tools">' +
        '<button class="sv-tool" type="button" onclick="clearSplashVideos()" title="删除所有已下载的视频（含自己上传的），启动页回到内置默认">清理</button>' +
        '<button class="sv-tool" type="button" onclick="pickSplashVideoFile()"' +
          (p.uploading ? ' disabled' : '') + ' title="上传本地 MP4 作为启动页">' +
          (p.uploading ? '上传中…' : '上传') + '</button>' +
        '<button class="sv-tool" type="button" onclick="fetchSplashVideoList(true)"' +
          (p.refreshing ? ' disabled' : '') + '>' + (p.refreshing ? '刷新中…' : '刷新') + '</button>' +
      '</div>' +
    '</div>' +
    '<div class="sv-tip">' +
      '自己上传：MP4（H.264）· 建议 1920×1080（最低 1280×720）· ≤40MB · 5~15 秒最佳；' +
      '首尾画面一致循环才不跳' +
    '</div>' +
    '<div class="splash-video-list">' + cards + '</div>' +
    (p.error ? '<div class="splash-video-note">离线：' + escHtml(p.error) + '</div>' : '');
}

function fetchSplashVideoList(force) {
  var p = splashVideoPanel;
  p.loading = true;
  if (force) p.refreshing = true;
  renderSplashVideoPanel();
  var url = '/api/splash/videos' + (force ? '?refresh=1' : '');
  fetch(url, { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      p.loading = false;
      p.refreshing = false;
      p.loadedOnce = true;
      p.error = d && d.ok === false ? (d.error || '清单不可用') : '';
      p.items = (d && d.items) || [];
      p.downloaded = (d && d.downloaded) || [];
      p.selected = (d && d.selected) || 'builtin';
      p.source = (d && d.source) || '';
      p.sourceLabel = (d && d.sourceLabel) || '';
      p.sourcePref = (d && d.sourcePref) || 'auto';
      p.busy = {};
      renderSplashVideoPanel();
      if (force) showToast(p.error ? '刷新失败：' + p.error : '清单已更新（' + p.items.length + ' 条）');
    })
    .catch(function (e) {
      p.loading = false;
      p.refreshing = false;
      p.loadedOnce = true;
      p.error = (e && e.message) || '网络错误';
      renderSplashVideoPanel();
      if (force) showToast('刷新失败：' + p.error);
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

/* 清理：删掉所有已下载的视频（含自定义），回到内置默认 */
function clearSplashVideos() {
  var p = splashVideoPanel;
  if (!p.downloaded || !p.downloaded.length) {
    showToast('没有已下载的视频');
    return;
  }
  var ok = window.confirm('确定删除全部 ' + p.downloaded.length + ' 个已下载视频吗？\n' +
    '（包括自己上传的那条，删除后启动页回到内置默认视频）');
  if (!ok) return;
  fetch('/api/splash/clear', { method: 'POST' })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!d || !d.ok) throw new Error((d && d.error) || '清理失败');
      showToast('已清理 ' + d.removed + ' 个文件，释放 ' + (d.freed / 1048576).toFixed(1) + 'MB');
      fetchSplashVideoList(true);
    })
    .catch(function (e) {
      showToast('清理失败：' + ((e && e.message) || '未知错误'));
    });
}

function pickSplashVideoFile() {
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = 'video/mp4';
  input.style.display = 'none';
  input.addEventListener('change', function () {
    var file = input.files && input.files[0];
    if (file) uploadSplashVideo(file);
    try { input.remove(); } catch (e) {}
  });
  document.body.appendChild(input);
  input.click();
}

/* 从本地文件抽一帧当缩略图，顺便读宽高和时长（服务端还会再校验一次） */
function captureSplashFrame(file, done) {
  var url = URL.createObjectURL(file);
  var video = document.createElement('video');
  var finished = false;
  var finish = function (dataUrl, w, h, dur) {
    if (finished) return;
    finished = true;
    try { URL.revokeObjectURL(url); } catch (e) {}
    done(dataUrl, w, h, dur);
  };
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.addEventListener('loadeddata', function () {
    var dur = Number(video.duration) || 0;
    video.currentTime = dur > 0 ? Math.min(1, dur / 2) : 0.5;
  });
  video.addEventListener('seeked', function () {
    var dataUrl = '';
    try {
      var c = document.createElement('canvas');
      var w = video.videoWidth || 480;
      var hgt = video.videoHeight || 270;
      c.width = 480;
      c.height = Math.max(1, Math.round(480 * hgt / w));
      c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
      dataUrl = c.toDataURL('image/jpeg', 0.82);
    } catch (e) { dataUrl = ''; }
    finish(dataUrl, video.videoWidth, video.videoHeight, Number(video.duration) || 0);
  });
  video.addEventListener('error', function () { finish('', 0, 0, 0); });
  // 兜底：2.5s 没抽到就别卡住上传
  setTimeout(function () {
    finish('', video.videoWidth, video.videoHeight, Number(video.duration) || 0);
  }, 2500);
  video.src = url;
}

function uploadSplashVideo(file) {
  var p = splashVideoPanel;
  var MAX = 40 * 1024 * 1024;
  if (!/\.mp4$/i.test(file.name) && file.type !== 'video/mp4') {
    showToast('只支持 MP4（H.264）文件');
    return;
  }
  if (file.size > MAX) {
    showToast('文件 ' + (file.size / 1048576).toFixed(1) + 'MB，超过 40MB 上限');
    return;
  }
  p.uploading = true;
  renderSplashVideoPanel();
  captureSplashFrame(file, function (dataUrl, w, h) {
    if (w && h && (w < 1280 || h < 720)) {
      showToast('分辨率 ' + w + '×' + h + ' 偏低（建议 1920×1080）');
    }
    fetch('/api/splash/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'video/mp4' },
      body: file
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok) throw new Error((d && d.error) || '上传失败');
        if (!dataUrl) return d;
        return fetch('/api/splash/custom-thumb', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: dataUrl })
        }).then(function () { return d; });
      })
      .then(function (d) {
        p.uploading = false;
        showToast('已上传 ' + d.width + '×' + d.height + '，已设为启动页');
        fetchSplashVideoList(true);
      })
      .catch(function (e) {
        p.uploading = false;
        renderSplashVideoPanel();
        showToast('上传失败：' + ((e && e.message) || '未知错误'));
      });
  });
}

/* 删除一条已下载的视频（删掉后卡片会回到「下载」状态） */
function deleteSplashVideo(id) {
  var hit = null;
  for (var i = 0; i < splashVideoPanel.items.length; i++) {
    if (splashVideoPanel.items[i].id === id) { hit = splashVideoPanel.items[i]; break; }
  }
  var isCustom = id === 'custom';
  var isCurrent = splashVideoPanel.selected === id;
  var label = isCustom ? '「我的视频」' : '「' + ((hit && hit.name) || id) + '」';
  // 删的正好是正在用的那条，启动页才会回退内置；删别的，当前启动页不受影响
  var how = isCustom ? '删除后需要重新上传才能再用' : '删除后需要重新下载才能再用';
  var impact = isCurrent ? '，启动页会回到内置默认。' : '，当前启动页不受影响。';
  if (!window.confirm('确定删除' + label + '吗？\n' + how + impact)) return;
  fetch('/api/splash/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: id })
  })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!d || !d.ok) throw new Error((d && d.error) || '删除失败');
      showToast('已删除' + label);
      fetchSplashVideoList();      // 不带 force：只需要刷新下载状态，不用重拉远端清单
    })
    .catch(function (e) {
      showToast('删除失败：' + ((e && e.message) || '未知错误'));
    });
}

function initSplashVideoPanel() {
  if (splashVideoPanel.loadedOnce || splashVideoPanel.loading) return;
  fetchSplashVideoList();
}

/* 下载源：auto（两源竞速，谁快用谁）→ CNB（国内直连）→ GitHub（开 VPN 用）→ 回到 auto */
function cycleSplashSource() {
  var order = ['auto', 'cnb', 'github'];
  var names = { auto: '自动（竞速）', cnb: 'CNB', github: 'GitHub' };
  var cur = splashVideoPanel.sourcePref || 'auto';
  var next = order[(order.indexOf(cur) + 1) % order.length];
  splashVideoPanel.sourcePref = next;
  renderSplashVideoPanel();
  fetch('/api/splash/source', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: next })
  })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!d || !d.ok) throw new Error((d && d.error) || '切换失败');
      showToast('下载源：' + names[next]);
      fetchSplashVideoList(true);
    })
    .catch(function (e) {
      showToast('切换下载源失败：' + ((e && e.message) || '未知错误'));
      fetchSplashVideoList();
    });
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
