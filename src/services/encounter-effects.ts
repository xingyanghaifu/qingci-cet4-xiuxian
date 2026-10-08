/**
 * 奇遇效果结算（修炼生态 · 阶段 B 补全）
 *
 * ── 为什么需要这个模块 ──
 * `encounters.ts` 定义了 6 个奇遇、每个都带 `effect` 标识，但模板里的
 * `applyEncounter` 只对 `qi_rain` 做了真实结算，其余 5 个**只弹一句 toast**：
 *
 *     scroll   → '拾得残卷 · 待与词库联动（book 解锁）'   ← 从未联动
 *     beast    → '灵兽来投 · XXX 认主了'                ← 认主了但没有灵兽
 *     cave     → '效果已生效（1 小时内）'                ← 没有任何效果
 *     old_master → '效果已生效（1 小时内）'              ← 同上
 *     demon_raid → '去心魔录迎战'                        ← 只是指路
 *
 * 也就是说：**奇遇的承诺是空头支票**。玩家点「领取」只看到一句话，
 * 什么也没发生 —— 这是可玩性上最亏的一种缺陷（有内容、有期待、无回报）。
 *
 * 本模块把 6 个效果全部落成真实机制。
 *
 * ── 设计（与 gamification.ts 同一套路）──
 *   · **纯函数**：`applyEffect` 是 `(type, state, ctx) → { state, outcome }` 的
 *     纯状态转移，不碰 DOM、不碰 storage、不 import 业务模块 → 可完整单测；
 *   · **副作用交给调用方**：outcome 是声明式的（「给灵石 50」「解锁某词的深度解析」
 *     「开一组心魔复习」），由模板执行 —— 这样「判定」与「写盘」分离，
 *     测试不需要假 DOM / 假 IDB；
 *   · **独立存储键**：`qingci.encounterEffects`，**不动学习存档**（与
 *     gamification 的 `qingci.gamification` 同规矩），用户进度零风险；
 *   · **可注入 now / rand / words**：测试确定性可复现。
 *
 * ── 三条设计红线（沿用既有约定）──
 *   1. **不制造焦虑**：所有增益都是**加法**，到期自然失效，不扣任何既有资产；
 *   2. **不鼓励刷题**：倍率有上限（洞天 1.5×、灵兽 1.1×），且不与做题量挂钩；
 *   3. **不侵入学习**：只影响修为/灵石收益与可选复习入口，
 *      **SM-2 / SRS 语义一字未改**。
 */

/** 效果标识（与 encounters.ts 的 EncounterDef.effect 一一对应） */
export type EncounterEffect =
  | 'spirit_grant'
  | 'demon_review'
  | 'word_focus'
  | 'book_unlock'
  | 'focus_boost'
  | 'beast_unlock';

/** 独立存储键（不动学习存档） */
export const EFFECTS_KEY = 'qingci.encounterEffects';

/** 洞天福地增益倍率（1 小时效率大增） */
export const CAVE_QI_MULTIPLIER = 1.5;
/** 灵兽随行的被动修为加成（永久，仅一只） */
export const BEAST_QI_MULTIPLIER = 1.1;
/** 遇老道指点：该词当日答对额外修为 */
export const FOCUS_BONUS_QI = 10;
/** 灵石雨范围（与既有实现一致：30–80） */
export const QI_RAIN_MIN = 30;
export const QI_RAIN_MAX = 80;

export interface BeastCompanion {
  name: string;
  since: string;
}

export interface EncounterEffectsState {
  /** 洞天福地到期时间（ISO）；过期即失效 */
  caveUntil?: string;
  /** 遇老道指点：今日重点词 */
  focusWord?: string;
  /** 重点词所属本地日（跨日自动失效，避免「昨天的重点词」一直生效） */
  focusDay?: string;
  /** 灵兽随行（永久，认主一次） */
  beast?: BeastCompanion;
}

export const EMPTY_EFFECTS: EncounterEffectsState = {};

