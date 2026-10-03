/**
 * POST /api/feedback —— 反馈收集（Cloudflare Pages Function + D1）
 *
 * 设计要点：
 *   1. **密钥零暴露**：D1 绑定只存在于服务端；前端提交的是纯文本 + 可选截图 data URL。
 *   2. **未配置时明确降级**：没有 DB 绑定时返回 503 与可读原因，前端据此提示「暂不可提交」，
 *      不会静默丢数据（前端会把内容留在本地队列里）。
 *   3. **限流与反垃圾**：同 IP 哈希每小时最多 5 条（查 D1，无需 KV）；表单里的
 *      `website` 是 honeypot，填了就当作成功但不入库。
 *   4. **隐私**：不存原始 IP，只存加盐 SHA-256 的前 16 位，用于限流；
 *      盐来自 `env.FEEDBACK_SALT`，未配置时退化为固定串（文档已注明建议配置）。
 *
 * 关联前端：`src/services/feedback.ts`（校验 + 离线队列 + 重试）
 */

interface D1Result<T = unknown> {
  results?: T[];
  success?: boolean;
  meta?: Record<string, unknown>;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  run(): Promise<D1Result>;
  all<T = unknown>(): Promise<D1Result<T>>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

export interface FeedbackEnv {
  DB?: D1Database;
  FEEDBACK_SALT?: string;
  APP_VERSION?: string;
}

const MAX_DESCRIPTION = 2000;
const MIN_DESCRIPTION = 5;
const MAX_CONTACT = 120;
const MAX_SCREENSHOT_BYTES = 512 * 1024;
const RATE_LIMIT_PER_HOUR = 5;
const KINDS = ['bug', 'suggestion', 'content', 'other'] as const;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  },
});

/** 截断到指定长度（多字节安全用 Array.from） */
function clampText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  const chars = Array.from(trimmed);
  return chars.length > max ? chars.slice(0, max).join('') : trimmed;
}

/** IP 哈希：加盐 SHA-256 前 16 位（不保存原始 IP） */
async function hashIp(ip: string, salt: string): Promise<string> {
  try {
    const data = new TextEncoder().encode(`${salt}:${ip}`);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
  } catch {
    return 'unknown';
  }
}

export interface ParsedFeedback {
  ok: boolean;
  errors: string[];
  spam: boolean;
  value: {
    kind: string;
    description: string;
    contact: string;
    screenshot: string;
    page: string;
    honeypot: string;
  };
}

/** 纯函数校验（前端与服务端共用同一套规则，避免只在一边拦截） */
export function parseFeedbackPayload(raw: unknown): ParsedFeedback {
  const errors: string[] = [];
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  const kind = KINDS.includes(input.kind as (typeof KINDS)[number]) ? String(input.kind) : 'other';
  if (input.kind && kind === 'other' && input.kind !== 'other') errors.push('未知的反馈类型');

  const description = clampText(input.description, MAX_DESCRIPTION);
  if (Array.from(description).length < MIN_DESCRIPTION) errors.push(`描述至少 ${MIN_DESCRIPTION} 个字`);
  if (typeof input.description === 'string' && Array.from(input.description.trim()).length > MAX_DESCRIPTION) {
    errors.push(`描述不能超过 ${MAX_DESCRIPTION} 个字（已截断）`);
  }

  const contact = clampText(input.contact, MAX_CONTACT);
  const page = clampText(input.page, 120);
  let screenshot = typeof input.screenshot === 'string' ? input.screenshot : '';
  if (screenshot && !/^data:image\/(png|jpeg|webp);base64,/.test(screenshot)) {
    errors.push('截图格式仅支持 PNG / JPEG / WebP');
    screenshot = '';
  }
  if (screenshot.length > MAX_SCREENSHOT_BYTES) {
    errors.push('截图过大（上限 512KB），已忽略该附件');
    screenshot = '';
  }
  const honeypot = clampText(input.website, 200);

  return {
    ok: errors.length === 0,
    errors,
    spam: honeypot.length > 0,
    value: { kind, description, contact, screenshot, page, honeypot },
  };
}

/** POST：接收反馈 */
export async function onRequestPost(context: { request: Request; env: FeedbackEnv }): Promise<Response> {
  const { request, env } = context;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ status: 'invalid', message: '请求体必须是 JSON' }, 400);
  }

  const parsed = parseFeedbackPayload(raw);
  // honeypot 命中：返回成功但不入库（不给机器人反馈信号）
  if (parsed.spam) return json({ status: 'ok', stored: false }, 202);
  if (!parsed.ok) return json({ status: 'invalid', message: parsed.errors[0], errors: parsed.errors }, 400);

  if (!env.DB) {
    return json({
      status: 'unavailable',
      message: '反馈服务尚未配置（缺少 D1 绑定）：请按 db/schema.sql 建库并绑定 DB',
    }, 503);
  }

  const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'local';
  const salt = env.FEEDBACK_SALT || 'qingci-feedback-default-salt';
  const ipHash = await hashIp(ip, salt);
  const now = new Date();
  const hourAgo = new Date(now.getTime() - 3600_000).toISOString();

  try {
    const recent = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM feedback WHERE ip_hash = ?1 AND created_at > ?2')
      .bind(ipHash, hourAgo)
      .first<{ n: number }>();
    if (recent && Number(recent.n) >= RATE_LIMIT_PER_HOUR) {
      return json({ status: 'rate_limited', message: `提交过于频繁（每小时最多 ${RATE_LIMIT_PER_HOUR} 条），请稍后再试` }, 429);
    }

    const result = await env.DB
      .prepare(`INSERT INTO feedback
        (created_at, kind, description, contact, screenshot, app_version, page, user_agent, ip_hash)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`)
      .bind(
        now.toISOString(),
        parsed.value.kind,
        parsed.value.description,
        parsed.value.contact || null,
        parsed.value.screenshot || null,
        clampText(env.APP_VERSION || (raw as Record<string, unknown>)?.appVersion, 32) || null,
        parsed.value.page || null,
        clampText(request.headers.get('user-agent'), 200) || null,
        ipHash,
      )
      .run();

    const id = (result.meta?.last_row_id as number | undefined) ?? undefined;
    return json({ status: 'ok', stored: true, id, at: now.toISOString() }, 201);
  } catch (error) {
    return json({
      status: 'error',
      message: '写入失败：' + (error instanceof Error ? error.message : String(error)),
    }, 500);
  }
}

/** 其它方法：405（避免被 SPA 回退伪装成 200） */
export function onRequest(): Response {
  return json({ status: 'method_not_allowed', message: '请使用 POST 提交反馈' }, 405, { allow: 'POST, OPTIONS' });
}

export function onRequestOptions(): Response {
  return new Response(null, { status: 204, headers: { allow: 'POST, OPTIONS', 'cache-control': 'no-store' } });
}

export const FEEDBACK_LIMITS = {
  maxDescription: MAX_DESCRIPTION,
  minDescription: MIN_DESCRIPTION,
  maxContact: MAX_CONTACT,
  maxScreenshotBytes: MAX_SCREENSHOT_BYTES,
  rateLimitPerHour: RATE_LIMIT_PER_HOUR,
  kinds: KINDS,
};
