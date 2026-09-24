/**
 * 离屏 Electron 实测：量某个视觉预设的**取景**（内容在屏幕上占多大）。
 *
 * 为什么需要它：预设的机位在 `public/js/web-fx-presets.js` 的 `PRESET_CAMERA` 里
 * （`{ radius, phi }`），但「看起来多远」= 机位 × 内容包围盒 × 视口宽高比，
 * 手算很容易和肉眼观感对不上。这里用**页面里真实的 `camera` 对象**做投影，排除假设。
 *
 * 两条独立证据链：
 *   ① 解析：把预设分支里 shader 写死的世界坐标包围盒，经 `particles.matrixWorld` →
 *      真实 `camera` 投影到 NDC，得到「占视口宽/高百分比 + 近边/远边梯形宽度」；
 *   ② 实测：`renderer.render()` 后立刻 `gl.readPixels()` 读帧缓冲，统计亮像素包围盒
 *      —— 只含 WebGL 内容（不含 DOM），绕开 `capturePage()` 在无头下抓不到合成帧的问题。
 *
 * 用法：
 *   node_modules/electron/dist/electron.exe scripts/probe-preset-framing.js
 *   node_modules/electron/dist/electron.exe scripts/probe-preset-framing.js --preset=13
 *   node_modules/electron/dist/electron.exe scripts/probe-preset-framing.js --radii=9.2,8.6,8.0,7.4,6.8
 *   （`npm run probe:ui` 会用默认参数跑一遍，作为「机位确实被 setPreset 应用 + readPixels
 *     测量链路有效」的闸门；它**不锁 radius 具体值**，因为那是审美参数。）
 */
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'out', 'preset-framing-probe.json');
try { fs.mkdirSync(path.dirname(OUT), { recursive: true }); } catch (e) {}

const argOf = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const PRESET = Number(argOf('preset', '12'));
const RADII = argOf('radii', '9.2,8.0,7.6,7.2').split(',').map(Number);
/** 是否保留歌词舞台。默认隐藏 —— 它是最亮的元素，会把「亮像素包围盒」撑满。
 *  加 `--showLyrics` 保留，用来目视核对歌词朝向（是否正对镜头）。 */
const SHOW_LYRICS = process.argv.includes('--showLyrics');

/** shader 里每个预设写死的内容包围盒（对象空间）。缺省用基座平面 PLANE_SIZE=4.8。 */
const BOXES = {
  12: { x: [-6.5, 6.5], y: [-1.2, 3.6], z: [-7.5, -0.5], note: 'sonic：worldX=(gx-.5)*13 → ±6.5；worldZ=(gz-.5)*7 再 -4 → [-7.5,-.5]；y 取 h 的可见区间' },
  13: { x: [-7.4, 7.4], y: [-0.9, 0.9], z: [-7.4, 7.4], note: 'spiral：SPIRAL_RMAX=7.4 的盘' },
};

const LOG = [];
function LOGLINE(s) { LOG.push(s); try { fs.writeFileSync(OUT, JSON.stringify(LOG, null, 2)); } catch (e) {} }

app.commandLine.appendSwitch('no-sandbox');
// 允许无 GPU 时回退到软件 WebGL（否则 readPixels 拿不到内容）
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

