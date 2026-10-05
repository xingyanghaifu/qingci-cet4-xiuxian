/* 高中素材自检：空位数、标记语法、动词表归属、选项组归属、复合形容词安全 */
import {
  SENIOR_CLOZE_SKELETONS, SENIOR_READING_SKELETONS, GAPPED_SKELETONS,
  SENIOR_GRAMMAR_FILL_SKELETONS, FUNCTION_SETS, SENIOR_WRITING, SENIOR_CONTINUATION,
  VERB_FORMS, SLOTS, SENIOR_SLOTS,
} from './exam-bank-content.mjs';

const problems = [];
const blankable = /^(?:[ANRV]\d+|T\d+)(?:@\w+)?$/;
const gMark = /^\{G([vaf])\d+\|([^|}]+)\|([^}]+)\}$/;
const verbTable = new Map(VERB_FORMS.map((v) => [v.b, v]));
const FORM_FIELD = { b: 'b', s: 's', p: 'p', past: 'p', pp: 'pp', ing: 'ing' }; // past 与 build-exam-bank 的 GFORM 同义

console.log('=== 高中完形（须恰好 10 空）===');
for (const sk of SENIOR_CLOZE_SKELETONS) {
  const keys = new Set();
  for (const s of sk.sents) for (const m of s.matchAll(/\{([A-Z0-9]+(?:@\w+)?)\}/g)) {
    if (blankable.test(m[1])) keys.add(m[1]);
  }
  const okk = keys.size === 10;
  console.log(`  ${sk.id.padEnd(24)} ${keys.size} 空 ${okk ? 'OK' : '❌'}`);
  if (!okk) problems.push(`${sk.id} 空数=${keys.size}（应 10）: ${[...keys].join(',')}`);
  // 池归属
  for (const s of sk.sents) for (const m of s.matchAll(/\{([A-Z0-9]+)@(\w+)\}/g)) {
    const pool = SLOTS[m[2]] || SENIOR_SLOTS[m[2]];
    if (!pool || !pool.length) problems.push(`${sk.id} 用到未定义池 ${m[2]}`);
  }
}

console.log('\n=== 高中阅读 ===');
for (const sk of SENIOR_READING_SKELETONS) {
  const used = new Set();
  for (const s of sk.sents) for (const m of s.matchAll(/\{([A-Z0-9]+(?:@\w+)?)\}/g)) used.add(m[1]);
  const need = [];
  if ((sk.facts || []).includes('when') && !used.has('T1')) need.push('when→T1');
  if ((sk.facts || []).includes('where') && !used.has('PLACE1')) need.push('where→PLACE1');
  if ((sk.facts || []).includes('howMany') && !used.has('NUM1')) need.push('howMany→NUM1');
  if ((sk.facts || []).includes('howMany') && !sk.howManyQ) need.push('缺 howManyQ');
  const gloss = [...used].filter((k) => /^(?:[ANRV]\d+)(?:@\w+)?$/.test(k));
  if (gloss.length < 4) need.push(`词义题候选词仅 ${gloss.length}（应≥4）`);
  const facts = (sk.facts || []).length;
  if (facts !== 2) need.push(`细节题应 2 个（得 4 题：2细节+1主旨+1词义），实为 ${facts}`);
  console.log(`  ${sk.id.padEnd(24)} facts=${facts} 内容词=${gloss.length} ${need.length ? '❌ ' + need.join('；') : 'OK'}`);
  if (need.length) problems.push(`${sk.id}: ${need.join('；')}`);
  for (const s of sk.sents) for (const m of s.matchAll(/\{([A-Z0-9]+)@(\w+)\}/g)) {
    const pool = SLOTS[m[2]] || SENIOR_SLOTS[m[2]];
    if (!pool || !pool.length) problems.push(`${sk.id} 用到未定义池 ${m[2]}`);
  }
}

console.log('\n=== 七选五（5 空 + 2 干扰）===');
for (const sk of GAPPED_SKELETONS) {
  const bad = [];
  if ((sk.gaps || []).length !== 5) bad.push(`gaps=${(sk.gaps || []).length}（应 5）`);
  if ((sk.distractors || []).length !== 2) bad.push(`distractors=${(sk.distractors || []).length}（应 2）`);
  if (sk.gaps.some((g) => g < 0 || g >= sk.sents.length)) bad.push('gaps 越界');
  if (sk.sents.length < 7) bad.push('sents < 7');
  if (new Set(sk.gaps).size !== sk.gaps.length) bad.push('gaps 重复');
  console.log(`  ${sk.id.padEnd(24)} 句 ${sk.sents.length} 空 ${sk.gaps.length} ${bad.length ? '❌ ' + bad.join('；') : 'OK'}`);
  if (bad.length) problems.push(`${sk.id}: ${bad.join('；')}`);
}

