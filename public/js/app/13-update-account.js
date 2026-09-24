'use strict';

// ============================================================
//  13-update-account.js  ←  源 main.js §34–§35（基线 784afe6）
//  更新提示预览 / 登录系统
// ============================================================

// ============================================================
//  更新提示预览
// ============================================================
function formatUpdateBytes(bytes) {
  bytes = Number(bytes) || 0;
  if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(2).replace(/\.00$/, '') + ' GB';
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '') + ' MB';
  if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB';
  return bytes + ' B';
}
function formatUpdateSpeed(bytesPerSecond) {
  bytesPerSecond = Number(bytesPerSecond) || 0;
  return bytesPerSecond > 0 ? (formatUpdateBytes(bytesPerSecond) + '/s') : '';
}
function updateProgressDetailText() {
  var parts = [];
  if (updatePreviewState.attempts > 1 && updatePreviewState.attempt > 0) {
    parts.push('线路 ' + updatePreviewState.attempt + '/' + updatePreviewState.attempts);
  }
  if (updatePreviewState.sourceLabel) parts.push(updatePreviewState.sourceLabel);
  if (updatePreviewState.received > 0) {
    parts.push(updatePreviewState.total > 0
      ? (formatUpdateBytes(updatePreviewState.received) + ' / ' + formatUpdateBytes(updatePreviewState.total))
      : ('已下载 ' + formatUpdateBytes(updatePreviewState.received)));
  }
  var speed = formatUpdateSpeed(updatePreviewState.speedBps);
  if (speed) parts.push(speed);
  if (updatePreviewState.etaSeconds > 0 && updatePreviewState.etaSeconds < 3600) parts.push('约 ' + updatePreviewState.etaSeconds + ' 秒');
  return parts.join(' · ');
}
function initUpdatePreview() {
  renderUpdatePreviewPanel();
  setUpdatePreviewVisible(true);
  checkLatestUpdate();
  setTimeout(startUpdateIconBreathing, 760);
}

function setUpdatePreviewVisible(visible) {
  updatePreviewState.visible = !!visible;
  var entry = document.getElementById('update-entry');
  if (!entry) return;
  entry.classList.toggle('available', updatePreviewState.visible);
  if (!updatePreviewState.visible && window.gsap) {
    window.gsap.killTweensOf(entry);
    window.gsap.set(entry, { autoAlpha: 0, y: 0, clearProps: 'boxShadow,filter,scale' });
    return;
  }
  if (updatePreviewState.visible && window.gsap) {
    window.gsap.fromTo(entry,
      { autoAlpha: 0, y: -6, scale: 0.92, filter: 'blur(6px)' },
      { autoAlpha: 1, y: 0, scale: 1, filter: 'blur(0px)', duration: 0.62, delay: 0.18, ease: 'expo.out', overwrite: true }
    );
  }
}

async function checkLatestUpdate() {
  try {
    var data = await apiJson('/api/update/latest?t=' + Date.now());
    applyLatestUpdateInfo(data);
  } catch (e) {
    updatePreviewState.preview = true;
    updatePreviewState.updateAvailable = false;
    updatePreviewState.hero = '当前版本，更新检测已就绪。';
    renderUpdatePreviewPanel();
    setUpdatePreviewVisible(true);
  }
}

function applyLatestUpdateInfo(data) {
  data = data || {};
  var release = data.release || {};
  updatePreviewState.currentVersion = data.currentVersion || updatePreviewState.currentVersion;
  updatePreviewState.version = data.latestVersion || release.version || updatePreviewState.currentVersion;
  updatePreviewState.configured = !!data.configured;
  updatePreviewState.preview = !!data.preview;
  updatePreviewState.updateAvailable = !!data.updateAvailable;
  updatePreviewState.releaseUrl = release.htmlUrl || data.htmlUrl || '';
  updatePreviewState.downloadUrl = release.downloadUrl || data.downloadUrl || '';
  updatePreviewState.patchAvailable = !!(release.patchAvailable && release.patch && release.patch.downloadUrl);
  updatePreviewState.patchUrl = updatePreviewState.patchAvailable ? release.patch.downloadUrl : '';
  updatePreviewState.patchFallbackTried = false;
  updatePreviewState.hero = release.summary || (updatePreviewState.updateAvailable ? '发现新版本，建议更新。' : '当前版本，更新检测已就绪。');
  if (Array.isArray(release.notes) && release.notes.length) {
    updatePreviewState.notes = release.notes.slice(0, 4);
  }
  renderUpdatePreviewPanel();
  setUpdatePreviewVisible(updatePreviewState.updateAvailable || updatePreviewState.preview);
}

function startUpdateIconBreathing() {
  var entry = document.getElementById('update-entry');
  if (!entry || !window.gsap) return;
  var ring = entry.querySelector('.update-ring');
  window.gsap.killTweensOf(entry, 'y,boxShadow');
  window.gsap.set(entry, { autoAlpha: 1 });
  if (ring) window.gsap.killTweensOf(ring);
  window.gsap.to(entry, {
    y: -1.4,
    boxShadow: '0 16px 44px rgba(0,0,0,.32),0 0 24px rgba(244,210,138,.18),0 0 13px rgba(157,184,207,.06),inset 0 1px 0 rgba(255,255,255,.11)',
    duration: 2.6,
    repeat: -1,
    yoyo: true,
    ease: 'sine.inOut'
  });
  if (ring) {
    window.gsap.to(ring, {
      rotate: 18,
      duration: 3.8,
      repeat: -1,
      yoyo: true,
      ease: 'sine.inOut',
      transformOrigin: '50% 50%'
    });
  }
}

function renderUpdatePreviewPanel() {
  var version = document.getElementById('update-modal-version');
  var hero = document.getElementById('update-hero-main');
  var list = document.getElementById('update-list');
  if (version) version.textContent = 'v' + updatePreviewState.version;
  if (hero) hero.textContent = updatePreviewState.hero || '当前版本，更新检测已就绪。';
  if (list) {
    var notes = Array.isArray(updatePreviewState.notes) && updatePreviewState.notes.length ? updatePreviewState.notes : ['更新检测已就绪'];
    list.innerHTML = notes.map(function(text, i){
      return '<div class="update-item"><span class="update-item-dot" data-index="' + String(i + 1).padStart(2, '0') + '"></span><div class="update-item-text">' + escHtml(text) + '</div></div>';
    }).join('');
  }
  updateUpdatePreviewProgress(updatePreviewState.progress);
  syncUpdatePreviewStateClass();
}

