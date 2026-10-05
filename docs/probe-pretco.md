# PRETCO 数据源探活报告（阶段 C 前置 · 完整五路径版）

> 时间：2026-10-05 · 位置：`master @ 5203870` · **本报告不提交 git，等决策**
> 覆盖谕令要求的全部 5 条路径 + 2 条附加回退 · 结论见文末

## 0. 探测通道（先说清楚，因为它影响结论可信度）

| 通道 | 状态 | 用途 |
|---|---|---|
| `web_search` 工具 | ❌ 缺 `DEEPSEEK_API_KEY` | 不可用 |
| `web_fetch` 工具 | ❌ 沙箱 DNS 拦截全部公网域名 | 不可用 |
| **node `fetch`（项目构建脚本同款）** | ✅ **HTTP 200** | **本次全部探测走它** |
| 搜索引擎 HTTP（DuckDuckGo/Bing/百度） | ✅ 200（可解析结果，后段被限流 202） | 路径 4 补搜 |
| GitHub code search | ⚠️ 401 匿名不可用 | 改用 repo search + 搜索引擎 |

**关键区分**：`web_fetch` 被拦 ≠ 数据源不可达。项目自身 `fetch` 通 GitHub（0.8–1.7s），
所以 `build-lexicon.mjs` 的既有回退链**仍然可用**——只是没有 PRETCO 数据可拉。

---

## 1. 路径 1 · ECDICT（首选）

| 项 | 结果 |
|---|---|
| 可达性 | `raw.githubusercontent.com/.../README.md` → **200 · 868ms · 10376 B**；jsDelivr 回退 → **200 · 1057ms** |
| 数据字典 | README **L39**：`tag` = 「字符串标签：zk/中考，gk/高考，cet4/四级 **等等**标签，空格分割」 |
| **PRETCO-A 词数** | **0**（tag 无 pretco） |
| **PRETCO-B 词数** | **0** |
| License | **MIT**（`api.github.com/repos/…` → spdx `MIT`，8380★，pushed 2025-03-28，未 archived） |
| 采集方式 | 本地已有 `.cache/lexicons/_shared/ecdict.csv` 62.9 MB，全量扫描 |
| 质量评估 | 详情字段最全（音标/释义/例句/搭配/词根），**但没有 PRETCO 维度** |

**tag 全集实测（62.9 MB 全量扫描，去重后 8 种）**：

```
gre 7504 · toefl 6974 · cet6 5407 · ielts 5040
ky 4801 · cet4 3849 · gk 3677 · zk 1603
pretco/pets/三级 相关命中 = 0
```

附带口径印证：`gk`=3677、`zk`=1603 与已建的高中核心词 3677、初中核心 1603 **完全一致**，
说明扫描脚本读的正是 tag 字段，结论可信。

> **判定 ❌**：ECDICT 无 PRETCO 标注，无法过滤。

---

## 2. 路径 2 · mahavivo/english-wordlists

| 项 | 结果 |
|---|---|
| 可达性 | `api.github.com/repos/…/contents/` → **200** |
| 数据字段 | txt（多数只有词形）/ xlsx / docx / pdf；**无统一结构化字段** |
| **PRETCO-A 词数** | **0** |
| **PRETCO-B 词数** | **0** |
| License | ⚠️ **无 license 文件**（28 文件全列，无 LICENSE/COPYING）—— **触发停下条件 2** |
| 采集方式 | `raw.githubusercontent`（项目既用它取 `CET4_edited.txt`） |
| 质量评估 | 28 文件逐个核对：CET4/6、COCA、GRE、TOEFL、中考、上海初中、小学、专四八级、台湾高中…… **无 PRETCO/三级/二级/AB 级** |

```
⚡HIT = 0（28/28 文件名与 PRETCO/三级/二级/PETS/应用能力 均无交集）
```

> **判定 ❌**：无目标数据；且 license 文件缺失（项目 MIT，直接复用有许可风险）。

---

## 3. 路径 3 · GitHub 全局搜索

| 项 | 结果 |
|---|---|
| 可达性 | `api.github.com/search/repositories` → **200** |
| 四组关键词 | `pretco vocabulary` / `高等学校英语应用能力考试 词汇` / `PRETCO-A wordlist` / `pretco-a pretco-b` → **total 全部 = 0** |
| 补充关键词（上轮） | `pretco` → 3 个**全无关**（Pret A Manger 订阅 App、巴西项目、无描述仓库）；`PRETCO-A` → 0 |
| code search | ⚠️ 401（匿名不可用）→ 改用搜索引擎 `site:github.com pretco` 补搜 |
| 搜索引擎补搜 | 命中全是噪音（petco 宠物电商、SVG 图标、iptv 列表），**0 个词表仓库**；后 4 组查询被限流 202 |
| License | — （无目标仓库） |
| 质量评估 | 无 |

> **判定 ❌**：两种搜索通道交叉验证，均零命中。

---

## 4. 路径 4 · 公开考纲 PDF（最后回退）

| 项 | 结果 |
|---|---|
| 官方域名可达性 | **neea.edu.cn 200 · 1420ms** · **jseea.cn 200 · 2838ms** · **moe.gov.cn 200 · 1391ms** |
| 搜索引擎 | Bing 200/120KB · DuckDuckGo 200/32KB · 百度 200/1.1MB，**均含 "PRETCO"** |
| 结果链接提取 | 40 条真实链接，**0 个 .pdf 直链**；词表类候选全与 PRETCO 无关 |
| PRETCO-A 词数 | 无法测量（未定位到文件） |
| License | 考纲官方文本**无开源许可**，仅限个人学习引用 → **触发停下条件 2 的灰色地带** |
| 采集方式 | ❌ **不可自动化**：找到的都是文库/付费平台（`wenku.baidu.com`、`doc88.com`、`max.book118.com`、`renrendoc.com`），需登录/付费/在线阅读 |
| 质量评估 | 唯一残存路径，但必须人工 |

