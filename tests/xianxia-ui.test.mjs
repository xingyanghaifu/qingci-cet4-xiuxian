/**
 * 修仙视觉升华 + 图标统一（v1.8.1 谕令二 / 谕令三）接线测试
 *
 * 验收点：
 *   1. 云纹底存在并挂到 <body>；
 *   2. 面板符角（伪元素八折角）与顶部灵光存在；
 *   3. section-label 有印章标记 + 云头分隔已插入（数量与标签一致）；
 *   4. 排版：标题/境界字距 + 面板标题金砂细线；
 *   5. v1.8.1 新增样式块内零硬编码色值（hex / rgb() / 命名色）；
 *   6. v1.8.1 新增过渡时长落在 200–400ms；
 *   7. 循环动效只有成熟灵植呼吸一处，其余被 reduced-motion 掐停；
 *   8. 无新增外部资源（不引图片/字体/脚本 URL）。
 *
 * 边界口径：只取带 `v1.8.1:STAGE*:BEGIN/END` 哨兵的新增样式片段，
 * 不把 v1.8.0 已存在的 rgba / .18s 过渡算进本轮（那些是既有代码，本轮不改）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(ROOT, 'src', 'index.template.html'), 'utf8');

/** 取出所有哨兵片段（stage2 出现两段：plotBreath 兜底 + 图标基线；stage3 一段） */
function sentinelBlocks(stage) {
  const out = [];
  let from = 0;
  for (;;) {
    const b = html.indexOf(`v1.8.1:${stage}:BEGIN`, from);
    if (b < 0) break;
    const e = html.indexOf(`v1.8.1:${stage}:END`, b);
    assert.ok(e > b, `${stage} 哨兵未闭合`);
    out.push(html.slice(b, e));
    from = e;
  }
  return out;
}

const icBlocks = sentinelBlocks('STAGE2');
const visualBlocks = sentinelBlocks('STAGE3');
const icBlock = icBlocks.join('\n');
const visualBlock = visualBlocks.join('\n');

/** plotBreath 关键帧紧随 STAGE2 兜底片段，单独取出（它是动效基准，不算颜色） */
const iBreath = html.indexOf('@keyframes plotBreath');
const block = icBlock + visualBlock;
const breathKeyframes = iBreath >= 0 ? html.slice(iBreath, html.indexOf('}', iBreath) + 1) : '';

test('哨兵完整：STAGE2 五段 + STAGE3 一段', () => {
  assert.strictEqual(icBlocks.length, 5, `STAGE2 哨兵应 5 段（呼吸兜底 / 图标基线 / 作物 / 心魔 / 道场），实得 ${icBlocks.length}`);
  assert.strictEqual(visualBlocks.length, 1, `STAGE3 哨兵应 1 段，实得 ${visualBlocks.length}`);
  assert.ok(icBlock.includes('.ic{'), '缺 .ic 基线规则');
  assert.ok(visualBlock.length > 2000, `谕令三视觉块过短（${visualBlock.length} 字节）`);
  assert.ok(breathKeyframes.includes('@keyframes plotBreath'), '缺 plotBreath 关键帧');
  // 哨兵只包本轮新增规则：不得把 v1.8.0 既有 rgba 声明圈进来
  assert.ok(!icBlock.includes('rgba(0,0,0,.4)'), '哨兵圈入了既有 .nav-menu 阴影');
});

test('云纹底：规则存在并挂到 body', () => {
  assert.ok(html.includes('.cloud-weave{'), '缺 .cloud-weave 云纹规则');
  assert.ok(html.includes('repeating-linear-gradient(118deg'), '云纹须含织纹层（不依赖图片）');
  assert.ok(html.includes('<body class="cloud-weave">'), 'body 未挂 cloud-weave');
  assert.ok(html.includes('body.cloud-weave{background-color:var(--bg)}'), '云纹底未垫底色');
});

