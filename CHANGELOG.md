# 更新日志

本项目的所有重要变更都会记录在此文件。
格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

---

## [1.5.0] - 2026-10-03

### 部署：P2.11 + P2.12 上线 + D1 配置（2026-10-03 10:54 +08:00）

- 线上地址 `https://qingci-cet4-xiuxian.pages.dev`，部署版本 **1.5.0**，
  产物指纹 `sha256:4d69df9e8745f23f`（应用 HTML 693.3 KB，服务层 123.5 KB）。
- 端点验收（8/8）：

  | 端点 | 结果 |
  |---|---|
  | `/` | 200 · 599,616 字符 |
  | `/healthz` | 200 · `version=1.5.0` `status=ok` |
  | `/api/meta` | 200 · `version=1.5.0` |
  | `/status` | 200 · 1,097 字符真实 Function 输出（非 SPA 回退） |
  | `POST /api/grade` | 200 · `status=not_implemented`（占位，零外部请求） |
  | `/changelog.html` | 200 · 41,405 字符 |
  | `/sw.js` | 200 · `cache-control: no-cache, must-revalidate` |
  | `/question-bank.json` | 200 · 5,714,685 字符 |

- 前端新增功能静态核验（18/18）：境界卡与五档阈值、突破动效容器、称号墙、
  道友小组面板与隐私声明、无障碍设置卡、字号 4 档、高对比度、动效偏好、
  快捷键 `1–4`/`Esc`/`?` 接线与文案、`✓/✗` 标记、题干与选项 ARIA、三个 dialog、
  播报通道与焦点可见、首屏防闪烁、`/api/feedback` 与 `/api/group` 端点在场。
  > 交互行为（点击、朗读、锁屏控制）需按 `docs/真机验收清单.md` 人工确认。

- **D1 配置完成**（反馈 + 道友小组共用）：
  - `npx wrangler d1 create qingci-feedback` → 数据库 ID `a4eff653-dcfd-4874-a0ff-e30f5e92a611`（区域 WNAM）；
  - `npx wrangler d1 execute qingci-feedback --remote --file=db/schema.sql`
    → 7 条语句执行成功（`feedback` / `study_groups` / `group_members` 三表 + 索引）；
  - 绑定 `DB`：`wrangler.toml` 与 `scripts/deploy-pages.mjs` 生成的 Pages 配置中均写入
    `[[d1_databases]] binding = "DB"`；
  - `FEEDBACK_SALT`：已用 `wrangler pages secret put` 写入（40 位随机串，仅存密文）；
  - 重新部署使绑定生效，接口实测 **25/25 通过**：

    | 验证项 | 结果 |
    |---|---|
    | `POST /api/feedback` 写入 D1 | 201 · `stored=true` · `id=2`（响应不含原始 IP） |
    | 反馈校验 / honeypot / GET 405 | 400 · 202 `stored=false` · 405 |
    | 创建道场并入库 | 200 · 邀请码 `2LDJBX`（排除易混字符） |
    | 进度分档 | 87 → 85（入库前分档为 5 的倍数） |
    | 榜单字段白名单 | 仅 `isMe,nickname,progress,realmIndex,realmName,studyDays` |
    | 榜单不含他人 memberId / 分数 | 已确认（无 score/answer/question 字段） |
    | 排序 | 元婴 > 金丹（按境界→进度→学习天数） |
    | 周 / 月维度 | `period=week` / `period=month` 均正常 |
    | 昵称隐私校验 | 邮箱 / 手机号 / 纯数字 / 网址 一律 400 |
    | 不存在的邀请码 | 404 |
    | 退出与清理 | 成员退出成功，道场人数归零 |

- **降级路径保留**：D1 未配置时 `/api/feedback` 与 `/api/group` 均返回 503，
  前端分别走「本地队列自动重试」与「本机模式提示」；该路径无法在已配置的线上环境复现，
  由单元测试覆盖（`tests/feedback.test.mjs`、`tests/realm-titles.test.mjs` 各有 503 断言）。

### 新增：无障碍与个性化（P2.12）

- **三条互相独立的偏好轴**（可与主题自由组合），`src/services/a11y.ts` + `<html>` 上的
  `data-font` / `data-contrast` / `data-motion`，CSS 属性选择器生效（无 JS 也能退化）：
  - **暗色模式**：跟随系统 / 浅色 / 深色，一键切换并持久化（`qingci.theme`），
    跟随系统时移除属性交给 `prefers-color-scheme`；
  - **字号 4 档**：标准 / 大 115% / 特大 130% / 超大 150%，只作用于题干、选项、解析与听力原文
    （CSS 变量 `--q-scale`），导航布局不受影响；
  - **高对比度**：纯黑纯白 + 2px 加粗边框，覆盖主题变量，深浅色下都成立；
  - **减少动态效果**：偏好或系统 `prefers-reduced-motion` 任一开启即关闭动画。
- **首屏防闪烁**：`<head>` 内一段脚本先于样式应用字号/对比度/动效偏好，避免加载后跳变。
- **键盘快捷键**（`?` 可随时查看；文案与解析同源，有测试防漂移）：
  `1`–`4` 选选项、`←`/`→`（`↑`/`↓`）上下题、`Enter` 推进/提交、`空格` 播放听力、
  `R` 重播、`Esc` 关闭最上层弹窗、`?` 快捷键表。
  输入态放行数字键与方向键，带 `Ctrl`/`Meta`/`Alt` 的组合键一律不拦截；
  `Esc` 与 `?` 即使在输入框内也生效（避免用户被困）。
  **修复**：`1`–`4` 此前只在解析层声明、从未接线，现已接入选择逻辑。
- **色盲友好**：正确选项加 `✓ ` 前缀、错误选项加 `✗ ` 前缀，并追加屏幕阅读器专用文本
  （「正确答案」/「你的选择，错误」）与 `aria-label`，不再只靠颜色区分。
- **屏幕阅读器支持**：`#prompt` 加 `aria-live="polite" aria-atomic="true"` 并在换题时播报与移焦；
  `#choices` 为 `role="group" aria-label="选项" aria-describedby="prompt"`；
  精听/反馈/突破弹窗统一 `role="dialog" aria-modal="true"` + `aria-label`；
  字号/对比度/动效按钮使用 `aria-pressed`；新增视觉隐藏的 `#srAnnouncer`（`role="status"`）
  作为过程性播报通道；全局 `:focus-visible` 3px 描边保证焦点可见。
  无障碍增强全部包在旁路 `try/catch` 中，任何失败都不影响答题。
- **界面**：「洞府 → 无障碍与阅读偏好」卡片（字号按钮组、高对比度与减少动效开关、
  可展开的快捷键与朗读说明）。

### 新增：修仙主题与学习目标绑定（P2.11）

- **学业境界** `src/types/realm.ts`：练气/筑基/金丹/元婴/化神五档，**词汇量与模考总分双条件同时达标**
  才晋级（如筑基 = 1000 词 + 400 分，化神 = 4000 词 + 700 分）；**只升不降**；
  界面给出双条件进度条、距下一境界差距与**瓶颈项**（词汇 or 分数）。
  与旧「修为」（灵气值驱动）明确区分：修为代表练得多，境界代表学得扎实。
- **突破动效**：`#breakthroughOverlay` 旋转灵环 + 境界名升起动画（连升多级时显示「连升 N 境」），
  系统开启「减少动态效果」时自动关闭动画；突破历史记录在洞府卡片。
- **成就称号** `src/types/titles.ts`：11 个称号（听力金丹 / 听力元婴 / 阅读元婴 / 阅读化神 /
  翻译化神 / 写作化神 / 词汇筑基 / 词汇金丹 / 全卷化神 / 心有灵犀 / 勤修不辍），
  每条都写明「样本量 + 正确率」双门槛，样本不足不发放；自动解锁、同一条只通知一次。
- **道友小组** `functions/api/group.ts` + `src/services/group.ts`：
  开道场（6 位邀请码，排除易混字符）/ 入道场 / 周·月榜单 / 退出。
  **隐私由服务端强制**：只接受昵称（拒绝 `@`、长串数字、纯数字、网址），
  只同步境界档位 / 粗粒度进度 / 学习天数，**不上传任何答题数据与分数**；
  进度入库前分档为 5 的倍数，榜单不回传他人 memberId；同一成员 30 秒内不重复写入。
  未绑定 D1 时返回 503，界面提示「本机模式」，学习功能不受影响。
- **避免过度游戏化**（代码层面保证）：不做惩罚（境界不降、坚持类按累计天数不清零）、
  不做付费/加速（无消耗与跳级入口）、不打断学习（判定异步旁路，异常吞掉）、
  不制造攀比（榜单无分数、进度粗粒度）。
