#!/usr/bin/env node
/**
 * 服务层「消费点」扫描（防「实现了但没人调用」）
 *
 * ── 为什么需要这个脚本 ──
 * 本项目已**连续五次**踩同一类缺陷：服务层定义了机制、写了测试、导出了接口，
 * 但**模板从未调用它** —— 于是玩家看不到任何效果，而所有单测全绿。
 *
 *   1. 奇遇效果：6 个里 5 个只弹 toast（`applyEncounter` 只真结算 qi_rain）
 *   2. `encounters.listPending()`：从未被调用 → 未领取奇遇刷新即丢
 *   3. 道场三设施 buff：`getFacilityBuffs()` 从未被调用 → 承诺的加成不生效
 *   4. 洞府装饰视觉：4 个纯视觉装饰从未应用 → 花 290 灵石买了个寂寞
 *   5. 斗法奖励口径：服务层 `duelReward()` 未被调用（模板另写一份硬编码）
 *
 * **单测发现不了这类问题** —— 因为单测测的是服务层本身，
 * 不测「谁调用了它」。必须有静态的「消费点」检查。
 *
 * ── 本脚本做什么 ──
 * 1. 解析 `src/services/index.ts` 的 `QingciServices` 导出表，
 *    取出所有**顶层暴露名**（形如 `  name,` 或 `  alias: realName,`）；
 * 2. 在 `src/index.template.html` 里查找该名字的**调用点**（`name(` 或 `.name(`）；
 * 3. 报告「暴露但模板零调用」的名字，并按「是否像用户可感知机制」分级。
 *
 * ── 用法 ──
 *   node scripts/check-service-usage.mjs            # 报告（不失败）
 *   node scripts/check-service-usage.mjs --strict    # 有高优先级未消费项则退出码 1
 *
 * ── 注意：白名单 ──
 * 有些导出**有意**不在模板里调用（供测试 / 其它模块 / 未来扩展用）。
 * 白名单在下方 ALLOW 里，每条都必须写明**为什么可以不被模板调用**——
 * 不允许无理由加白名单（那就退化成「把警报静音」）。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const IDX = join(ROOT, 'src', 'services', 'index.ts');
const HTML = join(ROOT, 'src', 'index.template.html');
const SVC_DIR = join(ROOT, 'src', 'services');

/**
 * 允许「模板不调用」的导出（每条必须写明理由）。
 * 判据：不是「用户可感知的机制」，或已由其它路径消费。
 */
