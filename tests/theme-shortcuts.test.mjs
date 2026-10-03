/**
 * 主题与快捷键解析单元测试（P0.5 第二批）
 *
 * 覆盖：
 *   1. 主题偏好规范化 / 解析 / 应用（auto 交回系统、light/dark 覆盖系统、脏数据回落）
 *   2. 方向键与数字键的动作解析（输入框内不拦截、带修饰键不拦截、无选项时不响应数字键）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/load-ts.mjs';

const theme = await loadTs('src/services/theme.ts');
const shortcuts = await loadTs('src/services/shortcuts.ts');

/** 最小存储桩件 */
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    _map: map,
  };
}

/** 最小 document 桩件 */
function fakeHost(systemDark) {
  const dataset = {};
  return {
    documentElement: { dataset },
    defaultView: { matchMedia: () => ({ matches: systemDark }) },
    _dataset: dataset,
  };
}

test('theme：偏好规范化，脏数据一律回落 auto', () => {
  assert.equal(theme.normalizePreference('dark'), 'dark');
  assert.equal(theme.normalizePreference('light'), 'light');
  assert.equal(theme.normalizePreference('auto'), 'auto');
  assert.equal(theme.normalizePreference('DARK'), 'auto');
  assert.equal(theme.normalizePreference(null), 'auto');
  assert.equal(theme.normalizePreference(''), 'auto');
});

test('theme：auto 跟随系统，light/dark 覆盖系统', () => {
  assert.equal(theme.resolveTheme('auto', true), 'dark');
  assert.equal(theme.resolveTheme('auto', false), 'light');
  assert.equal(theme.resolveTheme('light', true), 'light');
  assert.equal(theme.resolveTheme('dark', false), 'dark');
});

test('theme：applyTheme 写入 data-theme；auto 时移除属性交回 CSS', () => {
  const host = fakeHost(true); // 系统深色
  assert.equal(theme.applyTheme('light', { host, persist: false }), 'light');
  assert.equal(host._dataset.theme, 'light', '手动浅色应显式写入 data-theme');

  assert.equal(theme.applyTheme('auto', { host, persist: false }), 'dark');
  assert.equal('theme' in host._dataset, false, 'auto 时应移除 data-theme，交回 prefers-color-scheme');

  assert.equal(theme.applyTheme('dark', { host, persist: false }), 'dark');
  assert.equal(host._dataset.theme, 'dark');
});

test('theme：偏好读写（含存储不可用的降级）', () => {
  const store = fakeStorage();
  assert.equal(theme.readPreference(store), 'auto');
  assert.equal(theme.writePreference('dark', store), true);
  assert.equal(store._map.get(theme.THEME_STORAGE_KEY), 'dark');
  assert.equal(theme.readPreference(store), 'dark');
  assert.equal(theme.writePreference('bogus', store), true);
  assert.equal(theme.readPreference(store), 'auto', '写入非法值应被规范化为 auto');

  assert.equal(theme.readPreference(null), 'auto');
  assert.equal(theme.writePreference('dark', null), false);
  const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(theme.readPreference(throwing), 'auto');
  assert.equal(theme.writePreference('dark', throwing), false);
});

test('shortcuts：数字键选择选项，越界不响应', () => {
  assert.deepEqual(shortcuts.resolveShortcut('1', { hasChoices: true }), { type: 'answer', index: 0 });
  assert.deepEqual(shortcuts.resolveShortcut('4', { hasChoices: true }), { type: 'answer', index: 3 });
  assert.equal(shortcuts.resolveShortcut('5', { hasChoices: true }), null);
  assert.equal(shortcuts.resolveShortcut('1', { hasChoices: false }), null, '无选项时不响应数字键');
});

test('shortcuts：方向键切题，Enter 提交，空格播放', () => {
  assert.deepEqual(shortcuts.resolveShortcut('ArrowRight', {}), { type: 'next' });
  assert.deepEqual(shortcuts.resolveShortcut('ArrowDown', {}), { type: 'next' });
  assert.deepEqual(shortcuts.resolveShortcut('ArrowLeft', {}), { type: 'prev' });
  assert.deepEqual(shortcuts.resolveShortcut('ArrowUp', {}), { type: 'prev' });
  assert.deepEqual(shortcuts.resolveShortcut('Enter', {}), { type: 'submit' });
  assert.deepEqual(shortcuts.resolveShortcut(' ', { hasAudio: true }), { type: 'play' });
  assert.equal(shortcuts.resolveShortcut(' ', { hasAudio: false }), null);
  assert.equal(shortcuts.resolveShortcut('a', {}), null);
});

test('shortcuts：输入框内与修饰键组合一律不拦截', () => {
  assert.equal(shortcuts.resolveShortcut('ArrowRight', { inEditable: true }), null);
  assert.equal(shortcuts.resolveShortcut('1', { inEditable: true, hasChoices: true }), null);
  assert.equal(shortcuts.resolveShortcut('ArrowRight', { hasModifier: true }), null);
  assert.equal(shortcuts.resolveShortcut('Enter', { hasModifier: true }), null);
});
