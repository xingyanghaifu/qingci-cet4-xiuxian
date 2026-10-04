/**
 * 灵田 + 洞府装饰测试（阶段 C）
 *
 * 覆盖验收 1-20 的逻辑面：种植 / 浇水去重 / 成熟阈值（含灵泉）/ 收获奖励 /
 * 断签枯萎 / 装饰购买与持久化 / settle 挂钩静默 / 不新增导航项。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTs } from './helpers/load-ts.mjs';
import { makeFakeIdb } from './helpers/fake-idb.mjs';

const F = await loadTs('src/services/spirit-field.ts');
const C = await loadTs('src/services/cave.ts');
const E = await loadTs('src/services/economy.ts');
const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.template.html'), 'utf8');
const D = 86400000;
/** 模拟连续 N 天：每天传递增的 now（否则被 dayKey 去重，视为同一天——这是预期行为） */
async function waterDays(idb, from, days, startNow = Date.now()) {
  for (let d = 0; d < days; d++) {
    const now = startNow + d * D;
    await F.waterField(F.fieldDayKey(now - D), idb, now);
  }
}

test('作物表：3 种作物 + 阈值与收益', () => {
  assert.strictEqual(F.PLOT_COUNT, 9, '9 格');
  assert.strictEqual(F.CROPS.qi_grass.matureDays, 7);
  assert.strictEqual(F.CROPS.memory_flower.matureDays, 14);
  assert.strictEqual(F.CROPS.enlighten_tree.matureDays, 30);
  assert.deepStrictEqual(F.CROPS.qi_grass.reward, { type: 'spirit', amount: 50 });
  assert.strictEqual(F.CROPS.memory_flower.reward.itemId, 'talisman');
  assert.strictEqual(F.CROPS.enlighten_tree.reward.itemId, 'book');
});

test('灵泉加成：floor(matureDays * 0.9)（验收 14）', () => {
  assert.strictEqual(F.effectiveMatureDays('qi_grass', false), 7);
  assert.strictEqual(F.effectiveMatureDays('qi_grass', true), 6, '7×0.9=6.3→floor 6');
  assert.strictEqual(F.effectiveMatureDays('memory_flower', true), 12);
  assert.strictEqual(F.effectiveMatureDays('enlighten_tree', true), 27);
});

test('种植：免费、占位检测、非法入参（验收 1/2）', async () => {
  const idb = makeFakeIdb();
  assert.strictEqual(F.PLOT_COUNT, 9);
  let st = await F.loadField(idb);
  assert.strictEqual(st.plots.length, 9);
  assert.ok(st.plots.every((p) => p === null), '初始 9 格全空');
  assert.strictEqual(st.hasSpringWater, false);

  assert.strictEqual((await F.plantSeed(0, 'qi_grass', idb)).ok, true);
  assert.strictEqual((await F.plantSeed(0, 'qi_grass', idb)).reason, 'occupied', '同格不可重复种');
  assert.strictEqual((await F.plantSeed(-1, 'qi_grass', idb)).reason, 'bad-plot');
  assert.strictEqual((await F.plantSeed(9, 'qi_grass', idb)).reason, 'bad-plot');
  assert.strictEqual((await F.plantSeed(1, 'unknown', idb)).reason, 'bad-crop');

  st = await F.loadField(idb);
  assert.strictEqual(st.plots[0].cropType, 'qi_grass');
  assert.strictEqual(st.plots[0].wateredDays, 0);
  assert.strictEqual(st.plots[1], null);
});

test('浇水：当天去重 + 未成熟才累加（验收 3/4）', async () => {
  const idb = makeFakeIdb();
  await F.plantSeed(0, 'qi_grass', idb);
  await F.plantSeed(1, 'qi_grass', idb);
  const t0 = new Date(2026, 9, 4, 12).getTime();
  const first = await F.waterField('2026-10-03', idb, t0);
  assert.strictEqual(first.watered, 2, '两株各 +1');
  const same = await F.waterField('2026-10-04', idb, t0);
  assert.strictEqual(same.watered, 0, '同日重复浇水跳过');
  const st = await F.loadField(idb);
  assert.strictEqual(st.plots[0].wateredDays, 1);
  assert.strictEqual(st.plots[1].wateredDays, 1);
});

test('成熟与收获：灵石草 7 天（验收 5/6）', async () => {
  const idb = makeFakeIdb();
  await F.plantSeed(0, 'qi_grass', idb);
  let st = await F.loadField(idb);
  assert.strictEqual(F.isMature(st.plots[0], false), false, '0 天未成熟');
  await waterDays(idb, 0, 7);
  st = await F.loadField(idb);
  assert.strictEqual(st.plots[0].wateredDays, 7);
  assert.strictEqual(F.isMature(st.plots[0], false), true, '7 天成熟');
  const r = await F.harvest(0, idb);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.reward, { type: 'spirit', amount: 50 }, '奖励 50 灵石');
  assert.strictEqual((await F.loadField(idb)).plots[0], null, '收获后清格');
  assert.strictEqual((await F.harvest(0, idb)).reason, 'empty', '空格不可收');
});

