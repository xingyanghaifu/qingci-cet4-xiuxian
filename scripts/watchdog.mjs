#!/usr/bin/env node
/**
 * 公网在线性看门狗（keep-alive watchdog）
 *
 * 背景：cloudflared 免费隧道在闲置后会休眠，恢复首个请求的冷启动可能超过 2 秒验收线。
 * 本脚本周期性心跳保活，并记录每次采样的耗时分布；一旦发现地址失效或持续超时，
 * 会明确报错退出（非 0），便于 CI / 定时任务告警，而不是静默失败。
 *
 * 用法：
 *   node scripts/watchdog.mjs                    # 单次巡检
 *   node scripts/watchdog.mjs --loop             # 常驻保活（默认 60s 间隔）
 *   node scripts/watchdog.mjs --loop --interval 30
 *   PUBLIC_BASE_URL=https://xxx node scripts/watchdog.mjs
 *
 * 退出码：0 = 全部达标；1 = 存在不达标项。
 */
import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const THRESHOLD_MS = Number(process.env.LATENCY_BUDGET_MS) || 2000;

function readBaseUrl() {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.trim().replace(/\/+$/, '');
  const readmePath = path.join(ROOT, 'README.md');
  if (fs.existsSync(readmePath)) {
    const m = fs.readFileSync(readmePath, 'utf8').match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m) return m[0];
  }
  return '';
}

const BASE = readBaseUrl();
const PATHS = ['/healthz', '/api/meta', '/'];

function probe(url) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? https : http;
    const started = Date.now();
    const req = mod.get(url, { headers: { 'Accept-Encoding': 'br,gzip' } }, (res) => {
      res.resume();
      res.on('end', () => resolve({ code: res.statusCode, ms: Date.now() - started }));
    });
    req.on('error', (e) => resolve({ code: 0, ms: Date.now() - started, err: e.message }));
    req.setTimeout(THRESHOLD_MS * 3, () => { req.destroy(); resolve({ code: 0, ms: THRESHOLD_MS * 3, err: 'timeout' }); });
  });
}

async function round(label) {
  if (!BASE) {
    console.error('❌ 未找到公网地址：请在 README.md 记录地址或设置 PUBLIC_BASE_URL');
    process.exitCode = 1;
    return [];
  }
  const rows = [];
  for (const p of PATHS) {
    const r = await probe(BASE + p);
    const ok = r.code === 200 && r.ms <= THRESHOLD_MS;
    rows.push({ path: p, ...r, ok });
    const badge = ok ? '✅' : '❌';
    console.log(`[${label}] ${badge} ${p.padEnd(10)} HTTP ${String(r.code).padEnd(3)} ${String(r.ms).padStart(5)}ms`
      + (r.err ? ` (${r.err})` : ''));
    if (!ok) process.exitCode = 1;
  }
  return rows;
}

const args = process.argv.slice(2);
const loop = args.includes('--loop');
const intervalIdx = args.indexOf('--interval');
const interval = intervalIdx >= 0 ? Number(args[intervalIdx + 1]) * 1000 : 60000;

console.log('公网看门狗 · 目标 ' + (BASE || '(未配置)') + ' · 延迟预算 ' + THRESHOLD_MS + 'ms');
console.log('');

if (!loop) {
  await round('巡检');
  console.log('');
  console.log(process.exitCode ? '结果：存在不达标项' : '结果：全部达标');
} else {
  const stamp = () => new Date().toLocaleTimeString('zh-CN', { hour12: false });
  await round(stamp());
  console.log(`\n保活模式已开启，每 ${interval / 1000}s 心跳一次。Ctrl+C 退出。\n`);
  setInterval(async () => {
    const rows = await round(stamp());
    const bad = rows.filter((r) => !r.ok).length;
    if (bad) console.log(`  ⚠️  本轮 ${bad} 项不达标，请检查隧道与本地服务`);
  }, interval);
}
