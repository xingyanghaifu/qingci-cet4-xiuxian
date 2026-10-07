/**
 * P1-10 · 对比度与字号（审计第 10 项）
 *
 * 审计原文：「--text-muted 深色 2.28:1 / 浅色 3.08:1，AA 正文要 4.5:1」「18 处字号 ≤11px」。
 *
 * 实测后有两处与审计不符，本测试按**实测口径**守：
 *
 * 1. `--text-muted` 其实只用在 1 条规则里（`.title-chip.locked`），而且那条还叠了
 *    `opacity:.62` —— 双重变暗后实际只有 **1.53:1**。真正承载正文的是 `--muted`
 *    （36 处），浅色下 4.02:1 不达标。所以审计点名的 token 不是问题主体，
 *    照着审计只改 `--text-muted` 会「改了但没修好」。
 *
 * 2. 字号 ≤11px 实测 21 处，其中 3 处是 `aria-hidden` 的纯装饰（印章 / 竖排箴言），
 *    WCAG 对装饰性文本不设字号要求。其余 18 处已提到 ≥12px。
 *
 * 另外本测试还守一个**本轮发现的既有功能缺陷**：高对比度模式长期静默失效
 * （详见「高对比度」小节）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const html = readFileSync(join(ROOT, 'src', 'index.template.html'), 'utf8');
const dist = readFileSync(join(ROOT, 'dist', 'index.html'), 'utf8');

/* ---------------- WCAG 对比度工具（与线上验收脚本同口径） ---------------- */

function srgbToLin(c) {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function hexToRgb(h) {
  let s = h.replace('#', '').trim();
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}
function luminance(hex) {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b);
}
function contrast(fg, bg) {
  const a = luminance(fg), b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** 按花括号配对取块内容（不靠「第一个 }」这种会踩嵌套的写法） */
function blockAfter(src, marker) {
  const i = src.indexOf(marker);
  if (i < 0) return null;
  const open = src.indexOf('{', i);
  if (open < 0) return null;
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(open + 1, j); }
  }
  return null;
}
function tokensOf(block) {
  const out = {};
  if (!block) return out;
  for (const m of block.matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\b/g)) out[m[1]] = m[2];
  return out;
}

const THEMES = {
  'dark（默认）': { ...tokensOf(blockAfter(html, ':root {')), ...tokensOf(blockAfter(html, ':root[data-theme="dark"] {')) },
  'light': tokensOf(blockAfter(html, ':root[data-theme="light"] {')),
  'light（跟随系统）': tokensOf(blockAfter(html, ':media-placeholder')), // 下面单独取
  'high（浅底）': tokensOf(blockAfter(html, 'html:root[data-contrast="high"]{')),
  'high（暗底）': tokensOf(blockAfter(html, ':root[data-contrast="high"]{--bg:#000')),
};
// 跟随系统的浅色块：@media (prefers-color-scheme:light) 里的 :root:not([data-theme])
const mqLight = blockAfter(html, '@media (prefers-color-scheme:light) {');
if (mqLight) THEMES['light（跟随系统）'] = tokensOf(mqLight);

/** 高对比两档要合并：暗底那档在 @media 里，浅底那档在外层 */
const HC_LIGHT = tokensOf(blockAfter(html, 'html:root[data-contrast="high"]{'));
const HC_DARK = tokensOf(blockAfter(html, ':root[data-contrast="high"]{--bg:#000'));

/* ---------------- 1. 对比度 ---------------- */

const TEXT_TOKENS = ['text-primary', 'text-secondary', 'text-muted', 'ink', 'soft', 'muted'];
const BG_TOKENS = ['bg', 'bg2', 'card', 'bg-deep', 'bg-surface', 'bg-elevated', 'bg-sidebar'];

test('P1-10：四个主题的正文色 token 对全部背景都 ≥4.5:1（AA 正文）', () => {
  const failures = [];
  for (const [themeName, tk] of Object.entries(THEMES)) {
    if (!tk || Object.keys(tk).length === 0) continue;
    for (const t of TEXT_TOKENS) {
      if (!tk[t]) continue;
      for (const b of BG_TOKENS) {
        if (!tk[b]) continue;
        const r = contrast(tk[t], tk[b]);
        if (r < 4.5) failures.push(`${themeName} ${t}(${tk[t]}) on ${b}(${tk[b]}) = ${r.toFixed(2)}:1`);
      }
    }
  }
  assert.deepEqual(failures, [], '以下组合不达 AA 4.5:1：\n  ' + failures.join('\n  '));
});

