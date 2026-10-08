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
import { currentLexiconId } from './../services/lexicon';
import { createVocabSrsStore } from './../services/vocab-srs';
// 内联词库解码器（core/utils.js 是 CommonJS，esbuild 可正常打包）
import coreUtils from './../core/utils.js';
import { createReportStore } from './../services/report-store';
import { runLegacyMigration, describeMigration, LEGACY_STATE_KEY } from './../services/migrate';
import { APP_VERSION } from './../config/app-version';

const host = globalThis as unknown as {
  QingciServices?: typeof QingciServices;
  __QINGCI_MISTAKES__?: ReturnType<typeof createMistakeStore>;
  __QINGCI_BANK__?: ReturnType<typeof createBankService>;
  __QINGCI_VOCAB__?: ReturnType<typeof createVocabSrsStore>;
  __QINGCI_REPORT__?: ReturnType<typeof createReportStore>;
  __QINGCI_MIGRATION__?: unknown;
  __QINGCI_OFFLINE_BOOT__?: unknown;
};

host.QingciServices = QingciServices;

/**
 * 内联词库解码器挂到全局（v1.10 体积优化）。
 *
 * 为什么必须挂全局：内联词库在**构建期**被改写成紧凑列式
 * （`{k:[字段名],v:[[值],…]}`），比对象数组省约 102 KB。
 * 模板里有 5 处各自 `JSON.parse(document.getElementById('lexicon').textContent)`，
 * 它们都需要先解码。把解码器挂全局，模板就能统一写 `decodeLexicon(...)`，
 * 而不必把 core/utils.js 整个打进主脚本。
 *
 * 兼容：`decodeLexicon` 同时接受对象数组（旧格式 / 词库分片）与紧凑列式。
 */
(host as unknown as { decodeLexicon?: unknown }).decodeLexicon = coreUtils.decodeLexicon;

// 固化题库服务：单例，供随机练习入口复用（含 IndexedDB 缓存与防重复窗口）
host.__QINGCI_BANK__ = createBankService();
// v1.9.0：题库来源跟随词库 —— 默认词库继续用单文件题库（v1.8.x 行为），
// 中学词库切换过去后 load() 才去取各自的分片，避免一上来就多拉 2~3 MB。
try {
  host.__QINGCI_BANK__.setLexicon(currentLexiconId());
} catch {
  /* 本地存储不可用 → 保持默认题库，不影响做题 */
}

// 词汇 SRS 仓库：与错题本共用 SM-2 引擎，但队列分开（vocab 仓库）
host.__QINGCI_VOCAB__ = createVocabSrsStore();

// 模考报告仓库：作答流水 + 每次模考的报告（P1 任务 B）
host.__QINGCI_REPORT__ = createReportStore();

/** 图表样式：随服务层一起内联，避免往模板里塞 CSS */
function injectChartStyles(): void {
  try {
    if (document.getElementById('qingci-chart-style')) return;
    const style = document.createElement('style');
    style.id = 'qingci-chart-style';
    style.textContent = QingciServices.report.chartCss;
    document.head.appendChild(style);
  } catch {
    /* 忽略 */
  }
}

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
  // 0) 图表样式（报告卡用）
  injectChartStyles();

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
