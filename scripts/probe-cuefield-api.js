/**
 * 实测：server.js 的 /api/cuefield/* 路由是否真的能用。
 *
 * 修复前实测结果（4 个未声明标识符）：
 *   POST /api/cuefield/transition → 400 planCuefieldTransitionFromCache is not defined
 *   GET  /api/cuefield/feedback   → 500 readCuefieldFeedbackStats is not defined
 *   POST /api/cuefield/feedback   → 400 appendCuefieldFeedback is not defined
 *
 * 换到 3999 端口，避免撞用户正在用的 3000；反馈文件指向临时目录，避免污染仓库。
 * ⚠️ 本环境 `VAR=x node a.js` 的环境变量传不进子进程，所以在脚本内设置 process.env。
 */
const os = require('os');
const path = require('path');
const fs = require('fs');

const TMP = path.join(os.tmpdir(), 'bhands-cuefield-probe');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

process.env.PORT = '3999';
process.env.HOST = '127.0.0.1';
process.env.BHANDSMUSIC_CUEFIELD_FEEDBACK_FILE = path.join(TMP, 'cuefield-feedback.jsonl');

const http = require('http');
const server = require(path.join(__dirname, '..', 'server', 'server.js'));

function req(method, p, body) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: '127.0.0.1', port: 3999, path: p, method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} },
      (res) => {
        let buf = '';
        res.on('data', (c) => buf += c);
        res.on('end', () => resolve({ path: method + ' ' + p, status: res.statusCode, body: buf.slice(0, 200) }));
      });
    r.on('error', (e) => resolve({ path: method + ' ' + p, status: 0, body: 'ERR ' + e.message }));
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  await new Promise((r) => setTimeout(r, 1200));
  const out = [];
  out.push(await req('POST', '/api/cuefield/transition', { fromKey: 'k1', toKey: 'k2', fromLrc: '', toLrc: '' }));
  out.push(await req('GET', '/api/cuefield/feedback'));
  out.push(await req('POST', '/api/cuefield/feedback', { rating: 2, fromKey: 'k1', toKey: 'k2' }));
  out.push(await req('GET', '/api/cuefield/feedback'));

  console.log(JSON.stringify(out, null, 1));
  const stillRefError = out.some((o) => /is not defined/.test(o.body));
  console.log(stillRefError ? '\n❌ 仍有 is not defined' : '\n✅ 三个路由都不再报 is not defined');
  const fb = path.join(TMP, 'cuefield-feedback.jsonl');
  console.log('反馈文件已写入:', fs.existsSync(fb) ? fs.readFileSync(fb, 'utf8').trim().slice(0, 120) : '（未生成）');

  server.close();
  process.exit(0);
})();
