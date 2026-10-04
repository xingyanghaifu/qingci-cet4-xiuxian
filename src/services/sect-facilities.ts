/**
 * 道场建设（道友互动 · 阶段 D）
 *
 * 单记录（sect 仓 id='main'）。捐献走 `spendSpirit`（扣个人灵石 → 加设施 progress）；
 * `progress >= cost` 时设施激活（level=1），buff 由 `getFacilityBuffs` 统一导出，
 * 各模块按需读取（藏经阁 / 炼丹房 / 演武场）。
 *
 * 隐私：只记录匿名 memberId 与捐献额，不含身份与答题数据。
 */
import { storeOf, promisify, type MinimalFactory } from './idb';
import { spendSpirit } from './economy';

export type FacilityId = 'scripture_hall' | 'alchemy_room' | 'arena';

export interface SectFacility {
  id: FacilityId;
  name: string;
  cost: number;
  progress: number;
  level: number;
  activatedAt: string | null;
}

export interface SectState {
  id: 'main';
  name: string;
  facilities: SectFacility[];
  totalContributed: number;
  members: string[];
}

export const FACILITY_DEFS: ReadonlyArray<{ id: FacilityId; name: string; cost: number; desc: string }> = [
  { id: 'scripture_hall', name: '藏经阁', cost: 1000, desc: '全道场成员词库详情解锁速度 +20%。' },
  { id: 'alchemy_room', name: '炼丹房', cost: 1500, desc: '全道场成员每月获得 1 张护道符。' },
  { id: 'arena', name: '演武场', cost: 2000, desc: '全道场成员论剑胜率加成 +5%。' },
];

export const SECT_DONATE_PRESETS = [50, 100, 200, 500] as const;

export function facilityDef(id: string) {
  return FACILITY_DEFS.find((f) => f.id === id) || null;
}

function emptySect(): SectState {
  return {
    id: 'main',
    name: '青词道场',
    facilities: FACILITY_DEFS.map((f) => ({ id: f.id, name: f.name, cost: f.cost, progress: 0, level: 0, activatedAt: null })),
    totalContributed: 0,
    members: [],
  };
}

function normalize(row: unknown): SectState {
  const base = emptySect();
  const r = row as SectState | null;
  if (!r || typeof r !== 'object') return base;
  const byId = new Map((Array.isArray(r.facilities) ? r.facilities : []).map((f) => [f && f.id, f]));
  base.facilities = base.facilities.map((def) => {
    const got = byId.get(def.id) as SectFacility | undefined;
    if (!got) return def;
    const progress = Math.max(0, Math.round(Number(got.progress) || 0));
    return {
      ...def,
      progress,
      level: progress >= def.cost ? Math.max(1, Math.round(Number(got.level) || 1)) : 0,
      activatedAt: got.activatedAt ? String(got.activatedAt) : null,
    };
  });
  base.totalContributed = Math.max(0, Math.round(Number(r.totalContributed) || 0));
  base.members = Array.isArray(r.members) ? r.members.map(String) : [];
  if (typeof r.name === 'string' && r.name.trim()) base.name = r.name.trim().slice(0, 16);
  return base;
}

async function sectStore(mode: 'readonly' | 'readwrite', factory?: MinimalFactory | null) {
  return storeOf('sect', mode, factory);
}

export async function loadSect(factory?: MinimalFactory | null): Promise<SectState> {
  try {
    const store = await sectStore('readonly', factory);
    if (!store) return emptySect();
    return normalize(await promisify<SectState | undefined>(store.get('main')));
  } catch {
    return emptySect();
  }
}

export async function saveSect(sect: SectState, factory?: MinimalFactory | null): Promise<boolean> {
  try {
    const store = await sectStore('readwrite', factory);
    if (!store) return false;
    await promisify(store.put(sect));
    return true;
  } catch {
    return false;
  }
}

/** 捐献：扣个人灵石 → 加设施 progress；灵石不足则不扣不加 */
export async function donate(
  facilityId: string,
  amount: number,
  state: { spirit?: number },
  factory?: MinimalFactory | null,
  memberId = 'me',
): Promise<{ ok: boolean; reason?: string; facility?: SectFacility }> {
  const def = facilityDef(facilityId);
  if (!def) return { ok: false, reason: 'unknown-facility' };
  const amt = Math.round(Number(amount) || 0);
  if (amt <= 0) return { ok: false, reason: 'bad-amount' };
  const paid = spendSpirit(state, amt, 'sect_donate', factory);
  if (!paid.ok) return { ok: false, reason: 'no-funds' };
  try {
    const sect = await loadSect(factory);
    const fac = sect.facilities.find((f) => f.id === def.id);
    if (!fac) return { ok: false, reason: 'unknown-facility' };
    fac.progress = Math.min(def.cost, fac.progress + amt);
    if (fac.progress >= def.cost && fac.level < 1) {
      fac.level = 1;
      fac.activatedAt = new Date().toISOString();
    }
    sect.totalContributed += amt;
    if (!sect.members.includes(memberId)) sect.members.push(memberId);
    const saved = await saveSect(sect, factory);
    if (!saved) return { ok: false, reason: 'unavailable', facility: fac };
    return { ok: true, facility: fac };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

/** 设施激活检查（读时自愈：progress 达标但 level/activatedAt 未置时补正）
 *  注意不能用 `level < 1` 做条件——normalize() 读取时已把达标的 level 归正为 1，
 *  旧条件永远为 false（死分支），导致 activatedAt 补不上；改为按 activatedAt 判定。 */
export async function checkFacilityActivation(facilityId: string, factory?: MinimalFactory | null): Promise<SectFacility | null> {
  const sect = await loadSect(factory);
  const fac = sect.facilities.find((f) => f.id === facilityId);
  if (!fac) return null;
  if (fac.progress >= fac.cost && !fac.activatedAt) {
    fac.level = 1;
    fac.activatedAt = new Date().toISOString();
    await saveSect(sect, factory);
  }
  return fac;
}

/** 全道场共享 buff（未建成的设施贡献 0） */
export function getFacilityBuffs(facilities: SectFacility[]): {
  detailUnlockBonus: number;
  monthlyTalisman: number;
  duelWinBonus: number;
} {
  const active = (id: FacilityId) => {
    const f = (facilities || []).find((x) => x && x.id === id);
    return !!f && f.level >= 1;
  };
  return {
    detailUnlockBonus: active('scripture_hall') ? 0.2 : 0,
    monthlyTalisman: active('alchemy_room') ? 1 : 0,
    duelWinBonus: active('arena') ? 0.05 : 0,
  };
}

/** UI 用：设施进度百分比 */
export function facilityPercent(fac: SectFacility): number {
  if (!fac || !fac.cost) return 0;
  return Math.min(100, Math.round((fac.progress / fac.cost) * 100));
}