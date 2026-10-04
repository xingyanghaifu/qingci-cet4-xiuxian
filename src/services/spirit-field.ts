/**
 * 灵田（修炼生态 · 阶段 C）
 *
 * 作物按「累积学习天数」成长（R5）：不新建计数器——成长值由 `settle()` 挂钩把
 * `state.days` 的新增日推进为浇水；同一天只浇一次（localDateKey 去重，R13 本地日口径）。
 *
 * 断签规则：超过 1 天未学习 → 未成熟作物 `wateredDays` 减半并标记枯萎；
 * 已成熟未收获的不枯萎（已成熟即稳定）。恢复学习后继续累积，收获时清除枯萎标记。
 *
 * 灵泉加成（cave.decorations 含 spring_water）：`effectiveMatureDays = floor(matureDays * 0.9)`
 * ——是「所需天数更少」，不是「时间流逝更快」；对已种植未成熟的作物同样生效（阈值口径统一）。
 */
import { storeOf, promisify, type MinimalFactory } from './idb';

export type CropType = 'qi_grass' | 'memory_flower' | 'enlighten_tree';

export interface Plot {
  /** 'plot:0' … 'plot:8' */
  id: string;
  plotIndex: number;
  cropType: CropType;
  plantedAt: string;
  /** 预期成熟时间（仅参考展示，不作为判定依据——判定按 wateredDays） */
  maturesAt: string;
  /** 累积学习天数（核心成长值） */
  wateredDays: number;
  withered: boolean;
  harvestedAt?: string;
}

export interface SpiritFieldState {
  /** 9 格，未种植为 null */
  plots: Array<Plot | null>;
  hasSpringWater: boolean;
}

export interface CropDef {
  name: string;
  matureDays: number;
  reward: { type: 'spirit' | 'item'; amount?: number; itemId?: string };
}

export const PLOT_COUNT = 9;

/** 作物表（调参只改这张表） */
export const CROPS: Record<CropType, CropDef> = {
  qi_grass: { name: '灵石草', matureDays: 7, reward: { type: 'spirit', amount: 50 } },
  memory_flower: { name: '记忆花', matureDays: 14, reward: { type: 'item', amount: 1, itemId: 'talisman' } },
  enlighten_tree: { name: '悟道树', matureDays: 30, reward: { type: 'item', amount: 1, itemId: 'book' } },
};

