'use strict';

// ============================================================
//  16-session-boot.js  ←  源 main.js §42–§48（基线 784afe6）
//  会话持久化 / 自动播放 / 酷狗扫码 / 预解析 / 解析顺序 / 启动 / 主循环
// ============================================================

// ============================================================
//  上次播放会话持久化（启动自动恢复播放列表）
//  - 退出前/切歌/播放中定期把 { 队列快照, 当前曲, 进度 } 写入 localStorage
//  - 启动时重建队列：在线曲按 id/provider 重建，本地曲经本地库重新挂 localUrl（token 每次会话轮换，不落盘）
//  - 不自动播放；用户按下播放时若命中原曲则从保存的进度续播（走 playQueueAt 内置 opts.resumeAt）
// ============================================================
var LAST_SESSION_STORE_KEY = 'bhandsmusic_last_session_v1';
var LAST_SESSION_QUEUE_MAX = 200;
var lastSessionSaveTimer = null;
var lastSessionPosSaveAt = 0;
var pendingResumeAt = null;
// 恢复态"主页豁免"独立开关：点播即消费（主页让位），不影响 restoredIdleSession 的
// 恢复态展示（歌词定位/进度显示）——解析音源期间歌词与进度保持，播放开始后自然接管
var restoredHomeExemptUsed = false;

function lastSessionSongSnapshot(song) {
  if (!song) return null;
  var out = {
    type: song.type || '',
    provider: song.provider || '',
    name: song.name || song.title || '',
    artist: song.artist || '',
    album: song.album || '',
    cover: song.cover || '',
    duration: Number(song.duration) || 0
  };
  if (song.type === 'local' || song.localKey) {
    out.type = 'local';
    out.localFileId = String(song.localFileId || song.localKey || '').replace(/^local:/, '');
    if (!out.localFileId) return null;
  } else {
    if (song.id != null && song.id !== '') out.id = song.id;
    if (song.mid) out.mid = song.mid;
    if (song.songmid) out.songmid = song.songmid;
    if (song.programId) out.programId = song.programId;
    if (song.source) out.source = song.source;
    if (!out.id && !out.mid && !out.songmid && !out.programId && !out.name) return null;
  }
  return out;
}

function saveLastPlaybackSession(positionSec) {
  try {
    if (!Array.isArray(playQueue) || !playQueue.length) return;
    var idx = Number(currentIdx);
    if (!isFinite(idx) || idx < 0 || idx >= playQueue.length) idx = 0;
    var start = 0;
    var end = playQueue.length;
    if (playQueue.length > LAST_SESSION_QUEUE_MAX) {
      start = Math.max(0, idx - Math.floor(LAST_SESSION_QUEUE_MAX / 2));
      end = Math.min(playQueue.length, start + LAST_SESSION_QUEUE_MAX);
      idx = idx - start;
    }
    var queue = [];
    for (var i = start; i < end; i++) {
      var snap = lastSessionSongSnapshot(playQueue[i]);
      if (snap) queue.push(snap);
    }
    if (!queue.length) return;
    localStorage.setItem(LAST_SESSION_STORE_KEY, JSON.stringify({
      v: 1,
      savedAt: Date.now(),
      currentIdx: idx,
      position: Math.max(0, Number(positionSec) || 0),
      queue: queue
    }));
  } catch (e) {}
}

function scheduleLastPlaybackSessionSave(positionSec) {
  if (lastSessionSaveTimer) clearTimeout(lastSessionSaveTimer);
  lastSessionSaveTimer = setTimeout(function () {
    lastSessionSaveTimer = null;
    var pos = 0;
    try { pos = (audio && isFinite(audio.currentTime)) ? audio.currentTime : 0; } catch (e) {}
    saveLastPlaybackSession(typeof positionSec === 'number' ? positionSec : pos);
  }, 400);
}

function throttledLastSessionPositionSave() {
  var now = Date.now();
  if (now - lastSessionPosSaveAt < 5000) return;
  lastSessionPosSaveAt = now;
  saveLastPlaybackSession((audio && isFinite(audio.currentTime)) ? audio.currentTime : 0);
}

function lastSessionRebuildSong(snap, localTracksByKey) {
  if (!snap) return null;
  if (snap.type === 'local') {
    var key = String(snap.localFileId || '').replace(/^local:/, '');
    var track = (localTracksByKey && key) ? localTracksByKey.get(key) : null;
    return track ? cloneSong(track) : null;
  }
  var song = {};
  if (snap.id != null && snap.id !== '') song.id = snap.id;
  if (snap.mid) { song.mid = snap.mid; song.provider = 'qq'; }
  else if (snap.songmid) { song.songmid = snap.songmid; song.provider = 'qq'; }
  if (snap.programId) { song.programId = snap.programId; song.type = 'podcast'; }
  if (snap.provider) song.provider = snap.provider;
  if (snap.source) song.source = snap.source;
  song.name = snap.name || '';
  song.artist = snap.artist || '';
  if (snap.album) song.album = snap.album;
  if (snap.cover) song.cover = snap.cover;
  if (snap.duration) song.duration = snap.duration;
  if (!song.name && song.id == null) return null;
  return song;
}

async function restoreLastPlaybackSession() {
  try {
    var raw = null;
    try { raw = localStorage.getItem(LAST_SESSION_STORE_KEY); } catch (e) {}
    if (!raw) return false;
    var record = null;
    try { record = JSON.parse(raw); } catch (e) { return false; }
    if (!record || record.v !== 1 || !Array.isArray(record.queue) || !record.queue.length) return false;
    // 超过 30 天的旧会话不再恢复，避免复活早已遗忘的列表
    if ((Date.now() - (Number(record.savedAt) || 0)) > 1000 * 60 * 60 * 24 * 30) return false;

    var needLocal = false;
    for (var i = 0; i < record.queue.length; i++) {
      if (record.queue[i] && (record.queue[i].type === 'local' || record.queue[i].localFileId)) { needLocal = true; break; }
    }
    var localTracksByKey = null;
    if (needLocal) {
      try {
        if (typeof window.desktopWindow !== 'undefined' && window.desktopWindow && typeof window.desktopWindow.listLocalMusicLibrary === 'function') {
          var lib = await window.desktopWindow.listLocalMusicLibrary();
          if (lib && lib.ok === true && Array.isArray(lib.tracks)) {
            localTracksByKey = new Map();
            lib.tracks.forEach(function (t) {
              if (t && t.localKey && t.localUrl) {
                localTracksByKey.set(String(t.localKey).replace(/^local:/, ''), t);
              }
            });
          }
        }
      } catch (e) {}
    }

    var rebuilt = [];
    for (var j = 0; j < record.queue.length; j++) {
      var song = lastSessionRebuildSong(record.queue[j], localTracksByKey);
      if (song) rebuilt.push(song);
    }
    if (!rebuilt.length) return false;

    // 按"保存时当前曲"的标识在重建后的队列里找回（中途曲目被删/失效时索引可能漂移）
    var savedIdx = Number(record.currentIdx);
    var savedCurrentKey = '';
    if (isFinite(savedIdx) && savedIdx >= 0 && savedIdx < record.queue.length) {
      var savedSnap = record.queue[savedIdx];
      if (savedSnap.type === 'local') savedCurrentKey = 'local:' + String(savedSnap.localFileId || '').replace(/^local:/, '');
      else if (savedSnap.mid || savedSnap.songmid) savedCurrentKey = 'qq:' + (savedSnap.mid || savedSnap.songmid || savedSnap.id || '');
      else if (savedSnap.programId) savedCurrentKey = 'podcast:' + savedSnap.programId;
      else if (savedSnap.id != null && savedSnap.id !== '') savedCurrentKey = 'song:' + savedSnap.id;
      else savedCurrentKey = String(savedSnap.name || '') + '|' + String(savedSnap.artist || '');
    }
    var idx = -1;
    if (savedCurrentKey) {
      for (var k = 0; k < rebuilt.length; k++) {
        if (queueItemKey(rebuilt[k]) === savedCurrentKey) { idx = k; break; }
      }
    }
    if (idx < 0) idx = 0;

    playQueue = rebuilt;
    currentIdx = idx;
    // 恢复态标记：主页不因恢复的列表被顶掉；用户首次点播（创建 audio）后由判定函数自动失效
    restoredIdleSession = true;
    var current = playQueue[idx];
    lastRestoredPositionSec = Math.max(0, Number(record.position) || 0);
    restoredCurrentKey = queueItemKey(current);
    // 恢复播放位置模式（移植自上游）：restart = 不恢复进度，重播整首
    var position = startupResumeSecondsFromSnapshot({ position: lastRestoredPositionSec });
    if (position > 2) pendingResumeAt = { key: restoredCurrentKey, position: position };

    try {
      document.getElementById('thumb-title').textContent = current.name || 'BhandsMusic';
      document.getElementById('thumb-artist').textContent = current.artist || '';
      updateControlTrackInfo(current);
      document.getElementById('thumb-wrap').classList.add('visible');
      var coverSrc = ((typeof songCoverSrc === 'function' && songCoverSrc(current, 400)) || current.cover || '');
      if (coverSrc) loadCoverFromUrl(coverSrc, { deferHeavy: true, delay: 420, timeout: 1600 });
    } catch (e) {}

    try { updateEmptyHomeVisibility({ forceLoad: false }); } catch (e) {}
    safeRenderQueuePanel('session-restore', { scrollCurrent: false });
    // 恢复态完整还原：预取当前曲歌词（完成后由恢复态定位显示）+ 进度条/时间显示保存的位置
    try {
      var restoreLyricSong = currentCoverSong();
      if (restoreLyricSong && typeof fetchLyric === 'function') fetchLyric(restoreLyricSong, trackSwitchToken);
    } catch (e) {}
    try { updatePlaybackProgressUi(); } catch (e) {}
    console.log('[SessionRestore] 已恢复上次播放列表: ' + rebuilt.length + ' 首, 当前: ' + (current.name || ''));
    // 启动自动播放：恢复完成即排队（splash 期间挂起，dismissSplash 时自动发起静默续播）
    scheduleStartupAutoplayFromSnapshot('startup');
    // 恢复态音源预解析：后台请求不播放，点播放时跳过解析等待。
    // 触发时机改由 splash 动画结束时驱动（requestStartupPreparseAfterSplash），
    // 避免与启动页动画抢主线程（9s 兜底）。
    requestStartupPreparseAfterSplash();
    return true;
  } catch (e) {
    console.warn('[SessionRestore] 恢复失败:', e);
    return false;
  }
}

