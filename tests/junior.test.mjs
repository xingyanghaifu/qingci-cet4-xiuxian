/**
 * 初中词库 + 中考题型 · 阶段 A 验收（v1.9.0）
 *
 * 覆盖谕令 A3 的 9 条验收：
 *   A-1 词库清单含 junior        A-2 初中词数 1600–2200
 *   A-3 详情分片                 A-4 题库分片
 *   A-5 词库切换                 A-6 进度隔离
 *   A-7 题型覆盖                 A-8 模考模式（中考模拟卷）
 *   A-9 运行时接线（词源/作用域/组卷）
 * 第 9 条「现有 428 测试全绿」由整套 `npm test` 本身保证。
 *
 * 另外守住两条硬约束：CET-4 默认词库行为一字不变；词库数据不分片外不内联主文件。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadTs } from './helpers/load-ts.mjs';
import { makeFakeIdb } from './helpers/fake-idb.mjs';

const ROOT = join(import.meta.dirname, '..');
const LEX_DIR = join(ROOT, 'src', 'data', 'lexicons');
const JUN_DIR = join(LEX_DIR, 'junior');
const QB_DIR = join(JUN_DIR, 'question-bank');

const lexiconMod = await loadTs('src/services/lexicon.ts');
const vocabSrsMod = await loadTs('src/services/vocab-srs.ts');
const idbMod = await loadTs('src/services/idb.ts');
const detailMod = await loadTs('src/services/vocab-detail.ts');
const { currentLexiconId, switchLexicon, FALLBACK_MANIFEST, DEFAULT_LEXICON_ID } = lexiconMod;

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const manifest = readJson(join(LEX_DIR, 'manifest.json'));
const detailMf = readJson(join(JUN_DIR, 'vocab-detail', 'manifest.json'));
const bankMf = readJson(join(QB_DIR, 'manifest.json'));

/* ---------------- A-1 词库清单 ---------------- */

test('A-1 词库清单含 junior：启用、路径正确、默认仍是 CET-4', () => {
  assert.equal(manifest.defaultLexiconId, 'cet4', '默认词库必须保持 CET-4（硬约束 8）');
  const junior = manifest.lexicons.find((l) => l.id === 'junior');
  assert.ok(junior, 'manifest 应含 junior 条目');
  assert.equal(junior.enabled, true, 'junior 已上线，允许用户主动切换');
  assert.equal(junior.shortName, '初中');
  assert.equal(junior.dataPath, 'lexicons/junior/vocab-detail/');
  assert.equal(junior.wordListPath, 'lexicons/junior/', '词源路径供运行时换词表用');
  // 未上线词库仍然禁用（灰显 + aria-disabled，切换被拒）
  // 注：kaoyan（阶段 E）、pretco（阶段 F）、gre / ielts（v1.10）均已上线，
  //     从本列表移出（见 tests/kaoyan.test.mjs、tests/gre-lexicon.test.mjs 等）。
  //     目前仅剩 toefl 未上线。
  for (const id of ['toefl']) {
    const l = manifest.lexicons.find((x) => x.id === id);
    assert.equal(l && l.enabled, false, `${id} 仍应为未上线`);
  }
  // PRETCO 近似卡上线后，两张「数据源不可用」占位卡应已撤（探活结论见 docs/probe-pretco.md）
  for (const gone of ['pretco-a', 'pretco-b']) {
    assert.equal(manifest.lexicons.some((x) => x.id === gone), false,
      `${gone} 占位卡应已撤，改由单张 pretco 近似卡承载`);
  }
});

/* ---------------- A-2 词数与核心标记 ---------------- */

