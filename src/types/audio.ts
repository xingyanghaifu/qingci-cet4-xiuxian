/**
 * 听力精听的音频元数据与文本工具（P1 任务 D）
 *
 * `audioMeta` 的时间戳结构是精听的地基：逐句复读、A-B 循环、听写填空都依赖它。
 * 目前没有真实音频素材，因此：
 *   - `kind: 'tts'`（占位）：用 SpeechSynthesis 按句朗读，时间轴按字符数**估算**；
 *   - `kind: 'file'`（将来）：`url` + 真实时间戳，`start/end` 即音频秒数，无需改动 UI。
 *
 * 时间单位统一为**秒**；segment 的 `start/end` 在半开区间 [start, end) 内有效。
 */

export interface AudioSegment {
  /** 句 id（同一音轨内唯一，默认按序号生成） */
  id: string;
  /** 起始秒 */
  start: number;
  /** 结束秒 */
  end: number;
  /** 英文原文 */
  text: string;
  /** 中文参考（可选，原创材料里没有时留空） */
  translation?: string;
  /** 语音现象等标签（连读 / 弱读 / 失爆 / 数字…） */
  tags?: string[];
}

export interface AudioTrackMeta {
  kind: 'tts' | 'file';
  /** kind='file' 时的音频地址 */
  url?: string;
  /** kind='tts' 时的朗读文本（等于各句拼接） */
  text?: string;
  lang: string;
  /** 音频总时长（TTS 时为估算值） */
  durationSec: number;
  segments: AudioSegment[];
  /** 时间戳来源：真实音频切分 / 按文本估算 */
  timing: 'measured' | 'estimated';
  /** 文本来源（原创材料 / 自动生成） */
  transcriptSource: 'original-material' | 'generated';
  /** 是否可用（无文本且无 url 时为 false） */
  available: boolean;
}

export const SPEED_OPTIONS = [0.5, 0.75, 0.9, 1, 1.25, 1.5, 2] as const;
export const MIN_RATE = 0.5;
export const MAX_RATE = 2;

/** 估算朗读时长：按字符数折算（英文约 14 字符/秒，再按语速缩放） */
export const CHARS_PER_SECOND = 14;

export function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return 0.9;
  return Math.max(MIN_RATE, Math.min(MAX_RATE, Math.round(rate * 100) / 100));
}

