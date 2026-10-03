/**
 * 动态学习计划单元测试（P1 任务 A/C 的算法内核）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/load-ts.mjs';

const plan = await loadTs('src/services/study-plan.ts');
const { planStudyLoad, adjustPlan, heatmap, describePlan, daysUntil, intensityFor, DEFAULT_EXAM_DATE } = plan;

const now = new Date('2026-10-03T09:00:00.000Z');

test('plan：距考试天数与强度分档', () => {
  assert.equal(daysUntil('2026-10-04T09:00:00.000Z', now), 1);
  assert.equal(daysUntil('2026-12-12T09:00:00.000Z', now), 70);
  assert.equal(daysUntil('2026-01-01T00:00:00.000Z', now), 1, '过期日期按 1 天兜底，避免除零');
  assert.equal(intensityFor(200), 'relaxed');
  assert.equal(intensityFor(70), 'steady');
  assert.equal(intensityFor(30), 'sprint');
  assert.equal(DEFAULT_EXAM_DATE, '2026-12-12');
});

test('plan：新词量按剩余词数、天数与留存率估算并受时间预算限制', () => {
  const relaxed = planStudyLoad({ now, examDate: '2027-06-01', knownWords: 0, dailyMinutes: 30 });
  assert.ok(relaxed.newPerDay >= 10 && relaxed.newPerDay <= 80);
  assert.equal(relaxed.intensity, 'relaxed');
  assert.ok(relaxed.reviewTarget >= 20);

  const tight = planStudyLoad({ now, examDate: '2026-10-20', knownWords: 0, dailyMinutes: 15 });
  assert.ok(tight.timeBound, '时间紧时应标记为时间受限');
  assert.ok(tight.notes.some((n) => n.includes('时间预算')));

  const enough = planStudyLoad({ now, examDate: '2027-06-01', knownWords: 4400 });
  assert.ok(enough.newPerDay < relaxed.newPerDay, '已掌握越多，每日新词越少');

  const done = planStudyLoad({ now, examDate: '2026-12-12', knownWords: 4540 });
  assert.equal(done.remaining, 0);
  assert.equal(done.newPerDay, 0);
  assert.match(describePlan(done), /全部进入复习队列/);
});

test('plan：正确率会调整强度并给出说明', () => {
  const weak = planStudyLoad({ now, knownWords: 1000, dailyMinutes: 40, accuracy: 0.5 });
  const strong = planStudyLoad({ now, knownWords: 1000, dailyMinutes: 40, accuracy: 0.95 });
  assert.ok(weak.newPerDay <= strong.newPerDay, '正确率低不应给出更多新词');
  assert.ok(weak.notes.some((n) => n.includes('正确率偏低')));
  assert.ok(strong.notes.some((n) => n.includes('适度加量')));
});

test('plan：题型配比随强度变化，冲刺期提高卷面配比', () => {
  const sprint = planStudyLoad({ now, examDate: '2026-10-20' });
  const relaxed = planStudyLoad({ now, examDate: '2027-06-01' });
  assert.ok(sprint.mix.listen >= relaxed.mix.listen);
  assert.ok(sprint.mix.write >= relaxed.mix.write);
  assert.ok(sprint.mix.words <= relaxed.mix.words * 2);
});

test('plan：按完成率与成绩动态调整', () => {
  const base = planStudyLoad({ now, examDate: '2026-12-12', knownWords: 800, dailyMinutes: 40 });
  const lazy = adjustPlan(base, { completedRatio: 0.3 });
  assert.ok(lazy.newPerDay < base.newPerDay, '完成率低应减量');
  assert.ok(lazy.notes.some((n) => n.includes('完成率')));

  const keen = adjustPlan(base, { completedRatio: 1.3 });
  assert.ok(keen.newPerDay >= base.newPerDay, '超额完成可加量');

  const weak = adjustPlan(base, { accuracy: 0.5 });
  assert.ok(weak.newPerDay < base.newPerDay, '正确率低应再减量');

  const paperWeak = adjustPlan(base, { paperRatio: 0.4 });
  assert.ok(paperWeak.mix.listen > base.mix.listen);
  assert.ok(paperWeak.notes.some((n) => n.includes('卷面')));
});

test('plan：热力图分档与边界', () => {
  const daily = {};
  const start = new Date('2026-09-20T00:00:00.000Z');
  for (let i = 0; i < 10; i++) {
    daily[new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10)] = (i + 1) * 5;
  }
  const cells = heatmap(daily, 28, now);
  assert.equal(cells.length, 28);
  assert.equal(cells[cells.length - 1].date, '2026-10-03');
  const filled = cells.filter((c) => c.count > 0);
  assert.equal(filled.length, 10);
  assert.ok(filled.every((c) => c.level >= 1 && c.level <= 4));
  assert.ok(cells.some((c) => c.count === 0 && c.level === 0));
  assert.equal(heatmap({}, 7, now).filter((c) => c.level === 0).length, 7, '没有数据时全部为 0 档');
});