// ============================================================
// 启动自动播放（对齐上游 startupAutoplay 核心版）
//  - 开启后：启动恢复上次播放快照 → splash 结束 → 自动静默续播（含上次进度）
//  - 解析/换源全程静默（showSourceFallbackNotice 抑制）；失败指数退避重试，
//    同曲连败自动跳下一首；放弃后恢复态展示保持，可手动点播放
// ============================================================
var STARTUP_AUTOPLAY_STORE_KEY = 'bhandsmusic_startup_autoplay_v1';
var startupAutoplayPreference = readBooleanPreference(STARTUP_AUTOPLAY_STORE_KEY, false);

// 秒启动跳过启动页（移植自上游 t-startupFastSkip）
var STARTUP_FAST_SKIP_STORE_KEY = 'bhandsmusic_startup_fast_skip_v1';
var startupFastSkipPreference = readBooleanPreference(STARTUP_FAST_SKIP_STORE_KEY, false);

// 恢复播放位置（移植自上游 startup-resume-mode-seg）：resume=按上次进度 / restart=重播整首
var STARTUP_RESUME_MODE_STORE_KEY = 'bhandsmusic_startup_resume_mode_v1';
function normalizeStartupResumeMode(value) { return value === 'restart' ? 'restart' : 'resume'; }
var startupResumeModePreference = (function () {
  try { return normalizeStartupResumeMode(localStorage.getItem(STARTUP_RESUME_MODE_STORE_KEY) || 'resume'); }
  catch (e) { return 'resume'; }
})();
/** 恢复态保存的原始进度与当前曲标识（供「恢复播放位置」当次会话即时切换用） */
var lastRestoredPositionSec = 0;
var restoredCurrentKey = '';

/**
 * 快照 → 实际恢复秒数：restart 模式不恢复进度（重播整首）
 * @param {{position?: number}} snapshot
 */
function startupResumeSecondsFromSnapshot(snapshot) {
  if (startupResumeModePreference === 'restart') return 0;
  return Math.max(0, Number(snapshot && snapshot.position) || 0);
}
function syncStartupResumeModeUi() {
  var seg = document.getElementById('startup-resume-mode-seg');
  if (!seg) return;
  Array.prototype.forEach.call(seg.querySelectorAll('[data-startup-resume-mode]'), function (btn) {
    btn.classList.toggle('active', btn.getAttribute('data-startup-resume-mode') === startupResumeModePreference);
  });
}
function setStartupResumeMode(value) {
  startupResumeModePreference = normalizeStartupResumeMode(value);
  try { localStorage.setItem(STARTUP_RESUME_MODE_STORE_KEY, startupResumeModePreference); } catch (e) {}
  syncStartupResumeModeUi();
  // 当次会话即时生效：恢复态尚未点播（audio 还没建）时直接改写待恢复进度
  if (restoredIdleSession && !(audio && audio.src)) {
    var next = startupResumeSecondsFromSnapshot({ position: lastRestoredPositionSec });
    pendingResumeAt = (next > 2 && restoredCurrentKey) ? { key: restoredCurrentKey, position: next } : null;
    try { updatePlaybackProgressUi(); } catch (e) {}
  }
  showToast(startupResumeModePreference === 'restart' ? '恢复播放将重播整首' : '恢复播放将按上次进度继续');
}
function syncStartupFastSkipToggle() {
  var btn = document.getElementById('t-startupFastSkip');
  if (btn) btn.classList.toggle('on', !!startupFastSkipPreference);
}
function toggleStartupFastSkip() {
  startupFastSkipPreference = !startupFastSkipPreference;
  saveBooleanPreference(STARTUP_FAST_SKIP_STORE_KEY, startupFastSkipPreference);
  syncStartupFastSkipToggle();
  showToast(startupFastSkipPreference ? '秒启动已开启：下次打开软件直接进主页' : '秒启动已关闭');
}
var startupAutoplayJobId = 0;
var startupAutoplayAttempted = false;
var startupAutoplayAttemptCount = 0;
var startupAutoplayRetryTimer = null;
var startupAutoplaySilent = false;   // 自动播放尝试期间抑制音源提示（showSourceFallbackNotice 检查）
var startupAutoplayQueuedReason = '';

function isStartupAutoplayPlaying() {
  return !!(audio && audio.src && !audio.paused && !audio.ended);
}
function canStartupAutoplay() {
  if (!startupAutoplayPreference || startupAutoplayAttempted) return false;
  return !!(Array.isArray(playQueue) && playQueue.length && currentIdx >= 0 && playQueue[currentIdx]);
}
function clearStartupAutoplayRetryTimer() {
  if (startupAutoplayRetryTimer) { clearTimeout(startupAutoplayRetryTimer); startupAutoplayRetryTimer = null; }
}
function startupAutoplayRetryDelay(attempt) {
  var delays = [80, 260, 620, 1100, 1800, 2800, 4200, 6200];
  return delays[Math.min(delays.length - 1, Math.max(0, attempt))];
}
function syncStartupAutoplayToggle() {
  var btn = document.getElementById('t-startupAutoplay');
  if (btn) btn.classList.toggle('on', !!startupAutoplayPreference);
  // 同属「启动与退出」分组：一并同步（移植自上游 applyStartupAutoplayUi）
  syncStartupFastSkipToggle();
  syncStartupResumeModeUi();
}
function toggleStartupAutoplay() {
  startupAutoplayPreference = !startupAutoplayPreference;
  saveBooleanPreference(STARTUP_AUTOPLAY_STORE_KEY, startupAutoplayPreference);
  syncStartupAutoplayToggle();
  showToast(startupAutoplayPreference ? '启动自动播放已开启：下次打开软件自动续播' : '启动自动播放已关闭');
  // 当次会话即时生效：恢复态仍在且尚未尝试过 → 立即发起
  if (startupAutoplayPreference && !startupAutoplayAttempted) scheduleStartupAutoplayFromSnapshot('setting-toggle');
}

// ============================================================
// 酷狗会员扫码登录（内置 KuGouMusicApi 服务，概念版平台）
// ============================================================
var kugouQrPollTimer = null;
// 页面加载即拉取一次酷狗登录状态（控制台重组后由 fx-console-workspace 再次刷新）
setTimeout(updateKugouLoginStatusText, 2000);
function updateKugouLoginStatusText() {
  var el = document.getElementById('kugou-login-status');
  if (!el) return;
  var row = document.getElementById('kugou-qr-login-row');
  fetch('/api/kugou/login/status').then(function (r) { return r.json(); }).then(function (j) {
    var loggedIn = !!(j && j.loggedIn);
    // 会员 FLAC 只在 kugou 策略参与解析时才生效（musicParser.js canHandle 要求
    // enabledSources 含 'kugou'，默认配置里没有它）——所以状态文案必须跟着开关走，
    // 否则会出现「已登录（会员音质已启用）」但实际还在跑 128k 的空头支票。
    var enabled = (_musicSourcesConfig && _musicSourcesConfig.enabledSources) || [];
    var sourceOn = enabled.indexOf('kugou') >= 0;
    // 文案保持短：这行右侧空间有限，太长会把左侧「酷狗扫码登录」挤成省略号
    el.textContent = !loggedIn ? '未登录' : (sourceOn ? '已登录 · 音质已启用' : '已登录 · 音源未开');
    el.style.color = (loggedIn && sourceOn) ? 'var(--c-accent,#7cf)' : 'rgba(255,255,255,.45)';
    if (row) {
      row.title = !loggedIn
        ? '扫码登录酷狗概念版，解锁会员音质（FLAC/320k）'
        : (sourceOn
          ? '已登录酷狗概念版，会员音质已参与解析（点击可重新登录）'
          : '已登录，但「酷狗音源」开关没打开，会员音质不会生效 —— 点下方开关开启');
    }
  }).catch(function () { el.textContent = ''; });
}
/**
 * 扫码/验证码登录成功后自动启用「酷狗音源」开关。
 * 会员 FLAC 走的是 kugou 策略，该策略要求 enabledSources 含 'kugou'（默认配置不含）——
 * 不自动打开的话用户扫完码仍然拿不到会员音质。
 * @param {boolean} [retried] - 配置尚未拉取时的单次重试标记（防无限递归）
 */
