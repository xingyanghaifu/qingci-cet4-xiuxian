/**
 * 高中词库 + 高考题型 · 阶段 B 验收（v1.9.0）
 *
 * 覆盖谕令 B3 的 9 条验收：
 *   B-1 词库清单含 senior        B-2 高中词数 3500–4500
 *   B-3 详情分片                 B-4 题库分片
 *   B-5 词库切换                 B-6 进度隔离
 *   B-7 题型覆盖                 B-8 模考模式（高考模拟卷）
 *   B-9 运行时接线（词源/作用域/组卷）
 * 第 9 条「现有测试全绿」由整套 `npm test` 本身保证。
 *
 * 另外守住硬约束：CET-4 默认词库不动、词库数据不内联主文件、单片 ≤1.5MB。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadTs } from './helpers/load-ts.mjs';
import { makeFakeIdb } from './helpers/fake-idb.mjs';

const ROOT = join(import.meta.dirname, '..');
const LEX_DIR = join(ROOT, 'src', 'data', 'lexicons');
const SEN_DIR = join(LEX_DIR, 'senior');
const QB_DIR = join(SEN_DIR, 'question-bank');

const lexiconMod = await loadTs('src/services/lexicon.ts');
const vocabSrsMod = await loadTs('src/services/vocab-srs.ts');
const idbMod = await loadTs('src/services/idb.ts');
const detailMod = await loadTs('src/services/vocab-detail.ts');
const { currentLexiconId, switchLexicon, FALLBACK_MANIFEST } = lexiconMod;

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const manifest = readJson(join(LEX_DIR, 'manifest.json'));
const detailMf = readJson(join(SEN_DIR, 'vocab-detail', 'manifest.json'));
const bankMf = readJson(join(QB_DIR, 'manifest.json'));

/* ---------------- B-1 词库清单 ---------------- */

test('B-1 词库清单含 senior：启用、路径正确、默认仍是 CET-4', () => {
  assert.equal(manifest.defaultLexiconId, 'cet4', '默认词库必须保持 CET-4（硬约束 8）');
  const senior = manifest.lexicons.find((l) => l.id === 'senior');
  assert.ok(senior, 'manifest 应含 senior 条目');
  assert.equal(senior.enabled, true, 'senior 已上线，允许用户主动切换');
  assert.equal(senior.shortName, '高中');
  assert.equal(senior.dataPath, 'lexicons/senior/vocab-detail/');
  assert.equal(senior.wordListPath, 'lexicons/senior/', '词源路径供运行时换词表用');
  // 离线首屏兜底清单同样含 senior（否则断网首屏看不到高中卡）
  const fb = FALLBACK_MANIFEST.lexicons.find((l) => l.id === 'senior');
  assert.ok(fb, 'FALLBACK_MANIFEST 应含 senior 条目');
  assert.equal(fb.enabled, true);
});

/* ---------------- B-2 词数与重叠标记 ---------------- */

test('B-2 高中词数落在 3500–4500，与四级重叠词标 inCET4', () => {
  const senior = manifest.lexicons.find((l) => l.id === 'senior');
  assert.ok(senior.wordCount >= 3500 && senior.wordCount <= 4500,
    `高中词数 ${senior.wordCount} 应在 3500–4500（谕令 B3-2）`);
  // 与详情分片逐词核对
  let total = 0, core = 0, overlap = 0, withZh = 0;
  for (const f of new Set(Object.values(detailMf.files))) {
    const data = readJson(join(SEN_DIR, 'vocab-detail', f));
    for (const d of Object.values(data)) {
      total++;
      if (d.core === true) core++;
      if (d.inCET4 === true) overlap++;
      const zh = (d.meanings || []).map((m) => (m.definitions || []).map((x) => x.chinese).join('')).join('');
      if (zh.trim()) withZh++;
    }
  }
  assert.equal(total, senior.wordCount, '清单词数与分片条目一致');
  assert.equal(total, detailMf.count);
  assert.ok(core >= 3300, `高考核心词 ${core} 应 ≥3300（课标 3500 档）`);
  assert.ok(overlap >= 2800, `与四级重叠词 ${overlap} 应 ≥2800（标记 inCET4）`);
  assert.ok(withZh / total > 0.98, `中文释义覆盖率过低：${withZh}/${total}`);
});

/* ---------------- B-3 详情分片 ---------------- */

test('B-3 详情分片：前缀最长匹配、单片 ≤1.5MB、无重复词', () => {
  const lens = detailMf.prefixes.map((p) => p.length);
  assert.deepEqual(lens, [...lens].sort((a, b) => b - a), 'prefixes 按长度降序（运行时最长匹配）');
  assert.equal(detailMf.prefixes.length, Object.keys(detailMf.files).length);
  const words = new Set();
  let dup = 0;
  for (const f of new Set(Object.values(detailMf.files))) {
    const bytes = statSync(join(SEN_DIR, 'vocab-detail', f)).size;
    assert.ok(bytes <= 1_500_000, `分片 ${f} 为 ${bytes} 字节 > 1.5MB`);
    const data = readJson(join(SEN_DIR, 'vocab-detail', f));
    for (const w of Object.keys(data)) {
      if (words.has(w)) dup++;
      words.add(w);
    }
  }
  assert.equal(dup, 0, '分片之间不应出现重复词');
  // 运行时基准路径已注册（否则详情会错读 CET-4 分片）
  assert.equal(detailMod.VOCAB_DETAIL_BASES.senior, 'lexicons/senior/vocab-detail/');
  assert.equal(detailMod.baseOf('senior'), 'lexicons/senior/vocab-detail/');
});

