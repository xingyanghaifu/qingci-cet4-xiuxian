/**
 * 控件可访问名 + 站内确认弹层（P1-8）
 *
 * 审计原文：「13 个输入框标签 + 12 个 select 的可访问名」「4 个 confirm()」。
 * 实测：31 个静态表单控件里 13 个确实缺可访问名（审计数字准确）。
 * 另有一处统计陷阱：11 个控件被**隐式 <label>** 包住，脚本若只认 label[for]
 * 会把它们误判成缺失 —— 本测试用同样的判定口径，避免"加了多余的 aria-label"。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const html = readFileSync(join(ROOT, 'src', 'index.template.html'), 'utf8');
const dist = readFileSync(join(ROOT, 'dist', 'index.html'), 'utf8');

/** 与产品同口径的判定：显式 label[for] / 隐式 <label> / aria-label 三者之一 */
function auditControls(src) {
  const labelSpans = [];
  for (const m of src.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/g)) {
    labelSpans.push({ start: m.index, end: m.index + m[0].length });
  }
  const labelFors = new Set([...src.matchAll(/<label[^>]*\bfor="([^"]+)"/g)].map((m) => m[1]));

  const missing = [];
  let total = 0;
  for (const m of src.matchAll(/<(input|select|textarea)\b[^>]*>/g)) {
    const tag = m[0];
    const type = (tag.match(/\btype="([^"]+)"/) || [])[1] || '';
    if (m[1] === 'input' && type === 'hidden') continue;   // type=hidden 本就不该有名字
    if (/aria-hidden="true"/.test(tag)) continue;            // 蜜罐：故意不给
    if (/class="[^"]*\bhidden\b/.test(tag)) continue;        // display:none，不在无障碍树
    total++;
    const id = (tag.match(/\bid="([^"]+)"/) || [])[1] || '';
    const explicit = !!labelFors.has(id);
    const implicit = labelSpans.some((s) => m.index > s.start && m.index < s.end);
    const aria = /aria-label(?:ledby)?="[^"]+"/.test(tag);
    if (!(explicit || implicit || aria)) missing.push(id || '(无 id)');
  }
  return { total, missing };
}

/* ---------------- 可访问名 ---------------- */

test('所有可见表单控件都有可访问名', () => {
  const { total, missing } = auditControls(html);
  assert.deepEqual(missing, [], `这些控件没有可访问名：${missing.join(', ')}`);
  // —— 为什么是 29 而不是 17（2026-10-07 修正）——
  // 原来这里是 17。当时 12 个控件的标记被写成了畸形形态：
  //     <aria-label="…" input id="q" …>      ← 属性跑到标签名前面
  // 本函数的扫描器用的是 /<(input|select|textarea)\b[^>]*>/，
  // 而畸形标签的**第一个 token 是 aria-label**，所以 12 个控件**一个都没被扫到** ——
  // 测试因此「绿着」放过了「控件根本不存在」这个更严重的问题。
  //
  // 修复标签顺序后，扫描器终于能看见它们：17 + 12 = 29。
  // 数字变化本身就是修复的证据。标签结构另有 tests/markup-structure.test.mjs 专门守。
  assert.equal(total, 29, `控件总数变化（期望 29），请核对是否新增/删除了控件`);
});

test('本轮补的 13 个控件都在（防止有人删了 aria-label 而测试还绿）', () => {
  const ADDED = {
    memKindSel: '背词题型', essay: '作文正文', spellInput: '按记忆拼写单词',
    speakNote: '口述提纲', q: '搜索单词或中文释义', letter: '按首字母筛选',
    mastery: '按掌握度筛选', dao: '道号', pool: '题型池', groupNick: '道场昵称',
    groupCode: '道场邀请码', feedbackDesc: '反馈内容',
  };
  for (const [id, name] of Object.entries(ADDED)) {
    const tag = (html.match(new RegExp(`<[^>]*id="${id}"[^>]*>`)) || [])[0];
    assert.ok(tag, `${id} 未找到`);
    assert.ok(tag.includes(`aria-label="${name}"`),
      `${id} 的 aria-label 不是「${name}」：${tag.slice(0, 90)}`);
  }
});

