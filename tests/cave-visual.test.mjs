/**
 * 洞府装饰视觉应用（阶段 C 补全）
 *
 * ── 这份测试在防什么 ──
 * `cave.ts` 的 5 个装饰里有 **4 个是纯视觉承诺且都要花灵石**：
 *
 *   bg_ink            （ 50 灵石）'洞府铺一层水墨底色。'
 *   furniture_bamboo  （ 40 灵石）'竹影一张，石凳两把。'
 *   frame_cloud       （ 80 灵石）'云纹绕边的称号框。'
 *   frame_beast       （120 灵石）'灵兽头像框，衬得道号更精神。'
 *
 * 但模板只做了**购买与「已拥有」标记**，从未把视觉应用到界面
 * （全模板 grep `data-deco` / `cave-bg` / `title-frame` / `avatar-frame` 均 0 次）。
 * 玩家花 290 灵石买完，界面**一点变化都没有**。
 *
 * 这是本项目「定义了/实现了，但没有消费点」的**第五次**出现。
 * 所以本测试断言「已购 → 产出视觉 class」这条映射，以及模板确实消费它。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTs } from './helpers/load-ts.mjs';

const ROOT = join(import.meta.dirname, '..');
const CV = await loadTs('src/services/cave-visual.ts');

/* ───────── 一、映射正确性 ───────── */

test('未购买：不产出任何视觉 class（既有行为一字不变）', () => {
  assert.deepEqual(CV.caveVisualClasses([]), []);
  assert.deepEqual(CV.caveVisualClasses(null), []);
  assert.deepEqual(CV.caveVisualClasses(undefined), []);
  assert.equal(CV.visualDecorCount([]), 0);
  const slots = CV.caveVisualBySlot([]);
  assert.equal(slots.background, null);
  assert.equal(slots.furniture, null);
  assert.equal(slots.titleFrame, null);
  assert.equal(slots.avatarFrame, null);
});

test('四个视觉装饰各自映射到不同的 class 与槽位', () => {
  const all = ['bg_ink', 'furniture_bamboo', 'frame_cloud', 'frame_beast'];
  const classes = CV.caveVisualClasses(all);
  assert.equal(classes.length, 4);
  assert.equal(new Set(classes).size, 4, '四个 class 不应重复');
  const slots = CV.caveVisualBySlot(all);
  assert.equal(slots.background, 'deco-bg-ink');
  assert.equal(slots.furniture, 'deco-bamboo');
  assert.equal(slots.titleFrame, 'deco-frame-cloud');
  assert.equal(slots.avatarFrame, 'deco-frame-beast');
});

test('部分购买：只产出已购的（不误开未购的）', () => {
  const classes = CV.caveVisualClasses(['bg_ink', 'frame_cloud']);
  assert.deepEqual(classes.sort(), ['deco-bg-ink', 'deco-frame-cloud'].sort());
  assert.equal(CV.visualDecorCount(['bg_ink', 'frame_cloud']), 2);
  const slots = CV.caveVisualBySlot(['bg_ink', 'frame_cloud']);
  assert.equal(slots.background, 'deco-bg-ink');
  assert.equal(slots.titleFrame, 'deco-frame-cloud');
  assert.equal(slots.furniture, null, '未购买的不应产出');
  assert.equal(slots.avatarFrame, null);
});

test('灵泉（功能件）不计入视觉装饰数', () => {
  // spring_water 是 utility（灵田 -10%），不是视觉件
  assert.equal(CV.visualDecorCount(['spring_water']), 0);
  assert.deepEqual(CV.caveVisualClasses(['spring_water']), []);
  assert.equal(CV.VISUAL_DECO_TOTAL, 4, '视觉装饰应为 4 个');
});

test('未知 ID / 重复 ID / 非法类型：忽略且不抛错', () => {
  assert.deepEqual(CV.caveVisualClasses(['not_a_real_deco']), []);
  assert.equal(CV.caveVisualClasses(['bg_ink', 'bg_ink']).length, 1, '重复应去重');
  // 混入非字符串
  assert.equal(CV.caveVisualClasses(['bg_ink', null, 42, {}, '']).length, 1);
  assert.equal(CV.visualDecorCount(['bg_ink', null, 42]), 1);
});

