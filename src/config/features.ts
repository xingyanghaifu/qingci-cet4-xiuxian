/**
 * 前端 Feature Flag
 *
 * 约定：
 * - 所有开关默认关闭（false），未完成端到端验证的功能不得置为 true。
 * - 前端开关为 false 时，界面直接显示占位提示，**不发起任何网络请求**。
 * - 后端另有一套环境变量开关（Cloudflare Pages Settings → Environment variables），
 *   两者都开启才会真正走到 AI 服务；前端开关只决定「是否请求 /api/grade」。
 *
 * 允许运行时覆盖（便于灰度 / 排障）：
 *   window.__QINGCI_FEATURE_OVERRIDES__ = { AI_GRADING_ENABLED: true }
 * 覆盖只在当前页面会话内生效，不写入存储。
 */

export interface FeatureFlags {
  /** AI 写作 / 翻译批改（当前仅接口预留，不接入真实模型） */
  AI_GRADING_ENABLED: boolean;
  /** PWA 离线增强：词库与试卷数据写入 IndexedDB 缓存 */
  PWA_OFFLINE_ENABLED: boolean;
  /** 重放 AI 批改中的模型原文（调试用） */
  SHOW_GRADING_MODEL_TRACE: boolean;
}

export const FEATURES: Readonly<FeatureFlags> = Object.freeze({
  AI_GRADING_ENABLED: false,
  PWA_OFFLINE_ENABLED: true,
  SHOW_GRADING_MODEL_TRACE: false,
});

type OverrideHost = { __QINGCI_FEATURE_OVERRIDES__?: Partial<FeatureFlags> };

/** 读取开关当前值（含运行时覆盖） */
export function isFeatureEnabled(name: keyof FeatureFlags): boolean {
  const host = globalThis as unknown as OverrideHost;
  const override = host.__QINGCI_FEATURE_OVERRIDES__;
  if (override && typeof override[name] === 'boolean') return override[name] as boolean;
  return FEATURES[name];
}

/** 当前生效的完整开关表（供设置页 / 状态页展示） */
export function activeFeatures(): FeatureFlags {
  return {
    AI_GRADING_ENABLED: isFeatureEnabled('AI_GRADING_ENABLED'),
    PWA_OFFLINE_ENABLED: isFeatureEnabled('PWA_OFFLINE_ENABLED'),
    SHOW_GRADING_MODEL_TRACE: isFeatureEnabled('SHOW_GRADING_MODEL_TRACE'),
  };
}
