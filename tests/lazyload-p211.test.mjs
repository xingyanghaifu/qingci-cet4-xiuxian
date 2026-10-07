/**
 * P2-11 · 题库/音频清单的加载时机（审计第 11 项）
 *
 * 审计原文：「`question-bank.json` 6.5 MB、`audio/tts/manifest.json` 1.5 MB」，建议分片。
 *
 * 实测后**两个文件的性质完全不同**，不能一起谈：
 *
 * | 文件 | 首屏是否请求 | 说明 |
 * |---|---|---|
 * | `question-bank.json` 6.23 MB | **否** | 已懒加载（点「开考」才 `load()`），且落 IDB；实测第二次进入不重复下载 |
 * | `audio/tts/manifest.json` 1.43 MB（256 KB gzip / **908 ms**） | **是**（改前） | 启动时就 fetch，只为决定一个按钮显不显示 |
 *
 * 所以真正在首屏关键路径上的是**音频清单**，不是题库。本轮把音频清单改为
 * 按需加载（听力面板首次出现时才拉）。
 *
 * 顺带修好一个**静默失效的功能**：`pickTtsSrc()` 查的是模块内 `ttsSync`，
 * 而 `ttsSync` 只由 `warmTts()` 赋值 —— 但 `warmTts()` 全项目从未被调用过。
 * 结果「真实音频」按钮即使显示出来，点了也永远提示「当前题暂无生成音频」。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const html = readFileSync(join(ROOT, 'src', 'index.template.html'), 'utf8');
const dist = readFileSync(join(ROOT, 'dist', 'index.html'), 'utf8');
const audioSources = readFileSync(join(ROOT, 'src', 'services', 'audio-sources.ts'), 'utf8');

/* ---------------- 首屏不得加载音频清单 ---------------- */

