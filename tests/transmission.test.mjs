/**
 * 阶段 D · 传功测试（src/services/transmission.ts + functions/api/transmission.ts）
 *
 * 覆盖：传功资格（proficiency ≥ 4）/ 每词全局只传一次 / 传功者 +30 灵石流水 /
 *       接收方 boostActiveUntil（7 天 ×1.5 窗口）/ 领取幂等与越权 403 /
 *       空词与非法词 400、道友不存在 400、D1 缺失 503 / 隐私不回对方身份 / IDB 降级。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/load-ts.mjs';
import { makeFakeIdb } from './helpers/fake-idb.mjs';
import { makeFakeD1, makeCtx } from './helpers/fake-d1.mjs';

const tr = await loadTs('src/services/transmission.ts');
const eco = await loadTs('src/services/economy.ts');
const api = await loadTs('functions/api/transmission.ts');

const tick = () => new Promise((r) => setTimeout(r, 5));
const DAY = 86400000;
const post = (body, db) => api.onRequestPost(makeCtx('/api/transmission', body, db));

/* ───────────────── 资格与建档 ───────────────── */

test('canTransmit：空词 / 熟练度 < 4 拒绝，≥ 4 通过', () => {
  assert.equal(tr.canTransmit('', 5).ok, false);
  assert.equal(tr.canTransmit('', 5).reason, 'empty_word');
  assert.equal(tr.canTransmit('hello', 3).ok, false);
  assert.equal(tr.canTransmit('hello', 3).reason, 'not_mastered');
  assert.equal(tr.canTransmit('hello', 4).ok, true, '恰好 4 级可传');
  assert.equal(tr.canTransmit('hello', '5').ok, true, '数字字符串宽容');
});

test('建档：主键 tx:<word>、接收方 boostActiveUntil = 7 天后', async () => {
  const idb = makeFakeIdb();
  const now = Date.UTC(2026, 9, 5);
  const r = await tr.createTransmission('friend-1', 'serendipity', 4, idb, now, 'me');
  assert.equal(r.ok, true);
  assert.equal(r.record.id, 'tx:serendipity');
  assert.equal(r.record.fromId, 'me');
  assert.equal(r.record.toId, 'friend-1');
  assert.equal(r.record.claimed, false);
  assert.equal(Date.parse(r.record.boostActiveUntil), now + 7 * DAY, 'boost 窗口 7 天');
});

test('资格不足：不建档、不产生任何记录', async () => {
  const idb = makeFakeIdb();
  const r = await tr.createTransmission('f1', 'hello', 3, idb);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not_mastered');
  await tick();
  assert.equal((await tr.listTransmissions(undefined, idb)).length, 0);
});

test('单次性：每词全局只传一次（大小写变体也算同一个词）', async () => {
  const idb = makeFakeIdb();
  const first = await tr.createTransmission('f1', 'hello', 4, idb);
  assert.equal(first.ok, true);
  const again = await tr.createTransmission('f2', 'HELLO', 4, idb);
  assert.equal(again.ok, false);
  assert.equal(again.reason, 'already_transmitted');
  await tick();
  assert.equal((await tr.listTransmissions(undefined, idb)).length, 1, '库里只有一条');
});

/* ───────────────── 奖励 / 领取 / 列表 / boost ───────────────── */

test('transmissionReward：传功者 +30 灵石入流水', async () => {
  const idb = makeFakeIdb();
  const state = { spirit: 0 };
  assert.equal(tr.transmissionReward(state, idb), tr.TRANSMISSION_SENDER_REWARD);
  await tick();
  const txs = await eco.listRecentTransactions(5, idb);
  assert.equal(txs.length, 1);
  assert.equal(txs[0].amount, 30);
  assert.equal(txs[0].reason, 'transmission_sent');
});

test('claimTransmission：不存在 not_found；领取后幂等返回已领', async () => {
  const idb = makeFakeIdb();
  const miss = await tr.claimTransmission('tx:nope', idb);
  assert.equal(miss.ok, false);
  assert.equal(miss.reason, 'not_found');
  await tr.createTransmission('f1', 'ephemeral', 4, idb);
  const first = await tr.claimTransmission('tx:ephemeral', idb);
  assert.equal(first.ok, true);
  assert.equal(first.record.claimed, true);
  const second = await tr.claimTransmission('tx:ephemeral', idb);
  assert.equal(second.ok, true);
  assert.equal(second.record.claimed, true, '重复领取幂等');
});

