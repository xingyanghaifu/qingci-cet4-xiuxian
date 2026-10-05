# PRETCO 数据源探活报告（阶段 C 前置）

> 时间：2026-10-05 · 位置：`master @ 5d0d3e1`（阶段 B 完成后）
> 结论：**三个数据源全部无命中，触发停下条件「数据源不可达」**，待决策方案 A / B。

## 探活方法

环境说明：会话内 `web_search` 缺 API key、`web_fetch` 被沙箱 DNS 拦截
（`resolves to a non-public IP`）。**但项目自身的 node `fetch` 通 GitHub（HTTP 200）**，
故全部探测走项目同款通道，结果可直接代表构建脚本的实际可达性。

| # | 探测 | 通道 | 结果 |
|---|---|---|---|
| 1 | ECDICT `tag` 字段取值分布 | 本地 `.cache/lexicons/_shared/ecdict.csv`（62.9 MB） | 仅 8 种 tag，**无 pretco** |
| 2 | GitHub repo 搜索 `pretco` / `pretco vocabulary` / `PRETCO-A` / `pretco wordlist` | `api.github.com` | 3 个命中**全部无关**（Pret A Manger 应用等），其余 0 |
| 3 | GitHub repo 搜索「英语应用能力」 | `api.github.com` | 8 个命中**全部无关** |
| 4 | GitHub code search | `api.github.com` | HTTP 401（匿名不可用，属预期） |
| 5 | `mahavivo/english-wordlists` 根目录（项目既有源） | `api.github.com` | 21 个文件，**无 PRETCO/三级/AB 级表** |
| 6 | 本地缓存全扫 | `.cache/lexicons/` | 只有 ECDICT + mahavivo 四六级/中学表 |

### 探测 1 明细：ECDICT tag 全集

```
gre 7504 · toefl 6974 · cet6 5407 · ielts 5040
ky 4801 · cet4 3849 · gk 3677 · zk 1603
（去重后共 8 种，pretco/pets/三级 相关命中 0）
```

附带印证：`gk`=3677、`zk`=1603 与已建的高中核心词 3677、初中核心 1603 **完全一致**，
说明 v1.9.0 的中学词库确实取自 `gk`/`zk` tag，探活脚本口径正确。

## 判定

按谕令「停下报告的条件」第 5 条（**数据源不可达**），阶段 C 暂停，交由决策：

| 方案 | 内容 | 成本 | 风险 |
|---|---|---|---|
| **A** | 从公开考纲 PDF 手动提取 PRETCO-A/B 词表（约 3400 / 2500 词） | 高：需人工整理 + 逐词补详情，详情覆盖率难达既有词库口径（>98% 中文释义） | 版权与准确性需自行把关；语料源缺 PRETCO 专有词，例句/搭配质量可能低于 CET 系 |
| **B** | 暂缓 PRETCO，先部署 v1.9.1（阶段 A + B 成果） | 低：现有门禁已全绿 | 无 |

**探活未证伪的一条路径**（方案 A 的低成本变体，尚未验证）：
`mahavivo/english-wordlists` 有 `NPEE_Wordlist.txt`（考研）与 `英语专业四八级词汇表.txt`，
且 ECDICT 有 `bnc`/`frq` 频次字段 —— 理论上可用「ECDICT 词频 + 已有考纲表交集」
**近似**推导 PRETCO-A/B 词表。但这是近似而非权威考纲，与谕令「数据源回退链」的
原始意图有偏差，需明确授权才可采用。

## 附：网络通道事实（供后续阶段复用）

- `web_search` 工具：缺 `DEEPSEEK_API_KEY`，不可用
- `web_fetch` 工具：沙箱 DNS 拦截全部公网域名
- **node `fetch`（构建脚本通道）：正常**，`api.github.com` 与
  `raw.githubusercontent.com` 均 HTTP 200（约 0.8–0.9s）
- 因此 `build-lexicon.mjs` 的既有回退链（api.github → raw.githubusercontent）
  **仍然可用**，只是没有 PRETCO 数据可拉
