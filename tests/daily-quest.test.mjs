/**
 * 每日功课「今日连对」口径（v1.10 第十轮）
 *
 * ── 真实缺陷 ──
 * 「今日功课」里第三个任务「不息心法」原本写的是：
 *
 *     { id:'streak', title:'不息心法', desc:'当前最长连对', now: state.best, target:10, reward:60 }
 *
 * 但 `state.best` 是**历史最长连对**（`state.best = Math.max(state.best, state.streak)`，
 * 只增不减、跨天保留）。于是只要历史上曾连对 10 题，这个「**每日**」任务
 * 从此**永久预完成** —— 每天打开就能直接领 60 灵石，一天都不用练。
 *
 * 真浏览器实测确认：
 *
 *     state.best=15  state.streak=0  今日答对=0
 *     ✅已完成  ✓ 不息心法 +60 灵石  当前最长连对 · 10 / 10 · 点击领取
 *
 * 它已经不是「每日任务」，而是「一次性成就」—— 而成就系统里确实另有一条
 * `ten 十连问道` 用的就是 `state.best>=10`，那条用 best 是对的。
 *
 * ── 三条红线（测试逐条守） ──
 *   1. 不制造焦虑：只记当日最高，断连不惩罚
 *   2. 不鼓励刷题：口径是「连对」不是「题量」
 *   3. 不丢用户数据：`state.best` 原样保留（成就系统仍在用）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTs } from './helpers/load-ts.mjs';

const ROOT = join(import.meta.dirname, '..');
const Q = await loadTs('src/services/daily-quest.ts');
const html = readFileSync(join(ROOT, 'src', 'index.template.html'), 'utf8');

const D = '2026-10-08';

/* ───────── 一、每日 vs 历史：必须分开 ───────── */

test('当日最高连对：只读当天的记录，不受其它天影响', () => {
  const days = { '2026-10-07': { bestStreak: 30 }, [D]: { bestStreak: 4 } };
  assert.equal(Q.dailyBestStreak(days, D), 4, '应读当天，而不是历史最高的 30');
  assert.equal(Q.dailyBestStreak(days, '2026-10-07'), 30);
});

test('当日无记录 → 0（跨天自然归零，无需额外重置）', () => {
  assert.equal(Q.dailyBestStreak({ '2026-10-07': { bestStreak: 30 } }, D), 0);
  assert.equal(Q.dailyBestStreak({}, D), 0);
  assert.equal(Q.dailyBestStreak(null, D), 0);
  assert.equal(Q.dailyBestStreak(undefined, D), 0);
});

test('回归守卫：每日任务不得再引用 state.best（历史最佳）', () => {
  // 这是本缺陷的核心：每日任务用 best 就必然「永久预完成」
  const bad = /id:'streak'[^}]*now:\s*state\.best/.test(html);
  assert.ok(!bad,
    '「不息心法」又用回了 state.best —— 只要曾连对 10 题就会永久预完成');
  // 成就系统里那条「十连问道」用 best 是**正确**的，应保留
  assert.ok(/state\.best>=10/.test(html),
    '成就「十连问道」应继续用 state.best（历史最佳）—— 那是成就语义');
});

/* ───────── 二、记录当日连对 ───────── */

test('record：答对时取「当日最高」与「当前连对」的较大者', () => {
  const row = {};
  assert.equal(Q.recordDailyStreak(row, true, 3), 3);
  assert.equal(Q.recordDailyStreak(row, true, 7), 7);
  assert.equal(Q.recordDailyStreak(row, true, 5), 7, '不应被较小值覆盖');
  assert.equal(row.bestStreak, 7);
});

test('record：答错**不清零**当日最高（当天已达成的记录不该被抹掉）', () => {
  const row = { bestStreak: 8 };
  assert.equal(Q.recordDailyStreak(row, false, 0), 8, '答错后当日最高应保持 8');
  assert.equal(row.bestStreak, 8);
});

test('record：连对中断后重新累积，仍取当日最大', () => {
  const row = {};
  Q.recordDailyStreak(row, true, 1);
  Q.recordDailyStreak(row, true, 2);
  Q.recordDailyStreak(row, false, 0);   // 断连
  Q.recordDailyStreak(row, true, 1);    // 重新起
  Q.recordDailyStreak(row, true, 2);
  assert.equal(row.bestStreak, 2, '当日最高仍是断连前的 2');
});

test('record：脏数据安全降级，不抛错', () => {
  for (const bad of [null, undefined, 0, 'x', []]) {
    assert.equal(Q.recordDailyStreak(bad, true, 5), 0, `输入 ${JSON.stringify(bad)} 应安全返回 0`);
  }
  const row = {};
  assert.equal(Q.recordDailyStreak(row, true, NaN), 0);
  assert.equal(Q.recordDailyStreak(row, true, -3), 0);
  assert.equal(Q.recordDailyStreak(row, true, 2.7), 2, '应取整');
});

