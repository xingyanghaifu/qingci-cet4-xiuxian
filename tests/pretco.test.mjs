/**
 * PRETCO 近似词库 + 特色题库 · 阶段 F 验收（v1.9.1）
 *
 * 背景（docs/probe-pretco.md）：五路径探活，公开领域**没有** PRETCO 词表。
 * 因此本阶段走「近似方案」：
 *   · 词库数据复用 CET-4 分片（不重复生成，省空间、也不冒充官方词表）
 *   · 只新增 PRETCO 真正的差异 —— 特色题型（语法结构 / 听力短对话 / 英译汉 / 应用文）
 *   · `approximation: true` 让 UI 明示近似关系
 *   · 进度按 `pretco` 独立作用域存储，与 CET-4 互不污染
 *
 * 覆盖 F6 的 11 条验收：
 *   F6-1  词库清单含 pretco（enabled + approximation）  F6-2  复用 CET-4 详情分片
 *   F6-3  无 pretco 词库数据文件（省空间）                F6-4  特色题库 3000–5000 题
 *   F6-5  题库校验 0 失败                                F6-6  四种题型齐全
 *   F6-7  词库切换                                        F6-8  进度隔离
 *   F6-9  模考模式（32 题）                               F6-10 现有测试全绿（整套 npm test）
 *   F6-11 单文件不内联题库数据
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadTs } from './helpers/load-ts.mjs';
import { makeFakeIdb } from './helpers/fake-idb.mjs';

const ROOT = join(import.meta.dirname, '..');
const LEX_DIR = join(ROOT, 'src', 'data', 'lexicons');
const PT_DIR = join(LEX_DIR, 'pretco');
const QB_DIR = join(PT_DIR, 'question-bank');

const lexiconMod = await loadTs('src/services/lexicon.ts');
const vocabSrsMod = await loadTs('src/services/vocab-srs.ts');
const idbMod = await loadTs('src/services/idb.ts');
const detailMod = await loadTs('src/services/vocab-detail.ts');
const { currentLexiconId, switchLexicon, FALLBACK_MANIFEST } = lexiconMod;

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const manifest = readJson(join(LEX_DIR, 'manifest.json'));
const bankMf = readJson(join(QB_DIR, 'manifest.json'));

/* ---------------- F6-1 / F6-2 词库清单 ---------------- */

test('F6-1 词库清单含 pretco：启用、近似标记、默认仍是 CET-4', () => {
  assert.equal(manifest.defaultLexiconId, 'cet4', '默认词库必须保持 CET-4（硬约束 8）');
  const p = manifest.lexicons.find((l) => l.id === 'pretco');
  assert.ok(p, 'manifest 应含 pretco 条目');
  assert.equal(p.enabled, true, 'pretco 已上线，允许用户主动切换');
  assert.equal(p.shortName, 'PRETCO');
  assert.equal(p.approximation, true, '必须明示近似方案，不冒充官方词表');
  assert.equal(p.sourceLicense, 'MIT', '词库数据本身仍来自 CET-4（MIT）');
  // 离线首屏兜底清单同样含 enabled 的 pretco
  const fb = FALLBACK_MANIFEST.lexicons.find((l) => l.id === 'pretco');
  assert.ok(fb, 'FALLBACK_MANIFEST 应含 pretco 条目');
  assert.equal(fb.enabled, true);
  assert.equal(fb.approximation, true);
  // 探活结论的占位卡已撤（否则用户会同时看到三张 PRETCO 卡）
  for (const gone of ['pretco-a', 'pretco-b']) {
    assert.equal(manifest.lexicons.some((l) => l.id === gone), false, `${gone} 占位卡应已撤`);
  }
});

test('F6-2 pretco 复用 CET-4 详情分片（不另建词库数据）', () => {
  const p = manifest.lexicons.find((l) => l.id === 'pretco');
  assert.equal(p.dataPath, 'vocab-detail/', 'pretco 的详情分片直接指向 CET-4 目录');
  assert.equal(p.wordListPath, '', '词源同 CET-4，不产出独立 wordlist.json');
  assert.equal(detailMod.baseOf('pretco'), detailMod.VOCAB_DETAIL_BASE,
    '运行时按词库选分片目录，pretco 应回落到 CET-4 目录（故详情可用）');
  // 目录下不应存在 pretco 的 vocab-detail（否则是重复数据）
  assert.equal(existsSync(join(PT_DIR, 'vocab-detail')), false,
    'pretco 不应有独立 vocab-detail 目录（重复数据，白占体积）');
  assert.equal(existsSync(join(PT_DIR, 'wordlist.json')), false,
    'pretco 不应有独立 wordlist.json');
});

