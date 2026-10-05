/**
 * 阶段 B3 · 词汇量摸底独立成浮层（v1.9.1）
 *
 * 覆盖验收：
 *   B3-1 洞府页（#panel-map）含摸底入口        B3-2 背单词/每日设置页不再含摸底按钮
 *   B3-3 每日目标输入保留在 #panel-missions      B3-4 浮层 ARIA 完整（dialog/modal/labelledby）
 *   B3-5 10 题流程复用 assessmentQuestion 且不再 switchTab('trial')
 *   B3-6 自适应摸底（#planAssess / 洞府页）归口同一浮层
 *   B3-7 id 不重复、钩子齐备
 *   B3-8 产物层：浮层与入口都进了单文件
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const src = readFileSync(join(ROOT, 'src', 'index.template.html'), 'utf8');

const segOf = (startId, nextSection = true) => {
  const s = src.indexOf('id="' + startId + '"');
  assert.ok(s >= 0, '未找到 ' + startId);
  const from = src.lastIndexOf('<section', s);
  const e = nextSection ? src.indexOf('<section', from + 10) : -1;
  return src.slice(from, e > 0 ? e : from + 8000);
};

const count = (id) => (src.match(new RegExp('id="' + id + '"', 'g')) || []).length;

/* ── B3-1 洞府页入口 ── */
test('B3-1 洞府页 #panel-map 含摸底入口（10 题 + 自适应）', () => {
  const map = segOf('panel-map');
  assert.ok(map.includes('id="assessmentCard"'), '洞府页应含摸底卡');
  assert.ok(map.includes('id="startAssessment"'), '洞府页应含 10 题摸底按钮');
  assert.ok(map.includes('id="startAdaptiveAssess"'), '洞府页应含自适应摸底按钮');
});

/* ── B3-2 背单词/每日设置页不含摸底按钮 ── */
test('B3-2 #panel-missions 不再含摸底按钮', () => {
  const missions = segOf('panel-missions');
  assert.ok(!missions.includes('id="assessmentCard"'), '摸底卡应已迁出');
  assert.ok(!missions.includes('id="startAssessment"'), '摸底按钮应已迁出');
  assert.ok(!missions.includes('id="startAdaptiveAssess"'), '自适应按钮应已迁出');
});

/* ── B3-3 每日目标保留 ── */
test('B3-3 每日目标输入与保存按钮仍在 #panel-missions', () => {
  const missions = segOf('panel-missions');
  assert.ok(missions.includes('id="dailyTarget"'), '每日目标输入应保留');
  assert.ok(missions.includes('id="saveDailyTarget"'), '保存按钮应保留');
  assert.ok(missions.includes('type="number"'), '应为数字输入');
});

/* ── B3-4 浮层 ARIA ── */
test('B3-4 #assessOverlay ARIA 完整', () => {
  const i = src.indexOf('id="assessOverlay"');
  assert.ok(i >= 0, '浮层应存在');
  const from = src.lastIndexOf('<div', i);
  const tag = src.slice(from, src.indexOf('>', from) + 1);
  assert.match(tag, /role="dialog"/, 'role=dialog');
  assert.match(tag, /aria-modal="true"/, 'aria-modal');
  assert.match(tag, /aria-labelledby="asTitle"/, 'aria-labelledby');
  assert.match(tag, /aria-describedby="asHelp"/, 'aria-describedby');
  assert.ok(/class="overlay hidden" id="assessOverlay"|id="assessOverlay"[^>]*class="[^"]*hidden/.test(src.slice(from - 60, i + 60)) || /hidden/.test(tag),
    '默认应带 hidden（不自动弹出）');
  // 内部元素
  assert.match(src, /id="asPrompt" aria-live="polite" aria-atomic="true"/, '题面 aria-live');
  assert.match(src, /id="asChoices" role="group" aria-label="摸底选项" aria-describedby="asPrompt"/, '选项组');
  assert.match(src, /id="asFeedback" aria-live="polite"/, '反馈 aria-live');
});

