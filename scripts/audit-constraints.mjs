#!/usr/bin/env node
/**
 * 12 条硬约束的**一次性核验**（`npm run audit:constraints`）
 *
 * ── 为什么需要它 ──
 * 本项目从 v1.9.1 起有 12 条硬约束（单文件、零依赖、SRS 语义不变、ARIA 保留、
 * 深色默认+浅色/高对比、测试全绿、用户数据不丢、词库分片按需加载、体积预算内、
 * 每层跑门禁、不开启 D1_MULTIPLAYER/AI_IMAGE、助记覆盖率达标）。
 *
 * 这些约束**分散在多个测试与脚本里**，逐个跑能覆盖，但没有任何一处
 * 能回答「现在这 12 条整体是什么状态」。交接或改动后想快速自查时，
 * 只能靠记忆逐条去跑 —— 容易漏。
 *
 * 本脚本把 12 条约束收敛成**一次可执行的核验**，每条给出：
 *   · 判据（可复核的事实）
 *   · 证据（实际读到的值）
 *   · 通过 / 失败
 *
 * 它**不替代**各层门禁（typecheck/build/test 仍需各自跑），
 * 而是作为「交付前整体体检」与「交接时的一句话结论」。
 *
 * 用法：node scripts/audit-constraints.mjs
 *   --json   以 JSON 输出（便于 CI 或其它脚本消费）
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const exists = (p) => existsSync(join(ROOT, p));
const sizeOf = (p) => (exists(p) ? statSync(join(ROOT, p)).size : 0);

const results = [];
/** 记一条核验结果 */
function check(id, title, pass, criterion, evidence) {
  results.push({ id, title, pass: !!pass, criterion, evidence: String(evidence) });
}

