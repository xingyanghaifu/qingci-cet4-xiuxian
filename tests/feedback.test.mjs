/**
 * 反馈提交与更新日志 单元测试（P1 任务 E）
 *
 * 覆盖：
 *   1. 前端校验规则（与服务端保持一致）
 *   2. 离线队列：失败入队、上限、重试成功/继续保留
 *   3. 提交状态映射：201/202 ok、400 invalid、429 rate_limited、503 入队、网络异常入队
 *   4. 截图读取（大小与格式限制）
 *   5. Pages Function：校验、honeypot、限流、无 D1 绑定降级、写入成功、405/204
 *   6. 更新日志：解析 CHANGELOG、渲染页面、转义与链接白名单
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { loadTs } from './helpers/load-ts.mjs';
import { onRequestPost, onRequest, onRequestOptions, parseFeedbackPayload, FEEDBACK_LIMITS } from '../functions/api/feedback.ts';
import { parseChangelog, renderChangelogPage, renderVersion, inlineMarkdown, buildChangelog } from '../scripts/build-changelog.mjs';

const feedback = await loadTs('src/services/feedback.ts');
const {
  validateFeedback, submitFeedback, flushFeedbackQueue, loadQueue, saveQueue, readImageFile,
  FEEDBACK_QUEUE_KEY, FEEDBACK_LIMITS: CLIENT_LIMITS, FEEDBACK_KINDS,
} = feedback;

/** 内存版 localStorage */
function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    _map: map,
  };
}

/** 假 Response 工厂 */
const jsonResponse = (status, body) => ({
  status,
  json: async () => body,
});

test('feedback：前端校验与服务端规则一致', () => {
  assert.equal(validateFeedback({ kind: 'bug', description: '太短' }).ok, false);
  assert.match(validateFeedback({ kind: 'bug', description: '短' }).errors[0], /至少 5 个字/);
  assert.equal(validateFeedback({ kind: 'bug', description: '按钮点不动，点了没反应' }).ok, true);
  assert.equal(validateFeedback({ kind: 'unknown-kind', description: '有效描述内容' }).value.kind, 'other');
  assert.equal(validateFeedback({ kind: 'bug', description: '有效描述内容', screenshot: 'data:text/plain;base64,AAA' }).ok, false);
  assert.equal(
    validateFeedback({ kind: 'bug', description: '有效描述内容', screenshot: 'data:image/png;base64,' + 'A'.repeat(FEEDBACK_LIMITS.maxScreenshotBytes + 10) }).ok,
    false,
  );
  assert.equal(CLIENT_LIMITS.maxDescription, FEEDBACK_LIMITS.maxDescription, '前后端上限应一致');
  assert.equal(CLIENT_LIMITS.minDescription, FEEDBACK_LIMITS.minDescription);
  assert.equal(CLIENT_LIMITS.maxScreenshotBytes, FEEDBACK_LIMITS.maxScreenshotBytes);
  assert.deepEqual(FEEDBACK_KINDS.map((k) => k.value), FEEDBACK_LIMITS.kinds, '前后端类型集合应一致');

  const long = validateFeedback({ kind: 'bug', description: 'x'.repeat(3000) });
  assert.equal(long.value.description.length, FEEDBACK_LIMITS.maxDescription, '描述应截断到上限');
});

test('feedback：离线队列入队、上限与重试', async () => {
  const storage = makeStorage();
  // 网络异常 → 入队
  const failing = async () => { throw new Error('offline'); };
  const queued = await submitFeedback(
    { kind: 'bug', description: '离线时提交的反馈' },
    { fetchImpl: failing, storage },
  );
  assert.equal(queued.status, 'queued');
  assert.equal(loadQueue(storage).length, 1);
  assert.ok(storage._map.get(FEEDBACK_QUEUE_KEY).includes('离线时提交的反馈'));

  // 队列上限 10
  for (let i = 0; i < 15; i++) {
    await submitFeedback({ kind: 'other', description: '第 ' + i + ' 条离线反馈' }, { fetchImpl: failing, storage });
  }
  assert.equal(loadQueue(storage).length, 10, '队列应被限制在 10 条');
  assert.ok(loadQueue(storage)[9].description.includes('14'), '保留最新的');

  // 重试：全部成功 → 队列清空
  const ok = async () => jsonResponse(201, { status: 'ok', id: 7 });
  const flushed = await flushFeedbackQueue({ fetchImpl: ok, storage });
  assert.equal(flushed.submitted, 10);
  assert.equal(flushed.remaining, 0);
  assert.equal(loadQueue(storage).length, 0);

  // 重试仍有失败 → 保留
  await submitFeedback({ kind: 'bug', description: '再来一条离线反馈' }, { fetchImpl: failing, storage });
  const half = await flushFeedbackQueue({ fetchImpl: failing, storage });
  assert.equal(half.submitted, 0);
  assert.equal(half.remaining, 1);
  assert.equal(loadQueue(storage).length, 1);

  // 存储不可用时不崩
  assert.deepEqual(saveQueue([{ kind: 'bug', description: 'x' }], null).length, 1);
  assert.deepEqual(loadQueue(null), []);
});

