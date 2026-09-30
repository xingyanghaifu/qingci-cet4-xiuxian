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

function send(res, code, body, type) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
  res.writeHead(code, {
    'Content-Type': type || 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
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
    });
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
    });
  }

  if (p === '/' || p === '/index.html' || p === '/cet4-xiuxian.html') {
    const { file } = appFile();
    if (!fs.existsSync(file)) return send(res, 404, { error: 'not found' });
    const html = fs.readFileSync(file, 'utf8');
    return send(res, 200, html, 'text/html; charset=utf-8');
  }

  send(res, 404, { error: 'not found', path: p });
});

server.listen(PORT, HOST, () => {
  const { source } = appFile();
  console.log('✅ 服务已启动');
  console.log('   地址: http://' + HOST + ':' + PORT);
  console.log('   健康检查: http://' + HOST + ':' + PORT + '/healthz');
  console.log('   应用来源: ' + source);
  console.log('   版本: v' + pkg.version);
});
