/**
 * 修炼体系四环链（v1.8.1 谕令四）单元测试
 *
 * 覆盖：常量表 / 境界→灵田解锁格 / 封印文案 / 境界→心魔封顶 /
 *      境界→称号 / 收获→称号与心魔联动 / 终局化神概念。
 *
 * 不变量（本文件即验收）：
 *   · 常量表长度与档位严格一致（5 档）；
 *   · 解锁格数单调不减且上限 9；
 *   · 心魔封顶单调不减且上限 5；
 *   · 低境界封印格被拒绝种植（realmIndex 缺省时不限格，保持 v1.8.0 行为）；
 *   · 收获文案非空且不含付费/加速承诺。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/load-ts.mjs';
import { makeFakeIdb } from './helpers/fake-idb.mjs';

const C = await loadTs('src/services/cultivation.ts');
const F = await loadTs('src/services/spirit-field.ts');
const D = await loadTs('src/services/demons.ts');

test('常量表：五档齐全 + 单调不减 + 上限合法（谕令四）', () => {
  assert.strictEqual(C.REALM_TIERS, 5, '练气/筑基/金丹/元婴/化神五档');
  assert.strictEqual(C.PLOT_TOTAL, 9);
  assert.deepStrictEqual([...C.PLOT_UNLOCK_BY_REALM], [3, 5, 7, 9, 9], '灵田解锁格数表');
  assert.deepStrictEqual([...C.DEMON_LEVEL_CAP_BY_REALM], [3, 4, 5, 5, 5], '心魔封顶表');
  assert.strictEqual(C.DEMON_LEVEL_ABSOLUTE_CAP, 5);
  for (let i = 1; i < C.REALM_TIERS; i++) {
    assert.ok(C.PLOT_UNLOCK_BY_REALM[i] >= C.PLOT_UNLOCK_BY_REALM[i - 1], '解锁格数单调不减');
    assert.ok(C.DEMON_LEVEL_CAP_BY_REALM[i] >= C.DEMON_LEVEL_CAP_BY_REALM[i - 1], '心魔封顶单调不减');
  }
  for (const n of C.PLOT_UNLOCK_BY_REALM) assert.ok(n >= 0 && n <= C.PLOT_TOTAL);
  for (const n of C.DEMON_LEVEL_CAP_BY_REALM) assert.ok(n >= 1 && n <= C.DEMON_LEVEL_ABSOLUTE_CAP);
});

test('入门称号：五档齐全且互不相同（境界↔称号链）', () => {
  const names = [0, 1, 2, 3, 4].map((i) => C.REALM_ENTRY_TITLES[i]);
  assert.deepStrictEqual(names, ['初入道途', '筑基之资', '金丹初成', '元婴出窍', '化神登仙']);
  assert.strictEqual(new Set(names).size, 5, '称号互不重复');
  for (const n of names) assert.ok(n && n.length >= 3, '称号非空');
});

test('cultivationChain：解锁格/封印格/心魔封顶/特权行（境界→灵田→心魔链）', () => {
  const c0 = C.cultivationChain(0);
  assert.strictEqual(c0.unlockedPlots, 3);
  assert.strictEqual(c0.sealedPlots, 6);
  assert.strictEqual(c0.demonCap, 3);
  assert.strictEqual(c0.entryTitle, '初入道途');
  assert.strictEqual(c0.terminal, false);
  assert.ok(c0.privilegeLine.includes('3 格') && c0.privilegeLine.includes('Lv.3'), '特权行须写明解锁与封顶');

  const c2 = C.cultivationChain(2);
  assert.strictEqual(c2.unlockedPlots, 7);
  assert.strictEqual(c2.sealedPlots, 2);
  assert.strictEqual(c2.demonCap, 5);

  const c4 = C.cultivationChain(4);
  assert.strictEqual(c4.unlockedPlots, 9, '元婴/化神九格尽开');
  assert.strictEqual(c4.sealedPlots, 0);
  assert.strictEqual(c4.terminal, true, '化神为终局档');

  // 越界夹取
  assert.strictEqual(C.cultivationChain(-3).realmIndex, 0);
  assert.strictEqual(C.cultivationChain(99).realmIndex, 4);
  assert.strictEqual(C.cultivationChain(NaN).realmIndex, 0);
});

test('特权行：五档均有文案，且不含付费/加速承诺', () => {
  for (let i = 0; i < C.REALM_TIERS; i++) {
    const line = C.REALM_PRIVILEGE_LINE[i];
    assert.ok(line && line.length > 6, `第 ${i} 档缺特权行`);
    for (const banned of ['付费', '充值', '解锁付费', '加速', '会员', '氪']) {
      assert.ok(!line.includes(banned), `特权行出现付费/加速承诺：${line}`);
    }
  }
});

test('isPlotUnlocked / sealReason：低境界封印，高境界解封（境界→灵田链）', () => {
  // 练气只开 3 格
  for (let i = 0; i < 3; i++) assert.strictEqual(C.isPlotUnlocked(0, i), true, `第 ${i} 格应可耕`);
  for (let i = 3; i < 9; i++) assert.strictEqual(C.isPlotUnlocked(0, i), false, `第 ${i} 格应封印`);
  // 筑基 5 格 / 金丹 7 格 / 元婴 9 格
  assert.strictEqual(C.isPlotUnlocked(1, 4), true);
  assert.strictEqual(C.isPlotUnlocked(1, 5), false);
  assert.strictEqual(C.isPlotUnlocked(2, 6), true);
  assert.strictEqual(C.isPlotUnlocked(2, 7), false);
  assert.strictEqual(C.isPlotUnlocked(3, 8), true);
  assert.strictEqual(C.isPlotUnlocked(3, 9), false, '越界格仍为 false');

  assert.strictEqual(C.sealReason(0, 0), '', '已解锁无封印文案');
  const r = C.sealReason(0, 5);
  assert.ok(r.includes('第 6 格'), r);
  assert.ok(r.includes('筑基之资'), `封印文案须指向解封境界：${r}`);
  assert.strictEqual(C.isPlotUnlocked(4, 8), true, '化神九格尽开');
});

test('capDemonLevel / isDemonOverCap：境界封顶（境界→心魔链）', () => {
  assert.strictEqual(C.capDemonLevel(0, 5), 3, '练气心魔止于 Lv.3');
  assert.strictEqual(C.capDemonLevel(1, 5), 4, '筑基心魔止于 Lv.4');
  assert.strictEqual(C.capDemonLevel(2, 5), 5, '金丹可达 Lv.5');
  assert.strictEqual(C.capDemonLevel(4, 5), 5, '化神不封顶');
  assert.strictEqual(C.capDemonLevel(0, 2), 2, '未越界原样返回');
  assert.strictEqual(C.capDemonLevel(0, 0), 1, '最低 1 级');
  assert.strictEqual(C.isDemonOverCap(0, 5), true);
  assert.strictEqual(C.isDemonOverCap(0, 3), false);
  assert.strictEqual(C.isDemonOverCap(2, 5), false, '金丹不越界');
});

test('终局概念：化神有专属心魔文案，且不引入新等级', () => {
  assert.ok(C.TERMINAL_DEMON_NOTE.includes('化神'), C.TERMINAL_DEMON_NOTE);
  assert.ok(C.TERMINAL_DEMON_NOTE.includes('无相心魔'), C.TERMINAL_DEMON_NOTE);
  assert.strictEqual(C.DEMON_LEVEL_CAP_BY_REALM[4], C.DEMON_LEVEL_ABSOLUTE_CAP, '化神心魔仍是 Lv.5');
});

test('收获→称号 / 收获→心魔联动（灵田收获链路）', () => {
  const qi = C.harvestTitleOf('qi_grass');
  const fl = C.harvestTitleOf('memory_flower');
  const tr = C.harvestTitleOf('enlighten_tree');
  assert.ok(qi && fl && tr, '三种作物都要有收获称号文案');
  assert.strictEqual(new Set([qi, fl, tr]).size, 3, '三者互不相同');
  assert.ok(C.harvestTitleOf('unknown_crop').length > 0, '未知作物兜底文案');
  assert.ok(C.harvestDemonSoftening('memory_flower').includes('不再新增心魔'), '记忆花收获联动心魔');
  assert.ok(C.harvestDemonSoftening('enlighten_tree').includes('不再新增心魔'), '悟道树收获联动心魔');
  assert.ok(C.harvestDemonSoftening('qi_grass').includes('等级不变'), '灵石草不改心魔等级');
});

test('心魔境界封顶接入服务层：越界停在封顶，不降级不报错', async () => {
  const idb = makeFakeIdb();
  for (let i = 0; i < 4; i++) await D.upsertDemon('q_cap', +1, idb, Date.now(), 0);
  const d = await D.getDemon('q_cap', idb);
  assert.strictEqual(d.level, 3, '练气封顶 3 级');
  assert.strictEqual(D.isOverRealmCap(4, 0), true, 'Lv.4 对练气越界');
  assert.strictEqual(D.isOverRealmCap(4, 2), false, 'Lv.4 对金丹不越界');
  // 复习答对仍可降级（封顶只拦升级，不拦降级）
  const down = await D.upsertDemon('q_cap', -1, idb, Date.now(), 0);
  assert.strictEqual(down.level, 2, '封顶不影响降级');
  // 缺省 realmIndex 时保持 v1.8.0 行为（可到 Lv.5）
  for (let i = 0; i < 8; i++) await D.upsertDemon('q_plain', +1, idb);
  assert.strictEqual((await D.getDemon('q_plain', idb)).level, 5, '缺省境界时仍封顶 5');
});

test('心魔对账同样受境界封顶约束', async () => {
  const idb = makeFakeIdb();
  const r = await D.reconcileDemons([{ id: 'q_wrong_x9', wrongCount: 9 }], idb, Date.now(), 0);
  assert.strictEqual(r.created, 1);
  assert.strictEqual((await D.getDemon('q_wrong_x9', idb)).level, 3, '练气对账初值封顶 3');
  const idb2 = makeFakeIdb();
  await D.reconcileDemons([{ id: 'q_wrong_x9', wrongCount: 9 }], idb2, Date.now(), 2);
  assert.strictEqual((await D.getDemon('q_wrong_x9', idb2)).level, 5, '金丹对账初值 5');
});

test('灵田封印接入服务层：封印格拒绝种植，境界提升后解封', async () => {
  const idb = makeFakeIdb();
  // 缺省 realmIndex：9 格全开（v1.8.0 行为不变）
  assert.strictEqual((await F.plantSeed(8, 'qi_grass', idb)).ok, true, '缺省境界不限格');
  // 练气：第 4 格封印
  assert.strictEqual((await F.plantSeed(3, 'qi_grass', idb, Date.now(), 0)).reason, 'sealed');
  assert.strictEqual((await F.plantSeed(2, 'qi_grass', idb, Date.now(), 0)).ok, true, '练气第 3 格可耕');
  // 筑基解封第 4 格
  assert.strictEqual((await F.plantSeed(3, 'qi_grass', idb, Date.now(), 1)).ok, true, '筑基解封第 4 格');
  // 封印不误伤既有作物：读回时第 8 格作物仍在
  const st = await F.loadField(idb);
  assert.strictEqual(st.plots[8].cropType, 'qi_grass', '封印不影响既有数据');
  // service 层 isPlotUnlocked 与展示层一致
  assert.strictEqual(F.isPlotUnlocked(3, 0), false);
  assert.strictEqual(F.isPlotUnlocked(3, 1), true);
  assert.strictEqual(F.isPlotUnlocked(-1, 0), false);
  assert.deepStrictEqual([...F.DEFAULT_PLOT_UNLOCK_BY_REALM], [3, 5, 7, 9, 9], '默认解锁表与展示层一致');
});

test('服务层索引：cultivation 分组已暴露且表与模块一致', async () => {
  const S = await loadTs('src/services/index.ts');
  const svc = S.default || S.QingciServices;
  assert.ok(svc.cultivation, 'services.cultivation 缺失');
  assert.strictEqual(svc.cultivation.REALM_TIERS, 5);
  assert.deepStrictEqual([...svc.cultivation.PLOT_UNLOCK_BY_REALM], [3, 5, 7, 9, 9]);
  assert.deepStrictEqual([...svc.demons.REALM_CAP], [3, 4, 5, 5, 5]);
  assert.deepStrictEqual([...svc.field.UNLOCK_BY_REALM], [3, 5, 7, 9, 9]);
  assert.strictEqual(svc.cultivation.chain(0).unlockedPlots, 3);
});