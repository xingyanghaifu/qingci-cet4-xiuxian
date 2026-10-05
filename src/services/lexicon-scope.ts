/**
 * 词库隔离工具（v1.8.2 阶段 A5）
 *
 * ── 隔离方式：字段而非分键 ──
 *   谕令给的示例是「key 加 lexiconId 前缀」（`cet4:about` / `cet6:abide`）。
 *   本项目**没有采用**，理由是它会同时打破三处既有契约：
 *
 *   1. `vocab` 仓库是 `keyPath: 'w'` 的 in-line 键仓 —— 一旦 key 变成
 *      `cet4:about`，主键就与 `w` 字段不再是同一个值，`get('about')`
 *      全部落空，等于把已有用户的 SRS 记录整体作废。
 *   2. `mistakes` 仓库是 `keyPath: 'id'`，而 `id` 由题目内容哈希而来；
 *      给它加前缀会改变 SM-2 复习日志的 `mistakeId` 对应关系。
 *   3. `tests/vocab.test.mjs` 直接断言 `r.w === 'abandon'`、`store.rate('abandon',…)`
 *      之类的原始词形调用，前缀化会让既有测试与调用方全部失效。
 *
 *   改为**记录内 `lx` 字段 + 读取时过滤**：
 *     - `w` / `id` 原样不动 → 既有数据、既有测试、既有调用方零影响；
 *     - 查询时用 `sameLexicon(row.lx, current)` 过滤 → 天然隔离；
 *     - 老记录无 `lx` → `lexiconOf()` 兜底为 `'cet4'` → **进度不丢**。
 *
 * ── 唯一例外：详情缓存 ──
 *   `datasets` 仓里的详情缓存本就以「键」寻址（`vocabdetail:<word>`），
 *   同一单词在两个词库里详情完全一致（CET-6 与 CET-4 的重叠词），
 *   按词库重复缓存只会白占空间，故不加前缀 —— 这不是「漏做隔离」，
 *   而是**缓存的是同一份可再生数据**，详情缓存键保持原样。
 *
 * 本模块是纯函数，不 import 任何业务模块（与 cultivation.ts 同一约定）。
 */
import { DEFAULT_LEXICON_ID } from './lexicon';

/** 取记录的词库归属；老数据无 `lx` 时归入默认词库 */
export function lexiconOf(record: { lx?: unknown } | null | undefined): string {
  const v = record && record.lx != null ? String(record.lx).trim() : '';
  return v || DEFAULT_LEXICON_ID;
}

/**
 * 是否属于同一词库。
 * @param rowLexicon 记录上的 `lx`（可空 → 视为默认词库）
 * @param current    当前词库 id
 */
export function sameLexicon(rowLexicon: string | undefined | null, current: string): boolean {
  const want = String(current || '').trim() || DEFAULT_LEXICON_ID;
  const got = String(rowLexicon == null ? '' : rowLexicon).trim() || DEFAULT_LEXICON_ID;
  return got === want;
}

/** 给记录打上词库标记（纯函数，返回新对象，不改入参） */
export function tagLexicon<T extends object>(record: T, lexiconId: string): T & { lx: string } {
  return { ...record, lx: String(lexiconId || '').trim() || DEFAULT_LEXICON_ID };
}

/**
 * 仅在**明确指定**词库时打标记，否则原样返回。
 *
 * 这是 `tagLexicon` 的存储层专用变体：词库参数缺省（= 不开启隔离）时，
 * 记录必须保持 v1.8.1 的原始形状（无 `lx`），否则既有调用方写出的数据
 * 会凭空多出一个字段，白白破坏「不传词库 = 完全不变」的向后兼容承诺。
 */
export function tagIf<T extends object>(record: T, lexiconId?: string | null): T {
  const id = String(lexiconId == null ? '' : lexiconId).trim();
  return id ? ({ ...record, lx: id } as T) : record;
}

/**
 * 按当前词库过滤一组记录。
 * 传 `current` 为 undefined/空 时**不过滤**（保持 v1.8.1 行为：
 * 任何显式调用方都能看到全部历史记录，避免旧调用点意外丢数据）。
 */
export function filterByLexicon<T extends { lx?: string }>(rows: readonly T[] | null | undefined, current?: string | null): T[] {
  const list = Array.isArray(rows) ? rows : [];
  const want = String(current == null ? '' : current).trim();
  if (!want) return [...list];
  return list.filter((r) => sameLexicon(r && r.lx, want));
}

/** 词库视图统计（选择器展示用） */
export interface LexiconProgress {
  lexiconId: string;
  /** 该词库下已建立 SRS 记录的词数 */
  studied: number;
  /** 错题本条目数 */
  mistakes: number;
}

export function summarizeByLexicon(
  vocabRows: ReadonlyArray<{ lx?: string }> | null | undefined,
  mistakeRows: ReadonlyArray<{ lx?: string }> | null | undefined,
  lexiconIds: readonly string[],
): LexiconProgress[] {
  const ids = [...new Set(lexiconIds)];
  const count = (rows: ReadonlyArray<{ lx?: string }> | null | undefined, id: string) =>
    filterByLexicon(rows, id).length;
  return ids.map((id) => ({
    lexiconId: id,
    studied: count(vocabRows, id),
    mistakes: count(mistakeRows, id),
  }));
}
