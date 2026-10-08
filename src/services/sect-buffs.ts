/**
 * 道场设施增益结算（阶段 D 补全）
 *
 * ── 为什么需要这个模块 ──
 * `sect-facilities.ts` 定义了 3 个设施、每个都带**面向用户的明确承诺**，
 * `getFacilityBuffs()` 也把它们算出来了（`detailUnlockBonus` / `monthlyTalisman`
 * / `duelWinBonus`），并且 `QingciServices.sect.buffs` 已导出、`tests/sect.test.mjs`
 * 也断言了数值。
 *
 * 但**模板从未调用 `getFacilityBuffs()`**（全模板 grep 0 次）：
 *
 *   藏经阁  '全道场成员词库详情解锁速度 +20%。'   ← 从未生效
 *   炼丹房  '全道场成员每月获得 1 张护道符。'     ← 从未发放
 *   演武场  '全道场成员论剑胜率加成 +5%。'        ← 从未应用
 *
 * 即：玩家花 1000/1500/2000 灵石建成设施后，**承诺的增益一个都不生效**。
 * 这与「5/6 空头支票奇遇」「listPending 无人调用」是同一类缺陷
 * （服务层写了、测了、导出了，模板没有消费点）—— 本项目第四次出现。
 *
 * ── 设计 ──
 *   · **纯函数**：全部是 `(输入) → 输出` 的纯计算，不碰 DOM、不碰 storage；
 *     副作用（发道具、改分）由调用方执行 → 可完整单测；
 *   · **可注入 now**：月度发放的判定依赖「当前月」，注入以便测试确定性；
 *   · **幂等**：月度护道符按 `YYYY-MM` 记账，同月重复调用只发一次；
 *   · **不制造焦虑**：只做**加法/折扣**，不扣任何既有资产；设施未建成时全部为 0，
 *     与旧行为完全一致（既有调用点零影响）。
 *
 * ── 三条红线（沿用既有约定）──
 *   1. 增益纯加法：折扣只降「参悟古籍」价格，不改其它道具、不退已付灵石；
 *   2. 倍率有上限：论剑加成固定 +5%（来自设施表，不随做题量增长）；
 *   3. 不侵入学习：论剑加成只作用于**本机对手模拟分**的判定，
 *      **SM-2 / SRS 语义一字未改**。
 */

/** 详情解锁折扣：作用于「参悟古籍」价格（与 sect-facilities 的 0.2 对应） */
export const DETAIL_DISCOUNT = 0.2;
/** 月度护道符张数 */
export const MONTHLY_TALISMAN = 1;

/**
 * 本地月份 key（`YYYY-MM`，本地时区 —— 与 encounters 的 localDateKey 同口径）。
 *
 * 为什么用本地时区：用户感知的「这个月」是自己的日历月，
 * 用 UTC 会让东八区用户在每月 1 号早上 8 点前被算进上个月。
 */
