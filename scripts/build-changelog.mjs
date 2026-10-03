#!/usr/bin/env node
/**
 * 更新日志构建（P1 任务 E）
 *
 * 输入：CHANGELOG.md
 * 输出：
 *   · dist/changelog.html        —— 公开更新日志页（静态、零依赖、可被部署）
 *   · src/data/changelog.json    —— 版本条目（构建时内联进单文件，供应用内查看）
 *
 * 只做最简单的 Markdown 子集渲染（标题 / 列表 / 粗体 / 行内代码 / 链接 / 段落），
 * 不引入 markdown 库，保持「运行时零依赖 + 构建期零依赖」。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const escapeHtml = (text) => String(text)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/** 行内 Markdown → HTML（先转义再替换，避免注入） */
export function inlineMarkdown(text) {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, href) => {
    const safe = /^(https?:|\.\/|#|\/)/.test(href) ? href : '#';
    return `<a href="${safe}" rel="noopener">${label}</a>`;
  });
  return out;
}

/**
 * 解析 CHANGELOG.md
 * @returns {{ versions: Array<{version: string; date: string; unreleased: boolean; sections: Array<{title: string; items: string[]}>}> }}
 */
export function parseChangelog(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  const versions = [];
  let current = null;
  let section = null;

  for (const line of lines) {
    const versionMatch = /^##\s+\[([^\]]+)\](?:\s*-\s*(\d{4}-\d{2}-\d{2}))?/.exec(line);
    if (versionMatch) {
      current = {
        version: versionMatch[1],
        date: versionMatch[2] || '',
        unreleased: versionMatch[1] === '未发布',
        sections: [],
      };
      versions.push(current);
      section = null;
      continue;
    }
    const sectionMatch = /^###\s+(.+)$/.exec(line);
    if (sectionMatch && current) {
      section = { title: sectionMatch[1].trim(), items: [] };
      current.sections.push(section);
      continue;
    }
    const itemMatch = /^[-*]\s+(.+)$/.exec(line);
    if (itemMatch && section) {
      section.items.push(itemMatch[1].trim());
      continue;
    }
    // 续行：并入上一条
    if (section && section.items.length && /^\s{2,}\S/.test(line)) {
      section.items[section.items.length - 1] += ' ' + line.trim();
    }
  }
  return { versions };
}

/** 渲染单个版本的 HTML */
export function renderVersion(entry) {
  const heading = entry.unreleased
    ? `<h2>未发布 <span class="tag">开发中</span></h2>`
    : `<h2>${escapeHtml(entry.version)}${entry.date ? ` <time>${escapeHtml(entry.date)}</time>` : ''}</h2>`;
  const body = entry.sections.map((s) => {
    const items = s.items.length
      ? `<ul>${s.items.map((i) => `<li>${inlineMarkdown(i)}</li>`).join('')}</ul>`
      : '';
    return `<h3>${inlineMarkdown(s.title)}</h3>${items}`;
  }).join('');
  return `<section class="version">${heading}${body}</section>`;
}

export const CHANGELOG_CSS = `
:root{color-scheme:light dark;--bg:#f7f4ec;--card:#fffdf8;--ink:#26221b;--muted:#6b6459;--line:#e3dbcb;--gold:#a56d22;--jade:#1f7a63}
@media (prefers-color-scheme:dark){:root{--bg:#14140f;--card:#1c1b15;--ink:#f2ede1;--muted:#a49c8c;--line:#332f26;--gold:#e0b167;--jade:#5fd0ae}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.7 system-ui,-apple-system,"Segoe UI","Noto Sans SC",sans-serif}
main{max-width:760px;margin:0 auto;padding:32px 20px 64px}
h1{font-size:28px;margin:0 0 4px}
.lede{color:var(--muted);margin:0 0 24px}
.version{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px 18px;margin:16px 0}
.version h2{margin:0 0 8px;font-size:20px;display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
.version time,.version .tag{font-size:13px;color:var(--muted);font-weight:400}
.version .tag{border:1px solid var(--gold);color:var(--gold);border-radius:999px;padding:1px 8px}
.version h3{margin:14px 0 6px;font-size:15px;color:var(--jade)}
ul{margin:6px 0 0;padding-left:20px}
li{margin:4px 0}
code{background:rgba(127,127,127,.14);border-radius:5px;padding:1px 5px;font-size:13px}
a{color:var(--gold)}
footer{margin-top:28px;color:var(--muted);font-size:14px}
`;

/** 渲染完整页面 */
export function renderChangelogPage(parsed, options = {}) {
  const title = options.title || '青词天路 · 更新日志';
  const back = options.backHref || './';
  const sections = parsed.versions.map(renderVersion).join('\n');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="青词天路（CET-4 全卷修仙）版本更新记录">
<style>${CHANGELOG_CSS}</style>
</head>
<body>
<main>
<h1>更新日志</h1>
<p class="lede">按时间倒序展示每个版本的变化。完整开发记录见仓库中的 <code>CHANGELOG.md</code>。</p>
${sections}
<footer><a href="${escapeHtml(back)}">← 返回应用</a> · 本页为静态页面，不加载任何外部资源。</footer>
</main>
</body>
</html>
`;
}

/** 构建：写 dist/changelog.html（公开更新日志页；不内联进单文件，避免体积膨胀） */
export function buildChangelog(options = {}) {
  const markdown = options.markdown ?? fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  const parsed = parseChangelog(markdown);
  const html = renderChangelogPage(parsed, {
    backHref: options.backHref || './',
    title: options.title,
  });
  const outHtml = options.outHtml ?? path.join(ROOT, 'dist', 'changelog.html');
  fs.mkdirSync(path.dirname(outHtml), { recursive: true });
  fs.writeFileSync(outHtml, html, 'utf8');
  return { parsed, html, outHtml, versions: parsed.versions.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const result = buildChangelog();
  console.log('📜 更新日志已生成');
  console.log('   版本条目: ' + result.versions);
  console.log('   页面: ' + path.relative(ROOT, result.outHtml) + '（' + (Buffer.byteLength(result.html) / 1024).toFixed(1) + ' KB）');
}
