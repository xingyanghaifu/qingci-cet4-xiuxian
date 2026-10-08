/**
 * 奇遇效果结算（阶段 B 补全）：6 个奇遇的 effect 必须**真的有效果**
 *
 * ── 这份测试在防什么 ──
 * 修复前的真实缺陷：`encounters.ts` 定义了 6 个奇遇、每个都带 `effect` 标识，
 * 但模板里的 `applyEncounter` 只对 `qi_rain` 做了真实结算，其余 5 个**只弹一句 toast**：
 *
 *     scroll     → '待与词库联动（book 解锁）'   ← 从未联动
 *     beast      → '认主了'                      ← 认主了但没有灵兽
 *     cave       → '效果已生效'                  ← 没有任何效果
 *     old_master → '效果已生效'                  ← 同上
 *     demon_raid → '去心魔录迎战'                ← 只是指路
 *
 * 这是最亏的一类缺陷：有内容、有期待、无回报。而它**任何测试都测不出来** ——
 * 因为旧测试只断言「事件池字段完整」（`assert.ok(e.effect && ...)`），
 * 即只检查 `effect` 这个**字符串存在**，从不检查它**被消费**。
 *
 * 所以本测试的核心是：对每个 effect 断言**可观察的状态变化**，
 * 而不是断言字符串。这也符合本仓库「坑 0」的教训：字符串里有 ≠ 真的发生。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTs } from './helpers/load-ts.mjs';

const ROOT = join(import.meta.dirname, '..');
const E = await loadTs('src/services/encounter-effects.ts');

/** 内存 storage（替代 localStorage） */
function memStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    _map: map,
  };
}

const NOW = Date.parse('2026-10-08T10:00:00+08:00');
const WORDS = ['abandon', 'ability', 'absorb', 'abstract'];

/* ───────── 一、每个奇遇都必须产生可观察效果 ───────── */

test('灵石雨：给出 30–80 灵石（区间可复现）', () => {
  const lo = E.applyEffect('qi_rain', {}, { now: NOW, rand: () => 0 });
  const hi = E.applyEffect('qi_rain', {}, { now: NOW, rand: () => 0.999999 });
  assert.equal(lo.outcome.kind, 'spirit');
  assert.equal(lo.outcome.amount, E.QI_RAIN_MIN, 'rand=0 应取下界');
  assert.equal(hi.outcome.amount, E.QI_RAIN_MAX, 'rand→1 应取上界');
  assert.ok(lo.outcome.amount >= 30 && lo.outcome.amount <= 80);
});

test('洞天福地：真的产生 1 小时修为倍率（不是只弹提示）', () => {
  const r = E.applyEffect('cave', {}, { now: NOW });
  assert.equal(r.outcome.kind, 'cave');
  // 关键：状态里必须真的出现 caveUntil，且判定为生效
  assert.ok(r.state.caveUntil, '未写入 caveUntil —— 效果没落地');
  assert.ok(E.caveActive(r.state, NOW), '写入后应判定为生效');
  assert.equal(E.qiMultiplier(r.state, NOW), E.CAVE_QI_MULTIPLIER);
  // 1 小时后失效
  assert.equal(E.caveActive(r.state, NOW + 3600 * 1000 + 1), false, '超时后应失效');
  assert.equal(E.qiMultiplier(r.state, NOW + 3600 * 1000 + 1), 1, '失效后倍率回到 1');
});

test('洞天福地：重复触发是续期而非覆盖（与聚灵阵语义一致）', () => {
  const first = E.applyEffect('cave', {}, { now: NOW });
  const second = E.applyEffect('cave', first.state, { now: NOW + 10 * 60 * 1000 });
  const until1 = Date.parse(first.state.caveUntil);
  const until2 = Date.parse(second.state.caveUntil);
  assert.ok(until2 > until1, '续期应叠在剩余之上，而不是从现在重新计时');
});