export function monthKeyOf(now: number = Date.now()): string {
  const d = new Date(now);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/**
 * 参悟古籍的实付价：应用藏经阁折扣（四舍五入，且**不低于 1**）。
 * 未建成（bonus=0）时原价返回 —— 保证既有行为一字不变。
 */
export function discountedBookPrice(basePrice: number, detailUnlockBonus: number): number {
  const base = Math.max(0, Math.round(Number(basePrice) || 0));
  const bonus = Number.isFinite(Number(detailUnlockBonus)) ? Math.max(0, Number(detailUnlockBonus)) : 0;
  if (!base || !bonus) return base;
  return Math.max(1, Math.round(base * (1 - Math.min(0.9, bonus))));
}

/**
 * 本月是否该发护道符。
 *
 * 幂等依据：`lastClaimedMonth`（上次发放的 `YYYY-MM`）。
 *   · 从未发放（空）→ 发
 *   · 与本月相同   → 不发（同月只发一次）
 *   · 与本月不同   → 发（跨月）
 * 设施未建成（monthlyTalisman<=0）→ 永远不发。
 */
export function shouldGrantMonthlyTalisman(
  monthlyTalisman: number,
  lastClaimedMonth: string | null | undefined,
  now: number = Date.now(),
): boolean {
  const amount = Math.max(0, Math.floor(Number(monthlyTalisman) || 0));
  if (amount <= 0) return false;
  const cur = monthKeyOf(now);
  return String(lastClaimedMonth || '') !== cur;
}

/** 月度发放的张数（未建成 / 同月已领 → 0） */
export function monthlyTalismanAmount(
  monthlyTalisman: number,
  lastClaimedMonth: string | null | undefined,
  now: number = Date.now(),
): number {
  if (!shouldGrantMonthlyTalisman(monthlyTalisman, lastClaimedMonth, now)) return 0;
  return Math.max(0, Math.floor(Number(monthlyTalisman) || 0));
}

/**
 * 论剑判定：把演武场加成应用到**我方**分数上。
 *
 * 复用 `duel.applyDuelBonus` 的语义（correct += round(correct * bonus)），
 * 这里独立实现是为了让本模块不 import 业务模块（与 cultivation-curve 同约定），
 * 且便于单测；两处算法一致，若日后调整需同步。
 *
 * @param correct 我方答对数
 * @param duelWinBonus 演武场加成（0 或 0.05）
 */
export function applyArenaBonus(correct: number, duelWinBonus: number): number {
  const c = Math.max(0, Math.round(Number(correct) || 0));
  const bonus = Number.isFinite(Number(duelWinBonus)) ? Math.max(0, Number(duelWinBonus)) : 0;
  if (!bonus) return c;
  return c + Math.round(c * bonus);
}

/** 设施增益的可读摘要（洞府/道场展示用；未建成返回空数组） */
export function buffSummary(buffs: {
  detailUnlockBonus?: number;
  monthlyTalisman?: number;
  duelWinBonus?: number;
} | null | undefined): string[] {
  if (!buffs) return [];
  const out: string[] = [];
  const d = Number(buffs.detailUnlockBonus) || 0;
  const m = Number(buffs.monthlyTalisman) || 0;
  const w = Number(buffs.duelWinBonus) || 0;
  if (d > 0) out.push(`藏经阁 · 参悟古籍 -${Math.round(d * 100)}%`);
  if (m > 0) out.push(`炼丹房 · 每月 +${m} 张护道符`);
  if (w > 0) out.push(`演武场 · 论剑加成 +${Math.round(w * 100)}%`);
  return out;
}

/* ───────────────── 存储（月度发放记账，独立键） ───────────────── */

/** 独立存储键：只记「上次发放护道符的月份」，不动学习存档 */
export const SECT_BUFF_KEY = 'qingci.sectBuffs';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SectBuffState {
  lastTalismanMonth?: string;
}

function resolveStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage;
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadSectBuffs(storage?: StorageLike | null): SectBuffState {
  const store = resolveStorage(storage);
  if (!store) return {};
  try {
    const raw = store.getItem(SECT_BUFF_KEY);
    if (!raw) return {};
    const p = JSON.parse(raw) as Partial<SectBuffState>;
    const out: SectBuffState = {};
    if (typeof p.lastTalismanMonth === 'string' && p.lastTalismanMonth) {
      out.lastTalismanMonth = p.lastTalismanMonth;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveSectBuffs(state: SectBuffState, storage?: StorageLike | null): SectBuffState {
  const normalized: SectBuffState = {};
  if (state && state.lastTalismanMonth) normalized.lastTalismanMonth = String(state.lastTalismanMonth);
  const store = resolveStorage(storage);
  if (store) {
    try {
      store.setItem(SECT_BUFF_KEY, JSON.stringify(normalized));
    } catch {
      /* 隐私模式等场景忽略 */
    }
  }
  return normalized;
}

/**
 * 读→判→记：本月该发护道符则返回张数并记账，否则返回 0。
 * 副作用（真的写库存）由调用方执行 —— 本函数只负责「判定 + 记账」。
 */
export function claimMonthlyTalisman(
  monthlyTalisman: number,
  now: number = Date.now(),
  storage?: StorageLike | null,
): number {
  const prev = loadSectBuffs(storage);
  const amount = monthlyTalismanAmount(monthlyTalisman, prev.lastTalismanMonth, now);
  if (amount <= 0) return 0;
  saveSectBuffs({ ...prev, lastTalismanMonth: monthKeyOf(now) }, storage);
  return amount;
}
