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

/** public/js/app 下的 19 个应用主体脚本（原 main.js：00-prelude + 01…18），按文件名排序 = 加载顺序 */
function appFiles() {
  return fs.readdirSync(path.join(REPO, 'public', 'js', 'app'))
    .filter((n) => n.endsWith('.js'))
    .sort();
}

/* ------------------------------------------------------------------
 * [3] 段会**故意**往 public/js/ 里种两个假文件。若本进程在 [3] 与它的 finally
 * 之间被打断（超时 kill / stdout 被 `| head` 提前关闭 → EPIPE / Ctrl-C），
 * 假文件就会留在磁盘上，导致**下一次**运行的 [1] 段报
 * 「不存在 public/js/server.js 期望 false / 实际 true」——
 * 那是一条**假红**（报的是上一次的残骸，不是真的有人把 Node 模块放回了 public/）。
 *
 * 修法两层：
 *   ① 开跑前先自愈：只删**内容等于本探针占位串**的文件，绝不碰真文件
 *      （否则会把 [1] 段要抓的真问题一起删掉，变成假绿）；
 *   ② 注册 exit 兜底，正常/异常退出都尽量清理。
 * ------------------------------------------------------------------ */
const PLANT_MARK = 'module.exports = {}; // probe 占位，非真实源码\n';
const PLANTED = ['public/js/server.js', 'public/js/dj-analyzer.js'].map((rel) => path.join(REPO, rel));

/** 只删「内容 == PLANT_MARK」的残骸；返回被删掉的路径 */
function cleanupPlanted() {
  const removed = [];
  for (const p of PLANTED) {
    try {
      if (fs.existsSync(p) && fs.readFileSync(p, 'utf8') === PLANT_MARK) { fs.unlinkSync(p); removed.push(p); }
    } catch (e) { /* 读不到/删不掉就留着，交给 [1] 段如实报错 */ }
  }
  return removed;
}

/** [1] 段失败时，判断是不是上一次运行的残骸，并给出可执行的排查提示 */
function describeStray(p) {
  try {
    const st = fs.statSync(p);
    const head = fs.readFileSync(p, 'utf8').slice(0, 120).replace(/\n/g, '\\n');
    const isStray = fs.readFileSync(p, 'utf8') === PLANT_MARK;
    return '  ↳ ' + p + '  ' + st.size + ' 字节  ' + (isStray
      ? '【上一次探针运行的占位残骸，非真实源码；删掉后重跑即可】'
      : '【**不是**本探针的占位串 → 真的有人把 Node 模块放回了 public/】') + ' 首行: ' + head;
  } catch (e) { return '  ↳ ' + p + ' 读取失败: ' + e.message; }
}

process.on('exit', () => { cleanupPlanted(); });

(async () => {
  await new Promise((r) => setTimeout(r, 1200));

  console.log('\n[1] 文件系统：服务端 Node 模块不该留在 public/ 下');
  // 先看有没有残骸（有就说明上一次运行被打断了），再自愈，最后按**自愈后**的状态断言。
  // 顺序很重要：先描述后清理，才能把「假红」的原因打出来。
  for (const rel of ['public/js/server.js', 'public/js/dj-analyzer.js']) {
    const abs = path.join(REPO, rel);
    if (fs.existsSync(abs)) console.log(describeStray(abs));
  }
  const healed = cleanupPlanted();
  if (healed.length) {
    console.log('  NOTE  已清理上一次运行残留的占位文件 ' + healed.length + ' 个（只删内容 == 本探针占位串的文件），'
      + '以下断言按清理后的状态判定');
  }
  for (const rel of ['public/js/server.js', 'public/js/dj-analyzer.js']) {
    assert('不存在 ' + rel, false, fs.existsSync(path.join(REPO, rel)));
  }
  for (const rel of ['server/server.js', 'server/dj-analyzer.js']) {
    assert('存在 ' + rel, true, fs.existsSync(path.join(REPO, rel)));
  }
  // main.js 已拆成 public/js/app/01…18 + 00-prelude.js，并按职责重排（2026-09-24）
  assert('public/js/main.js 已拆分删除', false, fs.existsSync(path.join(REPO, 'public/js/main.js')));
  assert('public/js/app 下有 19 个脚本', 19, appFiles().length);

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
  // ⚠️ 种植前必须先确认目标路径是空的、或只是本探针自己的占位串 ——
  //    否则 writeFileSync 会覆盖掉真文件、finally 又把它删掉，
  //    等于「跑一次探针把人家的 server.js 删了」。遇到非占位文件一律跳过。
  // 被跳过的路径依然做 HTTP 断言：那时拦的正是**真文件**，反而是更硬的验证。
  const toPlant = [];
  for (const p of PLANTED) {
    if (fs.existsSync(p) && fs.readFileSync(p, 'utf8') !== PLANT_MARK) {
      console.log('  SKIP  不覆盖已存在的非占位文件 ' + path.relative(REPO, p) + '（[1] 段已就此报红；下面仍验证 HTTP 层拦截）');
      continue;
    }
    toPlant.push(p);
  }
  try {
    for (const p of toPlant) fs.writeFileSync(p, PLANT_MARK);
    for (const rel of ['/js/server.js', '/js/dj-analyzer.js']) {
      const r = await req(rel);
      assert('种下假文件后 GET ' + rel + ' 仍被拦截', 404, r.status);
    }
  } finally {
    cleanupPlanted();
    const leftover = toPlant.filter((p) => fs.existsSync(p));
    assert('探针清理：假文件已删除', 0, leftover.length);
  }

  console.log('\n[4] HTTP：正常前端资源仍要可访问（对照，防「一刀切」误伤）');
  // 19 个应用主体脚本逐个都要能拿到 —— 漏一个 index.html 就会 404，应用半死
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