/* ---------------- F6-4 / F6-5 / F6-6 题库 ---------------- */

test('F6-4 题库 3000–5000 题，四个分片齐全', () => {
  const total = Object.values(bankMf.kinds).reduce((a, k) => a + k.count, 0);
  assert.equal(total, bankMf.counts.total, 'manifest 总数应等于各分片之和');
  assert.ok(total >= 3000 && total <= 5000, `PRETCO 题量 ${total} 应在 3000–5000`);
  assert.deepEqual(Object.keys(bankMf.kinds).sort(), ['grammar', 'talk', 'trans', 'writing'],
    '应恰好四种 PRETCO 特色题型');
  // 各题型下限：语法 ≥1300（框架×词槽在 CET-4 上的天然饱和点是 1376，初中同为
  // 1376，故 1500 不可达）/ 英译汉 ≥1000 / 短对话 ≥800 / 应用文 ≥200
  assert.ok(bankMf.counts.byKind.grammar >= 1300, `语法 ${bankMf.counts.byKind.grammar} 应 ≥1300`);
  assert.ok(bankMf.counts.byKind.trans >= 1000, `英译汉 ${bankMf.counts.byKind.trans} 应 ≥1000`);
  assert.ok(bankMf.counts.byKind.talk >= 800, `短对话 ${bankMf.counts.byKind.talk} 应 ≥800`);
  assert.ok(bankMf.counts.byKind.writing >= 200, `应用文 ${bankMf.counts.byKind.writing} 应 ≥200`);
});

test('F6-5 题库校验脚本 0 失败', () => {
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'verify-exam-bank.mjs'), 'pretco'],
    { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, `verify-exam-bank pretco 应通过：\n${r.stdout}\n${r.stderr}`);
  assert.ok(/失败 0 项/.test(r.stdout), `校验应 0 失败：\n${r.stdout}`);
});

test('F6-6 题型语义正确：短对话带篇章、英译汉带中文参考译文', () => {
  const talk = readJson(join(QB_DIR, 'talk.json'));
  for (const q of talk.questions.slice(0, 50)) {
    assert.equal(q.kind, 'talk');
    assert.equal(q.part, '听');
    assert.ok(typeof q.content.passage === 'string' && q.content.passage.length > 30,
      `${q.id}: 短对话必须带对话文本（供 TTS 朗读）`);
    assert.equal(q.content.choices.length, 4, `${q.id}: 4 个选项`);
    assert.ok(q.content.choices.includes(q.content.answer), `${q.id}: 正解在选项中`);
  }
  const trans = readJson(join(QB_DIR, 'trans.json'));
  for (const q of trans.questions.slice(0, 50)) {
    assert.equal(q.kind, 'trans');
    assert.equal(q.part, '译');
    assert.equal(q.content.write, true, `${q.id}: 英译汉是主观题`);
    assert.equal(typeof q.content.min, 'number', `${q.id}: 有字数区间`);
    // 参考译文是中文：应含 CJK 字符
    assert.ok(/[\u4e00-\u9fa5]/.test(q.content.sample || ''), `${q.id}: sample 应为中文参考译文`);
    assert.ok(!/[<>]/.test(q.content.prompt || ''), `${q.id}: 题面不应含未转义的尖括号`);
  }
  const grammar = readJson(join(QB_DIR, 'grammar.json'));
  for (const q of grammar.questions.slice(0, 50)) {
    assert.ok(q.content.prompt.includes('___'), `${q.id}: 语法题题干应有空格标记`);
    assert.equal(q.content.choices.length, 4, `${q.id}: 4 个选项`);
  }
});

/* ---------------- F6-9 模考模式 ---------------- */

