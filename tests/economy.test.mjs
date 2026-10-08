/**
 * 灵石经济测试（阶段 A2 · economy.ts + 模板挂点）
 *
 * 覆盖：spend/earn 判定与流水、余额不足不记账、balanceAfter 链式校验、
 *       倒序查询与 limit、目录防御，以及模板侧 4 类挂点的静态接线。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTs } from './helpers/load-ts.mjs';
import { makeFakeIdb } from './helpers/fake-idb.mjs';

const eco = await loadTs('src/services/economy.ts');
const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.template.html'), 'utf8');
const svcTs = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'services', 'index.ts'), 'utf8');

const tick = () => new Promise((r) => setTimeout(r, 5));

test('spendSpirit：成功扣减 + 流水落库（负数金额=支出）', async () => {
  const idb = makeFakeIdb();
  const state = { spirit: 1000 };
  const r = eco.spendSpirit(state, 150, 'purchase_talisman', idb);
  assert.deepStrictEqual(r, { ok: true, balanceAfter: 850 });
  assert.strictEqual(state.spirit, 850, 'state 引用同步变更');
  await tick();
  const txs = await eco.listRecentTransactions(10, idb);
  assert.strictEqual(txs.length, 1);
  assert.strictEqual(txs[0].amount, -150, '支出为负');
  assert.strictEqual(txs[0].reason, 'purchase_talisman');
  assert.strictEqual(txs[0].balanceAfter, 850);
  assert.ok(txs[0].timestamp, '须有 ISO 时间戳');
});

test('spendSpirit：余额不足 / 非法金额 → ok:false 且不写流水', async () => {
  const idb = makeFakeIdb();
  const state = { spirit: 100 };
  assert.strictEqual(eco.spendSpirit(state, 150, 'purchase_talisman', idb).ok, false);
  assert.strictEqual(eco.spendSpirit(state, 0, 'x', idb).ok, false, '0 元视为非法');
  assert.strictEqual(eco.spendSpirit(state, -5, 'x', idb).ok, false, '负数视为非法');
  assert.strictEqual(state.spirit, 100, '余额不得变动');
  await tick();
  assert.strictEqual((await eco.listRecentTransactions(10, idb)).length, 0, '失败不得产生流水');
});

test('earnSpirit：入账 + 流水；0 元不记账', async () => {
  const idb = makeFakeIdb();
  const state = { spirit: 0 };
  assert.deepStrictEqual(eco.earnSpirit(state, 1000, 'daily_words', idb), { balanceAfter: 1000 });
  eco.earnSpirit(state, 0, 'noop', idb);
  await tick();
  const txs = await eco.listRecentTransactions(10, idb);
  assert.strictEqual(txs.length, 1, '0 元不应产生流水');
  assert.strictEqual(txs[0].amount, 1000);
  assert.strictEqual(eco.getBalance(state), 1000);
  assert.strictEqual(eco.getBalance({}), 0, '脏状态兜底');
});

test('流水链：balanceAfter 校验 + 倒序 + limit', async () => {
  const idb = makeFakeIdb();
  const state = { spirit: 0 };
  eco.earnSpirit(state, 1000, 'daily_words', idb);   // 1000
  eco.spendSpirit(state, 150, 'purchase_array', idb); // 850
  eco.earnSpirit(state, 30, 'duel_win', idb);         // 880
  eco.spendSpirit(state, 9999, 'purchase_book', idb); // 失败不入账
  await tick();
  const all = await eco.listRecentTransactions(10, idb);
  assert.strictEqual(all.length, 3, '失败的支出不入流水');
  // 新→旧
  assert.deepStrictEqual(all.map((t) => t.balanceAfter), [880, 850, 1000]);
  assert.deepStrictEqual(all.map((t) => t.amount), [30, -150, 1000]);
  // 链式：每条的 balanceAfter 与「按时间正序回放」一致
  const asc = [...all].reverse();
  let bal = 0;
  for (const t of asc) { bal += t.amount; assert.strictEqual(t.balanceAfter, bal, 'balanceAfter 必须与回放一致'); }
  const limited = await eco.listRecentTransactions(1, idb);
  assert.strictEqual(limited.length, 1);
  assert.strictEqual(limited[0].balanceAfter, 880, 'limit 取最新一条');
});

test('目录与未知道具防御', () => {
  assert.strictEqual(eco.priceOf('talisman'), 150);
  assert.strictEqual(eco.priceOf('array'), 100);
  assert.strictEqual(eco.priceOf('pill'), 80);
  assert.strictEqual(eco.priceOf('book'), 50);
  assert.strictEqual(eco.priceOf('banana'), null);
  assert.strictEqual(eco.ITEM_CATALOG.length, 4, '新道具目录恰好 4 件');
  assert.strictEqual(eco.ARRAY_DURATION_MS, 24 * 3600 * 1000, '聚灵阵 24h');
  assert.strictEqual(eco.PILL_DURATION_MS, 7 * 24 * 3600 * 1000, '记忆丹 7 天');
});

test('purchase：未知道具 ok:false 不扣钱', async () => {
  const idb = makeFakeIdb();
  const state = { spirit: 500 };
  const res = await eco.purchase(state, 'banana', {}, idb);
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.reason, 'unknown-item');
  assert.strictEqual(state.spirit, 500, '未知道具不得扣钱');
  await tick();
  assert.strictEqual((await eco.listRecentTransactions(10, idb)).length, 0);
});

/* ─── v1.10：priceOverride（道场藏经阁折扣用；加性参数，不传则行为不变）─── */

