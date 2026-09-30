# API 文档

适用版本：**v1.0.0** ｜ 更新日期：2026-09-30

本文档分两部分：

1. **HTTP 接口** — `server.mjs` 提供的服务端接口
2. **核心模块 API** — `src/core/` 可被 Node / 浏览器复用的函数

---

## 第一部分：HTTP 接口

启动服务：

```bash
npm start
```

服务默认监听 `http://127.0.0.1:4173`，可用环境变量覆盖：

```bash
PORT=8080 HOST=0.0.0.0 npm start
```

### 1.1 GET /healthz — 健康检查

**用途**：供负载均衡、监控系统探测服务可用性。

**请求**

```bash
curl -s http://127.0.0.1:4173/healthz
```

**响应 200**

```json
{
  "status": "ok",
  "version": "1.0.0",
  "uptimeSeconds": 27,
  "checks": {
    "lexicon": { "ok": true, "count": 4540, "expected": 4540 },
    "build": { "ok": true, "artifact": "dist/cet4-xiuxian.html" }
  },
  "runtime": { "node": "v24.18.0", "platform": "win32" },
  "timestamp": "2026-09-30T03:06:37.083Z"
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `status` | string | `ok` 健康 / `degraded` 降级 |
| `version` | string | 应用版本，取自 package.json |
| `uptimeSeconds` | number | 服务已运行秒数 |
| `checks.lexicon.ok` | boolean | 词库是否完整可解析 |
| `checks.lexicon.count` | number | 实际词条数（期望 4540） |
| `checks.build.ok` | boolean | 构建产物是否存在 |

**状态码**

| 码 | 含义 |
|---|---|
| 200 | 健康，词库解析正常 |
| 503 | 降级，词库缺失或损坏 |

> 别名：`/health` 等价于 `/healthz`。

### 1.2 GET /api/meta — 应用元信息

**请求**

```bash
curl -s http://127.0.0.1:4173/api/meta
```

**响应 200**

```json
{
  "name": "青词天路 · 四级全卷修仙",
  "version": "1.0.0",
  "lexiconSize": 4540,
  "memoryKinds": ["zh2en", "en2zh", "similar", "listen", "spell", "pos"],
  "features": ["六种记忆题型", "试卷模拟", "斗法对战", "学情看板", "间隔重复", "离线可用"],
  "servedFrom": "dist"
}
```

### 1.3 GET / — 应用页面

返回构建产物（`dist/cet4-xiuxian.html`），`Content-Type: text/html; charset=utf-8`。

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4173/
```

输出：`200`

### 1.4 错误响应

未匹配路径返回 404：

```json
{ "error": "not found", "path": "/nope" }
```

---

## 第二部分：核心模块 API

模块可同时用于 Node 与浏览器（通过构建内联）。

```js
const U = require('./src/core/utils');
const Q = require('./src/core/quiz');
```

### 2.1 utils.js — 工具函数

#### hash(text) → number

FNV-1a 哈希，用于生成固定题序的种子。

```js
const U = require('./src/core/utils');
console.log(U.hash('cet4'));
```

输出：

```text
279018245
```

> 同一输入永远得到同一结果；用于"同一套卷子题序一致"。

#### rng(seed) → () => number

以种子构造确定性随机数发生器（mulberry32）。

```js
const U = require('./src/core/utils');
const rand = U.rng(42);
console.log([rand(), rand(), rand()].map(n => n.toFixed(6)).join(', '));
console.log(U.rng(42)() === U.rng(42)());  // 同种子可复现
```

输出：

```text
0.601104, 0.448291, 0.852466
true
```

#### pick(list, n, rand) → Array

不重复抽取 n 个元素，不修改原数组。

```js
const U = require('./src/core/utils');
const out = U.pick([1,2,3,4,5], 3, U.rng(7));
console.log(out.length, new Set(out).size);
```

输出：

```text
3 3
```

#### wordsOf(text) → number

统计英文词数（写作题字数校验）。

```js
const U = require('./src/core/utils');
console.log(U.wordsOf("I don't like it"));
```

输出：

```text
4
```

