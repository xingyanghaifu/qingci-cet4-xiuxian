#!/usr/bin/env node
/**
 * 任务 A：Edge TTS 题库听力音频生成管线（编排层）
 *
 * 定位：**仅构建期**合成，运行时不发起任何 TTS 请求；产物独立于单文件 HTML
 *       （dist/audio/tts/，由 Service Worker 的 /audio/* cache-first 分支离线缓存）。
 *
 * 合成后端（按优先级探测，命中后日志打印实际后端）：
 *   1. edge-tts-generator（npm，GPL-3.0）—— 若被微软 Sec-MS-GEC 校验拒绝（403）
 *   2. Python edge-tts（pip install edge-tts）—— scripts/edge_tts_batch.py 批量合成
 *   两个后端同为 Microsoft Edge Read Aloud 音源，音色与语速一致。
 *
 * 输入：dist/question-bank.json（先 npm run build 产出）
 *   - 筛选 kind ∈ {listen, news, talk, passage}（与 audioMeta 全量对齐 4690 条）
 *   - TTS 文本取 audioMeta.text（应用实际播放的文本），缺失回退 题干+选项
 *
 * 音色轮换（VOICE_MAP 是唯一改音色的位置）：
 *   - listen / news（短篇新闻 Section A）→ Aria，voiceRole=narration
 *   - passage（听力篇章 Section C）      → Aria / Ryan 按序轮换，voiceRole=narration
 *   - talk（长对话 Section B）           → 需对话轮次标记才能 Aria+Guy；题库当前 0/48 条带
 *                                          标记 → 按约定统一 Aria、voiceRole 留空，出分类报告
 *
 * 增量：manifest.textHash = sha256(text|voice|speed)；文件存在且哈希一致 → 跳过；
 *       文本或音色变化 → 重新生成。失败单条重试 1 次，仍失败记录并继续（不阻塞）。
 * 时长：music-metadata（MIT 纯 JS）读 mp3 → manifest.duration（精听时间戳初值）。
 *
 * 输出：dist/audio/tts/<questionId>.mp3 + dist/audio/tts/manifest.json
 * 用法：npm run build:audio   （--backend=python|edgejs 可强制指定后端）
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFile } from 'music-metadata';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BANK_PATH = join(root, 'dist', 'question-bank.json');
const OUT_DIR = join(root, 'dist', 'audio', 'tts');
const MANIFEST_PATH = join(OUT_DIR, 'manifest.json');
const PY_BATCH = join(root, 'scripts', 'edge_tts_batch.py');
const WORK_DIR = join(root, '.cache');
const SCHEMA = 'qingci-audio-tts/1';
const SPEED = 1.0;
const JS_CONCURRENCY = 3;

/* ── 音色映射：换音色只改这里 ── */
const VOICE_MAP = {
  main: 'en-US-AriaNeural',    // 美式女声，主音色
  male: 'en-US-GuyNeural',     // 美式男声，预留对话 B 分声
  british: 'en-GB-RyanNeural', // 英式男声，篇章轮换
};
const LISTENING_KINDS = new Set(['listen', 'news', 'talk', 'passage']);
const KIND_LABEL = { listen: '听音辨词', news: '短篇新闻(Section A)', talk: '长对话(Section B)', passage: '听力篇章(Section C)' };

const sha256 = (t) => 'sha256:' + createHash('sha256').update(t, 'utf8').digest('hex');

function loadBank() {
  if (!existsSync(BANK_PATH)) {
    console.error('❌ 未找到 dist/question-bank.json，请先执行 npm run build');
    process.exit(1);
  }
  const bank = JSON.parse(readFileSync(BANK_PATH, 'utf8'));
  const cet4 = Array.isArray(bank.questions) ? bank.questions : [];
  return [...cet4, ...loadLexiconBanks()];
}

/**
 * 各词库的分片题库（src/data/lexicons/<id>/question-bank/*.json）。
 *
 * 背景（2026-10-06 用户反馈「点了真实音频，没有实际音频」）：
 * 本脚本原先**只**读 dist/question-bank.json（CET-4 主题库），
 * 所以 TTS 只覆盖了 CET-4 的 4690 条。切到初中/高中/考研/PRETCO 后，
 * 题目 id 是 q_<前缀>_<题型>_<序号>（q_pt_* / q_ky_* …），
 * 清单里一条都没有 → pickTtsSrc 返回 null → 「该题暂无生成音频」。
 * 词库题库是分片的，必须一起扫，否则新词库永远是哑的。
 */
