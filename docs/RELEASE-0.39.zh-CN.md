# CCPT 0.39：上下文恢复与任务管理验收

## 本轮交付

- Settings 的 Maximum context tokens / Maximum output tokens 可编辑，输入必须是正整数。窗口应按实际部署填写，填大不等于模型支持大窗口。
- `--max-context`、`--max-output` 设置本次运行；`config set` 可保存项目设置，加 `--global` 保存用户设置。
- Agent 对本地预算超限和明确的服务端超限执行旧轮次归档压缩，每个请求最多重试两次；界面、会话记录和审计包含恢复信息。
- `/agents`、`/tasks` 详情可按 `x` 停止，非运行中 Agent 可按 `a` 接续；Enter 二次确认，Esc 取消。打开或接续历史不会自行发出模型请求。
- `/mcp` 详情按 `t` 测试连接并发现工具，先确认；不会调用业务工具。查看列表本身不连接服务器。
- HTTP MCP 增加显式 `streamable` 模式：初始化、协商版本、会话头、JSON/SSE 响应、工具/资源/提示词分页和会话清理。旧接口默认 `direct`，避免破坏兼容。
- HTTP 响应增加可选大小/总时限保护；MCP 启动失败、重复游标、RPC 错误和过期会话明确报错。已发出的工具调用不会自动重放。
- 取消状态受锁保护，旧工作线程不能覆盖回运行中；同进程取消后，后续模型/工具边界停止，必须等旧 worker 退出再继续。

## 配置与操作

```cmd
ccpt --max-context 32768 --max-output 4096
ccpt config set --max-context 32768 --max-output 4096
ccpt mcp add internal --url https://YOUR-SERVER/mcp --http-mode streamable
```

Settings：`/config` → 输入字段名过滤 → Enter 进入列表 → Space 编辑 → Enter 暂存 → Enter 保存。Esc 可取消编辑/关闭未保存设置。

MCP 文件配置示例（写入项目 `.ccpt/settings.json`）：

```json
{
  "mcpServers": {
    "internal": {
      "transport": "http",
      "httpMode": "streamable",
      "url": "https://YOUR-SERVER/mcp",
      "tokenEnv": "INTERNAL_MCP_TOKEN"
    }
  }
}
```

## 上下文恢复边界

1. Auto-compact 必须开启；关闭后会明确提示，不替用户改变设置。
2. 仅处理明确的输入/上下文超限。鉴权、限流、网络失败、一般 413、非法输出参数不会被当作上下文问题重试。
3. 已输出文本/思考后不自动重放。服务端明确报告较小窗口时，只降低该 worker 内的运行配置，不修改全局模型和设置。
4. 先保存完整归档再重试；摘要为有界原文摘录，不是模型生成的语义总结。工具调用和结果成对保留。
5. 最新单轮、巨大工具结果、系统指令或工具定义本身超过预算时，可能无法恢复：提示 `/context`、缩小输入/工具输出、减少扩展或调整输出预算。不静默截断最新轮次，也不谎称扩容到 1M。
6. 失败请求如未返回用量，无法推断实际计费；不能把恢复次数当作额外 token 的精确计算。

## 验收证据与限制

2026-09-22：完整测试 276 项通过、0 失败（51 个文件）；最后的界面提示调整后定向回归 26 项通过、0 失败。TypeScript 检查与 Node 目标构建通过。发布包检查仅包含 dist、文档与扩展，不含用户 settings/凭据。

新测试：`context-recovery.test.ts`、`mcp-streamable.test.ts`、`task-management.test.ts`、`terminal-management-integration.test.ts`。覆盖本地服务端返回的两种 API 错误、实际 TUI 按键、取消/确认路径及真实 Agent 请求循环，不消耗企业模型额度。

已读取用户提供归档中的压缩和查询相关实现，并运行参考 CLI 的 `--help` 作只读对照。本轮借鉴输出预留、提前压缩、失败熔断和历史持久化的设计，未复制其全部实现，也没有向真实模型发送超长付费请求来制造溢出。

协议依据：[MCP HTTP transport](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)、[MCP tools pagination](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)。这里只实现子集：没有独立 GET SSE 常驻订阅、断线续传、服务端 sampling/elicitation 请求执行或跨业务调用的常驻连接。每次业务操作新建/关闭会话，分页在同一会话中完成。

停止不是事务回滚：已经完成的改动保留，正在执行的工具可能继续到返回；跨进程硬终止可能留下未完整的工具交换。运行中的 worktree 取消后保留，需确认进程停止后人工清理。

企业 OAuth/代理/mTLS 真实联调、全部 IDE 操作、并发 worktree 冲突集成、插件完整安全验收及全部 US 逐项等价仍未完成。这是增量交付，不代表整个平台已达到企业生产认证。

## 分发

```cmd
npm install --global C:\path\to\ccpt-0.39.0.tgz
ccpt
```

组员只需 Node.js 20+，无需 EXE。源码构建需要 Bun：`npm install` → `npm run check` → `npm test` → `npm run build` → `npm pack`。本轮仅本地打包和安装，不发布公共 npm。
