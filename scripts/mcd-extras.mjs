#!/usr/bin/env node
/**
 * 麦门工具箱 · 派对 / 积分 / 情报站 数据管道（零依赖，全部只读）
 *
 * 派对策划师（生日派对/主题派对/麦麦体验营/品鉴会/读书会）:
 *   node scripts/mcd-extras.mjs party-catalog [--cat 1>6>20]   # 派对商品目录(可换类目)
 *   node scripts/mcd-extras.mjs party-city   --spuId N          # 派对可办城市
 *   node scripts/mcd-extras.mjs party-store  --args '{"spuId":N,...}'
 *   node scripts/mcd-extras.mjs party-date   --args '{...}'     # 日期
 *   node scripts/mcd-extras.mjs party-session --args '{...}'    # 场次
 *
 * 积分过期军师:
 *   node scripts/mcd-extras.mjs points                          # 积分账户+过期预警
 *   node scripts/mcd-extras.mjs mall [--cat 1>4] [--keyword 关键词] # 积分商城可兑商品
 *
 * 麦门情报站:
 *   node scripts/mcd-extras.mjs intel [--date yyyy-MM-dd]       # 营销活动日历+可领券
 *
 * 派对类目 catRuleIds: 1>6>20 生日派对 | 1>6>21 主题派对 | 1>6>22 麦麦体验营
 *                      1>6>25 品鉴会 | 1>6>34 读书会 | 1>6>40 积分兑换活动 | 1>4 商品券
 *
 * ⚠️ 全部只读。绝不调用 party-order-create / mall-create-order / draw-lottery / auto-bind-coupons。
 */

import { findToken, connect, callTool, extractOriginalJson, toolText } from './mcp-client.mjs';
import { fileURLToPath } from 'node:url';

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
  try { return JSON.parse(s); } catch { console.error(`[extras] JSON 解析失败: ${s}`); process.exit(1); }
};
function collectObjects(node, out = []) {
  if (Array.isArray(node)) { for (const n of node) collectObjects(n, out); }
  else if (node && typeof node === 'object') { out.push(node); for (const v of Object.values(node)) collectObjects(v, out); }
  return out;
}
const firstOf = (o, keys) => keys.map(k => o[k]).find(v => v !== undefined && v !== null && v !== '');

/** 通用打印：尝试提炼商品/列表条目，失败则输出原始 data JSON */
function smartPrint(json, preferKeys) {
  const items = [];
  for (const o of collectObjects(json)) {
    const name = firstOf(o, preferKeys.name);
    const id = firstOf(o, preferKeys.id);
    if (name && id && !items.some(x => x.id === id)) {
      items.push({
        id,
        name,
        price: firstOf(o, preferKeys.price),
        extra: firstOf(o, preferKeys.extra),
      });
    }
  }
  if (items.length) {
    for (const it of items) {
      console.log(`${it.id} | ${it.name}${it.price != null ? ` | ${it.price}` : ''}${it.extra != null ? ` | ${it.extra}` : ''}`);
    }
    console.error(`[extras] 提炼出 ${items.length} 条（格式: id | 名称 | 价格 | 附加）`);
  } else {
    console.log(JSON.stringify(json?.data ?? json, null, 2));
  }
}

const PARTY_CATS = { '生日派对': '1>6>20', '主题派对': '1>6>21', '麦麦体验营': '1>6>22', '品鉴会': '1>6>25', '读书会': '1>6>34', '积分兑换活动': '1>6>40', '商品券': '1>4' };

async function callAndCheck(token, session, tool, args) {
  const text = await toolText(token, session, tool, args);
  const json = extractOriginalJson(text);
  if (json?.success === false) throw new Error(`${tool} 业务错误: ${json.message || JSON.stringify(json)}`);
  return json;
}

// ---------- 派对 ----------
async function partyCatalog(token, session, args) {
  const cat = args.cat && PARTY_CATS[args.cat] ? PARTY_CATS[args.cat] : (args.cat ?? '1>6>20');
  const json = await callAndCheck(token, session, 'mall-points-products', { catRuleIds: cat });
  console.error(`[extras] 类目: ${cat}`);
  smartPrint(json, { name: ['spuName', 'name', 'productName', 'title'], id: ['spuId', 'id', 'productId'], price: ['point', 'price', 'points', 'needPoints', 'salePrice'], extra: ['selling', 'catName', 'subTitle'] });
}
async function partyCity(token, session, args) {
  const a = args.args ? parseJson(args.args) : { spuId: Number(args.spuId) };
  if (!a.spuId) { console.error('[extras] party-city 需要 --spuId（先跑 party-catalog 拿）'); process.exit(1); }
  smartPrint(await callAndCheck(token, session, 'query-party-city', a), { name: ['cityName', 'name', 'city'], id: ['cityId', 'id', 'code'], price: ['price', 'points'], extra: ['storeCount', 'count'] });
}
async function partyPassthrough(token, session, args, tool) {
  const a = args.args ? parseJson(args.args) : {};
  if (!args.args) { console.error(`[extras] ${tool} 字段结构以官方文档为准，建议用 --args '{...}' 透传（上一步输出里通常含下一跳所需 id）`); }
  smartPrint(await callAndCheck(token, session, tool, a), { name: ['storeName', 'name', 'date', 'sessionName', 'time'], id: ['storeId', 'id', 'storeCode', 'date', 'sessionId'], price: ['price', 'points'], extra: ['address', 'addressText', 'time', 'remain'] });
}

