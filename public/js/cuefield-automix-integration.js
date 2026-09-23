// ============================================================================
// Cuefield AutoMix · 播放集成（BhandsMusic fork 适配版）
// 移植自上游 Mineradio 2.2.0 的 18-cuefield-automix-integration.js。
// fork 适配点（与上游的差异，其余逐行同源）：
//   1. localStorage 键品牌化：bhandsmusic-cuefield-automix-v1
//   2. writeAudioOutputGain → 对接 fork 的输出增益系统 setAudioOutputGainImmediate
//      （fork 主 audio 走 WebAudio gainNode，rampAudioOutputGain/currentAudioOutputGain 同名复用）
//   3. 歌词获取改走 fork 的 /api/lyric 与 /api/qq/lyric（fork 无 persistentLyricCache 体系）
//   4. handoff 改为「fork 原生交接」：fork 播放核心没有 albumGapless/preloadedAudio 的
//      deck 接管机制，改为 B deck 保持出声填补切歌空隙，playQueueAt 正常切歌，
//      主 deck 真正起声后再停 B deck —— 不侵入 playQueueAt 核心逻辑
//   5. B deck WebAudio graph 建成后自动 resume 挂起的 audioCtx
// 本文件所有对播放器核心的引用都通过全局变量/typeof 守卫进行：
// 加载失败或缺失依赖时，功能静默不生效，绝不影响正常播放。
// ============================================================================

var CUEFIELD_AUTOMIX_STORE_KEY = 'bhandsmusic-cuefield-automix-v1';
var cuefieldAutoMixEnabled = false;
var cuefieldAutoMix = null;
var cuefieldAutoMixPrepareTimer = 0;
var cuefieldAutoMixExecuting = false;
var cuefieldAutoMixPreparedAudio = null;
var cuefieldMediaFadeSerial = 0;
var cuefieldMediaFadeRaf = 0;
var cuefieldMediaFadeTimer = 0;
var cuefieldPairFadeResolve = null;
var cuefieldTransitionGeneration = 0;
var cuefieldDelayWaiters = [];
var cuefieldActiveTransitionContext = null;
var cuefieldAudioDescriptorCache = {};
var cuefieldRecentRecipes = [];
var cuefieldBridgeEngine = null;
var cuefieldSourceLoopRuntime = null;
var cuefieldDeckVolumeSerial = { A: 0, B: 0 };
var cuefieldFeedbackState = { context: null, timer: 0, submitted: false };

// fork 适配：上游的 writeAudioOutputGain 对应 fork 的 setAudioOutputGainImmediate。
// fork 主 audio 的音量实际作用在 WebAudio gainNode 上（audio.volume 恒为 1）。
function writeAudioOutputGain(value) {
  if (typeof setAudioOutputGainImmediate === 'function') {
    setAudioOutputGainImmediate(value);
    return;
  }
  try { if (typeof audio !== 'undefined' && audio) audio.volume = Math.max(0, Math.min(1, Number(value) || 0)); } catch (_) { }
}

function readCuefieldAutoMixPreference() {
  try { return localStorage.getItem(CUEFIELD_AUTOMIX_STORE_KEY) === '1'; } catch (_) { return false; }
}

function saveCuefieldAutoMixPreference() {
  try { localStorage.setItem(CUEFIELD_AUTOMIX_STORE_KEY, cuefieldAutoMixEnabled ? '1' : '0'); } catch (_) { }
}

function cuefieldSongKey(song) {
  return typeof beatMapSongKey === 'function' ? String(beatMapSongKey(song) || '') : '';
}

function cuefieldAutoMixNextIndex(index) {
  if (!Array.isArray(playQueue) || playQueue.length < 2 || playMode === 'single') return -1;
  index = isFinite(Number(index)) ? Math.round(Number(index)) : currentIdx;
  return (index + 1 + playQueue.length) % playQueue.length;
}

function cuefieldAutoMixStatusText(status) {
  return {
    disabled: '已关闭',
    waiting: '等待播放',
    preparing: '正在分析下一首',
    'waiting-beatmap': '正在准备节拍图',
    'missing-audio': '下一首暂不可用',
    fallback: '本组歌曲暂不适合混音',
    'technical-error': '分析暂不可用',
    ready: '过渡已准备',
    handoff: '正在自动过渡',
    error: '准备失败'
  }[status] || status || '待命';
}

function updateCuefieldAutoMixUi(status) {
  var button = document.getElementById('cuefield-automix-btn');
  if (!button) return;
  var snapshot = cuefieldAutoMix && cuefieldAutoMix.snapshot ? cuefieldAutoMix.snapshot() : null;
  var ready = !!(snapshot && snapshot.pending);
  button.classList.toggle('cuefield-automix-on', !!cuefieldAutoMixEnabled);
  button.classList.toggle('cuefield-automix-ready', !!cuefieldAutoMixEnabled && ready);
  button.setAttribute('aria-pressed', cuefieldAutoMixEnabled ? 'true' : 'false');
  button.title = cuefieldAutoMixEnabled
    ? ('Cuefield AutoMix · ' + (ready ? '过渡已准备' : cuefieldAutoMixStatusText(status || (snapshot && snapshot.lastStatus))))
    : 'Cuefield AutoMix（实验功能，默认关闭）';
}

function cuefieldAutoMixAudioDescriptor(song) {
  var key = cuefieldSongKey(song);
  var cached = key && cuefieldAudioDescriptorCache[key];
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached);
  return Promise.resolve(typeof fetchBeatPrefetchAudioUrl === 'function' ? fetchBeatPrefetchAudioUrl(song) : null).then(function (proxyUrl) {
    if (!proxyUrl) return null;
    var descriptor = {
      proxyUrl: proxyUrl,
      playbackData: { url: proxyUrl, source: songProviderKey(song), level: '' },
      expiresAt: Date.now() + 4 * 60 * 1000
    };
    if (key) cuefieldAudioDescriptorCache[key] = descriptor;
    return descriptor;
  });
}

function cuefieldLinesToLrc(lines) {
  return (Array.isArray(lines) ? lines : []).slice(0, 800).map(function (line) {
    if (!line || line.fallback || line.source === 'fallback' || !isFinite(Number(line.t != null ? line.t : line.time))) return '';
    var seconds = Math.max(0, Number(line.t != null ? line.t : line.time) || 0);
    var minutes = Math.floor(seconds / 60);
    var remain = seconds - minutes * 60;
    var stamp = String(minutes).padStart(2, '0') + ':' + remain.toFixed(3).padStart(6, '0');
    var text = String(line.text || '').replace(/[\r\n]+/g, ' ').trim();
    return text ? ('[' + stamp + ']' + text) : '';
  }).filter(Boolean).join('\n');
}

