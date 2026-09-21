'use strict';

/**
 * 准备内置酷狗 API 服务（vendor/kugou-api/，MakcRe/KuGouMusicApi）。
 *
 * 与 fetch-go-music-api（下载预编译二进制）不同：KuGouMusicApi 是 Node 源码项目，
 * 需要完整的 module/ + util/ + node_modules 才能运行。脚本做三件事：
 *   1. 浅克隆上游仓库（已存在则 git pull 更新）；
 *   2. npm install --omit=dev 安装运行时依赖；
 *   3. 可选：--with-node 下载便携版 node.exe 到 vendor/kugou-api/node.exe，
 *      供「打包分发到没有 Node.js 的机器」的场景使用（约 80MB）。
 *
 * 用法：
 *   node build/fetch-kugou-api.js                # 已就绪则跳过
 *   node build/fetch-kugou-api.js --force        # 强制更新上游 + 重装依赖
 *   node build/fetch-kugou-api.js --with-node    # 同时拉取便携 node.exe
 *
 * 由 package.json 的 prebuild:win / prebuild:win:dir 自动调用（不带 --with-node，
 * 分发场景若目标机器没有 Node.js，请手动补 --with-node）。
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = 'https://github.com/MakcRe/KuGouMusicApi.git';
const OUT_DIR = path.join(__dirname, '..', 'vendor', 'kugou-api');
const NODE_VERSION = 'v20.18.1';
const NODE_MIRRORS = [
  'https://npmmirror.com/mirrors/node/' + NODE_VERSION + '/win-x64/node.exe',
  'https://nodejs.org/dist/' + NODE_VERSION + '/win-x64/node.exe'
];

const force = process.argv.includes('--force');
const withNode = process.argv.includes('--with-node');

function run(cmd, args, opts) {
  const r = spawnSync(cmd, args, Object.assign({ stdio: 'inherit', shell: process.platform === 'win32' }, opts));
  return r.status === 0;
}

function npmCmd() {
  // Windows 下 npm 是 npm.cmd，spawn 需要 shell 或显式 cmd 调用
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

async function downloadNodeExe() {
  const outExe = path.join(OUT_DIR, 'node.exe');
  if (fs.existsSync(outExe) && fs.statSync(outExe).size > 50 * 1024 * 1024) {
    console.log('[fetch-kugou-api] node.exe 已存在，跳过');
    return true;
  }
  for (const url of NODE_MIRRORS) {
    try {
      console.log('[fetch-kugou-api] 下载便携 node.exe: ' + url);
      const resp = await fetch(url, { redirect: 'follow' });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const buf = Buffer.from(await resp.arrayBuffer());
      fs.writeFileSync(outExe, buf);
      console.log('[fetch-kugou-api] node.exe 就绪（' + (buf.length / 1048576).toFixed(1) + ' MB）');
      return true;
    } catch (e) {
      console.warn('[fetch-kugou-api] 下载失败（' + e.message + '），尝试下一镜像');
    }
  }
  return false;
}

async function main() {
  const appEntry = path.join(OUT_DIR, 'app.js');
  const depsDir = path.join(OUT_DIR, 'node_modules');

  // 1. 源码
  if (!fs.existsSync(appEntry) || force) {
    if (fs.existsSync(OUT_DIR)) {
      console.log('[fetch-kugou-api] 清理旧目录…');
      fs.rmSync(OUT_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(path.dirname(OUT_DIR), { recursive: true });
    console.log('[fetch-kugou-api] 浅克隆上游仓库…');
    if (!run('git', ['clone', '--depth', '1', REPO, OUT_DIR])) {
      console.error('[fetch-kugou-api] git clone 失败');
      process.exit(1);
    }
  } else {
    console.log('[fetch-kugou-api] 源码已存在（--force 可强制更新）');
  }

  // 2. 依赖
  if (!fs.existsSync(depsDir) || force) {
    console.log('[fetch-kugou-api] 安装运行时依赖（可能需要几分钟）…');
    if (!run(npmCmd(), ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: OUT_DIR })) {
      console.error('[fetch-kugou-api] npm install 失败');
      process.exit(1);
    }
  } else {
    console.log('[fetch-kugou-api] 依赖已安装，跳过');
  }

  // 3. 可选的便携 node.exe（分发给没有 Node.js 的机器）
  if (withNode) {
    const ok = await downloadNodeExe();
    if (!ok) {
      console.warn('[fetch-kugou-api] node.exe 下载失败——分发到无 Node 机器时酷狗会员功能不可用');
      process.exit(1);
    }
  }

  // 就绪校验
  const ready = fs.existsSync(appEntry) && fs.existsSync(depsDir);
  console.log('[fetch-kugou-api] ' + (ready ? '就绪: ' + OUT_DIR : '未就绪'));
  process.exit(ready ? 0 : 1);
}

main().catch((e) => {
  console.error('[fetch-kugou-api] ' + e.message);
  process.exit(1);
});