test('A-2 初中词数落在 1600–2200，课标核心词有 core 标记', () => {
  const junior = manifest.lexicons.find((l) => l.id === 'junior');
  assert.ok(junior.wordCount >= 1600 && junior.wordCount <= 2200,
    `初中词数 ${junior.wordCount} 应在 1600–2200（谕令 A3-2）`);
  // 与详情分片逐词核对
  let total = 0, core = 0, withZh = 0;
  for (const f of new Set(Object.values(detailMf.files))) {
    const data = readJson(join(JUN_DIR, 'vocab-detail', f));
    for (const d of Object.values(data)) {
      total++;
      if (d.core === true) core++;
      const zh = (d.meanings || []).map((m) => (m.definitions || []).map((x) => x.chinese).join('')).join('');
      if (zh.trim()) withZh++;
    }
  }
  assert.equal(total, junior.wordCount, '清单词数与分片条目一致');
  assert.equal(total, detailMf.count);
  assert.ok(core >= 1500 && core <= 1700, `课标核心词 ${core} 应在 1603 上下`);
  assert.ok(withZh / total > 0.98, `中文释义覆盖率过低：${withZh}/${total}`);
});

/* ---------------- A-3 详情分片 ---------------- */

test('A-3 详情分片：前缀最长匹配、单片 ≤1.5MB、无重复词', () => {
  const lens = detailMf.prefixes.map((p) => p.length);
  assert.deepEqual(lens, [...lens].sort((a, b) => b - a), 'prefixes 按长度降序（运行时最长匹配）');
  assert.equal(detailMf.prefixes.length, Object.keys(detailMf.files).length);
  const words = new Set();
  let dup = 0;
  for (const f of new Set(Object.values(detailMf.files))) {
    const bytes = statSync(join(JUN_DIR, 'vocab-detail', f)).size;
    assert.ok(bytes <= 1_500_000, `分片 ${f} 为 ${bytes} 字节 > 1.5MB`);
    const data = readJson(join(JUN_DIR, 'vocab-detail', f));
    for (const w of Object.keys(data)) {
      if (words.has(w)) dup++;
      words.add(w);
    }
  }
  assert.equal(dup, 0, '分片之间不应出现重复词');
  // 运行时基准路径已注册（否则详情会错读 CET-4 分片）
  assert.equal(detailMod.VOCAB_DETAIL_BASES.junior, 'lexicons/junior/vocab-detail/');
  assert.equal(detailMod.baseOf('junior'), 'lexicons/junior/vocab-detail/');
});

/* ---------------- A-4 题库分片 ---------------- */

test('A-4 题库分片：五种中考题型齐全、总量 3000–5000、单片 ≤1.5MB', () => {
  assert.equal(bankMf.schema, 'qingci-exam-bank/1');
  assert.equal(bankMf.lexicon, 'junior');
  assert.equal(bankMf.exam, 'zhongkao');
  const kinds = Object.keys(bankMf.kinds).sort();
  assert.deepEqual(kinds, ['bankfill', 'cloze', 'grammar', 'reading', 'writing'],
    '五种题型：语法选择 / 完形填空 / 阅读理解 / 选词填空 / 书面表达');
  const total = bankMf.counts.total;
  assert.ok(total >= 3000 && total <= 5000, `题量 ${total} 应在 3000–5000`);
  let sum = 0;
  for (const [kind, info] of Object.entries(bankMf.kinds)) {
    const f = join(QB_DIR, info.file);
    assert.ok(existsSync(f), `分片 ${info.file} 缺失`);
    const bytes = statSync(f).size;
    assert.ok(bytes <= 1_500_000, `分片 ${info.file} 为 ${bytes} 字节 > 1.5MB`);
    const shard = readJson(f);
    assert.equal(shard.schema, 'qingci-question-bank/1');
    assert.equal(shard.kind, kind);
    assert.equal(shard.questions.length, info.count, `${kind} 声明数与实际一致`);
    sum += shard.questions.length;
  }
  assert.equal(sum, total, '各分片之和 = manifest 总数');
});

/* ---------------- A-7 题型覆盖（内容质量抽查） ---------------- */

