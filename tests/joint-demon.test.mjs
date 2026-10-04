/**
 * 阶段 D · 联手斩魔测试（src/services/joint-demon.ts + functions/api/joint-demon.ts）
 *
 * 覆盖：合计 ≥ 80% 判定（含 8/10 边界与封顶）/ 成功双方各 +80 灵石 /
 *       失败各降 1 级心魔（等级回退 + defeatedCount 累计）/ 心魔不足 5 只按实际题量 /
 *       一方 0 心魔兜底不崩溃 / 端点越权 403、correct 夹紧 0..5、D1 缺失 503、隐私键集。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/load-ts.mjs';
import { makeFakeIdb } from './helpers/fake-idb.mjs';
import { makeFakeD1, makeCtx } from './helpers/fake-d1.mjs';

const jd = await loadTs('src/services/joint-demon.ts');
const demons = await loadTs('src/services/demons.ts');
const eco = await loadTs('src/services/economy.ts');
const api = await loadTs('functions/api/joint-demon.ts');

const tick = () => new Promise((r) => setTimeout(r, 5));
const post = (body, db) => api.onRequestPost(makeCtx('/api/joint-demon', body, db));

/** 造 n 只心魔，每只抬到 2 级（保证降级可观测） */
async function seedDemons(idb, prefix, n) {
  const ids = [];
  for (let i = 1; i <= n; i++) {
    const qid = `${prefix}${i}`;
    await demons.upsertDemon(qid, 1, idb); // 首次建档（最低级）
    await demons.upsertDemon(qid, 1, idb); // 再抬一级 → 最低级 + 1
    ids.push(qid);
  }
  return ids;
}

/* ───────────────── 判定 ───────────────── */

test('judgeJoint：合计 ≥ 80% 通过（8/10 边界）、封顶 1、0 题兜底不通过', () => {
  assert.deepEqual(jd.judgeJoint(5, 3, 10), { passed: true, rate: 0.8 }, '合计 8/10 恰好 80% 通过');
  assert.deepEqual(jd.judgeJoint(7, 1, 10), { passed: true, rate: 0.8 });
  assert.equal(jd.judgeJoint(7, 0, 10).passed, false, '70% 不通过');
  assert.equal(jd.judgeJoint(10, 10, 10).rate, 1, '正确数超总量时封顶 1');
  assert.equal(jd.judgeJoint(0, 0, 0).passed, false, 'total 兜底 1，0 正确不通过');
});

/* ───────────────── 本机模式：成功 / 失败结算 ───────────────── */

test('成功结算：满 5 只心魔、合计 8/10 = 80% → 通过，双方各 +80 入流水', async () => {
  const idb = makeFakeIdb();
  await seedDemons(idb, 'qok', 5);
  const rec = await jd.createJointDemon('partner-1', idb, 1700000012000);
  assert.equal(rec.questionIds.length, 5, '心魔充足时取 5 只');
  await jd.recordJointScore(rec.id, 'initiator', { correct: 4, timeMs: 10000 }, idb);
  const r = await jd.recordJointScore(rec.id, 'partner', { correct: 4, timeMs: 12000 }, idb);
  assert.equal(r.ok, true);
  assert.equal(r.record.status, 'completed');
  assert.equal(r.record.passed, true, '8/10 = 0.8 达线');
  assert.equal(r.record.totalCorrectRate, 0.8);
  assert.ok(r.record.finishedAt);

  const state = { spirit: 0 };
  const s = await jd.settleJointDemon(r.record, state, idb);
  assert.equal(s.reward, jd.JOINT_DEMON_REWARD);
  assert.equal(s.lowered, 0, '成功不降心魔');
  await tick();
  const txs = await eco.listRecentTransactions(5, idb);
  assert.equal(txs[0].amount, 80);
  assert.equal(txs[0].reason, 'joint_demon_win');
  assert.equal(state.spirit, 80);
});

test('失败结算：心魔不足 5 只按实际题量算；不通过 → 每只各降 1 级', async () => {
  const idb = makeFakeIdb();
  const qids = await seedDemons(idb, 'qfew', 3); // 只有 3 只（< 5）
  const before = await demons.listDemons({}, idb);
  const rec = await jd.createJointDemon('partner-1', idb, 1700000013000);
  assert.equal(rec.questionIds.length, 3, '不足 5 只有多少取多少');
  assert.equal(jd.jointTotal(rec), 6, '合计 = 本机 3 + 对方同量 3');

  await jd.recordJointScore(rec.id, 'initiator', { correct: 0, timeMs: 500 }, idb);
  const r = await jd.recordJointScore(rec.id, 'partner', { correct: 0, timeMs: 500 }, idb);
  assert.equal(r.record.passed, false, '0/6 远低于 80%');
  assert.equal(r.record.totalCorrectRate, 0);

  const state = { spirit: 0 };
  const s = await jd.settleJointDemon(r.record, state, idb);
  assert.equal(s.reward, 0, '失败无奖励');
  assert.equal(s.lowered, qids.length, '每只心魔各降 1 级');
  await tick();
  assert.equal(state.spirit, 0);
  assert.equal((await eco.listRecentTransactions(5, idb)).length, 0, '失败不产生流水');
  const after = await demons.listDemons({}, idb);
  assert.equal(after.length, 3, '档案保留不删除');
  for (const d of after) {
    const b = before.find((x) => x.id === d.id);
    assert.equal(d.level, b.level - 1, '各降 1 级');
    assert.ok(d.defeatedCount > b.defeatedCount, '战绩累计');
  }
});

