/**
 * 键盘快捷键解析（纯函数，便于测试）
 *
 * 完整键位（与 `a11y.ts` 的 SHORTCUT_HELP 同源，界面直接展示同一份文案）：
 *   1-4            选择选项（含斗法场）
 *   ← / ↑          回看上一题（只读）
 *   → / ↓          下一题 / 换题
 *   Enter          提交或推进
 *   Space          播放 / 暂停听力
 *   R              重播听力
 *   Esc            关闭最上层弹窗（精听 / 反馈 / 突破）
 *   ?              显示或隐藏快捷键表
 *
 * 只有在非输入状态（没有焦点在 input/textarea/contenteditable）时生效，
 * 由调用方传入 inEditable 判断，避免抢占拼写输入。
 * 带 ctrl/meta/alt 的组合键一律不拦截，交给浏览器（无障碍与系统快捷键优先）。
 */

export type ShortcutAction =
  | { type: 'answer'; index: number }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'submit' }
  | { type: 'play' }
  | { type: 'replay' }
  | { type: 'close' }
  | { type: 'help' };

export interface ShortcutContext {
  /** 焦点是否在输入框 / 可编辑区域 */
  inEditable?: boolean;
  /** 是否有 ctrl/meta/alt 修饰键（有则不拦截） */
  hasModifier?: boolean;
  /** 当前题目是否为选择题（有选项才响应数字键） */
  hasChoices?: boolean;
  /** 是否有听力音频控件 */
  hasAudio?: boolean;
  /** 最大选项数（默认 4） */
  maxOptions?: number;
}

/** 解析按键 → 动作；返回 null 表示不处理 */
export function resolveShortcut(key: string, context: ShortcutContext = {}): ShortcutAction | null {
  // Esc 与 ? 即使在输入框里也要能用（否则用户被困在弹窗/输入状态里）
  if (key === 'Escape' || key === 'Esc') return { type: 'close' };
  if (key === '?' || (key === '/' && context.hasModifier)) return { type: 'help' };

  if (context.inEditable || context.hasModifier) return null;
  const maxOptions = context.maxOptions ?? 4;

  if (key >= '1' && key <= '9') {
    const index = Number(key) - 1;
    if (!context.hasChoices) return null;
    return index < maxOptions ? { type: 'answer', index } : null;
  }

  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return { type: 'next' };
    case 'ArrowLeft':
    case 'ArrowUp':
      return { type: 'prev' };
    case 'Enter':
      return { type: 'submit' };
    case ' ':
    case 'Spacebar':
      return context.hasAudio === false ? null : { type: 'play' };
    case 'r':
    case 'R':
      return context.hasAudio === false ? null : { type: 'replay' };
    default:
      return null;
  }
}
