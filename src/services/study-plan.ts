/**
 * 动态学习计划（P1 任务 C 的算法内核，任务 A 先用于「每日学习量」）
 *
 * 输入：考试日期、当前水平、每日可用时间、到期复习量、近期正确率
 * 输出：每日新词量、复习目标、题型配比、强度与提示
 *
 * 设计取舍：
 *   - 不用黑盒模型，全部是可解释的确定性公式，参数集中在 DEFAULTS 里便于调参；
 *   - 记忆留存率按 0.6 保守估计（新词当天记住约六成），因此新词量会明显低于「剩余词数 ÷ 天数」；
 *   - 同时受「时间预算」上限约束，避免给出做不完的计划。
 */

export const DEFAULT_EXAM_DATE = '2026-12-12';
export const DEFAULT_TOTAL_WORDS = 4540;

/** 本地日期键（见 srs.ts 的同名实现：必须按本地时区取年月日） */
function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export interface PlanInput {
  /** 考试日期（ISO 或 Date）；不填用内置默认 */
  examDate?: string | Date;
  now?: Date;
  /** 已掌握词数（来自摸底/known 统计） */
  knownWords?: number;
  totalWords?: number;
  /** 每日可用学习分钟数 */
  dailyMinutes?: number;
  /** 今日到期复习量（词汇 SRS + 错题本） */
  dueBacklog?: number;
  /** 近期正确率 0–1（可选，用于调整强度） */
  accuracy?: number;
}

export type StudyIntensity = 'relaxed' | 'steady' | 'sprint';

export interface StudyPlan {
  daysLeft: number;
  /** 建议每日新词量 */
  newPerDay: number;
  /** 建议每日复习量（含到期与新词回滚） */
  reviewTarget: number;
  /** 剩余未掌握词数 */
  remaining: number;
  intensity: StudyIntensity;
  /** 按当前速度能否在考试前覆盖剩余词 */
  onTrack: boolean;
  /** 题型配比（每日练习次数分配） */
  mix: { words: number; listen: number; read: number; write: number };
  /** 时间预算是否成为瓶颈 */
  timeBound: boolean;
  notes: string[];
}

const DEFAULTS = {
  retention: 0.6,          // 新词留存率
  minutesPerNewWord: 1.2,  // 每个新词平均耗时（含复习）
  minutesPerReview: 0.35,  // 每次复习平均耗时
  minNew: 10,
  maxNew: 80,
  minReview: 20,
  maxReview: 160,
};

const DAY_MS = 86_400_000;

export function daysUntil(examDate: string | Date, now: Date = new Date()): number {
  const exam = examDate instanceof Date ? examDate : new Date(examDate);
  return Math.max(1, Math.ceil((exam.getTime() - now.getTime()) / DAY_MS));
}

/** 强度：越临近考试越接近冲刺 */
export function intensityFor(daysLeft: number): StudyIntensity {
  if (daysLeft > 120) return 'relaxed';
  if (daysLeft > 45) return 'steady';
  return 'sprint';
}

/** 生成学习计划 */
export function planStudyLoad(input: PlanInput = {}): StudyPlan {
  const now = input.now || new Date();
  const examDate = input.examDate || DEFAULT_EXAM_DATE;
  const daysLeft = daysUntil(examDate, now);
  const total = Math.max(1, input.totalWords ?? DEFAULT_TOTAL_WORDS);
  const known = Math.max(0, Math.min(total, input.knownWords ?? 0));
  const remaining = Math.max(0, total - known);
  const minutes = Math.max(10, input.dailyMinutes ?? 30);
  const due = Math.max(0, input.dueBacklog ?? 0);
  const accuracy = input.accuracy;

  // 1) 按「剩余词数 ÷ 可用天数 ÷ 留存率」估算新词量
  const rawNew = Math.ceil(remaining / (daysLeft * DEFAULTS.retention));
  // 2) 时间预算上限（留 35% 时间给复习与卷面练习）
  const newBudget = Math.floor((minutes * 0.65) / DEFAULTS.minutesPerNewWord);
  // 3) 正确率修正：低于 70% 减量保质量，高于 90% 适度加量
  let accuracyFactor = 1;
  const notes: string[] = [];
  if (typeof accuracy === 'number') {
    if (accuracy < 0.7) { accuracyFactor = 0.7; notes.push('近期正确率偏低，已下调新词量，优先巩固'); }
    else if (accuracy > 0.9) { accuracyFactor = 1.15; notes.push('近期正确率很好，可适度加量'); }
  }

  const capped = Math.min(rawNew, Math.max(DEFAULTS.minNew, newBudget));
  const newPerDay = remaining === 0 ? 0 : Math.max(DEFAULTS.minNew, Math.min(DEFAULTS.maxNew, Math.round(capped * accuracyFactor)));

  // 4) 复习量：到期量 + 新词回滚（每新词约 1.8 次复习），并受时间预算约束
  const reviewRaw = due + Math.round(newPerDay * 1.8);
  const reviewBudget = Math.floor((minutes * 0.5) / DEFAULTS.minutesPerReview);
  const reviewTarget = Math.max(DEFAULTS.minReview, Math.min(DEFAULTS.maxReview, Math.min(reviewRaw, Math.max(DEFAULTS.minReview, reviewBudget))));

  // 5) 题型配比：越接近考试，越向卷面题型倾斜
  const intensity = intensityFor(daysLeft);
  const mix = intensity === 'sprint'
    ? { words: Math.round(newPerDay * 0.5), listen: 8, read: 8, write: 3 }
    : intensity === 'steady'
      ? { words: newPerDay, listen: 6, read: 6, write: 2 }
      : { words: newPerDay, listen: 4, read: 4, write: 1 };

  const onTrack = newPerDay > 0 && rawNew <= DEFAULTS.maxNew;
  const timeBound = newBudget < rawNew;
  if (timeBound) notes.push(`按每天 ${minutes} 分钟，新词量被时间预算限制在 ${newPerDay} 个/天`);
  if (!onTrack && remaining > 0) notes.push(`按当前节奏无法在考前覆盖全部剩余词（还需约 ${Math.ceil(remaining / Math.max(1, newPerDay))} 天），建议优先高频与核心档`);

  return {
    daysLeft,
    newPerDay,
    reviewTarget,
    remaining,
    intensity,
    onTrack,
    mix,
    timeBound,
    notes,
  };
}

