/**
 * 反馈提交客户端（P1 任务 E）
 *
 * 原则：
 *   - **零外部依赖、不发第三方请求**：只 POST 到本站 `/api/feedback`（Pages Function + D1）；
 *   - **失败不丢内容**：网络失败或服务未配置时，把反馈留在本地队列（localStorage，最多 10 条），
 *     下次打开页面自动重试；
 *   - **永不抛异常**：界面只根据返回值提示，不因反馈失败影响学习流程；
 *   - 校验规则与服务端 `parseFeedbackPayload` 保持一致（双端都拦，不依赖单边）。
 */

export const FEEDBACK_API_PATH = '/api/feedback';
export const FEEDBACK_QUEUE_KEY = 'qingci.feedback.queue';
export const FEEDBACK_TIMEOUT_MS = 12000;
export const MAX_QUEUE = 10;

export const FEEDBACK_KINDS = [
  { value: 'bug', label: '功能报错' },
  { value: 'suggestion', label: '改进建议' },
  { value: 'content', label: '题目/内容问题' },
  { value: 'other', label: '其它' },
] as const;

export const FEEDBACK_LIMITS = {
  minDescription: 5,
  maxDescription: 2000,
  maxContact: 120,
  maxScreenshotBytes: 512 * 1024,
} as const;

export interface FeedbackInput {
  kind: string;
  description: string;
  contact?: string;
  /** 可选截图（data URL），由界面读取文件后传入 */
  screenshot?: string;
  /** 提交时所在位置（标签页 / 题目 id），便于定位 */
  page?: string;
  appVersion?: string;
  /** honeypot：正常用户不会填，机器人会 */
  website?: string;
}

export interface FeedbackValidation {
  ok: boolean;
  errors: string[];
  value: Required<Pick<FeedbackInput, 'kind' | 'description'>> & { contact: string; screenshot: string; page: string; appVersion: string; website: string };
}

export type FeedbackStatus = 'ok' | 'queued' | 'invalid' | 'unavailable' | 'rate_limited' | 'error';

export interface FeedbackResult {
  status: FeedbackStatus;
  message: string;
  id?: number;
  queued?: number;
}

const KINDS = FEEDBACK_KINDS.map((k) => k.value) as unknown as string[];