test('listTransmissions：按 from/to 过滤 + 新→旧排序', async () => {
  const idb = makeFakeIdb();
  await tr.createTransmission('f1', 'alpha', 4, idb, Date.UTC(2026, 9, 1), 'me');
  await tr.createTransmission('f1', 'beta', 4, idb, Date.UTC(2026, 9, 2), 'me');
  const sent = await tr.listTransmissions({ fromId: 'me' }, idb);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].word, 'beta', '新→旧');
  assert.equal((await tr.listTransmissions({ toId: 'me' }, idb)).length, 0);
  assert.equal((await tr.listTransmissions({ toId: 'f1' }, idb)).length, 2);
});

test('boostMultiplier：窗口内 ×1.5、过期 ×1、空记录 ×1', () => {
  const now = Date.UTC(2026, 9, 5);
  assert.equal(tr.boostMultiplier({ boostActiveUntil: new Date(now + 1000).toISOString() }, now), 1.5);
  assert.equal(tr.boostMultiplier({ boostActiveUntil: new Date(now - 1000).toISOString() }, now), 1);
  assert.equal(tr.boostMultiplier(null, now), 1);
});

/* ───────────────── 端点：参数 / 越权 / 隐私 ───────────────── */

test('端点参数：D1 缺失 503；道友不存在/空词/非法词/缺 memberId/未知 action 全 400', async () => {
  const noDb = await post({ action: 'create', memberId: 'me', toId: 'f1', word: 'hello' }, null);
  assert.equal(noDb.status, 503);
  assert.equal((await noDb.json()).status, 'unavailable');

  const db = makeFakeD1();
  assert.equal((await post({ action: 'create', memberId: 'me', toId: '', word: 'hello' }, db)).status, 400, '道友不存在（toId 空）');
  assert.equal((await post({ action: 'create', memberId: 'me', toId: 'f1', word: '' }, db)).status, 400, '空词');
  assert.equal((await post({ action: 'create', memberId: 'me', toId: 'f1', word: '苹果' }, db)).status, 400, '非拉丁词拒绝');
  assert.equal((await post({ action: 'create', toId: 'f1', word: 'hello' }, db)).status, 400, '缺 memberId');
  assert.equal((await post({ action: 'boom', memberId: 'm' }, db)).status, 400, '未知 action');
});

test('端点流程：创建 200 → 重复 409 → 越权领取 403 → 本人领取 200 → 不存在 404', async () => {
  const db = makeFakeD1();
  let res = await post({ action: 'create', memberId: 'me', toId: 'friend-1', word: 'resilience' }, db);
  assert.equal(res.status, 200);
  let body = await res.json();
  assert.equal(body.data.id, 'tx:resilience');
  assert.equal(body.data.boostDays, 7);

  res = await post({ action: 'create', memberId: 'me2', toId: 'friend-2', word: 'Resilience' }, db);
  assert.equal(res.status, 409, '每词全局只传一次');
  assert.equal((await res.json()).reason, 'already_transmitted');

  res = await post({ action: 'claim', id: 'tx:resilience', memberId: 'attacker' }, db);
  assert.equal(res.status, 403, '只能领取传给自己的功法');

  res = await post({ action: 'claim', id: 'tx:resilience', memberId: 'friend-1' }, db);
  assert.equal(res.status, 200);
  assert.equal(db._tables().transmissions.get('tx:resilience').claimed, 1);

  res = await post({ action: 'claim', id: 'tx:missing', memberId: 'x' }, db);
  assert.equal(res.status, 404);
});

test('端点隐私：list 只回方向与词，不回对方 memberId', async () => {
  const db = makeFakeD1();
  await post({ action: 'create', memberId: 'me', toId: 'friend-1', word: 'gratitude' }, db);
  const mine = (await (await post({ action: 'list', memberId: 'me' }, db)).json()).data.list[0];
  assert.equal(mine.mine, 'sent');
  assert.equal(mine.word, 'gratitude');
  assert.deepEqual(
    Object.keys(mine).sort(),
    ['boostUntil', 'claimed', 'createdAt', 'id', 'mine', 'word'],
    '无 from_id / to_id 字段',
  );
  const theirs = (await (await post({ action: 'list', memberId: 'friend-1' }, db)).json()).data.list[0];
  assert.equal(theirs.mine, 'received', '对方视角标记为收到');
});

test('IDB 降级：存储不可用时创建 ok:false、列表空、不抛异常', async () => {
  const r = await tr.createTransmission('f1', 'hello', 4, null);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'unavailable');
  assert.deepStrictEqual(await tr.listTransmissions(undefined, null), []);
});
