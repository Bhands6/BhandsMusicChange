/**
 * 「加载期读写顺序等价」校验器 —— 按职责重排（2026-09-24 第二步）的安全闸门。
 *
 * ── 它守的是什么不变量 ────────────────────────────────────────────────
 * 顶层 `function` 声明靠**提升**，位置无关，跨文件搬是零语义改动（由
 * `scripts/check-app-hoisting.js` 负责，它管的是「拆成多个 <script> 后提升范围变小」）。
 *
 * 但顶层 `var/let/const` 与顶层**语句**不能随便搬：
 *   - `var` 只提升「绑定」不提升「初始化」→ 读取点看到的是 `undefined` 还是真值，取决于初始化有没有跑过；
 *   - `let/const/class` 有 TDZ → 初始化前读取直接 ReferenceError。
 * 所以重排后必须证明：**每一个加载期读取点，看到的初始化状态与重排前完全一致**。
 *
 * 本脚本就是那个判定。它把「执行序」形式化为一串**有加载期副作用**的条目
 * （顶层语句 + 带初始化的 var/let/const；function 声明无副作用，不参与），
 * 然后对每个名字 X 记录 `读取点 → 那一刻 X 是否已初始化` 的映射，与基线逐项比对。
 *
 * ⚠️ 加载期读取 = 条目自身的引用 **∪** 它同步调用到的顶层函数体内的引用（继续下钻）。
 *    嵌套回调体不算（之后才跑）。这套口径与 `scripts/check-app-hoisting.js` 一致。
 *
 * ── 用法 ──────────────────────────────────────────────────────────────
 *   node scripts/check-app-reorg.js --write-baseline   # 重排**前**跑一次，落基线
 *   node scripts/check-app-reorg.js                    # 重排后跑，验证等价
 *   node scripts/check-app-reorg.js --detail           # 打印每个名字的观测序列
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const REPO = path.resolve(__dirname, '..');
const APP_DIR = path.join(REPO, 'public', 'js', 'app');
const BASELINE = path.join(__dirname, 'reorg', 'load-order-baseline.json');

let esprima;
try {
  esprima = require('esprima');
} catch (e) {
  throw new Error('需要 esprima：npm install --save-dev esprima');
}
const { makeParser, refsOf, calledRefsOf, hasSideEffect, declaredNames } =
  require('./lib/ast-scan');
const parse = makeParser(esprima);

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

/** 收集当前布局（以 index.html 顺序为准）的「加载期观测」 */
function collect() {
  const html = fs.readFileSync(path.join(REPO, 'public', 'index.html'), 'utf8');
  const files = [...html.matchAll(/<script\s+src="js\/app\/([^"]+)"><\/script>/g)].map((m) => m[1]);

  const fnNode = {};
  const parsed = [];
  for (const f of files) {
    const raw = fs.readFileSync(path.join(APP_DIR, f), 'utf8');
    const ast = parse(raw, { range: true, loc: true });
    parsed.push({ file: f, raw, ast });
    for (const st of ast.body) {
      if (st.type === 'FunctionDeclaration' && st.id) fnNode[st.id.name] = st;
    }
  }

  /** 下钻：一组被调用的顶层函数 → 它们体内的加载期引用 */
  const drill = (names, visited) => {
    const out = new Set();
    for (const n of names) {
      if (visited.has(n)) continue;
      visited.add(n);
      const node = fnNode[n];
      if (!node) continue;
      for (const r of refsOf(node)) out.add(r);
      for (const r of drill(calledRefsOf(node), visited)) out.add(r);
    }
    return out;
  };
  const loadReadsOf = (node) => {
    const out = new Set(refsOf(node));
    for (const r of drill(calledRefsOf(node), new Set())) out.add(r);
    return Array.from(out).sort();
  };

  const items = [];      // 有加载期副作用的条目，按执行序
  const fnDecls = [];    // function 声明（无副作用，仅记录，用于 hash 守恒）
  let strictCount = 0;
  for (const { file, raw, ast } of parsed) {
    for (const st of ast.body) {
      if (st.type === 'ExpressionStatement' && st.expression.type === 'Literal' &&
          st.expression.value === 'use strict') { strictCount++; continue; }

      // ⚠️ hash 只取**条目自身的源码**（range 之内），不含前导注释/空行/文件头 ——
      //    否则 prelude 的 `// ↓ 原属` 标签一改、每个文件的第一块一带上 header，
      //    hash 就全变了，会把「没变」误报成「条目消失」。
      const code = raw.slice(st.range[0], st.range[1]);
      if (st.type === 'FunctionDeclaration') {
        /* ⚠️ function 声明的身份 hash **只取函数名**，不取函数体源码。
         * 原因：function 声明是 hoist 的、位置无关（重排允许随意搬），它的用途是
         * 「hash 守恒」= 确保重排中函数没丢/没多。若把函数体源码算进 hash，
         * 那么「正常改函数体内一行」会被误报成「旧条目消失 + 新条目出现」——
         * 2026-09-24 改歌词朝向（04-lyrics.js 的 updateStageLyrics3D）时正是这么误红的。
         * 函数体有没有被改坏，由 tests/ 里的行为断言负责，不归这道「重排等价」闸门管。 */
        fnDecls.push({ file, hash: sha('fn:' + ((st.id && st.id.name) || 'anonymous')), name: st.id && st.id.name });
        continue;
      }
      const hash = sha(code.replace(/\s+/g, ' ').trim());
      const kind = st.type === 'VariableDeclaration' ? st.kind
        : (st.type === 'ClassDeclaration' ? 'class' : 'statement');
      const names = declaredNames(st);
      // 只有「带初始化的 var/let/const」和「语句」才有加载期副作用
      const isDecl = st.type === 'VariableDeclaration' || st.type === 'ClassDeclaration';
      const effectful = !isDecl || st.type === 'ClassDeclaration' ||
        st.declarations.some((d) => d.init);
      if (!effectful) continue;

      items.push({
        file, hash, kind, names,
        reads: loadReadsOf(st),
        sideEffect: isDecl ? st.declarations.some((d) => d.init && hasSideEffect(d.init)) : hasSideEffect(st),
      });
    }
  }

  /* 观测：对每个名字，记录「每个读取点 → 那一刻是否已初始化」 */
  const inited = new Set();
  const obs = {};
  for (const it of items) {
    for (const r of it.reads) {
      (obs[r] = obs[r] || {})[it.hash] = inited.has(r);
    }
    for (const n of it.names) inited.add(n);
  }

  return { files, items, fnDecls, obs, strictCount };
}

