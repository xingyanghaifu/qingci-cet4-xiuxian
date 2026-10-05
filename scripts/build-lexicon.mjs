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
const WORDLIST_REPO = 'mahavivo/english-wordlists';
const CORPUS_REPO = 'ruizer/vocabulary-corpus';
const ECDICT_REPO = 'skywind3000/ECDICT';

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
    if (csv === null) {
      const r = await fetchFile(ECDICT_REPO, 'ecdict.csv', { treat404AsFailure: true, timeoutMs: 600000 });
      if (r.missing) {
        console.warn(`   ⚠️ ECDICT 不可达（${r.reason || ''}），改用词表兜底`);
      } else {
        csv = r.text;
        writeCache(key, 'ecdict.csv', csv);
      }
    }
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
    return { word: r.w, detail: d };
  });

  // 重叠标记（A3：与 CET-4 重叠的词打 inCET4，便于 UI 显示「四级已学」与进度复用提示）
  let overlap = 0;
  if (L.markOverlap && Array.isArray(L.unionWith)) {
    const base = new Set();
    for (const bk of L.unionWith) {
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

/* ---------------- 清单 ---------------- */

function writeManifest(built) {
  const order = ['cet4', 'cet6'];
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
      sourceUrl: `https://github.com/${WORDLIST_REPO}`,
      sourceLicense: 'MIT',
      enabled: true,
      dataPath: L.dataPath,
      wordListPath: L.dataPath.startsWith('lexicons/') ? L.dataPath.replace('vocab-detail/', '') : '',
    };
  });
  // 未上线词库：声明但关闭，选择器里灰显
  for (const id of ['kaoyan', 'ielts', 'toefl']) {
    lexicons.push({
      id,
      name: id === 'kaoyan' ? '考研词汇' : id === 'ielts' ? '雅思词汇' : '托福词汇',
      shortName: id === 'kaoyan' ? '考研' : id === 'ielts' ? 'IELTS' : 'TOEFL',
      wordCount: 0,
      description: '规划中：尚未构建词表。',
      sourceUrl: '',
      sourceLicense: '',
      enabled: false,
      dataPath: `lexicons/${id}/vocab-detail/`,
      wordListPath: `lexicons/${id}/`,
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