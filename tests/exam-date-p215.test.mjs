/**
 * P2-15 · 考试日期去硬编码（审计第 15 项）
 *
 * 审计说 `2026-12-12` 出现 7 处，实测 4 处。这 4 处的**性质并不相同**：
 *
 *   | 位置 | 性质 | 处理 |
 *   |---|---|---|
 *   | `index.template.html` examDays() | 硬编码，且**无视用户设置** | 改读 `S.settings.loadPlan()` |
 *   | 模板 2 处反馈文案「距离 2026-12-12…」 | 硬编码，与用户设置矛盾 | 改读 `examDateStr()` |
 *   | `core/utils.js` examDays 默认参数 | 服务端兜底 | 去掉默认值，要求显式传入 |
 *   | `study-plan.ts` DEFAULT_EXAM_DATE | **单一事实来源**，应该保留 | 保留 |
 *
 * 所以「全部删掉」是错的 —— 要留一个具名的默认值，其余全部指向它。
 * 本测试守的就是这个结构。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const html = readFileSync(join(ROOT, 'src', 'index.template.html'), 'utf8');
const dist = readFileSync(join(ROOT, 'dist', 'index.html'), 'utf8');
const utils = readFileSync(join(ROOT, 'src', 'core', 'utils.js'), 'utf8');
const studyPlan = readFileSync(join(ROOT, 'src', 'services', 'study-plan.ts'), 'utf8');

const DATE_RE = /\b20\d{2}-\d{2}-\d{2}\b/g;

/**
 * 把「有正当理由的日期」排除掉，只留下**考试日期**语义的字面量。
 *
 * 实测模板里除考试日期外还有两类日期，它们**不该被删**：
 *   - L1532 注释里的用户反馈日期（记录这个改动为什么存在）
 *   - L1620 数据来源抓取日期（「卷面结构取自…2026-09-24 抓取」）
 * 前者在注释里，后者是来源出处。审计说的「7 处硬编码」若全删，
 * 会把这些溯源信息一起删掉 —— 那是破坏，不是修复。
 */
function examDateLiterals(src) {
  return [...src.matchAll(DATE_RE)].filter((m) => {
    const lineStart = src.lastIndexOf('\n', m.index) + 1;
    const line = src.slice(lineStart, src.indexOf('\n', m.index));
    // 排除注释行（以 * 或 // 或 /* 开头/包含的说明）
    if (/^\s*(\*|\/\/|\/\*)/.test(line)) return false;
    // 排除「抓取 / 取自 / 来源 / 反馈」等溯源语境
    if (/抓取|取自|来源|反馈|背景/.test(line)) return false;
    return true;
  }).map((m) => m[0]);
}

test('P2-15：模板里只剩 1 个考试日期字面量，且它是有名字的兜底常量', () => {
  const dates = examDateLiterals(html);
  assert.equal(dates.length, 1, `模板里仍有 ${dates.length} 个考试日期字面量：${dates.join(', ')}`);
  // 那个唯一的字面量必须挂在 EXAM_DATE_FALLBACK 上（有名字 = 有解释）
  assert.ok(/var EXAM_DATE_FALLBACK\s*=\s*'\d{4}-\d{2}-\d{2}'/.test(html),
    '唯一的考试日期字面量应定义为 EXAM_DATE_FALLBACK');
});

test('P2-15：溯源类日期（注释 / 数据来源）不该被误删', () => {
  // 反向保护：审计说「7 处硬编码」若照做全删，会把注释里的用户反馈日期
  // 和「卷面结构取自…2026-09-24 抓取」的来源出处一起删掉。
  assert.ok(/背景（\d{4}-\d{2}-\d{2} 用户反馈/.test(html),
    '注释里的用户反馈日期被删了（它解释了 reduced-motion 例外为何存在）');
  assert.ok(/卷面结构取自[^"]*\d{4}-\d{2}-\d{2}[^"]*抓取/.test(html),
    '数据来源的抓取日期被删了（它是出处凭证）');
});

test('P2-15：examDays() 不再硬编码，改从服务层设置读取', () => {
  const fn = html.match(/function examDays\(\)\{[^}]*\}/);
  assert.ok(fn, 'examDays() 未找到');
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(fn[0]),
    `examDays() 里仍有硬编码日期：${fn[0]}`);
  assert.ok(/examDateStr\(\)/.test(fn[0]), 'examDays() 应通过 examDateStr() 取日期');
});