test('面板灵光 + 如意角（ruyi corner）', () => {
  assert.ok(html.includes('.panel::before,.seal::before{'), '缺面板顶部灵光');
  assert.ok(html.includes('.panel::after,.seal::after{'), '缺如意角伪元素');
  const after = html.slice(html.indexOf('.panel::after,.seal::after{'));
  const seg = after.slice(0, after.indexOf('}'));
  /* v1.15：如意角从「8 段直线拼的 L 形折线」改为**真正的如意云头 SVG mask**。
     原实现只是两条直线拼直角，形制上不是如意纹（传统如意是三卷云头）。
     断言改为：四角各一枚 SVG mask，且用 --gold 上色。 */
  /* ⚠️ 是 8 不是 4 —— 因为同时写了 `-webkit-mask` 与 `mask`（各 4 个角，
     为兼容新旧浏览器）。断言按「每套 4 角」检查。 */
  const ruyiMasks = (seg.match(/url\("data:image\/svg\+xml/g) || []).length;
  assert.strictEqual(ruyiMasks, 8, `如意角应为四角 × (webkit+标准) = 8 枚 SVG mask（实得 ${ruyiMasks}）`);
  assert.ok(/background:var\(--gold\)/.test(seg), '如意角须用 --gold 上色');
  assert.ok(/left top/.test(seg) && /right bottom/.test(seg), '如意角须四角定位（left top … right bottom）');
  assert.ok(html.includes('.panel:hover::after,.seal:hover::after{opacity:.92}'), '缺如意角悬停增益');
});

test('印章标记：section-label 左侧朱印 + 金砂字距', () => {
  assert.ok(html.includes('.section-label::before{'), '缺印章底框');
  assert.ok(html.includes('border:1.5px solid color-mix(in srgb,var(--accent-cinnabar) 62%,transparent);'), '印章须用朱砂 token');
  assert.ok(html.includes('.section-label::after{'), '缺印章内折角');
  assert.ok(/padding-left:26px;letter-spacing:\.22em;/.test(html), '印章未留出左侧间距/字距');
});

test('云头分隔：每个 section-label 后都有一条', () => {
  const labels = (html.match(/<p class="section-label">/g) || []).length;
  const rules = (html.match(/<span class="cloud-rule" aria-hidden="true"><\/span>/g) || []).length;
  assert.ok(labels >= 15, `section-label 数量异常（${labels}）`);
  assert.strictEqual(rules, labels, '云头分隔数量须与 section-label 一致');
  assert.ok(html.includes('.cloud-rule{'), '缺 .cloud-rule 规则');
  assert.ok(html.includes('<span class="cloud-rule" aria-hidden="true">'), '云头分隔须 aria-hidden');
});

test('排版：标题字距 + 面板标题金砂细线', () => {
  assert.ok(html.includes('.panel>h2,.seal>b,#mainTitle{letter-spacing:.07em}'), '缺标题字距');
  assert.ok(html.includes('.panel>h2::after{'), '缺面板标题金砂细线');
  assert.ok(html.includes('box-shadow:0 0 8px color-mix(in srgb,var(--gold) 35%,transparent);'), '标题细线缺微光');
});

test('新增样式块零硬编码色值（全部 token / color-mix）', () => {
  const hex = block.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  assert.deepStrictEqual(hex, [], `v1.8.1 新增样式块出现硬编码色值：${hex.join(', ')}`);
  const raw = block.match(/\brgba?\(/g) || [];
  assert.deepStrictEqual(raw, [], `v1.8.1 新增样式块出现硬编码 rgb：${raw.join(', ')}`);
  const named = block.match(/:\s*(white|black|red|gold|jade|silver)\b/gi) || [];
  assert.deepStrictEqual(named, [], `v1.8.1 新增样式块出现命名色：${named.join(', ')}`);
  assert.ok(block.includes('var(--gold)') || block.includes('var(--jade)'), '样式块须使用既有 token');
});

test('新增过渡时长落在 200–400ms', () => {
  // 口径：`transition:` 声明里出现的每一个时长。
  // 先剥掉缓动函数（cubic-bezier/. 里的秒数不是时长），再逐条扫描剩余的 `.Ns`。
  const decls = [...block.matchAll(/transition:([^;}]+)/g)].map((m) =>
    m[1].replace(/cubic-bezier\([^)]*\)/g, '').replace(/\bease(?:-in-out)?\b|\bin\b|\bout\b|\blinear\b/g, ''),
  );
  assert.strictEqual(decls.length, 4, `v1.8.1 应有 4 条新过渡声明，实得 ${decls.length}`);
  const values = decls.flatMap((d) => [...d.matchAll(/(?<![\d.])\.(\d{1,3})s/g)]).map((x) => Number('0.' + x[1]) * 1000);
  assert.ok(values.length >= 8, `时长值应 ≥ 8 个，实得 ${values.length}：${values.join(', ')}`);
  for (const t of values) {
    assert.ok(t >= 200 && t <= 400, `过渡时长 ${t}ms 超出 200–400ms 区间`);
  }
});

test('循环动效仅成熟灵植呼吸；其余由 reduced-motion 掐停', () => {
  // 唯一允许的 infinite 声明 = 成熟灵植呼吸（常规档 + 两档 reduced-motion 兜底）
  const infinite = [...block.matchAll(/animation:[^;}]*infinite[^;}]*/g)].map((m) => m[0]);
  assert.strictEqual(infinite.length, 3, `无限循环动效应恰好 3 条（成熟灵植呼吸），实得 ${infinite.length}：${infinite.join(' | ')}`);
  for (const decl of infinite) {
    assert.ok(decl.includes('plotBreath'), `非成熟灵植的无限动效：${decl}`);
  }
  // 全局 reduced-motion 兜底仍在
  assert.ok(html.includes('@media (prefers-reduced-motion:reduce){'), '缺 prefers-reduced-motion 兜底');
  assert.ok(html.includes(':root[data-motion="reduced"] *'), '缺站内「减少动态」偏好兜底');
  // reduced-motion 下成熟灵植呼吸仍保留但频率放慢到 7.2s
  assert.ok(
    html.includes('@media (prefers-reduced-motion:reduce){.plot.mature .plot-art{animation:plotBreath 7.2s ease-in-out infinite!important}}'),
    'reduced-motion 下成熟灵植呼吸未保留（或频率未放慢）',
  );
  // 装饰性元素（印章/符角/云纹）一律无动画
  const decoAnimated = block.match(/\.(section-label|cloud-rule)[^{]*\{[^}]*animation:/g) || [];
  assert.deepStrictEqual(decoAnimated, [], `装饰性元素不得动画：${decoAnimated.join(' | ')}`);
});

test('可访问性：焦点金框只加强不削弱', () => {
  assert.ok(html.includes(':focus-visible{outline:2px solid var(--gold);outline-offset:3px;'), '缺强化焦点样式');
  assert.ok(html.includes('color-mix(in srgb,var(--gold) 18%,transparent)'), '焦点环缺外扩柔光');
});

test('零外部资源：不引图片/字体/脚本外链', () => {
  assert.ok(!/url\((?!['"]?data:)/.test(visualBlock), '谕令三样式块不得引用外部 url()');
  // 只拦「会拉取外部资源的 link」。canonical 是纯元数据（告诉搜索引擎本站
  // 规范地址在哪），og:image 走 meta 而非 link —— 两者都不产生网络请求，
  // 与「单文件、零外部依赖」这条硬约束无关，不能一并拦掉（2026-10-06 加 canonical 时修正）。
  const RESOURCE_RELS = new Set(['stylesheet', 'preload', 'prefetch', 'preconnect', 'dns-prefetch', 'modulepreload']);
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    if (!/href="https?:/i.test(tag)) continue;
    const rel = (tag.match(/rel="([^"]+)"/i) || [])[1] || '';
    assert.ok(!RESOURCE_RELS.has(rel.toLowerCase()),
      `不得新增外部资源链接（会发起网络请求，破坏单文件约束）：${tag.slice(0, 120)}`);
  }
  assert.ok(!/<script[^>]+src="https?:/i.test(html), '不得新增外部脚本');
  assert.ok(!/<img[^>]+cloud/i.test(html), '云纹不得走位图');
});

test('移动端：符角内收，避免压内容', () => {
  assert.ok(html.includes('.panel::after,.seal::after{inset:3px}'), '缺移动端符角内收');
});