/**
 * 渡劫（修炼生态 · 阶段 A）——纯逻辑层
 *
 * 设计要点（与既有体系的边界）：
 * - 资格判定复用 `eligibleRealmIndex`（学业五档，双条件：词汇量 + 模考分），不新建阈值表；
 * - 当前位次读持久化的 `gamification.realmIndex`（五档，突破动效展示的那条梯子）；
 *   侧栏「修为 · XXX」是另一条十档 qi 进度梯（realm() 推导），两者互不改写：
 *   失败扣「修为(qi)」必须**不掉十档里的境界**——由 UI 传入 maxSafeDeduct（realm() 当层结余）
 *   夹住扣罚实现，本模块不复制模板里的 qi 阈值表（单一事实源）。
 * - 抽题**完全复用** `selectPracticeSet`（R2）：同 seed + 同排除集 ⇒ 同一套题（确定性）。
 *   bank 的 difficulty 是 0–1 归一化量纲；difficultyForRealm 输出 1–5 是模板展示口径，
 *   这里用同公式换算到 0–1 带（difficultyRangeForRealm）。
 * - R9 隔离门谓词 `tribulationSessionYields`：全局快捷键在渡劫会话可见时整体让位
 *   （模板内联同义判断，静态测试钉住两者一致 + 调用顺序）。
 */

import { eligibleRealmIndex, realmByIndex, REALMS } from '../types/realm';
import { selectPracticeSet, type BankQuestion, type QuestionBank } from '../types/question-bank';
import { storeOf, promisify, type MinimalFactory, type MinimalObjectStore } from './idb';

/* ───────────────── 常量（可调参数集中于此） ───────────────── */

/** 渡劫题量 */
export const TRIBULATION_TOTAL = 10;
/** 答对 ≥8 渡劫成功 */
export const TRIBULATION_PASS = 8;
/** 渡劫冷却：成功或失败都进冷却（24h） */
export const TRIBULATION_COOLDOWN_MS = 24 * 60 * 60 * 1000;
/** 渡劫成功的灵石奖励（spec 未给数值，集中为常量便于调参） */
export const TRIBULATION_REWARD_SPIRIT = 100;
/** 客观题型白名单：听力三型 + 阅读客观三型（排除写作/翻译） */
export const TRIBULATION_KINDS: readonly string[] = ['news', 'talk', 'passage', 'bank', 'match', 'detail'];

/** 失败扣罚比例（答对 5–7 题 / <5 题） */
export const TRIBULATION_PENALTY = { mid: 0.1, low: 0.2 } as const;

/* ───────────────── 数据模型（A1.5） ───────────────── */

export interface TribulationRecord {
  id: string;
  realmFrom: number;
  realmTo: number;
  startedAt: string;
  finishedAt: string;
  correctCount: number;
  totalCount: number;
  passed: boolean;
  qiPenalty: number; // 0 表示成功（或护道符抵扣后为 0）
  questionIds: string[];
  /** Esc 放弃或超时结束（放弃永不判过） */
  abandoned?: boolean;
}

/* ───────────────── 持久化（tribulations 仓，schema v5 已建） ───────────────── */

async function tribStore(mode: 'readonly' | 'readwrite'): Promise<MinimalObjectStore | null> {
  try {
    return await storeOf('tribulations', mode);
  } catch {
    return null;
  }
}

/** 落一条渡劫记录（写失败静默返回 false：界面流程不因存储中断） */
export async function saveTribulationRecord(record: TribulationRecord): Promise<boolean> {
  try {
    const store = await tribStore('readwrite');
    if (!store) return false;
    await promisify<unknown>(store.put(record, record.id));
    return true;
  } catch {
    return false;
  }
}

/** 最近一次渡劫（冷却判定数据源）；无记录或读取失败返回 null */
export async function latestTribulationRecord(): Promise<TribulationRecord | null> {
  try {
    const store = await tribStore('readonly');
    if (!store) return null;
    const rows = await promisify<TribulationRecord[]>(store.getAll());
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return rows.reduce((a, b) => (String(b.finishedAt) > String(a.finishedAt) ? b : a));
  } catch {
    return null;
  }
}

/* ───────────────── 道具清单摘要（境界卡只读展示，购买/效果在步骤 5 接） ───────────────── */

