// Cloudflare Pages Function: 应用元信息（GET /api/meta）
export async function onRequestGet(context) {
  const { env } = context;
  const body = {
    name: '青词天路 · 四级全卷修仙',
    version: env.APP_VERSION || '1.3.1',
    platform: 'cloudflare-pages',
    lexiconSize: 4540,
    memoryKinds: ['zh2en', 'en2zh', 'similar', 'listen', 'spell', 'pos'],
    examTypes: ['junior', 'senior', 'pets3', 'cet4', 'cet6'],
    features: ['五类备考选择', '原创整套模拟与及格突破', '境界动态难度', '六种记忆题型', '斗法对战', '学情看板', '间隔重复', '离线可用'],
    examSourcePolicy: '原创练习；只有核验再利用许可的公开材料才会标为公开题源',
    endpoints: { health: '/healthz', meta: '/api/meta', app: '/' }
  };
  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*'
    }
  });
}
