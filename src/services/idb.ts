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
 *   v5  + tribulations / inventory / qiLog / demons / encounters /
 *           spiritField / cave / duels / transmissions / sect
 *       —— 修炼生态四阶段（A 渡劫与灵石消费 / B 心魔与奇遇 / C 灵田洞府 /
 *          D 道友互动）一次性建仓；此后各阶段只写数据，不再改 schema
 *   v6  + vocabLex —— 多词库词汇 SRS（v1.8.2 阶段 A5）
 *       **纯新增仓，不动 vocab**：vocab 是 keyPath:'w' 的单键仓，一个单词
 *       最多一条记录，无法同时承载「CET-4 的 abandon」与「CET-6 的 abandon」。
 *       若改成复合键就必须删库重建 → 有丢既有进度的风险；
 *       因此另开 vocabLex（keyPath:'k' = `<词库Id><单词>`），
 *       老数据原地留在 vocab 里，读写时按词库合并（见 vocab-srs.ts）。
 */

export const IDB_NAME = 'qingci-offline';
export const IDB_VERSION = 6;

export const IDB_STORES = {
  datasets: 'datasets',
  mistakes: 'mistakes',
  reviews: 'reviews',
  meta: 'meta',
  vocab: 'vocab',
  // —— v1.8.2 多词库词汇 SRS（keyPath 'k' = `<lexiconId> <word>`）——
  // 与 vocab 并存：vocab 承接待机中的 v1.8.1 单键记录，vocabLex 承载按词库分开的记录
  vocabLex: 'vocabLex',
  // —— v1.8.2 多词库错题本（keyPath 'k' = `<lexiconId> <mistakeId>`）——
  mistakesLex: 'mistakesLex',
  attempts: 'attempts',
  reports: 'reports',
  // —— 修炼生态 v5（四阶段一次性建仓）——
  tribulations: 'tribulations',
  inventory: 'inventory',
  qiLog: 'qiLog',
  demons: 'demons',
  encounters: 'encounters',
  spiritField: 'spiritField',
  cave: 'cave',
  duels: 'duels',
  transmissions: 'transmissions',
  sect: 'sect',
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
  // v1.8.2：按词库分开的错题本。与 vocabLex 同理 —— mistakes 的 id 由题目内容
  // 哈希而来，同一题在 CET-4 与 CET-6 下会得到同一个 id，单键仓无法并存两条。
  if (!db.objectStoreNames.contains(IDB_STORES.mistakesLex)) {
    const store = db.createObjectStore(IDB_STORES.mistakesLex, { keyPath: 'k' });
    store.createIndex?.('lx', 'lx');
    store.createIndex?.('nextReviewAt', 'nextReviewAt');
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
  // v1.8.2：按词库分开的词汇 SRS。k = `<词库Id> <单词>`，允许同一单词在多个词库各有一条。
  // 不迁移 vocab 的存量数据 —— 老记录原地保留，读取时按 CET-4 口径合并（见 vocab-srs.ts）。
  if (!db.objectStoreNames.contains(IDB_STORES.vocabLex)) {
    const store = db.createObjectStore(IDB_STORES.vocabLex, { keyPath: 'k' });
    store.createIndex?.('lx', 'lx');
    store.createIndex?.('nextReviewAt', 'nextReviewAt');
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

  /* ── 修炼生态（v5）：四个阶段一次性建仓，后续阶段只写数据不再改 schema ──
   * inventory keyPath = id
   *   常驻道具：id = itemId（如 'talisman'）
   *   按词道具：id = itemId + ':' + targetId（如 'pill:about'）
   *   读取时按 itemId 前缀查询，按 targetId 定位具体记录
   */
  if (!db.objectStoreNames.contains(IDB_STORES.tribulations)) {
    db.createObjectStore(IDB_STORES.tribulations, { keyPath: 'id' });
  }
  if (!db.objectStoreNames.contains(IDB_STORES.inventory)) {
    // keyPath 组装规则见上方注释：常驻 = itemId；按词 = itemId:targetId
    db.createObjectStore(IDB_STORES.inventory, { keyPath: 'id' });
  }
  if (!db.objectStoreNames.contains(IDB_STORES.qiLog)) {
    const store = db.createObjectStore(IDB_STORES.qiLog, { autoIncrement: true });
    store.createIndex?.('timestamp', 'timestamp');
  }
  if (!db.objectStoreNames.contains(IDB_STORES.demons)) {
    const store = db.createObjectStore(IDB_STORES.demons, { keyPath: 'id' });
    store.createIndex?.('questionId', 'questionId');
    store.createIndex?.('level', 'level');
  }
  if (!db.objectStoreNames.contains(IDB_STORES.encounters)) {
    const store = db.createObjectStore(IDB_STORES.encounters, { keyPath: 'id' });
    store.createIndex?.('day', 'day');
  }
  if (!db.objectStoreNames.contains(IDB_STORES.spiritField)) {
    const store = db.createObjectStore(IDB_STORES.spiritField, { keyPath: 'id' });
    store.createIndex?.('plotIndex', 'plotIndex');
  }
  if (!db.objectStoreNames.contains(IDB_STORES.cave)) {
    db.createObjectStore(IDB_STORES.cave, { keyPath: 'id' });
  }
  if (!db.objectStoreNames.contains(IDB_STORES.duels)) {
    const store = db.createObjectStore(IDB_STORES.duels, { keyPath: 'id' });
    store.createIndex?.('startedAt', 'startedAt');
  }
  if (!db.objectStoreNames.contains(IDB_STORES.transmissions)) {
    const store = db.createObjectStore(IDB_STORES.transmissions, { keyPath: 'id' });
    store.createIndex?.('word', 'word');
  }
  if (!db.objectStoreNames.contains(IDB_STORES.sect)) {
    db.createObjectStore(IDB_STORES.sect, { keyPath: 'id' });
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
