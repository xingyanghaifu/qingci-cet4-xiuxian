#!/usr/bin/env node
/**
 * 从已部署的线上站点回捞听力音频（灾难恢复 / 换托管用）
 *
 * ── 什么时候需要它 ──
 * `dist/audio/` 是**构建期产物**且被 gitignore（332 MB，不进仓库）。
 * 一旦本机丢失（换机器、清缓存、换托管），只能重新合成 —— 但 TTS 后端可能不可用：
 *
 *   · edge-tts-generator（npm 主后端）—— 会被微软 Sec-MS-GEC 校验拒绝（403）
 *   · Python edge-tts（次后端）—— 同样受该校验影响，视版本而定
 *
 * 而**线上已经托管着完整的音频**。只要线上还在，就能原样取回，绕开 TTS 后端。
 *
 * ── 安全前提（脚本会自己校验，不靠人记）──
 * 取回**仅当**线上清单的 `textHash` 与本地源码重算的一致。
 * textHash = sha256(`${textOf(q)}|${voice}|${SPEED}`)（见 build-audio-tts.mjs）。
 * 若题库文字改过而线上还是旧音频，哈希会对不上 —— 此时**中止并报告**，
 * 绝不把过期音频写进 dist/（否则听力会念错内容，且极难察觉）。
 *
 * ── 用法 ──
 *   node scripts/fetch-audio-from-prod.mjs                    # 默认取生产站
 *   node scripts/fetch-audio-from-prod.mjs <baseUrl>          # 指定站点
 *   node scripts/fetch-audio-from-prod.mjs --dry-run          # 只校验，不下载
 *
 * 需要代理时（Node 24+）：
 *   set HTTPS_PROXY=http://127.0.0.1:7897
 *   node --use-env-proxy scripts/fetch-audio-from-prod.mjs
 *
 * 取回后 `npm run build:audio` 会因 textHash 命中而**全部跳过**，
 * 于是 deploy-pages 的音频硬闸即可通过。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const BASE = (args.find((a) => !a.startsWith('--')) || 'https://qingci-cet4-xiuxian.pages.dev').replace(/\/$/, '');

const OUT_DIR = join(root, 'dist', 'audio', 'tts');
const MANIFEST_PATH = join(OUT_DIR, 'manifest.json');
const CONCURRENCY = Number(process.env.AUDIO_FETCH_CONCURRENCY) || 24;
const MAX_RETRY = 3;

/* 与 build-audio-tts.mjs 保持同一口径 —— 这是「本地重算」的权威来源 */
const SPEED = 1.0;
const VOICE_MAP = { main: 'en-US-AriaNeural', male: 'en-US-GuyNeural', british: 'en-GB-RyanNeural' };
const LISTENING_KINDS = new Set(['listen', 'news', 'talk', 'passage']);
const LISTENING_TEXT_KINDS = new Set(['talk', 'passage', 'news', 'listen']);

const sha256 = (t) => 'sha256:' + createHash('sha256').update(t, 'utf8').digest('hex');

function textOf(q) {
  const c = q.content || {};
  const t = q.audioMeta && typeof q.audioMeta.text === 'string' ? q.audioMeta.text.trim() : '';
  if (t) return t;
  if (LISTENING_TEXT_KINDS.has(q.kind) && typeof c.passage === 'string' && c.passage.trim()) {
    return c.passage.trim();
  }
  return [c.prompt, ...(Array.isArray(c.choices) ? c.choices : [])].filter(Boolean).join(' ');
}
function voiceForIndex(kind, index) {
  if (kind === 'passage') return { voice: index % 2 === 1 ? VOICE_MAP.british : VOICE_MAP.main, voiceRole: 'narration' };
  if (kind === 'talk') return { voice: VOICE_MAP.main, voiceRole: '' };
  return { voice: VOICE_MAP.main, voiceRole: 'narration' };
}

/** 本地题库（与 build-audio-tts.mjs 的 loadBank + loadLexiconBanks 同口径） */
function loadLocalQuestions() {
  const bankPath = join(root, 'dist', 'question-bank.json');
  if (!existsSync(bankPath)) {
    console.error('❌ 未找到 dist/question-bank.json，请先执行 npm run build');
    process.exit(1);
  }
  const bank = JSON.parse(readFileSync(bankPath, 'utf8'));
  const out = Array.isArray(bank.questions) ? [...bank.questions] : [];
  const lexRoot = join(root, 'src', 'data', 'lexicons');
  if (existsSync(lexRoot)) {
    for (const id of readdirSync(lexRoot)) {
      const dir = join(lexRoot, id, 'question-bank');
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir)) {
        if (!f.endsWith('.json') || f === 'manifest.json') continue;
        let p; try { p = JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { continue; }
        const items = Array.isArray(p) ? p : p.questions || p.items;
        if (Array.isArray(items)) out.push(...items);
      }
    }
  }
  return out;
}

/** 本地重算每条听力题的 textHash（权威判据） */
function expectedEntries() {
  const listening = loadLocalQuestions().filter((q) => LISTENING_KINDS.has(q.kind));
  let passageIndex = 0;
  const map = new Map();
  for (const q of listening) {
    const idx = q.kind === 'passage' ? passageIndex++ : 0;
    const { voice, voiceRole } = voiceForIndex(q.kind, idx);
    const text = textOf(q);
    map.set(q.id, { id: q.id, kind: q.kind, voice, voiceRole, hash: sha256(`${text}|${voice}|${SPEED}`) });
  }
  return map;
}

async function fetchWithRetry(url) {
  let lastErr;
  for (let i = 1; i <= MAX_RETRY; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      lastErr = e;
      if (i < MAX_RETRY) await new Promise((r) => setTimeout(r, 400 * i));
    }
  }
  throw lastErr;
}

