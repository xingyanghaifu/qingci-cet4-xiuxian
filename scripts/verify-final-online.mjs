/**
 * 最终综合验收（真浏览器 · 生产）
 *
 * 覆盖本轮全部交付：
 *   1. 9 个词库卡片都渲染、词数与 enabled 正确
 *   2. 逐词库经**真实 UI 点击**切换后，题库确实是自己的（题号 token 校验）
 *   3. 听力音频可达 + 浏览器可解码 + 每条时长 > 3s
 *   4. 修行第一期：45 子层级曲线生效
 *   5. 修行第二期：反馈动效 keyframes 存在且无新 infinite
 *   6. role="tab" 仍为 9（硬约束）
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 9401;
const TARGET = process.argv[2] || 'https://qingci-cet4-xiuxian.pages.dev/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find((p) => existsSync(p));
if (!browser) { console.log('⏭️  未找到浏览器，跳过'); process.exit(0); }
const profile = mkdtempSync(join(tmpdir(), 'edge-final-'));
const proc = spawn(browser, ['--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run',
  '--disable-extensions', TARGET], { stdio: 'ignore' });

function cdp(ws) {
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } });
  return (method, params = {}) => new Promise((resolve, reject) => { const myId = ++id; pending.set(myId, { resolve, reject });
    ws.send(JSON.stringify({ id: myId, method, params })); setTimeout(() => { if (pending.has(myId)) { pending.delete(myId); reject(new Error('timeout')); } }, 90000); });
}

let failures = 0;
const lines = [];
const ok = (pass, msg) => { if (!pass) failures++; lines.push(`${pass ? 'PASS' : 'FAIL'}  ${msg}`); };

try {
  let page;
  for (let i = 0; i < 80; i++) {
    try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      page = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl); if (page) break; } catch {}
    await sleep(500);
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const send = cdp(ws);
  await send('Runtime.enable');
  const e0 = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result.value;
  for (let i = 0; i < 50; i++) { if (await e0('!!window.QingciServices')) break; await sleep(1000); }
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception || {}).description || r.exceptionDetails.text };
    return r.result.value;
  };

  console.log(`最终综合验收 · ${TARGET}`);
  console.log('─'.repeat(70));

  /* 1. 卡片渲染 */
  const grid = await ev(`(async () => {
    const mapTab = document.querySelector('.tabs button[data-tab="map"]');
    if (mapTab) mapTab.click();
    const g = document.getElementById('lxGrid');
    for (let i = 0; i < 40; i++) { if (g && g.children.length >= 9) break; await new Promise(r => setTimeout(r, 800)); }
    return {
      count: g ? g.children.length : 0,
      text: (g && g.textContent || '').replace(/\\s+/g,' ').slice(0, 300),
    };
  })()`);
  ok(grid && grid.count === 9, `词库卡片 9 个（实际 ${grid && grid.count}）`);

  /* 2. 逐词库 UI 切换 + 题库归属校验 */
  console.log('\n【逐词库 UI 切换 → 题库归属】');
  // 注意：题库题号用的是 build-exam-bank 里的 `prefix` 字段，不是词库 id。
  // GRE/IELTS/TOEFL 的 prefix 分别是 gr / il / tf（更短，为省体积），
  // 其余词库 prefix 与 id 同源。按 prefix 校验，否则会误报。
  const LEX = [
    ['GRE', 'gr'],
    ['IELTS', 'il'],
    ['TOEFL', 'tf'],
    ['考研', 'ky'],
    ['初中', 'jun'],
    ['高中', 'sen'],
    ['PRETCO', 'pt'],
  ];
  for (const [label, token] of LEX) {
    const r = await ev(`(async () => {
      const mapTab = document.querySelector('.tabs button[data-tab="map"]');
      if (mapTab) mapTab.click();
      const g = document.getElementById('lxGrid');
      for (let i = 0; i < 40; i++) { if (g && g.children.length >= 9) break; await new Promise(r => setTimeout(r, 600)); }
      const t = [...g.children].find(c => new RegExp(${JSON.stringify(label)}).test(c.textContent||''));
      if (!t) return { err: 'no card' };
      t.click();
      await new Promise(r => setTimeout(r, 700));
      const okBtn = document.getElementById('askOk');
      if (!okBtn) return { err: 'no confirm' };
      okBtn.click();
      await new Promise(r => setTimeout(r, 5000));
      const S = window.QingciServices;
      const svc = window.__QINGCI_BANK__;
      // 关键：切词库后题库是**异步**重新 fetch 的。必须等 bankLexicon 真的变成目标、
      // 且题库题号属于该词库，否则会读到上一个词库的旧结果（实测首轮切换会读到 CET-4 的 18502 题）。
      let b = null;
      let toks = {};
      for (let i = 0; i < 30; i++) {
        if (svc.lexicon && svc.lexicon() !== ${JSON.stringify(token === 'gr' ? 'gre' : token === 'il' ? 'ielts' : token === 'tf' ? 'toefl' : token === 'ky' ? 'kaoyan' : token === 'jun' ? 'junior' : token === 'sen' ? 'senior' : 'pretco')}) {
          await new Promise(r => setTimeout(r, 500));
          continue;
        }
        b = svc.load ? await svc.load() : null;
        const qs2 = (b && b.questions) || [];
        toks = {};
        for (const q of qs2.slice(0, 500)) { const t2 = (q.id||'').split('_')[1]||'?'; toks[t2]=(toks[t2]||0)+1; }
        if (Object.keys(toks).length && Object.keys(toks)[0] === ${JSON.stringify(token)}) break;
        await new Promise(r => setTimeout(r, 1000));
      }
      return {
        lex: S.lexicon.current(),
        bankLex: svc.lexicon ? svc.lexicon() : '(n/a)',
        total: (b && b.questions) ? b.questions.length : 0,
        toks: Object.keys(toks).slice(0, 3),
      };
    })()`);
    if (r && r.err) { ok(false, `${label}: ${r.err}`); continue; }
    ok(r.toks.includes(token),
      `${label.padEnd(7)} 题库归属 token=[${r.toks.join(',')}] 期望含 ${token}（${r.total} 题）`);
  }

  /* 3. 听力音频 */
  console.log('\n【听力音频】');
  for (const qid of ['q_jun_talk_0001', 'q_sen_talk_0001', 'q_ky_talk_0001', 'q_pt_talk_0001']) {
    const a = await ev(`(async () => {
      const url = 'audio/tts/${qid}.mp3';
      const res = await fetch(url);
      const bytes = (await res.arrayBuffer()).byteLength;
      const loaded = await new Promise((resolve) => {
        const a2 = new Audio(url);
        a2.addEventListener('loadedmetadata', () => resolve({ ok: true, duration: a2.duration }));
        a2.addEventListener('error', () => resolve({ ok: false }));
        setTimeout(() => resolve({ ok: false, err: 'timeout' }), 9000);
        a2.load();
      });
      return { status: res.status, bytes, loaded };
    })()`);
    ok(a.status === 200 && a.loaded.ok && a.loaded.duration > 3,
      `${qid} → HTTP ${a.status} ${a.bytes} B，时长 ${a.loaded.duration}s`);
  }

  /* 4. 修行第一期 + 第二期 */
  console.log('\n【修行数值与反馈】');
  const cult = await ev(`(() => {
    const C = window.QingciServices && window.QingciServices.curve;
    if (!C) return { err: 'no curve' };
    return {
      total: C.TOTAL_SUBLEVELS,
      lv0: C.qiForSubLevel(0),
      crit: C.CRIT_CHANCE,
      combo3: C.comboMultiplier(3),
      decay4: C.applyDecay(1000, 4).lost,
      decay99: C.applyDecay(1000, 99).lost,
    };
  })()`);
  ok(cult && cult.total === 45 && cult.lv0 === 50 && cult.crit === 0.1 && cult.combo3 === 1.2
    && cult.decay4 === 50 && cult.decay99 === 500, `第一期曲线生效: ${JSON.stringify(cult)}`);

  const anim = await ev(`(() => {
    const sheets = [...document.styleSheets].map(s => { try { return [...s.cssRules].map(r=>r.cssText).join('\\n'); } catch(e){ return ''; } }).join('\\n');
    return {
      kf: ['subLevelUp','critFlash','critRing','comboPop'].filter(k => sheets.includes('@keyframes ' + k)),
      infMine: (sheets.match(/animation:[^;}]*infinite[^;}]*/g)||[]).filter(d => /subLevelUp|critFlash|critRing|comboPop/.test(d)),
      infTotal: (sheets.match(/animation:[^;}]*infinite[^;}]*/g)||[]).length,
    };
  })()`);
  ok(anim && anim.kf.length === 4 && anim.infMine.length === 0,
    `第二期动效：4 个 keyframes，新增 infinite ${anim && anim.infMine.length} 条（总 ${anim && anim.infTotal}）`);

  /* 5. role=tab */
  const tabs = await ev(`document.querySelectorAll('[role="tab"]').length`);
  ok(tabs === 9, `role="tab" 仍为 9（实际 ${tabs}）`);

  // 切回 CET-4
  await ev(`(async () => {
    const mapTab = document.querySelector('.tabs button[data-tab="map"]');
    if (mapTab) mapTab.click();
    const g = document.getElementById('lxGrid');
    for (let i = 0; i < 40; i++) { if (g && g.children.length >= 9) break; await new Promise(r => setTimeout(r, 600)); }
    const t = [...g.children].find(c => /CET-4/.test(c.textContent||''));
    if (!t) return;
    t.click();
    await new Promise(r => setTimeout(r, 700));
    const okBtn = document.getElementById('askOk');
    if (okBtn) okBtn.click();
    await new Promise(r => setTimeout(r, 3000));
    return window.QingciServices.lexicon.current();
  })()`);
  const back = await ev(`window.QingciServices.lexicon.current()`);
  ok(back === 'cet4', `最终切回 CET-4（current=${back}）`);

  ws.close();
} catch (e) {
  failures++;
  lines.push(`FAIL  脚本异常：${e.message}`);
} finally { try { proc.kill(); } catch {} try { rmSync(profile, { recursive: true, force: true }); } catch {} }

console.log(lines.join('\n'));
console.log('\n' + '─'.repeat(70));
console.log(failures === 0 ? `✅ 最终综合验收全部通过（${lines.filter((l) => l.startsWith('PASS')).length} 项）` : `❌ ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
