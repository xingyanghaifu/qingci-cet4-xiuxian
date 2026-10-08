'use strict';
/**
 * 核心纯逻辑：随机数、哈希、工具函数、境界计算、艾宾浩斯间隔重复、词库统计
 * 与 DOM 完全解耦，可被浏览器脚本与 Node 测试共同引用。
 */

/** FNV-1a 哈希：把任意字符串映射为 32 位无符号整数，用于固定题序 */
function hash(text) {
  return [...String(text)].reduce((n, ch) => Math.imul(n ^ ch.charCodeAt(0), 16777619) >>> 0, 2166136261);
}

/** 以种子构造确定性伪随机数发生器（mulberry32），保证同一种子题目一致 */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 从数组中不重复地抽取 n 个元素，随机源可注入 */
function pick(list, n, rand) {
  const bag = list.slice();
  const out = [];
  while (out.length < n && bag.length) out.push(bag.splice(Math.floor(rand() * bag.length), 1)[0]);
  return out;
}

/** 统计英文词数，用于写作题字数校验 */
function wordsOf(text) {
  return (String(text).match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) || []).length;
}

/** HTML 转义，防止题目内容注入 */
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** 按日期生成 YYYY-MM-DD 键，用于按天统计 */
function dayKey(d) {
  const t = d || new Date();
  return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
}

/**
 * 距考试天数，最少返回 1
 *
 * P2-15：`examDate` 不再给硬编码默认值 —— 调用方必须显式传入
 * （服务端 `worker/index.mjs` / `server.mjs` 从 EXAM_CONFIGS 取，
 * 前端走 `src/services/study-plan.ts` 的 `DEFAULT_EXAM_DATE`）。
 * 这里只在完全没传时用「今天」兜底，返回 1，避免悄悄用某个过期日期算出离谱天数。
 */
function examDays(examDate, now) {
  const cur = now || new Date();
  const exam = examDate ? new Date(examDate) : cur;
  return Math.max(1, Math.ceil((exam - cur) / 86400000));
}

/**
 * 境界计算：累计灵气 -> 当前境界名与进度
 * @param {number} qi 累计灵气
 * @param {Array<[string, number]>} realms 境界表 [[名称, 所需灵气], ...]
 */
function realmOf(qi, realms) {
  let left = Math.max(0, Number(qi) || 0);
  const table = realms && realms.length ? realms : [];
  for (let i = 0; i < table.length; i++) {
    if (left < table[i][1]) return { name: table[i][0], into: left, cap: table[i][1], index: i };
    left -= table[i][1];
  }
  return { name: '词仙', into: 1, cap: 1, index: table.length };
}

/** 艾宾浩斯间隔（天）：不认识/模糊/认识/熟练 */
const REVIEW_GAPS = { again: 0.25, hard: 1, good: 3, easy: 7 };

/**
 * 计算下一次复习时间
 * @returns {{level:string,next:number,tries:number}}
 */
function scheduleWord(prev, quality, now) {
  const gap = REVIEW_GAPS[quality];
  if (gap === undefined) throw new Error('未知的复习等级: ' + quality);
  const base = now || Date.now();
  const old = prev || {};
  return { level: quality, next: base + gap * 86400000, tries: (old.tries || 0) + 1 };
}

/** 找出已到期的复习词 */
function dueWords(schedule, now) {
  const base = now || Date.now();
  return Object.keys(schedule || {}).filter((w) => schedule[w] && schedule[w].next <= base);
}

/**
 * 判断拼写是否答对：忽略大小写与非字母字符
 * @returns {{ok:boolean, near:boolean}} near 表示很接近（长度差≤1 且首字母相同）
 */
function checkSpell(input, answer) {
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z]/g, '');
  const a = norm(input), b = norm(answer);
  const ok = a.length > 0 && a === b;
  const near = !ok && a.length > 1 && b.length > 0 && Math.abs(a.length - b.length) <= 1 && a[0] === b[0];
  return { ok, near };
}

/** 从中文释义中提取词性前缀，如 "n.狐狸" -> "n." */
function posOf(zh) {
  const m = String(zh).match(/^\s*([a-z.]{1,8}\.)/);
  return m ? m[1] : '';
}

/** 打乱选项并保证答案位置随机但可复现 */
function shuffleOptions(options, rand) {
  return options.map((x) => [rand(), x]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
}

/** 计算由「已斩获/心魔」推导的掌握度百分比 */
function masteryPercent(knownCount, total) {
  if (!total) return 0;
  return Math.round((knownCount / total) * 100);
}

/** 环形进度条的 stroke-dashoffset，circumference=302 */
function ringOffset(percent, circumference) {
  const c = circumference || 302;
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  return c - (c * p) / 100;
}

/** 汇总近 N 日正确题数，返回 [{key,label,right}] */
function recentDays(days, n, now) {
  const base = now || Date.now();
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const dt = new Date(base - i * 86400000);
    const k = dayKey(dt);
    const rec = (days && days[k]) || { right: 0, wrong: 0 };
    out.push({ key: k, label: dt.getMonth() + 1 + '/' + dt.getDate(), right: rec.right || 0, wrong: rec.wrong || 0 });
  }
  return out;
}