app.whenReady().then(async function () {
  const W = 1092, H = 613;   // 对齐用户截图的分辨率
  // ⚠️ 不能用 offscreen:true —— 该模式下 capturePage() 抓到的是全黑帧（已实测）。
  //    改用「真实窗口 + 移出屏幕外」：窗口可见 → compositor 正常产出帧，
  //    且 backgroundThrottling 关掉 → rAF 不被后台节流。
  const win = new BrowserWindow({
    width: W, height: H, useContentSize: true, show: false,
    webPreferences: { sandbox: false, nodeIntegration: false, contextIsolation: false },
  });
  win.webContents.setBackgroundThrottling(false);

  try {
    await win.loadFile(path.join(ROOT, 'public/index.html'));
    LOGLINE('loaded');
    win.showInactive();
    win.setPosition(-20000, -20000);
    await new Promise((r) => setTimeout(r, 2500));

    const box = BOXES[PRESET] || { x: [-2.4, 2.4], y: [-2.4, 2.4], z: [-2.4, 2.4], note: '基座平面 PLANE_SIZE=4.8' };

    const script = `(async function(){
      var box = ${JSON.stringify({ x: box.x, y: box.y, z: box.z })};
      var radii = ${JSON.stringify(RADII)};
      var out = { preset: ${PRESET}, box: box, boxNote: ${JSON.stringify(box.note)}, radii: [], frames: [], state: {} };

      document.body.classList.remove('splash-active', 'simple-mode');
      document.body.classList.add('desktop-shell');
      document.documentElement.classList.remove('simple-mode-preload');
      var panel = document.getElementById('fx-panel');
      if (panel) panel.classList.remove('show');

      if (typeof setPreset !== 'function') { out.error = 'setPreset 不是函数'; return JSON.stringify(out); }
      setPreset(${PRESET}, { noSave: true, silent: true, skipTransition: true });
      // ⚠️ 必须等相机 lerp 收敛再读状态：setPreset 只写 userRadius/baselineRadius，
      //    orbit.radius 是按帧缓动的（02-scene.js:1409），立刻读会拿到**切换前**的旧值。
      await new Promise(function (r) { setTimeout(r, 2200); });

      // --showLyrics：探针没有播放音乐，歌词舞台是空的 —— 手动造一行，
      // 才能在帧图里核对「歌词是否正对镜头」（梯形 vs 矩形）。
      if (${SHOW_LYRICS} && typeof showStageLine === 'function') {
        try {
          stageLyrics.currentIdx = 0;
          showStageLine('Is this what is in my head');
          await new Promise(function (r) { setTimeout(r, 900); });
        } catch (e) { out.lyricSeedError = String(e && e.message || e); }
      }

      // ---- 投影：把 box 的 8 个角经 particles.matrixWorld 变到世界，再用真实 camera 投到 NDC ----
      var m = particles.matrixWorld.elements;
      var pv = camera.projectionMatrix.elements, vv = camera.matrixWorldInverse.elements;
      function mul4(M, x, y, z) {
        return [
          M[0]*x + M[4]*y + M[8]*z  + M[12],
          M[1]*x + M[5]*y + M[9]*z  + M[13],
          M[2]*x + M[6]*y + M[10]*z + M[14],
          M[3]*x + M[7]*y + M[11]*z + M[15],
        ];
      }
      function ndcOf(lx, ly, lz) {
        var w = mul4(m, lx, ly, lz);
        var v = mul4(vv, w[0], w[1], w[2]);
        var c = mul4(pv, v[0], v[1], v[2]);
        if (c[3] <= 0.0001) return null;
        return [c[0] / c[3], c[1] / c[3], w];
      }
      function span(pts) {
        var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, behind = 0;
        for (var i = 0; i < pts.length; i++) {
          if (!pts[i]) { behind++; continue; }
          var q = pts[i];
          if (q[0] < minX) minX = q[0]; if (q[0] > maxX) maxX = q[0];
          if (q[1] < minY) minY = q[1]; if (q[1] > maxY) maxY = q[1];
        }
        if (maxX === -Infinity) return { behind: behind, empty: true };
        return {
          wFrac: (maxX - minX) / 2, hFrac: (maxY - minY) / 2,
          cx: (minX + maxX) / 2, cy: (minY + maxY) / 2,
          minX: minX, maxX: maxX, minY: minY, maxY: maxY,
          overflowX: minX < -1 || maxX > 1, overflowY: minY < -1 || maxY > 1, behind: behind,
        };
      }
      // 近边(Z=max)、远边(Z=min) 的梯形宽度 —— 8 角包围盒只报最宽的近边，会掩盖收拢
      function edge(z, lo, hi, which) {
        var pts = [];
        var xs = [box.x[0], box.x[1]], ys = [box.y[0], box.y[1]];
        for (var i = 0; i < xs.length; i++) for (var j = 0; j < ys.length; j++) pts.push(ndcOf(xs[i], ys[j], z));
        var s = span(pts); s.which = which; return s;
      }
      function project() {
        var pts = [], wMin = [Infinity, Infinity, Infinity], wMax = [-Infinity, -Infinity, -Infinity];
        for (var i = 0; i < 8; i++) {
          var lx = box.x[(i >> 2) & 1], ly = box.y[(i >> 1) & 1], lz = box.z[i & 1];
          var q = ndcOf(lx, ly, lz);
          pts.push(q);
          if (q) {
            for (var k = 0; k < 3; k++) {
              if (q[2][k] < wMin[k]) wMin[k] = q[2][k];
              if (q[2][k] > wMax[k]) wMax[k] = q[2][k];
            }
          }
        }
        var s = span(pts);
        s.worldMin = wMin.map(function(v){ return Math.round(v*100)/100; });
        s.worldMax = wMax.map(function(v){ return Math.round(v*100)/100; });
        return s;
      }

      // ---- 同步设相机姿态：orbit 公式见 public/js/app/02-scene.js:1416 ----
      function pose(r, phi, theta, lookAt) {
        var cy = Math.cos(phi), sy = Math.sin(phi), ct = Math.cos(theta), st = Math.sin(theta);
        camera.position.set(
          lookAt.x + r * cy * st,
          lookAt.y + r * sy,
          lookAt.z + r * cy * ct
        );
        camera.up.set(0, 1, 0);
        camera.lookAt(lookAt.x, lookAt.y, lookAt.z);
        camera.updateMatrixWorld(true);
        camera.updateProjectionMatrix();
      }

      out.state = {
        fov: camera.fov, aspect: camera.aspect, near: camera.near, far: camera.far,
        camPos: [Math.round(camera.position.x*1000)/1000, Math.round(camera.position.y*1000)/1000, Math.round(camera.position.z*1000)/1000],
        lookAt: [orbit.lookAt.x, orbit.lookAt.y, orbit.lookAt.z],
        orbitRadius: Math.round(orbit.radius*1000)/1000,
        userRadius: orbit.userRadius, baselineRadius: orbit.baselineRadius,
        userPhi: orbit.userPhi, baselinePhi: orbit.baselinePhi,
        theta: Math.round(orbit.theta*1000)/1000,
        minRadius: orbit.minRadius, maxRadius: orbit.maxRadius,
        centerLocked: !!orbit.centerLocked, focusActive: !!orbit.focus.active,
        cineRadius: orbit.cineRadius, cinePhi: orbit.cinePhi,
        particlesRot: [particles.rotation.x, particles.rotation.y, particles.rotation.z],
        particlesScale: [particles.scale.x, particles.scale.y, particles.scale.z],
        particlesVisible: particles.visible,
        grid: (particles.geometry && particles.geometry.userData) ? particles.geometry.userData.grid : null,
        viewport: [innerWidth, innerHeight],
      };

      // 配置里该预设的机位（用来判「机位到底有没有被 setPreset 应用上去」）
      out.camCfg = (typeof WebFxPresets !== 'undefined' && WebFxPresets.PRESET_CAMERA)
        ? (WebFxPresets.PRESET_CAMERA[${PRESET}] || null) : null;

      /* 歌词朝向 vs 相机：0° = 歌词平面正对镜头（法线指向相机）。
       * 默认分支（04-lyrics.js:964）用粒子的世界四元数当歌词朝向，粒子静止时是 identity，
       * 于是歌词相对**俯视**的相机就歪了 —— 这个角就是用户说的「不是正对着镜头」。 */
      try {
        var lq = stageLyrics.group.quaternion, cq = camera.quaternion;
        var qdot = Math.abs(lq.x * cq.x + lq.y * cq.y + lq.z * cq.z + lq.w * cq.w);
        out.lyricTiltDeg = Math.round(Math.acos(Math.min(1, qdot)) * 2 * 180 / Math.PI * 10) / 10;
        out.lyricQuat = [lq.x, lq.y, lq.z, lq.w].map(function (v) { return Math.round(v * 1000) / 1000; });
        out.cameraQuat = [cq.x, cq.y, cq.z, cq.w].map(function (v) { return Math.round(v * 1000) / 1000; });
        out.lyricCameraLock = !!(typeof fx !== 'undefined' && fx && fx.lyricCameraLock);
        // 诊断：歌词 mesh 到底建出来没有（探针没播放音乐，靠 showStageLine 手动造行）
        var cur = stageLyrics.current;
        out.lyricDiag = {
          hasCurrent: !!cur,
          currentVisible: cur ? cur.visible : null,
          currentText: cur && cur.userData ? cur.userData.text : null,
          groupVisible: stageLyrics.group.visible,
          groupParentIsScene: stageLyrics.group.parent === scene,
          groupChildren: stageLyrics.group.children.length,
          groupPos: [stageLyrics.group.position.x, stageLyrics.group.position.y, stageLyrics.group.position.z].map(function (v) { return Math.round(v * 1000) / 1000; }),
          groupScale: Math.round(stageLyrics.group.scale.x * 1000) / 1000,
        };
      } catch (e) { out.lyricMeasureError = String(e && e.message || e); }

      var la = { x: orbit.lookAt.x, y: orbit.lookAt.y, z: orbit.lookAt.z };
      out.current = project();
      out.currentNearEdge = edge(box.z[1], 0, 0, 'near');
      out.currentFarEdge  = edge(box.z[0], 0, 0, 'far');

      for (var k2 = 0; k2 < radii.length; k2++) {
        pose(radii[k2], orbit.userPhi, orbit.userTheta + orbit.cineTheta, la);
        var pr = project();
        pr.radius = radii[k2];
        pr.nearEdge = edge(box.z[1], 0, 0, 'near');
        pr.farEdge  = edge(box.z[0], 0, 0, 'far');
        out.radii.push(pr);
      }

      // ---- 实测：render + readPixels（只含 WebGL，不含 DOM）----
      function analyze(px, W, H) {
        var col26 = new Int32Array(W), row26 = new Int32Array(H);
        var n8 = 0, n26 = 0, n90 = 0;
        var x90min = W, x90max = -1, y90min = H, y90max = -1;
        for (var y = 0; y < H; y++) {
          for (var x = 0; x < W; x++) {
            var i = (y * W + x) * 4;
            var lum = 0.2126 * px[i] + 0.7152 * px[i+1] + 0.0722 * px[i+2];
            if (lum >= 8) n8++;
            if (lum >= 26) { n26++; col26[x]++; row26[y]++; }
            if (lum >= 90) {
              n90++;
              if (x < x90min) x90min = x; if (x > x90max) x90max = x;
              if (y < y90min) y90min = y; if (y > y90max) y90max = y;
            }
          }
        }
        function pct(arr, total, p) {
          var acc = 0, t = total * p;
          for (var k = 0; k < arr.length; k++) { acc += arr[k]; if (acc >= t) return k; }
          return arr.length - 1;
        }
        var r = { W: W, H: H, n8: n8, n26: n26, n90: n90 };
        if (n90 > 0) {
          // readPixels 的 y=0 在**底部**，翻成屏幕坐标
          r.bright = {
            wFrac: (x90max - x90min + 1) / W, hFrac: (y90max - y90min + 1) / H,
            cxFrac: (x90min + x90max + 1) / 2 / W, cyFrac: 1 - (y90min + y90max + 1) / 2 / H,
          };
        }
        if (n26 > 0) {
          var l = pct(col26, n26, 0.02), rr = pct(col26, n26, 0.98);
          var b = pct(row26, n26, 0.02), t2 = pct(row26, n26, 0.98);
          r.midPct = { wFrac: (rr - l + 1) / W, hFrac: (t2 - b + 1) / H };
        }
        return r;
      }

      // 把帧缓冲写成 PNG dataURL —— capturePage() 在无头下抓不到 WebGL 合成帧，
      // 但 readPixels 拿到的原始像素可以手动画进 2D canvas 再导出，得到**真实画面**。
      function frameToPng(px, W, H) {
        var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
        var ctx = cv.getContext('2d');
        var img = ctx.createImageData(W, H);
        for (var y = 0; y < H; y++) {
          var src = (H - 1 - y) * W * 4, dst = y * W * 4;   // readPixels y=0 在底部，翻转
          for (var x = 0; x < W * 4; x++) img.data[dst + x] = px[src + x];
        }
        ctx.putImageData(img, 0, 0);
        return cv.toDataURL('image/png');
      }

      function readFrameAt(r) {
        pose(r, orbit.userPhi, orbit.userTheta + orbit.cineTheta, la);
        // 让山脊形态接近真实播放（无音频时 uBass/uMid 都是 0，山脊会是平的）
        if (typeof material !== 'undefined' && material && material.uniforms) {
          var u = material.uniforms;
          // 固定时刻：否则每个 radius 采样到的山脊/星云形态不同，占宽占高不可比（实测波动 ±5pt）
          if (u.uTime) u.uTime.value = 12.0;
          if (u.uBass) u.uBass.value = 0.38;
          if (u.uMid) u.uMid.value = 0.42;
          if (u.uTreble) u.uTreble.value = 0.30;
          if (u.uBeat) u.uBeat.value = 0.20;
        }
        renderer.render(scene, camera);
        var gl = renderer.getContext();
        var gw = gl.drawingBufferWidth, gh = gl.drawingBufferHeight;
        var px = new Uint8Array(gw * gh * 4);
        gl.readPixels(0, 0, gw, gh, gl.RGBA, gl.UNSIGNED_BYTE, px);
        var res = analyze(px, gw, gh);
        res.radius = r;
        try { res.png = frameToPng(px, gw, gh); } catch (e) { res.pngError = String(e && e.message || e); }
        return res;
      }

      // 只保留 particles 可见，排除星空/网格等其它场景对象
      // （--showLyrics 时把歌词舞台也留着，用来核对朝向是否正对镜头）
      var keepLyrics = ${SHOW_LYRICS} && (typeof stageLyrics !== 'undefined' && stageLyrics && stageLyrics.group);
      var savedVis = [];
      for (var si = 0; si < scene.children.length; si++) {
        var o = scene.children[si];
        if (o === particles) continue;
        if (keepLyrics && o === stageLyrics.group) continue;
        savedVis.push([o, o.visible]); o.visible = false;
      }
      for (var fi = 0; fi < radii.length; fi++) {
        try { out.frames.push(readFrameAt(radii[fi])); } catch (e) { out.frames.push({ radius: radii[fi], error: String(e && e.message || e) }); }
      }
      // 恢复
      for (var vi = 0; vi < savedVis.length; vi++) savedVis[vi][0].visible = savedVis[vi][1];
      pose(orbit.radius, orbit.phi, orbit.theta, la);

      return JSON.stringify(out);
    })()`;

    const raw = await win.webContents.executeJavaScript(script);
    const data = JSON.parse(raw);
    LOGLINE('measured');
    // 帧图单独落盘，别把 base64 塞进 JSON
    const pngFiles = [];
    for (const f of (data.frames || [])) {
      if (f.png) {
        const p = path.join(__dirname, 'out', 'framing-p' + PRESET + '-r' + f.radius + '.png');
        try { fs.writeFileSync(p, Buffer.from(f.png.split(',')[1], 'base64')); pngFiles.push(p); } catch (e) {}
      }
      delete f.png;
    }
    LOG.push(data);
    fs.writeFileSync(OUT, JSON.stringify(LOG, null, 2));

    // 截图留证（无头下 capturePage 可能仍是黑的，仅作参考）
    try {
      const img = await win.webContents.capturePage();
      const png = path.join(__dirname, 'out', 'preset-framing-preset' + PRESET + '.png');
      fs.writeFileSync(png, img.toPNG());
      LOGLINE('screenshot ' + path.relative(ROOT, png) + ' (' + img.toBitmap().length + ' bytes bitmap)');
    } catch (e) { LOGLINE('capturePage 失败: ' + e.message); }

    // ---- 控制台摘要 ----
    const s = data.state || {};
    const pc = (v) => (v * 100).toFixed(0).padStart(4) + '%';
    console.log('预设 ' + data.preset + '  视口 ' + (s.viewport || []).join('×') + '  fov ' + s.fov + '  aspect ' + (s.aspect || 0).toFixed(3));
    console.log('真实机位：radius ' + s.orbitRadius + ' (user ' + s.userRadius + ' / baseline ' + s.baselineRadius + ')  phi ' + s.userPhi + '  theta ' + s.theta);
    console.log('  相机位置 ' + JSON.stringify(s.camPos) + '  lookAt ' + JSON.stringify(s.lookAt) + '  min/max radius ' + s.minRadius + '/' + s.maxRadius);
    console.log('  粒子旋转 ' + JSON.stringify(s.particlesRot) + '  缩放 ' + JSON.stringify(s.particlesScale) + '  grid ' + s.grid);
    console.log('  歌词朝向 vs 相机：' + data.lyricTiltDeg + '°（0 = 正对镜头）  lyricCameraLock=' + data.lyricCameraLock);
    console.log('    歌词四元数 ' + JSON.stringify(data.lyricQuat) + '  相机四元数 ' + JSON.stringify(data.cameraQuat));
    console.log('    歌词诊断 ' + JSON.stringify(data.lyricDiag) + (data.lyricSeedError ? '  seedError=' + data.lyricSeedError : ''));
    console.log('包围盒 ' + JSON.stringify(data.box) + '  →  世界 ' + JSON.stringify(data.current.worldMin) + ' … ' + JSON.stringify(data.current.worldMax));
    console.log('');
    console.log('【解析】radius   8角包围盒占宽/高     近边占宽    远边占宽    纵向(近底→远顶)');
    for (const r of data.radii) {
      const vTop = Math.max(r.farEdge.maxY, r.nearEdge.maxY), vBot = Math.min(r.farEdge.minY, r.nearEdge.minY);
      console.log(
        String(r.radius).padStart(12) + '   ' + pc(r.wFrac) + ' / ' + pc(r.hFrac) +
        '        ' + pc(r.nearEdge.wFrac) + '      ' + pc(r.farEdge.wFrac) +
        '        ' + pc((vTop - vBot) / 2)
      );
    }
    console.log('');
    console.log('【实测 gl.readPixels】radius   亮(lum≥90)占宽/高   中心(x,y)      中(lum≥26)占宽/高   像素数(90/26/8)');
    for (const f of data.frames) {
      if (f.error) { console.log(String(f.radius).padStart(22) + '   ❌ ' + f.error); continue; }
      const br = f.bright ? (pc(f.bright.wFrac) + ' / ' + pc(f.bright.hFrac) + '   (' + (f.bright.cxFrac*100).toFixed(0) + '%,' + (f.bright.cyFrac*100).toFixed(0) + '%)') : '（无亮像素）';
      const md = f.midPct ? (pc(f.midPct.wFrac) + ' / ' + pc(f.midPct.hFrac)) : '—';
      console.log(String(f.radius).padStart(22) + '   ' + br.padEnd(30) + '  ' + md.padEnd(18) + '  ' + f.n90 + '/' + f.n26 + '/' + f.n8);
    }
    /* 闸门载荷：只判「测量链路是否有效 + 机位是否真的被应用」，
     * **不锁死 radius 的具体值** —— 那是审美参数，用户随时会调。
     * 防止的假绿：readPixels 在无头下拿不到像素时，探针会「跑完但什么都没测到」。 */
    const fails = [];
    const expected = data.camCfg ? data.camCfg.radius : null;
    if (data.error) fails.push('页面侧报错：' + data.error);
    if (expected != null && Math.abs(s.userRadius - expected) > 0.01) {
      fails.push('机位未应用：userRadius=' + s.userRadius + '，但 PRESET_CAMERA[' + PRESET + '].radius=' + expected);
    }
    const anyBright = (data.frames || []).some((f) => f.n90 > 0);
    if (!anyBright) fails.push('readPixels 拿不到任何亮像素（测量链路失效，本次结论不可信）');
    LOGLINE('RESULT ' + JSON.stringify({
      preset: PRESET, verdict: fails.length ? 'FAIL' : 'PASS', fails: fails,
      userRadius: s.userRadius, expectedRadius: expected,
      brightWidthPct: (data.frames && data.frames[0] && data.frames[0].bright)
        ? Math.round(data.frames[0].bright.wFrac * 100) : null,
    }));
  } catch (e) {
    LOGLINE('RESULT ' + JSON.stringify({ preset: PRESET, verdict: 'FAIL', fails: ['探针异常：' + (e && e.message || e)] }));
    console.error('❌ ' + (e && e.stack || e));
  }
  win.destroy();
  app.quit();
  process.exit(0);
});
