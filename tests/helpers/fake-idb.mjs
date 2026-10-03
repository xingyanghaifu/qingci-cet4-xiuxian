/**
 * 测试辅助：最小 IndexedDB 桩件
 *
 * 只实现本应用真正用到的 API：open / onupgradeneeded / transaction / objectStore /
 * put / get / getAll / delete / clear / index。行为足够真实（异步回调、按 keyPath 校验），
 * 又不引入 fake-indexeddb 这类额外依赖。
 */
export function makeFakeIdb() {
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

  const makeStore = (map, meta) => ({
    put: (value, key) => request(() => {
      const storeKey = key !== undefined ? key : (meta.keyPath ? value[meta.keyPath] : undefined);
      map.set(String(storeKey), value);
      return storeKey;
    }),
    get: (key) => request(() => map.get(String(key))),
    getAll: () => request(() => [...map.values()]),
    delete: (key) => request(() => { map.delete(String(key)); return undefined; }),
    clear: () => request(() => { map.clear(); return undefined; }),
    index: () => ({ getAll: () => request(() => [...map.values()]) }),
  });

  const db = {
    objectStoreNames: { contains: (name) => stores.has(name) },
    createObjectStore: (name, options = {}) => {
      stores.set(name, { map: new Map(), meta: { keyPath: options.keyPath } });
      return { createIndex: () => ({}) };
    },
    transaction: (name) => ({
      objectStore: () => {
        const entry = stores.get(name);
        if (!entry) throw new Error('对象仓库不存在: ' + name);
        return makeStore(entry.map, entry.meta);
      },
    }),
    close: () => {},
  };

  let upgradeHandler = null;

  return {
    open: () => {
      const req = {
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
        result: db,
      };
      setTimeout(() => {
        try {
          if (req.onupgradeneeded) req.onupgradeneeded({ target: req });
          if (req.onsuccess) req.onsuccess({ target: req });
        } catch (e) {
          if (req.onerror) req.onerror({ target: req });
        }
      }, 0);
      return req;
    },
    /** 便于断言：某个仓库里有多少条记录 */
    _count(name) {
      const entry = stores.get(name);
      return entry ? entry.map.size : 0;
    },
    _names() {
      return [...stores.keys()];
    },
    _setUpgradeHandler(fn) {
      upgradeHandler = fn;
    },
  };
}
