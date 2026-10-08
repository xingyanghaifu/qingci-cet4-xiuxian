/**
 * 灵根（修行天赋 · 第三期）
 *
 * ── 这个机制的设计意图 ──
 * 修仙叙事里「灵根」是身份认同的核心，本项目此前完全没有（grep 0 次）。
 * 它天然能挂到**已有的真实数据**上：`state.memStats` 已按六种题型记录
 * 「答对 r / 总数 n」。于是灵根不是随机抽的，而是**从实际表现里长出来的** ——
 * 既满足叙事，又让用户看清自己的强弱项（游戏化服务于学习）。
 *
 * ── 这份测试在防什么 ──
 * 1. **映射正确**：五系 ← 六题型不能漏、不能串（漏一系就永远不显）
 * 2. **样本门槛**：防「做了 1 题全对 → 天灵根」这种荒谬结果
 * 3. **不制造焦虑**：样本不足必须明说「未显」，不能给用户贴负面标签
 * 4. **纯只读**：不改入参、不抛错（任何脏数据都要安全降级）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/load-ts.mjs';

const R = await loadTs('src/services/spiritual-root.ts');

/** 造 memStats */
function ms(spec) {
  const out = {};
  for (const [kind, [r, n]] of Object.entries(spec)) out[kind] = { r, n };
  return out;
}

/* ───────── 一、五系 ← 六题型的映射 ───────── */

test('映射：五系覆盖全部六种题型，且不重不漏', () => {
  const KINDS = ['zh2en', 'en2zh', 'similar', 'listen', 'spell', 'pos'];
  const covered = R.ELEMENTS.flatMap((e) => e.kinds);
  assert.equal(new Set(covered).size, covered.length, '一个题型不应映射到两系');
  for (const k of KINDS) {
    assert.ok(covered.includes(k), `题型 ${k} 未映射到任何一系 —— 该系将永远不显`);
  }
  assert.equal(R.ELEMENTS.length, 5, '应为五行');
  assert.deepEqual(R.ELEMENTS.map((e) => e.char), ['金', '木', '水', '火', '土'], '顺序应为金木水火土');
});

test('映射：土系承载两种题型（英译中 + 形近辨析）', () => {
  const earth = R.ELEMENTS.find((e) => e.id === 'earth');
  assert.deepEqual(earth.kinds.slice().sort(), ['en2zh', 'similar']);
});

test('映射：每系都有中文名、五行 token 与描述', () => {
  for (const e of R.ELEMENTS) {
    assert.ok(e.name && e.char && e.blurb, `${e.id} 字段不完整`);
    assert.match(e.token, /^--color-(wood|fire|earth|metal|water)$/, `${e.id} 应复用既有五行 token`);
  }
});

test('映射：每系有「能力短名」，且不与五行单字重复（避免卡片显示「金 金」）', () => {
  for (const e of R.ELEMENTS) {
    assert.ok(e.skill, `${e.id} 缺 skill（卡片第二列）`);
    assert.notEqual(e.skill, e.char, `${e.id} 的 skill 不应等于 char（会显示成「金 金」）`);
    assert.notEqual(e.skill, e.name, `${e.id} 的 skill 不应等于 name（同上）`);
  }
  // skill 必须能对上真实题型，便于用户理解「怎么修这一系」
  assert.equal(R.ELEMENTS.find((e) => e.id === 'metal').skill, '拼写');
  assert.equal(R.ELEMENTS.find((e) => e.id === 'water').skill, '听音');
});

test('映射：computeRoot 的返回项也带 skill（模板要用）', () => {
  const r = R.computeRoot({ spell: { r: 5, n: 5 } });
  for (const e of r.elements) assert.ok(e.skill, `${e.id} 的 ElementScore 缺 skill`);
  assert.equal(R.elementBreakdown({})[0].skill, '拼写');
});

/* ───────── 二、样本门槛（防荒谬结果） ───────── */

test('样本不足：明说「未显」，不给档位', () => {
  const r = R.computeRoot(ms({ spell: [1, 1] }));   // 1 题全对
  assert.equal(r.grade, 'undetermined', '1 题全对不应定灵根');
  assert.equal(r.dominant, null);
  assert.equal(r.label, '灵根未显');
  assert.equal(r.revealed.length, 0);
});

