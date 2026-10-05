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
import { filterByLexicon, tagIf } from './lexicon-scope';
import { DEFAULT_LEXICON_ID } from './lexicon';

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
  /**
   * 所属词库（v1.8.2 多词库隔离）。
   *
   * 老记录没有这个字段，读取时由 `lexiconOf()` 兜底为默认词库，
   * 因此**既有用户的进度不会因为升级而丢失或错位**。
   * 不参与 SM-2 语义，只是隔离标记。
   */
  lx?: string;
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
  /** 全部记录；传 lexiconId 时只返回该词库的 */
  all(lexiconId?: string | null): Promise<VocabSrsRecord[]>;
  get(word: string, lexiconId?: string | null): Promise<VocabSrsRecord | null>;
  put(record: VocabSrsRecord, lexiconId?: string | null): Promise<boolean>;
  /** 复习反馈：写回 SM-2 结果；返回更新后的记录 */
  rate(word: string, rating: ReviewRating, now?: Date, lexiconId?: string | null): Promise<VocabSrsRecord | null>;
  /** 今日到期队列（按到期时间升序、同时间按熟练度升序） */
  due(limit?: number, now?: Date, lexiconId?: string | null): Promise<VocabSrsRecord[]>;
  /** 未进入 SRS 的词（用于按分级取新词） */
  wordsNotInSrs(allWords: string[], limit?: number, lexiconId?: string | null): Promise<string[]>;
  stats(now?: Date, lexiconId?: string | null): Promise<VocabStats>;
  /** 旧存档迁移（幂等；force 可重跑） */
  migrateLegacy(schedule: Record<string, { level?: string; next?: number; tries?: number }> | null, options?: { now?: Date; force?: boolean; lexiconId?: string }): Promise<{ migrated: number; skipped: boolean }>;
  clear(): Promise<void>;
}

