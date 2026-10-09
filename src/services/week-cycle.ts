/**
 * 周天（修行周cycle）—— 第十一轮新玩法
 *
 * ── 为什么做这个 ──
 * 现有机制的时间尺度是「单题」（连对/修为）、「当天」（每日功课）、
 * 「历史」（成就/境界），**缺少「一周」这个中间尺度**。
 * 修仙叙事里「周天」正是一个完整循环（一周期运转一周），
 * 而学习上「本周 vs 上周」也是最自然的自省节奏。
 *
 * 数据完全来自既有 `state.days`（每天 right/wrong/bestStreak），
 * **不需要新增任何存档字段**。
 *
 * ── 设计上的三条克制（延续既有红线） ──
 *   1. **不发新货币、不改数值平衡** —— 周天只做「呈现与对照」，
 *      不给灵石/修为奖励。理由：奖励会改变经济平衡，而经济平衡需要人工确认；
 *      而且「每日功课」已经承担了发奖职能，再加一层会让激励重叠、目标分散。
 *   2. **不制造焦虑** —— 未圆满不批评、不断签惩罚；「上周对比」在无数据时
 *      如实说「无上周数据」而不是显示 0% 让人难受。
 *   3. **不侵入学习** —— 纯只读推导，不写存档、不改 SRS。
 *
 * ── 口径 ──
 *   · 一周从**周一**开始（ISO 惯例；中文语境「本周」也通常指周一起）
 *   · 「修行日」= 当天 right+wrong > 0
 *   · 「周天圆满」= 本周修行日 >= FULL_DAYS（默认 5 天）—— 留出休息余量，
 *     不要求 7 天全勤（那会鼓励无效刷时长）
 */

/** 周天圆满所需的最少修行天数（7 天里做到 5 天，留休息余量） */
export const FULL_DAYS = 5;

/**
 * 做「正确率对照」所需的最少作答数（两周各自都要达到）。
 *
 * 为什么需要：正确率是小样本下极不稳定的指标。
 * 实测踩到过：上周 3 天共 12 题、全对（100%），本周 5 天共 40 题、75% ——
 * 于是卡片显示「正确率 -25 个百分点」，看起来像明显退步，
 * 但两周**题量差 3 倍**，这个对比没有意义。
 *
 * 这与灵根的 `MIN_SAMPLES` 是同一条原则：
 * **样本不足时如实说「样本不足」，而不是给一个会误导人的数字。**
 */
export const MIN_ACCURACY_SAMPLES = 20;

/** 一周 7 天 */
export const DAYS_PER_WEEK = 7;

/** 每天的记录形状（与模板 state.days[k] 一致） */
export interface DayRecord {
  right?: number;
  wrong?: number;
  bestStreak?: number;
  [k: string]: unknown;
}
export type DaysMap = Record<string, DayRecord | undefined>;

/** 某一天的汇总 */
export interface DaySummary {
  /** YYYY-MM-DD */
  key: string;
  /** 0=周一 … 6=周日 */
  weekday: number;
  right: number;
  wrong: number;
  total: number;
  /** 是否算「修行日」 */
  active: boolean;
}

export interface WeekSummary {
  /** 本周的 7 天（周一起） */
  days: DaySummary[];
  /** 修行天数 */
  activeDays: number;
  right: number;
  wrong: number;
  total: number;
  /** 正确率 0–1（无作答为 0） */
  accuracy: number;
  /** 是否圆满 */
  full: boolean;
  /** 距离圆满还差几天（已圆满为 0） */
  daysToFull: number;
}

/** 把 Date 规范化到本地当天 0 点 */
function startOfDay(d: Date): Date {
  const x = new Date(d.getTime());
  x.setHours(0, 0, 0, 0);
  return x;
}

/** 本地日期 → YYYY-MM-DD（与模板 dayKey 同口径：本地时区，不用 toISOString 以免时区偏移） */
export function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * 取 `now` 所在周的周一 0 点。
 * JS 的 getDay()：0=周日、1=周一…6=周六。要把周日当成上一周的末尾，
 * 否则周日的「本周」会错位到下周。
 */
export function startOfWeek(now: Date | number = new Date()): Date {
  const d = startOfDay(typeof now === 'number' ? new Date(now) : now);
  const dow = d.getDay();                    // 0=周日
  const back = dow === 0 ? 6 : dow - 1;      // 周日回退 6 天到周一
  d.setDate(d.getDate() - back);
  return d;
}

/** 安全取非负整数 */
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** 汇总某一天 */
export function summarizeDay(days: DaysMap | null | undefined, key: string, weekday: number): DaySummary {
  const row = days && typeof days === 'object' ? days[key] : undefined;
  const right = row && typeof row === 'object' ? num(row.right) : 0;
  const wrong = row && typeof row === 'object' ? num(row.wrong) : 0;
  const total = right + wrong;
  return { key, weekday, right, wrong, total, active: total > 0 };
}