- **D1 schema** `db/schema.sql` 新增 `study_groups` / `group_members` 两表，供反馈与小组共用同一数据库。
- **测试**：新增 `tests/realm-titles.test.mjs` 14 条（阈值与双条件、瓶颈与只升不降、突破与连升、
  称号门槛与样本不足、持久化与去重、昵称隐私校验、进度分档、负载字段白名单、
  榜单脱敏、Function 全状态码与降级）。
  过程中修掉两处**真实设计缺陷**：`readyForNext` 在「只升不降」下恒为 false（改为有意义的
  `justEligible`），以及 `describeRealm` 里一段不可达分支；并修正 `fetchImpl: null` 的语义
  （显式 null = 无 fetch，undefined 才回落全局）。

### 部署：P0 + P1 全量上线（2026-10-03 10:38 +08:00）

> 该版本已由 **1.5.0** 取代（2026-10-03 11:14 部署，含 P2.11/P2.12）。以下为当时的验收记录。

- 线上地址 `https://qingci-cet4-xiuxian.pages.dev`（Cloudflare Pages，项目 `qingci-cet4-xiuxian`）。
- 部署版本 **1.4.0**，产物指纹 `sha256:0c683c4c8e648f04`（应用 HTML 649.2 KB）；
  本次上传 11 个文件 + Functions bundle + `_headers` + `_routes.json`。
- 上线验收（8/8 通过）：

  | 端点 | 结果 |
  |---|---|
  | `/` | 200 · text/html · 558,807 字符 |
  | `/healthz` | 200 · `version=1.4.0` `status=ok` |
  | `/api/meta` | 200 · `version=1.4.0` |
  | `/status` | 200 · 1,097 字符真实 Function 输出（非 SPA 回退） |
  | `POST /api/grade` | 200 · `status=not_implemented`（占位逻辑生效，未发外部请求） |
  | `/changelog.html` | 200 · 35,097 字符（公开更新日志页） |
  | `/question-bank.json` | 200 · 5,714,685 字符（固化题库） |
  | `/sw.js` | 200 · `cache-control: no-cache, must-revalidate` |

- `prod-probe --strict`：4 条路径各 10 次采样，200 比例 10/10、全部 <2000ms（中位 271–914ms）。
- 部署目录检查：`changelog.html` / `manifest.webmanifest` / `sw.js` / `icons/`（4 个 PNG）/
  `question-bank.json` / `index.html` / `_headers` / `_routes.json` / `healthz.json` / `api-meta.json`
  **13/13 全部存在**；`_headers` 中 `/sw.js` 为 `no-cache, must-revalidate`，线上响应头一致。
- 修复 `scripts/deploy-pages.mjs`：wrangler 解析改为**优先选择自带平台 workerd 二进制的缓存**，
  失败自动切下一个候选。本次真实踩到 npm 漏装 `@cloudflare/workerd-windows-64`（wrangler 4.147.0
  缓存损坏）导致首次部署报 `The package "@cloudflare/workerd-windows-64" could not be found`；
  脚本现已跳过该缓存并成功部署。同时修正 workerd 包名映射（x64 是 `-64` 而非 `-x64`）。

### 新增：TypeScript 构建基座

- 引入 `esbuild` + `typescript` 两个 devDependency（**运行时依赖仍为 0**）：
  `npm run build` 先打包 `src/entry/services.ts`，再把结果内联进
  `src/index.template.html` 的 `<!-- build:services -->` 注入点，产出仍是零运行时依赖、
  双击可开的单文件 `dist/cet4-xiuxian.html`（478.0 KB，其中服务层 2.9 KB）。
- 新增 `tsconfig.json`（strict、`verbatimModuleSyntax`、无 `@types` 依赖）与
  `npm run typecheck`（`tsc --noEmit`），并纳入 `npm run verify` / `verify:prod`。
- 测试侧新增 `tests/helpers/load-ts.mjs`：用 esbuild 把 TS 模块打包成临时 ESM 后再 import，
  使测试与构建共用同一条编译链（项目根为 commonjs，Node 不能直接 import `.ts`）。

### 新增：AI 批改接口预留（P0.4，未接入真实模型）

- `src/config/features.ts`：前端 Feature Flag，`AI_GRADING_ENABLED` 默认 `false`；
  支持 `window.__QINGCI_FEATURE_OVERRIDES__` 做灰度/排障覆盖。
- `src/types/grading.ts`：批改数据契约——`gradeStatus`
  （`not_submitted` / `pending` / `graded` / `failed` / `not_implemented`）、
  `GradeResult`（15 分制总分 + 内容/连贯/语言/丰富四维 + 批注 + 建议）、`gradeVersion`。
- `src/services/grading.ts`：`gradeSubmission()`——开关关闭时**不发起任何请求**，
  20s 超时、错误归一、结构自检，永不抛异常。
- `functions/api/grade.ts`：Pages Function 占位端点，固定返回
  `{ status: 'not_implemented', message: 'AI 批改功能尚未开放' }`；预留
  `AI_GRADING_ENABLED` / `DEEPSEEK_API_KEY` / `AI_GRADING_DAILY_LIMIT` 读取位置，
  **不调用任何外部 API、不读取密钥、不产生费用**。
- 应用侧：「提交 AI 批改」入口 + 批改报告占位卡片（未批改不显示任何虚拟评分）、
  「洞府」页新增「AI 批改与数据使用」用户开关（默认关闭）与隐私条款占位。
- 测试：新增 `tests/grading.test.mjs` 10 条用例（开关关闭零请求、501 归一化、
  脏结构丢弃、网络异常、Function 200/400/405/204 契约）。

### 新增：PWA 安装与离线可用（P0.5 第一批）

- `manifest.webmanifest`：名称 / 图标 / `start_url` / `standalone` 展示模式，
  含 192、512 两种尺寸与 `maskable` 变体，满足浏览器安装条件。
- `scripts/make-icons.mjs`：**零依赖** PNG 图标生成器（自写 PNG chunk + zlib），
  几何绘制「金色掌握度环 + 山峦」，确定性产出 4 个图标，不引入 canvas/sharp。
- `src/sw.template.js` → 构建产出 `dist/sw.js`：外壳预缓存、导航 network-first
  回落缓存、`/audio/*` cache-first（为后续真实听力音频预留）、
  `/healthz`、`/status`、`/api/*` 一律 network-only（不把接口伪装成离线可用）、
  缓存版本按「版本号-产物指纹」注入，激活时清理旧缓存。
- `src/services/pwa.ts`：Service Worker 注册与「新版本已就绪，点击刷新」提示条；
  `file://` 或非安全上下文自动跳过，注册失败静默降级。
- `src/services/offline-store.ts`：IndexedDB 离线数据仓库，按版本缓存内联的词库与试卷，
  版本未变时复用（避免每次启动写 ~300KB）；IndexedDB 不可用时全部降级、不抛异常。
  学习进度仍以 localStorage 为唯一权威存储，本模块只缓存可再生数据，因此无需迁移。
- 构建与部署：`dist/` 同时产出 `index.html` 与 `cet4-xiuxian.html`；
  `prepare:deploy` 拷贝 PWA 资源；`_headers` 为 `sw.js` 声明 `no-cache`、
  图标 `immutable`；`server.mjs` 本地服务补齐 `/manifest.webmanifest`、`/sw.js`、`/icons/*`。
- 新增 `npm run verify:pwa`：校验 manifest 图标尺寸（含 maskable）、sw 预缓存清单文件是否
  齐全、页面是否正确引用，已纳入 `npm run verify` 与 `verify:prod`。
- 测试：新增 `tests/offline-pwa.test.mjs` 7 条用例（版本复用、缺失数据跳过、
  隐私模式降级、纯函数、注册条件与失败降级）。构建期还借此发现并修复了
  「缓存版本取自仓库创建时而非当前版本」的缺陷。

### 新增：错题本与 SM-2 间隔重复（P0.2）

- **数据模型** `src/types/mistakes.ts`：题型（听力 / 阅读 / 翻译 / 写作 + 承接心魔本的词汇）、
  题干、用户答案、正确答案、解析、错误次数、熟练度（0–5）、上次/下次复习时间、
  原文定位（试卷 + 门类 + 题号）、知识点标签；id 稳定（题库上线前用 FNV-1a 兜底，
  上线后直接采用题库 `q_<type>_<序号>`）。
- **调度算法** `src/services/srs.ts`：SM-2。忘记 q=2 / 模糊 3 / 记得 4 / 熟练 5；
  间隔 0.25 天 → 1 天 → 6 天 → 上次间隔 × EF；EF 下限 1.3、间隔上限 365 天；
  另含今日队列、7 天复习量预测、近 7 日新增/复习趋势与中文文案。
- **存储** `src/services/idb.ts` + `src/services/mistake-store.ts`：
  全应用共用一个 IndexedDB 并集中声明 schema（v1 datasets → v2 增加
  `mistakes` / `reviews` / `meta`，含 `nextReviewAt`、`type` 索引）；
  错题仓库提供入库、SM-2 复习（含复习日志）、到期队列、汇总、趋势、预测与清空。