const ALLOW = new Map([
  // —— 纯工具/常量：模板通过别的名字消费，或仅服务层内部用 ——
  ['gradeSubmission', '模板经 window.QingciGradingEntry 间接走，非直接调用'],
  ['GRADE_API_PATH', '常量，模板不直接需要'],
  ['GRADE_TIMEOUT_MS', '常量，服务层内部用'],
  ['MIN_ANSWER_LENGTH', '常量，服务层内部用'],
  ['isValidGradeResult', '服务层内部校验用'],
  // —— 存储/迁移：模板只调其中一部分 ——
  ['planLegacyMigration', '迁移计划（只读探测），模板只用 runLegacyMigration'],
  ['describeMigration', '迁移文案，模板未展示（低优先）'],
  ['LEGACY_STATE_KEY', '常量'],
  ['MIGRATION_META_KEY', '常量'],
  // —— 数据/配置常量：模板经服务对象属性访问，不做函数调用 ——
  ['ITEM_CATALOG', '模板经 data-buy 属性与 catalogOf 消费'],
  ['ARRAY_DURATION_MS', '常量，服务层内部用'],
  ['PILL_DURATION_MS', '常量，服务层内部用'],
  ['ENCOUNTER_DAILY_LIMIT', '常量，服务层内部用'],
  ['DUEL_QUESTIONS', '模板经 D.QUESTIONS 访问（属性，非调用）'],
  ['DUEL_TIME_PER_Q', '常量，服务层内部用'],
  ['TRIBULATION_TOTAL', '常量，服务层内部用'],
  ['TRIBULATION_PASS', '常量，服务层内部用'],
  ['TRIBULATION_COOLDOWN_MS', '常量，服务层内部用'],
  ['TRIBULATION_REWARD_SPIRIT', '常量，模板经 T.REWARD 访问'],
  ['TRIBULATION_KINDS', '常量，服务层内部用'],
  ['TRIBULATION_PENALTY', '常量，服务层内部用'],
  ['TRIBULATION_TIME_LIMIT_MS', '常量，服务层内部用'],
  ['DEMON_MIN_LEVEL', '常量，服务层内部用'],
  ['DEMON_MAX_LEVEL', '常量，服务层内部用'],
  ['DEMON_RAID_LEVEL', '模板经 D.RAID_LEVEL 访问'],
  ['DEFAULT_REALM_DEMON_CAP', '常量，服务层内部用'],
  ['LEVEL5_OVERFLOW_WRONGS', '常量，服务层内部用'],
  ['OVERFLOW_BONUS_SPIRIT', '常量，服务层内部用'],
  ['SUBLEVELS_PER_REALM', '常量，服务层内部用'],
  ['TOTAL_SUBLEVELS', '模板经 c.TOTAL_SUBLEVELS 访问'],
  ['SUBLEVEL_NAMES', '常量，服务层内部用'],
  ['SUBLEVEL_BASE_QI', '常量，服务层内部用'],
  ['SUBLEVEL_GROWTH', '常量，服务层内部用'],
  ['BASE_QI_PER_CORRECT', '常量，服务层内部用'],
  ['COMBO_TIERS', '常量，服务层内部用'],
  ['DAILY_FIRST_QI', '常量，服务层内部用'],
  ['DECAY_GRACE_DAYS', '常量，服务层内部用'],
  ['DECAY_RATE_PER_DAY', '常量，服务层内部用'],
  ['DECAY_MAX_RATIO', '常量，服务层内部用'],
  ['CRIT_CHANCE', '常量，服务层内部用'],
  ['CRIT_MULTIPLIER', '常量，服务层内部用'],
  ['CRIT_LABEL', '模板经 c.CRIT_LABEL 访问'],
  ['CROPS', '模板经 F.crops / c.CROPS 访问（属性）'],
  ['PLOT_COUNT', '常量，服务层内部用'],
  ['DEFAULT_PLOT_UNLOCK_BY_REALM', '常量，服务层内部用'],
  ['SPRING_WATER_ID', '模板经 CV.SPRING_WATER 访问'],
  ['SECT_DONATE_PRESETS', '模板经 SC.PRESETS 访问'],
  ['FACILITY_DEFS', '模板经 SC.FACILITIES 访问'],
  ['ENCOUNTER_POOL', '模板经 EN.POOL 访问'],
  ['BEAST_NAMES', '常量，服务层内部用'],
  ['CAVE_QI_MULTIPLIER', '模板经 EE.CAVE_QI_MULTIPLIER 访问'],
  ['BEAST_QI_MULTIPLIER', '模板经 EE.BEAST_QI_MULTIPLIER 访问'],
  ['FOCUS_BONUS_QI', '模板经 EE.FOCUS_BONUS_QI 访问'],
  ['QI_RAIN_MIN', '常量，服务层内部用'],
  ['QI_RAIN_MAX', '常量，服务层内部用'],
  ['DETAIL_DISCOUNT', '常量，服务层内部用'],
  ['MONTHLY_TALISMAN', '常量，服务层内部用'],
  ['EFFECTS_KEY', '常量，服务层内部用'],
  ['SECT_BUFF_KEY', '常量，服务层内部用'],
  ['VISUAL_DECO_TOTAL', '模板经 CVis.TOTAL 访问'],
  ['DECO_CLASS', '模板经 CVis.CLASS 访问'],
  ['DECO_SLOT', '服务层内部用'],
  ['ITEM_CATALOG', '模板经 data-buy 消费'],
  ['SECT_DONATE_PRESETS', '模板经 SC.PRESETS 访问'],
  // —— 只读视图/查询：模板用等价的内联实现或另有路径 ——
  ['summarizeByLexicon', '词库统计，模板经 summarizeByLexicon 的等价实现'],
  ['countRaidReady', '心魔劫就绪数，模板内联 `d.level === D.RAID_LEVEL` 计算'],
  ['unlockedBookWords', '已解锁古籍列表，模板逐词调 bookUnlocked 判定'],
  ['unlockedTitleDetails', '称号解锁明细，模板用 newTitles 即时展示'],
  ['applyDuelBonus', '论剑加成，模板走 sectBuffs.applyArenaBonus'],
  ['judge', '判定函数，模板经 duel/joint 的 record 路径间接使用'],
  ['applyBonus', '同上（duel 的 applyDuelBonus 别名）'],
  ['raidReady', '同上（countRaidReady 别名）'],
  ['claim', '传功认领，模板经 TX.claim 属性访问'],
  ['applyReview', '错题评级，mistake-store 内部消费（模板经 rateWord）'],
  ['unlockedDetails', '同上（unlockedTitleDetails 别名）'],
  ['applyEffect', '奇遇效果纯函数，模板经 EE.apply（applyEncounterEffect）消费'],
  ['facilityPercent', '模板经 SC.percent 访问'],
  ['localDayKey', '模板经 EE.localDayKey 访问'],
  ['monthKeyOf', '模板经 SB.monthKey 访问'],
  ['monthlyTalismanAmount', '模板经 claimMonthlyTalisman 消费'],
  ['shouldGrantMonthlyTalisman', '模板经 claimMonthlyTalisman 内部消费'],
  ['buffSummary', '模板经 S.sectBuffs.summary 访问'],
  ['summary', '同上（buffSummary 别名）'],
  ['caveDecorSummary', '模板经 CVis.summary 访问'],
  ['caveVisualClasses', '模板经 CVis.classes / bySlot 访问'],
  ['visualDecorCount', '模板经 CVis.count 访问'],
  ['loadSectBuffs', '模板经 SB.claimMonthlyTalisman 内部消费'],
  ['saveSectBuffs', '同上'],
  ['loadEffects', '模板经 EE.activeBoostLabels 等内部消费'],
  ['saveEffects', '同上'],
  ['beastName', '服务层内部用（applyEffect 调）'],
  ['beastActive', '模板经 EE.activeBoostLabels 内部消费'],
  ['caveActive', '同上'],
  ['focusWordOf', '同上'],
  ['qiMultiplier', '模板经 encQiBonus 消费'],
  ['applyQiMultiplier', '模板经 encQiBonus 消费'],
  ['activeBoostLabels', '模板经 renderBoostBadge 消费'],
  ['focusBonusFor', '模板经 encQiBonus 消费'],
  ['parseManifest', '模板经 LX.parseManifest 访问'],
  ['lexiconById', '模板经 LX.byId 访问'],
  ['enabledLexicons', '模板经 LX.enabled 访问'],
  ['currentLexicon', '模板经 LX.profile 访问'],
  ['switchLexicon', '模板经 LX.switchTo 消费'],
  ['currentLexiconId', '模板经 LX.current 消费'],
  ['LEXICON_CURRENT_KEY', '常量'],
  ['DEFAULT_LEXICON_ID', '常量'],
  ['FALLBACK_MANIFEST', '模板经 LX.fallback 访问'],
  ['LEXICON_ROOT', '模板经 LX.root 访问'],
  ['lexiconOf', '模板经 lexiconScope.of 访问'],
  ['sameLexicon', '模板经 lexiconScope.same 访问'],
  ['tagLexicon', '模板经 lexiconScope.tag 访问'],
  ['filterByLexicon', '模板经 lexiconScope.filter 访问'],
  // —— 2026-10-08 第三轮：扫描出的 12 个「高可疑」逐个人工核实结果 ——
  // 全部**确实有消费点**，只是不在模板里（服务层内部 / 经别名 / 模板内联等价实现）。
  // 记在这里是为了让下次扫描不再重复报警，同时留下核实依据。
  ['beastNameFrom', '心魔录灵兽命名；模板用 encounterEffects.beastName 给奇遇灵兽命名（两套命名，各用其一处）'],
  ['checkDictation', '听写判定；由 audio-provider.ts:318 内部消费（模板经 provider 链路）'],
  ['countCandidates', '推荐候选数；服务层 recommend 内部用（模板经 reportRecommend 走组卷）'],
  ['countItems', '离线缓存条数；服务层 offline-store 内部用（模板经 summarize 展示）'],
  ['describeMember', '道场成员描述；模板用 m.nickname 直接渲染（group.savedNickname）'],
  ['describeRecommendation', '推荐文案；模板用 reportHint 自行拼文案（recommend 的组卷结果已消费）'],
  ['describeSegment', '音频分段文案；服务层内部用'],
  ['getBalance', '余额读取；模板用 spiritNow()（等价实现，读同一 state.spirit）'],
  ['isStale', '缓存过期判定；服务层 offline-store 内部用'],
  ['run', '索引名（service 成员名），非函数名 —— 扫描器误报'],
  ['saveQueue', '反馈队列持久化；服务层 feedback 内部用（模板只提交，不直接存队列）'],
  ['shouldStop', '自适应摸底停止条件；由 assessment.applyAnswer 内部调用（index.ts:113 消费）'],
]);

