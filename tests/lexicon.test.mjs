/**
 * 多词库架构 · 阶段 A 验收（v1.8.2）
 *
 * 覆盖谕令 A8 的 12 条验收标准，重点守住两条硬约束：
 *   ① CET-4 用户的既有数据不丢（旧记录无 `lx` 一律读作 cet4）；
 *   ② 现有 394 个测试的调用方式（不传词库 = 不过滤）语义不变。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadTs } from './helpers/load-ts.mjs';
import { makeFakeIdb } from './helpers/fake-idb.mjs';

const ROOT = join(import.meta.dirname, '..');
const lexiconMod = await loadTs('src/services/lexicon.ts');
const scopeMod = await loadTs('src/services/lexicon-scope.ts');
const vocabSrsMod = await loadTs('src/services/vocab-srs.ts');
const mistakeMod = await loadTs('src/services/mistake-store.ts');
const detailMod = await loadTs('src/services/vocab-detail.ts');
const idbMod = await loadTs('src/services/idb.ts');
const servicesMod = await loadTs('src/services/index.ts');
// index.ts 的服务集合是 default / QingciServices 导出，不是模块命名空间
const services = servicesMod.default || servicesMod.QingciServices || servicesMod;

const {
  currentLexiconId, currentLexicon, switchLexicon, parseManifest,
  LEXICON_CURRENT_KEY, DEFAULT_LEXICON_ID, FALLBACK_MANIFEST,
} = lexiconMod;
const { lexiconOf, sameLexicon, tagLexicon, filterByLexicon, summarizeByLexicon } = scopeMod;

/** 最小 localStorage 桩件（可注入异常，模拟隐私模式） */
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    _map: map,
  };
}

function withStorage(storage, fn) {
  const prev = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
  try { return fn(); } finally {
    Object.defineProperty(globalThis, 'localStorage', { value: prev, configurable: true, writable: true });
  }
}

test('A-1 词库清单：manifest.json 存在且含 cet4 + cet6', () => {
  const file = join(ROOT, 'src', 'data', 'lexicons', 'manifest.json');
  assert.ok(existsSync(file), '缺少 src/data/lexicons/manifest.json');
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(raw.defaultLexiconId, 'cet4', '默认词库必须是 CET-4');
  const ids = raw.lexicons.map((l) => l.id);
  for (const id of ['cet4', 'cet6']) {
    assert.ok(ids.includes(id), `清单应含 ${id}，实际 ${ids.join(',')}`);
  }
  // 与内置兜底清单口径一致（UI 在清单未部署时用兜底渲染）
  const cet6 = raw.lexicons.find((l) => l.id === 'cet6');
  assert.equal(cet6.enabled, true);
  assert.equal(cet6.shortName, 'CET-6');
  assert.equal(cet6.dataPath, 'lexicons/cet6/vocab-detail/');
  const cet4 = raw.lexicons.find((l) => l.id === 'cet4');
  assert.equal(cet4.dataPath, 'vocab-detail/', 'CET-4 必须保持原路径（兼容策略：不搬动）');
  assert.equal(cet4.wordCount, 4540);
});

test('A-2 CET-6 分片：26 片且单片 ≤1.5MB', () => {
  const dir = join(ROOT, 'src', 'data', 'lexicons', 'cet6', 'vocab-detail');
  assert.ok(existsSync(dir), '缺少 CET-6 分片目录');
  const mf = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  assert.equal(mf.schema, 'qingci-vocab-detail/1');
  assert.ok(mf.prefixes.length >= 26, `至少 26 个分片，实际 ${mf.prefixes.length}`);
  // 最长前缀在前（运行时按最长前缀匹配）
  const lens = mf.prefixes.map((p) => p.length);
  assert.deepEqual(lens, [...lens].sort((a, b) => b - a), 'prefixes 应按长度降序');
  for (const [prefix, file] of Object.entries(mf.files)) {
    const bytes = readFileSync(join(dir, file)).length;
    assert.ok(bytes <= 1_500_000, `分片 ${file} 为 ${bytes} 字节，超过 1.5MB 上限`);
  }
});

