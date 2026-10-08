/**
 * 完整修行录备份（导出 / 导入）
 *
 * ── 这份测试在防什么（真实缺陷） ──
 * 原有「导出」只写 `JSON.stringify(state)` —— 只有 localStorage 那一份。
 * 但修行数据实际分散在两处，**IndexedDB 里有 17 个仓**：
 * 心魔录、错题本与 SM-2 复习日志、词汇 SRS、库存（护道符/记忆丹/参悟古籍）、
 * 灵石流水、灵田、洞府装饰、道场、渡劫记录、对局、传功…
 *
 * 实测（真浏览器）：造出心魔 + 护道符 + 流水 + 洞府装饰后走原导出，
 * 产物只有 **562 B** 的 localStorage，上述 IDB 数据**一条都不在里面**。
 * 而 `docs/产品方案.md` 把「已提供导出/导入 JSON」当作
 * 「localStorage 清缓存丢进度」这条风险的**唯一对策** ——
 * 即：用户以为备份了，实际心魔录/复习队列/库存/灵田/道场全都没备份。
 * 这与红线「不得造成用户数据丢失」直接冲突。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTs } from './helpers/load-ts.mjs';
import { makeFakeIdb } from './helpers/fake-idb.mjs';

const ROOT = join(import.meta.dirname, '..');
const B = await loadTs('src/services/backup.ts');
const IDB = await loadTs('src/services/idb.ts');

/** 内存 localStorage */
function memStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    _map: map,
  };
}

/* ───────── 一、格式识别 ───────── */

test('格式：新备份带 format 标识，可被识别', () => {
  assert.equal(B.BACKUP_FORMAT, 'qingci-backup/1');
  assert.equal(B.isBackupFile({ format: B.BACKUP_FORMAT, state: {}, stores: {} }), true);
});

test('格式：旧版纯 state 导出仍可识别（向后兼容）', () => {
  // 旧导出就是 JSON.stringify(state)，没有 format
  assert.equal(B.isBackupFile({ qi: 100, spirit: 50, known: {} }), false, '无 state 字段的裸 state 不算（无法与任意 JSON 区分）');
  assert.equal(B.isBackupFile({ state: { qi: 1 } }), true, '带 state 的旧格式应识别');
});

test('格式：无关 JSON / 非法输入一律拒绝', () => {
  for (const bad of [null, undefined, 0, '', 'x', 42, [], true, {}]) {
    assert.equal(B.isBackupFile(bad), false, `输入 ${JSON.stringify(bad)} 不应被当备份`);
  }
});

/* ───────── 二、导出：必须覆盖 IDB 全部用户数据仓 ───────── */

test('导出：包含 localStorage 修行录 + 全部用户数据仓', async () => {
  const idb = makeFakeIdb();
  const store = memStorage({ [B.DEFAULT_STATE_KEY]: JSON.stringify({ qi: 120, spirit: 30 }) });
  const backup = await B.collectBackup({ storage: store, factory: idb, now: 1_700_000_000_000 });
  assert.equal(backup.format, B.BACKUP_FORMAT);
  assert.deepEqual(backup.state, { qi: 120, spirit: 30 }, '修行录应原样带上');
  assert.ok(backup.exportedAt, '应有导出时间');
  // 关键：用户资产仓必须都在（心魔/库存/灵田/洞府/道场/流水/错题/词汇…）
  for (const s of ['demons', 'inventory', 'spiritField', 'cave', 'sect', 'qiLog',
    'mistakes', 'mistakesLex', 'vocab', 'vocabLex', 'tribulations', 'duels', 'transmissions', 'encounters', 'attempts', 'reports']) {
    assert.ok(s in backup.stores, `导出缺仓 ${s} —— 该仓的用户数据不会被备份`);
  }
});

test('导出：只跳过「可再生缓存」仓（datasets / meta）', async () => {
  const idb = makeFakeIdb();
  const backup = await B.collectBackup({ storage: memStorage(), factory: idb });
  assert.deepEqual([...B.DEFAULT_SKIP_STORES].sort(), ['datasets', 'meta']);
  assert.ok(!('datasets' in backup.stores), 'datasets 是可再生缓存，不应导出（体积大）');
  assert.ok(!('meta' in backup.stores), 'meta 是运行期元信息，不应导出');
});

test('导出：localStorage 不可用时 state 为 null，但仍导出 IDB（不整体失败）', async () => {
  const idb = makeFakeIdb();
  const backup = await B.collectBackup({ storage: null, factory: idb });
  assert.equal(backup.state, null);
  assert.ok(Object.keys(backup.stores).length > 10, 'IDB 仓仍应导出');
});

