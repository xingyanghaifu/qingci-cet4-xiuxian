#!/usr/bin/env node
/**
 * 词汇分级生成器（P1 任务 A）→ src/data/vocab-grades.json
 *
 * 分级依据（**可插拔**）：
 *   1. 若提供 `--frequency <文件>`（每行一个词，按词频降序），直接按排名百分位分档 —— 推荐生产使用；
 *   2. 否则使用启发式信号（离线可算、可复现、可解释）：
 *        · seed   ：是否出现在六套卷的命题材料中（考试面向度）
 *        · len    ：词长（越短通常越高频）
 *        · affix  ：拉丁词缀数量（-tion/-ity/-ous/-ment… 越多越偏认知/低频）
 *        · gloss  ：中文释义长度（基础词释义通常更短）
 *      再按**百分位**分档，保证四档分布稳定，不受打分尺度影响。
 *
 * ⚠️ 诚实说明：启发式分级不等于真实语料词频。产物里会写明 `source`，
 *    接入真实词频表只需重跑：`node scripts/build-vocab-grades.mjs --frequency freq.txt`。
 *
 * 用法：
 *   node scripts/build-vocab-grades.mjs [--frequency freq.txt] [--out src/data/vocab-grades.json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TEMPLATE = path.join(ROOT, 'src', 'index.template.html');

/** 四档：高频 / 核心 / 低频 / 认知词 */
export const TIERS = ['high', 'core', 'low', 'recognition'];
export const TIER_LABELS = { high: '高频', core: '核心', low: '低频', recognition: '认知词' };
/** 目标分布（累计百分位边界） */
export const TIER_BOUNDS = [0.15, 0.5, 0.82];

/** 常见拉丁词缀（用于估算构词复杂度） */
export const AFFIXES = [
  'tion', 'sion', 'ation', 'ity', 'ous', 'ious', 'ate', 'ment', 'ness', 'able', 'ible',
  'ance', 'ence', 'ical', 'ize', 'ise', 'fy', 'ive', 'ary', 'ory', 'ism', 'ist', 'ology',
  'pre', 'post', 'dis', 'un', 'in', 'im', 're', 'over', 'under', 'inter', 'trans', 'sub',
  'super', 'anti', 'auto', 'semi', 'ultra', 'uni', 'bi', 'co', 'de', 'ex', 'non', 'pro',
];

function extractJsonScript(html, id) {
  const m = new RegExp(`<script id="${id}" type="application/json">([\\s\\S]*?)</script>`).exec(html);
  if (!m) throw new Error(`模板缺少 <script id="${id}">`);
  return JSON.parse(m[1]);
}

const clamp01 = (n) => Math.max(0, Math.min(1, n));

/** 统计词的首尾词缀命中数（0–2：命中一个前缀 + 一个最长后缀，避免 ation/tion 重复计数） */
export function affixCount(word) {
  const lower = String(word).toLowerCase();
  let count = 0;
  const prefix = AFFIXES.find((a) => lower.startsWith(a) && lower.length > a.length + 2);
  if (prefix) count++;
  const suffix = AFFIXES
    .filter((a) => lower.endsWith(a) && lower.length > a.length + 2)
    .sort((a, b) => b.length - a.length)[0];
  if (suffix) count++;
  return count;
}

/** 启发式「基础度」打分：越高越像高频基础词 */
export function baseScore(entry, seedWords) {
  const word = String(entry.w || '');
  const len = word.length;
  const glossLen = String(entry.short || entry.zh || '').length;
  const lenScore = clamp01((10 - len) / 7);
  const affixScore = 1 - Math.min(1, affixCount(word) / 2);
  const seedScore = seedWords.has(word) ? 1 : 0.55;
  const glossScore = clamp01((5 - glossLen) / 4);
  const score = 0.35 * lenScore + 0.25 * affixScore + 0.25 * seedScore + 0.15 * glossScore;
  return { score: Math.round(score * 1000) / 1000, len, affix: affixCount(word), seed: seedWords.has(word) };
}

