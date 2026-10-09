#!/usr/bin/env node
/**
 * 学习价值验收（`npm run verify:learning`）
 *
 * ── 为什么需要这个脚本 ──
 * 本目标的原文是：
 *
 *   「刷 20 个简单词」与「攻克 20 个生词」收益相同 —— 需建立一一对应。
 *
 * 单元测试只验证**公式**（`learningValue()` 的系数）。但真正要回答的是
 * **玩家实际打 20 题之后，账户里多了多少修为/灵石** —— 这要跑真实结算路径
 * （`settle()`），涉及 memStats 自增、schedule 覆盖、连对、奇遇增益等
 * 一堆只在浏览器里才成立的顺序关系。
 *
 * 所以本脚本在真浏览器里**模拟两种打法各 20 题**，直接对比账户增量：
 *
 *   A) 勤学者：20 个不同的「认知词/低频词」生词，逐个首次答对
 *   B) 刷分者：同一个「高频已掌握」词，反复答对 20 次
 *
 * 断言 A 显著优于 B（目标要求的「一一对应」），
 * 并顺带验证反刷题、经济中性、SM-2 不变。
 *
 * 用法：node scripts/verify-learning.mjs [线上URL]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = join(ROOT, 'dist');
const REMOTE = process.argv[2] || '';
const PORT = 4191, CDP = 9499;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

let server = null;
if (!REMOTE) {
  if (!existsSync(join(DIST, 'index.html'))) { console.error('❌ 未找到 dist/index.html，请先 npm run build'); process.exit(1); }
  server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    const f = join(DIST, p);
    if (!existsSync(f) || fs.statSync(f).isDirectory()) {
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      return res.end(fs.readFileSync(join(DIST, 'index.html')));
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    res.end(fs.readFileSync(f));
  });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
}
const TARGET = REMOTE || `http://127.0.0.1:${PORT}/`;

const bp = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find((p) => existsSync(p));
if (!bp) { console.log('⏭️  未找到浏览器，跳过'); process.exit(0); }

const profile = mkdtempSync(join(tmpdir(), 'edge-lv-'));
const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';
const args = ['--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, '--no-first-run',
  '--disable-extensions', '--hide-scrollbars', '--window-size=1440,1000'];
if (REMOTE && proxy) args.push(`--proxy-server=${proxy}`);
args.push(TARGET);
const proc = spawn(bp, args, { stdio: 'ignore' });

function cdp(ws) {
  let id = 0; const pend = new Map();
  ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { const { resolve, reject } = pend.get(m.id); pend.delete(m.id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } });
  return (method, params = {}) => new Promise((resolve, reject) => {
    const i = ++id; pend.set(i, { resolve, reject });
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => { if (pend.has(i)) { pend.delete(i); reject(new Error('timeout ' + method)); } }, 40000);
  });
}

let fail = 0;
const lines = [];
const ok = (pass, msg) => { if (!pass) fail++; lines.push(`${pass ? 'PASS' : 'FAIL'}  ${msg}`); };

try {
  let page;
  for (let i = 0; i < 100; i++) {
    try {
      const l = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
      page = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl && t.url
        && !/^(edge|chrome|about|devtools):/.test(t.url)
        && (!REMOTE || t.url.includes('qingci') || t.url.includes('127.0.0.1')));
      if (page) break;
    } catch { /* 浏览器还没起 */ }
    await sleep(500);
  }
  if (!page) throw new Error('CDP 未就绪');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const send = cdp(ws);
  await send('Runtime.enable');
  const errors = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') errors.push('EXC: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('ERR: ' + m.params.args.map((a) => a.value || a.description || '').join(' '));
  });
  await sleep(9000);
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception || {}).description || r.exceptionDetails.text };
    return r.result.value;
  };

  console.log(`学习价值验收 · ${TARGET}`);
  console.log('─'.repeat(74));

  /* ── 前置：服务可用 ── */
  const svc = await ev(`(() => { var S=window.QingciServices; return {
    learning: !!(S&&S.learning), value: typeof (S&&S.learning&&S.learning.value),
    spirit: typeof (S&&S.learning&&S.learning.spirit), tierOf: typeof (S&&S.vocab&&S.vocab.tierOf),
    personal: typeof (S&&S.learning&&S.learning.personal), settle: typeof settle }; })()`);
  ok(svc.learning === true && svc.value === 'function' && svc.settle === 'function',
    `服务就绪（learning/spirit/personal/settle 齐备）`);

  /* ── 核心：模拟两种打法各 20 题，对比账户增量 ── */
  const duel = await ev(`(async () => {
    var S = window.QingciServices, V = S.vocab;
    var N = 20;

    function reset(){
      state.known = {}; state.wrong = {}; state.schedule = {}; state.memStats = {};
      state.qi = 0; state.spirit = 0; state.streak = 0;
      state.days = {}; state.claimed = {}; state.dailySeen = {}; state.dailyWords = 0;
      state.dailyKey = dayKey();
      state.recent = [];
      // 关掉随机性：清掉奇遇增益，避免干扰对比
      try { localStorage.removeItem('qingci.encounterEffects'); } catch(e){}
      try { state.spirit = 0; } catch(e){}
    }
    // 固定 100% 不暴击，保证可比（暴击是随机的，会污染对比）
    var _origCrit = window.rollCritSafe;
    window.rollCritSafe = function(){ return false; };

    async function runPlaystyle(pickWord){
      reset();
      var words = [];
      for (var i = 0; i < N; i++) words.push(pickWord(i));
      for (var j = 0; j < N; j++) {
        var w = words[j];
        current = { word: w, memKind: 'zh2en', kind: 'zh2en', answer: w, explain: '', choices: [w] };
        state.pool = 'words';
        settle(true, '验收');
        await new Promise(function(r){ setTimeout(r, 12); });
      }
      return { qi: state.qi, spirit: state.spirit, streak: state.streak, distinctWords: new Set(words).size };
    }

    // A) 勤学者：20 个不同的认知词生词（首次答对）
    var recog = V.wordsOfTier('recognition').slice(0, N);
    var diligent = await runPlaystyle(function(i){ return recog[i % recog.length]; });

    // B) 刷分者：同一个高频词，反复答对 20 次
    var highWord = V.wordsOfTier('high')[0];
    var grinder = await runPlaystyle(function(){ return highWord; });

    window.rollCritSafe = _origCrit;
    return { diligent: diligent, grinder: grinder, highWord: highWord, recogSample: recog.slice(0,3) };
  })()`);

  if (duel.__err) throw new Error('模拟失败: ' + duel.__err);
  console.log('A) 勤学者（20 个不同认知词）:', JSON.stringify(duel.diligent));
  console.log('B) 刷分者（同一高频词 ×20）:', JSON.stringify(duel.grinder));
  const d = duel.diligent, g = duel.grinder;
  const qiRatio = g.qi > 0 ? d.qi / g.qi : Infinity;
  const spDiff = d.spirit - g.spirit;
  console.log(`  修为比 勤学/刷分 = ${qiRatio === Infinity ? '∞' : qiRatio.toFixed(2)}×`);
  console.log(`  灵石差 勤学 − 刷分 = ${spDiff}`);

  ok(d.distinctWords === 20, `勤学者确实练了 20 个不同词（${d.distinctWords}）`);
  ok(g.distinctWords === 1, `刷分者反复练 1 个词（${g.distinctWords}）`);
  ok(d.qi > g.qi, `勤学修为(${d.qi}) > 刷分修为(${g.qi})`);
  ok(qiRatio >= 2, `勤学修为至少是刷分的 2 倍（实际 ${qiRatio.toFixed(2)}×）—— 一一对应成立`);
  ok(d.spirit > g.spirit, `勤学灵石(${d.spirit}) > 刷分灵石(${g.spirit}) —— 灵石也认学习价值`);
  ok(g.spirit <= 8, `刷同一个已掌握词几乎拿不到灵石（${g.spirit}）`);

  /* ── 反刷题：越刷越少（同一词连续答对，单题收益递减） ── */
  const decay = await ev(`(async () => {
    var S = window.QingciServices, V = S.vocab;
    state.known = {}; state.wrong = {}; state.schedule = {}; state.memStats = {};
    state.qi = 0; state.spirit = 0; state.streak = 0; state.days = {}; state.claimed = {};
    state.dailyKey = dayKey();
    var w = V.wordsOfTier('core')[0];
    var gains = [];
    var _origCrit = window.rollCritSafe; window.rollCritSafe = function(){ return false; };
    for (var i = 0; i < 6; i++) {
      var before = state.qi;
      current = { word: w, memKind: 'zh2en', kind: 'zh2en', answer: w, explain: '', choices: [w] };
      state.pool = 'words';
      settle(true, '验收');
      gains.push(state.qi - before);
      await new Promise(function(r){ setTimeout(r, 10); });
    }
    window.rollCritSafe = _origCrit;
    return gains;
  })()`);
  console.log('同一词连续 6 次单题修为:', JSON.stringify(decay));
  ok(Array.isArray(decay) && decay.length === 6, '取得 6 次单题收益');
  if (Array.isArray(decay)) {
    ok(decay[5] < decay[0], `第 6 次(${decay[5]}) < 第 1 次(${decay[0]}) —— 边际递减`);
    /* ⚠️ 不能断言「合成修为严格单调不增」——
       实测序列 [7,5,4,3,4,4] 第 5 次会回升，原因是**既有连对档位**
       （连对 5+ 触发 ×1.5，是第一期就有的机制，必须保留）。
       学习价值系数本身是严格递减的（1.0→0.75→0.55→0.4），
       所以正确的断言是「**学习价值系数**单调不增」+「长期看收益显著衰减」。 */
    const monotoneFactor = await ev(`(() => {
      var L = window.QingciServices.learning;
      var f = [];
      for (var i = 0; i < 6; i++) f.push(L.value({ tier:'core', correctTimes:i }).factor);
      var mono = true;
      for (var j = 1; j < f.length; j++) if (f[j] > f[j-1]) mono = false;
      return { factors: f, mono: mono };
    })()`);
    console.log('  学习价值系数序列:', JSON.stringify(monotoneFactor.factors));
    ok(monotoneFactor.mono === true,
      '学习价值系数单调不增（连对档位跳变不算违规）');
    // 长期衰减：第 6 次应明显低于第 1 次
    ok(decay[5] <= decay[0] * 0.7,
      `第 6 次(${decay[5]}) 明显低于第 1 次(${decay[0]})，衰减 ≥30%`);
  }

  /* ── 个人难度：弱项确实多拿 ── */
  const personal = await ev(`(async () => {
    var S = window.QingciServices, V = S.vocab;
    function run(stat){
      state.known = {}; state.wrong = {}; state.schedule = {}; state.memStats = { zh2en: stat };
      state.qi = 0; state.spirit = 0; state.streak = 0; state.days = {}; state.claimed = {};
      state.dailyKey = dayKey();
      var w = V.wordsOfTier('high')[0];
      current = { word: w, memKind: 'zh2en', kind: 'zh2en', answer: w, explain: '', choices: [w] };
      state.pool = 'words';
      settle(true, '验收');
      return state.qi;
    }
    var _origCrit = window.rollCritSafe; window.rollCritSafe = function(){ return false; };
    var weak = run({ r: 2, n: 10 });
    var strong = run({ r: 9, n: 10 });
    window.rollCritSafe = _origCrit;
    return { weak: weak, strong: strong };
  })()`);
  console.log('弱项 vs 强项（同词同连对）:', JSON.stringify(personal));
  ok(personal.weak >= personal.strong, `弱项(${personal.weak}) ≥ 强项(${personal.strong})`);

  /* ── SM-2 未被改动 ── */
  const srs = await ev(`(() => {
    state.schedule = {};
    var w = window.QingciServices.vocab.wordsOfTier('core')[0];
    scheduleWord(w, 'good');
    return Object.keys(state.schedule[w]).sort();
  })()`);
  ok(JSON.stringify(srs) === JSON.stringify(['level','next','tries']),
    `SM-2 记录字段未变（${srs.join(',')}）`);

  /* ── 经济中性：归一化后期望产出倍数 = 1 ── */
  const eco = await ev(`(() => {
    var L = window.QingciServices.learning;
    var counts = window.QingciServices.vocab.grades.counts;
    return { mult: L.expectedSpiritMultiplier(counts) };
  })()`);
  ok(Math.abs(eco.mult - 1) < 0.001, `灵石期望产出倍数 ${eco.mult} ≈ 1（经济不膨胀）`);

  /* ── 零页面异常 ── */
  ok(errors.length === 0, `零页面异常${errors.length ? '：' + errors.slice(0, 2).join(' | ') : ''}`);

  ws.close();
} catch (e) {
  fail++;
  lines.push(`FAIL  脚本异常：${e.message}`);
} finally {
  try { proc.kill(); } catch { /* 忽略 */ }
  try { if (server) server.close(); } catch { /* 忽略 */ }
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* 忽略 */ }
}

console.log(lines.join('\n'));
console.log('─'.repeat(74));
console.log(fail === 0
  ? `✅ 学习价值验收全部通过（${lines.filter((l) => l.startsWith('PASS')).length} 项）`
  : `❌ ${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
