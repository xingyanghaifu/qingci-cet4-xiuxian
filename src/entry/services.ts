/**
 * 单文件 HTML 的内联服务入口
 *
 * 由 scripts/build.mjs 用 esbuild 打包为 IIFE 后内联进 index.html；
 * 打包结果无 import/export，挂载全局 `QingciServices` 供应用脚本调用。
 *
 * 启动顺序（全部异步、失败静默，不阻塞做题）：
 *   1. 挂载全局 API
 *   2. 页面 load 后注册 Service Worker（仅 http(s)，file:// 自动跳过）
 *   3. 把内联的词库/试卷按版本写入 IndexedDB，供离线与下次秒开使用
 */
import { QingciServices } from './../services/index';
import { initPwa } from './../services/pwa';
import { initTheme } from './../services/theme';
import { cacheInlineDatasets, createOfflineStore } from './../services/offline-store';
import { APP_VERSION } from './../config/app-version';

(globalThis as unknown as { QingciServices?: typeof QingciServices }).QingciServices = QingciServices;

// 主题要在首屏尽早应用，避免闪一下系统默认配色
initTheme();

function boot(): void {
  // 1) Service Worker：离线外壳 + 静态资源缓存
  void initPwa();

  // 2) 内联数据落 IndexedDB：版本变化时才重写，避免每次启动都写 ~300KB
  const store = createOfflineStore(undefined, APP_VERSION);
  void cacheInlineDatasets(document, store, APP_VERSION).then((result) => {
    (globalThis as unknown as { __QINGCI_OFFLINE_BOOT__?: unknown }).__QINGCI_OFFLINE_BOOT__ = result;
  });
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'complete') boot();
  else window.addEventListener('load', boot, { once: true });
}
