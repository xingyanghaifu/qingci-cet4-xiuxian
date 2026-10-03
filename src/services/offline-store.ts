/**
 * 离线数据仓库（IndexedDB）
 *
 * 为什么要它：词库（4540 条）与六套试卷是内联在单文件 HTML 里的 JSON，
 * 每次冷启动都要重新解析 ~300KB 文本。把解析结果按版本落到 IndexedDB，
 * 可以：
 *   1. 断网/弱网下秒开（外壳由 Service Worker 预缓存，数据由这里兜底）
 *   2. 为后续 P0.3 的固化题库（question-bank.json，可能 >1.5MB）提供按需缓存位
 *   3. 记录缓存版本与时间，便于发版后做失效与容量清理
 *
 * 设计约束：
 * - localStorage 仍是**唯一权威**的学习进度存储，本模块只缓存「可再生的数据」，
 *   因此清缓存不会丢进度，也不需要数据迁移。
 * - 浏览器禁用 IndexedDB（隐私模式等）时全部方法返回降级结果，不抛异常。
 * - IDB 工厂可注入，便于在 Node 中用轻量桩件做单元测试。
 */

export const OFFLINE_DB_NAME = 'qingci-offline';
export const OFFLINE_DB_VERSION = 1;
export const OFFLINE_STORE = 'datasets';

/** 仓库键名 */
export const DATASET_KEYS = {
  lexicon: 'lexicon',
  papers: 'papers',
  questionBank: 'question-bank',
  meta: 'meta',
} as const;

export type DatasetKey = (typeof DATASET_KEYS)[keyof typeof DATASET_KEYS];

export interface OfflineRecord<T = unknown> {
  key: DatasetKey;
  /** 写入时的应用版本（package.json 版本号） */
  version: string;
  cachedAt: string;
  items: number;
  bytes: number;
  value: T;
}

export interface OfflineStats {
  available: boolean;
  totalBytes: number;
  records: Array<Pick<OfflineRecord, 'key' | 'version' | 'cachedAt' | 'items' | 'bytes'>>;
}

/** 统计 JSON 数据的条目数（数组取长度，对象取键数） */
export function countItems(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value as Record<string, unknown>).length;
  return 0;
}

/** 估算 JSON 体积（UTF-8 字节），用于容量展示与清理决策 */
export function estimateBytes(value: unknown): number {
  let json = '';
  try {
    json = JSON.stringify(value) ?? '';
  } catch {
    return 0;
  }
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(json).length;
  // 退化估算：非 ASCII 字符按 3 字节计
  let bytes = 0;
  for (const ch of json) bytes += (ch.codePointAt(0) ?? 0) > 0x7f ? 3 : 1;
  return bytes;
}

/** 由记录集合生成统计信息（纯函数，便于测试） */
export function summarize(records: Array<OfflineRecord | null | undefined>, available = true): OfflineStats {
  const rows = records.filter((r): r is OfflineRecord => !!r);
  return {
    available,
    totalBytes: rows.reduce((sum, r) => sum + (r.bytes || 0), 0),
    records: rows.map((r) => ({ key: r.key, version: r.version, cachedAt: r.cachedAt, items: r.items, bytes: r.bytes })),
  };
}

/** 版本不一致时视为过期（发版后重新写入） */
export function isStale(record: OfflineRecord | null | undefined, currentVersion: string): boolean {
  return !record || record.version !== currentVersion;
}

type RequestHost = { onsuccess: ((this: unknown, ev: unknown) => void) | null; onerror: ((this: unknown, ev: unknown) => void) | null; result?: unknown };

interface MinimalObjectStore {
  put(value: unknown, key: string): RequestHost;
  get(key: string): RequestHost;
  getAll(): RequestHost;
  delete(key: string): RequestHost;
  clear(): RequestHost;
}

interface MinimalDatabase {
  objectStoreNames: { contains(name: string): boolean };
  createObjectStore(name: string): unknown;
  transaction(name: string, mode?: string): { objectStore(name: string): MinimalObjectStore };
  close(): void;
}

interface MinimalFactory {
  open(name: string, version: number): { onsuccess: ((ev: unknown) => void) | null; onerror: ((ev: unknown) => void) | null; onupgradeneeded: ((ev: unknown) => void) | null; result: MinimalDatabase };
}

function promisify<T>(req: RequestHost): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(new Error('IndexedDB 请求失败'));
  });
}

export interface OfflineStore {
  available(): boolean;
  saveDataset<T>(key: DatasetKey, value: T, options?: { version?: string }): Promise<boolean>;
  loadDataset<T>(key: DatasetKey): Promise<OfflineRecord<T> | null>;
  stats(): Promise<OfflineStats>;
  clear(): Promise<void>;
}

