/**
 * 旧存档迁移（P0.2）
 *
 * 背景：v3 / v4 的 localStorage 存档里，错题只以「心魔本」形式存在——
 * `state.wrong = { 单词: 错误次数 }`，另有 `state.schedule = { 单词: { level, next, tries } }`
 * 记录了旧的固定间隔（0.25/1/3/7 天）复习进度。
 *
 * 迁移原则：
 *   1. **只读不写**：绝不修改或删除 localStorage 里的旧数据，出问题删 IndexedDB 即可重来。
 *   2. **幂等**：完成后在 IndexedDB 的 meta 里记一条 `legacy-migration` 标记，重复启动不重复导入。
 *   3. **可解释**：旧的 level/next 会被换算成 SM-2 的 ease / intervalDays / repetitions 初值，
 *      而不是简单丢弃——用户已经形成的记忆强度不会被清空。
 */
import { IDB_STORES, openAppDatabase, promisify, type MinimalFactory } from './idb';
import {
  DEFAULT_EASE,
  MISTAKE_TYPES,
  mistakeId,
  proficiencyOf,
  type MistakeRecord,
  type MistakeType,
} from '../types/mistakes';
import { RELEARN_INTERVAL_DAYS } from './srs';
import type { MistakeStore } from './mistake-store';

/** localStorage 中旧存档的键（v4；v3 结构为其子集） */
export const LEGACY_STATE_KEY = 'qingci-cet4-v4';
export const MIGRATION_META_KEY = 'legacy-migration';

export interface LegacyStateLike {
  version?: number;
  wrong?: Record<string, number>;
  known?: Record<string, number>;
  schedule?: Record<string, { level?: string; next?: number; tries?: number }>;
  days?: Record<string, { right?: number; wrong?: number }>;
  seen?: number;
  right?: number;
}

/** 旧 level → SM-2 初值（保住用户已有的记忆强度） */
const LEVEL_TO_SRS: Record<string, { ease: number; intervalDays: number; repetitions: number }> = {
  again: { ease: 2.3, intervalDays: RELEARN_INTERVAL_DAYS, repetitions: 0 },
  hard: { ease: 2.4, intervalDays: 1, repetitions: 1 },
  good: { ease: 2.5, intervalDays: 3, repetitions: 2 },
  easy: { ease: 2.7, intervalDays: 7, repetitions: 2 },
};

export interface MigrationPlan {
  records: MistakeRecord[];
  /** 旧存档里的错词总数（用于对比导入结果） */
  legacyWrongCount: number;
  /** 旧 schedule 中带有复习进度的词数 */
  legacyScheduledCount: number;
  /** 旧存档版本号 */
  legacyVersion: number;
  skippedReason?: 'empty' | 'nothing-to-migrate';
}

