#!/usr/bin/env node
/**
 * 麦门团餐规划 · MCP 数据管道（零依赖）
 * 职责：查门店 → 拉菜单 → 算价。配餐创意由 AI（WorkBuddy）完成，本脚本只负责数据。
 *
 * 用法:
 *   node scripts/plan-feast.mjs stores --city 城市 --keyword 位置关键词 [--beType 1] [--searchType 2]
 *   node scripts/plan-feast.mjs menu  --storeCode 门店编码 [--orderType 1]
 *   node scripts/plan-feast.mjs detail --storeCode X --productCode Y [--orderType 1]
 *   node scripts/plan-feast.mjs price --storeCode X --items '[{"productCode":"...","quantity":2},...]' [--orderType 1]
 *
 * 通用参数: --args '{"...":...}' 直接透传给 MCP 工具（优先级最高，覆盖便捷参数）
 *
 * 场景说明（v1 支持到店自取）:
 *   beType=1 / orderType=1 → 到店自取（无需 beCode）
 *   得来速/外卖/团餐需 beCode 或地址，链路更长，AI 可用 --args 透传扩展
 *
 * ⚠️ 本脚本只调用只读/试算接口（query-nearby-stores / query-meals / query-meal-detail / calculate-price），
 *    绝不调用 create-order。下单必须由用户明确确认后另行操作。
 */

import { findToken, connect, callTool, extractOriginalJson, toolText } from './mcp-client.mjs';
import { fileURLToPath } from 'node:url';

// ---------- 参数解析 ----------
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { out[key] = next; i++; }
      else out[key] = true;
    } else out._.push(a);
  }
  return out;
}

const parseJson = (s, fallback = {}) => {
  if (!s || s === true) return fallback;
  try { return JSON.parse(s); } catch { console.error(`[feast] JSON 解析失败: ${s}`); process.exit(1); }
};

// ---------- 通用：从任意形状的响应里收集对象 ----------
function collectObjects(node, out = []) {
  if (Array.isArray(node)) { for (const n of node) collectObjects(n, out); }
  else if (node && typeof node === 'object') {
    out.push(node);
    for (const v of Object.values(node)) collectObjects(v, out);
  }
  return out;
}
const firstOf = (o, keys) => keys.map(k => o[k]).find(v => v !== undefined && v !== null && v !== '');

// ---------- 门店 ----------
async function cmdStores(token, session, args) {
  const payload = args.args ? parseJson(args.args) : {
    beType: Number(args.beType ?? 1),
    searchType: Number(args.searchType ?? 2),
    ...(args.city ? { city: args.city } : {}),
    ...(args.keyword ? { keyword: args.keyword } : {}),
  };
  const text = await toolText(token, session, 'query-nearby-stores', payload);
  const json = extractOriginalJson(text);
  const objs = collectObjects(json);
  const seen = new Set();
  let count = 0;
  for (const o of objs) {
    const storeCode = firstOf(o, ['storeCode', 'storeId']);
    const storeName = firstOf(o, ['storeName', 'name', 'storeAddrName']);
    if (!storeCode || !storeName || seen.has(storeCode)) continue;
    seen.add(storeCode);
    const beCode = firstOf(o, ['beCode']);
    const distance = firstOf(o, ['distance', 'distanceText', 'distanceMeters']);
    const address = firstOf(o, ['address', 'storeAddress', 'addr']);
    const parts = [`【${count + 1}】storeCode: ${storeCode}`];
    if (beCode) parts.push(`beCode: ${beCode}`);
    parts.push(`${storeName}`);
    if (distance !== undefined) parts.push(`距离: ${distance}`);
    if (address) parts.push(`地址: ${address}`);
    console.log(parts.join(' | '));
    count++;
    if (count >= 15) break;
  }
  console.error(`[feast] 共列出 ${count} 家门店（最多15家）`);
}

