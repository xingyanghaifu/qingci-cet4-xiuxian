/**
 * 洞府装饰视觉应用（阶段 C 补全）
 *
 * ── 为什么需要这个模块 ──
 * `cave.ts` 定义了 5 个装饰，其中 4 个是**纯视觉承诺**且都要花灵石：
 *
 *   bg_ink            （ 50 灵石）'洞府铺一层水墨底色。'
 *   furniture_bamboo  （ 40 灵石）'竹影一张，石凳两把。'
 *   frame_cloud       （ 80 灵石）'云纹绕边的称号框。'
 *   frame_beast       （120 灵石）'灵兽头像框，衬得道号更精神。'
 *
 * 但模板只做了**购买与「已拥有」标记**，**从未把这 4 个视觉应用到界面**：
 * 全模板 grep `data-deco` / `cave-bg` / `title-frame` / `avatar-frame` 均为 0 次。
 *
 * 即：玩家花 290 灵石买下 4 个装饰后，界面**一点变化都没有**。
 * 这是本项目「服务层写了/定义了，模板没有消费点」的**第五次**出现
 * （前四次：5/6 空头支票奇遇、listPending 无人调用、道场三设施 buff、斗法奖励口径）。
 *
 * ── 设计 ──
 *   · **纯函数**：`caveVisualClasses(decorations)` 只把「已购 ID 列表」
 *     映射成「要挂的 class 名」，不碰 DOM、不碰 storage → 可完整单测；
 *   · **只加 class，不改结构**：调用方把返回的 class 挂到既有锚点元素上，
 *     零 DOM 重构风险；
 *   · **视觉全部走既有 token**（`--color-wood` / `--gold` / `--jade` 等），
 *     规则内零裸 hex —— 这是本仓库的硬约束（`tests/ui-wiring.test.mjs` 守着）；
 *   · **未购买时返回空数组**：既有行为一字不变（老用户界面不变）。
 *
 * ── 三条红线 ──
 *   1. 纯装饰：不加任何数值/概率效果（灵泉的 -10% 已由 spirit-field 负责）；
 *   2. 不制造焦虑：不因未购买而弱化既有界面（只做「加了更好看」）；
 *   3. 不侵入学习：与答题流程零耦合。
 */

/** 装饰 ID → 要挂到界面上的 class（锚点由调用方决定） */
export const DECO_CLASS: Readonly<Record<string, string>> = {
  bg_ink: 'deco-bg-ink',
  furniture_bamboo: 'deco-bamboo',
  frame_cloud: 'deco-frame-cloud',
  frame_beast: 'deco-frame-beast',
};

/** 洞府装饰的视觉类别（供 UI 文案与分组） */
export type DecoSlot = 'background' | 'furniture' | 'titleFrame' | 'avatarFrame';

/** 装饰 ID → 挂载目标（哪一类锚点） */
export const DECO_SLOT: Readonly<Record<string, DecoSlot>> = {
  bg_ink: 'background',
  furniture_bamboo: 'furniture',
  frame_cloud: 'titleFrame',
  frame_beast: 'avatarFrame',
};

/**
 * 把已购装饰列表映射成 class 列表。
 *
 * 纯函数：不改入参、不碰 DOM。未知 ID 忽略（不抛错），重复 ID 去重，
 * 返回顺序稳定（按 DECO_CLASS 的声明顺序）—— 便于测试与快照比对。
 */
export function caveVisualClasses(decorations: readonly string[] | null | undefined): string[] {
  const owned = new Set(
    (Array.isArray(decorations) ? decorations : []).filter((d) => typeof d === 'string' && d),
  );
  const out: string[] = [];
  for (const [id, cls] of Object.entries(DECO_CLASS)) {
    if (owned.has(id)) out.push(cls);
  }
  return out;
}

/** 按挂载槽位分组（调用方按槽位挂到不同锚点） */
export function caveVisualBySlot(
  decorations: readonly string[] | null | undefined,
): Record<DecoSlot, string | null> {
  const owned = new Set(
    (Array.isArray(decorations) ? decorations : []).filter((d) => typeof d === 'string' && d),
  );
  const out: Record<DecoSlot, string | null> = {
    background: null, furniture: null, titleFrame: null, avatarFrame: null,
  };
  for (const [id, slot] of Object.entries(DECO_SLOT)) {
    if (owned.has(id)) out[slot] = DECO_CLASS[id] || null;
  }
  return out;
}

/** 已购装饰的可读摘要（洞府页展示「已装点」用；未购买返回空数组） */
export function caveDecorSummary(
  decorations: readonly string[] | null | undefined,
  defs: ReadonlyArray<{ id: string; name: string }> | null | undefined,
): string[] {
  const owned = new Set(
    (Array.isArray(decorations) ? decorations : []).filter((d) => typeof d === 'string' && d),
  );
  const list = Array.isArray(defs) ? defs : [];
  return list.filter((d) => d && owned.has(d.id)).map((d) => String(d.name || d.id));
}

/**
 * 计算「已拥有几个视觉装饰」（不含灵泉 —— 它是功能件不是视觉件）。
 * 用于洞府摘要「洞府装点 3 / 4」这类展示。
 */
export function visualDecorCount(decorations: readonly string[] | null | undefined): number {
  const owned = new Set(
    (Array.isArray(decorations) ? decorations : []).filter((d) => typeof d === 'string' && d),
  );
  return Object.keys(DECO_CLASS).filter((id) => owned.has(id)).length;
}

/** 视觉装饰总数（4） */
export const VISUAL_DECO_TOTAL = Object.keys(DECO_CLASS).length;