test('P1-10：浅色 --muted 已从 4.02:1 提到 ≥4.5:1（审计点名的正文色）', () => {
  // 审计说 --text-muted 浅色 3.08:1；实测真正用在正文的是 --muted，浅色 4.02:1。
  const light = THEMES['light'];
  assert.ok(light, '未解析到浅色主题块');
  const r = contrast(light.muted, light.bg2);
  assert.ok(r >= 4.5, `浅色 --muted 对 --bg2 仅 ${r.toFixed(2)}:1（需 ≥4.5）`);
});

test('P1-10：深色 --text-muted 已从 1.95:1 提到 ≥4.5:1', () => {
  const dark = THEMES['dark（默认）'];
  assert.ok(dark, '未解析到暗色主题块');
  const r = contrast(dark['text-muted'], dark['bg-elevated']);
  assert.ok(r >= 4.5, `暗色 --text-muted 对 --bg-elevated 仅 ${r.toFixed(2)}:1（需 ≥4.5）`);
});

test('P1-10：跟随系统的浅色主题与显式浅色保持一致（不能只改一处）', () => {
  const explicit = THEMES['light'];
  const system = THEMES['light（跟随系统）'];
  assert.ok(system && Object.keys(system).length > 0, '未解析到 @media (prefers-color-scheme:light) 主题块');
  // 两份浅色 token 必须同值，否则「跟随系统」的用户拿不到修复
  for (const t of ['muted', 'text-muted', 'text-primary', 'text-secondary']) {
    assert.equal(system[t], explicit[t], `浅色 token --${t} 在两处不一致：系统=${system[t]} 显式=${explicit[t]}`);
  }
});

test('P1-10：.title-chip.locked 不再叠加 opacity（否则任何颜色都救不回来）', () => {
  // 原写法 opacity:.62 + color:var(--text-muted) 双重变暗，实测 1.53:1。
  // 单纯换颜色治不好：0.62 会把任何中间灰拉到接近背景。
  const rule = (html.match(/\.title-chip\.locked\{[^}]*\}/g) || []).pop() || '';
  assert.ok(rule, '.title-chip.locked 规则未找到');
  assert.ok(!/opacity\s*:/.test(rule), `.title-chip.locked 仍在用 opacity 变暗：${rule}`);
  assert.ok(/color:var\(--muted\)/.test(rule), `.title-chip.locked 应改用 --muted 着色：${rule}`);
});

/* ---------------- 2. 字号 ---------------- */

test('P1-10：正文里不再有 <12px 的字号（装饰性 aria-hidden 元素除外）', () => {
  const styleStart = html.indexOf('<style>');
  const styleEnd = html.indexOf('</style>');
  const css = html.slice(styleStart, styleEnd);
  // 允许的小字号：印章（.seal-imprint）与竖排箴言（.creed），两者都 aria-hidden 纯装饰
  const DECORATIVE = /seal-imprint|creed/;
  const offenders = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim();
    const body = m[2];
    for (const f of body.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) {
      const px = parseFloat(f[1]);
      if (px < 12 && !DECORATIVE.test(sel)) offenders.push(`${sel} → ${px}px`);
    }
  }
  assert.deepEqual(offenders, [], '以下非装饰规则仍 <12px：\n  ' + offenders.join('\n  '));
});

test('P1-10：<12px 只剩装饰元素，且装饰元素确实是 aria-hidden', () => {
  const styleStart = html.indexOf('<style>');
  const css = html.slice(styleStart, html.indexOf('</style>'));
  let tiny = 0;
  for (const m of css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) if (parseFloat(m[1]) < 12) tiny++;
  assert.ok(tiny <= 4, `<12px 声明仍有 ${tiny} 处（期望 ≤4，只留装饰）`);
  // 装饰元素必须在标记里带 aria-hidden，否则「小字 + 可读」组合就不合规
  assert.ok(/<div class="seal-corner" aria-hidden="true"/.test(html), '印章容器应 aria-hidden');
  assert.ok(/<p class="creed" aria-hidden="true"/.test(html), '竖排箴言应 aria-hidden');
});