/** 声明式结果：由调用方执行副作用（本模块不写盘、不碰 DOM） */
export type EffectOutcome =
  | { kind: 'spirit'; amount: number }
  | { kind: 'book'; word: string }
  | { kind: 'beast'; name: string }
  | { kind: 'focus'; word: string }
  | { kind: 'cave'; until: string }
  | { kind: 'demon_review' };

export interface EffectContext {
  now?: number;
  /** 可注入随机源（返回 [0,1)），测试确定性用 */
  rand?: () => number;
  /** 当前词库词表（scroll 解锁 / old_master 选词用） */
  words?: readonly string[];
  /** 本地日 key（缺省由 now 推导，与 encounters.localDateKey 同口径） */
  dayKey?: string;
}

/* ───────────────── 存储（localStorage 安全读写） ───────────────── */

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

/** 本地日 key（本地时区，与 encounters.localDateKey 同口径 —— R13） */
export function localDayKey(now: number = Date.now()): string {
  const d = new Date(now);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 读取效果状态（损坏数据回落空状态；任何异常都不抛） */
export function loadEffects(storage?: StorageLike | null): EncounterEffectsState {
  const store = resolveStorage(storage);
  if (!store) return { ...EMPTY_EFFECTS };
  try {
    const raw = store.getItem(EFFECTS_KEY);
    if (!raw) return { ...EMPTY_EFFECTS };
    const p = JSON.parse(raw) as Partial<EncounterEffectsState>;
    const out: EncounterEffectsState = {};
    if (typeof p.caveUntil === 'string' && p.caveUntil) out.caveUntil = p.caveUntil;
    if (typeof p.focusWord === 'string' && p.focusWord) out.focusWord = p.focusWord;
    if (typeof p.focusDay === 'string' && p.focusDay) out.focusDay = p.focusDay;
    if (p.beast && typeof p.beast === 'object' && typeof p.beast.name === 'string' && p.beast.name) {
      out.beast = { name: p.beast.name, since: String(p.beast.since || '') };
    }
    return out;
  } catch {
    return { ...EMPTY_EFFECTS };
  }
}

export function saveEffects(state: EncounterEffectsState, storage?: StorageLike | null): EncounterEffectsState {
  const normalized: EncounterEffectsState = {};
  if (state.caveUntil) normalized.caveUntil = String(state.caveUntil);
  if (state.focusWord) normalized.focusWord = String(state.focusWord);
  if (state.focusDay) normalized.focusDay = String(state.focusDay);
  if (state.beast && state.beast.name) normalized.beast = { name: String(state.beast.name), since: String(state.beast.since || '') };
  const store = resolveStorage(storage);
  if (store) {
    try {
      store.setItem(EFFECTS_KEY, JSON.stringify(normalized));
    } catch {
      /* 隐私模式等场景忽略 */
    }
  }
  return normalized;
}

/* ───────────────── 只读判定（供模板与测试共用） ───────────────── */

/**
 * 解析「状态」参数：显式传入则用它，省略则从存储读。
 *
 * 为什么要有这个分支：模板里的调用点是 `qiMultiplier()` / `activeBoostLabels()`
 * 这类**无参**形式（调用方不该被迫先自己 load 一遍）。最初我把 state 设成必填，
 * 结果模板传 undefined → 一律判定「无增益」→ 倍率恒为 1、徽标永不显示。
 * 这个缺陷单测抓不到（单测总是显式传 state），是**真浏览器验收**抓到的。
 *
 * 约定：`undefined` = 未传，去读存储；`null` = 明确表示「没有状态」，不读存储。
 */
function resolveState(
  state: EncounterEffectsState | null | undefined,
  storage?: StorageLike | null,
): EncounterEffectsState | null {
  if (state === undefined) return loadEffects(storage);
  return state || null;
}

/** 洞天福地是否生效（省略 state 时自动读存储） */
export function caveActive(
  state?: EncounterEffectsState | null,
  now: number = Date.now(),
  storage?: StorageLike | null,
): boolean {
  const s = resolveState(state, storage);
  const until = s && s.caveUntil ? Date.parse(s.caveUntil) : NaN;
  return Number.isFinite(until) && until > now;
}

/** 灵兽是否随行（省略 state 时自动读存储） */
export function beastActive(
  state?: EncounterEffectsState | null,
  storage?: StorageLike | null,
): boolean {
  const s = resolveState(state, storage);
  return !!(s && s.beast && s.beast.name);
}

/**
 * 今日重点词（遇老道指点）。
 * **跨日自动失效**：focusDay 与今天不同则视为无 —— 否则昨天的重点词会一直生效。
 */
export function focusWordOf(
  state?: EncounterEffectsState | null,
  now: number = Date.now(),
  storage?: StorageLike | null,
): string | null {
  const s = resolveState(state, storage);
  if (!s || !s.focusWord) return null;
  if (!s.focusDay || s.focusDay !== localDayKey(now)) return null;
  return s.focusWord;
}

/**
 * 综合修为倍率 = 洞天福地 × 灵兽。
 * 两者独立相乘（都是**加法型**增益，不改任何判定语义）。
 */
export function qiMultiplier(
  state?: EncounterEffectsState | null,
  now: number = Date.now(),
  storage?: StorageLike | null,
): number {
  const s = resolveState(state, storage);
  let m = 1;
  if (caveActive(s, now)) m *= CAVE_QI_MULTIPLIER;
  if (beastActive(s)) m *= BEAST_QI_MULTIPLIER;
  return m;
}

/** 单题修为的实际收益（基础分 → 应用倍率 → 取整） */
export function applyQiMultiplier(baseQi: number, multiplier: number): number {
  const b = Math.max(0, Math.round(Number(baseQi) || 0));
  const m = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
  return Math.round(b * m);
}

/** 该词是否为今日重点词（命中则加 FOCUS_BONUS_QI；省略 state 时自动读存储） */
export function focusBonusFor(
  word: string | null | undefined,
  state?: EncounterEffectsState | null,
  now: number = Date.now(),
  storage?: StorageLike | null,
): number {
  const focus = focusWordOf(state, now, storage);
  if (!focus || !word) return 0;
  return String(word).toLowerCase() === focus.toLowerCase() ? FOCUS_BONUS_QI : 0;
}

/** 生效中的增益摘要（状态栏/通知展示用；空数组表示无增益；省略 state 时自动读存储） */
export function activeBoostLabels(
  state?: EncounterEffectsState | null,
  now: number = Date.now(),
  storage?: StorageLike | null,
): string[] {
  const s = resolveState(state, storage);
  const out: string[] = [];
  if (caveActive(s, now)) out.push(`洞天福地 · 修为 ×${CAVE_QI_MULTIPLIER}`);
  if (beastActive(s)) out.push(`灵兽随行 · 修为 ×${BEAST_QI_MULTIPLIER}`);
  const f = focusWordOf(s, now);
  if (f) out.push(`老道指点 · ${f} +${FOCUS_BONUS_QI}`);
  return out;
}

/* ───────────────── 状态转移（纯函数） ───────────────── */

/** 整数区间随机（含两端），rand 可注入 */
function randInt(lo: number, hi: number, rand: () => number): number {
  const span = Math.max(0, hi - lo);
  const v = Number(rand());
  const r = Number.isFinite(v) ? Math.min(0.9999999, Math.max(0, v)) : 0;
  return lo + Math.floor(r * (span + 1));
}

/** 从词表里挑一个词（rand 可注入；空词表返回 null） */
function pickWord(words: readonly string[] | undefined, rand: () => number): string | null {
  const list = Array.isArray(words) ? words.filter((w) => typeof w === 'string' && w) : [];
  if (!list.length) return null;
  const v = Number(rand());
  const r = Number.isFinite(v) ? Math.min(0.9999999, Math.max(0, v)) : 0;
  return list[Math.floor(r * list.length)];
}

/**
 * 结算一次奇遇：返回**新的**效果状态与声明式结果。
 *
 * 纯函数：不改入参、不写盘、不碰 DOM。调用方负责执行 outcome 的副作用。
 * 未识别的 type / effect 一律返回原状态 + null（不抛错、不静默改数据）。
 */
export function applyEffect(
  type: string,
  state: EncounterEffectsState,
  ctx: EffectContext = {},
): { state: EncounterEffectsState; outcome: EffectOutcome | null } {
  const now = Number.isFinite(Number(ctx.now)) ? Number(ctx.now) : Date.now();
  const rand = typeof ctx.rand === 'function' ? ctx.rand : Math.random;
  const base: EncounterEffectsState = { ...(state || {}) };
  const day = ctx.dayKey || localDayKey(now);

  switch (type) {
    case 'qi_rain': {
      const amount = randInt(QI_RAIN_MIN, QI_RAIN_MAX, rand);
      return { state: base, outcome: { kind: 'spirit', amount } };
    }

    case 'cave': {
      // 已在生效 → 续期（叠在剩余之上），与聚灵阵的续期语义一致
      const prevUntil = base.caveUntil ? Date.parse(base.caveUntil) : NaN;
      const from = Number.isFinite(prevUntil) && prevUntil > now ? prevUntil : now;
      const until = new Date(from + 3600 * 1000).toISOString();
      return { state: { ...base, caveUntil: until }, outcome: { kind: 'cave', until } };
    }

    case 'old_master': {
      const word = pickWord(ctx.words, rand);
      if (!word) return { state: base, outcome: null };
      return { state: { ...base, focusWord: word, focusDay: day }, outcome: { kind: 'focus', word } };
    }

    case 'scroll': {
      const word = pickWord(ctx.words, rand);
      if (!word) return { state: base, outcome: null };
      return { state: base, outcome: { kind: 'book', word } };
    }

    case 'beast': {
      // 已有灵兽 → 不重复认主（只认一只），但仍给出结果文案
      if (beastActive(base)) {
        return { state: base, outcome: { kind: 'beast', name: base.beast!.name } };
      }
      const name = beastName(rand);
      return {
        state: { ...base, beast: { name, since: new Date(now).toISOString() } },
        outcome: { kind: 'beast', name },
      };
    }

    case 'demon_raid':
      return { state: base, outcome: { kind: 'demon_review' } };

    default:
      return { state: base, outcome: null };
  }
}

/** 灵兽名（种子化列表；与 demons.beastNameFrom 的命名风格一致但不重复依赖） */
export const BEAST_NAMES: readonly string[] = [
  '青丘小狐', '玄水灵龟', '白泽幼兽', '九尾雪貂', '赤炎雀', '墨鳞蛟',
  '云梦鹿', '琥珀猫', '风隼', '雷纹貂',
];

export function beastName(rand: () => number = Math.random): string {
  const v = Number(rand());
  const r = Number.isFinite(v) ? Math.min(0.9999999, Math.max(0, v)) : 0;
  return BEAST_NAMES[Math.floor(r * BEAST_NAMES.length)];
}

/* ───────────────── 便捷入口（读 → 算 → 写） ───────────────── */

/**
 * 完整结算一次奇遇：读状态 → 纯转移 → 写回。
 * @returns outcome（null 表示该奇遇无可结算效果）
 *
 * 注意命名：`encounters.ts` 已有一个 `resolveEncounter(id)`（把记录标记为已结算，
 * 是 DB 写入）；本函数是**应用效果**（改增益状态）。两者职责不同，
 * 故这里用 `applyEncounterEffect` 避免同名混淆。
 */
export function applyEncounterEffect(
  type: string,
  ctx: EffectContext = {},
  storage?: StorageLike | null,
): EffectOutcome | null {
  const prev = loadEffects(storage);
  const { state, outcome } = applyEffect(type, prev, ctx);
  if (outcome) saveEffects(state, storage);
  return outcome;
}
