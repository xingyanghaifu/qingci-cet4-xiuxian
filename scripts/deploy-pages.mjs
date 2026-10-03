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
 *
 * wrangler 解析顺序（避免每次都联网装 wrangler@latest）：
 *   1) 本地 node_modules/.bin/wrangler
 *   2) npx 缓存里**自带平台 workerd 二进制**的 wrangler（按安装时间取最新可用的那份）
 *   3) 其它缓存 / `npx --yes wrangler@latest` 兜底
 * 为什么要检查 workerd：npm 有时会漏装 optionalDependencies，
 *   导致 `@cloudflare/workerd-windows-64` 缺失、wrangler 一启动就抛错（本次真实踩到）。
 * 输出处理：直接 stdio: 'inherit' 透传，不捕获 stdout ——
 *   捕获管道在受限沙箱下会因命名管道限制而 EPERM，且会吞掉 wrangler 的实时进度。
 */
import { execFileSync } from 'node:child_process';
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

/**
 * 当前平台对应的 workerd 包名
 * 注意真实命名：x64 是 `-64`（不是 `-x64`），arm64 才是 `-arm64`
 * （@cloudflare/workerd-windows-64 / -linux-64 / -linux-arm64 / -darwin-64 …）
 */
export function platformWorkerdPackage(platform = process.platform, arch = process.arch) {
  const a = arch === 'arm64' ? 'arm64' : '64';
  if (platform === 'win32') return `workerd-windows-${a}`;
  if (platform === 'darwin') return `workerd-darwin-${a}`;
  return `workerd-linux-${a}`;
}

/** wrangler 是否可用：同级 node_modules 里必须有本平台的 workerd 二进制 */
export function hasPlatformWorkerd(wranglerJs, platform = process.platform, arch = process.arch) {
  const nodeModules = path.resolve(path.dirname(wranglerJs), '..', '..');
  const scope = path.join(nodeModules, '@cloudflare');
  if (!fs.existsSync(scope)) return false;
  const expected = platformWorkerdPackage(platform, arch);
  const hasBin = (dir) => {
    const binDir = path.join(dir, 'bin');
    return fs.existsSync(binDir) && fs.readdirSync(binDir).length > 0;
  };
  // 优先精确匹配；同时容忍 npm 装在别处的同平台 workerd 包
  const dirs = fs.readdirSync(scope).filter((name) => name.startsWith('workerd-'));
  const exact = dirs.find((name) => name === expected);
  if (exact && hasBin(path.join(scope, exact))) return true;
  return dirs.some((name) => name.startsWith(`workerd-${platform}-`) && hasBin(path.join(scope, name)));
}

/** 收集所有候选 wrangler（本地 → npx 缓存），可用的排在前面 */
export function collectWranglerCandidates() {
  const candidates = [];
  const localBin = process.platform === 'win32'
    ? path.join(ROOT, 'node_modules', '.bin', 'wrangler.cmd')
    : path.join(ROOT, 'node_modules', '.bin', 'wrangler');
  if (fs.existsSync(localBin)) {
    const localJs = path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
    candidates.push({
      cmd: localBin,
      prefix: [],
      label: '本地 node_modules',
      usable: fs.existsSync(localJs) ? hasPlatformWorkerd(localJs) : true,
    });
  }

  const cacheRoot = process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || '', 'npm-cache', '_npx')
    : path.join(process.env.HOME || '', '.npm', '_npx');
  if (fs.existsSync(cacheRoot)) {
    for (const dir of fs.readdirSync(cacheRoot)) {
      const wranglerJs = path.join(cacheRoot, dir, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
      if (!fs.existsSync(wranglerJs)) continue;
      let version = 'unknown';
      try {
        version = JSON.parse(fs.readFileSync(path.join(cacheRoot, dir, 'node_modules', 'wrangler', 'package.json'), 'utf8')).version;
      } catch { /* 忽略 */ }
      candidates.push({
        cmd: process.execPath,
        prefix: [wranglerJs],
        label: `npx 缓存 wrangler ${version}`,
        usable: hasPlatformWorkerd(wranglerJs),
        mtime: fs.statSync(wranglerJs).mtimeMs,
      });
    }
  }

  // 可用的优先，其次按安装时间从新到旧
  candidates.sort((a, b) => (Number(b.usable) - Number(a.usable)) || ((b.mtime || 0) - (a.mtime || 0)));
  candidates.push({ cmd: 'npx', prefix: ['--yes', 'wrangler@latest'], label: 'npx wrangler@latest（需联网安装）', usable: false });
  return candidates;
}

/** D1 绑定（反馈 + 道友小组共用同一个库；database_id 不是密钥，可入库） */
const D1_DATABASE_NAME = 'qingci-feedback';
const D1_DATABASE_ID = 'a4eff653-dcfd-4874-a0ff-e30f5e92a611';

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

# 反馈与道友小组的 D1 绑定（建库命令见 db/schema.sql 与 docs/部署说明.md）
[[d1_databases]]
binding = "DB"
database_name = "${D1_DATABASE_NAME}"
database_id = "${D1_DATABASE_ID}"
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

  // 1.5) 听力音频（增量；生成失败则中止部署——线上必须有音频）
  run('[1.5/5] 生成听力音频（build:audio）', 'node', ['scripts/build-audio-tts.mjs']);

  // 2) 生成 Pages 部署目录（含 functions 复制）
  run('[2/5] 生成 Pages 部署目录', 'node', ['scripts/prepare-deploy.mjs', '--pages']);

  // 3) 切换为 Pages 配置
  console.log('\n[3/5] 切换为 Pages 配置');
  writePagesConfig();

  // 4) 上传（逐个候选尝试：某个缓存缺 workerd 时自动换下一个）
  console.log('\n[4/5] 上传到 Cloudflare Pages');
  const candidates = collectWranglerCandidates();
  let uploaded = false;
  let lastError = null;
  for (const [index, candidate] of candidates.entries()) {
    console.log(`     [候选 ${index + 1}/${candidates.length}] ${candidate.label}`
      + (candidate.usable ? '（workerd 就绪）' : '（缺少本平台 workerd，可能失败）'));
    try {
      run('     ›', candidate.cmd, [
        ...candidate.prefix,
        'pages', 'deploy', 'deploy-pages',
        '--project-name', PROJECT,
        '--branch', BRANCH,
        '--commit-dirty=true',
      ]);
      uploaded = true;
      break;
    } catch (error) {
      lastError = error;
      console.error(`     ⚠️  候选失败：${String(error.message || error).split('\n')[0]}`);
      console.error('     继续尝试下一个候选…');
    }
  }
  if (!uploaded) throw lastError || new Error('所有 wrangler 候选均失败');

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
