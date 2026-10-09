/**
 * 灵石流水账本（修炼生态 · 阶段 A2 补全）
 *
 * ── 为什么需要这个模块 ──
 * `economy.ts` 的流水（`qiLog`）是 **append-only + `balanceAfter` 链式**设计，
 * 模块注释明确写着「`listRecentTransactions` 可回放校验」，
 * `tests/economy.test.mjs` 也有 6 处断言在测它。
 *
 * 但**模板从未展示过它**（全模板 grep `listRecentTransactions` 0 次）：
 * 玩家每天在赚灵石、花灵石（背词、任务、斗法、渡劫、奇遇、收获、传功、
 * 道场捐献、商店购买…），却**没有任何地方能看到灵石是怎么来的、怎么没的**。
 *
 * 这是本项目「服务层实现了、测过了、导出了，但没有消费点」的**第六次**出现
 * （前五次：空头支票奇遇 / listPending / 道场三设施 buff / 斗法奖励口径 / 洞府装饰视觉）。
 *
 * ── 本模块做什么 ──
 *   · `reasonLabel()`：把内部 reason 代码翻成**用户看得懂的中文**
 *     （`duel_win` → 「论剑胜出」；带前缀的 `purchase_array` → 「购买 · 聚灵阵」）
 *   · `describeTransaction()`：单条流水的可读描述（含正负号与余额）
 *   · `summarizeTransactions()`：按收入/支出汇总（用于「近 N 笔」小结）
 *
 * 全部是**纯函数**，不碰 DOM、不碰 storage → 可完整单测。
 * 展示由调用方负责（模板渲染），这样判定与呈现分离。
 *
 * ── 三条红线 ──
 *   1. 只读展示：不修改任何流水/余额（`balanceAfter` 是既有事实，原样呈现）；
 *   2. 不制造焦虑：支出不标红警告、不做「你花了太多」这类评判；
 *   3. 不侵入学习：与答题流程零耦合，纯查询。
 */

/** 单条流水（与 economy.QiTransaction 同构，避免跨模块 import） */
export interface TxLike {
  timestamp?: string;
  amount?: number;
  reason?: string;
  balanceAfter?: number;
}

/** reason 代码 → 中文标签（用户视角；不含内部术语） */
export const REASON_LABEL: Readonly<Record<string, string>> = {
  // 收入
  daily_words: '每日背词',
  daily_words_crit: '每日背词（暴击）',
  duel_win: '斗法胜出',
  duel_tie: '斗法平局',
  joint_demon_win: '联手斩魔',
  demon_raid_success: '心魔劫',
  tribulation_win: '渡劫成功',
  encounter_qi_rain: '奇遇 · 灵石雨',
  transmission_sent: '传功',
  // v1.11 第二轮新增的灵石来源（学习里程碑）—— 当时**漏了这里的映射**，
  // 导致流水里直接显示原始代码 `word_milestone`。
  // 已加守卫测试：所有 earnSpirit 的 reason 都必须在此有中文映射。
  word_milestone: '掌握里程碑',
  word_milestone_crit: '掌握里程碑（暴击）',
  // 支出
  sect_donate: '道场捐献',
  // 前缀类（下面按前缀解析）
  purchase: '购买',
  refund: '退款',
  harvest: '灵田收获',
};

/** 带目标/子类的 reason（`purchase_array` / `harvest_qi_grass`）→ 前缀 + 后缀 */
const PREFIX_LABEL: ReadonlyArray<[string, string]> = [
  ['purchase_', '购买'],
  ['refund_', '退款'],
  ['harvest_', '灵田收获'],
];

/** 道具 ID → 名字（与 economy.ITEM_CATALOG 对齐；此处只做展示映射） */
export const ITEM_LABEL: Readonly<Record<string, string>> = {
  array: '聚灵阵',
  talisman: '护道符',
  pill: '记忆丹',
  book: '参悟古籍',
  review: '复习令',
  listen: '听风符',
  break: '破障丹',
};

