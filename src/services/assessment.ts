/**
 * 自适应词汇量测试（P1 任务 C）
 *
 * 模型：**阶梯式难度 + 分档加权估计**（简化版 IRT，不是经过校准的题目参数模型）
 *   - 难度阶梯 1–5，起始 3；答对升一级（封顶 5），答错降一级（保底 1）
 *   - 每个阶梯对应一个词库分档（高频 → 认知词），从该档抽一个还没考过的词
 *   - 题量：最少 30、最多 50；达到最少题量后若最近 8 题正确率极端（≥0.875 或 ≤0.125）
 *     则提前收敛，否则继续到上限
 *   - 估计：vocabSize = Σ_分档 (该档词量 × 该档掌握率)，掌握率用 Laplace 平滑（(对+1)/(总+2)）；
 *     未覆盖到的档位用阶梯先验兜底
 *   - 区间：对每档掌握率取 Wilson 下/上界后同样加权，得到词汇量的下界与上界
 *
 * ⚠️ 诚实标注：这是启发式自适应测试，输出是**估计值 + 区间**，不是精确测量；
 *    题目难度来自词库分档（P1 任务 A 的启发式分级），没有做过预试校准。
 */

import { seededRng } from '../types/question-bank';
import { tierCounts, VOCAB_TIERS, type VocabTier } from './vocab-grades';
import { wilsonLowerBound } from '../types/report';

export const ASSESSMENT_MIN_ITEMS = 30;
export const ASSESSMENT_MAX_ITEMS = 50;
export const ASSESSMENT_START_LEVEL = 3;
export const ASSESSMENT_LEVELS = 5;

/** 阶梯 → 词库分档 */
export const LEVEL_TIERS: VocabTier[] = ['high', 'high', 'core', 'low', 'recognition'];

/** 未覆盖档位的先验掌握率（按阶梯水平线性插值） */
export function priorMastery(level: number): Record<VocabTier, number> {
  const t = Math.max(0, Math.min(1, (level - 1) / (ASSESSMENT_LEVELS - 1))); // 0 → 1
  return {
    high: 0.55 + 0.4 * t,
    core: 0.4 + 0.45 * t,
    low: 0.2 + 0.5 * t,
    recognition: 0.05 + 0.45 * t,
  };
}

export interface AssessmentAnswer {
  word: string;
  tier: VocabTier;
  level: number;
  correct: boolean;
  at: string;
}

export interface AssessmentState {
  seed: number;
  level: number;
  answers: AssessmentAnswer[];
  asked: string[];
  startedAt: string;
  finished: boolean;
}

export interface AssessmentEstimate {
  vocabSize: number;
  range: [number, number];
  level: number;
  items: number;
  accuracy: number;
  byTier: Array<{ tier: VocabTier; label: string; total: number; correct: number; mastery: number }>;
  confidence: 'high' | 'medium' | 'low';
  notes: string[];
}

export function createAssessment(seed = 20261003, now: Date = new Date()): AssessmentState {
  return {
    seed: seed >>> 0,
    level: ASSESSMENT_START_LEVEL,
    answers: [],
    asked: [],
    startedAt: now.toISOString(),
    finished: false,
  };
}

/** 阶梯更新：答对升一级，答错降一级 */
export function nextLevel(level: number, correct: boolean): number {
  const next = correct ? level + 1 : level - 1;
  return Math.max(1, Math.min(ASSESSMENT_LEVELS, next));
}

/** 当前阶梯对应的词库分档 */
export function tierForLevel(level: number): VocabTier {
  const index = Math.max(0, Math.min(ASSESSMENT_LEVELS - 1, level - 1));
  return LEVEL_TIERS[index];
}

/** 是否该收题 */
export function shouldStop(state: AssessmentState): boolean {
  const n = state.answers.length;
  if (n >= ASSESSMENT_MAX_ITEMS) return true;
  if (n < ASSESSMENT_MIN_ITEMS) return false;
  const recent = state.answers.slice(-8);
  const hit = recent.filter((a) => a.correct).length / Math.max(1, recent.length);
  return hit >= 0.875 || hit <= 0.125;
}

/** 记录一次作答并推进阶梯 */
export function applyAnswer(
  state: AssessmentState,
  answer: { word: string; tier: VocabTier; level: number; correct: boolean },
  now: Date = new Date(),
): AssessmentState {
  const next: AssessmentState = {
    ...state,
    level: nextLevel(state.level, answer.correct),
    answers: [...state.answers, { ...answer, at: now.toISOString() }],
    asked: [...state.asked, answer.word],
  };
  next.finished = shouldStop(next);
  return next;
}

/** 每档掌握率（Laplace 平滑） */
function masteryByTier(state: AssessmentState): Map<VocabTier, { total: number; correct: number }> {
  const map = new Map<VocabTier, { total: number; correct: number }>();
  for (const a of state.answers) {
    const row = map.get(a.tier) || { total: 0, correct: 0 };
    row.total++;
    if (a.correct) row.correct++;
    map.set(a.tier, row);
  }
  return map;
}

