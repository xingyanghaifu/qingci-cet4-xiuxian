#!/usr/bin/env node
/**
 * 三主题 + 移动端截图验收（`npm run shots`）
 *
 * ── 为什么需要 ──
 * 目标的第 ④ 条要求「三主题（深/浅/高对比）+ 移动端 375px **逐一目视验收**」。
 * 自动化断言能保证「元素存在、对比度达标」，但**看不出「好不好看」** ——
 * 那必须有人看图。本脚本把需要目视的组合一次性拍下来，避免遗漏。
 *
 * 输出到 `backups/shots/<tag>/`：
 *   <panel>-<theme>-<width>.png      每个面板 × 主题 × 宽度
 *   index.md                          清单（便于逐张勾选）
 *
 * 用法：
 *   node scripts/shots.mjs                  # 默认：3 主题 × 2 宽度 × 9 面板
 *   node scripts/shots.mjs --tag=before     # 给基线归档
 *   node scripts/shots.mjs --panels=paper,map   # 只拍指定面板
 *   node scripts/shots.mjs --quick          # 只拍 3 张代表图（快速自检）
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
const TAG = (process.argv.find((a) => a.startsWith('--tag=')) || '').split('=')[1] || 'current';
const OUT = join(ROOT, 'backups', 'shots', TAG);
const QUICK = process.argv.includes('--quick');
const ONLY = (process.argv.find((a) => a.startsWith('--panels=')) || '').split('=')[1];
const PORT = 4189, CDP = 9513;

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('❌ 未找到 dist/index.html —— 先跑 npm run build');
  process.exit(1);
}

const PANELS = ONLY
  ? ONLY.split(',').map((s) => s.trim()).filter(Boolean)
  : ['paper', 'trial', 'speak', 'book', 'codex', 'map', 'field', 'duel'];
const THEMES = QUICK ? [['dark', 'normal']] : [['dark', 'normal'], ['light', 'normal'], ['dark', 'high']];
const WIDTHS = QUICK ? [1440] : [1440, 375];

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
  console.log('⏭️  未找到浏览器，跳过截图');
  try { server.close(); } catch { /* 忽略 */ }
  process.exit(0);
}

const profile = mkdtempSync(join(tmpdir(), 'edge-shots-'));
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

let saved = 0;
const manifest = [];

try {
  let page;
  for (let i = 0; i < 100; i++) {
    try {
      const l = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
      page = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl
        && t.url && !/^(edge|chrome|about|devtools):/.test(t.url));
      if (page) break;
    } catch { /* 等浏览器 */ }
    await sleep(500);
  }
  if (!page) throw new Error('CDP 未就绪');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const send = cdp(ws);
  await send('Runtime.enable');
  await send('Page.enable');
  await sleep(9000);

  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return { __err: (r.exceptionDetails.exception || {}).description || r.exceptionDetails.text };
    return r.result.value;
  };

  fs.mkdirSync(OUT, { recursive: true });

  for (const width of WIDTHS) {
    await send('Emulation.setDeviceMetricsOverride', {
      width, height: width === 375 ? 812 : 900, deviceScaleFactor: 1, mobile: width === 375,
    });
    for (const [theme, contrast] of THEMES) {
      await ev(`(() => {
        document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)});
        document.documentElement.setAttribute('data-contrast', ${JSON.stringify(contrast)});
        return 1;
      })()`);
      await sleep(320);

      for (const name of PANELS) {
        await ev(`(async () => {
          /* ⚠️ 必须把 panel-missions 也一起隐藏 —— 它**常驻可见**（不受 switchTab 控制），
             否则拍任何面板都会看到「每日修炼设置」的内容覆盖在上面（曾拍出误导性截图）。 */
          var ALL = ['paper','trial','speak','book','codex','map','duel','field','missions'];
          var target = ${JSON.stringify(name)};
          ALL.forEach(function(n){ var e=document.getElementById('panel-'+n); if(e) e.classList.add('hidden'); });
          var t = document.getElementById('panel-' + target);
          if (t) t.classList.remove('hidden');
          /* panel-missions 也需要走它自己的显示路径（它是常驻面板） */
          if (target === 'missions') {
            var m = document.getElementById('panel-missions');
            if (m) m.classList.remove('hidden');
          }
          if (window.switchTab && target !== 'missions') { try { switchTab(target); } catch(e){} }
          await new Promise(function(r){ setTimeout(r, 140); });
          window.scrollTo(0, 0);
          return 1;
        })()`);
        await sleep(420);
        const shot = await send('Page.captureScreenshot', { format: 'png' });
        const file = `${name}-${theme}${contrast === 'high' ? '-high' : ''}-${width}.png`;
        fs.writeFileSync(join(OUT, file), Buffer.from(shot.data, 'base64'));
        manifest.push({ file, panel: name, theme, contrast, width });
        saved++;
      }
    }
  }

  /* 清单：便于逐张勾选目视 */
  const bySize = {};
  for (const m of manifest) {
    const p = join(OUT, m.file);
    bySize[m.file] = existsSync(p) ? fs.statSync(p).size : 0;
  }
  const lines = [
    `# 界面截图验收清单 · ${TAG}`,
    '',
    `生成时间：${new Date().toISOString()}`,
    `共 ${saved} 张（${PANELS.length} 面板 × ${THEMES.length} 主题 × ${WIDTHS.length} 宽度）`,
    '',
    '> 目视检查要点：① 纹饰是否过密 ② 文字有无截断/溢出 ③ 对比度是否足够',
    '> ④ 按钮是否对齐 ⑤ 移动端是否挤压 ⑥ 主题切换是否正常',
    '',
    '| 截图 | 面板 | 主题 | 对比 | 宽度 | 大小 | 已看 |',
    '|---|---|---|---|---|---|---|',
    ...manifest.map((m) => `| ${m.file} | ${m.panel} | ${m.theme} | ${m.contrast} | ${m.width} | ${(bySize[m.file] / 1024).toFixed(0)} KB | ☐ |`),
    '',
  ];
  fs.writeFileSync(join(OUT, 'index.md'), lines.join('\n'), 'utf8');

  console.log(`界面截图 · tag=${TAG}`);
  console.log('─'.repeat(60));
  console.log(`已保存 ${saved} 张到 backups/shots/${TAG}/`);
  console.log(`清单：backups/shots/${TAG}/index.md`);
  const sizes = manifest.map((m) => bySize[m.file]);
  console.log(`单张 ${(Math.min(...sizes) / 1024).toFixed(0)}–${(Math.max(...sizes) / 1024).toFixed(0)} KB，合计 ${(sizes.reduce((a, b) => a + b, 0) / 1024 / 1024).toFixed(1)} MB`);

  ws.close();
} catch (e) {
  console.error('ERR', e.message);
  process.exitCode = 1;
} finally {
  try { proc.kill(); } catch { /* 忽略 */ }
  try { server.close(); } catch { /* 忽略 */ }
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* 忽略 */ }
}