补充线索（已尽力）：
- 搜索结果里一个腾讯云 COS「考试大纲」目录 `gdoa5y123…cos.ap-guangzhou.myqcloud.com/Bmxt/DownMb/考试大纲/` → 目录可访问但**列举 403**，无法枚举
- `jnoodle/English-Vocabulary-Word-List`（430★，无 license）：只有 Oxford 3000/5000、Longman 3000、OPAL，**无 PRETCO**

> **判定 ⚠️→❌**：域名与搜索引擎可达，但**无法定位到具体 PDF**（`web_search` 工具缺失），
> 且即使找到也是**人工提取、无法自动化**、许可不明确。

---

## 5. 路径 5 · KyleBing/english-vocabulary

| 项 | 结果 |
|---|---|
| 可达性 | `api.github.com` → **200** |
| 数据字段 | json：`word` / `translations[]` / `phrases[]`（结构化，最适配 `build-lexicon.mjs`） |
| **PRETCO-A 词数** | **0** |
| **PRETCO-B 词数** | **0** |
| License | **BSD-3-Clause** ✅（2033★，pushed 2026-09-30，活跃） |
| 采集方式 | `raw.githubusercontent`（项目既用它取初中/高中表） |
| 质量评估 | **4 个子目录 28 文件逐个展开核对**，考试分级只有：初中 / 高中 / CET4 / CET6 / 考研 / 托福 / SAT —— **无 PRETCO** |

```
json/:        1-初中 2-高中 3-CET4 4-CET6 5-考研 6-托福 7-SAT
乱序sql/:     初中 高中 四级 六级 考研 托福 SAT
full_line_jsonl/ + full_line_tsv/:  格式样例，无分级词表
```

> **判定 ❌**：license 与结构都最理想，但**没有 PRETCO 词表**。

---

## 6. 附加回退（谕令未列，主动验证）

| 通道 | 结果 |
|---|---|
| jsDelivr 搜索 API | ❌ 400（`data.jsdelivr.com/v1/search` 与 `packages/*?search=` 均 400，参数格式不可用） |
| npm registry | ✅ 200 · **`pretco` 命中 0 包** |
| PyPI | ✅ 200（3036 B，无可解析结果） |
| `kkrypt0nn/wordlists`（2385★） | ✅ 12 目录全展开 → **安全测试字典**（rockyou/目录爆破），与词汇考试无关，无 license |

---

## 最终结论：❌ 不可用

**五条路径全部失败**，且同时触发谕令三条停下条件：

| 停下条件 | 是否触发 |
|---|---|
| 所有路径均不可达 | ✅ 触发（路径 1/2/3/5 零命中，路径 4 无法定位文件） |
| License 不明确或非商用 | ✅ 触发（mahavivo 无 license；考纲 PDF 无开源许可） |
| 词数严重不足（A<2000 / B<1500） | ✅ 触发（实测 **A=0 / B=0**） |
| 数据格式无法自动化（只在 PDF 里） | ✅ 触发（路径 4 是唯一残存，且必须人工） |

**推荐数据源：无。**

### 阶段 C 可执行性：❌ 不可执行

无法给出 `scripts/build-lexicon.mjs --lexicon pretco-a` 的数据源适配方案——
**没有可指认的 URL、字段、词数**。谕令硬约束 4「不生成任何假数据或占位词表」
也排除了「先造个壳」的做法。

---

## 替代方案（供决策）

### 方案 1 · 手动提取（谕令路径 4 回退，成本高）

**工作量估计**：
- 找到 PDF：需人工在浏览器里搜索定位（`web_search` 工具缺失，我无法代劳）
- 提取 ~3400（A 级）+ ~2500（B 级）词条 → 约 5900 行，人工誊录/OCR **约 4–8 小时**
- 补齐详情（音标/中文释义/例句/搭配）到既有词库口径（>98% 中文释义覆盖）：
  ECDICT 可补大部分详情，但**PRETCO 专有词**（高职场景词汇）ECDICT 收录有限，
  预计 10–20% 词条需手工补 —— **约 6–12 小时**
- **合计约 10–20 小时**，且许可仍不明确（考纲文本无开源授权，与项目 MIT 冲突）

### 方案 2 · 暂缓 PRETCO，先部署 v1.9.1（推荐）

理由：
- 阶段 A（心魔卡死修复，P0）+ 阶段 B（UI 调整）**已完成且门禁全绿**（467/467，+10.6 KB）
- P0 修复早一天上线早一天止血，不该被一个 P2 扩展项阻塞
- PRETCO 可作为独立后续任务，等拿到数据源再启动

### 方案 3 · 换考试词库（ECDICT 已有 tag 的）

ECDICT 实测可用 tag：`ky`（考研 4801）、`gre`（7504）、`toefl`（6974）、`ielts`（5040）。
若目标是「继续扩词库」，这四个**现成可采、MIT、可自动化**，成本远低于 PRETCO。
但偏离谕令「PRETCO」的原始意图，需明确改目标。

---

## 附：网络通道事实（供后续复用）

- `web_search` 工具缺 key、`web_fetch` 工具被沙箱拦 —— **不代表数据源不可达**
- node `fetch` 通 GitHub / npm / PyPI / 三大搜索引擎（0.7–2.8s）
- GitHub `code search` 匿名 401；`jsDelivr search` 400
- DuckDuckGo `html.duckduckgo.com/html/?q=` 可解析 `uddg=` 参数取真实链接；连续查询会被限流 202
