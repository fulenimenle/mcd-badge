#!/usr/bin/env node
/**
 * 麦门工牌 · 数据聚合脚本
 * 拉取麦当劳 MCP 只读接口（历史订单 + 积分账户），计算工牌所需统计与趣味称号。
 *
 * 用法:
 *   node scripts/collect-stats.mjs                    # 统计结果输出到 stdout（JSON）
 *   node scripts/collect-stats.mjs -o stats.json      # 写入文件
 *   node scripts/collect-stats.mjs --nickname 你的昵称  # 工牌姓名（默认"麦友"，请勿填真实姓名）
 *   node scripts/collect-stats.mjs --coupons          # 附加：卡包优惠券数量
 *   node scripts/collect-stats.mjs --include-orders   # 附加：订单摘要明细（供 AI 写年度鉴定）
 *
 * 说明:
 *   - 全部只读接口，不下单、不领券、不消耗积分
 *   - order-list 仅返回最近 10 笔订单，统计口径以此为准
 */

import { writeFileSync } from 'node:fs';
import { findToken, connect, callTool, extractOriginalJson, toolText } from './mcp-client.mjs';

// ---------- 趣味称号规则 ----------
function pickPosition({ favoriteItems, zeroOrderCount, morningRatio }) {
  const joined = favoriteItems.join('|');
  const has = re => re.test(joined);
  if (zeroOrderCount > 0 && morningRatio >= 0.5) return '早八薅羊毛架构师';
  if (zeroOrderCount > 0) return '0元购专项研究员';
  if (has(/咖啡|美式|拿铁|鲜萃/)) return '咖啡因系统架构师';
  if (has(/薯条|薯饼/)) return '高级薯条架构师';
  if (has(/巨无霸/)) return '汉堡吞吐量优化专家';
  if (has(/板烧/)) return '板烧内核维护工程师';
  if (has(/麦辣|辣/)) return '辣度并发控制工程师';
  if (has(/派|圣代|新地|圆筒/)) return '甜品缓存治理专家';
  return '全栈干饭工程师';
}

function pickSkills({ items, zeroOrderCount, morningRatio, nightRatio, topItems }) {
  const joined = items.join('|');
  const s = new Set();
  if (/(咖啡|美式|拿铁|鲜萃)/.test(joined)) s.add('咖啡因驱动');
  if (/(薯条|薯饼)/.test(joined)) s.add('薯条带宽优化');
  if (/板烧/.test(joined)) s.add('板烧内核');
  if (/(堡|麦香鸡|鸡腿)/.test(joined)) s.add('汉堡高吞吐');
  if (/(可乐|麦炫酷|气泡)/.test(joined)) s.add('气泡缓存');
  if (/(派|圣代|新地|圆筒)/.test(joined)) s.add('甜品GC');
  if (zeroOrderCount > 0) s.add('0元购大师');
  if (morningRatio >= 0.5) s.add('早八干饭人');
  if (nightRatio > 0) s.add('深夜编译型选手');
  if (topItems.length >= 3) s.add('多技术栈混编');
  if (s.size < 3) s.add('全栈干饭');
  return [...s].slice(0, 5);
}

function timeBucket(hour) {
  if (hour >= 6 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 15) return 'lunch';
  if (hour >= 15 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 23) return 'dinner';
  return 'night';
}

// 部门按常点品类推导（全球通用，不绑定任何具体门店/城市）
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

