---
name: mcd-badge
description: 麦门全家桶——基于麦当劳官方 MCP 的五个玩法：①麦门工牌（真实订单/积分生成程序员节工牌卡片，可存 PNG）②麦门团餐规划（人数+预算+忌口→查店→拉菜单→AI 配餐→真实试算）③麦麦派对策划师（生日派对/主题派对/品鉴会的城市→门店→场次查询与方案）④积分过期军师（快过期积分→最优兑换建议）⑤麦门情报站（营销活动日历+可领券清单）。触发词：麦门工牌、生成工牌、麦门团餐、团餐规划、聚餐点麦、派对策划、生日会、积分过期、积分兑换、麦门情报、麦当劳活动。
---

# 麦门全家桶（McDonald's MCP Suite）

基于麦当劳官方 MCP（open.mcd.cn）的五个玩法，全部**只读**：

| # | 玩法 | 触发词示例 | 核心接口 |
|---|---|---|---|
| 1 | 🪪 麦门工牌 | 「给我生成麦门工牌」 | order-list, query-my-account |
| 2 | 🍟 麦门团餐规划 | 「帮我配一桌麦当劳，6 人人均 35」 | query-nearby-stores, query-meals, calculate-price |
| 3 | 🎂 麦麦派对策划师 | 「办个生日派对」「策划一场品鉴会」 | mall-points-products(派对类目), query-party-* |
| 4 | ⏰ 积分过期军师 | 「我积分快过期了」「积分能换啥」 | query-my-account, mall-points-products(商品券) |
| 5 | 📡 麦门情报站 | 「麦当劳最近有什么活动」 | campaign-calendar, available-coupons |

## 前置条件：MCP Token

1. 检查 Token（按优先级）：环境变量 `MCD_MCP_TOKEN` → 项目根目录/技能目录 `.token.local` 文件
2. 都没有则引导用户：打开 https://open.mcd.cn → 登录 → 控制台 → 激活 → 复制 Token → 写入 `.token.local`（确认已被 .gitignore 排除）
3. Token 属个人凭证：不打印全文、不写入任何被 git 跟踪的文件

---

## 玩法一：🪪 麦门工牌

把真实消费数据（最近 10 笔订单 + 实时积分）生成一张"麦门程序员工牌"SVG 卡片。

### 步骤

```bash
# 1) 拉数据算统计
node scripts/collect-stats.mjs --nickname <昵称，默认"麦友"> --include-orders -o stats.json
# 公开分享场景建议加 --no-store（门店名含城市信息）；--department 可自定义部门
```

2. 读取 `stats.json`，重写 `verdict`（年度鉴定）写回：程序员节梗 + 毒舌但善意，≤60 字，必须引用至少一个真实数据细节（单品/0 元单占比/早八时段/门店），禁止空话。可顺带微调 `position`（≤9 汉字）。

```bash
# 3) 渲染
node scripts/make-badge.mjs stats.json -o output/麦门工牌
```

产出 `output/麦门工牌.svg` + `.html`（浏览器打开一键存 2x PNG）。展示给用户。

---

## 玩法二：🍟 麦门团餐规划

通用团餐：公司团建、朋友聚餐、社团聚会、班级聚会。输入：**人数 + 预算（人均或总额）+ 忌口（可选）+ 位置（城市+关键词，或直接给 storeCode）**。

```bash
node scripts/plan-feast.mjs stores --city <城市> --keyword <关键词> --beType 1 --searchType 2
node scripts/plan-feast.mjs menu  --storeCode <门店> --orderType 1 --beType 1
node scripts/plan-feast.mjs price --storeCode <门店> --orderType 1 --beType 1 \
  --items '[{"productCode":"...","quantity":2},...]'
```

**AI 搭配规则（官方团餐建议）**：人均 20 以下小食为主 / 20-30 汉堡+小食或饮料 / 30-40 汉堡+薯条或小食+饮料 / 40-50 汉堡+薯条+小食+饮料 / 50+ 丰富组合不重复小食。优先促销价与随心配，尊重忌口。

**输出**：每人一份明细表 → 全桌购物车（含 productCode/数量）→ 试算总价与人均 → 备注（如建议先领券，领券需用户同意）。

---

## 玩法三：🎂 麦麦派对策划师

生日派对 / 主题派对 / 麦麦体验营 / 品鉴会 / 读书会的选址查场。输入：**派对类型 + 城市（可选）+ 人数/预算偏好**。

```bash
node scripts/mcd-extras.mjs party-catalog --cat 生日派对   # 或 主题派对/品鉴会/读书会/麦麦体验营
node scripts/mcd-extras.mjs party-city   --spuId <上一步拿到的 spuId>
node scripts/mcd-extras.mjs party-store  --args '{"spuId":N,"cityId":...}'   # 字段以上一步输出/官方文档为准
node scripts/mcd-extras.mjs party-date   --args '{...}'
node scripts/mcd-extras.mjs party-session --args '{...}'
```

**输出**：可选方案表（派对主题 → 城市 → 门店 → 日期场次 → 价格/积分）+ 预订指引。每一步的下一跳 id 都在上一步输出里。

---

## 玩法四：⏰ 积分过期军师

用户问「积分快过期了怎么办 / 积分能换什么」时触发。

```bash
node scripts/mcd-extras.mjs points            # 账户 + 过期预警
node scripts/mcd-extras.mjs mall --cat 商品券 [--keyword 关键词]   # 可兑商品券（point=所需积分）
```

**输出**：积分健康报告（可用/即将过期/冻结）→ 若有过期风险，按积分匹配最优商品券（对比 point 与商品价值）→ 给出「先兑 X 再兑 Y」的顺序建议。mall 里大量券 1 积分起兑，提醒用户别浪费。

---

## 玩法五：📡 麦门情报站

用户问「麦当劳最近有什么活动 / 有什么可领的券」时触发。

```bash
node scripts/mcd-extras.mjs intel [--date yyyy-MM-dd]   # 活动日历 + 可领券清单
```

日历接口返回 markdown 简报（含往期/进行中/未来活动），直接转述要点：活动标题、内容、日期。可领券清单只展示，**领券本身必须用户明确同意**。

---

## 全局红线

- **全部只读**：绝不调用 create-order / party-order-create / mall-create-order / draw-lottery / auto-bind-coupons 等产生消费或资产变动的工具
- 用户明确要求下单/领券/抽奖时：逐项确认 → 引导用户在麦当劳 App 完成支付类环节
- 隐私：Token 不入库不打印；昵称默认「麦友」并提醒勿填真实姓名；公开分享用 `--no-store` 隐藏门店
- 统计口径诚实：工牌数据来自"最近 10 笔订单"，不夸大成年度全量
- 本作品为粉丝二创，与麦当劳官方无关；输出仅供参考，餐品价格以官方渠道实时结果为准
