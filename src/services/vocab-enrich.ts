/**
 * 单词增强信息（P1 任务 A）
 *
 * 原则：**只产出可解释、不伪造的信息**。
 *   - 音标：来自词库（真实数据）
 *   - 发音：交给浏览器 SpeechSynthesis（后续接真实音频走 audio-provider）
 *   - 词根词缀：基于内置常见词缀表做首尾匹配（标注为「构词提示」，不冒充词源学结论）
 *   - 易混词：编辑距离 + 前缀相似度从词库中计算（真实计算，非人工编造）
 *   - 例句：**不伪造真题例句**。这里只给「搭配框架」；若调用方传入本应用原创材料中的句子
 *     （六套卷命题材料），才会作为「本卷例句」展示，并标注来源。
 */
import { tierOf, type VocabTier } from './vocab-grades';

export interface LexiconEntry {
  w: string;
  ipa?: string;
  zh?: string;
  short?: string;
}

export interface AffixSplit {
  prefix?: string;
  suffix?: string;
  /** 去掉首尾词缀后的词干（仅作提示） */
  stem: string;
}

export interface ConfusableWord {
  w: string;
  zh: string;
  /** 为什么容易混：拼写相近 / 前缀相同 / 长度仅差 1 */
  reason: string;
  distance: number;
}

export interface WordEnrichment {
  word: string;
  ipa: string;
  gloss: string;
  tier: VocabTier;
  affixes: AffixSplit;
  confusables: ConfusableWord[];
  /** 搭配框架（模板，不是例句） */
  collocations: string[];
  /** 本应用原创材料中的句子（如六套卷命题材料命中时） */
  paperSentence?: { en: string; source: 'original-material' };
  /** 发音可用性（浏览器是否支持语音合成） */
  ttsAvailable: boolean;
}

/** 常见前缀（按长度降序匹配，避免 counter- 被 co- 抢走） */
const PREFIXES = [
  'counter', 'inter', 'trans', 'super', 'under', 'over', 'anti', 'auto', 'semi', 'post',
  'pre', 'pro', 'sub', 'dis', 'mis', 'non', 'out', 'uni', 'bi', 'co', 'de', 'en', 'ex',
  'im', 'in', 'ir', 're', 'un', 'up',
];
/** 常见后缀（同样按长度降序） */
const SUFFIXES = [
  'ization', 'isation', 'ability', 'ibility', 'ically', 'ology', 'ation', 'ition', 'ment',
  'ness', 'ance', 'ence', 'able', 'ible', 'ical', 'ious', 'ous', 'ity', 'ive', 'ary',
  'ory', 'ism', 'ist', 'ize', 'ise', 'ify', 'ful', 'less', 'ing', 'ed', 'ly', 'er', 'or',
];

/** 拆出首尾词缀（启发式，仅作记忆提示） */
export function splitAffixes(word: string): AffixSplit {
  const lower = String(word).toLowerCase();
  const prefix = PREFIXES.find((p) => lower.startsWith(p) && lower.length > p.length + 2);
  const suffix = SUFFIXES.find((s) => lower.endsWith(s) && lower.length > s.length + 2);
  let stem = lower;
  if (prefix) stem = stem.slice(prefix.length);
  if (suffix && stem.endsWith(suffix)) stem = stem.slice(0, stem.length - suffix.length);
  return { ...(prefix ? { prefix } : {}), ...(suffix ? { suffix } : {}), stem };
}

/**
 * Levenshtein 距离
 * 注意：只做「长度差 > limit」的快速剪枝，**不在 DP 中途早退**——
 * 中间行的远端列天然很大（例如 'aban' 对齐 9 字母词的距离是 5），
 * 中途早退会把 'abandon' vs 'abandoned'（真实距离 2）误判为超限。
 */
export function editDistance(a: string, b: string, limit = Number.POSITIVE_INFINITY): number {
  const s = String(a).toLowerCase();
  const t = String(b).toLowerCase();
  if (Number.isFinite(limit) && Math.abs(s.length - t.length) > limit) return limit + 1;
  const prev = new Array(t.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= s.length; i++) {
    let last = prev[0];
    prev[0] = i;
    for (let j = 1; j <= t.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, last + (s[i - 1] === t[j - 1] ? 0 : 1));
      last = tmp;
    }
  }
  return prev[t.length];
}

