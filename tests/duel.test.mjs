/**
 * 阶段 D · 论剑测试（src/services/duel.ts + functions/api/duel.ts）
 *
 * 覆盖：判定规则 / 本机模式双侧结算（两个提交顺序）/ 奖励流水 / 列表过滤与降级 /
 *       端点越权 403 / 数值夹紧 / D1 缺失 503 / 隐私不回他人身份 /
 *       **duel.ts 对手成绩缺陷回归** / **listDuels 共仓污染回归** / 服务出口接线。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTs } from './helpers/load-ts.mjs';
import { makeFakeIdb } from './helpers/fake-idb.mjs';
import { makeFakeD1, makeCtx } from './helpers/fake-d1.mjs';

const duel = await loadTs('src/services/duel.ts');
const joint = await loadTs('src/services/joint-demon.ts');
const eco = await loadTs('src/services/economy.ts');
const api = await loadTs('functions/api/duel.ts');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tick = () => new Promise((r) => setTimeout(r, 5));
const post = (body, db) => api.onRequestPost(makeCtx('/api/duel', body, db));

/* ───────────────── 判定与演示对手 ───────────────── */

test('judgeDuel：正确数优先、其次用时短者胜、全同平局', () => {
  assert.equal(duel.judgeDuel({ correct: 8, timeMs: 5000 }, { correct: 5, timeMs: 1000 }), 'a');
  assert.equal(duel.judgeDuel({ correct: 5, timeMs: 1000 }, { correct: 8, timeMs: 5000 }), 'b');
  assert.equal(duel.judgeDuel({ correct: 5, timeMs: 4000 }, { correct: 5, timeMs: 9000 }), 'a', '同正确数比用时');
  assert.equal(duel.judgeDuel({ correct: 5, timeMs: 9000 }, { correct: 5, timeMs: 4000 }), 'b');
  assert.equal(duel.judgeDuel({ correct: 5, timeMs: 4000 }, { correct: 5, timeMs: 4000 }), 'tie');
});

test('simulateOpponentScore：同种子确定性，成绩在合法界内', () => {
  const a = duel.simulateOpponentScore(42);
  const b = duel.simulateOpponentScore(42);
  assert.deepStrictEqual(a, b, '确定性');
  assert.ok(a.correct >= 0 && a.correct <= duel.DUEL_QUESTIONS, '正确数在 0..10');
  assert.ok(a.timeMs > 0 && a.timeMs <= duel.DUEL_QUESTIONS * duel.DUEL_TIME_PER_Q, '用时在界内');
});

/* ───────────────── 本机模式双侧结算 ───────────────── */

test('本机结算：挑战者先、对手后 → 胜负按真实成绩判', async () => {
  const idb = makeFakeIdb();
  const rec = await duel.createDuel('foe-9', ['q1', 'q2'], 1700000000000, idb, 'me');
  const r1 = await duel.recordDuelScore(rec.id, 'challenger', { correct: 3, timeMs: 60000 }, idb);
  assert.equal(r1.ok, true);
  assert.equal(r1.record.status, 'challenger_done');
  assert.equal(r1.outcome, undefined, '单侧提交不判定');
  const r2 = await duel.recordDuelScore(rec.id, 'opponent', { correct: 8, timeMs: 50000 }, idb);
  assert.equal(r2.ok, true);
  assert.equal(r2.record.status, 'completed');
  assert.equal(r2.outcome, 'b', '对手正确数更多 → 对手胜');
  assert.equal(r2.record.winnerId, 'foe-9');
  assert.ok(r2.record.finishedAt, '终局时间已写入');
});

test('本机结算：对手先、挑战者后 → 终局仍按真实成绩判', async () => {
  const idb = makeFakeIdb();
  const rec = await duel.createDuel('foe-7', [], 1700000001000, idb, 'me');
  await duel.recordDuelScore(rec.id, 'opponent', { correct: 8, timeMs: 50000 }, idb);
  const r = await duel.recordDuelScore(rec.id, 'challenger', { correct: 3, timeMs: 60000 }, idb);
  assert.equal(r.record.status, 'completed');
  assert.equal(r.outcome, 'b');
  assert.equal(r.record.winnerId, 'foe-7');
});

