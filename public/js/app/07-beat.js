'use strict';

// ============================================================
//  07-beat.js  —  节拍分析：离线预解析 / podcast DJ / 本地节拍
//  由 public/js/app/*.js 于 2026-09-24「按职责重排」生成（零逻辑改动）。
//  规则与验证见 docs/APP_REORG_PLAN.md 与 scripts/check-app-reorg.js。
// ============================================================



// ============================================================
//  06-beat.js  ←  源 main.js §18（基线 784afe6）
//  离线节拍预解析 v7.2
// ============================================================

// ============================================================
//  离线节拍预解析 (v7.2)
//    流程: fetch 完整音频 → OfflineAudioContext.decodeAudioData
//          → 低通滤波 (只保留 60-150Hz, 即 kick 频段)
//          → 短时能量曲线 → 自适应阈值检测峰值
//          → 输出 kick 时间戳数组 (单位: 秒)
//    优点: 完全规避人声干扰; 预先准备好节奏表
//    缺点: 每首歌首次要 1-3 秒
// ============================================================
function medianGap(times, minGap, maxGap) {
  if (!times || times.length < 2) return 0;
  var gaps = [];
  for (var i = 1; i < times.length; i++) {
    var gap = times[i] - times[i - 1];
    if (gap >= minGap && gap <= maxGap) gaps.push(gap);
  }
  gaps.sort(function(a,b){ return a - b; });
  return gaps.length ? gaps[Math.floor(gaps.length * 0.5)] : 0;
}

function normalizeMusicTempoBeats(times, duration) {
  if (!times || !times.length) return [];
  var sorted = times
    .filter(function(t){ return isFinite(t) && t >= 0.05 && (!duration || t < duration - 0.05); })
    .sort(function(a,b){ return a - b; });
  if (sorted.length < 4) return sorted;
  var gap = medianGap(sorted, 0.20, 1.20);
  var minMainGap = gap && gap < 0.42 ? Math.min(0.44, gap * 1.65) : 0.36;
  var out = [];
  var last = -10;
  for (var i = 0; i < sorted.length; i++) {
    if (sorted[i] - last >= minMainGap) {
      out.push(sorted[i]);
      last = sorted[i];
    }
  }
  return out;
}

function estimateTempoPhaseOffset(tempoBeats, beatCandidates, step, duration) {
  if (!tempoBeats || tempoBeats.length < 8 || !beatCandidates || beatCandidates.length < 4 || !step) return 0;
  var maxOffset = Math.min(0.26, Math.max(0.12, step * 0.58));
  var binSize = 0.025;
  var bins = {};
  var samples = [];
  var totalWeight = 0;
  var ti = 0;
  for (var i = 0; i < beatCandidates.length; i++) {
    var b = beatCandidates[i];
    if (!b || !isFinite(b.time)) continue;
    if (duration && (b.time < 1.0 || b.time > duration - 0.5)) continue;
    var strength = Math.max(0, Math.min(1, b.strength || 0));
    if (!b.camera && strength < 0.54) continue;
    if (b.low != null && b.low < 0.18 && strength < 0.66) continue;
    while (ti < tempoBeats.length - 1 && Math.abs(tempoBeats[ti + 1] - b.time) <= Math.abs(tempoBeats[ti] - b.time)) ti++;
    var base = tempoBeats[ti];
    var offset = b.time - base;
    if (!isFinite(offset) || Math.abs(offset) > maxOffset) continue;
    var weight = 0.20 + strength * strength * 1.35;
    if (b.primary) weight *= 1.35;
    if (b.camera) weight *= 1.18;
    if (b.mass != null) weight *= 0.82 + Math.max(0, Math.min(1, b.mass)) * 0.42;
    if (Math.abs(offset) < 0.025) weight *= 0.72;
    var key = Math.round(offset / binSize);
    bins[key] = (bins[key] || 0) + weight;
    samples.push({ offset: offset, weight: weight, key: key });
    totalWeight += weight;
  }
  if (samples.length < 4 || totalWeight <= 0) return 0;
  var bestKey = null;
  var bestWeight = 0;
  Object.keys(bins).forEach(function(k){
    var key = parseInt(k, 10);
    var w = (bins[key] || 0) + (bins[key - 1] || 0) * 0.72 + (bins[key + 1] || 0) * 0.72;
    if (w > bestWeight) {
      bestWeight = w;
      bestKey = key;
    }
  });
  if (bestKey == null || bestWeight < totalWeight * 0.26) return 0;
  var sum = 0;
  var wsum = 0;
  for (var si = 0; si < samples.length; si++) {
    var s = samples[si];
    if (Math.abs(s.key - bestKey) <= 1) {
      sum += s.offset * s.weight;
      wsum += s.weight;
    }
  }
  if (wsum <= 0) return 0;
  var offsetOut = sum / wsum;
  return Math.abs(offsetOut) >= 0.045 ? Math.max(-maxOffset, Math.min(maxOffset, offsetOut)) : 0;
}

var musicTempoWorkerUrl = null;
function getMusicTempoWorkerUrl() {
  if (musicTempoWorkerUrl) return musicTempoWorkerUrl;
  var code = [
    'self.onmessage=function(e){',
    'var d=e.data||{};',
    'try{',
    'importScripts(d.scriptUrl||"/vendor/music-tempo.min.js");',
    'var C=self.MusicTempo||(typeof MusicTempo!=="undefined"?MusicTempo:null);',
    'if(!C)throw new Error("MusicTempo unavailable");',
    'var mono=new Float32Array(d.mono);',
    'var mt=new C(mono,{bufferSize:2048,hopSize:Math.max(128,Math.round(d.sampleRate*0.010)),timeStep:0.010,minBeatInterval:0.36,maxBeatInterval:0.95,expiryTime:8});',
    'self.postMessage({ok:true,tempo:mt.tempo||0,beats:mt.beats||[]});',
    '}catch(err){self.postMessage({ok:false,error:(err&&err.message)||String(err)});}',
    '};'
  ].join('');
  musicTempoWorkerUrl = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
  return musicTempoWorkerUrl;
}

async function analyzeMusicTempoInWorker(buffer, token) {
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined') return null;
  try {
    showBeatChip('后台锁定电影主拍…');
    await yieldToIdle(isHiddenForBackgroundOptimization() ? 20 : 180);
    if (token !== beatMapToken) return null;
    var channels = buffer.numberOfChannels;
    var len = buffer.length;
    var mono = new Float32Array(len);
    var chDataList = [];
    for (var ch = 0; ch < channels; ch++) chDataList.push(buffer.getChannelData(ch));
    var chScale = 1 / Math.max(1, channels);
    var monoChunk = Math.max(4096, Math.floor(buffer.sampleRate * 0.70));
    for (var monoStart = 0; monoStart < len; monoStart += monoChunk) {
      var monoEnd = Math.min(len, monoStart + monoChunk);
      for (var mi = monoStart; mi < monoEnd; mi++) {
        var sum = 0;
        for (var ci = 0; ci < channels; ci++) sum += chDataList[ci][mi] * chScale;
        mono[mi] = sum;
      }
      if ((monoStart / monoChunk) % 2 === 1) {
        await yieldToIdle(isHiddenForBackgroundOptimization() ? 10 : 60);
        if (token !== beatMapToken) return null;
      }
    }
    var worker = new Worker(getMusicTempoWorkerUrl());
    return await new Promise(function(resolve) {
      var done = false;
      var timer = setTimeout(function(){
        if (done) return;
        done = true;
        worker.terminate();
        resolve(null);
      }, 16000);
      worker.onmessage = function(ev) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        worker.terminate();
        var data = ev.data || {};
        if (!data.ok) {
          console.warn('music-tempo worker failed:', data.error);
          resolve(null);
          return;
        }
        resolve(data);
      };
      worker.onerror = function(err) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        worker.terminate();
        console.warn('music-tempo worker error:', err && err.message ? err.message : err);
        resolve(null);
      };
      worker.postMessage({
        mono: mono.buffer,
        sampleRate: buffer.sampleRate,
        scriptUrl: location.origin + '/vendor/music-tempo.min.js'
      }, [mono.buffer]);
    });
  } catch (err) {
    console.warn('music-tempo worker setup failed:', err);
    return null;
  }
}

function scheduleBeatAnalysis(songId, audioUrl, token, song) {
  if (!songId || !audioUrl) return;
  if (djMode.active) {
    cancelBeatAnalysisTimer();
    beatAnalysisStartedAt = 0;
    hideBeatChip();
    return;
  }
  cancelBeatAnalysisTimer();
  beatAnalysisStartedAt = 0;
  hideBeatChip();
  beatAnalysisTimer = setTimeout(function waitForQuietStart(){
    beatAnalysisTimer = null;
    if (token !== beatMapToken || !audio || audio.paused) return;
    var current = audio.currentTime || 0;
    if (current < beatAnalysisConfig.minPlaybackSec) {
      beatAnalysisTimer = setTimeout(waitForQuietStart, Math.max(500, (beatAnalysisConfig.minPlaybackSec - current) * 1000));
      return;
    }
    var startAnalysis = async function(){
      if (token !== beatMapToken || !audio || audio.paused || beatMapCache[songId]) return;
      var diskMap = await readBeatDiskCache(songId);
      if (diskMap) {
        applyBeatMapCacheForCurrent(songId, diskMap, token, 'D盘节拍缓存命中:');
        return;
      }
      if (token !== beatMapToken || !audio || audio.paused || beatMapCache[songId]) return;
      if (beatMapBusy) {
        beatAnalysisTimer = setTimeout(function(){
          beatAnalysisTimer = null;
          scheduleAnalysisTask(startAnalysis, 260);
        }, 420);
        return;
      }
      beatAnalysisStartedAt = performance.now();
      analyzeAudioBeats(audioUrl, null, token, {
        skipMusicTempo: beatAnalysisConfig.skipMusicTempoWhilePlaying && !audio.paused,
        background: true,
        song: song || null
      }).then(function(map){
        if (token !== beatMapToken || !map) return;
        smoothBeatMapHandoff(songId, map, token, song || null);
      }).catch(function(err){
        console.warn('scheduled beat analysis failed:', err);
        hideBeatChip();
      });
    };
    scheduleAnalysisTask(startAnalysis, beatAnalysisConfig.idleTimeout);
  }, beatAnalysisConfig.delayMs);
}

function beatMapSongKey(song) {
  if (!song) return '';
  if (song.type === 'local' && song.localKey) return 'local:' + song.localKey;
  if (songProviderKey(song) === 'qq') return 'qq:' + (song.mid || song.songmid || song.id || (song.name + '|' + song.artist));
  if (song.id != null && song.id !== '') return 'song:' + song.id;
  return '';
}

function localBeatDiskKey(localKey, mode) {
  if (!localKey) return '';
  return 'local:' + localKey + ':' + (mode === 'dj' ? 'dj' : 'mr');
}

function updateBeatDiskCacheStatus(data) {
  if (!data) return;
  beatDiskCacheStatus.checked = true;
  beatDiskCacheStatus.enabled = !!data.enabled || data.mode === 'disk';
  beatDiskCacheStatus.mode = data.mode || (beatDiskCacheStatus.enabled ? 'disk' : 'memory-only');
  beatDiskCacheStatus.reason = data.reason || '';
  if (!beatDiskCacheStatus.enabled && !beatDiskCacheNoticeLogged) {
    beatDiskCacheNoticeLogged = true;
    console.log('节拍磁盘缓存不可用，已降级为本次运行内存缓存:', beatDiskCacheStatus.reason || 'unknown');
  }
}

async function ensureBeatDiskCacheStatus() {
  if (beatDiskCacheStatus.checked) return beatDiskCacheStatus;
  try {
    updateBeatDiskCacheStatus(await apiJson('/api/beatmap/cache/status?t=' + Date.now()));
  } catch (e) {
    updateBeatDiskCacheStatus({ enabled:false, mode:'memory-only', reason:'STATUS_FAILED' });
  }
  return beatDiskCacheStatus;
}

async function readBeatDiskCache(key) {
  if (!key || beatMapCache[key]) return beatMapCache[key] || null;
  var st = await ensureBeatDiskCacheStatus();
  if (!st.enabled) return null;
  try {
    var r = await apiJson('/api/beatmap/cache?key=' + encodeURIComponent(key) + '&t=' + Date.now());
    if (r && r.enabled === false) updateBeatDiskCacheStatus(r);
    if (!r || !r.hit || !r.map) return null;
    var map = unpackLocalBeatMap(r.map);
    if (!map) return null;
    beatMapCache[key] = map;
    return map;
  } catch (e) {
    console.warn('beat disk cache read failed:', e);
    return null;
  }
}

async function writeBeatDiskCache(key, map, song, mode) {
  if (!key || !map) return false;
  var st = await ensureBeatDiskCacheStatus();
  if (!st.enabled) return false;
  try {
    var packed = packLocalBeatMap(map);
    if (!packed) return false;
    var r = await apiJson('/api/beatmap/cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: key,
        mode: mode || 'mr',
        provider: songProviderKey(song),
        title: song && song.name,
        artist: song && song.artist,
        map: packed
      })
    });
    if (r && r.enabled === false) updateBeatDiskCacheStatus(r);
    return !!(r && r.ok);
  } catch (e) {
    console.warn('beat disk cache write failed:', e);
    return false;
  }
}

function isBeatPrefetchCandidate(song) {
  if (!song || isPodcastSong(song) || song.type === 'local' || song.localUrl) return false;
  return !!beatMapSongKey(song);
}

function findNextBeatPrefetchIndex(fromIdx, seen) {
  if (!playQueue.length) return -1;
  seen = seen || {};
  var total = playQueue.length;
  for (var step = 1; step < total; step++) {
    var idx = (fromIdx + step + total) % total;
    if (idx === currentIdx) continue;
    var song = playQueue[idx];
    if (!isBeatPrefetchCandidate(song)) continue;
    var key = beatMapSongKey(song);
    if (!key || beatMapCache[key] || seen[key]) continue;
    return idx;
  }
  return -1;
}

function normalizeBeatPrefetchState(state) {
  state = state || {};
  return {
    keys: Object.assign({}, state.keys || state),
    count: Math.max(0, Number(state.count) || 0)
  };
}

async function fetchBeatPrefetchAudioUrl(song) {
  if (!song) return null;
  var isQQ = songProviderKey(song) === 'qq';
  var requestedQuality = normalizePlaybackQuality(playbackQuality);
  if (!isQQ && requestedQuality === 'jymaster' && !hasProviderSvip('netease', loginStatus)) requestedQuality = 'hires';
  if (isQQ && qqPlaybackQualityCeiling && (requestedQuality === 'jymaster' || requestedQuality === 'hires' || requestedQuality === 'lossless')) requestedQuality = qqPlaybackQualityCeiling;
  var qualityParam = '&quality=' + encodeURIComponent(requestedQuality);
  var data = isQQ
    ? await apiJson('/api/qq/song/url?mid=' + encodeURIComponent(song.mid || song.songmid || song.id || '') + '&mediaMid=' + encodeURIComponent(song.mediaMid || song.media_mid || '') + qualityParam)
    : await apiJson('/api/song/url?id=' + encodeURIComponent(song.id) + qualityParam);
  if (!data || !data.url || data.trial) return null;
  return '/api/audio?url=' + encodeURIComponent(data.url);
}

function scheduleQueueBeatPrefetch(fromIdx, delayMs, state) {
  cancelBeatPrefetchTimer();
  if (!playQueue.length || beatPrefetchBusy || localBeatAnalysis.active) return;
  var prefetchState = normalizeBeatPrefetchState(state);
  if (prefetchState.count >= BEAT_PREFETCH_LIMIT) return;
  var token = beatMapToken;
  var seq = ++beatPrefetchToken;
  var startIdx = isFinite(fromIdx) ? fromIdx : currentIdx;
  var waitMs = delayMs == null ? 1800 : delayMs;
  if (typeof isRenderInteractionActive === 'function' && isRenderInteractionActive()) waitMs = Math.max(waitMs, 2200);
  beatPrefetchTimer = setTimeout(function(){
    beatPrefetchTimer = null;
    runQueueBeatPrefetch(startIdx, token, seq, prefetchState);
  }, waitMs);
}