/** 按分数百分位分档 */
export function assignTiers(entries) {
  const sorted = entries.slice().sort((a, b) => b.score - a.score || String(a.w).localeCompare(String(b.w)));
  const total = sorted.length;
  const tiers = { high: [], core: [], low: [], recognition: [] };
  sorted.forEach((entry, index) => {
    const p = total <= 1 ? 0 : index / (total - 1);
    const tier = p < TIER_BOUNDS[0] ? 'high' : p < TIER_BOUNDS[1] ? 'core' : p < TIER_BOUNDS[2] ? 'low' : 'recognition';
    tiers[tier].push(entry.w);
  });
  return tiers;
}

/** 用真实词频表分档（词表按词频降序，每行一个词） */
export function assignTiersByFrequency(entries, frequencyWords) {
  const rank = new Map();
  frequencyWords.forEach((w, i) => rank.set(String(w).trim().toLowerCase(), i));
  const known = entries.filter((e) => rank.has(String(e.w).toLowerCase()));
  const tiers = { high: [], core: [], low: [], recognition: [] };
  const total = known.length || 1;
  known
    .slice()
    .sort((a, b) => (rank.get(String(a.w).toLowerCase()) ?? total) - (rank.get(String(b.w).toLowerCase()) ?? total))
    .forEach((entry, index) => {
      const p = total <= 1 ? 0 : index / (total - 1);
      const tier = p < TIER_BOUNDS[0] ? 'high' : p < TIER_BOUNDS[1] ? 'core' : p < TIER_BOUNDS[2] ? 'low' : 'recognition';
      tiers[tier].push(entry.w);
    });
  // 词频表里没有的词，一律归入认知词（保守处理，避免误标为高频）
  for (const entry of entries) {
    if (!rank.has(String(entry.w).toLowerCase())) tiers.recognition.push(entry.w);
  }
  return tiers;
}

/** 生成分级数据 */
export function buildVocabGrades(options = {}) {
  const html = options.html ?? fs.readFileSync(TEMPLATE, 'utf8');
  const lexicon = extractJsonScript(html, 'lexicon');
  const papers = extractJsonScript(html, 'papers');
  const seedWords = new Set(papers.flatMap((p) => p.seeds || []));
  const scored = lexicon.map((entry) => ({ w: entry.w, ...baseScore(entry, seedWords) }));
  const tiers = options.frequencyWords && options.frequencyWords.length
    ? assignTiersByFrequency(scored, options.frequencyWords)
    : assignTiers(scored);

  const counts = Object.fromEntries(TIERS.map((t) => [t, tiers[t].length]));
  return {
    schema: 'qingci-vocab-grades/1',
    source: options.frequencyWords && options.frequencyWords.length ? 'frequency-list' : 'heuristic-v1',
    note: options.frequencyWords && options.frequencyWords.length
      ? '依据外部词频表按排名百分位分档'
      : '启发式分级（词长 / 词缀复杂度 / 是否出现在六套卷材料中 / 释义长度）；不等于真实语料词频',
    policy: {
      high: '基础度前 15%（最短、最少词缀、出现于命题材料）',
      core: '15%–50%',
      low: '50%–82%',
      recognition: '82%–100%（长词、多词缀，建议只求「认得」）',
    },
    upgradeHint: '接入真实词频表：node scripts/build-vocab-grades.mjs --frequency freq.txt',
    counts,
    tiers,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const freqIdx = args.indexOf('--frequency');
  const outIdx = args.indexOf('--out');
  const outPath = outIdx >= 0 ? path.resolve(args[outIdx + 1]) : path.join(ROOT, 'src', 'data', 'vocab-grades.json');
  let frequencyWords = null;
  if (freqIdx >= 0) {
    const file = path.resolve(args[freqIdx + 1]);
    frequencyWords = fs.readFileSync(file, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  }
  const grades = buildVocabGrades({ frequencyWords });
  const text = JSON.stringify(grades) + '\n';
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, text, 'utf8');
  console.log('📊 词汇分级已生成: ' + path.relative(ROOT, outPath));
  console.log('   来源: ' + grades.source);
  console.log('   分布: ' + TIERS.map((t) => `${TIER_LABELS[t]} ${grades.counts[t]}`).join(' · '));
  console.log('   体积: ' + (Buffer.byteLength(text) / 1024).toFixed(1) + ' KB');
}
