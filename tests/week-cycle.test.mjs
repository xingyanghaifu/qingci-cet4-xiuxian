/**
 * 周天（修行周循环）—— 第十一轮新玩法
 *
 * ── 为什么做这个 ──
 * 现有机制的时间尺度是「单题」（连对/修为）、「当天」（每日功课）、
 * 「历史」（成就/境界），**缺少「一周」这个中间尺度**。
 * 修仙叙事里「周天」正是一个完整循环；学习上「本周 vs 上周」也是最自然的自省节奏。
 *
 * 数据完全来自既有 `state.days`，**不新增任何存档字段**。
 *
 * ── 三条克制（测试逐条守） ──
 *   1. **不发新货币、不改数值平衡** —— 只呈现与对照，不给奖励
 *      （奖励会动经济平衡，而平衡需人工确认；且每日功课已承担发奖职能）
 *   2. **不制造焦虑** —— 未圆满不批评；上周无数据时**不显示「退步」**
 *   3. **不侵入学习** —— 纯只读推导，不写存档
 *
 * ── 重点测「周边界」──
 * 这类按周聚合的逻辑最容易错在**周日**：JS 的 `getDay()` 里 0=周日，
 * 若直接 `getDate() - (dow-1)`，周日会算成「下周一」，整周错位。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTs } from './helpers/load-ts.mjs';

const ROOT = join(import.meta.dirname, '..');
const W = await loadTs('src/services/week-cycle.ts');
const html = readFileSync(join(ROOT, 'src', 'index.template.html'), 'utf8');

/** 造本地 Date（避免 UTC 解析导致时区偏移） */
const d = (y, m, day) => new Date(y, m - 1, day, 12, 0, 0);

/* ───────── 一、周边界（最容易错的地方） ───────── */

test('startOfWeek：周一~周日都归到同一周的周一', () => {
  // 2026-10-05 是周一 … 2026-10-11 是周日
  const monday = W.dateKey(W.startOfWeek(d(2026, 10, 5)));
  assert.equal(monday, '2026-10-05', '周一 → 自己');
  assert.equal(W.dateKey(W.startOfWeek(d(2026, 10, 6))), '2026-10-05', '周二');
  assert.equal(W.dateKey(W.startOfWeek(d(2026, 10, 7))), '2026-10-05', '周三');
  assert.equal(W.dateKey(W.startOfWeek(d(2026, 10, 8))), '2026-10-05', '周四');
  assert.equal(W.dateKey(W.startOfWeek(d(2026, 10, 9))), '2026-10-05', '周五');
  assert.equal(W.dateKey(W.startOfWeek(d(2026, 10, 10))), '2026-10-05', '周六');
  assert.equal(W.dateKey(W.startOfWeek(d(2026, 10, 11))), '2026-10-05', '周日 ← 最容易算错的一天');
});

test('startOfWeek：周日不应被算成「下周一」', () => {
  // 这是本模块最关键的边界：JS getDay() 周日=0，若按 dow-1 回退会变成 +6 前进
  const sunday = d(2026, 10, 11);
  assert.equal(sunday.getDay(), 0, '前提：这天确实是周日');
  const start = W.startOfWeek(sunday);
  assert.equal(start.getDay(), 1, '结果必须是周一');
  assert.ok(start.getTime() < sunday.getTime(), '周一起点必须早于周日（不能跑到下周）');
});

test('startOfWeek：跨月与跨年正确', () => {
  // 2026-11-01 是周日 → 本周一为 2026-10-26
  assert.equal(W.dateKey(W.startOfWeek(d(2026, 11, 1))), '2026-10-26', '跨月');
  // 2027-01-01 是周五 → 本周一为 2026-12-28
  assert.equal(W.dateKey(W.startOfWeek(d(2027, 1, 1))), '2026-12-28', '跨年');
});

test('startOfWeek：入参为时间戳或 Date 都可，且归一化到 0 点', () => {
  const t = d(2026, 10, 8).getTime();
  assert.equal(W.dateKey(W.startOfWeek(t)), '2026-10-05');
  const s = W.startOfWeek(d(2026, 10, 8));
  assert.equal(s.getHours(), 0);
  assert.equal(s.getMinutes(), 0);
  assert.equal(s.getSeconds(), 0);
});

