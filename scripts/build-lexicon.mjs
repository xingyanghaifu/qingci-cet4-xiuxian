#!/usr/bin/env node
/**
 * 多词库构建器（v1.8.2 阶段 A）
 *
 * 用法：
 *   node scripts/build-lexicon.mjs                 # 构建全部词库（cet4 + cet6）
 *   node scripts/build-lexicon.mjs --lexicon cet6  # 只构建 CET-6
 *   node scripts/build-lexicon.mjs --list          # 只打印清单，不取数
 *
 * ── 词表来源（与现有 CET-4 同一项目，保证口径一致）──
 *   mahavivo/english-wordlists 的 `CET{4,6}_edited.txt`
 *   三镜像链（任一失败自动切换，日志打印实际命中源）：
 *     jsDelivr → api.github.com → raw.githubusercontent
 *
 * ── 详情来源（与 build-vocab-detail.mjs 同源，保证详情质量一致）──
 *   主源：ruizer/vocabulary-corpus（按词 JSON，MIT）
 *   回退：skywind3000/ECDICT（ecdict.csv，MIT）
 *   兜底：词表自带音标 + 中文释义生成最小条目，**保证全量收录、无空洞**
 *
 * ── 输出 ──
 *   src/data/lexicons/manifest.json                       词库清单（cet4 + cet6）
 *   src/data/lexicons/cet6/vocab-detail/<shard>.json       CET-6 详情分片
 *   单分片 >1.5MB 自动按更长前缀二次拆分；仍 >1.5MB 断言失败退出
 *
 * ── 缓存（断点续跑）──
 *   .cache/lexicons/<lexiconId>/…    词表原文 / corpus 详情 / ecdict.csv
 *
 * CET-4 兼容策略：**不搬动**现有 src/data/vocab-detail/，仅在清单里登记其
 * dataPath，运行时继续按原路径加载 —— 避免一次性大改引发回归。
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CACHE_DIR = path.join(ROOT, '.cache', 'lexicons');
const LEX_DIR = path.join(ROOT, 'src', 'data', 'lexicons');
const MAX_SHARD_BYTES = 1_500_000;
const MANIFEST_VERSION = '1';

// 仓库常量放在 LEXICONS 之前：清单里要引用它们做 sourceUrl（否则撞 TDZ）
const WORDLIST_REPO = 'mahavivo/english-wordlists';
const CORPUS_REPO = 'ruizer/vocabulary-corpus';
const ECDICT_REPO = 'skywind3000/ECDICT';
/** 中学词表与词组增补源（MIT；`json/` 目录为结构化 JSON，含 translations + phrases） */
const KYLEBING_REPO = 'KyleBing/english-vocabulary';

/* ---------------- 词库定义（与 src/services/lexicon.ts 的 FALLBACK_LEXICONS 对齐） ---------------- */

