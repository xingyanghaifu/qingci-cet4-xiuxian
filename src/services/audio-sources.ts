/**
 * 音频素材源对接（任务 D · 听力精听模块）
 *
 * 两类素材（D1 音频源选择表）：
 *   - 题库听力题 → `audio/tts/<questionId>.mp3`（build:audio 构建期 Edge TTS 生成）
 *   - VOA 精听   → `audio/voa/<id>.mp3`（fetch:voa 抓取；未集成时 manifest 缺失，入口不显示）
 *
 * 链路：内存 known 集 →（未缓存）D3 确认下载 → fetch 下载 →
 *       Cache API（Service Worker /audio/* cache-first 同源缓存）+ IndexedDB datasets 仓
 *       `audio:` 键 → 之后离线直接命中。
 *
 * 与精听播放器的对接点：`prepareTrack(text, question)`（同步）由模板 open() 调用，
 * 返回 `{ text, track }`（真实音频 kind:'file'）或 null（回退语音合成占位）。
 */
import { storeOf, promisify, type MinimalObjectStore } from './idb';
import type { AudioTrackMeta } from '../types/audio';

export interface TtsEntry {
  questionId: string;
  file: string;
  kind?: string;
  voice?: string;
  voiceRole?: string;
  duration?: number;
  textHash?: string;
  bytes?: number;
}
export interface VoaEntry {
  id: string;
  title: string;
  category?: string;
  source: string;
  sourceUrl: string;
  audioFile: string;
  transcriptFile?: string;
  duration?: number;
  license: string;
  fetchedAt?: string;
}
interface TtsManifest { schema: string; count: number; entries: Record<string, TtsEntry> }
interface VoaManifest { schema: string; count: number; source?: string; entries: Record<string, VoaEntry> }

const TTS_MANIFEST_URL = 'audio/tts/manifest.json';
const VOA_MANIFEST_URL = 'audio/voa/manifest.json';
const AUDIO_CACHE = 'qingci-audio-manual';
const IDB_PREFIX = 'audio:';

const known = new Set<string>();
let ttsManifestP: Promise<TtsManifest | null> | null = null;
let voaManifestP: Promise<VoaManifest | null> | null = null;
let pendingVoa: { url: string; text: string; duration: number; title: string } | null = null;

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** 题库 TTS 清单（缺失返回 null：file:// 或尚未执行 build:audio） */
export function loadTtsManifest(): Promise<TtsManifest | null> {
  if (!ttsManifestP) ttsManifestP = fetchJson<TtsManifest>(TTS_MANIFEST_URL);
  return ttsManifestP;
}
/** VOA 清单（未集成素材时缺失 → 入口不显示） */
export function loadVoaManifest(): Promise<VoaManifest | null> {
  if (!voaManifestP) voaManifestP = fetchJson<VoaManifest>(VOA_MANIFEST_URL);
  return voaManifestP;
}

export async function ttsEntryOf(questionId: string): Promise<TtsEntry | null> {
  if (!questionId) return null;
  const m = await loadTtsManifest();
  return (m && m.entries[questionId]) || null;
}
export async function voaList(): Promise<VoaEntry[]> {
  const m = await loadVoaManifest();
  return m && m.entries ? Object.values(m.entries) : [];
}

/** D1：题库听力题 → tts 音频源（同步查内存清单缓存由调用方先 loadTtsManifest 预热） */
let ttsSync: TtsManifest | null = null;
export async function warmTts(): Promise<void> {
  ttsSync = await loadTtsManifest();
}
export function pickTtsSrc(questionId: string): string | null {
  if (!ttsSync || !questionId || !ttsSync.entries[questionId]) return null;
  return `audio/tts/${questionId}.mp3`;
}
export function ttsEntrySync(questionId: string): TtsEntry | null {
  return (ttsSync && ttsSync.entries[questionId]) || null;
}

export function isKnown(src: string): boolean {
  return known.has(src);
}

