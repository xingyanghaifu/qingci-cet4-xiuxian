// Cloudflare Pages Function: 人类可读状态页（GET /status）
//
// 与 worker/index.mjs 的 /status 保持同一形态：纯内联样式、无外部资源，
// 便于在慢链路下快速确认服务是否可用。Pages 的 _routes.json 需包含 /status，
// 否则该路径会走 SPA 回退返回应用页面（HTTP 200 + HTML），看不出真实状态。
const APP_NAME = '青词天路 · 四级全卷修仙';

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export async function onRequestGet(context) {
  const { request, env } = context;
  let words = 0;
  try {
    const res = await env.ASSETS.fetch(new URL('/healthz.json', request.url));
    if (res.ok) {
      const m = await res.json();
      words = (m && m.checks && m.checks.lexicon && m.checks.lexicon.count) || 0;
    }
  } catch (e) { /* 静态元数据缺失时按 0 条展示，不影响状态页可用 */ }
  const version = esc((env && env.APP_VERSION) || '1.3.1');
  const colo = esc((request.cf && request.cf.colo) || 'unknown');
  const html = `<!DOCTYPE html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${APP_NAME} · 服务状态</title>
<style>body{font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;background:#12100e;color:#f6ecdf;margin:0;padding:32px}
.card{max-width:560px;margin:auto;background:#211b16;border:1px solid #3c3229;border-radius:16px;padding:24px}
h1{margin:0 0 4px;font-size:22px}.ok{color:#8ed8bd;font-weight:700}
table{width:100%;border-collapse:collapse;margin-top:16px;font-size:14px}
td{padding:8px 0;border-bottom:1px solid #3c3229}td:last-child{text-align:right;color:#8ed8bd}
a{color:#efc98a}</style><div class="card"><h1>${APP_NAME} · 服务状态</h1>
<p class="ok">● 运行中（Cloudflare Pages 边缘节点 ${colo}）</p><table>
<tr><td>版本</td><td>v${version}</td></tr>
<tr><td>词库条数</td><td>${words} 条</td></tr>
<tr><td>运行环境</td><td>Cloudflare Pages</td></tr>
<tr><td>健康检查</td><td><a href="/healthz">/healthz</a></td></tr>
<tr><td>元信息</td><td><a href="/api/meta">/api/meta</a></td></tr>
<tr><td>应用入口</td><td><a href="/">进入应用 →</a></td></tr>
</table></div></html>`;
  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    }
  });
}