test('purchase：不传 priceOverride 时按目录价（既有行为一字不变）', async () => {
  const idb = makeFakeIdb();
  const state = { spirit: 500 };
  const res = await eco.purchase(state, 'book', { targetId: 'abandon' }, idb);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(state.spirit, 450, 'book 目录价 50');
  await tick();
  const txs = await eco.listRecentTransactions(10, idb);
  assert.ok(txs.some((t) => t.amount === -50), '流水应为 -50');
});

test('purchase：priceOverride 生效（参悟古籍 50 → 40）', async () => {
  const idb = makeFakeIdb();
  const state = { spirit: 500 };
  const res = await eco.purchase(state, 'book', { targetId: 'ability', priceOverride: 40 }, idb);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(state.spirit, 460, '应按覆盖价 40 扣费');
  await tick();
  const txs = await eco.listRecentTransactions(10, idb);
  assert.ok(txs.some((t) => t.amount === -40), '流水应为 -40');
});

test('purchase：priceOverride 只接受「有限正数且不高于目录价」', async () => {
  const idb = makeFakeIdb();
  // 高于目录价 → 回落目录价（防被用来加价）
  const s1 = { spirit: 500 };
  await eco.purchase(s1, 'book', { targetId: 'w1', priceOverride: 999 }, idb);
  assert.strictEqual(s1.spirit, 450, '高于目录价应回落目录价');
  // 非法值 → 回落目录价
  for (const bad of [0, -5, NaN, Infinity, undefined]) {
    const s = { spirit: 500 };
    await eco.purchase(s, 'book', { targetId: 'w' + String(bad), priceOverride: bad }, idb);
    assert.strictEqual(s.spirit, 450, `非法覆盖价 ${String(bad)} 应回落目录价`);
  }
});

test('purchase：库存写失败时按**实付价**退款（不产生净额偏差）', async () => {
  // 用一个会让 inventory 写入失败的假 idb：读得到、put 抛错
  const idb = makeFakeIdb();
  const broken = {
    transaction: () => { throw new Error('boom'); },
  };
  const state = { spirit: 500 };
  const res = await eco.purchase(state, 'book', { targetId: 'w2', priceOverride: 40 }, broken);
  assert.strictEqual(res.ok, false, '写库失败应返回失败');
  assert.strictEqual(state.spirit, 500, '应退回实付价 40，余额回到 500（若退目录价 50 会变成 510）');
});

/* ─────────────── 模板挂点静态接线（验收 7/8/10/11/12 对应） ─────────────── */