test('样本刚好达门槛：开始显灵根', () => {
  const r = R.computeRoot(ms({ spell: [5, 5] }));   // 恰好 5 题
  assert.equal(r.revealed.length, 1);
  assert.equal(r.grade, 'heaven', '只有一系已显 → 天灵根');
  assert.equal(r.dominant.id, 'metal');
  assert.equal(r.label, '金天灵根');
});

test('samplesToReveal：提示还差多少题（已显则 0）', () => {
  assert.equal(R.samplesToReveal(ms({ spell: [2, 2] })), 3, '2 题 → 还差 3');
  assert.equal(R.samplesToReveal(ms({ spell: [5, 5] })), 0, '已显 → 0');
  assert.equal(R.samplesToReveal({}), R.MIN_SAMPLES, '完全没做 → 差 MIN_SAMPLES');
  // 取最接近门槛的一系
  assert.equal(R.samplesToReveal(ms({ spell: [4, 4], listen: [1, 1] })), 1, '应取最接近的（spell 差 1）');
});

/* ───────── 三、正确率与主导判定 ───────── */

test('正确率：按 r/n 计算，与题量无关（多刷不涨纯度）', () => {
  const few = R.computeRoot(ms({ spell: [5, 5], listen: [5, 10] }));   // 金 100% / 水 50%
  const many = R.computeRoot(ms({ spell: [50, 50], listen: [50, 100] })); // 同率、十倍题量
  assert.equal(few.dominant.id, 'metal');
  assert.equal(many.dominant.id, 'metal');
  assert.ok(Math.abs(few.purity - many.purity) < 1e-9, '纯度只由正确率与分布决定，与题量无关');
});

test('主导：正确率最高者；同率时按金木水火土顺序稳定', () => {
  const tie = R.computeRoot(ms({ spell: [5, 5], listen: [5, 5] }));
  assert.equal(tie.dominant.id, 'metal', '同率应取声明顺序在前者');
  const water = R.computeRoot(ms({ spell: [5, 10], listen: [9, 10] }));
  assert.equal(water.dominant.id, 'water');
});

test('纯度：主导系作答 / 已显系总作答', () => {
  // 金 20 题、木 20 题，金正确率高 → 主导金，纯度 20/40 = 0.5
  const r = R.computeRoot(ms({ spell: [20, 20], zh2en: [10, 20] }));
  assert.equal(r.dominant.id, 'metal');
  assert.ok(Math.abs(r.purity - 0.5) < 1e-9, `纯度应为 0.5（实际 ${r.purity}）`);
  assert.equal(r.sampleTotal, 40);
});

test('土系：两题型合并计（英译中 + 形近辨析）', () => {
  const r = R.computeRoot(ms({ en2zh: [3, 5], similar: [4, 5] }));
  const earth = r.elements.find((e) => e.id === 'earth');
  assert.equal(earth.total, 10, '两题型作答应合并');
  assert.equal(earth.correct, 7);
  assert.equal(earth.accuracy, 0.7);
});

/* ───────── 四、档位判定 ───────── */

test('档位：只有一系已显 → 天灵根', () => {
  const r = R.computeRoot(ms({ spell: [10, 10] }));
  assert.equal(r.grade, 'heaven');
});

test('档位：主导纯度 ≥0.7 → 天灵根；0.45–0.7 → 双灵根；0.3–0.45 → 三灵根；<0.3 → 杂灵根', () => {
  assert.equal(R.gradeOf(2, 0.8), 'heaven');
  assert.equal(R.gradeOf(2, 0.7), 'heaven');
  assert.equal(R.gradeOf(2, 0.5), 'dual');
  assert.equal(R.gradeOf(3, 0.35), 'triple');
  assert.equal(R.gradeOf(3, 0.2), 'mixed');
  assert.equal(R.gradeOf(0, 0), 'undetermined');
});