// fork 适配：直接用 fork 的歌词端点（当前曲优先取已解析的 originalLyricsState 行）。
async function cuefieldLyricTextForSong(song, current) {
  if (!song) return '';
  if (current) {
    var liveLines = originalLyricsState && originalLyricsState.lines && originalLyricsState.lines.length
      ? originalLyricsState.lines
      : lyricsLines;
    var liveLrc = cuefieldLinesToLrc(liveLines);
    if (liveLrc) return liveLrc;
  }
  try {
    var payload;
    if (songProviderKey(song) === 'qq') {
      payload = await apiJson('/api/qq/lyric?mid=' + encodeURIComponent(song.mid || song.songmid || song.id || '')
        + '&id=' + encodeURIComponent(song.qqId || song.id || ''));
    } else {
      payload = await apiJson('/api/lyric?id=' + encodeURIComponent(song.id || ''));
    }
    if (payload && String(payload.lyric || '').trim()) return String(payload.lyric).trim();
  } catch (_) { }
  return '';
}

async function ensureCuefieldAutoMixBeatMap(song, key, context) {
  if (!song || !key) return false;
  if (beatMapCache[key]) return true;
  if (context && context.currentIndex === currentIdx && currentBeatMap && key === cuefieldSongKey(playQueue[currentIdx])) {
    beatMapCache[key] = currentBeatMap;
    if (typeof writeBeatDiskCache === 'function') {
      try { await writeBeatDiskCache(key, currentBeatMap, song, 'cuefield'); } catch (_) { }
    }
    return true;
  }
  var diskMap = typeof readBeatDiskCache === 'function' ? await readBeatDiskCache(key) : null;
  if (diskMap) return true;
  function contextStillCurrent() {
    return !context || (context.token === trackSwitchToken && context.currentIndex === currentIdx);
  }
  if (!contextStillCurrent() || !cuefieldAutoMixEnabled || !isBeatPrefetchCandidate(song) || beatMapBusy || cuefieldAutoMixVisualTransitionBusy()) return false;
  var analysisToken = beatMapToken;
  var descriptor = await cuefieldAutoMixAudioDescriptor(song);
  if (!contextStillCurrent() || analysisToken !== beatMapToken || beatMapBusy || cuefieldAutoMixVisualTransitionBusy()) return !!beatMapCache[key];
  if (!descriptor || !descriptor.proxyUrl || beatMapCache[key]) return !!beatMapCache[key];
  var map = await analyzeAudioBeats(descriptor.proxyUrl, null, analysisToken, {
    background: true,
    prefetch: true,
    cuefieldAutoMix: true,
    song: song
  });
  if (!map || !contextStillCurrent() || analysisToken !== beatMapToken) return false;
  beatMapCache[key] = map;
  if (typeof writeBeatDiskCache === 'function') await writeBeatDiskCache(key, map, song, 'cuefield');
  return true;
}

function initCuefieldAutoMix() {
  if (cuefieldAutoMix || !window.CuefieldAutoMix || typeof window.CuefieldAutoMix.createCuefieldAutoMix !== 'function') return cuefieldAutoMix;
  cuefieldAutoMix = window.CuefieldAutoMix.createCuefieldAutoMix({
    allowWeak: false,
    allowSafetyFallback: true,
    allowLiveEndCrossfadeFallback: true,
    minMixConfidence: 0.64,
    getKey: cuefieldSongKey,
    ensureBeatMap: ensureCuefieldAutoMixBeatMap,
    planTransition: async function (fromKey, toKey, context) {
      var fromSong = context && context.currentSong;
      var toSong = context && context.nextSong;
      var lyricPair = await Promise.all([
        cuefieldLyricTextForSong(fromSong, true),
        cuefieldLyricTextForSong(toSong, false)
      ]);
      return apiJson('/api/cuefield/transition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromKey: fromKey,
          toKey: toKey,
          fromLrc: lyricPair[0] || '',
          toLrc: lyricPair[1] || '',
          exitBias: 'late',
          maxEntryTime: 32,
          recentRecipes: cuefieldRecentRecipes.slice(-2),
          minimumListenUntil: context && context.minimumListenUntil,
          enableLiveEndCrossfadeFallback: true
        })
      });
    },
    prepareAudioUrl: cuefieldAutoMixAudioDescriptor
  });
  cuefieldAutoMix.setEnabled(cuefieldAutoMixEnabled);
  return cuefieldAutoMix;
}

function clearCuefieldAutoMixTimer() {
  if (cuefieldAutoMixPrepareTimer) clearTimeout(cuefieldAutoMixPrepareTimer);
  cuefieldAutoMixPrepareTimer = 0;
}

function clearCuefieldTimelineTimers() {
  while (cuefieldDelayWaiters.length) {
    var waiter = cuefieldDelayWaiters.pop();
    clearTimeout(waiter.timer);
    waiter.resolve(false);
  }
  cancelCuefieldMediaFade();
  cuefieldDeckVolumeSerial.A++;
  cuefieldDeckVolumeSerial.B++;
  if (cuefieldSourceLoopRuntime && cuefieldSourceLoopRuntime.stop) cuefieldSourceLoopRuntime.stop('timeline-clear', false);
  if (cuefieldBridgeEngine && cuefieldBridgeEngine.stop) cuefieldBridgeEngine.stop('timeline-clear');
}

function cancelCuefieldMediaFade() {
  cuefieldMediaFadeSerial++;
  if (cuefieldMediaFadeRaf) cancelAnimationFrame(cuefieldMediaFadeRaf);
  if (cuefieldMediaFadeTimer) clearInterval(cuefieldMediaFadeTimer);
  cuefieldMediaFadeRaf = 0;
  cuefieldMediaFadeTimer = 0;
  if (cuefieldPairFadeResolve) {
    var resolve = cuefieldPairFadeResolve;
    cuefieldPairFadeResolve = null;
    resolve(false);
  }
}

function claimCuefieldPreparedAudioForPlayback(media) {
  if (!media) return false;
  cancelCuefieldMediaFade();
  if (media.__mineradioPreparedAudioGraph) media.__mineradioPreparedAudioGraph.adopted = true;
  if (media === cuefieldAutoMixPreparedAudio) cuefieldAutoMixPreparedAudio = null;
  return true;
}

function disposeCuefieldPreparedAudioGraph(media) {
  var graph = media && media.__bhandsPreparedAudioGraph;
  if (!graph || graph.adopted) return;
  [graph.source, graph.filterNode, graph.bassNode, graph.midNode, graph.highNode,
    graph.analyser, graph.beatAnalyser, graph.gainNode, graph.echoSendNode,
    graph.echoDelayNode, graph.echoFeedbackNode, graph.echoWetNode].forEach(function (node) {
    try { if (node) node.disconnect(); } catch (_) { }
  });
  try { delete media.__bhandsPreparedAudioGraph; } catch (_) { }
}

