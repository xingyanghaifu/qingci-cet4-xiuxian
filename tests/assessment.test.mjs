/**
 * 自适应词汇量测试 + 学习计划设置 单元测试（P1 任务 C）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/load-ts.mjs';

const assessment = await loadTs('src/services/assessment.ts');
const settings = await loadTs('src/services/plan-settings.ts');
const plan = await loadTs('src/services/study-plan.ts');

const {
  createAssessment, applyAnswer, buildAssessmentItem, estimateAssessment, describeAssessment,
  shouldStop, nextLevel, tierForLevel, priorMastery,
  ASSESSMENT_MIN_ITEMS, ASSESSMENT_MAX_ITEMS, ASSESSMENT_LEVELS,
} = assessment;
const { normalizePlanSettings, loadPlanSettings, savePlanSettings, daysToExam, DEFAULT_PLAN_SETTINGS, PLAN_SETTINGS_KEY } = settings;
const { planStudyLoad, adjustPlan } = plan;

const base = new Date('2026-10-03T09:00:00.000Z');

/** 造一个可控的词库：四档各若干词 */
const LEXICON = [];
for (const [tier, count] of [['high', 20], ['core', 20], ['low', 20], ['recognition', 20]]) {
  for (let i = 0; i < count; i++) {
    LEXICON.push({ w: `${tier}${i}`, ipa: `[${tier}]`, zh: `n.${tier}释义${i}`, short: `${tier}${i}义` });
  }
}
const poolFor = (tier) => LEXICON.filter((e) => e.w.startsWith(tier));

const answer = (state, correct) => applyAnswer(state, {
  word: state.answers.length + '-w',
  tier: tierForLevel(state.level),
  level: state.level,
  correct,
}, base);

test('assessment：阶梯升降与上下限', () => {
  assert.equal(nextLevel(3, true), 4);
  assert.equal(nextLevel(3, false), 2);
  assert.equal(nextLevel(ASSESSMENT_LEVELS, true), ASSESSMENT_LEVELS, '封顶 5');
  assert.equal(nextLevel(1, false), 1, '保底 1');
  assert.equal(tierForLevel(1), 'high');
  assert.equal(tierForLevel(3), 'core');
  assert.equal(tierForLevel(5), 'recognition');
  const p = priorMastery(5);
  assert.ok(p.recognition > priorMastery(1).recognition, '高阶梯下认知词先验掌握率更高');
});

test('assessment：题量在 30–50 之间收敛，极端表现提前收题', () => {
  let state = createAssessment(1, base);
  assert.equal(shouldStop(state), false, '起始不收题');

  // 一直答对：达到最少题量后应提前收敛
  let allRight = createAssessment(2, base);
  for (let i = 0; i < ASSESSMENT_MAX_ITEMS && !allRight.finished; i++) allRight = answer(allRight, true);
  assert.ok(allRight.finished);
  assert.ok(allRight.answers.length >= ASSESSMENT_MIN_ITEMS, '不应少于最少题量');
  assert.ok(allRight.answers.length <= ASSESSMENT_MAX_ITEMS, '不应超过上限');
  assert.ok(allRight.answers.length < ASSESSMENT_MAX_ITEMS, '高分表现应提前收敛');

  // 全错：同样提前收敛
  let allWrong = createAssessment(3, base);
  for (let i = 0; i < ASSESSMENT_MAX_ITEMS && !allWrong.finished; i++) allWrong = answer(allWrong, false);
  assert.ok(allWrong.finished && allWrong.answers.length <= ASSESSMENT_MAX_ITEMS);

  // 五五开：会一路做到上限
  let mixed = createAssessment(4, base);
  for (let i = 0; i < ASSESSMENT_MAX_ITEMS && !mixed.finished; i++) mixed = answer(mixed, i % 2 === 0);
  assert.equal(mixed.answers.length, ASSESSMENT_MAX_ITEMS, '无明显趋势时做到上限');
  state = mixed;
  assert.equal(state.answers.length, 50);
});

test('assessment：估计值与区间随表现变化，且置信度分档', () => {
  let strong = createAssessment(11, base);
  for (let i = 0; i < ASSESSMENT_MAX_ITEMS && !strong.finished; i++) strong = answer(strong, true);
  const strongEst = estimateAssessment(strong);

  let weak = createAssessment(12, base);
  for (let i = 0; i < ASSESSMENT_MAX_ITEMS && !weak.finished; i++) weak = answer(weak, false);
  const weakEst = estimateAssessment(weak);

  assert.ok(strongEst.vocabSize > weakEst.vocabSize, '全对估计应高于全错');
  assert.ok(strongEst.range[0] <= strongEst.vocabSize && strongEst.vocabSize <= strongEst.range[1], '点估计应落在区间内');
  assert.ok(strongEst.range[0] <= strongEst.range[1]);
  assert.ok(weakEst.range[0] <= weakEst.range[1]);
  assert.equal(strongEst.items, strong.answers.length);
  assert.equal(strongEst.accuracy, 1);
  assert.equal(weakEst.accuracy, 0);
  assert.ok(strongEst.byTier.length === 4, '四档都要有统计');
  assert.ok(strongEst.vocabSize <= 4540 && weakEst.vocabSize >= 0);
  assert.ok(['high', 'medium', 'low'].includes(strongEst.confidence));
  assert.match(describeAssessment(strong, strongEst), /估计词汇量约/);
  assert.match(describeAssessment(createAssessment(5, base)), /第 1 题/);
});

