/**
 * 压缩产物功能验收 · 真浏览器
 *
 * 为什么必须有这个脚本：
 * 本地 593 条测试断言的是**源文件**与部分产物字符串。而构建期会压缩内联脚本
 * （去注释 + 压空白 + 语法简化）。若压缩不小心破坏了跨块引用，
 * 症状是「页面能开、但点什么都没反应」—— 静态测试**看不出来**，
 * 因为模板源文件完全正常。
 *
 * 本脚本真跑一遍核心链路：导航 → 出题 → 答题 → 词谱 → 洞府。
 *
 * 用法：
 *   node scripts/verify-minified-runtime.mjs                        # 线上
 *   node scripts/verify-minified-runtime.mjs http://127.0.0.1:4173/ # 本地
 *
 * 注意：**必须用能服务全部资源的地址**。本地 `server.mjs` 不服务
 * `vocab-detail/`、`lexicons/`、`audio/`，所以词谱/听力相关的验收要跑线上。
 *
 * 找不到 Edge/Chrome 时跳过（退出码 0）。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TARGET = process.argv[2] || 'https://qingci-cet4-xiuxian.pages.dev/';
const PORT = 9360;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/microsoft-edge', '/usr/bin/google-chrome',
].find((p) => existsSync(p));
if (!browser) { console.log('⏭️  未找到 Edge/Chrome，跳过压缩产物验收（不算失败）。'); process.exit(0); }

const profile = mkdtempSync(join(tmpdir(), 'edge-min-'));
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
  await send('Page.enable');
  const errors = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text);
    }
  });
  await sleep(6000);

  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception || {}).description || r.exceptionDetails.text };
    return r.result.value;
  };

  console.log(`压缩产物功能验收 · ${TARGET}`);
  console.log('─'.repeat(74));

  /* 1. 全局函数是否都还在（压缩改名的直接症状） */
  // 注意：只列**确实定义在全局作用域**的函数。像 closeTopOverlay 定义在 IIFE 内部，
  // 本来就不是全局的 —— 把它列进来会得到假失败。
  const globals = await evalJs(`(() => {
    const names = ['switchTab','ask','show','save','renderTop','renderShelf','renderCodex','renderMap',
                   'startPaper','choose','toast','examDays','examDateStr','renderDuel','wordsOf'];
    const out = {};
    for (const n of names) out[n] = typeof window[n];
    return out;
  })()`);
  const missingFns = Object.entries(globals || {}).filter(([, t]) => t !== 'function').map(([n, t]) => `${n}:${t}`);
  ok(missingFns.length === 0, `15 个全局函数都在（缺: ${missingFns.join(', ') || '无'}）`);

  /* 2. 服务层是否就绪 */
  const svc = await evalJs(`({
    has: !!window.QingciServices,
    keys: window.QingciServices ? Object.keys(window.QingciServices).length : 0,
  })`);
  ok(svc && svc.has && svc.keys > 10, `服务层就绪（${svc ? svc.keys : 0} 个命名空间）`);

  /* 3. 词库加载 */
  const words = await evalJs(`(typeof WORDS !== 'undefined') ? WORDS.length : null`);
  ok(words === 4540, `词库 4540 条（实际 ${words}）`);

  /* 4. 核心答题链路（走 UI 按钮，不直接调内部函数） */
  const flow = await evalJs(`(async () => {
    const log = [];
    try {
      // 用「背单词」按钮：它带 data-mode="words"，点击处理器会 switchTab + ask()
      // （「单题」按钮只切面板不出题 —— 那是既有设计，不是缺陷）
      const wordsBtn = document.querySelector('.tabs button[data-tab="trial"][data-mode="words"]');
      if (!wordsBtn) return { ok: false, err: '找不到背单词按钮', log };
      wordsBtn.click(); log.push('点「背单词」');
      let prompt = '', btns = [];
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 400));
        prompt = (document.getElementById('prompt').textContent || '').trim();
        btns = [...document.querySelectorAll('#choices button')];
        if (prompt && btns.length >= 2) break;
      }
      log.push('题面="' + prompt.slice(0, 20) + '"(' + prompt.length + ' 字)');
      log.push('选项数=' + btns.length);
      if (!prompt || btns.length < 2) return { ok: false, err: '出题失败（题面或选项为空）', log };
      btns[0].click(); log.push('点第一个选项');
      await new Promise(r => setTimeout(r, 900));
      const fb = (document.getElementById('feedback').textContent || '').trim();
      log.push('反馈=' + fb.length + ' 字');
      return { ok: true, log };
    } catch (e) { return { ok: false, err: String(e), log }; }
  })()`);
  ok(flow && flow.ok, `核心答题链路可跑${flow && flow.ok ? '' : '（' + (flow && (flow.err || '未知')) + '）'}`);
  lines.push('    流程: ' + (flow && flow.log ? flow.log.join(' → ') : '(无)'));

  /* 4b. 词谱搜索 + 点词条（覆盖 renderCodex 的 $("q") 链路） */
  const codexFlow = await evalJs(`(async () => {
    try {
      switchTab('codex');
      await new Promise(r => setTimeout(r, 800));
      const list = document.getElementById('codexList');
      const entries = list ? list.querySelectorAll('.entry') : [];
      if (!entries.length) return { ok: false, err: '词谱列表为空' };
      entries[0].click();
      await new Promise(r => setTimeout(r, 900));
      const overlay = document.getElementById('vdOverlay');
      return { ok: true, entries: entries.length,
               overlayOpened: overlay ? !overlay.classList.contains('hidden') : false };
    } catch (e) { return { ok: false, err: String(e) }; }
  })()`);
  ok(codexFlow && codexFlow.ok,
    `词谱渲染并可点词条（${codexFlow && codexFlow.ok ? codexFlow.entries + ' 条，详解浮层=' + codexFlow.overlayOpened : codexFlow && codexFlow.err}）`);

  /* 5. 洞府页渲染（游戏性所在） */
  const mapFlow = await evalJs(`(async () => {
    try {
      switchTab('map');
      await new Promise(r => setTimeout(r, 800));
      return {
        panelVisible: !document.getElementById('panel-map').classList.contains('hidden'),
        mapTable: (document.getElementById('mapTable').innerHTML || '').length,
        realmCard: (document.getElementById('realmCard') || {}).innerHTML ? (document.getElementById('realmCard').innerHTML.length) : 0,
      };
    } catch (e) { return { err: String(e) }; }
  })()`);
  ok(mapFlow && mapFlow.panelVisible && mapFlow.mapTable > 100,
    `洞府页渲染正常（卷面表 ${mapFlow ? mapFlow.mapTable : 0} 字符，境界卡 ${mapFlow ? mapFlow.realmCard : 0} 字符）`);

  /* 6. 表单控件真的存在（标签顺序 bug 的运行时防线） */
  const controls = await evalJs(`(() => {
    const ids = ['q','letter','mastery','essay','spellInput','memKindSel','dao','pool','groupNick','groupCode','feedbackDesc','speakNote'];
    const missing = ids.filter(id => !document.getElementById(id));
    return { total: ids.length, missing };
  })()`);
  ok(controls && controls.missing.length === 0,
    `12 个表单控件在 DOM 里都存在（缺: ${controls ? controls.missing.join(', ') || '无' : 'n/a'}）`);

  /* 7. 无 JS 运行时异常 */
  ok(errors.length === 0, `无未捕获异常（${errors.length} 个${errors.length ? ': ' + errors[0].slice(0, 120) : ''}）`);

  ws.close();
} catch (e) {
  failures++;
  lines.push(`FAIL  脚本异常：${e.message}`);
} finally { try { proc.kill(); } catch {} try { rmSync(profile, { recursive: true, force: true }); } catch {} }

console.log(lines.join('\n'));
console.log('─'.repeat(74));
console.log(failures === 0 ? `✅ 全部通过（${lines.filter((l) => l.startsWith('PASS')).length} 项）` : `❌ ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
