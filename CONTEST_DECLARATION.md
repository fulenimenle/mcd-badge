# 参赛声明（CONTEST DECLARATION）

**参赛作品**：麦门工牌（mcd-badge）
**参赛赛事**：麦当劳程序员创意开发大赛（1024 程序员节）
**参赛人**：fulenimenle（GitHub ID）
**声明日期**：2026-10-24

## 1. 原创性

本作品由本人基于麦当劳官方 MCP（open.mcd.cn / mcp.mcd.cn）开放能力独立构思并开发完成，未抄袭、未搬运任何第三方参赛作品或既有开源项目的核心创意与代码。作品开发过程全程使用腾讯 WorkBuddy 辅助完成，开发对话记录见 `docs/开发对话记录.md`。

## 2. 作品性质

- 本作品为**粉丝二创（fan-made）**作品，仅供学习交流与娱乐，与麦当劳（麦当劳中国 / McDonald's China）官方无任何隶属或授权关系。
- 卡片中「MAIMEN TECH」「麦门工牌」等表述均为玩梗创作，不构成任何官方凭证；卡片页脚已注明「非官方周边 · 仅供娱乐」。
- 金色拱门等图形元素为简化示意绘制，仅用于粉丝向创意表达。

## 3. 数据与隐私承诺

- 本作品仅调用麦当劳 MCP 的**只读接口**（历史订单查询 order-list、积分账户查询 query-my-account，可选优惠券查询 query-my-coupons），不调用下单（create-order）、领券（auto-bind-coupons）、抽奖（draw-lottery）、积分商城兑换（mall-create-order）等任何产生消费或资产变动的接口，不涉及支付环节。
- 用户 Token 仅保存在本地 `.token.local`（已被 `.gitignore` 排除）或用户本地环境变量中，**不写入仓库、不上传、不外传**。
- 拉取的用户数据仅在本地计算与渲染，`output/` 与 `stats.json`（真实数据）均已加入 `.gitignore`，不会进入公开仓库。
- 仓库内演示卡片（`assets/demo-badge.svg`）使用虚构示例数据，不含任何真实个人数据。

## 4. 许可与规则遵守

- 本作品以 **MIT License** 开源。
- 本人已阅读并同意本届大赛官方规则（见 McDonald's China (M-China) 官方仓库 mcd-developer-innovation-challenge 及 activityGuidelines.md），承诺提交信息真实有效，如违反规则愿承担相应后果。

## 5. 免责

本作品按「现状」提供，不附带任何明示或默示的保证。因使用本作品产生的任何直接或间接损失，作者不承担责任。生成内容（职位、鉴定语等）纯属娱乐，请勿当真。
