/**
 * 五行**文字色**对比度守卫（v1.10 第七轮）
 *
 * ── 真实缺陷 ──
 * 第六轮做「灵根」时，我直接把 `--color-wood/fire/earth/metal/water` 当**文字色**用：
 *
 *     .root-elem.e-water{color:var(--color-water)}
 *
 * 但那组 token 是为**描边/填充**设计的（低饱和、允许与底色接近）——
 * 真浏览器实测（用 CDP 取渲染后的实际颜色算 WCAG 对比度）：
 *
 *     深色 #161b22：水 3.10 ❌  火 3.90 ❌   （AA 正文要求 4.5）
 *     浅色 #fffdf9：金 3.27 ❌
 *
 * 也就是**灵根卡里两个系的文字读起来是吃力的**，而单元测试完全看不出来
 * （它只断言 class 名与文案，不会去算颜色对比度）。
 *
 * ── 修法 ──
 * 另设一组「同色相、对比度达标」的文字色 `--elem-*-text`，只调明度不动色相，
 * 五行观感保持一致；原来的 `--color-*` 继续服务描边/填充。
 *
 * ── 这份测试在防什么 ──
 * 1. 三个主题块（深色默认 / 显式浅色 / 高对比两档）都必须定义 `--elem-*-text`
 *    —— 漏一个就会出现「浅色下退回深色值」这种隐蔽回退（我第一版就漏了显式浅色）
 * 2. 每个文字色在**它自己的背景**上必须 ≥ 4.5:1
 * 3. 用作文字的地方不得再用 `--color-*`（防回归）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const html = readFileSync(join(ROOT, 'src', 'index.template.html'), 'utf8');

const ELEMS = ['metal', 'wood', 'water', 'fire', 'earth'];

/* ── 对比度工具（WCAG 2.1 相对亮度）── */
function lum(hex) {
  const m = hex.replace('#', '').match(/../g).map((h) => parseInt(h, 16) / 255);
  const c = m.map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a, b) {
  const l1 = lum(a), l2 = lum(b);
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}
/** 从一段 CSS 里取某个变量的十六进制值 */
function varOf(css, name) {
  const m = css.match(new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{3,8})'));
  return m ? m[1] : null;
}
/**
 * 取从 `selector` 开始、到**配平的花括号**为止的规则块。
 * ⚠️ 不能简单找第一个 `}` —— 变量值里可能出现 `}`（如 `--shadow:...}`），
 * 更常见的是 `:root{` 后面还跟着 `:root[data-font="large"]{...}` 等规则，
 * 用 indexOf('}') 会**提前截断**，导致「变量明明存在却报缺失」。
 * 初版就是这样误报了「深色默认缺全部五个变量」。
 */
function blockOf(selector) {
  const i = html.indexOf(selector);
  if (i < 0) return null;
  const open = html.indexOf('{', i);
  if (open < 0) return null;
  let depth = 0;
  for (let j = open; j < html.length; j++) {
    const c = html[j];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return html.slice(i, j + 1);
    }
  }
  return html.slice(i);
}
/**
 * 取 :root 基础主题块。
 * ⚠️ 必须匹配 `:root {`（带空格）—— 文档里更早还有 `:root{--q-scale:1}`
 * （字号变量，与主题无关），用 `:root{` 会**先命中那个**，导致变量全报缺失。
 */
function baseBlock() {
  return blockOf(':root {') || blockOf(':root{');
}

/**
 * 取「高对比·深底」块。
 * ⚠️ 不能直接 `blockOf('html:root[data-contrast="high"]')` ——
 * 文档里**高对比浅底**块也写作 `html:root[data-contrast="high"]`（前缀 html 是为提特异度），
 * 直接找会命中浅底那块，于是拿浅底色去和黑底比，得出「2.40 不达标」的假失败。
 * 真正的深底块在 `@media (prefers-color-scheme:dark)` 里。
 */
function darkHighBlock() {
  const i = html.indexOf('@media (prefers-color-scheme:dark)');
  if (i < 0) return null;
  const seg = html.slice(i);
  const j = seg.indexOf('html:root[data-contrast="high"]');
  if (j < 0) return null;
  const open = seg.indexOf('{', j);
  let depth = 0;
  for (let k = open; k < seg.length; k++) {
    if (seg[k] === '{') depth++;
    else if (seg[k] === '}') { depth--; if (depth === 0) return seg.slice(j, k + 1); }
  }
  return seg.slice(j);
}

const THEMES = [
  // [名称, 变量所在块, 背景色]
  ['深色默认', baseBlock(), '#161b22'],
  ['显式浅色', blockOf(':root[data-theme="light"]'), '#fffdf9'],
  ['高对比·浅底', blockOf(':root[data-contrast="high"]'), '#ffffff'],
  ['高对比·深底', darkHighBlock(), '#000000'],
];

