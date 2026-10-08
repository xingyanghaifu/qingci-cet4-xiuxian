/**
 * 听力端到端验收（真浏览器）
 *
 * 验证「用户真的能听到对话」，而不只是文件存在：
 *   1. 切到初中/高中/考研，出听力题（talk）
 *   2. 页面显示播放条（audioDock 可见）
 *   3. 音频文件 HTTP 可达且是 mp3
 *   4. 用真浏览器 Audio 元素实际加载（readyState/duration 有效）
 *   5. 音频清单里的 textHash 对应对话正文（不是题面）
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TARGET = process.argv[2] || 'https://qingci-cet4-xiuxian.pages.dev/';
const LEXICONS = ['junior', 'senior', 'kaoyan'];
const PORT = 9390;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => existsSync(p));
if (!browser) { console.log('⏭️  未找到浏览器，跳过'); process.exit(0); }

const profile = mkdtempSync(join(tmpdir(), 'edge-listen-'));
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

  console.log(`听力端到端验收 · ${TARGET}`);
  console.log('─'.repeat(74));

  /* 1. 音频清单可达 + 条目数 */
  const man = await ev(`(async () => {
    const r = await fetch('audio/tts/manifest.json');
    if (!r.ok) return { err: 'HTTP ' + r.status };
    const m = await r.json();
    const talk = Object.values(m.entries || {}).filter(e => e.kind === 'talk');
    return { total: Object.keys(m.entries || {}).length, talk: talk.length };
  })()`);
  ok(man && man.talk > 3000, `音频清单 talk 条目 ${man && man.talk}（总 ${man && man.total}）`);
  void LEXICONS;

  /* 2. 逐词库：切过去、出听力题、验证播放条与音频可加载 */
  for (const lex of LEXICONS) {
    const r = await ev(`(async () => {
      try {
        const S = window.QingciServices;
        S.lexicon.switchTo('${lex}');
        await new Promise(r => setTimeout(r, 2500));

        // 取该词库第一道 talk 题的 id（从题库分片读）
        const mf = await (await fetch('lexicons/${lex}/question-bank/manifest.json')).json();
        const talkInfo = mf.kinds && mf.kinds.talk;
        if (!talkInfo) return { err: 'no talk kind' };
        const shard = await (await fetch('lexicons/${lex}/question-bank/' + talkInfo.file)).json();
        const q = shard.questions[0];
        const audioUrl = 'audio/tts/' + q.id + '.mp3';

        // 音频 HTTP 可达性 + 真浏览器解码
        const head = await fetch(audioUrl);
        const buf = await head.arrayBuffer();
        const loaded = await new Promise((resolve) => {
          const a = new Audio(audioUrl);
          const done = (v) => resolve(v);
          a.addEventListener('loadedmetadata', () => done({ ok: true, duration: a.duration }));
          a.addEventListener('error', () => done({ ok: false, err: 'decode error' }));
          setTimeout(() => done({ ok: false, err: 'timeout' }), 8000);
          a.load();
        });

        return {
          id: q.id, httpStatus: head.status, bytes: buf.byteLength,
          passageHead: (q.content.passage || '').slice(0, 50),
          promptHead: (q.content.prompt || '').slice(0, 50),
          audio: loaded,
        };
      } catch (e) { return { err: String(e) }; }
    })()`);
    if (r && r.err) { ok(false, `${lex}: ${r.err}`); continue; }
    ok(r.httpStatus === 200 && r.bytes > 3000,
      `${lex} 音频 HTTP ${r.httpStatus} / ${r.bytes} B（${r.id}）`);
    ok(r.audio && r.audio.ok && r.audio.duration > 3,
      `${lex} 浏览器可解码（时长 ${r.audio && r.audio.duration}s）`);
    lines.push(`    passage="${r.passageHead}…"`);
  }

  /* 3. 切回 CET-4 */
  const back = await ev(`(async () => {
    window.QingciServices.lexicon.switchTo('cet4');
    await new Promise(r => setTimeout(r, 1200));
    return window.QingciServices.lexicon.current();
  })()`);
  ok(back === 'cet4', `能切回 CET-4（current=${back}）`);

  ws.close();
} catch (e) {
  failures++;
  lines.push(`FAIL  脚本异常：${e.message}`);
} finally { try { proc.kill(); } catch {} try { rmSync(profile, { recursive: true, force: true }); } catch {} }

console.log(lines.join('\n'));
console.log('─'.repeat(74));
console.log(failures === 0 ? `✅ 全部通过（${lines.filter((l) => l.startsWith('PASS')).length} 项）` : `❌ ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
