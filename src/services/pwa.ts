/**
 * PWA 装配：Service Worker 注册与更新提示
 *
 * 约束：
 * - 只在 http(s) 下注册；`file://` 双击打开时静默跳过（不报错、不影响使用）。
 * - 注册失败（浏览器不支持 / 隐私模式 / 跨域限制）一律静默降级。
 * - 发现新版本时显示一条可点击的自绘提示条，点击后跳过等待并刷新，
 *   避免用户长期停留在旧外壳上。
 */

export interface PwaInitResult {
  registered: boolean;
  reason?: 'unsupported' | 'insecure-context' | 'register-failed' | 'already';
}

let inited = false;

/** 是否具备注册条件（可被测试覆盖） */
export function canRegisterSw(scope: { isSecureContext?: boolean; protocol?: string; hasServiceWorker?: boolean } = {}): boolean {
  const hasSw = scope.hasServiceWorker ?? (typeof navigator !== 'undefined' && 'serviceWorker' in navigator);
  if (!hasSw) return false;
  const protocol = scope.protocol ?? (typeof location !== 'undefined' ? location.protocol : '');
  const secure = scope.isSecureContext ?? (typeof window !== 'undefined' ? window.isSecureContext : false);
  // http(s) 且安全上下文（https 或 localhost）
  return (protocol === 'https:' || protocol === 'http:') && secure !== false;
}

function showUpdateBar(onReload: () => void): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('swUpdateBar')) return;
  const bar = document.createElement('div');
  bar.id = 'swUpdateBar';
  bar.setAttribute('role', 'status');
  bar.style.cssText = [
    'position:fixed', 'left:50%', 'transform:translateX(-50%)',
    'bottom:calc(16px + env(safe-area-inset-bottom))', 'z-index:99',
    'padding:10px 14px', 'border-radius:12px', 'cursor:pointer',
    'background:#0e6b53', 'color:#f8f3ea', 'font-size:14px',
    'box-shadow:0 10px 24px rgba(0,0,0,.28)',
  ].join(';');
  bar.textContent = '新版本已就绪，点击刷新';
  bar.addEventListener('click', () => {
    bar.remove();
    onReload();
  });
  document.body.appendChild(bar);
}

/** 注册 Service Worker（幂等） */
export async function initPwa(swUrl = 'sw.js'): Promise<PwaInitResult> {
  if (inited) return { registered: false, reason: 'already' };
  if (!canRegisterSw()) {
    return { registered: false, reason: typeof navigator !== 'undefined' && 'serviceWorker' in navigator ? 'insecure-context' : 'unsupported' };
  }
  inited = true;
  try {
    const registration = await navigator.serviceWorker.register(swUrl, { scope: './' });

    const notifyIfWaiting = (worker: ServiceWorker | null) => {
      if (worker && worker.state === 'installed' && navigator.serviceWorker.controller) {
        showUpdateBar(() => {
          worker.postMessage({ type: 'SKIP_WAITING' });
          location.reload();
        });
      }
    };
    notifyIfWaiting(registration.waiting);
    registration.addEventListener('updatefound', () => notifyIfWaiting(registration.installing));

    return { registered: true };
  } catch {
    return { registered: false, reason: 'register-failed' };
  }
}

/** 仅测试用：重置幂等标记 */
export function __resetPwaForTest(): void {
  inited = false;
}
