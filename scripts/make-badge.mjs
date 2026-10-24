#!/usr/bin/env node
/**
 * 麦门工牌 · 工牌卡片渲染脚本（纯 SVG，零依赖）
 *
 * 用法:
 *   node scripts/make-badge.mjs stats.json -o output/麦门工牌   # 读取统计 JSON，输出 .svg + .html
 *   node scripts/make-badge.mjs --demo -o output/demo           # 用内置示例数据生成演示卡
 *
 * 输出:
 *   <out>.svg   矢量卡片（可直接发社交平台）
 *   <out>.html  网页版（浏览器打开，点按钮一键存 PNG）
 *
 * 数据口径: stats.json 由 collect-stats.mjs 生成（最近 10 笔订单 + 实时积分）。
 * verdict 字段建议由 AI 润色成毒舌但善意的一句话（详见 SKILL.md）。
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------- 示例数据（仓库演示用，非真实个人数据） ----------
export const DEMO_STATS = {
  schema: 'mcd-badge/stats@1',
  generatedAt: '2026-10-24T12:00:00.000Z',
  nickname: '麦小门',
  employeeId: 'MM-1024',
  position: '高级薯条架构师',
  positionLevel: 'S3 · 资深干饭级',
  skills: ['薯条带宽优化', '咖啡因驱动', '汉堡高吞吐', '0元购大师', '全栈干饭'],
  verdict: '巨无霸重度依赖型选手——汉堡吞吐常年拉满，薯条带宽从不降速。综合评审：干饭性能达标，唯一 bug 是优惠券包永远比代码先优化。',
  kpi: { orders: 42, spent: 996, avg: 23.7, points: 1024, couponCount: 8 },
  department: '汉堡交付事业部',
  favoriteItem: '巨无霸',
  topItems: [{ name: '巨无霸', count: 18 }, { name: '原味板烧鸡腿堡', count: 12 }, { name: '薯条', count: 16 }],
  favoriteStore: '麦门总部旗舰餐厅',
  storeCount: 6,
  joinDate: '2024-03-14',
  lastPunch: '2026-10-23',
  timeBuckets: { morning: 12, lunch: 18, afternoon: 6, dinner: 6, night: 0 },
  morningRatio: 0.29,
  zeroOrderCount: 1,
  dataSource: '示例数据（demo）',
};

// ---------- 工具 ----------
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cjkLen = s => [...String(s ?? '')].reduce((n, ch) => n + (ch.charCodeAt(0) > 0x2e00 ? 1 : 0.55), 0);
function wrapText(text, maxUnits, maxLines = 2) {
  const lines = [];
  let cur = '', curLen = 0;
  for (const ch of String(text ?? '')) {
    const w = ch.charCodeAt(0) > 0x2e00 ? 1 : 0.55;
    if (curLen + w > maxUnits && cur) { lines.push(cur); cur = ch; curLen = w; }
    else { cur += ch; curLen += w; }
    if (lines.length === maxLines) { lines[maxLines - 1] += '…'; return lines; }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** 部门按常点品类推导（全球通用，不绑定任何具体门店/城市）；与 collect-stats.mjs 的规则保持一致 */
function departmentOf(favoriteItemName, { zeroOrderCount } = {}) {
  if (zeroOrderCount > 0) return '薅羊毛特别行动组';
  const name = String(favoriteItemName || '');
  if (/麦满分|板烧|堡/.test(name)) return '汉堡交付事业部';
  if (/咖啡|拿铁|鲜萃|美式/.test(name)) return '咖啡因动力研究所';
  if (/麦乐鸡|麦香鸡|鸡翅|鸡腿/.test(name)) return '炸鸡渲染引擎组';
  if (/薯|鸡块/.test(name)) return '碳水架构部';
  if (/可乐|麦炫酷|柠檬|气泡/.test(name)) return '气泡基础设施部';
  if (/圣代|新地|圆筒/.test(name)) return '甜品缓存办公室';
  return '全栈干饭事业部';
}

function barcodeBars(seed, x, y, width, height) {
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const widths = [2, 1, 3, 1, 2, 4, 1, 2, 1, 3, 2, 1];
  const bars = [];
  let cx = x, i = 0;
  while (cx < x + width && i < 60) {
    const w = widths[(h + i * 7) % widths.length];
    if (i % 2 === 0) bars.push(`<rect x="${cx.toFixed(1)}" y="${y}" width="${w}" height="${height}" fill="#2B2118"/>`);
    cx += w + 1.6; i++;
  }
  return bars.join('');
}