function loadLexiconBanks() {
  const lexRoot = join(root, 'src', 'data', 'lexicons');
  if (!existsSync(lexRoot)) return [];
  const out = [];
  for (const id of readdirSync(lexRoot)) {
    const dir = join(lexRoot, id, 'question-bank');
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      // manifest.json 是索引（含 papers/plan），不是题目本身
      if (!file.endsWith('.json') || file === 'manifest.json') continue;
      let parsed;
      try { parsed = JSON.parse(readFileSync(join(dir, file), 'utf8')); } catch { continue; }
      const items = Array.isArray(parsed) ? parsed : parsed.questions || parsed.items;
      if (Array.isArray(items)) out.push(...items);
    }
  }
  return out;
}
function loadManifest() {
  try {
    const m = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    return m && m.entries && typeof m.entries === 'object' ? m : { entries: {} };
  } catch {
    return { entries: {} };
  }
}
function textOf(q) {
  const t = q.audioMeta && typeof q.audioMeta.text === 'string' ? q.audioMeta.text.trim() : '';
  if (t) return t;
  const c = q.content || {};
  return [c.prompt, ...(Array.isArray(c.choices) ? c.choices : [])].filter(Boolean).join(' ');
}
function voiceForIndex(kind, index) {
  if (kind === 'passage') return { voice: index % 2 === 1 ? VOICE_MAP.british : VOICE_MAP.main, voiceRole: 'narration' };
  if (kind === 'talk') return { voice: VOICE_MAP.main, voiceRole: '' }; // 缺轮次标记 → 留空
  return { voice: VOICE_MAP.main, voiceRole: 'narration' };
}
async function pool(items, limit, worker) {
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await worker(items[i++]);
  });
  await Promise.all(runners);
}
async function durationOf(file) {
  try {
    const meta = await parseFile(file);
    return Math.round((meta.format.duration || 0) * 10) / 10;
  } catch {
    return 0;
  }
}

/* ── 后端 1：edge-tts-generator（npm 包；可能被 403 拒绝） ── */
async function tryEdgeJs(item) {
  try {
    const pkg = await import('edge-tts-generator');
    const fn = pkg.textToSpeechMp3 || (pkg.default && pkg.default.textToSpeechMp3);
    await fn({ text: item.text, outputPath: OUT_DIR, fileName: item.id, options: { voice: item.voice, speed: SPEED } });
    return true;
  } catch (e) {
    return { error: String((e && e.message) || e) };
  }
}
async function runEdgeJs(items, stats, failures, entries, prev) {
  const { textToSpeechMp3 } = await import('edge-tts-generator').then((p) => p.textToSpeechMp3 ? p : p.default);
  let done = 0;
  await pool(items, JS_CONCURRENCY, async (item) => {
    try {
      await textToSpeechMp3({ text: item.text, outputPath: OUT_DIR, fileName: item.id, options: { voice: item.voice, speed: SPEED } });
      entries[item.id] = await entryOf(item);
      stats.generated++;
    } catch (e) {
      stats.failed++;
      failures.push({ id: item.id, error: String((e && e.message) || e) });
    }
    done++;
    if (done % 200 === 0) console.log(`   … ${done}/${items.length}（新生成 ${stats.generated} · 失败 ${stats.failed}）`);
  });
}

/* ── 后端 2：Python edge-tts 批量 ── */
function runPythonBatch(items) {
  return new Promise((resolve) => {
    mkdirSync(WORK_DIR, { recursive: true });
    const workPath = join(WORK_DIR, 'tts-work.json');
    writeFileSync(workPath, JSON.stringify({
      outDir: OUT_DIR,
      rate: '+0%',
      concurrency: 8,
      items: items.map((i) => ({ id: i.id, text: i.text, voice: i.voice })),
    }), 'utf8');
    const py = process.platform === 'win32' ? 'python' : 'python3';
    const child = spawn(py, [PY_BATCH, workPath], { cwd: root, stdio: 'inherit' });
    child.on('error', (e) => resolve({ spawnError: String(e.message || e) }));
    child.on('exit', (code) => resolve({ code, workPath }));
  });
}

async function entryOf(item) {
  const file = join(OUT_DIR, `${item.id}.mp3`);
  return {
    questionId: item.id,
    file: `tts/${item.id}.mp3`,
    kind: item.kind,
    voice: item.voice,
    voiceRole: item.voiceRole,
    duration: await durationOf(file),
    textHash: item.hash,
    bytes: statSync(file).size,
  };
}

