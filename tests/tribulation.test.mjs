/**
 * 渡劫纯逻辑 + R9 会话门隔离基线（阶段 A · ②）
 *
 * R9 四场景（隔离方案回归基线）：
 *   场景1 会话元素不存在 → 全局快捷键照常
 *   场景2 会话元素 hidden → 全局快捷键照常
 *   场景3 会话可见 → 全局让位（谓词为真 + 静态证明门在一切分发之前 + 逐键枚举证明每个键都会开火）
 *   场景4 类被移除/隐藏 → 恢复
 *
 * 纯逻辑：资格/缺口/顶档/冷却（含 24h 边界）、难度带公式、抽题确定性与白名单、
 *         三档判定、护道符、夹逼「不掉境界」、放弃判定。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTs } from './helpers/load-ts.mjs';

const trib = await loadTs('src/services/tribulation.ts');
const shortcuts = await loadTs('src/services/shortcuts.ts');
const html = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.template.html'),
  'utf8',
);

const GUARD = "if (!tribSess[ti].classList.contains('hidden')) return;";
const mockSession = (hidden) => ({ classList: { contains: (t) => (t === 'hidden' ? hidden : false) } });

/* ─────────────── R9 场景 1/2/4：让位谓词语义 ─────────────── */

test('R9 场景1：会话元素不存在 → 全局快捷键不被让位', () => {
  assert.strictEqual(trib.tribulationSessionYields(null), false);
  assert.strictEqual(trib.tribulationSessionYields(undefined), false);
});

test('R9 场景2：会话元素 hidden → 全局快捷键不被让位', () => {
  assert.strictEqual(trib.tribulationSessionYields(mockSession(true)), false);
});

test('R9 场景4：类被移除（元素仍在但不含 trib-session 语义）→ 恢复；hidden 同理', () => {
  const session = mockSession(false);
  assert.strictEqual(trib.tribulationSessionYields(session), true, '可见时让位');
  // 模拟「移除 .trib-session 类」：查询落空 → null
  assert.strictEqual(trib.tribulationSessionYields(null), false, '类移除后恢复');
  // 模拟「加 .hidden 关闭」
  const closed = mockSession(true);
  assert.strictEqual(trib.tribulationSessionYields(closed), false, 'hidden 后恢复');
});

test('R9 场景3a：静态接线——门存在于两个全局 keydown 且先于一切分发（遍历任一可见会话）', () => {
  const guardCount = html.split(GUARD).length - 1;
  assert.strictEqual(guardCount, 2, '两个全局 keydown 处理器都必须装门');
  assert.ok(html.split("document.querySelectorAll('.trib-session')").length - 1 >= 2,
    '门必须遍历全部 .trib-session（首个元素可能 hidden，单点查询会漏）');

  const guardIdx = [];
  let i = -1;
  while ((i = html.indexOf(GUARD, i + 1)) >= 0) guardIdx.push(i);
  const inEditableIdx = [];
  i = -1;
  while ((i = html.indexOf('var inEditable', i + 1)) >= 0) inEditableIdx.push(i);
  assert.strictEqual(inEditableIdx.length, 2, '存在两个 inEditable 计算点');

  // 逐处理器配对：门必须先于各自 inEditable（先算 inEditable 就白算了，且晚于分发=失效）
  for (let k = 0; k < 2; k++) {
    assert.ok(guardIdx[k] < inEditableIdx[k], `第 ${k + 1} 个处理器：门必须在 inEditable 之前`);
  }
  // 快捷键解析调用必须在门之后
  const resolveIdx = html.indexOf('S.shortcuts.resolve(');
  assert.ok(guardIdx[0] < resolveIdx, '门必须先于 resolveShortcut 调用');
  // 覆盖层 Esc 分支必须落在「门之后、inEditable 之前」的窗口内
  //（不能用 closeTopOverlay 全局首现位置——函数声明本身就在门之前）
  const region2 = html.slice(guardIdx[1], inEditableIdx[1]);
  assert.ok(
    region2.includes('if (closeTopOverlay()) e.preventDefault()'),
    '门必须位于覆盖层 Esc 分支之上（Esc 归会话自己处理）',
  );
  // 不允许用 stopPropagation 暴力隔离
  const handlerRegion = html.slice(guardIdx[0], resolveIdx);
  assert.ok(!handlerRegion.includes('stopPropagation'), '快捷键处理器内不得出现 stopPropagation');
});

