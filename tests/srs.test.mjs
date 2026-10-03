/**
 * SM-2 间隔重复算法单元测试（P0.2）
 *
 * 重点验证：
 *   1. 间隔序列符合 SM-2（1 天 → 6 天 → 上次间隔 × EF）
 *   2. 答错立即回到当天短间隔，并清零连续答对次数
 *   3. EF 随反馈升降且有下限 1.3
 *   4. 今日队列 / 预测 / 趋势的筛选与排序
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/load-ts.mjs';

const srs = await loadTs('src/services/srs.ts');
const model = await loadTs('src/types/mistakes.ts');

const { nextEase, nextIntervalDays, applyReview, dueQueue, forecast, mistakeTrend, describeInterval, QUALITY_BY_RATING } = srs;
const { createMistake, DEFAULT_EASE, MIN_EASE } = model;

const DAY = 86_400_000;
const base = new Date('2026-10-03T09:00:00.000Z');

function makeRecord(overrides = {}) {
  return { ...createMistake({ type: 'vocab', prompt: 'abandon', userAnswer: '', correctAnswer: '丢弃', now: base }), ...overrides };
}

test('srs：反馈映射到 SM-2 quality（忘记 2 / 模糊 3 / 记得 4 / 熟练 5）', () => {
  assert.equal(QUALITY_BY_RATING.again, 2);
  assert.equal(QUALITY_BY_RATING.hard, 3);
  assert.equal(QUALITY_BY_RATING.good, 4);
  assert.equal(QUALITY_BY_RATING.easy, 5);
});

test('srs：EF 随反馈升降，且有 1.3 下限', () => {
  assert.ok(nextEase(DEFAULT_EASE, 5) > DEFAULT_EASE, '熟练应提高 EF');
  assert.equal(nextEase(DEFAULT_EASE, 4), DEFAULT_EASE, '记得（q=4）在 SM-2 中维持 EF 不变');
  assert.ok(nextEase(DEFAULT_EASE, 3) < DEFAULT_EASE, '模糊应降低 EF');
  assert.ok(nextEase(DEFAULT_EASE, 2) < DEFAULT_EASE, '忘记应明显降低 EF');
  let ef = DEFAULT_EASE;
  for (let i = 0; i < 12; i++) ef = nextEase(ef, 0);
  assert.equal(ef, MIN_EASE, 'EF 不应低于 SM-2 下限 1.3');
});

test('srs：间隔序列为 0.25（忘记）/ 1 天 / 6 天 / 上次 × EF', () => {
  assert.equal(nextIntervalDays({ repetitions: 3, intervalDays: 20, ease: 2.5, quality: 2 }), srs.RELEARN_INTERVAL_DAYS);
  assert.equal(nextIntervalDays({ repetitions: 0, intervalDays: 0, ease: 2.5, quality: 4 }), 1);
  assert.equal(nextIntervalDays({ repetitions: 1, intervalDays: 1, ease: 2.5, quality: 4 }), 6);
  assert.equal(nextIntervalDays({ repetitions: 2, intervalDays: 6, ease: 2.5, quality: 4 }), 15);
  assert.equal(nextIntervalDays({ repetitions: 9, intervalDays: 300, ease: 2.5, quality: 4 }), srs.MAX_INTERVAL_DAYS);
});

test('srs：连续「记得」时间隔逐次拉长，proficiency 上升', () => {
  let record = makeRecord();
  const intervals = [];
  let cursor = base;
  for (let i = 0; i < 3; i++) {
    const outcome = applyReview(record, 'good', cursor);
    record = outcome.record;
    intervals.push(outcome.intervalDays);
    cursor = new Date(cursor.getTime() + outcome.intervalDays * DAY);
  }
  assert.deepEqual(intervals, [1, 6, 15]);
  assert.equal(record.repetitions, 3);
  assert.ok(record.proficiency >= 3, '连续答对 3 次后熟练度应至少 3');
  assert.equal(new Date(record.nextReviewAt).getTime(), cursor.getTime());
});

test('srs：答错清零连续次数并回到当天短间隔', () => {
  let record = makeRecord();
  for (let i = 0; i < 3; i++) record = applyReview(record, 'good', base).record;
  const before = record.intervalDays;
  const outcome = applyReview(record, 'again', base);
  assert.equal(outcome.intervalDays, srs.RELEARN_INTERVAL_DAYS);
  assert.equal(outcome.record.repetitions, 0);
  assert.equal(outcome.record.proficiency, 0);
  assert.ok(outcome.record.ease < record.ease, '答错应降低 EF');
  assert.ok(before > outcome.intervalDays);
  assert.equal(outcome.record.reviewCount, record.reviewCount + 1);
});

test('srs：今日队列只取到期项，按到期时间升序并支持限量', () => {
  const records = [
    makeRecord({ id: 'a', nextReviewAt: new Date(base.getTime() - 2 * DAY).toISOString(), wrongCount: 1 }),
    makeRecord({ id: 'b', nextReviewAt: new Date(base.getTime() - 1 * DAY).toISOString(), wrongCount: 5 }),
    makeRecord({ id: 'c', nextReviewAt: new Date(base.getTime() + 3 * DAY).toISOString(), wrongCount: 9 }),
  ];
  const due = dueQueue(records, base, 10);
  assert.deepEqual(due.map((r) => r.id), ['a', 'b']);
  assert.equal(dueQueue(records, base, 1).length, 1);
  assert.equal(dueQueue(records, base, 1)[0].id, 'a');
});

test('srs：未来 7 天预测与近 7 日趋势', () => {
  const records = [
    makeRecord({ id: 'a', nextReviewAt: new Date(base.getTime() + 1 * DAY).toISOString() }),
    makeRecord({ id: 'b', nextReviewAt: new Date(base.getTime() + 1 * DAY + 3600_000).toISOString() }),
    makeRecord({ id: 'c', nextReviewAt: new Date(base.getTime() + 3 * DAY).toISOString() }),
  ];
  const plan = forecast(records, 7, base);
  assert.equal(plan.length, 7);
  assert.equal(plan[1].count, 2, '第 2 天应有 2 条到期');
  assert.equal(plan[3].count, 1, '第 4 天应有 1 条到期');

  const trend = mistakeTrend([
    makeRecord({ id: 'x', createdAt: base.toISOString(), lastReviewedAt: base.toISOString(), repetitions: 1 }),
  ], 7, base);
  assert.equal(trend.length, 7);
  assert.equal(trend[6].wrong, 1);
  assert.equal(trend[6].right, 1);
  assert.equal(trend[0].wrong, 0);
});

test('srs：间隔文案符合中文习惯', () => {
  assert.equal(describeInterval({ intervalDays: 0.25 }), '今天再练一次');
  assert.equal(describeInterval({ intervalDays: 1 }), '明天复习');
  assert.equal(describeInterval({ intervalDays: 6 }), '6 天后复习');
  assert.equal(describeInterval({ intervalDays: 90 }), '3 个月后复习');
});
