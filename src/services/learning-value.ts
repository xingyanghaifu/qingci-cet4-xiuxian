/**
 * 学习价值（Learning Value）—— 让「修为/灵石产出」与「真实学习收益」一一对应
 *
 * ── 为什么必须做这个（对标商业级修仙游戏的核心差距）──
 * 探针实测（真浏览器）证明现有产出与学习价值**完全脱节**：
 *
 *     qiForCorrect.length === 1          // 公式只有「连对」一个参数
 *     qiForCorrect(0|1|2)  = 6
 *     qiForCorrect(3)      = 7
 *     qiForCorrect(5|10|50)= 9           // 连对 10 和 50 一样，且**上限 9**
 *
 *     词                  tier            答对收益
 *     a                  high（高频）      6
 *     abandon            low（低频）       6      ← 与最简单的高频词相同
 *     notwithstanding    core（认知难词）   6
 *
 * 也就是：**刷 20 个高频简单词 = 攻克 20 个生词**，且「已掌握」的词
 * 反复答对收益不衰减。商业级修仙游戏的产出必然与「打多难的怪」挂钩，
 * 这里必须与「学多难的词」挂钩，否则数值再漂亮也**不服务于学习**。
 *
 * ── 设计：产出 = 基础 × 难度权重 × 新鲜度 × 连对 ──
 *
 *   1. **难度权重**（词的档位）—— 越该优先攻克的词，收益越高
 *        认知词 recognition ×1.5（长词/多词缀，最难）
 *        低频   low        ×1.3
 *        核心   core       ×1.15
 *        高频   high       ×1.0（最容易，基础值）
 *      ⚠️ 注意与直觉相反：**高频词收益最低**。这是刻意的 ——
 *      高频词最容易，不该成为刷分对象；认知词最该攻克，收益最高。
 *
 *   2. **新鲜度**（该词已被答对过几次）—— 边际递减，**这是反刷题的关键**
 *        首次答对   ×1.0
 *        第 2 次    ×0.6
 *        第 3 次    ×0.35
 *        第 4 次+   ×0.15（仍有收益，但很低）
 *      直觉：**第一次真正学会一个词，价值最高**。反复答对同一个词
 *      在学习上收益递减，所以游戏收益也必须递减。
 *
 *   3. **连对**（既有机制，保留）—— ×1.0 / ×1.2 / ×1.5
 *
 *   4. **答错补偿**：答错的词进心魔，其**下一次答对**享受「攻克加成」
 *      （因为那正是学习发生的地方）。这是「难度→收益」的正向闭环。
 *
 * ── 三条红线 ──
 *   1. **不鼓励刷题**：新鲜度递减让「刷同一个词」快速归零；
 *      高频词低权重让「刷简单词」无利可图。**收益只来自真正的学习**。
 *   2. **不制造焦虑**：产出只增不减，只是增速不同；不惩罚任何行为。
 *   3. **不破坏既有语义**：连对倍率、每日首登、奇遇加成等全部保留，
 *      本模块只在其上乘一个「学习价值系数」。
 *
 * ── 为什么不改 SM-2 ──
 * 本模块是**纯函数 + 只读信号**，不写 schedule、不改复习间隔。
 * SRS 语义不变（硬约束之一）。
 */

/** 词档位（与 vocab-grades 的 VocabTier 同构，避免跨模块耦合） */
export type Tier = 'high' | 'core' | 'low' | 'recognition';

/**
 * 难度权重：**高频最低、认知词最高**。
 * 理由：产出应当奖励「攻克了更难的词」，而不是奖励「刷了最简单的词」。
 */
export const TIER_WEIGHT: Readonly<Record<Tier, number>> = {
  high: 1.0,
  core: 1.15,
  low: 1.3,
  recognition: 1.5,
};

/** 档位的中文说明（界面用；让玩家知道「为什么这个词更值钱」） */
export const TIER_WEIGHT_LABEL: Readonly<Record<Tier, string>> = {
  high: '高频词 ×1.0（最容易，收益基础值）',
  core: '核心词 ×1.15',
  low: '低频词 ×1.3',
  recognition: '认知词 ×1.5（最难，收益最高）',
};

