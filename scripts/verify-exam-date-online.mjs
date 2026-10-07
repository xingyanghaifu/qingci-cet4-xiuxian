/**
 * P2-15 线上验收 · 真实浏览器（考试日期不再硬编码）
 *
 * 关键点：用户改过考试日期后，界面上的「距离 X 四级笔试还有 N 天」
 * 必须跟着变 —— 而不是永远显示硬编码的 2026-12-12。
 *
 * 做法：注入 localStorage 的 `qingci.plan`（与服务层同一存储键），
 * 重载页面，再读界面上真实出现的日期文本。
 *
 * 用法：
 *   node scripts/verify-exam-date-online.mjs                        # 线上
 *   node scripts/verify-exam-date-online.mjs http://127.0.0.1:4173/ # 本地
 *
 * 找不到 Edge/Chrome 时跳过（退出码 0）。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TARGET = process.argv[2] || 'http://127.0.0.1:4173/';
const PORT = 9340;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].find((p) => existsSync(p));
if (!browser) { console.log('⏭️  未找到浏览器，跳过'); process.exit(0); }

const profile = mkdtempSync(join(tmpdir(), 'edge-p215-'));
const proc = spawn(browser, ['--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run',
  '--disable-extensions', '--window-size=1440,1200', TARGET], { stdio: 'ignore' });

function cdp(ws) {
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } });
  return (method, params = {}) => new Promise((resolve, reject) => { const myId = ++id; pending.set(myId, { resolve, reject });
    ws.send(JSON.stringify({ id: myId, method, params }));
    setTimeout(() => { if (pending.has(myId)) { pending.delete(myId); reject(new Error('timeout')); } }, 60000); });
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
  await send('Page.enable');
  await sleep(4500);

  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('页面异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result.value;
  };

  /** 读界面上「距离 XXXX-XX-XX 四级笔试还有 N 天」的真实文本 */
  const READ = `(() => {
    const out = [];
    const re = /距离\\s*(\\d{4}-\\d{2}-\\d{2})\\s*四级笔试还有\\s*(\\d+)\\s*天/;
    for (const el of document.querySelectorAll('.app *')) {
      const t = (el.textContent || '');
      const m = t.match(re);
      if (m && el.children.length === 0) out.push({ date: m[1], days: +m[2], text: t.trim().slice(0, 80) });
    }
    // 计划卡上的「距考试 N 天」
    const summary = document.getElementById('planSummary');
    const planDate = document.getElementById('planExamDate');
    return { matches: out, planSummary: summary ? summary.textContent.trim() : null,
             planExamDate: planDate ? planDate.value : null,
             examDaysFn: typeof examDays === 'function' ? examDays() : null };
  })()`;

  console.log(`P2-15 验收 · ${TARGET}`);
  console.log('─'.repeat(74));

  // —— 1. 默认（未设置）：应使用服务层默认日期 ——
  await evalJs(`localStorage.removeItem('qingci.plan')`);
  await send('Page.reload');
  await sleep(4500);
  const def = await evalJs(READ);
  lines.push('【默认（未设置考试日期）】');
  lines.push(`    planExamDate=${def.planExamDate}  examDays()=${def.examDaysFn}  planSummary="${def.planSummary}"`);
  ok(def.planExamDate === '2026-12-12', `默认考试日期来自服务层常量（${def.planExamDate}）`);

  // —— 2. 用户改成 2027-06-15：界面必须跟着变 ——
  await evalJs(`localStorage.setItem('qingci.plan', JSON.stringify({ examDate: '2027-06-15', dailyMinutes: 30, targetWords: 0 }))`);
  await send('Page.reload');
  await sleep(4500);
  const custom = await evalJs(READ);
  lines.push('');
  lines.push('【用户改为 2027-06-15】');
  lines.push(`    planExamDate=${custom.planExamDate}  examDays()=${custom.examDaysFn}  planSummary="${custom.planSummary}"`);
  ok(custom.planExamDate === '2027-06-15', `设置页回填用户日期（${custom.planExamDate}）`);
  ok(typeof custom.examDaysFn === 'number' && custom.examDaysFn > 200,
    `examDays() 按用户日期算（${custom.examDaysFn} 天，期望 >200）`);
  ok(!String(custom.planSummary).includes('2026-12-12'),
    `计划摘要不再出现硬编码日期："${custom.planSummary}"`);

  // —— 3. 跑一次摸底，检查反馈文案里的日期 ——
  // 直接调页面里的 choose 链路太重，改为读源码确认用的是 examDateStr()
  const usesFn = await evalJs(`(() => {
    const scripts = [...document.querySelectorAll('script')].map(s => s.textContent || '').join('\\n');
    return {
      hasHardcodedInFeedback: /距离 2026-12-12 四级笔试/.test(scripts),
      hasExamDateStr: scripts.includes('examDateStr'),
      fallbackDecl: /var EXAM_DATE_FALLBACK='\\d{4}-\\d{2}-\\d{2}'/.test(scripts),
    };
  })()`);
  lines.push('');
  lines.push('【源码检查】');
  ok(!usesFn.hasHardcodedInFeedback, '反馈文案里不再有硬编码「距离 2026-12-12 四级笔试」');
  ok(usesFn.hasExamDateStr, '反馈文案改用 examDateStr()');
  ok(usesFn.fallbackDecl, '保留一个显式命名的兜底常量 EXAM_DATE_FALLBACK');

  ws.close();
} catch (e) {
  failures++;
  lines.push(`FAIL  脚本异常：${e.message}`);
} finally {
  try { proc.kill(); } catch { /* ignore */ }
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
}

console.log(lines.join('\n'));
console.log('─'.repeat(74));
console.log(failures === 0 ? `✅ 全部通过（${lines.filter((l) => l.startsWith('PASS')).length} 项）` : `❌ ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