function stopCuefieldPreparedAudio(media) {
  media = media || cuefieldAutoMixPreparedAudio;
  if (!media) return;
  // B deck 一旦成为主播放元素就不再属于 Cuefield，后续的清理绝不能暂停或卸载它。
  if (typeof audio !== 'undefined' && media === audio) {
    claimCuefieldPreparedAudioForPlayback(media);
    return;
  }
  disposeCuefieldPreparedAudioGraph(media);
  try { media.pause(); } catch (_) { }
  try { media.removeAttribute('src'); media.load(); } catch (_) { }
  if (media === cuefieldAutoMixPreparedAudio) cuefieldAutoMixPreparedAudio = null;
}

// fork 适配：等主 deck 真正起声后再停 B deck（fork 原生 handoff 的收尾步骤）。
// 主 deck 起声前由 B deck 持续出声，消掉 playQueueAt 加载/缓冲造成的衔接空隙；
// 超时兜底强停，防止 B deck 与主 deck 长时间双播。
function cuefieldWaitMainDeckAudible(preparedMedia, timeoutMs) {
  return new Promise(function (resolve) {
    var deadline = Date.now() + Math.max(200, Number(timeoutMs) || 1800);
    var finished = false;
    function finish() {
      if (finished) return;
      finished = true;
      clearInterval(timer);
      resolve(true);
    }
    function check() {
      if (finished) return;
      var mainAudible = typeof audio !== 'undefined' && audio && audio !== preparedMedia
        && !audio.paused && !audio.ended && audio.readyState >= 2 && !audio.error;
      if (mainAudible) {
        if (preparedMedia && preparedMedia !== audio) stopCuefieldPreparedAudio(preparedMedia);
        finish();
        return;
      }
      if (Date.now() >= deadline) {
        if (preparedMedia && preparedMedia !== audio) stopCuefieldPreparedAudio(preparedMedia);
        finish();
      }
    }
    var timer = setInterval(check, 60);
    check();
  });
}

function resetCuefieldAutoMix(reason, options) {
  options = options || {};
  var activeContext = cuefieldActiveTransitionContext;
  var shouldRestoreOutgoing = !!(
    activeContext
    && reason !== 'manual-pause'
    && reason !== 'manual-seek'
    && reason !== 'track-switch'
    && reason !== 'cuefield-handoff'
    && activeContext.outgoingToken === trackSwitchToken
    && activeContext.outgoingIndex === currentIdx
    && activeContext.outgoingMedia === audio
    && audio
    && !audio.paused
    && !audio.ended
  );
  cuefieldTransitionGeneration++;
  clearCuefieldAutoMixTimer();
  clearCuefieldTimelineTimers();
  if (!options.preserveExecution) cuefieldAutoMixExecuting = false;
  if (!options.preservePreparedAudio) stopCuefieldPreparedAudio();
  if (shouldRestoreOutgoing && typeof rampAudioOutputGain === 'function') rampAudioOutputGain(targetVolume, 120);
  if (!options.preserveExecution) cuefieldActiveTransitionContext = null;
  if (cuefieldAutoMix) cuefieldAutoMix.reset(reason || 'reset');
  updateCuefieldAutoMixUi(reason || 'idle');
}


function cuefieldAutoMixVisualTransitionBusy() {
  if (typeof isRenderInteractionActive === 'function' && isRenderInteractionActive()) return true;
  if (typeof colorMixTween !== 'undefined' && colorMixTween) return true;
  if (typeof coverDepthTween !== 'undefined' && coverDepthTween) return true;
  if (typeof loadingTween !== 'undefined' && loadingTween) return true;
  return false;
}

function cuefieldAutoMixBlockedByAlbumGapless(index) {
  return typeof albumGaplessQueueCanAdvance === 'function' && albumGaplessQueueCanAdvance(index);
}

function toggleCuefieldAutoMix() {
  cuefieldAutoMixEnabled = !cuefieldAutoMixEnabled;
  saveCuefieldAutoMixPreference();
  var runtime = initCuefieldAutoMix();
  if (runtime) runtime.setEnabled(cuefieldAutoMixEnabled);
  if (!cuefieldAutoMixEnabled) resetCuefieldAutoMix('disabled');
  updateCuefieldAutoMixUi(cuefieldAutoMixEnabled ? 'waiting' : 'disabled');
  showToast(cuefieldAutoMixEnabled ? 'Cuefield AutoMix 已开启：只在当前队列自动过渡' : 'Cuefield AutoMix 已关闭');
  if (cuefieldAutoMixEnabled) scheduleCuefieldAutoMixPrepare(trackSwitchToken, currentIdx, 720);
}

function scheduleCuefieldAutoMixPrepare(token, index, delay, attempt) {
  clearCuefieldAutoMixTimer();
  if (!cuefieldAutoMixEnabled || !audio || audio.paused || !playQueue || playQueue.length < 2) return false;
  var runtime = initCuefieldAutoMix();
  if (!runtime) return false;
  var currentIndex = isFinite(Number(index)) ? Math.round(Number(index)) : currentIdx;
  if (cuefieldAutoMixBlockedByAlbumGapless(currentIndex)) return false;
  var nextIndex = cuefieldAutoMixNextIndex(currentIndex);
  if (nextIndex < 0 || nextIndex === currentIndex) return false;
  updateCuefieldAutoMixUi('preparing');
  cuefieldAutoMixPrepareTimer = setTimeout(function () {
    cuefieldAutoMixPrepareTimer = 0;
    runCuefieldAutoMixPrepare(token, currentIndex, nextIndex, attempt || 0);
  }, Math.max(260, Number(delay) || 1200));
  return true;
}

async function runCuefieldAutoMixPrepare(token, currentIndex, nextIndex, attempt) {
  if (!cuefieldAutoMixEnabled || !cuefieldAutoMix || token !== trackSwitchToken || currentIndex !== currentIdx) return;
  if (cuefieldAutoMixBlockedByAlbumGapless(currentIndex)) return;
  if (cuefieldAutoMixVisualTransitionBusy()) {
    scheduleCuefieldAutoMixPrepare(token, currentIndex, 900, attempt || 0);
    return;
  }
  var currentSong = playQueue[currentIndex];
  var nextSong = playQueue[nextIndex];
  if (!currentSong || !nextSong) return;
  updateCuefieldAutoMixUi('preparing');
  var result = await cuefieldAutoMix.prepare({
    token: token,
    currentIndex: currentIndex,
    nextIndex: nextIndex,
    currentSong: currentSong,
    nextSong: nextSong,
    leadSec: 4,
      introBedLeadSec: 12
  });
  if (
    token !== trackSwitchToken
    || currentIndex !== currentIdx
    || !audio
    || audio.paused
    || cuefieldSongKey(playQueue[currentIndex]) !== cuefieldSongKey(currentSong)
    || cuefieldSongKey(playQueue[nextIndex]) !== cuefieldSongKey(nextSong)
  ) return;
  updateCuefieldAutoMixUi(result && result.status);
  if (result && result.status === 'ready' && result.pending) {
    prepareCuefieldPendingAudio(result.pending);
    showToast('Cuefield 已准备下一首过渡');
    return;
  }
  if (result && (result.status === 'waiting-beatmap' || result.status === 'missing-audio' || result.status === 'busy') && attempt < 3) {
    scheduleCuefieldAutoMixPrepare(token, currentIndex, 2600, attempt + 1);
  }
}

