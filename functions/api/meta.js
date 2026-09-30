// Cloudflare Pages Function: 应用元信息（GET /api/meta）
export async function onRequestGet(context) {
  const { env } = context;
  const body = {
    name: '青词天路 · 四级全卷修仙',
    version: env.APP_VERSION || '1.1.0',
    platform: 'cloudflare-pages',
    lexiconSize: 4540,
    memoryKinds: ['zh2en', 'en2zh', 'similar', 'listen', 'spell', 'pos'],
    features: ['六种记忆题型', '试卷模拟', '斗法对战', '学情看板', '间隔重复', '离线可用'],
    endpoints: { health: '/healthz', meta: '/api/meta', app: '/' }
  };
  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*'
    }
  });
}
