/**
 * 掌握阶段接线（v1.11 第四轮）—— 「掌握→反馈」方向
 *
 * ── 真实缺陷 ──
 * 第三轮我在 `learning-value.ts` 里定义了 `masteryStage()` 与 `MASTERY_LABEL`，
 * 并在服务表注册为 `stage` / `STAGE_LABEL` —— 但**模板从未消费**：
 *
 *     masteryStage   html=false  index=true  as stage 被用=false
 *     MASTERY_LABEL  html=false  index=true  as STAGE_LABEL 被用=false
 *
 * 而词谱只显示两个粗粒度标记（「心魔」/「已斩」），
 * **看不出「练到什么程度」** —— 这正是目标要求的「掌握→反馈」方向缺失。
 *
 * 注意：消费点扫描器把它归到「低可疑（别名/预留）」而没报错 ——
 * 说明**扫描器对「注册了别名但别名未被消费」这种情况不够敏感**。
 * 本轮顺带把它接上真实消费点。
 *
 * ── 口径一致性 ──
 * 四档必须与 `FRESHNESS_STEPS`（收益递减）同源：
 *   0 次 = 生词、1 次 = 初识、2 次 = 熟悉、3+ = 已掌握
 * 若两处口径分叉，用户会看到「显示已掌握但收益还在最低档」的矛盾。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTs } from './helpers/load-ts.mjs';

const ROOT = join(import.meta.dirname, '..');
const L = await loadTs('src/services/learning-value.ts');
const html = readFileSync(join(ROOT, 'src', 'index.template.html'), 'utf8');

/* ───────── 一、接线：必须有真实消费点 ───────── */

