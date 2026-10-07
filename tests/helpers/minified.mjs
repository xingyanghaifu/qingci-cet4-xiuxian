/**
 * 测试辅助：在**压缩过的产物**上做源码片段断言
 *
 * 背景：`scripts/build.mjs` 现在会对内联 `<script>` 做「去注释 + 压空白 + 语法简化」
 * （不开 minifyIdentifiers）。这会改变源码的**文本形态**：
 *   · 空白消失：   `action.type === 'answer'`  →  `action.type==="answer"`
 *   · 引号统一：   `name:'考研英语'`            →  `name:"考研英语"`
 *   · 布尔字面量： `{ preventScroll: true }`    →  `{preventScroll:!0}`
 *
 * 于是「断言产物里含某个带空格的源码片段」这类测试会失败 —— 但**产品完全正常**。
 * 这类断言测的其实是「源码格式」，不是「功能是否存在」。
 *
 * 本 helper 提供正确的做法：把待查片段转成**容忍空白/引号/布尔简写**的正则。
 *
 * 用法：
 *   import { hasCode, codeRe } from './helpers/minified.mjs';
 *   assert.ok(hasCode(dist, "action.type === 'answer'"), '…');
 *   assert.ok(hasCode(dist, 'promptEl.focus({ preventScroll: true })'), '…');
 *
 * 注意：**只在产物上用它**。对 `src/index.template.html` 的断言应继续用字面
 * includes（源文件未压缩，字面匹配更严格、更早发现问题）。
 */

/** 正则元字符转义 */
function esc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 把一段源码片段转成容忍压缩的正则。
 * 处理：任意空白 → `\s*`；单/双引号 → `['"]`；`true/false` → `!0/!1` 亦可。
 */
export function codeRe(snippet) {
  let out = '';
  for (let i = 0; i < snippet.length; i++) {
    const ch = snippet[i];
    // 连续空白 → \s*
    if (/\s/.test(ch)) {
      while (i + 1 < snippet.length && /\s/.test(snippet[i + 1])) i++;
      out += '\\s*';
      continue;
    }
    // 引号 → 任意引号
    if (ch === "'" || ch === '"') {
      out += '[\'"]';
      continue;
    }
    out += esc(ch);
  }
  // 布尔简写：允许 true → !0、false → !1
  out = out
    .replace(/true/g, '(?:true|!0)')
    .replace(/false/g, '(?:false|!1)');
  return new RegExp(out);
}

/** 产物里是否存在语义等价的代码片段 */
export function hasCode(text, snippet) {
  return codeRe(snippet).test(text);
}

/**
 * 断言辅助：产物里必须有该代码片段（语义等价）
 * 失败信息会同时给出「字面匹配」与「宽松匹配」结果，便于定位。
 */
export function assertCode(text, snippet, message) {
  if (hasCode(text, snippet)) return;
  const literal = text.includes(snippet);
  throw new Error(
    (message || '产物缺少代码片段') + `\n  片段: ${snippet}` +
    `\n  字面匹配: ${literal}（压缩产物通常为 false，属正常）` +
    `\n  宽松匹配: false（这才是真缺失）`,
  );
}