function enableKugouSourceOnLogin(retried) {
  if (!_musicSourcesConfig) {
    if (retried) return;
    loadMusicSourcesConfig().then(function () { enableKugouSourceOnLogin(true); });
    return;
  }
  var enabled = _musicSourcesConfig.enabledSources || [];
  if (enabled.indexOf('kugou') >= 0) return;
  enabled.push('kugou');
  _musicSourcesConfig.enabledSources = enabled;
  syncMusicSourcesUI();
  saveMusicSourcesConfigToServer();
}
function closeKugouQrLogin() {
  if (kugouQrPollTimer) { clearTimeout(kugouQrPollTimer); kugouQrPollTimer = null; }
  var ov = document.getElementById('kugou-qr-overlay');
  if (ov) ov.remove();
}
function pollKugouQrStatus(key, attempts) {
  if (attempts <= 0) {
    var note = document.getElementById('kugou-qr-note');
    if (note) note.textContent = '二维码已过期，请点击刷新重试';
    return;
  }
  kugouQrPollTimer = setTimeout(function () {
    fetch('/api/kugou/login/qr/check?key=' + encodeURIComponent(key)).then(function (r) { return r.json(); }).then(function (j) {
      var note = document.getElementById('kugou-qr-note');
      if (j && j.status === 4) {
        if (note) note.textContent = '✅ 登录成功！会员音质已启用';
        enableKugouSourceOnLogin();
        showToast('酷狗会员登录成功，已启用会员音质');
        updateKugouLoginStatusText();
        setTimeout(closeKugouQrLogin, 1600);
        return;
      }
      if (j && j.status === 2 && note) note.textContent = '已扫码，请在手机上确认…';
      else if (j && j.status === 1 && note) note.textContent = '等待扫码…（使用酷狗概念版 App）';
      else if (j && j.status === 0 && note) note.textContent = '二维码已过期，请点击刷新重试';
      pollKugouQrStatus(key, attempts - 1);
    }).catch(function () { pollKugouQrStatus(key, attempts - 1); });
  }, 2000);
}
function openKugouQrLogin() {
  closeKugouQrLogin();
  var ov = document.createElement('div');
  ov.id = 'kugou-qr-overlay';
  ov.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;';
  ov.innerHTML =
    '<div style="background:#0b1016;border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:22px 26px;width:320px;text-align:center;color:#dfe8ee">' +
    '<div style="font-weight:700;font-size:14px;margin-bottom:12px">酷狗会员登录</div>' +
    '<div style="display:flex;gap:6px;justify-content:center;margin-bottom:14px">' +
    '<button id="kugou-tab-qr" type="button" style="flex:1;min-height:28px;border-radius:8px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.10);color:#fff;font-size:11px;cursor:pointer">扫码登录</button>' +
    '<button id="kugou-tab-sms" type="button" style="flex:1;min-height:28px;border-radius:8px;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.04);color:rgba(255,255,255,.55);font-size:11px;cursor:pointer">验证码登录</button>' +
    '</div>' +
    '<div id="kugou-qr-body"></div>' +
    '<div style="margin-top:12px"><button class="fx-mini-btn ghost" type="button" style="min-height:27px;padding:0 14px" onclick="closeKugouQrLogin()">关闭</button></div>' +
    '</div>';
  document.body.appendChild(ov);
  ov.addEventListener('click', function (e) { if (e.target === ov) closeKugouQrLogin(); });
  var tabQr = document.getElementById('kugou-tab-qr');
  var tabSms = document.getElementById('kugou-tab-sms');
  var body = document.getElementById('kugou-qr-body');
  function setActiveTab(which) {
    tabQr.style.background = which === 'qr' ? 'rgba(255,255,255,.10)' : 'rgba(255,255,255,.04)';
    tabQr.style.color = which === 'qr' ? '#fff' : 'rgba(255,255,255,.55)';
    tabSms.style.background = which === 'sms' ? 'rgba(255,255,255,.10)' : 'rgba(255,255,255,.04)';
    tabSms.style.color = which === 'sms' ? '#fff' : 'rgba(255,255,255,.55)';
  }
  tabQr.addEventListener('click', function () { setActiveTab('qr'); renderQrTab(body); });
  tabSms.addEventListener('click', function () { setActiveTab('sms'); renderSmsTab(body); });
  setActiveTab('qr');
  renderQrTab(body);
}
function renderQrTab(body) {
  body.innerHTML =
    '<div id="kugou-qr-img" style="display:flex;align-items:center;justify-content:center;min-height:180px;color:rgba(255,255,255,.4);font-size:11px">生成二维码中…</div>' +
    '<div id="kugou-qr-note" style="margin-top:12px;font-size:11px;color:rgba(255,255,255,.62)">准备中…（使用酷狗概念版 App 扫一扫）</div>' +
    '<div style="margin-top:10px"><button id="kugou-qr-refresh" class="fx-mini-btn ghost" type="button" style="min-height:25px;padding:0 10px;font-size:10px">刷新二维码</button></div>';
  var imgBox = document.getElementById('kugou-qr-img');
  fetch('/api/kugou/login/qr/create').then(function (r) { return r.json(); }).then(function (j) {
    if (!j || j.error || !j.qrcode) {
      imgBox.textContent = '生成失败：' + ((j && j.error) || '未知错误');
      return;
    }
    if (j.qrcode_img) {
      var img = document.createElement('img');
      img.src = j.qrcode_img;
      img.style.cssText = 'width:180px;height:180px;border-radius:8px;background:#fff;padding:6px';
      imgBox.innerHTML = '';
      imgBox.appendChild(img);
      document.getElementById('kugou-qr-note').textContent = '等待扫码…（使用酷狗概念版 App 扫一扫）';
      pollKugouQrStatus(j.qrcode, 90);
    } else {
      imgBox.textContent = '二维码数据缺失';
    }
  }).catch(function (e) {
    imgBox.textContent = '生成失败：' + e.message;
  });
  document.getElementById('kugou-qr-refresh').addEventListener('click', function () {
    if (kugouQrPollTimer) { clearTimeout(kugouQrPollTimer); kugouQrPollTimer = null; }
    renderQrTab(body);
  });
}
function renderSmsTab(body) {
  body.innerHTML =
    '<input id="kugou-sms-mobile" type="tel" maxlength="11" placeholder="手机号" style="width:100%;box-sizing:border-box;min-height:34px;border-radius:8px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:#fff;font-size:13px;padding:0 10px;outline:none">' +
    '<div style="display:flex;gap:8px;margin-top:10px">' +
    '<input id="kugou-sms-code" type="text" maxlength="6" placeholder="验证码" style="flex:1;box-sizing:border-box;min-height:34px;border-radius:8px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:#fff;font-size:13px;padding:0 10px;outline:none">' +
    '<button id="kugou-sms-send" class="fx-mini-btn ghost" type="button" style="min-height:34px;padding:0 12px">发送验证码</button>' +
    '</div>' +
    '<div id="kugou-sms-note" style="margin-top:10px;font-size:11px;color:rgba(255,255,255,.5);min-height:16px">验证码将发送到酷狗账号绑定的手机号</div>' +
    '<button id="kugou-sms-login" class="fx-mini-btn ghost" type="button" style="width:100%;min-height:32px;margin-top:6px">登录</button>';
  var mobileInput = document.getElementById('kugou-sms-mobile');
  var codeInput = document.getElementById('kugou-sms-code');
  var note = document.getElementById('kugou-sms-note');
  document.getElementById('kugou-sms-send').addEventListener('click', function () {
    var mobile = mobileInput.value.trim();
    if (!/^1\d{10}$/.test(mobile)) { note.textContent = '请输入正确的手机号'; note.style.color = '#ff8a8a'; return; }
    note.style.color = 'rgba(255,255,255,.5)';
    note.textContent = '发送中…';
    fetch('/api/kugou/login/captcha?mobile=' + encodeURIComponent(mobile)).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.success) {
        note.textContent = '验证码已发送，请查收短信';
        var btn = document.getElementById('kugou-sms-send');
        var left = 60;
        btn.disabled = true;
        var iv = setInterval(function () {
          btn.textContent = left + 's';
          if (--left <= 0) { clearInterval(iv); btn.disabled = false; btn.textContent = '发送验证码'; }
        }, 1000);
      } else {
        note.textContent = (j && j.error) || '发送失败';
        note.style.color = '#ff8a8a';
      }
    }).catch(function (e) { note.textContent = '发送失败：' + e.message; note.style.color = '#ff8a8a'; });
  });
  document.getElementById('kugou-sms-login').addEventListener('click', function () {
    var mobile = mobileInput.value.trim();
    var code = codeInput.value.trim();
    if (!/^1\d{10}$/.test(mobile) || !/^\d{4,6}$/.test(code)) { note.textContent = '请填写手机号和验证码'; note.style.color = '#ff8a8a'; return; }
    note.style.color = 'rgba(255,255,255,.5)';
    note.textContent = '登录中…';
    fetch('/api/kugou/login/cellphone?mobile=' + encodeURIComponent(mobile) + '&code=' + encodeURIComponent(code)).then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.success) {
        note.textContent = '✅ 登录成功！会员音质已启用';
        enableKugouSourceOnLogin();
        showToast('酷狗会员登录成功，已启用会员音质');
        updateKugouLoginStatusText();
        setTimeout(closeKugouQrLogin, 1600);
      } else {
        note.textContent = (j && j.error) || '登录失败';
        note.style.color = '#ff8a8a';
      }
    }).catch(function (e) { note.textContent = '登录失败：' + e.message; note.style.color = '#ff8a8a'; });
  });
}
function finishStartupAutoplayJob(success) {
  clearStartupAutoplayRetryTimer();
  startupAutoplaySilent = false;
  startupAutoplayAttemptCount = 0;
  if (success) {
    // 播放已接管：恢复态历史使命完成（同曲续播时 pendingResumeAt 已被 playQueueAt 消费）
    restoredIdleSession = false;
    pendingResumeAt = null;
    restoredHomeExemptUsed = true;
  }
  // 放弃（success=false）：恢复态展示保持（歌词/进度还在），用户可手动点播放
}
function runStartupAutoplayAttempt(jobId, reason) {
  if (!startupAutoplayPreference || jobId !== startupAutoplayJobId) return false;
  if (isStartupAutoplayPlaying()) { finishStartupAutoplayJob(true); return true; }
  if (!(Array.isArray(playQueue) && playQueue.length && currentIdx >= 0 && playQueue[currentIdx])) {
    finishStartupAutoplayJob(false);
    return false;
  }
  // 同曲连败 2 次后跳到下一个未被失败标记阻塞的曲目（playQueueAt 内部的换源/跳曲链照常工作）
  if (startupAutoplayAttemptCount >= 2 && playQueue.length > 1) {
    var failedAt = Number(playQueue[currentIdx] && playQueue[currentIdx]._lastPlaybackFailAt) || 0;
    if (failedAt && Date.now() - failedAt < 18000) {
      var nextIdx = nextUnblockedQueueIndex(currentIdx);
      if (nextIdx >= 0 && nextIdx !== currentIdx) currentIdx = nextIdx;
    }
  }
  startupAutoplayAttemptCount += 1;
  startupAutoplaySilent = true;
  Promise.resolve(playQueueAt(currentIdx, { manual: false, startupAutoplay: true }))
    .catch(function (e) { console.warn('[StartupAutoplay]', reason || 'startup', e); })
    .finally(function () {
      if (jobId !== startupAutoplayJobId || !startupAutoplayPreference) { startupAutoplaySilent = false; return; }
      setTimeout(function () {
        if (jobId !== startupAutoplayJobId || !startupAutoplayPreference) { startupAutoplaySilent = false; return; }
        if (isStartupAutoplayPlaying()) { finishStartupAutoplayJob(true); return; }
        if (startupAutoplayAttemptCount >= 6) { finishStartupAutoplayJob(false); return; }
        clearStartupAutoplayRetryTimer();
        startupAutoplayRetryTimer = setTimeout(function () {
          startupAutoplayRetryTimer = null;
          runStartupAutoplayAttempt(jobId, 'retry');
        }, startupAutoplayRetryDelay(startupAutoplayAttemptCount));
      }, 260);
    });
  return true;
}
function scheduleStartupAutoplayFromSnapshot(reason) {
  if (!startupAutoplayPreference || startupAutoplayAttempted) return false;
  if (!canStartupAutoplay()) return false;
  // splash 未结束先排队，dismissSplash 时 flush（对齐上游：界面可见后才发起）
  if (document.body.classList.contains('splash-active')) {
    startupAutoplayQueuedReason = reason || 'startup';
    return true;
  }
  clearStartupAutoplayRetryTimer();
  startupAutoplayJobId += 1;
  startupAutoplayAttemptCount = 0;
  startupAutoplayAttempted = true;
  var jobId = startupAutoplayJobId;
  setTimeout(function () { runStartupAutoplayAttempt(jobId, reason || 'startup'); }, 300);
  return true;
}
function flushStartupAutoplayAfterSplash() {
  if (!startupAutoplayQueuedReason || !startupAutoplayPreference || startupAutoplayAttempted) { startupAutoplayQueuedReason = ''; return; }
  var reason = startupAutoplayQueuedReason;
  startupAutoplayQueuedReason = '';
  scheduleStartupAutoplayFromSnapshot(reason);
}
syncStartupAutoplayToggle();