// ---------- 菜单 ----------
async function cmdMenu(token, session, args) {
  const payload = args.args ? parseJson(args.args) : {
    orderType: Number(args.orderType ?? 1),
    beType: Number(args.beType ?? 1), // query-meals 必传 beType
    ...(args.storeCode ? { storeCode: args.storeCode } : {}),
  };
  const text = await toolText(token, session, 'query-meals', payload);
  const json = extractOriginalJson(text);
  if (json?.success === false) throw new Error(`query-meals 业务错误: ${json.message || JSON.stringify(json)}`);

  const data = json?.data ?? {};
  // 分类: categories[].name + categories[].meals[].code → code→分类名
  const catByCode = new Map();
  for (const cat of (Array.isArray(data.categories) ? data.categories : [])) {
    for (const m of (Array.isArray(cat?.meals) ? cat.meals : [])) {
      if (m?.code) catByCode.set(m.code, cat?.name ?? '-');
    }
  }
  // 详情: data.meals 为 code→实体 映射表（code 是 key，实体内无 code 字段）
  const items = [];
  const seen = new Set();
  const mealsMap = (data.meals && typeof data.meals === 'object' && !Array.isArray(data.meals)) ? data.meals : {};
  for (const [code, d] of Object.entries(mealsMap)) {
    if (!d || typeof d !== 'object') continue;
    const name = d.name || d.productName || d.skuName;
    const price = parseFloat(d.currentPrice ?? d.originalPrice ?? d.price ?? d.salePrice);
    if (!name || Number.isNaN(price) || seen.has(code)) continue;
    seen.add(code);
    items.push({ code, name, price, group: catByCode.get(code) ?? (d.discountType || '-') });
  }
  // 兜底：未知结构时走通用收集
  if (!items.length) {
    for (const o of collectObjects(json)) {
      const name = firstOf(o, ['productName', 'name', 'skuName', 'foodName']);
      const code = firstOf(o, ['productCode', 'code', 'skuId', 'productId']);
      const priceRaw = firstOf(o, ['currentPrice', 'salePrice', 'price', 'sellPrice', 'originalPrice']);
      const price = typeof priceRaw === 'string' ? parseFloat(priceRaw) : priceRaw;
      if (name && code && price !== undefined && !Number.isNaN(price) && !seen.has(code)) {
        seen.add(code);
        items.push({ code, name, price, group: '-' });
      }
    }
  }
  items.sort((a, b) => a.price - b.price);
  console.log('code | 名称 | 价格(¥) | 类别');
  for (const it of items) console.log(`${it.code} | ${it.name} | ${it.price} | ${it.group}`);
  console.error(`[feast] 菜单共 ${items.length} 个单品（按价格升序）`);
  if (!items.length) console.error('[feast] 警告: 未解析出条目，请用 --args 透传检查原始响应');
}

// ---------- 单品详情 ----------
async function cmdDetail(token, session, args) {
  const payload = args.args ? parseJson(args.args) : {
    orderType: Number(args.orderType ?? 1),
    beType: Number(args.beType ?? 1),
    ...(args.storeCode ? { storeCode: args.storeCode } : {}),
    ...(args.productCode ? { productCode: args.productCode } : {}),
  };
  const text = await toolText(token, session, 'query-meal-detail', payload);
  const json = extractOriginalJson(text);
  console.log(JSON.stringify(json, null, 2));
}

// ---------- 算价（试算，不下单） ----------
async function cmdPrice(token, session, args) {
  const payload = args.args ? parseJson(args.args) : {
    orderType: Number(args.orderType ?? 1),
    beType: Number(args.beType ?? 1), // calculate-price 必传 beType
    ...(args.storeCode ? { storeCode: args.storeCode } : {}),
    items: parseJson(args.items, null),
  };
  if (!payload.items) { console.error('[feast] price 需要 --items JSON'); process.exit(1); }
  const text = await toolText(token, session, 'calculate-price', payload);
  const json = extractOriginalJson(text);
  console.log(JSON.stringify(json, null, 2));
  console.error('[feast] 以上为试算结果，未创建订单');
}

// ---------- 主入口 ----------
const __argv = process.argv.slice(2);
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = parseArgs(__argv);
  const cmd = args._[0];
  const USAGE = `用法:
  node scripts/plan-feast.mjs stores --city 城市 --keyword 位置关键词 [--beType 1] [--searchType 2]
  node scripts/plan-feast.mjs menu  --storeCode 门店编码 [--orderType 1]
  node scripts/plan-feast.mjs detail --storeCode X --productCode Y [--orderType 1]
  node scripts/plan-feast.mjs price --storeCode X --items '[{"productCode":"...","quantity":2},...]' [--orderType 1]
  通用: --args '{"...":...}' 直接透传给 MCP 工具（覆盖便捷参数）`;
  if (!cmd) { console.error(USAGE); process.exit(1); }

  const token = findToken();
  const { session } = await connect(token);

  try {
    if (cmd === 'stores') await cmdStores(token, session, args);
    else if (cmd === 'menu') await cmdMenu(token, session, args);
    else if (cmd === 'detail') await cmdDetail(token, session, args);
    else if (cmd === 'price') await cmdPrice(token, session, args);
    else { console.error(`未知命令: ${cmd}\n${USAGE}`); process.exit(1); }
  } catch (e) {
    console.error('[feast] ' + (e.message || e));
    process.exit(1);
  }
}
