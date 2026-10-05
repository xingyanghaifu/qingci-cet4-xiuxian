/**
 * 心魔（修炼生态 · 阶段 B）
 *
 * 一道错题 = 一只心魔。答错升级、复习答对降级，等级封顶 5（可发起心魔劫）。
 *
 * 与错题本的关系（R17）：
 * - `demons` 仓是**缓存加速**，权威数据始终是 `mistakes` 仓；
 * - `reconcileDemons` 以 mistakes 为准重建 demons（幂等、可重复跑），
 *   开机对账即可修复任何漂移（手改存储、跨设备、旧版本遗留）。
 *
 * 命名确定性：questionId → FNV-1a 哈希 → 魔名表取名（同一个 questionId 永远同名），
 * 因此对账重建不会出现「同名漂移」。
 */
import { storeOf, promisify, type MinimalFactory } from './idb';

/* ───────────────── 数据模型（含 AI 生图预留） ───────────────── */

export type ImageStatus = 'none' | 'pending' | 'ready' | 'failed';

export interface Demon {
  /** 稳定 id：demon:<questionId> */
  id: string;
  questionId: string;
  /** 等级 1–5 */
  level: number;
  createdAt: string;
  lastFoughtAt: string;
  /** 被击败次数（复习答对且降级时累加） */
  defeatedCount: number;
  /** 确定性生成的名字 */
  name: string;
  /** 对应展示境界（0–4，五档制，用于 UI 文案） */
  realm: number;
  /** AI 生图预留：已生成图地址 */
  imageUrl?: string;
  /** AI 生图预留：提示词（数据模型先行，接口单独任务接入） */
  imagePrompt?: string;
  /** AI 生图预留：状态 */
  imageStatus?: ImageStatus;
}

/** 对账输入：错题记录的关键字段（与 MistakeRecord 同源，只取需要的部分） */
export interface DemonMistakeLike {
  id: string;
  /** 题型来源：wrongCount 越大等级越高（对账时的初值依据） */
  wrongCount?: number;
  nextReviewAt?: string;
}

/** 灵兽伙伴（阶段 B 仅数据模型 + 占位，形态进化留后续任务） */
export interface Beast {
  id: string;
  name: string;
  /** AI 生图预留三字段（与心魔同口径） */
  imageUrl?: string;
  imagePrompt?: string;
  imageStatus?: ImageStatus;
  obtainedAt: string;
}

/** 灵兽名表（确定性，按 id 哈希取名） */
const BEAST_NAMES: readonly string[] = ['墨麟', '青鸾', '雪狐', '玄龟', '赤鸢', '苍隼'];
export function beastNameFrom(seed: string): string {
  return BEAST_NAMES[hash32(String(seed || 'beast')) % BEAST_NAMES.length];
}

/* ───────────────── 常量 ───────────────── */

export const DEMON_MIN_LEVEL = 1;
export const DEMON_MAX_LEVEL = 5;
/** 心魔劫触发等级 */
export const DEMON_RAID_LEVEL = 5;

/** 魔名前缀表（按等级分组，同级共享词库但不同后缀，形成「X 之 Y」感） */
const DEMON_NAME_PARTS: ReadonlyArray<{
  realm: number;
  prefix: string;
  suffixes: readonly string[];
}> = [
  { realm: 0, prefix: '迷雾', suffixes: ['魔', '魅', '影', '魇'] },
  { realm: 1, prefix: '贪嗔', suffixes: ['魔', '蟒', '蛛', '蝎'] },
  { realm: 2, prefix: '愚痴', suffixes: ['魔', '蛊', '僵', '傀'] },
  { realm: 3, prefix: '执念', suffixes: ['魔', '兽', '灵', '魂'] },
  { realm: 4, prefix: '心魔', suffixes: ['君', '尊', '将', '帝'] },
];

/* ───────────────── 确定性命名 ───────────────── */

