#!/usr/bin/env node
/**
 * 部署准备：产出可直接上静态托管的目录结构
 * - 读取 dist/cet4-xiuxian.html
 * - 生成 index.html / _headers(缓存与压缩声明) / _redirects
 * - 生成健康检查用的静态 /healthz.json（供不支持动态接口的静态平台使用）
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
// --pages 模式输出到 deploy-pages/，并声明 Functions 负责的路由
const forPages = process.argv.includes('--pages');
const OUT = path.join(ROOT, forPages ? 'deploy-pages' : 'deploy');

const src = path.join(ROOT, 'dist', 'cet4-xiuxian.html');
if (!fs.existsSync(src)) {
  console.error('❌ 未找到 dist/cet4-xiuxian.html，请先执行 npm run build');
  process.exit(1);
}

fs.mkdirSync(OUT, { recursive: true });
const html = fs.readFileSync(src, 'utf8');
const words = (() => {
  const m = html.match(/<script id="lexicon" type="application\/json">([\s\S]*?)<\/script>/);
  return m ? JSON.parse(m[1]).length : 0;
})();
const sha = crypto.createHash('sha256').update(html).digest('hex').slice(0, 16);

// 1) 入口
fs.writeFileSync(path.join(OUT, 'index.html'), html);

// 2) 静态健康检查（纯静态平台读这个文件）
fs.writeFileSync(path.join(OUT, 'healthz.json'), JSON.stringify({
  status: 'ok',
  version: pkg.version,
  checks: { lexicon: { ok: words === 4540, count: words, expected: 4540 } },
  artifact: { file: 'index.html', sha256: sha, bytes: Buffer.byteLength(html) },
  generatedAt: new Date().toISOString(),
}, null, 2) + '\n');

// 3) 元信息
fs.writeFileSync(path.join(OUT, 'api-meta.json'), JSON.stringify({
  name: '青词天路 · 四级全卷修仙',
  version: pkg.version,
  lexiconSize: words,
  memoryKinds: ['zh2en', 'en2zh', 'similar', 'listen', 'spell', 'pos'],
  features: ['六种记忆题型', '试卷模拟', '斗法对战', '学情看板', '间隔重复', '离线可用'],
}, null, 2) + '\n');

// 3.5) PWA 资源与固化题库：构建产物 → 部署目录
//      Service Worker 必须与 index.html 同源同目录才能控制整站，因此一并拷贝；
//      题库体积 >1.5MB，按独立 JSON 交付、由 SW 与页面按需缓存。
const pwaAssets = ['manifest.webmanifest', 'sw.js', 'question-bank.json', 'changelog.html'];
// lexicons/ 是 v1.8.2 多词库分片（CET-6 等），与 vocab-detail/ 同构：递归拷贝、按需加载
const pwaDirs = ['icons', 'vocab-detail', 'lexicons', 'audio'];
const pwaCopied = [];
for (const file of pwaAssets) {
  const from = path.join(path.dirname(src), file);
  if (!fs.existsSync(from)) {
    console.error('❌ 未找到 ' + file + '，请先执行 npm run build（构建会产出 PWA 资源）');
    process.exit(1);
  }
  fs.copyFileSync(from, path.join(OUT, file));
  pwaCopied.push(file);
}
for (const dir of pwaDirs) {
  const from = path.join(path.dirname(src), dir);
  if (!fs.existsSync(from)) continue;
  const to = path.join(OUT, dir);
  fs.mkdirSync(to, { recursive: true });
  // 递归拷贝：icons/ 与 vocab-detail/ 是纯文件，audio/ 下还有 tts/、voa/ 子目录
  // （上一版用 copyFileSync 直接拷目录在 Windows 上会 EPERM，部署中止过一次）
  const copyRec = (srcDir, dstDir, rel) => {
    for (const entry of fs.readdirSync(srcDir)) {
      const s = path.join(srcDir, entry);
      const d = path.join(dstDir, entry);
      const r = rel ? `${rel}/${entry}` : entry;
      if (fs.statSync(s).isDirectory()) {
        fs.mkdirSync(d, { recursive: true });
        copyRec(s, d, r);
      } else {
        fs.copyFileSync(s, d);
        pwaCopied.push(`${dir}/${r}`);
      }
    }
  };
  copyRec(from, to, '');
}

// 4) Netlify / Cloudflare Pages 头部：入口不缓存，资源长缓存，声明压缩
fs.writeFileSync(path.join(OUT, '_headers'), [
  '/*',
  '  X-Content-Type-Options: nosniff',
  '  Referrer-Policy: strict-origin-when-cross-origin',
  '',
  '/index.html',
  '  Cache-Control: public, max-age=0, must-revalidate',
  '',
  // Service Worker 必须每次校验：否则发版后浏览器会长期停留在旧外壳
  '/sw.js',
  '  Content-Type: application/javascript; charset=utf-8',
  '  Cache-Control: no-cache, must-revalidate',
  '  Service-Worker-Allowed: /',
  '',
  '/manifest.webmanifest',
  '  Content-Type: application/manifest+json; charset=utf-8',
  '  Cache-Control: public, max-age=3600',
  '',
  '/icons/*',
  '  Cache-Control: public, max-age=604800, immutable',
  '',
  // 固化题库：体积大、按版本更新，1 小时缓存 + SW 后台revalidate
  '/question-bank.json',
  '  Content-Type: application/json; charset=utf-8',
  '  Cache-Control: public, max-age=3600',
  '',
  // 词库详情分片（任务 D）：按需加载，1 小时缓存 + SW 后台 revalidate
  '/vocab-detail/*',
  '  Content-Type: application/json; charset=utf-8',
  '  Cache-Control: public, max-age=3600',
  '',
  // 多词库清单与分片（v1.8.2 阶段 A）：CET-6 等扩展词库，按需加载，同上缓存口径
  '/lexicons/*',
  '  Content-Type: application/json; charset=utf-8',
  '  Cache-Control: public, max-age=3600',
  '',
  // 听力音频（Edge TTS 构建期产物）：长缓存，由 SW /audio/* cache-first 离线兜底
  '/audio/*',
  '  Cache-Control: public, max-age=2592000',
  '',
  '/healthz.json',
  '  Content-Type: application/json; charset=utf-8',
  '  Cache-Control: no-store',
  '',
  '/api-meta.json',
  '  Content-Type: application/json; charset=utf-8',
  '  Cache-Control: no-store',
  '',
].join('\n'));

// 5) SPA 回退
// Workers 场景由 worker/index.js 直接处理路由与静态资源绑定，_redirects 的
// 通配规则会与 Workers 静态资源解析冲突（wrangler 会报无限循环并忽略），
// 因此仅在非 Workers 模式（Pages / Netlify 等纯静态托管）下生成该文件。
const forWorkers = process.env.DEPLOY_TARGET === 'workers' || process.argv.includes('--workers');
if (forPages) {
  // Pages 模式：Functions 负责 /healthz、/status 与 /api/meta，其余全部走静态资源。
  // 不能写 /* -> /index.html 的 _redirects，否则会把接口请求也重写成 HTML。
  // 注意：未列入 include 的路径会走 SPA 回退返回应用页（200 + HTML），
  // 因此 functions/ 下有实现的路径必须同步登记，否则监控会拿到假的 200。
  const stale = path.join(OUT, '_redirects');
  if (fs.existsSync(stale)) fs.unlinkSync(stale);
  fs.writeFileSync(path.join(OUT, '_routes.json'), JSON.stringify({
    version: 1,
    include: ['/healthz', '/status', '/api/*'],
    exclude: [],
  }, null, 2) + '\n');
} else if (!forWorkers) {
  fs.writeFileSync(path.join(OUT, '_redirects'), '/*  /index.html  200\n');
} else {
  const stale = path.join(OUT, '_redirects');
  if (fs.existsSync(stale)) fs.unlinkSync(stale);
}

// 5.5) SEO / 爬虫基础文件
//
// 背景（2026-10-06 线上实测）：SPA 回退把 robots.txt / sitemap.xml / 404.html
// 全部回落成 981 KB 的应用首页 HTML —— 爬虫拿到的是一页 JS，提取不到任何规则，
// 而 requests 一律 200，连「这页不存在」都表达不出来。
// 这些文件体积极小、必须逐字放置，任何一个漏掉都不会有测试报错 —— 所以在这里生成，
// 并在下方断言它们确实落盘。
const SITE = 'https://qingci-cet4-xiuxian.pages.dev';
fs.writeFileSync(path.join(OUT, 'robots.txt'), [
  '# 青词天路 · 四级全卷修仙',
  'User-agent: *',
  'Allow: /',
  '',
  '# 静态托管下这些地址无意义（SPA 回退会返回首页），别让爬虫浪费预算',
  'Disallow: /deploy',
  'Disallow: /deploy-pages',
  'Disallow: /.cache',
  '',
  `Sitemap: ${SITE}/sitemap.xml`,
  '',
].join('\n'));

// 单页应用只有一个可索引地址；题库/音频/图标是资源不是页面。
fs.writeFileSync(path.join(OUT, 'sitemap.xml'), [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  '  <url>',
  `    <loc>${SITE}/</loc>`,
  `    <lastmod>${pkg.version === '1.9.1' ? '2026-10-06' : new Date().toISOString().slice(0, 10)}</lastmod>`,
  '    <changefreq>weekly</changefreq>',
  '    <priority>1.0</priority>',
  '  </url>',
  '</urlset>',
  '',
].join('\n'));

// 404：静态托管会优先取这个文件。不放的话未知名一律回落成 200 + 应用首页，
// 语义完全错。保持极简：给一句说明 + 回首页的链接，不内联 975 KB 的应用。
fs.writeFileSync(path.join(OUT, '404.html'), `<!DOCTYPE html>
<html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>迷路了 · 青词天路</title>
<meta name="robots" content="noindex">
<style>
:root{color-scheme:dark light}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#12100e;color:#f5f0e6;
  font:16px/1.7 system-ui,"Microsoft YaHei",sans-serif;text-align:center;padding:24px}
main{max-width:34em}
h1{font-size:2.2em;margin:0 0 .2em;letter-spacing:.05em}
p{color:#a69e92;margin:0 0 1.6em}
a{display:inline-block;background:#0e6b53;color:#f8f3ea;text-decoration:none;padding:12px 28px;border-radius:999px}
@media (prefers-color-scheme:light){body{background:#f3ecdf;color:#1c1815}p{color:#5c554c}}
</style></head><body><main>
<h1>迷路了</h1>
<p>这一页不在仙门之内。回到山门，继续修行。</p>
<a href="/">返回青词天路</a>
</main></body></html>
`);

// GitHub Pages 用它跳过 Jekyll 处理；Cloudflare Pages 忽略，但同目录部署时无害。
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');

const seoFiles = ['robots.txt', 'sitemap.xml', '404.html', '.nojekyll'];
for (const f of seoFiles) {
  const p = path.join(OUT, f);
  if (!fs.existsSync(p)) {
    console.error('❌ 未能生成 ' + f);
    process.exit(1);
  }
}

console.log('✅ 部署目录已生成目录: ' + (forPages ? 'deploy-pages/' : 'deploy/'));
console.log('   index.html      ' + (Buffer.byteLength(html) / 1024).toFixed(1) + ' KB');
console.log('   robots/sitemap/404/.nojekyll（爬虫基础文件，已落盘断言）');
console.log('   healthz.json    版本 v' + pkg.version + ' 词库 ' + words + ' 条');
console.log('   api-meta.json   元信息（机型/版本/特性）');
console.log('   PWA 资源        ' + pwaCopied.length + ' 个（manifest + sw.js + 图标）');
console.log('   _headers        缓存与安全响应头');
console.log(forPages ? '   _routes.json   Functions 路由（/healthz、/status、/api/*）' : (forWorkers ? '   _redirects      已跳过（Workers 模式由 Worker 处理路由）' : '   _redirects      SPA 回退'));
console.log('   产物指纹: sha256:' + sha);

