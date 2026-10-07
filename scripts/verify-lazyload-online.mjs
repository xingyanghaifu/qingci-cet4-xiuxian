/**
 * P2-11 验收：首屏不再加载 audio/tts/manifest.json（256 KB / 908 ms）。
 * 同时确认：
 *   · 听力题出现时才加载
 *   · 加载后「真实音频」按钮能真正播放（warmTts 被调用 → pickTtsSrc 不再恒 null）
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 9352;
const TARGET = process.argv[2] || 'http://127.0.0.1:4173/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => existsSync(p));
if (!browser) { console.log('skip'); process.exit(0); }

const profile = mkdtempSync(join(tmpdir(), 'edge-p211v-'));
const proc = spawn(browser, ['--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run',
  '--disable-extensions', TARGET], { stdio: 'ignore' });

function cdp(ws) {
  let id = 0; const pending = new Map(); const events = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method) events.push(m);
    if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); }
  });
  return {
    send: (method, params = {}) => new Promise((resolve, reject) => { const myId = ++id; pending.set(myId, { resolve, reject });
      ws.send(JSON.stringify({ id: myId, method, params }));
      setTimeout(() => { if (pending.has(myId)) { pending.delete(myId); reject(new Error('timeout: ' + method)); } }, 90000); }),
    events,
  };
}

let failures = 0;
const lines = [];
const ok = (pass, msg) => { if (!pass) failures++; lines.push(`${pass ? 'PASS' : 'FAIL'}  ${msg}`); };

try {
  let page;
  for (let i = 0; i < 60; i++) {
    try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      page = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl); if (page) break; } catch {}
    await sleep(500);
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const { send, events } = cdp(ws);
  await send('Runtime.enable');
  await send('Network.enable');
  await sleep(7000);

  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: JSON.stringify(r.exceptionDetails).slice(0, 250) };
    return r.result.value;
  };

  console.log(`P2-11 验收 · ${TARGET}`);
  console.log('─'.repeat(72));

  const resOf = async () => evalJs(`performance.getEntriesByType('resource').map(r => ({
    n: r.name.split('/').slice(-2).join('/'), t: Math.round(r.transferSize||0), d: Math.round(r.duration)
  }))`);

  // —— 1. 首屏不应有 tts/manifest.json ——
  const first = await resOf();
  const ttsOnFirst = first.find((r) => r.n.includes('tts/manifest'));
  const nav = await evalJs(`(() => { const n = performance.getEntriesByType('navigation')[0] || {};
    return { transfer: Math.round(n.transferSize||0), decoded: Math.round(n.decodedBodySize||0) }; })()`);
  lines.push(`【首屏】文档 ${(nav.transfer / 1024).toFixed(1)} KB（解压 ${(nav.decoded / 1024).toFixed(0)} KB）`);
  lines.push(`  资源: ${first.map((r) => r.n + ' ' + (r.t / 1024).toFixed(0) + 'KB').join(' | ') || '(无)'}`);
  const firstTotal = first.reduce((s, r) => s + r.t, 0);
  lines.push(`  首屏资源合计 ${(firstTotal / 1024).toFixed(1)} KB`);
  ok(!ttsOnFirst, `首屏不再请求 audio/tts/manifest.json（此前 256 KB / 908ms）`);

  // —— 2. 打开听力题（切换到 trial 并触发 show 一个带 speak 的题） ——
  const dockBefore = await evalJs(`(() => { const d = document.getElementById('audioDock');
    return { hidden: d.classList.contains('hidden') }; })()`);
  lines.push('');
  lines.push(`【打开听力题前】#audioDock hidden=${dockBefore.hidden}`);

  // 直接切到 trial 并强制显示 audioDock（模拟出现听力题）
  const shown = await evalJs(`(() => {
    const d = document.getElementById('audioDock');
    if (!d) return 'no dock';
    d.classList.remove('hidden');
    return 'shown';
  })()`);
  await sleep(6000);
  const after = await resOf();
  const ttsAfter = after.find((r) => r.n.includes('tts/manifest'));
  lines.push(`【显示 audioDock 后】(${shown}) tts/manifest: ${ttsAfter ? (ttsAfter.t / 1024).toFixed(0) + ' KB / ' + ttsAfter.d + 'ms' : '未请求'}`);
  ok(!!ttsAfter, '显示听力面板后才加载 tts 清单（按需加载生效）');

  // —— 3. 按钮可见性 + pickTtsSrc 是否真的能取到（warmTts 修复） ——
  const btnState = await evalJs(`(() => {
    const b = document.getElementById('realAudioBtn');
    return { hidden: b ? b.classList.contains('hidden') : null, text: b ? b.textContent.trim() : null };
  })()`);
  lines.push('');
  lines.push(`【真实音频按钮】hidden=${btnState.hidden}`);
  ok(btnState.hidden === false, '清单加载成功后「真实音频」按钮可见');

  // warmTts 是否让 pickTtsSrc 能返回非 null（拿一个真实存在的 questionId）
  const pick = await evalJs(`(async () => {
    const S = window.QingciServices;
    const m = await S.audioSources.loadTts();
    if (!m || !m.entries) return { err: 'no manifest entries' };
    const ids = Object.keys(m.entries);
    if (!ids.length) return { err: 'entries empty' };
    await S.audioSources.warmTts();
    const src = S.audioSources.pickTtsSrc(ids[0]);
    const sync = S.audioSources.ttsEntrySync(ids[0]);
    return { sampleId: ids[0], src, hasSync: !!sync, count: m.count };
  })()`);
  lines.push(`【pickTtsSrc 链路】${JSON.stringify(pick)}`);
  ok(pick && pick.src && pick.src.includes('.mp3'),
    `warmTts() 后 pickTtsSrc 能取到 mp3（此前 ttsSync 恒 null → 按钮点了没反应）`);
  ok(pick && pick.hasSync === true, 'ttsEntrySync 也能取到条目（同步查询链路打通）');

  ws.close();
} catch (e) {
  failures++;
  lines.push(`FAIL  脚本异常：${e.message}`);
} finally { try { proc.kill(); } catch {} try { rmSync(profile, { recursive: true, force: true }); } catch {} }

console.log(lines.join('\n'));
console.log('─'.repeat(72));
console.log(failures === 0 ? `✅ 全部通过（${lines.filter((l) => l.startsWith('PASS')).length} 项）` : `❌ ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