test('R9 场景3b：逐键枚举——12 个键在无门时全部会开火（门是唯一且充分的防线）', () => {
  const ctx = { hasChoices: true, hasAudio: true, inEditable: false, hasModifier: false };
  const keys = ['1', '2', '3', '4', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'r', 'Escape', 'Enter'];
  for (const key of keys) {
    const action = shortcuts.resolveShortcut(key, ctx);
    assert.ok(action, `键 "${key}" 在无门时应解析出动作（否则门对它并非必要防线）`);
  }
  // 门的语义：可见即让位（早于上述任何解析）
  assert.strictEqual(trib.tribulationSessionYields(mockSession(false)), true, '渡劫可见 → 全局12键全部让位');
});

/* ─────────────── 资格 / 冷却 ─────────────── */

test('canTribulate：双条件达标 → ok，位次推进目标正确', () => {
  const r = trib.canTribulate({ qi: 120, currentIndex: 0, vocabSize: 1500, bestScore: 450, now: 1 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.targetIndex, 1);
  assert.strictEqual(r.eligibleIndex, 1);
});

test('canTribulate：未达标 → 缺口按目标境界阈值计算', () => {
  const r = trib.canTribulate({ qi: 60, currentIndex: 0, vocabSize: 900, bestScore: 350, now: 1 });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'not-qualified');
  assert.deepStrictEqual(r.gap, { vocab: 100, score: 50 });

  // 只差分数条件：词汇缺口为 0
  const r2 = trib.canTribulate({ qi: 60, currentIndex: 0, vocabSize: 1500, bestScore: 350, now: 1 });
  assert.strictEqual(r2.reason, 'not-qualified');
  assert.deepStrictEqual(r2.gap, { vocab: 0, score: 50 });
});

test('canTribulate：顶档（化神 index=4）→ maxed，且先于资格判断', () => {
  const r = trib.canTribulate({ qi: 999, currentIndex: 4, vocabSize: 9999, bestScore: 710, now: 1 });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'maxed');
});

test('canTribulate：24h 冷却——剩余时间计算与精确边界', () => {
  const now = Date.parse('2026-10-04T12:00:00+08:00');
  const base = { qi: 120, currentIndex: 0, vocabSize: 1500, bestScore: 450, now };

  // 1 小时前结束 → 冷却中，剩余 23h
  const r1 = trib.canTribulate({ ...base, lastFinishedAt: '2026-10-04T11:00:00+08:00' });
  assert.strictEqual(r1.reason, 'cooldown');
  assert.strictEqual(r1.remainingMs, 23 * 3600 * 1000);

  // 恰好 24h（elapsed == COOLDOWN，不满足 < ）→ 放行
  const r2 = trib.canTribulate({ ...base, lastFinishedAt: '2026-10-03T12:00:00+08:00' });
  assert.strictEqual(r2.ok, true, '恰好 24h 应放行');

  // 24h 差 1 秒 → 仍冷却，剩余 1000ms
  const r3 = trib.canTribulate({ ...base, lastFinishedAt: '2026-10-03T12:00:01+08:00' });
  assert.strictEqual(r3.reason, 'cooldown');
  assert.strictEqual(r3.remainingMs, 1000);
});

test('vocabSizeOf：已斩与摸底取大（与埋点快照同源）', () => {
  assert.strictEqual(trib.vocabSizeOf(1200, 800), 1200);
  assert.strictEqual(trib.vocabSizeOf(800, 1200), 1200);
  assert.strictEqual(trib.vocabSizeOf(0, 0), 0);
});

/* ─────────────── 难度带与抽题 ─────────────── */

