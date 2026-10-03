/**
 * 单文件 HTML 的内联服务入口
 *
 * 由 scripts/build.mjs 用 esbuild 打包为 IIFE 后内联进 index.html；
 * 打包结果无 import/export，挂载全局 `QingciServices` 供应用脚本调用。
 *
 * 启动顺序（全部异步、失败静默，不阻塞做题）：
 *   1. 主题先行应用（避免闪色），挂载全局 API
 *   2. 页面 load 后注册 Service Worker（仅 http(s)，file:// 自动跳过）
 *   3. 把内联的词库/试卷按版本写入 IndexedDB，供离线与下次秒开使用
 *   4. 建立错题仓库，并把旧存档（v3/v4 心魔本）一次性迁移进来
 */
import { QingciServices } from './../services/index';
import { initPwa } from './../services/pwa';
import { initTheme } from './../services/theme';
import { cacheInlineDatasets, createOfflineStore } from './../services/offline-store';
import { createMistakeStore } from './../services/mistake-store';
import { createBankService } from './../services/question-bank';
import { createVocabSrsStore } from './../services/vocab-srs';
import { runLegacyMigration, describeMigration, LEGACY_STATE_KEY } from './../services/migrate';
import { APP_VERSION } from './../config/app-version';

const host = globalThis as unknown as {
  QingciServices?: typeof QingciServices;
  __QINGCI_MISTAKES__?: ReturnType<typeof createMistakeStore>;
  __QINGCI_BANK__?: ReturnType<typeof createBankService>;
  __QINGCI_VOCAB__?: ReturnType<typeof createVocabSrsStore>;
  __QINGCI_MIGRATION__?: unknown;
  __QINGCI_OFFLINE_BOOT__?: unknown;
};

host.QingciServices = QingciServices;

// 固化题库服务：单例，供随机练习入口复用（含 IndexedDB 缓存与防重复窗口）
host.__QINGCI_BANK__ = createBankService();

// 词汇 SRS 仓库：与错题本共用 SM-2 引擎，但队列分开（vocab 仓库）
host.__QINGCI_VOCAB__ = createVocabSrsStore();

/** 读取旧存档（localStorage），兼容缺失与损坏 */
function readLegacyState(): Record<string, unknown> | null {
  try {
    return JSON.parse(localStorage.getItem(LEGACY_STATE_KEY) || 'null');
  } catch {
    return null;
  }
}

// 主题要在首屏尽早应用，避免闪一下系统默认配色
initTheme();

/** 词库查询（惰性解析，只在需要迁移时构建一次） */
function makeLexiconLookup(): (word: string) => { zh?: string; short?: string } | undefined {
  let map: Map<string, { zh?: string; short?: string }> | null = null;
  return (word: string) => {
    if (!map) {
      map = new Map();
      try {
        const el = document.getElementById('lexicon');
        const rows = el && el.textContent ? (JSON.parse(el.textContent) as Array<{ w: string; zh?: string; short?: string }>) : [];
        for (const row of rows) map.set(row.w, { zh: row.zh, short: row.short });
      } catch {
        /* 词库不可用时迁移仍可进行，释义留空 */
      }
    }
    return map.get(word);
  };
}

async function bootMistakes(): Promise<void> {
  const store = createMistakeStore();
  host.__QINGCI_MISTAKES__ = store;
  if (!store.available()) return;
  const legacy = readLegacyState();
  const result = await runLegacyMigration(store, legacy as never, { lookupWord: makeLexiconLookup() });
  host.__QINGCI_MIGRATION__ = { ...result, message: describeMigration(result) };
  // 迁移完成后通知界面刷新（界面监听该事件即可，无需轮询）
  try {
    window.dispatchEvent(new CustomEvent('qingci:mistakes-ready', { detail: host.__QINGCI_MIGRATION__ }));
  } catch {
    /* 忽略 */
  }
}

/** 词汇 SRS：把旧存档的固定间隔进度（state.schedule）一次性迁移到 SM-2 队列 */
async function bootVocabSrs(): Promise<void> {
  const store = host.__QINGCI_VOCAB__;
  if (!store || !store.available()) return;
  const legacy = readLegacyState();
  const schedule = (legacy && typeof legacy === 'object' ? (legacy as { schedule?: Record<string, { level?: string; next?: number; tries?: number }> }).schedule : null) || null;
  const result = await store.migrateLegacy(schedule);
  try {
    window.dispatchEvent(new CustomEvent('qingci:vocab-ready', { detail: result }));
  } catch {
    /* 忽略 */
  }
}

function boot(): void {
  // 1) Service Worker：离线外壳 + 静态资源缓存
  void initPwa();

  // 2) 内联数据落 IndexedDB：版本变化时才重写，避免每次启动都写 ~300KB
  const store = createOfflineStore(undefined, APP_VERSION);
  void cacheInlineDatasets(document, store, APP_VERSION).then((result) => {
    host.__QINGCI_OFFLINE_BOOT__ = result;
  });

  // 3) 错题本：建库 + 旧存档迁移
  void bootMistakes();

  // 4) 词汇 SRS：建库 + 旧固定间隔进度迁移
  void bootVocabSrs();
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'complete') boot();
  else window.addEventListener('load', boot, { once: true });
}
