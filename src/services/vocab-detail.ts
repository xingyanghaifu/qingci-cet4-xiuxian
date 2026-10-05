/**
 * 单词详情服务（任务 D1 / D3 / D4）
 *
 * 数据链路（离线优先，逐级回退）：
 *   1. 内存（本次会话已取过的分片与条目）
 *   2. 本地分片  vocab-detail/<shard>.json —— 构建产出、按需 fetch，
 *      Service Worker 对同源静态资源做 stale-while-revalidate，看过一次即离线可用
 *   3. IndexedDB —— 复用无 schema 的 datasets 仓库，键前缀 `vocabdetail:`
 *      （Free Dictionary API 的联网结果也缓存在这里，避免重复请求）
 *   4. Free Dictionary API（联网回退，无 Key、无速率限制）
 *   5. 全部失败 → 返回 null，由界面提示「离线模式下暂无详情」
 *
 * file:// 双击打开时 fetch 分片必然失败，直接走 3→5，不会抛错。
 */
import { storeOf, promisify, type MinimalObjectStore } from './idb';
import { currentLexiconId } from './lexicon';

/* ---------- D3 数据模型 ---------- */
export interface VocabDefinition {
  english: string;
  chinese: string;
  example?: string;
  exampleSource?: string;
}
export interface VocabMeaning {
  partOfSpeech: string;
  definitions: VocabDefinition[];
}
export interface VocabExample {
  sentence: string;
  translation: string;
  source: string;
}

/**
 * 记忆锚点（v1.8.2 阶段 B）
 *
 * 全部由 `scripts/build-mnemonics.mjs` 从语料原文归一化而来，
 * **不生成、不改写、不臆造** —— 每一条都能在语料 JSON 里找到出处。
 */
export interface VocabMnemonic {
  /** 主助记（谐音 / 拆词 / 典故等） */
  device?: string;
  /** 视觉联想画面 */
  scene?: string;
  /** 联想词 */
  assoc?: string[];
  /** 词根词缀锚点（比整段词源更适合做记忆支点） */
  root?: string;
  /** 学习提示 */
  tip?: string;
  /** 易混点：常见错法 → 正确法 */
  confusable?: { wrong: string; right: string; note?: string }[];
  /** 锚点强度：full = 有装置或画面；basic = 只有词根/提示；none = 无（不写此字段） */
  tier: 'full' | 'basic' | 'none';
}

export interface VocabDetail {
  word: string;
  phonetic: { british?: string; american?: string };
  audioUrl?: { british?: string; american?: string };
  meanings: VocabMeaning[];
  collocations: string[];
  phrases: string[];
  synonyms: string[];
  antonyms: string[];
  etymology?: string;
  memoryAid?: string;
  /** 记忆锚点（v1.8.2 阶段 B）——结构化版本，UI 优先用它，回落到 memoryAid */
  mnemonics?: VocabMnemonic;
  confusionWords?: string[];
  /** 用法场景（语料领域 / 语域）——D3 模型的可选扩展 */
  usage?: string;
  /** 形态变化（过去式/分词/复数） */
  forms?: string;
  /** 例句（含出处；MIT 语料无 CET-4 真题标注，按语料自带 source 如实呈现） */
  examples?: VocabExample[];
  /** true = 仅由词库自带释义生成的兜底条目 */
  offline?: boolean;
  /** 数据来源标记：corpus / ecdict / lexicon / api */
  __src?: string;
}
export interface VocabDetailResult {
  detail: VocabDetail;
  source: 'local' | 'cache' | 'api';
}

/* ---------- 常量 ---------- */
export const VOCAB_DETAIL_BASE = 'vocab-detail/';
export const VOCAB_DETAIL_SCHEMA = 'qingci-vocab-detail/1';
export const FREE_DICT_API = 'https://api.dictionaryapi.dev/api/v2/entries/en/';
export const VOCAB_DETAIL_CACHE_KEY = 'vocabdetail:';

/**
 * 各词库的详情分片目录（v1.8.2 多词库）。
 *
 * CET-4 保持**原路径** `vocab-detail/`（兼容策略：现有分片不搬动），
 * 其余词库走 `lexicons/<id>/vocab-detail/`。
 * 传入未知词库时回落到 CET-4 —— 宁可显示四级的详情，也不要让详情面板空白。
 */
export const VOCAB_DETAIL_BASES: Readonly<Record<string, string>> = {
  cet4: 'vocab-detail/',
  cet6: 'lexicons/cet6/vocab-detail/',
  junior: 'lexicons/junior/vocab-detail/', // v1.9.0 阶段 A：初中（中考）
  senior: 'lexicons/senior/vocab-detail/', // v1.9.0 阶段 B：高中（高考）
  kaoyan: 'lexicons/kaoyan/vocab-detail/', // v1.9.1 阶段 E：考研
};