test('P2-11：启动时不再无条件 fetch 音频清单（改为按需）', () => {
  // 旧写法：顶层直接 S.audioSources.loadTts().then(...)
  // 新写法：包在 warmTtsManifest() 里，由 MutationObserver 触发
  assert.ok(/function warmTtsManifest\(\)/.test(html), '未找到 warmTtsManifest()');
  assert.ok(!/^\s*S\.audioSources\.loadTts\(\)\.then/m.test(html),
    '模板里仍有顶层 loadTts() 调用 —— 首屏会拉 256 KB 清单');

  // 关键：warmTtsManifest 只能在「audioDock 变可见」的路径里被调用，
  // 不能在 IIFE 顶层无条件调用（否则又回到首屏加载）。
  // 用变异测试校准过：只查「存在 MutationObserver」是抓不住这个的。
  const iifeStart = html.indexOf('任务 D：音频素材界面接线');
  const iifeEnd = html.indexOf('})();', iifeStart);
  assert.ok(iifeStart > 0 && iifeEnd > iifeStart, '未定位到音频接线 IIFE');
  const iife = html.slice(iifeStart, iifeEnd);
  const calls = [...iife.matchAll(/^\s*warmTtsManifest\(\);/gm)].map((m) => m.index);
  assert.deepEqual(calls, [],
    `warmTtsManifest() 在 IIFE 顶层被无条件调用了 ${calls.length} 次 —— 首屏仍会加载清单`);
  // 它应只出现在 MutationObserver 回调与降级 click 里（缩进更深）
  assert.ok(/if \(!dock\.classList\.contains\('hidden'\)\) \{ warmTtsManifest\(\);/.test(iife),
    '未在「dock 变可见」时调用 warmTtsManifest()');
});

test('P2-11：音频清单由 audioDock 首次可见时触发', () => {
  // 必须真的构造 MutationObserver（不是同名的假对象）。
  // 变异测试校准过：只查 /new MutationObserver\(/ 会被
  // 「({observe:...}); void (function () {」这类替换骗过，所以连 observe 一起查。
  assert.ok(/var mo = new MutationObserver\(function \(\) \{/.test(html),
    '未真正构造 MutationObserver（赋值给 mo 并传入回调）');
  assert.ok(/mo\.observe\(dock,\s*\{\s*attributes:\s*true,\s*attributeFilter:\s*\['class'\]\s*\}\)/.test(html),
    'MutationObserver 未以正确参数 observe(dock, {attributes, attributeFilter:[class]})');
  // 无 MutationObserver 的降级路径：点「播放听力」时预热
  assert.ok(/addEventListener\('click',\s*warmTtsManifest/.test(html),
    '缺少无 MutationObserver 时的降级路径');
  // 只加载一次
  assert.ok(/ttsWarmed/.test(html), '缺少「只加载一次」的标记');
  assert.ok(/if \(ttsWarmed\) return;/.test(html), 'ttsWarmed 未用于短路');
});

/* ---------------- warmTts 必须被调用（静默失效的功能） ---------------- */

test('P2-11：必须调 warmTts()，否则 pickTtsSrc() 恒为 null', () => {
  // pickTtsSrc 查的是模块内 ttsSync，而 ttsSync 只由 warmTts() 赋值。
  // 这条断言守的就是那个「按钮显示正常、点了没反应」的静默 bug。
  assert.ok(/export async function warmTts\(\)/.test(audioSources), 'audio-sources.ts 缺 warmTts');
  assert.ok(/ttsSync\s*=\s*await loadTtsManifest\(\)/.test(audioSources),
    'warmTts 应把清单写入 ttsSync');
  assert.ok(/if \(!ttsSync \|\| !questionId/.test(audioSources),
    'pickTtsSrc 应依赖 ttsSync');
  // 模板侧必须真的调用 warmTts
  assert.ok(/S\.audioSources\.warmTts\(\)/.test(html),
    '模板从未调用 warmTts() —— pickTtsSrc() 会恒返回 null（真实音频按钮点了没反应）');
  // 关键：warmTtsManifest() 内部必须是 warmTts()，不能是 Promise.resolve() 之类
  // （变异测试校准过：只查「全文出现过 warmTts()」抓不住把这一处换成空 promise）
  const fn = html.match(/function warmTtsManifest\(\)\s*\{[\s\S]*?\n  \}/);
  assert.ok(fn, '未定位到 warmTtsManifest() 函数体');
  assert.ok(/S\.audioSources\.warmTts\(\)/.test(fn[0]),
    `warmTtsManifest() 内没有调 warmTts()（只调 loadTts() 不会给 ttsSync 赋值）：${fn[0].slice(0, 200)}`);
});

test('P2-11：真实音频按钮的点击处理会先等清单就绪', () => {
  // 清单按需加载后，用户可能在就绪前点击 → 必须先 await warmTts 再取 src
  const handler = html.match(/realBtn\.addEventListener\('click',[\s\S]*?\n  \}\);/);
  assert.ok(handler, '未找到真实音频点击处理器');
  assert.ok(/warmTts\(\)/.test(handler[0]), '点击处理器未先等 warmTts()');
  assert.ok(/pickTtsSrc/.test(handler[0]), '点击处理器未取 src');
  assert.ok(/\.catch\(/.test(handler[0]), '点击处理器缺少失败兜底');
});

/* ---------------- 题库本来就是懒加载（记录事实，防止被「优化」坏） ---------------- */

test('P2-11：题库仍是懒加载，且不进单文件（这两点不能被改坏）', () => {
  // question-bank.json 不在首屏关键路径上：load() 由「开考」触发
  assert.ok(/__QINGCI_BANK__\.load\(\)/.test(html), '题库 load() 调用点丢了');
  assert.ok(/examBankPending/.test(html), '题库「是否待载入」的判断丢了');
  // 6.23 MB 绝不能内联进单文件
  const bankInline = /question-bank/i.test(dist) && dist.length > 6 * 1024 * 1024;
  assert.ok(!bankInline, '题库疑似被内联进单文件（体积会爆）');
});

test('P2-11：交付决策阈值仍在（题库超阈值必须 separate）', () => {
  const builder = readFileSync(join(ROOT, 'scripts', 'build-question-bank.mjs'), 'utf8');
  assert.ok(/export function decideDelivery/.test(builder), '缺 decideDelivery');
  assert.ok(/1\.5 \* 1024 \* 1024/.test(builder), '阈值 1.5 MB 被改动');
  assert.ok(/mode: 'separate'/.test(builder) && /mode: 'inline'/.test(builder),
    '两种交付模式应都在');
});

/* ---------------- 产物 ---------------- */

test('P2-11：产物里也是按需加载（防止只改模板没重新构建）', () => {
  assert.ok(/function warmTtsManifest\(\)/.test(dist), '产物缺 warmTtsManifest()');
  assert.ok(!/^\s*S\.audioSources\.loadTts\(\)\.then/m.test(dist),
    '产物里仍有顶层 loadTts() 调用');
  assert.ok(/S\.audioSources\.warmTts\(\)/.test(dist), '产物缺 warmTts() 调用');
});
