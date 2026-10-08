/**
 * 内联词库紧凑列式编解码（v1.10 体积优化）
 *
 * ── 背景 ──
 * 单文件里内联的 CET-4 词库（4540 词）原本是**对象数组**：
 *
 *     [{"w":"a","ipa":"","zh":"art.一(个)；每一(个)","short":"一"}, …]
 *
 * 每条重复四个键名（`"w":` / `"ipa":` / `"zh":` / `"short":`）约 23 字节，
 * 4540 条 = **约 102 KB 纯键名开销**（零信息量）。
 * 当时单文件预算（19 KB 增量）只剩 6.04 KB，任何新玩法都塞不进。
 *
 * 改为**列式**：`{"k":["w","ipa","zh","short"],"v":[["a","",…],…]}`
 * 实测 373.0 KB → 271.0 KB，**省 101.9 KB**；产物 924 591 → 825 203 B，
 * 剩余预算 6.04 → **103.10 KB**。
 *
 * ── 这份测试在防什么 ──
 * 格式变更**风险极高**：一旦解码器与编码器不一致、或某处解析点漏改，
 * 表现是「页面能开但词库空/字段 undefined」，而**静态字符串测试看不出来**。
 * 所以这里既断言编解码往返一致，也断言**所有解析点都走了 decodeLexicon**。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import core from '../src/core/utils.js';

const ROOT = join(import.meta.dirname, '..');
const html = readFileSync(join(ROOT, 'src', 'index.template.html'), 'utf8');

const SAMPLE = [
  { w: 'a', ipa: '', zh: 'art.一(个)', short: '一' },
  { w: 'abandon', ipa: '[əˈbændən]', zh: 'vt.丢弃；放弃', short: '丢弃' },
  { w: 'ability', ipa: '[əˈbiliti]', zh: 'n.能力', short: '能力' },
];

/* ───────── 一、编解码往返 ───────── */

test('往返：encode → decode 还原为等价的对象数组', () => {
  const enc = core.encodeLexicon(SAMPLE);
  assert.deepEqual(enc.k, ['w', 'ipa', 'zh', 'short'], '列名顺序必须稳定');
  assert.equal(enc.v.length, 3);
  const back = core.decodeLexicon(enc);
  assert.deepEqual(back, SAMPLE, '往返必须完全等价');
});

test('往返：真实 4540 词全量无损', () => {
  const rows = core.lexiconFromHtml(html);
  assert.equal(rows.length, 4540, `源码模板应含 4540 词（实际 ${rows.length}）`);
  const round = core.decodeLexicon(core.encodeLexicon(rows));
  assert.equal(round.length, rows.length);
  // 抽查若干词的字段完全一致
  for (const w of ['a', 'abandon', 'ability', 'zone']) {
    const a = rows.find((r) => r.w === w);
    const b = round.find((r) => r.w === w);
    assert.deepEqual(b, a, `词 ${w} 往返后不一致`);
  }
});

test('编码：确实比对象数组小（这是本优化的全部意义）', () => {
  const rows = core.lexiconFromHtml(html);
  const asObjects = Buffer.byteLength(JSON.stringify(rows), 'utf8');
  const asCompact = Buffer.byteLength(JSON.stringify(core.encodeLexicon(rows)), 'utf8');
  assert.ok(asCompact < asObjects, '紧凑格式必须更小');
  const saved = asObjects - asCompact;
  assert.ok(saved > 80 * 1024, `应省下 >80 KB（实际 ${(saved / 1024).toFixed(1)} KB）`);
});

/* ───────── 二、兼容性（关键：不能只认新格式） ───────── */

test('解码器兼容旧格式：对象数组原样返回', () => {
  assert.equal(core.decodeLexicon(SAMPLE), SAMPLE, '对象数组应原样返回（不复制，零开销）');
  assert.deepEqual(core.decodeLexicon([]), []);
});

test('解码器兼容缺字段 / 短行：缺失补空串，不产生 undefined', () => {
  const enc = { k: ['w', 'ipa', 'zh', 'short'], v: [['a'], ['b', '[bi]']] };
  const out = core.decodeLexicon(enc);
  assert.equal(out.length, 2);
  assert.equal(out[0].w, 'a');
  assert.equal(out[0].ipa, '', '缺的列应补空串');
  assert.equal(out[0].zh, '');
  assert.equal(out[1].ipa, '[bi]');
  assert.equal(out[1].zh, '');
  for (const row of out) {
    for (const k of ['w', 'ipa', 'zh', 'short']) {
      assert.notEqual(row[k], undefined, `字段 ${k} 不应是 undefined`);
    }
  }
});

test('解码器：非法输入一律返回空数组，绝不抛错', () => {
  for (const bad of [null, undefined, 0, '', 'nope', 42, true, {}, { k: ['w'] }, { v: [[]] }, { k: 'w', v: [] }]) {
    assert.deepEqual(core.decodeLexicon(bad), [], `输入 ${JSON.stringify(bad)} 应返回 []`);
  }
});

test('解码器：容错「列式里混入对象行」', () => {
  const mixed = { k: ['w', 'zh'], v: [['a', 'art.一'], { w: 'b', zh: 'n.乙' }] };
  const out = core.decodeLexicon(mixed);
  assert.equal(out.length, 2);
  assert.equal(out[0].w, 'a');
  assert.equal(out[1].w, 'b');
  assert.equal(out[1].zh, 'n.乙');
});

/* ───────── 三、HTML 提取 ───────── */

