/**
 * 渡劫浮层 · 静态结构断言（阶段 A · ③ 步骤 2）
 *
 * 只钉结构与 R9 协同的静态前提；键盘交互、计时器、弹窗改道等逻辑
 * 在后续步骤补测。读取模板原文断言，不依赖运行时 DOM。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTs } from './helpers/load-ts.mjs';

const trib = await loadTs('src/services/tribulation.ts');
const html = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.template.html'),
  'utf8',
);

const START = html.indexOf('id="tribOverlay"');
const END = html.indexOf('</div>\n</div>', START); // overlay-card 结束附近（区域上界取下一个大段）
const region = html.slice(START, START + 1600);

test('结构1：根节点 = overlay + trib-session + hidden + 完整 dialog ARIA', () => {
  assert.ok(START > 0, 'tribOverlay 必须存在');
  const m = html.match(/<div class="overlay trib-session hidden" id="tribOverlay"[^>]*>/);
  assert.ok(m, '根节点类与 id 形态不符');
  assert.ok(m[0].includes('role="dialog"'), '缺 role=dialog');
  assert.ok(m[0].includes('aria-modal="true"'), '缺 aria-modal');
  assert.ok(m[0].includes('aria-labelledby="tribTitle"'), '缺 aria-labelledby');
  // 初始同时具备 trib-session 与 hidden：关闭态谓词为 false（全局快捷键照常）
  const classes = ['overlay', 'trib-session', 'hidden'];
  const mock = { classList: { contains: (t) => classes.includes(t) } };
  assert.strictEqual(trib.tribulationSessionYields(mock), false, '关闭态不应让位全局快捷键');
  classes.splice(classes.indexOf('hidden'), 1); // 模拟打开
  assert.strictEqual(trib.tribulationSessionYields(mock), true, '打开态应让位全局快捷键');
});

test('结构2：无障碍标题与计时器/进度静态文本', () => {
  assert.ok(region.includes('<h2 id="tribTitle" class="sr-only">渡劫挑战</h2>'), '缺 sr-only 标题');
  assert.ok(region.includes('id="tribTimer" aria-live="polite">剩余 5:00<'), '计时器须 aria-live=polite 且初值 剩余 5:00');
  assert.ok(region.includes('id="tribProgress">第 1 / 10 题'), '进度初值 第 1 / 10 题');
  assert.ok(html.includes('.sr-only{'), '页面需存在 sr-only 工具类');
});

test('结构3：题干与选项区 ARIA，且绝不用 .choice 类', () => {
  assert.ok(region.includes('id="tribStem" aria-live="polite"'), '题干 aria-live 缺失');
  assert.ok(region.includes('id="tribChoices" role="group" aria-label="渡劫选项"'), '选项组缺 role/aria-label');
  assert.ok(!region.includes('class="choice"'), '浮层内不得出现 .choice（R9：避免触发全局 hasChoices 分支语义）');
  assert.ok(!region.includes('id="choices"'), '不得复用主界面 #choices');
  assert.ok(region.includes('trib-choices'), '应使用 trib-choices 独立容器');
});

test('结构4：结果页分区初始隐藏且可播报', () => {
  assert.ok(region.includes('<section class="trib-result hidden" id="tribResult" aria-live="polite">'), '结果分区形态不符');
  for (const id of ['tribResultTitle', 'tribResultBody', 'tribResultActions']) {
    assert.ok(region.includes(`id="${id}"`), `缺 ${id}`);
  }
});

test('结构5：位置正确——在 .app 内、面板区之外、toast 之前', () => {
  const appIdx = html.indexOf('<div class="app"');
  const sideIdx = html.indexOf('id="sidePanel"');
  const toastIdx = html.indexOf('id="toast"');
  assert.ok(appIdx > 0 && appIdx < START, '浮层必须在 .app 打开之后');
  assert.ok(sideIdx > 0 && sideIdx < START, '浮层应位于布局内容之后');
  assert.ok(toastIdx > START, '浮层必须仍在 .app 内（toast 在 app 闭合之后）');
  // 不挂在 #panel-trial 内
  const trialStart = html.indexOf('id="panel-trial"');
  const trialEnd = html.indexOf('</section>', trialStart);
  assert.ok(START > trialEnd || START < trialStart, '浮层不得位于 panel-trial 内');
  assert.ok(!html.slice(trialStart, trialEnd).includes('trib-session'), 'panel-trial 内不得出现 trib-session');
});

test('结构6：全部 id 唯一', () => {
  for (const id of ['tribOverlay', 'tribTitle', 'tribTimer', 'tribProgress', 'tribStem',
    'tribChoices', 'tribResult', 'tribResultTitle', 'tribResultBody', 'tribResultActions']) {
    const n = html.split(`id="${id}"`).length - 1;
    assert.strictEqual(n, 1, `id=${id} 应唯一，实际 ${n}`);
  }
});

test('结构7：R9 门与浮层类名协同（同一字面量，遍历任一可见）', () => {
  const guardCount = html.split("document.querySelectorAll('.trib-session')").length - 1;
  assert.ok(guardCount >= 2, '两个全局 keydown 的门都以 querySelectorAll 遍历 .trib-session');
  assert.ok(html.includes('class="overlay trib-session hidden"'), '浮层根节点承载 trib-session 类');
  // 选择即确认的 CSS 钩子已在位（逻辑步骤会用）
  assert.ok(html.includes('.trib-choice.picked'), '缺选中态样式钩子');
});

test('结构8：不复用 panel-trial 的任何交互 id', () => {
  const trialStart = html.indexOf('id="panel-trial"');
  const trialEnd = html.indexOf('</section>', trialStart);
  const trial = html.slice(trialStart, trialEnd);
  for (const id of ['tribStem', 'tribChoices', 'tribTimer', 'submitSpell', 'gradeBtn']) {
    assert.ok(!region.includes(`id="${id}"`) || !trial.includes(`id="${id}"`),
      `${id} 不得在浮层与 panel-trial 双处出现`);
  }
  // 浮层不引用 trial 的推进按钮
  assert.ok(!region.includes('id="next"'), '浮层不得复用 #next');
});

/* ─────────────── 运行时接线（③ 步骤 3） ─────────────── */