async function runQueueBeatPrefetch(fromIdx, token, seq, state) {
  if (token !== beatMapToken || seq !== beatPrefetchToken || beatPrefetchBusy || !playQueue.length) return;
  if (audio && audio.paused) return;
  state = normalizeBeatPrefetchState(state);
  if (state.count >= BEAT_PREFETCH_LIMIT) return;
  var idx = findNextBeatPrefetchIndex(fromIdx, state.keys);
  if (idx < 0) return;
  var song = hydrateCustomCover(playQueue[idx]);
  var key = beatMapSongKey(song);
  if (!key) return;
  state.keys[key] = true;
  state.count++;
  beatPrefetchBusy = true;
  beatPrefetchLastKey = key;
  try {
    if (token !== beatMapToken || seq !== beatPrefetchToken) return;
    var diskMap = await readBeatDiskCache(key);
    if (diskMap) {
      console.log('队列节奏D盘缓存命中:', song.name || key, diskMap.visualBeatCount || 0);
      return;
    }
    var audioUrl = await fetchBeatPrefetchAudioUrl(song);
    if (token !== beatMapToken || seq !== beatPrefetchToken || !audioUrl || beatMapCache[key]) return;
    while (typeof isRenderInteractionActive === 'function' && isRenderInteractionActive() && token === beatMapToken && seq === beatPrefetchToken) {
      await yieldToIdle(isHiddenForBackgroundOptimization() ? 30 : 320);
    }
    if (token !== beatMapToken || seq !== beatPrefetchToken || beatMapCache[key]) return;
    while (beatMapBusy && token === beatMapToken && seq === beatPrefetchToken) {
      await yieldToIdle(isHiddenForBackgroundOptimization() ? 30 : 240);
    }
    if (token !== beatMapToken || seq !== beatPrefetchToken || beatMapCache[key]) return;
    var map = await analyzeAudioBeats(audioUrl, null, token, {
      background: true,
      prefetch: true,
      song: song
    });
    if (token !== beatMapToken || seq !== beatPrefetchToken || !map) return;
    beatMapCache[key] = map;
    writeBeatDiskCache(key, map, song, 'mr');
    console.log('队列节奏预热完成:', song.name || key, map.visualBeatCount || 0);
  } catch (err) {
    console.warn('queue beat prefetch failed:', err && err.message ? err.message : err);
  } finally {
    beatPrefetchBusy = false;
    if (state.count < BEAT_PREFETCH_LIMIT && token === beatMapToken && seq === beatPrefetchToken && playQueue.length && !(audio && audio.paused)) {
      scheduleQueueBeatPrefetch(idx, 1600, state);
    }
  }
}

