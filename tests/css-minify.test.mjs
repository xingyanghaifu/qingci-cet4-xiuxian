/**
 * 构建期 CSS 压缩守卫（2026-10-08 新增）
 *
 * ── 背景 ──
 * `scripts/build.mjs` 的 4c 一直只压 `<script>`，`<style>` 段原样进产物 ——
 * 其中约 18 KB 是中文设计注释，运行时零价值却实打实占单文件预算。
 * 产物 925 618 B 时预算（19 KB）只剩 5.04 KB，任何新玩法都塞不进。
 *
 * 4d 补上 CSS 压缩（去注释 + 收缩结构性空白）后：97.4 KB → 76.5 KB，省 20.9 KB，
 * 产物降到 904 237 B，剩余预算 5.04 → 25.92 KB。
 *
 * ── 为什么需要这份守卫 ──
 * CSS 压缩有**静默破坏**的风险，而且都是「测试全绿但用户看得见」的类型：
 *   1. 破坏 `url("data:image/svg+xml,…")` 里的语义空白 → 宣纸纹理失效；
 *   2. 注释剥离顺序错 → 规则切分错位、整段样式丢失；
 *   3. 误删分号 → 相邻声明被合并成一条非法声明；
 *   4. 把 `@media` / 高对比选择器重排 → 多条按源码形态断言的守卫假失败。
 *
 * 所以这里不只断言「压缩生效了」，更断言**压缩没有破坏语义**：
 * 注释必须已剥离、大括号必须平衡、data URI 必须完整、关键规则必须原样还在。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const dist = readFileSync(join(ROOT, 'dist', 'index.html'), 'utf8');
const src = readFileSync(join(ROOT, 'src', 'index.template.html'), 'utf8');

const styleOf = (doc) =>
  [...doc.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');

const distCss = styleOf(dist);
const srcCss = styleOf(src);

test('CSS 压缩：产物的 <style> 已无块注释', () => {
  const comments = distCss.match(/\/\*[\s\S]*?\*\//g) || [];
  assert.equal(comments.length, 0,
    `产物 <style> 里仍有 ${comments.length} 个块注释 —— CSS 压缩没生效？`);
});

test('CSS 压缩：源码注释必须保留（只压产物，不动可读性）', () => {
  const comments = srcCss.match(/\/\*[\s\S]*?\*\//g) || [];
  assert.ok(comments.length > 100,
    `源码 <style> 注释只剩 ${comments.length} 个 —— 压缩不该作用于源文件`);
});

test('CSS 压缩：大括号平衡（防止注释剥离切错规则）', () => {
  const open = (distCss.match(/\{/g) || []).length;
  const close = (distCss.match(/\}/g) || []).length;
  assert.equal(open, close, `产物 CSS 大括号不平衡：{ ${open} vs } ${close}（规则被切错）`);
});

test('CSS 压缩：data URI 完整性（宣纸纹理的 feTurbulence 不被破坏）', () => {
  assert.ok(dist.includes('feTurbulence'), '产物缺 feTurbulence（宣纸纹理丢失）');
  // data URI 必须是完整的 url("data:image/svg+xml,...") 形态，内部空白未被压坏
  assert.ok(/url\("data:image\/svg\+xml,[^"]*feTurbulence[^"]*"\)/.test(dist),
    'data URI 结构被压缩破坏（引号内空白被改写）');
});

test('CSS 压缩：关键规则原样保留（抽查各主题/无障碍契约）', () => {
  const must = [
    [':focus-visible{outline:', '焦点环'],
    ['html:root[data-contrast="high"]{', '高对比度特异度 (0,2,1)'],
    ['aside.side>*{flex-shrink:0}', '侧栏防压扁'],
    ['@media (prefers-reduced-motion:reduce){', 'reduced-motion 退化'],
    ['.overlay{position:fixed;inset:0;z-index:60', '浮层 fixed 定位'],
    ['.toast{position:fixed', 'toast fixed 定位'],
  ];
  for (const [needle, label] of must) {
    assert.ok(dist.includes(needle), `产物缺 ${label}：${needle}`);
  }
});

test('CSS 压缩：产物 <style> 明显小于源码（收益没被回退）', () => {
  // ⚠️ 这里**不能**用「产物总字节 < 某个绝对值」来判断压缩是否生效 ——
  // 那会把两件事混为一谈：① 压缩被回退  ② 正常新增了功能。
  // （本测试初版用 `< 920 KB`，结果本轮新增账本功能后误报失败。）
  // 正确做法：**直接量压缩率** —— 产物 CSS 必须显著小于源码 CSS。
  const srcCssBytes = Buffer.byteLength(srcCss, 'utf8');
  const distCssBytes = Buffer.byteLength(distCss, 'utf8');
  assert.ok(srcCssBytes > 1000, `源码 CSS 过小（${srcCssBytes} B），检查提取是否失效`);
  const ratio = distCssBytes / srcCssBytes;
  assert.ok(ratio < 0.92,
    `产物 CSS 为源码的 ${(ratio * 100).toFixed(1)}% —— CSS 压缩疑似被回退（实测约 78%）`);
  // 体积预算由 visual-v191.test.mjs 的「基线 + 19 KB」统一守，此处不重复。
});

test('CSS 压缩：SKIP_MINIFY=1 可跳过（对照实验开关仍在）', () => {
  const build = readFileSync(join(ROOT, 'scripts', 'build.mjs'), 'utf8');
  assert.ok(build.includes('SKIP_MINIFY'), 'build.mjs 缺 SKIP_MINIFY 诊断开关');
  // JS 与 CSS 两处都要尊重该开关
  const skips = (build.match(/SKIP_MINIFY/g) || []).length;
  assert.ok(skips >= 2, `SKIP_MINIFY 只出现 ${skips} 次 —— JS 与 CSS 都应尊重该开关`);
});
