/**
 * POST /api/duel —— 论剑（Cloudflare Pages Function + D1）
 *
 * 单个端点用 `action` 区分：create / score / get（与 /api/group 同款风格）。
 *
 * **服务端强制的隐私与越权防护**：
 *   · 不接收、不返回任何题目内容与答题明细——只收 correct（正确数）与 timeMs（用时）；
 *   · 提交成绩必须带 `memberId`，且只能提交**自己那一侧**（side 与 challengerId 必须匹配）；
 *   · 查询他人对局时不返回对手 memberId，只回 `isMe` 与匿名昵称；
 *   · 正确数夹紧 0..10、用时夹紧 0..10 分钟，拒绝伪造异常值。
 *
 * 未绑定 D1 时返回 503（前端提示本机模式），不影响学习功能。
 *
 * TODO-D1: 前端开关 `D1_MULTIPLAYER_ENABLED`（src/config/features.ts，当前 false）
 *          置 true 且本端点部署后，本机模式自动切换为跨用户模式。
 */

interface D1Result<T = unknown> {
  results?: T[];
  meta?: Record<string, unknown>;
  success?: boolean;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

export interface DuelEnv {
  DB?: D1Database;
  FEEDBACK_SALT?: string;
}

const MAX_QUESTIONS = 10;
const MAX_TIME_MS = 10 * 60 * 1000;

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

/** 正确数夹紧（服务端不信任客户端数值） */
export function clampCorrect(value: unknown): number {
  const n = Math.round(Number(value) || 0);
  return Math.max(0, Math.min(MAX_QUESTIONS, n));
}

/** 用时夹紧 */
export function clampTime(value: unknown): number {
  const n = Math.round(Number(value) || 0);
  return Math.max(0, Math.min(MAX_TIME_MS, n));
}

/** 判定（与前端 duel.judgeDuel 同规则：正确数优先，其次用时） */
export function judgeDuelServer(a: { correct: number; timeMs: number }, b: { correct: number; timeMs: number }): 'a' | 'b' | 'tie' {
  if (a.correct !== b.correct) return a.correct > b.correct ? 'a' : 'b';
  if (a.timeMs !== b.timeMs) return a.timeMs < b.timeMs ? 'a' : 'b';
  return 'tie';
}

export async function onRequestPost(context: { request: Request; env: DuelEnv }): Promise<Response> {
  const { request, env } = context;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ status: 'invalid', message: '请求体必须是 JSON' }, 400);
  }

  if (!env.DB) {
    return json({
      status: 'unavailable',
      message: '论剑服务未配置（未绑定 D1），当前为本机模式',
    }, 503);
  }

  const action = String(body.action || '');
  const memberId = String(body.memberId || '').trim();
  if (!memberId) return json({ status: 'invalid', message: '缺少 memberId' }, 400);

  if (action === 'create') {
    const duelId = String(body.duelId || '').trim();
    const opponentId = String(body.opponentId || '').trim();
    if (!duelId || !opponentId) return json({ status: 'invalid', message: '缺少 duelId 或 opponentId' }, 400);
    try {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO duels (id, challenger_id, opponent_id, challenger_correct, challenger_time_ms, status, started_at)
         VALUES (?1, ?2, ?3, 0, 0, 'pending', ?4)`,
      ).bind(duelId, memberId, opponentId, new Date().toISOString()).run();
      return json({ status: 'ok', message: '论剑已发起', data: { duelId } }, 200);
    } catch {
      return json({ status: 'error', message: '创建失败' }, 500);
    }
  }

  if (action === 'score') {
    const duelId = String(body.duelId || '').trim();
    const side = body.side === 'opponent' ? 'opponent' : 'challenger';
    if (!duelId) return json({ status: 'invalid', message: '缺少 duelId' }, 400);
    try {
      const row = await env.DB.prepare(
        'SELECT id, challenger_id, opponent_id, challenger_correct, challenger_time_ms, opponent_correct, opponent_time_ms, status FROM duels WHERE id = ?1',
      ).bind(duelId).first<Record<string, unknown>>();
      if (!row) return json({ status: 'not_found', message: '对局不存在' }, 404);

      // 越权防护：只能提交自己那一侧
      const owner = side === 'challenger' ? String(row.challenger_id) : String(row.opponent_id);
      if (owner !== memberId) return json({ status: 'forbidden', message: '不能代他人提交成绩' }, 403);

      const correct = clampCorrect(body.correct);
      const timeMs = clampTime(body.timeMs);
      const col = side === 'challenger' ? 'challenger' : 'opponent';
      await env.DB.prepare(
        `UPDATE duels SET ${col}_correct = ?1, ${col}_time_ms = ?2, updated_at = ?3 WHERE id = ?4`,
      ).bind(correct, timeMs, new Date().toISOString(), duelId).run();

      // 缺陷修复：`row` 是 UPDATE 之前的快照——当前提交的这一侧必须改用新值，
      // 否则后提交方的成绩永远读不到旧快照里的 0，先提交方恒判胜。
      // 与 joint-demon.ts 同款写法：新提交侧用新值，另一侧用库中值。
      const a = side === 'challenger'
        ? { correct, timeMs }
        : { correct: Number(row.challenger_correct) || 0, timeMs: Number(row.challenger_time_ms) || 0 };
      const b = side === 'opponent'
        ? { correct, timeMs }
        : { correct: Number(row.opponent_correct) || 0, timeMs: Number(row.opponent_time_ms) || 0 };
      // 只有双方都提交才判定（任一侧提交时，另一侧取库中已提交值，两个提交顺序都覆盖）
      const challengerDone = side === 'challenger'
        || Number(row.challenger_time_ms) > 0
        || Number(row.challenger_correct) > 0;
      const opponentDone = side === 'opponent'
        || Number(row.opponent_time_ms) > 0
        || Number(row.opponent_correct) > 0;
      const outcome = challengerDone && opponentDone ? judgeDuelServer(a, b) : null;
      if (outcome) {
        await env.DB.prepare('UPDATE duels SET status = ?1, finished_at = ?2 WHERE id = ?3')
          .bind('completed', new Date().toISOString(), duelId).run();
      }
      return json({ status: 'ok', message: '成绩已记录', data: { outcome } }, 200);
    } catch {
      return json({ status: 'error', message: '提交失败' }, 500);
    }
  }

  if (action === 'get') {
    const duelId = String(body.duelId || '').trim();
    if (!duelId) return json({ status: 'invalid', message: '缺少 duelId' }, 400);
    try {
      const row = await env.DB.prepare(
        'SELECT id, challenger_id, opponent_id, status, started_at, finished_at FROM duels WHERE id = ?1',
      ).bind(duelId).first<Record<string, unknown>>();
      if (!row) return json({ status: 'not_found', message: '对局不存在' }, 404);
      const isChallenger = String(row.challenger_id) === memberId;
      const isOpponent = String(row.opponent_id) === memberId;
      if (!isChallenger && !isOpponent) return json({ status: 'forbidden', message: '无权查看该对局' }, 403);
      // 隐私：不回他人 memberId，也不回分数（分数仅在双方各自结算时本地展示）
      return json({
        status: 'ok',
        message: 'ok',
        data: { duelId: row.id, status: row.status, isMe: isChallenger ? 'challenger' : 'opponent', startedAt: row.started_at, finishedAt: row.finished_at },
      }, 200);
    } catch {
      return json({ status: 'error', message: '查询失败' }, 500);
    }
  }

  return json({ status: 'invalid', message: '未知 action' }, 400);
}