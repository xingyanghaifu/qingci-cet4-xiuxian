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

/* ───────────────── 灵石产出（v1.11 第二轮补全） ─────────────────
 *
 * ── 为什么灵石也要接学习价值 ──
 * 第一轮只把**修为**接上了学习价值。但灵石是另一条主货币，实测它**完全没接**：
 *
 *     · settle()（答对一题的核心循环）**一点都不给灵石** —— 只有修为
 *     · 所有灵石来源都是固定常数：每日任务 30/45/60、斗法胜 50、联手 80、传功 30
 *     · 商店定价 50–150 也与此无关
 *
 * 也就是：**「灵石怎么来的」与「学得多好」毫无关系**。
 * 灵石只能靠每日任务和斗法获得，而这两者与词难度无关 ——
 * 玩家攒灵石的最优路径是「刷任务/刷斗法」，而不是「攻克生词」。
 *
 * ── 关键设计：**经济中性**（不膨胀总产出）──
 * 直接套用 TIER_WEIGHT 会推高期望产出（全库加权均值 1.2385），
 * 相当于凭空多发 24% 灵石，破坏既有平衡（而平衡改动需人工确认）。
 *
 * 所以另设**归一化**权重：以「全库平均词」为 1.0，
 * 使**期望产出恰好等于基准值**，只是重新分配 ——
 * 攻克生词多拿，刷简单词少拿，总量不变。
 *
 *   档位          原权重   归一权重
 *   高频 high      1.00  →  0.8074
 *   核心 core      1.15  →  0.9285
 *   低频 low       1.30  →  1.0496
 *   认知 recognition 1.50 → 1.2111
 *   （按真实词库分布 681/1589/1452/818 加权，全库均值 = 1.000000）
 *
 * 若词库分布变化，`tests/learning-value.test.mjs` 会用真实分布复算并守住「均值≈1」。
 */

/** 全库加权平均档位权重（由真实词库分布算得；用于归一化） */
export const TIER_WEIGHT_MEAN = 1.238535;

/** 归一化档位权重：期望值为 1.0，保证灵石总产出不膨胀 */
export const TIER_WEIGHT_NORM: Readonly<Record<Tier, number>> = {
  high: 1.0 / TIER_WEIGHT_MEAN,
  core: 1.15 / TIER_WEIGHT_MEAN,
  low: 1.3 / TIER_WEIGHT_MEAN,
  recognition: 1.5 / TIER_WEIGHT_MEAN,
};

/** 取归一化档位权重 */
export function tierWeightNorm(t: unknown): number {
  return TIER_WEIGHT_NORM[normalizeTier(t)];
}

/**
 * 灵石的基础值（**仅首次掌握 / 攻克心魔时**发放，见 spiritValue）。
 *
 * ── 取值依据（刻意取小，避免通胀）──
 * 按学习计划每日约 16 新词：
 *   期望产出 ≈ 16 × 4 ≈ **64 灵石/天**（复习不给灵石）
 *
 * 对比既有收入：每日任务满额 135/天，斗法胜 50/场。
 * 新增的这条约占既有日常收入的 **1/3** ——
 * 让「核心学习循环」终于有经济回报，但**不取代**任务与斗法。
 *
 * 商店单品 50–150：约 1–2 天可买一件，节奏合理。
 */
export const SPIRIT_BASE_PER_MILESTONE = 4;

/**
 * 计算一次答对产出的**灵石**。
 *
 * ── 关键设计：灵石只奖励「里程碑」，修为奖励「练习」 ──
 *
 * 实测发现原状是：答对一题**完全不给灵石**（只有修为），
 * 而所有灵石来源都是固定常数（任务 30/45/60、斗法 50、联手 80），
 * 与词难度无关 —— 于是「攒灵石」的最优路径是刷任务，而不是攻克生词。
 *
 * 但若**每题都给灵石**，又会通胀。所以这里把两条货币的**职能分开**：
 *
 *   · **修为** = 练习的回报 —— 每答对一题都有，按学习价值缩放（第一轮已做）
 *   · **灵石** = **里程碑**的回报 —— 只在两件事上给：
 *       ① **首次掌握**一个词（`correctTimes === 0`）
 *       ② **攻克心魔**（该词在 `state.wrong` 里 —— 答对后即被删除，故只发一次）
 *
 * 这个划分与学习语义一致：**「第一次学会」和「攻下错词」是里程碑，
 * 日常复习不是**。也天然避免了通胀（复习 29 题/天不发灵石）。
 *
 * 经济中性由 `TIER_WEIGHT_NORM` 保证：按真实词库分布加权，
 * 期望值恰为 SPIRIT_BASE_PER_MILESTONE，只是重新分配（难词多、简单词少）。
 */
export interface SpiritValueInput extends LearningValueInput {}

