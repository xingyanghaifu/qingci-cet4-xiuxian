/**
 * 洞府（修炼生态 · 阶段 C）
 *
 * 单记录（id='main'）的装饰集合；灵泉（spring_water）是唯一带效果的装饰，
 * 效果由 spirit-field.ts 读取（成熟阈值 -10%），此处只负责拥有状态与购买。
 *
 * 购买走阶段 A 的消费助手（spendSpirit → 流水），库存写失败补偿式回滚（同 economy.purchase）。
 */
import { storeOf, promisify, type MinimalFactory } from './idb';
import { spendSpirit, earnSpirit } from './economy';

export interface Cave {
  id: 'main';
  /** 已购装饰 ID */
  decorations: string[];
  layout: 'simple' | 'lush';
}

export interface DecorationDef {
  id: string;
  name: string;
  price: number;
  category: 'background' | 'titleFrame' | 'avatarFrame' | 'furniture' | 'utility';
  effect?: string;
  desc: string;
}

export const SPRING_WATER_ID = 'spring_water';

/** 装饰表（5 种，价格按 spec） */
export const DECORATIONS: readonly DecorationDef[] = [
  { id: 'bg_ink', name: '墨韵背景', price: 50, category: 'background', desc: '洞府铺一层水墨底色。' },
  { id: 'furniture_bamboo', name: '竹石桌凳', price: 40, category: 'furniture', desc: '竹影一张，石凳两把。' },
  { id: 'frame_cloud', name: '云纹称号框', price: 80, category: 'titleFrame', desc: '云纹绕边的称号框。' },
  { id: 'frame_beast', name: '灵兽头像框', price: 120, category: 'avatarFrame', desc: '灵兽头像框，衬得道号更精神。' },
  { id: SPRING_WATER_ID, name: '灵泉', price: 200, category: 'utility', effect: 'field_speedup', desc: '灵泉润田：所有作物成熟阈值 -10%。' },
];

export function decorationDef(id: string): DecorationDef | null {
  return DECORATIONS.find((d) => d.id === id) || null;
}

function normalize(row: unknown): Cave {
  const c = row as Cave | null;
  return {
    id: 'main',
    decorations: c && Array.isArray(c.decorations) ? c.decorations.filter((d) => typeof d === 'string') : [],
    layout: c && c.layout === 'lush' ? 'lush' : 'simple',
  };
}

async function caveStore(mode: 'readonly' | 'readwrite', factory?: MinimalFactory | null) {
  return storeOf('cave', mode, factory);
}

export async function loadCave(factory?: MinimalFactory | null): Promise<Cave> {
  try {
    const store = await caveStore('readonly', factory);
    if (!store) return normalize(null);
    return normalize(await promisify<Cave | undefined>(store.get('main')));
  } catch {
    return normalize(null);
  }
}

export async function hasDecoration(id: string, factory?: MinimalFactory | null): Promise<boolean> {
  const cave = await loadCave(factory);
  return cave.decorations.includes(id);
}

/** 灵泉是否已购（灵田成长阈值判定用） */
export async function hasSpringWater(factory?: MinimalFactory | null): Promise<boolean> {
  return hasDecoration(SPRING_WATER_ID, factory);
}

/**
 * 购买装饰：灵石不足 → no-funds；已拥有 → already-owned；未知 → unknown-item。
 * 写库失败 → 退款回滚。
 */
export async function purchaseDecoration(
  state: { spirit?: number },
  id: string,
  factory?: MinimalFactory | null,
): Promise<{ ok: boolean; reason?: string }> {
  const def = decorationDef(id);
  if (!def) return { ok: false, reason: 'unknown-item' };
  const paid = spendSpirit(state, def.price, `purchase_${id}`, factory);
  if (!paid.ok) return { ok: false, reason: 'no-funds' };
  try {
    const store = await caveStore('readwrite', factory);
    if (!store) throw new Error('cave 不可用');
    const cave = normalize(await promisify<Cave | undefined>(store.get('main')));
    if (cave.decorations.includes(id)) {
      earnSpirit(state, def.price, `refund_${id}`, factory);
      return { ok: false, reason: 'already-owned' };
    }
    const next: Cave = {
      ...cave,
      decorations: [...cave.decorations, id],
      layout: cave.decorations.length + 1 >= DECORATIONS.length ? 'lush' : cave.layout,
    };
    await promisify(store.put(next, 'main'));
    return { ok: true };
  } catch {
    earnSpirit(state, def.price, `refund_${id}`, factory);
    return { ok: false, reason: 'unavailable' };
  }
}