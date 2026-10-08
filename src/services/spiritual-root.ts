/**
 * 灵根（修行天赋）—— 第三期玩法
 *
 * ── 为什么做这个 ──
 * 修仙叙事里「灵根」是**身份认同**的核心：五行灵根决定你擅长什么、走什么路。
 * 本项目此前**完全没有这个概念**（全仓库 grep「灵根」0 次），
 * 而它天然能挂到**已有的真实数据**上：`state.memStats` 已经按六种题型
 * 记录「答对 r / 总数 n」（`zh2en` / `en2zh` / `similar` / `listen` / `spell` / `pos`）。
 *
 * 于是灵根不是随便抽的，而是**从你的实际表现里长出来的** ——
 * 这符合本项目一贯的「游戏化服务于学习」原则：灵根让你看清自己的强弱项。
 *
 * ── 五系与六题型的映射（不是硬凑，有语义）──
 *
 *   金（metal）  ← spell（拼写默写）   ：锋芒精确，一字不差
 *   木（wood）   ← zh2en（中译英）     ：生长输出，主动生成
 *   水（water）  ← listen（听音辨词）  ：声流入耳，感知
 *   火（fire）   ← pos（词性判断）     ：洞察属性，快速辨析
 *   土（earth）  ← en2zh + similar     ：承载与分辨（理解 + 形近辨析）
 *
 * ── 三条红线（沿用既有约定）──
 *   1. **不制造焦虑**：灵根只是「倾向描述」，不是评分；样本不足时明说「未定」，
 *      绝不给用户贴「你很差」的标签；纯度低也只是「杂灵根」，那是特色不是缺陷。
 *   2. **不鼓励刷题**：灵根由**正确率**决定，不是题量 —— 多刷不涨纯度。
 *   3. **不侵入学习**：纯只读推导（读 memStats 算倾向），
 *      不改 SM-2/SRS、不写任何存档、不影响出题。
 *
 * ── 设计细节 ──
 *   · **样本门槛**：某系作答 < `MIN_SAMPLES`（默认 5）时视为「未显」，
 *     不参与判定 —— 避免「做了 1 题全对 → 灵根纯度 100%」这种荒谬结果。
 *   · **纯度**：最强系占「已显系」总作答的比重，映射为
 *     天灵根（单一主导）/ 双灵根 / 三灵根 / 杂灵根 —— 对应修仙设定里的资质层次。
 *   · **纯函数 + 可注入**：不碰 DOM/storage，便于完整单测。
 */

/** 五行 */
export type ElementId = 'metal' | 'wood' | 'water' | 'fire' | 'earth';

/** 灵根档位（对应修仙设定的资质层次） */
export type RootGrade = 'heaven' | 'dual' | 'triple' | 'mixed' | 'undetermined';

export interface ElementDef {
  id: ElementId;
  /** 单字（用于紧凑展示） */
  char: string;
  name: string;
  /** 五行色 token（模板里已有 --color-* 变量） */
  token: string;
  /** 对应的记忆题型 */
  kinds: string[];
  /** 该系的描述（「为什么是它」） */
  blurb: string;
  /**
   * 该系对应的**能力短名**（用于卡片第二列）。
   * 为什么不复用 name：name 是「金灵根」，与 char「金」并排会显示成「金 金」（冗余）。
   * 这里放的是「你靠什么题型修这一系」，对用户更有信息量。
   */
  skill: string;
}

/** 五系定义（顺序即展示顺序：金木水火土） */
export const ELEMENTS: readonly ElementDef[] = [
  {
    id: 'metal', char: '金', name: '金灵根', token: '--color-metal',
    kinds: ['spell'],
    blurb: '锋芒精确 · 拼写默写',
    skill: '拼写',
  },
  {
    id: 'wood', char: '木', name: '木灵根', token: '--color-wood',
    kinds: ['zh2en'],
    blurb: '生长输出 · 中译英',
    skill: '中译英',
  },
  {
    id: 'water', char: '水', name: '水灵根', token: '--color-water',
    kinds: ['listen'],
    blurb: '声流入耳 · 听音辨词',
    skill: '听音',
  },
  {
    id: 'fire', char: '火', name: '火灵根', token: '--color-fire',
    kinds: ['pos'],
    blurb: '洞察属性 · 词性判断',
    skill: '词性',
  },
  {
    id: 'earth', char: '土', name: '土灵根', token: '--color-earth',
    kinds: ['en2zh', 'similar'],
    blurb: '承载分辨 · 英译中与形近辨析',
    skill: '英译中',
  },
];

/** 某系被视为「已显」所需的最少作答数（防「1 题全对 → 100% 纯度」） */
export const MIN_SAMPLES = 5;

/** 达到「天灵根」所需的主导纯度 */
export const HEAVEN_PURITY = 0.7;
/** 达到「双灵根」所需的主导纯度 */
export const DUAL_PURITY = 0.45;
/** 达到「三灵根」所需的主导纯度 */
export const TRIPLE_PURITY = 0.3;

/** memStats 的行结构（与模板一致：r=答对，n=总作答） */
export interface MemStatRow { r?: number; n?: number }
export type MemStats = Record<string, MemStatRow | undefined>;

export interface ElementScore {
  id: ElementId;
  char: string;
  name: string;
  token: string;
  blurb: string;
  /** 该系能力短名（卡片第二列） */
  skill: string;
  /** 该系作答总数 */
  total: number;
  /** 该系答对数 */
  correct: number;
  /** 正确率 0–1（无样本时为 0） */
  accuracy: number;
  /** 是否已达样本门槛 */
  revealed: boolean;
}