function cuefieldPendingDescriptor(pending) {
  var source = pending && pending.audioUrl;
  if (!source) return null;
  return typeof source === 'string' ? { proxyUrl: source, playbackData: { url: source } } : source;
}

function cuefieldTimelineExecution(pending) {
  var descriptor = cuefieldPendingDescriptor(pending);
  if (!pending || !descriptor) return null;
  if (window.CuefieldTimelineExecutor && typeof window.CuefieldTimelineExecutor.buildCuefieldTimelineExecution === 'function') {
    return window.CuefieldTimelineExecutor.buildCuefieldTimelineExecution({
      timeline: pending.timeline,
      entryTime: pending.entryTime,
      executionMode: pending.executionMode,
      targetVolume: targetVolume,
      mixStart: pending.mixStart,
      handoffAt: pending.handoffAt,
      audibleOverlap: pending.audibleOverlap,
      preRollDuration: pending.preRollDuration
    });
  }
  return { leadSec: 4, bStart: Math.max(0, Number(pending.entryTime) || 0), handoffDelayMs: 2600, actions: [] };
}

function cuefieldSetMediaTime(media, seconds) {
  if (!media) return;
  function setTime() {
    try { media.currentTime = Math.max(0, Number(seconds) || 0); } catch (_) { }
  }
  if (media.readyState >= 1) setTime();
  else media.addEventListener('loadedmetadata', setTime, { once: true });
}

function cuefieldCreatePreparedAudioGraph(media) {
  if (!media || media.__bhandsPreparedAudioGraph) return media && media.__bhandsPreparedAudioGraph || null;
  var graph = null;
  try {
    if ((!audioCtx || audioCtx.state === 'closed') && typeof initAudio === 'function') initAudio();
    if (!audioCtx || audioCtx.state === 'closed' || !audioCtx.createMediaElementSource) return null;
    graph = {
      context: audioCtx, source: null, filterNode: null, bassNode: null, midNode: null, highNode: null,
      analyser: null, beatAnalyser: null, gainNode: null, echoSendNode: null,
      echoDelayNode: null, echoFeedbackNode: null, echoWetNode: null, adopted: false
    };
    graph.source = audioCtx.createMediaElementSource(media);
    // media 元素接入 MediaElementSource 后无法再回到直出模式，立即打标：
    // 后续建链失败时可直接丢弃该元素，避免 B deck 静音。
    media.__bhandsMediaSourceBound = true;
    graph.analyser = audioCtx.createAnalyser();
    graph.beatAnalyser = audioCtx.createAnalyser();
    graph.gainNode = audioCtx.createGain();
    graph.filterNode = audioCtx.createBiquadFilter();
    graph.filterNode.type = 'highpass';
    graph.filterNode.frequency.value = 20;
    graph.bassNode = audioCtx.createBiquadFilter();
    graph.bassNode.type = 'lowshelf';
    graph.bassNode.frequency.value = 180;
    graph.bassNode.gain.value = 0;
    graph.midNode = audioCtx.createBiquadFilter();
    graph.midNode.type = 'peaking';
    graph.midNode.frequency.value = 1200;
    graph.midNode.Q.value = 0.72;
    graph.midNode.gain.value = 0;
    graph.highNode = audioCtx.createBiquadFilter();
    graph.highNode.type = 'highshelf';
    graph.highNode.frequency.value = 5200;
    graph.highNode.gain.value = 0;
    if (audioCtx.createDelay) {
      graph.echoSendNode = audioCtx.createGain();
      graph.echoDelayNode = audioCtx.createDelay(2);
      graph.echoFeedbackNode = audioCtx.createGain();
      graph.echoWetNode = audioCtx.createGain();
      graph.echoSendNode.gain.value = 0;
      graph.echoFeedbackNode.gain.value = 0;
      graph.echoWetNode.gain.value = 0;
    }
    graph.analyser.fftSize = typeof FFT_SIZE !== 'undefined' ? FFT_SIZE : 2048;
    graph.analyser.smoothingTimeConstant = 0.58;
    graph.beatAnalyser.fftSize = typeof BEAT_FFT_SIZE !== 'undefined' ? BEAT_FFT_SIZE : 1024;
    graph.beatAnalyser.smoothingTimeConstant = 0.10;
    graph.gainNode.gain.value = 0;
    graph.source.connect(graph.filterNode);
    graph.filterNode.connect(graph.bassNode);
    graph.bassNode.connect(graph.midNode);
    graph.midNode.connect(graph.highNode);
    graph.highNode.connect(graph.analyser);
    graph.source.connect(graph.beatAnalyser);
    graph.analyser.connect(graph.gainNode);
    graph.gainNode.connect(audioCtx.destination);
    if (graph.echoSendNode) {
      graph.highNode.connect(graph.echoSendNode);
      graph.echoSendNode.connect(graph.echoDelayNode);
      graph.echoDelayNode.connect(graph.echoFeedbackNode);
      graph.echoFeedbackNode.connect(graph.echoDelayNode);
      graph.echoDelayNode.connect(graph.echoWetNode);
      graph.echoWetNode.connect(audioCtx.destination);
    }
    media.__bhandsPreparedAudioGraph = graph;
    // fork 适配：B deck 出声依赖 audioCtx 处于 running 态，挂起状态自动恢复。
    try { if (audioCtx.state === 'suspended' && audioCtx.resume) audioCtx.resume(); } catch (_) { }
    return graph;
  } catch (error) {
    if (graph) {
      [graph.source, graph.filterNode, graph.bassNode, graph.midNode, graph.highNode,
        graph.analyser, graph.beatAnalyser, graph.gainNode, graph.echoSendNode,
        graph.echoDelayNode, graph.echoFeedbackNode, graph.echoWetNode].forEach(function (node) {
        try { if (node) node.disconnect(); } catch (_) { }
      });
    }
    if (media && media.__bhandsMediaSourceBound) media.__bhandsPreparedGraphFailed = true;
    try { delete media.__bhandsPreparedAudioGraph; } catch (_) { }
    console.warn('[CuefieldAutoMix] prepared audio graph fallback:', error && error.message || error);
    return null;
  }
}

function cuefieldWriteIncomingGain(media, value) {
  value = Math.max(0, Math.min(1, Number(value) || 0));
  var graph = media && media.__bhandsPreparedAudioGraph;
  if (graph && graph.gainNode) {
    try { graph.gainNode.gain.value = value; } catch (_) { }
    try { media.volume = 1; media.muted = false; } catch (_) { }
    return value;
  }
  try { media.volume = value; media.muted = false; } catch (_) { }
  return value;
}

