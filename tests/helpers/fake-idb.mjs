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
    put: (value, key) => {
      // 【规范门禁·永久】按 MDN IDBObjectStore.put / IndexedDB 3.0：
      //  1) in-line key（keyPath）或有 key generator 的仓收到显式 key → DataError
      //     （历史 bug：18 处 put(value, key) 在 keyPath 仓上真机会静默 DataError，
      //      被各层 try/catch 吞掉表现为「不持久化」；已按方案 A 全部去掉冗余 key）
      //  2) out-of-line 仓（无 keyPath 且无 generator）缺 key → DataError
      if ((meta.keyPath || meta.autoIncrement) && key !== undefined) {
        throw new DOMException(
          "The object store uses in-line keys or has a key generator, and a key parameter was provided.",
          'DataError',
        );
      }
      if (!meta.keyPath && !meta.autoIncrement && key === undefined) {
        throw new DOMException(
          "The object store uses out-of-line keys and has no key generator, and no key parameter was provided.",
          'DataError',
        );
      }
      return request(() => {
      let storeKey = key;
      if (storeKey === undefined) {
        if (meta.keyPath) storeKey = value[meta.keyPath];
        // 自增主键（attempts 仓库用）：桩件也要模拟，否则多条记录会互相覆盖
        else if (meta.autoIncrement) storeKey = String(++meta.counter);
      }
      map.set(String(storeKey), value);
      return storeKey;
      });
    },
    get: (key) => request(() => map.get(String(key))),
    getAll: () => request(() => [...map.values()]),
    delete: (key) => request(() => { map.delete(String(key)); return undefined; }),
    clear: () => request(() => { map.clear(); return undefined; }),
    index: () => ({ getAll: () => request(() => [...map.values()]) }),
  });

  const db = {
    objectStoreNames: { contains: (name) => stores.has(name) },
    createObjectStore: (name, options = {}) => {
      stores.set(name, {
        map: new Map(),
        meta: { keyPath: options.keyPath, autoIncrement: !!options.autoIncrement, counter: 0 },
      });
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
