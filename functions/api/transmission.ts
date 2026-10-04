/**
 * POST /api/transmission —— 传功（Cloudflare Pages Function + D1）
 *
 * action：create / claim / list
 *
 * **服务端强制的隐私与越权防护**：
 *   · 只中继「词」本身，不接收熟练度、不接收答题明细、不接收分数；
 *   · 每词全局只传一次（`word` 唯一约束 + 先查后插）；
 *   · claim 只能由 `to_id` 本人操作（越权返回 403）；
 *   · 响应不回他人 memberId（只回 `isMe` 布尔）。
 *
 * 未绑定 D1 时返回 503（前端走本机模式）。
 *
 * TODO-D1: 前端开关 `D1_MULTIPLAYER_ENABLED` 置 true 且端点部署后启用跨用户传功。
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

export interface TransmissionEnv {
  DB?: D1Database;
  FEEDBACK_SALT?: string;
}

const BOOST_DAYS = 7;
const DAY_MS = 86400000;
const MAX_WORD_LEN = 64;

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

/** 词汇规范化（只允许字母/连字符/空格/撇号，长度受限） */
export function normalizeWord(raw: unknown): string {
  const w = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!w || w.length > MAX_WORD_LEN) return '';
  if (!/^[a-z][a-z'\- ]*$/.test(w)) return '';
  return w;
}

export async function onRequestPost(context: { request: Request; env: TransmissionEnv }): Promise<Response> {
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
      message: '传功服务未配置（未绑定 D1），当前为本机模式',
    }, 503);
  }

  const action = String(body.action || '');
  const memberId = String(body.memberId || '').trim();
  if (!memberId) return json({ status: 'invalid', message: '缺少 memberId' }, 400);

  if (action === 'create') {
    const toId = String(body.toId || '').trim();
    const word = normalizeWord(body.word);
    if (!toId) return json({ status: 'invalid', message: '缺少 toId' }, 400);
    if (!word) return json({ status: 'invalid', message: '词汇不合法' }, 400);
    try {
      // 每词只能传一次
      const exists = await env.DB.prepare('SELECT id FROM transmissions WHERE word = ?1').bind(word).first<{ id: string }>();
      if (exists) return json({ status: 'conflict', message: '该词已传过功', reason: 'already_transmitted' }, 409);
      const id = `tx:${word}`;
      await env.DB.prepare(
        `INSERT INTO transmissions (id, from_id, to_id, word, created_at, claimed, boost_until)
         VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6)`,
      ).bind(id, memberId, toId, word, new Date().toISOString(), new Date(Date.now() + BOOST_DAYS * DAY_MS).toISOString()).run();
      // 隐私：不回 toId 原文
      return json({ status: 'ok', message: '传功已成', data: { id, word, boostDays: BOOST_DAYS } }, 200);
    } catch {
      return json({ status: 'error', message: '传功失败' }, 500);
    }
  }

  if (action === 'claim') {
    const id = String(body.id || '').trim();
    if (!id) return json({ status: 'invalid', message: '缺少 id' }, 400);
    try {
      const row = await env.DB.prepare('SELECT id, to_id, claimed FROM transmissions WHERE id = ?1')
        .bind(id).first<Record<string, unknown>>();
      if (!row) return json({ status: 'not_found', message: '传功记录不存在' }, 404);
      if (String(row.to_id) !== memberId) return json({ status: 'forbidden', message: '只能领取传给你的功法' }, 403);
      if (!Number(row.claimed)) {
        await env.DB.prepare('UPDATE transmissions SET claimed = 1 WHERE id = ?1').bind(id).run();
      }
      return json({ status: 'ok', message: '已领取' }, 200);
    } catch {
      return json({ status: 'error', message: '领取失败' }, 500);
    }
  }

  if (action === 'list') {
    try {
      const rows = await env.DB.prepare(
        'SELECT id, from_id, to_id, word, created_at, claimed, boost_until FROM transmissions WHERE to_id = ?1 OR from_id = ?1 ORDER BY created_at DESC LIMIT 50',
      ).bind(memberId).all<Record<string, unknown>>();
      // 隐私：只回「是否与我相关」，不回对方 memberId
      const list = (rows.results || []).map((r) => ({
        id: r.id,
        word: r.word,
        mine: String(r.from_id) === memberId ? 'sent' : 'received',
        claimed: !!Number(r.claimed),
        createdAt: r.created_at,
        boostUntil: r.boost_until,
      }));
      return json({ status: 'ok', message: 'ok', data: { list } }, 200);
    } catch {
      return json({ status: 'error', message: '查询失败' }, 500);
    }
  }

  return json({ status: 'invalid', message: '未知 action' }, 400);
}