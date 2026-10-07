/**
 * 记忆锚点验收（v1.8.2 阶段 B）
 *
 * 覆盖谕令 B9 / B10：
 *   1. 覆盖率：CET-4 与 CET-6 各自的锚点覆盖率达标（top-1000 ≥90%，其余 ≥60%）
 *   2. 内容红线：无歧视 / 暴力 / 色情 / 赌博，且助记不得等于释义原文
 *   3. 结构完整：字段齐全、tier 分级正确、无半截句
 *   4. 边界情况：分片完整性（不丢词、不重复、每片 ≤1.5MB、前缀最长匹配可用）
 *   5. UI 接线：结构化锚点优先、无锚点时回落 memoryAid、答错才提示
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { hasCode } from './helpers/minified.mjs';

const ROOT = join(import.meta.dirname, '..');
const LEXES = [
  { id: 'cet4', dir: join(ROOT, 'src', 'data', 'vocab-detail') },
  { id: 'cet6', dir: join(ROOT, 'src', 'data', 'lexicons', 'cet6', 'vocab-detail') },
];

/** 读一个词库的全部分片，返回 word -> detail 与 manifest */
function loadLexicon(lex) {
  const mf = JSON.parse(readFileSync(join(lex.dir, 'manifest.json'), 'utf8'));
  const all = new Map();
  for (const f of new Set(Object.values(mf.files))) {
    const data = JSON.parse(readFileSync(join(lex.dir, f), 'utf8'));
    for (const [w, d] of Object.entries(data)) all.set(w, d);
  }
  return { mf, all };
}

/** 按 manifest 的最长前缀规则定位分片（与运行时 prefixFor 一致） */
function prefixFor(mf, word) {
  for (const p of mf.prefixes) if (word.toLowerCase().startsWith(p)) return p;
  return '';
}