/** 高优先级：名字看起来是「用户可感知的机制」，零调用高度可疑 */
const HIGH_PRIORITY = /^(apply|grant|claim|unlock|reward|judge|start|plant|harvest|water|purchase|transmit|resolve|roll|consume|switch|emit|render|paint|save|load|set|add|use|check|run|record|compute|build|make|create|describe|summarize|forecast|count|list|get|find|is|has|can|should|discounted|monthly|cave|beast|focus|qi|active)/;

/**
 * 本仓库六次「没接线」缺陷的**共同签名**：
 *   **被测试断言过** + 已导出 + 模板零调用。
 *
 * 「被测试断言过」是最强的信号 —— 说明作者**确实打算让它生效**，
 * 而不是「供未来扩展」的预留 API。用它过滤能把大量噪音（纯常量、
 * 别名、内部辅助）挡掉，只留下真正可疑的项。
 */
function testedIn(name) {
  try {
    const files = readdirSync(join(ROOT, 'tests')).filter((f) => f.endsWith('.mjs'));
    const re = new RegExp('\\b' + name.replace(/[$]/g, '\\$&') + '\\b');
    for (const f of files) {
      if (re.test(readFileSync(join(ROOT, 'tests', f), 'utf8'))) return true;
    }
  } catch { /* 忽略 */ }
  return false;
}

