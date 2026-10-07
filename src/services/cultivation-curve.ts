/**
 * 修行数值曲线（第一期 · 数值与成长）
 *
 * 这一层是**纯函数 + 常量**，不碰 SM-2 / SRS 语义，也不新建存储：
 * 所有写盘仍由既有服务（gamification / economy / demons / spirit-field）负责。
 *
 * ## 五条机制
 *
 * 1. **子层级（45 级）**：五大境界 × 9 子层。
 *    大境界仍是 `realmIndex` 0–4（既有代码一字不动），子层是**附加维度**
 *    `subLevel` 0–8。全局等级 = realmIndex × 9 + subLevel ∈ [0, 44]。
 *    这样「练气一层 → 化神九层」有了 45 个可见台阶，而所有依赖
 *    `realmIndex` 的既有逻辑（灵田解锁、心魔封顶、称号）保持原语义。
 *
 * 2. **修为动态公式**：基础分 + 连对加速。
 *    连对 ≥5 题 ×1.5，≥3 题 ×1.2。**连对倍率只乘在单题收益上**，
 *    不改 SRS 的复习间隔与判定。
 *
 * 3. **断签衰减**：连续 3 天不学习后，每天 −5%，**下限 0 且不扣境界**。
 *    这是「提醒」而不是「惩罚」—— 用户明确要求不制造焦虑。
 *
 * 4. **每日首登加成**：每天第一次打开 +20 修为（当天只给一次）。
 *
 * 5. **灵石暴击**：10% 概率 ×2。概率**固定且与做题量无关** ——
 *    避免「为刷暴击而多做题」。随机源可注入，便于测试确定性。
 *
 * ## 三条设计红线（用户明确要求）
 *   · 不制造焦虑：衰减有下限、不扣境界、不封功能；
 *   · 不鼓励刷题：暴击概率固定，连对倍率有上限（1.5×）；
 *   · 不侵入学习：全部在作答结算之后计算，异常一律吞掉。
 */

/* ───────────────── 一、子层级（45 级） ───────────────── */

/** 每个大境界的子层数（九层：一层…九层） */
export const SUBLEVELS_PER_REALM = 9;

/** 全局等级总数：5 × 9 = 45 */
export const TOTAL_SUBLEVELS = 45;

/** 子层的汉字序号（一层…九层） */
export const SUBLEVEL_NAMES: readonly string[] = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

/** 由 大境界 + 子层 得到全局等级 0–44（越界自动夹紧） */
export function globalLevel(realmIndex: number, subLevel: number): number {
  const r = clampInt(realmIndex, 0, 4);
  const s = clampInt(subLevel, 0, SUBLEVELS_PER_REALM - 1);
  return r * SUBLEVELS_PER_REALM + s;
}

/** 由全局等级反解 { realmIndex, subLevel } */
export function splitGlobalLevel(level: number): { realmIndex: number; subLevel: number } {
  const n = clampInt(level, 0, TOTAL_SUBLEVELS - 1);
  return {
    realmIndex: Math.floor(n / SUBLEVELS_PER_REALM),
    subLevel: n % SUBLEVELS_PER_REALM,
  };
}

/** 子层显示名：「练气三层」。realmName 由调用方传入（避免本模块依赖 realm 表） */
export function subLevelLabel(realmName: string, subLevel: number): string {
  const s = clampInt(subLevel, 0, SUBLEVELS_PER_REALM - 1);
  return `${realmName}${SUBLEVEL_NAMES[s]}层`;
}

/**
 * 升到「下一子层」所需修为。
 *
 * 曲线：**等比增长**，每层比上一层多 8%。
 *
 * 为什么不用幂函数（如 n^1.35）：幂函数在**低等级段相对涨幅极大**
 * （第 1→2 层会涨 158%），而玩家对前几级的节奏最敏感 —— 一开始就卡住
 * 会直接劝退。等比增长让每一级的相对涨幅**恒定 8%**，体验线性可预期。
 *
 * 数值效果：一层 50 修为 → 四十五层约 1475；满级累计约 1.9 万修为，
 * 按单题基础 6 修为算约 3200 题 —— 是个「要努力但不绝望」的量级。
 * 结果取整到 5 的倍数，界面上更好读。
 */
export const SUBLEVEL_BASE_QI = 50;
/** 每层相对上一层的涨幅 */
export const SUBLEVEL_GROWTH = 1.08;

export function qiForSubLevel(globalLv: number): number {
  const lv = clampInt(globalLv, 0, TOTAL_SUBLEVELS - 1);
  const raw = SUBLEVEL_BASE_QI * Math.pow(SUBLEVEL_GROWTH, lv);
  return Math.round(raw / 5) * 5;
}

/** 累计修为门槛（升到全局等级 n 所需的**总**修为） */
export function totalQiForLevel(globalLv: number): number {
  const target = clampInt(globalLv, 0, TOTAL_SUBLEVELS - 1);
  let sum = 0;
  for (let i = 0; i < target; i++) sum += qiForSubLevel(i);
  return sum;
}

