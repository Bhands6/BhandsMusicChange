'use strict';

// ============================================================
//  07-shelf.js  ←  源 main.js §19–§21（基线 784afe6）
//  3D 歌单架双模式 / 二级内容框 / PSP 卡片交互
// ============================================================

// ============================================================
//  3D 歌单架 — 双模式 (off / side / stage)
//   - side:   现版本精修, 右侧 5 张卡微角度堆叠
//   - stage:  弧形排列, 居中, 有倒影, 当前卡片"呼吸+光环"
//             卡片间粒子穿梭, 切歌时飞出动画
// ============================================================
var shelfPinnedOpen = false;
var shelfForceQueue = false;
var shelfManager = null;
var shelfOpenAnimAt = -10;
var shelfHoverCue = { target: 0, value: 0, x: 0, y: 0, lastAt: 0, enteredAt: 0, zoneActive: false, guide: false };
var shelfVisibility = 0;  // 0..1, 侧栏自动隐藏的整体透明度系数
function isPortraitShelfViewport() {
  return innerHeight > innerWidth * 1.08;
}
function shelfLayoutProfile() {
  var portrait = isPortraitShelfViewport();
  var narrow = !portrait && innerWidth < 980;
  var skullShelf = shouldUseSkullSafeShelfCamera();
  var detailScale = portrait ? clampRange(innerWidth / 820, 0.70, 0.86) : (narrow ? 0.92 : 1.04);
  var shelfCtl = shelfSettings();
  return {
    portrait: portrait,
    narrow: narrow,
    sideX: (skullShelf ? (portrait ? 0.22 : (narrow ? 0.46 : 0.76)) : (portrait ? 1.56 : (narrow ? 2.48 : 3.18))) + shelfCtl.x,
    sideY: (skullShelf ? (portrait ? -0.22 : (narrow ? -0.30 : -0.34)) : 0) + shelfCtl.y,
    sideXStep: skullShelf ? (portrait ? 0.018 : 0.034) : (portrait ? 0.018 : 0.040),
    sideYStep: skullShelf ? (portrait ? 0.46 : 0.62) : (portrait ? 0.52 : 0.68),
    sideZ: (skullShelf ? (portrait ? 0.86 : 0.92) : (portrait ? 0.78 : 0.86)) + shelfCtl.z,
    sideZStep: skullShelf ? (portrait ? 0.108 : 0.158) : (portrait ? 0.118 : 0.170),
    sideEntryX: skullShelf ? (portrait ? 0.30 : 0.50) : (portrait ? 0.38 : 0.82),
    sideDetailShift: skullShelf ? (portrait ? 0.00 : 0.00) : (portrait ? 0.38 : 0.82),
    sideScale: (skullShelf ? (portrait ? 0.84 : (narrow ? 1.04 : 1.22)) : (portrait ? 0.70 : (narrow ? 0.86 : 1))) * shelfCtl.size,
    sideRotY: (skullShelf ? (portrait ? -0.085 : -0.190) : 0) + shelfCtl.angle,
    sideRotX: skullShelf ? (portrait ? 0.018 : 0.030) : 0,
    stageX: shelfCtl.x,
    stageXStep: portrait ? 0.92 : (narrow ? 1.22 : 1.55),
    stageY: (portrait ? -2.46 : -2.20) + shelfCtl.y,
    stageZ: (portrait ? 0.84 : 1.0) + shelfCtl.z,
    stageScale: (portrait ? 0.72 : (narrow ? 0.86 : 1)) * shelfCtl.size,
    detail: {
      x: (skullShelf ? (portrait ? 0.16 : (narrow ? 0.40 : 0.64)) : (portrait ? 0.38 : (narrow ? 0.96 : 1.28))) + shelfCtl.x * 0.62,
      y: (skullShelf ? (portrait ? -0.40 : -0.68) : (portrait ? 0.10 : 0.18)) + shelfCtl.y * 0.55,
      z: (skullShelf ? (portrait ? 1.10 : 1.22) : (portrait ? 1.28 : 1.36)) + shelfCtl.z * 0.45,
      rx: skullShelf ? (portrait ? 0.006 : 0.014) : (portrait ? -0.004 : -0.008),
      ry: (skullShelf ? (portrait ? -0.070 : -0.165) : 0) + shelfCtl.angle * 0.55,
      scale: (skullShelf ? detailScale * (portrait ? 0.88 : 1.02) : detailScale) * shelfCtl.size,
      rowStep: skullShelf ? (portrait ? 0.37 : 0.43) : (portrait ? 0.36 : 0.42),
      rowScale: skullShelf ? (portrait ? 0.90 : 1.02) : (portrait ? 0.88 : (narrow ? 0.96 : 1.00))
    }
  };
}
function shelfHotZoneWidth() {
  var ratio = isPortraitShelfViewport() ? 0.26 : 0.18;
  return Math.min(isPortraitShelfViewport() ? 280 : 360, Math.max(148, innerWidth * ratio));
}
function shelfPreviewUseZoneWidth() {
  return Math.min(820, Math.max(shelfHotZoneWidth(), innerWidth * 0.56));
}
function shelfWheelZoneWidth() {
  var portrait = isPortraitShelfViewport();
  var ratioWidth = innerWidth * (portrait ? 0.24 : 0.18);
  return Math.min(portrait ? 280 : 360, Math.max(shelfHotZoneWidth(), ratioWidth));
}
function isShelfClickZone(e) {
  var edge = shelfPinnedOpen ? Math.min(390, Math.max(210, innerWidth * 0.22)) : shelfHotZoneWidth();
  return e.clientX > innerWidth - edge && e.clientY > 130 && e.clientY < innerHeight - 150;
}
function isShelfPreviewUseZone(e) {
  var edge = shelfPreviewUseZoneWidth();
  return e.clientX > innerWidth - edge && e.clientY > 96 && e.clientY < innerHeight - 96;
}
function isShelfWheelZone(e) {
  var edge = shelfWheelZoneWidth();
  return e.clientX > innerWidth - edge && e.clientY > 116 && e.clientY < innerHeight - 116;
}
function canUseSideShelfWithoutPinnedOpen() {
  return !!shelfAlwaysVisible();
}
function shelfPreviewIsVisible() {
  return shelfHoverCue.guide || shelfHoverCue.zoneActive || shelfHoverCue.target > 0 || shelfHoverCue.value > 0.10 || shelfVisibility > 0.12;
}
function shelfAutoHiddenInputReady() {
  if (shelfPinnedOpen || shelfAlwaysVisible()) return true;
  if (shelfManager && shelfManager.hasOpenContent && shelfManager.hasOpenContent()) return true;
  return !!(shelfHoverCue.guide || shelfHoverCue.zoneActive || shelfHoverCue.value > 0.18 || shelfVisibility > 0.16);
}
function canShowShelfHoverCueAt(e) {
  if (!e) return false;
  if (!shelfHoverCue.guide) return false;
  if (document.body.classList.contains('splash-active')) return false;
  // 引导「3D 歌单架」步骤需要预览可见，不能被 visualGuideActive 自己挡住
  if (!shelfHoverCue.guide && (visualGuideActive || emptyHomeActive || homeForcedOpen)) return false;
  if (!shelfManager || !shelfManager.getMode || shelfManager.getMode() !== 'side') return false;
  if (shelfPinnedOpen) return false;
  if (shelfManager.hasOpenContent && shelfManager.hasOpenContent()) return false;
  if (isPointerOverUi(e)) return false;
  if (isShelfClickZone(e)) return true;
  return shelfPreviewIsVisible() && isShelfPreviewUseZone(e);
}
function shelfCueRect() {
  var w = shelfHotZoneWidth();
  var top = Math.max(136, innerHeight * 0.22);
  var h = Math.min(390, innerHeight - top - 142);
  return { left: innerWidth - w, top: top, width: w, height: h, right: innerWidth, bottom: top + h };
}
function shelfCueCenter() {
  var r = shelfCueRect();
  return { x: r.left + r.width * 0.58, y: r.top + r.height * 0.50 };
}
function setShelfGuideCueActive(on) {
  shelfHoverCue.guide = !!on;
  if (on) {
    var c = shelfCueCenter();
    shelfHoverCue.target = 1;
    shelfHoverCue.value = Math.max(shelfHoverCue.value, 0.72);
    shelfHoverCue.x = c.x;
    shelfHoverCue.y = c.y;
    shelfHoverCue.lastAt = performance.now();
  } else {
    shelfHoverCue.target = 0;
  }
}
function updateShelfHoverCueFromPointer(e) {
  if (!e) {
    if (!shelfHoverCue.guide) shelfHoverCue.target = 0;
    shelfHoverCue.zoneActive = false;
    shelfHoverCue.enteredAt = 0;
    return;
  }
  var active = false;
  var inZone = canShowShelfHoverCueAt(e);
  if (inZone && !shelfHoverCue.zoneActive) {
    shelfHoverCue.zoneActive = true;
    shelfHoverCue.enteredAt = performance.now();
  } else if (!inZone) {
    shelfHoverCue.zoneActive = false;
    shelfHoverCue.enteredAt = 0;
  }
  active = inZone;
  if (!shelfHoverCue.guide) shelfHoverCue.target = active ? 1 : 0;
  shelfHoverCue.x = e.clientX;
  shelfHoverCue.y = e.clientY;
  shelfHoverCue.lastAt = performance.now();
}
function tickShelfHoverCue(dt) {
  if (!shelfHoverCue.guide && shelfHoverCue.zoneActive) {
    var heldPointer = { clientX: shelfHoverCue.x, clientY: shelfHoverCue.y };
    if (canShowShelfHoverCueAt(heldPointer)) {
      if (performance.now() - shelfHoverCue.enteredAt > 260) shelfHoverCue.target = 1;
    } else {
      shelfHoverCue.zoneActive = false;
      shelfHoverCue.enteredAt = 0;
      shelfHoverCue.target = 0;
    }
  }
  if (!shelfHoverCue.guide && !shelfHoverCue.zoneActive && performance.now() - shelfHoverCue.lastAt > 650) shelfHoverCue.target = 0;
  var target = shelfHoverCue.guide ? 1 : shelfHoverCue.target;
  var rate = target > shelfHoverCue.value ? 0.12 : 0.10;
  shelfHoverCue.value += (target - shelfHoverCue.value) * Math.min(1, rate * Math.max(1, dt * 60));
  if (shelfHoverCue.value < 0.006 && !target) shelfHoverCue.value = 0;
  return shelfHoverCue.value;
}
function setShelfPinnedOpen(open, immediate) {
  var nextOpen = !!open;
  if (nextOpen && typeof suppressBottomControlsForShelf === 'function') suppressBottomControlsForShelf(980);
  if (nextOpen && !shelfPinnedOpen) {
    var nowT = uniforms && uniforms.uTime ? uniforms.uTime.value : performance.now() / 1000;
    var previewVisible = shelfHoverCue.guide || shelfHoverCue.value > 0.28 || shelfVisibility > 0.20;
    shelfOpenAnimAt = previewVisible ? nowT - 0.62 : nowT;
    shelfHoverCue.target = 0;
    shelfHoverCue.zoneActive = false;
    shelfHoverCue.enteredAt = 0;
  }
  shelfPinnedOpen = nextOpen;
  var hint = document.getElementById('hint');
  if (hint) hint.classList.toggle('shelf-hidden', shelfPinnedOpen || !!(shelfManager && shelfManager.hasOpenContent && shelfManager.hasOpenContent()));
  if (nextOpen && typeof setPeek === 'function') setPeek(document.getElementById('search-area'), false, 'search');
  if (typeof updateEmptyHomeVisibility === 'function') updateEmptyHomeVisibility({ forceLoad: false });
  if (shelfManager && shelfManager.hasOpenContent && shelfManager.hasOpenContent()) return;
  if (typeof setFocusZone === 'function') setFocusZone(shelfPinnedOpen ? 'shelf-side' : null, immediate);
}
function clearShelfPreviewOnPointerExit() {
  if (!shelfManager || !shelfManager.getMode || shelfManager.getMode() !== 'side') return;
  var hasContent = shelfManager.hasOpenContent && shelfManager.hasOpenContent();
  updateShelfHoverCueFromPointer(null);
  shelfHoverCue.target = 0;
  shelfHoverCue.value = 0;
  shelfHoverCue.zoneActive = false;
  shelfHoverCue.enteredAt = 0;
  if (typeof setShelfHoverTabVisible === 'function') setShelfHoverTabVisible(false);
  if (shelfManager && shelfManager.clearSelected) shelfManager.clearSelected();
  if (hasContent && shelfManager.closeContent) safeShelfCloseContent('shelf-mode-reset');
  if (shelfPinnedOpen) setShelfPinnedOpen(false, true);
  shelfVisibility = 0;
  if (typeof setFocusZone === 'function') setFocusZone(null, true);
}
function suppressShelfPreviewForPlaybackSwitch() {
  if (!shelfManager || !shelfManager.getMode || shelfManager.getMode() !== 'side') return;
  if (shelfPinnedOpen || (shelfManager.hasOpenContent && shelfManager.hasOpenContent())) return;
  updateShelfHoverCueFromPointer(null);
  shelfHoverCue.target = 0;
  shelfHoverCue.value = 0;
  shelfHoverCue.zoneActive = false;
  shelfHoverCue.enteredAt = 0;
  shelfHoverCue.guide = false;
  shelfVisibility = 0;
  if (typeof setShelfHoverTabVisible === 'function') setShelfHoverTabVisible(false);
  if (shelfManager && shelfManager.clearSelected) shelfManager.clearSelected();
  if (typeof setFocusZone === 'function') setFocusZone(null, true);
}
function makeShelfManager() {
  var group = null;
  var cards = [];          // [{canvas, ctx, texture, mesh, item, index, slot}]
  var allItems = [];
  var renderedStart = -1;
  var SHELF_VISIBLE_RADIUS = 5;
  var SHELF_MAX_RENDER = SHELF_VISIBLE_RADIUS * 2 + 1;
  var shelfPane = 'mine';       // mine | fav
  var collectionReveal = 0;     // 滚轮阻尼累积，用于打开/返回收藏歌单
  var paneMemory = { mine:0, fav:0 };
  var paneSwitchAt = -10;
  var paneSwitchDir = 1;
  var mode = 'side';
  var lastSig = '';
  var lastUpdate = 0;
  var lastCardRedrawAt = -10;
  var lastCardPulseBucket = -1;
  var cardBuildQueue = null;
  var selectedIdx = -1;

  // v7.2 PSP 风格状态
  var centerIdx = 0;          // 当前居中卡片 index (在 items 数组中的位置)
  var centerTarget = 0;       // 目标 centerIdx (插值)
  var centerSmooth = 0;       // 当前实际 centerIdx 平滑值
  var openCardIdx = -1;       // 已打开内容框的卡片 (-1 表示无)
  var contentList = null;     // 二级 PSP 滚动列表 manager
  var connectorParticles = null;
  var floorMirror = null;

  // 一次性返回完整 items 数组 (不只 5 张, 全部参与 PSP 滚动)
  function splitPlaylists() {
    var mine = [], fav = [];
    userPlaylists.forEach(function(pl) {
      (pl.subscribed ? fav : mine).push(pl);
    });
    return { mine: mine, fav: fav };
  }

  function shelfShowsPodcasts() {
    return !fx || fx.shelfShowPodcasts !== false;
  }

  function shelfMergesCollections() {
    return !!(fx && fx.shelfMergeCollections === true);
  }

  function activePlaylists() {
    var panes = splitPlaylists();
    if (shelfMergesCollections()) return panes.mine.concat(panes.fav);
    var source = (shelfPane === 'fav') ? panes.fav : panes.mine;
    if (!source.length && shelfPane === 'mine' && panes.fav.length) source = panes.fav;
    if (!source.length && shelfPane === 'fav' && panes.mine.length) source = panes.mine;
    return source;
  }

  function currentItems() {
    if (shelfForceQueue && playQueue.length) {
      return playQueue.map(function(song, idx){
        return { type:'queue', title: song.name, sub: song.artist || '未知歌手',
          cover: songCoverSrc(song, 360), tag: idx === currentIdx ? '正在播放' : ('#' + (idx+1)), queueIndex: idx };
      });
    }
    if (hasAnyPlatformLogin() && (userPlaylists.length || myPodcastCollections.length)) {
      var source = activePlaylists();
      var items = source.map(function(pl){
        var provider = pl.provider === 'qq' ? 'qq' : 'netease';
        var sourceLabel = provider === 'qq' ? 'QQ' : 'NE';
        return { type:'playlist', title: pl.name, sub:sourceLabel + ' · ' + (pl.trackCount||0)+' 首 · 播放 '+compactCount(pl.playCount||0),
          cover: pl.cover || '', tag: pl.subscribed ? '收藏歌单' : '我的歌单', playlistId: (provider === 'qq' ? 'qq:' : '') + pl.id, provider: provider };
      });
      if (shelfShowsPodcasts() && (shelfPane === 'mine' || shelfMergesCollections()) && myPodcastCollections.length) {
        myPodcastCollections.forEach(function(pc){
          items.push({ type:'podcastCollection', title: pc.title, sub:(pc.count || 0) + ' items', cover: pc.cover || '', tag:'我的播客', podcastKey: pc.key, itemType: pc.itemType });
        });
      }
      if (items.length) return items;
    }
    if (playQueue.length) {
      return playQueue.map(function(song, idx){
        return { type:'queue', title: song.name, sub: song.artist || '未知歌手',
          cover: songCoverSrc(song, 360), tag: idx === currentIdx ? '正在播放' : ('#' + (idx+1)), queueIndex: idx };
      });
    }
    return [];
  }

  function makeRoundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
    ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
  }
  function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
    var chars = String(text || '').split('');
    var line = '', lines = [];
    for (var i = 0; i < chars.length; i++) {
      var test = line + chars[i];
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line); line = chars[i];
        if (lines.length >= maxLines - 1) break;
      } else line = test;
    }
    if (line && lines.length < maxLines) lines.push(line);
    for (var j = 0; j < lines.length; j++) ctx.fillText(lines[j], x, y + j * lineHeight);
  }
  function cardDrawSignature(card, item) {
    item = item || {};
    var rec = item.cover ? playlistCoverCache[item.cover] : null;
    var coverState = item.cover ? (rec && rec.loaded ? 'ready' : (rec && rec.failed ? 'fail' : 'wait')) : 'none';
    var pulseBucket = card && card.isCenter ? Math.round((bass + beatPulse * 0.85) * 6) : 0;
    return [
      item.type || '', item.title || '', item.sub || '', item.tag || '',
      item.playlistId || '', item.podcastKey || '', item.queueIndex == null ? '' : item.queueIndex,
      item.cover || '', coverState, card && card.isCenter ? 1 : 0, card && card.selected ? 1 : 0,
      card && card.dofBucket == null ? -1 : card.dofBucket, pulseBucket, shelfAccentHex(), shelfSettings().bgOpacity
    ].join('|');
  }

  function drawCard(card, item) {
    item = item || card.item || {};
    var nextDrawKey = cardDrawSignature(card, item);
    if (card.drawKey === nextDrawKey) return;
    card.drawKey = nextDrawKey;
    var cv = card.canvas, ctx = card.ctx;
    var W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    var pad = 18;
    var isNow = item.type === 'queue' && item.tag === '正在播放';
    var shelfLook = shelfSettings();

    // 卡片底
    makeRoundRect(ctx, pad, pad, W - pad*2, H - pad*2, 32);
    ctx.fillStyle = 'rgba(0,0,0,' + shelfLook.bgOpacity.toFixed(3) + ')'; ctx.fill();
    var grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, 'rgba(255,255,255,0.10)');
    grad.addColorStop(1, 'rgba(255,255,255,0.018)');
    ctx.fillStyle = grad; ctx.fill();

    if (isNow) {
      ctx.strokeStyle = shelfAccentRgba(0.72);
      ctx.lineWidth = 1.8 + Math.sin(uniforms.uTime.value * 3) * 0.28 + bass * 1.2;
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.lineWidth = 1.1;
    }
    ctx.stroke();

    if (card.selected) {
      ctx.save();
      makeRoundRect(ctx, pad + 2, pad + 2, W - pad*2 - 4, H - pad*2 - 4, 30);
      ctx.shadowColor = shelfAccentRgba(0.58);
      ctx.shadowBlur = 18;
      ctx.strokeStyle = shelfAccentRgba(0.72);
      ctx.lineWidth = 2.2;
      ctx.stroke();
      ctx.restore();
    }

    // 大封面方块
    var coverSize = H - pad*2 - 8;
    var cx = pad + 6, cy = pad + 4;
    makeRoundRect(ctx, cx, cy, coverSize, coverSize, 26);
    ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fill();
    if (item.cover) {
      var rec = playlistCoverCache[item.cover];
      if (rec && rec.loaded && rec.img) {
        ctx.save(); makeRoundRect(ctx, cx, cy, coverSize, coverSize, 26); ctx.clip();
        ctx.drawImage(rec.img, cx, cy, coverSize, coverSize); ctx.restore();
      } else if (!rec || (!rec.loading && !rec.failed)) {
        requestPlaylistCover(item.cover, function(){ drawCard(card, item); });
      }
    }

    // 文本区
    var tx = pad + coverSize + 32;
    ctx.font = '700 17px Inter, Arial';
    ctx.fillStyle = isNow ? shelfAccentRgba(0.92) : 'rgba(255,255,255,0.92)';
    ctx.fillText(item.tag || '', tx, pad + 36);

    ctx.font = '700 30px Inter, Arial';
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    wrapText(ctx, item.title || '', tx, pad + 78, W - tx - pad - 14, 36, 2);

    ctx.font = '400 17px Inter, Arial';
    ctx.fillStyle = 'rgba(255,255,255,0.52)';
    wrapText(ctx, item.sub || '', tx, pad + 156, W - tx - pad - 14, 24, 2);

    // 律动进度条
    ctx.strokeStyle = isNow ? shelfAccentRgba(0.90) : 'rgba(255,255,255,0.30)';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(tx, H - pad - 22);
    ctx.lineTo(tx + Math.min(260, 80 + bass * 320), H - pad - 22);
    ctx.stroke();

    if (card.isCenter) {
      var actionY = H - pad - 78;
      if (item.type === 'playlist') {
        makeRoundRect(ctx, tx, actionY, 138, 38, 18);
        var playGrad = ctx.createLinearGradient(tx, actionY, tx + 138, actionY + 38);
        playGrad.addColorStop(0, 'rgba(255,255,255,0.88)');
        playGrad.addColorStop(0.55, shelfAccentRgba(0.94));
        playGrad.addColorStop(1, shelfAccentRgba(0.58));
        ctx.fillStyle = playGrad; ctx.fill();
        ctx.strokeStyle = shelfAccentRgba(0.44);
        ctx.lineWidth = 1.1; ctx.stroke();
        ctx.font = '800 14px Inter, "Microsoft YaHei", Arial';
        ctx.fillStyle = readableInkForHex(shelfAccentHex());
        ctx.fillText('▶ 播放歌单', tx + 25, actionY + 24);

        makeRoundRect(ctx, tx + 150, actionY, 104, 38, 18);
        ctx.fillStyle = 'rgba(255,255,255,0.055)'; ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.14)';
        ctx.lineWidth = 1.1; ctx.stroke();
        ctx.font = '700 14px Inter, "Microsoft YaHei", Arial';
        ctx.fillStyle = 'rgba(255,255,255,0.78)';
        ctx.fillText('详情', tx + 184, actionY + 24);
      } else if (item.type === 'queue') {
        ctx.font = '600 14px Inter, "Microsoft YaHei", Arial';
        ctx.fillStyle = shelfAccentRgba(0.84);
        ctx.fillText('点击播放', tx, actionY + 25);
      }
    }

    var dof = card.dofBlur || 0;
    if (dof > 0.12) {
      makeRoundRect(ctx, pad, pad, W - pad*2, H - pad*2, 32);
      ctx.fillStyle = 'rgba(0,0,0,' + Math.min(0.28, dof * 0.18).toFixed(3) + ')';
      ctx.fill();
    }

    card.texture.needsUpdate = true;
  }

  function buildOneCard(item, i) {
    var cv = document.createElement('canvas');
    cv.width = 720; cv.height = 360;
    var ctx = cv.getContext('2d');
    var tx = new THREE.CanvasTexture(cv);
    tx.minFilter = THREE.LinearFilter; tx.magFilter = THREE.LinearFilter;
    tx.generateMipmaps = false;
    var mat = new THREE.MeshBasicMaterial({ map: tx, transparent: true, opacity: 0.96, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
    var geo = new THREE.PlaneGeometry(2.05, 1.025, 1, 1);
    var mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 50 + i;
    mesh.userData.action = item.type === 'playlist'
      ? { kind:'loadPlaylist', playlistId: item.playlistId, title: item.title }
      : (item.type === 'podcastCollection'
        ? { kind:'loadPlaylist', playlistId: 'podcast:' + item.podcastKey, title: item.title }
        : (item.type === 'queue' ? { kind:'playQueue', index: item.queueIndex } : { kind:'empty' }));
    group.add(mesh);
    var card = { canvas: cv, ctx: ctx, texture: tx, mesh: mesh, item: item, index: i, isCenter: false, selected: i === selectedIdx, floatMix: 0, fxPulse: 0, dofBlur: 0, dofBucket: -1, drawKey: '' };
    return card;
  }

  function warmTextureUpload(tex) {
    if (!tex || !renderer || typeof renderer.initTexture !== 'function') return;
    try { renderer.initTexture(tex); } catch (e) {}
  }

  function cancelCardBuildQueue() {
    if (!cardBuildQueue) return;
    cardBuildQueue.cancelled = true;
    if (cardBuildQueue.raf) cancelAnimationFrame(cardBuildQueue.raf);
    cardBuildQueue = null;
  }

  function disposeRenderedCards() {
    cancelCardBuildQueue();
    while (group && group.children.length) {
      var ch = group.children.pop();
      if (ch.material) { if (ch.material.map) ch.material.map.dispose(); ch.material.dispose(); }
      if (ch.geometry) ch.geometry.dispose();
    }
    cards = [];
    renderedStart = -1;
  }

  function scheduleQueuedCardBuild(job) {
    function step(deadline) {
      if (!job || job.cancelled || cardBuildQueue !== job || !group) return;
      var started = performance.now();
      var built = 0;
      while (job.next <= job.end && built < 2 && performance.now() - started < 7) {
        var card = buildOneCard(allItems[job.next], job.next);
        cards.push(card);
        drawCard(card, card.item);
        warmTextureUpload(card.texture);
        job.next += 1;
        built += 1;
      }
      if (job.next <= job.end) {
        if (window.requestIdleCallback) {
          requestIdleCallback(step, { timeout: 180 });
        } else {
          job.raf = requestAnimationFrame(step);
        }
      } else {
        cardBuildQueue = null;
      }
    }
    if (window.requestIdleCallback) requestIdleCallback(step, { timeout: 180 });
    else job.raf = requestAnimationFrame(step);
  }

  function syncRenderedWindow(force, asyncBuild) {
    if (!group) return;
    var total = allItems.length;
    if (!total) { disposeRenderedCards(); return; }
    var center = Math.round(centerTarget);
    var start = Math.max(0, center - SHELF_VISIBLE_RADIUS);
    var end = Math.min(total - 1, start + SHELF_MAX_RENDER - 1);
    start = Math.max(0, end - SHELF_MAX_RENDER + 1);
    if (!force && start === renderedStart && cards.length === (end - start + 1)) {
      cards.forEach(function(c) {
        var nextItem = allItems[c.index] || c.item;
        if (c.item !== nextItem) {
          c.item = nextItem;
          c.drawKey = '';
          drawCard(c, c.item);
        }
      });
      return;
    }
    disposeRenderedCards();
    renderedStart = start;
    if (asyncBuild) {
      cardBuildQueue = { start:start, end:end, next:start, cancelled:false, raf:0 };
      scheduleQueuedCardBuild(cardBuildQueue);
      return;
    }
    for (var itemIdx = start; itemIdx <= end; itemIdx++) {
      var card = buildOneCard(allItems[itemIdx], itemIdx);
      cards.push(card);
      drawCard(card, card.item);
    }
  }

  function rebuild(asyncCards) {
    if (!group) return;
    disposeRenderedCards();
    if (connectorParticles) {
      if (connectorParticles.parent) connectorParticles.parent.remove(connectorParticles);
      if (connectorParticles.geometry) connectorParticles.geometry.dispose();
      if (connectorParticles.material) connectorParticles.material.dispose();
      connectorParticles = null;
    }
    if (floorMirror) {
      if (floorMirror.parent) floorMirror.parent.remove(floorMirror);
      if (floorMirror.geometry) floorMirror.geometry.dispose();
      if (floorMirror.material) floorMirror.material.dispose();
      floorMirror = null;
    }
    allItems = currentItems();
    lastSig = sig(allItems);
    lastCardRedrawAt = -10;
    lastCardPulseBucket = -1;
    // center 起始 = currentIdx (如果是 queue), 否则 0
    if (allItems.length && allItems[0].type === 'queue' && currentIdx >= 0) {
      centerTarget = Math.min(allItems.length - 1, currentIdx);
      centerSmooth = centerTarget;
      centerIdx = centerTarget;
    } else if (centerTarget >= allItems.length) {
      centerTarget = Math.max(0, allItems.length - 1);
      centerSmooth = centerTarget;
    }
    if (selectedIdx >= allItems.length) selectedIdx = -1;
    syncRenderedWindow(true, !!asyncCards);
    if (mode === 'stage') {
      createStageExtras();
    }
  }

  // ====================================================
  //  PSP 弧形布局: 以 centerSmooth 为基准, 卡片绕弧排列
  //  i 距离 center 越远 → 越靠后, 越小, 越淡
  // ====================================================
  function placeCard(card, i, totalCards, modeIs) {
    var delta = card.index - centerSmooth;     // 正=下方, 负=上方
    var absD = Math.abs(delta);
    // 隐藏太远的卡 (>4 全隐藏)
    if (absD > SHELF_VISIBLE_RADIUS + 0.5) { card.mesh.visible = false; return; }
    card.mesh.visible = true;
    card.mesh.renderOrder = 60 + Math.round((SHELF_VISIBLE_RADIUS + 1 - Math.min(absD, SHELF_VISIBLE_RADIUS + 1)) * 10);
    var parX = pointerParallax.x || 0;
    var parY = pointerParallax.y || 0;
    var parWeight = Math.max(0, 1 - absD * 0.16);
    var pulse = card.fxPulse || 0;
    var layout = shelfLayoutProfile();
    var shelfLook = shelfSettings();
    var nextDof = Math.max(0, Math.min(1, (absD - 0.45) / 3.2));
    var nextDofBucket = Math.round(nextDof * 5);
    if (card.dofBucket !== nextDofBucket) {
      card.dofBucket = nextDofBucket;
      card.dofBlur = nextDof;
      drawCard(card, card.item);
    }

    if (modeIs === 'side') {
      // 右侧 3D 架: 恢复更靠近、更斜切的打开姿态，让卡片有真正的前后层次。
      var detailOpenSide = contentList && contentList.isOpen();
      var nowT = uniforms.uTime.value;
      var hoverBreath = (!shelfPinnedOpen && !detailOpenSide) ? shelfVisibility : 0;
      var passiveAlways = shelfAlwaysVisible() && !shelfPinnedOpen && !detailOpenSide;
      var liftTarget = card.selected && !detailOpenSide ? 1 : 0;
      var liftRate = liftTarget > (card.floatMix || 0) ? 0.20 : 0.13;
      card.floatMix = (card.floatMix || 0) + (liftTarget - (card.floatMix || 0)) * liftRate;
      if (!liftTarget && card.floatMix < 0.004) card.floatMix = 0;
      var lift = card.floatMix || 0;
      var sideLayer = Math.max(0, SHELF_VISIBLE_RADIUS + 1 - Math.min(absD, SHELF_VISIBLE_RADIUS + 1));
      card.mesh.renderOrder = passiveAlways
        ? (30 + Math.round(sideLayer * 1.1) + Math.round(lift * 96))
        : (60 + Math.round(sideLayer * 10) + Math.round(lift * 70));
      var breathPulse = hoverBreath * (0.5 + 0.5 * Math.sin(nowT * 1.22 + card.index * 0.74));
      var revealRaw = Math.max(0, Math.min(1, (nowT - shelfOpenAnimAt - absD * 0.035) / 0.62));
      var reveal = revealRaw * revealRaw * (3 - 2 * revealRaw);
      var entry = (1 - reveal) * (0.82 + absD * 0.075);
      var paneRaw = Math.max(0, Math.min(1, (nowT - paneSwitchAt - absD * 0.030) / 0.72));
      var paneEase = 1 - paneRaw * paneRaw * (3 - 2 * paneRaw);
      var wallpaperShelfPose = shouldUseWallpaperSafeShelfCamera();
      var skullShelfPose = shouldUseSkullSafeShelfCamera();
      var safeShelfPose = wallpaperShelfPose || skullShelfPose;
      var px = layout.sideX + absD * layout.sideXStep - (detailOpenSide ? layout.sideDetailShift : 0) + entry * layout.sideEntryX;
      var py = (layout.sideY || 0) - delta * layout.sideYStep + (1 - reveal) * (delta < 0 ? -0.18 : 0.18);
      var pz = layout.sideZ - absD * layout.sideZStep - (1 - reveal) * 0.20;
      px += paneEase * paneSwitchDir * 0.60;
      py += paneEase * (delta < 0 ? -0.16 : 0.16);
      pz -= paneEase * 0.22;
      px += parX * 0.060 * parWeight;
      py += parY * 0.046 * parWeight;
      pz += (parY * 0.026 - parX * 0.028) * parWeight;
      py += Math.sin(nowT * 0.92 + card.index * 0.64) * 0.052 * hoverBreath * Math.max(0.20, parWeight);
      pz += Math.cos(nowT * 0.78 + card.index * 0.52) * 0.030 * hoverBreath * parWeight;
      if (lift > 0.001) {
        px -= lift * (skullShelfPose ? 0.035 : (layout.portrait ? 0.065 : 0.145));
        py += lift * (skullShelfPose ? 0.045 : (layout.portrait ? 0.075 : 0.105));
        pz += lift * (skullShelfPose ? 0.080 : 0.220);
      }
      var scale = (absD < 0.5 ? 1.12 : Math.max(0.55, 1.04 - absD * 0.14)) * (0.88 + reveal * 0.12) * (1 + pulse * 0.056 + breathPulse * 0.026 + lift * (skullShelfPose ? 0.045 : 0.075)) * layout.sideScale;
      if (wallpaperShelfPose) scale *= 1.22;
      else if (skullShelfPose) scale *= 1.04;
      card.mesh.position.set(px, py, pz);
      if (skullShelfPose && camera) {
        card.mesh.quaternion.copy(camera.quaternion);
        card.mesh.rotateX(layout.sideRotX - delta * 0.008 - parY * 0.004 * parWeight);
        card.mesh.rotateY(layout.sideRotY + (1 - reveal) * 0.012 + parX * 0.006 * parWeight);
      } else {
        var safeRotY = wallpaperShelfPose ? 0 : layout.sideRotY;
        var safeEntryRotY = wallpaperShelfPose ? 0.02 : 0.16;
        card.mesh.rotation.y = (safeShelfPose ? safeRotY : layout.sideRotY) + (1 - reveal) * safeEntryRotY + parX * (safeShelfPose ? 0.014 : 0.038) * parWeight;
        var safeRotX = wallpaperShelfPose ? 0 : layout.sideRotX;
        card.mesh.rotation.x = -delta * (safeShelfPose ? safeRotX : layout.sideRotX) - parY * (safeShelfPose ? 0.010 : 0.024) * parWeight;
      }
      card.mesh.scale.setScalar(scale);
      var disabledByDetail = detailOpenSide;
      var opacity = absD < 0.5 ? 1.0 : Math.max(0.22, 1.0 - absD * 0.30);
      if (disabledByDetail) {
        opacity *= card.index === openCardIdx ? 0.16 : 0.08;
        card.mesh.material.color.setScalar(card.index === openCardIdx ? 0.42 : 0.25);
      } else {
        if (passiveAlways) opacity *= 0.92 + lift * 0.08;
        card.mesh.material.color.setScalar(passiveAlways ? (0.96 + lift * 0.04) : 1);
      }
      // v8: 自动隐藏 — shelf 不在 focus 区时整体淡化
      card.mesh.material.opacity = Math.min(1, opacity * (shelfVisibility != null ? shelfVisibility : 1) * reveal * (1 - paneEase * 0.24) + pulse * 0.10 * reveal + breathPulse * 0.035) * shelfLook.opacity;
      setCardCenter(card, absD < 0.5);
    } else {
      // 舞台 PSP: 水平展开 + center 突出, dock 在底部
      var pxStage = (layout.stageX || 0) + delta * layout.stageXStep;
      var pyStage = layout.stageY;
      var pzStage = absD < 0.5 ? layout.stageZ : (layout.stageZ - Math.min(2.0, absD) * 0.55);
      var paneRawS = Math.max(0, Math.min(1, (uniforms.uTime.value - paneSwitchAt - absD * 0.030) / 0.72));
      var paneEaseS = 1 - paneRawS * paneRawS * (3 - 2 * paneRawS);
      pxStage += paneEaseS * paneSwitchDir * 0.80;
      pzStage -= paneEaseS * 0.28;
      pxStage += parX * 0.110 * parWeight;
      pyStage += parY * 0.060 * parWeight;
      pzStage += (parY * 0.040 - parX * 0.035) * parWeight;
      var scaleS = (absD < 0.5 ? 1.20 : Math.max(0.45, 1.0 - absD * 0.22)) * (1 + pulse * 0.060) * layout.stageScale;
      card.mesh.position.set(pxStage, pyStage, pzStage);
      card.mesh.rotation.y = -delta * 0.22 + parX * 0.050 * parWeight;
      card.mesh.rotation.x = 0.10 - absD * 0.04 - parY * 0.028 * parWeight;
      card.mesh.scale.setScalar(scaleS);
      var disabledStage = contentList && contentList.isOpen();
      var opS = absD < 0.5 ? 1.0 : Math.max(0.18, 1.0 - absD * 0.32);
      if (disabledStage) {
        opS *= card.index === openCardIdx ? 0.16 : 0.08;
        card.mesh.material.color.setScalar(card.index === openCardIdx ? 0.42 : 0.25);
      } else {
        card.mesh.material.color.setScalar(1);
      }
      card.mesh.material.opacity = Math.min(1, opS * (shelfVisibility != null ? shelfVisibility : 1) * (1 - paneEaseS * 0.24) + pulse * 0.10) * shelfLook.opacity;
      setCardCenter(card, absD < 0.5);
    }
  }

  function setCardCenter(card, isCenter) {
    if (card.isCenter !== isCenter) {
      card.isCenter = isCenter;
      drawCard(card, card.item);
    } else {
      card.isCenter = isCenter;
    }
  }

  function playPlaylistCard(card) {
    if (!card || !card.mesh || !card.mesh.userData) return false;
    var action = card.mesh.userData.action;
    if (!action || action.kind !== 'loadPlaylist' || !action.playlistId) return false;
    if (String(action.playlistId).indexOf('podcast:') === 0) return false;
    pulseCard(card, 1.05);
    if (contentList && contentList.isOpen && contentList.isOpen()) contentList.close();
    openCardIdx = -1;
    setShelfPinnedOpen(false, true);
    if (typeof setFocusZone === 'function') setFocusZone(null, true);
    loadPlaylistIntoQueueById(action.playlistId, true, action.title || (card.item && card.item.title) || '', { forceQueue: true });
    return true;
  }

  function pulseCard(card, amount) {
    if (!card) return;
    pulseObjectValue(card, 'fxPulse', amount || 1, 0.46);
  }

  function createStageExtras() {
    if (!group) return;
    var pcount = 80;
    var pgeo = new THREE.BufferGeometry();
    var ppos = new Float32Array(pcount * 3);
    var pcol = new Float32Array(pcount * 3);
    var prnd = new Float32Array(pcount);
    for (var i = 0; i < pcount; i++) {
      ppos[i*3] = (Math.random() - 0.5) * 6;
      ppos[i*3+1] = (Math.random() - 0.5) * 1.2 + 0.3;
      ppos[i*3+2] = 1.0 + Math.random() * 1.5;
      pcol[i*3] = 0.56; pcol[i*3+1] = 0.91; pcol[i*3+2] = 1.0;
      prnd[i] = Math.random();
    }
    pgeo.setAttribute('position', new THREE.BufferAttribute(ppos, 3));
    pgeo.setAttribute('aColor',   new THREE.BufferAttribute(pcol, 3));
    pgeo.setAttribute('aRand',    new THREE.BufferAttribute(prnd, 1));
    var pmat = new THREE.ShaderMaterial({
      uniforms:{ uTime: uniforms.uTime, uPixel: uniforms.uPixel, uDotTex: uniforms.uDotTex },
      vertexShader:`precision highp float; uniform float uTime, uPixel; attribute vec3 aColor; attribute float aRand;
varying vec3 vC; varying float vA;
void main(){
  vec3 p = position;
  p.x += sin(uTime * 0.4 + aRand * 6.0) * 1.5;
  p.y += sin(uTime * 0.6 + aRand * 4.0) * 0.2;
  p.z += cos(uTime * 0.5 + aRand * 5.0) * 0.4;
  vC = aColor; vA = 0.4 + 0.4 * sin(uTime * 1.5 + aRand * 7.0);
  vec4 m = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = 4.0 * uPixel;
  gl_Position = projectionMatrix * m;
}`,
      fragmentShader:`precision highp float; uniform sampler2D uDotTex;
varying vec3 vC; varying float vA;
void main(){ vec4 t = texture2D(uDotTex, gl_PointCoord); if (t.a < 0.02) discard; gl_FragColor = vec4(vC, t.a * vA); }`,
      transparent:true, depthWrite:false, blending: THREE.AdditiveBlending,
    });
    connectorParticles = new THREE.Points(pgeo, pmat);
    connectorParticles.frustumCulled = false;
    connectorParticles.renderOrder = 49;
    connectorParticles.position.set(0, -2.2, 0);
    if (group.parent) group.parent.add(connectorParticles); else scene.add(connectorParticles);
    // 底部地面反射
    var mGeo = new THREE.PlaneGeometry(10, 1.8);
    var mCanvas = document.createElement('canvas'); mCanvas.width = 256; mCanvas.height = 64;
    var mctx = mCanvas.getContext('2d');
    var mg = mctx.createLinearGradient(0, 0, 0, 64);
    mg.addColorStop(0, 'rgba(255,255,255,0.07)'); mg.addColorStop(1, 'rgba(255,255,255,0)');
    mctx.fillStyle = mg; mctx.fillRect(0, 0, 256, 64);
    var mTex = new THREE.CanvasTexture(mCanvas);
    mTex.generateMipmaps = false;
    var mMat = new THREE.MeshBasicMaterial({ map: mTex, transparent:true, depthWrite:false, opacity:0.55 });
    floorMirror = new THREE.Mesh(mGeo, mMat);
    floorMirror.position.set(0, -2.85, 0.4);
    floorMirror.rotation.x = -Math.PI / 2;
    if (group.parent) group.parent.add(floorMirror); else scene.add(floorMirror);
  }

  function sig(items) {
    if (hasAnyPlatformLogin() && (userPlaylists.length || myPodcastCollections.length)) {
      var source = activePlaylists();
      items = items || currentItems();
      var sampleItems = items.slice(0, 3).concat(items.slice(Math.max(3, items.length - 3)));
      return [
        'platform',
        shelfPane,
        shelfMergesCollections() ? 1 : 0,
        shelfShowsPodcasts() ? 1 : 0,
        source.length,
        myPodcastCollections.length,
        sampleItems.map(function(it){
          return [it.type || '', it.playlistId || '', it.podcastKey || '', it.title || '', it.sub || '', it.tag || ''].join('|');
        }).join('||')
      ].join('::');
    }
    items = items || playQueue.map(function(song, idx){
      return { type:'queue', title: song.name, queueIndex: idx };
    });
    var sample = items.slice(0, 3).concat(items.slice(Math.max(3, items.length - 3)));
    return ['queue', items.length, currentIdx, sample.map(function(it){ return [it.type, it.playlistId||'', it.queueIndex||'', it.title||''].join('|'); }).join('||')].join('::');
  }

  function switchPane(nextPane) {
    if (shelfMergesCollections()) return false;
    if (nextPane === shelfPane) return false;
    paneMemory[shelfPane] = Math.max(0, Math.round(centerTarget));
    shelfPane = nextPane;
    collectionReveal = 0;
    var targetList = activePlaylists();
    var remembered = paneMemory[nextPane] || 0;
    centerTarget = Math.max(0, Math.min(Math.max(0, targetList.length - 1), remembered));
    centerSmooth = centerTarget + (nextPane === 'fav' ? 1.85 : -1.85);
    centerIdx = centerTarget;
    paneSwitchAt = uniforms.uTime.value;
    paneSwitchDir = nextPane === 'fav' ? 1 : -1;
    shelfOpenAnimAt = uniforms.uTime.value;
    if (contentList) contentList.close();
    selectedIdx = Math.round(centerTarget);
    playShelfSelectTick(paneSwitchDir, 'card');
    rebuild();
    showToast(nextPane === 'fav' ? '收藏歌单' : '我的歌单');
    return true;
  }

  function applySelectedIndex(idx) {
    idx = idx == null || idx < 0 ? -1 : Math.round(idx);
    selectedIdx = idx;
    cards.forEach(function(c) {
      var next = c.index === selectedIdx;
      if (c.selected !== next) {
        c.selected = next;
        drawCard(c, c.item);
      }
    });
  }

  function step(direction) {
    if (!allItems.length) return;
    var panes = splitPlaylists();
    var atEnd = centerTarget >= allItems.length - 1 && direction > 0;
    var atStart = centerTarget <= 0 && direction < 0;
    if (!shelfMergesCollections()) {
      if (hasAnyPlatformLogin() && userPlaylists.length && shelfPane === 'mine' && atEnd && panes.fav.length) {
        collectionReveal += Math.min(1.5, Math.abs(direction));
        if (collectionReveal >= 3) switchPane('fav');
        return;
      }
      if (hasAnyPlatformLogin() && userPlaylists.length && shelfPane === 'fav' && atStart && panes.mine.length) {
        collectionReveal += Math.min(1.5, Math.abs(direction));
        if (collectionReveal >= 3) switchPane('mine');
        return;
      }
    }
    collectionReveal = 0;
    var prevTarget = Math.round(centerTarget);
    centerTarget = Math.max(0, Math.min(allItems.length - 1, centerTarget + direction));
    var nextTarget = Math.round(centerTarget);
    paneMemory[shelfPane] = Math.max(0, Math.round(centerTarget));
    syncRenderedWindow(false);
    applySelectedIndex(nextTarget);
    if (nextTarget !== prevTarget) playShelfSelectTick(direction, 'card');
    pulseCard(cards.find(function(c){ return c.index === nextTarget; }), 0.55);
  }

  function screenHitCard(card, sx, sy, pad) {
    if (!card || !card.mesh || !card.mesh.visible || !group || !group.visible) return null;
    var params = card.mesh.geometry && card.mesh.geometry.parameters || {};
    var hw = (params.width || 1.7) / 2;
    var hh = (params.height || 0.85) / 2;
    var pts = [
      new THREE.Vector3(-hw, -hh, 0),
      new THREE.Vector3( hw, -hh, 0),
      new THREE.Vector3( hw,  hh, 0),
      new THREE.Vector3(-hw,  hh, 0),
    ];
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    card.mesh.updateMatrixWorld(true);
    for (var i = 0; i < pts.length; i++) {
      pts[i].applyMatrix4(card.mesh.matrixWorld).project(camera);
      var x = (pts[i].x + 1) * innerWidth / 2;
      var y = (1 - pts[i].y) * innerHeight / 2;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    pad = pad == null ? 28 : pad;
    if (sx < minX - pad || sx > maxX + pad || sy < minY - pad || sy > maxY + pad) return null;
    var u = clampRange((sx - minX) / Math.max(1, maxX - minX), 0, 1);
    var v = 1 - clampRange((sy - minY) / Math.max(1, maxY - minY), 0, 1);
    return { x: u, y: v };
  }

  function pickCardAtScreen(sx, sy, pad) {
    if (!cards.length || !group || !group.visible) return null;
    var ordered = cards.slice().sort(function(a, b){ return (b.mesh.renderOrder || 0) - (a.mesh.renderOrder || 0); });
    for (var i = 0; i < ordered.length; i++) {
      var uv = screenHitCard(ordered[i], sx, sy, pad == null ? 72 : pad);
      if (uv) return { card: ordered[i], uv: uv, screenPick: true };
    }
    return null;
  }

  return {
    setMode: function(m) {
      if (m === mode && group) return;
      mode = m;
      if (m === 'off') {
        if (group) { scene.remove(group); cards.forEach(function(c){ c.texture.dispose(); c.mesh.material.dispose(); c.mesh.geometry.dispose(); }); }
        if (connectorParticles) { scene.remove(connectorParticles); connectorParticles.geometry.dispose(); connectorParticles.material.dispose(); connectorParticles = null; }
        if (floorMirror) { scene.remove(floorMirror); floorMirror.geometry.dispose(); floorMirror.material.dispose(); floorMirror = null; }
        group = null; cards = [];
        if (contentList) contentList.close();
        return;
      }
      if (!group) {
        group = new THREE.Group();
        group.renderOrder = 50;
        scene.add(group);
      }
      var asyncCards = mode === 'side' && document.body.classList.contains('splash-active');
      rebuild(asyncCards);
    },
    getMode: function(){ return mode; },
    update: function(dt) {
      if (!group) return;
      // PSP 滚动平滑
      centerSmooth += (centerTarget - centerSmooth) * 0.16;
      if (Math.abs(centerSmooth - centerTarget) < 0.001) centerSmooth = centerTarget;
      var px = pointerParallax.x, py = pointerParallax.y;
      var appRevealed = !document.body.classList.contains('splash-active');
      var cueVis = tickShelfHoverCue(dt);
      // v8: shelf 自动可见度 — 启动页期间不显示；侧栏只在右侧停留时淡入。
      var targetVis;
      if (!appRevealed) {
        targetVis = 0;
      } else if (mode === 'side') {
        var contentOpen = contentList && contentList.isOpen();
        if (!allItems.length && !contentOpen) targetVis = 0;
        else targetVis = (contentOpen || shelfPinnedOpen || shelfAlwaysVisible()) ? 1.0 : (cueVis > 0.01 ? Math.max(0.16, cueVis * 0.88) : 0);
      } else {
        targetVis = allItems.length ? 1.0 : 0;
      }
      shelfVisibility += (targetVis - shelfVisibility) * (targetVis > shelfVisibility ? 0.22 : 0.18);
      if (shelfVisibility < 0.01 && targetVis === 0) shelfVisibility = 0;
      group.visible = appRevealed && (mode !== 'side' || shelfVisibility > 0) && (allItems.length > 0 || (contentList && contentList.isOpen()));
      if (connectorParticles) connectorParticles.visible = group.visible && mode === 'stage';
      if (floorMirror) floorMirror.visible = group.visible && mode === 'stage';
      if (mode === 'side') {
        var passiveAlwaysGroup = shelfAlwaysVisible() && !shelfPinnedOpen && !(contentList && contentList.isOpen());
        var liftedCardActive = passiveAlwaysGroup && cards.some(function(c){ return c.selected || (c.floatMix || 0) > 0.025; });
        group.renderOrder = passiveAlwaysGroup && !liftedCardActive ? 30 : 50;
        group.position.set(0, 0, 0);
        var bindToCover = shelfAlwaysVisible() && particles && particles.rotation && !(contentList && contentList.isOpen());
        if (bindToCover) {
          group.rotation.x += ((particles.rotation.x - py * 0.010) - group.rotation.x) * 0.075;
          group.rotation.y += ((particles.rotation.y + px * 0.018) - group.rotation.y) * 0.075;
          group.rotation.z += (particles.rotation.z - group.rotation.z) * 0.075;
        } else {
          group.rotation.y += ((px * 0.018) - group.rotation.y) * 0.045;
          group.rotation.x += ((-py * 0.010) - group.rotation.x) * 0.045;
          group.rotation.z += (0 - group.rotation.z) * 0.045;
        }
      } else {
        group.renderOrder = 50;
        var t = uniforms.uTime.value;
        group.position.y = Math.sin(t * 0.3) * 0.04;
        group.position.x = px * 0.10;
        group.rotation.y = px * 0.025;
        group.rotation.x = -py * 0.012;
      }
      for (var i = 0; i < cards.length; i++) {
        placeCard(cards[i], i, cards.length, mode);
      }
      // 内容更新 (节流)
      if (uniforms.uTime.value - lastUpdate > 0.8) {
        lastUpdate = uniforms.uTime.value;
        var nextSig = sig();
        if (nextSig !== lastSig) rebuild();
        else {
          var pulseBucket = Math.round((bass + beatPulse * 0.85) * 10);
          var redrawInterval = playing ? 1.35 : 4.0;
          if (pulseBucket !== lastCardPulseBucket || uniforms.uTime.value - lastCardRedrawAt > redrawInterval) {
            lastCardPulseBucket = pulseBucket;
            lastCardRedrawAt = uniforms.uTime.value;
            cards.forEach(function(c){
              c.item = allItems[c.index] || c.item;
              c.isCenter = Math.abs(c.index - centerSmooth) < 0.5;
              if (c.isCenter || c.dofBucket <= 1 || c.index === currentIdx) drawCard(c, c.item);
            });
          }
        }
      }
      // 二级内容框 update
      if (contentList) contentList.update(dt);
    },
    onCoverChange: function() {
      if (group && mode !== 'off' && uniforms.uTime.value - lastUpdate > 0.2) {
        lastUpdate = uniforms.uTime.value;
        rebuild();
      }
    },
    rebuild: rebuild,
    refreshTheme: function() {
      cards.forEach(function(c) {
        c.drawKey = '';
        drawCard(c, c.item);
      });
      if (contentList && contentList.refreshTheme) contentList.refreshTheme();
    },
    raycastCards: function(raycaster) {
      if (!group || !group.visible || !cards.length) return null;
      var visibleMeshes = cards.filter(function(c){ return c.mesh.visible; }).map(function(c){ return c.mesh; });
      var hits = raycaster.intersectObjects(visibleMeshes, false);
      if (!hits.length) return null;
      var card = cards.find(function(c){ return c.mesh === hits[0].object; });
      return { card: card, point: hits[0].point, uv: hits[0].uv };
    },
    pickCardAtScreen: pickCardAtScreen,
    // PSP 步进
    next: function() { step(1); },
    prev: function() { step(-1); },
    scrollBy: function(d) { step(d); },
    getCenterIdx: function() { return Math.round(centerSmooth); },
    getCardAt: function(idx) { return cards.find(function(c){ return c.index === idx; }); },
    getCards: function() { return cards; },
    playPlaylistAt: function(idx) {
      return playPlaylistCard(cards.find(function(c){ return c.index === idx; }));
    },
    clearSelected: function() {
      applySelectedIndex(-1);
    },
    setSelected: function(idx) {
      applySelectedIndex(idx);
    },
    triggerAction: function(action) {
      if (!action) return;
      var card = cards.find(function(c) { return c.mesh.userData.action === action; });
      pulseCard(card, action.kind === 'loadPlaylist' ? 1.0 : 0.70);
      if (action.kind === 'playQueue') {
        playQueueAt(action.index);
      } else if (action.kind === 'loadPlaylist') {
        if (!contentList) contentList = makeContentListManager();
        openCardIdx = card ? card.index : -1;
        contentList.open(action.playlistId, action.title || (card && card.item.title), card);
        setShelfPinnedOpen(true, true);
        if (typeof updateEmptyHomeVisibility === 'function') updateEmptyHomeVisibility({ forceLoad: false });
        if (typeof setFocusZone === 'function') setFocusZone('shelf-detail', true);
      } else if (action.kind === 'empty') {
        togglePlaylistPanel(true);
      }
    },
    // 二级内容框 open/close
    openContent: function(cardIdx) {
      var card = cards.find(function(c){ return c.index === cardIdx; });
      if (!card) return;
      var action = card.mesh.userData.action;
      if (!action) return;
      pulseCard(card, 1.0);
      // queue 类型 → 直接播放, 不需要内容框
      if (action.kind === 'playQueue') {
        playQueueAt(action.index);
        return;
      }
      if (action.kind === 'loadPlaylist') {
        if (!contentList) contentList = makeContentListManager();
        openCardIdx = card.index;
        contentList.open(action.playlistId, action.title || card.item.title, card);
        setShelfPinnedOpen(true, true);
        if (typeof updateEmptyHomeVisibility === 'function') updateEmptyHomeVisibility({ forceLoad: false });
        if (typeof setFocusZone === 'function') setFocusZone('shelf-detail', true);
      }
      if (action.kind === 'empty') togglePlaylistPanel(true);
    },
    closeContent: function() {
      openCardIdx = -1;
      if (contentList) contentList.close();
      var hint = document.getElementById('hint');
      if (hint) hint.classList.toggle('shelf-hidden', shelfPinnedOpen);
      if (typeof setFocusZone === 'function') setFocusZone(shelfPinnedOpen ? 'shelf-side' : null, true);
      if (typeof updateEmptyHomeVisibility === 'function') updateEmptyHomeVisibility({ forceLoad: false });
    },
    hasOpenContent: function() { return contentList && contentList.isOpen(); },
    getContentList: function() { return contentList; },
    getOpenContentIndex: function() { return openCardIdx; },
    canInteract: function() { return mode !== 'off' && allItems.length > 0; }
  };
}
shelfManager = makeShelfManager();
function safeShelfRebuild(reason, asyncCards) {
  if (!shelfManager || typeof shelfManager.rebuild !== 'function') return false;
  try {
    shelfManager.rebuild(asyncCards);
    return true;
  } catch (e) {
    console.warn('[ShelfRebuild]', reason || 'unknown', e);
    return false;
  }
}
var deferredShelfRebuild = { raf: 0, reason: '', asyncCards: true, token: 0 };
function scheduleShelfRebuild(reason, asyncCards) {
  deferredShelfRebuild.reason = reason || deferredShelfRebuild.reason || 'deferred';
  deferredShelfRebuild.asyncCards = asyncCards !== false;
  deferredShelfRebuild.token += 1;
  var token = deferredShelfRebuild.token;
  if (deferredShelfRebuild.raf) cancelAnimationFrame(deferredShelfRebuild.raf);
  deferredShelfRebuild.raf = requestAnimationFrame(function(){
    deferredShelfRebuild.raf = 0;
    scheduleUiWarmTask(function(){
      if (token !== deferredShelfRebuild.token) return;
      safeShelfRebuild(deferredShelfRebuild.reason, deferredShelfRebuild.asyncCards);
    }, 260);
  });
}
function safeShelfCloseContent(reason) {
  if (!shelfManager || typeof shelfManager.closeContent !== 'function') return false;
  try {
    shelfManager.closeContent();
    return true;
  } catch (e) {
    console.warn('[ShelfCloseContent]', reason || 'unknown', e);
    return false;
  }
}
function isPlaylistPanelVisibleForRender() {
  var panel = document.getElementById('playlist-panel');
  var panelOpen = panel && (panel.classList.contains('show') || panel.classList.contains('peek') || panel.classList.contains('pinned'));
  return !!(panelOpen || miniQueueOpen);
}
function safeRenderQueuePanel(reason, opts) {
  opts = opts || {};
  if (!isPlaylistPanelVisibleForRender() && opts.deferWhenHidden !== false) {
    queuePanelDirty = true;
    return true;
  }
  try {
    renderQueuePanel(opts);
    queuePanelDirty = false;
    return true;
  } catch (e) {
    console.warn('[QueuePanelRender]', reason || 'unknown', e);
    return false;
  }
}
function flushDeferredQueuePanel(reason) {
  if (!queuePanelDirty) return;
  safeRenderQueuePanel(reason || 'flush-deferred-queue', { animate: false, scrollCurrent: miniQueueOpen, deferWhenHidden: false });
}
function safeSwitchPlaylistTab(tab, reason) {
  try {
    switchPlaylistTab(tab);
    return true;
  } catch (e) {
    console.warn('[PlaylistTabSwitch]', reason || tab || 'unknown', e);
    return false;
  }
}
window.addEventListener('blur', clearShelfPreviewOnPointerExit);
document.addEventListener('mouseleave', clearShelfPreviewOnPointerExit);
document.addEventListener('mouseout', function(e) {
  if (!e.relatedTarget && !e.toElement) clearShelfPreviewOnPointerExit();
});

// ============================================================
//  二级内容框 (歌单内的歌曲列表) — 同样 PSP 风格滚动
// ============================================================
function makeContentListManager() {
  var group = null;
  var rows = [];           // 每行一张卡 (歌曲)
  var panel = null;
  var allTracks = [];
  var renderedStart = -1;
  var CONTENT_VISIBLE_RADIUS = 5;
  var CONTENT_MAX_RENDER = CONTENT_VISIBLE_RADIUS * 2 + 1;
  var open = false;
  var centerTarget = 0, centerSmooth = 0;
  var playlistTitle = '';
  var contentKind = 'playlist';
  var sourceCard = null;
  var requestToken = 0;
  var openAnimAt = -10;
  var rowAnimAt = -10;
  var panelDirty = true, rowsDirty = true;
  var panelDrawAt = -10, rowDrawAt = -10;
  var LOADING_ANIM_INTERVAL = 1 / 30;
  var DETAIL_BASE = { x: 1.28, y: 0.18, z: 1.36, rx: -0.008, ry: 0.020 };
  function detailLayout() {
    return shelfLayoutProfile().detail || DETAIL_BASE;
  }

  function makeRoundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
    ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
  }
  function ellipsize(ctx, text, maxWidth) {
    text = String(text || '');
    if (ctx.measureText(text).width <= maxWidth) return text;
    var out = text;
    while (out.length > 1 && ctx.measureText(out + '...').width > maxWidth) out = out.slice(0, -1);
    return out + '...';
  }
  function canvasAccent(alpha, fallback) {
    return shelfAccentRgba(alpha, fallback);
  }

  function ensurePanel() {
    if (panel || !group) return;
    var cv = document.createElement('canvas');
    cv.width = 900; cv.height = 1024;
    var tx = new THREE.CanvasTexture(cv);
    tx.minFilter = THREE.LinearFilter; tx.magFilter = THREE.LinearFilter;
    tx.generateMipmaps = false;
    var mat = new THREE.MeshBasicMaterial({ map:tx, transparent:true, opacity:0.86, depthWrite:false, depthTest:false, side:THREE.DoubleSide });
    var geo = new THREE.PlaneGeometry(2.62, 3.02, 1, 1);
    var mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(-0.02, 0.0, 0.20);
    mesh.renderOrder = 232;
    group.add(mesh);
    panel = { canvas:cv, texture:tx, mesh:mesh };
  }

  function drawPanel() {
    ensurePanel();
    if (!panel) return;
    var ctx = panel.canvas.getContext('2d');
    var W = panel.canvas.width, H = panel.canvas.height;
    ctx.clearRect(0, 0, W, H);
    makeRoundRect(ctx, 24, 28, W - 48, H - 56, 34);
    var bg = ctx.createLinearGradient(0, 0, W, H);
    var panelBgAlpha = shelfSettings().bgOpacity;
    bg.addColorStop(0, 'rgba(0,0,0,' + Math.min(0.98, panelBgAlpha + 0.02).toFixed(3) + ')');
    bg.addColorStop(0.42, 'rgba(0,0,0,' + panelBgAlpha.toFixed(3) + ')');
    bg.addColorStop(1, 'rgba(0,0,0,' + Math.max(0.20, panelBgAlpha - 0.04).toFixed(3) + ')');
    ctx.fillStyle = bg; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.font = '800 38px Inter, "Microsoft YaHei", Arial';
    ctx.fillStyle = 'rgba(255,246,220,0.94)';
    ctx.fillText(ellipsize(ctx, playlistTitle || '歌单详情', W - 310), 72, 92);
    ctx.font = '500 18px Inter, "Microsoft YaHei", Arial';
    ctx.fillStyle = canvasAccent(0.62);
    var playableCount = allTracks.filter(function(song){ return song && song.id && song.type !== 'podcast-radio'; }).length;
    var contentCount = allTracks.filter(function(song){ return song && song.id; }).length;
    var isLoading = allTracks.length === 1 && isLoadingLabel(allTracks[0] && allTracks[0].name);
    var countLabel = contentKind === 'podcast'
      ? (contentCount ? (contentCount + ' 项播客内容') : (isLoading ? '正在载入' : '暂无播客内容'))
      : (playableCount ? (playableCount + ' 首歌曲') : (isLoading ? '正在载入' : '暂无可播放歌曲'));
    ctx.fillText(countLabel, 74, 128);
    var coverUrl = sourceCard && sourceCard.item && sourceCard.item.cover;
    var coverSize = 96, coverX = W - 172, coverY = 56;
    makeRoundRect(ctx, coverX, coverY, coverSize, coverSize, 22);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fill();
    if (coverUrl) {
      var coverRec = playlistCoverCache[coverUrl];
      if (coverRec && coverRec.loaded && coverRec.img) {
        ctx.save();
        makeRoundRect(ctx, coverX, coverY, coverSize, coverSize, 22);
        ctx.clip();
        ctx.drawImage(coverRec.img, coverX, coverY, coverSize, coverSize);
        ctx.restore();
      } else if (!coverRec || (!coverRec.loading && !coverRec.failed)) {
        requestPlaylistCover(coverUrl, function(){ drawPanel(); });
      }
    }
    var sweep = (Math.sin((uniforms.uTime.value || 0) * 1.7) + 1) * 0.5;
    var shine = ctx.createLinearGradient(70, 154, W - 80, 154);
    shine.addColorStop(0, canvasAccent(0));
    shine.addColorStop(Math.max(0.01, sweep * 0.72), canvasAccent(0.14));
    shine.addColorStop(Math.min(0.99, sweep * 0.72 + 0.14), canvasAccent(0.56));
    shine.addColorStop(1, canvasAccent(0));
    ctx.fillStyle = shine;
    ctx.fillRect(72, 154, W - 144, 2);
    panel.texture.needsUpdate = true;
  }

  function disposePanelObject(targetPanel) {
    if (!targetPanel) return;
    if (targetPanel.mesh && targetPanel.mesh.parent) targetPanel.mesh.parent.remove(targetPanel.mesh);
    if (targetPanel.texture) targetPanel.texture.dispose();
    if (targetPanel.mesh && targetPanel.mesh.material) targetPanel.mesh.material.dispose();
    if (targetPanel.mesh && targetPanel.mesh.geometry) targetPanel.mesh.geometry.dispose();
  }

  function disposePanel() {
    disposePanelObject(panel);
    panel = null;
  }

  function isLoadingLabel(text) {
    return /加载中|正在载入/.test(String(text || ''));
  }

  function isLoadingContent() {
    return allTracks.length === 1 && isLoadingLabel(allTracks[0] && allTracks[0].name);
  }

  function drawPanelIfNeeded(force, nowT) {
    nowT = nowT == null ? (uniforms.uTime.value || 0) : nowT;
    if (!force && !panelDirty && (!isLoadingContent() || nowT - panelDrawAt < LOADING_ANIM_INTERVAL)) return;
    drawPanel();
    panelDirty = false;
    panelDrawAt = nowT;
  }

  function drawRow(row, song, isCenter) {
    var cv = row.canvas, ctx = cv.getContext('2d');
    var W = cv.width, H = cv.height;
    var isPodcastRadio = !!(song && song.type === 'podcast-radio');
    var playable = !!(song && song.id && !isPodcastRadio);
    var actionReady = playable || isPodcastRadio;
    ctx.clearRect(0, 0, W, H);
    makeRoundRect(ctx, 14, 10, W - 28, H - 20, 22);
    var rowGrad = ctx.createLinearGradient(0, 0, W, H);
    var rowBgAlpha = shelfSettings().bgOpacity;
    var centerRowBgAlpha = isCenter ? Math.max(rowBgAlpha, 0.92) : rowBgAlpha;
    if (isCenter) {
      rowGrad.addColorStop(0, 'rgba(8,14,24,' + Math.min(0.985, centerRowBgAlpha + 0.040).toFixed(3) + ')');
      rowGrad.addColorStop(0.48, 'rgba(0,0,0,' + Math.min(0.985, centerRowBgAlpha + 0.030).toFixed(3) + ')');
      rowGrad.addColorStop(1, 'rgba(0,0,0,' + Math.min(0.98, centerRowBgAlpha + 0.015).toFixed(3) + ')');
    } else {
      rowGrad.addColorStop(0, 'rgba(16,16,20,' + Math.max(0.20, rowBgAlpha - 0.02).toFixed(3) + ')');
      rowGrad.addColorStop(1, 'rgba(0,0,0,' + Math.max(0.20, rowBgAlpha - 0.04).toFixed(3) + ')');
    }
    if (isCenter) {
      ctx.shadowColor = canvasAccent(0.20);
      ctx.shadowBlur = 18;
    }
    ctx.fillStyle = rowGrad;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = isCenter ? canvasAccent(0.48) : 'rgba(255,255,255,0.10)';
    ctx.lineWidth = isCenter ? 1.6 : 1;
    ctx.stroke();
    ctx.font = '700 18px Inter, Arial';
    ctx.fillStyle = isCenter ? canvasAccent(0.95) : 'rgba(255,255,255,0.34)';
    var n = String(row.index + 1);
    if (n.length < 2) n = '0' + n;
    ctx.fillText(n, 32, 52);
    var coverSize = 54;
    var coverX = 84;
    var coverY = H/2 - coverSize/2;
    var songCover = songCoverSrc(song, 80);
    var hasSongCover = !!songCover;
    if (actionReady || hasSongCover) {
      makeRoundRect(ctx, coverX, coverY, coverSize, coverSize, 13);
      ctx.fillStyle = isCenter ? canvasAccent(0.12) : 'rgba(255,255,255,0.07)';
      ctx.fill();
      if (hasSongCover) {
        var songCoverRec = playlistCoverCache[songCover];
        if (songCoverRec && songCoverRec.loaded && songCoverRec.img) {
          ctx.save();
          makeRoundRect(ctx, coverX, coverY, coverSize, coverSize, 13);
          ctx.clip();
          ctx.drawImage(songCoverRec.img, coverX, coverY, coverSize, coverSize);
          ctx.restore();
        } else if (!songCoverRec || (!songCoverRec.loading && !songCoverRec.failed)) {
          requestPlaylistCover(songCover, function(){
            if (row && row.mesh && row.mesh.parent) drawRow(row, row.song, !!row.lastCenter);
          });
        }
      }
    }
    // 标题
    var textX = (actionReady || hasSongCover) ? 154 : 82;
    var btnW = 104, btnH = 48, btnX = W - 144, btnY = H/2 - btnH/2;
    var miniBtn = 44, likeX = btnX - 156, collectX = btnX - 104, nextX = btnX - 52;
    var textMax = actionReady && isCenter ? (isPodcastRadio ? btnX - textX - 24 : likeX - textX - 24) : W - textX - 42;
    var loadingRow = !playable && isLoadingLabel(song && song.name);
    if (loadingRow) {
      ctx.font = '700 22px Inter, "Microsoft YaHei", Arial';
      ctx.fillStyle = 'rgba(255,247,224,0.88)';
      ctx.fillText('正在载入歌单', textX, 42);
      var phase = ((uniforms.uTime.value || 0) * 0.85) % 1;
      for (var sk = 0; sk < 3; sk++) {
        var barY = 58 + sk * 13;
        var barW = sk === 0 ? 330 : (sk === 1 ? 250 : 180);
        makeRoundRect(ctx, textX, barY, barW, 7, 4);
        var skGrad = ctx.createLinearGradient(textX, barY, textX + barW, barY);
        var hot = (phase + sk * 0.14) % 1;
        skGrad.addColorStop(0, 'rgba(255,255,255,0.08)');
        skGrad.addColorStop(Math.max(0, hot - 0.18), canvasAccent(0.10));
        skGrad.addColorStop(Math.min(0.99, hot), canvasAccent(0.34));
        skGrad.addColorStop(1, 'rgba(255,255,255,0.08)');
        ctx.fillStyle = skGrad; ctx.fill();
      }
      row.texture.needsUpdate = true;
      return;
    }
    ctx.font = isCenter ? '800 24px Inter, "Microsoft YaHei", Arial' : '600 20px Inter, "Microsoft YaHei", Arial';
    ctx.fillStyle = isCenter ? 'rgba(255,247,224,0.96)' : 'rgba(255,255,255,0.80)';
    ctx.fillText(ellipsize(ctx, song.name || '', textMax), textX, 44);
    ctx.font = '500 15px Inter, "Microsoft YaHei", Arial';
    ctx.fillStyle = isCenter ? 'rgba(255,255,255,0.88)' : 'rgba(255,255,255,0.64)';
    ctx.fillText(ellipsize(ctx, song.artist || '', textMax), textX, 72);
    // center 行右侧显示红心/收藏/播放按钮
    if (isCenter && actionReady) {
      if (!isPodcastRadio) {
      var liked = isSongLiked(song);
      makeRoundRect(ctx, likeX, btnY + 2, miniBtn, btnH - 4, 15);
      ctx.fillStyle = liked ? 'rgba(255,122,144,0.18)' : 'rgba(255,255,255,0.075)';
      ctx.fill();
      ctx.strokeStyle = liked ? 'rgba(255,122,144,0.52)' : 'rgba(255,255,255,0.14)';
      ctx.lineWidth = 1.1;
      ctx.stroke();
      drawCanvasHeart(ctx, likeX + miniBtn / 2, btnY + 26, 20, liked ? '#ff7a90' : 'rgba(255,255,255,0.76)');

      makeRoundRect(ctx, collectX, btnY + 2, miniBtn, btnH - 4, 15);
      var collectGrad = ctx.createLinearGradient(collectX, btnY + 2, collectX + miniBtn, btnY + btnH);
      collectGrad.addColorStop(0, 'rgba(255,255,255,0.080)');
      collectGrad.addColorStop(1, canvasAccent(0.075));
      ctx.fillStyle = collectGrad;
      ctx.fill();
      ctx.strokeStyle = canvasAccent(0.22);
      ctx.lineWidth = 1.1;
      ctx.stroke();
      var collectCx = collectX + miniBtn / 2;
      var collectCy = btnY + btnH / 2;
      ctx.strokeStyle = canvasAccent(0.72);
      ctx.lineWidth = 2.35;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(collectCx - 11, collectCy + 1);
      ctx.lineTo(collectCx - 11, collectCy + 12);
      ctx.lineTo(collectCx + 11, collectCy + 12);
      ctx.lineTo(collectCx + 11, collectCy + 1);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(collectCx, collectCy - 9);
      ctx.lineTo(collectCx, collectCy + 5);
      ctx.moveTo(collectCx - 7, collectCy - 2);
      ctx.lineTo(collectCx + 7, collectCy - 2);
      ctx.stroke();

      makeRoundRect(ctx, nextX, btnY + 2, miniBtn, btnH - 4, 15);
      var nextGrad = ctx.createLinearGradient(nextX, btnY + 2, nextX + miniBtn, btnY + btnH);
      nextGrad.addColorStop(0, 'rgba(255,255,255,0.082)');
      nextGrad.addColorStop(0.62, 'rgba(255,255,255,0.045)');
      nextGrad.addColorStop(1, canvasAccent(0.055));
      ctx.fillStyle = nextGrad;
      ctx.fill();
      ctx.strokeStyle = canvasAccent(0.24);
      ctx.lineWidth = 1.1;
      ctx.stroke();
      var nextCx = nextX + miniBtn / 2;
      var nextCy = btnY + btnH / 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.90)';
      ctx.lineWidth = 2.8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(nextCx, nextCy - 8);
      ctx.lineTo(nextCx, nextCy + 8);
      ctx.moveTo(nextCx - 8, nextCy);
      ctx.lineTo(nextCx + 8, nextCy);
      ctx.stroke();
      }

      makeRoundRect(ctx, btnX, btnY, btnW, btnH, 18);
      var btnGrad = ctx.createLinearGradient(btnX, btnY, btnX + btnW, btnY + btnH);
      btnGrad.addColorStop(0, 'rgba(255,255,255,0.88)');
      btnGrad.addColorStop(0.56, canvasAccent(0.94));
      btnGrad.addColorStop(1, canvasAccent(0.58));
      ctx.fillStyle = btnGrad; ctx.fill();
      ctx.strokeStyle = canvasAccent(0.42);
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.font = '700 15px Inter, Arial';
      ctx.fillStyle = readableInkForHex(shelfAccentHex());
      ctx.fillText('播放', btnX + 36, btnY + 29);
    }
    row.texture.needsUpdate = true;
  }

  function place(row, i) {
    var delta = row.index - centerSmooth;
    var absD = Math.abs(delta);
    if (absD > CONTENT_VISIBLE_RADIUS + 0.5) { row.mesh.visible = false; return; }
    row.mesh.visible = true;
    row.mesh.renderOrder = 240 + Math.round((CONTENT_VISIBLE_RADIUS + 1 - Math.min(absD, CONTENT_VISIBLE_RADIUS + 1)) * 14);
    var nowT = uniforms.uTime.value;
    var revealRaw = Math.max(0, Math.min(1, (nowT - rowAnimAt - absD * 0.040) / 0.72));
    var reveal = revealRaw * revealRaw * (3 - 2 * revealRaw);
    var parX = pointerParallax.x || 0;
    var parY = pointerParallax.y || 0;
    var parWeight = Math.max(0, 1 - absD * 0.12);
    var pulse = row.fxPulse || 0;
    var settle = group && group.userData ? (group.userData.rowSettle || 0) : 0;
    var layout = detailLayout();
    var shelfLook = shelfSettings();
    var skullDetail = shouldUseSkullSafeShelfCamera();
    var rowBaseX = skullDetail ? 0.22 : -0.04;
    var rowSpreadX = skullDetail ? 0.030 : 0.014;
    var rowIntroX = skullDetail ? 0.58 : 0.38;
    var rowCenterZ = skullDetail ? 0.62 : 0.62;
    var rowBackZ = skullDetail ? 0.58 : 0.58;
    var rowDepthStep = skullDetail ? 0.046 : 0.048;
    var px = rowBaseX + absD * rowSpreadX + (1 - reveal) * (rowIntroX + absD * rowSpreadX);
    var py = -delta * layout.rowStep + (1 - reveal) * (0.20 + (delta < 0 ? -0.10 : 0.10));
    var pz = (absD < 0.5 ? rowCenterZ : (rowBackZ - absD * rowDepthStep)) - (1 - reveal) * (skullDetail ? 0.10 : 0.16);
    px += settle * ((skullDetail ? 0.11 : 0.12) + absD * (skullDetail ? 0.010 : 0.012));
    py += settle * (delta < 0 ? -0.08 : 0.08);
    pz -= settle * (skullDetail ? 0.045 : 0.08);
    px += parX * (skullDetail ? 0.022 : 0.026) * parWeight;
    py += parY * (skullDetail ? 0.024 : 0.036) * parWeight;
    pz += (parY * (skullDetail ? 0.014 : 0.024) - parX * (skullDetail ? 0.010 : 0.020)) * parWeight;
    var scale = (absD < 0.5 ? 1.00 : Math.max(0.66, 0.94 - absD * 0.070)) * (0.90 + reveal * 0.10) * (1 + pulse * 0.052) * (1 - settle * 0.025) * layout.rowScale;
    row.mesh.position.set(px, py, pz);
    row.mesh.scale.setScalar(scale);
    var rowOpacityBase = Math.min(1, (absD < 0.5 ? 1.0 : Math.max(0.34, 1.0 - absD * 0.12)) * reveal + pulse * 0.14);
    var rowOpacityScale = absD < 0.5 ? Math.max(0.94, shelfLook.opacity) : shelfLook.opacity;
    row.mesh.material.opacity = Math.min(1, rowOpacityBase * rowOpacityScale);
    row.mesh.rotation.y = (skullDetail ? -0.070 : 0.10) + (1 - reveal) * (skullDetail ? 0.018 : 0.052) + parX * (skullDetail ? 0.010 : 0.018) * parWeight;
    row.mesh.rotation.x = (skullDetail ? 0.010 : 0) - delta * (skullDetail ? 0.010 : 0.022) - parY * (skullDetail ? 0.006 : 0.014) * parWeight;
  }

  function disposeRowList(rowList) {
    while (rowList.length) {
      var row = rowList.pop();
      if (row.mesh && row.mesh.parent) row.mesh.parent.remove(row.mesh);
      if (row.mesh && row.mesh.material) {
        if (row.mesh.material.map) row.mesh.material.map.dispose();
        row.mesh.material.dispose();
      }
      if (row.mesh && row.mesh.geometry) row.mesh.geometry.dispose();
    }
  }

  function disposeRows() {
    disposeRowList(rows);
    renderedStart = -1;
  }

  function disposeCapturedDetail(targetGroup, targetRows, targetPanel) {
    if (targetGroup && targetGroup.parent) targetGroup.parent.remove(targetGroup);
    disposeRowList(targetRows || []);
    disposePanelObject(targetPanel);
  }

  function startRowsLoadedIntro() {
    rowAnimAt = uniforms.uTime.value;
    panelDirty = true;
    rowsDirty = true;
    if (!group || !group.userData) return;
    group.userData.rowSettle = 1;
    if (window.gsap) {
      window.gsap.killTweensOf(group.userData, 'rowSettle');
      window.gsap.to(group.userData, { rowSettle: 0, duration: 0.76, ease: 'expo.out' });
    } else {
      group.userData.rowSettle = 0;
    }
  }

  function syncRenderedRows(force) {
    if (!group) return;
    var nowT = uniforms.uTime.value || 0;
    var refreshLoading = isLoadingContent() && nowT - rowDrawAt >= LOADING_ANIM_INTERVAL;
    drawPanelIfNeeded(force || refreshLoading, nowT);
    var total = allTracks.length;
    if (!total) { disposeRows(); return; }
    var center = Math.round(centerTarget);
    var start = Math.max(0, center - CONTENT_VISIBLE_RADIUS);
    var end = Math.min(total - 1, start + CONTENT_MAX_RENDER - 1);
    start = Math.max(0, end - CONTENT_MAX_RENDER + 1);
    if (!force && start === renderedStart && rows.length === (end - start + 1)) {
      rows.forEach(function(row) { row.song = allTracks[row.index] || row.song; });
      if (rowsDirty || refreshLoading) {
        rows.forEach(function(row) {
          var isCenter = Math.abs(row.index - centerSmooth) < 0.5;
          drawRow(row, row.song, isCenter);
          row.lastCenter = isCenter;
        });
        rowsDirty = false;
        rowDrawAt = nowT;
      }
      return;
    }
    disposeRows();
    renderedStart = start;
    for (var idx = start; idx <= end; idx++) {
      var row = makeRow(allTracks[idx], idx);
      rows.push(row);
      drawRow(row, row.song, idx === Math.round(centerSmooth));
      row.lastCenter = idx === Math.round(centerSmooth);
    }
    rowsDirty = false;
    rowDrawAt = nowT;
  }

  return {
    isOpen: function() { return open; },
    refreshTheme: function() {
      panelDirty = true;
      rowsDirty = true;
      if (!open || !group) return;
      drawPanelIfNeeded(true);
      syncRenderedRows(true);
    },
    open: async function(playlistId, title, fromCard) {
      open = true;
      playlistTitle = title;
      sourceCard = fromCard;
      var token = ++requestToken;
      openAnimAt = uniforms.uTime.value;
      rowAnimAt = openAnimAt;
      centerTarget = 0;
      centerSmooth = 0;
      panelDirty = true;
      rowsDirty = true;
      panelDrawAt = -10;
      rowDrawAt = -10;
      if (!group) {
        group = new THREE.Group();
        scene.add(group);
      }
      var openLayout = detailLayout();
      var openSkullDetail = shouldUseSkullSafeShelfCamera();
      var openDynamicDetail = !openSkullDetail && shouldUseShelfDynamicCamera('shelf-detail') && camera;
      var openCoverRx = particles && particles.rotation ? particles.rotation.x : 0;
      var openCoverRy = particles && particles.rotation ? particles.rotation.y : 0;
      var openCoverRz = particles && particles.rotation ? particles.rotation.z : 0;
      group.userData.detailIntro = 1;
      group.position.set(openLayout.x + (openSkullDetail ? 0.10 : 0.16), openLayout.y - (openSkullDetail ? 0.02 : 0.024), openLayout.z - (openSkullDetail ? 0.05 : 0.070));
      if ((openSkullDetail || openDynamicDetail) && camera) {
        group.quaternion.copy(camera.quaternion);
        group.rotateX(openLayout.rx);
        group.rotateY(openLayout.ry + (openSkullDetail ? 0.014 : 0.018));
      } else {
        group.rotation.y = openCoverRy * 0.82 + openLayout.ry + 0.018;
        group.rotation.x = openCoverRx * 0.72 + openLayout.rx;
        group.rotation.z = openCoverRz * 0.70;
      }
      group.scale.setScalar(openLayout.scale * 0.965);
      if (window.gsap) {
        window.gsap.killTweensOf(group.userData);
        window.gsap.to(group.userData, { detailIntro: 0, duration: 0.48, ease: 'power3.out' });
      } else {
        group.userData.detailIntro = 0;
      }
      try {
        drawPanelIfNeeded(true);
        // 清旧
        disposeRows();
        // loading 行
        allTracks = [{ name: '加载中…', artist: '' }];
        panelDirty = true;
        rowsDirty = true;
        syncRenderedRows(true);
      } catch (renderLoadingErr) {
        console.warn('[ShelfContentLoadingRender]', playlistId, renderLoadingErr);
      }
      var podcastCollectionKey = String(playlistId || '').indexOf('podcast:') === 0 ? String(playlistId).slice(8) : '';
      var qqPlaylistId = String(playlistId || '').indexOf('qq:') === 0 ? String(playlistId).slice(3) : '';
      contentKind = podcastCollectionKey ? 'podcast' : 'playlist';
      // 拉取歌单/播客集合
      var r = null;
      try {
        r = podcastCollectionKey
          ? await apiJson('/api/podcast/my/items?key=' + encodeURIComponent(podcastCollectionKey) + '&limit=36')
          : (qqPlaylistId
            ? await apiJson('/api/qq/playlist/tracks?id=' + encodeURIComponent(qqPlaylistId))
            : await apiJson('/api/playlist/tracks?id=' + encodeURIComponent(playlistId)));
      } catch (e) {
        if (!open || token !== requestToken) return;
        console.warn('[ShelfContentLoadApi]', playlistId, e);
        try {
          allTracks = [{ name: '歌单加载失败', artist: '' }];
          panelDirty = true;
          rowsDirty = true;
          startRowsLoadedIntro();
          syncRenderedRows(true);
        } catch (renderErrorErr) {
          console.warn('[ShelfContentErrorRender]', playlistId, renderErrorErr);
        }
        showToast('歌单加载失败');
        return;
      }
      if (!open || token !== requestToken) return;
      try {
        // 清 loading
        disposeRows();
        var tracks = podcastCollectionKey ? (r.items || []) : (r.tracks || []);
        if (!tracks.length) {
          allTracks = [{ name: podcastCollectionKey ? '播客为空' : '歌单为空', artist: '' }];
          panelDirty = true;
          rowsDirty = true;
          startRowsLoadedIntro();
          syncRenderedRows(true);
          return;
        }
        allTracks = tracks;
        centerTarget = 0; centerSmooth = 0;
        panelDirty = true;
        rowsDirty = true;
        startRowsLoadedIntro();
        syncRenderedRows(true);
      } catch (renderReadyErr) {
        console.warn('[ShelfContentReadyRender]', playlistId, renderReadyErr);
        showToast('歌单已载入，3D列表刷新失败');
      }
    },
    close: function() {
      open = false;
      requestToken++;
      var targetGroup = group;
      var targetRows = rows.slice();
      var targetPanel = panel;
      group = null;
      rows = [];
      panel = null;
      renderedStart = -1;
      allTracks = [];
      contentKind = 'playlist';
      sourceCard = null;
      panelDirty = true;
      rowsDirty = true;
      panelDrawAt = -10;
      rowDrawAt = -10;
      if (!targetGroup) return;
      var materials = targetRows.map(function(row){ return row.mesh && row.mesh.material; }).filter(Boolean);
      if (targetPanel && targetPanel.mesh && targetPanel.mesh.material) materials.push(targetPanel.mesh.material);
      if (window.gsap) {
        window.gsap.killTweensOf(targetGroup.position);
        window.gsap.killTweensOf(targetGroup.scale);
        window.gsap.to(targetGroup.scale, { x: 0.965, y: 0.965, z: 0.965, duration: 0.18, ease: 'power2.in' });
        window.gsap.to(targetGroup.position, {
          x: targetGroup.position.x + 0.18,
          y: targetGroup.position.y - 0.02,
          z: targetGroup.position.z - 0.10,
          duration: 0.18,
          ease: 'power2.in'
        });
        var finishClose = function(){ disposeCapturedDetail(targetGroup, targetRows, targetPanel); };
        if (materials.length) {
          window.gsap.to(materials, {
            opacity: 0,
            duration: 0.16,
            ease: 'power2.in',
            onComplete: finishClose
          });
        } else {
          window.gsap.delayedCall(0.18, finishClose);
        }
      } else {
        disposeCapturedDetail(targetGroup, targetRows, targetPanel);
      }
    },
    update: function(dt) {
      if (!group || !open) return;
      var intro = group.userData.detailIntro || 0;
      var parX = pointerParallax.x || 0;
      var parY = pointerParallax.y || 0;
      var layout = detailLayout();
      var skullDetail = shouldUseSkullSafeShelfCamera();
      var dynamicDetail = !skullDetail && shouldUseShelfDynamicCamera('shelf-detail') && camera;
      var coverBoundDetail = !skullDetail && !dynamicDetail && particles && particles.rotation;
      var coverBindX = coverBoundDetail ? particles.rotation.y * 0.18 : 0;
      var coverBindY = coverBoundDetail ? particles.rotation.x * -0.16 : 0;
      var coverBindZ = coverBoundDetail ? Math.abs(particles.rotation.y) * 0.030 : 0;
      group.position.set(
        layout.x + coverBindX + intro * (skullDetail ? 0.10 : 0.16) + parX * (skullDetail ? 0.024 : 0.030),
        layout.y + coverBindY - intro * (skullDetail ? 0.02 : 0.024) + parY * (skullDetail ? 0.026 : 0.026),
        layout.z + coverBindZ - intro * (skullDetail ? 0.05 : 0.070) + parY * (skullDetail ? 0.014 : 0.016) - parX * (skullDetail ? 0.010 : 0.010)
      );
      if (skullDetail && camera) {
        group.quaternion.copy(camera.quaternion);
        group.rotateX(layout.rx - parY * 0.004);
        group.rotateY(layout.ry + intro * 0.004 + parX * 0.004);
      } else if (dynamicDetail) {
        group.quaternion.copy(camera.quaternion);
        group.rotateX(layout.rx - parY * 0.006);
        group.rotateY(layout.ry + intro * 0.012 + parX * 0.008);
      } else {
        var coverRx = particles && particles.rotation ? particles.rotation.x : 0;
        var coverRy = particles && particles.rotation ? particles.rotation.y : 0;
        var coverRz = particles && particles.rotation ? particles.rotation.z : 0;
        group.rotation.x += ((coverRx * 0.72 + layout.rx - parY * 0.010) - group.rotation.x) * 0.16;
        group.rotation.y += ((coverRy * 0.82 + layout.ry + intro * 0.018 + parX * 0.014) - group.rotation.y) * 0.16;
        group.rotation.z += ((coverRz * 0.70) - group.rotation.z) * 0.14;
      }
      group.scale.setScalar(layout.scale * (1 - intro * (skullDetail ? 0.020 : 0.035)));
      centerSmooth += (centerTarget - centerSmooth) * 0.18;
      if (Math.abs(centerSmooth - centerTarget) < 0.001) centerSmooth = centerTarget;
      syncRenderedRows(false);
      if (panel && panel.mesh) {
        var pr = Math.max(0, Math.min(1, (uniforms.uTime.value - openAnimAt) / 0.72));
        pr = pr * pr * (3 - 2 * pr);
        panel.mesh.material.opacity = 0.86 * pr * shelfSettings().opacity;
      }
      for (var i = 0; i < rows.length; i++) {
        place(rows[i], i);
        var isC = Math.abs(rows[i].index - centerSmooth) < 0.5;
        if (rows[i].lastCenter !== isC) {
          rows[i].lastCenter = isC;
          drawRow(rows[i], rows[i].song, isC);
        }
      }
    },
    next: function() {
      if (allTracks.length) {
        var prevTarget = Math.round(centerTarget);
        centerTarget = Math.min(allTracks.length - 1, centerTarget + 1);
        var nextTarget = Math.round(centerTarget);
        syncRenderedRows(false);
        if (nextTarget !== prevTarget) playShelfSelectTick(1, 'row');
        pulseObjectValue(rows.find(function(r){ return r.index === nextTarget; }), 'fxPulse', 0.48, 0.36);
      }
    },
    prev: function() {
      if (allTracks.length) {
        var prevTarget = Math.round(centerTarget);
        centerTarget = Math.max(0, centerTarget - 1);
        var nextTarget = Math.round(centerTarget);
        syncRenderedRows(false);
        if (nextTarget !== prevTarget) playShelfSelectTick(-1, 'row');
        pulseObjectValue(rows.find(function(r){ return r.index === nextTarget; }), 'fxPulse', 0.48, 0.36);
      }
    },
    scrollBy: function(d) {
      if (allTracks.length) {
        var prevTarget = Math.round(centerTarget);
        centerTarget = Math.max(0, Math.min(allTracks.length - 1, centerTarget + d));
        var nextTarget = Math.round(centerTarget);
        syncRenderedRows(false);
        if (nextTarget !== prevTarget) playShelfSelectTick(d, 'row');
        pulseObjectValue(rows.find(function(r){ return r.index === nextTarget; }), 'fxPulse', 0.48, 0.36);
      }
    },
    getRows: function() { return rows; },
    getCenterIdx: function() { return Math.round(centerSmooth); },
    pulseRow: function(row, amount) {
      if (!row) return;
      pulseObjectValue(row, 'fxPulse', amount || 1, 0.42);
    },
    raycastRows: function(rc) {
      if (!rows.length) return null;
      var vm = rows.filter(function(r){return r.mesh.visible;}).map(function(r){return r.mesh;});
      var hits = rc.intersectObjects(vm, false);
      if (!hits.length) return null;
      var row = rows.find(function(r){ return r.mesh === hits[0].object; });
      return { row: row, uv: hits[0].uv };
    },
    pickRowAtScreen: function(sx, sy) {
      if (!rows.length || !open) return null;
      var ordered = rows.filter(function(r){ return r.mesh && r.mesh.visible; }).sort(function(a, b){
        return (b.mesh.renderOrder || 0) - (a.mesh.renderOrder || 0);
      });
      for (var ri = 0; ri < ordered.length; ri++) {
        var row = ordered[ri];
        var params = row.mesh.geometry && row.mesh.geometry.parameters || {};
        var hw = (params.width || 2.50) / 2;
        var hh = (params.height || 0.36) / 2;
        var pts = [
          new THREE.Vector3(-hw, -hh, 0),
          new THREE.Vector3( hw, -hh, 0),
          new THREE.Vector3( hw,  hh, 0),
          new THREE.Vector3(-hw,  hh, 0),
        ];
        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        row.mesh.updateMatrixWorld(true);
        for (var pi = 0; pi < pts.length; pi++) {
          pts[pi].applyMatrix4(row.mesh.matrixWorld).project(camera);
          var x = (pts[pi].x + 1) * innerWidth / 2;
          var y = (1 - pts[pi].y) * innerHeight / 2;
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        }
        var padX = 24, padY = 16;
        if (sx < minX - padX || sx > maxX + padX || sy < minY - padY || sy > maxY + padY) continue;
        var u = clampRange((sx - minX) / Math.max(1, maxX - minX), 0, 1);
        var v = 1 - clampRange((sy - minY) / Math.max(1, maxY - minY), 0, 1);
        return { row: row, uv: { x: u, y: v }, screenPick: true };
      }
      return null;
    },
    raycastPanel: function(rc) {
      if (!panel || !panel.mesh) return null;
      var hits = rc.intersectObject(panel.mesh, false);
      return hits && hits.length ? hits[0] : null;
    },
    screenContainsPanel: function(sx, sy) {
      if (!panel || !panel.mesh || !open) return false;
      var params = panel.mesh.geometry && panel.mesh.geometry.parameters || {};
      var hw = (params.width || 2.62) / 2;
      var hh = (params.height || 3.02) / 2;
      var pts = [
        new THREE.Vector3(-hw, -hh, 0),
        new THREE.Vector3( hw, -hh, 0),
        new THREE.Vector3( hw,  hh, 0),
        new THREE.Vector3(-hw,  hh, 0),
      ];
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      panel.mesh.updateMatrixWorld(true);
      for (var pi = 0; pi < pts.length; pi++) {
        pts[pi].applyMatrix4(panel.mesh.matrixWorld).project(camera);
        var x = (pts[pi].x + 1) * innerWidth / 2;
        var y = (1 - pts[pi].y) * innerHeight / 2;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
      var pad = 42;
      return sx >= minX - pad && sx <= maxX + pad && sy >= minY - pad && sy <= maxY + pad;
    },
    rowActionAtScreen: function(row, sx, sy) {
      if (!row || !row.mesh || !row.mesh.visible) return null;
      var song = row.song || {};
      var isCenter = Math.abs(row.index - Math.round(centerSmooth)) < 0.5;
      if (!isCenter || !((song && song.id) || song.type === 'podcast-radio')) return null;
      var params = row.mesh.geometry && row.mesh.geometry.parameters || {};
      var hw = (params.width || 2.50) / 2;
      var hh = (params.height || 0.36) / 2;
      var corners = [
        new THREE.Vector3(-hw, -hh, 0),
        new THREE.Vector3( hw, -hh, 0),
        new THREE.Vector3( hw,  hh, 0),
        new THREE.Vector3(-hw,  hh, 0),
      ];
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      row.mesh.updateMatrixWorld(true);
      for (var i = 0; i < corners.length; i++) {
        corners[i].applyMatrix4(row.mesh.matrixWorld).project(camera);
        var x = (corners[i].x + 1) * innerWidth / 2;
        var y = (1 - corners[i].y) * innerHeight / 2;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
      var w = Math.max(1, maxX - minX);
      var h = Math.max(1, maxY - minY);
      var u = clampRange((sx - minX) / w, 0, 1);
      var v = clampRange((sy - minY) / h, 0, 1);
      if (u > 0.60 && u < 0.68 && v > 0.12 && v < 0.88) return 'like';
      if (u >= 0.68 && u < 0.75 && v > 0.12 && v < 0.88) return 'collect';
      if (u >= 0.75 && u < 0.82 && v > 0.12 && v < 0.88) return 'next';
      if (u >= 0.82 && v > 0.10 && v < 0.90) return 'play';
      return null;
    },
    playRow: function(row) {
      // 把整个歌单导入队列, 从这首开始播
      pulseObjectValue(row, 'fxPulse', 1.0, 0.34);
      var idx = row.index;
      if (idx < 0) return;
      if (row.song && row.song.type === 'podcast-radio') {
        loadPodcastRadioIntoQueue(row.song.id || row.song.radioId, true, row.song.name || playlistTitle);
        var smRadio = shelfManager;
        if (smRadio) safeShelfCloseContent('content-play-podcast-radio');
        return;
      }
      var playIndex = allTracks.slice(0, idx + 1).filter(function(song){ return song && song.id; }).length - 1;
      var allSongs = allTracks.filter(function(song){ return song && song.id; }).map(function(song){
        return cloneSong(song);
      });
      if (!allSongs.length || playIndex < 0) return;
      playQueue = allSongs;
      currentIdx = playIndex;
      safeRenderQueuePanel('content-play-row');
      safeShelfRebuild('content-play-row');
      forcePlaybackControlsInteractive();
      playQueueAt(playIndex, { preserveHomeState: true }).catch(function(e){
        console.warn('[ContentPlayRow]', e);
      });
      // 关闭内容框
      var sm = shelfManager;
      if (sm) safeShelfCloseContent('content-play-row');
    }
  };

  function makeRow(song, i) {
    var cv = document.createElement('canvas');
    cv.width = 800; cv.height = 104;
    var ctx = cv.getContext('2d');
    var tx = new THREE.CanvasTexture(cv);
    tx.minFilter = THREE.LinearFilter; tx.magFilter = THREE.LinearFilter;
    tx.generateMipmaps = false;
    var mat = new THREE.MeshBasicMaterial({ map: tx, transparent: true, opacity: 0.96, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
    var geo = new THREE.PlaneGeometry(2.50, 0.36, 1, 1);
      var mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 240 + i;
      group.add(mesh);
      return { canvas: cv, texture: tx, mesh: mesh, song: song, index: i, fxPulse: 0 };
    }
}

function compactCount(n) {
  n = Number(n) || 0;
  if (n >= 100000000) return (n / 100000000).toFixed(1) + '亿';
  if (n >= 10000) return (n / 10000).toFixed(1) + '万';
  return String(n);
}
function drawCanvasHeart(ctx, cx, cy, size, color) {
  var s = (size || 20) / 28;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.beginPath();
  ctx.moveTo(0, 10.2);
  ctx.bezierCurveTo(-8.9, 2.6, -13.8, -1.9, -13.8, -7.4);
  ctx.bezierCurveTo(-13.8, -12.0, -10.3, -15.2, -5.9, -15.2);
  ctx.bezierCurveTo(-3.2, -15.2, -1.1, -13.9, 0, -11.9);
  ctx.bezierCurveTo(1.1, -13.9, 3.2, -15.2, 5.9, -15.2);
  ctx.bezierCurveTo(10.3, -15.2, 13.8, -12.0, 13.8, -7.4);
  ctx.bezierCurveTo(13.8, -1.9, 8.9, 2.6, 0, 10.2);
  ctx.closePath();
  ctx.fillStyle = color || '#ff7a90';
  ctx.fill();
  ctx.restore();
}
function requestPlaylistCover(url, cb) {
  if (!url) { if (cb) cb(null); return; }
  var rec = playlistCoverCache[url];
  if (rec && rec.loaded) { if (cb) setTimeout(function(){ cb(rec.img); }, 0); return; }
  if (rec && rec.loading) { if (cb) rec.waiters.push(cb); return; }
  rec = playlistCoverCache[url] = { loaded:false, loading:true, waiters: cb ? [cb] : [], img:null, failed:false };
  var img = new Image();
  if (!isInlineCoverSrc(url)) img.crossOrigin = 'anonymous';
  img.onload = function(){
    rec.loaded = true; rec.loading = false; rec.img = img;
    rec.waiters.splice(0).forEach(function(fn){ setTimeout(function(){ fn(img); }, 0); });
  };
  img.onerror = function(){
    rec.loading = false; rec.failed = true;
    rec.waiters.splice(0).forEach(function(fn){ setTimeout(function(){ fn(null); }, 0); });
  };
  var src = coverProxySrc(url);
  if (!src) {
    rec.loading = false; rec.failed = true;
    rec.waiters.splice(0).forEach(function(fn){ setTimeout(function(){ fn(null); }, 0); });
    return;
  }
  img.src = src;
}

// ============================================================
//  3D 卡片交互 - PSP 风格
//   - 滚轮: 滚动 center 卡 (一级或二级)
//   - 点击 center 卡: 打开内容框 (歌单) 或 播放 (队列)
//   - 点击两侧卡: 滚到那张
//   - ESC: 关闭内容框
// ============================================================
function raycasterFromPointerEvent(e) {
  var mx = (e.clientX / innerWidth) * 2 - 1;
  var my = -(e.clientY / innerHeight) * 2 + 1;
  var rc = new THREE.Raycaster();
  rc.setFromCamera(new THREE.Vector2(mx, my), camera);
  return rc;
}
function pointerCardHit(rc, e, screenPad) {
  if (!shelfManager) return null;
  return shelfManager.raycastCards(rc) || (shelfManager.pickCardAtScreen && shelfManager.pickCardAtScreen(e.clientX, e.clientY, screenPad));
}
function isSideShelfFocusHit(e) {
  if (!e || !shelfManager || !shelfManager.getMode || shelfManager.getMode() !== 'side') return false;
  if (shelfPinnedOpen) return true;
  if (shelfAlwaysVisible()) return !!pointerCardHit(raycasterFromPointerEvent(e), e, 18);
  if (!shelfAutoHiddenInputReady()) return false;
  if (shelfVisibility > 0.34 && (isShelfClickZone(e) || isShelfPreviewUseZone(e))) return true;
  return !!(shelfPreviewIsVisible() && pointerCardHit(raycasterFromPointerEvent(e), e, 24));
}
function updateShelfCardHoverSelection(e) {
  if (!shelfManager || !shelfManager.clearSelected || !shelfManager.setSelected) return;
  if (!e || document.body.classList.contains('splash-active') || isPointerOverUi(e)) {
    shelfManager.clearSelected();
    return;
  }
  var mode = shelfManager.getMode && shelfManager.getMode();
  if (!mode || mode === 'off') {
    shelfManager.clearSelected();
    return;
  }
  if (shelfManager.hasOpenContent && shelfManager.hasOpenContent()) {
    shelfManager.clearSelected();
    return;
  }
  var canInteract = shelfManager.canInteract && shelfManager.canInteract();
  if (!canInteract) {
    shelfManager.clearSelected();
    return;
  }
  if (mode === 'side') {
    if (!shelfPinnedOpen && shelfAlwaysVisible()) {
      var alwaysHit = pointerCardHit(raycasterFromPointerEvent(e), e, 18);
      if (alwaysHit && alwaysHit.card) shelfManager.setSelected(alwaysHit.card.index);
      else shelfManager.clearSelected();
      return;
    }
    var sideUsable = shelfPinnedOpen || shelfAutoHiddenInputReady();
    if (!sideUsable) {
      shelfManager.clearSelected();
      return;
    }
  } else if (mode !== 'stage') {
    shelfManager.clearSelected();
    return;
  }
  var hit = pointerCardHit(raycasterFromPointerEvent(e), e);
  if (hit && hit.card) shelfManager.setSelected(hit.card.index);
  else shelfManager.clearSelected();
}
function isShelfPlaylistPlayHit(hit) {
  if (!hit || !hit.card || !hit.uv || !hit.card.item || hit.card.item.type !== 'playlist') return false;
  return hit.uv.x >= 0.49 && hit.uv.x <= 0.72 && hit.uv.y >= 0.13 && hit.uv.y <= 0.42;
}
renderer.domElement.addEventListener('click', function(e){
  if (!shelfManager || shelfManager.getMode() === 'off') return;
  if (document.body.classList.contains('splash-active')) return;
  if (isPointerOverUi(e)) return;
  if (mouseDownAt.hadDrag) { mouseDownAt.hadDrag = false; return; }

  var rc = raycasterFromPointerEvent(e);
  var mode = shelfManager.getMode();
  var canInteract = shelfManager.canInteract && shelfManager.canInteract();

  // 优先二级内容框
  if (shelfManager.hasOpenContent()) {
    var cl = shelfManager.getContentList && shelfManager.getContentList();
    if (cl) {
      var rowHit = cl.raycastRows(rc);
      if (!rowHit && cl.pickRowAtScreen) rowHit = cl.pickRowAtScreen(e.clientX, e.clientY);
      if (rowHit) {
        if (cl.pulseRow) cl.pulseRow(rowHit.row, 0.72);
        var selectedRow = Math.abs(rowHit.row.index - cl.getCenterIdx()) < 0.5;
        var rowIsPodcastRadio = !!(rowHit.row.song && rowHit.row.song.type === 'podcast-radio');
        var hitLikeButton = rowHit.uv && rowHit.uv.x > 0.61 && rowHit.uv.x < 0.68 && rowHit.uv.y > 0.20 && rowHit.uv.y < 0.82;
        var hitCollectButton = rowHit.uv && rowHit.uv.x >= 0.68 && rowHit.uv.x < 0.75 && rowHit.uv.y > 0.20 && rowHit.uv.y < 0.82;
        var hitNextButton = rowHit.uv && rowHit.uv.x >= 0.75 && rowHit.uv.x < 0.82 && rowHit.uv.y > 0.20 && rowHit.uv.y < 0.82;
        var hitPlayButton = rowHit.uv && rowHit.uv.x >= 0.82 && rowHit.uv.y > 0.20 && rowHit.uv.y < 0.82;
        var screenAction = (!rowHit.uv && cl.rowActionAtScreen) ? cl.rowActionAtScreen(rowHit.row, e.clientX, e.clientY) : null;
        hitLikeButton = hitLikeButton || screenAction === 'like';
        hitCollectButton = hitCollectButton || screenAction === 'collect';
        hitNextButton = hitNextButton || screenAction === 'next';
        hitPlayButton = hitPlayButton || screenAction === 'play';
        // 详情页支持直接点歌曲播放；红心/收藏按钮仍然保留原动作。
        if (selectedRow && !rowIsPodcastRadio && hitLikeButton) {
          toggleLikeDetailSong(rowHit.row.song);
        } else if (selectedRow && !rowIsPodcastRadio && hitCollectButton) {
          collectDetailSong(rowHit.row.song);
        } else if (selectedRow && !rowIsPodcastRadio && hitNextButton) {
          queueDetailSongNext(rowHit.row.song);
        } else if ((rowHit.row.song && rowHit.row.song.id) || rowIsPodcastRadio || (selectedRow && hitPlayButton)) {
          cl.playRow(rowHit.row);
        } else {
          // 滚到这行
          cl.scrollBy(rowHit.row.index - cl.getCenterIdx());
        }
        return;
      }
      var returnHit = shelfManager.raycastCards(rc);
      safeShelfCloseContent('shelf-card-return');
      if (mode === 'side') setShelfPinnedOpen(true, true);
      if (returnHit && returnHit.card) {
        shelfManager.scrollBy(returnHit.card.index - shelfManager.getCenterIdx());
      }
      return;
    }
  }

  // 一级卡片
  var hit = pointerCardHit(rc, e, mode === 'side' && !shelfPinnedOpen && shelfAlwaysVisible() ? 18 : undefined);
  if (mode === 'side' && !shelfPinnedOpen && !canUseSideShelfWithoutPinnedOpen()) return;

  if (hit) {
    if (mode === 'side') setShelfPinnedOpen(true, true);
    var idx = hit.card.index;
    if (Math.abs(idx - shelfManager.getCenterIdx()) < 0.5) {
      if (isShelfPlaylistPlayHit(hit) && shelfManager.playPlaylistAt && shelfManager.playPlaylistAt(idx)) return;
      shelfManager.openContent(idx);
    } else {
      shelfManager.scrollBy(idx - shelfManager.getCenterIdx());
    }
  } else if (mode === 'side' && shelfPinnedOpen) {
    setShelfPinnedOpen(false, true);
  }
});

renderer.domElement.addEventListener('contextmenu', function(e){
  if (document.body.classList.contains('splash-active')) return;
  if (isPointerOverUi(e)) return;
  e.preventDefault();
  e.stopPropagation();
  if (typeof suppressBottomControlsForShelf === 'function') suppressBottomControlsForShelf(980);
  if (!shelfManager) return;
  var mode = shelfManager.getMode && shelfManager.getMode();
  if (mode === 'off') {
    setShelfMode('side');
    mode = 'side';
  }
  if (mode !== 'side') return;
  if (shelfManager.hasOpenContent && shelfManager.hasOpenContent()) {
    var rc = raycasterFromPointerEvent(e);
    var cl = shelfManager.getContentList && shelfManager.getContentList();
    var rowHit = cl && cl.raycastRows ? cl.raycastRows(rc) : null;
    if (rowHit && rowHit.row && rowHit.row.song && rowHit.row.song.id && rowHit.row.song.type !== 'podcast-radio') {
      if (cl.pulseRow) cl.pulseRow(rowHit.row, 0.88);
      queueDetailSongNext(rowHit.row.song);
      return;
    }
    safeShelfCloseContent('shelf-context-toggle');
    setShelfPinnedOpen(true, true);
    return;
  }
  setShelfPinnedOpen(!shelfPinnedOpen, true);
  if (!shelfPinnedOpen && typeof setFocusZone === 'function') setFocusZone(null, true);
});

renderer.domElement.addEventListener('wheel', function(e){
  if (isPointerOverUi(e)) return;
  if (!shelfManager || shelfManager.getMode() === 'off') return;
  markRenderInteraction('shelf-wheel', 900);
  var rc = raycasterFromPointerEvent(e);
  // 二级框打开时, 只有真正命中详情行才接管滚轮
  if (shelfManager.hasOpenContent()) {
    var cl = shelfManager.getContentList();
    if (cl) {
      var rowHit = cl.raycastRows(rc);
      var panelHit = !rowHit && cl.raycastPanel ? cl.raycastPanel(rc) : null;
      var panelScreenHit = !rowHit && !panelHit && cl.screenContainsPanel ? cl.screenContainsPanel(e.clientX, e.clientY) : false;
      if (!rowHit && !panelHit && !panelScreenHit) return;
      e.preventDefault(); e.stopImmediatePropagation();
      cl.scrollBy(e.deltaY > 0 ? 1 : -1);
      return;
    }
  }
  var mode = shelfManager.getMode();
  var inShelfArea = false;
  var canScrollShelf = shelfManager.canInteract && shelfManager.canInteract();
  var shelfPreviewActive = shelfAutoHiddenInputReady();
  var cardWheelHit = canScrollShelf ? pointerCardHit(rc, e, mode === 'side' && !shelfPinnedOpen && shelfAlwaysVisible() ? 18 : undefined) : null;
  if (canScrollShelf && e.shiftKey && (mode !== 'side' || shelfPinnedOpen || shelfPreviewActive || shelfAlwaysVisible())) inShelfArea = true;
  else if (canScrollShelf && mode === 'side') {
    if (shelfPinnedOpen) inShelfArea = isShelfWheelZone(e) || !!cardWheelHit;
    else if (shelfAlwaysVisible()) inShelfArea = !!cardWheelHit;
    else if (shelfPreviewActive) inShelfArea = isShelfWheelZone(e) || !!cardWheelHit;
  }
  else if (canScrollShelf && mode === 'stage' && cardWheelHit) inShelfArea = true;
  if (inShelfArea) {
    e.preventDefault();
    e.stopImmediatePropagation();
    shelfManager.scrollBy(e.deltaY > 0 ? 1 : -1);
  }
}, { passive: false, capture: true });

// 键盘 / 全局事件
function isFreeCameraControlCode(code) {
  return /^(KeyW|KeyA|KeyS|KeyD|KeyQ|KeyE|Space|ShiftLeft|ShiftRight|ControlLeft|ControlRight)$/.test(code);
}
function consumeFreeCameraKeyEvent(e, isDown) {
  if (isTypingTarget(e.target)) return false;
  if (isDown && e.code === 'KeyR') {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.repeat) return true;
    toggleFreeCamera();
    return true;
  }
  if (!freeCamera || !freeCamera.active) return false;
  if (isDown && e.code === 'KeyK') {
    e.preventDefault();
    e.stopImmediatePropagation();
    resetFreeCameraToDefault();
    return true;
  }
  if (!isFreeCameraControlCode(e.code)) return false;
  e.preventDefault();
  e.stopImmediatePropagation();
  freeCamera.keys = freeCamera.keys || {};
  freeCamera.keys[e.code] = !!isDown;
  markRenderInteraction('free-camera-key', 900);
  return true;
}
document.addEventListener('keydown', function(e){
  consumeFreeCameraKeyEvent(e, true);
}, true);
document.addEventListener('keyup', function(e){
  consumeFreeCameraKeyEvent(e, false);
}, true);
document.addEventListener('keydown', function(e){
  if (isTypingTarget(e.target)) return;
  markRenderInteraction('keyboard', 700);
  if (e.code === 'KeyK') {
    e.preventDefault();
    if (freeCamera && (freeCamera.active || freeCamera.locked)) resetFreeCameraToDefault();
    else {
      recenterCamera();
      showToast('镜头已回正');
    }
    return;
  }
  if (e.code === 'KeyR') {
    if (e.repeat) return;
    e.preventDefault();
    toggleFreeCamera();
    return;
  }
  if (freeCamera && freeCamera.active) {
    if (/^(KeyW|KeyA|KeyS|KeyD|KeyQ|KeyE|Space|ShiftLeft|ShiftRight|ControlLeft|ControlRight)$/.test(e.code)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      freeCamera.keys[e.code] = true;
      return;
    }
  }
  if (!shelfManager) return;
  if (e.code === 'BracketRight' || e.code === 'PageDown') shelfManager.next();
  else if (e.code === 'BracketLeft' || e.code === 'PageUp') shelfManager.prev();
});
document.addEventListener('keyup', function(e){
  if (!freeCamera || !freeCamera.keys) return;
  if (/^(KeyW|KeyA|KeyS|KeyD|KeyQ|KeyE|Space|ShiftLeft|ShiftRight|ControlLeft|ControlRight)$/.test(e.code)) {
    freeCamera.keys[e.code] = false;
  }
});
window.addEventListener('blur', function(){
  if (freeCamera && freeCamera.keys) freeCamera.keys = {};
});