const LEXICONS = {
  cet4: {
    id: 'cet4',
    name: '大学英语四级',
    shortName: 'CET-4',
    wordList: 'CET4_edited.txt',
    description: '四级大纲词汇，现行默认词库。',
    /** CET-4 详情已由 build-vocab-detail.mjs 产出在原位，本脚本不重跑 */
    reuseExistingDetail: true,
    dataPath: 'vocab-detail/',
    detailDir: path.join(ROOT, 'src', 'data', 'vocab-detail'),
    // CET-4 的词源就是模板内联那份，不额外产出 wordlist.json（默认词库零请求）
    wordDir: null,
  },
  cet6: {
    id: 'cet6',
    name: '大学英语六级',
    shortName: 'CET-6',
    wordList: 'CET6_edited.txt',
    description: '六级大纲词汇，与四级部分重叠；进度、错题与复习队列独立。',
    reuseExistingDetail: false,
    dataPath: 'lexicons/cet6/vocab-detail/',
    detailDir: path.join(LEX_DIR, 'cet6', 'vocab-detail'),
    /**
     * 六级 = 四级 ∪ 六级增量（自主裁决，谕令第四项）。
     *
     * 实测：`CET6_edited.txt` 单独解析只有 2219 词，与 `CET4_edited.txt`
     * 重叠 1043 词 —— 该源两个文件**互相去重过**，六级文件只保留增量部分。
     * 但六级大纲本来就包含四级词汇，因此并集才是真正的六级词表：
     *   4540 + 2219 − 1043 = **5716 词**，与谕令「~5500 词」的目标吻合。
     * 并集中已在四级出现的词打 `inCET4: true` 标记（A3 要求）。
     */
    unionWith: ['cet4'],
    markOverlap: 'inCET4',
    wordDir: path.join(LEX_DIR, 'cet6'),
  },
  /**
   * 初中（中考）—— v1.9.0 阶段 A。
   *
   * 词表不再取自 mahavivo 的 `*_edited.txt`（该仓库只有四六级等考纲表），
   * 而是**双源并集**（谕令给的回退链，实测后取舍）：
   *   核心：ECDICT `tag` 含 `zk` → 1603 词，正对教育部 2022 课标的 1600 核心词
   *   拓展：KyleBing/english-vocabulary `1 初中-乱序` 独有 425 词
   *   合计 2028 词，落在验收区间 [1600, 2200]
   * 核心词打 `core: true`，UI 可按「只看课标核心」筛选（三处关键说明第 1 条）。
   *
   * KyleBing 的 JSON 只参与**词表**（拓展词与释义）；详情仍走
   * corpus → ECDICT → 词表兜底这条既有链，实测 corpus 覆盖 2010/2028
   * （自带词组 2010 条），无需再插一个详情源。
   */
  junior: {
    id: 'junior',
    name: '初中词汇（中考）',
    shortName: '初中',
    description: '中考课标核心 1603 词 + 拓展词；进度、错题与复习队列独立。',
    reuseExistingDetail: false,
    dataPath: 'lexicons/junior/vocab-detail/',
    detailDir: path.join(LEX_DIR, 'junior', 'vocab-detail'),
    wordDir: path.join(LEX_DIR, 'junior'),
    tagFilter: 'zk',
    extrasFile: 'json/1-初中-顺序.json',
    markOverlap: 'inCET4',
    overlapWith: ['cet4'],
    sourceUrl: `https://github.com/${ECDICT_REPO}`,
  },
  /**
   * 高中（高考）—— v1.9.0 阶段 B，与初中同一套机制：
   *   核心：ECDICT `tag=gk` 实测 **3677 词**（课标 3500 + 新增词），正对验收区间；
   *   拓展：KyleBing 高中词表独有的部分；
   *   重叠：与 CET-4 重叠的词打 `inCET4`（关键说明第 2 条「完整收录、标记重叠」）。
   */
  senior: {
    id: 'senior',
    name: '高中词汇（高考）',
    shortName: '高中',
    description: '高考课标核心词 + 拓展词；与四级重叠词标 inCET4，进度、错题与复习队列独立。',
    reuseExistingDetail: false,
    dataPath: 'lexicons/senior/vocab-detail/',
    detailDir: path.join(LEX_DIR, 'senior', 'vocab-detail'),
    wordDir: path.join(LEX_DIR, 'senior'),
    tagFilter: 'gk',
    extrasFile: 'json/2-高中-顺序.json',
    markOverlap: 'inCET4',
    overlapWith: ['cet4'],
    sourceUrl: `https://github.com/${ECDICT_REPO}`,
  },
  /**
   * 考研 —— v1.9.1 阶段 E。
   *
   * 数据源：ECDICT `tag=ky`，实测 **4801 词**（本地 62.9 MB 全量扫描核实，
   * 中文释义覆盖 100%），与谕令目标 4801 一致、≥4000 停下条件未触发。
   *
   * 与中学词库同一套机制（tagFilter + inCET4 重叠标记），但**不取 KyleBing
   * 拓展词**：谕令 E1 明确数据源只列 ECDICT tag:ky，验收 E6-2 要求 4801 词。
   */
  kaoyan: {
    id: 'kaoyan',
    name: '全国硕士研究生招生考试英语',
    shortName: '考研',
    description: '考研英语大纲词汇 4801 词（ECDICT tag:ky）；与四级重叠词标 inCET4，进度、错题与复习队列独立。',
    reuseExistingDetail: false,
    dataPath: 'lexicons/kaoyan/vocab-detail/',
    detailDir: path.join(LEX_DIR, 'kaoyan', 'vocab-detail'),
    wordDir: path.join(LEX_DIR, 'kaoyan'),
    tagFilter: 'ky',
    markOverlap: 'inCET4',
    overlapWith: ['cet4'],
    sourceUrl: `https://github.com/${ECDICT_REPO}`,
  },
  /**
   * PRETCO 近似（v1.9.1 阶段 F）。
   *
   * 探活确认公开领域无 PRETCO 词表（docs/probe-pretco.md：五路径全零命中），
   * 而 PRETCO-A 词汇 ≈ CET-4 核心子集 —— 真正差异在**题型**（语法结构 + 英译汉）。
   * 故本词库**不生成任何词库数据**，dataPath 直接指向 CET-4 的 `vocab-detail/`，
   * 进度按 `pretco` 独立作用域存储（复合键仓），与 CET-4 互不污染。
   * `approximation: true` 让 UI 明示「基于 CET-4 词库」，不冒充官方词表。
   */
  pretco: {
    id: 'pretco',
    name: 'PRETCO 高等学校英语应用能力考试（近似）',
    shortName: 'PRETCO',
    description: '基于 CET-4 词库 + PRETCO 特色题型（语法结构 / 英译汉）。',
    // 复用 CET-4 详情分片（`src/data/vocab-detail/`），不重新生成
    reuseExistingDetail: true,
    dataPath: 'vocab-detail/',
    detailDir: path.join(ROOT, 'src', 'data', 'vocab-detail'),
    wordDir: null, // 词源同 CET-4：模板内联，不产出 wordlist.json
    sourceUrl: '近似方案，非官方词表（词库数据复用 CET-4 / MIT）',
    approximation: true,
  },
};

/* ---------------- 镜像链 ---------------- */

const SOURCES = [
  { name: 'jsDelivr', url: (repo, p) => `https://cdn.jsdelivr.net/gh/${repo}@master/${p}` },
  {
    name: 'api.github.com',
    url: (repo, p) => `https://api.github.com/repos/${repo}/contents/${p}`,
    headers: { Accept: 'application/vnd.github.raw' },
  },
  { name: 'raw.githubusercontent', url: (repo, p) => `https://raw.githubusercontent.com/${repo}/master/${p}` },
];
// （WORDLIST_REPO / CORPUS_REPO / ECDICT_REPO / KYLEBING_REPO 已声明在 LEXICONS 之前）

const sourceStats = Object.create(null);
const sourceSeen = new Set();
function logSource(name) {
  sourceStats[name] = (sourceStats[name] || 0) + 1;
  if (!sourceSeen.has(name)) {
    sourceSeen.add(name);
    console.log(`[source] 实际使用：${name}`);
  }
}

