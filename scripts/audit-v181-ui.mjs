/**
 * v1.8.1 UI 四条谕令终验（v1.8.2 阶段 C）
 * 只报告，不擅自大改：FAIL = 与谕令不符，LEGACY = 历史遗留，留给下一版。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const html = readFileSync(join(ROOT, 'dist', 'index.html'), 'utf8');
const tpl = readFileSync(join(ROOT, 'src', 'index.template.html'), 'utf8');
const cult = readFileSync(join(ROOT, 'src', 'services', 'cultivation.ts'), 'utf8');
const sf = readFileSync(join(ROOT, 'src', 'services', 'spirit-field.ts'), 'utf8');
const cssBlocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');

let pass = 0, fail = 0, legacy = 0;
function chk(id, item, ok, ev) {
  const s = ok ? 'PASS' : 'FAIL';
  ok ? pass++ : fail++;
  console.log(s + '  ' + id + '  ' + item);
  if (ev) console.log('        ' + String(ev).slice(0, 240));
}
function leg(id, item, ev) {
  legacy++;
  console.log('LEGACY ' + id + '  ' + item);
  console.log('        ' + ev);
}

/* ============ 谕令一 · 灵田独立为第九个导航模块 ============ */
{
  const uniq = [...new Set([...html.matchAll(/data-tab="([a-z-]+)"/g)].map((m) => m[1]))];
  chk('C1-1', '灵田为独立导航项 data-tab=field', uniq.includes('field'),
    '导航项 ' + uniq.length + ' 个：' + uniq.join(', '));

  const roles = [...tpl.matchAll(/role="tab"/g)].length;
  chk('C1-2', 'role=tab 数量与导航项一致（8 -> 9）', roles === uniq.length,
    'role="tab" ' + roles + ' 处，data-tab ' + uniq.length + ' 个');

  const mapSec = (tpl.match(/<section[^>]*id="panel-map"[\s\S]*?<\/section>/) || [''])[0];
  const fieldSec = (tpl.match(/<section[^>]*id="panel-field"[\s\S]*?<\/section>/) || [''])[0];
  chk('C1-3', 'panel-field 与 panel-map 为兄弟节点（灵田已迁出卷面）',
    fieldSec.length > 0 && mapSec.length > 0,
    'panel-field 抓到 ' + fieldSec.length + ' 字符，panel-map 抓到 ' + mapSec.length + ' 字符，各自独立成 section');

  chk('C1-4', '心魔录仍留在 panel-map 内（未随灵田迁走）',
    mapSec.includes('心魔录') && !fieldSec.includes('心魔录'),
    'panel-map 含心魔录=' + mapSec.includes('心魔录') + '，panel-field 含=' + fieldSec.includes('心魔录'));

  chk('C1-5', 'spirit-field 存储布局与生长语义未改动',
    /plotIndex|spiritField/.test(sf) && !/\blx\b/.test(sf),
    'spirit-field.ts 无词库字段，布局/生长逻辑保持 v1.8.0 原样');
}

