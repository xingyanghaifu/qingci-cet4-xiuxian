#!/usr/bin/env node
/**
 * 构建脚本：把 src/index.template.html 构建为可发布的 dist/cet4-xiuxian.html
 * 构建内容：
 *   1. 校验模板完整性（词库、关键脚本）
 *   2. 注入构建元信息（版本号、构建时间）
 *   3. 输出自包含单文件（零外部依赖，可离线双击打开）
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const SRC = join(root, 'src', 'index.template.html');
const OUT_DIR = join(root, 'dist');
const OUT = join(OUT_DIR, 'cet4-xiuxian.html');

function fail(msg) {
  console.error('❌ 构建失败：' + msg);
  process.exit(1);
}

console.log('🔨 构建 青词天路 v' + pkg.version);
console.log('   源文件: src/index.template.html');

if (!existsSync(SRC)) fail('找不到源模板 ' + SRC);
let html = readFileSync(SRC, 'utf8');

// —— 1. 完整性校验 ——
const lexiconMatch = html.match(/<script id="lexicon" type="application\/json">([\s\S]*?)<\/script>/);
if (!lexiconMatch) fail('模板缺少词库 <script id="lexicon">');
let words;
try { words = JSON.parse(lexiconMatch[1]); } catch (e) { fail('词库 JSON 解析失败: ' + e.message); }
if (!Array.isArray(words) || words.length < 4000) fail('词库条目异常，实际 ' + (words ? words.length : 0));
console.log('   ✓ 校验词库 ' + words.length + ' 条');

const required = [
  ['面板：斗法场', 'id="panel-duel"'],
  ['面板：学情看板', 'id="statGrid"'],
  ['题型：形近辨析', 'MEMORY_KINDS'],
  ['题型：拼写默写', 'function submitSpell'],
  ['对战结算', 'function answerDuel'],
  ['健康检查钩子', 'id="lexicon"'],
];
for (const [name, token] of required) {
  if (!html.includes(token)) fail('模板缺少关键结构：' + name + '（' + token + '）');
  console.log('   ✓ 校验 ' + name);
}

// —— 2. 注入构建元信息 ——
const buildTime = new Date().toISOString();
const meta = '<!-- build: qingci-cet4-xiuxian v' + pkg.version + ' @ ' + buildTime + ' -->';
if (!html.includes('<!-- build:')) html = html.replace('<!DOCTYPE html>', '<!DOCTYPE html>\n' + meta);

// —— 3. 输出 ——
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, html, 'utf8');

const size = statSync(OUT).size;
const sha = createHash('sha256').update(html, 'utf8').digest('hex').slice(0, 16);
console.log('');
console.log('✅ 构建成功');
console.log('   产物: dist/cet4-xiuxian.html');
console.log('   大小: ' + (size / 1024).toFixed(1) + ' KB');
console.log('   词库: ' + words.length + ' 条');
console.log('   校验: sha256:' + sha);
console.log('   说明: 单文件自包含，零外部依赖，可直接双击打开');