async function main() {
  const forceBackend = (process.argv.find((a) => a.startsWith('--backend=')) || '').split('=')[1] || 'auto';
  const questions = loadBank();
  const listening = questions.filter((q) => LISTENING_KINDS.has(q.kind));
  const prev = loadManifest();
  mkdirSync(OUT_DIR, { recursive: true });

  /* ── 题库兼容性 / 分类报告（缺什么报什么，不猜测） ── */
  const byKind = {};
  listening.forEach((q) => { byKind[q.kind] = (byKind[q.kind] || 0) + 1; });
  console.log('📋 听力题分类报告：');
  for (const [k, n] of Object.entries(byKind)) console.log(`   ${String(k).padEnd(8)} ${String(n).padStart(5)} 条  →  ${KIND_LABEL[k] || ''}`);
  const talkAll = listening.filter((q) => q.kind === 'talk');
  const turns = talkAll.filter((q) => /\b(Man|Woman|Speaker|W|M|A|B)\s*[:：]/.test(q.audioMeta?.text || ''));
  if (talkAll.length && turns.length === 0) {
    console.log(`   ⚠️ 长对话 ${talkAll.length} 条均无对话轮次标记（Man/Woman/M:/W:）→ 按约定统一 Aria，voiceRole 留空；题库补齐轮次后重跑本脚本即自动升级为 Aria+Guy 分声`);
  }
  console.log(`   音色 Aria=${VOICE_MAP.main} · Guy=${VOICE_MAP.male} · Ryan=${VOICE_MAP.british}，语速 ${SPEED}\n`);

  /* ── 组装任务与增量判定 ── */
  let passageIndex = 0;
  const all = listening.map((q) => {
    const idx = q.kind === 'passage' ? passageIndex++ : 0;
    const { voice, voiceRole } = voiceForIndex(q.kind, idx);
    const text = textOf(q);
    return { id: q.id, kind: q.kind, text, voice, voiceRole, hash: sha256(`${text}|${voice}|${SPEED}`) };
  });
  const entries = { ...prev.entries };
  const stats = { generated: 0, skipped: 0, failed: 0 };
  const failures = [];
  const todo = [];
  for (const item of all) {
    const file = join(OUT_DIR, `${item.id}.mp3`);
    const old = prev.entries[item.id];
    if (existsSync(file) && old && old.textHash === item.hash) {
      stats.skipped++;
      entries[item.id] = { ...old, voice: item.voice, voiceRole: item.voiceRole };
      continue;
    }
    todo.push(item);
  }
  console.log(`⏳ 待生成 ${todo.length} / ${all.length}（增量跳过 ${stats.skipped}）`);

  if (todo.length) {
    /* ── 后端选择：探测 edge-tts-generator，失败切 Python 批量 ── */
    let backend = forceBackend === 'python' || forceBackend === 'edgejs' ? forceBackend : null;
    if (!backend) {
      console.log('   [backend] 探测 edge-tts-generator（npm）…');
      const probe = await tryEdgeJs(todo[0]);
      if (probe === true) {
        backend = 'edgejs';
        console.log('   [backend] 实际使用 edge-tts-generator（npm 包可用）');
        entries[todo[0].id] = await entryOf(todo[0]);
        stats.generated++;
        await runEdgeJs(todo.slice(1), stats, failures, entries, prev);
      } else {
        console.log(`   [backend] edge-tts-generator 不可用（${(probe && probe.error) || '403'}）→ 切换 python edge-tts`);
        backend = 'python';
      }
    }
    if (backend === 'edgejs' && stats.generated === 0) {
      const probe = await tryEdgeJs(todo[0]);
      if (probe === true) {
        entries[todo[0].id] = await entryOf(todo[0]);
        stats.generated++;
        await runEdgeJs(todo.slice(1), stats, failures, entries, prev);
      } else {
        console.log(`   [backend] edge-tts-generator 不可用 → 切换 python edge-tts`);
        backend = 'python';
      }
    }
    if (backend === 'python') {
      console.log('   [backend] 实际使用 python edge-tts（scripts/edge_tts_batch.py）');
      const res = await runPythonBatch(todo);
      if (res.spawnError) {
        console.error(`❌ 无法启动 Python 后端：${res.spawnError}`);
        console.error('   请安装 Python 3.9+ 并执行：pip install edge-tts');
        process.exit(1);
      }
      let batch = { generated: [], failed: [] };
      try { batch = JSON.parse(readFileSync(res.workPath.replace(/\.json$/, '.result.json'), 'utf8')); } catch { /* 结果缺失按全失败处理 */ }
      for (const item of todo) {
        if (batch.generated.includes(item.id)) {
          entries[item.id] = await entryOf(item);
          stats.generated++;
        } else {
          const f = batch.failed.find((x) => x.id === item.id);
          stats.failed++;
          failures.push({ id: item.id, error: (f && f.error) || 'unknown' });
        }
      }
    }
  }

  /* ── 清单与汇总 ── */
  const manifest = {
    schema: SCHEMA,
    count: Object.keys(entries).length,
    speed: SPEED,
    voiceMap: VOICE_MAP,
    entries,
  };
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest), 'utf8');

  const totalBytes = Object.values(entries).reduce((s, e) => s + (e.bytes || 0), 0);
  const totalDur = Object.values(entries).reduce((s, e) => s + (e.duration || 0), 0);
  console.log('');
  console.log('✅ TTS 音频生成完成');
  console.log(`   新生成 ${stats.generated} · 增量跳过 ${stats.skipped} · 失败 ${stats.failed}`);
  console.log(`   清单 ${Object.keys(entries).length} 条 → dist/audio/tts/manifest.json`);
  console.log(`   体积 ${(totalBytes / 1024 / 1024).toFixed(1)} MB · 总时长 ${(totalDur / 60).toFixed(1)} 分钟（不内联、不进 git）`);
  if (failures.length) {
    console.log('   失败明细（已跳过不阻塞，重跑可续）：');
    failures.slice(0, 20).forEach((f) => console.log(`     - ${f.id}: ${f.error}`));
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('❌ 生成失败：', e);
  process.exit(1);
});
