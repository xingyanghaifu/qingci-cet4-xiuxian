/**
 * IDB schema v5 单元测试（修炼生态前置步）
 *
 * 覆盖：
 *   1. 版本与仓库常量（v5、7 旧 + 10 新、OFFLINE_DB_VERSION 跟随）
 *   2. 空库升级 → 17 仓全建，10 个新仓的 keyPath / 选项 / 索引逐一对表
 *      （索引同时断言**索引名与字段名**——后续查询按 `store.index(name)` 取，
 *        名字错了会静默失败，所以名/路径都要钉住）
 *   3. 幂等：全部仓已存在时二次调用零创建（用户点名要求）
 *   4. 老仓保护：v4 存量 7 仓在升级中不被重建（存量数据零触碰）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/load-ts.mjs';

const idb = await loadTs('src/services/idb.ts');
const offline = await loadTs('src/services/offline-store.ts');

const OLD_STORES = ['datasets', 'mistakes', 'reviews', 'meta', 'vocab', 'attempts', 'reports'];
const NEW_STORES = [
  'tribulations', 'inventory', 'qiLog', 'demons', 'encounters',
  'spiritField', 'cave', 'duels', 'transmissions', 'sect',
];

/** MinimalDatabase 桩：Set 模拟 contains，createObjectStore 记录创建与索引 */
function makeDb(existing = []) {
  const set = new Set(existing);
  const created = [];
  const db = {
    objectStoreNames: { contains: (n) => set.has(n) },
    createObjectStore(name, options) {
      const rec = { name, options: options || {}, indexes: [] };
      created.push(rec);
      set.add(name);
      return {
        createIndex(indexName, keyPath) {
          rec.indexes.push({ name: indexName, keyPath });
          return {};
        },
      };
    },
    transaction() { throw new Error('upgradeSchema 不应开启事务'); },
    close() { /* noop */ },
  };
  return { db, created };
}
const recOf = (created, name) => created.find((r) => r.name === name);
const expectIndex = (rec, indexName, keyPath) => {
  const hit = (rec.indexes || []).find((i) => i.name === indexName);
  assert.ok(hit, `${rec.name} 缺少索引 ${indexName}`);
  assert.strictEqual(hit.name, indexName, `${rec.name} 索引名应为 ${indexName}`);
  assert.strictEqual(hit.keyPath, keyPath, `${rec.name}.index('${indexName}') 字段应为 ${keyPath}`);
};

test('schema：IDB_VERSION=5 与 17 个仓库常量', () => {
  assert.strictEqual(idb.IDB_VERSION, 5);
  assert.strictEqual(offline.OFFLINE_DB_VERSION, 5, 'OFFLINE_DB_VERSION 应跟随 IDB_VERSION');
  for (const name of [...OLD_STORES, ...NEW_STORES]) {
    assert.ok(Object.values(idb.IDB_STORES).includes(name), `缺少仓库常量：${name}`);
  }
  assert.strictEqual(Object.keys(idb.IDB_STORES).length, 17, '仓库总数应为 17');
});

test('schema：空库升级一次性建齐 17 仓，新仓结构逐一对表', () => {
  const { db, created } = makeDb([]);
  idb.upgradeSchema(db);

  assert.strictEqual(created.length, 17, `应创建 17 个仓，实际 ${created.length}`);

  // keyPath / 选项
  const expectStore = (name, options) => {
    const rec = recOf(created, name);
    assert.ok(rec, `未创建 ${name}`);
    assert.deepStrictEqual(rec.options, options, `${name} 建仓选项不符`);
  };
  expectStore('tribulations', { keyPath: 'id' });
  expectStore('inventory', { keyPath: 'id' }); // 复合规则在 idb.ts 注释：常驻=itemId；按词=itemId:targetId
  expectStore('qiLog', { autoIncrement: true });
  expectStore('demons', { keyPath: 'id' });
  expectStore('encounters', { keyPath: 'id' });
  expectStore('spiritField', { keyPath: 'id' });
  expectStore('cave', { keyPath: 'id' });
  expectStore('duels', { keyPath: 'id' });
  expectStore('transmissions', { keyPath: 'id' });
  expectStore('sect', { keyPath: 'id' });

  // 索引：索引名 + 字段名双断言（后续 index('name') 查询依赖名字）
  expectIndex(recOf(created, 'qiLog'), 'timestamp', 'timestamp');
  expectIndex(recOf(created, 'demons'), 'questionId', 'questionId');
  expectIndex(recOf(created, 'demons'), 'level', 'level');
  expectIndex(recOf(created, 'encounters'), 'day', 'day');
  expectIndex(recOf(created, 'spiritField'), 'plotIndex', 'plotIndex');
  expectIndex(recOf(created, 'duels'), 'startedAt', 'startedAt');
  expectIndex(recOf(created, 'transmissions'), 'word', 'word');

  // 无索引仓不应多建索引
  for (const name of ['tribulations', 'inventory', 'cave', 'sect']) {
    assert.strictEqual(recOf(created, name).indexes.length, 0, `${name} 不应有索引`);
  }
});

test('schema：二次调用幂等——全部仓已存在时零创建', () => {
  const { db, created } = makeDb([...OLD_STORES, ...NEW_STORES]);
  idb.upgradeSchema(db);
  assert.strictEqual(created.length, 0, '幂等失败：不应再次创建任何仓或索引');
});

test('schema：v4 老仓保护——存量 7 仓不被重建', () => {
  const { db, created } = makeDb([...OLD_STORES]);
  idb.upgradeSchema(db);
  const createdNames = created.map((r) => r.name);
  for (const old of OLD_STORES) {
    assert.ok(!createdNames.includes(old), `老仓 ${old} 被重建了（存量数据会被清空）`);
  }
  assert.deepStrictEqual(
    [...createdNames].sort(),
    [...NEW_STORES].sort(),
    '应只补建 10 个新仓，不多不少',
  );
});
