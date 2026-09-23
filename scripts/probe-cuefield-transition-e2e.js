/**
 * 端到端：用**真实节拍缓存**调 /api/cuefield/transition，确认能真的产出转场方案（200），
 * 而不是像修复前那样报 is not defined。
 * 缓存文件里带 "key" 字段，直接读出来用，不用从文件名反推。
 */
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP = path.join(os.tmpdir(), 'bhands-cuefield-probe2');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

process.env.PORT = '3999';
process.env.HOST = '127.0.0.1';
process.env.BHANDSMUSIC_CUEFIELD_FEEDBACK_FILE = path.join(TMP, 'fb.jsonl');

const CACHE = 'D:/BhandsMusicCache/beatmaps';
const entries = fs.readdirSync(CACHE).filter((f) => f.endsWith('.json')).map((f) => {
  try { const j = JSON.parse(fs.readFileSync(path.join(CACHE, f), 'utf8')); return j && j.key && j.map ? j : null; }
  catch (e) { return null; }
}).filter(Boolean);
// 挑两个分析完整（partial 为 false）的
const good = entries.filter((e) => e.map.partial !== true).slice(0, 2);
console.log('可用真实缓存条数:', entries.length, '｜选中:', good.map((g) => g.key).join(' → '));

const http = require('http');

/* server.js 启动时会 spawn 内置酷狗服务子进程；探针跑完 server.close() 并不会杀掉它，
 * 会在 3656 端口留下残留进程（下次跑就端口冲突）。这里拦一层 spawn 记账，收尾统一清理。 */
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
  if (spawned.length) console.log('已清理子进程:', spawned.join(', '));
}

const server = require(path.join(__dirname, '..', 'server', 'server.js'));

function post(p, body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const r = http.request({ host: '127.0.0.1', port: 3999, path: p, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => { let b = ''; res.on('data', (c) => b += c); res.on('end', () => resolve({ status: res.statusCode, body: b })); });
    r.on('error', (e) => resolve({ status: 0, body: 'ERR ' + e.message }));
    r.write(data); r.end();
  });
}

(async () => {
  await new Promise((r) => setTimeout(r, 1200));
  const res = await post('/api/cuefield/transition', {
    fromKey: good[0].key, toKey: good[1].key, fromLrc: '', toLrc: '',
    exitBias: 'late', maxEntryTime: 32, recentRecipes: [],
  });
  console.log('HTTP', res.status);
  let j = null;
  try { j = JSON.parse(res.body); } catch (e) {}
  if (j && j.ok !== false) {
    console.log('✅ 产出方案，顶层字段:', Object.keys(j).join(', '));
    if (j.window) console.log('   window:', JSON.stringify(j.window).slice(0, 160));
    if (j.mode) console.log('   mode:', j.mode);
  } else {
    console.log((j && /is not defined/.test(j.error || '') ? '❌ ' : '⚠️ ') + '返回:', res.body.slice(0, 220));
  }
  server.close();
  killSpawned();
  setTimeout(() => process.exit(0), 300);
})();
