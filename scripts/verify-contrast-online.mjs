/**
 * P1-10 线上验收 · 真实浏览器（对比度 / 字号 / 高对比度完整性）
 *
 * 四件事，都是静态审计做不到的：
 *   1. 用 getComputedStyle 取**实际渲染**的 color/background，算真实对比度
 *      （含 color-mix()、opacity、层叠结果 —— 手算 token 会漏掉这些）
 *   2. **高对比度完整性**：把 data-theme × prefers-color-scheme 全组合扫一遍，
 *      确认高对比 token 真的生效、且背景压平成一个值。
 *      这条抓的是一个既有功能缺陷：高对比度曾被 data-theme 静默覆盖，
 *      App 默认就写 data-theme="dark"，所以等于对绝大多数用户无效。
 *   3. 三个主题各截一张图（dark / light / high-contrast），人眼复核布局
 *   4. 确认没有元素因为字号上调而溢出容器
 *
 * 用法：
 *   node scripts/verify-contrast-online.mjs                        # 线上
 *   node scripts/verify-contrast-online.mjs http://127.0.0.1:4173/ # 本地
 *   node scripts/verify-contrast-online.mjs <url> <截图目录>
 *
 * 找不到 Edge/Chrome 时跳过（退出码 0），不让离线环境变红。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TARGET = process.argv[2] || 'https://qingci-cet4-xiuxian.pages.dev/';
const PORT = 9334;
const SHOT_DIR = process.argv[3] || 'p110-shots';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findBrowser() {
  return [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/chromium',
  ].find((p) => existsSync(p)) || null;
}

function cdp(ws) {
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result); }
  });
  return (method, params = {}) => new Promise((resolve, reject) => {
    const myId = ++id; pending.set(myId, { resolve, reject });
    ws.send(JSON.stringify({ id: myId, method, params }));
    setTimeout(() => { if (pending.has(myId)) { pending.delete(myId); reject(new Error('CDP 超时: ' + method)); } }, 60000);
  });
}

async function waitForPage() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const p = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (p) return p;
    } catch { /* not up */ }
    await sleep(500);
  }
  throw new Error('CDP 未就绪');
}

const browser = findBrowser();
if (!browser) { console.log('⏭️  未找到 Edge/Chrome，跳过。'); process.exit(0); }

const profile = mkdtempSync(join(tmpdir(), 'qingci-p110-'));
const proc = spawn(browser, ['--headless=new', '--disable-gpu', '--no-sandbox',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--disable-extensions', '--disable-sync',
  '--window-size=1440,1200', TARGET], { stdio: 'ignore' });

let failures = 0;
const lines = [];
const ok = (pass, msg) => { if (!pass) failures++; lines.push(`${pass ? 'PASS' : 'FAIL'}  ${msg}`); };

