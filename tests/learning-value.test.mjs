/**
 * 学习价值（Learning Value）—— 让产出与真实学习收益一一对应
 *
 * ── 实测确认的脱节（本模块要修的）──
 * 真浏览器探针证明：
 *
 *     qiForCorrect.length === 1          // 公式只有「连对」一个参数
 *     qiForCorrect(0|1|2)  = 6
 *     qiForCorrect(3)      = 7
 *     qiForCorrect(5|10|50)= 9           // 连对 10 与 50 相同，且上限 9
 *
 *     词                  tier        答对收益
 *     a                  high        6
 *     abandon            low         6      ← 与最简单的高频词相同
 *     notwithstanding    core        6
 *
 * 即 **刷 20 个高频简单词 = 攻克 20 个生词**，且已掌握词反复答对不衰减。
 *
 * ── 三条红线（测试逐条守）──
 *   1. 不鼓励刷题：刷同一个词收益快速递减；刷高频简单词无利可图
 *   2. 不制造焦虑：只增不减，只是增速不同；不惩罚任何行为
 *   3. 不改 SRS：纯函数 + 只读信号，不写 schedule
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTs } from './helpers/load-ts.mjs';

const ROOT = join(import.meta.dirname, '..');
const L = await loadTs('src/services/learning-value.ts');
const html = readFileSync(join(ROOT, 'src', 'index.template.html'), 'utf8');

/* ───────── 一、难度权重：越该攻克越值钱 ───────── */

test('难度权重：认知词 > 低频 > 核心 > 高频', () => {
  const { recognition, low, core, high } = L.TIER_WEIGHT;
  assert.ok(recognition > low, '认知词应高于低频');
  assert.ok(low > core, '低频应高于核心');
  assert.ok(core > high, '核心应高于高频');
  assert.equal(high, 1.0, '高频是基础值 1.0');
});

test('难度权重：**高频词收益最低**（与「刷简单词」的直觉相反，是刻意的）', () => {
  // 若高频最高，用户会被激励去刷最简单的词 —— 那是反学习的
  const tiers = ['high', 'core', 'low', 'recognition'];
  const weights = tiers.map((t) => L.tierWeight(t));
  assert.equal(weights[0], Math.min(...weights), '高频必须是权重最低的');
  assert.equal(weights[3], Math.max(...weights), '认知词必须是权重最高的');
});

test('档位归一化：未知/脏值按 core 兜底（与 tierOf 口径一致）', () => {
  for (const bad of [null, undefined, '', 'nope', 42, {}, []]) {
    assert.equal(L.normalizeTier(bad), 'core', `输入 ${JSON.stringify(bad)} 应兜底为 core`);
  }
  assert.equal(L.normalizeTier('HIGH'), 'high', '大小写不敏感');
});

/* ───────── 二、新鲜度递减（反刷题核心） ───────── */

test('新鲜度：首次答对 1.0，之后逐级递减', () => {
  assert.equal(L.freshnessFactor(0), 1.0, '首次');
  assert.equal(L.freshnessFactor(1), 0.75);
  assert.equal(L.freshnessFactor(2), 0.55);
  assert.equal(L.freshnessFactor(3), 0.4);
  assert.equal(L.freshnessFactor(99), 0.4, '超出表格取下限');
  // 严格递减
  const seq = [0, 1, 2, 3].map((n) => L.freshnessFactor(n));
  for (let i = 1; i < seq.length; i++) assert.ok(seq[i] < seq[i - 1], '必须严格递减');
});

test('新鲜度：下限是 0.4 而非趋近 0（**复习仍须有价值**）', () => {
  // 若下限太低，用户会觉得「按 SRS 复习不值钱」，转而去刷没见过的词 —— 更糟的学习行为
  const floor = L.freshnessFactor(100);
  assert.ok(floor >= 0.35, `复习收益地板不应低于 0.35（实际 ${floor}）`);
  assert.ok(floor < 1, '但仍须低于首次，以体现边际递减');
});

test('反刷题：同一词反复答对的收益快速衰减', () => {
  const first = L.learningValue({ tier: 'core', correctTimes: 0 }).factor;
  const second = L.learningValue({ tier: 'core', correctTimes: 1 }).factor;
  const fifth = L.learningValue({ tier: 'core', correctTimes: 5 }).factor;
  assert.ok(second < first, '第 2 次应低于第 1 次');
  assert.ok(fifth < second, '第 5 次应低于第 2 次');
  assert.ok(fifth <= first * 0.45, `反复刷应衰减到 45% 以下（实际 ${(fifth / first * 100).toFixed(0)}%）`);
});