/* ==================================================================== */

/** 落基线（重排**前**跑）。返回统计。 */
function writeBaseline() {
  const cur = collect();
  const baseline = {
    note: '按职责重排（2026-09-24）**前**的加载期读写观测基线。改动 public/js/app 的顶层条目顺序后用它验证等价性。',
    files: cur.files,
    itemHashes: cur.items.reduce((m, it) => (m[it.hash] = (m[it.hash] || 0) + 1, m), {}),
    fnHashes: cur.fnDecls.reduce((m, it) => (m[it.hash] = (m[it.hash] || 0) + 1, m), {}),
    obs: cur.obs,
  };
  fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
  fs.writeFileSync(BASELINE, JSON.stringify(baseline, null, 2));
  return {
    items: cur.items.length, fns: cur.fnDecls.length, names: Object.keys(cur.obs).length,
  };
}

/**
 * 校验当前布局是否与基线等价。
 * 不直接 process.exit —— 这样 `tests/app-reorg.test.js` 可以直接 require 本模块复用同一份判定，
 * 不必 spawn 子进程（沙箱里 spawnSync 一律 EBUSY，且复制一份判定逻辑迟早会漂移）。
 * @returns {{fails: string[], notes: string[], checked: number, names: number, base: object, cur: object}}
 */
