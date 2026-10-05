/**
 * 题库服务（P0.3 运行时）
 *
 * 职责：
 *   1. 读取 `question-bank.json`：内存 → IndexedDB（离线仓库 datasets.question-bank）→ 网络，
 *      拿到后回写 IndexedDB，之后断网也能组卷。
 *   2. 记录近期做过的题目 id（防重复：短期内不再抽到同一题）。
 *   3. 组卷：把 PracticeSpec 交给 selectPracticeSet，并把题库题目**适配成应用现有的题目结构**，
 *      这样随机练习可以直接复用既有的答题 / 判分 / 错题本链路。
 */
import { DATASET_KEYS, createOfflineStore, type OfflineStore } from './offline-store';
import {
  BANK_SCHEMA,
  normalizeBank,
  questionType,
  selectPracticeSet,
  type BankQuestion,
  type PracticeSet,
  type PracticeSpec,
  type QuestionBank,
} from '../types/question-bank';

export const BANK_URL = 'question-bank.json';
/** 近期做过的题目 id（防重复窗口） */
export const RECENT_IDS_KEY = 'qingci.bank.recent';
export const RECENT_WINDOW = 300;

/* ---------- v1.9.0 中学题库（按词库分目录、分片） ---------- */

/** 考试题库清单（manifest.json）结构：题型分片 + 可直接组卷的模拟卷构成 */
export const EXAM_BANK_SCHEMA = 'qingci-exam-bank/1';
export interface ExamBankMeta {
  schema: string;
  lexicon: string;
  exam: string;
  counts: { total: number; byKind: Record<string, number> };
  kinds: Record<string, { file: string; count: number }>;
  papers: Record<string, { name?: string; structure?: Record<string, number>; ids: string[] }>;
  papersIndex?: string[];
}

/**
 * 词库 → 考试题库清单 URL。
 * 默认词库（CET-4）没有单独的考试题库：它用单文件 `question-bank.json`，
 * 保持 v1.8.x 行为一字不变；其余词库各带一份分片题库。
 * 返回 null 表示「用默认题库」。
 */
export function examBankUrlFor(lexiconId?: string | null): string | null {
  const id = String(lexiconId == null ? '' : lexiconId).trim();
  if (!id || id === 'cet4') return null;
  return `lexicons/${id}/question-bank/manifest.json`;
}

/** 应用内题目结构（与模板中 show() 期望的字段一致） */
export interface AppQuestion {
  kind: string;
  title: string;
  prompt: string;
  sub: string;
  choices: string[];
  answer: string;
  explain: string;
  word?: string;
  memKind?: string;
  speak?: string;
  passage?: string;
  write?: boolean;
  min?: number;
  max?: number;
  sample?: string;
  tpl?: string;
  hint?: number;
  /** 固化题库里的题目 id，用于错题本关联与防重复 */
  questionId?: string;
  bankKind?: string;
  part?: string;
  /** 知识点标签（透传题库标签，供报告做薄弱点分析） */
  tags?: string[];
}

export interface BankServiceOptions {
  fetchImpl?: typeof fetch | null;
  store?: OfflineStore | null;
  storage?: { getItem(key: string): string | null; setItem(key: string, value: string): void } | null;
  now?: () => Date;
}

export interface BankService {
  available(): boolean;
  /** 载入题库（带缓存），失败返回 null 由调用方降级 */
  load(): Promise<QuestionBank | null>;
  /** 当前内存中的题库 */
  current(): QuestionBank | null;
  /**
   * 题库来源跟随词库（v1.9.0 阶段 A/B）。
   * 默认词库继续用单文件 question-bank.json（行为与 v1.8.x 一致）；
   * 其余词库切过去后 load() 会取 `lexicons/<id>/question-bank/` 的分片。
   * 切换会丢弃内存里上一个词库的题库，避免「初中练习抽到四级题」。
   */
  setLexicon(lexiconId: string | null): void;
  /** 当前题库所属词库 */
  lexicon(): string;
  /** 当前词库的考试题库清单（含模拟卷构成）；默认词库为 null */
  examMeta(): ExamBankMeta | null;
  recentIds(): string[];
  rememberUsage(ids: string[]): void;
  /** 组卷：自动带入近期已做题目作为排除集 */
  buildPracticeSet(spec?: PracticeSpec): PracticeSet | null;
  /** 题库题目 → 应用题目结构 */
  toAppQuestion(question: BankQuestion, index?: number): AppQuestion;
}

