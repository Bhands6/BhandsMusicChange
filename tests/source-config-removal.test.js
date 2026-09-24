'use strict';
/**
 * 验证 `customApiUrl` / `customApiMethod` / `goMusicApiUrl` 三个配置项已被彻底移除。
 *
 * 两层验证：
 *   A. 源码层：断言这些键只出现在注释里，任何**代码**引用都不允许存在；
 *      并断言 custom 策略与 customApi.js 已下线。
 *   B. 行为层：抽真实源码跑 readMusicSourcesConfig / saveMusicSourcesConfig，
 *      确认默认配置里没有这三个键、落盘也不会再写出它们。
 *
 * 为什么留这条：这三个键是「自定义 API 地址」的遗留面。它们一旦被某个合并分支
 * 重新写回配置文件，用户升级后会看到一个自己从没设过的地址 —— 静默污染。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { REPO_ROOT, readSource, readAppSource, stripComments, extractConst, extractFunction } = require('./lib/source');

const SERVER_JS = 'server/server.js';
// 原 public/js/main.js 于 2026-09-24 按 48 分区拆成 16 个文件；整文件级断言走拼接后的全文
const APP_JS_LABEL = 'app/*.js（原 main.js）';
const PARSER_JS = 'server/music-sources/musicParser.js';

const serverSrc = readSource(SERVER_JS);
const appSrc = readAppSource();
const parserSrc = readSource(PARSER_JS);

const LEGACY = ['customApiUrl', 'customApiMethod', 'goMusicApiUrl'];

// ============================================================
// [A] 源码层
// ============================================================

for (const rel of [SERVER_JS, PARSER_JS]) {
  const name = path.basename(rel);
  const code = stripComments(readSource(rel));
  for (const key of LEGACY) {
    test(`[A] ${name} 代码中无 ${key}`, () => {
      const hits = code.split(key).length - 1;
      assert.equal(hits, 0, `命中 ${hits} 次（注释里出现是允许的，代码里不允许）`);
    });
  }
}

// 原 main.js 的同一批断言：对 16 个文件的拼接全文做，语义与拆分前完全一致
{
  const code = stripComments(appSrc);
  for (const key of LEGACY) {
    test(`[A] ${APP_JS_LABEL} 代码中无 ${key}`, () => {
      const hits = code.split(key).length - 1;
      assert.equal(hits, 0, `命中 ${hits} 次（注释里出现是允许的，代码里不允许）`);
    });
  }
}

test('[A] musicParser 不再 require ./customApi', () => {
  assert.doesNotMatch(parserSrc, /require\(['"]\.\/customApi['"]\)/);
});

test('[A] musicParser 不再有 customApiStrategy 定义', () => {
  assert.doesNotMatch(parserSrc, /const customApiStrategy = \{/);
});

test('[A] ALL_STRATEGIES 不含 customApiStrategy', () => {
  assert.doesNotMatch(parserSrc, /ALL_STRATEGIES = \[[\s\S]*?customApiStrategy[\s\S]*?\]/);
});

test('[A] customApi.js 已删除', () => {
  assert.equal(fs.existsSync(path.join(REPO_ROOT, 'server/music-sources/customApi.js')), false);
});

test('[A] musicParser 不再读 params.goMusicApiUrl', () => {
  assert.doesNotMatch(parserSrc, /params\.goMusicApiUrl/);
});

test('[A] musicParser 不再传 baseUrl', () => {
  assert.doesNotMatch(parserSrc, /baseUrl:\s*params\./);
});

for (const fn of ['saveCustomApiUrl', 'saveGoMusicApiUrl', 'setGoMusicStatus', 'testGoMusicService']) {
  test(`[A] ${APP_JS_LABEL} 已删除 function ${fn}`, () => {
    assert.doesNotMatch(appSrc, new RegExp('function\\s+' + fn + '\\s*\\('));
  });
}

// 本机配置文件：被 .gitignore 忽略，fresh clone 里没有 → 跳过而不是失败
const cfgPath = path.join(REPO_ROOT, '.music-sources.json');
if (fs.existsSync(cfgPath)) {
  const cfgRaw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  for (const key of LEGACY) {
    test(`[A] .music-sources.json 无 ${key}`, () => {
      assert.equal(key in cfgRaw, false, '实际键: ' + JSON.stringify(Object.keys(cfgRaw)));
    });
  }
} else {
  test('[A] .music-sources.json 无遗留键', { skip: '.music-sources.json 不存在（被 .gitignore 忽略，属正常）' }, () => {});
}

// ============================================================
// [B] 行为层：抽真实源码跑配置读写
// ============================================================

/** 在临时目录里跑一份真实 readMusicSourcesConfig / saveMusicSourcesConfig */
function makeConfigSandbox() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-cfg-'));
  const tmpCfg = path.join(tmpDir, '.music-sources.json');
  const body = [
    'const MUSIC_SOURCES_CONFIG_FILE = ' + JSON.stringify(tmpCfg) + ';',
    extractConst(serverSrc, 'DEFAULT_MUSIC_SOURCES_CONFIG'),
    extractFunction(serverSrc, 'readMusicSourcesConfig'),
    extractFunction(serverSrc, 'saveMusicSourcesConfig'),
    'return { DEFAULT: DEFAULT_MUSIC_SOURCES_CONFIG, read: readMusicSourcesConfig, save: saveMusicSourcesConfig };',
  ].join('\n');
  const api = new Function('fs', body)(fs);
  return { api, tmpCfg, cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }) };
}