export interface SpiritValue {
  /** 本次答对产出的灵石（整数；复习时为 0） */
  amount: number;
  /** 归一化系数（期望 1.0） */
  factor: number;
  /** 基础值 */
  base: number;
  /** 是否被压到最低档（用于界面提示） */
  minimal: boolean;
  /** 发放原因：first（首次掌握）/ conquer（攻克心魔）/ routine（复习，不发） */
  reason: 'first' | 'conquer' | 'routine';
}
export function spiritValue(input: SpiritValueInput = {}): SpiritValue {
  const src: SpiritValueInput = (input && typeof input === 'object') ? input : {};
  const tier = normalizeTier(src.tier);
  const times = Number.isFinite(Number(src.correctTimes)) && Number(src.correctTimes) > 0
    ? Math.floor(Number(src.correctTimes)) : 0;

  const firstMastery = times === 0;
  const conquering = !!src.everWrong;

  // 日常复习：不发灵石（那是修为的职责）
  if (!firstMastery && !conquering) {
    return { amount: 0, factor: 0, base: SPIRIT_BASE_PER_MILESTONE, minimal: false, reason: 'routine' };
  }

  const factor = tierWeightNorm(tier) * (conquering ? CONQUER_BONUS : 1);
  const amount = Math.max(1, Math.round(SPIRIT_BASE_PER_MILESTONE * factor));

  return {
    amount,
    factor: Math.round(factor * 1000) / 1000,
    base: SPIRIT_BASE_PER_MILESTONE,
    minimal: amount === 1,
    reason: conquering ? 'conquer' : 'first',
  };
}

/** 灵石发放原因（界面提示用） */
export const SPIRIT_REASON_LABEL: Readonly<Record<string, string>> = {
  first: '首次掌握',
  conquer: '攻克心魔',
  routine: '复习（不发灵石）',
};

/**
 * 校验归一化是否正确：按给定档位分布算加权均值。
 * 返回期望产出倍数（应 ≈1）。测试用它守住「经济不膨胀」。
 */
export function expectedSpiritMultiplier(counts: Partial<Record<Tier, number>>): number {
  let total = 0;
  let weighted = 0;
  for (const [k, v] of Object.entries(counts || {})) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) continue;
    total += n;
    weighted += n * tierWeightNorm(k);
  }
  return total > 0 ? weighted / total : 1;
}

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

/* ───────────────── 个人难度（v1.11 第三轮）─────────────────
 *
 * ── 为什么还需要这一层 ──
 * 前两轮用的是**通用难度**（词频分层）与**掌握状态**（答对次数）。
 * 但目标点名的另外两个信号一直没用上：
 *
 *   · `state.schedule[word].level` —— 用户在 SRS 复习里的**自评**（again/hard/good/easy）
 *   · `state.memStats[kind]`       —— **按题型的正确率**（{r, n}）
 *
 * 它们描述的不是「这个词对一般人难不难」，而是「**对你**难不难」。
 * 这是两件不同的事：一个高频词可能恰是某个用户的盲点；
 * 一个认知难词可能是他的强项。只看通用难度会漏掉**个人差异**。
 *
 * ── 设计：弱项加成 + 自评难度加成 ──
 *
 *   1. **题型弱项**（memStats）：某题型正确率越低，答对它收益越高
 *        < 50%  → ×1.20（明显弱项）
 *        < 65%  → ×1.10（待提升）
 *        其余   → ×1.0
 *      样本不足（< KIND_MIN_SAMPLES）不加成 —— 避免「做 1 题全错」就白拿加成。
 *
 *   2. **自评难度**（schedule.level）：用户评过「again/hard」的词，答对时收益更高
 *        again → ×1.25   hard → ×1.15   其余 → ×1.0
 *
 * ── 为什么这不会通胀（关键论证）──
 * 弱项意味着**该题型正确率低**，而正确率低本身就意味着**答对的题更少** ——
 * 例如某题型 50% 正确率，相比 80% 的题型，同样题量下少拿约 37% 修为。
 * 弱项加成（最多 +20%）**不足以补回这个损失**，所以它只是**平滑**进步曲线
 * （让弱项不至于越练越亏），而不是抬高标准产出。
 * 两者叠加的上限 `PERSONAL_FACTOR_CAP = 1.5` 进一步兜底。
 *
 * ── 反刷题：故意答错来「制造弱项」是否划算 ──
 * 实测推演（基础 7 修为/题、加成 20%）：
 *     故意答错  5 题 → 损失 35 修为，之后每题多拿 1.4 → 需再答对 25 题才回本
 *     故意答错 20 题 → 损失 140 修为，之后每题多拿 1.4 → 需再答对 100 题才回本
 * **回本所需题量远大于压低正确率所需题量** —— 不划算。
 * 而且答错还会：进心魔、断连对、失去灵石里程碑机会。故无需额外防刷机制。
 */