console.log('\n=== 语法填空（须恰好 10 空，标记必须合法）===');
for (const sk of SENIOR_GRAMMAR_FILL_SKELETONS) {
  const bad = [];
  let count = 0;
  for (const s of sk.sents) {
    // 找所有标记（G系列 + 普通可空槽）
    for (const m of s.matchAll(/\{([^{}]+)\}/g)) {
      const raw = m[1];
      if (gMark.test('{' + raw + '}')) {
        count++;
        const [, type, a, b] = ('{' + raw + '}').match(gMark);
        if (type === 'v') {
          const vf = verbTable.get(a);
          if (!vf) bad.push(`动词 ${a} 不在变位表里`);
          else if (!(b in FORM_FIELD)) bad.push(`形态 ${b} 非法`);
          else if (!vf[FORM_FIELD[b]]) bad.push(`${a} 缺 ${b} 形态`);
        } else if (type === 'a') {
          if (b !== 'comp' && b !== 'sup') bad.push(`形容词形态 ${b} 非法`);
          if (/y$/.test(a) || a.length < 6) bad.push(`形容词 ${a} 不适合规则变化（以 y 结尾或过短）`);
        } else if (type === 'f') {
          const set = FUNCTION_SETS[b];
          if (!set) bad.push(`选项组 ${b} 不存在`);
          else {
            if (!set.includes(a)) bad.push(`答案 ${a} 不在选项组 ${b} 里`);
            if (set.length < 4) bad.push(`选项组 ${b} 只有 ${set.length} 词（应≥4）`);
          }
        }
      } else if (blankable.test(raw)) {
        count++;
        if (raw.includes('@')) {
          const pool = SLOTS[raw.split('@')[1]] || SENIOR_SLOTS[raw.split('@')[1]];
          if (!pool) bad.push(`未定义池 ${raw}`);
        }
      } else if (/^[G]/.test(raw)) {
        bad.push(`G 标记语法错误: {${raw}}`);
      } else if (!/^[A-Z][A-Z0-9]*$/.test(raw)) {
        bad.push(`无法识别的标记: {${raw}}`);
      } else if (!/^(NAME|NAME2|PLACE1|PLACE2|NUM1|NUM2)$/.test(raw)) {
        count++;
      }
    }
    if (/\{[^}]*[\]\[]/.test(s)) bad.push(`标记里有方括号: ${s.slice(0, 60)}`);
  }
  const ok = count === 10 && !bad.length;
  console.log(`  ${sk.id.padEnd(24)} ${count} 空 ${ok ? 'OK' : '❌' + (bad.length ? ' ' + bad.join('；') : '')}`);
  if (count !== 10) problems.push(`${sk.id} 空数=${count}（应 10）`);
  if (bad.length) problems.push(`${sk.id}: ${bad.join('；')}`);
}

console.log('\n=== 写作 / 读后续写 ===');
console.log(`  应用文 ${SENIOR_WRITING.length} 题  ${SENIOR_WRITING.every((w) => w.prompt && w.min === 80) ? 'OK' : '❌'}`);
console.log(`  读后续写 ${SENIOR_CONTINUATION.length} 题  ${SENIOR_CONTINUATION.every((c) => c.prompt && c.passage && c.sub && c.min === 110) ? 'OK' : '❌'}`);
if (!SENIOR_WRITING.every((w) => w.prompt && w.min === 80)) problems.push('应用文字段不全');
if (!SENIOR_CONTINUATION.every((c) => c.prompt && c.passage && c.sub)) problems.push('读后续写字段不全');
// 读后续写里不能有中文标点错位的占位符
for (const c of SENIOR_CONTINUATION) if (/段落_two/.test(c.sub || '')) problems.push(`续写副题占位符错误: ${c.sub.slice(0, 40)}`);

console.log(`\n问题数: ${problems.length}`);
for (const p of problems) console.log('  ✗ ' + p);
process.exit(problems.length ? 1 : 0);