test('A-7 题型覆盖：每道选择题 4 选项（选词 10）互异且正解在其中', () => {
  let checked = 0;
  const ids = new Set();
  for (const [kind, info] of Object.entries(bankMf.kinds)) {
    const shard = readJson(join(QB_DIR, info.file));
    for (const q of shard.questions) {
      assert.ok(!ids.has(q.id), `题号重复：${q.id}`);
      ids.add(q.id);
      assert.equal(q.knowledgeTags[0], 'junior', `${q.id} 标签应以 junior 开头`);
      assert.ok(q.difficulty >= 0.2 && q.difficulty <= 0.8, `${q.id} 难度越界`);
      const c = q.content;
      if (kind === 'writing') {
        assert.equal(c.write, true, `${q.id} 写作题应 write=true`);
        assert.equal(c.answer, '', `${q.id} 写作题无标准答案`);
        continue;
      }
      const expect = kind === 'bankfill' ? 10 : 4;
      assert.equal(c.choices.length, expect, `${q.id} 选项数应为 ${expect}`);
      assert.equal(new Set(c.choices).size, expect, `${q.id} 选项必须互异：${JSON.stringify(c.choices)}`);
      assert.ok(c.choices.includes(c.answer), `${q.id} 正解不在选项中：${c.answer}`);
      assert.ok(!/\{[A-Z]/.test(c.prompt + (c.passage || '')), `${q.id} 残留占位符`);
      // 完形/选词的空画在**篇章**里（___1___），题干只提示第几空；
      // 语法题的空才在题干上。
      if (kind === 'grammar') assert.ok(c.prompt.includes('___'), `${q.id} 语法题干应有空`);
      if (kind === 'cloze' || kind === 'bankfill') {
        assert.ok(/___\d+___/.test(c.passage || ''), `${q.id} 篇章应有编号空位`);
        assert.ok(new RegExp(`___${c.prompt.match(/第 (\d+) 空/)[1]}___`).test(c.passage),
          `${q.id} 题干编号与篇章空位应对应`);
      }
      checked++;
    }
  }
  assert.ok(checked > 3000, `客观题抽查 ${checked} 道`);
});

/* ---------------- A-8 模考模式（中考模拟卷） ---------------- */

test('A-8 模考模式：3 套中考模拟卷、各 40 题、题号可解析、两两不重', () => {
  const keys = Object.keys(bankMf.papers);
  assert.deepEqual(keys.sort(), ['zk-01', 'zk-02', 'zk-03']);
  const all = new Set();
  for (const [k, p] of Object.entries(bankMf.papers)) {
    assert.equal(p.ids.length, 40, `${k} 应为 40 题`);
    assert.deepEqual(p.structure,
      { grammar: 14, cloze: 10, reading: 10, bankfill: 5, writing: 1 },
      `${k} 结构为中考题型配比`);
    const kindSet = new Set();
    for (const id of p.ids) {
      assert.ok(!all.has(id), `${k} 与前一套卷子重题：${id}`);
      all.add(id);
      const kind = id.split('_')[2];
      kindSet.add(kind);
      assert.ok(all.size > 0 && ['grammar', 'cloze', 'reading', 'bankfill', 'writing'].includes(kind),
        `${k} 含未知题型 ${id}`);
    }
    assert.equal(kindSet.size, 5, `${k} 五种题型齐全`);
  }
  // 题号确实能解析到题目
  const g = readJson(join(QB_DIR, 'grammar.json'));
  const sampleId = bankMf.papers['zk-01'].ids[0];
  assert.ok(g.questions.some((q) => q.id === sampleId), '模拟卷首题应能在语法分片里找到');
});

/* ---------------- A-5 词库切换 ---------------- */

test('A-5 词库切换：junior 可切换、默认仍 CET-4、未上线仍拒绝', () => {
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
    assert.equal(switchLexicon('junior', FALLBACK_MANIFEST.lexicons), true, 'junior 应可切换');
    assert.equal(currentLexiconId(FALLBACK_MANIFEST.lexicons.filter((l) => l.enabled)), 'junior');
    // 未上线样本：v1.9.1 起 kaoyan 已上线，改用仍灰显的 toefl
    for (const id of ['toefl']) {
      assert.equal(switchLexicon(id, FALLBACK_MANIFEST.lexicons), false, `${id} 未上线应拒绝`);
    }
    assert.equal(currentLexiconId(FALLBACK_MANIFEST.lexicons.filter((l) => l.enabled)), 'junior',
      '失败的切换不应改写当前词库');
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { value: prev, configurable: true, writable: true });
  }
});

