#!/usr/bin/env node
/**
 * 界面「混乱度」量化审计（`npm run audit:ui`）
 *
 * ── 为什么需要这个脚本 ──
 * 用户反馈「界面很混乱」。但「混乱」是主观感受 —— 子代理报告「更清晰了」
 * 无法验证。本脚本把混乱度拆成**可测量的指标**，让每批次改动的效果
 * 有前/后对照的数字，而不是形容词。
 *
 * 指标（越低越好）：
 *   · 首屏可点击元素数   —— 选择过载
 *   · 首屏可见边框组数   —— 视觉噪声
 *   · 首屏不同字号档位数 —— 排版混乱
 *   · 首屏主按钮数       —— 主次不分（.btn.solid 应 ≤ 2）
 *   · 文案问题数         —— undefined / [object Object]
 *
 * 用法：
 *   node scripts/audit-ui.mjs                    # 人工可读报告
 *   node scripts/audit-ui.mjs --json             # 机器可读
 *   node scripts/audit-ui.mjs --save=before      # 存基线（backups/ui-baseline/）
 *   node scripts/audit-ui.mjs --compare=before   # 与基线对比
 *
 * ── 实现上的三个坑（都踩过，已规避）──
 *   1. 不要把注入页面的代码写在**模板字符串**里 —— `\[` 会退化成 `[`，
 *      正则在页面里变成字符类，匹配一切（曾报出 16 处假的「文案问题」）。
 *      本脚本用 `String(fn)` 序列化独立函数注入，并改用 indexOf，彻底绕开。
 *   2. 不能用 `offsetParent` 判可见 —— 本应用里它对所有面板都返回 null，
 *      会让统计全为 0。改用「rect 有尺寸 + 祖先非 display:none/visibility:hidden」。
 *   3. 汇总时不能对**数组**做数值求和 —— `0 + []` 会变成字符串 "[object Object]"。
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = join(ROOT, 'dist');
const BASELINE_DIR = join(ROOT, 'backups', 'ui-baseline');
const PORT = 4188, CDP = 9510;
const AS_JSON = process.argv.includes('--json');
const SAVE = (process.argv.find((a) => a.startsWith('--save=')) || '').split('=')[1] || '';
const COMPARE = (process.argv.find((a) => a.startsWith('--compare=')) || '').split('=')[1] || '';
const PANELS = ['paper', 'trial', 'speak', 'book', 'codex', 'map', 'field', 'duel', 'missions'];

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('❌ 未找到 dist/index.html —— 先跑 npm run build');
  process.exit(1);
}

/* ───────────────────────── 页面内度量函数 ─────────────────────────
   独立函数体，用 String(fn) 注入 —— 避免模板字符串转义陷阱。 */
