#!/usr/bin/env node
/**
 * 记忆锚点构建器（v1.8.2 阶段 B）
 *
 * 用法：
 *   node scripts/build-mnemonics.mjs               # CET-4 + CET-6 全部生成
 *   node scripts/build-mnemonics.mjs --lexicon cet6
 *   node scripts/build-mnemonics.mjs --report     # 只统计覆盖率，不写盘
 *
 * ── 做什么 ──
 * 把语料里的 memoryAids / etymology / difficultyAnalysis / grammaticalInfo
 * 归一化成一个结构化的 `mnemonics` 字段写回各词库分片，覆盖 CET-4 与 CET-6。
 *
 * 为什么不直接在 build-lexicon.mjs 里改：
 *   CET-4 的分片是 v1.8.0 之前就产出的、不重建（重建要重新抓 4540 个语料条目），
 *   而 CET-6 的 memoryAids 已在 build-lexicon 里接上。把「归一化 + 写回」
 *   做成独立脚本，两个词库走同一条口径，且可单独重跑。
 *
 * ── 产出结构（VocabDetail.mnemonics）──
 *   {
 *     device:    谐音/拆词/典故等主助记（字符串）
 *     scene:     视觉联想画面（字符串）
 *     assoc:     联想词（字符串[]）
 *     root:      词根词缀锚点（字符串）
 *     tip:       学习提示（字符串）
 *     confusable:易混点（{wrong, right, note}[]）
 *     tier:      'full' | 'basic' | 'none'  —— 供 UI 决定展示强度
 *   }
 *
 * ── 覆盖率口径（B9）──
 *   top-1000（按 metadata.frequency 高频优先）≥ 90%
 *   其余词 ≥ 60%
 *   tier:'none' 的词不写 mnemonics 字段，让 UI 自然降级为只显示词源。
 *
 * ── 内容红线（B10）──
 *   1. 不编造词条：所有字段都必须来自语料原文，禁止 LLM 式自由发挥；
 *   2. 不含性别/种族/国别/宗教偏见；
 *   3. 不含暴力/色情/赌博/政治敏感；
 *   4. 不重复释义原文（助记必须提供额外记忆点，不是把中文释义抄一遍）；
 *   5. 长度上限，超出即截断并清理残句。
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CACHE_DIR = path.join(ROOT, '.cache', 'lexicons');
const MAX_SHARD_BYTES = 1_500_000;

const argv = process.argv.slice(2);
const argOf = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const REPORT_ONLY = argv.includes('--report');
const ONLY = argOf('--lexicon');

/* ---------------- 词库 → (分片目录, 语料缓存目录) ----------------
 * CET-4 的语料缓存由 build-vocab-detail.mjs 产出在 .cache/vocab-detail/corpus，
 * CET-6 的由 build-lexicon.mjs 产出在 .cache/lexicons/cet6/corpus —— 两者路径不同。
 */
const LEXICONS = [
  {
    id: 'cet4',
    shardDir: path.join(ROOT, 'src', 'data', 'vocab-detail'),
    corpusDir: path.join(CACHE_DIR, '..', 'vocab-detail', 'corpus'),
  },
  {
    id: 'cet6',
    shardDir: path.join(ROOT, 'src', 'data', 'lexicons', 'cet6', 'vocab-detail'),
    corpusDir: path.join(CACHE_DIR, 'cet6', 'corpus'),
  },
  {
    // v1.9.1 阶段 E2：考研（语料与 build-lexicon 的 kaoyan 缓存同源）
    id: 'kaoyan',
    shardDir: path.join(ROOT, 'src', 'data', 'lexicons', 'kaoyan', 'vocab-detail'),
    corpusDir: path.join(CACHE_DIR, 'kaoyan', 'corpus'),
  },
  {
    // v1.10 第一批：GRE（语料与 build-lexicon 的 gre 缓存同源）
    id: 'gre',
    shardDir: path.join(ROOT, 'src', 'data', 'lexicons', 'gre', 'vocab-detail'),
    corpusDir: path.join(CACHE_DIR, 'gre', 'corpus'),
  },
  {
    // v1.10 第二批：IELTS
    id: 'ielts',
    shardDir: path.join(ROOT, 'src', 'data', 'lexicons', 'ielts', 'vocab-detail'),
    corpusDir: path.join(CACHE_DIR, 'ielts', 'corpus'),
  },
];

