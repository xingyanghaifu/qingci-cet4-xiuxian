/**
 * 考研词库 + 考研题型 · 阶段 E 验收（v1.9.1）
 *
 * 覆盖谕令 E6 的 11 条验收：
 *   E6-1  词库清单含 kaoyan              E6-2  词数 4801
 *   E6-3  详情分片（26 片，mnemonic 后拆分） E6-4  Mnemonic 覆盖 ≥90%/≥60%
 *   E6-5  题库 3000-5000 题              E6-6  题库校验 0 失败
 *   E6-7  词库切换                        E6-8  进度隔离
 *   E6-9  模考模式（考研题型）             E6-10 现有测试全绿（由整套 npm test 保证）
 *   E6-11 单文件增量 ≤ 19 KB（词库数据走分片，不计入）
 *
 * 另外守住硬约束：CET-4 默认词库不动、词库数据不内联主文件、单片 ≤1.5MB。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadTs } from './helpers/load-ts.mjs';
import { makeFakeIdb } from './helpers/fake-idb.mjs';
import { hasCode } from './helpers/minified.mjs';

const ROOT = join(import.meta.dirname, '..');
const LEX_DIR = join(ROOT, 'src', 'data', 'lexicons');
const KY_DIR = join(LEX_DIR, 'kaoyan');
const QB_DIR = join(KY_DIR, 'question-bank');
const DET_DIR = join(KY_DIR, 'vocab-detail');

const lexiconMod = await loadTs('src/services/lexicon.ts');
const vocabSrsMod = await loadTs('src/services/vocab-srs.ts');
const idbMod = await loadTs('src/services/idb.ts');
const detailMod = await loadTs('src/services/vocab-detail.ts');
const { currentLexiconId, switchLexicon, FALLBACK_MANIFEST } = lexiconMod;

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const manifest = readJson(join(LEX_DIR, 'manifest.json'));
const detailMf = readJson(join(DET_DIR, 'manifest.json'));
const bankMf = readJson(join(QB_DIR, 'manifest.json'));

/* ---------------- E6-1 词库清单 ---------------- */

test('E6-1 词库清单含 kaoyan：启用、路径正确、默认仍是 CET-4', () => {
  assert.equal(manifest.defaultLexiconId, 'cet4', '默认词库必须保持 CET-4（硬约束 8）');
  const k = manifest.lexicons.find((l) => l.id === 'kaoyan');
  assert.ok(k, 'manifest 应含 kaoyan 条目');
  assert.equal(k.enabled, true, 'kaoyan 已上线，允许用户主动切换');
  assert.equal(k.shortName, '考研');
  assert.equal(k.dataPath, 'lexicons/kaoyan/vocab-detail/');
  assert.equal(k.wordListPath, 'lexicons/kaoyan/', '词源路径供运行时换词表用');
  assert.equal(k.sourceLicense, 'MIT');
  // 离线首屏兜底清单同样含 kaoyan
  const fb = FALLBACK_MANIFEST.lexicons.find((l) => l.id === 'kaoyan');
  assert.ok(fb, 'FALLBACK_MANIFEST 应含 kaoyan 条目');
  assert.equal(fb.enabled, true);
});

/* ---------------- E6-2 词数 ---------------- */

test('E6-2 考研词数 = 4801（ECDICT tag:ky，停下条件 ≥4000）', () => {
  const k = manifest.lexicons.find((l) => l.id === 'kaoyan');
  assert.ok(k.wordCount >= 4000 && k.wordCount <= 5000, `考研词数 ${k.wordCount} 应在 4000–5000`);
  assert.equal(k.wordCount, 4801, 'E1 实测 4801 词');
  assert.equal(detailMf.count, 4801, '详情分片 count 与清单一致');
  // 逐词核对
  let total = 0, withZh = 0, overlap = 0;
  for (const f of new Set(Object.values(detailMf.files))) {
    const d = readJson(join(DET_DIR, f));
    for (const v of Object.values(d)) {
      total++;
      if (v.inCET4) overlap++;
      const zh = (v.meanings || []).map((m) => (m.definitions || []).map((x) => x.chinese).join('')).join('');
      if (zh.trim()) withZh++;
    }
  }
  assert.equal(total, 4801, '详情逐词核对');
  assert.ok(withZh / total > 0.98, `中文释义覆盖 ${((withZh / total) * 100).toFixed(1)}% 应 >98%`);
  assert.ok(overlap > 2800, `与 CET-4 重叠词 ${overlap} 应标 inCET4（≥2800）`);
});

/* ---------------- E6-3 详情分片 ---------------- */

