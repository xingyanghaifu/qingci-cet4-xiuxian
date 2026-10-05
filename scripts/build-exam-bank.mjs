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
} from './exam-bank-content.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MAX_SHARD_BYTES = 1_500_000;
const BANK_SCHEMA = 'qingci-question-bank/1';
const EXAM_SCHEMA = 'qingci-exam-bank/1';

/** 各词库的词源与产出位置（阶段 A 初中 / 阶段 B 高中共用） */
const LEXICONS = {
  junior: {
    id: 'junior', exam: 'zhongkao', label: '中考',
    wordlist: path.join(ROOT, 'src', 'data', 'lexicons', 'junior', 'wordlist.json'),
    outDir: path.join(ROOT, 'src', 'data', 'lexicons', 'junior', 'question-bank'),
    paperNames: ['中考模拟卷一', '中考模拟卷二', '中考模拟卷三'],
    paperKeys: ['zk-01', 'zk-02', 'zk-03'],
  },
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
      id: `q_jun_grammar_${String(questions.length + 1).padStart(4, '0')}`,
      kind: 'grammar',
      part: '读',
      difficulty: clamp01(0.3 + ((questions.length % 7) * 0.05)),
      discrimination: 0.4,
      knowledgeTags: ['junior', `grammar:${f.tag}`, `rule:${fnv1a(f.rule) % 1000}`],
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
    if (!v) v = list[0]; // 池子被占满的极端情况（正常不会发生）
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
  for (let v = 0; v < targetPassages; v++) {
    const sk = CLOZE_SKELETONS[v % CLOZE_SKELETONS.length];
    const vi = Math.floor(v / CLOZE_SKELETONS.length);
    const fill = makeFiller(`${sk.id}|${vi}`, pool);
    const rendered = renderPassage(sk.sents, fill, { blanked: true });
    const { text, blanks, sentences } = rendered;
    if (blanks.length !== 10) {
      console.error(`❌ 完形骨架 ${sk.id} 的空数是 ${blanks.length}（必须 10）`);
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
        id: `q_jun_cloze_${String(questions.length + 1).padStart(4, '0')}`,
        kind: 'cloze',
        part: '读',
        difficulty: clamp01(0.42 + (idx % 5) * 0.05),
        discrimination: 0.4,
        knowledgeTags: ['junior', `cloze:${sk.id}`, `slot:${b.label}`],
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
  const mains = READING_SKELETONS.map((s) => s.mainIdea);

  const push = (rec, meta) => {
    const key = (rec.passage || '') + '\u0000' + rec.prompt + '\u0000' + rec.answer;
    if (seenQ.has(key)) return false;
    seenQ.add(key);
    validateChoice(rec, meta.where, { requirePassage: true });
    questions.push({
      id: `q_jun_reading_${String(questions.length + 1).padStart(4, '0')}`,
      kind: 'reading',
      part: '读',
      difficulty: meta.difficulty,
      discrimination: 0.4,
      knowledgeTags: ['junior', `reading:${meta.sk.id}`, meta.skill],
      content: rec,
    });
    return true;
  };

  for (let v = 0; v < targetPassages; v++) {
    const sk = READING_SKELETONS[v % READING_SKELETONS.length];
    const vi = Math.floor(v / READING_SKELETONS.length);
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
    (sk.facts || []).slice(0, 3).forEach((fact, idx) => {
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
        return e && e.short ? e.short : null;
      };
      // 候选取**短文里出现过的实词**（N/A/V/R）：只用 N* 的话，
      // 名词只有两三个的篇目凑不出 4 个选项，整道词义题会被丢掉。
      const cand = [...new Set(used
        .filter((k) => /^(?:[ANRV]\d+)(?:@\w+)?$/.test(k))
        .map((k) => fill(k, resolvePool(k, fill.pools))))];
      const withGloss = cand.map((w) => [w, glossOf(w)]).filter((p) => p[1]);
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
    const sk = BANKFILL_SKELETONS[v % BANKFILL_SKELETONS.length];
    const vi = Math.floor(v / BANKFILL_SKELETONS.length);
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
        id: `q_jun_bankfill_${String(questions.length + 1).padStart(4, '0')}`,
        kind: 'bankfill',
        part: '读',
        difficulty: clamp01(0.45 + (idx % 5) * 0.05),
        discrimination: 0.42,
        knowledgeTags: ['junior', `bankfill:${sk.id}`],
        content: rec,
      });
    });
  }
  return { questions, passages };
}

function buildWriting() {
  return WRITING_TASKS.map((t, i) => ({
    id: `q_jun_writing_${String(i + 1).padStart(4, '0')}`,
    kind: 'writing',
    part: '写',
    difficulty: clamp01(0.45),
    discrimination: 0.3,
    knowledgeTags: ['junior', `writing:${t.genre}`],
    content: {
      prompt: t.prompt,
      sub: `体裁：${t.genre}；词数 ${t.min}–${t.max}。`,
      choices: [],
      answer: '',
      explain: `写作要点：① 覆盖题目全部要点；② 用上 2–3 个学过的高级词或短语；`
        + `③ 注意时态与人称一致；④ 检查拼写与标点。字数控制在 ${t.min}–${t.max} 词。`,
      write: true,
      min: t.min,
      max: t.max,
    },
  }));
}

/* ---------------- 组卷 ---------------- */

/**
 * 模拟卷：中考结构 = 语法 14 + 完形 10（一整篇）+ 阅读 10（两整篇）+ 选词 5（一整篇）+ 写作 1 = 40
 *
 * 「整篇取用」是硬要求：只把一篇完形的第 3 空塞进卷子，学生读不到上下文。
 * 分组大小必须严丝合缝（完形 10 / 阅读每篇 5 / 选词每篇 5），
 * 组大小不匹配的篇章一律不用（比如词义题没凑出 4 个选项、只有 4 题的阅读篇）。
 */
