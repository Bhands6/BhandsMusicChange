/**
 * 全链路探针：升级下载的 暂停 / 取消 / 断点续传。
 * 不依赖 GitHub：用本地清单（BHANDSMUSIC_UPDATE_MANIFEST）+ 本地限速假源（支持 Range）。
 * 用法：node scripts/probe-update-pause.js
 * 产物：scripts/out/update-pause-probe.json
 */
const { spawn, execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
// 随机端口：避免之前失败运行留下的孤儿服务占用固定端口，导致新一轮探针跟旧实例对话
const APP_PORT = 39000 + Math.floor(Math.random() * 1800);
const SRC_PORT = APP_PORT + 1;
const OUT = path.join(__dirname, 'out', 'update-pause-probe.json');
const FAKE_SIZE = 6 * 1024 * 1024;               // 6MB，限速 ~400KB/s，约 15s 下载完
const THROTTLE_MS = 40;
const CHUNK = 16 * 1024;
const TMP_DIR = path.join(os.tmpdir(), 'bhands-update-pause-probe');
const UPDATES_DIR = path.join(TMP_DIR, 'updates');
const FAKE_FILE = path.join(TMP_DIR, 'fake-installer.bin');
const MANIFEST = path.join(TMP_DIR, 'manifest.json');
const LOG = [];
function log(s) { LOG.push(s); try { fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(LOG, null, 2)); } catch (e) {} }
function assert(cond, label) { log((cond ? 'PASS ' : 'FAIL ') + label); if (!cond) process.exitCode = 1; }

const FAKE = crypto.randomBytes(FAKE_SIZE);
const FAKE_SHA = crypto.createHash('sha256').update(FAKE).digest('hex');

/** 限速假源：支持 Range（206），模拟慢速线路 */
const src = http.createServer((req, res) => {
  const m = /bytes=(\d+)-/.exec(req.headers.range || '');
  const start = m ? parseInt(m[1], 10) : 0;
  if (start >= FAKE_SIZE || start < 0) { res.writeHead(416); res.end(); return; }
  res.writeHead(m ? 206 : 200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(FAKE_SIZE - start),
    'Accept-Ranges': 'bytes',
  });
  let pos = start;
  const timer = setInterval(() => {
    if (res.destroyed || pos > FAKE_SIZE - 1) { clearInterval(timer); try { res.end(); } catch (e) {} return; }
    const n = Math.min(CHUNK, FAKE_SIZE - pos);
    res.write(FAKE.subarray(pos, pos + n));
    pos += n;
  }, THROTTLE_MS);
  req.on('close', () => clearInterval(timer));
});