function measureInPage(arg) {
  var p = document.getElementById(arg.panelId);
  if (!p) return { missing: true };

  /* 确定性显示：先全隐，只显示目标面板；测完恢复（不留副作用）。
     不依赖 switchTab 的时序。 */
  var saved = {};
  arg.panels.forEach(function (n) {
    var el = document.getElementById('panel-' + n);
    if (el) { saved[n] = el.classList.contains('hidden'); el.classList.add('hidden'); }
  });
  p.classList.remove('hidden');

  function restore() {
    arg.panels.forEach(function (n) {
      var el = document.getElementById('panel-' + n);
      if (el && saved[n] !== undefined) el.classList.toggle('hidden', saved[n]);
    });
  }

  /* 可见性：rect 有尺寸 + 自身与祖先都不是 display:none / visibility:hidden
     ⚠️ 不能用 offsetParent —— 本应用里对所有面板都返回 null */
  function shown(e) {
    var q = e;
    while (q && q.nodeType === 1) {
      var cs = getComputedStyle(q);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      q = q.parentElement;
    }
    return true;
  }
  var vh = arg.viewportH, vw = innerWidth;
  function visible(e) {
    if (!e || !shown(e)) return false;
    var r = e.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    return r.top < vh && r.bottom > 0 && r.left < vw && r.right > 0;
  }

  var all = Array.prototype.slice.call(p.querySelectorAll('*'));
  var vis = all.filter(visible);

  var clickable = vis.filter(function (e) {
    return /^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(e.tagName)
      || e.getAttribute('role') === 'button' || e.getAttribute('role') === 'tab'
      || e.hasAttribute('data-buy') || e.hasAttribute('data-item');
  });

  /* 可见边框组：去重到「最外层带边框元素」 */
  var bordered = vis.filter(function (e) {
    var cs = getComputedStyle(e);
    if (cs.borderStyle === 'none') return false;
    var w = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderLeftWidth)
          + parseFloat(cs.borderBottomWidth) + parseFloat(cs.borderRightWidth);
    return w > 0;
  });
  var groups = [];
  bordered.forEach(function (e) {
    for (var i = 0; i < groups.length; i++) {
      if (groups[i].contains(e)) return;
    }
    groups = groups.filter(function (g) { return !e.contains(g); });
    groups.push(e);
  });

  var fonts = {}, gaps = {}, pads = {};
  var solidButtons = 0;
  clickable.forEach(function (e) {
    var cs = getComputedStyle(e);
    fonts[cs.fontSize] = 1;
    if (e.classList.contains('btn') && e.classList.contains('solid')) solidButtons++;
  });
  vis.forEach(function (e) {
    var cs = getComputedStyle(e);
    if (cs.gap && cs.gap !== 'normal' && cs.gap !== '0px') gaps[cs.gap] = 1;
    if (cs.padding && cs.padding !== '0px') pads[cs.padding] = 1;
  });

  /* 文案问题：只扫可见元素的**直属文本节点**；用 indexOf 避开正则转义 */
  var NEEDLES = ['undefined', '[object Object]'];
  var issues = [];
  vis.forEach(function (e) {
    for (var n = e.firstChild; n; n = n.nextSibling) {
      if (n.nodeType !== 3) continue;
      var t = String(n.nodeValue || '');
      if (!t.trim()) continue;
      NEEDLES.forEach(function (needle) {
        if (t.indexOf(needle) >= 0) {
          var tag = needle + '|' + t.trim().slice(0, 30);
          if (issues.indexOf(tag) < 0) issues.push(tag);
        }
      });
    }
  });

  var diag = { display: getComputedStyle(p).display };
  var r0 = p.getBoundingClientRect();
  diag.rect = { w: Math.round(r0.width), h: Math.round(r0.height) };

  restore();
  return {
    diag: diag,
    clickable: clickable.length,
    borders: groups.length,
    fontSizes: Object.keys(fonts).length,
    fontList: Object.keys(fonts).sort(),
    solidButtons: solidButtons,
    gapValues: Object.keys(gaps).length,
    paddingValues: Object.keys(pads).length,
    textIssues: issues,
    domNodes: all.length
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const f = join(DIST, p);
  if (!existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(200, { 'Content-Type': MIME['.html'] });
    return res.end(fs.readFileSync(join(DIST, 'index.html')));
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  res.end(fs.readFileSync(f));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const bp = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find((p) => existsSync(p));
if (!bp) {
  console.log('⏭️  未找到浏览器，跳过界面审计');
  try { server.close(); } catch { /* 忽略 */ }
  process.exit(0);
}

const profile = mkdtempSync(join(tmpdir(), 'edge-audit-'));
const proc = spawn(bp, ['--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, '--no-first-run',
  '--disable-extensions', '--hide-scrollbars', '--window-size=1440,900',
  `http://127.0.0.1:${PORT}/`], { stdio: 'ignore' });

function cdp(ws) {
  let id = 0; const pend = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) {
      const { resolve, reject } = pend.get(m.id); pend.delete(m.id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    }
  });
  return (method, params = {}) => new Promise((resolve, reject) => {
    const i = ++id; pend.set(i, { resolve, reject });
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => { if (pend.has(i)) { pend.delete(i); reject(new Error('timeout ' + method)); } }, 40000);
  });
}

const result = { panels: {}, totals: {}, version: 1 };

