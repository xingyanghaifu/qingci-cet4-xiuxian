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
import { filterByLexicon } from './lexicon-scope';
import { DEFAULT_LEXICON_ID } from './lexicon';

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
  /** 全部错题；传 lexiconId 时只返回该词库的（老记录无 lx → 归入默认词库） */
  all(lexiconId?: string | null): Promise<MistakeRecord[]>;
  get(id: string, lexiconId?: string | null): Promise<MistakeRecord | null>;
  put(record: MistakeRecord, lexiconId?: string | null): Promise<boolean>;
  /** 答错时调用：已有记录则累加错误次数并回到今日队列，否则新建 */
  recordWrong(input: NewMistakeInput, lexiconId?: string | null): Promise<MistakeRecord | null>;
  /** 复习反馈：应用 SM-2 并写一条复习日志 */
  rate(id: string, rating: ReviewRating, now?: Date, lexiconId?: string | null): Promise<ReviewOutcome | null>;
  due(limit?: number, now?: Date, lexiconId?: string | null): Promise<MistakeRecord[]>;
  summary(now?: Date, lexiconId?: string | null): Promise<MistakeSummary>;
  trend(days?: number, now?: Date, lexiconId?: string | null): Promise<MistakeTrendPoint[]>;
  forecast(days?: number, now?: Date, lexiconId?: string | null): Promise<Array<{ date: string; count: number }>>;
  remove(id: string): Promise<boolean>;
  clear(): Promise<void>;
}

export function createMistakeStore(factory?: MinimalFactory | null): MistakeStore {
  const idb = factory === undefined
    ? (typeof indexedDB !== 'undefined' ? (indexedDB as unknown as MinimalFactory) : null)
    : factory;

  /**
   * 词库作用域：空串 = 不过滤（v1.8.1 行为原样保留）。
   * 与 vocab-srs 的 `scopeOf` 同一口径，避免两处语义漂移。
   */
  const scopeOf = (lexiconId?: string | null): string => String(lexiconId == null ? '' : lexiconId).trim();

  /** 作用域主键：`<词库Id> <错题id>` */
  const scopedKey = (id: string, lexiconId: string): string => `${lexiconId} ${id}`;

  async function readScoped(id: string, lexiconId: string): Promise<MistakeRecord | null> {
    const row = await withStore(IDB_STORES.mistakesLex, 'readonly', (store) =>
      promisify<(MistakeRecord & { k?: string }) | undefined>(store.get(scopedKey(id, lexiconId))));
    return row || null;
  }

  async function readLegacy(id: string): Promise<MistakeRecord | null> {
    const row = await withStore(IDB_STORES.mistakes, 'readonly', (store) => promisify<MistakeRecord | undefined>(store.get(id)));
    return row || null;
  }

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

    /**
     * 全部错题。
     * 不指定词库 → 原样返回 mistakes 老仓（v1.8.1 行为）。
     * 指定词库 → 读 mistakesLex；CET-4 时额外并入老仓记录（用户既有错题不丢）。
     */
    async all(lexiconId?: string | null): Promise<MistakeRecord[]> {
      const scope = scopeOf(lexiconId);
      if (!scope) {
        const rows = await withStore(IDB_STORES.mistakes, 'readonly', (store) => promisify<MistakeRecord[]>(store.getAll()));
        return rows || [];
      }
      const scoped = await withStore(IDB_STORES.mistakesLex, 'readonly', (store) => promisify<MistakeRecord[]>(store.getAll()));
      const mine = filterByLexicon(scoped, scope);
      if (scope !== DEFAULT_LEXICON_ID) return mine;
      const legacy = await withStore(IDB_STORES.mistakes, 'readonly', (store) => promisify<MistakeRecord[]>(store.getAll()));
      const seen = new Set(mine.map((r) => r.id));
      return [...mine, ...(legacy || []).filter((r) => !seen.has(r.id))];
    },

    async get(id: string, lexiconId?: string | null): Promise<MistakeRecord | null> {
      const scope = scopeOf(lexiconId);
      if (!scope) return readLegacy(id);
      return (await readScoped(id, scope)) || (scope === DEFAULT_LEXICON_ID ? readLegacy(id) : null);
    },

    async put(record: MistakeRecord, lexiconId?: string | null): Promise<boolean> {
      const scope = scopeOf(lexiconId);
      const target = scope ? IDB_STORES.mistakesLex : IDB_STORES.mistakes;
      const row = scope ? { ...record, k: scopedKey(record.id, scope), lx: scope } : record;
      const ok = await withStore(target, 'readwrite', async (store) => {
        await promisify(store.put(row));
        return true;
      });
      return !!ok;
    },

    async recordWrong(input: NewMistakeInput, lexiconId?: string | null): Promise<MistakeRecord | null> {
      const scope = scopeOf(lexiconId);
      const fresh = createMistake(input);
      const existing = await this.get(fresh.id, scope);
      const next = existing ? bumpMistake(existing, { userAnswer: input.userAnswer, now: input.now }) : fresh;
      const ok = await this.put(next, scope);
      return ok ? next : null;
    },

    async rate(id: string, rating: ReviewRating, now: Date = new Date(), lexiconId?: string | null): Promise<ReviewOutcome | null> {
      const scope = scopeOf(lexiconId);
      const record = await this.get(id, scope);
      if (!record) return null;
      const outcome = applyReview(record, rating, now);
      const saved = await this.put(outcome.record, scope);
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

    async due(limit = 50, now: Date = new Date(), lexiconId?: string | null): Promise<MistakeRecord[]> {
      return dueQueue(await this.all(lexiconId), now, limit);
    },

    async summary(now: Date = new Date(), lexiconId?: string | null): Promise<MistakeSummary> {
      return summarizeMistakes(await this.all(lexiconId), now);
    },

    async trend(days = 7, now: Date = new Date(), lexiconId?: string | null): Promise<MistakeTrendPoint[]> {
      return mistakeTrend(await this.all(lexiconId), days, now);
    },

    async forecast(days = 7, now: Date = new Date(), lexiconId?: string | null): Promise<Array<{ date: string; count: number }>> {
      return forecast(await this.all(lexiconId), days, now);
    },

    async remove(id: string): Promise<boolean> {
      const ok = await withStore(IDB_STORES.mistakes, 'readwrite', async (store) => {
        await promisify(store.delete(id));
        return true;
      });
      return !!ok;
    },

    async clear(): Promise<void> {
      // 老仓 + 分词库仓都清：只清一半会留下看不见也删不掉的记录
      await withStore(IDB_STORES.mistakes, 'readwrite', async (store) => {
        await promisify(store.clear());
        return true;
      });
      await withStore(IDB_STORES.mistakesLex, 'readwrite', async (store) => {
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
