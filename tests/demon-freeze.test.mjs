/**
 * 阶段 A · 「挑战心魔」卡死防回归（v1.9.1）
 *
 * 根因（见 docs/diag-demon-freeze.md）：`makeQuestion` 内的 `unique()`
 * 用 `while(out.length<n)` + `continue` 且**无退出条件**，候选池被缩到
 * 小于需求时（心魔词仅 2~3 个、或换词库后 state.wrong 与 byWord 失配）
 * 永久自旋 → 主线程 100% 占用 → 页面卡死。
 *
 * 本测试从**生产模板**里抽真实源码执行（不是复制品），断言：
 *   1. 各触发场景全部在时限内返回（不再挂死）；
 *   2. 选项数仍合法（4 项 / bank 10 项）；
 *   3. 1000 心魔的挑战流程 < 2000 ms（A4 要求）；
 *   4. 修复只加逃生阀，不改抽中与去重语义。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const src = readFileSync(join(ROOT, 'src', 'index.template.html'), 'utf8');

const grab = (re, name) => {
  const m = src.match(re);
  assert.ok(m, `模板中应能抽到 ${name}`);
  return m[0];
};

const SRC_BANK_FOR = grab(/function bankFor\(meta\)\{[\s\S]*?return base; \}/, 'bankFor');
const SRC_MAKE_Q = grab(/function makeQuestion\(kind, meta, index\)\{[\s\S]*?\n\}/, 'makeQuestion');
const SRC_NORM = grab(/function normShort\(x\)\{[^}]*\}/, 'normShort');
const SRC_PICK = grab(/function pick\(list,n,rand\)\{[^}]*\}/, 'pick');

/** 修复形态断言：源码里必须带迭代熔断（防回归的第一道锁） */
test('unique() 必须带迭代熔断（防止 while 无退出条件）', () => {
  assert.ok(/if\(\+\+iter>cap\) break;/.test(SRC_MAKE_Q), 'makeQuestion 的 unique 应含迭代熔断');
  assert.ok(/const cap=/.test(SRC_MAKE_Q), '熔断上限应按池规模计算');
  // 熔断不得改动抽中判定与去重口径
  assert.ok(/blocked\.has\(item\.w\)\|\|seenShort\.has\(normShort\(item\.short\)\)/.test(SRC_MAKE_Q),
    '抽中判定语义应保持原样');
});

/** 构造受控环境跑真实源码 */
function makeApi({ wrongCount, pool = 'wrong', wordCount = 60, wrongPrefix = 'word' }) {
  const WORDS = Array.from({ length: wordCount }, (_, i) => ({
    w: 'word' + i, short: '释义' + i, ipa: '/w/', zh: '词义' + i,
  }));
  const byWord = new Map(WORDS.map((w) => [w.w, w]));
  const state = { wrong: {}, pool, known: {}, recent: [], schedule: {} };
  for (let i = 0; i < wrongCount; i++) state.wrong[wrongPrefix + i] = 1 + (i % 3);
  const hash = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };
  const rng = (seed) => {
    let a = seed >>> 0;
    return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  };
  const body = [SRC_NORM, SRC_PICK, SRC_BANK_FOR, SRC_MAKE_Q, 'return { makeQuestion, bankFor };'].join('\n');
  // eslint-disable-next-line no-new-func
  const api = new Function('state', 'WORDS', 'byWord', 'hash', 'rng', body)(state, WORDS, byWord, hash, rng);
  const meta = { id: 'loose', seeds: [], scene: 'campus', focus: 'x', name: '单题' };
  return { api, meta, state };
}

/** 带时限的执行：超时即判为「卡死」（node:test 的 timeout 兜底为第二道） */
function timedCall(fn, limitMs) {
  const t0 = process.hrtime.bigint();
  const out = fn();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < limitMs, `耗时 ${ms.toFixed(1)} ms 超过 ${limitMs} ms（疑似卡死）`);
  return { out, ms };
}

/* ── A5-1/2/3：心魔 10 / 100 / 1000 挑战流畅 ── */
for (const count of [10, 100, 1000]) {
  test(`A5-${count}: 心魔 ${count} 只 · words 题型挑战流畅`, () => {
    const { api, meta } = makeApi({ wrongCount: count });
    const { out } = timedCall(() => api.makeQuestion('words', meta, 1), 1000);
    assert.equal(out.choices.length, 4, '应有 4 个选项');
    assert.ok(out.choices.includes(out.answer), '答案须在选项内');
    assert.equal(new Set(out.choices).size, 4, '选项不得重复');
  });
}

/* ── 根因场景：小池子（修复前必然挂死） ── */
test('根因场景：心魔池仅 1~3 个词也不再卡死', () => {
  for (const count of [1, 2, 3]) {
    const { api, meta } = makeApi({ wrongCount: count });
    const { out } = timedCall(() => api.makeQuestion('words', meta, 1), 500);
    assert.equal(out.choices.length, 4, `${count} 个心魔词也应凑出 4 选项（干扰项回落全词池）`);
    assert.ok(out.choices.includes(out.answer));
  }
});

