/**
 * 听力题音频内容守卫（v1.10 第四批）
 *
 * 抓的是一个**真实上线过的缺陷**：
 * `build-audio-tts.mjs` 的 `textOf()` 原本只读 `audioMeta.text`，
 * 否则回落 `content.prompt + choices`。而听力题（talk）的正文在
 * `content.passage` 里 —— 从未被读到。
 *
 * 后果：所有 talk 题的 mp3 念的是「题干 + 中文选项」，例如
 *   "What are the two speakers mainly doing? 问路并确认公交路线 …"
 * 用户点播放听到的是题目本身，完全无法据此作答。
 * PRETCO 的 811 条从 v1.9.1 起就一直如此，直到本轮做端到端播放验收才发现。
 *
 * 验收方式：**把真实的 textOf 抠出来执行**（不是在本文件里重写一份，
 * 否则改源码时测试仍会拿旧逻辑自证清白 —— 这个坑实测踩过）。
 * 再用它的输出算哈希，与 manifest 里的 textHash 比对。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const sha = (s) => 'sha256:' + createHash('sha256').update(s, 'utf8').digest('hex');
const AUDIO_SRC = readFileSync(join(ROOT, 'scripts', 'build-audio-tts.mjs'), 'utf8');

/**
 * 从源码里抠出真实的 textOf 与 LISTENING_TEXT_KINDS 并执行。
 * 这样「测试」与「产品」共用同一份实现，改坏源码必然被测出。
 */
function loadRealTextOf() {
  const kindsM = AUDIO_SRC.match(/const LISTENING_TEXT_KINDS = new Set\(\[[^\]]*\]\);/);
  assert.ok(kindsM, '未找到 LISTENING_TEXT_KINDS 定义');
  const fnM = AUDIO_SRC.match(/function textOf\(q\)\s*\{[\s\S]*?\n\}/);
  assert.ok(fnM, '未找到 textOf 函数');
  return new Function(`${kindsM[0]}\n${fnM[0]}\nreturn textOf;`)();
}

const realTextOf = loadRealTextOf();

const hasAudio = existsSync(join(ROOT, 'dist', 'audio', 'tts', 'manifest.json'));
const manifest = hasAudio
  ? JSON.parse(readFileSync(join(ROOT, 'dist', 'audio', 'tts', 'manifest.json'), 'utf8'))
  : null;

test('听力音频：真实 textOf 对 talk 题取 passage 而不是题面', () => {
  const sample = {
    id: 'q_test_talk',
    kind: 'talk',
    content: {
      prompt: 'What are the two speakers mainly doing?',
      passage: 'W: Excuse me, does this bus go to the park?\nM: Yes, change at the corner.',
      choices: ['问路并确认公交路线', '介绍校园社团', '讨论期末复习', '请教邮件格式'],
      answer: '问路并确认公交路线',
    },
  };
  const got = realTextOf(sample);
  assert.ok(got.includes('does this bus go'), `应朗读对话正文，实际朗读：${got.slice(0, 80)}`);
  assert.ok(!got.includes('What are the two speakers'),
    '仍在朗读题干 —— talk 题必须朗读 passage');
  assert.ok(!got.includes('介绍校园社团'),
    '仍在朗读中文选项 —— talk 题必须朗读 passage');
});

test('听力音频：真实 textOf 对非听力题仍回落 prompt+choices', () => {
  const sample = {
    id: 'q_test_w',
    kind: 'write',
    content: { prompt: 'Translate this.', choices: ['A', 'B'], passage: '不该被读' },
  };
  const got = realTextOf(sample);
  assert.ok(got.includes('Translate this.'), '非听力题应回落题面');
  assert.ok(!got.includes('不该被读'), '非听力题不应朗读 passage');
});

test('听力音频：talk 题的 textHash 必须对应对话正文（用真实 textOf 复算）', { skip: !hasAudio }, () => {
  const bad = [];
  let checked = 0;
  for (const lex of ['junior', 'senior', 'kaoyan', 'pretco']) {
    const p = join(ROOT, 'src', 'data', 'lexicons', lex, 'question-bank', 'talk.json');
    if (!existsSync(p)) continue;
    const qs = JSON.parse(readFileSync(p, 'utf8')).questions || [];
    for (const q of qs) {
      const e = manifest.entries[q.id];
      if (!e) { bad.push(`${q.id}: 缺音频条目`); continue; }
      const want = sha(`${realTextOf(q)}|${e.voice}|1`);
      checked++;
      if (e.textHash !== want) {
        bad.push(`${q.id} [${lex}]: hash 与 passage 不符（疑似仍读题面）`);
      }
    }
  }
  assert.ok(checked > 3000, `应检查 3000+ 条 talk 音频，实际 ${checked}`);
  assert.deepEqual(bad.slice(0, 5), [], `有 ${bad.length} 条 talk 音频内容不对：\n  ${bad.slice(0, 5).join('\n  ')}`);
});

test('听力音频：每条 talk 都有 mp3 文件且体积合理', { skip: !hasAudio }, () => {
  const dir = join(ROOT, 'dist', 'audio', 'tts');
  const problems = [];
  let n = 0;
  for (const lex of ['junior', 'senior', 'kaoyan', 'pretco']) {
    const p = join(ROOT, 'src', 'data', 'lexicons', lex, 'question-bank', 'talk.json');
    if (!existsSync(p)) continue;
    const qs = JSON.parse(readFileSync(p, 'utf8')).questions || [];
    for (const q of qs) {
      n++;
      const f = join(dir, `${q.id}.mp3`);
      if (!existsSync(f)) { problems.push(`${q.id}: 缺 mp3`); continue; }
      const sz = statSync(f).size;
      // 对话正文至少几十词，mp3 不该小于 3 KB
      if (sz < 3000) problems.push(`${q.id}: mp3 仅 ${sz} B（疑似内容过短）`);
    }
  }
  assert.ok(n > 3000, `应检查 3000+ 条，实际 ${n}`);
  assert.deepEqual(problems.slice(0, 5), [], `有 ${problems.length} 条音频异常：\n  ${problems.slice(0, 5).join('\n  ')}`);
});
