/**
 * 错题本数据模型（P0.2）
 *
 * 覆盖四类必考题型（听力 / 阅读 / 翻译 / 写作），外加 `vocab` 用于承接既有「心魔本」
 * 的单词错题（迁移来源，不是新增题型）。
 *
 * 关键字段说明：
 *   - id：稳定主键。P0.3 固化题库上线后由题库提供 `q_<type>_<序号>`；
 *         在此之前用「题型 + 题干 + 答案」的 FNV-1a 哈希兜底，保证同一题始终同一个 id，
 *         否则复习间隔会被拆散到多条记录上。
 *   - ease / intervalDays / repetitions：SM-2 的三个状态量。
 *   - proficiency：0–5 的熟练度等级，由 SM-2 状态推导，用于界面展示与排序。
 *   - sourceRef：原文定位（试卷题定位到 paper/gate/序号，单词题定位到词条）。
 */

export type MistakeType = 'listen' | 'read' | 'translate' | 'write' | 'vocab';

export const MISTAKE_TYPES: ReadonlyArray<{ value: MistakeType; label: string; short: string }> = [
  { value: 'listen', label: '听力', short: '听' },
  { value: 'read', label: '阅读', short: '读' },
  { value: 'translate', label: '翻译', short: '译' },
  { value: 'write', label: '写作', short: '写' },
  { value: 'vocab', label: '词汇', short: '词' },
];

/** 复习反馈：与界面上的四个按钮一一对应 */
export type ReviewRating = 'again' | 'hard' | 'good' | 'easy';

export const REVIEW_RATINGS: ReadonlyArray<{ value: ReviewRating; label: string; quality: number }> = [
  { value: 'again', label: '忘记', quality: 2 },
  { value: 'hard', label: '模糊', quality: 3 },
  { value: 'good', label: '记得', quality: 4 },
  { value: 'easy', label: '熟练', quality: 5 },
];

/** 原文定位：能回到具体材料与位置 */
export interface MistakeSourceRef {
  /** 'paper' 试卷题 ｜ 'word' 单词 ｜ 'free' 自由练习 */
  kind: 'paper' | 'word' | 'free';
  paperId?: string;
  gate?: string;
  index?: number;
  word?: string;
  /** 题目原文片段（用于回看定位） */
  excerpt?: string;
}

export interface MistakeRecord {
  id: string;
  type: MistakeType;
  /** 题目原文 / 题干 */
  prompt: string;
  /** 用户当时的答案 */
  userAnswer: string;
  /** 正确答案 */
  correctAnswer: string;
  /** 解析（可空） */
  explanation?: string;
  sourceRef?: MistakeSourceRef;
  /** 知识点标签（P0.3 题库提供；当前按题型与门类粗标） */
  knowledgeTags: string[];
  /** 累计答错次数 */
  wrongCount: number;
  /** 累计复习次数 */
  reviewCount: number;
  /** 上次复习时间（ISO，未复习为空） */
  lastReviewedAt?: string;
  /** 下次复习时间（ISO） */
  nextReviewAt: string;
  /** SM-2 难度因子 */
  ease: number;
  /** 当前间隔（天，可为小数） */
  intervalDays: number;
  /** SM-2 连续答对次数 */
  repetitions: number;
  /** 0–5 熟练度等级（派生字段，便于展示） */
  proficiency: number;
  /**
   * 所属词库（v1.8.2 多词库隔离）。
   *
   * **老数据没有这个字段，一律读作 `'cet4'`** —— 迁移策略不是重写老记录，
   * 而是读取时用 `lexiconOf(record)` 兜底，这样既有用户零改动、不丢任何进度。
   * 不参与 SM-2 调度语义，纯隔离标记。
   */
  lx?: string;
  createdAt: string;
  updatedAt: string;
}

export const DEFAULT_EASE = 2.5;
export const MIN_EASE = 1.3;

/** 由 SM-2 状态推导熟练度等级（纯函数）
 *  0 = 刚答错 / 从未复习；1 起表示已有连续答对的记忆强度 */
export function proficiencyOf(input: { repetitions: number; ease: number; wrongCount: number; intervalDays: number }): number {
  const repetitions = Math.max(0, input.repetitions || 0);
  const base = repetitions >= 4 ? 4 : repetitions >= 2 ? 3 : repetitions >= 1 ? 2 : 0;
  const bonus = repetitions >= 1 && input.ease >= 2.6 && input.intervalDays >= 6 && input.wrongCount <= 2 ? 1 : 0;
  return Math.max(0, Math.min(5, base + bonus));
}

