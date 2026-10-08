#!/usr/bin/env node
/**
 * 中学考试题库生成器（v1.9.0 阶段 A/B 共用核心）
 *
 * 用法：
 *   node scripts/build-exam-bank.mjs --lexicon junior      # 也可走 build-question-bank-junior.mjs
 *   node scripts/build-exam-bank.mjs --lexicon junior --out <dir> [--quiet]
 *
 * 五个题型全部由**确定性模板**生成：
 *   · 语法选择 —— 答案在生成期就算好（框架结构 / 动词变位表 / 首字母规则），
 *                 运行时不做任何语法判断；
 *   · 完形填空 —— 骨架句 + 词性容错槽位，每篇 10 空，10 题共享同一篇章；
 *   · 阅读理解 —— 每篇 5 题（细节 3 + 主旨 1 + 词义 1），正解全部来自短文本身；
 *   · 选词填空 —— 每篇 5 空共用一份 10 词词库，5 题共享选项；
 *   · 书面表达 —— 应用文/话题/看图等任务面，自评不设标准答案。
 *
 * 三条质量闸（生成后逐条断言，不过就 exit 1）：
 *   1. 每道选择题 4 个互不相同的选项，且正解在其中；
 *   2. 分片不超过 1.5 MB；
 *   3. 模拟卷 3 套 × 40 题、两两不重、题号都能解析、五种题型齐全。
 *
 * 确定性：只用固定种子的 mulberry32，输出里没有任何时间戳 —— 跑两遍字节一致。
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import {
  NAMES, PLACES, TIMES, NUMS, NOUNS, ADJ_QUALITY, ADJ_COLOR, ADVS, VERBS_BASE,
  VERB_FORMS, FEMININE, SLOTS, GRAMMAR_FRAMES, CLOZE_SKELETONS, READING_SKELETONS, BANKFILL_SKELETONS,
  WRITING_TASKS, shuffle4,
  SENIOR_SLOTS, SENIOR_CLOZE_SKELETONS, SENIOR_READING_SKELETONS, GAPPED_SKELETONS,
  SENIOR_GRAMMAR_FILL_SKELETONS, FUNCTION_SETS, SENIOR_WRITING, SENIOR_CONTINUATION,
  KAOYAN_CLOZE_SKELETONS, KAOYAN_READING_SKELETONS, KAOYAN_GAPPED_SKELETONS,
  KAOYAN_WRITING,
  PRETCO_DIALOGUE_SKELETONS, PRETCO_DIALOGUE_DECOYS, PRETCO_WRITING,
  GRE_WRITING,
} from './exam-bank-content.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MAX_SHARD_BYTES = 1_500_000;
const BANK_SCHEMA = 'qingci-question-bank/1';
const EXAM_SCHEMA = 'qingci-exam-bank/1';

/**
 * 语义子池词的中文释义补丁（构建期用，不进单文件）。
 *
 * ECDICT `tag:ky` 只标考研**超纲词**，go / town / question 这类基础词不带 ky 标，
 * 但它们是 SLOTS 语义子池的常客。词义猜测题要给 4 个中文释义选项，查不到就整题丢弃
 * → 每篇从 5 题掉到 4 题 → 组卷满员组不足而失败。
 * 补丁表同样取自 ECDICT（MIT），由探活脚本产出到 .cache；文件缺失时回退空表
 * （此时只影响词义题数量，不会让构建崩）。
 */
const GLOSS_PATCH = (() => {
  const p = path.join(ROOT, '.cache', 'lexicons', 'gloss-patch.json');
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch { /* 读不到按空表 */ }
  return {};
})();

/** 各词库的词源、题型与组卷计划（阶段 A 初中 / 阶段 B 高中共用一套引擎） */
const LEXICONS = {
  junior: {
    id: 'junior', exam: 'zhongkao', label: '中考', prefix: 'jun',
    wordlist: path.join(ROOT, 'src', 'data', 'lexicons', 'junior', 'wordlist.json'),
    outDir: path.join(ROOT, 'src', 'data', 'lexicons', 'junior', 'question-bank'),
    paperNames: ['中考模拟卷一', '中考模拟卷二', '中考模拟卷三'],
    paperKeys: ['zk-01', 'zk-02', 'zk-03'],
    // 组卷计划：direct = 直接取题，group = 按篇章整组取（per=每组题数, groups=取几组）
    plan: [
      { kind: 'grammar', type: 'direct', count: 14 },
      { kind: 'cloze', type: 'group', per: 10, groups: 1 },
      { kind: 'reading', type: 'group', per: 5, groups: 2 },
      { kind: 'bankfill', type: 'group', per: 5, groups: 1 },
      { kind: 'writing', type: 'direct', count: 1 },
    ],
    // group 类的目标是**篇数**，direct 类的目标是**题数**
    targets: { grammar: 2400, cloze: 96, reading: 144, bankfill: 140, writing: 30 },
    detailQs: 3, // 每篇阅读出几道细节题（+主旨1 +词义1 = 5/4）
    content: 'junior', // 用初中素材
  },
  senior: {
    id: 'senior', exam: 'gaokao', label: '高考', prefix: 'sen',
    wordlist: path.join(ROOT, 'src', 'data', 'lexicons', 'senior', 'wordlist.json'),
    outDir: path.join(ROOT, 'src', 'data', 'lexicons', 'senior', 'question-bank'),
    paperNames: ['高考模拟卷一', '高考模拟卷二', '高考模拟卷三'],
    paperKeys: ['gk-01', 'gk-02', 'gk-03'],
    plan: [
      { kind: 'reading', type: 'group', per: 4, groups: 4 },
      { kind: 'gapped', type: 'group', per: 5, groups: 1 },
      { kind: 'cloze', type: 'group', per: 10, groups: 2 },
      { kind: 'grammarfill', type: 'group', per: 10, groups: 1 },
      { kind: 'writing', type: 'direct', count: 1 },
      { kind: 'continuation', type: 'direct', count: 1 },
    ],
    // gapped 篇章无变体槽（句子是写死的行文），5 篇就是 5 篇 —— 目标写 5，
    // 多写只会空转（去重后留 5 篇 ×5 题）；其余题型靠 N/T/NAME 槽位产生变体。
    targets: { reading: 400, gapped: 5, cloze: 150, grammarfill: 200, writing: 30, continuation: 10 },
    detailQs: 2,
    content: 'senior',
  },
  /**
   * 考研 —— v1.9.1 阶段 E。
   *
   * 与高考的差异（均来自 E4 题型口径）：
   *   · 完形 **20 空**（`clozeBlanks: 20`，骨架见 KAOYAN_CLOZE_SKELETONS）
   *   · 阅读 **5 题/篇**（`detailQs: 3` → 3 细节 + 1 主旨 + 1 词义，
   *     骨架 facts 已派生为 when/where/howMany 三项且三锚点齐全）
   *   · 新题型 = 七选五（gapped），句子带槽位 → 变体篇章
   *   · 翻译（英译汉）与写作为 direct 题
   */
  kaoyan: {
    id: 'kaoyan', exam: 'kaoyan', label: '考研', prefix: 'ky',
    wordlist: path.join(ROOT, 'src', 'data', 'lexicons', 'kaoyan', 'wordlist.json'),
    outDir: path.join(ROOT, 'src', 'data', 'lexicons', 'kaoyan', 'question-bank'),
    detailDir: path.join(ROOT, 'src', 'data', 'lexicons', 'kaoyan', 'vocab-detail'),
    paperNames: ['考研模拟卷一', '考研模拟卷二', '考研模拟卷三'],
    paperKeys: ['ky-01', 'ky-02', 'ky-03'],
    plan: [
      { kind: 'reading', type: 'group', per: 5, groups: 4 },
      { kind: 'gapped', type: 'group', per: 5, groups: 1 },
      { kind: 'cloze', type: 'group', per: 20, groups: 1 },
      { kind: 'trans', type: 'direct', count: 5 },
      { kind: 'writing', type: 'direct', count: 2 },
    ],
    // group 类目标是**篇数**，direct 类是**题数**
    // 阅读 320 篇 × 5 题 = 1600（E4 要 1500+）—— 400 篇会到 2000 题 / 1.83 MB，
    //   超 1.5 MB 单片上限；915 B/题 → 1.5 MB 上限约 1640 题，留 40 题余量。
    // 七选五 210 篇（去重后 ~520 题，要 500+）、完形 30 篇 × 20 空 = 600（要 500+）、
    // 英译汉 320（要 300+）；写作由任务表定（226，要 200+）
    targets: { reading: 320, gapped: 210, cloze: 30, trans: 320, writing: 226 },
    detailQs: 3,
    clozeBlanks: 20,
    content: 'kaoyan',
  },
  /**
   * GRE（v1.10 第一批）。
   *
   * GRE 的题型与四六级差异很大，映射到本引擎的可用题型：
   *   · 填空（句子等价 / Text Completion）→ 复用 `bankfill`（选词填空）
   *   · 阅读理解                        → `reading`
   *   · 分析性写作（Issue / Argument）   → `writing`（用 GRE_WRITING 素材）
   * 不生成听力（GRE 无听力）。
   */
  gre: {
    id: 'gre', exam: 'gre', label: 'GRE', prefix: 'gr',
    wordlist: path.join(ROOT, 'src', 'data', 'lexicons', 'gre', 'wordlist.json'),
    outDir: path.join(ROOT, 'src', 'data', 'lexicons', 'gre', 'question-bank'),
    detailDir: path.join(ROOT, 'src', 'data', 'lexicons', 'gre', 'vocab-detail'),
    paperNames: ['GRE 模拟卷一', 'GRE 模拟卷二', 'GRE 模拟卷三'],
    paperKeys: ['gr-01', 'gr-02', 'gr-03'],
    plan: [
      { kind: 'bankfill', type: 'direct', count: 620 },
      { kind: 'reading', type: 'group', per: 5, groups: 105 },
      { kind: 'writing', type: 'direct', count: 11 },
    ],
    // 组卷消耗是「每套卷」的量，direct 类按 count×3 套切片、group 类按 groups×3 套取整组。
    // 因此 targets 必须 ≥ 3 倍 count，否则第 2/3 套必然凑不满（实测踩过：
    // bankfill 只产 1877，plan 却要 1400/套 → 第二套 477/1400 直接失败）。
    // 这里按「3 套 × (620 + 105×5 + 11) = 3 × 1156 = 3468 题」配置，
    // targets 留出余量：bankfill 1900、reading 320 篇（1600 题）、writing 35。
    targets: { bankfill: 1900, reading: 320, writing: 35 },
    detailQs: 3,
    content: 'gre',
  },
  /**
   * PRETCO 近似（v1.9.1 阶段 F）：词库数据复用 CET-4（词源从模板内联读，
   * `wordlist: 'template'` 哨兵），只生成 PRETCO **特色题型**：
   *   · 语法结构（单选） grammar  1500+（复用既有 grammar builder）
   *   · 英译汉          trans    1000+（素材 = CET-4 详情例句，12761 条可用）
   *   · 听力短对话       talk     800+（21 骨架 × 槽位变体，带 TTS 播放）
   *   · 应用文写作       writing  200+
   */
  pretco: {
    id: 'pretco', exam: 'pretco', label: 'PRETCO', prefix: 'pt',
    wordlist: 'template',
    outDir: path.join(ROOT, 'src', 'data', 'lexicons', 'pretco', 'question-bank'),
    // 翻译素材取自 CET-4 详情分片（复用，不新建词库数据）
    detailDir: path.join(ROOT, 'src', 'data', 'vocab-detail'),
    paperNames: ['PRETCO 模拟卷一', 'PRETCO 模拟卷二', 'PRETCO 模拟卷三'],
    paperKeys: ['pt-01', 'pt-02', 'pt-03'],
    plan: [
      { kind: 'grammar', type: 'direct', count: 15 },
      { kind: 'talk', type: 'direct', count: 10 },
      { kind: 'trans', type: 'direct', count: 5 },
      { kind: 'writing', type: 'direct', count: 2 },
    ],
    // direct 类目标是**题数**。
    // 语法 1300：GRAMMAR_FRAMES 在 CET-4 词表上**饱和于 1376 题**（初中同为 1376，
    //   是框架 × 词槽组合的天然上限），再加目标也只会在 idle 里空转，故取 1300
    //   作「够刷」的下限而非虚构的 1500。英译汉 1000+ / 短对话 800+ / 应用文 200+。
    targets: { grammar: 1300, talk: 820, trans: 1050, writing: 220 },
    detailQs: 3,
    content: 'pretco',
  },
};