test('遇老道指点：真的记下今日重点词，且跨日自动失效', () => {
  const r = E.applyEffect('old_master', {}, { now: NOW, rand: () => 0, words: WORDS });
  assert.equal(r.outcome.kind, 'focus');
  assert.equal(r.outcome.word, WORDS[0]);
  assert.equal(r.state.focusWord, WORDS[0], '未写入 focusWord —— 效果没落地');
  assert.equal(E.focusWordOf(r.state, NOW), WORDS[0]);
  // 命中该词才有加分
  assert.equal(E.focusBonusFor(WORDS[0], r.state, NOW), E.FOCUS_BONUS_QI);
  assert.equal(E.focusBonusFor(WORDS[1], r.state, NOW), 0, '非重点词不应加分');
  assert.equal(E.focusBonusFor(WORDS[0].toUpperCase(), r.state, NOW), E.FOCUS_BONUS_QI, '大小写不敏感');
  // 跨日失效（否则昨天的重点词会一直生效）
  const tomorrow = NOW + 24 * 3600 * 1000;
  assert.equal(E.focusWordOf(r.state, tomorrow), null, '跨日应失效');
  assert.equal(E.focusBonusFor(WORDS[0], r.state, tomorrow), 0);
});

test('拾得残卷：真的产出待解锁词（供 book 解锁，而非只弹提示）', () => {
  const r = E.applyEffect('scroll', {}, { now: NOW, rand: () => 0, words: WORDS });
  assert.equal(r.outcome.kind, 'book');
  assert.equal(r.outcome.word, WORDS[0]);
});

test('灵兽来投：真的认主一只灵兽并给永久加成', () => {
  const r = E.applyEffect('beast', {}, { now: NOW, rand: () => 0 });
  assert.equal(r.outcome.kind, 'beast');
  assert.ok(r.state.beast && r.state.beast.name, '未写入 beast —— 认主了但没有灵兽');
  assert.equal(r.state.beast.name, E.BEAST_NAMES[0]);
  assert.ok(E.beastActive(r.state));
  assert.equal(E.qiMultiplier(r.state, NOW), E.BEAST_QI_MULTIPLIER, '灵兽应给永久倍率');
});

test('灵兽来投：只认一只，重复触发不换主', () => {
  const first = E.applyEffect('beast', {}, { now: NOW, rand: () => 0 });
  const second = E.applyEffect('beast', first.state, { now: NOW + 1000, rand: () => 0.9 });
  assert.equal(second.state.beast.name, first.state.beast.name, '已有灵兽不应被替换');
});

test('心魔来袭：产出「开一组心魔复习」指令（而非只指路）', () => {
  const r = E.applyEffect('demon_raid', {}, { now: NOW });
  assert.equal(r.outcome.kind, 'demon_review');
});

/* ───────── 二、增益叠加与倍率上限（不鼓励刷题） ───────── */

test('倍率叠加：洞天 × 灵兽 = 1.5 × 1.1（乘法独立）', () => {
  const cave = E.applyEffect('cave', {}, { now: NOW });
  const both = E.applyEffect('beast', cave.state, { now: NOW, rand: () => 0 });
  const m = E.qiMultiplier(both.state, NOW);
  assert.ok(Math.abs(m - E.CAVE_QI_MULTIPLIER * E.BEAST_QI_MULTIPLIER) < 1e-9, `实际 ${m}`);
  // 上限明确：不随做题量增长
  assert.ok(m <= E.CAVE_QI_MULTIPLIER * E.BEAST_QI_MULTIPLIER + 1e-9, '倍率必须有上限');
});

test('修为收益：倍率应用后取整，且基础分为 0 时不产生收益', () => {
  assert.equal(E.applyQiMultiplier(6, 1), 6);
  assert.equal(E.applyQiMultiplier(6, 1.5), 9);
  assert.equal(E.applyQiMultiplier(6, 1.1), 7);   // 6.6 → 7
  assert.equal(E.applyQiMultiplier(0, 1.5), 0);
  assert.equal(E.applyQiMultiplier(6, 0), 6, '非法倍率应回落 1（不吞收益）');
  assert.equal(E.applyQiMultiplier(6, NaN), 6);
});

/* ───────── 三、持久化（独立存储键，不动学习存档） ───────── */