- **旧存档迁移** `src/services/migrate.ts`：把 v3/v4 存档里的心魔本
  （`wrong`）与旧固定间隔进度（`schedule` 的 level/next/tries）换算成 SM-2 初值导入；
  **只读旧数据**、幂等（`meta` 里写 `legacy-migration` 标记）、可在启动时批量重跑。
- **界面**：「心魔」页新增错题本——题型筛选（含到期数）、开始今日复习、
  卡片翻转查看答案/解析/原文定位、四档反馈按钮、按题型与薄弱知识点统计、未来 7 天复习量；
  原有心魔单词列表保留。答错时由 `settle()` 钩子自动入库（含用户所选答案）。
- **测试**：新增 `tests/srs.test.mjs`、`tests/mistakes.test.mjs` 共 20 条用例
  （SM-2 数学、队列/预测/趋势、模型与汇总、仓库 CRUD 与复习日志、迁移幂等与降级），
  并新增 `tests/helpers/fake-idb.mjs` 最小 IndexedDB 桩件。

### 新增：随机练习与固化题库（P0.3）

- **固化题库** `scripts/build-question-bank.mjs`：从模板中抽取并**运行应用自身的生成器**
  （`rng / hash / pick / bankFor / makeQuestion / makeMemoryQuestion` 等，沙箱求值），
  因此题库内容与运行时生成的内容不会漂移；输出 18,502 题 =
  词汇 18,160（en2zh / listen / similar / spell 各 4540）+ 六套卷快照 342（每套 57 题）。
- **稳定 ID**：`q_vocab_<词序>_<题型>` 与 `q_paper_<卷 id>_<门类>_<序号>`，
  与内容一一对应；六套卷的题目 id 列表记录在 `papers` 字段中。
- **标签与难度**：`difficulty` 0.2–0.8（词长 + 题型系数 / 门类基准 + 序号抖动）、
  `discrimination` 启发式先验（模型版本记在 `discriminationModel`，待真实作答统计校准）、
  `knowledgeTags`（cet4 / w: / len: / kind: / paper: / gate:）、听力题带 `audioMeta`。
- **组卷算法** `src/types/question-bank.ts`：按题型分布、难度区间、部分、卷别筛候选集，
  再在候选集内**加权随机**（权重 = 区分度 × 难度贴合 × 标签命中），最后按难度升序；
  抽题用带种子的 mulberry32，同种子可复现。
- **防重复** `src/services/question-bank.ts`：300 题近期窗口（`qingci.bank.recent`），
  组卷时自动排除；题库加载走 内存 → IndexedDB → 网络，并回写缓存以支持离线组卷。
- **交互**：试炼殿新增「随机练习（20 题）」，复用既有答题 / 判分 / 错题本链路
  （`ask()` 优先向题库会话取题）；题库题目带 `questionId`，错题本以此为主键关联题库。
- **交付**：题库 6.23 MB（gzip 761 KB / br 536 KB）超过 1.5 MB 阈值 ⇒ 独立 JSON 交付，
  由 Service Worker 与 IndexedDB 按需缓存，不拖慢 520 KB 的单文件首屏。

### 新增：词汇分级 + SRS 间隔重复（P1 任务 A）

- **分级数据** `scripts/build-vocab-grades.mjs` → `src/data/vocab-grades.json`（42.5 KB，构建时内联）：
  高频 681 · 核心 1589 · 低频 1452 · 认知词 818。默认启发式（词长 / 词缀复杂度 /
  是否出现在六套卷命题材料 / 释义长度）按百分位分档；`--frequency freq.txt` 可直接换真实词频表。
- **调度引擎复用**：抽取 `scheduleNext(state, rating)` 纯函数，错题本与词汇共用 SM-2；
  **队列分开**：词汇存 IndexedDB 新增的 `vocab` 仓库（schema v2 → v3），错题仍存 `mistakes`。
- **旧档迁移**：localStorage 的 `state.schedule`（0.25/1/3/7 天）换算为 SM-2 初值导入，
  只读旧数据、幂等（`meta` 标记 `vocab-legacy-migration`）。
- **单词增强** `src/services/vocab-enrich.ts`：词缀拆分、易混词（Levenshtein + 前缀相似）、
  搭配框架、发音走 SpeechSynthesis；**不伪造真题例句**，仅在本应用原创材料命中时作「本卷例句」展示。
- **复习出题** `src/services/vocab-question.ts`：五种题型（en2zh / zh2en / listen / similar / spell），
  题目 id 与固化题库规则一致（`q_vocab_<词序>_<题型>`），因此错题本能直接关联题库内容。
- **心魔联动**：复习评「忘记」→ 同时写入错题本与心魔；评「认识 / 熟练」→ 移出心魔。
- **动态学习量** `src/services/study-plan.ts`：按考试日期、已掌握量、每日时长、到期量与近期正确率
  算出每日新词量、复习目标与题型配比，并支持按完成率 / 模考得分率动态调整；含日历热力图数据。
- **界面**：「今日功课 → 词汇间隔复习」卡片：计划摘要、四档筛选、今日复习 / 学新词入口与统计条；
  `ask()` 优先向词汇复习会话取题，评分按钮回写 SRS。

### 新增：模考报告与薄弱点分析（P1 任务 B）

- **作答流水**：`settle()` 埋点记录每题（题目 id / 题型 / 部分 / 知识点标签 / 对错 / 耗时 / 时间），
  `finishPaper()` 记录每次模考的汇总报告；IndexedDB schema v3 → **v4** 新增 `attempts`、`reports`
  （自增主键 + 时间/题型/试卷索引）。
- **报告内容** `src/types/report.ts`：总分、目标分（及格线）差距与「还差几题」、各题型得分率、
  作答进度、平均每题耗时、按部分耗时分布、近 7 日正确率趋势（按本地日期聚合）。
- **薄弱点识别**：按题型 / 部分 / 知识点三个维度聚合，用 **Wilson 95% 下界**排序并乘样本量权重；
  样本 < 3 题标为「样本不足」，只提示不推荐——避免 1 题错误被当成最弱项。
- **自适应推荐** `src/services/recommend.ts`：最弱项 → 组卷参数（题型 / 标签 / 部分）→
  复用 P0.3 题库加权组卷，自动避开近期做过的题，并给出可读的推荐理由。
- **轻量可视化** `src/services/charts.ts`：手写 SVG 条形 / 折线 / 环形 / 热力网格，
  复用主题 CSS 变量（深浅色自动跟随）。**不引入 Chart.js / ECharts**：
  ECharts 约 1 MB、Chart.js 约 200 KB，会破坏「运行时零依赖 + 单文件」与 <100 KB 的可视化预算；
  本次任务 B 全部新增合计仅 **+22 KB**。
- **界面**：「洞府 → 模考报告与薄弱点」卡片：最近一次模考条形图 + 目标分对比、
  7 日趋势折线、「按薄弱点推荐练习」一键组卷（复用随机练习会话）、耗时分布。

### 新增：动态学习计划与自适应摸底（P1 任务 C）

- **自适应词汇量测试** `src/services/assessment.ts`：阶梯式难度 1–5（答对升、答错降），
  每级对应一个词库分档；题量最少 30、最多 50，达到 30 题后若最近 8 题正确率极端
  （≥87.5% 或 ≤12.5%）提前收敛。
- **估计与区间**：`Σ 各档词量 × 该档掌握率`（Laplace 平滑 + 向阶梯先验收缩），
  区间由各档 Wilson 下/上界加权得到，另给置信度（题量 + 分档覆盖）与不足说明。
- **计划设置** `src/services/plan-settings.ts`：考试日期 / 每日可用分钟 / 目标词量存 localStorage，
  读取时规范化（脏数据回落默认、分钟夹紧 10–240、非法日期回落 2026-12-12）。
- **计划页**：「今日功课 → 动态学习计划」：设置输入 + 计划摘要与建议 + 三条进度条
  （词汇覆盖 / 今日新词 / 今日复习）+ 题型配比与强度标签 + 近 28 天学习热力图。
- **动态调整**：计划读取词汇 SRS 到期量与近 30 天作答正确率，并按完成率、正确率、
  最近模考得分率调用 `adjustPlan` 调整新词量与题型配比；调整理由直接显示在卡片上。
- **联动**：自适应摸底结果写回 `state.assessment` 并据此设置每日目标；
  `choose()` 的摸底分支与「开始摸底」按钮已接入新引擎（旧 10 题流程保留为兜底）。

### 新增：听力精听框架（P1 任务 D）

- **audioMeta 时间戳结构** `src/types/audio.ts`：`AudioSegment{id,start,end,text,translation?,tags?}` +
  `AudioTrackMeta{kind:'tts'|'file', url?, text?, lang, durationSec, segments, timing, transcriptSource, available}`；
  含文本切句（长句二次切分）、时间戳估算、`segmentAt/neighbor/indexOf` 查找、A-B 区间夹紧、
  听写逐词比对（`checkDictation`：匹配率 + 漏写 + 多写）。
