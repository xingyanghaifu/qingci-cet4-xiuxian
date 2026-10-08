/**
 * 灵石流水账本（阶段 A2 补全）
 *
 * ── 这份测试在防什么 ──
 * `economy.ts` 的流水是 append-only + `balanceAfter` 链式设计，
 * 模块注释写着「`listRecentTransactions` 可回放校验」，
 * `tests/economy.test.mjs` 有 6 处断言在测它 —— 但**模板从未展示过它**
 * （全模板 grep `listRecentTransactions` 0 次）。
 *
 * 玩家每天赚灵石/花灵石（背词、任务、斗法、渡劫、奇遇、收获、传功、
 * 道场捐献、商店购买），却没有任何地方能看到灵石怎么来的、怎么没的。
 *
 * 这是本项目「实现了、测了、导出了，但没有消费点」的**第六次**出现。
 * 所以本测试既断言纯函数行为，也断言「模板确实展示账本」这条接线事实。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTs } from './helpers/load-ts.mjs';

const ROOT = join(import.meta.dirname, '..');
const L = await loadTs('src/services/ledger.ts');

/* ───────── 一、reason 翻译 ───────── */

test('reason 翻译：常见收入/支出代码都有中文标签', () => {
  assert.equal(L.reasonLabel('daily_words'), '每日背词');
  assert.equal(L.reasonLabel('duel_win'), '斗法胜出');
  assert.equal(L.reasonLabel('duel_tie'), '斗法平局');
  assert.equal(L.reasonLabel('tribulation_win'), '渡劫成功');
  assert.equal(L.reasonLabel('demon_raid_success'), '心魔劫');
  assert.equal(L.reasonLabel('encounter_qi_rain'), '奇遇 · 灵石雨');
  assert.equal(L.reasonLabel('transmission_sent'), '传功');
  assert.equal(L.reasonLabel('sect_donate'), '道场捐献');
  assert.equal(L.reasonLabel('joint_demon_win'), '联手斩魔');
});

test('reason 翻译：带前缀的 reason 解析出「动作 · 名称」', () => {
  assert.equal(L.reasonLabel('purchase_array'), '购买 · 聚灵阵');
  assert.equal(L.reasonLabel('purchase_talisman'), '购买 · 护道符');
  assert.equal(L.reasonLabel('purchase_pill'), '购买 · 记忆丹');
  assert.equal(L.reasonLabel('purchase_book'), '购买 · 参悟古籍');
  assert.equal(L.reasonLabel('refund_array'), '退款 · 聚灵阵');
  assert.equal(L.reasonLabel('harvest_qi_grass'), '灵田收获 · 灵石草');
  assert.equal(L.reasonLabel('harvest_enlighten_tree'), '灵田收获 · 悟道树');
});

test('reason 翻译：未知代码不吞掉（原样可读，便于发现问题）', () => {
  // 不显示「未知」——那会掩盖真实问题；改成间隔号让可读性稍好
  assert.equal(L.reasonLabel('totally_unknown_code'), 'totally · unknown · code');
  assert.equal(L.reasonLabel('some_new_thing'), 'some · new · thing');
  assert.equal(L.reasonLabel(''), '灵石变动');
  assert.equal(L.reasonLabel(null), '灵石变动');
  assert.equal(L.reasonLabel(undefined), '灵石变动');
});

test('reason 翻译：前缀命中但子名未知 → 只给动作名（不显示空名）', () => {
  assert.equal(L.reasonLabel('purchase_mystery'), '购买');
  assert.equal(L.reasonLabel('harvest_mystery'), '灵田收获');
});

/* ───────── 二、方向与描述 ───────── */

test('方向判定：正=收入 / 负=支出 / 0=无变动', () => {
  assert.equal(L.txDirection(50), 'in');
  assert.equal(L.txDirection(-50), 'out');
  assert.equal(L.txDirection(0), 'flat');
  assert.equal(L.txDirection(NaN), 'flat');
  assert.equal(L.txDirection(undefined), 'flat');
});

test('描述：含带符号金额、中文标签与余额', () => {
  assert.equal(
    L.describeTransaction({ amount: 50, reason: 'duel_win', balanceAfter: 120 }),
    '+50 灵石 · 斗法胜出 · 余额 120',
  );
  assert.equal(
    L.describeTransaction({ amount: -100, reason: 'purchase_array', balanceAfter: 20 }),
    '-100 灵石 · 购买 · 聚灵阵 · 余额 20',
  );
});

test('描述：缺余额时不显示「余额 undefined」', () => {
  const s = L.describeTransaction({ amount: 30, reason: 'daily_words' });
  assert.ok(!/undefined|NaN/.test(s), `描述含非法值：${s}`);
  assert.equal(s, '+30 灵石 · 每日背词');
  assert.equal(L.describeTransaction(null), '');
});

