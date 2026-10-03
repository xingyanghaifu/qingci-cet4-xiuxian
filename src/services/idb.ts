/**
 * IndexedDB 连接与 schema 升级（全应用共用同一个数据库）
 *
 * 为什么集中管理：IndexedDB 的版本号是**整个数据库**共享的，
 * 若两个模块分别用不同版本 open 同一个库，后打开的那个会直接 VersionError。
 * 因此所有对象仓库都在这里声明，业务模块只通过 openAppDatabase() 拿连接。
 *
 * 版本历史：
 *   v1  datasets                     —— 内联词库 / 试卷 / 题库缓存
 *   v2  + mistakes / reviews / meta  —— 错题本与复习记录（P0.2）
 *   v3  + vocab                      —— 词汇 SRS 状态（P1 任务 A）
 *   v4  + attempts / reports         —— 作答流水与模考报告（P1 任务 B）
 */

export const IDB_NAME = 'qingci-offline';
export const IDB_VERSION = 4;

export const IDB_STORES = {
  datasets: 'datasets',
  mistakes: 'mistakes',
  reviews: 'reviews',
  meta: 'meta',
  vocab: 'vocab',
  attempts: 'attempts',
  reports: 'reports',
} as const;

export type IdbStoreName = (typeof IDB_STORES)[keyof typeof IDB_STORES];

/** 最小可用接口：只声明本应用真正用到的 API，便于在 Node 中用桩件测试 */
export interface MinimalRequest<T = unknown> {
  onsuccess: ((this: unknown, ev: unknown) => void) | null;
  onerror: ((this: unknown, ev: unknown) => void) | null;
  result?: T;
}

export interface MinimalObjectStore {
  put(value: unknown, key?: string): MinimalRequest;
  get(key: string): MinimalRequest;
  getAll(): MinimalRequest;
  delete(key: string): MinimalRequest;
  clear(): MinimalRequest;
  index(name: string): { getAll(query?: unknown): MinimalRequest };
}

export interface MinimalTransaction {
  objectStore(name: string): MinimalObjectStore;
}

export interface MinimalDatabase {
  objectStoreNames: { contains(name: string): boolean };
  createObjectStore(name: string, options?: { keyPath?: string; autoIncrement?: boolean }): {
    createIndex?(name: string, keyPath: string, options?: { unique?: boolean }): unknown;
  };
  transaction(name: string, mode?: string): MinimalTransaction;
  close(): void;
}

export interface MinimalFactory {
  open(name: string, version: number): {
    onsuccess: ((ev: unknown) => void) | null;
    onerror: ((ev: unknown) => void) | null;
    onupgradeneeded: ((ev: unknown) => void) | null;
    result: MinimalDatabase;
  };
}

/** 把 IDBRequest 包成 Promise（调用方声明期望的结果类型） */
export function promisify<T>(req: MinimalRequest<unknown>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(new Error('IndexedDB 请求失败'));
  });
}

/** 默认工厂：浏览器里的 indexedDB；不可用（隐私模式/Node）时为 null */
export function defaultFactory(): MinimalFactory | null {
  try {
    return typeof indexedDB !== 'undefined' ? (indexedDB as unknown as MinimalFactory) : null;
  } catch {
    return null;
  }
}

let cached: { factory: MinimalFactory; promise: Promise<MinimalDatabase> } | null = null;

/** 执行 schema 升级：按需创建缺失的对象仓库与索引 */
export function upgradeSchema(db: MinimalDatabase): void {
  if (!db.objectStoreNames.contains(IDB_STORES.datasets)) {
    db.createObjectStore(IDB_STORES.datasets);
  }
  if (!db.objectStoreNames.contains(IDB_STORES.mistakes)) {
    const store = db.createObjectStore(IDB_STORES.mistakes, { keyPath: 'id' });
    store.createIndex?.('nextReviewAt', 'nextReviewAt');
    store.createIndex?.('type', 'type');
  }
  if (!db.objectStoreNames.contains(IDB_STORES.reviews)) {
    const store = db.createObjectStore(IDB_STORES.reviews, { autoIncrement: true });
    store.createIndex?.('mistakeId', 'mistakeId');
  }
  if (!db.objectStoreNames.contains(IDB_STORES.meta)) {
    db.createObjectStore(IDB_STORES.meta);
  }
  if (!db.objectStoreNames.contains(IDB_STORES.vocab)) {
    const store = db.createObjectStore(IDB_STORES.vocab, { keyPath: 'w' });
    store.createIndex?.('nextReviewAt', 'nextReviewAt');
    store.createIndex?.('tier', 'tier');
  }
  if (!db.objectStoreNames.contains(IDB_STORES.attempts)) {
    // 作答流水：自增主键，按时间/题型建索引，便于趋势与薄弱点聚合
    const store = db.createObjectStore(IDB_STORES.attempts, { autoIncrement: true });
    store.createIndex?.('at', 'at');
    store.createIndex?.('kind', 'kind');
    store.createIndex?.('paperId', 'paperId');
  }
  if (!db.objectStoreNames.contains(IDB_STORES.reports)) {
    const store = db.createObjectStore(IDB_STORES.reports, { keyPath: 'at' });
    store.createIndex?.('paperId', 'paperId');
  }
}

/** 打开（并按需升级）应用数据库；同一 factory 复用连接 */
export function openAppDatabase(factory?: MinimalFactory | null): Promise<MinimalDatabase> {
  const idb = factory === undefined ? defaultFactory() : factory;
  if (!idb) return Promise.reject(new Error('IndexedDB 不可用'));
  if (cached && cached.factory === idb) return cached.promise;

  const promise = new Promise<MinimalDatabase>((resolve, reject) => {
    const req = idb.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => upgradeSchema(req.result);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error('打开离线数据库失败'));
  }).catch((err) => {
    cached = null;
    throw err;
  });

  cached = { factory: idb, promise };
  return promise;
}

/** 取一个对象仓库（内部用；业务模块请走各自 service） */
export async function storeOf(name: IdbStoreName, mode: 'readonly' | 'readwrite', factory?: MinimalFactory | null): Promise<MinimalObjectStore> {
  const db = await openAppDatabase(factory);
  return db.transaction(name, mode).objectStore(name);
}

/** 仅测试用：清掉连接缓存 */
export function __resetIdbCache(): void {
  cached = null;
}
