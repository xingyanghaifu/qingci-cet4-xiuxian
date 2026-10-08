/**
 * 题库验收（生成后自查）
 *   node scripts/verify-exam-bank.mjs [lexicon]
 * 检查题量口径、选项质量、篇章成组性、模拟卷构成与题号解析。
 * 两个中学词库与四六级口径不同（题型集、每组题数、卷面结构），按 LEX 校验配置切。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const lex = process.argv[2] || 'junior';
const dir = path.join(ROOT, 'src', 'data', 'lexicons', lex, 'question-bank');

/* 校验配置：kinds=必备题型集，groups=成组题型（per=每组题数, need=模拟卷所需满员组数），
 * paper=卷面（size=总题数, structure=各题型题数, kinds=每卷题型数） */
const LEX = {
  junior: {
    tag: 'junior',
    kinds: ['grammar', 'cloze', 'reading', 'bankfill', 'writing'],
    choiceCount: (k) => (k === 'bankfill' ? 10 : 4),
    passageKinds: ['cloze', 'bankfill'],
    groups: [
      { name: '完形', kind: 'cloze', per: 10, need: 3 },
      { name: '阅读', kind: 'reading', per: 5, need: 6 },
      { name: '选词', kind: 'bankfill', per: 5, need: 3 },
    ],
    paper: {
      size: 40, kinds: 5,
      structure: { grammar: 14, cloze: 10, reading: 10, bankfill: 5, writing: 1 },
    },
    writeKinds: ['writing'],
  },
  senior: {
    tag: 'senior',
    kinds: ['reading', 'gapped', 'cloze', 'grammarfill', 'writing', 'continuation'],
    choiceCount: (k) => (k === 'gapped' ? 7 : 4),
    passageKinds: ['cloze', 'gapped', 'grammarfill'],
    groups: [
      { name: '阅读', kind: 'reading', per: 4, need: 12 },
      { name: '七选五', kind: 'gapped', per: 5, need: 3 },
      { name: '完形', kind: 'cloze', per: 10, need: 6 },
      { name: '语法填空', kind: 'grammarfill', per: 10, need: 3 },
    ],
    paper: {
      size: 53, kinds: 6,
      structure: { reading: 16, gapped: 5, cloze: 20, grammarfill: 10, writing: 1, continuation: 1 },
    },
    writeKinds: ['writing', 'continuation'],
  },
  /**
   * 考研（v1.9.1 阶段 E）：完形 **20 空**、阅读 **5 题/篇**（3 细节+1 主旨+1 词义）、
   * 新题型七选五 5 空、翻译（英译汉，write 题）、写作 2 类。
   * 卷面 52 题 = 阅读 20 + 七选五 5 + 完形 20 + 翻译 5 + 写作 2。
   */
  kaoyan: {
    tag: 'kaoyan',
    kinds: ['cloze', 'reading', 'gapped', 'trans', 'writing'],
    choiceCount: (k) => (k === 'gapped' ? 7 : 4),
    passageKinds: ['cloze', 'gapped'],
    groups: [
      { name: '阅读', kind: 'reading', per: 5, need: 12 },
      { name: '七选五', kind: 'gapped', per: 5, need: 3 },
      { name: '完形', kind: 'cloze', per: 20, need: 3 },
    ],
    paper: {
      size: 52, kinds: 5,
      structure: { reading: 20, gapped: 5, cloze: 20, trans: 5, writing: 2 },
    },
    writeKinds: ['writing', 'trans'],
    parts: ['读', '写', '译'],
  },
  /**
   * GRE（v1.10 第一批）。
   * 卷面 1156 题 = 填空 620 + 阅读 105 篇×5 = 525 + 写作 11。
   * GRE 无听力，故 kinds 里没有 talk。
   */
  gre: {
    tag: 'gre',
    kinds: ['bankfill', 'reading', 'writing'],
    // 填空（句子等价 / Text Completion）是**词库型**题：从 10 个词里选，不是四选一
    choiceCount: (k) => (k === 'bankfill' ? 10 : 4),
    passageKinds: [],
    groups: [
      { name: '阅读', kind: 'reading', per: 5, need: 12 },
    ],
    paper: {
      size: 1156, kinds: 3,
      structure: { bankfill: 620, reading: 525, writing: 11 },
    },
    writeKinds: ['writing'],
    parts: ['填', '读', '写'],
  },
  /**
   * PRETCO（v1.9.1 阶段 F · 近似方案）：词库数据复用 CET-4，只考特色题型 ——
   * 语法结构（单选）、听力短对话（带 TTS 的对话理解）、英译汉（write）、应用文（write）。
   * 四类全是 direct 题（不成组），故 groups 为空。
   * 卷面 32 题 = 语法 15 + 短对话 10 + 翻译 5 + 写作 2。
   */
  pretco: {
    tag: 'pretco',
    kinds: ['grammar', 'talk', 'trans', 'writing'],
    choiceCount: () => 4,
    passageKinds: [],
    groups: [],
    paper: {
      size: 32, kinds: 4,
      structure: { grammar: 15, talk: 10, trans: 5, writing: 2 },
    },
    writeKinds: ['writing', 'trans'],
    parts: ['听', '写', '译', '读'],
    // 英译汉题面给英文、sample 给中文参考译文（非空串）
    sampleWriteKinds: ['trans'],
  },
};
const C = LEX[lex];
if (!C) {
  console.error(`❌ 未知词库：${lex}（可用：${Object.keys(LEX).join(' / ')}）`);
  process.exit(1);
}

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
ck(Object.keys(byKind).length === C.kinds.length, `${C.kinds.length} 种题型齐全：${Object.keys(byKind).join('/')}`);
for (const k of C.kinds) {
  ck(byKind[k] && byKind[k].length > 0, `题型 ${k} 存在（${byKind[k] ? byKind[k].length : 0} 题）`);
}

