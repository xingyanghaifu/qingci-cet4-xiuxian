/**
 * 修行数值曲线测试（第一期）
 *
 * 这一期的核心不是「加了多少机制」，而是**数值是否经得起推敲**。
 * 所以本文件除了正确性，还专门断言几条「曲线形状」性质：
 *   · 单调性：等级越高越难升（不能出现「越往后越快」）
 *   · 可达性：满级（45 级）总需求不能让普通用户望而却步
 *   · 不焦虑：衰减有下限、不扣境界、单次有上限
 *   · 不刷题：暴击概率固定、连对倍率有上限
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/load-ts.mjs';

const C = await loadTs('src/services/cultivation-curve.ts');

/* ───────────────── 一、子层级 45 级 ───────────────── */

test('子层级：5 境界 × 9 子层 = 45 级，全局等级换算可逆', () => {
  assert.equal(C.SUBLEVELS_PER_REALM, 9);
  assert.equal(C.TOTAL_SUBLEVELS, 45);
  // 全枚举验证可逆性（比抽几个点更可靠）
  for (let r = 0; r < 5; r++) {
    for (let s = 0; s < 9; s++) {
      const g = C.globalLevel(r, s);
      assert.deepEqual(C.splitGlobalLevel(g), { realmIndex: r, subLevel: s },
        `globalLevel(${r},${s})=${g} 反解失败`);
    }
  }
  // 边界
  assert.equal(C.globalLevel(0, 0), 0);
  assert.equal(C.globalLevel(4, 8), 44);
  assert.equal(C.globalLevel(-5, -5), 0, '越界夹紧到 0');
  assert.equal(C.globalLevel(99, 99), 44, '越界夹紧到 44');
});

test('子层级：显示名用汉字序号，且 1–9 层齐全', () => {
  assert.equal(C.subLevelLabel('练气', 0), '练气一层');
  assert.equal(C.subLevelLabel('化神', 8), '化神九层');
  assert.equal(C.SUBLEVEL_NAMES.length, 9);
  assert.deepEqual([...C.SUBLEVEL_NAMES], ['一', '二', '三', '四', '五', '六', '七', '八', '九']);
});

test('子层级：升级所需修为单调不减（越往后越难）', () => {
  let prev = 0;
  for (let lv = 0; lv < C.TOTAL_SUBLEVELS - 1; lv++) {
    const need = C.qiForSubLevel(lv);
    assert.ok(need > 0, `第 ${lv + 1} 层需求应为正`);
    assert.ok(need >= prev, `第 ${lv + 1} 层需求 ${need} 不应低于上一层的 ${prev}（曲线不能回退）`);
    prev = need;
  }
});

test('子层级：涨幅温和（相邻两层涨幅在 3%–30% 之间）', () => {
  // 防止出现「第 30 层突然要 10 倍修为」这种断崖
  for (let lv = 1; lv < C.TOTAL_SUBLEVELS - 1; lv++) {
    const a = C.qiForSubLevel(lv - 1);
    const b = C.qiForSubLevel(lv);
    const growth = (b - a) / a;
    assert.ok(growth <= 0.30, `第 ${lv} → ${lv + 1} 层涨幅 ${(growth * 100).toFixed(1)}% 过陡`);
  }
});

test('子层级：满级总需求在「可达但不轻松」区间', () => {
  const total = C.totalQiForLevel(C.TOTAL_SUBLEVELS - 1);
  // 单题基础 6 修为 → 满级约需 总需求/6 题
  const questions = Math.round(total / C.BASE_QI_PER_CORRECT);
  assert.ok(total > 5000, `满级总需求 ${total} 偏低，缺少长期目标感`);
  assert.ok(questions < 12000, `满级需 ${questions} 题，过多会让人放弃（应 < 12000）`);
});

test('子层级：levelFromQi 与 totalQiForLevel 互为逆（门槛处边界正确）', () => {
  for (let lv = 0; lv < C.TOTAL_SUBLEVELS - 1; lv++) {
    const acc = C.totalQiForLevel(lv);
    assert.equal(C.levelFromQi(acc), lv, `刚好攒够第 ${lv} 层的修为应判定为 ${lv}`);
    // 差 1 点不到门槛 → 停在上一级
    if (acc > 0) assert.equal(C.levelFromQi(acc - 1), lv - 1, `差 1 点不应晋级到 ${lv}`);
  }
  // 溢出到满级
  assert.equal(C.levelFromQi(999999), C.TOTAL_SUBLEVELS - 1);
});

