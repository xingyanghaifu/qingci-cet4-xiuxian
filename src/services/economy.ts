/**
 * 灵石经济（修炼生态 · 阶段 A2）
 *
 * 职责：灵石收支 + 流水（qiLog）+ 道具库存（inventory）读写与效果缓存。
 *
 * 设计边界：
 * - **state 由模板传入**：TS 服务不能反向触达模板全局，余额随传随改（对象引用同步变更）；
 *   `spendSpirit`/`earnSpirit` 同步返回判定结果（购买/领取流程需要即时分支），
 *   流水落库（qiLog，append-only）异步执行、不阻塞 UI——失败静默，余额真值以 state 为准。
 * - `balanceAfter` 链式：每条流水记录落库时的余额快照，`listRecentTransactions` 可回放校验。
 * - 库存 keyPath 规则见 idb.ts 注释：常驻 = itemId（'talisman' / 'array'），
 *   按词 = itemId + ':' + targetId（'pill:about' / 'book:about'）。
 * - TTL 一律用时间戳（Date.now() + N * 86400000），日限如出现用 localDateKey。
 *
 * 与渡劫线的关系：
 * - tribulation.ts 的 `readInventorySummary` 是**卡片展示用只读视图**（它自己直读 inventory）；
 * - 本模块的 `refreshInventory` 缓存是**效果判定用**（聚灵阵×2、护道符抵扣、丹/书跳过与解锁），
 *   购买/消耗后自动刷新，启动时由模板调用一次。
 */
import { storeOf, promisify, type MinimalFactory } from './idb';

/* ───────────────── 数据模型 ───────────────── */

export interface QiTransaction {
  id?: number; // autoIncrement（qiLog）
  timestamp: string; // ISO
  /** 正数获得，负数消费 */
  amount: number;
  reason: string;
  balanceAfter: number;
}

export interface SpiritHost {
  spirit?: number;
}

export type PurchaseReason =
  | 'no-funds'
  | 'already-active'
  | 'already-owned'
  | 'invalid-word'
  | 'unknown-item'
  | 'written';

export interface PurchaseResult {
  ok: boolean;
  reason?: PurchaseReason;
  balanceAfter?: number;
}

/* ───────────────── 常量（可调参数集中于此） ───────────────── */

export const ARRAY_DURATION_MS = 24 * 60 * 60 * 1000; // 聚灵阵 24h
export const PILL_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 记忆丹 7 天

export interface CatalogItem {
  id: 'array' | 'talisman' | 'pill' | 'book';
  name: string;
  price: number;
  effect: string;
  /** 是否需要指定目标词 */
  needsTarget?: boolean;
}

/** 4 件新道具目录（商店渲染与测试共用同一事实源） */
export const ITEM_CATALOG: readonly CatalogItem[] = [
  { id: 'array', name: '聚灵阵', price: 100, effect: '24 小时内背词收益 ×2' },
  { id: 'talisman', name: '护道符', price: 150, effect: '抵挡一次渡劫失败的修为扣除' },
  { id: 'pill', name: '记忆丹', price: 80, effect: '指定词 7 天不进复习队列', needsTarget: true },
  { id: 'book', name: '参悟古籍', price: 50, effect: '解锁指定词的深度解析', needsTarget: true },
];

export function priceOf(itemId: string): number | null {
  const item = ITEM_CATALOG.find((it) => it.id === itemId);
  return item ? item.price : null;
}

/* ───────────────── 灵石收支 + 流水 ───────────────── */

let lastTxMs = 0;
/**
 * 严格单调递增的时间戳：同一毫秒内的多笔流水也能得到确定的倒序
 * （IndexedDB 的 autoIncrement 键不会写回 value，无法依赖 id 做二级排序）。
 */
function nextTimestamp(): string {
  const now = Date.now();
  lastTxMs = now > lastTxMs ? now : lastTxMs + 1;
  return new Date(lastTxMs).toISOString();
}

async function appendTx(tx: QiTransaction, factory?: MinimalFactory | null): Promise<void> {
  try {
    const store = await storeOf('qiLog', 'readwrite', factory);
    if (!store) return;
    await promisify<unknown>(store.put({ ...tx }));
  } catch {
    /* 流水失败静默：余额真值在 state，不因日志中断流程 */
  }
}

/** 扣灵石：余额不足 → {ok:false} 且**不写流水** */
export function spendSpirit(
  state: SpiritHost,
  amount: number,
  reason: string,
  factory?: MinimalFactory | null,
): { ok: boolean; balanceAfter: number } {
  const current = Math.max(0, Number(state.spirit) || 0);
  const cost = Math.max(0, Math.round(Number(amount) || 0));
  if (cost <= 0 || current < cost) return { ok: false, balanceAfter: current };
  const balanceAfter = current - cost;
  state.spirit = balanceAfter;
  void appendTx({ timestamp: nextTimestamp(), amount: -cost, reason, balanceAfter }, factory);
  return { ok: true, balanceAfter };
}