export interface InventorySummary {
  /** 护道符持有张数 */
  talisman: number;
  /** 聚灵阵生效截止（ISO）；无生效记录为 null */
  arrayUntil: string | null;
  /** 记忆丹覆盖中的词（7 天窗口内） */
  pills: string[];
  /** 参悟古籍已解锁的词 */
  books: string[];
}

/** 由库存条目纯计算摘要（id 规则见 idb.ts：常驻=itemId，按词=itemId:targetId） */
export function readInventorySummary(
  items: Array<{ id: string; count?: number; activeUntil?: string }> | null | undefined,
  now: number = Date.now(),
): InventorySummary {
  const list = Array.isArray(items) ? items : [];
  const talismanRow = list.find((it) => it && it.id === 'talisman');
  const arrayRow = list.find((it) => it && it.id === 'array');
  const arrayUntil = arrayRow && arrayRow.activeUntil ? String(arrayRow.activeUntil) : null;
  const untilMs = arrayUntil ? Date.parse(arrayUntil) : NaN;
  const pills: string[] = [];
  const books: string[] = [];
  for (const it of list) {
    const id = it && typeof it.id === 'string' ? it.id : '';
    if (id.startsWith('pill:')) {
      const t = it && it.activeUntil ? Date.parse(it.activeUntil) : NaN;
      if (Number.isFinite(t) && t > now) pills.push(id.slice(5));
    } else if (id.startsWith('book:')) {
      books.push(id.slice(5));
    }
  }
  return {
    talisman: Math.max(0, Number(talismanRow && talismanRow.count) || 0),
    arrayUntil: Number.isFinite(untilMs) && untilMs > now ? arrayUntil : null,
    pills,
    books,
  };
}

/** 读取库存并计算摘要（库存不可用 → 全零，境界卡静默不显示） */
export async function loadInventorySummary(
  now: number = Date.now(),
  factory?: MinimalFactory | null,
): Promise<InventorySummary> {
  try {
    const inv = await storeOf('inventory', 'readonly', factory);
    const rows = await promisify<Array<{ id: string; count?: number; activeUntil?: string }>>(inv.getAll());
    return readInventorySummary(rows, now);
  } catch {
    return { talisman: 0, arrayUntil: null, pills: [], books: [] };
  }
}

/* ───────────────── 资格与冷却（A1.2 / A1.6） ───────────────── */

export interface TribulationContext {
  /** 当前修为（state.qi），用于扣罚计算 */
  qi: number;
  /** 当前持久位次（gamification.realmIndex，五档 0..4） */
  currentIndex: number;
  /** 词汇量口径：Math.max(已斩词数, 摸底估值)（与埋点快照同源） */
  vocabSize: number;
  /** 历史最佳模考分 */
  bestScore: number;
  /** 上次渡劫结束时间（成功/失败/放弃都算）；无则 null */
  lastFinishedAt?: string | null;
  /** 注入时钟（测试用），缺省 Date.now() */
  now?: number;
}

export type TribulationDenyReason = 'maxed' | 'not-qualified' | 'cooldown';

export interface TribulationEligibility {
  ok: boolean;
  reason?: TribulationDenyReason;
  /** 当前可挑战的下一个位次（targetIndex = currentIndex + 1） */
  targetIndex: number;
  /** 双条件给出的最高可及位次 */
  eligibleIndex: number;
  /** 冷却剩余毫秒（reason==='cooldown' 时给出） */
  remainingMs?: number;
  /** 距离下一境界的双条件缺口（reason==='not-qualified' 时给出） */
  gap?: { vocab: number; score: number };
}

/** 埋点快照同款词汇量口径：已斩词数与摸底估值取大 */
export function vocabSizeOf(knownCount: number, assessed: number): number {
  return Math.max(Number(knownCount) || 0, Number(assessed) || 0);
}

/** 资格 + 24h 冷却；已达顶档返回 maxed */
export function canTribulate(ctx: TribulationContext): TribulationEligibility {
  const targetIndex = ctx.currentIndex + 1;
  const eligibleIndex = eligibleRealmIndex({ vocabSize: ctx.vocabSize, bestScore: ctx.bestScore });

  if (targetIndex >= REALMS.length) {
    return { ok: false, reason: 'maxed', targetIndex, eligibleIndex };
  }

  const now = ctx.now ?? Date.now();
  if (ctx.lastFinishedAt) {
    const finished = Date.parse(ctx.lastFinishedAt);
    if (Number.isFinite(finished)) {
      const elapsed = now - finished;
      if (elapsed < TRIBULATION_COOLDOWN_MS) {
        return {
          ok: false,
          reason: 'cooldown',
          targetIndex,
          eligibleIndex,
          remainingMs: TRIBULATION_COOLDOWN_MS - Math.max(0, elapsed),
        };
      }
    }
  }

  if (eligibleIndex < targetIndex) {
    const def = realmByIndex(targetIndex);
    return {
      ok: false,
      reason: 'not-qualified',
      targetIndex,
      eligibleIndex,
      gap: {
        vocab: Math.max(0, (def?.minVocab ?? 0) - ctx.vocabSize),
        score: Math.max(0, (def?.minScore ?? 0) - ctx.bestScore),
      },
    };
  }

  return { ok: true, targetIndex, eligibleIndex };
}

