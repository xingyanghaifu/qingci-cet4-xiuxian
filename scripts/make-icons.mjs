#!/usr/bin/env node
/**
 * 图标生成器：零依赖生成 PWA 所需的 PNG 图标
 *
 * 为什么自己写 PNG 编码：项目坚持运行时/构建期零额外依赖（esbuild、typescript 之外），
 * 图标是几何图形，用 zlib + 手写 PNG chunk 即可确定性生成，避免引入 canvas / sharp 等原生依赖。
 *
 * 产出（默认写到 dist/icons/）：
 *   icon-192.png / icon-512.png              —— purpose: any
 *   icon-192-maskable.png / icon-512-maskable.png —— purpose: maskable（内容收在中心安全区内）
 *
 * 设计：深色底 + 金色掌握度环（留缺口表示进度）+ 米色山峦（修仙意象）。
 */
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// —— 调色板（与 src/index.template.html 的 CSS 变量保持一致）——
const BG_TOP = [18, 16, 14];     // --bg (dark)
const BG_BOTTOM = [33, 27, 22];  // --card (dark)
const GOLD = [239, 201, 138];
const PAPER = [246, 236, 223];
const JADE = [142, 216, 189];

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/** 把 RGBA 像素数组编码为 PNG Buffer */
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));

/** 画一个图标；scale < 1 时把图形收进中心（maskable 安全区） */
function drawIcon(size, { scale = 1, round = true } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const S = size * scale;            // 图形基准尺寸
  const ringR = S * 0.30;            // 掌握度环半径
  const ringW = Math.max(2, S * 0.055);
  const ringStart = -Math.PI / 2;    // 12 点方向起笔
  const ringSweep = Math.PI * 1.55;  // 约 78% 进度，留缺口
  const peaks = [
    { x: cx - S * 0.20, w: S * 0.22, h: S * 0.20 },
    { x: cx + S * 0.02, w: S * 0.26, h: S * 0.27 },
    { x: cx + S * 0.24, w: S * 0.18, h: S * 0.16 },
  ];
  const baseY = cy + S * 0.30;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      // 1) 背景：纵向渐变；round=true 时四角做圆角裁切
      let color = mix(BG_TOP, BG_BOTTOM, y / (size - 1));
      let alpha = 255;
      if (round) {
        const r = size * 0.22;
        const dx = Math.max(r - x, 0, x - (size - 1 - r));
        const dy = Math.max(r - y, 0, y - (size - 1 - r));
        if (dx > 0 && dy > 0) {
          const d = Math.hypot(dx, dy);
          if (d > r) alpha = 0;
          else if (d > r - 1.5) alpha = Math.round(255 * (r - d) / 1.5);
        }
      }

      // 2) 山峦（米色，带一点渐变）
      for (const p of peaks) {
        const halfW = p.w / 2;
        const left = p.x - halfW;
        const right = p.x + halfW;
        if (x >= left && x <= right) {
          const t = 1 - Math.abs((x - p.x) / halfW);      // 0 边缘 → 1 峰顶
          const topY = baseY - p.h * t;
          if (y >= topY && y <= baseY) {
            const shade = 0.75 + 0.25 * t;
            color = mix(color, PAPER, shade);
          }
        }
      }

      // 3) 掌握度环（金色，缺口表示未掌握部分）
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const dist = Math.hypot(dx, dy);
      if (Math.abs(dist - ringR) <= ringW / 2) {
        let ang = Math.atan2(dy, dx) - ringStart;
        ang = ((ang % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        if (ang <= ringSweep) {
          const edge = 1 - Math.abs(dist - ringR) / (ringW / 2);
          color = mix(color, GOLD, Math.min(1, 0.35 + edge * 0.75));
        }
      }

      // 4) 环末端的小玉点（进度端点）
      const endAng = ringStart + ringSweep;
      const ex = cx + Math.cos(endAng) * ringR;
      const ey = cy + Math.sin(endAng) * ringR;
      const dotR = ringW * 0.72;
      if (Math.hypot(x + 0.5 - ex, y + 0.5 - ey) <= dotR) color = mix(color, JADE, 0.95);

      rgba[i] = clamp255(color[0]);
      rgba[i + 1] = clamp255(color[1]);
      rgba[i + 2] = clamp255(color[2]);
      rgba[i + 3] = alpha;
    }
  }
  return encodePng(size, size, rgba);
}

/** 生成全部图标到 outDir，返回产出清单 */
export function makeIcons(outDir) {
  const dir = path.join(outDir, 'icons');
  fs.mkdirSync(dir, { recursive: true });
  const targets = [
    { file: 'icon-192.png', size: 192, scale: 1, round: true },
    { file: 'icon-512.png', size: 512, scale: 1, round: true },
    { file: 'icon-192-maskable.png', size: 192, scale: 0.72, round: false },
    { file: 'icon-512-maskable.png', size: 512, scale: 0.72, round: false },
  ];
  const out = [];
  for (const t of targets) {
    const buf = drawIcon(t.size, { scale: t.scale, round: t.round });
    const file = path.join(dir, t.file);
    fs.writeFileSync(file, buf);
    out.push({ file: 'icons/' + t.file, bytes: buf.length });
  }
  return out;
}

// 直接运行时（node scripts/make-icons.mjs [outDir]）写入 dist/icons
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const outDir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'dist');
  const files = makeIcons(outDir);
  console.log('🎨 图标已生成到 ' + path.relative(ROOT, outDir) + '/icons');
  for (const f of files) console.log('   ' + f.file.padEnd(30) + (f.bytes / 1024).toFixed(1) + ' KB');
}