test('difficultyRangeForRealm：difficultyForRealm 同式换算到 0–1 带', () => {
  // examLevel=4：realmTo 0,1 → d=4；realmTo 2,3,4 → d=5
  assert.deepStrictEqual(trib.difficultyRangeForRealm(0, 4), [0.5, 0.8]);
  assert.deepStrictEqual(trib.difficultyRangeForRealm(1, 4), [0.5, 0.8]);
  assert.deepStrictEqual(trib.difficultyRangeForRealm(2, 4), [0.65, 0.95]);
  assert.deepStrictEqual(trib.difficultyRangeForRealm(3, 4), [0.65, 0.95]);
  assert.deepStrictEqual(trib.difficultyRangeForRealm(4, 4), [0.65, 0.95]);
  // 单调不降 + 始终合法区间
  let prev = 0;
  for (let r = 0; r <= 6; r++) {
    const [lo, hi] = trib.difficultyRangeForRealm(r, 4);
    assert.ok(lo >= 0 && hi <= 1 && lo <= hi, `realm ${r} 区间非法`);
    assert.ok(lo >= prev, `realm ${r} 难度带应不降于前一档`);
    prev = lo;
  }
  // 越界与脏输入夹逼
  assert.deepStrictEqual(trib.difficultyRangeForRealm(99, 9), [0.65, 0.95]);
  assert.deepStrictEqual(trib.difficultyRangeForRealm(-5, 4), [0.5, 0.8]);
});

function makeBank() {
  const questions = [];
  const kinds = ['news', 'bank', 'talk', 'write']; // write 必须被白名单挡掉
  for (const kind of kinds) {
    for (let i = 0; i < 10; i++) {
      questions.push({
        id: `${kind}-${i}`,
        kind,
        difficulty: Math.round((0.1 + i * 0.09) * 100) / 100, // 0.10 … 0.91
        discrimination: 0.3,
        knowledgeTags: [],
      });
    }
  }
  return { questions };
}

test('pickTribulationQuestions：同 seed 确定性、白名单、难度带、题量', () => {
  const bank = makeBank();
  const a = trib.pickTribulationQuestions(bank, { realmTo: 4, seed: 42 });
  const b = trib.pickTribulationQuestions(bank, { realmTo: 4, seed: 42 });
  assert.deepStrictEqual(a.map((q) => q.id), b.map((q) => q.id), '同 seed 必须同题');

  const c = trib.pickTribulationQuestions(bank, { realmTo: 4, seed: 43 });
  assert.notDeepStrictEqual(a.map((q) => q.id), c.map((q) => q.id), '不同 seed 应产出不同题');

  assert.strictEqual(a.length, 10, '默认抽 10 题');
  for (const q of a) {
    assert.ok(trib.TRIBULATION_KINDS.includes(q.kind), `题型 ${q.kind} 不在白名单`);
    assert.notStrictEqual(q.kind, 'write', '写作题必须被排除');
    assert.ok(q.difficulty >= 0.65 - 0.12 && q.difficulty <= 0.95 + 0.12, `难度 ${q.difficulty} 超出目标带容差`);
  }
});

/* ─────────────── 三档判定 / 护道符 / 夹逼 / 放弃 ─────────────── */

test('gradeTribulation：三档判定（≥8 过；5–7 扣10%；<5 扣20%）', () => {
  const input = { qi: 100, maxSafeDeduct: 100 };
  const pass = trib.gradeTribulation(10, input);
  assert.deepStrictEqual(pass, { passed: true, qiPenalty: 0, talismanUsed: false, penaltyRate: 0 });
  assert.strictEqual(trib.gradeTribulation(8, input).passed, true, '8/10 为通过线');

  const mid = trib.gradeTribulation(7, input);
  assert.strictEqual(mid.passed, false);
  assert.strictEqual(mid.penaltyRate, 0.1);
  assert.strictEqual(mid.qiPenalty, 10, 'ceil(100×0.1)=10');

  const low = trib.gradeTribulation(4, input);
  assert.strictEqual(low.penaltyRate, 0.2);
  assert.strictEqual(low.qiPenalty, 20, 'ceil(100×0.2)=20');
  assert.strictEqual(trib.gradeTribulation(5, input).qiPenalty, 10, '5 题属中档');
});

