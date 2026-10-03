/**
 * 学业境界体系（P2.11 修仙主题与学习目标绑定）
 *
 * 与「修为」（旧系统，由灵气值驱动）的区别：
 *   · **修为**：练习积累的 XP，越高说明练得多（原有系统，保留）；
 *   · **境界**：绑定**学习目标**——词汇量 + 模考分数**双条件同时达标**才晋级，
 *     说明学得扎实。两者独立展示，避免「练得多」被误读成「学得好」。
 *
 * 晋级规则（刻意设计）：
 *   1. 双条件：词汇量与模考分数**都**达到阈值，取满足条件的最高档；
 *   2. 只升不降：境界不会因为某次模考失利而掉级（避免挫败与刷分焦虑）；
 *   3. 阈值可解释、可预期：每一档都写明还差多少词、还差多少分。
 */

export interface RealmDef {
  index: number;
  key: string;
  name: string;
  subtitle: string;
  /** 词汇量阈值（词） */
  minVocab: number;
  /** 模考总分阈值（CET-4 满分 710） */
  minScore: number;
  /** 该境界解锁的能力/体验（用于突破提示，不涉及付费或加速） */
  perk: string;
}

export const REALM_MAX_SCORE = 710;

export const REALMS: RealmDef[] = [
  { index: 0, key: 'lianqi', name: '练气', subtitle: '初窥门径', minVocab: 0, minScore: 0, perk: '解锁词汇分级与每日计划' },
  { index: 1, key: 'zhuji', name: '筑基', subtitle: '根基初成', minVocab: 1000, minScore: 400, perk: '解锁错题本统计与周排行榜' },
  { index: 2, key: 'jindan', name: '金丹', subtitle: '丹成气固', minVocab: 2000, minScore: 500, perk: '解锁薄弱点推荐与模考报告对比' },
  { index: 3, key: 'yuanying', name: '元婴', subtitle: '神游物外', minVocab: 3000, minScore: 600, perk: '解锁听力精听全功能与自适应计划' },
  { index: 4, key: 'huashen', name: '化神', subtitle: '通天彻地', minVocab: 4000, minScore: 700, perk: '解锁全卷化神称号与道友小组创建' },
];

export interface RealmInput {
  /** 当前词汇量估计（自适应摸底或已掌握词数） */
  vocabSize: number;
  /** 历史最佳模考总分 */
  bestScore: number;
  /** 已晋级的最高境界（只升不降；缺省时按当前数据计算） */
  currentIndex?: number;
}

export interface RealmGap {
  /** 距离下一境界还差多少词汇 */
  vocab: number;
  /** 距离下一境界还差多少分 */
  score: number;
  /** 词汇条件是否已达标 */
  vocabMet: boolean;
  /** 分数条件是否已达标 */
  scoreMet: boolean;
}

export interface RealmStatus {
  realm: RealmDef;
  next: RealmDef | null;
  gap: RealmGap | null;
  /** 双条件综合进度 0–1（两条件各占一半，取较小值更能反映真实瓶颈） */
  progress: number;
  /** 词汇条件进度 0–1 */
  vocabProgress: number;
  /** 分数条件进度 0–1 */
  scoreProgress: number;
  /** 当前瓶颈：'vocab' | 'score' | null（已达最高境界） */
  bottleneck: 'vocab' | 'score' | null;
  /**
   * 数据上是否已够**更高**境界（即 eligible > 已记录档位），突破尚未落库。
   * 注意：一旦记录落库，realm 会立刻跟到该档位，本字段随即回到 false——
   * 因此它是「待记录」标记，而不是「差一点就升级」。真正的突破事件用 `detectBreakthrough`。
   */
  justEligible: boolean;
}

export function realmByIndex(index: number): RealmDef {
  const clamped = Math.max(0, Math.min(REALMS.length - 1, Math.round(Number(index) || 0)));
  return REALMS[clamped];
}

