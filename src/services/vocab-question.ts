/**
 * 由单词生成复习题目（P1 任务 A）
 *
 * 与固化题库的关系：
 *   - 题库里的词汇题 id 是 `q_vocab_<词序>_<题型>`（词序 = 词库中的下标）；
 *   - 本模块按同一规则生成 id，因此 SRS 复习答错时写进错题本的 id 与题库一一对应，
 *     在错题本里点开就能看到题库存的题干与解析。
 *
 * 题型与题库一致：en2zh / zh2en / listen / similar / spell（按需选择）。
 */
import { seededRng } from '../types/question-bank';
import type { LexiconEntry } from './vocab-enrich';

export type VocabQuestionKind = 'en2zh' | 'zh2en' | 'listen' | 'similar' | 'spell';

export interface VocabQuestion {
  kind: string;
  memKind: VocabQuestionKind;
  title: string;
  prompt: string;
  sub: string;
  choices: string[];
  answer: string;
  explain: string;
  word: string;
  speak?: string;
  tpl?: string;
  hint?: number;
  questionId: string;
 /** 复习会话用它回写 SRS */
  vocabWord: string;
}

/** 由词库下标生成与题库一致的题目 id */
export function bankIdFor(index: number, kind: VocabQuestionKind, width = 4): string {
  return `q_vocab_${String(index).padStart(width, '0')}_${kind}`;
}

/** 稳定种子：同一个词 + 同一题型每次都得到同样的选项顺序 */
function seedFor(word: string, kind: VocabQuestionKind, salt: number): number {
  let h = 2166136261;
  for (const ch of `${word}|${kind}|${salt}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h >>> 0;
}

/** 取干扰项：优先释义不同、拼写不同的词 */
function distractors(
  entry: LexiconEntry,
  lexicon: LexiconEntry[],
  rand: () => number,
  n: number,
  mode: 'short' | 'word' | 'similar',
): LexiconEntry[] {
  const out: LexiconEntry[] = [];
  const usedShort = new Set([String(entry.short || '').trim()]);
  const usedWord = new Set([entry.w]);
  const near = mode === 'similar';
  let guard = 0;
  while (out.length < n && guard < lexicon.length * 4) {
    guard++;
    const candidate = lexicon[Math.floor(rand() * lexicon.length)];
    if (!candidate || usedWord.has(candidate.w)) continue;
    const short = String(candidate.short || '').trim();
    if (!short || usedShort.has(short)) continue;
    if (near) {
      const sameHead = candidate.w.slice(0, Math.max(2, entry.w.length - 2)) === entry.w.slice(0, Math.max(2, entry.w.length - 2));
      const lenClose = Math.abs(candidate.w.length - entry.w.length) <= 1;
      if (!sameHead && !lenClose) continue;
    }
    usedWord.add(candidate.w);
    usedShort.add(short);
    out.push(candidate);
  }
  return out;
}

const TITLES: Record<VocabQuestionKind, string> = {
  en2zh: '英译中',
  zh2en: '中译英',
  listen: '听音辨词',
  similar: '形近辨析',
  spell: '拼写默写',
};

/**
 * 生成一道词汇复习题
 * @param index 词库下标（用于题库一致的 questionId）
 */
export function buildVocabQuestion(
  entry: LexiconEntry,
  index: number,
  kind: VocabQuestionKind,
  lexicon: LexiconEntry[],
  options: { salt?: number } = {},
): VocabQuestion {
  const salt = options.salt ?? 0;
  const rand = seededRng(seedFor(entry.w, kind, salt));
  const ipa = entry.ipa || '';
  const gloss = String(entry.short || entry.zh || '');
  const questionId = bankIdFor(index, kind);

  if (kind === 'spell') {
    const head = entry.w[0];
    const tail = entry.w.slice(1).replace(/[a-zA-Z]/g, '_');
    return {
      kind: 'spell',
      memKind: 'spell',
      title: '间隔复习 · 拼写默写',
      prompt: gloss,
      sub: `${ipa} · ${entry.w.length} 个字母`,
      choices: [],
      answer: entry.w,
      explain: `${entry.w} ${ipa} ${entry.zh || ''}`.trim(),
      word: entry.w,
      tpl: head + tail,
      hint: entry.w.length,
      questionId,
      vocabWord: entry.w,
    };
  }

  if (kind === 'en2zh' || kind === 'zh2en') {
    const pool = distractors(entry, lexicon, rand, 3, 'short');
    const ordered = [entry, ...pool].map((x) => [rand(), x] as [number, LexiconEntry]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
    const askEnglish = kind === 'en2zh';
    return {
      kind: 'words',
      memKind: kind,
      title: `间隔复习 · ${TITLES[kind]}`,
      prompt: askEnglish ? entry.w : gloss,
      sub: askEnglish ? ipa : '',
      choices: ordered.map((x) => (askEnglish ? String(x.short || '') : x.w)),
      answer: askEnglish ? gloss : entry.w,
      explain: `${entry.w} ${ipa} ${entry.zh || ''}`.trim(),
      word: entry.w,
      questionId,
      vocabWord: entry.w,
    };
  }

  if (kind === 'listen') {
    const pool = distractors(entry, lexicon, rand, 3, 'word');
    const ordered = [entry, ...pool].map((x) => [rand(), x] as [number, LexiconEntry]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
    return {
      kind: 'words',
      memKind: 'listen',
      title: '间隔复习 · 听音辨词',
      prompt: '🔊 点击播放，听音选词',
      sub: '可重复播放，注意重音和尾音',
      choices: ordered.map((x) => x.w),
      answer: entry.w,
      explain: `${entry.w} ${ipa} ${entry.zh || ''}`.trim(),
      word: entry.w,
      speak: entry.w,
      questionId,
      vocabWord: entry.w,
    };
  }

  // similar：给释义选拼写
  const pool = distractors(entry, lexicon, rand, 3, 'similar');
  const ordered = [entry, ...pool].map((x) => [rand(), x] as [number, LexiconEntry]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  return {
    kind: 'words',
    memKind: 'similar',
    title: '间隔复习 · 形近辨析',
    prompt: gloss,
    sub: '选出拼写与释义匹配的单词',
    choices: ordered.map((x) => x.w),
    answer: entry.w,
    explain: `${entry.w} ${ipa} ${entry.zh || ''}`.trim(),
    word: entry.w,
    questionId,
    vocabWord: entry.w,
  };
}

/**
 * 复习队列 → 题目序列（按记忆题型轮换，避免同一词连续同一题型）
 * @param queue 待复习的词（含词库存下标）
 */
export function buildReviewQuestions(
  queue: Array<{ entry: LexiconEntry; index: number }>,
  lexicon: LexiconEntry[],
  options: { kinds?: VocabQuestionKind[]; saltStart?: number } = {},
): VocabQuestion[] {
  const kinds = options.kinds && options.kinds.length ? options.kinds : (['en2zh', 'listen', 'spell', 'similar'] as VocabQuestionKind[]);
  return queue.map((item, i) => buildVocabQuestion(
    item.entry,
    item.index,
    kinds[i % kinds.length],
    lexicon,
    { salt: (options.saltStart ?? 0) + i },
  ));
}
