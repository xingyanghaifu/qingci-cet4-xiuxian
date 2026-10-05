/**
 * 修炼体系 · 境界↔称号↔灵田↔心魔 四环链（v1.8.1 谕令四）
 *
 * 这一层只做**纯函数 + 常量**，不改 SM-2 / 题库 / SRS 任何行为语义，
 * 也不新建存储：所有写盘仍由既有服务（gamification / spirit-field / demons）负责。
 *
 * 四环如何咬合：
 *   1. **境界 → 灵田**：`PLOT_UNLOCK_BY_REALM` 决定可见/可耕格数，
 *      低境界的格子被「封印」——显示但不可种植（境界只升不降，解封后旧作物仍在）。
 *   2. **境界 → 心魔**：`DEMON_LEVEL_CAP_BY_REALM` 是心魔等级封顶；
 *      超出封顶的心魔停在封顶级（「凝而不化」），不降级也不报错。
 *   3. **境界 → 称号**：`REALM_ENTRY_TITLES` 给出每档的入门称号，晋级即可佩戴。
 *   4. **灵田收获 → 称号/心魔**：`harvestTitleOf` 把收获行为映射到一句称号注脚，
 *      `harvestDemonSoftening` 说明收获对心魔的联动（收获期不额外加心魔）。
 *
 * 三条硬约束（与既有系统一致，不因本模块改变）：
 *   · 只升不降：境界高段位永不回退，封印格不会因掉境界而丢失作物；
 *   · 不惩罚：未解锁格只是「封印」，不是禁用账号，也不清数据；
 *   · 零依赖：不引入任何第三方包，纯字面量与数组。
 */

/** 灵田可见格数（9 格全在仓库里，境界只控「能耕几格」） */
export const PLOT_TOTAL = 9;

/** 各境界解锁的灵田格数（索引 = 境界 index，0..4） */
export const PLOT_UNLOCK_BY_REALM: readonly number[] = [3, 5, 7, 9, 9];

/** 各境界的心魔等级封顶（索引 = 境界 index，0..4） */
export const DEMON_LEVEL_CAP_BY_REALM: readonly number[] = [3, 4, 5, 5, 5];

/** 心魔等级绝对上限（沿用 demons.ts 的 DEMON_MAX_LEVEL，此处只做口径声明） */
export const DEMON_LEVEL_ABSOLUTE_CAP = 5;

/** 各境界的入门称号（晋级即可佩戴，与 achievements/titles 持久化分开） */
export const REALM_ENTRY_TITLES: Readonly<Record<number, string>> = {
  0: '初入道途',
  1: '筑基之资',
  2: '金丹初成',
  3: '元婴出窍',
  4: '化神登仙',
};

/** 各境界在洞府特权行里展示的一句话（不含付费/加速承诺） */
export const REALM_PRIVILEGE_LINE: Readonly<Record<number, string>> = {
  0: '练气弟子 · 可耕 3 格灵田，心魔止于 Lv.3',
  1: '筑基真修 · 可耕 5 格灵田，心魔止于 Lv.4',
  2: '金丹真人 · 可耕 7 格灵田，心魔可达 Lv.5（心魔劫）',
  3: '元婴老祖 · 九格灵田尽开，心魔劫不受限',
  4: '化神天尊 · 九格灵田尽开，化神之下再无封印',
};

/** 化神（最高境界）专属的终局心魔概念：只作为文案，不新增战斗分支 */
export const TERMINAL_DEMON_NOTE = '化神之后，心魔归一为「无相心魔」——不再新增等级，只是陪你走到最后。';

export interface CultivationChain {
  realmIndex: number;
  /** 当前境界解锁的格数（0..9） */
  unlockedPlots: number;
  /** 被封印的格数 */
  sealedPlots: number;
  /** 心魔等级封顶 */
  demonCap: number;
  /** 入门称号 */
  entryTitle: string;
  /** 洞府特权行文案 */
  privilegeLine: string;
  /** 是否已达最高境界（化神） */
  terminal: boolean;
}

