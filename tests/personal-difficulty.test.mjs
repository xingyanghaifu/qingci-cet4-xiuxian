/**
 * 个人难度（v1.11 第三轮）
 *
 * ── 为什么需要这一层 ──
 * 前两轮用了**通用难度**（词频分层）与**掌握状态**（答对次数）。
 * 但目标点名的另两个信号一直没用上：
 *   · `state.schedule[word].level` —— 用户在 SRS 复习里的自评（again/hard/good/easy）
 *   · `state.memStats[kind]`       —— 按题型的正确率（{r, n}）
 *
 * 它们描述的不是「这个词对一般人难不难」，而是「**对你**难不难」——
 * 高频词可能是某人的盲点，认知难词可能是他的强项。只看通用难度会漏掉个人差异。
 *
 * ── 三条红线（测试逐条守）──
 *   1. 不鼓励刷题：故意答错制造弱项不划算（有量化论证）
 *   2. 不制造焦虑：只加成不惩罚；样本不足不加成
 *   3. 不改 SRS：纯函数 + 只读信号
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTs } from './helpers/load-ts.mjs';

const ROOT = join(import.meta.dirname, '..');
const L = await loadTs('src/services/learning-value.ts');
const html = readFileSync(join(ROOT, 'src', 'index.template.html'), 'utf8');

/* ───────── 一、题型弱项 ───────── */

test('弱项：正确率越低加成越高（三档）', () => {
  const weak = L.kindWeaknessFactor({ r: 2, n: 10 });   // 20%
  const mid = L.kindWeaknessFactor({ r: 6, n: 10 });    // 60%
  const good = L.kindWeaknessFactor({ r: 9, n: 10 });   // 90%
  assert.ok(weak > mid, '明显弱项应高于待提升');
  assert.ok(mid > good, '待提升应高于达标');
  assert.equal(good, 1.0, '达标不加成');
});

test('弱项：样本不足不加成（防「1 题全错」白拿加成）', () => {
  assert.equal(L.kindWeaknessFactor({ r: 0, n: 1 }), 1.0, '1 题全错不应加成');
  assert.equal(L.kindWeaknessFactor({ r: 0, n: L.KIND_MIN_SAMPLES - 1 }), 1.0, '差一题不到门槛');
  assert.ok(L.kindWeaknessFactor({ r: 0, n: L.KIND_MIN_SAMPLES }) > 1, '达门槛才加成');
});

test('弱项：阈值边界正确（< 而非 ≤）', () => {
  // 50% 恰好是「明显弱项」的上界（不含）
  const t = L.WEAK_KIND_TIERS[0];
  assert.equal(L.kindWeaknessFactor({ r: 5, n: 10 }), L.WEAK_KIND_TIERS[1].bonus,
    '恰好 50% 应落到「待提升」档');
  assert.equal(L.kindWeaknessFactor({ r: 4, n: 10 }), t.bonus, '40% 应是「明显弱项」');
});

test('弱项：脏数据安全降级（返回 1.0，不抛错）', () => {
  for (const bad of [null, undefined, {}, 'x', 42, [], { r: 1 }, { n: 10 }, { r: NaN, n: NaN }]) {
    const v = L.kindWeaknessFactor(bad);
    assert.equal(v, 1.0, `输入 ${JSON.stringify(bad)} 应返回 1.0`);
  }
});

test('弱项：答对数 > 总数时夹紧（不产生负/超范围）', () => {
  const v = L.kindWeaknessFactor({ r: 99, n: 10 });
  assert.equal(v, 1.0, '夹紧后为 100% → 不加成');
});

/* ───────── 二、自评难度 ───────── */

test('自评：again / hard 有加成，good / easy 无', () => {
  assert.ok(L.selfRatedFactor('again') > L.selfRatedFactor('hard'), 'again 应高于 hard');
  assert.equal(L.selfRatedFactor('good'), 1.0);
  assert.equal(L.selfRatedFactor('easy'), 1.0);
  for (const bad of [null, undefined, '', 'nope', 42, {}]) {
    assert.equal(L.selfRatedFactor(bad), 1.0, `未知自评 ${JSON.stringify(bad)} 应不加成`);
  }
});

/* ───────── 三、综合与封顶 ───────── */

test('个人难度：两项相乘，且封顶 PERSONAL_FACTOR_CAP', () => {
  const both = L.personalDifficulty({ kindStat: { r: 2, n: 10 }, selfLevel: 'again' });
  assert.ok(Math.abs(both.factor - Math.min(L.PERSONAL_FACTOR_CAP, 1.2 * 1.25)) < 1e-9,
    `应为 1.2×1.25=1.5（实际 ${both.factor}）`);
  // 封顶：人为构造更大组合
  assert.ok(both.factor <= L.PERSONAL_FACTOR_CAP, '不得超过上限');
});

test('个人难度：无弱项无自评时为 1.0（不打扰正常玩家）', () => {
  const none = L.personalDifficulty({ kindStat: { r: 9, n: 10 }, selfLevel: 'good' });
  assert.equal(none.factor, 1.0);
  assert.equal(none.weak, false);
  assert.equal(none.reason, '', '无加成时不应有解释文案（避免噪声）');
});

test('个人难度：命中弱项时给出可读原因', () => {
  const r = L.personalDifficulty({ kindStat: { r: 2, n: 10 }, selfLevel: 'again' });
  assert.equal(r.weak, true);
  assert.ok(r.reason.length > 0, '应有解释');
  assert.ok(/弱项|提升/.test(r.reason), `应说明弱项：${r.reason}`);
  assert.ok(/忘记|模糊/.test(r.reason), `应说明自评：${r.reason}`);
});