test('反刷题：攻克生词 >> 刷已掌握的高频词', () => {
  const { diligent, grinder, ratio } = L.comparePlaystyles();
  assert.ok(ratio >= 3, `勤学/刷分 收益比应 ≥3 倍（实际 ${ratio}）`);
  assert.ok(diligent > grinder, '攻克生词收益必须高于刷高频已掌握词');
});

test('学习价值：难度与新鲜度的**交叉**效应正确', () => {
  // 首次认知词 vs 反复刷的高频词 —— 前者应显著更高
  const a = L.learningValue({ tier: 'recognition', correctTimes: 0, everWrong: true }).factor;
  const b = L.learningValue({ tier: 'high', correctTimes: 5 }).factor;
  assert.ok(a > b * 3, `首次攻克难词应远高于刷高频（${a} vs ${b}）`);
});

/* ───────── 三、连对与攻克加成 ───────── */

test('连对：作为独立分量参与（保留既有机制）', () => {
  const noCombo = L.learningValue({ tier: 'core', correctTimes: 0, comboMultiplier: 1 }).factor;
  const combo = L.learningValue({ tier: 'core', correctTimes: 0, comboMultiplier: 1.5 }).factor;
  assert.ok(Math.abs(combo / noCombo - 1.5) < 1e-9, '连对倍率应线性叠加');
});

test('攻克加成：答错过的词下次答对享受加成（学习真正发生处）', () => {
  const plain = L.learningValue({ tier: 'core', correctTimes: 0, everWrong: false }).factor;
  const conquered = L.learningValue({ tier: 'core', correctTimes: 0, everWrong: true }).factor;
  assert.ok(conquered > plain, '攻克心魔词应有加成');
  // ⚠️ 系数四舍五入到 3 位，比值不会精确等于 1.25（1.15×1.25=1.4375→1.438）
  // 所以用容差比较，而不是严格相等
  const ratio = conquered / plain;
  assert.ok(Math.abs(ratio - L.CONQUER_BONUS) < 0.01,
    `比值应接近 ${L.CONQUER_BONUS}（实际 ${ratio.toFixed(4)}）`);
});

test('首次标记：correctTimes=0 时 firstTime 为真', () => {
  assert.equal(L.learningValue({ correctTimes: 0 }).firstTime, true);
  assert.equal(L.learningValue({ correctTimes: 3 }).firstTime, false);
});

/* ───────── 四、不制造焦虑 ───────── */

test('不惩罚：任何输入下系数都 > 0（答对一定有正反馈）', () => {
  for (const tier of ['high', 'core', 'low', 'recognition']) {
    for (const n of [0, 1, 5, 100]) {
      const v = L.learningValue({ tier, correctTimes: n });
      assert.ok(v.factor > 0, `${tier}/${n} 系数必须为正（实际 ${v.factor}）`);
    }
  }
});

test('apply：结果至少为 1（不会因系数小而变成 0）', () => {
  assert.equal(L.applyLearningValue(1, { factor: 0.1 }), 1, '最小应为 1');
  assert.equal(L.applyLearningValue(10, { factor: 1.875 }), 19, '10×1.875=18.75 → 19');
  assert.ok(L.applyLearningValue(6, { factor: 0.4 }) >= 1);
});

test('apply：脏输入安全降级，不抛错', () => {
  for (const bad of [null, undefined, 0, -5, NaN, 'x']) {
    const r = L.applyLearningValue(bad, { factor: 1.5 });
    assert.ok(Number.isFinite(r) && r >= 1, `输入 ${JSON.stringify(bad)} 应返回 ≥1 的有限数`);
  }
  assert.equal(L.applyLearningValue(10, null), 10, '系数缺失时按 1 处理');
  assert.equal(L.applyLearningValue(10, { factor: 0 }), 10);
});

test('文案：不含批评性词汇（只解释，不评价）', () => {
  const SCARY = /差|失败|糟糕|退步|落后|不合格|惩罚/;
  for (const tier of ['high', 'core', 'low', 'recognition']) {
    for (const n of [0, 1, 5]) {
      const r = L.learningValue({ tier, correctTimes: n }).reason;
      assert.ok(!SCARY.test(r), `文案不应有负面词：${r}`);
      assert.ok(r.length > 0, '应有解释文案');
    }
  }
});

/* ───────── 五、掌握阶段 ───────── */

