#!/usr/bin/env node
/**
 * 词库详情分片生成器（任务 D / 数据源方案 1：离线可用）
 *
 * ── 数据源优先级（写死，任一源失败自动切换下一个，并在日志打印实际使用的源）──
 *   1. jsDelivr            https://cdn.jsdelivr.net/gh/<repo>@master/<path>
 *   2. api.github.com      https://api.github.com/repos/<repo>/contents/<path>
 *                          （Accept: application/vnd.github.raw，返回文件原文）
 *   3. raw.githubusercontent https://raw.githubusercontent.com/<repo>/master/<path>
 *   规则：HTTP 404 视为“三镜像同源、内容不存在”，直接判定缺失不再逐源重试；
 *         网络错误 / 5xx / 超时 / 403 / 429 视为“源失败”，自动切换下一源。
 *
 * ── 输入（严格白名单，严禁整库打包）──
 *   src/index.template.html 内联 lexicon（4540 词）——只取这些词的详情。
 *
 * ── 主源 / 回退（均为 MIT 许可）──
 *   主源：ruizer/vocabulary-corpus（按词 JSON：音标/词性释义/例句/搭配/短语/
 *         同义反义/词源词根/记忆辅助/语域场景）
 *   回退：skywind3000/ECDICT（ecdict.csv，仅补白名单中主源缺失的词）
 *   兜底：两源皆缺时用 lexicon 自带 ipa + 中文释义生成最小条目，保证 4540 全覆盖。
 *
 * ── 输出 ──
 *   src/data/vocab-detail/<shard>.json   按首字母分片（>1.5MB 自动按更长前缀二次拆分）
 *   src/data/vocab-detail/manifest.json  分片清单（运行时按最长前缀匹配）
 *   单分片 >1.5MB 且无法再拆 → 断言失败退出（exit 1）。
 *   缓存：.cache/vocab-detail/（按词缓存 + ECDICT 全量缓存，重跑不重复下载）
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TEMPLATE = path.join(ROOT, 'src', 'index.template.html');
const CACHE_DIR = path.join(ROOT, '.cache', 'vocab-detail');
const OUT_DIR = path.join(ROOT, 'src', 'data', 'vocab-detail');
const MAX_SHARD_BYTES = 1_500_000; // 任务要求：单分片 >1.5MB 必须继续拆分并断言

/** 数据源优先级（写死，勿调整顺序） */
const SOURCES = [
  { name: 'jsDelivr', url: (repo, p) => `https://cdn.jsdelivr.net/gh/${repo}@master/${p}` },
  {
    name: 'api.github.com',
    url: (repo, p) => `https://api.github.com/repos/${repo}/contents/${p}`,
    headers: { Accept: 'application/vnd.github.raw' },
  },
  { name: 'raw.githubusercontent', url: (repo, p) => `https://raw.githubusercontent.com/${repo}/master/${p}` },
];
const CORPUS_REPO = 'ruizer/vocabulary-corpus';
const ECDICT_REPO = 'skywind3000/ECDICT';
const SCHEMA = 'qingci-vocab-detail/1';

const sourceStats = Object.create(null);
const sourceFirstLog = new Set();
const usage = { corpus: 0, ecdict: 0, lexicon: 0 };

