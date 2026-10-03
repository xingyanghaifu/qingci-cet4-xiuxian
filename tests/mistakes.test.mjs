/**
 * 错题数据模型 + 错题仓库 + 旧存档迁移单元测试（P0.2）
 *
 * 覆盖：
 *   1. 稳定 id（同题同 id，换题型即换 id，题库上线后可传 questionId）
 *   2. 试卷 gate → 题型映射（听力 / 阅读 / 翻译 / 写作）
 *   3. 错题仓库 CRUD 与 SM-2 复习日志
 *   4. v3/v4 旧存档迁移：只读旧数据、幂等、保留旧复习进度
 *   5. IndexedDB 不可用时的降级
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/load-ts.mjs';
import { makeFakeIdb } from './helpers/fake-idb.mjs';

const model = await loadTs('src/types/mistakes.ts');
const storeModule = await loadTs('src/services/mistake-store.ts');
const migrate = await loadTs('src/services/migrate.ts');
const idb = await loadTs('src/services/idb.ts');

const { createMistake, bumpMistake, mistakeId, typeFromGate, summarizeMistakes, proficiencyOf } = model;
const { createMistakeStore } = storeModule;
const { planLegacyMigration, runLegacyMigration, describeMigration, readMigrationMark } = migrate;

const base = new Date('2026-10-03T09:00:00.000Z');

test('model：错题 id 稳定且与题意绑定', () => {
  const a = mistakeId({ type: 'read', prompt: 'Passage 1 Q3', correctAnswer: 'B' });
  const b = mistakeId({ type: 'read', prompt: 'Passage 1 Q3', correctAnswer: 'B' });
  const c = mistakeId({ type: 'listen', prompt: 'Passage 1 Q3', correctAnswer: 'B' });
  const d = mistakeId({ type: 'read', prompt: 'Passage 1 Q3', correctAnswer: 'C' });
  assert.equal(a, b, '同题必须同 id，否则复习间隔会被拆散');
  assert.notEqual(a, c, '不同题型应视为不同题');
  assert.notEqual(a, d, '答案不同应视为不同题');
  assert.equal(mistakeId({ type: 'read', prompt: 'x', correctAnswer: 'y', questionId: 'q_read_12' }), 'q_read_12', '题库 id 优先');
});

test('model：试卷 gate 映射到四类题型', () => {
  assert.equal(typeFromGate('write', '写作'), 'write');
  assert.equal(typeFromGate('trans', '翻译'), 'translate');
  assert.equal(typeFromGate('news', '听力'), 'listen');
  assert.equal(typeFromGate('talk', '听力'), 'listen');
  assert.equal(typeFromGate('passage', '听力'), 'listen');
  assert.equal(typeFromGate('detail', '阅读'), 'read');
  assert.equal(typeFromGate('', '阅读'), 'read');
  assert.equal(typeFromGate(undefined, '未知'), 'vocab');
});

test('model：新建错题立即可复习，再次答错累加并重置进度', () => {
  const record = createMistake({
    type: 'translate',
    prompt: '把这句话译成英文',
    userAnswer: 'I go school',
    correctAnswer: 'I go to school.',
    explanation: '缺介词',
    now: base,
  });
  assert.equal(record.wrongCount, 1);
  assert.equal(record.proficiency, 0);
  assert.equal(record.nextReviewAt, base.toISOString(), '首次答错应立即进入今日队列');
  assert.deepEqual(record.knowledgeTags, ['translate']);

  const bumped = bumpMistake({ ...record, repetitions: 3, intervalDays: 15, proficiency: 4 }, { userAnswer: 'x', now: base });
  assert.equal(bumped.wrongCount, 2);
  assert.equal(bumped.repetitions, 0);
  assert.equal(bumped.intervalDays, 0);
  assert.equal(bumped.nextReviewAt, base.toISOString());
});

test('model：熟练度等级随 SM-2 状态推导', () => {
  assert.equal(proficiencyOf({ repetitions: 0, ease: 2.5, wrongCount: 3, intervalDays: 0 }), 0, '刚答错应为 0 级');
  assert.equal(proficiencyOf({ repetitions: 1, ease: 2.5, wrongCount: 2, intervalDays: 1 }), 2);
  assert.equal(proficiencyOf({ repetitions: 2, ease: 2.5, wrongCount: 2, intervalDays: 6 }), 3);
  assert.equal(proficiencyOf({ repetitions: 5, ease: 2.8, wrongCount: 1, intervalDays: 30 }), 5);
});

test('model：汇总按题型统计并给出薄弱知识点', () => {
  const rows = [
    createMistake({ type: 'listen', prompt: 'L1', userAnswer: 'A', correctAnswer: 'B', knowledgeTags: ['listen', '数字'], now: base }),
    createMistake({ type: 'listen', prompt: 'L2', userAnswer: 'A', correctAnswer: 'C', knowledgeTags: ['数字'], now: base }),
    createMistake({ type: 'write', prompt: 'W1', userAnswer: '', correctAnswer: '', knowledgeTags: ['write'], now: base }),
  ];
  const later = new Date(base.getTime() + 1000);
  const summary = summarizeMistakes(rows, later);
  assert.equal(summary.total, 3);
  assert.equal(summary.due, 3, '刚建的错题 nextReviewAt = 创建时刻，之后即视为到期');
  assert.deepEqual(summary.byType.map((r) => r.type).sort(), ['listen', 'write']);
  assert.equal(summary.byType.find((r) => r.type === 'listen').total, 2);
  assert.equal(summary.weakTags[0].tag, '数字', '出现次数最多的标签排在前面');
});

test('model：到期统计与薄弱标签排序', () => {
  const rows = [
    { ...createMistake({ type: 'read', prompt: 'R1', userAnswer: '', correctAnswer: 'A', knowledgeTags: ['细节题'], now: base }), wrongCount: 4 },
    { ...createMistake({ type: 'read', prompt: 'R2', userAnswer: '', correctAnswer: 'B', knowledgeTags: ['细节题', '主旨题'], now: base }), wrongCount: 1 },
  ];
  const before = summarizeMistakes(rows, new Date(base.getTime() - 1000));
  assert.equal(before.due, 0, 'nextReviewAt 晚于「现在」时不算到期');
  const after = summarizeMistakes(rows, new Date(base.getTime() + 1000));
  assert.equal(after.due, 2);
  assert.equal(after.byType.length, 1);
  assert.equal(after.byType[0].type, 'read');
  assert.equal(after.byType[0].wrongCount, 5);
  assert.equal(after.weakTags[0].tag, '细节题');
  assert.equal(after.weakTags[0].count, 5);
});

test('store：错题入库、SM-2 复习与日志', async () => {
  idb.__resetIdbCache();
  const factory = makeFakeIdb();
  const store = createMistakeStore(factory);
  assert.equal(store.available(), true);

  const first = await store.recordWrong({ type: 'listen', prompt: '听力第 1 题', userAnswer: 'A', correctAnswer: 'B', now: base });
  assert.ok(first, '应写入一条错题');
  assert.deepEqual(
    factory._names().sort(),
    ['datasets', 'meta', 'mistakes', 'reviews', 'vocab'],
    'v3 schema 应建齐五个仓库（vocab 为 P1 任务 A 新增）',
  );
  const second = await store.recordWrong({ type: 'listen', prompt: '听力第 1 题', userAnswer: 'C', correctAnswer: 'B', now: base });
  assert.equal(second.wrongCount, 2, '同题再次答错应累加而不是新建');
  assert.equal((await store.all()).length, 1);

  const outcome = await store.rate(first.id, 'good', base);
  assert.equal(outcome.intervalDays, 1);
  assert.equal(factory._count('reviews'), 1, '每次复习应留一条日志');

  const summary = await store.summary(new Date(base.getTime() + 2 * 86_400_000));
  assert.equal(summary.total, 1);
  assert.equal(summary.due, 1, '1 天后到期的题在 2 天后应进入今日队列');

  idb.__resetIdbCache();
});

test('store：IndexedDB 不可用时全部降级、不抛异常', async () => {
  idb.__resetIdbCache();
  const store = createMistakeStore(null);
  assert.equal(store.available(), false);
  assert.deepEqual(await store.all(), []);
  assert.equal(await store.recordWrong({ type: 'write', prompt: 'W', userAnswer: '', correctAnswer: '' }), null);
  assert.equal(await store.rate('nope', 'good'), null);
  assert.deepEqual(await store.due(), []);
  assert.equal((await store.summary()).total, 0);
  await store.clear();
  idb.__resetIdbCache();
});

test('migrate：旧存档为空或无错词时不迁移', () => {
  const empty = planLegacyMigration(null, { now: base });
  assert.equal(empty.skippedReason, 'empty');
  assert.deepEqual(empty.records, []);

  const nothing = planLegacyMigration({ version: 4, wrong: {} }, { now: base });
  assert.equal(nothing.skippedReason, 'nothing-to-migrate');
  assert.equal(nothing.legacyVersion, 4);
});

test('migrate：心魔本与旧复习进度换算为 SM-2 初值', () => {
  const plan = planLegacyMigration({
    version: 4,
    wrong: { abandon: 3, ability: 1 },
    schedule: {
      abandon: { level: 'hard', next: base.getTime() + 86_400_000, tries: 2 },
      ability: { level: 'easy', next: base.getTime() - 5 * 86_400_000, tries: 7 },
    },
  }, {
    now: base,
    lookupWord: (w) => ({ zh: w === 'abandon' ? 'vt.丢弃；放弃' : 'n.能力' }),
  });

  assert.equal(plan.records.length, 2);
  const abandon = plan.records.find((r) => r.prompt === 'abandon');
  assert.equal(abandon.type, 'vocab');
  assert.equal(abandon.correctAnswer, 'vt.丢弃；放弃', '应用词库补齐释义');
  assert.equal(abandon.wrongCount, 3);
  assert.equal(abandon.reviewCount, 2, '保留旧 tries 作为复习次数');
  assert.equal(abandon.ease, 2.4, 'hard 档换算的 EF');
  assert.equal(abandon.intervalDays, 1);
  assert.equal(abandon.repetitions, 1);
  assert.deepEqual(abandon.knowledgeTags, ['vocab', 'legacy']);

  const ability = plan.records.find((r) => r.prompt === 'ability');
  assert.equal(ability.ease, 2.7);
  assert.equal(ability.repetitions, 2);
  assert.equal(ability.nextReviewAt, base.toISOString(), '已过期的 next 应被拉回“现在”，避免负数间隔');
});

test('migrate：迁移幂等（第二次跳过），force 可重跑', async () => {
  idb.__resetIdbCache();
  const factory = makeFakeIdb();
  const store = createMistakeStore(factory);
  const legacy = { version: 4, wrong: { abandon: 2 } };

  const first = await runLegacyMigration(store, legacy, { now: base, factory });
  assert.equal(first.skipped, false);
  assert.equal(first.migrated, 1);
  assert.equal(first.byType.vocab, 1, '迁移来源是词汇错题');

  const mark = await readMigrationMark(factory);
  assert.ok(mark, '应写入迁移标记');
  assert.equal(mark.count, 1);

  const second = await runLegacyMigration(store, legacy, { now: base, factory });
  assert.equal(second.skipped, true);
  assert.equal(second.reason, 'already-migrated');
  assert.equal((await store.all()).length, 1, '不应重复导入');

  const forced = await runLegacyMigration(store, legacy, { now: base, factory, force: true });
  assert.equal(forced.migrated, 1);
  assert.equal((await store.all()).length, 1, 'force 重跑也不应产生重复记录（同 id 覆盖）');
  idb.__resetIdbCache();
});

test('migrate：结果文案可读，IndexedDB 不可用时说明降级', async () => {
  assert.match(describeMigration({ skipped: false, migrated: 3, legacyWrongCount: 3, byType: { vocab: 3 } }), /导入 3 条错题/);
  assert.match(describeMigration({ skipped: true, reason: 'already-migrated', migrated: 0, legacyWrongCount: 0, byType: {} }), /无需重复导入/);
  assert.match(describeMigration({ skipped: true, reason: 'nothing-to-migrate', migrated: 0, legacyWrongCount: 0, byType: {} }), /没有错词/);

  idb.__resetIdbCache();
  const store = createMistakeStore(null);
  const result = await runLegacyMigration(store, { version: 4, wrong: { a: 1 } }, { now: base });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'indexeddb-unavailable');
  assert.match(describeMigration(result), /离线数据库/);
  idb.__resetIdbCache();
});