/** 本地日 key（与模板 dayKey / encounters 同一口径，R13） */
export function fieldDayKey(now: number = Date.now()): string {
  const d = new Date(now);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** 灵泉加成后的成熟阈值（floor(matureDays * 0.9)） */
export function effectiveMatureDays(cropType: CropType, hasSpringWater: boolean): number {
  const base = (CROPS[cropType] || CROPS.qi_grass).matureDays;
  return hasSpringWater ? Math.floor(base * 0.9) : base;
}

export function isMature(plot: Plot, hasSpringWater: boolean): boolean {
  if (!plot) return false;
  return (Number(plot.wateredDays) || 0) >= effectiveMatureDays(plot.cropType, hasSpringWater);
}

function plotId(index: number): string {
  return `plot:${index}`;
}

function emptyField(): SpiritFieldState {
  return { plots: new Array(PLOT_COUNT).fill(null), hasSpringWater: false };
}

function normalizePlot(row: unknown, index: number): Plot | null {
  const p = row as Plot | null;
  if (!p || typeof p !== 'object' || !p.cropType || !CROPS[p.cropType]) return null;
  return {
    id: plotId(index),
    plotIndex: index,
    cropType: p.cropType,
    plantedAt: String(p.plantedAt || ''),
    maturesAt: String(p.maturesAt || ''),
    wateredDays: Math.max(0, Math.round(Number(p.wateredDays) || 0)),
    withered: !!p.withered,
    harvestedAt: p.harvestedAt ? String(p.harvestedAt) : undefined,
  };
}

async function fieldStore(mode: 'readonly' | 'readwrite', factory?: MinimalFactory | null) {
  return storeOf('spiritField', mode, factory);
}

/** 灵泉是否已购（读 cave 仓的 decorations；不可用时按 false 降级） */
async function readSpringWater(factory?: MinimalFactory | null): Promise<boolean> {
  try {
    const cave = await storeOf('cave', 'readonly', factory);
    const row = await promisify<{ decorations?: string[] } | undefined>(cave.get('main'));
    return !!(row && Array.isArray(row.decorations) && row.decorations.includes('spring_water'));
  } catch {
    return false;
  }
}

export async function loadField(factory?: MinimalFactory | null): Promise<SpiritFieldState> {
  const base = emptyField();
  try {
    const [store, spring] = await Promise.all([fieldStore('readonly', factory), readSpringWater(factory)]);
    if (!store) return { ...base, hasSpringWater: spring };
    for (let i = 0; i < PLOT_COUNT; i++) {
      base.plots[i] = normalizePlot(await promisify<Plot | undefined>(store.get(plotId(i))), i);
    }
    base.hasSpringWater = spring;
    return base;
  } catch {
    return { ...base, hasSpringWater: false };
  }
}

/** 种植（免费；格子必须为空） */
export async function plantSeed(
  plotIndex: number,
  cropType: CropType,
  factory?: MinimalFactory | null,
  now: number = Date.now(),
): Promise<{ ok: boolean; reason?: string }> {
  if (!Number.isInteger(plotIndex) || plotIndex < 0 || plotIndex >= PLOT_COUNT) return { ok: false, reason: 'bad-plot' };
  if (!CROPS[cropType]) return { ok: false, reason: 'bad-crop' };
  try {
    const store = await fieldStore('readwrite', factory);
    if (!store) return { ok: false, reason: 'unavailable' };
    const existing = await promisify<Plot | undefined>(store.get(plotId(plotIndex)));
    if (existing) return { ok: false, reason: 'occupied' };
    const days = CROPS[cropType].matureDays;
    const plot: Plot = {
      id: plotId(plotIndex),
      plotIndex,
      cropType,
      plantedAt: new Date(now).toISOString(),
      maturesAt: new Date(now + days * 86400000).toISOString(),
      wateredDays: 0,
      withered: false,
    };
    await promisify(store.put(plot, plot.id));
    return { ok: true };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

/**
 * 浇水（由 settle() 挂钩调用）：每天首次调用让所有未成熟作物 wateredDays +1。
 * dayKey 去重由调用方传入 lastWaterDay（同一天只浇一次）。
 */
export async function waterField(
  lastWaterDay: string,
  factory?: MinimalFactory | null,
  now: number = Date.now(),
): Promise<{ watered: number; day: string }> {
  const day = fieldDayKey(now);
  if (lastWaterDay === day) return { watered: 0, day };
  try {
    const store = await fieldStore('readwrite', factory);
    if (!store) return { watered: 0, day };
    const spring = await readSpringWater(factory);
    let watered = 0;
    for (let i = 0; i < PLOT_COUNT; i++) {
      const p = normalizePlot(await promisify<Plot | undefined>(store.get(plotId(i))), i);
      if (!p) continue;
      if (isMature(p, spring)) continue;      // 已成熟不再累加
      const next: Plot = { ...p, wateredDays: p.wateredDays + 1 };
      await promisify(store.put(next, next.id));
      watered++;
    }
    return { watered, day };
  } catch {
    return { watered: 0, day };
  }
}

/** 收获：成熟才可收；返回奖励描述（由调用方发奖，仓只负责清格） */
export async function harvest(
  plotIndex: number,
  factory?: MinimalFactory | null,
): Promise<{ ok: boolean; reason?: string; reward?: CropDef['reward']; cropType?: CropType }> {
  if (!Number.isInteger(plotIndex) || plotIndex < 0 || plotIndex >= PLOT_COUNT) return { ok: false, reason: 'bad-plot' };
  try {
    const store = await fieldStore('readwrite', factory);
    if (!store) return { ok: false, reason: 'unavailable' };
    const p = normalizePlot(await promisify<Plot | undefined>(store.get(plotId(plotIndex))), plotIndex);
    if (!p) return { ok: false, reason: 'empty' };
    const spring = await readSpringWater(factory);
    if (!isMature(p, spring)) return { ok: false, reason: 'not-mature' };
    await promisify(store.delete(plotId(plotIndex)));
    return { ok: true, reward: CROPS[p.cropType].reward, cropType: p.cropType };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

/** 断签惩罚：未成熟作物 wateredDays 减半 + withered；已成熟不动 */
export async function applyWitherPenalty(factory?: MinimalFactory | null): Promise<{ withered: number }> {
  try {
    const store = await fieldStore('readwrite', factory);
    if (!store) return { withered: 0 };
    const spring = await readSpringWater(factory);
    let withered = 0;
    for (let i = 0; i < PLOT_COUNT; i++) {
      const p = normalizePlot(await promisify<Plot | undefined>(store.get(plotId(i))), i);
      if (!p) continue;
      if (isMature(p, spring)) continue;      // 已成熟不枯萎
      const next: Plot = { ...p, wateredDays: Math.floor(p.wateredDays / 2), withered: true };
      await promisify(store.put(next, next.id));
      withered++;
    }
    return { withered };
  } catch {
    return { withered: 0 };
  }
}

/**
 * 断签判定（R13 本地日）：lastStudyDay 与今天相差 >1 天 → 断签。
 * @returns 'none' | 'today' | 'yesterday' | 'broken'
 */
export function streakState(lastStudyDay: string | null | undefined, now: number = Date.now()): 'none' | 'today' | 'yesterday' | 'broken' {
  if (!lastStudyDay) return 'none';
  const today = new Date(now);
  const yday = new Date(now - 86400000);
  const k = (d: Date) => fieldDayKey(d.getTime());
  if (lastStudyDay === k(today)) return 'today';
  if (lastStudyDay === k(yday)) return 'yesterday';
  return 'broken';
}