// ---------- 积分 ----------
async function points(token, session) {
  const json = await callAndCheck(token, session, 'query-my-account', {});
  const d = json?.data ?? {};
  console.log(`可用积分: ${d.availablePoint ?? '?'}`);
  console.log(`累计积分: ${d.accumulativePoint ?? '?'}`);
  console.log(`本月将过期: ${d.currentMouthExpirePoint ?? 0}`);
  console.log(`下月将过期: ${d.nextMouthExpirePoint ?? 0}`);
  console.log(`冻结: ${d.frozenPoint ?? 0} | 已过期: ${d.expiredPoint ?? 0}`);
  const exp = parseFloat(d.currentMouthExpirePoint ?? 0) + parseFloat(d.nextMouthExpirePoint ?? 0);
  if (exp > 0) console.error(`[extras] ⏰ 有 ${exp} 积分即将过期 → 接下来跑 mall 帮用户找最值得兑的商品券`);
  else console.error('[extras] 近期无过期积分，可按可用积分做兑换建议');
}
async function mall(token, session, args) {
  const cat = args.cat && PARTY_CATS[args.cat] ? PARTY_CATS[args.cat] : (args.cat ?? '1>4');
  const payload = { catRuleIds: cat };
  if (args.keyword) payload.keyword = args.keyword;
  const json = await callAndCheck(token, session, 'mall-points-products', payload);
  console.error(`[extras] 类目: ${cat}${args.keyword ? ` | 关键词: ${args.keyword}` : ''}`);
  smartPrint(json, { name: ['spuName', 'name', 'productName', 'title'], id: ['spuId', 'id', 'productId'], price: ['point', 'price', 'points', 'needPoints'], extra: ['selling', 'catName', 'subTitle'] });
}

// ---------- 情报站 ----------
async function intel(token, session, args) {
  const payload = args.args ? parseJson(args.args) : (args.date ? { specifiedDate: args.date } : {});
  const calText = await toolText(token, session, 'campaign-calendar', payload);
  console.log('===== 营销活动日历 =====');
  try {
    // 有的版本返回 JSON，有的直接返回 markdown 简报
    const json = extractOriginalJson(calText);
    smartPrint(json, { name: ['activityName', 'name', 'title', 'activityTitle'], id: ['activityId', 'id', 'date'], price: ['date', 'activityDate'], extra: ['description', 'desc', 'subTitle', 'activityDesc'] });
  } catch {
    console.log(calText.trim());
  }

  console.log('\n===== 可领取的麦麦省券（未领，仅清单）=====');
  try {
    const coupons = await callAndCheck(token, session, 'available-coupons', {});
    smartPrint(coupons, { name: ['couponName', 'name', 'title'], id: ['couponId', 'id'], price: ['couponAmount', 'amount', 'discount'], extra: ['statusText', 'tag', 'subTitle'] });
  } catch (e) {
    console.error(`[extras] 可领券查询失败（不影响情报站）: ${e.message}`);
  }
  console.error('[extras] 领券属资产变动，如用户要领，引导用 auto-bind-coupons 前先征得同意');
}

// ---------- 主入口 ----------
const __argv = process.argv.slice(2);
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = parseArgs(__argv);
  const cmd = args._[0];
  const USAGE = `用法:
  node scripts/mcd-extras.mjs party-catalog [--cat 生日派对|主题派对|品鉴会|1>6>20...]
  node scripts/mcd-extras.mjs party-city  --spuId N
  node scripts/mcd-extras.mjs party-store --args '{...}'   | party-date | party-session
  node scripts/mcd-extras.mjs points
  node scripts/mcd-extras.mjs mall [--cat 商品券|1>4] [--keyword 关键词]
  node scripts/mcd-extras.mjs intel [--date yyyy-MM-dd]`;
  if (!cmd) { console.error(USAGE); process.exit(1); }

  const token = findToken();
  const { session } = await connect(token);
  const T = {
    'party-catalog': () => partyCatalog(token, session, args),
    'party-city': () => partyCity(token, session, args),
    'party-store': () => partyPassthrough(token, session, args, 'query-party-store'),
    'party-date': () => partyPassthrough(token, session, args, 'query-partystore-date'),
    'party-session': () => partyPassthrough(token, session, args, 'query-partystore-session'),
    'points': () => points(token, session),
    'mall': () => mall(token, session, args),
    'intel': () => intel(token, session, args),
  };
  if (!T[cmd]) { console.error(`未知命令: ${cmd}\n${USAGE}`); process.exit(1); }
  try { await T[cmd](); }
  catch (e) { console.error('[extras] ' + (e.message || e)); process.exit(1); }
}
