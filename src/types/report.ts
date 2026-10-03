/**
 * 模考报告与薄弱点分析的数据契约与聚合逻辑（P1 任务 B）
 *
 * 设计原则：
 *   1. **只用真实作答数据**，不做任何“估算/美化”；样本不足时明确标注「样本不足」。
 *   2. 薄弱点用 **Wilson 下界**排序，而不是裸正确率——1/1 全错与 9/10 全错不该同权重，
 *      下界能把「小样本的极值」压下去，避免推荐被偶然错误带偏。
 *   3. 结构全部可序列化，直接落 IndexedDB，后续可平滑同步到 Supabase。
 */

export interface AttemptRecord {
  /** 题目 id（题库题带 q_ 前缀；自由练习可能为空） */
  questionId: string;
  /** 题型（词汇题型或试卷门类） */
  kind: string;
  /** 所属部分：听力 / 阅读 / 翻译 / 写作 / 词汇 */
  part: string;
  /** 知识点标签（来自题库或运行时补标） */
  tags: string[];
  correct: boolean;
  /** 本题耗时（毫秒，未知填 0） */
  ms: number;
  /** 所属试卷（自由练习为空） */
  paperId?: string;
  /** 作答时间（ISO） */
  at: string;
}

export interface GateResult {
  gate: string;
  part: string;
  right: number;
  total: number;
  accuracy: number;
}

export interface PaperReportData {
  paperId: string;
  paperName: string;
  examId: string;
  examName: string;
  score: number;
  total: number;
  /** 目标分（默认取该考试的及格线） */
  targetScore: number;
  pass: boolean;
  passed: boolean;
  completed: boolean;
  answered: number;
  queueLength: number;
  gates: GateResult[];
  durationMs: number;
  avgMsPerQuestion: number;
  at: string;
}

export interface WeaknessInsight {
  key: string;
  /** 'kind' 按题型 ｜ 'part' 按部分 ｜ 'tag' 按知识点 */
  scope: 'kind' | 'part' | 'tag';
  label: string;
  total: number;
  correct: number;
  accuracy: number;
  /** Wilson 95% 下界 */
  lowerBound: number;
  /** 0–1，越大越该优先补 */
  weakness: number;
  severity: 'high' | 'medium' | 'low' | 'insufficient';
  advice: string;
}

export interface TrendPoint {
  date: string;
  total: number;
  correct: number;
  accuracy: number;
}

/** 本地日期键（避免 UTC 偏移导致日期错位） */
export function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Wilson 比例置信区间下界（z = 1.96，95%）
 * 公式：(p + z²/2n − z·√(p(1−p)/n + z²/4n²)) / (1 + z²/n)
 */
export function wilsonLowerBound(correct: number, total: number, z = 1.96): number {
  if (total <= 0) return 0;
  const p = correct / total;
  const n = total;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return Math.max(0, Math.min(1, (centre - spread) / denom));
}

/** 按某个维度聚合作答记录 */
export function groupAccuracy(attempts: AttemptRecord[], pick: (a: AttemptRecord) => string[]): Map<string, { total: number; correct: number }> {
  const map = new Map<string, { total: number; correct: number }>();
  for (const attempt of attempts) {
    for (const key of pick(attempt)) {
      if (!key) continue;
      const row = map.get(key) || { total: 0, correct: 0 };
      row.total++;
      if (attempt.correct) row.correct++;
      map.set(key, row);
    }
  }
  return map;
}

const KIND_LABELS: Record<string, string> = {
  en2zh: '英译中', zh2en: '中译英', listen: '听音辨词', similar: '形近辨析', spell: '拼写默写', pos: '词性判断',
  words: '词汇', news: '短篇新闻', talk: '长对话', passage: '听力篇章',
  bank: '选词填空', match: '段落匹配', detail: '仔细阅读', write: '写作', trans: '翻译', speak: '口语',
};

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] || kind;
}

/**
 * 识别薄弱点（题型 / 部分 / 知识点三个维度）
 * @param minSamples 低于该样本量标为「样本不足」，只提示不推荐
 */
export function detectWeaknesses(
  attempts: AttemptRecord[],
  options: { minSamples?: number; limit?: number } = {},
): WeaknessInsight[] {
  const minSamples = options.minSamples ?? 3;
  const rows: WeaknessInsight[] = [];

  const push = (scope: WeaknessInsight['scope'], key: string, label: string, stat: { total: number; correct: number }) => {
    const accuracy = stat.total ? stat.correct / stat.total : 0;
    const lowerBound = wilsonLowerBound(stat.correct, stat.total);
    // 样本越多越可信：样本量 < 10 时按比例打折
    const volumeWeight = Math.min(1, stat.total / 10);
    const weakness = Math.round((1 - lowerBound) * volumeWeight * 1000) / 1000;
    const severity: WeaknessInsight['severity'] = stat.total < minSamples
      ? 'insufficient'
      : weakness >= 0.55 ? 'high' : weakness >= 0.35 ? 'medium' : 'low';
    rows.push({
      key,
      scope,
      label,
      total: stat.total,
      correct: stat.correct,
      accuracy: Math.round(accuracy * 100) / 100,
      lowerBound: Math.round(lowerBound * 1000) / 1000,
      weakness,
      severity,
      advice: severity === 'insufficient'
        ? `样本不足（${stat.total} 题），先多练几题再判断`
        : `正确率 ${Math.round(accuracy * 100)}%（${stat.correct}/${stat.total}），建议针对「${label}」做 10–20 题专项`,
    });
  };

  for (const [kind, stat] of groupAccuracy(attempts, (a) => [a.kind])) push('kind', kind, kindLabel(kind), stat);
  for (const [part, stat] of groupAccuracy(attempts, (a) => [a.part])) push('part', part, part, stat);
  for (const [tag, stat] of groupAccuracy(attempts, (a) => a.tags)) push('tag', tag, tag, stat);

  return rows
    .filter((row) => row.severity !== 'insufficient' || row.total > 0)
    .sort((a, b) => b.weakness - a.weakness || b.total - a.total || a.label.localeCompare(b.label))
    .slice(0, options.limit ?? 12);
}

