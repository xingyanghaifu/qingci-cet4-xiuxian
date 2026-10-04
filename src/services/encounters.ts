/**
 * 奇遇事件（修炼生态 · 阶段 B）
 *
 * 6 个事件按概率随机触发，每日上限 2 次；**不打断学习**（R4）：
 * settle() 只做「掷骰 + 落仓 + 通知」，效果由玩家主动点击通知后结算。
 *
 * 日期口径（R13）：日限一律用 `localDateKey()`（本地时区），不用 UTC。
 * 事件记录带 `day` 字段（encounters 仓已建 day 索引），便于「今日奇遇」查询。
 */
import { storeOf, promisify, type MinimalFactory } from './idb';

export type EncounterType = 'old_master' | 'scroll' | 'beast' | 'demon_raid' | 'cave' | 'qi_rain';

export interface Encounter {
  id: string;
  type: EncounterType;
  /** 本地日 key（localDateKey），用于日限与查询 */
  day: string;
  triggeredAt: string;
  expiresAt: string;
  resolved: boolean;
  payload: Record<string, unknown>;
}

export interface EncounterDef {
  type: EncounterType;
  /** 触发概率 0–1 */
  probability: number;
  /** 事件有效期（毫秒） */
  durationMs: number;
  /** 效果标识（文案与结算路由共用） */
  effect: string;
  title: string;
  desc: string;
}

/** 事件池（调参只改这张表，不动逻辑） */
export const ENCOUNTER_POOL: readonly EncounterDef[] = [
  { type: 'qi_rain', probability: 0.06, durationMs: 24 * 3600 * 1000, effect: 'spirit_grant', title: '灵石雨', desc: '天降灵石雨，拾得一袋。' },
  { type: 'demon_raid', probability: 0.08, durationMs: 24 * 3600 * 1000, effect: 'demon_review', title: '心魔来袭', desc: '心魔上门问战，答对可得奖赏。' },
  { type: 'old_master', probability: 0.05, durationMs: 24 * 3600 * 1000, effect: 'word_focus', title: '遇老道指点', desc: '老道点拨一词，今日过目不忘。' },
  { type: 'scroll', probability: 0.03, durationMs: 7 * 24 * 3600 * 1000, effect: 'book_unlock', title: '拾得残卷', desc: '残卷上书，悟得一处词根。' },
  { type: 'cave', probability: 0.04, durationMs: 3600 * 1000, effect: 'focus_boost', title: '洞天福地', desc: '洞天灵气充盈，一时辰内效率大增。' },
  { type: 'beast', probability: 0.02, durationMs: 30 * 24 * 3600 * 1000, effect: 'beast_unlock', title: '灵兽来投', desc: '一只灵兽认主，随你修行。' },
];

/** 每日触发上限 */
export const ENCOUNTER_DAILY_LIMIT = 2;

/** 本地日 key（与模板 dayKey 同口径：本地时区） */
export function localDateKey(now: number = Date.now()): string {
  const d = new Date(now);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function encounterDef(type: string): EncounterDef | null {
  return ENCOUNTER_POOL.find((e) => e.type === type) || null;
}

/** 线性同余伪随机（种子化，测试可复现；用 seed 决定触发位置） */
export function seededUnit(seed: number): number {
  const s = (Math.abs(Math.round(seed)) % 2147483647) || 1;
  return (s / 2147483647);
}

/**
 * 掷骰：日限已达 → null；否则按权重表抽一个事件（未命中任何区间也返回 null）。
 * @param seed 随机种子（一般传 Date.now()）
 * @param todayCount 当日已触发次数
 */
export function rollEncounter(seed: number, todayCount: number, limit: number = ENCOUNTER_DAILY_LIMIT): EncounterType | null {
  if (todayCount >= limit) return null;
  const r = seededUnit(seed);
  let acc = 0;
  for (const def of ENCOUNTER_POOL) {
    acc += def.probability;
    if (r < acc) return def.type;
  }
  return null; // 未落入任何区间（约 72%）→ 本次无奇遇
}

/* ───────────────── 持久化 ───────────────── */

async function encStore(mode: 'readonly' | 'readwrite', factory?: MinimalFactory | null) {
  return storeOf('encounters', mode, factory);
}

export async function recordEncounter(e: Encounter, factory?: MinimalFactory | null): Promise<boolean> {
  try {
    const store = await encStore('readwrite', factory);
    if (!store) return false;
    await promisify(store.put(e));
    return true;
  } catch {
    return false;
  }
}

function normalizeEncounter(row: unknown): Encounter | null {
  const e = row as Encounter | null;
  if (!e || typeof e !== 'object' || !e.type) return null;
  return {
    id: String(e.id),
    type: e.type,
    day: String(e.day || localDateKey(Date.parse(String(e.triggeredAt)) || Date.now())),
    triggeredAt: String(e.triggeredAt || ''),
    expiresAt: String(e.expiresAt || ''),
    resolved: !!e.resolved,
    payload: (e.payload && typeof e.payload === 'object' ? e.payload : {}) as Record<string, unknown>,
  };
}

/** 当日奇遇（新→旧） */
export async function listTodayEncounters(day: string = localDateKey(), factory?: MinimalFactory | null): Promise<Encounter[]> {
  try {
    const store = await encStore('readonly', factory);
    if (!store) return [];
    const rows = await promisify<Encounter[]>(store.getAll());
    return (Array.isArray(rows) ? rows : [])
      .map(normalizeEncounter)
      .filter((e): e is Encounter => !!e && e.day === day)
      .sort((a, b) => String(b.triggeredAt).localeCompare(String(a.triggeredAt)));
  } catch {
    return [];
  }
}

/** 当日已触发次数（日限判定） */
export async function countToday(day: string = localDateKey(), factory?: MinimalFactory | null): Promise<number> {
  const list = await listTodayEncounters(day, factory);
  return list.length;
}

/** 标记已结算 */
export async function resolveEncounter(id: string, factory?: MinimalFactory | null): Promise<boolean> {
  try {
    const store = await encStore('readwrite', factory);
    if (!store) return false;
    const row = await promisify<Encounter | undefined>(store.get(id));
    const e = normalizeEncounter(row);
    if (!e) return false;
    await promisify(store.put({ ...e, resolved: true }));
    return true;
  } catch {
    return false;
  }
}

/** 未结算且未过期的奇遇（通知条数据源） */
export async function listPendingEncounters(now: number = Date.now(), factory?: MinimalFactory | null): Promise<Encounter[]> {
  const list = await listTodayEncounters(localDateKey(now), factory);
  const ts = String(new Date(now).toISOString());
  return list.filter((e) => !e.resolved && (!e.expiresAt || e.expiresAt >= ts));
}

/** 构造一条奇遇记录（便于测试与统一生成） */
export function makeEncounter(type: EncounterType, now: number = Date.now(), payload: Record<string, unknown> = {}): Encounter | null {
  const def = encounterDef(type);
  if (!def) return null;
  return {
    id: `enc-${now}-${type}`,
    type,
    day: localDateKey(now),
    triggeredAt: new Date(now).toISOString(),
    expiresAt: new Date(now + def.durationMs).toISOString(),
    resolved: false,
    payload: { effect: def.effect, ...payload },
  };
}