test('feedback：提交状态映射（201/202/400/429/503/异常）', async () => {
  const storage = makeStorage();
  const input = { kind: 'suggestion', description: '希望增加错题导出 CSV 功能' };

  const okFetch = async () => jsonResponse(201, { status: 'ok', id: 42 });
  const ok = await submitFeedback(input, { fetchImpl: okFetch, storage });
  assert.equal(ok.status, 'ok');
  assert.equal(ok.id, 42);

  const spamFetch = async () => jsonResponse(202, { status: 'ok', stored: false });
  assert.equal((await submitFeedback(input, { fetchImpl: spamFetch, storage })).status, 'ok');

  const badFetch = async () => jsonResponse(400, { status: 'invalid', message: '描述至少 5 个字' });
  const bad = await submitFeedback(input, { fetchImpl: badFetch, storage });
  assert.equal(bad.status, 'invalid');
  assert.match(bad.message, /至少 5 个字/);

  const limitedFetch = async () => jsonResponse(429, { status: 'rate_limited', message: '提交过于频繁' });
  assert.equal((await submitFeedback(input, { fetchImpl: limitedFetch, storage })).status, 'rate_limited');

  const unavailableFetch = async () => jsonResponse(503, { status: 'unavailable', message: '未配置' });
  const unavailable = await submitFeedback(input, { fetchImpl: unavailableFetch, storage });
  assert.equal(unavailable.status, 'queued', '服务未配置时应留在本地队列');
  assert.equal(loadQueue(storage).length, 1);

  // 校验失败不入队
  const before = loadQueue(storage).length;
  const invalid = await submitFeedback({ kind: 'bug', description: '短' }, { fetchImpl: okFetch, storage });
  assert.equal(invalid.status, 'invalid');
  assert.equal(loadQueue(storage).length, before);

  // 无 fetch 环境（老浏览器）→ 入队
  const noFetch = await submitFeedback({ kind: 'bug', description: '没有 fetch 的环境' }, { fetchImpl: null, storage });
  assert.equal(noFetch.status, 'queued');
});

test('feedback：截图读取的大小与格式限制', async () => {
  const file = (type, size) => ({ type, size, arrayBuffer: async () => new ArrayBuffer(4) });
  assert.equal((await readImageFile(file('image/gif', 100))).ok, false);
  assert.match((await readImageFile(file('image/gif', 100))).error, /PNG/);
  assert.equal((await readImageFile(file('image/png', 600 * 1024))).ok, false);
  const ok = await readImageFile(file('image/png', 1000));
  assert.equal(ok.ok, true);
  assert.match(ok.dataUrl, /^data:image\/png;base64,/);
});

/** 假 D1：记录 SQL 与参数，可模拟限流与抛错 */
function makeDb(options = {}) {
  const inserted = [];
  return {
    inserted,
    prepare() {
      // bind/run 必须共享同一份参数：run 用普通函数读 this.values（箭头函数拿不到）
      return {
        values: [],
        bind(...values) { this.values = values; return this; },
        async first() { return options.rateLimited ? { n: 99 } : { n: 0 }; },
        async run() {
          if (options.throws) throw new Error('D1 write failed');
          inserted.push(this.values);
          return { success: true, meta: { last_row_id: 123 } };
        },
      };
    },
  };
}

