#!/usr/bin/env node
/**
 * add-snake-labels.js
 *
 * 给 Platane/snk 生成的贪吃蛇 SVG 补上「年 / 月 / 周」标签，
 * 布局规则与 GitHub 原生的贡献日历完全一致：
 *
 *  - 网格：53 列（每列一周，周日开头），最后一列 = 当前周；
 *    网格起点 = 当前周周日 - 364 天（GitHub “最近一年” 的范围）。
 *  - 月标签：某月的标签从「该月第一个完整周」所在列开始，
 *    到「包含该月最后一天的那一周」所在列结束，文字居中（colspan 效果）。
 *    （该规则已对照 GitHub 实际渲染的日历逐月验证）
 *  - 周标签：左侧 7 行（日 一 二 三 四 五 六，顶部为周日）。
 *  - 年标签：网格覆盖的年份，跨年时显示 "2025-2026"。
 *
 * 用法：
 *   node scripts/add-snake-labels.js [dist目录]
 * 会原地更新 dist 目录下所有 github-contribution-grid-snake*.svg，
 * 文件名含 "dark" 的使用暗色主题标签色，其余使用亮色标签色。
 */

const fs = require('fs');
const path = require('path');

const DAY = 86400000;
const distDir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist'));

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const MONTHS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

// ---------- 日期工具（UTC） ----------
function utcDay(d) {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
function fmtDate(t) {
  const d = new Date(t);
  return d.toISOString().slice(0, 10);
}

// ---------- 解析 SVG 网格几何 ----------
function parseGrid(svg) {
  const xs = new Set();
  const ys = new Set();
  const tagRe = /<rect\b[^>]*class="c[^"]*"[^>]*\/?>/g;
  let tag;
  while ((tag = tagRe.exec(svg)) !== null) {
    const t = tag[0];
    const xm = t.match(/\bx="([\d.]+)"/);
    const ym = t.match(/\by="([\d.]+)"/);
    if (xm && ym) {
      xs.add(parseFloat(xm[1]));
      ys.add(parseFloat(ym[1]));
    }
  }
  const cols = [...xs].sort((a, b) => a - b);
  const rows = [...ys].sort((a, b) => a - b);
  if (cols.length < 2 || rows.length < 2) {
    throw new Error('未能从 SVG 中解析出网格（请确认 SVG 由 Platane/snk@v3 生成）');
  }
  const cell = cols[1] - cols[0];
  return {
    cols: cols.length,
    rows: rows.length,
    cell,
    gridX: cols[0],
    gridY: rows[0],
  };
}

