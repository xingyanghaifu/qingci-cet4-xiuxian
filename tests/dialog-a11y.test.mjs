/**
 * 模态层公共设施 · 运行时行为测试（P1-6 焦点循环 / P1-7 背景滚动锁）
 *
 * 背景（2026-10-07 审计）：站内 12 个 role="dialog"，只有导航抽屉实现了 Tab 焦点循环，
 * 其余 10 个覆盖层 Tab 会跑到遮罩外；且 body.style.overflow 出现过 0 次。
 *
 * 这里把新增的公共设施源码抠出来，配假 DOM **真跑**：
 * 焦点回绕、焦点在遮罩外被拉回、浮层套浮层不解锁、滚动锁幂等 ——
 * 这些全是运行时行为，字符串断言一个都测不出来。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const html = readFileSync(join(import.meta.dirname, '..', 'src', 'index.template.html'), 'utf8');

/* ---------- 极简假 DOM：够跑焦点循环与滚动锁即可 ---------- */

/** 假文档的引用表：makeEl 的 focus() 需要它，故先建对象、后填实现 */
const DOC = { activeElement: null };

function makeEl(tag, opts = {}) {
  const el = {
    tagName: (tag || 'div').toUpperCase(),
    id: opts.id || '',
    className: opts.className || '',
    attrs: opts.attrs || {},
    children: opts.children || [],
    parent: null,
    offsetParent: opts.offsetParent === undefined ? {} : opts.offsetParent,
    disabled: !!opts.disabled,
    focused: 0,
    clicked: 0,
    style: {},
    getAttribute(n) { return this.attrs[n] === undefined ? null : this.attrs[n]; },
    get classList() {
      const self = this;
      // 注意：必须按空白切分比对，不能用 indexOf 拼串 ——
      // className="overlay trib-session hidden" 里 contains('hidden') 会命中，
      // 但 contains('overlay trib-session') 这类更长的判断就不可靠了。
      const has = (c) => self.className.split(/\s+/).includes(c);
      return {
        contains: has,
        add(c) { if (!has(c)) self.className = (self.className + ' ' + c).trim(); },
        remove(c) { self.className = self.className.split(/\s+/).filter((x) => x && x !== c).join(' '); },
      };
    },
    focus() { this.focused++; DOC.activeElement = this; },
    click() { this.clicked++; },
    contains(n) {
      if (n === this) return true;
      return this.children.some((c) => c.contains(n));
    },
    querySelectorAll(sel) {
      // 本站的选择器含伪类（如 'button:not([disabled])'、'input:not([disabled]):not([type="hidden"])'），
      // 这里先剥掉 :not(...) 再比对标签 —— 只实现本测试用到的匹配，不做通用选择器引擎。
      const want = sel.split(',').map((s) => s.trim().replace(/:not\([^)]*\)/g, '').trim());
      const out = [];
      const match = (node) => want.some((s) => {
        if (s === 'button' && node.tagName === 'BUTTON' && !node.disabled) return true;
        if (s === 'a[href]' && node.tagName === 'A' && node.attrs.href !== undefined) return true;
        if (s === 'input' && node.tagName === 'INPUT' && !node.disabled) return true;
        if (s === 'select' && node.tagName === 'SELECT' && !node.disabled) return true;
        if (s === 'textarea' && node.tagName === 'TEXTAREA' && !node.disabled) return true;
        if (s === '[tabindex]' && node.attrs.tabindex !== undefined
            && node.attrs.tabindex !== '-1') return true;
        return false;
      });
      const walk = (n) => { for (const c of n.children) { if (match(c)) out.push(c); walk(c); } };
      walk(this);
      return out;
    },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
  };
  el.children.forEach((c) => { c.parent = el; });
  return el;
}

/** 抠出公共设施源码（含外层 IIFE），用独立唯一定位符避免误伤其他块 */
const INFRA_MARK = 'var FOCUSABLE =';
function infraSrc() {
  const start = html.indexOf(INFRA_MARK);
  assert.ok(start > 0, '未找到模态层公共设施的 FOCUSABLE 定义');
  // 往前回退到本脚本块的起始 IIFE
  const iife = html.lastIndexOf('(function () {', start);
  assert.ok(iife > 0, '未找到公共设施的 IIFE 起始');
  const end = html.indexOf('})();', start);
  assert.ok(end > start, '未找到公共设施的 IIFE 结束');
  return html.slice(iife, end + 5);
}