/* ── 根因场景：bank/write 需求更大（10 / 8 个不重复词） ── */
test('根因场景：bank 题型需要 10 个不重复词，小池子不卡死', () => {
  const { api, meta } = makeApi({ wrongCount: 6 });
  const { out } = timedCall(() => api.makeQuestion('bank', meta, 1), 500);
  assert.equal(out.choices.length, 10, 'bank 题型应有 10 个选项');
  assert.equal(new Set(out.choices).size, 10, '选项不得重复');
  assert.ok(out.choices.includes(out.answer));
});

test('根因场景：write 题型需要 8 个种子词，小池子不卡死', () => {
  const { api, meta } = makeApi({ wrongCount: 3 });
  const { out } = timedCall(() => api.makeQuestion('write', meta, 1), 500);
  assert.equal(out.write, true, 'write 题型应为写作题');
  assert.equal((out.seeds || []).length, 8, '应给出 8 个种子词');
  assert.equal(new Set((out.seeds || []).map((s) => s.w)).size, 8, '种子词不得重复');
});

/* ── 路径 2：换词库后 state.wrong（全局）与 byWord（按词库）失配 ── */
test('根因场景：换词库后错词失配（全局错词多、交集仅 3 条）不卡死', () => {
  // wrongPrefix 与词库词名（word0..）不同 → 50 条全局错词全部失配，
  // 只有构造里另加的 3 条能命中，精确复刻「CET-4 攒错词后切小词库」的口径差。
  const WORDS = Array.from({ length: 60 }, (_, i) => ({ w: 'word' + i, short: '释义' + i, ipa: '/w/', zh: '词义' + i }));
  const byWord = new Map(WORDS.map((w) => [w.w, w]));
  const state = { wrong: {}, pool: 'wrong', known: {}, recent: [], schedule: {} };
  for (let i = 0; i < 50; i++) state.wrong['cet4word' + i] = 1;   // 全局错词（切库后失配）
  for (let i = 0; i < 3; i++) state.wrong['word' + i] = 2;        // 交集仅 3 条
  const hash = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };
  const rng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const body = [SRC_NORM, SRC_PICK, SRC_BANK_FOR, SRC_MAKE_Q, 'return { makeQuestion, bankFor };'].join('\n');
  // eslint-disable-next-line no-new-func
  const api = new Function('state', 'WORDS', 'byWord', 'hash', 'rng', body)(state, WORDS, byWord, hash, rng);
  const meta = { id: 'loose', seeds: [], scene: 'campus', focus: 'x', name: '单题' };
  assert.ok(Object.keys(state.wrong).length === 53, '全局错词 53 条');
  assert.equal(api.bankFor(meta).length, 3, '与当前词库交集仅 3 条（失配已构造）');
  const { out } = timedCall(() => api.makeQuestion('words', meta, 1), 500);
  assert.equal(out.choices.length, 4, '失配场景仍应凑出 4 选项');
  assert.ok(out.choices.includes(out.answer));
});

/* ── A5-4：点击立即响应（<500ms 出现反馈） ── */
test('A5-4: 挑战心魔入口响应 < 500ms（抽题环节）', () => {
  const { api, meta } = makeApi({ wrongCount: 2 });
  const { ms } = timedCall(() => api.makeQuestion('words', meta, 1), 500);
  assert.ok(ms < 500, `抽题 ${ms.toFixed(1)} ms 应 < 500 ms`);
});

/* ── A4：保护性上限提示 + 渲染封顶 ── */
test('A4: 心魔 > 500 时摘要给出清理提示；渲染始终封顶 40 张', () => {
  assert.ok(/list\.length > 500/.test(src) && /心魔过多，建议先到心魔本清理/.test(src),
    '应存在 >500 的保护性提示');
  assert.ok(/slice\(0, 40\)/.test(src), '心魔网格渲染应封顶 40 张');
  assert.ok(/list\.length > shown\.length/.test(src), '超出封顶时应提示只显示最近若干只');
});

/* ── 全题型扫描：所有 makeQuestion 分支都不得卡死 ── */
test('A5-6: 全题型 × 小池子扫描，全部在时限内返回', () => {
  const kinds = ['words', 'news', 'talk', 'passage', 'bank', 'match', 'detail', 'write', 'trans'];
  const started = Date.now();
  for (const kind of kinds) {
    for (const count of [1, 2, 3, 5, 10]) {
      const { api, meta } = makeApi({ wrongCount: count });
      const out = api.makeQuestion(kind, meta, 1);
      assert.ok(out && out.kind, `${kind}/${count} 应产出题目`);
      if (kind !== 'write' && kind !== 'trans' && kind !== 'spell') {
        assert.ok(out.choices.length >= 2, `${kind}/${count} 至少 2 个选项（实 ${out.choices.length}）`);
        assert.ok(out.choices.includes(out.answer), `${kind}/${count} 答案须在选项内`);
      }
    }
  }
  const ms = Date.now() - started;
  assert.ok(ms < 2000, `全扫描 ${ms} ms 应 < 2000 ms（45 次出题）`);
});
