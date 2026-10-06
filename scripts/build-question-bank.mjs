#!/usr/bin/env node
/**
 * 固化题库生成器（P0.3）
 *
 * 设计要点：
 *   1. **不重写生成逻辑**：直接从 `src/index.template.html` 里抽取应用自身的
 *      `rng / hash / pick / normShort / bankFor / makeQuestion / makeMemoryQuestion` 等函数，
 *      在一个沙箱里求值后调用——题库内容与应用运行时生成的内容不会漂移。
 *   2. **稳定 ID**：词汇题 `q_vocab_<词序>_<题型>`、试卷题 `q_paper_<卷 id>_<gate>_<序号>`，
 *      与内容一一对应且永不改变（错题本以它为主键）。
 *   3. **确定性**：同一份模板每次生成结果完全一致（无时间戳参与内容生成，
 *      `generatedAt` 只在产物元信息里，且复用已有产物时保持稳定）。
 *
 * 用法：
 *   node scripts/build-question-bank.mjs [--out dist/question-bank.json] [--quiet]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TEMPLATE = path.join(ROOT, 'src', 'index.template.html');

/** 内联 JSON 数据块（lexicon / papers） */
function extractJsonScript(html, id) {
  const m = new RegExp(`<script id="${id}" type="application/json">([\\s\\S]*?)</script>`).exec(html);
  if (!m) throw new Error(`模板缺少 <script id="${id}">`);
  return JSON.parse(m[1]);
}

