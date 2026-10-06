// 核实审计里的 P0 五条。只报事实，不下结论。
const BASE = 'https://qingci-cet4-xiuxian.pages.dev';
const get = async (p, method = 'GET') => {
  const r = await fetch(BASE + p, { method, cache: 'no-store' });
  const t = r.status === 200 && method === 'GET' ? await r.text() : '';
  return { status: r.status, ct: (r.headers.get('content-type') || '').split(';')[0], len: t.length, body: t };
};

console.log('=== P0-1 基础文件 ===');
for (const p of ['/robots.txt', '/sitemap.xml', '/404.html', '/.nojekyll', '/manifest.webmanifest']) {
  const r = await get(p);
  const isHtml = r.body.trimStart().startsWith('<!DOCTYPE') || r.body.trimStart().startsWith('<html');
  console.log(`  ${p.padEnd(22)} ${r.status} ${r.ct.padEnd(24)} ${isHtml ? '❌ 回落到首页 HTML' : '✅ 真实文件'}`);
}

const html = (await get('/')).body;
console.log('\n=== P0-3 og / canonical ===');
for (const k of ['og:image', 'og:url', 'canonical', 'twitter:image', 'twitter:card', 'og:title', 'og:description']) {
  console.log(`  ${k.padEnd(18)} ${html.includes(k) ? '✅ 存在' : '❌ 缺失'}`);
}

console.log('\n=== P0-4 路由 ===');
for (const k of ['pushState', 'replaceState', 'hashchange', 'popstate', 'location.hash']) {
  const n = (html.match(new RegExp(k.replace('.', '\\.'), 'g')) || []).length;
  console.log(`  ${k.padEnd(16)} 出现 ${n} 次`);
}
console.log(`  switchTab( 调用    ${(html.match(/switchTab\(/g) || []).length} 次`);

console.log('\n=== P0-5 版本号 ===');
console.log(`  build 注释        ${(html.match(/build: qingci-cet4-xiuxian v[\d.]+/) || [])[0]}`);
console.log(`  页脚/可见 v1.8.2  ${html.includes('v1.8.2') ? '⚠️ 仍出现' : '无'}`);

console.log('\n=== P1 抽查 ===');
console.log(`  role="dialog"     ${(html.match(/role="dialog"/g) || []).length} 个`);
console.log(`  body.style.overflow ${(html.match(/body\.style\.overflow|document\.body\.style\.overflow/g) || []).length} 次`);
console.log(`  confirm(          ${(html.match(/[^.\w]confirm\(/g) || []).length} 次`);
console.log(`  aria-label        ${(html.match(/aria-label=/g) || []).length} 处`);

console.log('\n=== P2-13 主题 ===');
console.log(`  color-scheme      ${(html.match(/<meta name="color-scheme"[^>]*>/) || [])[0]}`);
const tm = html.match(/dataset\.theme\s*=\s*'dark'/);
console.log(`  p===null 强制 dark ${tm ? '✅ 存在（与 color-scheme: light dark 矛盾）' : '不存在'}`);

console.log('\n=== P2-14 离线 ===');
console.log(`  dictionaryapi.dev ${html.includes('dictionaryapi.dev') ? '⚠️ 引用了外部词源' : '无'}`);
console.log('\n=== P2-15 日期 ===');
console.log(`  2026-12-12 出现    ${(html.match(/2026-12-12/g) || []).length} 处`);
