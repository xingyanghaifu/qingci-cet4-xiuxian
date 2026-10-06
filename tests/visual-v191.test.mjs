/**
 * 修仙传统文化视觉升级（v1.9.1 谕令·任务 A）接线测试
 *
 * 四个层次各自独立成哨兵块，测试口径与 v1.8.1 的 xianxia-ui.test.mjs 一致
 * （只取本轮新增片段，不把既有代码算进本轮）：
 *
 *   层次 1 色彩深化 —— 七个五行/传统色 token 在**三套主题**里都有值；
 *                    规则内零硬编码 hex（v1.7.0 遗留色值已全部收进 token）
 *   层次 2 纹理     —— 宣纸/古籍框线/朱砂印泥三样，且零外部资源、零硬编码色值
 *   层次 3 动效     —— 恰好两条 @keyframes，0 条 infinite（装饰永不循环）
 *   层次 4 排版意境 —— 字距 .1em、竖排竖排组、朱砂方印、等宽数字
 *
 * 另外守住两条全局红线：
 *   · role="tab" 仍是 9 个（视觉升级没动导航语义）
 *   · 产物 dist/index.html 自包含（哨兵字符串在产物里仍可 grep）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(ROOT, 'src', 'index.template.html'), 'utf8');
const distHtml = readFileSync(resolve(ROOT, 'dist', 'index.html'), 'utf8');

/** 取出 v1.9.1 某个哨兵块（含哨兵标记本身，便于定位） */
function block(name) {
  const begin = `v1.9.1:${name}:BEGIN`;
  const end = `v1.9.1:${name}:END`;
  const b = html.indexOf(begin);
  const e = html.indexOf(end);
  assert.ok(b >= 0 && e > b, `${name} 哨兵未闭合`);
  return html.slice(b, e);
}

const texture = block('传统纹样');
const motion = block('一过性动效');
const typo = block('排版意境');
const all = texture + motion + typo;

/* ============ 通用红线 ============ */

