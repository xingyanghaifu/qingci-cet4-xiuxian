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
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync, copyFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { build as esbuild } from 'esbuild';
import { makeIcons } from './make-icons.mjs';
import { buildChangelog } from './build-changelog.mjs';
import { buildQuestionBank, serializeBank, decideDelivery } from './build-question-bank.mjs';

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

// —— 4b. 版本号注入模板 ——
// 之前页首 <small id="brandVer">v1.8.2</small> 是手工维护的静态字符串，只有打开设置面板
// 才会被 S.version 改写，首屏一直显示旧版本号（实测 build 注释 v1.9.1 vs 页首 v1.8.2）。
// 这里在构建期直接替换，改版本号只需要动 package.json 一处。
// 占位符写成 __BUILD_VERSION__，构建后不得残留（下面 fail() 兜底）。
html = html.replace(/__BUILD_VERSION__/g, pkg.version);
if (html.includes('__BUILD_VERSION__')) fail('模板里仍有未替换的 __BUILD_VERSION__ 占位符');

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

// —— 6.2. 分享卡 og-cover.png ——
// 源资产在 src/assets/（不进 dist/，dist 整个被 gitignore），构建时拷进 icons/。
// 由 scripts/make-og-cover.py 生成后提交，保证任何一次干净构建都能拿到它 ——
// og:image 是外链，线上少一张图就是所有分享静默降级成裸文字，且不会有任何测试报错。
const ogCoverSrc = join(root, 'src', 'assets', 'og-cover.png');
if (!existsSync(ogCoverSrc)) fail('缺 src/assets/og-cover.png（分享卡）：运行 python scripts/make-og-cover.py 生成');
copyFileSync(ogCoverSrc, join(OUT_DIR, 'icons', 'og-cover.png'));

// —— 6.5. 公开更新日志页（P1 任务 E）：由 CHANGELOG.md 生成静态页，随部署一起发布 ——
const changelog = buildChangelog({ outHtml: join(OUT_DIR, 'changelog.html') });

// —— 7. 固化题库（P0.3）：模板未变时复用已有产物，避免每次构建都重算 1.8 万题 ——
const bankPath = join(OUT_DIR, 'question-bank.json');
let bankBytes = 0;
let bankDecision = { mode: 'separate', reason: '' };
const bankFresh = existsSync(bankPath) && statSync(bankPath).mtimeMs >= statSync(SRC).mtimeMs;
if (bankFresh) {
  bankBytes = statSync(bankPath).size;
  bankDecision = decideDelivery(bankBytes);
} else {
  const bank = buildQuestionBank();
  const text = serializeBank(bank);
  writeFileSync(bankPath, text, 'utf8');
  bankBytes = Buffer.byteLength(text, 'utf8');
  bankDecision = decideDelivery(bankBytes);
}

// —— 7.5. 词库详情分片（任务 D）：src/data/vocab-detail/*.json → dist/vocab-detail/ ——
//      由 scripts/build-vocab-detail.mjs 生成（4540 词白名单）；运行时按需 fetch，
//      Service Worker 对同源资源 stale-while-revalidate，看过一次即离线可用。
const vdDir = join(root, 'src', 'data', 'vocab-detail');
let vdFiles = 0;
let vdBytes = 0;
if (existsSync(vdDir)) {
  const outVd = join(OUT_DIR, 'vocab-detail');
  if (existsSync(outVd)) rmSync(outVd, { recursive: true, force: true });
  mkdirSync(outVd, { recursive: true });
  for (const f of readdirSync(vdDir)) {
    if (!f.endsWith('.json')) continue;
    copyFileSync(join(vdDir, f), join(outVd, f));
    vdFiles++;
    vdBytes += statSync(join(outVd, f)).size;
  }
}

// —— 7.6. 多词库清单与分片（v1.8.2 阶段 A）：src/data/lexicons/** → dist/lexicons/** ——
//      CET-6 等扩展词库走各自目录，按需 fetch；不进单文件。
//      CET-4 仍走原路径 vocab-detail/（兼容策略，不搬动）。
const lexRoot = join(root, 'src', 'data', 'lexicons');
let lexFiles = 0;
let lexBytes = 0;
if (existsSync(lexRoot)) {
  const outLex = join(OUT_DIR, 'lexicons');
  if (existsSync(outLex)) rmSync(outLex, { recursive: true, force: true });
  // 递归拷贝（lexicons/<id>/vocab-detail/*.json 两层目录）
  const walk = (from, to) => {
    mkdirSync(to, { recursive: true });
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      const src = join(from, entry.name);
      const dst = join(to, entry.name);
      if (entry.isDirectory()) walk(src, dst);
      else if (entry.name.endsWith('.json')) {
        copyFileSync(src, dst);
        lexFiles++;
        lexBytes += statSync(dst).size;
      }
    }
  };
  walk(lexRoot, outLex);
}

console.log('');
console.log('✅ 构建成功');
console.log('   产物: dist/cet4-xiuxian.html + dist/index.html（同一份内容）');
console.log('   大小: ' + (size / 1024).toFixed(1) + ' KB（其中服务层 ' + (Buffer.byteLength(servicesCode) / 1024).toFixed(1) + ' KB）');
console.log('   词库: ' + words.length + ' 条');
console.log('   校验: sha256:' + sha);
console.log('   PWA : manifest.webmanifest + sw.js（缓存版本 ' + cacheVersion + '）+ ' + icons.length + ' 个图标');
console.log('   日志: changelog.html（' + changelog.versions + ' 个版本）');
console.log('   题库: ' + (bankBytes / 1024 / 1024).toFixed(2) + ' MB · ' + bankDecision.mode
  + (bankFresh ? '（复用上次产物）' : '（本次重新生成）'));
console.log('   词典: ' + (vdFiles ? vdFiles + ' 个详情分片 · ' + (vdBytes / 1024 / 1024).toFixed(2) + ' MB（按需加载）' : '未生成详情分片（node scripts/build-vocab-detail.mjs）'));
console.log('   词库: ' + (lexFiles ? lexFiles + ' 个扩展词库文件 · ' + (lexBytes / 1024 / 1024).toFixed(2) + ' MB（dist/lexicons，按需加载）' : '无扩展词库（node scripts/build-lexicon.mjs）'));
console.log('   说明: 单文件自包含，零运行时依赖，可直接双击打开');