/** 按函数名抽取源码（用大括号配平，避免误截） */
export function extractFunction(html, name) {
  const start = html.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`模板中找不到函数 ${name}()`);
  const braceStart = html.indexOf('{', start);
  let depth = 0;
  for (let i = braceStart; i < html.length; i++) {
    const ch = html[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  throw new Error(`函数 ${name}() 源码不完整`);
}

/** 抽取 `const NAME = ...;` 形式的常量（到行尾分号） */
export function extractConst(html, name) {
  // 行尾必须是「LF 或 CRLF」两种都认 —— 模板可能因编辑器/检出设置被换成 CRLF，
  // 只匹配裸 \n 会让构建在 Windows 上直接失败（且失败信息极具迷惑性：常量明明还在）。
  const m = new RegExp(`const ${name}\\s*=\\s*([\\s\\S]*?);\\r?\\n`).exec(html);
  if (!m) throw new Error(`模板中找不到常量 ${name}`);
  return `const ${name} = ${m[1]};`;
}

export const VOCAB_KINDS = ['en2zh', 'listen', 'similar', 'spell'];

/** CET-4 卷的题型顺序（与 buildExamQueue 中的 add(...) 完全一致） */
export const CET4_GATE_PLAN = [
  ['write', 1], ['news', 7], ['talk', 8], ['passage', 10],
  ['bank', 10], ['match', 10], ['detail', 10], ['trans', 1],
];

/**
 * 从模板中装载「应用自身的生成器」
 * @returns {{lexicon: object[], papers: object[], gen: {makeQuestion: Function, makeMemoryQuestion: Function, bankFor: Function}}}
 */
export function loadGenerator(html = fs.readFileSync(TEMPLATE, 'utf8')) {
  const lexicon = extractJsonScript(html, 'lexicon');
  const papers = extractJsonScript(html, 'papers');
  const byWord = new Map(lexicon.map((w) => [w.w, w]));

  const source = [
    extractConst(html, 'POS_LABEL'),
    extractConst(html, 'MEMORY_KINDS'),
    extractFunction(html, 'rng'),
    extractFunction(html, 'hash'),
    extractFunction(html, 'pick'),
    extractFunction(html, 'normShort'),
    extractFunction(html, 'posOf'),
    extractFunction(html, 'similarWords'),
    extractFunction(html, 'memoryPool'),
    extractFunction(html, 'bankFor'),
    extractFunction(html, 'makeQuestion'),
    extractFunction(html, 'makeMemoryQuestion'),
  ].join('\n\n');

  // 沙箱：只提供生成函数真正需要的依赖（WORDS / PAPERS / byWord / state）。
  // `poolRef` 用于覆盖 memoryPool()：题库要为「每个词」生成题目，而不是随机取词，
  // 因此把候选池收窄成单个词（函数声明后者覆盖前者，覆盖生效且无需改动应用源码）。
  const factory = new Function(
    'WORDS', 'PAPERS', 'byWord', 'state', 'Math', 'poolRef',
    source
    + '\n\nfunction memoryPool(){ return poolRef.current; }'
    + '\n\nreturn { makeQuestion, makeMemoryQuestion, bankFor };',
  );
  const poolRef = { current: lexicon };
  const gen = factory(
    lexicon,
    papers,
    byWord,
    { pool: 'mix', wrong: {}, schedule: {}, seen: 0, selected: null },
    Math,
    poolRef,
  );
  return { lexicon, papers, gen, poolRef };
}

/** 词汇题难度：长度 + 题型系数（0.2–0.8，越靠后越难） */
export function vocabDifficulty(word, kind) {
  const len = String(word).length;
  const byLen = Math.min(0.45, Math.max(0, (len - 3) * 0.045));
  const kindBonus = { en2zh: 0, listen: 0.05, similar: 0.1, spell: 0.15 }[kind] ?? 0.05;
  return Math.round(Math.min(0.8, Math.max(0.2, 0.2 + byLen + kindBonus)) * 100) / 100;
}

/** 试卷题难度：门类基准 + 序号抖动 */
export function paperDifficulty(gate, index) {
  const base = {
    write: 0.6, trans: 0.6, news: 0.4, talk: 0.45, passage: 0.55,
    bank: 0.5, match: 0.5, detail: 0.5, speak: 0.55,
  }[gate] ?? 0.5;
  const jitter = ((index % 5) - 2) * 0.02;
  return Math.round(Math.min(0.8, Math.max(0.2, base + jitter)) * 100) / 100;
}

/** 区分度先验：按题型给一个保守初值，后续用真实作答统计再校准 */
export function discriminationPrior(kind) {
  const value = {
    spell: 0.45, similar: 0.42, listen: 0.38, en2zh: 0.32,
    detail: 0.4, passage: 0.4, talk: 0.38, news: 0.35, bank: 0.4, match: 0.42,
    write: 0.3, trans: 0.35,
  }[kind] ?? 0.35;
  return value;
}

function knowledgeTagsFor(word, kind, promptIsWord = false) {
  const len = String(word).length;
  // prompt 本身就是单词时不再重复记 w: 标签，省下 ~40 万字节
  const tags = ['cet4', `len:${len}`, `kind:${kind}`];
  if (!promptIsWord) tags.splice(1, 0, `w:${word}`);
  return tags;
}

/**
 * 生成固化题库
 * @param {object} options
 * @param {string} [options.html] 模板内容（默认读 src/index.template.html）
 * @param {string[]} [options.vocabKinds] 要生成的词汇题型
 * @param {boolean} [options.withPapers] 是否生成六套卷快照
 */
export function buildQuestionBank(options = {}) {
  const html = options.html ?? fs.readFileSync(TEMPLATE, 'utf8');
  const vocabKinds = options.vocabKinds ?? VOCAB_KINDS;
  const withPapers = options.withPapers !== false;
  const wordLimit = options.wordLimit ?? Infinity; // 测试用小样本，正式构建为全量
  const { lexicon, papers, gen, poolRef } = loadGenerator(html);

  const questions = [];
  const vocabMeta = { id: 'bank-vocab', name: '词库', scene: 'campus', focus: 'daily study', seeds: [] };
  const wordCount = Math.min(lexicon.length, wordLimit);

  // —— 1) 词汇题：逐词生成，稳定 id = q_vocab_<词序>_<题型> ——
  for (let i = 0; i < wordCount; i++) {
    const entry = lexicon[i];
    const word = entry.w;
    poolRef.current = [entry]; // 让生成器就取这个词（干扰项仍从全量词库中选）
    for (const kind of vocabKinds) {
      const q = gen.makeMemoryQuestion(kind, vocabMeta, i + 1);
      if (!q || q.word !== word) continue;
      const promptIsWord = q.prompt === word;
      const content = {
        prompt: q.prompt,
        choices: q.choices || [],
        answer: q.answer,
        explain: q.explain || '',
      };
      if (q.sub) content.sub = q.sub;
      if (q.tpl) { content.tpl = q.tpl; content.hint = q.hint; }
      questions.push({
        // type 由 id 前缀可推导（q_vocab_ / q_paper_），不再逐条存字段
        id: `q_vocab_${String(i).padStart(4, '0')}_${kind}`,
        kind: q.memKind || kind,
        difficulty: vocabDifficulty(word, kind),
        discrimination: discriminationPrior(kind),
        knowledgeTags: knowledgeTagsFor(word, kind, promptIsWord),
        content,
        ...(q.speak ? { audioMeta: { kind: 'tts', text: q.speak, lang: 'en-US' } } : {}),
      });
    }
  }

  // —— 2) 六套卷快照：题目 id 列表 + 与运行时一致的内容 ——
  const paperIndex = {};
  if (withPapers) {
    for (const paper of papers) {
      const ids = [];
      let cursor = 0;
      for (const [gate, count] of CET4_GATE_PLAN) {
        for (let i = 0; i < count; i++, cursor++) {
          const q = gen.makeQuestion(gate, paper, cursor);
          const id = `q_paper_${paper.id}_${gate}_${String(i + 1).padStart(2, '0')}`;
          ids.push(id);
          const content = {
            prompt: q.prompt,
            choices: q.choices || [],
            answer: q.answer ?? '',
            explain: q.explain || '',
          };
          if (q.sub) content.sub = q.sub;
          if (q.passage) content.passage = q.passage;
          if (q.write) { content.write = true; content.min = q.min; content.max = q.max; }
          if (q.sample) content.sample = q.sample;
          if (q.tpl) { content.tpl = q.tpl; content.hint = q.hint; }
          questions.push({
            id,
            kind: gate,
            part: { write: '写', trans: '译', news: '听', talk: '听', passage: '听', bank: '读', match: '读', detail: '读' }[gate] || '读',
            paperId: paper.id,
            difficulty: paperDifficulty(gate, cursor),
            discrimination: discriminationPrior(gate),
            knowledgeTags: ['cet4', `paper:${paper.id}`, `gate:${gate}`],
            content,
            ...(q.speak ? { audioMeta: { kind: 'tts', text: q.speak, lang: 'en-US' } } : {}),
          });
        }
      }
      paperIndex[paper.id] = ids;
    }
  }

  const byKind = {};
  const byType = {};
  for (const q of questions) {
    byKind[q.kind] = (byKind[q.kind] || 0) + 1;
    const type = q.id.startsWith('q_paper_') ? 'paper' : 'vocab';
    byType[type] = (byType[type] || 0) + 1;
  }

  const bank = {
    schema: 'qingci-question-bank/1',
    version: '1.0.0',
    // type 由 id 前缀推导：q_vocab_* → 词汇题，q_paper_* → 试卷快照题
    typeRule: 'q_vocab_* = 词汇题；q_paper_* = 试卷快照题',
    discriminationModel: 'heuristic-prior-v1（将在积累真实作答统计后校准）',
    counts: { total: questions.length, byType, byKind },
    papers: paperIndex,
    questions,
  };
  return bank;
}

/** 稳定序列化：字段顺序固定，便于比对与缓存 */
export function serializeBank(bank) {
  return JSON.stringify(bank) + '\n';
}

/** 产物体积与内联/拆分决策（阈值 1.5 MB，超过则拆为独立文件由 SW 按需缓存） */
export function decideDelivery(bytes, threshold = 1.5 * 1024 * 1024) {
  return bytes > threshold
    ? { mode: 'separate', reason: `题库 ${(bytes / 1024 / 1024).toFixed(2)} MB 超过 1.5 MB 阈值，作为独立 JSON 由 Service Worker 按需缓存` }
    : { mode: 'inline', reason: `题库 ${(bytes / 1024).toFixed(0)} KB 未超阈值，可直接内联进单文件` };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const outPath = outIdx >= 0 ? path.resolve(args[outIdx + 1]) : path.join(ROOT, 'dist', 'question-bank.json');
  const quiet = args.includes('--quiet');

  const bank = buildQuestionBank();
  const text = serializeBank(bank);
  const bytes = Buffer.byteLength(text, 'utf8');
  const gz = zlib.gzipSync(Buffer.from(text, 'utf8'), { level: 9 }).length;
  const br = typeof zlib.brotliCompressSync === 'function'
    ? zlib.brotliCompressSync(Buffer.from(text, 'utf8')).length
    : 0;
  const sha = crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, text, 'utf8');

  const decision = decideDelivery(bytes);
  if (!quiet) {
    console.log('📚 题库已生成: ' + path.relative(ROOT, outPath));
    console.log('   题目总数: ' + bank.counts.total + '（词汇 ' + (bank.counts.byType.vocab || 0) + ' · 试卷 ' + (bank.counts.byType.paper || 0) + '）');
    console.log('   按题型: ' + Object.entries(bank.counts.byKind).map(([k, v]) => `${k}=${v}`).join(' '));
    console.log('   试卷快照: ' + Object.keys(bank.papers).length + ' 套');
    console.log('   体积: ' + (bytes / 1024 / 1024).toFixed(2) + ' MB'
      + '（gzip ' + (gz / 1024).toFixed(0) + ' KB' + (br ? ' / br ' + (br / 1024).toFixed(0) + ' KB' : '') + '）'
      + '  指纹: sha256:' + sha);
    console.log('   交付方式: ' + decision.mode + ' —— ' + decision.reason);
  }
}
