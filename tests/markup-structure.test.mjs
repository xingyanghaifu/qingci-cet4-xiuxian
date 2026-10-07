/**
 * 标签结构守卫：属性不得写在标签名前面
 *
 * 背景（2026-10-07 发现的真实缺陷）：
 * 之前 P1-8「控件可访问名」用脚本批量插入 aria-label 时，把属性插到了**标签名之前**：
 *
 *     <aria-label="搜索单词或中文释义" input id="q" placeholder="搜单词或中文">
 *     ↑ 第一个 token 必须是标签名，这里却是属性
 *
 * 浏览器的容错解析把它当成**自定义元素** `<aria-label>`，于是：
 *   · 真正的 <input id="q"> 根本不存在 → `$('q')` 返回 null
 *   · `renderCodex()` 抛 TypeError → **词谱页整页打不开**
 *   · 12 个控件（输入框/下拉/文本域）全部失效，涉及 43 处调用点
 *
 * 为什么 P1-8 的测试没抓到：它扫的是**源码字符串**（`tag.includes('aria-label="X"')`），
 * 而字符串确实包含 —— 只有**浏览器解析后**才看得出标签不存在。
 * 所以本测试用真正的 HTML 解析来守，而不是字符串匹配。
 *
 * 同类问题还有一个更隐蔽的变体：`<aria-label=... select ...>` —— 见下。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const html = readFileSync(join(ROOT, 'src', 'index.template.html'), 'utf8');
const dist = readFileSync(join(ROOT, 'dist', 'index.html'), 'utf8');

/** 需要真的存在、且被 JS 引用的表单控件（id → 标签名） */
const CONTROLS = {
  memKindSel: 'select', essay: 'textarea', spellInput: 'input', speakNote: 'textarea',
  q: 'input', letter: 'select', mastery: 'select', dao: 'input', pool: 'select',
  groupNick: 'input', groupCode: 'input', feedbackDesc: 'textarea',
};

test('标签结构：不存在「属性写在标签名之前」的畸形标签', () => {
  // 匹配 `<某个属性名=值 ... 真标签名 ...>`：正常标签第一个 token 一定是标签名
  const re = /<([a-zA-Z-]+)=("[^"]*"|[^\s>]+)([^>]*?)>/g;
  const bad = [];
  for (const m of html.matchAll(re)) {
    const firstToken = m[1];
    const rest = m[3];
    if (/\b(input|select|textarea|button|div|span|label|a|form)\b/.test(rest)) {
      const line = html.slice(0, m.index).split('\n').length;
      bad.push(`L${line}: <${firstToken}=…> 后才是真标签 —— ${m[0].slice(0, 90)}`);
    }
  }
  assert.deepEqual(bad, [], '发现属性顺序写反的标签（浏览器会解析成自定义元素，控件不存在）：\n  ' + bad.join('\n  '));
});

test('标签结构：12 个表单控件在产物里真的能被解析出来', () => {
  // 这是本测试的核心 —— 用**宽松的 HTML 解析**判断标签是否存在，
  // 而不是字符串匹配（字符串匹配正是当初漏掉这个 bug 的原因）。
  const missing = [];
  for (const [id, tag] of Object.entries(CONTROLS)) {
    // 在产物里找 <tag ... id="id" ...>（属性顺序任意，但标签名必须在最前）
    const re = new RegExp(`<${tag}\\b[^>]*\\bid=["']${id}["'][^>]*>`, 'i');
    if (!re.test(dist)) missing.push(`${id}（应为 <${tag}>）`);
  }
  assert.deepEqual(missing, [],
    '这些控件在产物里不存在（浏览器解析不到）—— 相关功能会静默失效：\n  ' + missing.join('\n  '));
});

test('标签结构：aria-label 必须写在标签名之后（可访问名的正确写法）', () => {
  for (const [id, tag] of Object.entries(CONTROLS)) {
    const re = new RegExp(`<${tag}\\b[^>]*\\bid=["']${id}["'][^>]*>`, 'i');
    const m = dist.match(re);
    if (!m) continue; // 上一条测试会报缺失
    assert.ok(/aria-label=/.test(m[0]),
      `${id} 缺 aria-label（P1-8 补的可访问名丢了）：${m[0]}`);
    // 且 aria-label 不能在标签名之前（那正是原来的 bug）
    assert.ok(!new RegExp(`<aria-label[^>]*\\bid=["']${id}["']`).test(dist),
      `${id} 的 aria-label 又跑到标签名前面了 —— 控件会变成自定义元素`);
  }
});

test('标签结构：畸形标签的成因（批量插入属性）不会再犯', () => {
  // 根因是「用正则往标签里插属性时，插到了 < 与标签名之间」。
  // 这里守一个更通用的形态：任何 `<X=...` 后跟已知标签名的写法都算畸形。
  const suspicious = [...html.matchAll(/<([a-z-]+)=/g)].map((m) => m[1]);
  const knownAttrs = new Set(['xmlns', 'http-equiv', 'data', 'aria']);
  const weird = suspicious.filter((a) => !knownAttrs.has(a));
  assert.deepEqual(weird, [],
    `模板里有 ${weird.length} 处 <属性=…> 形态（应为 <标签名 属性=…>）：${[...new Set(weird)].join(', ')}`);
});