const clip = (s, n) => {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

function logSource(name) {
  sourceStats[name] = (sourceStats[name] || 0) + 1;
  if (!sourceFirstLog.has(name)) {
    sourceFirstLog.add(name);
    console.log(`[source] 实际使用：${name}（该源首次命中，后续聚合统计）`);
  }
}

async function fetchText(url, headers, timeoutMs = 15000) {
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

/**
 * 链式取文件：按 SOURCES 优先级尝试；失败自动切下一个；
 * treat404AsFailure=true 用于超大文件（jsDelivr 对 >20MB 的 gh 文件回 404/403，
 * 此时 404 也视为源失败继续切换，例如 ECDICT 的 66MB CSV）。
 */
async function fetchFile(repo, file, opts = {}) {
  const treat404 = !!opts.treat404AsFailure;
  const timeoutMs = opts.timeoutMs || 15000;
  for (const src of SOURCES) {
    const r = await fetchText(src.url(repo, file), src.headers, timeoutMs);
    if (r.text !== undefined) {
      logSource(src.name);
      return { text: r.text };
    }
    if (r.missing && !treat404) return { missing: true, failed: false };
    // 其余（网络错误/5xx/403/429/treat404 下的 404）→ 切换下一源
  }
  return { missing: true, failed: true };
}

async function readCache(key) {
  const f = path.join(CACHE_DIR, key);
  if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8');
  return null;
}
function writeCache(key, text) {
  fs.mkdirSync(path.dirname(path.join(CACHE_DIR, key)), { recursive: true });
  fs.writeFileSync(path.join(CACHE_DIR, key), text, 'utf8');
}

/** 简单并发池 */
/** 缓存文件名消毒：词里的 . ' 等字符在部分文件系统上不安全 */
const safeName = (w) => w.toLowerCase().replace(/[^a-z0-9._-]/g, '_');async function pool(items, limit, worker) {
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
}

/** 模板内联 lexicon → 4540 词白名单 */
function readLexicon() {
  const html = fs.readFileSync(TEMPLATE, 'utf8');
  const m = html.match(/<script id="lexicon" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('模板缺少 <script id="lexicon">');
  const rows = JSON.parse(m[1]);
  if (!Array.isArray(rows) || rows.length !== 4540) {
    throw new Error(`词库条数异常：期望 4540，实际 ${rows && rows.length}`);
  }
  return rows;
}

/* ---------------- 主源：vocabulary-corpus 按词 JSON ---------------- */

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
  if (!d.phonetic.british) d.phonetic.british = clip(lex.ipa, 48);

  // 词性与释义：按 partOfSpeech 分组（≤4 组，每组 ≤4 条）
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
    g.definitions.push({
      english: clip(def.definition, 200),
      chinese: clip(def.chineseTranslation, 150),
    });
  }
  d.meanings = Array.from(groups.values());

  // 例句：≤3 条（含出处标注，按语料自带 source 如实标注，不伪造年份）
  const examples = (Array.isArray(row.examples) ? row.examples : [])
    .filter((e) => e && e.sentence)
    .slice(0, 3)
    .map((e) => ({
      sentence: clip(e.sentence, 170),
      translation: clip(e.translation, 130),
      source: clip(e.source, 60),
    }));
  d.examples = examples;
  if (examples[0] && d.meanings[0] && d.meanings[0].definitions[0]) {
    d.meanings[0].definitions[0].example = examples[0].sentence;
    d.meanings[0].definitions[0].exampleSource = examples[0].source;
  }
  if (examples[1] && d.meanings[0] && d.meanings[0].definitions[1]) {
    d.meanings[0].definitions[1].example = examples[1].sentence;
    d.meanings[0].definitions[1].exampleSource = examples[1].source;
  }

  // 搭配：semanticRelations.collocations（pattern + 例词）+ 句法模式
  const sem = row.semanticRelations || {};
  const cols = [];
  for (const c of Array.isArray(sem.collocations) ? sem.collocations : []) {
    if (!c || !c.pattern) continue;
    const ex = Array.isArray(c.examples) && c.examples.length ? `（${c.examples[0]}）` : '';
    cols.push(clip(c.pattern + ex, 80));
    if (cols.length >= 6) break;
  }
  const syn = (Array.isArray(sem.synonyms) ? sem.synonyms : [])
    .map((s) => (typeof s === 'string' ? s : s && s.word))
    .filter(Boolean);
  if (cols.length < 8) {
    const gram = row.grammaticalInfo || {};
    for (const p of Array.isArray(gram.syntacticPatterns) ? gram.syntacticPatterns : []) {
      if (!p || !p.pattern) continue;
      cols.push(clip(p.pattern + (p.description ? `（${p.description}）` : ''), 80));
      if (cols.length >= 8) break;
    }
  }
  d.collocations = cols;
  // 同步到结构化槽位：句法模式里形如 “A of B”、“A to B”的结构短语
  const gram2 = row.grammaticalInfo || {};
  d.phrases = (Array.isArray(row.phrases) ? row.phrases : [])
    .filter((p) => p && p.phrase)
    .slice(0, 6)
    .map((p) => clip(`${p.phrase} — ${p.meaning || ''}`, 80));

  d.synonyms = syn.slice(0, 8).map((s) => clip(s, 32));
  d.antonyms = (Array.isArray(sem.antonyms) ? sem.antonyms : [])
    .map((s) => (typeof s === 'string' ? s : s && s.word))
    .filter(Boolean)
    .slice(0, 6)
    .map((s) => clip(s, 32));

  // 词源 + 词根词缀
  const et = row.etymology;
  if (et && typeof et === 'object') {
    const roots = (Array.isArray(et.rootWords) ? et.rootWords : [])
      .slice(0, 4)
      .map((r) => (r && r.root ? `${r.root}${r.meaning ? `（${r.meaning}）` : ''}` : ''))
      .filter(Boolean)
      .join('、');
    const parts = [];
    if (et.origin) parts.push(`源出${et.origin}`);
    if (roots) parts.push(`词根词缀：${roots}`);
    if (et.historicalDevelopment) parts.push(clip(et.historicalDevelopment, 260));
    if (et.firstKnownUse) parts.push(`首见于${et.firstKnownUse}`);
    if (parts.length) d.etymology = clip(parts.join('；'), 700);
  }

  // 记忆辅助：助记装置 + 视觉联想
  const mem = row.memoryAids;
  if (mem && typeof mem === 'object') {
    const parts = [];
    const md = Array.isArray(mem.mnemonicDevices) ? mem.mnemonicDevices[0] : null;
    if (md && md.content) parts.push(clip(md.content, 220));
    if (mem.visualScene && mem.visualScene.description) parts.push(clip(mem.visualScene.description, 160));
    if (parts.length) d.memoryAid = clip(parts.join('｜'), 400);
  }

  // 用法场景：语料领域 + 语域
  const meta = row.metadata || {};
  const def0 = (Array.isArray(row.definitions) ? row.definitions : [])[0] || {};
  const usages = [];
  if (Array.isArray(meta.domains) && meta.domains.length) usages.push(`领域：${meta.domains.slice(0, 4).join('、')}`);
  if (def0.register) usages.push(`语域：${def0.register}`);
  if (Array.isArray(meta.tags) && meta.tags.length) usages.push(`场景：${meta.tags.slice(0, 4).join('、')}`);
  if (usages.length) d.usage = clip(usages.join('；'), 260);

  if (gram2.irregularForms && typeof gram2.irregularForms === 'object') {
    const f = gram2.irregularForms;
    const forms = [f.pastTense && `过去式 ${f.pastTense}`, f.pastParticiple && `过去分词 ${f.pastParticiple}`, f.presentParticiple && `现在分词 ${f.presentParticiple}`, f.plural && `复数 ${f.plural}`].filter(Boolean);
    if (forms.length) d.forms = clip(forms.join('、'), 120);
  }
  return d;
}

/* ---------------- 回退：ECDICT ---------------- */

const POS_MAP = [
  [/^(n|n\.)/, 'n.'], [/^(vt|vi|v)\./, 'v.'], [/^(a|adj)\./, 'adj.'], [/^(ad|adv)\./, 'adv.'],
  [/^prep\./, 'prep.'], [/^conj\./, 'conj.'], [/^pron\./, 'pron.'], [/^art\./, 'art.'],
  [/^num\./, 'num.'], [/^(int|interj)\./, 'int.'], [/^suf\./, 'suf.'], [/^pref\./, 'pref.'],
];
function guessPos(firstZh) {
  const t = String(firstZh || '').trim();
  for (const [re, pos] of POS_MAP) if (re.test(t)) return pos;
  return '';
}
function fromEcdict(word, row, lex) {
  const d = {
    word,
    phonetic: {},
    meanings: [],
    collocations: [],
    phrases: [],
    synonyms: [],
    antonyms: [],
    examples: [],
  };
  d.phonetic.british = clip(lex.ipa || row.phonetic, 48);
  const enLines = String(row.definition || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const zhLines = String(row.translation || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const pos = String(row.pos || '').trim() || guessPos(zhLines[0]);
  let defs = [];
  if (enLines.length) {
    defs = enLines.slice(0, 5).map((en, i) => ({
      english: clip(en, 200),
      chinese: clip(zhLines[i] || zhLines.join('；'), 150),
    }));
  } else {
    defs = zhLines.slice(0, 5).map((zh) => ({ english: '', chinese: clip(zh, 150) }));
  }
  if (defs.length) d.meanings = [{ partOfSpeech: pos, definitions: defs }];
  if (zhLines[0]) d.usage = clip(`词库标注：${zhLines[0]}`, 200);
  return d;
}

function fromLexiconOnly(lex) {
  return {
    word: lex.w,
    phonetic: { british: clip(lex.ipa, 48) },
    meanings: lex.zh ? [{ partOfSpeech: guessPos(lex.zh) || '', definitions: [{ english: '', chinese: clip(lex.zh, 150) }] }] : [],
    collocations: [],
    phrases: [],
    synonyms: [],
    antonyms: [],
    examples: [],
    offline: true,
  };
}

/* ---------------- CSV（ECDICT） ---------------- */

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

function shardNameOf(prefix) {
  return prefix.replace(/[^a-z0-9#]/gi, '_') + '.json';
}
function serializeShard(entries) {
  return JSON.stringify(entries);
}
/** 超过 1.5MB 的分片按更长前缀继续拆分；无法再拆则断言失败 */
function splitShard(prefix, list, out) {
  const entries = Object.create(null);
  for (const it of list) entries[it.word] = it.detail;
  const text = serializeShard(entries);
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes <= MAX_SHARD_BYTES) {
    const file = shardNameOf(prefix);
    out.push({ prefix, file, bytes, count: list.length, text });
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
  console.log(`   · 分片 "${prefix}" ${(bytes / 1e6).toFixed(2)} MB > 1.5 MB，按更长前缀二次拆分为 ${buckets.size} 片`);
  for (const [k, v] of buckets) splitShard(k, v, out);
}

/* ---------------- 主流程 ---------------- */

async function main() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log('📖 读取模板 lexicon 白名单…');
  const lexicon = readLexicon();
  const words = lexicon.map((r) => r.w);
  const lexMap = new Map(lexicon.map((r) => [r.w, r]));
  console.log(`   白名单 ${words.length} 词（只打包这些词，严禁整库）`);

  // 1) 主源：vocabulary-corpus（带 .cache 缓存）
  console.log('🌐 拉取主源 vocabulary-corpus（jsDelivr → api.github → raw）…');
  const missing = [];
  let done = 0;
  await pool(words, 10, async (word) => {
    const key = `corpus/${safeName(word)}.json`;
    let text = await readCache(key);
    if (text === null) {
      const marker = `missing/${safeName(word)}`;
      const marked = await readCache(marker);
      // 只有明确的 404（内容不存在）才视为确定缺失；failed 标记允许重跑重试
      if (marked !== null && marked.startsWith('404')) {
        missing.push(word);
        done++;
        return;
      }
      const r = await fetchFile(CORPUS_REPO, `data/${encodeURIComponent(word.toLowerCase())}.json`);
      if (r.missing) {
        writeCache(marker, r.failed ? `failed:${r.failed}` : '404');
        missing.push(word);
        done++;
        if (done % 500 === 0) console.log(`   … ${done}/${words.length}（主源缺失 ${missing.length}）`);
        return;
      }
      text = r.text;
      writeCache(key, text);
    }
    done++;
    if (done % 500 === 0) console.log(`   … ${done}/${words.length}（主源缺失 ${missing.length}）`);
    try {
      const row = JSON.parse(text);
      usage.corpus++;
      const detail = fromCorpus(word, row, lexMap.get(word));
      detail.__src = 'corpus';
      CACHE_DETAILS.set(word, detail);
    } catch {
      missing.push(word);
    }
  });
  console.log(`   主源完成：覆盖 ${usage.corpus}，缺失 ${missing.length}`);

  // 2) 回退：ECDICT（仅缺失词；全量 CSV 带缓存）
  if (missing.length) {
    console.log(`🔁 ${missing.length} 词回退 ECDICT（同一数据源优先级链）…`);
    let csv = await readCache('ecdict.csv');
    if (csv === null) {
      const r = await fetchFile(ECDICT_REPO, 'ecdict.csv', { treat404AsFailure: true, timeoutMs: 600000 });
      if (r.missing) {
        console.warn('   ⚠️ ECDICT 三源均失败，改用 lexicon 兜底：' + (r.failed || ''));
      } else {
        csv = r.text;
        writeCache('ecdict.csv', csv);
      }
    }
    if (csv !== null) {
      const rows = parseCsv(csv);
      const header = rows[0];
      const idx = Object.fromEntries(header.map((h, i) => [h, i]));
      // 变体映射：lexicon 词形 → ECDICT 可能词形（o_clock ↔ o'clock，忽略大小写）
      const lookup = new Map();
      for (const m of missing) {
        const lw = m.toLowerCase();
        lookup.set(lw, m);
        const ap = lw.replace(/_/g, "'");
        const cur = lw.replace(/_/g, '\u2019');
        if (ap !== lw) lookup.set(ap, m);
        if (cur !== lw) lookup.set(cur, m);
        if (!lw.endsWith('.')) lookup.set(lw + '.', m);
        const nodot = lw.replace(/\./g, '');
        if (nodot !== lw) lookup.set(nodot, m);
      }
      const done = new Set();
      let hit = 0;
      for (let i = 1; i < rows.length && done.size < missing.length; i++) {
        const raw = rows[i][idx.word];
        if (!raw) continue;
        const canon = lookup.has(raw) ? lookup.get(raw) : lookup.get(raw.toLowerCase());
        if (!canon || done.has(canon)) continue;
        done.add(canon);
        hit++;
        usage.ecdict++;
        const d = fromEcdict(canon, {
          phonetic: rows[i][idx.phonetic],
          definition: rows[i][idx.definition],
          translation: rows[i][idx.translation],
          pos: rows[i][idx.pos],
        }, lexMap.get(canon) || { w: canon, ipa: '', zh: '' });
        d.__src = 'ecdict';
        d.word = canon;
        CACHE_DETAILS.set(canon, d);
      }
      const uncovered = missing.filter((m) => !done.has(m));
      console.log(`   ECDICT 命中 ${hit}，仍未覆盖 ${uncovered.length}`);
      for (const w of uncovered) {
        usage.lexicon++;
        const d = fromLexiconOnly(lexMap.get(w) || { w, ipa: '', zh: '' });
        d.__src = 'lexicon';
        CACHE_DETAILS.set(w, d);
      }
    } else {
      for (const w of missing) {
        usage.lexicon++;
        const d = fromLexiconOnly(lexMap.get(w) || { w, ipa: '', zh: '' });
        d.__src = 'lexicon';
        CACHE_DETAILS.set(w, d);
      }
    }
  }

  // 3) 组装白名单全量详情
  const list = [];
  for (const w of words) {
    const d = CACHE_DETAILS.get(w);
    if (!d) { usage.lexicon++; const fb = fromLexiconOnly(lexMap.get(w)); fb.__src = 'lexicon'; CACHE_DETAILS.set(w, fb); list.push({ word: w, detail: fb }); continue; }
    list.push({ word: w, detail: d });
  }
  if (list.length !== 4540) {
    console.error(`❌ 断言失败：详情条数 ${list.length} ≠ 4540`);
    process.exit(1);
  }

  // 4) 按首字母分片（>1.5MB 自动二次拆分）
  console.log('🧩 分片（首字母，>1.5MB 自动二次拆分）…');
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

  // 5) 断言：全部分片 ≤1.5MB
  const bad = shards.filter((s) => s.bytes > MAX_SHARD_BYTES);
  if (bad.length) {
    console.error('❌ 断言失败：以下分片仍 >1.5MB：' + bad.map((s) => s.file).join(', '));
    process.exit(1);
  }

  // 6) 写出
  for (const f of fs.readdirSync(OUT_DIR)) if (f.endsWith('.json')) fs.unlinkSync(path.join(OUT_DIR, f));
  const manifest = { schema: SCHEMA, count: list.length, prefixes: [], files: {} };
  for (const s of shards) {
    fs.writeFileSync(path.join(OUT_DIR, s.file), s.text, 'utf8');
    manifest.prefixes.push(s.prefix);
    manifest.files[s.prefix] = s.file;
  }
  manifest.prefixes.sort((a, b) => b.length - a.length || a.localeCompare(b.length));
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest), 'utf8');

  // 7) 分片体积报告（raw + gzip 双列）
  console.log('');
  console.log('📊 分片体积报告（raw / gzip）：');
  let totalRaw = 0;
  let totalGz = 0;
  const pad = (s, n) => String(s).padEnd(n);
  const kb = (n) => (n / 1024).toFixed(1) + ' KB';
  for (const s of shards) {
    const gz = zlib.gzipSync(Buffer.from(s.text, 'utf8')).length;
    totalRaw += s.bytes;
    totalGz += gz;
    console.log(`   ${pad(s.file, 14)} ${pad(kb(s.bytes), 12)} / ${pad(kb(gz), 12)}  ${s.count} 词  前缀 "${s.prefix}"`);
  }
  console.log(`   ${pad('合计', 14)} ${pad(kb(totalRaw), 12)} / ${pad(kb(totalGz), 12)}  分片 ${shards.length} 个`);
  const maxShard = Math.max(...shards.map((s) => s.bytes));
  console.log(`   最大分片 ${kb(maxShard)} ≤ 1.5 MB ✅（断言通过）`);
  console.log('');
  console.log(`✅ 生成完成：src/data/vocab-detail/（${list.length} 词）`);
  console.log(`   来源：corpus ${usage.corpus} · ecdict ${usage.ecdict} · lexicon 兜底 ${usage.lexicon}`);
  console.log(`   数据源命中统计：${Object.entries(sourceStats).map(([k, v]) => `${k}×${v}`).join(' · ')}`);
}

const CACHE_DETAILS = new Map();
main().catch((e) => {
  console.error('❌ 生成失败：', e);
  process.exit(1);
});
