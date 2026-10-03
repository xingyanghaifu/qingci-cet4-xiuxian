/**
 * 测试辅助：用 esbuild 把 TypeScript 源码打包成临时 ESM 文件后 import
 *
 * 为什么需要它：项目根 package.json 是 commonjs，Node 不会把 src/**\/*.ts 当 ESM 处理，
 * 直接 import 会报 "Unexpected token 'export'"。这里统一走 esbuild 打包，
 * 产出到 dist/.ts-test/（已被 .gitignore 忽略），使测试与构建使用同一条编译链。
 */
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const OUT_DIR = join(ROOT, 'dist', '.ts-test');

const cache = new Map();

/**
 * 加载一个 TypeScript 模块
 * @param {string} relPath 相对仓库根目录的路径，例如 'src/services/grading.ts'
 */
export async function loadTs(relPath) {
  const entry = join(ROOT, relPath);
  const key = basename(entry).replace(/\.ts$/, '') + '-' + createHash('sha1').update(entry).digest('hex').slice(0, 8);
  if (cache.has(key)) return cache.get(key);

  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    target: ['es2022'],
    charset: 'utf8',
    sourcemap: 'inline',
    logLevel: 'silent',
  });
  mkdirSync(OUT_DIR, { recursive: true });
  const file = join(OUT_DIR, key + '.mjs');
  writeFileSync(file, result.outputFiles[0].text, 'utf8');

  const mod = await import(pathToFileURL(file).href);
  cache.set(key, mod);
  return mod;
}
