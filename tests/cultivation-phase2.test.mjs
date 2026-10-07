/**
 * 第二期 · 修行反馈动效守卫
 *
 * 这一层守三件事：
 *   1. 新动效**必须是一次性的**（不能引入新的 infinite）
 *   2. 新动效必须**覆盖 reduced-motion**（退化为瞬时，不是半截）
 *   3. 动效触发点必须真的接在运行时事件上（不是只有 CSS）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const html = readFileSync(join(ROOT, 'src', 'index.template.html'), 'utf8');
const dist = readFileSync(join(ROOT, 'dist', 'index.html'), 'utf8');

const NEW_KEYFRAMES = ['subLevelUp', 'critFlash', 'critRing', 'comboPop'];

test('第二期：四个新 keyframes 都在', () => {
  for (const k of NEW_KEYFRAMES) {
    assert.ok(html.includes('@keyframes ' + k), `缺 @keyframes ${k}`);
    assert.ok(dist.includes('@keyframes ' + k), `产物缺 @keyframes ${k}`);
  }
});

test('第二期：新动效全是一次性（不含 infinite）', () => {
  // 既有守卫只扫 STAGE2/STAGE3 哨兵块，这里**全局**再守一遍：
  // 任何挂在新 keyframes 上的 animation 声明都不得带 infinite。
  const re = /animation:([^;}]+)/g;
  const offenders = [];
  for (const m of html.matchAll(re)) {
    const decl = m[1];
    if (!NEW_KEYFRAMES.some((k) => decl.includes(k))) continue;
    if (/infinite/.test(decl)) offenders.push(decl.trim());
  }
  assert.deepEqual(offenders, [], `新动效不得循环：${offenders.join(' | ')}`);
});

test('第二期：新动效都覆盖 reduced-motion（退化为瞬时）', () => {
  // 找「修行反馈动效」块里的 reduced-motion 规则
  const start = html.indexOf('第一期·第二期：修行反馈动效（BEGIN）');
  const end = html.indexOf('第一期·第二期：修行反馈动效（END）', start);
  assert.ok(start > 0 && end > start, '未找到修行反馈动效块');
  const block = html.slice(start, end);
  assert.ok(/@media \(prefers-reduced-motion:reduce\)\{/.test(block),
    '动效块内缺 prefers-reduced-motion 覆盖');

  // 关键：不能只断言「选择器在块里出现过」—— 那样把四个选择器删到只剩一个
  // 也能通过（变异测试实测漏网）。必须断言它们出现在**同一条
  // animation-duration 规则的完整选择器列表**里。
  const rule = block.match(/\{([^{}]*animation-duration:\.001ms!important[^{}]*)\}/);
  assert.ok(rule, '缺 animation-duration:.001ms 规则');
  const ruleStart = block.lastIndexOf('}', rule.index) + 1;
  const selectors = block.slice(ruleStart, rule.index);
  for (const sel of ['.realm-sub-name.level-up', '.crit-flash', '.combo-tag.pop', '.crit-ring']) {
    assert.ok(selectors.includes(sel),
      `reduced-motion 的 animation-duration 规则未覆盖 ${sel}（实际选择器：${selectors.trim()}）`);
  }
});

test('第二期：动效触发点真的接在运行时事件上', () => {
  // 不是只有 CSS —— 必须能在作答/领奖/晋级时被加上类
  assert.ok(/replayOnce\(document\.querySelector\('\.realm-sub-name'\),'level-up'/.test(html),
    '子层晋级未挂 level-up 动效');
  assert.ok(/replayOnce\(card,'crit-ring'/.test(html),
    '暴击未挂 crit-ring 动效');
  assert.ok(/combo-tag"\+\(state\.streak>=3\?" pop":""\)/.test(html),
    '连对标签未在达档时加 pop 类');
  assert.ok(/function replayOnce\(/.test(html), '缺 replayOnce 辅助（保证重复触发能重播）');
});

test('第二期：连对 HUD 元素与渲染函数都在', () => {
  assert.ok(html.includes('id="comboHud"'), '缺连对 HUD 元素');
  assert.ok(/function renderComboHud\(/.test(html), '缺 renderComboHud');
  // HUD 有 aria-live（读屏能播报连对变化）
  assert.ok(/id="comboHud"[^>]*aria-live="polite"/.test(html), '连对 HUD 应带 aria-live');
  // 少于 2 连时不显示（避免噪声）
  assert.ok(/if\(s<2\)\{ hud\.classList\.add\('hidden'\)/.test(html), '连对 <2 时应隐藏 HUD');
});

test('第二期：每日首登提示是一次性的（不重复弹）', () => {
  assert.ok(/state\.dailyWelcome=true/.test(html), '未标记今日首登');
  assert.ok(/if\(!state\.dailyWelcome\) return;/.test(html), '首登提示未做一次性保护');
  assert.ok(/state\.dailyWelcome=false; save\(\);/.test(html), '首登标记未消费');
});

test('第二期：暴击反馈按任务 id 定位（不打错卡）', () => {
  assert.ok(/data-mission='/.test(html), '任务卡未带 data-mission');
  assert.ok(/querySelector\('#missionList \.mission\[data-mission="'\+m\.id\+'"\]'\)/.test(html),
    '暴击反馈未按任务 id 精确定位');
});

test('第二期：产物与源文件一致（防只改模板没重新构建）', () => {
  for (const k of NEW_KEYFRAMES) assert.ok(dist.includes(k), `产物缺 ${k}`);
  assert.ok(dist.includes('id="comboHud"'), '产物缺 comboHud');
  assert.ok(dist.includes('function replayOnce('), '产物缺 replayOnce');
});
