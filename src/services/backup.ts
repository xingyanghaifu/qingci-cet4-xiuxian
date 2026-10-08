/**
 * 完整修行录备份（导出 / 导入）
 *
 * ── 为什么必须做这个（真实缺陷） ──
 * 原有「导出」只写 `JSON.stringify(state)` —— 也就是 **localStorage 里的那一份**。
 * 但修行数据实际上分散在两处：
 *
 *   · localStorage `qingci.state`：境界/修为/灵石/已斩获/错题词表/每日统计/模考记录…
 *   · **IndexedDB `qingci-offline`（17 个仓）**：心魔录、错题本与 SM-2 复习日志、
 *     词汇 SRS、库存（护道符/记忆丹/参悟古籍）、灵石流水、灵田、洞府装饰、
 *     道场、渡劫记录、对局、传功…
 *
 * 实测（真浏览器）：造出心魔 + 护道符 + 灵石流水 + 洞府装饰后走原导出，
 * 产物只有 562 B 的 localStorage，**上述 IDB 数据一条都不在里面**：
 *
 *     IDB 有数据的仓: cave=1, datasets=2, demons=1, inventory=1, meta=1, qiLog=2
 *     导出里缺失的仓: 全部
 *
 * 而 `docs/产品方案.md` 把「已提供导出/导入 JSON，建议提示用户定期备份」
 * 当作「localStorage 清缓存丢进度」这条风险的**唯一对策** ——
 * 也就是说：用户以为备份了，实际**心魔录、复习队列、库存、灵田、道场全都没备份**。
 * 这是本项目最严重的一类缺陷（静默丢用户数据），且与红线「不得造成用户数据丢失」直接冲突。
 *
 * ── 设计 ──
 *   · `collectBackup()`：把 localStorage state + 全部 IDB 仓打包成一个对象；
 *   · `applyBackup()`：按仓回写（**合并语义**：导入的键覆盖，未提及的键保留）；
 *   · **向后兼容**：旧版导出的纯 state 文件仍能导入（只恢复 state 部分）；
 *   · **格式带版本与标识**：`{ format: 'qingci-backup/1', version, exportedAt, state, stores }`
 *     —— 便于日后演进与校验，避免把无关 JSON 当备份导入；
 *   · 纯函数 + 可注入 factory：便于单测（Node 下用假 IDB）。
 *
 * ── 三条红线 ──
 *   1. **不丢数据**：导入是合并而非清空；损坏的仓跳过并如实报告，不静默丢弃；
 *   2. **不制造焦虑**：只做备份，不因「很久没备份」弹警告或限制功能；
 *   3. **不侵入学习**：备份/恢复不触碰 SM-2 判定逻辑本身，只是搬运数据。
 */
import { IDB_NAME, IDB_VERSION, IDB_STORES, openAppDatabase, promisify } from './idb';

/** 备份格式标识（用于识别与版本演进） */
export const BACKUP_FORMAT = 'qingci-backup/1';

/** 旧版导出（纯 state）也能识别：无 format 字段但有 state 形状 */
export interface BackupFile {
  format: string;
  version: number;
  exportedAt: string;
  /** localStorage 里的修行录 */
  state: Record<string, unknown> | null;
  /** IndexedDB 各仓（仓名 → 记录数组） */
  stores: Record<string, unknown[]>;
}

export interface CollectOptions {
  /** localStorage 读取（默认全局 localStorage） */
  storage?: { getItem(k: string): string | null } | null;
  /** localStorage 的键名（默认 qingci.state） */
  stateKey?: string;
  factory?: Parameters<typeof openAppDatabase>[0];
  now?: number;
  /** 不导出这些仓（例如纯缓存类，导出无意义还增大体积） */
  skipStores?: string[];
}

/**
 * 默认**跳过**的仓：这些是**可再生缓存**，导出它们只会让备份变大，
 * 恢复时也会被重新拉取覆盖 —— 但它们不是用户资产，故跳过。
 * 注意：只跳过明确的缓存；任何承载用户行为的仓都必须导出。
 */
export const DEFAULT_SKIP_STORES: readonly string[] = [
  IDB_STORES.datasets,   // 题库/词库详情缓存（可再生，且体积大）
  IDB_STORES.meta,       // 迁移标记等运行期元信息
];

/**
 * 修行录在 localStorage 里的键。
 *
 * ⚠️ 必须与模板的 `const KEY = "qingci-cet4-v4"` **完全一致** ——
 * 初版我写成 `qingci.state`（凭印象），真浏览器验收立刻暴露：
 * 备份里 `hasState: false`，也就是**修行录本身没被备份**。
 * 这正是「字符串常量两处各写一份」的典型坑，故在此写明来源。
 */
export const DEFAULT_STATE_KEY = 'qingci-cet4-v4';

