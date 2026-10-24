---
name: mcd-badge
description: 麦门工牌 & 麦门团餐规划——用麦当劳官方 MCP 读取你的真实订单/积分生成程序员节「麦门工牌」卡片（SVG+HTML 可存 PNG）；或按人数/预算/忌口规划一桌麦当劳团餐（查店→拉菜单→AI 配餐→真实试算）。触发词：麦门工牌、麦门工卡、麦当劳工牌、我的麦门数据、生成工牌、麦门团餐、团餐规划、聚餐点麦、团建点餐。
---

# 麦门工牌（McDonald's Worker Badge）

把用户的麦当劳真实消费数据（最近 10 笔订单 + 实时积分）蒸馏成一张「麦门程序员工牌」：
职位由点餐行为推导（如"早八薅羊毛架构师"）、技能栈由常点单品映射（咖啡因驱动 / 薯条带宽优化…）、
配一句毒舌但善意的「年度鉴定」。卡片为纯 SVG 渲染，附 HTML 版可一键存 PNG。

## 前置条件：MCP Token

1. 检查 Token（按优先级）：
   - 环境变量 `MCD_MCP_TOKEN`
   - 项目根目录 / 本技能目录下的 `.token.local` 文件（纯文本存 Token）
2. 若都没有，引导用户申请：
   - 打开 https://open.mcd.cn → 右上角【登录】扫码 → 【控制台】→ 点【激活】→ 同意协议 → 复制 Token
   - 拿到后把 Token 写入工作目录 `.token.local`（并确认 `.gitignore` 已排除该文件，严禁提交/外传）
3. Token 属个人凭证：不要打印完整 Token、不要写入任何会被 git 跟踪的文件。

## 执行流程

### 第 1 步：拉取数据并计算统计

```bash
node scripts/collect-stats.mjs --nickname <用户昵称，默认"麦友"> --include-orders -o stats.json
```

- 全部只读接口（order-list / query-my-account），不下单、不领券、不消耗积分
- 输出 `stats.json`，包含：职位、部门（按品类推导，全球通用不绑门店）、技能栈、KPI、常点单品、时段分布等
- 可加 `--department 自定义部门` 覆盖自动推导；昵称默认"麦友"，提醒用户勿填真实姓名
- 公开分享场景建议加 `--no-store`：门店名含城市信息，默认不展示更稳妥
- 可加 `--coupons` 附加卡包优惠券数量（可选）

### 第 2 步：AI 润色「年度鉴定」（关键！决定卡片灵魂）

读取 `stats.json`，重点看 `orderDigest`（订单明细）、`position`、`skills`、`kpi`、`morningRatio`、`zeroOrderCount`，
然后**重写** `verdict` 字段并写回 `stats.json`：

- 风格：程序员节梗 + 毒舌但善意，像技术评审给干饭写年度绩效
- 长度：≤ 60 字（卡片最多两行，每行约 36 字符宽）
- 要求：必须引用至少一个真实数据细节（如某个单品、0 元单占比、早八时段、门店名），禁止空话套话
- 示例：「早八麦门人，板烧麦满分重度依赖——吞吐稳定，气泡充足，唯一 bug 是 0 元单占比 50%，建议查一下是不是把优惠薅成了个人 KPI。」
- 可以顺带微调 `position`（职位）让它更贴合用户数据，但保持 ≤ 9 个汉字

### 第 3 步：渲染工牌

```bash
node scripts/make-badge.mjs stats.json -o output/麦门工牌
```

- 产出 `output/麦门工牌.svg`（矢量卡片）和 `output/麦门工牌.html`（浏览器打开点按钮存 2x PNG）
- 将 HTML/SVG 文件展示给用户；用户若想分享，建议存 PNG 发社交平台

## 红线

- 只调用只读接口；**绝不**调用 create-order / auto-bind-coupons / draw-lottery / mall-create-order 等产生消费或资产变动的工具
- 统计口径是"最近 10 笔订单"，不要夸大成"年度全部数据"；卡片页脚已注明
- 用户数据（门店、订单）留在本地 `output/` 与 `stats.json`（均已 gitignore），分享前提醒用户卡片含门店名
- 本作品为粉丝二创，与麦当劳官方无关

---

# 第二玩法：麦门团餐规划

用户说「团餐规划 / 聚餐点麦 / 帮我配一桌麦当劳」时触发。通用团餐场景：公司团建、朋友聚餐、社团聚会、班级聚会等。

## 输入（缺什么问什么）

1. **人数**（必须）
2. **预算**：人均或总额（必须）
3. **忌口/偏好**（可选：不吃辣/素食/爱咖啡……）
4. **位置**：城市 + 位置关键词（如「上海 龙阳路」），或用户直接给 storeCode
5. 场景默认到店自取（beType=1 / orderType=1）

## 执行流程

```bash
# 1) 查门店（展示前几家让用户选，或选距离最近的）
node scripts/plan-feast.mjs stores --city <城市> --keyword <关键词> --beType 1 --searchType 2

# 2) 拉菜单（按价格升序 + 分类）
node scripts/plan-feast.mjs menu --storeCode <门店> --orderType 1 --beType 1

# 3) AI 配餐（见下方搭配规则），产出购物车
# 4) 真实试算
node scripts/plan-feast.mjs price --storeCode <门店> --orderType 1 --beType 1 \
  --items '[{"productCode":"...","quantity":2},...]'
```

## AI 搭配规则（麦当劳官方给团餐场景的搭配建议）

- 人均 20 元以下：小食为主
- 人均 20-30 元：汉堡 + 小食 或 汉堡 + 饮料
- 人均 30-40 元：汉堡 + 薯条/小食 + 饮料
- 人均 40-50 元：汉堡 + 薯条 + 小食 + 饮料
- 人均 50 元以上：丰富组合，优先不重复小食

补充原则：优先选促销价/随心配（菜单里"随心配 1+1"类）；尊重忌口；凑整但不为凑单硬塞；输出**每人一份明细表**（人 1 → 主堡+副食+饮料…）+ 总价 + 人均价。

## 输出格式

Markdown 表格：每人套餐明细 → 全桌购物车（含 productCode/数量，方便用户直接下单）→ 试算总价/人均 → 备注（优惠券提示：可建议用户用 `auto-bind-coupons` 领券但必须先征得同意）。

## 团餐红线

- **只规划、试算，绝不自动下单**（不调 create-order）。用户明确要求下单时，逐项确认购物车后再引导，且优先建议用户在麦当劳 App 完成支付环节
- 领券（auto-bind-coupons）、抽奖（draw-lottery）等资产变动操作必须先征得用户明确同意
