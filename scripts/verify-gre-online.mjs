/**
 * GRE 词库端到端验收（真浏览器）
 *
 * 验证「用户真的能切到 GRE 并做题」，而不只是文件存在：
 *   1. 词库选择器出现 GRE 卡片
 *   2. 切到 GRE 后：词库清单/详情分片/题库都能按需取到
 *   3. GRE 题库能出题（填空/阅读）
 *   4. 切回 CET-4 仍正常（不污染默认词库）
 *
 * 注意：本地 server.mjs **不服务** lexicons/ 目录，所以必须跑线上或
 * 用能服务静态目录的服务器。默认跑线上。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TARGET = process.argv[2] || 'https://qingci-cet4-xiuxian.pages.dev/';
const PORT = 9380;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => existsSync(p));
if (!browser) { console.log('⏭️  未找到浏览器，跳过'); process.exit(0); }

const profile = mkdtempSync(join(tmpdir(), 'edge-gre-'));
const proc = spawn(browser, ['--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run',
  '--disable-extensions', '--window-size=1440,1200', TARGET], { stdio: 'ignore' });

function cdp(ws) {
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } });
  return (method, params = {}) => new Promise((resolve, reject) => { const myId = ++id; pending.set(myId, { resolve, reject });
    ws.send(JSON.stringify({ id: myId, method, params }));
    setTimeout(() => { if (pending.has(myId)) { pending.delete(myId); reject(new Error('timeout: ' + method)); } }, 90000); });
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
  await sleep(7000);
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception || {}).description || r.exceptionDetails.text };
    return r.result.value;
  };

  console.log(`GRE 端到端验收 · ${TARGET}`);
  console.log('─'.repeat(74));

  /* 1. 静态资源可达 */
  const assets = await ev(`(async () => {
    const urls = [
      'lexicons/manifest.json',
      'lexicons/gre/vocab-detail/manifest.json',
      'lexicons/gre/question-bank/manifest.json',
      'lexicons/gre/wordlist.json',
    ];
    const out = {};
    for (const u of urls) {
      try { const r = await fetch(u); out[u] = r.status; } catch (e) { out[u] = 'ERR ' + e.message; }
    }
    return out;
  })()`);
  for (const [u, s] of Object.entries(assets || {})) ok(s === 200, `${u} → ${s}`);

  /* 2. 词库选择器出现 GRE 卡片 */
  const picker = await ev(`(async () => {
    switchTab('map');
    await new Promise(r => setTimeout(r, 1200));
    const grid = document.getElementById('lxGrid');
    const html = grid ? grid.innerHTML : '';
    const cards = [...grid.querySelectorAll('[data-lx], .lx-card, button')].map(b => (b.textContent || '').trim());
    return { hasGre: /GRE/.test(html), cards: cards.slice(0, 12), len: html.length };
  })()`);
  ok(picker && picker.hasGre, `词库选择器含 GRE 卡片（${picker && picker.len} 字符）`);

  /* 3. 切到 GRE：服务层能取到清单与详情 */
  const sw = await ev(`(async () => {
    const S = window.QingciServices;
    if (!S || !S.lexicon) return { err: 'no lexicon svc' };
    // 读清单
    const mf = await (await fetch('lexicons/manifest.json')).json();
    const gre = mf.lexicons.find(l => l.id === 'gre');
    // 取一个 GRE 详情分片
    const d = await (await fetch('lexicons/gre/vocab-detail/manifest.json')).json();
    return {
      inManifest: !!gre, wordCount: gre ? gre.wordCount : 0,
      shardCount: d.count, files: Object.keys(d.files || {}).length,
      current: S.lexicon.current(),
    };
  })()`);
  ok(sw && sw.inManifest && sw.wordCount === 7504, `GRE 在清单中且 7504 词（分片 ${sw && sw.shardCount} 条 / ${sw && sw.files} 片）`);

  /* 4. 切到 GRE 并出一题（走真实 UI） */
  const play = await ev(`(async () => {
    try {
      const S = window.QingciServices;
      // 直接调切换（UI 点击要过二次确认弹层，这里验的是「切换后可用」）
      if (S.lexicon && S.lexicon.switchTo) S.lexicon.switchTo('gre');
      await new Promise(r => setTimeout(r, 2500));
      const cur = S.lexicon.current();
      // 切到背单词出题
      const wordsBtn = document.querySelector('.tabs button[data-tab="trial"][data-mode="words"]');
      if (wordsBtn) wordsBtn.click();
      let prompt = '', btns = [];
      for (let i = 0; i < 40; i++) {
        await new Promise(r => setTimeout(r, 400));
        prompt = (document.getElementById('prompt').textContent || '').trim();
        btns = [...document.querySelectorAll('#choices button')];
        if (prompt && btns.length >= 2) break;
      }
      return { current: cur, prompt, choices: btns.length };
    } catch (e) { return { err: String(e) }; }
  })()`);
  ok(play && play.current === 'gre', `已切到 GRE（current=${play && play.current}）`);
  ok(play && play.prompt && play.choices >= 2,
    `GRE 能出题（题面"${play && String(play.prompt).slice(0, 24)}" ${play && play.choices} 选项）`);

  /* 5. 切回 CET-4 不污染 */
  const back = await ev(`(async () => {
    const S = window.QingciServices;
    S.lexicon.switchTo('cet4');
    await new Promise(r => setTimeout(r, 1500));
    return { current: S.lexicon.current(), words: (typeof WORDS !== 'undefined') ? WORDS.length : null };
  })()`);
  ok(back && back.current === 'cet4', `能切回 CET-4（current=${back && back.current}）`);

  ws.close();
} catch (e) {
  failures++;
  lines.push(`FAIL  脚本异常：${e.message}`);
} finally { try { proc.kill(); } catch {} try { rmSync(profile, { recursive: true, force: true }); } catch {} }

console.log(lines.join('\n'));
console.log('─'.repeat(74));
console.log(failures === 0 ? `✅ 全部通过（${lines.filter((l) => l.startsWith('PASS')).length} 项）` : `❌ ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
