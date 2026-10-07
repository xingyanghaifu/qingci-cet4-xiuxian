/**
 * 线上无障碍验收 · 真实浏览器（P1-9 起）
 *
 * 为什么必须有这个脚本：本项目已经踩过「本地测试全绿、线上仍不对」的坑，
 * 而 <h1> 可访问名这类问题**静态正则根本测不出来** —— 它取决于
 * ① `:has()` 是否被支持、② switchTab 的运行时分支、③ 浏览器自己怎么算
 * accessible name。三者只有真浏览器能同时回答。
 *
 * 本脚本用 CDP 连真实 Chromium（Edge/Chrome 均可），做三件事：
 *   1. 无障碍树：逐个切模块，读 `<h1>` 的 **computed name**，
 *      确认它是当前模块名、且**不是** 9 个模块名连读。
 *   2. 降级分支：注入 `@supports not selector(:has(*))` 的等价 CSS
 *      （因为现代浏览器天然走不到那个分支），比对
 *      「computed display 可见的」与「aria-hidden=false 的」是否一致。
 *   3. 深链直达：`#/book` 等 hash 落地后，暴露的仍是唯一正确模块。
 *
 * 用法：
 *   node scripts/verify-a11y-online.mjs                          # 线上生产环境
 *   node scripts/verify-a11y-online.mjs http://127.0.0.1:8788/   # 本地/预览
 *
 * 依赖：本机装了 Edge 或 Chrome。找不到浏览器时**跳过**（退出码 0），
 * 不让 CI/离线环境因为缺浏览器而红 —— 但会明确打印「已跳过」。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TARGET = process.argv[2] || 'https://qingci-cet4-xiuxian.pages.dev/';
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 常见的 Chromium 安装位置（Windows 优先，兼顾 Linux/macOS） */
function findBrowser() {
  const cands = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ];
  return cands.find((p) => existsSync(p)) || null;
}

const MODULES = ['paper', 'words', 'single', 'speak', 'book', 'codex', 'map', 'duel', 'field'];
/** 修复前读屏会听到的连读串（P1-9 的靶子） */
const CONCAT = '试炼殿 背单词 单题 口语小径 心魔本 词谱 卷面与洞府 问道斗法 灵田';
/** 点哪个按钮 → 期望 <h1> 名字。按钮选择器用 data 属性，不依赖文案 */
const CLICK_CASES = [
  ['paper', null, '试炼殿'],
  ['words', '.tabs button[data-tab="trial"][data-mode="words"]', '背单词'],
  ['single', '.tabs button[data-tab="trial"]:not([data-mode])', '单题'],
  ['speak', '.tabs button[data-tab="speak"]', '口语小径'],
  ['book', '.tabs button[data-tab="book"]', '心魔本'],
  ['codex', '.tabs button[data-tab="codex"]', '词谱'],
  ['map', '.tabs button[data-tab="map"]', '卷面与洞府'],
  ['duel', '.tabs button[data-tab="duel"]', '问道斗法'],
  ['field', '.tabs button[data-tab="field"]', '灵田'],
];

function cdp(ws) {
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    }
  });
  return (method, params = {}) => new Promise((resolve, reject) => {
    const myId = ++id;
    pending.set(myId, { resolve, reject });
    ws.send(JSON.stringify({ id: myId, method, params }));
    setTimeout(() => {
      if (pending.has(myId)) { pending.delete(myId); reject(new Error('CDP 超时: ' + method)); }
    }, 30000);
  });
}

async function waitForPage() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const p = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (p) return p;
    } catch { /* 浏览器还没起来 */ }
    await sleep(500);
  }
  throw new Error('CDP 页面未就绪（浏览器启动失败？）');
}

const browser = findBrowser();
if (!browser) {
  console.log('⏭️  未找到 Edge / Chrome，跳过线上无障碍验收（不算失败）。');
  process.exit(0);
}

const profile = mkdtempSync(join(tmpdir(), 'qingci-a11y-'));
const proc = spawn(browser, [
  '--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--disable-extensions', '--disable-sync',
  TARGET,
], { stdio: 'ignore' });

let failures = 0;
const lines = [];
const ok = (pass, msg) => {
  if (!pass) failures++;
  lines.push(`${pass ? 'PASS' : 'FAIL'}  ${msg}`);
};