/** FNV-1a 32 位哈希（无依赖，纯整数运算） */
export function hash32(text: string): number {
  let h = 0x811c9dc5;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 等级 → 展示境界（0–4） */
export function demonRealmOf(level: number): number {
  const lv = clampLevel(level);
  return Math.min(DEMON_NAME_PARTS.length - 1, Math.floor((lv - 1) / 1.25));
}

export function clampLevel(level: number): number {
  const lv = Math.round(Number(level) || DEMON_MIN_LEVEL);
  return Math.max(DEMON_MIN_LEVEL, Math.min(DEMON_MAX_LEVEL, lv));
}

/**
 * v1.8.1 谕令四 · 境界封顶：在 1..5 绝对夹取之上，再按境界上限收敛
 * （练气 Lv.3 / 筑基 Lv.4 / 金丹及以上 Lv.5）。
 *
 * **刻意不与既有服务互相 import**：`cultivation.ts` 是纯展示层，
 * 由 `services/index.ts` 注入实际封顶表进来（默认表 = 无额外限制 = v1.8.0 行为），
 * 避免 demons ↔ cultivation 成环，也保证 `clampLevel` 语义一字未改。
 */
export const DEFAULT_REALM_DEMON_CAP: readonly number[] = [3, 4, 5, 5, 5];

/** 按境界封顶表夹取等级（realmIndex 越界按 0 档处理） */
export function capLevelByRealm(level: number, realmIndex?: number, caps: readonly number[] = DEFAULT_REALM_DEMON_CAP): number {
  const lv = clampLevel(level);
  if (realmIndex === undefined || realmIndex === null) return lv;
  const idx = Math.max(0, Math.min(caps.length - 1, Math.round(Number(realmIndex) || 0)));
  const cap = clampLevel(caps[idx] ?? DEMON_MAX_LEVEL);
  return Math.min(cap, lv);
}

/** 是否越过境界封顶（「凝而不化」：不再升级，但也不降级、不报错） */
export function isOverRealmCap(level: number, realmIndex?: number, caps: readonly number[] = DEFAULT_REALM_DEMON_CAP): boolean {
  if (realmIndex === undefined || realmIndex === null) return false;
  const idx = Math.max(0, Math.min(caps.length - 1, Math.round(Number(realmIndex) || 0)));
  const cap = clampLevel(caps[idx] ?? DEMON_MAX_LEVEL);
  return clampLevel(level) > cap;
}

/** questionId → 确定性魔名（同 id 恒定） */
export function demonNameFrom(questionId: string): string {
  const qid = String(questionId || '');
  const h = hash32(qid);
  // 未登记心魔（无 questionId）时走固定名，避免空串
  if (!qid) return '无名魔';
  // 名字依赖 id 本身（而非当前等级），升级时名称稳定，仅“境界称谓”随等级变化
  const group = DEMON_NAME_PARTS[h % DEMON_NAME_PARTS.length];
  const suffix = group.suffixes[Math.floor(h / 7) % group.suffixes.length];
  return `${group.prefix}${suffix}`;
}

/** AI 生图占位槽位（data-image-slot，供 UI 定位与后续接口对接） */
export function demonImageSlot(questionId: string): string {
  return `demon:${String(questionId || '')}`;
}

/** 预留：生图提示词（仅数据模型，接口未接入；开关关闭时不会被调用） */
export function demonImagePrompt(demon: Pick<Demon, 'name' | 'level' | 'questionId'>): string {
  return `水墨风格修仙心魔「${demon.name}」，等级 ${clampLevel(demon.level)}，题号 ${demon.questionId}，云纹背景，细腻线条`;
}

/* ───────────────── 存储层 ───────────────── */

function demonId(questionId: string): string {
  return `demon:${String(questionId || '').trim()}`;
}

async function demonsStore(mode: 'readonly' | 'readwrite', factory?: MinimalFactory | null) {
  return storeOf('demons', mode, factory);
}

function normalize(row: unknown): Demon | null {
  const d = row as Demon | null;
  if (!d || typeof d !== 'object' || !d.questionId) return null;
  const level = clampLevel(d.level);
  return {
    ...d,
    id: demonId(d.questionId),
    questionId: String(d.questionId),
    level,
    realm: demonRealmOf(level),
    createdAt: String(d.createdAt || new Date().toISOString()),
    lastFoughtAt: String(d.lastFoughtAt || d.createdAt || new Date().toISOString()),
    defeatedCount: Math.max(0, Number(d.defeatedCount) || 0),
    name: d.name || demonNameFrom(d.questionId),
    imageStatus: d.imageStatus || 'none',
  };
}

export async function getDemon(questionId: string, factory?: MinimalFactory | null): Promise<Demon | null> {
  try {
    const store = await demonsStore('readonly', factory);
    if (!store) return null;
    const row = await promisify<Demon | undefined>(store.get(demonId(questionId)));
    return normalize(row);
  } catch {
    return null;
  }
}

/** 列出心魔（可按等级过滤）；降序：等级高在前，同级按最近战斗时间新在前 */
export async function listDemons(
  filter: { level?: number } = {},
  factory?: MinimalFactory | null,
): Promise<Demon[]> {
  try {
    const store = await demonsStore('readonly', factory);
    if (!store) return [];
    const rows = await promisify<Demon[]>(store.getAll());
    const list = (Array.isArray(rows) ? rows : []).map(normalize).filter((d): d is Demon => !!d);
    const filtered = typeof filter.level === 'number'
      ? list.filter((d) => d.level === clampLevel(filter.level as number))
      : list;
    return filtered.sort((a, b) => {
      if (b.level !== a.level) return b.level - a.level;
      return String(b.lastFoughtAt).localeCompare(String(a.lastFoughtAt));
    });
  } catch {
    return [];
  }
}

/** level 5 心魔数量（心魔劫可用目标数） */
export async function countRaidReady(factory?: MinimalFactory | null): Promise<number> {
  const list = await listDemons({ level: DEMON_RAID_LEVEL }, factory);
  return list.length;
}

/**
 * 升降级：答错 delta=+1，复习答对 delta=-1。
 * 首次出现（无论 delta）都建档；level 1 时复习答对**不删除**（保留档案，仅 defeatedCount+1），
 * 便于心魔录长期展示「历史战绩」。
 */
export async function upsertDemon(
  questionId: string,
  delta: number,
  factory?: MinimalFactory | null,
  now: number = Date.now(),
  realmIndex?: number,
): Promise<Demon | null> {
  const qid = String(questionId || '').trim();
  if (!qid) return null;
  try {
    const store = await demonsStore('readwrite', factory);
    if (!store) return null;
    const id = demonId(qid);
    const prevRow = await promisify<Demon | undefined>(store.get(id));
    const prev = normalize(prevRow);
    const step = delta > 0 ? 1 : delta < 0 ? -1 : 0;
    const base = prev ? prev.level : DEMON_MIN_LEVEL;
    // 境界封顶：越过上限时「凝而不化」——停在封顶级，不降级也不报错
    const nextLevel = prev ? capLevelByRealm(base + step, realmIndex) : DEMON_MIN_LEVEL;
    const iso = new Date(now).toISOString();
    const demon: Demon = {
      id,
      questionId: qid,
      level: nextLevel,
      createdAt: prev ? prev.createdAt : iso,
      lastFoughtAt: iso,
      defeatedCount: prev ? prev.defeatedCount + (step < 0 ? 1 : 0) : 0,
      name: demonNameFrom(qid),
      realm: demonRealmOf(nextLevel),
      // AI 生图预留：状态默认 none（开关关闭，界面走 SVG 占位）
      imageUrl: prev ? prev.imageUrl : undefined,
      imagePrompt: prev ? prev.imagePrompt : undefined,
      imageStatus: prev ? prev.imageStatus || 'none' : 'none',
    };
    await promisify(store.put(demon));
    return demon;
  } catch {
    return null;
  }
}

/**
 * 对账：以 mistakes 为权威，重建 demons 仓（幂等）。
 * 等级初值：按 wrongCount 映射（1 次→1 级，每多错 1 次 +1 级，封顶 5）。
 * 已存在的心魔保留其演化结果（不降级），仅补齐新出现的错题。
 */
export async function reconcileDemons(
  mistakes: DemonMistakeLike[],
  factory?: MinimalFactory | null,
  now: number = Date.now(),
  realmIndex?: number,
): Promise<{ created: number; kept: number }> {
  let created = 0;
  let kept = 0;
  try {
    const store = await demonsStore('readwrite', factory);
    if (!store) return { created, kept };
    const iso = new Date(now).toISOString();
    for (const mk of Array.isArray(mistakes) ? mistakes : []) {
      const qid = mk && typeof mk.id === 'string' ? mk.id.trim() : '';
      if (!qid) continue;
      const id = demonId(qid);
      const prev = normalize(await promisify<Demon | undefined>(store.get(id)));
      // 境界封顶同样作用于对账初值：低境界时即使错得多也不越过封顶
      const level = capLevelByRealm(DEMON_MIN_LEVEL + Math.max(0, Math.round(Number(mk.wrongCount) || 0) - 1), realmIndex);
      const demon: Demon = prev
        ? { ...prev, questionId: qid, level: Math.max(prev.level, level) } // 不降级，只补齐
        : {
          id,
          questionId: qid,
          level,
          createdAt: iso,
          lastFoughtAt: iso,
          defeatedCount: 0,
          name: demonNameFrom(qid),
          realm: demonRealmOf(level),
          imageUrl: undefined,
          imagePrompt: undefined,
          imageStatus: 'none',
        };
      await promisify(store.put(demon));
      if (prev) kept++; else created++;
    }
    return { created, kept };
  } catch {
    return { created, kept };
  }
}

/** 仅测试用：清空模块内缓存（当前模块无缓存，保留接口以便将来扩展） */
export function __resetDemonCache(): void { /* 预留 */ }