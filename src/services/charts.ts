/**
 * 轻量 SVG 图表（P1 任务 B）
 *
 * 为什么不引入 Chart.js / ECharts：
 *   - 本项目的交付形态是「单文件 HTML + 运行时零依赖」，体积预算 < 100 KB 增量；
 *     ECharts 压缩后约 1 MB、Chart.js 约 200 KB（未 gzip），都会直接破坏这个约束；
 *   - 报告需要的图形很有限（条形、折线、环形、热力网格），手写 SVG 只需几 KB，
 *     还能直接复用应用的 CSS 变量（深浅色主题自动跟随）。
 *
 * 所有函数都是**纯函数**：输入数据 → 返回 SVG 字符串，便于测试与内联。
 */

export interface ChartItem {
  label: string;
  value: number;
  /** 0–1，用于着色的比例（如正确率） */
  ratio?: number;
  hint?: string;
}

const escapeXml = (text: unknown): string => String(text ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
));

const pct = (n: number): string => `${Math.round(n * 1000) / 10}%`;

/** 横向条形图（各题型得分率 / 正确率） */
export function barChart(items: ChartItem[], options: { width?: number; rowHeight?: number; max?: number } = {}): string {
  const width = options.width ?? 320;
  const rowHeight = options.rowHeight ?? 26;
  const max = options.max ?? Math.max(1, ...items.map((i) => i.value));
  const labelW = 84;
  const barW = width - labelW - 46;
  const height = Math.max(rowHeight, items.length * rowHeight + 6);

  const rows = items.map((item, i) => {
    const y = i * rowHeight + 4;
    const w = Math.max(2, (item.value / max) * barW);
    const ratio = item.ratio ?? item.value / max;
    const tone = ratio >= 0.8 ? 'good' : ratio >= 0.6 ? 'mid' : 'bad';
    return `<g class="chart-row">`
      + `<text x="0" y="${y + 14}" class="chart-label">${escapeXml(item.label)}</text>`
      + `<rect x="${labelW}" y="${y + 4}" width="${barW}" height="12" rx="6" class="chart-track"/>`
      + `<rect x="${labelW}" y="${y + 4}" width="${w.toFixed(1)}" height="12" rx="6" class="chart-bar ${tone}"/>`
      + `<text x="${width - 4}" y="${y + 14}" class="chart-value" text-anchor="end">${escapeXml(item.hint ?? pct(ratio))}</text>`
      + `</g>`;
  }).join('');

  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="条形图">${rows}</svg>`;
}

/** 折线图（正确率趋势） */
export function lineChart(points: Array<{ label: string; value: number }>, options: { width?: number; height?: number; max?: number } = {}): string {
  const width = options.width ?? 320;
  const height = options.height ?? 96;
  const max = options.max ?? 1;
  const padX = 10;
  const padY = 12;
  if (!points.length) return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="趋势图（暂无数据）"></svg>`;

  const stepX = points.length > 1 ? (width - padX * 2) / (points.length - 1) : 0;
  const coords = points.map((p, i) => {
    const x = padX + i * stepX;
    const y = height - padY - Math.max(0, Math.min(1, p.value / max)) * (height - padY * 2);
    return { x, y, ...p };
  });
  const line = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const area = `${line} L${coords[coords.length - 1].x.toFixed(1)},${height - padY} L${coords[0].x.toFixed(1)},${height - padY} Z`;
  const dots = coords.map((c) => `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="2.6" class="chart-dot"><title>${escapeXml(c.label)}：${pct(c.value)}</title></circle>`).join('');
  const labels = coords.map((c, i) => (i % 2 === 0 || i === coords.length - 1
    ? `<text x="${c.x.toFixed(1)}" y="${height - 1}" class="chart-axis" text-anchor="middle">${escapeXml(c.label)}</text>`
    : '')).join('');

  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="折线图">`
    + `<path d="${area}" class="chart-area"/>`
    + `<path d="${line}" class="chart-line"/>`
    + dots + labels
    + `</svg>`;
}

/** 环形进度（掌握度 / 得分率） */
export function ringChart(ratio: number, options: { size?: number; label?: string } = {}): string {
  const size = options.size ?? 96;
  const r = size / 2 - 8;
  const circumference = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, ratio));
  const dash = circumference * clamped;
  return `<svg class="chart-ring" viewBox="0 0 ${size} ${size}" role="img" aria-label="${escapeXml(options.label || '占比')} ${pct(clamped)}">`
    + `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="chart-ring-bg"/>`
    + `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="chart-ring-fg" `
    + `stroke-dasharray="${dash.toFixed(1)} ${(circumference - dash).toFixed(1)}" `
    + `transform="rotate(-90 ${size / 2} ${size / 2})"/>`
    + `<text x="${size / 2}" y="${size / 2 + 5}" text-anchor="middle" class="chart-ring-text">${pct(clamped)}</text>`
    + `</svg>`;
}

/** 热力网格（近 N 日学习量，适配学习计划） */
export function heatmapGrid(cells: Array<{ date: string; count: number; level: number }>, options: { columns?: number; cell?: number } = {}): string {
  const columns = options.columns ?? 14;
  const cell = options.cell ?? 14;
  const gap = 3;
  const rows = Math.ceil(cells.length / columns) || 1;
  const width = columns * (cell + gap);
  const height = rows * (cell + gap);
  const rects = cells.map((c, i) => {
    const x = (i % columns) * (cell + gap);
    const y = Math.floor(i / columns) * (cell + gap);
    return `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3" class="heat heat-${c.level}">`
      + `<title>${escapeXml(c.date)}：${c.count} 题</title></rect>`;
  }).join('');
  return `<svg class="chart-heat" viewBox="0 0 ${width} ${height}" role="img" aria-label="学习热力图">${rects}</svg>`;
}

/** 图表所需的样式（内联进 <style>，复用主题变量） */
export const CHART_CSS = `
.chart{width:100%;height:auto;display:block}
.chart-label{font-size:11px;fill:var(--muted)}
.chart-value{font-size:11px;fill:var(--soft)}
.chart-axis{font-size:9px;fill:var(--muted)}
.chart-track{fill:var(--bg2)}
.chart-bar.good{fill:var(--ok)}
.chart-bar.mid{fill:var(--gold)}
.chart-bar.bad{fill:var(--bad)}
.chart-line{fill:none;stroke:var(--jade);stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.chart-area{fill:var(--jade);opacity:.14}
.chart-dot{fill:var(--jade)}
.chart-ring-bg{fill:none;stroke:var(--bg2);stroke-width:8}
.chart-ring-fg{fill:none;stroke:var(--jade);stroke-width:8;stroke-linecap:round}
.chart-ring-text{font-size:15px;font-weight:700;fill:var(--ink)}
.chart-heat .heat{fill:var(--bg2)}
.chart-heat .heat-1{fill:color-mix(in srgb,var(--jade) 25%,var(--bg2))}
.chart-heat .heat-2{fill:color-mix(in srgb,var(--jade) 45%,var(--bg2))}
.chart-heat .heat-3{fill:color-mix(in srgb,var(--jade) 70%,var(--bg2))}
.chart-heat .heat-4{fill:var(--jade)}
`;
