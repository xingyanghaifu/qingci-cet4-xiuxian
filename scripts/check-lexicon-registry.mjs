/**
 * 词库登记一致性检查（构建前置）
 *
 * 为什么需要这个脚本：
 * 新增一个词库，需要在**四处**分别登记，漏一处就静默失效（不报错）：
 *   1. scripts/build-lexicon.mjs      LEXICONS + writeManifest 的 order
 *   2. scripts/build-mnemonics.mjs    LEXICONS 数组
 *   3. scripts/build-exam-bank.mjs    LEXICONS（含 plan/targets）
 *   4. scripts/verify-exam-bank.mjs   LEX
 *   另有：src/services/lexicon.ts 的 FALLBACK_LEXICONS、src/data/lexicons/manifest.json
 *
 * GRE 那一批**四处全踩过**：分片建好了、清单里没有、助记没生成、
 * 校验脚本还报「未知词库」。这个脚本把「四处是否一致」变成一条命令。
 *
 * 用法：
 *   node scripts/check-lexicon-registry.mjs            # 检查全部
 *   node scripts/check-lexicon-registry.mjs --lexicon gre
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const argv = process.argv.slice(2);
const ONLY = (() => { const i = argv.indexOf('--lexicon'); return i >= 0 ? argv[i + 1] : null; })();

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const readJson = (p) => JSON.parse(read(p));

/** 从源码里抽出「被登记的词库 id」 */
function idsInArrayBlock(src, blockStartRe) {
  const m = src.match(blockStartRe);
  if (!m) return null;
  // 从匹配点开始做花括号/方括号配对
  const openIdx = src.indexOf(m[0].length ? '[' : '[', m.index);
  const start = src.indexOf('[', m.index);
  if (start < 0) return null;
  let depth = 0, end = -1;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '[') depth++;
    else if (src[i] === ']') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return null;
  const body = src.slice(start, end);
  const ids = new Set();
  for (const x of body.matchAll(/^\s*(?:id:\s*)?['"]?([a-z]{3,10})['"]?\s*:/gm)) ids.add(x[1]);
  for (const x of body.matchAll(/\bid:\s*['"]([a-z]{3,10})['"]/g)) ids.add(x[1]);
  return ids;
}

/** 从对象字面量（形如 `xxx: {`）里抽 key */
function objectKeys(src, startRe) {
  const m = src.match(startRe);
  if (!m) return null;
  const start = src.indexOf('{', m.index);
  if (start < 0) return null;
  let depth = 0, end = -1;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return null;
  const body = src.slice(start, end);
  const ids = new Set();
  for (const x of body.matchAll(/^\s{2}([a-z]{3,10}):\s*\{/gm)) ids.add(x[1]);
  return ids;
}

const problems = [];
const info = [];

/* 1. manifest.json（事实来源） */
const manifest = readJson('src/data/lexicons/manifest.json');
const manifestIds = new Set(manifest.lexicons.map((l) => l.id));
info.push(`manifest.json            : ${[...manifestIds].join(', ')}`);

/* 2. build-lexicon.mjs：LEXICONS 与 order */
const bl = read('scripts/build-lexicon.mjs');
const blLex = objectKeys(bl, /const LEXICONS\s*=\s*\{/);
const blOrder = (() => {
  const m = bl.match(/const order = \[([^\]]+)\]/);
  return m ? new Set([...m[1].matchAll(/'([a-z]{3,10})'/g)].map((x) => x[1])) : null;
})();
info.push(`build-lexicon LEXICONS   : ${blLex ? [...blLex].join(', ') : '(未解析)'}`);
info.push(`build-lexicon order      : ${blOrder ? [...blOrder].join(', ') : '(未解析)'}`);

/* 3. build-mnemonics.mjs */
const bm = read('scripts/build-mnemonics.mjs');
const bmLex = (() => {
  const m = bm.match(/const LEXICONS = \[([\s\S]*?)\n\];/);
  return m ? new Set([...m[1].matchAll(/id:\s*'([a-z]{3,10})'/g)].map((x) => x[1])) : null;
})();
info.push(`build-mnemonics LEXICONS : ${bmLex ? [...bmLex].join(', ') : '(未解析)'}`);

/* 4. build-exam-bank.mjs */
const be = read('scripts/build-exam-bank.mjs');
const beLex = objectKeys(be, /const LEXICONS\s*=\s*\{/);
info.push(`build-exam-bank LEXICONS : ${beLex ? [...beLex].join(', ') : '(未解析)'}`);

/* 5. verify-exam-bank.mjs */
const vf = read('scripts/verify-exam-bank.mjs');
const vfLex = objectKeys(vf, /const LEX\s*=\s*\{/);
info.push(`verify-exam-bank LEX     : ${vfLex ? [...vfLex].join(', ') : '(未解析)'}`);

/* 6. 服务层 FALLBACK_LEXICONS */
const svc = read('src/services/lexicon.ts');
const svcIds = new Set([...svc.matchAll(/\bid:\s*'([a-z][a-z0-9]{2,10})'/g)].map((x) => x[1]));
info.push(`services/lexicon.ts      : ${[...svcIds].join(', ')}`);

/* 7. 每个「已上线」词库（enabled=true 且 wordCount>0）必须有完整登记 */
const live = manifest.lexicons.filter((l) => l.enabled && l.wordCount > 0).map((l) => l.id);
const checkIds = ONLY ? [ONLY] : live;

/**
 * 各词库的**已知例外**（不是遗漏，是设计如此）。
 * 写清楚为什么，避免下次有人把它们当 bug「修」掉。
 */
const EXCEPTIONS = {
  cet4: {
    // CET-4 是默认词库，走**独立路径**：
    //   · 详情分片由 build-vocab-detail.mjs 产出在 src/data/vocab-detail/，
    //     构建时拷到 dist/vocab-detail/（不在 lexicons/ 下）
    //   · 题库是单文件 question-bank.json（不进 lexicons/<id>/question-bank/）
    //   · 因此不登记进 build-lexicon / build-exam-bank / verify-exam-bank 的词库表
    distDetail: 'vocab-detail/manifest.json',
    skip: ['build-lexicon.LEXICONS', 'build-lexicon.order', 'build-mnemonics.LEXICONS',
      'build-exam-bank.LEXICONS', 'verify-exam-bank.LEX', 'services/lexicon.ts'],
  },
  cet6: {
    // CET-6 的词表来自 mahavivo CET6_edited.txt（不是 ECDICT tag），
    // 由早期 build-lexicon 的独立分支处理；详情与助记已产出。
    skip: ['build-lexicon.LEXICONS', 'build-lexicon.order', 'build-mnemonics.LEXICONS',
      'build-exam-bank.LEXICONS', 'verify-exam-bank.LEX', 'services/lexicon.ts'],
  },
  junior: {
    // 中学词库的助记走 build-lexicon 内部流程，不经 build-mnemonics（后者只管 CET 系）
    skip: ['build-mnemonics.LEXICONS'],
  },
  senior: {
    skip: ['build-mnemonics.LEXICONS'],
  },
  pretco: {
    // PRETCO 词库数据**复用 CET-4**（近似方案），没有自己的 vocab-detail，
    // 因此不需要助记（助记挂在 CET-4 分片上）
    skip: ['build-mnemonics.LEXICONS'],
    noOwnDetail: true,
  },
};

for (const id of checkIds) {
  const exc = EXCEPTIONS[id] || { skip: [] };
  const skipped = new Set(exc.skip);
  const miss = [];
  if (!manifestIds.has(id)) miss.push('manifest.json');
  if (blLex && !blLex.has(id) && !skipped.has('build-lexicon.LEXICONS')) miss.push('build-lexicon.LEXICONS');
  if (blOrder && !blOrder.has(id) && !skipped.has('build-lexicon.order')) miss.push('build-lexicon.order（会静默不出现在清单）');
  if (bmLex && !bmLex.has(id) && !skipped.has('build-mnemonics.LEXICONS')) miss.push('build-mnemonics.LEXICONS（不会生成助记）');
  if (beLex && !beLex.has(id) && !skipped.has('build-exam-bank.LEXICONS')) miss.push('build-exam-bank.LEXICONS（不会生成题库）');
  if (vfLex && !vfLex.has(id) && !skipped.has('verify-exam-bank.LEX')) miss.push('verify-exam-bank.LEX（校验会报未知词库）');
  if (!svcIds.has(id) && !skipped.has('services/lexicon.ts')) miss.push('services/lexicon.ts FALLBACK_LEXICONS（离线兜底缺）');
  if (miss.length) problems.push(`${id}: 缺登记 → ${miss.join(' / ')}`);

  // 产物侧：详情分片必须在（PRETCO 复用 CET-4，故跳过）
  if (fs.existsSync(path.join(ROOT, 'dist')) && !exc.noOwnDetail) {
    const detailPath = exc.distDetail
      ? path.join(ROOT, 'dist', exc.distDetail)
      : path.join(ROOT, 'dist', 'lexicons', id, 'vocab-detail', 'manifest.json');
    if (!fs.existsSync(detailPath)) {
      problems.push(`${id}: dist 缺详情分片（${exc.distDetail || 'lexicons/' + id + '/vocab-detail/manifest.json'}）`);
    }
  }
}

console.log('=== 词库登记现状 ===');
for (const l of info) console.log('  ' + l);
console.log(`\n=== 检查 ${checkIds.length} 个已上线词库 ===`);
if (problems.length) {
  console.error('❌ 发现问题：');
  for (const p of problems) console.error('   ' + p);
  process.exit(1);
}
console.log('✅ 全部登记一致');
