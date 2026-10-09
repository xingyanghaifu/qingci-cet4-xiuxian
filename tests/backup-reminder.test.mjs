/**
 * 备份提醒（第六轮补漏）
 *
 * ── 为什么做这个 ──
 * `docs/产品方案.md` 的「风险与对策」写着：
 *
 *   | localStorage 清缓存丢进度 | 中 | 已提供导出/导入 JSON，**建议提示用户定期备份** |
 *
 * 但**从来没有任何提示**（全模板 grep「备份」0 次）—— 用户不点导出就永远不知道
 * 该备份，而清缓存会真的丢数据（上一轮才把备份补全到覆盖 17 个 IDB 仓）。
 *
 * ── 三条红线（测试逐条守） ──
 *   1. 不制造焦虑：提示温和、可忽略、不阻断功能；不重复弹
 *   2. 不打扰：空账号不提示；忽略后有静默期
 *   3. 不侵入学习：纯只读推导
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTs } from './helpers/load-ts.mjs';

const ROOT = join(import.meta.dirname, '..');
const R = await loadTs('src/services/backup-reminder.ts');

const DAY = 86400000;
const NOW = Date.parse('2026-10-08T12:00:00Z');

/* ───────── 一、不该提示的情况 ───────── */

test('空账号不打扰（学习天数不足门槛）', () => {
  const h = R.backupHint({ studyDays: 0, now: NOW });
  assert.equal(h.should, false);
  assert.equal(h.reason, 'no-data');
  assert.equal(h.message, '', '不提示时不应有文案');
  // 差一点到门槛也不提示
  assert.equal(R.backupHint({ studyDays: R.MIN_STUDY_DAYS - 1, now: NOW }).should, false);
});

test('刚导出过不提示（fresh）', () => {
  const h = R.backupHint({ studyDays: 10, lastExportAt: new Date(NOW - 2 * DAY).toISOString(), now: NOW });
  assert.equal(h.should, false);
  assert.equal(h.reason, 'fresh');
  assert.equal(h.daysSinceExport, 2);
});

test('静默期内不打扰（用户刚说「稍后再说」）', () => {
  const h = R.backupHint({
    studyDays: 30,
    lastExportAt: null,          // 从未导出，本该提示
    snoozedAt: new Date(NOW - 2 * DAY).toISOString(),
    now: NOW,
  });
  assert.equal(h.should, false, '静默期内即使从未导出也不提示');
  assert.equal(h.reason, 'snoozed');
});

test('静默期结束后恢复提示', () => {
  const h = R.backupHint({
    studyDays: 30,
    lastExportAt: null,
    snoozedAt: new Date(NOW - (R.SNOOZE_DAYS + 1) * DAY).toISOString(),
    now: NOW,
  });
  assert.equal(h.should, true);
  assert.equal(h.reason, 'never');
});

/* ───────── 二、该提示的情况 ───────── */

test('从未导出过 → 提示（且说明风险）', () => {
  const h = R.backupHint({ studyDays: 12, lastExportAt: null, now: NOW });
  assert.equal(h.should, true);
  assert.equal(h.reason, 'never');
  assert.equal(h.daysSinceExport, null);
  assert.ok(/12 天/.test(h.message), `应提到学习天数：${h.message}`);
  assert.ok(/缓存|备份|导出/.test(h.message), `应说明原因：${h.message}`);
});

test('距上次导出超过阈值 → 提示', () => {
  const h = R.backupHint({ studyDays: 40, lastExportAt: new Date(NOW - (R.REMIND_AFTER_DAYS + 3) * DAY).toISOString(), now: NOW });
  assert.equal(h.should, true);
  assert.equal(h.reason, 'stale');
  assert.ok(h.daysSinceExport >= R.REMIND_AFTER_DAYS);
  assert.ok(new RegExp(String(h.daysSinceExport)).test(h.message), `应含具体天数：${h.message}`);
});

test('恰好到阈值当天 → 提示（边界含）', () => {
  const h = R.backupHint({ studyDays: 10, lastExportAt: new Date(NOW - R.REMIND_AFTER_DAYS * DAY).toISOString(), now: NOW });
  assert.equal(h.should, true, `第 ${R.REMIND_AFTER_DAYS} 天应提示`);
  assert.equal(h.daysSinceExport, R.REMIND_AFTER_DAYS);
});

