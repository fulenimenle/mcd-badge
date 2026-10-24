#!/usr/bin/env node
/**
 * 麦门工牌 · 麦当劳 MCP 命令行客户端（薄封装，核心逻辑在 mcp-client.mjs）
 *
 * 用法:
 *   node mcd.mjs ping                         连通性自检
 *   node mcd.mjs tools                        列出麦当劳 MCP 全部可用工具
 *   node mcd.mjs call <toolName> [jsonArgs]   调用指定工具
 *     例: node mcd.mjs call query-my-account
 *
 * Token 来源（优先级）: --token 参数 > 环境变量 MCD_MCP_TOKEN > .token.local 文件
 * ⚠️ .token.local 已被 .gitignore 排除，严禁把 Token 提交到公开仓库。
 */

import { findToken, connect, callTool, listTools, ENDPOINT } from './mcp-client.mjs';

function printToolResult(result) {
  const contents = result.content || [];
  for (const c of contents) {
    if (c.type === 'text') console.log(c.text);
    else console.log(JSON.stringify(c, null, 2));
  }
  const structured = result.structuredContent;
  if (structured && contents.length === 0) console.log(JSON.stringify(structured, null, 2));
}

async function main() {
  const argv = process.argv.slice(2);
  const tokenArgIdx = argv.indexOf('--token');
  const token = findToken(tokenArgIdx !== -1 ? argv[tokenArgIdx + 1] : undefined);
  const positional = argv.filter(
    (a, i) => !a.startsWith('--') && (i === 0 || argv[i - 1] !== '--token')
  );
  const cmd = positional[0] || 'ping';

  console.error(`[mcd] 端点: ${ENDPOINT}`);
  const { session, serverInfo } = await connect(token);
  if (serverInfo) console.error(`[mcd] 已连接: ${serverInfo.name || '?'} ${serverInfo.version || ''}`);

  if (cmd === 'ping') {
    try {
      const r = await callTool(token, session, 'now-time-info');
      console.log('✅ MCP 连通正常');
      printToolResult(r);
    } catch (e) {
      console.error('⚠️ 连接成功但 now-time-info 调用失败: ' + e.message);
    }
    return;
  }

  if (cmd === 'tools') {
    const tools = await listTools(token, session);
    for (const t of tools) {
      console.log(`\n### ${t.name}`);
      if (t.description) console.log(`  ${t.description.split('\n')[0].slice(0, 120)}`);
      const props = t.inputSchema?.properties || {};
      const required = t.inputSchema?.required || [];
      for (const [k, v] of Object.entries(props)) {
        console.log(`  - ${k}${required.includes(k) ? ' *必填' : ''}: ${v.type || '?'}${v.description ? ' — ' + String(v.description).split('\n')[0].slice(0, 80) : ''}`);
      }
    }
    console.log(`\n共 ${tools.length} 个工具`);
    return;
  }

  if (cmd === 'call') {
    const toolName = positional[1];
    if (!toolName) { console.error('用法: node mcd.mjs call <toolName> [jsonArgs]'); process.exit(1); }
    let args = {};
    if (positional[2]) {
      try { args = JSON.parse(positional[2]); }
      catch { console.error('jsonArgs 不是合法 JSON: ' + positional[2]); process.exit(1); }
    }
    const r = await callTool(token, session, toolName, args);
    printToolResult(r);
    return;
  }

  console.error(`未知命令: ${cmd}（支持 ping / tools / call）`);
  process.exit(1);
}

main().catch(e => { console.error('[mcd] ' + (e.message || e)); process.exit(1); });