export interface PlanFeedback {
  /** 昨日完成率 0–1（完成新词量 / 计划新词量） */
  completedRatio?: number;
  /** 近期正确率 0–1 */
  accuracy?: number;
  /** 模考得分率 0–1（可选） */
  paperRatio?: number;
}

/**
 * 依据完成情况与成绩动态调整计划：
 *   - 完成率低 → 减量，避免计划破产
 *   - 正确率高且完成率高 → 加量
 *   - 模考得分率低于目标 → 提高卷面题型配比
 */
export function adjustPlan(plan: StudyPlan, feedback: PlanFeedback = {}): StudyPlan {
  const notes = [...plan.notes];
  let newPerDay = plan.newPerDay;
  const completed = feedback.completedRatio;
  const accuracy = feedback.accuracy ?? feedback.paperRatio;

  if (typeof completed === 'number') {
    if (completed < 0.6) {
      newPerDay = Math.max(DEFAULTS.minNew, Math.round(newPerDay * 0.8));
      notes.push(`昨日完成率 ${Math.round(completed * 100)}%，已下调新词量至 ${newPerDay} 个/天`);
    } else if (completed > 1.1) {
      newPerDay = Math.min(DEFAULTS.maxNew, Math.round(newPerDay * 1.1));
      notes.push('近期超额完成，已小幅上调新词量');
    }
  }
  if (typeof accuracy === 'number' && accuracy < 0.65) {
    newPerDay = Math.max(DEFAULTS.minNew, Math.round(newPerDay * 0.85));
    notes.push('正确率偏低，新词量再降一档，把时间让给复习');
  }

  const mix = { ...plan.mix };
  if (typeof feedback.paperRatio === 'number' && feedback.paperRatio < 0.6) {
    mix.listen += 2;
    mix.read += 2;
    notes.push('模考卷面得分偏低，已提高听力/阅读练习配比');
  }

  return { ...plan, newPerDay, mix, notes };
}

export interface HeatCell {
  date: string;
  count: number;
  /** 0–4 的热度等级，便于配色 */
  level: number;
}

/**
 * 日历热力图数据（近 n 天）
 * @param daily 形如 { '2026-10-03': 24 } 的每日学习量
 */
export function heatmap(daily: Record<string, number>, days = 28, now: Date = new Date()): HeatCell[] {
  const counts = Object.values(daily).filter((n) => Number.isFinite(n)) as number[];
  const max = counts.length ? Math.max(...counts) : 0;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const cells: HeatCell[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(start.getTime() - i * DAY_MS);
    const key = localDateKey(day);
    const count = Number(daily[key] || 0);
    const level = max <= 0 || count <= 0 ? 0 : Math.min(4, Math.max(1, Math.ceil((count / max) * 4)));
    cells.push({ date: key, count, level });
  }
  return cells;
}

/** 计划的可读摘要（界面展示） */
export function describePlan(plan: StudyPlan): string {
  const intensityLabel = { relaxed: '从容', steady: '稳步', sprint: '冲刺' }[plan.intensity];
  if (plan.remaining === 0) return `词库已全部进入复习队列（${intensityLabel}）· 距考试 ${plan.daysLeft} 天`;
  return `距考试 ${plan.daysLeft} 天 · ${intensityLabel} · 今日新词 ${plan.newPerDay} 个 · 复习 ${plan.reviewTarget} 次`;
}
