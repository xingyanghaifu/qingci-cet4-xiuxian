/**
 * 奇遇事件（阶段 B）：事件池、日限、日志口径、通知式结算
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/load-ts.mjs';
import { makeFakeIdb } from './helpers/fake-idb.mjs';

const EN = await loadTs('src/services/encounters.ts');

test('事件池：6 个事件、概率合计合理、时长可调', () => {
  assert.strictEqual(EN.ENCOUNTER_POOL.length, 6);
  const types = EN.ENCOUNTER_POOL.map((e) => e.type).sort();
  assert.deepStrictEqual(types, ['beast', 'cave', 'demon_raid', 'old_master', 'qi_rain', 'scroll']);
  for (const e of EN.ENCOUNTER_POOL) {
    assert.ok(e.probability > 0 && e.probability < 1, `${e.type} 概率区间`);
    assert.ok(e.durationMs > 0 && e.effect && e.title && e.desc, `${e.type} 字段完整`);
  }
  // 概率合计 < 1（其余概率为「无奇遇」）
  const sum = EN.ENCOUNTER_POOL.reduce((s, e) => s + e.probability, 0);
  assert.ok(sum < 1 && sum > 0.2, `总概率 ${sum} 应在 0–1 之间留出无触发区间`);
  assert.strictEqual(EN.ENCOUNTER_DAILY_LIMIT, 2);
});

test('日限：countToday>=2 时 roll 返回 null（验收 8）', () => {
  assert.ok(EN.rollEncounter(12345, 0) !== undefined, '0 次应可掷');
  assert.strictEqual(EN.rollEncounter(12345, 2), null, '达上限不再触发');
  assert.strictEqual(EN.rollEncounter(12345, 5), null);
});

test('掷骰确定性：同 seed 同结果', () => {
  const a = EN.rollEncounter(999, 0);
  const b = EN.rollEncounter(999, 0);
  assert.strictEqual(a, b, '种子化可复现');
});

test('日限口径：localDateKey 本地时区（R13）', () => {
  const now = Date.now();
  assert.match(EN.localDateKey(now), /^\d{4}-\d{2}-\d{2}$/);
  // 本地时区：构造一个本地时间的日期串
  const d = new Date(2026, 9, 4, 12, 0, 0); // 本地 2026-10-04
  assert.strictEqual(EN.localDateKey(d.getTime()), '2026-10-04');
  // 23:00 与 01:00 属不同本地日
  assert.strictEqual(EN.localDateKey(new Date(2026, 9, 4, 23, 0).getTime()), '2026-10-04');
  assert.strictEqual(EN.localDateKey(new Date(2026, 9, 5, 1, 0).getTime()), '2026-10-05');
});

test('记录/查询/结算：跨会话保留', async () => {
  const idb = makeFakeIdb();
  const e1 = EN.makeEncounter('qi_rain', Date.now());
  const e2 = EN.makeEncounter('cave', Date.now());
  assert.ok(e1 && e2 && e1.type === 'qi_rain');
  await EN.recordEncounter(e1, idb);
  await EN.recordEncounter(e2, idb);
  assert.strictEqual(await EN.countToday(EN.localDateKey(), idb), 2);
  const pending = await EN.listPendingEncounters(Date.now(), idb);
  assert.strictEqual(pending.length, 2, '都未结算且未过期');
  await EN.resolveEncounter(e1.id, idb);
  const pending2 = await EN.listPendingEncounters(Date.now(), idb);
  assert.strictEqual(pending2.length, 1, '结算后从待办移除');
});

test('过期奇遇不进待办', async () => {
  const idb = makeFakeIdb();
  const expired = { id: 'e-x', type: 'qi_rain', day: EN.localDateKey(), triggeredAt: new Date(Date.now() - 7200000).toISOString(), expiresAt: new Date(Date.now() - 1000).toISOString(), resolved: false, payload: {} };
  await EN.recordEncounter(expired, idb);
  const pending = await EN.listPendingEncounters(Date.now(), idb);
  assert.strictEqual(pending.length, 0, '过期不展示');
});

test('昨日记录不计入今日', async () => {
  const idb = makeFakeIdb();
  const y = EN.localDateKey(Date.now() - 86400000);
  await EN.recordEncounter({ id: 'e-y', type: 'scroll', day: y, triggeredAt: new Date(Date.now() - 86400000).toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(), resolved: false, payload: {} }, idb);
  assert.strictEqual(await EN.countToday(EN.localDateKey(), idb), 0, '日限只算今天');
});

test('库存不可用时全部降级不抛错', async () => {
  const bad = undefined; // Node 无真实 indexedDB → 走 catch
  assert.deepStrictEqual(await EN.listTodayEncounters(EN.localDateKey(), bad), []);
  assert.strictEqual(await EN.countToday(EN.localDateKey(), bad), 0);
  assert.strictEqual(await EN.resolveEncounter('nope', bad), false);
});