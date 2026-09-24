/**
 * 预设巡检：量「歌词」与「场景主体（粒子/唱片）」各自在屏幕上的大小，跑遍 9–17 号预设。
 *
 * 为什么需要它：歌词世界尺寸恒定（worldW=6.10 × 0.96 × fx.lyricScale，空闲态无预设分支、
 * lockFitScale→1），屏上大小只由相机距离决定；而各预设的场景主体几何完全不同
 * （唱片壳 ±2.4 / 声波地形 13 宽 / 螺旋盘 14.8）。两者比例每个场景都不同 ——
 * 用户感知为「切换每个场景歌词大小都不一样」。这张表用来定「跟唱片同步」的补偿系数。
 *
 * 量法：
 *   歌词 = `THREE.Box3().setFromObject(current)` 投影 8 角（歌词是不透明平面，可见范围≈几何）；
 *   主体 = 隐藏歌词后 `renderer.render + gl.readPixels` 量亮像素（粒子几何的 boundingBox
 *          只有 ±2.4 的 aUv 铺底，**不含 shader 逐预设位移**，不能用作主体包围盒）。
 *
 * 用法：
 *   node_modules/electron/dist/electron.exe scripts/probe-lyric-scale-tour.js
 *   node_modules/electron/dist/electron.exe scripts/probe-lyric-scale-tour.js --presets=9,12,13
 */
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'out', 'lyric-scale-tour.json');
try { fs.mkdirSync(path.dirname(OUT), { recursive: true }); } catch (e) {}

const argOf = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const PRESETS = argOf('presets', '9,10,11,12,13,14,15,16,17').split(',').map(Number);

const LOG = [];
function LOGLINE(s) { LOG.push(s); try { fs.writeFileSync(OUT, JSON.stringify(LOG, null, 2)); } catch (e) {} }

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

