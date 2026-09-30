#!/usr/bin/env node
/**
 * 健康检查脚本：真实请求 /healthz 与 /api/meta，校验状态码与响应时间
 * 退出码 0 表示全部通过，1 表示有问题（可用于 CI）
 */
import http from 'node:http';

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT) || 4173;
const LIMIT_MS = 2000;

function probe(path) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const req = http.get({ host: HOST, port: PORT, path, timeout: LIMIT_MS + 2000 }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ path, status: res.statusCode, ms: Date.now() - t0, body }));
    });
    req.on('error', (e) => resolve({ path, status: 0, ms: Date.now() - t0, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ path, status: 0, ms: Date.now() - t0, error: 'timeout' }); });
  });
}

const targets = ['/healthz', '/api/meta', '/'];
let failed = 0;

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

console.log('');
if (failed) { console.log('❌ 健康检查未通过（失败 ' + failed + ' 项）'); process.exit(1); }
console.log('✅ 健康检查全部通过（阈值 <' + LIMIT_MS + 'ms）');