try {
  let page;
  for (let i = 0; i < 100; i++) {
    try {
      const l = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
      page = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl
        && t.url && !/^(edge|chrome|about|devtools):/.test(t.url));
      if (page) break;
    } catch { /* 等浏览器起来 */ }
    await sleep(500);
  }
  if (!page) throw new Error('CDP 未就绪');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const send = cdp(ws);
  await send('Runtime.enable');
  const pageErrors = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') pageErrors.push('EXC');
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') pageErrors.push('ERR');
  });
  await sleep(9000);

  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      return { __err: (r.exceptionDetails.exception || {}).description || r.exceptionDetails.text };
    }
    return r.result.value;
  };

  const vh = await ev('innerHeight');

  for (const name of PANELS) {
    const arg = { panelId: 'panel-' + name, panels: PANELS, viewportH: vh };
    result.panels[name] = await ev(`(${String(measureInPage)})(${JSON.stringify(arg)})`);
    await sleep(120);
  }

  const vals = Object.values(result.panels).filter((v) => v && !v.missing && !v.__err);
  const max = (k) => (vals.length ? Math.max(...vals.map((v) => Number(v[k]) || 0)) : 0);
  result.totals = {
    panelCount: vals.length,
    maxClickable: max('clickable'),
    maxBorders: max('borders'),
    maxFontSizes: max('fontSizes'),
    maxSolidButtons: max('solidButtons'),
    sumClickable: vals.reduce((a, v) => a + (Number(v.clickable) || 0), 0),
    sumTextIssues: vals.reduce((a, v) => a + ((v.textIssues && v.textIssues.length) || 0), 0),
    pageErrors: pageErrors.length
  };
  result.score = {
    clickable: result.totals.maxClickable,
    borders: result.totals.maxBorders,
    fontSizes: result.totals.maxFontSizes,
    solidButtons: result.totals.maxSolidButtons,
    noise: result.totals.maxBorders * 2 + result.totals.maxFontSizes
  };

  if (SAVE) {
    fs.mkdirSync(BASELINE_DIR, { recursive: true });
    fs.writeFileSync(join(BASELINE_DIR, SAVE + '.json'), JSON.stringify(result, null, 2), 'utf8');
  }

  if (AS_JSON) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('界面「混乱度」审计 · 各面板首屏指标');
    console.log('─'.repeat(84));
    console.log('面板'.padEnd(12) + '可点击'.padEnd(9) + '边框组'.padEnd(9) + '字号'.padEnd(7)
      + '主按钮'.padEnd(9) + 'DOM'.padEnd(8) + '文案问题');
    for (const [k, v] of Object.entries(result.panels)) {
      if (!v || v.missing) { console.log(k.padEnd(12) + '(缺失)'); continue; }
      if (v.__err) { console.log(k.padEnd(12) + 'ERR ' + String(v.__err).slice(0, 48)); continue; }
      console.log(k.padEnd(12)
        + String(v.clickable).padEnd(9)
        + String(v.borders).padEnd(9)
        + String(v.fontSizes).padEnd(7)
        + String(v.solidButtons).padEnd(9)
        + String(v.domNodes).padEnd(8)
        + (v.textIssues && v.textIssues.length ? v.textIssues.join(' / ') : '—'));
    }
    console.log('─'.repeat(84));
    console.log(`最差屏：可点击 ${result.totals.maxClickable} · 边框组 ${result.totals.maxBorders}`
      + ` · 字号 ${result.totals.maxFontSizes} · 主按钮 ${result.totals.maxSolidButtons}`);
    console.log(`混乱度评分 noise = ${result.score.noise}（边框×2 + 字号，越低越好）`);
    console.log(`页面错误：${result.totals.pageErrors}`);
    if (SAVE) console.log(`已保存基线：backups/ui-baseline/${SAVE}.json`);

    const warn = [];
    if (result.totals.maxClickable > 12) warn.push(`可点击 ${result.totals.maxClickable} > 12（选择过载）`);
    if (result.totals.maxBorders > 5) warn.push(`边框组 ${result.totals.maxBorders} > 5（视觉噪声）`);
    if (result.totals.maxFontSizes > 8) warn.push(`字号 ${result.totals.maxFontSizes} > 8（排版混乱）`);
    if (result.totals.maxSolidButtons > 2) warn.push(`主按钮 ${result.totals.maxSolidButtons} > 2（主次不分）`);
    if (result.totals.sumTextIssues > 0) warn.push(`文案问题 ${result.totals.sumTextIssues} 处`);
    if (warn.length) {
      console.log('\n⚠️  未达商业级阈值：');
      warn.forEach((w) => console.log('   · ' + w));
    } else {
      console.log('\n✅ 全部指标达到商业级阈值');
    }

    if (COMPARE) {
      const baseFile = join(BASELINE_DIR, COMPARE + '.json');
      if (existsSync(baseFile)) {
        const base = JSON.parse(fs.readFileSync(baseFile, 'utf8'));
        console.log(`\n与基线「${COMPARE}」对比：`);
        console.log('─'.repeat(84));
        for (const [label, key] of [['可点击', 'maxClickable'], ['边框组', 'maxBorders'],
          ['字号', 'maxFontSizes'], ['主按钮', 'maxSolidButtons'], ['文案问题', 'sumTextIssues']]) {
          const b = base.totals[key], a = result.totals[key];
          const delta = a - b;
          const arrow = delta < 0 ? '↓ 改善' : delta > 0 ? '↑ 变差' : '= 持平';
          console.log(`  ${label.padEnd(10)}${String(b).padStart(4)} → ${String(a).padStart(4)}   ${delta >= 0 ? '+' : ''}${delta}  ${arrow}`);
        }
        console.log(`  ${'noise'.padEnd(10)}${String(base.score.noise).padStart(4)} → ${String(result.score.noise).padStart(4)}   ${result.score.noise - base.score.noise >= 0 ? '+' : ''}${result.score.noise - base.score.noise}`);
      } else {
        console.log(`\n（未找到基线 ${COMPARE}.json，跳过对比）`);
      }
    }
  }

  ws.close();
} catch (e) {
  console.error('ERR', e.message);
  process.exitCode = 1;
} finally {
  try { proc.kill(); } catch { /* 忽略 */ }
  try { server.close(); } catch { /* 忽略 */ }
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* 忽略 */ }
}