test('P1-10：.mk-bar 第三列不再写死 34px（"0/4540" 需要 44px，会被裁切）', () => {
  const rule = (html.match(/\.mk-bar\{[^}]*\}/g) || [])[0] || '';
  assert.ok(rule, '.mk-bar 规则未找到');
  assert.ok(!/grid-template-columns:52px 1fr 34px/.test(rule),
    '.mk-bar 第三列仍是写死 34px，长数字会被裁切：' + rule);
  assert.ok(/grid-template-columns:\s*52px\s+1fr\s+auto/.test(rule),
    '.mk-bar 第三列应改为 auto 以容纳长数字：' + rule);
});

/* ---------------- 3. 高对比度级联（本轮发现的既有缺陷） ---------------- */

test('高对比度选择器特异度必须压过主题选择器（否则整块高对比被吃掉）', () => {
  // 缺陷原貌：`:root[data-contrast="high"]` 与 `:root[data-theme="dark"]` 同为 (0,2,0)，
  // 而主题块在文件更后面 → 后者胜出。App 默认就写 data-theme="dark"，
  // 于是「设置高对比」对绝大多数用户是**静默无效**的。
  // 修复：给高对比加 html 前缀，特异度提到 (0,2,1)。
  //
  // 注意断言必须**逐块**检查：两档高对比（浅底 / 暗底）都要带前缀。
  // 只写 html.includes('html:root[data-contrast="high"]{') 是不够的 ——
  // 只改坏其中一档时另一档仍能让它通过（变异测试实测漏网）。
  const hcSelectors = [...html.matchAll(/(\S*):root\[data-contrast="high"\]\s*\{/g)]
    .map((m) => m[1] + ':root[data-contrast="high"]{');
  assert.equal(hcSelectors.length, 2, `期望 2 个高对比 token 块，实际 ${hcSelectors.length}`);
  for (const sel of hcSelectors) {
    assert.ok(sel.startsWith('html:root['),
      `高对比块缺少 html 前缀（特异度不足，会被 data-theme 覆盖）：${sel}`);
  }

  // 主题选择器必须**不带** html 前缀，否则这条不变式失效
  const themeSel = html.match(/:root\[data-theme="(dark|light)"\]\s*\{/g) || [];
  assert.equal(themeSel.length, 2, `期望 2 个主题 token 块，实际 ${themeSel.length}`);
  assert.ok(!html.includes('html:root[data-theme='), '主题选择器不该加 html 前缀（会让上面不变式失效）');
});

test('高对比度必须接管全部主题别名 token（否则漏出主题色形成花屏）', () => {
  // 缺陷原貌：只覆盖了 --bg/--card/--ink 等主 token，
  // --bg-sidebar/--bg-elevated/--text-primary/--border-* 仍继承主题色 →
  // 视觉上「侧栏浅、主区深」。实测截图确认过。
  const ALIASES = ['bg-deep', 'bg-surface', 'bg-elevated', 'bg-sidebar',
    'text-primary', 'text-secondary', 'text-muted',
    'border-subtle', 'border-default', 'accent-gold', 'accent-jade', 'solid-fg'];
  for (const t of ALIASES) {
    assert.ok(t in HC_LIGHT, `浅底高对比缺 --${t}`);
    assert.ok(t in HC_DARK, `暗底高对比缺 --${t}`);
  }
  // 高对比下背景必须压平到同一个值（纯黑或纯白），不能有分层
  for (const [name, tk] of [['浅底', HC_LIGHT], ['暗底', HC_DARK]]) {
    const bgs = ['bg', 'bg2', 'card', 'bg-deep', 'bg-surface', 'bg-elevated', 'bg-sidebar'].map((b) => tk[b]);
    assert.equal(new Set(bgs).size, 1, `${name}高对比的背景 token 不统一：${bgs.join(', ')}`);
  }
});

test('产物里的高对比修复也在（防止只改模板没重新构建）', () => {
  assert.ok(dist.includes('html:root[data-contrast="high"]{'),
    '产物缺少高对比特异度修复 —— 需要重新 build');
  assert.ok(!dist.includes('.mk-bar{display:grid;grid-template-columns:52px 1fr 34px'),
    '产物里 .mk-bar 仍是写死 34px —— 需要重新 build');
});
