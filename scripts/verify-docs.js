// 逐条执行 API.md 中的示例，核对输出是否与文档声称的一致
const U = require('../src/core/utils');
const Q = require('../src/core/quiz');
const results = [];
const check = (name, got, expect) => {
  const g = String(got), e = String(expect);
  results.push({ name, ok: g === e, got: g, expect: e });
};

// utils.js
check('hash("cet4")', U.hash('cet4'), 279018245);
const rand = U.rng(42);
check('rng(42) 前三个', [rand(), rand(), rand()].map(n => n.toFixed(6)).join(', '), '0.601104, 0.448291, 0.852466');
check('rng 可复现', U.rng(42)() === U.rng(42)(), 'true');
const out = U.pick([1,2,3,4,5], 3, U.rng(7));
check('pick 长度与去重', out.length + ' ' + new Set(out).size, '3 3');
check('wordsOf', U.wordsOf("I don't like it"), 4);
check('esc', U.esc('<b>x</b>'), '&lt;b&gt;x&lt;/b&gt;');
check('dayKey', U.dayKey(new Date(2026, 0, 5)), '2026-01-05');
const realms = [['炼气',80],['筑基',160],['金丹',280]];
check('realmOf(80)', U.realmOf(80, realms).name, '筑基');
check('realmOf(99999)', U.realmOf(99999, realms).name, '词仙');
const now = 1700000000000;
const r = U.scheduleWord(null, 'good', now);
check('scheduleWord', r.level + ' ' + (r.next - now === 3*86400000) + ' ' + r.tries, 'good true 1');
check('checkSpell 大小写', U.checkSpell('Apple', 'apple').ok, 'true');
check('checkSpell near', U.checkSpell('appl', 'apple').near, 'true');
check('masteryPercent', U.masteryPercent(454, 4540), 10);
check('ringOffset', U.ringOffset(50,302) + ' ' + U.ringOffset(999,302), '151 0');
const rd = U.recentDays({ '2026-06-10': { right: 5 } }, 7, new Date(2026,5,10).getTime());
check('recentDays', rd.length + ' ' + rd[6].key + ' ' + rd[6].right + ' ' + rd[0].right, '7 2026-06-10 5 0');
check('paperScore', U.paperScore([{id:'write',weight:106.5,count:1},{id:'news',weight:49.7,count:7}], {write:1,news:7}), 157);

// quiz.js
check('MEMORY_KINDS', Q.MEMORY_KINDS.join(','), 'zh2en,en2zh,similar,listen,spell,pos');
check('KIND_LABEL.spell', Q.KIND_LABEL.spell, '拼写默写');
const words = [
  { w:'apple', ipa:'[ˈæpl]', zh:'n.苹果', short:'苹果' },
  { w:'apply', ipa:'[əˈplai]', zh:'vt.应用', short:'应用' },
  { w:'banana', ipa:'[bəˈnɑːnə]', zh:'n.香蕉', short:'香蕉' },
  { w:'berry', ipa:'[ˈberi]', zh:'n.浆果', short:'浆果' },
];
const sp = Q.makeMemoryQuestion('spell', { words, meta:{id:'demo'}, index:0, seedText:'demo|spell' });
check('spell 题面', sp.prompt + ' | ' + sp.sub + ' | ' + sp.tpl, '香蕉 | [bəˈnɑːnə] · 6 个字母 | b_____');
const z2e = Q.makeMemoryQuestion('zh2en', { words, meta:{id:'demo'}, index:0, seedText:'demo' });
check('zh2en 选项', z2e.choices.length + ' ' + z2e.choices.includes(z2e.answer), '4 true');
check('judgeChoice 对', Q.judgeChoice({ choices:['a','b','c'], answer:'b' }, 1), 'true');
check('judgeChoice 错', Q.judgeChoice({ choices:['a','b','c'], answer:'b' }, 0), 'false');
check('judge 拼写', Q.judge({ kind:'spell', answer:'apple' }, 'Apple').ok, 'true');
check('judge 选择', Q.judge({ choices:['a'], answer:'a' }, 'a').ok, 'true');
const s1 = Q.recordMemStat({}, 'zh2en', true);
const s2 = Q.recordMemStat(s1, 'zh2en', false);
check('recordMemStat', JSON.stringify(s1) + ' ' + JSON.stringify(s2) + ' ' + JSON.stringify({}), '{"zh2en":{"r":1,"n":1}} {"zh2en":{"r":1,"n":2}} {}');
check('kindAccuracy', Q.kindAccuracy({r:3,n:4}) + ' ' + Q.kindAccuracy(null), '75 null');

// 汇总
let pass = 0, fail = 0;
results.forEach(x => { if (x.ok) pass++; else { fail++; console.log('❌ ' + x.name + '  实际=' + x.got + '  文档=' + x.expect); } });
console.log('\n总计 ' + results.length + ' 条：通过 ' + pass + '，失败 ' + fail);
