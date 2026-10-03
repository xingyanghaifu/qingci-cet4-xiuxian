/* 任务 B 三档响应式 + 数据抽屉验证（静态证据，一次性脚本） */
import { readFileSync } from 'node:fs';
const h = readFileSync('dist/cet4-xiuxian.html', 'utf8');
const out = [];
let pass = 0, fail = 0;
const ok = (c, l, n) => { c ? pass++ : fail++; out.push(`${c ? '✅' : '❌'} ${l} · ${n}`); };

// ---------- ≥1025px 桌面三区 ----------
const dStart = h.indexOf('@media (min-width:1025px)');
const dEnd = h.indexOf('/* ---------- 平板');
const desk = h.slice(dStart, dEnd);
ok(desk.includes('grid-template-areas:"hero main" "side main" "note note"') && !desk.includes('"nav main"'),
  'D1 桌面栅格无 nav 行', '"hero main" / "side main" / "note note" 三行');
ok(!/\.tabs\{grid-area:nav;/.test(desk), 'D2 旧 .tabs 栅格规则已删', 'nav 不再是栅格项（注释中提及不算）');
ok(desk.includes('grid-template-rows:auto minmax(0,1fr) auto'), 'D3 行高：顶 auto / 数据 1fr 滚动 / 底 auto', '三区滚动行为');
ok(desk.includes('aside.side{grid-area:side;overflow-y:auto;min-height:0;') && desk.includes('#main{overflow-y:auto;min-height:0;'),
  'D4 数据区与主区独立内滚', '数据区 overflow-y:auto（桌面块内）');
ok(desk.includes('.side-foot{position:sticky;bottom:0'), 'D5 底部区吸底固定', 'sticky bottom');
// 顶部区固定 = hero 在网格 row1 auto（app overflow hidden +100dvh）
ok(desk.includes('height:100dvh;overflow:hidden'), 'D6 应用外壳 100dvh/overflow hidden', '顶部与页脚不随数据区滚动');

// ---------- 768–1024 平板 ----------
const tStart = h.indexOf('@media (min-width:768px) and (max-width:1024px)');
const tEnd = h.indexOf('/* ---------- 移动端 <768px：顶部状态条');
const tab = h.slice(tStart, tEnd);
ok(tab.includes('aside.side{position:fixed;left:0;top:0;bottom:0;width:280px') && tab.includes('translateX(-102%)'),
  'T1 平板侧栏=左侧 280px 抽屉', '默认隐藏 translateX + visibility');
ok(tab.includes('aside.side.open{transform:none;visibility:visible'), 'T2 抽屉展开态', 'transform/visibility 双态');
ok(tab.includes('.data-toggle{display:inline-flex'), 'T3 顶部条右端数据按钮', '仅平板显示');
ok(!tab.includes('width:60px') && !tab.includes(':has(.tabs:hover)'), 'T4 60px 图标轨与悬停浮层规则已删', '避免 (0,4,0) 劫持菜单 .tabs');
ok(tab.includes('.side-close{display:inline-flex'), 'T5 抽屉内「收起概览」按钮可用', '焦点落点存在');
ok(tab.includes('grid-template-areas:"hero" "main" "note"'), 'T6 主区通栏', '侧栏退出栅格');

// ---------- <768 移动状态条 ----------
const mStart = h.lastIndexOf('/* ---------- 移动端 <768px：顶部状态条');
const mEnd = h.lastIndexOf('</style>');
const mob = h.slice(mStart, mEnd);
ok(mob.includes('position:sticky;top:0;z-index:40') && mob.includes('flex-wrap:nowrap'),
  'M1 顶部状态条吸顶单行', 'sticky + nowrap');
ok(mob.includes('.seal b{font-size:14px}') && mob.includes('.seal #daoName{display:none}') && mob.includes('.seal > .row.muted:last-child{display:none}'),
  'M2 状态条精简：境界名+迷你进度条', '道号与灵气明细让位（抽屉内可见）');
ok(mob.includes('.ov-toggle{display:inline-flex;order:3'), 'M3 右侧今日功课 chip 就位', '整条右端可点开抽屉');
ok(mob.includes('.clock-row{top:55px}'), 'M4 计时条避让吸顶条', '不被状态条遮挡');
ok(h.includes("tog.textContent = '功课 ' + Math.min(done, target) + '/' + target + ' ▾'") &&
   h.includes('new MutationObserver(syncChip).observe(missionEl'),
  'M5 功课 x/20 动态同步', 'state.dailyWords/dailyTarget + missionList 观察');
ok(h.includes("(typeof state !== 'undefined') ? state : null"), 'M6 state 访问有安全兜底', 'try/catch 包裹');

// ---------- 数据抽屉：三档开合 + Esc + 焦点 ----------
ok(h.includes("if (dataBtn) dataBtn.setAttribute('aria-expanded'") &&
   h.includes("if (dataBtn) dataBtn.addEventListener('click', function () { setDrawer(!side.classList.contains('open')); });"),
  'S1 平板按钮复用同一抽屉', 'setDrawer 同步双触发器 aria-expanded');
ok(h.includes("if (open && closeBtn) closeBtn.focus()") && h.includes("if (closeBtn) closeBtn.addEventListener('click', function () { setDrawer(false); if (tog) tog.focus(); })"),
  'S2 开→焦点入抽屉 / 关→焦点回触发按钮', '焦点管理完整');
ok(h.includes("(e.key === 'Escape' || e.key === 'Esc') && side && side.classList.contains('open')"),
  'S3 Esc 关闭抽屉', '三档共用同一 Esc 监听（含 side 空值守卫）');
ok(h.includes('id="sideAudioSrc"') && h.includes("getElementById('sideAudioSrc')"),
  'S4 侧栏音频声明双入口', '共用 #audioSrcOverlay 弹窗');
ok(h.includes('id="dataToggle"') && /id="dataToggle"[^>]*aria-controls="sidePanel"/.test(h),
  'S5 dataToggle ARIA', 'aria-expanded + aria-controls=sidePanel');
ok((h.match(/aria-controls="sidePanel"/g) || []).length === 2, 'S6 sidePanel 双触发器', 'ovToggle + dataToggle');

out.push('', `结果：${pass} 通过 / ${fail} 失败`);
console.log(out.join('\n'));