/**
 * 由累计修为算出「应达到」的全局等级（只升不降由调用方保证）。
 * 返回 0 表示还在一层。
 *
 * 语义：要到达等级 L，必须累计攒够 `totalQiForLevel(L)`。
 * 因此从 L=0 起逐级试探「下一级的门槛」，够了才 +1。
 */
export function levelFromQi(qi: number): number {
  const q = Math.max(0, Number(qi) || 0);
  let lv = 0;
  let acc = 0;
  while (lv < TOTAL_SUBLEVELS - 1) {
    acc += qiForSubLevel(lv);   // 跨过「从 lv 升到 lv+1」的门槛
    if (q < acc) break;
    lv++;
  }
  return lv;
}

/** 距离下一子层还差多少修为；已满级返回 0 */
export function qiToNextLevel(qi: number): { need: number; have: number; ratio: number; maxed: boolean } {
  const lv = levelFromQi(qi);
  if (lv >= TOTAL_SUBLEVELS - 1) return { need: 0, have: 0, ratio: 1, maxed: true };
  const acc = totalQiForLevel(lv);
  const need = qiForSubLevel(lv);
  const have = Math.max(0, (Number(qi) || 0) - acc);
  return { need, have, ratio: Math.max(0, Math.min(1, have / Math.max(1, need))), maxed: false };
}

/* ───────────────── 二、修为动态公式 ───────────────── */

/** 单题基础修为 */
export const BASE_QI_PER_CORRECT = 6;

/** 连对加速档位（阈值降序，取第一个命中） */
export const COMBO_TIERS: ReadonlyArray<{ minStreak: number; multiplier: number; label: string }> = [
  { minStreak: 5, multiplier: 1.5, label: '连对 5+ · 修为 ×1.5' },
  { minStreak: 3, multiplier: 1.2, label: '连对 3+ · 修为 ×1.2' },
];

/** 连对倍率（streak 是**本次答对后**的连对数） */
export function comboMultiplier(streak: number): number {
  const s = Math.max(0, Math.round(Number(streak) || 0));
  for (const tier of COMBO_TIERS) if (s >= tier.minStreak) return tier.multiplier;
  return 1;
}

/** 命中当前档位的文案（未达档返回空串） */
export function comboLabel(streak: number): string {
  const s = Math.max(0, Math.round(Number(streak) || 0));
  for (const tier of COMBO_TIERS) if (s >= tier.minStreak) return tier.label;
  return '';
}

/** 每日首登加成 */
export const DAILY_FIRST_QI = 20;

/**
 * 单题答对收益。
 * 注意：倍率只作用在基础分上，**不叠加到每日首登**（后者是独立的一次性奖励）。
 */
export function qiForCorrect(streak: number): number {
  return Math.round(BASE_QI_PER_CORRECT * comboMultiplier(streak));
}

/* ───────────────── 三、断签衰减（不惩罚） ───────────────── */

/** 断签几天后开始衰减 */
export const DECAY_GRACE_DAYS = 3;
/** 每多断一天衰减的比例 */
export const DECAY_RATE_PER_DAY = 0.05;
/** 单次衰减上限（防止一次登录把修为清空） */
export const DECAY_MAX_RATIO = 0.5;

/**
 * 断签衰减：返回**衰减后**的修为与扣减量。
 *
 * 三条安全设计：
 *   · 宽限 3 天：短假不惩罚；
 *   · 单次最多扣 50%：不会「一觉醒来修为没了」；
 *   · 下限 0：不会变负，**也完全不碰境界**（境界只升不降）。
 */
export function applyDecay(qi: number, daysAbsent: number): { qi: number; lost: number; days: number } {
  const q = Math.max(0, Number(qi) || 0);
  const d = Math.max(0, Math.floor(Number(daysAbsent) || 0));
  const over = d - DECAY_GRACE_DAYS;
  if (over <= 0 || q <= 0) return { qi: q, lost: 0, days: 0 };
  const ratio = Math.min(DECAY_MAX_RATIO, over * DECAY_RATE_PER_DAY);
  const lost = Math.min(q, Math.round(q * ratio));
  return { qi: q - lost, lost, days: over };
}

/** 衰减提示文案（不制造焦虑：给出「继续修炼即可回升」的出口） */
export function decayMessage(lost: number, days: number): string {
  if (lost <= 0) return '';
  return `已有 ${days} 天未修炼，修为自然消散 ${lost} 点。继续修炼即可回升，境界不受影响。`;
}

/* ───────────────── 四、灵石暴击 ───────────────── */

/** 暴击概率（固定，与做题量无关） */
export const CRIT_CHANCE = 0.1;
/** 暴击倍率 */
export const CRIT_MULTIPLIER = 2;

/**
 * 判定本次是否暴击。
 * @param rand 可注入的随机源（返回 [0,1)），默认 Math.random。
 *             注入是为了让测试确定性可复现。
 */