test('挂点1：claimMission 聚灵阵双倍（幂等保护原样）+ 流水', () => {
  assert.ok(html.includes("state.claimed[m.id]===dayKey()) return;"), 'claimed 幂等保护必须原样');
  assert.ok(html.includes("m.id==='q'&&ESm&&ESm.arrayActive()"), '仅每日背词任务 ×2');
  // 第一期：奖励入账仍走经济流水，但 reason 区分是否暴击（便于流水回放分析）
  assert.ok(/ESm\.earnSpirit\(state,gain,crit\?'daily_words_crit':'daily_words'\)/.test(html),
    '奖励须走经济流水（暴击与非暴击分别记流水）');
  // 双倍提示：文案由「聚灵阵 / 暴击」拼出，所以断言两段而不是整串字面量
  assert.ok(html.includes("'（'+(crit?'暴击':'聚灵阵')+'双倍）'"), '双倍须可见提示（区分暴击与聚灵阵）');
});

test('挂点2：buyItem 迁移到 spend/earn（旧 3 道具行为不变）', () => {
  assert.ok(html.includes("ESc.spendSpirit(state,costs[item],'purchase_'+item)"), '扣款走流水');
  assert.ok(html.includes("paid?!paid.ok:((state.spirit||0)<costs[item])"), '余额不足判定保留（ES 缺失时回退旧判定）');
  assert.ok(html.includes("'灵石不足，先完成今日修炼'"), '旧 3 道具文案不变');
  assert.ok(html.includes("ESc.earnSpirit(state,costs[item],'refund_'+item)"), '退款也走流水');
});

test('挂点3：斗法胜利 + 渡劫奖励走流水，护道符判定与消耗闭环', () => {
  assert.ok(html.includes("ESd.earnSpirit(state,30,'duel_win')"), '斗法胜场入账');
  assert.ok(html.includes("S.economy.earnSpirit(state, T.REWARD, 'tribulation_win')"), '渡劫奖励入账');
  assert.ok(html.includes('S.economy.talismanCount() > 0'), '扣罚前按库存判定护道符');
  assert.ok(html.includes('S.economy.consumeTalisman()'), '抵扣后消耗一张');
  assert.ok(html.includes("qingci:inventory-changed"), '库存变化广播（境界卡联动）');
});

test('挂点4：记忆丹队列 skip（可选入参默认空，语义不变）', () => {
  assert.ok(html.includes('function collectQueue(mode, plan, skipWords)'), '可选 skip 入参');
  assert.ok(html.includes('if (skip[r.w]) return;'), '复习分支按 skip 过滤');
  assert.ok(html.includes("collectQueue(mode, plan, (S.economy && S.economy.activePillWords)"), '调用方传入生效中的药词');
  assert.ok(html.includes("(skipWords||[]).forEach"), '默认空 → 行为与原版一致');
});

test('挂点5：参悟古籍深度解析（解锁才渲染，enrich 深化）', () => {
  assert.ok(html.includes('S.economy.bookUnlocked(word)'), '解锁判定');
  assert.ok(html.includes("sec('深度解析 · 参悟古籍'"), '区块标题');
  assert.ok(html.includes('S.vocab.enrich(deepEntry, getLexicon()'), '基于既有 enrichment');
  assert.ok(html.includes('if (deepHtml) html += sec('), '空内容不渲染（无占位）');
});

test('挂点6：商店混排 7 项 + renderShop 尾钩 + 服务出口', () => {
  const staticHtml = html.replace(/<script[\s\S]*?<\/script>/g, '');
  const oldCount = (staticHtml.match(/data-item="/g) || []).length;
  const newCount = (staticHtml.match(/data-buy="/g) || []).length;
  assert.strictEqual(oldCount, 3, '旧 3 道具原样保留');
  assert.strictEqual(newCount, 4, '新 4 道具混排');
  assert.ok(html.includes('window.__renderShopExtras'), 'renderShop 尾钩');
  assert.ok(html.includes('id="shopPickOverlay"') && html.includes('id="shopPickOk"'), '选词器浮层在位');
  assert.ok(svcTs.includes('  economy: {'), 'services 出口注册 economy');
});

test('挂点7：门遍历修复与选词器入会话门族', () => {
  assert.ok(html.split("document.querySelectorAll('.trib-session')").length - 1 >= 2, '门遍历全部会话元素');
  assert.ok(/class="overlay trib-session hidden" id="shopPickOverlay"/.test(html), '选词器携带 trib-session（期间全局让位）');
  assert.ok(html.includes('pickInput.focus()'), '选词器焦点入输入框（inEditable 保护数字键）');
});
