/**
 * 音频提供方与精听播放器（P1 任务 D）
 *
 * 两层结构：
 *   1. **AudioProvider**：把「怎么发声」抽象掉。当前有 TTS 提供方（SpeechSynthesis 占位），
 *      将来接真实音频只需新增 `createElementProvider`（<audio> + preservesPitch），
 *      精听 UI 与播放逻辑完全不用改。
 *   2. **IntensivePlayer**：把「怎么练」抽象出来——逐句复读、A-B 循环、变速、原文开关、听写。
 *
 * 诚实说明：TTS 模式没有真实时间轴，A-B 循环按「句」界定（不是按秒）；
 * 接入真实音频后 `timing: 'measured'` 即可按秒精确循环。
 */
import {
  clampAbRange,
  clampRate,
  checkDictation,
  type AudioSegment,
  type AudioTrackMeta,
  type DictationResult,
} from '../types/audio';

export type PlayerState = 'idle' | 'playing' | 'paused';

export interface AudioHandle {
  /** 播放指定句子（TTS 为朗读该句；音频元素为 seek 到 start 并播到 end） */
  play(segment: AudioSegment): void;
  pause(): void;
  stop(): void;
  setRate(rate: number): void;
  /** 播放结束回调（TTS 为 utterance end；音频元素为到达 segment.end） */
  onEnd(cb: () => void): void;
}

export interface AudioProvider {
  id: 'tts' | 'element';
  label: string;
  canPlay(meta: AudioTrackMeta): boolean;
  create(meta: AudioTrackMeta, options?: { rate?: number; lang?: string }): AudioHandle;
}

/* ------------------------------------------------------------------ *
 * 1) 真实音频（<audio> + preservesPitch）：素材就位后即可启用
 * ------------------------------------------------------------------ */
export function createElementProvider(doc?: Document | null): AudioProvider {
  const resolveDoc = () => (doc === undefined ? (typeof document !== 'undefined' ? document : null) : doc);
  return {
    id: 'element',
    label: '真实音频',
    canPlay: (meta) => meta.kind === 'file' && !!meta.url,
    create(meta, options = {}) {
      const d = resolveDoc();
      if (!d) throw new Error('真实音频提供方需要 DOM 环境（createElement）');
      const audio = d.createElement('audio');
      audio.src = String(meta.url);
      audio.preload = 'metadata';
      // 变速不变调
      const withPitch = audio as HTMLAudioElement & { preservesPitch?: boolean; mozPreservesPitch?: boolean; webkitPreservesPitch?: boolean };
      withPitch.preservesPitch = true;
      withPitch.mozPreservesPitch = true;
      withPitch.webkitPreservesPitch = true;
      audio.playbackRate = clampRate(options.rate ?? 1);

      let stopAt = Number.POSITIVE_INFINITY;
      let endCb: (() => void) | null = null;
      const onTime = () => {
        if (audio.currentTime >= stopAt) {
          audio.pause();
          if (endCb) endCb();
        }
      };
      audio.addEventListener('timeupdate', onTime);

      return {
        play(segment) {
          stopAt = segment.end > 0 ? segment.end : Number.POSITIVE_INFINITY;
          audio.currentTime = Math.max(0, segment.start);
          void audio.play().catch(() => { /* 自动播放被拦截时静默 */ });
        },
        pause: () => audio.pause(),
        stop() {
          audio.pause();
          audio.currentTime = 0;
        },
        setRate(rate) { audio.playbackRate = clampRate(rate); },
        onEnd(cb) { endCb = cb; },
      };
    },
  };
}

/* ------------------------------------------------------------------ *
 * 2) TTS 占位（SpeechSynthesis）：素材缺席时先把交互跑通
 * ------------------------------------------------------------------ */
export interface TtsLike {
  cancel(): void;
  speak(u: unknown): void;
  pause?(): void;
  resume?(): void;
  speaking?: boolean;
}

export interface SpeechHost {
  speechSynthesis?: TtsLike;
  SpeechSynthesisUtterance?: new (text: string) => { lang: string; rate: number; onend: (() => void) | null; onerror: (() => void) | null };
}

function resolveHost(host?: SpeechHost | null): SpeechHost | null {
  if (host !== undefined) return host;
  return typeof window !== 'undefined' ? (window as unknown as SpeechHost) : null;
}

export function createTtsProvider(host?: SpeechHost | null): AudioProvider {
  return {
    id: 'tts',
    label: '语音合成（占位）',
    canPlay: (meta) => meta.kind === 'tts' && meta.segments.length > 0,
    create(meta, options = {}) {
      const h = resolveHost(host);
      let rate = clampRate(options.rate ?? 0.9);
      let endCb: (() => void) | null = null;
      return {
        play(segment) {
          const speech = h?.speechSynthesis;
          const Utterance = h?.SpeechSynthesisUtterance;
          if (!speech || !Utterance) {
            if (endCb) endCb();
            return;
          }
          speech.cancel();
          const utterance = new Utterance(segment.text);
          utterance.lang = options.lang || meta.lang || 'en-US';
          utterance.rate = rate;
          utterance.onend = () => { if (endCb) endCb(); };
          utterance.onerror = () => { if (endCb) endCb(); };
          speech.speak(utterance);
        },
        pause() { h?.speechSynthesis?.pause?.(); },
        stop() { h?.speechSynthesis?.cancel(); },
        setRate(next) { rate = clampRate(next); },
        onEnd(cb) { endCb = cb; },
      };
    },
  };
}