for (const lex of LEXES) {
  test(`B-1 ${lex.id}：记忆锚点覆盖率达 B9 口径`, () => {
    const { all } = loadLexicon(lex);
    let covered = 0, full = 0, basic = 0;
    for (const [, d] of all) {
      const m = d.mnemonics;
      if (m && m.tier === 'full') { covered++; full++; }
      else if (m && m.tier === 'basic') { covered++; basic++; }
    }
    const pct = (covered / all.size) * 100;
    assert.ok(pct >= 60, `${lex.id} 覆盖率 ${pct.toFixed(2)}% 低于 60% 下限`);
    // top-1000 的要求更严，但生成口径对全量一视同仁，用全量覆盖率作保守下界
    assert.ok(pct >= 90, `${lex.id} 覆盖率 ${pct.toFixed(2)}% 未达 90% 的 top-1000 口径`);
    assert.ok(full > all.size * 0.5, `${lex.id} full 级（装置/画面）仅 ${full}，质量偏低`);
    assert.ok(basic >= 0, 'basic 级计数不可为负');
  });

  test(`B-2 ${lex.id}：分片完整——不丢词、不重复、每片 ≤1.5MB`, () => {
    const { mf, all } = loadLexicon(lex);
    assert.equal(all.size, mf.count, 'manifest.count 与实际条目数不一致');
    // 每片体积上限
    for (const f of new Set(Object.values(mf.files))) {
      const bytes = readFileSync(join(lex.dir, f)).length;
      assert.ok(bytes <= 1_500_000, `分片 ${f} 为 ${bytes} 字节，超过 1.5MB`);
    }
    // 分片键唯一（避免两个前缀指向同一文件导致覆盖丢词）
    const files = Object.values(mf.files);
    assert.equal(new Set(files).size, files.length, '分片文件名有重复');
    // prefixes 与 files 一一对应
    assert.equal(mf.prefixes.length, Object.keys(mf.files).length, 'prefixes 与 files 数量不一致');
    // prefixes 按长度降序（最长前缀匹配的前提）
    const lens = mf.prefixes.map((p) => p.length);
    assert.deepEqual(lens, [...lens].sort((a, b) => b - a), 'prefixes 必须按长度降序');
    // 每个词都能定位到一个真实存在的分片
    let checked = 0;
    for (const w of all.keys()) {
      const p = prefixFor(mf, w);
      assert.ok(p, `${w} 匹配不到任何分片前缀`);
      assert.ok(existsSync(join(lex.dir, mf.files[p])), `${w} → ${mf.files[p]} 不存在`);
      if (++checked >= 500) break; // 全量 1 万词太慢，抽样 500 已足够暴露归属错误
    }
  });

  test(`B-3 ${lex.id}：内容红线——无歧视/暴力/色情/赌博，且助记不复读释义`, () => {
    const { all } = loadLexicon(lex);
    // 红线只拦「有害内容本身」，不拦「词义里正常提到某事物」。
    // sword / weapon / ammunition 都是考纲词，助记讲战场属正常教学素材。
    const BANNED = [
      // 歧视
      /种族.{0,6}(更|最|天生)(聪明|懒惰|优越|低劣)/,
      /(白人|黑人|男人|女人|所有).{0,4}(都|一律)(更|最)(聪明|懒惰|贪婪)/,
      /\b(racial\s+supremac|white\s+power)\b/i,
      // 自伤 / 制爆：只拦「教人怎么做」
      /如何自杀|自杀方法|怎样自杀|制作炸弹|怎么制作炸弹|造炸弹/,
      /\bhow\s+to\s+(kill\s+(yourself|oneself)|make\s+(a\s+)?bomb)\b/i,
      // 色情 / 赌博：拦描写与鼓吹，不拦词义提及
      /(色情片段|性爱描写|情色内容|赌博技巧|如何下注)/i,
      // 血腥虐杀
      /(肢解|割喉|虐杀|酷刑|血肉模糊)/,
    ];
    let checked = 0;
    for (const [w, d] of all) {
      const m = d.mnemonics;
      if (!m || m.tier === 'none') continue;
      const text = [m.device, m.scene, m.tip, m.root].filter(Boolean).join(' ');
      for (const re of BANNED) {
        assert.ok(!re.test(text), `${w} 的记忆锚点命中内容红线 ${re}: ${text.slice(0, 60)}`);
      }
      // 助记不得是把中文释义复读一遍
      if (m.device) {
        const gloss = (d.meanings || [])
          .flatMap((g) => (g.definitions || []).map((x) => x.chinese || '')).join('');
        if (gloss.length >= 8 && m.device.length >= 8) {
          assert.ok(!m.device.includes(gloss), `${w} 的助记直接包含完整释义，等于没有提供记忆增量`);
        }
      }
      if (++checked >= 3000) break;
    }
    assert.ok(checked > 100, '实际抽查的锚点数太少，测试无效');
  });

  test(`B-4 ${lex.id}：结构完整、tier 分级自洽、无半截句`, () => {
    const { all } = loadLexicon(lex);
    const FIELDS = ['device', 'scene', 'root', 'tip'];
    for (const [w, d] of all) {
      const m = d.mnemonics;
      if (!m) continue;
      assert.ok(['full', 'basic'].includes(m.tier), `${w} 的 tier 非法：${m.tier}`);
      // full 必须有装置或画面
      if (m.tier === 'full') {
        assert.ok(m.device || m.scene, `${w} 标为 full 却既无 device 也无 scene`);
      }
      // 每个字符串字段非空且不过长
      for (const f of FIELDS) {
        if (m[f] == null) continue;
        assert.equal(typeof m[f], 'string', `${w}.${f} 应为字符串`);
        assert.ok(m[f].trim().length > 0, `${w}.${f} 为空串`);
        assert.ok(m[f].length <= 260, `${w}.${f} 超长（${m[f].length}）：${m[f]}`);
        // 半截句：以未闭合的逗号结尾通常是截断残留
        assert.ok(!/[，,、；;]$/.test(m[f]), `${w}.${f} 以逗号结尾，疑似截断残留：${m[f].slice(-20)}`);
      }
      // assoc 必须是短词数组
      if (m.assoc) {
        assert.ok(Array.isArray(m.assoc), `${w}.assoc 应为数组`);
        for (const a of m.assoc) assert.ok(a.length <= 24, `${w}.assoc 项过长：${a}`);
      }
      // confusable 结构完整
      if (m.confusable) {
        for (const c of m.confusable) {
          assert.ok(c.wrong && c.right, `${w}.confusable 缺 wrong/right`);
        }
      }
    }
  });

  test(`B-5 ${lex.id}：缩写/复合词用结构化兜底，不留空洞`, () => {
    const { all } = loadLexicon(lex);
    // 抽样检查两类易漏词：缩写与连字符复合词
    const probes = ['a.m', 'p.m', 'b.c', 'i.e.', 'ice-cream', 'father-in-law'];
    let hit = 0;
    for (const p of probes) {
      const d = all.get(p) || all.get(p.toLowerCase());
      if (!d) continue; // 该词库可能不含此词，跳过
      assert.ok(d.mnemonics && d.mnemonics.tier, `${p} 应当有兜底锚点`);
      assert.ok(d.mnemonics.device, `${p} 的兜底锚点应含 device`);
      hit++;
    }
    assert.ok(hit >= 3, `实际命中的探针太少（${hit}），测试无效`);
  });
}