test('duelReward：胜 +50 / 平 +20 / 负 0，灵石入流水', async () => {
  const idb = makeFakeIdb();
  const state = { spirit: 0 };
  assert.equal(duel.duelReward(state, 'a', idb), duel.DUEL_WIN_REWARD);
  assert.equal(duel.duelReward(state, 'tie', idb), duel.DUEL_TIE_REWARD);
  assert.equal(duel.duelReward(state, 'b', idb), 0, '败者不扣不加');
  await tick();
  assert.equal(state.spirit, 70);
  const txs = await eco.listRecentTransactions(10, idb);
  assert.equal(txs.length, 2, '负场不产生流水');
  assert.ok(txs.some((t) => t.reason === 'duel_win' && t.amount === 50));
  assert.ok(txs.some((t) => t.reason === 'duel_tie' && t.amount === 20));
});

/* ───────────────── 列表：过滤 / 排序 / 共仓卫生 / 降级 ───────────────── */

test('listDuels：状态过滤 + 按 startedAt 降序', async () => {
  const idb = makeFakeIdb();
  await duel.createDuel('a', [], 1700000000000, idb, 'me');
  await duel.createDuel('b', [], 1700000009000, idb, 'me');
  const all = await duel.listDuels(undefined, idb);
  assert.equal(all.length, 2);
  assert.ok(all[0].startedAt >= all[1].startedAt, '新→旧');
  assert.equal((await duel.listDuels({ status: 'pending' }, idb)).length, 2);
  assert.equal((await duel.listDuels({ status: 'completed' }, idb)).length, 0);
});

test('listDuels 共仓污染回归：joint:* 记录不混入论剑列表（反向同理）', async () => {
  const idb = makeFakeIdb();
  await duel.createDuel('foe', [], 1700000002000, idb, 'me');
  await joint.createJointDemon('partner-1', idb, 1700000003000); // 写入共享的 duels 仓
  const duels = await duel.listDuels(undefined, idb);
  assert.equal(duels.length, 1, 'listDuels 只回 duel:*');
  assert.ok(duels.every((d) => d.id.startsWith('duel:')));
  const joints = await joint.listJointDemons(idb);
  assert.equal(joints.length, 1, 'listJointDemons 只回 joint:*');
  assert.ok(joints.every((j) => j.id.startsWith('joint:')));
});

test('IDB 降级：存储不可用时列表为空、记分 ok:false、创建仍返回本地记录', async () => {
  assert.deepStrictEqual(await duel.listDuels(undefined, null), []);
  const r = await duel.recordDuelScore('duel:x', 'challenger', { correct: 1, timeMs: 1 }, null);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'unavailable');
  const created = await duel.createDuel('f', [], 1700000004000, null, 'me');
  assert.equal(created.id, 'duel:1700000004000', '创建静默降级但返回记录');
});

/* ───────────────── 端点：缺陷回归 ───────────────── */

test('端点回归：后提交方成绩不被忽略（修复前对手恒 0、挑战者恒判胜）', async () => {
  const db = makeFakeD1();
  let res = await post({ action: 'create', duelId: 'duel:1', opponentId: 'foe', memberId: 'me' }, db);
  assert.equal(res.status, 200);
  res = await post({ action: 'score', duelId: 'duel:1', side: 'challenger', memberId: 'me', correct: 3, timeMs: 60000 }, db);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).data.outcome, null, '单侧提交不判定');
  res = await post({ action: 'score', duelId: 'duel:1', side: 'opponent', memberId: 'foe', correct: 8, timeMs: 50000 }, db);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.data.outcome, 'b', '对手 8 > 挑战者 3 → 对手胜（修复前此处恒为 a）');
  const row = db._tables().duels.get('duel:1');
  assert.equal(row.status, 'completed');
  assert.equal(row.opponent_correct, 8, '对手成绩已落库');
  assert.ok(row.finished_at, '终局时间已写入');
});

