/**
 * 斗法奖励口径守卫（2026-10-08）
 *
 * ── 背景：一次被我自己推翻的「发现」 ──
 * 我曾以为「斗法胜出奖励」存在矛盾：服务层 `DUEL_WIN_REWARD = 50`，
 * 而模板硬编码 30，文档也写 30。据此写了一份「记录矛盾」的哨兵测试。
 *
 * **这个前提是错的。** 实际是本仓库有**两个不同的对战功能**，各有各的奖励：
 *
 *   · **斗法场**（导航「斗法场」）：HP 制、5 回合、答对伤敌 24/答错自损 18。
 *     入口 `answerDuel()`，奖励 **30 灵石 + 20 灵气**（`docs/使用文档.md` §2.3）。
 *   · **道友论剑**（洞府「论剑」）：正确数优先、同数比用时。
 *     入口 `startDuel()`，奖励走服务层 `D.reward` = **50 / 平 20**。
 *
 * 两者数值不同是**设计如此**，不是缺陷。所以本文件不再声称「矛盾」，
 * 改为**分别钉死两个功能的奖励口径**，防止有人把两者混为一谈而改错一个。
 *
 * ── 教训 ──
 * 「同一个词出现在两处、数值不同」不等于「矛盾」——
 * 必须先确认它们是不是**同一个功能**。我差点按错误前提改掉玩家收益
 * （那会把斗法场从 30 改成 50，与用户文档冲突）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const html = readFileSync(join(ROOT, 'src', 'index.template.html'), 'utf8');
const duelTs = readFileSync(join(ROOT, 'src', 'services', 'duel.ts'), 'utf8');
const userDoc = readFileSync(join(ROOT, 'docs', '使用文档.md'), 'utf8');

test('功能区分：斗法场与道友论剑是两个独立入口', () => {
  assert.ok(/function answerDuel\s*\(/.test(html), '缺斗法场入口 answerDuel()');
  assert.ok(/function startDuel\s*\(/.test(html), '缺道友论剑入口 startDuel()');
  assert.notEqual(
    html.indexOf('function answerDuel'),
    html.indexOf('function startDuel'),
    '两个入口不应是同一个函数',
  );
});

test('斗法场：奖励 30 灵石，与用户文档一致（不要改成 50）', () => {
  // 斗法场是 HP 制硬编码奖励；与服务层的论剑奖励 50 无关
  assert.match(html, /earnSpirit\(state,30,'duel_win'\)/,
    '斗法场胜出应为 30 灵石 —— 若确要调整，须同步 docs/使用文档.md §2.3 与 CHANGELOG.md');
  assert.match(userDoc, /胜出奖励：\*\*30 灵石 \+ 20 灵气\*\*/,
    '用户文档 §2.3 应记载斗法场 30 灵石 + 20 灵气');
  assert.ok(/灵气 \+20|state\.qi\+=20/.test(html), '斗法场应同时给 20 灵气');
});

test('道友论剑：奖励走服务层常量（50 / 平 20）', () => {
  assert.match(duelTs, /DUEL_WIN_REWARD\s*=\s*50/, '论剑胜出常量应为 50');
  assert.match(duelTs, /DUEL_TIE_REWARD\s*=\s*20/, '论剑平局常量应为 20');
  // 论剑入口必须真的调用服务层 reward（否则奖励会与常量脱节）
  assert.ok(/D\.reward\(state,\s*outcome/.test(html),
    '道友论剑应调用 D.reward(state, outcome) —— 不得硬编码数值');
  // 论剑列表展示的数值也应取自常量
  assert.ok(/D\.WIN_REWARD/.test(html), '论剑列表应显示 D.WIN_REWARD（而非写死）');
});

test('两个功能的奖励互不串味', () => {
  // 斗法场不得误用论剑常量
  const answerDuelSeg = html.slice(html.indexOf('function answerDuel'), html.indexOf('function choose'));
  assert.ok(!/WIN_REWARD/.test(answerDuelSeg),
    '斗法场不应引用 WIN_REWARD（那是论剑的 50）');
});
