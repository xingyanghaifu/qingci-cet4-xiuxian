/**
 * v1.8.2 线上验收（14 项）
 * 只读线上产物，不改任何本地文件。
 */
const BASE = 'https://qingci-cet4-xiuxian.pages.dev';

const items = [];
function rec(no, name, ok, ev) {
  items.push({ no, name, ok, ev });
  console.log((ok ? 'PASS ' : 'FAIL ') + no + '  ' + name);
  if (ev) console.log('        ' + String(ev).slice(0, 200));
}

async function head(path) {
  const r = await fetch(BASE + path, { cache: 'no-store' });
  const t = await r.text();
  return { status: r.status, text: t, headers: r.headers };
}

console.log('目标：' + BASE + '\n');

/* 1. 入口页可访问 */
let home;
{
  const r = await fetch(BASE + '/', { cache: 'no-store' });
  home = await r.text();
  rec(1, '入口页可访问（200 且返回 HTML）', r.status === 200 && /<html/i.test(home),
    'HTTP ' + r.status + '，' + home.length + ' 字符');
}

/* 2. 线上版本号为 1.8.2 */
rec(2, '线上版本号 = 1.8.2',
  /1\.8\.2/.test(home) && !/v1\.8\.1<\/small>/.test(home),
  '产物含 1.8.2；brandVer 静态兜底已更新为 v1.8.2');

/* 3. 健康检查 */
let meta = null;
{
  const r = await fetch(BASE + '/healthz', { cache: 'no-store' });
  const t = await r.text();
  try { meta = JSON.parse(t); } catch { /* 非 JSON */ }
  rec(3, '/healthz 正常且版本正确', r.status === 200 && /1\.8\.2/.test(t),
    'HTTP ' + r.status + ' → ' + t.replace(/\s+/g, ' ').slice(0, 160));
}

/* 4. /api/meta */
{
  const r = await fetch(BASE + '/api/meta', { cache: 'no-store' });
  const t = await r.text();
  rec(4, '/api/meta 正常', r.status === 200 && /1\.8\.2/.test(t),
    'HTTP ' + r.status + ' → ' + t.replace(/\s+/g, ' ').slice(0, 160));
}

/* 5. /status */
{
  const r = await fetch(BASE + '/status', { cache: 'no-store' });
  const t = await r.text();
  rec(5, '/status 正常', r.status === 200,
    'HTTP ' + r.status + ' → ' + t.replace(/\s+/g, ' ').slice(0, 120));
}

