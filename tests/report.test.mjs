/**
 * 模考报告与薄弱点分析单元测试（P1 任务 B）
 *
 * 覆盖：
 *   1. Wilson 下界与薄弱点排序（小样本不被误判成最弱）
 *   2. 按题型 / 部分 / 标签聚合、趋势、耗时分布
 *   3. 模考报告组装与目标分对比
 *   4. SVG 图表生成的正确性与安全性（转义）
 *   5. 推荐引擎：由薄弱点生成组卷参数并真的能抽到题
 *   6. 报告仓库（IDB v4：attempts / reports）读写与降级
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/load-ts.mjs';
import { makeFakeIdb } from './helpers/fake-idb.mjs';

const reportTypes = await loadTs('src/types/report.ts');
const storeModule = await loadTs('src/services/report-store.ts');
const charts = await loadTs('src/services/charts.ts');
const recommend = await loadTs('src/services/recommend.ts');
const bankTypes = await loadTs('src/types/question-bank.ts');
const idb = await loadTs('src/services/idb.ts');

const { wilsonLowerBound, detectWeaknesses, accuracyTrend, timingByPart, buildPaperReport, compareWithTarget, describeReport, localDateKey, kindLabel, partOfGate } = reportTypes;
const { createReportStore, attemptFromQuestion, partOfKind } = storeModule;
const { barChart, lineChart, ringChart, heatmapGrid, CHART_CSS } = charts;
const { recommendPractice, buildRecommendedSet, describeRecommendation, countCandidates } = recommend;
const { normalizeBank } = bankTypes;

const base = new Date('2026-10-03T09:00:00.000Z');

const attempt = (over = {}) => ({
  questionId: 'q_vocab_0001_en2zh',
  kind: 'en2zh',
  part: '词汇',
  tags: ['en2zh', 'tier:core'],
  correct: true,
  ms: 5000,
  at: base.toISOString(),
  ...over,
});

test('report：Wilson 下界对样本量敏感（小样本不会判成最弱）', () => {
  assert.equal(wilsonLowerBound(0, 0), 0);
  // p̂ = 0 时下界恒为 0：全错就是全错，与样本量无关
  assert.equal(wilsonLowerBound(0, 1), 0);
  assert.equal(wilsonLowerBound(0, 20), 0);
  // 同样的正确率，样本量越大下界越高（越可信）
  assert.ok(wilsonLowerBound(1, 2) < wilsonLowerBound(10, 20));
  // 同样的样本量，正确率越低下界越低
  assert.ok(wilsonLowerBound(4, 20) < wilsonLowerBound(10, 20));
  const half = wilsonLowerBound(5, 10);
  assert.ok(half > 0.2 && half < 0.5, '10 题对 5 的下界应在 0.2–0.5 之间');
});

test('report：薄弱点按 Wilson 下界排序，样本不足单独标注', () => {
  const attempts = [
    // 阅读：20 题错 14（确实弱）
    ...Array.from({ length: 20 }, (_, i) => attempt({ kind: 'detail', part: '阅读', tags: ['detail', 'gate:detail'], correct: i >= 14, ms: 30000 })),
    // 听力：10 题错 2（不弱）
    ...Array.from({ length: 10 }, (_, i) => attempt({ kind: 'news', part: '听力', tags: ['news'], correct: i >= 2, ms: 20000 })),
    // 写作：1 题错（样本不足）
    attempt({ kind: 'write', part: '写作', tags: ['write'], correct: false, ms: 60000 }),
  ];
  const weaknesses = detectWeaknesses(attempts, { minSamples: 3, limit: 10 });
  const byKind = Object.fromEntries(weaknesses.filter((w) => w.scope === 'kind').map((w) => [w.key, w]));

  assert.equal(byKind.detail.severity === 'high' || byKind.detail.severity === 'medium', true);
  assert.equal(byKind.write.severity, 'insufficient', '1 题样本应标为样本不足');
  assert.ok(byKind.detail.weakness > byKind.news.weakness, '阅读明显更弱，应排更前');
  assert.match(byKind.detail.advice, /专项/);

  const byPart = weaknesses.filter((w) => w.scope === 'part');
  assert.ok(byPart.some((w) => w.key === '阅读'));
  const byTag = weaknesses.filter((w) => w.scope === 'tag');
  assert.ok(byTag.some((w) => w.key === 'gate:detail'));
});

test('report：趋势与耗时分布（本地日期、按部分聚合）', () => {
  const attempts = [
    attempt({ at: base.toISOString(), correct: true, ms: 4000 }),
    attempt({ at: base.toISOString(), correct: false, ms: 6000 }),
    attempt({ at: new Date(base.getTime() - 86400000).toISOString(), correct: true, ms: 8000, part: '听力', kind: 'news' }),
  ];
  const trend = accuracyTrend(attempts, 7, base);
  assert.equal(trend.length, 7);
  assert.equal(trend[6].total, 2);
  assert.equal(trend[6].accuracy, 0.5);
  assert.equal(trend[5].total, 1);
  assert.equal(trend[0].total, 0);

  const timing = timingByPart(attempts);
  assert.equal(timing.length, 2);
  const vocabulary = timing.find((t) => t.part === '词汇');
  assert.equal(vocabulary.avgMs, 5000);
  assert.ok(vocabulary.share > 0.5);
});

test('report：模考报告组装、目标分对比与文案', () => {
  const queue = [
    { gate: 'write' }, { gate: 'news' }, { gate: 'news' }, { gate: 'detail' }, { gate: 'detail' }, { gate: 'trans' },
  ];
  const report = buildPaperReport({
    paperId: 'qingci', paperName: '青词卷', examId: 'cet4', examName: 'CET-4',
    score: 400, total: 710, passLine: 425, passed: false, completed: true,
    queue, answered: 6, got: { write: 1, news: 1, detail: 0, trans: 1 },
    durationMs: 600000, attempts: [attempt({ ms: 60000 }), attempt({ ms: 40000 })], at: base,
  });
  assert.equal(report.targetScore, 425);
  assert.equal(report.pass, false);
  assert.equal(report.avgMsPerQuestion, 300000, '总时长 / 作答数');
  const reading = report.gates.find((g) => g.gate === 'detail');
  assert.equal(reading.part, '阅读');
  assert.equal(reading.right, 0);
  assert.equal(reading.accuracy, 0);

  const cmp = compareWithTarget(report);
  assert.equal(cmp.diff, -25);
  assert.ok(cmp.questionsNeeded > 0, '应换算出还差几题');
  assert.match(cmp.message, /距目标还差 25 分/);

  const passed = buildPaperReport({
    paperId: 'qingci', paperName: '青词卷', examId: 'cet4', examName: 'CET-4',
    score: 500, total: 710, passLine: 425, passed: true, completed: true,
    queue, answered: 6, got: { write: 1, news: 2, detail: 2, trans: 1 }, at: base,
  });
  assert.equal(passed.pass, true);
  assert.match(compareWithTarget(passed).message, /高于目标/);
  assert.match(describeReport(passed), /CET-4/);
});

test('report：门类/题型到部分的映射', () => {
  assert.equal(partOfGate('news'), '听力');
  assert.equal(partOfGate('detail'), '阅读');
  assert.equal(partOfGate('trans'), '翻译');
  assert.equal(partOfGate('write'), '写作');
  assert.equal(partOfKind('spell'), '词汇');
  assert.equal(partOfKind('passage'), '听力');
  assert.equal(kindLabel('detail'), '仔细阅读');
  assert.equal(kindLabel('unknown-kind'), 'unknown-kind');
});

test('report：由题目生成作答流水（含标签与兜底 id）', () => {
  const a = attemptFromQuestion(
    { questionId: 'q_paper_qingci_detail_01', bankKind: 'detail', part: '读', word: 'abandon' },
    { correct: false, ms: 12345, paperId: 'qingci', gate: 'detail', at: base, tags: ['gate:detail'] },
  );
  assert.equal(a.questionId, 'q_paper_qingci_detail_01');
  assert.equal(a.kind, 'detail');
  assert.equal(a.part, '读');
  assert.equal(a.ms, 12345);
  assert.equal(a.paperId, 'qingci');
  assert.deepEqual(a.tags, ['gate:detail']);

  const fallback = attemptFromQuestion({ word: 'abandon' }, { correct: true, ms: -5, at: base });
  assert.equal(fallback.questionId, 'w:abandon');
  assert.equal(fallback.kind, 'unknown');
  assert.equal(fallback.ms, 0, '耗时负值应归零');
  assert.deepEqual(fallback.tags, ['unknown']);
});

test('charts：SVG 结构正确且对文本做转义', () => {
  const bar = barChart([{ label: '阅读', value: 0.4, ratio: 0.4, hint: '4/10' }, { label: '<script>', value: 1 }]);
  assert.match(bar, /^<svg class="chart"/);
  assert.match(bar, /chart-bar bad/, '低正确率用 bad 色');
  assert.ok(!bar.includes('<script>'), '标签文本必须转义');
  assert.match(bar, /&lt;script&gt;/);

  const line = lineChart([{ label: '10-01', value: 0.5 }, { label: '10-02', value: 0.8 }]);
  assert.match(line, /chart-line/);
  assert.match(line, /<path d="M/);

  const ring = ringChart(0.75, { label: '掌握度' });
  assert.match(ring, /stroke-dasharray/);
  assert.match(ring, /75%/);

  const heat = heatmapGrid([{ date: '2026-10-01', count: 10, level: 2 }, { date: '2026-10-02', count: 0, level: 0 }], { columns: 2 });
  assert.match(heat, /heat-2/);
  assert.match(heat, /heat-0/);

  assert.ok(CHART_CSS.includes('.chart-bar.good'));
  assert.equal(lineChart([]).includes('chart-line'), false, '空数据不应画线');
});

test('recommend：由最弱项生成组卷参数并能抽到题', () => {
  const bank = normalizeBank({
    schema: 'qingci-question-bank/1',
    version: '1',
    counts: { total: 6, byType: {}, byKind: {} },
    papers: {},
    questions: [
      { id: 'q_paper_qingci_detail_01', kind: 'detail', difficulty: 0.5, discrimination: 0.4, knowledgeTags: ['gate:detail'], content: { prompt: 'p1', answer: 'a', choices: ['a', 'b'] } },
      { id: 'q_paper_qingci_detail_02', kind: 'detail', difficulty: 0.55, discrimination: 0.4, knowledgeTags: ['gate:detail'], content: { prompt: 'p2', answer: 'a', choices: ['a', 'b'] } },
      { id: 'q_paper_qingci_detail_03', kind: 'detail', difficulty: 0.6, discrimination: 0.4, knowledgeTags: ['gate:detail'], content: { prompt: 'p3', answer: 'a', choices: ['a', 'b'] } },
      { id: 'q_paper_qingci_detail_04', kind: 'detail', difficulty: 0.45, discrimination: 0.4, knowledgeTags: ['gate:detail'], content: { prompt: 'p4', answer: 'a', choices: ['a', 'b'] } },
      { id: 'q_paper_qingci_news_01', kind: 'news', difficulty: 0.4, discrimination: 0.35, knowledgeTags: ['gate:news'], content: { prompt: 'n1', answer: 'a', choices: ['a', 'b'] } },
      { id: 'q_paper_qingci_news_02', kind: 'news', difficulty: 0.42, discrimination: 0.35, knowledgeTags: ['gate:news'], content: { prompt: 'n2', answer: 'a', choices: ['a', 'b'] } },
    ],
  });
  assert.ok(bank);

  const weaknesses = [
    { key: 'gate:detail', scope: 'tag', label: 'gate:detail', total: 12, correct: 4, accuracy: 0.33, lowerBound: 0.14, weakness: 0.72, severity: 'high', advice: 'x' },
  ];
  const rec = recommendPractice(bank, weaknesses, { count: 4 });
  assert.ok(rec);
  assert.deepEqual(rec.spec.preferTags, ['gate:detail']);
  assert.equal(rec.candidates, 4);
  assert.match(rec.rationale, /gate:detail/);

  const built = buildRecommendedSet(bank, weaknesses, { count: 3, seed: 7 });
  assert.ok(built);
  assert.equal(built.set.questions.length, 3);
  // 推荐是「主攻 + 少量其它方向」，因此按题型均衡分配名额：
  // 4 道 detail + 2 道 news，抽 3 题 ⇒ detail 至少 2 题
  const detailCount = built.set.questions.filter((q) => q.kind === 'detail').length;
  assert.ok(detailCount >= 2, `最弱方向应占多数，实际 detail=${detailCount}`);

  assert.equal(recommendPractice(null, weaknesses), null, '题库缺失时返回 null');
  assert.equal(recommendPractice(bank, [{ ...weaknesses[0], severity: 'insufficient' }]), null, '样本不足不推荐');
  assert.match(describeRecommendation(rec), /gate:detail/);
  assert.equal(countCandidates(bank, weaknesses[0]), 4);
});

test('report-store：IDB v4 读写、筛选与降级', async () => {
  idb.__resetIdbCache();
  const factory = makeFakeIdb();
  const store = createReportStore(factory);
  assert.equal(store.available(), true);

  await store.addAttempt(attempt({ at: base.toISOString(), paperId: 'qingci' }));
  await store.addAttempt(attempt({ at: new Date(base.getTime() + 86400000).toISOString(), paperId: 'library' }));
  const names = factory._names();
  for (const required of ['attempts', 'reports', 'datasets', 'mistakes', 'vocab']) {
    assert.ok(names.includes(required), `v4 schema 应包含 ${required} 仓库，实际 ${names.join(',')}`);
  }

  const all = await store.attempts();
  assert.equal(all.length, 2);
  assert.equal((await store.attempts({ paperId: 'qingci' })).length, 1);
  assert.equal((await store.attempts({ since: new Date(base.getTime() + 1000) })).length, 1);
  assert.equal((await store.attempts({ limit: 1 })).length, 1);

  const report = buildPaperReport({
    paperId: 'qingci', paperName: '青词卷', examId: 'cet4', examName: 'CET-4',
    score: 500, total: 710, passLine: 425, passed: true, completed: true,
    queue: [{ gate: 'detail' }], answered: 1, got: { detail: 1 }, at: base,
  });
  assert.equal(await store.addReport(report), true);
  assert.equal((await store.latestReport()).score, 500);
  assert.equal((await store.reports(5)).length, 1);
  assert.deepEqual(await store.count(), { attempts: 2, reports: 1 });

  await store.clear();
  assert.deepEqual(await store.count(), { attempts: 0, reports: 0 });
  idb.__resetIdbCache();
});

test('report-store：IndexedDB 不可用时全部降级', async () => {
  idb.__resetIdbCache();
  const store = createReportStore(null);
  assert.equal(store.available(), false);
  assert.equal(await store.addAttempt(attempt()), false);
  assert.equal(await store.addAttempts([attempt()]), 0);
  assert.deepEqual(await store.attempts(), []);
  assert.equal(await store.addReport({}), false);
  assert.deepEqual(await store.reports(), []);
  assert.equal(await store.latestReport(), null);
  assert.deepEqual(await store.count(), { attempts: 0, reports: 0 });
  await store.clear();
  idb.__resetIdbCache();
});

test('report：本地日期键不受 UTC 偏移影响', () => {
  const d = new Date(2026, 9, 3, 0, 30); // 本地 2026-10-03 00:30
  assert.equal(localDateKey(d), '2026-10-03');
});
