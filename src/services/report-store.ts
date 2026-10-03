/**
 * 报告仓库（P1 任务 B）
 *
 * IndexedDB schema v3 → v4，新增两个仓库：
 *   attempts —— 每道题的作答流水（题型、部分、标签、对错、耗时、时间）
 *   reports  —— 每次模考的汇总报告
 *
 * 为什么要流水：薄弱点分析需要「按知识点标签的样本量」，只存总分是算不出来的；
 * 流水同时是后续同步到 Supabase 的最小单位（与账号体系解耦，先本地后云端）。
 */
import { IDB_STORES, openAppDatabase, promisify, type IdbStoreName, type MinimalFactory, type MinimalObjectStore } from './idb';
import type { AttemptRecord, PaperReportData } from '../types/report';

export interface ReportStore {
  available(): boolean;
  addAttempt(attempt: AttemptRecord): Promise<boolean>;
  addAttempts(attempts: AttemptRecord[]): Promise<number>;
  attempts(options?: { since?: Date; paperId?: string; limit?: number }): Promise<AttemptRecord[]>;
  addReport(report: PaperReportData): Promise<boolean>;
  reports(limit?: number): Promise<PaperReportData[]>;
  latestReport(): Promise<PaperReportData | null>;
  count(): Promise<{ attempts: number; reports: number }>;
  clear(): Promise<void>;
}

export function createReportStore(factory?: MinimalFactory | null): ReportStore {
  const idb = factory === undefined
    ? (typeof indexedDB !== 'undefined' ? (indexedDB as unknown as MinimalFactory) : null)
    : factory;

  async function withStore<T>(name: IdbStoreName, mode: 'readonly' | 'readwrite', fn: (store: MinimalObjectStore) => Promise<T>): Promise<T | null> {
    if (!idb) return null;
    try {
      const db = await openAppDatabase(idb);
      return await fn(db.transaction(name, mode).objectStore(name));
    } catch {
      return null;
    }
  }

  return {
    available(): boolean {
      return !!idb;
    },

    async addAttempt(attempt: AttemptRecord): Promise<boolean> {
      const ok = await withStore(IDB_STORES.attempts, 'readwrite', async (store) => {
        await promisify(store.put(attempt));
        return true;
      });
      return !!ok;
    },

    async addAttempts(attempts: AttemptRecord[]): Promise<number> {
      if (!attempts.length) return 0;
      const n = await withStore(IDB_STORES.attempts, 'readwrite', async (store) => {
        let saved = 0;
        for (const attempt of attempts) {
          await promisify(store.put(attempt));
          saved++;
        }
        return saved;
      });
      return n || 0;
    },

    async attempts(options = {}): Promise<AttemptRecord[]> {
      const rows = await withStore(IDB_STORES.attempts, 'readonly', (store) => promisify<AttemptRecord[]>(store.getAll()));
      let list = rows || [];
      if (options.since) {
        const ts = options.since.getTime();
        list = list.filter((a) => new Date(a.at).getTime() >= ts);
      }
      if (options.paperId) list = list.filter((a) => a.paperId === options.paperId);
      list.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
      return options.limit ? list.slice(-options.limit) : list;
    },

    async addReport(report: PaperReportData): Promise<boolean> {
      const ok = await withStore(IDB_STORES.reports, 'readwrite', async (store) => {
        await promisify(store.put(report));
        return true;
      });
      return !!ok;
    },

    async reports(limit = 20): Promise<PaperReportData[]> {
      const rows = await withStore(IDB_STORES.reports, 'readonly', (store) => promisify<PaperReportData[]>(store.getAll()));
      const list = (rows || []).sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
      return limit ? list.slice(0, limit) : list;
    },

    async latestReport(): Promise<PaperReportData | null> {
      const list = await this.reports(1);
      return list[0] || null;
    },

    async count(): Promise<{ attempts: number; reports: number }> {
      const a = await withStore(IDB_STORES.attempts, 'readonly', (store) => promisify<AttemptRecord[]>(store.getAll()));
      const r = await withStore(IDB_STORES.reports, 'readonly', (store) => promisify<PaperReportData[]>(store.getAll()));
      return { attempts: (a || []).length, reports: (r || []).length };
    },

    async clear(): Promise<void> {
      await withStore(IDB_STORES.attempts, 'readwrite', async (store) => {
        await promisify(store.clear());
        return true;
      });
      await withStore(IDB_STORES.reports, 'readwrite', async (store) => {
        await promisify(store.clear());
        return true;
      });
    },
  };
}

/** 由应用内题目对象生成作答流水（供模板埋点调用） */
export function attemptFromQuestion(
  question: { questionId?: string; bankKind?: string; kind?: string; memKind?: string; word?: string; part?: string; answer?: string },
  input: { correct: boolean; ms: number; paperId?: string; gate?: string; at?: Date; tags?: string[] },
): AttemptRecord {
  const kind = question.bankKind || question.memKind || question.kind || 'unknown';
  const part = question.part || partOfKind(kind);
  const tags = input.tags && input.tags.length ? input.tags : [kind];
  return {
    questionId: question.questionId || (question.word ? `w:${question.word}` : `anon:${kind}`),
    kind,
    part,
    tags,
    correct: input.correct,
    ms: Math.max(0, Math.round(input.ms || 0)),
    ...(input.paperId || input.gate ? { paperId: input.paperId || '' } : {}),
    at: (input.at || new Date()).toISOString(),
  };
}

/** 题型 → 部分（题库 kind 与词汇题型都覆盖） */
export function partOfKind(kind: string): string {
  switch (kind) {
    case 'news': case 'talk': case 'passage': case 'listen': return '听力';
    case 'bank': case 'match': case 'detail': case 'read': return '阅读';
    case 'trans': return '翻译';
    case 'write': return '写作';
    case 'speak': return '口语';
    default: return '词汇';
  }
}