app.whenReady().then(async function () {
  const W = 1092, H = 613;
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

    const script = `(async function(){
      var presets = ${JSON.stringify(PRESETS)};
      var TXT = 'Marry me Juliet you will never have to be alone';
      var out = { presets: presets, rows: [] };
      // ⚠️ 必须摘掉启动页/简单模式 —— 否则应用停在 splash 状态，主循环的相机机位
      //    被启动逻辑接管，orbit.radius 永远停在初始值 6.6（实测踩过）。
      document.body.classList.remove('splash-active', 'simple-mode');
      document.body.classList.add('desktop-shell');
      document.documentElement.classList.remove('simple-mode-preload');
      var panel = document.getElementById('fx-panel');
      if (panel) panel.classList.remove('show');
      var pv = camera.projectionMatrix.elements, vv = camera.matrixWorldInverse.elements;
      function mul4(M, x, y, z) {
        return [M[0]*x + M[4]*y + M[8]*z + M[12], M[1]*x + M[5]*y + M[9]*z + M[13],
                M[2]*x + M[6]*y + M[10]*z + M[14], M[3]*x + M[7]*y + M[11]*z + M[15]];
      }
      // 把 THREE.Box3 的 8 角投到 NDC → 屏占比 + 中心
      function projBox(bb) {
        var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, behind = 0;
        var cs = [[bb.min.x, bb.min.y, bb.min.z], [bb.min.x, bb.min.y, bb.max.z], [bb.min.x, bb.max.y, bb.min.z], [bb.min.x, bb.max.y, bb.max.z],
                  [bb.max.x, bb.min.y, bb.min.z], [bb.max.x, bb.min.y, bb.max.z], [bb.max.x, bb.max.y, bb.min.z], [bb.max.x, bb.max.y, bb.max.z]];
        for (var i = 0; i < 8; i++) {
          var v = mul4(vv, cs[i][0], cs[i][1], cs[i][2]);
          var c = mul4(pv, v[0], v[1], v[2]);
          if (c[3] <= 0.0001) { behind++; continue; }
          var nx = c[0]/c[3], ny = c[1]/c[3];
          if (nx < minX) minX = nx; if (nx > maxX) maxX = nx;
          if (ny < minY) minY = ny; if (ny > maxY) maxY = ny;
        }
        if (maxX === -Infinity) return { empty: true, behind: behind };
        return { wFrac: (maxX-minX)/2, hFrac: (maxY-minY)/2,
                 cx: (minX+maxX)/2, cy: (minY+maxY)/2, behind: behind };
      }
      function readBright(wantLyrics) {
        // 无音频时 uBass/uMid 全 0，暗色预设（rose/heart/rain）粒子 lum 到不了 90 —— 灌典型值
        if (typeof material !== 'undefined' && material && material.uniforms) {
          var u = material.uniforms;
          if (u.uBass) u.uBass.value = 0.38;
          if (u.uMid) u.uMid.value = 0.42;
          if (u.uTreble) u.uTreble.value = 0.30;
          if (u.uBeat) u.uBeat.value = 0.20;
        }
        if (stageLyrics.group) stageLyrics.group.visible = !!wantLyrics;
        renderer.render(scene, camera);
        var gl = renderer.getContext();
        var gw = gl.drawingBufferWidth, gh = gl.drawingBufferHeight;
        var px = new Uint8Array(gw*gh*4);
        gl.readPixels(0, 0, gw, gh, gl.RGBA, gl.UNSIGNED_BYTE, px);
        var n90 = 0, minX = gw, maxX = -1, minY = gh, maxY = -1;
        for (var y = 0; y < gh; y++) for (var x = 0; x < gw; x++) {
          var i = (y*gw+x)*4;
          if (0.2126*px[i] + 0.7152*px[i+1] + 0.0722*px[i+2] >= 90) {
            n90++;
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
          }
        }
        if (stageLyrics.group) stageLyrics.group.visible = true;
        return n90 ? { n90: n90, wFrac: (maxX-minX+1)/gw, hFrac: (maxY-minY+1)/gh } : { n90: 0 };
      }
      function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

      // 保住歌词 mesh：没播放且未开「暂停保留歌词」时 tickLyricsParticles 每帧清掉 current
      if (typeof fx !== 'undefined' && fx) { fx.particleLyrics = true; fx.lyricPauseHold = true; }

      for (var pi = 0; pi < presets.length; pi++) {
        var p = presets[pi];
        setPreset(p, { noSave: true, silent: true, skipTransition: true });
        await sleep(2400);                       // 相机 lerp 收敛
        try { clearStageLyrics(); } catch (e) {}
        // 填一行歌词数据：否则 tickLyricsParticles:1215 因 lyricsLines 为空每帧清掉 current
        try {
          applyLyricsState([{ t: 0, text: TXT }], false, 'fallback');
        } catch (e) {}
        stageLyrics.currentIdx = 0;
        showStageLine(TXT);
        await sleep(1200);                       // 淡入 + lockFitScale 缓动

        var row = { preset: p, radius: Math.round(orbit.radius*100)/100,
                    groupScale: Math.round(stageLyrics.group.scale.x*1000)/1000,
                    lockFitScale: Math.round(stageLyrics.lockFitScale*1000)/1000,
                    fxPreset: fx.preset,
                    orbit: { userRadius: orbit.userRadius, baselineRadius: orbit.baselineRadius,
                             centerLocked: !!orbit.centerLocked, recentering: !!orbit.recentering,
                             cineRadius: orbit.cineRadius, cinePhi: orbit.cinePhi,
                             focusActive: !!orbit.focus.active,
                             userPhi: orbit.userPhi, baselinePhi: orbit.baselinePhi },
                    camPos: [camera.position.x, camera.position.y, camera.position.z].map(function (v) { return Math.round(v * 100) / 100; }),
                    freeCam: (typeof freeCamera !== 'undefined' && freeCamera)
                      ? { active: !!freeCamera.active, locked: !!freeCamera.locked,
                          pos: freeCamera.position ? [freeCamera.position.x, freeCamera.position.y, freeCamera.position.z].map(function (v) { return Math.round(v * 100) / 100; }) : null }
                      : 'undefined' };
        if (stageLyrics.current) {
          var lb = new THREE.Box3().setFromObject(stageLyrics.current);
          row.lyricBox = projBox(lb);
        } else { row.lyricError = 'no current mesh'; }
        row.particlesBright = readBright(false);   // 隐藏歌词，只量场景主体
        out.rows.push(row);
      }

      // 滚轮行为验证：模拟滚轮拉远 userRadius（baselineRadius 不动）→
      // 补偿锚定 baselineRadius，groupScale 应保持不变（歌词世界尺寸固定、与背景一起透视缩放）
      var wt = { userBefore: Math.round(orbit.userRadius*100)/100,
                 groupBefore: Math.round(stageLyrics.group.scale.x*1000)/1000 };
      orbit.userRadius += 2.0;
      await sleep(2400);
      wt.userAfter = Math.round(orbit.userRadius*100)/100;
      wt.orbitRadiusAfter = Math.round(orbit.radius*100)/100;
      wt.groupAfter = Math.round(stageLyrics.group.scale.x*1000)/1000;
      wt.groupScaleUnchanged = Math.abs(wt.groupAfter - wt.groupBefore) < 0.005;
      out.wheelTest = wt;
      return JSON.stringify(out);
    })()`;

    const raw = await win.webContents.executeJavaScript(script);
    const data = JSON.parse(raw);
    LOG.push(data);
    fs.writeFileSync(OUT, JSON.stringify(LOG, null, 2));

    const pc = (v) => (v * 100).toFixed(0).padStart(4) + '%';
    console.log('歌词 TXT 世界尺寸恒定，屏上大小只随相机距离变；主体用亮像素实测');
    console.log('');
    console.log('预设  radius  groupScale  | 歌词屏宽  歌词屏高  中心y | 主体屏宽  主体屏高 | 歌词/主体');
    let prev = null;
    for (const r of data.rows) {
      const lb = r.lyricBox || {};
      const ratio = (lb.wFrac && r.particlesBright.wFrac) ? (lb.wFrac / r.particlesBright.wFrac) : null;
      console.log(
        String(r.preset).padStart(4) + '  ' + String(r.radius).padStart(6) + '  ' + String(r.groupScale).padStart(10) +
        '  |  ' + pc(lb.wFrac || 0) + '   ' + pc(lb.hFrac || 0) + '   ' + ((lb.cy || 0)).toFixed(2) +
        '  |  ' + pc(r.particlesBright.wFrac || 0) + '   ' + pc(r.particlesBright.hFrac || 0) +
        '  |  ' + (ratio ? ratio.toFixed(2) : '—') +
        (r.lyricError ? '  ⚠ ' + r.lyricError : '')
      );
      console.log('      orbit ' + JSON.stringify(r.orbit) + '  fxPreset=' + r.fxPreset);
      prev = r;
    }
    const w = data.wheelTest;
    if (w) {
      console.log('');
      console.log('【滚轮验证】userRadius ' + w.userBefore + ' → ' + w.userAfter +
        '（orbit.radius 收敛到 ' + w.orbitRadiusAfter + '）  groupScale ' + w.groupBefore + ' → ' + w.groupAfter +
        '  ' + (w.groupScaleUnchanged ? '✅ 不随滚轮变（歌词世界尺寸固定，与背景一起透视缩放）' : '❌ 被滚轮带动'));
    }
    LOGLINE('done');
  } catch (e) {
    LOGLINE('ERROR ' + (e && e.stack || e));
    console.error('❌ ' + (e && e.stack || e));
  }
  win.destroy();
  app.quit();
  process.exit(0);
});