- **音频提供方分层** `src/services/audio-provider.ts`：
  `AudioProvider{canPlay,create}` + `AudioHandle{play,pause,stop,setRate,onEnd}`；
  已实现 `createTtsProvider`（SpeechSynthesis 占位）与 `createElementProvider`
  （`<audio>` + `preservesPitch` 变速不变调，素材就位即可启用）；`pickProvider` 自动选择。
- **精听播放器** `createIntensivePlayer`：逐句复读、自动续播、循环（关 / 单句 / A-B）、
  A/B 打进点、变速 0.5×–2×、原文开关、听写模式与按句缓存结果。
- **界面**：音频坞新增「精听」按钮 → 全屏精听面板：控制条 + 逐句列表（当前句高亮、
  A-B 区间标记、逐句复读、听写输入与逐词差异）；键盘 ←/→ 切句、空格播放、Esc 关闭。
- **诚实标注**：面板底部与文档都写明当前为语音合成占位、时间轴为估算、A-B 按句界定；
  接入真实音频（url + 逐句时间戳）后自动显示「真实时间轴」并按秒循环，UI 与逻辑不变。
- **健壮性**：「已有 mp3、暂无逐句时间戳」的音轨保留 `kind:'file'` 与 `url`（不会被误判成 TTS），
  时间轴暂标 `estimated`；无文本的音轨标记为不可精听。

### 新增：反馈入口与公开更新日志（P1 任务 E）

- **反馈入口**：「洞府 → 反馈」覆盖层表单（类型 / 描述 5–2000 字 / 可选截图 ≤512KB /
  可选联系方式 / honeypot 反垃圾），提交结果显示状态；客户端只 POST 本站 `/api/feedback`，
  **不接任何第三方表单服务**。
- **离线兜底** `src/services/feedback.ts`：网络失败或服务未配置（503）时把内容留在本机队列
  （localStorage，最多 10 条），打开页面或恢复网络自动重试；校验规则与服务端保持一致。
- **服务端** `functions/api/feedback.ts`：POST 校验 → 同 IP 哈希每小时 5 条限流（查 D1，无需 KV）
  → 写 D1；honeypot 命中返回 202 但不入库；未绑定 `DB` 时返回 503 与可读原因；
  其它方法 405、OPTIONS 204。**不保存原始 IP**，只存加盐 SHA-256 前 16 位用于限流。
- **建库脚本** `db/schema.sql`：`feedback` 表 + 时间/类型/IP 索引，附 wrangler 命令说明。
- **公开更新日志**：`scripts/build-changelog.mjs` 在构建期把 `CHANGELOG.md` 渲染为静态页
  `dist/changelog.html`（17 个版本、51.8 KB、无脚本无外部资源），随部署发布；
  应用内「更新日志」按钮打开该页，并已加入 Service Worker 预缓存（离线可看）。
- **构建与部署**：`npm run build` 现在同时产出 `changelog.html`；`prepare:deploy` 会拷贝它；
  `/api/*` 已在 `_routes.json` 通配范围内，新端点无需改路由。

### 校验（覆盖上面全部未发布改动）

- `tsc --noEmit` 通过；自动化测试 **190/190** 通过
  （批改 10、离线/PWA 7、主题与快捷键 7、SM-2 与错题本 20、题库与组卷 15、
  词汇分级与 SRS 12、学习计划 6、报告与推荐 11、自适应摸底与计划设置 8、听力精听 8、
  反馈与更新日志 9、境界与称号与小组 14、无障碍与个性化 8，另含核心 / Worker / Functions 既有用例）；
  文档示例核验 26/26 通过；`verify:pwa` 通过；本地健康检查 4 端点 200。
- 本地服务端到端：`/manifest.webmanifest` 200（application/manifest+json，no-cache）、
  `/sw.js` 200（application/javascript，no-cache）、`/icons/*.png` 200（immutable）。
- 产物核验（P0.5 第二批，13 项）：三档断点、全宽选项、44px 点击区、吸顶计时器、
  贴底播放条、手动主题变量与首屏脚本、快捷键/主题/媒体服务内联，全部通过。
- 产物核验（P0.2，13 项）：错题本面板与筛选/卡片/统计容器、翻转卡样式、
  `settle()` 记录钩子与用户答案捕获、SM-2/错题模型/迁移服务内联、
  迁移完成事件、旧心魔本保留、四类题型标签齐全，全部通过。
- 产物核验（P0.3，14 项）：题库结构合法、题数 18502、六套卷快照各 57 题、
  词汇四题型各 4540、id 全局唯一、难度区间 0.2–0.8、区分度与标签齐全、
  听力 audioMeta、题库服务内联、随机练习入口与会话钩子、`ask()` 接入、
  错题本与题库 id 打通，全部通过。
- 产物核验（P1 任务 A，17 项）：分级数据结构与四档覆盖 4540 词、启发式来源如实标注、
  可替换真实词频、分级数据内联、复习卡片与筛选/统计容器、评分回写钩子、`ask()` 优先取题、
  词汇 SRS / 学习计划 / 增强信息内联、旧档迁移与心魔联动钩子，全部通过。
- 产物核验（P1 任务 B，18 项）：报告卡片与容器、推荐/刷新按钮、两处埋点接入
  （试卷分支与自由练习不重复计）、`finishPaper` 报告钩子、计时起点、Wilson 薄弱点、
  SVG 图表样式内联、无外部图表库、推荐组卷与会话启动器、报告仓库与 v4 升级、
  知识点标签透传，全部通过。
- 产物核验（P1 任务 C，17 项）：计划卡片与设置输入、摸底启动/答题钩子、
  `choose()` 摸底分支与开始按钮接管、自适应引擎内联、三条进度条、28 天热力图、
  设置持久化、摸底结果联动每日目标，全部通过。
- 产物核验（P1 任务 D，20 项）：精听入口与覆盖层、播放/上一句/下一句、循环与 A-B 打点、
  0.5×–2× 语速、原文开关、听写模式、时间戳结构与真实音频元数据、提供方抽象与自动选择、
  A-B 循环逻辑、听写比对、诚实标注、键盘快捷键，全部通过。
- 产物核验（P1 任务 E，20 项）：反馈按钮与表单四要素、honeypot、隐私说明、
  状态与队列提示、无第三方表单服务、离线自动重试、更新日志页（倒序/无脚本/无外部资源）、
  SW 预缓存与部署拷贝、Function 的 D1 写入/限流/降级/honeypot/方法约束/不存原始 IP、
  D1 schema 与索引，全部通过。
- 产物核验（P2.11，20 项）：境界卡与进度条、五档阈值、双条件晋级、只升不降、
  称号墙与三类称号门槛、不惩罚设计、道友卡与隐私声明、昵称校验、进度分档、
  榜单脱敏、突破动效与减少动效偏好、修为/境界不混淆、D1 两表且无分数字段、
  未配置降级，全部通过。
- 产物核验（P2.12，23 项）：lang / skip link 与目标 / main landmark / 题干 aria-live /
  选项组语义 / 错误横幅 role=alert / 反馈区 aria-live / 三个 dialog / ✓✗ 前缀 /
  高对比度主题 / 字号变量 / 焦点可见 / 减少动效 / sr-only / 首屏防闪烁 /
  无障碍设置卡片 / aria-pressed / Esc 关弹窗 / 焦点管理 / 播报通道 /
  1–4 选择接线 / Enter 推进接线 / 空格播放接线，全部通过。
- 核心源码（`src/core`、`functions/`、`worker/`）行覆盖率 100%，
  统计含测试脚本时整体行覆盖 99.73%、分支 87.88%、函数 96.99%。

### 新增：移动端适配与键盘/媒体增强（P0.5 第二批）

- **三档响应式断点**：手机 `<768px`、平板 `768–1024px`、桌面 `>1024px`
  （原有 640/860/600/380px 规则保留，作为更细的小屏微调）。
- 手机端做题体验：选项改为全宽卡片、点击区 ≥44px；听力播放条固定在屏幕底部
  （含 `env(safe-area-inset-bottom)` 适配）；模考计时器所在行吸顶；
  桌面端选项两列排布，减少滚动。
- **手动主题**：`src/services/theme.ts`（纯函数 + DOM 应用），
  「洞府 → 外观」可切换 跟随系统 / 浅色 / 深色，偏好存 localStorage；
  `<head>` 内联脚本先行应用，避免首屏闪色；CSS 用 `:root[data-theme]` 覆盖系统偏好。
- **键盘增强**：`src/services/shortcuts.ts` 纯函数解析按键，
  新增 `←/↑` 只读回看上一题（基于 `#prompt` 的 MutationObserver 快照）、
  `→/↓` 下一题；数字键、`Enter`、`空格` 沿用应用原有处理；输入框内与修饰键组合不拦截。
- **Media Session**：`src/services/media-session.ts`，听力播放时声明元数据与
  play/pause/stop 动作，锁屏、通知栏与蓝牙耳机可控；API 不存在时静默跳过。

### 变更：仓库清理（隧道时代遗留）

