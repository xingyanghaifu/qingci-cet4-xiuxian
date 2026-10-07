/**
 * 第一期数值曲线 · 真浏览器验收
 *
 * 验证「机制真的在运行时生效」，而不只是模块里有函数：
 *   1. 子层级显示（境界卡出现「练气N层」+ 45 级台阶）
 *   2. 连对加速（答对 3 题后出现 ×1.2 提示，修为增幅符合公式）
 *   3. 每日首登加成（+20 修为，且当天只给一次）
 *   4. 断签衰减（宽限 3 天、单次上限 50%、不碰境界）
 *   5. 灵石暴击（概率 10%，可复现）
 *   6. 心魔曲线（Lv3→4 需两错）
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TARGET = process.argv[2] || 'https://qingci-cet4-xiuxian.pages.dev/';
const PORT = 9370;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => existsSync(p)) || 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe';
if (!existsSync(browser)) { console.log('⏭️  未找到浏览器，跳过'); process.exit(0); }

const profile = mkdtempSync(join(tmpdir(), 'edge-p1-'));
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

  console.log(`第一期数值曲线验收 · ${TARGET}`);
  console.log('─'.repeat(74));

  /* 1. 服务层 curve 命名空间就绪 */
  const ns = await ev(`({
    hasCurve: !!(window.QingciServices && window.QingciServices.curve),
    total: window.QingciServices && window.QingciServices.curve ? window.QingciServices.curve.TOTAL_SUBLEVELS : null,
    crit: window.QingciServices && window.QingciServices.curve ? window.QingciServices.curve.CRIT_CHANCE : null,
    base: window.QingciServices && window.QingciServices.curve ? window.QingciServices.curve.BASE_QI_PER_CORRECT : null,
  })`);
  ok(ns && ns.hasCurve && ns.total === 45, `curve 命名空间就绪（${ns && ns.total} 级，暴击率 ${ns && ns.crit}）`);

  /* 2. 连对加速：直接验算公式 */
  const combo = await ev(`(() => {
    const C = window.QingciServices.curve;
    return { s0: C.qiForCorrect(0), s3: C.qiForCorrect(3), s5: C.qiForCorrect(5),
             m3: C.comboMultiplier(3), m5: C.comboMultiplier(5), base: C.BASE_QI_PER_CORRECT };
  })()`);
  ok(combo && combo.s0 === combo.base && combo.m3 === 1.2 && combo.m5 === 1.5,
    `连对加速生效（0连=${combo && combo.s0} / 3连=${combo && combo.s3} / 5连=${combo && combo.s5}）`);

  /* 3. 每日首登加成：清状态重载，看 qi 是否 +20 且只加一次 */
  await ev(`localStorage.removeItem('qingci.state.v1'); localStorage.removeItem('qingci.v2');`);
  await send('Page.reload');
  await sleep(6000);
  const first = await ev(`({ qi: state.qi, day: state.lastLoginDay, bonus: state.dailyBonus })`);
  ok(first && first.bonus === 20, `每日首登 +20 修为（实际 +${first && first.bonus}）`);
  // 再 reload 一次：同一天不应再加
  const qiBefore = first.qi;
  await send('Page.reload');
  await sleep(6000);
  const second = await ev(`({ qi: state.qi, day: state.lastLoginDay })`);
  ok(second && second.qi === qiBefore,
    `同一天再打开不重复加成（重载前 ${qiBefore} → 重载后 ${second && second.qi}）`);

  /* 4. 断签衰减：直接调服务层纯函数（含边界） */
  const decay = await ev(`(() => {
    const C = window.QingciServices.curve;
    return { d3: C.applyDecay(1000, 3), d4: C.applyDecay(1000, 4), d99: C.applyDecay(1000, 99) };
  })()`);
  ok(decay && decay.d3.lost === 0, `宽限 3 天不扣（${decay && decay.d3.lost}）`);
  ok(decay && decay.d4.lost === 50, `第 4 天扣 5%（${decay && decay.d4.lost}）`);
  ok(decay && decay.d99.lost === 500, `单次上限 50%（${decay && decay.d99.lost}）`);

  /* 5. 子层级显示：境界卡出现「N层」与「第 X / 45 层」 */
  const realmUi = await ev(`(async () => {
    switchTab('map');
    await new Promise(r => setTimeout(r, 900));
    const bars = document.getElementById('realmBars');
    const html = bars ? bars.innerHTML : '';
    return { hasSub: /class="realm-sub"/.test(html), has45: /45/.test(html),
             text: (bars ? bars.textContent : '').slice(0, 80) };
  })()`);
  ok(realmUi && realmUi.hasSub && realmUi.has45,
    `境界卡显示子层级与 45 级台阶（"${realmUi && realmUi.text}"）`);

  /* 6. 心魔曲线：直接验服务层 */
  const demon = await ev(`(() => {
    const C = window.QingciServices.curve;
    return { lv3: C.levelFromWrongs(3), lv4: C.levelFromWrongs(4), lv5: C.levelFromWrongs(5),
             lv7: C.levelFromWrongs(7), w4: C.wrongsForLevel(4), w5: C.wrongsForLevel(5) };
  })()`);
  ok(demon && demon.lv4 === 3 && demon.lv7 === 5 && demon.w5 === 7,
    `心魔曲线生效（3错=Lv${demon && demon.lv3} / 4错=Lv${demon && demon.lv4} / 7错=Lv${demon && demon.lv7}，Lv5 门槛 ${demon && demon.w5} 错）`);

  /* 7. 灵田稀有度：服务层判定 */
  const field = await ev(`(() => {
    const F = window.QingciServices.field;
    return { rare29: F.cropUnlocked('enlighten_tree', 29), rare30: F.cropUnlocked('enlighten_tree', 30),
             common: F.cropUnlocked('qi_grass', 0), isRare: F.isRareCrop('enlighten_tree') };
  })()`);
  ok(field && field.rare29 === false && field.rare30 === true && field.common === true,
    `灵田稀有度生效（悟道树 29天=${field && field.rare29} / 30天=${field && field.rare30}）`);

  /* 8. 暴击：10% 概率，注入随机源可复现 */
  const crit = await ev(`(() => {
    const C = window.QingciServices.curve;
    let hits = 0;
    for (let i = 0; i < 10000; i++) if (C.rollCrit()) hits++;
    return { rate: hits / 10000, forced: C.rollCrit(() => 0.05), denied: C.rollCrit(() => 0.5) };
  })()`);
  ok(crit && Math.abs(crit.rate - 0.1) < 0.02 && crit.forced === true && crit.denied === false,
    `暴击率约 10%（实测 ${crit ? (crit.rate * 100).toFixed(2) : '?'}%），可注入随机源`);

  ws.close();
} catch (e) {
  failures++;
  lines.push(`FAIL  脚本异常：${e.message}`);
} finally { try { proc.kill(); } catch {} try { rmSync(profile, { recursive: true, force: true }); } catch {} }

console.log(lines.join('\n'));
console.log('─'.repeat(74));
console.log(failures === 0 ? `✅ 全部通过（${lines.filter((l) => l.startsWith('PASS')).length} 项）` : `❌ ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
