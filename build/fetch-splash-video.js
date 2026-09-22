'use strict';

/**
 * 拉取启动页背景视频到 public/media/splash-bg.mp4。
 *
 * 为什么需要：该视频 21MB，不适合进 Git 仓库（每次 clone 都要拉），因此
 * 本地文件被 .gitignore 忽略，改为构建前按需下载。运行时代码是「本地优先 +
 * CDN 回退」双保险（见 main.js 的 initSplashBgVideoFallback），所以即使本脚本
 * 没跑过，首次运行也能通过 CDN 正常显示。
 *
 * 用法：
 *   node build/fetch-splash-video.js           # 已存在且体积合理则跳过
 *   node build/fetch-splash-video.js --force   # 强制重新下载
 *
 * 由 package.json 的 prebuild:win / prebuild:win:dir 自动调用。
 */

const fs = require('fs');
const path = require('path');

const URL = 'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260418_063509_7d167302-4fd4-480b-8260-18ab572333d4.mp4';
const OUT_DIR = path.join(__dirname, '..', 'public', 'media');
const OUT_FILE = path.join(OUT_DIR, 'splash-bg.mp4');
/** 合理体积下限（防止下载到错误页面/半截文件） */
const MIN_BYTES = 5 * 1024 * 1024;

const force = process.argv.includes('--force');

async function main() {
  if (!force && fs.existsSync(OUT_FILE)) {
    const size = fs.statSync(OUT_FILE).size;
    if (size > MIN_BYTES) {
      console.log('[fetch-splash-video] 已存在（' + (size / 1048576).toFixed(1) + ' MB），跳过');
      process.exit(0);
    }
    console.log('[fetch-splash-video] 已存在但体积异常（' + size + 'B），重新下载');
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const t0 = Date.now();
  try {
    const resp = await fetch(URL, { redirect: 'follow' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length < MIN_BYTES) throw new Error('下载体积异常: ' + buf.length + 'B');
    fs.writeFileSync(OUT_FILE, buf);
    console.log('[fetch-splash-video] 完成（' + (buf.length / 1048576).toFixed(1) + ' MB，' + (Date.now() - t0) + 'ms）');
    process.exit(0);
  } catch (e) {
    console.warn('[fetch-splash-video] 下载失败: ' + (e && e.message));
    console.warn('[fetch-splash-video] 不影响运行——启动页会回退到 CDN 地址（main.js 内置回退）');
    process.exit(0);   // 不阻断构建
  }
}

main();