function verify() {
  if (!fs.existsSync(BASELINE)) {
    throw new Error('没有基线文件 ' + path.relative(REPO, BASELINE) + '，先跑 node scripts/check-app-reorg.js --write-baseline');
  }
  const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  const cur = collect();
  const fails = [];
  const notes = [];

  /* 1. 条目守恒（hash 多重集） */
  const cmpCounts = (label, a, b) => {
    for (const h of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const x = a[h] || 0, y = b[h] || 0;
      if (x !== y) fails.push(label + '条目数变化：' + h + ' 基线 ' + x + ' 现在 ' + y);
    }
  };
  cmpCounts('有副作用', base.itemHashes, cur.items.reduce((m, it) => (m[it.hash] = (m[it.hash] || 0) + 1, m), {}));
  cmpCounts('function 声明', base.fnHashes, cur.fnDecls.reduce((m, it) => (m[it.hash] = (m[it.hash] || 0) + 1, m), {}));

  /* 2. 读取观测等价 */
  const names = new Set([...Object.keys(base.obs), ...Object.keys(cur.obs)]);
  let checked = 0;
  for (const n of names) {
    const a = base.obs[n] || {};
    const b = cur.obs[n] || {};
    const hashes = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const h of hashes) {
      if (!(h in a) || !(h in b)) {
        // 读取点本身消失/新增 —— 通常意味着该条目被改动了，条目守恒那条会先报
        if (h in a) fails.push('名字 `' + n + '` 的读取点消失（条目 ' + h + '，基线读到 ' + a[h] + '）');
        else fails.push('名字 `' + n + '` 新增读取点（条目 ' + h + '，现在读到 ' + b[h] + '）');
        continue;
      }
      checked++;
      if (a[h] !== b[h]) {
        fails.push('名字 `' + n + '` 的读取观测变了（条目 ' + h + '：基线 ' +
          (a[h] ? '已初始化' : '未初始化') + ' → 现在 ' + (b[h] ? '已初始化' : '未初始化') + '）');
      }
    }
  }

  /* 3. 带副作用的初始化器单独提示（需要人工确认） */
  const movedSideEffect = cur.items.filter((it) => it.sideEffect);
  if (movedSideEffect.length) {
    notes.push('含副作用的初始化器 ' + movedSideEffect.length + ' 个（顺序已由上面的观测保证，但副作用发生时刻可能变化，值得人工扫一眼）：' +
      movedSideEffect.slice(0, 12).map((x) => (x.names.length ? x.names.join('/') : x.kind + '#' + x.hash) + '@' + x.file).join(', '));
  }

  return { fails, notes, checked, names: names.size, base, cur };
}

module.exports = { verify, collect, writeBaseline, BASELINE, REPO, APP_DIR };

/* ---------------------------- CLI ---------------------------- */
if (require.main === module) {
  if (process.argv.includes('--write-baseline')) {
    const r = writeBaseline();
    console.log('✅ 已写基线 ' + path.relative(REPO, BASELINE));
    console.log('   有加载期副作用的条目 ' + r.items + ' 个；function 声明 ' + r.fns + ' 个；被观测的名字 ' + r.names + ' 个');
    process.exit(0);
  }

  let r;
  try {
    r = verify();
  } catch (e) {
    console.error('❌ ' + e.message);
    process.exit(1);
  }

  console.log('=== 加载期读写顺序等价校验 ===');
  console.log('基线：' + r.base.files.join(' → '));
  console.log('现在：' + r.cur.files.join(' → '));
  console.log('有加载期副作用的条目：基线 ' + Object.values(r.base.itemHashes).reduce((a, b) => a + b, 0) +
    ' 个 / 现在 ' + r.cur.items.length + ' 个');
  console.log('被观测的名字 ' + r.names + ' 个，比对读取点 ' + r.checked + ' 处');

  if (process.argv.includes('--detail')) {
    const ns = new Set([...Object.keys(r.base.obs), ...Object.keys(r.cur.obs)]);
    for (const n of [...ns].sort()) {
      const a = r.base.obs[n] || {}, b = r.cur.obs[n] || {};
      console.log('  ' + n.padEnd(28) + JSON.stringify(a) + '  →  ' + JSON.stringify(b));
    }
  }
  for (const n of r.notes) console.log('  NOTE  ' + n);

  if (r.fails.length) {
    console.error('\n❌ 加载期顺序等价校验失败 ' + r.fails.length + ' 条：');
    for (const f of r.fails.slice(0, 40)) console.error('   ' + f);
    if (r.fails.length > 40) console.error('   …还有 ' + (r.fails.length - 40) + ' 条');
    console.error('\n修法：把出问题的 var/let/const 或语句放回原位置（非函数条目必须保持「读取点看到的初始化状态」不变）。');
    process.exit(1);
  }
  console.log('\n✅ 加载期读写顺序与基线完全等价（' + r.checked + ' 处读取点逐一比对通过）');
}