const t0 = Date.now();
console.log(`🎧 从线上回捞听力音频`);
console.log(`   来源: ${BASE}`);
console.log(`   目标: dist/audio/tts/`);
console.log(`   并发: ${CONCURRENCY}${dryRun ? '（--dry-run：只校验，不下载）' : ''}\n`);

// 1) 拉线上清单
let live;
try {
  live = await (await fetch(`${BASE}/audio/tts/manifest.json`)).json();
} catch (e) {
  console.error(`❌ 无法获取线上音频清单：${e.message}`);
  console.error('   若走代理，请加 --use-env-proxy 并设置 HTTPS_PROXY。');
  process.exit(1);
}
const liveEntries = live.entries || {};
console.log(`📋 线上清单: ${Object.keys(liveEntries).length} 条（声明 count=${live.count}）`);

// 2) 本地重算 + 一致性校验（**安全闸**）
const expected = expectedEntries();
console.log(`🔍 本地重算: ${expected.size} 条`);

let hashMismatch = 0, missingLive = 0, extraLive = 0;
const mismatchSamples = [];
for (const [id, e] of expected) {
  const l = liveEntries[id];
  if (!l) { missingLive++; continue; }
  if (l.textHash !== e.hash) {
    hashMismatch++;
    if (mismatchSamples.length < 5) mismatchSamples.push(id);
  }
}
for (const id of Object.keys(liveEntries)) if (!expected.has(id)) extraLive++;

console.log(`   哈希一致 : ${expected.size - hashMismatch - missingLive}`);
console.log(`   哈希不符 : ${hashMismatch}`);
console.log(`   线上缺失 : ${missingLive}`);
console.log(`   线上多出 : ${extraLive}`);

if (hashMismatch > 0 || missingLive > 0) {
  console.error('\n❌ 中止：线上音频与本地源码不一致，取回会产生「念错内容」的听力。');
  if (hashMismatch) console.error(`   哈希不符样例: ${mismatchSamples.join(', ')}`);
  if (missingLive) console.error(`   线上缺少 ${missingLive} 条`);
  console.error('   请改用 npm run build:audio 重新合成（若 TTS 后端可用）。');
  process.exit(1);
}
console.log('✅ 哈希校验通过：线上音频与本地源码完全一致\n');

if (dryRun) {
  console.log('（--dry-run 结束，未下载任何文件）');
  process.exit(0);
}

// 3) 下载
mkdirSync(OUT_DIR, { recursive: true });
const items = [...expected.values()];
const stats = { ok: 0, skip: 0, fail: 0 };
const failures = [];

let cursor = 0;
const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
  while (cursor < items.length) {
    const item = items[cursor++];
    const dest = join(OUT_DIR, `${item.id}.mp3`);
    const meta = liveEntries[item.id];
    try {
      // 已存在且字节数吻合 → 跳过（可重复运行、断点续传）
      if (existsSync(dest) && meta && statSync(dest).size === meta.bytes) { stats.skip++; continue; }
      const buf = await fetchWithRetry(`${BASE}/audio/${meta.file}`);
      if (meta && buf.length !== meta.bytes) {
        throw new Error(`字节数不符：期望 ${meta.bytes}，实际 ${buf.length}`);
      }
      writeFileSync(dest, buf);
      stats.ok++;
    } catch (e) {
      stats.fail++;
      failures.push({ id: item.id, error: String(e.message || e) });
    }
    const done = stats.ok + stats.skip + stats.fail;
    if (done % 500 === 0) {
      const sec = (Date.now() - t0) / 1000;
      console.log(`   … ${done}/${items.length}（下载 ${stats.ok} · 跳过 ${stats.skip} · 失败 ${stats.fail}）${(done / sec).toFixed(1)}/s`);
    }
  }
});
await Promise.all(runners);

// 4) 写回清单（按本地重算的权威值，保留线上 duration/bytes）
const outEntries = {};
for (const item of items) {
  const l = liveEntries[item.id] || {};
  outEntries[item.id] = {
    questionId: item.id,
    file: `tts/${item.id}.mp3`,
    kind: item.kind,
    voice: item.voice,
    voiceRole: item.voiceRole,
    duration: l.duration || 0,
    textHash: item.hash,
    bytes: existsSync(join(OUT_DIR, `${item.id}.mp3`)) ? statSync(join(OUT_DIR, `${item.id}.mp3`)).size : (l.bytes || 0),
  };
}
const byKind = {};
for (const e of Object.values(outEntries)) byKind[e.kind] = (byKind[e.kind] || 0) + 1;
writeFileSync(MANIFEST_PATH, JSON.stringify({
  schema: live.schema || 'qingci-audio-tts/1',
  count: Object.keys(outEntries).length,
  speed: live.speed || SPEED,
  voiceMap: live.voiceMap || VOICE_MAP,
  entries: outEntries,
}, null, 0) + '\n', 'utf8');

const sec = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\n=== 完成（${sec}s）===`);
console.log(`   下载 ${stats.ok} · 跳过 ${stats.skip} · 失败 ${stats.fail}`);
console.log(`   清单 ${MANIFEST_PATH}`);
console.log(`   分布 ${JSON.stringify(byKind)}`);
if (failures.length) {
  console.error(`\n⚠️ ${failures.length} 条失败（前 5 条）：`);
  for (const f of failures.slice(0, 5)) console.error(`   ${f.id}: ${f.error}`);
  process.exit(1);
}
console.log('\n✅ 音频就绪。下一步：npm run build:audio（应全部跳过）→ npm run deploy:pages');
