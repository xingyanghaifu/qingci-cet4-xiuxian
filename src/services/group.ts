/**
 * 道友小组（P2.11 学习小组 / 排行榜）
 *
 * 隐私设计（**服务端强制，不依赖前端自觉**）：
 *   1. 只允许**昵称**：含邮箱、手机号、@ 或纯数字的昵称一律拒绝；
 *   2. **不上传任何答题数据**：同步的只有 境界档位 / 粗粒度进度 / 累计学习天数；
 *   3. 进度**分档**（0–100 取 5 的倍数）：无法反推出具体分数；
 *   4. 排行榜只回昵称、境界名、进度档、学习天数——**不含分数、不含题目、不含他人 ID**；
 *   5. 成员 ID 由客户端随机生成（匿名 UUID），与账号体系解耦。
 *
 * 降级：未配置 D1 时接口返回 503，前端提示「本机模式」，不影响学习功能。
 */

export const GROUP_API_PATH = '/api/group';
export const GROUP_MEMBER_KEY = 'qingci.group.member';
export const GROUP_NICKNAME_KEY = 'qingci.group.nickname';
export const GROUP_LAST_KEY = 'qingci.group.last';
export const MAX_NICKNAME = 12;
export const MAX_GROUP_NAME = 16;
export const MAX_MEMBERS = 20;

export interface GroupMemberView {
  nickname: string;
  realmIndex: number;
  realmName: string;
  /** 粗粒度进度档 0–100（5 的倍数） */
  progress: number;
  studyDays: number;
  /** 是否是本人（不回他人 ID） */
  isMe: boolean;
}

export interface GroupBoard {
  code: string;
  name: string;
  period: 'week' | 'month';
  members: GroupMemberView[];
  /** 成员总数（可能大于返回条数） */
  total: number;
  updatedAt: string;
}

export type GroupStatus = 'ok' | 'invalid' | 'not_found' | 'full' | 'unavailable' | 'rate_limited' | 'error';

export interface GroupResult<T> {
  status: GroupStatus;
  message: string;
  data?: T;
}

export interface GroupProgressPayload {
  code: string;
  memberId: string;
  nickname: string;
  realmIndex: number;
  /** 原始进度 0–100，客户端与客户端都会分档 */
  progress: number;
  studyDays: number;
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

/** 昵称校验：拒绝疑似真名/联系方式，只留昵称 */
export function validateNickname(raw: unknown): { ok: boolean; value: string; error?: string } {
  const value = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (value.length < 1) return { ok: false, value: '', error: '请填写昵称' };
  if (Array.from(value).length > MAX_NICKNAME) return { ok: false, value, error: `昵称不超过 ${MAX_NICKNAME} 个字` };
  if (/@/.test(value)) return { ok: false, value, error: '昵称不能包含 @（请勿使用邮箱）' };
  if (/\d{6,}/.test(value)) return { ok: false, value, error: '昵称不能包含长串数字（请勿使用手机号/学号）' };
  if (/^[\d\s]+$/.test(value)) return { ok: false, value, error: '昵称不能只有数字' };
  if (/(?:https?:\/\/|www\.)/i.test(value)) return { ok: false, value, error: '昵称不能包含网址' };
  return { ok: true, value };
}

/** 进度分档：取 5 的倍数并夹紧 0–100（避免反推具体分数） */
export function bucketProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  const clamped = Math.max(0, Math.min(100, progress));
  return Math.round(clamped / 5) * 5;
}

