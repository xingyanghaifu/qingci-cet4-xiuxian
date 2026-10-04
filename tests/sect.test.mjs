/**
 * 阶段 D · 道场建设测试（src/services/sect-facilities.ts + functions/api/sect.ts）
 *
 * 覆盖：捐献扣款与流水 / 激活阈值（progress ≥ cost）与重复激活幂等 /
 *       三个 buff 数值（0.2 / 1 / 0.05）/ 多设施独立建设不串账 / 灵石不足 no-funds /
 *       读时自愈 / 端点服务端累计（不信任客户端）、数额夹紧 1..10000、
 *       成员只回数量不回 ID、D1 缺失 503、IDB 降级。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/load-ts.mjs';
import { makeFakeIdb } from './helpers/fake-idb.mjs';
import { makeFakeD1, makeCtx } from './helpers/fake-d1.mjs';

const sect = await loadTs('src/services/sect-facilities.ts');
const eco = await loadTs('src/services/economy.ts');
const api = await loadTs('functions/api/sect.ts');

const tick = () => new Promise((r) => setTimeout(r, 5));
const post = (body, db) => api.onRequestPost(makeCtx('/api/sect', body, db));

/* ───────────────── 定义与本机捐献 ───────────────── */

test('facilityDef：三个设施定义齐备（1000/1500/2000）+ 未知 null', () => {
  assert.deepEqual(
    sect.FACILITY_DEFS.map((f) => [f.id, f.cost]),
    [['scripture_hall', 1000], ['alchemy_room', 1500], ['arena', 2000]],
  );
  assert.equal(sect.facilityDef('scripture_hall').name, '藏经阁');
  assert.equal(sect.facilityDef('nope'), null);
});

test('donate 扣款：扣灵石 + progress 累加 + 流水 sect_donate + 成员收录', async () => {
  const idb = makeFakeIdb();
  const state = { spirit: 500 };
  const r = await sect.donate('scripture_hall', 300, state, idb, 'me-1');
  assert.equal(r.ok, true);
  assert.equal(r.facility.progress, 300);
  assert.equal(r.facility.level, 0, '未达 1000 不激活');
  assert.equal(state.spirit, 200, '扣 300');
  await tick();
  const txs = await eco.listRecentTransactions(5, idb);
  assert.equal(txs[0].amount, -300);
  assert.equal(txs[0].reason, 'sect_donate');
  const loaded = await sect.loadSect(idb);
  assert.equal(loaded.totalContributed, 300);
  assert.deepEqual(loaded.members, ['me-1']);
});

test('防御：灵石不足 no-funds（不扣不加）、0 元 bad-amount、未知设施 unknown-facility', async () => {
  const idb = makeFakeIdb();
  const state = { spirit: 50 };
  const poor = await sect.donate('scripture_hall', 300, state, idb);
  assert.equal(poor.ok, false);
  assert.equal(poor.reason, 'no-funds');
  assert.equal(state.spirit, 50, '余额不动');
  const zero = await sect.donate('scripture_hall', 0, state, idb);
  assert.equal(zero.reason, 'bad-amount');
  const unknown = await sect.donate('nope', 10, state, idb);
  assert.equal(unknown.reason, 'unknown-facility');
  await tick();
  assert.equal((await eco.listRecentTransactions(5, idb)).length, 0, '失败不产生流水');
  assert.equal((await sect.loadSect(idb)).facilities[0].progress, 0, '进度不动');
});

test('激活阈值：捐满 cost → level=1 + activatedAt；后续捐献不改激活时间（幂等）', async () => {
  const idb = makeFakeIdb();
  const state = { spirit: 5000 };
  await sect.donate('scripture_hall', 600, state, idb, 'me-1');
  let fac = (await sect.loadSect(idb)).facilities.find((f) => f.id === 'scripture_hall');
  assert.equal(fac.level, 0, '600/1000 未达标');
  const r2 = await sect.donate('scripture_hall', 900, state, idb, 'me-2');
  fac = r2.facility;
  assert.equal(fac.progress, 1000, 'progress 封顶 cost');
  assert.equal(fac.level, 1, '达标激活');
  assert.ok(fac.activatedAt);
  const activatedAt = fac.activatedAt;
  const r3 = await sect.donate('scripture_hall', 100, state, idb, 'me-3');
  assert.equal(r3.facility.activatedAt, activatedAt, '重复激活幂等（时间不变）');
  const loaded = await sect.loadSect(idb);
  assert.equal(loaded.totalContributed, 600 + 900 + 100, '总捐献不受 progress 封顶影响');
});

test('多设施同时建设：三设施独立累计、互不串账', async () => {
  const idb = makeFakeIdb();
  const state = { spirit: 99999 };
  await sect.donate('scripture_hall', 100, state, idb);
  await sect.donate('alchemy_room', 250, state, idb);
  await sect.donate('arena', 400, state, idb);
  await sect.donate('scripture_hall', 50, state, idb);
  const s = await sect.loadSect(idb);
  const by = Object.fromEntries(s.facilities.map((f) => [f.id, f.progress]));
  assert.deepEqual(by, { scripture_hall: 150, alchemy_room: 250, arena: 400 });
  assert.equal(s.totalContributed, 800);
});