移除保活 / 守护设施，线上巡检统一走 `prod-probe`；不改动任何业务代码。

- 移除 `npm run keepalive`、`npm run supervise`、`npm run watchdog` 三个脚本入口：
  前两者依赖免账号 Cloudflare 快速隧道（已弃用）；后者按 README 中记录的
  `*.trycloudflare.com` 地址工作，README 清理后已解析不到目标地址。
- 删除 `scripts/supervisor.mjs`（守护本地服务与 cloudflared 进程）与
  `scripts/watchdog.mjs`（隧道保活 + 单次巡检），二者均无其他引用。
- `npm run probe:prod` 新增 `--strict`（任一采样非 200 或超阈值即退出码 1），
  另提供 `npm run probe:prod:strict`；`verify:prod` 的线上巡检随之改用它，
  保留门禁语义并把采样覆盖由 3 个端点扩到 4 个。
- `docs/部署说明.md`：删除整节 Cloudflare 快速隧道配置与实测，隧道方案压缩为一句
  「已弃用」；总览中的隧道行改为「其他静态托管」；澄清纯静态平台无动态接口、
  Pages 通过 `functions/` 提供动态接口；常见问题按 Pages 形态重写。

### 已知边界

- 线上版本 **1.5.0**（2026-10-03 10:54 部署，含 P0/P1/P2.11/P2.12 与 D1 绑定）；`/healthz` 与 `/api/meta` 均报 1.5.0。
- 前端产物体积 677.9 KB → **693.3 KB**（服务层 123.5 KB）；另有 6.23 MB 固化题库按需加载。
- **道友小组与反馈已接入 D1**（库 `qingci-feedback`，2026-10-03 配置并实测 25/25 通过）；
  未绑定 `DB` 的环境仍会自动降级（503 → 本机模式 / 本地队列），配置步骤见 README「D1 配置」与部署说明。
- **听力精听暂无真实音频**：当前用语音合成占位、时间轴按文本估算、A-B 循环按「句」界定；
  接入真实音频（url + 逐句时间戳）后自动按秒精确循环，UI 无需改动。
- **听力音频素材本身仍缺失**（版权与托管未定），这是内容问题，不是代码问题。
- **自适应摸底是启发式**（阶梯难度 + 分档加权），输出估计值与区间而非精确测量；
  题目难度来自词库分档，未做预试校准；界面同时展示区间与置信度。
- **听力音频素材本身仍缺失**（版权与托管未定），这是 P1 遗留的内容问题，不是代码问题。
- **自适应摸底是启发式**（阶梯难度 + 分档加权），输出估计值与区间而非精确测量；
  题目难度来自词库分档，未做预试校准；界面同时展示区间与置信度。
- **薄弱点推荐依赖题库**：题库需联网载入一次（之后 SW + IndexedDB 可离线组卷）；
  未载入时推荐按钮会提示，不影响报告本身。
- **报告样本量**：薄弱点每项至少 3 题才会进入推荐；新用户前几天会显示「样本不足」。
- **词汇分级是启发式**（词长 / 词缀 / 命题材料命中 / 释义长度），不等于真实语料词频；
  产物 `source` 字段与界面均已标注，替换方式见 `--frequency` 参数。
- **例句**：只提供搭配框架；真题例句需要授权材料，本应用不伪造（原创材料命中时展示「本卷例句」）。
- `src/core/*.js` 与 `functions/*.js` 尚未迁移为 TypeScript，属后续增量迁移范围。
- 题库的 `discrimination` 是启发式先验，尚未用真实作答数据校准。
- 真机验收（iOS Safari 添加到主屏、Android Chrome 安装、锁屏媒体控制）尚未执行。

---

## [1.3.1] - 2026-10-03

本次为**线上接口一致性修复版本**：补齐 Pages 侧缺失的 `/status` 端点，并让该端点
在监控中不再被 SPA 回退伪装成正常。

### 新增

- `functions/status.js`：Pages 侧的人类可读状态页，与本地 `server.mjs`、
  Workers `worker/index.mjs` 三处同构（版本、词库条数、运行环境、接口入口链接）。
- `_routes.json` 的 include 白名单加入 `/status`，使该路径真正命中 Function。
- `tests/functions.test.mjs`：Pages Functions 单元测试 7 条，覆盖
  `/healthz`、`/status`、`/api/meta` 的正常、静态元数据缺失与绑定抛异常三条分支。
- `functions/package.json`：就近声明 `type: module`，使项目根为 commonjs 时
  Node 测试仍可直接 import 这些 ESM Function 文件。

### 修复

- **`/status` 在 Pages 上并不存在**：未列入 `_routes.json` 的路径会走 SPA 回退，
  返回应用页面（HTTP 200 + 469 KB HTML），因此 `npm run probe:prod` 里
  `/status` 的采样只是重复下载首页，且偶发超过 2 秒阈值——监控看似正常，实则被骗过。
  补齐后该路径只返回约 1.2 KB 状态页，中位耗时由 852ms 降至 323ms。
- 版本号同步至 1.3.1（`package.json`、`wrangler.toml`、Functions 默认回退值）。
- 文档中原先把 `/status` 当作线上可用端点的表述、以及「未匹配路径返回 404」
  的笼统说法，已按三处入口的实际行为分别标注。

### 验证

- 自动化测试：56/56 通过（新增 7 条 Functions 用例）。
- 覆盖率：行 100%、分支 82.26%、函数 96.55%。
- 文档示例核验：26/26 通过（版本号示例已指向线上 v1.3.1）。

### 部署

- 2026-10-03 部署到 Cloudflare Pages 生产环境（`https://qingci-cet4-xiuxian.pages.dev`）。
- 线上验收：`/healthz`、`/api/meta` 均返回 `version: 1.3.1`；
  `/status` 返回 `text/html` 状态页（1231 B，含「服务状态」与 v1.3.1，确认非应用页回退）；
  首页构建戳为 `v1.3.1`、469.4 KB。
- 线上采样（每路径 10 次 × 2 轮，共 80 次请求）：**80/80 返回 HTTP 200 且低于 2000ms 阈值**，
  中位耗时 `/healthz` 235ms · `/api/meta` 255ms · `/status` 323ms · `/` 399ms。

---

## [1.3.0] - 2026-09-30

### 新增

- 新增五类备考选择：初中英语、高中英语、PETS-3、CET-4、CET-6。
- 新增原创整套模拟卷参数：题量、时长、总分和及格线按考试类型配置。
- 境界突破改为：必须完成整套试卷且达到对应及格线；中途交卷或未达线不突破。
- 新增境界动态难度：根据考试等级与当前境界计算 1–5 级难度，动态筛选词汇长度和训练材料。
- 题目来源在界面、文档和 API 元信息中标注；未完成授权核验的公开真题不导入。

### 修复

- **三个入口的 `/api/meta` 字段不一致**：`examTypes`、`examSourcePolicy` 只在
  Pages Functions 中返回，本地 `server.mjs` 与 Workers `worker/index.mjs` 均缺失，
  而 API 文档已声明返回这两个字段。现已统一取自 `src/core/utils.js` 的
  `EXAM_CONFIGS`，三处行为一致，并补充 Workers 侧单元测试锁定。

### 边界

- 新增考试模式当前为原创练习/原创模拟，重点覆盖词汇、词义和轻量语法分类，不冒充官方真题，也不宣称覆盖完整听力、篇章阅读或人工写作评分。

### 验证

- 核心自动化测试：49/49 通过。
- 五类考试配置、难度封顶、及格线边界均有单元测试。
- 三处入口的 `/api/meta` 字段一致性有单元测试覆盖。
- 覆盖率：行 100%、分支 83.02%、函数 98.08%。
- 真实浏览器验证：五类模式均能切换，初中模式显示 40 题、45 分钟、60/100 及格线、难度 1/5，并带原创来源标记。

### 部署

- 2026-10-03 部署到 Cloudflare Pages 生产环境（`https://qingci-cet4-xiuxian.pages.dev`）：
  线上 `/healthz` 与 `/api/meta` 均返回 `version: 1.3.0`，`/api/meta` 含
  `examTypes` 五类模式与 `examSourcePolicy`；线上首页 469.4 KB，含五类备考标记与 v1.3.0 构建戳。
- 线上采样（每路径 10 次 × 2 轮，共 80 次请求）：**80/80 返回 HTTP 200**；
  `/healthz`、`/api/meta` 两轮均 20/20 在 2000ms 阈值内（中位 271ms / 577ms）；
  `/status`、`/` 因需传输 469KB 入口页偶有单次超阈值（中位 852ms / 1121ms）。
- 记录一处线上与本地/Workers 的行为差异：Pages 未配置 `/status` 对应的 Function，
  未匹配路径按 SPA 回退返回应用页（HTTP 200 + HTML），该路径不代表独立状态页；
  当时状态页仅由本地 `server.mjs` 与 Cloudflare Workers 提供。**该问题已在 v1.3.1 修复。**

---

## [1.2.2] - 2026-09-30

