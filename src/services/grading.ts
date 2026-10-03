/**
 * 写作 / 翻译批改服务（前端入口）
 *
 * 设计约束：
 * - 开关关闭时**不发起任何网络请求**，直接返回 not_implemented，由 UI 显示占位提示。
 * - 永不抛异常：所有失败都归一为 { status: 'error', message }，避免打断做题流程。
 * - 不在前端持有任何密钥：密钥只存在于 Cloudflare Pages 的环境变量里。
 *
 * 后端契约见 functions/api/grade.ts；类型定义见 src/types/grading.ts。
 */
import { isFeatureEnabled } from '../config/features';
import {
  GRADING_PLACEHOLDER_MESSAGE,
  type GradeResponse,
  type GradeResult,
  type GradeSubmissionPayload,
} from '../types/grading';

/** 批改接口路径（Pages Functions 路由，需同步登记到 _routes.json 的 include 白名单） */
export const GRADE_API_PATH = '/api/grade';

/** 单次批改的超时上限（毫秒）；超时按 error 处理，不阻塞界面 */
export const GRADE_TIMEOUT_MS = 20_000;

/** 前端可见的最小答案长度：低于该长度直接提示补全，避免浪费一次调用 */
export const MIN_ANSWER_LENGTH = 20;

function isGradeResponse(value: unknown): value is GradeResponse {
  if (!value || typeof value !== 'object') return false;
  const status = (value as { status?: unknown }).status;
  return status === 'not_implemented' || status === 'success' || status === 'error';
}

/** 校验后端返回的 result 结构，结构不符时按 error 处理，避免脏数据进入存储 */
export function isValidGradeResult(value: unknown): value is GradeResult {
  if (!value || typeof value !== 'object') return false;
  const r = value as Partial<GradeResult>;
  if (typeof r.totalScore !== 'number' || !Number.isFinite(r.totalScore)) return false;
  if (!r.dimensions || typeof r.dimensions !== 'object') return false;
  const d = r.dimensions as unknown as Record<string, unknown>;
  for (const key of ['content', 'coherence', 'language', 'richness']) {
    if (typeof d[key] !== 'number') return false;
  }
  if (!Array.isArray(r.errors) || !Array.isArray(r.suggestions)) return false;
  return true;
}

/**
 * 提交作文 / 翻译给 AI 批改
 *
 * @returns not_implemented（功能未开放）/ success（含批改结果）/ error（网络或服务异常）
 */
export async function gradeSubmission(payload: GradeSubmissionPayload): Promise<GradeResponse> {
  const answer = (payload?.userAnswer || '').trim();
  if (!answer) return { status: 'error', message: '请先作答，再提交批改。' };
  if (answer.length < MIN_ANSWER_LENGTH) {
    return { status: 'error', message: `答案过短（至少 ${MIN_ANSWER_LENGTH} 个字符），请补充后再提交。` };
  }

  // 开关关闭：直接返回占位状态，不请求 /api/grade
  if (!isFeatureEnabled('AI_GRADING_ENABLED')) {
    return { status: 'not_implemented', message: GRADING_PLACEHOLDER_MESSAGE };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GRADE_TIMEOUT_MS);
  try {
    const res = await fetch(GRADE_API_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    // 501 与 not_implemented 都视为「功能未开放」，UI 不报错
    if (res.status === 501) return { status: 'not_implemented', message: GRADING_PLACEHOLDER_MESSAGE };

    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      return { status: 'error', message: `批改服务返回了非 JSON 响应（HTTP ${res.status}）。` };
    }

    if (!isGradeResponse(body)) {
      return { status: 'error', message: `批改服务返回结构不符合约定（HTTP ${res.status}）。` };
    }
    if (body.status === 'success' && !isValidGradeResult(body.result)) {
      return { status: 'error', message: '批改结果字段不完整，已忽略本次结果。' };
    }
    return body;
  } catch (err) {
    const message = err instanceof Error && err.name === 'AbortError'
      ? '批改超时，请稍后重试。'
      : '批改服务暂时不可用，请稍后重试。';
    return { status: 'error', message };
  } finally {
    clearTimeout(timer);
  }
}