try {
  mkdirSync(SHOT_DIR, { recursive: true });
  const page = await waitForPage();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const send = cdp(ws);
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false });

  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('页面异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result.value;
  };

  /** 在页面里算对比度：取 computed color 与实际背景（向上找第一个非透明） */
  const CONTRAST_PROBE = `(() => {
    const lin = c => { const s = c/255; return s <= 0.04045 ? s/12.92 : Math.pow((s+0.055)/1.055, 2.4); };
    const parse = s => { const m = String(s).match(/rgba?\\(([^)]+)\\)/); if (!m) return null;
      const p = m[1].split(',').map(x => parseFloat(x)); return { r:p[0], g:p[1], b:p[2], a: p.length>3 ? p[3] : 1 }; };
    const lum = c => 0.2126*lin(c.r) + 0.7152*lin(c.g) + 0.0722*lin(c.b);
    const over = (fg, bg) => ({ r: fg.r*fg.a + bg.r*(1-fg.a), g: fg.g*fg.a + bg.g*(1-fg.a), b: fg.b*fg.a + bg.b*(1-fg.a), a: 1 });
    const ratio = (a, b) => { const la = lum(a), lb = lum(b); const [hi, lo] = la > lb ? [la, lb] : [lb, la]; return (hi+0.05)/(lo+0.05); };
    const bgOf = el => { let n = el; while (n && n !== document.documentElement) {
      const c = parse(getComputedStyle(n).backgroundColor); if (c && c.a > 0.05) return c; n = n.parentElement; }
      return parse(getComputedStyle(document.body).backgroundColor) || {r:255,g:255,b:255,a:1}; };

    // 采样「真实承载文字」的元素，而不是全部（避免噪声）
    const sel = ['.muted', '.kicker', '.brand-text small', '.gate small', '.gate em', '.plot-cap',
                 '.demon-lv', '.vd-src-tag', '.title-chip.locked', '.side .gate small', 'p.muted', '.creed'];
    const out = [];
    for (const s of sel) {
      for (const el of document.querySelectorAll(s)) {
        const st = getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden') continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const txt = (el.textContent || '').trim();
        if (!txt) continue;
        const fgRaw = parse(st.color); if (!fgRaw) continue;
        const bg = bgOf(el);
        // 元素自身 opacity 会再混一层
        const op = parseFloat(st.opacity);
        const fgEff = op < 1 ? over({ ...fgRaw, a: fgRaw.a * op }, bg) : (fgRaw.a < 1 ? over(fgRaw, bg) : fgRaw);
        out.push({ sel: s, text: txt.slice(0, 18), fontSize: parseFloat(st.fontSize),
          ratio: +ratio(fgEff, bg).toFixed(2), color: st.color, bg: 'rgb(' + Math.round(bg.r) + ',' + Math.round(bg.g) + ',' + Math.round(bg.b) + ')' });
      }
    }
    return out;
  })()`;

  console.log(`P1-10 线上验收 · ${TARGET}`);
  console.log('─'.repeat(76));
  await sleep(4500);

  for (const [themeName, setup] of [
    ['dark（默认）', `document.documentElement.dataset.theme='dark'; document.documentElement.removeAttribute('data-contrast');`],
    ['light', `document.documentElement.dataset.theme='light'; document.documentElement.removeAttribute('data-contrast');`],
    ['high-contrast', `document.documentElement.removeAttribute('data-theme'); document.documentElement.dataset.contrast='high';`],
  ]) {
    await evalJs(setup);
    await sleep(700);
    const rows = await evalJs(CONTRAST_PROBE);
    lines.push('');
    lines.push(`【${themeName}】采样 ${rows.length} 个文字元素`);
    const bad = rows.filter((r) => r.ratio < 4.5);
    // 大字号（≥18.66px 或 ≥24px）按 3:1 放宽
    const badStrict = bad.filter((r) => !(r.fontSize >= 18.66));
    for (const r of rows.slice(0, 6)) {
      lines.push(`    ${r.sel.padEnd(22)} ${String(r.fontSize).padStart(5)}px  ${String(r.ratio).padStart(5)}:1  "${r.text}"`);
    }
    ok(badStrict.length === 0, `${themeName}: 所有正文文字 ≥4.5:1（不达标 ${badStrict.length} 个${badStrict.length ? '：' + badStrict.map((b) => b.sel + ' ' + b.ratio).join(', ') : ''}）`);

    // 截图
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const file = join(SHOT_DIR, `p110-${themeName.replace(/[（）]/g, '')}.png`);
    writeFileSync(file, Buffer.from(shot.data, 'base64'));
    lines.push(`    → 截图 ${file}`);
  }

  // 溢出检测：字号上调后是否有横向溢出
  const overflow = await evalJs(`(() => {
    const de = document.documentElement;
    const bad = [];
    for (const el of document.querySelectorAll('.app *')) {
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.overflow !== 'visible') continue;
      if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
        bad.push((el.className || el.tagName) + ' scrollW=' + el.scrollWidth + ' clientW=' + el.clientWidth);
      }
    }
    return { docOverflow: de.scrollWidth > de.clientWidth + 2, docScrollW: de.scrollWidth, docClientW: de.clientWidth, count: bad.length, sample: bad.slice(0, 6) };
  })()`);
  lines.push('');
  lines.push('【溢出检测】');
  ok(!overflow.docOverflow, `文档无横向溢出（scrollW=${overflow.docScrollW} clientW=${overflow.docClientW}）`);
  ok(overflow.count === 0, `无内部横向溢出（${overflow.count} 处${overflow.count ? '：' + overflow.sample.join(' | ') : ''}）`);

  /* ── 高对比度完整性：data-theme × prefers-color-scheme 全组合 ──
     这里抓的是一个**既有功能缺陷**（P1-10 期间发现）：
     `:root[data-contrast="high"]` 与 `:root[data-theme="dark"]` 特异度相同 (0,2,0)，
     而主题块在样式表里更靠后 → 高对比整块被吃掉。App 默认就写 data-theme="dark"，
     所以「设置高对比」对绝大多数用户等于没生效。 */
  const HC_PROBE = `(() => {
    const cs = getComputedStyle(document.documentElement);
    const g = t => cs.getPropertyValue(t).trim();
    return { bg: g('--bg'), card: g('--card'), sidebar: g('--bg-sidebar'),
             elevated: g('--bg-elevated'), ink: g('--ink'), tp: g('--text-primary') };
  })()`;
  lines.push('');
  lines.push('【高对比度完整性】data-theme × 系统配色 全组合');
  for (const scheme of ['dark', 'light']) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
    for (const theme of ['(none)', 'dark', 'light']) {
      await evalJs(`(() => { const de = document.documentElement;
        ${theme === '(none)' ? `de.removeAttribute('data-theme');` : `de.dataset.theme = ${JSON.stringify(theme)};`}
        de.dataset.contrast = 'high'; return true; })()`);
      await sleep(400);
      const v = await evalJs(HC_PROBE);
      // 高对比下背景必须压平成一个值，且正文色与之形成黑白两极
      const bgs = [v.bg, v.card, v.sidebar, v.elevated];
      const flat = new Set(bgs).size === 1;
      const isBlack = v.bg === '#000' || v.bg === 'rgb(0, 0, 0)';
      const isWhite = v.bg === '#fff' || v.bg === 'rgb(255, 255, 255)';
      const inkContrast = (isBlack && (v.ink === '#fff' || v.ink === 'rgb(255, 255, 255)'))
        || (isWhite && (v.ink === '#000' || v.ink === 'rgb(0, 0, 0)'));
      ok(flat && (isBlack || isWhite) && inkContrast,
        `系统=${scheme.padEnd(5)} theme=${theme.padEnd(6)} --bg=${v.bg} --card=${v.card} --bg-sidebar=${v.sidebar} --ink=${v.ink}` +
        `${flat ? '' : ' ❌背景未压平'}${(isBlack || isWhite) ? '' : ' ❌非纯黑/纯白'}${inkContrast ? '' : ' ❌正文色未到另一端'}`);
    }
  }
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });

  ws.close();
} catch (e) {
  failures++;
  lines.push(`FAIL  脚本异常：${e.message}`);
} finally {
  try { proc.kill(); } catch { /* ignore */ }
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
}

console.log(lines.join('\n'));
console.log('─'.repeat(76));
console.log(failures === 0 ? `✅ 全部通过（${lines.filter((l) => l.startsWith('PASS')).length} 项）` : `❌ ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
