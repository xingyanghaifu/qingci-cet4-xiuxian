# 青词天路 · 四级全卷修仙

> 把枯燥的 CET-4 背词，做成有进度感、有对抗、有反馈的修仙历程。

[![version](https://img.shields.io/badge/version-1.9.0-0e6b53)](CHANGELOG.md)
[![tests](https://img.shields.io/badge/tests-448%20passing-176b3f)](tests/)
[![coverage](https://img.shields.io/badge/coverage-100%25%20lines%20(core)-176b3f)](tests/)
[![runtime deps](https://img.shields.io/badge/runtime%20deps-0-a56d22)](#技术特色)
[![pwa](https://img.shields.io/badge/PWA-installable%20%2B%20offline-0e6b53)](#pwa-安装到桌面与离线可用)
[![license](https://img.shields.io/badge/license-MIT-8b7360)](LICENSE)

---

## 这是什么

一个**单文件自包含**的多考试背词应用：**初中 / 高中 / CET-4 / CET-6 四词库**、
五类备考模式（初中 / 高中 / PETS-3 / CET-4 / CET-6）、六种记忆题型、模拟卷、回合制对战、
学情看板。源码为 **TypeScript**，构建后是一个约 913 KB 的 HTML 文件，
**运行时零依赖，断网可用**，可安装到桌面当 App 用。

> **v1.8.2 起支持多词库，v1.9.0 起覆盖中学词库。** 默认仍是 CET-4，
> **不切换词库的既有用户行为与数据一字不变**；切换词库后，背词进度、心魔录、
> 灵石与对战记录按词库各自独立互不干扰。

## 快速开始

```bash
# 方式一：直接用浏览器打开（最简单）
#   双击 cet4-xiuxian.html 即可

# 方式二：本地服务
npm start                 # 访问 http://127.0.0.1:4173

# 方式三：从源码构建
npm install               # 安装构建期依赖（esbuild + typescript）
npm run typecheck         # TypeScript 类型门禁（tsc --noEmit）
npm run build             # esbuild 打包 src/ → 单文件 dist/ + PWA 资源（manifest/sw/图标）
npm run verify:pwa        # 校验 PWA 产物一致性（图标尺寸、sw 预缓存清单、页面引用）
npm test                  # 运行 190 个自动化测试
npm run test:coverage     # 测试 + 覆盖率报告
npm run test:docs         # 核验 API 文档中的 26 条示例可执行且输出一致
npm start                 # 启动本地服务（http://127.0.0.1:4173）
npm run healthcheck       # 健康检查（校验状态码与响应时间）
npm run verify            # 一键：类型检查 + 构建 + 测试 + 文档核验 + 健康检查
```

## 核心功能

| 模块 | 内容 |
|---|---|
| **背单词** | 六种记忆题型轮换：中译英 / 英译中 / 形近辨析 / 听音辨词 / 拼写默写 / 词性判断 |
| **单词详情** | 词性释义（中英）/ 例句（带出处徽标）/ 搭配短语 / 同义反义 / 词根词缀与词源 / 易混词 / 助记与用法场景；本地分片离线可用，缺失时联网 Free Dictionary API 并缓存 |
| **多考试备考** | 初中 / 高中 / PETS-3 / CET-4 / CET-6 五类模式：题量、时长、总分、及格线按考试类型配置；整套作答达线才记一次境界突破 |
| **试炼殿** | 六套 CET-4 模拟卷（125 分钟 57 题），710 分制折算；难度按考试等级与境界动态取 1–5 |
| **斗法场** | 回合制对战：血条、15 秒倒计时、连击、命中率 |
| **学情看板** | 掌握度环形图、近 7 日曲线、六题型正确率对比 |
| **心魔本** | 错词归集 + 艾宾浩斯间隔重复（0.25/1/3/7 天） |
| **游戏化** | 境界（炼气→地仙）、灵气、灵石商店、每日任务、成就 |

## 词库列表（v1.9.0）

在「洞府 → 词库」卡片上切换；**默认恒为 CET-4**，新词库不抢默认位。
每个词库的进度、错题本与复习队列按词库独立保存，互不干扰。

| 词库 | 短名 | 词数 | 考试题库 | 状态 |
|---|---|---|---|---|
| 初中词汇（中考） | 初中 | 2028（课标核心 1603 + 拓展） | 语法选择 / 完形 / 阅读 / 选词填空 / 书面表达，3 套中考模拟卷 | v1.9.0 上线 |
| 高中词汇（高考） | 高中 | 3770（核心 3677，3040 词标 `inCET4`） | 阅读 / 七选五 / 完形 / 语法填空 / 应用文 / 读后续写，3 套高考模拟卷 | v1.9.0 上线 |
| 大学英语四级 | CET-4 | 4540 | 六套 125 分钟全真结构模拟 | **默认** |
| 大学英语六级 | CET-6 | 5716 | 原创训练题 | v1.8.2 上线 |
| 考研 / IELTS / TOEFL | — | — | — | 灰显（`aria-disabled`，切换被拒绝） |

- 词库数据一律**分片按需加载**（`lexicons/<id>/…`），不内联进单文件 HTML；
- 详情分片与词源分片同目录组织，运行时按最长前缀匹配取词；
- 中学词库与 CET-4 的重叠词带 `inCET4` 标记，便于 UI 提示「四级已学」。

## 界面导航与视觉（v1.8：悬浮菜单 + 纯数据侧栏）

**导航与数据职责分离**：导航全部迁入「悬浮菜单」（汉堡按钮 + 浮动面板/抽屉），侧边栏只做数据展示，不再承担跳转——「选中态不明显」问题从根上消除。

| 断点 | 结构 |
|---|---|
| 桌面 ≥1025px | **悬浮菜单**：品牌右侧汉堡按钮（40×40 细线方钮）→ 展开 360px 浮动面板（`--bg-elevated` 墨色卡片、金砂 hover），上部 **4×2 图标+文字导航网格**（8 入口），细线下方为题型速捷（3 列）。**纯数据侧栏 280px**：品牌+汉堡+境界卡（顶部固定）→ 今日功课 / 今日数据 / 学情看板 / 趋势图（数据区独立滚动）→ 设置·主题·音频来源页脚（吸底）。主区不变 |
| 平板 768–1024px | 侧栏**整体隐藏**（已无导航职能）；顶部条右端「数据面板」按钮滑出 **280px 左侧数据抽屉**（Esc / 收起按钮关闭，焦点往返）；菜单仍为浮动面板 |
| 手机 <768px | **顶部状态条吸顶**：左汉堡（44×44）+ 青标、中间「境界名 + 迷你修为条」、右端「功课 x/20 ▾」chip（点开数据抽屉）；导航 = 汉堡呼出**全屏左侧抽屉**（85vw，单列图标+文字，半透明遮罩点击关闭） |

- **悬浮菜单（键盘与无障碍）**：`role="dialog" aria-modal` + 隐藏 `<h2>` 标题；开合同步汉堡 `aria-expanded`；打开焦点入首项、**Tab/Shift+Tab 焦点循环**、Esc 关闭焦点回汉堡、点击导航项→关菜单→切面板→焦点落 `h1#mainTitle`；快捷键 **`Ctrl/Cmd+K`** 开合（输入态不抢占）；关闭态 `visibility:hidden`（不可聚焦、不进读屏树）。
- **兼容机制**：菜单内 8 按钮与原 DOM 完全一致（`role=tab`/`aria-selected`/`data-*` 原样），既有 `switchTab(name, srcBtn)` 处理器原位生效——背单词/单题消歧、`:has()` 主区标题切换零改动；侧栏导航的金砂竖线等选中态样式已整体删除（菜单内仅保留中性描边）。
- **水墨微光主题**：暗色为默认（墨青 `#0d1117` 底、金砂 `#d4a853` / 青绿 / 朱砂点缀、1px 细边框、卡片顶部径向灵光、等宽数字）；浅色为暖白底 + 深墨字，点缀色同族；动效 150–300ms `cubic-bezier(.4,0,.2,1)`，全面尊重 `prefers-reduced-motion` 与高对比度、字号档位等既有无障碍能力。
- **主题三档**：侧栏页脚「主题」按钮循环 深色 → 浅色 → 跟随系统；**v1.6 起无存储时默认深色**（行为变更见 CHANGELOG）。
- **单词详情页**：背单词题面「详解」按钮（键盘可达）或词谱列表点击单词 → 详情弹层，七段式：词性释义（中英分组）→ 例句（带出处徽标）→ 搭配与短语 → 同义/反义 → 词根词缀与词源 → 易混词 → 记忆辅助与用法场景；顶部可发音（SpeechSynthesis，英式优先）。数据本地分片离线可用；本地无数据时联网 Free Dictionary API 并写入 IndexedDB 缓存；再失败则提示「离线模式下暂无详情」并展示词库内置释义兜底。

## 技术特色


- **运行时零依赖**：产出的单文件不加载任何 CDN、不 import 任何包，断网可用；
  构建期使用 `esbuild`（打包）与 `typescript`（类型检查）两个 devDependency
- **确定性随机**：同一套卷子每次题序一致，便于重做对比
- **TypeScript 源码**：`src/**/*.ts` 与 `functions/**/*.ts` 由 `tsc --noEmit` 把关，
  esbuild 打包后内联进单文件，部署产物形态与旧版一致
- **纯函数核心**：`src/core/` 与 DOM 解耦，可被 Node 测试直接覆盖
- **可测试**：190 个用例；`src/core`、`functions/`、`worker/` 行覆盖率 100%
  （统计含测试脚本时整体行覆盖 99.73%、分支 87.88%、函数 96.99%；TypeScript 模块经
  esbuild 打包后执行，由 21 条行为用例覆盖，暂未计入行覆盖率）
- **PWA 可安装 + 离线可用**：manifest + Service Worker + maskable 图标由构建产出，
  外壳预缓存、词库与试卷落 IndexedDB，断网也能继续刷题
- **文档可执行**：`npm run test:docs` 逐条执行 API 文档中的 26 条示例并比对输出，防止文档与代码脱节
- **容错降级**：旧存档缺字段时静默跳过，不连累主流程

## 项目结构

```text
├── src/
│   ├── core/utils.js          纯工具：哈希/随机/间隔重复/境界/五类考试配置（待迁 TS）
│   ├── core/quiz.js           业务核心：题型生成、判分、统计（待迁 TS）
│   ├── config/features.ts     前端 Feature Flag（AI 批改等开关，默认全关）
│   ├── config/app-version.ts  应用版本号（构建时注入）
│   ├── services/grading.ts    写作/翻译批改服务：开关关闭时不发任何请求
│   ├── services/pwa.ts        Service Worker 注册与更新提示
│   ├── services/idb.ts        IndexedDB 连接与 schema 升级（全应用共用，v2）
│   ├── services/offline-store.ts  IndexedDB 离线数据仓库（词库 / 试卷 / 题库）
│   ├── services/srs.ts        SM-2 间隔重复：调度 / 今日队列 / 预测
│   ├── services/index.ts      服务统一出口（构建时挂载全局 QingciServices）
│   ├── types/grading.ts       批改数据契约：状态 / 四维评分 / 批注 / 版本号
│   ├── types/mistakes.ts      错题模型：题型 / 熟练度 / 稳定 id / 汇总
│   ├── types/question-bank.ts 题库类型与组卷算法（筛选 + 加权随机 + 防重复）
│   ├── services/question-bank.ts  题库加载（IDB 缓存）/ 近期题目窗口 / 题目适配
│   ├── services/vocab-grades.ts   分级读取与查询（档位 / 优先级 / 来源标注）
│   ├── services/vocab-srs.ts      词汇 SM-2 队列（IDB vocab 仓库 + 旧档迁移）
│   ├── services/vocab-enrich.ts   单词增强：词缀 / 易混词 / 搭配框架
│   ├── services/vocab-detail.ts   单词详情：分片加载 / IDB 缓存 / Free Dictionary 回退 / TTS 发音
│   ├── services/vocab-question.ts 由单词生成复习题（id 与题库一致）
│   ├── services/study-plan.ts     动态学习计划（每日量 / 题型配比 / 热力图）
│   ├── types/report.ts           报告契约：作答流水 / 薄弱点（Wilson 下界）/ 趋势
│   ├── services/report-store.ts  作答流水与模考报告仓库（IDB attempts / reports）
│   ├── services/charts.ts        手写 SVG 图表（条形 / 折线 / 环形 / 热力）
│   ├── services/recommend.ts     薄弱点 → 组卷参数 → 推荐练习
│   ├── services/assessment.ts    自适应词汇量测试（阶梯难度 + 分档加权估计）
│   ├── services/plan-settings.ts 学习计划设置（考试日期 / 每日时长）持久化
│   ├── types/audio.ts            精听元数据：逐句时间戳 / 切句 / 听写比对
│   ├── services/audio-provider.ts 音频提供方（TTS 占位 + 真实音频）与精听播放器
│   ├── services/feedback.ts      反馈提交（校验 / 离线队列 / 自动重试）
│   ├── types/realm.ts            学业境界：五档阈值 / 双条件晋级 / 突破检测
│   ├── types/titles.ts           成就称号：门槛定义与解锁判定
│   ├── services/gamification.ts  境界与称号的状态持久化与本次变化
│   ├── services/group.ts         道友小组客户端（隐私安全负载 / 降级）
│   ├── services/a11y.ts          无障碍偏好（字号 / 对比度 / 动效）+ 快捷键文案
├── db/schema.sql                    反馈库 D1 建表脚本
├── scripts/build-changelog.mjs      CHANGELOG.md → 静态更新日志页
│   ├── services/mistake-store.ts  错题仓库（IndexedDB CRUD + 复习日志）
│   ├── services/migrate.ts    旧存档（v3/v4 心魔本）到错题本的一次性迁移
│   ├── entry/services.ts      esbuild 入口（IIFE，内联进单文件）
│   ├── sw.template.js         Service Worker 模板（构建注入缓存版本）
│   └── index.template.html    应用外壳：DOM 渲染与交互
├── functions/                 Cloudflare Pages Functions（ESM/TS）
│   ├── healthz.js · status.js · api/meta.js
│   └── api/grade.ts           AI 批改占位端点（不调用外部 API）
├── tests/                     自动化测试（node:test：核心 + Worker + Functions + 批改 + 离线）
│   └── helpers/load-ts.mjs    用 esbuild 把 TS 模块打包后再 import
├── scripts/build.mjs          构建：校验 → esbuild 打包 → 内联 → 输出 dist + PWA 资源
├── scripts/make-icons.mjs     零依赖生成 PWA PNG 图标（自写 PNG 编码）
├── scripts/verify-pwa.mjs     PWA 产物一致性校验（图标尺寸 / sw 预缓存清单 / 页面引用）
├── scripts/build-question-bank.mjs  固化题库生成（复用应用生成器，确定性输出）
├── scripts/build-vocab-grades.mjs   词汇分级生成（启发式 / 可换真实词频表）
├── scripts/build-vocab-detail.mjs   词典详情分片生成（4540 白名单 · 三源回退 · >1.5MB 自动拆分并断言）
├── src/data/vocab-grades.json       四档分级数据（构建时内联）
├── src/data/vocab-detail/           词典详情分片（manifest + 按首字母分片，构建时拷入 dist/vocab-detail/）
├── scripts/prepare-deploy.mjs 生成部署目录（deploy/ 或 deploy-pages/ + _routes.json）
├── scripts/healthcheck.mjs    健康检查（校验状态码与响应时间）
├── worker/index.mjs           Cloudflare Workers 入口（同构接口）
├── server.mjs                 本地 HTTP 服务 + /healthz + /status + /api/meta + PWA 资源
├── docs/                      产品方案 / 使用文档 / API 文档 / 架构图
├── CHANGELOG.md               版本发布记录
└── dist/                      构建产物（单文件 HTML + manifest + sw.js + icons/）
```

## 接口

| 端点 | 说明 | 本地 | Pages | Workers |
|---|---|---|---|---|
| `GET /healthz` | 健康检查，返回状态、版本、词库条数、运行时长 | ✅ | ✅ | ✅ |
| `GET /status` | 人类可读状态页（纯内联样式，无外部资源） | ✅ | ✅ | ✅ |
| `GET /api/meta` | 应用元信息（版本、题型、五类备考、题源边界） | ✅ | ✅ | ✅ |
| `POST /api/grade` | 写作/翻译 AI 批改——**占位实现**：返回 `not_implemented`，不调用外部服务 | — | ✅ | — |
| `GET /` | 应用页面 | ✅ | ✅ | ✅ |

健康检查响应示例：

```json
{
  "status": "ok",
  "version": "1.0.6",
  "checks": { "lexicon": { "ok": true, "count": 4540, "expected": 4540 } }
}
```

## 线上环境

应用已部署，公网可访问（Cloudflare Pages 边缘托管，固定域名）：

| 地址 | 说明 |
|---|---|
| `https://qingci-cet4-xiuxian.pages.dev/` | 应用页面 |
| `https://qingci-cet4-xiuxian.pages.dev/healthz` | 健康检查（JSON，动态） |
| `https://qingci-cet4-xiuxian.pages.dev/status` | 状态页（HTML，动态） |
| `https://qingci-cet4-xiuxian.pages.dev/api/meta` | 元信息（JSON，含五类备考与题源说明） |

实测结果（2026-10-03 部署 v1.5.0 后，每路径 10 次采样 × 2 轮，`npm run probe:prod`）：

```text
路径        中位      最快      最慢      阈值内    超 2 秒
/healthz    235ms    208ms     773ms    10/10     0    ✅
/api/meta   255ms    204ms     1079ms   10/10     0    ✅
/status     323ms    193ms     722ms    10/10     0    ✅
/          399ms    324ms     658ms    10/10     0    ✅
```

> **两轮合计 80/80 采样全部返回 HTTP 200 且低于 2000ms 阈值。**
> `/status` 上版曾因缺少 Function 走 SPA 回退，实际传输 469 KB 入口页导致偶发超时；
> v1.5.0 补上 `functions/status.js` 后该路径只返回 1.2 KB 状态页，中位 323ms。

`/healthz` 返回的真实响应（2026-10-03 部署 v1.5.0 后实测）：

```json
{
  "status": "ok",
  "version": "1.3.1",
  "platform": "cloudflare-pages",
  "checks": {
    "lexicon": { "ok": true, "count": 4540, "expected": 4540 },
    "staticAsset": { "ok": true, "artifact": "index.html" }
  },
  "runtime": { "colo": "SEA", "country": "CN" },
  "latencyMs": 8,
  "timestamp": "2026-10-03T00:03:18.823Z"
}
```

### 双通道部署说明

本项目同时提供两种线上通道：

| 通道 | 地址 | 国内直连 | 特点 |
|---|---|---|---|
| **Cloudflare Pages** | `https://qingci-cet4-xiuxian.pages.dev` | ✅ 实测可达 | **当前验收入口**，已部署 v1.5.0（五类备考 + 状态页），动静接口齐全 |
| Cloudflare Workers | `https://qingci-cet4-xiuxian.bw8pbrkt56.workers.dev` | ❌ 被阻断 | 固定边缘部署，接口逻辑与 Pages 版同构，当前仍为 v1.2.0 构建 |

> **为什么以 Pages 地址作为验收入口**：`*.workers.dev` 域名在中国大陆网络下被整体阻断
> （实测 DNS 解析到 Dropbox 的 IP `162.125.80.6`，属 DNS 污染，TCP 无法连通），
> 而 `*.pages.dev` 域名实测可正常直连。两者共用同一套构建产物与同构接口实现，
> 功能基本一致，因此以可达性更好的 Pages 地址作为线上验收入口。
> Workers 侧此前已完成部署，并通过 Cloudflare API 确认为生产环境运行
> （部署版本 `37396f96`、`workers.dev` 子域已启用、`APP_VERSION` 为 1.2.0）；
> 该通道**未随 v1.3.0 / v1.5.0 的 Pages 部署一起更新**。

> 复采命令：`npm run probe:prod`（每路径 10 次采样，阈值 2000ms）。

> **关于性能优化**：`/healthz` 与 `/api/meta` 的词库读取已加缓存，避免每次请求重读 469KB 文件；
> 入口页下发 ETag 协商缓存，重复访问命中 `304` 不再重复传输 469KB 正文；
> 本机服务与静态托管均启用 Brotli 压缩（实测本机预热：gzip 144 KB / br 128 KB，入口页原始 469 KB）。

## D1 配置（反馈 + 道友小组）

反馈收集与道友小组共用**同一个 D1 数据库**；未配置时两个接口返回 503，
前端分别降级为「本地队列自动重试」与「本机模式」，学习功能不受影响。

```bash
# 1) 建库（记下返回的 database_id）
npx wrangler d1 create qingci-feedback

# 2) 建表（feedback / study_groups / group_members 三表 + 索引）
npx wrangler d1 execute qingci-feedback --remote --file=db/schema.sql

# 3) 可选但建议：配置 IP 哈希盐（仅存密文）
npx wrangler pages secret put FEEDBACK_SALT
```

绑定 `DB` 的方式（二选一）：

- **本项目默认**：`wrangler.toml` 与 `scripts/deploy-pages.mjs` 里都写好了
  `[[d1_databases]] binding = "DB"`，`npm run deploy:pages` 会自动带上绑定；
- **控制台方式**：Cloudflare Dashboard → Pages → 项目 → Settings → Functions →
  D1 database bindings，变量名填 `DB`。

当前线上库：`qingci-feedback`（ID `a4eff653-dcfd-4874-a0ff-e30f5e92a611`，区域 WNAM）。

### 接口与隐私约束

| 接口 | 说明 |
|---|---|
| `POST /api/feedback` | 反馈落库；限流同 IP 哈希每小时 5 条；honeypot 命中返回 202 但不入库；不保存原始 IP |
| `POST /api/group` | `action` = `create` / `join` / `sync` / `board` / `leave`；只同步境界档位、粗粒度进度与学习天数 |

- **昵称校验（服务端强制）**：含 `@`、6 位以上连续数字、纯数字或网址一律拒绝；
- **不存分数、不存逐题数据**：进度入库前分档为 5 的倍数，无法反推分数；
- **榜单只回** `nickname / realmName / progress / studyDays / isMe`，不含他人 `memberId`。

### 无障碍与个性化使用说明

「洞府 → 无障碍与阅读偏好」与「洞府 → 外观」提供三轴独立设置：

| 设置 | 档位 | 作用范围 |
|---|---|---|
| 主题 | 跟随系统 / 浅色 / 深色 | 全局配色（首次跟随系统，切换后记住选择） |
| 字号 | 标准 / 大 115% / 特大 130% / 超大 150% | 只放大题干、选项、解析与听力原文 |
| 对比度 | 标准 / 高对比度 | 纯黑纯白 + 2px 加粗边框，弱视友好 |
| 动效 | 跟随系统 / 减少动态效果 | 关闭突破动画与过渡 |

键盘快捷键（按 `?` 可随时展开）：

| 按键 | 作用 |
|---|---|
| `1` – `4` | 选择第 1–4 个选项 |
| `→` / `↓` | 下一题 |
| `←` / `↑` | 上一题 |
| `Enter` | 推进：优先「下一题」，否则提交写作 / 拼写 |
| `空格` | 播放 / 暂停听力 |
| `R` | 重播听力 |
| `Esc` | 关闭最上层弹窗 |
| `?` | 显示 / 隐藏快捷键表 |

屏幕阅读器：换题自动朗读题干（`aria-live`），正确/错误选项带 `✓`/`✗` 与文字说明，
弹窗均为 `role="dialog"` 可用 `Esc` 关闭，焦点始终可见。
## 部署与访问

| 项目 | 说明 |
|---|---|
| **线上正本** | `https://qingci-cet4-xiuxian.pages.dev` |
| 托管方式 | Cloudflare Pages：静态资源 + Functions，全部由边缘节点直接应答，不回源任何个人电脑 |
| 电脑关机后 | ✅ 照常访问。线上不依赖本机进程，也不需要保活进程；关机、休眠、断网都不影响 |
| 本地预览 | `npm start` → `http://127.0.0.1:4173`（**仅本机可访问**，关掉服务或关机即失效） |
| 重新部署 | `npm run deploy:pages`（**需要开机并联网**；改完代码或词库后执行，线上才会更新） |

> **源码为 TypeScript，构建后为单文件 HTML，部署产物形态不变**：
> `src/**/*.ts` 经 esbuild 打包成一段内联脚本注入 `src/index.template.html`，
> 产出的 `dist/cet4-xiuxian.html` 依旧是零运行时依赖、双击可开的单文件。

> 旧 Cloudflare 快速隧道方案已弃用（地址每次重启都会变化，且回源到本机），
> 对应的保活 / 守护脚本不再需要，本文档已移除相关说明。

> **学习进度与托管方式无关**：进度保存在你当前浏览器的 localStorage 里，
> 既不在服务器上、也不在本机文件里，所以关电脑、重新部署都不会动到它。
> 但清理浏览器缓存或换设备会丢失——请在「洞府」页导出 JSON 备份，详见下方「数据与隐私」。

### 部署到静态托管（推荐用于生产）

应用是单文件静态资源，可直接托管到任意静态平台：

```bash
npm run build            # 产出 dist/cet4-xiuxian.html
npm run prepare:deploy   # 产出 deploy/ 目录（含 index.html、healthz.json、_headers、_redirects）
```

`deploy/` 目录可直接拖拽或推送到托管平台，`_headers` 已声明缓存与安全响应头，
`_redirects` 提供 SPA 回退，`healthz.json` 作为静态健康检查文件。

| 平台 | 命令/方式 | 说明 |
|---|---|---|
| Cloudflare Pages | `npx wrangler pages deploy deploy` | 需 Cloudflare 账号 |
| GitHub Pages | 推送 `deploy/` 内容后开启 Pages | 需 GitHub 账号 |
| Netlify | `npx netlify deploy --dir=deploy --prod` | 需 Netlify 账号 |
| Vercel | `npx vercel --prod deploy` | 需 Vercel 账号 |

## PWA：安装到桌面与离线可用

线上（`https://qingci-cet4-xiuxian.pages.dev`）已支持安装为独立应用：

| 能力 | 实现 | 说明 |
|---|---|---|
| 安装到桌面 / 主屏 | `manifest.webmanifest`（192/512 PNG + maskable 变体） | Chrome / Edge 地址栏出现「安装」；iOS 用「添加到主屏幕」 |
| 离线可用 | `sw.js` 预缓存应用外壳（页面、manifest、图标、静态检查 JSON） | 断网后仍能打开应用继续刷题 |
| 数据秒开 | 词库 4540 条与六套试卷的解析结果落 IndexedDB（`src/services/offline-store.ts`） | 版本变化时才重写，避免每次启动写 ~300KB |
| 动态接口不缓存 | `/healthz`、`/status`、`/api/*` 一律 network-only | 避免把「接口 200」伪装成离线可用 |
| 更新提示 | 发现新 Service Worker 时页面底部出现「新版本已就绪，点击刷新」 | 避免长期停留在旧外壳上 |
| 听力音频（预留） | `/audio/*` 走 cache-first | 当前听力用浏览器语音合成，该分支为后续真实音频预留 |

> **双击打开（`file://`）时**：Service Worker 与 manifest 需要 http(s) 环境，
> 此时自动跳过注册，不报错、不影响任何功能——单文件依旧完全离线可用。

构建产物（`dist/`）：`index.html` + `cet4-xiuxian.html`（同一份内容）、
`manifest.webmanifest`、`sw.js`、`icons/`（4 个 PNG）。
`npm run verify:pwa` 会校验图标尺寸、sw 预缓存清单与页面引用三者是否一致。

## 移动端与键盘

| 场景 | 行为 |
|---|---|
| 响应式断点 | 手机 `<768px`、平板 `768–1024px`、桌面 `>1024px` 三档 |
| 手机做题 | 选项改为全宽卡片、点击区 ≥44px；桌面端选项两列排布 |
| 听力播放条 | 手机端固定在屏幕底部（含 `safe-area-inset` 适配），滚动时不消失 |
| 模考计时器 | 手机端随题目区吸顶，滚动时始终可见 |
| 手动主题 | 「洞府 → 外观」可选 跟随系统 / 浅色 / 深色；首屏内联脚本先行应用，避免闪色 |
| 键盘操作 | `1–4` 选择选项、`←/↑` 只读回看上一题、`→/↓` 下一题、`Enter` 提交推进、`空格` 播放/暂停听力（输入框内自动失效） |
| 导航菜单 | **`Ctrl/Cmd+K`** 打开/关闭悬浮导航菜单（输入态不抢占）；打开后 `Tab` 焦点在菜单内循环、`Esc` 关闭并把焦点还给汉堡按钮 |
| 后台播放 | 听力接入 Media Session：锁屏 / 通知栏 / 蓝牙耳机可播放、暂停、停止 |

## 无障碍与个性化（P2.12）

### 三条互相独立的偏好轴

| 轴 | 档位 | 落地方式 |
|---|---|---|
| 主题 | 跟随系统 / 浅色 / 深色 | `<html data-theme>`；跟随系统时移除属性交给 `prefers-color-scheme` |
| 字号 | 标准 · 大（115%）· 特大（130%）· 超大（150%） | `<html data-font>` + CSS 变量 `--q-scale`，只作用于题干/选项/解析/原文 |
| 对比度 | 标准 / 高对比度 | `<html data-contrast="high">` 覆盖主题变量为纯黑纯白并加粗边框 |
| 动效 | 跟随系统 / 减少动态效果 | `<html data-motion="reduced">` + `prefers-reduced-motion` 媒体查询 |

- 偏好存 `localStorage`（`qingci.a11y` / `qingci.theme`），读取时规范化，脏数据回落默认；
- 首屏 `<head>` 内有一段**防闪烁**脚本，先于样式应用偏好，避免字号/对比度跳变；
- 三轴完全正交：调字号不会改动对比度，改对比度不会重置字号（有测试断言）。

### 键盘快捷键（完整列表）

| 按键 | 作用 |
|---|---|
| `1` – `4` | 选择第 1–4 个选项（未作答且按钮可用时） |
| `→` / `↓` | 下一题 |
| `←` / `↑` | 上一题 |
| `Enter` | 推进：优先「下一题」，否则提交写作 / 拼写 |
| `空格` | 播放 / 暂停听力 |
| `R` | 重播听力 |
| `Esc` | 关闭最上层弹窗（精听 / 反馈 / 突破） |
| `?` | 显示或隐藏快捷键表 |

- 焦点在 `input` / `textarea` / `select` / `contenteditable` 时，数字键与方向键**放行**（不抢输入）；
- 带 `Ctrl`/`Meta`/`Alt` 的组合键一律不拦截，系统与浏览器快捷键优先；
- `Esc` 与 `?` 是例外：即使焦点在输入框内也生效，避免用户被困在弹窗里；
- 快捷键文案与解析实现同源（`src/services/a11y.ts` 的 `SHORTCUT_HELP` ↔ `src/services/shortcuts.ts`），有测试防漂移。

### 色盲友好与屏幕阅读器

- 「正确 / 错误」不只靠颜色：正确选项带 `✓` 前缀、错误选项带 `✗`，并追加屏幕阅读器专用文本
  （「正确答案」/「你的选择，错误」）与 `aria-label`；
- 语义与 ARIA 规范：

  | 元素 | 规范 |
  |---|---|
  | 页面 | `<html lang="zh-CN">`、`<main id="main">`、跳过链接 `a.skip-link`（首个可聚焦元素） |
  | 题干 | `#prompt` 带 `aria-live="polite" aria-atomic="true"`，换题自动朗读，并把焦点移到题干 |
  | 选项组 | `#choices` 为 `role="group" aria-label="选项" aria-describedby="prompt"` |
  | 反馈区 | `#feedback` 带 `aria-live="polite"`；错误横幅 `#errBanner` 为 `role="alert"` |
  | 弹窗 | 精听 / 反馈 / 突破均为 `role="dialog" aria-modal="true"` + 可读 `aria-label`，`Esc` 关闭 |
  | 切换按钮 | 字号 / 高对比度 / 动效按钮使用 `aria-pressed` 表达开关状态 |
  | 播报通道 | 视觉隐藏的 `#srAnnouncer`（`.sr-only` + `role="status"`）用于过程性提示 |
  | 焦点可见 | 全局 `:focus-visible` 3px 描边，键盘用户任何时候都能看到焦点 |

- 所有无障碍增强都包在 `try/catch` 旁路中：任何一步失败都不影响答题。
## 修仙主题与学习目标绑定（P2.11）

### 学业境界（与「修为」区分开）

- 「**修为**」由灵气值驱动（原有系统，代表练得多）；「**境界**」绑定**学习目标**（代表学得扎实）。
  两者独立展示，避免把「练得多」误读成「学得好」。
- 五档阈值（**双条件同时达标**才晋级，只升不降）：

  | 境界 | 词汇量 | 模考总分 | 说明 |
  |---|---|---|---|
  | 练气 | ≥ 0 | ≥ 0 | 初窥门径 |
  | 筑基 | ≥ 1000 | ≥ 400 | 根基初成 |
  | 金丹 | ≥ 2000 | ≥ 500 | 丹成气固 |
  | 元婴 | ≥ 3000 | ≥ 600 | 神游物外 |
  | 化神 | ≥ 4000 | ≥ 700 | 通天彻地 |

- 界面显示双条件进度条、距下一境界的差距与**瓶颈在哪一项**（词汇还是分数）；
  突破时弹出动画（旋转灵环 + 境界名，系统开启「减少动态效果」时自动关闭动效）并记录突破历史。
- **只升不降**：某次模考失利不会掉级，避免挫败与刷分焦虑。

### 成就称号（自动解锁，门槛公开）

- 共 11 个称号，全部写明「样本量 + 正确率」双门槛，样本不足不发放（例如 1 题全对不会封神）：
  听力金丹（≥30 题 & ≥80%）、听力元婴（≥80 & ≥88%）、阅读元婴（≥30 & ≥85%）、
  阅读化神（≥100 & ≥92%）、翻译化神（≥12 & ≥90%）、写作化神（≥10 & ≥88%）、
  词汇筑基（≥50 & ≥75%）、词汇金丹（≥200 & ≥85%）、全卷化神（整套完成且 ≥700 分）、
  心有灵犀（SRS 熟练词 ≥500）、勤修不辍（**累计**学习 ≥30 天）。
- 洞府页展示已解锁称号（金色标记）与未解锁称号的进度文案；
  解锁瞬间弹出提示，且**同一条称号只通知一次**（持久化去重）。

### 道友小组（隐私优先）

- 创建一个道场（6 位邀请码，排除 0/O/1/I 等易混字符）或凭码加入，榜单支持**周 / 月**切换。
- **隐私由服务端强制**：
  - 只接受**昵称**——含 `@`、6 位以上连续数字、纯数字或网址的昵称一律拒绝（防真名/邮箱/手机号/学号）；
  - **不上传任何答题数据与分数**，只同步 境界档位 / 粗粒度进度 / 累计学习天数；
  - 进度**入库前分档**为 5 的倍数，无法反推具体分数；
  - 榜单只返回 昵称 / 境界名 / 进度档 / 学习天数 / 是否本人，**不含他人 memberId**；
  - 成员 ID 是客户端随机匿名 ID，与账号体系解耦。
- 未配置 D1 时接口返回 503，界面提示「本机模式」，不影响学习功能。

## 修炼生态（阶段 A–D）

四个阶段构成一条「修炼」主线：渡劫（阶段 A）→ 心魔（阶段 B）→ 灵田（阶段 C）→ 道友（阶段 D）。
全部落在既有页面内，**不新增导航项**：渡劫与心魔在答题链路旁路触发，灵田与道友在洞府页（卷面与洞府）。

| 阶段 | 内容 | 入口 |
| --- | --- | --- |
| A · 渡劫 | 境界突破判罚、突破史、护道符抵扣 | 答完题旁路判定 |
| B · 心魔 | 错题具象化为心魔、心魔劫（独立判罚）、奇遇事件 | 心魔本 |
| C · 灵田 | 9 格耕种、三种作物、灵泉润田、洞府装饰 | 洞府页 |
| D · 道友 | 论剑 / 传功 / 联手斩魔 / 道场建设 | 洞府页 |

### 阶段 D · 道友互动

在洞府页新增「道友互动」折叠块（与灵田、洞府装饰并列）：

- **论剑**：与道友切磋 10 题。判定为「正确数优先 → 同数比用时 → 全同平局」；
  胜者灵石 +50、平局各 +20、**败者不扣不奖**。
- **传功**：仅熟练度 ≥ 4 的词可外传，**每词全局只传一次**；传功者灵石 +30，
  接收方该词 7 日内复习收益 ×1.5。
- **联手斩魔**：双方心魔各取 5 只（不足按实际），合计正确率 ≥ 80% 即成；
  成功双方各 +80 灵石，失败双方心魔各降 1 级。
- **道场建设**：三设施（藏经阁 1000 / 炼丹房 1500 / 演武场 2000），捐献达标即激活，
  分别提供 词库详情解锁 +20% / 每月 1 张护道符 / 论剑胜率 +5%。

**默认是本机模式**（`D1_MULTIPLAYER_ENABLED = false`）：顶部提示「当前为本机模式，跨设备功能需要联网」，
论剑与联手斩魔由本机模拟道友应战（离线可玩），传功与道场建设照常本地生效。
开关关闭时**不发起任何跨用户请求**——这与本项目「local-first、不打扰、不制造攀比」的立场一致。

**隐私边界（R6）**：界面只显示昵称；跨用户端点只存匿名 `memberId` 与聚合值，
**从不存储题目内容、单题作答或分数**，也不向页面返回他人身份字段。

### 避免过度游戏化的设计原则（代码层面保证）

1. **不做惩罚**：境界只升不降；坚持类称号按累计天数，断签不清零；没有连续签到惩罚。
2. **不做付费/加速**：没有消耗、购买、跳级入口，所有门槛只能靠真实作答达成。
3. **不打断学习**：判定在作答/交卷后**旁路异步**执行，异常一律吞掉，只做提示。
4. **不制造攀比**：排行榜不显示分数、只显示境界与粗粒度进度；小组内可看学习天数，看不到答题数据。
## 反馈入口与更新日志（P1 任务 E）

### 反馈（前端 + Cloudflare Pages Function + D1）

| 环节 | 实现 |
|---|---|
| 入口 | 「洞府 → 反馈」按钮 → 覆盖层表单：类型（报错/建议/内容/其它）、描述（5–2000 字）、可选截图（≤512KB，PNG/JPEG/WebP）、可选联系方式 |
| 反垃圾 | 表单内隐藏 honeypot 字段（填了返回 202 但**不入库**）；同 IP 哈希每小时最多 5 条（查 D1，不需要 KV） |
| 隐私 | 只保存填写的文字、截图、页面位置、版本号与 UA；**IP 不落库**，只存加盐 SHA-256 前 16 位用于限流（盐来自 `FEEDBACK_SALT`，建议配置） |
| 离线兜底 | 网络失败或服务未配置（503）时内容留在本机队列（最多 10 条），打开页面 / 恢复网络自动重试 |
| 服务端 | `functions/api/feedback.ts`：POST 校验 → 限流 → 写 D1；GET 等其它方法 405，OPTIONS 204；未绑定 DB 时返回 503 与可读原因 |
| 建库 | `db/schema.sql`（`feedback` 表 + 时间/类型/IP 索引） |

```bash
npx wrangler d1 create qingci-feedback
npx wrangler d1 execute qingci-feedback --remote --file=db/schema.sql
# Pages 项目绑定：DB → qingci-feedback；可选加密盐：
npx wrangler pages secret put FEEDBACK_SALT
```

### 公开更新日志

- `scripts/build-changelog.mjs` 在构建期把 `CHANGELOG.md` 渲染成静态页 `dist/changelog.html`
  （17 个版本、51.8 KB、**无脚本、无外部资源**），随部署发布；
- 应用内「更新日志」按钮在新窗口打开该页；`changelog.html` 已加入 Service Worker 预缓存，**离线也能看**；
- 只实现 Markdown 的最小子集（标题/列表/粗体/行内代码/链接），链接协议白名单，其余一律转义。

## 听力精听（P1 任务 D）

> ⚠️ **真实音频素材尚未就位**：当前用浏览器语音合成（SpeechSynthesis）占位，
> 时间轴按字符数**估算**。交互（逐句复读 / 循环 / 变速 / 原文开关 / 听写）已全部跑通，
> 接入真实音频只需提供 `kind: 'file'` + `url` + 逐句时间戳，**UI 与逻辑无需改动**。

### audioMeta 时间戳结构（`src/types/audio.ts`）

```ts
interface AudioSegment { id: string; start: number; end: number; text: string; translation?: string; tags?: string[] }
interface AudioTrackMeta {
  kind: 'tts' | 'file';      // 占位 / 真实音频
  url?: string;              // kind='file' 时必填
  text?: string;             // kind='tts' 时的朗读文本
  lang: string; durationSec: number;
  segments: AudioSegment[];  // 逐句时间戳（秒，半开区间 [start, end)）
  timing: 'measured' | 'estimated';                    // 真实切分 / 按文本估算
  transcriptSource: 'original-material' | 'generated'; // 文本来源，不伪造材料
  available: boolean;
}
```

### 能力

| 能力 | 实现 |
|---|---|
| 逐句复读 | 点句子或「▶ 复读」；播放结束自动续播下一句 |
| 循环 | 关 / 单句 / A-B 三种模式；A、B 在当前句打点，A-B 内循环（按句界定，真实音频接入后按秒） |
| 变速不变调 | 0.5×–2×：TTS 走 `utterance.rate`；真实音频走 `playbackRate` + `preservesPitch` |
| 原文开关 | 一键隐藏/显示英文原文与中文参考 |
| 听写填空 | 隐藏原文逐句输入，回车比对：逐词贪心匹配，给出匹配率、漏写与多写清单 |
| 键盘操作 | ←/→ 上一句/下一句、空格播放暂停、Esc 关闭 |

### 分层设计

```
AudioProvider（怎么发声）    AudioHandle
  ├─ createTtsProvider        逐句朗读 + utterance end 回调（占位）
  └─ createElementProvider    <audio> + seek 到 start、到 end 暂停（真实音频）
IntensivePlayer（怎么练）   逐句 / 循环 / A-B / 变速 / 原文 / 听写状态机
```

> 提供方按 `pickProvider` 自动选择：有 `url` 用真实音频，否则用 TTS。
> 「已有 mp3、但暂无逐句时间戳」时不会退回 TTS：会保留 `kind: 'file'` 与 `url`，
> 时间轴暂标 `estimated`，切分音频后再标 `measured`。

## 动态学习计划（P1 任务 C）

| 能力 | 实现 |
|---|---|
| 自适应摸底 | `src/services/assessment.ts`：**阶梯式难度** 1–5（答对升、答错降），每个阶梯对应一个词库分档；题量最少 30、最多 50，达到 30 题后若最近 8 题正确率极端（≥87.5% 或 ≤12.5%）提前收敛 |
| 词汇量估计 | 分档加权：`Σ 各档词量 × 该档掌握率`，掌握率用 Laplace 平滑并向阶梯先验收缩；区间由各档 Wilson 下/上界加权得到；置信度按题量与分档覆盖判定 |
| 计划生成 | `src/services/study-plan.ts`：输入考试日期 / 已掌握量 / 每日可用时间 / 到期复习量 / 近期正确率 → 输出每日新词量、复习目标、题型配比、强度与是否可按期覆盖 |
| 动态调整 | 完成率 <60% 减量、>110% 加量；正确率偏低再降一档；模考得分率偏低提高听力/阅读配比 |
| 设置持久化 | `src/services/plan-settings.ts`：考试日期 / 每日可用分钟 / 目标词量存 localStorage，读取时规范化（脏数据回落默认、分钟数夹紧 10–240） |
| 可视化 | 词汇覆盖 / 今日新词 / 今日复习三条进度条 + 近 28 天学习热力图（复用任务 B 的手写 SVG 图表） |
| 联动 | 摸底结果写入 `state.assessment` 并据此设置每日目标；计划同时读取词汇 SRS 到期量与近 30 天作答正确率 |

> ⚠️ **诚实标注**：这是启发式自适应测试（阶梯难度 + 分档加权），输出是**估计值 + 区间**，
> 题目难度来自词库分档（P1-A 的启发式分级），**没有经过预试校准**；界面会同时展示区间与置信度。

## 模考报告与薄弱点分析（P1 任务 B）

| 能力 | 实现 |
|---|---|
| 作答流水 | 每答一题记录：题目 id、题型、部分、知识点标签、对错、耗时、时间（IndexedDB `attempts`，v4 schema 新增） |
| 模考报告 | 交卷时生成：总分/目标分对比、各题型得分率、作答进度、平均每题耗时（`reports` 仓库） |
| 薄弱点识别 | `detectWeaknesses`：按题型 / 部分 / 知识点三个维度聚合，用 **Wilson 95% 下界**排序并乘以样本量权重；样本 < 3 题标为「样本不足」，只提示不推荐 |
| 正确率趋势 | 近 7 日按本地日期聚合（避免 UTC 偏移导致日期错位） |
| 耗时分布 | 按部分统计平均耗时与占比 |
| 自适应推荐 | `recommendPractice`：取最弱项生成组卷参数（题型/标签/部分），复用 P0.3 题库的加权组卷，一键开始练习并自动避开近期做过的题 |
| 可视化 | `src/services/charts.ts`：**手写 SVG**（条形 / 折线 / 环形 / 热力网格），复用主题 CSS 变量，随深浅色自动切换；**不引入 Chart.js / ECharts** |

> **为什么不用 Chart.js / ECharts**：项目承诺「运行时零依赖 + 单文件交付」，且可视化增量预算 < 100 KB。
> ECharts 压缩后约 1 MB、Chart.js 约 200 KB，都会破坏该约束；手写 SVG 只需几 KB，
> 本次任务 B 全部新增（报告 + 图表 + 推荐 + 埋点）合计仅 **+22 KB**。
>
> 报告数据结构全部可序列化，与账号体系解耦，后续 P0.1 接入 Supabase 时可整表上传。

## 词汇分级与间隔复习（P1 任务 A）

4540 个词按基础度分四档，并接入与错题本**同引擎、不同队列**的 SM-2 调度。

| 能力 | 实现 |
|---|---|
| 分级数据 | `scripts/build-vocab-grades.mjs` → `src/data/vocab-grades.json`（42.5 KB，构建时内联）：高频 681 · 核心 1589 · 低频 1452 · 认知词 818 |
| 分级依据 | 默认启发式（词长 / 词缀复杂度 / 是否出现在六套卷命题材料 / 释义长度）并按百分位分档；**可插拔**：`--frequency freq.txt` 直接按真实词频表分档 |
| 调度引擎 | 复用 `src/services/srs.ts` 的 SM-2（`scheduleNext`）：忘记 → 0.25 天，记得 → 1 → 6 → 上次 × EF |
| 队列隔离 | 词汇存 IndexedDB `vocab` 仓库（按单词），错题存 `mistakes`（按题目 id），互不污染 |
| 旧档迁移 | localStorage 的 `state.schedule`（0.25/1/3/7 天）一次性换算为 SM-2 初值，幂等且只读旧数据 |
| 单词增强 | `src/services/vocab-enrich.ts`：词缀拆分、易混词（编辑距离 + 前缀相似）、搭配框架、发音（SpeechSynthesis） |
| 心魔联动 | 复习中评「忘记」→ 自动进入错题本与心魔；评「认识/熟练」→ 移出心魔 |
| 每日学习量 | `src/services/study-plan.ts`：按考试日期、已掌握量、每日时长与到期量算出新词量/复习量/题型配比，并按完成率与正确率动态调整 |
| 界面 | 「今日功课 → 词汇间隔复习」：计划摘要、分级筛选（各档已入列/总量）、今日复习与学新词两个入口、统计条 |

> ⚠️ **诚实标注**：当前分级是**启发式**而非真实语料词频，产物的 `source` 字段与界面都会显示这一点；
> 换成真实词频表只需 `node scripts/build-vocab-grades.mjs --frequency freq.txt`。
> 例句只提供「搭配框架」；真例句需授权材料，本应用不伪造真题例句（六套卷原创材料命中时才会展示）。

## 随机练习与固化题库（P0.3）

六套固定卷保留为**模考模式**，另有**随机练习**：从固化题库按约束抽题，避免背答案。

| 能力 | 实现 |
|---|---|
| 题库生成 | `scripts/build-question-bank.mjs`：**直接抽取并运行应用自身的生成器**（`makeQuestion` / `makeMemoryQuestion` 等），内容不会与运行时漂移 |
| 题目规模 | 18,502 题 = 词汇 18,160（en2zh / listen / similar / spell 各 4540）+ 六套卷快照 342（每套 57 题） |
| 稳定 ID | `q_vocab_<词序>_<题型>`、`q_paper_<卷 id>_<门类>_<序号>`，与内容一一对应，错题本以它为主键 |
| 标签与难度 | `difficulty` 0.2–0.8（词长 + 题型系数 / 门类基准）、`discrimination` 先验、`knowledgeTags`（cet4 / w: / len: / kind: / paper: / gate:）、听力题带 `audioMeta` |
| 组卷算法 | `src/types/question-bank.ts`：先按题型分布 / 难度区间 / 部分 / 卷别筛候选集，再做**加权随机**（权重 = 区分度 × 难度贴合 × 标签命中），最后按难度升序排布成由易到难 |
| 防重复 | `src/services/question-bank.ts`：近期做过的题记入 300 题窗口（`qingci.bank.recent`），组卷时自动排除 |
| 交付方式 | 6.23 MB（gzip 761 KB / br 536 KB）超过 1.5 MB 阈值 ⇒ **独立 JSON**，SW 按需缓存 + IndexedDB 落盘；不拖慢首屏 520 KB 单文件 |
| 入口 | 试炼殿「随机练习（20 题）」：载入题库 → 组卷 → 复用既有答题 / 判分 / 错题本链路 |

> 首次使用随机练习需联网载入一次题库（之后由 Service Worker 与 IndexedDB 兜底，可离线组卷）；
> 题库不可用时按钮会给出提示，其余功能不受影响。

## 错题本与间隔复习（SM-2）

答错的题会自动收进错题本，并按 SM-2 算法安排复习：

| 能力 | 实现 |
|---|---|
| 数据模型 | `src/types/mistakes.ts`：题型（听力 / 阅读 / 翻译 / 写作 / 词汇）、题干、你的答案、正确答案、错误次数、熟练度、下次复习时间、原文定位、知识点标签 |
| 调度算法 | `src/services/srs.ts`：忘记(q=2) / 模糊(3) / 记得(4) / 熟练(5)；间隔 0.25 天 → 1 天 → 6 天 → 上次间隔 × EF，EF 下限 1.3、间隔上限 365 天 |
| 存储 | `src/services/mistake-store.ts`：IndexedDB（`qingci-offline` v2 的 `mistakes` / `reviews` 仓库），按 `nextReviewAt`、`type` 建索引 |
| 迁移 | `src/services/migrate.ts`：把 v3/v4 存档里的「心魔本」与旧复习进度一次性导入，**只读旧数据**、幂等、可在 `meta` 里查标记 |
| 界面 | 「心魔 → 错题本」：题型筛选、今日复习队列、卡片翻转查看答案与原文定位、四档反馈按钮、按题型与薄弱知识点统计、未来 7 天复习量 |
| 与旧版关系 | 原「心魔本」单词列表保留；新错题本额外覆盖听力 / 阅读 / 翻译 / 写作 |

> 学习进度（灵气、连对、每日任务）仍在 localStorage（schema 保持 v4 不变），
> 错题本只把"可再生的练习数据"放进 IndexedDB：两者互不阻塞，删掉 IndexedDB 只丢错题本。

## AI 批改（接口预留，尚未接入）

写作与翻译已经有完整的「提交批改」入口，但**当前是占位实现**：
前端开关关闭时界面直接显示占位提示，**不发起任何网络请求**；
`functions/api/grade.ts` 也不调用任何外部 API、不读取密钥、不产生费用。

| 位置 | 作用 |
|---|---|
| `src/config/features.ts` | 前端开关 `AI_GRADING_ENABLED`（默认 `false`） |
| `src/services/grading.ts` | `gradeSubmission()`：开关关闭直接返回 `not_implemented`，永不抛异常 |
| `src/types/grading.ts` | 数据契约：`gradeStatus` / `gradeResult`（四维 15 分制）/ `gradeVersion` |
| `functions/api/grade.ts` | Pages Function 占位端点，固定返回 `{ status: 'not_implemented' }` |
| 「洞府」页 | 用户开关「允许 AI 批改我的作文 / 翻译」（默认关闭）+ 隐私占位条款 |

**后期接入步骤**（前端无需改动）：

1. 在 Cloudflare Pages → Settings → Environment variables 配置 `DEEPSEEK_API_KEY`（Secret 类型）
2. 将 `AI_GRADING_ENABLED` 设为 `true`，并把 `src/config/features.ts` 的前端开关同步置 `true` 后重新构建
3. 替换 `functions/api/grade.ts` 中 `TODO(接入)` 标记处的占位逻辑，改为调用 DeepSeek API
4. Prompt 按四级评分标准构造：内容切题 40% / 逻辑连贯 30% / 语言准确 20% / 表达丰富 10%
5. 返回结构必须与前端 `GradeResponse` 一致（`{ status: 'success', result: GradeResult }`）
6. 补上限流（`AI_GRADING_DAILY_LIMIT`）、超时（20s，与前端 `GRADE_TIMEOUT_MS` 对齐）、
   错误处理与 token 成本记录
7. 前端无需改动：开关打开后即走 `POST /api/grade`

> 密钥只存在于 Cloudflare 环境变量中；仓库、前端代码、构建产物里都不会出现任何 Key。
> 未完成授权核验前，界面不会展示任何虚拟评分或雷达图。

## 听力音频（构建期生成 · 离线可用）

| 来源 | 内容 | 授权 | 状态 |
|---|---|---|---|
| **Microsoft Edge TTS**（构建期合成） | 题库 4690 条听力题音频（听音辨词 4540 / 短篇新闻 42 / 长对话 48 / 听力篇章 60） | 由本应用生成，仅供教育及个人学习，非真人发音 | ✅ `npm run build:audio` |
| **VOA Learning English** | Words and Their Stories 等栏目精听素材（目标 20–30 段，2–5 分钟/段） | 美国联邦政府作品 · 公共领域（17 U.S.C. § 105），转载须注明来源 learningenglish.voanews.com | ⏸ 脚本骨架就绪（`npm run fetch:voa`），待填种子清单后在可访问网络执行 |
| ~~BBC Learning English~~ | — | 条款禁止通过其他网站或出版物传播 | ❌ 不集成 |

**音色与工具**：音色映射 `VOICE_MAP`（`en-US-AriaNeural` 主音色 / `en-US-GuyNeural` 对话预留 /
`en-GB-RyanNeural` 篇章轮换），语速 1.0；合成后端按序探测 edge-tts-generator（npm, GPL-3.0）→
不可用时切换 Python edge-tts（pip, MIT），两者同为 Microsoft Edge Read Aloud 音源，日志打印实际后端。
**仅构建期调用，运行时不发起任何 TTS 请求。**

**目录与离线策略**：

- `dist/audio/tts/<questionId>.mp3` + `manifest.json`（voice / voiceRole / duration / textHash 增量键）；
  `dist/audio/voa/<id>.mp3|.txt` + `manifest.json`（source / sourceUrl / license 如实标注）。
- 音频**不内联进单文件 HTML、不进 git**（`.gitignore` 已忽略 `dist/audio/`）；
  `deploy:pages` 部署流程会自动执行 `build:audio`，无音频不部署。
- 运行时按需 `fetch`，由 Service Worker `/audio/*` cache-first 分支缓存；首次播放前未缓存会确认
  「该音频需要联网下载，是否立即下载？」，确认后下载并写入 Cache API + IndexedDB（`audio:` 键），
  之后离线直接命中；离线未缓存时回退 SpeechSynthesis 语音合成占位并提示。
- 入口：audioDock「▶ 真实音频」按钮（音频清单缺失时自动隐藏）、精听面板（真实音频轨道 +
  VOA 素材区，无素材时区块隐藏）；主播放「▶ 播放听力」保持语音合成不变。
- 版权声明：洞府页 →「🔊 音频来源声明」弹窗。

> **构建与部署说明**：听力音频由**本地构建**生成（`npm run build:audio`），部署上传的是现成产物。
> Cloudflare Pages 项目未接入 GitHub 集成（Git Provider=No），远端不执行任何 TTS 构建命令，
> 因此不依赖 Python 环境。
>
> 新克隆仓库或换机器部署时，需先在本机安装 Python 3.9+ 和 `pip install edge-tts`，
> 再执行 `npm run build:audio`。`dist/audio/` 已在 `.gitignore` 中，不随仓库分发。
> 部署脚本内置产物硬闸：`dist/audio/tts/manifest.json` 缺失或 `count=0` 时中止部署并给出提示。

## 下一步待办（仅规划，均未执行）

| 优先级 | 事项 | 依赖 / 说明 |
|---|---|---|
| P0 | **Supabase 云同步**（存档与学情跨设备） | 等 Project URL + anon key 到位后接入；走 Feature Flag，默认关闭 |
| P1 | **离线分发包构建** `npm run build:offline` | 国内分发用：单 HTML + 词典分片打包 zip，脱离 Cloudflare 也能安装使用 |
| P1 | **真实听力音频素材接入** | 版权来源待定；接入后精听由「语音合成占位」切换为真实音频按秒循环 |
| P2 | **真实词频表替换** | `node scripts/build-vocab-grades.mjs --frequency <词频表>`，用真实词频重算四档分级 |
| P2 | **AI 批改接口接入** | 等 DeepSeek API Key；`src/config/features.ts` 开关默认关闭，接入前 `/api/grade` 保持占位、零外部请求 |

## 文档

| 文档 | 说明 |
|---|---|
| [产品方案](docs/产品方案.md) | 用户画像、功能列表、技术架构、里程碑排期 |
| [使用文档](docs/使用文档.md) | 三种使用方式、功能上手、常见问题 |
| [API 文档](docs/API.md) | HTTP 接口与核心模块 API，示例均经真实执行验证 |
| [部署说明](docs/部署说明.md) | 本地服务、Cloudflare Pages、其他静态托管 |
| [全新环境验证记录](docs/全新环境验证记录.md) | 干净环境按本 README 步骤实测的完整输出（可复现） |
| [更新日志](CHANGELOG.md) | 版本发布记录 |

## 架构

![架构图](docs/architecture.png)

## 数据与隐私

所有学习进度保存在**浏览器本地 localStorage**，不上传任何服务器，也与托管方式无关：
关电脑、重新部署、边缘节点换缓存都不会影响你已记录的学习进度。

> ⚠️ **会丢的情况都在浏览器这一侧**：清理浏览器缓存 / 站点数据、换电脑、换浏览器、
> 使用无痕模式打开，进度都会丢失。
>
> **建议每周在「洞府」页导出一次 JSON 备份**；换设备时在同一入口导入即可继续，
> 备份文件只包含学习记录，不含任何账号或身份信息。

## 免责说明

模拟卷是按 CET-4 结构用词库生成的**练习卷，不是历年真题**。
词汇训练旨在提升词汇量与拼写能力，不构成考试押题。

## 许可

MIT

## 声明

- 本项目与教育部教育考试院、全国大学英语四六级考试委员会**无任何关联**，为个人开发的开源 CET-4 备考工具。
- 数据默认保存在浏览器本地（IndexedDB / localStorage），不上传服务器；反馈与道友小组功能仅提交匿名数据（昵称 + 学习进度分档），不包含答题数据、分数或任何个人身份信息。
- 词库来源 [mahavivo/english-wordlists](https://github.com/mahavivo/english-wordlists)（MIT License）。
- 题库由算法确定性生成，**非历年真题**，仅供练习使用；题库规模 18,502 题。
- 听力音频当前为 TTS 占位，真人音频素材待接入。
- 本项目采用 **MIT License**，详见 [LICENSE](LICENSE)。