test('时间格式：本地 MM-DD HH:mm；非法时间返回空串', () => {
  const t = new Date(2026, 9, 8, 14, 5).getTime();   // 本地 2026-10-08 14:05
  assert.equal(L.txTimeLabel(new Date(t).toISOString()), '10-08 14:05');
  assert.equal(L.txTimeLabel('not-a-date'), '');
  assert.equal(L.txTimeLabel(null), '');
  assert.equal(L.txTimeLabel(undefined), '');
});

/* ───────── 三、汇总 ───────── */

test('汇总：收入/支出/净额/笔数', () => {
  const s = L.summarizeTransactions([
    { amount: 50, reason: 'duel_win' },
    { amount: 30, reason: 'daily_words' },
    { amount: -100, reason: 'purchase_array' },
    { amount: -40, reason: 'sect_donate' },
  ]);
  assert.equal(s.income, 80);
  assert.equal(s.spent, 140);
  assert.equal(s.net, -60);
  assert.equal(s.count, 4);
});

test('汇总：按标签聚合，净额绝对值降序', () => {
  const s = L.summarizeTransactions([
    { amount: 50, reason: 'duel_win' },
    { amount: 50, reason: 'duel_win' },
    { amount: -140, reason: 'purchase_array' },
    { amount: -10, reason: 'sect_donate' },
  ]);
  // |−140| > |100| > |−10|
  assert.equal(s.byLabel[0].label, '购买 · 聚灵阵');
  assert.equal(s.byLabel[0].net, -140);
  assert.equal(s.byLabel[0].count, 1);
  assert.equal(s.byLabel[1].label, '斗法胜出');
  assert.equal(s.byLabel[1].net, 100);
  assert.equal(s.byLabel[1].count, 2);
  assert.equal(s.byLabel[2].label, '道场捐献');
  assert.equal(s.byLabel[2].net, -10);
});

test('汇总：净额绝对值相同时按标签稳定排序（不依赖插入顺序）', () => {
  const a = L.summarizeTransactions([
    { amount: 100, reason: 'duel_win' },
    { amount: -100, reason: 'purchase_array' },
  ]);
  const b = L.summarizeTransactions([
    { amount: -100, reason: 'purchase_array' },
    { amount: 100, reason: 'duel_win' },
  ]);
  assert.deepEqual(a.byLabel.map((x) => x.label), b.byLabel.map((x) => x.label),
    '同样输入不同顺序应产出相同排序（否则 UI 每次刷新会跳动）');
});

test('汇总：空输入 / 非法输入返回全 0，不抛错', () => {
  for (const bad of [[], null, undefined, 'nope', 42]) {
    const s = L.summarizeTransactions(bad);
    assert.equal(s.income, 0);
    assert.equal(s.spent, 0);
    assert.equal(s.net, 0);
    assert.equal(s.count, 0);
    assert.deepEqual(s.byLabel, []);
  }
});

test('汇总：纯函数，不修改入参', () => {
  const input = [{ amount: 10, reason: 'daily_words' }];
  const snap = JSON.stringify(input);
  L.summarizeTransactions(input);
  assert.equal(JSON.stringify(input), snap);
});

test('空账本判定', () => {
  assert.equal(L.isEmptyLedger([]), true);
  assert.equal(L.isEmptyLedger(null), true);
  assert.equal(L.isEmptyLedger(undefined), true);
  assert.equal(L.isEmptyLedger([{ amount: 1 }]), false);
});

/* ───────── 四、接线契约（防「实现了但没人调用」） ───────── */

test('接线：模板必须展示流水账本（消费 listRecentTransactions）', () => {
  const html = readFileSync(join(ROOT, 'src', 'index.template.html'), 'utf8');
  assert.ok(/listRecentTransactions/.test(html),
    '模板未调用 listRecentTransactions —— 账本能力成为死代码，玩家看不到灵石去向');
  assert.ok(/S\.ledger|ledger\.describe|ledger\.label/.test(html),
    '模板未使用 ledger 服务做中文翻译/描述');
});

test('接线：账本 UI 容器存在', () => {
  const html = readFileSync(join(ROOT, 'src', 'index.template.html'), 'utf8');
  assert.ok(/id="ledgerList"/.test(html), '缺账本列表容器 #ledgerList');
});

test('一致性：reason 标签覆盖模板里实际用到的所有 reason 代码', () => {
  const html = readFileSync(join(ROOT, 'src', 'index.template.html'), 'utf8');
  const used = new Set();
  for (const m of html.matchAll(/(?:earnSpirit|spendSpirit)\([^)]*?'([a-z_]+)'/g)) used.add(m[1]);
  assert.ok(used.size >= 5, `模板里 reason 代码过少（${used.size}），检查正则是否失配`);
  const missing = [...used].filter((r) => {
    const label = L.reasonLabel(r);
    // 未知代码会被替换成「 · 」形式；已知的不会
    return label === r.replace(/_/g, ' · ') && !L.REASONS[r];
  });
  assert.deepEqual(missing, [], `以下 reason 代码缺中文标签：${missing.join(', ')}`);
});