async function fetchText(url, headers, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal, redirect: 'follow' });
    if (res.status === 404) return { missing: true };
    if (!res.ok) return { fail: `HTTP ${res.status}` };
    return { text: await res.text() };
  } catch (e) {
    return { fail: e && e.name === 'AbortError' ? 'timeout' : String((e && e.message) || e) };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFile(repo, file, opts = {}) {
  const treat404 = !!opts.treat404AsFailure;
  const timeoutMs = opts.timeoutMs || 20000;
  let lastFail = '';
  for (const src of SOURCES) {
    const r = await fetchText(src.url(repo, file), src.headers, timeoutMs);
    if (r.text !== undefined) {
      logSource(src.name);
      return { text: r.text };
    }
    if (r.missing && !treat404) return { missing: true, failed: false };
    lastFail = r.missing ? `404(${src.name})` : `${r.fail}(${src.name})`;
  }
  return { missing: true, failed: true, reason: lastFail };
}

/* ---------------- 缓存 ---------------- */

function cachePath(lexiconId, rel) {
  return path.join(CACHE_DIR, lexiconId, rel);
}
function readCache(lexiconId, rel) {
  const f = cachePath(lexiconId, rel);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
}
function writeCache(lexiconId, rel, text) {
  const f = cachePath(lexiconId, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text, 'utf8');
}

/* ---------------- 共享 ECDICT（62.9 MB，全项目只存一份） ---------------- */

const SHARED_ECDICT = path.join(CACHE_DIR, '_shared', 'ecdict.csv');

/**
 * 读取 ECDICT 全量 CSV。
 * 中学词表要按 `tag` 筛核心词，详情也要用它兜底，因此改为**跨词库共享一份**——
 * 早先每个词库各存一份，两个新词库会白占 126 MB。
 */
async function sharedEcdict() {
  if (fs.existsSync(SHARED_ECDICT)) return fs.readFileSync(SHARED_ECDICT, 'utf8');
  // 复用任一词库已下载的那份（cet6 构建时下过）
  if (fs.existsSync(CACHE_DIR)) {
    for (const id of fs.readdirSync(CACHE_DIR)) {
      const f = path.join(CACHE_DIR, id, 'ecdict.csv');
      if (fs.existsSync(f)) {
        fs.mkdirSync(path.dirname(SHARED_ECDICT), { recursive: true });
        fs.copyFileSync(f, SHARED_ECDICT);
        console.log(`♻️  复用 ${id} 缓存的 ECDICT → .cache/lexicons/_shared/`);
        return fs.readFileSync(SHARED_ECDICT, 'utf8');
      }
    }
  }
  console.log('⬇️  下载 ECDICT（约 63 MB，存档一次后各词库共用）…');
  const r = await fetchFile(ECDICT_REPO, 'ecdict.csv', { treat404AsFailure: true, timeoutMs: 600000 });
  if (r.missing) {
    console.warn(`   ⚠️ ECDICT 不可达（${r.reason || '三源均失败'}）`);
    return null;
  }
  fs.mkdirSync(path.dirname(SHARED_ECDICT), { recursive: true });
  fs.writeFileSync(SHARED_ECDICT, r.text, 'utf8');
  return r.text;
}

/**
 * 按 ECDICT `tag` 字段筛词（`zk` = 中考、`gk` = 高考、`cet4`/`cet6`…）。
 * 返回词条对象，音标与释义一并带出，省得详情阶段再查一次。
 */
function ecdictRowsByTag(csv, tag) {
  const rows = parseCsv(csv);
  const idx = Object.fromEntries(rows[0].map((h, i) => [h, i]));
  const re = new RegExp(`(^|\\s)${tag}($|\\s)`);
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!re.test(row[idx.tag] || '')) continue;
    const w = row[idx.word];
    if (!w) continue;
    out.push({
      w,
      ipa: row[idx.phonetic] || '',
      zh: clip(row[idx.pos] ? `${row[idx.pos]}.${row[idx.translation] || ''}` : (row[idx.translation] || ''), 200),
      pos: row[idx.pos] || '',
      translation: row[idx.translation] || '',
      definition: row[idx.definition] || '',
    });
  }
  return out;
}

/**
 * 取 KyleBing 结构化 JSON（`word` / `translations[]` / `phrases[]`）。
 * 词组带中文释义，是中高考固定搭配的考点来源。
 */
async function loadExtrasJson(lexiconId, file) {
  const ck = 'extras.json';
  let text = readCache(lexiconId, ck);
  if (text === null) {
    console.log(`📗 [${lexiconId}] 拉取 KyleBing ${file}…`);
    const r = await fetchFile(KYLEBING_REPO, file, { treat404AsFailure: true, timeoutMs: 120000 });
    if (r.missing) {
      console.warn(`   ⚠️ 拓展词表不可达（${r.reason || ''}），本轮只用 tag 核心词`);
      return [];
    }
    text = r.text;
    writeCache(lexiconId, ck, text);
  }
  try {
    const arr = JSON.parse(text);
    return Array.isArray(arr) ? arr : [];
  } catch {
    console.warn('   ⚠️ extras.json 解析失败，忽略');
    return [];
  }
}

/** KyleBing 条目 → 词表行（zh 用其 translations 按词性拼装） */
function extrasToRow(e) {
  const zh = (Array.isArray(e.translations) ? e.translations : [])
    .slice(0, 4)
    .map((t) => (t && t.translation ? `${t.type || ''}${t.type ? '.' : ''}${t.translation}` : ''))
    .filter(Boolean)
    .join('；');
  return { w: String(e.word || '').trim(), ipa: '', zh: clip(zh, 200) };
}

const safeName = (w) => String(w).toLowerCase().replace(/[^a-z0-9._-]/g, '_');

async function pool(items, limit, worker) {
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
}

/* ---------------- 词表解析 ---------------- */

/**
 * 解析 `word [ipa] pos.释义` 格式的词表行。
 * 例：`ambition [æmˈbɪʃən] n. 1. 志向，抱负，雄心 2. 野心`
 *     `a art.一(个)；每一(个)`（无音标）
 * 跳过：空行、纯中文标题行、`(共 N 词)` 这类统计行、以及裸字母分组行。
 */