test('导出：损坏的 state JSON 不抛错（回落 null）', async () => {
  const idb = makeFakeIdb();
  const backup = await B.collectBackup({ storage: memStorage({ [B.DEFAULT_STATE_KEY]: '{坏 JSON' }), factory: idb });
  assert.equal(backup.state, null);
});

/* ───────── 三、导入：合并语义（不丢数据） ───────── */

test('导入：state 写回 localStorage', async () => {
  const store = memStorage();
  const res = await B.applyBackup(
    { format: B.BACKUP_FORMAT, state: { qi: 999 }, stores: {} },
    { storage: store },
  );
  assert.equal(res.ok, true);
  assert.equal(res.stateApplied, true);
  assert.deepEqual(JSON.parse(store.getItem(B.DEFAULT_STATE_KEY)), { qi: 999 });
});

test('导入：IDB 各仓逐条写回，并报告条数', async () => {
  const idb = makeFakeIdb();
  const res = await B.applyBackup(
    { format: B.BACKUP_FORMAT, state: {}, stores: {
      demons: [{ id: 'd1', level: 2 }, { id: 'd2', level: 1 }],
      inventory: [{ id: 'talisman', count: 3 }],
    } },
    { storage: memStorage(), factory: idb },
  );
  assert.equal(res.ok, true);
  assert.equal(res.restored.demons, 2);
  assert.equal(res.restored.inventory, 1);
});

test('导入：是**合并**而非清空（既有数据不被抹掉）', async () => {
  const idb = makeFakeIdb();
  // 先写入一条「用户已有」的记录
  const db = await IDB.openAppDatabase(idb);
  await new Promise((r) => { const tx = db.transaction('demons', 'readwrite'); const q = tx.objectStore('demons').put({ id: 'keep', level: 5 }); q.onsuccess = () => r(); });
  // 再导入一条不同 id
  const res = await B.applyBackup(
    { format: B.BACKUP_FORMAT, state: {}, stores: { demons: [{ id: 'imported', level: 1 }] } },
    { storage: memStorage(), factory: idb },
  );
  assert.equal(res.restored.demons, 1);
  // 两条都应在
  const rows = await new Promise((r) => { const tx = db.transaction('demons', 'readonly'); const q = tx.objectStore('demons').getAll(); q.onsuccess = () => r(q.result); });
  const ids = rows.map((x) => x.id).sort();
  assert.deepEqual(ids, ['imported', 'keep'], '导入不应清空既有记录（合并语义）');
});

test('导入：旧版备份（仅 state，无 stores）可用，且标记 legacy', async () => {
  const store = memStorage();
  const res = await B.applyBackup({ state: { qi: 7 } }, { storage: store });
  assert.equal(res.legacy, true);
  assert.equal(res.stateApplied, true);
  assert.deepEqual(JSON.parse(store.getItem(B.DEFAULT_STATE_KEY)), { qi: 7 });
});

test('导入：非法文件被拒，且不写任何数据', async () => {
  const store = memStorage();
  for (const bad of [null, {}, [], 'x', { foo: 1 }]) {
    const res = await B.applyBackup(bad, { storage: store });
    assert.equal(res.ok, false, `输入 ${JSON.stringify(bad)} 应被拒`);
    assert.ok(res.errors.length > 0, '应给出拒绝原因（不静默）');
    assert.equal(store.getItem(B.DEFAULT_STATE_KEY), null, '不应写入任何数据');
  }
});

test('导入：单个仓写入失败不影响其它仓，且如实报告', async () => {
  const store = memStorage();
  const broken = {
    open: () => { throw new Error('boom'); },
  };
  const res = await B.applyBackup(
    { format: B.BACKUP_FORMAT, state: { qi: 1 }, stores: { demons: [{ id: 'x' }] } },
    { storage: store, factory: broken },
  );
  assert.equal(res.stateApplied, true, 'state 仍应写入成功');
  assert.ok(res.errors.some((e) => /无法打开本地数据库|写入失败/.test(e)), '应如实报告仓失败');
});

/* ───────── 四、摘要与计数 ───────── */

test('摘要：新备份说明含仓数与条数；旧备份明说「不含本地数据」', () => {
  const desc = B.describeBackup({ format: B.BACKUP_FORMAT, state: {}, stores: { a: [1, 2], b: [3] } });
  assert.ok(/2 个数据仓/.test(desc) && /3 条/.test(desc), `摘要应含仓数与条数：${desc}`);
  const legacy = B.describeBackup({ state: {} });
  assert.ok(/旧版备份/.test(legacy) && /不含/.test(legacy), `旧备份应明说局限：${legacy}`);
  assert.equal(B.describeBackup(null), '不是有效的备份');
});

test('计数：统计备份内记录总数', () => {
  assert.equal(B.backupRecordCount({ stores: { a: [1, 2, 3], b: [] } }), 3);
  assert.equal(B.backupRecordCount({}), 0);
  assert.equal(B.backupRecordCount(null), 0);
});