/* ───────── 三、任务对象 ───────── */

test('任务：now 用**当日**连对，target/reward 与既有定义一致', () => {
  const days = { '2026-10-07': { bestStreak: 99 }, [D]: { bestStreak: 6 } };
  const q = Q.dailyStreakQuest(days, D, 60);
  assert.equal(q.id, 'streak');
  assert.equal(q.now, 6, '不应被历史 99 影响');
  assert.equal(q.target, Q.DAILY_STREAK_TARGET);
  assert.equal(q.reward, 60);
});

test('任务：描述写明「今日」，与历史成就区分（避免误解）', () => {
  const q = Q.dailyStreakQuest({}, D);
  assert.ok(/今日/.test(q.desc), `描述应含「今日」：${q.desc}`);
  assert.ok(!/历史|最长连对$/.test(q.desc), `描述不应像历史成就：${q.desc}`);
});

test('任务：新用户（无记录）now=0，不会凭空完成', () => {
  const q = Q.dailyStreakQuest({}, D);
  assert.equal(q.now, 0);
  assert.ok(q.now < q.target, '新用户不应直接完成每日任务');
});

test('任务：当日达到目标后 now>=target（可领取）', () => {
  const q = Q.dailyStreakQuest({ [D]: { bestStreak: 10 } }, D);
  assert.ok(q.now >= q.target);
});

/* ───────── 四、旧存档兼容 ───────── */

test('ensure：补齐缺失的 bestStreak 字段（旧存档）', () => {
  const days = { a: { right: 5, wrong: 1 }, b: { right: 2 } };
  const fixed = Q.ensureBestStreak(days);
  assert.equal(fixed, 2, '两条记录都应被补字段');
  assert.equal(days.a.bestStreak, 0);
  assert.equal(days.b.bestStreak, 0);
  // 既有字段不受影响
  assert.equal(days.a.right, 5);
});

test('ensure：修正非法值（负数 / NaN / 小数）', () => {
  const days = { a: { bestStreak: -5 }, b: { bestStreak: NaN }, c: { bestStreak: 3.9 }, d: { bestStreak: 7 } };
  const fixed = Q.ensureBestStreak(days);
  assert.equal(days.a.bestStreak, 0, '负数 → 0');
  assert.equal(days.b.bestStreak, 0, 'NaN → 0');
  assert.equal(days.c.bestStreak, 3, '小数取整');
  assert.equal(days.d.bestStreak, 7, '合法值不动');
  assert.ok(fixed >= 3);
});

test('ensure：脏输入不抛错', () => {
  for (const bad of [null, undefined, 0, 'x', []]) {
    assert.equal(Q.ensureBestStreak(bad), 0);
  }
});

/* ───────── 五、接线契约 ───────── */

test('接线：settle 必须在答对/答错时都记录当日连对', () => {
  assert.ok(/dailyQuest\.record\(d,true,state\.streak\)/.test(html) || /dailyQuest\.record\(d, true, state\.streak\)/.test(html),
    'settle 答对分支未记录当日连对');
  assert.ok(/dailyQuest\.record\(d,false,0\)/.test(html) || /dailyQuest\.record\(d, false, 0\)/.test(html),
    'settle 答错分支未调用记录（应保持当日最高不清零）');
});

test('接线：任务定义走服务层（口径只有一处）', () => {
  assert.ok(/dailyQuest\.streakQuest\(state\.days,dayKey\(\)\)/.test(html)
    || /dailyQuest\.streakQuest\(state\.days, dayKey\(\)\)/.test(html),
    '任务定义未走服务层 —— 口径会两处各写一份，容易再次分叉');
});

test('接线：旧存档迁移会补齐 bestStreak', () => {
  assert.ok(/dailyQuest\.ensure\(st\.days\)/.test(html),
    'migrateState 未补齐 bestStreak —— 旧存档的 days 结构不自洽');
});

test('不丢数据：state.best 仍被保留与维护（成就系统在用）', () => {
  assert.ok(/state\.best=Math\.max\(state\.best,state\.streak\)/.test(html),
    'state.best 的维护被删掉了 —— 成就「十连问道」会失效');
});

test('不鼓励刷题：口径是「连对」而非「题量」', () => {
  const q = Q.dailyStreakQuest({}, D);
  assert.ok(/连对/.test(q.desc), `口径应是连对：${q.desc}`);
  assert.ok(!/题量|做题数|答题数/.test(q.desc), '不应改成按题量计数');
});
