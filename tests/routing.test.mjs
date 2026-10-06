/**
 * 深链路由 · 运行时行为测试（v1.9.1 SEO 批次，P0-4）
 *
 * 背景：审计实测 pushState / hashchange / popstate / location.hash 全部为 0 次，
 * 而 switchTab() 有 23 处调用 —— 意味着「在背单词点返回会直接退出应用」，
 * 且无法收藏/分享任何模块。
 *
 * 这里**不**只做字符串断言：把 switchTab → syncRoute → routeFromHash → routeBoot
 * 这段真实源码抠出来，配假 DOM / 假 location 真跑一遍。理由是路由的坑全在运行时：
 * 死循环、历史记录被污染、非法 hash 把界面切走 —— 这些静态正则一个都测不出来。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const html = readFileSync(join(import.meta.dirname, '..', 'src', 'index.template.html'), 'utf8');
const TABS = ['paper', 'trial', 'speak', 'book', 'codex', 'map', 'duel', 'field'];

/** 起一个最小运行环境，注入真实路由源码 */
function boot(startHash) {
  const app = { hash: startHash, hashEvents: 0, historyOps: [] };
  const panels = Object.fromEntries(TABS.map((id) => [id, { hidden: true }]));

  // switchTab 的真实写法：
  //   ["paper",...].forEach(id => $("panel-"+id).classList.toggle("hidden", id !== name))
  // on 参数即「要不要 hidden」；可见面板 = 唯一 hidden=false 的那个。
  const $ = (elId) => ({
    classList: {
      toggle(_c, on) { if (elId.startsWith('panel-')) panels[elId.slice(6)].hidden = !!on; },
    },
  });
  const document = { querySelectorAll: () => [] };
  const noop = () => {};
  const location = {
    pathname: '/', search: '',
    get hash() { return app.hash; },
    set hash(v) {
      if (app.hash === v) return;           // 同值不触发 hashchange
      app.hash = v;
      app.hashEvents++;
      win.handlers.hashchange.forEach((f) => f());
    },
    replace(url) {
      app.historyOps.push(['replace', url]);
      app.hash = '#' + (String(url).split('#')[1] || '');
    },
  };
  const win = {
    handlers: { hashchange: [] },
    addEventListener(t, f) { if (t === 'hashchange') win.handlers.hashchange.push(f); },
  };

  const start = html.indexOf('function switchTab(name,srcBtn){');
  const end = html.indexOf('})();', html.indexOf('function routeBoot()')) + 5;
  assert.ok(start >= 0 && end > 5, '未定位到路由源码 —— switchTab/routeBoot 结构变了？');
  const src = html.slice(start, end);

  const api = new Function(
    'location', 'document', 'window', '$', 'TABS', 'state', 'paper',
    'renderBook', 'renderCodex', 'renderMap', 'renderShop', 'renderSpeak',
    'renderShelf', 'renderDuel',
    src + '\nreturn { switchTab, syncRoute, routeFromHash };',
  )(location, document, win, $, TABS, { pool: 'words' }, null,
    noop, noop, noop, noop, noop, noop, noop);

  Object.defineProperty(app, 'visible', {
    get() {
      const shown = TABS.filter((id) => panels[id].hidden === false);
      return shown.length === 1 ? shown[0] : (shown.length ? shown.join('+') : null);
    },
  });
  app.api = api;
  app.set = (h) => { app.hash = h; win.handlers.hashchange.forEach((f) => f()); };
  return app;
}

test('分享链接直达：#/book 直接进心魔本', () => {
  const a = boot('#/book');
  assert.equal(a.visible, 'book');
});

test('无 hash 落默认模块，并把地址栏补成 #/paper', () => {
  const a = boot('');
  assert.equal(a.visible, 'paper');
  // 用 replace 而非赋值：首次落地不该凭空多出一条历史，
  // 否则用户按「后退」只会退回「同一页面的空 hash」，看起来像按钮失灵
  assert.deepEqual(a.historyOps, [['replace', '/#/paper']]);
});

test('前进 / 后退有效：hashchange 能把面板切回去', () => {
  const a = boot('#/paper');
  a.api.switchTab('duel');
  assert.equal(a.hash, '#/duel', 'switchTab 未同步 URL');
  a.api.switchTab('trial');
  a.set('#/paper');                                  // 模拟「后退」
  assert.equal(a.visible, 'paper');
  a.set('#/duel');                                   // 模拟「前进」
  assert.equal(a.visible, 'duel');
});

test('非法 / 空 hash 保持当前模块，不把界面切走', () => {
  const a = boot('#/codex');
  a.set('#/nonexistent');
  assert.equal(a.visible, 'codex');
  a.set('');
  assert.equal(a.visible, 'codex');
});

test('无死循环：hashchange 回放不得再写回 hash', () => {
  const a = boot('#/paper');
  const before = a.hashEvents;
  a.api.switchTab('map');          // 写 hash → 触发 hashchange → 回放 switchTab
  assert.equal(a.hashEvents, before + 1, 'hashchange 自触发，死循环');
  assert.equal(a.visible, 'map');
  assert.equal(a.hash, '#/map');
});

test('非模块名不写 URL（清场复位等场景不污染地址栏）', () => {
  const a = boot('#/paper');
  a.api.switchTab('not-a-tab');
  assert.equal(a.hash, '#/paper');
});

test(`全部 ${TABS.length} 个模块 hash 均可直达`, () => {
  const bad = [];
  for (const id of TABS) {
    const a = boot('#/' + id);
    if (a.visible !== id) bad.push(`#/${id} → ${a.visible}`);
  }
  assert.deepEqual(bad, []);
});

test('路由挂在 switchTab 收口，全站 23 处调用点自动生效', () => {
  // 不逐个改调用点是这个方案的全部意义 —— 漏一处就等于该处深链失效且无人察觉
  const sw = html.match(/function switchTab\(name,srcBtn\)\{[\s\S]*?syncRoute\(name\); \}/);
  assert.ok(sw, 'switchTab 末尾未调 syncRoute');
  assert.ok(html.includes("window.addEventListener('hashchange'"), '缺 hashchange 监听');
  assert.ok(html.includes('let ROUTE_SILENT = false'), '缺 ROUTE_SILENT 抑制位');
});