/* ───────────────── 抽题（A1.3，复用现有组卷器） ───────────────── */

/**
 * 难度带（0–1 归一化）。沿用 difficultyForRealm 的公式
 * `clamp(1..5, examLevel + floor(realmTo / 2))` 得到 1–5 档，
 * 再线性映射到 bank 量纲：center = 0.2 + (d-1)*0.15，带宽 ±0.15。
 */
export function difficultyRangeForRealm(realmTo: number, examLevel = 4): [number, number] {
  // realmTo 先夹到非负：floor(-5/2)=-3 会把档位拉低（脏输入防御）
  const r = Math.max(0, Number(realmTo) || 0);
  const d = Math.max(1, Math.min(5, (Number(examLevel) || 4) + Math.floor(r / 2)));
  const center = 0.2 + (d - 1) * 0.15;
  return [Math.max(0, Math.round((center - 0.15) * 100) / 100), Math.min(1, Math.round((center + 0.15) * 100) / 100)];
}

export interface PickOptions {
  /** 目标境界（五档位次），决定难度带 */
  realmTo: number;
  /** 随机种子：同 seed + 同排除集 ⇒ 同一套题 */
  seed: number;
  count?: number;
  excludeIds?: string[];
  examLevel?: number;
  /** 难度带覆盖（仅用于题量不足时的加宽补抽，缺省按境界推导） */
  difficulty?: [number, number];
}

/**
 * 渡劫抽题：完全委托 selectPracticeSet（确定性、题型均衡、加权抽样）。
 * 客观题白名单 + 目标境界难度带；不足 count 时返回池内全部。
 */
export function pickTribulationQuestions(bank: QuestionBank, opts: PickOptions): BankQuestion[] {
  const set = selectPracticeSet(bank, {
    count: opts.count ?? TRIBULATION_TOTAL,
    kinds: [...TRIBULATION_KINDS],
    difficulty: opts.difficulty ?? difficultyRangeForRealm(opts.realmTo, opts.examLevel ?? 4),
    seed: opts.seed,
    excludeIds: opts.excludeIds ?? [],
  });
  return set.questions;
}

/* ───────────────── 判定与扣罚（A1.3） ───────────────── */

export interface GradeInput {
  /** 当前修为（qi） */
  qi: number;
  /**
   * 本层可安全扣除上限 = realm() 当层结余（into）。
   * 夹住它可保证「扣修为不掉境界」（十档梯子 index 不变）。
   * 由 UI 从 realm() 传入，本模块不复制 qi 阈值表。
   */
  maxSafeDeduct: number;
  hasTalisman?: boolean;
  /** Esc 放弃：永不判过，≥5 按 10% 档、<5 按 20% 档 */
  abandoned?: boolean;
}

export interface GradeResult {
  passed: boolean;
  /** 实际扣除的修为（已过夹逼与护道符抵扣） */
  qiPenalty: number;
  /** 护道符是否被消耗（仅在会产生扣罚时消耗） */
  talismanUsed: boolean;
  /** 扣罚前的原始比例档（0 / 0.1 / 0.2），便于 UI 文案 */
  penaltyRate: number;
}

