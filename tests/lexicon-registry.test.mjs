/**
 * 词库登记一致性（守卫测试）
 *
 * 背景：新增一个词库要在**五处**分别登记，漏一处就静默失效。
 * GRE 那一批四处全踩过（分片建好、清单里没有、助记没生成、校验报未知词库）。
 * 这里把 `scripts/check-lexicon-registry.mjs` 的逻辑接进测试套件，
 * 让「漏登记」在 `npm test` 就暴露，而不是等上线后发现 UI 看不到词库。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const readJson = (p) => JSON.parse(read(p));

const manifest = readJson('src/data/lexicons/manifest.json');
const manifestIds = new Set(manifest.lexicons.map((l) => l.id));

/** 从 `xxx: {` 对象字面量里抽二级 key */
function objectKeys(src, startRe) {
  const m = src.match(startRe);
  if (!m) return null;
  const start = src.indexOf('{', m.index);
  if (start < 0) return null;
  let depth = 0, end = -1;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return null;
  return new Set([...src.slice(start, end).matchAll(/^\s{2}([a-z]{3,10}):\s*\{/gm)].map((x) => x[1]));
}

const blLex = objectKeys(read('scripts/build-lexicon.mjs'), /const LEXICONS\s*=\s*\{/);
const blOrder = (() => {
  const m = read('scripts/build-lexicon.mjs').match(/const order = \[([^\]]+)\]/);
  return m ? new Set([...m[1].matchAll(/'([a-z]{3,10})'/g)].map((x) => x[1])) : null;
})();
const bmLex = (() => {
  const m = read('scripts/build-mnemonics.mjs').match(/const LEXICONS = \[([\s\S]*?)\n\];/);
  return m ? new Set([...m[1].matchAll(/id:\s*'([a-z]{3,10})'/g)].map((x) => x[1])) : null;
})();
const beLex = objectKeys(read('scripts/build-exam-bank.mjs'), /const LEXICONS\s*=\s*\{/);
const vfLex = objectKeys(read('scripts/verify-exam-bank.mjs'), /const LEX\s*=\s*\{/);
const svcIds = new Set([...read('src/services/lexicon.ts').matchAll(/\bid:\s*'([a-z][a-z0-9]{2,10})'/g)].map((x) => x[1]));

/** 已知例外（不是遗漏，是设计如此 —— 见 check-lexicon-registry.mjs 的注释） */
const EXCEPTIONS = {
  cet4: ['build-lexicon.LEXICONS', 'build-lexicon.order', 'build-mnemonics.LEXICONS',
    'build-exam-bank.LEXICONS', 'verify-exam-bank.LEX', 'services/lexicon.ts'],
  cet6: ['build-lexicon.LEXICONS', 'build-lexicon.order', 'build-mnemonics.LEXICONS',
    'build-exam-bank.LEXICONS', 'verify-exam-bank.LEX', 'services/lexicon.ts'],
  junior: ['build-mnemonics.LEXICONS'],
  senior: ['build-mnemonics.LEXICONS'],
  pretco: ['build-mnemonics.LEXICONS'],
};

test('登记一致性：所有已上线词库在五处登记表里都齐全', () => {
  const live = manifest.lexicons.filter((l) => l.enabled && l.wordCount > 0).map((l) => l.id);
  assert.ok(live.length >= 8, `已上线词库应 ≥8，实际 ${live.length}：${live.join(',')}`);
  const problems = [];
  for (const id of live) {
    const skip = new Set(EXCEPTIONS[id] || []);
    if (!manifestIds.has(id)) problems.push(`${id}: manifest`);
    if (blLex && !blLex.has(id) && !skip.has('build-lexicon.LEXICONS')) problems.push(`${id}: build-lexicon.LEXICONS`);
    if (blOrder && !blOrder.has(id) && !skip.has('build-lexicon.order')) problems.push(`${id}: build-lexicon.order（会静默不出现在清单）`);
    if (bmLex && !bmLex.has(id) && !skip.has('build-mnemonics.LEXICONS')) problems.push(`${id}: build-mnemonics.LEXICONS（不生成助记）`);
    if (beLex && !beLex.has(id) && !skip.has('build-exam-bank.LEXICONS')) problems.push(`${id}: build-exam-bank.LEXICONS（不生成题库）`);
    if (vfLex && !vfLex.has(id) && !skip.has('verify-exam-bank.LEX')) problems.push(`${id}: verify-exam-bank.LEX（报未知词库）`);
    if (!svcIds.has(id) && !skip.has('services/lexicon.ts')) problems.push(`${id}: services/lexicon.ts（离线兜底缺）`);
  }
  assert.deepEqual(problems, [], '词库登记不全（会静默失效）：\n  ' + problems.join('\n  '));
});

test('登记一致性：manifest 与 services 兜底清单的词库集合一致', () => {
  // 两处都描述「有哪些词库」，不一致会导致「线上有、离线没有」这类诡异差异
  const manifestLive = manifest.lexicons.map((l) => l.id).sort();
  const svcAll = [...svcIds].sort();
  const onlyInSvc = svcAll.filter((x) => !manifestLive.includes(x));
  const onlyInManifest = manifestLive.filter((x) => !svcAll.includes(x));
  assert.deepEqual(onlyInSvc, [], `services 里有但 manifest 没有：${onlyInSvc.join(',')}`);
  assert.deepEqual(onlyInManifest, [], `manifest 里有但 services 没有：${onlyInManifest.join(',')}`);
});

test('登记一致性：build-lexicon 有「LEXICONS vs order」一致性断言（防下次再漏）', () => {
  const src = read('scripts/build-lexicon.mjs');
  assert.ok(/missingFromOrder/.test(src),
    'build-lexicon 缺少「LEXICONS 里的词库必须都在 order 里」的断言 —— 下次新增词库还会静默丢失');
});

test('登记一致性：build-mnemonics 有「--lexicon 未登记即失败」护栏', () => {
  const src = read('scripts/build-mnemonics.mjs');
  assert.ok(/未登记在本脚本的 LEXICONS 清单里/.test(src),
    'build-mnemonics 缺少未登记护栏 —— 会默默不生成助记');
});

test('登记一致性：manifest 里不得有重复 id（占位词库上线后忘了从 PLACEHOLDERS 移除）', () => {
  // 实测踩过：ielts / toefl 上线后，writeManifest 的 PLACEHOLDERS 里仍留着
  // 同名占位条目 → 清单里出现**两条同 id 记录**，后一条 enabled:false
  // 把前一条盖掉 → 刚上线的词库在选择器里又变灰。
  // 现在 build-lexicon 里加了「order 与 PLACEHOLDERS 不得重叠」的断言，这里从产物侧再验一次。
  const ids = manifest.lexicons.map((l) => l.id);
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  assert.deepEqual(dup, [], `manifest 里有重复词库 id：${[...new Set(dup)].join(', ')}`);

  const src = read('scripts/build-lexicon.mjs');
  assert.ok(/同时出现在 order（已上线）与 PLACEHOLDERS（未上线）里/.test(src),
    'build-lexicon 缺少「order 与 PLACEHOLDERS 不得重叠」的断言');
});

test('登记一致性：v1.10 起所有词库均已上线（无 enabled:false）', () => {
  const disabled = manifest.lexicons.filter((l) => !l.enabled).map((l) => l.id);
  assert.deepEqual(disabled, [],
    `v1.10 三批（gre/ielts/toefl）完成后不应再有未上线词库，实际：${disabled.join(', ')}`);
  const live = manifest.lexicons.filter((l) => l.enabled);
  assert.equal(live.length, 9, `应有 9 个已上线词库，实际 ${live.length}`);
});

test('登记一致性：产物清单也无重复、无未上线', () => {
  const dist = readJson('dist/lexicons/manifest.json');
  const ids = dist.lexicons.map((l) => l.id);
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  assert.deepEqual(dup, [], `产物 manifest 有重复 id：${[...new Set(dup)].join(', ')}`);
  assert.deepEqual(dist.lexicons.filter((l) => !l.enabled).map((l) => l.id), [],
    '产物里仍有未上线词库');
});

/* ---------------- TOEFL ---------------- */

test('TOEFL：词数 6974、分片合规、覆盖率达标', () => {
  const wl = readJson('src/data/lexicons/toefl/wordlist.json');
  assert.equal(wl.length, 6974, `TOEFL 词表应为 6974，实际 ${wl.length}`);
  const mf = readJson('src/data/lexicons/toefl/vocab-detail/manifest.json');
  assert.equal(mf.count, 6974);
});

test('TOEFL：题库 3 套 × 1156 题，含填空/阅读/写作', () => {
  const mf = readJson('src/data/lexicons/toefl/question-bank/manifest.json');
  assert.deepEqual(Object.keys(mf.kinds).sort(), ['bankfill', 'reading', 'writing']);
  assert.deepEqual(Object.keys(mf.papers).sort(), ['tf-01', 'tf-02', 'tf-03']);
  for (const [k, p] of Object.entries(mf.papers)) {
    assert.equal(p.ids.length, 1156, `${k} 应为 1156 题`);
  }
});

test('TOEFL：产物含词库与题库', () => {
  for (const p of ['lexicons/toefl/vocab-detail/manifest.json',
    'lexicons/toefl/question-bank/manifest.json',
    'lexicons/toefl/wordlist.json']) {
    assert.ok(existsSync(join(ROOT, 'dist', p)), `产物缺 ${p}`);
  }
});

/* ---------------- 三个新词库的横向一致性 ---------------- */

test('新词库（gre/ielts/toefl）：三者的题库规模与结构一致', () => {
  // 三个词库用同一套 plan，结构应完全一致 —— 若某个跑偏说明构建参数不同步
  const expected = { bankfill: 620, reading: 525, writing: 11 };
  for (const id of ['gre', 'ielts', 'toefl']) {
    const mf = readJson(`src/data/lexicons/${id}/question-bank/manifest.json`);
    const key = Object.keys(mf.papers)[0];
    assert.deepEqual(mf.papers[key].structure, expected, `${id} 模拟卷结构与预期不符`);
    assert.equal(mf.papers[key].ids.length, 1156, `${id} 模拟卷题量应为 1156`);
  }
});

test('新词库：主文件里三个词库入口都在（选择器 + 备考下拉）', () => {
  const html = read('dist/index.html');
  for (const id of ['gre', 'ielts', 'toefl']) {
    assert.ok(html.includes(`'${id}'`) || html.includes(`"${id}"`), `主文件缺 ${id} 接线`);
  }
  // 三个都要在 examSelect 里
  for (const id of ['gre', 'ielts', 'toefl']) {
    assert.ok(html.includes(`<option value="${id}">`), `备考下拉缺 ${id}`);
  }
});

test('IELTS：词数 5040、分片合规、覆盖率达标', () => {
  const dir = join(ROOT, 'src', 'data', 'lexicons', 'ielts', 'vocab-detail');
  const wl = readJson('src/data/lexicons/ielts/wordlist.json');
  assert.equal(wl.length, 5040, `IELTS 词表应为 5040，实际 ${wl.length}`);
  const mf = readJson('src/data/lexicons/ielts/vocab-detail/manifest.json');
  assert.equal(mf.count, 5040);
  assert.ok(existsSync(dir), '缺 IELTS 分片目录');
});

test('IELTS：题库 3 套 × 1156 题，含填空/阅读/写作', () => {
  const mf = readJson('src/data/lexicons/ielts/question-bank/manifest.json');
  assert.deepEqual(Object.keys(mf.kinds).sort(), ['bankfill', 'reading', 'writing']);
  assert.deepEqual(Object.keys(mf.papers).sort(), ['il-01', 'il-02', 'il-03']);
  for (const [k, p] of Object.entries(mf.papers)) {
    assert.equal(p.ids.length, 1156, `${k} 应为 1156 题`);
  }
});

test('IELTS：产物含词库与题库（线上可按需取）', () => {
  for (const p of ['lexicons/ielts/vocab-detail/manifest.json',
    'lexicons/ielts/question-bank/manifest.json',
    'lexicons/ielts/wordlist.json']) {
    assert.ok(existsSync(join(ROOT, 'dist', p)), `产物缺 ${p}`);
  }
});

test('IELTS：主文件不含词库数据（硬约束 8）', () => {
  const html = read('dist/index.html');
  assert.ok(!/"abseil"\s*:\s*\{/.test(html), '主文件疑似内联 IELTS 词库数据');
  assert.ok(html.includes("'ielts'") || html.includes('"ielts"'), '主文件缺 ielts 接线');
});
