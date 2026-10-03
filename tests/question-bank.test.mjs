/**
 * 固化题库与组卷算法单元测试（P0.3）
 *
 * 覆盖：
 *   1. 生成器直接复用应用源码（沙箱求值），内容与运行时一致
 *   2. 稳定 id、字段裁剪、难度/标签约束
 *   3. 六套卷快照完整（6 × 57 题，id 列表与题目一一对应）
 *   4. 组卷：题型均衡、难度区间、排除近期题、同种子可复现
 *   5. 题库服务：IndexedDB 缓存优先、网络回退、防重复窗口、题目适配
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/load-ts.mjs';
import { buildQuestionBank, serializeBank, decideDelivery, CET4_GATE_PLAN } from '../scripts/build-question-bank.mjs';

const bankTypes = await loadTs('src/types/question-bank.ts');
const bankService = await loadTs('src/services/question-bank.ts');

const { normalizeBank, selectPracticeSet, weightOf, questionType, questionPart, seededRng, BANK_SCHEMA } = bankTypes;
const { createBankService, RECENT_IDS_KEY, RECENT_WINDOW } = bankService;

/** 小样本题库：200 个词 × 2 种题型 + 六套卷快照 */
const small = buildQuestionBank({ vocabKinds: ['en2zh', 'spell'], wordLimit: 200 });

test('bank：小样本结构正确，词汇题与试卷快照数量符合预期', () => {
  assert.equal(small.schema, BANK_SCHEMA);
  const vocab = small.questions.filter((q) => q.id.startsWith('q_vocab_'));
  const paper = small.questions.filter((q) => q.id.startsWith('q_paper_'));
  assert.equal(vocab.length, 400, '200 词 × 2 题型');
  assert.equal(paper.length, 342, '六套卷 × 57 题');
  assert.equal(small.counts.total, 742);
  assert.equal(Object.keys(small.papers).length, 6);
});

test('bank：试卷快照 id 与题目一一对应，且覆盖全部门类', () => {
  const plan = CET4_GATE_PLAN.reduce((n, [, count]) => n + count, 0);
  assert.equal(plan, 57, 'CET-4 卷应为 57 题');
  for (const [paperId, ids] of Object.entries(small.papers)) {
    assert.equal(ids.length, 57, `${paperId} 应有 57 个题目 id`);
    assert.equal(new Set(ids).size, 57, `${paperId} 的 id 不应重复`);
    for (const id of ids) {
      assert.match(id, new RegExp(`^q_paper_${paperId}_[a-z]+_\\d{2}$`));
      assert.ok(small.questions.some((q) => q.id === id), `${id} 应能在题目集合中找到`);
    }
  }
});

test('bank：题目字段完整、难度与区分度在合理区间、已做字段裁剪', () => {
  for (const q of small.questions) {
    assert.ok(q.difficulty >= 0.2 && q.difficulty <= 0.8, `${q.id} 难度应在 0.2–0.8`);
    assert.ok(q.discrimination > 0 && q.discrimination <= 0.5, `${q.id} 区分度先验应在 (0, 0.5]`);
    assert.ok(Array.isArray(q.knowledgeTags) && q.knowledgeTags.length > 0);
    assert.equal(typeof q.content.prompt, 'string');
    assert.equal(typeof q.content.answer, 'string');
    assert.equal(q.type, undefined, 'type 由 id 前缀推导，不应逐条存储');
    assert.equal(typeof questionType(q), 'string');
  }
  const listening = small.questions.find((q) => q.kind === 'passage');
  assert.ok(listening.audioMeta && listening.audioMeta.text, '听力题应带 audioMeta');
  const spelling = small.questions.find((q) => q.kind === 'spell');
  assert.ok(spelling.content.tpl && spelling.content.hint > 0, '拼写题应带占位模板与字母数');
});

test('bank：生成是确定性的（同输入 ⇒ 同字节）', () => {
  const again = buildQuestionBank({ vocabKinds: ['en2zh', 'spell'], wordLimit: 50 });
  const once = buildQuestionBank({ vocabKinds: ['en2zh', 'spell'], wordLimit: 50 });
  assert.equal(serializeBank(again), serializeBank(once));
});

test('bank：交付方式按 1.5 MB 阈值决策', () => {
  assert.equal(decideDelivery(200 * 1024).mode, 'inline');
  assert.equal(decideDelivery(6 * 1024 * 1024).mode, 'separate');
});