/** 三档判定 + 护道符抵扣 + 「不掉境界」夹逼 */
export function gradeTribulation(correctCount: number, input: GradeInput): GradeResult {
  const correct = Math.max(0, Math.min(TRIBULATION_TOTAL, Number(correctCount) || 0));

  // 放弃：按约定永不判过（即使已答对 ≥8 也按失败档，堵住中途白嫖）
  const passed = !input.abandoned && correct >= TRIBULATION_PASS;
  if (passed) {
    return { passed: true, qiPenalty: 0, talismanUsed: false, penaltyRate: 0 };
  }

  const penaltyRate = correct >= 5 ? TRIBULATION_PENALTY.mid : TRIBULATION_PENALTY.low;
  const raw = Math.ceil((Number(input.qi) || 0) * penaltyRate);
  const capped = Math.min(
    raw,
    Math.max(0, Number(input.maxSafeDeduct) || 0),
    Math.max(0, Number(input.qi) || 0),
  );

  if (capped <= 0) {
    return { passed: false, qiPenalty: 0, talismanUsed: false, penaltyRate };
  }
  if (input.hasTalisman) {
    // 护道符：抵挡这一次扣修为（消耗一张），扣除归零
    return { passed: false, qiPenalty: 0, talismanUsed: true, penaltyRate };
  }
  return { passed: false, qiPenalty: capped, talismanUsed: false, penaltyRate };
}

/* ───────────────── R9：全局快捷键让位门（语义单一事实源） ───────────────── */

export interface ClassListLike {
  contains(token: string): boolean;
}

/**
 * 模板全局 keydown 顶部内联判断的语义孪生（静态测试钉住两者一致）：
 * 会话元素存在且非 hidden ⇒ 全局快捷键整体让位；元素缺失/hidden/类被移除 ⇒ 全局照常。
 */
export function tribulationSessionYields(session: { classList: ClassListLike } | null | undefined): boolean {
  return !!session && !session.classList.contains('hidden');
}

/* ───────────────── 会话运行时的纯核心（③ 步骤 3；只增不改既有判定语义） ───────────────── */

/** 单轮时限 5 分钟 */
export const TRIBULATION_TIME_LIMIT_MS = 5 * 60 * 1000;

export interface TribSessionState {
  /** 当前题号（0 起；达到 total 即完成） */
  idx: number;
  correct: number;
  answers: number[];
  total: number;
  /** 选中即确认后的推进锁（防连点），渲染下一题时释放 */
  locked: boolean;
}

export function createTribSession(total: number = TRIBULATION_TOTAL): TribSessionState {
  return { idx: 0, correct: 0, answers: [], total: Math.max(1, total), locked: false };
}

/** 选中即确认：返回新状态；locked 或越界时原样返回（幂等防抖） */
export function answerPick(s: TribSessionState, chosenIdx: number, correctIdx: number): TribSessionState {
  if (s.locked || !Number.isInteger(chosenIdx) || chosenIdx < 0) return s;
  const correct = chosenIdx === correctIdx;
  return {
    ...s,
    answers: [...s.answers, chosenIdx],
    correct: s.correct + (correct ? 1 : 0),
    idx: s.idx + 1,
    locked: true,
  };
}

/** 渲染下一题时释放推进锁 */
export function releaseTribLock(s: TribSessionState): TribSessionState {
  return s.locked ? { ...s, locked: false } : s;
}

export function tribSessionDone(s: TribSessionState): boolean {
  return s.idx >= s.total;
}

/** 倒计时文案：'剩余 5:00' / '剩余 0:07' / 归零 '剩余 0:00' */
export function formatTribTime(leftSeconds: number): string {
  const left = Math.max(0, Math.floor(Number(leftSeconds) || 0));
  const m = Math.floor(left / 60);
  const s = left % 60;
  return `剩余 ${m}:${String(s).padStart(2, '0')}`;
}

/** ≤30 秒进入警示（>0；归零由结束流程接管） */
export function tribTimerWarn(leftSeconds: number): boolean {
  const l = Number(leftSeconds) || 0;
  return l > 0 && l <= 30;
}

/** 数字键 → 选项下标；非 1-4 返回 null */
export function tribPickIndexFromKey(key: string): number | null {
  return key.length === 1 && key >= '1' && key <= '4' ? Number(key) - 1 : null;
}

/**
 * 题目正确选项下标：answer 既可能是选项文本（题库主形态）也可能是数字下标。
 * 两者都识别不出时返回 -1（调用方按答错处理）。
 */
export function tribCorrectIndex(question: { content?: { choices?: unknown[]; answer?: unknown } } | null | undefined): number {
  const content = question && question.content ? question.content : {};
  const choices = Array.isArray(content.choices) ? content.choices : [];
  const answer = content.answer;
  const byText = choices.indexOf(answer);
  if (byText >= 0) return byText;
  const n = Number(answer);
  return Number.isInteger(n) && n >= 0 && n < choices.length ? n : -1;
}