export function rollCrit(rand: () => number = Math.random): boolean {
  try {
    const v = Number(rand());
    if (!Number.isFinite(v)) return false;
    return v < CRIT_CHANCE;
  } catch {
    return false;
  }
}

/** 结算灵石收益（含暴击） */
export function spiritReward(base: number, crit: boolean): number {
  const b = Math.max(0, Math.round(Number(base) || 0));
  return crit ? b * CRIT_MULTIPLIER : b;
}

/** 暴击提示文案 */
export const CRIT_LABEL = '⚡ 灵石暴击！';

/* ───────────────── 五、心魔成长曲线 ───────────────── */

/**
 * 升到下一级所需的「答错次数」。
 *
 * 曲线（用户指定）：Lv1–2 每次 1 错；Lv3–4 每次 2 错；Lv5 每次 3 错。
 *
 * 于是「答错几次 = 第几级门槛」，非常直观：
 *   答错 1 次 → Lv1（心魔初生）
 *   答错 2 次 → Lv2（Lv1→2 花 1 错）
 *   答错 3 次 → Lv3（Lv2→3 花 1 错）
 *   答错 5 次 → Lv4（Lv3→4 花 2 错）
 *   答错 7 次 → Lv5（Lv4→5 花 2 错）
 * 越到高级越「顽固」，符合心魔越炼越强的叙事。
 */
export function wrongsToAdvance(level: number): number {
  const lv = clampInt(level, 1, 5);
  if (lv <= 2) return 1;
  if (lv <= 4) return 2;
  return 3;
}

/**
 * 累计答错多少次才「达到」该等级。
 *
 * 注意含**首次那一次**：答错 1 次就已经是 Lv1 心魔了
 * （心魔由错题催生，第一次答错即诞生）。
 * 因此 wrongsForLevel(1) = 1，而不是 0。
 */
export function wrongsForLevel(level: number): number {
  const target = clampInt(level, 1, 5);
  let acc = 1; // 第一次答错即诞生 Lv1
  for (let lv = 1; lv < target; lv++) acc += wrongsToAdvance(lv);
  return acc;
}

/** 由累计答错次数算等级（1–5）。0 次也返回 1（未答错时心魔尚未诞生，展示层用 Lv1 占位） */
export function levelFromWrongs(wrongCount: number): number {
  const w = Math.max(0, Math.floor(Number(wrongCount) || 0));
  let lv = 1;
  while (lv < 5 && w >= wrongsForLevel(lv + 1)) lv++;
  return lv;
}

/** Lv5 满盈所需额外错次（用于「清理 Lv5 额外奖励」的判定） */
export const LEVEL5_OVERFLOW_WRONGS = 3;

/** 是否已「心魔满盈」（Lv5 且再错 3 次） */
export function isDemonOverflow(level: number, wrongCount: number): boolean {
  if (clampInt(level, 1, 5) < 5) return false;
  return Math.max(0, Math.floor(Number(wrongCount) || 0)) >= wrongsForLevel(5) + LEVEL5_OVERFLOW_WRONGS;
}

/** 清理心魔的额外奖励（仅 Lv5 满盈时） */
export const OVERFLOW_BONUS_SPIRIT = 40;

export function demonClearReward(level: number, wrongCount: number): { spirit: number; bonus: boolean } {
  const base = 10;
  if (isDemonOverflow(level, wrongCount)) return { spirit: base + OVERFLOW_BONUS_SPIRIT, bonus: true };
  return { spirit: base, bonus: false };
}

/* ───────────────── 六、灵田稀有度 ───────────────── */

export interface CropDef {
  id: string;
  name: string;
  /** 生长天数 */
  days: number;
  /** 收获灵石 */
  spirit: number;
  /** 稀有度 */
  rarity: 'common' | 'rare';
  /** 解锁条件文案（未解锁时显示） */
  unlock: string;
  /** 解锁所需连续签到天数（0 = 无门槛） */
  minStreakDays: number;
}

export const CROPS: readonly CropDef[] = [
  { id: 'qi_grass', name: '灵石草', days: 7, spirit: 50, rarity: 'common', unlock: '', minStreakDays: 0 },
  { id: 'lingzhi', name: '灵芝', days: 14, spirit: 150, rarity: 'rare', unlock: '连续签到 30 天解锁', minStreakDays: 30 },
];

/** 稀有种子是否已解锁（按连续签到天数） */
export function isCropUnlocked(crop: CropDef, streakDays: number): boolean {
  if (!crop) return false;
  return Math.max(0, Math.floor(Number(streakDays) || 0)) >= crop.minStreakDays;
}

/** 可种植的作物列表 */
export function availableCrops(streakDays: number): CropDef[] {
  return CROPS.filter((c) => isCropUnlocked(c, streakDays));
}

/* ───────────────── 工具 ───────────────── */

function clampInt(v: number, lo: number, hi: number): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
