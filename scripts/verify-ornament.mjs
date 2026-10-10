#!/usr/bin/env node
/**
 * v1.15 纹样体系验收（`npm run verify:ornament`）
 *
 * 用户反馈「纹路太单一了，背景也单一」→ 本脚本量化验收纹样体系。
 *
 * ── 传统纹样的两个层次（这是本次设计的核心）──
 *   · **地纹**：满铺、极淡，提供织物感（万字纹 / 菱格纹 / 龟背纹）
 *   · **边饰**：描边、清晰，界定边界（回纹 / 云纹 / 如意纹）
 *   之前只有边饰、没有地纹 → 所以「单一」。
 *
 * ── 判据 ──
 *   ① 纹样种类 ≥5（不同 SVG 图形）
 *   ② body 背景 ≥4 层（地纹 + 原有渐变）
 *   ③ .panel 有地纹
 *   ④ 如意角 = 四角 SVG mask
 *   ⑤ 深/浅主题地纹可见；**高对比主题地纹必须为 0**（装饰伤对比度）
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
const PORT = 4159, CDP = 9544;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

if (!existsSync(join(DIST, 'index.html'))) { console.error('❌ 先跑 npm run build'); process.exit(1); }

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
if (!bp) { console.log('⏭️  未找到浏览器，跳过'); try { server.close(); } catch { /* 忽略 */ } process.exit(0); }

const profile = mkdtempSync(join(tmpdir(), 'edge-orn-'));
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

let fail = 0;
const ok = (c, m) => { if (!c) fail++; console.log((c ? 'PASS  ' : 'FAIL  ') + m); };