// ---------- 主流程 ----------
async function main() {
  const argv = process.argv.slice(2);
  const getArg = (name, dflt) => {
    const i = argv.indexOf(name);
    return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
  };
  const outFile = argv.includes('-o') ? getArg('-o', null) : null;
  const nickname = getArg('--nickname', '麦友');
  const departmentOverride = argv.includes('--department') ? getArg('--department', null) : null;
  const noStore = argv.includes('--no-store'); // 隐藏常去据点（门店名含城市信息，公开分享时建议开启）
  const wantCoupons = argv.includes('--coupons');
  const includeOrders = argv.includes('--include-orders');

  const token = findToken();
  const { session } = await connect(token);

  // 1) 历史订单（只读）
  const ordersText = await toolText(token, session, 'order-list');
  const ordersJson = extractOriginalJson(ordersText);
  const rawOrders = Array.isArray(ordersJson?.data?.list) ? ordersJson.data.list : [];
  const validOrders = rawOrders.filter(o => !/取消|退款/.test(o.orderStatus || ''));

  // 2) 积分账户（只读）
  let account = null;
  try {
    const accText = await toolText(token, session, 'query-my-account');
    account = extractOriginalJson(accText)?.data || null;
  } catch (e) { console.error('[stats] 积分查询失败（不影响工牌）: ' + e.message); }

  // 3) 优惠券数量（可选，只读）
  let couponCount = null;
  if (wantCoupons) {
    try {
      const cpText = await toolText(token, session, 'query-my-coupons', { page: '1', pageSize: '200' });
      const cpJson = extractOriginalJson(cpText);
      const list = cpJson?.data?.list || cpJson?.data?.coupons || cpJson?.data?.couponList || [];
      couponCount = Array.isArray(list) ? list.length : null;
    } catch (e) { console.error('[stats] 优惠券查询失败（跳过）: ' + e.message); }
  }

  // ---------- 统计 ----------
  const itemCount = new Map();   // 单品 -> 份数（套餐拆子项计）
  const storeCount = new Map();
  const buckets = { morning: 0, lunch: 0, afternoon: 0, dinner: 0, night: 0 };
  let totalSpent = 0, zeroOrderCount = 0;
  const orderDigest = [];

  for (const o of validOrders) {
    const amount = parseFloat(o.realTotalAmount ?? '0') || 0;
    totalSpent += amount;
    if (amount === 0) zeroOrderCount++;
    storeCount.set(o.storeName || '未知门店', (storeCount.get(o.storeName) || 0) + 1);
    const dt = new Date(String(o.createTime || '').replace(' ', 'T'));
    if (!Number.isNaN(dt.getTime())) buckets[timeBucket(dt.getHours())]++;
    const names = [];
    for (const p of o.orderProductList || []) {
      if (Array.isArray(p.comboItemList) && p.comboItemList.length) {
        for (const c of p.comboItemList) { names.push(c.name); itemCount.set(c.name, (itemCount.get(c.name) || 0) + (c.quantity || 1)); }
      } else if (p.productName) {
        names.push(p.productName); itemCount.set(p.productName, (itemCount.get(p.productName) || 0) + (p.quantity || 1));
      }
    }
    orderDigest.push({ date: (o.createTime || '').slice(0, 10), time: (o.createTime || '').slice(11, 16), store: o.storeName, items: names, amount });
  }

  const topItems = [...itemCount.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([name, count]) => ({ name, count }));
  const favoriteItems = topItems.map(t => t.name);
  const totalOrders = validOrders.length;
  const totalSlots = Math.max(1, Object.values(buckets).reduce((a, b) => a + b, 0));
  const morningRatio = buckets.morning / totalSlots;
  const nightRatio = buckets.night / totalSlots;
  const favoriteStore = [...storeCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const dates = validOrders.map(o => (o.createTime || '').slice(0, 10)).filter(Boolean).sort();
  const joinDate = dates[0] || null;
  const lastPunch = dates[dates.length - 1] || null;
  const employeeId = account?.accountId ? 'MM-' + String(account.accountId).slice(-5) : 'MM-1024';
  const points = account ? parseFloat(account.availablePoint || '0') : null;
  const position = totalOrders ? pickPosition({ favoriteItems, zeroOrderCount, morningRatio }) : '实习干饭生';
  const skills = totalOrders ? pickSkills({ items: favoriteItems, zeroOrderCount, morningRatio, nightRatio, topItems }) : ['等待首单激活'];
  const spentDays = new Set(orderDigest.map(o => o.date)).size || 1;

  const verdict = totalOrders
    ? (morningRatio >= 0.5
        ? `早八麦门人，${favoriteItems[0] || '套餐'}重度依赖——吞吐稳定，气泡充足，唯一 bug 是 0 元单占比 ${(zeroOrderCount / totalOrders * 100).toFixed(0)}%，建议查一下是不是把优惠薅成了个人 KPI。`
        : `${favoriteItems[0] || '套餐'}忠实用户，订单吞吐稳定，气泡储备充足。综合评审：干饭性能达标，建议继续保持「不加班先干饭」的开发节奏。`)
    : '尚无近期订单记录，工牌处于实习状态——去麦当劳吃一顿，回来重新生成即可转正。';

  const stats = {
    schema: 'mcd-badge/stats@1',
    generatedAt: new Date().toISOString(),
    nickname,
    employeeId,
    position,
    department: departmentOverride || departmentOf(favoriteItems[0], { zeroOrderCount }),
    positionLevel: totalOrders >= 5 ? 'S3 · 资深干饭级' : totalOrders >= 2 ? 'S2 · 熟练干饭级' : 'S1 · 实习干饭级',
    skills,
    verdict,
    kpi: {
      orders: totalOrders,
      spent: Math.round(totalSpent * 10) / 10,
      avg: Math.round(totalSpent / Math.max(spentDays, 1) * 10) / 10,
      points,
      couponCount,
    },
    favoriteItem: favoriteItems[0] || null,
    topItems,
    favoriteStore: noStore ? null : favoriteStore,
    storeCount: storeCount.size,
    joinDate,
    lastPunch,
    timeBuckets: buckets,
    morningRatio: Math.round(morningRatio * 100) / 100,
    zeroOrderCount,
    orderDigest: includeOrders ? orderDigest : undefined,
    dataSource: '麦当劳官方 MCP（open.mcd.cn）· 最近 10 笔订单 + 实时积分',
  };

  const out = JSON.stringify(stats, null, 2);
  if (outFile) { writeFileSync(outFile, out, 'utf8'); console.error(`[stats] 已写入 ${outFile}`); }
  else console.log(out);
}

main().catch(e => { console.error('[stats] ' + (e.message || e)); process.exit(1); });