/** 选择可用的提供方（优先真实音频，其次 TTS） */
export function pickProvider(meta: AudioTrackMeta, providers: AudioProvider[]): AudioProvider | null {
  return providers.find((p) => p.canPlay(meta)) || null;
}

/* ------------------------------------------------------------------ *
 * 3) 精听播放器：逐句 / 循环 / A-B / 变速 / 原文 / 听写
 * ------------------------------------------------------------------ */
export type LoopMode = 'none' | 'one' | 'ab';

export interface PlayerSnapshot {
  state: PlayerState;
  index: number;
  total: number;
  rate: number;
  loop: LoopMode;
  ab: { a: number; b: number } | null;
  showText: boolean;
  dictation: boolean;
  providerId: string;
  timing: AudioTrackMeta['timing'];
  /** 听写结果（按句 id 缓存） */
  results: Record<string, DictationResult>;
}

export interface IntensivePlayerOptions {
  track: AudioTrackMeta;
  provider: AudioProvider;
  rate?: number;
  onChange?: (snapshot: PlayerSnapshot) => void;
}

export interface IntensivePlayer {
  snapshot(): PlayerSnapshot;
  play(index?: number): void;
  playSegment(index: number): void;
  next(): void;
  prev(): void;
  toggle(): void;
  stop(): void;
  setRate(rate: number): void;
  setLoop(mode: LoopMode): void;
  cycleLoop(): void;
  setA(index?: number): void;
  setB(index?: number): void;
  clearAb(): void;
  toggleText(): void;
  toggleDictation(): void;
  submitDictation(index: number, input: string): DictationResult;
  segments(): AudioSegment[];
}

export function createIntensivePlayer(options: IntensivePlayerOptions): IntensivePlayer {
  const { track, provider } = options;
  const handle = provider.create(track, { rate: options.rate ?? 0.9 });
  const results: Record<string, DictationResult> = {};
  const total = track.segments.length;

  const snapshot: PlayerSnapshot = {
    state: 'idle',
    index: 0,
    total,
    rate: clampRate(options.rate ?? 0.9),
    loop: 'none',
    ab: null,
    showText: true,
    dictation: false,
    providerId: provider.id,
    timing: track.timing,
    results,
  };

  const emit = () => options.onChange?.({ ...snapshot, ab: snapshot.ab ? { ...snapshot.ab } : null, results: { ...results } });

  handle.onEnd(() => {
    if (snapshot.loop === 'one') {
      playSegment(snapshot.index);
      return;
    }
    if (snapshot.loop === 'ab' && snapshot.ab) {
      if (snapshot.index >= snapshot.ab.b) {
        playSegment(snapshot.ab.a);
        return;
      }
      playSegment(snapshot.index + 1);
      return;
    }
    if (snapshot.index < total - 1) {
      playSegment(snapshot.index + 1);
      return;
    }
    snapshot.state = 'idle';
    emit();
  });

  function playSegment(index: number) {
    if (index < 0 || index >= total) return;
    snapshot.index = index;
    snapshot.state = 'playing';
    handle.play(track.segments[index]);
    emit();
  }

  return {
    snapshot: () => ({ ...snapshot, ab: snapshot.ab ? { ...snapshot.ab } : null, results: { ...results } }),
    segments: () => track.segments.slice(),
    play(index) { playSegment(typeof index === 'number' ? index : snapshot.index); },
    playSegment,
    next() { playSegment(Math.min(total - 1, snapshot.index + 1)); },
    prev() { playSegment(Math.max(0, snapshot.index - 1)); },
    toggle() {
      if (snapshot.state === 'playing') {
        handle.pause();
        snapshot.state = 'paused';
        emit();
        return;
      }
      playSegment(snapshot.index);
    },
    stop() {
      handle.stop();
      snapshot.state = 'idle';
      emit();
    },
    setRate(rate) {
      snapshot.rate = clampRate(rate);
      handle.setRate(snapshot.rate);
      emit();
    },
    setLoop(mode) {
      snapshot.loop = mode;
      if (mode !== 'ab') snapshot.ab = null;
      emit();
    },
    cycleLoop() {
      const order: LoopMode[] = ['none', 'one', 'ab'];
      const next = order[(order.indexOf(snapshot.loop) + 1) % order.length];
      this.setLoop(next);
    },
    setA(index) {
      if (!total) return;
      const a = typeof index === 'number' ? index : snapshot.index;
      const b = snapshot.ab ? snapshot.ab.b : Math.min(total - 1, a);
      snapshot.ab = clampAbRange(a, b, total);
      snapshot.loop = 'ab';
      emit();
    },
    setB(index) {
      if (!total) return;
      const b = typeof index === 'number' ? index : snapshot.index;
      const a = snapshot.ab ? snapshot.ab.a : 0;
      snapshot.ab = clampAbRange(a, b, total);
      snapshot.loop = 'ab';
      emit();
    },
    clearAb() {
      snapshot.ab = null;
      if (snapshot.loop === 'ab') snapshot.loop = 'none';
      emit();
    },
    toggleText() {
      snapshot.showText = !snapshot.showText;
      emit();
    },
    toggleDictation() {
      snapshot.dictation = !snapshot.dictation;
      if (snapshot.dictation) snapshot.showText = false;
      emit();
    },
    submitDictation(index, input) {
      const segment = track.segments[index];
      if (!segment) return { correct: false, ratio: 0, words: [], missing: [], extra: [] };
      const result = checkDictation(segment.text, input);
      results[segment.id] = result;
      emit();
      return result;
    },
  };
}
