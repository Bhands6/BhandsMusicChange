'use strict';

// ============================================================
//  10-audio-queue.js  —  音频上下文 / 频谱分析 / 播放队列
//  由 public/js/app/*.js 于 2026-09-24「按职责重排」生成（零逻辑改动）。
//  ⚠️ 下方 `// <旧文件名> ← 源 main.js §NN` 横幅是**第一步拆分**留下的「来源」标注，
//     重排会把条目搬到职责文件里 —— 横幅里的文件名与本文件不一致是正常的。
//     找函数请按**函数名 grep**，别按文件名推断。
//  规则与验证见 docs/APP_REORG_PLAN.md 与 scripts/check-app-reorg.js。
// ============================================================



// ============================================================
//  09-audio-queue.js  ←  源 main.js §24–§25（基线 784afe6）
//  音频上下文与频谱分析 / 播放队列
// ============================================================

// ============================================================
//  音频上下文 & 频谱分析
// ============================================================
function initAudio() {
  if (audioReady) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  source = audioCtx.createMediaElementSource(audio);
  analyser = audioCtx.createAnalyser();
  beatAnalyser = audioCtx.createAnalyser();
  gainNode = audioCtx.createGain();
  analyser.fftSize = FFT_SIZE;
  analyser.smoothingTimeConstant = 0.58;
  beatAnalyser.fftSize = BEAT_FFT_SIZE;
  beatAnalyser.smoothingTimeConstant = 0.10;
  source.connect(analyser);
  source.connect(beatAnalyser);
  analyser.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  applyVolumeToAudio();
  frequencyData.fill(0);
  beatFrequencyData.fill(0);
  beatTimeDomainData.fill(128);
  resetRealtimeBeatEngine();
  audioReady = true;
}
function resumeAudioAnalysis() {
  if (audioCtx && audioCtx.state === 'suspended') return audioCtx.resume().catch(function(e){ console.warn('audio context resume failed:', e); });
  return Promise.resolve();
}

function ensureUiSfxContext() {
  var AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) return null;
  if (!uiSfxCtx || uiSfxCtx.state === 'closed') uiSfxCtx = new AudioContextCtor();
  if (uiSfxCtx.state === 'suspended' && uiSfxCtx.resume) uiSfxCtx.resume().catch(function(){});
  return uiSfxCtx;
}

