/**
 * 道场设施增益结算（阶段 D 补全）
 *
 * ── 这份测试在防什么 ──
 * `sect-facilities.ts` 的 3 个设施都有**面向用户的明确承诺**：
 *
 *   藏经阁（1000 灵石）'全道场成员词库详情解锁速度 +20%。'
 *   炼丹房（1500 灵石）'全道场成员每月获得 1 张护道符。'
 *   演武场（2000 灵石）'全道场成员论剑胜率加成 +5%。'
 *
 * `getFacilityBuffs()` 把它们算出来了、`QingciServices.sect.buffs` 也导出了、
 * `tests/sect.test.mjs` 也断言了数值 —— 但**模板从未调用它**（grep 0 次）。
 * 结果：玩家花 4500 灵石把三个设施全建成，**承诺的增益一个都不生效**。
 *
 * 这是本项目「服务层写了、测了、导出了，模板没有消费点」的**第四次**出现
 * （前三次：5/6 空头支票奇遇、listPending 无人调用、斗法奖励口径）。
 *
 * 所以本测试断言的是**可观察的结算结果**（折扣价、发放张数、加成后的分数），
 * 而不是「某个字符串存在」。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTs } from './helpers/load-ts.mjs';

const ROOT = join(import.meta.dirname, '..');
const SB = await loadTs('src/services/sect-buffs.ts');

/** 内存 storage */
function memStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
  };
}

const OCT = new Date(2026, 9, 8, 12, 0, 0).getTime();   // 本地 2026-10-08
const NOV = new Date(2026, 10, 3, 12, 0, 0).getTime();  // 本地 2026-11-03

/* ───────── 一、藏经阁：参悟古籍折扣 ───────── */

test('藏经阁：未建成时原价（既有行为一字不变）', () => {
  assert.equal(SB.discountedBookPrice(50, 0), 50);
  assert.equal(SB.discountedBookPrice(50, undefined), 50);
  assert.equal(SB.discountedBookPrice(50, null), 50);
});

test('藏经阁：建成后参悟古籍 -20%（50 → 40）', () => {
  assert.equal(SB.discountedBookPrice(50, 0.2), 40);
  assert.equal(SB.DETAIL_DISCOUNT, 0.2, '折扣常量应与 sect-facilities 的 0.2 一致');
});

test('藏经阁：折扣不会把价格压到 0 或负数', () => {
  assert.ok(SB.discountedBookPrice(1, 0.2) >= 1, '最低 1 灵石，不能白送');
  assert.ok(SB.discountedBookPrice(50, 5) >= 1, '异常大的折扣也要夹紧');
  assert.equal(SB.discountedBookPrice(0, 0.2), 0, '原价 0 仍是 0');
});

/* ───────── 二、炼丹房：月度护道符（幂等） ───────── */

test('炼丹房：未建成时不发（任何月份都是 0）', () => {
  assert.equal(SB.monthlyTalismanAmount(0, null, OCT), 0);
  assert.equal(SB.shouldGrantMonthlyTalisman(0, null, OCT), false);
  assert.equal(SB.claimMonthlyTalisman(0, OCT, memStorage()), 0);
});

test('炼丹房：建成后当月发 1 张', () => {
  assert.equal(SB.monthlyTalismanAmount(1, null, OCT), 1);
  assert.equal(SB.monthlyTalismanAmount(1, '', OCT), 1);
});

test('炼丹房：同月重复调用只发一次（幂等）', () => {
  const s = memStorage();
  assert.equal(SB.claimMonthlyTalisman(1, OCT, s), 1, '首次应发');
  assert.equal(SB.claimMonthlyTalisman(1, OCT, s), 0, '同月再调不应再发');
  assert.equal(SB.claimMonthlyTalisman(1, OCT + 86400000 * 3, s), 0, '同月不同日仍不应再发');
});

test('炼丹房：跨月重新发放', () => {
  const s = memStorage();
  assert.equal(SB.claimMonthlyTalisman(1, OCT, s), 1);
  assert.equal(SB.claimMonthlyTalisman(1, NOV, s), 1, '进入下个月应重新发');
  assert.equal(SB.claimMonthlyTalisman(1, NOV, s), 0, '同月不重复');
});

test('炼丹房：月份 key 用本地时区（东八区月初不被算进上月）', () => {
  assert.equal(SB.monthKeyOf(OCT), '2026-10');
  // 本地 10/1 00:30 —— 若用 UTC 会算成 9 月（东八区 UTC+8）
  const firstOfMonth = new Date(2026, 9, 1, 0, 30).getTime();
  assert.equal(SB.monthKeyOf(firstOfMonth), '2026-10', '本地月初应属于本月');
  // 12 月边界
  assert.equal(SB.monthKeyOf(new Date(2026, 11, 31, 23, 0).getTime()), '2026-12');
  assert.equal(SB.monthKeyOf(new Date(2027, 0, 1, 0, 30).getTime()), '2027-01');
});

