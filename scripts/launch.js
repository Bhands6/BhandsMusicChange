'use strict';

/**
 * 桌面端启动器（npm start 的入口）
 *
 * 存在的唯一理由：Windows 控制台中文乱码。
 *
 * 简中 Windows 控制台默认代码页 936(GBK)，而 Node/Electron 往 stdout 写的是
 * UTF-8 字节，于是 `[MusicParser] 解析成功` 被按 GBK 解码成 `[MusicParser] 瑙ｆ瀽鎴愬姛`。
 *
 * ⚠️ 这个修复**不能放在 Electron 主进程里做**（踩过一次）：
 *   Electron 是 GUI 子系统程序，进程没有控制台。实测在里面跑
 *   `execFileSync('chcp.com', ['65001'])` 前后读到的码页都是 936 ——
 *   chcp 只作用在它自己临时拿到的那个控制台上，碰不到用户终端。
 *
 * 而 Node 是控制台子系统程序，被 npm/cmd 带起来时会继承真实控制台，
 * 在这里 chcp 才改得动。改完再 spawn Electron 并让它继承同一个控制台，
 * 之后主进程 / 内嵌 server.js / 各音源服务的日志就都是正常中文。
 */

const { spawn, execSync } = require('child_process');
const path = require('path');

if (process.platform === 'win32') {
  try {
    // 无控制台场景（被 IDE / 计划任务拉起）会失败，静默忽略即可
    execSync('chcp 65001', { stdio: ['ignore', 'ignore', 'ignore'], timeout: 3000 });
  } catch (_) {
    /* 忽略：拿不到控制台就没得修，不影响启动 */
  }
}

// 从 npm 包解析 electron 可执行文件路径（等价于 node_modules/.bin/electron 干的事）
const electronPath = require('electron');
const projectRoot = path.join(__dirname, '..');

// 某些环境（含本项目的部分工具链）会预设 ELECTRON_RUN_AS_NODE=1，
// 它会让 electron.exe 退化成普通 node，整个应用起不来 —— 显式清掉。
const env = Object.assign({}, process.env);
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, [projectRoot].concat(process.argv.slice(2)), {
  stdio: 'inherit',
  env: env
});

child.on('close', (code) => {
  process.exit(code == null ? 0 : code);
});

child.on('error', (err) => {
  console.error('启动 Electron 失败:', err && err.message);
  process.exit(1);
});