function playShelfSelectTick(direction, variant) {
  var nowMs = performance.now();
  var minGap = variant === 'row' ? 36 : 42;
  if (nowMs - lastShelfSelectSfxAt < minGap) return;
  var ctx = ensureUiSfxContext();
  if (!ctx) return;
  lastShelfSelectSfxAt = nowMs;
  var dir = direction < 0 ? -1 : 1;
  var pitch = dir > 0 ? 1.035 : 0.965;
  var rowScale = variant === 'row' ? 0.74 : 1.0;
  var volumeScale = 0.38 + Math.max(0, Math.min(1, targetVolume == null ? 0.65 : targetVolume)) * 0.62;
  var t = ctx.currentTime + 0.002;
  var out = ctx.createGain();
  out.gain.setValueAtTime(0.0001, t);
  out.gain.linearRampToValueAtTime(0.058 * rowScale * volumeScale, t + 0.002);
  out.gain.exponentialRampToValueAtTime(0.0001, t + 0.082);
  out.connect(ctx.destination);

  var sampleRate = ctx.sampleRate || 44100;
  var len = Math.max(1, Math.floor(sampleRate * 0.034));
  var buf = ctx.createBuffer(1, len, sampleRate);
  var data = buf.getChannelData(0);
  for (var i = 0; i < len; i++) {
    var e = Math.pow(1 - i / len, 4.2);
    data[i] = (Math.random() * 2 - 1) * e;
  }
  var noise = ctx.createBufferSource();
  noise.buffer = buf;
  var hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.setValueAtTime(4200 * pitch, t);
  var bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(8400 * pitch, t);
  bp.Q.setValueAtTime(7.2, t);
  var ng = ctx.createGain();
  ng.gain.setValueAtTime(0.56, t);
  noise.connect(hp);
  hp.connect(bp);
  bp.connect(ng);
  ng.connect(out);
  noise.start(t);
  noise.stop(t + 0.040);

  function clickOsc(type, freq, delay, dur, gainValue, bend) {
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    var start = t + delay;
    var end = start + dur;
    osc.type = type;
    osc.frequency.setValueAtTime(freq * pitch, start);
    osc.frequency.exponentialRampToValueAtTime(freq * pitch * (bend || 0.72), end);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(gainValue, start + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(g);
    g.connect(out);
    osc.start(start);
    osc.stop(end + 0.004);
  }

  clickOsc('triangle', 720, 0.000, 0.030, 0.18, 0.70);
  clickOsc('square', 2180, 0.004, 0.022, 0.30, 0.86);
  clickOsc('triangle', 4200, 0.011, 0.018, 0.18, 0.94);
  clickOsc('square', 7100, 0.018, 0.012, 0.070, 0.98);
  setTimeout(function(){
    try { out.disconnect(); } catch (_) {}
  }, 160);
}

function clearAudioFadeTimers() {
  if (audioFadeTimer) {
    clearTimeout(audioFadeTimer);
    audioFadeTimer = null;
  }
  if (audioElementFadeFrame) {
    cancelAnimationFrame(audioElementFadeFrame);
    audioElementFadeFrame = 0;
  }
}
function currentAudioOutputGain() {
  if (gainNode && gainNode.gain && isFinite(gainNode.gain.value)) return clampRange(Number(gainNode.gain.value), 0, 1);
  if (audio && isFinite(audio.volume)) return clampRange(Number(audio.volume), 0, 1);
  return clampRange(targetVolume, 0, 1);
}
function audioSilentFloor() {
  return targetVolume > 0.001 ? AUDIO_SILENCE_GAIN : 0;
}
function normalizeAudioFadeTarget(value) {
  value = clampRange(Number(value) || 0, 0, 1);
  return value <= 0.001 ? audioSilentFloor() : value;
}
function holdAudioOutputGain(now) {
  var current = currentAudioOutputGain();
  if (!gainNode || !audioCtx || !gainNode.gain) return current;
  var param = gainNode.gain;
  try {
    if (typeof param.cancelAndHoldAtTime === 'function') {
      param.cancelAndHoldAtTime(now);
      return currentAudioOutputGain();
    }
    param.cancelScheduledValues(now);
    param.setValueAtTime(current, now);
  } catch (e) {
    try {
      param.cancelScheduledValues(now);
      param.setValueAtTime(current, now);
    } catch (_) {}
  }
  return current;
}
function setAudioOutputGainImmediate(value) {
  value = normalizeAudioFadeTarget(value);
  clearAudioFadeTimers();
  if (gainNode && audioCtx) {
    var now = audioCtx.currentTime || 0;
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setValueAtTime(value, now);
  } else if (audio) {
    audio.volume = value;
  }
}
function rampAudioOutputGain(value, durationMs) {
  value = normalizeAudioFadeTarget(value);
  durationMs = Math.max(0, Number(durationMs) || 0);
  clearAudioFadeTimers();
  var serial = audioFadeSerial;
  if (gainNode && audioCtx) {
    var now = audioCtx.currentTime || 0;
    holdAudioOutputGain(now);
    if (durationMs <= 0) {
      gainNode.gain.setValueAtTime(value, now);
      return;
    }
    gainNode.gain.linearRampToValueAtTime(value, now + durationMs / 1000);
    return;
  }
  if (!audio) return;
  var from = currentAudioOutputGain();
  var started = performance.now();
  function tickAudioFade(nowMs) {
    if (serial !== audioFadeSerial || !audio) return;
    var t = durationMs ? clampRange((nowMs - started) / durationMs, 0, 1) : 1;
    var eased = 1 - Math.pow(1 - t, 3);
    audio.volume = from + (value - from) * eased;
    if (t < 1) audioElementFadeFrame = requestAnimationFrame(tickAudioFade);
    else audioElementFadeFrame = 0;
  }
  audioElementFadeFrame = requestAnimationFrame(tickAudioFade);
}
function preparePlaybackFadeIn() {
  audioFadeSerial++;
  setAudioOutputGainImmediate(0);
}
function startPlaybackFadeIn() {
  audioFadeSerial++;
  if (targetVolume <= 0.001) {
    setAudioOutputGainImmediate(0);
    return;
  }
  rampAudioOutputGain(targetVolume, AUDIO_FADE_IN_MS);
}
function restorePlaybackGain() {
  audioFadeSerial++;
  setAudioOutputGainImmediate(targetVolume);
}
function fadeOutAndPauseAudio() {
  if (!audio || audio.paused) return Promise.resolve(false);
  var serial = ++audioFadeSerial;
  rampAudioOutputGain(0, AUDIO_FADE_OUT_MS);
  return new Promise(function(resolve) {
    audioFadeTimer = setTimeout(function(){
      audioFadeTimer = null;
      if (serial !== audioFadeSerial || !audio) {
        resolve(false);
        return;
      }
      try { audio.pause(); } catch (pauseErr) { console.warn('[TogglePlayPause]', pauseErr); }
      setAudioOutputGainImmediate(0);
      resolve(true);
    }, AUDIO_FADE_OUT_MS + 80);
  });
}

function applyVolumeToAudio() {
  if (audio) {
    audio.muted = false;
    audio.volume = gainNode ? 1 : targetVolume;
  }
  if (gainNode && audioCtx) {
    var now = audioCtx.currentTime || 0;
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setTargetAtTime(targetVolume, now, 0.025);
  }
}

function updateVolumeUi() {
  var slider = document.getElementById('volume-slider');
  var value = document.getElementById('volume-value');
  var icon = document.getElementById('volume-icon');
  var wrap = document.getElementById('volume-control');
  var pct = Math.round(targetVolume * 100);
  if (slider && Math.abs(parseFloat(slider.value) - targetVolume) > 0.001) slider.value = targetVolume;
  if (value) value.textContent = pct + '%';
  if (wrap) wrap.classList.toggle('muted', targetVolume <= 0.01);
  if (icon) {
    icon.innerHTML = targetVolume <= 0.01
      ? '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="17" y1="9" x2="22" y2="14"/><line x1="22" y1="9" x2="17" y2="14"/>'
      : targetVolume < 0.45
        ? '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15 10.5a2 2 0 0 1 0 3"/>'
        : '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15 9.5a4 4 0 0 1 0 5"/><path d="M18 7a7 7 0 0 1 0 10"/>';
  }
}

function setVolume(value, silent) {
  var next = Math.max(0, Math.min(1, Number(value) || 0));
  targetVolume = next;
  if (next > 0.01) lastNonZeroVolume = next;
  try { localStorage.setItem('apex-player-volume', String(next)); } catch (e) {}
  applyVolumeToAudio();
  updateVolumeUi();
  if (!silent) showToast('音量 ' + Math.round(next * 100) + '%');
}
function adjustVolumeByKeyboard(delta) {
  var step = Number(delta) || 0;
  if (!step) return;
  setVolume(clampRange(targetVolume + step, 0, 1), false);
}

function toggleVolumePanel(e) {
  if (e) e.stopPropagation();
  var wrap = document.getElementById('volume-control');
  if (volumeCloseTimer) { clearTimeout(volumeCloseTimer); volumeCloseTimer = null; }
  if (wrap) wrap.classList.toggle('open');
}

function toggleMute() {
  setVolume(targetVolume > 0.01 ? 0 : (lastNonZeroVolume || 0.8));
}

function bindVolumeControls() {
  var slider = document.getElementById('volume-slider');
  var btn = document.getElementById('volume-btn');
  var wrap = document.getElementById('volume-control');
  function keepVolumePanelOpen() {
    if (volumeCloseTimer) { clearTimeout(volumeCloseTimer); volumeCloseTimer = null; }
    if (wrap) wrap.classList.add('open');
  }
  function closeVolumePanelSoon() {
    if (volumeCloseTimer) clearTimeout(volumeCloseTimer);
    volumeCloseTimer = setTimeout(function(){
      volumeCloseTimer = null;
      closeHoverPopover('volume-control');  // 同时清焦点，否则 :focus-within 会顶住面板
    }, 520);
  }
  if (wrap) {
    wrap.addEventListener('mouseenter', keepVolumePanelOpen);
    wrap.addEventListener('mouseleave', closeVolumePanelSoon);
  }
  if (slider) {
    slider.addEventListener('input', function(){ setVolume(slider.value, true); });
    slider.addEventListener('focus', keepVolumePanelOpen);
    slider.addEventListener('blur', closeVolumePanelSoon);
    slider.addEventListener('change', function(){ showToast('音量 ' + Math.round(targetVolume * 100) + '%'); });
  }
  if (btn) {
    btn.addEventListener('dblclick', function(e){ e.stopPropagation(); toggleMute(); });
  }
  document.addEventListener('click', function(e){
    if (!wrap) return;
    if (!wrap.contains(e.target)) {
      if (volumeCloseTimer) { clearTimeout(volumeCloseTimer); volumeCloseTimer = null; }
      closeHoverPopover('volume-control');
    }
  });
  updateVolumeUi();
  applyVolumeToAudio();
}

// ============================================================
//  播放队列
// ============================================================
function queueSong(song, opts) {
  opts = opts || {};
  if (!song) return -1;
  var cloned = cloneSong(song);
  var insertAt = playQueue.length;
  if (opts.position === 'next') {
    var key = queueItemKey(cloned);
    var existing = -1;
    if (key) {
      for (var i = 0; i < playQueue.length; i++) {
        if (queueItemKey(playQueue[i]) === key) { existing = i; break; }
      }
    }
    if (existing === currentIdx) return currentIdx;
    if (existing >= 0) {
      cloned = playQueue.splice(existing, 1)[0];
      if (currentIdx >= 0 && existing < currentIdx) currentIdx -= 1;
    }
    var hasCurrent = currentIdx >= 0 && currentIdx < playQueue.length;
    insertAt = hasCurrent ? Math.min(playQueue.length, currentIdx + 1) : playQueue.length;
    playQueue.splice(insertAt, 0, cloned);
  } else {
    playQueue.push(cloned);
    insertAt = playQueue.length - 1;
  }
  safeRenderQueuePanel('queue-song');
  safeShelfRebuild('queue-song');
  return insertAt;
}
function queueSongNext(song) {
  return queueSong(song, { position: 'next' });
}
function queueSearchResult(i) {
  var song = playlist[i]; if (!song) return;
  queueSongNext(song);
  showToast('已设为下一首: ' + song.name);
}
function queueDetailSongNext(song) {
  if (!song || song.type === 'podcast-radio') return;
  queueSongNext(song);
  showToast('已设为下一首: ' + (song.name || ''));
}
function queueIndexNext(i) {
  i = Number(i);
  if (!isFinite(i) || i < 0 || i >= playQueue.length) return;
  var song = playQueue[i];
  queueSongNext(song);
  showToast('已设为下一首: ' + (song && song.name ? song.name : ''));
}
function openQueueArtist(i) {
  var song = playQueue && playQueue[i];
  if (song) openArtistDetailForSong(song);
}
function moveQueueIndexToTop(idx) {
  idx = Number(idx);
  if (!isFinite(idx) || idx < 0 || idx >= playQueue.length) return -1;
  if (idx === 0) return 0;
  var item = playQueue.splice(idx, 1)[0];
  playQueue.unshift(item);
  if (currentIdx === idx) currentIdx = 0;
  else if (currentIdx >= 0 && currentIdx < idx) currentIdx += 1;
  return 0;
}
function playSearchResult(i) {
  var song = playlist[i]; if (!song) return;
  homeForcedOpen = false;
  homeSuppressed = false;
  setHomeControlsLocked(false);
  if (!playQueue.length) { playQueue.unshift(cloneSong(song)); currentIdx = 0; }
  else {
    var matchIdx = -1;
    var targetKey = queueItemKey(song);
    for (var j = 0; j < playQueue.length; j++) if (queueItemKey(playQueue[j]) === targetKey) { matchIdx = j; break; }
    if (matchIdx >= 0) currentIdx = moveQueueIndexToTop(matchIdx);
    else { playQueue.unshift(cloneSong(song)); currentIdx = 0; }
  }
  $results.classList.remove('show');
  $input.value = ''; $input.blur();
  playQueueAt(currentIdx);
}
var firstPlayDone = false;

function playbackProviderLabel(song) {
  return songProviderKey(song) === 'qq' ? 'QQ 音乐' : '网易云';
}
function playbackLoginProvider(song) {
  return songProviderKey(song) === 'qq' ? 'qq' : 'netease';
}
function playbackRestrictionMessage(song, data) {
  data = data || {};
  var restriction = data.restriction || {};
  var category = data.reason || restriction.category || '';
  var provider = playbackProviderLabel(song);
  var message = data.message || restriction.message || '';
  if (!message) {
    if (category === 'login_required') message = provider + '需要登录后再尝试播放';
    else if (category === 'vip_required') message = provider + '歌曲需要会员权限';
    else if (category === 'paid_required') message = provider + '歌曲需要购买或更高权限';
    else if (category === 'trial_only') message = provider + '仅返回试听片段';
    else if (category === 'copyright_unavailable') message = provider + '版权暂不可播';
    else message = provider + '没有返回可播放地址';
  }
  if (category === 'login_required') return message + ' · 正在打开登录';
  if (category === 'copyright_unavailable' || category === 'url_unavailable') return message + ' · 可以试试另一个平台版本';
  return message;
}
function qqPlaybackRetryQualities(requestedQuality, resolvedLevel) {
  requestedQuality = normalizePlaybackQuality(requestedQuality || playbackQuality);
  resolvedLevel = String(resolvedLevel || '').toLowerCase();
  var pool = [];
  if (requestedQuality === 'jymaster' || requestedQuality === 'hires' || requestedQuality === 'lossless' || resolvedLevel === 'hires' || resolvedLevel === 'lossless') {
    pool = ['exhigh', 'standard'];
  } else if (requestedQuality === 'exhigh' || resolvedLevel === 'exhigh') {
    pool = ['standard'];
  }
  return pool.filter(function(q){ return q !== requestedQuality; });
}
async function retryQQPlaybackWithCompatibleQuality(song, idx, token, opts, data, requestedQuality) {
  opts = opts || {};
  var tried = Array.isArray(opts.qqQualityTried) ? opts.qqQualityTried.slice() : [];
  [requestedQuality, data && data.level].forEach(function(q){
    q = normalizePlaybackQuality(q || '');
    if (q && tried.indexOf(q) < 0) tried.push(q);
  });
  var candidates = qqPlaybackRetryQualities(requestedQuality, data && data.level).filter(function(q){ return tried.indexOf(q) < 0; });
  if (!candidates.length || token !== trackSwitchToken) return false;
  var nextQuality = candidates[0];
  var resolvedQuality = normalizePlaybackQuality(data && data.level);
  if (resolvedQuality === 'hires' || resolvedQuality === 'lossless') qqPlaybackQualityCeiling = nextQuality;
  showSourceFallbackNotice('QQ 音质自动兼容', '当前音质启动失败，正在切到 ' + playbackQualityLabel(nextQuality) + '。');
  await playQueueAt(idx, Object.assign({}, opts, {
    qualityOverride: nextQuality,
    qqQualityTried: tried,
  }));
  return true;
}
var sourceFallbackNoticeTimer = null;
function closeSourceFallbackNotice() {
  var notice = document.getElementById('source-fallback-notice');
  if (sourceFallbackNoticeTimer) { clearTimeout(sourceFallbackNoticeTimer); sourceFallbackNoticeTimer = null; }
  if (notice) notice.classList.remove('show');
}
function showSourceFallbackNotice(title, body) {
  if (startupAutoplaySilent) return;  // 启动自动播放尝试期间静默（对齐上游 opts.startupAutoplay 的 silent 语义）
  var notice = document.getElementById('source-fallback-notice');
  var titleEl = document.getElementById('source-fallback-title');
  var bodyEl = document.getElementById('source-fallback-body');
  if (!notice || !titleEl || !bodyEl) return;
  titleEl.textContent = title || '自动换源';
  bodyEl.textContent = body || '';
  notice.classList.add('show');
  if (sourceFallbackNoticeTimer) clearTimeout(sourceFallbackNoticeTimer);
  sourceFallbackNoticeTimer = setTimeout(closeSourceFallbackNotice, 5000);
}
function normalizeMatchText(text) {
  return String(text || '').toLowerCase()
    .replace(/[（(【\[].*?[）)】\]]/g, '')
    .replace(/[\s·・\-—_.,，。:：'"“”‘’/\\|]+/g, '');
}
function artistNameParts(song) {
  var parts = [];
  if (song && Array.isArray(song.artists)) {
    song.artists.forEach(function(a){ if (a && a.name) parts.push(a.name); });
  }
  if (song && song.artist) {
    String(song.artist).split(/\s*\/\s*|\s*,\s*|、|&| feat\.? | ft\.? /i).forEach(function(name){
      if (name && name.trim()) parts.push(name.trim());
    });
  }
  return parts.map(normalizeMatchText).filter(Boolean);
}
function isSameTitleArtist(source, candidate) {
  if (!source || !candidate) return false;
  if (normalizeMatchText(source.name || source.title) !== normalizeMatchText(candidate.name || candidate.title)) return false;
  var a = artistNameParts(source);
  var b = artistNameParts(candidate);
  if (!a.length || !b.length) return false;
  return a.some(function(name){ return b.indexOf(name) >= 0; });
}
function alternatePlaybackProvider(song) {
  return songProviderKey(song) === 'qq' ? 'netease' : 'qq';
}
async function searchAlternatePlatformSong(song) {
  var target = alternatePlaybackProvider(song);
  var artist = artistNameParts(song)[0] || '';
  var query = [song.name || song.title || '', song.artist || artist].filter(Boolean).join(' ').trim();
  if (!query) return null;
  var url = target === 'qq'
    ? '/api/qq/search?keywords=' + encodeURIComponent(query) + '&limit=8'
    : '/api/search?keywords=' + encodeURIComponent(query) + '&limit=12';
  var data = await apiJson(url);
  var list = data && (data.songs || data.result || []);
  for (var i = 0; i < list.length; i++) {
    if (isSameTitleArtist(song, list[i])) return cloneSong(list[i]);
  }
  return null;
}
function markQueueItemPlaybackFailed(idx) {
  if (playQueue[idx]) playQueue[idx]._lastPlaybackFailAt = Date.now();
}
function nextUnblockedQueueIndex(idx) {
  var now = Date.now();
  for (var step = 1; step < playQueue.length; step++) {
    var nextIdx = (idx + step) % playQueue.length;
    var failedAt = Number(playQueue[nextIdx] && playQueue[nextIdx]._lastPlaybackFailAt) || 0;
    if (!failedAt || now - failedAt > 18000) return nextIdx;
  }
  return -1;
}
function skipFailedQueueItem(idx, token, message) {
  hideLoading();
  if (token !== trackSwitchToken) return;
  markQueueItemPlaybackFailed(idx);
  if (playQueue.length <= 1) {
    showSourceFallbackNotice('没有可跳过的下一首', message || '当前歌曲不可播放，队列里没有其他歌曲。');
    return;
  }
  var nextIdx = nextUnblockedQueueIndex(idx);
  if (nextIdx < 0) {
    showSourceFallbackNotice('队列暂时没有可播歌曲', '已尝试绕开受限歌曲，当前队列没有新的可播放项。');
    return;
  }
  showSourceFallbackNotice('已跳过受限歌曲', message || '未找到同名同歌手的另一个平台版本，正在播放下一首。');
  currentIdx = nextIdx;
  playQueueAt(nextIdx, { fallbackDepth: 0 });
}
/**
 * 从歌曲对象里稳妥提取歌手名。
 *
 * 不同来源的 song 形态不一致：ar / artists 可能是对象数组，也可能是**字符串数组**，
 * 还可能只有 singer / artist 字段。早期实现只认 `ar[i].name`，遇到字符串数组会静默
 * 得到空数组 —— 而歌手为空会让所有音源的「歌手匹配」整条失效，从而匹配到同名翻唱版
 *（2026-09-20「明天天明」实测：漏传歌手 → 选中山清翻唱版，表现为歌词跟曲不对）。
 *
 * 刻意不做分隔符拆分：合并串（如「海洋Bo、DJChronos时烬」）靠服务端的双向包含匹配
 * 依然能命中，而按 `&` / `,` 拆会误伤「Simon & Garfunkel」这类本身含符号的歌手名。
 * @param {Object} song
 * @returns {string[]}
 */
function extractArtistNames(song) {
  if (!song) return [];
  var out = [];
  function push(v) {
    if (!v) return;
    if (typeof v === 'string') {
      var t = v.trim();
      if (t) out.push(t);
      return;
    }
    if (typeof v === 'object') push(v.name || v.artist || v.singer || '');
  }
  ['ar', 'artists', 'singer', 'artist', 'singers'].forEach(function (key) {
    var v = song[key];
    if (Array.isArray(v)) {
      for (var i = 0; i < v.length; i++) push(v[i]);
    } else if (v) {
      push(v);
    }
  });
  return out.filter(function (n, i) { return out.indexOf(n) === i; });
}

/**
 * 从歌曲对象里提取专辑名（同样兼容字符串 / 对象两种形态）
 * @param {Object} song
 * @returns {string}
 */
function extractAlbumName(song) {
  if (!song) return '';
  var al = song.al || song.album;
  if (!al) return '';
  if (typeof al === 'string') return al.trim();
  return (al.name || '').trim();
}

/**
 * 尝试使用第三方音源解析音乐 URL
 * @param {Object} song - 歌曲对象
 * @param {string} quality - 请求的音质
 * @returns {Promise<{url: string, level: string, br: number, source: string}|null>}
 *   失败返回 null。
 *   ⚠️ 返回的是**对象**不是裸 url：`level`（'lossless'/'exhigh'/'standard'）是服务端
 *   归一化后的**实际解析档位**，音质按钮在非会员时要用它显示真实档位 ——
 *   旧版只把 url 带回来，档位信息在服务端就被丢掉了。
 */
async function tryThirdPartyParse(song, quality, opts) {
  try {
    var artists = extractArtistNames(song);
    var albumName = extractAlbumName(song);

    // 歌手为空是「货不对版」的高危信号：服务端会按网易云 ID 兜底补齐，
    // 这里只做一次提示，便于排查是哪个调用路径漏了歌手
    if (!artists.length) {
      console.warn('[ThirdPartyParse] 未能从歌曲对象取到歌手，交由服务端兜底:', song && song.name);
    }

    // silent（恢复态预解析/启动自动播放）：后台请求不打扰用户
    var silentParse = !!(opts && opts.silent);
    // 文案随调用路径变化：只有「官方优先但官方真的失败了」才谈得上「官方音源不可用」；
    // 第三方优先（非会员 / 显式配置优先第三方）是**设计路径**，官方源压根没被尝试过，
    // 说「官方音源不可用」不成立 —— 那里只是「正在搜索可用音源」。
    if (!silentParse) {
      showSourceFallbackNotice('正在尝试第三方音源',
        (opts && opts.officialFailed) ? '官方音源不可用，正在搜索其他来源...' : '正在搜索可用音源...');
    }

    // 10s 超时：覆盖 server 端策略链（冷却后 gdmusic 6s + kugou ~2s）+ 网络往返；
    // server 端有策略健康记忆，正常情况远快于此上限
    var parseController = (window.AbortController ? new AbortController() : null);
    var parseTimer = parseController ? setTimeout(function () { parseController.abort(); }, 10000) : null;
    var response = await fetch('/api/parse/music', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: parseController ? parseController.signal : undefined,
      body: JSON.stringify({
        id: song.id,
        name: song.name,
        artists: artists,
        album: albumName,
        duration: song.dt || song.duration || 0,
        quality: quality || 'higher'
      })
    });
    if (parseTimer) clearTimeout(parseTimer);

    if (!response.ok) return null;

    var result = await response.json();
    if (result && result.url) {
      console.log('[ThirdPartyParse] 解析成功, 来源:', result.source, ', 档位:', result.level || '未知');
      if (!silentParse) showSourceFallbackNotice('第三方音源可用', '已通过 ' + (result.source || '第三方') + ' 获取到音频。');
      return {
        url: result.url,
        level: result.level || '',
        br: Number(result.br) || 0,
        source: result.source || 'third-party'
      };
    }
  } catch (e) {
    console.warn('[ThirdPartyParse] 解析失败:', e);
  }
  return null;
}
/**
 * 第三方命中 → 播放数据对象（带 level/br，供音质按钮显示「实际解析档位」）。
 * ⚠️ 刻意**不填** `quality`：服务端返回的 quality 是 'flac'/'999' 这类**源侧编码**，
 * 而 `playbackResolvedQualityText` 会把它当**中文标签**直接输出（会渲染出「999 · 320 kbps」）。
 * @returns {Object|null}
 */
function thirdPartyPlaybackData(hit) {
  if (!hit || !hit.url) return null;
  return {
    url: hit.url,
    trial: false,
    playable: true,
    source: 'third-party',
    thirdPartySource: hit.source || 'third-party',
    level: hit.level || '',
    br: hit.br || 0
  };
}
async function tryAutoPlaybackFallback(song, data, idx, token, opts) {
  opts = opts || {};
  if (opts.fallbackDepth > 0) {
    skipFailedQueueItem(idx, token, '自动换源后的版本仍不可播，正在播放下一首。');
    return true;
  }
  if (!song || song.type === 'local' || song.type === 'podcast' || song.source === 'podcast') return false;
  var restriction = (data && data.restriction) || {};
  var category = (data && data.reason) || restriction.category || '';
  var fromLabel = playbackProviderLabel(song);
  var targetLabel = alternatePlaybackProvider(song) === 'qq' ? 'QQ 音乐' : '网易云';
  showSourceFallbackNotice('正在自动换源', fromLabel + ' 当前不可播，正在查找 ' + targetLabel + ' 的同名同歌手版本。');
  try {
    var alternate = await searchAlternatePlatformSong(song);
    if (token !== trackSwitchToken) return true;
    if (!alternate) {
      if (category === 'login_required') return false;
      skipFailedQueueItem(idx, token, '没有找到同名同歌手的 ' + targetLabel + ' 版本，正在播放下一首。');
      return true;
    }
    alternate.autoFallbackFrom = songProviderKey(song);
    playQueue[idx] = hydrateCustomCover(alternate);
    safeRenderQueuePanel('source-fallback', { scrollCurrent: miniQueueOpen });
    safeShelfRebuild('source-fallback');
    showSourceFallbackNotice('已自动切换音源', (song.name || '当前歌曲') + ' 已从 ' + fromLabel + ' 切到 ' + targetLabel + '。');
    await playQueueAt(idx, { fallbackDepth: 1 });
    return true;
  } catch (e) {
    if (token !== trackSwitchToken) return true;
    skipFailedQueueItem(idx, token, '自动换源搜索失败，正在播放下一首。');
    return true;
  }
}
function handlePlaybackUnavailable(song, data) {
  hideLoading();
  forcePlaybackControlsInteractive();
  var provider = playbackLoginProvider(song);
  var restriction = (data && data.restriction) || {};
  var category = (data && data.reason) || restriction.category || '';
  showToast(playbackRestrictionMessage(song, data));
  if (category === 'login_required') {
    setTimeout(function(){
      var modal = document.getElementById('login-modal');
      if (!modal || modal.classList.contains('show')) return;
      openProviderLogin(provider);
    }, 520);
  }
}

/**
 * 播放中断时的音源自救：清掉这首歌在服务端的解析缓存。
 * 服务端成功缓存 TTL 是 10 分钟，而第三方直链带时效 token ——
 * 缓存里很可能是一条已经失效的死链，不清掉的话用户重试只会反复拿到同一条。
 * 只清缓存、不自动重试：自动重试要动播放链路（token 校验 / 递归），风险不值当。
 */
function handlePlaybackSourceError() {
  var song = (Array.isArray(playQueue) && currentIdx >= 0) ? playQueue[currentIdx] : null;
  if (!song || song.type === 'local' || song.type === 'podcast') return;
  if (song.id === undefined || song.id === null) return;
  showSourceFallbackNotice('音源链接失效', '已清除这首歌的解析缓存，重新播放会重新解析。');
  try {
    fetch('/api/parse/cache/clear-song', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: song.id })
    }).catch(function () {});
  } catch (e) {}
}
function pauseCurrentAudioForTrackSwitch() {
  playToggleBusy = false;
  if (!audio) return;
  try {
    audioFadeSerial++;
    clearAudioFadeTimers();
    audio.onended = null;
    audio.pause();
  } catch (e) {}
  playing = false;
  setPlayIcon(false);
  syncPlaybackStateFromAudioEvent('track-switch');
}