#### esc(s) → string

HTML 转义，防注入。

```js
const U = require('./src/core/utils');
console.log(U.esc('<b>x</b>'));
```

输出：

```text
&lt;b&gt;x&lt;/b&gt;
```

#### dayKey(date?) → string

生成 `YYYY-MM-DD` 日期键。

```js
const U = require('./src/core/utils');
console.log(U.dayKey(new Date(2026, 0, 5)));
```

输出：

```text
2026-01-05
```

#### realmOf(qi, realms) → {name, into, cap, index}

境界计算；超出最高境界返回"词仙"。

```js
const U = require('./src/core/utils');
const realms = [['炼气',80],['筑基',160],['金丹',280]];
console.log(U.realmOf(80, realms).name);
console.log(U.realmOf(99999, realms).name);
```

输出：

```text
筑基
词仙
```

#### scheduleWord(prev, quality, now?) → {level, next, tries}

艾宾浩斯间隔重复。`quality` 取值：`again` (0.25天) / `hard` (1天) / `good` (3天) / `easy` (7天)。

```js
const U = require('./src/core/utils');
const now = 1700000000000;
const r = U.scheduleWord(null, 'good', now);
console.log(r.level, r.next - now === 3 * 86400000, r.tries);
```

输出：

```text
good true 1
```

#### checkSpell(input, answer) → {ok, near}

拼写校验，忽略大小写与非字母字符；`near` 表示差一个字母的近似。

```js
const U = require('./src/core/utils');
console.log(U.checkSpell('Apple', 'apple').ok);
console.log(U.checkSpell('appl', 'apple').near);
```

输出：

```text
true
true
```

#### masteryPercent(known, total) → number

掌握度百分比。

```js
const U = require('./src/core/utils');
console.log(U.masteryPercent(454, 4540));
```

输出：

```text
10
```

#### ringOffset(percent, circumference=302) → number

环形进度条的 `stroke-dashoffset`。超范围自动钳制。

```js
const U = require('./src/core/utils');
console.log(U.ringOffset(50, 302), U.ringOffset(999, 302));
```

输出：

```text
151 0
```

#### recentDays(days, n, now?) → Array

近 N 日学习数据，缺失日期补 0。

```js
const U = require('./src/core/utils');
const now = new Date(2026, 5, 10).getTime();
const out = U.recentDays({ '2026-06-10': { right: 5 } }, 7, now);
console.log(out.length, out[6].key, out[6].right, out[0].right);
```

输出：

```text
7 2026-06-10 5 0
```

#### paperScore(gates, got) → number

按权重折算模拟卷总分（710 分制）。分项先四舍五入再累加。

```js
const U = require('./src/core/utils');
console.log(U.paperScore(
  [{ id:'write', weight:106.5, count:1 }, { id:'news', weight:49.7, count:7 }],
  { write:1, news:7 }
));
```

输出：

```text
157
```

---

### 2.2 quiz.js — 题型生成与判分

#### MEMORY_KINDS / KIND_LABEL

```js
const Q = require('./src/core/quiz');
console.log(Q.MEMORY_KINDS.join(','));
console.log(Q.KIND_LABEL.spell);
```

输出：

```text
zh2en,en2zh,similar,listen,spell,pos
拼写默写
```

#### makeMemoryQuestion(kind, ctx) → question

生成一道记忆题。`ctx` 需含 `words`（词库）、`meta`（卷元信息）、`index`、`seedText`。

```js
const Q = require('./src/core/quiz');
const words = [
  { w:'apple', ipa:'[ˈæpl]', zh:'n.苹果', short:'苹果' },
  { w:'apply', ipa:'[əˈplai]', zh:'vt.应用', short:'应用' },
  { w:'banana', ipa:'[bəˈnɑːnə]', zh:'n.香蕉', short:'香蕉' },
  { w:'berry', ipa:'[ˈberi]', zh:'n.浆果', short:'浆果' },
];
const ctx = { words, meta:{ id:'demo' }, index:0, seedText:'demo|spell' };
const q = Q.makeMemoryQuestion('spell', ctx);
console.log(q.prompt, '|', q.sub, '|', q.tpl);
```