export interface RootResult {
  /** 五系明细（固定顺序，便于展示与快照） */
  elements: ElementScore[];
  /** 已显的系（按正确率降序；同率按 ELEMENTS 顺序稳定） */
  revealed: ElementScore[];
  /** 主导系（未定时为 null） */
  dominant: ElementScore | null;
  /** 主导纯度 0–1（主导系作答 / 已显系总作答） */
  purity: number;
  /** 灵根档位 */
  grade: RootGrade;
  /** 可读名称，如「金灵根 · 天灵根」「金木双灵根」「灵根未显」 */
  label: string;
  /** 已显系的作答总数（用于「样本还差多少」提示） */
  sampleTotal: number;
}

/** 档位 → 可读名 */
export const GRADE_LABEL: Readonly<Record<RootGrade, string>> = {
  heaven: '天灵根',
  dual: '双灵根',
  triple: '三灵根',
  mixed: '杂灵根',
  undetermined: '灵根未显',
};

/**
 * 由 memStats 推导灵根。
 *
 * 纯函数：不改入参、不碰 DOM/storage。
 * 任何异常（缺字段 / 负数 / 非数字）都按 0 处理，绝不抛错。
 */
export function computeRoot(memStats: MemStats | null | undefined): RootResult {
  const ms = (memStats && typeof memStats === 'object' ? memStats : {}) as MemStats;
  const num = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  };

  const elements: ElementScore[] = ELEMENTS.map((def) => {
    let total = 0;
    let correct = 0;
    for (const kind of def.kinds) {
      const row = ms[kind];
      const n = num(row && row.n);
      const r = Math.min(num(row && row.r), n);   // 防御：r 不应超过 n
      total += n;
      correct += r;
    }
    return {
      id: def.id,
      char: def.char,
      name: def.name,
      token: def.token,
      blurb: def.blurb,
      skill: def.skill,
      total,
      correct,
      accuracy: total > 0 ? correct / total : 0,
      revealed: total >= MIN_SAMPLES,
    };
  });

  const revealed = elements
    .filter((e) => e.revealed)
    .sort((a, b) => b.accuracy - a.accuracy || ELEMENTS.findIndex((x) => x.id === a.id) - ELEMENTS.findIndex((x) => x.id === b.id));

  const sampleTotal = revealed.reduce((s, e) => s + e.total, 0);
  const dominant = revealed.length ? revealed[0] : null;
  const purity = dominant && sampleTotal > 0 ? dominant.total / sampleTotal : 0;

  const grade = gradeOf(revealed.length, purity);
  const label = labelOf(revealed, grade, dominant);

  return { elements, revealed, dominant, purity, grade, label, sampleTotal };
}

/** 由「已显系数量 + 主导纯度」定档 */
export function gradeOf(revealedCount: number, purity: number): RootGrade {
  if (revealedCount === 0) return 'undetermined';
  const p = Number.isFinite(purity) ? Math.max(0, Math.min(1, purity)) : 0;
  if (revealedCount === 1) return 'heaven';       // 只有一系已显 → 自然是单一主导
  if (p >= HEAVEN_PURITY) return 'heaven';
  if (p >= DUAL_PURITY) return 'dual';
  if (p >= TRIPLE_PURITY) return 'triple';
  return 'mixed';
}

/** 可读名称：主导系 + 档位；未显时明说「未显」 */
export function labelOf(revealed: ElementScore[], grade: RootGrade, dominant: ElementScore | null): string {
  if (grade === 'undetermined' || !dominant) return GRADE_LABEL.undetermined;
  // 双/三灵根：列出已显的系（最多 3 个）
  if (grade === 'dual' || grade === 'triple') {
    const chars = revealed.slice(0, grade === 'dual' ? 2 : 3).map((e) => e.char).join('');
    return chars + GRADE_LABEL[grade];
  }
  return dominant.char + GRADE_LABEL[grade];
}

/** 样本还差多少才显灵根（全部未显时用于提示；已显至少一系则返回 0） */
export function samplesToReveal(memStats: MemStats | null | undefined): number {
  const r = computeRoot(memStats);
  if (r.revealed.length > 0) return 0;
  // 取「最接近门槛」的那一系
  const best = r.elements.reduce((m, e) => Math.max(m, e.total), 0);
  return Math.max(0, MIN_SAMPLES - best);
}

/** 五系正确率概览（学情看板用；含未显的系，便于用户看到自己在补哪一系） */
export function elementBreakdown(memStats: MemStats | null | undefined): Array<{
  id: ElementId; char: string; name: string; token: string; skill: string;
  total: number; correct: number; accuracy: number; revealed: boolean; blurb: string;
}> {
  return computeRoot(memStats).elements.map((e) => ({
    id: e.id, char: e.char, name: e.name, token: e.token, skill: e.skill,
    total: e.total, correct: e.correct, accuracy: e.accuracy,
    revealed: e.revealed, blurb: e.blurb,
  }));
}

/**
 * 灵根修习建议：针对**最弱**的已显系给一句可执行建议。
 * 未显或只有一系时不建议（样本不足下的建议不可靠）。
 */
export function rootAdvice(memStats: MemStats | null | undefined): string {
  const r = computeRoot(memStats);
  if (r.revealed.length < 2) return '';
  const weakest = r.revealed[r.revealed.length - 1];
  const pct = Math.round(weakest.accuracy * 100);
  return `最弱是${weakest.name}（${weakest.blurb}）正确率 ${pct}%，可优先练这一系补足短板。`;
}