test('bank：结构校验会拒绝非法题库', () => {
  assert.equal(normalizeBank(null), null);
  assert.equal(normalizeBank({ schema: 'other' }), null);
  assert.equal(normalizeBank({ schema: BANK_SCHEMA, questions: [] }), null);
  assert.equal(normalizeBank({ schema: BANK_SCHEMA, questions: [{ id: 1 }] }), null);
  const ok = normalizeBank(small);
  assert.ok(ok && ok.questions.length === small.questions.length);
});

test('组卷：数量、题型均衡与难度区间约束', () => {
  const set = selectPracticeSet(small, { count: 20, seed: 7 });
  assert.equal(set.questions.length, 20);
  assert.equal(new Set(set.questions.map((q) => q.id)).size, 20, '不应重复抽到同一题');
  const kinds = Object.keys(set.kindMix);
  assert.ok(kinds.length >= 2, '应覆盖多种题型');
  for (const q of set.questions) {
    assert.ok(q.difficulty >= 0.08 && q.difficulty <= 0.92, '难度应落在请求区间附近');
  }
  assert.ok(set.avgDifficulty > 0);
});

test('组卷：同种子可复现，不同种子有差异', () => {
  const a = selectPracticeSet(small, { count: 10, seed: 42 });
  const b = selectPracticeSet(small, { count: 10, seed: 42 });
  const c = selectPracticeSet(small, { count: 10, seed: 43 });
  assert.deepEqual(a.questions.map((q) => q.id), b.questions.map((q) => q.id));
  assert.notDeepEqual(a.questions.map((q) => q.id), c.questions.map((q) => q.id));
});

test('组卷：排除近期题目后不再抽到它们', () => {
  const first = selectPracticeSet(small, { count: 12, seed: 5 });
  const usedIds = first.questions.map((q) => q.id);
  const second = selectPracticeSet(small, { count: 12, seed: 5, excludeIds: usedIds });
  for (const q of second.questions) {
    assert.ok(!usedIds.includes(q.id), `${q.id} 不应再次出现`);
  }
  assert.ok(second.filteredOut >= usedIds.length, '被排除的题应计入 filteredOut');
});

test('组卷：按部分（听力/阅读/翻译/写作）筛选与题型筛选', () => {
  const reading = selectPracticeSet(small, { count: 8, seed: 3, parts: ['阅读'] });
  assert.ok(reading.questions.every((q) => ['bank', 'match', 'detail'].includes(q.kind)));
  assert.equal(questionPart(reading.questions[0]), '阅读');

  const onlyVocab = selectPracticeSet(small, { count: 6, seed: 3, kinds: ['en2zh'] });
  assert.ok(onlyVocab.questions.every((q) => q.kind === 'en2zh'));

  const translation = selectPracticeSet(small, { count: 4, seed: 3, parts: ['翻译', '写作'] });
  assert.ok(translation.questions.length > 0);
  assert.ok(translation.questions.every((q) => ['trans', 'write'].includes(q.kind)));
});

test('组卷：默认按难度升序，形成由易到难', () => {
  const set = selectPracticeSet(small, { count: 15, seed: 11 });
  const diffs = set.questions.map((q) => q.difficulty);
  const sorted = diffs.slice().sort((a, b) => a - b);
  assert.deepEqual(diffs, sorted);
});

test('组卷：权重随区分度与标签命中提高', () => {
  const easy = small.questions.find((q) => q.kind === 'en2zh');
  const hard = { ...easy, discrimination: 0.9 };
  assert.ok(weightOf(hard, {}) > weightOf(easy, {}), '区分度高的题权重更高');
  const tagged = { ...easy, knowledgeTags: [...easy.knowledgeTags, 'paper:qingci'] };
  assert.ok(weightOf(tagged, { preferTags: ['paper:qingci'] }) > weightOf(tagged, {}), '命中偏好标签应加权');
  const rand = seededRng(1);
  assert.equal(typeof rand(), 'number');
});

