/**
 * 错题仓库（IndexedDB，P0.2）
 *
 * 与 localStorage 的分工：
 *   - localStorage 仍是**学习进度**的权威存储（灵气、连对、每日任务等），schema 保持 v4 不变；
 *   - 错题本数据量会随练习持续增长（每条含题干与解析），因此放 IndexedDB，
 *     按 `nextReviewAt` / `type` 建索引，支持「今日到期」快速筛选。
 *   - 迁移是**只读旧数据、不改旧数据**：localStorage 里的心魔本原样保留，
 *     出错题本问题时删掉 IndexedDB 即可重来。
 */
import { IDB_STORES, openAppDatabase, promisify, type IdbStoreName, type MinimalFactory, type MinimalObjectStore } from './idb';
import {
  bumpMistake,
  createMistake,
  summarizeMistakes,
  type MistakeRecord,
  type MistakeSummary,
  type NewMistakeInput,
  type ReviewRating,
} from '../types/mistakes';
import { applyReview, dueQueue, forecast, mistakeTrend, type MistakeTrendPoint, type ReviewOutcome } from './srs';

export interface ReviewLogEntry {
  mistakeId: string;
  rating: ReviewRating;
  quality: number;
  intervalDays: number;
  ease: number;
  at: string;
}

export interface MistakeStore {
  available(): boolean;
  all(): Promise<MistakeRecord[]>;
  get(id: string): Promise<MistakeRecord | null>;
  put(record: MistakeRecord): Promise<boolean>;
  /** 答错时调用：已有记录则累加错误次数并回到今日队列，否则新建 */
  recordWrong(input: NewMistakeInput): Promise<MistakeRecord | null>;
  /** 复习反馈：应用 SM-2 并写一条复习日志 */
  rate(id: string, rating: ReviewRating, now?: Date): Promise<ReviewOutcome | null>;
  due(limit?: number, now?: Date): Promise<MistakeRecord[]>;
  summary(now?: Date): Promise<MistakeSummary>;
  trend(days?: number, now?: Date): Promise<MistakeTrendPoint[]>;
  forecast(days?: number, now?: Date): Promise<Array<{ date: string; count: number }>>;
  remove(id: string): Promise<boolean>;
  clear(): Promise<void>;
}

export function createMistakeStore(factory?: MinimalFactory | null): MistakeStore {
  const idb = factory === undefined
    ? (typeof indexedDB !== 'undefined' ? (indexedDB as unknown as MinimalFactory) : null)
    : factory;

  async function withStore<T>(
    name: IdbStoreName,
    mode: 'readonly' | 'readwrite',
    fn: (store: MinimalObjectStore) => Promise<T>,
  ): Promise<T | null> {
    if (!idb) return null;
    try {
      const db = await openAppDatabase(idb);
      const store = db.transaction(name, mode).objectStore(name);
      return await fn(store);
    } catch {
      return null;
    }
  }

  return {
    available(): boolean {
      return !!idb;
    },

    async all(): Promise<MistakeRecord[]> {
      const rows = await withStore(IDB_STORES.mistakes, 'readonly', (store) => promisify<MistakeRecord[]>(store.getAll()));
      return rows || [];
    },

    async get(id: string): Promise<MistakeRecord | null> {
      const row = await withStore(IDB_STORES.mistakes, 'readonly', (store) => promisify<MistakeRecord | undefined>(store.get(id)));
      return row || null;
    },

    async put(record: MistakeRecord): Promise<boolean> {
      const ok = await withStore(IDB_STORES.mistakes, 'readwrite', async (store) => {
        await promisify(store.put(record));
        return true;
      });
      return !!ok;
    },

    async recordWrong(input: NewMistakeInput): Promise<MistakeRecord | null> {
      const fresh = createMistake(input);
      const existing = await this.get(fresh.id);
      const next = existing ? bumpMistake(existing, { userAnswer: input.userAnswer, now: input.now }) : fresh;
      const ok = await this.put(next);
      return ok ? next : null;
    },

    async rate(id: string, rating: ReviewRating, now: Date = new Date()): Promise<ReviewOutcome | null> {
      const record = await this.get(id);
      if (!record) return null;
      const outcome = applyReview(record, rating, now);
      const saved = await this.put(outcome.record);
      if (!saved) return null;
      await withStore(IDB_STORES.reviews, 'readwrite', async (store) => {
        const log: ReviewLogEntry = {
          mistakeId: id,
          rating,
          quality: outcome.quality,
          intervalDays: outcome.intervalDays,
          ease: outcome.record.ease,
          at: now.toISOString(),
        };
        await promisify(store.put(log));
        return true;
      });
      return outcome;
    },

    async due(limit = 50, now: Date = new Date()): Promise<MistakeRecord[]> {
      return dueQueue(await this.all(), now, limit);
    },

    async summary(now: Date = new Date()): Promise<MistakeSummary> {
      return summarizeMistakes(await this.all(), now);
    },

    async trend(days = 7, now: Date = new Date()): Promise<MistakeTrendPoint[]> {
      return mistakeTrend(await this.all(), days, now);
    },

    async forecast(days = 7, now: Date = new Date()): Promise<Array<{ date: string; count: number }>> {
      return forecast(await this.all(), days, now);
    },

    async remove(id: string): Promise<boolean> {
      const ok = await withStore(IDB_STORES.mistakes, 'readwrite', async (store) => {
        await promisify(store.delete(id));
        return true;
      });
      return !!ok;
    },

    async clear(): Promise<void> {
      await withStore(IDB_STORES.mistakes, 'readwrite', async (store) => {
        await promisify(store.clear());
        return true;
      });
      await withStore(IDB_STORES.reviews, 'readwrite', async (store) => {
        await promisify(store.clear());
        return true;
      });
    },
  };
}