test('掌握阶段：0/1/2/3+ 对应 生词/初识/熟悉/已掌握', () => {
  assert.equal(L.masteryStage(0), 'new');
  assert.equal(L.masteryStage(1), 'learning');
  assert.equal(L.masteryStage(2), 'familiar');
  assert.equal(L.masteryStage(3), 'mastered');
  assert.equal(L.masteryStage(50), 'mastered');
  for (const k of ['new', 'learning', 'familiar', 'mastered']) {
    assert.ok(L.MASTERY_LABEL[k], `缺阶段中文名：${k}`);
  }
});

/* ───────── 六、稳健性与纯函数 ───────── */

test('脏数据安全降级，不抛错', () => {
  for (const bad of [null, undefined, {}, 'x', 42, [], { tier: 1, correctTimes: 'a' }]) {
    const v = L.learningValue(bad);
    assert.ok(Number.isFinite(v.factor) && v.factor > 0);
    assert.ok(['high', 'core', 'low', 'recognition'].includes(v.tier));
    assert.ok(typeof v.reason === 'string');
  }
  assert.equal(L.freshnessFactor(NaN), 1.0, 'NaN 按首次处理');
  assert.equal(L.freshnessFactor(-3), 1.0, '负数按首次处理');
});

test('纯函数：不修改入参', () => {
  const input = { tier: 'low', correctTimes: 2, everWrong: true, streak: 5, comboMultiplier: 1.2 };
  const snap = JSON.stringify(input);
  L.learningValue(input);
  L.applyLearningValue(10, L.learningValue(input));
  assert.equal(JSON.stringify(input), snap);
});

test('系数精度：四舍五入到 3 位（避免浮点噪声进存档）', () => {
  const v = L.learningValue({ tier: 'recognition', correctTimes: 1, everWrong: true, comboMultiplier: 1.2 });
  const s = String(v.factor);
  const decimals = s.includes('.') ? s.split('.')[1].length : 0;
  assert.ok(decimals <= 3, `系数小数位应 ≤3（实际 ${s}）`);
});

/* ───────── 七、克制：不改 SRS、不写存档 ───────── */

