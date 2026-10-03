/**
 * Media Session：让听力播放在锁屏 / 通知栏 / 蓝牙耳机上可控制
 *
 * 背景：听力用浏览器 speechSynthesis 合成，本身没有 <audio> 元素，
 * 因此需要显式声明元数据与动作处理，系统媒体面板才会显示「青词天路」以及播放/暂停按钮。
 *
 * 全部 API 都可能不存在（Safari 旧版、桌面 Firefox），一律做能力检测后静默跳过。
 */

export interface MediaSessionLike {
  metadata: unknown;
  playbackState: 'none' | 'paused' | 'playing';
  setActionHandler(action: string, handler: (() => void) | null): void;
}

export interface MediaMetadataLike {
  title?: string;
  artist?: string;
  album?: string;
}

export interface MediaSessionHost {
  mediaSession?: MediaSessionLike;
  MediaMetadata?: new (init: MediaMetadataLike) => unknown;
}

/** 能力检测：宿主是否支持 Media Session */
export function supportsMediaSession(host?: MediaSessionHost | null): boolean {
  const target = host === undefined
    ? (typeof navigator !== 'undefined' ? (navigator as unknown as MediaSessionHost) : null)
    : host;
  return !!target && !!target.mediaSession && typeof target.mediaSession.setActionHandler === 'function';
}

export interface MediaHandlers {
  play?: () => void;
  pause?: () => void;
  stop?: () => void;
  /** 上一句 / 下一句（可选） */
  previous?: () => void;
  next?: () => void;
}

/**
 * 绑定媒体控制
 * @returns 是否绑定成功（不支持时为 false，调用方无需分支）
 */
export function bindMediaSession(meta: MediaMetadataLike, handlers: MediaHandlers, host?: MediaSessionHost | null): boolean {
  const target = host === undefined
    ? (typeof navigator !== 'undefined' ? (navigator as unknown as MediaSessionHost) : null)
    : host;
  if (!supportsMediaSession(target) || !target) return false;
  const session = target.mediaSession as MediaSessionLike;
  try {
    if (target.MediaMetadata) {
      session.metadata = new target.MediaMetadata({
        title: meta.title || '青词天路 · 听力',
        artist: meta.artist || '青词天路 · 四级全卷修仙',
        album: meta.album || '听力练习',
      });
    }
    const actions: Array<[string, (() => void) | undefined]> = [
      ['play', handlers.play],
      ['pause', handlers.pause],
      ['stop', handlers.stop],
      ['previoustrack', handlers.previous],
      ['nexttrack', handlers.next],
    ];
    for (const [action, handler] of actions) {
      try {
        session.setActionHandler(action, handler || null);
      } catch {
        /* 个别浏览器不支持某个动作，忽略 */
      }
    }
    return true;
  } catch {
    return false;
  }
}

/** 更新播放状态（播放/暂停时调用，系统面板据此切换图标） */
export function setPlaybackState(state: 'none' | 'paused' | 'playing', host?: MediaSessionHost | null): boolean {
  const target = host === undefined
    ? (typeof navigator !== 'undefined' ? (navigator as unknown as MediaSessionHost) : null)
    : host;
  if (!supportsMediaSession(target) || !target) return false;
  try {
    (target.mediaSession as MediaSessionLike).playbackState = state;
    return true;
  } catch {
    return false;
  }
}
