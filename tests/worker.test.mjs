/**
 * worker/index.js 单元测试
 *
 * 用最小化的 ASSETS 桩模拟静态资源绑定，验证 Worker 的路由与响应契约：
 * /healthz · /api/meta · /status · 静态透传 · 词库损坏时的降级
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.mjs';

/** 构造一个带词库的完整页面 HTML */
function htmlWithLexicon(count = 4540) {
  const words = Array.from({ length: count }, (_, i) => ({
    w: 'w' + i,
    ipa: '[a]',
    zh: 'n.释义' + i,
    short: '释义' + i,
  }));
  return '<!DOCTYPE html><html><body>'
    + '<script id="lexicon" type="application/json">'
    + JSON.stringify(words)
    + '</script></body></html>';
}

/** 构造 ASSETS 桩：可控制页面是否可用、词库是否损坏 */
function makeEnv({ ok = true, html = htmlWithLexicon(), version = '1.0.0' } = {}) {
  return {
    APP_VERSION: version,
    START_MS: Date.now(),
    ASSETS: {
      async fetch() {
        return new Response(ok ? html : 'not found', {
          status: ok ? 200 : 404,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      },
    },
  };
}

function req(path, init) {
  return new Request('https://qingci-cet4-xiuxian.bw8pbrkt56.workers.dev' + path, init);
}

test('worker：/healthz 返回 200 且词库校验通过', async () => {
  const res = await worker.fetch(req('/healthz'), makeEnv(), {});
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.checks.lexicon.ok, true);
  assert.equal(body.checks.lexicon.count, 4540);
  assert.equal(body.checks.lexicon.expected, 4540);
  assert.equal(body.runtime.platform, 'cloudflare-workers');
  assert.ok(typeof body.timestamp === 'string');
});

test('worker：/health 是 /healthz 的等价别名', async () => {
  const res = await worker.fetch(req('/health'), makeEnv(), {});
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
});

test('worker：词库损坏时 /healthz 降级为 503', async () => {
  const broken = '<!DOCTYPE html><html><body><script id="lexicon" type="application/json">{bad json</script></body></html>';
  const res = await worker.fetch(req('/healthz'), makeEnv({ html: broken }), {});
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.status, 'degraded');
  assert.equal(body.checks.lexicon.ok, false);
  assert.equal(body.checks.lexicon.count, 0);
});

test('worker：静态资源缺失时 /healthz 降级为 503', async () => {
  const res = await worker.fetch(req('/healthz'), makeEnv({ ok: false }), {});
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.checks.assets.ok, false);
});

test('worker：/api/meta 返回元信息与词库条数', async () => {
  const res = await worker.fetch(req('/api/meta'), makeEnv(), {});
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.version, '1.0.0');
  assert.equal(body.lexiconSize, 4540);
  assert.equal(body.servedFrom, 'cloudflare-edge');
  assert.deepEqual(body.memoryKinds, ['zh2en', 'en2zh', 'similar', 'listen', 'spell', 'pos']);
  assert.ok(Array.isArray(body.features) && body.features.length > 0);
});

test('worker：/api/meta 返回五类备考模式与题源治理边界（与本地/Pages 一致）', async () => {
  const res = await worker.fetch(req('/api/meta'), makeEnv(), {});
  const body = await res.json();
  assert.deepEqual(body.examTypes, ['junior', 'senior', 'pets3', 'cet4', 'cet6']);
  assert.match(body.examSourcePolicy, /原创/);
});

test('worker：/status 返回可读状态页', async () => {
  const res = await worker.fetch(req('/status'), makeEnv(), {});
  assert.equal(res.status, 200);
  const ct = res.headers.get('content-type');
  assert.match(ct, /text\/html/);
  const html = await res.text();
  assert.match(html, /服务状态/);
  assert.match(html, /Cloudflare Workers/);
});

test('worker：未知路径透传给静态资源（SPA 回退）', async () => {
  const res = await worker.fetch(req('/some/deep/path'), makeEnv(), {});
  assert.equal(res.status, 200);
});

test('worker：/ 透传返回应用页面且体积完整', async () => {
  const env = makeEnv();
  const res = await worker.fetch(req('/'), env, {});
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes('lexicon'), '页面应包含词库脚本');
  assert.ok(html.length > 1000, '页面不应为空壳');
});

test('worker：JSON 响应带 no-store 与 nosniff 头', async () => {
  const res = await worker.fetch(req('/healthz'), makeEnv(), {});
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(res.headers.get('content-type'), /application\/json/);
});

test('worker：APP_VERSION 环境变量生效', async () => {
  const res = await worker.fetch(req('/api/meta'), makeEnv({ version: '1.2.3' }), {});
  const body = await res.json();
  assert.equal(body.version, '1.2.3');
});

test('worker：词库条数与实际内容一致（非硬编码）', async () => {
  const res = await worker.fetch(req('/healthz'), makeEnv({ html: htmlWithLexicon(100) }), {});
  const body = await res.json();
  assert.equal(body.checks.lexicon.count, 100, '应反映真实条数');
  assert.equal(body.checks.lexicon.ok, true);
});

test('worker：ASSETS 抛异常时 /healthz 降级为 503（不崩溃）', async () => {
  const env = {
    APP_VERSION: '1.0.0',
    START_MS: Date.now(),
    ASSETS: { async fetch() { throw new Error('绑定不可用'); } },
  };
  const res = await worker.fetch(req('/healthz'), env, {});
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.status, 'degraded');
  assert.equal(body.checks.assets.ok, false);
  assert.equal(body.checks.lexicon.count, 0);
});

test('worker：ASSETS 抛异常时 /api/meta 仍返回 200（词库数降级为 0）', async () => {
  const env = {
    APP_VERSION: '1.0.0',
    START_MS: Date.now(),
    ASSETS: { async fetch() { throw new Error('绑定不可用'); } },
  };
  const res = await worker.fetch(req('/api/meta'), env, {});
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.lexiconSize, 0);
  assert.equal(body.name, '青词天路 · 四级全卷修仙');
});

test('worker：缺少 APP_VERSION 时回退默认版本号', async () => {
  const env = { START_MS: Date.now(), ASSETS: makeEnv().ASSETS };
  delete env.APP_VERSION;
  const res = await worker.fetch(req('/api/meta'), env, {});
  const body = await res.json();
  assert.equal(body.version, '1.0.0');
});

test('worker：缺少 START_MS 时 uptime 不为 NaN', async () => {
  const env = { APP_VERSION: '1.0.0', ASSETS: makeEnv().ASSETS };
  const res = await worker.fetch(req('/healthz'), env, {});
  const body = await res.json();
  assert.ok(Number.isFinite(body.uptimeSeconds), 'uptimeSeconds 应为有限数字');
});
