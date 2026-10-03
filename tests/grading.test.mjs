/**
 * AI 批改（P0.4）单元测试
 *
 * 覆盖三件事：
 *   1. 开关关闭时**绝不发起网络请求**（这是本次「只做接口预留」的核心约束）
 *   2. 开关打开时，成功 / 501 / 非法结构 / 网络异常四条分支的归一化处理
 *   3. 占位 Function 的响应契约（200 not_implemented / 400 参数错误 / 405 方法限制 / 204 预检）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/load-ts.mjs';

const grading = await loadTs('src/services/grading.ts');
const gradeFn = await loadTs('functions/api/grade.ts');

const { gradeSubmission, isValidGradeResult, MIN_ANSWER_LENGTH } = grading;

const VALID_ANSWER = 'This is a long enough answer for grading to be attempted.';
const VALID_RESULT = {
  totalScore: 11,
  dimensions: { content: 5, coherence: 3, language: 2, richness: 1 },
  errors: [{ original: 'recieve', suggestion: 'receive', reason: '拼写错误' }],
  suggestions: ['注意主谓一致'],
  model: 'deepseek-chat',
  gradedAt: '2026-10-03T00:00:00.000Z',
};

/** 记录所有 fetch 调用，避免测试真的发出请求 */
function withFetchMock(handler) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

function setFlag(enabled) {
  globalThis.__QINGCI_FEATURE_OVERRIDES__ = { AI_GRADING_ENABLED: enabled };
}
function clearFlag() {
  delete globalThis.__QINGCI_FEATURE_OVERRIDES__;
}

const payload = { type: 'writing', questionId: 'paper:1:作文', userAnswer: VALID_ANSWER, prompt: 'Write about campus life.' };

test('grading：开关关闭时不发起任何网络请求，直接返回 not_implemented', async () => {
  clearFlag();
  const mock = withFetchMock(() => { throw new Error('不应该发起请求'); });
  try {
    const res = await gradeSubmission(payload);
    assert.equal(res.status, 'not_implemented');
    assert.match(res.message, /接入中/);
    assert.equal(mock.calls.length, 0, '开关关闭时 fetch 调用次数必须为 0');
  } finally { mock.restore(); }
});

test('grading：空答案与过短答案在请求前就被拦下', async () => {
  setFlag(true);
  const mock = withFetchMock(() => new Response('{}', { status: 200 }));
  try {
    const empty = await gradeSubmission({ ...payload, userAnswer: '   ' });
    assert.equal(empty.status, 'error');
    const short = await gradeSubmission({ ...payload, userAnswer: 'a'.repeat(MIN_ANSWER_LENGTH - 1) });
    assert.equal(short.status, 'error');
    assert.match(short.message, /过短/);
    assert.equal(mock.calls.length, 0);
  } finally { mock.restore(); clearFlag(); }
});

test('grading：开关打开且后端返回 success 时透传批改结果', async () => {
  setFlag(true);
  const mock = withFetchMock(() => new Response(JSON.stringify({ status: 'success', result: VALID_RESULT }), { status: 200 }));
  try {
    const res = await gradeSubmission(payload);
    assert.equal(res.status, 'success');
    assert.equal(res.result.totalScore, 11);
    assert.equal(mock.calls.length, 1);
    assert.equal(mock.calls[0].url, '/api/grade');
    assert.equal(JSON.parse(String(mock.calls[0].init.body)).questionId, payload.questionId);
  } finally { mock.restore(); clearFlag(); }
});

test('grading：后端 501 归一为 not_implemented（界面不报错）', async () => {
  setFlag(true);
  const mock = withFetchMock(() => new Response('', { status: 501 }));
  try {
    const res = await gradeSubmission(payload);
    assert.equal(res.status, 'not_implemented');
  } finally { mock.restore(); clearFlag(); }
});

test('grading：结构不符的结果被丢弃，不写入脏数据', async () => {
  setFlag(true);
  const mock = withFetchMock(() => new Response(JSON.stringify({ status: 'success', result: { totalScore: 'x' } }), { status: 200 }));
  try {
    const res = await gradeSubmission(payload);
    assert.equal(res.status, 'error');
    assert.match(res.message, /字段不完整/);
  } finally { mock.restore(); clearFlag(); }
});

test('grading：网络异常不抛出，归一为 error', async () => {
  setFlag(true);
  const mock = withFetchMock(() => { throw new Error('network down'); });
  try {
    const res = await gradeSubmission(payload);
    assert.equal(res.status, 'error');
    assert.match(res.message, /暂时不可用/);
  } finally { mock.restore(); clearFlag(); }
});

test('grading：isValidGradeResult 边界校验', () => {
  assert.equal(isValidGradeResult(VALID_RESULT), true);
  assert.equal(isValidGradeResult(null), false);
  assert.equal(isValidGradeResult({}), false);
  assert.equal(isValidGradeResult({ ...VALID_RESULT, dimensions: { content: 1 } }), false);
  assert.equal(isValidGradeResult({ ...VALID_RESULT, errors: 'oops' }), false);
});

test('functions：POST /api/grade 占位返回 200 not_implemented，且不读取密钥', async () => {
  const req = new Request('https://example.com/api/grade', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'writing', questionId: 'q1', userAnswer: VALID_ANSWER }),
  });
  const res = await gradeFn.onRequestPost({ request: req, env: { AI_GRADING_ENABLED: 'true', DEEPSEEK_API_KEY: 'should-not-be-used' } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'not_implemented');
  assert.match(body.message, /尚未开放/);
});

test('functions：POST /api/grade 参数错误返回 400', async () => {
  const bad = new Request('https://example.com/api/grade', { method: 'POST', body: 'not-json' });
  const res1 = await gradeFn.onRequestPost({ request: bad, env: {} });
  assert.equal(res1.status, 400);

  const missing = new Request('https://example.com/api/grade', {
    method: 'POST', body: JSON.stringify({ type: 'writing' }),
  });
  const res2 = await gradeFn.onRequestPost({ request: missing, env: {} });
  assert.equal(res2.status, 400);
});

test('functions：非 POST 方法返回 405，OPTIONS 预检返回 204', async () => {
  const res405 = await gradeFn.onRequest({ request: new Request('https://example.com/api/grade'), env: {} });
  assert.equal(res405.status, 405);
  const res204 = await gradeFn.onRequestOptions();
  assert.equal(res204.status, 204);
  assert.match(res204.headers.get('access-control-allow-methods') || '', /POST/);
});