/** 多考试类型配置：题目均为原创练习，公开材料需单独核验许可后再加入 */
const EXAM_CONFIGS = Object.freeze({
  junior: { id: 'junior', name: '初中英语', level: 1, pass: 60, total: 100, count: 40, minutes: 45, source: '原创练习', description: '基础词汇、语法与短文理解' },
  senior: { id: 'senior', name: '高中英语', level: 2, pass: 60, total: 100, count: 50, minutes: 60, source: '原创练习', description: '高中词汇、语法与阅读理解' },
  pets3: { id: 'pets3', name: 'PETS-3', level: 3, pass: 60, total: 100, count: 60, minutes: 90, source: '原创练习', description: '公共英语三级能力训练' },
  cet4: { id: 'cet4', name: 'CET-4', level: 4, pass: 425, total: 710, count: 57, minutes: 125, source: '原创模拟', description: '四级结构模拟，不是真题' },
  cet6: { id: 'cet6', name: 'CET-6', level: 5, pass: 425, total: 710, count: 57, minutes: 130, source: '原创练习', description: '六级难度原创训练，不是真题' },
});
function getExamConfig(id) { return EXAM_CONFIGS[id] || EXAM_CONFIGS.cet4; }
function difficultyForRealm(realmIndex, examLevel) { return Math.max(1, Math.min(5, Number(examLevel || 1) + Math.floor(Number(realmIndex || 0) / 2))); }
function canBreakthrough(score, examId) { const e = getExamConfig(examId); return Number(score) >= e.pass; }
function examPassResult(correct, examId) { const e = getExamConfig(examId); const score = Math.round((Math.max(0, correct) / e.count) * e.total); return { score, pass: score >= e.pass, passLine: e.pass, exam: e.id }; }

/** 依据模拟卷得分计算是否及格参照线（425） */
function paperScore(gates, got) {
  let score = 0;
  gates.filter((g) => g.id !== 'speak').forEach((g) => {
    const hit = Math.min(g.count, (got && got[g.id]) || 0);
    score += Math.round((g.weight * hit) / g.count);
  });
  return score;
}

/* ───────────────── 内联词库编解码（体积优化） ─────────────────
 *
 * 背景：单文件里内联的 CET-4 词库（4540 词）原本是**对象数组**：
 *
 *     [{"w":"a","ipa":"","zh":"art.一(个)；每一(个)","short":"一"}, …]
 *
 * 每个词条重复四个键名（`"w":` / `"ipa":` / `"zh":` / `"short":`）约 23 字节，
 * 4540 条就是 **约 102 KB** —— 纯粹的键名开销，零信息量。
 *
 * 改为**列式紧凑格式**（外层是「列名 + 列数据」）：
 *
 *     {"k":["w","ipa","zh","short"],"v":[["a","",…],["a.m","",…]]}
 *
 * 实测：381 904 B → 约 270 KB，省 **约 102 KB**。
 * 单文件预算（19 KB 增量）此前只剩 6.04 KB，这一步把可用空间提到约 108 KB。
 *
 * **兼容两种格式**：`decodeLexicon()` 同时接受「对象数组」（旧/外部数据）
 * 与「紧凑列式」（新构建产物）。这样词库分片（wordlist.json 仍是对象数组）、
 * 测试夹具、外部脚本都不受影响 —— 只改内联那一份。
 */

/** 紧凑词库的字段顺序（与 `LexiconEntry` 对应；改这里等于改格式，需同步构建脚本） */
const LEXICON_KEYS = Object.freeze(['w', 'ipa', 'zh', 'short']);

/**
 * 把词条数组编码为紧凑格式。
 * @param {Array<object>} entries 形如 `[{w,ipa,zh,short}, …]`
 * @returns {{k: string[], v: any[][]}}
 */
function encodeLexicon(entries) {
  const list = Array.isArray(entries) ? entries : [];
  return {
    k: LEXICON_KEYS.slice(),
    v: list.map((e) => LEXICON_KEYS.map((key) => (e && e[key] != null ? e[key] : ''))),
  };
}

/**
 * 把任意形态的词库数据解码为**对象数组**（统一出口）。
 *
 * 接受的输入：
 *   · 对象数组 `[{w,ipa,zh,short}, …]`  → 原样返回（不复制）
 *   · 紧凑列式 `{k:[…],v:[[…],…]}`      → 还原为对象数组
 *   · 其它 / 非法                        → 返回 `[]`（绝不抛错，调用方零防御）
 */
function decodeLexicon(data) {
  if (!data) return [];
  // 已是对象数组
  if (Array.isArray(data)) return data;
  // 紧凑列式
  const keys = Array.isArray(data.k) ? data.k : null;
  const rows = Array.isArray(data.v) ? data.v : null;
  if (!keys || !rows) return [];
  const out = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const obj = {};
    if (Array.isArray(row)) {
      for (let j = 0; j < keys.length; j++) obj[keys[j]] = row[j] != null ? row[j] : '';
    } else if (row && typeof row === 'object') {
      // 容错：列式里混入对象行（手工编辑过）→ 直接用
      for (const k of keys) if (row[k] != null) obj[k] = row[k];
    }
    out[i] = obj;
  }
  return out;
}

/** 从 HTML 文本里取出内联词库并解码（供构建脚本 / Worker / 测试共用） */
function lexiconFromHtml(html) {
  const m = /<script id="lexicon" type="application\/json">([\s\S]*?)<\/script>/.exec(String(html || ''));
  if (!m) return [];
  try {
    return decodeLexicon(JSON.parse(m[1]));
  } catch {
    return [];
  }
}

module.exports = {
  hash, rng, pick, wordsOf, esc, dayKey, examDays, realmOf, REVIEW_GAPS,
  scheduleWord, dueWords, checkSpell, posOf, shuffleOptions, masteryPercent,
  ringOffset, recentDays, paperScore, EXAM_CONFIGS, getExamConfig,
  difficultyForRealm, canBreakthrough, examPassResult,
  LEXICON_KEYS, encodeLexicon, decodeLexicon, lexiconFromHtml,
};