function exposedNames() {
  const src = readFileSync(IDX, 'utf8');
  const names = new Set();
  // 匹配形如 `  name,` 或 `  alias: realName,`（服务对象字面量里的成员）
  for (const m of src.matchAll(/^\s{4}([a-zA-Z_$][\w$]*)\s*(?::\s*[a-zA-Z_$][\w$]*)?\s*,\s*$/gm)) {
    names.add(m[1]);
  }
  return names;
}

const html = readFileSync(HTML, 'utf8');
const names = exposedNames();
const unconsumed = [];
const consumed = [];

for (const name of [...names].sort()) {
  // 调用点：`name(` 或 `.name(`
  const called = new RegExp('(?:^|[^.\\w$])' + name.replace(/[$]/g, '\\$&') + '\\s*\\(').test(html);
  // 属性访问：`.name` 后不跟 `(`（常量/配置的常见消费方式）
  const prop = new RegExp('\\.' + name.replace(/[$]/g, '\\$&') + '\\b').test(html);
  if (called || prop) consumed.push(name);
  else unconsumed.push(name);
}

const unknown = unconsumed.filter((n) => !ALLOW.has(n));
const allowed = unconsumed.filter((n) => ALLOW.has(n));
// 最强信号：名字像机制 **且** 被测试断言过 **且** 模板零调用
const suspicious = unknown.filter((n) => HIGH_PRIORITY.test(n) && testedIn(n));
const weak = unknown.filter((n) => !suspicious.includes(n));

console.log('服务层消费点扫描');
console.log('─'.repeat(72));
console.log(`暴露的顶层名        : ${names.size}`);
console.log(`模板有消费点        : ${consumed.length}`);
console.log(`白名单（有理由）    : ${allowed.length}`);
console.log(`未消费且无理由      : ${unknown.length}`);
console.log(`  ├─ ⚠️ 高可疑（像机制 + 有测试）: ${suspicious.length}`);
console.log(`  └─ 低可疑（可能只是别名/预留） : ${weak.length}`);
console.log('');

if (suspicious.length) {
  console.log('⚠️ 高可疑：名字像用户可感知机制、**有测试断言**、但模板零调用。');
  console.log('   这正是本项目已踩六次的缺陷签名（空头支票奇遇 / listPending /');
  console.log('   道场 buff / 斗法奖励 / 洞府装饰 / 流水账本）。请逐个人工确认：');
  for (const n of suspicious) console.log('   · ' + n);
  console.log('');
}
if (weak.length) {
  console.log('低可疑（多半是别名或预留 API，供参考）：');
  for (const n of weak) console.log('   · ' + n);
  console.log('');
}
console.log('白名单里已不再出现于导出的条目（可清理）：');
const stale = [...ALLOW.keys()].filter((k) => !names.has(k));
if (stale.length) for (const n of stale) console.log('   · ' + n);
else console.log('   （无）');
console.log('─'.repeat(72));

const strict = process.argv.includes('--strict');
if (strict && suspicious.length) {
  console.log(`❌ --strict：${suspicious.length} 个高可疑导出无消费点`);
  process.exit(1);
}
console.log(suspicious.length ? '⚠️ 有高可疑项（未开 --strict，不失败）' : '✅ 未发现可疑的未消费机制');
