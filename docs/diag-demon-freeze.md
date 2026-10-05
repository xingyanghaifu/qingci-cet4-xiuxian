# 诊断报告 · 「挑战心魔」点击后网站卡死（P0）

> 版本：v1.9.1 阶段 A · 诊断对象 `master @ caeec84`（v1.9.0）
> 方法：静态调用链追踪 + **从生产模板抽取真实源码做离线复现**（无猜测）
> 结论：**根因不是心魔数量多，而是出题器 `unique()` 无终止保障的 `while` 死循环。**

---

## 一、复现环境与方法

本环境无 DevTools，故采用等价的确定性复现：从 `src/index.template.html`
用正则抽出**将被打包进产物的真实函数源码**（`bankFor` / `makeQuestion` /
`normShort` / `pick`），注入业务桩后在 Node 里执行；外层用
`Start-Process + WaitForExit(4000)` 判定是否挂死。
进程 >4s 不返回 = 主线程被独占 = 浏览器里的「网站卡死」。

抽取出的 `unique()` 真实源码：

```js
const unique = (n, avoid=[]) => {
  const out=[]; const blocked=new Set(avoid);
  const seenShort=new Set(out.map(x=>normShort(x.short)));
  while(out.length<n){
    const item=word();
    if(blocked.has(item.w)||seenShort.has(normShort(item.short))) continue;  // ← 只 continue，无退出条件
    blocked.add(item.w); seenShort.add(normShort(item.short)); out.push(item);
  }
  return out;
};
```

## 二、根因（Root Cause）

`unique()` 的 `while(out.length<n)` 里，`continue` 分支**既不计数也不退出**。
当候选词池 `bank` 中「可用且不重复」的词数 < 需求数 `n` 时，循环条件
`out.length<n` 永远为真 → **无限自旋，主线程 100% 占用** → 页面卡死。

这不是渲染问题、不是 IndexedDB 索引问题、不是事件重复绑定问题。

### 为什么平时不复现

正常路径下 `bankFor()` 返回 240 词，`unique()` 需求最多 10 个，抽中可用词的概率
极高，几次迭代就凑齐。只有**词池被缩到很小**时才会卡住——见下两条触发路径。

## 三、触发路径（两条，均已复现）

### 路径 1：`state.pool === 'wrong'` 且心魔词太少

「单挑」(`onDemonGrid`)、「只练这些词」(`drillWrong`)、「复习令」(`buyItem`)
都会置 `state.pool='wrong'` 后 `ask()` → `looseQuestion()` → `makeQuestion()`。

`bankFor()` 此时**只返回心魔词本身**：

```js
const wrongPool = state.pool==='wrong' ? Object.keys(state.wrong).map(w=>byWord.get(w)).filter(Boolean) : [];
if (wrongPool.length) return wrongPool;   // ← 小池子直接返回
```

实测（现状，无熔断，`WaitForExit(4000)`）：

```
words/2  现状: ✗ 挂死（>4s，卡死）
words/3  现状: ✗ 挂死（>4s，卡死）
words/4  现状: RESULT hang=false bank=4 choices=4 ms=0.4
bank/6   现状: ✗ 挂死（>4s，卡死）
write/6  现状: ✗ 挂死（>4s，卡死）
```

**心魔词 ≤3 个（words 题型）或池子小于题型需求（bank 需 10、write 需 8）即卡死。**

### 路径 2：换词库后 `state.wrong` 与 `byWord` 口径失配（更隐蔽）

- `state.wrong` 存在 localStorage，**全局不随词库隔离**（`load()` 里直接读 `KEY`）；
- `byWord` 在 `applyLexiconWords()` 里**按当前词库重建**。

两者的交集才是 `bankFor` 的真实题池，但 `looseQuestion()` 的空池判定用的是**全局**条目数：

```js
const wrongList = Object.keys(state.wrong);              // 全局：53 条
if (state.pool==='wrong' && !wrongList.length) return {…空态…};   // 非空 → 放行
```

实测：CET-4 下攒了 50 个错词 → 切到小词库 → 只有 3 个能命中：

```
state.wrong 条目 = 53  → looseQuestion 判定：非空，继续出题
与当前词库交集  = 3   → bankFor 实际拿到的题库大小
现状（无熔断）: [✗ 挂死 >5s → 卡死证据]
```

**口径不一致（全局 vs 交集）是这条路径的放大器**：用户在四级攒了大量错词，
切到初中/高中词库后交集骤降，点「单挑」即卡死。

### 已排除的嫌疑（附证据）

| 嫌疑 | 结论 | 依据 |
|---|---|---|
| 心魔数量过多 → DOM 爆炸 | **否** | `renderDemons()` 已 `list.slice(0, 40)`，封顶 40 张卡 |
| IndexedDB 全表扫描无索引 | **否** | `listDemons()` 用 `store.getAll()`，1000 条异步返回不阻塞主线程 |
| 错题本渲染无界 | **否** | `dueQueue(…, 50)` 有 limit，`forecast` 固定 7 天 |
| 渡劫抽题死循环 | **否** | `selectPracticeSet()` 的 `while` 有 `cursor > count*kindList.length + kindList.length` 熔断 |
| 递归 / 栈溢出 | **否** | 调用链 `startDemonRaid → D.list → __tribDebugStart → startSession → loadBank → T.pick` 无递归 |
| 事件重复绑定 | **否** | 心魔网格用委托，`addEventListener` 只注册一次（4572–4578） |

## 四、修复方案

1. **`unique()` 加迭代熔断**（根治卡死）：`continue` 分支外增加按池子规模缩放的
   上限，超限即 `break`，返回已凑到的子集 —— **只加逃生阀，不改任何判定语义**
   （抽中可用词的条件、去重口径、权重全部保持原样）。
2. **`bankFor()` 心魔池加下限**（保题面质量）：心魔池小于出题所需的最小规模时，
   回落全词池，避免熔断后产出 2~3 个选项的劣质题。
3. **保护性上限**（A4 要求）：心魔 > 500 时摘要行给出「心魔过多，建议先清理」提示。
4. **防回归测试**：抽取真实源码 + 1000 心魔场景，断言全部在时限内完成。

## 五、修复前后性能对比

| 场景 | 修复前 | 修复后 |
|---|---|---|
| 心魔池 2 词 / words 题型 | **挂死 >4000 ms（无上限）** | 0.6 ms，返回 2 选项 |
| 心魔池 3 词 / words 题型 | **挂死 >4000 ms（无上限）** | 0.4 ms，返回 3 选项 |
| 心魔池 6 词 / bank 题型 | **挂死 >4000 ms（无上限）** | 0.4 ms（回落全词池后 4 选项） |
| 心魔池 6 词 / write 题型 | **挂死 >4000 ms（无上限）** | 0.4 ms |
| 1000 心魔 + 挑战流程 | 渲染已封顶 40，本身不卡 | 断言 < 2000 ms（回归测试） |

> 「修复前」的 4000 ms 是**外层判定阈值**，真实值为无穷大（循环永不退出）。