function syncPlaybackStateFromAudioEvent(reason) {
  var isPlaying = !!(audio && audio.src && !audio.paused && !audio.ended);
  playing = isPlaying;
  setPlayIcon(isPlaying);
  if (!isPlaying) hideLoading();
  if (reason === 'play' || reason === 'playing') switchPlaybackVisualToEmily();
  forcePlaybackControlsInteractive();
}

function isPlaybackRecursionError(err) {
  var msg = String((err && err.message) || err || '');
  return err instanceof RangeError || /maximum call stack size exceeded/i.test(msg);
}

function safePlaybackStep(label, fn) {
  try {
    return fn();
  } catch (err) {
    console.warn('[PlaybackSetupStep]', label, err);
    return null;
  }
}

function playbackFailureToastText(err) {
  if (isPlaybackRecursionError(err)) return '播放准备异常，已保持播放器可操作';
  return '播放失败: ' + (err && err.message ? err.message : err);
}
function scheduleAudioResumePosition(media, seconds, token) {
  seconds = Math.max(0, Number(seconds) || 0);
  if (!media || seconds < 0.35) return;
  var applied = false;
  function applyResume() {
    if (applied || token !== trackSwitchToken || !media) return;
    var duration = Number(media.duration) || 0;
    var target = duration > 0 ? Math.min(seconds, Math.max(0, duration - 0.45)) : seconds;
    try {
      media.currentTime = target;
      applied = true;
      if (typeof syncBeatMapPlaybackCursor === 'function') syncBeatMapPlaybackCursor(target, true);
      if (typeof syncPodcastDjMapCursor === 'function') syncPodcastDjMapCursor(target, true);
      updatePlaybackProgressUi();
    } catch (e) {}
  }
  media.addEventListener('loadedmetadata', applyResume, { once: true });
  media.addEventListener('canplay', applyResume, { once: true });
  setTimeout(applyResume, 520);
  applyResume();
}