function runtimeRegion() {
  const start = html.indexOf('渡劫会话运行时');
  assert.ok(start > 0, '缺少渡劫运行时脚本');
  const end = html.indexOf('</script>', start);
  return html.slice(start, end);
}

test('运行时1：keydown 注册一次 + phase/hidden 双判定 + preventDefault', () => {
  const rt = runtimeRegion();
  const listenerCount = rt.split("document.addEventListener('keydown'").length - 1;
  assert.strictEqual(listenerCount, 1, 'keydown 必须只注册一次（开关靠判定，不靠重复挂载）');
  assert.ok(rt.includes("session.phase !== 'running' || ov.classList.contains('hidden')"),
    '须 phase + hidden 双判定才接管按键');
  assert.ok(rt.includes('e.preventDefault()'), '命中 1-4 时须 preventDefault');
  assert.ok(rt.includes('T.pickFromKey(e.key)'), '按键须经纯函数映射');
  assert.ok(!rt.includes('stopPropagation'), '不得用 stopPropagation 暴力隔离');
});

test('运行时2：R9 门开合——开始移除 hidden、关闭加回 hidden', () => {
  const rt = runtimeRegion();
  assert.ok(rt.includes("ov.classList.remove('hidden')"), 'startSession 须开门（R9 让位）');
  assert.ok(rt.includes("ov.classList.add('hidden')"), 'closeSession 须关门（R9 恢复）');
  // 谓词协同：开门后 yields 为真、关门为假（语义在 tribulation.ts 已测）
  assert.strictEqual(trib.tribulationSessionYields({ classList: { contains: (t) => t !== 'hidden' } }), true);
  assert.strictEqual(trib.tribulationSessionYields({ classList: { contains: (t) => t === 'hidden' } }), false);
});

test('运行时3：计时器生命周期——setInterval 启、finish/close 双路径 stopTimer', () => {
  const rt = runtimeRegion();
  assert.ok(rt.includes('interval = setInterval'), '须有 interval 启动');
  assert.ok(rt.includes('clearInterval(interval)'), '须有 clearInterval');
  const finishIdx = rt.indexOf('function finish(reason)');
  const closeIdx = rt.indexOf('function closeSession()');
  assert.ok(finishIdx > 0 && rt.slice(finishIdx, finishIdx + 220).includes('stopTimer()'), 'finish 必须停表');
  assert.ok(closeIdx > 0 && rt.slice(closeIdx, closeIdx + 220).includes('stopTimer()'), 'close 必须停表');
  assert.ok(rt.includes("timerEl.classList.toggle('warn', T.timerWarn(left))"), '≤30s 警示接线');
  assert.ok(rt.includes('finish(\'timeout\')'), '归零必须触发结束');
});