/** 得灵石（任务奖励/退款等），返回新余额 */
export function earnSpirit(
  state: SpiritHost,
  amount: number,
  reason: string,
  factory?: MinimalFactory | null,
): { balanceAfter: number } {
  const gain = Math.max(0, Math.round(Number(amount) || 0));
  const balanceAfter = (Math.max(0, Number(state.spirit) || 0)) + gain;
  state.spirit = balanceAfter;
  if (gain > 0) {
    void appendTx({ timestamp: nextTimestamp(), amount: gain, reason, balanceAfter }, factory);
  }
  return { balanceAfter };
}

export function getBalance(state: SpiritHost): number {
  return Math.max(0, Number(state.spirit) || 0);
}

/** 最近流水（新→旧） */
export async function listRecentTransactions(limit = 10, factory?: MinimalFactory | null): Promise<QiTransaction[]> {
  try {
    const store = await storeOf('qiLog', 'readonly', factory);
    if (!store) return [];
    const rows = await promisify<QiTransaction[]>(store.getAll());
    if (!Array.isArray(rows)) return [];
    return rows
      .slice()
      .sort((a, b) => {
        const t = String(b.timestamp).localeCompare(String(a.timestamp));
        if (t !== 0) return t;
        // 同毫秒写入：按自增 id 倒序兜底（保证顺序确定）
        const na = Number(a.id);
        const nb = Number(b.id);
        return Number.isFinite(na) && Number.isFinite(nb) ? nb - na : 0;
      })
      .slice(0, Math.max(0, limit));
  } catch {
    return [];
  }
}

/* ───────────────── 库存写侧 + 效果缓存 ───────────────── */

export interface InventoryEffectCache {
  talisman: number;
  arrayUntil: number; // ms 时间戳；0 = 未生效
  pills: Map<string, number>; // word -> expiresAt(ms)
  books: Set<string>; // 已解锁词
}

const cache: InventoryEffectCache = { talisman: 0, arrayUntil: 0, pills: new Map(), books: new Set() };

/** 从库存条目重建效果缓存（购买/消耗/启动时调用） */
export async function refreshInventory(factory?: MinimalFactory | null, now: number = Date.now()): Promise<InventoryEffectCache> {
  cache.talisman = 0;
  cache.arrayUntil = 0;
  cache.pills.clear();
  cache.books.clear();
  try {
    const store = await storeOf('inventory', 'readonly', factory);
    if (!store) return cache;
    const rows = await promisify<Array<{ id: string; count?: number; activeUntil?: string }>>(store.getAll());
    for (const row of Array.isArray(rows) ? rows : []) {
      const id = String(row.id || '');
      if (id === 'talisman') {
        cache.talisman = Math.max(0, Number(row.count) || 0);
      } else if (id === 'array') {
        const until = row.activeUntil ? Date.parse(row.activeUntil) : NaN;
        if (Number.isFinite(until) && until > now) cache.arrayUntil = until;
      } else if (id.startsWith('pill:')) {
        const until = row.activeUntil ? Date.parse(row.activeUntil) : NaN;
        if (Number.isFinite(until) && until > now) cache.pills.set(id.slice(5), until);
      } else if (id.startsWith('book:')) {
        cache.books.add(id.slice(5));
      }
    }
  } catch {
    /* 库存不可用 → 空缓存（效果静默关闭） */
  }
  return cache;
}

/** 聚灵阵是否生效（背词收益 ×2 的判定源） */
export function arrayActive(now: number = Date.now()): boolean {
  return cache.arrayUntil > now;
}

/** 护道符持有张数（渡劫抵扣判定源） */
export function talismanCount(): number {
  return cache.talisman;
}

/** 记忆丹覆盖中的词（SRS 复习队列 skip 源） */
export function activePillWords(now: number = Date.now()): string[] {
  return [...cache.pills.entries()].filter(([, until]) => until > now).map(([w]) => w);
}

/** 参悟古籍已解锁词（词库详情深度解析判定源） */
export function bookUnlocked(word: string): boolean {
  return cache.books.has(String(word || '').toLowerCase());
}
export function unlockedBookWords(): string[] {
  return [...cache.books];
}

async function inventoryStore(mode: 'readonly' | 'readwrite', factory?: MinimalFactory | null) {
  return storeOf('inventory', mode, factory);
}

/**
 * 购买：目录价扣灵石（流水）→ 写库存。
 * 库存写失败时回滚退款（补偿式，保证不出现“扣了钱没货”）。
 */
