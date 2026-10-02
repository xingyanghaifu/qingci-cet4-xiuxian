'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const U = require('../src/core/utils');

test('hash：同输入稳定、不同输入区分', () => {
  assert.strictEqual(U.hash('cet4'), U.hash('cet4'));
  assert.notStrictEqual(U.hash('cet4'), U.hash('cet6'));
  assert.strictEqual(U.hash(''), 2166136261);
  assert.ok(U.hash('任意中文') >= 0 && U.hash('任意中文') <= 4294967295);
});

test('rng：确定性与范围', () => {
  const a = U.rng(42), b = U.rng(42), c = U.rng(43);
  const seqA = [a(), a(), a()], seqB = [b(), b(), b()], seqC = [c(), c(), c()];
  assert.deepStrictEqual(seqA, seqB, '同种子必须产生同序列');
  assert.notDeepStrictEqual(seqA, seqC, '不同种子应产生不同序列');
  seqA.forEach((v) => assert.ok(v >= 0 && v < 1, '随机值须落在 [0,1)'));
});

test('pick：不重复抽取且不超过源长度', () => {
  const src = [1, 2, 3, 4, 5];
  const out = U.pick(src, 3, U.rng(7));
  assert.strictEqual(out.length, 3);
  assert.strictEqual(new Set(out).size, 3, '不得重复');
  assert.strictEqual(U.pick(src, 99, U.rng(1)).length, 5, '超量抽取应取满源长度');
  assert.strictEqual(src.length, 5, '不得修改原数组');
});

test('wordsOf：英文词数统计', () => {
  assert.strictEqual(U.wordsOf('I love English'), 3);
  assert.strictEqual(U.wordsOf("don't stop"), 2);
  assert.strictEqual(U.wordsOf(''), 0);
  assert.strictEqual(U.wordsOf('中文不算'), 0);
});

test('esc：HTML 转义防注入', () => {
  assert.strictEqual(U.esc('<script>'), '&lt;script&gt;');
  assert.strictEqual(U.esc('a & b'), 'a &amp; b');
  assert.strictEqual(U.esc('"x"'), '&quot;x&quot;');
});

test('dayKey：日期格式固定', () => {
  assert.strictEqual(U.dayKey(new Date(2026, 0, 5)), '2026-01-05');
  assert.strictEqual(U.dayKey(new Date(2026, 11, 31)), '2026-12-31');
});

test('examDays：间隔天数与下限保护', () => {
  const now = new Date('2026-12-01T09:00:00');
  assert.strictEqual(U.examDays('2026-12-12T09:00:00', now), 11);
  assert.strictEqual(U.examDays('2020-01-01T00:00:00', now), 1, '过期也要至少 1 天');
});

test('realmOf：境界推进与封顶', () => {
  const realms = [['炼气', 80], ['筑基', 160], ['金丹', 280]];
  assert.strictEqual(U.realmOf(0, realms).name, '炼气');
  assert.strictEqual(U.realmOf(79, realms).name, '炼气');
  assert.strictEqual(U.realmOf(80, realms).name, '筑基');
  assert.strictEqual(U.realmOf(239, realms).name, '筑基');
  assert.strictEqual(U.realmOf(240, realms).name, '金丹');
  const top = U.realmOf(99999, realms);
  assert.strictEqual(top.name, '词仙');
  assert.ok(U.realmOf(-5, realms).into >= 0, '负数应被归零');
});

test('scheduleWord：间隔重复时间计算', () => {
  const now = 1700000000000;
  const r = U.scheduleWord(null, 'good', now);
  assert.strictEqual(r.level, 'good');
  assert.strictEqual(r.next, now + 3 * 86400000);
  assert.strictEqual(r.tries, 1);
  const r2 = U.scheduleWord(r, 'easy', now);
  assert.strictEqual(r2.tries, 2, '复习次数应累加');
  assert.strictEqual(r2.next, now + 7 * 86400000);
  assert.throws(() => U.scheduleWord(null, 'bogus', now), /未知的复习等级/);
});

test('dueWords：筛选到期词', () => {
  const now = 1000000;
  const sch = { a: { next: now - 1 }, b: { next: now + 1 }, c: { next: now } };
  const due = U.dueWords(sch, now);
  assert.ok(due.includes('a') && due.includes('c'), '已到期应包含');
  assert.ok(!due.includes('b'), '未到期应排除');
  assert.deepStrictEqual(U.dueWords(null, now), []);
});