/** 断句：先按句末标点切，再兜底按长度切 */
export function splitSentences(text: string, maxChars = 220): string[] {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  const rough = normalized.match(/[^.!?;]+[.!?;]+["')\]]*|[^.!?;]+$/g) || [normalized];
  const out: string[] = [];
  for (const piece of rough) {
    const sentence = piece.trim();
    if (!sentence) continue;
    if (sentence.length <= maxChars) {
      out.push(sentence);
      continue;
    }
    // 过长句子按逗号再切
    let buffer = '';
    for (const chunk of sentence.split(/(?<=,)\s+/)) {
      if ((buffer + ' ' + chunk).trim().length > maxChars && buffer) {
        out.push(buffer.trim());
        buffer = chunk;
      } else {
        buffer = (buffer + ' ' + chunk).trim();
      }
    }
    if (buffer.trim()) out.push(buffer.trim());
  }
  return out;
}

/**
 * 由纯文本构造音轨（无真实时间戳时使用）
 * @param rate 估算用的语速（默认 0.9 与播放器默认一致）
 */
export function buildTrackFromText(
  text: string,
  options: { lang?: string; rate?: number; translation?: string; transcriptSource?: AudioTrackMeta['transcriptSource'] } = {},
): AudioTrackMeta {
  const rate = clampRate(options.rate ?? 0.9);
  const sentences = splitSentences(text);
  let cursor = 0;
  const segments: AudioSegment[] = sentences.map((sentence, index) => {
    const seconds = estimateSeconds(sentence, rate);
    const segment: AudioSegment = {
      id: `s${index + 1}`,
      start: Math.round(cursor * 1000) / 1000,
      end: Math.round((cursor + seconds) * 1000) / 1000,
      text: sentence,
      ...(options.translation ? { translation: options.translation } : {}),
    };
    cursor += seconds;
    return segment;
  });
  return {
    kind: 'tts',
    text: sentences.join(' '),
    lang: options.lang || 'en-US',
    durationSec: Math.round(cursor * 1000) / 1000,
    segments,
    timing: 'estimated',
    transcriptSource: options.transcriptSource || 'original-material',
    available: segments.length > 0,
  };
}

/** 估算一句话的朗读秒数 */
export function estimateSeconds(sentence: string, rate = 0.9): number {
  const chars = String(sentence || '').replace(/\s+/g, ' ').trim().length;
  const words = String(sentence || '').trim().split(/\s+/).filter(Boolean).length;
  // 取「按字符」与「按词（含停顿）」的较大值，避免短句估得过短
  const byChars = chars / (CHARS_PER_SECOND * clampRate(rate));
  const byWords = (words / 2.6) / clampRate(rate);
  return Math.max(0.6, Math.round(Math.max(byChars, byWords) * 100) / 100);
}

/** 规范化来自题库/页面元素的 audioMeta（结构不符时返回 null） */
export function normalizeAudioMeta(raw: unknown): AudioTrackMeta | null {
  if (!raw || typeof raw !== 'object') return null;
  const meta = raw as Partial<AudioTrackMeta> & { segments?: unknown };
  const segments = Array.isArray(meta.segments)
    ? meta.segments
      .filter((s): s is AudioSegment => !!s && typeof (s as AudioSegment).text === 'string')
      .map((s, i) => ({
        id: typeof s.id === 'string' && s.id ? s.id : `s${i + 1}`,
        start: Number.isFinite(s.start) ? Number(s.start) : 0,
        end: Number.isFinite(s.end) ? Number(s.end) : 0,
        text: String(s.text),
        ...(s.translation ? { translation: String(s.translation) } : {}),
        ...(Array.isArray(s.tags) ? { tags: s.tags.map(String) } : {}),
      }))
    : [];

  // 只有 url/文本、没有逐句时间戳时：按文本估算时间轴，但**必须保留真实的 kind 与 url**，
  // 否则「已有 mp3、暂时还没有逐句时间戳」的音轨会被误判成 TTS 占位（真实音频被丢弃）
  if (!segments.length) {
    if (typeof meta.text === 'string' && meta.text.trim()) {
      const built = buildTrackFromText(meta.text, { lang: meta.lang });
      return {
        ...built,
        kind: meta.kind === 'file' ? 'file' : 'tts',
        ...(meta.url ? { url: String(meta.url) } : {}),
        // 时间轴仍是估算的，等音频切分完成后再标 measured
        timing: 'estimated',
      };
    }
    // 无文本 → 无法做逐句精听
    return null;
  }

  const durationSec = Number.isFinite(meta.durationSec) && (meta.durationSec as number) > 0
    ? Number(meta.durationSec)
    : segments[segments.length - 1].end;

  return {
    kind: meta.kind === 'file' ? 'file' : 'tts',
    ...(meta.url ? { url: String(meta.url) } : {}),
    ...(meta.text ? { text: String(meta.text) } : {}),
    lang: meta.lang || 'en-US',
    durationSec,
    segments,
    timing: meta.timing === 'measured' ? 'measured' : 'estimated',
    transcriptSource: meta.transcriptSource === 'generated' ? 'generated' : 'original-material',
    available: true,
  };
}

/** 找到某一时刻所在的句子 */
export function segmentAt(track: AudioTrackMeta, timeSec: number): AudioSegment | null {
  if (!track.segments.length) return null;
  const t = Math.max(0, timeSec);
  for (const segment of track.segments) {
    if (t >= segment.start && t < segment.end) return segment;
  }
  return t >= track.segments[track.segments.length - 1].end ? track.segments[track.segments.length - 1] : track.segments[0];
}

/** 按 id 取句子下标（找不到返回 -1） */
export function indexOfSegment(track: AudioTrackMeta, id: string): number {
  return track.segments.findIndex((s) => s.id === id);
}

/** 取某句的相邻句（越界返回 null） */
export function neighborSegment(track: AudioTrackMeta, index: number, delta: number): AudioSegment | null {
  const next = index + delta;
  if (next < 0 || next >= track.segments.length) return null;
  return track.segments[next];
}

/** 规范化 A-B 区间：保证 a ≤ b 且在合法范围内 */
export function clampAbRange(a: number, b: number, length: number): { a: number; b: number } {
  const lo = Math.max(0, Math.min(length - 1, Math.min(a, b)));
  const hi = Math.max(0, Math.min(length - 1, Math.max(a, b)));
  return { a: lo, b: hi };
}

export interface DictationWordResult {
  word: string;
  ok: boolean;
}

export interface DictationResult {
  correct: boolean;
  /** 匹配率 0–1 */
  ratio: number;
  words: DictationWordResult[];
  /** 漏写的词 */
  missing: string[];
  /** 多写的词 */
  extra: string[];
}

/** 规范化听写输入：小写、去标点、压缩空白 */
export function normalizeForDictation(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 逐词比对听写结果（按顺序贪心匹配，能容忍漏词/多词）
 */
export function checkDictation(expected: string, input: string): DictationResult {
  const expectedWords = normalizeForDictation(expected).split(' ').filter(Boolean);
  const inputWords = normalizeForDictation(input).split(' ').filter(Boolean);
  const words: DictationWordResult[] = [];
  const missing: string[] = [];
  const extra: string[] = [];

  let cursor = 0;
  for (const word of expectedWords) {
    const hit = inputWords.indexOf(word, cursor);
    if (hit >= 0) {
      words.push({ word, ok: true });
      // 中间被跳过的输入词记为多写
      for (let i = cursor; i < hit; i++) extra.push(inputWords[i]);
      cursor = hit + 1;
    } else {
      words.push({ word, ok: false });
      missing.push(word);
    }
  }
  for (let i = cursor; i < inputWords.length; i++) extra.push(inputWords[i]);

  const hitCount = words.filter((w) => w.ok).length;
  const ratio = expectedWords.length ? hitCount / expectedWords.length : 0;
  return { correct: missing.length === 0 && extra.length === 0, ratio: Math.round(ratio * 100) / 100, words, missing, extra };
}

/** 精听界面用的一句话摘要 */
export function describeSegment(segment: AudioSegment, index: number, total: number): string {
  const start = segment.start.toFixed(1);
  const end = segment.end.toFixed(1);
  return `第 ${index + 1}/${total} 句 · ${start}s–${end}s · ${segment.text.length} 字符`;
}
