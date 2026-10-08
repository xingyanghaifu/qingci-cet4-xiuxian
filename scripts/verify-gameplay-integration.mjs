#!/usr/bin/env node
/**
 * 修仙机制集成验收（真浏览器，同一会话）
 *
 * ── 为什么需要这个脚本 ──
 * 本项目 2026-10-08 连做五轮玩法/体积改动，每轮都各自有守卫：
 *
 *   R1 浮层定位（position:fixed 被覆盖 → 弹层渲染到视口外）
 *   R2 奇遇效果 + 道场三设施 buff + 洞府装饰视觉
 *   R3 灵石流水账本
 *   R4 内联词库紧凑列式（省 101.9 KB）+ 灵根五行天赋
 *
 * 但**没有任何一处验证「它们放在一起还能正常工作」**。
 * 这类交叉干扰是真会发生的：例如 R2 给 `.app` 加装饰 class、
 * R4 改了词库解析路径 —— 都可能让别的模块静默失效。
 *
 * 单元测试测不到这个：它们各自隔离运行，且看不到真实 DOM/级联。
 * 所以本脚本在**同一个浏览器会话里**依次验证全部机制 + 面板切换 +
 * 词库切换（R1 修复的那条链路），并断言**零页面异常**。
 *
 * 用法：node scripts/verify-gameplay-integration.mjs [target]
 *   默认对本地 dist 起临时服务；也可传线上 URL。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = path.join(ROOT, 'dist');
const REMOTE = process.argv[2] || '';
const PORT = Number(process.env.PORT) || 4190;
const CDP = 9470;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png', '.mp3': 'audio/mpeg', '.css': 'text/css; charset=utf-8',
};

let server = null;
if (!REMOTE) {
  if (!existsSync(path.join(DIST, 'index.html'))) {
    console.error('❌ 未找到 dist/index.html，请先执行 npm run build');
    process.exit(1);
  }
  server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    const f = path.join(DIST, p);
    if (!existsSync(f) || fs.statSync(f).isDirectory()) {
      // 与 Cloudflare Pages 一致的 SPA 回退
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      return res.end(fs.readFileSync(path.join(DIST, 'index.html')));
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    res.end(fs.readFileSync(f));
  });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
}
const TARGET = REMOTE || `http://127.0.0.1:${PORT}/`;

const bp = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].find((p) => existsSync(p));
if (!bp) { console.log('⏭️  未找到浏览器，跳过'); process.exit(0); }

const profile = mkdtempSync(path.join(tmpdir(), 'edge-integ-'));
const proc = spawn(bp, ['--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, '--no-first-run',
  '--disable-extensions', '--hide-scrollbars', '--window-size=1440,1100',
  TARGET], { stdio: 'ignore' });

function cdp(ws) {
  let id = 0; const pend = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) {
      const { resolve, reject } = pend.get(m.id); pend.delete(m.id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    }
  });
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
      page = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
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

  console.log(`修仙机制集成验收 · ${TARGET}`);
  console.log('─'.repeat(74));

  /* ── R1 浮层定位 ── */
  const ovs = await ev(`(() => [...document.body.children].filter(c=>c.classList.contains('overlay'))
    .map(el => getComputedStyle(el).position))()`);
  ok(Array.isArray(ovs) && ovs.length >= 11 && ovs.every((p) => p === 'fixed'),
    `[R1] ${Array.isArray(ovs) ? ovs.length : 0} 个浮层均为 position:fixed`);

  /* ── R2 奇遇效果 ── */
  const enc = await ev(`(() => {
    var S=window.QingciServices, EE=S.encounterEffects;
    localStorage.removeItem('qingci.encounterEffects');
    EE.apply('cave'); EE.apply('beast');
    return { mult: EE.qiMultiplier(), labels: EE.activeBoostLabels().length };
  })()`);
  ok(enc && Math.abs(enc.mult - 1.65) < 1e-9, `[R2] 洞天×灵兽倍率 1.65（实际 ${enc && enc.mult}）`);
  ok(enc && enc.labels === 2, `[R2] 增益摘要 2 条（实际 ${enc && enc.labels}）`);

  /* ── R2 道场三设施 buff ── */
  const sect = await ev(`(() => {
    var S=window.QingciServices;
    var b=S.sect.buffs([{id:'scripture_hall',level:1},{id:'alchemy_room',level:1},{id:'arena',level:1}]);
    return { book: S.sectBuffs.discountedBookPrice(50, b.detailUnlockBonus),
             arena: S.sectBuffs.applyArenaBonus(20, b.duelWinBonus),
             buffs: b };
  })()`);
  ok(sect && sect.book === 40, `[R2] 藏经阁折扣 50→40（实际 ${sect && sect.book}）`);
  ok(sect && sect.arena === 21, `[R2] 演武场加成 20→21（实际 ${sect && sect.arena}）`);

  /* ── R2 洞府装饰视觉 ── */
  const deco = await ev(`(async () => {
    var S=window.QingciServices, CV=S.cave;
    state.spirit = 2000; save();
    for (var id of ['bg_ink','furniture_bamboo','frame_cloud','frame_beast']) await CV.purchase(state, id);
    await new Promise(r=>setTimeout(r,500));
    if (window.__fieldRefresh) window.__fieldRefresh();
    await new Promise(r=>setTimeout(r,900));
    var q=function(s){var e=document.querySelector(s);return e?Array.from(e.classList).filter(function(c){return c.indexOf('deco-')===0;}).length:0;};
    return { app:q('.app'), realm:q('#realmName'), dao:q('#daoName') };
  })()`);
  ok(deco && deco.app && deco.realm && deco.dao,
    `[R2] 装饰视觉已挂载（app=${deco && deco.app} realm=${deco && deco.realm} dao=${deco && deco.dao}）`);

  /* ── R3 灵石流水账本 ── */
  const led = await ev(`(async () => {
    var S=window.QingciServices, ES=S.economy;
    ES.earnSpirit(state, 50, 'duel_win');
    await new Promise(r=>setTimeout(r,400));
    if (window.__ledgerRefresh) window.__ledgerRefresh();
    await new Promise(r=>setTimeout(r,800));
    return { rows: document.querySelectorAll('#ledgerList .ledger-row').length,
             summary: (document.getElementById('ledgerSummary')||{}).textContent };
  })()`);
  ok(led && led.rows >= 1, `[R3] 账本渲染 ${led && led.rows} 行`);
  ok(led && /近 \d+ 笔/.test(led.summary || ''), `[R3] 账本汇总（${led && led.summary}）`);

  /* ── R4 紧凑列式词库 ── */
  const lex = await ev(`(() => {
    var raw = JSON.parse(document.getElementById('lexicon').textContent);
    var rows = decodeLexicon(raw);
    return { compact: !Array.isArray(raw), len: rows.length, ok: !!(rows[0] && rows[0].w && rows[0].zh) };
  })()`);
  ok(lex && lex.compact && lex.len === 4540 && lex.ok,
    `[R4] 列式词库解码 ${lex && lex.len} 条（compact=${lex && lex.compact}）`);

  /* ── R4 灵根 ── */
  const root = await ev(`(() => {
    state.memStats = { spell:{r:20,n:20}, zh2en:{r:5,n:5} }; save();
    if (typeof renderDashboard === 'function') renderDashboard();
    return { grade: (document.getElementById('rootGrade')||{}).textContent,
             elems: document.querySelectorAll('#rootElems .root-elem').length };
  })()`);
  ok(root && /天灵根/.test(root.grade || ''), `[R4] 灵根判定（${root && root.grade}）`);
  ok(root && root.elems === 5, `[R4] 五系渲染（${root && root.elems}）`);

  /* ── 集成：8 个面板依次切换 ── */
  const panels = ['paper', 'trial', 'speak', 'book', 'codex', 'map', 'duel', 'field'];
  let switched = 0;
  for (const t of panels) {
    const r = await ev(`(async () => {
      var b=document.querySelector('.tabs button[data-tab="${t}"]');
      if (!b) return false;
      b.click(); await new Promise(r=>setTimeout(r,350));
      var p=document.getElementById('panel-${t}');
      return p ? !p.classList.contains('hidden') : false;
    })()`);
    if (r) switched++;
  }
  ok(switched === panels.length, `[集成] 8 个面板均可切换（${switched}/${panels.length}）`);

  /* ── 集成：词库切换（R1 修复的那条链路，防回归） ── */
  const lx = await ev(`(async () => {
    var b=document.querySelector('.tabs button[data-tab="map"]'); if(b) b.click();
    await new Promise(r=>setTimeout(r,900));
    var g=document.getElementById('lxGrid');
    if (!g) return { err: 'no lxGrid' };
    var card=[...g.querySelectorAll('[data-lx]')].find(x=>x.getAttribute('data-lx')==='cet6');
    if (!card) return { err: 'no cet6 card' };
    card.click();
    await new Promise(r=>setTimeout(r,600));
    var ov=document.getElementById('askOverlay');
    var okb=document.getElementById('askOk');
    var r=okb.getBoundingClientRect();
    var res={ hidden: ov.classList.contains('hidden'), inViewport: r.top>=0 && r.bottom<=innerHeight };
    okb.click();
    await new Promise(r=>setTimeout(r,2000));
    res.current = window.__lexiconId();
    return res;
  })()`);
  ok(lx && lx.hidden === false && lx.inViewport, '[集成] 词库确认弹层在视口内可点（R1 无回归）');
  ok(lx && lx.current === 'cet6', `[集成] 词库切换成功（${lx && lx.current}）`);

  /* ── 全局：零页面异常 ── */
  ok(errors.length === 0, `[全局] 零页面异常${errors.length ? '：' + errors.slice(0, 3).join(' | ') : ''}`);

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
  ? `✅ 集成验收全部通过（${lines.filter((l) => l.startsWith('PASS')).length} 项）`
  : `❌ ${fail} 项失败`);
process.exit(fail === 0 ? 0 : 1);