test('接线：模板必须消费 masteryStage（此前定义了却没人用）', () => {
  assert.ok(/masteryStageFor\(/.test(html),
    '模板未消费 masteryStage —— 「掌握→反馈」方向仍然缺失');
  assert.ok(/masteryInfoFor\(/.test(html), '缺掌握阶段展示封装');
  assert.ok(/L\.stage\(/.test(html), '应经服务层取阶段（口径只有一处）');
  assert.ok(/STAGE_LABEL/.test(html), '应使用服务层的中文名表');
});

test('接线：词谱必须真的渲染掌握阶段标签（不只是取到值）', () => {
  assert.ok(/ms-tag/.test(html), '缺 .ms-tag 样式');
  assert.ok(/ms-.*mi\.stage|mi\.stage/.test(html), '标签未按阶段区分 class');
  assert.ok(/masteryInfoFor\(w\.w\)/.test(html), '词谱行未使用掌握阶段');
  // 生词是默认态且占多数（70 行里大多为生词），全标 = 视觉噪声 → 不显示标签
  assert.ok(/mi\.stage!=="new"/.test(html), '生词不应显示标签（避免视觉噪声）');
});

test('接线：粗粒度旧标记必须被替换（不能两套并存）', () => {
  // 旧写法只有「心魔 / 已斩」两种状态
  assert.ok(!/state\.known\[w\.w\]\?"已斩"/.test(html),
    '旧的「已斩」标记仍在 —— 会与新的四档标签并存，口径分叉');
});

test('接线：筛选下拉必须支持四个掌握阶段', () => {
  for (const v of ['stg-new', 'stg-learning', 'stg-familiar', 'stg-mastered']) {
    assert.ok(html.includes(v), `筛选下拉缺 ${v}`);
  }
  assert.ok(/mk\.indexOf\('stg-'\)/.test(html), '筛选逻辑未处理 stg- 前缀');
  assert.ok(/masteryStageFor\(w\.w\)===want/.test(html),
    '筛选应复用 masteryStageFor（避免两处各算一份）');
});

test('接线：掌握阶段是**只读**（不得写 known/wrong）', () => {
  const i = html.indexOf('function masteryStageFor(');
  assert.ok(i > 0, '找不到 masteryStageFor');
  const body = html.slice(i, html.indexOf('\n}', i));
  assert.ok(!/state\.known\[[^\]]*\]\s*=[^=]/.test(body), '不应写入 known');
  assert.ok(!/state\.wrong\[[^\]]*\]\s*=[^=]/.test(body), '不应写入 wrong');
  assert.ok(!/save\(/.test(body), '不应写存档');
});

test('接线：函数平级（防嵌套导致运行时未定义）', () => {
  const pairs = [
    ['function masteryStageFor(', 'function masteryInfoFor('],
    ['function masteryInfoFor(', 'function learningReasonFor('],
  ];
  for (const [a, b] of pairs) {
    const i = html.indexOf(a), j = html.indexOf(b);
    assert.ok(i > 0 && j > i, `${a} / ${b} 顺序异常`);
    const open = html.indexOf('{', i);
    let d = 0, closed = -1;
    for (let k = open; k < html.length; k++) {
      if (html[k] === '{') d++;
      else if (html[k] === '}') { d--; if (d === 0) { closed = k; break; } }
    }
    assert.ok(closed > 0 && closed < j, `${a} 被嵌套（会运行时未定义）`);
  }
});

/* ───────── 二、四档口径 ───────── */

test('阶段：0/1/2/3+ → 生词/初识/熟悉/已掌握', () => {
  assert.equal(L.masteryStage(0), 'new');
  assert.equal(L.masteryStage(1), 'learning');
  assert.equal(L.masteryStage(2), 'familiar');
  assert.equal(L.masteryStage(3), 'mastered');
  assert.equal(L.masteryStage(99), 'mastered');
});

test('口径一致性：阶段边界必须与收益递减（FRESHNESS_STEPS）同源', () => {
  // 若分叉，用户会看到「显示已掌握但收益还在最低档」的矛盾
  const steps = L.FRESHNESS_STEPS;
  assert.equal(steps.length, 4, 'FRESHNESS_STEPS 应有 4 档');
  // 阶段数也应与之对齐：new / learning / familiar / mastered
  const stages = [0, 1, 2, 3].map((n) => L.masteryStage(n));
  assert.equal(new Set(stages).size, 4, '四档应互不相同');
  // 每个阶段的「已答对次数」都应落在 FRESHNESS_STEPS 的对应索引上
  for (let n = 0; n < 4; n++) {
    const idx = Math.min(n, steps.length - 1);
    assert.ok(steps[idx] > 0, `FRESHNESS_STEPS[${idx}] 应为正`);
  }
  // 已掌握（3+）应对应最低的收益系数
  assert.equal(L.freshnessFactor(3), steps[steps.length - 1],
    '已掌握阶段应对应最低收益系数（收益递减到地板）');
});

test('阶段：每个都有中文名（界面不能显示英文 key）', () => {
  for (const s of ['new', 'learning', 'familiar', 'mastered']) {
    const label = L.MASTERY_LABEL[s];
    assert.ok(label && typeof label === 'string', `缺中文名：${s}`);
    assert.ok(!/[a-z]/.test(label), `中文名不应含英文：${label}`);
  }
  assert.equal(L.MASTERY_LABEL.new, '生词');
  assert.equal(L.MASTERY_LABEL.mastered, '已掌握');
});

test('阶段：脏数据安全降级（不抛错，按生词处理）', () => {
  for (const bad of [null, undefined, NaN, -5, 'x', {}, []]) {
    assert.equal(L.masteryStage(bad), 'new', `输入 ${JSON.stringify(bad)} 应视为生词`);
  }
  assert.equal(L.masteryStage(2.7), 'familiar', '小数应取整');
});

/* ───────── 三、与收益方向一致（双向映射自洽） ───────── */

test('双向自洽：阶段越靠后，收益系数越低（掌握→收益递减一致）', () => {
  const factors = [0, 1, 2, 3].map((n) => L.freshnessFactor(n));
  for (let i = 1; i < factors.length; i++) {
    assert.ok(factors[i] < factors[i - 1],
      `第 ${i} 档收益应低于前一档（${factors[i]} vs ${factors[i - 1]}）`);
  }
  // 即：显示「已掌握」的词，收益确实处于最低档 —— 两个方向不矛盾
  assert.equal(L.masteryStage(3), 'mastered');
  assert.equal(L.freshnessFactor(3), Math.min(...factors));
});