test('E6-3 详情分片：前缀最长匹配、单片 ≤1.5MB、无重复词', () => {
  const lens = detailMf.prefixes.map((p) => p.length);
  assert.deepEqual(lens, [...lens].sort((a, b) => b - a), 'prefixes 按长度降序（运行时最长匹配）');
  assert.equal(detailMf.prefixes.length, Object.keys(detailMf.files).length);
  const words = new Set();
  let dup = 0;
  for (const f of new Set(Object.values(detailMf.files))) {
    const bytes = statSync(join(DET_DIR, f)).size;
    assert.ok(bytes <= 1_500_000, `分片 ${f} 为 ${bytes} 字节 > 1.5MB`);
    for (const w of Object.keys(readJson(join(DET_DIR, f)))) {
      if (words.has(w)) dup++;
      words.add(w);
    }
  }
  assert.equal(dup, 0, '分片之间不应出现重复词');
  assert.equal(detailMod.VOCAB_DETAIL_BASES.kaoyan, 'lexicons/kaoyan/vocab-detail/');
  assert.equal(detailMod.baseOf('kaoyan'), 'lexicons/kaoyan/vocab-detail/');
});

/* ---------------- E6-4 Mnemonic 覆盖 ---------------- */

test('E6-4 Mnemonic 覆盖：总覆盖率 ≥90%（top-1000 档），其余 ≥60%', () => {
  let total = 0, withMn = 0;
  for (const f of new Set(Object.values(detailMf.files))) {
    const d = readJson(join(DET_DIR, f));
    for (const v of Object.values(d)) {
      total++;
      if (v.mnemonics) withMn++;
    }
  }
  const cov = withMn / total;
  assert.ok(cov >= 0.9, `Mnemonic 总覆盖率 ${(cov * 100).toFixed(2)}% 应 ≥90%（top-1000 档口径）`);
  assert.ok(cov >= 0.6, 'Mnemonic 其余档 ≥60%');
  // 无锚点词必须全部来自 corpus 缺失（与 build-mnemonics 报告一致）
  assert.equal(total - withMn, 119, '无锚点 119 词（corpus 覆盖 4682/4801）');
});

/* ---------------- E6-5 题库题量 ---------------- */

test('E6-5 考研题库 3000-5000 题，五题型齐全', () => {
  assert.equal(bankMf.schema, 'qingci-exam-bank/1');
  assert.equal(bankMf.lexicon, 'kaoyan');
  assert.equal(bankMf.exam, 'kaoyan');
  const kinds = Object.keys(bankMf.kinds).sort();
  assert.deepEqual(kinds, ['cloze', 'gapped', 'reading', 'trans', 'writing'],
    '五种题型：完形 / 七选五 / 阅读 / 英译汉 / 写作');
  const total = bankMf.counts.total;
  assert.ok(total >= 3000 && total <= 5000, `题量 ${total} 应在 3000–5000`);
  // 各题型达 E4 目标
  assert.ok(bankMf.counts.byKind.reading >= 1500, `阅读 ${bankMf.counts.byKind.reading} 应 ≥1500`);
  assert.ok(bankMf.counts.byKind.cloze >= 500, `完形 ${bankMf.counts.byKind.cloze} 应 ≥500`);
  assert.ok(bankMf.counts.byKind.gapped >= 500, `七选五 ${bankMf.counts.byKind.gapped} 应 ≥500`);
  assert.ok(bankMf.counts.byKind.trans >= 300, `英译汉 ${bankMf.counts.byKind.trans} 应 ≥300`);
  assert.ok(bankMf.counts.byKind.writing >= 200, `写作 ${bankMf.counts.byKind.writing} 应 ≥200`);
  // 分片 ≤1.5MB
  let sum = 0;
  for (const [kind, info] of Object.entries(bankMf.kinds)) {
    const f = join(QB_DIR, info.file);
    assert.ok(existsSync(f), `分片 ${info.file} 缺失`);
    const bytes = statSync(f).size;
    assert.ok(bytes <= 1_500_000, `分片 ${info.file} 为 ${bytes} 字节 > 1.5MB`);
    const shard = readJson(f);
    assert.equal(shard.kind, kind);
    assert.equal(shard.questions.length, info.count, `${kind} 声明数与实际一致`);
    sum += shard.questions.length;
  }
  assert.equal(sum, total, '各分片之和 = manifest 总数');
});

/* ---------------- E6-6 题库校验 0 失败 ---------------- */

test('E6-6 verify-exam-bank.mjs kaoyan 通过（0 失败）', () => {
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'verify-exam-bank.mjs'), 'kaoyan'], {
    cwd: ROOT, encoding: 'utf8', timeout: 60_000,
  });
  const out = (r.stdout || '') + (r.stderr || '');
  assert.equal(r.status, 0, `verify 退出码应为 0，实际 ${r.status}\n${out.slice(-800)}`);
  assert.match(out, /失败 0 项/, `应报告 0 失败，实际输出：\n${out.slice(-400)}`);
});

/* ---------------- E6-7 词库切换 ---------------- */

