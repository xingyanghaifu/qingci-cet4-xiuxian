/**
 * 词汇 SRS 仓库（P1 任务 A）
 *
 * 与错题本的关系：
 *   - **共用调度引擎**：都走 `src/services/srs.ts` 的 SM-2（`scheduleNext`）；
 *   - **队列分开**：错题本存 `mistakes`（按题目 id），词汇存 `vocab`（按单词），
 *     互不影响：错题本复习答错不会污染词汇间隔，反之亦然。
 *
 * 迁移：旧存档的 `state.schedule`（固定间隔 0.25/1/3/7 天）会一次性换算为 SM-2 初值，
 * 只读不改旧数据；完成后在 `meta` 里记标记，重复启动不重复导入。
 */
import { IDB_STORES, openAppDatabase, promisify, type IdbStoreName, type MinimalFactory, type MinimalObjectStore } from './idb';
import { DEFAULT_EASE, proficiencyOf, type ReviewRating } from '../types/mistakes';
import { RELEARN_INTERVAL_DAYS, localDateKey, scheduleNext } from './srs';
import { tierOf, type VocabTier } from './vocab-grades';

export const VOCAB_MIGRATION_META_KEY = 'vocab-legacy-migration';

export interface VocabSrsRecord {
  /** 单词（主键） */
  w: string;
  tier: VocabTier;
  ease: number;
  intervalDays: number;
  repetitions: number;
  /** 下次复习时间（ISO） */
  nextReviewAt: string;
  lastReviewedAt?: string;
  /** 累计复习次数 */
  reviews: number;
  /** 遗忘次数（评级为「忘记」的次数） */
  lapses: number;
  /** 熟练度 0–5（派生字段，便于排序与展示） */
  proficiency: number;
  /** 记录来源：legacy = 旧存档迁移，srs = 新调度产生 */
  source: 'legacy' | 'srs';
}

export interface VocabStats {
  total: number;
  due: number;
  byTier: Array<{ tier: VocabTier; total: number; due: number; avgProficiency: number }>;
  /** 未来 7 天复习量 */
  forecast: Array<{ date: string; count: number }>;
}

/** 旧 level → SM-2 初值（与错题本迁移保持一致的口径） */
const LEVEL_TO_SRS: Record<string, { ease: number; intervalDays: number; repetitions: number }> = {
  again: { ease: 2.3, intervalDays: RELEARN_INTERVAL_DAYS, repetitions: 0 },
  hard: { ease: 2.4, intervalDays: 1, repetitions: 1 },
  good: { ease: 2.5, intervalDays: 3, repetitions: 2 },
  easy: { ease: 2.7, intervalDays: 7, repetitions: 2 },
};

const DAY_MS = 86_400_000;

/** 新建一条词汇 SRS 记录 */
export function createVocabRecord(word: string, now: Date = new Date(), source: 'legacy' | 'srs' = 'srs'): VocabSrsRecord {
  return {
    w: word,
    tier: tierOf(word),
    ease: DEFAULT_EASE,
    intervalDays: 0,
    repetitions: 0,
    nextReviewAt: now.toISOString(),
    reviews: 0,
    lapses: 0,
    proficiency: 0,
    source,
  };
}

/** 应用一次反馈（纯函数） */
export function rateVocabRecord(record: VocabSrsRecord, rating: ReviewRating, now: Date = new Date()): VocabSrsRecord {
  const outcome = scheduleNext(
    { ease: record.ease, intervalDays: record.intervalDays, repetitions: record.repetitions },
    rating,
    now,
  );
  const next: VocabSrsRecord = {
    ...record,
    ease: outcome.ease,
    intervalDays: outcome.intervalDays,
    repetitions: outcome.repetitions,
    nextReviewAt: outcome.nextReviewAt,
    lastReviewedAt: now.toISOString(),
    reviews: record.reviews + 1,
    lapses: record.lapses + (outcome.quality < 3 ? 1 : 0),
  };
  next.proficiency = proficiencyOf({
    repetitions: next.repetitions,
    ease: next.ease,
    wrongCount: next.lapses,
    intervalDays: next.intervalDays,
  });
  return next;
}

/** 旧存档 schedule → 词汇 SRS 记录（纯函数，便于测试） */
export function planLegacyVocabMigration(
  schedule: Record<string, { level?: string; next?: number; tries?: number }> | null | undefined,
  now: Date = new Date(),
): VocabSrsRecord[] {
  if (!schedule || typeof schedule !== 'object') return [];
  const nowIso = now.toISOString();
  return Object.keys(schedule).flatMap((word) => {
    const entry = schedule[word];
    if (!entry || typeof entry !== 'object') return [];
    const preset = LEVEL_TO_SRS[String(entry.level || '')] || undefined;
    const ease = preset ? preset.ease : DEFAULT_EASE;
    const intervalDays = preset ? preset.intervalDays : 0;
    const repetitions = preset ? preset.repetitions : 0;
    const legacyNext = typeof entry.next === 'number' ? entry.next : now.getTime();
    const record: VocabSrsRecord = {
      w: word,
      tier: tierOf(word),
      ease,
      intervalDays,
      repetitions,
      nextReviewAt: new Date(Math.max(now.getTime(), legacyNext)).toISOString(),
      lastReviewedAt: nowIso,
      reviews: typeof entry.tries === 'number' ? entry.tries : 0,
      lapses: 0,
      proficiency: 0,
      source: 'legacy',
    };
    record.proficiency = proficiencyOf({ repetitions, ease, wrongCount: 0, intervalDays });
    return [record];
  });
}