/** 语法填空的形态标记 → 动词变位表字段 */
const GFORM = { b: 'b', s: 's', p: 'p', past: 'p', pp: 'pp', ing: 'ing' };

/**
 * 当前正在构建的词库的题号前缀与素材集。
 * 两个词库分两次进程内构建（`--lexicon`），用模块级状态给各 builder 取材，
 * 比给 6 个 builder 各加 3 个参数更省事、也更不容易漏改。
 */
let ID_PREFIX = 'jun';
let SK = {
  cloze: CLOZE_SKELETONS,
  reading: READING_SKELETONS,
  bankfill: BANKFILL_SKELETONS,
  gapped: [],
  grammarfill: [],
  detailQs: 3,
  tagBase: 'junior', // knowledgeTags 首位（也是题库所属词库的标记）
};

/* ---------------- 确定性随机 ---------------- */

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------- 词池准备 ---------------- */

function loadWordlist(file) {
  // `TEMPLATE` 哨兵：词源内联在模板的 <script id="lexicon"> 里（CET-4 / PRETCO 近似
  // 不产出独立 wordlist.json）。走这条路避免为近似词库复制一份 4540 词的词表。
  if (file === 'template') {
    const html = fs.readFileSync(path.join(ROOT, 'src', 'index.template.html'), 'utf8');
    const m = /<script id="lexicon" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
    if (!m) throw new Error('模板缺少 <script id="lexicon">');
    const arr = JSON.parse(m[1]);
    return { arr, map: new Map(arr.map((w) => [String(w.w).toLowerCase(), w])) };
  }
  const arr = JSON.parse(fs.readFileSync(file, 'utf8'));
  const map = new Map(arr.map((w) => [String(w.w).toLowerCase(), w]));
  return { arr, map };
}

/** 取池子与词表的交集（词池是素材，词表是权威：词不在词库里就不能进题） */
function poolIn(pool, wl) {
  const seen = new Set();
  const out = [];
  for (const w of pool) {
    const k = String(w).toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    if (wl.has(k)) out.push(String(w));
  }
  return out;
}

function dedupeForms() {
  const seen = new Set();
  return VERB_FORMS.filter((v) => (seen.has(v.b) ? false : (seen.add(v.b), true)));
}

/** 该动词能否做及物动词的被动（passive 池只需要表里有值即可） */
function pick(list, i, salt = 0) {
  if (!list.length) return '';
  return list[(((i * 7) + (salt * 13)) % list.length + list.length) % list.length];
}

/* ---------------- 校验 ---------------- */

/**
 * 校验一道题。
 * `requireBlank` 只给**完形填空式的题干**用：语法题必须在题干里看到 ___；
 * 完形/选词的空在**篇章里**、阅读的空在 WH 问句与选项里，题干没有 ___ 是正常的，
 * 这三类改为要求携带 passage。
 */
function validateChoice(q, where, opts = {}) {
  const errs = [];
  const expect = opts.choices || 4; // 完形/语法/阅读 4 选 1，选词题整份词库作选项
  if (!q.choices || q.choices.length !== expect) errs.push('选项数=' + (q.choices ? q.choices.length : 0) + `（应为 ${expect}）`);
  else if (new Set(q.choices).size !== q.choices.length) errs.push('选项重复 ' + JSON.stringify(q.choices));
  if (!q.choices || !q.choices.includes(q.answer)) errs.push('正解不在选项中：' + q.answer);
  if (!q.prompt || !q.prompt.trim()) errs.push('题干为空');
  if (opts.requireBlank && (!q.prompt || !q.prompt.includes('___'))) errs.push('题干缺空：' + q.prompt);
  if (opts.requirePassage && (!q.passage || q.passage.length < 40)) errs.push('缺篇章');
  if (/\{[A-Z0-9]+\}/.test(q.prompt) || /\{[A-Z0-9]+\}/.test(q.passage || '')) errs.push('残留占位符');
  if (errs.length) {
    console.error(`❌ ${where} 校验失败：${errs.join('；')}  |  ${JSON.stringify(q).slice(0, 220)}`);
    process.exit(1);
  }
}

