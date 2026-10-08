/**
 * 浮层定位守卫（2026-10-08 发现的真实缺陷）
 *
 * ── 症状 ──
 * 洞府页点词库卡片「没反应」：切换确认弹层、摸底浮层、toast 全部**渲染到视口之外**，
 * 用户看不到也点不到「确定」，切换流程走不完。11 个 `role="dialog"` 浮层全部受影响。
 *
 * ── 根因 ──
 * v1.9.1「传统纹样」为了把宣纸纹理层（`.cloud-weave::before`，position:fixed;z-index:0）
 * 压在内容之下，写了一条：
 *
 *     .cloud-weave>.app,.cloud-weave>.nav-menu,.cloud-weave>.toast,.cloud-weave>.overlay{position:relative;z-index:1}
 *
 * 其中 `.toast` / `.overlay` 本来分别是 `position:fixed`。这条规则以 (0,2,0) 的
 * 特异度**盖掉**了 base 规则的 (0,1,0)：
 *
 *     .overlay{position:fixed;inset:0;z-index:60}   ← (0,1,0)，被下面的盖掉
 *     .cloud-weave>.overlay{position:relative;...}  ← (0,2,0)，胜出
 *
 * `position:relative` 让浮层**掉回文档流**，于是被排到内容之后 ——
 * 实测在 1366×768 视口下弹层 top=647、视口高 626，完全在屏幕外。
 *
 * ── 为什么本地测试全绿还是漏了 ──
 * 原守卫 `visual-v191.test.mjs` 只断言 `texture.includes('.cloud-weave>.app')`
 * （「内容需抬一层 z-index」）—— 字符串在，但**没人验证浮层的 computed position**。
 * 这正是本仓库「坑 0」的同一教训：**字符串里有 ≠ 浏览器认**。
 *
 * 因此本测试用 **CSS 解析 + 特异度比较**来守：只要有任何规则让 `.overlay` / `.toast`
 * 不再保持 fixed 定位，就直接失败 —— 而不是去比对某条字符串是否存在。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const html = readFileSync(join(ROOT, 'src', 'index.template.html'), 'utf8');
const dist = readFileSync(join(ROOT, 'dist', 'index.html'), 'utf8');

/** 取出所有 <style> 段（模板与产物同构） */
function stylesOf(doc) {
  return [...doc.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
}

/**
 * 去掉 CSS 注释后再解析。
 * 必须先去注释：本文件与模板里的说明注释会**原样包含** `.overlay` / `.toast` 字样，
 * 不剥掉就会被当成选择器命中，产生假失败（实测踩过：守卫报的正是我自己写的注释）。
 * 注意产物里 `<style>` 的注释**不会被构建剥离**（构建只压 <script>），所以两边都要剥。
 */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** 粗略解析出 { selector, body }，跳过 @media/@supports 外层只取内层规则 */
function rulesOf(css) {
  const out = [];
  for (const m of stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim();
    if (!sel || sel.startsWith('@')) continue;
    out.push({ selector: sel, body: m[2] });
  }
  return out;
}

/** 特异度：(id 数, class/attr/伪类 数, 元素数) */
function specificity(sel) {
  const single = sel.split(',').map((s) => s.trim()).filter(Boolean);
  return single.map((s) => {
    const ids = (s.match(/#[\w-]+/g) || []).length;
    const classes = (s.match(/\.[\w-]+/g) || []).length
      + (s.match(/\[[^\]]+\]/g) || []).length
      + (s.match(/:(?!:)[\w-]+/g) || []).length;
    const els = (s.match(/(^|[\s>+~])([a-zA-Z][\w-]*)/g) || []).length;
    return { sel: s, ids, classes, els };
  });
}

const cmp = (a, b) => (a.ids - b.ids) || (a.classes - b.classes) || (a.els - b.els);

/** 找出「会把 el 的 position 从 fixed 改成别的」的胜出规则 */
function positionClobber(css, el) {
  const rules = rulesOf(css).filter((r) => {
    const specs = specificity(r.selector);
    return specs.some((s) => {
      // 精确匹配该元素的类选择器（如 .overlay / .toast），且规则里真的写了 position
      return new RegExp('(^|[\\s>+~])' + el.replace('.', '\\.') + '(?![\\w-])').test(s.sel)
        && /position\s*:/.test(r.body);
    }) && /position\s*:\s*(?!fixed)/.test(r.body);
  });
  return rules;
}

test('浮层定位：没有任何规则把 .overlay 从 fixed 改成别的定位', () => {
  const css = stylesOf(html);
  const bad = positionClobber(css, '.overlay');
  assert.deepEqual(
    bad.map((r) => r.selector),
    [],
    '有规则覆盖了 .overlay 的 position:fixed（浮层会掉回文档流、渲染到视口外）',
  );
});

test('浮层定位：没有任何规则把 .toast 从 fixed 改成别的定位', () => {
  const css = stylesOf(html);
  const bad = positionClobber(css, '.toast');
  assert.deepEqual(
    bad.map((r) => r.selector),
    [],
    '有规则覆盖了 .toast 的 position:fixed（提示会掉进文档流）',
  );
});

test('浮层定位：base 规则里 .overlay 与 .toast 仍是 fixed', () => {
  const css = stripComments(stylesOf(html));
  assert.ok(/\.overlay\{[^}]*position:fixed/.test(css), '.overlay 基础定位应为 fixed');
  assert.ok(/\.toast\{[^}]*position:fixed/.test(css), '.toast 基础定位应为 fixed');
  // z-index 层级不能被顺手改掉：浮层要压过内容
  assert.ok(/\.overlay\{[^}]*z-index:60/.test(css), '.overlay 的 z-index 应为 60');
});

test('浮层定位：.cloud-weave 层级规则只抬 .app，不再包含浮层', () => {
  const css = stripComments(stylesOf(html));
  const m = css.match(/\.cloud-weave>[^{]*\{[^}]*position:relative[^}]*\}/);
  assert.ok(m, '找不到 .cloud-weave 的内容层级规则（宣纸层需要 .app 抬 z-index）');
  const sel = m[0].split('{')[0];
  assert.ok(sel.includes('.cloud-weave>.app'), '规则应保留 .cloud-weave>.app');
  assert.ok(!sel.includes('.overlay'), '该规则不得包含 .overlay（会覆盖 fixed）');
  assert.ok(!sel.includes('.toast'), '该规则不得包含 .toast（会覆盖 fixed）');
});

test('浮层定位：产物与源码一致（防止只改模板没重新构建）', () => {
  const distCss = stripComments(stylesOf(dist));
  assert.ok(/\.overlay\{[^}]*position:fixed/.test(distCss), '产物里 .overlay 应为 fixed');
  assert.ok(!/\.cloud-weave>\.overlay/.test(distCss), '产物里不该再有 .cloud-weave>.overlay 规则');
  assert.ok(!/\.cloud-weave>\.toast/.test(distCss), '产物里不该再有 .cloud-weave>.toast 规则');
});