/** 词库 → 详情分片目录（归一化；未知/缺省回落到 cet4） */
export function baseOf(lexiconId?: string | null): string {
  const id = String(lexiconId == null ? '' : lexiconId).trim();
  return VOCAB_DETAIL_BASES[id] || VOCAB_DETAIL_BASE;
}

interface Manifest {
  schema: string;
  count: number;
  /** 运行时用：按最长前缀匹配（生成器已排为长前缀在前） */
  prefixes: string[];
  files: Record<string, string>;
}

/* ---------- 模块级缓存 ---------- */
/**
 * 清单与分片缓存按词库分桶（v1.8.2 多词库）。
 *
 * 为什么不加词库前缀：详情是**可再生的只读数据**，同一单词在 CET-4/CET-6
 * 的释义完全一致，重复缓存只会白占 IndexedDB 配额。真正需要隔离的是
 * 进度 / 错题 / SRS（见 lexicon-scope.ts），详情缓存不属于隔离范畴。
 */
const manifestPromises = new Map<string, Promise<Manifest | null>>();
const shardCaches = new Map<string, Map<string, Record<string, VocabDetail>>>();
const detailCache = new Map<string, VocabDetail>();

function manifestFor(lexiconId?: string | null): Promise<Manifest | null> {
  const key = baseOf(lexiconId);
  let p = manifestPromises.get(key);
  if (!p) {
    p = (async () => {
      try {
        const res = await fetch(key + 'manifest.json', { cache: 'no-cache' });
        if (!res.ok) return null;
        const data = (await res.json()) as Manifest;
        if (!data || !Array.isArray(data.prefixes) || !data.files) return null;
        return data;
      } catch {
        return null;
      }
    })();
    manifestPromises.set(key, p);
  }
  return p;
}

async function idbStore(mode: 'readonly' | 'readwrite'): Promise<MinimalObjectStore | null> {
  try {
    return await storeOf('datasets', mode);
  } catch {
    return null;
  }
}

async function idbGet(key: string): Promise<VocabDetail | null> {
  try {
    const store = await idbStore('readonly');
    if (!store) return null;
    const value = await promisify<unknown>(store.get(key));
    const detail = value as VocabDetail | undefined;
    return detail && typeof detail === 'object' && detail.word ? detail : null;
  } catch {
    return null;
  }
}

async function idbPut(key: string, detail: VocabDetail): Promise<void> {
  try {
    const store = await idbStore('readwrite');
    if (!store) return;
    await promisify<unknown>(store.put(detail, key));
  } catch {
    /* 缓存失败静默：不影响详情展示 */
  }
}

/** 分片清单（按词库分桶；失败返回 null：file:// 或未部署分片时安全降级） */
function loadManifest(lexiconId?: string | null): Promise<Manifest | null> {
  return manifestFor(lexiconId);
}

/** 最长前缀匹配：manifest.prefixes 已按长度降序 */
function prefixFor(manifest: Manifest, word: string): string {
  const w = word.toLowerCase();
  for (const p of manifest.prefixes) {
    if (w.startsWith(p)) return p;
  }
  return '';
}

/** 取本地分片（内存 → 网络/SW 缓存）；缓存按词库分桶 */
async function loadShard(manifest: Manifest, word: string, lexiconId?: string | null): Promise<Record<string, VocabDetail> | null> {
  const prefix = prefixFor(manifest, word);
  if (!prefix) return null;
  const file = manifest.files[prefix];
  if (!file) return null;
  const base = baseOf(lexiconId);
  let bucket = shardCaches.get(base);
  if (!bucket) {
    bucket = new Map();
    shardCaches.set(base, bucket);
  }
  if (bucket.has(prefix)) return bucket.get(prefix) || null;
  try {
    const res = await fetch(base + file);
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, VocabDetail>;
    bucket.set(prefix, data);
    return data;
  } catch {
    return null;
  }
}