function clamp01(x) {
  return Math.max(0.2, Math.min(0.8, Math.round(x * 100) / 100));
}

/**
 * 取 n 个**互不相同**且不等于正解的干扰项。
 *
 * 必须从起点绕圈逐个走：`pick(list, i*7, 2)` 这种定步长在长度为 7 的池子
 * （星期池恰好 7 个）上步长与长度同余，永远停在同一个元素 ——
 * 干扰项凑不齐 3 个，题目会直接被判失败。
 */
function takeDecoys(list, answer, seed, n = 3) {
  if (!Array.isArray(list) || list.length <= n) return [];
  const start = ((seed % list.length) + list.length) % list.length;
  const out = [];
  for (let k = 1; k <= list.length && out.length < n; k++) {
    const c = list[(start + k) % list.length];
    if (c && c !== answer && !out.includes(c)) out.push(c);
  }
  return out;
}

/* ---------------- 题型生成 ---------------- */

function buildGrammar(pool, target, rand) {
  const questions = [];
  const seen = new Set();
  const verbs = dedupeForms();
  const ctx = {
    i: 0,
    pickN: (i, salt) => pick(pool.nouns, i, salt),
    pickVerb: (i, salt) => verbs[(((i * 11) + (salt * 5)) % verbs.length + verbs.length) % verbs.length],
    pickA: (i) => pick(pool.adjs, i, 3),
    pickR: (i) => pick(pool.advs, i, 4),
    pickAdj: (i) => pick(pool.adjs, i, 6),
  };
  // 轮转取框架，直到凑够题量或一整轮再无新题（固定框架自然只出 1 题）
  let i = 0;
  let idle = 0;
  while (questions.length < target && idle < GRAMMAR_FRAMES.length * 60) {
    const f = GRAMMAR_FRAMES[i % GRAMMAR_FRAMES.length];
    const variant = Math.floor(i / GRAMMAR_FRAMES.length);
    i++;
    ctx.i = variant;
    const q = f.make(ctx);
    if (!q) { idle++; continue; }
    const choices = shuffle4(q.choices, rand);
    // 动词原形 = 过去式时（put/read/cut…），框架给的干扰项会和正解撞车；
    // 这种变体直接跳过，让别的动词变体顶上，而不是硬塞一个重复选项。
    if (!Array.isArray(choices) || choices.length !== 4
      || new Set(choices).size !== 4 || !choices.includes(q.answer)) {
      idle++;
      continue;
    }
    const rec = { prompt: q.prompt, choices, answer: q.answer, explain: q.explain };
    const key = q.prompt + '\u0000' + q.answer;
    if (seen.has(key)) { idle++; continue; }
    seen.add(key);
    idle = 0;
    validateChoice(rec, `grammar#${questions.length + 1}`, { requireBlank: true });
    questions.push({
      id: `q_${ID_PREFIX}_grammar_${String(questions.length + 1).padStart(4, '0')}`,
      kind: 'grammar',
      part: '读',
      difficulty: clamp01(0.3 + ((questions.length % 7) * 0.05)),
      discrimination: 0.4,
      knowledgeTags: [SK.tagBase, `grammar:${f.tag}`, `rule:${fnv1a(f.rule) % 1000}`],
      content: rec,
    });
  }
  return questions;
}

/** 完形 / 阅读 / 选词共用的槽位填充：同一变体的同名槽位必须填同一个词 */
function makeFiller(seedStr, pools) {
  const rnd = mulberry32(fnv1a(seedStr));
  const assigned = new Map();
  const taken = new Set(); // 同一篇里不同槽位不撞词
  const fn = (key, posOrList) => {
    if (assigned.has(key)) return assigned.get(key);
    const list = (Array.isArray(posOrList) ? posOrList : pools[posOrList]) || pools.nouns;
    if (!list || !list.length) return '';
    let v = '';
    for (let k = 0; k < list.length; k++) {
      const cand = list[Math.floor(rnd() * list.length)];
      if (!taken.has(cand)) { v = cand; break; }
    }
    if (!v) {
      // 随机抽满一轮全是已占词（小池子会撞上）→ 线性找一个没占的，
      // 直接回落 list[0] 会同篇撞答案，成组校验会判「组内答案互不相同」失败。
      v = list.find((w) => !taken.has(w)) || '';
    }
    if (!v) v = list[0]; // 池子整体被占满的极端情况（正常不会发生）
    taken.add(v);
    assigned.set(key, v);
    return v;
  };
  fn.pools = pools;
  return fn;
}

const POS_OF = { NAME: 'names', NAME2: 'names', PLACE1: 'places', PLACE2: 'places', NUM1: 'nums', NUM2: 'nums' };

/** 槽位可以写成 `{A1@weather}` —— `@` 后面是语义子池（见 content 的 SLOTS）。
 *  不这样限制就会出现 "The weather was hard"、"a blue market" 这种
 *  语法对、语义荒唐的句子：槽位随便从通用形容词池里抓，跟句子场景对不上。 */
function poolKeyOf(key) {
  const at = key.indexOf('@');
  return at >= 0 ? key.slice(at + 1) : '';
}
function baseKey(key) {
  const at = key.indexOf('@');
  return at >= 0 ? key.slice(0, at) : key;
}
function resolvePool(key, pools) {
  const slot = poolKeyOf(key);
  if (slot) {
    const p = pools.slot && pools.slot[slot];
    if (!p || !p.length) {
      // 拼错槽位名会静默回落到名词池，产出「天气 was hard」这类病句 —— 必须炸
      console.error(`❌ 槽位 ${key} 指向的语义子池 "${slot}" 不存在或为空（SLOTS 里没有）`);
      process.exit(1);
    }
    return p;
  }
  const base = baseKey(key);
  if (POS_OF[base]) return pools[POS_OF[base]] || pools.nouns;
  if (base.startsWith('T')) return pools.times;
  const m = base.match(/^([ANRV])/);
  const name = m && { N: 'nouns', A: 'adjs', R: 'advs', V: 'verbs' }[m[1]];
  return (name && pools[name]) || pools.nouns;
}
function posLabelOf(key) {
  const slot = poolKeyOf(key);
  if (slot) return slot;
  const base = baseKey(key);
  if (POS_OF[base]) return POS_OF[base];
  if (base.startsWith('T')) return 'times';
  const m = base.match(/^([ANRV])/);
  return m ? { N: 'nouns', A: 'adjs', R: 'advs', V: 'verbs' }[m[1]] : 'nouns';
}

/**
 * 渲染骨架句：
 *   · `{HISHER}` `{NAME}` `{PLACE1}` 等**上下文词不挖空**（它们是交代故事的锚点，
 *     挖空只会让读者拿不到主语/地点，完形不该这么出）；
 *   · `{A1}` `{V1}` `{R1}` `{N1}` `{T1}` 这类**可空词**在**每次出现处**都挖空 ——
 *     只挖第一次、后面又写出来，等于把答案亮给学生；
 *   · `blanked=false`（阅读）则一律填实词，不挖空。
 *   · `{HE}` `{HIM}` `{HISHER}` 按本篇人名的性别展开（Mary… his family 是硬伤）。
 */
const BLANKABLE = /^(?:[ANRV]\d+|T\d+)(?:@\w+)?$/;
function renderPassage(sentences, fill, { blanked = true, startIndex = 1 } = {}) {
  const blanks = [];
  const used = [];
  const filled = sentences.map((s, si) => s.replace(/\{([A-Z0-9]+(?:@\w+)?)\}/g, (whole, key, off) => {
    const nm = () => fill('NAME', 'names');
    let pron = null;
    if (key === 'HISHER') pron = FEMININE.has(nm()) ? 'her' : 'his';
    if (key === 'HE') pron = FEMININE.has(nm()) ? 'she' : 'he';
    if (key === 'HIM') pron = FEMININE.has(nm()) ? 'her' : 'him';
    if (pron !== null) {
      // 展开后的代词若在句首，必须大写：`she gets up…` 是一眼可见的低级错误
      return off === 0 ? pron.charAt(0).toUpperCase() + pron.slice(1) : pron;
    }
    const word = fill(key, resolvePool(key, fill.pools));
    if (used.indexOf(key) < 0) used.push(key);
    if (!blanked) return word;
    if (!BLANKABLE.test(key)) return word;
    let slot = blanks.find((b) => b.key === key);
    if (!slot) {
      slot = { key, word, pool: resolvePool(key, fill.pools), label: posLabelOf(key), si, idx: blanks.length };
      blanks.push(slot);
    }
    return `___${startIndex + slot.idx}___`;
  }));
  return { text: filled.join(' '), sentences: filled, blanks, used };
}