function prepareCuefieldPendingAudio(pending) {
  var descriptor = cuefieldPendingDescriptor(pending);
  if (!descriptor || !descriptor.proxyUrl) return null;
  if (pending.preparedAudio && pending.preparedAudio.src) return pending.preparedAudio;
  stopCuefieldPreparedAudio();
  var execution = cuefieldTimelineExecution(pending);
  var media = new Audio();
  media.crossOrigin = 'anonymous';
  media.preload = 'auto';
  media.volume = 1;
  media.muted = false;
  cuefieldCreatePreparedAudioGraph(media);
  if (media.__bhandsPreparedGraphFailed) {
    try { media.pause(); media.removeAttribute('src'); media.load(); } catch (_) { }
    // 第一个元素已被失败 WebAudio source 永久占用，
    // 重建干净元素走直连音量兜底，避免 B deck 彻底无声。
    media = new Audio();
    media.crossOrigin = 'anonymous';
    media.preload = 'auto';
    media.volume = 1;
    media.muted = false;
  }
  cuefieldWriteIncomingGain(media, 0);
  media.src = descriptor.proxyUrl;
  cuefieldSetMediaTime(media, execution && execution.bStart);
  try { media.load(); } catch (_) { }
  pending.preparedAudio = media;
  pending.timelineExecution = execution;
  cuefieldAutoMixPreparedAudio = media;
  return media;
}

function cuefieldDelay(delayMs, generation) {
  return new Promise(function (resolve) {
    var waiter = {
      timer: 0,
      resolve: function (ok) {
        var index = cuefieldDelayWaiters.indexOf(waiter);
        if (index >= 0) cuefieldDelayWaiters.splice(index, 1);
        resolve(!!ok);
      }
    };
    waiter.timer = setTimeout(function () {
      waiter.resolve(generation === cuefieldTransitionGeneration);
    }, Math.max(0, Number(delayMs) || 0));
    cuefieldDelayWaiters.push(waiter);
  });
}

function cuefieldTransitionStillCurrent(pending, context) {
  if (!pending || !context || !cuefieldAutoMixEnabled) return false;
  if (context.generation !== cuefieldTransitionGeneration) return false;
  if (pending.token !== trackSwitchToken || pending.currentIndex !== currentIdx) return false;
  if (!context.outgoingMedia || audio !== context.outgoingMedia) return false;
  if (context.outgoingMedia.paused && !context.outgoingMedia.ended) return false;
  if (pending.fromKey && cuefieldSongKey(playQueue[pending.currentIndex]) !== pending.fromKey) return false;
  if (pending.toKey && cuefieldSongKey(playQueue[pending.nextIndex]) !== pending.toKey) return false;
  return true;
}



function cuefieldRampParam(param, value, durationMs) {
  if (!param) return false;
  value = Number(value);
  durationMs = Math.max(0, Number(durationMs) || 0);
  try {
    var ctx = param.context || audioCtx;
    var now = ctx && Number(ctx.currentTime) || 0;
    if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(now);
    else {
      if (param.cancelScheduledValues) param.cancelScheduledValues(now);
      if (param.setValueAtTime) param.setValueAtTime(Number(param.value) || 0, now);
    }
    if (durationMs && param.linearRampToValueAtTime) param.linearRampToValueAtTime(value, now + durationMs / 1000);
    else if (param.setValueAtTime) param.setValueAtTime(value, now);
    else param.value = value;
    return true;
  } catch (_) {
    try { param.value = value; return true; } catch (_) { return false; }
  }
}

function cuefieldVolumeCurveValue(curve, progress) {
  progress = Math.max(0, Math.min(1, Number(progress) || 0));
  if (curve === 'equal-power-in') return Math.sin(progress * Math.PI * 0.5);
  if (curve === 'equal-power-out') return Math.cos(progress * Math.PI * 0.5);
  if (curve === 'cubic-ease-in') return progress * progress * progress;
  if (curve === 'cubic-ease-out') return 1 - Math.pow(1 - progress, 3);
  return progress * progress * (3 - 2 * progress);
}