/* ---------------- B-4 题库分片 ---------------- */

test('B-4 题库分片：六种高考题型齐全、总量 3000–5000、单片 ≤1.5MB', () => {
  assert.equal(bankMf.schema, 'qingci-exam-bank/1');
  assert.equal(bankMf.lexicon, 'senior');
  assert.equal(bankMf.exam, 'gaokao');
  const kinds = Object.keys(bankMf.kinds).sort();
  assert.deepEqual(kinds, ['cloze', 'continuation', 'gapped', 'grammarfill', 'reading', 'writing'],
    '六种题型：阅读理解 / 七选五 / 完形填空 / 语法填空 / 应用文 / 读后续写');
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

/* ---------------- B-7 题型覆盖（内容质量抽查） ---------------- */

test('B-7 题型覆盖：选择题选项互异且正解在其中；主观题 write=true', () => {
  let checked = 0;
  const ids = new Set();
  for (const [kind, info] of Object.entries(bankMf.kinds)) {
    const shard = readJson(join(QB_DIR, info.file));
    assert.ok(shard.questions.length > 0, `${kind} 分片不应为空`);
    for (const q of shard.questions) {
      assert.ok(!ids.has(q.id), `题号重复：${q.id}`);
      ids.add(q.id);
      assert.equal(q.knowledgeTags[0], 'senior', `${q.id} 标签应以 senior 开头`);
      assert.ok(q.difficulty >= 0.2 && q.difficulty <= 0.8, `${q.id} 难度越界`);
      const c = q.content;
      if (kind === 'writing' || kind === 'continuation') {
        assert.equal(c.write, true, `${q.id} 主观题应 write=true`);
        assert.equal(c.answer, '', `${q.id} 主观题无标准答案`);
        assert.ok(typeof c.min === 'number' && typeof c.max === 'number', `${q.id} 应有字数区间`);
        if (kind === 'continuation') assert.ok(c.passage && c.sub, `${q.id} 读后续写应带材料与段首语`);
        continue;
      }
      const expect = kind === 'gapped' ? 7 : 4;
      assert.equal(c.choices.length, expect, `${q.id} 选项数应为 ${expect}`);
      assert.equal(new Set(c.choices).size, expect, `${q.id} 选项必须互异：${JSON.stringify(c.choices)}`);
      assert.ok(c.choices.includes(c.answer), `${q.id} 正解不在选项中：${c.answer}`);
      assert.ok(typeof c.explain === 'string' && c.explain.length > 5, `${q.id} 缺解析`);
      assert.ok(!/\{[A-Z]/.test(c.prompt + (c.passage || '')), `${q.id} 残留占位符`);
      // 完形/七选五/语法填空的空画在**篇章**里（___1___），题干只提示第几空。
      if (kind === 'cloze' || kind === 'gapped' || kind === 'grammarfill') {
        assert.ok(/___\d+___/.test(c.passage || ''), `${q.id} 篇章应有编号空位`);
        const m = c.prompt.match(/第 (\d+) [空处]/);
        assert.ok(m, `${q.id} 题干应提示第几空/处：${c.prompt}`);
        assert.ok(new RegExp(`___${m[1]}___`).test(c.passage),
          `${q.id} 题干编号与篇章空位应对应`);
      }
      if (kind === 'reading') assert.ok((c.passage || '').length > 100, `${q.id} 阅读题应带短文`);
      checked++;
    }
  }
  assert.ok(checked > 3000, `客观题抽查 ${checked} 道`);
  // 语法填空的提示词不能重复渲染成 `(write) (write)`
  const gf = readJson(join(QB_DIR, bankMf.kinds.grammarfill.file));
  for (const q of gf.questions) {
    assert.ok(!/\((\w+)\) \(\1\)/.test(q.content.passage || ''), `${q.id} 提示词重复渲染`);
  }
});

/* ---------------- B-8 模考模式（高考模拟卷） ---------------- */

test('B-8 模考模式：3 套高考模拟卷、各 53 题、题号可解析、两两不重', () => {
  const keys = Object.keys(bankMf.papers);
  assert.deepEqual(keys.sort(), ['gk-01', 'gk-02', 'gk-03']);
  const all = new Set();
  const wantStructure = { reading: 16, gapped: 5, cloze: 20, grammarfill: 10, writing: 1, continuation: 1 };
  for (const [k, p] of Object.entries(bankMf.papers)) {
    assert.equal(p.ids.length, 53, `${k} 应为 53 题`);
    assert.deepEqual(p.structure, wantStructure, `${k} 结构为高考题型配比`);
    const kindSet = new Set();
    for (const id of p.ids) {
      assert.ok(!all.has(id), `${k} 与前一套卷子重题：${id}`);
      all.add(id);
      const kind = id.split('_')[2];
      kindSet.add(kind);
      assert.ok(['reading', 'gapped', 'cloze', 'grammarfill', 'writing', 'continuation'].includes(kind),
        `${k} 含未知题型 ${id}`);
    }
    assert.equal(kindSet.size, 6, `${k} 六种题型齐全`);
  }
  // 题号确实能解析到题目
  const r = readJson(join(QB_DIR, 'reading.json'));
  const sampleId = bankMf.papers['gk-01'].ids[0];
  assert.ok(r.questions.some((q) => q.id === sampleId), '模拟卷首题应能在阅读分片里找到');
});

/* ---------------- B-5 词库切换 ---------------- */

test('B-5 词库切换：senior 可切换、默认仍 CET-4、未上线仍拒绝', () => {
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
    assert.equal(switchLexicon('senior', FALLBACK_MANIFEST.lexicons), true, 'senior 应可切换');
    assert.equal(currentLexiconId(FALLBACK_MANIFEST.lexicons.filter((l) => l.enabled)), 'senior');
    for (const id of ['kaoyan', 'ielts', 'toefl']) {
      assert.equal(switchLexicon(id, FALLBACK_MANIFEST.lexicons), false, `${id} 未上线应拒绝`);
    }
    assert.equal(currentLexiconId(FALLBACK_MANIFEST.lexicons.filter((l) => l.enabled)), 'senior',
      '失败的切换不应改写当前词库');
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { value: prev, configurable: true, writable: true });
  }
});

/* ---------------- B-6 进度隔离 ---------------- */

test('B-6 进度隔离：高中进度进复合键仓，不污染 CET-4 老仓', async () => {
  idbMod.__resetIdbCache();
  const factory = makeFakeIdb();
  const store = vocabSrsMod.createVocabSrsStore(factory);
  const now = new Date('2026-10-05T00:00:00Z');

  await store.rate('abandon', 'good', now, 'senior');
  await store.rate('ability', 'good', now, 'cet4');

  const senior = await store.all('senior');
  const cet4 = await store.all('cet4');
  assert.equal(senior.length, 1, 'senior 只应看到自己的进度');
  assert.equal(cet4.length, 1, 'CET-4 不应看到 senior 的词');
  assert.equal(senior[0].w, 'abandon');
  assert.equal(cet4[0].w, 'ability');
  assert.equal(senior[0].lx, 'senior');
  // 老仓（不带词库）只读 v1.8.x 存量：senior 的新词不进老仓
  const legacy = await store.all();
  assert.equal(legacy.length, 0, 'senior 进度不应写进 legacy 单键仓');
  assert.equal(senior[0].k, 'senior abandon', 'vocabLex 复合键应为 "<词库> <词>"');
  idbMod.__resetIdbCache();
});

/* ---------------- B-9 运行时接线 ---------------- */

test('B-9 运行时接线：高中词源与组卷都已进产物，且数据不内联', () => {
  const html = readFileSync(join(ROOT, 'dist', 'index.html'), 'utf8');
  // 1) 词源切换对 senior 同样生效（A 阶段已接 useLexiconWords，这里确认产物在）
  assert.ok(html.includes('useLexiconWords'), '缺词源切换函数');
  assert.ok(html.includes("lexicons/' + lex + '/wordlist.json'"), '缺词源分片 URL');
  // 2) 高考组卷：按题库清单组模拟卷（与中考共用 bankExamQueue，按 manifest 分流）
  assert.ok(html.includes('bankExamQueue'), '缺词库题卷组卷函数');
  // 3) 词库数据不内联（硬约束 9）
  assert.ok(!html.includes('q_sen_reading_'), '题库题目不得内联进单文件');
  assert.ok(!html.includes('q_jun_reading_'), '题库题目不得内联进单文件');
  assert.ok(!/"core":true/.test(html), '词表数据不得内联进单文件');
});

test('B-9b 高中词源分片已产出且与详情同数', () => {
  const wl = readJson(join(SEN_DIR, 'wordlist.json'));
  assert.equal(wl.length, detailMf.count, '词源条数与详情分片一致');
  for (const w of wl.slice(0, 50)) {
    assert.ok(typeof w.w === 'string' && w.w, '词形缺失');
    assert.ok(typeof w.zh === 'string', '中文释义缺失');
    assert.ok(typeof w.short === 'string' && w.short, '短义缺失（它是选择题选项）');
    assert.ok(w.short.length <= 16, `短义过长：${w.short}`);
  }
  // 高中词数在 3770 档且核心词占大头
  const core = wl.filter((w) => w.core === true).length;
  assert.ok(core >= 3300, `词源核心词 ${core} 应 ≥3300`);
});