test('克制：本模块不写存档、不改 SM-2', () => {
  const src = readFileSync(join(ROOT, 'src', 'services', 'learning-value.ts'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const bad of ['localStorage', 'setItem', 'save(', 'scheduleNext', 'applyReview', 'nextEase']) {
    assert.ok(!code.includes(bad), `learning-value.ts 不应出现 ${bad}（SRS 语义必须不变）`);
  }
});

/* ───────── 八、接线契约 ───────── */

test('接线：模板的修为结算必须消费学习价值', () => {
  // 模板用局部别名（`var L=S&&S.learning`）再 `L.value(...)`，
  // 所以断言「取了 learning 服务」+「调用了 value()」，而不是写死某个前缀。
  assert.ok(/S\.learning|QingciServices\.learning/.test(html),
    '模板未取 learning 服务 —— 产出仍与学习价值脱节');
  assert.ok(/\bL\.value\s*\(/.test(html), '模板未调用 learning.value()');
  // 必须在 settle 的修为结算处真的用上（不能只是取了服务没用）
  assert.ok(/learningValueFor\(current&&current\.word/.test(html),
    'settle 未按当前词计算学习价值');
  assert.ok(/Math\.round\(gain\*lvFactor\)/.test(html),
    '学习价值系数未乘到既有修为上');
  assert.ok(/encQiBonus|qiGainFor/.test(html), '既有修为路径应保留（在其上乘系数）');
});

test('接线：学习价值是**只读**信号（不得改写 known/wrong/schedule）', () => {
  // 提取 learningValueFor 函数体，确认它只读
  const i = html.indexOf('function learningValueFor(');
  assert.ok(i > 0, '找不到 learningValueFor');
  const body = html.slice(i, html.indexOf('\n}', i));
  for (const bad of ['state.known[', 'state.wrong[', 'state.schedule[', 'save()']) {
    // 允许出现在读取表达式里（如 `state.known&&state.known[w]`），但不得赋值
    const assign = new RegExp(bad.replace('[', '\\[').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*=[^=]');
    assert.ok(!assign.test(body), `learningValueFor 不应写入 ${bad}`);
  }
});

test('接线：界面必须解释「为什么这次收益多/少」（否则机制不可见）', () => {
  // 一个看不见的机制等于没有机制 —— 玩家必须能理解差异从哪来
  assert.ok(/lv-tag/.test(html), '缺 .lv-tag 样式（学习价值标签）');
  assert.ok(/learningReasonFor\(/.test(html), '缺 learningReasonFor（可读解释）');
  assert.ok(/学习价值 ×/.test(html), '反馈里未展示学习价值系数');
});

test('接线：解释与计算同源（不得两处各算一份口径）', () => {
  // 上一轮踩过「同一份定义两处各写一份」的坑：解释必须复用 learningValueFor 的取数逻辑
  const i = html.indexOf('function learningReasonFor(');
  assert.ok(i > 0, '找不到 learningReasonFor');
  const body = html.slice(i, html.indexOf('\n}', i));
  assert.ok(/S\.learning/.test(body), '解释未取 learning 服务');
  assert.ok(/tierOf/.test(body), '解释未取词档位');
  assert.ok(/state\.known/.test(body) && /state\.wrong/.test(body),
    '解释未复用 known/wrong 口径 —— 会与收益计算分叉');
});

test('接线：标签在系数为 1 时不显示（避免噪声）', () => {
  // 系数 1 表示「标准收益」，显示 ×1.00 只是噪声
  assert.ok(/lvFactor!==1/.test(html), '系数为 1 时不应显示标签');
});

test('回归守卫：learningReasonFor 必须与 learningValueFor **平级**（不得被嵌套）', () => {
  // 真实踩到：插入脚本吞掉了 learningValueFor 的收尾 `}`，
  // 导致 learningReasonFor 被嵌进它内部 → 运行时 `learningReasonFor is not defined`，
  // 而且**构建期不报错**（esbuild 把它改名为 learningReasonFor2，调用处却没跟着改）。
  const iVal = html.indexOf('function learningValueFor(');
  const iReason = html.indexOf('function learningReasonFor(');
  assert.ok(iVal > 0 && iReason > iVal, '两个函数都应存在且顺序正确');

  // 从 learningValueFor 起做花括号配平，确认它在 learningReasonFor 之前就闭合
  const open = html.indexOf('{', iVal);
  let depth = 0, closed = -1;
  for (let j = open; j < html.length; j++) {
    if (html[j] === '{') depth++;
    else if (html[j] === '}') { depth--; if (depth === 0) { closed = j; break; } }
  }
  assert.ok(closed > 0 && closed < iReason,
    'learningValueFor 未在 learningReasonFor 之前闭合 —— learningReasonFor 被嵌套了（会导致运行时未定义）');
});

test('回归守卫：两个函数在**同一个 script 块**内（否则跨块引用会断）', () => {
  const bounds = [...html.matchAll(/<script(?![^>]*src)[^>]*>/g)].map((m) => m.index);
  const blockOf = (idx) => {
    let which = -1;
    for (let k = 0; k < bounds.length; k++) if (bounds[k] < idx) which = k;
    return which;
  };
  const a = blockOf(html.indexOf('function learningValueFor('));
  const b = blockOf(html.indexOf('function learningReasonFor('));
  const c = blockOf(html.indexOf('function settle('));
  assert.ok(a === b && b === c,
    `三个函数应在同一 script 块（实际 ${a}/${b}/${c}）—— 跨块会静默断开引用`);
});

/* ═══════════ 灵石产出（第二轮补全）═══════════ */

test('灵石：只在「首次掌握」与「攻克心魔」时发放（里程碑语义）', () => {
  const first = L.spiritValue({ tier: 'core', correctTimes: 0, everWrong: false });
  const conquer = L.spiritValue({ tier: 'core', correctTimes: 2, everWrong: true });
  const routine = L.spiritValue({ tier: 'core', correctTimes: 3, everWrong: false });
  assert.ok(first.amount > 0, '首次掌握应发灵石');
  assert.equal(first.reason, 'first');
  assert.ok(conquer.amount > 0, '攻克心魔应发灵石（即使不是首次）');
  assert.equal(conquer.reason, 'conquer');
  assert.equal(routine.amount, 0, '日常复习不发灵石（那是修为的职责）');
  assert.equal(routine.reason, 'routine');
});

test('灵石：**经济中性** —— 按真实词库分布期望值恰为 1.0', () => {
  // 这是本设计最关键的不变量：新增收入流不得膨胀总产出。
  // 用真实词库分布复算，若分布变化导致均值偏离 1，测试立刻失败。
  const grades = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'vocab-grades.json'), 'utf8'));
  const mult = L.expectedSpiritMultiplier(grades.counts);
  assert.ok(Math.abs(mult - 1) < 0.001,
    `期望产出倍数应为 1.0（实际 ${mult}）—— 否则灵石总量会通胀/紧缩`);
});

test('灵石：归一化权重按真实分布加权后均值 = 1（不依赖硬编码常数）', () => {
  // 用真实分布**重新算**均值，而不是相信 TIER_WEIGHT_MEAN 这个常数
  const grades = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'vocab-grades.json'), 'utf8'));
  const counts = grades.counts;
  let total = 0, weighted = 0;
  for (const [k, v] of Object.entries(counts)) {
    total += v;
    weighted += v * L.TIER_WEIGHT_NORM[k];
  }
  const mean = weighted / total;
  assert.ok(Math.abs(mean - 1) < 0.001,
    `归一化权重按真实分布加权应为 1（实际 ${mean}）—— 说明 TIER_WEIGHT_MEAN 与词库脱节了`);
  // TIER_WEIGHT_MEAN 必须等于真实加权均值
  const rawMean = Object.entries(counts).reduce((s, [k, v]) => s + v * L.TIER_WEIGHT[k], 0) / total;
  assert.ok(Math.abs(rawMean - L.TIER_WEIGHT_MEAN) < 0.001,
    `TIER_WEIGHT_MEAN 常量(${L.TIER_WEIGHT_MEAN}) 与真实分布算出的(${rawMean.toFixed(6)}) 不一致`);
});

