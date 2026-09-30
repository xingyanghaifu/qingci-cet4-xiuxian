/**
 * 青词天路 · 四级全卷修仙 —— Cloudflare Worker 部署入口
 *
 * 与 server.mjs 提供等价的接口，跑在 Cloudflare 全球边缘网络：
 *   GET /           应用页面（单文件 HTML）
 *   GET /healthz    健康检查（JSON，含版本、词库条数、缓存状态）
 *   GET /api/meta   应用元信息
 *   GET /status     人类可读状态页
 *
 * 地址固定不变：部署后为 https://<worker名>.<子域>.workers.dev
 */

const APP_NAME = '青词天路 · 四级全卷修仙';
const MEMORY_KINDS = ['zh2en', 'en2zh', 'similar', 'listen', 'spell', 'pos'];
const EXPECTED_LEXICON = 4540;

/** 从 HTML 中提取词库条数，用于健康检查自证数据完好 */
function lexiconCount(html) {
  if (!html) return 0;
  const m = html.match(/<script id="lexicon" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return 0;
  try {
    return JSON.parse(m[1]).length;
  } catch (e) {
    return 0;
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function statusPage(version, words, startMs) {
  const uptime = Math.round((Date.now() - startMs) / 1000);
  const html = `<!DOCTYPE html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${APP_NAME} · 服务状态</title>
<style>body{font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;background:#12100e;color:#f6ecdf;margin:0;padding:32px}
.card{max-width:560px;margin:auto;background:#211b16;border:1px solid #3c3229;border-radius:16px;padding:24px}
h1{margin:0 0 4px;font-size:22px}.ok{color:#8ed8bd;font-weight:700}
table{width:100%;border-collapse:collapse;margin-top:16px;font-size:14px}
td{padding:8px 0;border-bottom:1px solid #3c3229}td:last-child{text-align:right;color:#8ed8bd}
a{color:#efc98a}</style><div class="card"><h1>${APP_NAME} · 服务状态</h1>
<p class="ok">● 运行中（Cloudflare Workers 边缘节点）</p><table>
<tr><td>版本</td><td>v${version}</td></tr>
<tr><td>词库条数</td><td>${words} 条</td></tr>
<tr><td>实例已运行</td><td>${uptime} 秒</td></tr>
<tr><td>运行环境</td><td>Cloudflare Edge</td></tr>
<tr><td>健康检查</td><td><a href="/healthz">/healthz</a></td></tr>
<tr><td>元信息</td><td><a href="/api/meta">/api/meta</a></td></tr>
<tr><td>应用入口</td><td><a href="/">进入应用 →</a></td></tr>
</table></div></html>`;
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname;
    const version = (env && env.APP_VERSION) || '1.0.0';
    const startMs = Number((env && env.START_MS) || 0) || Date.now();

    // 健康检查
    if (p === '/healthz' || p === '/health') {
      let words = 0;
      let assetOk = false;
      try {
        const assetUrl = new URL('/index.html', url.origin);
        const res = await env.ASSETS.fetch(new Request(assetUrl, { headers: request.headers }));
        assetOk = res.ok;
        if (res.ok) words = lexiconCount(await res.text());
      } catch (e) {
        assetOk = false;
      }
      const healthy = words > 0;
      return json({
        status: healthy ? 'ok' : 'degraded',
        version,
        uptimeSeconds: Math.round((Date.now() - startMs) / 1000),
        checks: {
          lexicon: { ok: words > 0, count: words, expected: EXPECTED_LEXICON },
          assets: { ok: assetOk, artifact: 'index.html' },
        },
        runtime: { platform: 'cloudflare-workers', colo: (request.cf && request.cf.colo) || 'unknown' },
        timestamp: new Date().toISOString(),
      }, healthy ? 200 : 503);
    }

    // 元信息
    if (p === '/api/meta') {
      let words = 0;
      try {
        const res = await env.ASSETS.fetch(new Request(new URL('/index.html', url.origin), { headers: request.headers }));
        if (res.ok) words = lexiconCount(await res.text());
      } catch (e) { /* 忽略，返回 0 */ }
      return json({
        name: APP_NAME,
        version,
        lexiconSize: words,
        memoryKinds: MEMORY_KINDS,
        features: ['六种记忆题型', '试卷模拟', '斗法对战', '学情看板', '间隔重复', '离线可用'],
        servedFrom: 'cloudflare-edge',
      });
    }

    // 状态页
    if (p === '/status') {
      return statusPage(version, 0, startMs);
    }

    // 其余请求交给静态资源（/ 会命中 index.html）
    return env.ASSETS.fetch(request);
  },
};