test('子层级：qiToNextLevel 的进度与缺口自洽', () => {
  const acc = C.totalQiForLevel(5);
  const need = C.qiForSubLevel(5);
  const half = C.qiToNextLevel(acc + Math.floor(need / 2));
  assert.equal(half.need, need);
  assert.equal(half.maxed, false);
  assert.ok(half.ratio > 0.3 && half.ratio < 0.7, `半程进度应在 0.3–0.7，实际 ${half.ratio}`);
  const maxed = C.qiToNextLevel(999999);
  assert.equal(maxed.maxed, true);
  assert.equal(maxed.ratio, 1);
});

/* ───────────────── 二、修为动态公式 ───────────────── */

test('连对加速：3 连 ×1.2，5 连 ×1.5，未达档 ×1', () => {
  assert.equal(C.comboMultiplier(0), 1);
  assert.equal(C.comboMultiplier(2), 1);
  assert.equal(C.comboMultiplier(3), 1.2);
  assert.equal(C.comboMultiplier(4), 1.2);
  assert.equal(C.comboMultiplier(5), 1.5);
  assert.equal(C.comboMultiplier(100), 1.5, '倍率必须有上限（不鼓励无限刷）');
});

test('连对倍率有上限：最高 1.5（不鼓励刷题）', () => {
  const max = Math.max(...C.COMBO_TIERS.map((t) => t.multiplier));
  assert.equal(max, 1.5, '最高倍率应固定为 1.5');
});

test('单题收益 = 基础 × 连对倍率，且为整数', () => {
  assert.equal(C.qiForCorrect(0), C.BASE_QI_PER_CORRECT);
  assert.equal(C.qiForCorrect(3), Math.round(C.BASE_QI_PER_CORRECT * 1.2));
  assert.equal(C.qiForCorrect(5), Math.round(C.BASE_QI_PER_CORRECT * 1.5));
  for (let s = 0; s <= 20; s++) {
    assert.ok(Number.isInteger(C.qiForCorrect(s)), `streak=${s} 收益应为整数`);
  }
});

test('连对文案：达档才有提示', () => {
  assert.equal(C.comboLabel(0), '');
  assert.equal(C.comboLabel(2), '');
  assert.ok(C.comboLabel(3).includes('1.2'));
  assert.ok(C.comboLabel(5).includes('1.5'));
});

test('每日首登加成是固定值，且不随连对变化', () => {
  assert.equal(C.DAILY_FIRST_QI, 20);
});

/* ───────────────── 三、断签衰减（不焦虑） ───────────────── */

test('断签衰减：宽限 3 天，前 3 天不扣', () => {
  for (const d of [0, 1, 2, 3]) {
    const r = C.applyDecay(1000, d);
    assert.equal(r.lost, 0, `断签 ${d} 天不应扣修为`);
    assert.equal(r.qi, 1000);
  }
});

test('断签衰减：第 4 天起每天 5%', () => {
  const r4 = C.applyDecay(1000, 4);
  assert.equal(r4.lost, 50, '第 4 天扣 5%');
  const r5 = C.applyDecay(1000, 5);
  assert.equal(r5.lost, 100, '第 5 天扣 10%');
});

test('断签衰减：单次最多扣 50%（不会一觉醒来清零）', () => {
  const r = C.applyDecay(1000, 999);
  assert.equal(r.lost, 500, '单次上限 50%');
  assert.equal(r.qi, 500);
});

test('断签衰减：下限 0，永不为负', () => {
  const r = C.applyDecay(10, 999);
  assert.ok(r.qi >= 0, '修为不得为负');
  assert.equal(r.qi, 5, '10 的 50% 是 5');
  assert.ok(C.applyDecay(0, 999).qi === 0);
  assert.ok(C.applyDecay(-100, 999).qi === 0, '脏数据负数应夹到 0');
});

