/**
 * 阶段 D · UI 接线静态断言（src/index.template.html）
 *
 * 这些是「结构契约」而非运行时测试：单文件 HTML 里最容易回归的是
 * 「服务层导出没有页面消费端」「降级提示条被误删」「导航项被偷偷加到 9 个」。
 * 这里逐条钉死，保证后续改动破坏接线时 CI 立刻失败。
 *
 * 注意：断言只约束「阶段 D 自己的脚本块 / 自己插入的容器」，
 * 不用整文件正则去扫，避免牵连既有模块（group.ts 的 memberId、buyItem 的裸扣灵石等）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(ROOT, 'src', 'index.template.html'), 'utf8');

/** 取出 panel-map 的 HTML 片段（到紧随其后的 </section> 为止） */
function panelMap() {
  const start = html.indexOf('<section class="panel hidden" id="panel-map">');
  assert.ok(start > 0, 'panel-map 应存在');
  const end = html.indexOf('</section>', start);
  return html.slice(start, end);
}

/** 阶段 D 自己的脚本块 */
function stageD() {
  const start = html.indexOf('/* 阶段 D · 道友互动 UI');
  assert.ok(start > 0, '阶段 D 脚本块缺失');
  return html.slice(start);
}

const MAP = panelMap();
const D_UI = stageD();