test('P2-15：examDateStr() 优先读用户设置，其次服务层默认值，最后兜底', () => {
  const fn = html.match(/function examDateStr\(\)\{[\s\S]*?\n\}/);
  assert.ok(fn, 'examDateStr() 未找到');
  const body = fn[0];
  // 优先级 1：用户设置
  assert.ok(/S\.settings\.loadPlan/.test(body), '未读 S.settings.loadPlan()（用户设置的日期）');
  assert.ok(/\.examDate/.test(body), '未取 .examDate 字段');
  // 优先级 2：服务层默认
  assert.ok(/S\.plan\.defaultExamDate/.test(body), '未回落 S.plan.defaultExamDate');
  // 优先级 3：本地兜底
  assert.ok(/EXAM_DATE_FALLBACK/.test(body), '未回落 EXAM_DATE_FALLBACK');
  // 必须包 try/catch：服务层未就绪时首屏不能崩
  assert.ok(/try\s*\{/.test(body) && /catch/.test(body), 'examDateStr() 缺少 try/catch 保护');
});

test('P2-15：反馈文案不再写死日期（两处）', () => {
  const hardcoded = html.match(/距离\s*20\d{2}-\d{2}-\d{2}\s*四级笔试/g) || [];
  assert.deepEqual(hardcoded, [], `反馈文案仍写死日期：${hardcoded.join(', ')}`);
  // 两处都应改用 examDateStr()
  const uses = (html.match(/距离\s*'\s*\+\s*examDateStr\(\)/g) || []).length;
  assert.equal(uses, 2, `期望 2 处反馈文案改用 examDateStr()，实际 ${uses}`);
});

test('P2-15：core/utils.js 的 examDays 不再有硬编码默认值', () => {
  const fn = utils.match(/function examDays\([\s\S]*?\n\}/);
  assert.ok(fn, 'utils.examDays 未找到');
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(fn[0]),
    `utils.examDays 仍带硬编码默认日期：${fn[0]}`);
  assert.ok(/examDate\s*\?/.test(fn[0]), '应改成「传了就按传入的算」');
});

test('P2-15：默认值仍然只有一个来源（study-plan.ts 的 DEFAULT_EXAM_DATE）', () => {
  const m = studyPlan.match(/export const DEFAULT_EXAM_DATE\s*=\s*'(\d{4}-\d{2}-\d{2})'/);
  assert.ok(m, 'study-plan.ts 的 DEFAULT_EXAM_DATE 丢了 —— 它是唯一事实来源，不该删');
  // 模板的兜底常量必须与它同值，否则「默认」会有两个说法
  const fb = html.match(/var EXAM_DATE_FALLBACK\s*=\s*'(\d{4}-\d{2}-\d{2})'/);
  assert.ok(fb, 'EXAM_DATE_FALLBACK 未找到');
  assert.equal(fb[1], m[1],
    `兜底常量(${fb[1]}) 与服务层默认值(${m[1]}) 不一致 —— 两个默认值会漂移`);
});

test('P2-15：产物里考试日期恰好 2 处，且都指向同一个值', () => {
  // 产物里应该恰好 2 处「考试日期」字面量：
  //   1. 服务层 study-plan.ts 的 DEFAULT_EXAM_DATE（唯一事实来源）
  //   2. 模板的 EXAM_DATE_FALLBACK（服务层未就绪时的兜底）
  // 两者必须同值，否则「默认」会有两个说法。
  //
  // 注意：产物里服务层是**压缩成一整行**的，按行排除溯源语境会误伤
  // （那一行里可能恰好含「来源」等词），所以这里不按行过滤，
  // 改为直接按已知的两个上下文定位。
  const fb = dist.match(/var EXAM_DATE_FALLBACK\s*=\s*'(\d{4}-\d{2}-\d{2})'/);
  assert.ok(fb, '产物缺 EXAM_DATE_FALLBACK');
  const svc = dist.match(/"(\d{4}-\d{2}-\d{2})";\s*_=\s*\{\s*retention/);
  assert.ok(svc, '产物缺服务层 DEFAULT_EXAM_DATE（形态变了？）');
  assert.equal(fb[1], svc[1], `兜底(${fb[1]}) 与服务层默认(${svc[1]}) 不一致`);

  // 除这两处外，产物里只应剩下**溯源类**日期（注释里的反馈日期、数据来源抓取日期），
  // 它们不是考试日期，删掉反而丢失出处。这里把它们列成白名单，
  // 将来新增任何别的日期都会让这条失败 —— 那正是我们要的提醒。
  const PROVENANCE = new Set(['2026-10-06', '2026-09-24']);
  const all = [...dist.matchAll(DATE_RE)].map((m) => m[0]);
  const unexpected = all.filter((d) => d !== fb[1] && !PROVENANCE.has(d));
  assert.deepEqual(unexpected, [],
    `产物里出现了非预期日期（既不是考试日期默认值，也不是已知溯源日期）：${unexpected.join(', ')}`);
  // 溯源日期必须仍在（防止有人「顺手全删」把出处删掉）
  for (const d of PROVENANCE) {
    assert.ok(all.includes(d), `溯源日期 ${d} 被删了（注释/出处不该删）`);
  }

  assert.ok(dist.includes('function examDateStr()'), '产物缺 examDateStr()');
  assert.ok(!/距离\s*20\d{2}-\d{2}-\d{2}\s*四级笔试/.test(dist), '产物反馈文案仍写死日期');
});