test('getFacilityBuffs：未激活全 0；三设施全激活 → 0.2 / 1 / 0.05', async () => {
  const idb = makeFakeIdb();
  const idle = await sect.loadSect(idb);
  assert.deepEqual(sect.getFacilityBuffs(idle.facilities), {
    detailUnlockBonus: 0, monthlyTalisman: 0, duelWinBonus: 0,
  });
  const state = { spirit: 99999 };
  await sect.donate('scripture_hall', 1000, state, idb);
  await sect.donate('alchemy_room', 1500, state, idb);
  await sect.donate('arena', 2000, state, idb);
  const s = await sect.loadSect(idb);
  assert.ok(s.facilities.every((f) => f.level === 1), '三设施全部激活');
  assert.deepEqual(sect.getFacilityBuffs(s.facilities), {
    detailUnlockBonus: 0.2, monthlyTalisman: 1, duelWinBonus: 0.05,
  });
});

test('facilityPercent 换算 + checkFacilityActivation 读时自愈', async () => {
  const idb = makeFakeIdb();
  const s = await sect.loadSect(idb);
  const fac = s.facilities.find((f) => f.id === 'arena');
  fac.progress = 2000; // 已达标
  fac.level = 0;       // 脏状态：未置激活
  await sect.saveSect(s, idb);
  assert.equal(sect.facilityPercent(fac), 100);
  assert.equal(sect.facilityPercent({ id: 'arena', name: '', cost: 2000, progress: 500, level: 0, activatedAt: null }), 25);
  const healed = await sect.checkFacilityActivation('arena', idb);
  assert.equal(healed.level, 1, '读时自愈补正');
  assert.ok(healed.activatedAt);
  const again = await sect.loadSect(idb);
  assert.equal(again.facilities.find((f) => f.id === 'arena').level, 1, '自愈已持久化');
});

/* ───────────────── 端点 ───────────────── */

test('端点参数：D1 缺失 503；未知设施/缺 memberId/未知 action 400；数额夹紧 1..10000', async () => {
  const noDb = await post({ action: 'get', memberId: 'm' }, null);
  assert.equal(noDb.status, 503);
  assert.equal((await noDb.json()).status, 'unavailable');

  const db = makeFakeD1();
  assert.equal((await post({ action: 'donate', facilityId: 'nope', amount: 10, memberId: 'm' }, db)).status, 400, '未知设施');
  assert.equal((await post({ action: 'donate', facilityId: 'arena', amount: 10 }, db)).status, 400, '缺 memberId');
  assert.equal((await post({ action: 'boom', memberId: 'm' }, db)).status, 400, '未知 action');

  await post({ action: 'donate', facilityId: 'arena', amount: 0, memberId: 'm' }, db);
  assert.equal(db._tables().facilities.get('arena').progress, 1, 'amount 0 夹到 1');
  await post({ action: 'donate', facilityId: 'arena', amount: 99999, memberId: 'm' }, db);
  assert.equal(db._tables().facilities.get('arena').progress, 10001, '99999 夹到 10000 后服务端累加');
});

test('端点捐献：服务端累计不信任客户端；get 回三设施与聚合、成员只回数量', async () => {
  const db = makeFakeD1();
  let res = await post({ action: 'donate', facilityId: 'scripture_hall', amount: 400, memberId: 'alice' }, db);
  assert.equal(res.status, 200);
  let body = await res.json();
  assert.equal(body.data.facilityId, 'scripture_hall');
  assert.equal(body.data.progress, 400);
  assert.equal(body.data.level, 0);

  res = await post({ action: 'donate', facilityId: 'scripture_hall', amount: 600, memberId: 'bob' }, db);
  body = await res.json();
  assert.equal(body.data.progress, 1000, '服务端累计 400+600');
  assert.equal(body.data.level, 1, '达标激活');
  assert.ok(body.data.activatedAt);

  const t = db._tables();
  assert.equal(t.donations.length, 2, '捐献流水逐笔落库');
  assert.deepEqual(t.donations.map((d) => d.member_id), ['alice', 'bob']);

  res = await post({ action: 'get', memberId: 'anyone' }, db);
  body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.data.facilities.length, 3, '固定三设施视图');
  assert.equal(body.data.totalContributed, 1000);
  assert.equal(body.data.memberCount, 2, '成员只回数量');
  assert.ok(!JSON.stringify(body.data).includes('alice'), '不回任何成员 ID');
});

test('端点重复激活幂等：达标后 activated_at 不再变化', async () => {
  const db = makeFakeD1();
  await post({ action: 'donate', facilityId: 'arena', amount: 2000, memberId: 'm1' }, db);
  const first = db._tables().facilities.get('arena').activated_at;
  assert.ok(first, '一次捐满即激活');
  await post({ action: 'donate', facilityId: 'arena', amount: 50, memberId: 'm2' }, db);
  assert.equal(db._tables().facilities.get('arena').activated_at, first, '不重复写激活时间');
});

test('IDB 降级：不可用时 loadSect 返回默认道场、saveSect false、donate unavailable', async () => {
  const s = await sect.loadSect(null);
  assert.equal(s.id, 'main');
  assert.equal(s.facilities.length, 3, '默认三设施齐备');
  assert.equal(s.totalContributed, 0);
  assert.equal(await sect.saveSect({ ...s }, null), false);
  const r = await sect.donate('scripture_hall', 100, { spirit: 999 }, null);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'unavailable');
});