/** 易混词：拼写相近（编辑距离 ≤2）或前缀相同且长度相近 */
export function findConfusables(word: string, lexicon: LexiconEntry[], limit = 4): ConfusableWord[] {
  const target = String(word).toLowerCase();
  const prefix = target.slice(0, Math.max(3, target.length - 2));
  const scored: ConfusableWord[] = [];
  for (const entry of lexicon) {
    const candidate = String(entry.w).toLowerCase();
    if (candidate === target) continue;
    const distance = editDistance(target, candidate, 2);
    const samePrefix = candidate.length >= prefix.length && candidate.startsWith(prefix);
    const lengthClose = Math.abs(candidate.length - target.length) <= 1;
    if (distance > 2 && !(samePrefix && lengthClose)) continue;
    const reason = distance <= 1 ? '拼写仅差 1 个字母'
      : distance === 2 ? '拼写相差 2 个字母'
        : '前缀相同、长度接近';
    scored.push({ w: entry.w, zh: entry.short || entry.zh || '', reason, distance });
  }
  return scored
    .sort((a, b) => a.distance - b.distance || a.w.localeCompare(b.w))
    .slice(0, limit);
}

/** 由中文释义首段判断词性（与应用的 posOf 同口径） */
export function posOf(gloss: string): string {
  const m = String(gloss || '').match(/^\s*([a-z.]{1,8}\.)/);
  return m ? m[1] : '';
}

/** 搭配框架：按词性给结构提示（不是例句，界面需标注为「搭配框架」） */
export function collocationsFor(entry: LexiconEntry): string[] {
  const pos = posOf(entry.zh || '');
  const w = entry.w;
  if (pos.startsWith('n')) return [`a / the ${w}`, `${w} of ...`, `${w}s（复数）`];
  if (pos.startsWith('v')) return [`${w} sth`, `${w} that ...`, `be ${w}ed by`];
  if (pos.startsWith('a')) return [`a ${w} + 名词`, `be ${w} to do`, `look / feel ${w}`];
  if (pos.startsWith('ad')) return [`${w} + 动词`, `${w}, ...`];
  if (pos.startsWith('prep') || pos.startsWith('conj')) return [`${w} + 名词/从句`];
  return [`${w} + 名词`, `be ${w}`];
}

export interface EnrichOptions {
  /** 本应用原创材料（六套卷命题材料等）中命中的句子，由调用方提供 */
  paperSentence?: string;
  /** 浏览器是否支持语音合成（默认探测） */
  ttsAvailable?: boolean;
}

/** 组装一个词的增强信息 */
export function enrichWord(entry: LexiconEntry, lexicon: LexiconEntry[], options: EnrichOptions = {}): WordEnrichment {
  const tts = options.ttsAvailable ?? (typeof window !== 'undefined' && 'speechSynthesis' in window);
  return {
    word: entry.w,
    ipa: entry.ipa || '',
    gloss: entry.zh || entry.short || '',
    tier: tierOf(entry.w),
    affixes: splitAffixes(entry.w),
    confusables: findConfusables(entry.w, lexicon),
    collocations: collocationsFor(entry),
    ...(options.paperSentence ? { paperSentence: { en: options.paperSentence, source: 'original-material' as const } } : {}),
    ttsAvailable: !!tts,
  };
}

/** 增强信息的可读摘要（用于词谱/复习卡的展示） */
export function describeEnrichment(enrichment: WordEnrichment): string[] {
  const lines: string[] = [];
  const { prefix, suffix, stem } = enrichment.affixes;
  if (prefix || suffix) {
    const parts = [prefix ? `前缀 ${prefix}-` : null, suffix ? `后缀 -${suffix}` : null].filter(Boolean);
    lines.push(`构词提示：${parts.join('，')}（词干 ${stem}）`);
  }
  if (enrichment.confusables.length) {
    lines.push('易混：' + enrichment.confusables.map((c) => `${c.w}（${c.reason}）`).join('、'));
  }
  if (enrichment.collocations.length) {
    lines.push('搭配框架：' + enrichment.collocations.join(' / '));
  }
  if (enrichment.paperSentence) {
    lines.push('本卷例句（原创材料）：' + enrichment.paperSentence.en);
  }
  return lines;
}
