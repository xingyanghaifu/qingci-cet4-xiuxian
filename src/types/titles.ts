/**
 * 成就称号系统（P2.11）
 *
 * 设计原则：
 *   1. **只与真实作答数据挂钩**：每一条称号都写明「样本量 + 正确率」双门槛，
 *      样本不足不发放，避免「做 1 题全对就封神」。
 *   2. **自动解锁、不设付费与加速**：没有任何购买、任务代币或限时活动。
 *   3. **不含惩罚性条件**：坚持类称号按**累计**学习天数（不要求连续），
 *      断签不清零——避免「今天没打卡就前功尽弃」的负向驱动。
 *   4. **称号名与修仙主题绑定**，但门槛写着具体数字，用户随时知道差多少。
 */

export type TitlePart = '听力' | '阅读' | '翻译' | '写作' | '词汇' | '全卷' | '坚持' | '复习';

export interface TitleRequirement {
  /** 统计口径：按部分统计，或特殊口径 */
  scope: TitlePart;
  /** 最低正确率 0–1（坚持/复习类为 0，用 count 门槛） */
  minAccuracy: number;
  /** 最低样本量（题数 / 天数 / 词数） */
  minSamples: number;
}

export interface TitleDef {
  key: string;
  /** 称号名，如「听力金丹」 */
  name: string;
  part: TitlePart;
  /** 境界后缀（练气/筑基/金丹/元婴/化神），仅用于命名与展示 */
  tier: string;
  requirement: TitleRequirement;
  /** 获取条件的自然语言说明 */
  condition: string;
}

export const TITLES: TitleDef[] = [
  // —— 词汇 ——
  {
    key: 'vocab_zhuji', name: '词海筑基', part: '词汇', tier: '筑基',
    requirement: { scope: '词汇', minAccuracy: 0.75, minSamples: 50 },
    condition: '词汇类题目作答 ≥50 题且正确率 ≥75%',
  },
  {
    key: 'vocab_jindan', name: '词汇金丹', part: '词汇', tier: '金丹',
    requirement: { scope: '词汇', minAccuracy: 0.85, minSamples: 200 },
    condition: '词汇类题目作答 ≥200 题且正确率 ≥85%',
  },
  // —— 听力 ——
  {
    key: 'listen_jindan', name: '听力金丹', part: '听力', tier: '金丹',
    requirement: { scope: '听力', minAccuracy: 0.8, minSamples: 30 },
    condition: '听力题作答 ≥30 题且正确率 ≥80%',
  },
  {
    key: 'listen_yuanying', name: '听力元婴', part: '听力', tier: '元婴',
    requirement: { scope: '听力', minAccuracy: 0.88, minSamples: 80 },
    condition: '听力题作答 ≥80 题且正确率 ≥88%',
  },
  // —— 阅读 ——
  {
    key: 'read_yuanying', name: '阅读元婴', part: '阅读', tier: '元婴',
    requirement: { scope: '阅读', minAccuracy: 0.85, minSamples: 30 },
    condition: '阅读题作答 ≥30 题且正确率 ≥85%',
  },
  {
    key: 'read_huashen', name: '阅读化神', part: '阅读', tier: '化神',
    requirement: { scope: '阅读', minAccuracy: 0.92, minSamples: 100 },
    condition: '阅读题作答 ≥100 题且正确率 ≥92%',
  },
  // —— 翻译 / 写作 ——
  {
    key: 'trans_huashen', name: '翻译化神', part: '翻译', tier: '化神',
    requirement: { scope: '翻译', minAccuracy: 0.9, minSamples: 12 },
    condition: '翻译题作答 ≥12 题且正确率 ≥90%',
  },
  {
    key: 'write_huashen', name: '写作化神', part: '写作', tier: '化神',
    requirement: { scope: '写作', minAccuracy: 0.88, minSamples: 10 },
    condition: '写作题作答 ≥10 题且正确率 ≥88%',
  },
  // —— 全卷 ——
  {
    key: 'paper_huashen', name: '全卷化神', part: '全卷', tier: '化神',
    requirement: { scope: '全卷', minAccuracy: 0, minSamples: 700 },
    condition: '完成整套模考且总分 ≥700 / 710',
  },
  // —— 坚持（累计，不要求连续，断签不清零） ——
  {
    key: 'persist_zhuji', name: '勤修不辍', part: '坚持', tier: '筑基',
    requirement: { scope: '坚持', minAccuracy: 0, minSamples: 30 },
    condition: '累计学习 ≥30 天（按自然日累计，断签不清零）',
  },
  // —— 复习 ——
  {
    key: 'review_jindan', name: '心有灵犀', part: '复习', tier: '金丹',
    requirement: { scope: '复习', minAccuracy: 0, minSamples: 500 },
    condition: '间隔复习中达到「熟练」的词 ≥500 个',
  },
];