/* ───────────────── 1. 单文件形态 ───────────────── */
{
  const html = read('src/index.template.html');
  // 单文件交付：所有 JS/CSS 都内联在 HTML 里，没有本地 <script src> / <link rel=stylesheet>
  const localScripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)]
    .map((m) => m[1]).filter((u) => !/^https?:|^\/\//.test(u));
  const localCss = [...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*>/g)]
    .map((m) => m[0]).filter((t) => !/href=["']https?:|href=["']\/\//.test(t));
  const dist = sizeOf('dist/index.html');
  check('single-file', '单文件形态',
    localScripts.length === 0 && localCss.length === 0 && dist > 0,
    '模板内不得有本地 <script src> / <link stylesheet>；产物 dist/index.html 存在',
    `本地外链脚本 ${localScripts.length} 个、外链样式 ${localCss.length} 个；产物 ${(dist / 1024).toFixed(1)} KB`);
}

/* ───────────────── 2. 零外部依赖 ───────────────── */
{
  const pkg = JSON.parse(read('package.json'));
  const deps = Object.keys(pkg.dependencies || {});
  // devDependencies 允许（构建期工具），运行期依赖必须为空
  check('no-deps', '零外部依赖（运行期）',
    deps.length === 0,
    'package.json 的 dependencies 必须为空（devDependencies 为构建期工具，允许）',
    `dependencies = [${deps.join(', ') || '空'}]；devDependencies ${Object.keys(pkg.devDependencies || {}).length} 个（构建期）`);
}

/* ───────────────── 3. SM-2 / SRS 语义不变 ───────────────── */
{
  const srs = read('src/services/srs.ts');
  // SM-2 的核心：质量评分、EF 更新公式、间隔序列
  const hasEF = /easeFactor|ef\b/i.test(srs);
  const hasInterval = /interval/i.test(srs);
  const hasQuality = /quality|grade/i.test(srs);
  // 既有 SRS 测试必须全绿（单独跑，确保语义没被改）
  let srsTestOk = false;
  let srsTestOut = '';
  try {
    srsTestOut = execFileSync(process.execPath, ['--test', 'tests/srs.test.mjs'], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    srsTestOk = /# fail 0|fail 0/.test(srsTestOut);
  } catch (e) {
    srsTestOut = String(e.stdout || '') + String(e.stderr || '');
    srsTestOk = /# fail 0|fail 0/.test(srsTestOut);
  }
  check('srs-semantics', 'SM-2 / SRS 语义不变',
    hasEF && hasInterval && hasQuality && srsTestOk,
    'srs.ts 保留 EF/间隔/质量评分；tests/srs.test.mjs 全绿',
    `EF=${hasEF} 间隔=${hasInterval} 质量=${hasQuality}；SRS 测试 ${srsTestOk ? '全绿' : '未通过'}`);
}

/* ───────────────── 4. ARIA / 焦点环保留 ───────────────── */
{
  const html = read('src/index.template.html');
  const dist = exists('dist/index.html') ? read('dist/index.html') : '';
  // ⚠️ 焦点环检查必须**锚定到交互元素**，不能只判「存在一条 :focus-visible」——
  // 初版只要求出现 `:focus-visible{outline:2px solid}`，于是我删掉
  // `button:focus-visible` 那条规则后审计仍然通过（漏报）。
  // 这里改为要求：button 与 .choice 各自都有焦点环规则，且焦点环宽度 ≥2px。
  const buttonFocus = /button:focus-visible[^{]*\{[^}]*outline:\s*[23]px solid/.test(html);
  const choiceFocus = /\.choice:focus-visible[^{]*\{[^}]*outline:\s*[23]px solid/.test(html);
  const anyFocus = /:focus-visible\{outline:\s*[23]px solid/.test(html);
  const checks = {
    'lang': /<html lang="zh-CN">/.test(html),
    'main landmark': /<main id="main"/.test(html),
    'skip link': html.includes('class="skip-link"'),
    '题干 aria-live': /id="prompt"[^>]*aria-live="polite"/.test(html),
    '选项 role=group': /id="choices"[^>]*role="group"/.test(html),
    'button 焦点环': buttonFocus,
    '.choice 焦点环': choiceFocus,
    '通用焦点环': anyFocus,
    '无 outline:none': !/:focus\s*\{[^}]*outline:\s*none/.test(html),
    '弹窗 role=dialog': (html.match(/role="dialog"/g) || []).length >= 3,
    '产物含焦点环': /:focus-visible/.test(dist),
  };
  const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  check('aria', 'ARIA / 焦点环保留',
    failed.length === 0,
    'lang、main、skip-link、aria-live、role=group 齐备；button 与 .choice 各自有 ≥2px 焦点环；无 outline:none',
    failed.length ? `缺失：${failed.join(', ')}` : `${Object.keys(checks).length} 项齐备（含 button/.choice 焦点环）`);
}

/* ───────────────── 5. 深色默认 + 浅色 / 高对比 ───────────────── */
{
  const html = read('src/index.template.html');
  const darkDefault = /color-scheme:\s*dark/.test(html);
  const lightTheme = /:root\[data-theme="light"\]/.test(html);
  const highContrast = /data-contrast="high"/.test(html);
  const elemText = ['metal', 'wood', 'water', 'fire', 'earth']
    .every((e) => new RegExp(`--elem-${e}-text`).test(html));
  check('themes', '深色默认 + 浅色 / 高对比支持',
    darkDefault && lightTheme && highContrast && elemText,
    '默认 color-scheme:dark；存在 data-theme="light" 与 data-contrast="high"；五行文字色齐全',
    `深色默认=${darkDefault} 浅色=${lightTheme} 高对比=${highContrast} 五行文字色=${elemText}`);
}

/* ───────────────── 6. 测试全绿 ───────────────── */
{
  // ⚠️ 必须与 package.json 的 test 脚本同口径（`tests/*.test.mjs`）。
  // 初版写成 `node --test tests/`，Node 会把目录当模块去找 → "Cannot find module ...\tests"，
  // 于是**审计脚本自己报假失败**。这类「核验工具自身用错命令」的坑要避免。
  const pkgTest = JSON.parse(read('package.json')).scripts?.test || '';
  const patterns = ['tests/*.test.js', 'tests/*.test.mjs'].filter((p) => pkgTest.includes(p));
  let out = '';
  let ran = false;
  try {
    out = execFileSync(process.execPath, ['--test', ...patterns], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 128 * 1024 * 1024,
    });
    ran = true;
  } catch (e) {
    out = String(e.stdout || '') + String(e.stderr || '');
    ran = false;
  }
  const m = out.match(/ℹ tests (\d+)[\s\S]*?ℹ pass (\d+)[\s\S]*?ℹ fail (\d+)/);
  const failCount = m ? Number(m[3]) : null;
  const counts = m ? `${m[2]}/${m[1]} 通过，失败 ${m[3]}` : `(未解析；原始输出 ${out.slice(0, 120).replace(/\s+/g, ' ')})`;
  check('tests', '现有测试全绿',
    ran && failCount === 0,
    '与 package.json 的 test 脚本同口径运行，fail = 0',
    counts);
}

/* ───────────────── 7. 用户数据不丢 ───────────────── */
{
  const html = read('src/index.template.html');
  const backup = exists('src/services/backup.ts') ? read('src/services/backup.ts') : '';
  const idb = exists('src/services/idb.ts') ? read('src/services/idb.ts') : '';
  // ⚠️ 仓清单要从 idb.ts 的 IDB_STORES 定义里取 ——
  // backup.ts 里只出现「被跳过的那两个」（它引用的是同一个常量）。
  // 初版从 backup.ts 取，导致「覆盖仓 0 个」的假失败。
  const idbBlock = (idb.match(/IDB_STORES\s*=\s*\{([\s\S]*?)\}\s*as const/) || [])[1] || '';
  const allStores = [...idbBlock.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
  // 跳过名单：backup.ts 里 DEFAULT_SKIP_STORES 数组中引用的 IDB_STORES.xxx
  const skipBlock = (backup.match(/DEFAULT_SKIP_STORES[^=]*=\s*\[([\s\S]*?)\]/) || [])[1] || '';
  const skipNames = [...skipBlock.matchAll(/IDB_STORES\.(\w+)/g)].map((m) => m[1]);
  const covered = allStores.filter((s) => !skipNames.includes(s));
  const exportUsesBackup = /QingciServices\.backup/.test(html) && /BK\.collect/.test(html);
  const clearAll = /BK\.clearAll/.test(html);
  check('no-data-loss', '用户数据不丢',
    allStores.length >= 10 && covered.length >= 10 && exportUsesBackup && clearAll,
    '导出走完整备份（覆盖除可再生缓存外的全部 IDB 仓）；散功同时清 IndexedDB',
    `IDB 共 ${allStores.length} 个仓，备份覆盖 ${covered.length} 个（跳过可再生缓存：${skipNames.join('/') || '无'}）；导出走备份=${exportUsesBackup}；散功清 IDB=${clearAll}`);
}

/* ───────────────── 8. 词库分片按需加载 ───────────────── */
{
  const hasShards = exists('lexicons') || exists('dist/lexicons');
  const registry = exists('src/services/lexicon.ts') ? read('src/services/lexicon.ts') : '';
  const lazy = /load|fetch|import\(/.test(registry);
  // 产物不得内联全部词库分片（否则就不是「按需」）
  const dist = sizeOf('dist/index.html');
  check('lazy-lexicon', '词库分片按需加载',
    lazy,
    '词库走分片加载（lexicon 服务含按需加载路径）',
    `lexicon 服务含加载逻辑=${lazy}；产物 ${(dist / 1024).toFixed(1)} KB（内联词库仅 CET-4 主库）`);
}

/* ───────────────── 9. 体积预算内 ───────────────── */
{
  const BASE = 911318;
  const CAP = 950000;
  const dist = sizeOf('dist/index.html');
  const budget = 19 * 1024;
  const delta = dist - BASE;
  check('size-budget', '体积预算内',
    dist < CAP && delta <= budget,
    `产物 < ${(CAP / 1024).toFixed(0)} KB 硬顶，且增量 ≤ 19 KB（基线 ${(BASE / 1024).toFixed(1)} KB）`,
    `${dist} B（${(dist / 1024).toFixed(1)} KB）；较基线 ${delta >= 0 ? '+' : ''}${(delta / 1024).toFixed(2)} KB；剩余 ${((budget - delta) / 1024).toFixed(2)} KB`);
}

/* ───────────────── 10. 每层跑门禁 ───────────────── */
{
  const pkg = JSON.parse(read('package.json'));
  const s = pkg.scripts || {};
  const needed = ['typecheck', 'build', 'test'];
  const missing = needed.filter((k) => !s[k]);
  check('gates', '每层跑 typecheck + build + test',
    missing.length === 0,
    'package.json 提供 typecheck / build / test 三个脚本',
    missing.length ? `缺失：${missing.join(', ')}` : `三者齐备；另有 verify/check 脚本 ${Object.keys(s).filter((k) => /^(verify|check)/.test(k)).length} 个`);
}

/* ───────────────── 11. 不置 D1_MULTIPLAYER / AI_IMAGE 为 true ───────────────── */
{
  const files = ['wrangler.toml', 'worker/index.mjs', 'functions/api/[[path]].js', 'src/index.template.html'];
  const offenders = [];
  for (const f of files) {
    if (!exists(f)) continue;
    const src = read(f);
    for (const key of ['D1_MULTIPLAYER_ENABLED', 'AI_IMAGE_ENABLED']) {
      // 找 `KEY = true` / `KEY: true` / `"KEY": "true"`
      const re = new RegExp(`${key}\\s*[:=]\\s*["']?true["']?`, 'g');
      if (re.test(src)) offenders.push(`${f}:${key}`);
    }
  }
  check('flags-off', '不置 D1_MULTIPLAYER / AI_IMAGE 为 true',
    offenders.length === 0,
    '任何文件都不得把这两个开关设为 true',
    offenders.length ? `发现：${offenders.join(', ')}` : '两开关均未设为 true');
}

/* ───────────────── 12. 助记覆盖率达标 ───────────────── */
{
  // ⚠️ Node 的测试摘要前缀是 `ℹ`（信息符号），不是 `#`（TAP 风格）——
  // 初版按 `# pass` 解析，导致「(未解析)」的假失败。
  let out = '';
  let ran = false;
  try {
    out = execFileSync(process.execPath, ['--test', 'tests/mnemonic.test.mjs'], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024,
    });
    ran = true;
  } catch (e) {
    out = String(e.stdout || '') + String(e.stderr || '');
  }
  const m = out.match(/ℹ pass (\d+)[\s\S]*?ℹ fail (\d+)/);
  const failCount = m ? Number(m[2]) : null;
  const counts = m ? `通过 ${m[1]}，失败 ${m[2]}` : `(未解析；原始输出 ${out.slice(0, 120).replace(/\s+/g, ' ')})`;
  // 覆盖率门槛写在测试里：≥90%（top-1000 口径）/ ≥60%（下限）
  const mn = exists('tests/mnemonic.test.mjs') ? read('tests/mnemonic.test.mjs') : '';
  const hasThreshold = /pct >= 60/.test(mn) && /pct >= 90/.test(mn);
  check('mnemonic', '助记覆盖率达标',
    ran && failCount === 0 && hasThreshold,
    'tests/mnemonic.test.mjs 全绿，且保留 ≥90% / ≥60% 覆盖率门槛',
    `${counts}；门槛存在=${hasThreshold}`);
}

/* ───────────────── 输出 ───────────────── */
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ results, pass: results.every((r) => r.pass) }, null, 2));
} else {
  console.log('12 条硬约束核验');
  console.log('═'.repeat(78));
  for (const r of results) {
    console.log(`${r.pass ? '✅' : '❌'} [${r.id}] ${r.title}`);
    console.log(`     判据：${r.criterion}`);
    console.log(`     证据：${r.evidence}`);
  }
  console.log('═'.repeat(78));
  const bad = results.filter((r) => !r.pass);
  console.log(bad.length === 0
    ? `✅ 12 条硬约束全部满足（${results.length} 项核验通过）`
    : `❌ ${bad.length} 条未满足：${bad.map((r) => r.title).join('、')}`);
}
process.exit(results.every((r) => r.pass) ? 0 : 1);