test('存储：用独立键 qingci.encounterEffects，不碰学习存档', () => {
  assert.equal(E.EFFECTS_KEY, 'qingci.encounterEffects');
  assert.notEqual(E.EFFECTS_KEY, 'qingci.state');
  assert.notEqual(E.EFFECTS_KEY, 'qingci.gamification');
});

test('存储：读→算→写 全链路可跨会话保留', () => {
  const s1 = memStorage();
  const out = E.applyEncounterEffect('cave', { now: NOW }, s1);
  assert.equal(out.kind, 'cave');
  // 新会话：从同一 storage 读回
  const reloaded = E.loadEffects(s1);
  assert.ok(E.caveActive(reloaded, NOW), '跨会话应仍生效');
});

test('存储：损坏数据回落空状态，不抛错', () => {
  const bad = memStorage({ [E.EFFECTS_KEY]: '{不是合法 JSON' });
  assert.deepEqual(E.loadEffects(bad), {});
  const wrongShape = memStorage({ [E.EFFECTS_KEY]: JSON.stringify({ caveUntil: 123, beast: 'x', focusWord: 5 }) });
  const s = E.loadEffects(wrongShape);
  assert.equal(s.caveUntil, undefined, '非法类型应被丢弃');
  assert.equal(s.beast, undefined);
  assert.equal(s.focusWord, undefined);
});

test('存储：localStorage 不可用时全部降级不抛错', () => {
  assert.deepEqual(E.loadEffects(null), {});
  assert.equal(E.caveActive(null, NOW), false);
  assert.equal(E.beastActive(null), false);
  assert.equal(E.focusWordOf(null, NOW), null);
  assert.equal(E.qiMultiplier(null, NOW), 1);
  assert.deepEqual(E.activeBoostLabels(null, NOW), []);
  // 无 storage 时 apply 仍应返回 outcome（不因存储失败而丢效果判定）
  const out = E.applyEncounterEffect('qi_rain', { now: NOW, rand: () => 0 }, null);
  assert.equal(out.kind, 'spirit');
});

/* ───────── 四、边界与稳健性 ───────── */

test('未知奇遇 / 空词表：不抛错、不产生效果、不改状态', () => {
  const before = {};
  const unknown = E.applyEffect('not_a_real_event', before, { now: NOW });
  assert.equal(unknown.outcome, null);
  assert.deepEqual(unknown.state, before);
  // 需要词表的事件在空词表下应安全返回 null（而不是抛错或写入 undefined）
  for (const t of ['old_master', 'scroll']) {
    const r = E.applyEffect(t, {}, { now: NOW, words: [] });
    assert.equal(r.outcome, null, `${t} 空词表应无效果`);
    assert.deepEqual(r.state, {}, `${t} 空词表不应改状态`);
  }
  const noWords = E.applyEffect('old_master', {}, { now: NOW });
  assert.equal(noWords.outcome, null, '未传词表应安全降级');
});

test('纯函数：applyEffect 不修改入参状态', () => {
  const input = { caveUntil: undefined };
  const snapshot = JSON.stringify(input);
  E.applyEffect('cave', input, { now: NOW });
  E.applyEffect('beast', input, { now: NOW, rand: () => 0 });
  assert.equal(JSON.stringify(input), snapshot, '入参被改动了 —— 违反纯函数约定');
});

test('增益摘要：按生效状态给出可读标签', () => {
  assert.deepEqual(E.activeBoostLabels({}, NOW), []);
  const cave = E.applyEffect('cave', {}, { now: NOW });
  const beast = E.applyEffect('beast', cave.state, { now: NOW, rand: () => 0 });
  const labels = E.activeBoostLabels(beast.state, NOW);
  assert.equal(labels.length, 2);
  assert.ok(labels.some((l) => l.includes('洞天')));
  assert.ok(labels.some((l) => l.includes('灵兽')));
});

test('灵兽名：种子化可复现，且落在候选表内', () => {
  assert.equal(E.beastName(() => 0), E.BEAST_NAMES[0]);
  assert.equal(E.beastName(() => 0.999999), E.BEAST_NAMES[E.BEAST_NAMES.length - 1]);
  assert.equal(E.beastName(() => 0.5), E.beastName(() => 0.5), '同 rand 同结果');
  assert.ok(E.BEAST_NAMES.length >= 8, '灵兽候选应够多，避免重复感');
});