function syncUpdatePreviewStateClass() {
  var entry = document.getElementById('update-entry');
  var modal = document.querySelector('#update-modal .update-modal');
  var isDownloading = updatePreviewState.status === 'downloading';
  var isReady = updatePreviewState.status === 'ready';
  var isError = updatePreviewState.status === 'error';
  var isOpening = updatePreviewState.status === 'opening';
  var isPatch = updatePreviewState.mode === 'patch';
  if (entry) {
    entry.classList.toggle('downloading', isDownloading || isOpening);
    entry.classList.toggle('ready', isReady);
  }
  if (modal) {
    modal.classList.toggle('ready', isReady);
    modal.classList.toggle('error', isError);
  }
  var label = document.getElementById('update-btn-label');
  var btn = document.getElementById('update-primary-btn');
  var canDownloadUpdate = updatePreviewState.configured && updatePreviewState.updateAvailable && updatePreviewState.downloadUrl;
  var canOpenRelease = updatePreviewState.configured && updatePreviewState.updateAvailable && !updatePreviewState.downloadUrl && updatePreviewState.releaseUrl;
  if (label) {
    if (isDownloading) label.textContent = (isPatch ? '快速补丁 ' : '正在下载 ') + Math.round(updatePreviewState.progress) + '%';
    else if (isOpening) label.textContent = '正在打开安装包';
    else if (isError && updatePreviewState.mode === 'patch' && updatePreviewState.downloadUrl) label.textContent = '下载完整安装包';
    else if (isError) label.textContent = updatePreviewState.mode === 'installer' ? '重试下载' : '重试更新';
    else if (isReady && isPatch && updatePreviewState.restartRequired) label.textContent = '重启生效';
    else if (isReady && isPatch) label.textContent = '补丁已应用';
    else if (isReady && updatePreviewState.installerOpened) label.textContent = '安装包已打开';
    else if (isReady && updatePreviewState.installerPath) label.textContent = updatePreviewState.cached ? '打开已下载安装包' : '打开安装包';
    else if (isReady) label.textContent = updatePreviewState.configured ? '打开安装包' : '预览完成';
    else label.textContent = updatePreviewState.patchAvailable ? '安装快速补丁' : ((canDownloadUpdate || canOpenRelease) ? '下载完整安装包' : '立即更新');
  }
  if (btn) btn.disabled = false;
  var foot = document.getElementById('update-footnote');
  if (foot) {
    if (isDownloading) foot.textContent = (updatePreviewState.message || (isPatch ? '正在下载快速补丁' : '正在下载完整安装包')) + (updateProgressDetailText() ? ' · ' + updateProgressDetailText() : '');
    else if (isError) foot.textContent = '下载失败：' + (updatePreviewState.errorReason || updatePreviewState.errorDetail || updatePreviewState.message || '请稍后重试') + (updatePreviewState.failedAttempts && updatePreviewState.failedAttempts.length ? ' · 已尝试 ' + updatePreviewState.failedAttempts.length + ' 条线路' : '');
    else if (isReady && isPatch) foot.textContent = updatePreviewState.restartRequired ? '快速补丁已应用，重启 BhandsMusic 后生效。' : '快速补丁已应用。';
    else if (isReady) foot.textContent = updatePreviewState.cached ? '已复用上次校验通过的安装包，不会重复下载。' : '安装包已准备好，点击按钮后再打开安装。';
    else if (updatePreviewState.patchAvailable) foot.textContent = '优先使用轻量补丁，只更新缺失或变更的资源文件；不适用时可下载完整安装包。';
    else foot.textContent = updatePreviewState.updateAvailable ? '没有可用快速补丁时会下载完整安装包。' : '当前版本已是最新。';
  }
}

function updateUpdatePreviewProgress(progress) {
  updatePreviewState.progress = clampRange(Number(progress) || 0, 0, 100);
  var fill = document.getElementById('update-btn-fill');
  if (fill) fill.style.width = updatePreviewState.progress + '%';
  var ring = document.getElementById('update-progress-ring');
  if (ring) {
    var circumference = 55.29;
    ring.style.strokeDashoffset = (circumference * (1 - updatePreviewState.progress / 100)).toFixed(2);
  }
  syncUpdatePreviewStateClass();
}

function openUpdatePanel() {
  var mask = document.getElementById('update-modal');
  var entry = document.getElementById('update-entry');
  if (!mask) return;
  renderUpdatePreviewPanel();
  if (entry && window.gsap) {
    window.gsap.fromTo(entry, { scale: 0.93 }, { scale: 1, duration: 0.42, ease: 'back.out(1.7)', overwrite: 'auto' });
  }
  openGsapModal(mask);
  updatePreviewState.open = true;
  animateUpdatePanelContents();
}


function animateUpdatePanelContents() {
  if (!window.gsap) return;
  var modal = document.querySelector('#update-modal .update-modal');
  if (!modal) return;
  var parts = [
    modal.querySelector('.update-kicker'),
    modal.querySelector('.update-version'),
    modal.querySelector('.update-hero')
  ].filter(Boolean);
  var items = Array.prototype.slice.call(modal.querySelectorAll('.update-item'));
  var actions = modal.querySelector('.update-actions');
  window.gsap.fromTo(parts,
    { autoAlpha: 0, x: -7, filter: 'blur(5px)' },
    { autoAlpha: 1, x: 0, filter: 'blur(0px)', duration: 0.50, ease: 'power3.out', stagger: 0.045, delay: 0.10, overwrite: true }
  );
  window.gsap.fromTo(items,
    { autoAlpha: 0, x: -8 },
    { autoAlpha: 1, x: 0, duration: 0.34, ease: 'power3.out', stagger: 0.055, delay: 0.25, overwrite: true }
  );
  if (actions) {
    window.gsap.fromTo(actions,
      { autoAlpha: 0, y: 8 },
      { autoAlpha: 1, y: 0, duration: 0.36, ease: 'power3.out', delay: 0.42, overwrite: true }
    );
  }
}

async function startRealUpdateDownload() {
  if (updatePreviewState.status === 'downloading' || updatePreviewState.status === 'opening') return;
  if (updatePreviewState.status === 'ready' && updatePreviewState.installerPath) {
    openDownloadedUpdateInstaller(updatePreviewState.installerPath);
    return;
  }
  if (updatePreviewState.timer) clearInterval(updatePreviewState.timer);
  if (updatePreviewState.pollTimer) clearInterval(updatePreviewState.pollTimer);
  updatePreviewState.status = 'downloading';
  updatePreviewState.progress = 0;
  updatePreviewState.mode = 'installer';
  updatePreviewState.downloadJobId = '';
  updatePreviewState.installerPath = '';
  updatePreviewState.installerOpened = false;
  updatePreviewState.cached = false;
  updatePreviewState.received = 0;
  updatePreviewState.total = 0;
  updatePreviewState.speedBps = 0;
  updatePreviewState.etaSeconds = 0;
  updatePreviewState.sourceLabel = '';
  updatePreviewState.attempt = 0;
  updatePreviewState.attempts = 0;
  updatePreviewState.errorReason = '';
  updatePreviewState.errorDetail = '';
  updatePreviewState.failedAttempts = [];
  updatePreviewState.message = '正在下载完整安装包';
  updateUpdatePreviewProgress(0);
  try {
    var job = await apiJson('/api/update/download', { method: 'POST' });
    if (!job || job.ok === false || !job.id) throw new Error((job && job.error) || 'UPDATE_DOWNLOAD_START_FAILED');
    updatePreviewState.downloadJobId = job.id;
    applyUpdateDownloadJob(job);
    updatePreviewState.pollTimer = setInterval(function(){
      pollUpdateDownloadJob(job.id);
    }, 360);
  } catch (e) {
    updatePreviewState.status = 'error';
    updatePreviewState.errorReason = (e && e.message) || '更新下载启动失败';
    updatePreviewState.errorDetail = updatePreviewState.errorReason;
    updatePreviewState.message = updatePreviewState.errorReason;
    updateUpdatePreviewProgress(0);
    showToast('更新下载启动失败：' + updatePreviewState.errorReason);
  }
}
async function startRealUpdatePatch() {
  if (updatePreviewState.status === 'downloading' || updatePreviewState.status === 'opening') return;
  if (updatePreviewState.status === 'ready' && updatePreviewState.mode === 'patch') {
    restartForAppliedPatch();
    return;
  }
  if (updatePreviewState.timer) clearInterval(updatePreviewState.timer);
  if (updatePreviewState.pollTimer) clearInterval(updatePreviewState.pollTimer);
  updatePreviewState.status = 'downloading';
  updatePreviewState.mode = 'patch';
  updatePreviewState.progress = 0;
  updatePreviewState.patchJobId = '';
  updatePreviewState.installerPath = '';
  updatePreviewState.installerOpened = false;
  updatePreviewState.cached = false;
  updatePreviewState.received = 0;
  updatePreviewState.total = 0;
  updatePreviewState.speedBps = 0;
  updatePreviewState.etaSeconds = 0;
  updatePreviewState.sourceLabel = '';
  updatePreviewState.attempt = 0;
  updatePreviewState.attempts = 0;
  updatePreviewState.errorReason = '';
  updatePreviewState.errorDetail = '';
  updatePreviewState.failedAttempts = [];
  updatePreviewState.patchFallbackTried = false;
  updatePreviewState.message = '正在下载快速补丁';
  updateUpdatePreviewProgress(0);
  try {
    var job = await apiJson('/api/update/patch', { method: 'POST' });
    if (!job || job.ok === false || !job.id) throw new Error((job && job.error) || 'UPDATE_PATCH_START_FAILED');
    updatePreviewState.patchJobId = job.id;
    applyUpdateDownloadJob(job);
    updatePreviewState.pollTimer = setInterval(function(){
      pollUpdatePatchJob(job.id);
    }, 320);
  } catch (e) {
    updatePreviewState.status = 'error';
    updatePreviewState.errorReason = (e && e.message) || '快速补丁不可用';
    updatePreviewState.errorDetail = updatePreviewState.errorReason;
    updatePreviewState.message = updatePreviewState.errorReason;
    updateUpdatePreviewProgress(0);
    updatePreviewState.patchFallbackTried = true;
    showToast('快速补丁不可用，可手动下载完整安装包');
  }
}

