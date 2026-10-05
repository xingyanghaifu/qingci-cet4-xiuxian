/**
 * 图标统一（v1.8.1 谕令二）接线测试
 *
 * 验收点：
 *   1. 九个导航项各自内联一枚 SVG（不靠图片、不靠字体图标）；
 *   2. 统一基线：class="ic" + 24 网格 + currentColor + 2px 描边；
 *   3. 强调点用 fill="currentColor" 且 CSS 里 stroke:none（避免描边糊点）；
 *   4. aria 不丢：svg 一律 aria-hidden="true" focusable="false"，按钮文案/aria-label 保留；
 *   5. 悬停/选中转金砂（--gold）并带辉光；
 *   6. 汉堡、作物、心魔、道场图标同基线；
 *   7. 无新增外部依赖（不得出现 <img src="http…"> 之类外链图标）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(ROOT, 'src', 'index.template.html'), 'utf8');
const staticHtml = html.replace(/<script[\s\S]*?<\/script>/g, '');

const navStart = staticHtml.indexOf('<nav class="tabs"');
const navEnd = staticHtml.indexOf('</nav>', navStart);
const nav = staticHtml.slice(navStart, navEnd);
const NAV_KEYS = ['paper', 'trial', 'trial', 'speak', 'book', 'codex', 'map', 'duel', 'field'];
const NAV_LABELS = ['试炼殿', '背单词', '单题', '口语', '心魔', '词谱', '卷面', '斗法场', '灵田'];

test('导航：九项各一枚内联 SVG，网格与描边统一', () => {
  const buttons = nav.match(/<button[\s\S]*?<\/button>/g) || [];
  assert.strictEqual(buttons.length, 9, '导航必须 9 项');
  buttons.forEach((b, i) => {
    const svgs = b.match(/<svg[\s\S]*?<\/svg>/g) || [];
    assert.strictEqual(svgs.length, 1, `第 ${i + 1} 项须恰好一枚内联 SVG（实得 ${svgs.length}）`);
    const svg = svgs[0];
    assert.ok(svg.includes('class="ic"'), `第 ${i + 1} 项缺统一类名 ic`);
    assert.ok(svg.includes('viewBox="0 0 24 24"'), `第 ${i + 1} 项非 24 网格`);
    assert.ok(svg.includes('stroke="currentColor"'), `第 ${i + 1} 项未用 currentColor`);
    assert.ok(svg.includes('stroke-width="2"'), `第 ${i + 1} 项描边非 2px`);
    assert.ok(svg.includes('fill="none"'), `第 ${i + 1} 项须 fill:none 起手`);
    assert.ok(svg.includes('aria-hidden="true"'), `第 ${i + 1} 项 svg 缺 aria-hidden`);
    assert.ok(svg.includes('focusable="false"'), `第 ${i + 1} 项 svg 缺 focusable=false`);
    assert.ok(b.includes('>' + NAV_LABELS[i] + '<'), `第 ${i + 1} 项文案须为 ${NAV_LABELS[i]}`);
    assert.ok(b.includes('data-tab="' + NAV_KEYS[i] + '"'), `第 ${i + 1} 项 data-tab 须为 ${NAV_KEYS[i]}`);
  });
});

test('导航：每枚图标都有强调点（不是纯线条的空图标）', () => {
  const svgs = nav.match(/<svg[\s\S]*?<\/svg>/g) || [];
  svgs.forEach((svg, i) => {
    assert.ok(
      /<(circle|rect)[^>]*fill="currentColor"/.test(svg),
      `第 ${i + 1} 枚导航图标缺强调点（fill="currentColor" 元素）`,
    );
  });
});

test('图标基线 CSS 存在：.ic 统一描边、强调点不描边', () => {
  assert.ok(html.includes('.ic{fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;overflow:visible}'),
    '缺 .ic 基线规则');
  assert.ok(html.includes('.ic [fill="currentColor"]{stroke:none}'), '强调点未去描边');
});

test('悬停/选中：导航图标与汉堡转金砂并带辉光', () => {
  assert.ok(html.includes('.nav-menu .tabs button:hover svg,.nav-menu .tabs button.on svg{color:var(--gold);'),
    '导航图标未在悬停/选中时转金砂');
  assert.ok(html.includes('filter:drop-shadow(0 0 5px color-mix(in srgb,var(--gold) 45%,transparent))'),
    '缺金砂辉光');
  assert.ok(html.includes('.menu-btn:hover svg,.menu-btn[aria-expanded="true"] svg{color:var(--gold);'),
    '汉堡图标未随态转金砂');
  assert.ok(html.includes('.nav-menu .tabs button.on .lbl{color:var(--gold)}'), '选中项文案未转金砂');
});

test('汉莓菜单：aria 三件套保留 + 图标同基线', () => {
  const m = html.match(/<button type="button" class="menu-btn" id="menuBtn"[^>]*>[\s\S]*?<\/button>/);
  assert.ok(m, 'menuBtn 缺失');
  for (const a of ['aria-label="打开导航菜单"', 'aria-haspopup="menu"', 'aria-expanded="false"', 'aria-controls="navMenu"']) {
    assert.ok(m[0].includes(a), `menuBtn 缺 ${a}`);
  }
  assert.ok(m[0].includes('class="ic"'), '汉堡图标未走统一基线');
});

test('灵田/道场/心魔图标同基线（currentColor + 去描边点）', () => {
  // 作物图标
  for (const key of ['qi_grass', 'memory_flower', 'enlighten_tree']) {
    const m = html.match(new RegExp("    " + key + ": '(<svg[\\s\\S]*?</svg>)'"));
    assert.ok(m, `作物 ${key} 图标缺失`);
    assert.ok(m[1].includes('class="ic"') && m[1].includes('stroke="currentColor"'), `作物 ${key} 未统一基线`);
  }
  // 道场设施图标
  for (const key of ['scripture_hall', 'alchemy_room', 'arena']) {
    const m = html.match(new RegExp("    " + key + ": '([\\s\\S]*?)',?\\n"));
    assert.ok(m, `设施 ${key} 图标缺失`);
    assert.ok(m[1].includes('<path') || m[1].includes('<circle'), `设施 ${key} 应为路径/圆点`);
    assert.ok(/<(circle|rect)[^>]*fill="currentColor"/.test(m[1]), `设施 ${key} 缺强调点`);
  }
  // 心魔占位
  const dm = html.match(/function demonArt[\s\S]*?<\/svg><\/span>';/);
  assert.ok(dm, 'demonArt 缺失');
  assert.ok(dm[0].includes('data-image-slot='), '心魔占位必须保留 data-image-slot');
  assert.ok(dm[0].includes('stroke="currentColor"'), '心魔占位未走 currentColor');
  assert.ok(dm[0].includes('<text'), '心魔占位保留等级数字');
  // 三处 CSS 都要有去描边规则
  for (const sel of ['.plot-art svg [fill="currentColor"]', '.demon-art svg [fill="currentColor"]', '.fac-art svg [fill="currentColor"]']) {
    assert.ok(html.includes(sel), `缺 ${sel}`);
  }
});

test('成熟灵植呼吸：唯一常驻循环动效，reduced-motion 下仍在但幅度最小', () => {
  assert.ok(html.includes('@keyframes plotBreath'), '缺 plotBreath 关键帧');
  assert.ok(html.includes('.plot.mature .plot-art{color:var(--gold);') , '成熟作物未转金砂');
  assert.ok(html.includes('@media (prefers-reduced-motion:reduce){.plot.mature .plot-art{animation:plotBreath 7.2s ease-in-out infinite!important}}'),
    'reduced-motion 下未保留成熟作物呼吸');
  assert.ok(html.includes(':root[data-motion="reduced"] .plot.mature .plot-art{animation:plotBreath 7.2s ease-in-out infinite!important}'),
    '站内「减少动态」偏好下未保留成熟作物呼吸');
});

test('零外部依赖：图标不外链、不引字体图标', () => {
  assert.ok(!/<svg[^>]*(?:xlink:href|href)\s*=/.test(html), '图标不得外链');
  assert.ok(!/class="[^"]*fa-[a-z]/i.test(html), '不得引入 Font Awesome 类名');
  // 既有 data:image/svg+xml 图标仍保留（favicon / apple-touch-icon），不算外链依赖
  assert.ok(html.includes('rel="icon"'), 'favicon 应保留');
});

test('构建产物同步：dist 内图标基线与模板一致', () => {
  const distPath = resolve(ROOT, 'dist', 'index.html');
  let dist = '';
  try {
    dist = readFileSync(distPath, 'utf8');
  } catch {
    return; // 未构建时跳过（npm test 前应先 build）
  }
  assert.ok(dist.includes('.ic{fill:none;stroke:currentColor;stroke-width:2;'), 'dist 缺 .ic 基线');
  assert.ok(dist.includes('plotBreath'), 'dist 缺 plotBreath');
  // 统一基线图标：9 枚导航 + 1 枚汉堡 + 3 枚作物 = 13
  assert.strictEqual(
    (dist.match(/class="ic" viewBox="0 0 24 24"/g) || []).length,
    13,
    'dist 统一基线图标应为 13（9 导航 + 汉堡 + 3 作物）',
  );
});