test('dateKey：用本地时区（不能出现 UTC 偏移导致差一天）', () => {
  // 本地 2026-10-05 00:30 —— 若用 toISOString() 在东八区会变成 10-04
  const early = new Date(2026, 9, 5, 0, 30, 0);
  assert.equal(W.dateKey(early), '2026-10-05', '本地凌晨不应被 UTC 偏移拉回前一天');
});

/* ───────── 二、周汇总 ───────── */

test('summary：统计 7 天、修行天数、正确率', () => {
  const days = {
    '2026-10-05': { right: 10, wrong: 2 },
    '2026-10-07': { right: 5, wrong: 5 },
    '2026-10-11': { right: 3, wrong: 0 },
  };
  const s = W.summarizeWeek(days, d(2026, 10, 8));
  assert.equal(s.days.length, 7);
  assert.equal(s.activeDays, 3);
  assert.equal(s.right, 18);
  assert.equal(s.wrong, 7);
  assert.equal(s.total, 25);
  assert.ok(Math.abs(s.accuracy - 18 / 25) < 1e-9);
});

test('summary：只统计本周（上周的数据不串进来）', () => {
  const days = {
    '2026-09-28': { right: 99, wrong: 0 },   // 上周
    '2026-10-05': { right: 1, wrong: 0 },    // 本周
    '2026-10-12': { right: 88, wrong: 0 },   // 下周
  };
  const s = W.summarizeWeek(days, d(2026, 10, 8));
  assert.equal(s.right, 1, `只应统计本周（实际 ${s.right}）`);
  assert.equal(s.activeDays, 1);
});

test('summary：无作答的天不算修行日', () => {
  const days = { '2026-10-05': { right: 0, wrong: 0 }, '2026-10-06': { right: 1, wrong: 0 } };
  const s = W.summarizeWeek(days, d(2026, 10, 8));
  assert.equal(s.activeDays, 1, 'right+wrong=0 的一天不算修行日');
});

test('summary：圆满判定留出休息余量（5/7 天即可，不要求全勤）', () => {
  const mk = (n) => {
    const days = {};
    for (let i = 0; i < n; i++) {
      const day = String(5 + i).padStart(2, '0');
      days[`2026-10-${day}`] = { right: 3, wrong: 0 };
    }
    return days;
  };
  assert.equal(W.summarizeWeek(mk(4), d(2026, 10, 8)).full, false, '4 天未圆满');
  assert.equal(W.summarizeWeek(mk(5), d(2026, 10, 8)).full, true, '5 天圆满');
  assert.equal(W.summarizeWeek(mk(5), d(2026, 10, 8)).daysToFull, 0);
  assert.equal(W.summarizeWeek(mk(3), d(2026, 10, 8)).daysToFull, 2);
  assert.ok(W.FULL_DAYS < 7, '不应要求 7 天全勤（会鼓励无效刷时长）');
});