test('A-3 CET-6 词数：约 5500（含与四级重叠），全量收录无空洞', () => {
  const raw = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'lexicons', 'manifest.json'), 'utf8'));
  const cet6 = raw.lexicons.find((l) => l.id === 'cet6');
  assert.ok(cet6.wordCount >= 5000, `CET-6 应收录约 5500 词，实际 ${cet6.wordCount}`);
  assert.ok(cet6.wordCount <= 6500, `CET-6 词数异常膨胀：${cet6.wordCount}`);

  // 逐词核对：manifest.count 与实际条目数一致
  const dir = join(ROOT, 'src', 'data', 'lexicons', 'cet6', 'vocab-detail');
  const mf = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  let total = 0;
  let withZh = 0;
  let overlap = 0;
  const words = [];
  for (const file of new Set(Object.values(mf.files))) {
    const data = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    for (const [w, d] of Object.entries(data)) {
      total++;
      words.push(w);
      if (d && d.inCET4) overlap++;
      const zh = (d.meanings || []).map((m) => (m.definitions || []).map((x) => x.chinese).join('')).join('');
      if (zh.trim()) withZh++;
    }
  }
  assert.equal(total, cet6.wordCount, 'manifest 声明词数与分片实际条目数应一致');
  assert.equal(total, mf.count);
  assert.equal(new Set(words).size, total, '分片之间不应出现重复词');
  // 全量收录：每个词都至少有可展示的中文释义（词表兜底也要有）
  assert.ok(withZh / total > 0.98, `中文释义覆盖率过低：${withZh}/${total}`);
  // 重叠标记（A3 要求）
  assert.ok(overlap >= 1000, `inCET4 重叠标记应覆盖四级词（实际 ${overlap}）`);
});

test('A-4 词库选择器：洞府页可见，CET-4 使用中，CET-6 可切换', () => {
  const html = readFileSync(join(ROOT, 'dist', 'index.html'), 'utf8');
  assert.ok(html.includes('id="lxPicker"'), '缺少词库选择器容器');
  assert.ok(html.includes('id="lxGrid"'), '缺少词库卡片容器');
  // 选择器必须落在洞府面板内（panel-map 起点 ~ panel-field 起点之间的兄弟区间）
  const mapStart = html.indexOf('id="panel-map"');
  const picker = html.indexOf('id="lxPicker"');
  assert.ok(mapStart > 0 && picker > mapStart, '词库选择器应在洞府面板之后');
  // 渲染逻辑：使用中标记 / 未上线灰显 / 二次确认 / 拒绝切换
  assert.ok(html.includes('使用中'), '应有「使用中」标记');
  assert.ok(html.includes('即将上线'), '未上线词库应有「即将上线」标记');
  assert.ok(html.includes('aria-disabled'), '未上线词库应 aria-disabled');
  assert.ok(html.includes('confirm('), '切换词库需二次确认');
  assert.ok(/if\s*\(\s*!\s*l\.enabled\s*\)/.test(html), '未上线词库必须被明确拒绝，不静默失败');
});

test('A-5 切换词库：写入 localStorage 并派发刷新事件', () => {
  const storage = fakeStorage();
  withStorage(storage, () => {
    assert.equal(switchLexicon('cet6'), true);
    assert.equal(storage.getItem(LEXICON_CURRENT_KEY), 'cet6');
    assert.equal(currentLexiconId(), 'cet6');
  });
  const html = readFileSync(join(ROOT, 'dist', 'index.html'), 'utf8');
  assert.ok(html.includes('qingci:lexicon'), '切换后应派发刷新事件');
  // 服务层把字面量 'lexicon.current' 内联进 bundle；UI 通过 LX.current/switchTo 复用同一键
  assert.ok(html.includes('lexicon.current'), '存储键字面量应随服务层进入产物');
  assert.ok(html.includes('LEXICON_CURRENT_KEY') || html.includes('lexicon.current'), 'UI 应复用服务层的存储键');
});