test('gradeTribulation：护道符——抵扣扣罚并消耗；成功不消耗', () => {
  const input = { qi: 100, maxSafeDeduct: 100, hasTalisman: true };
  const saved = trib.gradeTribulation(6, input);
  assert.strictEqual(saved.qiPenalty, 0, '护道符抵住扣罚');
  assert.strictEqual(saved.talismanUsed, true, '消耗一张');
  assert.strictEqual(saved.penaltyRate, 0.1, '档位仍如实记录');

  const win = trib.gradeTribulation(9, input);
  assert.strictEqual(win.talismanUsed, false, '成功不消耗护道符');
});

test('gradeTribulation：夹逼「扣修为不掉境界」与 qi 下限', () => {
  // 原始扣罚 20，但当层结余只有 5 → 最多扣 5，保证十档 index 不变
  const r = trib.gradeTribulation(3, { qi: 100, maxSafeDeduct: 5 });
  assert.strictEqual(r.qiPenalty, 5);
  // qi 为 0 → 无可扣，且不该误耗护道符
  const r0 = trib.gradeTribulation(3, { qi: 0, maxSafeDeduct: 0, hasTalisman: true });
  assert.strictEqual(r0.qiPenalty, 0);
  assert.strictEqual(r0.talismanUsed, false, '无罚可抵时不消耗护道符');
  // 结余大于原始扣罚 → 按原始扣
  const r2 = trib.gradeTribulation(4, { qi: 100, maxSafeDeduct: 50 });
  assert.strictEqual(r2.qiPenalty, 20);
});

test('gradeTribulation：Esc 放弃——永不判过，按当前答对数落失败档', () => {
  // 已答 8 题全对再放弃：按约定也必须是失败（堵住中途白嫖）
  const high = trib.gradeTribulation(8, { qi: 100, maxSafeDeduct: 100, abandoned: true });
  assert.strictEqual(high.passed, false, '放弃永不判过');
  assert.strictEqual(high.penaltyRate, 0.1, '≥5 按 10% 档');
  assert.strictEqual(high.qiPenalty, 10);

  const low = trib.gradeTribulation(2, { qi: 100, maxSafeDeduct: 100, abandoned: true });
  assert.strictEqual(low.penaltyRate, 0.2, '<5 按 20% 档');
  assert.strictEqual(low.qiPenalty, 20);

  // 放弃也走护道符
  const saved = trib.gradeTribulation(6, { qi: 100, maxSafeDeduct: 100, abandoned: true, hasTalisman: true });
  assert.strictEqual(saved.qiPenalty, 0);
  assert.strictEqual(saved.talismanUsed, true);
});

test('TribulationRecord：类型契约字段齐全（编译期 + 运行期样例）', () => {
  /** @type {import('src/services/tribulation.ts').TribulationRecord} */
  const rec = {
    id: 'trib-1',
    realmFrom: 0,
    realmTo: 1,
    startedAt: '2026-10-04T12:00:00+08:00',
    finishedAt: '2026-10-04T12:04:10+08:00',
    correctCount: 8,
    totalCount: 10,
    passed: true,
    qiPenalty: 0,
    questionIds: ['news-1', 'bank-3'],
  };
  assert.strictEqual(rec.totalCount, trib.TRIBULATION_TOTAL);
  assert.ok(rec.passed && rec.qiPenalty === 0);
});

/* ─────────────── 会话纯核心（③ 步骤3） ─────────────── */

test('会话：createTribSession 初始态与自定义题量', () => {
  const s = trib.createTribSession();
  assert.deepStrictEqual(
    { idx: s.idx, correct: s.correct, answers: s.answers.length, total: s.total, locked: s.locked },
    { idx: 0, correct: 0, answers: 0, total: 10, locked: false },
  );
  const s7 = trib.createTribSession(7);
  assert.strictEqual(s7.total, 7);
  assert.strictEqual(trib.createTribSession(0).total, 1, '题量下限夹到 1');
});

