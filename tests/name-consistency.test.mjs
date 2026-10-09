/**
 * 名称一致性守卫（v1.11 第六轮）
 *
 * ── 真实缺陷 ──
 * `ledger.CROP_LABEL` 是 `spirit-field.CROPS` 的**冗余副本**
 * （ledger.ts 刻意零依赖，不 import 任何模块，所以只能复制名字）。
 * 冗余就会漂移 —— 实测：
 *
 *     memory_flower   流水显示「忆魂花」  |  灵田显示「记忆花」
 *
 * 于是**同一个作物在两处显示两个名字**。用户会以为流水里的「忆魂花」
 * 和灵田里的「记忆花」是两种东西。
 *
 * ── 这份测试在防什么 ──
 * 把所有「展示用名字表」与「权威定义」逐项比对。
 * 这类缺陷**不会报错**，只会让用户困惑 —— 只有逐项比对才能发现。
 *
 * 顺带记录一个**误判教训**：我最初以为
 * `cultivation-curve.CROPS`（含 `lingzhi`）与 `spirit-field.CROPS`（3 种）
 * 不一致会导致「UI 能选但种不下」。真浏览器实测**证伪**：
 * `field.crops` 取自 spirit-field（3 种全部可种），
 * `curve.CROPS` 是另一套「稀有度/解锁」表，两者用途不同。
 * 所以本轮**没有**改这部分逻辑，只修真实存在的名字漂移。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTs } from './helpers/load-ts.mjs';

const ROOT = join(import.meta.dirname, '..');
const L = await loadTs('src/services/ledger.ts');
const F = await loadTs('src/services/spirit-field.ts');
const E = await loadTs('src/services/economy.ts');
const html = readFileSync(join(ROOT, 'src', 'index.template.html'), 'utf8');

/* ───────── 一、作物名必须与灵田一致 ───────── */

test('守卫：流水里的作物名必须与灵田一致（防漂移）', () => {
  const mismatches = [];
  for (const [id, def] of Object.entries(F.CROPS)) {
    const ledgerName = L.CROP_LABEL[id];
    if (!ledgerName) { mismatches.push(`${id} 在 CROP_LABEL 里缺失`); continue; }
    if (ledgerName !== def.name) {
      mismatches.push(`${id}: 流水「${ledgerName}」 ≠ 灵田「${def.name}」`);
    }
  }
  assert.deepEqual(mismatches, [],
    `同一作物在两处名字不一致 —— 用户会以为是两种东西：\n  ${mismatches.join('\n  ')}`);
});

test('回归：memory_flower 必须叫「记忆花」（曾误作「忆魂花」）', () => {
  assert.equal(L.CROP_LABEL.memory_flower, '记忆花');
  assert.equal(F.CROPS.memory_flower.name, '记忆花');
  // 且流水渲染出来的文案里也要是这个名
  assert.ok(L.reasonLabel('harvest_memory_flower').includes('记忆花'),
    `流水文案应为「灵田收获 · 记忆花」（实际「${L.reasonLabel('harvest_memory_flower')}」）`);
});

test('守卫：CROP_LABEL 不得有灵田里不存在的作物（陈旧条目）', () => {
  const stale = Object.keys(L.CROP_LABEL).filter((id) => !(id in F.CROPS));
  assert.deepEqual(stale, [],
    `CROP_LABEL 有灵田里不存在的作物（陈旧条目）：${stale.join(', ')}`);
});

/* ───────── 二、道具名必须与商店一致 ───────── */

test('守卫：流水里的道具名必须与商店一致', () => {
  const mismatches = [];
  for (const item of E.ITEM_CATALOG) {
    const ledgerName = L.ITEM_LABEL[item.id];
    if (!ledgerName) { mismatches.push(`${item.id} 在 ITEM_LABEL 里缺失`); continue; }
    if (ledgerName !== item.name) {
      mismatches.push(`${item.id}: 流水「${ledgerName}」 ≠ 商店「${item.name}」`);
    }
  }
  assert.deepEqual(mismatches, [],
    `同一道具在两处名字不一致：\n  ${mismatches.join('\n  ')}`);
});

test('守卫：商店外的道具（复习令/听风符/破障丹）名与模板一致', () => {
  // 这三个走模板的 buyItem names 映射，不在 ITEM_CATALOG 里
  const m = html.match(/const names=\{([^}]+)\}/);
  assert.ok(m, '找不到模板的 buyItem names 映射');
  const pairs = [...m[1].matchAll(/([a-z_]+)\s*:\s*'([^']+)'/g)];
  const mismatches = [];
  for (const [, id, name] of pairs) {
    if (L.ITEM_LABEL[id] && L.ITEM_LABEL[id] !== name) {
      mismatches.push(`${id}: 流水「${L.ITEM_LABEL[id]}」 ≠ 模板「${name}」`);
    }
  }
  assert.deepEqual(mismatches, [], mismatches.join('\n'));
});

/* ───────── 三、泛化守卫：名字表的值不能是英文/代码 ───────── */

test('守卫：所有展示名都是中文（不泄漏内部代码）', () => {
  const tables = {
    CROP_LABEL: L.CROP_LABEL,
    ITEM_LABEL: L.ITEM_LABEL,
    REASON_LABEL: L.REASON_LABEL,
  };
  const bad = [];
  for (const [tname, table] of Object.entries(tables)) {
    for (const [k, v] of Object.entries(table)) {
      if (!/[\u4e00-\u9fa5]/.test(String(v))) bad.push(`${tname}.${k} → ${v}`);
    }
  }
  assert.deepEqual(bad, [], `展示名应为中文：\n  ${bad.join('\n  ')}`);
});

/* ───────── 四、误判记录：两份作物表用途不同，不得混用 ───────── */

test('记录：field.crops 与 curve.CROPS 是两套表（用途不同，勿混用）', () => {
  // spirit-field.CROPS：种植/持久化（含 reward/matureDays）
  const fieldIds = Object.keys(F.CROPS).sort();
  assert.deepEqual(fieldIds, ['enlighten_tree', 'memory_flower', 'qi_grass']);
  // 每项都应有持久化必需字段
  for (const [id, def] of Object.entries(F.CROPS)) {
    assert.ok(def.matureDays > 0, `${id} 缺 matureDays`);
    assert.ok(def.reward && def.reward.type, `${id} 缺 reward`);
  }
  // 且 field 服务暴露的 crops 就是这一套（模板据此渲染，已验证全部可种）
  assert.ok(/crops:\s*FIELD_CROPS/.test(readFileSync(join(ROOT, 'src', 'services', 'index.ts'), 'utf8')),
    'field.crops 应指向 spirit-field 的表（含 reward，可用于种植）');
});