async function analyzeAudioBeats(audioUrl, durationSec, token, options) {
  options = options || {};
  var analysisProfile = cinemaAnalysisProfileForSong(options.song);
  var softGrooveAnalysis = !!(analysisProfile && analysisProfile.softGroove);
  try {
    beatMapBusy = true;
    if (options.prefetch) showBeatChip('预热下一首节奏…');
    else if (options.background) showBeatChip('后台缓冲节奏…');
    await yieldToIdle(beatAnalysisYieldMs(options, 140, 760));
    if (token !== beatMapToken) { hideBeatChip(); beatMapBusy = false; return null; }
    showBeatChip('正在分析节奏…');
    var resp = await fetch(audioUrl);
    if (token !== beatMapToken) { hideBeatChip(); return null; }
    var ab = await resp.arrayBuffer();
    if (token !== beatMapToken) { hideBeatChip(); return null; }

    // 用临时 AudioContext 解码 (我们不能复用 audioCtx 因为它可能 closed)
    var TmpCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!TmpCtx) { hideBeatChip(); return null; }
    var DecodeCtx = window.AudioContext || window.webkitAudioContext;
    var dc = new DecodeCtx();
    var buffer = await new Promise(function(resolve, reject){
      dc.decodeAudioData(ab.slice(0), resolve, reject);
    }).catch(function(e){ console.warn('decode failed:', e); return null; });
    dc.close && dc.close();
    if (!buffer) { hideBeatChip(); return null; }
    if (token !== beatMapToken) { hideBeatChip(); return null; }

    var musicTempoBeats = [];
    var musicTempoGridStep = 0;
    var musicTempoTask = options.skipMusicTempo ? Promise.resolve(null) : analyzeMusicTempoInWorker(buffer, token);

    // 用 OfflineAudioContext 分离低频重鼓 / 中频鼓身 / 高频敲击感.
    var sr = buffer.sampleRate;
    async function renderBand(hpFreq, lpFreq) {
      var off = new TmpCtx(1, buffer.length, sr);
      var src = off.createBufferSource(); src.buffer = buffer;
      var node = src;
      if (hpFreq) {
        var hp = off.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = Math.min(hpFreq, sr * 0.45);
        hp.Q.value = 0.85;
        node.connect(hp);
        node = hp;
      }
      if (lpFreq) {
        var lp = off.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = Math.min(lpFreq, sr * 0.45);
        lp.Q.value = 0.9;
        node.connect(lp);
        node = lp;
      }
      node.connect(off.destination);
      src.start(0);
      var renderedBand = await off.startRendering();
      if (token !== beatMapToken) return null;
      await yieldToIdle(beatAnalysisYieldMs(options, 110, 620));
      return renderedBand.getChannelData(0);
    }
    var bands = [];
    bands.push(await renderBand(38, 155));
    if (token !== beatMapToken || !bands[0]) { hideBeatChip(); return null; }
    bands.push(await renderBand(130, 420));
    if (token !== beatMapToken || !bands[1]) { hideBeatChip(); return null; }
    bands.push(await renderBand(420, 2600));
    if (token !== beatMapToken || !bands[2]) { hideBeatChip(); return null; }
    bands.push(await renderBand(1800, 9000));
    if (token !== beatMapToken) { hideBeatChip(); return null; }
    var lowPcm = bands[0];
    var bodyPcm = bands[1];
    var vocalPcm = bands[2];
    var snapPcm = bands[3];

    // 帧化能量 (10ms 窗口)
    var winSize = Math.floor(sr * 0.010);
    async function makeFrameEnergy(pcm) {
      var frames = Math.floor(pcm.length / winSize);
      var out = new Float32Array(frames);
      for (var f = 0; f < frames; f++) {
        var s = 0;
        var off2 = f * winSize;
        for (var i = 0; i < winSize; i++) {
          var v = pcm[off2 + i];
          s += v * v;
        }
        out[f] = Math.sqrt(s / winSize);
        if (f > 0 && f % 520 === 0) {
          await yieldToPaint();
          if (token !== beatMapToken) return null;
        }
      }
      return out;
    }
    var frameBands = [];
    frameBands.push(await makeFrameEnergy(lowPcm));
    await yieldToIdle(beatAnalysisYieldMs(options, 90, 520));
    frameBands.push(await makeFrameEnergy(bodyPcm));
    await yieldToIdle(beatAnalysisYieldMs(options, 90, 520));
    frameBands.push(await makeFrameEnergy(vocalPcm));
    await yieldToIdle(beatAnalysisYieldMs(options, 90, 520));
    frameBands.push(await makeFrameEnergy(snapPcm));
    if (token !== beatMapToken || !frameBands[0] || !frameBands[1] || !frameBands[2] || !frameBands[3]) { hideBeatChip(); return null; }
    var energy = frameBands[0];
    var bodyEnergy = frameBands[1];
    var vocalEnergy = frameBands[2];
    var snapEnergy = frameBands[3];
    var nFrames = Math.min(energy.length, bodyEnergy.length, vocalEnergy.length, snapEnergy.length);
    function percentile(arr, p) {
      var copy = Array.prototype.slice.call(arr).sort(function(a,b){ return a-b; });
      return copy.length ? copy[Math.floor(copy.length * p)] : 0.001;
    }
    function bandAt(arr, f) {
      var a = arr[Math.max(0, f - 1)] || 0;
      var b = arr[f] || 0;
      var c = arr[Math.min(nFrames - 1, f + 1)] || 0;
      return (a + b * 2 + c) * 0.25;
    }
    var lowRef = Math.max(0.0008, percentile(energy, 0.86));
    var bodyRef = Math.max(0.0008, percentile(bodyEnergy, 0.86));
    var vocalRef = Math.max(0.0008, percentile(vocalEnergy, 0.86));
    var snapRef = Math.max(0.0008, percentile(snapEnergy, 0.86));

    // 计算 onset (能量正向差分), 然后取峰
    function makeOnset(arr) {
      var out = new Float32Array(nFrames);
      for (var oi = 1; oi < nFrames; oi++) {
        out[oi] = Math.max(0, arr[oi] - arr[oi - 1]);
      }
      return out;
    }
    var onset = makeOnset(energy);
    var bodyOnset = makeOnset(bodyEnergy);
    var vocalOnset = makeOnset(vocalEnergy);
    var snapOnset = makeOnset(snapEnergy);
    var lowOnsetRef = Math.max(0.00025, percentile(onset, 0.88));
    var bodyOnsetRef = Math.max(0.00025, percentile(bodyOnset, 0.88));
    var vocalOnsetRef = Math.max(0.00025, percentile(vocalOnset, 0.88));
    var snapOnsetRef = Math.max(0.00025, percentile(snapOnset, 0.88));

    function softGrooveFrameScore(frame) {
      var sf = Math.max(0, Math.min(nFrames - 1, Math.round(frame)));
      var lowTone = Math.min(2.2, bandAt(energy, sf) / lowRef);
      var bodyTone = Math.min(2.2, bandAt(bodyEnergy, sf) / bodyRef);
      var vocalTone = Math.min(2.2, bandAt(vocalEnergy, sf) / vocalRef);
      var snapTone = Math.min(2.2, bandAt(snapEnergy, sf) / snapRef);
      var lowRise = Math.min(2.6, (onset[sf] || 0) / lowOnsetRef);
      var bodyRise = Math.min(2.6, (bodyOnset[sf] || 0) / bodyOnsetRef);
      var vocalRise = Math.min(2.6, (vocalOnset[sf] || 0) / vocalOnsetRef);
      var snapRise = Math.min(2.6, (snapOnset[sf] || 0) / snapOnsetRef);
      var drumRise = lowRise * 0.52 + bodyRise * 0.42 + snapRise * 0.08;
      var drumTone = lowTone * 0.24 + bodyTone * 0.22 + snapTone * 0.05;
      var vocalLeak = Math.max(0, vocalRise + vocalTone * 0.30 - (lowRise + bodyRise) * 0.54 - 0.18);
      return Math.max(0, drumRise + drumTone - vocalLeak * 0.18);
    }

    function bestSoftGrooveFrameNear(time, radiusSec) {
      var center = Math.max(0, Math.min(nFrames - 1, Math.round(time / 0.010)));
      var radius = Math.max(1, Math.round(Math.max(0.010, radiusSec || 0.040) / 0.010));
      var base = softGrooveFrameScore(center);
      var bestFrame = center;
      var bestScore = base;
      for (var sf = Math.max(0, center - radius); sf <= Math.min(nFrames - 1, center + radius); sf++) {
        var dist = Math.abs(sf - center) / Math.max(1, radius);
        var score = softGrooveFrameScore(sf) * (1 - dist * 0.16);
        if (score > bestScore) {
          bestScore = score;
          bestFrame = sf;
        }
      }
      return { frame: bestFrame, time: bestFrame * 0.010, score: bestScore, base: base };
    }

    function scoreSoftGrooveTempoOffset(times, offset, step) {
      if (!times || !times.length) return 0;
      var total = 0;
      var weightTotal = 0;
      var localRadius = Math.min(0.026, Math.max(0.014, (step || 0.55) * 0.045));
      var stride = times.length > 720 ? 2 : 1;
      for (var si = 0; si < times.length; si += stride) {
        var t = times[si] + offset;
        if (!isFinite(t) || t < 1.0 || t > buffer.duration - 0.40) continue;
        var slot = si % 4;
        var slotWeight = slot === 0 ? 1.22 : (slot === 2 ? 1.06 : 0.88);
        var point = bestSoftGrooveFrameNear(t, localRadius);
        total += point.score * slotWeight;
        weightTotal += slotWeight;
      }
      return weightTotal > 0 ? total / weightTotal : 0;
    }

    function estimateSoftGrooveTempoOffset(times, step) {
      if (!softGrooveAnalysis || !times || times.length < 8 || !step) return 0;
      var maxOffset = Math.min(0.20, Math.max(0.075, step * 0.32));
      var baseScore = scoreSoftGrooveTempoOffset(times, 0, step);
      var bestOffset = 0;
      var bestScore = baseScore;
      for (var off = -maxOffset; off <= maxOffset + 0.0001; off += 0.010) {
        var score = scoreSoftGrooveTempoOffset(times, off, step);
        if (score > bestScore) {
          bestScore = score;
          bestOffset = off;
        }
      }
      if (Math.abs(bestOffset) < 0.014) return 0;
      return bestScore > baseScore * 1.055 ? Math.max(-maxOffset, Math.min(maxOffset, bestOffset)) : 0;
    }

    function refineSoftGrooveBeatTime(time, step) {
      if (!softGrooveAnalysis || !analysisProfile.localRefine) return { time: time, score: 0, base: 0 };
      var radius = Math.min(0.058, Math.max(0.024, (step || 0.55) * 0.095));
      var point = bestSoftGrooveFrameNear(time, radius);
      if (Math.abs(point.time - time) < 0.011) return { time: time, score: point.score, base: point.base };
      if (point.score < point.base * 1.045) return { time: time, score: point.score, base: point.base };
      return { time: point.time, score: point.score, base: point.base };
    }

    function thinSoftGrooveCameraBeats(events, step, duration) {
      if (!analysisProfile.sparseCamera || !events || events.length < 6) return events || [];
      step = Math.max(0.001, step || medianGap(events.map(function(b){ return b.time; }), 0.30, 1.20) || 0.82);
      function moodScore(b) {
        if (!b) return 0;
        return (b.grooveEvidence || 0) * 0.56 + (b.impact || 0) * 0.34 + (b.strength || 0) * 0.18 + (b.low || 0) * 0.10 + (b.body || 0) * 0.08;
      }
      function eventPercentile(rows, p) {
        var vals = rows.map(function(row){ return row.score; }).sort(function(a,b){ return a-b; });
        return vals.length ? vals[Math.min(vals.length - 1, Math.floor(vals.length * p))] : 0;
      }
      function medianNumber(vals) {
        vals = vals.filter(function(v){ return isFinite(v); }).sort(function(a,b){ return a-b; });
        return vals.length ? vals[Math.floor(vals.length * 0.5)] : 0;
      }
      function cloneSparseBeat(b, score, accent, tag) {
        var out = Object.assign({}, b);
        out.primary = true;
        out.camera = true;
        out.pulse = true;
        out.sparse = true;
        out.tone = tag || 'sunset-groove';
        out.impact = clampRange((out.impact || out.strength || 0.30) * (accent ? 0.76 : 0.66) + score * 0.07, 0.18, accent ? 0.58 : 0.50);
        out.strength = clampRange((out.strength || 0.34) * (accent ? 0.76 : 0.68) + score * 0.055, 0.30, accent ? 0.64 : 0.56);
        out.mass = clampRange((out.mass || 0.48) * 0.78, 0.28, 0.60);
        out.sharpness = clampRange((out.sharpness || 0.10) * 0.66, 0.05, 0.32);
        out._sparseScore = score;
        return out;
      }
      function findBestEventNear(time, radius) {
        var best = null;
        var bestScore = -1;
        radius = radius || 0.20;
        for (var i = 0; i < events.length; i++) {
          var b = events[i];
          if (!b || !isFinite(b.time)) continue;
          var dist = Math.abs(b.time - time);
          if (dist > radius) continue;
          var score = moodScore(b) * (1 - dist / radius * 0.18);
          if (score > bestScore) {
            best = b;
            bestScore = score;
          }
        }
        return best ? { beat: best, score: Math.max(0, bestScore) } : null;
      }
      function buildBeatFromFrame(time, score, tag) {
        var f = Math.max(0, Math.min(nFrames - 1, Math.round(time / 0.010)));
        var lowTone = Math.min(2.0, bandAt(energy, f) / lowRef);
        var bodyTone = Math.min(2.0, bandAt(bodyEnergy, f) / bodyRef);
        var snapTone = Math.min(2.0, bandAt(snapEnergy, f) / snapRef);
        var toneTotal = Math.max(0.001, lowTone + bodyTone * 0.72 + snapTone * 0.58);
        var lowMix = lowTone / toneTotal;
        var bodyMix = (bodyTone * 0.72) / toneTotal;
        var snapMix = (snapTone * 0.58) / toneTotal;
        return {
          time: time,
          strength: clampRange(0.30 + score * 0.055, 0.30, 0.52),
          confidence: clampRange(0.46 + score * 0.08, 0.46, 0.66),
          primary: true,
          camera: true,
          pulse: true,
          sparse: true,
          tone: tag || 'sunset-pattern',
          impact: clampRange(0.18 + score * 0.060, 0.18, 0.48),
          low: Math.max(0.22, Math.min(0.74, lowMix)),
          body: bodyMix,
          snap: snapMix,
          mass: Math.max(0.30, Math.min(0.58, lowMix * 0.58 + bodyMix * 0.20)),
          sharpness: Math.max(0.05, Math.min(0.28, snapMix * 0.72))
        };
      }
      function learnIntroPattern() {
        if (!analysisProfile.introPattern) return null;
        var introEnd = Math.min(duration || 34, 34);
        var rows = events.filter(function(b){ return b && isFinite(b.time) && b.time >= 1.2 && b.time <= introEnd; })
          .map(function(b){ return { beat: b, score: moodScore(b) }; });
        if (rows.length < 6) return null;
        var scoreFloor = Math.max(0.34, eventPercentile(rows, 0.58));
        var hits = [];
        var minIntroGap = 1.08;
        rows.forEach(function(row){
          if (row.score < scoreFloor && !(row.beat && (row.beat.low || 0) > 0.42 && row.score > scoreFloor * 0.78)) return;
          var last = hits[hits.length - 1];
          if (last && row.beat.time - last.beat.time < minIntroGap) {
            if (row.score > last.score) hits[hits.length - 1] = row;
          } else {
            hits.push(row);
          }
        });
        if (hits.length < 5) return null;
        var gaps = [];
        for (var hi = 1; hi < hits.length; hi++) {
          var gap = hits[hi].beat.time - hits[hi - 1].beat.time;
          if (gap >= 1.18 && gap <= 2.45) gaps.push(gap);
        }
        if (gaps.length < 4) return null;
        var firstGaps = gaps.slice(0, Math.min(8, gaps.length));
        var evenGaps = [];
        var oddGaps = [];
        for (var gi = 0; gi < firstGaps.length; gi++) {
          (gi % 2 === 0 ? evenGaps : oddGaps).push(firstGaps[gi]);
        }
        var evenGap = medianNumber(evenGaps);
        var oddGap = medianNumber(oddGaps);
        var patternGaps;
        if (evenGap && oddGap && Math.abs(evenGap - oddGap) > 0.16) {
          patternGaps = [evenGap, oddGap].map(function(v){ return clampRange(v, 1.30, 2.22); });
        } else {
          patternGaps = [clampRange(medianNumber(firstGaps), 1.42, 2.12)];
        }
        var refScore = Math.max(0.35, eventPercentile(hits, 0.50));
        return {
          anchor: hits[0].beat.time,
          gaps: patternGaps,
          refScore: refScore,
          introHitCount: hits.length,
          introTimes: hits.slice(0, 10).map(function(row){ return row.beat.time; })
        };
      }
      function buildIntroPatternBeats() {
        var pattern = learnIntroPattern();
        if (!pattern) return null;
        var selected = [];
        var t = pattern.anchor;
        var gi = 0;
        var avgGap = pattern.gaps.reduce(function(a,b){ return a + b; }, 0) / Math.max(1, pattern.gaps.length);
        var refineRadius = Math.min(0.22, Math.max(0.14, avgGap * 0.10));
        var findRadius = Math.min(0.26, Math.max(0.18, avgGap * 0.13));
        while (t < (duration || 0) - 0.55) {
          var point = bestSoftGrooveFrameNear(t, refineRadius);
          var refinedTime = Math.abs(point.time - t) <= refineRadius ? point.time : t;
          var match = findBestEventNear(refinedTime, findRadius) || findBestEventNear(t, findRadius);
          var score = match ? match.score : Math.max(0.26, (point.score || 0) / Math.max(1.0, pattern.refScore * 2.2));
          var accent = (gi % pattern.gaps.length) === 0;
          var beat = match ? cloneSparseBeat(match.beat, score, accent, 'sunset-intro-pattern') : buildBeatFromFrame(refinedTime, score, 'sunset-intro-pattern');
          beat.time = refinedTime;
          beat.index = gi;
          beat.combo = accent ? 'downbeat' : 'rebound';
          beat.introPattern = true;
          selected.push(beat);
          t += pattern.gaps[gi % pattern.gaps.length];
          gi++;
          if (gi > 800) break;
        }
        for (var si = 0; si < selected.length; si++) delete selected[si]._sparseScore;
        console.log('soft-groove intro pattern camera:', selected.length, 'gaps:', pattern.gaps.map(function(v){ return v.toFixed(2); }).join('/'), 'anchor:', pattern.anchor.toFixed(2), 'introHits:', pattern.introHitCount);
        return selected.length >= 8 ? selected : null;
      }
      var introPatternBeats = buildIntroPatternBeats();
      if (introPatternBeats && introPatternBeats.length >= 8) return introPatternBeats;

      var railStep = step;
      while (railStep < 1.35) railStep *= 2;
      railStep = clampRange(railStep, 1.42, 2.12);
      var railMultiple = Math.max(1, Math.round(railStep / step));
      if (railMultiple < 2 && step < 1.20) railMultiple = 2;
      var phaseScores = new Array(railMultiple);
      for (var pi = 0; pi < phaseScores.length; pi++) phaseScores[pi] = 0;
      for (var ei = 0; ei < events.length; ei++) {
        var ev = events[ei];
        if (!ev || !isFinite(ev.time)) continue;
        if (ev.time < 1.0 || (duration && ev.time > duration - 0.65)) continue;
        var phase = Math.abs((ev.index == null ? ei : ev.index) % railMultiple);
        var earlyWeight = ev.time < 70 ? 1.18 : (ev.time < 205 ? 1.0 : 0.94);
        phaseScores[phase] += moodScore(ev) * earlyWeight;
      }
      var bestPhase = 0;
      for (var ps = 1; ps < phaseScores.length; ps++) {
        if (phaseScores[ps] > phaseScores[bestPhase]) bestPhase = ps;
      }
      var selected = [];
      var minGap = Math.max(1.12, railStep * 0.68);
      function pushSparse(b, score, accent) {
        if (!b || score < 0.28) return;
        var copy = cloneSparseBeat(b, score, accent, 'sunset-groove');
        copy.combo = selected.length % 2 === 0 ? 'downbeat' : 'rebound';
        var last = selected[selected.length - 1];
        if (last && copy.time - last.time < minGap) {
          if (score > (last._sparseScore || 0) + 0.05) selected[selected.length - 1] = copy;
          return;
        }
        selected.push(copy);
      }
      for (var si = 0; si < events.length; si++) {
        var b = events[si];
        if (!b || !isFinite(b.time)) continue;
        var idx = b.index == null ? si : b.index;
        var score = moodScore(b);
        var onRail = Math.abs(idx % railMultiple) === bestPhase;
        if (onRail) {
          pushSparse(b, score, false);
        } else if (score >= 0.82 && (!selected.length || b.time - selected[selected.length - 1].time >= minGap * 1.18)) {
          pushSparse(b, score, true);
        }
      }
      for (var ci = 0; ci < selected.length; ci++) {
        delete selected[ci]._sparseScore;
      }
      var minExpected = duration ? Math.max(16, Math.floor(duration / 3.2)) : 16;
      if (selected.length < minExpected) {
        var fallback = events.filter(function(b){ return b && b.camera !== false && b.pulse !== false; });
        selected = [];
        for (var fi = 0; fi < fallback.length; fi++) pushSparse(fallback[fi], moodScore(fallback[fi]), false);
        for (var di = 0; di < selected.length; di++) delete selected[di]._sparseScore;
      }
      console.log('soft-groove sparse camera:', selected.length, 'of', events.length, 'railStep:', railStep.toFixed(2), 'phase:', bestPhase + '/' + railMultiple);
      return selected.length >= 4 ? selected : events.filter(function(b){ return b && b.camera !== false; });
    }

    // 自适应阈值: 滑动均值 + 标准差, 输出带强度的 beat 事件.
    var winN = 50;  // 0.5 秒
    var candidates = [];
    var lastKickFrame = -winN;
    var minIntervalFrames = 12;  // 120ms, 粒子可响应较密集的低频瞬态.
    for (var f = winN; f < nFrames - 5; f++) {
      var sum = 0, sqSum = 0;
      for (var k = f - winN; k < f; k++) { sum += onset[k]; sqSum += onset[k] * onset[k]; }
      var mean = sum / winN;
      var std = Math.sqrt(Math.max(0, sqSum / winN - mean * mean));
      var thresh = mean + std * 2.35 + 0.0045;
      if (onset[f] > thresh && onset[f] > onset[f-1] && onset[f] >= onset[f+1]) {
        if (f - lastKickFrame >= minIntervalFrames) {
          var localScore = (onset[f] - thresh) / Math.max(0.006, std + mean * 0.35);
          candidates.push({
            frame: f,
            time: f * 0.010,
            raw: onset[f],
            score: localScore,
            lowTone: Math.min(2.0, bandAt(energy, f) / lowRef),
            bodyTone: Math.min(2.0, bandAt(bodyEnergy, f) / bodyRef),
            vocalTone: Math.min(2.0, bandAt(vocalEnergy, f) / vocalRef),
            snapTone: Math.min(2.0, bandAt(snapEnergy, f) / snapRef)
          });
          lastKickFrame = f;
        }
      }
      if (f > winN && f % 900 === 0) {
        await yieldToPaint();
        if (token !== beatMapToken) { hideBeatChip(); return null; }
      }
    }

    var scores = candidates.map(function(b){ return b.score; }).sort(function(a,b){ return a-b; });
    var p75 = scores.length ? scores[Math.floor(scores.length * 0.75)] : 1;
    var p92 = scores.length ? scores[Math.floor(scores.length * 0.92)] : Math.max(1, p75);
    var strongTimes = [];
    var beats = candidates.map(function(b, i){
      var strength = Math.max(0.18, Math.min(1, (b.score - p75 * 0.36) / Math.max(0.001, p92 - p75 * 0.36)));
      var lowDominance = b.lowTone / Math.max(0.001, b.vocalTone * 0.84 + b.bodyTone * 0.36 + b.snapTone * 0.10);
      var toneTotal = Math.max(0.001, b.lowTone + b.bodyTone * 0.72 + b.snapTone * 0.58);
      var lowMix = b.lowTone / toneTotal;
      var bodyMix = (b.bodyTone * 0.72) / toneTotal;
      var snapMix = (b.snapTone * 0.58) / toneTotal;
      var drumLike = b.lowTone > 0.38 && (lowMix > 0.42 || lowDominance > 0.72);
      if (strength > 0.55 && drumLike) strongTimes.push(b.time);
      var sharpness = Math.max(0.08, Math.min(1, snapMix * 1.55 + strength * 0.10));
      var mass = Math.max(0.25, Math.min(1, lowMix * 0.72 + bodyMix * 0.36 + strength * 0.20));
      var tone = snapMix > 0.34 && b.snapTone > 0.55 ? 'snap' : (bodyMix > 0.36 && b.bodyTone > 0.55 ? 'body' : (lowMix > 0.55 ? 'deep' : 'mixed'));
      return {
        time: b.time,
        strength: strength,
        confidence: Math.max(0.22, Math.min(1, b.score / Math.max(0.001, p92))),
        primary: drumLike && strength >= 0.50,
        camera: drumLike && strength >= 0.42,
        tone: tone,
        low: lowMix,
        body: bodyMix,
        snap: snapMix,
        mass: mass,
        sharpness: sharpness,
        index: i
      };
    });

    var gaps = [];
    for (var gi = 1; gi < strongTimes.length; gi++) {
      var gap = strongTimes[gi] - strongTimes[gi - 1];
      if (gap >= 0.26 && gap <= 0.86) gaps.push(gap);
    }
    gaps.sort(function(a,b){ return a-b; });
    var gridStep = gaps.length ? gaps[Math.floor(gaps.length * 0.5)] : 0;
    var cameraBeats = beats.filter(function(b){ return b.camera; });
    if (gridStep > 0) {
      for (var bi = 0; bi < beats.length; bi++) {
        var prevGap = bi > 0 ? beats[bi].time - beats[bi - 1].time : gridStep;
        var nextGap = bi < beats.length - 1 ? beats[bi + 1].time - beats[bi].time : gridStep;
        var gridLike = Math.abs(prevGap - gridStep) < gridStep * 0.32 || Math.abs(nextGap - gridStep) < gridStep * 0.32;
        beats[bi].primary = beats[bi].camera && beats[bi].strength >= (gridLike ? 0.42 : 0.58);
      }
      if (gridStep >= 0.38 && gridStep <= 0.88 && strongTimes.length >= 4) {
        var anchor = strongTimes[0];
        while (anchor - gridStep > 0.20) anchor -= gridStep;
        var gridBeats = [];
        var windowSec = Math.min(0.18, gridStep * 0.30);
        for (var gt = anchor; gt < buffer.duration - 0.05; gt += gridStep) {
          var best = null;
          var bestDist = windowSec;
          for (var ci = 0; ci < beats.length; ci++) {
            var dist = Math.abs(beats[ci].time - gt);
            if (dist < bestDist) {
              best = beats[ci];
              bestDist = dist;
            }
          }
          if (best && best.camera) {
            best.primary = true;
            best.strength = Math.max(best.strength, 0.54);
            best.confidence = Math.max(best.confidence, 0.58);
            gridBeats.push(best);
          } else {
            var gf = Math.max(0, Math.min(nFrames - 1, Math.round(gt / 0.010)));
            var lowTone = Math.min(2.0, bandAt(energy, gf) / lowRef);
            var bodyTone = Math.min(2.0, bandAt(bodyEnergy, gf) / bodyRef);
            var vocalTone = Math.min(2.0, bandAt(vocalEnergy, gf) / vocalRef);
            var snapTone = Math.min(2.0, bandAt(snapEnergy, gf) / snapRef);
            var lowDominance = lowTone / Math.max(0.001, vocalTone * 0.84 + bodyTone * 0.36 + snapTone * 0.10);
            var toneTotal = Math.max(0.001, lowTone + bodyTone * 0.72 + snapTone * 0.58);
            var lowMix = lowTone / toneTotal;
            var bodyMix = (bodyTone * 0.72) / toneTotal;
            var snapMix = (snapTone * 0.58) / toneTotal;
            if (lowTone <= 0.38 || (lowMix <= 0.42 && lowDominance <= 0.72)) continue;
            gridBeats.push({
              time: gt,
              strength: 0.53,
              confidence: 0.60,
              primary: true,
              ghost: true,
              tone: 'grid',
              low: lowMix,
              body: bodyMix,
              snap: snapMix,
              mass: Math.max(0.35, Math.min(0.82, lowMix * 0.72 + bodyMix * 0.36 + 0.16)),
              sharpness: Math.max(0.08, Math.min(0.65, snapMix * 1.25)),
              index: gridBeats.length
            });
          }
        }
        cameraBeats = gridBeats;
      }
    }

    var musicTempoResult = await musicTempoTask;
    if (token !== beatMapToken) { hideBeatChip(); return null; }
    if (musicTempoResult && musicTempoResult.beats && musicTempoResult.beats.length) {
      musicTempoBeats = normalizeMusicTempoBeats(musicTempoResult.beats || [], buffer.duration);
      musicTempoGridStep = medianGap(musicTempoBeats, 0.36, 1.00);
      console.log('music-tempo worker:', musicTempoResult.tempo, 'bpm, beats:', musicTempoBeats.length, 'step:', musicTempoGridStep);
    }

    if (musicTempoBeats.length >= 4) {
      var musicTempoPhaseOffset = estimateTempoPhaseOffset(musicTempoBeats, beats, musicTempoGridStep || gridStep, buffer.duration);
      if (musicTempoPhaseOffset) {
        musicTempoBeats = musicTempoBeats.map(function(t){ return t + musicTempoPhaseOffset; })
          .filter(function(t){ return isFinite(t) && t >= 0.05 && t < buffer.duration - 0.05; });
        console.log('music-tempo phase correction:', musicTempoPhaseOffset.toFixed(3), 's');
      }
      if (analysisProfile.phaseScan) {
        var softGroovePhaseOffset = estimateSoftGrooveTempoOffset(musicTempoBeats, musicTempoGridStep || gridStep);
        if (softGroovePhaseOffset) {
          musicTempoBeats = musicTempoBeats.map(function(t){ return t + softGroovePhaseOffset; })
            .filter(function(t){ return isFinite(t) && t >= 0.05 && t < buffer.duration - 0.05; });
          console.log('soft-groove phase correction:', softGroovePhaseOffset.toFixed(3), 's');
        }
      }
      var tempoCameraBeats = [];
      var tempoWindow = Math.min(0.16, Math.max(0.095, (musicTempoGridStep || 0.60) * 0.24));
      var tempoMetrics = [];
      for (var ti = 0; ti < musicTempoBeats.length; ti++) {
        var mtTime = musicTempoBeats[ti];
        var refinedPoint = refineSoftGrooveBeatTime(mtTime, musicTempoGridStep || gridStep);
        var metricTime = refinedPoint.time;
        var nearest = null;
        var nearestDist = tempoWindow;
        for (var nb = 0; nb < beats.length; nb++) {
          var nd = Math.abs(beats[nb].time - metricTime);
          if (nd < nearestDist) {
            nearest = beats[nb];
            nearestDist = nd;
          }
        }
        var mf = Math.max(0, Math.min(nFrames - 1, Math.round(metricTime / 0.010)));
        var mtLowTone = Math.min(2.0, bandAt(energy, mf) / lowRef);
        var mtBodyTone = Math.min(2.0, bandAt(bodyEnergy, mf) / bodyRef);
        var mtVocalTone = Math.min(2.0, bandAt(vocalEnergy, mf) / vocalRef);
        var mtSnapTone = Math.min(2.0, bandAt(snapEnergy, mf) / snapRef);
        var mtLowRise = Math.min(2.5, (onset[mf] || 0) / lowOnsetRef);
        var mtBodyRise = Math.min(2.5, (bodyOnset[mf] || 0) / bodyOnsetRef);
        var mtVocalRise = Math.min(2.5, (vocalOnset[mf] || 0) / vocalOnsetRef);
        var mtSnapRise = Math.min(2.5, (snapOnset[mf] || 0) / snapOnsetRef);
        var mtLowDominance = mtLowTone / Math.max(0.001, mtVocalTone * 0.84 + mtBodyTone * 0.36 + mtSnapTone * 0.10);
        var mtToneTotal = Math.max(0.001, mtLowTone + mtBodyTone * 0.72 + mtSnapTone * 0.58);
        var mtLowMix = mtLowTone / mtToneTotal;
        var mtBodyMix = (mtBodyTone * 0.72) / mtToneTotal;
        var mtSnapMix = (mtSnapTone * 0.58) / mtToneTotal;
        var mtPower = mtLowTone * 0.44 + mtBodyTone * 0.16 + mtSnapTone * 0.08 + Math.min(1.8, mtLowDominance) * 0.16 + (nearest ? nearest.strength * 0.46 : 0);
        if (softGrooveAnalysis) {
          var vocalLeak = Math.max(0, mtVocalRise + mtVocalTone * 0.22 - (mtLowRise + mtBodyRise) * 0.50 - 0.14);
          mtPower = mtLowTone * 0.26 + mtBodyTone * 0.24 + mtLowRise * 0.34 + mtBodyRise * 0.32 + mtSnapRise * 0.06 + Math.min(1.7, mtLowDominance) * 0.10 + (nearest ? nearest.strength * 0.30 : 0) - vocalLeak * 0.16;
        }
        tempoMetrics.push({
          time: metricTime,
          gridTime: mtTime,
          nearest: nearest,
          lowTone: mtLowTone,
          bodyTone: mtBodyTone,
          snapTone: mtSnapTone,
          lowRise: mtLowRise,
          bodyRise: mtBodyRise,
          snapRise: mtSnapRise,
          lowDominance: mtLowDominance,
          lowMix: mtLowMix,
          bodyMix: mtBodyMix,
          snapMix: mtSnapMix,
          power: mtPower,
          softScore: refinedPoint.score || 0,
          index: ti
        });
      }
      var tempoPowers = tempoMetrics.map(function(m){ return m.power; });
      var tempoLowTones = tempoMetrics.map(function(m){ return m.lowTone; });
      var tempoBodyTones = tempoMetrics.map(function(m){ return m.bodyTone; });
      var tempoSnapTones = tempoMetrics.map(function(m){ return m.snapTone; });
      var tempoLowRises = tempoMetrics.map(function(m){ return m.lowRise || 0; });
      var tempoBodyRises = tempoMetrics.map(function(m){ return m.bodyRise || 0; });
      var tempoSnapRises = tempoMetrics.map(function(m){ return m.snapRise || 0; });
      var powerFloor = Math.max(0.001, percentile(tempoPowers, 0.25));
      var powerCeil = Math.max(powerFloor + 0.001, percentile(tempoPowers, 0.90));
      var lowFloor = Math.max(0.001, percentile(tempoLowTones, 0.25));
      var lowCeil = Math.max(lowFloor + 0.001, percentile(tempoLowTones, 0.88));
      var bodyFloor = Math.max(0.001, percentile(tempoBodyTones, 0.25));
      var bodyCeil = Math.max(bodyFloor + 0.001, percentile(tempoBodyTones, 0.90));
      var snapFloor = Math.max(0.001, percentile(tempoSnapTones, 0.25));
      var snapCeil = Math.max(snapFloor + 0.001, percentile(tempoSnapTones, 0.90));
      var lowRiseFloor = Math.max(0.001, percentile(tempoLowRises, 0.25));
      var lowRiseCeil = Math.max(lowRiseFloor + 0.001, percentile(tempoLowRises, 0.90));
      var bodyRiseFloor = Math.max(0.001, percentile(tempoBodyRises, 0.25));
      var bodyRiseCeil = Math.max(bodyRiseFloor + 0.001, percentile(tempoBodyRises, 0.90));
      var snapRiseFloor = Math.max(0.001, percentile(tempoSnapRises, 0.25));
      var snapRiseCeil = Math.max(snapRiseFloor + 0.001, percentile(tempoSnapRises, 0.90));
      for (var tm = 0; tm < tempoMetrics.length; tm++) {
        var m = tempoMetrics[tm];
        var mtSlot = m.index % 4;
        var powerRel = clamp01((m.power - powerFloor) / (powerCeil - powerFloor));
        var lowRel = clamp01((m.lowTone - lowFloor) / (lowCeil - lowFloor));
        var bodyRel = clamp01((m.bodyTone - bodyFloor) / (bodyCeil - bodyFloor));
        var snapRel = clamp01((m.snapTone - snapFloor) / (snapCeil - snapFloor));
        var lowRiseRel = clamp01(((m.lowRise || 0) - lowRiseFloor) / (lowRiseCeil - lowRiseFloor));
        var bodyRiseRel = clamp01(((m.bodyRise || 0) - bodyRiseFloor) / (bodyRiseCeil - bodyRiseFloor));
        var snapRiseRel = clamp01(((m.snapRise || 0) - snapRiseFloor) / (snapRiseCeil - snapRiseFloor));
        var mtImpact = clamp01(powerRel * 0.50 + lowRel * 0.24 + bodyRel * 0.18 + snapRel * 0.08);
        if (m.nearest) mtImpact = Math.max(mtImpact, Math.min(1, m.nearest.strength * 0.58 + (m.nearest.primary ? 0.08 : 0)));
        if (softGrooveAnalysis) {
          mtImpact = clamp01(powerRel * 0.34 + lowRel * 0.18 + bodyRel * 0.18 + lowRiseRel * 0.24 + bodyRiseRel * 0.24 + snapRiseRel * 0.04);
          if (m.nearest) mtImpact = Math.max(mtImpact, Math.min(0.72, m.nearest.strength * 0.42 + (m.nearest.primary ? 0.06 : 0)));
        }
        var activeCamera = mtImpact >= 0.20 || (mtSlot === 0 && mtImpact >= 0.15 && (lowRel > 0.20 || bodyRel > 0.26));
        var activePulse = mtImpact >= 0.24 || (mtSlot === 0 && mtImpact >= 0.18);
        var grooveEvidence = lowRiseRel * 0.52 + bodyRiseRel * 0.48 + lowRel * 0.20 + bodyRel * 0.18;
        if (softGrooveAnalysis) {
          activeCamera = mtImpact >= 0.19 || (mtSlot === 0 && mtImpact >= 0.135 && grooveEvidence >= 0.32);
          activePulse = mtImpact >= 0.23 || (mtSlot === 0 && mtImpact >= 0.165 && grooveEvidence >= 0.28);
        }
        var downbeatLift = activeCamera ? (mtSlot === 0 ? 0.14 : (mtSlot === 2 ? 0.06 : 0)) : 0;
        var mtStrength = 0.26 + powerRel * 0.23 + lowRel * 0.10 + bodyRel * 0.08 + snapRel * 0.04 + downbeatLift;
        if (m.nearest) mtStrength = Math.max(mtStrength, 0.42 + m.nearest.strength * 0.28);
        if (mtSlot === 0 && activeCamera) mtStrength = Math.max(mtStrength, 0.54 + mtImpact * 0.16);
        if (!activeCamera) mtStrength = Math.min(mtStrength, 0.36);
        if (softGrooveAnalysis) {
          mtStrength = 0.24 + powerRel * 0.18 + lowRel * 0.08 + bodyRel * 0.08 + lowRiseRel * 0.13 + bodyRiseRel * 0.12 + downbeatLift * 0.90;
          if (m.nearest) mtStrength = Math.max(mtStrength, 0.36 + m.nearest.strength * 0.22);
          if (mtSlot === 0 && activeCamera) mtStrength = Math.max(mtStrength, 0.50 + mtImpact * 0.15);
          if (mtSlot === 2 && activeCamera) mtStrength = Math.max(mtStrength, 0.43 + mtImpact * 0.10);
          if (!activeCamera) mtStrength = Math.min(mtStrength, 0.34);
          mtStrength = Math.max(0.28, Math.min(0.76, mtStrength));
        } else {
          mtStrength = Math.max(0.30, Math.min(0.82, mtStrength));
        }
        var lowForCamera = Math.max(0.22, Math.min(0.78, m.lowMix * 0.82 + lowRel * 0.18));
        tempoCameraBeats.push({
          time: m.time,
          strength: mtStrength,
          confidence: m.nearest ? Math.max(0.60, m.nearest.confidence || 0) : Math.max(0.52, 0.48 + powerRel * 0.28),
          primary: activeCamera,
          camera: activeCamera,
          pulse: activePulse,
          impact: mtImpact,
          tone: 'music-tempo',
          grooveEvidence: grooveEvidence,
          low: lowForCamera,
          body: m.bodyMix,
          snap: m.snapMix,
          mass: Math.max(0.35, Math.min(0.86, lowForCamera * 0.68 + m.bodyMix * 0.24 + mtStrength * 0.16)),
          sharpness: Math.max(0.08, Math.min(0.65, m.snapMix * 1.18)),
          combo: mtSlot === 0 ? 'downbeat' : (mtSlot === 1 ? 'push' : (mtSlot === 2 ? 'drop' : 'rebound')),
          index: m.index
        });
      }
      if (tempoCameraBeats.length >= 4) {
        if (analysisProfile.sparseCamera) {
          tempoCameraBeats = thinSoftGrooveCameraBeats(tempoCameraBeats, musicTempoGridStep || gridStep, buffer.duration);
        }
        cameraBeats = tempoCameraBeats;
        gridStep = musicTempoGridStep || gridStep;
      }
    }

    var kicks = beats.map(function(b){ return b.time; });
    var visualBeatCount = 0;
    var pulseBeats = cameraBeats.filter(function(b){
      if (typeof b === 'number') {
        visualBeatCount++;
        return true;
      }
      var active = b.primary !== false && b.camera !== false && b.pulse !== false;
      if (active) visualBeatCount++;
      return active && (b.strength >= 0.38 || (b.impact || 0) >= 0.20);
    }).map(function(b){
      if (typeof b === 'number') return { time: b, strength: 0.42, impact: 0.42 };
      return {
        time: b.time,
        strength: b.strength,
        impact: b.impact == null ? b.strength : b.impact,
        combo: b.combo,
        low: b.low,
        body: b.body,
        snap: b.snap
      };
    });
    await yieldToPaint();
    if (token !== beatMapToken) { hideBeatChip(); return null; }
    if (options.prefetch) hideBeatChip();
    else showBeatChip('节奏缓冲中…');
    return { kicks: kicks, beats: beats, pulseBeats: pulseBeats, cameraBeats: cameraBeats, gridStep: gridStep, tempoSource: musicTempoBeats.length >= 4 ? 'music-tempo' : 'local', analysisProfile: analysisProfile.id || 'default', duration: buffer.duration, visualBeatCount: visualBeatCount, analyzedAt: Date.now() };
  } catch (e) {
    console.warn('beat analysis failed:', e);
    hideBeatChip();
    return null;
  } finally {
    beatMapBusy = false;
  }
}