async function playQueueAt(idx, opts) {
  opts = opts || {};
  if (idx < 0 || idx >= playQueue.length) return;
  // 首次点播即消费"主页豁免"：恢复会话后第一次点歌时 audio 尚未创建，
  // 若豁免仍有效，updateEmptyHomeVisibility 会把主页留在播放页上，第二次点播才恢复。
  // 只消费豁免标志，不清 restoredIdleSession——音源解析期间恢复态歌词/进度保持显示
  restoredHomeExemptUsed = true;
  markRenderInteraction('track-switch', 1500);
  var playPhase = 'start';
  function markPlayPhase(name) { playPhase = name; }
  try {
  markPlayPhase('session-finalize');
  safePlaybackStep('session-finalize', function(){ finalizeListenSession(false); });
  homeForcedOpen = false;
  if (!opts.preserveHomeState) homeSuppressed = false;
  currentIdx = idx;
  trackSwitchToken++;
  if (typeof WebFxPresets !== 'undefined') WebFxPresets.onTrackSwitch(uniforms, uniforms.uTime.value);
  // cuefield：普通切歌清空自动过渡状态；automix 自己的 handoff 调用则保住正在交接的 B deck
  if (typeof resetCuefieldAutoMix === 'function') {
    resetCuefieldAutoMix(opts.cuefieldAutoMix ? 'cuefield-handoff' : 'track-switch',
      opts.cuefieldAutoMix ? { preserveExecution: true, preservePreparedAudio: true } : undefined);
  }
  markPlayPhase('cancel-previous-track');
  cancelBeatAnalysisTimer();
  cancelBeatPrefetchTimer();
  if (localBeatAnalysis.active) cancelLocalBeatAnalysis();
  closeGsapModal(document.getElementById('local-beat-modal'));
  beatMapToken++;
  var token = trackSwitchToken;
  var firstVisualPlay = !firstPlayDone;
  markPlayPhase('track-setup');
  var song = safePlaybackStep('hydrate-song', function(){ return hydrateCustomCover(playQueue[idx]); }) || playQueue[idx];
  playQueue[idx] = song;
  scheduleLastPlaybackSessionSave(0);
  var playbackContext = opts.context || (song && song.radioContext) || null;
  activeRadioContext = playbackContext || null;
  safeRenderQueuePanel('play-queue-at-switch', { scrollCurrent: miniQueueOpen });
  safePlaybackStep('shelf-preview-suppress', suppressShelfPreviewForPlaybackSwitch);
  pauseCurrentAudioForTrackSwitch();
  var bmKey = safePlaybackStep('beatmap-key', function(){ return beatMapSongKey(song); }) || '';
  var podcastDjMode = !!safePlaybackStep('podcast-mode', function(){ return isPodcastSong(song); });
  safePlaybackStep('dj-mode', function(){ setDjModeActive(podcastDjMode, song); });
  safePlaybackStep('visual-switch', switchPlaybackVisualToEmily);
  currentLocalSong = null;
  safePlaybackStep('cover-button', updateCustomCoverButton);
  safePlaybackStep('like-buttons', function(){ updateLikeButtons(song); });
  safePlaybackStep('like-status', function(){ syncLikeStatusForSong(song); });
  safePlaybackStep('cinema-track-profile', function(){ resetCinemaTrackProfile(song); });
  safePlaybackStep('empty-home', function(){ if (!opts.preserveHomeState) updateEmptyHomeVisibility(); });
  safePlaybackStep('track-ui', function(){
    document.getElementById('hint').classList.add('hidden');
    document.getElementById('thumb-title').textContent = song.name;
    document.getElementById('thumb-artist').textContent = song.artist;
    updateControlTrackInfo(song);
    document.getElementById('thumb-wrap').classList.add('visible');
  });
  markPlayPhase('lyric-prep');
  safePlaybackStep('lyric-prep', function(){
    // 恢复态点播同一首：歌词已预取并定位显示中，跳过 fallback 重置——
    // 音源解析期间画面保持，播放开始后时间轴从续播位置自然推进
    var resumeSameSong = restoredIdleSession && pendingResumeAt
      && pendingResumeAt.key === queueItemKey(song) && lyricsLines.length > 0;
    if (resumeSameSong) return;
    var initialLyricLines = withLyricFallback([]);
    setOriginalLyricsState(initialLyricLines, false, 'fallback');
    applyPreferredLyricsForCurrent(true);
  });

  markPlayPhase('cover-load');
  safePlaybackStep('cover-load', function(){
    var customCover = getCustomCoverForSong(song);
    var coverOpts = { trackToken: token, deferHeavy: true, delay: firstVisualPlay ? 380 : 680, timeout: firstVisualPlay ? 1400 : 1900 };
    if (customCover) applyCoverDataUrl(customCover, coverOpts);
    else loadCoverFromUrl(song.cover ? coverUrlWithSize(song.cover, 400) : '', coverOpts);
  });
  safePlaybackStep('trial-banner-reset', function(){ document.getElementById('trial-banner').classList.remove('show'); });
  safePlaybackStep('show-loading', showLoading);
  lyricSunEnergy = 0; lyricSunTarget = 0; lyricSunHold = 0; lyricSunAvg = 0; lyricSunPeak = 0.55;

  // 首次播放: 粒子从暗处浮出 (Apple 风格)
  if (firstVisualPlay) {
    safePlaybackStep('first-visual-alpha', function(){
      firstPlayDone = true;
      tweenParticleAlpha(uniforms.uAlpha.value || 0, 1.0, 220);
    });
  }

  try {
    markPlayPhase('source-url');
    var isLocalPlayback = song.type === 'local' && !!song.localUrl;
    var isQQPlayback = songProviderKey(song) === 'qq';
    var requestedQuality = normalizePlaybackQuality(opts.qualityOverride || playbackQuality);
    if (isQQPlayback && qqPlaybackQualityCeiling && (requestedQuality === 'jymaster' || requestedQuality === 'hires' || requestedQuality === 'lossless')) {
      requestedQuality = qqPlaybackQualityCeiling;
    }

    // 判断当前平台是否有 VIP（VIP/SVIP 优先走官方音源）
    var currentProvider = isQQPlayback ? 'qq' : 'netease';
    var currentStatus = isQQPlayback ? qqLoginStatus : loginStatus;
    var hasVip = hasProviderVip(currentProvider, currentStatus);
    // 解析顺序决策：设置强制 / auto 下官方近期失败自动降级（见 shouldPreferThirdPartyParse）
    var preferThirdParty = shouldPreferThirdPartyParse(currentProvider, hasVip);

    var data = null;

    // 启动预解析命中（恢复态后台已解析同曲同音质且未过期）：跳过整段解析链，点播放即秒出声
    if (!isLocalPlayback) {
      var preparsedData = takePreparsedSongSource(song, requestedQuality);
      if (preparsedData) {
        data = preparsedData;
        console.log('[StartupPreparse] 命中预解析，跳过音源解析:', song.name || '');
        // 预解析是后台静默跑的，这里跳过了整段解析链 → 这条路径下顶部会一条提示都没有。
        // 用户要求「每首歌播放上面都有提示」，所以在真正开始播放时把来源补报一次。
        notifyPreparsedSourceNotice(data);
      }
    }

    if (!data && isLocalPlayback) {
      // 本地曲目：直接使用库的流播地址（bhandsmusic-local:// 或 objectURL），不走在线解析
      data = { url: song.localUrl, trial: false, playable: true, source: 'local' };
      // ⚠️ 必须记下来：本地节拍分析（prepareLocalBeatAnalysis）里每个守卫都拿
      // currentLocalSong.localKey 与 song.localKey 比对，少了这行它们会全部直接 return，
      // 功能表现成「静默失效」。上游在 05-playback/13-playback-start-audio.js:904 同样赋值。
      currentLocalSong = song;
    } else if (!data && (preferThirdParty || !hasVip)) {
      // 第三方优先：① 第三方 → ② 官方 API → ③ 跨平台换源
      // ⚠️ 这里**故意不静默**：第三方解析可能要 1~2s（竞速 + 真实音频探测），
      // 没有提示的话点播放后界面看起来像卡住。这条「正在尝试第三方音源」就是
      // 播放前的解析状态提示，用户明确要求每首歌都显示，不要改成 silent。
      var thirdPartyHit = await tryThirdPartyParse(song, requestedQuality);
      if (token !== trackSwitchToken) return;
      data = thirdPartyPlaybackData(thirdPartyHit);

      if (!data || !data.url) {
        var qualityParam = '&quality=' + encodeURIComponent(requestedQuality);
        data = isQQPlayback
          ? await apiParseJson('/api/qq/song/url?mid=' + encodeURIComponent(song.mid || song.songmid || song.id || '') + '&mediaMid=' + encodeURIComponent(song.mediaMid || song.media_mid || '') + qualityParam)
          : await apiParseJson('/api/song/url?id=' + song.id + qualityParam);
        noteOfficialSourceResult(currentProvider, !!(data && data.url), data === null);
        if (token !== trackSwitchToken) return;
      }
    } else if (!data) {
      // 官方优先（VIP + 未触发降级）：① 官方 API → ② 第三方 → ③ 跨平台换源
      var qualityParam = '&quality=' + encodeURIComponent(requestedQuality);
      data = isQQPlayback
        ? await apiParseJson('/api/qq/song/url?mid=' + encodeURIComponent(song.mid || song.songmid || song.id || '') + '&mediaMid=' + encodeURIComponent(song.mediaMid || song.media_mid || '') + qualityParam)
        : await apiParseJson('/api/song/url?id=' + song.id + qualityParam);
      noteOfficialSourceResult(currentProvider, !!(data && data.url), data === null);
      if (token !== trackSwitchToken) return;

      // ⚠️ 必须 `!data ||`：apiParseJson 在超时/网络失败时返回 **null**，
      // 少了这个判断会直接抛 TypeError 被外层 catch 吞掉 → 这首歌被跳过，
      // 而它本该回落到第三方源（noteOfficialSourceResult 那行已经用 data && data.url 防了）
      if (!data || !data.url) {
        // officialFailed：官方源确实试过且失败了，提示文案才成立
        var thirdPartyHit = await tryThirdPartyParse(song, requestedQuality, { officialFailed: true });
        if (token !== trackSwitchToken) return;
        var thirdPartyData = thirdPartyPlaybackData(thirdPartyHit);
        if (thirdPartyData) data = thirdPartyData;
      }
    }

    // ③ 官方 + 第三方都失败 → 尝试跨平台换源 → 最后兜底试听片段
    // （`!data ||` 同理：官方源请求超时会让 data 停在 null，直接取 .url 会抛异常）
    if (!data || !data.url) {
      if (isQQPlayback && await retryQQPlaybackWithCompatibleQuality(song, idx, token, opts, data, requestedQuality)) return;
      if (await tryAutoPlaybackFallback(song, data, idx, token, opts)) return;

      // 兜底: 尝试获取官方试听片段（30秒）
      if (!isQQPlayback && song.type !== 'local' && song.type !== 'podcast') {
        try {
          showSourceFallbackNotice('正在获取试听片段', '完整版不可用，尝试获取官方试听...');
          var trialData = await apiParseJson('/api/song/url?id=' + song.id + '&quality=standard');
          if (token !== trackSwitchToken) return;
          if (trialData && trialData.url) {
            data = trialData;
            showSourceFallbackNotice('试听片段可用', '完整版不可用，当前播放官方 30 秒试听。');
          }
        } catch (e) {
          console.warn('[TrialFallback] 获取试听失败:', e);
        }
      }

      if (!data || !data.url) {
        handlePlaybackUnavailable(song, data);
        return;
      }
    }
    var resolvedQualityText = playbackResolvedQualityText(data);
    // 记录实际档位 → 刷新音质按钮（非会员时按钮显示的就是这个「解析出来的档位」）
    noteResolvedPlaybackQuality(data);
    // 第三方音源命中的档位是「第三方能给到的最高档」，与用户偏好不是一个语义
    // （偏好选超清母带 → 第三方给无损，那是第三方上限，不是「被降级」）。
    // 这条路径已由 tryThirdPartyParse 弹过「第三方音源可用」，别再补一条自相矛盾的
    // 「官方源只能用 无损 · 879 kbps」（实际播放的正是它）。
    var resolvedFromThirdParty = data.source === 'third-party';
    // 只有「拿到了真实档位信息」才谈降级。第三方音源命中时 data 只有
    // {url, source:'third-party'}（无 level/br），硬算会得出
    // 「请求 超清母带，实际播放 超清母带」；而且那条路径已由
    // tryThirdPartyParse 弹过「第三方音源可用」，不需要再补一条。
    var hasResolvedQuality = !!(data.level || data.br);
    // 试听片段不算降级：完整版不可用是权限问题，由 #trial-banner 说明，
    // 两条同时弹会让「试听」被误读成「音质被降」。
    if (!isQQPlayback && hasResolvedQuality && !data.trial && !resolvedFromThirdParty
        && playbackQualityWasDowngraded(requestedQuality, data.level)) {
      if (isSvipOnlyQuality(requestedQuality) && !hasProviderSvip('netease')) {
        // 必然降级：没 SVIP 就注定拿不到超清母带（server.js 的
        // qualityCandidatesFrom().filter(!q.svip || svipReady) 已把它摘掉）。
        // 这属于「偏好设置选了做不到的档位」，不是故障 —— 说「自动降级」像出错了，
        // 且每首歌都弹一次纯噪音。一个会话只提示一次。
        //
        // ⚠️ 不要建议用户「切到极高来避免提示」：那会让第三方源从无损降到 320k
        // （gdQualityOf('exhigh') = '320'、qualityOf('exhigh') = '320'），
        // 反而丢音质。超清母带/无损这类高档位对第三方源是有意义的（映射成 '999' 无损），
        // 只有网易云官方源那一条路受 SVIP 限制。所以这里只陈述事实，不改建议。
        if (!svipQualityNoticeShown) {
          svipQualityNoticeShown = true;
          showSourceFallbackNotice('超清母带需要 SVIP', '官方源只能用 ' + resolvedQualityText + '；第三方源不受影响，仍按无损解析。');
        }
      } else {
        showSourceFallbackNotice('网易云音质自动降级', '请求 ' + playbackQualityLabel(requestedQuality) + '，实际播放 ' + resolvedQualityText + '。');
      }
    } else if (opts.qualitySwitch && resolvedQualityText) {
      showSourceFallbackNotice('音质已切换', '实际播放: ' + resolvedQualityText + '。');
    }
    if (data.trial) {
      var loggedIn = data.loggedIn != null ? data.loggedIn : (isQQPlayback ? qqLoginStatus.loggedIn : loginStatus.loggedIn);
      var txt;
      if (loggedIn && data.vipLevel === 'svip') txt = '此歌曲需要单曲、专辑购买或更高权限';
      else if (loggedIn && data.vipLevel === 'vip') txt = '此歌曲需要 SVIP 或购买 · 当前仅播放试听片段';
      else if (loggedIn) txt = '此歌曲需 VIP · 当前仅播放试听片段';
      else txt = '当前未登录 · 仅播放试听片段';
      document.getElementById('trial-text').textContent = txt;
      var trialLoginBtn = document.getElementById('trial-login-btn');
      if (trialLoginBtn) {
        trialLoginBtn.style.display = loggedIn ? 'none' : '';
        trialLoginBtn.onclick = function(){ openProviderLogin(isQQPlayback ? 'qq' : 'netease'); };
      }
      document.getElementById('trial-banner').classList.add('show');
    }
    markPlayPhase('audio-element');
    if (!audio) {
      audio = new Audio();
      audio.crossOrigin = 'anonymous';
      // 恢复用户上次选择的播放输出设备（setSinkId 失败时静默回退系统默认）
      if (typeof applyAudioOutputDevice === 'function') applyAudioOutputDevice(readSavedAudioOutputId(), true);
    }
    else {
      audioFadeSerial++;
      clearAudioFadeTimers();
      audio.pause();
    }
    bindPlaybackProgressEvents(audio);
    applyVolumeToAudio();
    var proxyAudioUrl = isLocalPlayback ? data.url : ('/api/audio?url=' + encodeURIComponent(data.url));
    audio.src = proxyAudioUrl;
    updatePlaybackProgressUi();
    scheduleNextSongPreparse();  // 下一首预取：本首解析完开始播放时立即解析队列下一首
    audio.onended = function(){
      if (token !== trackSwitchToken) return;
      // cuefield：自动过渡进行中 A deck 自然播完时，不立即切歌——
      // B deck 已在淡入，交给 executeCuefieldAutoMix 完成 handoff（其内部有恢复兜底）
      if (typeof cuefieldAutoMixExecuting !== 'undefined' && cuefieldAutoMixExecuting && typeof noteCuefieldAutoMixOutgoingEnded === 'function') {
        noteCuefieldAutoMixOutgoingEnded(audio, token, currentIdx);
        return;
      }
      finalizeListenSession(true);
      if (playMode === 'single') setTimeout(function(){ playQueueAt(currentIdx, { autoRepeat: true }); }, 0);
      else setTimeout(nextTrack, 0);
    };
    var sessionResumeAt = opts.resumeAt;
    if (sessionResumeAt == null && pendingResumeAt && pendingResumeAt.key === queueItemKey(song)) {
      // 启动恢复的会话：用户对恢复后的当前曲按下播放时，从上次退出位置续播（一次性）
      sessionResumeAt = pendingResumeAt.position;
      pendingResumeAt = null;
    }
    scheduleAudioResumePosition(audio, sessionResumeAt, token);
    audio.load();
    markPlayPhase('visual-prep');
    try {
    // 重置 beatmap 状态
    currentBeatMap = null;
    beatMapNextIdx = 0;
    resetAudioVisualState();
    resetBeatCameraSync(0);
    cancelBeatAnalysisTimer();
    beatMapToken++;
    var bmTok = beatMapToken;
    if (podcastDjMode) {
      // 播客走独立 DJ 离线锁拍系统, 不写入普通歌曲 beatMap.
      djBeatMapToken++;
      cancelDjBeatAnalysisTimer();
      resetDjBeatMapState();
      currentBeatMap = null;
      beatMapNextIdx = 0;
      var djTok = djBeatMapToken;
      var djKey = djSongKey(song);
      if (djBeatMapCache[djKey]) {
        currentDjBeatMap = djBeatMapCache[djKey];
        applyPodcastDjProfileFromMap(currentDjBeatMap);
        syncPodcastDjMapCursor(audio ? audio.currentTime : 0, true);
        hideBeatChip();
        notifyDesktopLyricsBeatMapReady();
        console.log('podcast DJ beatmap 缓存命中:', currentDjBeatMap.cameraBeats.length, '个主拍');
      } else {
        showBeatChip('DJ 离线锁拍准备中…');
        var djDurationSec = Math.max(0, Number(song.duration) || 0);
        if (djDurationSec > 10000) djDurationSec /= 1000;
        schedulePodcastDjAnalysis(djKey, data.url, djTok, djDurationSec);
      }
      maybeAnnounceDjMode();
    } else if (bmKey && beatMapCache[bmKey]) {
      // 如果缓存有, 直接用
      currentBeatMap = beatMapCache[bmKey];
      applyCinemaProfileFromBeatMap(currentBeatMap);
      syncBeatMapPlaybackCursor(audio ? audio.currentTime : 0);
      notifyDesktopLyricsBeatMapReady();
      console.log('beatmap 缓存命中:', currentBeatMap.kicks.length, '个鼓点');
      scheduleQueueBeatPrefetch(idx, 2600);
    } else {
      var diskBeatMap = bmKey ? await readBeatDiskCache(bmKey) : null;
      if (diskBeatMap) {
        currentBeatMap = diskBeatMap;
        applyCinemaProfileFromBeatMap(currentBeatMap);
        syncBeatMapPlaybackCursor(audio ? audio.currentTime : 0);
        notifyDesktopLyricsBeatMapReady();
        console.log('beatmap D盘缓存命中:', currentBeatMap.kicks.length, '个鼓点');
        scheduleQueueBeatPrefetch(idx, 2600);
      } else {
        // 后台延迟分析, 避免新歌刚开始播放时抢占解码和渲染资源
        scheduleBeatAnalysis(bmKey || song.id, proxyAudioUrl, bmTok, song);
      }
    }
    } catch (visualErr) {
      console.warn('[PlaybackVisualPrep]', song && song.name, visualErr);
      currentBeatMap = null;
      beatMapNextIdx = 0;
      safePlaybackStep('visual-prep-hide-chip', hideBeatChip);
    }
    markPlayPhase('audio-start');
    var playbackStarted = await playAudio({ silent: isQQPlayback });
    if (!playbackStarted) {
      if (isQQPlayback && await retryQQPlaybackWithCompatibleQuality(song, idx, token, opts, data, requestedQuality)) return;
      forcePlaybackControlsInteractive();
      if (opts.manual) {
        showToast('播放启动失败，请重新选择歌曲');
      } else {
        showSourceFallbackNotice('歌曲已载入', '点击播放器中间的播放按钮继续播放。');
      }
      return;
    }
    forcePlaybackControlsInteractive();
    markPlayPhase('session-begin');
    safePlaybackStep('listen-session-begin', function(){ beginListenSession(song, playbackContext); });
    markPlayPhase('lyrics-fetch');
    if (song.type === 'podcast') {
      safePlaybackStep('podcast-lyrics', function(){
        var podcastLyricLines = withLyricFallback([]);
        setOriginalLyricsState(podcastLyricLines, false, 'fallback');
        applyPreferredLyricsForCurrent(true);
      });
    } else {
      fetchLyric(song, token);
    }
    safeRenderQueuePanel('play-queue-at');
    scheduleShelfRebuild('play-queue-at', true);
    safePlaybackStep('shelf-preview-suppress-end', suppressShelfPreviewForPlaybackSwitch);
    // 本地歌曲：等播放真正起来后再进节奏分析。缓存命中就静默套用，没缓存才弹「选 MR / DJ」的框
    //（见 prepareLocalBeatAnalysis）。首次播放多等一点，避免抢音频解码与渲染资源。
    // 与上游 05-playback/13-playback-start-audio.js 的 setTimeout(…, firstVisualPlay ? 680 : 520) 对齐。
    if (isLocalPlayback) {
      setTimeout(function(){
        if (token === trackSwitchToken && currentLocalSong && currentLocalSong.localKey === song.localKey) {
          prepareLocalBeatAnalysis(currentLocalSong, song.localUrl);
        }
      }, firstVisualPlay ? 680 : 520);
    }
  } catch (err) {
    console.error('Play failed:', { phase: playPhase, error: err }, err);
    hideLoading();
    forcePlaybackControlsInteractive();
    if (!isPlaybackRecursionError(err) && token === trackSwitchToken && !opts.manual && playQueue.length > 1) {
      skipFailedQueueItem(idx, token, '当前歌曲加载失败，正在尝试队列里的下一首。');
      return;
    }
    showToast(playbackFailureToastText(err));
  }
  } catch (setupErr) {
    console.error('Play setup failed:', { phase: playPhase, error: setupErr }, setupErr);
    hideLoading();
    forcePlaybackControlsInteractive();
    if (!isPlaybackRecursionError(setupErr) && typeof token !== 'undefined' && token === trackSwitchToken && !opts.manual && playQueue.length > 1) {
      skipFailedQueueItem(idx, token, '当前歌曲切换失败，正在尝试队列里的下一首。');
      return;
    }
    showToast(playbackFailureToastText(setupErr));
  }
}
async function attemptAudioPlay(opts) {
  opts = opts || {};
  try {
      if (!audio) return false;
      if (!audioReady) initAudio();
      if (opts.fade !== false) preparePlaybackFadeIn();
      if (opts.manual) {
        var manualPlay = audio.play();
        await resumeAudioAnalysis();
        await manualPlay;
      } else {
        await resumeAudioAnalysis();
        await audio.play();
      }
      await resumeAudioAnalysis();
      switchPlaybackVisualToEmily();
      playing = true; setPlayIcon(true);
    if (opts.fade !== false) startPlaybackFadeIn();
    else restorePlaybackGain();
    // cuefield：真正起声后调度准备下一首的自动过渡
    if (typeof scheduleCuefieldAutoMixPrepare === 'function') scheduleCuefieldAutoMixPrepare(trackSwitchToken, currentIdx, 900);
    forcePlaybackControlsInteractive();
    hideLoading();
    return true;
  } catch (err) {
    console.warn('Audio play blocked:', err && (err.message || err));
    restorePlaybackGain();
    playing = false; setPlayIcon(false);
    hideLoading();
    forcePlaybackControlsInteractive();
    if (!opts.silent) showToast(opts.manual ? '播放启动失败, 请重新选择歌曲' : '播放被系统拦截, 请点击播放按钮');
    return false;
  }
}
async function playAudio(opts) {
  opts = opts || {};
  return attemptAudioPlay({ manual: false, silent: !!opts.silent });
}
async function togglePlay() {
  if (playToggleBusy) return;
  playToggleBusy = true;
  try {
    forcePlaybackControlsInteractive();
    if ((!audio || !audio.src) && playQueue.length && currentIdx >= 0) {
      await playQueueAt(currentIdx, { manual: true });
      return;
    }
    if (!audio) return;
    if (audio.paused || audio.ended) {
      await attemptAudioPlay({ manual: true });
    } else {
      await fadeOutAndPauseAudio();
      playing = false;
      setPlayIcon(false);
      // cuefield：手动暂停时清理 B deck 与过渡状态
      if (typeof resetCuefieldAutoMix === 'function') resetCuefieldAutoMix('manual-pause');
      hideLoading();
      safePlaybackStep('listen-stats-pause', function(){ updateListenStatsTick(true); });
      forcePlaybackControlsInteractive();
      safePlaybackStep('sync-pause-state', function(){ syncPlaybackStateFromAudioEvent('manual-pause'); });
      safePlaybackStep('pause-controls-hide', function(){ scheduleControlsHide(520); });
    }
  } catch (err) {
    console.warn('[TogglePlay]', err);
    playing = !!(audio && !audio.paused);
    setPlayIcon(playing);
    hideLoading();
    forcePlaybackControlsInteractive();
    if (!audio || !audio.src) showToast('播放控制失败');
  } finally {
    playToggleBusy = false;
  }
}
function setPlayIcon(p) {
  document.getElementById('play-icon').innerHTML = p
    ? '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>'
    : '<path d="M8 5v14l11-7z"/>';
}
function nextTrack() {
  if (!playQueue.length) return;
  playToggleBusy = false;
  forcePlaybackControlsInteractive();
  if (playMode === 'shuffle') currentIdx = Math.floor(Math.random() * playQueue.length);
  else currentIdx = (currentIdx + 1) % playQueue.length;
  Promise.resolve(playQueueAt(currentIdx)).finally(forcePlaybackControlsInteractive);
}
function prevTrack() {
  if (!playQueue.length) return;
  playToggleBusy = false;
  forcePlaybackControlsInteractive();
  currentIdx = (currentIdx - 1 + playQueue.length) % playQueue.length;
  Promise.resolve(playQueueAt(currentIdx)).finally(forcePlaybackControlsInteractive);
}
function shuffleQueue() {
  for (var i = playQueue.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = playQueue[i]; playQueue[i] = playQueue[j]; playQueue[j] = tmp;
  }
  currentIdx = 0; safeRenderQueuePanel('shuffle-queue');
  showToast('队列已随机');
  safeShelfRebuild('shuffle-queue');
}
function clearQueue() {
  playQueue = []; currentIdx = -1;
  safeRenderQueuePanel('clear-queue');
  safeShelfRebuild('clear-queue');
  updateCustomCoverButton();
  updateCustomLyricControls();
  updateEmptyHomeVisibility({ forceLoad: false });
}
function removeFromQueue(idx) {
  if (idx < 0 || idx >= playQueue.length) return;
  playQueue.splice(idx, 1);
  if (currentIdx >= playQueue.length) currentIdx = playQueue.length - 1;
  safeRenderQueuePanel('remove-queue-item');
  safeShelfRebuild('remove-queue-item');
  updateCustomCoverButton();
  updateCustomLyricControls();
  updateEmptyHomeVisibility({ forceLoad: false });
}
function playModeLabel(mode) {
  return { loop: '顺序循环', shuffle: '随机播放', single: '单曲循环' }[mode] || '顺序循环';
}