// ============================================================
// 恢复态音源预解析：启动后台请求音源 URL（不创建 audio、不播放），
// 点播放时消费结果跳过解析等待——消除"点播放后几秒解析空白"。
//  - 只复刻主链（官方/第三方两级），跨平台换源/试听兜底仍由正式链处理
//  - 一次性消费；TTL 内有效（音源 URL 有时效），过期自动作废
//  - 同曲同音质才命中；点其他歌后缓存留存（切回同曲且未过期可复用）
// ============================================================
var STARTUP_PREPARSE_TTL = 10 * 60 * 1000;        // 第三方/未知来源 URL 保守时效
var OFFICIAL_PREPARSE_TTL = 20 * 60 * 1000;       // 官方 API URL 时效较长
var PREPARSE_CACHE_MAX = 8;                        // LRU 上限：当前曲 + 下一首 + 切回复用
var preparseCache = [];                            // [{ key, data, at, quality, ttl }]，新在前

function preparseTtlFor(data) {
  return data && data.source === 'third-party' ? STARTUP_PREPARSE_TTL : OFFICIAL_PREPARSE_TTL;
}
function takePreparsedSongSource(song, requestedQuality) {
  if (!preparseCache.length) return null;
  var key = queueItemKey(song);
  for (var i = 0; i < preparseCache.length; i++) {
    if (preparseCache[i].key !== key) continue;
    var hit = preparseCache.splice(i, 1)[0];  // 命中即出队（一次性消费）
    if (!hit.data || !hit.data.url) return null;
    if (hit.quality !== requestedQuality) return null;
    if (Date.now() - hit.at > hit.ttl) return null;
    return hit.data;
  }
  return null;
}
function putPreparsedSongSource(song, data, requestedQuality) {
  if (!data || !data.url) return;
  var key = queueItemKey(song);
  for (var i = 0; i < preparseCache.length; i++) {
    if (preparseCache[i].key === key) { preparseCache.splice(i, 1); break; }
  }
  preparseCache.unshift({ key: key, data: data, at: Date.now(), quality: requestedQuality, ttl: preparseTtlFor(data) });
  if (preparseCache.length > PREPARSE_CACHE_MAX) preparseCache.pop();
}
function hasFreshPreparseFor(song, requestedQuality) {
  var key = queueItemKey(song);
  for (var i = 0; i < preparseCache.length; i++) {
    var c = preparseCache[i];
    if (c.key === key && c.quality === requestedQuality && Date.now() - c.at < c.ttl - 30000) return true;
  }
  return false;
}
/**
 * 命中预解析缓存时补一条顶部提示。
 *
 * 为什么需要它：预解析（启动恢复 / 下一首预取）是**后台静默**跑的，不打扰当前播放；
 * 而命中预解析的歌曲会直接跳过整段解析链 → 那条歌曲播放时顶部一条提示都没有。
 * 用户要求「不管啥时候，每首歌播放上面都有提示」，所以这里在**真正开始播放**时
 * 把来源补报一次，语义与实时解析路径（`tryThirdPartyParse` 的「第三方音源可用」）对齐。
 *
 * 只补报、不重复解析；本地曲目不走在线解析，不提示。
 * @param {Object} data 预解析缓存里的播放数据
 */