/**
 * 显式指定 --lexicon 时，若该词库不在上面的清单里，**直接失败**。
 *
 * 为什么加这条：这份清单与 build-lexicon.mjs 的 LEXICONS 是两处独立登记，
 * 之前漏登记过一次（GRE 分片建好了、助记却没生成，且全程无报错）。
 * 与其静默跳过，不如让漏登记在命令行立刻暴露。
 */
if (ONLY && !LEXICONS.some((l) => l.id === ONLY)) {
  console.error(`❌ --lexicon ${ONLY} 未登记在本脚本的 LEXICONS 清单里。`);
  console.error(`   已登记：${LEXICONS.map((l) => l.id).join(', ')}`);
  console.error('   请在 build-mnemonics.mjs 的 LEXICONS 数组里补上（shardDir + corpusDir）。');
  process.exit(1);
}

/* ---------------- 内容红线过滤器 ----------------
 * 只拦「有害内容本身」，不拦「词义里正常提到某事物」。
 * canvas（画布）、sword（剑）、ammunition（弹药）都是考纲词，
 * 它们的助记讲「战场/士兵」是正常教学素材，不能误杀 —— 否则宁可放过，不可错杀。
 */

// 命中即整条丢弃该字段
const BANNED = [
  // 歧视 / 偏见（针对群体的价值判断）
  /\b(race[isnt]?\s+(?:superior|inferior)|white\s+power|racial\s+supremac)/i,
  /\b(christians?|muslims?|jews?|hindus?)\s+(?:are|is)\s+(?:all|better|worse)\b/i,
  /(所有|全部)?(白人|黑人|男人|女人|穆斯林|基督徒|犹太人)(都|一律)?(更|最|天生)(聪明|懒惰|优越|低劣|贪婪)/,
  // 自伤 / 制爆：只拦「教人怎么做」，不拦「弹药/武器」这类名词
  /\b(how\s+to\s+(?:kill\s+(?:yourself|oneself)|make\s+(?:a\s+)?bomb|build\s+(?:a\s+)?bomb))\b/i,
  /(如何自杀|自杀方法|怎样自杀|制作炸弹|怎么制作炸弹|造炸弹)/,
  // 色情 / 赌博 / 毒品：拦的是「描写」与「鼓吹」，不是词义提及
  /(色情片段|性爱描写|情色内容|赌博技巧|如何下注)/i,
  // 血腥虐杀（形容词式描写），但不拦 sword / weapon / kill 这类中性词条
  /(肢解|割喉|虐杀|酷刑|血肉模糊)/,
];

/** 去掉英文标点残留、把中文引号统一 */
function tidy(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s、，,。;；:：]+/, '')
    .replace(/[\s、，,。;；:：]+$/, '')
    .trim();
}

/** 截断到 n 字，尽量断在句读边界，不留半截句 */
function clip(text, n) {
  const s = tidy(text);
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const stop = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('；'), cut.lastIndexOf('，'), cut.lastIndexOf(' '));
  // 切点太靠后就直接硬截，避免只剩半句前缀
  return tidy(stop > n * 0.5 ? cut.slice(0, stop) : cut);
}