/** 校验并规范化（与服务端规则一致） */
export function validateFeedback(input: FeedbackInput): FeedbackValidation {
  const errors: string[] = [];
  const kind = KINDS.includes(input.kind) ? input.kind : 'other';
  const description = String(input.description || '').trim();
  const chars = Array.from(description);
  if (chars.length < FEEDBACK_LIMITS.minDescription) errors.push(`描述至少 ${FEEDBACK_LIMITS.minDescription} 个字`);
  if (chars.length > FEEDBACK_LIMITS.maxDescription) errors.push(`描述不能超过 ${FEEDBACK_LIMITS.maxDescription} 个字`);

  const contact = String(input.contact || '').trim().slice(0, FEEDBACK_LIMITS.maxContact);
  let screenshot = typeof input.screenshot === 'string' ? input.screenshot : '';
  if (screenshot && !/^data:image\/(png|jpeg|webp);base64,/.test(screenshot)) {
    errors.push('截图格式仅支持 PNG / JPEG / WebP');
    screenshot = '';
  }
  if (screenshot.length > FEEDBACK_LIMITS.maxScreenshotBytes) {
    errors.push('截图超过 512KB，请压缩后再试');
    screenshot = '';
  }

  return {
    ok: errors.length === 0,
    errors,
    value: {
      kind,
      description: chars.slice(0, FEEDBACK_LIMITS.maxDescription).join(''),
      contact,
      screenshot,
      page: String(input.page || '').slice(0, 120),
      appVersion: String(input.appVersion || '').slice(0, 32),
      website: String(input.website || '').slice(0, 200),
    },
  };
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

function resolveStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage;
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** 读取本地待提交队列 */
export function loadQueue(storage?: StorageLike | null): FeedbackInput[] {
  const store = resolveStorage(storage);
  if (!store) return [];
  try {
    const raw = store.getItem(FEEDBACK_QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as FeedbackInput[]).slice(0, MAX_QUEUE) : [];
  } catch {
    return [];
  }
}

/** 写入本地待提交队列（超出上限丢弃最旧的） */
export function saveQueue(queue: FeedbackInput[], storage?: StorageLike | null): FeedbackInput[] {
  const store = resolveStorage(storage);
  const trimmed = queue.slice(-MAX_QUEUE);
  if (!store) return trimmed;
  try {
    store.setItem(FEEDBACK_QUEUE_KEY, JSON.stringify(trimmed));
  } catch {
    /* 配额不足等场景忽略 */
  }
  return trimmed;
}

export interface SubmitOptions {
  fetchImpl?: typeof fetch;
  storage?: StorageLike | null;
  timeoutMs?: number;
  /** true 时不在失败后入队（供队列重试使用，避免重复入队） */
  skipQueue?: boolean;
}

/** 提交一条反馈（永不抛异常） */
export async function submitFeedback(input: FeedbackInput, options: SubmitOptions = {}): Promise<FeedbackResult> {
  const validation = validateFeedback(input);
  if (!validation.ok) return { status: 'invalid', message: validation.errors[0] };

  const doFetch = options.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  const enqueue = (payload: FeedbackInput): FeedbackResult => {
    if (options.skipQueue) return { status: 'error', message: '提交失败' };
    const queue = saveQueue([...loadQueue(options.storage), payload], options.storage);
    return { status: 'queued', message: `已保存在本机，联网后会自动重试（队列 ${queue.length} 条）`, queued: queue.length };
  };

  if (!doFetch) return enqueue(validation.value as FeedbackInput);

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), options.timeoutMs ?? FEEDBACK_TIMEOUT_MS) : null;
  try {
    const response = await doFetch(FEEDBACK_API_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validation.value),
      ...(controller ? { signal: controller.signal } : {}),
    });
    const payload = await response.json().catch(() => ({} as Record<string, unknown>));
    const message = typeof payload.message === 'string' ? payload.message : '';

    if (response.status === 201 || response.status === 202) {
      return { status: 'ok', message: '反馈已提交，感谢！', ...(typeof payload.id === 'number' ? { id: payload.id } : {}) };
    }
    if (response.status === 400) return { status: 'invalid', message: message || '内容不符合要求' };
    if (response.status === 429) return { status: 'rate_limited', message: message || '提交过于频繁，请稍后再试' };
    if (response.status === 503) return enqueue(validation.value as FeedbackInput);
    return enqueue(validation.value as FeedbackInput);
  } catch {
    return enqueue(validation.value as FeedbackInput);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 重试本地队列（打开页面或联网时调用）；返回成功提交的条数与剩余条数 */
export async function flushFeedbackQueue(options: SubmitOptions = {}): Promise<{ submitted: number; remaining: number }> {
  const queue = loadQueue(options.storage);
  if (!queue.length) return { submitted: 0, remaining: 0 };

  const remaining: FeedbackInput[] = [];
  let submitted = 0;
  for (const item of queue) {
    const result = await submitFeedback(item, { ...options, skipQueue: true });
    if (result.status === 'ok') submitted++;
    else remaining.push(item);
  }
  saveQueue(remaining, options.storage);
  return { submitted, remaining: remaining.length };
}

/** 读取图片文件为 data URL（超出上限返回错误） */
export function readImageFile(file: { type: string; size: number; arrayBuffer(): Promise<ArrayBuffer> }, options: { maxBytes?: number } = {}): Promise<{ ok: boolean; dataUrl?: string; error?: string }> {
  const maxBytes = options.maxBytes ?? FEEDBACK_LIMITS.maxScreenshotBytes;
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return Promise.resolve({ ok: false, error: '仅支持 PNG / JPEG / WebP' });
  if (file.size > maxBytes) return Promise.resolve({ ok: false, error: `图片超过 ${Math.round(maxBytes / 1024)}KB，请压缩后再试` });
  return file.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const base64 = typeof btoa === 'function' ? btoa(binary) : '';
    if (!base64) return { ok: false, error: '当前环境无法读取图片' };
    return { ok: true, dataUrl: `data:${file.type};base64,${base64}` };
  }).catch(() => ({ ok: false, error: '读取图片失败' }));
}