test('[B] DEFAULT_MUSIC_SOURCES_CONFIG 无三个遗留键', () => {
  const S = makeConfigSandbox();
  try {
    for (const key of LEGACY) {
      assert.equal(key in S.api.DEFAULT, false, '实际键: ' + JSON.stringify(Object.keys(S.api.DEFAULT)));
    }
  } finally { S.cleanup(); }
});

test('[B] DEFAULT 仍保留 unblockPlatforms（没顺手删多）', () => {
  const S = makeConfigSandbox();
  try {
    assert.ok(Array.isArray(S.api.DEFAULT.unblockPlatforms), JSON.stringify(S.api.DEFAULT.unblockPlatforms));
  } finally { S.cleanup(); }
});

test('[B] 无配置文件时 read() 无三个遗留键', () => {
  const S = makeConfigSandbox();
  try {
    const fresh = S.api.read();
    for (const key of LEGACY) assert.equal(key in fresh, false, '实际键: ' + JSON.stringify(Object.keys(fresh)));
  } finally { S.cleanup(); }
});

test('[B] 落盘后文件与回读都没有三个遗留键', () => {
  const S = makeConfigSandbox();
  try {
    S.api.save({ enabledSources: ['gdmusic'], quality: 'higher' });
    const written = JSON.parse(fs.readFileSync(S.tmpCfg, 'utf8'));
    const reread = S.api.read();
    for (const key of LEGACY) {
      assert.equal(key in written, false, '落盘文件实际键: ' + JSON.stringify(Object.keys(written)));
      assert.equal(key in reread, false, '回读实际键: ' + JSON.stringify(Object.keys(reread)));
    }
  } finally { S.cleanup(); }
});

test('[B] POST /api/parse/config 的合并分支不再赋值三个遗留键，且保留现役字段', () => {
  const idx = serverSrc.indexOf("pn === '/api/parse/config' && req.method === 'POST'");
  assert.ok(idx > 0, '没找到 POST 合并分支 —— 锚点字符串变了，先修锚点再改断言');
  const tail = serverSrc.slice(idx);
  const block = tail.slice(0, tail.indexOf('sendJSON(res, { success: true'));
  assert.ok(block.length > 0, '合并块切空了');
  assert.doesNotMatch(block, /newConfig\.customApiUrl/);
  assert.doesNotMatch(block, /newConfig\.goMusicApiUrl/);
  assert.match(block, /newConfig\.enabledSources/);
  assert.match(block, /newConfig\.quality/);
  assert.match(block, /newConfig\.unblockPlatforms/);
});

test('[B] parseMusic 调用点不再传遗留入参，且仍传现役入参', () => {
  const idx = serverSrc.indexOf('const result = await parseMusic({');
  assert.ok(idx > 0, '没找到 parseMusic 调用点');
  const callBlock = stripComments(serverSrc.slice(idx, serverSrc.indexOf('});', idx)));
  assert.doesNotMatch(callBlock, /customApiUrl/);
  assert.doesNotMatch(callBlock, /goMusicApiUrl/);
  assert.match(callBlock, /enabledSources:/);
  assert.match(callBlock, /unblockPlatforms:/);
});