/* 逐题：选项质量 + 正解唯一 */
let mcq = 0, subjective = 0;
for (const q of byId.values()) {
  const c = q.content;
  ck(typeof q.difficulty === 'number' && q.difficulty >= 0.2 && q.difficulty <= 0.8, `${q.id}: difficulty 合法`);
  ck(Array.isArray(q.knowledgeTags) && q.knowledgeTags[0] === C.tag, `${q.id}: knowledgeTags 以 ${C.tag} 开头`);
  ck((C.parts || ['读', '写']).includes(q.part), `${q.id}: part 合法`);
  if (C.writeKinds.includes(q.kind)) {
    subjective++;
    ck(c.write === true, `${q.id}: 主观题 write=true`);
    ck(typeof c.answer === 'string' && c.answer === '', `${q.id}: 主观题 answer 为空串`);
    ck(typeof c.min === 'number' && typeof c.max === 'number', `${q.id}: 主观题有字数区间`);
    if ((C.sampleWriteKinds || []).includes(q.kind)) {
      ck(typeof c.sample === 'string' && c.sample.length > 0, `${q.id}: 英译汉有中文参考译文`);
    }
    continue;
  }
  mcq++;
  const expect = C.choiceCount(q.kind);
  ck(c.choices.length === expect, `${q.id}: ${c.choices.length} 个选项（应 ${expect}）`);
  ck(new Set(c.choices).size === c.choices.length, `${q.id}: 选项互不重复`);
  ck(c.choices.includes(c.answer), `${q.id}: 正解在选项中`);
  ck(typeof c.explain === 'string' && c.explain.length > 5, `${q.id}: 有解析`);
  ck(!/\{[A-Z0-9]+\}/.test(c.prompt + (c.passage || '')), `${q.id}: 无残留占位符`);
  // 空在**篇章**里的题型（___1___）：题干只提示第几空，篇章必须有对应编号的空。
  if (C.passageKinds.includes(q.kind)) {
    ck(/___\d+___/.test(c.passage || ''), `${q.id}: 篇章里有对应编号的空`);
    const m = c.prompt.match(/第 (\d+) [空处]/);
    ck(m && new RegExp(`___${m[1]}___`).test(c.passage), `${q.id}: 题干编号与篇章空位对应`);
  }
  // 语法选择（初中）的空画在题干上。
  if (q.kind === 'grammar') ck(c.prompt.includes('___'), `${q.id}: 语法题干有空`);
  if (q.kind === 'reading') ck(typeof c.passage === 'string' && c.passage.length > 100, `${q.id}: 阅读题带短文`);
}
console.log(`  客观题 ${mcq} · 主观题 ${subjective}`);

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
const groupStats = [];
for (const g of C.groups) {
  const gs = checkGroups(g.name, byKind[g.kind] || [], g.per, g.need);
  groupStats.push(`${g.name}组 ${gs.size}`);
}
// 选词：组内共用同一份词库（选项池一致）
for (const [g, arr] of groupsOf(byKind.bankfill || [])) {
  const banks = new Set(arr.map((q) => q.content.choices.join('|')));
  ck(banks.size === 1, `选词 ${g} 组内共用同一份词库`);
}
console.log('  ' + groupStats.join(' · '));

/* 模拟卷：3 套、两两不重、题号全解析、题型齐全、结构符合组卷计划 */
const keys = Object.keys(mf.papers);
ck(keys.length === 3, `模拟卷 ${keys.length} 套`);
const seen = new Set();
for (const k of keys) {
  const p = mf.papers[k];
  ck(p.ids.length === C.paper.size, `${k} 共 ${p.ids.length} 题（应 ${C.paper.size}）`);
  const kinds = new Set();
  for (const id of p.ids) {
    const q = byId.get(id);
    ck(!!q, `${k} 的题号可解析：${id}`);
    if (q) kinds.add(q.kind);
    ck(!seen.has(id), `${k} 与前一套卷子不重题：${id}`);
    seen.add(id);
  }
  ck(kinds.size === C.paper.kinds, `${k} ${C.paper.kinds} 种题型齐全（实际 ${kinds.size}）`);
  const struct = p.structure || {};
  const want = C.paper.structure;
  ck(Object.keys(want).every((kk) => struct[kk] === want[kk]),
    `${k} 结构 ${Object.entries(want).map(([a, b]) => `${a} ${b}`).join('/')}`);
  console.log(`  ${k} ${p.name}: ${p.ids.length} 题，题型 ${[...kinds].join('/')}`);
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
