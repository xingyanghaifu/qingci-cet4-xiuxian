/**
 * 中考题库验收（生成后自查）
 *   node scripts/verify-exam-bank.mjs [lexicon]
 * 检查题量口径、选项质量、篇章成组性、模拟卷构成与题号解析。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const lex = process.argv[2] || 'junior';
const dir = path.join(ROOT, 'src', 'data', 'lexicons', lex, 'question-bank');

const fails = [];
const oks = [];
function ck(cond, msg) { (cond ? oks : fails).push(msg); }

const mf = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const byId = new Map();
const byKind = {};
for (const [kind, info] of Object.entries(mf.kinds)) {
  const shard = JSON.parse(fs.readFileSync(path.join(dir, info.file), 'utf8'));
  ck(shard.schema === 'qingci-question-bank/1', `${kind}: schema 正确`);
  ck(shard.kind === kind, `${kind}: 分片 kind 与文件名一致`);
  byKind[kind] = shard.questions;
  for (const q of shard.questions) {
    if (byId.has(q.id)) fails.push(`题号重复：${q.id}`);
    byId.set(q.id, q);
  }
  ck(shard.questions.length === info.count, `${kind}: manifest 声明 ${info.count} = 实际 ${shard.questions.length}`);
  const bytes = fs.statSync(path.join(dir, info.file)).size;
  ck(bytes <= 1_500_000, `${kind}: 分片 ${(bytes / 1024).toFixed(1)} KB ≤ 1.5 MB`);
}

const total = Object.values(byKind).reduce((a, b) => a + b.length, 0);
ck(total === mf.counts.total, `manifest 总数 ${mf.counts.total} = 实际 ${total}`);
ck(total >= 3000 && total <= 5000, `题量 ${total} 落在 3000–5000`);
ck(Object.keys(byKind).length === 5, `五种题型齐全：${Object.keys(byKind).join('/')}`);
for (const k of ['grammar', 'cloze', 'reading', 'bankfill', 'writing']) {
  ck(byKind[k] && byKind[k].length > 0, `题型 ${k} 存在（${byKind[k] ? byKind[k].length : 0} 题）`);
}

/* 逐题：选项质量 + 正解唯一 */
let mcq = 0, writing = 0;
for (const q of byId.values()) {
  const c = q.content;
  ck(typeof q.difficulty === 'number' && q.difficulty >= 0.2 && q.difficulty <= 0.8, `${q.id}: difficulty 合法`);
  ck(Array.isArray(q.knowledgeTags) && q.knowledgeTags[0] === 'junior', `${q.id}: knowledgeTags 以 junior 开头`);
  ck(q.part === '读' || q.part === '写', `${q.id}: part 合法`);
  if (q.kind === 'writing') {
    writing++;
    ck(c.write === true, `${q.id}: 写作题 write=true`);
    ck(typeof c.answer === 'string' && c.answer === '', `${q.id}: 写作题 answer 为空串`);
    ck(typeof c.min === 'number' && typeof c.max === 'number', `${q.id}: 写作题有字数区间`);
    continue;
  }
  mcq++;
  const expect = q.kind === 'bankfill' ? 10 : 4;
  ck(c.choices.length === expect, `${q.id}: ${c.choices.length} 个选项（应 ${expect}）`);
  ck(new Set(c.choices).size === c.choices.length, `${q.id}: 选项互不重复`);
  ck(c.choices.includes(c.answer), `${q.id}: 正解在选项中`);
  ck(typeof c.explain === 'string' && c.explain.length > 5, `${q.id}: 有解析`);
  ck(!/\{[A-Z0-9]+\}/.test(c.prompt + (c.passage || '')), `${q.id}: 无残留占位符`);
  // 完形/选词的空在**篇章**里（___1___），题干只提示第几空；
  // 只有语法题的空画在题干上。
  if (q.kind === 'grammar') ck(c.prompt.includes('___'), `${q.id}: 语法题干有空`);
  if (q.kind === 'cloze' || q.kind === 'bankfill') {
    ck(/___\d+___/.test(c.passage || ''), `${q.id}: 篇章里有对应编号的空`);
    ck(new RegExp(`___${c.prompt.match(/第 (\d+) 空/)[1]}___`).test(c.passage), `${q.id}: 题干编号与篇章空位对应`);
  }
  if (q.kind === 'reading') ck(typeof c.passage === 'string' && c.passage.length > 100, `${q.id}: 阅读题带短文`);
}
console.log(`  客观题 ${mcq} · 主观题 ${writing}`);

