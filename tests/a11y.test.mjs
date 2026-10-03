/**
 * 无障碍与个性化（P2.12）单元测试
 *
 * 覆盖：偏好规范化与持久化、data-* 属性落地、高对比度/字号/减动效三轴独立、
 * 主题跟随系统与持久化、快捷键解析全表（含 Esc/?/R 与输入态豁免）、
 * 以及构建产物里的无障碍标记（ARIA / ✓✗ / skip link / lang）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadTs } from './helpers/load-ts.mjs';

const a11y = await loadTs('src/services/a11y.ts');
const shortcuts = await loadTs('src/services/shortcuts.ts');
const theme = await loadTs('src/services/theme.ts');

const {
  normalizeA11y, loadA11y, saveA11y, applyA11y, initA11y, describeA11y, fontScaleLabel,
  FONT_SCALES, SHORTCUT_HELP, DEFAULT_A11Y, A11Y_STORAGE_KEY,
} = a11y;
const { resolveShortcut } = shortcuts;
const { normalizePreference, resolveTheme, readPreference, writePreference, applyTheme, themeOptions } = {
  ...theme,
  themeOptions: theme.THEME_OPTIONS,
};

function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    _map: map,
  };
}

/** 假 <html>：只需要 dataset */
function makeHost() {
  return { documentElement: { dataset: {} } };
}

test('a11y：默认值、规范化与标签', () => {
  assert.deepEqual(normalizeA11y(null), DEFAULT_A11Y);
  assert.deepEqual(normalizeA11y({ fontScale: 'nope', contrast: 1, motion: {} }), DEFAULT_A11Y);
  assert.equal(normalizeA11y({ fontScale: 'huge' }).fontScale, 'huge');
  assert.equal(normalizeA11y({ contrast: 'high' }).contrast, 'high');
  assert.equal(normalizeA11y({ motion: 'reduced' }).motion, 'reduced');
  assert.equal(FONT_SCALES.length, 4, '字号应有 4 档');
  assert.deepEqual(FONT_SCALES.map((f) => f.value), ['standard', 'large', 'xlarge', 'huge']);
  // 档位必须单调递增，否则「调大」会反而变小
  for (let i = 1; i < FONT_SCALES.length; i++) {
    assert.ok(FONT_SCALES[i].scale > FONT_SCALES[i - 1].scale);
  }
  assert.equal(fontScaleLabel('xlarge'), '特大');
  assert.match(describeA11y({ fontScale: 'large', contrast: 'high', motion: 'reduced' }), /字号 大 · 高对比度 · 减少动效/);
});

test('a11y：持久化、脏数据兜底与存储不可用', () => {
  const storage = makeStorage();
  assert.deepEqual(loadA11y(storage), DEFAULT_A11Y);

  const saved = saveA11y({ fontScale: 'large', contrast: 'high' }, storage);
  assert.equal(saved.fontScale, 'large');
  assert.equal(saved.contrast, 'high');
  assert.equal(saved.motion, 'system', '未指定的轴应保持默认');
  assert.ok(storage._map.get(A11Y_STORAGE_KEY).includes('large'));

  // 部分更新不应覆盖其它轴
  const merged = saveA11y({ motion: 'reduced' }, storage);
  assert.deepEqual(merged, { fontScale: 'large', contrast: 'high', motion: 'reduced' });

  storage.setItem(A11Y_STORAGE_KEY, '{坏 JSON');
  assert.deepEqual(loadA11y(storage), DEFAULT_A11Y, '损坏数据回落默认');
  assert.deepEqual(loadA11y(null), DEFAULT_A11Y, '无存储回落默认');
  assert.equal(saveA11y({ fontScale: 'huge' }, null).fontScale, 'huge', '无存储时仍返回规范化结果');
});