test('summary：每个格子带正确的 weekday 与日期键（周一起）', () => {
  const s = W.summarizeWeek({}, d(2026, 10, 8));
  assert.deepEqual(s.days.map((x) => x.key), [
    '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08',
    '2026-10-09', '2026-10-10', '2026-10-11',
  ]);
  assert.deepEqual(s.days.map((x) => x.weekday), [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(W.WEEKDAY_LABELS.length, 7);
  assert.equal(W.WEEKDAY_LABELS[0], '一', '标签应从「一」开始');
});

/* ───────── 三、两周对照 ───────── */

test('compare：算出本周与上周的差值', () => {
  const days = {
    '2026-09-28': { right: 10, wrong: 0 },   // 上周一
    '2026-10-05': { right: 20, wrong: 0 },   // 本周一
  };
  const c = W.compareWeeks(days, d(2026, 10, 8));
  assert.equal(c.lastWeek.right, 10);
  assert.equal(c.thisWeek.right, 20);
  assert.equal(c.totalDelta, 10);
  assert.ok(/多 10 题/.test(c.trend), `趋势应说明增加：${c.trend}`);
});

test('compare：上周无数据时**不显示退步**（不制造焦虑）', () => {
  const days = { '2026-10-05': { right: 5, wrong: 0 } };
  const c = W.compareWeeks(days, d(2026, 10, 8));
  assert.equal(c.lastWeekEmpty, true);
  assert.equal(c.accuracyDelta, null, '上周无作答时正确率变化应为 null（而非负数）');
  assert.ok(!/少|退步|下降/.test(c.trend), `不应出现退步措辞：${c.trend}`);
  assert.ok(/第一周/.test(c.trend), `应如实说明：${c.trend}`);
});

test('compare：全新用户（两周都空）不产生负面文案', () => {
  const c = W.compareWeeks({}, d(2026, 10, 8));
  assert.equal(c.lastWeekEmpty, true);
  assert.ok(!/少|退步|下降/.test(c.trend), `文案应中性：${c.trend}`);
});

test('compare：正确率变化按百分点计算（两周样本都够时）', () => {
  const days = {
    // 上周 50 题：25 对 25 错（50%）
    ...Object.fromEntries(['2026-09-28','2026-09-29','2026-09-30'].map((k) => [k, { right: 25, wrong: 25 }])),
    // 本周 50 题：40 对 10 错（80%）
    '2026-10-05': { right: 40, wrong: 10 },
  };
  const c = W.compareWeeks(days, d(2026, 10, 8));
  assert.ok(c.thisWeek.total >= W.MIN_ACCURACY_SAMPLES && c.lastWeek.total >= W.MIN_ACCURACY_SAMPLES,
    '前提：两周样本都达标');
  assert.equal(c.accuracyDelta, 30, `应为 +30 个百分点（实际 ${c.accuracyDelta}）`);
  assert.equal(c.accuracySkipReason, null);
});

test('compare：样本不足时**不给正确率数字**（避免小样本误导）', () => {
  // 真实踩到的场景：上周 3 天共 12 题全对(100%)、本周 40 题 75%
  // 直接对比会显示「-25 个百分点」，看起来像明显退步，但题量差 3 倍，毫无意义
  const days = {
    '2026-09-28': { right: 4, wrong: 0 },
    '2026-09-29': { right: 4, wrong: 0 },
    '2026-09-30': { right: 4, wrong: 0 },
    '2026-10-05': { right: 30, wrong: 10 },
  };
  const c = W.compareWeeks(days, d(2026, 10, 8));
  assert.equal(c.accuracyDelta, null, '样本不足时不应给出正确率差值');
  assert.equal(c.accuracySkipReason, 'too-few-samples');
  const note = W.accuracyNote(c);
  assert.ok(/不足/.test(note), `应如实说明样本不足：${note}`);
  assert.ok(!/-\d/.test(note), `不应出现负数差值：${note}`);
});

test('compare：上周无作答时标记为 no-last-week', () => {
  const c = W.compareWeeks({ '2026-10-05': { right: 30, wrong: 0 } }, d(2026, 10, 8));
  assert.equal(c.accuracyDelta, null);
  assert.equal(c.accuracySkipReason, 'no-last-week');
  assert.equal(W.accuracyNote(c), '', '无上周数据时不必额外说明');
});

test('accuracyNote：可用时输出带符号的百分点', () => {
  const days = {
    '2026-09-28': { right: 25, wrong: 25 },
    '2026-10-05': { right: 40, wrong: 10 },
  };
  const note = W.accuracyNote(W.compareWeeks(days, d(2026, 10, 8)));
  assert.ok(/\+30 个百分点/.test(note), `应含 +30：${note}`);
});

test('阈值：MIN_ACCURACY_SAMPLES 合理（>0 且不过高）', () => {
  assert.ok(W.MIN_ACCURACY_SAMPLES > 0 && W.MIN_ACCURACY_SAMPLES <= 100,
    `样本门槛应在合理范围（实际 ${W.MIN_ACCURACY_SAMPLES}）`);
});

test('compare：题量持平时文案中性', () => {
  const days = {
    '2026-09-28': { right: 5, wrong: 0 },
    '2026-10-05': { right: 5, wrong: 0 },
  };
  assert.ok(/持平/.test(W.compareWeeks(days, d(2026, 10, 8)).trend));
});

/* ───────── 四、文案 ───────── */

test('标题：圆满给正反馈，未圆满只说进度（不批评）', () => {
  const full = W.summarizeWeek({ '2026-10-05': { right: 1 }, '2026-10-06': { right: 1 }, '2026-10-07': { right: 1 }, '2026-10-08': { right: 1 }, '2026-10-09': { right: 1 } }, d(2026, 10, 8));
  assert.ok(/圆满/.test(W.weekTitle(full)));
  const none = W.summarizeWeek({}, d(2026, 10, 8));
  assert.ok(!/差|失败|不足|糟糕/.test(W.weekTitle(none)), `未启不应有负面词：${W.weekTitle(none)}`);
  assert.ok(/未启/.test(W.weekTitle(none)));
});

test('文案：所有状态都不含批评性词汇', () => {
  const SCARY = /差|失败|糟糕|退步|落后|不合格|必须/;
  const cases = [
    W.summarizeWeek({}, d(2026, 10, 8)),
    W.summarizeWeek({ '2026-10-05': { right: 1 } }, d(2026, 10, 8)),
  ];
  for (const s of cases) {
    assert.ok(!SCARY.test(W.weekTitle(s)), `标题含负面词：${W.weekTitle(s)}`);
    assert.ok(!SCARY.test(W.weekMessage(s)), `说明含负面词：${W.weekMessage(s)}`);
  }
});

test('文案：说明里给出「再几天圆满」的具体数字', () => {
  const s = W.summarizeWeek({ '2026-10-05': { right: 1 }, '2026-10-06': { right: 1 } }, d(2026, 10, 8));
  const msg = W.weekMessage(s);
  assert.ok(new RegExp(String(s.daysToFull)).test(msg), `应含还差天数：${msg}`);
});

/* ───────── 五、稳健性与纯函数 ───────── */

test('脏数据安全降级，不抛错', () => {
  for (const bad of [null, undefined, {}, 'x', 42, [], { '2026-10-05': null }, { '2026-10-05': 'nope' }]) {
    const s = W.summarizeWeek(bad, d(2026, 10, 8));
    assert.equal(s.days.length, 7);
    assert.ok(Number.isFinite(s.accuracy));
    assert.ok(s.activeDays >= 0 && s.activeDays <= 7);
    const c = W.compareWeeks(bad, d(2026, 10, 8));
    assert.ok(Number.isFinite(c.totalDelta));
    assert.ok(typeof c.trend === 'string' && c.trend.length > 0);
  }
});

test('防御：负数 / 非数字一律按 0 计', () => {
  const s = W.summarizeWeek({ '2026-10-05': { right: -5, wrong: 'x' } }, d(2026, 10, 8));
  assert.equal(s.right, 0);
  assert.equal(s.wrong, 0);
  assert.equal(s.activeDays, 0);
});

test('纯函数：不修改入参', () => {
  const days = { '2026-10-05': { right: 5, wrong: 1 } };
  const snap = JSON.stringify(days);
  W.summarizeWeek(days, d(2026, 10, 8));
  W.compareWeeks(days, d(2026, 10, 8));
  W.weekTitle(W.summarizeWeek(days, d(2026, 10, 8)));
  assert.equal(JSON.stringify(days), snap);
});

/* ───────── 六、克制：不发奖、不写档 ───────── */

test('克制：本模块不发放任何货币/修为（避免改动经济平衡）', () => {
  const src = readFileSync(join(ROOT, 'src', 'services', 'week-cycle.ts'), 'utf8');
  for (const bad of ['earnSpirit', 'spirit', 'qi', 'reward', 'grantItem']) {
    assert.ok(!new RegExp(`\\b${bad}\\b`).test(src.replace(/\/\*[\s\S]*?\*\//g, '')),
      `week-cycle.ts 不应涉及 ${bad} —— 周天只做呈现与对照，不发奖励`);
  }
});

test('克制：本模块不写存档（纯只读推导）', () => {
  const src = readFileSync(join(ROOT, 'src', 'services', 'week-cycle.ts'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/localStorage|setItem|save\(/.test(code), 'week-cycle.ts 不应写存档');
});

test('接线：模板必须真的展示周天（不能只实现判定）', () => {
  assert.ok(/week\.summary|week\.compare|S\.week/.test(html),
    '模板未使用 week 服务 —— 周天机制没有消费点');
  assert.ok(/id="weekCard"/.test(html), '缺周天容器 #weekCard');
});
