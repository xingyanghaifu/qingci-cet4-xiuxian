/**
 * 12 条硬约束核验脚本自身的守卫（第十二轮）
 *
 * ── 为什么需要 ──
 * `scripts/audit-constraints.mjs` 是「交付前整体体检」工具。
 * 但**审计脚本自己也会错** —— 本轮就踩到三次：
 *
 *   1. 用 `node --test tests/`（目录）而不是 `tests/*.test.mjs` →
 *      Node 把目录当模块 → "Cannot find module" → **假失败**
 *   2. 从 `backup.ts` 里取 IDB 仓清单（那里只出现「被跳过」的两个）→
 *      「覆盖仓 0 个」→ **假失败**
 *   3. 按 TAP 的 `# pass` 解析，而 Node 的摘要前缀是 `ℹ` → **假失败**
 *
 * 更危险的是**假通过**：初版 aria 检查只要求「存在一条 `:focus-visible`」，
 * 我删掉 `button:focus-visible` 那条后审计**仍然通过**。
 *
 * 所以这里把审计脚本的关键判据钉住：既要能通过，也要在**该失败时失败**。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const script = readFileSync(join(ROOT, 'scripts', 'audit-constraints.mjs'), 'utf8');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

test('接线：审计脚本已注册为 npm 脚本', () => {
  assert.ok(pkg.scripts['audit:constraints'], 'package.json 缺 audit:constraints');
  assert.match(pkg.scripts['audit:constraints'], /audit-constraints\.mjs/);
});

test('审计必须覆盖全部 12 条约束（不多不少）', () => {
  const ids = [...script.matchAll(/check\('([a-z-]+)'/g)].map((m) => m[1]);
  const expected = [
    'single-file', 'no-deps', 'srs-semantics', 'aria', 'themes', 'tests',
    'no-data-loss', 'lazy-lexicon', 'size-budget', 'gates', 'flags-off', 'mnemonic',
  ];
  assert.deepEqual(ids, expected,
    `12 条约束的 id 与顺序应固定；实际 ${ids.length} 条：${ids.join(', ')}`);
});

test('回归守卫：测试全绿检查必须与 package.json 的 test 脚本同口径', () => {
  // 真实坑：写成 `node --test tests/`（目录）会 "Cannot find module" → 假失败
  assert.ok(!/execFileSync\(process\.execPath,\s*\['--test',\s*'tests\/'\]/.test(script),
    '审计仍用 `node --test tests/`（目录）—— 会 Cannot find module，必须用 glob 模式');
  assert.ok(/pkgTest/.test(script) && /tests\/\*\.test\.mjs/.test(script),
    '审计应从 package.json 的 test 脚本推导 glob 模式');
});

test('回归守卫：IDB 仓清单必须取自 idb.ts（不能取自 backup.ts）', () => {
  // 真实坑：backup.ts 里只出现「被跳过」的两个仓，从中取会得到「覆盖 0 个」
  assert.ok(/idb\.ts/.test(script) && /IDB_STORES/.test(script),
    '审计应从 idb.ts 读取仓清单');
  assert.ok(/idbBlock/.test(script), '应有从 idb.ts 提取 IDB_STORES 的代码');
});

test('回归守卫：测试摘要解析必须用 Node 的 `ℹ` 前缀（不是 TAP 的 `#`）', () => {
  assert.ok(/ℹ tests/.test(script) || /ℹ pass/.test(script),
    '审计未按 Node 的 `ℹ` 前缀解析摘要 —— 会得到「(未解析)」的假失败');
  assert.ok(!/match\(\/# tests/.test(script), '不应再按 TAP 的 `# tests` 解析');
});

test('回归守卫：aria 检查必须锚定到 button / .choice（防止假通过）', () => {
  // 真实坑：只判「存在一条 :focus-visible」时，删掉 button:focus-visible 仍会通过
  assert.ok(/button:focus-visible/.test(script),
    'aria 检查未锚定 button 焦点环 —— 删掉该规则审计会假通过');
  assert.ok(/\.choice:focus-visible/.test(script),
    'aria 检查未锚定 .choice 焦点环');
});

test('回归守卫：体积预算的两个阈值必须与实际口径一致', () => {
  // 基线 911318 B、硬顶 950000 B（与 tests/visual-v191.test.mjs 同口径）
  const visual = readFileSync(join(ROOT, 'tests', 'visual-v191.test.mjs'), 'utf8');
  const baseInVisual = /911318/.test(visual);
  const capInVisual = /950000/.test(visual);
  assert.ok(baseInVisual && capInVisual, '前提：visual-v191 里应有基线与硬顶常量');
  assert.ok(/911318/.test(script) && /950000/.test(script),
    '审计脚本里的基线与硬顶必须与 visual-v191 一致（否则两条口径会各自漂移）');
});

test('回归守卫：开关检查必须真的扫文件内容（不能只判文件存在）', () => {
  assert.ok(/D1_MULTIPLAYER_ENABLED/.test(script) && /AI_IMAGE_ENABLED/.test(script),
    '审计未检查这两个开关名');
  assert.ok(/offenders/.test(script), '应有「找到违规就记录」的逻辑');
});

test('输出契约：支持 --json 且以退出码表达结论', () => {
  assert.ok(/--json/.test(script), '应支持 --json 输出');
  assert.ok(/process\.exit\(results\.every/.test(script),
    '退出码必须反映整体结论（0 = 全部满足）');
});

test('不变量：12 条约束的核验结果结构一致', () => {
  // 每条都必须带 id/title/pass/criterion/evidence，便于机器消费
  assert.ok(/function check\(id, title, pass, criterion, evidence\)/.test(script),
    'check() 的签名应稳定（id/title/pass/criterion/evidence）');
  assert.ok(/results\.push\(\{ id, title, pass: !!pass, criterion, evidence: String\(evidence\) \}\)/.test(script),
    'results 结构应稳定');
});