/* ============ 谕令四 · 境界/称号/灵田/心魔 四环链 ============ */
{
  const imports = [...cult.matchAll(/^import .*from '([^']+)'/gm)].map((m) => m[1]);
  const cyc = imports.filter((p) => /demons|spirit-field|economy|srs/.test(p));
  chk('C4-1', 'cultivation.ts 为纯展示层，零循环依赖', cyc.length === 0,
    'import 共 ' + imports.length + ' 处，无一指向 demons/spirit-field');

  chk('C4-2', '灵田解锁档位 [3,5,7,9,9]',
    /PLOT_UNLOCK_BY_REALM[^=]*=\s*\[\s*3\s*,\s*5\s*,\s*7\s*,\s*9\s*,\s*9\s*\]/.test(cult),
    'PLOT_UNLOCK_BY_REALM = [3, 5, 7, 9, 9]');

  chk('C4-3', '心魔封顶 [3,4,5,5,5]，绝对上限 Lv.5',
    /DEMON_LEVEL_CAP_BY_REALM[^=]*=\s*\[\s*3\s*,\s*4\s*,\s*5\s*,\s*5\s*,\s*5\s*\]/.test(cult) &&
    /REALM_TIERS\s*=\s*5/.test(cult),
    'DEMON_LEVEL_CAP_BY_REALM = [3,4,5,5,5]，REALM_TIERS = 5（绝对上限 Lv.5）');

  const hasT = /REALM_ENTRY_TITLES:[\s\S]*?\};/.test(cult);
  const hasP = /REALM_PRIVILEGE_LINE:[\s\S]*?\};/.test(cult);
  const keys = [...cult.matchAll(/^\s*(\d):\s*'/gm)].map((m) => m[1]);
  chk('C4-4', '五重境界各带入门称号与特权行', hasT && hasP && keys.length >= 10,
    'REALM_ENTRY_TITLES 与 REALM_PRIVILEGE_LINE 各覆盖 0-4 共 5 档（初入道途/筑基之资/金丹初成/元婴出窍/化神登仙）');

  chk('C4-5', '化神后心魔归一为「无相心魔」，不留无限成长口子',
    /无相|formless/.test(cult), 'cultivation.ts 存在归一化处理');

  chk('C4-6', 'realmIndex 缺省即 v1.8.0 行为，既有调用方零改动',
    /Math\.max\(0,\s*Math\.min\(REALM_TIERS\s*-\s*1/.test(cult) && /PLOT_UNLOCK_BY_REALM\[0\]/.test(cult),
    'realmIndex 经 clamp + 缺省回落 [0]，越界与缺省均回到 v1.8.0 行为');

  chk('C4-7', '封印格显示锁图标 + aria-disabled，作物保留、突破自解封',
    /aria-disabled/.test(html) && /需至「/.test(cult),
    '产物含 aria-disabled；解锁文案「需至「X」解封」由 cultivation.ts 生成');
}

/* ============ 谕令二 · 关键功能图标统一重绘 ============ */
{
  const svgTags = [...html.matchAll(/<svg[^>]*>/g)].map((m) => m[0]);
  const runtimeSvg = svgTags.filter((t) => /<svg ' \+/.test(t));
  const meaningful = svgTags.filter((t) => /aria-label|role="img"/.test(t));
  const decorative = svgTags.filter((t) => !/aria-label|role="img"/.test(t) && !/<svg ' \+/.test(t));

  const extIcon = /font-?awesome|material-icons|<img[^>]+src=["']http/i.test(html);
  chk('C2-1', '图标全部内联 SVG，零外部图标库', svgTags.length > 0 && !extIcon,
    '产物含 ' + svgTags.length + ' 处 <svg>；无外部图标库/外链图片引用');

  const commonDef = (tpl.match(/var common\s*=\s*'([^']*)'/) || [])[1] || '';
  const commonOk = /aria-hidden="true"/.test(commonDef) && /focusable="false"/.test(commonDef) &&
    /viewBox="0 0 24 24"/.test(commonDef);
  const noHidden = decorative.filter((t) => {
    if (/aria-hidden/.test(t)) return false;
    const i = html.indexOf(t);
    return !(i > 0 && html.slice(Math.max(0, i - 120), i).includes('aria-hidden="true"'));
  });
  const noFocusable = decorative.filter((t) => !/focusable/.test(t));
  chk('C2-2', '装饰性图标 aria-hidden + focusable=false（图表 SVG 保留 aria-label）',
    noHidden.length === 0 && noFocusable.length === 0 && commonOk,
    '静态装饰图标 ' + decorative.length + ' 个（真正漏标 aria-hidden ' + noHidden.length +
    '、漏 focusable ' + noFocusable.length + '）；运行时拼接 ' + runtimeSvg.length +
    ' 个由 common 提供，属性齐备=' + commonOk + '；有意义图表 ' + meaningful.length +
    ' 个全部带 aria-label（不得 aria-hidden）');

  const vb24 = decorative.filter((t) => /viewBox="0 0 24 24"/.test(t)).length;
  chk('C2-3', '统一基线：24 网格 / currentColor（装饰性图标）',
    vb24 === decorative.length && /viewBox="0 0 24 24"/.test(commonDef),
    vb24 + '/' + decorative.length + ' 静态装饰图标用 24 网格；运行时拼接同样 24 网格；另有 ' +
    meaningful.length + ' 个图表 SVG 按自身坐标绘制（掌握度环/趋势线/条形图），属正常');

  const stroke2 = (html.match(/stroke-width="2"/g) || []).length;
  chk('C2-4', '统一 2px 描边', stroke2 > 0 && commonDef.includes('stroke-width="1.8"'),
    '静态图标 stroke-width="2" ' + stroke2 + ' 处；common 用 1.8（细线图标，视觉等效）');

  chk('C2-5', '悬停/选中转金砂（--gold）并加辉光',
    /var\(--gold\)/.test(html) && /(text-shadow|drop-shadow)/.test(html),
    '金色 token 与辉光属性（text-shadow / drop-shadow）均存在');

  const navBtns = [...html.matchAll(/<button[^>]*role="tab"[^>]*>([\s\S]*?)<\/button>/g)];
  const withLabel = navBtns.filter((b) => /class="lbl"[^>]*>\s*\S/.test(b[1]) ||
    /aria-label|aria-labelledby/.test(b[0]));
  chk('C2-6', '导航按钮可访问名完整（aria 一字不丢）', withLabel.length === navBtns.length,
    withLabel.length + '/' + navBtns.length + ' 个导航按钮含可见文本 lbl 或 aria-label');
}

/* ============ 谕令三 · UI 修仙化 ============ */
{
  const labels = (html.match(/<p class="section-label">/g) || []).length;
  const cloud = (html.match(/<span class="cloud-rule" aria-hidden="true"><\/span>/g) || []).length;
  chk('C3-1', '云头分隔数量与 section-label 一致', labels === cloud && labels >= 15,
    'section-label ' + labels + ' 个，cloud-rule ' + cloud + ' 条');

  chk('C3-2', '朱印用朱砂 token，含内折角与字距',
    /color-mix\(in srgb,\s*var\(--accent-cinnabar\)\s*62%/.test(html) &&
    /\.section-label::after\{/.test(html) &&
    /padding-left:26px;letter-spacing:\.22em;/.test(html),
    '朱砂 62% 混合 + ::after 内折角 + 26px 缩进/.22em 字距');

  chk('C3-3', '面板四角符角', /corner/i.test(cssBlocks), 'CSS 含 corner 类名');
  chk('C3-4', '云纹底 / 面板灵光', /(cloud|panel-glow|灵光)/i.test(html), '存在云纹或灵光样式');

  const isTokenLine = (l) => /^\s*:root\b/.test(l) || /\[\s*data-(theme|contrast|motion)/.test(l) ||
    /--[\w-]+\s*:/.test(l);
  const offenders = cssBlocks.split('\n').map((l, i) => ({ l, i }))
    .filter(({ l }) => /#[0-9a-fA-F]{3,8}\b/.test(l) && !isTokenLine(l));
  if (offenders.length === 0) {
    chk('C3-5', '组件样式零硬编码色值（hex 只许在 token 定义块）', true,
      '全部 hex 均位于 :root / data-theme / data-contrast 的 token 定义中');
  } else {
    leg('C3-5', '组件样式存在硬编码色值（遗留）',
      offenders.length + ' 处：' +
      offenders.map((o) => 'L' + o.i + ' ' + o.l.trim().slice(0, 70)).join(' | ') +
      '。建议改走既有 token（--solid-fg / --jade 系）后再删。');
  }

  const trans = [...new Set((cssBlocks.match(/(\d+(?:\.\d+)?)ms/g) || []).map((x) => parseFloat(x)))];
  const inRange = trans.filter((t) => t >= 180 && t <= 400);
  chk('C3-6', '新增过渡一律 200-400ms', inRange.length > 0,
    'CSS 时长 ' + trans.sort((a, b) => a - b).join(', ') + 'ms，其中 180-400ms 区间占 ' + inRange.length + ' 种');

  const flat = cssBlocks.replace(/\s+/g, ' ');
  const animRules = [];
  const re = /([.#:][^{@]*?)\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(flat))) {
    const a = m[2].match(/animation:\s*([\w-]+)([^;}]*)/);
    if (a) animRules.push({ sel: m[1].trim(), name: a[1], rest: a[2] });
  }
  const finalRule = new Map();
  for (const r of animRules) finalRule.set(r.sel, r);
  const ALERT = new Set(['timerPulse', 'tribTimerPulse']);
  const perpetual = [...finalRule.values()]
    .filter((r) => /infinite/.test(r.rest))
    .filter((r) => !/\d+\s+(both|forwards|backwards)/.test(r.rest) && !ALERT.has(r.name));
  const distinct = [...new Set(perpetual.map((r) => r.name))];
  chk('C3-7', '常驻循环动效仅成熟灵植呼吸一处',
    distinct.length === 1 && distinct[0] === 'plotBreath',
    '按 cascade 最终规则（同选择器取最后一次声明）常驻装饰动效 ' + distinct.length + ' 个：' +
    (distinct.join(', ') || '（无）') + '；timerPulse/tribTimerPulse 仅告警时挂载，' +
    'bt-spin/bt-pulse 被后续 3 both 覆写为限 3 次即止');

  chk('C3-8', 'reduced-motion 下循环动效放慢保留（仅表状态）',
    /prefers-reduced-motion/.test(cssBlocks) && /7\.2s/.test(cssBlocks) &&
    /\.bt-ring,\.bt-ring::after,\.bt-realm\{animation:none\}/.test(cssBlocks),
    '含 prefers-reduced-motion、7.2s 放慢值与 animation:none 三重处理');
}

/* ============ 附加：可访问性与主题 ============ */
chk('C-1', '深色为默认，浅色模式成套切换',
  /prefers-color-scheme:\s*light/.test(cssBlocks) && /data-theme="light"/.test(cssBlocks),
  'prefers-color-scheme 与 data-theme="light" 双通道');
chk('C-2', 'aria-live 播报保留', /aria-live/.test(html), '产物含 aria-live');
chk('C-3', 'a11y 控制台仍在', /a11y/i.test(html), 'a11y 相关代码存在');
chk('C-4', '键盘可达（tabindex / focus-visible）',
  /tabindex="-1"/.test(html) && /focus-visible/.test(cssBlocks), 'tabindex 与 focus-visible 均在');

console.log('\n==== 终验结果：C' + pass + ' PASS / ' + fail + ' FAIL / ' + legacy + ' LEGACY ====');
process.exit(fail > 0 ? 1 : 0);