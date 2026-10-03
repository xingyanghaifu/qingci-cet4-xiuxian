#!/usr/bin/env node
/**
 * 静态服务：托管构建产物与应用源文件，提供健康检查接口
 * 端点：
 *   GET /healthz  健康检查（JSON，含版本、词库条数、运行时长、内存）
 *   GET /api/meta 应用元信息
 *   GET /         应用页面（优先 dist 产物，回退源文件）
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import core from './src/core/utils.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4173;
const HOST = process.env.HOST || '127.0.0.1';
const START = Date.now();

// 备考模式取自核心配置，避免与 src/core/utils.js 各写一份而对不上
const EXAM_TYPES = Object.keys(core.EXAM_CONFIGS);
const EXAM_SOURCE_POLICY = '原创练习；只有核验再利用许可的公开材料才会标为公开题源';
const FEATURES = ['五类备考选择', '原创整套模拟与及格突破', '境界动态难度', '六种记忆题型', '斗法对战', '学情看板', '间隔重复', '离线可用'];

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

function appFile() {
  const dist = path.join(ROOT, 'dist', 'cet4-xiuxian.html');
  if (fs.existsSync(dist)) return { file: dist, source: 'dist' };
  return { file: path.join(ROOT, 'cet4-xiuxian.html'), source: 'source' };
}

/** 读取词库条数，用于健康检查自证数据完好（结果缓存，避免每次请求重读 464KB 文件） */
let _lexCache = null;
function lexiconCount() {
  if (_lexCache !== null) return _lexCache;
  try {
    const { file } = appFile();
    const html = fs.readFileSync(file, 'utf8');
    const m = html.match(/<script id="lexicon" type="application\/json">([\s\S]*?)<\/script>/);
    _lexCache = m ? JSON.parse(m[1]).length : 0;
  } catch (e) {
    _lexCache = 0;
  }
  return _lexCache;
}

/** 缓存压缩结果，键含内容指纹，避免不同内容互相覆盖（公网回源时显著降低首字节延迟） */
const gzipCache = new Map();
function gzipCached(key, payload) {
  const hit = gzipCache.get(key);
  if (hit && hit.src === payload) return hit;
  const raw = Buffer.from(payload, 'utf8');
  const gz = zlib.gzipSync(raw, { level: 9 });
  // 同时缓存 br（若客户端支持，体积更小）
  const br = typeof zlib.brotliCompressSync === 'function'
    ? zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } })
    : null;
  const entry = { src: payload, raw, gz, br };
  gzipCache.set(key, entry);
  return entry;
}

const ENTRY_SHA = (() => {
  try {
    const { file } = appFile();
    const html = fs.readFileSync(file, 'utf8');
    return crypto.createHash('sha256').update(html).digest('hex').slice(0, 16);
  } catch (e) { return 'unknown'; }
})();

function send(res, code, body, type, req, extra) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
  const ctype = type || 'application/json; charset=utf-8';
  const headers = {
    'Content-Type': ctype,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  if (extra) Object.assign(headers, extra);
  const ae = (req && req.headers['accept-encoding']) || '';
  const compressible = /^text\/|json|javascript|svg/.test(ctype) && Buffer.byteLength(payload) > 1024;
  if (compressible) {
    // 缓存键含内容哈希，避免不同响应互相覆盖
    const entry = gzipCached(code + '|' + ctype + '|' + payload.length + '|' + payload.slice(0, 64), payload);
    if (entry.br && /\bbr\b/.test(ae)) {
      headers['Content-Encoding'] = 'br';
      headers['Vary'] = 'Accept-Encoding';
      headers['Content-Length'] = entry.br.length;
      res.writeHead(code, headers);
      return res.end(entry.br);
    }
    if (/\bgzip\b/.test(ae)) {
      headers['Content-Encoding'] = 'gzip';
      headers['Vary'] = 'Accept-Encoding';
      headers['Content-Length'] = entry.gz.length;
      res.writeHead(code, headers);
      return res.end(entry.gz);
    }
  }
  headers['Content-Length'] = Buffer.byteLength(payload);
  res.writeHead(code, headers);
  res.end(payload);
}

/**
 * 专用入口页下发：在压缩之前先判定 ETag 协商缓存。
 * 修复点：早先版本在压缩分支内提前 return，导致 ETag 头被丢弃，
 * 浏览器无法命中 304，每次访问都要回源传输 464KB 正文（公网约 2.5s）。
 */