输出（种子固定，结果可复现）：

```text
香蕉 | [bəˈnɑːnə] · 6 个字母 | b_____
```

生成选择题：

```js
const Q = require('./src/core/quiz');
const words = [
  { w:'apple', ipa:'[ˈæpl]', zh:'n.苹果', short:'苹果' },
  { w:'apply', ipa:'[əˈplai]', zh:'vt.应用', short:'应用' },
  { w:'banana', ipa:'[bəˈnɑːnə]', zh:'n.香蕉', short:'香蕉' },
  { w:'berry', ipa:'[ˈberi]', zh:'n.浆果', short:'浆果' },
];
const q = Q.makeMemoryQuestion('zh2en', { words, meta:{id:'demo'}, index:0, seedText:'demo' });
console.log(q.choices.length, q.choices.includes(q.answer));
```

输出：

```text
4 true
```

| 题型 | 返回关键字段 |
|---|---|
| `zh2en` | `prompt`=中文, `choices`=英文×4, `answer`=英文 |
| `en2zh` | `prompt`=英文, `choices`=中文×4, `answer`=中文 |
| `similar` | `prompt`=中文, `choices`=形近词×4, `answer`=正确拼写 |
| `listen` | `prompt`=播放提示, `choices`=英文×4, `speak`=朗读文本 |
| `spell` | `kind='spell'`, `tpl`=首字母+下划线, `answer`=完整拼写 |
| `pos` | `prompt`=英文, `choices`=词性标签×4, `answer`=正确词性 |

未知题型抛出 `Error: 未知题型: xxx`。

#### judgeChoice(question, pickedIndex) → boolean

判定选择题。

```js
const Q = require('./src/core/quiz');
console.log(Q.judgeChoice({ choices:['a','b','c'], answer:'b' }, 1));
console.log(Q.judgeChoice({ choices:['a','b','c'], answer:'b' }, 0));
```

输出：

```text
true
false
```

#### judge(question, answer) → {ok, near}

统一判定入口，自动分流选择题与拼写题。

```js
const Q = require('./src/core/quiz');
console.log(Q.judge({ kind:'spell', answer:'apple' }, 'Apple').ok);
console.log(Q.judge({ choices:['a'], answer:'a' }, 'a').ok);
```

输出：

```text
true
true
```

#### recordMemStat(stats, memKind, ok) → object

累加题型统计，**返回新对象**（原对象不变，便于状态回溯）。

```js
const Q = require('./src/core/quiz');
const s0 = {};
const s1 = Q.recordMemStat(s0, 'zh2en', true);
const s2 = Q.recordMemStat(s1, 'zh2en', false);
console.log(JSON.stringify(s1), JSON.stringify(s2), JSON.stringify(s0));
```

输出：

```text
{"zh2en":{"r":1,"n":1}} {"zh2en":{"r":1,"n":2}} {}
```

#### kindAccuracy(rec) → number|null

题型正确率；无数据返回 `null`。

```js
const Q = require('./src/core/quiz');
console.log(Q.kindAccuracy({ r:3, n:4 }), Q.kindAccuracy(null));
```

输出：

```text
75 null
```

---

## 第三部分：错误码与调试

### 文档示例自动核验

本文档中的 26 条示例全部可执行，且可用命令复现：

```bash
npm run test:docs
```

输出：

```text
总计 26 条：通过 26，失败 0
```

脚本 `scripts/verify-docs.js` 会逐条调用文档中的函数并比对输出，
若某条示例与文档所述不符会列出差异并以非零码退出。

| 现象 | 原因 | 处理 |
|---|---|---|
| `未知题型: xxx` | 传了不在 MEMORY_KINDS 的 kind | 用 `Q.MEMORY_KINDS` 校验 |
| `未知的复习等级` | quality 不在 again/hard/good/easy | 检查入参 |
| 健康检查 503 | 词库缺失或 JSON 损坏 | 重新 `npm run build` |
| 404 not found | 路径未匹配 | 可选路径：`/`、`/healthz`、`/api/meta` |