export function createBankService(options: BankServiceOptions = {}): BankService {
  const doFetch = options.fetchImpl === undefined
    ? (typeof fetch !== 'undefined' ? fetch : null)
    : options.fetchImpl;
  const store = options.store === undefined
    ? (typeof indexedDB !== 'undefined' ? createOfflineStore(undefined, 'bank') : null)
    : options.store;
  const storage = options.storage === undefined
    ? (typeof localStorage !== 'undefined' ? localStorage : null)
    : options.storage;

  let bank: QuestionBank | null = null;
  let loading: Promise<QuestionBank | null> | null = null;
  /** 当前题库来源词库：默认 cet4 → 单文件题库（v1.8.x 行为一字不变） */
  let bankLexicon = 'cet4';
  /** 中学考试题库清单（仅非默认词库有值） */
  let examMeta: ExamBankMeta | null = null;

  function readRecent(): string[] {
    try {
      const raw = storage?.getItem(RECENT_IDS_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  /**
   * 默认词库：IndexedDB 缓存 → 网络回填。
   * 逻辑与 v1.8.x 逐行一致，只把「loading 复位」收口到统一出口。
   */
  async function loadDefaultBank(): Promise<QuestionBank | null> {
    try {
      const cached = await store?.loadDataset<unknown>(DATASET_KEYS.questionBank);
      const normalized = cached ? normalizeBank(cached.value) : null;
      if (normalized) {
        bank = normalized;
        loading = null;
        return bank;
      }
    } catch {
      /* 忽略缓存读取失败 */
    }
    if (!doFetch) {
      loading = null;
      return null;
    }
    try {
      const res = await doFetch(BANK_URL, { cache: 'no-cache' });
      if (!res.ok) return null;
      const raw = await res.json();
      const normalized = normalizeBank(raw);
      if (!normalized) return null;
      bank = normalized;
      try {
        await store?.saveDataset(DATASET_KEYS.questionBank, raw, { version: normalized.version });
      } catch {
        /* 缓存失败不影响本次使用 */
      }
      return bank;
    } catch {
      return null;
    } finally {
      loading = null;
    }
  }

  /**
   * 中学题库（v1.9.0）：清单 + 各题型分片，合并成一个 QuestionBank。
   *
   * 不写 IndexedDB：分片是同源静态资源，Service Worker 已做
   * stale-while-revalidate（看过一次即离线可读），再落一层 IDB 只会让
   * 缓存键随词库数量膨胀。内存里只保留**当前词库**的题库。
   */
  async function loadExamBank(id: string): Promise<QuestionBank | null> {
    const url = examBankUrlFor(id);
    if (!url || !doFetch) {
      loading = null;
      return null;
    }
    try {
      const res = await doFetch(url, { cache: 'force-cache' });
      if (!res.ok) return null;
      const meta = (await res.json()) as ExamBankMeta;
      if (!meta || meta.schema !== EXAM_BANK_SCHEMA || !meta.kinds) return null;
      const base = url.slice(0, url.lastIndexOf('/') + 1);
      const questions: BankQuestion[] = [];
      for (const kind of Object.keys(meta.kinds)) {
        const file = meta.kinds[kind] && meta.kinds[kind].file;
        if (!file) continue;
        const r = await doFetch(base + file, { cache: 'force-cache' });
        if (!r.ok) return null;
        const shard = (await r.json()) as { questions?: BankQuestion[] };
        if (Array.isArray(shard.questions)) questions.push(...shard.questions);
      }
      if (!questions.length) return null;
      const byKind: Record<string, number> = {};
      for (const q of questions) byKind[q.kind] = (byKind[q.kind] || 0) + 1;
      const merged = normalizeBank({
        schema: BANK_SCHEMA,
        version: '1.0.0',
        counts: { total: questions.length, byType: {}, byKind },
        papers: Object.fromEntries(
          Object.entries(meta.papers || {}).map(([k, v]) => [k, (v && v.ids) || []]),
        ),
        questions,
      });
      if (!merged) return null;
      bank = merged;
      examMeta = meta;
      return bank;
    } catch {
      return null;
    } finally {
      loading = null;
    }
  }

  return {
    available(): boolean {
      return !!doFetch || !!store;
    },

    current(): QuestionBank | null {
      return bank;
    },

    setLexicon(id: string | null): void {
      const next = String(id == null ? '' : id).trim() || 'cet4';
      if (next === bankLexicon) return;
      bankLexicon = next;
      // 丢弃上一个词库的题库：宁可重新 fetch，也不能让「初中练习」抽到四级题
      bank = null;
      loading = null;
      examMeta = null;
    },

    lexicon(): string {
      return bankLexicon;
    },

    examMeta(): ExamBankMeta | null {
      return examMeta;
    },

    async load(): Promise<QuestionBank | null> {
      if (bank) return bank;
      if (loading) return loading;
      loading = bankLexicon === 'cet4' ? loadDefaultBank() : loadExamBank(bankLexicon);
      return loading;
    },

    recentIds(): string[] {
      return readRecent();
    },

    rememberUsage(ids: string[]): void {
      if (!ids.length || !storage) return;
      try {
        const merged = [...ids, ...readRecent().filter((id) => !ids.includes(id))].slice(0, RECENT_WINDOW);
        storage.setItem(RECENT_IDS_KEY, JSON.stringify(merged));
      } catch {
        /* 隐私模式等场景忽略 */
      }
    },

    buildPracticeSet(spec: PracticeSpec = {}): PracticeSet | null {
      if (!bank) return null;
      const excludeIds = [...new Set([...(spec.excludeIds || []), ...readRecent()])];
      const result = selectPracticeSet(bank, { ...spec, excludeIds });
      this.rememberUsage(result.questions.map((q) => q.id));
      return result;
    },

    toAppQuestion(question: BankQuestion): AppQuestion {
      const c = question.content;
      const base = {
        prompt: c.prompt,
        sub: c.sub || '',
        choices: c.choices || [],
        answer: c.answer,
        explain: c.explain || '',
        questionId: question.id,
        bankKind: question.kind,
        part: question.part,
        tags: question.knowledgeTags,
      };
      const type = questionType(question);

      if (type === 'vocab') {
        if (question.kind === 'spell') {
          return { ...base, kind: 'spell', memKind: 'spell', title: '随机练习 · 拼写默写', tpl: c.tpl, hint: c.hint, word: c.answer };
        }
        const memKind = question.kind;
        const titleMap: Record<string, string> = {
          en2zh: '英译中', similar: '形近辨析', listen: '听音辨词', pos: '词性判断', zh2en: '中译英',
        };
        return {
          ...base,
          kind: 'words',
          memKind,
          title: '随机练习 · ' + (titleMap[memKind] || '词汇'),
          word: memKind === 'en2zh' || memKind === 'listen' ? c.answer : base.choices.includes(c.answer) ? c.answer : undefined,
          ...(question.audioMeta?.text ? { speak: question.audioMeta.text } : {}),
        };
      }

      // 试卷快照题
      switch (question.kind) {
        case 'write':
          return { ...base, kind: 'write', title: '随机练习 · 写作', write: true, min: c.min ?? 120, max: c.max ?? 180 };
        case 'trans':
          return { ...base, kind: 'trans', title: '随机练习 · 翻译', write: true, min: c.min ?? 5, max: c.max ?? 30, sample: c.sample };
        case 'news':
        case 'talk':
        case 'passage':
          return { ...base, kind: question.kind, title: '随机练习 · 听力', passage: c.passage, speak: question.audioMeta?.text || c.passage, word: undefined };
        // v1.9.0 中学题库（中考 / 高考）：自带篇章与分组，按题型给标题
        case 'writing':
          return {
            ...base, kind: 'write', title: '随机练习 · 书面表达', write: true,
            min: c.min ?? 60, max: c.max ?? 100, sample: c.sample, passage: c.passage,
          };
        case 'continuation': // 高考读后续写：给定段落 + 续写要求
          return {
            ...base, kind: 'write', title: '随机练习 · 读后续写', write: true,
            min: c.min ?? 80, max: c.max ?? 120, sample: c.sample, passage: c.passage,
          };
        case 'grammar':
          return { ...base, kind: question.kind, title: '随机练习 · 语法选择', passage: c.passage, word: undefined };
        case 'cloze':
          return { ...base, kind: question.kind, title: '随机练习 · 完形填空', passage: c.passage, word: undefined };
        case 'bankfill':
          return { ...base, kind: question.kind, title: '随机练习 · 选词填空', passage: c.passage, word: undefined };
        case 'reading':
          return { ...base, kind: question.kind, title: '随机练习 · 阅读理解', passage: c.passage, word: undefined };
        case 'grammarfill':
          return { ...base, kind: question.kind, title: '随机练习 · 语法填空', passage: c.passage, word: undefined };
        case 'gapped':
          return { ...base, kind: question.kind, title: '随机练习 · 七选五', passage: c.passage, word: undefined };
        default:
          return {
            ...base,
            kind: question.kind,
            title: '随机练习 · ' + (c.choices && c.choices.length ? '选择' : '阅读'),
            passage: c.passage,
            word: undefined,
          };
      }
    },
  };
}