function notifyPreparsedSourceNotice(data) {
  if (!data || !data.url) return;
  if (data.trial) {
    showSourceFallbackNotice('试听片段可用', '完整版不可用，当前播放官方 30 秒试听。');
    return;
  }
  if (data.source === 'third-party') {
    showSourceFallbackNotice('第三方音源已就绪', '已通过 ' + (data.thirdPartySource || '第三方') + ' 获取到音频。');
    return;
  }
  var qualityText = playbackResolvedQualityText(data);
  showSourceFallbackNotice('音源已就绪', qualityText ? ('官方音源 · ' + qualityText + '。') : '官方音源，可立即播放。');
}
// 登录态/会员状态就绪后再做解析路由决策（提案 1：路由固化）——
// 启动早期 loginStatus 未加载时 hasVip 恒为 false，VIP 用户会被误判走第三方
async function waitForStartupLoginStatus(maxMs) {
  try {
    if (typeof startupLoginStatusPromise !== 'undefined' && startupLoginStatusPromise) {
      var timeoutP = new Promise(function (resolve) { setTimeout(resolve, maxMs || 3000, null); });
      await Promise.race([startupLoginStatusPromise, timeoutP]);
    }
  } catch (e) {}
}
// 公共静默解析（预解析专用）：完整主链决策 + 请求超时，不碰 UI/播放状态
async function resolveSongSourceQuietly(song) {
  var isQQPlayback = songProviderKey(song) === 'qq';
  var currentProvider = isQQPlayback ? 'qq' : 'netease';
  var currentStatus = isQQPlayback ? qqLoginStatus : loginStatus;
  var requestedQuality = normalizePlaybackQuality(playbackQuality);
  if (isQQPlayback && qqPlaybackQualityCeiling && (requestedQuality === 'jymaster' || requestedQuality === 'hires' || requestedQuality === 'lossless')) {
    requestedQuality = qqPlaybackQualityCeiling;
  }
  var hasVip = hasProviderVip(currentProvider, currentStatus);
  var preferThirdParty = shouldPreferThirdPartyParse(currentProvider, hasVip);
  var data = null;
  if (!preferThirdParty) {
    // 官方优先（会员态路由）：① 官方 API（8s 超时）→ ② 第三方（静默）
    var qualityParam = '&quality=' + encodeURIComponent(requestedQuality);
    data = isQQPlayback
      ? await apiParseJson('/api/qq/song/url?mid=' + encodeURIComponent(song.mid || song.songmid || song.id || '') + '&mediaMid=' + encodeURIComponent(song.mediaMid || song.media_mid || '') + qualityParam)
      : await apiParseJson('/api/song/url?id=' + song.id + qualityParam);
    noteOfficialSourceResult(currentProvider, !!(data && data.url), data === null);
    if (!data || !data.url) {
      var thirdPartyHit = await tryThirdPartyParse(song, requestedQuality, { silent: true });
      var thirdPartyData = thirdPartyPlaybackData(thirdPartyHit);
      if (thirdPartyData) data = thirdPartyData;
    }
  } else {
    // 第三方优先：① 第三方（静默，8s 超时）→ ② 官方 API（8s 超时）
    var thirdPartyHit2 = await tryThirdPartyParse(song, requestedQuality, { silent: true });
    var thirdPartyData2 = thirdPartyPlaybackData(thirdPartyHit2);
    if (thirdPartyData2) {
      data = thirdPartyData2;
    } else {
      var qualityParam2 = '&quality=' + encodeURIComponent(requestedQuality);
      data = isQQPlayback
        ? await apiParseJson('/api/qq/song/url?mid=' + encodeURIComponent(song.mid || song.songmid || song.id || '') + '&mediaMid=' + encodeURIComponent(song.mediaMid || song.media_mid || '') + qualityParam2)
        : await apiParseJson('/api/song/url?id=' + song.id + qualityParam2);
      noteOfficialSourceResult(currentProvider, !!(data && data.url), data === null);
    }
  }
  return data && data.url ? { data: data, quality: requestedQuality } : null;
}
async function preparseRestoredSongSource() {
  try {
    if (!(Array.isArray(playQueue) && currentIdx >= 0 && playQueue[currentIdx])) return;
    var song = playQueue[currentIdx];
    if (!song || song.type === 'local' || song.type === 'podcast') return;
    await waitForStartupLoginStatus(3000);  // 会员态路由固化：等登录态就绪再决策（最多 3s）
    var resolved = await resolveSongSourceQuietly(song);
    if (resolved) {
      putPreparsedSongSource(song, resolved.data, resolved.quality);
      console.log('[StartupPreparse] 音源预解析完成（点播放可秒出声）:', song.name || '');
    }
  } catch (e) {
    console.warn('[StartupPreparse] 预解析失败（点播放时将正常解析）:', e);
  }
}

// ---- 下一首预取（提案 3）：上一首解析完开始播放时，立即后台解析队列下一首 ----
function computeNextQueueIndex(forIdx) {
  if (!Array.isArray(playQueue) || !playQueue.length) return -1;
  if (playMode === 'shuffle') return -1;   // 随机模式下一首不可预知
  if (playMode === 'single') return forIdx;
  return (forIdx + 1) % playQueue.length;
}
async function preparseQueueSong(idx) {
  try {
    if (idx < 0 || idx >= playQueue.length) return;
    var song = playQueue[idx];
    if (!song || song.type === 'local' || song.type === 'podcast') return;
    var requestedQuality = normalizePlaybackQuality(playbackQuality);
    if (hasFreshPreparseFor(song, requestedQuality)) return;  // 已有新鲜缓存
    var resolved = await resolveSongSourceQuietly(song);
    if (resolved) {
      putPreparsedSongSource(song, resolved.data, resolved.quality);
      console.log('[PrepNext] 下一首预解析完成:', song.name || '');
    }
  } catch (e) {
    console.warn('[PrepNext] 下一首预解析失败（切歌时将正常解析）:', e);
  }
}
function scheduleNextSongPreparse() {
  // 调用点 = playQueueAt 解析完成设置 src 之后（即当前首"解析完开始播放"时刻）：
  // 立即预取下一首，不等播放进度。解析 API 是轻量 JSON 请求，与音频流加载无争抢；
  // 当前首播放失败跳曲时，预取结果恰好可被下一首直接命中。
  if (!audio || currentIdx < 0) return;
  var nextIdx = computeNextQueueIndex(currentIdx);
  if (nextIdx < 0) return;
  preparseQueueSong(nextIdx);
}

// ============================================================
// 音源解析顺序：auto（默认，VIP 走官方）/ official（官方优先）/ third-party（第三方优先）
//  - 会员源解析经常失败/降级浪费时间时，可切"第三方优先"直接跳过官方请求；
//  - auto 模式带会话级自动降级：官方解析失败 1 次后，本会话内该平台改走第三方优先
// ============================================================
var SOURCE_PARSE_ORDER_STORE_KEY = 'bhandsmusic_source_parse_order_v1';
var sourceParseOrder = (function () {
  try {
    var raw = String(localStorage.getItem(SOURCE_PARSE_ORDER_STORE_KEY) || '').toLowerCase();
    return (raw === 'official' || raw === 'third-party') ? raw : 'auto';
  } catch (e) { return 'auto'; }
})();
var officialSourceFailStreak = {};  // 会话级：官方解析连续失败次数（按平台，成功清零）

/**
 * 记录官方源解析结果，供 auto 模式的会话级降级使用。
 * @param {string} provider - 'netease' | 'qq'
 * @param {boolean} ok - 是否拿到可播 url
 * @param {boolean} [requestFailed] - 请求本身失败（超时/网络/5xx → apiParseJson 返回 null）
 *
 * ⚠️ 只有「请求本身失败」才计入降级。拿到响应但没有 url 是版权/权限问题
 * （需单曲购买、区域限制等），属于单首歌的情况 —— 此前只要没 url 就计数，
 * 一首无版权的歌会让 VIP 用户整个会话都跳过官方源，白白丢掉 FLAC。
 */
function noteOfficialSourceResult(provider, ok, requestFailed) {
  if (ok) { officialSourceFailStreak[provider] = 0; return; }
  if (!requestFailed) return;
  officialSourceFailStreak[provider] = (officialSourceFailStreak[provider] || 0) + 1;
}
function shouldPreferThirdPartyParse(provider, hasVip) {
  if (sourceParseOrder === 'third-party') return true;
  if (sourceParseOrder === 'official') return !hasVip;  // 官方优先仍尊重非 VIP 缺省（无会员官方大概率拿不到）
  // auto：VIP 但官方刚失败过 → 本会话切第三方优先，不再重复浪费官方请求
  if (hasVip && (officialSourceFailStreak[provider] || 0) >= 1) return true;
  return !hasVip;
}
function setSourceParseOrder(order) {
  sourceParseOrder = order === 'official' || order === 'third-party' ? order : 'auto';
  try { localStorage.setItem(SOURCE_PARSE_ORDER_STORE_KEY, sourceParseOrder); } catch (e) {}
  syncSourceParseOrderSeg();
  showToast(sourceParseOrder === 'third-party'
    ? '音源解析：第三方优先（跳过会员源等待）'
    : sourceParseOrder === 'official'
      ? '音源解析：官方优先'
      : '音源解析：自动（VIP 走官方，失败自动切第三方）');
}
function syncSourceParseOrderSeg() {
  var seg = document.getElementById('source-parse-order-seg');
  if (!seg) return;
  var buttons = seg.querySelectorAll('button[data-parse-order]');
  for (var i = 0; i < buttons.length; i++) {
    buttons[i].classList.toggle('active', buttons[i].getAttribute('data-parse-order') === sourceParseOrder);
  }
}
syncSourceParseOrderSeg();