function playModeIconMarkup(mode) {
  if (mode === 'shuffle') {
    return '<path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/>';
  }
  if (mode === 'single') {
    return '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/><path d="M12 9v6"/><path d="M10.5 10.5 12 9l1.5 1.5"/>';
  }
  return '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>';
}

function updatePlayModeButton(animate) {
  var label = playModeLabel(playMode);
  var chip = document.getElementById('play-mode-chip');
  var btn = document.getElementById('play-mode-btn');
  var icon = document.getElementById('play-mode-icon');
  if (chip) chip.textContent = label;
  if (btn) {
    btn.dataset.mode = playMode;
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.classList.toggle('active', playMode !== 'loop');
  }
  if (icon) icon.innerHTML = playModeIconMarkup(playMode);
  if (!animate || !btn) return;
  if (window.gsap) {
    window.gsap.killTweensOf(btn);
    if (icon) window.gsap.killTweensOf(icon);
    window.gsap.timeline({ defaults: { overwrite: true } })
      .fromTo(btn, { scale: 0.86, rotate: -8 }, { scale: 1.12, rotate: 4, duration: 0.16, ease: 'power2.out' })
      .to(btn, { scale: 1, rotate: 0, duration: 0.34, ease: 'back.out(2.1)' });
    window.gsap.fromTo(btn,
      { boxShadow: '0 0 0 0 rgba(255,63,85,.36)' },
      { boxShadow: '0 0 0 14px rgba(255,63,85,0)', duration: 0.58, ease: 'sine.out', overwrite: false, onComplete: function(){ window.gsap.set(btn, { clearProps: 'boxShadow' }); } }
    );
    if (icon) window.gsap.fromTo(icon, { y: 4, autoAlpha: 0.32, rotate: -22, scale: 0.74 }, { y: 0, autoAlpha: 1, rotate: 0, scale: 1, duration: 0.42, ease: 'expo.out', overwrite: true });
  } else {
    btn.classList.remove('mode-switching');
    void btn.offsetWidth;
    btn.classList.add('mode-switching');
    setTimeout(function(){ btn.classList.remove('mode-switching'); }, 460);
  }
}

