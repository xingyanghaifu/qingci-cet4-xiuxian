/**
 * 无障碍与个性化偏好（P2.12）
 *
 * 三个**互相独立**的轴（可与主题的浅色/深色自由组合）：
 *   1. `fontScale`：字号档位，作用于题目正文、选项、解析与原文（4 档：标准 / 大 / 特大 / 超大）；
 *   2. `contrast`：高对比度模式，针对弱视用户（纯黑/纯白 + 加粗边框，覆盖主题变量）；
 *   3. `motion`：动态效果偏好（`system` 跟随系统 `prefers-reduced-motion`，`reduced` 强制关闭）。
 *
 * 落地方式：在 `<html>` 上打 `data-font` / `data-contrast` / `data-motion`，
 * CSS 通过属性选择器生效——这样**不需要 JS 参与渲染**，也便于在无 JS 环境下退化。
 * 偏好存 localStorage（`qingci.a11y`），读取时规范化，脏数据回落默认。
 */

export const A11Y_STORAGE_KEY = 'qingci.a11y';

export type FontScale = 'standard' | 'large' | 'xlarge' | 'huge';
export type ContrastMode = 'normal' | 'high';
export type MotionPreference = 'system' | 'reduced';

export interface A11yPreferences {
  fontScale: FontScale;
  contrast: ContrastMode;
  motion: MotionPreference;
}

export const DEFAULT_A11Y: A11yPreferences = {
  fontScale: 'standard',
  contrast: 'normal',
  motion: 'system',
};

export interface FontScaleOption {
  value: FontScale;
  label: string;
  /** 相对倍数，仅用于界面说明与测试断言 */
  scale: number;
}

export const FONT_SCALES: ReadonlyArray<FontScaleOption> = [
  { value: 'standard', label: '标准', scale: 1 },
  { value: 'large', label: '大', scale: 1.15 },
  { value: 'xlarge', label: '特大', scale: 1.3 },
  { value: 'huge', label: '超大', scale: 1.5 },
];

export const CONTRAST_OPTIONS: ReadonlyArray<{ value: ContrastMode; label: string }> = [
  { value: 'normal', label: '标准对比度' },
  { value: 'high', label: '高对比度（弱视友好）' },
];

export const MOTION_OPTIONS: ReadonlyArray<{ value: MotionPreference; label: string }> = [
  { value: 'system', label: '跟随系统' },
  { value: 'reduced', label: '减少动态效果' },
];

const FONT_VALUES = FONT_SCALES.map((f) => f.value) as unknown as string[];
const CONTRAST_VALUES = CONTRAST_OPTIONS.map((c) => c.value) as unknown as string[];
const MOTION_VALUES = MOTION_OPTIONS.map((m) => m.value) as unknown as string[];