function schedulePodcastDjAnalysis(songKey, audioUrl, token, durationSec) {
  cancelDjBeatAnalysisTimer();
  if (!songKey || !audioUrl) return;
  djBeatAnalysisTimer = setTimeout(function waitForDjStart(){
    djBeatAnalysisTimer = null;
    if (token !== djBeatMapToken || !djMode.active || djMode.songKey !== songKey || djBeatMapCache[songKey]) return;
    var startAnalysis = function(){
      if (token !== djBeatMapToken || !djMode.active || djMode.songKey !== songKey || djBeatMapCache[songKey]) return;
      if (djBeatMapBusy) {
        djBeatAnalysisTimer = setTimeout(waitForDjStart, 900);
        return;
      }
      if (/^https?:\/\//i.test(audioUrl || '') && (durationSec <= 0 || durationSec > 3300)) {
        analyzePodcastDjIntroBeats(audioUrl, token, durationSec).then(function(map){
          if (token !== djBeatMapToken || !map) return;
          smoothPodcastDjIntroHandoff(songKey, map, token);
        }).catch(function(err){
          console.warn('podcast DJ intro beat analysis failed:', err);
        });
      }
      analyzePodcastDjBeats(audioUrl, token, durationSec).then(function(map){
        if (token !== djBeatMapToken || !map) return;
        smoothPodcastDjMapHandoff(songKey, map, token);
      }).catch(function(err){
        console.warn('podcast DJ beat analysis failed:', err);
        hideBeatChip();
      });
    };
    scheduleAnalysisTask(startAnalysis, 900);
  }, 900);
}

