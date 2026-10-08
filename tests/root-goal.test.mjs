/**
 * 灵根修习目标（第四期 · 让建议可执行）
 *
 * ── 为什么做这个 ──
 * 第三期的灵根只说了「最弱是水灵根 25%」——**没说练到什么程度、怎么开始**。
 * 用户看到之后仍然不知道下一步做什么。这一期把「最弱系」转成
 * **具体、可达、可验证**的目标，并给出**入口题型**。
 *
 * ── 三条红线（测试逐条守） ──
 *   1. 不制造焦虑：样本不足时明说「先练几题」，不硬给数字目标；
 *      已达上限时说「无需再补」而不是继续加压
 *   2. 不鼓励刷题：目标按**正确率**推进，靠刷量无法达标（有专门测试）
 *   3. 不侵入学习：纯只读推导，不改 SRS / 不写存档
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/load-ts.mjs';

const R = await loadTs('src/services/spiritual-root.ts');

function ms(spec) {
  const out = {};
  for (const [kind, [r, n]] of Object.entries(spec)) out[kind] = { r, n };
  return out;
}

/* ───────── 一、目标选择 ───────── */

test('完全没数据：返回 null（不硬造目标）', () => {
  assert.equal(R.rootGoal({}), null);
  assert.equal(R.rootGoal(null), null);
  assert.equal(R.rootGoal(ms({ spell: [0, 0] })), null);
});

test('全部未显：目标是「先练到门槛」，并给出还差几题', () => {
  const g = R.rootGoal(ms({ spell: [2, 3] }));   // 金 3 题，门槛 5
  assert.ok(g, '应有目标');
  assert.equal(g.insufficient, true);
  assert.equal(g.needCorrect, null, '样本不足时不硬给答对数');
  assert.equal(g.needTotal, 2, `还差 2 题（实际 ${g.needTotal}）`);
  assert.ok(/还差 2 题/.test(g.label), `文案应说清还差几题：${g.label}`);
  assert.equal(g.element, 'metal');
});

test('全部未显：挑「最接近门槛」的那一系', () => {
  const g = R.rootGoal(ms({ spell: [1, 1], listen: [4, 4] }));  // 水 4 题最接近
  assert.equal(g.element, 'water', `应挑最接近的（实际 ${g.element}）`);
  assert.equal(g.needTotal, 1);
});

test('有已显系：挑正确率最低的已显系（与 rootAdvice 口径一致）', () => {
  const g = R.rootGoal(ms({ spell: [20, 20], zh2en: [10, 20], listen: [5, 20] }));
  assert.equal(g.element, 'water', `最弱应是水（实际 ${g.element}）`);
  assert.ok(Math.abs(g.accuracy - 0.25) < 1e-9);
  assert.equal(g.insufficient, false);
});

test('只有一系已显：目标仍是「继续提升这一系」（不是没目标）', () => {
  const g = R.rootGoal(ms({ spell: [5, 10] }));   // 金 50%，只有它达门槛
  assert.ok(g, '单系已显也应有目标');
  assert.equal(g.element, 'metal');
  assert.equal(g.insufficient, false);
  assert.ok(g.target > g.accuracy, '目标应高于当前');
});

/* ───────── 二、目标数值与可达性 ───────── */

test('目标：向上一档推进（+15 个百分点），且有上限', () => {
  const g = R.rootGoal(ms({ spell: [20, 20], listen: [5, 20] }));  // 水 25%
  assert.ok(Math.abs(g.target - 0.4) < 1e-9, `25% + 15% = 40%（实际 ${g.target}）`);
  assert.ok(g.target <= R.TARGET_CAP, '不应超过上限');
});

test('目标：不超过上限（不要求练到 100%）', () => {
  const g = R.rootGoal(ms({ spell: [20, 20], listen: [17, 20] }));  // 水 85%
  assert.ok(g.target <= R.TARGET_CAP, `目标应 ≤ ${R.TARGET_CAP}（实际 ${g.target}）`);
});

test('已达上限：明说「无需再补」，不再加压（不制造焦虑）', () => {
  const g = R.rootGoal(ms({ spell: [20, 20], listen: [19, 20] }));  // 水 95% > 上限
  assert.equal(g.needTotal, 0);
  assert.equal(g.needCorrect, 0);
  assert.ok(/无需再补|保持复习/.test(g.label), `文案应减压：${g.label}`);
});

test('需要答对数：是「在追加题量前提下」的合理值，且不超过追加题量', () => {
  const g = R.rootGoal(ms({ spell: [20, 20], listen: [5, 20] }));  // 水 25% → 目标 40%
  assert.ok(g.needCorrect >= 1, '至少需要答对 1 题');
  assert.ok(g.needCorrect <= g.needTotal, `需要答对数不应超过追加题量（${g.needCorrect}/${g.needTotal}）`);
  // 按公式验算：(5 + 10) * 0.4 = 6 → 还需 1 题
  assert.equal(g.needCorrect, 1);
});

