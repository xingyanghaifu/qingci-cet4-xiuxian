/**
 * 词汇分级读取（P1 任务 A）
 *
 * `src/data/vocab-grades.json` 由 `scripts/build-vocab-grades.mjs` 生成，
 * 构建时被 esbuild 内联进单文件（42 KB），因此运行时无额外请求。
 */
import rawGrades from '../data/vocab-grades.json';

export type VocabTier = 'high' | 'core' | 'low' | 'recognition';

export const VOCAB_TIERS: ReadonlyArray<{ value: VocabTier; label: string; hint: string }> = [
  { value: 'high', label: '高频', hint: '最该优先掌握：短、常见、出现在命题材料里' },
  { value: 'core', label: '核心', hint: '四级主力词汇，需要能拼能辨' },
  { value: 'low', label: '低频', hint: '读懂即可，拼写要求低' },
  { value: 'recognition', label: '认知词', hint: '长词/多词缀，先做到「认得」' },
];

export interface VocabGradeEntry {
  w: string;
  tier: VocabTier;
}

export interface VocabGrades {
  schema: string;
  source: string;
  note: string;
  policy: Record<string, string>;
  upgradeHint: string;
  counts: Record<VocabTier, number>;
  tiers: Record<VocabTier, string[]>;
}

export const VOCAB_GRADES = rawGrades as unknown as VocabGrades;

/** 词 → 档位索引（一次性构建，4540 条） */
const tierIndex: Map<string, VocabTier> = (() => {
  const map = new Map<string, VocabTier>();
  for (const tier of ['high', 'core', 'low', 'recognition'] as VocabTier[]) {
    for (const word of VOCAB_GRADES.tiers[tier] || []) map.set(word, tier);
  }
  return map;
})();

/** 查一个词的档位（词库外的词按 core 处理，避免误判） */
export function tierOf(word: string): VocabTier {
  return tierIndex.get(String(word)) || 'core';
}

export function tierLabel(tier: VocabTier): string {
  return VOCAB_TIERS.find((t) => t.value === tier)?.label || tier;
}

/** 各档词量统计（用于界面与学习计划） */
export function tierCounts(): Record<VocabTier, number> {
  return {
    high: (VOCAB_GRADES.tiers.high || []).length,
    core: (VOCAB_GRADES.tiers.core || []).length,
    low: (VOCAB_GRADES.tiers.low || []).length,
    recognition: (VOCAB_GRADES.tiers.recognition || []).length,
  };
}

/** 某档的词表 */
export function wordsOfTier(tier: VocabTier): string[] {
  return (VOCAB_GRADES.tiers[tier] || []).slice();
}

/**
 * 学习优先级：高频 > 核心 > 低频 > 认知词；同档内按词长升序（先短后长）
 * 用于在没有到期复习时的「新词」取词顺序
 */
export function tierPriority(tier: VocabTier): number {
  return { high: 0, core: 1, low: 2, recognition: 3 }[tier] ?? 1;
}

/** 数据来源摘要（界面/文档展示用，明确标注是否为真实词频） */
export function gradesSource(): { source: string; isRealFrequency: boolean; note: string } {
  return {
    source: VOCAB_GRADES.source,
    isRealFrequency: VOCAB_GRADES.source === 'frequency-list',
    note: VOCAB_GRADES.note,
  };
}