/** 安全读 localStorage */
function readState(storage: CollectOptions['storage'], key: string): Record<string, unknown> | null {
  try {
    const store = storage === undefined
      ? (typeof localStorage !== 'undefined' ? localStorage : null)
      : storage;
    if (!store) return null;
    const raw = store.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** 列出要备份的仓（排除 skip 与不存在于本 DB 的仓） */
function storesToBackup(db: { objectStoreNames: { contains(n: string): boolean } } | null, skip: readonly string[]): string[] {
  const all = Object.values(IDB_STORES) as string[];
  return all.filter((name) => !skip.includes(name) && (!db || db.objectStoreNames.contains(name)));
}

/**
 * 收集完整备份。
 *
 * 返回的对象可直接 `JSON.stringify` 落盘。
 * 单个仓读取失败**不中断整体**：该仓记为 `[]` 并在 `errors` 里如实报告。
 */
export async function collectBackup(options: CollectOptions = {}): Promise<BackupFile & { errors: string[] }> {
  const skip = options.skipStores || DEFAULT_SKIP_STORES;
  const stateKey = options.stateKey || DEFAULT_STATE_KEY;
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const errors: string[] = [];

  const state = readState(options.storage, stateKey);
  const stores: Record<string, unknown[]> = {};

  let db: Awaited<ReturnType<typeof openAppDatabase>> | null = null;
  try {
    db = await openAppDatabase(options.factory);
  } catch (e) {
    errors.push('无法打开本地数据库：' + String((e && (e as Error).message) || e));
  }

  for (const name of storesToBackup(db, skip)) {
    if (!db) { stores[name] = []; continue; }
    try {
      const tx = db.transaction(name, 'readonly');
      const os = tx.objectStore(name);
      const rows = await promisify<unknown[]>(os.getAll());
      /* 只导出**记录本身**，不带主键。
         为什么不用 getAllKeys 把自增主键也带走：真实 IDB 的 put(value, key)
         在 autoIncrement 仓上会抛 DataError（「uses a key generator, and a key
         parameter was provided」），测试用的假 IDB 也照着真实语义做了校验。
         而本项目里自增键（qiLog / attempts / reviews）**都不参与业务语义** ——
         例如 listRecentTransactions 按 `timestamp` 排序、同毫秒才用 id 兜底，
         所以恢复时重新分配自增键不会丢内容、也不影响查询结果。 */
      stores[name] = Array.isArray(rows) ? rows : [];
    } catch (e) {
      stores[name] = [];
      errors.push(`仓 ${name} 读取失败：` + String((e && (e as Error).message) || e));
    }
  }

  return {
    format: BACKUP_FORMAT,
    version: IDB_VERSION,
    exportedAt: new Date(now).toISOString(),
    state,
    stores,
    errors,
  };
}

/** 识别一个解析后的对象是不是本项目的备份 */
export function isBackupFile(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const d = data as Partial<BackupFile>;
  if (d.format === BACKUP_FORMAT) return true;
  // 旧版：无 format，但有 state 对象（纯修行录导出）
  if (!d.format && d.state && typeof d.state === 'object') return true;
  return false;
}

export interface ApplyResult {
  ok: boolean;
  /** 是否成功写入 localStorage state */
  stateApplied: boolean;
  /** 各仓写入了多少条 */
  restored: Record<string, number>;
  /** 跳过/失败原因（如实报告，不静默） */
  errors: string[];
  /** 是否为旧版（仅 state）备份 */
  legacy: boolean;
}

export interface ApplyOptions {
  storage?: { getItem(k: string): string | null; setItem(k: string, v: string): void } | null;
  stateKey?: string;
  factory?: Parameters<typeof openAppDatabase>[0];
  /** 只恢复这些仓（默认全部） */
  only?: string[];
}

/**
 * 应用备份（**合并语义**）。
 *
 * 关键安全约定：
 *   · state 通过 `setItem` **整体覆盖** —— 因为它是单一 JSON 文档，
 *     调用方（模板）会先用既有 `validateImported()` 清洗，这里不做二次裁剪；
 *   · IDB 仓用 `put` **逐条写入**（不 `clear()`）—— 导入是「合并」不是「替换」，
 *     这样即使用户在旧备份上恢复，也不会丢掉后来新增的数据；
 *   · 单个仓失败**不影响其它仓**，失败原因进 `errors`。
 */
export async function applyBackup(data: unknown, options: ApplyOptions = {}): Promise<ApplyResult> {
  const result: ApplyResult = { ok: false, stateApplied: false, restored: {}, errors: [], legacy: false };
  if (!isBackupFile(data)) {
    result.errors.push('不是有效的备份文件（缺少 format 或 state）');
    return result;
  }
  const file = data as Partial<BackupFile>;
  const stateKey = options.stateKey || DEFAULT_STATE_KEY;
  const legacy = file.format !== BACKUP_FORMAT;
  result.legacy = legacy;

  // 1) state
  if (file.state && typeof file.state === 'object') {
    try {
      const store = options.storage === undefined
        ? (typeof localStorage !== 'undefined' ? localStorage : null)
        : options.storage;
      if (!store) {
        result.errors.push('本地存储不可用，修行录未写入');
      } else {
        store.setItem(stateKey, JSON.stringify(file.state));
        result.stateApplied = true;
      }
    } catch (e) {
      result.errors.push('写入修行录失败：' + String((e && (e as Error).message) || e));
    }
  } else {
    result.errors.push('备份里没有修行录（state）');
  }

  // 2) IDB 仓（旧版备份没有 stores，跳过）
  const stores = (file.stores && typeof file.stores === 'object') ? file.stores : {};
  const names = Object.keys(stores).filter((n) => !options.only || options.only.includes(n));
  if (names.length) {
    let db: Awaited<ReturnType<typeof openAppDatabase>> | null = null;
    try {
      db = await openAppDatabase(options.factory);
    } catch (e) {
      result.errors.push('无法打开本地数据库：' + String((e && (e as Error).message) || e));
    }
    for (const name of names) {
      const rows = stores[name];
      if (!Array.isArray(rows) || !rows.length) { result.restored[name] = 0; continue; }
      if (!db) { result.restored[name] = 0; continue; }
      try {
        const tx = db.transaction(name, 'readwrite');
        const os = tx.objectStore(name);
        let n = 0;
        for (const row of rows) {
          /* 一律 `put(row)`，不带显式键 —— 见 collectBackup 的说明：
             autoIncrement 仓带键会抛 DataError；本项目自增键不参与业务语义。
             内联键仓（keyPath）则由 put 自己从记录里取键，天然正确。 */
          await promisify(os.put(row));
          n++;
        }
        result.restored[name] = n;
      } catch (e) {
        result.restored[name] = 0;
        result.errors.push(`仓 ${name} 写入失败：` + String((e && (e as Error).message) || e));
      }
    }
  }

  result.ok = result.stateApplied || Object.values(result.restored).some((n) => n > 0);
  return result;
}

/** 备份摘要（用于界面提示「本次备份包含什么」） */
export function describeBackup(file: Partial<BackupFile> | null | undefined): string {
  if (!file || !isBackupFile(file)) return '不是有效的备份';
  const legacy = file.format !== BACKUP_FORMAT;
  const storeNames = Object.keys(file.stores || {});
  const total = storeNames.reduce((s, k) => s + (Array.isArray((file.stores as Record<string, unknown[]>)[k]) ? (file.stores as Record<string, unknown[]>)[k].length : 0), 0);
  if (legacy) return '旧版备份（仅修行录，不含心魔/库存等本地数据）';
  return `备份含修行录 + ${storeNames.length} 个数据仓、共 ${total} 条记录`;
}

/** 统计备份里的记录总数（界面用） */
export function backupRecordCount(file: Partial<BackupFile> | null | undefined): number {
  if (!file || !file.stores) return 0;
  return Object.values(file.stores).reduce<number>((s, v) => s + (Array.isArray(v) ? v.length : 0), 0);
}

/**
 * 清空全部本地数据（「散功」用）。
 *
 * 为什么需要：原有「散功」只 `localStorage.removeItem(KEY)` ——
 * 但它的提示语写的是「将清空本机的全部修行录：已斩获词汇、心魔词、复习队列、
 * 灵石与模考成绩」，而**心魔录、库存、灵田、洞府、道场、流水都在 IndexedDB 里**，
 * 清完之后它们仍在。用户以为散功了，其实没散干净 ——
 * 与「不丢数据」相反的另一面：**承诺删除却没删**，同样是不一致。
 *
 * 只清用户资产仓（跳过可再生缓存由整库删除一并处理，这里直接 clear 每个仓）。
 * 单个仓失败不影响其它仓，失败原因进返回值。
 */
export async function clearAllData(factory?: Parameters<typeof openAppDatabase>[0]): Promise<{ cleared: string[]; errors: string[] }> {
  const errors: string[] = [];
  const cleared: string[] = [];
  let db: Awaited<ReturnType<typeof openAppDatabase>> | null = null;
  try {
    db = await openAppDatabase(factory);
  } catch (e) {
    return { cleared, errors: ['无法打开本地数据库：' + String((e && (e as Error).message) || e)] };
  }
  for (const name of Object.values(IDB_STORES) as string[]) {
    if (!db.objectStoreNames.contains(name)) continue;
    try {
      const tx = db.transaction(name, 'readwrite');
      await promisify(tx.objectStore(name).clear());
      cleared.push(name);
    } catch (e) {
      errors.push(`仓 ${name} 清空失败：` + String((e && (e as Error).message) || e));
    }
  }
  return { cleared, errors };
}

export { IDB_NAME, IDB_STORES };