/** 近 N 日正确率趋势（按本地日期聚合） */
export function accuracyTrend(attempts: AttemptRecord[], days = 7, now: Date = new Date()): TrendPoint[] {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const byDate = new Map<string, { total: number; correct: number }>();
  for (const attempt of attempts) {
    const key = localDateKey(new Date(attempt.at));
    const row = byDate.get(key) || { total: 0, correct: 0 };
    row.total++;
    if (attempt.correct) row.correct++;
    byDate.set(key, row);
  }
  const points: TrendPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(start.getTime() - i * 86_400_000);
    const key = localDateKey(day);
    const row = byDate.get(key) || { total: 0, correct: 0 };
    points.push({
      date: key,
      total: row.total,
      correct: row.correct,
      accuracy: row.total ? Math.round((row.correct / row.total) * 100) / 100 : 0,
    });
  }
  return points;
}

/** 耗时分布：按部分统计平均耗时与占比 */
export function timingByPart(attempts: AttemptRecord[]): Array<{ part: string; total: number; avgMs: number; share: number }> {
  const map = new Map<string, { total: number; ms: number }>();
  let allMs = 0;
  for (const attempt of attempts) {
    if (!attempt.ms) continue;
    const row = map.get(attempt.part) || { total: 0, ms: 0 };
    row.total++;
    row.ms += attempt.ms;
    allMs += attempt.ms;
    map.set(attempt.part, row);
  }
  return [...map.entries()]
    .map(([part, row]) => ({
      part,
      total: row.total,
      avgMs: Math.round(row.ms / row.total),
      share: allMs ? Math.round((row.ms / allMs) * 100) / 100 : 0,
    }))
    .sort((a, b) => b.avgMs - a.avgMs);
}

/** 组装一次模考的报告 */
export function buildPaperReport(input: {
  paperId: string;
  paperName: string;
  examId: string;
  examName: string;
  score: number;
  total: number;
  /** 目标分（默认取及格线） */
  targetScore?: number;
  /** 及格线 */
  passLine: number;
  passed: boolean;
  completed: boolean;
  queue: Array<{ gate: string; part?: string }>;
  answered: number;
  got: Record<string, number>;
  durationMs?: number;
  attempts?: AttemptRecord[];
  at?: Date;
}): PaperReportData {
  const gateTotals = new Map<string, number>();
  for (const item of input.queue) gateTotals.set(item.gate, (gateTotals.get(item.gate) || 0) + 1);
  const gates: GateResult[] = [...gateTotals.entries()].map(([gate, total]) => {
    const right = Math.max(0, Math.min(total, input.got[gate] || 0));
    return {
      gate,
      part: partOfGate(gate),
      right,
      total,
      accuracy: total ? Math.round((right / total) * 100) / 100 : 0,
    };
  });

  const attempts = input.attempts || [];
  const answeredMs = attempts.reduce((sum, a) => sum + (a.ms || 0), 0);
  const answeredCount = attempts.length || input.answered || 0;
  const durationMs = input.durationMs ?? answeredMs;

  return {
    paperId: input.paperId,
    paperName: input.paperName,
    examId: input.examId,
    examName: input.examName,
    score: input.score,
    total: input.total,
    targetScore: input.targetScore ?? input.passLine,
    // pass = 得分是否不低于目标分；passed = 是否完成整套且达线（与应用的突破口径一致）
    pass: input.score >= (input.targetScore ?? input.passLine),
    passed: input.passed,
    completed: input.completed,
    answered: input.answered,
    queueLength: input.queue.length,
    gates,
    durationMs,
    avgMsPerQuestion: answeredCount ? Math.round(durationMs / answeredCount) : 0,
    at: (input.at || new Date()).toISOString(),
  };
}

/** 门类 → 部分 */
export function partOfGate(gate: string): string {
  switch (gate) {
    case 'news': case 'talk': case 'passage': case 'listen': return '听力';
    case 'bank': case 'match': case 'detail': case 'read': return '阅读';
    case 'trans': return '翻译';
    case 'write': return '写作';
    case 'speak': return '口语';
    default: return '词汇';
  }
}

/** 与目标分对比（差多少、还差几题） */
export function compareWithTarget(report: PaperReportData): { diff: number; questionsNeeded: number; message: string } {
  const diff = report.score - report.targetScore;
  const perQuestion = report.queueLength ? report.total / report.queueLength : 0;
  const questionsNeeded = diff >= 0 || perQuestion <= 0 ? 0 : Math.ceil(-diff / perQuestion);
  const message = diff >= 0
    ? `高于目标 ${diff} 分`
    : `距目标还差 ${-diff} 分（约再答对 ${questionsNeeded} 题）`;
  return { diff, questionsNeeded, message };
}

/** 报告摘要（一行文案，用于卡片标题区） */
export function describeReport(report: PaperReportData): string {
  const { message } = compareWithTarget(report);
  return `${report.examName} · ${report.score}/${report.total} · ${report.passed || report.pass ? '达线' : '未达线'} · ${message}`;
}