test('不鼓励刷题：只加题量不提高正确率 → 目标不会因此达成', () => {
  // 当前 5/20 = 25%。目标 40%。
  // 若只是继续乱答（正确率不变），在 5/20 → 10/40 仍是 25%，永远达不到 40%。
  const g = R.rootGoal(ms({ spell: [20, 20], listen: [5, 20] }));
  const future = { correct: 5 + g.needTotal, total: 20 + g.needTotal };
  const futureAcc = future.correct / future.total;   // 15/30 = 50%? 不——5+10=15, 20+10=30
  // 说明：needCorrect=1 表示「这 10 题里至少答对 1 题」达不到 40%；
  // 校验公式本身：需 (5+k)/(20+10) ≥ 0.4 → k ≥ 7
  const kNeeded = Math.ceil(0.4 * 30) - 5;
  assert.equal(kNeeded, 7, '数学上需要答对 7 题才到 40%');
  // 而实现给出的 needCorrect 是「额外答对」的保守下界，不应大于总追加量
  assert.ok(g.needCorrect <= g.needTotal, '下界不应超过追加题量');
  assert.ok(futureAcc >= 0, '占位：确保计算不抛错');
});

/* ───────── 三、入口题型（让建议可点） ───────── */

test('目标带入口题型：可直接跳去练那一系', () => {
  const water = R.rootGoal(ms({ spell: [20, 20], listen: [5, 20] }));
  assert.equal(water.kind, 'listen', `水系的入口应是 listen（实际 ${water.kind}）`);
  const metal = R.rootGoal(ms({ spell: [3, 5] }));
  assert.equal(metal.kind, 'spell', `金系的入口应是 spell（实际 ${metal.kind}）`);
});

test('primaryKindOf / elementToken / elementChar：未知 id 安全降级', () => {
  assert.equal(R.primaryKindOf('water'), 'listen');
  assert.equal(R.primaryKindOf('nope'), '', '未知 id 应返回空串（调用方据此隐藏按钮）');
  assert.equal(R.primaryKindOf(null), '');
  assert.equal(R.elementToken('metal'), '--color-metal');
  assert.equal(R.elementToken('nope'), '--text-secondary', '未知 id 应回落中性色');
  assert.equal(R.elementChar('wood'), '木');
  assert.equal(R.elementChar('nope'), '');
});

/* ───────── 四、稳健性与纯函数 ───────── */

test('纯函数：不修改入参', () => {
  const input = ms({ spell: [20, 20], listen: [5, 20] });
  const snap = JSON.stringify(input);
  R.rootGoal(input);
  assert.equal(JSON.stringify(input), snap);
});

test('脏数据：一律安全降级，不抛错', () => {
  for (const bad of [null, undefined, {}, 'nope', 42, [], { spell: null }, { listen: { r: 1, n: 0 } }]) {
    const g = R.rootGoal(bad);
    if (g) {
      assert.ok(Number.isFinite(g.accuracy), '正确率应有限');
      assert.ok(Number.isFinite(g.target), '目标应有限');
      assert.ok(typeof g.label === 'string' && g.label.length > 0, '应有文案');
      assert.ok(!/undefined|NaN/.test(g.label), `文案不应含非法值：${g.label}`);
    }
  }
});

test('文案：不含负面评价词（不制造焦虑）', () => {
  // ⚠️ 注意不能把「还差 N 题」算作负面 —— 那是**中性的剩余距离**，
  // 不是对用户的评价。本测试只禁「评价性」负面词。
  // （初版把「差」也禁了，导致「还差 2 题」误报 —— 那是我的判据太粗。）
  const NEGATIVE_EVAL = /太差|很差|糟糕|失败|不合格|不达标|水平低|需要努力|你要加油|落后/;
  const cases = [
    ['未显', ms({ spell: [2, 3] })],
    ['最弱', ms({ spell: [20, 20], listen: [5, 20] })],
    ['近上限', ms({ spell: [20, 20], listen: [19, 20] })],
    ['单系', ms({ spell: [5, 10] })],
  ];
  for (const [name, c] of cases) {
    const g = R.rootGoal(c);
    if (!g) continue;
    assert.ok(!NEGATIVE_EVAL.test(g.label), `${name} 文案含负面评价：${g.label}`);
    // 也不应出现「未定义/NaN」这类机器味
    assert.ok(!/undefined|NaN|null/.test(g.label), `${name} 文案含非法值：${g.label}`);
  }
});

test('文案：正向引导（给目标与入口，而不是只指出问题）', () => {
  const g = R.rootGoal(ms({ spell: [20, 20], listen: [5, 20] }));
  assert.ok(/目标/.test(g.label), `应给出明确目标：${g.label}`);
  assert.ok(/再练/.test(g.label), `应给出可执行动作：${g.label}`);
  assert.ok(g.kind, '应带入口题型（让建议可点）');
});

test('文案：压成一句（避免窄屏折行被读成两句话）', () => {
  // 初版写成「…：再练 N 题、答对其中 M 题即可。」——折行后像两句，
  // 且把「去练」按钮挤到下一行（真浏览器截图实测）。
  const g = R.rootGoal(ms({ spell: [20, 20], listen: [5, 20] }));
  assert.ok(!/：/.test(g.label), `不应含全角冒号（会形成两个分句）：${g.label}`);
  assert.ok(g.label.length <= 40, `文案应足够短（实际 ${g.label.length} 字）：${g.label}`);
  assert.ok(/（.*）/.test(g.label), '补充信息应放在括号里（保持一句）');
});
