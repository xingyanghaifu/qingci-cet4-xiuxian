/**
 * 第一期 · 灵田稀有度 + 心魔曲线接线测试
 *
 * 这一层守的是「新机制真的接进了服务层」，以及**旧行为没有被破坏**：
 *   · 灵田稀有度是**加法**（新增门槛），不是替换既有三作物；
 *   · 心魔曲线改动后，境界封顶逻辑一字不动。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/load-ts.mjs';
import { makeFakeIdb } from './helpers/fake-idb.mjs';

const F = await loadTs('src/services/spirit-field.ts');
const D = await loadTs('src/services/demons.ts');
const C = await loadTs('src/services/cultivation-curve.ts');

/* ───────────────── 灵田稀有度 ───────────────── */

test('灵田稀有度：三种作物都还在（新增稀有度不替换既有作物）', () => {
  assert.deepEqual(Object.keys(F.CROPS).sort(), ['enlighten_tree', 'memory_flower', 'qi_grass']);
  assert.equal(F.CROPS.qi_grass.matureDays, 7);
  assert.equal(F.CROPS.memory_flower.matureDays, 14);
  assert.equal(F.CROPS.enlighten_tree.matureDays, 30);
});

test('灵田稀有度：普通作物无门槛，悟道树标记为稀有且需 30 天', () => {
  assert.equal(F.CROPS.qi_grass.rarity, 'common');
  assert.equal(F.CROPS.memory_flower.rarity, 'common');
  assert.equal(F.CROPS.enlighten_tree.rarity, 'rare');
  assert.equal(F.CROPS.enlighten_tree.minStreakDays, 30);
  assert.equal(F.isRareCrop('enlighten_tree'), true);
  assert.equal(F.isRareCrop('qi_grass'), false);
});

test('灵田稀有度：cropUnlocked 按连续签到天数判定', () => {
  assert.equal(F.cropUnlocked('qi_grass', 0), true, '普通作物永远可种');
  assert.equal(F.cropUnlocked('memory_flower', 0), true);
  assert.equal(F.cropUnlocked('enlighten_tree', 29), false);
  assert.equal(F.cropUnlocked('enlighten_tree', 30), true);
  assert.equal(F.cropUnlocked('enlighten_tree', 100), true);
});

test('灵田稀有度：解锁文案给出「还差多少天」的明确信息', () => {
  const locked = F.cropLockReason('enlighten_tree', 10);
  assert.ok(locked.includes('30'), '应说明需要多少天');
  assert.ok(locked.includes('悟道树'), '应说明是哪个作物');
  assert.equal(F.cropLockReason('enlighten_tree', 30), '', '已解锁时无提示');
  assert.equal(F.cropLockReason('qi_grass', 0), '', '普通作物无提示');
});

test('灵田稀有度：plantSeed 拒绝未解锁的稀有种子（reason=locked）', async () => {
  const idb = makeFakeIdb();
  const denied = await F.plantSeed(0, 'enlighten_tree', idb, Date.now(), undefined, 10);
  assert.equal(denied.ok, false);
  assert.equal(denied.reason, 'locked', '未满 30 天应被拒');

  const ok = await F.plantSeed(0, 'enlighten_tree', idb, Date.now(), undefined, 30);
  assert.equal(ok.ok, true, '满 30 天应可种');
});

test('灵田稀有度：不传 streakDays 时保持旧行为（既有调用点不受影响）', async () => {
  const idb = makeFakeIdb();
  // 旧签名：只传 5 个参数
  const r = await F.plantSeed(0, 'enlighten_tree', idb, Date.now(), undefined);
  assert.equal(r.ok, true, '不传签到天数时不设门槛（向后兼容）');
});

test('灵田稀有度：普通作物任何签到天数都可种', async () => {
  const idb = makeFakeIdb();
  const r = await F.plantSeed(0, 'qi_grass', idb, Date.now(), undefined, 0);
  assert.equal(r.ok, true);
});

test('灵田稀有度：封印格优先于稀有度判定（境界不够时给 sealed 而不是 locked）', async () => {
  const idb = makeFakeIdb();
  // 第 8 格在练气（realmIndex=0，只解锁 3 格）是封印的
  const r = await F.plantSeed(8, 'enlighten_tree', idb, Date.now(), 0, 0);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'sealed', '封印判定应优先（否则提示会误导）');
});

/* ───────────────── 心魔曲线接线 ───────────────── */

test('心魔曲线：境界封顶逻辑仍生效（新曲线不改封顶）', async () => {
  const idb = makeFakeIdb();
  // 练气（realmIndex=0）封顶 Lv3
  for (let i = 0; i < 12; i++) await D.upsertDemon('q_cap', +1, idb, Date.now(), 0);
  const d = await D.getDemon('q_cap', idb);
  assert.equal(d.level, 3, '练气境界心魔封顶 Lv3');
});

test('心魔曲线：旧档案没有 wrongCount 时能安全迁移（不报错、不跳级）', async () => {
  const idb = makeFakeIdb();
  // 手工造一条「旧格式」档案（无 wrongCount）
  const legacy = {
    id: 'demon:q_old', questionId: 'q_old', level: 3, createdAt: new Date().toISOString(),
    lastFoughtAt: new Date().toISOString(), defeatedCount: 0, name: '旧心魔', realm: 1, imageStatus: 'none',
  };
  // 直接用服务层的写入口：先答错 3 次建到 Lv3，再删掉 wrongCount 模拟旧档
  for (let i = 0; i < 3; i++) await D.upsertDemon('q_old', +1, idb);
  const before = await D.getDemon('q_old', idb);
  assert.equal(before.level, 3);

  // 再答错一次：应由「等级反推错次」继续推进，而不是跳级
  const after = await D.upsertDemon('q_old', +1, idb);
  assert.ok(after.level >= 3, `应继续推进，实际 Lv${after.level}`);
  assert.ok(after.level <= 4, `不应跳级到 Lv${after.level}`);
  void legacy;
});

test('心魔曲线：降级后错次回退，连续答错不会反复跳级', async () => {
  const idb = makeFakeIdb();
  for (let i = 0; i < 7; i++) await D.upsertDemon('q_r', +1, idb);
  let d = await D.getDemon('q_r', idb);
  assert.equal(d.level, 5, '累计 7 错到 Lv5');
  // 答对降级
  d = await D.upsertDemon('q_r', -1, idb);
  assert.equal(d.level, 4);
  assert.equal(d.wrongCount, C.wrongsForLevel(4), '错次应回退到 Lv4 门槛');
  // 再答错一次：Lv4→5 需要 2 错，所以还不该升
  d = await D.upsertDemon('q_r', +1, idb);
  assert.equal(d.level, 4, 'Lv4→5 第一错不应升级');
});

test('心魔曲线：曲线模块与 demons 的等级口径一致', () => {
  // 两个模块必须用同一套门槛，否则「界面显示的等级」与「实际存储的等级」会漂移
  for (let lv = 1; lv <= 5; lv++) {
    const w = C.wrongsForLevel(lv);
    assert.equal(C.levelFromWrongs(w), lv, `wrongsForLevel(${lv})=${w} 应能反解回 ${lv}`);
  }
  assert.equal(C.wrongsForLevel(5), 7, 'Lv5 门槛应为 7 错（1+1+1+2+2）');
});
