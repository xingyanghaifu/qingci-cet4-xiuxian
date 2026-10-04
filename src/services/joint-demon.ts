/**
 * 联手斩魔（道友互动 · 阶段 D）
 *
 * 双方各取 5 只心魔的题（不足 5 只有多少取多少，总数可 < 10）；
 * 各自作答后合计正确率 ≥ 80% → 双方各 +80 灵石；失败无奖励但双方各降 1 级心魔。
 *
 * 隐私：只交换正确数与用时；题目只取自**本机**心魔（对方心魔不上传）。
 */
import { storeOf, promisify, type MinimalFactory } from './idb';
import { earnSpirit } from './economy';
import { listDemons, upsertDemon } from './demons';
import type { DuelScore } from './duel';

export interface JointDemonRecord {
  id: string;
  initiatorId: string;
  partnerId: string;
  questionIds: string[];
  initiatorScore: DuelScore;
  partnerScore: DuelScore | null;
  totalCorrectRate: number;
  passed: boolean;
  status: 'pending' | 'initiator_done' | 'completed';
  startedAt: string;
  finishedAt: string | null;
}

export const JOINT_DEMON_EACH = 5;
export const JOINT_DEMON_PASS_RATE = 0.8;
export const JOINT_DEMON_REWARD = 80;

/** 合计正确率判定：rate = (a + b) / total，≥ 0.8 通过 */
export function judgeJoint(a: number, b: number, total: number): { passed: boolean; rate: number } {
  const t = Math.max(1, Math.round(Number(total) || 0));
  const sum = Math.max(0, Number(a) || 0) + Math.max(0, Number(b) || 0);
  const rate = Math.min(1, sum / t);
  return { passed: rate >= JOINT_DEMON_PASS_RATE, rate: Math.round(rate * 1000) / 1000 };
}

/** 取本机心魔题（对方心魔在对方设备上，不上传） */
export async function pickJointQuestions(factory?: MinimalFactory | null, each = JOINT_DEMON_EACH): Promise<string[]> {
  const demons = await listDemons({}, factory);
  return demons.slice(0, Math.max(0, each)).map((d) => String(d.questionId));
}

function normalize(row: unknown): JointDemonRecord | null {
  const r = row as JointDemonRecord | null;
  if (!r || typeof r !== 'object' || !r.id) return null;
  return {
    id: String(r.id),
    initiatorId: String(r.initiatorId || 'me'),
    partnerId: String(r.partnerId || ''),
    questionIds: Array.isArray(r.questionIds) ? r.questionIds.map(String) : [],
    initiatorScore: { correct: Number(r.initiatorScore && r.initiatorScore.correct) || 0, timeMs: Number(r.initiatorScore && r.initiatorScore.timeMs) || 0 },
    partnerScore: r.partnerScore ? { correct: Number(r.partnerScore.correct) || 0, timeMs: Number(r.partnerScore.timeMs) || 0 } : null,
    totalCorrectRate: Number(r.totalCorrectRate) || 0,
    passed: !!r.passed,
    status: (['pending', 'initiator_done', 'completed'] as const).includes(r.status as never) ? r.status : 'pending',
    startedAt: String(r.startedAt || ''),
    finishedAt: r.finishedAt ? String(r.finishedAt) : null,
  };
}

export async function createJointDemon(
  partnerId: string,
  factory?: MinimalFactory | null,
  seed: number = Date.now(),
  each = JOINT_DEMON_EACH,
): Promise<JointDemonRecord> {
  const mine = await pickJointQuestions(factory, each);
  // 双方各取 5 只 → 本机侧题量按 each 计；总数不足也允许（验收 12）
  const rec: JointDemonRecord = {
    id: `joint:${Math.abs(Math.floor(seed))}`,
    initiatorId: 'me',
    partnerId: String(partnerId || ''),
    questionIds: mine,
    initiatorScore: { correct: 0, timeMs: 0 },
    partnerScore: null,
    totalCorrectRate: 0,
    passed: false,
    status: 'pending',
    startedAt: new Date(seed).toISOString(),
    finishedAt: null,
  };
  try {
    const store = await storeOf('duels', 'readwrite', factory);
    if (store) await promisify(store.put(rec));
  } catch { /* 静默 */ }
  return rec;
}

/** 总题量口径：双方题量之和（不足时按实际） */
export function jointTotal(record: JointDemonRecord, each = JOINT_DEMON_EACH): number {
  return Math.max(1, record.questionIds.length + Math.min(each, record.questionIds.length));
}

export async function recordJointScore(
  id: string,
  side: 'initiator' | 'partner',
  score: DuelScore,
  factory?: MinimalFactory | null,
  each = JOINT_DEMON_EACH,
): Promise<{ ok: boolean; reason?: string; record?: JointDemonRecord }> {
  try {
    const store = await storeOf('duels', 'readwrite', factory);
    if (!store) return { ok: false, reason: 'unavailable' };
    const cur = normalize(await promisify<JointDemonRecord | undefined>(store.get(id)));
    if (!cur) return { ok: false, reason: 'not_found' };
    const clean: DuelScore = { correct: Math.max(0, Number(score.correct) || 0), timeMs: Math.max(0, Number(score.timeMs) || 0) };
    const next: JointDemonRecord = side === 'initiator'
      ? { ...cur, initiatorScore: clean, status: 'initiator_done' }
      : { ...cur, partnerScore: clean, status: 'completed' };
    if (next.partnerScore) {
      const total = jointTotal(next, each);
      const j = judgeJoint(next.initiatorScore.correct, next.partnerScore.correct, total);
      next.totalCorrectRate = j.rate;
      next.passed = j.passed;
      next.status = 'completed';
      next.finishedAt = new Date().toISOString();
    }
    await promisify(store.put(next));
    return { ok: true, record: next };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

/** 结算：成功双方各 +80；失败无奖励但双方各降 1 级心魔 */
export async function settleJointDemon(
  record: JointDemonRecord,
  state: { spirit?: number },
  factory?: MinimalFactory | null,
): Promise<{ reward: number; lowered: number }> {
  if (record.passed) {
    earnSpirit(state, JOINT_DEMON_REWARD, 'joint_demon_win', factory);
    return { reward: JOINT_DEMON_REWARD, lowered: 0 };
  }
  let lowered = 0;
  for (const qid of record.questionIds) {
    try {
      await upsertDemon(qid, -1, factory);
      lowered++;
    } catch { /* 单只失败不影响其余 */ }
  }
  return { reward: 0, lowered };
}

export async function listJointDemons(factory?: MinimalFactory | null): Promise<JointDemonRecord[]> {
  try {
    const store = await storeOf('duels', 'readonly', factory);
    if (!store) return [];
    const rows = (await promisify<JointDemonRecord[]>(store.getAll())) || [];
    return (rows.map(normalize).filter(Boolean) as JointDemonRecord[])
      .filter((r) => r.id.startsWith('joint:'))
      .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
  } catch {
    return [];
  }
}