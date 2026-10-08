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
import { build as esbuild, transform as esbuildTransform } from 'esbuild';
import { makeIcons } from './make-icons.mjs';
import { buildChangelog } from './build-changelog.mjs';
import { buildQuestionBank, serializeBank, decideDelivery } from './build-question-bank.mjs';
import core from '../src/core/utils.js';

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

/**
 * 压缩一段 CSS：去注释 + 收缩结构性空白。
 *
 * **引号感知**：单/双引号内的内容（含 `url("data:image/svg+xml,…")` 这类
 * data URI）原样保留，绝不改其内部空白 —— 否则宣纸纹理的 SVG 会被破坏。
 *
 * 收缩规则（只动「规则之间」与「声明之间」的空白）：
 *   · 去掉 `{ } ; : , >` 周围的空白
 *   · 折叠连续空白为一个空格
 *   · 去掉最后一条声明末尾的分号
 * 保持选择器文本与规则顺序**完全不变**，使按源码形态断言的多条守卫继续通过。
 */
function minifyCss(css) {
  const out = [];
  let i = 0;
  const n = css.length;
  while (i < n) {
    const ch = css[i];
    // 1) 块注释：整体丢弃
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    // 2) 字符串 / url(...) 内的内容原样拷贝（含引号本身）
    if (ch === '"' || ch === "'") {
      const quote = ch;
      out.push(ch);
      i++;
      while (i < n) {
        const c = css[i];
        out.push(c);
        i++;
        if (c === '\\') { if (i < n) { out.push(css[i]); i++; } continue; }
        if (c === quote) break;
      }
      continue;
    }
    // 3) 结构性空白收缩
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f') {
      // 向前看：下一个非空白字符
      let j = i;
      while (j < n && /\s/.test(css[j])) j++;
      const next = css[j];
      const prev = out.length ? out[out.length - 1] : '';
      // 这些位置周围的空白无意义，直接丢弃
      const dropBefore = '{};:,>'.includes(next) || '{};:,>'.includes(prev);
      if (!dropBefore) out.push(' ');
      i = j;
      continue;
    }
    // 4) 去掉 `{` 前多余空格已在上面处理；这里处理 `}` 后紧跟声明的情况
    out.push(ch);
    i++;
  }
  // 收尾：去掉最后一条声明末尾分号、以及紧邻 `}` 前的分号
  return out.join('').replace(/;+\}/g, '}').trim();
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
// 兼容两种格式：源码模板是**对象数组**（可读），已编码的产物是紧凑列式
words = core.decodeLexicon(words);
if (!Array.isArray(words) || words.length < 4000) fail('词库条目异常，实际 ' + (words ? words.length : 0));
console.log('   ✓ 校验词库 ' + words.length + ' 条');

// —— 3b. 内联词库改紧凑列式（省约 102 KB）——
// 为什么必须做：原本是对象数组，每条重复 `"w":` / `"ipa":` / `"zh":` / `"short":`
// 四个键名约 23 B，4540 条 = 约 102 KB **纯键名开销**（零信息量）。
// 单文件预算（19 KB 增量）此前只剩 6.04 KB，这一步把可用空间提到约 108 KB。
//
// 安全性：`core.decodeLexicon()` 同时接受两种格式，页面侧统一走它；
// 词库分片（lexicons/*/wordlist.json）**不受影响**，仍是对象数组。
const lexiconJson = JSON.stringify(core.encodeLexicon(words));
html = html.replace(
  /(<script id="lexicon" type="application\/json">)[\s\S]*?(<\/script>)/,
  (_m, open, close) => open + lexiconJson + close,
);
const lexiconBytes = Buffer.byteLength(lexiconJson, 'utf8');
console.log('   ✓ 内联词库改紧凑列式 ' + (Buffer.byteLength(lexiconMatch[1], 'utf8') / 1024).toFixed(1)
  + ' KB → ' + (lexiconBytes / 1024).toFixed(1) + ' KB（省 '
  + ((Buffer.byteLength(lexiconMatch[1], 'utf8') - lexiconBytes) / 1024).toFixed(1) + ' KB）');

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

