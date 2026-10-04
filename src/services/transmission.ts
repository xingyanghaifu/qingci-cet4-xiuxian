/**
 * 传功（道友互动 · 阶段 D）
 *
 * 规则：仅 `proficiency >= 4`（已掌握）的词可传；每个词**全局只传一次**
 * （transmissions 仓以 `tx:<word>` 为主键，天然去重，另按 word 索引查重兜底）。
 * 传功者 +30 灵石；接收方该词进入待复习队列，7 天内复习收益 ×1.5。
 *
 * 隐私：只交换「词」本身，不含掌握度、不含答题历史、不含身份。
 */
import { storeOf, promisify, type MinimalFactory } from './idb';
import { earnSpirit } from './economy';

export interface TransmissionRecord {
  id: string;
  fromId: string;
  toId: string;
  word: string;
  createdAt: string;
  claimed: boolean;
  boostActiveUntil: string;
}

export const TRANSMISSION_MIN_PROFICIENCY = 4;
export const TRANSMISSION_SENDER_REWARD = 30;
export const TRANSMISSION_BOOST_DAYS = 7;
export const TRANSMISSION_BOOST_MULTIPLIER = 1.5;
const DAY_MS = 86400000;

export function transmissionId(word: string): string {
  return `tx:${String(word || '').trim().toLowerCase()}`;
}

/** 传功资格：词非空 + 熟练度达标 */
export function canTransmit(word: string, proficiency: number): { ok: boolean; reason?: string } {
  const w = String(word || '').trim();
  if (!w) return { ok: false, reason: 'empty_word' };
  const p = Number(proficiency);
  if (!Number.isFinite(p) || p < TRANSMISSION_MIN_PROFICIENCY) return { ok: false, reason: 'not_mastered' };
  return { ok: true };
}

function normalize(row: unknown): TransmissionRecord | null {
  const r = row as TransmissionRecord | null;
  if (!r || typeof r !== 'object' || !r.word) return null;
  return {
    id: String(r.id || transmissionId(r.word)),
    fromId: String(r.fromId || 'me'),
    toId: String(r.toId || ''),
    word: String(r.word),
    createdAt: String(r.createdAt || ''),
    claimed: !!r.claimed,
    boostActiveUntil: String(r.boostActiveUntil || ''),
  };
}

export async function createTransmission(
  toId: string,
  word: string,
  proficiency: number,
  factory?: MinimalFactory | null,
  now: number = Date.now(),
  fromId = 'me',
): Promise<{ ok: boolean; reason?: string; record?: TransmissionRecord }> {
  const check = canTransmit(word, proficiency);
  if (!check.ok) return { ok: false, reason: check.reason };
  const w = String(word).trim();
  const id = transmissionId(w);
  try {
    const store = await storeOf('transmissions', 'readwrite', factory);
    if (!store) return { ok: false, reason: 'unavailable' };
    // 每词只能传一次（主键去重 + word 索引兜底）
    if (await promisify(store.get(id))) return { ok: false, reason: 'already_transmitted' };
    const rows = (await promisify<TransmissionRecord[]>(store.getAll())) || [];
    if (rows.some((r) => r && String(r.word).toLowerCase() === w.toLowerCase())) {
      return { ok: false, reason: 'already_transmitted' };
    }
    const record: TransmissionRecord = {
      id,
      fromId,
      toId: String(toId || ''),
      word: w,
      createdAt: new Date(now).toISOString(),
      claimed: false,
      boostActiveUntil: new Date(now + TRANSMISSION_BOOST_DAYS * DAY_MS).toISOString(),
    };
    await promisify(store.put(record));
    return { ok: true, record };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

/** 传功者奖励（一次性，由 UI 在创建成功后调用） */
export function transmissionReward(state: { spirit?: number }, factory?: MinimalFactory | null): number {
  earnSpirit(state, TRANSMISSION_SENDER_REWARD, 'transmission_sent', factory);
  return TRANSMISSION_SENDER_REWARD;
}

export async function claimTransmission(id: string, factory?: MinimalFactory | null): Promise<{ ok: boolean; reason?: string; record?: TransmissionRecord }> {
  try {
    const store = await storeOf('transmissions', 'readwrite', factory);
    if (!store) return { ok: false, reason: 'unavailable' };
    const cur = normalize(await promisify<TransmissionRecord | undefined>(store.get(id)));
    if (!cur) return { ok: false, reason: 'not_found' };
    if (cur.claimed) return { ok: true, record: cur };
    const next: TransmissionRecord = { ...cur, claimed: true };
    await promisify(store.put(next));
    return { ok: true, record: next };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

export async function listTransmissions(filter?: { fromId?: string; toId?: string }, factory?: MinimalFactory | null): Promise<TransmissionRecord[]> {
  try {
    const store = await storeOf('transmissions', 'readonly', factory);
    if (!store) return [];
    const rows = (await promisify<TransmissionRecord[]>(store.getAll())) || [];
    let list = rows.map(normalize).filter(Boolean) as TransmissionRecord[];
    if (filter && filter.fromId) list = list.filter((r) => r.fromId === filter.fromId);
    if (filter && filter.toId) list = list.filter((r) => r.toId === filter.toId);
    return list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  } catch {
    return [];
  }
}

/** 复习收益倍率：在 boost 窗口内为 1.5，否则 1 */
export function boostMultiplier(record: TransmissionRecord | null, now: number = Date.now()): number {
  if (!record || !record.boostActiveUntil) return 1;
  return now <= Date.parse(record.boostActiveUntil) ? TRANSMISSION_BOOST_MULTIPLIER : 1;
}