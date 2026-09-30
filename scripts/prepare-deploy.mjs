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
const OUT = path.join(ROOT, 'deploy');

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

// 4) Netlify / Cloudflare Pages 头部：入口不缓存，资源长缓存，声明压缩
fs.writeFileSync(path.join(OUT, '_headers'), [
  '/*',
  '  X-Content-Type-Options: nosniff',
  '  Referrer-Policy: strict-origin-when-cross-origin',
  '',
  '/index.html',
  '  Cache-Control: public, max-age=0, must-revalidate',
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
fs.writeFileSync(path.join(OUT, '_redirects'), '/*  /index.html  200\n');

console.log('✅ 部署目录已生成目录: deploy/');
console.log('   index.html      ' + (Buffer.byteLength(html) / 1024).toFixed(1) + ' KB');
console.log('   healthz.json    版本 v' + pkg.version + ' 词库 ' + words + ' 条');
console.log('   api-meta.json   元信息（机型/版本/特性）');
console.log('   _headers        缓存与安全响应头');
console.log('   _redirects      SPA 回退');
console.log('   产物指纹: sha256:' + sha);