/** 生成估计（含区间与置信度） */
export function estimateAssessment(state: AssessmentState): AssessmentEstimate {
  const counts = tierCounts();
  const observed = masteryByTier(state);
  const prior = priorMastery(state.level);
  const notes: string[] = [];

  let size = 0;
  let low = 0;
  let high = 0;
  const byTier: AssessmentEstimate['byTier'] = [];

  for (const tier of VOCAB_TIERS.map((t) => t.value)) {
    const row = observed.get(tier);
    const total = row?.total || 0;
    const correct = row?.correct || 0;
    // 样本太小时向先验收缩（权重 = 样本量 / (样本量 + 4)）
    const weight = total / (total + 4);
    const smoothed = weight * ((correct + 1) / (total + 2)) + (1 - weight) * prior[tier];
    const lo = total >= 3 ? wilsonLowerBound(correct, total) : Math.max(0, smoothed - 0.25);
    const hi = total >= 3 ? Math.min(1, 1 - wilsonLowerBound(total - correct, total)) : Math.min(1, smoothed + 0.25);
    const tierSize = counts[tier] || 0;

    size += tierSize * smoothed;
    low += tierSize * lo;
    high += tierSize * hi;
    byTier.push({ tier, label: VOCAB_TIERS.find((t) => t.value === tier)?.label || tier, total, correct, mastery: Math.round(smoothed * 1000) / 1000 });

    if (total === 0) notes.push(`${VOCAB_TIERS.find((t) => t.value === tier)?.label || tier} 档没有抽到题，该档按先验估计`);
    else if (total < 3) notes.push(`${VOCAB_TIERS.find((t) => t.value === tier)?.label || tier} 档样本仅 ${total} 题，区间偏宽`);
  }

  const items = state.answers.length;
  const correctCount = state.answers.filter((a) => a.correct).length;
  const covered = VOCAB_TIERS.filter((t) => (observed.get(t.value)?.total || 0) >= 3).length;
  const confidence: AssessmentEstimate['confidence'] = items >= 34 && covered >= 3
    ? 'high'
    : items >= ASSESSMENT_MIN_ITEMS && covered >= 2 ? 'medium' : 'low';
  if (confidence !== 'high') notes.push('题量或分档覆盖不足，建议稍后重测以收窄区间');

  return {
    vocabSize: Math.max(0, Math.min(counts.high + counts.core + counts.low + counts.recognition, Math.round(size))),
    range: [Math.max(0, Math.round(low)), Math.min(4540, Math.round(high))],
    level: state.level,
    items,
    accuracy: items ? Math.round((correctCount / items) * 100) / 100 : 0,
    byTier,
    confidence,
    notes,
  };
}

export interface AssessmentItem {
  word: string;
  tier: VocabTier;
  level: number;
  choices: string[];
  answer: string;
  ipa: string;
  gloss: string;
}

export interface LexiconLike { w: string; ipa?: string; zh?: string; short?: string }

/**
 * 按当前阶梯挑一道题
 * @param pool 该档的候选词表（已排除考过的词）
 */
export function buildAssessmentItem(
  state: AssessmentState,
  pool: LexiconLike[],
  lexicon: LexiconLike[],
): AssessmentItem | null {
  const tier = tierForLevel(state.level);
  const asked = new Set(state.asked);
  const candidates = pool.filter((entry) => entry && entry.w && !asked.has(entry.w));
  if (!candidates.length) return null;

  const rand = seededRng((state.seed + state.answers.length * 7919) >>> 0);
  const item = candidates[Math.floor(rand() * candidates.length)];
  const gloss = String(item.short || item.zh || '');
  const used = new Set([gloss]);
  const choices: string[] = [gloss];
  let guard = 0;
  while (choices.length < 4 && guard < lexicon.length * 2) {
    guard++;
    const candidate = lexicon[Math.floor(rand() * lexicon.length)];
    if (!candidate || candidate.w === item.w) continue;
    const short = String(candidate.short || candidate.zh || '');
    if (!short || used.has(short)) continue;
    used.add(short);
    choices.push(short);
  }
  // 确定性洗牌
  const ordered = choices
    .map((text) => ({ text, key: rand() }))
    .sort((a, b) => a.key - b.key)
    .map((x) => x.text);

  return {
    word: item.w,
    tier,
    level: state.level,
    choices: ordered,
    answer: gloss,
    ipa: item.ipa || '',
    gloss: item.zh || gloss,
  };
}

/** 供界面展示的进度文案 */
export function describeAssessment(state: AssessmentState, estimate?: AssessmentEstimate): string {
  const n = state.answers.length;
  if (!state.finished) {
    return `第 ${n + 1} 题 · 难度 ${state.level}/${ASSESSMENT_LEVELS} · 最少 ${ASSESSMENT_MIN_ITEMS} 题、最多 ${ASSESSMENT_MAX_ITEMS} 题`;
  }
  if (!estimate) return `已完成 ${n} 题`;
  return `估计词汇量约 ${estimate.vocabSize} 词（区间 ${estimate.range[0]}–${estimate.range[1]}）· 置信度 ${estimate.confidence}`;
}