test('a11y：apply 把三轴写到 <html> 的 data-* 上（标准值移除属性）', () => {
  const host = makeHost();

  applyA11y({ fontScale: 'xlarge', contrast: 'high', motion: 'reduced' }, { host, persist: false });
  assert.equal(host.documentElement.dataset.font, 'xlarge');
  assert.equal(host.documentElement.dataset.contrast, 'high');
  assert.equal(host.documentElement.dataset.motion, 'reduced');

  // 回到默认应移除属性（交给 CSS 默认值 / 系统媒体查询）
  applyA11y(DEFAULT_A11Y, { host, persist: false });
  assert.equal(host.documentElement.dataset.font, undefined);
  assert.equal(host.documentElement.dataset.contrast, undefined);
  assert.equal(host.documentElement.dataset.motion, undefined);

  // 返回值反映实际生效情况
  const applied = applyA11y({ fontScale: 'huge', contrast: 'normal', motion: 'system' }, { host, persist: false, systemReducedMotion: true });
  assert.equal(applied.scale, 1.5);
  assert.equal(applied.reducedMotion, true, '系统减动效时也应报告为已减少');
  const strict = applyA11y({ fontScale: 'standard', contrast: 'normal', motion: 'system' }, { host, persist: false, systemReducedMotion: false });
  assert.equal(strict.reducedMotion, false);
  assert.equal(strict.scale, 1);

  // 无 host 不应抛异常
  assert.doesNotThrow(() => applyA11y(DEFAULT_A11Y, { host: null, persist: false }));

  // init 读取存储并应用
  const storage = makeStorage();
  storage.setItem(A11Y_STORAGE_KEY, JSON.stringify({ fontScale: 'large', contrast: 'high', motion: 'system' }));
  const host2 = makeHost();
  const prefs = saveA11y({ fontScale: 'large', contrast: 'high' }, storage);
  assert.equal(prefs.fontScale, 'large');
  assert.equal(normalizeA11y(loadA11y(storage)).contrast, 'high');
  assert.equal(typeof initA11y({ host: host2 }), 'object');
});

test('a11y：字号与对比度互不影响（三轴独立）', () => {
  const host = makeHost();
  applyA11y({ fontScale: 'large', contrast: 'normal', motion: 'system' }, { host, persist: false });
  assert.equal(host.documentElement.dataset.font, 'large');
  assert.equal(host.documentElement.dataset.contrast, undefined, '字号不应改动对比度');

  applyA11y({ fontScale: 'large', contrast: 'high', motion: 'system' }, { host, persist: false });
  assert.equal(host.documentElement.dataset.font, 'large', '对比度不应改动字号');
  assert.equal(host.documentElement.dataset.contrast, 'high');
});

test('theme：跟随系统 / 一键切换 / 持久化（P2.12 第 1 项）', () => {
  assert.equal(themeOptions.length, 3);
  assert.equal(resolveTheme('auto', true), 'dark');
  assert.equal(resolveTheme('auto', false), 'light');
  assert.equal(resolveTheme('dark', false), 'dark', '显式深色应覆盖系统浅色');
  assert.equal(resolveTheme('light', true), 'light', '显式浅色应覆盖系统深色');
  assert.equal(normalizePreference('weird'), 'auto');

  const host = {
    documentElement: { dataset: {} },
    defaultView: { matchMedia: () => ({ matches: true }) },
  };
  assert.equal(applyTheme('auto', { host, persist: false }), 'dark');
  assert.equal(host.documentElement.dataset.theme, undefined, 'auto 时移除属性交给媒体查询');
  assert.equal(applyTheme('light', { host, persist: false }), 'light');
  assert.equal(host.documentElement.dataset.theme, 'light');
  applyTheme('auto', { host: null, persist: false }); // 无 DOM 不抛

  const storage = makeStorage();
  assert.equal(readPreference(storage), 'dark', '无存储（首次访问）回落暗色默认');
  assert.equal(writePreference('dark', storage), true);
  assert.equal(readPreference(storage), 'dark');
  assert.equal(readPreference(null), 'auto', '无存储回落 auto');
  assert.equal(writePreference('light', null), false, '无存储时写入返回 false');
});