test('会话：answerPick 对错计数、推进、锁定防连点', () => {
  let s = trib.createTribSession();
  const a = trib.answerPick(s, 2, 2);
  assert.strictEqual(a.correct, 1, '答对 +1');
  assert.deepStrictEqual(a.answers, [2]);
  assert.strictEqual(a.idx, 1);
  assert.strictEqual(a.locked, true, '选中即锁步');

  const b = trib.answerPick(a, 0, 2); // locked → 原样返回（防连点）
  assert.strictEqual(b, a, '锁定期间再按应幂等');

  const c = trib.releaseTribLock(a);
  assert.strictEqual(c.locked, false);
  assert.notStrictEqual(c, a, '释放锁产出新状态');

  const d = trib.answerPick(c, 0, 2); // 答错
  assert.strictEqual(d.correct, 1, '答错不加');
  assert.deepStrictEqual(d.answers, [2, 0]);
  assert.strictEqual(trib.answerPick(c, -1, 2), c, '越界下标原样返回');
});

test('会话：第 10 题后 sessionDone，done 状态不再推进', () => {
  let s = trib.createTribSession(3);
  s = trib.releaseTribLock(trib.answerPick(s, 1, 1));
  s = trib.releaseTribLock(trib.answerPick(s, 1, 1));
  assert.strictEqual(trib.tribSessionDone(s), false, '3 题中第 2 题后未完成');
  s = trib.releaseTribLock(trib.answerPick(s, 1, 1));
  assert.strictEqual(trib.tribSessionDone(s), true, '答满 3 题完成');
  assert.strictEqual(s.correct, 3);
});

test('计时：formatTribTime 边界', () => {
  assert.strictEqual(trib.formatTribTime(300), '剩余 5:00');
  assert.strictEqual(trib.formatTribTime(65), '剩余 1:05');
  assert.strictEqual(trib.formatTribTime(7), '剩余 0:07');
  assert.strictEqual(trib.formatTribTime(0), '剩余 0:00');
  assert.strictEqual(trib.formatTribTime(-5), '剩余 0:00', '负数夹到 0');
  assert.strictEqual(trib.formatTribTime(NaN), '剩余 0:00', '脏输入夹到 0');
});

test('计时：tribTimerWarn ≤30s 警示边界（0 与 >30 不警）', () => {
  assert.strictEqual(trib.tribTimerWarn(31), false);
  assert.strictEqual(trib.tribTimerWarn(30), true);
  assert.strictEqual(trib.tribTimerWarn(1), true);
  assert.strictEqual(trib.tribTimerWarn(0), false, '归零由结束流程接管');
  assert.strictEqual(trib.tribTimerWarn('x'), false);
});

test('键盘：tribPickIndexFromKey 仅 1-4', () => {
  assert.deepStrictEqual(['1', '2', '3', '4'].map((k) => trib.tribPickIndexFromKey(k)), [0, 1, 2, 3]);
  for (const k of ['0', '5', 'A', '', 'ArrowLeft', 'Enter', ' ']) {
    assert.strictEqual(trib.tribPickIndexFromKey(k), null, `"${k}" 应为 null`);
  }
});

test('题目：tribCorrectIndex 文本形态 / 下标形态 / 识别失败', () => {
  assert.strictEqual(trib.tribCorrectIndex({ content: { choices: ['甲', '乙'], answer: '乙' } }), 1, '文本答案');
  assert.strictEqual(trib.tribCorrectIndex({ content: { choices: ['甲', '乙'], answer: 0 } }), 0, '下标答案');
  assert.strictEqual(trib.tribCorrectIndex({ content: { choices: ['甲'], answer: '不存在' } }), -1, '识别失败 → -1（按答错处理）');
  assert.strictEqual(trib.tribCorrectIndex(null), -1);
});

test('抽题：difficulty 覆盖入参（加宽补抽）仅扩展不改判', () => {
  const bank = makeBank();
  const narrow = trib.pickTribulationQuestions(bank, { realmTo: 4, seed: 7 });
  const wide = trib.pickTribulationQuestions(bank, { realmTo: 4, seed: 7, difficulty: [0, 1] });
  // 加宽带应能容纳更宽的难度范围（宽带包含窄带候选）
  const narrowMax = Math.max(...narrow.map((q) => q.difficulty));
  const wideMax = Math.max(...wide.map((q) => q.difficulty));
  assert.ok(wideMax >= narrowMax, '覆盖带不窄于默认带');
  for (const q of wide) assert.ok(q.difficulty >= 0 && q.difficulty <= 1);
});

/* ─────────────── 改道：gamification.deferRealmAdvance（③步骤4） ─────────────── */