test('checkSpell：忽略大小写与非字母，识别近似', () => {
  assert.strictEqual(U.checkSpell('Apple', 'apple').ok, true);
  assert.strictEqual(U.checkSpell('  apple  ', 'apple').ok, true);
  assert.strictEqual(U.checkSpell('appl', 'apple').ok, false);
  assert.strictEqual(U.checkSpell('appl', 'apple').near, true, '少一个字母算接近');
  assert.strictEqual(U.checkSpell('banana', 'apple').near, false);
  assert.strictEqual(U.checkSpell('', 'apple').ok, false, '空答案不算对');
});

test('posOf：提取词性前缀', () => {
  assert.strictEqual(U.posOf('n.狐狸'), 'n.');
  assert.strictEqual(U.posOf('vt.放弃'), 'vt.');
  assert.strictEqual(U.posOf('无词性'), '');
});

test('shuffleOptions：保序可复现且元素不丢', () => {
  const src = ['a', 'b', 'c', 'd'];
  const r1 = U.shuffleOptions(src, U.rng(9));
  const r2 = U.shuffleOptions(src, U.rng(9));
  assert.deepStrictEqual(r1, r2);
  assert.deepStrictEqual([...r1].sort(), [...src].sort(), '元素不得丢失');
  assert.strictEqual(src[0], 'a', '不得修改原数组');
});

test('masteryPercent / ringOffset：进度换算', () => {
  assert.strictEqual(U.masteryPercent(454, 4540), 10);
  assert.strictEqual(U.masteryPercent(1, 0), 0);
  assert.strictEqual(U.ringOffset(0, 302), 302);
  assert.strictEqual(U.ringOffset(100, 302), 0);
  assert.strictEqual(U.ringOffset(50, 302), 151);
  assert.strictEqual(U.ringOffset(999, 302), 0, '超范围应钳制');
});

test('recentDays：返回连续 N 天', () => {
  const now = new Date(2026, 5, 10).getTime();
  const days = { '2026-06-10': { right: 5, wrong: 1 } };
  const out = U.recentDays(days, 7, now);
  assert.strictEqual(out.length, 7);
  assert.strictEqual(out[6].key, '2026-06-10');
  assert.strictEqual(out[6].right, 5);
  assert.strictEqual(out[0].right, 0, '无记录应为 0');
});

test('考试配置：五类考试均有题量、时长和及格线', () => {
  for (const id of ['junior','senior','pets3','cet4','cet6']) {
    const e = U.getExamConfig(id);
    assert.strictEqual(e.id, id);
    assert.ok(e.count > 0 && e.minutes > 0 && e.pass > 0 && e.pass <= e.total);
    assert.ok(e.source.includes('原创'));
  }
  assert.strictEqual(U.getExamConfig('missing').id, 'cet4');
});

test('考试难度：随境界上升并封顶', () => {
  assert.strictEqual(U.difficultyForRealm(0, 1), 1);
  assert.strictEqual(U.difficultyForRealm(4, 1), 3);
  assert.strictEqual(U.difficultyForRealm(99, 5), 5);
});

test('整套考试判定：达到及格线才算突破', () => {
  assert.strictEqual(U.canBreakthrough(60, 'junior'), true);
  assert.strictEqual(U.canBreakthrough(59, 'junior'), false);
  assert.deepStrictEqual(U.examPassResult(30, 'junior'), { score: 75, pass: true, passLine: 60, exam: 'junior' });
  assert.strictEqual(U.examPassResult(34, 'cet4').pass, false);
  assert.strictEqual(U.examPassResult(35, 'cet4').pass, true);
});

test('paperScore：按权重折算总分', () => {
  const gates = [
    { id: 'write', weight: 106.5, count: 1 },
    { id: 'news', weight: 49.7, count: 7 },
    { id: 'speak', weight: 0, count: 5 },
  ];
  // 分项先四舍五入再累加：round(106.5) + round(49.7) = 107 + 50 = 157
  assert.strictEqual(U.paperScore(gates, { write: 1, news: 7 }), 157);
  assert.strictEqual(U.paperScore(gates, {}), 0);
  assert.strictEqual(U.paperScore(gates, { write: 99, news: 99 }), 157, '超出题量应被截断');
  assert.strictEqual(U.paperScore(gates, { write: 0, news: 7 }), 50, '只做对听力应只得听力分');
});