test('shortcuts：完整键位表（1-4 / 方向键 / Enter / 空格 / R / Esc / ?）', () => {
  const base = { hasChoices: true, maxOptions: 4 };
  assert.deepEqual(resolveShortcut('1', base), { type: 'answer', index: 0 });
  assert.deepEqual(resolveShortcut('4', base), { type: 'answer', index: 3 });
  assert.equal(resolveShortcut('5', base), null, '超出选项数不响应');
  assert.equal(resolveShortcut('2', { hasChoices: false }), null, '无选项时不响应数字键');

  assert.deepEqual(resolveShortcut('ArrowRight', base), { type: 'next' });
  assert.deepEqual(resolveShortcut('ArrowDown', base), { type: 'next' });
  assert.deepEqual(resolveShortcut('ArrowLeft', base), { type: 'prev' });
  assert.deepEqual(resolveShortcut('ArrowUp', base), { type: 'prev' });
  assert.deepEqual(resolveShortcut('Enter', base), { type: 'submit' });
  assert.deepEqual(resolveShortcut(' ', base), { type: 'play' });
  assert.deepEqual(resolveShortcut('Spacebar', base), { type: 'play' });
  assert.equal(resolveShortcut(' ', { hasAudio: false }), null, '无音频时不响应空格');
  assert.deepEqual(resolveShortcut('r', base), { type: 'replay' });
  assert.deepEqual(resolveShortcut('R', base), { type: 'replay' });
  assert.equal(resolveShortcut('r', { hasAudio: false }), null);
  assert.deepEqual(resolveShortcut('Escape', base), { type: 'close' });
  assert.deepEqual(resolveShortcut('?', base), { type: 'help' });

  // 输入态与组合键一律放行（不能抢输入、不能抢系统快捷键）
  assert.equal(resolveShortcut('1', { inEditable: true, hasChoices: true }), null);
  assert.equal(resolveShortcut('ArrowRight', { inEditable: true }), null);
  assert.equal(resolveShortcut('Enter', { inEditable: true }), null);
  assert.equal(resolveShortcut('1', { hasModifier: true, hasChoices: true }), null);
  assert.equal(resolveShortcut('ArrowRight', { hasModifier: true }), null);
  // Esc 与 ? 即使在输入框里也要能用（否则用户被困）
  assert.deepEqual(resolveShortcut('Escape', { inEditable: true }), { type: 'close' });
  assert.deepEqual(resolveShortcut('?', { inEditable: true }), { type: 'help' });

  assert.equal(resolveShortcut('x', base), null);
  assert.equal(resolveShortcut('F5', base), null);
});

test('shortcuts：帮助文案与解析实现同源（不回退成文档漂移）', () => {
  const keys = SHORTCUT_HELP.map((row) => row.keys).join(' ');
  for (const token of ['1', '4', '→', '←', 'Enter', '空格', 'R', 'Esc', '?']) {
    assert.ok(keys.includes(token), `快捷键表应包含 ${token}`);
  }
  assert.equal(SHORTCUT_HELP.length, 8);
});

test('artifact：构建产物里的无障碍标记齐备', () => {
  const html = fs.readFileSync('dist/cet4-xiuxian.html', 'utf8');
  const checks = {
    'lang 声明': /<html lang="zh-CN">/.test(html),
    'skip link 且目标存在': html.includes('class="skip-link"') && html.includes('id="main"'),
    'main landmark': /<main id="main"/.test(html),
    '题干 aria-live 播报': /id="prompt"[^>]*aria-live="polite"/.test(html),
    '选项组语义': /id="choices"[^>]*role="group"/.test(html),
    '错误横幅 role=alert': /id="errBanner"[^>]*role="alert"/.test(html),
    '反馈区 aria-live': /id="feedback"[^>]*aria-live="polite"/.test(html),
    '弹窗 role=dialog': (html.match(/role="dialog"/g) || []).length >= 3,
    '色盲友好 ✓/✗': html.includes(".choice.good::before{content:'✓ '") && html.includes(".choice.bad::before{content:'✗ '"),
    '高对比度主题': html.includes(':root[data-contrast="high"]'),
    '字号档位变量': html.includes('--q-scale') && html.includes(':root[data-font="huge"]'),
    '焦点可见': html.includes(':focus-visible{outline:3px solid'),
    '减少动效': html.includes('data-motion="reduced"') && html.includes('prefers-reduced-motion:reduce'),
    '屏幕阅读器隐藏文本类': html.includes('.sr-only{'),
    '首屏前应用偏好（防闪烁）': html.includes("localStorage.getItem('qingci.a11y')"),
    '无障碍设置卡片': html.includes('id="a11yCard"') && html.includes('id="a11yHelp"') && html.includes('id="a11yShortcuts"'),
    'aria-pressed 状态按钮': html.includes('id="a11yContrast"') && html.includes('aria-pressed'),
    'Esc 关闭弹窗': html.includes('function closeTopOverlay'),
    '题干焦点管理': html.includes("promptEl.focus({ preventScroll: true })"),
    '屏幕阅读器播报通道': html.includes('QingciAnnounce') && html.includes('srAnnouncer'),
    '1–4 选择选项已接线': html.includes("action.type === 'answer'") && /btns\[action\.index\]/.test(html),
    'Enter 推进/提交已接线': html.includes("action.type === 'submit'") && html.includes("visible('submitSpell')"),
    '空格播放已接线': html.includes("action.type === 'play'") && html.includes('function visibleAudio'),
  };
  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
  assert.deepEqual(failed, [], '构建产物缺少无障碍标记：' + failed.join('、'));
});
