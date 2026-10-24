/**
 * 麦当劳 MCP 公共客户端模块（零依赖，Streamable HTTP）
 *
 * 导出:
 *   findToken(explicitArg?)  — 查找 Token（参数 > 环境变量 MCD_MCP_TOKEN > .token.local 文件）
 *   connect(token)           — MCP initialize 握手，返回 { session, serverInfo }
 *   callTool(token, session, name, args?) — 调用工具，返回 result
 *   extractOriginalJson(text)— 从工具返回文本中提取 "# Original Response" 里的 JSON
 *
 * ⚠️ Token 属于个人敏感凭证，严禁提交到公开仓库（.token.local 已被 .gitignore 排除）。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

export const ENDPOINT = process.env.MCD_MCP_URL || 'https://mcp.mcd.cn';
export const PROTOCOL_VERSIONS = ['2025-03-26', '2024-11-05'];

export function findToken(explicit) {
  if (explicit) return String(explicit).trim();
  if (process.env.MCD_MCP_TOKEN) return process.env.MCD_MCP_TOKEN.trim();
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '.token.local'),
    resolve(here, '..', '.token.local'),
    resolve(here, '..', '..', '.token.local'),
  ];
  for (const p of candidates) {
    try {
      const t = readFileSync(p, 'utf8').trim();
      if (t) return t;
    } catch { /* 跳过不存在的文件 */ }
  }
  const err = new Error('未找到 Token。请任选其一:\n' +
    '  1) 设置环境变量 MCD_MCP_TOKEN\n' +
    '  2) 在项目根目录创建 .token.local 文件，内容为你的 Token 纯文本\n' +
    '  3) 调用时传 --token <TOKEN>\n' +
    '  Token 申请: 打开 https://open.mcd.cn → 登录 → 控制台 → 激活');
  err.code = 'NO_TOKEN';
  throw err;
}

function extractJsonPayload(text) {
  const trimmed = String(text).trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return JSON.parse(trimmed);
  const dataLines = [];
  for (const line of trimmed.split(/\r?\n/)) {
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }
  if (!dataLines.length) throw new Error('响应中既非 JSON 也无 data: 行: ' + trimmed.slice(0, 300));
  return JSON.parse(dataLines.join(''));
}

async function rpc(token, sessionId, method, params, { isNotification = false, retries = 2 } = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    'Authorization': `Bearer ${token}`,
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;
  const body = JSON.stringify(
    isNotification
      ? { jsonrpc: '2.0', method, params }
      : { jsonrpc: '2.0', id: Math.floor(Math.random() * 1e9), method, params }
  );
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(ENDPOINT, { method: 'POST', headers, body });
      const sid = res.headers.get('mcp-session-id') || res.headers.get('Mcp-Session-Id');
      let payload = null;
      if (res.status !== 202) {
        const text = await res.text();
        try { payload = extractJsonPayload(text); }
        catch (e) {
          throw new Error(`HTTP ${res.status} 响应解析失败: ${e.message}\n原始片段: ${text.slice(0, 300)}`);
        }
      }
      return { status: res.status, sid, payload };
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  throw new Error(`请求失败（已重试 ${retries} 次）: ${lastErr?.message}`);
}

export async function connect(token) {
  let lastErr = null;
  for (const pv of PROTOCOL_VERSIONS) {
    try {
      const init = await rpc(token, null, 'initialize', {
        protocolVersion: pv,
        capabilities: {},
        clientInfo: { name: 'mcd-badge', version: '1.0.0' },
      });
      if (init.payload?.error) throw new Error(`initialize 被拒: ${JSON.stringify(init.payload.error)}`);
      const session = init.sid || null;
      try { await rpc(token, session, 'notifications/initialized', {}, { isNotification: true }); } catch { /* 忽略 */ }
      return { session, serverInfo: init.payload?.result?.serverInfo || null };
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`MCP 初始化失败（已尝试协议版本 ${PROTOCOL_VERSIONS.join(' / ')}）: ${lastErr?.message}`);
}

export async function callTool(token, session, name, args = {}) {
  const r = await rpc(token, session, 'tools/call', { name, arguments: args });
  if (r.payload?.error) throw new Error(`tools/call "${name}" 失败: ${JSON.stringify(r.payload.error)}`);
  const result = r.payload?.result;
  if (!result) throw new Error(`tools/call "${name}" 无返回结果`);
  if (result.isError) {
    const errText = (result.content || []).map(c => c.text || '').join('\n');
    throw new Error(`工具 "${name}" 返回业务错误: ${errText.slice(0, 500)}`);
  }
  return result;
}

/** 工具返回的 text content 中，提取 "# Original Response" 之后的原始 JSON 对象 */
export function extractOriginalJson(text) {
  const t = String(text);
  const markers = ['## Original Response', '# Original Response', 'Original Response'];
  let jsonPart = null;
  for (const m of markers) {
    const idx = t.indexOf(m);
    if (idx !== -1) { jsonPart = t.slice(idx + m.length).trim(); break; }
  }
  if (jsonPart === null) {
    const i = t.indexOf('{"success"');
    if (i === -1) throw new Error('返回文本中找不到 JSON: ' + t.slice(0, 200));
    jsonPart = t.slice(i);
  }
  return JSON.parse(jsonPart);
}

/** 一次性取回文本形式的结果 */
export async function toolText(token, session, name, args = {}) {
  const result = await callTool(token, session, name, args);
  return (result.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
}

/** 列出服务端全部工具 */
export async function listTools(token, session) {
  const r = await rpc(token, session, 'tools/list', {});
  if (r.payload?.error) throw new Error('tools/list 失败: ' + JSON.stringify(r.payload.error));
  return r.payload?.result?.tools || [];
}