test('一方 0 心魔：不崩溃，合计口径兜底、0 正确不通过、无心魔可降', async () => {
  const idb = makeFakeIdb(); // 空心魔本
  const rec = await jd.createJointDemon('p', idb, 1700000014000);
  assert.equal(rec.questionIds.length, 0);
  assert.equal(jd.jointTotal(rec), 1, '总数兜底 ≥ 1');
  await jd.recordJointScore(rec.id, 'initiator', { correct: 0, timeMs: 500 }, idb);
  const r = await jd.recordJointScore(rec.id, 'partner', { correct: 0, timeMs: 500 }, idb);
  assert.equal(r.record.passed, false);
  assert.equal(r.record.totalCorrectRate, 0);
  const s = await jd.settleJointDemon(r.record, { spirit: 0 }, idb);
  assert.equal(s.lowered, 0);
});

/* ───────────────── 端点 ───────────────── */

test('端点参数：D1 缺失 503；缺 id/partnerId、缺 memberId、未知 action 全 400', async () => {
  const noDb = await post({ action: 'create', id: 'joint:0', partnerId: 'p' }, null);
  assert.equal(noDb.status, 503);
  assert.equal((await noDb.json()).status, 'unavailable');

  const db = makeFakeD1();
  assert.equal((await post({ action: 'create', id: '', partnerId: 'p', memberId: 'me' }, db)).status, 400, '缺 id');
  assert.equal((await post({ action: 'create', id: 'joint:0', partnerId: '', memberId: 'me' }, db)).status, 400, '缺 partnerId');
  assert.equal((await post({ action: 'create', id: 'joint:0', partnerId: 'p' }, db)).status, 400, '缺 memberId');
  assert.equal((await post({ action: 'boom', memberId: 'm' }, db)).status, 400, '未知 action');
});

test('端点越权：非参与方不能代提交、不能查看（403），且不落库', async () => {
  const db = makeFakeD1();
  await post({ action: 'create', id: 'joint:2', partnerId: 'foe', memberId: 'me' }, db);
  const r1 = await post({ action: 'score', id: 'joint:2', side: 'partner', memberId: 'attacker', correct: 5, timeMs: 1 }, db);
  assert.equal(r1.status, 403);
  const r2 = await post({ action: 'get', id: 'joint:2', memberId: 'attacker' }, db);
  assert.equal(r2.status, 403);
  assert.equal(db._tables().joints.get('joint:2').partner_correct, 0, '越权提交未落库');
});

test('端点双侧结算：8/10 通过 → completed + passed=1 落库；correct 夹紧 0..5', async () => {
  const db = makeFakeD1();
  let res = await post({ action: 'create', id: 'joint:1', partnerId: 'foe', memberId: 'me' }, db);
  assert.equal(res.status, 200);

  res = await post({ action: 'score', id: 'joint:1', side: 'initiator', memberId: 'me', correct: 99, timeMs: 1000 }, db);
  let body = await res.json();
  assert.equal(body.data.outcome, null, '单侧提交不判定');
  assert.equal(db._tables().joints.get('joint:1').initiator_correct, 5, 'correct 夹紧 0..5');

  res = await post({ action: 'score', id: 'joint:1', side: 'partner', memberId: 'foe', correct: 3, timeMs: 2000 }, db);
  body = await res.json();
  assert.equal(body.data.outcome.passed, true, '(5+3)/10 = 0.8 达线');
  assert.equal(body.data.outcome.rate, 0.8);
  const row = db._tables().joints.get('joint:1');
  assert.equal(row.status, 'completed');
  assert.equal(row.passed, 1, '通过标志落库');
  assert.ok(row.finished_at);
});

test('端点隐私：get 只回 isMe 与状态，不回对方身份与分数', async () => {
  const db = makeFakeD1();
  await post({ action: 'create', id: 'joint:3', partnerId: 'foe', memberId: 'me' }, db);
  const res = await post({ action: 'get', id: 'joint:3', memberId: 'foe' }, db);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.isMe, 'partner');
  assert.deepEqual(
    Object.keys(body.data).sort(),
    ['finishedAt', 'id', 'isMe', 'startedAt', 'status'],
    '无 initiator_id/partner_id/分数字段',
  );
});

test('IDB 降级：存储不可用时列表空、记分 ok:false、创建返回空题本地记录', async () => {
  assert.deepStrictEqual(await jd.listJointDemons(null), []);
  const r = await jd.recordJointScore('joint:x', 'initiator', { correct: 1, timeMs: 1 }, null);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'unavailable');
  const rec = await jd.createJointDemon('p', null, 1700000015000);
  assert.equal(rec.questionIds.length, 0, '无存储时无心魔题');
  assert.equal(rec.initiatorId, 'me');
});
