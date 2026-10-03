/**
 * 学习计划设置（P1 任务 C）
 *
 * 设置很小（考试日期 / 每日可用时间 / 目标词量），放 localStorage 即可；
 * 读取时对脏数据做规范化，避免用户手改存储导致计划算崩。
 */
import { DEFAULT_EXAM_DATE } from './study-plan';

export const PLAN_SETTINGS_KEY = 'qingci.plan';

export interface PlanSettings {
  /** 考试日期（YYYY-MM-DD） */
  examDate: string;
  /** 每日可用学习分钟数 */
  dailyMinutes: number;
  /** 目标词量（0 表示按自适应摸底结果自动决定） */
  targetWords: number;
}

export const DEFAULT_PLAN_SETTINGS: PlanSettings = {
  examDate: DEFAULT_EXAM_DATE,
  dailyMinutes: 30,
  targetWords: 0,
};

const isDateLike = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

/** 规范化：非法值一律回落默认，并夹紧到合理范围 */
export function normalizePlanSettings(raw: unknown): PlanSettings {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Partial<PlanSettings>;
  const minutes = Number(input.dailyMinutes);
  const target = Number(input.targetWords);
  return {
    examDate: isDateLike(input.examDate) ? input.examDate : DEFAULT_PLAN_SETTINGS.examDate,
    dailyMinutes: Number.isFinite(minutes) ? Math.max(10, Math.min(240, Math.round(minutes))) : DEFAULT_PLAN_SETTINGS.dailyMinutes,
    targetWords: Number.isFinite(target) ? Math.max(0, Math.min(4540, Math.round(target))) : DEFAULT_PLAN_SETTINGS.targetWords,
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

/** 读取设置（存储不可用或数据损坏时回落默认） */
export function loadPlanSettings(storage?: StorageLike | null): PlanSettings {
  const store = resolveStorage(storage);
  if (!store) return { ...DEFAULT_PLAN_SETTINGS };
  try {
    const raw = store.getItem(PLAN_SETTINGS_KEY);
    return normalizePlanSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_PLAN_SETTINGS };
  }
}

/** 保存设置（返回是否写成功） */
export function savePlanSettings(settings: Partial<PlanSettings>, storage?: StorageLike | null): PlanSettings {
  const store = resolveStorage(storage);
  const merged = normalizePlanSettings({ ...loadPlanSettings(store), ...settings });
  if (!store) return merged;
  try {
    store.setItem(PLAN_SETTINGS_KEY, JSON.stringify(merged));
  } catch {
    /* 隐私模式等场景忽略 */
  }
  return merged;
}

/** 距考试天数（用于界面提示；日期已过则按 1 天兜底） */
export function daysToExam(examDate: string, now: Date = new Date()): number {
  const target = new Date(`${examDate}T09:00:00`);
  return Math.max(1, Math.ceil((target.getTime() - now.getTime()) / 86_400_000));
}
