/**
 * 心魔（阶段 B）：命名确定性、升降级、对账、生图预留
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTs } from './helpers/load-ts.mjs';
import { makeFakeIdb } from './helpers/fake-idb.mjs';

const D = await loadTs('src/services/demons.ts');
const html = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.template.html'), 'utf8');
const feats = await loadTs('src/config/features.ts');

test('命名：同 questionId 恒定 + 不同 id 不同名', () => {
  const a = D.demonNameFrom('q_vocab_0000_en2zh');
  assert.strictEqual(a, D.demonNameFrom('q_vocab_0000_en2zh'), '确定性');
  const names = new Set(['a', 'b', 'c', 'd', 'e', 'f'].map((s) => D.demonNameFrom('q_' + s)));
  assert.ok(names.size >= 2, '不同 id 应有区分度');
  assert.match(a, /^(迷雾|贪嗔|愚痴|执念|心魔)(魔|魅|影|魇|蟒|蛛|蝎|蛊|僵|傀|兽|灵|魂|君|尊|将|帝)$/, '魔名格式：前缀+后缀');
  assert.strictEqual(D.demonNameFrom(''), '无名魔', '空 id 兜底');
});

test('等级与境界映射', () => {
  assert.strictEqual(D.clampLevel(0), 1);
  assert.strictEqual(D.clampLevel(9), 5);
  assert.strictEqual(D.clampLevel(3.4), 3);
  for (const lv of [1, 2, 3, 4, 5]) assert.ok(D.demonRealmOf(lv) >= 0 && D.demonRealmOf(lv) <= 4);
});

test('升降级：答错 +1、答对 -1、level 1 保留档案', async () => {
  const idb = makeFakeIdb();
  let d = await D.upsertDemon('q_x', +1, idb);
  assert.strictEqual(d.level, 1, '首次建档 level 1');
  d = await D.upsertDemon('q_x', +1, idb);
  assert.strictEqual(d.level, 2);
  d = await D.upsertDemon('q_x', +1, idb);
  assert.strictEqual(d.level, 3);
  d = await D.upsertDemon('q_x', -1, idb);
  assert.strictEqual(d.level, 2, '复习答对降级');
  assert.strictEqual(d.defeatedCount, 1, '击败计数累加');
  // level 1 复习答对：不删除，仅 defeatedCount++
  d = await D.upsertDemon('q_y', -1, idb);
  assert.strictEqual(d.level, 1);
  const got = await D.getDemon('q_x', idb);
  assert.ok(got, '档案仍在');
  // 封顶
  for (let i = 0; i < 6; i++) await D.upsertDemon('q_z', +1, idb);
  assert.strictEqual((await D.getDemon('q_z', idb)).level, 5, '封顶 5');
  assert.strictEqual(await D.countRaidReady(idb), 1, '劫级心魔计数');
});

test('列表：降序（等级高在前），可按等级过滤', async () => {
  const idb = makeFakeIdb();
  for (let i = 0; i < 4; i++) await D.upsertDemon('q_a', +1, idb);
  await D.upsertDemon('q_b', +1, idb);
  const list = await D.listDemons({}, idb);
  assert.strictEqual(list.length, 2);
  assert.ok(list[0].level >= list[1].level, '等级降序');
  const only4 = await D.listDemons({ level: 4 }, idb);
  assert.strictEqual(only4.length, 1);
  assert.strictEqual(only4[0].questionId, 'q_a');
});

test('对账：以 mistakes 为权威重建，只增不降 + 幂等', async () => {
  const idb = makeFakeIdb();
  // 现有心魔已演化到 level 3（首次建档 1 + 两次升级）
  for (let i = 0; i < 3; i++) await D.upsertDemon('q_a', +1, idb);
  const before = await D.getDemon('q_a', idb);
  assert.strictEqual(before.level, 3);
  // 对账：mistakes 显示 q_a 只错 1 次（level 1）、q_new 错 3 次（level 3）
  let res = await D.reconcileDemons([{ id: 'q_a', wrongCount: 1 }, { id: 'q_new', wrongCount: 3 }], idb);
  assert.strictEqual(res.created, 1, '新建 q_new');
  assert.strictEqual(res.kept, 1, '保留 q_a');
  assert.strictEqual((await D.getDemon('q_a', idb)).level, 3, '不降级（max(prev, mapped)）');
  assert.strictEqual((await D.getDemon('q_new', idb)).level, 3, '按 wrongCount 映射');
  // 幂等：再跑一次无新建
  res = await D.reconcileDemons([{ id: 'q_a', wrongCount: 1 }, { id: 'q_new', wrongCount: 3 }], idb);
  assert.strictEqual(res.created, 0, '幂等');
});

test('AI 生图预留：模型三字段 + 占位槽位 + 开关默认关', () => {
  assert.strictEqual(D.demonImageSlot('q_x'), 'demon:q_x');
  const prompt = D.demonImagePrompt({ name: '迷雾魔', level: 3, questionId: 'q_x' });
  assert.ok(prompt.includes('迷雾魔') && prompt.includes('q_x'), '提示词含名字与题号');
  assert.strictEqual(feats.FEATURES.AI_IMAGE_ENABLED, false, '生图开关默认关闭');
  assert.strictEqual(feats.isFeatureEnabled('AI_IMAGE_ENABLED'), false);
  // 数据模型含三字段
  const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'services', 'demons.ts'), 'utf8');
  for (const f of ['imageUrl', 'imagePrompt', 'imageStatus']) assert.ok(src.includes(f), `缺 ${f}`);
});

test('灵兽模型（阶段 B 仅占位）', () => {
  assert.strictEqual(D.beastNameFrom('beast-1'), D.beastNameFrom('beast-1'));
  assert.notStrictEqual(D.beastNameFrom('beast-1'), D.beastNameFrom('beast-2'));
});

test('R18：settle 挂钩点包裹 try/catch（不得连累答题）', () => {
  assert.ok(html.includes("if(window.__settleHook) try{ window.__settleHook(ok,current); }catch(e){ console.warn('[settle hook] non-fatal:',e); }"),
    'settle 内挂钩必须 try/catch');
  // 挂钩实现内部亦不抛
  assert.ok(html.includes("window.__settleHook = function (correct, current) {"), '挂钩实现缺失');
  assert.ok(html.includes("console.warn('[settle hook]', e);"), '实现内须兜底');
});

test('心魔劫：判罚档与奖励接线（阶段 B 补齐）', () => {
  const rt = html.slice(html.indexOf('渡劫会话运行时'));
  // 判罚档透传
  assert.ok(rt.includes("var raid = session.mode === 'demon_raid';"), 'raid 标志缺失');
  assert.ok(rt.includes("penaltyMode: raid ? 'demon_raid' : 'tribulation',"), '判罚档未透传');
  // 成功奖励分流
  assert.ok(rt.includes("S.economy.earnSpirit(state, T.RAID_REWARD, 'demon_raid_success')"), '心魔劫 80 灵石未走流水');
  assert.ok(rt.includes("state.qi = (Number(state.qi) || 0) + T.RAID_QI;"), '心魔劫 25 修为未入账');
  assert.ok(rt.includes('if (!raid) {'), '心魔劫必须不晋级（晋级分支须受 !raid 保护）');
  assert.ok(rt.includes("rTitle.textContent = '心魔劫胜'"), '结果页文案未区分心魔劫');
});

test('接线：心魔录 UI + 心魔劫复用 + 奇遇通知 aria-live', () => {
  assert.ok(html.includes('id="demonPanel"') && html.includes('id="demonGrid"'), '心魔录面板缺失');
  // 心魔录必须落在洞府页 panel-map 内（防止挂到别处导致不可见）
  const mapIdx = html.indexOf('id="panel-map"');
  const demonIdx = html.indexOf('id="demonPanel"');
  const mapEnd = html.indexOf('</section>', mapIdx);
  assert.ok(mapIdx > 0 && demonIdx > mapIdx && demonIdx < mapEnd,
    '心魔录必须在 panel-map 内且位于 </section> 之前');
  // 单挑必须走真实存在的 state/switchTab/ask 链路（window.setPool 并不存在）
  assert.ok(html.includes("state.pool = 'wrong';") && html.includes("switchTab('trial');"), '单挑链路缺失');
  assert.ok(!html.includes('window.setPool'), '不得依赖不存在的 window.setPool');
  assert.ok(html.includes('data-image-slot='), 'SVG 占位缺 data-image-slot');
  assert.ok(html.includes('window.__tribDebugStart') || html.includes("__tribDebugStart({ mode: 'demon_raid'"), '心魔劫须复用渡劫渲染器');
  assert.ok(html.includes("noticeEl.setAttribute('aria-live', 'polite')"), '奇遇通知缺 aria-live');
  assert.ok(html.includes("'role', 'status'"), '奇遇通知缺 role=status');
});