function buildCloze(pool, wl, targetPassages, rand) {
  const questions = [];
  const passages = [];
  const seenQ = new Set();
  /* 完形空数按词库走：中考/高考 10 空，考研 20 空（E4 题型口径） */
  const needBlanks = SK.clozeBlanks || 10;
  for (let v = 0; v < targetPassages; v++) {
    const sk = SK.cloze[v % SK.cloze.length];
    const vi = Math.floor(v / SK.cloze.length);
    const fill = makeFiller(`${sk.id}|${vi}`, pool);
    const rendered = renderPassage(sk.sents, fill, { blanked: true });
    const { text, blanks, sentences } = rendered;
    if (blanks.length !== needBlanks) {
      console.error(`❌ 完形骨架 ${sk.id} 的空数是 ${blanks.length}（本词库要求 ${needBlanks}）`);
      process.exit(1);
    }
    const groupId = `cloze_${String(passages.length + 1).padStart(3, '0')}`;
    passages.push({ groupId, text });
    blanks.forEach((b, idx) => {
      // 干扰项从**同一个语义池**取：天气槽的干扰项也得是天气形容词，
      // 混进名词会让选项一眼看出破绽。
      const decoys = takeDecoys(b.pool, b.word, vi * 13 + idx * 5);
      const gloss = (wl.get(String(b.word).toLowerCase()) || {}).short || '';
      const sent = (sentences[b.si] || '').replace(/___\d+___/g, '____');
      const rec = {
        prompt: `短文第 ${idx + 1} 空应填入：`,
        choices: shuffle4([b.word, ...decoys], rand),
        answer: b.word,
        explain: `${b.word}${gloss ? `（${gloss}）` : ''}。所在句：${sent}`,
        passage: text,
        group: groupId,
      };
      const key = text + '\u0000' + rec.prompt + '\u0000' + b.word;
      if (seenQ.has(key)) return;
      seenQ.add(key);
      validateChoice(rec, `cloze#${questions.length + 1}`, { requirePassage: true });
      questions.push({
        id: `q_${ID_PREFIX}_cloze_${String(questions.length + 1).padStart(4, '0')}`,
        kind: 'cloze',
        part: '读',
        difficulty: clamp01(0.42 + (idx % 5) * 0.05),
        discrimination: 0.4,
        knowledgeTags: [SK.tagBase, `cloze:${sk.id}`, `slot:${b.label}`],
        content: rec,
      });
    });
  }
  return { questions, passages };
}

/**
 * 阅读理解：每篇 5 题 = 细节 3 + 主旨 1 + 词义 1。
 * 正解全部**可从短文里查到**：
 *   · 细节题的正解是填进短文的那个事实值，干扰项取同类池的其它值；
 *   · 主旨题的正解是本篇主旨，干扰项取其它篇的主旨；
 *   · 词义题的正解是文中原词的中文释义，干扰项是同篇其它词的释义。
 */
function buildReading(pool, wl, targetPassages, rand) {
  const questions = [];
  const passages = [];
  const seenQ = new Set();
  const mains = SK.reading.map((s) => s.mainIdea);

  const push = (rec, meta) => {
    const key = (rec.passage || '') + '\u0000' + rec.prompt + '\u0000' + rec.answer;
    if (seenQ.has(key)) return false;
    seenQ.add(key);
    validateChoice(rec, meta.where, { requirePassage: true });
    questions.push({
      id: `q_${ID_PREFIX}_reading_${String(questions.length + 1).padStart(4, '0')}`,
      kind: 'reading',
      part: '读',
      difficulty: meta.difficulty,
      discrimination: 0.4,
      knowledgeTags: [SK.tagBase, `reading:${meta.sk.id}`, meta.skill],
      content: rec,
    });
    return true;
  };

  for (let v = 0; v < targetPassages; v++) {
    const sk = SK.reading[v % SK.reading.length];
    const vi = Math.floor(v / SK.reading.length);
    const fill = makeFiller(`${sk.id}|${vi}|r`, pool);
    const rendered = renderPassage(sk.sents, fill, { blanked: false });
    const text = rendered.text;
    const used = rendered.used;
    const groupId = `reading_${String(passages.length + 1).padStart(3, '0')}`;
    passages.push({ groupId, text });

    /* —— 细节题（每类各一问，互不撞题干） —— */
    // 事实值必须读**短文实际用的那个键**（可能带 `@子池` 后缀）：
    // `{PLACE1@sportPlace}` 在短文里渲染成 playground，若题干却按 `PLACE1`
    // 另取一个地名，正解就和短文对不上了。
    const factValue = (base) => {
      const k = rendered.used.find((u) => u === base || u.startsWith(base + '@')) || base;
      return fill(k, resolvePool(k, pool));
    };
    const DET = {
      when: {
        prompt: 'When did it happen in the story? ___',
        poolKey: 'times',
        value: () => factValue('T1'),
        skill: 'skill:detail-time',
      },
      where: {
        prompt: 'Where did it happen in the story? ___',
        poolKey: 'places',
        value: () => factValue('PLACE1'),
        skill: 'skill:detail-place',
      },
      howMany: {
        // 数量题优先用骨架自带问法；没有则在「全篇只有一个数字」时用通用问法，
        // 数字不止一个就不出这道题（否则正解不唯一）。
        prompt: sk.howManyQ || (rendered.used.filter((k) => /^NUM\d+$/.test(k)).length === 1
          ? 'According to the passage, which number is mentioned? ___'
          : null),
        poolKey: 'nums',
        value: () => factValue('NUM1'),
        skill: 'skill:detail-number',
      },
    };
    (sk.facts || []).slice(0, SK.detailQs).forEach((fact, idx) => {
      const d = DET[fact];
      if (!d || !d.prompt) return;
      const answer = d.value();
      if (!answer) return;
      const decoys = takeDecoys(pool[d.poolKey], answer, vi * 17 + idx * 7);
      if (decoys.length < 3) return;
      push({
        prompt: d.prompt,
        choices: shuffle4([answer, ...decoys], rand),
        answer,
        explain: `短文中明确写到这一信息（${answer}）。`,
        passage: text,
        group: groupId,
      }, {
        where: `reading-detail#${questions.length + 1}`,
        difficulty: clamp01(0.4 + idx * 0.05),
        sk,
        skill: d.skill,
      });
    });

    /* —— 主旨题 —— */
    {
      const decoys = takeDecoys(mains, sk.mainIdea, vi * 3 + 1);
      if (decoys.length === 3) {
        push({
          prompt: 'What is the passage mainly about? ___',
          choices: shuffle4([sk.mainIdea, ...decoys], rand),
          answer: sk.mainIdea,
          explain: `全文围绕「${sk.mainIdea}」展开，因此主旨是它。`,
          passage: text,
          group: groupId,
        }, { where: `reading-main#${questions.length + 1}`, difficulty: clamp01(0.5), sk, skill: 'skill:main-idea' });
      }
    }

    /* —— 词义猜测：只用**确实出现在短文里**的词 —— */
    {
      const glossOf = (w) => {
        const e = wl.get(String(w).toLowerCase());
        if (e && e.short) return e.short;
        // ECDICT tag:ky 只标考研**超纲词**，go/town/question 这类基础词不在表内，
        // 但它们是语义子池的常客 —— 不补则词义题候选不足 4，每篇从 5 题掉到 4 题、
        // 组卷因满员组不够而失败。补丁表由 .cache/lexicons/gloss-patch.json 提供
        // （同样取自 ECDICT，MIT），不进单文件、不影响运行时体积。
        return GLOSS_PATCH[String(w).toLowerCase()] || null;
      };
      // 候选取**短文里出现过的实词**（N/A/V/R）：只用 N* 的话，
      // 名词只有两三个的篇目凑不出 4 个选项，整道词义题会被丢掉。
      const cand = [...new Set(used
        .filter((k) => /^(?:[ANRV]\d+)(?:@\w+)?$/.test(k))
        .map((k) => fill(k, resolvePool(k, fill.pools))))];
      const withGloss = cand.map((w) => [w, glossOf(w)]).filter((p) => p[1]);
      if (process.env.QINGCI_DIAG && passages.length < 3) {
        console.log(`  [diag] ${sk.id} v=${v}: cand=${cand.length} withGloss=${withGloss.length} facts=${(sk.facts || []).length} mains=${mains.length}`);
      }
      if (withGloss.length >= 4) {
        const [target, answer] = withGloss[0];
        const decoys = withGloss.slice(1, 4).map((p) => p[1]);
        push({
          prompt: `The word "${target}" in the passage most probably means ___.`,
          choices: shuffle4([answer, ...decoys], rand),
          answer,
          explain: `结合上下文，此处 "${target}" 指「${answer}」。`,
          passage: text,
          group: groupId,
        }, { where: `reading-gloss#${questions.length + 1}`, difficulty: clamp01(0.55), sk, skill: 'skill:vocab-in-context' });
      }
    }
  }
  return { questions, passages };
}