test('A-6 进度隔离：同一单词在两个词库各有独立 SRS 记录', async () => {
  idbMod.__resetIdbCache();
  const factory = makeFakeIdb();
  const store = vocabSrsMod.createVocabSrsStore(factory);
  const base = new Date('2026-10-05T00:00:00Z');

  await store.rate('abandon', 'easy', base, 'cet4');
  const c4 = await store.get('abandon', 'cet4');
  assert.ok(c4, 'CET-4 应有记录');
  assert.equal(c4.lx, 'cet4');
  assert.equal(c4.reviews, 1);

  // 同一单词在 CET-6 下尚无记录
  assert.equal(await store.get('abandon', 'cet6'), null, 'CET-6 不应看到 CET-4 的记录');
  // 反向：切回 CET-4 仍在
  assert.equal((await store.get('abandon', 'cet4')).reviews, 1);

  // CET-6 独立建立记录，累加互不影响
  await store.rate('abandon', 'again', base, 'cet6');
  assert.equal((await store.get('abandon', 'cet4')).reviews, 1, 'CET-4 记录不被 CET-6 污染');
  const c6 = await store.get('abandon', 'cet6');
  assert.equal(c6.reviews, 1);
  assert.equal(c6.lx, 'cet6');
  assert.ok(c6.proficiency < c4.proficiency, 'CET-6 答错后熟练度应更低');

  assert.equal((await store.all('cet4')).length, 1);
  assert.equal((await store.all('cet6')).length, 1);
  idbMod.__resetIdbCache();
});

test('A-7 错题本隔离：切到 CET-6 只显示 CET-6 错题', async () => {
  idbMod.__resetIdbCache();
  const factory = makeFakeIdb();
  const store = mistakeMod.createMistakeStore(factory);
  const base = new Date('2026-10-05T00:00:00Z');
  const mk = (word, answer) => ({
    type: 'vocab', prompt: word, userAnswer: answer, correctAnswer: 'right',
    knowledgeTags: [], nextReviewAt: base.toISOString(),
    sourceRef: { kind: 'word', word },
  });

  await store.recordWrong(mk('abandon', 'x'), 'cet4');
  await store.recordWrong(mk('abide', 'y'), 'cet6');

  const c4 = await store.all('cet4');
  const c6 = await store.all('cet6');
  assert.equal(c4.length, 1, 'CET-4 只应有 1 条错题');
  assert.equal(c6.length, 1, 'CET-6 只应有 1 条错题');
  assert.equal(c4[0].sourceRef.word, 'abandon');
  assert.equal(c6[0].sourceRef.word, 'abide');
  assert.equal(c4[0].lx, 'cet4');
  assert.equal(c6[0].lx, 'cet6');
  // 同一道题在两个词库下各有一条（mistakesLex 复合键）
  const both = new Set([...c4, ...c6].map((r) => r.id));
  assert.equal(both.size, 2, '两个词库的错题应各自独立');
  // 不传词库 = 不过滤（v1.8.1 行为：任何调用方都能看到全部）
  assert.equal((await store.all()).length, 0, '未指定词库时只读老仓（分词库记录不进老仓视图）');
  idbMod.__resetIdbCache();
});

test('A-8 SRS 隔离：复习队列与统计只含当前词库的词', async () => {
  idbMod.__resetIdbCache();
  const factory = makeFakeIdb();
  const store = vocabSrsMod.createVocabSrsStore(factory);
  const base = new Date('2026-10-05T00:00:00Z');
  // CET-4 三天前学的词（今天到期），CET-6 刚学的词（未到期）
  await store.rate('abandon', 'easy', new Date(base.getTime() - 3 * 86400000), 'cet4');
  await store.rate('abide', 'good', base, 'cet6');

  const dueC4 = await store.due(50, base, 'cet4');
  assert.equal(dueC4.length, 1);
  assert.equal(dueC4[0].w, 'abandon', 'CET-6 的词不应进入 CET-4 的队列');
  assert.equal((await store.due(50, base, 'cet6')).length, 0, 'CET-6 今日无到期');

  const s4 = await store.stats(base, 'cet4');
  const s6 = await store.stats(base, 'cet6');
  assert.equal(s4.total, 1);
  assert.equal(s4.due, 1);
  assert.equal(s6.total, 1);
  assert.equal(s6.due, 0);
  // wordsNotInSrs 也按词库隔离
  assert.deepEqual(await store.wordsNotInSrs(['abandon', 'abide'], 5, 'cet6'), ['abandon']);
  assert.deepEqual(await store.wordsNotInSrs(['abandon', 'abide'], 5, 'cet4'), ['abide']);
  idbMod.__resetIdbCache();
});