async function idbStore(mode: 'readonly' | 'readwrite'): Promise<MinimalObjectStore | null> {
  try {
    return await storeOf('datasets', mode);
  } catch {
    return null;
  }
}
async function idbPutAudio(src: string, blob: Blob): Promise<void> {
  try {
    const store = await idbStore('readwrite');
    if (!store) return;
    await promisify<unknown>(store.put({ src, blob, at: Date.now() }, IDB_PREFIX + src));
  } catch {
    /* 缓存失败静默：SW 仍可离线兜底 */
  }
}
export async function isAudioCached(src: string): Promise<boolean> {
  if (known.has(src)) return true;
  try {
    if (typeof caches !== 'undefined') {
      const hit = await caches.match(src);
      if (hit) { known.add(src); return true; }
    }
  } catch { /* 忽略 */ }
  return false;
}

/** 下载并缓存（Cache API + IndexedDB）；成功后进入 known，离线可直接命中 */
export async function downloadAudio(src: string): Promise<boolean> {
  try {
    const res = await fetch(src);
    if (!res.ok) return false;
    const buf = await res.arrayBuffer();
    try {
      if (typeof caches !== 'undefined') {
        const cache = await caches.open(AUDIO_CACHE);
        await cache.put(src, new Response(buf.slice(0), { headers: { 'content-type': 'audio/mpeg' } }));
      }
    } catch { /* Cache 不可用时至少写 IDB */ }
    await idbPutAudio(src, new Blob([buf], { type: 'audio/mpeg' }));
    known.add(src);
    return true;
  } catch {
    return false;
  }
}

function toast(msg: string): void {
  try {
    const w = window as unknown as { toast?: (m: string) => void };
    if (typeof w.toast === 'function') w.toast(msg);
  } catch { /* 忽略 */ }
}

/** 构造真实音频音轨（D2：audioMeta 有逐句时间戳 → 直接使用；无 → 整段，timing=measured 按秒 A-B） */
export function fileTrack(
  url: string,
  text: string,
  duration: number,
  source: 'generated' | 'original' = 'generated',
  segmentsIn?: Array<{ id?: string; start?: number; end?: number; text?: string }>,
): AudioTrackMeta {
  const dur = Number(duration) > 0 ? Number(duration) : 0;
  const hasSegs = Array.isArray(segmentsIn) && segmentsIn.length > 0
    && segmentsIn.every((s) => typeof s?.start === 'number' && typeof s?.end === 'number');
  const segments = hasSegs
    ? segmentsIn.map((s, i) => ({ id: s.id || `seg${i}`, start: Number(s.start), end: Number(s.end), text: s.text || text }))
    : [{ id: 'seg0', start: 0, end: dur, text }];
  return {
    kind: 'file',
    url,
    text,
    lang: 'en-US',
    durationSec: dur || (segments[segments.length - 1]?.end ?? 0),
    segments,
    timing: 'measured',
    transcriptSource: source === 'original' ? 'original-material' : 'generated',
    available: true,
  } as AudioTrackMeta;
}

/**
 * D3 离线/缓存判定 + D1 源选择（同步，供模板 open() 调用）：
 *   1. VOA 待选素材（用户在精听面板选择后）→ file 轨道
 *   2. 题库听力题有 TTS 音频：
 *      - 已缓存（本会话下载过）→ file 轨道，无提示
 *      - 未缓存且离线 → 提示「该音频需要联网下载」→ 回退语音合成
 *      - 未缓存且在线 → 确认「该音频需要联网下载，是否立即下载？」
 *          确认 → 异步下载并缓存（IDB + Cache），立即返回 file 轨道（播放与下载并行）
 *          取消 → 回退语音合成（TTS 占位）
 *   3. 都没有 → null（沿用现有 TTS 占位逻辑，零改动）
 */
