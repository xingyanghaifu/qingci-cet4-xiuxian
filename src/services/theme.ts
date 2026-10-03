/**
 * 主题（浅色 / 深色 / 跟随系统）
 *
 * 现状：模板 CSS 用变量 + `prefers-color-scheme` 已经能跟随系统；
 * 本模块补上**手动切换**：把偏好写到 localStorage，并在 <html> 上打 `data-theme`，
 * 由 CSS 中 `:root[data-theme="dark"|"light"]` 覆盖系统偏好。
 */

export type ThemePreference = 'auto' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'qingci.theme';
export const THEME_OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string }> = [
  { value: 'auto', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
];

/** 把存储值规范化为合法偏好（脏数据一律回落 auto） */
export function normalizePreference(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' || value === 'auto' ? value : 'auto';
}

/** 由「偏好 + 系统是否深色」解析出最终主题（纯函数） */
export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  if (preference === 'dark') return 'dark';
  if (preference === 'light') return 'light';
  return systemDark ? 'dark' : 'light';
}

/** 读取偏好（存储不可用时回落 auto） */
export function readPreference(storage?: { getItem(key: string): string | null } | null): ThemePreference {
  try {
    const store = storage === undefined ? (typeof localStorage !== 'undefined' ? localStorage : null) : storage;
    if (!store) return 'auto';
    return normalizePreference(store.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'auto';
  }
}

/** 写入偏好（存储不可用时静默失败） */
export function writePreference(
  preference: ThemePreference,
  storage?: { setItem(key: string, value: string): void } | null,
): boolean {
  try {
    const store = storage === undefined ? (typeof localStorage !== 'undefined' ? localStorage : null) : storage;
    if (!store) return false;
    store.setItem(THEME_STORAGE_KEY, normalizePreference(preference));
    return true;
  } catch {
    return false;
  }
}

export interface ThemeHost {
  documentElement: { dataset: Record<string, string | undefined> };
  defaultView?: { matchMedia(query: string): { matches: boolean } } | null;
}

/** 是否处于系统深色（无 matchMedia 时按浅色处理） */
export function systemPrefersDark(host?: ThemeHost | null): boolean {
  try {
    const view = host === undefined
      ? (typeof window !== 'undefined' ? window : null)
      : host?.defaultView ?? null;
    if (!view || typeof view.matchMedia !== 'function') return false;
    return view.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

/**
 * 应用主题：在 <html> 上设置 data-theme
 * - auto：移除属性，交回 CSS 的 prefers-color-scheme
 * - light/dark：显式设置，覆盖系统偏好
 * @returns 实际生效的主题
 */
export function applyTheme(
  preference: ThemePreference,
  options: { host?: ThemeHost | null; persist?: boolean } = {},
): ResolvedTheme {
  const host = options.host === undefined ? (typeof document !== 'undefined' ? (document as unknown as ThemeHost) : null) : options.host;
  const pref = normalizePreference(preference);
  const resolved = resolveTheme(pref, systemPrefersDark(host));
  try {
    if (host) {
      if (pref === 'auto') delete host.documentElement.dataset.theme;
      else host.documentElement.dataset.theme = pref;
    }
  } catch {
    /* 忽略 DOM 异常 */
  }
  if (options.persist !== false) writePreference(pref);
  return resolved;
}

/** 初始化：读取偏好并应用；返回当前偏好 */
export function initTheme(options: { host?: ThemeHost | null } = {}): ThemePreference {
  const pref = readPreference();
  applyTheme(pref, { host: options.host, persist: false });
  return pref;
}