test('个人难度：脏输入安全降级', () => {
  for (const bad of [null, undefined, {}, 'x', 42, [], { kindStat: 'nope', selfLevel: 5 }]) {
    const r = L.personalDifficulty(bad);
    assert.ok(Number.isFinite(r.factor) && r.factor > 0, `输入 ${JSON.stringify(bad)} 应有正系数`);
    assert.ok(r.factor <= L.PERSONAL_FACTOR_CAP);
  }
});

test('个人难度：纯函数，不修改入参', () => {
  const input = { kindStat: { r: 2, n: 10 }, selfLevel: 'again' };
  const snap = JSON.stringify(input);
  L.personalDifficulty(input);
  L.applyPersonalDifficulty(10, L.personalDifficulty(input));
  assert.equal(JSON.stringify(input), snap);
});

/* ───────── 四、反刷题：量化论证 ───────── */

test('反刷题：故意答错制造弱项**不划算**（量化）', () => {
  // 设基础修为 7/题；弱项加成最多 20%
  const base = 7;
  const weakBonus = L.WEAK_KIND_TIERS[0].bonus - 1;   // 0.2
  const gainPerCorrect = base * weakBonus;             // 每题多拿 1.4
  for (const K of [5, 10, 20]) {
    const lost = K * base;                             // 故意答错损失
    const breakEven = Math.ceil(lost / gainPerCorrect); // 需再答对多少题回本
    assert.ok(breakEven >= K * 3,
      `故意答错 ${K} 题需再答对 ${breakEven} 题才回本（应远大于 ${K}）`);
  }
});

test('反刷题：弱项加成**不足以补回**低正确率的损失', () => {
  // 关键论证：弱项意味着答对的题更少，加成不能抵消
  const base = 7;
  const total = 100;
  const strongAcc = 0.8, weakAcc = 0.5;
  const weakBonus = L.WEAK_KIND_TIERS[0].bonus;
  const strongTotal = total * strongAcc * base;
  const weakTotal = total * weakAcc * base * weakBonus;
  assert.ok(weakTotal < strongTotal,
    `弱项+加成(${weakTotal}) 仍应低于强项(${strongTotal}) —— 否则弱项反而更赚，会激励摆烂`);
});

test('不制造焦虑：任何输入下系数 ≥1（只加成不惩罚）', () => {
  for (const tier of [null, { r: 0, n: 10 }, { r: 10, n: 10 }]) {
    for (const lvl of [null, 'again', 'hard', 'good', 'easy']) {
      const r = L.personalDifficulty({ kindStat: tier, selfLevel: lvl });
      assert.ok(r.factor >= 1, `系数不应低于 1（实际 ${r.factor}）`);
    }
  }
});

test('apply：结果至少为 1', () => {
  assert.ok(L.applyPersonalDifficulty(1, { factor: 1.5 }) >= 1);
  assert.ok(L.applyPersonalDifficulty(0, { factor: 1.5 }) >= 1);
  assert.equal(L.applyPersonalDifficulty(10, null), 10, '系数缺失按 1');
});

/* ───────── 五、克制：不改 SRS ───────── */

test('克制：本模块不写存档、不改 SM-2', () => {
  const src = readFileSync(join(ROOT, 'src', 'services', 'learning-value.ts'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const bad of ['localStorage', 'setItem', 'scheduleNext', 'applyReview', 'nextEase']) {
    assert.ok(!code.includes(bad), `不应出现 ${bad}`);
  }
});

/* ───────── 六、接线 ───────── */

test('接线：settle 必须消费个人难度，且读的是**本次之前**的快照', () => {
  assert.ok(/personalDifficultyFor\(pdKindStat, pdSelfLevel\)/.test(html),
    'settle 未消费个人难度');
  // 快照必须在 memStats 自增与 scheduleWord 覆盖之前
  const iSnap = html.indexOf('const pdKindStat');
  const iMem = html.indexOf('rec.n++');
  const iSched = html.indexOf("scheduleWord(current.word,'good')");
  assert.ok(iSnap > 0, '找不到快照');
  assert.ok(iSnap < iMem, '快照必须在 memStats 自增之前（否则读到本次结果）');
  assert.ok(iSnap < iSched, '快照必须在 scheduleWord 覆盖 level 之前');
});

test('接线：个人难度系数必须乘进修为主要路径', () => {
  assert.ok(/const gainPD=/.test(html), '未计算 gainPD');
  assert.ok(/encQiBonus\(gainPD/.test(html), 'gainPD 未进入既有修为路径');
});

test('接线：界面标签只在有加成时显示', () => {
  assert.ok(/pdFactor!==1\?/.test(html), '应仅在系数≠1 时显示');
  assert.ok(/\.pd-tag\{/.test(html), '缺 .pd-tag 样式');
  assert.ok(/pdFactor\.toFixed\(2\)/.test(html), '应显示具体倍数');
});

test('接线：两个新函数与既有函数平级（防嵌套）', () => {
  const i = html.indexOf('function personalDifficultyFor(');
  const j = html.indexOf('function spiritGainFor(');
  assert.ok(i > 0 && j > i, '两个函数应存在且顺序正确');
  const open = html.indexOf('{', i);
  let d = 0, closed = -1;
  for (let k = open; k < html.length; k++) {
    if (html[k] === '{') d++;
    else if (html[k] === '}') { d--; if (d === 0) { closed = k; break; } }
  }
  assert.ok(closed > 0 && closed < j,
    'personalDifficultyFor 未在 spiritGainFor 之前闭合 —— 被嵌套会导致运行时未定义');
});
