/**
 * 离线仓库（IndexedDB）与 PWA 注册逻辑单元测试
 *
 * IndexedDB 在 Node 中不存在，这里用最小桩件模拟 open/transaction/put/get/getAll/clear，
 * 覆盖三条关键路径：
 *   1. 版本变化才重写数据（避免每次启动都写 ~300KB）
 *   2. 浏览器禁用 IndexedDB（隐私模式）时全部降级、不抛异常
 *   3. Service Worker 注册条件（file:// 跳过、非安全上下文跳过、https 注册）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/load-ts.mjs';

const offline = await loadTs('src/services/offline-store.ts');
const pwa = await loadTs('src/services/pwa.ts');

const { createOfflineStore, cacheInlineDatasets, summarize, isStale, countItems, estimateBytes, DATASET_KEYS } = offline;

/** 最小 IndexedDB 桩件：只实现本模块用到的那部分 API */
function makeFakeIdb() {
  const stores = new Map();
  const request = (produce) => {
    const req = { onsuccess: null, onerror: null, result: undefined };
    queueMicrotask(() => {
      try {
        req.result = produce();
        if (req.onsuccess) req.onsuccess({ target: req });
      } catch (e) {
        req.error = e;
        if (req.onerror) req.onerror({ target: req });
      }
    });
    return req;
  };
  const makeStore = (map) => ({
    put: (value, key) => request(() => { map.set(key, value); return key; }),
    get: (key) => request(() => map.get(key)),
    getAll: () => request(() => [...map.values()]),
    delete: (key) => request(() => { map.delete(key); return undefined; }),
    clear: () => request(() => { map.clear(); return undefined; }),
  });
  const db = {
    objectStoreNames: { contains: (n) => stores.has(n) },
    createObjectStore: (n) => { stores.set(n, new Map()); return {}; },
    transaction: (n) => ({ objectStore: () => makeStore(stores.get(n) || new Map()) }),
    close: () => {},
  };
  return {
    open: () => {
      const req = { onsuccess: null, onerror: null, onupgradeneeded: null, result: db };
      setTimeout(() => {
        if (req.onupgradeneeded) req.onupgradeneeded({ target: req });
        if (req.onsuccess) req.onsuccess({ target: req });
      }, 0);
      return req;
    },
  };
}

const fakeDoc = (data) => ({
  getElementById: (id) => (data[id] === undefined ? null : { textContent: JSON.stringify(data[id]) }),
});

test('offline：写入后可按版本读回，统计条目数与体积', async () => {
  const store = createOfflineStore(makeFakeIdb(), '1.3.1');
  assert.equal(store.available(), true);
  const lexicon = [{ w: 'a' }, { w: 'abandon' }];
  assert.equal(await store.saveDataset(DATASET_KEYS.lexicon, lexicon), true);

  const record = await store.loadDataset(DATASET_KEYS.lexicon);
  assert.equal(record.version, '1.3.1');
  assert.equal(record.items, 2);
  assert.ok(record.bytes > 0);
  assert.deepEqual(record.value, lexicon);

  const stats = await store.stats();
  assert.equal(stats.available, true);
  assert.equal(stats.records.length, 1);
  assert.equal(stats.totalBytes, record.bytes);
});

test('offline：版本未变时复用缓存，不重复写库（cacheInlineDatasets）', async () => {
  const store = createOfflineStore(makeFakeIdb(), '1.3.1');
  const doc = fakeDoc({ lexicon: [{ w: 'a' }], papers: [{ id: 'qingci' }] });

  const first = await cacheInlineDatasets(doc, store, '1.3.1');
  assert.deepEqual(first.saved.sort(), ['lexicon', 'papers']);
  assert.deepEqual(first.reused, []);

  const second = await cacheInlineDatasets(doc, store, '1.3.1');
  assert.deepEqual(second.saved, []);
  assert.deepEqual(second.reused.sort(), ['lexicon', 'papers']);

  // 版本升级 → 重新写入
  const third = await cacheInlineDatasets(doc, store, '1.3.2');
  assert.deepEqual(third.saved.sort(), ['lexicon', 'papers']);
  const record = await store.loadDataset(DATASET_KEYS.lexicon);
  assert.equal(record.version, '1.3.2');
});

