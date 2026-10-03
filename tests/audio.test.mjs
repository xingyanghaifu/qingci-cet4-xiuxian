/**
 * 听力精听：时间戳结构、播放器控制与听写比对 单元测试（P1 任务 D）
 *
 * 用假的 provider 驱动播放器，因此不需要真实音频或浏览器语音合成。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/load-ts.mjs';

const audioTypes = await loadTs('src/types/audio.ts');
const audioProvider = await loadTs('src/services/audio-provider.ts');

const {
  buildTrackFromText, splitSentences, normalizeAudioMeta, segmentAt, neighborSegment, indexOfSegment,
  clampAbRange, clampRate, estimateSeconds, checkDictation, normalizeForDictation, describeSegment,
} = audioTypes;
const { createTtsProvider, createElementProvider, pickProvider, createIntensivePlayer } = audioProvider;

const TEXT = 'The library opens at eight. Students should bring their cards. Please keep quiet inside.';

/** 假 provider：记录播放过的句子，可手动触发结束回调 */
function makeFakeProvider() {
  const played = [];
  let endCb = null;
  let rate = 0.9;
  let stopped = 0;
  return {
    id: 'tts',
    label: '假提供方',
    canPlay: () => true,
    played,
    get rate() { return rate; },
    get stopped() { return stopped; },
    finish() { if (endCb) endCb(); },
    create() {
      return {
        play(segment) { played.push(segment.id); },
        pause() {},
        stop() { stopped++; },
        setRate(next) { rate = next; },
        onEnd(cb) { endCb = cb; },
      };
    },
  };
}

test('audio：文本切句与时间戳估算', () => {
  const sentences = splitSentences(TEXT);
  assert.equal(sentences.length, 3);
  assert.ok(sentences[0].endsWith('.'));

  const track = buildTrackFromText(TEXT, { rate: 1 });
  assert.equal(track.kind, 'tts');
  assert.equal(track.timing, 'estimated');
  assert.equal(track.segments.length, 3);
  assert.equal(track.available, true);
  // 时间戳连续且递增
  for (let i = 1; i < track.segments.length; i++) {
    assert.equal(track.segments[i].start, track.segments[i - 1].end, '句子之间应无缝衔接');
    assert.ok(track.segments[i].end > track.segments[i].start);
  }
  assert.ok(Math.abs(track.durationSec - track.segments[track.segments.length - 1].end) < 0.01);

  // 语速越快，估算总时长越短
  const fast = buildTrackFromText(TEXT, { rate: 2 });
  assert.ok(fast.durationSec < track.durationSec);
  assert.ok(estimateSeconds('one two three', 1) >= 0.6);
  assert.deepEqual(splitSentences('   '), []);
  assert.equal(buildTrackFromText('').available, false, '空文本应标记为不可用');
});

test('audio：长句按长度二次切分', () => {
  const long = 'This is a deliberately long sentence, with several commas, that keeps going and going, '
    + 'because the splitter should break it into smaller pieces, otherwise the intensive player would '
    + 'repeat a huge chunk at once, which is bad for practice.';
  const sentences = splitSentences(long, 80);
  assert.ok(sentences.length >= 2, '超长句应被切分');
  assert.ok(sentences.every((s) => s.length <= 200));
});

test('audio：audioMeta 规范化与查找', () => {
  const track = buildTrackFromText(TEXT, { rate: 1 });
  const normalized = normalizeAudioMeta({ ...track, kind: 'file', url: 'a.mp3', timing: 'measured' });
  assert.equal(normalized.kind, 'file');
  assert.equal(normalized.url, 'a.mp3');
  assert.equal(normalized.timing, 'measured');
  assert.equal(normalized.segments.length, 3);

  // 只有文本、没有时间戳 → 自动按文本构造估算音轨
  const fromText = normalizeAudioMeta({ text: 'Hello there. Goodbye now.', lang: 'en-US' });
  assert.equal(fromText.segments.length, 2);
  assert.equal(fromText.kind, 'tts');
  // 有真实 url、但暂无逐句时间戳：kind/url 必须保留（否则真实音频会被误判成 TTS）
  const fileNoTiming = normalizeAudioMeta({ kind: 'file', url: 'b.mp3', text: 'One. Two.' });
  assert.equal(fileNoTiming.kind, 'file');
  assert.equal(fileNoTiming.url, 'b.mp3');
  assert.equal(fileNoTiming.timing, 'estimated');
  assert.equal(fileNoTiming.segments.length, 2);
  assert.equal(normalizeAudioMeta(null), null);
  assert.equal(normalizeAudioMeta({}), null, '既无 url 也无文本时返回 null');
  assert.equal(normalizeAudioMeta({ kind: 'file', url: 'c.mp3' }), null, '无文本无法做逐句精听');
  assert.equal(normalizeAudioMeta('nope'), null);

  assert.equal(segmentAt(track, 0).id, 's1');
  assert.equal(segmentAt(track, track.segments[1].start + 0.01).id, 's2');
  assert.equal(segmentAt(track, 9999).id, 's3', '超出末尾应返回最后一句');
  assert.equal(indexOfSegment(track, 's2'), 1);
  assert.equal(indexOfSegment(track, 'nope'), -1);
  assert.equal(neighborSegment(track, 0, 1).id, 's2');
  assert.equal(neighborSegment(track, 0, -1), null);
  assert.equal(neighborSegment(track, 2, 1), null);

  assert.deepEqual(clampAbRange(3, 0, 3), { a: 0, b: 2 }, 'A-B 应夹紧并按大小排序');
  assert.deepEqual(clampAbRange(1, 1, 3), { a: 1, b: 1 });
  assert.equal(clampRate(9), 2);
  assert.equal(clampRate(0.1), 0.5);
  assert.equal(clampRate(NaN), 0.9);
  assert.match(describeSegment(track.segments[0], 0, 3), /第 1\/3 句/);
});

