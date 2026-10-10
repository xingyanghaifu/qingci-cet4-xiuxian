/**
 * 密钥泄漏守卫（v1.13）
 *
 * ── 为什么加这个 ──
 * 我在写 `docs/UI美化交付报告.md` 时，**把部署用的 Cloudflare API token 明文写了进去**，
 * 并准备提交推送。幸好用户在我推送前拦下 —— 否则公开仓库上就多了一把可用密钥。
 *
 * 这是一次真实的、差点造成后果的疏漏。本测试把它变成**可自动拦截**的问题：
 * 扫描所有**会入库的文件**，命中常见密钥形态就失败。
 *
 * ── 设计取舍 ──
 *   · 只扫「会入库的文本文件」，跳过 node_modules / dist / backups / .git
 *   · 模式要**足够具体**以免误报（例如不裸扫 32 位十六进制 —— 那会命中哈希与指纹）
 *   · 报错信息**不回显命中的内容**（否则测试日志本身又成了泄漏点），只报位置与类型
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

/** 不参与扫描的目录（构建产物 / 依赖 / 本地备份） */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'dist-offline', 'backups', '.wrangler', '.cache', '.npm-cache']);
/** 只看文本类文件 */
const TEXT_RE = /\.(md|ts|js|mjs|cjs|json|html|css|txt|yml|yaml|toml|sh|ps1|env)$/i;

function walk(dir, out = [], depth = 0) {
  if (depth > 8) return out;
  let names;
  try { names = readdirSync(dir); } catch { return out; }
  for (const name of names) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out, depth + 1);
    else if (TEXT_RE.test(name)) out.push(p);
  }
  return out;
}

/**
 * 密钥形态。
 * ⚠️ 刻意**不**包含裸的 32/64 位十六进制串 —— 本仓库里到处都是 sha256 指纹与哈希，
 * 那样会天天误报，最后被人加 skip 而失效。
 */
const PATTERNS = [
  ['Cloudflare API token', /\bcfut_[A-Za-z0-9_-]{20,}/],
  ['Cloudflare global key', /\b[0-9a-f]{37}\b/],
  ['OpenAI 风格 key', /\bsk-[A-Za-z0-9]{20,}/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}/],
  ['AWS Access Key ID', /\bAKIA[0-9A-Z]{16}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{30,}/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
  ['私钥块', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['npm token', /\bnpm_[A-Za-z0-9]{30,}/],
];

const files = walk(ROOT);

test('前置：确实扫到了文件（否则守卫形同虚设）', () => {
  assert.ok(files.length > 50, `只扫到 ${files.length} 个文件，扫描逻辑可能失效`);
  assert.ok(files.some((f) => f.endsWith('package.json')), '应扫到 package.json');
});

test('守卫：会入库的文件里不得出现密钥明文', () => {
  const hits = [];
  for (const f of files) {
    let txt;
    try { txt = readFileSync(f, 'utf8'); } catch { continue; }
    for (const [label, re] of PATTERNS) {
      if (re.test(txt)) {
        // ⚠️ 只报位置与类型，**不回显命中的内容**（否则测试日志又成了泄漏点）
        hits.push(`${relative(ROOT, f)}  ← 命中「${label}」`);
      }
    }
  }
  assert.deepEqual(hits, [],
    '以下文件含疑似密钥明文（已隐去内容）——\n'
    + '请改为从环境变量读取，并**吊销该密钥**：\n  ' + hits.join('\n  '));
});

test('守卫：部署脚本必须从环境变量读 token，不得硬编码', () => {
  // 部署脚本若把 token 写死，同样会入库
  const deployFiles = files.filter((f) => /scripts[\\/].*(deploy|pages)/i.test(f));
  assert.ok(deployFiles.length > 0, '应能找到部署脚本');
  for (const f of deployFiles) {
    const txt = readFileSync(f, 'utf8');
    assert.ok(!/cfut_/.test(txt), `${relative(ROOT, f)} 不得含 cfut_ 明文`);
  }
});

test('守卫：.gitignore 必须忽略本地备份目录（防误提交含机密的备份）', () => {
  const gi = readFileSync(join(ROOT, '.gitignore'), 'utf8');
  assert.ok(/^backups\/?$/m.test(gi), '.gitignore 应忽略 backups/');
  assert.ok(/^\.dev\.vars$/m.test(gi), '.gitignore 应忽略 .dev.vars');
  assert.ok(/^\.wrangler\/?$/m.test(gi), '.gitignore 应忽略 .wrangler/');
});
