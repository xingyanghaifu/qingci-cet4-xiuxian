/**
 * 词库端到端验收（通用，真浏览器）
 *
 * 用法：node scripts/verify-lexicon-online.mjs <lexiconId> [target]
 *   node scripts/verify-lexicon-online.mjs ielts
 *   node scripts/verify-lexicon-online.mjs toefl https://...
 *
 * 逐项验收（对应任务「九、每批完成后」的线上验收清单）：
 *   1. /lexicons/manifest.json 含该词库
 *   2. /lexicons/<id>/vocab-detail/a.json 返回 200
 *   3. /lexicons/<id>/question-bank/manifest.json 返回 200
 *   4. 首页 HTML 含该词库入口
 *   5. role="tab" 仍为 9
 *   6. 真浏览器：切到该词库能出题、能切回 CET-4
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LEX = process.argv[2] || 'ielts';
const TARGET = process.argv[3] || 'https://qingci-cet4-xiuxian.pages.dev/';
const PORT = 9385;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => existsSync(p));
if (!browser) { console.log('⏭️  未找到浏览器，跳过'); process.exit(0); }

const profile = mkdtempSync(join(tmpdir(), `edge-lx-${LEX}-`));
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

  console.log(`词库端到端验收 · ${LEX} · ${TARGET}`);
  console.log('─'.repeat(74));

  /* 1-3. 静态资源（含分片） */
  const assets = await ev(`(async () => {
    const out = {};
    const urls = [
      'lexicons/manifest.json',
      'lexicons/${LEX}/vocab-detail/manifest.json',
      'lexicons/${LEX}/question-bank/manifest.json',
      'lexicons/${LEX}/wordlist.json',
    ];
    for (const u of urls) {
      try { const r = await fetch(u); out[u] = r.status; } catch (e) { out[u] = 'ERR'; }
    }
    // 按 manifest 取第一个真实分片
    try {
      const d = await (await fetch('lexicons/${LEX}/vocab-detail/manifest.json')).json();
      const first = Object.values(d.files || {})[0];
      if (first) { const r = await fetch('lexicons/${LEX}/vocab-detail/' + first); out['shard:' + first] = r.status; }
    } catch (e) { out['shard'] = 'ERR'; }
    return out;
  })()`);
  for (const [u, s] of Object.entries(assets || {})) ok(s === 200, `${u} → ${s}`);

  /* 4. 清单含该词库且 enabled */
  const mf = await ev(`(async () => {
    const m = await (await fetch('lexicons/manifest.json')).json();
    const l = m.lexicons.find(x => x.id === '${LEX}');
    return l ? { id: l.id, wordCount: l.wordCount, enabled: l.enabled, dataPath: l.dataPath } : null;
  })()`);
  ok(mf && mf.enabled && mf.wordCount > 0, `清单含 ${LEX}（${mf ? mf.wordCount + ' 词' : '缺失'}）`);

  /* 5. 首页入口 + role=tab 计数 */
  const domCheck = await ev(`(() => {
    const tabs = document.querySelectorAll('[role="tab"]').length;
    const sel = document.getElementById('examSelect');
    const hasOpt = sel ? [...sel.options].some(o => o.value === '${LEX}') : false;
    return { tabs, hasOpt };
  })()`);
  ok(domCheck && domCheck.tabs === 9, `role="tab" 仍为 9（实际 ${domCheck && domCheck.tabs}）`);
  ok(domCheck && domCheck.hasOpt, `备考考试下拉含 ${LEX}`);

  /* 6. 真浏览器切到该词库并出题 */
  const play = await ev(`(async () => {
    try {
      const S = window.QingciServices;
      if (!S || !S.lexicon) return { err: 'no lexicon svc' };
      S.lexicon.switchTo('${LEX}');
      await new Promise(r => setTimeout(r, 3000));
      const cur = S.lexicon.current();
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
  ok(play && play.current === LEX, `已切到 ${LEX}（current=${play && play.current}）`);
  ok(play && play.prompt && play.choices >= 2,
    `${LEX} 能出题（"${play && String(play.prompt).slice(0, 20)}" ${play && play.choices} 选项）`);

  /* 7. 切回 CET-4 */
  const back = await ev(`(async () => {
    const S = window.QingciServices;
    S.lexicon.switchTo('cet4');
    await new Promise(r => setTimeout(r, 1500));
    return { current: S.lexicon.current() };
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