/* ───────── 一、每个主题都必须定义全部文字色 ───────── */

test('每个主题块都定义了全部五个 --elem-*-text（防「浅色退回深色值」）', () => {
  const missing = [];
  for (const [name, css] of THEMES) {
    assert.ok(css, `找不到主题块：${name}`);
    for (const e of ELEMS) {
      if (!varOf(css, `elem-${e}-text`)) missing.push(`${name} 缺 --elem-${e}-text`);
    }
  }
  assert.deepEqual(missing, [],
    `以下主题缺五行文字色定义 —— 会静默回退到深色主题的值，导致浅底上对比度暴跌：\n  ${missing.join('\n  ')}`);
});

test('高对比·深底块确实存在（否则该主题漏测）', () => {
  // html:root[data-contrast="high"] 出现在 @media (prefers-color-scheme:dark) 里
  const i = html.indexOf('@media (prefers-color-scheme:dark)');
  assert.ok(i > 0, '找不到深色偏好媒体查询');
  const seg = html.slice(i, i + 1200);
  assert.ok(/--elem-metal-text/.test(seg), '高对比深底块缺五行文字色');
});

/* ───────── 二、对比度必须达标 ───────── */

test('五个文字色在各自主题背景下均 ≥ 4.5:1（WCAG AA 正文）', () => {
  const failures = [];
  for (const [name, css, bg] of THEMES) {
    for (const e of ELEMS) {
      const v = varOf(css, `elem-${e}-text`);
      if (!v) continue;              // 缺定义由上一个测试负责报
      // 支持 #abc 简写（高对比块里金是 #000）
      const hex = v.length === 4
        ? '#' + v.slice(1).split('').map((c) => c + c).join('')
        : v.slice(0, 7);
      const r = ratio(hex, bg);
      if (r < 4.5) failures.push(`${name} · ${e} = ${v} → ${r.toFixed(2)}:1（背景 ${bg}）`);
    }
  }
  assert.deepEqual(failures, [],
    `以下五行文字色对比度不足 4.5:1：\n  ${failures.join('\n  ')}`);
});

test('回归守卫：用作**文字色**的地方不得再用 --color-*（那是描边/填充用的）', () => {
  // --color-* 是为描边/填充设计的低饱和色，当正文色会不达标（水 3.10 / 火 3.90 / 浅色金 3.27）
  const bad = [...html.matchAll(/color:var\(--color-(wood|fire|earth|metal|water)\)/g)].map((m) => m[0]);
  assert.deepEqual(bad, [],
    `以下规则把「描边用」的五行色当文字色了，请改用 --elem-*-text：\n  ${bad.join('\n  ')}`);
});

test('接线：灵根卡的五系确实用上了文字色 token', () => {
  for (const e of ELEMS) {
    assert.ok(
      new RegExp(`\\.root-elem\\.e-${e}\\{color:var\\(--elem-${e}-text\\)\\}`).test(html),
      `.root-elem.e-${e} 未使用 --elem-${e}-text`);
  }
});

/* ───────── 三、色相保持（不是简单换成灰/黑） ───────── */

test('色相保持：文字色与原五行色同色相（只调明度，不换成灰）', () => {
  const base = baseBlock();
  const parse = (h) => h.replace('#', '').match(/../g).map((x) => parseInt(x, 16));
  for (const e of ELEMS) {
    const orig = varOf(base, `color-${e}`);
    const text = varOf(base, `elem-${e}-text`);
    assert.ok(orig && text, `${e} 缺少原色或文字色`);
    const [r1, g1, b1] = parse(orig), [r2, g2, b2] = parse(text);
    // 主色通道（最大者）应仍是同一个 —— 保证「水还是蓝、火还是红」
    const major = (r, g, b) => (r >= g && r >= b) ? 'r' : (g >= b ? 'g' : 'b');
    assert.equal(major(r2, g2, b2), major(r1, g1, b1),
      `${e} 的主色通道变了（${orig} → ${text}），色相不再一致`);
    // 金是「素银」，本来就是中性灰 —— 只有它允许三通道相等
    if (e !== 'metal') {
      assert.ok(!(r2 === g2 && g2 === b2), `${e} 的文字色退化成灰色了：${text}`);
    }
  }
});

test('高对比主题沿用原色（不需另调）—— 断言其达标', () => {
  const dark = darkHighBlock();
  assert.ok(dark, '找不到高对比深底块');
  for (const e of ELEMS) {
    const v = varOf(dark, `elem-${e}-text`);
    assert.ok(v, `高对比深底缺 --elem-${e}-text`);
    const hex = v.length === 4 ? '#' + v.slice(1).split('').map((c) => c + c).join('') : v.slice(0, 7);
    assert.ok(ratio(hex, '#000000') >= 4.5, `高对比深底 ${e} = ${v} 在黑底上不足 4.5:1`);
  }
});
