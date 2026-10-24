# Claude Code 参考源码映射

参考目录：`C:\Users\55038\Downloads\claude-code-main\claude-code-main`。

该目录包含约 1,904 个 TypeScript/TSX 源文件，但缺少根级 `package.json`、锁文件和许可证，因此 CCPT 使用它确认产品行为和架构边界，不整树复制或假定能够独立构建。移植时必须在 CCPT 的零运行时依赖、企业策略和测试约束下重新实现。

| 能力 | 主要参考源码 | CCPT 对应位置 | 当前动作 |
|---|---|---|---|
| Checkpoint/Rewind | `src/utils/fileHistory.ts`, `src/commands/rewind/` | `src/checkpoints.ts` | 已实现内容寻址备份、按轮快照和最近 100 个快照保留；待捕获外部 Shell/IDE 编辑 |
| 子 Agent/Fork | `src/tools/AgentTool/forkSubagent.ts` | `src/agent.ts` | 已支持 isolated/fork、独立 Session、继承会话和递归 fork 保护；权限 bubble 待实现 |
| Task/后台任务 | `src/tasks/`, `src/utils/tasks.ts`, `src/tools/Task*` | `src/tasks.ts`, `src/tasks/LocalShellTask/`, `src/tools/TaskOutputTool/`, `src/tools/TaskStopTool/` | 已有持久任务、依赖、原子认领、后台 Shell worker、日志输出和停止；待增加 Workflow/Remote/Dream 分类 |
| Agent Team | `src/utils/swarm/`, `src/utils/teammateMailbox.ts` | `src/agent.ts`, `src/tasks.ts`, `src/mailbox.ts` | 已实现发现和持久 mailbox；team lifecycle、lead/coordinator 待实现 |
| Hooks | `src/schemas/hooks.ts`, `src/utils/hooks/` | `src/hooks.ts` | 已实现 command/HTTP/prompt/agent、matcher/if、决策输出、SSRF 防护和 Header 环境变量白名单；剩余事件发射点继续接入 |
| Permissions | `src/utils/permissions/`, `src/components/permissions/` | `src/policy.ts`, `src/utils/permissions/` | 已实现规则转义/解析、命令参数匹配、deny > ask > allow、运行时拒绝、Hook/Audit 和确定性解释；待补交互式许可 UI、临时授权更新和模型风险解释 |
| Sandbox | `src/utils/sandbox/`, `src/tools/BashTool/` | `src/policy.ts` | 继续使用企业 wrapper；按参考行为补失败原因与受控重试 |
| Notebook | `src/tools/NotebookEditTool/`, `src/utils/notebook.ts` | `src/notebooks.ts` | 已实现读取、替换、插入、删除和清理旧输出 |
| LSP | `src/tools/LSPTool/`, `src/services/lsp/` | `src/tools/LSPTool/`, `src/services/lsp/` | 已实现 stdio JSON-RPC、配置选择和九类查询；待补连接池、诊断注册表和被动反馈 |
| MCP | `src/services/mcp/`, `src/tools/*Mcp*` | `src/mcp.ts`, `src/tools/ListMcpResourcesTool/`, `src/tools/ReadMcpResourceTool/` | 已补 Resources、Prompts、分页和二进制输出存储；待补重连管理器、Elicitation 和动态列表通知 |
| Web | `src/tools/WebSearchTool/`, `src/tools/WebFetchTool/` | 待新增 | 待接入网络策略与许可规则 |
| SDK | `src/entrypoints/agentSdkTypes.ts`, `src/entrypoints/sdk/` | `src/entrypoints/agentSdkTypes.ts`, `src/entrypoints/sdk.ts`, `src/entrypoints/sdk/` | 已实现类型化生命周期事件流和独立构建入口；待补审批回调和完整 control schema |
| Output Styles | `src/outputStyles/` | `src/outputStyles/`, `src/agent.ts` | 已实现用户/项目 Markdown 风格、frontmatter、项目优先级、选择和热重载；待补 Plugin 强制风格 |
| Keybindings/Vim | `src/keybindings/`, `src/vim/` | `src/keybindings/`, `src/vim/`, `src/tui.ts` | 已实现别名、Chord、覆盖/解绑、命令动作、TUI 路由和 Vim 核心模式/动作；待补高级 Text Object 与 dot-repeat |
| Migrations/Coordinator | `src/migrations/`, `src/coordinator/` | `src/migrations/`, `src/coordinator/`, `src/agent.ts` | 已实现锁定版本迁移与协调器工具隔离；待补远程订阅与 Claude 专属迁移（不直接复制模型名） |
| Direct Connect/Remote Bridge | `src/server/`, `src/remote/`, `src/bridge/`, `src/upstreamproxy/` | 同路径目录 | 已实现会话创建、WebSocket 重连/心跳、SDK 消息适配、远程权限、JWT/可信设备、入站消息与附件、有序 ACK、状态指针和 CONNECT-over-WebSocket；待与实际部署端做端到端互操作测试 |
| State/Types/Native fallback | `src/state/`, `src/context/`, `src/types/`, `src/native-ts/` | 同路径目录 | 已实现非 React 运行时状态订阅、上下文容器、协议类型、文件索引、颜色距离与布局回退；参考 Ink/React 渲染绑定仍待补 |

逐文件状态不再由 Epic 推断，统一由 `npm run coverage` 生成到 `docs/SOURCE-COVERAGE.md` 与 `docs/SOURCE-COVERAGE.json`；只有带行为证据的覆盖项才写入 `docs/SOURCE-COVERAGE-OVERRIDES.json`。