/**
 * 「音源解析顺序」整块的显隐：只有账号在**官方源**上有会员时才显示。
 *
 * 为什么隐藏：shouldPreferThirdPartyParse 在 hasVip=false 时三档全部返回 true ——
 * 非会员切「自动 / 官方优先 / 第三方优先」行为完全一致，是个无效控件。
 * 实测（check-parse-order.js 抽真实源码跑）：hasVip=false → auto/official/third-party 全 true；
 * hasVip=true → auto=false official=false third-party=true（这时才有区别）。
 *
 * ⚠️ hasVip 只看**网易云 / QQ** 的登录态，**酷狗会员不算**（酷狗是第三方源）。
 * 任一官方源有会员就显示 —— seg 是全局设置，而 hasVip 是按歌曲所属平台算的。
 */
function syncSourceParseOrderVisibility() {
  var block = document.getElementById('source-parse-order-block');
  if (!block) return;
  var vip = hasProviderVip('netease', loginStatus) || hasProviderVip('qq', qqLoginStatus);
  block.style.display = vip ? '' : 'none';
}
syncSourceParseOrderVisibility();   // 初始隐藏，避免登录态加载完后闪一下

window.addEventListener('beforeunload', function () {
  try {
    var pos = (audio && isFinite(audio.currentTime)) ? audio.currentTime : 0;
    if (Array.isArray(playQueue) && playQueue.length) saveLastPlaybackSession(pos);
  } catch (e) {}
});

// ============================================================
//  启动
// ============================================================
applyDiyMode(diyPlayerMode, { save: false });
bindFxPanel();
applySavedLyricPaletteState();
bindQualityControl();
bindVolumeControls();
initControlGlassSurface();
bindPlayerControlAnimations();
scheduleUiWarmTask(function(){
  updateControlGlassDisplacementMap();
  updateSearchBoxGlassDisplacementMap();
  updateSearchPillGlassDisplacementMap();
  try {
    if (renderer && renderer.compile && scene && camera) renderer.compile(scene, camera);
  } catch (e) {}
}, 900);
applyUserCapsuleAutoHideState();
applyFxFabAutoHideState();
applyControlsAutoHidePreference();
applyDesktopLyricsState(false);
applyWallpaperModeState(false);
setShelfMode(fx.shelf);
applyStartupStarfieldPreset();
applyPlaylistPanelPinState(false);
if (fx.floatLayer) createFloatLayer();
if (fx.particleLyrics) createLyricsParticles();
updateLyricsToggleButton();
syncLyricDisplayModeSeg();
// 启动自愈：处于故障态但参数全 0（旧版默认写入）→ 补上游默认，避免故障态无效果
if (normalizeLyricMotionStyle(fx.lyricMotionStyle) === 'glitch' && lyricGlitchIntensityValue() <= 0 && lyricGlitchJitterValue() <= 0) {
  fx.lyricGlitchIntensity = 1.0;
  fx.lyricGlitchSlice = 0.72;
  fx.lyricGlitchChroma = 0.86;
  fx.lyricGlitchRate = 1.0;
  fx.lyricGlitchJitter = 0.72;
}
if (fx.backCover) createBackCoverLayer();
initIdleGuideCanvas();
var startupLoginStatusPromise = Promise.all([refreshLoginStatus(), refreshQQLoginStatus()]);
startQQLoginStatusAutoRefresh();
if (startupLoginStatusPromise && startupLoginStatusPromise.then) {
  startupLoginStatusPromise.then(function(){
    if (hasAnyPlatformLogin()) {
      refreshUserPlaylists(true);
      loadHomeDiscover(true);
    }
    if (document.body.classList.contains('splash-active')) return;
    var homeShown = updateEmptyHomeVisibility({ forceLoad: hasAnyPlatformLogin() });
    if (!hasAnyPlatformLogin()) maybeRunStartupLoginGuide('status');
    else if (!homeShown) maybeRunStartupLoginGuide('status');
  });
}
var collectNameInput = document.getElementById('collect-new-name');
if (collectNameInput) {
  collectNameInput.addEventListener('keydown', function(e){
    if (e.key === 'Enter') {
      e.preventDefault();
      createPlaylistFromCollect();
    }
  });
}
var customLyricInput = document.getElementById('custom-lyric-input');
if (customLyricInput) {
  customLyricInput.addEventListener('keydown', function(e){
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      saveCustomLyricForCurrent();
    }
  });
}
safeRenderQueuePanel('startup');
restoreLastPlaybackSession();
updateCustomCoverButton();
updateCustomLyricControls();
updateLikeButtons();
setTimeout(initUpdatePreview, 9000);