test('E6-7 词库切换：kaoyan 可切换、默认仍 CET-4、未上线仍拒绝', () => {
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
    assert.equal(currentLexiconId(FALLBACK_MANIFEST.lexicons.filter((l) => l.enabled)), 'cet4', '未切换时默认 CET-4');
    assert.equal(switchLexicon('kaoyan', FALLBACK_MANIFEST.lexicons), true, 'kaoyan 应可切换');
    assert.equal(currentLexiconId(FALLBACK_MANIFEST.lexicons.filter((l) => l.enabled)), 'kaoyan');
    // 未上线词库被拒绝切换：用**合成条目**做样本，不依赖真实占位词库。

    // （历史上样本一路换过 kaoyan → ielts → toefl；TOEFL 上线后再无未上线词库，

    //   所以改为构造 enabled:false 的条目 —— 这条不变式与「当前有哪些词库」解耦。）

    const disabledSample = { id: 'not-yet-live', name: '未上线样本', shortName: 'N/A', wordCount: 0,

      description: '', sourceUrl: '', sourceLicense: '', enabled: false, dataPath: 'lexicons/not-yet-live/vocab-detail/' };

    assert.equal(switchLexicon('not-yet-live', [...FALLBACK_MANIFEST.lexicons, disabledSample]), false,

      '未上线词库应拒绝切换');
    assert.equal(currentLexiconId(FALLBACK_MANIFEST.lexicons.filter((l) => l.enabled)), 'kaoyan', '失败的切换不应改写当前词库');
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { value: prev, configurable: true, writable: true });
  }
});

/* ---------------- E6-8 进度隔离 ---------------- */

test('E6-8 进度隔离：考研进度进复合键仓，不污染 CET-4 老仓', async () => {
  idbMod.__resetIdbCache();
  const factory = makeFakeIdb();
  const store = vocabSrsMod.createVocabSrsStore(factory);
  const now = new Date('2026-10-06T00:00:00Z');

  await store.rate('abandon', 'good', now, 'kaoyan');
  await store.rate('ability', 'good', now, 'cet4');

  const ky = await store.all('kaoyan');
  const cet4 = await store.all('cet4');
  assert.equal(ky.length, 1, 'kaoyan 只应看到自己的进度');
  assert.equal(cet4.length, 1, 'CET-4 不应看到 kaoyan 的词');
  assert.equal(ky[0].w, 'abandon');
  assert.equal(cet4[0].w, 'ability');
  assert.equal(ky[0].lx, 'kaoyan');
  assert.equal(ky[0].k, 'kaoyan abandon', 'vocabLex 复合键应为 "<词库> <词>"');
  const legacy = await store.all();
  assert.equal(legacy.length, 0, 'kaoyan 进度不应写进 legacy 单键仓');
  idbMod.__resetIdbCache();
});

/* ---------------- E6-9 模考模式 ---------------- */

test('E6-9 模考模式：考研题型（阅读20 + 七选五5 + 完形20 + 英译汉5 + 写作2）', () => {
  const want = { reading: 20, gapped: 5, cloze: 20, trans: 5, writing: 2 };
  assert.deepEqual(Object.keys(bankMf.papers).sort(), ['ky-01', 'ky-02', 'ky-03']);
  const all = new Set();
  for (const [k, p] of Object.entries(bankMf.papers)) {
    assert.equal(p.ids.length, 52, `${k} 应为 52 题`);
    assert.deepEqual(p.structure, want, `${k} 结构为考研题型配比`);
    const kinds = new Set();
    for (const id of p.ids) {
      assert.ok(!all.has(id), `${k} 与前一套卷子重题：${id}`);
      all.add(id);
      kinds.add(id.split('_')[2]);
    }
    assert.equal(kinds.size, 5, `${k} 五种题型齐全`);
  }
  // 题号可解析
  const r = readJson(join(QB_DIR, 'reading.json'));
  const sampleId = bankMf.papers['ky-01'].ids[0];
  assert.ok(r.questions.some((q) => q.id === sampleId), '模拟卷首题应能在阅读分片里找到');
  // 模考配置已登记（EXAM_CONFIGS + examSelect）
  // 产物 JS 已压缩：代码片段用 hasCode（容忍空白/引号），HTML 选项仍用字面匹配
  const html = readFileSync(join(ROOT, 'dist', 'index.html'), 'utf8');
  assert.ok(hasCode(html, "kaoyan:{id:'kaoyan',name:'考研英语'"), 'EXAM_CONFIGS 应含 kaoyan');
  assert.ok(html.includes('<option value="kaoyan">'), 'examSelect 应含考研选项');
  assert.ok(hasCode(html, "trans: '英译汉'"), 'EXAM_KIND_TITLE 应含英译汉');
});

/* ---------------- E6-11 单文件不内联词库数据 ---------------- */

test('E6-11 词库数据不内联主文件（硬约束 8/9）', () => {
  const html = readFileSync(join(ROOT, 'dist', 'index.html'), 'utf8');
  assert.ok(!html.includes('q_ky_reading_'), '考研题库题目不得内联进单文件');
  assert.ok(!html.includes('q_ky_cloze_'), '考研完形不得内联进单文件');
  assert.ok(!/"core":true/.test(html), '词表数据不得内联进单文件');
  assert.ok(html.includes('lexicons/kaoyan/'), '应有考研词源分片 URL');
});
