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

  function readRecent(): string[] {
    try {
      const raw = storage?.getItem(RECENT_IDS_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  return {
    available(): boolean {
      return !!doFetch || !!store;
    },

    current(): QuestionBank | null {
      return bank;
    },

    async load(): Promise<QuestionBank | null> {
      if (bank) return bank;
      if (loading) return loading;
      loading = (async () => {
        // 1) IndexedDB 缓存（离线可用）
        try {
          const cached = await store?.loadDataset<unknown>(DATASET_KEYS.questionBank);
          const normalized = cached ? normalizeBank(cached.value) : null;
          if (normalized) {
            bank = normalized;
            return bank;
          }
        } catch {
          /* 忽略缓存读取失败 */
        }
        // 2) 网络拉取后回写缓存
        if (!doFetch) return null;
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
      })();
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