test('听写输入框（动态拼接）也带上了 aria-label', () => {
  // 它在 innerHTML 字符串里，不是静态标签 —— 静态扫描扫不到，必须单独断言
  assert.ok(html.includes('aria-label="听写第 \''), '听写输入框缺 aria-label');
  assert.ok(html.includes('aria-label="比对第 \''), '听写「比对」按钮缺 aria-label');
});

test('隐式 label 的控件不被重复加 aria-label（保持视觉与语义一致）', () => {
  // dailyTarget 等控件本来就由 <label>…</label> 提供名字，
  // 再加 aria-label 反而会**覆盖**可见标签文本，读屏读到的和眼睛看到的不一致。
  for (const id of ['dailyTarget', 'planExamDate', 'audioRate', 'themeSel', 'aiConsent', 'intensiveRate']) {
    const tag = (html.match(new RegExp(`<[^>]*id="${id}"[^>]*>`)) || [])[0] || '';
    assert.ok(!/aria-label=/.test(tag), `${id} 已有隐式 label，不该再加 aria-label`);
  }
});

/* ---------------- 站内确认弹层 ---------------- */

test('六处原生 confirm 全部换成站内弹层', () => {
  // 审计说 4 处，实测是 6 处：模板里 4 处 + 服务层 audio-sources.ts 里 2 处
  // （"该音频需要联网下载，是否立即下载？"）。后者打包进独立的服务层 bundle，
  // 只扫模板发现不了 —— 我是核对产物时才发现审计少算了这两处。
  const all = [...html.matchAll(/confirm\s*\(/g)];
  // 模板里允许剩 1 处：askConfirm 的降级兜底（弹层 DOM 不在时）
  assert.equal(all.length, 1, `模板里期望只剩 1 处降级兜底，实际 ${all.length} 处`);
  const ctx = all.map((m) => html.slice(Math.max(0, m.index - 60), m.index + 30));
  assert.ok(ctx.some((c) => c.includes('if (!askEl) return Promise.resolve(window.confirm(text))')),
    'askConfirm 的降级兜底不见了');

  // 服务层里另有 1 处降级兜底（在 minify 后的 bundle 里；注意 minify 后没有空格）
  const svcHits = [...dist.matchAll(/confirm\s*\(/g)];
  assert.equal(svcHits.length, 2, `产物里的 confirm 应为 2 处降级兜底（模板 1 + 服务层 1），实际 ${svcHits.length}`);
  // 服务层的兜底判断在 minify 后是 `typeof window.confirm!=="function"?!0:...`，
  // 但它被嵌在 HTML 的 script 字符串里，原始文件里引号是转义的（\"）。
  assert.ok(/typeof window\.confirm\s*!?==?\s*\\?"function\\?"/.test(dist),
    '服务层 confirmDownload 的降级兜底不见了');
  // 服务层确认必须走 askConfirm，且先问后下
  assert.ok(dist.includes('askConfirm'), '服务层没用 askConfirm');
  assert.ok(dist.includes('已取消下载，继续使用语音合成'), '服务层没有取消分支');

  for (const [label, needle] of [
    ['提前交卷', "{title:'提前交卷'}"],
    ['继续上次模考', "{title:'继续上次模考'}"],
    ['切换词库', "{ title: '切换词库' }"],
    ['散功', '散功（清空本机数据）'],
  ]) assert.ok(html.includes(needle), `${label} 未换`);
});

test('确认弹层不会把 Promise 当同步布尔用', () => {
  // 这是本轮真实踩到的坑：askConfirm 返回 Promise，
  // `!askConfirm(...)` 恒为 false（提前交卷会跳过确认），
  // `if (askConfirm(...))` 恒为 true（取消无效）。
  assert.equal((html.match(/!\s*window\.askConfirm\(/g) || []).length, 0, '有 !askConfirm(...) 当布尔用');
  assert.equal((html.match(/if\s*\(\s*window\.askConfirm\(/g) || []).length, 0, '有 if (askConfirm(...)) 当布尔用');
  // 模板里四处调用点后面都必须紧跟 .then（允许中间换行）
  const sites = [...html.matchAll(/window\.askConfirm\(/g)].filter((m) => {
    const seg = html.slice(m.index, m.index + 600);
    return /\.then\s*\(/.test(seg);
  });
  assert.equal(sites.length, 4, `期望 4 处 .then 续接，实际 ${sites.length}`);
});

test('prepareTrack 没被改成 async（否则真实音频静默失效）', () => {
  // 模板 open() 同步读 via.text / via.track；若服务层改 async，
  // via 会是 Promise，via.text 恒为 undefined —— 不报错，只是没声音。
  const svc = readFileSync(join(ROOT, 'src', 'services', 'audio-sources.ts'), 'utf8');
  const i = svc.indexOf('export function prepareTrack');
  assert.ok(i > 0, 'prepareTrack 未找到');
  const head = svc.slice(i, svc.indexOf('{', i) + 1);
  assert.ok(!head.includes('async'), 'prepareTrack 被改成了 async —— via.text 会恒为 undefined');
  // 确认要放到后台，且下载在确认之后才发生
  const body = svc.slice(i, svc.indexOf('\n}', i));
  assert.ok(body.includes('void confirmDownload().then('), 'prepareTrack 里没有走 confirmDownload');
  const ci = body.indexOf('void confirmDownload().then(');
  const di = body.indexOf('downloadAudio(src)');
  assert.ok(ci >= 0 && di > ci, '下载必须发生在确认之后');
});

test('确认弹层自身有可访问名与模态语义', () => {
  const tag = (html.match(/<div[^>]*id="askOverlay"[^>]*>/) || [])[0];
  assert.ok(tag, '#askOverlay 未插入');
  assert.ok(tag.includes('role="dialog"'), '缺 role=dialog');
  assert.ok(tag.includes('aria-modal="true"'), '缺 aria-modal');
  assert.ok(tag.includes('aria-labelledby="askTitle"'), '缺 aria-labelledby');
  assert.ok(tag.includes('aria-describedby="askText"'), '缺 aria-describedby');
  // 按钮用 type=button，避免在表单里触发提交
  assert.equal((html.match(/id="askOk"[^>]*type="button"|type="button"[^>]*id="askOk"/g) || []).length, 1);
});

test('散功确认把后果与不可撤销说清楚', () => {
  const i = html.indexOf('散功（清空本机数据）');
  assert.ok(i > 0, '散功确认文案缺失');
  // 「不可撤销」在 msg 里但用了双引号包裹的整段，往前多取一点
  const seg = html.slice(i - 200, i + 260);
  assert.ok(seg.includes('此操作不可撤销'), '未说明不可撤销');
  assert.ok(seg.includes('localStorage.removeItem'), '散功逻辑丢了');
  assert.ok(seg.includes('已取消散功'), '取消后没有反馈');
});

test('确认弹层接上了 Esc/Enter 与焦点归位', () => {
  // Esc/Enter 处理器写在 askConfirm **之前**，焦点归位在 settleAsk 里，
  // 所以不能只截 askConfirm 那一段。
  const okBtn = html.indexOf("askOk.addEventListener('click'");
  const askFn = html.indexOf('window.askConfirm = function');
  const settle = html.indexOf('function settleAsk');
  assert.ok(okBtn > 0 && askFn > okBtn && settle > 0, 'askConfirm 三件套结构不对');

  const keydown = html.slice(okBtn, askFn);
  assert.ok(keydown.includes("e.key === 'Escape'"), 'Esc 未接');
  assert.ok(keydown.includes('settleAsk(false)'), 'Esc 未走取消');
  assert.ok(keydown.includes("e.key === 'Enter'"), 'Enter 未接');
  assert.ok(keydown.includes('settleAsk(true)'), 'Enter 未走确定');

  const settleBody = html.slice(settle, settle + 460);
  assert.ok(settleBody.includes('askPrevFocus.focus'), 'settleAsk 里没有焦点归位');
  assert.ok(settleBody.includes('askResolve = null'), 'settleAsk 没有清理 resolve');
});

/* ---------------- dist 同步 ---------------- */

test('产物与源同步（本轮改动都进包了）', () => {
  for (const needle of [
    'id="askOverlay"', 'window.askConfirm', 'aria-label="道场邀请码"',
    'aria-label="听写第 ', '散功（清空本机数据）',
  ]) assert.ok(dist.includes(needle), `产物缺 ${needle}`);
});

test('role="dialog" 增至 12（新增 #askOverlay），其余语义未动', () => {
  const ids = [...html.matchAll(/<div[^>]*role="dialog"[^>]*>/g)]
    .map((m) => (m[0].match(/id="([^"]+)"/) || [])[1]);
  assert.equal(ids.length, 12);
  assert.ok(ids.includes('askOverlay'), '新增的确认弹层不在 dialog 列表里');
  // 原有的 11 个必须都在（不能被这轮改掉）
  for (const id of ['navMenu', 'tribOverlay', 'tribRulesOverlay', 'tribConfirmOverlay',
    'breakthroughOverlay', 'feedbackOverlay', 'intensiveOverlay', 'vdOverlay',
    'audioSrcOverlay', 'shopPickOverlay', 'assessOverlay']) {
    assert.ok(ids.includes(id), `原有 dialog ${id} 丢了`);
  }
  assert.equal((html.match(/role="tab"/g) || []).length, 9, 'role="tab" 必须仍 9 个');
});

/* ---------------- P1-9: <h1> 可访问名仅当前模块 ---------------- */

test('<h1 id="mainTitle"> 仅有一个 aria-hidden="false"（当前模块）', () => {
  // 模板里必须只有 1 个 aria-hidden="false"（默认 paper），其余 8 个为 true
  const h1Start = html.indexOf('<h1 id="mainTitle"');
  assert.ok(h1Start >= 0, '找不到 <h1 id="mainTitle">');
  const h1End = html.indexOf('</h1>', h1Start);
  const h1 = html.slice(h1Start, h1End + 5);
  const falseCount = (h1.match(/aria-hidden="false"/g) || []).length;
  const trueCount = (h1.match(/aria-hidden="true"/g) || []).length;
  assert.equal(falseCount, 1, '应有且仅有 1 个 aria-hidden="false"，实际 ' + falseCount);
  assert.equal(trueCount, 8, '应有 8 个 aria-hidden="true"，实际 ' + trueCount);
});

/* 运行时口径：把真实 switchTab 抠出来，配假 DOM 跑一遍。
   静态正则证明不了映射对不对 —— trial 面板要按 words/single 分叉，
   写错一个分支就会把 9 个 span 全设成 aria-hidden="true"，
   此时 <h1> 在无障碍树里彻底没有名字（比修复前更糟）。 */
const MT_MODULES = ['paper', 'words', 'single', 'speak', 'book', 'codex', 'map', 'duel', 'field'];

function bootH1(paperVal = null) {
  const spans = MT_MODULES.map((m) => ({
    dataset: { m },
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
  }));
  const tabs = [
    { dataset: { tab: 'paper' } },
    { dataset: { tab: 'trial', mode: 'words' } },
    { dataset: { tab: 'trial' } },
    { dataset: { tab: 'speak' } }, { dataset: { tab: 'book' } }, { dataset: { tab: 'codex' } },
    { dataset: { tab: 'map' } }, { dataset: { tab: 'duel' } }, { dataset: { tab: 'field' } },
  ].map((b) => {
    b.on = false;
    b.classList = { toggle(c, v) { if (c === 'on') b.on = !!v; } };
    b.setAttribute = () => {};
    return b;
  });

  const panels = {};
  const document = {
    querySelectorAll(sel) {
      if (sel === '.tabs button') return tabs;
      if (sel === '#mainTitle .mt') return spans;
      return [];
    },
  };
  const noop = () => {};
  // 记录面板 .hidden 状态，供 CSS :has() 规则求值用
  const $ = (elId) => ({
    classList: { toggle(c, v) { if (c === 'hidden' && elId.startsWith('panel-')) panels[elId.slice(6)] = !!v; } },
    textContent: '',
  });

  const start = html.indexOf('function switchTab(name,srcBtn){');
  const endMark = 'syncRoute(name); }';
  const end = html.indexOf(endMark, start) + endMark.length;
  assert.ok(start >= 0 && end > endMark.length, '未定位到 switchTab 源码');
  const src = html.slice(start, end);

  const state = { pool: 'words' };
  const switchTab = new Function(
    'document', '$', 'state', 'paper', 'syncRoute',
    'renderBook', 'renderCodex', 'renderMap', 'renderShop', 'renderSpeak',
    'renderShelf', 'renderDuel', 'window',
    src + '\nreturn switchTab;',
  )(document, $, state, paperVal, noop, noop, noop, noop, noop, noop, noop, noop, {});

  return {
    switchTab, state, tabs, panels,
    /** 无障碍树里 <h1> 的实际可访问名 = 未被 aria-hidden 的 span 文本拼接 */
    accessibleName() {
      return spans.filter((s) => s.attrs['aria-hidden'] !== 'true')
        .map((s) => s.dataset.m).join(' ');
    },
    exposed() { return spans.filter((s) => s.attrs['aria-hidden'] === 'false').map((s) => s.dataset.m); },
  };
}

/** 直接从模板里真实的 :has() 规则解析出「当前哪个 .mt 可见」——
    与 switchTab 的 aria-hidden 是两条互不依赖的路径，必须给出同一答案。 */
function cssVisibleModule(panels, tabs) {
  const rules = [...html.matchAll(
    /\.app:has\(#panel-([a-z]+):not\(\.hidden\)\)([^{]*)\{display:inline\}/g)];
  const shown = [];
  for (const [, panelId, cond] of rules) {
    if (panels[panelId] !== false) continue;              // 该面板不可见
    const m = cond.match(/\.mt\[data-m="([a-z]+)"\]/);
    if (!m) continue;
    if (cond.includes('[data-mode="words"]')) {
      if (tabs.some((t) => t.dataset.tab === 'trial' && t.on && t.dataset.mode === 'words')) shown.push(m[1]);
    } else if (cond.includes(':not([data-mode])')) {
      if (tabs.some((t) => t.dataset.tab === 'trial' && t.on && !t.dataset.mode)) shown.push(m[1]);
    } else if (cond.includes(':has(.tabs')) {
      // 依赖按钮 .on 的规则上面已单独处理，这里跳过
    } else {
      shown.push(m[1]);
    }
  }
  return shown;
}

test('交叉验证：CSS :has() 判定的可见标题 == switchTab 暴露给读屏的标题', () => {
  // 两条独立路径必须收敛到同一个模块：
  //   · CSS  :has(#panel-X:not(.hidden)) .mt[data-m=Y]{display:inline}
  //   · JS   switchTab 设 aria-hidden="false"
  // 只测其中一条都可能漏掉「看得见却读不到」或反之。
  const app = bootH1();
  const cases = [['paper'], ['speak'], ['book'], ['codex'], ['map'], ['duel'], ['field']];
  for (const [m] of cases) {
    app.switchTab(m);
    const css = cssVisibleModule(app.panels, app.tabs);
    assert.deepEqual(css, app.exposed(),
      `切到 ${m}：CSS 判定可见 ${css}，读屏暴露 ${app.exposed()} —— 两条路径脱钩`);
  }

  app.state.pool = 'words';
  app.switchTab('trial');
  assert.deepEqual(cssVisibleModule(app.panels, app.tabs), app.exposed(),
    'trial(words)：CSS 与读屏脱钩');

  app.state.pool = 'wrong';
  app.switchTab('trial');
  assert.deepEqual(cssVisibleModule(app.panels, app.tabs), app.exposed(),
    'trial(single)：CSS 与读屏脱钩');
});

test('运行时：切每个模块后 <h1> 只暴露 1 个模块名（修复前是 9 个连读）', () => {
  const app = bootH1();
  for (const m of ['paper', 'speak', 'book', 'codex', 'map', 'duel', 'field']) {
    app.switchTab(m);
    assert.deepEqual(app.exposed(), [m], `切到 ${m} 后可访问名应为 ${m}，实际 ${app.exposed().join('+')}`);
  }
});

test('运行时：trial 面板按 words / single 分叉，不会两边都不亮', () => {
  const app = bootH1();
  app.state.pool = 'words';
  app.switchTab('trial');
  assert.deepEqual(app.exposed(), ['words'], 'words 池下应暴露「背单词」');

  app.state.pool = 'wrong';           // 非 words 池 → 单题
  app.switchTab('trial');
  assert.deepEqual(app.exposed(), ['single'], '非 words 池下应暴露「单题」');
});

test('运行时：显式传 srcBtn 时以按钮为准（与 .on 消歧同源）', () => {
  const app = bootH1();
  app.state.pool = 'words';
  app.switchTab('trial', { dataset: { tab: 'trial' } });          // 单题按钮
  assert.deepEqual(app.exposed(), ['single'], '点单题按钮应暴露「单题」');
  app.switchTab('trial', { dataset: { tab: 'trial', mode: 'words' } });
  assert.deepEqual(app.exposed(), ['words'], '点背单词按钮应暴露「背单词」');
});

test('运行时：任何一次切换都恰好留 1 个模块可读（绝不出现 0 个或 9 个）', () => {
  const app = bootH1();
  for (const m of [...MT_MODULES.slice(0, 1), 'speak', 'book', 'codex', 'map', 'duel', 'field', 'trial']) {
    app.switchTab(m);
    assert.equal(app.exposed().length, 1, `切到 ${m} 后可读模块数应为 1，实际 ${app.exposed().length}`);
    assert.equal(app.accessibleName().split(' ').length, 1,
      `切到 ${m} 后 <h1> 可访问名成了「${app.accessibleName()}」`);
  }
});

test('运行时：模考进行中（paper 非空）时 trial 归到「单题」', () => {
  // switchTab 里 trial 的消歧条件是 `state.pool==="words" && !paper`：
  // 模考期间即使 pool 是 words，按钮也不亮 —— 标题必须跟着按钮走，
  // 否则会出现「按钮显示单题、标题却读背单词」的不一致。
  const app = bootH1({ queue: [], cursor: 0 });
  app.state.pool = 'words';
  app.switchTab('trial');
  assert.deepEqual(app.exposed(), ['single'], '模考进行中应暴露「单题」');
  assert.deepEqual(cssVisibleModule(app.panels, app.tabs), ['single'],
    '模考进行中 CSS 也应是「单题」');
});

test('降级 CSS 与可访问名同源：都由 aria-hidden="false" 驱动可见性', () => {
  // 旧降级是 9 个标题全显 + · 分隔：屏幕上看得见 9 个，
  // 若只给 8 个加 aria-hidden 就成了「看得见却读不到」（ARIA 大忌）。
  // 现在两者是同一个属性，本测试锁死 CSS 侧不放行别的写法。
  const i = html.indexOf('@supports not selector(:has(*))');
  assert.ok(i > 0, '找不到 @supports not selector(:has(*)) 降级块');
  const close = html.indexOf('.mh-actions', i);
  const block = html.slice(i, html.indexOf('}', close) + 1).replace(/\s/g, '');
  assert.ok(block.includes('.mt[aria-hidden="false"]{display:inline}'),
    '降级块应由 .mt[aria-hidden="false"] 驱动可见性，实际：' + block);
  assert.ok(!/\.mt\{display:inline\}/.test(block),
    '降级块仍在无条件显示全部 .mt（9 个标题会连读）');
  assert.ok(!/\.mt\+\.mt:before/.test(block),
    '降级块仍在用 · 连接 9 个标题（读屏会连读成一句）');
});

test('产物中 <h1> 同样仅 1 个 aria-hidden="false"', () => {
  const h1Start = dist.indexOf('<h1 id="mainTitle"');
  assert.ok(h1Start >= 0, '产物里找不到 <h1 id="mainTitle">');
  const h1End = dist.indexOf('</h1>', h1Start);
  const h1 = dist.slice(h1Start, h1End + 5);
  const falseCount = (h1.match(/aria-hidden="false"/g) || []).length;
  const trueCount = (h1.match(/aria-hidden="true"/g) || []).length;
  assert.equal(falseCount, 1, '产物应有且仅有 1 个 aria-hidden="false"，实际 ' + falseCount);
  assert.equal(trueCount, 8, '产物应有 8 个 aria-hidden="true"，实际 ' + trueCount);
});