try {
  let page;
  for (let i = 0; i < 100; i++) {
    try { const l = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
      page = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl && t.url && !/^(edge|chrome|about|devtools):/.test(t.url));
      if (page) break; } catch { /* 等浏览器 */ }
    await sleep(500);
  }
  if (!page) throw new Error('CDP 未就绪');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const send = cdp(ws);
  await send('Runtime.enable');
  const errs = [];
  ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') errs.push('EXC');
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push('ERR'); });
  await sleep(9000);
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception || {}).description || r.exceptionDetails.text };
    return r.result.value;
  };

  /* 用 String(fn) 注入独立函数 —— 避免模板字符串转义陷阱 */
  const inv = await ev(`(${String(function () {
    var shapes = new Set();
    var rules = [];
    for (var i = 0; i < document.styleSheets.length; i++) {
      var ss = document.styleSheets[i];
      var list;
      try { list = ss.cssRules; } catch (e) { continue; }
      for (var j = 0; j < list.length; j++) {
        var t = list[j].cssText || '';
        if (t.indexOf('data:image/svg+xml') < 0) continue;
        rules.push(list[j].selectorText || '(anon)');
        // 按**完整 data-URI** 去重：用 indexOf 手工切，避开正则转义
        var from = 0;
        while (true) {
          var s = t.indexOf('data:image/svg+xml', from);
          if (s < 0) break;
          var e2 = t.indexOf('")', s);
          if (e2 < 0) e2 = Math.min(t.length, s + 400);
          shapes.add(t.slice(s, e2));
          from = e2 + 1;
        }
      }
    }
    function probe(sel) {
      var el = document.querySelector(sel);
      if (!el) return { sel: sel, missing: true };
      var cs = getComputedStyle(el);
      var bi = cs.backgroundImage || '';
      return {
        sel: sel,
        hasSvg: bi.indexOf('data:image/svg+xml') >= 0,
        layers: bi.split('url(').length - 1 + bi.split('gradient').length - 1,
        size: cs.backgroundSize,
      };
    }
    return {
      shapeCount: shapes.size,
      ruleCount: rules.length,
      rules: rules,
      body: probe('body'),
      panel: probe('.panel'),
      ruyi: (function () {
        var p = document.querySelector('.panel');
        if (!p) return null;
        var cs = getComputedStyle(p, '::after');
        var m = cs.maskImage || cs.webkitMaskImage || '';
        return { masks: m.split('url(').length - 1, bg: cs.backgroundColor, opacity: cs.opacity };
      })(),
    };
  })})()`);

  console.log('纹样体系验收（v1.15）');
  console.log('─'.repeat(62));
  console.log('  不同 SVG 图形:', inv.shapeCount, '种');
  console.log('  含 SVG 的规则:', inv.ruleCount, '条 →', inv.rules.slice(0, 8).join(' / '));
  ok(inv.shapeCount >= 5, `纹样种类 ≥5（实得 ${inv.shapeCount}）—— 不再「单一」`);

  console.log('  body 背景层数:', inv.body.layers, '| size:', inv.body.size);
  ok(inv.body.hasSvg === true && inv.body.layers >= 4, `body 有地纹且 ≥4 层（${inv.body.layers} 层）`);

  console.log('  .panel 地纹:', inv.panel.hasSvg ? '有' : '无', '| size:', inv.panel.size);
  ok(inv.panel.hasSvg === true, '面板有地纹');

  console.log('  如意角 mask:', inv.ruyi.masks, '枚 | 色:', inv.ruyi.bg, '| opacity:', inv.ruyi.opacity);
  ok(inv.ruyi.masks === 4, `如意角四角各一枚 SVG mask（${inv.ruyi.masks}）`);

  /* ── v1.16 文献判据（见 docs/传统纹样验收标准.md）── */
  console.log('');
  console.log('  文献判据：');
  const lit = await ev(`(${String(function () {
    var body = getComputedStyle(document.body).backgroundImage || '';
    var p = document.querySelector('.panel');
    var cs = getComputedStyle(p, '::before');
    var mask = (cs.maskImage || cs.webkitMaskImage || '') + ' ' + (cs.maskSize || '') + ' ' + (cs.maskRepeat || '');
    var after = getComputedStyle(p, '::after');
    var am = after.maskImage || after.webkitMaskImage || '';
    return {
      /* ① 云雷纹（方形螺旋）作地纹 —— 取代万字纹。
            文献：卍字「是印度佛教和印度教的标志」，非中国传统。 */
      hasYunlei: body.indexOf('M4 4h16v16H8V8h8v8h-4') >= 0,
      hasWanzi: body.indexOf('M16 5v22M5 16h22') >= 0,
      /* ② 回纹三变体（商末周初：曲折 / 三角 / 钩连）
            钩连式在竖向边饰上用的是**竖版**（viewBox 7×14），
            路径为横版旋转 90°：M6 0V3H2V7h3M2 7v4h4（注意末段是小写 h4）。 */
      hasFretBase: mask.indexOf('M0 6H2V1H6V4H4') >= 0,
      hasFretTri: mask.indexOf('M0 6L3 1L6 6L9 1L12 6') >= 0,
      hasFretHook: mask.indexOf('M6 0V3H2V7h3M2 7v4h4') >= 0,
      /* ③ 如意云纹「云头三停」—— 三停之间的四段弧必须存在
            文献：「云头形的上、中、下三个停顿与卷草状的一波三折的曲线」 */
      ruyiArcs: (am.match(/a[0-9.]/g) || []).length,
      ruyiHasSanTing: am.indexOf('M3 12a4 4 0 0 1 4-4') >= 0 && am.indexOf('M17 8a4 4 0 0 1 4 4') >= 0,
    };
  })})()`);
  ok(lit.hasYunlei === true && lit.hasWanzi === false,
    '云雷纹作地纹（万字纹已移除 —— 卍字源自印度佛教，非中国传统纹样）');
  ok(lit.hasFretBase && lit.hasFretTri && lit.hasFretHook,
    `回纹三变体齐备（基础 ${lit.hasFretBase} / 三角 ${lit.hasFretTri} / 钩连 ${lit.hasFretHook}）`);
  ok(lit.ruyiHasSanTing === true,
    `如意云纹含「云头三停」结构（${lit.ruyiArcs} 段弧）`);

  /* 三主题 */
  console.log('');
  for (const [theme, contrast, expectTex] of [['dark', 'normal', true], ['light', 'normal', true], ['dark', 'high', false]]) {
    const t = await ev(`(function(){
      document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)});
      document.documentElement.setAttribute('data-contrast', ${JSON.stringify(contrast)});
      var b = getComputedStyle(document.body).backgroundImage || '';
      var p = document.querySelector('.panel');
      var pa = getComputedStyle(p, '::after');
      return { bodyLayers: b.split('url(').length - 1 + b.split('gradient').length - 1,
               bodyHasSvg: b.indexOf('data:image/svg+xml') >= 0,
               ruyiOpacity: pa.opacity };
    })()`);
    await sleep(260);
    if (expectTex) {
      ok(t.bodyLayers >= 4 && parseFloat(t.ruyiOpacity) > 0,
        `[${theme}/${contrast}] 地纹 ${t.bodyLayers} 层 · 如意角 opacity ${t.ruyiOpacity}`);
    } else {
      ok(t.bodyHasSvg === false && parseFloat(t.ruyiOpacity) > 0,
        `[${theme}/${contrast}] 地纹已关闭（装饰伤对比度）· 如意角仍可见`);
    }
  }
  await ev(`(function(){ document.documentElement.setAttribute('data-theme','dark'); document.documentElement.setAttribute('data-contrast','normal'); return 1; })()`);

  ok(errs.length === 0, `零页面异常（${errs.length}）`);
  console.log('─'.repeat(62));
  console.log(fail === 0 ? `✅ 纹样体系验收通过` : `❌ ${fail} 项失败`);
  ws.close();
} catch (e) {
  console.log('ERR', e.message);
  fail++;
} finally {
  try { proc.kill(); } catch { /* 忽略 */ }
  try { server.close(); } catch { /* 忽略 */ }
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* 忽略 */ }
}
process.exit(fail === 0 ? 0 : 1);