test('差一天到阈值 → 不提示（边界不含）', () => {
  const h = R.backupHint({ studyDays: 10, lastExportAt: new Date(NOW - (R.REMIND_AFTER_DAYS - 1) * DAY).toISOString(), now: NOW });
  assert.equal(h.should, false);
});

/* ───────── 三、文案：温和、不制造焦虑 ───────── */

test('文案温和：不含恐吓性词汇、不断言数据已丢失', () => {
  const cases = [
    { studyDays: 12, lastExportAt: null },
    { studyDays: 40, lastExportAt: new Date(NOW - 30 * DAY).toISOString() },
  ];
  const SCARY = /危险|警告|严重|立刻|马上|赶紧|否则|丢失了|已丢失|失败|糟糕/;
  for (const c of cases) {
    const h = R.backupHint({ ...c, now: NOW });
    assert.ok(h.should);
    assert.ok(!SCARY.test(h.message), `文案不应恐吓：${h.message}`);
    assert.ok(/建议/.test(h.message), `应是建议语气：${h.message}`);
  }
});

test('文案不阻断：只是提示，不含「必须/不能继续」', () => {
  const h = R.backupHint({ studyDays: 12, lastExportAt: null, now: NOW });
  assert.ok(!/必须|不能|禁止|无法继续/.test(h.message), `不应阻断：${h.message}`);
});

/* ───────── 四、稳健性与纯函数 ───────── */

test('脏数据安全降级，不抛错', () => {
  for (const bad of [
    {}, { studyDays: -5 }, { studyDays: 'x' }, { studyDays: NaN },
    { studyDays: 10, lastExportAt: 'not-a-date' },
    { studyDays: 10, lastExportAt: 0 },
    { studyDays: 10, snoozedAt: 'bad' },
  ]) {
    const h = R.backupHint({ ...bad, now: NOW });
    assert.equal(typeof h.should, 'boolean');
    assert.ok(['never', 'stale', 'snoozed', 'fresh', 'no-data'].includes(h.reason), `reason 非法：${h.reason}`);
    assert.ok(!/undefined|NaN/.test(h.message), `文案含非法值：${h.message}`);
  }
});

test('纯函数：不修改入参', () => {
  const input = { studyDays: 20, lastExportAt: null, now: NOW };
  const snap = JSON.stringify(input);
  R.backupHint(input);
  R.nextRemindAt(input.lastExportAt, NOW);
  R.snoozeBackup({}, NOW);
  assert.equal(JSON.stringify(input), snap);
});

test('nextAt：算出下次提醒时间（从未导出则从现在算起）', () => {
  const last = new Date(NOW - 5 * DAY).toISOString();
  assert.equal(R.nextRemindAt(last, NOW), Date.parse(last) + R.REMIND_AFTER_DAYS * DAY);
  assert.equal(R.nextRemindAt(null, NOW), NOW + R.REMIND_AFTER_DAYS * DAY, '从未导出应从当前时间算');
  assert.equal(R.nextRemindAt('bad', NOW), NOW + R.REMIND_AFTER_DAYS * DAY, '非法值按从未导出处理');
});

test('snooze：返回新的静默时间（纯函数）', () => {
  const s = R.snoozeBackup({}, NOW);
  assert.equal(Date.parse(s.snoozedAt), NOW);
  assert.ok(typeof s.snoozedAt === 'string' && s.snoozedAt.includes('T'), '应是 ISO 串');
});

test('常量：阈值合理（提醒间隔 > 静默期 > 0；学习门槛 > 0）', () => {
  assert.ok(R.REMIND_AFTER_DAYS > 0 && R.REMIND_AFTER_DAYS <= 60, '提醒间隔应在合理范围');
  assert.ok(R.SNOOZE_DAYS > 0 && R.SNOOZE_DAYS <= R.REMIND_AFTER_DAYS, '静默期应短于提醒间隔（否则永远不再提示）');
  assert.ok(R.MIN_STUDY_DAYS > 0, '学习门槛应 > 0（否则空账号也被打扰）');
});

/* ───────── 五、接线契约 ───────── */

test('接线：模板必须真的展示备份提醒（不能只实现判定）', () => {
  const html = readFileSync(join(ROOT, 'src', 'index.template.html'), 'utf8');
  assert.ok(/backupHint/.test(html),
    '模板未使用 backupHint —— 产品文档要求的「提示用户定期备份」仍未落地');
  assert.ok(/id="backupHint"/.test(html), '缺提醒容器 #backupHint');
});