/* 成组性：组内短文必须一致；组可以**不满**，但模拟卷只能用满员组。
 *
 * 为什么允许不满员：同一骨架的不同变体，篇章里挖空的位置是同一套模板，
 * 可见文字（人名等）撞车时，同位置同答案会被判定重复而丢掉 ——
 * 这是「同一句 + 同一空 + 同一答案」的真重复，保留会误导学生，
 * 丢掉则形成 N-1 题的组。组不满员无害：随机练习是逐题出的，
 * 模考组卷只取满员组（下方断言满员组数量足够）。
 */
function groupsOf(list) {
  const g = new Map();
  for (const q of list) {
    const k = q.content.group;
    if (!k) { fails.push(`缺 group：${q.id}`); continue; }
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(q);
  }
  return g;
}
function checkGroups(name, list, perGroup, needExact) {
  const gs = groupsOf(list);
  let exact = 0;
  for (const [g, arr] of gs) {
    ck(arr.length <= perGroup, `${name} ${g} 有 ${arr.length} 题（上限 ${perGroup}）`);
    if (arr.length === perGroup) exact++;
    const texts = new Set(arr.map((q) => q.content.passage));
    ck(texts.size === 1, `${name} ${g} 组内共享同一篇章`);
    const answers = new Set(arr.map((q) => q.content.answer));
    ck(answers.size === arr.length, `${name} ${g} 组内答案互不相同`);
  }
  ck(exact >= needExact, `${name} 满员组 ${exact} ≥ ${needExact}（模拟卷需要 ${needExact} 组）`);
  return gs;
}
const clozeGroups = checkGroups('完形', byKind.cloze || [], 10, 3);
const readingGroups = checkGroups('阅读', byKind.reading || [], 5, 6);
const bankGroups = checkGroups('选词', byKind.bankfill || [], 5, 3);
for (const [g, arr] of bankGroups) {
  const banks = new Set(arr.map((q) => q.content.choices.join('|')));
  ck(banks.size === 1, `选词 ${g} 组内共用同一份词库`);
}
console.log(`  完形组 ${clozeGroups.size} · 阅读组 ${readingGroups.size} · 选词组 ${bankGroups.size}`);

/* 模拟卷：3 套 × 40、两两不重、题号全解析、五题型齐全 */
const keys = Object.keys(mf.papers);
ck(keys.length === 3, `模拟卷 ${keys.length} 套`);
const seen = new Set();
for (const k of keys) {
  const p = mf.papers[k];
  ck(p.ids.length === 40, `${k} 共 ${p.ids.length} 题（应 40）`);
  const kinds = new Set();
  for (const id of p.ids) {
    const q = byId.get(id);
    ck(!!q, `${k} 的题号可解析：${id}`);
    if (q) kinds.add(q.kind);
    ck(!seen.has(id), `${k} 与前一套卷子不重题：${id}`);
    seen.add(id);
  }
  ck(kinds.size === 5, `${k} 五种题型齐全（实际 ${kinds.size}）`);
  const struct = p.structure;
  ck(struct && struct.grammar === 14 && struct.cloze === 10 && struct.reading === 10
    && struct.bankfill === 5 && struct.writing === 1, `${k} 结构 14/10/10/5/1`);
  console.log(`  ${k} ${p.name}: 40 题，题型 ${[...kinds].join('/')}`);
}

/* 分片指纹（供两次运行比对） */
const hash = crypto.createHash('sha256');
for (const f of fs.readdirSync(dir).sort()) {
  hash.update(f).update(fs.readFileSync(path.join(dir, f)));
}
console.log(`\n  指纹 sha256:${hash.digest('hex').slice(0, 16)}`);
console.log(`  通过 ${oks.length} 项 / 失败 ${fails.length} 项`);
for (const f of fails.slice(0, 20)) console.log('  ✗ ' + f);
process.exit(fails.length ? 1 : 0);