function buildPapers(byKind, names, keys) {
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
    const grammar = byKind.grammar.slice(p * 14, p * 14 + 14);
    const cloze = takeGroups(byKind.cloze, 10, 1, p * 3);
    const reading = takeGroups(byKind.reading, 5, 2, p * 4);
    const bankfill = takeGroups(byKind.bankfill, 5, 1, p * 3);
    const writing = byKind.writing.slice(p, p + 1);
    const all = [...grammar, ...cloze.picked, ...reading.picked, ...bankfill.picked, ...writing];
    if (grammar.length !== 14 || !cloze.ok || !reading.ok || !bankfill.ok || writing.length !== 1 || all.length !== 40) {
      console.error(`❌ ${names[p]} 组卷失败：语法 ${grammar.length}/14、完形 ${cloze.picked.length}/10、`
        + `阅读 ${reading.picked.length}/10、选词 ${bankfill.picked.length}/5、写作 ${writing.length}/1`);
      process.exit(1);
    }
    if (all.some((q) => used.has(q.id))) {
      console.error(`❌ ${names[p]} 与前一套卷子题号重叠`);
      process.exit(1);
    }
    all.forEach((q) => used.add(q.id));
    papers[keys[p]] = {
      name: names[p],
      structure: { grammar: 14, cloze: 10, reading: 10, bankfill: 5, writing: 1 },
      ids: all.map((q) => q.id),
    };
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

function writeManifest(outDir, lexiconId, exam, kinds, byKind, papers, papersIndex) {
  const byKindCount = {};
  for (const [k, v] of Object.entries(byKind)) byKindCount[k] = v.length;
  const manifest = {
    schema: EXAM_SCHEMA,
    lexicon: lexiconId,
    exam,
    counts: { total: Object.values(byKindCount).reduce((a, b) => a + b, 0), byKind: byKindCount },
    kinds,
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
  const pool = {
    nouns: poolIn(NOUNS, wl),
    adjs: poolIn(ADJ_QUALITY, wl),
    colors: poolIn(ADJ_COLOR, wl),
    advs: poolIn(ADVS, wl),
    verbs: poolIn(VERBS_BASE, wl),
    names: NAMES.slice(),
    places: poolIn(PLACES, wl).length >= 5 ? PLACES.filter((p) => wl.has(p)) : PLACES,
    times: TIMES.slice(),
    nums: NUMS.slice(),
    // 语义子池**不过滤词表**：SLOTS 里有 ran/won 这类课标词的变形，
    // 按字面查词表会全被剔掉（词表只收原形）。它们是人工核过的短表。
    slot: SLOTS,
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

  console.log(`🔨 [${lexId}] 生成 ${L.label}题库（词表 ${wl.size} 词）…`);
  const grammar = buildGrammar(pool, 2400, rand);
  console.log(`   语法选择 ${grammar.length}`);
  const cloze = buildCloze(pool, wl, 96, rand);
  console.log(`   完形填空 ${cloze.questions.length}（${96} 篇 × 10 空）`);
  const reading = buildReading(pool, wl, 144, rand);
  console.log(`   阅读理解 ${reading.questions.length}（${144} 篇 × 5 题）`);
  const bankfill = buildBankfill(pool, 140, rand);
  console.log(`   选词填空 ${bankfill.questions.length}（${140} 篇 × 5 空）`);
  const writing = buildWriting();
  console.log(`   书面表达 ${writing.length}`);

  const byKind = {
    grammar,
    cloze: cloze.questions,
    reading: reading.questions,
    bankfill: bankfill.questions,
    writing,
  };
  const total = Object.values(byKind).reduce((a, b) => a + b.length, 0);
  if (total < 3000 || total > 5000) {
    console.error(`❌ 题量 ${total} 超出 3000–5000 区间`);
    process.exit(1);
  }
  for (const [k, v] of Object.entries(byKind)) {
    // 书面表达是开放题、每卷只出 1 篇，30 个互不相同的任务已远超日常练习量；
    // 客观题（语法/完形/阅读/选词）才是刷题主体，保底 100。
    const floor = k === 'writing' ? 30 : 100;
    if (v.length < floor) {
      console.error(`❌ 题型 ${k} 只有 ${v.length} 题（至少 ${floor}）`);
      process.exit(1);
    }
  }

  const papers = buildPapers(byKind, L.paperNames, L.paperKeys);
  const { kinds, bytes, gz } = writeShards(outDir, lexId, byKind);
  const manifest = writeManifest(outDir, lexId, L.exam, kinds, byKind, papers, L.paperKeys);

  if (!quiet) {
    const raw = Object.values(bytes).reduce((a, b) => a + b, 0);
    const gzTotal = Object.values(gz).reduce((a, b) => a + b, 0);
    const maxBytes = Math.max(...Object.values(bytes));
    console.log(`📘 [${lexId}] ${L.label}题库已生成: ${path.relative(ROOT, outDir)}/`);
    console.log(`   题量: ${total}（${Object.entries(byKind).map(([k, v]) => `${k} ${v.length}`).join(' · ')}）`);
    console.log(`   分片: ${Object.keys(bytes).length} 个，最大 ${(maxBytes / 1024).toFixed(1)} KB（上限 1464.8 KB）`);
    console.log(`   模拟卷: ${Object.keys(papers).length} 套 × 40 题`);
    console.log(`   体积: raw ${(raw / 1024 / 1024).toFixed(2)} MB（gzip ${(gzTotal / 1024 / 1024).toFixed(2)} MB）`);
    console.log(`   模拟卷构成: ${JSON.stringify(manifest.papers[L.paperKeys[0]].structure)}`);
  }
}

main();