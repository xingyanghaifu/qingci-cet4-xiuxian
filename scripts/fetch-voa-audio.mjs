#!/usr/bin/env node
/**
 * 任务 B：VOA Learning English 公共领域素材抓取脚本（骨架）
 *
 * 用法：npm run fetch:voa      （先在 scripts/voa-seeds.json 填入种子 URL 列表）
 *
 * 输入 scripts/voa-seeds.json：
 *   [ { "id": "voa-001", "url": "https://learningenglish.voanews.com/a/.../12345.html",
 *       "title": "可留空", "category": "Words and Their Stories" } ]
 *
 * 流程（逐条独立，任何失败都跳过并记录，不阻塞其它条目）：
 *   1. 抓取文章页（网络不可达 / 403 / 404 → skip 记录 reason）
 *   2. 提取 MP3 直链（<audio>/<source> 或页面 .mp3 链接）与正文/transcript
 *   3. 合规过滤：正文/署名命中 AP、Reuters、Music: 等第三方版权特征 → 跳过并记录
 *      （VOA 自有栏目内容为美国联邦政府作品，公共领域 17 U.S.C. §105；
 *        含第三方通稿或背景音乐的素材不集成）
 *   4. 下载音频 → dist/audio/voa/<id>.mp3；文本 → dist/audio/voa/<id>.txt（原文不改）
 *   5. music-metadata 读时长 → 生成 dist/audio/voa/manifest.json
 *
 * 硬约束：
 *   - 不修改、不剪辑 VOA 音频；source/sourceUrl/license 如实标注，不伪造出处
 *   - 不集成 BBC Learning English（其条款禁止通过其他网站传播）
 *   - 音频不进 git（dist/ 已忽略），运行时按需 fetch + Service Worker /audio/* 缓存
 *
 * 当前环境若无法访问 learningenglish.voanews.com，脚本会逐条记录
 * "network-unreachable" 并干净退出（exit 0，无下载失败），不产生任何伪造数据。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFile } from 'music-metadata';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEEDS_PATH = join(root, 'scripts', 'voa-seeds.json');
const OUT_DIR = join(root, 'dist', 'audio', 'voa');
const MANIFEST_PATH = join(OUT_DIR, 'manifest.json');
const SCHEMA = 'qingci-audio-voa/1';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
/** 第三方版权特征：命中即跳过该素材 */
const THIRD_PARTY = [
  /\bAssociated Press\b/, /\bAP News\b/, /\bReuters\b/, /\bAFP\b/,
  /\bMusic:\s/i, /\bbackground music\b/i, /\bvia Getty\b/i,
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) return { fail: `HTTP ${res.status}` };
    return { text: await res.text() };
  } catch (e) {
    return { fail: e && e.name === 'AbortError' ? 'timeout' : `network-unreachable: ${String(e.message || e)}` };
  } finally {
    clearTimeout(t);
  }
}