function parseWordlist(text) {
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^[(（]共\s*\d+\s*词[)）]$/.test(line)) continue; // (共 4615 词)
    if (/^[A-Z]$/.test(line)) continue; // 裸字母分组标题
    if (!/[a-z]/i.test(line)) continue;

    // 第一个 token 是词（允许连字符、撇号、点）
    const m = line.match(/^([A-Za-z][A-Za-z'’.\\/-]*)\s*(.*)$/);
    if (!m) continue;
    const word = m[1];
    let rest = m[2] || '';

    // 音标：[...] 或 /.../；注意词表里 [ ] 可能是 IPA 也可能是释义编号，需谨慎
    let ipa = '';
    const ipaMatch = rest.match(/^\s*[\[]([^\]]*)[\]]/);
    if (ipaMatch && /[ˈˌːʊɪəæɜɔɑɛɒʌθðʃʒŋaeiou]/i.test(ipaMatch[1])) {
      ipa = ipaMatch[1].trim();
      rest = rest.slice(ipaMatch[0].length);
    }
    // 中文释义：去掉开头的词性标记（vt. / n. / a. / ad. / prep. 等及其组合）
    const zh = rest
      .replace(/^\s*(?:[a-zA-Z]{1,5}\.){1,4}\s*/, '')
      .replace(/\s+/g, ' ')
      .trim();
    out.push({ w: word, ipa, zh });
  }
  // 去重（按小写）
  const seen = new Set();
  const uniq = [];
  for (const r of out) {
    const k = r.w.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(r);
  }
  uniq.sort((a, b) => a.w.localeCompare(b.w));
  return uniq;
}

/* ---------------- 详情：corpus → ecdict → 词表兜底 ---------------- */

