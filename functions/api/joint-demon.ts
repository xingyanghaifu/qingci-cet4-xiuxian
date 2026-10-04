/**
 * POST /api/joint-demon —— 联手斩魔（Cloudflare Pages Function + D1）
 *
 * action：create / score / get
 *
 * **服务端强制的隐私与越权防护**：
 *   · **不上传心魔题目内容**——只同步「这次联手存在」与各自正确数；
 *     题目各自在本地从自机心魔取（对方心魔永不出本机）；
 *   · 提交成绩只能提交自己那一侧（越权 403）；
 *   · 合计正确率由服务端按**双方各自题量**重算，不信任客户端传入的 rate；
 *   · 响应不回他人 memberId。
 *
 * 未绑定 D1 时返回 503（前端走本机模式）。
 *
 * TODO-D1: 前端开关 `D1_MULTIPLAYER_ENABLED` 置 true 且端点部署后启用跨用户联手。
 */

interface D1Result<T = unknown> {
  results?: T[];
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

export interface JointDemonEnv {
  DB?: D1Database;
  FEEDBACK_SALT?: string;
}

const EACH = 5;
const PASS_RATE = 0.8;
const MAX_CORRECT_PER_SIDE = EACH;

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

export function clampSideCorrect(value: unknown): number {
  const n = Math.round(Number(value) || 0);
  return Math.max(0, Math.min(MAX_CORRECT_PER_SIDE, n));
}

/** 合计判定（与前端 joint.judgeJoint 同规则） */
export function judgeJointServer(a: number, b: number, total: number): { passed: boolean; rate: number } {
  const t = Math.max(1, Math.round(total) || 1);
  const rate = Math.min(1, (Math.max(0, a) + Math.max(0, b)) / t);
  return { passed: rate >= PASS_RATE, rate: Math.round(rate * 1000) / 1000 };
}

export async function onRequestPost(context: { request: Request; env: JointDemonEnv }): Promise<Response> {
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
      message: '联手斩魔服务未配置（未绑定 D1），当前为本机模式',
    }, 503);
  }

  const action = String(body.action || '');
  const memberId = String(body.memberId || '').trim();
  if (!memberId) return json({ status: 'invalid', message: '缺少 memberId' }, 400);

  if (action === 'create') {
    const id = String(body.id || '').trim();
    const partnerId = String(body.partnerId || '').trim();
    if (!id || !partnerId) return json({ status: 'invalid', message: '缺少 id 或 partnerId' }, 400);
    try {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO joint_demons (id, initiator_id, partner_id, initiator_correct, partner_correct, status, started_at)
         VALUES (?1, ?2, ?3, 0, 0, 'pending', ?4)`,
      ).bind(id, memberId, partnerId, new Date().toISOString()).run();
      return json({ status: 'ok', message: '联手已发起', data: { id } }, 200);
    } catch {
      return json({ status: 'error', message: '创建失败' }, 500);
    }
  }

  if (action === 'score') {
    const id = String(body.id || '').trim();
    const side = body.side === 'partner' ? 'partner' : 'initiator';
    if (!id) return json({ status: 'invalid', message: '缺少 id' }, 400);
    try {
      const row = await env.DB.prepare(
        'SELECT id, initiator_id, partner_id, initiator_correct, partner_correct, status FROM joint_demons WHERE id = ?1',
      ).bind(id).first<Record<string, unknown>>();
      if (!row) return json({ status: 'not_found', message: '联手记录不存在' }, 404);

      const owner = side === 'initiator' ? String(row.initiator_id) : String(row.partner_id);
      if (owner !== memberId) return json({ status: 'forbidden', message: '不能代他人提交成绩' }, 403);

      const correct = clampSideCorrect(body.correct);
      const col = side === 'initiator' ? 'initiator' : 'partner';
      await env.DB.prepare(`UPDATE joint_demons SET ${col}_correct = ?1, updated_at = ?2 WHERE id = ?3`)
        .bind(correct, new Date().toISOString(), id).run();

      const a = side === 'initiator' ? correct : (Number(row.initiator_correct) || 0);
      const b = side === 'partner' ? correct : (Number(row.partner_correct) || 0);
      const done = side === 'partner' || Number(row.partner_correct) > 0;
      let outcome: { passed: boolean; rate: number } | null = null;
      if (done) {
        // 总题量口径：双方各 5 只（心魔不足时前端会少传，服务端按 2×EACH 封顶重算）
        outcome = judgeJointServer(a, b, EACH * 2);
        await env.DB.prepare('UPDATE joint_demons SET status = ?1, passed = ?2, finished_at = ?3 WHERE id = ?4')
          .bind('completed', outcome.passed ? 1 : 0, new Date().toISOString(), id).run();
      }
      return json({ status: 'ok', message: '成绩已记录', data: { outcome } }, 200);
    } catch {
      return json({ status: 'error', message: '提交失败' }, 500);
    }
  }

  if (action === 'get') {
    const id = String(body.id || '').trim();
    if (!id) return json({ status: 'invalid', message: '缺少 id' }, 400);
    try {
      const row = await env.DB.prepare('SELECT id, initiator_id, partner_id, status, started_at, finished_at FROM joint_demons WHERE id = ?1')
        .bind(id).first<Record<string, unknown>>();
      if (!row) return json({ status: 'not_found', message: '联手记录不存在' }, 404);
      const isInitiator = String(row.initiator_id) === memberId;
      const isPartner = String(row.partner_id) === memberId;
      if (!isInitiator && !isPartner) return json({ status: 'forbidden', message: '无权查看' }, 403);
      // 隐私：不回对方 memberId、不回分数
      return json({
        status: 'ok',
        message: 'ok',
        data: { id: row.id, status: row.status, isMe: isInitiator ? 'initiator' : 'partner', startedAt: row.started_at, finishedAt: row.finished_at },
      }, 200);
    } catch {
      return json({ status: 'error', message: '查询失败' }, 500);
    }
  }

  return json({ status: 'invalid', message: '未知 action' }, 400);
}