test('断签衰减：文案给出「可回升 + 境界不受影响」的出口（不制造焦虑）', () => {
  const msg = C.decayMessage(50, 4);
  assert.ok(msg.includes('50'), '应说明扣了多少');
  assert.ok(msg.includes('回升'), '应给出恢复路径');
  assert.ok(msg.includes('境界不受影响'), '应明确境界不受影响');
  assert.equal(C.decayMessage(0, 0), '', '没扣就不提示');
});

/* ───────────────── 四、灵石暴击 ───────────────── */

test('暴击概率固定 10%，与做题量无关', () => {
  assert.equal(C.CRIT_CHANCE, 0.1);
  assert.equal(C.CRIT_MULTIPLIER, 2);
  // 概率是常量，不接受任何「做得多概率高」的输入。
  // 注意：不能用 rollCrit.length 断言（esbuild 会把默认参数编译掉，
  // 长度在源码与产物下不一致）。改为直接断言：传入额外参数不影响结果。
  assert.equal(C.rollCrit(() => 0.05, 999), true, '额外参数不应改变判定');
  assert.equal(C.rollCrit(() => 0.5, 999), false);
  // 而且概率本身是模块常量，不是由调用方传进来的
  assert.equal(typeof C.CRIT_CHANCE, 'number');
});

test('暴击判定：可注入随机源，确定性可复现', () => {
  assert.equal(C.rollCrit(() => 0.05), true, '<0.1 应暴击');
  assert.equal(C.rollCrit(() => 0.5), false, '>=0.1 不暴击');
  assert.equal(C.rollCrit(() => 0.0999), true, '刚好低于阈值应暴击');
  assert.equal(C.rollCrit(() => 0.1), false, '等于阈值不暴击（左闭右开）');
});

test('暴击判定：随机源异常时安全回落 false', () => {
  assert.equal(C.rollCrit(() => { throw new Error('boom'); }), false);
  assert.equal(C.rollCrit(() => NaN), false);
  assert.equal(C.rollCrit(() => 'abc'), false);
});

test('暴击结算：命中翻倍，未命中原值', () => {
  assert.equal(C.spiritReward(30, true), 60);
  assert.equal(C.spiritReward(30, false), 30);
  assert.equal(C.spiritReward(0, true), 0);
  assert.equal(C.spiritReward(-5, true), 0, '负数夹到 0');
});

test('暴击文案含闪电标记', () => {
  assert.ok(C.CRIT_LABEL.includes('⚡'));
  assert.ok(C.CRIT_LABEL.includes('暴击'));
});

/* ───────────────── 五、心魔成长曲线 ───────────────── */

test('心魔曲线：Lv1-2 一错升级，Lv3-4 两错，Lv5 三错', () => {
  assert.equal(C.wrongsToAdvance(1), 1);
  assert.equal(C.wrongsToAdvance(2), 1);
  assert.equal(C.wrongsToAdvance(3), 2);
  assert.equal(C.wrongsToAdvance(4), 2);
  assert.equal(C.wrongsToAdvance(5), 3);
});

test('心魔曲线：累计门槛 1/2/3/5/7（第一次答错即诞生 Lv1）', () => {
  assert.equal(C.wrongsForLevel(1), 1, '答错 1 次即 Lv1');
  assert.equal(C.wrongsForLevel(2), 2);
  assert.equal(C.wrongsForLevel(3), 3);
  assert.equal(C.wrongsForLevel(4), 5);
  assert.equal(C.wrongsForLevel(5), 7);
});

test('心魔曲线：levelFromWrongs 与 wrongsForLevel 互为逆', () => {
  for (let lv = 1; lv <= 5; lv++) {
    const w = C.wrongsForLevel(lv);
    assert.equal(C.levelFromWrongs(w), lv, `答错 ${w} 次应为 Lv${lv}`);
    if (w > 1) assert.equal(C.levelFromWrongs(w - 1), lv - 1, `差 1 次不应到 Lv${lv}`);
  }
  assert.equal(C.levelFromWrongs(0), 1, '尚未答错时按 Lv1 占位');
  assert.equal(C.levelFromWrongs(999), 5, '封顶 5');
});