/** 按双条件算出「数据上够格」的境界档位 */
export function eligibleRealmIndex(input: { vocabSize: number; bestScore: number }): number {
  let index = 0;
  for (const realm of REALMS) {
    if (input.vocabSize >= realm.minVocab && input.bestScore >= realm.minScore) index = realm.index;
  }
  return index;
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

/** 计算境界状态（含到下一境界的差距与进度） */
export function evaluateRealm(input: RealmInput): RealmStatus {
  const eligible = eligibleRealmIndex(input);
  const floor = Math.max(0, Math.min(REALMS.length - 1, Math.round(Number(input.currentIndex ?? eligible) || 0)));
  // 只升不降：历史最高与当前数据取较大者
  const index = Math.max(eligible, floor);
  const realm = realmByIndex(index);
  const next = index < REALMS.length - 1 ? realmByIndex(index + 1) : null;

  if (!next) {
    return {
      realm,
      next: null,
      gap: null,
      progress: 1,
      vocabProgress: 1,
      scoreProgress: 1,
      bottleneck: null,
      justEligible: false,
    };
  }

  const vocabSpan = Math.max(1, next.minVocab - realm.minVocab);
  const scoreSpan = Math.max(1, next.minScore - realm.minScore);
  const vocabProgress = clamp01((input.vocabSize - realm.minVocab) / vocabSpan);
  const scoreProgress = clamp01((input.bestScore - realm.minScore) / scoreSpan);
  const gap: RealmGap = {
    vocab: Math.max(0, next.minVocab - input.vocabSize),
    score: Math.max(0, next.minScore - input.bestScore),
    vocabMet: input.vocabSize >= next.minVocab,
    scoreMet: input.bestScore >= next.minScore,
  };

  return {
    realm,
    next,
    gap,
    // 用两条件的较小值作为综合进度：瓶颈在哪就体现在进度上，不做平均美化
    progress: Math.min(vocabProgress, scoreProgress),
    vocabProgress,
    scoreProgress,
    bottleneck: gap.vocabMet ? 'score' : gap.scoreMet ? 'vocab' : (gap.vocab >= gap.score ? 'vocab' : 'score'),
    justEligible: eligible > floor,
  };
}

export interface Breakthrough {
  fromIndex: number;
  toIndex: number;
  from: RealmDef;
  to: RealmDef;
  /** 一次可能连升多级（数据大幅提升时） */
  levels: number;
}

/**
 * 突破检测（纯函数）：数据上够格更高境界时返回突破信息，否则 null
 * @param previousIndex 上次记录的最高境界
 */
export function detectBreakthrough(previousIndex: number, input: { vocabSize: number; bestScore: number }): Breakthrough | null {
  const from = Math.max(0, Math.round(Number(previousIndex) || 0));
  const to = eligibleRealmIndex(input);
  if (to <= from) return null;
  return {
    fromIndex: from,
    toIndex: to,
    from: realmByIndex(from),
    to: realmByIndex(to),
    levels: to - from,
  };
}

/** 境界状态的可读总结（界面/提示用） */
export function describeRealm(status: RealmStatus): string {
  if (!status.next || !status.gap) return `${status.realm.name} · ${status.realm.subtitle}（已达最高境界）`;
  const parts: string[] = [];
  if (status.gap.vocab > 0) parts.push(`词汇还差约 ${status.gap.vocab} 词`);
  if (status.gap.score > 0) parts.push(`模考还差 ${status.gap.score} 分`);
  // 双条件同时达标时 realm 会直接跟到更高档位，因此这里必然还差至少一项；
  // 保留兜底文案只为函数完备（防御性写法，不是可达状态）。
  return `${status.realm.name} → ${status.next.name}：` + (parts.join('，') || '距下一境界仅一步之遥');
}

/** 境界阈值表（文档与界面展示用） */
export function realmTable(): Array<{ name: string; minVocab: number; minScore: number; subtitle: string }> {
  return REALMS.map((realm) => ({
    name: realm.name,
    minVocab: realm.minVocab,
    minScore: realm.minScore,
    subtitle: realm.subtitle,
  }));
}