function buildBankfill(pool, targetPassages, rand) {
  const questions = [];
  const passages = [];
  const seenQ = new Set();
  for (let v = 0; v < targetPassages; v++) {
    const sk = SK.bankfill[v % SK.bankfill.length];
    const vi = Math.floor(v / SK.bankfill.length);
    const fill = makeFiller(`${sk.id}|${vi}|b`, pool);
    const { text, blanks } = renderPassage(sk.sents, fill, { blanked: true });
    if (blanks.length !== 5) {
      console.error(`❌ 选词骨架 ${sk.id} 的空数是 ${blanks.length}（必须 5）`);
      process.exit(1);
    }
    // 词库 = 5 个正确项 + 5 个干扰项；每题的正解是「本空那个词」，整份词库共用。
    // 干扰项从动词/副词/名词池依次补齐（不能用定步长取词：在小池上会原地打转）。
    const bank = blanks.map((b) => b.word);
    for (const pos of ['verbs', 'advs', 'nouns']) {
      if (bank.length >= 10) break;
      const extra = takeDecoys(pool[pos], '', vi * 11 + bank.length, 10 - bank.length);
      for (const w of extra) {
        if (bank.length >= 10) break;
        if (w && !bank.includes(w)) bank.push(w);
      }
    }
    if (bank.length < 10) {
      console.error(`❌ 选词骨架 ${sk.id} 词库凑不满 10 词（只凑到 ${bank.length}）`);
      process.exit(1);
    }
    const shuffledBank = shuffle4(bank.slice(0, 10), rand);
    const groupId = `bankfill_${String(passages.length + 1).padStart(3, '0')}`;
    passages.push({ groupId, text });
    blanks.forEach((b, idx) => {
      const rec = {
        prompt: `短文第 ${idx + 1} 空应从词库中选择：`,
        choices: shuffledBank.slice(),
        answer: b.word,
        explain: `${b.word}：符合此处的句意与词性要求。`,
        passage: text,
        group: groupId,
      };
      const key = text + '\u0000' + rec.prompt + '\u0000' + b.word;
      if (seenQ.has(key)) return;
      seenQ.add(key);
      validateChoice(rec, `bankfill#${questions.length + 1}`, { requirePassage: true, choices: 10 });
      questions.push({
        id: `q_${ID_PREFIX}_bankfill_${String(questions.length + 1).padStart(4, '0')}`,
        kind: 'bankfill',
        part: '读',
        difficulty: clamp01(0.45 + (idx % 5) * 0.05),
        discrimination: 0.42,
        knowledgeTags: [SK.tagBase, `bankfill:${sk.id}`],
        content: rec,
      });
    });
  }
  return { questions, passages };
}

/**
 * 主观题（书面表达 / 读后续写）。
 * `kind` 决定题型与题号段；读后续写多带一段给定原文（content.passage）。
 */
/**
 * 七选五（gapped）：行文抽 5 句成空，每题给同一份 7 句选项（5 正 + 2 干扰）。
 *
 * 句子先过 `renderPassage(blanked:false)` 填槽再抽空 —— 中高考骨架**无槽位**，
 * 该步是恒等变换（输出与旧版逐字节一致）；考研骨架带 {PLACE1}/{NAME} 等槽位，
 * 由此产生**变体篇章**，否则 6 骨架 × 5 空 = 30 题远达不到 500+ 的目标。
 */
function buildGapped(targetPassages, rand, pool) {
  const questions = [];
  const passages = [];
  const seenQ = new Set();
  for (let v = 0; v < targetPassages; v++) {
    const sk = SK.gapped[v % SK.gapped.length];
    const vi = Math.floor(v / SK.gapped.length);
    const fill = makeFiller(`${sk.id}|${vi}`, pool);
    const sents = renderPassage(sk.sents, fill, { blanked: false }).sentences;
    const dists = renderPassage(sk.distractors || [], fill, { blanked: false }).sentences;
    const answers = [];
    let n = 0;
    const text = sents.map((s, i) => {
      if (sk.gaps.indexOf(i) >= 0) { answers.push(s); return `___${++n}___`; }
      return s;
    }).join(' ');
    if (answers.length !== 5 || dists.length !== 2) {
      console.error(`❌ 七选五骨架 ${sk.id} 应为 5 空 + 2 干扰（实为 ${answers.length} + ${dists.length}）`);
      process.exit(1);
    }
    const bank = shuffle4([...answers, ...dists], rand);
    if (bank.length !== 7 || new Set(bank).size !== 7) {
      console.error(`❌ 七选五骨架 ${sk.id} 的 7 句选项出现重复`);
      process.exit(1);
    }
    const groupId = `gapped_${String(passages.length + 1).padStart(3, '0')}`;
    passages.push({ groupId, text });
    answers.forEach((ans, idx) => {
      const rec = {
        prompt: `短文第 ${idx + 1} 处应填入的句子：`,
        choices: bank.slice(),
        answer: ans,
        explain: `该句应放在第 ${idx + 1} 处：它与前后句的指代和逻辑顺序衔接；其余选项接不上。`,
        passage: text,
        group: groupId,
      };
      const key = text + ' ' + rec.prompt + ' ' + ans;
      if (seenQ.has(key)) return;
      seenQ.add(key);
      validateChoice(rec, `gapped#${questions.length + 1}`, { requirePassage: true, choices: 7 });
      questions.push({
        id: `q_${ID_PREFIX}_gapped_${String(questions.length + 1).padStart(4, '0')}`,
        kind: 'gapped',
        part: '读',
        difficulty: clamp01(0.45 + (idx % 5) * 0.05),
        discrimination: 0.4,
        knowledgeTags: [SK.tagBase, `gapped:${sk.id}`],
        content: rec,
      });
    });
  }
  return { questions, passages };
}

/**
 * 语法填空（grammarfill）：短文 10 空，三种空：
 *   Gv = 有提示动词（答案查变位表），Ga = 有提示形容词（comp/sup 规则变化），
 *   Gf = 无提示功能词（答案烧死在骨架里），普通 N/R 空 = 答案取池、干扰同池。
 * 有提示词的空写成 `___1___ (go)`，与真实卷面一致。
 */
