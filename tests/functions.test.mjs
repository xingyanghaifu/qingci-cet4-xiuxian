/**
 * Pages Functions 单元测试
 *
 * 用最小化的 ASSETS 桩模拟静态资源绑定，验证 Pages 侧三个端点的响应契约：
 * /healthz（JSON 健康检查）· /status（人类可读状态页）· /api/meta（元信息）
 * 重点防回归：/status 若丢失 Function 会走 SPA 回退返回应用页，监控会误判为正常。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet as healthz } from '../functions/healthz.js';
import { onRequestGet as status } from '../functions/status.js';
import { onRequestGet as meta } from '../functions/api/meta.js';

const HEALTHZ_JSON = {
  status: 'ok',
  version: '1.3.1',
  checks: { lexicon: { ok: true, count: 4540, expected: 4540 } },
  artifact: { file: 'index.html', sha256: 'deadbeefdeadbeef', bytes: 480690 },
};

/**
 * 构造最小 Pages 上下文
 * mode: ok 命中 healthz.json ｜ missing 静态元数据 404 ｜ throws 绑定直接抛异常
 * version: 传入 null 可模拟未配置 APP_VERSION
 */
function ctx({ mode = 'ok', version = '1.3.1', cf } = {}) {
  const request = new Request('https://qingci-cet4-xiuxian.pages.dev/status', { headers: { accept: '*/*' } });
  if (cf) request.cf = cf;
  return {
    request,
    env: {
      APP_VERSION: version === null ? undefined : version,
      ASSETS: {
        fetch: async () => {
          if (mode === 'throws') throw new Error('ASSETS binding unavailable');
          if (mode === 'missing') return new Response('not found', { status: 404 });
          return new Response(JSON.stringify(HEALTHZ_JSON), { headers: { 'content-type': 'application/json' } });
        },
      },
    },
  };
}

test('functions：/status 返回人类可读状态页，而非 SPA 回退的应用页', async () => {
  const res = await status(ctx({ cf: { colo: 'SEA' } }));
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  const html = await res.text();
  assert.match(html, /服务状态/);
  assert.match(html, /Cloudflare Pages/);
  assert.match(html, /v1\.3\.1/);
  assert.match(html, /4540 条/);
  assert.match(html, /SEA/);
  assert.ok(!html.includes('<script id="lexicon"'), '状态页不应返回应用页面');
});

test('functions：/status 在 ASSETS 抛异常时仍返回 200（词库降级为 0 条）', async () => {
  const res = await status(ctx({ mode: 'throws', version: null }));
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /0 条/);
  assert.match(html, /unknown/, '缺少 cf.colo 时回退为 unknown');
  assert.match(html, /v1\.3\.1/, '缺少 APP_VERSION 时回退默认版本号');
});

test('functions：/healthz 命中静态元数据时返回 200 与词库条数', async () => {
  const res = await healthz(ctx());
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.version, '1.3.1');
  assert.equal(body.platform, 'cloudflare-pages');
  assert.equal(body.checks.lexicon.count, 4540);
  assert.equal(body.checks.staticAsset.ok, true);
});

test('functions：/healthz 在静态元数据缺失时降级为 503（不崩溃）', async () => {
  const res = await healthz(ctx({ mode: 'missing' }));
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.status, 'degraded');
  assert.equal(body.checks.lexicon.ok, false);
});

test('functions：/healthz 在 ASSETS 抛异常时仍返回 503 而非崩溃', async () => {
  const res = await healthz(ctx({ mode: 'throws' }));
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.status, 'degraded');
  assert.equal(body.checks.staticAsset.ok, false);
});

test('functions：/api/meta 返回五类备考模式与题源治理边界', async () => {
  const res = await meta(ctx());
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.version, '1.3.1');
  assert.equal(body.platform, 'cloudflare-pages');
  assert.deepEqual(body.examTypes, ['junior', 'senior', 'pets3', 'cet4', 'cet6']);
  assert.match(body.examSourcePolicy, /原创/);
});

test('functions：/api/meta 在缺少 APP_VERSION 时回退默认版本号', async () => {
  const res = await meta(ctx({ version: null }));
  const body = await res.json();
  assert.equal(body.version, '1.3.1');
});