test('assessment：题量不足时置信度低并给出说明', () => {
  let state = createAssessment(21, base);
  for (let i = 0; i < 8; i++) state = answer(state, i % 2 === 0);
  const est = estimateAssessment(state);
  assert.equal(est.confidence, 'low');
  assert.ok(est.notes.length > 0, '应提示样本不足');
  assert.ok(est.range[1] - est.range[0] > 200, '样本少时区间应较宽');
});

test('assessment：出题跳过考过的词、选项不重复、同种子可复现', () => {
  const state = createAssessment(7, base);
  const item1 = buildAssessmentItem(state, poolFor('core'), LEXICON);
  assert.ok(item1);
  assert.equal(item1.tier, 'core');
  assert.equal(item1.choices.length, 4);
  assert.equal(new Set(item1.choices).size, 4, '选项不应重复');
  assert.ok(item1.choices.includes(item1.answer));
  assert.ok(item1.answer.length > 0);

  const asked = applyAnswer(state, { word: item1.word, tier: item1.tier, level: item1.level, correct: true }, base);
  const item2 = buildAssessmentItem(asked, poolFor(tierForLevel(asked.level)), LEXICON);
  assert.notEqual(item2.word, item1.word, '不应重复考同一个词');

  const again = buildAssessmentItem(state, poolFor('core'), LEXICON);
  assert.deepEqual(again.choices, item1.choices, '同状态同种子应可复现');

  assert.equal(buildAssessmentItem(state, [], LEXICON), null, '词池为空时返回 null');
});

test('settings：设置规范化、持久化与脏数据兜底', () => {
  const store = (() => {
    const map = new Map();
    return {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => { map.set(k, String(v)); },
      _map: map,
    };
  })();

  assert.deepEqual(loadPlanSettings(store), DEFAULT_PLAN_SETTINGS);
  const saved = savePlanSettings({ examDate: '2026-12-12', dailyMinutes: 45 }, store);
  assert.equal(saved.dailyMinutes, 45);
  assert.ok(store._map.get(PLAN_SETTINGS_KEY).includes('2026-12-12'));
  assert.equal(loadPlanSettings(store).dailyMinutes, 45);

  assert.equal(normalizePlanSettings({ examDate: 'bad', dailyMinutes: 9999, targetWords: -5 }).dailyMinutes, 240, '分钟数上限 240');
  assert.equal(normalizePlanSettings({ dailyMinutes: 1 }).dailyMinutes, 10, '分钟数下限 10');
  assert.equal(normalizePlanSettings({ examDate: 'not-a-date' }).examDate, DEFAULT_PLAN_SETTINGS.examDate);
  assert.equal(normalizePlanSettings(null).dailyMinutes, DEFAULT_PLAN_SETTINGS.dailyMinutes);

  store.setItem(PLAN_SETTINGS_KEY, '{坏 JSON');
  assert.deepEqual(loadPlanSettings(store), DEFAULT_PLAN_SETTINGS, '损坏数据应回落默认');
  assert.deepEqual(loadPlanSettings(null), DEFAULT_PLAN_SETTINGS, '无存储时回落默认');
  assert.equal(savePlanSettings({ dailyMinutes: 20 }, null).dailyMinutes, 20, '无存储时仍返回规范化结果');
});

test('settings：距考试天数按本地日期计算', () => {
  assert.equal(daysToExam('2026-10-04', base), 1);
  assert.equal(daysToExam('2026-10-03', base), 1, '当天按 1 天兜底');
  assert.equal(daysToExam('2026-10-02', base), 1, '已过期按 1 天兜底');
  assert.ok(daysToExam('2026-12-12', base) > 60);
});

test('plan：设置能驱动计划，并按摸底结果与成绩调整', () => {
  // 每日时间越多，允许的新词量越大（或至少不更少）
  const short = planStudyLoad({ now: base, examDate: '2026-12-12', knownWords: 500, dailyMinutes: 15 });
  const long = planStudyLoad({ now: base, examDate: '2026-12-12', knownWords: 500, dailyMinutes: 90 });
  assert.ok(long.newPerDay >= short.newPerDay);

  // 时间充裕时，掌握得越多 → 每日新词越少
  const lowMastery = planStudyLoad({ now: base, examDate: '2026-12-12', knownWords: 300, dailyMinutes: 120 });
  const highMastery = planStudyLoad({ now: base, examDate: '2026-12-12', knownWords: 3000, dailyMinutes: 120 });
  assert.ok(highMastery.newPerDay < lowMastery.newPerDay, '掌握度高时每日新词应更少');

  // 时间紧时两者都会被时间预算压到同一档（这是刻意设计：宁可少也要做完）
  const tightLow = planStudyLoad({ now: base, examDate: '2026-12-12', knownWords: 300, dailyMinutes: 40 });
  const tightHigh = planStudyLoad({ now: base, examDate: '2026-12-12', knownWords: 3000, dailyMinutes: 40 });
  assert.equal(tightLow.timeBound && tightHigh.timeBound, true, '两种水平在 40 分钟下都受时间约束');
  assert.ok(tightHigh.newPerDay <= tightLow.newPerDay);

  // 完成率/成绩反馈能调整
  const adjusted = adjustPlan(lowMastery, { completedRatio: 0.4, accuracy: 0.5, paperRatio: 0.45 });
  assert.ok(adjusted.newPerDay <= lowMastery.newPerDay);
  assert.ok(adjusted.mix.listen > lowMastery.mix.listen, '卷面差应提高听力配比');
});
