# 麦当劳 MCP 接入说明

本作品的全部数据能力来自**麦当劳官方 MCP 平台**（open.mcd.cn）。本文档说明协议细节与本仓库的工具映射。

## 1. 接入参数

| 项 | 值 |
|---|---|
| 端点 | `https://mcp.mcd.cn` |
| 传输协议 | **Streamable HTTP**（非 SSE 长连接；服务端响应可能为 `application/json` 或 `text/event-stream`，需双格式兼容） |
| 认证 | 请求头 `Authorization: Bearer <你的Token>` |
| 会话 | initialize 响应头 `Mcp-Session-Id`，后续请求透传 |
| 限流 | 每 Token 每分钟 600 次，超限返回 429 |
| 协议版本 | 兼容 `2025-03-26` / `2024-11-05`（本仓库按序尝试） |

### MCP Client 通用配置

```json
{
  "mcpServers": {
    "mcd-mcp": {
      "type": "streamablehttp",
      "url": "https://mcp.mcd.cn",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_TOKEN"
      }
    }
  }
}
```

## 2. Token 申请

1. 打开 https://open.mcd.cn → 右上角【登录】（麦当劳会员扫码）
2. 右上角【控制台】→ 点击【激活】→ 同意服务协议
3. 复制 Token → 存入本仓库根目录 `.token.local` 文件（纯文本），或设置环境变量 `MCD_MCP_TOKEN`

⚠️ Token 绑定个人会员账号，等同身份凭证：严禁提交到 git、严禁分享给他人。

## 3. 本仓库调用的工具

| 工具 | 用途 | 只读 |
|---|---|---|
| `now-time-info` | 连通性自检（ping） | ✅ |
| `order-list` | 最近 10 笔历史订单（时间/门店/商品/金额）→ 职位、技能栈、KPI | ✅ |
| `query-my-account` | 麦享会积分（可用/累计/即将过期）→ KPI 第三格 | ✅ |
| `query-my-coupons`（可选） | 卡包优惠券数量 | ✅ |

本作品**不调用**：`create-order`、`cancel-order`、`auto-bind-coupons`、`draw-lottery`、`mall-create-order` 等任何产生消费或资产变动的工具。

## 4. 零依赖实现说明

本仓库没有使用任何 MCP SDK，`scripts/mcp-client.mjs` 用 Node 原生 `fetch`（≥18）直接实现了 JSON-RPC over Streamable HTTP：

1. `POST /` 发送 `initialize`（携带 Bearer 头）→ 记录响应头 `Mcp-Session-Id`
2. 发送 `notifications/initialized` 通知
3. `tools/list` / `tools/call` 正常调用
4. 响应解析：`Content-Type` 为 JSON 直接 `JSON.parse`；为 `text/event-stream` 则提取 `data:` 行再解析
5. 内置网络抖动重试（最多 2 次退避重试）

CLI 用法：

```bash
node scripts/mcd.mjs ping                      # 握手 + 时间接口自检
node scripts/mcd.mjs tools                     # 列出全部工具及参数
node scripts/mcd.mjs call query-my-account     # 调用任意工具
```

## 5. 常见问题

| 现象 | 原因 / 处理 |
|---|---|
| `fetch failed` | 检查端点是否为 `mcp.mcd.cn`；本机网络抖动时脚本会自动重试 |
| `HTTP 429` | 超出 600 次/分钟限流，等 1 分钟 |
| `initialize 被拒` | Token 无效或未激活；回 open.mcd.cn 控制台重新激活 |
| 返回里混着「API Response Information」说明文本 | 麦当劳服务端在 text content 中附带字段说明，`extractOriginalJson()` 会提取 `## Original Response` 后的原始 JSON |
