/**
 * 服务层「消费点」守卫
 *
 * ── 背景：本项目已连续六次踩同一类缺陷 ──
 * 服务层定义了机制、写了测试、导出了接口，但**模板从未调用它** ——
 * 于是玩家看不到任何效果，而所有单测全绿：
 *
 *   1. 奇遇效果：6 个里 5 个只弹 toast（只真结算 qi_rain）
 *   2. `encounters.listPending()`：未领取奇遇刷新即丢
 *   3. 道场三设施 buff：`getFacilityBuffs()` 承诺的加成不生效
 *   4. 斗法奖励口径：服务层 `duelReward()` 未被调用
 *   5. 洞府装饰视觉：4 个纯视觉装饰买了界面无变化
 *   6. 灵石流水账本：`listRecentTransactions` 从未展示
 *
 * **单测发现不了** —— 因为单测测服务层本身，不测「谁调用了它」。
 * 所以这里把 `scripts/check-service-usage.mjs` 的结论接进 `npm test`。
 *
 * ── 判据（本仓库六次缺陷的共同签名）──
 *   名字像用户可感知机制 + **有测试断言** + 模板零调用
 * 「有测试断言」是最强信号：说明作者确实打算让它生效，
 * 而不是「供未来扩展」的预留 API。
 *
 * 白名单必须写明理由（见脚本内 ALLOW），不允许无理由静音。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const SCRIPT = join(ROOT, 'scripts', 'check-service-usage.mjs');

function runScanner() {
  try {
    const out = execFileSync(process.execPath, [SCRIPT], { cwd: ROOT, encoding: 'utf8' });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: String(e.stdout || '') + String(e.stderr || '') };
  }
}

test('消费点：无「像机制 + 有测试 + 模板零调用」的高可疑导出', () => {
  const { out } = runScanner();
  const m = out.match(/高可疑（像机制 \+ 有测试）:\s*(\d+)/);
  assert.ok(m, `扫描输出格式变了，无法解析：\n${out.slice(0, 400)}`);
  const n = Number(m[1]);
  assert.equal(n, 0,
    `发现 ${n} 个高可疑导出（像机制、有测试、模板零调用）——`
    + `这正是本项目已踩六次的缺陷签名。详见 npm run check:usage 的输出。`);
});

test('消费点：--strict 模式通过（可作为门禁）', () => {
  const { code, out } = runScanner();
  assert.equal(code, 0, `--strict 未通过：\n${out.slice(-600)}`);
});

test('消费点：白名单不得出现「无理由」条目（防止把警报静音）', () => {
  const { out } = runScanner();
  // 白名单条目必须在扫描输出的「白名单（有理由）」计数里，且数量合理
  const m = out.match(/白名单（有理由）\s*:\s*(\d+)/);
  assert.ok(m, '扫描输出缺白名单计数');
  const n = Number(m[1]);
  assert.ok(n > 0 && n < 200, `白名单数量异常：${n}（过多说明在静音，过少说明解析坏了）`);
  // 脚本源码里每条白名单都必须带非空理由（第二个参数是字符串且非空）
  const src = execFileSync(process.execPath, ['-e', 'process.stdout.write(require("fs").readFileSync(process.argv[1],"utf8"))', SCRIPT], { encoding: 'utf8' });
  const entries = [...src.matchAll(/^\s*\['([^']+)',\s*'([^']*)'\]/gm)];
  assert.ok(entries.length > 0, '未解析到白名单条目');
  const empty = entries.filter(([, , reason]) => !String(reason || '').trim()).map(([, name]) => name);
  assert.deepEqual(empty, [], `以下白名单条目缺理由：${empty.join(', ')}`);
});
