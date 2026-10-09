/**
 * 备份提醒（第六轮补漏）
 *
 * ── 为什么做这个 ──
 * `docs/产品方案.md` 在「风险与对策」里写着：
 *
 *   | localStorage 清缓存丢进度 | 中 | 已提供导出/导入 JSON，**建议提示用户定期备份** |
 *
 * 但**从来没有任何提示**（全模板 grep「备份」0 次）。用户不点导出就永远不知道
 * 该备份 —— 而清缓存会真的丢数据（上一轮已把备份补全到覆盖 17 个 IDB 仓）。
 *
 * 所以这里补上「该备份了」的判断与提示文案。**纯判定**，不写存档、不弹警告。
 *
 * ── 三条红线 ──
 *   1. **不制造焦虑**：提示是「温和的、可忽略的」，不阻断任何功能、
 *      不做红字警告、不重复弹；用户忽略后仍能正常用。
 *   2. **不打扰**：有实际学习量才提示（空账号不提示）；提醒过就静默一段时间。
 *   3. **不侵入学习**：纯只读推导（看上次导出时间与学习量），不改 SRS。
 */

/** 默认提醒间隔：距上次导出超过 14 天才提示 */
export const REMIND_AFTER_DAYS = 14;
/** 首次提醒门槛：至少要有这么多天学习记录才值得提示（空账号不打扰） */
export const MIN_STUDY_DAYS = 3;
/** 用户手动忽略后的静默期（天） */
export const SNOOZE_DAYS = 7;

export interface BackupHintInput {
  /** 上次导出时间（ISO 或时间戳）；从未导出传 null/undefined */
  lastExportAt?: string | number | null;
  /** 用户上次「稍后再说」的时间；用于静默期 */
  snoozedAt?: string | number | null;
  /** 有学习记录的天数（state.days 的键数） */
  studyDays?: number;
  /** 当前时间（可注入，便于测试确定性） */
  now?: number;
}

export interface BackupHint {
  /** 是否应该提示 */
  should: boolean;
  /** 距上次导出多少天（从未导出为 null） */
  daysSinceExport: number | null;
  /** 机器可读原因，便于测试与埋点 */
  reason: 'never' | 'stale' | 'snoozed' | 'fresh' | 'no-data';
  /** 给用户看的一句话（应温和、可忽略） */
  message: string;
}

/** 解析时间；非法返回 null */
function parseTime(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}

const DAY_MS = 86400000;

/**
 * 判断是否该提醒备份。
 *
 * 纯函数：不读 storage、不碰 DOM。调用方把「上次导出时间」等传进来。
 *
 * 优先级：无学习数据 → 不提示；在静默期内 → 不提示；
 * 从未导出 → 提示；距上次导出超过 REMIND_AFTER_DAYS → 提示；否则不提示。
 */
export function backupHint(input: BackupHintInput = {}): BackupHint {
  const now = Number.isFinite(Number(input.now)) ? Number(input.now) : Date.now();
  const studyDays = Math.max(0, Math.floor(Number(input.studyDays) || 0));
  const last = parseTime(input.lastExportAt);
  const snoozed = parseTime(input.snoozedAt);

  // 空账号不打扰
  if (studyDays < MIN_STUDY_DAYS) {
    return {
      should: false, daysSinceExport: last === null ? null : Math.floor((now - last) / DAY_MS),
      reason: 'no-data', message: '',
    };
  }

  // 静默期内不打扰（用户刚说过「稍后再说」）
  if (snoozed !== null && now - snoozed < SNOOZE_DAYS * DAY_MS) {
    return {
      should: false, daysSinceExport: last === null ? null : Math.floor((now - last) / DAY_MS),
      reason: 'snoozed', message: '',
    };
  }

  // 从未导出 → 提示（但语气温和）
  if (last === null) {
    return {
      should: true,
      daysSinceExport: null,
      reason: 'never',
      message: `已修行 ${studyDays} 天，还没导出过备份。清浏览器缓存会丢进度，建议导出一次。`,
    };
  }

  const days = Math.floor((now - last) / DAY_MS);
  if (days >= REMIND_AFTER_DAYS) {
    return {
      should: true,
      daysSinceExport: days,
      reason: 'stale',
      message: `距上次备份已 ${days} 天，建议再导出一次（心魔录、复习队列、灵田等都在备份里）。`,
    };
  }

  return { should: false, daysSinceExport: days, reason: 'fresh', message: '' };
}

/** 下次该提醒的时间戳（用于界面显示「下次提醒」；不该提醒时返回 null） */
export function nextRemindAt(lastExportAt: string | number | null | undefined, now: number = Date.now()): number | null {
  const last = parseTime(lastExportAt);
  const base = last === null ? now : last;
  return base + REMIND_AFTER_DAYS * DAY_MS;
}

/** 记录一次「稍后再说」的状态（纯函数，返回新状态；调用方负责落盘） */
export function snoozeBackup(state: { snoozedAt?: string | null }, now: number = Date.now()): { snoozedAt: string } {
  void state;
  return { snoozedAt: new Date(Number.isFinite(Number(now)) ? Number(now) : Date.now()).toISOString() };
}