/** FNV-1a 哈希（与 src/core/utils.js 的实现保持一致，便于前后端/测试对齐） */
export function fnv1a(text: string): number {
  let n = 2166136261;
  for (const ch of String(text)) n = Math.imul(n ^ ch.charCodeAt(0), 16777619) >>> 0;
  return n >>> 0;
}

/**
 * 生成稳定错题 id
 * 题库上线前：`m_<type>_<hash>`；题库上线后由调用方传入 questionId 直接使用。
 */
export function mistakeId(input: { type: MistakeType; prompt: string; correctAnswer: string; questionId?: string }): string {
  if (input.questionId) return input.questionId;
  return `m_${input.type}_${fnv1a(`${input.type}|${input.prompt}|${input.correctAnswer}`).toString(36)}`;
}

/** 从试卷 gate 标识推断题型 */
export function typeFromGate(gate: string | undefined, label?: string): MistakeType {
  const key = String(gate || '').toLowerCase();
  const text = String(label || '');
  if (key === 'write' || text.includes('写作')) return 'write';
  if (key === 'trans' || text.includes('翻译')) return 'translate';
  if (key === 'news' || key === 'talk' || key === 'passage' || text.includes('听力')) return 'listen';
  if (key === 'detail' || text.includes('阅读') || text.includes('精读')) return 'read';
  if (key === 'speak' || text.includes('口语')) return 'vocab';
  return 'vocab';
}

export interface NewMistakeInput {
  type: MistakeType;
  prompt: string;
  userAnswer: string;
  correctAnswer: string;
  explanation?: string;
  sourceRef?: MistakeSourceRef;
  knowledgeTags?: string[];
  questionId?: string;
  now?: Date;
}

/** 新建一条错题记录（首次答错） */
export function createMistake(input: NewMistakeInput): MistakeRecord {
  const now = input.now || new Date();
  const iso = now.toISOString();
  const record: MistakeRecord = {
    id: mistakeId({ type: input.type, prompt: input.prompt, correctAnswer: input.correctAnswer, questionId: input.questionId }),
    type: input.type,
    prompt: input.prompt,
    userAnswer: input.userAnswer,
    correctAnswer: input.correctAnswer,
    explanation: input.explanation,
    sourceRef: input.sourceRef,
    knowledgeTags: input.knowledgeTags && input.knowledgeTags.length ? [...input.knowledgeTags] : [input.type],
    wrongCount: 1,
    reviewCount: 0,
    nextReviewAt: iso, // 首次答错立即进入今日队列
    ease: DEFAULT_EASE,
    intervalDays: 0,
    repetitions: 0,
    proficiency: 0,
    createdAt: iso,
    updatedAt: iso,
  };
  return record;
}

/** 再次答错：累加错误次数、重置 SM-2 进度并让它立刻回到复习队列 */
export function bumpMistake(record: MistakeRecord, input: { userAnswer: string; now?: Date }): MistakeRecord {
  const now = input.now || new Date();
  const iso = now.toISOString();
  return {
    ...record,
    userAnswer: input.userAnswer,
    wrongCount: record.wrongCount + 1,
    repetitions: 0,
    intervalDays: 0,
    proficiency: 0,
    nextReviewAt: iso,
    updatedAt: iso,
  };
}

/** 统计信息里展示用的记录摘要 */
export interface MistakeSummary {
  total: number;
  due: number;
  byType: Array<{ type: MistakeType; label: string; total: number; due: number; wrongCount: number; avgProficiency: number }>;
  weakTags: Array<{ tag: string; count: number }>;
}

/** 汇总错题本（纯函数，供界面与测试共用） */
export function summarizeMistakes(records: MistakeRecord[], now: Date = new Date()): MistakeSummary {
  const dueCount = records.filter((r) => new Date(r.nextReviewAt).getTime() <= now.getTime()).length;
  const byType = MISTAKE_TYPES.map(({ value, label }) => {
    const rows = records.filter((r) => r.type === value);
    const due = rows.filter((r) => new Date(r.nextReviewAt).getTime() <= now.getTime()).length;
    return {
      type: value,
      label,
      total: rows.length,
      due,
      wrongCount: rows.reduce((sum, r) => sum + r.wrongCount, 0),
      avgProficiency: rows.length ? Math.round((rows.reduce((sum, r) => sum + r.proficiency, 0) / rows.length) * 10) / 10 : 0,
    };
  }).filter((row) => row.total > 0);

  const tagCount = new Map<string, number>();
  for (const record of records) {
    for (const tag of record.knowledgeTags) {
      tagCount.set(tag, (tagCount.get(tag) || 0) + record.wrongCount);
    }
  }
  const weakTags = [...tagCount.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, 8);

  return { total: records.length, due: dueCount, byType, weakTags };
}