async function downloadFile(url, dest) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 60000);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) return { fail: `HTTP ${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(dest, buf);
    return { bytes: buf.length };
  } catch (e) {
    return { fail: e && e.name === 'AbortError' ? 'timeout' : `network-unreachable: ${String(e.message || e)}` };
  } finally {
    clearTimeout(t);
  }
}

/** 从页面提取 MP3 直链（audio/source 标签优先，其次正文 .mp3） */
function extractAudioUrl(html, pageUrl) {
  const candidates = [];
  const re = /<(?:audio|source)[^>]*src\s*=\s*["']([^"']+\.mp3[^"']*)["']/gi;
  let m;
  while ((m = re.exec(html))) candidates.push(m[1]);
  const re2 = /https?:\/\/[^\s"'<>]+\.mp3[^\s"'<>]*/gi;
  while ((m = re2.exec(html))) candidates.push(m[0]);
  for (const c of candidates) {
    try {
      const u = new URL(c, pageUrl);
      return u.toString();
    } catch { /* 忽略非法 URL */ }
  }
  return null;
}

/** 提取正文文本：优先 transcript 容器，回退 article 段落（标签剥离） */
function extractText(html) {
  const grab = (re) => {
    const m = html.match(re);
    if (!m) return '';
    return m[1]
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };
  return grab(/<div[^>]*id=["'][^"']*transcript[^"']*["'][\s\S]*?<\/div>([\s\S]*?)<\/div>/i)
    || grab(/<div[^>]*class=["'][^"']*\btranscript\b[^"']*["'][\s\S]*?<\/div>([\s\S]*?)<\/div>/i)
    || grab(/<article[\s\S]*?>([\s\S]*?)<\/article>/i)
    || '';
}

function extractTitle(html, fallback) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const t = m ? m[1].replace(/\s+/g, ' ').trim() : '';
  return fallback && fallback !== '手动填写或留空（留空则从页面 <title> 提取）' ? fallback : (t || fallback || '');
}

async function durationOf(file) {
  try {
    const meta = await parseFile(file);
    return Math.round((meta.format.duration || 0) * 10) / 10;
  } catch {
    return 0;
  }
}

async function main() {
  if (!existsSync(SEEDS_PATH)) {
    console.error('❌ 缺少 scripts/voa-seeds.json（可从 voa-seeds.template.json 复制后填写 URL）');
    process.exit(1);
  }
  const seeds = JSON.parse(readFileSync(SEEDS_PATH, 'utf8'));
  if (!Array.isArray(seeds) || seeds.length === 0) {
    console.log('ℹ️  种子清单为空（本轮交付骨架，不下载任何素材）。');
    console.log('   请先按 docs/VOA素材筛选指南.md 填写 scripts/voa-seeds.json，再运行 npm run fetch:voa');
    console.log('   输出：dist/audio/voa/manifest.json 将随下载自动生成（source=VOA Learning English, license=Public Domain）');
    return;
  }
  mkdirSync(OUT_DIR, { recursive: true });
  let manifest = { schema: SCHEMA, source: 'VOA Learning English', entries: {} };
  if (existsSync(MANIFEST_PATH)) {
    try { manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) || manifest; } catch { /* 重建 */ }
  }

  const report = { downloaded: [], skipped: [], failed: [] };
  for (const seed of seeds) {
    const id = String(seed.id || '').trim();
    if (!id || !seed.url) {
      report.skipped.push({ id: id || '(no-id)', reason: 'invalid-seed（缺 id 或 url）' });
      continue;
    }
    if (manifest.entries[id] && existsSync(join(OUT_DIR, `${id}.mp3`))) {
      report.downloaded.push(id);
      continue; // 已有 → 增量跳过
    }
    const page = await fetchText(seed.url);
    if (page.fail) {
      report.failed.push({ id, url: seed.url, reason: page.fail });
      continue;
    }
    const audioUrl = extractAudioUrl(page.text, seed.url);
    if (!audioUrl) {
      report.skipped.push({ id, reason: 'no-mp3-link（页面未找到 MP3 直链）' });
      continue;
    }
    const text = extractText(page.text);
    // 合规过滤：第三方通稿 / 背景音乐 → 跳过（不下载、不集成）
    const hit = THIRD_PARTY.find((re) => re.test(text));
    if (hit) {
      report.skipped.push({ id, reason: `third-party-copyright（命中 ${hit}）` });
      continue;
    }
    const dl = await downloadFile(audioUrl, join(OUT_DIR, `${id}.mp3`));
    if (dl.fail) {
      report.failed.push({ id, url: audioUrl, reason: dl.fail });
      continue;
    }
    if (text) writeFileSync(join(OUT_DIR, `${id}.txt`), text, 'utf8');
    manifest.entries[id] = {
      id,
      title: extractTitle(page.text, seed.title),
      category: seed.category || '',
      source: 'VOA Learning English',
      sourceUrl: seed.url,
      audioFile: `${id}.mp3`,
      transcriptFile: text ? `${id}.txt` : '',
      duration: await durationOf(join(OUT_DIR, `${id}.mp3`)),
      bytes: statSync(join(OUT_DIR, `${id}.mp3`)).size,
      license: 'Public Domain',
      fetchedAt: new Date().toISOString(),
    };
    report.downloaded.push(id);
    await sleep(500); // 对 VOA 站点保持克制的请求节奏
  }

  manifest.count = Object.keys(manifest.entries).length;
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest), 'utf8');

  console.log('');
  console.log(`✅ VOA 抓取完成：下载 ${report.downloaded.length} · 合规跳过 ${report.skipped.length} · 失败 ${report.failed.length}`);
  report.skipped.forEach((s) => console.log(`   ⏭ ${s.id}: ${s.reason}`));
  report.failed.forEach((f) => console.log(`   ✗ ${f.id}: ${f.reason}`));
  console.log('   清单 → dist/audio/voa/manifest.json（source/sourceUrl/license 如实标注）');
}

main().catch((e) => {
  console.error('❌ 抓取中断：', e);
  process.exit(1);
});