/** 计算迁移计划（纯函数，不触碰任何存储） */
export function planLegacyMigration(
  state: LegacyStateLike | null | undefined,
  options: { now?: Date; lookupWord?: (word: string) => { zh?: string; short?: string } | undefined } = {},
): MigrationPlan {
  const now = options.now || new Date();
  const wrong = state && state.wrong && typeof state.wrong === 'object' ? state.wrong : {};
  const schedule = state && state.schedule && typeof state.schedule === 'object' ? state.schedule : {};
  const words = Object.keys(wrong).filter((w) => (wrong[w] || 0) > 0);
  const scheduled = Object.keys(schedule).length;

  if (!state) return { records: [], legacyWrongCount: 0, legacyScheduledCount: 0, legacyVersion: 0, skippedReason: 'empty' };
  if (!words.length) {
    return {
      records: [],
      legacyWrongCount: 0,
      legacyScheduledCount: scheduled,
      legacyVersion: Number(state.version) || 0,
      skippedReason: 'nothing-to-migrate',
    };
  }

  const records: MistakeRecord[] = words.map((word) => {
    const nowIso = now.toISOString();
    const entry = schedule[word];
    const preset = entry && entry.level ? LEVEL_TO_SRS[entry.level] : undefined;
    const ease = preset ? preset.ease : DEFAULT_EASE;
    const intervalDays = preset ? preset.intervalDays : 0;
    const repetitions = preset ? preset.repetitions : 0;
    // 旧 next 是毫秒时间戳；比现在早则视为今天到期
    const legacyNext = entry && typeof entry.next === 'number' ? entry.next : now.getTime();
    const nextReviewAt = new Date(Math.max(now.getTime(), legacyNext)).toISOString();
    const meaning = options.lookupWord ? options.lookupWord(word) : undefined;
    const record: MistakeRecord = {
      id: mistakeId({ type: 'vocab', prompt: word, correctAnswer: meaning?.zh || meaning?.short || word }),
      type: 'vocab' as MistakeType,
      prompt: word,
      userAnswer: '',
      correctAnswer: meaning?.zh || meaning?.short || word,
      explanation: '由旧版心魔本迁移，保留原错误次数与复习进度。',
      sourceRef: { kind: 'word', word },
      knowledgeTags: ['vocab', 'legacy'],
      wrongCount: wrong[word] || 1,
      reviewCount: entry && typeof entry.tries === 'number' ? entry.tries : 0,
      lastReviewedAt: entry ? nowIso : undefined,
      nextReviewAt,
      ease,
      intervalDays,
      repetitions,
      proficiency: proficiencyOf({ repetitions, ease, wrongCount: wrong[word] || 1, intervalDays }),
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    return record;
  });

  return {
    records,
    legacyWrongCount: words.length,
    legacyScheduledCount: scheduled,
    legacyVersion: Number(state.version) || 0,
  };
}

export interface MigrationResult {
  migrated: number;
  skipped: boolean;
  reason?: string;
  legacyWrongCount: number;
  byType: Record<string, number>;
}

/** 读取迁移标记 */
export async function readMigrationMark(factory?: MinimalFactory | null): Promise<{ at: string; count: number; from: number } | null> {
  const idb = factory === undefined ? (typeof indexedDB !== 'undefined' ? (indexedDB as unknown as MinimalFactory) : null) : factory;
  if (!idb) return null;
  try {
    const db = await openAppDatabase(idb);
    const store = db.transaction(IDB_STORES.meta, 'readonly').objectStore(IDB_STORES.meta);
    const row = await promisify<{ at: string; count: number; from: number } | undefined>(store.get(MIGRATION_META_KEY));
    return row || null;
  } catch {
    return null;
  }
}

async function writeMigrationMark(factory: MinimalFactory | null | undefined, mark: { at: string; count: number; from: number }): Promise<void> {
  const idb = factory === undefined ? (typeof indexedDB !== 'undefined' ? (indexedDB as unknown as MinimalFactory) : null) : factory;
  if (!idb) return;
  try {
    const db = await openAppDatabase(idb);
    const store = db.transaction(IDB_STORES.meta, 'readwrite').objectStore(IDB_STORES.meta);
    await promisify(store.put(mark, MIGRATION_META_KEY));
  } catch {
    /* 标记写入失败不影响本次迁移结果，最多下次重复导入（put 幂等） */
  }
}

/**
 * 执行迁移：把旧存档中的心魔词导入错题本
 * @param store 错题仓库
 * @param state 已解析的旧存档对象（调用方从 localStorage 读取）
 */
export async function runLegacyMigration(
  store: MistakeStore,
  state: LegacyStateLike | null | undefined,
  options: {
    now?: Date;
    lookupWord?: (word: string) => { zh?: string; short?: string } | undefined;
    factory?: MinimalFactory | null;
    force?: boolean;
  } = {},
): Promise<MigrationResult> {
  const plan = planLegacyMigration(state, { now: options.now, lookupWord: options.lookupWord });
  const byType: Record<string, number> = {};
  for (const record of plan.records) byType[record.type] = (byType[record.type] || 0) + 1;

  if (!store.available()) {
    return { migrated: 0, skipped: true, reason: 'indexeddb-unavailable', legacyWrongCount: plan.legacyWrongCount, byType };
  }
  if (!options.force) {
    const mark = await readMigrationMark(options.factory);
    if (mark) {
      return { migrated: 0, skipped: true, reason: 'already-migrated', legacyWrongCount: plan.legacyWrongCount, byType };
    }
  }
  if (plan.skippedReason) {
    return { migrated: 0, skipped: true, reason: plan.skippedReason, legacyWrongCount: plan.legacyWrongCount, byType };
  }

  let migrated = 0;
  for (const record of plan.records) {
    if (await store.put(record)) migrated++;
  }
  await writeMigrationMark(options.factory, {
    at: (options.now || new Date()).toISOString(),
    count: migrated,
    from: plan.legacyVersion,
  });

  return { migrated, skipped: false, legacyWrongCount: plan.legacyWrongCount, byType };
}

/** 迁移结果的可读文案（界面提示用） */
export function describeMigration(result: MigrationResult): string {
  if (result.skipped) {
    if (result.reason === 'already-migrated') return '错题本已是最新，无需重复导入。';
    if (result.reason === 'nothing-to-migrate') return '旧存档里没有错词，错题本从零开始记录。';
    if (result.reason === 'indexeddb-unavailable') return '当前浏览器不可用离线数据库，错题本暂不可用。';
    return '没有可迁移的数据。';
  }
  const types = MISTAKE_TYPES
    .map(({ value, label }) => (result.byType[value] ? `${label} ${result.byType[value]}` : null))
    .filter(Boolean)
    .join('、');
  return `已从旧存档导入 ${result.migrated} 条错题${types ? `（${types}）` : ''}。`;
}