/** 规范化（非法值一律回落默认，避免脏数据把界面打崩） */
export function normalizeA11y(raw: unknown): A11yPreferences {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Partial<A11yPreferences>;
  return {
    fontScale: FONT_VALUES.includes(String(input.fontScale)) ? (input.fontScale as FontScale) : DEFAULT_A11Y.fontScale,
    contrast: CONTRAST_VALUES.includes(String(input.contrast)) ? (input.contrast as ContrastMode) : DEFAULT_A11Y.contrast,
    motion: MOTION_VALUES.includes(String(input.motion)) ? (input.motion as MotionPreference) : DEFAULT_A11Y.motion,
  };
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function resolveStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage;
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** 读取偏好（无存储或数据损坏时回落默认） */
export function loadA11y(storage?: StorageLike | null): A11yPreferences {
  const store = resolveStorage(storage);
  if (!store) return { ...DEFAULT_A11Y };
  try {
    const raw = store.getItem(A11Y_STORAGE_KEY);
    return normalizeA11y(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_A11Y };
  }
}

/** 保存偏好（返回规范化后的结果） */
export function saveA11y(prefs: Partial<A11yPreferences>, storage?: StorageLike | null): A11yPreferences {
  const store = resolveStorage(storage);
  const merged = normalizeA11y({ ...loadA11y(store), ...prefs });
  if (store) {
    try {
      store.setItem(A11Y_STORAGE_KEY, JSON.stringify(merged));
    } catch {
      /* 隐私模式等场景忽略 */
    }
  }
  return merged;
}

export interface A11yHost {
  documentElement: { dataset: Record<string, string | undefined> };
}

function resolveHost(host?: A11yHost | null): A11yHost | null {
  if (host !== undefined) return host;
  return typeof document !== 'undefined' ? (document as unknown as A11yHost) : null;
}

export interface AppliedA11y {
  fontScale: FontScale;
  contrast: ContrastMode;
  /** 实际是否减少动效（motion=reduced 或系统开启减动效） */
  reducedMotion: boolean;
  scale: number;
}

/**
 * 应用偏好到 `<html>`：
 *   - fontScale=标准 → 移除属性（走 CSS 默认）
 *   - 其余档位 → data-font="large|xlarge|huge"
 *   - contrast=high → data-contrast="high"
 *   - motion=reduced → data-motion="reduced"（system 时移除，交给 CSS 媒体查询）
 */
export function applyA11y(prefs: A11yPreferences, options: { host?: A11yHost | null; persist?: boolean; systemReducedMotion?: boolean } = {}): AppliedA11y {
  const host = resolveHost(options.host);
  const normalized = normalizeA11y(prefs);
  try {
    if (host) {
      const data = host.documentElement.dataset;
      if (normalized.fontScale === 'standard') delete data.font;
      else data.font = normalized.fontScale;
      if (normalized.contrast === 'high') data.contrast = 'high';
      else delete data.contrast;
      if (normalized.motion === 'reduced') data.motion = 'reduced';
      else delete data.motion;
    }
  } catch {
    /* 忽略 DOM 异常 */
  }
  if (options.persist !== false) saveA11y(normalized);
  const option = FONT_SCALES.find((f) => f.value === normalized.fontScale);
  return {
    fontScale: normalized.fontScale,
    contrast: normalized.contrast,
    reducedMotion: normalized.motion === 'reduced' || !!options.systemReducedMotion,
    scale: option ? option.scale : 1,
  };
}

/** 初始化：读取并应用（返回当前偏好） */
export function initA11y(options: { host?: A11yHost | null; systemReducedMotion?: boolean } = {}): A11yPreferences {
  const prefs = loadA11y();
  applyA11y(prefs, { host: options.host, persist: false, systemReducedMotion: options.systemReducedMotion });
  return prefs;
}

/** 字号档位的中文标签 */
export function fontScaleLabel(scale: FontScale): string {
  return FONT_SCALES.find((f) => f.value === scale)?.label || scale;
}

/** 偏好的可读摘要（界面展示） */
export function describeA11y(prefs: A11yPreferences): string {
  const contrast = prefs.contrast === 'high' ? '高对比度' : '标准对比度';
  const motion = prefs.motion === 'reduced' ? '减少动效' : '跟随系统动效';
  return `字号 ${fontScaleLabel(prefs.fontScale)} · ${contrast} · ${motion}`;
}

/**
 * 无障碍快捷键说明表（界面「快捷键」区展示，与 `shortcuts.ts` 的解析保持一致）
 * 单独放在这里是为了让文案与实现同源，避免文档漂移。
 */
export const SHORTCUT_HELP: ReadonlyArray<{ keys: string; action: string }> = [
  { keys: '1 – 4', action: '选择第 1–4 个选项' },
  { keys: '→ / ↓', action: '下一题' },
  { keys: '← / ↑', action: '上一题' },
  { keys: 'Enter', action: '提交 / 核对 / 继续' },
  { keys: '空格', action: '播放或暂停听力' },
  { keys: 'R', action: '重播听力' },
  { keys: 'Esc', action: '关闭弹窗（精听 / 反馈 / 突破）' },
  { keys: '?', action: '显示或隐藏本快捷键表' },
];