export function prepareTrack(
  fallbackText: string,
  question: { id?: string; audioMeta?: { text?: string; segments?: Array<{ id?: string; start?: number; end?: number; text?: string }> } } | null,
): { text: string; track: AudioTrackMeta } | null {
  // 1) VOA 素材
  if (pendingVoa) {
    const v = pendingVoa;
    pendingVoa = null;
    return { text: v.text || v.title, track: fileTrack(v.url, v.text || v.title, v.duration, 'original') };
  }
  // 2) 题库 TTS 真实音频
  const qid = question && question.id ? String(question.id) : '';
  const src = pickTtsSrc(qid);
  if (!src) return null;
  const entry = ttsEntrySync(qid);
  const speechText = (question && question.audioMeta && question.audioMeta.text) || fallbackText;
  const duration = (entry && entry.duration) || 0;
  const segs = (question && question.audioMeta && question.audioMeta.segments) || undefined;
  if (known.has(src)) {
    return { text: speechText, track: fileTrack(src, speechText, duration, 'generated', segs) };
  }
  const online = typeof navigator === 'undefined' || navigator.onLine !== false;
  if (!online) {
    toast('该音频需要联网下载（当前离线，已回退语音合成）');
    return null;
  }
  // 站内弹层是异步的，而 prepareTrack 的调用方（模板 open()）同步读 via.text，
  // 所以这里**不能 await**：改成「先按同意路径继续起播，确认弹层在后台问」。
  // 用户若点了取消，已开始的下载会自行结束（只是白下一个文件），播放不受影响 ——
  // 这比把整个 prepareTrack 改成 async 更安全：改 async 会让 via 变成 Promise，
  // via.text 恒为 undefined，真实音频路径会静默失效。
  void confirmDownload().then((ok) => {
    if (!ok) { toast('已取消下载，继续使用语音合成'); return; }
    void downloadAudio(src).then((done) => {
      if (done) toast('音频已下载并缓存，离线可用');
      else toast('音频下载失败，已回退语音合成');
    });
  });
  return { text: speechText, track: fileTrack(src, speechText, duration, 'generated', segs) };
}

/**
 * 「是否立即下载音频」确认。
 * 原先用原生 window.confirm —— 样式不可控、读屏在部分环境读不到，
 * 且移动端 WebView 常把它直接忽略（等于默认同意下载流量）。
 * 现改走页面注册的 window.askConfirm（站内弹层，与其余确认一致）。
 * 服务层不自己建 DOM：注册方在模板的模态层公共设施里，缺失时降级为同意。
 */
async function confirmDownload(): Promise<boolean> {
  if (typeof window === 'undefined') return true;
  const ask = (window as unknown as { askConfirm?: (t: string, o?: { title?: string }) => Promise<boolean> }).askConfirm;
  if (typeof ask !== 'function') {
    return typeof window.confirm !== 'function'
      ? true
      : window.confirm('该音频需要联网下载，是否立即下载？');
  }
  return ask('该音频需要联网下载，是否立即下载？', { title: '下载音频' });
}

/** VOA 素材入选精听（由界面在取到 transcript 后调用，随后模拟打开精听面板） */
export function armVoa(entry: VoaEntry, transcript: string): void {
  pendingVoa = {
    url: `audio/voa/${entry.audioFile}`,
    text: transcript || entry.title,
    duration: entry.duration || 0,
    title: entry.title,
  };
}

/**
 * 播放单个音频源（供 audioDock「真实音频」按钮使用）：
 * 与 prepareTrack 相同的 D3 判定，成功返回可播放的 URL（或直接起播）。
 */
export async function playReal(src: string, rate = 1): Promise<'playing' | 'cancelled' | 'offline' | 'failed'> {
  if (!(await isAudioCached(src))) {
    const online = typeof navigator === 'undefined' || navigator.onLine !== false;
    if (!online) { toast('该音频需要联网下载（当前离线）'); return 'offline'; }
    const ok = await confirmDownload();
    if (!ok) return 'cancelled';
    const done = await downloadAudio(src);
    if (!done) { toast('音频下载失败'); return 'failed'; }
  }
  try {
    const audio = new Audio(src);
    audio.preservesPitch = true;
    audio.playbackRate = rate;
    await audio.play();
    return 'playing';
  } catch {
    toast('音频播放失败');
    return 'failed';
  }
}

/** 仅测试用：清空模块缓存 */
export function __resetAudioSources(): void {
  known.clear();
  ttsManifestP = null;
  voaManifestP = null;
  ttsSync = null;
  pendingVoa = null;
}
