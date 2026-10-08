/**
 * 词库档案（v1.8.2 阶段 A · 多词库架构）
 *
 * 设计原则（三条硬约束的落地）：
 *
 * 1. **默认仍是 CET-4，用户不切换则行为不变**。
 *    `currentLexiconId()` 在 localStorage 无记录时返回 `DEFAULT_LEXICON_ID`，
 *    存储层所有隔离字段（`lx`）在「默认词库」下都读作 `'cet4'`。
 *
 * 2. **零外部依赖**：本模块是纯数据 + 纯函数，不 fetch、不碰 DOM、不依赖
 *    IndexedDB —— 只负责「现在处于哪个词库」与「清单长什么样」的判定。
 *
 * 3. **不把未上线的词库说成可用**：`enabled: false` 的词库在选择器里
 *    灰显 + `aria-disabled`，`switchLexicon()` 会拒绝切换，绝不静默失败。
 *
 * 与存储层的关系：本模块**不 import** vocab-srs / mistake-store 等业务模块
 * （与 cultivation.ts 同样的「纯展示层不反向依赖业务层」约定），
 * 业务层只反过来读取这里的 `currentLexiconId()`。
 */

/** 词库档案（清单里的一条） */
export interface Lexicon {
  /** 稳定标识：'cet4' | 'cet6' | 'kaoyan' | 'toefl' | 'ielts' | 'cefr' */
  id: string;
  /** 全称：'大学英语四级' */
  name: string;
  /** 短名（状态栏展示）：'CET-4' */
  shortName: string;
  /** 词条数（清单声明值，实际加载后以 manifest.count 为准） */
  wordCount: number;
  description: string;
  sourceUrl: string;
  sourceLicense: string;
  /** 是否对用户开放；false 时选择器灰显且拒绝切换 */
  enabled: boolean;
  /** 详情分片目录（相对站点根）：'vocab-detail/' 或 'lexicons/cet6/vocab-detail/' */
  dataPath: string;
  /** 词表分片目录（相对站点根），未构建时为空 */
  wordListPath?: string;
  /**
   * 近似词库标记（v1.9.1 阶段 F · PRETCO）。
   * true 表示「词库数据复用另一词库、只新增特色题库」，UI 据此明示近似关系，
   * 不让用户误以为这是官方词表。缺省即 false。
   */
  approximation?: boolean;
}

/** 词库清单 */
export interface LexiconManifest {
  version: string;
  lexicons: Lexicon[];
  defaultLexiconId: string;
}

/** 词库选择器的 localStorage 键 */
export const LEXICON_CURRENT_KEY = 'lexicon.current';

/** 默认词库（CET-4）—— 唯一允许在缺省状态下生效的词库 */
export const DEFAULT_LEXICON_ID = 'cet4';

/** 详情分片清单的地址（各词库共用同构格式，按 dataPath 前缀拼接） */
export const LEXICON_ROOT = 'lexicons/';

/**
 * 内置兜底清单。
 *
 * 为什么内置一份而不是只靠 fetch：
 *   file:// 双击打开、或清单尚未部署时，UI 不能白屏。内置清单只声明
 *   「有哪些词库、默认是谁」，词条数与实际分片以运行时 manifest 为准。
 */