export interface TitlePartStat {
  part: string;
  total: number;
  correct: number;
}

export interface TitleInput {
  /** 按部分的作答统计（来自模考报告 / 作答流水） */
  partStats: TitlePartStat[];
  /** 累计学习天数（自然日去重） */
  studyDays: number;
  /** 间隔复习中熟练词数 */
  masteredWords: number;
  /** 历史最佳模考总分 */
  bestScore: number;
  /** 是否完成过整套模考 */
  fullPaperCompleted: boolean;
}

export interface TitleProgress {
  title: TitleDef;
  /** 0–1 */
  progress: number;
  /** 还差什么（可读文案） */
  remaining: string;
}

export interface TitleEvaluation {
  unlocked: TitleDef[];
  locked: TitleProgress[];
}

const accuracy = (stat: TitlePartStat | undefined): number => (stat && stat.total > 0 ? stat.correct / stat.total : 0);

/** 单条称号的进度（0–1）与差距说明 */
export function titleProgress(title: TitleDef, input: TitleInput): TitleProgress {
  const stat = input.partStats.find((s) => s.part === title.requirement.scope);
  const req = title.requirement;
  let progress = 0;
  let remaining = '';

  if (title.part === '坚持') {
    progress = Math.min(1, input.studyDays / req.minSamples);
    remaining = `累计学习 ${input.studyDays} / ${req.minSamples} 天`;
  } else if (title.part === '复习') {
    progress = Math.min(1, input.masteredWords / req.minSamples);
    remaining = `熟练词 ${input.masteredWords} / ${req.minSamples}`;
  } else if (title.part === '全卷') {
    if (!input.fullPaperCompleted) {
      progress = Math.min(0.5, input.bestScore / req.minSamples * 0.5);
      remaining = `尚未完成整套模考（当前最佳 ${input.bestScore} 分）`;
    } else {
      progress = Math.min(1, input.bestScore / req.minSamples);
      remaining = `最佳总分 ${input.bestScore} / ${req.minSamples}`;
    }
  } else {
    const total = stat?.total || 0;
    const acc = accuracy(stat);
    const sampleProgress = Math.min(1, total / req.minSamples);
    const accuracyProgress = req.minAccuracy > 0 ? Math.min(1, acc / req.minAccuracy) : 1;
    progress = Math.min(sampleProgress, accuracyProgress);
    remaining = `${title.part}题 ${total} / ${req.minSamples} 题 · 正确率 ${Math.round(acc * 100)}% / ${Math.round(req.minAccuracy * 100)}%`;
  }

  return { title, progress: Math.round(progress * 1000) / 1000, remaining };
}

/** 评估全部称号：返回已解锁与未解锁（含进度） */
export function evaluateTitles(input: TitleInput): TitleEvaluation {
  const unlocked: TitleDef[] = [];
  const locked: TitleProgress[] = [];

  for (const title of TITLES) {
    const req = title.requirement;
    let met = false;

    if (title.part === '坚持') met = input.studyDays >= req.minSamples;
    else if (title.part === '复习') met = input.masteredWords >= req.minSamples;
    else if (title.part === '全卷') met = input.fullPaperCompleted && input.bestScore >= req.minSamples;
    else {
      const stat = input.partStats.find((s) => s.part === req.scope);
      met = !!stat && stat.total >= req.minSamples && accuracy(stat) >= req.minAccuracy;
    }

    if (met) unlocked.push(title);
    else locked.push(titleProgress(title, input));
  }

  // 未解锁按进度降序，界面先展示「快拿到」的
  locked.sort((a, b) => b.progress - a.progress || a.title.name.localeCompare(b.title.name));
  return { unlocked, locked };
}

/** 只返回本次**新**解锁的称号（与已解锁列表比较） */
export function newlyUnlocked(unlocked: TitleDef[], alreadyUnlocked: string[]): TitleDef[] {
  const known = new Set(alreadyUnlocked);
  return unlocked.filter((title) => !known.has(title.key));
}

/** 称号的展示文案 */
export function describeTitle(title: TitleDef): string {
  return `${title.name}（${title.condition}）`;
}