test('audio：提供方选择（真实音频优先，TTS 兜底）', () => {
  const tts = createTtsProvider({});
  const el = createElementProvider(null);
  const ttsTrack = buildTrackFromText(TEXT);
  const fileTrack = normalizeAudioMeta({ kind: 'file', url: 'a.mp3', text: TEXT });

  assert.equal(pickProvider(ttsTrack, [el, tts]).id, 'tts');
  assert.equal(pickProvider(fileTrack, [el, tts]).id, 'element');
  assert.equal(el.canPlay(ttsTrack), false);
  assert.equal(tts.canPlay(fileTrack), false, 'TTS 不接管真实音频');
});

test('player：逐句播放、自动续播与上一句/下一句', () => {
  const provider = makeFakeProvider();
  const track = buildTrackFromText(TEXT, { rate: 1 });
  const player = createIntensivePlayer({ track, provider });

  assert.equal(player.snapshot().state, 'idle');
  player.play();
  assert.deepEqual(provider.played, ['s1']);
  assert.equal(player.snapshot().state, 'playing');

  provider.finish(); // 第一句播完 → 自动播第二句
  assert.deepEqual(provider.played, ['s1', 's2']);
  assert.equal(player.snapshot().index, 1);

  player.next();
  assert.equal(player.snapshot().index, 2);
  provider.finish(); // 最后一句播完 → 回到 idle，不越界
  assert.equal(player.snapshot().state, 'idle');
  assert.equal(player.snapshot().index, 2);

  player.prev();
  assert.equal(player.snapshot().index, 1);
  player.playSegment(0);
  assert.equal(player.snapshot().index, 0);
  assert.equal(player.snapshot().total, 3);
});

test('player：单句循环与 A-B 段循环', () => {
  const provider = makeFakeProvider();
  const track = buildTrackFromText(TEXT, { rate: 1 });
  const player = createIntensivePlayer({ track, provider });

  // 单句循环
  player.setLoop('one');
  player.playSegment(1);
  provider.finish();
  provider.finish();
  assert.deepEqual(provider.played, ['s2', 's2', 's2'], '单句循环应反复播同一句');
  assert.equal(player.snapshot().loop, 'one');

  // A-B 循环：A=0，B=1
  player.setLoop('none');
  player.setA(0);
  player.setB(1);
  assert.deepEqual(player.snapshot().ab, { a: 0, b: 1 });
  assert.equal(player.snapshot().loop, 'ab');
  player.playSegment(0);
  provider.finish();  // s1 → s2
  provider.finish();  // s2 = B → 回到 A
  provider.finish();  // s1 → s2
  assert.deepEqual(provider.played.slice(-4), ['s1', 's2', 's1', 's2']);

  player.clearAb();
  assert.equal(player.snapshot().ab, null);
  assert.equal(player.snapshot().loop, 'none');

  player.cycleLoop();
  assert.equal(player.snapshot().loop, 'one');
  player.cycleLoop();
  assert.equal(player.snapshot().loop, 'ab');
});

test('player：变速传播、原文开关、听写模式与结果缓存', () => {
  const provider = makeFakeProvider();
  const track = buildTrackFromText(TEXT, { rate: 1 });
  const player = createIntensivePlayer({ track, provider });

  player.setRate(1.5);
  assert.equal(player.snapshot().rate, 1.5);
  assert.equal(provider.rate, 1.5, '语速应传给提供方');
  player.setRate(99);
  assert.equal(player.snapshot().rate, 2, '语速应夹紧到 2×');

  assert.equal(player.snapshot().showText, true);
  player.toggleText();
  assert.equal(player.snapshot().showText, false);

  player.toggleDictation();
  assert.equal(player.snapshot().dictation, true);
  assert.equal(player.snapshot().showText, false, '进入听写应自动隐藏原文');

  const perfect = player.submitDictation(0, track.segments[0].text);
  assert.equal(perfect.correct, true);
  assert.equal(perfect.ratio, 1);
  const partial = player.submitDictation(1, 'Students should bring cards');
  assert.equal(partial.correct, false);
  assert.ok(partial.ratio > 0.5 && partial.ratio < 1);
  assert.deepEqual(player.snapshot().results[track.segments[0].id].correct, true, '结果应按句缓存');

  player.stop();
  assert.equal(player.snapshot().state, 'idle');
  assert.equal(provider.stopped, 1);
});

test('audio：听写逐词比对（漏写/多写/标点与大小写不敏感）', () => {
  assert.equal(normalizeForDictation('Hello, World!'), 'hello world');
  const perfect = checkDictation('The library opens at eight.', 'the library opens at eight');
  assert.equal(perfect.correct, true);

  const missing = checkDictation('The library opens at eight.', 'the library opens eight');
  assert.equal(missing.correct, false);
  assert.deepEqual(missing.missing, ['at']);
  assert.ok(missing.ratio > 0.7);

  const extra = checkDictation('The library opens at eight.', 'the library really opens at eight today');
  assert.equal(extra.correct, false);
  assert.deepEqual(extra.extra, ['really', 'today']);
  assert.equal(extra.missing.length, 0);

  const empty = checkDictation('Hello world', '');
  assert.equal(empty.ratio, 0);
  assert.deepEqual(empty.missing, ['hello', 'world']);
  assert.equal(checkDictation('', '').correct, true);
});
