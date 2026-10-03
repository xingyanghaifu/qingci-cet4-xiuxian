/**
 * POST /api/group —— 道友小组（Cloudflare Pages Function + D1）
 *
 * 单个端点用 `action` 区分：create / join / sync / board / leave。
 *
 * **隐私由服务端强制**：
 *   · 昵称校验：拒绝含 @、长串数字、纯数字、网址的昵称（疑似邮箱/手机号/学号）；
 *   · 只接受聚合数据：realmIndex / progress（分档）/ studyDays —— 不接收任何逐题数据；
 *   · 榜单只回 nickname / realmIndex / realmName / progress / studyDays / isMe，
 *     **不含分数、不含他人 memberId**；
 *   · progress 入库前再次分档（5 的倍数），双端都分档，避免反推分数。
 *
 * 未绑定 D1 时返回 503（前端提示本机模式），不影响学习功能。
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

export interface GroupEnv {
  DB?: D1Database;
  FEEDBACK_SALT?: string;
}

const REALM_NAMES = ['练气', '筑基', '金丹', '元婴', '化神'];
const MAX_MEMBERS = 20;
const MAX_NICKNAME = 12;
const MAX_GROUP_NAME = 16;
const SYNC_MIN_INTERVAL_MS = 30_000;

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

const chars = (value: string): number => Array.from(value).length;

function clampText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return chars(trimmed) > max ? Array.from(trimmed).slice(0, max).join('') : trimmed;
}

/** 昵称校验（与前端 `validateNickname` 同规则） */
export function validateNickname(raw: unknown): { ok: boolean; value: string; error?: string } {
  const value = clampText(raw, MAX_NICKNAME * 2);
  if (!value) return { ok: false, value: '', error: '请填写昵称' };
  if (chars(value) > MAX_NICKNAME) return { ok: false, value, error: `昵称不超过 ${MAX_NICKNAME} 个字` };
  if (/@/.test(value)) return { ok: false, value, error: '昵称不能包含 @（请勿使用邮箱）' };
  if (/\d{6,}/.test(value)) return { ok: false, value, error: '昵称不能包含长串数字（请勿使用手机号/学号）' };
  if (/^[\d\s]+$/.test(value)) return { ok: false, value, error: '昵称不能只有数字' };
  if (/(?:https?:\/\/|www\.)/i.test(value)) return { ok: false, value, error: '昵称不能包含网址' };
  return { ok: true, value };
}

export function bucketProgress(progress: unknown): number {
  const n = Number(progress);
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.max(0, Math.min(100, n)) / 5) * 5;
}

