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
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4173;
const HOST = process.env.HOST || '127.0.0.1';
const START = Date.now();

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

function appFile() {
  const dist = path.join(ROOT, 'dist', 'cet4-xiuxian.html');
  if (fs.existsSync(dist)) return { file: dist, source: 'dist' };
  return { file: path.join(ROOT, 'cet4-xiuxian.html'), source: 'source' };
}

/** 读取词库条数，用于健康检查自证数据完好 */
function lexiconCount() {
  try {
    const { file } = appFile();
    const html = fs.readFileSync(file, 'utf8');
    const m = html.match(/<script id="lexicon" type="application\/json">([\s\S]*?)<\/script>/);
    if (!m) return 0;
    return JSON.parse(m[1]).length;
  } catch (e) {
    return 0;
  }
}

/** 缓存压缩结果，避免每次请求重复计算（公网回源时显著降低首字节延迟） */
const gzipCache = new Map();
function gzipCached(key, payload) {
  const hit = gzipCache.get(key);
  if (hit && hit.src === payload) return hit.buf;
  const buf = zlib.gzipSync(Buffer.from(payload, 'utf8'), { level: 6 });
  gzipCache.set(key, { src: payload, buf });
  return buf;
}

function send(res, code, body, type, req) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
  const headers = {
    'Content-Type': type || 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  };
  // 对文本响应做 gzip，显著降低公网传输体积（475 KB 页面可压到约 145 KB）
  const ae = (req && req.headers['accept-encoding']) || '';
  const compressible = /^text\/|json|javascript|svg/.test(headers['Content-Type']) && payload.length > 1024;
  if (compressible && /\bgzip\b/.test(ae)) {
    const buf = gzipCached(keyOf(headers['Content-Type'], code), payload);
    headers['Content-Encoding'] = 'gzip';
    headers['Vary'] = 'Accept-Encoding';
    headers['Content-Length'] = buf.length;
    res.writeHead(code, headers);
    return res.end(buf);
  }
  headers['Content-Length'] = Buffer.byteLength(payload);
  res.writeHead(code, headers);
  res.end(payload);
}
function keyOf(type, code) { return code + '|' + type; }

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
      features: ['六种记忆题型', '试卷模拟', '斗法对战', '学情看板', '间隔重复', '离线可用'],
      servedFrom: source,
    }, req);
  }

  if (p === '/' || p === '/index.html' || p === '/cet4-xiuxian.html') {
    const { file } = appFile();
    if (!fs.existsSync(file)) return send(res, 404, { error: 'not found' });
    const html = fs.readFileSync(file, 'utf8');
    return send(res, 200, html, 'text/html; charset=utf-8', req);
  }

  send(res, 404, { error: 'not found', path: p });
});

server.listen(PORT, HOST, () => {
  const { source } = appFile();
  // 预热：提前压缩好页面与健康检查响应，消除公网首次请求的冷启动耗时
  try {
    const { file } = appFile();
    const warmHtml = fs.readFileSync(file, 'utf8');
    gzipCached(keyOf('text/html; charset=utf-8', 200), warmHtml);
    console.log('   预热: 页面已压缩入缓存 (' + (gzipCached(keyOf('text/html; charset=utf-8', 200), warmHtml).length / 1024).toFixed(0) + ' KB)');
  } catch (e) { console.log('   预热跳过:', e.message); }
  console.log('✅ 服务已启动');
  console.log('   地址: http://' + HOST + ':' + PORT);
  console.log('   健康检查: http://' + HOST + ':' + PORT + '/healthz');
  console.log('   应用来源: ' + source);
  console.log('   版本: v' + pkg.version);
});
