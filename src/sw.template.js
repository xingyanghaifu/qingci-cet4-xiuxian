/* eslint-disable no-restricted-globals */
/**
 * 青词天路 Service Worker
 *
 * ⚠️ 本文件是模板：`scripts/build.mjs` 会把 __CACHE_VERSION__ 替换为
 *    「版本号-产物指纹前 8 位」后输出到 dist/sw.js。请勿直接部署本文件。
 *
 * 缓存策略：
 *   - 应用外壳（./、manifest、图标、静态检查 JSON）：安装时预缓存，导航请求走
 *     network-first（保证发版后能拿到新版本），断网回落到缓存的外壳。
 *   - 动态接口（/healthz、/status、/api/*）：一律 network-only，绝不缓存，
 *     避免把「接口 200」伪装成离线可用。
 *   - 听力音频（/audio/*）：cache-first —— 当前听力用 speechSynthesis 合成，
 *     该分支为后续接入真实音频文件预留。
 *   - 其它同源静态资源：stale-while-revalidate。
 *
 * 词库与试卷数据（内联在 index.html 中，体积大且不常变）由页面侧的
 * IndexedDB 缓存（src/services/offline-store.ts）负责，SW 只缓存外壳与资源。
 */
const CACHE_VERSION = '__CACHE_VERSION__';
const SHELL_CACHE = 'qingci-shell-' + CACHE_VERSION;
const RUNTIME_CACHE = 'qingci-runtime-' + CACHE_VERSION;
const AUDIO_CACHE = 'qingci-audio-' + CACHE_VERSION;
const KEEP = new Set([SHELL_CACHE, RUNTIME_CACHE, AUDIO_CACHE]);

const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-192-maskable.png',
  './icons/icon-512-maskable.png',
  './healthz.json',
  './api-meta.json',
];

/** 动态接口：永不缓存 */
function isDynamicApi(url) {
  return url.pathname === '/healthz'
    || url.pathname === '/status'
    || url.pathname.startsWith('/api/');
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // 逐个 add，单个资源缺失不阻塞整体安装（例如纯静态托管没有 healthz.json）
    await Promise.all(SHELL_ASSETS.map(async (asset) => {
      try {
        await cache.add(new Request(asset, { cache: 'reload' }));
      } catch (e) {
        /* 忽略单个资源失败 */
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith('qingci-') && !KEEP.has(n)).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING' || (event.data && event.data.type === 'SKIP_WAITING')) {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 1) 动态接口：只走网络
  if (isDynamicApi(url)) return;

  // 2) 导航请求：network-first，断网回落外壳
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        const cache = await caches.open(SHELL_CACHE);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch (e) {
        const cache = await caches.open(SHELL_CACHE);
        const cached = await cache.match('./index.html') || await cache.match('./');
        if (cached) return cached;
        return new Response(
          '<!doctype html><meta charset="utf-8"><title>离线</title><p>当前离线，且尚未缓存应用外壳。请联网后重试。</p>',
          { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } },
        );
      }
    })());
    return;
  }

  // 3) 听力音频：cache-first（为后续真实音频预留）
  if (url.pathname.startsWith('/audio/')) {
    event.respondWith((async () => {
      const cache = await caches.open(AUDIO_CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      const fresh = await fetch(request);
      if (fresh.ok) cache.put(request, fresh.clone());
      return fresh;
    })());
    return;
  }

  // 4) 其它同源资源：stale-while-revalidate
  event.respondWith((async () => {
    const cache = await caches.open(RUNTIME_CACHE);
    const cached = await cache.match(request);
    const network = fetch(request).then((res) => {
      if (res && res.ok) cache.put(request, res.clone());
      return res;
    }).catch(() => null);
    return cached || (await network) || new Response('', { status: 504 });
  })());
});