/** 金色拱门（双拱 M）path，画在 100 宽 × 80 高的框内 */
const ARCHES_PATH = 'M 8 78 Q 30 2 52 78 Q 74 2 96 78';

// ---------- 渲染 ----------
export function renderBadge(stats) {
  const s = stats || {};
  const W = 1120, H = 700;
  const cardX = 60, cardY = 44, cardW = 1000, cardH = 612;
  const headH = 92;
  const RX = 336;                       // 右列起始 x
  const RW = cardX + cardW - 34 - RX;   // 右列宽度 = 690
  const footY = cardY + cardH - 42;     // 页脚顶 = 614

  const nickname = esc(s.nickname || '麦友');
  const employeeId = esc(s.employeeId || 'MM-1024');
  const position = esc(s.position || '实习干饭生');
  const level = esc(s.positionLevel || 'S1 · 实习干饭级');
  const department = esc(s.department || departmentOf(s.favoriteItem, { zeroOrderCount: s.zeroOrderCount || 0 }));
  const joinDate = esc(s.joinDate || '——');
  const favoriteStore = esc(s.favoriteStore || '麦门任意门店');
  const kpi = s.kpi || {};
  const ordersText = String(kpi.orders ?? 0);
  const spentText = (kpi.spent != null) ? `¥${kpi.spent}` : '—';
  const pointsText = (kpi.points != null) ? String(kpi.points) : '—';
  const skills = (s.skills && s.skills.length ? s.skills : ['全栈干饭']).slice(0, 5);
  const verdictLines = wrapText(s.verdict || '干饭性能达标，继续保持。', 36, 2);

  const svg = [];
  const P = (...rows) => svg.push(rows.join('\n'));

  P(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="'PingFang SC','Microsoft YaHei','Noto Sans SC',sans-serif">`);
  P(`<defs>
  <linearGradient id="redband" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#E03A26"/><stop offset="1" stop-color="#B72012"/></linearGradient>
  <radialGradient id="avat" cx="0.35" cy="0.3" r="1"><stop offset="0" stop-color="#E8402C"/><stop offset="1" stop-color="#C21E10"/></radialGradient>
  <filter id="cardshadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#8A6B3A" flood-opacity="0.28"/></filter>
  <pattern id="dots" width="26" height="26" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.6" fill="#E2D4BC"/></pattern>
  <clipPath id="cardclip"><rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="26"/></clipPath>
</defs>`);
  // 背景
  P(`<rect width="${W}" height="${H}" fill="#F5EDDE"/>`,
    `<rect width="${W}" height="${H}" fill="url(#dots)"/>`);

  // ===== 卡片底 + 红带头（先画底，再画内容） =====
  P(`<g filter="url(#cardshadow)"><rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="26" fill="#FFFFFF" stroke="#EADFCE"/></g>`);
  P(`<g clip-path="url(#cardclip)">`);
  P(`<rect x="${cardX}" y="${cardY}" width="${cardW}" height="${headH}" fill="url(#redband)"/>`);
  P(`<g transform="translate(${cardX + 34},${cardY + 46})">
  <path d="${ARCHES_PATH}" transform="translate(0,-34) scale(0.42)" fill="none" stroke="#FFC72C" stroke-width="22" stroke-linecap="round"/>
  <text x="34" y="10" font-size="26" font-weight="800" fill="#FFFFFF" letter-spacing="3">MAIMEN TECH</text>
  <rect x="252" y="-14" width="1.5" height="30" fill="#FFFFFF" opacity="0.45"/>
  <text x="268" y="10" font-size="26" font-weight="800" fill="#FFFFFF" letter-spacing="6">麦门工牌</text>
</g>`,
    `<rect x="${cardX + cardW - 252}" y="${cardY + 30}" width="218" height="32" rx="16" fill="#FFC72C"/>`,
    `<text x="${cardX + cardW - 143}" y="${cardY + 51}" font-size="15" font-weight="700" fill="#5B3A00" text-anchor="middle">1024 程序员节 · 特别版</text>`,
    `<rect x="${cardX}" y="${cardY + headH}" width="${cardW}" height="5" fill="#FFC72C"/>`,
    `<rect x="${cardX}" y="${cardY + headH + 8}" width="${cardW}" height="1.5" fill="#F0C244" opacity="0.7"/>`);

  // ===== 左列（固定坐标，不随右列伸缩） =====
  const avCX = cardX + 148, avCY = cardY + headH + 116;
  P(`<circle cx="${avCX}" cy="${avCY}" r="76" fill="url(#avat)" stroke="#FFC72C" stroke-width="5"/>`,
    `<path d="${ARCHES_PATH}" transform="translate(${avCX - 52},${avCY - 46}) scale(1.04)" fill="none" stroke="#FFC72C" stroke-width="17" stroke-linecap="round"/>`,
    `<text x="${avCX}" y="${avCY + 122}" font-size="27" font-weight="800" fill="#2B2118" text-anchor="middle">${nickname}</text>`,
    `<rect x="${avCX - 76}" y="${avCY + 138}" width="152" height="26" rx="13" fill="#FFF3D6" stroke="#E9C96A"/>`,
    `<text x="${avCX}" y="${avCY + 156}" font-size="13.5" font-weight="700" fill="#8A6410" text-anchor="middle">${level}</text>`);
  P(barcodeBars(employeeId, cardX + 48, footY - 118, 200, 46),
    `<text x="${cardX + 148}" y="${footY - 52}" font-size="15" font-weight="600" fill="#6B5A44" text-anchor="middle" font-family="'Consolas','Courier New',monospace" letter-spacing="3">${employeeId}</text>`);

  // ===== 右列（游标式布局） =====

  let y = cardY + headH + 36; // 游标起点 = 172

  // -- 职位 --
  P(`<text x="${RX}" y="${y}" font-size="13" fill="#9A8A70" letter-spacing="2">职位 / POSITION</text>`);
  y += 34;
  P(`<text x="${RX}" y="${y}" font-size="31" font-weight="800" fill="#C21E10">${position}</text>`);
  y += 22;
  P(`<line x1="${RX}" y1="${y}" x2="${RX + RW}" y2="${y}" stroke="#F0E7D6"/>`);

  // -- 信息格 2×2 --
  y += 26;
  const colW = RW / 2;
  const cell = (x, ly, label, value) =>
    `<text x="${x}" y="${ly}" font-size="12.5" fill="#9A8A70" letter-spacing="1">${label}</text>\n` +
    `<text x="${x}" y="${ly + 26}" font-size="17.5" font-weight="700" fill="#33291B">${value}</text>`;
  P(cell(RX, y, '工号 / EMPLOYEE ID', employeeId),
    cell(RX + colW, y, '部门 / DEPT', department));
  y += 48;
  P(cell(RX, y, '入职时间 / JOIN', joinDate),
    cell(RX + colW, y, '常去据点 / HOME STORE', favoriteStore));
  y += 32;
  P(`<line x1="${RX}" y1="${y}" x2="${RX + RW}" y2="${y}" stroke="#F0E7D6"/>`);

  // -- KPI 三格 --
  y += 20;
  const kpiY = y, kpiH = 82, kw = (RW - 24) / 3;
  const kpiBox = (x, num, unit, label) =>
    `<g><rect x="${x}" y="${kpiY}" width="${kw}" height="${kpiH}" rx="14" fill="#FFF8EA" stroke="#F0E2C6"/>` +
    `<text x="${x + 18}" y="${kpiY + 36}" font-size="25" font-weight="800" fill="#C21E10">${num}<tspan font-size="13" fill="#9A8A70" font-weight="600" dx="4">${unit}</tspan></text>` +
    `<text x="${x + 18}" y="${kpiY + 62}" font-size="12.5" fill="#9A8A70">${label}</text></g>`;
  P(kpiBox(RX, ordersText, '单', '近期订单（最近10笔）'),
    kpiBox(RX + kw + 12, spentText, '', '累计消费'),
    kpiBox(RX + (kw + 12) * 2, pointsText, '分', '麦享会积分'));
  y += kpiH + 16;

  // -- 技能 chips --
  P(`<text x="${RX}" y="${y}" font-size="12.5" fill="#9A8A70" letter-spacing="1">技能栈 / SKILLS</text>`);
  y += 10;
  let row = 0, cx = RX;
  for (const sk of skills) {
    const w = cjkLen(sk) * 14 + 26;
    if (cx + w > RX + RW) { row++; cx = RX; }
    const cy = y + row * 36;
    P(`<g><rect x="${cx}" y="${cy}" width="${w}" height="29" rx="14.5" fill="#FFF3D6" stroke="#E9C96A"/>`,
      `<text x="${cx + w / 2}" y="${cy + 20}" font-size="13.5" font-weight="600" fill="#6B4E0E" text-anchor="middle">${esc(sk)}</text></g>`);
    cx += w + 10;
  }
  y += (row + 1) * 36 + 8;

  // -- 年度鉴定 --
  const vLines = verdictLines.length;
  const verdictH = 34 + vLines * 23 + 10;
  P(`<rect x="${RX}" y="${y}" width="${RW}" height="${verdictH}" rx="14" fill="#FFF6E3" stroke="#F0DFAE"/>`,
    `<text x="${RX + 16}" y="${y + 28}" font-size="20" font-weight="800" fill="#D9A400">「</text>`,
    `<text x="${RX + 42}" y="${y + 24}" font-size="12.5" fill="#B08A2E" letter-spacing="1">年度鉴定 / ANNUAL REVIEW</text>`);
  verdictLines.forEach((ln, i) => {
    P(`<text x="${RX + 18}" y="${y + 46 + i * 23}" font-size="14.5" fill="#4A3C28">${esc(ln)}</text>`);
  });
  y += verdictH;

  // -- 页脚 --
  P(`<rect x="${cardX}" y="${footY}" width="${cardW}" height="42" fill="#FBF5E9"/>`,
    `<text x="${cardX + 24}" y="${footY + 27}" font-size="12" fill="#A08F74">${esc(s.dataSource || '数据来源：麦当劳官方 MCP')} · 仅供娱乐</text>`,
    `<text x="${cardX + cardW - 24}" y="${footY + 27}" font-size="12" fill="#A08F74" text-anchor="end">非官方周边 · MAI MEN TECH</text>`);
  P(`</g></svg>`);
  return svg.join('\n');
}

// ---------- HTML 包装（浏览器打开可一键存 PNG） ----------
export function renderHtml(svgString, title) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>${esc(title || '麦门工牌')}</title>
<style>
  body { margin:0; background:#F5EDDE; display:flex; flex-direction:column; align-items:center; gap:18px; padding:28px 12px; font-family:'PingFang SC','Microsoft YaHei',sans-serif; }
  .wrap { max-width:1120px; width:100%; }
  svg { width:100%; height:auto; display:block; filter:drop-shadow(0 10px 18px rgba(138,107,58,.25)); }
  button { padding:10px 34px; font-size:15px; font-weight:700; border:0; border-radius:999px; background:#DA291C; color:#fff; cursor:pointer; }
  button:active { transform:scale(.97); }
  .tip { color:#8A7A60; font-size:13px; }
</style>
</head>
<body>
<div class="wrap">${svgString}</div>
<button id="save">保存 PNG（2x 高清）</button>
<div class="tip">本卡片由麦当劳官方 MCP 数据生成 · 仅供娱乐 · 非官方周边</div>
<script>
document.getElementById('save').addEventListener('click', () => {
  const svgEl = document.querySelector('svg');
  const xml = new XMLSerializer().serializeToString(svgEl);
  const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);
  const img = new Image();
  img.onload = () => {
    const scale = 2;
    const c = document.createElement('canvas');
    c.width = 1120 * scale; c.height = 700 * scale;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#F5EDDE'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    c.toBlob(b => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = 'mcd-badge.png';
      a.click();
    });
  };
  img.src = url;
});
</script>
</body>
</html>`;
}

// ---------- CLI ----------
const __argv = process.argv.slice(2);
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const isDemo = __argv.includes('--demo');
  const getArg = (name, dflt) => {
    const i = __argv.indexOf(name);
    return i !== -1 && __argv[i + 1] && !__argv[i + 1].startsWith('--') ? __argv[i + 1] : dflt;
  };
  const statsFile = isDemo ? null : __argv.find((a, i) => !a.startsWith('-') && __argv[i - 1] !== '-o');
  if (!isDemo && !statsFile) {
    console.error('用法: node make-badge.mjs <stats.json> -o <输出前缀>   或   node make-badge.mjs --demo -o <输出前缀>');
    process.exit(1);
  }
  let stats;
  if (isDemo) stats = DEMO_STATS;
  else {
    try { stats = JSON.parse(readFileSync(statsFile, 'utf8')); }
    catch (e) { console.error('读取 stats 失败: ' + e.message); process.exit(1); }
  }
  const outBase = getArg('-o', 'output/麦门工牌');
  const outAbs = isAbsolute(outBase) ? outBase : join(process.cwd(), outBase);
  try { mkdirSync(dirname(outAbs), { recursive: true }); } catch { /* 已存在 */ }

  const svg = renderBadge(stats);
  writeFileSync(outAbs + '.svg', svg, 'utf8');
  writeFileSync(outAbs + '.html', renderHtml(svg, stats.nickname ? `麦门工牌 · ${stats.nickname}` : '麦门工牌'), 'utf8');
  console.log(`✅ 已生成:\n  ${outAbs}.svg\n  ${outAbs}.html（浏览器打开可存 PNG）`);
}