/** 境界档位总数（五档：练气/筑基/金丹/元婴/化神） */
export const REALM_TIERS = 5;

function clampRealm(realmIndex: number): number {
  const n = Math.round(Number(realmIndex));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(REALM_TIERS - 1, n));
}

/** 由境界算出四环链的全部展示数据（纯函数，可单测） */
export function cultivationChain(realmIndex: number): CultivationChain {
  const idx = clampRealm(realmIndex);
  const unlocked = PLOT_UNLOCK_BY_REALM[idx] ?? PLOT_UNLOCK_BY_REALM[0];
  const cap = DEMON_LEVEL_CAP_BY_REALM[idx] ?? DEMON_LEVEL_CAP_BY_REALM[0];
  return {
    realmIndex: idx,
    unlockedPlots: Math.min(PLOT_TOTAL, unlocked),
    sealedPlots: Math.max(0, PLOT_TOTAL - unlocked),
    demonCap: Math.min(DEMON_LEVEL_ABSOLUTE_CAP, cap),
    entryTitle: REALM_ENTRY_TITLES[idx] || REALM_ENTRY_TITLES[0],
    privilegeLine: REALM_PRIVILEGE_LINE[idx] || REALM_PRIVILEGE_LINE[0],
    terminal: idx >= REALM_TIERS - 1,
  };
}

/** 第 n 格是否已解锁（低境界为「封印」，但不清除该格已有作物） */
export function isPlotUnlocked(realmIndex: number, plotIndex: number): boolean {
  const i = Math.round(Number(plotIndex));
  if (!Number.isFinite(i) || i < 0) return false;
  return i < cultivationChain(realmIndex).unlockedPlots;
}

/** 封印原因文案（UI 提示用；空串表示未封印） */
export function sealReason(realmIndex: number, plotIndex: number): string {
  if (isPlotUnlocked(realmIndex, plotIndex)) return '';
  const chain = cultivationChain(realmIndex);
  // 下一个能多解一格的境界档（找不到则说明已封顶，只有最高境界才 9 格）
  let nextRealm = -1;
  for (let i = chain.realmIndex + 1; i < REALM_TIERS; i++) {
    if ((PLOT_UNLOCK_BY_REALM[i] ?? 0) > chain.unlockedPlots) { nextRealm = i; break; }
  }
  return nextRealm < 0
    ? `第 ${plotIndex + 1} 格 · 需更高境界解封`
    : `第 ${plotIndex + 1} 格 · 需至「${REALM_ENTRY_TITLES[nextRealm]}」解封`;
}

/** 境界心魔封顶：心魔等级不得越过该值 */
export function capDemonLevel(realmIndex: number, level: number): number {
  const cap = cultivationChain(realmIndex).demonCap;
  const lv = Math.round(Number(level));
  if (!Number.isFinite(lv)) return 1;
  return Math.max(1, Math.min(cap, lv));
}

/** 是否越过境界心魔封顶（「凝而不化」） */
export function isDemonOverCap(realmIndex: number, level: number): boolean {
  const lv = Math.round(Number(level));
  return Number.isFinite(lv) && lv > cultivationChain(realmIndex).demonCap;
}

/** 收获行为对应的称号注脚（灵田收获 → 称号链路，纯文案映射） */
export function harvestTitleOf(cropType: string): string {
  switch (cropType) {
    case 'qi_grass': return '灵石草熟 · 囊中渐丰';
    case 'memory_flower': return '记忆花开 · 旧题重忆';
    case 'enlighten_tree': return '悟道树成 · 心神通明';
    default: return '灵田有收';
  }
}

/** 收获对心魔的联动说明：收获期不额外催生心魔（保持「不惩罚」与错题权威口径） */
export function harvestDemonSoftening(cropType: string): string {
  switch (cropType) {
    case 'memory_flower': return '记忆花收获：接下来的复习不再新增心魔';
    case 'enlighten_tree': return '悟道树收获：接下来的复习不再新增心魔';
    case 'qi_grass': return '灵石草收获：心魔等级不变';
    default: return '灵田有收：心魔等级不变';
  }
}