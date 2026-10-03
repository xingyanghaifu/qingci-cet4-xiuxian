/**
 * 修仙主题绑定（P2.11）单元测试
 *
 * 覆盖：境界阈值与双条件、只升不降、差距与瓶颈、突破检测、称号解锁与进度、
 * 持久化与本次变化、道友小组的隐私规则（昵称校验 / 进度分档 / 榜单脱敏）与降级。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/load-ts.mjs';
import {
  onRequestPost as groupPost, onRequest as groupOther, onRequestOptions as groupOptions,
  validateNickname as serverNickname, bucketProgress as serverBucket,
  generateCode, weekKey, monthKey, rankMembers, toMemberView, GROUP_LIMITS,
} from '../functions/api/group.ts';

const realm = await loadTs('src/types/realm.ts');
const titles = await loadTs('src/types/titles.ts');
const gamification = await loadTs('src/services/gamification.ts');
const group = await loadTs('src/services/group.ts');

const { REALMS, evaluateRealm, eligibleRealmIndex, detectBreakthrough, describeRealm, realmByIndex, realmTable } = realm;
const { TITLES, evaluateTitles, newlyUnlocked, titleProgress } = titles;
const { loadGamification, saveGamification, evaluateProgress, recordProgress, describeBreakthrough, EMPTY_GAMIFICATION } = gamification;
const { validateNickname, bucketProgress, normalizeGroupCode, isValidGroupCode, validateGroupName, defaultNickname, memberId, createGroup, joinGroup, syncProgress, fetchBoard, leaveGroup, describeMember } = group;

function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    _map: map,
  };
}

test('realm：五境界阈值表完整且单调递增', () => {
  assert.equal(REALMS.length, 5);
  assert.deepEqual(REALMS.map((r) => r.name), ['练气', '筑基', '金丹', '元婴', '化神']);
  for (let i = 1; i < REALMS.length; i++) {
    assert.ok(REALMS[i].minVocab > REALMS[i - 1].minVocab, '词汇阈值应递增');
    assert.ok(REALMS[i].minScore > REALMS[i - 1].minScore, '分数阈值应递增');
  }
  assert.equal(REALMS[4].minScore, 700);
  assert.equal(realmTable().length, 5);
  assert.equal(realmByIndex(99).name, '化神', '越界应夹紧');
  assert.equal(realmByIndex(-3).name, '练气');
});

test('realm：双条件同时达标才晋级', () => {
  // 只有词汇达标 → 不晋级
  assert.equal(eligibleRealmIndex({ vocabSize: 2500, bestScore: 0 }), 0);
  // 只有分数达标 → 不晋级
  assert.equal(eligibleRealmIndex({ vocabSize: 0, bestScore: 650 }), 0);
  // 双达标 → 取满足的最高档
  assert.equal(eligibleRealmIndex({ vocabSize: 2000, bestScore: 500 }), 2);
  assert.equal(eligibleRealmIndex({ vocabSize: 4300, bestScore: 705 }), 4);
  // 中间档：词汇够元婴、分数只够筑基 → 筑基
  assert.equal(eligibleRealmIndex({ vocabSize: 3200, bestScore: 410 }), 1);
});

test('realm：差距、瓶颈与只升不降', () => {
  // 词汇 1200 已达筑基词汇线（1000），但分数 300 < 400 → 仍是练气
  const status = evaluateRealm({ vocabSize: 1200, bestScore: 300 });
  assert.equal(status.realm.name, '练气', '双条件未同时达标不晋级');
  assert.equal(status.next.name, '筑基');
  assert.equal(status.gap.vocab, 0);
  assert.equal(status.gap.vocabMet, true);
  assert.equal(status.gap.score, 100);
  assert.equal(status.gap.scoreMet, false);
  assert.equal(status.bottleneck, 'score', '词汇已达标时瓶颈应指向分数');
  assert.ok(status.progress > 0 && status.progress < 1);
  assert.equal(status.justEligible, false);
  assert.match(describeRealm(status), /筑基/);

  // 词汇不足、分数够：瓶颈指向词汇
  const vocabBound = evaluateRealm({ vocabSize: 800, bestScore: 520 });
  assert.equal(vocabBound.bottleneck, 'vocab');
  assert.equal(vocabBound.gap.vocab, 200);
  assert.equal(vocabBound.gap.vocabMet, false);
  assert.equal(vocabBound.gap.scoreMet, true);

  // 双条件都够金丹：realm 直接跟到金丹，justEligible 反映「比已记录档位更高」
  const ready = evaluateRealm({ vocabSize: 2000, bestScore: 500 });
  assert.equal(ready.realm.name, '金丹');
  assert.equal(ready.justEligible, false, '未传 currentIndex 时以数据为准，无「待记录」');
  const pending = evaluateRealm({ vocabSize: 2000, bestScore: 500, currentIndex: 1 });
  assert.equal(pending.realm.name, '金丹', '只升不降：已记录筑基 + 数据够金丹 → 显示金丹');
  assert.equal(pending.justEligible, true, '比已记录档位更高 → 待记录突破');
  assert.equal(pending.next.name, '元婴');

  // 边界兜底文案
  const desync = evaluateRealm({ vocabSize: 4500, bestScore: 710, currentIndex: 4 });
  assert.equal(desync.next, null);
  assert.match(describeRealm(desync), /最高境界/);
  // 构造出来的「双条件都达标但仍有下一境界」在真实数据下不可达（realm 会直接跟到 eligible），
  // 这里只验证兜底文案不会崩、也不会输出空字符串
  assert.match(describeRealm({ ...desync, next: REALMS[4], gap: { vocab: 0, score: 0, vocabMet: true, scoreMet: true } }), /仅一步之遥/);

  // 只升不降：当前记录已是元婴，即使数据回落也不掉级
  const kept = evaluateRealm({ vocabSize: 1200, bestScore: 300, currentIndex: 3 });
  assert.equal(kept.realm.name, '元婴');

  // 已达最高境界
  const top = evaluateRealm({ vocabSize: 4500, bestScore: 710 });
  assert.equal(top.realm.name, '化神');
  assert.equal(top.next, null);
  assert.equal(top.progress, 1);
  assert.equal(top.bottleneck, null);
  assert.match(describeRealm(top), /最高境界/);
});

test('realm：突破检测（含连升）', () => {
  assert.equal(detectBreakthrough(0, { vocabSize: 1200, bestScore: 420 }).toIndex, 1);
  assert.equal(detectBreakthrough(0, { vocabSize: 4300, bestScore: 705 }).levels, 4, '数据大幅提升应识别连升');
  assert.equal(detectBreakthrough(4, { vocabSize: 4300, bestScore: 705 }), null, '已到顶不再突破');
  assert.equal(detectBreakthrough(2, { vocabSize: 100, bestScore: 100 }), null);
  assert.equal(detectBreakthrough(2, { vocabSize: 4300, bestScore: 705 }).from.name, '金丹');
});

const partStats = (over = {}) => ([
  { part: '词汇', total: 300, correct: 270 },
  { part: '听力', total: 100, correct: 90 },
  { part: '阅读', total: 120, correct: 110 },
  { part: '翻译', total: 20, correct: 19 },
  { part: '写作', total: 12, correct: 11 },
  ...(over.extra || []),
].filter((s) => !(over.drop || []).includes(s.part)));

test('titles：全部称号都有明确门槛（样本量 + 正确率）', () => {
  assert.ok(TITLES.length >= 8);
  for (const title of TITLES) {
    assert.ok(title.key && title.name && title.condition, `${title.key} 缺少必要字段`);
    assert.ok(title.requirement.minSamples > 0, `${title.key} 应写明样本量门槛`);
    if (!['坚持', '复习', '全卷'].includes(title.part)) {
      assert.ok(title.requirement.minAccuracy > 0, `${title.key} 应写明正确率门槛`);
    }
  }
  assert.ok(TITLES.some((t) => t.name === '听力金丹'));
  assert.ok(TITLES.some((t) => t.name === '阅读元婴'));
  assert.ok(TITLES.some((t) => t.name === '翻译化神'));
});

test('titles：解锁判定、样本不足不解锁、进度可读', () => {
  const input = {
    partStats: partStats(),
    studyDays: 31,
    masteredWords: 520,
    bestScore: 705,
    fullPaperCompleted: true,
  };
  const evaluation = evaluateTitles(input);
  const names = evaluation.unlocked.map((t) => t.name);
  assert.ok(names.includes('听力金丹'));
  assert.ok(names.includes('阅读元婴'));
  assert.ok(names.includes('翻译化神'));
  assert.ok(names.includes('全卷化神'));
  assert.ok(names.includes('勤修不辍'), '累计 31 天应解锁坚持类称号');
  assert.ok(names.includes('心有灵犀'));
  assert.equal(evaluation.locked.length, TITLES.length - evaluation.unlocked.length);

  // 样本不足：1 题全对不能封神
  const thin = evaluateTitles({ partStats: [{ part: '翻译', total: 1, correct: 1 }], studyDays: 1, masteredWords: 0, bestScore: 0, fullPaperCompleted: false });
  assert.ok(!thin.unlocked.some((t) => t.name === '翻译化神'));
  const progress = thin.locked.find((p) => p.title.name === '翻译化神');
  assert.ok(progress.progress < 0.2);
  assert.match(progress.remaining, /翻译题 1 \/ 12 题/);
  assert.ok(thin.locked[0].progress >= thin.locked[thin.locked.length - 1].progress, '未解锁应按进度降序');

  // 正确率不足但样本充足
  const inaccurate = evaluateTitles({ partStats: [{ part: '听力', total: 100, correct: 50 }], studyDays: 0, masteredWords: 0, bestScore: 0, fullPaperCompleted: false });
  assert.ok(!inaccurate.unlocked.some((t) => t.name === '听力金丹'));
  assert.match(inaccurate.locked.find((p) => p.title.name === '听力金丹').remaining, /正确率 50% \/ 80%/);

  // 全卷未完成时不给全卷称号
  const noPaper = evaluateTitles({ partStats: [], studyDays: 0, masteredWords: 0, bestScore: 705, fullPaperCompleted: false });
  assert.ok(!noPaper.unlocked.some((t) => t.name === '全卷化神'));

  // newlyUnlocked 按 key 比较（不是显示名）
  assert.equal(newlyUnlocked(evaluation.unlocked, [evaluation.unlocked[0].key]).length, evaluation.unlocked.length - 1);
  assert.equal(newlyUnlocked(evaluation.unlocked, evaluation.unlocked.map((t) => t.key)).length, 0, '已解锁的不重复通知');
  assert.ok(titleProgress(TITLES[0], { partStats: [], studyDays: 0, masteredWords: 0, bestScore: 0, fullPaperCompleted: false }).progress === 0);
});

test('gamification：判定 + 持久化 + 本次变化（突破与新称号各只报一次）', () => {
  const storage = makeStorage();
  assert.deepEqual(loadGamification(storage), EMPTY_GAMIFICATION);
  assert.deepEqual(loadGamification(null), EMPTY_GAMIFICATION);

  const before = {
    vocabSize: 900, bestScore: 300, studyDays: 5, masteredWords: 10, fullPaperCompleted: false,
    partStats: [{ part: '听力', total: 10, correct: 5 }],
  };
  const first = recordProgress(before, storage);
  assert.equal(first.status.realm.name, '练气');
  assert.equal(first.breakthrough, null);
  assert.equal(first.newTitles.length, 0);

  const after = {
    vocabSize: 2100, bestScore: 520, studyDays: 31, masteredWords: 520, fullPaperCompleted: true,
    partStats: partStats(),
  };
  const second = recordProgress(after, storage);
  assert.equal(second.status.realm.name, '金丹');
  assert.ok(second.breakthrough, '数据提升应检测到突破');
  assert.equal(second.breakthrough.to.name, '金丹');
  assert.ok(second.newTitles.length >= 4);
  assert.equal(second.state.realmIndex, 2);
  assert.ok(second.state.titles.length >= 4);
  assert.equal(second.state.breakthroughs.length, 1);

  // 再跑一次：不应重复报告
  const third = recordProgress(after, storage);
  assert.equal(third.breakthrough, null);
  assert.equal(third.newTitles.length, 0);
  assert.equal(third.state.breakthroughs.length, 1, '突破历史不应重复累加');
  assert.match(describeBreakthrough(third.state.breakthroughs[0]), /练气 → 金丹/);

  // 数据回落后境界不掉（只升不降）
  const fallback = recordProgress({ ...before }, storage);
  assert.equal(fallback.status.realm.name, '金丹');

  // 损坏数据兜底
  storage.setItem('qingci.gamification', '{坏 JSON');
  assert.deepEqual(loadGamification(storage), EMPTY_GAMIFICATION);
  const saved = saveGamification({ realmIndex: 2, titles: ['a', 'a', 'b'], breakthroughs: [], titleUnlocks: [] }, storage);
  assert.deepEqual(saved.titles, ['a', 'b'], '称号应去重');

  // 历史记录裁剪
  const many = { realmIndex: 0, titles: [], breakthroughs: [], titleUnlocks: [] };
  for (let i = 0; i < 30; i++) many.breakthroughs.push({ at: new Date().toISOString(), from: 0, to: 1 });
  assert.equal(saveGamification(many, storage).breakthroughs.length, 20, '突破历史最多保留 20 条');
});

test('group：昵称与小组名校验只允许昵称（拒绝联系方式）', () => {
  assert.equal(validateNickname('青灯散人').ok, true);
  assert.equal(validateNickname('').ok, false);
  assert.equal(validateNickname('张三丰').ok, true);
  for (const bad of ['a@b.com', '13800138000', '123456', 'http://x.com', 'www.spam.cn']) {
    assert.equal(validateNickname(bad).ok, false, `${bad} 应被拒绝`);
  }
  assert.equal(validateNickname('一二三四五六七八九十一二三').ok, false, '超长昵称应拒绝');
  assert.equal(validateGroupName('青云道场').ok, true);
  assert.equal(validateGroupName('a@b.com').ok, false);
  assert.equal(validateGroupName('').ok, true, '空小组名允许（用默认名）');
  // 前后端规则一致
  for (const name of ['青灯散人', 'a@b.com', '13800138000', '']) {
    assert.equal(validateNickname(name).ok, serverNickname(name).ok, `前后端对「${name}」判定应一致`);
  }
});

test('group：进度分档、邀请码与会话内身份', () => {
  assert.equal(bucketProgress(87), 85);
  assert.equal(bucketProgress(88), 90);
  assert.equal(bucketProgress(-5), 0);
  assert.equal(bucketProgress(999), 100);
  assert.equal(bucketProgress(NaN), 0);
  assert.equal(serverBucket(87), bucketProgress(87), '前后端分档规则一致');

  assert.equal(normalizeGroupCode('ab-cd12'), 'ABCD12');
  assert.equal(isValidGroupCode('ABCD12'), true);
  assert.equal(isValidGroupCode('ABC'), false);
  const code = generateCode(() => 0.42);
  assert.equal(code.length, 6);
  assert.ok(/^[A-Z2-9]+$/.test(code));
  assert.ok(!/[OI01]/.test(code), '邀请码应排除易混字符');

  const storage = makeStorage();
  const id1 = memberId(storage);
  assert.ok(id1.length >= 8);
  assert.equal(memberId(storage), id1, '同一存储应复用匿名 ID');
  assert.ok(!/[@\u4e00-\u9fa5]/.test(id1), '匿名 ID 不应包含个人信息');
  const nick = defaultNickname(() => 0.5);
  assert.ok(validateNickname(nick).ok, '随机道号必须合法');
  assert.equal(describeMember({ nickname: '甲', realmIndex: 2, realmName: '金丹', progress: 85, studyDays: 12, isMe: false }), '金丹 · 进度 85% · 修习 12 天');
});

test('group：客户端提交体只含聚合数据（不含任何分数/答题内容）', async () => {
  const storage = makeStorage();
  let captured = null;
  const fakeFetch = async (url, init) => {
    captured = { url, body: JSON.parse(init.body), method: init.method };
    return { status: 200, json: async () => ({ status: 'ok', message: 'ok', data: { code: 'ABCD12', name: '道场', period: 'week', members: [], total: 0, updatedAt: '' } }) };
  };

  await createGroup({
    nickname: '青灯散人',
    progress: { memberId: memberId(storage), realmIndex: 2, progress: 87, studyDays: 12 },
  }, { fetchImpl: fakeFetch, storage });

  assert.equal(captured.url, '/api/group');
  assert.equal(captured.method, 'POST');
  assert.equal(captured.body.action, 'create');
  assert.equal(captured.body.progress, 85, '进度应分档后再上传');
  assert.deepEqual(Object.keys(captured.body).sort(), ['action', 'memberId', 'name', 'nickname', 'progress', 'realmIndex', 'studyDays'].sort());

  const serialized = JSON.stringify(captured.body);
  assert.ok(!/score|answer|questionId|correct/i.test(serialized), '请求体不应出现分数/答题字段');

  // 非法输入不应发请求
  let called = 0;
  const counting = async () => { called++; return { status: 200, json: async () => ({}) }; };
  const badNick = await createGroup({ nickname: 'a@b.com', progress: { memberId: 'x', realmIndex: 0, progress: 0, studyDays: 0 } }, { fetchImpl: counting, storage });
  assert.equal(badNick.status, 'invalid');
  const badCode = await joinGroup({ code: 'x', nickname: '青灯', progress: { memberId: 'x', realmIndex: 0, progress: 0, studyDays: 0 } }, { fetchImpl: counting, storage });
  assert.equal(badCode.status, 'invalid');
  assert.equal(called, 0, '非法输入应本地拦截，不发请求');
});

test('group：状态映射与降级（200/400/404/409/429/503/异常）', async () => {
  const storage = makeStorage();
  const payload = { memberId: 'member1234', nickname: '青灯散人', realmIndex: 1, progress: 40, studyDays: 3 };
  const mk = (status, body) => async () => ({ status, json: async () => body });

  assert.equal((await syncProgress({ code: 'ABCD12', ...payload }, { fetchImpl: mk(200, { status: 'ok' }), storage })).status, 'ok');
  assert.equal((await syncProgress({ code: 'ABCD12', ...payload }, { fetchImpl: mk(400, { message: '昵称不合法' }), storage })).status, 'invalid');
  assert.equal((await syncProgress({ code: 'ABCD12', ...payload }, { fetchImpl: mk(404, { message: '没有找到' }), storage })).status, 'not_found');
  assert.equal((await syncProgress({ code: 'ABCD12', ...payload }, { fetchImpl: mk(409, { message: '已满' }), storage })).status, 'full');
  assert.equal((await syncProgress({ code: 'ABCD12', ...payload }, { fetchImpl: mk(429, { message: '太频繁' }), storage })).status, 'rate_limited');
  assert.equal((await syncProgress({ code: 'ABCD12', ...payload }, { fetchImpl: mk(503, { message: '未配置' }), storage })).status, 'unavailable');
  assert.equal((await syncProgress({ code: 'ABCD12', ...payload }, { fetchImpl: async () => { throw new Error('offline'); }, storage })).status, 'error');
  assert.equal((await syncProgress({ code: 'ABCD12', ...payload }, { fetchImpl: null, storage })).status, 'unavailable');
  assert.equal((await leaveGroup({ code: 'ABCD12', memberId: 'm' }, { fetchImpl: mk(200, { status: 'ok', data: { left: true } }), storage })).status, 'ok');
  assert.equal((await fetchBoard({ code: 'ABCD12', memberId: 'm', period: 'month' }, { fetchImpl: mk(200, { status: 'ok' }), storage })).status, 'ok');
});

/** 假 D1：够用的 SQL 分派（按关键词识别语句） */
function makeGroupDb(options = {}) {
  const groups = new Map();
  const members = [];
  return {
    groups,
    members,
    prepare(query) {
      const q = query.replace(/\s+/g, ' ').trim();
      return {
        values: [],
        bind(...values) { this.values = values; return this; },
        async first() {
          if (/FROM study_groups WHERE code/.test(q)) {
            const code = this.values[0];
            const group = groups.get(code);
            if (!group) return null;
            return { id: group.id, code: group.code, name: group.name, member_count: group.member_count };
          }
          if (/SELECT member_id, updated_at/.test(q)) {
            const [groupId, memberId] = this.values;
            const found = members.find((m) => m.group_id === groupId && m.member_id === memberId);
            return found ? { member_id: found.member_id, updated_at: found.updated_at } : null;
          }
          if (/COUNT\(\*\) AS n FROM group_members/.test(q)) {
            const groupId = this.values[0];
            return { n: members.filter((m) => m.group_id === groupId).length };
          }
          return null;
        },
        async run() {
          if (options.throws) throw new Error('D1 down');
          if (/INSERT INTO study_groups/.test(q)) {
            const [code, name, createdAt] = this.values;
            const id = groups.size + 1;
            groups.set(code, { id, code, name, created_at: createdAt, member_count: 1 });
            return { meta: { last_row_id: id } };
          }
          if (/INSERT INTO group_members/.test(q)) {
            const [groupId, memberId_, nickname, realmIndex, progress, studyDays, week, month, updatedAt] = this.values;
            const existing = members.find((m) => m.group_id === groupId && m.member_id === memberId_);
            const row = { group_id: groupId, member_id: memberId_, nickname, realm_index: realmIndex, progress, study_days: studyDays, week_key: week, month_key: month, updated_at: updatedAt };
            if (existing) Object.assign(existing, row);
            else members.push(row);
            return { meta: { changes: 1 } };
          }
          if (/DELETE FROM group_members/.test(q)) {
            const [groupId, memberId_] = this.values;
            const index = members.findIndex((m) => m.group_id === groupId && m.member_id === memberId_);
            if (index >= 0) members.splice(index, 1);
            return { meta: { changes: index >= 0 ? 1 : 0 } };
          }
          return { meta: {} };
        },
        async all() {
          if (/FROM group_members/.test(q)) {
            const code = this.values[0];
            const group = groups.get(code);
            return { results: members.filter((m) => !group || m.group_id === group.id) };
          }
          return { results: [] };
        },
      };
    },
  };
}