export async function purchase(
  state: SpiritHost,
  itemId: string,
  options: { targetId?: string; now?: number } = {},
  factory?: MinimalFactory | null,
): Promise<PurchaseResult> {
  const item = ITEM_CATALOG.find((it) => it.id === itemId);
  if (!item) return { ok: false, reason: 'unknown-item' };
  const now = options.now ?? Date.now();
  const target = item.needsTarget ? String(options.targetId || '').trim().toLowerCase() : '';
  if (item.needsTarget && !target) return { ok: false, reason: 'invalid-word' };

  // 按词道具：**先查重后扣费**——重复购买不产生任何扣款与流水（账本保持净额语义）
  if (target) {
    try {
      const probe = await inventoryStore('readonly', factory);
      if (probe) {
        const existing = await promisify<{ id: string } | undefined>(probe.get(`${itemId}:${target}`));
        if (existing) {
          return { ok: false, reason: itemId === 'pill' ? 'already-active' : 'already-owned' };
        }
      }
    } catch {
      /* 查重不可用时继续：写库阶段仍会以 put 覆盖兜底 */
    }
  }

  const paid = spendSpirit(state, item.price, `purchase_${itemId}`, factory);
  if (!paid.ok) return { ok: false, reason: 'no-funds', balanceAfter: paid.balanceAfter };

  try {
    const store = await inventoryStore('readwrite', factory);
    if (!store) throw new Error('inventory 不可用');
    if (itemId === 'talisman') {
      const prev = await promisify<{ id: string; count?: number } | undefined>(store.get('talisman'));
      const count = Math.max(0, Number(prev && prev.count) || 0) + 1;
      await promisify(store.put({ id: 'talisman', count }));
      cache.talisman = count;
    } else if (itemId === 'array') {
      const prev = await promisify<{ id: string; activeUntil?: string } | undefined>(store.get('array'));
      const prevUntil = prev && prev.activeUntil ? Date.parse(prev.activeUntil) : NaN;
      // 已生效 → 续期（叠在当前剩余之上），否则从现在起 24h
      const base = Number.isFinite(prevUntil) && prevUntil > now ? prevUntil : now;
      const activeUntil = new Date(base + ARRAY_DURATION_MS).toISOString();
      await promisify(store.put({ id: 'array', count: 1, activeUntil }));
      cache.arrayUntil = Date.parse(activeUntil);
    } else if (itemId === 'pill') {
      const id = `pill:${target}`;
      const activeUntil = new Date(now + PILL_DURATION_MS).toISOString();
      await promisify(store.put({ id, count: 1, targetId: target, activeUntil }));
      cache.pills.set(target, Date.parse(activeUntil));
    } else if (itemId === 'book') {
      const id = `book:${target}`;
      await promisify(store.put({ id, count: 1, targetId: target }));
      cache.books.add(target);
    }
    return { ok: true, reason: 'written', balanceAfter: paid.balanceAfter };
  } catch (e) {
    // 库存写失败 → 退款回滚
    const back = earnSpirit(state, item.price, `refund_${itemId}`, factory);
    return { ok: false, reason: 'unknown-item', balanceAfter: back.balanceAfter };
  }
}

/**
 * 无价发放（收获 / 任务奖励）：直接写库存，不扣灵石。
 * 与 purchase 的区别：无价格校验、无「已拥有」拦截（护道符按计数叠加）。
 */
export async function grantItem(
  itemId: string,
  targetId?: string,
  factory?: MinimalFactory | null,
  now: number = Date.now(),
): Promise<boolean> {
  try {
    const store = await inventoryStore('readwrite', factory);
    if (!store) return false;
    const target = targetId ? String(targetId).trim().toLowerCase() : '';
    const id = target ? `${itemId}:${target}` : itemId;
    const prev = await promisify<{ id: string; count?: number; activeUntil?: string } | undefined>(store.get(id));
    if (itemId === 'talisman') {
      const count = Math.max(0, Number(prev && prev.count) || 0) + 1;
      await promisify(store.put({ id: 'talisman', count }));
      cache.talisman = count;
    } else if (itemId === 'book' && target) {
      await promisify(store.put({ id, count: 1, targetId: target }));
      cache.books.add(target);
    } else if (itemId === 'pill' && target) {
      const activeUntil = new Date(now + PILL_DURATION_MS).toISOString();
      await promisify(store.put({ id, count: 1, targetId: target, activeUntil }));
      cache.pills.set(target, Date.parse(activeUntil));
    } else {
      await promisify(store.put({ id, count: Math.max(1, Number(prev && prev.count) || 0) }));
    }
    return true;
  } catch {
    return false;
  }
}

/** 渡劫失败消耗一张护道符（无货返回 false） */
export async function consumeTalisman(factory?: MinimalFactory | null): Promise<boolean> {
  if (cache.talisman <= 0) return false;
  try {
    const store = await inventoryStore('readwrite', factory);
    if (!store) return false;
    const prev = await promisify<{ id: string; count?: number } | undefined>(store.get('talisman'));
    const count = Math.max(0, Number(prev && prev.count) || 0);
    if (count <= 0) { cache.talisman = 0; return false; }
    const next = count - 1;
    if (next <= 0) await promisify(store.delete('talisman'));
    else await promisify(store.put({ id: 'talisman', count: next }));
    cache.talisman = next;
    return true;
  } catch {
    return false;
  }
}