export interface VocabSrsStore {
  available(): boolean;
  all(): Promise<VocabSrsRecord[]>;
  get(word: string): Promise<VocabSrsRecord | null>;
  put(record: VocabSrsRecord): Promise<boolean>;
  /** 复习反馈：写回 SM-2 结果；返回更新后的记录 */
  rate(word: string, rating: ReviewRating, now?: Date): Promise<VocabSrsRecord | null>;
  /** 今日到期队列（按到期时间升序、同时间按熟练度升序） */
  due(limit?: number, now?: Date): Promise<VocabSrsRecord[]>;
  /** 未进入 SRS 的词（用于按分级取新词） */
  wordsNotInSrs(allWords: string[], limit?: number): Promise<string[]>;
  stats(now?: Date): Promise<VocabStats>;
  /** 旧存档迁移（幂等；force 可重跑） */
  migrateLegacy(schedule: Record<string, { level?: string; next?: number; tries?: number }> | null, options?: { now?: Date; force?: boolean }): Promise<{ migrated: number; skipped: boolean }>;
  clear(): Promise<void>;
}

export function createVocabSrsStore(factory?: MinimalFactory | null): VocabSrsStore {
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

  async function readMark(): Promise<{ at: string; count: number } | null> {
    const row = await withStore(IDB_STORES.meta, 'readonly', (store) => promisify<{ at: string; count: number } | undefined>(store.get(VOCAB_MIGRATION_META_KEY)));
    return row || null;
  }

  return {
    available(): boolean {
      return !!idb;
    },

    async all(): Promise<VocabSrsRecord[]> {
      const rows = await withStore(IDB_STORES.vocab, 'readonly', (store) => promisify<VocabSrsRecord[]>(store.getAll()));
      return rows || [];
    },

    async get(word: string): Promise<VocabSrsRecord | null> {
      const row = await withStore(IDB_STORES.vocab, 'readonly', (store) => promisify<VocabSrsRecord | undefined>(store.get(word)));
      return row || null;
    },

    async put(record: VocabSrsRecord): Promise<boolean> {
      const ok = await withStore(IDB_STORES.vocab, 'readwrite', async (store) => {
        await promisify(store.put(record, record.w));
        return true;
      });
      return !!ok;
    },

    async rate(word: string, rating: ReviewRating, now: Date = new Date()): Promise<VocabSrsRecord | null> {
      const existing = (await this.get(word)) || createVocabRecord(word, now);
      const next = rateVocabRecord(existing, rating, now);
      return (await this.put(next)) ? next : null;
    },

    async due(limit = 50, now: Date = new Date()): Promise<VocabSrsRecord[]> {
      const rows = await this.all();
      const ts = now.getTime();
      return rows
        .filter((r) => new Date(r.nextReviewAt).getTime() <= ts)
        .sort((a, b) => {
          const diff = new Date(a.nextReviewAt).getTime() - new Date(b.nextReviewAt).getTime();
          if (diff !== 0) return diff;
          return a.proficiency - b.proficiency;
        })
        .slice(0, Math.max(0, limit));
    },

    async wordsNotInSrs(allWords: string[], limit = 20): Promise<string[]> {
      // 数据库不可用时返回空列表：无法确认哪些词已学过，就不该把它们当成新词再教一遍
      if (!idb) return [];
      const rows = await this.all();
      const seen = new Set(rows.map((r) => r.w));
      return allWords.filter((w) => !seen.has(w)).slice(0, Math.max(0, limit));
    },

    async stats(now: Date = new Date()): Promise<VocabStats> {
      const rows = await this.all();
      const ts = now.getTime();
      const tiers: VocabTier[] = ['high', 'core', 'low', 'recognition'];
      const byTier = tiers.map((tier) => {
        const list = rows.filter((r) => r.tier === tier);
        const dueCount = list.filter((r) => new Date(r.nextReviewAt).getTime() <= ts).length;
        return {
          tier,
          total: list.length,
          due: dueCount,
          avgProficiency: list.length ? Math.round((list.reduce((s, r) => s + r.proficiency, 0) / list.length) * 10) / 10 : 0,
        };
      }).filter((row) => row.total > 0);

      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const forecast = Array.from({ length: 7 }, (_, i) => {
        const day = new Date(start.getTime() + i * DAY_MS);
        const next = new Date(day.getTime() + DAY_MS);
        return {
          date: localDateKey(day),
          count: rows.filter((r) => {
            const t = new Date(r.nextReviewAt).getTime();
            return t >= day.getTime() && t < next.getTime();
          }).length,
        };
      });

      return {
        total: rows.length,
        due: rows.filter((r) => new Date(r.nextReviewAt).getTime() <= ts).length,
        byTier,
        forecast,
      };
    },

    async migrateLegacy(schedule, options = {}): Promise<{ migrated: number; skipped: boolean }> {
      if (!idb) return { migrated: 0, skipped: true };
      if (!options.force) {
        const mark = await readMark();
        if (mark) return { migrated: 0, skipped: true };
      }
      const records = planLegacyVocabMigration(schedule, options.now || new Date());
      let migrated = 0;
      for (const record of records) {
        if (await this.put(record)) migrated++;
      }
      await withStore(IDB_STORES.meta, 'readwrite', async (store) => {
        await promisify(store.put({ at: (options.now || new Date()).toISOString(), count: migrated }, VOCAB_MIGRATION_META_KEY));
        return true;
      });
      return { migrated, skipped: false };
    },

    async clear(): Promise<void> {
      await withStore(IDB_STORES.vocab, 'readwrite', async (store) => {
        await promisify(store.clear());
        return true;
      });
    },
  };
}