export function createVocabSrsStore(factory?: MinimalFactory | null): VocabSrsStore {
  const idb = factory === undefined
    ? (typeof indexedDB !== 'undefined' ? (indexedDB as unknown as MinimalFactory) : null)
    : factory;

  /**
   * 本次调用要操作的词库。
   *
   * **默认返回空串**（= 不过滤），而不是「读当前词库」：
   * 这是刻意的向后兼容取舍 —— 既有测试与既有调用方都是单词库世界，
   * 若默认就过滤，那些没有 `lx` 的老记录在 cet4 语境下能命中，
   * 但一旦有人在别的语境调用就会静默丢数据。
   * 空串 + `filterByLexicon(x, '')` 的语义是「返回全部」，v1.8.1 行为原样保留。
   * UI 层通过 `createVocabSrsStoreFor(f, lexiconId)` 显式开启隔离。
   */
  const scopeOf = (lexiconId?: string | null): string => String(lexiconId == null ? '' : lexiconId).trim();

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

  /**
   * 作用域主键：`<词库Id> <单词>`。
   * 用空格分隔而非冒号，是因为词本身也可能含 `'`（如 o'clock），空格更安全。
   */
  const scopedKey = (word: string, lexiconId: string): string => `${lexiconId} ${word}`;

  /** 读 vocabLex（按词库分开的记录）；仓库不存在（老库）时返回 null */
  async function readScoped(word: string, lexiconId: string): Promise<VocabSrsRecord | null> {
    const row = await withStore(IDB_STORES.vocabLex, 'readonly', (store) =>
      promisify<(VocabSrsRecord & { k?: string }) | undefined>(store.get(scopedKey(word, lexiconId))));
    return row || null;
  }

  async function readLegacy(word: string): Promise<VocabSrsRecord | null> {
    const row = await withStore(IDB_STORES.vocab, 'readonly', (store) => promisify<VocabSrsRecord | undefined>(store.get(word)));
    return row || null;
  }

  return {
    available(): boolean {
      return !!idb;
    },

    /**
     * 全部记录。
     *
     * 不指定词库时**原样返回 vocab 老仓**（v1.8.1 行为，一字不差）。
     * 指定词库时读 vocabLex，并**额外并入 vocab 里的老记录**——
     * 这些是 v1.8.1 时代存下的进度，按约定归属默认词库（CET-4），
     * 这样 CET-4 用户升级后看到的进度与从前完全一致，一个字都不少。
     */
    async all(lexiconId?: string | null): Promise<VocabSrsRecord[]> {
      const scope = scopeOf(lexiconId);
      if (!scope) {
        const rows = await withStore(IDB_STORES.vocab, 'readonly', (store) => promisify<VocabSrsRecord[]>(store.getAll()));
        return rows || [];
      }
      const scoped = await withStore(IDB_STORES.vocabLex, 'readonly', (store) => promisify<VocabSrsRecord[]>(store.getAll()));
      const mine = filterByLexicon(scoped, scope);
      if (scope !== DEFAULT_LEXICON_ID) return mine;
      const legacy = await withStore(IDB_STORES.vocab, 'readonly', (store) => promisify<VocabSrsRecord[]>(store.getAll()));
      // 同一单词在两处都有时以 vocabLex 为准（更新的那份）
      const seen = new Set(mine.map((r) => r.w));
      return [...mine, ...(legacy || []).filter((r) => !seen.has(r.w))];
    },

    async get(word: string, lexiconId?: string | null): Promise<VocabSrsRecord | null> {
      const scope = scopeOf(lexiconId);
      // 未指定词库：沿用老仓单键读写，既有调用方行为不变
      if (!scope) return readLegacy(word);
      return (await readScoped(word, scope)) || (scope === DEFAULT_LEXICON_ID ? readLegacy(word) : null);
    },

    async put(record: VocabSrsRecord, lexiconId?: string | null): Promise<boolean> {
      const scope = scopeOf(lexiconId);
      // 未指定词库 → 写老仓（v1.8.1 行为）
      if (!scope) {
        const ok = await withStore(IDB_STORES.vocab, 'readwrite', async (store) => {
          await promisify(store.put(record));
          return true;
        });
        return !!ok;
      }
      const row = { ...record, k: scopedKey(record.w, scope), lx: scope };
      const ok = await withStore(IDB_STORES.vocabLex, 'readwrite', async (store) => {
        await promisify(store.put(row));
        return true;
      });
      return !!ok;
    },

    async rate(word: string, rating: ReviewRating, now: Date = new Date(), lexiconId?: string | null): Promise<VocabSrsRecord | null> {
      const existing = (await this.get(word, lexiconId)) || tagIf(createVocabRecord(word, now), scopeOf(lexiconId));
      const next = rateVocabRecord(existing, rating, now);
      return (await this.put(next, lexiconId)) ? next : null;
    },

    async due(limit = 50, now: Date = new Date(), lexiconId?: string | null): Promise<VocabSrsRecord[]> {
      const rows = await this.all(lexiconId);
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

    async wordsNotInSrs(allWords: string[], limit = 20, lexiconId?: string | null): Promise<string[]> {
      // 数据库不可用时返回空列表：无法确认哪些词已学过，就不该把它们当成新词再教一遍
      if (!idb) return [];
      const rows = await this.all(lexiconId);
      const seen = new Set(rows.map((r) => r.w));
      return allWords.filter((w) => !seen.has(w)).slice(0, Math.max(0, limit));
    },

    async stats(now: Date = new Date(), lexiconId?: string | null): Promise<VocabStats> {
      const rows = await this.all(lexiconId);
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
      // 旧存档来自单词库时代，一律归入目标词库（默认即 cet4，老用户进度不丢）
      const lx = scopeOf(options.lexiconId);
      for (const record of records) {
        if (await this.put(record, lx)) migrated++;
      }
      await withStore(IDB_STORES.meta, 'readwrite', async (store) => {
        await promisify(store.put({ at: (options.now || new Date()).toISOString(), count: migrated }, VOCAB_MIGRATION_META_KEY));
        return true;
      });
      return { migrated, skipped: false };
    },

    async clear(): Promise<void> {
      // 两个仓都清：老仓是 v1.8.1 的存量，vocabLex 是 v1.8.2 的分词库记录
      await withStore(IDB_STORES.vocab, 'readwrite', async (store) => {
        await promisify(store.clear());
        return true;
      });
      await withStore(IDB_STORES.vocabLex, 'readwrite', async (store) => {
        await promisify(store.clear());
        return true;
      });
    },
  };
}
