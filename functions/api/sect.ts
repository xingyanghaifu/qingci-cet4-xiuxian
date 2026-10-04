/**
 * POST /api/sect —— 道场建设（Cloudflare Pages Function + D1）
 *
 * action：donate / get
 *
 * **服务端强制的隐私与越权防护**：
 *   · 捐献额度与设施进度以**服务端累计**为准，不信任客户端传的 progress；
 *   · 只记录匿名 memberId 与数额，不接收任何答题数据、不接收个人分数；
 *   · 响应只回道场聚合数据（设施进度、总捐献），成员列表只回**数量**不回 ID；
 *   · 数额夹紧 1..10000，拒绝负数与异常大额。
 *
 * 未绑定 D1 时返回 503（前端走本机模式）。
 *
 * TODO-D1: 前端开关 `D1_MULTIPLAYER_ENABLED` 置 true 且端点部署后启用跨用户道场。
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

export interface SectEnv {
  DB?: D1Database;
  FEEDBACK_SALT?: string;
}

const FACILITIES = [
  { id: 'scripture_hall', name: '藏经阁', cost: 1000 },
  { id: 'alchemy_room', name: '炼丹房', cost: 1500 },
  { id: 'arena', name: '演武场', cost: 2000 },
] as const;

const MAX_DONATE = 10000;

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

/** 捐献数额夹紧 */
export function clampDonate(value: unknown): number {
  const n = Math.round(Number(value) || 0);
  return Math.max(1, Math.min(MAX_DONATE, n));
}

export function facilityOf(id: string) {
  return FACILITIES.find((f) => f.id === id) || null;
}

/** 设施状态推导（progress >= cost 即激活） */
export function facilityView(progress: number, cost: number, activatedAt: string | null) {
  const p = Math.max(0, Math.round(Number(progress) || 0));
  return { progress: Math.min(p, cost), cost, level: p >= cost ? 1 : 0, activatedAt: p >= cost ? activatedAt : null };
}

export async function onRequestPost(context: { request: Request; env: SectEnv }): Promise<Response> {
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
      message: '道场服务未配置（未绑定 D1），当前为本机模式',
    }, 503);
  }

  const action = String(body.action || '');
  const memberId = String(body.memberId || '').trim();
  if (!memberId) return json({ status: 'invalid', message: '缺少 memberId' }, 400);

  if (action === 'donate') {
    const facilityId = String(body.facilityId || '').trim();
    const def = facilityOf(facilityId);
    if (!def) return json({ status: 'invalid', message: '未知设施' }, 400);
    const amount = clampDonate(body.amount);
    try {
      const now = new Date().toISOString();
      // 服务端累计（不信任客户端 progress）
      await env.DB.prepare(
        `INSERT INTO sect_facilities (id, progress, activated_at) VALUES (?1, ?2, NULL)
         ON CONFLICT(id) DO UPDATE SET progress = progress + ?2`,
      ).bind(def.id, amount).run();
      const row = await env.DB.prepare('SELECT progress, activated_at FROM sect_facilities WHERE id = ?1')
        .bind(def.id).first<Record<string, unknown>>();
      const progress = Number(row?.progress) || 0;
      let activatedAt = row?.activated_at ? String(row.activated_at) : null;
      if (progress >= def.cost && !activatedAt) {
        await env.DB.prepare('UPDATE sect_facilities SET activated_at = ?1 WHERE id = ?2 AND activated_at IS NULL')
          .bind(now, def.id).run();
        activatedAt = now;
      }
      await env.DB.prepare(
        'INSERT INTO sect_donations (member_id, facility_id, amount, created_at) VALUES (?1, ?2, ?3, ?4)',
      ).bind(memberId, def.id, amount, now).run();
      return json({
        status: 'ok',
        message: '捐献已记入道场',
        data: { facilityId: def.id, ...facilityView(progress, def.cost, activatedAt) },
      }, 200);
    } catch {
      return json({ status: 'error', message: '捐献失败' }, 500);
    }
  }

  if (action === 'get') {
    try {
      const rows = await env.DB.prepare('SELECT id, progress, activated_at FROM sect_facilities').all<Record<string, unknown>>();
      const byId = new Map((rows.results || []).map((r) => [String(r.id), r]));
      const facilities = FACILITIES.map((f) => {
        const got = byId.get(f.id);
        const view = facilityView(Number(got?.progress) || 0, f.cost, got?.activated_at ? String(got.activated_at) : null);
        return { id: f.id, name: f.name, ...view };
      });
      const total = facilities.reduce((s, f) => s + f.progress, 0);
      const memberRow = await env.DB.prepare('SELECT COUNT(DISTINCT member_id) AS n FROM sect_donations').first<{ n: number }>();
      // 隐私：成员只回数量，不回 ID 列表
      return json({
        status: 'ok',
        message: 'ok',
        data: { facilities, totalContributed: total, memberCount: Number(memberRow?.n) || 0 },
      }, 200);
    } catch {
      return json({ status: 'error', message: '查询失败' }, 500);
    }
  }

  return json({ status: 'invalid', message: '未知 action' }, 400);
}