test('灵石：难词给的灵石 ≥ 简单词（单调不减）', () => {
  const tiers = ['high', 'core', 'low', 'recognition'];
  const amounts = tiers.map((t) => L.spiritValue({ tier: t, correctTimes: 0 }).amount);
  for (let i = 1; i < amounts.length; i++) {
    assert.ok(amounts[i] >= amounts[i - 1],
      `${tiers[i]}(${amounts[i]}) 不应低于 ${tiers[i - 1]}(${amounts[i - 1]})`);
  }
  assert.ok(amounts[3] > amounts[0], '认知词应严格高于高频词');
});

test('灵石：攻克加成生效（心魔词收益更高）', () => {
  const plain = L.spiritValue({ tier: 'core', correctTimes: 0, everWrong: false }).amount;
  const conq = L.spiritValue({ tier: 'core', correctTimes: 0, everWrong: true }).amount;
  assert.ok(conq >= plain, '攻克心魔应不低于首次掌握');
});

test('灵石：脏输入安全降级（复习返回 0，不抛错）', () => {
  for (const bad of [null, undefined, {}, 'x', 42, [], { tier: 1, correctTimes: 'a' }]) {
    const r = L.spiritValue(bad);
    assert.ok(Number.isFinite(r.amount) && r.amount >= 0, `输入 ${JSON.stringify(bad)} 应返回 ≥0`);
    assert.ok(['first', 'conquer', 'routine'].includes(r.reason));
  }
});

test('灵石：纯函数，不修改入参', () => {
  const input = { tier: 'low', correctTimes: 0, everWrong: true };
  const snap = JSON.stringify(input);
  L.spiritValue(input);
  assert.equal(JSON.stringify(input), snap);
});

test('灵石：产出量与既有收入同量级（不喧宾夺主）', () => {
  // 每日 16 新词 → 期望约 16 × base；既有每日任务满额 135。
  // 新收入应明显低于任务，否则任务会被冷落。
  const perDay = 16 * L.SPIRIT_BASE_PER_MILESTONE;
  assert.ok(perDay > 0, '应有实在产出');
  assert.ok(perDay <= 100, `每日新增收入 ${perDay} 不应超过既有任务量级（135）`);
  assert.ok(L.SPIRIT_BASE_PER_MILESTONE >= 1, '基础值至少为 1');
});

/* ───────── 灵石接线 ───────── */

test('接线：settle 必须发放灵石（核心循环此前完全不给灵石）', () => {
  assert.ok(/const spiritGain=spiritGainFor\(/.test(html), 'settle 未计算灵石');
  assert.ok(/earnSpirit\(state,spGain/.test(html), 'settle 未把灵石入账（应走 economy.earnSpirit）');
  assert.ok(/word_milestone/.test(html), '灵石来源标签缺失（流水里应可辨识）');
});

test('接线：灵石必须在 known 自增 / wrong 删除**之前**结算', () => {
  // 顺序错了就读不到「本次之前」的掌握状态 → 里程碑判断全错
  const iGain = html.indexOf('const spiritGain=spiritGainFor(');
  const iKnown = html.indexOf('state.known[current.word]=(state.known[current.word]||0)+1', iGain);
  const iWrongDel = html.indexOf('delete state.wrong[current.word]', iGain);
  assert.ok(iGain > 0, '找不到灵石结算');
  assert.ok(iKnown > iGain, '灵石结算必须在 known 自增之前');
  assert.ok(iWrongDel > iGain, '灵石结算必须在 wrong 删除之前');
});

test('接线：灵石标签只在有产出时显示', () => {
  assert.ok(/spiritGain>0\?/.test(html), '应仅在有灵石时显示标签');
  assert.ok(/\.sp-tag\{/.test(html), '缺 .sp-tag 样式');
});