/* ───────── 五、静态守卫：仓的键型必须与导入实现兼容 ───────── */

test('守卫：非跳过仓必须都是「内联键」或「自增键」（导入用 put(row) 才安全）', () => {
  // 为什么：导入一律 `put(row)`（不带显式键）—— 因为 autoIncrement 仓带键会抛 DataError。
  // 但这只在「仓有 keyPath 或 autoIncrement」时成立：
  // **out-of-line 键仓**（无 keyPath 且无 autoIncrement）用 put(row) 会抛 DataError。
  // 目前只有 datasets / meta 是 out-of-line，而它们都在跳过名单里 ——
  // 本测试把这条依赖钉死：将来若新增 out-of-line 仓却忘了加入跳过名单，立刻失败。
  const src = readFileSync(join(ROOT, 'src', 'services', 'idb.ts'), 'utf8');
  const re = /createObjectStore\(IDB_STORES\.(\w+)(?:\s*,\s*(\{[^}]*\}))?\)/g;
  const outOfLine = [];
  for (const m of src.matchAll(re)) {
    const name = m[1];
    const opts = m[2] || '';
    const hasKeyPath = /keyPath/.test(opts);
    const hasAuto = /autoIncrement/.test(opts);
    if (!hasKeyPath && !hasAuto) outOfLine.push(name);
  }
  assert.ok(outOfLine.length > 0, '未解析到任何仓，正则可能失效');
  const skipped = new Set(B.DEFAULT_SKIP_STORES);
  const uncovered = outOfLine.filter((n) => !skipped.has(n));
  assert.deepEqual(uncovered, [],
    `以下仓是 out-of-line 键，但不在跳过名单里 —— 导入时 put(row) 会抛 DataError：${uncovered.join(', ')}`);
});

test('守卫：跳过名单里的仓必须真实存在（防止拼错导致漏备份）', () => {
  const src = readFileSync(join(ROOT, 'src', 'services', 'idb.ts'), 'utf8');
  for (const name of B.DEFAULT_SKIP_STORES) {
    assert.ok(new RegExp(`createObjectStore\\(IDB_STORES\\.${name}\\)`).test(src),
      `跳过名单里的 ${name} 在 idb.ts 里找不到 —— 可能是拼写错误`);
  }
});

test('守卫：修行录的 localStorage 键必须与模板一致（否则备份里没有 state）', () => {
  // 真实教训：我初版把键写成 'qingci.state'（凭印象），
  // 真浏览器验收立刻显示 `hasState: false` —— **修行录本身没被备份**。
  // 这是「同一个常量两处各写一份」的典型坑，故用测试把两边钉在一起。
  const html = readFileSync(join(ROOT, 'src', 'index.template.html'), 'utf8');
  const m = html.match(/(?:const|var)\s+KEY\s*=\s*"([^"]+)"/);
  assert.ok(m, '模板里找不到 localStorage 键定义（const KEY = "..."）');
  assert.equal(B.DEFAULT_STATE_KEY, m[1],
    `备份用的键(${B.DEFAULT_STATE_KEY}) 与模板的键(${m[1]}) 不一致 —— 备份会漏掉修行录`);
});

/* ───────── 六、接线契约 ───────── */

test('接线：模板导出必须走 backup.collect（不再只导 localStorage）', () => {
  const html = readFileSync(join(ROOT, 'src', 'index.template.html'), 'utf8');
  // 模板用局部别名 `var BK = window.QingciServices.backup` 再 `BK.collect()`，
  // 所以断言「取了 backup 服务」+「调用了 collect/apply」两件事，而不是写死某个前缀。
  assert.ok(/QingciServices\.backup/.test(html),
    '模板未取 backup 服务 —— 心魔/库存/灵田等 IDB 数据不会被备份');
  assert.ok(/\bBK\.collect\s*\(/.test(html),
    '模板导出未调用 backup.collect —— 仍只导 localStorage');
  assert.ok(/\bBK\.apply\s*\(/.test(html),
    '模板导入未调用 backup.apply —— 无法恢复 IDB 数据');
  // 反向守卫：不得再出现「只导 state」的老写法
  assert.ok(!/new Blob\(\[JSON\.stringify\(state\)\]/.test(html),
    '模板仍存在「只导 state」的旧写法 —— IDB 数据会静默漏备份');
});

test('接线：散功必须同时清 IndexedDB（否则「已散功」后心魔/库存仍在）', () => {
  const html = readFileSync(join(ROOT, 'src', 'index.template.html'), 'utf8');
  assert.ok(/\bBK\.clearAll\b/.test(html),
    '散功未清 IndexedDB —— 与提示语「清空全部修行录」不符');
});