test('运行时4：结果页与关闭清空（验收 15 内容复位）', () => {
  const rt = runtimeRegion();
  const closeIdx = rt.indexOf('function closeSession()');
  const closeBody = rt.slice(closeIdx, closeIdx + 700);
  assert.ok(closeBody.includes("stemEl.textContent = ''"), '清空题干');
  assert.ok(closeBody.includes("choiceEl.innerHTML = ''"), '清空选项');
  assert.ok(closeBody.includes("rBody.innerHTML = ''") && closeBody.includes("rActions.innerHTML = ''"), '清空结果');
  assert.ok(closeBody.includes('resultEl.classList.add'), '结果区复位隐藏');
  assert.ok(closeBody.includes("timerEl.classList.remove('warn')"), '计时样式复位');
  assert.ok(closeBody.includes("progEl.textContent = '第 1 / '"), '进度复位');
});

test('运行时5：判定接入——abandoned 语义、maxSafeDeduct、落库编排（步骤4已接）', () => {
  const rt = runtimeRegion();
  assert.ok(rt.includes("abandoned: reason !== 'complete'"), '超时与放弃同档：永不判过');
  // A2：护道符判定接入库存缓存，消耗在 persistFinish
  assert.ok(rt.includes('S.economy.talismanCount() > 0'), '护道符持有须来自库存缓存');
  assert.ok(rt.includes('S.economy.consumeTalisman()'), '扣罚抵扣后须消耗一张');
  assert.ok(rt.includes('maxSafeDeduct: (typeof realm === \'function\' ? realm().into : 0)'), '扣罚夹逼来自 realm().into');
  // 步骤4：落库已接（记录→冷却、修为扣罚、成功入账）
  assert.ok(rt.includes('persistFinish(rec, grade)'), 'finish 必须走落库编排');
  assert.ok(rt.includes("T.saveRecord(rec)"), '须写 tribulations 仓');
  assert.ok(rt.includes('已晋升（修为与灵石已入账）'), '成功结果页文案已改为入账');
  assert.ok(!rt.includes('state.qi -=') && !rt.includes('state.spirit +='), '扣罚/奖励用显式赋值（夹逼安全），不用自减自增');
});

test('运行时6：成功复用突破弹窗，且 btClose 仍为纯隐藏', () => {
  const rt = runtimeRegion();
  assert.ok(rt.includes("bt.classList.remove('hidden')"), '成功须打开既有突破弹窗');
  assert.ok(rt.includes("t.textContent = '渡劫成功'"), '文案改写为渡劫成功（btTitle 局部引用）');
  // 既有关闭绑定必须保持纯隐藏（本步已核实的复用前提）
  assert.ok(html.includes("byId('breakthroughOverlay').classList.add('hidden')"), 'btClose 绑定不得被改');
});

test('运行时7：临时启动/调试入口在位', () => {
  const rt = runtimeRegion();
  assert.ok(rt.includes('window.__tribDebugStart'), '缺启动入口');
  assert.ok(rt.includes('window.__tribDebugClose'), '缺关闭入口');
  assert.ok(rt.includes('window.__tribDebugState'), '缺状态探针');
  assert.ok(rt.includes("data-act=\"retry\""), '缺再战按钮（验收12）');
});

test('运行时8：选项类与防连点（选即确认）', () => {
  const rt = runtimeRegion();
  assert.ok(rt.includes('class="trib-choice" data-idx='), '渲染须用 trib-choice（禁 .choice）');
  assert.ok(!rt.includes('class="choice"'), '绝不得渲染 .choice');
  assert.ok(rt.includes("btns[i].classList.add('picked')"), '选中态钩子');
  assert.ok(rt.includes('b.disabled = true'), '确认后禁用防连点');
  assert.ok(rt.includes('if (session.state.locked) return;'), '锁步判定');
  assert.ok(rt.includes('if (starting) return;'), '并发启动防护');
});

/* ─────────────── 步骤 4：入口与状态集成（22 条验收的接线断言） ─────────────── */

function iifeRegion() {
  const start = html.indexOf('function refresh(showEffects)');
  assert.ok(start > 0, '缺少 refresh 调用层');
  return html.slice(start, start + 1200);
}

test('步骤4-1 改道：IIFE 三件套（defer / prompt 路由 / 刷新出口）', () => {
  const iife = iifeRegion();
  assert.ok(iife.includes('deferRealmAdvance: true'), 'record 必须以 defer 调用（位次不自动推进）');
  assert.ok(iife.includes('window.__tribulationPrompt(result.breakthrough, snapshot())'), '突破必须路由到渡劫提示');
  assert.ok(iife.includes('else showBreakthrough(result.breakthrough, result.newTitles)'), '必须保留原弹窗兜底');
  assert.ok(iife.includes('window.__refreshRealm = function'), '必须暴露刷新出口（成功后重算境界卡）');
  // 纯函数未被触碰（硬边界9）
  const realm = readTsSync('src/types/realm.ts');
  assert.ok(realm.includes('export function detectBreakthrough') && realm.includes('export function evaluateRealm'), '纯判定函数必须原样存在');
});