function buildGrammarFill(pool, targetPassages, rand) {
  const questions = [];
  const passages = [];
  const seenQ = new Set();
  const verbs = dedupeForms();
  for (let v = 0; v < targetPassages; v++) {
    const sk = SK.grammarfill[v % SK.grammarfill.length];
    const vi = Math.floor(v / SK.grammarfill.length);
    const fill = makeFiller(`${sk.id}|${vi}`, pool);
    const blanks = [];
    let n = 0;
    let abort = false;
    const parts = sk.sents.map((s) => s.replace(/\{([^{}]+)\}/g, (whole, raw) => {
      const gm = raw.match(/^G([vaf])\d+\|([^|]+)\|([^|]+)$/);
      if (gm) {
        const type = gm[1];
        const a = gm[2];
        const b = gm[3];
        n++;
        if (type === 'v') {
          const vf = verbs.find((x) => x.b === a);
          const field = GFORM[b];
          if (!vf || !field || !vf[field]) {
            console.error(`❌ ${sk.id} 动词标记非法：{${raw}}（${a} 不在变位表或缺形态 ${b}）`);
            process.exit(1);
          }
          const answer = vf[field];
          const others = [...new Set([vf.b, vf.s, vf.p, vf.pp, vf.ing])]
            .filter((x) => x && x !== answer).slice(0, 3);
          if (others.length < 3) { abort = true; return whole; } // 变位不充分（put/read 类）→ 弃本篇
          blanks.push({ n, answer, choices: [answer, ...others], hint: a, type: 'verb' });
          return `___${n}___ (${a})`;
        }
        if (type === 'a') {
          const answer = b === 'comp' ? `more ${a}` : `most ${a}`;
          const choices = [...new Set([answer, b === 'comp' ? `most ${a}` : `more ${a}`, a, `less ${a}`])];
          if (choices.length < 4) { abort = true; return whole; }
          blanks.push({ n, answer, choices, hint: a, type: 'adj' });
          return `___${n}___ (${a})`;
        }
        const set = FUNCTION_SETS[b];
        if (!set || !set.includes(a)) {
          console.error(`❌ ${sk.id} 功能词标记非法：{${raw}}（答案不在组 ${b} 里）`);
          process.exit(1);
        }
        const decoys = takeDecoys(set, a, fnv1a(sk.id + raw + vi));
        if (decoys.length < 3) { abort = true; return whole; }
        blanks.push({ n, answer: a, choices: [a, ...decoys], hint: '', type: 'func' });
        return `___${n}___`;
      }
      if (!BLANKABLE.test(raw)) return whole; // NAME/PLACE/NUM 等上下文词原样保留
      n++;
      const word = fill(raw, resolvePool(raw, pool));
      const decoys = takeDecoys(resolvePool(raw, pool), word, fnv1a(sk.id + raw + vi));
      if (!word || decoys.length < 3) { abort = true; return whole; }
      blanks.push({ n, answer: word, choices: [word, ...decoys], hint: '', type: 'content' });
      return `___${n}___`;
    }));
    if (abort || blanks.length !== 10 || parts.join(' ').indexOf('{') >= 0) continue; // 换变体
    const text = parts.join(' ');
    const groupId = `gfill_${String(passages.length + 1).padStart(3, '0')}`;
    passages.push({ groupId, text });
    blanks.forEach((b) => {
      const rec = {
        prompt: `短文第 ${b.n} 空${b.hint ? `（提示词 ${b.hint}）` : ''}应填入：`,
        choices: shuffle4(b.choices, rand),
        answer: b.answer,
        explain: b.type === 'verb'
          ? `按上下文时态/语态应填 ${b.answer}（提示词 ${b.hint}）。`
          : b.type === 'adj'
            ? `按句中 than/the 等标志词应填 ${b.answer}（提示词 ${b.hint}）。`
            : `${b.answer}：该空需要这个功能词，句意才通顺。`,
        passage: text,
        group: groupId,
      };
      const key = text + ' ' + rec.prompt + ' ' + b.answer;
      if (seenQ.has(key)) return;
      seenQ.add(key);
      validateChoice(rec, `gfill#${questions.length + 1}`, { requirePassage: true });
      questions.push({
        id: `q_${ID_PREFIX}_grammarfill_${String(questions.length + 1).padStart(4, '0')}`,
        kind: 'grammarfill',
        part: '读',
        difficulty: clamp01(0.45 + (b.n % 5) * 0.05),
        discrimination: 0.4,
        knowledgeTags: [SK.tagBase, `gfill:${sk.id}`, `type:${b.type}`],
        content: rec,
      });
    });
  }
  return { questions, passages };
}

function buildWriting(tasks, kind, tagBase) {
  const cont = kind === 'continuation';
  return tasks.map((t, i) => ({
    id: `q_${ID_PREFIX}_${kind}_${String(i + 1).padStart(4, '0')}`,
    kind,
    part: '写',
    difficulty: clamp01(cont ? 0.55 : 0.45),
    discrimination: 0.3,
    knowledgeTags: [tagBase, `${kind}:${t.genre}`],
    content: {
      prompt: t.prompt,
      sub: t.sub ? `${t.sub}\n体裁：${t.genre}；词数 ${t.min}–${t.max}。` : `体裁：${t.genre}；词数 ${t.min}–${t.max}。`,
      choices: [],
      answer: '',
      explain: cont
        ? `续写要点：① 与所给段落的情节、时态、人称保持一致；② 两段各自以所给首句开头；`
          + `③ 有冲突、有转折、有收束；④ 字数控制在 ${t.min}–${t.max} 词。`
        : `写作要点：① 覆盖题目全部要点；② 用上 2–3 个学过的高级词或短语；`
          + `③ 注意时态与人称一致；④ 检查拼写与标点。字数控制在 ${t.min}–${t.max} 词。`,
      write: true,
      min: t.min,
      max: t.max,
      ...(t.passage ? { passage: t.passage } : {}),
    },
  }));
}

/**
 * 翻译（英译汉，E4）：素材取自本词库 vocab-detail 的例句 + 中文译文。
 *
 * 为什么用例句而非骨架：考研英译汉考的是整句的语序/时态/从句处理，
 * 语料里的 sentence + translation 天然就是一对「原文 → 参考译文」，
 * 且已过内容红线与许可审查（corpus 主源 MIT）。骨架手写 300+ 句成本过高。
 *
 * 题面给英文、`sample` 给中文参考译文（提交后自评对照），`write: true`。
 * 中文作答的字数统计走 `cjk()`（`wordsOf` 只数英文，且被 utils.test.js 锁死）。
 */
function buildTranslation(target, rand) {
  if (!SK.transDetailDir) {
    console.error('❌ 翻译题需要 detailDir（本词库未配置）');
    process.exit(1);
  }
  const mfPath = path.join(SK.transDetailDir, 'manifest.json');
  if (!fs.existsSync(mfPath)) {
    console.error(`❌ 翻译素材缺失：${mfPath}`);
    process.exit(1);
  }
  const mf = JSON.parse(fs.readFileSync(mfPath, 'utf8'));
  const files = [...new Set(Object.values(mf.files || {}))];
  const pairs = [];
  const seen = new Set();
  for (const f of files) {
    const p = path.join(SK.transDetailDir, f);
    if (!fs.existsSync(p)) continue;
    const detail = JSON.parse(fs.readFileSync(p, 'utf8'));
    for (const d of Object.values(detail)) {
      for (const e of (Array.isArray(d.examples) ? d.examples : [])) {
        const s = String(e && e.sentence || '').trim();
        const t = String(e && e.translation || '').trim();
        if (!s || !t) continue;
        const wc = (s.match(/[A-Za-z]+/g) || []).length;
        // 过滤过短（<8 词）与过长（>40 词）的句子：太短考不出结构，太长判分口径不稳
        if (wc < 8 || wc > 40) continue;
        const key = s.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push({ s, t });
      }
    }
  }
  if (pairs.length < target) {
    console.error(`❌ 翻译素材不足：需 ${target}，实得 ${pairs.length}`);
    process.exit(1);
  }
  // 确定性抽取：洗牌后取前 target（seed 来自词库，两次运行一致）
  for (let i = pairs.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
  }
  const picked = pairs.slice(0, target);
  return picked.map((p, i) => ({
    id: `q_${ID_PREFIX}_trans_${String(i + 1).padStart(4, '0')}`,
    kind: 'trans',
    part: '译',
    difficulty: clamp01(0.5 + (i % 5) * 0.04),
    discrimination: 0.3,
    knowledgeTags: [SK.tagBase, 'trans:sentence'],
    content: {
      prompt: p.s,
      sub: '译成中文（参考译文在提交后给出）',
      choices: [],
      answer: '',
      explain: '对照参考译文，检查语序、时态、从句与关键词是否都译出。',
      write: true,
      min: 15,
      max: 80,
      sample: p.t,
    },
  }));
}