// ============================================================
//  主循环
// ============================================================
var prevTime = performance.now();
var renderPerfState = {
  mode: 'vsync',
  fps: 0,
  frames: 0,
  skipped: 0,
  longFrames: 0,
  lastRenderAt: 0,
  lastSampleAt: performance.now()
};
window.__bhandsmusicPerf = renderPerfState;
var splashWarmRenderLast = 0;
function isMainSceneCoveredBySplash() {
  return document.body.classList.contains('splash-active') && !document.body.classList.contains('splash-revealing');
}
function getAdaptiveRenderFps() {
  if (isDeepBackgroundMode()) return 1;
  // 前台帧率上限（移植自上游）：vsync = 跟随屏幕自适应；固定档位用于节能/降负载
  var fpsMode = (typeof normalizeForegroundFpsMode === 'function') ? normalizeForegroundFpsMode(fx && fx.foregroundFpsMode) : 'vsync';
  var cap = typeof fpsMode === 'number' ? fpsMode : 0;
  if (RENDER_VISIBLE_VSYNC) return cap || 0;
  var tier = (typeof getRenderLoadTier === 'function') ? getRenderLoadTier() : 0;
  if (typeof isRenderInteractionActive === 'function' && isRenderInteractionActive()) {
    if (tier >= 2) return cap ? Math.min(RENDER_INTERACTION_HUGE_FPS, cap) : RENDER_INTERACTION_HUGE_FPS;
    if (tier >= 1) return cap ? Math.min(RENDER_INTERACTION_LARGE_FPS, cap) : RENDER_INTERACTION_LARGE_FPS;
    return cap ? Math.min(RENDER_INTERACTION_FPS, cap) : RENDER_INTERACTION_FPS;
  }
  if (tier >= 2) return cap ? Math.min(RENDER_HUGE_FPS, cap) : RENDER_HUGE_FPS;
  if (tier >= 1) return cap ? Math.min(RENDER_LARGE_FPS, cap) : RENDER_LARGE_FPS;
  return cap || RENDER_ACTIVE_FPS;
}
function shouldSkipAdaptiveRenderFrame(now) {
  var fps = getAdaptiveRenderFps();
  renderPerfState.mode = fps ? (fps + 'fps') : 'vsync';
  if (!fps) {
    renderPerfState.lastRenderAt = now;
    return false;
  }
  var minGap = 1000 / fps;
  if (now - renderPerfState.lastRenderAt < minGap) {
    renderPerfState.skipped += 1;
    return true;
  }
  renderPerfState.lastRenderAt = now;
  return false;
}
function sampleRenderPerf(now, dt) {
  renderPerfState.frames += 1;
  if (dt > 0.034) renderPerfState.longFrames += 1;
  if (now - renderPerfState.lastSampleAt >= 1000) {
    renderPerfState.fps = Math.round(renderPerfState.frames * 1000 / Math.max(1, now - renderPerfState.lastSampleAt));
    renderPerfState.frames = 0;
    renderPerfState.lastSampleAt = now;
  }
  maybeTrimRuntimeCaches(now);
}
function animate() {
  requestAnimationFrame(animate);
  var now = performance.now();
  if (shouldSkipAdaptiveRenderFrame(now)) return;
  var dt = Math.min((now - prevTime) / 1000, 0.05);
  prevTime = now;
  sampleRenderPerf(now, dt);
  uniforms.uTime.value += dt;
  if (isMainSceneCoveredBySplash()) {
    if (now - splashWarmRenderLast > 520) {
      splashWarmRenderLast = now;
      renderer.render(scene, camera);
    }
    return;
  }
  pointerParallax.x += (pointerTarget.x - pointerParallax.x) * 0.040;
  pointerParallax.y += (pointerTarget.y - pointerParallax.y) * 0.040;

  // 频谱分析 — v7.1: 真正分离 kick 和人声
  // bin = sampleRate / fftSize = 44100/2048 ≈ 21.5Hz
  // kick 60-150Hz → bin 3-7 (用前 5 个 bin)
  // vocal 200-3000Hz → bin 9-140 (尽量不计入 bass/mid 的"鼓点"判断)
  // 真正的 mid 乐器/和声: 3000-6000Hz → bin 140-280
  // treble: 6000Hz+ → bin 280+
  beatOnsetFlag = false;
  if (analyser && playing && audio && !audio.paused) {
    if (audioCtx && audioCtx.state === 'suspended') resumeAudioAnalysis();
    analyser.getByteFrequencyData(frequencyData);
    analyser.getByteTimeDomainData(timeDomainData);
    var len = frequencyData.length;
    // 精确频段
    var kickEnd  = 7;                          // 60-150 Hz, 鼓 kick
    var vocalEnd = Math.min(len, 140);         // 200-3000 Hz, 人声主体
    var midEnd   = Math.min(len, 280);         // 3-6 kHz, 中高乐器
    // 累积
    var bKick = 0, mInst = 0, tHigh = 0, voc = 0, rms = 0;
    for (var i = 0; i < kickEnd; i++) bKick += frequencyData[i] / 255;
    for (var i = kickEnd; i < vocalEnd; i++) voc += frequencyData[i] / 255;
    for (var i = vocalEnd; i < midEnd; i++) mInst += frequencyData[i] / 255;
    for (var i = midEnd; i < len; i++) tHigh += frequencyData[i] / 255;
    for (var j = 0; j < timeDomainData.length; j++) {
      var tv = (timeDomainData[j] - 128) / 128;
      rms += tv * tv;
    }
    bKick /= kickEnd;
    voc /= (vocalEnd - kickEnd);
    mInst /= Math.max(1, midEnd - vocalEnd);
    tHigh /= Math.max(1, len - midEnd);
    rms = Math.sqrt(rms / timeDomainData.length);

    // 动态峰值跟踪
    bassPeak = Math.max(bassPeak * 0.994, bKick, 0.030);
    midPeak  = Math.max(midPeak  * 0.993, mInst, 0.026);
    treblePeak = Math.max(treblePeak * 0.992, tHigh, 0.018);
    energyPeak = Math.max(energyPeak * 0.995, rms, 0.030);

    var rb = Math.min(1, Math.pow(bKick / Math.max(0.038, bassPeak * 0.66), 0.78));
    var rm = Math.min(1, Math.pow(mInst / Math.max(0.025, midPeak  * 0.70), 0.86));
    var rt = Math.min(1, Math.pow(tHigh / Math.max(0.020, treblePeak * 0.74), 0.92));
    var re = Math.min(1, Math.pow(rms / Math.max(0.034, energyPeak * 0.68), 0.82));

    var bassOnset = Math.max(0, rb - smoothBass);
    var energyOnset = Math.max(0, re - prevEnergy);
    prevEnergy = prevEnergy * 0.88 + re * 0.12;

    var realtimeBeat = processRealtimeBeatEngine(dt);
    if (realtimeBeat && realtimeBeat.hit) {
      var dj = djMode.active;
      var djMapCoversCurrentTime = !dj || !currentDjBeatMap || !currentDjBeatMap.partialUntilSec || !audio || (audio.currentTime || 0) <= currentDjBeatMap.partialUntilSec - 1.25;
      var djBeatMapReadyForCamera = dj && currentDjBeatMap && currentDjBeatMap.cameraBeats && currentDjBeatMap.cameraBeats.length >= 4 && djMapCoversCurrentTime;
      var beatMapReadyForCamera = dj ? djBeatMapReadyForCamera : (currentBeatMap && currentBeatMap.cameraBeats && currentBeatMap.cameraBeats.length >= 4);
      var waitingForBeatMap = dj ? !djBeatMapReadyForCamera : (!beatMapReadyForCamera && (!!beatMapBusy || !!beatAnalysisTimer || ((audio && audio.currentTime) || 0) < 18));
      var liveKickFrame = dj
        ? (realtimeBeat.low > 0.48 && rb > 0.38 && bassOnset > 0.055 && energyOnset > 0.010 && (realtimeBeat.lowDominance || 0) > 0.82)
        : (realtimeBeat.low > 0.50 && rb > 0.42 && bassOnset > 0.070 && energyOnset > 0.016);
      var liveStrongHit = dj
        ? (realtimeBeat.confidence > 0.60 && realtimeBeat.strength > 0.56 && realtimeBeat.score > 0.50 && liveKickFrame)
        : (realtimeBeat.confidence > 0.76 && realtimeBeat.strength > 0.70 && realtimeBeat.score > 0.56 && liveKickFrame);
      var liveTempoHit = dj
        ? (realtimeBeat.tempoAssist && realtimeBeat.confidence > 0.62 && realtimeBeat.strength > 0.52 && realtimeBeat.low > 0.48 && (liveKickFrame || bassOnset > 0.046))
        : (realtimeBeat.tempoAssist && realtimeBeat.confidence > 0.80 && realtimeBeat.strength > 0.66 && realtimeBeat.low > 0.50 && bassOnset > 0.052);
      var liveFallbackOk = dj
        ? (liveStrongHit || liveTempoHit)
        : (waitingForBeatMap
          ? (liveStrongHit || liveTempoHit)
          : (realtimeBeat.confidence > 0.84 && realtimeBeat.strength > 0.80 && realtimeBeat.low > 0.54 && (liveKickFrame || realtimeBeat.score > 0.68)));
      if (!beatMapReadyForCamera && liveFallbackOk) {
        scheduleBeatCamera({
          time: realtimeBeat.time,
          strength: realtimeBeat.strength,
          confidence: realtimeBeat.confidence,
          low: realtimeBeat.low,
          body: realtimeBeat.body,
          snap: realtimeBeat.snap,
          mass: realtimeBeat.mass,
          sharpness: realtimeBeat.sharpness,
          combo: realtimeBeat.combo,
          impact: clamp01(realtimeBeat.strength * 0.46 + realtimeBeat.confidence * 0.20 + realtimeBeat.low * 0.28),
          preview: waitingForBeatMap,
          primary: true,
          dj: dj
        }, 'live');
      }
      if (!beatMapReadyForCamera && liveFallbackOk) {
        var previewPulseScale = waitingForBeatMap && !dj ? 0.68 : 1;
        var rtPulse = Math.min(dj ? 0.34 : (waitingForBeatMap ? 0.46 : 0.62), realtimeBeat.strength * (realtimeBeat.tempoAssist ? (dj ? 0.42 : 0.62) : (dj ? 0.48 : 0.68)) * previewPulseScale);
        if (rtPulse > beatPulse + 0.09) beatOnsetFlag = true;
        beatPulse = Math.max(beatPulse, rtPulse);
      }
    } else if (bassOnset > 0.075 && rb > 0.32 && energyOnset > 0.020) {
      beatPulse = Math.max(beatPulse, Math.min(0.12, bassOnset * 0.18));
    }
    beatPulse *= Math.pow(0.36, dt);

    // v7.2+: 预解析 beatmap 只在实时引擎暂时没锁住时补位.
    tickPodcastDjBeatMap();
    tickBeatMap();
    if (scheduledBeatFlag) {
      beatOnsetFlag = true;
      scheduledBeatFlag = false;
    }
    // scheduledBeatPulse 衰减并合并到 beatPulse
    if (scheduledBeatPulse > beatPulse) beatPulse = scheduledBeatPulse;
    scheduledBeatPulse *= Math.pow(0.32, dt);

    function env(prev, next, attack, release) {
      var k = next > prev ? attack : release;
      return prev + (next - prev) * k;
    }
    // smoothBass 主要由 kick 驱动 (不被人声干扰)
    smoothBass  = env(smoothBass, Math.min(0.82, rb * 0.78 + re * 0.025), 0.28, 0.075);
    // smoothMid 用 中高乐器, 不再混入人声
    smoothMid   = env(smoothMid,  Math.min(0.68, rm * 0.64 + re * 0.025), 0.18, 0.060);
    smoothTreb  = env(smoothTreb, Math.min(0.56, rt * 0.54), 0.18, 0.055);
    smoothEnergy= env(smoothEnergy, Math.min(0.72, re), 0.16, 0.055);
    updateCinemaDynamics(re, rb);
    updateCinemaTrackProfile({ energy: re, low: rb, vocal: voc, melody: rm, lowOnset: bassOnset, energyOnset: energyOnset });
    // 歌词阳光溢光: 独立于律动强度, 看持续能量 + 中高频抬升, 更像副歌/高音段落而不是单个鼓点.
    var sunEnergy = clamp01((smoothEnergy - 0.18) / 0.38);
    var sunVoice = clamp01((voc - 0.11) / 0.34);
    var sunMelody = clamp01((smoothMid - 0.16) / 0.27);
    var sunAir = clamp01((smoothTreb - 0.105) / 0.17);
    var sunRaw = clamp01(sunEnergy * 0.36 + sunVoice * 0.18 + sunMelody * 0.26 + sunAir * 0.20);
    sunRaw = sunRaw * sunRaw * (3 - 2 * sunRaw);
    lyricSunAvg += (sunRaw - lyricSunAvg) * 0.006;
    lyricSunPeak = Math.max(0.48, lyricSunPeak * 0.9985, sunRaw);
    var sunThreshold = Math.max(0.78, lyricSunAvg + 0.20, lyricSunPeak * 0.74);
    var sunGate = clamp01((sunRaw - sunThreshold) / Math.max(0.08, 1.0 - sunThreshold));
    sunGate = sunGate * sunGate * (3 - 2 * sunGate);
    lyricSunHold += (sunGate - lyricSunHold) * (sunGate > lyricSunHold ? 0.035 : 0.014);
    lyricSunTarget = lyricSunHold > 0.16 ? clamp01((lyricSunHold - 0.16) / 0.84) : 0;
    lyricSunEnergy += (lyricSunTarget - lyricSunEnergy) * (lyricSunTarget > lyricSunEnergy ? 0.075 : 0.030);
  } else {
    smoothBass *= 0.91; smoothMid *= 0.91; smoothTreb *= 0.91; smoothEnergy *= 0.91; beatPulse *= 0.82;
    liveCamAvg *= 0.94;
    liveCamPeak = Math.max(0.28, liveCamPeak * 0.98);
    liveCamLastRaw *= 0.80;
    lyricSunTarget = 0;
    lyricSunHold *= 0.90;
    lyricSunEnergy *= 0.92;
    lyricSunAvg *= 0.995;
    lyricSunPeak = Math.max(0.48, lyricSunPeak * 0.997);
  }
  audioEnergy = Math.max(smoothEnergy, beatPulse * 0.30);
  bass = Math.min(0.90, smoothBass * 1.05 + beatPulse * 0.18) * fx.intensity;
  mid  = Math.min(0.72, smoothMid * 1.12) * fx.intensity;
  treble = Math.min(0.62, smoothTreb * 1.20) * fx.intensity;
  if (fx.preset >= 4 && !(typeof WebFxPresets !== 'undefined' && WebFxPresets.isWebFxPreset(fx.preset))) {
    var wallpaperAudio = fx.preset === 5;
    var ringBass = smoothBass * (wallpaperAudio ? 1.10 : 1.58) + beatPulse * (wallpaperAudio ? 0.18 : 0.42) - smoothMid * 0.16 - smoothTreb * 0.06;
    var ringMid = smoothMid * (wallpaperAudio ? 1.16 : 1.82) - smoothBass * 0.14 - smoothTreb * 0.07;
    var ringTreble = smoothTreb * (wallpaperAudio ? 1.34 : 2.28) - smoothMid * 0.10 - smoothBass * 0.05;
    bass = Math.pow(clamp01((ringBass - 0.050) / 0.58), 0.72) * fx.intensity;
    mid = Math.pow(clamp01((ringMid - 0.045) / 0.46), 0.78) * fx.intensity;
    treble = Math.pow(clamp01((ringTreble - 0.030) / 0.34), 0.84) * fx.intensity;
    if (wallpaperAudio) {
      bass = Math.min(bass, 0.46 * fx.intensity);
      mid = Math.min(mid, 0.40 * fx.intensity);
      treble = Math.min(treble, 0.36 * fx.intensity);
      beatPulse *= 0.34;
    }
  } else if (typeof WebFxPresets !== 'undefined' && WebFxPresets.isWebFxPreset(fx.preset)) {
    var wfa = WebFxPresets.remapAudio(fx.preset, smoothBass, smoothMid, smoothTreb, fx.intensity);
    if (wfa) { bass = wfa.bass; mid = wfa.mid; treble = wfa.treble; }
  }
  if (djMode.active) {
    bass = Math.min(1.00, bass * 1.06 + beatPulse * 0.085);
    mid = Math.min(0.76, mid * 1.00 + clamp01(djMode.sectionChange * 1.6) * 0.020);
    treble = Math.min(0.66, treble * 0.98);
    audioEnergy = Math.max(audioEnergy, beatPulse * 0.38, djMode.sectionEnergy * 0.54);
  }

  var vinylSpeedMul = isFinite(fx.speed) ? Math.max(0.05, fx.speed) : 1;
  var vinylSpinSpeed = (0.40 + smoothBass * 0.09) * vinylSpeedMul;
  uniforms.uVinylSpin.value = (uniforms.uVinylSpin.value + dt * vinylSpinSpeed) % (Math.PI * 2);

  updateParticlePointerFrame();
  uniforms.uBass.value   = bass;
  uniforms.uMid.value    = mid;
  uniforms.uTreble.value = treble;
  uniforms.uBeat.value   = beatPulse;
  uniforms.uEnergy.value = audioEnergy;
  uniforms.uMouseXY.value.set(mouseWorld.x, mouseWorld.y);
  uniforms.uMouseActive.value = mouseActive ? 1 : 0;
  if (typeof WebFxPresets !== 'undefined') {
    WebFxPresets.tickAges(uniforms, uniforms.uTime.value);
    var dbSize = renderer.getSize ? renderer.getSize(new THREE.Vector2()) : new THREE.Vector2(window.innerWidth, window.innerHeight);
    var maxPointSize = (renderer.capabilities && renderer.capabilities.maxPointSize) || 1024;
    uniforms.uResolution.value.set(dbSize.x * (renderer.getPixelRatio ? renderer.getPixelRatio() : 1), dbSize.y * (renderer.getPixelRatio ? renderer.getPixelRatio() : 1));
    uniforms.uMeteorSize.value = Math.min(dbSize.y * 0.22, maxPointSize);
    uniforms.uJellyAura.value = Math.min(dbSize.y * 0.25, maxPointSize);
  }
  var sonicPresetActiveEarly = !!(window.MineradioSonicTopography && MineradioSonicTopography.isActive(fx)) || !!(window.MineradioSonicWorkshop && MineradioSonicWorkshop.isActive(fx));
  var skullBackdropDim = fx && fx.preset === SKULL_PRESET_INDEX ? 0.58 : (sonicPresetActiveEarly ? 0.82 : 1);
  // 封面粒子避光：关闭时悬浮层展开不再压低背景粒子
  var shelfDimTarget = fx && fx.coverBackdropAdapt === false ? skullBackdropDim : (shouldDimWallpaperForShelf() ? 0.48 : skullBackdropDim);
  var shelfDimEase = shelfDimTarget < uniforms.uParticleDim.value ? 0.18 : 0.10;
  uniforms.uParticleDim.value += (shelfDimTarget - uniforms.uParticleDim.value) * Math.min(1, shelfDimEase * Math.max(1, dt * 60));
  // 背景星河透明度推进（fx.backgroundStarRiver 门控，见 backgroundStarRiverTargetAlpha）
  updateBackgroundStarRiverState(dt);

  // 通用转场脉冲: 只作为切换预设时的短促提亮。
  uniforms.uBurstAmt.value *= 0.90;
  tickPresetTransition();

  updateRipples(dt);
  updateFloatLayer(dt);
  if (shelfManager) shelfManager.update(dt);
  tickLyricsParticles();
  updateHomeAudioVisual(dt);

  // 电影镜头
  updateCinema(dt);
  updateFreeCamera(dt);
  updateCamera();
  applySkullCameraPose(dt);

  // v7.2 旋转 = 头部+眼球追踪 + 鼠标/手势拖动 + 惯性
  tickGestureRotation(dt);
  var skullPresetActive = fx && fx.preset === SKULL_PRESET_INDEX;
  var workshopPresetActive = !!(window.MineradioSonicWorkshop && MineradioSonicWorkshop.isActive(fx));
  particles.visible = !skullPresetActive && !workshopPresetActive;
  if (bloomParticles) bloomParticles.visible = !skullPresetActive && !workshopPresetActive && fx.bloom && fx.bloomStrength > 0.01;
  if (floatGroup) floatGroup.visible = !skullPresetActive && !workshopPresetActive;
  if (backCoverGroup) backCoverGroup.visible = !skullPresetActive && !workshopPresetActive;
  var targetRotY = orbit.centerLocked ? 0 : (headParallax.active ? headParallax.x * 0.5 : 0) + gestureRotation.y;
  var targetRotX = orbit.centerLocked ? 0 : (headParallax.active ? -headParallax.y * 0.35 : 0) + gestureRotation.x;
  particles.rotation.y += (targetRotY - particles.rotation.y) * 0.055;
  particles.rotation.x += (targetRotX - particles.rotation.x) * 0.055;
  if (bloomParticles) {
    bloomParticles.rotation.copy(particles.rotation);
  }
  // 同步给背面粒子层
  if (floatGroup) {
    floatGroup.rotation.copy(particles.rotation);
  }
  if (backCoverGroup) {
    backCoverGroup.rotation.copy(particles.rotation);
  }
  // 音域回响两预设：地形（宿主 scene 内）+ 工坊（iframe 桥接），移植自上游 11-main-loop
  if (window.MineradioSonicTopography) {
    MineradioSonicTopography.update(dt, {
      scene: scene,
      fx: fx,
      time: uniforms.uTime.value,
      screenHeight: window.innerHeight,
      dpr: renderer.getPixelRatio ? renderer.getPixelRatio() : (window.devicePixelRatio || 1),
      visualRotation: particles && particles.rotation ? particles.rotation : null,
      visualRotationActive: !!(orbit && orbit.rotating),
      audio: { bass: bass, mid: mid, treble: treble, beat: beatPulse, energy: audioEnergy }
    });
  }
  if (window.MineradioSonicWorkshop) {
    MineradioSonicWorkshop.update(dt, {
      scene: scene,
      fx: fx,
      time: uniforms.uTime.value,
      audio: { bass: bass, mid: mid, treble: treble, beat: beatPulse, energy: audioEnergy }
    });
  }
  updateSkullParticleLayer(dt);
  updateStageLyrics3D(dt);
  syncDesktopOverlayState();

  // 缩略图脉动
  if (currentIdx >= 0) {
    var s = 1 + bass * 0.08;
    var thumbCoverEl = document.getElementById('thumb-cover');
    if (thumbCoverEl) thumbCoverEl.style.transform = 'scale(' + s + ')';
  }

  renderer.render(scene, camera);
}
animate();