try {
  const page = await waitForPage();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', rej);
  });
  const send = cdp(ws);
  await send('Runtime.enable');
  await send('DOM.enable');
  await send('Accessibility.enable');

  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('页面内异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result.value;
  };

  /** #mainTitle 在无障碍树里的 computed name */
  async function axName() {
    const { root } = await send('DOM.getDocument', { depth: -1, pierce: true });
    const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '#mainTitle' });
    if (!nodeId) throw new Error('#mainTitle 未找到');
    const { nodes } = await send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false });
    const self = nodes.find((n) => n.role?.value === 'heading') || nodes[0];
    return {
      role: self?.role?.value ?? '(none)',
      name: self?.name?.value ?? '',
      ignored: !!self?.ignored,
      level: self?.properties?.find((p) => p.value?.value !== undefined && p.name === 'level')?.value?.value ?? null,
    };
  }

  /** 每个 .mt 的 aria-hidden 与 computed display */
  const SPAN_PROBE = `(() => [...document.querySelectorAll('#mainTitle .mt')].map(s => ({
    m: s.dataset.m, aria: s.getAttribute('aria-hidden'), disp: getComputedStyle(s).display,
  })))()`;

  console.log(`线上无障碍验收 · ${TARGET}`);
  console.log('─'.repeat(72));
  await sleep(4000);

  /* ── 1. 无障碍树 computed name ── */
  lines.push('【1】无障碍树：<h1> computed name 只应是当前模块');
  for (const [key, sel, expectName] of CLICK_CASES) {
    if (sel) {
      const clicked = await evalJs(`(() => { const b = document.querySelector(${JSON.stringify(sel)});
        if (!b) return false; b.click(); return true; })()`);
      if (!clicked) { ok(false, `${key.padEnd(7)} 按钮未找到: ${sel}`); continue; }
      await sleep(900);
    } else {
      // paper 没有专属按钮：显式回落到它，保证起点确定（而非依赖首屏 hash）
      await evalJs(`location.hash = '#/paper'`);
      await sleep(900);
    }
    const ax = await axName();
    ok(ax.name === expectName && !ax.ignored,
      `${key.padEnd(7)} role=${ax.role} h${ax.level} name="${ax.name}"（期望 "${expectName}"）`);
    if (ax.name.includes('  ') || ax.name === CONCAT) {
      ok(false, `${key.padEnd(7)} 仍是多个模块名连读：「${ax.name}」`);
    }
  }

  /* ── 2. 降级分支：可见 == 可读 ── */
  lines.push('');
  lines.push('【2】降级分支（模拟无 :has()）：可见的与可读的必须一致且各 1 个');
  await evalJs(`(() => {
    const s = document.createElement('style'); s.id = '__fallback_probe';
    s.textContent = '.mt{display:none !important} .mt[aria-hidden="false"]{display:inline !important}';
    document.head.appendChild(s); return true;
  })()`);
  await sleep(400);
  for (const [key, sel] of CLICK_CASES) {
    // paper 的 sel 是 null（它没有专属按钮，靠切回去）。
    // 上一节结束时停在 field，这里必须显式切回 paper，
    // 否则标签写 paper、实际量的是 field —— 断言仍会绿，但报告在骗人。
    if (sel) {
      await evalJs(`document.querySelector(${JSON.stringify(sel)}).click()`);
    } else {
      await evalJs(`location.hash = '#/paper'`);
    }
    await sleep(800);
    const rows = await evalJs(SPAN_PROBE);
    const visible = rows.filter((r) => r.disp !== 'none').map((r) => r.m);
    const exposed = rows.filter((r) => r.aria === 'false').map((r) => r.m);
    ok(visible.length === 1 && JSON.stringify(visible) === JSON.stringify(exposed)
      && visible[0] === key,
      `${key.padEnd(7)} 可见=[${visible}] 可读=[${exposed}]`);
  }

  /* ── 3. 深链直达 ── */
  lines.push('');
  lines.push('【3】深链直达：hash 落地后仍只暴露唯一正确模块');
  for (const m of ['book', 'map', 'duel', 'field']) {
    await evalJs(`location.hash = '#/${m}'`);
    await sleep(1200);
    const ax = await axName();
    const rows = await evalJs(SPAN_PROBE);
    const exposed = rows.filter((r) => r.aria === 'false').map((r) => r.m);
    ok(exposed.length === 1 && ax.name && !ax.name.includes('  '),
      `#/${m.padEnd(6)} 可读=[${exposed}] name="${ax.name}"`);
  }

  /* ── 4. 回归断言：修复前的连读串不得出现 ── */
  lines.push('');
  lines.push('【4】回归：修复前读屏会读到 9 个模块名连读');
  const axAll = await axName();
  ok(axAll.name !== CONCAT && !axAll.name.includes('  '),
    `当前 name="${axAll.name}"；修复前是「${CONCAT}」`);

  ws.close();
} catch (e) {
  failures++;
  lines.push(`FAIL  验收脚本异常：${e.message}`);
} finally {
  try { proc.kill(); } catch { /* ignore */ }
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
}

console.log(lines.join('\n'));
console.log('─'.repeat(72));
console.log(failures === 0 ? `✅ 全部通过（${lines.filter((l) => l.startsWith('PASS')).length} 项）`
  : `❌ ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