function cyclePlayMode() {
  var modes = ['loop', 'shuffle', 'single'];
  var idx = modes.indexOf(playMode);
  playMode = modes[(idx + 1) % modes.length];
  updatePlayModeButton(true);
  showToast('播放模式: ' + playModeLabel(playMode));
}
updatePlayModeButton(false);

var controlGlassState = { key: '', searchBoxKey: '', searchPillKey: '' };
function normalizeControlGlassChromaticOffset(value) {
  var n = Number(value);
  if (!isFinite(n)) n = fxDefaults.controlGlassChromaticOffset;
  return clampRange(n, 0, 140);
}
function applyControlGlassChromaticOffset() {
  if (!fx) return;
  fx.controlGlassChromaticOffset = normalizeControlGlassChromaticOffset(fx.controlGlassChromaticOffset);
  var filter = document.getElementById('bhandsmusic-control-glass-filter');
  if (!filter) return;
  var dx = String(-Math.round(fx.controlGlassChromaticOffset));
  filter.querySelectorAll('feOffset').forEach(function(node){
    node.setAttribute('dx', dx);
    node.setAttribute('dy', '0');
  });
}
function supportsControlGlassSvgFilter() {
  try {
    var ua = navigator.userAgent || '';
    if ((/Safari/.test(ua) && !/Chrome/.test(ua)) || /Firefox/.test(ua)) return false;
    var div = document.createElement('div');
    div.style.backdropFilter = 'url(#bhandsmusic-control-glass-filter)';
    return div.style.backdropFilter !== '';
  } catch (e) {
    return false;
  }
}
function generateControlGlassDisplacementMap(width, height, radius) {
  width = Math.max(240, Math.round(width || 400));
  height = Math.max(48, Math.round(height || 92));
  radius = Math.max(12, Math.round(radius || 50));
  var borderWidth = 0.07;
  var edge = Math.min(width, height) * (borderWidth * 0.5);
  var innerW = Math.max(1, width - edge * 2);
  var innerH = Math.max(1, height - edge * 2);
  var svg = '<svg viewBox="0 0 ' + width + ' ' + height + '" xmlns="http://www.w3.org/2000/svg">' +
    '<defs>' +
    '<linearGradient id="glass-red" x1="100%" y1="0%" x2="0%" y2="0%"><stop offset="0%" stop-color="#0000"/><stop offset="100%" stop-color="red"/></linearGradient>' +
    '<linearGradient id="glass-blue" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#0000"/><stop offset="100%" stop-color="blue"/></linearGradient>' +
    '</defs>' +
    '<rect x="0" y="0" width="' + width + '" height="' + height + '" fill="black"/>' +
    '<rect x="0" y="0" width="' + width + '" height="' + height + '" rx="' + radius + '" fill="url(#glass-red)"/>' +
    '<rect x="0" y="0" width="' + width + '" height="' + height + '" rx="' + radius + '" fill="url(#glass-blue)" style="mix-blend-mode:difference"/>' +
    '<rect x="' + edge.toFixed(2) + '" y="' + edge.toFixed(2) + '" width="' + innerW.toFixed(2) + '" height="' + innerH.toFixed(2) + '" rx="' + radius + '" fill="hsl(0 0% 50% / 1)" style="filter:blur(11px)"/>' +
    '</svg>';
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}
function updateGlassDisplacementMapForElement(el, img, stateKey) {
  if (!el || !img) return;
  var rect = el.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return;
  var radius = parseFloat(getComputedStyle(el).borderRadius) || 24;
  var key = Math.round(rect.width) + 'x' + Math.round(rect.height) + ':' + Math.round(radius);
  if (key === controlGlassState[stateKey]) return;
  controlGlassState[stateKey] = key;
  var href = generateControlGlassDisplacementMap(rect.width, rect.height, radius);
  img.setAttribute('href', href);
  try { img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', href); } catch (e) {}
}
function updateControlGlassDisplacementMap() {
  updateGlassDisplacementMapForElement(
    document.getElementById('bottom-bar'),
    document.getElementById('control-glass-map'),
    'key'
  );
}
function updateSearchBoxGlassDisplacementMap() {
  updateGlassDisplacementMapForElement(
    document.getElementById('search-box'),
    document.getElementById('search-box-glass-map'),
    'searchBoxKey'
  );
}
function initControlGlassSurface() {
  if (supportsControlGlassSvgFilter()) document.documentElement.classList.add('control-glass-svg-ok');
  applyControlGlassChromaticOffset();
  updateControlGlassDisplacementMap();
  updateSearchBoxGlassDisplacementMap();
  updateSearchPillGlassDisplacementMap();
  var bar = document.getElementById('bottom-bar');
  var searchBox = document.getElementById('search-box');
  var searchTabs = document.getElementById('search-mode-tabs');
  var searchResults = document.getElementById('search-results');
  if (window.ResizeObserver && (bar || searchBox || searchTabs || searchResults)) {
    var ro = new ResizeObserver(function(){
      requestAnimationFrame(updateControlGlassDisplacementMap);
      requestAnimationFrame(updateSearchBoxGlassDisplacementMap);
      requestAnimationFrame(updateSearchPillGlassDisplacementMap);
    });
    if (bar) ro.observe(bar);
    if (searchBox) ro.observe(searchBox);
    if (searchTabs) ro.observe(searchTabs);
    if (searchResults) ro.observe(searchResults);
  }
  if (window.MutationObserver && (searchTabs || searchResults)) {
    var mo = new MutationObserver(function(){
      requestAnimationFrame(updateSearchPillGlassDisplacementMap);
    });
    if (searchTabs) mo.observe(searchTabs, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    if (searchResults) mo.observe(searchResults, { childList: true, subtree: true });
  }
  window.addEventListener('resize', function(){
    requestAnimationFrame(updateControlGlassDisplacementMap);
    requestAnimationFrame(updateSearchBoxGlassDisplacementMap);
    requestAnimationFrame(updateSearchPillGlassDisplacementMap);
  });
}

function bindPlayerControlAnimations() {
  if (!window.gsap) return;
  document.querySelectorAll('#bottom-bar .ctrl-btn').forEach(function(btn){
    if (!btn || btn.dataset.controlAnimBound === '1') return;
    btn.dataset.controlAnimBound = '1';
    var isPlay = btn.id === 'play-btn';
    var iconTarget = btn.querySelector('svg,.lyrics-word-icon,#quality-btn-label');
    function canAnimate() {
      return !btn.disabled && !btn.classList.contains('busy');
    }
    function hoverIn(e) {
      if (!canAnimate() || (e && e.pointerType === 'touch')) return;
      window.gsap.to(btn, { y: -2, scale: isPlay ? 1.07 : 1.08, duration: 0.20, ease: 'power2.out', overwrite: 'auto' });
      if (iconTarget) window.gsap.to(iconTarget, { scale: isPlay ? 1.08 : 1.10, duration: 0.22, ease: 'power2.out', overwrite: 'auto' });
    }
    function hoverOut() {
      window.gsap.to(btn, { y: 0, scale: 1, rotate: 0, duration: 0.26, ease: 'power2.out', overwrite: 'auto' });
      if (iconTarget) window.gsap.to(iconTarget, { scale: 1, rotate: 0, duration: 0.22, ease: 'power2.out', overwrite: 'auto' });
    }
    function pressDown() {
      if (!canAnimate()) return;
      window.gsap.to(btn, { y: 0, scale: isPlay ? 0.91 : 0.90, duration: 0.10, ease: 'power2.out', overwrite: 'auto' });
      if (iconTarget) window.gsap.to(iconTarget, { scale: 0.88, duration: 0.10, ease: 'power2.out', overwrite: 'auto' });
    }
    function release(e) {
      if (!canAnimate()) return;
      var hovered = e && e.pointerType !== 'touch' && btn.matches(':hover');
      window.gsap.to(btn, { y: hovered ? -2 : 0, scale: hovered ? (isPlay ? 1.07 : 1.08) : 1, duration: 0.24, ease: 'back.out(1.9)', overwrite: 'auto' });
      if (iconTarget) window.gsap.to(iconTarget, { scale: hovered ? 1.06 : 1, duration: 0.22, ease: 'back.out(1.8)', overwrite: 'auto' });
    }
    function clickPulse() {
      if (!canAnimate() || btn.id === 'play-mode-btn') return;
      var pulseSize = isPlay ? 18 : 10;
      var pulseColor = isPlay ? 'rgba(255,63,85,.34)' : 'rgba(255,255,255,.22)';
      window.gsap.killTweensOf(btn, 'boxShadow');
      window.gsap.fromTo(btn,
        { boxShadow: '0 0 0 0 ' + pulseColor },
        { boxShadow: '0 0 0 ' + pulseSize + 'px rgba(255,63,85,0)', duration: isPlay ? 0.58 : 0.42, ease: 'sine.out', overwrite: false, onComplete: function(){ window.gsap.set(btn, { clearProps: 'boxShadow' }); } }
      );
      if (iconTarget) window.gsap.fromTo(iconTarget, { rotate: isPlay ? 0 : -5 }, { rotate: 0, duration: 0.34, ease: 'elastic.out(1,0.55)', overwrite: 'auto' });
    }
    btn.addEventListener('pointerenter', hoverIn);
    btn.addEventListener('pointerleave', hoverOut);
    btn.addEventListener('pointercancel', hoverOut);
    btn.addEventListener('mousedown', function(e){ e.preventDefault(); });
    btn.addEventListener('pointerdown', pressDown);
    btn.addEventListener('pointerup', release);
    btn.addEventListener('click', clickPulse);
    btn.addEventListener('focus', function(){ hoverIn(); });
    btn.addEventListener('blur', hoverOut);
  });
}

function clearPlayerControlFocusState(reason) {
  try {
    document.querySelectorAll('#bottom-bar .ctrl-btn').forEach(function(btn){
      if (!btn) return;
      if (document.activeElement === btn) btn.blur();
      btn.classList.remove('focus-visible');
      if (window.gsap) {
        window.gsap.killTweensOf(btn);
        window.gsap.set(btn, { y: 0, scale: 1, rotate: 0, clearProps: 'boxShadow' });
        var iconTarget = btn.querySelector('svg,.lyrics-word-icon,#quality-btn-label');
        if (iconTarget) {
          window.gsap.killTweensOf(iconTarget);
          window.gsap.set(iconTarget, { scale: 1, rotate: 0 });
        }
      } else {
        btn.style.transform = '';
        btn.style.boxShadow = '';
      }
    });
  } catch (e) {
    console.warn('[ControlFocusClear]', reason || 'unknown', e);
  }
}
