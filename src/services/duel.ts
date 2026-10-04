/**
 * 论剑（道友互动 · 阶段 D）
 *
 * local-first（R6）：判定与记录全部本地完成；D1 端点本轮只写骨架，
 * 由 `D1_MULTIPLAYER_ENABLED` 一行开关接入。无后端时降级为「本机演示模式」，
 * 状态词汇沿用 group.ts（ok / unavailable / not_found / invalid）。
 *
 * 隐私：只交换正确数与用时（DuelScore），不含题目内容、不含他人身份。
 */
import { storeOf, promisify, type MinimalFactory } from './idb';
import { earnSpirit } from './economy';

export interface DuelScore {
  correct: number;
  timeMs: number;
}

export interface DuelRecord {
  id: string;
  challengerId: string;
  opponentId: string;
  questionIds: string[];
  challengerScore: DuelScore;
  opponentScore: DuelScore | null;
  winnerId: string | null;
  status: 'pending' | 'challenger_done' | 'completed' | 'expired';
  startedAt: string;
  finishedAt: string | null;
}

export const DUEL_QUESTIONS = 10;
export const DUEL_TIME_PER_Q = 30_000;
export const DUEL_WIN_REWARD = 50;
export const DUEL_TIE_REWARD = 20;

/** 判定：正确数优先，其次用时短者胜，完全相同为平局 */
export function judgeDuel(a: DuelScore, b: DuelScore): 'a' | 'b' | 'tie' {
  const ac = Math.max(0, Number(a && a.correct) || 0);
  const bc = Math.max(0, Number(b && b.correct) || 0);
  if (ac !== bc) return ac > bc ? 'a' : 'b';
  const at = Math.max(0, Number(a && a.timeMs) || 0);
  const bt = Math.max(0, Number(b && b.timeMs) || 0);
  if (at !== bt) return at < bt ? 'a' : 'b';
  return 'tie';
}

/** 本机演示模式的对手成绩（确定性；仅本地，不联网） */
export function simulateOpponentScore(seed: number, total = DUEL_QUESTIONS): DuelScore {
  const s = Math.abs(Math.floor(Number(seed) || 0));
  const correct = Math.max(0, Math.min(total, 5 + (s % (total - 4))));
  const timeMs = total * DUEL_TIME_PER_Q * (0.4 + ((s % 50) / 100));
  return { correct, timeMs: Math.round(timeMs) };
}

function newId(prefix: string, seed: number): string {
  return `${prefix}:${Math.abs(Math.floor(seed || Date.now()))}`;
}

function normalize(row: unknown): DuelRecord | null {
  const r = row as DuelRecord | null;
  if (!r || typeof r !== 'object' || !r.id) return null;
  return {
    id: String(r.id),
    challengerId: String(r.challengerId || 'me'),
    opponentId: String(r.opponentId || ''),
    questionIds: Array.isArray(r.questionIds) ? r.questionIds.map(String) : [],
    challengerScore: { correct: Number(r.challengerScore && r.challengerScore.correct) || 0, timeMs: Number(r.challengerScore && r.challengerScore.timeMs) || 0 },
    opponentScore: r.opponentScore
      ? { correct: Number(r.opponentScore.correct) || 0, timeMs: Number(r.opponentScore.timeMs) || 0 }
      : null,
    winnerId: r.winnerId ? String(r.winnerId) : null,
    status: (['pending', 'challenger_done', 'completed', 'expired'] as const).includes(r.status as never) ? r.status : 'pending',
    startedAt: String(r.startedAt || ''),
    finishedAt: r.finishedAt ? String(r.finishedAt) : null,
  };
}

