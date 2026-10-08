/**
 * `src/core/utils.js` 的类型声明
 *
 * 背景：core/utils.js 是 **CommonJS**（`module.exports = {...}`），
 * 供浏览器内联脚本、Node 脚本、Worker 三处共用 —— 不改成 TS 是为了保持
 * 「双击 HTML 就能跑」与「Node 脚本直接 require」两条链路都不需要编译。
 *
 * 但 tsconfig 开了 `strict` + `noImplicitAny`，TS 侧 import 它就会报 TS7016
 * （implicitly has an 'any' type）。这里补一份**最小声明**，只列 TS 侧真正用到的成员，
 * 避免为了类型把整个 utils.js 重写一遍。
 *
 * 注意：本文件是**手写声明**，与 utils.js 的导出保持同步。
 * 若在 TS 里用到新成员，需同时在此补声明（否则 tsc 会报错，不会静默放过）。
 */

/** 词条（与模板内联词库同构） */
export interface LexiconEntry {
  w: string;
  ipa?: string;
  zh?: string;
  short?: string;
}

/** 紧凑列式词库（v1.10 体积优化后的内联格式） */
export interface CompactLexicon {
  k: string[];
  v: Array<Array<string | number> | Record<string, unknown>>;
}

export function hash(text: unknown): number;
export function rng(seed: number): () => number;
export function pick<T>(list: T[], n: number, rand: () => number): T[];
export function wordsOf(text: unknown): number;
export function esc(s: unknown): string;
export function dayKey(d?: Date | number): string;
export function examDays(examDate?: string | null, now?: number): number;
export function realmOf(qi: number, realms: unknown): unknown;
export const REVIEW_GAPS: Record<string, number>;
export function scheduleWord(prev: unknown, quality: unknown, now?: number): unknown;
export function dueWords(schedule: unknown, now?: number): unknown;
export function checkSpell(input: unknown, answer: unknown): unknown;
export function posOf(zh: unknown): string;
export function shuffleOptions<T>(options: T[], rand: () => number): T[];
export function masteryPercent(knownCount: number, total: number): number;
export function ringOffset(percent: number, circumference: number): number;
export function recentDays(days: unknown, n: number, now?: number): unknown;
export function paperScore(gates: unknown[], got: Record<string, number>): number;
export const EXAM_CONFIGS: Record<string, unknown>;
export function getExamConfig(id: string): unknown;
export function difficultyForRealm(realmIndex: number, examLevel?: number): number;
export function canBreakthrough(score: number, examId: string): boolean;
export function examPassResult(correct: number, examId: string): { score: number; pass: boolean; passLine: number; exam: string };

/** 紧凑词库的字段顺序 */
export const LEXICON_KEYS: readonly string[];
/** 词条数组 → 紧凑列式 */
export function encodeLexicon(entries: LexiconEntry[]): CompactLexicon;
/**
 * 任意形态 → 对象数组。
 * 接受对象数组（原样返回）或紧凑列式（还原）；非法输入返回 `[]`，绝不抛错。
 */
export function decodeLexicon(data: unknown): LexiconEntry[];
/** 从 HTML 文本取出内联词库并解码 */
export function lexiconFromHtml(html: unknown): LexiconEntry[];

declare const core: {
  hash: typeof hash;
  rng: typeof rng;
  pick: typeof pick;
  wordsOf: typeof wordsOf;
  esc: typeof esc;
  dayKey: typeof dayKey;
  examDays: typeof examDays;
  realmOf: typeof realmOf;
  REVIEW_GAPS: typeof REVIEW_GAPS;
  scheduleWord: typeof scheduleWord;
  dueWords: typeof dueWords;
  checkSpell: typeof checkSpell;
  posOf: typeof posOf;
  shuffleOptions: typeof shuffleOptions;
  masteryPercent: typeof masteryPercent;
  ringOffset: typeof ringOffset;
  recentDays: typeof recentDays;
  paperScore: typeof paperScore;
  EXAM_CONFIGS: typeof EXAM_CONFIGS;
  getExamConfig: typeof getExamConfig;
  difficultyForRealm: typeof difficultyForRealm;
  canBreakthrough: typeof canBreakthrough;
  examPassResult: typeof examPassResult;
  LEXICON_KEYS: typeof LEXICON_KEYS;
  encodeLexicon: typeof encodeLexicon;
  decodeLexicon: typeof decodeLexicon;
  lexiconFromHtml: typeof lexiconFromHtml;
};

export default core;