test('炼丹房：存储损坏 / 不可用时不抛错', () => {
  const bad = memStorage({ [SB.SECT_BUFF_KEY]: '{不是 JSON' });
  assert.deepEqual(SB.loadSectBuffs(bad), {});
  assert.deepEqual(SB.loadSectBuffs(null), {});
  // 无 storage 时仍应给出判定（只是记不住账）
  assert.equal(SB.monthlyTalismanAmount(1, null, OCT), 1);
});

test('炼丹房：记账用独立键，不碰学习存档', () => {
  assert.equal(SB.SECT_BUFF_KEY, 'qingci.sectBuffs');
  assert.notEqual(SB.SECT_BUFF_KEY, 'qingci.state');
  assert.notEqual(SB.SECT_BUFF_KEY, 'qingci.encounterEffects');
  assert.notEqual(SB.SECT_BUFF_KEY, 'qingci.gamification');
});

/* ───────── 三、演武场：论剑加成 ───────── */

test('演武场：未建成时不改分数（既有行为一字不变）', () => {
  assert.equal(SB.applyArenaBonus(10, 0), 10);
  assert.equal(SB.applyArenaBonus(10, undefined), 10);
  assert.equal(SB.applyArenaBonus(10, null), 10);
});

test('演武场：建成后 +5% 并取整', () => {
  assert.equal(SB.applyArenaBonus(10, 0.05), 11);  // 10 + round(0.5) = 11
  assert.equal(SB.applyArenaBonus(20, 0.05), 21);  // 20 + 1
  assert.equal(SB.applyArenaBonus(0, 0.05), 0, '0 分不应凭空加分');
  assert.equal(SB.applyArenaBonus(5, 0.05), 5);    // 5 + round(0.25)=0 → 5
});

test('演武场：加成有上限（不随做题量增长，且不产生负数）', () => {
  const big = SB.applyArenaBonus(1000, 0.05);
  assert.equal(big, 1050, '固定 5%');
  assert.equal(SB.applyArenaBonus(-5, 0.05), 0, '负分应夹紧为 0');
});

/* ───────── 四、摘要与一致性 ───────── */

test('摘要：未建成返回空数组，建成后逐条列出', () => {
  assert.deepEqual(SB.buffSummary(null), []);
  assert.deepEqual(SB.buffSummary({ detailUnlockBonus: 0, monthlyTalisman: 0, duelWinBonus: 0 }), []);
  const all = SB.buffSummary({ detailUnlockBonus: 0.2, monthlyTalisman: 1, duelWinBonus: 0.05 });
  assert.equal(all.length, 3);
  assert.ok(all.some((l) => l.includes('藏经阁')));
  assert.ok(all.some((l) => l.includes('炼丹房')));
  assert.ok(all.some((l) => l.includes('演武场')));
});

test('一致性：与 sect-facilities 的 buff 数值对齐（0.2 / 1 / 0.05）', () => {
  const sectTs = readFileSync(join(ROOT, 'src', 'services', 'sect-facilities.ts'), 'utf8');
  assert.match(sectTs, /detailUnlockBonus:\s*active\('scripture_hall'\)\s*\?\s*0\.2/, '藏经阁应为 0.2');
  assert.match(sectTs, /monthlyTalisman:\s*active\('alchemy_room'\)\s*\?\s*1/, '炼丹房应为 1');
  assert.match(sectTs, /duelWinBonus:\s*active\('arena'\)\s*\?\s*0\.05/, '演武场应为 0.05');
  // 本模块常量必须与之一致
  assert.equal(SB.DETAIL_DISCOUNT, 0.2);
  assert.equal(SB.MONTHLY_TALISMAN, 1);
});

/* ───────── 五、接线契约（防「实现了但没人调用」） ───────── */

test('接线：模板必须消费 sect.buffs（藏经阁折扣 / 月度符 / 演武场加成）', () => {
  const html = readFileSync(join(ROOT, 'src', 'index.template.html'), 'utf8');
  assert.ok(/sectBuffs/.test(html),
    '模板未使用 sectBuffs —— 三个设施的承诺增益不会生效');
  assert.ok(/discountedBookPrice/.test(html),
    '模板未用 discountedBookPrice —— 藏经阁折扣不生效');
  assert.ok(/claimMonthlyTalisman|monthlyTalismanAmount/.test(html),
    '模板未发放月度护道符 —— 炼丹房不生效');
  assert.ok(/applyArenaBonus/.test(html),
    '模板未应用演武场加成 —— 论剑 +5% 不生效');
});
