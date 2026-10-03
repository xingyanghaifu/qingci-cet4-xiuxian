/**
 * 键盘快捷键解析（纯函数，便于测试）
 *
 * 约定（与模板中的全局 keydown 配合）：
 *   1-4            选择选项（含斗法场）
 *   ← / ↑          回看上一题（只读）
 *   → / ↓          下一题 / 换题
 *   Enter          提交或推进
 *   Space          播放 / 暂停听力
 *
 * 只有在非输入状态（没有焦点在 input/textarea/contenteditable）时生效，
 * 由调用方传入 inEditable 判断，避免抢占拼写输入。
 */

export type ShortcutAction =
  | { type: 'answer'; index: number }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'submit' }
  | { type: 'play' };

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
    default:
      return null;
  }
}
