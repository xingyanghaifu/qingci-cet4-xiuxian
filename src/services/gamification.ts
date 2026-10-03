/**
 * 修仙主题与学习目标绑定：状态持久化与判定编排（P2.11）
 *
 * 职责边界：
 *   · 纯判定逻辑在 `src/types/realm.ts` 与 `src/types/titles.ts`（可单测）；
 *   · 本模块只做「采样 → 判定 → 持久化 → 返回本次变化」，
 *     持久化放在独立的 localStorage 键（`qingci.gamification`），不动学习存档。
 *
 * 避免过度游戏化的三条硬约束（代码层面保证）：
 *   1. **不做惩罚**：`evaluateRealm` 只升不降；坚持类称号按累计天数，断签不清零；
 *   2. **不做付费/加速**：本模块没有任何消耗、购买或跳过门槛的分支；
 *   3. **不打断学习**：所有判定都在作答/交卷之后**异步旁路**执行，
 *      返回值仅供界面提示，任何异常都被吞掉，绝不影响答题流程。
 */
import { detectBreakthrough, evaluateRealm, realmByIndex, type Breakthrough, type RealmStatus } from '../types/realm';
import { evaluateTitles, newlyUnlocked, type TitleDef, type TitleEvaluation, type TitlePartStat } from '../types/titles';

export const GAMIFICATION_KEY = 'qingci.gamification';

export interface GamificationSnapshot {
  /** 当前词汇量估计（自适应摸底结果或已掌握词数） */
  vocabSize: number;
  /** 历史最佳模考总分 */
  bestScore: number;
  /** 累计学习天数（自然日去重） */
  studyDays: number;
  /** 间隔复习中达到「熟练」的词数 */
  masteredWords: number;
  /** 是否完整做完过一套模考 */
  fullPaperCompleted: boolean;
  /** 按部分的作答统计 */
  partStats: TitlePartStat[];
}

export interface BreakthroughRecord {
  at: string;
  from: number;
  to: number;
}

export interface TitleUnlockRecord {
  at: string;
  key: string;
}

export interface GamificationState {
  /** 已记录的最高境界（只升不降） */
  realmIndex: number;
  /** 已解锁称号 key */
  titles: string[];
  /** 突破历史（最多保留最近 20 条） */
  breakthroughs: BreakthroughRecord[];
  /** 称号解锁历史（最多保留最近 50 条） */
  titleUnlocks: TitleUnlockRecord[];
}

export const EMPTY_GAMIFICATION: GamificationState = {
  realmIndex: 0,
  titles: [],
  breakthroughs: [],
  titleUnlocks: [],
};

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function resolveStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage;
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** 读取状态（损坏数据回落空状态） */
export function loadGamification(storage?: StorageLike | null): GamificationState {
  const store = resolveStorage(storage);
  if (!store) return { ...EMPTY_GAMIFICATION };
  try {
    const raw = store.getItem(GAMIFICATION_KEY);
    if (!raw) return { ...EMPTY_GAMIFICATION };
    const parsed = JSON.parse(raw) as Partial<GamificationState>;
    return {
      realmIndex: Math.max(0, Math.round(Number(parsed.realmIndex) || 0)),
      titles: Array.isArray(parsed.titles) ? parsed.titles.filter((k) => typeof k === 'string') : [],
      breakthroughs: Array.isArray(parsed.breakthroughs) ? parsed.breakthroughs.slice(-20) : [],
      titleUnlocks: Array.isArray(parsed.titleUnlocks) ? parsed.titleUnlocks.slice(-50) : [],
    };
  } catch {
    return { ...EMPTY_GAMIFICATION };
  }
}

export function saveGamification(state: GamificationState, storage?: StorageLike | null): GamificationState {
  const store = resolveStorage(storage);
  const normalized: GamificationState = {
    realmIndex: Math.max(0, Math.round(Number(state.realmIndex) || 0)),
    titles: [...new Set(state.titles)],
    breakthroughs: state.breakthroughs.slice(-20),
    titleUnlocks: state.titleUnlocks.slice(-50),
  };
  if (store) {
    try {
      store.setItem(GAMIFICATION_KEY, JSON.stringify(normalized));
    } catch {
      /* 隐私模式等场景忽略 */
    }
  }
  return normalized;
}

export interface EvaluateResult {
  status: RealmStatus;
  evaluation: TitleEvaluation;
  /** 本次突破（null 表示没有晋级） */
  breakthrough: Breakthrough | null;
  /** 本次新解锁的称号 */
  newTitles: TitleDef[];
  /** 更新后的持久化状态 */
  state: GamificationState;
}

