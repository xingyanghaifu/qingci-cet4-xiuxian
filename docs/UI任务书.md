# UI 美化 · 中国传统纹饰 · 商业级标准 —— 任务书

> 本文件是子代理的执行依据。每个批次完成前必须跑全部门禁并提交备份断点。

## 项目背景（必读）

- 仓库：`C:\Users\aa317\Documents\deepseek-harness\default-workspace\qingci-cet4-xiuxian`
- 形态：**单文件 HTML**（`src/index.template.html` → `dist/index.html`），零运行期依赖
- 模板是 **CRLF** 行尾，**绝不整体重写**（会破坏 diff 与 CRLF 约定）
- Node：`E:\node`；npm 用 `node "E:\node\node_modules\npm\bin\npm-cli.js"`
- 当前基线：测试 **1022/1022**，产物 **844.5 KB**，预算上限 950000 B（基线 911318 + 19 KB）

## 12 条硬约束（一条都不能破）

1. 单文件形态（不得拆多页面、不得引外部资源）
2. 零外部依赖（`dependencies` 必须为空）
3. SM-2 / SRS 语义不变
4. ARIA / 焦点环保留（`:focus-visible` 必须可用）
5. 深色默认 + 浅色 / 高对比三主题都必须正常
6. 现有测试全绿
7. 用户数据不丢
8. 词库分片按需加载
9. 体积预算内（< 950000 B）
10. 每层跑 typecheck + build + test
11. 不置 `D1_MULTIPLAYER_ENABLED` / `AI_IMAGE_ENABLED` 为 true
12. 助记覆盖率达标

## 每批次必须执行的验收命令

```powershell
$env:PATH = "E:\node;$env:PATH"
cd <repo>
node "E:\node\node_modules\npm\bin\npm-cli.js" run typecheck
node scripts/build.mjs
node "E:\node\node_modules\npm\bin\npm-cli.js" test
node scripts/audit-constraints.mjs
node "E:\node\node_modules\npm\bin\npm-cli.js" run check:usage:strict
node scripts/verify-gameplay-integration.mjs
node scripts/verify-focus-touch.mjs
node -e "const f=require('fs');console.log(f.statSync('dist/index.html').size)"
```

**全部必须通过**，且体积 < 950000 B。任一失败就修，不要跳过。

## 已有的视觉基础设施（可复用，勿重复实现）

| 设施 | 位置 | 说明 |
|---|---|---|
| `--orn` / `--orn-soft` | 用 `var(--orn, 兜底值)` **就地取** | 纹饰色（不新增 `:root` 块！） |
| 回纹边框 | `.panel::before` / `.shop-card::before` | `repeating-linear-gradient` 方波 |
| 如意角 | `.panel::after` / `.shop-card::after` | 8 段 1px 渐变拼 L 形 |
| 云纹标题 | `.section-label::before` | SVG data-URI 作 mask |
| 滚动条 | 全局 | 轨道透明、滑块悬停显形 |
| 9 个导航 SVG | `#navMenu` 内 `.tabs button > svg.ic` | `viewBox="0 0 24 24"`，stroke 风格 |

## 已知的坑（踩过的，别再踩）

1. **不要新增 `:root{...}` 块** —— 会干扰 `tests/elem-contrast.test.mjs` 的 `blockOf(':root {')` 解析，
   导致「五行文字色全缺失」的**假失败**。用 `var(--x, 兜底值)` 就地取。
2. **CSS 里不能有裸 hex** —— 守卫 `tests/visual-v191.test.mjs` 会报。
   用 `var(--token)` 或 `rgb(0 0 0)`（非 hex 形式）。
3. **改 DOM 结构要检查测试锚点** —— 多个测试用 `html.indexOf('id="xxx"')` 定位面板边界。
   搬移元素前先 `grep` 该 id 在 `tests/` 里的用法。
4. **模板是 CRLF** —— 用 `edit` 工具时若匹配失败，先用 node 脚本按 `\r\n` 处理。
5. **函数插入要保证平级** —— 插入新函数时不要吞掉相邻函数的收尾 `}`，
   否则 esbuild 会静默改名（`fn2`）而调用处不改，运行时 `is not defined`。
6. **事件冒泡** —— `document` 上有「点菜单外部即关闭」的处理器；
   在侧栏按钮里打开菜单必须 `stopPropagation()`。

## 阶段规划

### 批次 1：SVG 修仙按钮（用户明确要求）
- 为 `#panel-map` 与 `#panel-missions` 内的**主要操作按钮**加内联 SVG 图标
- 图标主题：印章 / 云纹 / 剑意 / 丹炉 / 卷轴 / 符箓 —— 与中国传统纹饰一致
- 复用既有 `viewBox="0 0 24 24"` + `stroke="currentColor"` 风格（与导航一致）
- **体积敏感**：每个 SVG 都要精简（path 尽量少），总增 < 8 KB
- ARIA：图标 `aria-hidden="true" focusable="false"`，按钮保留文字标签
- 建议做法：在 `.btn` 内用 `::before` + CSS mask 引用共享 SVG（避免每个按钮重复内联）
  —— 但需实测体积与本主题兼容性；若 mask 方案不达标，退回内联 `<svg>`

### 批次 2：人性化设计（用户反馈「界面很混乱」）
- **降低视觉噪声**：检查 `.panel` 数量、重复边框、纹饰是否过密
- **分组与层次**：主区是否需要二级分组标题
- **按钮层级**：主操作（`.btn.solid`）与次操作（`.btn`）视觉区分是否够
- **空态文案**：未开始时的提示是否清晰

### 批次 3：商业级细节打磨
- 三主题（深/浅/高对比）逐一目视检查
- 移动端（375px）布局检查
- 动效节奏（既有约束：不得 infinite 循环、reduced-motion 退化）

## 交付要求

每批次完成后：
1. 更新 `backups/` 断点（复制 `src/index.template.html`）
2. 提交（commit message 说明改了什么、为什么、如何验证）
3. 部署 + 验证线上指纹
4. 在回复里报告：改了什么、门禁结果、体积、截图路径

## 禁止事项

- 不得删除任何非任务所需的文件
- 不得拆分多页面
- 不得引入外部依赖 / CDN / 图片文件
- 不得改动经济数值平衡（需人工确认）
- 不得改动 SM-2 语义