/**
 * 听力短对话（PRETCO 特色，阶段 F）：一段对话 + 一道理解题。
 *
 * 复用既有听力链路 —— 题目带 `passage`（对话文本），`show()` 会因 `speak` 自动
 * 显示播放条（TTS 朗读对话），用户听后选答案。kind 用 `talk`（与 CET-4 卷的
 * 「长对话」同一题型标识，`EXAM_KIND_TITLE` 与 `question-bank.ts` 均已支持）。
 *
 * 变体机制与 cloze/reading 同源：骨架句带槽位 → makeFiller 按 seed 填词 →
 * 每个 vi 一篇新对话。正解是骨架烧死的场景短语，干扰项从 PRETCO_DIALOGUE_DECOYS
 * 确定性取 3 个（与正解不同、互不重复）。
 */
function buildDialogue(target, rand, pool) {
  const sks = PRETCO_DIALOGUE_SKELETONS;
  const DECOYS = PRETCO_DIALOGUE_DECOYS;
  const questions = [];
  const seenQ = new Set();
  for (let v = 0; v < target; v++) {
    const sk = sks[v % sks.length];
    const vi = Math.floor(v / sks.length);
    const fill = makeFiller(`${sk.id}|${vi}|t`, pool);
    const text = renderPassage(sk.sents, fill, { blanked: false }).sentences.join('\n');
    // 干扰项：从 DECOYS 里确定性取 3 个与正解不同的（DECOYS 有 30 条，恒够）
    const poolD = DECOYS.filter((d) => d !== sk.answer);
    const start = (vi * 3 + v) % poolD.length;
    const decoys = [];
    for (let i = 0; i < 3; i++) decoys.push(poolD[(start + i * 7) % poolD.length]);
    if (new Set(decoys).size !== 3 || decoys.includes(sk.answer)) {
      console.error(`❌ 短对话 ${sk.id} 干扰项不唯一或含正解：${JSON.stringify(decoys)}`);
      process.exit(1);
    }
    const key = text + '\u0000' + sk.answer;
    if (seenQ.has(key)) continue;   // 同文本同答案的重复变体跳过
    seenQ.add(key);
    const choices = shuffle4([sk.answer, ...decoys], rand);
    const rec = {
      prompt: sk.question,
      sub: '先听对话，再选最合适的答案。',
      passage: text,
      choices,
      answer: sk.answer,
      explain: `对话的关键信息指向「${sk.answer}」；其余选项与对话内容无关。`,
    };
    validateChoice(rec, `talk#${questions.length + 1}`, { requirePassage: true, choices: 4 });
    questions.push({
      id: `q_${ID_PREFIX}_talk_${String(questions.length + 1).padStart(4, '0')}`,
      kind: 'talk',
      part: '听',
      difficulty: clamp01(0.35 + (v % 5) * 0.05),
      discrimination: 0.35,
      knowledgeTags: [SK.tagBase, `talk:${sk.id}`],
      content: rec,
    });
  }
  if (questions.length < target) {
    console.log(`   （短对话变体去重后 ${questions.length}/${target}，骨架 ${sks.length} 个 × 槽位变体）`);
  }
  return { questions };
}

/* ---------------- 组卷 ---------------- */

/**
 * 模拟卷（按词库的 plan 组卷）：
 *   `direct` 项按卷取 count 题（卷间切片错开，天然不重叠）；
 *   `group` 项**整组取**（篇章完整：完形 10 空一篇、七选五 5 空一篇、阅读按篇 4/5 题）。
 *
 * 「整篇取用」是硬要求：只把一篇完形的第 3 空塞进卷子，学生读不到上下文。
 * 组大小不匹配的篇章一律不用（比如词义题没凑出 4 个选项、少一题的阅读篇）。
 */
function buildPapers(byKind, plan, names, keys) {
  const papers = {};
  const used = new Set();

  const takeGroups = (list, perGroup, groupsNeeded, startIdx) => {
    const groups = new Map();
    for (const q of list) {
      const g = (q.content && q.content.group) || q.id;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(q);
    }
    const allKeys = [...groups.keys()];
    const rotated = [...allKeys.slice(startIdx % (allKeys.length || 1)), ...allKeys.slice(0, startIdx % (allKeys.length || 1))];
    const picked = [];
    let taken = 0;
    for (const g of rotated) {
      if (taken >= groupsNeeded) break;
      const arr = groups.get(g);
      if (arr.length !== perGroup) continue;
      if (arr.some((q) => used.has(q.id))) continue;
      picked.push(...arr);
      taken++;
    }
    return { picked, ok: taken >= groupsNeeded };
  };

  for (let p = 0; p < keys.length; p++) {
    const all = [];
    const structure = {};
    const miss = [];
    for (const step of plan) {
      const list = byKind[step.kind] || [];
      if (step.type === 'direct') {
        const slice = list.slice(p * step.count, p * step.count + step.count);
        if (slice.length !== step.count) miss.push(`${step.kind} ${slice.length}/${step.count}`);
        all.push(...slice);
        structure[step.kind] = slice.length;
      } else {
        const t = takeGroups(list, step.per, step.groups, p * (step.groups + 2));
        if (!t.ok) miss.push(`${step.kind} ${t.picked.length}/${step.per * step.groups}`);
        all.push(...t.picked);
        structure[step.kind] = t.picked.length;
      }
    }
    if (miss.length) {
      console.error(`❌ ${names[p]} 组卷失败：${miss.join('、')}（满员组不足或题量不够）`);
      process.exit(1);
    }
    if (all.some((q) => used.has(q.id))) {
      console.error(`❌ ${names[p]} 与前一套卷子题号重叠`);
      process.exit(1);
    }
    all.forEach((q) => used.add(q.id));
    papers[keys[p]] = { name: names[p], structure, ids: all.map((q) => q.id) };
  }
  return papers;
}

/* ---------------- 落盘 ---------------- */

function writeShards(outDir, lexiconId, byKind) {
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of fs.readdirSync(outDir)) fs.unlinkSync(path.join(outDir, f));
  const kinds = {};
  let total = 0;
  const bytes = {};
  const gz = {};
  for (const [kind, list] of Object.entries(byKind)) {
    if (!list.length) continue;
    const shard = {
      schema: BANK_SCHEMA,
      lexicon: lexiconId,
      kind,
      questions: list,
    };
    const text = JSON.stringify(shard) + '\n';
    const buf = Buffer.from(text, 'utf8');
    const size = buf.length;
    if (size > MAX_SHARD_BYTES) {
      console.error(`❌ 分片 ${kind} 为 ${(size / 1e6).toFixed(2)} MB，超过 1.5 MB 上限`);
      process.exit(1);
    }
    fs.writeFileSync(path.join(outDir, `${kind}.json`), text, 'utf8');
    kinds[kind] = { file: `${kind}.json`, count: list.length };
    bytes[kind] = size;
    gz[kind] = zlib.gzipSync(buf, { level: 9 }).length;
    total += list.length;
  }
  return { kinds, total, bytes, gz };
}

function writeManifest(outDir, lexiconId, exam, kinds, byKind, papers, papersIndex, plan) {
  const byKindCount = {};
  for (const [k, v] of Object.entries(byKind)) byKindCount[k] = v.length;
  const manifest = {
    schema: EXAM_SCHEMA,
    lexicon: lexiconId,
    exam,
    counts: { total: Object.values(byKindCount).reduce((a, b) => a + b, 0), byKind: byKindCount },
    kinds,
    // 组卷计划随清单下发：验收脚本据此知道每套卷该由哪些组构成
    plan,
    papers,
    papersIndex,
  };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return manifest;
}

/* ---------------- 主流程 ---------------- */

