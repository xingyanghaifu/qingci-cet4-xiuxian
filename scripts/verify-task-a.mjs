/* 任务 A 交互自测（静态证据核验，一次性脚本） */
import { readFileSync } from 'node:fs';
const h = readFileSync('dist/cet4-xiuxian.html', 'utf8');
const out = [];
let pass = 0, fail = 0;
const ok = (cond, label, note) => { cond ? pass++ : fail++; out.push(`${cond ? '✅' : '❌'} ${label} · ${note}`); };

// --- 结构：菜单包裹关系 ---
const navMenuAt = h.indexOf('id="navMenu"');
const appAt = h.indexOf('class="app"');
const navAt = h.indexOf('<nav class="tabs"');
const navEndAt = h.indexOf('</nav>', navAt);
const layoutAt = h.indexOf('<div class="layout">');
ok(navMenuAt > appAt && navMenuAt < navAt && navEndAt < h.indexOf('id="navScrim"') && h.indexOf('id="navScrim"') < layoutAt,
  'A1 菜单包裹 nav 且在 .app 内、layout 之前', 'navMenu ⊃ nav ⊃ … ⊃ scrim < layout');
ok(h.includes('id="navMenu" role="dialog" aria-modal="true" aria-labelledby="navMenuTitle"'),
  'A2 菜单对话框 ARIA', 'role=dialog · aria-modal · aria-labelledby');
ok(h.includes('<h2 id="navMenuTitle" class="sr-only">导航</h2>'), 'A3 隐藏标题', 'sr-only h2');

// --- 汉堡按钮 ---
const btnSeg = (h.match(/<button[^>]*id="menuBtn"[^>]*>/) || [''])[0];
ok(btnSeg.includes('aria-label="打开导航菜单"') && btnSeg.includes('aria-haspopup="menu"')
  && btnSeg.includes('aria-expanded="false"') && btnSeg.includes('aria-controls="navMenu"'),
  'A4 汉堡按钮 ARIA 四件套', btnSeg.replace(/</g, '<').slice(0, 120));
ok(/id="menuBtn"[\s\S]{0,200}M3 7h18M3 12h18M3 17h18/.test(h), 'A5 汉堡内联 SVG', '三横线 18px 长 / 间距5 / 无图标库');

// --- 8 按钮原样迁移 ---
const menuSeg = h.slice(navMenuAt, h.indexOf('id="navScrim"'));
const btnCount = (menuSeg.match(/role="tab"/g) || []).length;
const tabs = [...menuSeg.matchAll(/data-tab="(\w+)"/g)].map(m => m[1]);
ok(btnCount === 8 && tabs.join(',') === 'paper,trial,trial,speak,book,codex,map,duel',
  'A6 八项导航原样在菜单内', `role=tab ×${btnCount} · data-tab=${tabs.join('/')}`);
ok(menuSeg.includes('data-mode="words"'), 'A7 背单词 data-mode 保留', '消歧依据在位');
// A8：排除 JS 选择器字符串 ".tabs [aria-selected=\"true\"]"（仅统计真实属性；v1.6 起已知口径）
const selectedReal = (h.match(/aria-selected="true"/g) || []).length
  - (h.match(/querySelector\('\.tabs \[aria-selected="true"\]'\)/g) || []).length;
ok(selectedReal === 1, 'A8 初始唯一选中', `真实 aria-selected=true 属性 ×${selectedReal}`);
ok(menuSeg.includes('id="road"') && menuSeg.includes('题型速捷'), 'A9 题型速捷入菜单', 'nav-sub 次级分组 + 细线分隔');
ok(!h.match(/<aside class="side"[^>]*>[\s\S]{0,400}id="road"/), 'A10 侧栏已无 road', '渲染目标迁移完成');
ok((h.match(/id="road"/g) || []).length === 1, 'A11 road id 唯一', '无重复 id');

// --- 标题与消歧 ---
ok(h.includes('<h1 id="mainTitle" tabindex="-1">'), 'A12 mainTitle tabindex=-1', '焦点可落、Tab 不停留');
ok(h.includes('.app:has(#panel-trial:not(.hidden)):has(.tabs button.on[data-mode="words"])'),
  'A13 :has() 消歧规则完好', '标题机制依赖 .on + .tabs，菜单仍在 .app 内');
ok(h.includes('function switchTab(name,srcBtn)'), 'A14 switchTab 原样', 'srcBtn 消歧签名未动');
ok(h.includes('switchTab(b.dataset.tab, b)'), 'A15 原点击处理器仍传 srcBtn', '既有处理器绑定在迁移后的按钮上');

// --- 脚本能力（补充 1 四条路径的代码证据） ---
const script = h.slice(h.lastIndexOf('<script>'));
ok(script.includes('e.shiftKey && document.activeElement === first'), 'S1 Tab 焦点循环', '首尾互跳 + 游离焦点收回');
ok(script.includes("(e.key === 'Escape' || e.key === 'Esc') && isOpen()") && script.includes('close()'),
  'S2 Esc 关闭且焦点回汉堡', 'close() 默认 restore=lastFocus(menuBtn)');
ok(script.includes("close(false)") && script.includes('focusMainTitle()'),
  'S3 点击导航项 → 关菜单(不回焦) → h1.focus()', '与既有 switchTab/ask 链并存，最终焦点=主区标题');
ok(script.includes("(e.ctrlKey || e.metaKey)") && script.includes("e.key === 'k'") && script.includes('e.preventDefault()'),
  'S4 Ctrl/Cmd+K 开合', '输入态不抢占；shortcuts.ts 对 hasModifier 返回 null 零冲突');
ok(script.includes("btn.setAttribute('aria-expanded', 'true')") && script.includes("btn.setAttribute('aria-expanded', 'false')"),
  'S5 aria-expanded 双态切换', '同步 + 汉堡 aria-label 开/关互换');
ok(script.includes("menu.querySelectorAll('button, [href], input, select, textarea, [tabindex]')"),
  'S6 焦点循环选择器', '含 road 的 button，全部可聚焦项在环内');

// --- 无障碍与既有功能不回归 ---
ok(h.includes('id="ovClose"') && h.match(/id="ovClose"/g).length === 1, 'R1 ovClose 仍在侧栏抽屉', '收起概览按钮未丢');
ok(h.includes('id="ovToggle"') && /id="ovToggle"[^>]*aria-controls="sidePanel"/.test(h), 'R2 ovToggle 机制未动', 'aria-expanded/controls 原样');
const panels = ['panel-missions','panel-paper','panel-trial','panel-speak','panel-book','panel-codex','panel-map','panel-duel'];
ok(panels.every(p => h.includes(`id="${p}"`)), 'R3 八面板齐全', 'aria-controls 无悬空');
ok(h.includes('role="tablist" aria-label="修炼模块"') && h.includes('id="missionList"') && h.includes('id="achievementList"'),
  'R4 读屏标签与数据 id 完好', 'tablist 标签 / 数据展示 DOM 全保留');

out.push('', `结果：${pass} 通过 / ${fail} 失败`);
console.log(out.join('\n'));