test('offline：DOM 中缺少数据脚本时跳过，不写空记录', async () => {
  const store = createOfflineStore(makeFakeIdb(), '1.3.1');
  const result = await cacheInlineDatasets(fakeDoc({}), store, '1.3.1');
  assert.deepEqual(result.saved, []);
  assert.deepEqual(result.skipped.sort(), ['lexicon', 'papers']);
  assert.equal((await store.stats()).records.length, 0);
});

test('offline：IndexedDB 不可用（隐私模式）时全部降级且不抛异常', async () => {
  const store = createOfflineStore(null, '1.3.1');
  assert.equal(store.available(), false);
  assert.equal(await store.saveDataset(DATASET_KEYS.lexicon, [1, 2, 3]), false);
  assert.equal(await store.loadDataset(DATASET_KEYS.lexicon), null);
  const stats = await store.stats();
  assert.equal(stats.available, false);
  assert.equal(stats.totalBytes, 0);
  await store.clear(); // 不应抛错

  const result = await cacheInlineDatasets(fakeDoc({ lexicon: [{ w: 'a' }] }), store, '1.3.1');
  assert.deepEqual(result.saved, []);
  assert.deepEqual(result.skipped.sort(), ['lexicon', 'papers']);
});

test('offline：纯函数——条目统计、体积估算、过期判断、汇总', () => {
  assert.equal(countItems([1, 2, 3]), 3);
  assert.equal(countItems({ a: 1, b: 2 }), 2);
  assert.equal(countItems('nope'), 0);
  assert.ok(estimateBytes([{ w: 'abandon' }]) > 10);
  assert.equal(estimateBytes(undefined), 0);

  assert.equal(isStale(null, '1.3.1'), true);
  assert.equal(isStale({ version: '1.3.0' }, '1.3.1'), true);
  assert.equal(isStale({ version: '1.3.1' }, '1.3.1'), false);

  const stats = summarize([
    { key: 'lexicon', version: '1.3.1', cachedAt: 'x', items: 4540, bytes: 300000, value: null },
    null,
    { key: 'papers', version: '1.3.1', cachedAt: 'y', items: 6, bytes: 20000, value: null },
  ]);
  assert.equal(stats.records.length, 2);
  assert.equal(stats.totalBytes, 320000);
  assert.equal(summarize([], false).available, false);
});

test('pwa：file:// 与非安全上下文不注册，https 下注册', async () => {
  assert.equal(pwa.canRegisterSw({ hasServiceWorker: true, protocol: 'file:', isSecureContext: false }), false);
  assert.equal(pwa.canRegisterSw({ hasServiceWorker: true, protocol: 'http:', isSecureContext: false }), false);
  assert.equal(pwa.canRegisterSw({ hasServiceWorker: false, protocol: 'https:', isSecureContext: true }), false);
  assert.equal(pwa.canRegisterSw({ hasServiceWorker: true, protocol: 'https:', isSecureContext: true }), true);
  assert.equal(pwa.canRegisterSw({ hasServiceWorker: true, protocol: 'http:', isSecureContext: true }), true);
});

test('pwa：注册失败被吞掉（返回 register-failed），不抛异常', async () => {
  // Node 24 的 navigator 是只读全局，必须用 defineProperty 覆盖
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const hadLocation = 'location' in globalThis;
  const hadWindow = 'window' in globalThis;
  const originalLocation = globalThis.location;
  const originalWindow = globalThis.window;
  pwa.__resetPwaForTest();
  Object.defineProperty(globalThis, 'navigator', {
    value: { serviceWorker: { register: async () => { throw new Error('blocked'); } } },
    configurable: true,
    writable: true,
  });
  globalThis.location = { protocol: 'https:', reload: () => {} };
  globalThis.window = { isSecureContext: true };
  try {
    const res = await pwa.initPwa('sw.js');
    assert.equal(res.registered, false);
    assert.equal(res.reason, 'register-failed');
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    if (hadLocation) globalThis.location = originalLocation; else delete globalThis.location;
    if (hadWindow) globalThis.window = originalWindow; else delete globalThis.window;
    pwa.__resetPwaForTest();
  }
});