function sendEntry(res, req, html, etag) {
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag, 'Cache-Control': 'public, max-age=300' });
    return res.end();
  }
  return send(res, 200, html, 'text/html; charset=utf-8', req, {
    ETag: etag,
    'Cache-Control': 'public, max-age=300, stale-while-revalidate=86400',
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || HOST));
  const p = url.pathname;

  if (p === '/healthz' || p === '/health') {
    const words = lexiconCount();
    const healthy = words > 0;
    return send(res, healthy ? 200 : 503, {
      status: healthy ? 'ok' : 'degraded',
      version: pkg.version,
      uptimeSeconds: Math.round((Date.now() - START) / 1000),
      checks: {
        lexicon: { ok: words > 0, count: words, expected: 4540 },
        build: { ok: fs.existsSync(path.join(ROOT, 'dist', 'cet4-xiuxian.html')), artifact: 'dist/cet4-xiuxian.html' },
      },
      runtime: { node: process.version, platform: os.platform() },
      timestamp: new Date().toISOString(),
    }, req);
  }

  if (p === '/api/meta') {
    const { source } = appFile();
    return send(res, 200, {
      name: '青词天路 · 四级全卷修仙',
      version: pkg.version,
      lexiconSize: lexiconCount(),
      memoryKinds: ['zh2en', 'en2zh', 'similar', 'listen', 'spell', 'pos'],
      examTypes: EXAM_TYPES,
      features: FEATURES,
      examSourcePolicy: EXAM_SOURCE_POLICY,
      servedFrom: source,
    }, req);
  }

  if (p === '/' || p === '/index.html' || p === '/cet4-xiuxian.html') {
    const { file } = appFile();
    if (!fs.existsSync(file)) return send(res, 404, { error: 'not found' });
    const etag = '"' + ENTRY_SHA + '"';
    const html = fs.readFileSync(file, 'utf8');
    return sendEntry(res, req, html, etag);
  }

  if (p === '/status') {
    const words = lexiconCount();
    const uptime = Math.round((Date.now() - START) / 1000);
    const html = '<!DOCTYPE html><html lang="zh-CN"><meta charset="utf-8">'
      + '<meta name="viewport" content="width=device-width,initial-scale=1">'
      + '<title>青词天路 · 服务状态</title>'
      + '<style>body{font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;background:#12100e;color:#f6ecdf;margin:0;padding:32px}'
      + '.card{max-width:560px;margin:auto;background:#211b16;border:1px solid #3c3229;border-radius:16px;padding:24px}'
      + 'h1{margin:0 0 4px;font-size:22px}.ok{color:#8ed8bd;font-weight:700}'
      + 'table{width:100%;border-collapse:collapse;margin-top:16px;font-size:14px}'
      + 'td{padding:8px 0;border-bottom:1px solid #3c3229}td:last-child{text-align:right;color:#8ed8bd}'
      + 'a{color:#efc98a}</style><div class="card"><h1>青词天路 · 服务状态</h1>'
      + '<p class="ok">● 运行中</p><table>'
      + '<tr><td>版本</td><td>v' + pkg.version + '</td></tr>'
      + '<tr><td>词库条数</td><td>' + words + ' 条</td></tr>'
      + '<tr><td>已运行</td><td>' + uptime + ' 秒</td></tr>'
      + '<tr><td>构建指纹</td><td>' + ENTRY_SHA + '</td></tr>'
      + '<tr><td>健康检查</td><td><a href="/healthz">/healthz</a></td></tr>'
      + '<tr><td>应用入口</td><td><a href="/">进入应用 →</a></td></tr>'
      + '</table></div></html>';
    return send(res, 200, html, 'text/html; charset=utf-8', req);
  }

  // PWA 静态资源：manifest / sw.js / 图标（由构建产出到 dist/）
  // Service Worker 必须在 http(s) 且与页面同源同路径下才能注册，本地预览也走这里。
  const PWA_STATIC = {
    '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json; charset=utf-8', 'no-cache'],
    '/sw.js': ['sw.js', 'application/javascript; charset=utf-8', 'no-cache'],
  };
  if (PWA_STATIC[p]) {
    const [name, type, cache] = PWA_STATIC[p];
    const file = path.join(ROOT, 'dist', name);
    if (!fs.existsSync(file)) return send(res, 404, { error: 'not found', hint: '先执行 npm run build' });
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' });
    return res.end(fs.readFileSync(file));
  }
  if (p.startsWith('/icons/') && /^\/icons\/[a-z0-9-]+\.png$/.test(p)) {
    const file = path.join(ROOT, 'dist', p.replace(/^\//, ''));
    if (!fs.existsSync(file)) return send(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=604800, immutable' });
    return res.end(fs.readFileSync(file));
  }

  send(res, 404, { error: 'not found', path: p });
});

server.listen(PORT, HOST, () => {
  const { source } = appFile();
  // 预热：提前压缩好页面与健康检查响应，消除公网首次请求的冷启动耗时
  try {
    const { file } = appFile();
    const warmHtml = fs.readFileSync(file, 'utf8');
    const entry = gzipCached(200 + '|text/html; charset=utf-8|' + warmHtml.length + '|' + warmHtml.slice(0, 64), warmHtml);
    console.log('   预热: 页面已压缩入缓存 (gzip ' + (entry.gz.length / 1024).toFixed(0) + ' KB'
      + (entry.br ? ' / br ' + (entry.br.length / 1024).toFixed(0) + ' KB' : '') + ')');
  } catch (e) { console.log('   预热跳过:', e.message); }
  console.log('✅ 服务已启动');
  console.log('   地址: http://' + HOST + ':' + PORT);
  console.log('   健康检查: http://' + HOST + ':' + PORT + '/healthz');
  console.log('   应用来源: ' + source);
  console.log('   版本: v' + pkg.version);
});
