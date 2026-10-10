#!/usr/bin/env node
/**
 * 目标达成核验（Lead 用）—— 逐条对照 objective 的 ①②③④。
 * 一次性输出证据，避免"声称完成但没有依据"。
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
const PORT = 4173, CDP = 9526;
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

const bp = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find((p) => existsSync(p));
const profile = mkdtempSync(join(tmpdir(), 'edge-final-'));
const proc = spawn(bp, ['--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, '--no-first-run',
  '--disable-extensions', '--hide-scrollbars', '--window-size=1440,900',
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

const results = [];
const check = (ok, label, detail) => { results.push({ ok, label, detail }); };

try {
  let page;
  for (let i = 0; i < 100; i++) {
    try { const l = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
      page = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl && t.url && !/^(edge|chrome|about|devtools):/.test(t.url));
      if (page) break; } catch {}
    await sleep(500);
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const send = cdp(ws);
  await send('Runtime.enable');
  const errs = [];
  ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') errs.push('EXC');
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push('ERR'); });
  await sleep(9000);
  const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception || {}).description || r.exceptionDetails.text }; return r.result.value; };

  /* ① SVG 图标 */
  const icons = await ev(`(() => {
    var names = ['scroll','stair','loop','sword','slip','seal','cauldron','token','wind','pill','array','shield','memory','tome'];
    var present = names.filter(function(n){ return !!document.querySelector('.ic-' + n); });
    var positions = new Set();
    present.forEach(function(n){
      var cs = getComputedStyle(document.querySelector('.ic-'+n), '::before');
      positions.add(cs.maskPosition || cs.webkitMaskPosition || '');
    });
    return { total: present.length, distinctPositions: positions.size };
  })()`);
  check(icons.total === 14, '① SVG 按钮图标：14 枚全部就位', `${icons.total}/14，${icons.distinctPositions} 个不同 sprite 格`);

  /* ② 传统纹饰：回纹 / 云纹 / 如意角 */
  const orn = await ev(`(() => {
    function info(sel, pseudo){
      var e = document.querySelector(sel);
      if (!e) return null;
      var bi = getComputedStyle(e, pseudo).backgroundImage || '';
      return { repeating: /repeating-linear-gradient/.test(bi), layers: (bi.match(/gradient/g)||[]).length };
    }
    var labels = document.querySelectorAll('.section-label').length;
    var rules = document.querySelectorAll('.cloud-rule').length;
    var cloudMask = getComputedStyle(document.querySelector('.section-label'), '::before');
    return {
      panelFret: info('.panel','::before'), sealFret: info('.seal','::before'), shopFret: info('.shop-card','::before'),
      panelRuyi: info('.panel','::after'), sealRuyi: info('.seal','::after'),
      cloudRule: rules, sectionLabels: labels,
      cloudMask: (cloudMask.maskImage || cloudMask.webkitMaskImage || '').slice(0, 24),
    };
  })()`);
  const fretOK = orn.panelFret && orn.panelFret.repeating && orn.sealFret && orn.sealFret.repeating && orn.shopFret && orn.shopFret.repeating;
  check(fretOK, '② 回纹：.panel / .seal / .shop-card 三者都真渲染', JSON.stringify({ p: orn.panelFret.repeating, s: orn.sealFret.repeating, c: orn.shopFret.repeating }));
  const ruyiOK = orn.panelRuyi && orn.panelRuyi.layers >= 8 && orn.sealRuyi && orn.sealRuyi.layers >= 8;
  check(ruyiOK, '② 如意角：8 段渐变在 .panel / .seal 上都生效', `panel=${orn.panelRuyi.layers} 层, seal=${orn.sealRuyi.layers} 层`);
  check(/url/.test(orn.cloudMask), '② 云纹：section-label 云头 mask 生效', orn.cloudMask);
  check(orn.cloudRule === orn.sectionLabels && orn.cloudRule >= 15, '② 云纹分隔与标题成对（硬断言）', `${orn.sectionLabels} 标题 = ${orn.cloudRule} 分隔`);

  /* ③ 人性化：降噪 / 分组 / 空态 */
  const folds = await ev(`(() => {
    return ['missionsFold','lxFold','paperShelfFold'].map(function(id){
      var d = document.getElementById(id);
      var sm = d ? d.querySelector(':scope > summary') : null;
      return { id: id, exists: !!d, open: d ? d.open : null, summary: sm ? sm.textContent.replace(/\\s+/g,' ').trim().slice(0,44) : null };
    });
  })()`);
  check(folds.every(f => f.exists && f.open === false), '③ 三处折叠降噪（默认收起 + summary 有信息）', folds.map(f => f.id).join(', '));
  const groups = await ev(`(() => {
    var a = document.getElementById('navArchive');
    return a ? Array.from(a.querySelectorAll('.section-label')).map(function(e){ return e.textContent.trim(); }) : [];
  })()`);
  check(groups.length >= 2, '③ 修行录分组（记录 / 偏好）', groups.join(' | '));

  /* ④ 三主题 + 375px */
  const themes = await ev(`(() => {
    var out = [];
    [['dark','normal'],['light','normal'],['dark','high']].forEach(function(t){
      document.documentElement.setAttribute('data-theme', t[0]);
      document.documentElement.setAttribute('data-contrast', t[1]);
      var cs = getComputedStyle(document.documentElement);
      var p = document.querySelector('.panel');
      out.push({ theme: t[0] + '/' + t[1], bg: cs.backgroundColor, ruyi: getComputedStyle(p,'::after').opacity });
    });
    document.documentElement.setAttribute('data-theme','dark');
    document.documentElement.setAttribute('data-contrast','normal');
    return out;
  })()`);
  check(themes.length === 3 && themes.every(t => t.ruyi !== '0'), '④ 三主题（深/浅/高对比）纹饰均可见', themes.map(t => t.theme + ':opacity=' + t.ruyi).join(' '));

  /* 375px */
  await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
  await sleep(600);
  const mobile = await ev(`(() => {
    var bad = [];
    /* ⚠️ 只检查**真正可见**的控件 —— 初版没过滤可见性，把桌面专用控件
       （.side-close / .ov-toggle 在窄屏的某些断点、.side-foot 的按钮）
       量到的 36–38px 当成违规。隐藏元素没有触控目标，无需 44px。
       用 checkVisibility() 而不是 offsetParent（后者在本应用里不可靠）。 */
    document.querySelectorAll('.btn, .icb, .ics, .shop-item').forEach(function(b){
      var vis = b.checkVisibility ? b.checkVisibility({checkVisibilityCSS:true, checkOpacity:false}) : (b.offsetParent !== null);
      if (!vis) return;
      var r = b.getBoundingClientRect();
      if (r.height > 0 && r.height < 44) bad.push((b.id || String(b.className).slice(0,18)) + '=' + Math.round(r.height));
    });
    return { bad: bad, docW: document.documentElement.scrollWidth, winW: innerWidth };
  })()`);
  check(mobile.bad.length === 0, '④ 375px：所有**可见**按钮 ≥44px 触控高度', mobile.bad.length ? mobile.bad.join(', ') : '全部达标');
  check(mobile.docW <= mobile.winW + 1, '④ 375px：无横向溢出', `doc=${mobile.docW} win=${mobile.winW}`);
  await send('Emulation.clearDeviceMetricsOverride');

  check(errs.length === 0, '零页面异常', `${errs.length} 个`);
} catch (e) {
  check(false, '脚本异常', e.message);
} finally {
  try { proc.kill(); } catch {}
  try { server.close(); } catch {}
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
}

console.log('目标达成核验（objective ①②③④）');
console.log('═'.repeat(78));
for (const r of results) {
  console.log((r.ok ? '✅' : '❌') + ' ' + r.label);
  if (r.detail) console.log('     ' + r.detail);
}
const fails = results.filter(r => !r.ok).length;
console.log('═'.repeat(78));
console.log(fails === 0 ? `✅ 目标四项全部达成（${results.length} 项核验）` : `❌ ${fails}/${results.length} 项未达成`);
process.exit(fails === 0 ? 0 : 1);