/* ── B3-5 10 题流程：复用 assessmentQuestion + 不再 switchTab ── */
test('B3-5 10 题流程走浮层，复用 assessmentQuestion，不切换面板', () => {
  const fn = src.indexOf('window.__assessStartSimple = function');
  assert.ok(fn >= 0, '应定义 __assessStartSimple（浮层运行时内）');
  const body = src.slice(fn, fn + 400);
  assert.ok(body.includes('state.assessmentIndex = 1'), '应重置题号');
  assert.ok(body.includes('state.assessmentCorrect = 0'), '应重置计数');
  assert.ok(!body.includes("switchTab('trial')"), '不应切换到背单词页');

  const next = src.indexOf('function nextSimple()');
  assert.ok(next >= 0, '应有 nextSimple');
  const nextBody = src.slice(next, next + 600);
  assert.ok(nextBody.includes('assessmentQuestion()'), '应复用 assessmentQuestion');
  assert.ok(!nextBody.includes("switchTab('trial')"), '不应切换面板');

  // 入口优先走浮层
  const sa = src.indexOf('$("startAssessment").onclick');
  assert.ok(sa >= 0, '应有 startAssessment 绑定');
  const saBody = src.slice(sa, sa + 300);
  assert.ok(saBody.includes('__assessStartSimple'), '入口应优先走浮层');

  // 完成估算口径与原逻辑一致：correct/10*WORDS.length
  const fin = src.indexOf('function finishSimple()');
  assert.ok(fin >= 0, '应有 finishSimple');
  const finBody = src.slice(fin, fin + 700);
  assert.ok(finBody.includes('(state.assessmentCorrect / 10) * WORDS.length'), '估算口径应不变');
  assert.ok(finBody.includes('state.assessment = estimate'), '应写回 state.assessment');
  assert.ok(finBody.includes('renderTop()'), '完成后应刷新顶栏');
});

/* ── B3-6 自适应摸底归口 ── */
test('B3-6 自适应摸底（planAssess / 洞府页）归口同一浮层', () => {
  const s = src.indexOf('window.QingciStartAssessment = function');
  assert.ok(s >= 0, '应有 QingciStartAssessment');
  const body = src.slice(s, s + 400);
  assert.ok(body.includes("__assessOpen('adaptive')"), '应打开浮层');

  const showNext = src.indexOf('function showNext()');
  const snBody = src.slice(showNext, showNext + 900);
  assert.ok(snBody.includes('__assessRender'), '自适应出题应渲染进浮层');
  assert.ok(!snBody.includes("switchTab('trial')"), '不应切换面板');

  // finish 写浮层反馈
  const fin = src.indexOf('function finish()');
  const finBody = src.slice(fin, fin + 900);
  assert.ok(finBody.includes("byId('asFeedback') || byId('feedback')"), '结果应写进浮层反馈区');

  // planAssess 仍接 QingciStartAssessment
  assert.match(src, /byId\('planAssess'\)[\s\S]{0,260}?QingciStartAssessment/, 'planAssess 应归口');

  // 洞府页自适应按钮也接同一入口
  const adv = src.indexOf("el('startAdaptiveAssess')");
  assert.ok(adv >= 0, '洞府页自适应按钮应有绑定');
  assert.ok(src.slice(adv, adv + 300).includes('QingciStartAssessment'), '应调同一入口');
});

/* ── B3-7 id 唯一 + 钩子齐备 ── */
test('B3-7 关键 id 不重复，浮层钩子齐备', () => {
  const ids = ['assessmentCard', 'startAssessment', 'startAdaptiveAssess', 'dailyTarget',
    'saveDailyTarget', 'assessOverlay', 'asTitle', 'asProgress', 'asClose', 'asPrompt',
    'asSub', 'asChoices', 'asFeedback', 'asDone', 'planAssess', 'planCard'];
  for (const id of ids) assert.equal(count(id), 1, `id=${id} 应恰好 1 处（实际 ${count(id)}）`);
  for (const h of ['__assessStartSimple', '__assessOpen', '__assessRender', '__assessDone', '__assessClose']) {
    assert.ok(new RegExp('window\\.' + h + '\\s*=').test(src), `钩子 ${h} 应已定义`);
  }
});

/* ── B3-8 产物层 ── */
test('B3-8 产物含浮层与洞府页入口', () => {
  const dist = join(ROOT, 'dist', 'index.html');
  assert.ok(existsSync(dist), 'dist/index.html 应存在（先 npm run build）');
  const h = readFileSync(dist, 'utf8');
  assert.ok(h.includes('id="assessOverlay"'), '浮层应进产物');
  assert.ok(h.includes('__assessStartSimple'), '运行时应进产物');
  assert.ok(h.includes('id="startAdaptiveAssess"'), '洞府页入口应进产物');
  // 背单词页不内联摸底按钮（面板切片）
  const missions = (() => {
    const s = h.indexOf('id="panel-missions"');
    const from = h.lastIndexOf('<section', s);
    const e = h.indexOf('<section', from + 10);
    return h.slice(from, e);
  })();
  assert.ok(!missions.includes('id="startAssessment"'), '每日设置页不应含摸底按钮');
});