export const FALLBACK_LEXICONS: readonly Lexicon[] = [
  {
    id: 'cet4',
    name: '大学英语四级',
    shortName: 'CET-4',
    wordCount: 4540,
    description: '四级大纲词汇，现行默认词库。',
    sourceUrl: 'https://github.com/mahavivo/english-wordlists',
    sourceLicense: 'MIT',
    enabled: true,
    dataPath: 'vocab-detail/',
    wordListPath: '',
  },
  {
    id: 'cet6',
    name: '大学英语六级',
    shortName: 'CET-6',
    wordCount: 0,
    description: '六级大纲词汇，与四级部分重叠；进度、错题与复习队列独立。',
    sourceUrl: 'https://github.com/mahavivo/english-wordlists',
    sourceLicense: 'MIT',
    enabled: true,
    dataPath: 'lexicons/cet6/vocab-detail/',
    wordListPath: 'lexicons/cet6/',
  },
  {
    // v1.9.0 阶段 A：初中（中考）——默认不选中，用户需主动切换（硬约束 8）
    id: 'junior',
    name: '初中词汇（中考）',
    shortName: '初中',
    wordCount: 2028,
    description: '中考课标核心 1603 词 + 拓展词；进度、错题与复习队列独立。',
    sourceUrl: 'https://github.com/skywind3000/ECDICT',
    sourceLicense: 'MIT',
    enabled: true,
    dataPath: 'lexicons/junior/vocab-detail/',
    wordListPath: 'lexicons/junior/',
  },
  {
    // v1.9.0 阶段 B：高中（高考）——同样默认不选中（硬约束 8）；
    // 词数以站点清单为准，这里只兜离线首屏
    id: 'senior',
    name: '高中词汇（高考）',
    shortName: '高中',
    wordCount: 3770,
    description: '高考课标核心 3677 词 + 拓展词；与四级重叠词标 inCET4，进度独立。',
    sourceUrl: 'https://github.com/skywind3000/ECDICT',
    sourceLicense: 'MIT',
    enabled: true,
    dataPath: 'lexicons/senior/vocab-detail/',
    wordListPath: 'lexicons/senior/',
  },
  {
    // v1.9.1 阶段 E：考研（ECDICT tag:ky，4801 词）—— 默认不选中（硬约束 8）
    id: 'kaoyan',
    name: '全国硕士研究生招生考试英语',
    shortName: '考研',
    wordCount: 4801,
    description: '考研英语核心词汇 4801 词；与四级重叠词标 inCET4，进度、错题与复习队列独立。',
    sourceUrl: 'https://github.com/skywind3000/ECDICT',
    sourceLicense: 'MIT',
    enabled: true,
    dataPath: 'lexicons/kaoyan/vocab-detail/',
    wordListPath: 'lexicons/kaoyan/',
  },
  {
    // v1.10 第一批：GRE（ECDICT tag:gre，实测 7504 词，达预期 100%）。
    // 与考研同一套机制（tagFilter + 重叠标记），进度 / 错题 / 复习队列独立。
    id: 'gre',
    name: 'GRE 美国研究生入学考试',
    shortName: 'GRE',
    wordCount: 7504,
    description: 'GRE 核心词汇 7504 词（ECDICT tag:gre）；与四级重叠词标 inCET4，进度、错题与复习队列独立。',
    sourceUrl: 'https://github.com/skywind3000/ECDICT',
    sourceLicense: 'MIT',
    enabled: true,
    dataPath: 'lexicons/gre/vocab-detail/',
    wordListPath: 'lexicons/gre/',
  },
  {
    // v1.10 第二批：IELTS（ECDICT tag:ielts，实测 5040 词）。
    id: 'ielts',
    name: '雅思（IELTS）',
    shortName: 'IELTS',
    wordCount: 5040,
    description: '雅思核心词汇 5040 词（ECDICT tag:ielts）；与四级重叠词标 inCET4，进度、错题与复习队列独立。',
    sourceUrl: 'https://github.com/skywind3000/ECDICT',
    sourceLicense: 'MIT',
    enabled: true,
    dataPath: 'lexicons/ielts/vocab-detail/',
    wordListPath: 'lexicons/ielts/',
  },
  {
    // v1.10 第三批：TOEFL（ECDICT tag:toefl，实测 6974 词）。
    id: 'toefl',
    name: '托福（TOEFL）',
    shortName: 'TOEFL',
    wordCount: 6974,
    description: '托福核心词汇 6974 词（ECDICT tag:toefl）；与四级重叠词标 inCET4，进度、错题与复习队列独立。',
    sourceUrl: 'https://github.com/skywind3000/ECDICT',
    sourceLicense: 'MIT',
    enabled: true,
    dataPath: 'lexicons/toefl/vocab-detail/',
    wordListPath: 'lexicons/toefl/',
  },
  {
    // v1.9.1 阶段 F：PRETCO 近似卡（探活结论见 docs/probe-pretco.md）。
    // 公开领域无 PRETCO 词表（五路径全零命中），而 PRETCO-A 词汇 ≈ CET-4 核心子集 ——
    // 真正的差异在**题型**。故词库数据复用 CET-4 分片（不重复占用空间），
    // 只新增 PRETCO 特色题库（语法结构 / 听力短对话 / 英译汉 / 应用文）。
    // 进度按 `pretco` 独立作用域存储（复合键仓），与 CET-4 互不污染。
    id: 'pretco',
    name: 'PRETCO 高等学校英语应用能力考试（近似）',
    shortName: 'PRETCO',
    wordCount: 4540,
    description: '基于 CET-4 词库 + PRETCO 特色题型（语法结构 / 英译汉）。',
    sourceUrl: '近似方案，非官方词表（词库数据复用 CET-4 / MIT）',
    sourceLicense: 'MIT',
    enabled: true,
    dataPath: 'vocab-detail/',
    approximation: true,
  },
];

export const FALLBACK_MANIFEST: LexiconManifest = {
  version: '1',
  lexicons: [...FALLBACK_LEXICONS],
  defaultLexiconId: DEFAULT_LEXICON_ID,
};