test('未成熟不可收获 + 护道符/古籍奖励定义（验收 7/8）', async () => {
  const idb = makeFakeIdb();
  await F.plantSeed(0, 'memory_flower', idb);
  assert.strictEqual((await F.harvest(0, idb)).reason, 'not-mature');
  await waterDays(idb, 0, 14);
  const r = await F.harvest(0, idb);
  assert.strictEqual(r.cropType, 'memory_flower');
  assert.deepStrictEqual(r.reward, { type: 'item', amount: 1, itemId: 'talisman' });
  // grantItem 真实入账（无价发放）
  await E.grantItem('talisman', undefined, idb);
  await E.refreshInventory(idb);
  assert.strictEqual(E.talismanCount(), 1, '护道符入账');
  await E.grantItem('book', 'abandon', idb);
  await E.refreshInventory(idb);
  assert.strictEqual(E.bookUnlocked('abandon'), true, '古籍解锁（按目标词）');
});

test('灵泉加成对已种植作物生效（阈值口径统一）', async () => {
  const idb = makeFakeIdb();
  await C.purchaseDecoration({ spirit: 500 }, 'spring_water', idb);
  await F.plantSeed(0, 'qi_grass', idb);
  await waterDays(idb, 0, 6);
  const st = await F.loadField(idb);
  assert.strictEqual(st.hasSpringWater, true, '灵泉状态被灵田读取');
  assert.strictEqual(F.isMature(st.plots[0], st.hasSpringWater), true, '6 天即成熟（阈值 6）');
  assert.strictEqual(F.isMature(st.plots[0], false), false, '无灵泉时 6 天不成熟');
});

test('断签枯萎：未成熟减半 + 已成熟不动（验收 9/10/11）', async () => {
  const idb = makeFakeIdb();
  const t0 = Date.now();
  // 浇水是全局推进（所有未成熟作物 +1），因此：先让第一株成熟，再种第二株（只经历剩余天数）
  await F.plantSeed(0, 'qi_grass', idb);
  await waterDays(idb, 0, 7, t0);              // 第一株 7 天 → 成熟
  await F.plantSeed(1, 'qi_grass', idb);
  await waterDays(idb, 0, 4, t0 + 7 * D);       // 第二株 4 天 → 未成熟
  const before = await F.loadField(idb);
  assert.strictEqual(before.plots[0].wateredDays, 7, '第一株 7 天');
  assert.strictEqual(F.isMature(before.plots[0], false), true, '第一株成熟');
  assert.strictEqual(before.plots[1].wateredDays, 4, '第二株 4 天');
  assert.strictEqual(F.isMature(before.plots[1], false), false, '第二株未成熟');
  const r = await F.applyWitherPenalty(idb);
  assert.strictEqual(r.withered, 1, '只枯萎未成熟那株');
  const st = await F.loadField(idb);
  // 枯萎的是第二株（plot1：4 天 → floor(4/2)=2）；第一株已成熟不受影响
  assert.strictEqual(st.plots[1].wateredDays, 2, '4 天 → floor(4/2)=2');
  assert.strictEqual(st.plots[1].withered, true);
  assert.strictEqual(st.plots[0].wateredDays, 7, '已成熟不枯萎、不减半');
  assert.strictEqual(st.plots[0].withered, false, '已成熟不枯萎');
  assert.strictEqual(F.isMature(st.plots[0], false), true, '已成熟仍可收');
  // 恢复：继续累积（枯萎标记保留至收获）
  await F.waterField('n', idb, t0 + 20 * D);
  const st2 = await F.loadField(idb);
  assert.strictEqual(st2.plots[1].wateredDays, 3, '恢复后继续累积');
  assert.strictEqual(st2.plots[1].withered, true, '枯萎标记保留至收获');
});

test('streakState：断签判定用本地日（R13）', () => {
  const now = new Date(2026, 9, 4, 12).getTime();
  assert.strictEqual(F.streakState(null, now), 'none');
  assert.strictEqual(F.streakState('2026-10-04', now), 'today');
  assert.strictEqual(F.streakState('2026-10-03', now), 'yesterday');
  assert.strictEqual(F.streakState('2026-10-01', now), 'broken', '隔 2 天以上=断签');
});

