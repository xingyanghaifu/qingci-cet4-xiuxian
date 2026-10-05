/**
 * IDB schema v5 单元测试（修炼生态前置步）
 *
 * 覆盖：
 *   1. 版本与仓库常量（v6、7 旧 + 10 修炼新 + 2 多词库新、OFFLINE_DB_VERSION 跟随）
 *   2. 空库升级 → 19 仓全建，新仓的 keyPath / 选项 / 索引逐一对表
 *      （索引同时断言**索引名与字段名**——后续查询按 `store.index(name)` 取，
 *        名字错了会静默失败，所以名/路径都要钉住）
 *   3. 幂等：全部仓已存在时二次调用零创建（用户点名要求）
 *   4. 老仓保护：v4 存量 7 仓在升级中不被重建（存量数据零触碰）
 *   5. v1.8.2：vocabLex / mistakesLex 是**新增**复合键仓，老的 vocab / mistakes
 *      必须原地保留（keyPath 不得改，否则存量进度会被清库重建）
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
// v1.8.2 阶段 A5：按词库分开的多词库 SRS / 错题本
const LEX_STORES = ['vocabLex', 'mistakesLex'];
const ALL_STORES = [...OLD_STORES, ...NEW_STORES, ...LEX_STORES];

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
const expectStoreKeyPath = (rec, keyPath) => {
  assert.ok(rec, '仓库未创建');
  assert.strictEqual(rec.options.keyPath, keyPath, `${rec.name} 的 keyPath 应为 ${keyPath}`);
};

test('schema：IDB_VERSION=6 与 19 个仓库常量', () => {
  assert.strictEqual(idb.IDB_VERSION, 6);
  assert.strictEqual(offline.OFFLINE_DB_VERSION, 6, 'OFFLINE_DB_VERSION 应跟随 IDB_VERSION');
  for (const name of ALL_STORES) {
    assert.ok(Object.values(idb.IDB_STORES).includes(name), `缺少仓库常量：${name}`);
  }
  assert.strictEqual(Object.keys(idb.IDB_STORES).length, 19, '仓库总数应为 19');
});

test('schema：空库升级一次性建齐 19 仓，新仓结构逐一对表', () => {
  const { db, created } = makeDb([]);
  idb.upgradeSchema(db);

  assert.strictEqual(created.length, 19, `应创建 19 个仓，实际 ${created.length}`);

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

test('schema：v1.8.2 多词库仓用复合键，老仓 keyPath 一字不改', () => {
  const { db, created } = makeDb([]);
  idb.upgradeSchema(db);

  // 老仓：keyPath 必须仍是单字段，改了等于清库重建 → 存量进度全没
  expectStoreKeyPath(recOf(created, 'vocab'), 'w');
  expectStoreKeyPath(recOf(created, 'mistakes'), 'id');
  // 新仓：复合键 '<词库Id> <单词>' / '<词库Id> <错题id>'
  expectStoreKeyPath(recOf(created, 'vocabLex'), 'k');
  expectStoreKeyPath(recOf(created, 'mistakesLex'), 'k');
  // 两个新仓都建 lx 索引，供按词库筛选
  expectIndex(recOf(created, 'vocabLex'), 'lx', 'lx');
  expectIndex(recOf(created, 'mistakesLex'), 'lx', 'lx');
  expectIndex(recOf(created, 'vocabLex'), 'nextReviewAt', 'nextReviewAt');
  expectIndex(recOf(created, 'mistakesLex'), 'nextReviewAt', 'nextReviewAt');
});

test('schema：二次调用幂等——全部仓已存在时零创建', () => {
  const { db, created } = makeDb(ALL_STORES);
  idb.upgradeSchema(db);
  assert.strictEqual(created.length, 0, '幂等失败：不应再次创建任何仓或索引');
});

test('schema：v4 老仓保护——存量 7 仓不被重建', () => {
  const { db, created } = makeDb(OLD_STORES);
  idb.upgradeSchema(db);
  const createdNames = created.map((r) => r.name);
  for (const old of OLD_STORES) {
    assert.ok(!createdNames.includes(old), `老仓 ${old} 被重建了（存量数据会被清空）`);
  }
  // v4 老库升级到 v6：补建 10 个修炼仓 + 2 个多词库仓，一个不多一个不少
  assert.deepStrictEqual(
    [...createdNames].sort(),
    [...NEW_STORES, ...LEX_STORES].sort(),
    '应只补建 12 个新仓，不多不少',
  );
});