async function analyzePodcastDjIntroBeats(audioUrl, token, durationSec) {
  if (!/^https?:\/\//i.test(audioUrl || '')) return null;
  if (token !== djBeatMapToken || !djMode.active) return null;
  var introResp = await fetch('/api/podcast/dj-beatmap?url=' + encodeURIComponent(audioUrl) + '&duration=' + encodeURIComponent(durationSec || 0) + '&intro=180');
  if (token !== djBeatMapToken || !djMode.active) return null;
  var introData = await introResp.json().catch(function(){ return null; });
  if (introResp.ok && introData && introData.ok && introData.map && introData.map.cameraBeats && introData.map.cameraBeats.length >= 4) {
    return introData.map;
  }
  return null;
}

async function buildPodcastDjLowOnlyBeatMap(buffer, token) {
  if (!buffer) return null;
  var sr = buffer.sampleRate || 44100;
  var duration = buffer.duration || (buffer.length / sr) || 0;
  var hopSec = duration > 4200 ? 0.0125 : 0.010;
  var hopSize = Math.max(256, Math.floor(sr * hopSec));
  var nFrames = Math.max(1, Math.floor(buffer.length / hopSize));
  var lowEnergy = new Float32Array(nFrames);
  var hitEnergy = new Float32Array(nFrames);
  var channels = Math.max(1, buffer.numberOfChannels || 1);
  var ch0 = buffer.getChannelData(0);
  var ch1 = channels > 1 ? buffer.getChannelData(1) : null;
  var chList = null;
  if (channels > 2) {
    chList = [];
    for (var ch = 0; ch < channels; ch++) chList.push(buffer.getChannelData(ch));
  }
  function makeBiquad(type, freq, q) {
    freq = Math.max(8, Math.min(freq, sr * 0.45));
    var w0 = 2 * Math.PI * freq / sr;
    var cos = Math.cos(w0);
    var sin = Math.sin(w0);
    var alpha = sin / (2 * (q || 0.707));
    var b0, b1, b2, a0, a1, a2;
    if (type === 'highpass') {
      b0 = (1 + cos) * 0.5;
      b1 = -(1 + cos);
      b2 = (1 + cos) * 0.5;
    } else {
      b0 = (1 - cos) * 0.5;
      b1 = 1 - cos;
      b2 = (1 - cos) * 0.5;
    }
    a0 = 1 + alpha;
    a1 = -2 * cos;
    a2 = 1 - alpha;
    var inv = 1 / a0;
    return { b0:b0 * inv, b1:b1 * inv, b2:b2 * inv, a1:a1 * inv, a2:a2 * inv, x1:0, x2:0, y1:0, y2:0 };
  }
  function runBiquad(st, x) {
    var y = st.b0 * x + st.b1 * st.x1 + st.b2 * st.x2 - st.a1 * st.y1 - st.a2 * st.y2;
    st.x2 = st.x1; st.x1 = x; st.y2 = st.y1; st.y1 = y;
    return y;
  }
  var hp = makeBiquad('highpass', 32, 0.72);
  var lp = makeBiquad('lowpass', 178, 0.82);
  showBeatChip('DJ kick scan 0%');
  for (var f = 0; f < nFrames; f++) {
    var start = f * hopSize;
    var end = Math.min(buffer.length, start + hopSize);
    var sum = 0;
    var peak = 0;
    for (var i = start; i < end; i++) {
      var x;
      if (chList) {
        x = 0;
        for (var ci = 0; ci < channels; ci++) x += chList[ci][i];
        x /= channels;
      } else if (ch1) {
        x = (ch0[i] + ch1[i]) * 0.5;
      } else {
        x = ch0[i];
      }
      var y = runBiquad(lp, runBiquad(hp, x || 0));
      var ay = Math.abs(y);
      sum += y * y;
      if (ay > peak) peak = ay;
    }
    var count = Math.max(1, end - start);
    lowEnergy[f] = Math.sqrt(sum / count);
    hitEnergy[f] = peak;
    if (f > 0 && f % 720 === 0) {
      if (f % 4320 === 0) showBeatChip('DJ kick scan ' + Math.min(99, Math.round(f / nFrames * 100)) + '%');
      await yieldToPaint();
      if (token !== djBeatMapToken || !djMode.active) { hideBeatChip(); return null; }
    }
  }
  if (token !== djBeatMapToken || !djMode.active) { hideBeatChip(); return null; }

  function percentile(arr, p, maxSamples) {
    var len = arr ? arr.length : 0;
    if (!len) return 0.001;
    maxSamples = maxSamples || 14000;
    var sample;
    if (len <= maxSamples) {
      sample = Array.prototype.slice.call(arr);
    } else {
      sample = new Array(maxSamples);
      var step = (len - 1) / (maxSamples - 1);
      for (var si = 0; si < maxSamples; si++) sample[si] = arr[Math.min(len - 1, Math.floor(si * step))] || 0;
    }
    sample.sort(function(a,b){ return a - b; });
    return sample[Math.max(0, Math.min(sample.length - 1, Math.floor(sample.length * p)))] || 0.001;
  }
  function bandAt(arr, idx) {
    idx = Math.max(0, Math.min(nFrames - 1, idx | 0));
    var a = arr[Math.max(0, idx - 1)] || 0;
    var b = arr[idx] || 0;
    var c = arr[Math.min(nFrames - 1, idx + 1)] || 0;
    return (a + b * 2 + c) * 0.25;
  }
  function median(vals) {
    vals = vals.filter(function(v){ return isFinite(v); }).sort(function(a,b){ return a - b; });
    return vals.length ? vals[Math.floor(vals.length * 0.5)] : 0;
  }
  var lowFloor = Math.max(0.0004, percentile(lowEnergy, 0.22));
  var lowMid = Math.max(lowFloor + 0.0002, percentile(lowEnergy, 0.58));
  var lowRef = Math.max(lowMid + 0.0002, percentile(lowEnergy, 0.86));
  var lowCeil = Math.max(lowRef + 0.0004, percentile(lowEnergy, 0.96));
  var hitRef = Math.max(0.0004, percentile(hitEnergy, 0.86));

  showBeatChip('DJ locking kick grid...');
  var onset = new Float32Array(nFrames);
  for (var oi = 4; oi < nFrames; oi++) {
    var prev = lowEnergy[oi - 1] * 0.62 + lowEnergy[oi - 2] * 0.28 + lowEnergy[oi - 3] * 0.10;
    var lowRise = Math.max(0, lowEnergy[oi] - prev);
    var wideRise = Math.max(0, (lowEnergy[oi] + lowEnergy[oi - 1]) * 0.5 - (lowEnergy[oi - 3] + lowEnergy[oi - 4]) * 0.5);
    var peakRise = Math.max(0, hitEnergy[oi] - hitEnergy[oi - 2] * 0.84);
    onset[oi] = lowRise * 1.72 + wideRise * 0.86 + peakRise * 0.10;
  }

  var winN = Math.max(52, Math.round(0.82 / hopSec));
  var minFrameGap = Math.max(18, Math.round(0.215 / hopSec));
  var candidates = [];
  var sumO = 0, sqO = 0;
  for (var wi = 0; wi < winN; wi++) { var ow = onset[wi] || 0; sumO += ow; sqO += ow * ow; }
  for (var cf = winN + 4; cf < nFrames - 4; cf++) {
    var mean = sumO / winN;
    var std = Math.sqrt(Math.max(0, sqO / winN - mean * mean));
    var th = mean + std * 1.66 + lowRef * 0.0038;
    var o = onset[cf];
    if (o > th && o >= onset[cf - 1] && o > onset[cf + 1]) {
      var peakF = cf;
      var peakScore = o + lowEnergy[cf] * 0.10;
      for (var pf = cf - 2; pf <= cf + 3; pf++) {
        var ps = (onset[pf] || 0) + (lowEnergy[pf] || 0) * 0.10;
        if (ps > peakScore) { peakScore = ps; peakF = pf; }
      }
      var lowTone = Math.min(2.6, bandAt(lowEnergy, peakF) / lowRef);
      var hitTone = Math.min(2.6, bandAt(hitEnergy, peakF) / hitRef);
      var lowRel = clamp01((bandAt(lowEnergy, peakF) - lowFloor) / Math.max(0.0001, lowCeil - lowFloor));
      var score = (o - th) / Math.max(0.0006, std + mean * 0.38 + lowRef * 0.012);
      if (score > 0.16 && (lowTone > 0.32 || lowRel > 0.22 || hitTone > 0.52)) {
        var cand = {
          frame: peakF,
          time: peakF * hopSec,
          score: score,
          lowTone: lowTone,
          hitTone: hitTone,
          lowRel: lowRel,
          raw: o
        };
        cand.power = cand.score * 0.56 + Math.pow(clamp01((cand.lowTone - 0.22) / 1.42), 0.82) * 0.34 + Math.min(1.5, cand.hitTone) * 0.08 + cand.lowRel * 0.10;
        var last = candidates[candidates.length - 1];
        if (last && cand.frame - last.frame < minFrameGap) {
          if (cand.power > last.power) candidates[candidates.length - 1] = cand;
        } else {
          candidates.push(cand);
        }
      }
    }
    var old = onset[cf - winN] || 0;
    var next = onset[cf] || 0;
    sumO += next - old;
    sqO += next * next - old * old;
    if (cf > winN && cf % 3600 === 0) {
      await yieldToPaint();
      if (token !== djBeatMapToken || !djMode.active) { hideBeatChip(); return null; }
    }
  }
  if (!candidates.length) {
    return { kicks: [], beats: [], pulseBeats: [], cameraBeats: [], duration: duration, visualBeatCount: 0, tempoSource: 'podcast-dj-low-empty', analyzedAt: Date.now() };
  }

  var powers = candidates.map(function(c){ return c.power; });
  var p30 = percentile(powers, 0.30);
  var p50 = percentile(powers, 0.50);
  var p90 = Math.max(p50 + 0.001, percentile(powers, 0.90));
  var p96 = Math.max(p90 + 0.001, percentile(powers, 0.965));
  var strong = candidates.filter(function(c){ return c.power >= p50 && c.lowTone > 0.34; });
  if (strong.length < 16) strong = candidates.slice();
  function estimateStep(list) {
    if (!list || list.length < 3) return 0;
    var bin = 0.006;
    var hist = {};
    var medGaps = [];
    var minStep = 0.31;
    var maxStep = 0.86;
    for (var ai = 0; ai < list.length; ai++) {
      for (var bi = ai + 1; bi < list.length && bi < ai + 10; bi++) {
        var rawGap = list[bi].time - list[ai].time;
        if (rawGap < 0.24) continue;
        if (rawGap > 2.55) break;
        for (var div = 1; div <= 6; div++) {
          var g = rawGap / div;
          if (g < minStep) break;
          if (g > maxStep) continue;
          var weight = Math.sqrt(Math.max(0.001, list[ai].power * list[bi].power)) / Math.sqrt((bi - ai) * div);
          var key = Math.round(g / bin);
          hist[key] = (hist[key] || 0) + weight;
          medGaps.push(g);
        }
      }
    }
    var bestKey = null, bestScore = 0;
    Object.keys(hist).forEach(function(k){
      var key = parseInt(k, 10);
      var score = (hist[key] || 0) + (hist[key - 1] || 0) * 0.72 + (hist[key + 1] || 0) * 0.72;
      if (score > bestScore) { bestScore = score; bestKey = key; }
    });
    if (bestKey != null) return bestKey * bin;
    return median(medGaps);
  }
  var globalStep = estimateStep(strong) || estimateStep(candidates) || 0.50;
  globalStep = clampRange(globalStep, 0.32, 0.86);

  function nearestCandidate(center, windowSec, startIdx) {
    var best = null;
    var bestScore = -Infinity;
    var j = startIdx || 0;
    while (j < candidates.length && candidates[j].time < center - windowSec) j++;
    for (var ni = j; ni < candidates.length && candidates[ni].time <= center + windowSec; ni++) {
      var dist = Math.abs(candidates[ni].time - center);
      var score = candidates[ni].power * (1 - dist / Math.max(0.001, windowSec) * 0.42);
      if (score > bestScore) { best = candidates[ni]; bestScore = score; }
    }
    return best;
  }
  function scorePhase(anchorTime, step) {
    var start = anchorTime;
    while (start - step > 0.05) start -= step;
    var end = Math.min(duration, 180);
    var win = Math.max(0.055, Math.min(0.125, step * 0.18));
    var score = 0, count = 0, cursor = 0;
    for (var gt = start; gt < end; gt += step) {
      while (cursor < candidates.length && candidates[cursor].time < gt - win) cursor++;
      var best = null, bestScore = 0;
      for (var pi = cursor; pi < candidates.length && candidates[pi].time <= gt + win; pi++) {
        var dist = Math.abs(candidates[pi].time - gt);
        var s = candidates[pi].power * (1 - dist / win * 0.44);
        if (s > bestScore) { bestScore = s; best = candidates[pi]; }
      }
      score += best ? bestScore : -p30 * 0.08;
      count++;
    }
    return count ? score / count : -Infinity;
  }
  var phaseSource = strong.filter(function(c){ return c.time < Math.min(duration, 180); }).slice(0, 72);
  if (!phaseSource.length) phaseSource = strong.slice(0, 1);
  var bestAnchor = phaseSource[0] ? phaseSource[0].time : 0;
  var bestAnchorScore = -Infinity;
  for (var pa = 0; pa < phaseSource.length; pa++) {
    var sc = scorePhase(phaseSource[pa].time, globalStep);
    if (sc > bestAnchorScore) { bestAnchorScore = sc; bestAnchor = phaseSource[pa].time; }
  }
  var halfStep = globalStep * 0.5;
  if (halfStep >= 0.31) {
    var halfScore = scorePhase(bestAnchor, halfStep);
    if (halfScore > bestAnchorScore * 1.04) globalStep = halfStep;
  }
  var anchor = bestAnchor;
  while (anchor - globalStep > 0.05) anchor -= globalStep;

  var sectionLen = duration > 3600 ? 96 : 72;
  var sectionCount = Math.max(1, Math.ceil(duration / sectionLen));
  var sectionSteps = [];
  for (var secIdx = 0; secIdx < sectionCount; secIdx++) {
    var t0 = secIdx * sectionLen, t1 = Math.min(duration, t0 + sectionLen);
    var seg = strong.filter(function(c){ return c.time >= t0 && c.time < t1; });
    var prevStep = sectionSteps.length ? sectionSteps[sectionSteps.length - 1] : globalStep;
    var localStep = estimateStep(seg) || prevStep || globalStep;
    if (prevStep) localStep = clampRange(localStep, prevStep * 0.94, prevStep * 1.06);
    if (globalStep) localStep = clampRange(localStep, globalStep * 0.86, globalStep * 1.14);
    var blended = prevStep ? (localStep * 0.30 + prevStep * 0.70) : localStep;
    sectionSteps.push(blended || globalStep);
  }
  function stepAt(time) {
    var idx = Math.max(0, Math.min(sectionSteps.length - 1, Math.floor(time / sectionLen)));
    return sectionSteps[idx] || globalStep || 0.50;
  }

  var beats = [];
  var gridIndex = 0;
  var cursorIdx = 0;
  for (var gridT = anchor; gridT < duration - 0.04; ) {
    var localStep2 = stepAt(gridT) || globalStep || 0.50;
    var winSec = Math.max(0.060, Math.min(0.135, localStep2 * 0.20));
    while (cursorIdx < candidates.length && candidates[cursorIdx].time < gridT - winSec) cursorIdx++;
    var bestCand = nearestCandidate(gridT, winSec, cursorIdx);
    var gf = Math.max(0, Math.min(nFrames - 1, Math.round(gridT / hopSec)));
    var gridLow = bandAt(lowEnergy, gf);
    var gridHit = bandAt(hitEnergy, gf);
    var gridLowTone = Math.min(2.6, gridLow / lowRef);
    var gridHitTone = Math.min(2.6, gridHit / hitRef);
    var lowTone2 = bestCand ? Math.max(gridLowTone * 0.62, bestCand.lowTone) : gridLowTone;
    var hitTone2 = bestCand ? Math.max(gridHitTone * 0.62, bestCand.hitTone) : gridHitTone;
    var distPenalty = bestCand ? (1 - Math.min(1, Math.abs(bestCand.time - gridT) / winSec) * 0.26) : 0.54;
    var basePower = bestCand ? bestCand.power * distPenalty : (gridLowTone * 0.25 + gridHitTone * 0.06);
    var powerRel = clamp01((basePower - p30 * 0.78) / Math.max(0.001, p96 - p30 * 0.78));
    var lowRel2 = clamp01((gridLow - lowFloor) / Math.max(0.0001, lowCeil - lowFloor));
    var kickRel = clamp01(powerRel * 0.74 + lowRel2 * 0.22 + clamp01((hitTone2 - 0.26) / 1.70) * 0.04);
    var softGrid = (!bestCand && lowRel2 < 0.20) || kickRel < 0.16;
    var slot = gridIndex % 4;
    var combo = slot === 0 ? 'downbeat' : (slot === 1 ? 'push' : (slot === 2 ? 'drop' : 'rebound'));
    if (kickRel > 0.84 && combo !== 'downbeat') combo = 'accent';
    var visualRel = kickRel > 0.76 ? 0.76 + (kickRel - 0.76) * 0.52 : kickRel;
    var downLift = combo === 'downbeat' ? (visualRel > 0.18 ? (0.016 + visualRel * 0.036) : visualRel * 0.028) : 0;
    var sectionGate = clamp01((kickRel - 0.10) / 0.58);
    var impact = Math.max(0.020, Math.min(0.88, 0.022 + Math.pow(visualRel, 1.62) * 0.86 + downLift));
    var strength = Math.max(0.12, Math.min(0.93, 0.13 + Math.pow(visualRel, 1.12) * 0.68 + downLift * 0.70));
    if (softGrid) {
      var softMul = combo === 'downbeat' ? 0.48 : 0.30;
      impact *= softMul;
      strength *= 0.58 + sectionGate * 0.22;
    }
    var timingPull = bestCand ? (0.24 + clamp01((kickRel - 0.25) / 0.65) * 0.46) : 0;
    var sourceTime = bestCand ? (gridT * (1 - timingPull) + bestCand.time * timingPull) : gridT;
    var cameraActive = impact >= 0.13 || (combo === 'downbeat' && kickRel >= 0.14) || (bestCand && kickRel >= 0.18);
    var lowMix = Math.max(0.42, Math.min(0.90, 0.52 + visualRel * 0.32 + lowTone2 * 0.035 - (combo === 'accent' ? 0.10 : 0)));
    var bodyMix = Math.max(0.035, Math.min(0.54, 0.060 + visualRel * 0.12 + (combo === 'push' ? 0.18 : 0) + (combo === 'drop' ? 0.24 : 0)));
    var snapMix = Math.max(0.015, Math.min(0.62, 0.026 + (combo === 'accent' ? 0.40 : 0) + (combo === 'rebound' ? 0.08 : 0) + visualRel * 0.038));
    beats.push({
      time: sourceTime,
      strength: strength,
      confidence: Math.max(0.44, Math.min(0.99, 0.46 + kickRel * 0.43 + (bestCand ? 0.08 : -0.03))),
      impact: impact,
      primary: cameraActive,
      camera: cameraActive,
      pulse: impact > 0.16 || (combo === 'downbeat' && kickRel >= 0.18),
      tone: 'podcast-dj-low-grid',
      low: lowMix,
      body: bodyMix,
      snap: snapMix,
      mass: Math.max(0.36, Math.min(0.94, lowMix * 0.72 + Math.pow(visualRel, 1.22) * 0.24)),
      sharpness: Math.max(0.03, Math.min(0.28, snapMix * 1.18)),
      combo: combo,
      step: localStep2,
      index: beats.length,
      dj: true,
      grid: true,
      kickOnly: true
    });
    gridIndex++;
    gridT += localStep2;
    if (gridIndex > 0 && gridIndex % 1800 === 0) {
      await yieldToPaint();
      if (token !== djBeatMapToken || !djMode.active) { hideBeatChip(); return null; }
    }
  }

  var cameraBeats = beats.filter(function(b){ return b.camera !== false; });
  var pulseBeats = beats.filter(function(b){ return b.pulse !== false && (b.impact >= 0.16 || b.combo === 'downbeat'); }).map(function(b){
    return { time: b.time, strength: b.strength, impact: b.impact, combo: b.combo, low: b.low, body: b.body, snap: b.snap, dj: true };
  });
  console.log('podcast DJ low-only beatmap:', Math.round(duration) + 's', 'step:', globalStep.toFixed(3), 'candidates:', candidates.length, 'beats:', beats.length);
  return {
    kicks: beats.map(function(b){ return b.time; }),
    beats: beats,
    pulseBeats: pulseBeats,
    cameraBeats: cameraBeats,
    gridStep: globalStep,
    sectionSteps: sectionSteps,
    tempoSource: 'podcast-dj-low-offline',
    duration: duration,
    visualBeatCount: cameraBeats.length,
    analyzedAt: Date.now()
  };
}

async function analyzePodcastDjBeats(audioUrl, token, durationSec) {
  try {
    djBeatMapBusy = true;
    showBeatChip('DJ 离线锁拍…');
    await yieldToIdle(520);
    if (token !== djBeatMapToken || !djMode.active) { hideBeatChip(); return null; }
    durationSec = Math.max(0, Number(durationSec) || 0);
    var preferServerAnalysis = /^https?:\/\//i.test(audioUrl || '') && (durationSec <= 0 || durationSec > 3300);
    if (preferServerAnalysis) {
      showBeatChip('DJ 长播客后端锁拍...');
      var serverResp = await fetch('/api/podcast/dj-beatmap?url=' + encodeURIComponent(audioUrl) + '&duration=' + encodeURIComponent(durationSec));
      if (token !== djBeatMapToken || !djMode.active) { hideBeatChip(); return null; }
      var serverData = await serverResp.json().catch(function(){ return null; });
      if (serverResp.ok && serverData && serverData.ok && serverData.map) return serverData.map;
      console.warn('podcast DJ server analysis failed:', serverData && serverData.error);
      hideBeatChip();
      if (durationSec <= 0 || durationSec > 3300) return null;
    }
    var fetchAudioUrl = /^https?:\/\//i.test(audioUrl || '') ? ('/api/audio?url=' + encodeURIComponent(audioUrl)) : audioUrl;
    var resp = await fetch(fetchAudioUrl);
    if (token !== djBeatMapToken || !djMode.active) { hideBeatChip(); return null; }
    var ab = await resp.arrayBuffer();
    if (token !== djBeatMapToken || !djMode.active) { hideBeatChip(); return null; }

    showBeatChip('DJ 解码音频…');
    var TmpCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    var DecodeCtx = window.AudioContext || window.webkitAudioContext;
    if (!DecodeCtx) { hideBeatChip(); return null; }
    var dc = new DecodeCtx();
    var buffer = await new Promise(function(resolve, reject){
      dc.decodeAudioData(ab, resolve, reject);
    }).catch(function(e){ console.warn('podcast DJ decode failed:', e); return null; });
    ab = null;
    dc.close && dc.close();
    if (!buffer || token !== djBeatMapToken || !djMode.active) { hideBeatChip(); return null; }
    return await buildPodcastDjLowOnlyBeatMap(buffer, token);

    var sr = buffer.sampleRate;
    async function renderDjBand(hpFreq, lpFreq, label) {
      showBeatChip('DJ 分离' + label + '…');
      var off = new TmpCtx(1, buffer.length, sr);
      var src = off.createBufferSource();
      src.buffer = buffer;
      var node = src;
      if (hpFreq) {
        var hp = off.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = Math.min(hpFreq, sr * 0.45);
        hp.Q.value = 0.78;
        node.connect(hp);
        node = hp;
      }
      if (lpFreq) {
        var lp = off.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = Math.min(lpFreq, sr * 0.45);
        lp.Q.value = 0.86;
        node.connect(lp);
        node = lp;
      }
      node.connect(off.destination);
      src.start(0);
      var rendered = await off.startRendering();
      if (token !== djBeatMapToken || !djMode.active) return null;
      await yieldToIdle(280);
      return rendered.getChannelData(0);
    }

    var lowPcm = await renderDjBand(34, 170, '低频');
    if (!lowPcm) { hideBeatChip(); return null; }
    var bodyPcm = await renderDjBand(150, 560, '鼓身');
    if (!bodyPcm) { hideBeatChip(); return null; }
    var snapPcm = await renderDjBand(1700, 9200, '高频');
    if (!snapPcm) { hideBeatChip(); return null; }

    var hopSec = 0.012;
    var hopSize = Math.max(256, Math.floor(sr * hopSec));
    async function makeEnergy(pcm, label) {
      showBeatChip('DJ 读取' + label + '…');
      var frames = Math.floor(pcm.length / hopSize);
      var out = new Float32Array(frames);
      for (var f = 0; f < frames; f++) {
        var sum = 0;
        var off2 = f * hopSize;
        for (var i = 0; i < hopSize; i++) {
          var v = pcm[off2 + i] || 0;
          sum += v * v;
        }
        out[f] = Math.sqrt(sum / hopSize);
        if (f > 0 && f % 1800 === 0) {
          await yieldToPaint();
          if (token !== djBeatMapToken || !djMode.active) return null;
        }
      }
      return out;
    }

    var lowEnergy = await makeEnergy(lowPcm, '低频');
    var bodyEnergy = await makeEnergy(bodyPcm, '鼓身');
    var snapEnergy = await makeEnergy(snapPcm, '高频');
    if (!lowEnergy || !bodyEnergy || !snapEnergy || token !== djBeatMapToken || !djMode.active) { hideBeatChip(); return null; }

    var nFrames = Math.min(lowEnergy.length, bodyEnergy.length, snapEnergy.length);
    function percentile(arr, p) {
      var copy = Array.prototype.slice.call(arr).sort(function(a,b){ return a-b; });
      return copy.length ? copy[Math.max(0, Math.min(copy.length - 1, Math.floor(copy.length * p)))] : 0.001;
    }
    function bandAt(arr, f) {
      var a = arr[Math.max(0, f - 1)] || 0;
      var b = arr[f] || 0;
      var c = arr[Math.min(nFrames - 1, f + 1)] || 0;
      return (a + b * 2 + c) * 0.25;
    }
    function median(vals) {
      vals = vals.filter(function(v){ return isFinite(v); }).sort(function(a,b){ return a-b; });
      return vals.length ? vals[Math.floor(vals.length * 0.5)] : 0;
    }
    var lowRef = Math.max(0.0008, percentile(lowEnergy, 0.86));
    var bodyRef = Math.max(0.0008, percentile(bodyEnergy, 0.84));
    var snapRef = Math.max(0.0008, percentile(snapEnergy, 0.84));

    showBeatChip('DJ 计算主拍…');
    var onset = new Float32Array(nFrames);
    for (var oi = 2; oi < nFrames; oi++) {
      var lowRise = Math.max(0, lowEnergy[oi] - lowEnergy[oi - 1]);
      var lowWide = Math.max(0, lowEnergy[oi] - lowEnergy[oi - 2]);
      var bodyRise = Math.max(0, bodyEnergy[oi] - bodyEnergy[oi - 1]);
      var snapRise = Math.max(0, snapEnergy[oi] - snapEnergy[oi - 1]);
      onset[oi] = lowRise * 1.52 + lowWide * 0.58 + bodyRise * 0.16 + snapRise * 0.035;
    }

    var winN = Math.max(44, Math.round(0.78 / hopSec));
    var minFrameGap = Math.max(18, Math.round(0.215 / hopSec));
    var candidates = [];
    var lastFrame = -minFrameGap;
    var sum = 0, sq = 0;
    for (var wi = 0; wi < winN; wi++) { sum += onset[wi] || 0; sq += (onset[wi] || 0) * (onset[wi] || 0); }
    for (var f2 = winN + 1; f2 < nFrames - 2; f2++) {
      var mean = sum / winN;
      var std = Math.sqrt(Math.max(0, sq / winN - mean * mean));
      var th = mean + std * 1.90 + lowRef * 0.006;
      var o = onset[f2];
      if (o > th && o >= onset[f2 - 1] && o > onset[f2 + 1] && f2 - lastFrame >= minFrameGap) {
        var lowTone = Math.min(2.2, bandAt(lowEnergy, f2) / lowRef);
        var bodyTone = Math.min(2.2, bandAt(bodyEnergy, f2) / bodyRef);
        var snapTone = Math.min(2.2, bandAt(snapEnergy, f2) / snapRef);
        var lowDom = lowTone / Math.max(0.001, bodyTone * 0.46 + snapTone * 0.18);
        var score = (o - th) / Math.max(0.0008, std + mean * 0.42);
        var kickLike = lowTone > 0.42 && (lowDom > 0.92 || lowTone > 0.82);
        if (kickLike && score > 0.28) {
          candidates.push({
            frame: f2,
            time: f2 * hopSec,
            score: score,
            lowTone: lowTone,
            bodyTone: bodyTone,
            snapTone: snapTone,
            lowDom: lowDom,
            raw: o
          });
          lastFrame = f2;
        }
      }
      var old = onset[f2 - winN] || 0;
      var next = onset[f2] || 0;
      sum += next - old;
      sq += next * next - old * old;
      if (f2 > winN && f2 % 2200 === 0) {
        await yieldToPaint();
        if (token !== djBeatMapToken || !djMode.active) { hideBeatChip(); return null; }
      }
    }

    if (!candidates.length) {
      hideBeatChip();
      return { kicks: [], beats: [], pulseBeats: [], cameraBeats: [], duration: buffer.duration, visualBeatCount: 0, tempoSource: 'podcast-dj-empty', analyzedAt: Date.now() };
    }

    var strong = candidates.filter(function(c){ return c.score > 0.52 && c.lowTone > 0.52; });
    if (strong.length < 8) strong = candidates.slice();
    var allGaps = [];
    for (var gi = 1; gi < strong.length; gi++) {
      var g = strong[gi].time - strong[gi - 1].time;
      while (g > 0.94) g *= 0.5;
      while (g < 0.30) g *= 2.0;
      if (g >= 0.30 && g <= 0.94) allGaps.push(g);
    }
    var globalStep = median(allGaps) || 0.50;
    var sectionLen = 48;
    var sectionCount = Math.max(1, Math.ceil(buffer.duration / sectionLen));
    var sectionSteps = [];
    for (var si = 0; si < sectionCount; si++) {
      var t0 = si * sectionLen, t1 = t0 + sectionLen;
      var seg = strong.filter(function(c){ return c.time >= t0 && c.time < t1; });
      var gaps = [];
      for (var sg = 1; sg < seg.length; sg++) {
        var gap = seg[sg].time - seg[sg - 1].time;
        while (gap > 0.94) gap *= 0.5;
        while (gap < 0.30) gap *= 2.0;
        if (gap >= 0.30 && gap <= 0.94) gaps.push(gap);
      }
      var prevSectionStep = sectionSteps.length ? sectionSteps[sectionSteps.length - 1] : globalStep;
      var step = median(gaps) || prevSectionStep || globalStep;
      if (globalStep) step = clampRange(step, globalStep * 0.90, globalStep * 1.10);
      if (prevSectionStep && Math.abs(step - prevSectionStep) / prevSectionStep > 0.08) {
        step = step * 0.28 + prevSectionStep * 0.72;
      } else if (prevSectionStep) {
        step = step * 0.42 + prevSectionStep * 0.58;
      }
      sectionSteps.push(step || globalStep);
    }
    function stepAt(time) {
      var idx = Math.max(0, Math.min(sectionSteps.length - 1, Math.floor(time / sectionLen)));
      return sectionSteps[idx] || globalStep || 0.50;
    }

    var powers = candidates.map(function(c){
      c.power = c.score * 0.50 + c.lowTone * 0.26 + Math.min(1.8, c.lowDom) * 0.16 + c.bodyTone * 0.06 + c.snapTone * 0.02;
      return c.power;
    });
    var p35 = percentile(powers, 0.35);
    var p50 = percentile(powers, 0.50);
    var p90 = Math.max(p50 + 0.001, percentile(powers, 0.90));
    var phaseSource = strong.length ? strong : candidates;
    var phaseCandidates = phaseSource.filter(function(c){ return c.time < Math.min(buffer.duration, 120); }).slice(0, 56);
    if (!phaseCandidates.length) phaseCandidates = phaseSource.slice(0, 1);
    function nearestCandidate(center, windowSec, startIdx) {
      var best = null;
      var bestScore = -Infinity;
      var j = startIdx || 0;
      while (j < candidates.length && candidates[j].time < center - windowSec) j++;
      for (var ni = j; ni < candidates.length && candidates[ni].time <= center + windowSec; ni++) {
        var dist = Math.abs(candidates[ni].time - center);
        var score = candidates[ni].power * (1 - dist / Math.max(0.001, windowSec) * 0.48);
        if (score > bestScore) {
          best = candidates[ni];
          bestScore = score;
        }
      }
      return best;
    }
    function scorePhase(anchorTime) {
      var step = globalStep || 0.50;
      var start = anchorTime;
      while (start - step > 0.05) start -= step;
      var end = Math.min(buffer.duration, 132);
      var win = Math.max(0.060, Math.min(0.130, step * 0.18));
      var score = 0, count = 0, cursor = 0;
      for (var gt = start; gt < end; gt += step) {
        while (cursor < candidates.length && candidates[cursor].time < gt - win) cursor++;
        var best = null, bestScore = 0;
        for (var pi = cursor; pi < candidates.length && candidates[pi].time <= gt + win; pi++) {
          var dist = Math.abs(candidates[pi].time - gt);
          var s = candidates[pi].power * (1 - dist / win * 0.45);
          if (s > bestScore) { bestScore = s; best = candidates[pi]; }
        }
        if (best) score += bestScore;
        else score -= p35 * 0.10;
        count++;
      }
      return count ? score / count : -Infinity;
    }
    var bestAnchor = phaseCandidates[0] ? phaseCandidates[0].time : 0;
    var bestAnchorScore = -Infinity;
    for (var pa = 0; pa < phaseCandidates.length; pa++) {
      var sc = scorePhase(phaseCandidates[pa].time);
      if (sc > bestAnchorScore) {
        bestAnchorScore = sc;
        bestAnchor = phaseCandidates[pa].time;
      }
    }
    var anchor = bestAnchor;
    while (anchor - (globalStep || 0.50) > 0.05) anchor -= (globalStep || 0.50);

    var beats = [];
    var gridIndex = 0;
    var cursorIdx = 0;
    for (var gridT = anchor; gridT < buffer.duration - 0.05; ) {
      var localStep = stepAt(gridT) || globalStep || 0.50;
      var winSec = Math.max(0.070, Math.min(0.145, localStep * 0.22));
      while (cursorIdx < candidates.length && candidates[cursorIdx].time < gridT - winSec) cursorIdx++;
      var bestCand = nearestCandidate(gridT, winSec, cursorIdx);
      var gf = Math.max(0, Math.min(nFrames - 1, Math.round(gridT / hopSec)));
      var gridLowTone = Math.min(2.2, bandAt(lowEnergy, gf) / lowRef);
      var gridBodyTone = Math.min(2.2, bandAt(bodyEnergy, gf) / bodyRef);
      var gridSnapTone = Math.min(2.2, bandAt(snapEnergy, gf) / snapRef);
      var sourceTime = bestCand ? (gridT * 0.38 + bestCand.time * 0.62) : gridT;
      var powerBase = bestCand ? bestCand.power : (gridLowTone * 0.22 + gridBodyTone * 0.04 + gridSnapTone * 0.02);
      var distPenalty = bestCand ? (1 - Math.min(1, Math.abs(bestCand.time - gridT) / winSec) * 0.30) : 0.58;
      var powerRel = clamp01(((powerBase * distPenalty) - p35 * 0.78) / Math.max(0.001, p90 - p35 * 0.78));
      var lowTone2 = bestCand ? Math.max(gridLowTone * 0.55, bestCand.lowTone) : gridLowTone;
      var bodyTone2 = bestCand ? Math.max(gridBodyTone * 0.50, bestCand.bodyTone) : gridBodyTone;
      var snapTone2 = bestCand ? Math.max(gridSnapTone * 0.50, bestCand.snapTone) : gridSnapTone;
      var toneTotal = Math.max(0.001, lowTone2 + bodyTone2 * 0.72 + snapTone2 * 0.48);
      var lowMix = lowTone2 / toneTotal;
      var bodyMix = (bodyTone2 * 0.72) / toneTotal;
      var snapMix = (snapTone2 * 0.48) / toneTotal;
      var comboSlot = gridIndex % 4;
      var combo = comboSlot === 0 ? 'downbeat' : (comboSlot === 1 ? 'push' : (comboSlot === 2 ? 'drop' : 'rebound'));
      if (powerRel > 0.86 && combo !== 'downbeat') combo = 'accent';
      var weakGrid = !bestCand && gridLowTone < 0.50 && powerRel < 0.24;
      if (!weakGrid || comboSlot === 0 || powerRel > 0.18) {
        var downLift = combo === 'downbeat' ? 0.06 : 0;
        var strength = Math.max(0.18, Math.min(0.94, 0.20 + Math.pow(powerRel, 1.22) * 0.54 + lowMix * 0.08 + downLift));
        var impact = Math.max(0.10, Math.min(0.96, Math.pow(powerRel, 1.36) * 0.82 + lowMix * 0.12 + downLift));
        beats.push({
          time: sourceTime,
          strength: strength,
          confidence: Math.max(0.46, Math.min(0.98, 0.50 + powerRel * 0.38 + lowMix * 0.10 - (bestCand ? 0 : 0.10))),
          impact: impact,
          primary: true,
          camera: true,
          pulse: impact > 0.18 || combo === 'downbeat',
          tone: 'podcast-dj-grid',
          low: Math.max(0.24, Math.min(0.90, lowMix * 0.78 + powerRel * 0.18)),
          body: Math.max(0.03, Math.min(0.60, bodyMix)),
          snap: Math.max(0.02, Math.min(0.50, snapMix)),
          mass: Math.max(0.28, Math.min(0.96, lowMix * 0.74 + Math.pow(powerRel, 1.25) * 0.24)),
          sharpness: Math.max(0.03, Math.min(0.62, snapMix * 1.10)),
          combo: combo,
          step: localStep,
          index: beats.length,
          dj: true,
          grid: true
        });
      }
      gridIndex++;
      gridT += localStep;
      if (gridIndex > 0 && gridIndex % 1800 === 0) {
        await yieldToPaint();
        if (token !== djBeatMapToken || !djMode.active) { hideBeatChip(); return null; }
      }
    }

    var pulseBeats = beats.filter(function(b){ return b.strength >= 0.38 || b.combo === 'downbeat'; }).map(function(b){
      return { time: b.time, strength: b.strength, impact: b.impact, combo: b.combo, low: b.low, body: b.body, snap: b.snap, dj: true };
    });
    await yieldToPaint();
    if (token !== djBeatMapToken || !djMode.active) { hideBeatChip(); return null; }
    return {
      kicks: beats.map(function(b){ return b.time; }),
      beats: beats,
      pulseBeats: pulseBeats,
      cameraBeats: beats,
      gridStep: globalStep,
      sectionSteps: sectionSteps,
      tempoSource: 'podcast-dj-offline',
      duration: buffer.duration,
      visualBeatCount: beats.length,
      analyzedAt: Date.now()
    };
  } catch (err) {
    console.warn('podcast DJ analysis failed:', err);
    hideBeatChip();
    return null;
  } finally {
    djBeatMapBusy = false;
  }
}

function applyPodcastDjProfileFromMap(map) {
  if (!map || !djMode.active) return;
  var density = (map.cameraBeats || []).length / Math.max(20, map.duration || 20);
  cinemaTrackProfile.density = density;
  var target = 0.82 + clamp01((density - 1.25) / 1.8) * 0.16;
  target = clampRange(target, 0.76, 1.10);
  cinemaTrackProfile.target = target;
  cinemaTrackProfile.scale += (target - cinemaTrackProfile.scale) * 0.34;
}

function smoothPodcastDjMapHandoff(songKey, map, token) {
  if (!map) return;
  showBeatChip('DJ 锁拍完成…');
  var apply = function() {
    if (token !== djBeatMapToken || !djMode.active || djMode.songKey !== songKey) return;
    djBeatMapCache[songKey] = map;
    currentDjBeatMap = map;
    applyPodcastDjProfileFromMap(map);
    syncPodcastDjMapCursor(audio ? audio.currentTime : 0, true);
    notifyDesktopLyricsBeatMapReady();
    hideBeatChip();
    showToast('DJ 离线锁拍完成: ' + (map.visualBeatCount || 0) + ' 个主拍');
  };
  scheduleVisualApply(apply, 260, 360);
}

function smoothPodcastDjIntroHandoff(songKey, map, token) {
  if (!map || !map.partial) return;
  if (currentDjBeatMap && !currentDjBeatMap.partial) return;
  var apply = function() {
    if (token !== djBeatMapToken || !djMode.active || djMode.songKey !== songKey) return;
    if (currentDjBeatMap && !currentDjBeatMap.partial) return;
    currentDjBeatMap = map;
    applyPodcastDjProfileFromMap(map);
    syncPodcastDjMapCursor(audio ? audio.currentTime : 0, true);
    notifyDesktopLyricsBeatMapReady();
    showBeatChip('DJ 开头已锁拍，全曲继续分析…');
  };
  scheduleVisualApply(apply, 0, 240);
}

function showBeatChip(text) {
  document.getElementById('beat-text').textContent = text || '分析节奏…';
  document.getElementById('beat-chip').classList.add('show');
  if (localBeatAnalysis && localBeatAnalysis.active) setLocalBeatStatus(text || '分析中...', 'warn');
}
function hideBeatChip() {
  document.getElementById('beat-chip').classList.remove('show');
}

function localBeatRound(v, scale) {
  v = Number(v);
  if (!isFinite(v)) return 0;
  scale = scale || 1000;
  return Math.round(v * scale) / scale;
}
function packLocalBeatEvent(ev) {
  if (typeof ev === 'number') return [localBeatRound(ev, 1000), 0.42, 0.72, 0.42, 0.62, 0.22, 0.16, 0, 7, 0.62, 0.12, 0];
  ev = ev || {};
  var comboIdx = Math.max(0, LOCAL_BEAT_COMBOS.indexOf(ev.combo || ''));
  var flags = 0;
  if (ev.primary !== false) flags |= 1;
  if (ev.camera !== false) flags |= 2;
  if (ev.pulse !== false) flags |= 4;
  if (ev.dj) flags |= 8;
  if (ev.grid) flags |= 16;
  if (ev.kickOnly) flags |= 32;
  return [
    localBeatRound(ev.time, 1000),
    localBeatRound(ev.strength == null ? 0.42 : ev.strength, 1000),
    localBeatRound(ev.confidence == null ? 0.72 : ev.confidence, 1000),
    localBeatRound(ev.impact == null ? (ev.strength == null ? 0.42 : ev.strength) : ev.impact, 1000),
    localBeatRound(ev.low == null ? 0.62 : ev.low, 1000),
    localBeatRound(ev.body == null ? 0.22 : ev.body, 1000),
    localBeatRound(ev.snap == null ? 0.16 : ev.snap, 1000),
    comboIdx,
    flags,
    localBeatRound(ev.mass == null ? 0.62 : ev.mass, 1000),
    localBeatRound(ev.sharpness == null ? 0.12 : ev.sharpness, 1000),
    localBeatRound(ev.step || 0, 1000)
  ];
}
function packLocalBeatMap(map) {
  if (!map) return null;
  var camera = (map.cameraBeats || map.beats || map.kicks || []).map(packLocalBeatEvent);
  var pulse = (map.pulseBeats || map.kicks || []).map(packLocalBeatEvent);
  return {
    v: 1,
    duration: localBeatRound(map.duration || 0, 1000),
    gridStep: localBeatRound(map.gridStep || 0, 1000),
    sectionSteps: (map.sectionSteps || []).map(function(v){ return localBeatRound(v, 1000); }),
    tempoSource: map.tempoSource || 'local',
    visualBeatCount: map.visualBeatCount || camera.length,
    analyzedAt: map.analyzedAt || Date.now(),
    partial: !!map.partial,
    partialUntilSec: map.partialUntilSec || 0,
    cameraBeats: camera,
    pulseBeats: pulse
  };
}
function saveLocalBeatPrefs() {
  try { localStorage.setItem(LOCAL_BEAT_PREF_STORE_KEY, JSON.stringify(localBeatMapPrefs || {})); } catch (e) {}
}
function packLocalBeatCache(maxEntries) {
  var entries = Object.keys(localBeatMapCache || {}).map(function(key){
    var entry = localBeatMapCache[key] || {};
    return { key:key, updatedAt: entry.updatedAt || 0, entry:entry };
  }).sort(function(a,b){ return b.updatedAt - a.updatedAt; });
  if (maxEntries) entries = entries.slice(0, maxEntries);
  var packed = {};
  entries.forEach(function(item){
    packed[item.key] = { updatedAt: item.entry.updatedAt || Date.now() };
    if (item.entry.mr) packed[item.key].mr = packLocalBeatMap(item.entry.mr);
    if (item.entry.dj) packed[item.key].dj = packLocalBeatMap(item.entry.dj);
  });
  return packed;
}
function saveLocalBeatMapCache() {
  var attempts = [12, 8, 5, 3];
  for (var i = 0; i < attempts.length; i++) {
    try {
      localStorage.setItem(LOCAL_BEATMAP_STORE_KEY, JSON.stringify(packLocalBeatCache(attempts[i])));
      return true;
    } catch (e) {}
  }
  return false;
}
function getLocalBeatEntry(localKey, mode) {
  var entry = localKey && localBeatMapCache ? localBeatMapCache[localKey] : null;
  return entry && entry[mode] ? entry[mode] : null;
}
function storeLocalBeatEntry(localKey, mode, map, song, opts) {
  if (!localKey || !map) return;
  opts = opts || {};
  var entry = localBeatMapCache[localKey] || {};
  entry[mode] = map;
  entry.updatedAt = Date.now();
  localBeatMapCache[localKey] = entry;
  localBeatMapPrefs[localKey] = mode;
  saveLocalBeatPrefs();
  saveLocalBeatMapCache();
  if (!opts.skipDisk) writeBeatDiskCache(localBeatDiskKey(localKey, mode), map, song || { type:'local', localKey:localKey }, mode);
}
function setLocalBeatStatus(text, tone) {
  var el = document.getElementById('local-beat-status');
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('warn', tone === 'warn');
  el.classList.toggle('fail', tone === 'fail');
}

function localBeatVisualCount(map) {
  return map ? (map.visualBeatCount || (map.cameraBeats && map.cameraBeats.length) || (map.beats && map.beats.length) || 0) : 0;
}
function setLocalBeatPreference(localKey, mode) {
  if (!localKey) return;
  localBeatMapPrefs[localKey] = mode === 'dj' ? 'dj' : 'mr';
  saveLocalBeatPrefs();
}
function applyLocalBeatMap(song, mode, map, fromCache) {
  if (!song || !song.localKey || !map) return false;
  mode = mode === 'dj' ? 'dj' : 'mr';
  song.localBeatMode = mode;
  setLocalBeatPreference(song.localKey, mode);
  if (mode === 'dj') {
    setDjModeActive(true, song);
    currentBeatMap = null;
    beatMapNextIdx = 0;
    currentDjBeatMap = map;
    djBeatMapCache[djSongKey(song)] = map;
    applyPodcastDjProfileFromMap(map);
    syncPodcastDjMapCursor(audio ? audio.currentTime : 0, true);
    maybeAnnounceDjMode();
  } else {
    setDjModeActive(false, song);
    currentBeatMap = map;
    beatMapCache['local:' + song.localKey] = map;
    applyCinemaProfileFromBeatMap(map);
    syncBeatMapPlaybackCursor(audio ? audio.currentTime : 0, true);
  }
  hideBeatChip();
  notifyDesktopLyricsBeatMapReady();
  if (fromCache) showToast((mode === 'dj' ? 'DJ' : 'MR') + ' 本地节奏缓存已载入');
  return true;
}

/* 本地歌曲的节奏分析入口：先查内存/D盘缓存，命中就直接套用；都没有才弹「选 MR 还是 DJ」的框。
 *
 * ⚠️ 这个函数曾在移植上游「本地音乐库」（def9f86）时被漏掉调用 —— 那次把旧的
 * 「单文件 objectURL 直接播放」整段重写成 importLocalAudioSongs() → playQueueAt()，
 * 只搬了函数体没搬调用点，于是它变成零引用，2026-09-23 被当死代码删掉，
 * 连带把 openLocalBeatModal 变成孤儿（本地节拍功能静默失效 6 天）。
 *
 * 2026-09-23 按上游 2.2.0 原样恢复：上游在 public/js/modules/05-playback/13-playback-start-audio.js
 * 里用 setTimeout(…, firstVisualPlay ? 680 : 520) 调用它，本项目的调用点在 playQueueAt
 * 的 isLocalPlayback 分支（搜 prepareLocalBeatAnalysis( 可定位）。
 * 恢复时同时补回了 currentLocalSong = song —— 少了它，下面所有 localKey 守卫都会直接 return。 */
function prepareLocalBeatAnalysis(song, audioUrl) {
  if (!song || !song.localKey || !audioUrl) return;
  var preferred = localBeatMapPrefs[song.localKey] === 'dj' ? 'dj' : 'mr';
  var cached = getLocalBeatEntry(song.localKey, preferred) ||
    getLocalBeatEntry(song.localKey, preferred === 'dj' ? 'mr' : 'dj');
  if (cached) {
    applyLocalBeatMap(song, cached === getLocalBeatEntry(song.localKey, 'dj') ? 'dj' : 'mr', cached, true);
    return;
  }
  var diskToken = trackSwitchToken;
  (async function(){
    var firstMode = preferred;
    var secondMode = preferred === 'dj' ? 'mr' : 'dj';
    var firstMap = await readBeatDiskCache(localBeatDiskKey(song.localKey, firstMode));
    var mode = firstMap ? firstMode : secondMode;
    var map = firstMap || await readBeatDiskCache(localBeatDiskKey(song.localKey, secondMode));
    if (diskToken !== trackSwitchToken || !currentLocalSong || currentLocalSong.localKey !== song.localKey) return;
    if (map) {
      storeLocalBeatEntry(song.localKey, mode, map, song, { skipDisk:true });
      applyLocalBeatMap(song, mode, map, true);
      return;
    }
    openLocalBeatModal(song, audioUrl);
  })().catch(function(){
    if (diskToken === trackSwitchToken && currentLocalSong && currentLocalSong.localKey === song.localKey) openLocalBeatModal(song, audioUrl);
  });
}
/* #local-beat-modal 的唯一打开入口，由上面的 prepareLocalBeatAnalysis 调用。
 * 模态框 UI 在 index.html:1003，按钮走 inline onclick（closeLocalBeatModal / selectLocalBeatMode /
 * startLocalBeatAnalysis）。⚠️ 别当死代码删 —— 它连着用户可见功能。 */
function openLocalBeatModal(song, audioUrl) {
  if (immersiveMode) setImmersiveMode(false);
  localBeatAnalysis.song = song || currentLocalSong;
  localBeatAnalysis.audioUrl = audioUrl || (audio && audio.src) || '';
  localBeatAnalysis.mode = (localBeatAnalysis.song && localBeatMapPrefs[localBeatAnalysis.song.localKey] === 'dj') ? 'dj' : 'mr';
  localBeatAnalysis.active = false;
  setLocalBeatStatus('', '');
  updateLocalBeatModal();
  openGsapModal(document.getElementById('local-beat-modal'));
}
function closeLocalBeatModal() {
  if (localBeatAnalysis.active) return;
  closeGsapModal(document.getElementById('local-beat-modal'));
}
function selectLocalBeatMode(mode) {
  if (localBeatAnalysis.active) return;
  localBeatAnalysis.mode = mode === 'dj' ? 'dj' : 'mr';
  updateLocalBeatModal();
}
function updateLocalBeatModal() {
  var song = localBeatAnalysis.song || currentLocalSong || {};
  var mode = localBeatAnalysis.mode === 'dj' ? 'dj' : 'mr';
  var modal = document.querySelector('#local-beat-modal .local-beat-modal');
  if (modal) modal.classList.toggle('analyzing', !!localBeatAnalysis.active);
  var title = document.getElementById('local-beat-title');
  var sub = document.getElementById('local-beat-sub');
  if (title) title.textContent = song.name || '本地歌曲';
  if (sub) {
    var cachedBits = [];
    if (song.localKey && getLocalBeatEntry(song.localKey, 'mr')) cachedBits.push('MR 已缓存');
    if (song.localKey && getLocalBeatEntry(song.localKey, 'dj')) cachedBits.push('DJ 已缓存');
    sub.textContent = cachedBits.length ? cachedBits.join(' / ') : '选择一种电影视角分析方式';
  }
  var mr = document.getElementById('local-beat-tab-mr');
  var dj = document.getElementById('local-beat-tab-dj');
  if (mr) mr.classList.toggle('active', mode === 'mr');
  if (dj) dj.classList.toggle('active', mode === 'dj');
  var desc = document.getElementById('local-beat-desc');
  if (desc) desc.textContent = mode === 'dj'
    ? '适合 DJ、长混音或鼓点密集的本地音频，会使用更稳定的低频锁拍并进入 DJ 视觉驱动。'
    : '适合普通歌曲和日常播放，会沿用 BhandsMusic 电影视角的综合节奏分析。';
  var start = document.getElementById('local-beat-start-btn');
  var cancel = document.getElementById('local-beat-cancel-btn');
  var later = document.getElementById('local-beat-later-btn');
  if (start) {
    start.disabled = !!localBeatAnalysis.active;
    start.textContent = getLocalBeatEntry(song.localKey, mode) ? '使用缓存' : '开始分析';
  }
  if (cancel) cancel.style.display = localBeatAnalysis.active ? '' : 'none';
  if (later) later.style.display = localBeatAnalysis.active ? 'none' : '';
}
function cancelLocalBeatAnalysis() {
  if (!localBeatAnalysis.active) {
    closeLocalBeatModal();
    return;
  }
  localBeatAnalysis.active = false;
  localBeatAnalysis.token++;
  beatMapToken++;
  djBeatMapToken++;
  beatMapBusy = false;
  djBeatMapBusy = false;
  cancelBeatAnalysisTimer();
  cancelDjBeatAnalysisTimer();
  hideBeatChip();
  if (localBeatAnalysis.mode === 'dj') setDjModeActive(false, localBeatAnalysis.song || currentLocalSong);
  setLocalBeatStatus('已取消分析', 'fail');
  updateLocalBeatModal();
}
async function startLocalBeatAnalysis(mode) {
  var song = localBeatAnalysis.song || currentLocalSong;
  var audioUrl = localBeatAnalysis.audioUrl || (song && song.localUrl) || (audio && audio.src) || '';
  mode = mode || localBeatAnalysis.mode;
  mode = mode === 'dj' ? 'dj' : 'mr';
  if (!song || !song.localKey || !audioUrl || localBeatAnalysis.active) return;
  var cached = getLocalBeatEntry(song.localKey, mode);
  if (cached) {
    applyLocalBeatMap(song, mode, cached, true);
    closeGsapModal(document.getElementById('local-beat-modal'));
    return;
  }
  localBeatAnalysis.active = true;
  localBeatAnalysis.mode = mode;
  localBeatAnalysis.token++;
  var localToken = localBeatAnalysis.token;
  updateLocalBeatModal();
  setLocalBeatStatus((mode === 'dj' ? 'DJ' : 'MR') + ' 分析准备中...', 'warn');
  try {
    var map = null;
    if (mode === 'dj') {
      setDjModeActive(true, song);
      djBeatMapToken++;
      resetDjBeatMapState();
      currentBeatMap = null;
      resetBeatCameraSync(audio ? audio.currentTime : 0);
      var djToken = djBeatMapToken;
      map = await analyzePodcastDjBeats(audioUrl, djToken, audio && isFinite(audio.duration) ? audio.duration : 0);
      if (localToken !== localBeatAnalysis.token || djToken !== djBeatMapToken) return;
      if (!map) throw new Error('DJ analysis returned empty map');
    } else {
      setDjModeActive(false, song);
      beatMapToken++;
      currentBeatMap = null;
      beatMapNextIdx = 0;
      resetBeatCameraSync(audio ? audio.currentTime : 0);
      var mrToken = beatMapToken;
      map = await analyzeAudioBeats(audioUrl, audio && isFinite(audio.duration) ? audio.duration : 0, mrToken, { background:false, song: song });
      if (localToken !== localBeatAnalysis.token || mrToken !== beatMapToken) return;
      if (!map) throw new Error('MR analysis returned empty map');
    }
    storeLocalBeatEntry(song.localKey, mode, map, song);
    applyLocalBeatMap(song, mode, map, false);
    localBeatAnalysis.active = false;
    setLocalBeatStatus((mode === 'dj' ? 'DJ' : 'MR') + ' 分析完成: ' + localBeatVisualCount(map) + ' 个主拍');
    updateLocalBeatModal();
    showToast((mode === 'dj' ? 'DJ' : 'MR') + ' 本地节奏分析完成');
    setTimeout(function(){
      if (!localBeatAnalysis.active) closeGsapModal(document.getElementById('local-beat-modal'));
    }, 900);
  } catch (err) {
    console.warn('local beat analysis failed:', err);
    localBeatAnalysis.active = false;
    hideBeatChip();
    if (mode === 'dj') setDjModeActive(false, song);
    setLocalBeatStatus('分析失败，请换另一种模式重试', 'fail');
    updateLocalBeatModal();
    showToast('本地节奏分析失败');
  }
}

function smoothBeatMapHandoff(songId, map, token, song) {
  if (!map) return;
  showBeatChip('节奏缓冲中…');
  var wait = Math.max(260, Math.min(720, 340 + (beatPulse + beatCam.punch) * 260));
  var apply = function() {
    if (token !== beatMapToken) return;
    beatMapCache[songId] = map;
    currentBeatMap = map;
    applyCinemaProfileFromBeatMap(map);
    var t = audio ? audio.currentTime : 0;
    syncBeatMapPlaybackCursor(t, true);
    hideBeatChip();
    notifyDesktopLyricsBeatMapReady();
    showToast('节奏分析完成: ' + (map.visualBeatCount || (map.cameraBeats && map.cameraBeats.length) || 0) + ' 个视觉主拍');
    writeBeatDiskCache(songId, map, song, 'mr');
    scheduleQueueBeatPrefetch(currentIdx, 1000);
  };
  scheduleVisualApply(apply, wait, 460);
}

function applyBeatMapCacheForCurrent(songId, map, token, message) {
  if (!songId || !map || token !== beatMapToken) return false;
  beatMapCache[songId] = map;
  currentBeatMap = map;
  applyCinemaProfileFromBeatMap(map);
  syncBeatMapPlaybackCursor(audio ? audio.currentTime : 0, true);
  hideBeatChip();
  notifyDesktopLyricsBeatMapReady();
  if (message) console.log(message, songId, map.visualBeatCount || 0);
  scheduleQueueBeatPrefetch(currentIdx, 1000);
  return true;
}

// 每帧调用 — 按 beatMap 触发预演鼓点
function syncBeatMapPlaybackCursor(t, preserveVisualState) {
  if (djMode.active) {
    syncPodcastDjMapCursor(t, preserveVisualState);
    return;
  }
  t = isFinite(t) ? t : 0;
  beatMapNextIdx = 0;
  var pulseEvents = currentBeatMap && (currentBeatMap.pulseBeats || currentBeatMap.kicks);
  if (pulseEvents) {
    while (beatMapNextIdx < pulseEvents.length && beatEventTime(pulseEvents[beatMapNextIdx]) < t) beatMapNextIdx++;
  }
  if (preserveVisualState) alignBeatCameraCursorToTime(t);
  else syncBeatCameraToTime(t);
}

function syncPodcastDjMapCursor(t, preserveVisualState) {
  t = isFinite(t) ? t : 0;
  djBeatMapNextIdx = 0;
  djBeatPulseNextIdx = 0;
  if (currentDjBeatMap) {
    var beatEvents = currentDjBeatMap.cameraBeats || currentDjBeatMap.beats || currentDjBeatMap.kicks || [];
    var camSyncTime = Math.max(0, t - 0.025);
    while (djBeatMapNextIdx < beatEvents.length && beatEventTime(beatEvents[djBeatMapNextIdx]) < camSyncTime) djBeatMapNextIdx++;
    var pulseEvents = currentDjBeatMap.pulseBeats || currentDjBeatMap.kicks || [];
    var pulseSyncTime = Math.max(0, t - 0.035);
    while (djBeatPulseNextIdx < pulseEvents.length && beatEventTime(pulseEvents[djBeatPulseNextIdx]) < pulseSyncTime) djBeatPulseNextIdx++;
  }
  if (!preserveVisualState) resetBeatCameraSync(t);
}

function tickPodcastDjBeatMap() {
  if (!djMode.active || !currentDjBeatMap || !audio || audio.paused) return;
  var t = audio.currentTime || 0;
  if (currentDjBeatMap.partialUntilSec && t > currentDjBeatMap.partialUntilSec + beatCam.lookahead) return;
  var beatEvents = currentDjBeatMap.cameraBeats || currentDjBeatMap.beats || currentDjBeatMap.kicks || [];
  var pulseEvents = currentDjBeatMap.pulseBeats || currentDjBeatMap.kicks || [];
  while (djBeatMapNextIdx < beatEvents.length) {
    var beat = beatEvents[djBeatMapNextIdx];
    var beatTime = beatEventTime(beat);
    if (beatTime > t + beatCam.lookahead) break;
    scheduleBeatCamera(beat, 'djmap');
    djBeatMapNextIdx++;
  }
  while (djBeatPulseNextIdx < pulseEvents.length && beatEventTime(pulseEvents[djBeatPulseNextIdx]) <= t) {
    triggerScheduledBeat(pulseEvents[djBeatPulseNextIdx]);
    djBeatPulseNextIdx++;
  }
}

function tickBeatMap() {
  if (djMode.active) return;
  if (!currentBeatMap || !audio || audio.paused) return;
  var t = audio.currentTime;
  var beatEvents = currentBeatMap.cameraBeats || currentBeatMap.beats || currentBeatMap.kicks || [];
  var pulseEvents = currentBeatMap.pulseBeats || currentBeatMap.kicks || [];
  var gridTimingLocked = currentBeatMap.tempoSource === 'music-tempo' && beatEvents.length >= 4;
  var liveFreshWindow = Math.max(0.50, rtBeat.tempoGap ? rtBeat.tempoGap * 1.18 : 0.50);
  var realtimeHasLock = rtBeat.lastHitAt > 0 && (t - rtBeat.lastHitAt) < liveFreshWindow;
  while (beatCam.nextIdx < beatEvents.length) {
    var beat = beatEvents[beatCam.nextIdx];
    var beatTime = typeof beat === 'number' ? beat : beat.time;
    if (beatTime > t + beatCam.lookahead) break;
    if (gridTimingLocked || !realtimeHasLock) scheduleBeatCamera(beat, 'map');
    beatCam.nextIdx++;
  }
  while (beatMapNextIdx < pulseEvents.length && beatEventTime(pulseEvents[beatMapNextIdx]) <= t) {
    // 触发预演冲击
    if (gridTimingLocked || !realtimeHasLock) triggerScheduledBeat(pulseEvents[beatMapNextIdx]);
    beatMapNextIdx++;
  }
}

function triggerScheduledBeat(beat) {
  var strength = typeof beat === 'number' ? 0.42 : Math.max(0, Math.min(1, beat && beat.strength != null ? beat.strength : 0.42));
  var impact = typeof beat === 'number' ? strength : Math.max(0, Math.min(1, beat && beat.impact != null ? beat.impact : strength));
  if (impact < 0.18 && strength < 0.52) return;
  if ((cinemaTrackProfile.scale || 1) < 0.52 && impact < 0.46 && strength < 0.74) return;
  var body = typeof beat === 'number' ? 0 : Math.max(0, Math.min(1, beat && beat.body != null ? beat.body : 0));
  var combo = typeof beat === 'number' ? null : beat && beat.combo;
  var comboLift = combo === 'downbeat' ? 0.08 : (combo === 'drop' ? 0.04 : 0);
  var dynScale = cameraDynamicsScale(0.88 + impact * 0.16);
  var djPulse = beat && beat.dj;
  var pulse = (0.14 + strength * 0.46 + impact * 0.18 + body * 0.08 + comboLift) * dynScale;
  if (djPulse) pulse = (0.12 + strength * 0.50 + impact * 0.28 + comboLift * 0.70) * clampRange(dynScale, 0.78, 1.18);
  pulse = Math.min(djPulse ? 0.92 : 0.78, pulse);
  scheduledBeatPulse = Math.max(scheduledBeatPulse, pulse);
  scheduledBeatFlag = true;
}
var scheduledBeatPulse = 0;
var scheduledBeatFlag = false;
