/**
 * 关闭对话框四角圆角验证：用与 desktop/main.js 相同的窗口参数加载 close-dialog.html，
 * capturePage 后按像素检查遮罩层最外缘四角的 alpha —— 圆角生效则四角透明（alpha≈0），
 * 直角则不透明。顺带检查 dialog 卡片中央应不透明。
 *
 * 背景：overlay 遮罩曾是无圆角直角矩形，把主窗口最外缘四个 34px 圆角「填直」。
 *
 * 用法：node_modules/electron/dist/electron.exe scripts/probe-close-dialog-corners.js
 * （一次性验证探针，不进 probe:ui —— 窗口会短暂弹出后移出屏幕）
 */
'use strict';
const { app, BrowserWindow } = require('electron');
const path = require('path');

app.commandLine.appendSwitch('no-sandbox');

app.whenReady().then(async function () {
  const W = 1092, H = 613;
  const win = new BrowserWindow({
    width: W, height: H, useContentSize: true, show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',   // 与修复后的 closeDialogWindow 一致
    hasShadow: false,
    resizable: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false },
  });
  win.webContents.setBackgroundThrottling(false);
  try {
    await win.loadFile(path.join(__dirname, '..', 'public', 'close-dialog.html'));
    win.showInactive();
    win.setPosition(-20000, -20000);
    await new Promise((r) => setTimeout(r, 900));

    const img = await win.webContents.capturePage();
    const bmp = img.toBitmap();
    const sz = img.getSize();
    const px = (x, y) => {
      const i = (y * sz.width + x) * 4;
      return { a: bmp[i + 3], r: bmp[i + 2], g: bmp[i + 1], b: bmp[i] };
    };
    const corners = {
      左上: px(2, 2), 右上: px(sz.width - 3, 2),
      左下: px(2, sz.height - 3), 右下: px(sz.width - 3, sz.height - 3),
      边中上: px((sz.width / 2) | 0, 2),
      中心: px((sz.width / 2) | 0, (sz.height / 2) | 0),
    };
    console.log('窗口 ' + sz.width + '×' + sz.height + '（capturePage 像素，BGRA 的 alpha 通道）');
    for (const [k, v] of Object.entries(corners)) {
      let tag;
      if (k === '边中上') tag = v.a > 100 ? ' ✅ 遮罩正常覆盖（rgba .55≈alpha 140，圆角只在四角）' : ' ⚠ 遮罩没盖到顶边';
      else if (k === '中心') tag = v.a > 100 ? ' ✅ dialog 卡片正常渲染' : ' ⚠ 卡片未渲染';
      else tag = v.a < 8 ? ' ✅ 透明（圆角生效）' : ' ❌ 不透明（直角）';
      console.log('  ' + k.padEnd(4) + ' alpha=' + String(v.a).padStart(3) + '  rgb(' + v.r + ',' + v.g + ',' + v.b + ')' + tag);
    }
    const four = [corners.左上, corners.右上, corners.左下, corners.右下];
    const ok = four.every((v) => v.a < 8);
    console.log(ok ? '\n✅ 四角全部透明 —— 遮罩圆角生效，最外缘四角不会盖住主窗口圆角'
                   : '\n❌ 存在不透明角 —— 圆角未生效（或 capturePage 丢失 alpha，需实机复核）');
  } catch (e) {
    console.error('❌ ' + (e && e.stack || e));
  }
  win.destroy();
  app.quit();
  process.exit(0);
});