export interface EvaluateOptions {
  /**
   * 阶段 A 渡劫改道：位次推进延后到渡劫成功。
   * - `true` 时：state.realmIndex 停在 previous（不落库晋级）、breakthroughs 历史不追加，
   *   但 `breakthrough` 仍照常返回（供「渡劫资格已开启」提示使用）；
   * - 同时 status 做展示钳制（realm/进度停在当前境界），避免洞府卡与道友榜显示未获得的境界；
   * - `detectBreakthrough` / `evaluateRealm` 纯函数本身不改，仅在此编排层调整。
   */
  deferRealmAdvance?: boolean;
}

/** defer 模式下把可及档位钳回当前境界的展示态（进度按 当前→目标 重算） */
function clampStatusToPending(
  status: RealmStatus,
  previousIndex: number,
  snapshot: GamificationSnapshot,
): RealmStatus {
  const current = realmByIndex(previousIndex);
  const target = status.realm;
  const clamp01 = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
  const vocabSpan = Math.max(1, target.minVocab - current.minVocab);
  const scoreSpan = Math.max(1, target.minScore - current.minScore);
  return {
    ...status,
    realm: current,
    next: target,
    gap: {
      vocab: Math.max(0, target.minVocab - snapshot.vocabSize),
      score: Math.max(0, target.minScore - snapshot.bestScore),
      vocabMet: snapshot.vocabSize >= target.minVocab,
      scoreMet: snapshot.bestScore >= target.minScore,
    },
    progress: Math.min(
      clamp01((snapshot.vocabSize - current.minVocab) / vocabSpan),
      clamp01((snapshot.bestScore - current.minScore) / scoreSpan),
    ),
    vocabProgress: clamp01((snapshot.vocabSize - current.minVocab) / vocabSpan),
    scoreProgress: clamp01((snapshot.bestScore - current.minScore) / scoreSpan),
    bottleneck: status.bottleneck,
    justEligible: true,
  };
}

/** 由快照计算当前境界与称号，并识别本次的突破与新称号 */
export function evaluateProgress(
  snapshot: GamificationSnapshot,
  previous: GamificationState,
  options: EvaluateOptions = {},
): EvaluateResult {
  const status0 = evaluateRealm({
    vocabSize: snapshot.vocabSize,
    bestScore: snapshot.bestScore,
    currentIndex: previous.realmIndex,
  });
  const evaluation = evaluateTitles({
    partStats: snapshot.partStats,
    studyDays: snapshot.studyDays,
    masteredWords: snapshot.masteredWords,
    bestScore: snapshot.bestScore,
    fullPaperCompleted: snapshot.fullPaperCompleted,
  });

  const breakthrough = detectBreakthrough(previous.realmIndex, {
    vocabSize: snapshot.vocabSize,
    bestScore: snapshot.bestScore,
  });
  const defer = options.deferRealmAdvance === true && status0.realm.index > previous.realmIndex;
  const status = defer ? clampStatusToPending(status0, previous.realmIndex, snapshot) : status0;
  const newTitles = newlyUnlocked(evaluation.unlocked, previous.titles);
  const now = new Date().toISOString();

  const state: GamificationState = {
    realmIndex: defer ? previous.realmIndex : status0.realm.index,
    titles: [...previous.titles, ...newTitles.map((t) => t.key)],
    breakthroughs: !defer && breakthrough
      ? [...previous.breakthroughs, { at: now, from: breakthrough.fromIndex, to: breakthrough.toIndex }].slice(-20)
      : previous.breakthroughs,
    titleUnlocks: [
      ...previous.titleUnlocks,
      ...newTitles.map((t) => ({ at: now, key: t.key })),
    ].slice(-50),
  };

  return { status, evaluation, breakthrough, newTitles, state };
}

/** 便捷入口：读取历史 → 判定 → 持久化 → 返回结果 */
export function recordProgress(
  snapshot: GamificationSnapshot,
  storage?: StorageLike | null,
  options?: EvaluateOptions,
): EvaluateResult {
  const previous = loadGamification(storage);
  const result = evaluateProgress(snapshot, previous, options);
  saveGamification(result.state, storage);
  return result;
}

/** 已解锁称号的展示信息（按解锁时间倒序） */
export function unlockedTitleDetails(state: GamificationState): Array<{ key: string; at: string }> {
  return [...state.titleUnlocks].reverse();
}

/** 突破记录的可读文案 */
export function describeBreakthrough(record: BreakthroughRecord): string {
  return `${new Date(record.at).toLocaleDateString('zh-CN')} · ${realmByIndex(record.from).name} → ${realmByIndex(record.to).name}`;
}