本次为**线上一致性修复版本**：解决「重新部署后线上版本号与仓库不一致」以及
「文档版本号滞后」两类问题。

### 修复

- **线上版本号与仓库不同步**：线上 `/healthz` 返回 `1.2.0`，而仓库 `package.json`
  已是 `1.2.1`。原因是 `wrangler.toml` 的版本修正后**未重新部署**，线上仍是旧构建。
  已执行 `npm run deploy:pages` 重新部署，线上 `version` 现为 `1.2.1`。
- **文档版本号滞后**：`README.md`、`docs/API.md`、`docs/使用文档.md`、
  `docs/全新环境验证记录.md` 中标注的适用版本仍为 `v1.2.0`，与产物实际版本不符。
  已全部同步为 `v1.2.1`（历史快照类记录按原样保留，以如实反映当时环境）。

### 验证

**全新环境复测**（复制仓库副本，排除 `node_modules/`、`dist/`、`deploy*/`、
`.wrangler/`、`.git/` 后的干净目录）：

| 步骤 | 结果 |
|---|---|
| 环境检查 | ✅ `node_modules` 不存在、`dist` 不存在（确为全新） |
| `npm install` | ✅ up to date, audited 1 package in 323ms, 0 vulnerabilities |
| `npm run build` | ✅ 产出 `dist/cet4-xiuxian.html` 474,673 字节，词库 4540 条 |
| `npm test` | ✅ 45 tests / 45 pass / 0 fail |
| `npm run test:coverage` | ✅ 行 100%、分支 82.78%、函数 97.92% |
| `npm run test:docs` | ✅ 26 条文档示例全部通过 |
| `npm run healthcheck` | ✅ `/healthz` `/api/meta` `/status` `/` 均 200 |

**产物完整性核对**：构建产物含 `<title>`、斗法场、学情看板、拼写默写三个关键
功能标记，内嵌词库解析为 4540 条，非空壳产物。

**线上复测**（`npm run probe:prod`，每路径 10 次采样）：

```text
路径        中位      最快      最慢      阈值内    超 2 秒
/healthz    209ms    191ms     615ms    10/10     0    ✅
/api/meta   199ms    186ms     723ms    10/10     0    ✅
/status     300ms    272ms     650ms    10/10     0    ✅
/          270ms    267ms     637ms    10/10     0    ✅
```

✅ **40/40 采样全部返回 HTTP 200 且低于 2000ms 阈值。**

---

## [1.2.1] - 2026-09-30

本次发布为**可复现性验证版本**：在全新干净环境中严格按 README 步骤完整跑通，
并修正文档与实际不符的测试计数。

### 新增

- `docs/全新环境验证记录.md`：记录在无 `node_modules`、无 `dist` 的干净目录中，
  按 README 步骤逐条执行 `npm install → build → test → test:coverage → test:docs → verify`
  的完整输出与耗时，作为「按文档步骤可成功运行」的可复现证据。

### 修复

- **README 测试计数与实际不符**：徽章与正文标注「30 个测试 / 分支 81.3%」，
  实际为 **45 个测试 / 分支 82.78%**。已同步修正三处（徽章、快速开始注释、技术特色）。
  原因是此前 `tests/worker.test.mjs` 新增 15 个 Worker 用例后未回改 README。
- **`npm run verify` 不自闭环**：`healthcheck` 原先假定本地服务已在运行，
  在全新环境中会因 `ECONNREFUSED` 直接失败，与 README「一条命令跑通」的表述不符。
  现改为**检测到服务未运行时自动拉起 `server.mjs`，检查结束后自动关闭**，
  使 `verify` 在零前置步骤下可一次通过。
- **版本号不同步**：`wrangler.toml` 的 `APP_VERSION` 停留在 1.2.0，导致健康检查
  返回的版本与 `package.json` 不一致。已同步至 1.2.1。

### 验证

在全新环境实测，`npm run verify` 一键链路全绿：

| 步骤 | 结果 |
|---|---|
| `npm install` | ✅ up to date, 0 vulnerabilities（零外部依赖） |
| `npm run build` | ✅ 产出 dist/cet4-xiuxian.html，463.5 KB，词库 4540 条 |
| `npm test` | ✅ 45 tests / 45 pass / 0 fail |
| `npm run test:coverage` | ✅ 行 100%、分支 82.78%、函数 97.92% |
| `npm run test:docs` | ✅ 26 条文档示例全部通过 |
| `npm run healthcheck` | ✅ `/healthz` `/api/meta` `/status` `/` 均 200 |

线上环境同步复测（`https://qingci-cet4-xiuxian.pages.dev`）：
`/healthz` HTTP 200 / 0.82s，`/api/meta` HTTP 200 / 0.76s，均在 2 秒阈值内。

---

## [1.2.0] - 2026-09-30

线上环境从「Workers 单一入口」升级为「Workers + Pages 双通道」，并解决
`*.workers.dev` 在部分网络环境不可达导致的线上不可访问问题。

### 新增

#### Cloudflare Pages 正式部署（主用入口）
- `functions/healthz.js`、`functions/api/meta.js`：Pages Functions 动态接口，
  与 Workers 版 `worker/index.mjs` 返回**同构 JSON**
- `scripts/deploy-pages.mjs`：Pages 一键部署脚本。因 wrangler 只认
  `wrangler.toml` 一个文件名，而 Workers 的 `main` 与 Pages 的
  `pages_build_output_dir` 互斥，脚本在部署 Pages 时临时切换配置，
  并在 `finally` 中无条件还原，避免污染 Workers 部署
- `npm run deploy:pages` 命令
- `_routes.json` 路由声明：把 `/healthz` 与 `/api/*` 交给 Functions，
  其余路径走静态资源

### 变更

- `scripts/prepare-deploy.mjs`：新增 `--pages` 模式。该模式输出到
  `deploy-pages/`，生成 `_routes.json` 且**不生成** `_redirects`。
  原因：`/* /index.html 200` 会把接口请求一并重写成 HTML，
  导致 `/healthz` 返回页面而非 JSON。
- `wrangler.toml` 注释完善，明确 Workers / Pages 两套部署命令的分工。
- `.gitignore` 增加 `deploy-pages/`。

### 修复

- 修复 `/healthz` 与 `/api/meta` 在 Pages 上被 SPA 回退拦截、返回 HTML
  的问题（改为 Functions + `_routes.json` 精确路由）。
- 修复 `functions/` 目录位置错误导致 Functions 未被编译上传的问题：
  该目录须位于项目根，而非静态产物目录内。

### 线上实测（2026-09-30）

| 端点 | 状态 | 响应时间 |
| --- | --- | --- |
| `GET /healthz` | 200 | 0.82 – 0.97 s（5 次采样） |
| `GET /api/meta` | 200 | 0.73 s |
| `GET /`（应用首页） | 200 | 1.57 s |

Pages 域名的可用性优于 `*.workers.dev`：后者在部分网络环境下因 DNS 污染
无法直连（解析到无关 IP），前者可正常直连访问。

---

## [1.1.0] - 2026-09-30

从「临时隧道演示」升级为「固定地址的正式线上服务」。

### 新增

#### Cloudflare Workers 正式部署
- `worker/index.mjs`：边缘运行时入口，与 `server.mjs` 提供**等价接口**
  - `GET /healthz` 健康检查（含词库条数校验、ASSETS 绑定状态、边缘节点标识）
  - `GET /api/meta` 应用元信息
  - `GET /status` 人类可读状态页
  - `GET /` 应用页面（经 ASSETS 静态资源绑定）
- `wrangler.toml`：Workers 配置，声明 `assets` 静态资源绑定与 `APP_VERSION` 变量
- `scripts/deploy-workers.mjs`：一键部署（构建 → 生成部署目录 → 同步版本 → 上传 → 记录线上地址）
- `npm run deploy` / `npm run prepare:deploy:workers` 命令
- `docs/上线操作指引.md`：OAuth 与 API Token 两种授权方式的操作指引
- `deploy-url.txt` 自动记录正式地址，供验收脚本引用

#### Worker 测试
- `tests/worker.test.mjs`：15 个用例，覆盖路由分发、健康检查升降级、元信息、
  静态透传、响应头契约、环境变量回退等
- 测试总数由 30 增至 **45**，分支覆盖率 81.3% → **82.78%**，行覆盖 **100%**

### 变更

- `scripts/prepare-deploy.mjs`：新增 `--workers` 模式，该模式下不再生成
  `_redirects`。原因：其通配规则 `/* /index.html 200` 会与 Workers 静态资源
  解析冲突，wrangler 会判定为无限循环并忽略（部署时产生告警）。
- `scripts/prod-probe.mjs`：默认线上地址由临时隧道改为读取 `deploy-url.txt`
  中的正式 Workers 地址。
- `tests/` 目录按模块拆分，`.test.js`（CommonJS）与 `.test.mjs`（ESM）并存，
  `npm test` 同时执行两类。

### 修复

