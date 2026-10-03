# 青词天路 · 四级全卷修仙

> 把枯燥的 CET-4 背词，做成有进度感、有对抗、有反馈的修仙历程。

[![version](https://img.shields.io/badge/version-1.3.1-0e6b53)](CHANGELOG.md)
[![tests](https://img.shields.io/badge/tests-66%20passing-176b3f)](tests/)
[![coverage](https://img.shields.io/badge/coverage-100%25%20lines%20(core)-176b3f)](tests/)
[![runtime deps](https://img.shields.io/badge/runtime%20deps-0-a56d22)](#技术特色)
[![license](https://img.shields.io/badge/license-MIT-8b7360)](LICENSE)

---

## 这是什么

一个**单文件自包含**的多考试背词应用：4540 条词库、五类备考模式（初中 / 高中 / PETS-3 /
CET-4 / CET-6）、六种记忆题型、模拟卷、回合制对战、学情看板。源码为 **TypeScript**，
构建后是一个 478 KB 的 HTML 文件，**运行时零依赖，断网可用**。

## 快速开始

```bash
# 方式一：直接用浏览器打开（最简单）
#   双击 cet4-xiuxian.html 即可

# 方式二：本地服务
npm start                 # 访问 http://127.0.0.1:4173

# 方式三：从源码构建
npm install               # 安装构建期依赖（esbuild + typescript）
npm run typecheck         # TypeScript 类型门禁（tsc --noEmit）
npm run build             # esbuild 打包 src/ → 单文件 dist/cet4-xiuxian.html
npm test                  # 运行 66 个自动化测试
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
| **多考试备考** | 初中 / 高中 / PETS-3 / CET-4 / CET-6 五类模式：题量、时长、总分、及格线按考试类型配置；整套作答达线才记一次境界突破 |
| **试炼殿** | 六套 CET-4 模拟卷（125 分钟 57 题），710 分制折算；难度按考试等级与境界动态取 1–5 |
| **斗法场** | 回合制对战：血条、15 秒倒计时、连击、命中率 |
| **学情看板** | 掌握度环形图、近 7 日曲线、六题型正确率对比 |
| **心魔本** | 错词归集 + 艾宾浩斯间隔重复（0.25/1/3/7 天） |
| **游戏化** | 境界（炼气→地仙）、灵气、灵石商店、每日任务、成就 |

## 技术特色

- **运行时零依赖**：产出的单文件不加载任何 CDN、不 import 任何包，断网可用；
  构建期使用 `esbuild`（打包）与 `typescript`（类型检查）两个 devDependency
- **确定性随机**：同一套卷子每次题序一致，便于重做对比
- **TypeScript 源码**：`src/**/*.ts` 与 `functions/**/*.ts` 由 `tsc --noEmit` 把关，
  esbuild 打包后内联进单文件，部署产物形态与旧版一致
- **纯函数核心**：`src/core/` 与 DOM 解耦，可被 Node 测试直接覆盖
- **可测试**：66 个用例；`src/core`、`functions/`、`worker/` 行覆盖率 100%
  （统计含测试脚本时整体行覆盖 99.73%、分支 87.88%、函数 96.99%；TypeScript 模块经
  esbuild 打包后执行，由 10 条行为用例覆盖，暂未计入行覆盖率）
- **文档可执行**：`npm run test:docs` 逐条执行 API 文档中的 26 条示例并比对输出，防止文档与代码脱节
- **容错降级**：旧存档缺字段时静默跳过，不连累主流程

## 项目结构

```text
├── src/
│   ├── core/utils.js          纯工具：哈希/随机/间隔重复/境界/五类考试配置（待迁 TS）
│   ├── core/quiz.js           业务核心：题型生成、判分、统计（待迁 TS）
│   ├── config/features.ts     前端 Feature Flag（AI 批改等开关，默认全关）
│   ├── services/grading.ts    写作/翻译批改服务：开关关闭时不发任何请求
│   ├── services/index.ts      服务统一出口（构建时挂载全局 QingciServices）
│   ├── types/grading.ts       批改数据契约：状态 / 四维评分 / 批注 / 版本号
│   ├── entry/services.ts      esbuild 入口（IIFE，内联进单文件）
│   └── index.template.html    应用外壳：DOM 渲染与交互
├── functions/                 Cloudflare Pages Functions（ESM/TS）
│   ├── healthz.js · status.js · api/meta.js
│   └── api/grade.ts           AI 批改占位端点（不调用外部 API）
├── tests/                     自动化测试（node:test：核心 + Worker + Functions + 批改）
│   └── helpers/load-ts.mjs    用 esbuild 把 TS 模块打包后再 import
├── scripts/build.mjs          构建：校验 → esbuild 打包 → 内联 → 输出 dist
├── scripts/prepare-deploy.mjs 生成部署目录（deploy/ 或 deploy-pages/ + _routes.json）
├── scripts/healthcheck.mjs    健康检查（校验状态码与响应时间）
├── worker/index.mjs           Cloudflare Workers 入口（同构接口）
├── server.mjs                 本地 HTTP 服务 + /healthz + /status + /api/meta
├── docs/                      产品方案 / 使用文档 / API 文档 / 架构图
├── CHANGELOG.md               版本发布记录
└── dist/                      构建产物（单文件 HTML）
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

实测结果（2026-10-03 部署 v1.3.1 后，每路径 10 次采样 × 2 轮，`npm run probe:prod`）：

```text
路径        中位      最快      最慢      阈值内    超 2 秒
/healthz    235ms    208ms     773ms    10/10     0    ✅
/api/meta   255ms    204ms     1079ms   10/10     0    ✅
/status     323ms    193ms     722ms    10/10     0    ✅
/          399ms    324ms     658ms    10/10     0    ✅
```

> **两轮合计 80/80 采样全部返回 HTTP 200 且低于 2000ms 阈值。**
> `/status` 上版曾因缺少 Function 走 SPA 回退，实际传输 469 KB 入口页导致偶发超时；
> v1.3.1 补上 `functions/status.js` 后该路径只返回 1.2 KB 状态页，中位 323ms。

`/healthz` 返回的真实响应（2026-10-03 部署 v1.3.1 后实测）：

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
| **Cloudflare Pages** | `https://qingci-cet4-xiuxian.pages.dev` | ✅ 实测可达 | **当前验收入口**，已部署 v1.3.1（五类备考 + 状态页），动静接口齐全 |
| Cloudflare Workers | `https://qingci-cet4-xiuxian.bw8pbrkt56.workers.dev` | ❌ 被阻断 | 固定边缘部署，接口逻辑与 Pages 版同构，当前仍为 v1.2.0 构建 |

> **为什么以 Pages 地址作为验收入口**：`*.workers.dev` 域名在中国大陆网络下被整体阻断
> （实测 DNS 解析到 Dropbox 的 IP `162.125.80.6`，属 DNS 污染，TCP 无法连通），
> 而 `*.pages.dev` 域名实测可正常直连。两者共用同一套构建产物与同构接口实现，
> 功能基本一致，因此以可达性更好的 Pages 地址作为线上验收入口。
> Workers 侧此前已完成部署，并通过 Cloudflare API 确认为生产环境运行
> （部署版本 `37396f96`、`workers.dev` 子域已启用、`APP_VERSION` 为 1.2.0）；
> 该通道**未随 v1.3.0 / v1.3.1 的 Pages 部署一起更新**。

> 复采命令：`npm run probe:prod`（每路径 10 次采样，阈值 2000ms）。

> **关于性能优化**：`/healthz` 与 `/api/meta` 的词库读取已加缓存，避免每次请求重读 469KB 文件；
> 入口页下发 ETag 协商缓存，重复访问命中 `304` 不再重复传输 469KB 正文；
> 本机服务与静态托管均启用 Brotli 压缩（实测本机预热：gzip 144 KB / br 128 KB，入口页原始 469 KB）。

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
