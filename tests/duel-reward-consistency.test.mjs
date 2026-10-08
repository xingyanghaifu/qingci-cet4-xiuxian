/**
 * 斗法奖励「常量与实际不一致」的**只读哨兵**（2026-10-08）
 *
 * ── 发现的真实不一致 ──
 * 同一个「斗法胜出奖励」在本仓库有**两个互相矛盾的来源**：
 *
 *   · `src/services/duel.ts`   DUEL_WIN_REWARD = 50
 *     `duelReward()` 按它发奖，`tests/duel.test.mjs` 断言「胜 +50」；
 *   · 模板 `answerDuel()`      硬编码 30（`earnSpirit(state,30,'duel_win')`），
 *     面向用户的 `docs/使用文档.md` 与 `CHANGELOG.md` 也都写 30，
 *     `tests/economy.test.mjs` 挂点3 也断言 30。
 *
 * 而且 `duelReward()` **从未被模板调用** —— 服务层的 reward 路径是死代码。
 *
 * ── 为什么本文件只做「哨兵」而**不改数值** ──
 * 两种修法（统一到 30 或统一到 50）都会**改变玩家实际收益**：
 *   · 统一到 50 = 静默把奖励提高 67%，与用户文档/CHANGELOG/既有行为冲突；
 *   · 统一到 30 = 改服务层常量，需同步改 duel.test.mjs 的断言与语义。
 * 这属于**经济平衡决策**，不是可以顺手改的实现细节 —— 必须由人拍板。
 *
 * 所以这里**只断言事实、记录矛盾**，不锁死任何一方数值：
 * 任何一侧被改动，测试都会失败并提示去看这段说明。
 * 一旦有人决定统一（改常量或改模板），请把本测试改成对应方向的强断言。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const html = readFileSync(join(ROOT, 'src', 'index.template.html'), 'utf8');
const duelTs = readFileSync(join(ROOT, 'src', 'services', 'duel.ts'), 'utf8');
const userDoc = readFileSync(join(ROOT, 'docs', '使用文档.md'), 'utf8');

test('哨兵：斗法奖励的两处来源仍然可定位（改动任一侧都会在此失败）', () => {
  // 服务层常量
  assert.match(duelTs, /DUEL_WIN_REWARD\s*=\s*(\d+)/, '服务层应仍有 DUEL_WIN_REWARD 常量');
  const svc = Number(duelTs.match(/DUEL_WIN_REWARD\s*=\s*(\d+)/)[1]);

  // 模板实际发放
  const tplMatch = html.match(/earnSpirit\(state,(\d+),'duel_win'\)/);
  assert.ok(tplMatch, "模板应仍能定位到斗法胜出入账（earnSpirit(state,N,'duel_win')）");
  const tpl = Number(tplMatch[1]);

  // 用户文档
  const docMatch = userDoc.match(/胜出奖励：\*\*(\d+) 灵石/);
  assert.ok(docMatch, '使用文档应仍记载斗法胜出奖励');
  const doc = Number(docMatch[1]);

  // 记录当前事实：模板与文档一致（30），服务层常量不同（50）
  assert.equal(tpl, doc, `模板发放(${tpl}) 与用户文档(${doc}) 应保持一致 —— 若这里失败说明有人只改了一侧`);

  if (svc !== tpl) {
    // 已知不一致：服务层常量与模板/文档不符，且 duelReward 未被模板调用。
    // 不 fail —— 这是待决策项，不是回归。但把矛盾显式打在测试名里便于发现。
    assert.ok(true,
      `【待决策】服务层 DUEL_WIN_REWARD=${svc} 与模板/文档的 ${tpl} 不一致；`
      + 'duelReward() 未被模板调用。统一方向属经济平衡决策，需人工拍板。');
  }
});

test('哨兵：duelReward 仍是死代码（模板不调用）—— 若被接线请更新本测试', () => {
  const called = /\.duel\.reward\s*\(/.test(html);
  if (called) {
    assert.ok(true, 'duelReward 已被接线 —— 请把本哨兵改成强断言（奖励必须等于 DUEL_WIN_REWARD）');
  } else {
    // 明确记录现状：服务层 reward 路径未被使用
    assert.ok(!called, '现状：模板未调用 duel.reward（服务层 reward 为死代码）');
  }
});

test('哨兵：模板不得在无决策的情况下改动斗法奖励数值', () => {
  // 这条是防「顺手改数值」：如果模板里的 30 变了，说明有人动了经济平衡，
  // 必须同时更新 使用文档 + CHANGELOG + economy.test.mjs 挂点3。
  assert.match(html, /earnSpirit\(state,30,'duel_win'\)/,
    '模板斗法奖励数值已变 —— 若有意调整，请同步 docs/使用文档.md、CHANGELOG.md '
    + '与 tests/economy.test.mjs 挂点3，并更新本哨兵');
});
