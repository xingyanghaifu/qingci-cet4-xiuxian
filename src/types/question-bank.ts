/**
 * 固化题库与组卷算法（P0.3）
 *
 * 题库由 `scripts/build-question-bank.mjs` 在构建时生成（内容取自应用自身的生成器，
 * 不重写算法），产出 `question-bank.json`。本模块只负责**运行时**的读取校验与组卷：
 *
 *   1. 校验题库结构（版本、题目字段、试卷快照 id 列表）
 *   2. 按约束筛候选集（题型分布 / 难度区间 / 知识点 / 排除近期做过的题）
 *   3. 在候选集内做**加权随机抽题**（权重 = 区分度 × 难度贴合度 × 标签命中）
 *   4. 组卷结果按难度升序排布，形成由易到难的练习节奏
 *
 * 抽题使用带种子的 mulberry32，同一 seed 必然得到同一份卷子（可复现、可回看）。
 */

export interface BankContent {
  prompt: string;
  sub?: string;
  choices?: string[];
  answer: string;
  explain?: string;
  passage?: string;
  write?: boolean;
  min?: number;
  max?: number;
  sample?: string;
  /** 拼写题的占位模板 */
  tpl?: string;
  hint?: number;
}

export interface BankAudioMeta {
  kind: 'tts' | 'file';
  text?: string;
  url?: string;
  lang?: string;
}

export interface BankQuestion {
  id: string;
  kind: string;
  part?: string;
  paperId?: string;
  /** 0.2–0.8，越大越难 */
  difficulty: number;
  /** 区分度（当前为启发式先验，积累真实作答后校准） */
  discrimination: number;
  knowledgeTags: string[];
  content: BankContent;
  audioMeta?: BankAudioMeta;
}

export interface QuestionBank {
  schema: string;
  version: string;
  counts: { total: number; byType: Record<string, number>; byKind: Record<string, number> };
  papers: Record<string, string[]>;
  questions: BankQuestion[];
}

export const BANK_SCHEMA = 'qingci-question-bank/1';

/** 由 id 前缀推导题型（题库不逐条存 type 字段，省下近 20 万字节） */
export function questionType(question: Pick<BankQuestion, 'id'>): 'vocab' | 'paper' | 'unknown' {
  if (question.id.startsWith('q_vocab_')) return 'vocab';
  if (question.id.startsWith('q_paper_')) return 'paper';
  return 'unknown';
}

/** 校验题库结构；结构不符返回 null（调用方降级为内置生成器） */
export function normalizeBank(raw: unknown): QuestionBank | null {
  if (!raw || typeof raw !== 'object') return null;
  const bank = raw as Partial<QuestionBank>;
  if (bank.schema !== BANK_SCHEMA) return null;
  if (!Array.isArray(bank.questions) || !bank.questions.length) return null;
  const questions = bank.questions.filter((q): q is BankQuestion => (
    !!q
    && typeof q.id === 'string'
    && typeof q.kind === 'string'
    && typeof q.difficulty === 'number'
    && !!q.content
    && typeof q.content.prompt === 'string'
    && typeof q.content.answer === 'string'
  ));
  if (!questions.length) return null;
  return {
    schema: bank.schema,
    version: String(bank.version || '0'),
    counts: bank.counts || { total: questions.length, byType: {}, byKind: {} },
    papers: bank.papers && typeof bank.papers === 'object' ? bank.papers : {},
    questions,
  };
}

/** 确定性随机（mulberry32） */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PracticeSpec {
  /** 题目数量（默认 20） */
  count?: number;
  /** 只抽这些题型（如 ['en2zh','spell','detail']）；为空表示不限 */
  kinds?: string[];
  /** 只抽这些部分（听力 / 阅读 / 翻译 / 写作 / 词汇） */
  parts?: string[];
  /** 难度区间（默认 [0.2, 0.8]） */
  difficulty?: [number, number];
  /** 命中这些标签的题加权（如 ['paper:qingci'] 或 ['kind:spell']） */
  preferTags?: string[];
  /** 排除的题目 id（近期做过的题，防重复） */
  excludeIds?: string[];
  /** 题库快照限定（只抽某几套卷的题） */
  paperIds?: string[];
  /** 随机种子；相同种子 + 相同排除集 ⇒ 同一份卷子 */
  seed?: number;
  /** 组卷后是否按难度升序（默认 true，形成由易到难） */
  sortByDifficulty?: boolean;
}

/** 难度贴合度：越接近区间中点权重越高 */
function difficultyFit(difficulty: number, range: [number, number]): number {
  const [lo, hi] = range;
  if (hi <= lo) return 1;
  const mid = (lo + hi) / 2;
  const half = (hi - lo) / 2;
  return Math.max(0.15, 1 - Math.abs(difficulty - mid) / half * 0.6);
}

/** 单题权重（区分度 × 难度贴合 × 标签命中） */
export function weightOf(question: BankQuestion, spec: PracticeSpec = {}): number {
  const range = spec.difficulty || [0.2, 0.8];
  const base = 0.5 + Math.max(0, question.discrimination) * 1.5;
  const tagBoost = (spec.preferTags || []).some((tag) => question.knowledgeTags.includes(tag)) ? 1.4 : 1;
  return base * difficultyFit(question.difficulty, range) * tagBoost;
}

