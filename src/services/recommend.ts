/**
 * 自适应推荐（P1 任务 B）
 *
 * 输入薄弱点（来自 `detectWeaknesses`）与题库，输出一份**可直接交给随机组卷的 spec** 与推荐理由。
 *
 * 设计原则：
 *   - 只让「样本足够」的薄弱点进入推荐（insufficient 的只提示不推荐）；
 *   - 一次只推一个主题（最弱的那一项）+ 少量跨主题混合，避免一次练习目标发散；
 *   - 推荐理由写清「为什么推这个」，用户能看到依据。
 */
import { selectPracticeSet, type BankQuestion, type PracticeSpec, type PracticeSet, type QuestionBank } from '../types/question-bank';
import type { WeaknessInsight } from '../types/report';

export interface Recommendation {
  /** 直接传给 buildPracticeSet 的参数 */
  spec: PracticeSpec;
  /** 主攻方向的可读标签 */
  focus: string;
  /** 为什么推荐 */
  rationale: string;
  /** 用于界面高亮的标签 */
  tags: string[];
  /** 期望能抽到的题量（题库里该标签的候选数） */
  candidates: number;
}

/** 某个标签在题库中的候选数量（用于判断推荐是否落空） */
export function countCandidates(bank: QuestionBank, insight: WeaknessInsight): number {
  return bank.questions.filter((q) => matchesInsight(q, insight)).length;
}

function matchesInsight(question: BankQuestion, insight: WeaknessInsight): boolean {
  if (insight.scope === 'tag') return question.knowledgeTags.includes(insight.key);
  if (insight.scope === 'kind') return question.kind === insight.key;
  return false;
}

/**
 * 由薄弱点生成练习推荐
 * @param bank 已载入的固化题库（未载入时返回 null，由调用方提示先载入）
 * @param weaknesses detectWeaknesses 的结果（按 weakness 降序）
 */
export function recommendPractice(
  bank: QuestionBank | null,
  weaknesses: WeaknessInsight[],
  options: { count?: number; mixRatio?: number } = {},
): Recommendation | null {
  const usable = weaknesses.filter((w) => w.severity !== 'insufficient');
  if (!bank || !usable.length) return null;

  const count = options.count ?? 15;
  const mixRatio = options.mixRatio ?? 0.25;
  const top = usable[0];

  const spec: PracticeSpec = {};
  if (top.scope === 'kind') spec.kinds = [top.key];
  else if (top.scope === 'tag') spec.preferTags = [top.key];
  // 部分维度：用标签无法表达，退化为「按最弱部分对应的题型集合」
  else if (top.scope === 'part') spec.parts = [top.key];

  const candidates = countCandidates(bank, top);
  if (candidates < 3) {
    // 候选太少时退化为「按最弱题型」推荐，避免给出几乎抽不出题的方案
    const kindFallback = usable.find((w) => w.scope === 'kind');
    if (kindFallback) return recommendPractice(bank, [kindFallback, ...usable.slice(1)], options);
    return null;
  }

  spec.count = count;
  spec.difficulty = [0.2, 0.8];
  spec.sortByDifficulty = true;

  const expected = Math.max(1, Math.round(count * (1 - mixRatio)));

  return {
    spec,
    focus: top.label,
    rationale: `「${top.label}」正确率 ${Math.round(top.accuracy * 100)}%（${top.correct}/${top.total}，`
      + `Wilson 下界 ${Math.round(top.lowerBound * 100)}%），是当前最该补的一项；`
      + `题库中可用题目约 ${candidates} 道，建议本次练 ${expected} 道该方向 + ${count - expected} 道其它方向。`,
    tags: [top.key],
    candidates,
  };
}

/**
 * 推荐并立即组卷（组合 recommendPractice + selectPracticeSet）
 * @param excludeIds 近期做过的题（防重复）
 */
export function buildRecommendedSet(
  bank: QuestionBank | null,
  weaknesses: WeaknessInsight[],
  options: { count?: number; excludeIds?: string[]; seed?: number } = {},
): { recommendation: Recommendation; set: PracticeSet } | null {
  const recommendation = recommendPractice(bank, weaknesses, { count: options.count });
  if (!recommendation) return null;
  const set = selectPracticeSet(bank as QuestionBank, {
    ...recommendation.spec,
    excludeIds: options.excludeIds || [],
    seed: options.seed ?? 20261003,
  });
  return { recommendation, set };
}

/** 推荐结果的可读摘要（界面用） */
export function describeRecommendation(recommendation: Recommendation | null): string {
  if (!recommendation) return '暂无足够数据生成推荐：先做几组练习或一次模考。';
  return `主攻：${recommendation.focus} · ${recommendation.candidates} 道候选`;
}
