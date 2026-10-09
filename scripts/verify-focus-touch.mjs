#!/usr/bin/env node
/**
 * 键盘可达性 + 触控目标验收（真浏览器）
 *
 * ── 为什么需要真浏览器 ──
 * 第九轮发现两类问题**单元测试测不到**：
 *
 *  1. **焦点可见性**：`:focus-visible` 只对**键盘**交互生效 ——
 *     程序化 `.focus()` 不会触发它。必须用 CDP 发真实 Tab 按键才能测。
 *     （我第一版脚本用 `.focus()`，误报「所有 tab 按钮都没有焦点环」。）
 *  2. **触控目标尺寸**：备份提醒的「稍后再说」按钮是 `<button>` 但被当文字链接排版，
 *     移动端实测只有 **56×20** —— 连 WCAG 2.2 AA 的 24×24 都不满足。
 *     功能测试测不出来（能点、事件也触发），只有量 `getBoundingClientRect()` 才知道。
 *
 * ── 检查项 ──
 *  · 用真实 Tab 遍历，逐个确认焦点元素有可见焦点环（排除 Tab 越过末尾后落回 body 的正常情况）
 *  · 本轮新增控件（#rootGo / #bhSnooze）可 Tab 到
 *  · 窄屏（375px）下新控件触控高度 >= 44px
 *
 * 用法：node scripts/verify-focus-touch.mjs [线上URL]
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ⚠️ 本文件位于 scripts/ 下，仓库根目录要**上跳一级** ——
// 否则 dist/index.html 会被解析成 scripts/dist/index.html（ENOENT）。
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = join(ROOT, 'dist');
const PORT = 4164, CDP = 9475;
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
const profile = mkdtempSync(join(tmpdir(), 'edge-tab-'));
const proc = spawn(bp, ['--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, '--no-first-run',
  '--disable-extensions', '--window-size=1440,1000',
  `http://127.0.0.1:${PORT}/`], { stdio: 'ignore' });

function cdp(ws) {
  let id = 0; const pend = new Map();
  ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { const { resolve, reject } = pend.get(m.id); pend.delete(m.id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); } });
  return (method, params = {}) => new Promise((resolve, reject) => {
    const i = ++id; pend.set(i, { resolve, reject });
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => { if (pend.has(i)) { pend.delete(i); reject(new Error('timeout ' + method)); } }, 40000);
  });
}

let fail = 0;
const ok = (c, m) => { if (!c) fail++; console.log((c ? 'PASS  ' : 'FAIL  ') + m); };

try {
  let page;
  for (let i = 0; i < 100; i++) {
    try { const l = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
      // 同 verify-gameplay-integration：必须排除浏览器内部页（edge://sync-... 等），
  // 否则会连到空白内部页 → 所有断言取不到元素（假失败）。
  page = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl
    && t.url && !/^(edge|chrome|about|devtools):/.test(t.url)
    && t.url.includes('127.0.0.1')); if (page) break; } catch {}
    await sleep(500);
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const send = cdp(ws);
  await send('Runtime.enable');
  await sleep(9000);
  const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception || {}).description || r.exceptionDetails.text }; return r.result.value; };

  await ev(`(() => {
    state.memStats = { spell:{r:20,n:20}, zh2en:{r:10,n:20}, listen:{r:5,n:20} }; save();
    var d={}; for (var i=0;i<8;i++) d['2026-10-0'+(i+1)]={right:5,wrong:1};
    state.days=d; save(); localStorage.removeItem('qingci.backupMeta');
    if (window.renderDashboard) renderDashboard();
    if (window.__renderBackupHint) window.__renderBackupHint();
    var b=document.querySelector('.tabs button[data-tab="map"]'); if(b) b.click();
    document.body.focus();
    return 1;
  })()`);
  await sleep(1500);

  // 真实 Tab 遍历：逐个记录焦点元素与计算样式
  // 注意要 Tab 足够多次 —— 页面可达控件上百个，只 Tab 40 次会到不了侧栏里的新控件
  const seen = new Map();
  for (let i = 0; i < 260; i++) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
    await sleep(35);
    const info = await ev(`(() => {
      var e = document.activeElement; if (!e) return null;
      var cs = getComputedStyle(e);
      return { id: e.id || '', cls: String(e.className||'').slice(0,24), tag: e.tagName,
        txt: (e.textContent||'').trim().slice(0,8),
        isBody: e === document.body || e === document.documentElement,
        matchesFV: e.matches(':focus-visible'),
        outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth, outlineColor: cs.outlineColor,
        boxShadow: cs.boxShadow };
    })()`);
    if (!info) continue;
    // Tab 越过最后一个可聚焦元素后，焦点会落回 body/document ——
    // 那是浏览器的正常行为，**不是**「控件缺焦点环」，排除掉。
    if (info.isBody) continue;
    const key = info.id || info.cls || info.tag + ':' + info.txt;
    if (seen.has(key)) continue;
    seen.set(key, info);
  }

  console.log('══ 真实 Tab 遍历：焦点可见性 ══');
  const rows = [...seen.values()];
  for (const f of rows) {
    const ring = (f.outlineStyle !== 'none' && parseFloat(f.outlineWidth) > 0)
      || (f.boxShadow && f.boxShadow !== 'none');
    console.log(`  ${(f.id || f.cls || f.tag).padEnd(22)} fv=${f.matchesFV ? 'Y' : 'n'} ring=${ring ? '✅' : '❌'}  ${f.outlineStyle} ${f.outlineWidth} ${f.outlineColor}`);
  }
  const noRing = rows.filter((f) => !((f.outlineStyle !== 'none' && parseFloat(f.outlineWidth) > 0) || (f.boxShadow && f.boxShadow !== 'none')));
  console.log('');
  ok(rows.length >= 8, `Tab 能到达 ${rows.length} 个不同元素`);
  ok(noRing.length === 0, noRing.length ? `无焦点环的元素：${noRing.map((f) => f.id || f.cls).join(', ')}` : '所有可达元素都有可见焦点环');

  // 后加控件必须可 Tab 到且可见环
  const ids = rows.map((f) => f.id);
  ok(ids.includes('rootGo'), '灵根「去练」按钮可 Tab 到');
  ok(ids.includes('bhSnooze'), '备份提醒「稍后再说」可 Tab 到');

  console.log('\n══ 移动端触控高度（375px）══');
  await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 667, deviceScaleFactor: 2, mobile: true });
  await sleep(1200);
  const tap = await ev(`(() => {
    var out=[];
    ['rootGo','bhSnooze','exportBtn','importBtn','resetBtn'].forEach(function(id){
      var e=document.getElementById(id); if(!e) return;
      var r=e.getBoundingClientRect();
      out.push({ id:id, w:Math.round(r.width), h:Math.round(r.height) });
    });
    return out;
  })()`);
  for (const t of tap) {
    console.log(`  ${t.id.padEnd(12)} ${t.w}×${t.h} ${t.h >= 44 ? '✅' : '⚠️ <44px'}`);
  }
  const small = tap.filter((t) => t.h < 44);
  ok(small.length === 0, small.length ? `触控高度不足 44px：${small.map((t) => t.id + '(' + t.h + ')').join(', ')}` : '新控件触控高度均 ≥44px');

  await send('Emulation.clearDeviceMetricsOverride');
  console.log('─'.repeat(56));
  console.log(fail === 0 ? '✅ 焦点与触控验收通过' : `❌ ${fail} 项失败`);
  ws.close();
} catch (e) { console.log('ERR', e.message); fail++; }
finally { try { proc.kill(); } catch {} try { server.close(); } catch {} try { rmSync(profile, { recursive: true, force: true }); } catch {} }
process.exit(fail === 0 ? 0 : 1);