/** 按题型分组（用于满足题型分布约束） */
export function groupByKind(questions: BankQuestion[]): Map<string, BankQuestion[]> {
  const groups = new Map<string, BankQuestion[]>();
  for (const q of questions) {
    const list = groups.get(q.kind);
    if (list) list.push(q);
    else groups.set(q.kind, [q]);
  }
  return groups;
}

/** 带权不放回抽样 */
export function weightedSample(pool: BankQuestion[], n: number, rand: () => number, spec: PracticeSpec = {}): BankQuestion[] {
  const items = pool.slice();
  const weights = items.map((q) => weightOf(q, spec));
  const out: BankQuestion[] = [];
  const want = Math.min(n, items.length);
  for (let picked = 0; picked < want; picked++) {
    let total = 0;
    for (const w of weights) total += w;
    if (total <= 0) break;
    let target = rand() * total;
    let index = 0;
    for (; index < items.length; index++) {
      target -= weights[index];
      if (target <= 0) break;
    }
    if (index >= items.length) index = items.length - 1;
    out.push(items[index]);
    items.splice(index, 1);
    weights.splice(index, 1);
  }
  return out;
}

export interface PracticeSet {
  questions: BankQuestion[];
  /** 实际参与的题型分布 */
  kindMix: Record<string, number>;
  /** 难度均值 */
  avgDifficulty: number;
  /** 因排除/约束被过滤掉的数量 */
  filteredOut: number;
  seed: number;
}

/**
 * 组卷：先按约束筛候选集，再在候选集内**按题型均衡 + 加权随机**抽题
 */
export function selectPracticeSet(bank: QuestionBank, spec: PracticeSpec = {}): PracticeSet {
  const count = Math.max(1, spec.count ?? 20);
  const seed = spec.seed ?? 20261003;
  const exclude = new Set(spec.excludeIds || []);
  const range = spec.difficulty || [0.2, 0.8];
  const kinds = spec.kinds && spec.kinds.length ? new Set(spec.kinds) : null;
  const parts = spec.parts && spec.parts.length ? new Set(spec.parts) : null;
  const paperIds = spec.paperIds && spec.paperIds.length ? new Set(spec.paperIds) : null;

  let filteredOut = 0;
  const candidates = bank.questions.filter((q) => {
    if (exclude.has(q.id)) { filteredOut++; return false; }
    if (kinds && !kinds.has(q.kind)) { filteredOut++; return false; }
    if (parts && !parts.has(questionPart(q))) { filteredOut++; return false; }
    if (paperIds && !(q.paperId && paperIds.has(q.paperId))) { filteredOut++; return false; }
    if (q.difficulty < range[0] - 0.12 || q.difficulty > range[1] + 0.12) { filteredOut++; return false; }
    return true;
  });

  const rand = seededRng(seed);
  const groups = groupByKind(candidates);
  const kindList = [...groups.keys()].sort();

  // 先做题型均衡：每个题型至少分到一份，再按剩余额度轮转
  const quota = new Map<string, number>();
  const perKind = kindList.length ? Math.floor(count / kindList.length) : 0;
  let assigned = 0;
  for (const kind of kindList) {
    const take = Math.min(perKind, (groups.get(kind) || []).length);
    quota.set(kind, take);
    assigned += take;
  }
  let cursor = 0;
  while (assigned < count && kindList.length) {
    const kind = kindList[cursor % kindList.length];
    const pool = groups.get(kind) || [];
    const used = quota.get(kind) || 0;
    if (used < pool.length) {
      quota.set(kind, used + 1);
      assigned++;
    }
    cursor++;
    if (cursor > count * kindList.length + kindList.length) break; // 全部题型都已抽满
  }

  const picked: BankQuestion[] = [];
  for (const kind of kindList) {
    const pool = groups.get(kind) || [];
    picked.push(...weightedSample(pool, quota.get(kind) || 0, rand, spec));
  }

  const kindMix: Record<string, number> = {};
  for (const q of picked) kindMix[q.kind] = (kindMix[q.kind] || 0) + 1;
  const avgDifficulty = picked.length
    ? Math.round((picked.reduce((sum, q) => sum + q.difficulty, 0) / picked.length) * 100) / 100
    : 0;

  const questions = (spec.sortByDifficulty === false
    ? picked
    : picked.slice().sort((a, b) => a.difficulty - b.difficulty || a.id.localeCompare(b.id))).slice(0, count);

  return { questions, kindMix, avgDifficulty, filteredOut, seed };
}

/** 题型所属部分（听力 / 阅读 / 翻译 / 写作 / 词汇） */
export function questionPart(question: BankQuestion): string {
  if (question.part) {
    return { 听: '听力', 读: '阅读', 译: '翻译', 写: '写作' }[question.part] || question.part;
  }
  switch (question.kind) {
    case 'news': case 'talk': case 'passage': case 'listen': return '听力';
    case 'bank': case 'match': case 'detail': return '阅读';
    case 'trans': return '翻译';
    case 'write': return '写作';
    default: return '词汇';
  }
}
