'use strict';
/**
 * 核心业务逻辑：六种记忆题型的生成与判分
 * 与 DOM 解耦，输入词库与随机种子，输出题目对象。
 */
const { hash, rng, pick, shuffleOptions, posOf, checkSpell } = require('./utils');

/** 背词题型清单（按记忆通道排序） */
const MEMORY_KINDS = ['zh2en', 'en2zh', 'similar', 'listen', 'spell', 'pos'];

/** 题型中文名 */
const KIND_LABEL = {
  zh2en: '中译英', en2zh: '英译中', similar: '形近辨析',
  listen: '听音辨词', spell: '拼写默写', pos: '词性判断',
};

/** 词性完整标签 */
const POS_LABEL = {
  'n.': '名词 n.', 'a.': '形容词 a.', 'vt.': '及物动词 vt.', 'vi.': '不及物动词 vi.',
  'ad.': '副词 ad.', 'pron.': '代词 pron.', 'prep.': '介词 prep.', 'conj.': '连词 conj.',
  'num.': '数词 num.', 'int.': '感叹词 int.', 'art.': '冠词 art.',
  'aux.v.': '助动词 aux.v.', 'v.aux.': '助动词 v.aux.',
};

/**
 * 挑选形近词：优先同前缀、长度相近，不足时从全库补足
 * @param {object} words 全量词库
 * @param {object} item 目标词
 * @param {number} n 需要数量
 */
function similarWords(words, item, n, rand) {
  const cut = Math.max(2, item.w.length - 2);
  const same = words.filter((x) => x.w !== item.w && (
    x.w.slice(0, cut) === item.w.slice(0, cut) ||
    Math.abs(x.w.length - item.w.length) <= 1
  ));
  const bag = same.length >= n ? same : words.filter((x) => x.w !== item.w);
  return pick(bag, n, rand);
}

/**
 * 生成一道记忆题
 * @param {string} kind MEMORY_KINDS 之一
 * @param {object} ctx  { words, meta, index, seedText }
 * @returns {object} 题目对象
 */
function makeMemoryQuestion(kind, ctx) {
  const { words, meta, index } = ctx;
  if (!MEMORY_KINDS.includes(kind)) throw new Error('未知题型: ' + kind);
  const rand = rng(hash(ctx.seedText || ('mem|' + kind + '|' + ((meta && meta.id) || '') + '|' + index)));
  const item = words[Math.floor(rand() * words.length)];
  const distract = (n) => pick(words.filter((x) => x.w !== item.w && x.short !== item.short), n, rand);
  const base = { kind: 'words', memKind: kind, word: item.w, answer: item.w,
    explain: item.w + ' ' + (item.ipa || '') + ' ' + item.zh };

  if (kind === 'en2zh') {
    const opts = shuffleOptions([item, ...distract(3)], rand);
    return { ...base, prompt: item.w, sub: item.ipa || '选出正确释义',
      choices: opts.map((x) => x.short), answer: item.short, explain: item.w + ' ' + (item.ipa || '') + ' ' + item.zh };
  }
  if (kind === 'similar') {
    const opts = shuffleOptions([item, ...similarWords(words, item, 3, rand)], rand);
    return { ...base, prompt: item.short, sub: '选出拼写与释义匹配的单词',
      choices: opts.map((x) => x.w), answer: item.w };
  }
  if (kind === 'listen') {
    const opts = shuffleOptions([item, ...distract(3)], rand);
    return { ...base, prompt: '🔊 点击播放，听音选词', sub: '可重复播放，注意重音和尾音',
      choices: opts.map((x) => x.w), answer: item.w, speak: item.w };
  }
  if (kind === 'spell') {
    const head = item.w[0];
    const tail = item.w.slice(1).replace(/[a-zA-Z]/g, '_');
    return { kind: 'spell', memKind: 'spell', word: item.w, answer: item.w,
      prompt: item.short, sub: (item.ipa || '') + ' · ' + item.w.length + ' 个字母',
      explain: item.w + ' ' + (item.ipa || '') + ' ' + item.zh,
      hint: item.w.length, tpl: head + tail };
  }
  if (kind === 'pos') {
    const p = posOf(item.zh);
    const pool = Object.keys(POS_LABEL).filter((k) => k !== p);
    const opts = shuffleOptions([p, ...pick(pool, 3, rand)], rand);
    return { ...base, prompt: item.w, sub: item.ipa || '判断这个词在本义项中的词性',
      choices: opts.map((x) => POS_LABEL[x] || x), answer: POS_LABEL[p] || p, explain: item.w + ' ' + item.zh };
  }
  // zh2en（默认）
  const opts = shuffleOptions([item, ...distract(3)], rand);
  return { ...base, prompt: item.short, sub: item.ipa || '',
    choices: opts.map((x) => x.w), answer: item.w };
}

/**
 * 按索引轮换题型，生成下一题
 */
function memoryQuestion(ctx, kind) {
  const rotateList = ctx.rotate === false ? [1] : [1];
  void rotateList;
  const k = kind || MEMORY_KINDS[(ctx.memKind || 0) % MEMORY_KINDS.length];
  return makeMemoryQuestion(k, { ...ctx, index: ctx.index || 0 });
}

/** 判定选择题答案是否正确 */
function judgeChoice(question, pickedIndex) {
  if (!question || !Array.isArray(question.choices)) return false;
  return question.choices[pickedIndex] === question.answer;
}

/** 判定一道题作答结果，兼容拼写题与选择题 */
function judge(question, answer) {
  if (!question) return { ok: false, near: false };
  if (question.kind === 'spell') return checkSpell(answer, question.answer);
  return { ok: String(answer) === String(question.answer), near: false };
}

/** 记录某题型的对错到统计表（返回新对象，便于测试） */
function recordMemStat(stats, memKind, ok) {
  const out = { ...(stats || {}) };
  if (!memKind) return out;
  const rec = out[memKind] ? { ...out[memKind] } : { r: 0, n: 0 };
  rec.n += 1;
  if (ok) rec.r += 1;
  out[memKind] = rec;
  return out;
}

/** 计算某题型正确率 */
function kindAccuracy(rec) {
  if (!rec || !rec.n) return null;
  return Math.round((rec.r / rec.n) * 100);
}

module.exports = {
  MEMORY_KINDS, KIND_LABEL, POS_LABEL,
  similarWords, makeMemoryQuestion, memoryQuestion,
  judgeChoice, judge, recordMemStat, kindAccuracy,
};
