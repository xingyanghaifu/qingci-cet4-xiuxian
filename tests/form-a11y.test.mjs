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
  // 31 个静态控件，排除 type=hidden / 蜜罐 / display:none 后为 17
  assert.equal(total, 17, `控件总数变化（期望 17），请核对是否新增/删除了控件`);
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

test('四处原生 confirm 全部换成站内弹层', () => {
  // 全站只剩 1 处 confirm —— askConfirm 内部的降级兜底（弹层 DOM 不在时）。
  const all = [...html.matchAll(/confirm\s*\(/g)];
  assert.equal(all.length, 1, `期望只剩 1 处降级兜底，实际 ${all.length} 处`);
  const only = html.slice(Math.max(0, all[0].index - 60), all[0].index + 30);
  assert.ok(only.includes('if (!askEl) return Promise.resolve(window.confirm(text))'),
    `残留的 confirm 不在降级兜底位置：${JSON.stringify(only)}`);

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
  // `if (askConfirm(...))` 恒为真（取消无效）。
  assert.equal((html.match(/!\s*window\.askConfirm\(/g) || []).length, 0, '有 !askConfirm(...) 当布尔用');
  assert.equal((html.match(/if\s*\(\s*window\.askConfirm\(/g) || []).length, 0, '有 if (askConfirm(...)) 当布尔用');
  // 四处调用点后面都必须紧跟 .then（允许中间换行）
  const sites = [...html.matchAll(/window\.askConfirm\(/g)].filter((m) => {
    const seg = html.slice(m.index, m.index + 600);
    return /\.then\s*\(/.test(seg);
  });
  assert.equal(sites.length, 4, `期望 4 处 .then 续接，实际 ${sites.length}`);
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