test('日 key 口径：本地时区（与 encounters.localDateKey 一致，R13）', () => {
  assert.match(E.localDayKey(NOW), /^\d{4}-\d{2}-\d{2}$/);
  const d = new Date(2026, 9, 4, 12, 0, 0);
  assert.equal(E.localDayKey(d.getTime()), '2026-10-04');
  assert.equal(E.localDayKey(new Date(2026, 9, 4, 23, 0).getTime()), '2026-10-04');
  assert.equal(E.localDayKey(new Date(2026, 9, 5, 1, 0).getTime()), '2026-10-05');
});

/* ───────── 五、省略 state 时自动读存储（真浏览器验收抓到的缺陷） ─────────
 *
 * 背景：模板的调用点是 `qiMultiplier()` / `activeBoostLabels()` 这类**无参**形式。
 * 最初我把 state 设成必填，模板传 undefined → 一律判定「无增益」，
 * 表现为：倍率恒为 1、增益徽标永不显示、重点词加分失效。
 *
 * 这个缺陷**单测抓不到**（单测总是显式传 state），是真浏览器验收抓到的 ——
 * 所以补这组测试，把「省略即读存储」的契约钉死。
 */
test('省略 state：qiMultiplier() 自动读存储（模板的真实调用形态）', () => {
  const s = memStorage();
  E.saveEffects({ caveUntil: new Date(NOW + 3600 * 1000).toISOString() }, s);
  assert.equal(E.qiMultiplier(undefined, NOW, s), E.CAVE_QI_MULTIPLIER,
    '省略 state 应去读存储，而不是恒返回 1');
  assert.ok(E.caveActive(undefined, NOW, s), 'caveActive 省略 state 应读存储');
});

test('省略 state：activeBoostLabels() 自动读存储', () => {
  const s = memStorage();
  E.saveEffects({ caveUntil: new Date(NOW + 3600 * 1000).toISOString(), beast: { name: '白泽幼兽', since: '' } }, s);
  const labels = E.activeBoostLabels(undefined, NOW, s);
  assert.equal(labels.length, 2, `省略 state 应给出 2 条增益，实际 ${labels.length}`);
});

test('省略 state：focusBonusFor(word) 自动读存储', () => {
  const s = memStorage();
  E.saveEffects({ focusWord: 'abandon', focusDay: E.localDayKey(NOW) }, s);
  assert.equal(E.focusBonusFor('abandon', undefined, NOW, s), E.FOCUS_BONUS_QI,
    '省略 state 应读到重点词并加分');
  assert.equal(E.focusBonusFor('other', undefined, NOW, s), 0);
});

test('显式传 null：表示「确实没有状态」，不读存储', () => {
  const s = memStorage();
  E.saveEffects({ caveUntil: new Date(NOW + 3600 * 1000).toISOString() }, s);
  assert.equal(E.qiMultiplier(null, NOW, s), 1, 'null 应视为无状态，不去读存储');
  assert.deepEqual(E.activeBoostLabels(null, NOW, s), []);
});

test('模板接线契约：调用点必须是「无参只读」形态', () => {
  // 防回归：若有人把模板改回「必须先自己 load 再传 state」，本测试会失败，
  // 提醒他同步改服务层签名（或改回无参）—— 两者必须一致。
  const html = readFileSync(join(ROOT, 'src', 'index.template.html'), 'utf8');
  assert.ok(/E\.qiMultiplier\?E\.qiMultiplier\(\)/.test(html),
    '模板应无参调用 qiMultiplier()（服务层已支持省略 state）');
  assert.ok(/EE\.activeBoostLabels\(\)/.test(html),
    '模板应无参调用 activeBoostLabels()');
  assert.ok(/E\.focusBonusFor\?E\.focusBonusFor\(word\)/.test(html),
    '模板应以 word 为第一参调用 focusBonusFor(word)');
});