/** 邀请码校验（6 位大写字母数字） */
export function normalizeGroupCode(raw: unknown): string {
  return String(raw ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

export function isValidGroupCode(code: string): boolean {
  return /^[A-Z0-9]{6}$/.test(code);
}

/** 组名校验 */
export function validateGroupName(raw: unknown): { ok: boolean; value: string; error?: string } {
  const value = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!value) return { ok: true, value: '' };
  if (Array.from(value).length > MAX_GROUP_NAME) return { ok: false, value, error: `小组名不超过 ${MAX_GROUP_NAME} 个字` };
  if (/@|\d{6,}|https?:\/\//i.test(value)) return { ok: false, value, error: '小组名请勿包含联系方式或网址' };
  return { ok: true, value };
}

/** 生成/读取匿名成员 ID（与账号体系解耦） */
export function memberId(storage?: StorageLike | null): string {
  const store = resolveStorage(storage);
  if (!store) return 'anon-local';
  const existing = store.getItem(GROUP_MEMBER_KEY);
  if (existing && existing.length >= 8) return existing;
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
    : Math.random().toString(36).slice(2).padEnd(16, '0').slice(0, 16);
  store.setItem(GROUP_MEMBER_KEY, random);
  return random;
}

const NICK_PREFIX = ['云中', '听风', '拾贝', '青灯', '卧龙', '拂晓', '枕书', '踏雪', '问津', '藏拙', '半山', '衔月'];
const NICK_SUFFIX = ['散人', '道友', '书生', '行者', '修士', '学徒', '同修', '客'];

/** 随机道号：默认不含任何真实信息 */
export function defaultNickname(random: () => number = Math.random): string {
  const a = NICK_PREFIX[Math.floor(random() * NICK_PREFIX.length)];
  const b = NICK_SUFFIX[Math.floor(random() * NICK_SUFFIX.length)];
  const n = Math.floor(random() * 90) + 10;
  return `${a}${b}${n}`;
}

export function savedNickname(storage?: StorageLike | null): string {
  const store = resolveStorage(storage);
  const saved = store?.getItem(GROUP_NICKNAME_KEY) || '';
  const check = validateNickname(saved);
  return check.ok ? check.value : '';
}

export function saveNickname(nickname: string, storage?: StorageLike | null): string {
  const check = validateNickname(nickname);
  const store = resolveStorage(storage);
  if (check.ok && store) {
    try { store.setItem(GROUP_NICKNAME_KEY, check.value); } catch { /* 忽略 */ }
  }
  return check.ok ? check.value : '';
}

export interface GroupClientOptions {
  fetchImpl?: typeof fetch;
  storage?: StorageLike | null;
  timeoutMs?: number;
}

async function callApi<T>(body: Record<string, unknown>, options: GroupClientOptions = {}): Promise<GroupResult<T>> {
  // fetchImpl 显式传 null 表示「当前环境没有 fetch」；undefined 才回落到全局 fetch
  const doFetch = options.fetchImpl === undefined
    ? (typeof fetch !== 'undefined' ? fetch : null)
    : options.fetchImpl;
  if (!doFetch) return { status: 'unavailable', message: '当前环境不支持联网小组功能' };

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), options.timeoutMs ?? 12000) : null;
  try {
    const response = await doFetch(GROUP_API_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      ...(controller ? { signal: controller.signal } : {}),
    });
    const payload = await response.json().catch(() => ({} as Record<string, unknown>));
    const message = typeof payload.message === 'string' ? payload.message : '';
    if (response.status === 200) return { status: 'ok', message: message || 'ok', data: payload.data as T };
    if (response.status === 400) return { status: 'invalid', message: message || '参数不符合要求' };
    if (response.status === 404) return { status: 'not_found', message: message || '小组不存在' };
    if (response.status === 409) return { status: 'full', message: message || '小组人数已满' };
    if (response.status === 429) return { status: 'rate_limited', message: message || '操作过于频繁' };
    if (response.status === 503) return { status: 'unavailable', message: message || '小组服务未配置' };
    return { status: 'error', message: message || `请求失败（${response.status}）` };
  } catch (error) {
    return { status: 'error', message: '网络不可用：' + (error instanceof Error ? error.message : String(error)) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 创建小组 */
export function createGroup(input: { name?: string; nickname: string; progress: Omit<GroupProgressPayload, 'code' | 'nickname'> }, options: GroupClientOptions = {}): Promise<GroupResult<GroupBoard>> {
  const nickname = validateNickname(input.nickname);
  if (!nickname.ok) return Promise.resolve({ status: 'invalid', message: nickname.error || '昵称不合法' });
  const name = validateGroupName(input.name);
  if (!name.ok) return Promise.resolve({ status: 'invalid', message: name.error || '小组名不合法' });
  return callApi<GroupBoard>({
    action: 'create',
    name: name.value,
    nickname: nickname.value,
    ...input.progress,
    progress: bucketProgress(input.progress.progress),
  }, options);
}

/** 加入小组 */
export function joinGroup(input: { code: string; nickname: string; progress: Omit<GroupProgressPayload, 'code' | 'nickname'> }, options: GroupClientOptions = {}): Promise<GroupResult<GroupBoard>> {
  const code = normalizeGroupCode(input.code);
  if (!isValidGroupCode(code)) return Promise.resolve({ status: 'invalid', message: '邀请码应为 6 位字母或数字' });
  const nickname = validateNickname(input.nickname);
  if (!nickname.ok) return Promise.resolve({ status: 'invalid', message: nickname.error || '昵称不合法' });
  return callApi<GroupBoard>({
    action: 'join',
    code,
    nickname: nickname.value,
    ...input.progress,
    progress: bucketProgress(input.progress.progress),
  }, options);
}

/** 同步自己的进度并取回榜单 */
export function syncProgress(input: GroupProgressPayload, options: GroupClientOptions = {}): Promise<GroupResult<GroupBoard>> {
  const code = normalizeGroupCode(input.code);
  const nickname = validateNickname(input.nickname);
  if (!isValidGroupCode(code)) return Promise.resolve({ status: 'invalid', message: '邀请码不合法' });
  if (!nickname.ok) return Promise.resolve({ status: 'invalid', message: nickname.error || '昵称不合法' });
  return callApi<GroupBoard>({
    action: 'sync',
    code,
    memberId: input.memberId,
    nickname: nickname.value,
    realmIndex: Math.max(0, Math.round(input.realmIndex) || 0),
    progress: bucketProgress(input.progress),
    studyDays: Math.max(0, Math.round(input.studyDays) || 0),
  }, options);
}

/** 拉取榜单（不更新自己的数据） */
export function fetchBoard(input: { code: string; memberId: string; period?: 'week' | 'month' }, options: GroupClientOptions = {}): Promise<GroupResult<GroupBoard>> {
  const code = normalizeGroupCode(input.code);
  if (!isValidGroupCode(code)) return Promise.resolve({ status: 'invalid', message: '邀请码不合法' });
  return callApi<GroupBoard>({
    action: 'board',
    code,
    memberId: input.memberId,
    period: input.period === 'month' ? 'month' : 'week',
  }, options);
}

/** 退出小组 */
export function leaveGroup(input: { code: string; memberId: string }, options: GroupClientOptions = {}): Promise<GroupResult<{ left: boolean }>> {
  const code = normalizeGroupCode(input.code);
  if (!isValidGroupCode(code)) return Promise.resolve({ status: 'invalid', message: '邀请码不合法' });
  return callApi<{ left: boolean }>({ action: 'leave', code, memberId: input.memberId }, options);
}

/** 记住最近加入的小组（用于下次自动同步） */
export function rememberGroup(code: string, storage?: StorageLike | null): void {
  const store = resolveStorage(storage);
  if (store && isValidGroupCode(code)) {
    try { store.setItem(GROUP_LAST_KEY, code); } catch { /* 忽略 */ }
  }
}

export function lastGroup(storage?: StorageLike | null): string {
  const store = resolveStorage(storage);
  const code = store?.getItem(GROUP_LAST_KEY) || '';
  return isValidGroupCode(code) ? code : '';
}

/** 榜单成员的可读摘要（界面用；不含任何分数） */
export function describeMember(member: GroupMemberView): string {
  return `${member.realmName} · 进度 ${member.progress}% · 修习 ${member.studyDays} 天`;
}
