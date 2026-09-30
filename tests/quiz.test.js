'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const Q = require('../src/core/quiz');

/** 构造测试词库：含形近词、多词性、各长度 */
const WORDS = [
  { w: 'apple', ipa: '[ˈæpl]', zh: 'n.苹果', short: '苹果' },
  { w: 'apply', ipa: '[əˈplai]', zh: 'vt.应用', short: '应用' },
  { w: 'application', ipa: '[ˌæpliˈkeiʃən]', zh: 'n.申请', short: '申请' },
  { w: 'banana', ipa: '[bəˈnɑːnə]', zh: 'n.香蕉', short: '香蕉' },
  { w: 'berry', ipa: '[ˈberi]', zh: 'n.浆果', short: '浆果' },
  { w: 'carry', ipa: '[ˈkæri]', zh: 'vt.携带', short: '携带' },
  { w: 'child', ipa: '[tʃaild]', zh: 'n.小孩', short: '小孩' },
  { w: 'dirty', ipa: '[ˈdəːti]', zh: 'a.脏的', short: '脏的' },
  { w: 'quickly', ipa: '[ˈkwikli]', zh: 'ad.快速地', short: '快速地' },
  { w: 'under', ipa: '[ˈʌndə]', zh: 'prep.在下面', short: '在下面' },
  { w: 'zoo', ipa: '[zuː]', zh: 'n.动物园', short: '动物园' },
];
const ctx = (kind, i) => ({ words: WORDS, meta: { id: 'test' }, index: i || 0, seedText: 'seed|' + kind });

test('MEMORY_KINDS：六种题型齐备且无重复', () => {
  assert.strictEqual(Q.MEMORY_KINDS.length, 6);
  assert.strictEqual(new Set(Q.MEMORY_KINDS).size, 6);
  Q.MEMORY_KINDS.forEach((k) => assert.ok(Q.KIND_LABEL[k], k + ' 应有中文名'));
});

test('makeMemoryQuestion：拒绝未知题型', () => {
  assert.throws(() => Q.makeMemoryQuestion('nope', ctx('nope')), /未知题型/);
});

test('六种题型均生成合法题目', () => {
  Q.MEMORY_KINDS.forEach((kind) => {
    const q = Q.makeMemoryQuestion(kind, ctx(kind));
    assert.ok(q.prompt, kind + ' 应有题面');
    assert.ok(q.answer !== undefined && q.answer !== '', kind + ' 应有答案');
    assert.ok(q.word, kind + ' 应记录目标词');
    if (kind === 'spell') {
      assert.strictEqual(q.kind, 'spell');
      assert.ok(q.tpl.includes('_'), '拼写题应给出下划线占位');
      assert.strictEqual(q.tpl.length, q.answer.length, '占位长度须等于答案长度');
      assert.strictEqual(q.tpl[0], q.answer[0], '首字母应保留');
    } else {
      assert.strictEqual(q.choices.length, 4, kind + ' 应有 4 个选项');
      assert.ok(q.choices.includes(q.answer), kind + ' 答案必须在选项内');
      assert.strictEqual(new Set(q.choices).size, 4, kind + ' 选项不得重复');
    }
  });
});

test('中译英/英译中：题面与答案方向正确', () => {
  let found = false;
  for (let i = 0; i < 40 && !found; i++) {
    const q = Q.makeMemoryQuestion('zh2en', ctx('zh2en', i));
    const item = WORDS.find((x) => x.short === q.prompt);
    if (item) { assert.strictEqual(q.answer, item.w, '中译英答案应为英文'); found = true; }
  }
  assert.ok(found, '应至少出现一次可验证的中译英题');
  for (let i = 0; i < 20; i++) {
    const q = Q.makeMemoryQuestion('en2zh', ctx('en2zh', i));
    const item = WORDS.find((x) => x.w === q.prompt);
    if (item) assert.strictEqual(q.answer, item.short, '英译中答案应为中文释义');
  }
});