async function pollUpdateDownloadJob(id) {
  if (!id) return;
  try {
    var job = await apiJson('/api/update/download/status?id=' + encodeURIComponent(id) + '&t=' + Date.now());
    applyUpdateDownloadJob(job);
  } catch (e) {
    if (updatePreviewState.pollTimer) clearInterval(updatePreviewState.pollTimer);
    updatePreviewState.pollTimer = null;
    updatePreviewState.status = 'error';
    updatePreviewState.errorReason = '更新下载状态读取失败';
    updatePreviewState.errorDetail = (e && e.message) || updatePreviewState.errorReason;
    updatePreviewState.message = updatePreviewState.errorReason;
    updateUpdatePreviewProgress(updatePreviewState.progress || 0);
    showToast('更新下载状态读取失败');
  }
}
async function pollUpdatePatchJob(id) {
  if (!id) return;
  try {
    var job = await apiJson('/api/update/patch/status?id=' + encodeURIComponent(id) + '&t=' + Date.now());
    applyUpdateDownloadJob(job);
  } catch (e) {
    if (updatePreviewState.pollTimer) clearInterval(updatePreviewState.pollTimer);
    updatePreviewState.pollTimer = null;
    updatePreviewState.status = 'error';
    updatePreviewState.errorReason = '快速补丁状态读取失败';
    updatePreviewState.errorDetail = (e && e.message) || updatePreviewState.errorReason;
    updatePreviewState.message = updatePreviewState.errorReason;
    updateUpdatePreviewProgress(updatePreviewState.progress || 0);
    showToast('快速补丁状态读取失败');
  }
}

function applyUpdateDownloadJob(job) {
  if (!job || job.ok === false || job.status === 'error') {
    if (updatePreviewState.pollTimer) clearInterval(updatePreviewState.pollTimer);
    updatePreviewState.pollTimer = null;
    updatePreviewState.mode = (job && job.mode) || updatePreviewState.mode || 'installer';
    updatePreviewState.received = Number(job && job.received || 0);
    updatePreviewState.total = Number(job && job.total || 0);
    updatePreviewState.speedBps = Number(job && job.speedBps || 0);
    updatePreviewState.etaSeconds = Number(job && job.etaSeconds || 0);
    updatePreviewState.sourceLabel = (job && job.sourceLabel) || updatePreviewState.sourceLabel || '';
    updatePreviewState.attempt = Number(job && job.attempt || 0);
    updatePreviewState.attempts = Number(job && job.attempts || 0);
    updatePreviewState.errorReason = (job && (job.errorReason || job.message || job.error)) || '请稍后重试';
    updatePreviewState.errorDetail = (job && job.errorDetail) || '';
    updatePreviewState.failedAttempts = Array.isArray(job && job.failedAttempts) ? job.failedAttempts : [];
    updatePreviewState.message = (job && job.message) || updatePreviewState.errorReason;
    updatePreviewState.status = 'error';
    updateUpdatePreviewProgress(job && job.progress || updatePreviewState.progress || 0);
    if (updatePreviewState.mode === 'patch' && updatePreviewState.downloadUrl && !updatePreviewState.patchFallbackTried) {
      updatePreviewState.patchFallbackTried = true;
      showToast('快速补丁失败，可手动下载完整安装包：' + updatePreviewState.errorReason);
      return;
    }
    showToast('更新下载失败：' + updatePreviewState.errorReason);
    return;
  }
  if (job.id) updatePreviewState.downloadJobId = job.id;
  updatePreviewState.mode = job.mode || updatePreviewState.mode || 'installer';
  if (updatePreviewState.mode === 'patch') updatePreviewState.patchJobId = job.id || updatePreviewState.patchJobId;
  updatePreviewState.received = Number(job.received || 0);
  updatePreviewState.total = Number(job.total || 0);
  updatePreviewState.speedBps = Number(job.speedBps || 0);
  updatePreviewState.etaSeconds = Number(job.etaSeconds || 0);
  updatePreviewState.sourceLabel = job.sourceLabel || '';
  updatePreviewState.attempt = Number(job.attempt || 0);
  updatePreviewState.attempts = Number(job.attempts || 0);
  updatePreviewState.errorReason = job.errorReason || '';
  updatePreviewState.errorDetail = job.errorDetail || '';
  updatePreviewState.failedAttempts = Array.isArray(job.failedAttempts) ? job.failedAttempts : [];
  updatePreviewState.message = job.message || '';
  updatePreviewState.restartRequired = !!job.restartRequired;
  updatePreviewState.cached = !!job.cached;
  if (job.status === 'downloading' || job.status === 'queued') {
    updatePreviewState.status = 'downloading';
    updateUpdatePreviewProgress(job.progress || 0);
    return;
  }
  if (job.status === 'ready') {
    if (updatePreviewState.pollTimer) clearInterval(updatePreviewState.pollTimer);
    updatePreviewState.pollTimer = null;
    updatePreviewState.status = 'ready';
    updatePreviewState.installerPath = job.filePath || '';
    updateUpdatePreviewProgress(100);
    pulseUpdateReady();
    if (updatePreviewState.mode === 'patch') {
      showToast(updatePreviewState.restartRequired ? '快速补丁已应用，重启后生效' : '快速补丁已应用');
    } else if (updatePreviewState.installerPath) {
      showToast(updatePreviewState.cached ? '已复用上次下载的安装包' : '安装包已下载，点击按钮打开');
    }
  }
}
async function restartForAppliedPatch() {
  if (!updatePreviewState.restartRequired) return;
  try {
    if (window.desktopWindow && typeof window.desktopWindow.restartApp === 'function') {
      await window.desktopWindow.restartApp();
      return;
    }
  } catch (e) {}
  showToast('请手动重启 BhandsMusic 让补丁生效');
}

async function openDownloadedUpdateInstaller(filePath) {
  if (!filePath) return;
  if (updatePreviewState.installerOpened) return;
  updatePreviewState.status = 'opening';
  syncUpdatePreviewStateClass();
  try {
    if (window.desktopWindow && window.desktopWindow.openUpdateInstaller) {
      var result = await window.desktopWindow.openUpdateInstaller(filePath);
      if (!result || result.ok === false) throw new Error((result && result.error) || 'OPEN_UPDATE_FAILED');
      updatePreviewState.installerOpened = true;
      updatePreviewState.status = 'ready';
      syncUpdatePreviewStateClass();
      showToast('安装包已打开');
      return;
    }
    throw new Error('DESKTOP_BRIDGE_MISSING');
  } catch (e) {
    updatePreviewState.status = 'ready';
    syncUpdatePreviewStateClass();
    if (updatePreviewState.releaseUrl) window.open(updatePreviewState.releaseUrl, '_blank');
    showToast('无法自动打开安装包，已尝试打开更新页面');
  }
}

function startUpdatePreviewDownload() {
  var releaseLink = updatePreviewState.downloadUrl || updatePreviewState.releaseUrl;
  if (updatePreviewState.status === 'ready' && updatePreviewState.mode === 'patch') {
    restartForAppliedPatch();
    return;
  }
  if (updatePreviewState.configured && updatePreviewState.updateAvailable) {
    if (updatePreviewState.patchAvailable && updatePreviewState.patchUrl && !updatePreviewState.patchFallbackTried) {
      startRealUpdatePatch();
    } else if (updatePreviewState.downloadUrl) {
      startRealUpdateDownload();
    } else if (releaseLink) {
      window.open(releaseLink, '_blank');
      showToast('已打开更新页面');
    } else {
      showToast('这个版本还没有可用下载链接');
    }
    return;
  }
  if (updatePreviewState.status === 'ready') {
    if (window.gsap) {
      var modal = document.querySelector('#update-modal .update-modal');
      if (modal) window.gsap.fromTo(modal, { boxShadow: '0 30px 100px rgba(0,0,0,.62),0 0 0 1px rgba(244,210,138,.16)' }, { boxShadow: '0 30px 100px rgba(0,0,0,.62),0 0 34px rgba(244,210,138,.18)', duration: 0.52, yoyo: true, repeat: 1, ease: 'sine.inOut' });
    }
    showToast('正式接入后将重启并安装新版');
    return;
  }
  if (updatePreviewState.status === 'downloading') return;
  if (updatePreviewState.timer) clearInterval(updatePreviewState.timer);
  updatePreviewState.status = 'downloading';
  updateUpdatePreviewProgress(0);
  var btn = document.getElementById('update-primary-btn');
  if (btn && window.gsap) window.gsap.fromTo(btn, { scale: 0.985 }, { scale: 1, duration: 0.34, ease: 'back.out(1.45)', overwrite: true });
  updatePreviewState.timer = setInterval(function(){
    var next = updatePreviewState.progress + 3.2 + Math.random() * 7.5;
    if (next >= 100) {
      clearInterval(updatePreviewState.timer);
      updatePreviewState.timer = null;
      updatePreviewState.status = 'ready';
      updateUpdatePreviewProgress(100);
      pulseUpdateReady();
    } else {
      updateUpdatePreviewProgress(next);
    }
  }, 260);
}