test('端点回归：对手先、挑战者后提交也能判定（修复前直接不判）', async () => {
  const db = makeFakeD1();
  await post({ action: 'create', duelId: 'duel:2', opponentId: 'foe', memberId: 'me' }, db);
  await post({ action: 'score', duelId: 'duel:2', side: 'opponent', memberId: 'foe', correct: 8, timeMs: 50000 }, db);
  const res = await post({ action: 'score', duelId: 'duel:2', side: 'challenger', memberId: 'me', correct: 3, timeMs: 60000 }, db);
  const body = await res.json();
  assert.equal(body.data.outcome, 'b', '两个提交顺序都必须判定且结果一致');
  assert.equal(db._tables().duels.get('duel:2').status, 'completed');
});

/* ───────────────── 端点：越权 / 隐私 / 参数卫生 ───────────────── */

test('端点越权：不能代他人提交、不能查看他人对局（403）', async () => {
  const db = makeFakeD1();
  await post({ action: 'create', duelId: 'duel:3', opponentId: 'foe', memberId: 'me' }, db);
  const r1 = await post({ action: 'score', duelId: 'duel:3', side: 'opponent', memberId: 'attacker', correct: 9, timeMs: 1000 }, db);
  assert.equal(r1.status, 403);
  const r2 = await post({ action: 'get', duelId: 'duel:3', memberId: 'attacker' }, db);
  assert.equal(r2.status, 403);
  assert.equal(db._tables().duels.get('duel:3').opponent_correct, 0, '越权提交未落库');
});

test('端点隐私：get 只回 isMe 与对局状态，不回对方身份与分数', async () => {
  const db = makeFakeD1();
  await post({ action: 'create', duelId: 'duel:4', opponentId: 'foe', memberId: 'me' }, db);
  const res = await post({ action: 'get', duelId: 'duel:4', memberId: 'foe' }, db);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.isMe, 'opponent');
  assert.deepEqual(
    Object.keys(body.data).sort(),
    ['duelId', 'finishedAt', 'isMe', 'startedAt', 'status'],
    '不返回 challengerId/opponentId/分数字段',
  );
});

test('端点参数卫生：D1 缺失 503 / 坏 JSON 400 / 缺 memberId 400 / 未知 action 400 / 数值夹紧', async () => {
  const noDb = await post({ action: 'get', duelId: 'x', memberId: 'm' }, null);
  assert.equal(noDb.status, 503);
  assert.equal((await noDb.json()).status, 'unavailable');

  const badJson = await post('not-json{', makeFakeD1());
  assert.equal(badJson.status, 400);

  const noMember = await post({ action: 'get', duelId: 'x' }, makeFakeD1());
  assert.equal(noMember.status, 400);

  const unknown = await post({ action: 'boom', memberId: 'm' }, makeFakeD1());
  assert.equal(unknown.status, 400);

  const db = makeFakeD1();
  await post({ action: 'create', duelId: 'duel:5', opponentId: 'foe', memberId: 'me' }, db);
  await post({ action: 'score', duelId: 'duel:5', side: 'challenger', memberId: 'me', correct: 999, timeMs: -5 }, db);
  const row = db._tables().duels.get('duel:5');
  assert.equal(row.challenger_correct, 10, 'correct 夹紧 0..10');
  assert.equal(row.challenger_time_ms, 0, '负数用时夹到 0');
});

/* ───────────────── 接线 ───────────────── */

test('服务出口接线：index.ts 暴露 duel/transmission/joint/sect 四个命名空间', () => {
  const src = readFileSync(resolve(ROOT, 'src', 'services', 'index.ts'), 'utf8');
  for (const ns of ['duel', 'transmission', 'joint', 'sect']) {
    assert.match(src, new RegExp(`\\b${ns}: \\{`), `index.ts 应导出 ${ns} 命名空间`);
  }
});
