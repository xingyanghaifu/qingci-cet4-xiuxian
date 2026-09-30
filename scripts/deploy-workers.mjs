#!/usr/bin/env node
/**
 * Cloudflare Workers 一键部署
 *
 * 流程：构建产物 → 生成 Workers 版部署目录 → 调 wrangler 上传 → 线上验收
 * 用法：npm run deploy
 *
 * 前置条件：本机已 `npx wrangler login` 登录 Cloudflare 账号。
 */
import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32', ...opts });
}

console.log('🚀 部署 青词天路 v' + pkg.version + ' 到 Cloudflare Workers\n');

// 1) 构建
console.log('[1/4] 构建产物');
run('node', ['scripts/build.mjs']);

// 2) 生成 Workers 版部署目录
console.log('\n[2/4] 生成部署目录（Workers 模式）');
run('node', ['scripts/prepare-deploy.mjs', '--workers']);

// 3) 同步版本号到 wrangler.toml
console.log('\n[3/4] 同步版本号到 wrangler.toml');
const tomlPath = path.join(ROOT, 'wrangler.toml');
let toml = fs.readFileSync(tomlPath, 'utf8');
toml = toml.replace(/APP_VERSION\s*=\s*"[^"]*"/, 'APP_VERSION = "' + pkg.version + '"');
fs.writeFileSync(tomlPath, toml);
console.log('   APP_VERSION = ' + pkg.version);

// 4) 部署
console.log('\n[4/4] 上传到 Cloudflare');
let deployOut = '';
try {
  deployOut = execSync('npx --yes wrangler@latest deploy', { cwd: ROOT, encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'] });
  process.stdout.write(deployOut);
} catch (e) {
  console.error('\n❌ 部署失败。若提示未登录，请先执行：npx wrangler login');
  process.exit(1);
}

// 从 wrangler 输出中提取正式地址并落盘，供验收脚本与文档引用
const urlMatch = deployOut.match(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev/i);
const deployedUrl = urlMatch ? urlMatch[0] : '';

if (deployedUrl) {
  fs.writeFileSync(path.join(ROOT, 'deploy-url.txt'), deployedUrl + '\n');
  console.log('\n✅ 部署完成');
  console.log('   应用入口: ' + deployedUrl + '/');
  console.log('   健康检查: ' + deployedUrl + '/healthz');
  console.log('   元信息:   ' + deployedUrl + '/api/meta');
  console.log('   状态页:   ' + deployedUrl + '/status');
  console.log('\n   已记录到 deploy-url.txt；执行线上验收：npm run probe:prod');
} else {
  console.log('\n⚠️  未能从输出中解析出部署地址，请手动确认，并写入 deploy-url.txt');
}

