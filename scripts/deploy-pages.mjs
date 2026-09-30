#!/usr/bin/env node
/**
 * Cloudflare Pages 一键部署
 *
 * 背景：wrangler 只认 wrangler.toml 这一个文件名，而 Workers 与 Pages 的
 * 配置字段互斥（main 与 pages_build_output_dir 不能共存）。本脚本在部署
 * Pages 时临时把配置切换为 Pages 版，结束后无论成功失败都还原 Workers 版。
 *
 * 流程：构建产物 → 生成 Pages 部署目录 → 切换配置 → 上传 → 还原配置 → 线上验收
 * 用法：npm run deploy:pages
 */
import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOML = path.join(ROOT, 'wrangler.toml');
const BACKUP = path.join(ROOT, '.wrangler-workers.toml.bak');
const PROJECT = 'qingci-cet4-xiuxian';
const BRANCH = 'main';

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

function run(step, cmd, args) {
  console.log(`\n${step} ${cmd} ${args.join(' ')}`);
  return execFileSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
}

/** 生成 Pages 版配置（只含 Pages 需要的字段） */
function writePagesConfig() {
  fs.copyFileSync(TOML, BACKUP);
  fs.writeFileSync(TOML, `# 【部署期间临时生成】Cloudflare Pages 配置
# 本文件由 scripts/deploy-pages.mjs 在部署 Pages 时自动写入，部署结束会还原。
name = "${PROJECT}"
pages_build_output_dir = "deploy-pages"
compatibility_date = "2026-09-30"

[vars]
APP_VERSION = "${pkg.version}"
`);
}

function restoreWorkersConfig() {
  if (fs.existsSync(BACKUP)) {
    fs.copyFileSync(BACKUP, TOML);
    fs.unlinkSync(BACKUP);
    console.log('\n↩️  已还原 Workers 配置（wrangler.toml）');
  }
}

console.log(`🚀 部署 青词天路 v${pkg.version} 到 Cloudflare Pages\n`);

let deployedUrl = '';
try {
  // 1) 构建
  run('[1/5] 构建产物', 'node', ['scripts/build.mjs']);

  // 2) 生成 Pages 部署目录（含 functions 复制）
  run('[2/5] 生成 Pages 部署目录', 'node', ['scripts/prepare-deploy.mjs', '--pages']);

  // 3) 切换为 Pages 配置
  console.log('\n[3/5] 切换为 Pages 配置');
  writePagesConfig();

  // 4) 上传
  console.log('\n[4/5] 上传到 Cloudflare Pages');
  const out = execSync(
    `npx --yes wrangler@latest pages deploy deploy-pages --project-name ${PROJECT} --branch ${BRANCH} --commit-dirty=true`,
    { cwd: ROOT, encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'] }
  );
  process.stdout.write(out);

  // 生产域名固定为 <project>.pages.dev
  deployedUrl = `https://${PROJECT}.pages.dev`;

  fs.writeFileSync(path.join(ROOT, 'deploy-url.txt'), deployedUrl + '\n');
  console.log('\n✅ 部署完成');
  console.log('   应用入口: ' + deployedUrl + '/');
  console.log('   健康检查: ' + deployedUrl + '/healthz');
  console.log('   元信息:   ' + deployedUrl + '/api/meta');
} catch (e) {
  console.error('\n❌ 部署失败：' + (e.message || e));
  console.error('   若提示未登录，请先执行：npx wrangler login');
  process.exitCode = 1;
} finally {
  // 5) 无论成败都还原配置，避免污染 Workers 部署
  console.log('\n[5/5] 还原配置');
  restoreWorkersConfig();
}