// ---------- 计算与 GitHub 一致的月标签跨度 ----------
// 返回 [{ text, startCol, endCol }]
function monthSpans(gridStart, cols, today) {
  const spans = [];
  const gy = new Date(gridStart).getUTCFullYear();
  const gm = new Date(gridStart).getUTCMonth();
  const ty = today.getUTCFullYear();
  const tm = today.getUTCMonth();

  let y = gy;
  let m = gm;
  let guard = 0;
  while (y < ty || (y === ty && m <= tm)) {
    if (++guard > 24) break;
    const first = Date.UTC(y, m, 1);
    const last = Date.UTC(y, m + 1, 0); // 当月最后一天
    const dow = new Date(first).getUTCDay();
    // 该月第一个完整周（周日）起点
    const firstFull = first + ((7 - dow) % 7) * DAY;
    const startCol = Math.round((firstFull - gridStart) / 7 / DAY);
    // 包含该月最后一天的那一周
    const endCol = Math.floor((last - gridStart) / 7 / DAY);

    const s = Math.max(0, startCol);
    const e = Math.min(cols - 1, endCol);
    if (e >= s) {
      spans.push({ text: MONTHS[m], startCol: s, endCol: e });
    }
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return spans;
}

// ---------- 注入标签 ----------
function addLabels(svg, { dark, today }) {
  const grid = parseGrid(svg);
  const { cols, cell, gridX } = grid;

  const now = utcDay(today);
  const lastSunday = now - today.getUTCDay() * DAY; // 当前周的周日
  const gridStart = lastSunday - (cols - 1) * 7 * DAY;

  const color = dark ? '#8b949e' : '#57606a';
  const spans = monthSpans(gridStart, cols, today);
  const y1 = new Date(gridStart).getUTCFullYear();
  const y2 = today.getUTCFullYear();
  const yearText = y1 === y2 ? String(y1) : `${y1}-${y2}`;

  let labels = '';
  // 年
  labels += `<text x="${gridX}" y="-40" font-size="11" font-weight="600">${yearText}</text>\n  `;
  // 月
  for (const sp of spans) {
    const cx = gridX + sp.startCol * cell + ((sp.endCol - sp.startCol + 1) * cell) / 2;
    labels += `<text x="${cx.toFixed(1)}" y="-18" font-size="12" text-anchor="middle">${sp.text}</text>\n  `;
  }
  // 周（7 行，顶部为周日）
  for (let r = 0; r < 7; r += 1) {
    const cy = grid.gridY + r * cell + cell / 2 + 3.5;
    labels += `<text x="-8" y="${cy.toFixed(1)}" font-size="10" text-anchor="end">${WEEKDAYS[r]}</text>\n  `;
  }

  const labelGroup =
    `<g id="calendar-labels" fill="${color}" ` +
    `font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif">\n  ` +
    labels +
    `</g>`;

  // 插入到 <svg ...> 之后
  const svgTagStart = svg.search(/<svg[^>]*>/);
  if (svgTagStart === -1) throw new Error('找不到 <svg> 标签');
  const cleanSvg = svg.slice(svgTagStart);
  let out = cleanSvg.replace(/<svg[^>]*>/, (tag) => `${tag}\n${labelGroup}`);

  // 扩展 viewBox：左侧 -24、顶部 -56，保证年月周标签不被裁剪
  let newViewBox = null;
  out = out.replace(/viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/, (all, minX, minY, w, h) => {
    const maxX = parseFloat(minX) + parseFloat(w);
    const maxY = parseFloat(minY) + parseFloat(h);
    const newMinX = -24;
    const newMinY = -56;
    const nw = (maxX - newMinX).toFixed(0);
    const nh = (maxY - newMinY).toFixed(0);
    newViewBox = { w: nw, h: nh };
    return `viewBox="${newMinX} ${newMinY} ${nw} ${nh}"`;
  });
  if (newViewBox) {
    out = out.replace(/width="[\d.]+" height="[\d.]+"/, `width="${newViewBox.w}" height="${newViewBox.h}"`);
  }

  // 防御：截掉 </svg> 之后可能存在的杂质
  const endIdx = out.lastIndexOf('</svg>');
  if (endIdx !== -1) out = out.slice(0, endIdx + 6);

  return {
    svg: out,
    meta: { cols, cell, gridX, gridStart: fmtDate(gridStart), lastSunday: fmtDate(lastSunday), yearText, spans },
  };
}

// ---------- 主流程 ----------
function main() {
  const files = fs.readdirSync(distDir).filter((f) => /github-contribution-grid-snake.*\.svg$/.test(f));
  if (files.length === 0) {
    console.error(`[add-snake-labels] dist 目录中没有找到贪吃蛇 SVG（${distDir}）`);
    process.exit(1);
  }
  const today = new Date();
  for (const file of files) {
    const filePath = path.join(distDir, file);
    const dark = /dark/i.test(file);
    const svg = fs.readFileSync(filePath, 'utf8');
    const { svg: out, meta } = addLabels(svg, { dark, today });
    fs.writeFileSync(filePath, out);
    console.log(
      `[add-snake-labels] ${file}: ${meta.cols} 列, 起点 ${meta.gridStart}, 年标签 "${meta.yearText}", 月份 [${meta.spans
        .map((s) => `${s.text}@${s.startCol}-${s.endCol}`)
        .join(', ')}]`
    );
  }
}

main();