// —— 4c. 剥离内联 <script> 的注释与多余空白 ——
// 为什么必须做：模板里的主应用脚本是**手写的**（不是 esbuild 产物），
// 带着约 50 KB 中文注释。这些注释对运行时零价值，却实打实占单文件体积 ——
// 而单文件预算（19 KB 增量）此前已用到 14.27 KB，只剩 4.73 KB。
//
// 三条安全底线（都经过实测校验）：
//   1. **不开 minifyIdentifiers**。这些脚本依赖跨块共享的全局名
//      （顶层 function 被 HTML onclick 调用、`const $`/`state` 被后续块引用），
//      改短名字会静默断开所有跨块引用。实测：保标识符时顶层名 0 丢失。
//   2. **只处理 JS，跳过 application/json**（词库/题库是数据，不能当代码转）。
//   3. **逐个块独立 transform**。块与块之间没有 import/export 关系，
//      独立处理可避免 esbuild 把多个块当成一个模块而改变语义。
//
// 收益实测：281.3 KB → 212.8 KB（省 68.5 KB，24.4%），且顶层 function 零丢失。
// 源码 src/index.template.html 的注释**原样保留**（可读性不受影响）。
const scriptTagRe = /<script([^>]*)>([\s\S]*?)<\/script>/g;
let minifyBefore = 0;
let minifyAfter = 0;
let minifyBlocks = 0;
const htmlParts = [];
let lastIndex = 0;
const scriptJobs = [];
for (const m of html.matchAll(scriptTagRe)) {
  const [full, attrs, body] = m;
  // 跳过 JSON 数据块（词库/题库是数据，当代码转会坏）
  if (/application\/json/.test(attrs)) continue;
  // 跳过空块（避免给 esbuild 喂空字符串）
  if (!body.trim()) continue;
  // 诊断开关：SKIP_MINIFY=1 时跳过压缩，用于「压缩是否引入回归」的对照实验
  if (process.env.SKIP_MINIFY === '1') continue;
  // 注意：**不设长度阈值**。曾按 <512 B 跳过「内联配置」，
  // 结果首屏主题脚本（含 260 B 注释）漏网 —— 而它恰恰在关键路径上。
  // 小 IIFE 同样是独立脚本，没有跨块依赖，压缩是安全的。
  scriptJobs.push({ start: m.index, end: m.index + full.length, attrs, body });
}
for (const job of scriptJobs) {
  let code = job.body;
  try {
    const out = await esbuildTransform(code, {
      loader: 'js',
      target: 'es2020',
      // 去注释 + 压空白 + 语法简化；**不**压标识符（见上）
      minifyWhitespace: true,
      minifySyntax: true,
      minifyIdentifiers: false,
      legalComments: 'none',
      charset: 'utf8',
      logLevel: 'silent',
    });
    code = out.code;
  } catch (e) {
    fail('内联脚本压缩失败（块起点 ' + job.start + '）：' + (e.message || e));
  }
  minifyBefore += Buffer.byteLength(job.body, 'utf8');
  minifyAfter += Buffer.byteLength(code, 'utf8');
  minifyBlocks++;
  htmlParts.push(html.slice(lastIndex, job.start));
  htmlParts.push('<script' + job.attrs + '>' + code + '</script>');
  lastIndex = job.end;
}
htmlParts.push(html.slice(lastIndex));
html = htmlParts.join('');
const minifySaved = (minifyBefore - minifyAfter) / 1024;
console.log('   ✓ 内联脚本去注释/压缩 ' + minifyBlocks + ' 块 · '
  + (minifyBefore / 1024).toFixed(1) + ' KB → ' + (minifyAfter / 1024).toFixed(1) + ' KB'
  + '（省 ' + minifySaved.toFixed(1) + ' KB）');

// —— 4d. 压缩内联 <style>（去注释 + 压空白）——
//
// 为什么必须做：4c 只压了 <script>，<style> 段一直原样进产物 ——
// 其中约 18 KB 是中文注释（设计说明），运行时零价值，却实打实占预算。
// 实测产物 925 618 B 时，预算（19 KB）只剩 5.04 KB，任何新玩法都塞不进；
// 压完 CSS 可回收约 21 KB，把可用预算提到约 26 KB。
//
// 三条安全底线（与 4c 同一套思路，但 CSS 有自己的坑）：
//   1. **必须先去注释再压空白**。若先压空白，`/* … */` 里的换行被折叠后
//      仍被当作注释整体删除 —— 结果一样，但注释里的 `}` 会让后续
//      规则切分错位（实测：不先剥注释会出现样式整段丢失）。
//   2. **不能碰字符串字面量里的内容**。本项目 CSS 里有 `url("data:image/svg+xml,…")`
//      （宣纸纹理 feTurbulence）。粗暴压空白会破坏 data URI 内的语义空白。
//      故只做「注释剥离 + 结构性空白收缩」，且跳过引号内与括号内的空白。
//   3. **不用 esbuild 转 CSS**：它会把 `@supports`/`@media` 重新排版，
//      而多条守卫测试按**源码书写形态**断言（如
//      `@media (prefers-reduced-motion:reduce){…}`、`html:root[data-contrast="high"]{`），
//      一旦重排就会大面积假失败。手写收缩保持选择器与规则原样，只动空白。
//
// 源码 src/index.template.html 的注释**原样保留**（可读性不受影响）。
const styleTagRe = /<style([^>]*)>([\s\S]*?)<\/style>/g;
let cssBefore = 0;
let cssAfter = 0;
let cssBlocks = 0;
const cssParts = [];
let cssLast = 0;
for (const m of html.matchAll(styleTagRe)) {
  const [full, attrs, body] = m;
  if (process.env.SKIP_MINIFY === '1') continue;
  cssBefore += Buffer.byteLength(body, 'utf8');
  const min = minifyCss(body);
  cssAfter += Buffer.byteLength(min, 'utf8');
  cssBlocks++;
  cssParts.push(html.slice(cssLast, m.index));
  cssParts.push('<style' + attrs + '>' + min + '</style>');
  cssLast = m.index + full.length;
}
if (cssBlocks) {
  cssParts.push(html.slice(cssLast));
  html = cssParts.join('');
  console.log('   ✓ 内联样式去注释/压缩 ' + cssBlocks + ' 块 · '
    + (cssBefore / 1024).toFixed(1) + ' KB → ' + (cssAfter / 1024).toFixed(1) + ' KB'
    + '（省 ' + ((cssBefore - cssAfter) / 1024).toFixed(1) + ' KB）');
}

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
