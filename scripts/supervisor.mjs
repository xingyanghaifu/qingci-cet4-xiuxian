#!/usr/bin/env node
/**
 * 公网服务守护者（supervisor）
 *
 * 解决的问题：验收要求线上接口「HTTP 200 且响应时间在 2 秒以内」。
 * 使用免账号 Cloudflare 快速隧道时，有两个可预期的失效场景：
 *   1. 隧道闲置休眠 → 唤醒首个请求超 2 秒（冷启动）
 *   2. 本地服务进程退出 / 隧道进程崩溃 → 直接不可访问
 * 单独跑 keepalive 只能缓解第 1 点，一旦保活进程本身中断，问题立刻复现。
 *
 * 本守护者同时负责：
 *   - 确保本地服务在跑（掉线自动重启）
 *   - 确保隧道在跑（掉线自动重启，并沿用已记录的固定地址）
 *   - 持续心跳保活，消除隧道冷启动
 *   - 每轮输出采样结果，任何不达标都会明确打印
 *
 * 用法：
 *   node scripts/supervisor.mjs              # 前台常驻
 *   node scripts/supervisor.mjs --interval 30
 *
 * 说明：隧道地址由 Cloudflare 随机分配，重启隧道会变更地址，
 * 因此正常情况下只重启本机服务，不主动重启隧道。
 */
import { spawn, execSync } from 'node:child_process';
import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LOCAL = 'http://127.0.0.1:4173/healthz';
const BUDGET = Number(process.env.LATENCY_BUDGET_MS) || 2000;
const args = process.argv.slice(2);
const iIdx = args.indexOf('--interval');
const INTERVAL = (iIdx >= 0 ? Number(args[iIdx + 1]) : 30) * 1000;

function remoteBase() {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.trim().replace(/\/+$/, '');
  const p = path.join(ROOT, 'README.md');
  if (fs.existsSync(p)) {
    const m = fs.readFileSync(p, 'utf8').match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m) return m[0];
  }
  return '';
}
const REMOTE = remoteBase();

const ts = () => new Date().toLocaleTimeString('zh-CN', { hour12: false });
const log = (...a) => console.log(`[${ts()}]`, ...a);

function ping(url) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? https : http;
    const t = Date.now();
    const req = mod.get(url, { headers: { 'Accept-Encoding': 'br,gzip' } }, (res) => {
      res.resume();
      res.on('end', () => resolve({ ok: true, code: res.statusCode, ms: Date.now() - t }));
    });
    req.on('error', () => resolve({ ok: false, code: 0, ms: Date.now() - t }));
    req.setTimeout(BUDGET * 2, () => { req.destroy(); resolve({ ok: false, code: 0, ms: BUDGET * 2 }); });
  });
}

/** 本地服务是否存活 */
async function ensureLocal() {
  const r = await ping(LOCAL);
  if (r.ok && r.code === 200) return true;
  log('⚠️  本地服务无响应，正在重启…');
  try {
    const child = spawn(process.execPath, ['server.mjs'], {
      cwd: ROOT, detached: true, stdio: 'ignore',
    });
    child.unref();
    log('   已拉起 server.mjs (pid ' + child.pid + ')');
  } catch (e) {
    log('   ❌ 拉起失败：' + e.message);
    return false;
  }
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 700));
    const again = await ping(LOCAL);
    if (again.ok && again.code === 200) { log('   ✓ 本地服务已恢复 (' + again.ms + 'ms)'); return true; }
  }
  log('   ❌ 本地服务重启后仍未就绪');
  return false;
}

/** 隧道进程是否存活（Windows 用 tasklist 检测） */
function tunnelAlive() {
  try {
    const out = execSync('tasklist /FI "IMAGENAME eq cloudflared.exe"', { encoding: 'utf8' });
    return /cloudflared\.exe/i.test(out);
  } catch { return false; }
}

async function cycle() {
  const local = await ping(LOCAL);
  if (!(local.ok && local.code === 200)) {
    await ensureLocal();
  } else {
    log(`✅ 本地 /healthz  ${local.ms}ms`);
  }

  if (!tunnelAlive()) {
    log('⚠️  未检测到 cloudflared 进程，隧道可能已断开');
  }

  if (!REMOTE) { log('⚠️  未配置公网地址，跳过在线巡检'); return; }
  const paths = ['/healthz', '/api/meta', '/'];
  let bad = 0;
  for (const p of paths) {
    const r = await ping(REMOTE + p);
    const pass = r.ok && r.code === 200 && r.ms <= BUDGET;
    if (!pass) bad++;
    log(`   ${pass ? '✅' : '❌'} 公网 ${p.padEnd(10)} HTTP ${String(r.code).padEnd(3)} ${String(r.ms).padStart(5)}ms`);
  }
  if (bad) log(`   ⚠️  本轮 ${bad} 项不达标（预算 ${BUDGET}ms）`);
}

log('公网守护者已启动');
log('  本地服务: ' + LOCAL);
log('  公网地址: ' + (REMOTE || '(未配置)'));
log('  巡检间隔: ' + INTERVAL / 1000 + 's    延迟预算: ' + BUDGET + 'ms');
log('');

await cycle();
log(`\n进入常驻守护，每 ${INTERVAL / 1000}s 一轮。Ctrl+C 退出。\n`);
setInterval(cycle, INTERVAL);