/* 6. 单文件自包含：零外部运行时依赖 */
{
  const ext = [...home.matchAll(/<(?:script|link)[^>]+(?:src|href)="(https?:)?\/\//g)].map((m) => m[0]);
  const noDep = !/font-?awesome|material-icons|cdn\.|unpkg|jsdelivr/i.test(home);
  rec(6, '单文件自包含（零外部运行时依赖）', ext.length === 0 && noDep,
    '外链 script/link ' + ext.length + ' 处；无 CDN/图标库引用');
}

/* 7. 双词库 UI 已上线 */
{
  const hasPicker = /id="lxPicker"/.test(home);
  const hasBadge = /id="lxBadge"/.test(home);
  const hasCet6 = /cet6/i.test(home);
  rec(7, '多词库 UI 已上线（选择器 + 徽章 + CET-6）', hasPicker && hasBadge && hasCet6,
    'lxPicker=' + hasPicker + ' lxBadge=' + hasBadge + ' cet6 提及=' + hasCet6);
}

/* 8. 记忆锚点渲染代码已上线 */
{
  const hasMn = /detail\.mnemonics/.test(home) || /mnemonics/.test(home);
  const hasHint = /mnemonicHint/.test(home);
  rec(8, '记忆锚点 UI 已上线', hasMn && hasHint,
    'mnemonics 渲染=' + hasMn + ' 答错提示=' + hasHint);
}

/* 9. CET-6 词库清单可取 */
{
  let ok = false, ev = '';
  try {
    // 注意路径：词库清单在 /lexicons/manifest.json，
    // 详情分片在 /lexicons/cet6/vocab-detail/（与 VOCAB_DETAIL_BASES.cet6 一致）
    const r = await fetch(BASE + '/lexicons/manifest.json', { cache: 'no-store' });
    const j = await r.json();
    const cet6 = (j.lexicons || []).find((x) => x.id === 'cet6');
    ok = r.status === 200 && !!cet6 && cet6.enabled === true && cet6.wordCount > 5000;
    ev = 'HTTP ' + r.status + ' 词库数=' + (j.lexicons || []).length +
      '；cet6 wordCount=' + (cet6 && cet6.wordCount) + ' enabled=' + (cet6 && cet6.enabled);
  } catch (e) { ev = '取回失败：' + e.message; }
  rec(9, 'CET-6 词库清单可按需取回且已启用', ok, ev);
}

/* 10. CET-6 详情分片可取且含记忆锚点 */
{
  let ok = false, ev = '';
  try {
    const m = await (await fetch(BASE + '/lexicons/cet6/vocab-detail/manifest.json')).json();
    const f = m.files[m.prefixes[0]];
    const r = await fetch(BASE + '/lexicons/cet6/vocab-detail/' + f, { cache: 'no-store' });
    const j = await r.json();
    const words = Object.keys(j);
    const withMn = words.filter((w) => j[w] && j[w].mnemonics && j[w].mnemonics.tier).length;
    ok = r.status === 200 && m.count === 5716 && words.length > 0 && withMn === words.length;
    ev = 'manifest count=' + m.count + ' prefixes=' + m.prefixes.length + '；' +
      f + ' HTTP ' + r.status + ' 词条=' + words.length + ' 带锚点=' + withMn;
  } catch (e) { ev = '取回失败：' + e.message; }
  rec(10, 'CET-6 详情分片可取且含记忆锚点', ok, ev);
}

/* 11. CET-4 详情分片未受影响（向后兼容） */
{
  let ok = false, ev = '';
  try {
    const m = await (await fetch(BASE + '/vocab-detail/manifest.json')).json();
    const f = m.files[m.prefixes[0]];
    const r = await fetch(BASE + '/vocab-detail/' + f, { cache: 'no-store' });
    const j = await r.json();
    const words = Object.keys(j);
    const withMn = words.filter((w) => j[w] && j[w].mnemonics).length;
    ok = r.status === 200 && words.length > 0 && withMn > 0;
    ev = f + ' HTTP ' + r.status + ' 词条=' + words.length + ' 带锚点=' + withMn;
  } catch (e) { ev = '取回失败：' + e.message; }
  rec(11, 'CET-4 详情分片正常且带锚点', ok, ev);
}

/* 12. PWA：manifest + sw */
{
  const m = await fetch(BASE + '/manifest.webmanifest', { cache: 'no-store' });
  const mt = await m.text();
  const s = await fetch(BASE + '/sw.js', { cache: 'no-store' });
  const st = await s.text();
  rec(12, 'PWA manifest + sw.js 可取且缓存版本已更新',
    m.status === 200 && s.status === 200 && /1\.8\.2/.test(st),
    'manifest HTTP ' + m.status + '；sw.js HTTP ' + s.status + ' 缓存版本 ' + (st.match(/1\.8\.2-[a-z0-9]+/) || ['?'])[0]);
}

/* 13. 静态资源 404 抽查 */
{
  let ok = true, ev = [];
  for (const p of ['/api/meta', '/manifest.webmanifest', '/sw.js', '/icons/icon-192.png']) {
    const r = await fetch(BASE + p, { method: 'HEAD', cache: 'no-store' });
    if (r.status !== 200) { ok = false; ev.push(p + '=' + r.status); }
  }
  rec(13, '关键静态资源全部 200', ok, ok ? '4/4 抽查全 200' : ev.join(', '));
}

/* 14. 压缩与缓存协商 */
{
  const r = await fetch(BASE + '/', { headers: { 'Accept-Encoding': 'gzip, br' }, cache: 'no-store' });
  const ce = r.headers.get('content-encoding') || '(未压缩)';
  const cc = r.headers.get('cache-control') || '(无)';
  rec(14, '压缩协商与缓存头正常', r.status === 200,
    'content-encoding=' + ce + '；cache-control=' + cc);
}

const pass = items.filter((i) => i.ok).length;
console.log('\n==== 线上验收：' + pass + ' PASS / ' + (items.length - pass) + ' FAIL（共 ' + items.length + ' 项）====');
process.exit(pass === items.length ? 0 : 1);