test('UI 接线：论剑区消费 S.duel（建局/记分/列表/奖励）', () => {
  assert.match(MAP, /id="duelPeers"/, '论剑区缺道友列表容器');
  assert.match(MAP, /id="duelList"/, '论剑区缺对局列表容器');
  assert.ok(D_UI.includes('S.duel'), '页面须引用 duel 命名空间');
  assert.match(D_UI, /D\.create\(/, '缺论剑建局调用');
  assert.match(D_UI, /D\.record\(/, '缺论剑记分调用');
  assert.match(D_UI, /D\.list\(/, '缺论剑列表调用');
  assert.match(D_UI, /D\.reward\(/, '缺论剑奖励入账调用');
});

test('UI 接线：传功区消费 S.transmission（选词/建档/奖励/记录）', () => {
  assert.match(MAP, /id="txWordSelect"/, '传功区缺选词器');
  assert.match(MAP, /id="txPeerSelect"/, '传功区缺选道友器');
  assert.match(MAP, /id="txList"/, '传功区缺记录列表');
  assert.ok(D_UI.includes('S.transmission'), '页面须引用 transmission 命名空间');
  assert.match(D_UI, /TX\.create\(/, '缺传功建档调用');
  assert.match(D_UI, /TX\.reward\(/, '缺传功奖励入账调用');
  assert.match(D_UI, /TX\.list\(/, '缺传功记录调用');
  // 熟练度门槛与「每词只传一次」须在 UI 层可见（候选剔除 + 文案）
  assert.match(D_UI, /MIN_PROFICIENCY/, '未按熟练度门槛过滤可传词');
  assert.match(D_UI, /__txSent/, '未剔除已外传的词');
});

test('UI 接线：联手斩魔区消费 S.joint（发起/记分/结算/列表）', () => {
  assert.match(MAP, /id="jointPeers"/, '联手区缺道友列表容器');
  assert.match(MAP, /id="jointList"/, '联手区缺战绩列表');
  assert.ok(D_UI.includes('S.joint'), '页面须引用 joint 命名空间');
  assert.match(D_UI, /J\.create\(/, '缺联手发起调用');
  assert.match(D_UI, /J\.record\(/, '缺联手记分调用');
  assert.match(D_UI, /J\.settle\(/, '缺联手结算调用（成败奖励/降级）');
  assert.match(D_UI, /J\.list\(/, '缺联手战绩调用');
});

test('UI 接线：道场建设区消费 S.sect（三设施/进度/预设/总捐献）', () => {
  assert.match(MAP, /id="facGrid"/, '道场区缺设施卡片容器');
  assert.match(MAP, /id="sectTotal"/, '道场区缺总捐献展示');
  assert.ok(D_UI.includes('S.sect'), '页面须引用 sect 命名空间');
  assert.match(D_UI, /SC\.FACILITIES/, '未遍历三设施定义');
  assert.match(D_UI, /SC\.load\(/, '缺道场读取');
  assert.match(D_UI, /SC\.donate\(/, '缺捐献调用');
  assert.match(D_UI, /SC\.percent\(/, '缺进度百分比换算');
  assert.match(D_UI, /SC\.PRESETS/, '缺预设档位');
  // 「+全部」档位：一次捐到造价上限
  assert.match(D_UI, /data-amt="all"/, '缺「+全部」预设档位');
});

test('UI 接线：设施进度条带 aria-valuenow（屏幕阅读器可读进度）', () => {
  assert.match(D_UI, /role="progressbar"/, '缺 progressbar 语义');
  assert.match(D_UI, /aria-valuenow="'\s*\+\s*pct/, '进度条未绑定 aria-valuenow');
  assert.match(D_UI, /aria-valuemin="0"/, '缺 aria-valuemin');
  assert.match(D_UI, /aria-valuemax="100"/, '缺 aria-valuemax');
});

test('UI 接线：四个新区块均有 aria-label，且用 role=group 不占 landmark', () => {
  for (const label of ['论剑：与道友切磋', '传功：把已精通的词传给道友', '联手斩魔：与道友合力镇压心魔', '道场建设：捐献灵石共建三处设施']) {
    assert.ok(html.includes('aria-label="' + label + '"'), '缺 aria-label：' + label);
  }
  const groups = MAP.match(/class="sect-panel" role="group"/g) || [];
  assert.equal(groups.length, 4, '应有 4 个 sect-panel 分组区块');
  // 不得用 <section> 抢占 panel-map 内首个 </section>（会破坏心魔录面板的既有定位断言）
  assert.ok(!MAP.includes('<section class="sect-panel"'), 'sect-panel 应用 div 而非 section');
});

test('本机模式降级：提示条存在，文案合规，且由 feature flag 驱动', () => {
  assert.match(MAP, /id="peerOffline"/, '缺本机模式提示条');
  assert.ok(html.includes('当前为本机模式，跨设备功能需要联网'), '提示文案缺失（验收要求逐字可预期）');
  assert.match(D_UI, /isEnabled\('D1_MULTIPLAYER_ENABLED'\)/, '降级未由 D1_MULTIPLAYER_ENABLED 驱动');
  // 开关关闭时隐藏提示条（本机模式时不显示联网提示）
  assert.match(D_UI, /off\.hidden = multiplayer\(\)/, '提示条显隐未接开关');
  assert.match(MAP, /role="status"/, '提示条缺 role=status（屏幕阅读器播报）');
});

test('开关保持关闭：D1_MULTIPLAYER_ENABLED 默认 false，且未在任何地方被置真', () => {
  const features = readFileSync(resolve(ROOT, 'src', 'config', 'features.ts'), 'utf8');
  assert.match(features, /D1_MULTIPLAYER_ENABLED:\s*false/, '默认必须为 false');
  assert.ok(!/D1_MULTIPLAYER_ENABLED:\s*true/.test(html), '页面不得把跨用户开关置真');
  assert.ok(!/D1_MULTIPLAYER_ENABLED:\s*true/.test(features), '配置不得把跨用户开关置真');
});

test('导航项为 9：role=tab 与 data-tab 计数同步（v1.8.1 新增灵田）', () => {
  const tabs = (html.match(/role="tab"/g) || []).length;
  assert.equal(tabs, 9, 'role="tab" 应为 9（实际 ' + tabs + '）');
  const dataTabs = new Set((html.match(/data-tab="[a-z]+"/g) || []).map((s) => s.slice(10, -1)));
  assert.equal(dataTabs.size, 9, 'data-tab 去重后应为 9（实际 ' + dataTabs.size + '）');
});

test('保留既有「问道斗法」面板作为独立入口', () => {
  assert.ok(html.includes('id="panel-duel"'), '问道斗法面板被移除');
  assert.ok(html.includes('id="startDuel"'), '问道斗法开始按钮被移除');
  assert.ok(html.includes('id="duelChoices"'), '问道斗法答题区被移除');
});

test('隐私边界：阶段 D 不构造也不展示任何身份标识', () => {
  // 本机模式用拟人昵称；阶段 D 不得出现 memberId（既有 group.ts 小组功能不受此约束）
  const offenders = (D_UI.match(/memberId/g) || []).length;
  assert.equal(offenders, 0, '阶段 D 不得出现 memberId（实际 ' + offenders + ' 处）');
  // 内部比对 winnerId/challengerId 判胜负是允许的（不外传），
  // 但绝不能把它们拼进 innerHTML——界面只回昵称。
  const rendered = D_UI.match(/esc\((?:d|r|rec)\.(?:winnerId|challengerId|opponentId|partnerId|initiatorId)\)/g) || [];
  assert.deepEqual(rendered, [], '不得把对局身份字段写入界面：' + rendered.join(', '));
  // 也不得用裸拼接（未经 esc）暴露
  const rawConcat = D_UI.match(/'\s*\+\s*(?:d|r|rec)\.(?:winnerId|challengerId|opponentId|partnerId|initiatorId)\s*\+/) || [];
  assert.deepEqual(rawConcat, [], '不得裸拼接身份字段：' + rawConcat.join(', '));
});

test('奖励走 economy 服务（灵石入流水），阶段 D 无裸增减灵石', () => {
  assert.match(D_UI, /D\.reward\(/, '论剑奖励须经 service（入流水）');
  assert.match(D_UI, /TX\.reward\(/, '传功奖励须经 service（入流水）');
  assert.ok(!/state\.spirit\s*(\+=|-=|=\s*state\.spirit)/.test(D_UI), '阶段 D 不得裸增减灵石');
});

test('键盘可达：阶段 D 交互元素均为原生 button/select', () => {
  assert.ok(!MAP.includes('role="button"'), '新区块不应使用 div role=button');
  // data-* 绑定在 JS 生成的 markup 模板里
  assert.match(D_UI, /actAttr\s*\+\s*'="/, '缺论剑/联手的 data 属性绑定');
  assert.match(D_UI, /data-fac-donate="/, '捐献按钮缺 data-fac-donate 绑定');
  assert.match(D_UI, /type="button"/, '新区块按钮缺 type=button');
  // Esc 关闭浮层是全局既有行为（overlay keydown），此处确认未被破坏
  assert.match(html, /Escape/, 'Esc 关闭浮层的全局处理缺失');
});

test('样式走既有水墨 token，未引入新的硬编码色值', () => {
  const start = html.indexOf('/* ── 阶段 D');
  assert.ok(start > 0, '阶段 D 样式块缺失');
  const sectCss = html.slice(start, html.indexOf('</style>', start));
  // 只允许 color-mix(var(--token)) 与 var(--token)，不允许裸 #hex
  const rawHex = sectCss.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  assert.deepEqual(rawHex, [], '阶段 D 样式含硬编码色值：' + rawHex.join(', '));
  assert.ok(sectCss.includes('var(--gold)') && sectCss.includes('var(--jade)'), '未使用既有 token');
});

test('注入的产物含阶段 D 区块（构建后仍自包含）', () => {
  const distHtml = readFileSync(resolve(ROOT, 'dist', 'index.html'), 'utf8');
  assert.ok(distHtml.includes('id="peerDetails"'), '产物缺道友互动区块');
  assert.ok(distHtml.includes('id="facGrid"'), '产物缺道场卡片容器');
  assert.ok(distHtml.includes('当前为本机模式，跨设备功能需要联网'), '产物缺本机模式提示');
});