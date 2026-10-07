/**
 * P2-14 · 词汇详解的离线承诺（审计第 14 项）
 *
 * 审计原文：「描述里写了『断网可用』，但查词详情走 api.dictionaryapi.dev，**并未缓存**。」
 *
 * 实测**不成立**：`src/services/vocab-detail.ts` 早就有三级链
 *   1) 本地分片（构建产出，SW 按需缓存）
 *   2) IndexedDB（含 API 联网结果，`idbPut` 写回）
 *   3) Free Dictionary API（仅在线时）
 * 而且 UI 对「未缓存」的情况有**明确披露**（「详情数据尚未缓存；联网后打开一次即可离线保存」）。
 *
 * 但审计仍然有价值 —— 它暴露了**这条链一个测试都没有**：
 * `getVocabDetail` 此前零覆盖，等于「离线承诺」全靠人肉保证。
 * 本文件把三级链逐级钉死，包括最容易坏的一环：**API 结果必须写回 IDB**。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTs } from './helpers/load-ts.mjs';
import { makeFakeIdb } from './helpers/fake-idb.mjs';

const ROOT = join(import.meta.dirname, '..');
const src = readFileSync(join(ROOT, 'src', 'services', 'vocab-detail.ts'), 'utf8');

/**
 * 起一个可控环境：假 fetch（按 URL 路由）+ 假 IDB。
 * 注意 `loadTs` 每个用例都要重新加载模块 —— 模块内有 manifest/shard/detail
 * 三层内存缓存，跨用例复用会互相污染。
 */
/** Node 里 `globalThis.navigator` 是 getter-only，必须用 defineProperty 覆盖 */
function setNavigator(value) {
  Object.defineProperty(globalThis, 'navigator', {
    value, configurable: true, writable: true,
  });
}

async function boot({ shards = {}, api = {}, online = true } = {}) {
  const calls = [];
  const idb = makeFakeIdb();

  const fetchStub = async (url) => {
    const u = String(url);
    calls.push(u);
    if (u.includes('manifest.json')) {
      return {
        ok: true,
        json: async () => ({ schema: 'qingci-vocab-detail/1', count: 2, prefixes: ['a', 'z'], files: { a: 'a.json', z: 'z.json' } }),
      };
    }
    if (u.includes('dictionaryapi.dev')) {
      const word = decodeURIComponent(u.split('/').pop() || '');
      const entry = api[word];
      if (!entry) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, json: async () => [entry] };
    }
    // 分片
    for (const [file, data] of Object.entries(shards)) {
      if (u.endsWith(file)) return { ok: true, json: async () => data };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };

  const g = globalThis;
  const saved = { fetch: g.fetch, indexedDB: g.indexedDB, navigator: g.navigator };
  g.fetch = fetchStub;
  g.indexedDB = idb;
  setNavigator({ onLine: online });

  const mod = await loadTs('src/services/vocab-detail.ts');
  // 关键：loadTs 复用同一模块实例，模块内的 manifest/shard/detail 三层内存缓存
  // 会跨用例残留（实测踩过：上一个用例查过的词让下一个用例误判 source=local）。
  // 每个用例开始前必须清空，否则测的不是「IDB 命中」而是「内存缓存命中」。
  if (typeof mod.__resetVocabDetailCache === 'function') mod.__resetVocabDetailCache();

  return {
    mod, calls, idb,
    restore() {
      if (typeof mod.__resetVocabDetailCache === 'function') mod.__resetVocabDetailCache();
      if (saved.fetch === undefined) delete g.fetch; else g.fetch = saved.fetch;
      if (saved.indexedDB === undefined) delete g.indexedDB; else g.indexedDB = saved.indexedDB;
      setNavigator(saved.navigator);
    },
  };
}

const API_ENTRY = {
  word: 'serendipity',
  phonetic: '/ˌserənˈdɪpəti/',
  meanings: [{
    partOfSpeech: 'noun',
    definitions: [{ definition: '意外发现珍奇事物的能力', example: 'a moment of serendipity' }],
  }],
};

test('P2-14：本地分片命中 → source=local，且写回 IDB', async () => {
  const env = await boot({ shards: { 'a.json': { abandon: { word: 'abandon', meanings: [{ partOfSpeech: 'v', definitions: [{ definition: '放弃' }] }] } } } });
  try {
    const r = await env.mod.getVocabDetail('abandon');
    assert.ok(r, '本地分片命中却返回 null');
    assert.equal(r.source, 'local');
    assert.equal(r.detail.word, 'abandon');
    // 关键：命中本地也要写回 IDB，否则断网且分片被清时就读不到了
    await new Promise((res) => setTimeout(res, 10));
    assert.ok(env.idb._count('datasets') >= 1, '本地命中后未写回 IDB');
  } finally { env.restore(); }
});

test('P2-14：本地分片未命中 → 走 API，且结果写回 IDB（审计说的缺口）', async () => {
  const env = await boot({ shards: { 'a.json': {} }, api: { serendipity: API_ENTRY } });
  try {
    const r = await env.mod.getVocabDetail('serendipity');
    assert.ok(r, 'API 有数据却返回 null');
    assert.equal(r.source, 'api', '应从 API 取到');
    // 这是审计质疑的那一环：API 结果必须落盘
    await new Promise((res) => setTimeout(res, 10));
    assert.ok(env.idb._count('datasets') >= 1, 'API 结果未写回 IDB —— 离线就再也读不到了');
    assert.ok(env.calls.some((u) => u.includes('dictionaryapi.dev')), '未请求 API');
  } finally { env.restore(); }
});