const gT = await loadTs('src/services/gamification.ts');

const SNAP = { vocabSize: 1500, bestScore: 450, studyDays: 10, masteredWords: 80, fullPaperCompleted: true, partStats: [] };
const PREV = { realmIndex: 0, titles: [], breakthroughs: [], titleUnlocks: [] };

test('改道：defer 模式位次不推进、突破仅作提示、历史不追加、展示钳在当前境界', () => {
  const res = gT.evaluateProgress(SNAP, PREV, { deferRealmAdvance: true });
  assert.ok(res.breakthrough, '突破信息仍须返回（供「渡劫资格已开启」提示）');
  assert.strictEqual(res.state.realmIndex, 0, 'defer 时位次不得推进');
  assert.strictEqual(res.state.breakthroughs.length, 0, '未真实晋级不得写突破史');
  // 展示钳制：realm 停在当前、next 指向目标、进度按 当前→目标 重算
  assert.strictEqual(res.status.realm.index, 0, '洞府卡/道友榜不得显示未获得的境界');
  assert.strictEqual(res.status.next.index, 1, 'next 应为可挑战目标');
  assert.strictEqual(res.status.justEligible, true, '待渡劫标记');
  assert.strictEqual(res.status.vocabMet ?? res.status.gap.vocabMet, true);
});

test('改道：不开 defer 的默认行为完全不变（保护 190 回归）', () => {
  const res = gT.evaluateProgress(SNAP, PREV);
  assert.strictEqual(res.state.realmIndex, 1, '默认仍自动推进（纯函数语义不变）');
  assert.strictEqual(res.state.breakthroughs.length, 1, '默认写突破史');
  assert.strictEqual(res.status.realm.index, 1, '默认展示可及境界');
});

test('改道：recordProgress 三参透传（storage + options）', () => {
  const mem = { _m: new Map(), getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }, setItem(k, v) { this._m.set(k, v); } };
  const res = gT.recordProgress(SNAP, mem, { deferRealmAdvance: true });
  assert.strictEqual(res.state.realmIndex, 0);
  assert.strictEqual(gT.loadGamification(mem).realmIndex, 0, '落库位次也应停在 0');
  const res2 = gT.recordProgress(SNAP, mem); // 默认不 defer
  assert.strictEqual(gT.loadGamification(mem).realmIndex, 1, '默认路径照常推进');
});

/* ─────────────── 道具清单摘要（境界卡只读，验收 17-19） ─────────────── */

test('清单摘要：护道符计数 / 聚灵阵时效 / 丹书窗口 / 脏数据兜底', () => {
  const now = Date.now();
  const zero = { talisman: 0, arrayUntil: null, pills: [], books: [] };
  assert.deepStrictEqual(trib.readInventorySummary([], now), zero);
  assert.deepStrictEqual(trib.readInventorySummary(null, now), zero);
  const active = new Date(now + 3600_000).toISOString();
  const expired = new Date(now - 1000).toISOString();
  const sum = trib.readInventorySummary([
    { id: 'talisman', count: 3 },
    { id: 'array', activeUntil: active },
    { id: 'pill:about', count: 1, activeUntil: active },   // 生效中的记忆丹
    { id: 'pill:abandon', count: 1, activeUntil: expired }, // 已过期 → 不计
    { id: 'book:xray', count: 1 },                          // 永久解锁
  ], now);
  assert.strictEqual(sum.talisman, 3);
  assert.strictEqual(sum.arrayUntil, active, '生效中返回截止时间');
  assert.deepStrictEqual(sum.pills, ['about'], '只统计未过期的记忆丹');
  assert.deepStrictEqual(sum.books, ['xray'], '古籍永久解锁');
  const sum2 = trib.readInventorySummary([{ id: 'talisman', count: 2 }, { id: 'array', activeUntil: expired }], now);
  assert.strictEqual(sum2.talisman, 2);
  assert.strictEqual(sum2.arrayUntil, null, '过期聚灵阵视为未生效');
  assert.strictEqual(trib.readInventorySummary([{ id: 'array', activeUntil: '不是时间' }], now).arrayUntil, null, '脏时间兜底');
});