function get(url) {
  return new Promise((resolve) => {
    const req = http.request(url, { method: 'GET' }, (r) => {
      let body = '';
      r.on('data', (c) => { body += c; });
      r.on('end', () => {
        // status 轮询太吵，只记录异常；其余请求记录原始响应
        const noisy = url.indexOf('/status?') >= 0;
        if (process.env.PROBE_VERBOSE && (!noisy || r.statusCode >= 400)) log('  GET ' + url.slice(-60) + ' -> ' + r.statusCode + ' ' + body.slice(0, 160));
        try { resolve(JSON.parse(body)); } catch (e) { resolve({ ok: false, parseError: String(e), raw: body.slice(0, 200), httpStatus: r.statusCode }); }
      });
    });
    req.on('error', (e) => resolve({ ok: false, error: String(e) }));
    req.end();
  });
}
function post(url) {
  return new Promise((resolve) => {
    const req = http.request(url, { method: 'POST' }, (r) => {
      let body = '';
      r.on('data', (c) => { body += c; });
      r.on('end', () => {
        if (process.env.PROBE_VERBOSE) log('  POST ' + url.slice(-60) + ' -> ' + r.statusCode + ' ' + body.slice(0, 200));
        try { resolve(JSON.parse(body)); } catch (e) { resolve({ ok: false, parseError: String(e), raw: body.slice(0, 200), httpStatus: r.statusCode }); }
      });
    });
    req.on('error', (e) => resolve({ ok: false, error: String(e) }));
    req.end();
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 轮询直到 pred 成立或超时；返回最后一个 job */
async function pollUntil(id, pred, timeoutMs, label) {
  const t0 = Date.now();
  let job = null;
  let lastRaw = '';
  let lastUrl = '';
  while (Date.now() - t0 < timeoutMs) {
    const u = 'http://127.0.0.1:' + APP_PORT + '/api/update/download/status?id=' + id;
    lastUrl = u;
    const resp = await new Promise((resolve) => {
      const req = http.request(u, { method: 'GET' }, (r) => {
        let body = '';
        r.on('data', (c) => { body += c; });
        r.on('end', () => resolve({ code: r.statusCode, body: body }));
      });
      req.on('error', (e) => resolve({ code: 0, body: String(e) }));
      req.end();
    });
    lastRaw = resp.code + ' ' + resp.body.slice(0, 200);
    try { job = JSON.parse(resp.body); } catch (e) { job = { parseError: String(e) }; }
    if (job && pred(job)) { log('  [' + label + '] ' + job.status + ' ' + (job.progress || 0) + '%'); return job; }
    await sleep(150);
  }
  log('  [' + label + '] 超时，最后原始响应: ' + lastRaw);
  return job;
}

(async () => {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
  fs.mkdirSync(UPDATES_DIR, { recursive: true });
  fs.writeFileSync(FAKE_FILE, FAKE);
  fs.writeFileSync(MANIFEST, JSON.stringify({
    latestVersion: '9.9.9',
    release: {
      version: '9.9.9',
      notes: ['暂停 / 续传 / 取消 探针条目'],
      downloadUrl: 'http://127.0.0.1:' + SRC_PORT + '/fake-installer.bin',
      asset: { name: 'BhandsMusic-9.9.9-Setup.exe', size: FAKE_SIZE, sha256: FAKE_SHA },
    },
  }, null, 2));

  await new Promise((r) => src.listen(SRC_PORT, '127.0.0.1', r));
  log('限速假源就绪: http://127.0.0.1:' + SRC_PORT);

  const server = spawn(process.execPath, ['server/server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(APP_PORT),
      HOST: '127.0.0.1',
      BHANDSMUSIC_UPDATE_MANIFEST: MANIFEST,
      BHANDSMUSIC_UPDATE_DIR: UPDATES_DIR,
      // 把 CNB 镜像基址指向本地限速假源：既能验证「CNB 排第一」，又不需要真连外网。
      // 假源不校验路径，任何 /cnb/... 都返回同一份字节。
      BHANDSMUSIC_UPDATE_CNB_BASE: 'http://127.0.0.1:' + SRC_PORT + '/cnb',
    }),
    stdio: ['ignore', fs.openSync(path.join(TMP_DIR, 'server.log'), 'w'), fs.openSync(path.join(TMP_DIR, 'server.err.log'), 'w')],
  });
  // 等 app 服务就绪
  let up = false;
  for (let i = 0; i < 80 && !up; i++) {
    const r = await get('http://127.0.0.1:' + APP_PORT + '/api/kugou/login/status');
    up = !!(r && r.loggedIn !== undefined);   // 接口返回 {loggedIn:...}，没有 status 字段
    if (!up) await sleep(300);
  }
  assert(up, '应用服务就绪');
  if (!up) {
    try {
      log('server.log 尾部: ' + fs.readFileSync(path.join(TMP_DIR, 'server.log'), 'utf8').slice(-800));
      log('server.err.log 尾部: ' + fs.readFileSync(path.join(TMP_DIR, 'server.err.log'), 'utf8').slice(-800));
    } catch (e) {}
    src.close();
    return;
  }

  // 实际下载目录是 UPDATE_DIR/downloads（UPDATE_DOWNLOAD_DIR = path.join(UPDATE_WORK_DIR, 'downloads')）
  const tmpPath = path.join(UPDATES_DIR, 'downloads', 'BhandsMusic-9.9.9-Setup.exe.download');
  const finalPath = path.join(UPDATES_DIR, 'downloads', 'BhandsMusic-9.9.9-Setup.exe');
  const tmpSize = () => (fs.existsSync(tmpPath) ? fs.statSync(tmpPath).size : -1);

  /* ---------- 第一轮：暂停 → 取消（应删除临时文件） ---------- */
  let r = await post('http://127.0.0.1:' + APP_PORT + '/api/update/download');
  assert(r.ok && !!r.id, '启动下载任务');
  var jobId = r.id;
  let   job = await pollUntil(jobId, (j) => (j.progress || 0) >= 30, 40000, '下载到 30%');
  assert(job && (job.progress || 0) >= 30, '进度到达 30%');
  assert(job && String(job.sourceLabel || '').indexOf('CNB') >= 0, '首选线路 = ' + (job && job.sourceLabel));

  r = await post('http://127.0.0.1:' + APP_PORT + '/api/update/download/pause?id=' + jobId);
  assert(r.ok, 'pause 接口受理');
  job = await pollUntil(jobId, (j) => j.status === 'paused', 8000, '暂停');
  assert(job && job.status === 'paused', '状态 = paused');
  assert(tmpSize() === job.received && job.received > 0, '临时文件保留且大小 = 已接收（' + job.received + 'B）');

  r = await post('http://127.0.0.1:' + APP_PORT + '/api/update/download/cancel?id=' + jobId);
  assert(r.ok, 'cancel 接口受理');
  job = await pollUntil(jobId, (j) => j.status === 'canceled', 8000, '取消');
  assert(job && job.status === 'canceled', '状态 = canceled');
  assert(!fs.existsSync(tmpPath), '取消后临时文件已删除');
  assert(!fs.existsSync(finalPath), '取消后不产生最终文件');

  /* ---------- 第二轮：暂停 → 续传（重新测速选线 + Range 断点续传） ---------- */
  r = await post('http://127.0.0.1:' + APP_PORT + '/api/update/download');
  assert(r.ok && !!r.id, '重新启动下载（会重新测速选线）');
  jobId = r.id;
  job = await pollUntil(jobId, (j) => (j.progress || 0) >= 35, 40000, '再次下载到 35%');
  assert(job && (job.progress || 0) >= 35, '第二轮进度到达 35%');

  r = await post('http://127.0.0.1:' + APP_PORT + '/api/update/download/pause?id=' + jobId);
  job = await pollUntil(jobId, (j) => j.status === 'paused', 8000, '再次暂停');
  assert(job && job.status === 'paused' && job.received > 0, '第二轮暂停成功');
  const pausedBytes = job.received;

  r = await post('http://127.0.0.1:' + APP_PORT + '/api/update/download/resume?id=' + jobId);
  assert(r.ok, 'resume 接口受理');
  job = await pollUntil(jobId, (j) => j.status === 'ready' || j.status === 'error', 60000, '续传到完成');
  assert(job && job.status === 'ready', '续传后下载完成');
  assert(job.received === FAKE_SIZE, '最终大小正确（' + job.received + '/' + FAKE_SIZE + '）');
  assert(pausedBytes > 0 && pausedBytes < FAKE_SIZE, '确实是从断点续传（断点 ' + pausedBytes + 'B）');
  assert(fs.existsSync(finalPath), '最终安装包存在');
  const diskSha = crypto.createHash('sha256').update(fs.readFileSync(finalPath)).digest('hex');
  assert(diskSha === FAKE_SHA, '安装包 sha256 校验通过');

  log('DONE');
  src.close();
  server.kill();
  appQuit();
})().catch((e) => {
  log('ERROR ' + (e && e.stack || e));
  log('（失败保留临时目录与日志：' + TMP_DIR + '）');
  src.close();
  process.exit(1);
});

function appQuit() { /* 纯 node 脚本无需 quit */ }