function readTsSync(rel) {
  return readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', rel), 'utf8');
}

test('步骤4-2 提示三态文案与按钮（验收 1/5/6 + 不弹分支）', () => {
  const rt = runtimeRegion();
  assert.ok(rt.includes("el('btTitle').textContent = '渡劫资格已开启'"), 'ok 态文案');
  assert.ok(rt.includes("el('btTitle').textContent = '渡劫冷却中'"), 'cooldown 态文案');
  assert.ok(rt.includes("el('btTitle').textContent = '已至极境'"), 'maxed 态文案');
  assert.ok(rt.includes("'剩余 ' + Math.floor(cms / 3600000)"), '冷却剩余换算');
  assert.ok(rt.includes("bClose.textContent = '稍后'") && rt.includes("bClose.textContent = '知道了'"), 'btClose 动态文案');
  assert.ok(rt.includes('bStart.classList.remove(\'hidden\')') && rt.includes('bStart.classList.add(\'hidden\')'), '「立即渡劫」显隐');
  assert.ok(rt.includes('// not-qualified → 不弹'), '未达标不弹窗分支');
});

test('步骤4-3 入口链路：提示→规则→会话；境界卡→规则（验收 2/3/4/11）', () => {
  const rt = runtimeRegion();
  assert.ok(rt.includes("el('btribStart').closest") === false && rt.includes('openRules(bStartBtn)'), '立即渡劫→规则说明');
  assert.ok(rt.includes("closest('#tribGoBtn')") && rt.includes('openRules(b)'), '境界卡渡劫按钮→规则说明');
  assert.ok(rt.includes('closeRules(); startSession({});'), '规则确认→启动会话');
  assert.ok(rt.includes("rCancel.addEventListener('click', function () { closeRules(); })"), '「再等等」关闭');
  // HTML 侧锚点（排除 <script> 区：id 的字符串字面量在运行时脚本里，不算静态 DOM）
  const staticHtml = html.replace(/<script[\s\S]*?<\/script>/g, '');
  assert.ok(!staticHtml.includes('id="tribGoBtn"'), '渡劫按钮须由运行时渲染（不在静态 HTML）');
  assert.ok(staticHtml.includes('id="tribRulesOverlay"') && staticHtml.includes('id="tribRulesStart"') && staticHtml.includes('id="tribRulesCancel"'), '规则浮层三件套在 HTML');
  assert.ok(/<div class="overlay trib-session hidden" id="tribRulesOverlay"/.test(staticHtml), '规则浮层须带 trib-session（期间全局让位）');
});

test('步骤4-4 Esc 二次确认：状态机顺序与独立浮层（验收 12-16/22）', () => {
  const rt = runtimeRegion();
  // 层序：confirm 分支 → rules 分支 → 会话 Esc→openConfirm（保证确认期不再触发弹确认）
  const iConfirm = rt.indexOf('if (confirmEl && !confirmEl.classList.contains');
  const iRules = rt.indexOf('if (rulesEl && !rulesEl.classList.contains');
  const iEsc = rt.indexOf("openConfirm(); return;");
  assert.ok(iConfirm > 0 && iRules > iConfirm && iEsc > iRules, '三层键盘状态机顺序错误');
  // 确认浮层独立类，不带 trib-session（边界：否则 R9 门语义混乱）
  assert.ok(/<div class="overlay trib-confirm hidden" id="tribConfirmOverlay"/.test(html), '确认浮层须用 trib-confirm 独立类');
  const confirmTag = html.match(/id="tribConfirmOverlay"[^>]*>/)[0];
  assert.ok(!confirmTag.includes('trib-session'), '确认浮层不得携带 trib-session');
  // 文案与动作
  assert.ok(rt.includes('放弃将按当前成绩判定，是否确认？'), '确认文案');
  assert.ok(rt.includes("finish('abandon');"), '放弃→按当前成绩判定（abandoned 兜底）');
  // 计时器在确认期间不中断
  const iOpen = rt.indexOf('function openConfirm()');
  const openBody = rt.slice(iOpen, iOpen + 500);
  assert.ok(!openBody.includes('stopTimer'), 'openConfirm 不得停表（验收16）');
  // 确认浮层 HTML 双按钮
  assert.ok(html.includes('id="tribConfirmResume"') && html.includes('id="tribConfirmAbandon"'), '继续/放弃双按钮');
});