/** 助记必须提供「释义之外」的增量，不能是把中文释义换个说法 */
function tooSimilarToMeaning(aid, chineseGloss) {
  const norm = (s) => String(s || '').replace(/[\s，。；、,.!?！？'"]/g, '');
  const a = norm(aid);
  const g = norm(chineseGloss);
  if (!a || !g) return false;
  if (a.length < 8) return false;
  // 助记里包含释义全文 → 视为无增量
  if (g.length >= 8 && a.includes(g)) return true;
  // 与首个释义重合度 > 70% → 视为改写
  let hit = 0;
  for (const seg of g.split(/[·、]/).filter((s) => s.length >= 3)) {
    if (a.includes(seg)) hit += seg.length;
  }
  return hit / g.length > 0.7;
}

function banned(text) {
  const s = String(text || '');
  return BANNED.some((re) => re.test(s));
}

/* ---------------- 从语料条目提取锚点 ---------------- */
function firstContent(list) {
  if (!Array.isArray(list)) return '';
  for (const x of list) {
    if (!x) continue;
    const c = typeof x === 'string' ? x : x.content || x.mistake || x.pattern;
    if (c && tidy(c)) return c;
  }
  return '';
}

function buildMnemonic(row, chineseGloss) {
  const mem = row.memoryAids && typeof row.memoryAids === 'object' ? row.memoryAids : null;
  const out = {};

  const device = clip(firstContent(mem && mem.mnemonicDevices), 220);
  if (device && !banned(device) && !tooSimilarToMeaning(device, chineseGloss)) out.device = device;

  const scene = clip(mem && mem.visualScene && mem.visualScene.description, 160);
  if (scene && !banned(scene) && out.device !== scene) out.scene = scene;

  const assoc = (mem && Array.isArray(mem.wordAssociations) ? mem.wordAssociations : [])
    .filter((w) => w && tidy(w) && !banned(w))
    .slice(0, 4)
    .map((w) => clip(w, 24));
  if (assoc.length) out.assoc = assoc;

  // 词根词缀锚点：比整段 etymology 更适合做记忆支点
  const roots = row.etymology && Array.isArray(row.etymology.rootWords) ? row.etymology.rootWords : [];
  const rootStr = roots
    .slice(0, 2)
    .map((r) => (r && r.root ? tidy(`${r.root}${r.meaning ? `（${r.meaning}）` : ''}`) : ''))
    .filter(Boolean)
    .join(' + ');
  const root = clip(rootStr, 80);
  if (root && !banned(root)) out.root = root;

  const tip = clip(firstContent(row.difficultyAnalysis && row.difficultyAnalysis.learningTips), 140);
  if (tip && !banned(tip)) out.tip = tip;

  const mistakes = row.grammaticalInfo && Array.isArray(row.grammaticalInfo.commonMistakes)
    ? row.grammaticalInfo.commonMistakes : [];
  const confusable = mistakes
    .filter((m) => m && m.mistake && m.correction && !banned(m.mistake) && !banned(m.correction))
    .slice(0, 2)
    .map((m) => ({ wrong: clip(m.mistake, 90), right: clip(m.correction, 90), note: clip(m.explanation, 100) }));
  if (confusable.length) out.confusable = confusable;

  // 分级：device/scene 任一有内容 = full；只有 root/tip/assoc = basic；全空 = none
  if (out.device || out.scene) out.tier = 'full';
  else if (out.root || out.tip || (out.assoc && out.assoc.length) || (out.confusable && out.confusable.length)) out.tier = 'basic';
  else out.tier = 'none';

  if (out.tier === 'none') return null;
  return out;
}

/** 词条的中文释义（用于「助记不得等于释义」的相似度判定） */
function glossOf(detail) {
  try {
    return (detail.meanings || [])
      .flatMap((m) => (m.definitions || []).map((x) => x.chinese || ''))
      .join('');
  } catch {
    return '';
  }
}

/* ---------------- 语料缺席时的确定性兜底（结构化，不编造） ----------------
 * 未覆盖的全部是缩写（a.m / i.e. / p.m）与连写复合词（ice-cream / father-in-law）。
 * 这类词本身没有词根故事可讲，但**结构本身就是最好的记忆锚点**：
 * 缩写记「每个字母代表什么」，复合词记「拆成哪几个独立单词」。
 * 全部由字符串规则推导，不引入任何外部内容，因此不可能编造。
 */
const ABBR = {
  'a.m': ['a = ante（之前）', 'm = meridiem（正午）'],
  'am': ['a.m. = ante meridiem，即「上午」'],
  'pm': ['p.m. = post meridiem，即「下午」'],
  'bc': ['b.c. = before Christ，即「公元前」'],
  'ad': ['a.d. = anno Domini，即「公元」'],
  'ie': ['i.e. = id est，即「也就是说」'],
  'etc': ['etc. = et cetera，即「诸如此类」'],
  'vs': ['vs. = versus，即「对阵 / 对比」'],
};

/** 归一化缩写词形：去点、转小写，便于查表（i.e. → ie，B.C. → bc） */
function abbrKey(word) {
  return String(word || '').toLowerCase().replace(/\./g, '');
}

function structuralFallback(word) {
  const w = String(word || '').trim().toLowerCase();
  const k = abbrKey(w);

  if (ABBR[k] && ABBR[k].length) return { device: `拆字母记忆：${ABBR[k].join('；')}`, tier: 'full' };

  // 含撇号的所有格缩写：o'clock = of the clock
  if (w.includes("'")) {
    const [head, tail] = w.split("'");
    if (head === 'o' && tail === 'clock') {
      return { device: "拆缩写：o'clock = of the clock，即「几点钟」——见到撇号先想「of」", tier: 'full' };
    }
  }

  // 连字符复合词：逐段拆解
  if (w.includes('-')) {
    const parts = w.split('-').filter(Boolean);
    // 连字（ice-cream 里 ice 与 cream 各自独立）才值得拆；
    // ice-cream 是真复合，而 father-in-law 的 in/law 也要拆开看
    if (parts.length >= 2 && parts.every((p) => p.length >= 2)) {
      const zh = {
        ice: '冰', cream: '奶油', father: '父亲', mother: '母亲', in: '在…里',
        law: '法律', brother: '兄弟', sister: '姐妹',
        air: '空气', condition: '条件', living: '生活', room: '房间',
        good: '好', bad: '坏', new: '新', old: '旧', long: '长', short: '短',
        black: '黑', white: '白', man: '男人', woman: '女人', child: '孩子',
      };
      const parts2 = parts.map((p) => `${p}${zh[p] ? `（${zh[p]}）` : ''}`);
      return {
        device: `拆解复合词：${parts.join(' + ')} —— 逐段记「${parts2.join('、')}」，合起来才是 ${word}`,
        tier: 'basic',
      };
    }
    // 单字母连写（x-ray / e-mail）：首段是单个字母，其余段正常
    if (parts.length >= 2 && parts[0].length === 1) {
      const gloss = {
        x: 'X，即 X 射线',
        e: 'e，即 electronic（电子的）',
        t: 't，即 telephone（电话）',
      };
      return {
        device: `拆连写：${parts.join(' + ')} —— 逐段记「${parts.map((p) => gloss[p] || p).join('、')}」`,
        tier: 'basic',
      };
    }
  }

  // 兜底仍无结构可拆 → 交回 null，由 UI 自然降级（宁缺勿滥）
  return null;
}

/* ---------------- 频次排序（top-N 覆盖率口径） ---------------- */
const RANK = [
  /\bextremely high\b/i, /\bvery high\b/i, /\bhigh\b/i,
  /\bmedium\b/i, /\blow\b/i, /\brare\b/i,
];
function freqRank(row, detail) {
  const f = String((row.metadata && row.metadata.frequency) || (detail && detail.usage) || '');
  for (let i = 0; i < RANK.length; i++) if (RANK[i].test(f)) return i;
  return RANK.length;
}

/* ---------------- 主流程 ---------------- */
function readCorpus(cacheDir, word) {
  const f = path.join(cacheDir, `${word}.json`);
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
}

let exitCode = 0;
for (const lex of LEXICONS) {
  if (ONLY && lex.id !== ONLY) continue;
  const shardDir = lex.shardDir;
  const mfPath = path.join(shardDir, 'manifest.json');
  if (!fs.existsSync(mfPath)) {
    console.error(`❌ [${lex.id}] 缺少分片 manifest：${mfPath}（先跑 node scripts/build-lexicon.mjs）`);
    exitCode = 1;
    continue;
  }
  const cacheDir = lex.corpusDir;
  const mf = JSON.parse(fs.readFileSync(mfPath, 'utf8'));
  const files = [...new Set(Object.values(mf.files))];

  const all = new Map();      // word -> detail
  for (const f of files) {
    const data = JSON.parse(fs.readFileSync(path.join(shardDir, f), 'utf8'));
    for (const [w, d] of Object.entries(data)) all.set(w, d);
  }

  let tierFull = 0, tierBasic = 0, none = 0;
  const noAid = [];
  for (const [w, d] of all) {
    // 已有合格锚点 → 直接计入统计（不重复生成，但必须计入覆盖率，
    // 否则第二次重跑会因为 continue 而把覆盖率报成接近 0）
    const prev = d.mnemonics && d.mnemonics.tier !== 'none' ? d.mnemonics : null;
    if (prev) {
      if (prev.tier === 'full') tierFull++; else tierBasic++;
      continue;
    }
    const row = readCorpus(cacheDir, w);
    let m = row ? buildMnemonic(row, glossOf(d)) : null;
    // 语料缺席、或语料里的锚点全被红线过滤掉时 → 用结构规则兜底（不编造内容）
    if (!m) m = structuralFallback(w);
    if (!m) { none++; noAid.push(w); continue; }
    d.mnemonics = m;
    if (m.tier === 'full') tierFull++; else tierBasic++;
  }

  const total = all.size;
  const covered = tierFull + tierBasic;
  const pct = (n) => ((n / total) * 100).toFixed(2) + '%';

  console.log(`\n🧠 [${lex.id}] 记忆锚点覆盖率`);
  console.log(`   词条总数   ${total}`);
  console.log(`   full(装置/画面) ${tierFull}  ${pct(tierFull)}`);
  console.log(`   basic(词根/提示) ${tierBasic}  ${pct(tierBasic)}`);
  console.log(`   合计覆盖   ${covered}  ${pct(covered)}`);
  console.log(`   无锚点     ${none}  ${pct(none)}${noAid.length ? '  例：' + noAid.slice(0, 12).join(' ') : ''}`);

  if (REPORT_ONLY) continue;

  // 写回分片：按 manifest 的前缀归属重建，保持分片划分不变。
  // 加了 mnemonics 后单片会变大，超 1.5MB 的片按「更长的前缀」二次拆分——
  // 运行时是**最长前缀匹配**（vocab-detail.ts: prefixFor），
  // 把 's' 拆成 'sa'…'sz' 后查 'sack' 仍命中 'sa'，向后兼容且零改动。
  const bytes = new Map();
  const gz = new Map();
  const perFile = new Map(files.map((f) => [f, {}]));
  for (const [w, d] of all) {
    const target = pickShard(mf, files, w);
    perFile.get(target)[w] = d;
  }

  const oversized = [];
  for (const [f, data] of perFile) {
    const buf = Buffer.from(JSON.stringify(data), 'utf8');
    if (buf.length > MAX_SHARD_BYTES) oversized.push({ f, data, buf });
    else { writeShard(shardDir, f, buf); bytes.set(f, buf.length); gz.set(f, zlib.gzipSync(buf).length); }
  }

  // 二次拆分：按下一位字母分成 26 片
  for (const { f, data } of oversized) {
    const prefix = f.replace(/\.json$/, '');
    const buckets = new Map();
    for (const [w, d] of Object.entries(data)) {
      const sub = prefix + String(w)[prefix.length] || '_';
      const key = sub.replace(/[^a-z]/g, '_');
      if (!buckets.has(key)) buckets.set(key, {});
      buckets.get(key)[w] = d;
    }
    fs.rmSync(path.join(shardDir, f), { force: true });
    mf.prefixes = mf.prefixes.filter((p) => p !== prefix);
    mf.files = Object.fromEntries(Object.entries(mf.files).filter(([, v]) => v !== f));
    for (const [key, bd] of buckets) {
      const file = `${key}.json`;
      const buf = Buffer.from(JSON.stringify(bd), 'utf8');
      if (buf.length > MAX_SHARD_BYTES) {
        console.error(`❌ [${lex.id}] 二次拆分后 ${file} 仍 ${buf.length} 字节 > 1.5MB，需三级拆分`);
        exitCode = 1;
        continue;
      }
      writeShard(shardDir, file, buf);
      mf.prefixes.push(key);
      mf.files[key] = file;
      bytes.set(file, buf.length);
      gz.set(file, zlib.gzipSync(buf).length);
    }
    // prefixes 必须按长度降序（最长前缀匹配的前提）
    mf.prefixes.sort((a, b) => b.length - a.length);
    console.log(`   ↳ ${f} 超过 1.5MB，已按下一位字母拆为 ${buckets.size} 片`);
  }

  // manifest.count 同步
  mf.count = all.size;
  fs.writeFileSync(mfPath, JSON.stringify(mf, null, 2) + '\n', 'utf8');

  const totalB = [...bytes.values()].reduce((a, b) => a + b, 0);
  const totalG = [...gz.values()].reduce((a, b) => a + b, 0);
  console.log(`   已写回 ${bytes.size} 片，合计 ${(totalB / 1024 / 1024).toFixed(2)} MB`);
  console.log(`   gzip 后 ${(totalG / 1024 / 1024).toFixed(2)} MB`);
}

process.exit(exitCode);

/** 与 build-lexicon 相同的分片归属规则：最长前缀优先 */
function pickShard(mf, files, word) {
  for (const prefix of mf.prefixes) {
    if (word.startsWith(prefix)) return mf.files[prefix];
  }
  return files[files.length - 1];
}

/** 写分片：UTF-8 无 BOM，避免首字节被当成内容 */
function writeShard(dir, file, buf) {
  fs.writeFileSync(path.join(dir, file), buf);
}