---
name: mcd-badge
description: 麦门工牌——用麦当劳官方 MCP 读取你的真实订单/积分数据，生成一张程序员节风「麦门工牌」卡片（SVG + HTML，可存 PNG 分享）。触发词：麦门工牌、麦门工卡、麦当劳工牌、我的麦门数据、干饭工牌、生成工牌。
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