/**
 * 创建离线仓库
 * @param factory  IndexedDB 工厂（默认 globalThis.indexedDB；传 null 表示禁用）
 * @param version  当前应用版本，写入记录时一并保存
 */
export function createOfflineStore(factory?: MinimalFactory | null, version = 'dev'): OfflineStore {
  const idb = factory === undefined
    ? (typeof indexedDB !== 'undefined' ? (indexedDB as unknown as MinimalFactory) : null)
    : factory;

  let dbPromise: Promise<MinimalDatabase> | null = null;

  function openDb(): Promise<MinimalDatabase> {
    if (!idb) return Promise.reject(new Error('IndexedDB 不可用'));
    if (!dbPromise) {
      dbPromise = new Promise<MinimalDatabase>((resolve, reject) => {
        const req = idb.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(OFFLINE_STORE)) db.createObjectStore(OFFLINE_STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(new Error('打开离线数据库失败'));
      }).catch((err) => {
        dbPromise = null;
        throw err;
      });
    }
    return dbPromise;
  }

  async function store(mode: string): Promise<MinimalObjectStore> {
    const db = await openDb();
    return db.transaction(OFFLINE_STORE, mode).objectStore(OFFLINE_STORE);
  }

  return {
    available(): boolean {
      return !!idb;
    },

    async saveDataset<T>(key: DatasetKey, value: T, options?: { version?: string }): Promise<boolean> {
      if (!idb) return false;
      try {
        const record: OfflineRecord<T> = {
          key,
          // 允许调用方覆盖版本：cacheInlineDatasets 以「当前应用版本」为准，
          // 而不是仓库创建时的版本，否则版本升级后记录永远对不上、每次启动都会重写。
          version: options?.version || version,
          cachedAt: new Date().toISOString(),
          items: countItems(value),
          bytes: estimateBytes(value),
          value,
        };
        await promisify((await store('readwrite')).put(record, key));
        return true;
      } catch {
        return false;
      }
    },

    async loadDataset<T>(key: DatasetKey): Promise<OfflineRecord<T> | null> {
      if (!idb) return null;
      try {
        const record = await promisify<OfflineRecord<T> | undefined>((await store('readonly')).get(key));
        return record || null;
      } catch {
        return null;
      }
    },

    async stats(): Promise<OfflineStats> {
      if (!idb) return summarize([], false);
      try {
        const rows = await promisify<OfflineRecord[]>((await store('readonly')).getAll());
        return summarize(rows, true);
      } catch {
        return summarize([], false);
      }
    },

    async clear(): Promise<void> {
      if (!idb) return;
      try {
        await promisify((await store('readwrite')).clear());
      } catch {
        /* 忽略清理失败 */
      }
    },
  };
}

/** 页面内取 JSON 数据的最小依赖（便于测试注入） */
export interface DocumentLike {
  getElementById(id: string): { textContent: string | null } | null;
}

function readJsonScript(doc: DocumentLike, id: string): unknown | null {
  const el = doc.getElementById(id);
  if (!el || !el.textContent) return null;
  try {
    return JSON.parse(el.textContent) as unknown;
  } catch {
    return null;
  }
}

/**
 * 把页面内联的词库与试卷写入离线仓库（版本变化时才重写）
 * @returns 本次实际写入的键，以及是否命中版本缓存
 */
export async function cacheInlineDatasets(
  doc: DocumentLike,
  store: OfflineStore,
  version: string,
): Promise<{ saved: DatasetKey[]; reused: DatasetKey[]; skipped: DatasetKey[] }> {
  const saved: DatasetKey[] = [];
  const reused: DatasetKey[] = [];
  const skipped: DatasetKey[] = [];
  if (!store.available()) return { saved, reused, skipped: [DATASET_KEYS.lexicon, DATASET_KEYS.papers] };

  const plan: Array<{ key: DatasetKey; domId: string }> = [
    { key: DATASET_KEYS.lexicon, domId: 'lexicon' },
    { key: DATASET_KEYS.papers, domId: 'papers' },
  ];

  for (const item of plan) {
    const existing = await store.loadDataset(item.key);
    if (!isStale(existing, version)) {
      reused.push(item.key);
      continue;
    }
    const value = readJsonScript(doc, item.domId);
    if (value == null) {
      skipped.push(item.key);
      continue;
    }
    const ok = await store.saveDataset(item.key, value, { version });
    (ok ? saved : skipped).push(item.key);
  }
  return { saved, reused, skipped };
}