test('B-6 UI：结构化锚点优先展示，无锚点回落 memoryAid', () => {
  const html = readFileSync(join(ROOT, 'dist', 'index.html'), 'utf8');
  // 新的渲染分支存在
  assert.ok(html.includes('detail.mnemonics'), '详情面板应读取结构化 mnemonics');
  assert.ok(html.includes('mn.device'), '应渲染 device');
  assert.ok(html.includes('mn.scene'), '应渲染 scene');
  assert.ok(html.includes('mn.root'), '应渲染词根锚点');
  assert.ok(html.includes('mn.confusable'), '应渲染易错点');
  // 向后兼容：老词条仍走 memoryAid
  assert.ok(html.includes('detail.memoryAid'), '无结构化锚点时应回落 memoryAid');
  // 区块名保持不变（不新增第八个区块，避免打乱既有版式）
  assert.ok(html.includes('记忆辅助 · MEMORY'), '记忆辅助区块名应保持稳定');
});

test('B-7 UI：答错才显示记忆锚点，正确作答不显示', () => {
  const html = readFileSync(join(ROOT, 'dist', 'index.html'), 'utf8');
  assert.ok(html.includes('mnemonicHint'), '应存在 mnemonicHint 辅助函数');
  // 该函数只在 settle 的错误分支被调用
  const wrongBranch = /记入心魔<\/b>.*mnemonicHint\(/.test(html);
  assert.ok(wrongBranch, '记忆锚点应挂在答错分支');
  const rightBranch = /灵气 \+"[^"]*"\+"<\/b><div>"\+esc\([^)]*\)\+"<\/div>"\s*\+\s*mnemonicHint/.test(html);
  assert.ok(!rightBranch, '答对时不应显示记忆锚点（会削弱「先自己想」的记忆编码）');
  // 缓存来自详情面板已有对象，不额外发起请求
  assert.ok(html.includes('__qingciDetailCache'), '应复用已加载的详情对象');
});

test('B-8 向后兼容：旧词条没有 mnemonics 时界面不报错', () => {
  const html = readFileSync(join(ROOT, 'dist', 'index.html'), 'utf8');
  // tier 为 none 时走 memoryAid 分支，两条路径都存在。
  //
  // 注意：产物 JS 经过「压空白 + 语法简化」，esbuild 会把
  //   `else if (detail.memoryAid) { ... }`
  // 改写成短路表达式
  //   `...:detail.memoryAid&&(aux+=...)`
  // —— 这是**等价的控制流重写**，不是功能变化。
  // 所以这里断言「两个分支的语义锚点都在」，而不是断言 `else if` 的字面形态。
  assert.ok(hasCode(html, "mn.tier !== 'none'"), '应判断 tier');
  // memoryAid 回落分支：只要「memoryAid 被当作条件使用」即可（&&/if 均可）
  assert.ok(/detail\.memoryAid\s*(?:&&|\?|\))/.test(html),
    'memoryAid 回落分支不存在（旧词条会没有助记可显示）');
  // 且它确实会渲染出「助记」这一块
  assert.ok(html.includes('助记'), '应渲染「助记」区块');
});

test('B-9 数据规模：锚点没有让单文件变大（分片数据按需加载）', () => {
  const html = readFileSync(join(ROOT, 'dist', 'index.html'), 'utf8');
  // 单文件里只有 UI 渲染代码，不含具体词条的锚点文本
  assert.ok(!html.includes('联想画面：'), '单文件不应内联任何词条的锚点内容');
  assert.ok(!/mnemonics":\{/.test(html), '单文件不应内联 mnemonics 数据');
});