export async function createDuel(
  opponentId: string,
  questionIds: string[],
  seed: number = Date.now(),
  factory?: MinimalFactory | null,
  challengerId = 'me',
): Promise<DuelRecord> {
  const duel: DuelRecord = {
    id: newId('duel', seed),
    challengerId,
    opponentId: String(opponentId || ''),
    questionIds: (questionIds || []).slice(0, DUEL_QUESTIONS).map(String),
    challengerScore: { correct: 0, timeMs: 0 },
    opponentScore: null,
    winnerId: null,
    status: 'pending',
    startedAt: new Date(seed).toISOString(),
    finishedAt: null,
  };
  try {
    const store = await storeOf('duels', 'readwrite', factory);
    if (store) await promisify(store.put(duel));
  } catch { /* 写失败不阻塞本地流程 */ }
  return duel;
}

/** 记录一方成绩并结算（本地模式：对手成绩由 simulateOpponentScore 提供） */
export async function recordDuelScore(
  duelId: string,
  side: 'challenger' | 'opponent',
  score: DuelScore,
  factory?: MinimalFactory | null,
): Promise<{ ok: boolean; reason?: string; record?: DuelRecord; outcome?: 'a' | 'b' | 'tie' }> {
  try {
    const store = await storeOf('duels', 'readwrite', factory);
    if (!store) return { ok: false, reason: 'unavailable' };
    const cur = normalize(await promisify<DuelRecord | undefined>(store.get(duelId)));
    if (!cur) return { ok: false, reason: 'not_found' };
    const clean: DuelScore = { correct: Math.max(0, Number(score.correct) || 0), timeMs: Math.max(0, Number(score.timeMs) || 0) };
    const next: DuelRecord = side === 'challenger'
      ? { ...cur, challengerScore: clean, status: cur.opponentScore ? 'completed' : 'challenger_done' }
      : { ...cur, opponentScore: clean, status: 'completed' };
    let outcome: 'a' | 'b' | 'tie' | undefined;
    if (next.opponentScore) {
      outcome = judgeDuel(next.challengerScore, next.opponentScore);
      next.winnerId = outcome === 'a' ? next.challengerId : outcome === 'b' ? next.opponentId : null;
      next.status = 'completed';
      next.finishedAt = new Date().toISOString();
    }
    await promisify(store.put(next));
    return { ok: true, record: next, outcome };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

/** 结算奖励（由 UI 在结果页调用；幂等靠 finishedAt + 一次性调用点） */
export function duelReward(state: { spirit?: number }, outcome: 'a' | 'b' | 'tie', factory?: MinimalFactory | null): number {
  if (outcome === 'tie') { earnSpirit(state, DUEL_TIE_REWARD, 'duel_tie', factory); return DUEL_TIE_REWARD; }
  if (outcome === 'a') { earnSpirit(state, DUEL_WIN_REWARD, 'duel_win', factory); return DUEL_WIN_REWARD; }
  return 0;   // 败者不扣灵石、也无奖励
}

export async function listDuels(filter?: { status?: string }, factory?: MinimalFactory | null): Promise<DuelRecord[]> {
  try {
    const store = await storeOf('duels', 'readonly', factory);
    if (!store) return [];
    const rows = (await promisify<DuelRecord[]>(store.getAll())) || [];
    const list = rows.map(normalize).filter(Boolean) as DuelRecord[];
    // 共仓卫生：duels 仓同时存放 joint:*（联手斩魔）记录，列表只回本模块的 duel:* 记录
    // （与 listJointDemons 的 joint:* 前缀过滤对齐，避免幽灵对局混入）
    const mine = list.filter((d) => d.id.startsWith('duel:'));
    const filtered = filter && filter.status ? mine.filter((d) => d.status === filter.status) : mine;
    return filtered.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  } catch {
    return [];
  }
}

/** 演武场 buff：胜率加成（阶段 D 设施效果，作用于判定修正） */
export function applyDuelBonus(score: DuelScore, winBonus: number): DuelScore {
  const bonus = Math.max(0, Number(winBonus) || 0);
  if (!bonus) return score;
  return { ...score, correct: score.correct + Math.round(score.correct * bonus) };
}