# CCPT 企业部署指南

## 配置优先级

配置按“默认值 → 用户配置 → 项目配置 → 托管配置”合并，托管配置最后生效。支持：

- Windows：`HKLM\Software\Policies\CCPT` 的 `ManagedConfig` 字符串值。
- macOS：`/Library/Managed Preferences/com.ccpt.plist` 的 `ManagedConfig`。
- Linux：`/etc/ccpt/managed-settings.json`。
- 跨平台：`CCPT_MANAGED_CONFIG` 指向只读 JSON 文件。

示例：

```json
{
  "policy": {
    "mode": "sandbox",
    "workspaceRoots": ["D:\\engineering"],
    "allowNetwork": true,
    "allowedCommands": ["git", "npm", "node", "rg", "tsc"],
    "deniedCommands": ["rm", "rmdir", "del", "format", "shutdown"],
    "protectedPatterns": [".env", ".ssh", ".aws", "credentials", "id_rsa"],
    "allowGitPush": false,
    "allowPullRequests": false,
    "processWrapper": "D:\\enterprise\\ccpt-process-wrapper.exe",
    "allowedEnvironmentVariables": ["PATH", "PATHEXT", "SYSTEMROOT", "TEMP", "HTTPS_PROXY", "NO_PROXY"],
    "commandTimeoutMs": 300000
  },
  "agents": {
    "maxConcurrent": 4,
    "maxPerSession": 12,
    "maxDepth": 2,
    "defaultIsolation": "worktree",
    "maxTurns": 24,
    "heartbeatTimeoutMs": 30000,
    "worktreeCleanup": "manual"
  },
  "disabledPlugins": ["unapproved-pack"]
}
```

`processWrapper` 接收的参数是：`wrapper <真实可执行文件> <参数...>`。CCPT 不使用 Shell 拼接命令。sandbox 模式未配置 wrapper 时，命令、Hook、stdio MCP 和后台进程执行会失败关闭。

## 网络与模型平台

```json
{
  "network": {
    "proxyUrl": "http://proxy.company.example:8080",
    "allowedHosts": ["models.company.example", "mcp.company.example"],
    "caFile": "D:\\certs\\enterprise-ca.pem",
    "clientCertFile": "D:\\certs\\developer.pem",
    "clientKeyFile": "D:\\certs\\developer-key.pem",
    "rejectUnauthorized": true,
    "timeoutMs": 120000
  },
  "model": {
    "provider": "compatible",
    "name": "approved-coding-model",
    "endpointUrl": "https://models.company.example/v1/chat/completions",
    "apiKeyHeader": "authorization",
    "apiKeyPrefix": "Bearer ",
    "maxContextTokens": 1000000,
    "maxOutputTokens": 8192
  }
}
```

本地服务和企业模型网关使用同一套 tool-calling Chat Completions 契约。AWS、Google Cloud 和 Microsoft 的企业模型环境可以通过组织批准的兼容端点或网关接入；带部署路径/API 版本的完整地址使用 `endpointUrl`。密钥只从 `CCPT_API_KEY` 或 `headersFromEnvironment` 引用的环境变量读取。

HTTP/HTTPS 代理、`NO_PROXY`、自定义 CA、TLS 检查和 mTLS 由统一网络层处理，模型、HTTP MCP、OAuth 登录与令牌刷新不会绕开这套设置。
`allowedHosts` 非空时只允许列出的外部目标（支持 `*.company.example` 形式的子域规则）；`NO_PROXY` 只控制代理路由，不能绕过目标白名单。

## 权限等级

- `bypass`：允许配置范围内的全部环境与命令，仅适用于隔离且受信环境。
- `normal`：工作区边界、保护路径、命令允许列表、Hook 和审计生效。
- `sandbox`：在 normal 基础上要求企业进程 wrapper，并对进程环境使用显式允许列表。
- `restricted`：禁止写文件、执行进程、Hook、外部模型网络和外部 MCP；允许工作区只读工具和 loopback 服务。

所有文件路径都经过真实路径检查，阻止符号链接逃逸。命令参数不接受 Shell 运算符。子进程环境默认移除凭据型变量，模型凭据不会传给工具、Hook 或 MCP 子进程。
受保护路径同时从读取、文件枚举、全文搜索和仓库上下文中排除。`git_push` 与 Draft PR 默认禁用，只有 `allowGitPush` / `allowPullRequests` 明确开启或使用 `bypass` 模式时才可执行。

## 审计与生命周期

每日 JSONL 审计位于 CCPT 用户状态目录的 `audit/`。可用 `ccpt audit YYYY-MM-DD` 查询。Hook 支持 SessionStart、PreToolUse、PostToolUse、PermissionRequest、TaskCompleted、TeammateIdle、WorktreeCreate、WorktreeRemove、ConfigChange 和 Setup。
审计写入前会递归隐藏令牌、认证头、URL 凭据及已知凭据环境变量值。

## 推荐发布流程

1. 在团队仓库维护 Skills、Agents、Plugins、Hooks 和 MCP 清单。
2. 对 Plugin 执行 `ccpt plugin validate` 和 `ccpt plugin hash`。
3. 通过托管配置固定插件目录、禁用列表、网络和权限边界。
4. 在 CI 使用 `ccpt --restricted` 做只读分析；需要构建时使用带企业 wrapper 的 sandbox。
5. 使用 `ccpt doctor`、测试和审计日志验证工作站策略。

## 外部 Surface Adapter

JetBrains、Desktop、Cloud、Browser、Computer Use、GitHub/GitLab、SSO/Admin 和 Runner 通过统一的受控 HTTP Adapter 接入。默认清单是项目的 `.ccpt/surfaces.json`，也可以通过 `CCPT_SURFACE_MANIFEST` 或 CLI 的 `--surface-manifest` 指定。

```json
{
  "adapters": [
    {
      "name": "browser",
      "kind": "browser",
      "endpoint": "https://browser-adapter.company.example/v1/",
      "tokenEnv": "CCPT_BROWSER_ADAPTER_TOKEN",
      "capabilities": ["navigate", "inspect-dom", "screenshot", "click", "type"]
    }
  ]
}
```

```powershell
ccpt surface list
ccpt surface health browser
ccpt surface invoke browser navigate --json '{"url":"https://intranet.example"}'
```

外部地址必须使用 HTTPS（loopback 测试服务除外），仍受 `network.allowedHosts`、代理、CA、mTLS 和超时配置约束。Token 与附加 Header 只从清单引用的环境变量读取，不写入清单、输出或审计内容。调用前必做健康检查和能力校验；未安装、不健康或未声明能力时失败关闭。
