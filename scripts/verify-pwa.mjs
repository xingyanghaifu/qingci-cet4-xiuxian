#!/usr/bin/env node
/**
 * PWA 产物一致性校验（零依赖，可在 CI 与 npm run verify 中运行）
 *
 * 校验内容：
 *   1. manifest.webmanifest 可解析，且 4 个图标（192/512 × any/maskable）都存在且尺寸正确
 *   2. sw.js 已注入缓存版本（不再含 __CACHE_VERSION__ 占位符）
 *   3. sw.js 预缓存清单中的每个文件都真实存在于 dist/
 *   4. index.html 引用了 manifest 与图标（保证安装提示可用）
 *
 * 用法：node scripts/verify-pwa.mjs [distDir]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIST = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'dist');

const errors = [];
const notes = [];

function readPngSize(file) {
  const buf = fs.readFileSync(file);
  const isPng = buf.slice(0, 8).toString('hex') === '89504e470d0a1a0a';
  if (!isPng) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// 1) manifest
const manifestPath = path.join(DIST, 'manifest.webmanifest');
if (!fs.existsSync(manifestPath)) {
  errors.push('缺少 manifest.webmanifest（先执行 npm run build）');
} else {
  let manifest = null;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    errors.push('manifest.webmanifest 不是合法 JSON：' + e.message);
  }
  if (manifest) {
    const expected = [
      ['icon-192.png', 192, 'any'],
      ['icon-512.png', 512, 'any'],
      ['icon-192-maskable.png', 192, 'maskable'],
      ['icon-512-maskable.png', 512, 'maskable'],
    ];
    for (const [name, size, purpose] of expected) {
      const icon = (manifest.icons || []).find((i) => String(i.src).endsWith(name));
      if (!icon) {
        errors.push(`manifest 缺少图标 ${name}`);
        continue;
      }
      if (icon.purpose !== purpose) errors.push(`${name} 的 purpose 应为 ${purpose}，实际 ${icon.purpose}`);
      const file = path.join(DIST, icon.src);
      if (!fs.existsSync(file)) {
        errors.push(`manifest 引用的图标不存在：${icon.src}`);
        continue;
      }
      const dim = readPngSize(file);
      if (!dim) errors.push(`${icon.src} 不是合法 PNG`);
      else if (dim.width !== size || dim.height !== size) {
        errors.push(`${icon.src} 尺寸应为 ${size}x${size}，实际 ${dim.width}x${dim.height}`);
      }
    }
    if (!manifest.start_url) errors.push('manifest 缺少 start_url');
    if (manifest.display !== 'standalone') errors.push('manifest display 应为 standalone');
    notes.push(`manifest：${manifest.name} · 图标 ${(manifest.icons || []).length} 个`);
  }
}

// 2) Service Worker
const swPath = path.join(DIST, 'sw.js');
if (!fs.existsSync(swPath)) {
  errors.push('缺少 sw.js（先执行 npm run build）');
} else {
  const sw = fs.readFileSync(swPath, 'utf8');
  if (sw.includes('__CACHE_VERSION__')) errors.push('sw.js 仍含 __CACHE_VERSION__ 占位符，未被构建替换');
  const version = /const CACHE_VERSION = '([^']+)'/.exec(sw);
  if (!version) errors.push('sw.js 缺少 CACHE_VERSION');
  else notes.push('sw.js：缓存版本 ' + version[1]);

  const listMatch = /const SHELL_ASSETS = \[([\s\S]*?)\];/.exec(sw);
  if (!listMatch) {
    errors.push('sw.js 缺少 SHELL_ASSETS 预缓存清单');
  } else {
    const assets = [...listMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    let missing = 0;
    for (const asset of assets) {
      const rel = asset.replace(/^\.\//, '');
      if (!rel) continue;
      if (!fs.existsSync(path.join(DIST, rel))) {
        // 纯静态托管下 healthz.json/api-meta.json 由 prepare-deploy 生成，这里只提示
        if (rel === 'healthz.json' || rel === 'api-meta.json') continue;
        errors.push(`sw.js 预缓存清单中的文件不存在：${rel}`);
        missing++;
      }
    }
    notes.push(`sw.js 预缓存清单：${assets.length} 项，缺失 ${missing}`);
  }
}

// 3) index.html 引用
const htmlPath = path.join(DIST, 'cet4-xiuxian.html');
if (!fs.existsSync(htmlPath)) {
  errors.push('缺少 dist/cet4-xiuxian.html');
} else {
  const html = fs.readFileSync(htmlPath, 'utf8');
  if (!/rel="manifest"\s+href="manifest\.webmanifest"/.test(html)) errors.push('index.html 未引用 manifest.webmanifest');
  if (!html.includes('icons/icon-192.png')) errors.push('index.html 未引用 PNG 图标');
  if (!html.includes('QingciServices')) errors.push('index.html 未内联服务层（构建异常）');
}

for (const n of notes) console.log('  · ' + n);
if (errors.length) {
  console.error('\n❌ PWA 产物校验未通过：');
  for (const e of errors) console.error('   - ' + e);
  process.exit(1);
}
console.log('\n✅ PWA 产物校验通过（manifest / sw.js / 图标 / 页面引用）');