test('档位：杂灵根是「特色」不是缺陷（不返回负面文案）', () => {
  // 五系全显且接近均匀 → 杂灵根
  const r = R.computeRoot(ms({ spell: [5, 10], zh2en: [5, 10], listen: [5, 10], pos: [5, 10], en2zh: [5, 10] }));
  assert.equal(r.grade, 'mixed');
  assert.ok(!/差|弱|失败|糟/.test(r.label), `文案不应含负面评价：${r.label}`);
});

test('档位：双/三灵根的名称列出对应系', () => {
  const dual = R.computeRoot(ms({ spell: [20, 20], zh2en: [15, 20] }));   // 金 100% 木 75%，纯度 0.5
  assert.equal(dual.grade, 'dual');
  assert.equal(dual.label, '金木双灵根');
});

/* ───────── 五、稳健性（脏数据必须安全降级） ───────── */

test('脏数据：缺字段 / 负数 / 非数字 / null 一律按 0 处理，不抛错', () => {
  for (const bad of [null, undefined, {}, 'nope', 42, [], { spell: null }, { spell: {} }]) {
    const r = R.computeRoot(bad);
    assert.equal(r.grade, 'undetermined', `输入 ${JSON.stringify(bad)} 应安全降级`);
    assert.equal(r.label, '灵根未显');
    assert.equal(r.elements.length, 5);
  }
  const weird = R.computeRoot(ms({ spell: [-5, -5], listen: ['x', 'y'], pos: [3, NaN] }));
  for (const e of weird.elements) {
    assert.ok(e.total >= 0 && e.correct >= 0, '不应出现负数');
    assert.ok(Number.isFinite(e.accuracy));
  }
});

test('防御：答对数 > 总数时夹紧为总数（不产生 >100% 正确率）', () => {
  const r = R.computeRoot(ms({ spell: [99, 5] }));
  const metal = r.elements.find((e) => e.id === 'metal');
  assert.equal(metal.correct, 5, 'correct 应夹紧到 n');
  assert.ok(metal.accuracy <= 1, `正确率不应超过 100%（实际 ${metal.accuracy}）`);
});

test('纯函数：不修改入参', () => {
  const input = ms({ spell: [5, 10] });
  const snap = JSON.stringify(input);
  R.computeRoot(input);
  R.elementBreakdown(input);
  R.rootAdvice(input);
  R.samplesToReveal(input);
  assert.equal(JSON.stringify(input), snap, '入参被改动了');
});

/* ───────── 六、学情概览与建议 ───────── */

test('breakdown：返回五系明细（含未显的系，便于看到在补哪一系）', () => {
  const b = R.elementBreakdown(ms({ spell: [5, 5], listen: [1, 2] }));
  assert.equal(b.length, 5);
  const metal = b.find((e) => e.id === 'metal');
  const water = b.find((e) => e.id === 'water');
  assert.equal(metal.revealed, true);
  assert.equal(water.revealed, false, '样本不足的系仍应返回，只是标记未显');
  assert.equal(water.total, 2);
});

test('advice：样本不足 / 只有一系时不建议（不可靠就不说）', () => {
  assert.equal(R.rootAdvice(ms({})), '', '无样本不应给建议');
  assert.equal(R.rootAdvice(ms({ spell: [5, 5] })), '', '只有一系不应给建议');
});

test('advice：两系以上时指出最弱的一系（可执行）', () => {
  const a = R.rootAdvice(ms({ spell: [20, 20], listen: [4, 20] }));
  assert.ok(a.includes('水灵根'), `应指出最弱为水灵根：${a}`);
  assert.ok(/20%/.test(a), `应含具体正确率：${a}`);
  assert.ok(/优先练/.test(a), '应给出可执行建议');
});

test('文案：未显时明说「未显」而不是给负面评价（不制造焦虑）', () => {
  const r = R.computeRoot(ms({ spell: [1, 3] }));
  assert.equal(r.label, '灵根未显');
  assert.ok(!/差|弱|失败|不足/.test(r.label));
});

test('档位文案表完整（每个档位都有中文名）', () => {
  for (const g of ['heaven', 'dual', 'triple', 'mixed', 'undetermined']) {
    assert.ok(R.GRADE_LABEL[g], `档位 ${g} 缺中文名`);
  }
});
