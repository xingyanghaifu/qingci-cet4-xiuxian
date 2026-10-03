/**
 * 道具库存测试（阶段 A2 · inventory：购买 / 效果 / 消耗 / 复合 keyPath）
 *
 * 覆盖神谕验收 2-5、7-12 的逻辑面：
 * 护道符计数与消耗、聚灵阵 TTL 与续费、记忆丹 7 天窗口与重复退款、
 * 参悟古籍永久解锁与重复退款、资金不足全链、效果缓存重建。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/load-ts.mjs';
import { makeFakeIdb } from './helpers/fake-idb.mjs';

const eco = await loadTs('src/services/economy.ts');
const trib = await loadTs('src/services/tribulation.ts');
const H = 3600 * 1000;
const D = 24 * H;
const tick = () => new Promise((r) => setTimeout(r, 5));

test('护道符：购买累加 + 消耗链 + 缓存同步', async () => {
  const idb = makeFakeIdb();
  const state = { spirit: 1000 };
  const r1 = await eco.purchase(state, 'talisman', {}, idb);
  assert.strictEqual(r1.ok, true);
  assert.strictEqual(state.spirit, 850, '扣 150');
  await tick();
  const sum1 = await trib.loadInventorySummary(Date.now(), idb);
  assert.strictEqual(sum1.talisman, 1, '库存 1 张');
  await eco.purchase(state, 'talisman', {}, idb);
  await tick();
  const sum2 = await trib.loadInventorySummary(Date.now(), idb);
  assert.strictEqual(sum2.talisman, 2, '累加到 2 张');
  await eco.refreshInventory(idb);
  assert.strictEqual(eco.talismanCount(), 2, '效果缓存同步');
  assert.strictEqual(await eco.consumeTalisman(idb), true);
  assert.strictEqual(eco.talismanCount(), 1, '消耗后缓存 -1');
  assert.strictEqual(await eco.consumeTalisman(idb), true);
  assert.strictEqual(await eco.consumeTalisman(idb), false, '第 3 次无货');
  assert.strictEqual(eco.talismanCount(), 0);
  await tick();
  const sum3 = await trib.loadInventorySummary(Date.now(), idb);
  assert.strictEqual(sum3.talisman, 0, '库存归零');
});

test('聚灵阵：24h 生效 + 过期失效 + 续费叠加', async () => {
  const idb = makeFakeIdb();
  const state = { spirit: 500 };
  const t0 = Date.now();
  const r = await eco.purchase(state, 'array', { now: t0 }, idb);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(state.spirit, 400, '扣 100');
  await eco.refreshInventory(idb, t0 + 6 * H);
  assert.strictEqual(eco.arrayActive(t0 + 6 * H), true, '6 小时后仍生效');
  assert.strictEqual(eco.arrayActive(t0 + 25 * H), false, '25 小时后失效');
  const sumActive = await trib.loadInventorySummary(t0 + 6 * H, idb);
  assert.ok(sumActive.arrayUntil, '卡片能看到生效截止');
  // 续费：在生效期内再买 → 截止叠加到约 now+48h
  const t1 = t0 + 6 * H;
  await eco.purchase(state, 'array', { now: t1 }, idb);
  await tick();
  await eco.refreshInventory(idb, t1);
  const until = eco.arrayActive(t1) ? (await trib.loadInventorySummary(t1, idb)).arrayUntil : null;
  const expected = new Date(t1 + D).toISOString();
  assert.ok(until, '续费后仍生效');
  // 续费语义：基于上一次截止（t0+24h）叠加 → ≈ t1... 精确值 = max(prevUntil, now)+24h = (t0+24h)+24h
  const prevUntil = t0 + D;
  const target = new Date(prevUntil + D).toISOString();
  assert.strictEqual(until, target, '续费叠加上一次截止（不是重置）');
});

test('记忆丹：需选词 / 7 天窗口 / 重复购买拦截(查重先于扣费) / 过期出窗', async () => {
  const idb = makeFakeIdb();
  const state = { spirit: 300 };
  const t0 = Date.now();
  // 未给目标词 → 拒绝且不扣钱
  const noWord = await eco.purchase(state, 'pill', { now: t0 }, idb);
  assert.strictEqual(noWord.ok, false);
  assert.strictEqual(noWord.reason, 'invalid-word');
  assert.strictEqual(state.spirit, 300, '未选词不得扣钱');
  // 正常购买
  const ok = await eco.purchase(state, 'pill', { targetId: 'About', now: t0 }, idb);
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(state.spirit, 220, '扣 80');
  await tick();
  const sum1 = await trib.loadInventorySummary(t0 + D, idb);
  assert.deepStrictEqual(sum1.pills, ['about'], 'targetId 小写归一 + 复合 keyPath');
  await eco.refreshInventory(idb, t0 + 3 * D);
  assert.deepStrictEqual(eco.activePillWords(t0 + 3 * D), ['about'], '3 天内仍在队列跳过窗口');
  assert.deepStrictEqual(eco.activePillWords(t0 + 8 * D), [], '7 天后出窗');
  const sum2 = await trib.loadInventorySummary(t0 + 8 * D, idb);
  assert.deepStrictEqual(sum2.pills, [], '摘要同样出窗');
  // 重复购买 → 查重先于扣费：不产生任何扣款与流水
  const dup = await eco.purchase(state, 'pill', { targetId: 'about', now: t0 + D }, idb);
  assert.strictEqual(dup.ok, false);
  assert.strictEqual(dup.reason, 'already-active');
  assert.strictEqual(state.spirit, 220, '重复购买不产生扣款（净额不变）');
  await tick();
  const txs = await eco.listRecentTransactions(10, idb);
  assert.strictEqual(txs.length, 1, '仅首次购买一条流水（查重不进账本）');
});

test('参悟古籍：永久解锁 + 重复购买拦截(查重先于扣费) + 词级 keyPath', async () => {
  const idb = makeFakeIdb();
  const state = { spirit: 200 };
  const ok = await eco.purchase(state, 'book', { targetId: 'abandon' }, idb);
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(state.spirit, 150, '扣 50');
  await eco.refreshInventory(idb);
  assert.strictEqual(eco.bookUnlocked('abandon'), true, '解锁');
  assert.strictEqual(eco.bookUnlocked('ABANDON'), true, '大小写归一');
  assert.strictEqual(eco.bookUnlocked('xray'), false);
  assert.deepStrictEqual(eco.unlockedBookWords(), ['abandon']);
  const sum = await trib.loadInventorySummary(Date.now(), idb);
  assert.deepStrictEqual(sum.books, ['abandon'], '摘要可见');
  // 永久：8 天后仍解锁
  await eco.refreshInventory(idb, Date.now() + 8 * D);
  assert.strictEqual(eco.bookUnlocked('abandon'), true, '无 TTL 永久有效');
  // 重复 → 查重先于扣费：不扣款
  const dup = await eco.purchase(state, 'book', { targetId: 'abandon' }, idb);
  assert.strictEqual(dup.reason, 'already-owned');
  assert.strictEqual(state.spirit, 150, '重复购买不产生扣款');
});

test('资金不足：不写库存、不写流水（全链原子）', async () => {
  const idb = makeFakeIdb();
  const state = { spirit: 60 };
  const r = await eco.purchase(state, 'array', {}, idb);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'no-funds');
  assert.strictEqual(state.spirit, 60, '余额不变');
  await tick();
  assert.strictEqual((await eco.listRecentTransactions(10, idb)).length, 0, '无流水');
  const sum = await trib.loadInventorySummary(Date.now(), idb);
  assert.strictEqual(sum.arrayUntil, null, '无库存写入');
});

test('效果缓存：空仓 refresh 全零（启动即静默降级）', async () => {
  const idb = makeFakeIdb();
  await eco.refreshInventory(idb);
  assert.strictEqual(eco.talismanCount(), 0);
  assert.strictEqual(eco.arrayActive(), false);
  assert.deepStrictEqual(eco.activePillWords(), []);
  assert.deepStrictEqual(eco.unlockedBookWords(), []);
  // 不可用仓（null factory 走真实 indexedDB → Node 无 → catch → 全零）
  const c = await eco.refreshInventory(undefined);
  assert.strictEqual(c.talisman, 0, '降级不抛错');
});