test('步骤4-5 境界卡四态与道具摘要（验收 7-10/17-21）', () => {
  const rt = runtimeRegion();
  assert.ok(rt.includes('距离渡劫还需：词汇量 +'), '未达门槛缺口文案');
  assert.ok(rt.includes('渡劫冷却中 · 剩余 '), '冷却文案');
  assert.ok(rt.includes('已至极境'), '顶档文案');
  assert.ok(rt.includes("stEl.innerHTML = '<button type=\"button\" class=\"btn trib-go\" id=\"tribGoBtn\">⚔ 渡劫</button>'"), '有资格→渡劫按钮');
  assert.ok(rt.includes("el('tribStatus')"), '运行时经 el(tribStatus) 渲染四态');
  assert.ok(html.includes('<div class="trib-status" id="tribStatus" aria-live="polite"></div>'), '四态容器在 HTML 且 aria-live=polite');
  // 道具只读
  assert.ok(rt.includes("chips.push('护道符 x ' + sum.talisman)"), '护道符显示');
  assert.ok(rt.includes("'聚灵阵生效 · 剩余 '"), '聚灵阵显示');
  assert.ok(rt.includes('T.loadInventorySummary()'), '经服务读库存（只读）');
  // 刷新时机：初始 + 冷却自刷新（60s、可见性守卫）+ 落库后
  assert.ok(rt.includes('T.latestRecord().then'), '初始读最近记录（冷却源）');
  assert.ok(rt.includes('}, 60000);') && rt.includes("document.visibilityState !== 'hidden'"), '60s 定时刷新且非每帧（验收20）');
  assert.ok(rt.includes('persistFinish'), '落库后经 persistFinish 刷新四态（验收21）');
});

test('步骤4-6 落库编排：记录/冷却/修为/位次/灵石/历史（验收 14/21）', () => {
  const rt = runtimeRegion();
  const iPersist = rt.indexOf('function persistFinish(rec, grade)');
  assert.ok(iPersist > 0, '缺 persistFinish');
  const body = rt.slice(iPersist, iPersist + 1400);
  assert.ok(body.includes('T.saveRecord(rec)'), '写 tribulations（冷却数据源）');
  assert.ok(body.includes('state.qi = Math.max(0,'), '修为扣罚显式夹逼赋值');
  assert.ok(body.includes('state.spirit = (Number(state.spirit) || 0) + T.REWARD'), '成功灵石入账');
  assert.ok(body.includes('S.gamification.save(') && body.includes('realmIndex: session.realmTo'), '成功推进持久位次');
  assert.ok(body.includes('breakthroughs: hist.slice(-20)'), '突破史追加');
  assert.ok(body.includes('window.__refreshRealm()'), '成功后刷新洞府境界卡/称号');
  assert.ok(body.includes("typeof save === 'function'") && body.includes("typeof renderTop === 'function'"), '学习存档与侧栏刷新');
  // 放弃回主界面（验收14）
  const iFinish = rt.indexOf('function finish(reason)');
  const fbody = rt.slice(iFinish, iFinish + 2400);
  assert.ok(fbody.includes("reason === 'abandon'") && fbody.includes('closeSession();') && fbody.includes('toastMsg(summary)'), '放弃→关浮层回主界面+摘要');
  assert.ok(fbody.includes("abandoned: reason !== 'complete'"), '放弃/超时永不判过');
});

test('步骤4-7 焦点与开合卫生（ARIA/焦点回归）', () => {
  const rt = runtimeRegion();
  assert.ok(rt.includes('startBtn.focus'), '规则浮层焦点入开始按钮');
  assert.ok(rt.includes('resume.focus'), '确认浮层焦点入继续按钮');
  assert.ok(rt.includes("choiceEl.querySelector('.trib-choice:not([disabled])')"), '关闭确认回焦点到选项');
  assert.ok(rt.includes("back.focus({ preventScroll: true })"), '关浮层焦点归还渡劫入口');
  assert.ok(html.includes('id="tribOverlay" tabindex="-1"'), '会话根可编程聚焦（tabindex=-1）');
  // 门协同：关门复位规则/确认浮层
  assert.ok(rt.includes("if (rulesEl) rulesEl.classList.add('hidden');") && rt.includes("if (confirmEl) confirmEl.classList.add('hidden');"), 'closeSession 防御性复位两浮层');
});