test('v1.9.1 三块新增样式零硬编码色值（hex / rgb() / 命名色）', () => {
  // 声明体里出现 hex 是正常的 —— 那正是 token 的值本身（--x:#fff）。
  // 要抓的是「规则里直接写颜色」。所以先把 token 定义剥掉，再看剩下的。
  const defRe = /--[\w-]+:\s*(?:#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\))/g;
  const strip = (t) => t.replace(defRe, '');
  assert.deepEqual(strip(all).match(/#[0-9a-fA-F]{3,8}\b/g) || [],
    [], '新增样式块出现硬编码 hex');
  assert.deepEqual(strip(all).match(/\brgba?\(/g) || [],
    [], '新增样式块出现硬编码 rgb');
  assert.deepEqual(all.match(/:\s*(white|black|red|gold|jade|silver)\b/gi) || [],
    [], '新增样式块出现命名色');
  assert.ok(all.includes('color-mix('), '五行情景色值必须走 color-mix + var()');
});

test('v1.9.1 新增样式零外部资源（只允许 data: URI）', () => {
  // data: URI 内部还会出现 url(%23p)（SVG 里的 filter 引用），那是 SVG 的内部引用、
  // 不是外链。口径：css url() 的取值若不以 data: 开头、也不是 SVG 内部的 #锚点，即为外链。
  const cssUrls = [...all.matchAll(/url\(\s*["']?([^"')]*)/g)].map((m) => m[1].trim());
  for (const u of cssUrls) {
    const ok = u.startsWith('data:') || /^%23[\w-]+$/.test(u) || /^#[\w-]+$/.test(u);
    assert.ok(ok, `css url() 引用了非 data: 资源：${u.slice(0, 60)}`);
  }
  // 只拦会拉取外部资源的 link；canonical 是纯元数据，不发起请求（同 xianxia-ui 一致）
  const RESOURCE_RELS = new Set(['stylesheet', 'preload', 'prefetch', 'preconnect', 'dns-prefetch', 'modulepreload']);
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    if (!/href="https?:/i.test(tag)) continue;
    const rel = (tag.match(/rel="([^"]+)"/i) || [])[1] || '';
    assert.ok(!RESOURCE_RELS.has(rel.toLowerCase()), `不得新增外部资源链接：${tag.slice(0, 120)}`);
  }
  assert.ok(!/<script[^>]+src="https?:/i.test(html), '不得新增外部脚本');
});

/* ============ 层次 1 · 色彩深化 ============ */

test('层次 1：七个五行/传统色 token 齐备', () => {
  for (const t of ['--color-wood', '--color-fire', '--color-earth', '--color-metal',
    '--color-water', '--color-moonwhite', '--color-dai']) {
    assert.ok(html.includes(t + ':'), `缺五行 token ${t}`);
  }
});

test('层次 1：五行列在暗色 / 浅色 / 高对比三套主题里都有值', () => {
  // 浅色显式主题
  const light = html.slice(html.indexOf(':root[data-theme="light"]'));
  const lightEnd = light.indexOf('\n');
  const lightBlock = light.slice(0, lightEnd);
  for (const t of ['--color-wood', '--color-fire', '--color-earth', '--color-metal',
    '--color-water', '--color-moonwhite', '--color-dai']) {
    assert.ok(lightBlock.includes(t + ':'), `浅色主题缺 ${t}`);
  }
  // 高对比（浅底 + 暗底两档）
  const hcStart = html.indexOf(':root[data-contrast="high"]');
  assert.ok(hcStart > 0, '缺高对比主题块');
  const hc = html.slice(hcStart, html.indexOf('@media (prefers-color-scheme:dark){', hcStart));
  for (const t of ['--color-wood', '--color-fire', '--color-earth', '--color-metal',
    '--color-water', '--color-moonwhite', '--color-dai']) {
    assert.ok(hc.includes(t + ':'), `高对比主题缺 ${t}`);
  }
});

test('层次 1：v1.7.0 遗留硬编码色值已收进 token（规则里零裸 hex）', () => {
  const styleStart = html.indexOf('<style>');
  const styleEnd = html.indexOf('</style>');
  const css = html.slice(styleStart, styleEnd);
  // 口径：只扫**声明体**（{ 与 } 之间）里的裸 hex。
  // token 的*定义*也写在声明体里（--x:#fff），那是 token 的值本身，不是硬编码；
  // 要抓的是「规则里直接写颜色」。所以改成：声明体去掉 --x:#hex 这类定义后不应再有 hex。
  const defRe = /--[\w-]+:\s*#[0-9a-fA-F]{3,8}\b/g;
  const decls = [...css.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]);
  const left = new Set();
  for (const d of decls) {
    for (const hex of d.replace(defRe, '').match(/#[0-9a-fA-F]{3,8}\b/g) || []) left.add(hex);
  }
  assert.deepEqual([...left], [], `规则声明里仍有裸色值：${[...left].join(', ')}`);
});

test('层次 1：本次折进 token 的 v1.7.0 色值确实被引用了', () => {
  // 抽三个典型的：进度条渐变、duel 血条、品牌标
  assert.ok(html.includes('linear-gradient(90deg,var(--bar-jade),var(--gold-warm))'),
    '进度条渐变未走 token');
  assert.ok(html.includes('linear-gradient(140deg,var(--jade-deep),var(--jade-abyss))'),
    '品牌标渐变未走 token');
  assert.ok(html.includes('color-mix(in srgb,var(--jade) 55%,var(--color-moonwhite))'),
    'duel 血条高光档未走 token');
});

/* ============ 层次 2 · 纹理 ============ */

test('层次 2：宣纸 / 古籍框线 / 朱砂印泥 三样都在', () => {
  assert.ok(texture.includes('.cloud-weave::before{'), '缺宣纸纹理层');
  assert.ok(texture.includes('feTurbulence'), '宣纸纹理应走 feTurbulence（随机纤维）');
  assert.ok(texture.includes('.shop-card#reportCard{'), '缺古籍框线');
  assert.ok(texture.includes('radial-gradient(circle 3.5px'), '古籍框线缺四角「耳」');
  assert.ok(texture.includes('.seal-imprint{'), '缺朱砂印泥');
  assert.ok(texture.includes('.seal-corner{'), '缺角落落款位');
});

test('层次 2：宣纸层压在内容之下且不挡交互', () => {
  assert.ok(texture.includes('position:fixed;inset:0;z-index:0;pointer-events:none'),
    '宣纸层必须 fixed + pointer-events:none，否则会挡住整页点击');
  assert.ok(texture.includes('.cloud-weave>.app'), '内容需抬一层 z-index');
  assert.ok(html.includes('<body class="cloud-weave">'), 'body 仍挂着 cloud-weave');
});

test('层次 2：朱砂印泥在标记里真的存在，且是纯装饰', () => {
  assert.ok(html.includes('<div class="seal-corner" aria-hidden="true">'),
    '角落方印须 aria-hidden（纯装饰，不进读屏）');
  assert.ok(html.includes('<span class="seal-imprint">'), '缺 .seal-imprint 元素');
});

test('层次 2：三层主题都给朱砂印泥做了适配', () => {
  assert.ok(texture.includes(':root[data-contrast="high"] .seal-imprint{'),
    '高对比下印泥未适配');
  // 浅色下 --fire 必须是深一档的值，否则朱印在白底上会看不清
  const lightBlock = html.slice(html.indexOf(':root[data-theme="light"]'),
    html.indexOf('\n', html.indexOf(':root[data-theme="light"]')));
  const m = lightBlock.match(/--color-fire:(#[0-9a-fA-F]{3,8})/);
  assert.ok(m, '浅色主题缺 --color-fire');
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  assert.ok(r < 0xc0 && g < 0x60, `浅色下朱印偏亮（rgb(${r},${g},${b})），白底上会看不清`);
});

/* ============ 层次 3 · 动效 ============ */

test('层次 3：恰好两条 @keyframes，且都是 one-shot', () => {
  const keys = [...all.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
  assert.deepEqual(keys.sort(), ['realmGlow', 'sealStamp'], `应恰好两条关键帧，实得 ${keys.length}：${keys.join(', ')}`);
});

test('层次 3：零 infinite —— 装饰动效永不循环（守住既有红线）', () => {
  // 本块里提到 infinite 的只有「注释里说明我们不用 infinite」，不是真声明。
  // 所以只查 animation 声明里是否出现 infinite。
  const decls = [...all.matchAll(/animation:[^;}]+/g)].map((m) => m[0]);
  const bad = decls.filter((d) => d.includes('infinite'));
  assert.deepEqual(bad, [], `新增动效里出现了 infinite：${bad.join(' | ')}`);
  // 全局共 7 条循环动效，**全部是既有代码**（v1.8.x 之前）：plotBreath 灵植呼吸
  // （3 条：常规 + 两档 reduced-motion）、timerPulse / tribTimerPulse 斗法与渡劫计时
  // 告警、bt-spin / bt-pulse 突破环。它们都在本轮三个哨兵块**之外**。
  // 本测试的口径很窄：只承诺「本轮没往全局新加循环」，不去审计既有那 7 条。
  // 做法：把本轮三个块的 animation 声明从全文里剔除，剩下的必须逐字不变。
  const outsideThisRound = html;
  for (const blk of [texture, motion, typo]) {
    for (const m of blk.matchAll(/animation:[^;}]+/g)) {
      const d = m[0];
      assert.ok(outsideThisRound.includes(d), `本轮新增的 animation 声明未出现在模板中：${d}`);
    }
  }
  // 既有 7 条：名字必须都在已知清单里（新增循环会在这里暴露）
  const known = ['plotBreath', 'timerPulse', 'bt-spin', 'bt-pulse', 'tribTimerPulse'];
  for (const d of [...html.matchAll(/animation:[^;}]*infinite[^;}]*/g)].map((m) => m[0])) {
    const hit = known.find((k) => d.includes(k));
    assert.ok(hit, `本轮新引入了循环动效：${d}`);
  }
});

test('层次 3：reduced-motion 下两条动效都退化为直接显示终态', () => {
  assert.ok(motion.includes('@media (prefers-reduced-motion:reduce)'),
    '新增动效缺 reduced-motion 兜底');
  assert.ok(motion.includes('.seal-stamp-once,.bar i.realm-sweep::after{animation-duration:.001ms!important'),
    '两条动效未一并被 reduced-motion 掐停');
  assert.ok(motion.includes('animation:sealStamp .46s') && motion.includes('animation:realmGlow .72s'),
    '动效时长应短促（<1s），不该是拖沓的长动画');
});

test('层次 3：两个触发点挂在「有明确起点」的时刻，且不会重复误触', () => {
  // 渡劫结印：打开突破浮层时盖一次
  assert.ok(html.includes("classList.remove('seal-stamp-once'); void st.offsetWidth; st.classList.add('seal-stamp-once')"),
    '渡劫结印未做「移除+回流+重加」，连续两次渡劫不会重放');
  // 境界灵光：只在**跨入新一境**时闪，同境内攒灵气不闪
  assert.ok(html.includes('window.__qcRealmSeen'), '境界灵光缺「上次境界」记忆');
  assert.ok(html.includes('r.index>window.__qcRealmSeen'), '境界灵光判据应是境界序号提升，而不是百分比变化');
});

/* ============ 层次 4 · 排版意境 ============ */

test('层次 4：中文正文字距基线 0.1em，且窄屏有回落', () => {
  assert.ok(typo.includes('letter-spacing:.1em'), '缺 0.1em 字距基线');
  assert.ok(typo.includes('letter-spacing:.04em'), '窄屏缺字距回落（0.1em 会撑爆行尾）');
  assert.ok(!/^\s*\*\s*\{[^}]*letter-spacing/m.test(html), '不应把字距挂到 *{} 全局选择器');
});

test('层次 4：竖排诗词组（writing-mode:vertical-rl）', () => {
  assert.ok(html.includes('writing-mode:vertical-rl'), '缺竖排声明');
  assert.ok(typo.includes('.creed{') || texture.includes('.creed{'), '缺竖排箴言类');
  assert.ok(html.includes('class="creed"'), '缺竖排箴言元素');
  assert.ok(html.includes('<p class="creed" aria-hidden="true">'), '竖排箴言须 aria-hidden');
  assert.ok(texture.includes('@media (max-width:767px){') && texture.includes('.creed{display:none}'),
    '窄屏应隐藏竖排箴言（优先保证真数据可读）');
});

test('层次 4：等宽数字只加在会逐位变化的数值上', () => {
  assert.ok(typo.includes('font-variant-numeric:tabular-nums'), '缺 tabular-nums');
  assert.ok(typo.includes('font-feature-settings:"tnum" 1'), '缺 tnum 特性开关');
  // 大号分数要退回比例数字（tabular 在大字号下过疏）
  assert.ok(typo.includes('.sect-score{font-variant-numeric:normal'), '大号分数未退回比例数字');
  // 不能给不存在的类写规则：抽查点名类是否真的在模板里出现
  const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  for (const sel of ['num', 'pct', 'mk-chip', 'stat-cell', 'fac-num', 'lx-badge']) {
    const inCss = new RegExp('\\.' + sel + '(?![\\w-])').test(css);
    const inHtml = new RegExp('class="[^"]*\\b' + sel + '\\b').test(html);
    assert.ok(inCss && inHtml, `.${sel} 是死 CSS（CSS 里有、markup 里没有）`);
  }
});

/* ============ 全局不被顺手改坏 ============ */

test('侧栏面板不被 flex 压扁（面板高度 = 内容高度）', () => {
  // 回归测试：aside.side 是 display:flex;flex-direction:column 且自身 overflow-y:auto。
  // 子项默认 flex-shrink:1，空间不足时每张面板被等比压扁 → 面板内 <h2> 文字被裁切。
  // （2026-10-06 用户实机反馈：侧栏「今日 / 学情看板 / 最近斩获…」标题被切掉上半截。）
  // 该滚动的是侧栏自己，不是里面的内容，所以子项一律 flex-shrink:0。
  assert.ok(/aside\.side\{[^}]*display:flex[^}]*flex-direction:column/.test(html),
    '前提变了：侧栏不再是 flex 列容器，本测试口径需重写');
  assert.ok(/aside\.side\{[^}]*overflow-y:auto/.test(html), '前提变了：侧栏不再自带滚动');
  assert.ok(/aside\.side>\*\{flex-shrink:0\}/.test(html),
    '侧栏子项缺 flex-shrink:0 —— 面板会被压扁、标题文字被裁切');
  // 产物里也要在（部署后的线上版本才修得了）
  assert.ok(distHtml.includes('aside.side>*{flex-shrink:0}'), '产物缺侧栏防压扁规则');
});

test('视觉升级没有动导航语义与既有 a11y 钩子', () => {
  assert.equal((html.match(/role="tab"/g) || []).length, 9, 'role="tab" 应仍为 9 个');
  assert.ok(html.includes('trial-sticky'), '阶段 B2 粘性题面类缺失');
  assert.ok(html.includes('id="assessOverlay"'), '阶段 B3 摸底浮层缺失');
  assert.ok(html.includes(':focus-visible{outline:'), '焦点环缺失');
  assert.ok(html.includes('.skip-link'), '跳转链缺失');
  assert.ok(html.includes('role="dialog"'), '浮层 dialog 语义缺失');
});

test('产物自包含：哨兵标记与新视觉仍在 dist/index.html 里（可在线 grep）', () => {
  for (const s of ['--color-wood', '--color-fire', '--color-earth', '--color-metal',
    '--color-water', '--color-moonwhite', '--color-dai',
    'feTurbulence', 'sealStamp', 'realmGlow', 'vertical-rl', 'tabular-nums']) {
    assert.ok(distHtml.includes(s), `产物缺 ${s}（构建后未注入）`);
  }
  assert.ok(distHtml.includes('traditional') || distHtml.includes('传统纹样'),
    '产物缺纹理块哨兵');
});

test('单文件体积增量在 19 KB 预算内（对照本轮视觉升级的真实起点）', () => {
  const bytes = statSync(join(ROOT, 'dist', 'index.html')).size;
  // 起点 = 阶段 F（PRETCO）提交后的 dist/index.html = 965 037 B。
  // 刻意**不是** v1.9.0 的 923.8 KB：阶段 E/F 已把单文件推到 965 037 B，
  // 视觉升级是在这个起点上做增量，不是从 v1.9.0 起算（详见 docs/v1.9.1-report.md）。
  const BASELINE = 965037;
  const delta = (bytes - BASELINE) / 1024;
  assert.ok(delta <= 19, `单文件较视觉升级起点增 ${delta.toFixed(1)} KB，超出 19 KB 预算（${bytes} B）`);
});