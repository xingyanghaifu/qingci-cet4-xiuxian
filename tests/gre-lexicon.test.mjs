/**
 * GRE 词库 + 题库（v1.10 第一批）
 *
 * 这一批踩到并修好了**同一个静默陷阱的三种形态**，本测试把它们全部钉死：
 *
 *   ① `build-lexicon.mjs` 的 `writeManifest` 用**硬编码 order 数组**，
 *      新增词库忘了加进去 → 分片正常产出、清单里却没有它 → UI 永远看不到，零报错。
 *   ② `build-mnemonics.mjs` 有**另一份独立登记表**，同样会静默漏掉新词库。
 *   ③ `verify-exam-bank.mjs` 又有第三份登记表，`verify-exam-bank gre` 直接报「未知词库」。
 *
 * 现在的防线：① 加断言（LEXICONS 里的必须都在 order 里，否则构建失败）；
 * ② 加 `--lexicon X` 未登记即失败；③ 登记 gre。
 * 本测试从**产物侧**再验一遍：清单里有 gre、分片能取到、题库能组卷。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const GRE_DIR = join(ROOT, 'src', 'data', 'lexicons', 'gre');
const DIST_GRE = join(ROOT, 'dist', 'lexicons', 'gre');

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

/* ---------------- 词库数据 ---------------- */

test('GRE：词数达预期（7504，≥80% 停下条件未触发）', () => {
  const wl = readJson(join(GRE_DIR, 'wordlist.json'));
  assert.equal(wl.length, 7504, `GRE 词表应为 7504 词，实际 ${wl.length}`);
  const mf = readJson(join(GRE_DIR, 'vocab-detail', 'manifest.json'));
  assert.equal(mf.count, 7504, `详情分片 count 应为 7504，实际 ${mf.count}`);
});

test('GRE：分片体积合规（每片 ≤1.5MB）且条数与清单一致', () => {
  const dir = join(GRE_DIR, 'vocab-detail');
  const mf = readJson(join(dir, 'manifest.json'));
  let total = 0;
  let maxBytes = 0;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json') || f === 'manifest.json') continue;
    const bytes = statSync(join(dir, f)).size;
    maxBytes = Math.max(maxBytes, bytes);
    total += Object.keys(readJson(join(dir, f))).length;
  }
  assert.ok(maxBytes <= 1.5 * 1024 * 1024, `最大分片 ${(maxBytes / 1024).toFixed(0)} KB 超 1.5MB`);
  assert.equal(total, mf.count, `分片合计 ${total} 条与清单 ${mf.count} 不一致`);
});

test('GRE：中文释义与音标覆盖（硬约束：不得大面积缺失）', () => {
  const dir = join(GRE_DIR, 'vocab-detail');
  let total = 0;
  let withChinese = 0;
  let withPhonetic = 0;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json') || f === 'manifest.json') continue;
    const j = readJson(join(dir, f));
    for (const w of Object.keys(j)) {
      total++;
      const d = j[w];
      const hasZh = Array.isArray(d.meanings) && d.meanings.some(
        (m) => Array.isArray(m.definitions) && m.definitions.some((x) => x && x.chinese && String(x.chinese).trim()),
      );
      if (hasZh) withChinese++;
      if (d.phonetic && (d.phonetic.british || d.phonetic.american)) withPhonetic++;
    }
  }
  assert.equal(total, 7504);
  assert.ok(withChinese / total >= 0.95, `中文释义覆盖 ${(withChinese / total * 100).toFixed(1)}% 偏低`);
  assert.ok(withPhonetic / total >= 0.95, `音标覆盖 ${(withPhonetic / total * 100).toFixed(1)}% 偏低`);
});

test('GRE：mnemonic 覆盖率达标（top-1000 ≥90%、其余 ≥60%）', () => {
  const dir = join(GRE_DIR, 'vocab-detail');
  let total = 0;
  let covered = 0;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json') || f === 'manifest.json') continue;
    const j = readJson(join(dir, f));
    for (const w of Object.keys(j)) {
      total++;
      const t = j[w].mnemonics && j[w].mnemonics.tier;
      if (t === 'full' || t === 'basic') covered++;
    }
  }
  const cov = covered / total;
  assert.ok(cov >= 0.6, `mnemonic 覆盖率 ${(cov * 100).toFixed(2)}% 低于 60%`);
  assert.ok(cov >= 0.9, `mnemonic 覆盖率 ${(cov * 100).toFixed(2)}% 应达 90%+（实测 99%+）`);
});

/* ---------------- 静默陷阱的防线 ---------------- */

