/**
 * 触控目标尺寸守卫（v1.10 第九轮）
 *
 * ── 真实缺陷 ──
 * 第八轮加的备份提醒里，那个「稍后再说」按钮写成：
 *
 *     .backup-hint .bh-act{...;background:none;border:0;font:inherit;padding:0 2px}
 *
 * 它是 `<button>`，但被当作**文字链接**排版（无内边距、无行高），
 * 移动端（375px）实测只有 **56×20**：
 *
 *     · 高度 20px **连 WCAG 2.2 AA 的 24×24 都不满足**
 *     · 更达不到本项目 `.btn` 既有的 44px 触控约定
 *
 * 而这类问题**功能测试完全测不出来** —— 按钮能点、事件也触发，
 * 只是手指点不准。**必须去量真实尺寸。**
 *
 * ── 修法 ──
 * `inline-flex` + `min-height` 撑出触控区，配 `@media (max-width:767px)`
 * 提到 44px；用负 margin 抵消内边距，视觉上仍是一行文字链接。
 *
 * ── 这份测试在防什么 ──
 * 静态断言：所有「看起来像文字链接但其实是按钮」的新控件，
 * 必须有显式的 min-height / padding 撑出触控区，不能只有 `padding:0`。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const html = readFileSync(join(ROOT, 'src', 'index.template.html'), 'utf8');

/** 取某个选择器的规则体（配平花括号） */
function ruleBody(selector) {
  const i = html.indexOf(selector);
  if (i < 0) return null;
  const open = html.indexOf('{', i);
  let depth = 0;
  for (let j = open; j < html.length; j++) {
    if (html[j] === '{') depth++;
    else if (html[j] === '}') { depth--; if (depth === 0) return html.slice(open + 1, j); }
  }
  return null;
}

test('守卫：文字链接样式的按钮必须有触控区（不能只有 padding:0）', () => {
  // 这些是「伪装成文字链接的 button」—— 最容易漏掉触控尺寸
  const linkLikeButtons = ['.backup-hint .bh-act'];
  const failures = [];
  for (const sel of linkLikeButtons) {
    const body = ruleBody(sel);
    if (!body) { failures.push(`${sel} 规则不存在`); continue; }
    const hasMinHeight = /min-height\s*:\s*(2[4-9]|[3-9]\d|\d{3,})px/.test(body);
    const hasPadding = /padding\s*:\s*(?!0(?:\s|;|$))/.test(body);
    if (!hasMinHeight && !hasPadding) {
      failures.push(`${sel} 既无 min-height(>=24px) 也无有效 padding —— 触控目标会过小`);
    }
  }
  assert.deepEqual(failures, [], failures.join('\n'));
});

test('守卫：备份提醒按钮在窄屏下达到 44px 触控高度', () => {
  // 本项目既有约定：移动端触控目标 >= 44px（见 @media (max-width:767px) 里的 .choice/.btn）
  // ⚠️ 页面里有**十个** max-width:767px 块，不能只从第一个开始找 ——
  // 初版就是这样误报「未提升到 44px」，实际规则在后面的块里。
  const blocks = [...html.matchAll(/@media \(max-width:767px\)\{[\s\S]{0,1200}?\}\s*\}/g)].map((m) => m[0]);
  const found = blocks.some((b) => /\.backup-hint \.bh-act\{[^}]*min-height:\s*44px/.test(b));
  assert.ok(found, '窄屏下 .bh-act 未提升到 44px 触控高度');
});

test('守卫：既有约定「移动端按钮 ≥44px」仍在', () => {
  assert.ok(/@media \(max-width:767px\)\{[\s\S]{0,600}?\.choice,\.btn\{min-height:44px\}/.test(html),
    '移动端 .choice/.btn 的 44px 约定被改动或删除');
});

test('守卫：本轮新增的 <button> 必须带 type 属性', () => {
  // ⚠️ 仓库里有大量历史 <button> 没写 type（132 个里 94 个缺），
  // 那是既有状态、不属于本轮范围 —— 全量要求会把一个历史问题变成阻塞。
  // 这里只守住**本轮及以后新增**的那两个控件。
  for (const id of ['rootGo', 'bhSnooze']) {
    const re = new RegExp(`<button[^>]*id="${id}"[^>]*>`);
    const m = html.match(re);
    assert.ok(m, `找不到 #${id} 的 <button> 标记`);
    assert.ok(/type="button"/.test(m[0]),
      `#${id} 缺 type="button"（本页面无 <form>，但显式声明可防将来包裹表单时行为突变）`);
  }
});

test('记录：缺 type 的历史 button 数量不得增长（防新增时漏写）', () => {
  // 基线：本轮之后 132 个 <button> 中 94 个缺 type。
  // 允许减少（有人补齐），不允许增加。
  const btns = [...html.matchAll(/<button([^>]*)>/g)].map((m) => m[1]);
  const missing = btns.filter((attrs) => !/type=/.test(attrs)).length;
  assert.ok(missing <= 94,
    `缺 type 的 <button> 从基线 94 增至 ${missing} —— 新增按钮时请补 type="button"`);
});

test('守卫：焦点环规则覆盖 button（:focus-visible 不得对 button 失效）', () => {
  assert.ok(/button:focus-visible[^{]*\{[^}]*outline:\s*[23]px solid/.test(html),
    ':focus-visible 对 button 的焦点环规则缺失或宽度异常');
  // 不得出现「全局 outline:none」把焦点环抹掉
  assert.ok(!/:focus\s*\{[^}]*outline:\s*none/.test(html),
    '存在 :focus{outline:none} —— 会抹掉键盘焦点环');
});
