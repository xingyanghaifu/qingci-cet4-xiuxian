/**
 * 写作 / 翻译批改的数据契约
 *
 * 这些类型同时被三处使用，改动时三处必须同步：
 *   1. 前端：src/services/grading.ts
 *   2. 后端占位：functions/api/grade.ts
 *   3. 记录结构：作文 / 翻译在 IndexedDB 中的 grade* 字段（见 P0.2 错题本 schema）
 */

/** 批改流程状态；not_submitted 表示用户还没提交过 */
export type GradeStatus = 'not_submitted' | 'pending' | 'graded' | 'failed' | 'not_implemented';

/** 四维评分，均为 15 分制总分的组成部分 */
export interface GradeDimensions {
  /** 内容切题 */
  content: number;
  /** 逻辑连贯 */
  coherence: number;
  /** 语言准确 */
  language: number;
  /** 表达丰富 */
  richness: number;
}

/** 单条错误批注 */
export interface GradeErrorItem {
  /** 原文片段 */
  original: string;
  /** 修改建议 */
  suggestion: string;
  /** 修改理由 */
  reason: string;
  /** 在用户答案中的字符区间（可选，用于前端高亮定位） */
  position?: { start: number; end: number };
}

/** 批改结果（后端返回，前端只读展示） */
export interface GradeResult {
  /** 总分，15 分制 */
  totalScore: number;
  dimensions: GradeDimensions;
  errors: GradeErrorItem[];
  suggestions: string[];
  /** 产出该结果的模型标识，占位阶段不填 */
  model?: string;
  /** ISO 时间戳 */
  gradedAt?: string;
}

/** 前端调用批改服务的返回契约（与 functions/api/grade.ts 一一对应） */
export type GradeResponse =
  | { status: 'not_implemented'; message: string }
  | { status: 'success'; result: GradeResult }
  | { status: 'error'; message: string };

/** 提交批改的入参 */
export interface GradeSubmissionPayload {
  type: 'writing' | 'translation';
  /** 题目稳定 ID（来自固化题库，见 P0.3） */
  questionId: string;
  userAnswer: string;
  /** 题干 / 写作要求，便于后端构造 Prompt */
  prompt?: string;
}

/**
 * 批改记录（挂在作文 / 翻译记录上，随学习进度一起存 IndexedDB）
 * 旧存档没有这些字段时按 not_submitted 处理，不需要数据迁移动作。
 */
export interface GradeRecord {
  gradeStatus: GradeStatus;
  gradeResult: GradeResult | null;
  /** 批改标准版本号，用于后期标准升级时做兼容判断 */
  gradeVersion: string;
}

/** 批改标准版本；评分维度或 Prompt 规则变更时递增 */
export const GRADE_VERSION = '1.0.0';

/** 未开放批改时界面展示的文案（前后端共用同一句，避免两处措辞不一致） */
export const GRADING_PLACEHOLDER_MESSAGE =
  'AI 批改功能正在接入中，当前可先查看参考范文和自评清单。';

/** 批改功能的四维权重说明（四级评分标准），供 UI 与后端 Prompt 共用 */
export const GRADE_DIMENSION_WEIGHTS: ReadonlyArray<{ key: keyof GradeDimensions; label: string; weight: number }> = [
  { key: 'content', label: '内容切题', weight: 0.4 },
  { key: 'coherence', label: '逻辑连贯', weight: 0.3 },
  { key: 'language', label: '语言准确', weight: 0.2 },
  { key: 'richness', label: '表达丰富', weight: 0.1 },
];

/** 默认（未提交）批改记录 */
export function emptyGradeRecord(): GradeRecord {
  return { gradeStatus: 'not_submitted', gradeResult: null, gradeVersion: GRADE_VERSION };
}