- 修复 Worker 入口因 `package.json` 声明 `"type": "commonjs"` 而无法以 ESM
  加载的问题：入口与测试文件改用 `.mjs` 扩展名。
- 修复 `wrangler dev` 因 `_redirects` 无限循环规则产生的部署告警。

### 为什么换掉隧道方案

临时隧道（`*.trycloudflare.com`）每次重启都会生成新地址，导致线上环境地址
不稳定、无法作为长期可访问入口。Workers 提供固定的 `*.workers.dev` 永久地址，
且同样在免费额度内（每日 10 万请求）。

---

## [1.0.8] - 2026-09-30

性能缺陷修复版本。修复入口页 ETag 协商缓存失效问题，将公网二次访问从回源全量传输
改为 304 空响应。

### 修复

- `server.mjs` 入口页响应头丢失 ETag：压缩分支在设置响应头前提前 `return`，
  导致 `ETag` 未随响应下发，浏览器无法发起协商缓存，每次访问都需回源传输 464KB 正文。
  - 新增 `sendEntry()`：在压缩判定**之前**先处理 `If-None-Match`，命中即返回 304
  - `Vary: Accept-Encoding` 与 `ETag` 现在随压缩响应一同下发

### 效果

| 场景 | 修复前 | 修复后 |
|---|---|---|
| 公网首页二次访问 | 200 · 约 2.7s · 回源 464KB | **304 · 1.12s · 传输 0 字节** |
| 本地首页二次访问 | 200 · 5ms · 145KB | 304 · 3.8ms · 0 字节 |

### 验证

- `npm test`：30/30 通过
- `npm run test:docs`：26/26 通过
- 公网 `/healthz`、`/api/meta`、`/status` 每路径 10 次采样全部 200 且低于 2000ms

---

## [1.0.7] - 2026-09-30

静态托管实测与文档校正版本。

### 变更

- 部署文档补充静态托管实测数据，修正「静态托管无健康检查」的表述：
  `deploy/healthz.json` 提供等价静态健康检查，同样返回 HTTP 200 与版本、词库条数

### 实测（本机模拟静态环境）

| 项 | 值 |
|---|---|
| 首页传输 | 115 KB（brotli q11，原始 464 KB，减少约 76%） |
| `/healthz.json` | 200 · 1.7ms |
| 依赖回源 | 无（电脑关机仍可访问） |

---

## [1.0.6] - 2026-09-30

公网地址轮换版本。Cloudflare 免账号快速隧道重启后地址会变更，
本版本将全部文档、探测脚本中的公网地址同步为新隧道，并复采线上数据。

### 变更

- 公网地址更新为 `https://county-throws-caribbean-phase.trycloudflare.com`，
  同步至 `README.md`、`docs/API.md`、`CHANGELOG.md`、`scripts/prod-probe.mjs`
- `README.md` 线上实测数据按 `npm run probe:prod` 复采结果重写
  （每路径 10 次采样，四个端点 40/40 全部 200 且在 2000ms 阈值内）

### 验证

- `npm run verify`：构建 + 30 项测试 + 26 条文档示例 + 本地健康检查，全部通过
- `npm run probe:prod`：`/healthz` 451ms、`/api/meta` 434ms、`/status` 478ms、`/` 1203ms（均为中位数）

---

## [1.0.5] - 2026-09-30

公网在线稳定性版本。针对验收标准「线上环境接口返回 HTTP 200 且响应时间在 2 秒以内」，
修复隧道闲置休眠导致的冷启动超时问题，并补充可复现的在线巡检能力。

### 新增

- `scripts/watchdog.mjs` 公网看门狗：
  - 单次巡检：`npm run watchdog`，探测 `/healthz`、`/api/meta`、`/` 三个端点
  - 常驻保活：`npm run keepalive`，默认 60s 心跳（`--interval` 可调），
    持续唤醒 Cloudflare 免费隧道，消除闲置休眠带来的冷启动延迟
  - 延迟预算可通过 `LATENCY_BUDGET_MS` 调整；任一端点超预算即以退出码 1 报错，
    便于 CI / 定时任务告警，而非静默失败
- `scripts/supervisor.mjs` 公网守护者（`npm run supervise`，推荐）：
  在保活之外增加进程级自愈——本地服务掉线自动拉起、隧道进程缺失即告警，
  每轮打印各端点采样结果。解决「保活进程本身中断后冷启动立刻复现」的问题。
- `npm run verify:prod`：公网端到端验收（测试 + 文档核验 + 在线巡检）一键执行

### 修复

- **公网冷启动超时**：Cloudflare 免费隧道在闲置一段时间后休眠，
  恢复时首个请求需重新建立回源链路，实测 `/healthz` 曾达 2085 ms、`/` 达 2464 ms，
  超过 2000 ms 验收阈值。定位为隧道冷启动而非应用性能
  （同一时刻本地 `/healthz` 仅 5 ms）。已通过守护者常驻保活解决。
- **健康检查重复读取大文件**：`/healthz` 与 `/api/meta` 每次请求都重新读取并解析
  464 KB 的入口页以统计词库条数。已加内存缓存，两个端点变为纯内存响应。
- **入口页无有效缓存策略**：原 `Cache-Control: no-cache` 导致每次访问都回源传输
  464 KB 正文。已改为 `public, max-age=300, stale-while-revalidate=86400`，
  配合 ETag 协商缓存，重复访问命中 `304`。

### 验证

| 项目 | 结果 |
|---|---|
| 构建 | ✅ 通过（6 项关键结构校验全部生效，词库 4540 条） |
| 测试 | ✅ 30/30 通过 |
| 覆盖率 | ✅ 行 100%、分支 81.3%、函数 97.73% |
| 文档示例 | ✅ 26/26 通过 |
| 健康检查（本地） | ✅ 200 · 约 5 ms |
| 公网 32 次连续采样 | ✅ 32/32 达标（100%），零次超 2 秒；`/healthz` 中位 685 ms、最慢 1152 ms |

---

构建可复现性与线上环境刷新版本。

### 修复

- **构建产物不可复现**：`scripts/build.mjs` 每次构建都注入新的时间戳，
  导致同一份源码连续构建得到不同 sha256，ETag 协商缓存随之失效、产物无法比对。
  已改为复用上一次产物的构建时间戳（首次构建才生成），三次连续构建哈希完全一致。
- `docs/API.md` 文档头版本号滞后（标注 v1.0.0，实际为 v1.0.3），已同步并补充公网地址说明。
- `README.md` 线上地址与实测采样数据过期，已更新为当前有效隧道地址与最新采样结果。

### 变更

- 公网环境重新部署，线上地址更新为
  `https://county-throws-caribbean-phase.trycloudflare.com`。
- `scripts/prod-probe.mjs` 默认探测地址同步更新。

### 验证

| 项目 | 结果 |
|---|---|
| 构建 | ✅ 463.9 KB / 词库 4540 条 / 可复现（连续 3 次哈希一致） |
| 测试 | ✅ 30/30 通过 |
| 覆盖率 | ✅ 行 100%、分支 81.3%、函数 97.7% |
| 文档示例 | ✅ 26/26 通过 |
| 一键验收 `npm run verify` | ✅ 退出码 0 |
| 健康检查（本地） | ✅ 200 · 4–7 ms |
| 健康检查（公网） | ✅ 200 · 采样 6/6 达标，中位 461 ms，最慢 882 ms（阈值 2000 ms） |
| 元信息（公网） | ✅ 200 · 采样 6/6 达标，中位 430 ms，最慢 1159 ms |
| 公网页面一致性 | ✅ sha256 与本地构建产物完全一致，词库 4540 条 |

---

## [1.0.4] - 2026-09-30

构建可复现性与公网采样正确性修复版本。此前的构建产物因内嵌时间戳每次哈希都不同，
无法用于校验部署一致性；公网探针在基础地址含尾部空格时还会直接抛错。

### 修复

- `scripts/build.mjs`：构建产物改为**可复现**——复用固定的构建时间戳，
  连续三次构建的 sha256 完全一致，使「产物哈希」可以作为部署一致性的判据。
- `scripts/prod-probe.mjs`：修复 `PUBLIC_BASE_URL` **未做 `trim`** 导致拼接出非法 URL
  （基础地址尾部带空格时报 `ERR_INVALID_URL`），探针无法完成采样。

### 变更

- 全部文档版本号同步至 v1.0.4；`README.md` 实测数据对齐公网 **40/40 采样全部达标**。

### 验证

- 连续三次构建哈希一致（可复现构建成立）。
- 公网探针 40/40 采样达标。

## [1.0.3] - 2026-09-30

线上环境稳定性与部署工程化版本。修复压缩缓存缺陷，补齐静态托管产物与状态页。

### 修复

- `server.mjs` 压缩缓存命中时返回字段错位（原本取 `hit.buf`，实际返回的是 `entry` 对象），
  导致对较大响应启用压缩时连接被中断、返回空响应。已改为返回完整缓存条目。
- 压缩缓存键改由「内容长度 + 内容前缀」组合生成，避免不同响应互相覆盖。