/** 题型被判定为「弱项」所需的最少作答数（防「1 题全错」白拿加成） */
export const KIND_MIN_SAMPLES = 5;

/** 题型弱项档位（正确率上限降序，取第一个命中） */
export const WEAK_KIND_TIERS: ReadonlyArray<{ maxAccuracy: number; bonus: number; label: string }> = [
  { maxAccuracy: 0.5, bonus: 1.2, label: '明显弱项' },
  { maxAccuracy: 0.65, bonus: 1.1, label: '待提升' },
];

/** 自评难度加成（用户在 SRS 复习里给出的评级） */
export const SELF_RATED_BONUS: Readonly<Record<string, number>> = {
  again: 1.25,
  hard: 1.15,
};

/** 个人难度总系数上限（兜底，防止多项叠加过度膨胀） */
export const PERSONAL_FACTOR_CAP = 1.5;

/** 题型统计行（与模板 state.memStats[kind] 一致） */
export interface KindStat { r?: number; n?: number }

/**
 * 题型弱项系数。`stat` 形如 `{r: 答对, n: 总作答}`。
 * 样本不足或数据非法时返回 1.0（不加成）。
 */
export function kindWeaknessFactor(stat: KindStat | null | undefined): number {
  if (!stat || typeof stat !== 'object') return 1;
  const n = Number(stat.n);
  const r = Number(stat.r);
  if (!Number.isFinite(n) || !Number.isFinite(r) || n < KIND_MIN_SAMPLES) return 1;
  const correct = Math.max(0, Math.min(r, n));
  const acc = correct / n;
  for (const tier of WEAK_KIND_TIERS) if (acc < tier.maxAccuracy) return tier.bonus;
  return 1;
}

/** 题型弱项的可读名（无弱项时返回空串） */
export function weakKindLabel(stat: KindStat | null | undefined): string {
  if (!stat || typeof stat !== 'object') return '';
  const n = Number(stat.n);
  const r = Number(stat.r);
  if (!Number.isFinite(n) || !Number.isFinite(r) || n < KIND_MIN_SAMPLES) return '';
  const acc = Math.max(0, Math.min(r, n)) / n;
  for (const tier of WEAK_KIND_TIERS) if (acc < tier.maxAccuracy) return tier.label;
  return '';
}

/** 自评难度系数（level 为 'again' / 'hard' / 'good' / 'easy' 或未知） */
export function selfRatedFactor(level: unknown): number {
  const k = String(level || '').toLowerCase();
  return SELF_RATED_BONUS[k] || 1;
}

export interface PersonalDifficultyInput {
  /** 当前题型的 memStats 行 */
  kindStat?: KindStat | null;
  /** 当前词在 SRS 里的自评 level */
  selfLevel?: string | null;
}

export interface PersonalDifficulty {
  /** 综合系数（已按 PERSONAL_FACTOR_CAP 封顶） */
  factor: number;
  /** 分项 */
  parts: { kind: number; selfRated: number };
  /** 是否命中弱项 */
  weak: boolean;
  /** 一句话解释（界面用；无加成时为空串） */
  reason: string;
}

/**
 * 个人难度系数 = 题型弱项 × 自评难度（封顶 PERSONAL_FACTOR_CAP）。
 * 纯函数，不读 storage、不改入参。
 */
export function personalDifficulty(input: PersonalDifficultyInput = {}): PersonalDifficulty {
  const src: PersonalDifficultyInput = (input && typeof input === 'object') ? input : {};
  const kind = kindWeaknessFactor(src.kindStat);
  const selfRated = selfRatedFactor(src.selfLevel);
  const raw = kind * selfRated;
  const factor = Math.round(Math.min(PERSONAL_FACTOR_CAP, raw) * 1000) / 1000;

  const bits: string[] = [];
  const kl = weakKindLabel(src.kindStat);
  if (kl) bits.push(kl);
  const lvl = String(src.selfLevel || '').toLowerCase();
  if (lvl === 'again') bits.push('上次标记为「忘记」');
  else if (lvl === 'hard') bits.push('上次标记为「模糊」');

  return {
    factor,
    parts: { kind, selfRated },
    weak: kind > 1,
    reason: bits.join(' · '),
  };
}

/** 把个人难度系数应用到基础收益上（与 applyLearningValue 同语义） */
export function applyPersonalDifficulty(base: number, pd: PersonalDifficulty): number {
  const b = Number.isFinite(Number(base)) && Number(base) > 0 ? Number(base) : 0;
  const f = pd && Number.isFinite(pd.factor) && pd.factor > 0 ? pd.factor : 1;
  return Math.max(1, Math.round(b * f));
}

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