test('纯函数：不修改入参数组', () => {
  const input = ['bg_ink', 'frame_beast'];
  const snapshot = JSON.stringify(input);
  CV.caveVisualClasses(input);
  CV.caveVisualBySlot(input);
  CV.visualDecorCount(input);
  assert.equal(JSON.stringify(input), snapshot, '入参被改动了');
});

test('返回顺序稳定（按声明顺序，便于快照比对）', () => {
  const a = CV.caveVisualClasses(['frame_beast', 'bg_ink', 'frame_cloud', 'furniture_bamboo']);
  const b = CV.caveVisualClasses(['bg_ink', 'furniture_bamboo', 'frame_cloud', 'frame_beast']);
  assert.deepEqual(a, b, '不同入参顺序应产出相同结果');
});

test('摘要：只列已购装饰的名字', () => {
  const defs = [
    { id: 'bg_ink', name: '墨韵背景' },
    { id: 'furniture_bamboo', name: '竹石桌凳' },
    { id: 'frame_cloud', name: '云纹称号框' },
    { id: 'spring_water', name: '灵泉' },
  ];
  assert.deepEqual(CV.caveDecorSummary([], defs), []);
  assert.deepEqual(CV.caveDecorSummary(['bg_ink'], defs), ['墨韵背景']);
  assert.deepEqual(CV.caveDecorSummary(['frame_cloud', 'bg_ink'], defs), ['墨韵背景', '云纹称号框']);
  assert.deepEqual(CV.caveDecorSummary(null, defs), []);
});

/* ───────── 二、与 cave.ts 的一致性 ───────── */

test('一致性：视觉映射的 ID 必须都存在于 cave.ts 的装饰表', () => {
  const caveTs = readFileSync(join(ROOT, 'src', 'services', 'cave.ts'), 'utf8');
  for (const id of Object.keys(CV.DECO_CLASS)) {
    assert.ok(caveTs.includes(`'${id}'`), `cave.ts 里找不到装饰 ${id} —— 映射表已过期`);
  }
  // 4 个视觉件都不应带 effect（effect 是功能件才有的）
  assert.equal(Object.keys(CV.DECO_CLASS).length, 4);
});

/* ───────── 三、接线契约（防「实现了但没人调用」） ───────── */

test('接线：模板必须消费 caveVisual 并把 class 挂到锚点', () => {
  const html = readFileSync(join(ROOT, 'src', 'index.template.html'), 'utf8');
  assert.ok(/caveVisual/.test(html), '模板未使用 caveVisual —— 装饰买了界面不变');
  assert.ok(/applyCaveVisual/.test(html), '模板缺 applyCaveVisual 应用函数');
  assert.ok(/applyCaveVisual\(cave\.decorations\)/.test(html),
    'applyCaveVisual 必须在 renderCave 里被调用');
  assert.ok(/bySlot/.test(html), '应使用 bySlot 按槽位挂载');
  // 四个挂载锚点都要在
  for (const anchor of ['querySelector(\'.app\')', 'aside.seal', "byId('realmName')", "byId('daoName')"]) {
    assert.ok(html.includes(anchor), `缺挂载锚点 ${anchor}`);
  }
  assert.ok(/id="caveDecoLine"/.test(html), '缺已购装饰摘要行');
});

test('接线：视觉 CSS 规则存在且零裸 hex（走既有 token）', () => {
  const html = readFileSync(join(ROOT, 'src', 'index.template.html'), 'utf8');
  for (const cls of ['deco-bg-ink', 'deco-bamboo', 'deco-frame-cloud', 'deco-frame-beast']) {
    assert.ok(html.includes('.' + cls), `缺视觉规则 .${cls}`);
  }
  // 抽查这几条规则里不得有裸 hex（本仓库硬约束）
  const start = html.indexOf('.app.deco-bg-ink');
  const end = html.indexOf('.cave-deco-line');
  assert.ok(start > 0 && end > start, '找不到装饰视觉规则段');
  const block = html.slice(start, end);
  const rawHex = block.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  assert.deepEqual(rawHex, [], '装饰视觉规则含裸 hex：' + rawHex.join(', '));
  assert.ok(/var\(--color-wood\)/.test(block), '应复用 --color-wood token');
  assert.ok(/var\(--gold\)/.test(block), '应复用 --gold token');
});
