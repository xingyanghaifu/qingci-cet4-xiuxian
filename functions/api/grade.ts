/**
 * Cloudflare Pages Function: 写作 / 翻译 AI 批改（POST /api/grade）
 *
 * ⚠️ 当前为**占位实现**：不调用任何外部 API、不读取密钥、不产生任何费用。
 *    无论请求内容如何，都返回 { status: 'not_implemented' }，前端据此显示占位提示。
 *
 * 为什么不用 501：该端点是产品功能的一部分，「尚未开放」属于预期状态而非服务错误，
 * 返回 200 + not_implemented 可以避免监控告警与前端误报，同时保持与前端 GradeResponse 契约一致。
 *
 * ────────────────────────────────────────────────────────────────
 * 后期接入步骤（前端无需改动）：
 *   1. 在 Cloudflare Pages → Settings → Environment variables 配置 DEEPSEEK_API_KEY
 *      （用 Secret 类型，切勿写进仓库或前端代码）
 *   2. 将 AI_GRADING_ENABLED 设为 "true"（前端开关 src/config/features.ts 同步置 true 并重新构建）
 *   3. 替换本文件 `TODO(接入)` 标记处的占位逻辑，改为调用 DeepSeek Chat Completions
 *   4. 按四级评分标准构造 Prompt：内容切题 40%、逻辑连贯 30%、语言准确 20%、表达丰富 10%
 *      （权重常量与前端共用：src/types/grading.ts 的 GRADE_DIMENSION_WEIGHTS）
 *   5. 返回结构必须与前端 GradeResponse 一致：{ status:'success', result: GradeResult }
 *   6. 补上限流（AI_GRADING_DAILY_LIMIT）、超时（建议 20s，与前端 GRADE_TIMEOUT_MS 对齐）、
 *      错误处理与 token 成本记录
 *   7. 前端不需要任何改动：开关打开后即走 /api/grade
 * ────────────────────────────────────────────────────────────────
 *
 * 环境变量约定：
 *   AI_GRADING_ENABLED      后端总开关（字符串 "true" 生效）
 *   DEEPSEEK_API_KEY        模型密钥（仅服务端可见，占位阶段不读取）
 *   AI_GRADING_DAILY_LIMIT  每日调用上限（占位阶段仅回显，不做计数）
 */

/** 与 src/types/grading.ts 中的 GradeResponse 保持一致的返回契约 */
type GradeResponse =
  | { status: 'not_implemented'; message: string }
  | { status: 'success'; result: unknown }
  | { status: 'error'; message: string };

interface GradeEnv {
  AI_GRADING_ENABLED?: string;
  DEEPSEEK_API_KEY?: string;
  AI_GRADING_DAILY_LIMIT?: string;
  APP_VERSION?: string;
}

interface GradeContext {
  request: Request;
  env: GradeEnv;
}

const JSON_HEADERS: Record<string, string> = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

function json(body: GradeResponse, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), { status, headers: JSON_HEADERS });
}

/** 后端开关是否打开（默认关闭；只有显式 "true" 才算打开） */
function serverGradingEnabled(env: GradeEnv): boolean {
  return String(env?.AI_GRADING_ENABLED || '').toLowerCase() === 'true';
}

export async function onRequestOptions(): Promise<Response> {
  return new Response(null, { status: 204, headers: JSON_HEADERS });
}

export async function onRequestPost(context: GradeContext): Promise<Response> {
  const { request, env } = context;

  // 1) 解析请求体（失败不影响返回契约，仍按未开放处理）
  let payload: { type?: string; questionId?: string; userAnswer?: string; prompt?: string } = {};
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return json({ status: 'error', message: '请求体不是合法 JSON。' }, 400);
  }
  if (!payload || typeof payload.userAnswer !== 'string' || !payload.userAnswer.trim()) {
    return json({ status: 'error', message: '缺少 userAnswer 字段。' }, 400);
  }

  // 2) 占位阶段：无论开关如何，都不调用外部服务
  //    —— 保证「不生成假密钥、不发送外部请求、不伪造评分」。
  void serverGradingEnabled(env); // 预留：接入后用于分支判断
  void env.DEEPSEEK_API_KEY;      // 预留：接入后作为 Authorization: Bearer <key>
  void env.AI_GRADING_DAILY_LIMIT; // 预留：接入后做每日计数

  // TODO(接入)：把下面这段替换为对 DeepSeek API 的调用，并按 GradeResult 组装返回。
  //   注意：
  //   - 密钥只从 env 读取，绝不回传前端；
  //   - 调用失败/超时统一返回 { status:'error', message }；
  //   - 结果写入前先按前端 isValidGradeResult 的同构规则自检。
  return json({
    status: 'not_implemented',
    message: 'AI 批改功能尚未开放',
  });
}

/** 其余方法一律 405，避免被当成可用端点误用 */
export async function onRequest(): Promise<Response> {
  return json({ status: 'error', message: '仅支持 POST /api/grade。' }, 405);
}