const clip = (s, n) => {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

function fromCorpus(word, row, lex) {
  const d = {
    word: row.word || word,
    phonetic: {},
    meanings: [],
    collocations: [],
    phrases: [],
    synonyms: [],
    antonyms: [],
    examples: [],
  };
  const ph = row.phonetics || {};
  if (ph.british) d.phonetic.british = clip(ph.british, 48);
  if (ph.american) d.phonetic.american = clip(ph.american, 48);
  if (!d.phonetic.british && lex.ipa) d.phonetic.british = clip(lex.ipa, 48);

  const groups = new Map();
  for (const def of Array.isArray(row.definitions) ? row.definitions : []) {
    if (!def || !def.definition) continue;
    const pos = String(def.partOfSpeech || '').trim();
    if (!groups.has(pos)) {
      if (groups.size >= 4) break;
      groups.set(pos, { partOfSpeech: pos, definitions: [] });
    }
    const g = groups.get(pos);
    if (g.definitions.length >= 4) continue;
    g.definitions.push({ english: clip(def.definition, 200), chinese: clip(def.chineseTranslation, 150) });
  }
  d.meanings = Array.from(groups.values());

  const examples = (Array.isArray(row.examples) ? row.examples : [])
    .filter((e) => e && e.sentence)
    .slice(0, 3)
    .map((e) => ({ sentence: clip(e.sentence, 170), translation: clip(e.translation, 130), source: clip(e.source, 60) }));
  d.examples = examples;
  const m0 = d.meanings[0];
  if (m0 && examples[0]) {
    m0.definitions[0] = m0.definitions[0] || {};
    m0.definitions[0].example = examples[0].sentence;
    m0.definitions[0].exampleSource = examples[0].source;
  }

  const sem = row.semanticRelations || {};
  const cols = [];
  for (const c of Array.isArray(sem.collocations) ? sem.collocations : []) {
    if (!c || !c.pattern) continue;
    const ex = Array.isArray(c.examples) && c.examples.length ? `（${c.examples[0]}）` : '';
    cols.push(clip(c.pattern + ex, 80));
    if (cols.length >= 6) break;
  }
  d.collocations = cols;
  d.phrases = (Array.isArray(row.phrases) ? row.phrases : [])
    .filter((p) => p && p.phrase)
    .slice(0, 6)
    .map((p) => clip(`${p.phrase} — ${p.meaning || ''}`, 80));
  d.synonyms = (Array.isArray(sem.synonyms) ? sem.synonyms : [])
    .map((s) => (typeof s === 'string' ? s : s && s.word))
    .filter(Boolean)
    .slice(0, 8)
    .map((s) => clip(s, 32));
  d.antonyms = (Array.isArray(sem.antonyms) ? sem.antonyms : [])
    .map((s) => (typeof s === 'string' ? s : s && s.word))
    .filter(Boolean)
    .slice(0, 6)
    .map((s) => clip(s, 32));

  const et = row.etymology;
  if (et && typeof et === 'object') {
    const parts = [];
    if (et.origin) parts.push(`源出${et.origin}`);
    const roots = (Array.isArray(et.rootWords) ? et.rootWords : [])
      .slice(0, 4)
      .map((r) => (r && r.root ? `${r.root}${r.meaning ? `（${r.meaning}）` : ''}` : ''))
      .filter(Boolean)
      .join('、');
    if (roots) parts.push(roots);
    if (parts.length) d.etymology = clip(parts.join('；'), 180);
  }
  // 记忆锚点（v1.8.2 阶段 B）：语料用 memoryAids（复数对象），
  // 早期误写成 row.memoryAid（单数），导致 CET-6 的助记全部丢失（覆盖率 0%）。
  // 语料结构与 build-vocab-detail.mjs 保持一致：助记装置 + 视觉联想，用 ｜ 连接。
  const mem = row.memoryAids;
  if (mem && typeof mem === 'object') {
    const parts = [];
    const md = Array.isArray(mem.mnemonicDevices) ? mem.mnemonicDevices[0] : null;
    if (md && md.content) parts.push(clip(md.content, 220));
    if (mem.visualScene && mem.visualScene.description) parts.push(clip(mem.visualScene.description, 160));
    if (parts.length) d.memoryAid = clip(parts.join('｜'), 400);
  }
  if (!d.memoryAid && row.memoryAid) d.memoryAid = clip(row.memoryAid, 180);
  return d;
}

function fromEcdict(word, row, lex) {
  const def = clip(row.definition || '', 400);
  const zh = clip(row.translation || lex.zh || '', 220);
  const d = {
    word,
    phonetic: {},
    meanings: [{ partOfSpeech: row.pos || 'n.', definitions: [{ english: def, chinese: zh }] }],
    collocations: [],
    phrases: [],
    synonyms: [],
    antonyms: [],
    examples: [],
  };
  if (row.phonetic) d.phonetic.british = clip(row.phonetic, 48);
  else if (lex.ipa) d.phonetic.british = clip(lex.ipa, 48);
  return d;
}

function fromWordlistOnly(word, lex) {
  const d = {
    word,
    phonetic: {},
    meanings: [{ partOfSpeech: '', definitions: [{ english: '', chinese: clip(lex.zh, 220) }] }],
    collocations: [],
    phrases: [],
    synonyms: [],
    antonyms: [],
    examples: [],
    offline: true,
  };
  if (lex.ipa) d.phonetic.british = clip(lex.ipa, 48);
  if (!d.meanings[0].definitions[0].chinese) d.meanings = [];
  return d;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/* ---------------- 分片 ---------------- */

/** 详情条目 → 词表条目（运行时背单词/干扰项/模考的词源，字段与内联 lexicon 对齐） */
function shortEntry(w, d) {
  const meanings = d.meanings || [];
  const allDefs = meanings.flatMap((m) => (m.definitions || [])).filter((x) => x && x.chinese);
  const zh = allDefs.map((x) => x.chinese).join('');
  // `short` 是选择题的选项与「中译英」的题干，必须是**一个干净的短义项**。
  // 直接把所有义项拼起来会出现「能力才能或技能权限或职权」这种拼接残影，
  // 因此只取**首个义项的第一小句**，并截到 12 字。
  const first = allDefs.length ? allDefs[0].chinese : '';
  // 这段踩过两个坑，别改回去：
  //  1) 分隔符必须**全角半角都收**：`abbr. （拉）午前` 只切 `（` 不切 `）`
  //     会切出「拉）午前」这种残片；
  //  2) 剥掉词性前缀后要**优先取含中文、长度 ≥2 的小句**，
  //     否则 `abbr. （拉）午前` 的第一个非空片段是「拉」。
  const clauses = first.split(/[；;，,、（）()\/]/).map((s) => s.trim()).filter(Boolean);
  // 必须是 `abbr.`（带点）或 `abbr `（带空格）才算词性前缀，
  // 否则 `n` 会把 `night` 的首字母吃掉（`^(n)\.?\s*` 就是这么错的）。
  const POS_PREFIX = /^(?:abbr|syn|prep|conj|art|pron|num|int|n|v|vt|vi|adj|adv|aux|pl)(?:\.\s*|\s+)/i;
  const CJK = /[一-鿿]/;
  let picked = '';
  let fallback = '';
  for (const c of clauses) {
    const stripped = c.replace(POS_PREFIX, '').trim();
    if (!stripped) continue;
    if (!fallback) fallback = stripped;
    if (CJK.test(stripped) && stripped.length >= 2) { picked = stripped; break; }
  }
  const short = clip(picked || fallback || first, 12);
  const ipa = (d.phonetic && (d.phonetic.british || d.phonetic.american)) || '';
  const e = { w, ipa: clip(ipa, 48), zh: clip(zh, 200), short };
  if (d.core === true) e.core = true;
  return e;
}

/**
 * 从详情分片派生 `wordlist.json`。
 *
 * 为什么需要它：应用里的 `WORDS` 是**内联**的 CET-4 词表，背单词、形近干扰项、
 * 选词填空、模考、词谱、斗法全都吃它。切到别的词库而不换词源，等于换了名字没换内容。
 * 词源数据按约束「不内联进主文件」，因此做成按需取的独立 JSON（~100 KB 级）。
 * 默认 CET-4 仍用内联那份、一个请求都不发。
 */
function writeWordlistFromDetail(L) {
  if (!L.wordDir) return 0; // 显式声明不产出（CET-4 用内联词源）
  const mfPath = path.join(L.detailDir, 'manifest.json');
  if (!fs.existsSync(mfPath)) return 0;
  const mf = JSON.parse(fs.readFileSync(mfPath, 'utf8'));
  const out = [];
  for (const f of new Set(Object.values(mf.files))) {
    const data = JSON.parse(fs.readFileSync(path.join(L.detailDir, f), 'utf8'));
    for (const [w, d] of Object.entries(data)) out.push(shortEntry(w, d || {}));
  }
  out.sort((a, b) => a.w.localeCompare(b.w));
  const dir = L.wordDir || path.dirname(L.detailDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'wordlist.json'), JSON.stringify(out), 'utf8');
  return out.length;
}

const shardNameOf = (prefix) => prefix.replace(/[^a-z0-9#]/gi, '_') + '.json';

function splitShard(prefix, list, out) {
  const entries = Object.create(null);
  for (const it of list) entries[it.word] = it.detail;
  const text = JSON.stringify(entries);
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes <= MAX_SHARD_BYTES) {
    out.push({ prefix, file: shardNameOf(prefix), bytes, count: list.length, text });
    return;
  }
  if (prefix.length >= 4) {
    console.error(`❌ 断言失败：分片 ${prefix} 拆到 ${prefix.length} 字前缀仍为 ${(bytes / 1e6).toFixed(2)} MB > 1.5 MB`);
    process.exit(1);
  }
  const buckets = new Map();
  for (const it of list) {
    const w = it.word.toLowerCase();
    const next = w.slice(0, prefix.length + 1);
    const key = next.length > prefix.length ? next : prefix + '~';
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(it);
  }
  console.log(`   · 分片 "${prefix}" ${(bytes / 1e6).toFixed(2)} MB > 1.5 MB，二次拆分为 ${buckets.size} 片`);
  for (const [k, v] of buckets) splitShard(k, v, out);
}

/* ---------------- 构建单个词库 ---------------- */

async function buildLexicon(key) {
  const L = LEXICONS[key];
  const words = await loadWordlist(key, L);
  if (!words.length) throw new Error(`${key} 词表为空`);

  const lexMap = new Map(words.map((r) => [r.w, r]));
  const details = new Map();
  const usage = { corpus: 0, ecdict: 0, wordlist: 0 };

  // 1) corpus（带缓存；10 并发）
  console.log(`🌐 [${key}] 拉取 vocabulary-corpus 详情（${words.length} 词）…`);
  const missing = [];
  let done = 0;
  await pool(words, 10, async (row) => {
    const word = row.w;
    const ck = `corpus/${safeName(word)}.json`;
    let text = readCache(key, ck);
    if (text === null) {
      const marker = readCache(key, `missing/${safeName(word)}`);
      if (marker !== null && marker.startsWith('404')) { missing.push(word); done++; return; }
      const r = await fetchFile(CORPUS_REPO, `data/${encodeURIComponent(word.toLowerCase())}.json`);
      if (r.missing) {
        writeCache(key, `missing/${safeName(word)}`, r.failed ? `failed:${r.failed}` : '404');
        missing.push(word);
        done++;
        return;
      }
      text = r.text;
      writeCache(key, ck, text);
    }
    done++;
    if (done % 500 === 0) console.log(`   … ${done}/${words.length}（缺 ${missing.length}）`);
    try {
      const parsed = JSON.parse(text);
      const d = fromCorpus(word, parsed, row);
      d.__src = 'corpus';
      details.set(word, d);
      usage.corpus++;
    } catch {
      missing.push(word);
    }
  });
  console.log(`   corpus 覆盖 ${usage.corpus}，缺失 ${missing.length}`);

  // 2) ecdict 回退
  if (missing.length) {
    console.log(`🔁 [${key}] ${missing.length} 词回退 ECDICT…`);
    let csv = readCache(key, 'ecdict.csv');
    if (csv === null) csv = await sharedEcdict(); // 跨词库共享，中学词库不再重复下 63 MB
    if (csv === null) console.warn('   ⚠️ ECDICT 不可达，改用词表兜底');
    if (csv !== null) {
      const rows = parseCsv(csv);
      const idx = Object.fromEntries(rows[0].map((h, i) => [h, i]));
      const lookup = new Map();
      for (const m of missing) {
        const lw = m.toLowerCase();
        lookup.set(lw, m);
        const ap = lw.replace(/_/g, "'");
        if (ap !== lw) lookup.set(ap, m);
        if (!lw.endsWith('.')) lookup.set(lw + '.', m);
        const nodot = lw.replace(/\./g, '');
        if (nodot !== lw) lookup.set(nodot, m);
      }
      const doneSet = new Set();
      for (let i = 1; i < rows.length && doneSet.size < missing.length; i++) {
        const raw = rows[i][idx.word];
        if (!raw) continue;
        const canon = lookup.has(raw) ? lookup.get(raw) : lookup.get(String(raw).toLowerCase());
        if (!canon || doneSet.has(canon)) continue;
        doneSet.add(canon);
        const d = fromEcdict(canon, {
          phonetic: rows[i][idx.phonetic],
          definition: rows[i][idx.definition],
          translation: rows[i][idx.translation],
          pos: rows[i][idx.pos],
        }, lexMap.get(canon) || { w: canon, ipa: '', zh: '' });
        d.__src = 'ecdict';
        details.set(canon, d);
        usage.ecdict++;
      }
    }
    for (const w of missing) {
      if (details.has(w)) continue;
      const d = fromWordlistOnly(w, lexMap.get(w) || { w, ipa: '', zh: '' });
      d.__src = 'wordlist';
      details.set(w, d);
      usage.wordlist++;
    }
  }

  // 3) 组装 + 分片
  const list = words.map((r) => {
    let d = details.get(r.w);
    if (!d) {
      d = fromWordlistOnly(r.w, r);
      d.__src = 'wordlist';
      usage.wordlist++;
    }
    // 课标核心标记（中学词库：ECDICT tag 命中的核心词，UI 可按此筛选）
    if (r.core === true) d.core = true;
    return { word: r.w, detail: d };
  });

  // 重叠标记（A3：与 CET-4 重叠的词打 inCET4，便于 UI 显示「四级已学」与进度复用提示）
  // `overlapWith` 与 `unionWith` 解耦：cet6 要把四级词并进词表（unionWith），
  // 而中学词库只是**打标记**、绝不把四级 4540 词并进来（那会让初中词库变成 6500 词）。
  const overlapKeys = Array.isArray(L.overlapWith) ? L.overlapWith
    : (Array.isArray(L.unionWith) ? L.unionWith : []);
  let overlap = 0;
  if (L.markOverlap && overlapKeys.length) {
    const base = new Set();
    for (const bk of overlapKeys) {
      for (const w of await loadWordlist(bk, LEXICONS[bk])) base.add(w.w.toLowerCase());
    }
    for (const it of list) {
      if (base.has(it.word.toLowerCase())) {
        it.detail.inCET4 = true;
        overlap++;
      }
    }
    console.log(`   标记 inCET4 重叠词 ${overlap} 个`);
  }

  const groups = new Map();
  for (const it of list) {
    const c = it.word.toLowerCase()[0];
    const prefix = c >= 'a' && c <= 'z' ? c : '#';
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix).push(it);
  }
  const shards = [];
  for (const [prefix, l] of groups) splitShard(prefix, l, shards);
  shards.sort((a, b) => a.prefix.localeCompare(b.prefix));

  const bad = shards.filter((s) => s.bytes > MAX_SHARD_BYTES);
  if (bad.length) {
    console.error('❌ 断言失败：分片超限：' + bad.map((s) => s.file).join(', '));
    process.exit(1);
  }

  fs.mkdirSync(L.detailDir, { recursive: true });
  for (const f of fs.readdirSync(L.detailDir)) if (f.endsWith('.json')) fs.unlinkSync(path.join(L.detailDir, f));
  const manifest = { schema: 'qingci-vocab-detail/1', count: list.length, prefixes: [], files: {} };
  for (const s of shards) {
    fs.writeFileSync(path.join(L.detailDir, s.file), s.text, 'utf8');
    manifest.prefixes.push(s.prefix);
    manifest.files[s.prefix] = s.file;
  }
  manifest.prefixes.sort((a, b) => b.length - a.length || a.localeCompare(b.length));
  fs.writeFileSync(path.join(L.detailDir, 'manifest.json'), JSON.stringify(manifest), 'utf8');

  // 词源（运行时背单词/模考取词用，按需加载、不内联）
  const wlCount = writeWordlistFromDetail(L);
  if (wlCount) console.log(`   词源 wordlist.json：${wlCount} 词（${path.relative(ROOT, path.join(L.wordDir, 'wordlist.json'))}）`);

  // 体积报告
  console.log('');
  console.log(`📊 [${key}] 分片体积（raw / gzip）：`);
  let totalRaw = 0;
  let totalGz = 0;
  const pad = (s, n) => String(s).padEnd(n);
  const kb = (n) => (n / 1024).toFixed(1) + ' KB';
  for (const s of shards) {
    const gz = zlib.gzipSync(Buffer.from(s.text, 'utf8')).length;
    totalRaw += s.bytes;
    totalGz += gz;
    console.log(`   ${pad(s.file, 14)} ${pad(kb(s.bytes), 12)} / ${pad(kb(gz), 12)}  ${String(s.count).padStart(4)} 词  "${s.prefix}"`);
  }
  console.log(`   ${pad('合计', 14)} ${pad(kb(totalRaw), 12)} / ${pad(kb(totalGz), 12)}  ${shards.length} 片`);
  console.log(`   最大分片 ${kb(Math.max(...shards.map((s) => s.bytes)))} ≤ 1.5 MB ✅`);
  console.log(`   来源：corpus ${usage.corpus} · ecdict ${usage.ecdict} · 词表兜底 ${usage.wordlist}`);
  console.log('');

  return { key, count: list.length, shards: shards.length, raw: totalRaw, gz: totalGz, overlap };
}

async function loadWordlist(key, L) {
  // 中学词库走「ECDICT tag 核心词 ∪ KyleBing 拓展词」，不取 txt 词表
  if (L.tagFilter) return loadTagWordlist(key, L);

  let text = readCache(key, 'wordlist.txt');
  if (text === null) {
    console.log(`📖 [${key}] 拉取词表 ${L.wordList}（jsDelivr → api.github → raw）…`);
    const r = await fetchFile(WORDLIST_REPO, L.wordList);
    if (r.missing) {
      throw new Error(`${key} 词表不可达：${r.reason || '三源均失败'}`);
    }
    text = r.text;
    writeCache(key, 'wordlist.txt', text);
  }
  let words = parseWordlist(text);
  console.log(`   自身解析 ${words.length} 词`);

  // 六级并入四级（该源的两份词表互相去重过，单取六级只有增量部分）
  if (Array.isArray(L.unionWith) && L.unionWith.length) {
    const own = new Set(words.map((w) => w.w.toLowerCase()));
    for (const baseKey of L.unionWith) {
      const baseWords = await loadWordlist(baseKey, LEXICONS[baseKey]);
      let added = 0;
      for (const w of baseWords) {
        if (own.has(w.w.toLowerCase())) continue;
        own.add(w.w.toLowerCase());
        words.push(w);
        added++;
      }
      console.log(`   并入 ${LEXICONS[baseKey].shortName}：新增 ${added} 词`);
    }
    words.sort((a, b) => a.w.localeCompare(b.w));
  }
  console.log(`   最终 ${words.length} 词`);
  return words;
}

/**
 * 中学词库词表：ECDICT `tag` 核心词 ∪ KyleBing 拓展词。
 *
 * 为什么不直接用某个 txt 词表：
 *   · mahavivo 只有四六级等考纲表（`中考英语词汇表.txt` 有 1887 词但音标行混排、
 *     括号词形如 `a (an)` 需特判）；
 *   · ECDICT 的 `tag` 字段本身就是考纲标记，实测 `zk` 恰好 1603 词
 *     —— 正对教育部 2022 课标 1600 核心词，且自带音标与释义；
 *   · KyleBing 的 JSON 补上拓展词（初中独有 425 词），并作为详情增补源。
 *
 * 结果按 `core` 区分课标核心与拓展，UI 可筛选。
 */
async function loadTagWordlist(key, L) {
  const ck = 'wordlist-tag.json';
  const cached = readCache(key, ck);
  if (cached !== null) {
    try {
      const words = JSON.parse(cached);
      console.log(`📖 [${key}] 复用已合成词表缓存：${words.length} 词（核心 ${words.filter((w) => w.core).length}）`);
      return words;
    } catch { /* 缓存坏了就重新合成 */ }
  }

  const csv = await sharedEcdict();
  if (!csv) throw new Error(`${key} 需要按 ECDICT tag=${L.tagFilter} 筛核心词，但 ECDICT 不可达`);
  const core = ecdictRowsByTag(csv, L.tagFilter).map((r) => ({ w: r.w, ipa: r.ipa, zh: r.zh, core: true }));
  console.log(`🎯 [${key}] ECDICT tag=${L.tagFilter} 核心词 ${core.length} 词`);

  const byKey = new Map(core.map((r) => [r.w.toLowerCase(), r]));
  if (L.extrasFile) {
    const extras = await loadExtrasJson(key, L.extrasFile);
    let added = 0;
    for (const e of extras) {
      const r = extrasToRow(e);
      if (!r.w || byKey.has(r.w.toLowerCase())) continue;
      byKey.set(r.w.toLowerCase(), { w: r.w, ipa: r.ipa, zh: r.zh, core: false });
      added++;
    }
    console.log(`   ∪ KyleBing 拓展（独有）${added} 词`);
  }

  const words = Array.from(byKey.values()).sort((a, b) => a.w.localeCompare(b.w));
  console.log(`   合计 ${words.length} 词（核心 ${words.filter((w) => w.core).length} / 拓展 ${words.filter((w) => !w.core).length}）`);
  writeCache(key, ck, JSON.stringify(words));
  return words;
}

/* ---------------- 清单 ---------------- */

function writeManifest(built) {
  // 顺序即选择器卡片顺序（C1 规格：初中 → 高中 → CET-4 → CET-6 → 灰显词库）
  const order = ['junior', 'senior', 'cet4', 'cet6', 'kaoyan', 'pretco'];
  const lexicons = order.map((id) => {
    const L = LEXICONS[id];
    const b = built.find((x) => x.key === id);
    let wordCount = b ? b.count : 0;
    if (!wordCount && fs.existsSync(path.join(L.detailDir, 'manifest.json'))) {
      try {
        wordCount = JSON.parse(fs.readFileSync(path.join(L.detailDir, 'manifest.json'), 'utf8')).count || 0;
      } catch { /* 读取失败按 0 计 */ }
    }
    return {
      id,
      name: L.name,
      shortName: L.shortName,
      wordCount,
      description: L.description,
      sourceUrl: L.sourceUrl || `https://github.com/${WORDLIST_REPO}`,
      sourceLicense: 'MIT',
      enabled: L.enabled !== false,
      dataPath: L.dataPath,
      wordListPath: L.dataPath.startsWith('lexicons/') ? L.dataPath.replace('vocab-detail/', '') : '',
      // 近似词库（PRETCO）：词库数据复用 CET-4，UI 据此标注「基于 CET-4 词库」
      ...(L.approximation ? { approximation: true } : {}),
    };
  });
  /* 未上线词库：声明但关闭，选择器里灰显（kaoyan 已于 v1.9.1 上线，移出此列）。
     PRETCO-A/B 占位已撤 —— 阶段 F 改用单张 pretco 近似卡（复用 CET-4 词库数据，
     不重复生成分片），探活结论见 docs/probe-pretco.md。 */
  const PLACEHOLDERS = [
    { id: 'ielts', name: '雅思词汇', shortName: 'IELTS', desc: '规划中：尚未构建词表。' },
    { id: 'toefl', name: '托福词汇', shortName: 'TOEFL', desc: '规划中：尚未构建词表。' },
  ];
  for (const p of PLACEHOLDERS) {
    lexicons.push({
      id: p.id,
      name: p.name,
      shortName: p.shortName,
      wordCount: 0,
      description: p.desc,
      sourceUrl: '',
      sourceLicense: '',
      enabled: false,
      dataPath: `lexicons/${p.id}/vocab-detail/`,
      wordListPath: `lexicons/${p.id}/`,
    });
  }
  fs.mkdirSync(LEX_DIR, { recursive: true });
  const manifest = { version: MANIFEST_VERSION, lexicons, defaultLexiconId: 'cet4' };
  fs.writeFileSync(path.join(LEX_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  return manifest;
}

/* ---------------- 主流程 ---------------- */

async function main() {
  const argv = process.argv.slice(2);
  const onlyIdx = argv.indexOf('--lexicon');
  const keys = onlyIdx >= 0 && argv[onlyIdx + 1] ? [argv[onlyIdx + 1]] : Object.keys(LEXICONS);

  for (const k of keys) {
    if (!LEXICONS[k]) {
      console.error(`❌ 未知词库：${k}（可选：${Object.keys(LEXICONS).join(' / ')}）`);
      process.exit(1);
    }
  }

  if (argv.includes('--list')) {
    const manifest = writeManifest([]);
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }

  // 只从既有详情分片重派生词源（纯本地、不联网）
  if (argv.includes('--wordlist')) {
    for (const k of keys) {
      const n = writeWordlistFromDetail(LEXICONS[k]);
      console.log(n ? `✅ [${k}] wordlist.json：${n} 词` : `⏭️  [${k}] 无需产出（未声明 wordDir 或详情缺失）`);
    }
    return;
  }

  const built = [];
  for (const k of keys) {
    if (LEXICONS[k].reuseExistingDetail) {
      // CET-4：详情已就位，只读词数
      let count = 0;
      const mf = path.join(LEXICONS[k].detailDir, 'manifest.json');
      if (fs.existsSync(mf)) {
        try { count = JSON.parse(fs.readFileSync(mf, 'utf8')).count || 0; } catch { /* ignore */ }
      }
      console.log(`ℹ️  [${k}] 复用既有详情分片（${count} 词），不重新生成`);
      built.push({ key: k, count, shards: fs.readdirSync(LEXICONS[k].detailDir).filter((f) => f.endsWith('.json')).length });
      continue;
    }
    built.push(await buildLexicon(k));
  }

  const manifest = writeManifest(built);
  console.log('✅ 词库清单已写入 src/data/lexicons/manifest.json');
  for (const l of manifest.lexicons.filter((x) => x.enabled)) {
    console.log(`   ${l.shortName.padEnd(6)} ${String(l.wordCount).padStart(6)} 词  ${l.dataPath}`);
  }
  if (Object.keys(sourceStats).length) {
    console.log(`   镜像命中：${Object.entries(sourceStats).map(([k, v]) => `${k}×${v}`).join(' · ')}`);
  }
}

main().catch((e) => {
  console.error('❌ 构建失败：', e);
  process.exit(1);
});