test('GRE：三份登记表都不得漏掉 gre（曾经三处都漏）', () => {
  // ① build-lexicon：LEXICONS 有 gre，且 writeManifest 的 order 有 gre
  const lex = readFileSync(join(ROOT, 'scripts', 'build-lexicon.mjs'), 'utf8');
  assert.ok(/^\s{2}gre:\s*\{/m.test(lex), 'build-lexicon 的 LEXICONS 缺 gre');
  const orderMatch = lex.match(/const order = \[([^\]]+)\]/);
  assert.ok(orderMatch, 'build-lexicon 未找到 order 数组');
  assert.ok(orderMatch[1].includes("'gre'"), 'writeManifest 的 order 数组缺 gre（会静默不出现在清单）');
  // 且必须有「LEXICONS 与 order 一致性」断言，防止下次再漏
  assert.ok(/missingFromOrder/.test(lex), 'build-lexicon 缺少「LEXICONS vs order」一致性断言');

  // ② build-mnemonics：LEXICONS 数组有 gre
  const mn = readFileSync(join(ROOT, 'scripts', 'build-mnemonics.mjs'), 'utf8');
  assert.ok(/id: 'gre'/.test(mn), 'build-mnemonics 的 LEXICONS 缺 gre');
  assert.ok(/未登记在本脚本的 LEXICONS 清单里/.test(mn), 'build-mnemonics 缺少「未登记即失败」的护栏');

  // ③ verify-exam-bank：LEX 有 gre
  const vf = readFileSync(join(ROOT, 'scripts', 'verify-exam-bank.mjs'), 'utf8');
  assert.ok(/^\s{2}gre:\s*\{/m.test(vf), 'verify-exam-bank 的 LEX 缺 gre');
});

test('GRE：清单里有 gre 且 enabled（UI 才能看到）', () => {
  const m = readJson(join(ROOT, 'src', 'data', 'lexicons', 'manifest.json'));
  const gre = m.lexicons.find((l) => l.id === 'gre');
  assert.ok(gre, '清单里没有 gre —— UI 将永远看不到这个词库');
  assert.equal(gre.enabled, true, 'gre 应 enabled');
  assert.equal(gre.wordCount, 7504);
  assert.equal(gre.dataPath, 'lexicons/gre/vocab-detail/');
  assert.ok(gre.shortName === 'GRE');
});

test('GRE：服务层 FALLBACK_LEXICONS 也登记了（离线兜底清单）', () => {
  const svc = readFileSync(join(ROOT, 'src', 'services', 'lexicon.ts'), 'utf8');
  assert.ok(/id: 'gre'/.test(svc), '服务层兜底清单缺 gre');
  assert.ok(/wordCount: 7504/.test(svc), '服务层 gre 词数应为 7504');
});

/* ---------------- 题库 ---------------- */

test('GRE：题库题量落在 3000–5000 且三类齐全', () => {
  const mf = readJson(join(GRE_DIR, 'question-bank', 'manifest.json'));
  const kinds = Object.keys(mf.kinds || {});
  assert.deepEqual(kinds.sort(), ['bankfill', 'reading', 'writing'], `题型应三类，实际 ${kinds.join(',')}`);
  const total = Object.values(mf.kinds).reduce((a, k) => a + (k.count || 0), 0);
  assert.ok(total >= 3000 && total <= 5000, `题量 ${total} 超出 3000–5000`);
});

test('GRE：3 套模拟卷，每套 1156 题（3 套必须都凑满）', () => {
  const mf = readJson(join(GRE_DIR, 'question-bank', 'manifest.json'));
  assert.deepEqual(Object.keys(mf.papers).sort(), ['gr-01', 'gr-02', 'gr-03']);
  for (const [k, p] of Object.entries(mf.papers)) {
    assert.equal(p.ids.length, 1156, `${k} 应为 1156 题，实际 ${p.ids.length}`);
    assert.deepEqual(p.structure, { bankfill: 620, reading: 525, writing: 11 }, `${k} 结构不符`);
  }
});

test('GRE：无听力题（GRE 不考听力）', () => {
  const mf = readJson(join(GRE_DIR, 'question-bank', 'manifest.json'));
  assert.ok(!mf.kinds.talk, 'GRE 不应有 talk（听力）题型');
});

/* ---------------- 产物 ---------------- */

test('GRE：产物含词库分片 + 题库 + 词表（线上可按需取）', () => {
  for (const p of ['vocab-detail/manifest.json', 'question-bank/manifest.json', 'wordlist.json']) {
    const full = join(DIST_GRE, p);
    assert.ok(existsSync(full), `产物缺 ${p}`);
    assert.ok(statSync(full).size > 0, `产物 ${p} 为空`);
  }
});

test('GRE：产物清单与源清单一致（构建没丢词库）', () => {
  const src = readJson(join(ROOT, 'src', 'data', 'lexicons', 'manifest.json'));
  const dist = readJson(join(ROOT, 'dist', 'lexicons', 'manifest.json'));
  const srcIds = src.lexicons.map((l) => l.id).sort();
  const distIds = dist.lexicons.map((l) => l.id).sort();
  assert.deepEqual(distIds, srcIds, '产物清单与源清单词库集合不一致');
  assert.ok(distIds.includes('gre'));
});

test('GRE：主文件不含 GRE 词库数据（硬约束 8：分片不内联）', () => {
  const html = readFileSync(join(ROOT, 'dist', 'index.html'), 'utf8');
  // GRE 词表里有 abstruse / obdurate 这类特色词，主文件不该出现它们的词条结构
  assert.ok(!/"abstruse"\s*:\s*\{/.test(html), '主文件疑似内联了 GRE 词库数据');
  // 但词库入口（选择器）应在主文件里
  assert.ok(html.includes("'gre'") || html.includes('"gre"'), '主文件缺 gre 词库接线');
});