function pulseUpdateReady() {
  var entry = document.getElementById('update-entry');
  var btn = document.getElementById('update-primary-btn');
  if (!window.gsap) return;
  if (entry) {
    window.gsap.fromTo(entry,
      { scale: 0.96, filter: 'drop-shadow(0 0 0 rgba(244,210,138,0))' },
      { scale: 1.04, filter: 'drop-shadow(0 0 14px rgba(244,210,138,.28))', duration: 0.34, yoyo: true, repeat: 1, ease: 'sine.inOut', overwrite: 'auto' }
    );
  }
  if (btn) {
    window.gsap.fromTo(btn,
      { boxShadow: '0 0 0 rgba(244,210,138,0), inset 0 1px 0 rgba(255,255,255,.09)' },
      { boxShadow: '0 0 24px rgba(244,210,138,.16), inset 0 1px 0 rgba(255,255,255,.11)', duration: 0.42, yoyo: true, repeat: 1, ease: 'sine.inOut', overwrite: true }
    );
  }
}

// ============================================================
//  登录系统
// ============================================================
function openGsapModal(mask) {
  if (!mask) return;
  var panel = mask.querySelector('.modal');
  mask.classList.add('show');
  if (window.gsap) {
    window.gsap.killTweensOf(mask);
    if (panel) window.gsap.killTweensOf(panel);
    window.gsap.set(mask, { display: 'flex', visibility: 'visible' });
    window.gsap.fromTo(mask,
      { autoAlpha: 0 },
      { autoAlpha: 1, duration: 0.38, ease: 'power2.out', overwrite: true }
    );
    if (panel) {
      window.gsap.fromTo(panel,
        { autoAlpha: 0, y: 26, scale: 0.965, filter: 'blur(12px)' },
        { autoAlpha: 1, y: 0, scale: 1, filter: 'blur(0px)', duration: 0.68, ease: 'expo.out', overwrite: true }
      );
    }
  } else {
    mask.style.display = 'flex';
    mask.style.visibility = 'visible';
    mask.style.opacity = '1';
  }
}
function closeGsapModal(mask, afterClose) {
  if (!mask || !mask.classList.contains('show')) {
    if (afterClose) afterClose();
    return;
  }
  var panel = mask.querySelector('.modal');
  function finish() {
    mask.classList.remove('show');
    if (window.gsap) {
      window.gsap.set(mask, { clearProps: 'display,visibility,opacity' });
      if (panel) window.gsap.set(panel, { clearProps: 'opacity,visibility,transform,filter' });
    } else {
      mask.style.display = '';
      mask.style.visibility = '';
      mask.style.opacity = '';
    }
    if (afterClose) afterClose();
  }
  if (window.gsap) {
    window.gsap.killTweensOf(mask);
    if (panel) {
      window.gsap.killTweensOf(panel);
      window.gsap.to(panel, { autoAlpha: 0, y: 18, scale: 0.976, filter: 'blur(8px)', duration: 0.28, ease: 'power2.in', overwrite: true });
    }
    window.gsap.to(mask, { autoAlpha: 0, duration: 0.34, ease: 'power2.inOut', overwrite: true, onComplete: finish });
  } else {
    finish();
  }
}
function onUserBtnClick() {
  if (hasAnyPlatformLogin()) showUserModal();
  else showLoginModal();
}
function platformMeta(provider) {
  if (provider === 'qq') return { key: 'qq', short: 'QQ', label: 'QQ 音乐', app: 'QQ 音乐 App', dot: 'qq' };
  return { key: 'netease', short: 'NE', label: '网易云音乐', app: '网易云音乐 App', dot: 'netease' };
}
function hasProviderSvip(provider, status) {
  return provider === 'netease' && providerVipLevel(provider, status) === 'svip';
}
function providerVipBadge(provider, status, idAttr) {
  if (!hasProviderVip(provider, status)) return '';
  var id = idAttr ? ' id="' + idAttr + '"' : '';
  var cls = 'top-account-vip' + (provider === 'qq' ? ' qq' : '');
  var level = providerVipLevel(provider, status);
  var label = provider === 'qq' ? 'QQ VIP' : (level === 'svip' ? 'SVIP' : 'VIP');
  return '<span' + id + ' class="' + cls + '">' + label + '</span>';
}
function hasPlatformLogin(provider) {
  var st = platformStatus(provider);
  return !!(st && st.loggedIn);
}
function hasAnyPlatformLogin() {
  return hasPlatformLogin('netease') || hasPlatformLogin('qq');
}
function firstLoggedProvider() {
  if (hasPlatformLogin(activeAccountProvider)) return activeAccountProvider;
  if (hasPlatformLogin('netease')) return 'netease';
  if (hasPlatformLogin('qq')) return 'qq';
  return 'netease';
}
function providerAvatarSrc(provider, status) {
  status = status || platformStatus(provider) || {};
  if (status.avatar) return avatarSrc(status.avatar);
  var meta = platformMeta(provider);
  var fill = provider === 'qq' ? '#bfd66b' : '#d95b67';
  var bg = provider === 'qq' ? '#11150b' : '#180b0f';
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="48" fill="' + bg + '"/><circle cx="48" cy="48" r="34" fill="' + fill + '" opacity=".16"/><text x="48" y="56" text-anchor="middle" font-family="Arial, sans-serif" font-size="26" font-weight="700" fill="' + fill + '">' + meta.short + '</text></svg>';
  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
}
function renderTopAccountPill(provider) {
  var st = platformStatus(provider);
  if (!st || !st.loggedIn) return '';
  var meta = platformMeta(provider);
  var displayName = (provider === 'qq' && st.preview) ? '待接入' : (st.nickname || meta.label);
  var vipTag = providerVipBadge(provider, st);
  return '<span class="top-account-pill">' +
    '<img src="' + providerAvatarSrc(provider, st) + '" alt="">' +
    '<span class="top-account-name">' + escHtml(displayName) + '</span>' +
    vipTag +
  '</span>';
}
async function refreshLoginStatus(force) {
  try {
    var info = await apiJson('/api/login/status?t=' + Date.now());
    loginStatusChecked = true;
    loginStatusCheckFailed = false;
    loginStatus = info || { loggedIn: false };
    if (typeof syncSourceParseOrderVisibility === 'function') syncSourceParseOrderVisibility();
    if (loginStatus.loggedIn && !hasPlatformLogin(activeAccountProvider)) activeAccountProvider = 'netease';
    renderUserBtn();
    if (info && info.loggedIn) {
      homeDiscoverState.loaded = false;
      homeDiscoverState.loggedIn = true;
      refreshUserPlaylists(true);
      loadHomeDiscover(true);
      syncLikeStatusForSongs(playQueue.concat(playlist || []));
    } else {
      userPlaylists = qqPlaylists.slice();
      myPodcastCollections = [];
      myPodcastItems = {};
      likedSongMap = {};
      updateLikeButtons();
    }
    return info;
  } catch (e) {
    console.warn(e);
    loginStatusChecked = true;
    loginStatusCheckFailed = true;
    renderUserBtn();
    return null;
  }
}
function normalizeQQLoginStatus(info) {
  var fallback = { provider: 'qq', loggedIn: false, preview: false, nickname: 'QQ 音乐', userId: '', avatar: '', vipType: 0, stale: false, playbackKeyReady: false };
  if (!info || !info.loggedIn) return Object.assign({}, fallback, info || {}, {
    provider: 'qq',
    loggedIn: false,
    nickname: info && info.nickname || fallback.nickname,
    userId: info && (info.userId || info.uin) || '',
    avatar: info && info.avatar || '',
    vipType: Number(info && (info.vipType || info.vip_type) || 0) || 0,
    stale: !!(info && info.stale)
  });
  return Object.assign({}, fallback, info, {
    provider: 'qq',
    loggedIn: true,
    nickname: info.nickname || fallback.nickname,
    userId: info.userId || info.uin || '',
    avatar: info.avatar || '',
    vipType: Number(info.vipType || info.vip_type || 0) || 0,
    playbackKeyReady: !!info.playbackKeyReady,
    stale: !!info.stale || !!(info.profileUnavailable && !(info.nickname && info.avatar))
  });
}
async function refreshQQLoginStatus() {
  try {
    var info = await apiJson('/api/qq/login/status?t=' + Date.now());
    var prevLogged = !!qqLoginStatus.loggedIn;
    qqLoginStatus = normalizeQQLoginStatus(info);
    if (!qqLoginStatus.loggedIn) {
      if (prevLogged || qqLoginWasLoggedIn) showToast(qqLoginStatus.stale ? 'QQ 音乐登录已失效' : 'QQ 音乐已掉登录');
      qqPlaylists = [];
      userPlaylists = userPlaylists.filter(function(pl){ return pl.provider !== 'qq'; });
      homeDiscoverState.loaded = false;
    } else if (!userPlaylists.some(function(pl){ return pl && pl.provider === 'qq'; })) {
      homeDiscoverState.loaded = false;
      homeDiscoverState.loading = false;
      homeDiscoverState.loggedIn = true;
      refreshUserPlaylists(true);
      loadHomeDiscover(true);
      // 强制重新加载 QQ 榜单（覆盖已有的网易云数据）
      preloadToplistTracks(true);
    } else if (qqLoginStatus.stale) {
      showToast('QQ 音乐登录状态可能已失效');
    }
    qqLoginWasLoggedIn = !!qqLoginStatus.loggedIn;
    if (!hasPlatformLogin(activeAccountProvider)) activeAccountProvider = firstLoggedProvider();
    renderUserBtn();
    return qqLoginStatus;
  } catch (e) {
    console.warn('QQ login status failed:', e);
    qqLoginStatus = normalizeQQLoginStatus(null);
    renderUserBtn();
    return qqLoginStatus;
  }
}
function startQQLoginStatusAutoRefresh() {
  if (qqLoginAutoRefreshTimer) clearInterval(qqLoginAutoRefreshTimer);
  qqLoginAutoRefreshTimer = setInterval(function(){
    refreshQQLoginStatus().catch(function(e){ console.warn('QQ login auto refresh failed:', e); });
  }, 45000);
}
function clearUserBtnInlineLayout() {
  // 清掉头像模式的 inline 布局（切回登录/双平台态时恢复 CSS 默认）
  var btn = document.getElementById('user-btn');
  if (!btn) return;
  ['width', 'height', 'min-width', 'padding', 'border-radius', 'position', 'overflow', 'gap', 'flex'].forEach(function (k) {
    btn.style.removeProperty(k);
  });
  var im = document.getElementById('user-avatar');
  if (im) {
    ['width', 'height', 'border-radius', 'display', 'flex'].forEach(function (k) { im.style.removeProperty(k); });
  }
}
function applyUserBtnAvatarLayout() {
  // 头像模式布局用 inline style 直接落定：
  // CSS 覆盖（含 !important 规则）在本项目样式表里被更早的 `#user-btn.logged-out` 规则
  // 意外压住（2026-09-22 实测：matches 为 false 却应用了该规则的值），inline 优先级最高、可靠。
  var btn = document.getElementById('user-btn');
  if (!btn) return;
  // inline !important 兜底：CSS 规则（#user-btn.logged-in:not(.multi-account)）已能实现同样效果，
  // 这里再落一层 inline 保证任何级联环境下都稳定生效（尺寸 44px 圆形、头像填满内容区 42px）
  btn.style.setProperty('width', '44px', 'important');
  btn.style.setProperty('height', '44px', 'important');
  btn.style.setProperty('min-width', '0', 'important');
  btn.style.setProperty('padding', '0', 'important');
  btn.style.setProperty('border-radius', '50%', 'important');
  btn.style.setProperty('position', 'relative', 'important');
  btn.style.setProperty('overflow', 'visible', 'important');
  btn.style.setProperty('gap', '0', 'important');
  btn.style.setProperty('flex', '0 0 auto', 'important');
  var img = document.getElementById('user-avatar');
  if (img) {
    // 头像 40px（按钮 44px 内容区 42px）：留 1px 空隙让外圈光环与头像分离可见
    img.style.setProperty('width', '40px', 'important');
    img.style.setProperty('height', '40px', 'important');
    img.style.setProperty('border-radius', '50%', 'important');
    img.style.setProperty('display', 'block', 'important');
    img.style.setProperty('flex', '0 0 auto', 'important');
  }
}
function renderUserBtn() {
  var btn = document.getElementById('user-btn');
  if (!btn) return;
  btn.classList.remove('multi-account');
  if (dualAccountMode && hasAnyPlatformLogin()) {
    clearUserBtnInlineLayout();
    activeAccountProvider = firstLoggedProvider();
    btn.classList.add('logged-in', 'multi-account');
    btn.classList.remove('logged-out');
    btn.title = '账号信息 · 双平台登录状态';
    btn.innerHTML = renderTopAccountPill('netease') + renderTopAccountPill('qq');
  } else if (hasAnyPlatformLogin()) {
    activeAccountProvider = firstLoggedProvider();
    var st = platformStatus(activeAccountProvider);
    var meta = platformMeta(activeAccountProvider);
    btn.classList.add('logged-in');
    btn.classList.remove('logged-out');
    btn.title = dualAccountMode ? '账号信息 · 已启用双平台展示' : ((st.nickname || meta.label) + ' · 账号信息');
    // 只显示头像（昵称见 title 悬停提示）；VIP/SVIP 徽章定位在头像正下方
    btn.innerHTML = '<img id="user-avatar" src="' + providerAvatarSrc(activeAccountProvider, st) + '">' +
                    providerVipBadge(activeAccountProvider, st, 'user-vip-tag');
    applyUserBtnAvatarLayout();
  } else {
    clearUserBtnInlineLayout();
    btn.classList.remove('logged-in');
    btn.classList.add('logged-out');
    btn.title = '登录账号';
    btn.innerHTML = '<span class="login-word">登录</span>';
  }
  updatePlaybackQualityUi();
}
async function showLoginModal(opts) {
  opts = opts || {};
  if (opts.provider) loginProvider = opts.provider === 'qq' ? 'qq' : 'netease';
  var modal = document.getElementById('login-modal');
  openGsapModal(modal);
  updateLoginProviderUi();
  await refreshQr();
}
function setLoginProvider(provider, silent) {
  loginProvider = provider === 'qq' ? 'qq' : 'netease';
  updateLoginProviderUi();
  if (!silent && document.getElementById('login-modal').classList.contains('show')) refreshQr();
}
function updateLoginProviderUi() {
  var meta = platformMeta(loginProvider);
  var isQQ = loginProvider === 'qq';
  var title = document.getElementById('login-modal-title');
  var desc = document.getElementById('login-modal-desc');
  var shell = document.getElementById('qr-shell');
  var st = document.getElementById('qr-status');
  var refreshBtn = document.getElementById('refresh-qr-btn');
  var qqPanel = document.getElementById('qq-cookie-panel');
  var qqCookieToggle = document.getElementById('qq-cookie-toggle-btn');
  var qqCard = document.getElementById('qq-web-login-card');
  var neteaseBtn = document.getElementById('login-provider-netease');
  var qqBtn = document.getElementById('login-provider-qq');
  if (neteaseBtn) neteaseBtn.classList.toggle('active', loginProvider === 'netease');
  if (qqBtn) qqBtn.classList.toggle('active', isQQ);
  if (title) title.textContent = '扫码登录' + meta.label;
  if (desc) desc.innerHTML = isQQ
    ? '打开 <b>QQ 音乐官方网页登录窗口</b> 扫码，成功后会自动同步账号会话。'
    : '使用 <b>网易云音乐 App</b> 扫码，可同步歌单、红心与播客。';
  if (shell) {
    shell.classList.toggle('web-login-preview', isQQ);
    shell.classList.toggle('qq-preview', isQQ);
    shell.classList.remove('netease-preview');
  }
  if (qqPanel) qqPanel.classList.toggle('show', isQQ && qqManualCookieOpen);
  if (qqCookieToggle) {
    qqCookieToggle.classList.toggle('show', isQQ);
    qqCookieToggle.textContent = qqManualCookieOpen ? '收起导入' : '手动导入';
  }
  if (qqCard) {
    qqCard.style.display = isQQ ? '' : 'none';
    if (isQQ) {
      qqCard.disabled = !!qqWebLoginBusy;
      var cardLabel = qqCard.querySelector('span');
      if (cardLabel) cardLabel.textContent = qqWebLoginBusy ? '等待扫码确认' : '打开官方扫码窗口';
    }
  }
  if (st) {
    st.className = isQQ ? 'preview' : '';
    st.textContent = isQQ
      ? (qqLoginStatus.loggedIn ? ('已保存 QQ 音乐会话 · ' + (qqLoginStatus.nickname || '')) : '点击”扫码登录”打开 QQ 音乐官方窗口')
      : '正在生成二维码…';
  }
  if (refreshBtn) {
    refreshBtn.disabled = isQQ ? !!qqWebLoginBusy : false;
    refreshBtn.textContent = isQQ ? (qqWebLoginBusy ? '等待扫码…' : '扫码登录') : '刷新二维码';
    refreshBtn.onclick = isQQ ? openQQWebLogin : refreshQr;
  }
}
async function refreshQr() {
  stopQrPoll();
  updateLoginProviderUi();
  if (loginProvider === 'qq') {
    qrKey = null;
    var qqStatus = document.getElementById('qr-status');
    var qqImg = document.getElementById('qr-img');
    if (qqImg) qqImg.src = '';
    var info = await refreshQQLoginStatus();
    if (qqStatus) {
      qqStatus.textContent = info && info.loggedIn ? ('已保存 QQ 音乐会话 · ' + (info.nickname || '')) : '点击“扫码登录”打开 QQ 音乐官方窗口';
      qqStatus.className = 'preview';
    }
    return;
  }
  try {
    var k = await apiJson('/api/login/qr/key');
    if (!k.key) throw new Error('获取 key 失败');
    qrKey = k.key;
    var q = await apiJson('/api/login/qr/create?key=' + encodeURIComponent(qrKey));
    if (!q.img) throw new Error('生成二维码失败');
    document.getElementById('qr-img').src = q.img;
    document.getElementById('qr-status').textContent = '请使用网易云音乐 App 扫码';
    startQrPoll();
  } catch (e) {
    document.getElementById('qr-status').textContent = '出错: ' + e.message;
    document.getElementById('qr-status').className = 'fail';
  }
}
function startQrPoll() { if (qrPollTimer) clearInterval(qrPollTimer); qrPollTimer = setInterval(checkQr, 2000); }
function stopQrPoll() { if (qrPollTimer) { clearInterval(qrPollTimer); qrPollTimer = null; } }
function toggleQQCookiePanel() {
  qqManualCookieOpen = !qqManualCookieOpen;
  updateLoginProviderUi();
}
function openProviderWebLogin() {
  if (loginProvider === 'qq') return openQQWebLogin();
  return openNeteaseWebLogin();
}
async function openNeteaseWebLogin() {
  if (neteaseWebLoginBusy) return;
  var statusEl = document.getElementById('qr-status');
  var api = window.desktopWindow;
  if (!api || !api.isDesktop || typeof api.openNeteaseMusicLogin !== 'function') {
    if (statusEl) { statusEl.textContent = '当前环境不支持官方网页登录，正在尝试旧二维码…'; statusEl.className = 'fail'; }
    return refreshQr();
  }

  neteaseWebLoginBusy = true;
  updateLoginProviderUi();
  if (statusEl) { statusEl.textContent = '已打开网易云窗口，请在官方页面扫码登录…'; statusEl.className = 'preview'; }
  try {
    var result = await api.openNeteaseMusicLogin();
    if (!result || !result.ok || !result.cookie) {
      throw new Error((result && (result.message || result.error)) || '网易云登录未完成');
    }
    if (statusEl) { statusEl.textContent = '正在同步网易云会话…'; statusEl.className = 'preview'; }
    var info = await apiJson('/api/login/cookie', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookie: result.cookie })
    });
    if (!info || !info.loggedIn) throw new Error((info && (info.message || info.error)) || '网易云会话不可用');
    loginStatus = info;
    activeAccountProvider = 'netease';
    renderUserBtn();
    refreshUserPlaylists(true);
    loadHomeDiscover(true);
    if (statusEl) { statusEl.textContent = '网易云会话已保存'; statusEl.className = 'scan'; }
    setTimeout(function(){
      closeLoginModal();
      showToast('网易云已登录: ' + (info.nickname || info.userId || ''));
    }, 420);
  } catch (e) {
    neteaseWebLoginBusy = false;
    updateLoginProviderUi();
    if (statusEl) { statusEl.textContent = e && e.message ? e.message : '网易云登录失败'; statusEl.className = 'fail'; }
  } finally {
    if (neteaseWebLoginBusy) {
      neteaseWebLoginBusy = false;
      updateLoginProviderUi();
    }
  }
}
async function openQQWebLogin() {
  if (qqWebLoginBusy) return;
  var statusEl = document.getElementById('qr-status');
  var api = window.desktopWindow;
  if (!api || !api.isDesktop || typeof api.openQQMusicLogin !== 'function') {
    qqManualCookieOpen = true;
    updateLoginProviderUi();
    if (statusEl) { statusEl.textContent = '当前环境不支持自动网页登录，可先使用手动导入。'; statusEl.className = 'fail'; }
    return;
  }

  qqWebLoginBusy = true;
  updateLoginProviderUi();
  if (statusEl) { statusEl.textContent = '已打开 QQ 音乐窗口，请扫码并确认登录…'; statusEl.className = 'preview'; }
  try {
    var result = await api.openQQMusicLogin();
    if (!result || !result.ok || !result.cookie) {
      throw new Error((result && (result.message || result.error)) || 'QQ 登录未完成');
    }
    if (statusEl) { statusEl.textContent = '正在同步 QQ 音乐会话…'; statusEl.className = 'preview'; }
    var info = await apiJson('/api/qq/login/cookie', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookie: result.cookie })
    });
    if (!info || !info.loggedIn) throw new Error((info && (info.message || info.error)) || 'QQ 会话不可用');
    qqLoginStatus = info;
    activeAccountProvider = 'qq';
    qqManualCookieOpen = false;
    renderUserBtn();
    refreshUserPlaylists(true);
    homeDiscoverState.loaded = false;
    homeDiscoverState.loggedIn = true;
    loadHomeDiscover(true);
    preloadToplistTracks(true);
    var qqPlaybackReady = !!info.playbackKeyReady && !result.partial;
    if (statusEl) { statusEl.textContent = qqPlaybackReady ? 'QQ 音乐会话已保存' : 'QQ 账号已同步，播放授权不完整，部分歌曲会自动换源'; statusEl.className = 'scan'; }
    setTimeout(function(){
      closeLoginModal();
      showToast((qqPlaybackReady ? 'QQ 音乐已登录: ' : 'QQ 账号已同步: ') + (info.nickname || info.userId || ''));
    }, 420);
  } catch (e) {
    qqWebLoginBusy = false;
    updateLoginProviderUi();
    if (statusEl) { statusEl.textContent = e && e.message ? e.message : 'QQ 登录失败'; statusEl.className = 'fail'; }
  } finally {
    if (qqWebLoginBusy) {
      qqWebLoginBusy = false;
      updateLoginProviderUi();
    }
  }
}
async function submitQQCookieLogin() {
  if (qqCookieBusy) return;
  var input = document.getElementById('qq-cookie-input');
  var statusEl = document.getElementById('qr-status');
  var saveBtn = document.getElementById('qq-cookie-save-btn');
  var cookie = input ? input.value.trim() : '';
  if (!cookie) {
    if (statusEl) { statusEl.textContent = '先粘贴 QQ 音乐 cookie'; statusEl.className = 'fail'; }
    return;
  }
  qqCookieBusy = true;
  if (saveBtn) saveBtn.classList.add('busy');
  if (statusEl) { statusEl.textContent = '正在保存 QQ 会话…'; statusEl.className = 'preview'; }
  try {
    var info = await apiJson('/api/qq/login/cookie', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookie: cookie })
    });
    if (!info || !info.loggedIn) throw new Error((info && (info.message || info.error)) || 'QQ 会话不可用');
    qqLoginStatus = info;
    activeAccountProvider = 'qq';
    if (input) input.value = '';
    renderUserBtn();
    refreshUserPlaylists(true);
    homeDiscoverState.loaded = false;
    homeDiscoverState.loggedIn = true;
    loadHomeDiscover(true);
    preloadToplistTracks(true);
    var manualQQPlaybackReady = !!info.playbackKeyReady;
    if (statusEl) { statusEl.textContent = manualQQPlaybackReady ? 'QQ 音乐会话已保存' : 'QQ 账号已同步，播放授权不完整，部分歌曲会自动换源'; statusEl.className = 'scan'; }
    setTimeout(function(){
      closeLoginModal();
      showToast((manualQQPlaybackReady ? 'QQ 音乐已登录: ' : 'QQ 账号已同步: ') + (info.nickname || info.userId || ''));
    }, 420);
  } catch (e) {
    if (statusEl) { statusEl.textContent = e && e.message ? e.message : 'QQ 会话保存失败'; statusEl.className = 'fail'; }
  } finally {
    qqCookieBusy = false;
    if (saveBtn) saveBtn.classList.remove('busy');
  }
}
async function checkQr() {
  if (!qrKey) return;
  try {
    var r = await apiJson('/api/login/qr/check?key=' + encodeURIComponent(qrKey));
    var $st = document.getElementById('qr-status');
    if (r.code === 800) { $st.textContent = '二维码已过期, 请刷新'; $st.className = 'fail'; stopQrPoll(); }
    else if (r.code === 801) { $st.textContent = '请在 App 中扫码'; $st.className = ''; }
    else if (r.code === 802) { $st.textContent = '已扫码, 请在手机确认…'; $st.className = 'scan'; }
    else if (r.code === 803 && (r.loggedIn || r.hasCookie)) {
      $st.textContent = r.pendingProfile ? '登录成功，正在同步账号资料…' : '登录成功！'; $st.className = 'scan';
      stopQrPoll();
      loginStatus = r.loggedIn ? r : Object.assign({}, r, { loggedIn: true, pendingProfile: true, nickname: r.nickname || '网易云用户' });
      activeAccountProvider = 'netease';
      renderUserBtn();
      setTimeout(async function(){
        var fresh = await refreshLoginStatus(true);
        if (!fresh || !fresh.loggedIn) {
          loginStatus = Object.assign({}, loginStatus, { loggedIn: true, pendingProfile: true });
          renderUserBtn();
          fresh = loginStatus;
        }
        closeLoginModal();
        showToast('欢迎 ' + (fresh && fresh.nickname ? fresh.nickname : ''));
      }, r.pendingProfile ? 1200 : 500);
    } else if (r.code === 803) {
      $st.textContent = '扫码已确认，但没有拿到登录凭证，请刷新二维码重试'; $st.className = 'fail';
      stopQrPoll();
    }
  } catch (e) { console.warn(e); }
}
function updateUserModalUi() {
  activeAccountProvider = firstLoggedProvider();
  var st = platformStatus(activeAccountProvider);
  var meta = platformMeta(activeAccountProvider);
  var chip = document.getElementById('account-provider-chip');
  var avatar = document.getElementById('user-modal-avatar');
  var name = document.getElementById('user-modal-name');
  var vipEl = document.getElementById('user-modal-vip');
  var hint = document.getElementById('account-hint');
  var logoutBtn = document.getElementById('account-logout-btn');
  var addNetease = document.getElementById('account-add-netease');
  var addQQ = document.getElementById('account-add-qq');
  if (chip) {
    chip.className = 'account-provider-chip ' + activeAccountProvider;
    chip.innerHTML = '<span class="account-source-dot ' + meta.dot + '"></span><span>' + meta.label + '</span>';
  }
  if (avatar) avatar.src = providerAvatarSrc(activeAccountProvider, st);
  if (name) name.textContent = (st && st.nickname) || meta.label;
  if (vipEl) {
    if (activeAccountProvider === 'netease') {
      var neVipLevel = providerVipLevel('netease', st);
      var vipLabel = neVipLevel === 'svip' ? '网易云 SVIP' : (neVipLevel === 'vip' ? '网易云 VIP' : '普通用户');
      vipEl.textContent = 'UID: ' + ((st && st.userId) || '-') + '  ·  ' + vipLabel;
      vipEl.style.color = hasProviderVip('netease', st) ? 'rgba(244,210,138,0.86)' : 'rgba(255,255,255,0.5)';
    } else {
      var qqVipLabel = hasProviderVip('qq', st) ? 'QQ VIP 会员' : 'QQ 音乐会话';
      vipEl.textContent = 'UID: ' + ((st && st.userId) || '-') + '  ·  ' + qqVipLabel;
      vipEl.style.color = hasProviderVip('qq', st) ? 'rgba(0,245,212,0.82)' : 'rgba(0,245,212,0.58)';
    }
  }
  ['netease','qq','both'].forEach(function(key){
    var btn = document.getElementById('user-provider-' + key);
    if (btn) btn.classList.toggle('active', key === 'both' ? dualAccountMode : (!dualAccountMode && activeAccountProvider === key));
  });
  if (addNetease) addNetease.style.display = hasPlatformLogin('netease') ? 'none' : '';
  if (addQQ) addQQ.textContent = hasPlatformLogin('qq') ? '查看 QQ 音乐' : '补登 QQ 音乐';
  if (logoutBtn) logoutBtn.textContent = activeAccountProvider === 'qq' ? '退出 QQ 音乐' : '退出网易云';
  if (hint) hint.textContent = dualAccountMode
    ? '右上角已切换为双平台并排展示。'
    : '可切换右上角展示的平台；“我两个都要”会并排放两个登录状态。';
}
function showUserModal() {
  if (!hasAnyPlatformLogin()) return showLoginModal();
  updateUserModalUi();
  openGsapModal(document.getElementById('user-modal'));
}
function setActiveAccountProvider(provider) {
  provider = provider === 'qq' ? 'qq' : 'netease';
  if (!hasPlatformLogin(provider)) {
    openProviderLogin(provider);
    return;
  }
  activeAccountProvider = provider;
  dualAccountMode = false;
  renderUserBtn();
  updateUserModalUi();
}
function enableDualAccountView() {
  if (!hasPlatformLogin('netease') && !hasPlatformLogin('qq')) {
    openProviderLogin('netease');
    return;
  }
  if (!hasPlatformLogin('netease')) {
    openProviderLogin('netease');
    return;
  }
  if (!hasPlatformLogin('qq')) {
    openProviderLogin('qq');
    return;
  }
  dualAccountMode = true;
  renderUserBtn();
  updateUserModalUi();
  showToast('已启用双平台账号展示');
}
function requestDualLoginMode() {
  enableDualAccountView();
}
function openProviderLogin(provider) {
  provider = provider === 'qq' ? 'qq' : 'netease';
  closeUserModal();
  loginProvider = provider;
  showLoginModal({ provider: provider });
}
async function logoutActiveAccount() {
  if (activeAccountProvider === 'qq') {
    try { await apiJson('/api/qq/logout'); } catch (e) {}
    try {
      if (window.desktopWindow && typeof window.desktopWindow.clearQQMusicLogin === 'function') {
        await window.desktopWindow.clearQQMusicLogin();
      }
    } catch (e) {}
    qqLoginStatus = { provider: 'qq', loggedIn: false, preview: false, nickname: 'QQ 音乐', userId: '', avatar: '', vipType: 0 };
    qqPlaylists = [];
    userPlaylists = userPlaylists.filter(function(pl){ return pl.provider !== 'qq'; });
    dualAccountMode = false;
    homeDiscoverState.loaded = false;
    homeDiscoverState.loggedIn = false;
    homeDiscoverState.songs = [];
    homeDiscoverState.playlists = [];
    homeDiscoverState.podcasts = [];
    listenStatsState.history = [];
    listenStatsState.topArtist = null;
    listenStatsState.topSong = null;
    myPodcastCollections = [];
    myPodcastItems = {};
    likedSongMap = {};
    toplistTracks = []; toplistCover = '';
    newSongTracks = []; newSongCover = '';
    originalTracks = []; originalCover = '';
    hotSongTracks = []; hotSongCover = '';
    rapTracks = []; rapCover = '';
    qqDailyFirstSong = null;
    playQueue = []; currentIdx = -1; shelfForceQueue = false;
    try { if (audio && !audio.paused) audio.pause(); audio.src = ''; } catch (e) {}
    setHomeArt('hero-daily-art', 'assets/IdleIcon.png', 800);
    renderHomeDiscover();
    renderHomeTiles();
    safeShelfRebuild('logout');
    safeRenderQueuePanel('logout', { deferWhenHidden: false });
    activeAccountProvider = firstLoggedProvider();
    renderUserBtn();
    if (hasAnyPlatformLogin()) updateUserModalUi();
    else closeUserModal();
    try { localStorage.removeItem(HOME_LISTEN_STATS_KEY); } catch (e) {}
    try { localStorage.removeItem(SEARCH_HISTORY_STORE_KEY); } catch (e) {}
    playlistCoverCache = {};
    showToast('已退出 QQ 音乐');
    return;
  }
  doLogout();
}
async function doLogout() {
  await apiJson('/api/logout');
  try {
    if (window.desktopWindow && typeof window.desktopWindow.clearNeteaseMusicLogin === 'function') {
      await window.desktopWindow.clearNeteaseMusicLogin();
    }
  } catch (e) {}
  loginStatus = { loggedIn: false };
  if (!hasPlatformLogin('netease') || !hasPlatformLogin('qq')) dualAccountMode = false;
  activeAccountProvider = firstLoggedProvider();
  userPlaylists = qqPlaylists.slice();
  myPodcastCollections = [];
  myPodcastItems = {};
  likedSongMap = {};
  homeDiscoverState.loaded = false;
  homeDiscoverState.loggedIn = false;
  homeDiscoverState.songs = [];
  homeDiscoverState.playlists = [];
  homeDiscoverState.podcasts = [];
  listenStatsState.history = [];
  listenStatsState.topArtist = null;
  listenStatsState.topSong = null;
  toplistTracks = []; toplistCover = '';
  newSongTracks = []; newSongCover = '';
  originalTracks = []; originalCover = '';
  hotSongTracks = []; hotSongCover = '';
  rapTracks = []; rapCover = '';
  qqDailyFirstSong = null;
  playQueue = []; currentIdx = -1; shelfForceQueue = false;
  try { if (audio && !audio.paused) audio.pause(); audio.src = ''; } catch (e) {}
  setHomeArt('hero-daily-art', 'assets/IdleIcon.png', 800);
  renderHomeDiscover();
  renderHomeTiles();
  closeCollectModal();
  safeRenderQueuePanel('logout', { scrollCurrent: miniQueueOpen, deferWhenHidden: false });
  renderUserBtn();
  safeShelfRebuild('logout');
  closeUserModal();
  try { localStorage.removeItem(HOME_LISTEN_STATS_KEY); } catch (e) {}
  try { localStorage.removeItem(SEARCH_HISTORY_STORE_KEY); } catch (e) {}
  playlistCoverCache = {};
  showToast('已退出登录');
}
var startupLoginGuideShown = false;
var loginGuideAnimating = false;
var loginGuideRaf = null;
function runLoginGuideParticles(done) {
  var canvas = document.getElementById('login-guide-canvas');
  if (!canvas || reduceSplashMotion) {
    if (done) setTimeout(done, 120);
    return;
  }
  if (loginGuideAnimating) {
    if (done) setTimeout(done, 720);
    return;
  }
  loginGuideAnimating = true;
  document.body.classList.add('login-guide-active');
  var ctx = canvas.getContext('2d');
  var dpr = Math.min(window.devicePixelRatio || 1, 1.8);
  var w = window.innerWidth, h = window.innerHeight;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  var cx = w * 0.5;
  var cy = h * 0.5 - 10;
  var maxR = Math.max(w, h);
  var particles = [];
  for (var i = 0; i < 92; i++) {
    var ang = Math.random() * Math.PI * 2;
    var ring = maxR * (0.30 + Math.random() * 0.35);
    var arcBias = Math.random() < 0.42 ? Math.PI * 0.5 : 0;
    particles.push({
      sx: cx + Math.cos(ang + arcBias) * ring + (Math.random() - 0.5) * 80,
      sy: cy + Math.sin(ang) * ring * 0.72 + (Math.random() - 0.5) * 80,
      tx: cx + (Math.random() - 0.5) * 172,
      ty: cy + (Math.random() - 0.5) * 172,
      r: 0.8 + Math.random() * 1.9,
      delay: Math.random() * 0.22,
      hue: Math.random(),
      spin: Math.random() * Math.PI * 2
    });
  }
  var started = performance.now();
  var duration = 1050;
  if (loginGuideRaf) cancelAnimationFrame(loginGuideRaf);
  function draw(now) {
    var raw = Math.min(1, (now - started) / duration);
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    var centerPulse = Math.sin(Math.PI * raw);
    var halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(w, h) * 0.28);
    halo.addColorStop(0, 'rgba(255,255,255,' + (0.060 * centerPulse) + ')');
    halo.addColorStop(0.55, 'rgba(255,255,255,' + (0.026 * centerPulse) + ')');
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, w, h);

    for (var j = 0; j < particles.length; j++) {
      var p = particles[j];
      var lt = Math.max(0, Math.min(1, (raw - p.delay) / (1 - p.delay)));
      var e = 1 - Math.pow(1 - lt, 3);
      var wobble = Math.sin(lt * Math.PI * 2 + p.spin) * (1 - lt) * 18;
      var x = p.sx + (p.tx - p.sx) * e + Math.cos(p.spin) * wobble;
      var y = p.sy + (p.ty - p.sy) * e + Math.sin(p.spin) * wobble * 0.6;
      var alpha = Math.sin(Math.PI * lt) * (0.18 + p.hue * 0.18);
      if (alpha <= 0) continue;
      var warm = false;
      ctx.beginPath();
      ctx.arc(x, y, p.r * (0.75 + lt * 0.45), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,' + alpha + ')';
      ctx.fill();
      if (lt > 0.08 && lt < 0.92) {
        var tx = p.sx + (p.tx - p.sx) * Math.max(0, e - 0.045);
        var ty = p.sy + (p.ty - p.sy) * Math.max(0, e - 0.045);
        ctx.strokeStyle = 'rgba(255,255,255,' + (alpha * 0.20) + ')';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
    }
    if (raw < 1) {
      loginGuideRaf = requestAnimationFrame(draw);
    } else {
      function finish() {
        ctx.clearRect(0, 0, w, h);
        document.body.classList.remove('login-guide-active');
        loginGuideAnimating = false;
        loginGuideRaf = null;
        if (done) done();
      }
      if (window.gsap) {
        window.gsap.to(canvas, { opacity: 0, duration: 0.28, ease: 'power2.out', onComplete: function(){
          finish();
          window.gsap.set(canvas, { clearProps: 'opacity' });
        }});
      } else {
        finish();
      }
    }
  }
  loginGuideRaf = requestAnimationFrame(draw);
}
function maybeRunStartupLoginGuide(source) {
  if (startupLoginGuideShown || loginGuideAnimating) return;
  if (visualGuideActive) return;
  if (document.body.classList.contains('splash-active')) return;
  if (immersiveMode) return;
  if (!loginStatusChecked || loginStatusCheckFailed || loginStatus.loggedIn || playing) return;
  var loginModal = document.getElementById('login-modal');
  var userModal = document.getElementById('user-modal');
  if ((loginModal && loginModal.classList.contains('show')) || (userModal && userModal.classList.contains('show'))) return;
  startupLoginGuideShown = true;
  setTimeout(function(){
    if (loginStatus.loggedIn || playing || immersiveMode || document.body.classList.contains('splash-active')) return;
    runLoginGuideParticles(function(){ showLoginModal({ guided: true, source: source || 'startup' }); });
  }, source === 'splash' ? 6200 : 2600);
}