/**
 * 新鲜度递减：按「该词已被答对过的次数」取系数。
 * 索引 = 已答对次数（0 表示首次）。超出表格取最后一个值。
 *
 * ── 为什么下限是 0.4 而不是 0.15 ──
 * 这是本模块**最需要权衡的一处**，写清楚以免日后被误改：
 *
 *   · 一方面，反复答对同一个词的学习收益确实递减（不该和首次攻克同价）。
 *   · 另一方面，**间隔复习本身就是有效的学习**（SM-2 的全部意义所在）。
 *     如果复习一个已掌握词只给 0.15×，用户会觉得「按 SRS 复习不值钱」，
 *     从而被激励去刷没见过的词 —— 那是**更糟**的学习行为。
 *
 * 所以取 0.4 作为地板：复习仍有实在收益（40%），
 * 而「首次攻克难词」可得 1.0×1.5×1.25 = 1.875 倍难度权重，
 * 两者拉开约 **4.7 倍**差距 —— 足以引导行为，又不惩罚复习。
 */
export const FRESHNESS_STEPS: readonly number[] = [1.0, 0.75, 0.55, 0.4];

/** 攻克加成：答错过的词，下次答对时额外加成（学习真正发生的地方） */
export const CONQUER_BONUS = 1.25;

/** 取新鲜度系数（已答对 n 次之后，再答对一次的系数） */
export function freshnessFactor(correctTimes: number): number {
  const n = Number.isFinite(Number(correctTimes)) && Number(correctTimes) > 0
    ? Math.floor(Number(correctTimes)) : 0;
  const last = FRESHNESS_STEPS.length - 1;
  return FRESHNESS_STEPS[n >= FRESHNESS_STEPS.length ? last : n];
}

/** 归一化档位（未知档位按 core 处理，与 tierOf 的兜底口径一致） */
export function normalizeTier(t: unknown): Tier {
  const v = String(t || '').toLowerCase();
  return (v === 'high' || v === 'low' || v === 'recognition') ? v : 'core';
}

/** 取难度权重 */
export function tierWeight(t: unknown): number {
  return TIER_WEIGHT[normalizeTier(t)];
}

export interface LearningValueInput {
  /** 词的档位（来自 vocab-grades.tierOf） */
  tier?: Tier | string | null;
  /** 该词**此前**已被答对的次数（本次之前） */
  correctTimes?: number;
  /** 该词是否曾答错（心魔词） */
  everWrong?: boolean;
  /** 本次连对数（答对后的 streak） */
  streak?: number;
  /** 连对倍率（由既有 comboMultiplier 提供，保持单一来源） */
  comboMultiplier?: number;
}

export interface LearningValue {
  /** 综合系数（乘在基础收益上） */
  factor: number;
  /** 各分量（便于界面解释与测试） */
  parts: {
    tier: number;
    freshness: number;
    conquer: number;
    combo: number;
  };
  /** 档位（已归一化） */
  tier: Tier;
  /** 是否首次答对（新鲜度 = 1.0） */
  firstTime: boolean;
  /** 一句话解释（界面提示「为什么这次收益高/低」） */
  reason: string;
}

/**
 * 计算一次答对的「学习价值系数」。
 *
 * 纯函数：不读 storage、不改入参。所有信号由调用方传入
 * （模板从 state.schedule / state.wrong / vocab.tierOf 取）。
 */