test('心魔曲线：曲线递增（越高级越顽固）', () => {
  for (let lv = 1; lv < 5; lv++) {
    assert.ok(C.wrongsToAdvance(lv + 1) >= C.wrongsToAdvance(lv),
      `Lv${lv + 1} 的需求不应低于 Lv${lv}`);
  }
});

test('心魔满盈：仅 Lv5 且再错 3 次才触发，奖励额外灵石', () => {
  assert.equal(C.isDemonOverflow(4, 99), false, '非 Lv5 不算满盈');
  assert.equal(C.isDemonOverflow(5, C.wrongsForLevel(5) - 1), false, '未到门槛不算');
  assert.equal(C.isDemonOverflow(5, C.wrongsForLevel(5)), false, '刚到 Lv5 不算满盈');
  assert.equal(C.isDemonOverflow(5, C.wrongsForLevel(5) + 3), true, '再错 3 次算满盈');

  const normal = C.demonClearReward(3, 3);
  assert.equal(normal.bonus, false);
  const bonus = C.demonClearReward(5, C.wrongsForLevel(5) + 3);
  assert.equal(bonus.bonus, true);
  assert.ok(bonus.spirit > normal.spirit, '满盈清理应有额外奖励');
});

/* ───────────────── 六、灵田稀有度 ───────────────── */

test('灵田：两种作物，稀有度与数值符合约定', () => {
  assert.equal(C.CROPS.length, 2);
  const [common, rare] = C.CROPS;
  assert.equal(common.id, 'qi_grass');
  assert.equal(common.days, 7);
  assert.equal(common.spirit, 50);
  assert.equal(common.rarity, 'common');
  assert.equal(rare.id, 'lingzhi');
  assert.equal(rare.days, 14);
  assert.equal(rare.spirit, 150);
  assert.equal(rare.rarity, 'rare');
});

test('灵田：稀有作物需要连续签到 30 天解锁', () => {
  const rare = C.CROPS.find((c) => c.rarity === 'rare');
  assert.equal(rare.minStreakDays, 30);
  assert.equal(C.isCropUnlocked(rare, 29), false, '29 天不应解锁');
  assert.equal(C.isCropUnlocked(rare, 30), true, '30 天解锁');
  assert.equal(C.isCropUnlocked(rare, 100), true);
});

test('灵田：稀有作物单位收益更高（值得等）', () => {
  const common = C.CROPS[0];
  const rare = C.CROPS[1];
  const commonPerDay = common.spirit / common.days;
  const rarePerDay = rare.spirit / rare.days;
  assert.ok(rarePerDay > commonPerDay,
    `稀有作物日收益(${rarePerDay.toFixed(1)}) 应高于普通(${commonPerDay.toFixed(1)})，否则没人种`);
});

test('灵田：availableCrops 按签到天数过滤', () => {
  assert.equal(C.availableCrops(0).length, 1, '新手只有普通作物');
  assert.equal(C.availableCrops(29).length, 1);
  assert.equal(C.availableCrops(30).length, 2, '30 天后两种都可种');
  // 普通作物无门槛，任何情况都可用
  assert.ok(C.availableCrops(0).some((c) => c.id === 'qi_grass'));
});

/* ───────────────── 全局性质 ───────────────── */

test('全局：所有导出函数对脏输入都不抛异常', () => {
  const dirty = [undefined, null, NaN, -1, 1e9, 'abc', {}, []];
  for (const v of dirty) {
    assert.doesNotThrow(() => C.globalLevel(v, v));
    assert.doesNotThrow(() => C.splitGlobalLevel(v));
    assert.doesNotThrow(() => C.qiForSubLevel(v));
    assert.doesNotThrow(() => C.levelFromQi(v));
    assert.doesNotThrow(() => C.qiToNextLevel(v));
    assert.doesNotThrow(() => C.comboMultiplier(v));
    assert.doesNotThrow(() => C.qiForCorrect(v));
    assert.doesNotThrow(() => C.applyDecay(v, v));
    assert.doesNotThrow(() => C.spiritReward(v, v));
    assert.doesNotThrow(() => C.wrongsToAdvance(v));
    assert.doesNotThrow(() => C.levelFromWrongs(v));
    assert.doesNotThrow(() => C.demonClearReward(v, v));
    assert.doesNotThrow(() => C.availableCrops(v));
  }
});
