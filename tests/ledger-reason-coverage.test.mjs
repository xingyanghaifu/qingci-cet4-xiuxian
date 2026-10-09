/**
 * 流水 reason 覆盖率守卫（v1.11 第五轮）
 *
 * ── 真实缺陷 ──
 * 第二轮我给 `settle()` 新增了灵石来源 `word_milestone` / `word_milestone_crit`，
 * 但**漏了在 `ledger.ts` 的 `REASON_LABEL` 里加中文映射**。
 * 后果：灵石流水里直接显示原始代码，例如：
 *
 *     +5 灵石   word_milestone
 *
 * 而 `reasonLabel()` 的设计是「未知代码**原样返回**」（刻意不显示「未知」，
 * 便于发现问题）—— 所以这个缺陷**不会报错，只会显示得很难看**。
 * 单元测试也不会失败，因为 ledger 的测试用的是它自己造的 reason。
 *
 * ── 这份测试在防什么 ──
 * 静态扫描**所有** `earnSpirit(...)` / `spendSpirit(...)` 的 reason 字面量，
 * 断言每一个都在 `REASON_LABEL` 或 `PREFIX_LABEL` 里有中文映射。
 * 这样「新增货币来源却忘了加映射」会在测试阶段立刻暴露。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadTs } from './helpers/load-ts.mjs';

const ROOT = join(import.meta.dirname, '..');
const L = await loadTs('src/services/ledger.ts');

/** 递归收集 src/ 下的文本文件 */
function collect(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) collect(p, out);
    else if (/\.(ts|js|mjs|html)$/.test(name)) out.push(p);
  }
  return out;
}

const files = collect(join(ROOT, 'src'));
const sources = files.map((f) => ({ f, text: readFileSync(f, 'utf8') }));

/**
 * 抽取所有货币收支调用的 reason 字面量。
 * 覆盖：`earnSpirit(state, N, 'reason'` / `spendSpirit(state, N, 'reason'`
 * 以及带前缀拼写的 `'harvest_' + ...`（按前缀归类）。
 */
function collectReasons() {
  const found = new Map(); // reason → 出处
  for (const { f, text } of sources) {
    // 字面量 reason
    for (const m of text.matchAll(/(?:earnSpirit|spendSpirit)\s*\([^;\n]{0,240}?['"`]([a-z][a-z0-9_]*)['"`]/g)) {
      const r = m[1];
      if (!found.has(r)) found.set(r, f.replace(ROOT, ''));
    }
    // 前缀拼接（如 `'harvest_' + r.cropType`）
    for (const m of text.matchAll(/(?:earnSpirit|spendSpirit)\s*\([^;\n]{0,240}?['"`]([a-z][a-z0-9_]*)['"`]\s*\+/g)) {
      const r = m[1];
      if (!found.has(r)) found.set(r, f.replace(ROOT, ''));
    }
  }
  return found;
}

const reasons = collectReasons();

test('前置：确实扫到了货币来源（否则守卫形同虚设）', () => {
  assert.ok(reasons.size >= 5,
    `只扫到 ${reasons.size} 个 reason —— 扫描逻辑可能失效`);
  assert.ok(reasons.has('duel_win'), '应扫到 duel_win');
});

test('守卫：每个货币来源的 reason 都必须有中文映射', () => {
  // ⚠️ 不能访问 PREFIX_LABEL —— 它是模块私有常量（未导出）。
  // 最初我写了 `L.PREFIX_LABEL.some(...)`，结果 undefined.some 抛错，
  // 测试失败但**原因与产品无关**。改为用 reasonLabel 的**行为**判定：
  // 有映射的会产出中文标签；无映射的会退化成「下划线换间隔号」的原始形态。
  const missing = [];
  for (const [r, src] of reasons) {
    const label = L.reasonLabel(r);
    const hasChinese = /[\u4e00-\u9fa5]/.test(label);
    if (!hasChinese) missing.push(`${r} → "${label}"（${src}）`);
  }
  assert.deepEqual(missing, [],
    `以下 reason 没有中文映射 —— 流水里会显示原始代码：\n  ${missing.join('\n  ')}`);
});

test('守卫：映射的中文标签必须是中文（不能是英文/代码）', () => {
  const bad = [];
  for (const [k, v] of Object.entries(L.REASON_LABEL)) {
    if (!/[\u4e00-\u9fa5]/.test(v)) bad.push(`${k} → ${v}`);
  }
  assert.deepEqual(bad, [], `标签应为中文：\n  ${bad.join('\n  ')}`);
});

test('守卫：本轮新增的灵石来源已映射（回归）', () => {
  // 具体回归：第二轮加的 word_milestone 当时漏了
  assert.equal(L.reasonLabel('word_milestone'), '掌握里程碑');
  assert.ok(/暴击/.test(L.reasonLabel('word_milestone_crit')));
});

test('守卫：未知 reason 的降级行为符合既有设计（不显示「未知」）', () => {
  // 既有设计：未知代码不吞掉、也不显示「未知」，
  // 而是把下划线换成间隔号让可读性稍好（便于发现问题）。
  // ⚠️ 我最初断言「原样返回」是**错的** —— 实现会做替换。
  assert.equal(L.reasonLabel('totally_unknown_reason'), 'totally · unknown · reason');
  // 空值回落到中性文案（不是空串）
  assert.equal(L.reasonLabel(''), '灵石变动');
  assert.equal(L.reasonLabel(null), '灵石变动');
  assert.equal(L.reasonLabel(undefined), '灵石变动');
  // 但绝不能出现「未知」这类掩盖性文案
  assert.ok(!/未知/.test(L.reasonLabel('some_new_reason')),
    '不应把未知 reason 显示成「未知」—— 那会掩盖问题');
});

test('守卫：前缀类 reason 能正确解析（purchase_/refund_/harvest_）', () => {
  assert.ok(/购买/.test(L.reasonLabel('purchase_array')));
  assert.ok(/退款/.test(L.reasonLabel('refund_pill')));
  assert.ok(/灵田收获/.test(L.reasonLabel('harvest_qi_grass')));
});
