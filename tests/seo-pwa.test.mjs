/**
 * SEO / 爬虫基础文件 · 版本号单一来源（2026-10-06 线上审计）
 *
 * 背景：线上实测 robots.txt / sitemap.xml / 404.html / .nojekyll 全部被 SPA 回退
 * 成 981 KB 的应用首页 HTML —— 爬虫提取不到任何规则，且一律 200。
 * 另外 build 注释是 v1.9.1 而页首 #brandVer 显示 v1.8.2（手工维护的静态字符串）。
 *
 * 这几项的共同点：**坏了不会有任何既有测试报错**（它们不参与应用逻辑），
 * 所以必须显式立测试，否则修完还会再坏。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = join(import.meta.dirname, '..');
const html = readFileSync(join(ROOT, 'src', 'index.template.html'), 'utf8');
const dist = join(ROOT, 'dist', 'index.html');
const distHtml = existsSync(dist) ? readFileSync(dist, 'utf8') : '';

/* ---------------- 版本号：构建期注入，杜绝手工维护 ---------------- */

test('页首版本号由构建注入，不再手工维护', () => {
  assert.ok(html.includes('<small id="brandVer">v__BUILD_VERSION__</small>'),
    '模板里的 brandVer 应为构建期占位符，而不是某个写死的版本号');

  const build = readFileSync(join(ROOT, 'scripts', 'build.mjs'), 'utf8');
  assert.ok(build.includes('__BUILD_VERSION__'), '构建未注入版本号');
  assert.ok(/html\s*=\s*html\.replace\(\/__BUILD_VERSION__\/g,\s*pkg\.version\)/.test(build),
    '构建未对占位符做全量替换');
  // 占位符残留会让页首显示 "v__BUILD_VERSION__"，必须 fail 掉
  assert.ok(build.includes('fail('), '构建缺少占位符残留断言');

  if (distHtml) {
    assert.ok(!distHtml.includes('__BUILD_VERSION__'), '产物仍残留 __BUILD_VERSION__ 占位符');
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    const m = distHtml.match(/<small id="brandVer">v([\d.]+)<\/small>/);
    assert.ok(m, '产物缺 #brandVer');
    assert.equal(m[1], pkg.version, '页首版本号与 package.json 不一致');
    // build 注释与页首必须是同一个版本号
    const stamp = (distHtml.match(/build: qingci-cet4-xiuxian v([\d.]+)/) || [])[1];
    assert.equal(stamp, m[1], `build 注释(v${stamp}) 与页首(v${m[1]}) 版本号不一致`);
  }
});

/* ---------------- 分享卡：og:image / twitter:image / canonical ---------------- */

test('og/twitter 分享元信息齐全（此前只有 twitter:card，缺图会静默降级）', () => {
  const SITE = 'https://qingci-cet4-xiuxian.pages.dev';
  for (const [prop, want] of [
    ['og:image', `${SITE}/icons/og-cover.png`],
    ['twitter:image', `${SITE}/icons/og-cover.png`],
    ['og:url', `${SITE}/`],
  ]) {
    const tag = prop.startsWith('og:')
      ? `<meta property="${prop}" content="${want}">`
      : `<meta name="${prop}" content="${want}">`;
    assert.ok(html.includes(tag), `缺 ${prop}（分享卡片会降级）`);
  }
  // canonical 必须是绝对地址
  const canon = html.match(/<link rel="canonical" href="([^"]+)">/);
  assert.ok(canon, '缺 canonical');
  assert.ok(canon[1].startsWith('https://'), 'canonical 必须是绝对地址');
  // 尺寸声明齐全，避免抓取端按默认比例裁切
  assert.ok(html.includes('og:image:width" content="1200"'), '缺 og:image:width');
  assert.ok(html.includes('og:image:height" content="630"'), '缺 og:image:height');
});

test('分享卡是构建产物且随部署发布（外链缺图 = 全站分享静默降级）', () => {
  const icon = join(ROOT, 'dist', 'icons', 'og-cover.png');
  if (!existsSync(icon)) return; // 未构建时跳过（干净检出先 build）
  const buf = readFileSync(icon);
  // PNG magic
  assert.deepEqual([...buf.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'og-cover.png 不是合法 PNG');
  // IHDR 宽高必须是 1200x630
  assert.equal(buf.readUInt32BE(16), 1200, 'og-cover.png 宽度不是 1200');
  assert.equal(buf.readUInt32BE(20), 630, 'og-cover.png 高度不是 630');

  // 构建会从 src/assets 拷贝它（dist 整个被 gitignore，不能只留在 dist）
  assert.ok(existsSync(join(ROOT, 'src', 'assets', 'og-cover.png')),
    '缺源资产 src/assets/og-cover.png，干净构建会失败');
  const build = readFileSync(join(ROOT, 'scripts', 'build.mjs'), 'utf8');
  assert.ok(build.includes("'og-cover.png'"), '构建未把分享卡拷进 dist/icons');
});

/* ---------------- 爬虫基础文件由部署脚本生成 ---------------- */

test('部署目录产出 robots.txt / sitemap.xml / 404.html / .nojekyll', () => {
  const src = readFileSync(join(ROOT, 'scripts', 'prepare-deploy.mjs'), 'utf8');
  for (const f of ['robots.txt', 'sitemap.xml', '404.html', '.nojekyll']) {
    assert.ok(src.includes(`'${f}'`), `部署脚本未生成 ${f}`);
  }
  // sitemap 必须是合法 XML 骨架，且指向绝对地址
  assert.ok(/<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/.test(src),
    'sitemap 缺 urlset 命名空间');
  assert.ok(src.includes('Sitemap: ${SITE}/sitemap.xml') || src.includes('Sitemap:'),
    'robots.txt 未声明 Sitemap');
  // 404 页面必须 noindex，否则会被当正常页面收录
  assert.ok(/name="robots" content="noindex"/.test(src), '404.html 未标 noindex');
  // 生成后要断言真的落盘 —— 这些文件漏了不会有任何其他信号
  assert.ok(/for \(const f of seoFiles\)[\s\S]*existsSync/.test(src), '生成后缺落盘断言');

  // 若已生成过部署目录，直接验产物
  const out = join(ROOT, 'deploy-pages');
  if (!existsSync(out)) return;
  const robots = readFileSync(join(out, 'robots.txt'), 'utf8');
  assert.ok(robots.includes('User-agent: *'), 'robots.txt 内容异常');
  assert.ok(!robots.trimStart().startsWith('<'), 'robots.txt 回落成了 HTML');
  const sm = readFileSync(join(out, 'sitemap.xml'), 'utf8');
  assert.ok(sm.startsWith('<?xml'), 'sitemap.xml 缺 XML 声明');
  const nf = readFileSync(join(out, '404.html'), 'utf8');
  assert.ok(nf.includes('noindex'), '404.html 缺 noindex');
  assert.ok(Buffer.byteLength(nf) < 20000, '404.html 过大（不该内联整份应用）');
});