test('lexiconFromHtml：能从源码模板取出 4540 词', () => {
  const rows = core.lexiconFromHtml(html);
  assert.equal(rows.length, 4540);
  assert.ok(rows[0].w, '第一条应有 w 字段');
});

test('lexiconFromHtml：缺标签 / 坏 JSON 返回空数组，不抛错', () => {
  assert.deepEqual(core.lexiconFromHtml('<html>无词库</html>'), []);
  assert.deepEqual(core.lexiconFromHtml('<script id="lexicon" type="application/json">{bad</script>'), []);
  assert.deepEqual(core.lexiconFromHtml(null), []);
});

/* ───────── 四、接线契约（防漏改解析点） ───────── */

test('接线：模板所有内联词库解析点都走 decodeLexicon', () => {
  // ⚠️ 不能只用 `JSON\.parse\([^)]*lexicon[^)]*\)` —— 里面含嵌套括号
  // （`document.getElementById('lexicon')`），`[^)]*` 会提前截断，漏掉多数解析点。
  // 改为按「取 lexicon 元素」的两种写法定位，再检查其后是否紧跟 decodeLexicon。
  const sites = [];
  // 写法 A：JSON.parse(lexiconEl.textContent)
  for (const m of html.matchAll(/JSON\.parse\(\s*lexiconEl\.textContent\s*\)/g)) sites.push(m);
  // 写法 B：JSON.parse(document.getElementById('lexicon').textContent)
  for (const m of html.matchAll(/JSON\.parse\(\s*document\.getElementById\((['"])lexicon\1\)\.textContent\s*\)/g)) sites.push(m);

  assert.ok(sites.length >= 4, `模板里应有 >=4 处内联词库解析点（实际 ${sites.length}）`);
  const unwrapped = [];
  for (const m of sites) {
    const before = html.slice(Math.max(0, m.index - 60), m.index);
    if (!/decodeLexicon\s*\(\s*$/.test(before)) {
      unwrapped.push(html.slice(m.index, m.index + 60));
    }
  }
  assert.deepEqual(unwrapped, [],
    `以下解析点未走 decodeLexicon（产物是紧凑列式，直接 parse 会得到 {k,v} 而非词条数组）：\n  ${unwrapped.join('\n  ')}`);
  // 覆盖性：模板里 decodeLexicon 的出现次数应与解析点数一致
  const decodes = (html.match(/decodeLexicon\s*\(/g) || []).length;
  assert.equal(decodes, sites.length, `decodeLexicon 用了 ${decodes} 次，但解析点有 ${sites.length} 处`);
});

test('接线：服务层把 decodeLexicon 挂到全局（模板才能用）', () => {
  const svc = readFileSync(join(ROOT, 'src', 'entry', 'services.ts'), 'utf8');
  assert.ok(/decodeLexicon/.test(svc), 'services.ts 未挂 decodeLexicon');
  assert.ok(/host[^;]*decodeLexicon/.test(svc), '应挂到 host（全局）');
});

test('接线：构建脚本在产物里写入紧凑列式', () => {
  const build = readFileSync(join(ROOT, 'scripts', 'build.mjs'), 'utf8');
  assert.ok(/encodeLexicon/.test(build), 'build.mjs 未编码内联词库');
  assert.ok(/decodeLexicon/.test(build), 'build.mjs 应兼容读取（源码是对象数组）');
});

test('接线：Node 侧消费方（worker / server / prepare-deploy）都用 decodeLexicon', () => {
  const files = [
    join(ROOT, 'worker', 'index.mjs'),
    join(ROOT, 'server.mjs'),
    join(ROOT, 'scripts', 'prepare-deploy.mjs'),
  ];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    assert.ok(/decodeLexicon/.test(src),
      `${f} 未使用 decodeLexicon —— 产物是紧凑列式，直接 JSON.parse().length 会得 undefined`);
  }
});

test('接线：构建脚本消费方（vocab-detail / exam-bank）都用 decodeLexicon', () => {
  for (const f of ['build-vocab-detail.mjs', 'build-exam-bank.mjs']) {
    const src = readFileSync(join(ROOT, 'scripts', f), 'utf8');
    assert.ok(/decodeLexicon/.test(src), `${f} 未使用 decodeLexicon`);
  }
});

test('守卫：源码模板保持可读的对象数组（只压产物）', () => {
  // 源码可读性是本仓库的既有约定（构建期才压缩）
  const m = /<script id="lexicon" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(m, '模板应有内联词库');
  const parsed = JSON.parse(m[1]);
  assert.ok(Array.isArray(parsed), '源码模板应保持对象数组（可读）；紧凑列式只出现在产物里');
  assert.ok(parsed[0] && typeof parsed[0] === 'object' && 'w' in parsed[0],
    '源码词条应是含 w 字段的对象');
});

test('产物：内联词库确实已编码为紧凑列式', () => {
  const dist = readFileSync(join(ROOT, 'dist', 'index.html'), 'utf8');
  const m = /<script id="lexicon" type="application\/json">([\s\S]*?)<\/script>/.exec(dist);
  assert.ok(m, '产物应有内联词库');
  const parsed = JSON.parse(m[1]);
  assert.ok(!Array.isArray(parsed), '产物应是紧凑列式（非对象数组）');
  assert.deepEqual(parsed.k, ['w', 'ipa', 'zh', 'short'], '列名应与 LEXICON_KEYS 一致');
  assert.equal(parsed.v.length, 4540, '列数据应有 4540 行');
});