/** 汇总一周 */
export function summarizeWeek(
  days: DaysMap | null | undefined,
  weekStart: Date | number = startOfWeek(),
  fullDays: number = FULL_DAYS,
): WeekSummary {
  // ⚠️ 必须归一化到**所在周的周一**再展开 7 天。
  // 初版直接 `startOfDay(weekStart)` 就开始加天数 —— 传「周四」进去会得到
  // 周四~下周三，整周错位（测试立刻抓到：把下周的数据也算进了本周）。
  const base = startOfWeek(typeof weekStart === 'number' ? new Date(weekStart) : weekStart);
  const need = Number.isFinite(Number(fullDays)) && Number(fullDays) > 0 ? Math.floor(Number(fullDays)) : FULL_DAYS;
  const list: DaySummary[] = [];
  for (let i = 0; i < DAYS_PER_WEEK; i++) {
    const d = new Date(base.getTime());
    d.setDate(d.getDate() + i);
    list.push(summarizeDay(days, dateKey(d), i));
  }
  const right = list.reduce((s, d) => s + d.right, 0);
  const wrong = list.reduce((s, d) => s + d.wrong, 0);
  const total = right + wrong;
  const activeDays = list.filter((d) => d.active).length;
  const full = activeDays >= need;
  return {
    days: list,
    activeDays,
    right,
    wrong,
    total,
    accuracy: total > 0 ? right / total : 0,
    full,
    daysToFull: Math.max(0, need - activeDays),
  };
}

/** 两周对照结果 */
export interface WeekComparison {
  thisWeek: WeekSummary;
  lastWeek: WeekSummary;
  /** 上周是否完全无数据（此时不做「进步/退步」判断） */
  lastWeekEmpty: boolean;
  /** 总答题数的变化（本周 − 上周） */
  totalDelta: number;
  /** 修行天数的变化 */
  activeDaysDelta: number;
  /** 正确率的变化（百分点，本周 − 上周）；**任一周样本不足时为 null** */
  accuracyDelta: number | null;
  /** 正确率对照为何不可用（null 表示可用） */
  accuracySkipReason: 'no-last-week' | 'too-few-samples' | null;
  /** 一句话趋势描述（无上周数据时如实说明，不显示负增长） */
  trend: string;
}

/**
 * 本周与上周对照。
 * 上周完全无数据时**不做趋势判断**（避免把「刚开始用」说成「退步」）。
 */
export function compareWeeks(
  days: DaysMap | null | undefined,
  now: Date | number = new Date(),
  fullDays: number = FULL_DAYS,
): WeekComparison {
  const thisStart = startOfWeek(now);
  const lastStart = new Date(thisStart.getTime());
  lastStart.setDate(lastStart.getDate() - DAYS_PER_WEEK);

  const thisWeek = summarizeWeek(days, thisStart, fullDays);
  const lastWeek = summarizeWeek(days, lastStart, fullDays);

  const lastWeekEmpty = lastWeek.total === 0 && lastWeek.activeDays === 0;
  const totalDelta = thisWeek.total - lastWeek.total;
  const activeDaysDelta = thisWeek.activeDays - lastWeek.activeDays;

  /* 正确率对照：两周都要有足够样本才给数字。
     否则如实说明原因 —— 见 MIN_ACCURACY_SAMPLES 的注释。 */
  let accuracyDelta: number | null = null;
  let accuracySkipReason: WeekComparison['accuracySkipReason'] = null;
  if (lastWeek.total === 0) {
    accuracySkipReason = 'no-last-week';
  } else if (thisWeek.total < MIN_ACCURACY_SAMPLES || lastWeek.total < MIN_ACCURACY_SAMPLES) {
    accuracySkipReason = 'too-few-samples';
  } else {
    accuracyDelta = Math.round((thisWeek.accuracy - lastWeek.accuracy) * 1000) / 10;
  }

  let trend: string;
  if (lastWeekEmpty) {
    trend = thisWeek.total > 0 ? '这是有记录的第一周' : '本周还没有记录';
  } else if (thisWeek.total === 0) {
    trend = '本周还没有开始';
  } else if (totalDelta > 0) {
    trend = `比上周多 ${totalDelta} 题`;
  } else if (totalDelta < 0) {
    trend = `比上周少 ${-totalDelta} 题`;
  } else {
    trend = '与上周题量持平';
  }

  return { thisWeek, lastWeek, lastWeekEmpty, totalDelta, activeDaysDelta, accuracyDelta, accuracySkipReason, trend };
}

/** 正确率对照的说明文案（不可用时如实说明原因，不给会误导人的数字） */
export function accuracyNote(cmp: WeekComparison): string {
  if (cmp.accuracyDelta !== null) {
    return `正确率 ${cmp.accuracyDelta >= 0 ? '+' : ''}${cmp.accuracyDelta} 个百分点`;
  }
  if (cmp.accuracySkipReason === 'too-few-samples') {
    return `两周题量都不足 ${MIN_ACCURACY_SAMPLES} 题，暂不做正确率对照`;
  }
  return '';
}

/** 周天卡的可读标题（圆满了给正反馈；未圆满只说进度，不批评） */
export function weekTitle(w: WeekSummary): string {
  if (w.full) return '周天圆满';
  if (w.activeDays === 0) return '周天未启';
  return `周天运转中 ${w.activeDays}/${DAYS_PER_WEEK}`;
}

/** 周天卡的一句话说明 */
export function weekMessage(w: WeekSummary, fullDays: number = FULL_DAYS): string {
  const need = Number.isFinite(Number(fullDays)) && Number(fullDays) > 0 ? Math.floor(Number(fullDays)) : FULL_DAYS;
  if (w.full) return `本周已修行 ${w.activeDays} 天，周天圆满。`;
  if (w.activeDays === 0) return `本周还没有修行记录；${need} 天即可圆满。`;
  return `本周已修行 ${w.activeDays} 天，再 ${w.daysToFull} 天即可圆满。`;
}

/** 一周 7 天的星期标签（周一…周日） */
export const WEEKDAY_LABELS: readonly string[] = ['一', '二', '三', '四', '五', '六', '日'];