/* ---------- Free Dictionary API 归一化（联网回退） ---------- */
/* eslint-disable @typescript-eslint/no-explicit-any */
function normalizeApiEntry(word: string, entry: any): VocabDetail | null {
  if (!entry || !Array.isArray(entry.meanings)) return null;
  const detail: VocabDetail = {
    word: entry.word || word,
    phonetic: {},
    meanings: [],
    collocations: [],
    phrases: [],
    synonyms: [],
    antonyms: [],
    examples: [],
    __src: 'api',
  };
  if (entry.phonetic) detail.phonetic.british = String(entry.phonetic);
  const phonetics = Array.isArray(entry.phonetics) ? entry.phonetics : [];
  for (const p of phonetics) {
    if (!p) continue;
    if (p.text && !detail.phonetic.british) detail.phonetic.british = String(p.text);
    if (p.audio) {
      detail.audioUrl = detail.audioUrl || {};
      const isUk = /uk/i.test(String(p.audio));
      if (isUk && !detail.audioUrl.british) detail.audioUrl.british = String(p.audio);
      if (!isUk && !detail.audioUrl.american) detail.audioUrl.american = String(p.audio);
      if (!detail.audioUrl.british && !detail.audioUrl.american) detail.audioUrl.british = String(p.audio);
    }
  }
  const syn = new Set<string>();
  const ant = new Set<string>();
  for (const m of entry.meanings.slice(0, 5)) {
    if (!m || !Array.isArray(m.definitions)) continue;
    const group: VocabMeaning = { partOfSpeech: String(m.partOfSpeech || ''), definitions: [] };
    for (const def of m.definitions.slice(0, 4)) {
      if (!def || !def.definition) continue;
      const item: VocabDefinition = { english: String(def.definition), chinese: '' };
      if (def.example) {
        item.example = String(def.example);
        item.exampleSource = 'Free Dictionary';
      }
      group.definitions.push(item);
      if (Array.isArray(def.synonyms)) def.synonyms.slice(0, 4).forEach((s: string) => syn.add(String(s)));
      if (Array.isArray(def.antonyms)) def.antonyms.slice(0, 3).forEach((s: string) => ant.add(String(s)));
    }
    if (group.definitions.length) detail.meanings.push(group);
    if (Array.isArray(m.synonyms)) m.synonyms.slice(0, 6).forEach((s: string) => syn.add(String(s)));
    if (Array.isArray(m.antonyms)) m.antonyms.slice(0, 4).forEach((s: string) => ant.add(String(s)));
  }
  detail.synonyms = Array.from(syn).slice(0, 8);
  detail.antonyms = Array.from(ant).slice(0, 6);
  return detail.meanings.length || detail.phonetic.british ? detail : null;
}

async function fetchApiDetail(word: string): Promise<VocabDetail | null> {
  try {
    const res = await fetch(FREE_DICT_API + encodeURIComponent(word), { cache: 'force-cache' });
    if (!res.ok) return null;
    const data = (await res.json()) as any[];
    if (!Array.isArray(data) || !data.length) return null;
    const detail = normalizeApiEntry(word, data[0]);
    if (detail) await idbPut(VOCAB_DETAIL_CACHE_KEY + word.toLowerCase(), detail);
    return detail;
  } catch {
    return null;
  }
}

/* ---------- 对外接口 ---------- */

/**
 * 取单词详情（离线优先）。
 * @param word     单词
 * @param lexiconId 词库 id（决定加载哪套分片；缺省按当前词库，再缺省回落到 CET-4）
 * @returns null 表示本地与联网均无详情（界面提示离线兜底文案）
 */
export async function getVocabDetail(word: string, lexiconId?: string | null): Promise<VocabDetailResult | null> {
  const key = String(word || '').trim().toLowerCase();
  if (!key) return null;
  const lx = lexiconId ?? currentLexiconId();

  // 内存缓存也按词库分桶：同一单词在四级/六级下应读各自的分片
  const mem = detailCache.get(lx + '' + key);
  if (mem) return { detail: mem, source: 'local' };

  // 1) 本地分片（构建产出，按词库白名单）
  const manifest = await loadManifest(lx);
  if (manifest) {
    const shard = await loadShard(manifest, key, lx);
    const hit = shard && (shard[key] || shard[String(word).trim()]);
    if (hit && hit.word) {
      detailCache.set(lx + '' + key, hit);
      void idbPut(VOCAB_DETAIL_CACHE_KEY + key, hit);
      return { detail: hit, source: 'local' };
    }
  }

  // 2) IndexedDB 缓存（含 API 联网结果）
  const cached = await idbGet(VOCAB_DETAIL_CACHE_KEY + key);
  if (cached) {
    detailCache.set(lx + '' + key, cached);
    return { detail: cached, source: 'cache' };
  }

  // 3) 联网回退：Free Dictionary API（结果写回 IDB，下次离线可用）
  const online = typeof navigator !== 'undefined' && navigator.onLine !== false;
  if (online) {
    const api = await fetchApiDetail(word);
    if (api) {
      detailCache.set(lx + '' + key, api);
      return { detail: api, source: 'api' };
    }
  }
  return null;
}

/** TTS 发音：优先浏览器语音合成（离线可用），英式优先、美式次之 */
export function speakWord(word: string, prefer: 'british' | 'american' = 'british'): boolean {
  try {
    if (typeof speechSynthesis === 'undefined' || !word) return false;
    speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(word);
    utter.lang = prefer === 'british' ? 'en-GB' : 'en-US';
    const voices = speechSynthesis.getVoices ? speechSynthesis.getVoices() : [];
    const exact = voices.find((v) => v.lang === utter.lang);
    const loose = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith('en'));
    if (exact || loose) utter.voice = (exact || loose) as SpeechSynthesisVoice;
    utter.rate = 0.9;
    speechSynthesis.speak(utter);
    return true;
  } catch {
    return false;
  }
}

/** 仅测试/诊断用：清空模块级缓存 */
export function __resetVocabDetailCache(): void {
  manifestPromises.clear();
  shardCaches.clear();
  detailCache.clear();
}