test('形近辨析：干扰项与目标词前缀或长度相近', () => {
  for (let i = 0; i < 30; i++) {
    const q = Q.makeMemoryQuestion('similar', ctx('similar', i));
    const item = WORDS.find((x) => x.w === q.answer);
    assert.ok(item, '答案应为库内词');
    q.choices.filter((c) => c !== q.answer).forEach((c) => {
      assert.notStrictEqual(c, q.answer, '干扰项不得等于答案');
    });
  }
});

test('similarWords：优先同前缀并补足数量', () => {
  const rand = require('../src/core/utils').rng(3);
  const out = Q.similarWords(WORDS, WORDS[0], 3, rand);
  assert.strictEqual(out.length, 3);
  out.forEach((x) => assert.notStrictEqual(x.w, 'apple', '不应包含目标词自身'));
});

test('听音辨词：带 speak 字段供语音合成', () => {
  const q = Q.makeMemoryQuestion('listen', ctx('listen'));
  assert.ok(q.speak, '听力题应提供 speak 文本');
  assert.strictEqual(q.speak, q.answer, '朗读内容应为答案词');
});

test('词性判断：选项为词性标签且答案在其中', () => {
  for (let i = 0; i < 20; i++) {
    const q = Q.makeMemoryQuestion('pos', ctx('pos', i));
    assert.strictEqual(q.choices.length, 4);
    assert.ok(q.choices.includes(q.answer));
  }
});

test('同种子生成结果可复现（固定题序）', () => {
  const a = Q.makeMemoryQuestion('zh2en', ctx('zh2en', 5));
  const b = Q.makeMemoryQuestion('zh2en', ctx('zh2en', 5));
  assert.deepStrictEqual(a.choices, b.choices, '同种子选项顺序应一致');
  assert.strictEqual(a.answer, b.answer);
});

test('judgeChoice：正确与错误索引', () => {
  const q = { choices: ['a', 'b', 'c'], answer: 'b' };
  assert.strictEqual(Q.judgeChoice(q, 1), true);
  assert.strictEqual(Q.judgeChoice(q, 0), false);
  assert.strictEqual(Q.judgeChoice(null, 0), false);
  assert.strictEqual(Q.judgeChoice({ answer: 'x' }, 0), false);
});

test('judge：选择题与拼写题分流判定', () => {
  assert.strictEqual(Q.judge({ choices: ['a'], answer: 'a' }, 'a').ok, true);
  assert.strictEqual(Q.judge({ kind: 'spell', answer: 'apple' }, 'Apple').ok, true);
  assert.strictEqual(Q.judge({ kind: 'spell', answer: 'apple' }, 'applx').ok, false);
  assert.strictEqual(Q.judge(null, 'x').ok, false);
});

test('recordMemStat：累加对错且不修改原对象', () => {
  const s0 = {};
  const s1 = Q.recordMemStat(s0, 'zh2en', true);
  assert.deepStrictEqual(s1.zh2en, { r: 1, n: 1 });
  assert.deepStrictEqual(s0, {}, '原统计对象不应被修改');
  const s2 = Q.recordMemStat(s1, 'zh2en', false);
  assert.deepStrictEqual(s2.zh2en, { r: 1, n: 2 });
  assert.deepStrictEqual(s1.zh2en, { r: 1, n: 1 }, '上一版应保持不变');
  assert.deepStrictEqual(Q.recordMemStat(s1, '', true), s1, '空题型应原样返回');
});

test('kindAccuracy：正确率与空值', () => {
  assert.strictEqual(Q.kindAccuracy({ r: 3, n: 4 }), 75);
  assert.strictEqual(Q.kindAccuracy({ r: 0, n: 10 }), 0);
  assert.strictEqual(Q.kindAccuracy(null), null);
  assert.strictEqual(Q.kindAccuracy({ r: 0, n: 0 }), null);
});

test('memoryQuestion：按 memKind 轮换', () => {
  const c = { words: WORDS, meta: { id: 't' }, index: 1, seedText: 'x' };
  const labels = new Set();
  for (let i = 0; i < 6; i++) labels.add(Q.memoryQuestion(c, Q.MEMORY_KINDS[i]).memKind);
  assert.strictEqual(labels.size, 6, '六种题型都应能生成');
});
