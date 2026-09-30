#!/usr/bin/env node
/**
 * 健康检查脚本：真实请求 /healthz 与 /api/meta，校验状态码与响应时间
 * 退出码 0 表示全部通过，1 表示有问题（可用于 CI）
 *
 * 若目标服务未在运行，脚本会自动拉起本地 server.mjs 并在结束后关闭，
 * 使 `npm run verify` 在全新环境中无需手动先启动服务即可通过。
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT) || 4173;
const LIMIT_MS = 2000;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function probe(pathname, headers) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const req = http.get({ host: HOST, port: PORT, path: pathname, headers, timeout: LIMIT_MS + 2000 }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({
        path: pathname, status: res.statusCode, ms: Date.now() - t0, body,
        headers: Object.entries(res.headers).map(([k, v]) => k + ': ' + v).join('\n'),
      }));
    });
    req.on('error', (e) => resolve({ path: pathname, status: 0, ms: Date.now() - t0, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ path: pathname, status: 0, ms: Date.now() - t0, error: 'timeout' }); });
  });
}

// —— 确保服务可用：未运行则自动拉起 ——
let spawned = null;
const preflight = await probe('/healthz');
if (preflight.status !== 200) {
  console.log('ℹ️  本地服务未运行，自动启动 server.mjs …');
  spawned = spawn(process.execPath, [path.join(ROOT, 'server.mjs')], {
    cwd: ROOT, stdio: 'ignore', detached: false,
  });
  spawned.on('error', () => {});
  let up = false;
  for (let i = 0; i < 30 && !up; i++) {
    await new Promise((r) => setTimeout(r, 300));
    const r = await probe('/healthz');
    up = r.status === 200;
  }
  if (!up) {
    console.log('❌ 无法启动本地服务，健康检查终止');
    try { spawned.kill(); } catch {}
    process.exit(1);
  }
  console.log('✅ 本地服务已就绪 (pid ' + spawned.pid + ')');
}

const targets = ['/healthz', '/api/meta', '/status', '/'];
let failed = 0;

// 额外校验：入口页应带 ETag 并支持压缩协商
const etagProbe = await probe('/', { 'Accept-Encoding': 'br,gzip', 'If-None-Match': 'nonexistent' });
if (etagProbe.status === 200) {
  const hasEtag = /etag/i.test(etagProbe.headers || '');
  console.log((hasEtag ? '✅' : '⚠️ ') + ' / 入口页 ETag=' + (hasEtag ? '已下发' : '缺失') + '  压缩协商=' + ((etagProbe.headers || '').match(/content-encoding/i) ? '已启用' : '未启用'));
}

for (const t of targets) {
  const r = await probe(t);
  const statusOk = r.status === 200;
  const timeOk = r.ms < LIMIT_MS;
  const ok = statusOk && timeOk && !r.error;
  if (!ok) failed++;
  console.log((ok ? '✅' : '❌') + ' ' + t + '  状态=' + r.status + '  耗时=' + r.ms + 'ms' + (r.error ? '  错误=' + r.error : ''));
  if (t === '/healthz' && r.status === 200) {
    try {
      const j = JSON.parse(r.body);
      console.log('     版本=' + j.version + '  词库=' + j.checks.lexicon.count + ' 条  状态=' + j.status);
      if (j.checks.lexicon.count !== 4540) { console.log('     ❌ 词库条数不符'); failed++; }
    } catch (e) { console.log('     ❌ 健康检查返回非法 JSON'); failed++; }
  }
}

// 收尾：若服务由本脚本拉起，检查完毕后关闭，避免占用端口
if (spawned) {
  try { spawned.kill(); } catch {}
  console.log('ℹ️  已关闭本次自动启动的服务');
}

console.log('');
if (failed) { console.log('❌ 健康检查未通过（失败 ' + failed + ' 项）'); process.exit(1); }
console.log('✅ 健康检查全部通过（阈值 <' + LIMIT_MS + 'ms）');
