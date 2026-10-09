/**
 * 每日功课的「今日连对」口径（v1.10 第十轮）
 *
 * ── 真实缺陷 ──
 * 「今日功课」区块里的第三个任务「不息心法」写的是：
 *
 *     { id:'streak', title:'不息心法', desc:'当前最长连对', now: state.best, target:10, reward:60 }
 *
 * 但 `state.best` 是 **历史最长连对**（`state.best = Math.max(state.best, state.streak)`，
 * 只增不减，跨天保留）。于是：
 *
 *     只要历史上曾连对 10 题 → 这个「**每日**」任务从此**永久预完成**，
 *     每天打开就能直接领 60 灵石，一天都不用练。
 *
 * 真浏览器实测确认：
 *
 *     state.best=15  state.streak=0  今日答对=0
 *     ✅已完成  ✓ 不息心法 +60 灵石  当前最长连对 · 10 / 10 · 点击领取
 *
 * 它已经不是「每日任务」，而是「一次性成就」（而成就系统里确实另有一条
 * `ten 十连问道` 用的就是 `state.best>=10` —— 那条用 best 是对的）。
 *
 * ── 修法 ──
 * 每日任务改用**今日**连对：新增按天记录 `state.days[k].bestStreak`（当日最高连对），
 * 与 `state.best`（历史最佳）区分开。跨天自动归零（因为按 dayKey 存）。
 *
 * ── 三条红线 ──
 *   1. **不制造焦虑**：只记录当日最高，不做「断了就惩罚」；描述改为「今日最长连对」
 *   2. **不鼓励刷题**：口径仍是「连对」而非「题量」
 *   3. **不丢用户数据**：`state.best` 原样保留（成就系统还在用），只是每日任务不再引用它；
 *      旧存档缺 `days[k].bestStreak` 时按 0 处理，不报错
 *
 * ── 向后兼容 ──
 * 旧存档里没有 `bestStreak` 字段。若用户今天已经用旧口径领过奖，`state.claimed`
 * 里已有记录 —— 那部分保持原样（不追溯撤销已发的奖励）。
 */

/** 每日连对目标（与既有任务定义一致） */
export const DAILY_STREAK_TARGET = 10;

/** 每日任务 id（模板与测试共用一处，避免两处各写一份） */
export const DAILY_STREAK_QUEST_ID = 'streak';

/** 一天的最小记录形状（与模板 `state.days[k]` 一致） */
export interface DayRecord {
  right?: number;
  wrong?: number;
  /** 当日最高连对（v1.10 新增；旧存档可能没有） */
  bestStreak?: number;
  [k: string]: unknown;
}

export type DaysMap = Record<string, DayRecord | undefined>;

/**
 * 取某天的「当日最高连对」。缺字段返回 0（旧存档兼容）。
 * 纯函数，不修改入参。
 */
export function dailyBestStreak(days: DaysMap | null | undefined, dayKey: string): number {
  if (!days || typeof days !== 'object' || !dayKey) return 0;
  const row = days[dayKey];
  if (!row || typeof row !== 'object') return 0;
  const v = Number(row.bestStreak);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

/**
 * 记一次答题结果到当日记录，返回**新的**当日最高连对。
 *
 * @param row      当日记录对象（会被就地更新，调用方持有它）
 * @param ok       本题是否答对
 * @param streak   本次结算后的**当前**连对（答错时为 0）
 *
 * 说明：模板里 `settle()` 已经维护了 `state.streak`（当前连对，答错归零，
 * **跨天不归零**）。当日最高连对 = max(已有当日最高, 当前连对)。
 * 用「当前连对」而不是「只算今天新起的连对」，是为了与既有连对加速口径一致
 * （连对加速用的也是 state.streak）。
 */
export function recordDailyStreak(row: DayRecord, ok: boolean, streak: number): number {
  // 数组也是 object，但它不是「当日记录」—— 显式排除，避免往数组上挂属性
  if (!row || typeof row !== 'object' || Array.isArray(row)) return 0;
  const cur = Number.isFinite(Number(streak)) && Number(streak) > 0 ? Math.floor(Number(streak)) : 0;
  const prev = Number.isFinite(Number(row.bestStreak)) && Number(row.bestStreak) > 0
    ? Math.floor(Number(row.bestStreak)) : 0;
  // 答错时当前连对为 0，当日最高保持不变（不清零 —— 当天已达成的记录不该被抹掉）
  const next = ok ? Math.max(prev, cur) : prev;
  row.bestStreak = next;
  return next;
}

export interface DailyStreakQuest {
  id: string;
  title: string;
  desc: string;
  now: number;
  target: number;
  reward: number;
}

/**
 * 生成「不息心法」这条每日任务的**当日**状态。
 * 与模板里另外两条任务的形状保持一致（id/title/desc/now/target/reward）。
 */
export function dailyStreakQuest(
  days: DaysMap | null | undefined,
  dayKey: string,
  reward = 60,
): DailyStreakQuest {
  return {
    id: DAILY_STREAK_QUEST_ID,
    title: '不息心法',
    // 描述明确写「今日」，避免用户以为是历史成就（历史那条在成就系统里叫「十连问道」）
    desc: `今日最长连对 ${DAILY_STREAK_TARGET} 题`,
    now: dailyBestStreak(days, dayKey),
    target: DAILY_STREAK_TARGET,
    reward,
  };
}

/**
 * 迁移/规范化旧存档：确保 `days[k].bestStreak` 字段存在且为合法非负整数。
 * 返回**修补条数**（便于测试与日志）。就地修改传入对象（模板的 migrateState 约定如此）。
 */
export function ensureBestStreak(days: DaysMap | null | undefined): number {
  if (!days || typeof days !== 'object') return 0;
  let fixed = 0;
  for (const k of Object.keys(days)) {
    const row = days[k];
    if (!row || typeof row !== 'object') continue;
    const v = Number(row.bestStreak);
    if (!Number.isFinite(v) || v < 0) { row.bestStreak = 0; fixed++; }
    else if (v !== Math.floor(v)) { row.bestStreak = Math.floor(v); fixed++; }
  }
  return fixed;
}