function main() {
  const argv = process.argv.slice(2);
  const li = argv.indexOf('--lexicon');
  const lexId = li >= 0 ? argv[li + 1] : 'junior';
  const L = LEXICONS[lexId];
  if (!L) {
    console.error(`❌ 未知词库：${lexId}（可用：${Object.keys(LEXICONS).join(' / ')}）`);
    process.exit(1);
  }
  const oi = argv.indexOf('--out');
  const outDir = oi >= 0 ? path.resolve(argv[oi + 1]) : L.outDir;
  const quiet = argv.includes('--quiet');

  const { map: wl } = loadWordlist(L.wordlist);
  /**
   * 词池过滤：优先取「在词表里的词」，但**过滤后不足 4 个就回退到完整素材池**。
   *
   * 为什么需要这个回退：GRE 词表是**高难词**（abandon / abstruse / …），
   * 而骨架素材用的是基础词（big / small / happy）—— 按 GRE 词表过滤后
   * adjs 只剩 3 个，直接把构建拦死。这与 colors / places 当初的情形完全同源。
   *
   * 取舍：骨架句里的基础词不是「学习目标词」，它们只是**语法骨架的填充物**；
   * 用完整池不会让用户误以为要背 big/small。反过来若强行只用 GRE 词，
   * 骨架句会变得佶屈聱牙，反而不像正常英语。
   */
  const poolOrAll = (src) => (poolIn(src, wl).length >= 4 ? poolIn(src, wl) : src.slice());
  const pool = {
    nouns: poolOrAll(NOUNS),
    adjs: poolOrAll(ADJ_QUALITY),
    colors: poolOrAll(ADJ_COLOR),
    advs: poolOrAll(ADVS),
    verbs: poolOrAll(VERBS_BASE),
    names: NAMES.slice(),
    places: poolOrAll(PLACES),
    times: TIMES.slice(),
    nums: NUMS.slice(),
    // 语义子池**不过滤词表**：SLOTS 里有 ran/won 这类课标词的变形，
    // 按字面查词表会全被剔掉（词表只收原形）。它们是人工核过的短表。
    // 高中素材的子池（SENIOR_SLOTS）并进来，两个学段的骨架都能查到。
    slot: { ...SLOTS, ...SENIOR_SLOTS },
  };
  for (const [k, v] of Object.entries(pool)) {
    if (v.length < 4) {
      console.error(`❌ 词池 ${k} 只有 ${v.length} 词，无法出题`);
      process.exit(1);
    }
  }
  for (const [k, v] of Object.entries(SLOTS)) {
    if (!Array.isArray(v) || v.length < 2 || v.some((w) => !w)) {
      console.error(`❌ 语义子池 ${k} 不合法：${JSON.stringify(v)}`);
      process.exit(1);
    }
  }

  const rand = mulberry32(fnv1a(`qingci-exam-bank|${lexId}`));

  // 素材集与题号前缀按词库切（同引擎、不同学段的题型与行文）
  ID_PREFIX = L.prefix;
  const isKao = L.content === 'kaoyan';
  const isSen = L.content === 'senior';
  SK = {
    cloze: isKao ? KAOYAN_CLOZE_SKELETONS : isSen ? SENIOR_CLOZE_SKELETONS : CLOZE_SKELETONS,
    reading: isKao ? KAOYAN_READING_SKELETONS : isSen ? SENIOR_READING_SKELETONS : READING_SKELETONS,
    bankfill: BANKFILL_SKELETONS,
    gapped: isKao ? KAOYAN_GAPPED_SKELETONS : GAPPED_SKELETONS,
    grammarfill: SENIOR_GRAMMAR_FILL_SKELETONS,
    detailQs: L.detailQs,
    tagBase: L.id,
    // 完形空数：中考/高考 10 空，考研 20 空（L.clozeBlanks 未设则回落 10）
    clozeBlanks: L.clozeBlanks || 10,
    // 翻译（英译汉）素材：从该词库的 vocab-detail 例句取（E4）
    transDetailDir: L.detailDir || null,
  };

  console.log(`🔨 [${lexId}] 生成 ${L.label}题库（词表 ${wl.size} 词）…`);
  const byKind = {};
  for (const step of L.plan) {
    const t = L.targets[step.kind] || 0;
    const pass = step.type === 'group' ? `${t} 篇` : '';
    switch (step.kind) {
      case 'grammar':
        byKind.grammar = buildGrammar(pool, t, rand);
        break;
      case 'cloze':
        byKind.cloze = buildCloze(pool, wl, t, rand).questions;
        break;
      case 'reading':
        byKind.reading = buildReading(pool, wl, t, rand).questions;
        break;
      case 'bankfill':
        byKind.bankfill = buildBankfill(pool, t, rand).questions;
        break;
      case 'gapped':
        byKind.gapped = buildGapped(t, rand, pool).questions;
        break;
      case 'trans':
        // 英译汉（E4/F3）：素材取自本词库 vocab-detail 的例句 + 中文译文
        byKind.trans = buildTranslation(t, rand);
        break;
      case 'talk':
        // 听力短对话（F3 PRETCO 特色）：21 骨架 × 槽位变体
        byKind.talk = buildDialogue(t, rand, pool).questions;
        break;
      case 'grammarfill':
        byKind.grammarfill = buildGrammarFill(pool, t, rand).questions;
        break;
      case 'writing':
        byKind.writing = buildWriting(
          isKao ? KAOYAN_WRITING : isSen ? SENIOR_WRITING
            : L.content === 'pretco' ? PRETCO_WRITING
              : L.content === 'gre' ? GRE_WRITING : WRITING_TASKS, 'writing', L.id);
        break;
      case 'continuation':
        byKind.continuation = buildWriting(SENIOR_CONTINUATION, 'continuation', L.id);
        break;
      default:
        console.error(`❌ 未知题型 ${step.kind}`);
        process.exit(1);
    }
    const label = {
      grammar: '语法选择', cloze: '完形填空', reading: '阅读理解', bankfill: '选词填空',
      gapped: '七选五', grammarfill: '语法填空', writing: '书面表达', continuation: '读后续写',
      trans: '英译汉', talk: '听力短对话',
    }[step.kind];
    console.log(`   ${label} ${byKind[step.kind].length}${pass ? `（${pass}）` : ''}`);
  }

  const total = Object.values(byKind).reduce((a, b) => a + b.length, 0);
  if (process.env.QINGCI_DIAG) {
    for (const [k, list] of Object.entries(byKind)) {
      const g = new Map();
      for (const q of list) { const id = (q.content && q.content.group) || q.id; g.set(id, (g.get(id) || 0) + 1); }
      const hist = {};
      for (const n of g.values()) hist[n] = (hist[n] || 0) + 1;
      console.log(`  [diag] ${k}: 组 ${g.size} · 组大小分布 ${JSON.stringify(hist)}`);
    }
  }
  if (total < 3000 || total > 5000) {
    console.error(`❌ 题量 ${total} 超出 3000–5000 区间`);
    process.exit(1);
  }
  // 保底题量：刷题主体 ≥100，主观题与小题型按其真实产出定下限
  const FLOOR = {
    grammar: 100, cloze: 100, reading: 100, bankfill: 100, grammarfill: 100,
    gapped: 5, writing: 30, continuation: 10, trans: 100,
  };
  for (const [k, v] of Object.entries(byKind)) {
    const floor = FLOOR[k] ?? 100;
    if (v.length < floor) {
      console.error(`❌ 题型 ${k} 只有 ${v.length} 题（至少 ${floor}）`);
      process.exit(1);
    }
  }

  const papers = buildPapers(byKind, L.plan, L.paperNames, L.paperKeys);
  const { kinds, bytes, gz } = writeShards(outDir, lexId, byKind);
  const manifest = writeManifest(outDir, lexId, L.exam, kinds, byKind, papers, L.paperKeys, L.plan);

  if (!quiet) {
    const raw = Object.values(bytes).reduce((a, b) => a + b, 0);
    const gzTotal = Object.values(gz).reduce((a, b) => a + b, 0);
    const maxBytes = Math.max(...Object.values(bytes));
    const paperCount = Object.keys(papers).length;
    const paperLen = paperCount ? papers[L.paperKeys[0]].ids.length : 0;
    console.log(`📘 [${lexId}] ${L.label}题库已生成: ${path.relative(ROOT, outDir)}/`);
    console.log(`   题量: ${total}（${Object.entries(byKind).map(([k, v]) => `${k} ${v.length}`).join(' · ')}）`);
    console.log(`   分片: ${Object.keys(bytes).length} 个，最大 ${(maxBytes / 1024).toFixed(1)} KB（上限 1464.8 KB）`);
    console.log(`   模拟卷: ${paperCount} 套 × ${paperLen} 题`);
    console.log(`   体积: raw ${(raw / 1024 / 1024).toFixed(2)} MB（gzip ${(gzTotal / 1024 / 1024).toFixed(2)} MB）`);
    console.log(`   模拟卷构成: ${JSON.stringify(manifest.papers[L.paperKeys[0]].structure)}`);
  }
}

main();