test('F6-9 模考模式：PRETCO 题型（语法15 + 短对话10 + 英译汉5 + 应用文2 = 32 题）', () => {
  const want = { grammar: 15, talk: 10, trans: 5, writing: 2 };
  assert.deepEqual(Object.keys(bankMf.papers).sort(), ['pt-01', 'pt-02', 'pt-03']);
  const all = new Set();
  for (const [k, p] of Object.entries(bankMf.papers)) {
    assert.equal(p.ids.length, 32, `${k} 应为 32 题`);
    assert.deepEqual(p.structure, want, `${k} 结构为 PRETCO 题型配比`);
    const kinds = new Set();
    for (const id of p.ids) {
      assert.ok(!all.has(id), `${k} 与前一套卷子重题：${id}`);
      all.add(id);
      kinds.add(id.split('_')[2]);
    }
    assert.equal(kinds.size, 4, `${k} 四种题型齐全`);
  }
  // 题号可解析
  const g = readJson(join(QB_DIR, 'grammar.json'));
  const sampleId = bankMf.papers['pt-01'].ids[0];
  assert.ok(g.questions.some((q) => q.id === sampleId), '模拟卷首题应能在语法分片里找到');
  // 运行时接线：EXAM_CONFIGS + examSelect + 题型标题 + 近似徽记
  const html = readFileSync(join(ROOT, 'dist', 'index.html'), 'utf8');
  assert.ok(/pretco:\{id:'pretco',name:'PRETCO'/.test(html), 'EXAM_CONFIGS 应含 pretco');
  assert.ok(html.includes('<option value="pretco">'), 'examSelect 应含 PRETCO 选项');
  assert.ok(html.includes("talk: '听力短对话'"), 'EXAM_KIND_TITLE 应含听力短对话');
  assert.ok(html.includes('lx-approx'), '词库卡应有「近似」徽记');
});

/* ---------------- F6-7 / F6-8 切换与隔离 ---------------- */

test('F6-7 词库切换：pretco 可切换、默认仍 CET-4、未上线仍拒绝', () => {
  const storage = (() => {
    const map = new Map();
    return {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => { map.set(k, String(v)); },
      removeItem: (k) => { map.delete(k); },
    };
  })();
  const prev = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
  try {
    assert.equal(currentLexiconId(FALLBACK_MANIFEST.lexicons.filter((l) => l.enabled)), 'cet4',
      '未切换时默认 CET-4');
    assert.equal(switchLexicon('pretco', FALLBACK_MANIFEST.lexicons), true, 'pretco 应可切换');
    assert.equal(currentLexiconId(FALLBACK_MANIFEST.lexicons.filter((l) => l.enabled)), 'pretco');
    for (const id of ['ielts', 'toefl']) {
      assert.equal(switchLexicon(id, FALLBACK_MANIFEST.lexicons), false, `${id} 未上线应拒绝`);
    }
    assert.equal(currentLexiconId(FALLBACK_MANIFEST.lexicons.filter((l) => l.enabled)), 'pretco',
      '失败的切换不应改写当前词库');
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { value: prev, configurable: true, writable: true });
  }
});

test('F6-8 进度隔离：pretco 进度进复合键仓，不污染 CET-4（尽管词表复用）', async () => {
  idbMod.__resetIdbCache();
  const factory = makeFakeIdb();
  const store = vocabSrsMod.createVocabSrsStore(factory);
  const now = new Date('2026-10-06T00:00:00Z');

  await store.rate('abandon', 'good', now, 'pretco');
  await store.rate('ability', 'good', now, 'cet4');

  const pt = await store.all('pretco');
  const cet4 = await store.all('cet4');
  assert.equal(pt.length, 1, 'pretco 只应看到自己的进度');
  assert.equal(cet4.length, 1, 'CET-4 不应看到 pretco 的词');
  assert.equal(pt[0].w, 'abandon');
  assert.equal(cet4[0].w, 'ability');
  assert.equal(pt[0].lx, 'pretco');
  assert.equal(pt[0].k, 'pretco abandon', 'vocabLex 复合键应为 "<词库> <词>"');
  const legacy = await store.all();
  assert.equal(legacy.length, 0, 'pretco 进度不应写进 legacy 单键仓');
  idbMod.__resetIdbCache();
});

/* ---------------- F6-11 单文件不内联题库数据 ---------------- */

test('F6-11 题库数据不内联主文件（硬约束 8/9）', () => {
  const html = readFileSync(join(ROOT, 'dist', 'index.html'), 'utf8');
  assert.ok(!html.includes('q_pt_grammar_'), 'PRETCO 题库题目不得内联进单文件');
  assert.ok(!html.includes('q_pt_talk_'), 'PRETCO 短对话不得内联进单文件');
  // 题库清单 URL 是按词库 id **动态拼接**的（examBankUrlFor），且产物经过压缩，
  // 所以断言「拼接逻辑与词库 id 都在产物里」，而不是断言一条展开后的字面量 URL。
  assert.ok(html.includes('question-bank/manifest.json'),
    '产物应含按词库拼装题库清单 URL 的逻辑');
  assert.ok(/pretco:\{id:'pretco'/.test(html), 'EXAM_CONFIGS 应含 pretco，运行时才会去取它的题库');
});

/* ---------------- F6-3 目录卫生 ---------------- */

test('F6-3 pretco 目录只含题库（无重复词库数据）', () => {
  const files = readdirSync(PT_DIR);
  assert.ok(files.includes('question-bank'), '应有 question-bank 目录');
  const stray = files.filter((f) => f !== 'question-bank');
  assert.deepEqual(stray, [], `pretco 目录不应有其他文件（省体积）：${stray.join(', ')}`);
});
