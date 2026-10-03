/**
 * SM-2 间隔重复（P0.2）
 *
 * 与既有 `src/core/utils.js` 的固定间隔（0.25/1/3/7 天）相比，SM-2 会根据每题的
 * 难度因子 EF 与连续答对次数动态拉长间隔：容易的题越拉越长，反复错的题始终保持短间隔。
 *
 * 参数选择：
 *   - quality：忘记 2 / 模糊 3 / 记得 4 / 熟练 5（0–5 分制的后四档；本应用不设 0/1，
 *     因为「完全不会」等价于「忘记」）
 *   - 忘记（q<3）：repetitions 归零、间隔回到 0.25 天，当天即可再练（与旧版心魔节奏一致）
 *   - 记得：第 1 次 1 天、第 2 次 6 天，之后 round(上次间隔 × EF)
 *   - EF 更新：EF' = EF + (0.1 − (5−q) × (0.08 + (5−q) × 0.02))，下限 1.3（SM-2 原文）
 *   - 上限：单次间隔不超过 365 天，避免长时间不再复习
 */

import {
  DEFAULT_EASE,
  MIN_EASE,
  proficiencyOf,
  type MistakeRecord,
  type ReviewRating,
} from '../types/mistakes';

export const RELEARN_INTERVAL_DAYS = 0.25;
export const FIRST_INTERVAL_DAYS = 1;
export const SECOND_INTERVAL_DAYS = 6;
export const MAX_INTERVAL_DAYS = 365;
export const DAY_MS = 86_400_000;

/** 反馈 → SM-2 quality（0–5） */
export const QUALITY_BY_RATING: Record<ReviewRating, number> = {
  again: 2,
  hard: 3,
  good: 4,
  easy: 5,
};

/** 依据 SM-2 更新难度因子 */
export function nextEase(ease: number, quality: number): number {
  const q = Math.max(0, Math.min(5, quality));
  const delta = 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02);
  return Math.max(MIN_EASE, Math.round((ease + delta) * 1000) / 1000);
}

/** 依据 SM-2 计算下一次间隔（天） */
export function nextIntervalDays(input: { repetitions: number; intervalDays: number; ease: number; quality: number }): number {
  const { quality } = input;
  if (quality < 3) return RELEARN_INTERVAL_DAYS;
  const repetitions = input.repetitions + 1;
  if (repetitions === 1) return FIRST_INTERVAL_DAYS;
  if (repetitions === 2) return SECOND_INTERVAL_DAYS;
  const grown = (input.intervalDays > 0 ? input.intervalDays : SECOND_INTERVAL_DAYS) * input.ease;
  return Math.min(MAX_INTERVAL_DAYS, Math.round(grown * 100) / 100);
}

export interface ReviewOutcome {
  /** 更新后的错题记录（新对象，不修改入参） */
  record: MistakeRecord;
  /** 本次反馈对应的 quality */
  quality: number;
  /** 本次排定的间隔（天） */
  intervalDays: number;
  /** 下次复习时间 */
  nextReviewAt: string;
}

/** 对一条错题应用一次复习反馈（纯函数） */
export function applyReview(record: MistakeRecord, rating: ReviewRating, now: Date = new Date()): ReviewOutcome {
  const quality = QUALITY_BY_RATING[rating] ?? 4;
  const ease = nextEase(record.ease || DEFAULT_EASE, quality);
  const intervalDays = nextIntervalDays({
    repetitions: record.repetitions || 0,
    intervalDays: record.intervalDays || 0,
    ease,
    quality,
  });
  const repetitions = quality < 3 ? 0 : (record.repetitions || 0) + 1;
  const nextReviewAt = new Date(now.getTime() + intervalDays * DAY_MS).toISOString();

  const updated: MistakeRecord = {
    ...record,
    ease,
    intervalDays,
    repetitions,
    reviewCount: (record.reviewCount || 0) + 1,
    lastReviewedAt: now.toISOString(),
    nextReviewAt,
    updatedAt: now.toISOString(),
  };
  updated.proficiency = proficiencyOf(updated);
  return { record: updated, quality, intervalDays, nextReviewAt };
}

/** 今日到期队列：按到期时间升序（越早到期越先复习），可限制条数 */
export function dueQueue(records: MistakeRecord[], now: Date = new Date(), limit = 50): MistakeRecord[] {
  const ts = now.getTime();
  return records
    .filter((r) => new Date(r.nextReviewAt).getTime() <= ts)
    .sort((a, b) => {
      const diff = new Date(a.nextReviewAt).getTime() - new Date(b.nextReviewAt).getTime();
      if (diff !== 0) return diff;
      return b.wrongCount - a.wrongCount;
    })
    .slice(0, Math.max(0, limit));
}

/** 未来 n 天的复习量预测（用于学习计划与日历热力图） */
export function forecast(records: MistakeRecord[], days = 7, now: Date = new Date()): Array<{ date: string; count: number }> {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const out: Array<{ date: string; count: number }> = [];
  for (let i = 0; i < days; i++) {
    const day = new Date(start.getTime() + i * DAY_MS);
    const next = new Date(day.getTime() + DAY_MS);
    const count = records.filter((r) => {
      const ts = new Date(r.nextReviewAt).getTime();
      return ts >= day.getTime() && ts < next.getTime();
    }).length;
    out.push({ date: day.toISOString().slice(0, 10), count });
  }
  return out;
}

export interface MistakeTrendPoint {
  date: string;
  wrong: number;
  right: number;
}

/**
 * 由错题的 created/updated/reviewed 时间生成近 n 日「新增错题 / 已复习」趋势。
 * 注意：这里刻意不伪造正确率曲线——正确率来自应用既有的 state.days，
 * 错题本只负责「新增与复习」这两条真实可得的曲线。
 */
export function mistakeTrend(records: MistakeRecord[], days = 7, now: Date = new Date()): MistakeTrendPoint[] {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const out: MistakeTrendPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(start.getTime() - i * DAY_MS);
    const next = new Date(day.getTime() + DAY_MS);
    const key = day.toISOString().slice(0, 10);
    const wrong = records.filter((r) => {
      const ts = new Date(r.createdAt).getTime();
      return ts >= day.getTime() && ts < next.getTime();
    }).length;
    const right = records.filter((r) => {
      if (!r.lastReviewedAt) return false;
      const ts = new Date(r.lastReviewedAt).getTime();
      return ts >= day.getTime() && ts < next.getTime() && r.repetitions > 0;
    }).length;
    out.push({ date: key, wrong, right });
  }
  return out;
}

/** 复习结果的可读文案（界面用） */
export function describeInterval(outcome: ReviewOutcome): string {
  const d = outcome.intervalDays;
  if (d < 1) return '今天再练一次';
  if (d < 2) return '明天复习';
  if (d < 30) return `${Math.round(d)} 天后复习`;
  return `${Math.round(d / 30)} 个月后复习`;
}