export function normalizeCode(raw: unknown): string {
  return String(raw ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

/** 邀请码：排除易混字符（0/O/1/I） */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function generateCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return code;
}

export function weekKey(date = new Date()): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function monthKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** 榜单成员的安全视图（唯一对外的结构） */
interface MemberRow {
  nickname: string;
  realm_index: number;
  progress: number;
  study_days: number;
  member_id: string;
  updated_at: string;
}

export function toMemberView(row: MemberRow, memberId: string): {
  nickname: string; realmIndex: number; realmName: string; progress: number; studyDays: number; isMe: boolean;
} {
  const realmIndex = Math.max(0, Math.min(REALM_NAMES.length - 1, Number(row.realm_index) || 0));
  return {
    nickname: row.nickname,
    realmIndex,
    realmName: REALM_NAMES[realmIndex],
    progress: bucketProgress(row.progress),
    studyDays: Math.max(0, Number(row.study_days) || 0),
    isMe: row.member_id === memberId,
  };
}

/** 排序：境界 → 进度 → 学习天数（同分按昵称，保证稳定） */
export function rankMembers(rows: MemberRow[], memberId: string) {
  return rows
    .slice()
    .sort((a, b) => (Number(b.realm_index) - Number(a.realm_index))
      || (bucketProgress(b.progress) - bucketProgress(a.progress))
      || (Number(b.study_days) - Number(a.study_days))
      || String(a.nickname).localeCompare(String(b.nickname)))
    .map((row) => toMemberView(row, memberId));
}

export interface GroupActionBody {
  action?: string;
  code?: string;
  name?: string;
  nickname?: string;
  memberId?: string;
  realmIndex?: number;
  progress?: number;
  studyDays?: number;
  period?: string;
}

export async function onRequestPost(context: { request: Request; env: GroupEnv }): Promise<Response> {
  const { request, env } = context;
  let body: GroupActionBody;
  try {
    body = (await request.json()) as GroupActionBody;
  } catch {
    return json({ status: 'invalid', message: '请求体必须是 JSON' }, 400);
  }

  if (!env.DB) {
    return json({
      status: 'unavailable',
      message: '道友小组尚未配置（缺少 D1 绑定）：请按 db/schema.sql 建表并绑定 DB',
    }, 503);
  }

  const action = String(body.action || '');
  const memberId = clampText(body.memberId, 32);
  if (!memberId) return json({ status: 'invalid', message: '缺少 memberId' }, 400);

  const now = new Date();
  const nowIso = now.toISOString();

  try {
    if (action === 'create') {
      const nickname = validateNickname(body.nickname);
      if (!nickname.ok) return json({ status: 'invalid', message: nickname.error }, 400);
      const name = clampText(body.name, MAX_GROUP_NAME) || `${nickname.value}的道场`;

      let code = generateCode();
      for (let i = 0; i < 5; i++) {
        const existing = await env.DB.prepare('SELECT id FROM study_groups WHERE code = ?1').bind(code).first<{ id: number }>();
        if (!existing) break;
        code = generateCode();
      }

      const created = await env.DB.prepare(
        'INSERT INTO study_groups (code, name, created_at, member_count) VALUES (?1, ?2, ?3, 1)',
      ).bind(code, name, nowIso).run();
      const groupId = Number(created.meta?.last_row_id || 0);

      await env.DB.prepare(`INSERT INTO group_members
        (group_id, member_id, nickname, realm_index, progress, study_days, week_key, month_key, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`)
        .bind(
          groupId, memberId, nickname.value,
          Math.max(0, Math.min(4, Number(body.realmIndex) || 0)),
          bucketProgress(body.progress),
          Math.max(0, Number(body.studyDays) || 0),
          weekKey(now), monthKey(now), nowIso,
        ).run();

      const board = await loadBoard(env.DB, code, memberId);
      return json({ status: 'ok', message: '道场已开', data: board }, 200);
    }

    const code = normalizeCode(body.code);
    if (!/^[A-Z0-9]{6}$/.test(code)) return json({ status: 'invalid', message: '邀请码应为 6 位字母或数字' }, 400);

    const group = await env.DB.prepare('SELECT id, code, name, member_count FROM study_groups WHERE code = ?1')
      .bind(code).first<{ id: number; code: string; name: string; member_count: number }>();
    if (!group) return json({ status: 'not_found', message: '没有找到这个道场，请核对邀请码' }, 404);

    if (action === 'join' || action === 'sync') {
      const nickname = validateNickname(body.nickname);
      if (!nickname.ok) return json({ status: 'invalid', message: nickname.error }, 400);

      const existing = await env.DB.prepare('SELECT member_id, updated_at FROM group_members WHERE group_id = ?1 AND member_id = ?2')
        .bind(group.id, memberId).first<{ member_id: string; updated_at: string }>();

      if (!existing) {
        const countRow = await env.DB.prepare('SELECT COUNT(*) AS n FROM group_members WHERE group_id = ?1')
          .bind(group.id).first<{ n: number }>();
        if (Number(countRow?.n || 0) >= MAX_MEMBERS) {
          return json({ status: 'full', message: `道场已满（上限 ${MAX_MEMBERS} 人）` }, 409);
        }
      } else if (action === 'sync') {
        // 轻量限流：同一成员 30 秒内不重复写
        const last = new Date(existing.updated_at).getTime();
        if (Number.isFinite(last) && now.getTime() - last < SYNC_MIN_INTERVAL_MS) {
          const board = await loadBoard(env.DB, code, memberId);
          return json({ status: 'ok', message: '刚刚已同步', data: board }, 200);
        }
      }

      await env.DB.prepare(`INSERT INTO group_members
        (group_id, member_id, nickname, realm_index, progress, study_days, week_key, month_key, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        ON CONFLICT(group_id, member_id) DO UPDATE SET
          nickname = excluded.nickname,
          realm_index = excluded.realm_index,
          progress = excluded.progress,
          study_days = excluded.study_days,
          week_key = excluded.week_key,
          month_key = excluded.month_key,
          updated_at = excluded.updated_at`)
        .bind(
          group.id, memberId, nickname.value,
          Math.max(0, Math.min(4, Number(body.realmIndex) || 0)),
          bucketProgress(body.progress),
          Math.max(0, Number(body.studyDays) || 0),
          weekKey(now), monthKey(now), nowIso,
        ).run();

      const board = await loadBoard(env.DB, code, memberId);
      return json({ status: 'ok', message: existing ? '进度已同步' : '已入道场', data: board }, 200);
    }

    if (action === 'board') {
      const board = await loadBoard(env.DB, code, memberId, String(body.period) === 'month' ? 'month' : 'week');
      return json({ status: 'ok', message: 'ok', data: board }, 200);
    }

    if (action === 'leave') {
      await env.DB.prepare('DELETE FROM group_members WHERE group_id = ?1 AND member_id = ?2')
        .bind(group.id, memberId).run();
      return json({ status: 'ok', message: '已退出道场', data: { left: true } }, 200);
    }

    return json({ status: 'invalid', message: '未知的 action' }, 400);
  } catch (error) {
    return json({
      status: 'error',
      message: '小组服务出错：' + (error instanceof Error ? error.message : String(error)),
    }, 500);
  }
}

/** 读取并脱敏榜单（对外唯一出口） */
async function loadBoard(db: D1Database, code: string, memberId: string, period: 'week' | 'month' = 'week') {
  const group = await db.prepare('SELECT code, name FROM study_groups WHERE code = ?1')
    .bind(code).first<{ code: string; name: string }>();
  const rows = await db.prepare(`SELECT nickname, realm_index, progress, study_days, member_id, updated_at
    FROM group_members WHERE group_id = (SELECT id FROM study_groups WHERE code = ?1)`)
    .bind(code)
    .all<MemberRow>();
  const list = rows.results || [];
  return {
    code: group?.code || code,
    name: group?.name || '道场',
    period,
    members: rankMembers(list, memberId),
    total: list.length,
    updatedAt: new Date().toISOString(),
  };
}

export function onRequest(): Response {
  return json({ status: 'method_not_allowed', message: '请使用 POST' }, 405);
}

export function onRequestOptions(): Response {
  return new Response(null, { status: 204, headers: { allow: 'POST, OPTIONS', 'cache-control': 'no-store' } });
}

export const GROUP_LIMITS = { maxMembers: MAX_MEMBERS, maxNickname: MAX_NICKNAME, maxGroupName: MAX_GROUP_NAME, syncMinIntervalMs: SYNC_MIN_INTERVAL_MS };
