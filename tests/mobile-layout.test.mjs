/**
 * 窄屏「文字被压成竖排」守卫（v1.10 第九轮）
 *
 * ── 真实缺陷（两个，均为既有代码） ──
 * 1. `.seal > .row.muted:last-child{display:none}` **从未生效** ——
 *    后来在 `.seal` 末尾追加了 `.seal-corner` 与 `.creed`，那个 row 不再是 `:last-child`。
 *    于是它在窄屏里仍占位；而 `.seal` 是 `flex-wrap:nowrap`，
 *    子项被收缩到 **min-content**，中文的 min-content 就是**一个字宽**：
 *
 *        375px 实测：#realmName 只剩 15px、#qiText 19px、渡劫按钮 40×205
 *        → 「修为 · 炼气」竖排成一字一行，完全没法读
 *
 * 2. 同样机制把品牌名压成 29×44（「青词天路」一字一行）。
 *
 * ── 为什么单元测试原先测不到 ──
 * 这不是「写错代码」，而是**布局收缩**：样式都合法、元素都在、事件也能触发，
 * 只有在真实浏览器里量 `getBoundingClientRect()` 才看得出宽度塌成个位数。
 * 所以本测试用**静态断言**把修复钉住（真浏览器量化放在 verify 脚本里）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const rawHtml = readFileSync(join(ROOT, 'src', 'index.template.html'), 'utf8');

/**
 * ⚠️ 断言前必须**剥掉 CSS 注释**。
 * 修复时我把「原来写错的那条规则」原文引用在注释里说明原因，
 * 结果正则把注释内容也当成「仍在使用的规则」→ 两条假失败。
 * 教训：这类「禁止某写法」的守卫，一定要先排除注释。
 */
const html = rawHtml.replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * 取包含指定特征的 max-width:767px 块。
 *
 * ⚠️ 页面里有**十个** `@media (max-width:767px)` 块；只取第一个会拿到
 * 「选项卡片」那块，于是断言全部落空（初版就是这样 5 条误报）。
 * 这里按「块内容里是否含某个锚点」来定位目标块。
 */
function mediaBlockContaining(anchor) {
  const blocks = [];
  const re = /@media \(max-width:767px\)\s*\{/g;
  let m;
  while ((m = re.exec(html))) {
    const open = html.indexOf('{', m.index);
    let depth = 0;
    for (let j = open; j < html.length; j++) {
      if (html[j] === '{') depth++;
      else if (html[j] === '}') {
        depth--;
        if (depth === 0) { blocks.push(html.slice(open + 1, j)); break; }
      }
    }
  }
  return blocks.find((b) => b.includes(anchor)) || null;
}

const mobile = mediaBlockContaining('.hero{position:sticky');

test('守卫：窄屏隐藏明细行不得依赖 :last-child（会被后加兄弟元素破坏）', () => {
  // 原写法 `.seal > .row.muted:last-child{display:none}` 因后续追加 .seal-corner/.creed 而失效
  const usesLastChild = /\.seal\s*>\s*\.row\.muted:last-child/.test(html);
  assert.ok(!usesLastChild,
    '仍在使用 :last-child 隐藏明细行 —— .seal 末尾已追加 .seal-corner/.creed，该规则会失效');
  assert.ok(/\.seal\s*>\s*\.row\.muted\{display:none\}/.test(html),
    '缺「按类名隐藏明细行」的规则 —— 窄屏下该行会占位并把子项压成一字一行');
});

test('守卫：窄屏 .seal 子项必须防止被压到 min-content（中文=一个字宽）', () => {
  assert.ok(mobile, '找不到 max-width:767px 块');
  // 文本行要有 min-width:max-content；非进度条子项要有 flex:0 0 auto
  assert.ok(/\.seal\s*>\s*\.row\{[^}]*min-width:\s*max-content/.test(mobile),
    '窄屏 .seal > .row 未设 min-width:max-content —— 会被 flex 收缩成一字一行');
  assert.ok(/\.seal\s*>\s*\.row\s*>\s*b\{[^}]*white-space:\s*nowrap/.test(mobile),
    '窄屏 .seal 内的境界名未禁止折行');
  assert.ok(/\.seal\s*>\s*\.trib-status[^{]*\{[^}]*flex:\s*0\s+0\s+auto/.test(mobile),
    '窄屏 .seal > .trib-status 未关掉收缩 —— 渡劫按钮会被压成竖排');
});

test('守卫：窄屏品牌文字必须防止被压成竖排', () => {
  assert.ok(mobile, '找不到 max-width:767px 块');
  assert.ok(/\.brand-text\{[^}]*flex:\s*0\s+0\s+auto/.test(mobile),
    '窄屏 .brand-text 未关掉收缩 —— 品牌名会被压成一字一行');
  assert.ok(/\.brand-text b\{[^}]*white-space:\s*nowrap/.test(mobile),
    '窄屏品牌名未禁止折行');
});

test('守卫：极窄屏（≤359px）整块隐藏品牌文字，只留字标', () => {
  assert.ok(/@media \(max-width:359px\)\{\s*\.brand-text\{display:none\}\s*\}/.test(html),
    '缺 ≤359px 的降级规则 —— 极窄屏下品牌文字会挤占空间');
});

test('守卫：窄屏下 .seal 与 .hero 的既有布局约定仍在（未被本次修复改动）', () => {
  assert.ok(mobile, '找不到 max-width:767px 块');
  // 本次只加「防压缩」与「改隐藏选择器」，不应改动这些既有行为
  assert.ok(/\.seal #daoName\{display:none\}/.test(mobile), '道号在窄屏应隐藏（让位给进度条）');
  assert.ok(/\.seal \.bar\{flex:1 1 auto;height:5px/.test(mobile), '进度条样式被改动了');
  assert.ok(/\.hero\{[^}]*flex-wrap:nowrap/.test(mobile), '.hero 的 nowrap 约定被改动了');
});

test('守卫：窄屏规则里不得出现「用 last-child 隐藏 .seal 子项」的写法', () => {
  // 更宽泛地防止同类回归：任何 `:last-child{display:none}` 若作用在 .seal/.hero 的子项上都要警惕
  const risky = [...html.matchAll(/\.(seal|hero)\s*>\s*[^{]*:last-child\{[^}]*display:\s*none/g)].map((m) => m[0]);
  assert.deepEqual(risky, [],
    `以下规则依赖 :last-child 隐藏结构子项，容易被后加兄弟元素破坏：\n  ${risky.join('\n  ')}`);
});