const postRequest = (body, headers = {}) => new Request('https://example.com/api/feedback', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9', 'user-agent': 'test-agent', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

test('function：校验失败、honeypot 与 JSON 解析错误', async () => {
  const env = { DB: makeDb() };
  const notJson = await onRequestPost({ request: postRequest('not-json{'), env });
  assert.equal(notJson.status, 400);

  const short = await onRequestPost({ request: postRequest({ kind: 'bug', description: '短' }), env });
  assert.equal(short.status, 400);
  assert.match((await short.json()).message, /至少 5 个字/);

  const spam = await onRequestPost({ request: postRequest({ kind: 'bug', description: '机器人提交的内容', website: 'http://spam.example' }), env });
  assert.equal(spam.status, 202, 'honeypot 命中返回 202 但不入库');
  assert.equal((await spam.json()).stored, false);
  assert.equal(env.DB.inserted.length, 0, 'honeypot 内容不应写库');
});

test('function：无 D1 绑定降级、限流、写入成功与方法约束', async () => {
  const noDb = await onRequestPost({ request: postRequest({ kind: 'bug', description: '服务未配置时的提交' }), env: {} });
  assert.equal(noDb.status, 503);
  assert.match((await noDb.json()).message, /D1/);

  const limited = await onRequestPost({
    request: postRequest({ kind: 'bug', description: '频繁提交的反馈' }),
    env: { DB: makeDb({ rateLimited: true }) },
  });
  assert.equal(limited.status, 429);

  const okDb = makeDb();
  const ok = await onRequestPost({
    request: postRequest({ kind: 'content', description: '第 12 题答案有误，应为 B', contact: 'a@b.c' }),
    env: { DB: okDb, APP_VERSION: '1.4.0', FEEDBACK_SALT: 'unit-test-salt' },
  });
  assert.equal(ok.status, 201);
  const payload = await ok.json();
  assert.equal(payload.stored, true);
  assert.equal(payload.id, 123);
  assert.equal(okDb.inserted.length, 1);
  const values = okDb.inserted[0];
  assert.equal(values[1], 'content');
  assert.equal(values[2], '第 12 题答案有误，应为 B');
  assert.equal(values[5], '1.4.0', '应记录应用版本');
  assert.equal(values[8].length, 16, 'IP 只保存 16 位哈希');
  assert.ok(!values.includes('203.0.113.9'), '不应保存原始 IP');

  const failed = await onRequestPost({
    request: postRequest({ kind: 'bug', description: '写库失败的情况' }),
    env: { DB: makeDb({ throws: true }) },
  });
  assert.equal(failed.status, 500);
  assert.match((await failed.json()).message, /写入失败/);

  assert.equal(onRequest().status, 405);
  assert.equal(onRequest().headers.get('allow'), 'POST, OPTIONS');
  assert.equal(onRequestOptions().status, 204);
});

test('changelog：解析版本与小节', () => {
  const md = [
    '# 更新日志',
    '',
    '## [未发布]',
    '',
    '### 新增：甲',
    '- 第一条',
    '- 第二条带 `代码` 与 **粗体**',
    '  续行内容',
    '',
    '## [1.2.3] - 2026-01-02',
    '',
    '### 修复',
    '- 修了一个 bug',
    '',
  ].join('\n');
  const parsed = parseChangelog(md);
  assert.equal(parsed.versions.length, 2);
  assert.equal(parsed.versions[0].version, '未发布');
  assert.equal(parsed.versions[0].unreleased, true);
  assert.equal(parsed.versions[1].version, '1.2.3');
  assert.equal(parsed.versions[1].date, '2026-01-02');
  assert.equal(parsed.versions[0].sections[0].title, '新增：甲');
  assert.equal(parsed.versions[0].sections[0].items.length, 2);
  assert.match(parsed.versions[0].sections[0].items[1], /续行内容/, '续行应并入上一条');
  assert.equal(parseChangelog('').versions.length, 0);
});

test('changelog：行内渲染转义与链接白名单', () => {
  assert.equal(inlineMarkdown('**粗** 与 `码`'), '<strong>粗</strong> 与 <code>码</code>');
  assert.equal(inlineMarkdown('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.match(inlineMarkdown('[官网](https://example.com)'), /href="https:\/\/example\.com"/);
  assert.match(inlineMarkdown('[坏链接](javascript:alert(1))'), /href="#"/, 'javascript: 链接应被丢弃');

  const entry = { version: '1.0.0', date: '2026-01-01', unreleased: false, sections: [{ title: '新增', items: ['条目 <b>'] }] };
  const html = renderVersion(entry);
  assert.match(html, /<h2>1\.0\.0 <time>2026-01-01<\/time><\/h2>/);
  assert.match(html, /条目 &lt;b&gt;/);
  assert.match(renderVersion({ ...entry, unreleased: true, version: '未发布', date: '' }), /开发中/);
});

test('changelog：真实 CHANGELOG.md 可生成页面（构建期产物）', () => {
  // 写到 dist/（已被 .gitignore 忽略），测完删除，避免污染仓库
  const outHtml = new URL('../dist/.changelog-test.html', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const result = buildChangelog({ outHtml });
  try {
    assert.ok(result.versions >= 10, `应解析出多个版本，实际 ${result.versions}`);
    assert.match(result.html, /^<!DOCTYPE html>/);
    assert.match(result.html, /更新日志/);
    assert.match(result.html, /返回应用/);
    // 纯静态：不加载任何外部资源（正文里的纯文本 URL 不算资源引用）
    assert.ok(!/<script/i.test(result.html), '生成页不应包含脚本');
    assert.ok(!/<img|src=/i.test(result.html), '生成页不应包含图片或外部资源');
    assert.ok(!/<link[^>]+stylesheet/i.test(result.html), '生成页不应外链样式表');
    assert.ok(!/<iframe|<object|<embed/i.test(result.html), '不应嵌入外部内容');
  } finally {
    try { rmSync(outHtml, { force: true }); } catch { /* 忽略 */ }
  }
});