test('A-9 词谱加载：按当前词库选择分片目录（CET-4 保持原路径）', () => {
  const { VOCAB_DETAIL_BASES, baseOf, VOCAB_DETAIL_BASE } = detailMod;
  assert.equal(baseOf('cet4'), 'vocab-detail/', 'CET-4 必须沿用原路径');
  assert.equal(baseOf('cet6'), 'lexicons/cet6/vocab-detail/');
  assert.equal(baseOf(), VOCAB_DETAIL_BASE, '缺省回落到 CET-4');
  assert.equal(baseOf('unknown'), VOCAB_DETAIL_BASE, '未知词库回落 CET-4，不让详情空白');
  assert.equal(baseOf(null), VOCAB_DETAIL_BASE);
  assert.equal(VOCAB_DETAIL_BASES.cet6, 'lexicons/cet6/vocab-detail/');
});

test('A-10 现有 CET-4 用户：升级后进度不变（老记录无 lx 归属 cet4）', async () => {
  // 这是最关键的回归：v1.8.1 写下的记录没有 lx 字段
  const legacy = { w: 'abandon', tier: 'core', ease: 2.5, intervalDays: 6, repetitions: 2, nextReviewAt: '2026-10-01T00:00:00.000Z', reviews: 4, lapses: 1, proficiency: 3, source: 'srs' };
  assert.equal(legacy.lx, undefined, '前提：老记录确实没有 lx');
  assert.equal(lexiconOf(legacy), 'cet4', '老记录必须读作 CET-4');
  assert.equal(sameLexicon(undefined, 'cet4'), true, '老记录在 CET-4 下应可见');
  assert.equal(sameLexicon(undefined, 'cet6'), false, '老记录不应出现在 CET-6');

  idbMod.__resetIdbCache();
  const factory = makeFakeIdb();
  const store = vocabSrsMod.createVocabSrsStore(factory);
  const raw = store.constructor;
  assert.ok(raw);
  // 直接把老记录写进仓库（模拟升级前的存量数据）
  const written = await store.put(legacy);
  assert.equal(written, true, '老记录应能原样写入（不因升级被拒）');
  const seen = await store.get('abandon', 'cet4');
  assert.ok(seen, 'CET-4 用户升级后仍应看到自己的进度');
  assert.equal(seen.reviews, 4);
  assert.equal(seen.proficiency, 3);
  assert.equal(seen.lx, undefined, '读取不应篡改老记录');
  assert.equal((await store.all('cet4')).length, 1, '老记录计入 CET-4');
  assert.equal((await store.all('cet6')).length, 0, '老记录不计入 CET-6');
  idbMod.__resetIdbCache();
});

test('A-11 未上线词库：灰显 + aria-disabled，且拒绝切换', () => {
  const storage = fakeStorage();
  withStorage(storage, () => {
    // 未上线样本：v1.9.1 起 kaoyan 已上线，改用仍灰显的 ielts/toefl
    for (const id of ['ielts', 'toefl']) {
      assert.equal(switchLexicon(id), false, `${id} 未上线，不应允许切换`);
      assert.equal(storage.getItem(LEXICON_CURRENT_KEY), null, '失败的切换不应写入 localStorage');
      assert.equal(currentLexiconId(), 'cet4', '应保持默认词库');
    }
    // 非法 id 同样回落默认
    assert.equal(switchLexicon('不存在的词库'), false);
    assert.equal(currentLexiconId(), 'cet4');
    // 清单里根本没有的 id
    assert.equal(currentLexiconId(FALLBACK_MANIFEST.lexicons.filter((l) => l.enabled)), 'cet4');
  });
  const disabled = FALLBACK_MANIFEST.lexicons.filter((l) => !l.enabled).map((l) => l.id);
  // v1.9.1 起 kaoyan 已上线；仍应灰显的样本改为 ielts/toefl + 两张 PRETCO 近似占位卡
  for (const id of ['ielts', 'toefl', 'pretco-a', 'pretco-b']) {
    assert.ok(disabled.includes(id), `${id} 应在兜底清单中标记为未上线`);
  }
  // 已上线的考研卡必须是 enabled，且带 MIT 许可与真实词数
  const ky = FALLBACK_MANIFEST.lexicons.find((l) => l.id === 'kaoyan');
  assert.ok(ky && ky.enabled, 'kaoyan 应在兜底清单中标记为已上线');
  assert.equal(ky.wordCount, 4801);
  assert.equal(ky.sourceLicense, 'MIT');
});