/**
 * 作物 ID → 名字。
 *
 * ⚠️ **必须与 `spirit-field.CROPS[id].name` 完全一致**。
 * 这里是**冗余副本**（ledger.ts 刻意零依赖，不 import 任何模块），
 * 所以容易漂移 —— 实测踩到：`memory_flower` 在这里叫「忆魂花」，
 * 而灵田里叫「记忆花」，于是**同一作物在流水与灵田显示两个名字**。
 *
 * 改作物名时必须**两处同步**；`tests/name-consistency.test.mjs` 会逐项比对，
 * 不一致立刻失败。
 */
export const CROP_LABEL: Readonly<Record<string, string>> = {
  qi_grass: '灵石草',
  memory_flower: '记忆花',
  enlighten_tree: '悟道树',
};

/**
 * 把 reason 代码翻成中文标签。
 * 未知代码**原样返回**（不吞掉、不显示「未知」——便于发现问题），
 * 但会把下划线换成间隔号让可读性稍好。
 */
export function reasonLabel(reason: string | null | undefined): string {
  const r = String(reason == null ? '' : reason).trim();
  if (!r) return '灵石变动';
  if (REASON_LABEL[r]) return REASON_LABEL[r];
  for (const [prefix, label] of PREFIX_LABEL) {
    if (r.startsWith(prefix)) {
      const sub = r.slice(prefix.length);
      const name = ITEM_LABEL[sub] || CROP_LABEL[sub] || '';
      return name ? `${label} · ${name}` : label;
    }
  }
  return r.replace(/_/g, ' · ');
}

/** 该条是收入还是支出（0 视为「无变动」） */
export function txDirection(amount: number): 'in' | 'out' | 'flat' {
  const a = Number(amount) || 0;
  if (a > 0) return 'in';
  if (a < 0) return 'out';
  return 'flat';
}

/** 单条流水的可读描述：`+50 灵石 · 论剑胜出 · 余额 120` */
export function describeTransaction(tx: TxLike | null | undefined): string {
  if (!tx) return '';
  const amount = Number(tx.amount) || 0;
  const sign = amount > 0 ? '+' : '';
  const label = reasonLabel(tx.reason);
  const parts = [`${sign}${amount} 灵石`, label];
  const bal = Number(tx.balanceAfter);
  if (Number.isFinite(bal)) parts.push(`余额 ${bal}`);
  return parts.join(' · ');
}

/** 流水的本地时间（`MM-DD HH:mm`）；无效时间返回空串 */
export function txTimeLabel(timestamp: string | null | undefined): string {
  const t = Date.parse(String(timestamp || ''));
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export interface TxSummary {
  /** 收入合计（正数） */
  income: number;
  /** 支出合计（正数，便于显示「支出 N」） */
  spent: number;
  /** 净变动（收入 − 支出） */
  net: number;
  /** 笔数 */
  count: number;
  /** 按标签汇总的笔数与净额（降序，按绝对值） */
  byLabel: Array<{ label: string; count: number; net: number }>;
}

/**
 * 汇总一组流水。
 * 纯函数：不改入参。空输入返回全 0（不抛错）。
 */
export function summarizeTransactions(txs: readonly TxLike[] | null | undefined): TxSummary {
  const list = Array.isArray(txs) ? txs : [];
  let income = 0;
  let spent = 0;
  const map = new Map<string, { count: number; net: number }>();
  for (const tx of list) {
    const a = Number(tx && tx.amount) || 0;
    if (a > 0) income += a;
    else if (a < 0) spent += -a;
    const label = reasonLabel(tx && tx.reason);
    const cur = map.get(label) || { count: 0, net: 0 };
    cur.count += 1;
    cur.net += a;
    map.set(label, cur);
  }
  const byLabel = [...map.entries()]
    .map(([label, v]) => ({ label, count: v.count, net: v.net }))
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || a.label.localeCompare(b.label));
  return { income, spent, net: income - spent, count: list.length, byLabel };
}

/** 账本是否为空（用于「还没有流水」提示） */
export function isEmptyLedger(txs: readonly TxLike[] | null | undefined): boolean {
  return !Array.isArray(txs) || txs.length === 0;
}