test('洞府装饰：5 种 + 购买扣费 + 不足禁用 + 防重复（验收 12/13/15）', async () => {
  assert.strictEqual(C.DECORATIONS.length, 5);
  const prices = Object.fromEntries(C.DECORATIONS.map((d) => [d.id, d.price]));
  assert.deepStrictEqual(prices, { bg_ink: 50, furniture_bamboo: 40, frame_cloud: 80, frame_beast: 120, spring_water: 200 });
  assert.strictEqual(C.DECORATIONS.find((d) => d.id === 'spring_water').effect, 'field_speedup');

  const idb = makeFakeIdb();
  const poor = { spirit: 10 };
  assert.strictEqual((await C.purchaseDecoration(poor, 'frame_cloud', idb)).reason, 'no-funds');
  assert.strictEqual(poor.spirit, 10, '不足不扣费');

  const rich = { spirit: 1000 };
  assert.strictEqual((await C.purchaseDecoration(rich, 'bg_ink', idb)).ok, true);
  assert.strictEqual(rich.spirit, 950);
  assert.strictEqual((await C.purchaseDecoration(rich, 'bg_ink', idb)).reason, 'already-owned');
  assert.strictEqual(rich.spirit, 950, '重复购买不扣费');
  assert.strictEqual((await C.purchaseDecoration(rich, 'unknown_x', idb)).reason, 'unknown-item');

  const cave = await C.loadCave(idb);
  assert.deepStrictEqual(cave.decorations, ['bg_ink'], '持久化');
  assert.strictEqual(await C.hasDecoration('bg_ink', idb), true);
  assert.strictEqual(await C.hasDecoration('spring_water', idb), false);
});

test('洞府：全量购齐后 layout=lush', async () => {
  const idb = makeFakeIdb();
  const rich = { spirit: 9999 };
  for (const d of C.DECORATIONS) await C.purchaseDecoration(rich, d.id, idb);
  const cave = await C.loadCave(idb);
  assert.strictEqual(cave.decorations.length, 5);
  assert.strictEqual(cave.layout, 'lush');
  assert.strictEqual(await C.hasSpringWater(idb), true);
});

test('持久化：刷新后种植/浇水量/枯萎/装饰仍在（验收 16/17）', async () => {
  const idb = makeFakeIdb();
  await F.plantSeed(3, 'enlighten_tree', idb);
  await waterDays(idb, 0, 5);
  await F.applyWitherPenalty(idb);
  await C.purchaseDecoration({ spirit: 300 }, 'bg_ink', idb);
  // 重新 load 相当于刷新页面
  const f1 = await F.loadField(idb);
  const f2 = await F.loadField(idb);
  assert.strictEqual(f1.plots[3].wateredDays, f2.plots[3].wateredDays);
  assert.strictEqual(f1.plots[3].withered, true);
  assert.strictEqual(f1.plots[3].cropType, 'enlighten_tree');
  assert.deepStrictEqual((await C.loadCave(idb)).decorations, ['bg_ink']);
});

test('接线：settle 挂钩内浇水 + 静默（验收 18/R18）', () => {
  const rt = html.slice(html.indexOf('渡劫会话运行时'));
  assert.ok(rt.includes('if (S.field && S.field.water) waterFieldOnce();'), 'settleHook 未接浇水');
  assert.ok(rt.includes('state.__fieldWaterDay = today;'), '当日去重标记缺失');
  // 静默：挂钩本体 try/catch + .catch 兜底
  assert.ok(rt.includes("console.warn('[settle hook]', e);"), '挂钩缺内部兜底');
  assert.ok(html.includes("if(window.__settleHook) try{"), 'settle 调用点缺 try/catch');
});

test('接线：UI 并入 panel-map + 不新增导航项（验收 20）', () => {
  const mapIdx = html.indexOf('id="panel-map"');
  const mapEnd = html.indexOf('</section>', html.indexOf('id="reportCard"'));
  for (const id of ['id="fieldDetails"', 'id="caveDetails"', 'id="plotGrid"', 'id="decoGrid"']) {
    const i = html.indexOf(id);
    assert.ok(i > mapIdx && i < mapEnd, `${id} 未落在 panel-map 内`);
  }
  const staticHtml = html.replace(/<script[\s\S]*?<\/script>/g, '');
  assert.strictEqual((staticHtml.match(/role="tab"/g) || []).length, 8, '导航必须仍是 8 项（不新增）');
  assert.strictEqual((staticHtml.match(/data-tab="/g) || []).length, 8);
  assert.ok(html.includes("S.economy.grantItem(rw.itemId"), '收获未真实入账（仅 toast 是上一轮的假发奖）');
  assert.ok(html.includes('window.__renderTribItems = renderTribItems;'), '库存刷新出口未暴露');
});