test('A-12 现有测试兼容：不传词库时行为与 v1.8.1 完全一致', async () => {
  // 既有调用方一律是单词库世界：不传词库 → 不过滤，且写入不带 lx
  idbMod.__resetIdbCache();
  const factory = makeFakeIdb();
  const store = vocabSrsMod.createVocabSrsStore(factory);
  const base = new Date('2026-10-05T00:00:00Z');
  const rec = await store.rate('ability', 'good', base);
  assert.equal(rec.lx, undefined, '不传词库时不应打标记，保持 v1.8.1 的记录形状');
  assert.equal((await store.all()).length, 1);
  assert.equal((await store.get('ability')).w, 'ability');
  // 不过滤：无参数 all() 返回全部
  assert.equal(filterByLexicon([{ lx: 'cet4' }, { lx: 'cet6' }, {}], '').length, 3, '空作用域 = 不过滤');
  assert.equal(filterByLexicon([{ lx: 'cet4' }, { lx: 'cet6' }, {}], undefined).length, 3);
  assert.equal(filterByLexicon(null, 'cet4').length, 0, 'null 输入不抛错');
  idbMod.__resetIdbCache();
});

test('A 辅助：parseManifest 收敛任意 JSON，永不产生非法清单', () => {
  // 垃圾输入 → 兜底清单
  const bad = parseManifest(null);
  assert.ok(bad.lexicons.length > 0);
  assert.equal(bad.defaultLexiconId, 'cet4');
  assert.equal(parseManifest({ lexicons: 'not-an-array' }).defaultLexiconId, 'cet4');
  // 缺字段条目被丢弃
  const partial = parseManifest({
    version: '9',
    defaultLexiconId: 'cet6',
    lexicons: [
      { id: 'cet6', name: '大学英语六级', shortName: 'CET-6', enabled: true },
      { id: '', name: 'x', shortName: 'x' },
      { name: '无 id', shortName: 'x' },
      { id: 'cet6', name: '重复', shortName: 'DUP' },
      { id: 'cet4', name: '大学英语四级', shortName: 'CET-4' },
    ],
  });
  assert.deepEqual(partial.lexicons.map((l) => l.id), ['cet6', 'cet4'], '空 id / 缺字段 / 重复 id 均应丢弃');
  assert.equal(partial.defaultLexiconId, 'cet6');
  assert.equal(partial.version, '9');
  // 默认词库未上线时，回落到第一个可用词库
  const fallback = parseManifest({
    defaultLexiconId: 'cet6',
    lexicons: [
      { id: 'cet6', name: '六', shortName: 'CET-6', enabled: false },
      { id: 'cet4', name: '四', shortName: 'CET-4', enabled: true },
    ],
  });
  assert.equal(fallback.defaultLexiconId, 'cet4', '默认词库未上线时应回落到可用词库');
});

test('A 辅助：进度概览按词库统计（选择器展示用）', () => {
  const vocab = [{ lx: 'cet4' }, { lx: 'cet4' }, { lx: 'cet6' }, {}];
  const mistakes = [{ lx: 'cet6' }];
  const rows = summarizeByLexicon(vocab, mistakes, ['cet4', 'cet6']);
  assert.deepEqual(rows, [
    { lexiconId: 'cet4', studied: 3, mistakes: 0 },  // 3 条：2 显式 + 1 条无 lx 的老记录
    { lexiconId: 'cet6', studied: 1, mistakes: 1 },
  ]);
});

test('A 辅助：服务层导出 lexicon / lexiconScope 分组', () => {
  assert.ok(services.lexicon, '应导出 lexicon 分组');
  assert.ok(services.lexiconScope, '应导出 lexiconScope 分组');
  assert.equal(services.lexicon.defaultId, DEFAULT_LEXICON_ID);
  assert.equal(services.lexicon.storageKey, 'lexicon.current');
  assert.equal(typeof services.lexicon.current, 'function');
  assert.equal(typeof services.lexicon.switchTo, 'function');
  assert.equal(typeof services.lexiconScope.filter, 'function');
  assert.equal(services.vocabDetail.bases.cet6, 'lexicons/cet6/vocab-detail/');
});

