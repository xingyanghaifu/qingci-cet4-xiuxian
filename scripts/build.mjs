#!/usr/bin/env node
/**
 * 构建脚本：把 src/ 构建为可发布的 dist/
 *
 * 流程：
 *   1. 用 esbuild 打包 src/entry/services.ts（TypeScript）为一段 IIFE 脚本
 *   2. 校验模板完整性（词库、关键脚本、服务注入点）
 *   3. 把打包结果内联进模板的 <!-- build:services --> 注入点
 *   4. 注入构建元信息（版本号、构建时间）并输出自包含单文件 dist/cet4-xiuxian.html
 *
 * 产物特征：零运行时依赖、断网可用、双击可开。
 * 说明：esbuild 需要拉起自身二进制（子进程），在受限沙箱中可能被拒绝，
 *       普通开发环境与 CI 不受影响。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { build as esbuild } from 'esbuild';
import { makeIcons } from './make-icons.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const SRC = join(root, 'src', 'index.template.html');
const SERVICES_ENTRY = join(root, 'src', 'entry', 'services.ts');
const SW_TEMPLATE = join(root, 'src', 'sw.template.js');
const SERVICES_MARKER = '<!-- build:services -->';
const OUT_DIR = join(root, 'dist');
const OUT = join(OUT_DIR, 'cet4-xiuxian.html');

function fail(msg) {
  console.error('❌ 构建失败：' + msg);
  process.exit(1);
}

console.log('🔨 构建 青词天路 v' + pkg.version);
console.log('   源文件: src/index.template.html + src/entry/services.ts');

if (!existsSync(SRC)) fail('找不到源模板 ' + SRC);

// —— 1. 打包 TypeScript 服务层 ——
if (!existsSync(SERVICES_ENTRY)) fail('找不到服务入口 ' + SERVICES_ENTRY);
let servicesCode = '';
try {
  const result = await esbuild({
    entryPoints: [SERVICES_ENTRY],
    bundle: true,
    write: false,
    format: 'iife',
    target: ['es2020'],
    platform: 'browser',
    minify: true,
    legalComments: 'none',
    charset: 'utf8',
    logLevel: 'silent',
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  });
  servicesCode = result.outputFiles.map((f) => f.text).join('\n');
} catch (e) {
  fail('esbuild 打包失败：' + (e.message || e));
}
if (!servicesCode.trim()) fail('服务层打包结果为空');
for (const token of ['QingciServices', 'gradeSubmission', 'AI_GRADING_ENABLED']) {
  if (!servicesCode.includes(token)) fail('服务层打包结果缺少关键符号：' + token);
}
console.log('   ✓ 打包 src/ → 服务层 ' + (Buffer.byteLength(servicesCode) / 1024).toFixed(1) + ' KB');

// —— 2. 读取并校验模板 ——
let html = readFileSync(SRC, 'utf8');

const lexiconMatch = html.match(/<script id="lexicon" type="application\/json">([\s\S]*?)<\/script>/);
if (!lexiconMatch) fail('模板缺少词库 <script id="lexicon">');
let words;
try { words = JSON.parse(lexiconMatch[1]); } catch (e) { fail('词库 JSON 解析失败: ' + e.message); }
if (!Array.isArray(words) || words.length < 4000) fail('词库条目异常，实际 ' + (words ? words.length : 0));
console.log('   ✓ 校验词库 ' + words.length + ' 条');

const required = [
  ['面板：斗法场', 'id="panel-duel"'],
  ['面板：学情看板', 'id="statGrid"'],
  ['题型：形近辨析', 'function makeMemoryQuestion('],
  ['题型：拼写默写', 'function submitSpell(){'],
  ['对战结算', 'function answerDuel('],
  ['健康检查钩子', 'id="lexicon"'],
  ['服务注入点', SERVICES_MARKER],
  ['写作批改入口', 'id="gradeBox"'],
];
const missing = [];
for (const [name, token] of required) {
  if (html.includes(token)) {
    console.log('   ✓ 校验 ' + name);
  } else {
    missing.push(name + '（' + token + '）');
  }
}
if (missing.length) fail('模板缺少关键结构：' + missing.join('、'));

// —— 3. 内联服务层 ——
html = html.replace(SERVICES_MARKER, '<script>\n' + servicesCode + '\n</script>');

// —— 4. 注入构建元信息（时间戳取自上一次产物，保证重复构建产物确定一致）——
const metaRe = /<!-- build: qingci-cet4-xiuxian v[\d.]+ @ ([0-9T:.\-Z]+) -->/;
let stamp = null;
if (existsSync(OUT)) {
  const prev = readFileSync(OUT, 'utf8').match(metaRe);
  if (prev) stamp = prev[1]; // 复用上次构建时间戳，使产物可复现
}
if (!stamp) stamp = new Date().toISOString(); // 首次构建才生成
const meta = '<!-- build: qingci-cet4-xiuxian v' + pkg.version + ' @ ' + stamp + ' -->';
html = metaRe.test(html) ? html.replace(metaRe, meta) : html.replace('<!DOCTYPE html>', '<!DOCTYPE html>\n' + meta);

// —— 5. 输出 ——
// 同时产出 index.html：静态托管（含本地 npm start）把 / 映射到 index.html，
// Service Worker 的预缓存清单也以 ./index.html 为准。
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, html, 'utf8');
writeFileSync(join(OUT_DIR, 'index.html'), html, 'utf8');

const size = statSync(OUT).size;
const sha = createHash('sha256').update(html, 'utf8').digest('hex').slice(0, 16);

// —— 6. PWA 资源：manifest + Service Worker + 图标（与单文件分离，互不影响）——
const cacheVersion = pkg.version + '-' + sha.slice(0, 8);

const manifest = {
  name: '青词天路 · 四级全卷修仙',
  short_name: '青词天路',
  description: '4540 个 CET-4 单词、五类备考模式、六种记忆题型与间隔复习；离线可用，学习记录只存在本机浏览器。',
  lang: 'zh-CN',
  dir: 'ltr',
  start_url: './',
  scope: './',
  display: 'standalone',
  orientation: 'portrait-primary',
  background_color: '#12100e',
  theme_color: '#0e6b53',
  categories: ['education', 'productivity'],
  icons: [
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'icons/icon-192-maskable.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
    { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};
writeFileSync(join(OUT_DIR, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

if (!existsSync(SW_TEMPLATE)) fail('找不到 Service Worker 模板 ' + SW_TEMPLATE);
const swSource = readFileSync(SW_TEMPLATE, 'utf8');
if (!swSource.includes('__CACHE_VERSION__')) fail('Service Worker 模板缺少 __CACHE_VERSION__ 占位符');
const swOut = swSource.replace(/__CACHE_VERSION__/g, cacheVersion);
writeFileSync(join(OUT_DIR, 'sw.js'), swOut, 'utf8');

const icons = makeIcons(OUT_DIR);

console.log('');
console.log('✅ 构建成功');
console.log('   产物: dist/cet4-xiuxian.html + dist/index.html（同一份内容）');
console.log('   大小: ' + (size / 1024).toFixed(1) + ' KB（其中服务层 ' + (Buffer.byteLength(servicesCode) / 1024).toFixed(1) + ' KB）');
console.log('   词库: ' + words.length + ' 条');
console.log('   校验: sha256:' + sha);
console.log('   PWA : manifest.webmanifest + sw.js（缓存版本 ' + cacheVersion + '）+ ' + icons.length + ' 个图标');
console.log('   说明: 单文件自包含，零运行时依赖，可直接双击打开');
