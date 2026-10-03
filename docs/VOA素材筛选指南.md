# VOA 素材筛选指南（任务 B · 合规与质量标准）

> 本文件定义 `scripts/fetch-voa-audio.mjs` 的素材准入标准。
> 填写 `scripts/voa-seeds.json` 前请通读；不符合标准的链接不要加入清单。

## 1. 来源与授权

- **唯一来源**：VOA Learning English（`learningenglish.voanews.com`）。
- **授权依据**：VOA Learning English 的文本、MP3 与视频属于**美国联邦政府作品**，
  依 17 U.S.C. § 105 处于**公共领域**；其使用条款允许以教育与商业目的转载，
  但**必须注明来源 `learningenglish.voanews.com`**。
- **manifest 如实标注**：`source: "VOA Learning English"`、`sourceUrl`（原始文章 URL）、
  `license: "Public Domain"`、`fetchedAt`（抓取时间）。**不伪造任何出处**。
- **禁止集成 BBC Learning English**：其条款明确禁止通过其他网站或出版物传播，一票否决。

## 2. 栏目白名单（优先级从高到低）

| 栏目 | 入选理由 |
|---|---|
| Words and Their Stories | 词汇文化讲解，贴合 CET-4 词汇学习 |
| Everyday Grammar | 语法点讲解，语速慢、句子清晰 |
| Education Tips / Let's Learn English | 学习策略与基础课程 |
| American English Manners（如含） | 生活口语，短小 |

> 栏目外的 VOA 内容（新闻报道、时政访谈）默认不选——通常含第三方通稿成分。

## 3. 技术指标

| 指标 | 区间 |
|---|---|
| 语速 | 90–120 词/分钟（VOA Special English 标准语速） |
| 单段时长 | 2–5 分钟 |
| 初始数量 | 20–30 段 |
| 音频格式 | MP3（原始文件，不转码、不剪辑、不重新配音） |

## 4. 第三方版权过滤（脚本自动 + 人工复核双保险）

抓取脚本会扫描 transcript，命中以下任一特征即**跳过该素材**并记录原因：

- `Associated Press` / `AP News` / `Reuters` / `AFP`（第三方通稿署名）
- `Music:` / `background music`（背景音乐署名，音乐版权独立于公共领域文本）
- `via Getty`（图片社素材）

> 若人工发现脚本未覆盖的第三方成分（如采访片段署名），请加入
> `scripts/fetch-voa-audio.mjs` 顶部的 `THIRD_PARTY` 正则数组。

## 5. 单条失败处理

- 页面网络不可达 / 403 / 404 → 记入 `failed`，**跳过并继续**，不阻塞其它素材。
- 页面无 MP3 直链 → 记入 `skipped (no-mp3-link)`。
- 合规过滤命中 → 记入 `skipped (third-party-copyright)`。

## 6. 离线与运行时

- 音频与文本落 `dist/audio/voa/`，**不内联进单文件 HTML、不进 git**。
- 运行时按需 `fetch`，由 Service Worker 的 `/audio/*` cache-first 分支缓存；
  断网未缓存时界面提示「该音频需要联网下载」。

## 7. 填写清单示例

从 `scripts/voa-seeds.template.json` 复制结构，`id` 用 `voa-001` 起递增：

```json
[
  { "id": "voa-001", "url": "https://learningenglish.voanews.com/a/…/123456.html",
    "title": "可留空", "category": "Words and Their Stories" }
]
```

填好后运行 `npm run fetch:voa`（需在可访问 VOA 的网络环境下执行）。
