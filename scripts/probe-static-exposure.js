/**
 * 实测静态根的暴露面：
 * ① `public/` 下**不该**存在服务端 Node 模块（server.js / dj-analyzer.js 已收进 `server/`）
 * ② 万一又有人往 `public/` 里放 Node 模块，HTTP 层是否拦得住（serveStatic 的白名单）
 * ③ 目录穿越（`..` 是否被 URL 解析器 / path.join 归一化掉）
 *
 * 换到 3999 端口，避免撞用户正在用的 3000。
 * ⚠️ 本探针会让 server.js spawn 内置酷狗服务子进程，收尾统一 taskkill（见下）。
 */
process.env.PORT = '3999';
process.env.HOST = '127.0.0.1';

const fs = require('fs');
const path = require('path');
const http = require('http');

const REPO = path.resolve(__dirname, '..');

/* server.js 启动时会 spawn 内置酷狗服务子进程；server.close() 不会杀它。
 * 必须在 require(server.js) **之前**拦 spawn 记账（否则 `const { spawn } = require('child_process')`
 * 已经解构到原始函数，拦不住）。 */
const cp = require('child_process');
const spawned = [];
const origSpawn = cp.spawn;
cp.spawn = function (...args) {
  const child = origSpawn.apply(this, args);
  if (child && child.pid) spawned.push(child.pid);
  return child;
};
function killSpawned() {
  for (const pid of spawned) {
    try { cp.execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); }
    catch (e) { /* 已退出 */ }
  }
}

const server = require(path.join(REPO, 'server', 'server.js'));

function req(p) {
  return new Promise((resolve) => {
    const r = http.request({ host: '127.0.0.1', port: 3999, path: p, method: 'GET' }, (res) => {
      let len = 0;
      res.on('data', (c) => len += c.length);
      res.on('end', () => resolve({ path: p, status: res.statusCode, bytes: len }));
    });
    r.on('error', (e) => resolve({ path: p, status: 0, bytes: 0, err: e.message }));
    r.end();
  });
}

const fails = [];
function assert(label, expected, actual) {
  const ok = expected === actual;
  if (!ok) fails.push(label);
  console.log((ok ? '  PASS  ' : '  FAIL  ') + label + '  期望 ' + expected + ' / 实际 ' + actual);
}

/** public/js/app 下的 17 个应用主体脚本（原 main.js：00-prelude + 01…16），按文件名排序 = 加载顺序 */
function appFiles() {
  return fs.readdirSync(path.join(REPO, 'public', 'js', 'app'))
    .filter((n) => n.endsWith('.js'))
    .sort();
}

(async () => {
  await new Promise((r) => setTimeout(r, 1200));

  console.log('\n[1] 文件系统：服务端 Node 模块不该留在 public/ 下');
  for (const rel of ['public/js/server.js', 'public/js/dj-analyzer.js']) {
    assert('不存在 ' + rel, false, fs.existsSync(path.join(REPO, rel)));
  }
  for (const rel of ['server/server.js', 'server/dj-analyzer.js']) {
    assert('存在 ' + rel, true, fs.existsSync(path.join(REPO, rel)));
  }
  // main.js 已按 48 分区拆成 public/js/app/01…16，并加 00-prelude.js（2026-09-24）
  assert('public/js/main.js 已拆分删除', false, fs.existsSync(path.join(REPO, 'public/js/main.js')));
  assert('public/js/app 下有 17 个脚本', 17, appFiles().length);

  console.log('\n[2] HTTP：这些路径必须拿不到内容');
  const blocked = [
    '/js/server.js',            // 服务端源码（曾实测 200 / 202681 字节）
    '/js/dj-analyzer.js',       // 同上（曾 200 / 51007 字节）
    '/../package.json',         // 裸 ..
    '/%2e%2e/package.json',     // 编码后的 ..
    '/..%2fpackage.json',       // 编码斜杠
    '/.music-sources.json',     // 根目录敏感文件
    '/js/../server.js',         // 混淆
  ];
  for (const t of blocked) {
    const r = await req(t);
    assert('GET ' + t + ' 不可读', 404, r.status);
  }

  console.log('\n[3] 兜底闸：**故意**把 Node 模块放回 public/js/，serveStatic 也必须拒绝');
  // 上一步的 404 可能只是「文件不在了」；这里种两个假文件，验证拦截逻辑本身有效。
  // 假文件内容不是真实源码（只是占位），跑完无论成败都删掉。
  const planted = ['public/js/server.js', 'public/js/dj-analyzer.js'].map((rel) => path.join(REPO, rel));
  try {
    for (const p of planted) fs.writeFileSync(p, 'module.exports = {}; // probe 占位，非真实源码\n');
    for (const rel of ['/js/server.js', '/js/dj-analyzer.js']) {
      const r = await req(rel);
      assert('种下假文件后 GET ' + rel + ' 仍被拦截', 404, r.status);
    }
  } finally {
    for (const p of planted) { try { fs.unlinkSync(p); } catch (e) {} }
    const leftover = planted.filter((p) => fs.existsSync(p));
    assert('探针清理：假文件已删除', 0, leftover.length);
  }

  console.log('\n[4] HTTP：正常前端资源仍要可访问（对照，防「一刀切」误伤）');
  // 17 个应用主体脚本逐个都要能拿到 —— 漏一个 index.html 就会 404，应用半死
  const frontend = ['/', '/styles/main.css', '/default-user-fx-archive.json']
    .concat(appFiles().map((n) => '/js/app/' + n));
  for (const t of frontend) {
    const r = await req(t);
    assert('GET ' + t + ' 可访问', 200, r.status);
  }

  server.close();
  killSpawned();
  console.log('\n' + (fails.length ? '❌ 失败 ' + fails.length + ' 项: ' + fails.join(' | ') : '✅ 全部通过'));
  setTimeout(() => process.exit(fails.length ? 1 : 0), 300);
})();