### 新增

- **Brotli 压缩**：在 gzip 之外支持 `br`，页面由 464 KB → **127 KB**（降幅 73%）。
  服务启动时预热两种压缩结果，消除首个请求的冷启动开销。
- **ETag / 304 协商缓存**：入口页带内容指纹 ETag，重复访问返回 `304`（0 字节传输）。
- **`GET /status` 轻量状态页**：纯内联样式、无外部资源，便于在慢链路下快速确认服务可用。
- **`npm run prepare:deploy`**：生成 `deploy/` 目录（`index.html`、`healthz.json`、
  `api-meta.json`、`_headers`、`_redirects`），可直接用于 Cloudflare Pages / Netlify /
  GitHub Pages 等静态托管平台。
- **`npm run probe:prod`**：公网健康检查采样脚本，多轮统计 200 比例与耗时分布，
  用于线上验收留痕（`ROUNDS` 环境变量可调采样次数）。
- `scripts/healthcheck.mjs` 增加 `/status` 端点校验，并对入口页校验 ETag 与压缩协商。

### 验证

| 项目 | 结果 |
|---|---|
| 构建 | ✅ 463.9 KB / 词库 4540 条 |
| 测试 | ✅ 30/30 通过 |
| 覆盖率 | ✅ 行 100%、分支 81.3% |
| 文档示例 | ✅ 26/26 通过 |
| 健康检查（本地） | ✅ 200 · 8–12 ms |
| 健康检查（公网） | ✅ 200 · 10/10 采样达标，中位 430 ms，最慢 1080 ms（阈值 2000 ms） |
| 元信息接口（公网） | ✅ 200 · 10/10 达标，中位 426 ms |
| 状态页（公网） | ✅ 200 · 10/10 达标，中位 459 ms |
| 入口页（公网，br） | ✅ 200 · 10/10 达标，中位 1098 ms，144 KB 传输 |
| 公网合计采样 | ✅ 40/40 返回 200 且低于阈值 |

---

## [1.0.2] - 2026-09-30

线上部署与文档补全版。补齐公网可访问环境与部署说明。

### 新增

- `docs/部署说明.md`：三种部署方式（本地服务 / Cloudflare 隧道 / 静态托管）、
  实测数据、已知限制与常见问题
- `README.md` 新增「线上环境」章节：公网地址、实测响应时间、稳定性说明、
  静态托管命令表
- 服务端 gzip 压缩：对 >1KB 的文本响应自动压缩，页面从 464 KB 压到 142 KB（31%）
- 压缩结果进程内缓存 + 启动预热，消除重复压缩开销、降低首次请求延迟

### 验证

| 项 | 结果 |
|---|---|
| 构建 | ✅ 463.9 KB / 词库 4540 条 |
| 测试 | ✅ 30/30 通过，行覆盖 100% |
| 文档示例 | ✅ 26/26 通过 |
| 健康检查（本地） | ✅ 200 · 8ms |
| 健康检查（公网） | ✅ 200 · 稳定态 422–874ms |
| 应用页面（公网） | ✅ 200 · 约 1.0s |

### 说明

- 公网地址基于免账号 Cloudflare 隧道，回源本机，Cloudflare 不保证可用性；
  长时间空闲后首次请求可能达 2s 左右（建连开销，非接口性能）。
  长期生产建议部署至静态托管，见 `docs/部署说明.md`。

---

## [1.0.1] - 2026-09-30

文档质量加固版。让「文档中的示例可被直接复制执行」从人工承诺变为自动化验证。

### 新增

- `scripts/verify-docs.js`：逐条执行 `docs/API.md` 中的 26 条示例并比对输出，
  任一条与文档所述不符则列出差异并以非零码退出
- `package.json` 新增 `test:docs` 命令，并纳入 `npm run verify` 流水线：
  构建 → 测试 → 文档核验 → 健康检查

### 变更

- `docs/使用文档.md`：修正 `npm run build` 的输出示例，补齐实际存在的
  6 项结构校验（斗法场面板、学情看板面板、形近辨析、拼写默写、对战结算、健康检查钩子）
- `docs/产品方案.md`：性能指标与验收口径更新为实测值，新增"文档示例可执行 26/26"一行
- `README.md`：补充完整命令表，新增"文档可执行"技术特性说明
- `git` 提交身份配置为仓库级（沿用既有提交者 CloseCode）

### 验证

| 项 | 结果 |
|---|---|
| 构建 | ✅ 463.9 KB / 词库 4540 条 |
| 测试 | ✅ 30/30 通过，行覆盖 100% |
| 文档示例 | ✅ 26/26 通过 |
| 健康检查 | ✅ /healthz 200 · 9ms |

---

## [1.0.0] - 2026-09-30

首个稳定版本。从「单文件答题页」升级为具备工程交付能力的商业级项目。

### 新增

#### 斗法场（对战模式）
- 回合制对战：每局 5 回合，答对伤敌 24 点，答错自损 18 点
- 15 秒回合倒计时，最后 5 秒红色预警并脉冲闪烁，超时判为答错
- 连击计数、实时命中率统计
- 血条缓动动画、掉血飘字、受击抖动反馈
- 对战胜出奖励 30 灵石 + 20 灵气；结束后可「再战一场」

#### 六种记忆题型
- **中译英**：中文释义 → 选英文
- **英译中**：英文单词 → 选中文释义
- **形近辨析**：干扰项取同前缀/同长度词，专治拼写混淆
- **听音辨词**：浏览器语音合成朗读后选词
- **拼写默写**：首字母 + 下划线占位，手动输入后回车核对
- **词性判断**：判断名词/动词/形容词等词性
- 题型轮换与锁定专练（下拉切换）；拼写题支持近似判定（差一个字母给提示）

#### 学情看板
- 四个数据格：累计答题、正确率、已斩获、心魔词
- 掌握度环形图（SVG，实时反映 4540 词覆盖比例）
- 近 7 日学习曲线（折线 + 面积填充 + 数据点）
- 六种题型正确率对比条，定位薄弱环节

#### 工程化
- 核心逻辑抽取为 `src/core/utils.js` 与 `src/core/quiz.js`，与 DOM 解耦
- 构建脚本 `scripts/build.mjs`：完整性校验 → 注入版本信息 → 输出 dist 产物
- HTTP 服务 `server.mjs`：静态托管 + `/healthz` 健康检查 + `/api/meta` 元信息
- 健康检查脚本 `scripts/healthcheck.mjs`，校验状态码与响应时间（阈值 2s）
- 自动化测试 30 个用例（`node:test`），核心逻辑行覆盖率 100%、分支 81.3%
- 文档核验脚本 `scripts/verify-docs.js`：逐条执行 API 文档中的 26 条示例并比对输出，`npm run test:docs` 可复现

#### 文档
- `docs/产品方案.md`：用户画像、功能列表、技术架构、里程碑排期
- `docs/使用文档.md`：三种使用方式、功能上手、常见问题、快捷键
- `docs/API.md`：HTTP 接口与核心模块 API，26 条示例全部经真实执行验证
- `docs/architecture.png`：系统架构图

### 变更
- 背单词入口由单一「中英互译选择题」改为六种题型轮换
- 词谱页新增掌握度筛选（全部 / 未学过 / 已斩获 / 心魔词）
- 试炼殿新增背词题型选择下拉框

### 修复
- 修复对战结束后「开始斗法」按钮不再出现、无法再来一局的问题
- 修复实现过程中 `countEssay` 函数被误覆盖导致写作题字数统计失效的问题
- 学情看板渲染包裹 try/catch，旧存档缺字段时静默降级，不再影响主流程

### 性能
- 构建产物 463.9 KB 单文件，零外部依赖，可离线双击打开
- 健康检查响应 12ms（阈值 2000ms）
- 测试套件执行 87ms

---

## [0.9.0] - 2026-09-24

### 新增
- 六套 CET-4 模拟卷（写作/听力/阅读/翻译，125 分钟 57 题，710 分制折算）
- 4540 条 CET-4 词库内嵌（含音标、词性、释义）
- 词汇摸底（10 题估算词汇量并生成每日目标）
- 游戏化体系：境界（炼气→地仙）、灵气、灵石商店、每日任务、成就
- 心魔本（错词归集）+ 艾宾浩斯间隔重复
- 口语小径（本地录音回放，不上传）
- localStorage 存档 + 导出/导入 JSON

---

## 版本说明

| 版本 | 日期 | 状态 | 说明 |
|---|---|---|---|
| 1.0.1 | 2026-09-30 | **稳定** | 文档示例可执行核验，文档输出对齐实测 |
| 1.0.0 | 2026-09-30 | 稳定 | 首个正式版，具备完整工程交付能力 |
| 0.9.0 | 2026-09-24 | 内部 | 功能原型 |

### 版本号约定

- **主版本号**：不兼容的 API 变更或架构重构
- **次版本号**：向下兼容的功能新增
- **修订号**：向下兼容的问题修复