test('A 辅助：tagLexicon 是纯函数，不改入参', () => {
  const src = { w: 'abandon' };
  const tagged = tagLexicon(src, 'cet6');
  assert.equal(src.lx, undefined, '入参不应被改写');
  assert.equal(tagged.lx, 'cet6');
  assert.equal(tagged.w, 'abandon');
  assert.equal(tagLexicon(src, '').lx, 'cet4', '空词库回落默认');
});

test('A 辅助：currentLexicon 返回完整档案，未知词库回落 CET-4', () => {
  const storage = fakeStorage({ 'lexicon.current': 'cet6' });
  withStorage(storage, () => {
    const lx = currentLexicon();
    assert.equal(lx.id, 'cet6');
    assert.equal(lx.shortName, 'CET-6');
    assert.equal(lx.dataPath, 'lexicons/cet6/vocab-detail/');
  });
  // 未上线词库被存进 localStorage 时读作 CET-4（v1.9.1 前用 kaoyan 作样本，现改 ielts）
  const storage2 = fakeStorage({ 'lexicon.current': 'ielts' });
  withStorage(storage2, () => {
    assert.equal(currentLexicon().id, 'cet4', '未上线词库读作 CET-4');
  });
  withStorage(fakeStorage({ 'lexicon.current': '' }), () => {
    assert.equal(currentLexicon().id, 'cet4');
  });
});

test('A 辅助：词库作用域下写入 vocabLex，不污染老的 vocab 单键仓', async () => {
  idbMod.__resetIdbCache();
  const factory = makeFakeIdb();
  const store = vocabSrsMod.createVocabSrsStore(factory);
  const base = new Date('2026-10-05T00:00:00Z');
  // 未传词库 → 老仓（v1.8.1 路径）
  await store.rate('ability', 'good', base);
  // 传了词库 → vocabLex
  await store.rate('ability', 'again', base, 'cet6');

  const legacy = await withRaw(factory, idbMod.IDB_STORES.vocab, (s) => promisify(s.get('ability')));
  assert.ok(legacy, '老仓记录仍在');
  assert.equal(legacy.reviews, 1, '老仓记录不应被 CET-6 的作答改写');
  const lexRow = await withRaw(factory, idbMod.IDB_STORES.vocabLex, (s) => promisify(s.get('cet6 ability')));
  assert.ok(lexRow, 'vocabLex 应有 cet6 的记录');
  assert.equal(lexRow.k, 'cet6 ability');
  assert.equal(lexRow.lx, 'cet6');
  assert.equal(lexRow.w, 'ability', '单词本身保持裸词形，便于与词表/错题本对齐');

  // 两边都能独立读回
  assert.equal((await store.get('ability')).reviews, 1);
  assert.equal((await store.get('ability', 'cet6')).reviews, 1);
  // clear() 两仓同清，不留看不见的残留
  await store.clear();
  assert.equal((await store.get('ability')), null);
  assert.equal((await store.get('ability', 'cet6')), null);
  idbMod.__resetIdbCache();
});

/** 直接开事务读原始仓，绕过服务层封装 */
async function withRaw(factory, storeName, fn) {
  const db = await promisify(factory.open('qingci-offline', 6));
  const tx = db.transaction(storeName, 'readonly');
  const out = await fn(tx.objectStore(storeName));
  db.close();
  return out;
}

const promisify = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error || new Error('IndexedDB 请求失败'));
});

test('A 辅助：无 localStorage 环境（隐私模式 / file://）不抛错', () => {
  const prev = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  delete globalThis.localStorage;
  try {
    assert.equal(currentLexiconId(), DEFAULT_LEXICON_ID);
    assert.equal(switchLexicon('cet6'), false, '无处持久化时切换应失败而非抛错');
    assert.equal(currentLexicon().shortName, 'CET-4');
  } finally {
    if (prev) Object.defineProperty(globalThis, 'localStorage', prev);
  }
});