test('P2-14：离线时，联网拿过的词从 IDB 命中（source=cache）—— 离线承诺成立', async () => {
  const idb = makeFakeIdb();
  const g = globalThis;
  const saved = { fetch: g.fetch, indexedDB: g.indexedDB, navigator: g.navigator };
  g.indexedDB = idb;
  // 注意：loadTs 按路径缓存模块，两次调用拿到的是**同一个实例**（内存缓存仍在）。
  // 所以不能用「重新 import」模拟冷启动 —— 要用模块导出的 __resetVocabDetailCache()。
  const mod = await loadTs('src/services/vocab-detail.ts');
  let apiDetail;
  try {
    // 第一段：联网，把词写进 IDB（分片为空，逼它走 API）
    g.fetch = async (url) => {
      const u = String(url);
      if (u.includes('manifest.json')) {
        return { ok: true, json: async () => ({ schema: 'x', count: 1, prefixes: ['s'], files: { s: 's.json' } }) };
      }
      if (u.endsWith('s.json')) return { ok: true, json: async () => ({}) };
      if (u.includes('dictionaryapi.dev')) return { ok: true, json: async () => [API_ENTRY] };
      return { ok: false, status: 404, json: async () => ({}) };
    };
    setNavigator({ onLine: true });
    const warm = await mod.getVocabDetail('serendipity');
    assert.equal(warm.source, 'api', '预热失败：应从 API 取到');
    apiDetail = warm.detail;
    await new Promise((res) => setTimeout(res, 10));

    // 第二段：断网 + 清内存缓存（IDB 保留）
    setNavigator({ onLine: false });
    g.fetch = async () => { throw new Error('offline'); };
    mod.__resetVocabDetailCache();
    const r = await mod.getVocabDetail('serendipity');
    assert.ok(r, '离线时读不到已缓存的详情 —— 离线承诺不成立');
    assert.equal(r.source, 'cache', `离线应命中 IDB 缓存，实际 source=${r.source}`);
    assert.equal(r.detail.word, 'serendipity');
    assert.deepEqual(r.detail.meanings, apiDetail.meanings, '缓存内容与联网时不一致');
  } finally {
    mod.__resetVocabDetailCache();
    if (saved.fetch === undefined) delete g.fetch; else g.fetch = saved.fetch;
    if (saved.indexedDB === undefined) delete g.indexedDB; else g.indexedDB = saved.indexedDB;
    setNavigator(saved.navigator);
  }
});

test('P2-14：离线且从未缓存 → 返回 null（UI 必须给出兜底文案）', async () => {
  const env = await boot({ shards: { 'a.json': {} }, online: false });
  try {
    const r = await env.mod.getVocabDetail('never-seen-word');
    assert.equal(r, null, '离线且无缓存应返回 null');
    // 不该在离线时还去请求 API
    assert.ok(!env.calls.some((u) => u.includes('dictionaryapi.dev')),
      '离线时不应请求 API（浪费一次失败等待）');
  } finally { env.restore(); }
});

test('P2-14：API 返回 404 → 返回 null，且不写脏数据进 IDB', async () => {
  const env = await boot({ shards: { 'a.json': {} }, api: {} });
  try {
    const r = await env.mod.getVocabDetail('nonexistent');
    assert.equal(r, null);
    await new Promise((res) => setTimeout(res, 10));
    assert.equal(env.idb._count('datasets'), 0, '404 不应写入 IDB');
  } finally { env.restore(); }
});

/* ---------------- 静态不变式：承诺必须与实现一致 ---------------- */

test('P2-14：SW 不拦截跨域请求（否则 API 回退会被 Service Worker 吞掉）', () => {
  const sw = readFileSync(join(ROOT, 'src', 'sw.template.js'), 'utf8');
  assert.ok(/url\.origin\s*!==\s*self\.location\.origin\)\s*return/.test(sw),
    'SW 必须放行跨域请求（dictionaryapi.dev），否则联网回退永远失败');
});

test('P2-14：UI 对「未缓存」有明确披露，不是无声失败', () => {
  const html = readFileSync(join(ROOT, 'src', 'index.template.html'), 'utf8');
  assert.ok(/详情数据尚未缓存；联网后打开一次即可离线保存/.test(html),
    'UI 未披露「未缓存」状态 —— 离线承诺就成了空话');
  assert.ok(/离线模式下暂无详情/.test(html), '缺离线兜底文案');
});

test('P2-14：详情分片不进 SW 预缓存（体积考虑），但按需缓存策略必须在', () => {
  const sw = readFileSync(join(ROOT, 'src', 'sw.template.js'), 'utf8');
  // 预缓存列表里不应有 vocab-detail 分片（14.75 MB 不能预缓存）
  const shell = sw.match(/const SHELL_ASSETS = \[([\s\S]*?)\];/);
  assert.ok(shell, '未找到 SHELL_ASSETS');
  assert.ok(!/vocab-detail\/[a-z]+\.json/.test(shell[1]),
    '详情分片不应进预缓存（体积太大）');
  // 但通用 stale-while-revalidate 必须覆盖它们（按需缓存）
  assert.ok(/stale-while-revalidate|RUNTIME_CACHE/.test(sw),
    '缺按需缓存策略 —— 分片看过一次也无法离线复用');
});

test('P2-14：描述文案与实际能力对齐（不断言超出实现的话）', () => {
  const html = readFileSync(join(ROOT, 'src', 'index.template.html'), 'utf8');
  // 「断网可用」出现在描述里。它成立的前提是：核心学习链路（词库/题库/详情分片）
  // 都能按需缓存。上面几条测试已经逐级验证；这里只确认文案没有被夸大：
  // 不应出现「任何词都能离线查」这类做不到的承诺。
  assert.ok(!/任意单词.*离线|所有单词.*离线详解/.test(html),
    '文案夸大了离线能力（API 专属词必须先联网一次）');
});