const groupRequest = (body) => new Request('https://example.com/api/group', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

test('function：创建/加入/同步/榜单/退出，且榜单脱敏', async () => {
  const db = makeGroupDb();
  const env = { DB: db };

  const created = await groupPost({
    request: groupRequest({ action: 'create', nickname: '青灯散人', memberId: 'memberA1', realmIndex: 2, progress: 87, studyDays: 12, name: '青云道场' }),
    env,
  });
  assert.equal(created.status, 200);
  const createdBody = await created.json();
  const code = createdBody.data.code;
  assert.equal(code.length, 6);
  assert.equal(createdBody.data.members[0].isMe, true);
  assert.equal(createdBody.data.members[0].progress, 85, '入库前应分档');
  assert.equal(db.members[0].progress, 85);

  // 第二人加入
  const joined = await groupPost({
    request: groupRequest({ action: 'join', code, nickname: '听风书生', memberId: 'memberB2', realmIndex: 3, progress: 70, studyDays: 20 }),
    env,
  });
  assert.equal(joined.status, 200);
  const board = (await joined.json()).data;
  assert.equal(board.total, 2);
  assert.equal(board.members[0].nickname, '听风书生', '境界高者排前');
  assert.equal(board.members[0].realmName, '元婴');

  // 榜单结构只含允许字段，绝无分数/成员 ID
  for (const view of board.members) {
    assert.deepEqual(Object.keys(view).sort(), ['isMe', 'nickname', 'progress', 'realmIndex', 'realmName', 'studyDays'].sort());
  }
  const raw = JSON.stringify(board);
  assert.ok(!/memberA1|memberB2/.test(raw), '榜单不得回传他人 memberId');
  assert.ok(!/score|answer|question/i.test(raw), '榜单不得包含分数或答题数据');

  // 同步（30 秒内重复同步走「刚刚已同步」分支，不报错）
  const synced = await groupPost({
    request: groupRequest({ action: 'sync', code, nickname: '青灯散人', memberId: 'memberA1', realmIndex: 3, progress: 95, studyDays: 21 }),
    env,
  });
  assert.equal(synced.status, 200);

  // 退出
  const left = await groupPost({ request: groupRequest({ action: 'leave', code, memberId: 'memberA1' }), env });
  assert.equal(left.status, 200);
  assert.equal(db.members.length, 1);

  // 榜单周期查询
  const monthly = await groupPost({ request: groupRequest({ action: 'board', code, memberId: 'memberB2', period: 'month' }), env });
  assert.equal((await monthly.json()).data.period, 'month');
});

test('function：参数校验、降级与方法约束', async () => {
  const db = makeGroupDb();
  assert.equal((await groupPost({ request: groupRequest('bad{'), env: { DB: db } })).status, 400);
  assert.equal((await groupPost({ request: groupRequest({ action: 'board', code: 'X' }), env: { DB: db } })).status, 400);
  assert.equal((await groupPost({ request: groupRequest({ action: 'board', code: 'ABCD12' }), env: { DB: db } })).status, 400, '缺少 memberId');
  assert.equal((await groupPost({ request: groupRequest({ action: 'board', code: 'ZZZZZZ', memberId: 'm1' }), env: { DB: db } })).status, 404);
  assert.equal((await groupPost({ request: groupRequest({ action: 'create', nickname: 'a@b.com', memberId: 'm1' }), env: { DB: db } })).status, 400);
  assert.equal((await groupPost({ request: groupRequest({ action: 'create', nickname: '青灯', memberId: 'm1' }), env: {} })).status, 503, '未绑定 DB 应降级');
  assert.equal((await groupPost({ request: groupRequest({ action: 'create', nickname: '青灯', memberId: 'm1' }), env: { DB: makeGroupDb({ throws: true }) } })).status, 500);

  // 未知 action：小组不存在时先 404；小组存在时才是 400
  const created = await groupPost({ request: groupRequest({ action: 'create', nickname: '青灯', memberId: 'm1' }), env: { DB: db } });
  const code = (await created.json()).data.code;
  const unknown = await groupPost({ request: groupRequest({ action: 'nope', code, memberId: 'm1' }), env: { DB: db } });
  assert.equal(unknown.status, 400);
  assert.match((await unknown.json()).message, /未知的 action/);

  assert.equal(groupOther().status, 405);
  assert.equal(groupOptions().status, 204);
  assert.equal(GROUP_LIMITS.maxMembers, 20);
});

test('function：周/月键与排序规则', () => {
  assert.equal(weekKey(new Date('2026-10-03T09:00:00+08:00')), '2026-W40');
  assert.equal(monthKey(new Date('2026-10-03T09:00:00+08:00')), '2026-10');
  const rows = [
    { nickname: '甲', realm_index: 2, progress: 80, study_days: 5, member_id: 'a', updated_at: '' },
    { nickname: '乙', realm_index: 2, progress: 90, study_days: 3, member_id: 'b', updated_at: '' },
    { nickname: '丙', realm_index: 3, progress: 10, study_days: 1, member_id: 'c', updated_at: '' },
  ];
  const ranked = rankMembers(rows, 'b');
  assert.deepEqual(ranked.map((m) => m.nickname), ['丙', '乙', '甲'], '先按境界，再按进度');
  assert.equal(ranked[1].isMe, true);
  assert.equal(toMemberView({ ...rows[0], realm_index: 99 }, 'a').realmName, '化神', '境界越界应夹紧');
  assert.equal(toMemberView(rows[0], 'a').progress, 80);
});