/* ---------------- localStorage 安全读写（隐私模式 / file:// 下不抛错） ---------------- */

function readStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** 归一化：只接受清单里存在且 enabled 的 id，否则回落到默认词库 */
function normalize(id: unknown, lexicons: readonly Lexicon[]): string {
  const s = String(id == null ? '' : id).trim();
  if (!s) return DEFAULT_LEXICON_ID;
  const hit = lexicons.find((l) => l.id === s);
  if (!hit) return DEFAULT_LEXICON_ID;
  return hit.enabled ? hit.id : DEFAULT_LEXICON_ID;
}

/**
 * 当前词库 id。
 * @param lexicons 已知清单；缺省用内置兜底清单
 */
export function currentLexiconId(lexicons: readonly Lexicon[] = FALLBACK_LEXICONS): string {
  const store = readStorage();
  if (!store) return DEFAULT_LEXICON_ID;
  try {
    return normalize(store.getItem(LEXICON_CURRENT_KEY), lexicons);
  } catch {
    return DEFAULT_LEXICON_ID;
  }
}

/** 当前词库档案；找不到时回落到默认词库档案 */
export function currentLexicon(lexicons: readonly Lexicon[] = FALLBACK_LEXICONS): Lexicon {
  const id = currentLexiconId(lexicons);
  return lexicons.find((l) => l.id === id) || lexicons[0] || FALLBACK_LEXICONS[0];
}

/**
 * 切换词库。
 *
 * 返回值语义：**只有真正写入了一个已上线词库才返回 true**。
 * 未上线 / 未知 id 一律返回 false 且不写盘 —— 不能因为「归一化后恰好等于
 * 当前默认词库」就报成功，否则调用方会以为切换成功了（UI 里就会显示
 * 「已切换」，而实际词库根本没变）。
 *
 * @returns 是否切换成功（未上线词库 / 非法 id / localStorage 不可用均返回 false）
 */
export function switchLexicon(id: string, lexicons: readonly Lexicon[] = FALLBACK_LEXICONS): boolean {
  const want = String(id == null ? '' : id).trim();
  const target = lexicons.find((l) => l.id === want);
  // 目标不存在或未上线 → 拒绝，不写盘
  if (!target || !target.enabled) return false;
  if (want === currentLexiconId(lexicons)) return true;
  const store = readStorage();
  if (!store) return false;
  try {
    store.setItem(LEXICON_CURRENT_KEY, want);
    return true;
  } catch {
    return false;
  }
}

/**
 * 清单解析：把任意 JSON 收敛成合法的 LexiconManifest。
 * 非法 / 缺字段条目直接丢弃，默认词库缺失时补一个 cet4 —— 保证 UI 永远有词可用。
 */
export function parseManifest(raw: unknown): LexiconManifest {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Partial<LexiconManifest>;
  const seen = new Set<string>();
  const lexicons: Lexicon[] = [];
  for (const item of Array.isArray(src.lexicons) ? src.lexicons : []) {
    if (!item || typeof item !== 'object') continue;
    const l = item as Partial<Lexicon>;
    const id = String(l.id || '').trim();
    if (!id || seen.has(id)) continue;
    if (!l.name || !l.shortName) continue;
    seen.add(id);
    lexicons.push({
      id,
      name: String(l.name),
      shortName: String(l.shortName),
      wordCount: Number(l.wordCount) || 0,
      description: String(l.description || ''),
      sourceUrl: String(l.sourceUrl || ''),
      sourceLicense: String(l.sourceLicense || ''),
      enabled: l.enabled !== false,
      dataPath: String(l.dataPath || ''),
      wordListPath: l.wordListPath ? String(l.wordListPath) : undefined,
      approximation: l.approximation === true,
    });
  }
  if (!lexicons.length) return { ...FALLBACK_MANIFEST, lexicons: [...FALLBACK_LEXICONS] };
  const wantDefault = String(src.defaultLexiconId || DEFAULT_LEXICON_ID);
  const defaultLexiconId = lexicons.some((l) => l.id === wantDefault && l.enabled)
    ? wantDefault
    : (lexicons.find((l) => l.enabled) || lexicons[0]).id;
  return {
    version: String(src.version || '1'),
    lexicons,
    defaultLexiconId,
  };
}

/** 按 id 取档案；找不到返回 undefined */
export function lexiconById(id: string, lexicons: readonly Lexicon[]): Lexicon | undefined {
  return lexicons.find((l) => l.id === id);
}

/** 可切换（已上线）的词库档案 */
export function enabledLexicons(lexicons: readonly Lexicon[]): Lexicon[] {
  return lexicons.filter((l) => l.enabled);
}