/** 载入公共设施源码并返回可驱动的手柄 */
function loadInfra() {
  const src = infraSrc();

  const body = makeEl('body');
  const overlayA = makeEl('div', { id: 'ovA', className: 'overlay hidden', attrs: { role: 'dialog' } });
  const overlayB = makeEl('div', { id: 'ovB', className: 'overlay trib-session hidden', attrs: { role: 'dialog' } });
  const nav = makeEl('div', { id: 'navMenu', className: 'nav-menu', attrs: { role: 'dialog' } });

  // 两个覆盖层各含 3 个按钮
  const btnsA = [0, 1, 2].map((i) => makeEl('button', { id: 'a' + i }));
  const btnsB = [0, 1, 2].map((i) => makeEl('button', { id: 'b' + i }));
  overlayA.children = btnsA; btnsA.forEach((b) => { b.parent = overlayA; });
  overlayB.children = btnsB; btnsB.forEach((b) => { b.parent = overlayB; });

  // B 里放一个 id 以 Close 结尾的关闭按钮（Esc 兜底会点它）
  const closeB = makeEl('button', { id: 'vdClose' });
  btnsB.push(closeB); closeB.parent = overlayB;

  const allDialogs = [nav, overlayA, overlayB];
  DOC.activeElement = null;
  const doc = {
    body,
    get activeElement() { return DOC.activeElement; },
    set activeElement(v) { DOC.activeElement = v; },
    documentElement: { clientWidth: 1000 },
    querySelectorAll(sel) {
      if (sel !== '[role="dialog"]') return [];
      return allDialogs;
    },
    addEventListener(type, fn) { (this._h ||= {}); (this._h[type] ||= []).push(fn); },
    _h: {},
  };
  const getComputedStyle = () => ({ position: 'static' });
  const MutationObserver = class { observe() {} };
  const win = { innerWidth: 1030 };

  new Function('document', 'window', 'getComputedStyle', 'MutationObserver', src)(doc, win, getComputedStyle, MutationObserver);

  return {
    doc, body, overlayA, overlayB, nav, btnsA, btnsB, closeB,
    /** 派发一个 keydown，走我们注册的捕获监听 */
    key(key, opts = {}) {
      const ev = { key, shiftKey: !!opts.shiftKey, preventDefault() { ev.defaultPrevented = true; }, defaultPrevented: false };
      (doc._h.keydown || []).forEach((fn) => fn(ev));
      return ev;
    },
  };
}

/* ---------------- P1-6 焦点循环 ---------------- */

test('覆盖层可见时，Tab 在最后一个与第一个之间回绕', () => {
  const h = loadInfra();
  h.overlayA.classList.remove('hidden');   // 只开 A → topmost() 就是 A
  h.doc.activeElement = h.btnsA[2];       // 焦点在最后一个
  const ev = h.key('Tab');
  assert.ok(ev.defaultPrevented, '末位 Tab 未被接管');
  assert.equal(h.doc.activeElement, h.btnsA[0], '末位 Tab 未回绕到第一个');
});

test('Shift+Tab 在第一个与最后一个之间回绕', () => {
  const h = loadInfra();
  h.overlayA.classList.remove('hidden');
  h.doc.activeElement = h.btnsA[0];       // 最上层覆盖层的第一个
  const ev = h.key('Tab', { shiftKey: true });
  assert.ok(ev.defaultPrevented, '首位 Shift+Tab 未被接管');
  assert.equal(h.doc.activeElement, h.btnsA[2], '首位 Shift+Tab 未回绕到最后一个');
});

test('焦点在遮罩之外时，第一次 Tab 把它拉回层内', () => {
  const h = loadInfra();
  h.overlayA.classList.remove('hidden');
  h.doc.activeElement = h.nav;            // 焦点跑到遮罩外了
  const ev = h.key('Tab');
  assert.ok(ev.defaultPrevented, '未拦截遮罩外的 Tab');
  assert.ok(h.overlayA.contains(h.doc.activeElement), '焦点未被拉回遮罩内');
});

