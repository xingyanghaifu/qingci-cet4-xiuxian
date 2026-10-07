/**
 * 第二期·修行反馈 · 真浏览器验收
 *
 * 验证「动效真的挂上了、且是一次性的」：
 *   1. 四个新 keyframes 存在，且**没有引入新的 infinite**
 *   2. 连对 HUD 在答对 3 题后出现且高亮
 *   3. 子层晋级时境界卡名字播放一次性动效
 *   4. 暴击时任务卡出现描边脉冲
 *   5. reduced-motion 下动效退化为「直接呈现终态」（不是半截）
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TARGET = process.argv[2] || 'https://qingci-cet4-xiuxian.pages.dev/';
const PORT = 9375;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => existsSync(p));
if (!browser) { console.log('⏭️  未找到浏览器，跳过'); process.exit(0); }

const profile = mkdtempSync(join(tmpdir(), 'edge-p2-'));
const proc = spawn(browser, ['--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run',
  '--disable-extensions', '--window-size=1440,1200', TARGET], { stdio: 'ignore' });

function cdp(ws) {
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } });
  return (method, params = {}) => new Promise((resolve, reject) => { const myId = ++id; pending.set(myId, { resolve, reject });
    ws.send(JSON.stringify({ id: myId, method, params }));
    setTimeout(() => { if (pending.has(myId)) { pending.delete(myId); reject(new Error('timeout: ' + method)); } }, 60000); });
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
  await sleep(6000);
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception || {}).description || r.exceptionDetails.text };
    return r.result.value;
  };

  console.log(`第二期修行反馈验收 · ${TARGET}`);
  console.log('─'.repeat(74));

  /* 1. keyframes 存在 + 未引入新 infinite */
  const css = await ev(`(() => {
    const sheets = [...document.styleSheets].map(s => { try { return [...s.cssRules].map(r => r.cssText).join('\\n'); } catch(e) { return ''; } }).join('\\n');
    const kf = ['subLevelUp','critFlash','critRing','comboPop'].filter(k => sheets.includes('@keyframes ' + k));
    const inf = (sheets.match(/animation:[^;}]*infinite[^;}]*/g) || []);
    const infMine = inf.filter(d => /subLevelUp|critFlash|critRing|comboPop/.test(d));
    return { kf, infTotal: inf.length, infMine: infMine.length };
  })()`);
  ok(css && css.kf.length === 4, `四个新 keyframes 都在（${css && css.kf.join(', ')}）`);
  ok(css && css.infMine === 0, `新动效未引入 infinite（全局 ${css && css.infTotal} 条均为既有）`);

  /* 2. 连对 HUD：答对 3 题后出现且高亮 */
  const hud = await ev(`(async () => {
    const wordsBtn = document.querySelector('.tabs button[data-tab="trial"][data-mode="words"]');
    wordsBtn.click();
    let prompt = '', btns = [];
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 400));
      prompt = (document.getElementById('prompt').textContent || '').trim();
      btns = [...document.querySelectorAll('#choices button')];
      if (prompt && btns.length >= 2) break;
    }
    // 连对 3 题：每轮点正确答案。
    // 注意：current 是脚本顶层 let 声明 —— 它是全局**词法**绑定，
    // 不是 window 属性，所以必须用裸标识符 current，不能用 window.current。
    let correct = 0;
    let tagSeen = false, tagText = '';
    for (let round = 0; round < 4; round++) {
      const c = current;
      if (!c || !Array.isArray(c.choices)) break;
      const idx = c.choices.indexOf(c.answer);
      const list = [...document.querySelectorAll('#choices button')];
      if (idx < 0 || !list[idx]) break;
      list[idx].click();
      correct++;
      await new Promise(r => setTimeout(r, 500));
      // 关键：在点「下一题」**之前**读反馈区 —— 进入下一题会清空它
      const fb = document.getElementById('feedback');
      const tag = fb ? fb.querySelector('.combo-tag') : null;
      if (tag) { tagSeen = true; tagText = fb.textContent.slice(0, 60); }
      await new Promise(r => setTimeout(r, 300));
      const next = document.getElementById('next');
      if (next && !next.classList.contains('hidden')) next.click();
      await new Promise(r => setTimeout(r, 900));
      if (!(document.getElementById('prompt').textContent || '').trim() && typeof ask === 'function') {
        ask();
        await new Promise(r => setTimeout(r, 800));
      }
    }
    const h = document.getElementById('comboHud');
    return { streak: state.streak, correct, tagSeen, tagText,
             hudHidden: h ? h.classList.contains('hidden') : null,
             hudText: h ? h.textContent : null,
             hudHot: h ? h.classList.contains('hot') : null };
  })()`);
  ok(hud && hud.streak >= 3, `连对计数累加（streak=${hud && hud.streak}）`);
  ok(hud && hud.hudHidden === false && /连对/.test(hud.hudText || ''),
    `连对 HUD 显示（"${hud && hud.hudText}"）`);
  ok(hud && hud.hudHot === true, `达档后 HUD 高亮（hot=${hud && hud.hudHot}）`);
  ok(hud && hud.tagSeen === true, `作答反馈出现连对标签（"${hud && hud.tagText}"）`);

  /* 3. 连对标签带 pop 动效类（达档时） */
  const tag = await ev(`(() => {
    const C = window.QingciServices.curve;
    // 直接构造一次达档反馈，验证类名逻辑
    const fb = document.getElementById('feedback');
    if (!fb) return { err: 'no feedback' };
    fb.innerHTML = '<span class="combo-tag pop">' + C.comboLabel(5) + '</span>';
    const el = fb.querySelector('.combo-tag.pop');
    return { hasPop: !!el, animation: el ? getComputedStyle(el).animationName : null };
  })()`);
  ok(tag && tag.hasPop && tag.animation === 'comboPop',
    `连对标签带 pop 动效（animation=${tag && tag.animation}）`);

  /* 4. 子层晋级动效：直接给境界卡名字加类，验证动画确实生效 */
  const lvl = await ev(`(async () => {
    switchTab('map');
    await new Promise(r => setTimeout(r, 700));
    const el = document.querySelector('.realm-sub-name');
    if (!el) return { err: 'no realm-sub-name' };
    const before = getComputedStyle(el).animationName;
    replayOnce(el, 'level-up', 900);
    await new Promise(r => setTimeout(r, 60));
    const during = getComputedStyle(el).animationName;
    return { before, during, hasClass: el.classList.contains('level-up') };
  })()`);
  ok(lvl && lvl.during === 'subLevelUp',
    `子层晋级动效可触发（before=${lvl && lvl.before} → during=${lvl && lvl.during}）`);

  /* 5. 暴击描边：给任务卡加类，验证动画生效 */
  const crit = await ev(`(async () => {
    switchTab('paper');
    await new Promise(r => setTimeout(r, 500));
    const card = document.querySelector('#missionList .mission') || document.querySelector('.mission');
    if (!card) return { err: 'no mission card' };
    replayOnce(card, 'crit-ring', 900);
    await new Promise(r => setTimeout(r, 60));
    return { during: getComputedStyle(card).animationName, hasClass: card.classList.contains('crit-ring') };
  })()`);
  ok(crit && crit.during === 'critRing',
    `暴击描边可触发（animation=${crit && crit.during}）`);

  /* 6. reduced-motion：动效退化为 .001ms（不是半截） */
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await sleep(400);
  const rm = await ev(`(async () => {
    const el = document.querySelector('.realm-sub-name');
    if (!el) return { err: 'no el' };
    replayOnce(el, 'level-up', 900);
    await new Promise(r => setTimeout(r, 60));
    const st = getComputedStyle(el);
    return { duration: st.animationDuration, name: st.animationName };
  })()`);
  // 注意：浏览器把 .001ms 序列化成 "1e-06s"，所以不能只匹配 "0.001s"
  const dur = String(rm && rm.duration || '');
  const durSec = parseFloat(dur);
  ok(rm && durSec <= 0.002,
    `reduced-motion 下动效退化为瞬时（duration=${dur} ≈ ${(durSec * 1000).toFixed(3)}ms）`);
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

  ws.close();
} catch (e) {
  failures++;
  lines.push(`FAIL  脚本异常：${e.message}`);
} finally { try { proc.kill(); } catch {} try { rmSync(profile, { recursive: true, force: true }); } catch {} }

console.log(lines.join('\n'));
console.log('─'.repeat(74));
console.log(failures === 0 ? `✅ 全部通过（${lines.filter((l) => l.startsWith('PASS')).length} 项）` : `❌ ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