/* ---------------- A-6 进度隔离 ---------------- */

test('A-6 进度隔离：初中进度进复合键仓，不污染 CET-4 老仓', async () => {
  idbMod.__resetIdbCache();
  const factory = makeFakeIdb();
  const store = vocabSrsMod.createVocabSrsStore(factory);
  const now = new Date('2026-10-05T00:00:00Z');

  await store.rate('apple', 'good', now, 'junior');
  await store.rate('ability', 'good', now, 'cet4');

  const junior = await store.all('junior');
  const cet4 = await store.all('cet4');
  assert.equal(junior.length, 1, 'junior 只应看到自己的进度');
  assert.equal(cet4.length, 1, 'CET-4 不应看到 junior 的词');
  assert.equal(junior[0].w, 'apple');
  assert.equal(cet4[0].w, 'ability');
  assert.equal(junior[0].lx, 'junior');
  // 老仓（不带词库）只读 v1.8.x 存量：junior 的新词不进老仓
  const legacy = await store.all();
  assert.equal(legacy.length, 0, 'junior 进度不应写进 legacy 单键仓');
  // 复合键形态
  assert.equal(junior[0].k, 'junior apple', 'vocabLex 复合键应为 "<词库> <词>"');
  idbMod.__resetIdbCache();
});

/* ---------------- A-9 运行时接线 ---------------- */

test('A-9 运行时接线：词源切换、作用域、中考组卷都已进产物', () => {
  const html = readFileSync(join(ROOT, 'dist', 'index.html'), 'utf8');
  // 1) 词源切换：切词库后背单词/干扰项/模考的词源跟着换
  assert.ok(html.includes('useLexiconWords'), '缺词源切换函数');
  // 词表 URL 由服务层按清单的 wordListPath 给出，不再由主脚本按 id 硬拼。
  // （2026-10-06：pretco 按设计没有独立词表，硬拼会取到不存在的地址 →
  //   SPA 把 404 回落到 index.html，.json() 抛错 → 切换失败。见 tests/pretco.test.mjs F6-12）
  assert.ok(html.includes('__lexiconWordListUrl'), '缺词表 URL 访问器');
  assert.ok(html.includes('wordlist.json'), '缺词表文件名');
  // 2) 进度作用域：评分与错题本按当前词库隔离
  assert.ok(html.includes('function lxScope()'), '缺词库作用域函数');
  assert.ok(html.includes('lxScope()'), '调用点未传作用域');
  // 3) 中考组卷：按题库清单组模拟卷
  assert.ok(html.includes('bankExamQueue'), '缺词库题卷组卷函数');
  assert.ok(html.includes('examBankPending'), '缺题卷就绪探测');
  // 4) 词库数据不内联（硬约束 9）
  assert.ok(!html.includes('q_jun_grammar_'), '题库题目不得内联进单文件');
  assert.ok(!/"core":true/.test(html), '词表数据不得内联进单文件');
});

test('A-9b 词源分片已产出且与详情同数', () => {
  const wl = readJson(join(JUN_DIR, 'wordlist.json'));
  assert.equal(wl.length, detailMf.count, '词源条数与详情分片一致');
  for (const w of wl.slice(0, 50)) {
    assert.ok(typeof w.w === 'string' && w.w, '词形缺失');
    assert.ok(typeof w.zh === 'string', '中文释义缺失');
    assert.ok(typeof w.short === 'string' && w.short, '短义缺失（它是选择题选项）');
    assert.ok(w.short.length <= 12, `短义过长：${w.short}`);
  }
  // 现有 428 测试所依赖的 CET-4 默认行为：wordlist.json 只为非默认词库产出
  assert.ok(!existsSync(join(ROOT, 'src/data/vocab-detail/wordlist.json')),
    'CET-4 用内联词源，不应多出 wordlist.json');
});
