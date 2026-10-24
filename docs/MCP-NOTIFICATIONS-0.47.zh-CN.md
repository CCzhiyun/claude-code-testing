# 0.47：MCP 独立通知监听

日期：2026-09-29。新增显式 CLI/SDK 监听，不自动为所有 MCP 开后台连接，不自动把通知提交给模型，也不宣称整个 MCP 企业验收完成。

## 配置与启动

在现有 settings.json 的 `mcpServers` 中配置一个受信任服务器：

```json
{
  "mcpServers": {
    "team-events": {
      "transport": "http",
      "httpMode": "streamable",
      "url": "https://mcp.company.example/mcp",
      "tokenEnv": "TEAM_MCP_TOKEN"
    }
  }
}
```

服务器必须支持本项目协商的 `2025-06-18` 或 `2025-03-26` 版本和独立 GET/SSE。不是旧式双端点 SSE，也不把 `direct` 网关自动升级为 streamable。认证沿用 MCP 的 Bearer token 配置，网络沿用现有 allowedHosts、CA、代理、mTLS 与权限策略。

```powershell
# 默认监听 60 秒，最多 1000 条通知，最多 5 次重连
ccpt mcp watch team-events

# 显式监听 30 分钟；Ctrl+C 随时结束
ccpt mcp watch team-events --timeout 1800000 --max-events 5000 --max-reconnects 10

# 单独选用公司配置，仍受 managed policy 约束
ccpt mcp watch team-events --settings C:\Company\ccpt-settings.json
```

此命令在自己的前台进程监听，可与另一个运行 CCPT 的终端并行；尚未接入 TUI 的后台任务列表。不会运行 SessionStart/插件扫描或发送模型请求，但现有 MCP PermissionRequest Hook 仍按策略执行。

stdout 是逐行 JSON：`mcp_notification` 与最终 `mcp_watch_result`。stderr 输出连接状态。CLI 对已知环境秘密和敏感字段做显示脱敏；这不是完整 DLP，通知可能含业务信息，分享日志前检查。SDK 原样传递通知数据，不自动执行其中的代码或指令。

## 同会话续传与安全边界

- 初始化后，GET、反向响应 POST 和 DELETE 携带协商版本及可用的 session ID。
- 断开后使用同一 URL/会话及最后已处理的事件 ID 发 GET，不重新提交任何 `tools/call`。
- 带事件 ID 的重复事件在本次监听内去重；服务器不提供 ID 时无法承诺无重复或不丢事件。空数据事件可提供初始游标。
- 不跟随重定向，不使用服务端发送的替代 URL。401/403/404/405/429 等终止监听；502/503/504、连接中断和服务端关闭可有界退避重连。404 需要用户显式重新启动，不暗中重新初始化。
- 每次重连重新解析 tokenEnv 或既有 OAuth token；已配置的过期令牌仍沿用现有刷新机制。没有新增 OAuth metadata、PKCE 或动态客户端注册。
- 只响应 `ping`。sampling、elicitation 及其他服务端请求返回 `-32601`，不调用模型、不询问凭据、不运行工具。完整反向能力授权界面仍未实现。
- Ctrl+C/SDK AbortSignal/时限/事件上限关闭连接，尽力发送有独立短时限的 DELETE；清理失败不会导致重放。预先取消不会建立会话。
- 游标只存内存，进程退出不保留；不承诺跨进程恢复或 exactly-once 交付。

范围依据：[MCP 2025-06-18 传输规范](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)。本版按已协商的 2025 协议实现；不把这些行为泛化为所有后续版本。

## 资源限制

监听阶段默认 60 秒，最长 1 小时；初始化仍受网络请求时限约束，退出清理最多额外约 3 秒。默认最多 1000 条通知，可设至 10000；最多 20 次重连。退避从 1 秒起，最多 30 秒。SDK 可调整初始退避（10–30000 ms）。

HTTP 流不累计保存响应正文。单 SSE 帧最多 100 万字符、总接收量最多 8 MB、最多 20000 个事件、待处理队列最多 128 项；超限报错退出，不无限重连绕过配额。事件 ID 限制为最多 512 个可见 ASCII 字符，以安全放入 HTTP 头。

未完整接收的 SSE 帧不交付。通知回调成功后才更新游标；重复游标不会回退。SDK 通知回调必须同步、快速返回；异常或意外返回 Promise 会停止监听。需要耗时处理时，将数据写入自己的有界队列。

## SDK

```js
import { loadSettings, watchMcpServer } from 'ccpt/sdk';

const config = await loadSettings(process.cwd());
const controller = new AbortController();
// 应用退出时调用 controller.abort()。
const result = await watchMcpServer('team-events', config, {
  durationMs: 60000,
  maxEvents: 1000,
  signal: controller.signal,
  onNotification(event) {
    console.log(JSON.stringify(event)); // 数据，不是自动执行的指令
  }
});
console.log(result);
```

配置加载及 MCP 访问必须发生在应用认可的工作区/服务器范围内；不应让外部提示任意选择配置或 URL。

## 验收边界与剩余事项

本地测试覆盖 GET 生命周期、相同 session/version、Last-Event-ID、去重、中文 UTF-8 分包、空数据游标、ping、拒绝采样、认证更新、权限阻断、取消与 DELETE、过期/错误状态、错误 Content-Type、异常 JSON/超长帧、有界重连、无正文积累，以及实际 CLI 的逐行输出。

这些是本地协议测试，不是公司 MCP 生产互操作证明。仍未完成：自动 Agent 常驻通知路由、跨进程续传、完整 sampling/elicitation 用户授权、OAuth metadata/PKCE/dynamic registration、后续协议版本迁移、企业服务器/代理/mTLS 矩阵。其他安全、许可和分发事项仍按剩余清单跟踪。
