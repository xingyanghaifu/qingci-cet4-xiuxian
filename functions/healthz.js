// Cloudflare Pages Function: 动态健康检查（GET /healthz）
export async function onRequestGet(context) {
  const { request, env } = context;
  const t0 = Date.now();
  let lexiconCount = 0;
  let artifact = null;
  try {
    const assetRes = await env.ASSETS.fetch(new URL('/healthz.json', request.url));
    if (assetRes.ok) {
      const m = await assetRes.json();
      lexiconCount = (m && m.checks && m.checks.lexicon && m.checks.lexicon.count) || 0;
      artifact = (m && m.artifact) || null;
    }
  } catch (e) { /* 静态元数据缺失时降级为 degraded */ }
  const ok = lexiconCount > 0;
  const body = {
    status: ok ? 'ok' : 'degraded',
    version: env.APP_VERSION || '1.3.1',
    platform: 'cloudflare-pages',
    checks: {
      lexicon: { ok: ok, count: lexiconCount, expected: 4540 },
      staticAsset: { ok: !!artifact, artifact: 'index.html' }
    },
    runtime: {
      colo: (request.cf && request.cf.colo) || 'unknown',
      country: (request.cf && request.cf.country) || 'unknown'
    },
    latencyMs: Date.now() - t0,
    timestamp: new Date().toISOString()
  };
  return new Response(JSON.stringify(body, null, 2), {
    status: ok ? 200 : 503,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*'
    }
  });
}