test('service：缓存优先、离线可用，网络失败也不抛异常', async () => {
  const calls = [];
  const cachedValue = small;
  const store = {
    available: () => true,
    loadDataset: async () => ({ key: 'question-bank', version: '1.0.0', cachedAt: '', items: 0, bytes: 0, value: cachedValue }),
    saveDataset: async () => true,
    stats: async () => ({ available: true, totalBytes: 0, records: [] }),
    clear: async () => {},
  };
  const service = createBankService({ store, fetchImpl: null, storage: null });
  const bank = await service.load();
  assert.ok(bank && bank.questions.length === cachedValue.questions.length, '应命中 IndexedDB 缓存');

  const emptyStore = { ...store, loadDataset: async () => null };
  const offline = createBankService({ store: emptyStore, fetchImpl: null, storage: null });
  assert.equal(await offline.load(), null, '无缓存且无网络时返回 null，由调用方降级');

  const failing = createBankService({
    store: emptyStore,
    fetchImpl: async () => { throw new Error('network down'); },
    storage: null,
  });
  assert.equal(await failing.load(), null, '网络异常应被吞掉');

  const networkOnly = createBankService({
    store: { ...emptyStore, saveDataset: async (...args) => { calls.push(args); return true; } },
    fetchImpl: async () => ({ ok: true, json: async () => small }),
    storage: null,
  });
  const loaded = await networkOnly.load();
  assert.ok(loaded, '网络可用时应成功载入');
  assert.equal(calls.length, 1, '载入成功应回写缓存');
});

test('service：防重复窗口记录近期题目并在组卷时排除', async () => {
  const memory = new Map();
  const storage = {
    getItem: (k) => (memory.has(k) ? memory.get(k) : null),
    setItem: (k, v) => { memory.set(k, v); },
  };
  const store = {
    available: () => true,
    loadDataset: async () => ({ key: 'question-bank', version: '1.0.0', cachedAt: '', items: 0, bytes: 0, value: small }),
    saveDataset: async () => true,
    stats: async () => ({ available: true, totalBytes: 0, records: [] }),
    clear: async () => {},
  };
  const service = createBankService({ store, fetchImpl: null, storage });
  await service.load();
  assert.deepEqual(service.recentIds(), []);

  const first = service.buildPracticeSet({ count: 10, seed: 100 });
  assert.equal(first.questions.length, 10);
  const recent = service.recentIds();
  assert.equal(recent.length, 10);
  assert.ok(memory.get(RECENT_IDS_KEY), '应写入存储');

  const second = service.buildPracticeSet({ count: 10, seed: 100 });
  for (const q of second.questions) {
    assert.ok(!recent.includes(q.id), '第二轮不应重复第一轮的题');
  }

  // 超长使用后窗口被裁剪
  service.rememberUsage(Array.from({ length: RECENT_WINDOW + 50 }, (_, i) => `x_${i}`));
  assert.equal(service.recentIds().length, RECENT_WINDOW);
});

test('service：题库题目适配为应用题目结构', async () => {
  const store = {
    available: () => true,
    loadDataset: async () => ({ key: 'question-bank', version: '1.0.0', cachedAt: '', items: 0, bytes: 0, value: small }),
    saveDataset: async () => true,
    stats: async () => ({ available: true, totalBytes: 0, records: [] }),
    clear: async () => {},
  };
  const service = createBankService({ store, fetchImpl: null, storage: null });
  await service.load();

  const byKind = (kind) => small.questions.find((q) => q.kind === kind);
  const en2zh = service.toAppQuestion(byKind('en2zh'));
  assert.equal(en2zh.kind, 'words');
  assert.equal(en2zh.memKind, 'en2zh');
  assert.ok(en2zh.choices.length >= 2 && en2zh.answer);
  assert.ok(en2zh.questionId.startsWith('q_vocab_'));

  const spell = service.toAppQuestion(byKind('spell'));
  assert.equal(spell.kind, 'spell');
  assert.ok(spell.tpl && spell.hint > 0);

  const write = service.toAppQuestion(byKind('write'));
  assert.equal(write.kind, 'write');
  assert.equal(write.write, true);
  assert.ok(write.min > 0 && write.max >= write.min);

  const trans = service.toAppQuestion(byKind('trans'));
  assert.equal(trans.write, true);
  assert.ok(trans.sample, '翻译题应带参考句');

  const passage = service.toAppQuestion(byKind('passage'));
  assert.equal(passage.kind, 'passage');
  assert.ok(passage.passage && passage.speak, '听力题应带原文与朗读文本');
  assert.ok(passage.questionId.startsWith('q_paper_'));
});