export function learningValue(input: LearningValueInput = {}): LearningValue {
  // ⚠️ 默认参数 `= {}` **不覆盖显式传入的 null** ——
  // `learningValue(null)` 会走到 `input.tier` 并抛 TypeError（测试抓到的真 bug）。
  // 显式归一化，保证任何脏输入都安全降级。
  const src: LearningValueInput = (input && typeof input === 'object') ? input : {};
  const tier = normalizeTier(src.tier);
  const correctTimes = Number.isFinite(Number(src.correctTimes)) && Number(src.correctTimes) > 0
    ? Math.floor(Number(src.correctTimes)) : 0;

  const tierPart = TIER_WEIGHT[tier];
  const freshPart = freshnessFactor(correctTimes);
  const conquerPart = src.everWrong ? CONQUER_BONUS : 1;
  const comboPart = Number.isFinite(Number(src.comboMultiplier)) && Number(src.comboMultiplier) > 0
    ? Number(src.comboMultiplier) : 1;

  // 四舍五入到 3 位，避免浮点噪声进入存档与快照
  const factor = Math.round(tierPart * freshPart * conquerPart * comboPart * 1000) / 1000;
  const firstTime = correctTimes === 0;

  return {
    factor,
    parts: { tier: tierPart, freshness: freshPart, conquer: conquerPart, combo: comboPart },
    tier,
    firstTime,
    reason: describeLearningValue(tier, correctTimes, !!src.everWrong, firstTime),
  };
}

/** 生成「为什么这次收益是这样」的一句话（界面用） */
export function describeLearningValue(tier: Tier, correctTimes: number, everWrong: boolean, firstTime: boolean): string {
  const bits: string[] = [];
  if (firstTime) bits.push('首次掌握');
  else bits.push(`已答对 ${correctTimes} 次`);
  if (everWrong) bits.push('攻克心魔');
  if (tier === 'recognition') bits.push('认知难词');
  else if (tier === 'low') bits.push('低频词');
  else if (tier === 'high') bits.push('高频词');
  return bits.join(' · ');
}

/**
 * 把学习价值系数应用到基础收益上。
 *
 * @param base 基础收益（通常已含连对倍率；若 base 已含连对，则 comboMultiplier 传 1）
 * @returns 至少 1 的整数收益（保证「答对一定有正反馈」）
 */
export function applyLearningValue(base: number, value: LearningValue): number {
  const b = Number.isFinite(Number(base)) && Number(base) > 0 ? Number(base) : 0;
  const f = value && Number.isFinite(value.factor) && value.factor > 0 ? value.factor : 1;
  return Math.max(1, Math.round(b * f));
}

/**
 * 从「已掌握次数」推断该词的掌握阶段（界面用；不影响收益计算）。
 * 口径与 FRESHNESS_STEPS 对齐：0=生词、1=初识、2=熟悉、3+=已掌握。
 */
export function masteryStage(correctTimes: number): 'new' | 'learning' | 'familiar' | 'mastered' {
  const n = Number.isFinite(Number(correctTimes)) && Number(correctTimes) > 0
    ? Math.floor(Number(correctTimes)) : 0;
  if (n <= 0) return 'new';
  if (n === 1) return 'learning';
  if (n === 2) return 'familiar';
  return 'mastered';
}

/** 掌握阶段的中文名 */
export const MASTERY_LABEL: Readonly<Record<ReturnType<typeof masteryStage>, string>> = {
  new: '生词',
  learning: '初识',
  familiar: '熟悉',
  mastered: '已掌握',
};

/**
 * 估算「同样 20 题」在两种打法下的收益差异（用于界面说明与测试）。
 * 返回倍数（攻克生词 ÷ 刷已掌握高频词），便于直观展示「学习价值」的意义。
 */
export function comparePlaystyles(): { diligent: number; grinder: number; ratio: number } {
  // 勤学者：20 个不同的认知/低频生词，全部首次答对，且有连对
  const diligent = learningValue({ tier: 'recognition', correctTimes: 0, everWrong: true, comboMultiplier: 1.5 }).factor;
  // 刷分者：同一个已掌握的高频词反复答对（第 4 次起）
  const grinder = learningValue({ tier: 'high', correctTimes: 4, everWrong: false, comboMultiplier: 1.5 }).factor;
  return { diligent, grinder, ratio: grinder > 0 ? Math.round((diligent / grinder) * 100) / 100 : 0 };
}