function cuefieldAnimateDeckVolume(deck, media, target, durationMs, curve, pending, context) {
  deck = deck === 'A' ? 'A' : 'B';
  var serial = ++cuefieldDeckVolumeSerial[deck];
  durationMs = Math.max(0, Number(durationMs) || 0);
  target = Math.max(0, Math.min(1, Number(target) || 0));
  var graph = media && media.__bhandsPreparedAudioGraph;
  var start = deck === 'A'
    ? (typeof currentAudioOutputGain === 'function' ? currentAudioOutputGain() : Number(targetVolume) || 0)
    : (graph && graph.gainNode ? Number(graph.gainNode.gain.value) || 0 : Number(media && media.volume) || 0);
  if (!durationMs) {
    if (deck === 'A' && typeof writeAudioOutputGain === 'function') writeAudioOutputGain(target);
    else cuefieldWriteIncomingGain(media, target);
    return;
  }
  var startedAt = performance.now();
  function tick(now) {
    if (serial !== cuefieldDeckVolumeSerial[deck] || !cuefieldTransitionStillCurrent(pending, context)) return;
    var progress = Math.max(0, Math.min(1, (now - startedAt) / durationMs));
    var shaped = cuefieldVolumeCurveValue(curve, progress);
    var value = curve === 'equal-power-out'
      ? target + (start - target) * shaped
      : start + (target - start) * shaped;
    if (deck === 'A' && typeof writeAudioOutputGain === 'function') writeAudioOutputGain(value);
    else cuefieldWriteIncomingGain(media, value);
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function cuefieldApplyGraphEcho(graph, action, pending, context) {
  if (!graph || !graph.echoSendNode || !graph.echoDelayNode || !graph.echoFeedbackNode || !graph.echoWetNode) return false;
  var duration = Math.max(0, Number(action.durationMs) || 0);
  if (action.enabled === false) {
    cuefieldRampParam(graph.echoSendNode.gain, 0, duration);
    var tailMs = Math.max(300, Math.min(4000, Number(action.tailMs) || 1200));
    var decayStart = (Number(graph.context && graph.context.currentTime) || 0) + tailMs / 1000;
    var decayEnd = decayStart + 0.32;
    try {
      graph.echoFeedbackNode.gain.setValueAtTime(graph.echoFeedbackNode.gain.value, decayStart);
      graph.echoFeedbackNode.gain.linearRampToValueAtTime(0, decayEnd);
      graph.echoWetNode.gain.setValueAtTime(graph.echoWetNode.gain.value, decayStart);
      graph.echoWetNode.gain.linearRampToValueAtTime(0, decayEnd);
    } catch (_) {
      cuefieldRampParam(graph.echoFeedbackNode.gain, 0, 320);
      cuefieldRampParam(graph.echoWetNode.gain, 0, 320);
    }
    return true;
  }
  var bpm = Math.max(40, Math.min(240, Number(action.bpm) || 120));
  cuefieldRampParam(graph.echoDelayNode.delayTime, Math.max(0.04, Math.min(1.5, 60 / bpm * (Number(action.delayBeats) || 0.5))), duration);
  cuefieldRampParam(graph.echoFeedbackNode.gain, Math.max(0, Math.min(0.72, Number(action.feedback) || 0)), duration);
  cuefieldRampParam(graph.echoWetNode.gain, Math.max(0, Math.min(0.5, Number(action.wet) || 0)), duration);
  cuefieldRampParam(graph.echoSendNode.gain, 1, duration);
  return true;
}

function cuefieldApplyGraphDuck(graph, action) {
  if (!graph || !graph.bassNode || !graph.bassNode.gain || !graph.context) return false;
  var bpm = Math.max(40, Math.min(240, Number(action.bpm) || 120));
  var pulseSec = 60 / bpm * Math.max(0.25, Number(action.beats) || 1);
  var pulses = Math.max(1, Math.min(16, Math.round(Number(action.pulses) || 4)));
  var param = graph.bassNode.gain;
  var baseDb = Number(param.value) || 0;
  var depthDb = Math.max(-24, baseDb - 12 * Math.max(0.08, Math.min(0.75, Number(action.depth) || 0.35)));
  var attack = Math.min(pulseSec * 0.22, Math.max(0.005, Number(action.attack) || 24) / 1000);
  var hold = Math.min(pulseSec * 0.3, Math.max(0.01, Number(action.hold) || 70) / 1000);
  var release = Math.min(pulseSec * 0.46, Math.max(0.04, Number(action.release) || 180) / 1000);
  var now = Number(graph.context.currentTime) || 0;
  try {
    if (param.cancelScheduledValues) param.cancelScheduledValues(now);
    for (var i = 0; i < pulses; i++) {
      var at = now + i * pulseSec;
      param.setValueAtTime(baseDb, at);
      param.linearRampToValueAtTime(depthDb, at + attack);
      param.setValueAtTime(depthDb, at + attack + hold);
      param.linearRampToValueAtTime(baseDb, at + attack + hold + release);
    }
    return true;
  } catch (_) { return false; }
}

function cuefieldInitSourceLoop() {
  if (!cuefieldSourceLoopRuntime && window.CuefieldSourceLoop && window.CuefieldSourceLoop.createCuefieldSourceLoop) {
    cuefieldSourceLoopRuntime = window.CuefieldSourceLoop.createCuefieldSourceLoop();
  }
  return cuefieldSourceLoopRuntime;
}

function cuefieldInitBridge() {
  if (!cuefieldBridgeEngine && window.CuefieldBridgeEngine && window.CuefieldBridgeEngine.createCuefieldBridgeEngine) {
    cuefieldBridgeEngine = window.CuefieldBridgeEngine.createCuefieldBridgeEngine();
  }
  return cuefieldBridgeEngine;
}

function cuefieldApplyTimelineAction(action, pending, nextMedia, context) {
  action = action || {};
  var graph = nextMedia && nextMedia.__bhandsPreparedAudioGraph;
  var deckMedia = action.deck === 'A' ? context.outgoingMedia : nextMedia;
  if (action.op === 'handoff') return Promise.resolve(true);
  if (action.op === 'play' && action.deck !== 'A') {
    if (!action.sourceZeroPreRoll && Math.abs((Number(nextMedia.currentTime) || 0) - Number(action.at || 0)) > 0.045) cuefieldSetMediaTime(nextMedia, action.at);
    return Promise.resolve(nextMedia.paused ? nextMedia.play() : true).then(function () { return true; }).catch(function () { return false; });
  }
  if (action.op === 'volume') {
    cuefieldAnimateDeckVolume(action.deck, nextMedia, action.target, action.durationMs, action.curve, pending, context);
    return Promise.resolve(true);
  }
  if (action.op === 'rate' && deckMedia) {
    try { deckMedia.playbackRate = Math.max(0.94, Math.min(1.06, Number(action.value) || 1)); return Promise.resolve(true); } catch (_) { return Promise.resolve(false); }
  }
  if (action.op === 'bridge') {
    var bridge = cuefieldInitBridge();
    var started = !!(bridge && bridge.start(action.bridge || pending.bridgePlan || {}, { audioContext: audioCtx }));
    pending.bridgeStarted = started;
    if (!started) pending.runtimeDowngrade = 'bridge-unavailable';
    return Promise.resolve(true);
  }
  if (action.op === 'loop') {
    var loop = cuefieldInitSourceLoop();
    var applied = !!(loop && loop.apply(action, deckMedia, pending.fromKey + '>' + pending.toKey));
    if (!applied) pending.runtimeDowngrade = 'source-loop-unavailable';
    return Promise.resolve(true);
  }
  if (action.deck === 'A') {
    pending.runtimeDowngrade = pending.runtimeDowngrade || ('outgoing-' + action.op + '-bypassed');
    return Promise.resolve(true);
  }
  if (!graph) {
    pending.runtimeDowngrade = pending.runtimeDowngrade || 'b-deck-graph-unavailable';
    return Promise.resolve(true);
  }
  if (action.op === 'filter') cuefieldRampParam(graph.filterNode && graph.filterNode.frequency, action.type === 'none' ? 20 : action.value, action.durationMs);
  else if (action.op === 'bass') cuefieldRampParam(graph.bassNode && graph.bassNode.gain, (Math.max(0, Math.min(1, Number(action.value) || 0)) - 1) * 18, action.durationMs);
  else if (action.op === 'spectrum') {
    cuefieldRampParam(graph.bassNode && graph.bassNode.gain, (Number(action.low) - 1) * 18, action.durationMs);
    cuefieldRampParam(graph.midNode && graph.midNode.gain, (Number(action.mid) - 1) * 18, action.durationMs);
    cuefieldRampParam(graph.highNode && graph.highNode.gain, (Number(action.high) - 1) * 18, action.durationMs);
  } else if (action.op === 'echo') cuefieldApplyGraphEcho(graph, action, pending, context);
  else if (action.op === 'duck') cuefieldApplyGraphDuck(graph, action);
  return Promise.resolve(true);
}

async function runCuefieldTimeline(pending, nextMedia, context) {
  var execution = pending.timelineExecution || cuefieldTimelineExecution(pending);
  if (!execution) return false;
  pending.timelineExecution = execution;
  clearCuefieldTimelineTimers();
  pending.executionFallback = nextMedia.__bhandsPreparedAudioGraph ? 'cuefield-timeline-graph' : 'volume-only-fallback';
  pending.actualMixStart = Number(context.outgoingMedia && context.outgoingMedia.currentTime) || 0;
  var actions = Array.isArray(execution.actions) ? execution.actions.slice() : [];
  var elapsedMs = 0;
  for (var i = 0; i < actions.length; i++) {
    var action = actions[i];
    var delayMs = Math.max(0, Number(action.delayMs) || 0);
    if (delayMs > elapsedMs && !await cuefieldDelay(delayMs - elapsedMs, context.generation)) return false;
    elapsedMs = delayMs;
    if (!cuefieldTransitionStillCurrent(pending, context)) return false;
    if (action.optionalWhenLate && Number(action.maxLateMs) >= 0 && performance.now() - (context.startedAt + delayMs) > Number(action.maxLateMs)) continue;
    if (!await cuefieldApplyTimelineAction(action, pending, nextMedia, context)) return false;
  }
  var handoffDelayMs = Math.max(0, Number(execution.handoffDelayMs) || elapsedMs);
  if (handoffDelayMs > elapsedMs && !await cuefieldDelay(handoffDelayMs - elapsedMs, context.generation)) return false;
  if (!cuefieldTransitionStillCurrent(pending, context) || nextMedia.paused || nextMedia.ended) return false;
  cuefieldWriteIncomingGain(nextMedia, Math.max(0, Math.min(1, Number(targetVolume) || 0)));
  if (typeof writeAudioOutputGain === 'function') writeAudioOutputGain(0);
  var finalGraph = nextMedia && nextMedia.__bhandsPreparedAudioGraph;
  if (finalGraph) {
    cuefieldRampParam(finalGraph.filterNode && finalGraph.filterNode.frequency, 20, 160);
    cuefieldRampParam(finalGraph.bassNode && finalGraph.bassNode.gain, 0, 160);
    cuefieldRampParam(finalGraph.midNode && finalGraph.midNode.gain, 0, 160);
    cuefieldRampParam(finalGraph.highNode && finalGraph.highNode.gain, 0, 160);
    cuefieldRampParam(finalGraph.echoSendNode && finalGraph.echoSendNode.gain, 0, 120);
    cuefieldRampParam(finalGraph.echoFeedbackNode && finalGraph.echoFeedbackNode.gain, 0, 160);
    cuefieldRampParam(finalGraph.echoWetNode && finalGraph.echoWetNode.gain, 0, 160);
  }
  try { nextMedia.playbackRate = 1; } catch (_) { }
  if (cuefieldSourceLoopRuntime && cuefieldSourceLoopRuntime.stop) cuefieldSourceLoopRuntime.stop('handoff', true);
  if (cuefieldBridgeEngine && cuefieldBridgeEngine.stop) cuefieldBridgeEngine.stop('handoff');
  return true;
}

function cuefieldFeedbackContext(pending) {
  var from = playQueue[pending.currentIndex] || {};
  var to = playQueue[pending.nextIndex] || {};
  var chosen = pending.plan && pending.plan.chosen || {};
  var evaluation = chosen.evaluation || {};
  return {
    pair: {
      fromKey: pending.fromKey,
      toKey: pending.toKey,
      fromTitle: from.name || from.title || '',
      fromArtist: from.artist || '',
      toTitle: to.name || to.title || '',
      toArtist: to.artist || ''
    },
    transition: {
      recipe: chosen.recipe || '',
      transitionRecipe: chosen.transitionRecipe || pending.executionMode || '',
      executionMode: pending.executionMode || '',
      tier: evaluation.tier || '',
      score: chosen.score,
      evalScore: evaluation.score,
      risks: evaluation.risks || [],
      exitTime: pending.exitTime,
      entryTime: pending.entryTime
    }
  };
}

function showCuefieldFeedback(context) {
  if (!context) return;
  cuefieldFeedbackState.context = context;
  cuefieldFeedbackState.submitted = false;
  var root = document.getElementById('cuefield-feedback');
  var meta = document.getElementById('cuefield-feedback-meta');
  if (meta) meta.textContent = (context.pair.fromTitle || '当前歌曲') + ' → ' + (context.pair.toTitle || '下一首');
  if (root) root.classList.add('show');
  if (cuefieldFeedbackState.timer) clearTimeout(cuefieldFeedbackState.timer);
  cuefieldFeedbackState.timer = setTimeout(function () { if (root) root.classList.remove('show'); }, 30000);
}

function submitCuefieldFeedback(rating) {
  rating = Number(rating);
  if (rating < 1 || rating > 3 || !cuefieldFeedbackState.context || cuefieldFeedbackState.submitted) return;
  cuefieldFeedbackState.submitted = true;
  apiJson('/api/cuefield/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ rating: rating }, cuefieldFeedbackState.context))
  }).then(function () {
    var root = document.getElementById('cuefield-feedback');
    if (root) root.classList.remove('show');
    showToast('Cuefield 评分已保存');
  }).catch(function () {
    cuefieldFeedbackState.submitted = false;
    showToast('Cuefield 评分保存失败');
  });
}

function tickCuefieldAutoMix() {
  if (!cuefieldAutoMixEnabled || !cuefieldAutoMix || cuefieldAutoMixExecuting || !audio) return;
  var nextIndex = cuefieldAutoMixNextIndex(currentIdx);
  var nextKey = nextIndex >= 0 ? cuefieldSongKey(playQueue[nextIndex]) : '';
  if (!cuefieldAutoMix.shouldTrigger({ token: trackSwitchToken, currentIndex: currentIdx, currentTime: audio.currentTime || 0, nextKey: nextKey })) return;
  var pending = cuefieldAutoMix.consumePending();
  if (pending) executeCuefieldAutoMix(pending);
}

function noteCuefieldAutoMixOutgoingEnded(media, token, index) {
  if (!media) return false;
  media.__bhandsCuefieldEndedDeferredToken = Number(token);
  media.__bhandsCuefieldEndedDeferredIndex = Number(index);
  return true;
}

function recoverCuefieldAutoMixEndedOutgoing(pending, context, reason) {
  var outgoing = context && context.outgoingMedia;
  var token = Number(context && context.outgoingToken);
  var index = Number(context && context.outgoingIndex);
  if (
    !outgoing
    || !outgoing.ended
    || !isFinite(token)
    || !isFinite(index)
    || trackSwitchToken !== token
    || currentIdx !== index
    || audio !== outgoing
  ) return false;
  if (outgoing.__bhandsCuefieldEndedRecoveryToken === token) return true;
  outgoing.__bhandsCuefieldEndedRecoveryToken = token;
  cuefieldAutoMixExecuting = false;
  if (cuefieldActiveTransitionContext === context) cuefieldActiveTransitionContext = null;
  updateCuefieldAutoMixUi(reason || 'fallback');
  if (
    playMode === 'single'
    && typeof restartSingleRepeatMedia === 'function'
    && restartSingleRepeatMedia(outgoing, token, index, 'cuefield-ended')
  ) return true;
  if (typeof finalizeListenSession === 'function') finalizeListenSession(true);
  setTimeout(function () {
    if (trackSwitchToken !== token || currentIdx !== index || audio !== outgoing) return;
    if (playMode === 'single') {
      playQueueAt(index, { autoRepeat: true, preserveHomeState: true });
    } else if (typeof nextTrack === 'function') {
      nextTrack();
    } else if (pending && isFinite(Number(pending.nextIndex))) {
      playQueueAt(Number(pending.nextIndex), { preserveHomeState: true });
    }
  }, 0);
  return true;
}

async function executeCuefieldAutoMix(pending) {
  if (!pending || cuefieldAutoMixExecuting || pending.token !== trackSwitchToken || pending.currentIndex !== currentIdx) return;
  if (cuefieldAutoMixBlockedByAlbumGapless(pending.currentIndex)) {
    stopCuefieldPreparedAudio(pending.preparedAudio);
    if (cuefieldAutoMix) cuefieldAutoMix.reset('album-gapless-priority');
    updateCuefieldAutoMixUi('waiting');
    return;
  }
  if (pending.fromKey && cuefieldSongKey(playQueue[pending.currentIndex]) !== pending.fromKey) return;
  if (pending.toKey && cuefieldSongKey(playQueue[pending.nextIndex]) !== pending.toKey) return;
  var transitionContext = {
    generation: ++cuefieldTransitionGeneration,
    startedAt: performance.now(),
    outgoingMedia: audio,
    outgoingToken: trackSwitchToken,
    outgoingIndex: currentIdx
  };
  cuefieldAutoMixExecuting = true;
  updateCuefieldAutoMixUi('handoff');
  var nextMedia = prepareCuefieldPendingAudio(pending);
  if (!nextMedia) {
    cuefieldAutoMixExecuting = false;
    updateCuefieldAutoMixUi('missing-audio');
    recoverCuefieldAutoMixEndedOutgoing(pending, transitionContext, 'missing-audio');
    return;
  }
  cuefieldActiveTransitionContext = transitionContext;
  try {
    cuefieldSetMediaTime(nextMedia, pending.timelineExecution && pending.timelineExecution.bStart);
    cuefieldWriteIncomingGain(nextMedia, 0);
    if (!cuefieldTransitionStillCurrent(pending, transitionContext)) {
      cuefieldAutoMixExecuting = false;
      stopCuefieldPreparedAudio(nextMedia);
      if (cuefieldActiveTransitionContext === transitionContext) cuefieldActiveTransitionContext = null;
      recoverCuefieldAutoMixEndedOutgoing(pending, transitionContext, 'fallback');
      return;
    }
    var execution = pending.timelineExecution || cuefieldTimelineExecution(pending);
    pending.timelineExecution = execution;
    var playAction = execution && Array.isArray(execution.actions)
      ? execution.actions.find(function (action) { return action && action.deck === 'B' && action.op === 'play'; })
      : null;
    if (!playAction || Number(playAction.delayMs) <= 40) await nextMedia.play();
  } catch (_) {
    cuefieldAutoMixExecuting = false;
    stopCuefieldPreparedAudio(nextMedia);
    if (cuefieldActiveTransitionContext === transitionContext) cuefieldActiveTransitionContext = null;
    updateCuefieldAutoMixUi('error');
    recoverCuefieldAutoMixEndedOutgoing(pending, transitionContext, 'error');
    showToast('Cuefield AutoMix：下一首预载失败');
    return;
  }
  var feedback = cuefieldFeedbackContext(pending);
  var handoffReady = await runCuefieldTimeline(pending, nextMedia, transitionContext);
  if (!handoffReady || !cuefieldTransitionStillCurrent(pending, transitionContext)) {
    cuefieldAutoMixExecuting = false;
    stopCuefieldPreparedAudio(nextMedia);
    if (
      transitionContext.generation === cuefieldTransitionGeneration
      && transitionContext.outgoingToken === trackSwitchToken
      && transitionContext.outgoingIndex === currentIdx
      && transitionContext.outgoingMedia === audio
      && audio
      && !audio.paused
      && !audio.ended
      && typeof rampAudioOutputGain === 'function'
    ) rampAudioOutputGain(targetVolume, 120);
    if (cuefieldActiveTransitionContext === transitionContext) cuefieldActiveTransitionContext = null;
    recoverCuefieldAutoMixEndedOutgoing(pending, transitionContext, 'fallback');
    return;
  }
  var handoffSucceeded = false;
  try {
    // ===== fork 原生 handoff =====
    // fork 没有 albumGapless/preloadedAudio 的 deck 接管机制，改为：
    // playQueueAt 正常切歌（fade:false 防二次淡入；cuefieldAutoMix 标记让 playQueueAt
    // 里的 reset 保持 preserve，不清掉正在交接的 B deck），B deck 持续出声填补
    // 主 deck 的加载空隙，主 deck 真正起声后再停 B deck。
    var handoffResult = await playQueueAt(pending.nextIndex, {
      preserveHomeState: true,
      fade: false,
      cuefieldAutoMix: true
    });
    handoffSucceeded = !!(handoffResult !== false && currentIdx === pending.nextIndex && audio && audio.src && typeof audio !== 'undefined');
    if (handoffSucceeded) {
      // fade:false 路径下 fork 会 restorePlaybackGain；这里再对齐一次，确保主 deck 正常音量起声
      if (typeof writeAudioOutputGain === 'function') writeAudioOutputGain(Math.max(0.0001, Number(targetVolume) || 0));
      await cuefieldWaitMainDeckAudible(nextMedia, 2400);
    }
    if (handoffSucceeded) {
      var chosen = pending.plan && pending.plan.chosen || {};
      var recipe = chosen.transitionRecipe || chosen.recipeCandidate && chosen.recipeCandidate.recipe || chosen.recipe || pending.executionMode;
      if (recipe) {
        cuefieldRecentRecipes.push(String(recipe));
        cuefieldRecentRecipes = cuefieldRecentRecipes.slice(-2);
      }
      showCuefieldFeedback(feedback);
    }
  } catch (err) {
    console.warn('[CuefieldAutoMix] handoff failed:', err);
    if (typeof writeAudioOutputGain === 'function') writeAudioOutputGain(targetVolume);
  } finally {
    if (!handoffSucceeded && typeof audio !== 'undefined' && audio !== nextMedia) stopCuefieldPreparedAudio(nextMedia);
    cuefieldAutoMixExecuting = false;
    if (cuefieldActiveTransitionContext === transitionContext) cuefieldActiveTransitionContext = null;
    updateCuefieldAutoMixUi(handoffSucceeded ? 'ready' : 'error');
    if (!handoffSucceeded) recoverCuefieldAutoMixEndedOutgoing(pending, transitionContext, 'error');
  }
}

cuefieldAutoMixEnabled = readCuefieldAutoMixPreference();
initCuefieldAutoMix();
updateCuefieldAutoMixUi(cuefieldAutoMixEnabled ? 'waiting' : 'disabled');