test('没有覆盖层可见时，Tab 完全不介入', () => {
  const h = loadInfra();
  h.doc.activeElement = h.btnsA[0];
  const ev = h.key('Tab');
  assert.equal(ev.defaultPrevented, false, '无覆盖层时不应拦截 Tab');
  assert.equal(h.btnsA[0].focused, 0, '无覆盖层时不应移动焦点');
});

test('导航抽屉不被重复接管（它有自己的 Esc/Tab 处理）', () => {
  const h = loadInfra();
  h.nav.classList.add('open');
  h.doc.activeElement = h.nav;            // nav 内无可聚焦元素的替身
  const ev = h.key('Tab');
  assert.equal(ev.defaultPrevented, false, 'navMenu 应交还给它自己的处理器');
});

/* ---------------- P1-7 背景滚动锁 ---------------- */

test('滚动锁写入 overflow:hidden 且补偿滚动条宽度', () => {
  // 真跑一遍：用一个会立即回调的 MutationObserver 替身
  const src = infraSrc();

  const body = makeEl('body');
  const ov = makeEl('div', { id: 'ov', className: 'overlay hidden', attrs: { role: 'dialog' } });
  ov.children = [makeEl('button')];
  const doc = {
    body,
    activeElement: null,
    documentElement: { clientWidth: 1000 },
    querySelectorAll: (s) => (s === '[role="dialog"]' ? [ov] : []),
    addEventListener() {},
  };
  // 记录观察目标：属性变化时立刻回调，等价于真实的异步通知
  let observerCb = null;
  const MutationObserver = class {
    constructor(cb) { observerCb = cb; }
    observe() {}
  };
  new Function('document', 'window', 'getComputedStyle', 'MutationObserver', src)(
    doc, { innerWidth: 1030 }, () => ({ position: 'static' }), MutationObserver);

  assert.equal(body.style.overflow, undefined, '初始不应锁定');
  ov.classList.remove('hidden');
  observerCb();
  assert.equal(body.style.overflow, 'hidden', '覆盖层打开未锁滚动');
  assert.equal(body.style.paddingRight, '30px', '未补偿滚动条宽度（1030-1000=30）');

  ov.classList.add('hidden');
  observerCb();
  assert.equal(body.style.overflow, '', '覆盖层关闭未解锁');
  assert.equal(body.style.paddingRight, '', '关闭后未还原内边距');
});

test('浮层套浮层：内层关闭不解锁（外层仍可见）', () => {
  const src = infraSrc();

  const body = makeEl('body');
  const outer = makeEl('div', { id: 'outer', className: 'overlay hidden', attrs: { role: 'dialog' } });
  const inner = makeEl('div', { id: 'inner', className: 'overlay hidden', attrs: { role: 'dialog' } });
  outer.children = [makeEl('button')];
  inner.children = [makeEl('button')];
  const doc = {
    body, activeElement: null,
    documentElement: { clientWidth: 1000 },
    querySelectorAll: (s) => (s === '[role="dialog"]' ? [outer, inner] : []),
    addEventListener() {},
  };
  let cb = null;
  const MutationObserver = class { constructor(f) { cb = f; } observe() {} };
  new Function('document', 'window', 'getComputedStyle', 'MutationObserver', src)(
    doc, { innerWidth: 1000 }, () => ({ position: 'static' }), MutationObserver);

  outer.classList.remove('hidden');
  inner.classList.remove('hidden');
  cb();
  assert.equal(body.style.overflow, 'hidden', '双层打开应锁定');

  inner.classList.add('hidden');          // 只关内层
  cb();
  assert.equal(body.style.overflow, 'hidden', '内层关闭却解了锁 —— 外层还开着');

  outer.classList.add('hidden');          // 关外层
  cb();
  assert.equal(body.style.overflow, '', '全部关闭后应解锁');
});

/* ---------------- 静态结构 ---------------- */

test('公共设施只加能力不改既有开关逻辑', () => {
  // 各覆盖层仍用自己的 classList/close 函数，本设施只在旁观察
  assert.ok(html.includes('var FOCUSABLE'), '缺 FOCUSABLE 选择器');
  assert.ok(html.includes("attributeFilter: ['class', 'hidden']"), '未观察 class/hidden 变化');
  // 焦点归位刻意不做：10 个覆盖层的 close 各自已经做了
  assert.ok(!html.includes('__dialogLock'), '不应再引入手动解锁入口');
});