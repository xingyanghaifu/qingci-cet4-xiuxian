/**
 * 词汇分级 + 词汇 SRS + 复习出题 + 单词增强 单元测试（P1 任务 A）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/load-ts.mjs';
import { makeFakeIdb } from './helpers/fake-idb.mjs';
import { buildVocabGrades, assignTiers, assignTiersByFrequency, affixCount, TIERS } from '../scripts/build-vocab-grades.mjs';

const gradesModule = await loadTs('src/services/vocab-grades.ts');
const srsModule = await loadTs('src/services/vocab-srs.ts');
const questionModule = await loadTs('src/services/vocab-question.ts');
const enrichModule = await loadTs('src/services/vocab-enrich.ts');
const idb = await loadTs('src/services/idb.ts');

const { tierOf, tierCounts, wordsOfTier, gradesSource, VOCAB_GRADES } = gradesModule;
const { createVocabSrsStore, createVocabRecord, rateVocabRecord, planLegacyVocabMigration } = srsModule;
const { buildVocabQuestion, buildReviewQuestions, bankIdFor } = questionModule;
const { splitAffixes, findConfusables, editDistance, collocationsFor, enrichWord, describeEnrichment } = enrichModule;

const base = new Date('2026-10-03T09:00:00.000Z');
const LEXICON = [
  { w: 'abandon', ipa: '[əˈbændən]', zh: 'vt.丢弃；放弃', short: '丢弃' },
  { w: 'ability', ipa: '[əˈbiliti]', zh: 'n.能力', short: '能力' },
  { w: 'abandoned', ipa: '[əˈbændənd]', zh: 'a.被遗弃的', short: '被遗弃的' },
  { w: 'band', ipa: '[bænd]', zh: 'n.乐队', short: '乐队' },
  { w: 'apple', ipa: '["æpl]', zh: 'n.苹果', short: '苹果' },
];

test('grades：四档分布稳定且覆盖全部 4540 词', () => {
  const counts = tierCounts();
  assert.deepEqual(Object.keys(counts).sort(), [...TIERS].sort());
  const total = TIERS.reduce((sum, t) => sum + counts[t], 0);
  assert.equal(total, 4540, '四档应覆盖全部词');
  assert.ok(counts.high > 0 && counts.core > 0 && counts.low > 0 && counts.recognition > 0);
  assert.ok(counts.high < counts.core, '高频档应少于核心档');
  assert.equal(VOCAB_GRADES.schema, 'qingci-vocab-grades/1');
});

test('grades：查档与来源标注正确（启发式需明确标注）', () => {
  const source = gradesSource();
  assert.equal(source.isRealFrequency, false, '当前为启发式分级，必须如实标注');
  assert.match(source.note, /启发式/);
  const word = wordsOfTier('high')[0];
  assert.equal(tierOf(word), 'high');
  assert.equal(tierOf('zzzz-not-a-word'), 'core', '词库外的词按 core 兜底');
});

test('grades：词缀计数与打分逻辑（脚本层）', () => {
  assert.equal(affixCount('information'), 2, 'in- 前缀 + -ation 后缀（不重复计 -tion）');
  assert.ok(affixCount('internationalization') >= 2);
  assert.equal(affixCount('cat'), 0);

  const entries = [
    { w: 'cat', short: '猫' },
    { w: 'internationalization', short: '国际化' },
    { w: 'run', short: '跑' },
    { w: 'consideration', short: '考虑' },
  ];
  const tiers = assignTiers(entries.map((e, i) => ({ ...e, score: 1 - i / 3 })));
  assert.equal(tiers.high[0], 'cat', '分数最高者进高频');
  assert.ok(tiers.recognition.length >= 1);

  const frequencyWords = ['run', 'cat'];
  const byFreq = assignTiersByFrequency(entries, frequencyWords);
  assert.equal(byFreq.high[0], 'run', '词频排名最前者进高频档');
  assert.ok(byFreq.recognition.includes('internationalization'), '词频表未收录 → 认知词');
  assert.ok(byFreq.recognition.includes('consideration'), '词频表未收录 → 认知词');
  assert.ok(byFreq.high.length >= 1 && byFreq.recognition.length >= 2);
});

test('grades：生成器可用外部词频表（-frequency 通道）', () => {
  const grades = buildVocabGrades({ frequencyWords: ['abandon', 'ability'], html: undefined });
  assert.equal(grades.source, 'frequency-list');
  assert.equal(TIERS.reduce((sum, t) => sum + grades.counts[t], 0), 4540, '未收录的词仍要归档');
});

test('vocab-srs：新建记录与 SM-2 评分推进间隔', () => {
  let record = createVocabRecord('abandon', base);
  assert.equal(record.proficiency, 0);
  assert.equal(record.tier, tierOf('abandon'));
  assert.equal(new Date(record.nextReviewAt).getTime(), base.getTime());

  const first = rateVocabRecord(record, 'good', base);
  assert.equal(first.intervalDays, 1);
  assert.equal(first.repetitions, 1);
  assert.equal(first.reviews, 1);
  const second = rateVocabRecord(first, 'good', base);
  assert.equal(second.intervalDays, 6);
  const third = rateVocabRecord(second, 'good', base);
  assert.equal(third.intervalDays, 15);
  assert.ok(third.proficiency >= 3);

  const lapsed = rateVocabRecord(third, 'again', base);
  assert.equal(lapsed.repetitions, 0);
  assert.equal(lapsed.intervalDays, 0.25);
  assert.equal(lapsed.lapses, 1);
  assert.equal(lapsed.proficiency, 0, '答错后熟练度回到 0');
});

test('vocab-srs：旧存档 schedule 迁移为 SM-2 初值（保留已有进度）', () => {
  const records = planLegacyVocabMigration({
    abandon: { level: 'hard', next: base.getTime() + 86_400_000, tries: 3 },
    ability: { level: 'easy', next: base.getTime() - 5 * 86_400_000, tries: 9 },
  }, base);
  assert.equal(records.length, 2);
  const abandon = records.find((r) => r.w === 'abandon');
  assert.equal(abandon.ease, 2.4);
  assert.equal(abandon.intervalDays, 1);
  assert.equal(abandon.reviews, 3);
  assert.equal(abandon.source, 'legacy');
  const ability = records.find((r) => r.w === 'ability');
  assert.equal(ability.nextReviewAt, base.toISOString(), '过期的 next 拉回「现在」');
  assert.deepEqual(planLegacyVocabMigration(null, base), []);
  assert.deepEqual(planLegacyVocabMigration(undefined, base), []);
});

test('vocab-srs：仓库读写、到期队列、统计与迁移幂等（含 v3 schema）', async () => {
  idb.__resetIdbCache();
  const factory = makeFakeIdb();
  const store = createVocabSrsStore(factory);
  assert.equal(store.available(), true);

  const saved = await store.rate('abandon', 'good', base);
  assert.ok(saved, '应写入一条 SRS 记录');
  const storeNames = factory._names();
  for (const required of ['datasets', 'meta', 'mistakes', 'reviews', 'vocab']) {
    assert.ok(storeNames.includes(required), `schema 应包含 ${required} 仓库，实际 ${storeNames.join(',')}`);
  }

  const dueLater = await store.due(10, new Date(base.getTime() + 2 * 86_400_000));
  assert.equal(dueLater.length, 1, '1 天后到期的词在 2 天后应进入队列');
  assert.equal((await store.due(10, base)).length, 0, '当天尚未到期');

  const stats = await store.stats(new Date(base.getTime() + 2 * 86_400_000));
  assert.equal(stats.total, 1);
  assert.equal(stats.due, 1);
  assert.equal(stats.forecast.length, 7);
  assert.ok(stats.byTier.length >= 1);

  const pending = await store.wordsNotInSrs(['abandon', 'ability'], 5);
  assert.deepEqual(pending, ['ability'], '已入列的词不再作为新词');

  const first = await store.migrateLegacy({ ability: { level: 'good', next: base.getTime(), tries: 1 } }, { now: base });
  assert.equal(first.skipped, false);
  assert.equal(first.migrated, 1);
  const second = await store.migrateLegacy({ ability: { level: 'good', next: base.getTime(), tries: 1 } }, { now: base });
  assert.equal(second.skipped, true, '迁移应幂等');
  assert.equal((await store.all()).length, 2);
  idb.__resetIdbCache();
});

test('vocab-srs：IndexedDB 不可用时全部降级', async () => {
  idb.__resetIdbCache();
  const store = createVocabSrsStore(null);
  assert.equal(store.available(), false);
  assert.deepEqual(await store.all(), []);
  assert.equal(await store.rate('abandon', 'good'), null);
  assert.deepEqual(await store.due(), []);
  assert.equal((await store.stats()).total, 0);
  assert.deepEqual(await store.wordsNotInSrs(['a'], 1), []);
  assert.deepEqual(await store.migrateLegacy({}, {}), { migrated: 0, skipped: true });
  idb.__resetIdbCache();
});

test('vocab-question：题目 id 与题库规则一致，可直接关联错题本', () => {
  assert.equal(bankIdFor(0, 'en2zh'), 'q_vocab_0000_en2zh');
  assert.equal(bankIdFor(123, 'spell'), 'q_vocab_0123_spell');

  const q = buildVocabQuestion(LEXICON[0], 0, 'en2zh', LEXICON);
  assert.equal(q.questionId, 'q_vocab_0000_en2zh');
  assert.equal(q.word, 'abandon');
  assert.equal(q.vocabWord, 'abandon');
  assert.equal(q.answer, '丢弃');
  assert.equal(q.choices.length, 4);
  assert.ok(q.choices.includes('丢弃'));
  assert.equal(new Set(q.choices).size, 4, '选项不应重复');
});

test('vocab-question：五种题型结构正确且确定性', () => {
  const spell = buildVocabQuestion(LEXICON[0], 0, 'spell', LEXICON);
  assert.equal(spell.kind, 'spell');
  assert.equal(spell.answer, 'abandon');
  assert.equal(spell.hint, 7);
  assert.equal(spell.tpl, 'a______');
  assert.equal(spell.choices.length, 0);

  const listen = buildVocabQuestion(LEXICON[0], 0, 'listen', LEXICON);
  assert.equal(listen.speak, 'abandon');
  assert.ok(listen.choices.includes('abandon'));

  const zh2en = buildVocabQuestion(LEXICON[0], 0, 'zh2en', LEXICON);
  assert.equal(zh2en.prompt, '丢弃');
  assert.equal(zh2en.answer, 'abandon');

  const similar = buildVocabQuestion(LEXICON[0], 0, 'similar', LEXICON);
  assert.equal(similar.answer, 'abandon');

  const again = buildVocabQuestion(LEXICON[0], 0, 'en2zh', LEXICON);
  assert.deepEqual(again.choices, buildVocabQuestion(LEXICON[0], 0, 'en2zh', LEXICON).choices, '同词同题型应可复现');

  const batch = buildReviewQuestions([{ entry: LEXICON[0], index: 0 }, { entry: LEXICON[1], index: 1 }], LEXICON);
  assert.equal(batch.length, 2);
  assert.notEqual(batch[0].memKind, batch[1].memKind, '连续两题应轮换题型');
});

test('vocab-enrich：词缀拆分、易混词与搭配框架', () => {
  assert.deepEqual(splitAffixes('international'), { prefix: 'inter', stem: 'national' });
  const split = splitAffixes('consideration');
  assert.equal(split.suffix, 'ation');
  assert.ok(split.stem.length > 0);
  assert.equal(splitAffixes('cat').prefix, undefined);

  assert.equal(editDistance('abandon', 'abandon'), 0);
  assert.equal(editDistance('abandon', 'abandoned'), 2);
  assert.ok(editDistance('cat', 'elephant', 2) > 2);

  const confusables = findConfusables('abandon', LEXICON);
  assert.ok(confusables.some((c) => c.w === 'abandoned'), '应识别出 abandoned 为易混词');
  assert.ok(confusables.every((c) => c.reason));

  assert.ok(collocationsFor({ w: 'ability', zh: 'n.能力' }).some((c) => c.includes('ability')));
  assert.ok(collocationsFor({ w: 'abandon', zh: 'vt.丢弃' }).length >= 2);

  const enrichment = enrichWord(LEXICON[0], LEXICON, { ttsAvailable: false });
  assert.equal(enrichment.tier, tierOf('abandon'));
  assert.equal(enrichment.ttsAvailable, false);
  assert.ok(enrichment.ipa.startsWith('['));
  const lines = describeEnrichment(enrichment);
  assert.ok(lines.length >= 1);

  const withSentence = enrichWord(LEXICON[0], LEXICON, { paperSentence: 'Students should abandon bad habits.' });
  assert.equal(withSentence.paperSentence.source, 'original-material');
  assert.ok(describeEnrichment(withSentence).some((l) => l.includes('本卷例句')));
});
