# 完整 User Story 可追踪矩阵

> 历史登记快照：本表保留最初审计输入，不再作为当前完成状态。Epic enhancement 后的 415 条逐项证据、状态和外部集成边界以 `EPIC-ENHANCEMENT-MATRIX.md` / `.json` 为准，并可通过 `npm run epics` 重新生成。

生成来源：用户提供的 Claude Code Complete Product User Stories（2026-08-28 scope）。本表与旧版 25 项验收矩阵并存，但不把旧矩阵的通过状态外推到新需求。

- User Story 总数：415
- 已登记“已实现”：22
- 已登记“部分实现”：6
- 待实现或待逐条审计：387

“待实现/审计”不表示一定完全缺失，而是表示尚未有逐条测试证据，不能宣称完成。每次实现必须同时更新状态、源码证据和测试证据。

| User Story | Epic | 标题 | 状态 | 实现证据与剩余边界 |
|---|---|---|---|---|
| US-2.1 | Core Agentic Coding Engine | Autonomous Agentic Loop | 待实现/审计 | 尚未登记可执行证据 |
| US-2.2 | Core Agentic Coding Engine | Read Project Files | 待实现/审计 | 尚未登记可执行证据 |
| US-2.3 | Core Agentic Coding Engine | Search the Repository | 待实现/审计 | 尚未登记可执行证据 |
| US-2.4 | Core Agentic Coding Engine | Write New Files | 待实现/审计 | 尚未登记可执行证据 |
| US-2.5 | Core Agentic Coding Engine | Edit Existing Files | 待实现/审计 | 尚未登记可执行证据 |
| US-2.6 | Core Agentic Coding Engine | Execute Shell Commands | 待实现/审计 | 尚未登记可执行证据 |
| US-2.7 | Core Agentic Coding Engine | Persistent Working Directory | 待实现/审计 | 尚未登记可执行证据 |
| US-2.8 | Core Agentic Coding Engine | Notebook Editing | 已实现 | `src/notebooks.ts`, `src/tooling.ts`, `test/notebook.test.ts`：读取、替换、插入、删除并清理代码单元旧输出 |
| US-2.9 | Core Agentic Coding Engine | Language Server Integration | 待实现/审计 | 尚未登记可执行证据 |
| US-2.10 | Core Agentic Coding Engine | Ask Structured Questions | 待实现/审计 | 尚未登记可执行证据 |
| US-2.11 | Core Agentic Coding Engine | Plan Mode | 待实现/审计 | 尚未登记可执行证据 |
| US-2.12 | Core Agentic Coding Engine | Web Search | 待实现/审计 | 尚未登记可执行证据 |
| US-2.13 | Core Agentic Coding Engine | Web Content Fetching | 待实现/审计 | 尚未登记可执行证据 |
| US-2.14 | Core Agentic Coding Engine | Task Management | 部分实现 | `src/tasks.ts`, `src/tooling.ts`：持久任务、依赖、状态更新；自动调度仍待实现 |
| US-2.15 | Core Agentic Coding Engine | Background Command Monitoring | 待实现/审计 | 尚未登记可执行证据 |
| US-2.16 | Core Agentic Coding Engine | Send Files to the User | 待实现/审计 | 尚未登记可执行证据 |
| US-2.17 | Core Agentic Coding Engine | Push Notifications | 待实现/审计 | 尚未登记可执行证据 |
| US-2.18 | Core Agentic Coding Engine | End a Conversation Deliberately | 待实现/审计 | 尚未登记可执行证据 |
| US-3.1 | Context, Memory, and Project Understanding | Context Window Management | 待实现/审计 | 尚未登记可执行证据 |
| US-3.2 | Context, Memory, and Project Understanding | Automatic Context Compaction | 待实现/审计 | 尚未登记可执行证据 |
| US-3.3 | Context, Memory, and Project Understanding | Context Inspection | 待实现/审计 | 尚未登记可执行证据 |
| US-3.4 | Context, Memory, and Project Understanding | Prompt Caching | 待实现/审计 | 尚未登记可执行证据 |
| US-3.5 | Context, Memory, and Project Understanding | CLAUDE.md Project Instructions | 待实现/审计 | 尚未登记可执行证据 |
| US-3.6 | Context, Memory, and Project Understanding | Hierarchical CLAUDE.md | 待实现/审计 | 尚未登记可执行证据 |
| US-3.7 | Context, Memory, and Project Understanding | Imported Instructions | 待实现/审计 | 尚未登记可执行证据 |
| US-3.8 | Context, Memory, and Project Understanding | AGENTS.md Compatibility | 待实现/审计 | 尚未登记可执行证据 |
| US-3.9 | Context, Memory, and Project Understanding | Modular Rules | 待实现/审计 | 尚未登记可执行证据 |
| US-3.10 | Context, Memory, and Project Understanding | Auto Memory | 待实现/审计 | 尚未登记可执行证据 |
| US-3.11 | Context, Memory, and Project Understanding | Memory Inspection and Editing | 待实现/审计 | 尚未登记可执行证据 |
| US-3.12 | Context, Memory, and Project Understanding | Separate Subagent Memory | 待实现/审计 | 尚未登记可执行证据 |
| US-3.13 | Context, Memory, and Project Understanding | Initialize Project Instructions | 待实现/审计 | 尚未登记可执行证据 |
| US-3.14 | Context, Memory, and Project Understanding | Advanced Interactive Initialization | 待实现/审计 | 尚未登记可执行证据 |
| US-4.1 | Sessions, History, Branching, and Recovery | Persistent Development Sessions | 待实现/审计 | 尚未登记可执行证据 |
| US-4.2 | Sessions, History, Branching, and Recovery | Continue Most Recent Session | 待实现/审计 | 尚未登记可执行证据 |
| US-4.3 | Sessions, History, Branching, and Recovery | Resume a Selected Session | 待实现/审计 | 尚未登记可执行证据 |
| US-4.4 | Sessions, History, Branching, and Recovery | Search Sessions Across Projects | 待实现/审计 | 尚未登记可执行证据 |
| US-4.5 | Sessions, History, Branching, and Recovery | Name and Rename Sessions | 待实现/审计 | 尚未登记可执行证据 |
| US-4.6 | Sessions, History, Branching, and Recovery | Resume by Pull Request | 待实现/审计 | 尚未登记可执行证据 |
| US-4.7 | Sessions, History, Branching, and Recovery | Session Picker Filtering | 待实现/审计 | 尚未登记可执行证据 |
| US-4.8 | Sessions, History, Branching, and Recovery | Fork a Conversation | 待实现/审计 | 尚未登记可执行证据 |
| US-4.9 | Sessions, History, Branching, and Recovery | Background Fork | 已实现 | `src/agent.ts`：fork 模式复制父会话到独立后台 Session，并阻止递归 fork |
| US-4.10 | Sessions, History, Branching, and Recovery | Clear Conversation Context | 待实现/审计 | 尚未登记可执行证据 |
| US-4.11 | Sessions, History, Branching, and Recovery | Export Conversation | 待实现/审计 | 尚未登记可执行证据 |
| US-4.12 | Sessions, History, Branching, and Recovery | Machine-Readable Session Output | 待实现/审计 | 尚未登记可执行证据 |
| US-4.13 | Sessions, History, Branching, and Recovery | Session Recap | 待实现/审计 | 尚未登记可执行证据 |
| US-5.1 | Checkpointing and Rewind | Automatic Code Checkpoints | 部分实现 | `src/checkpoints.ts`, `src/tooling.ts`：write_file 前自动快照；Shell/IDE 编辑自动捕获仍待实现 |
| US-5.2 | Checkpointing and Rewind | Rewind Code and Conversation | 已实现 | `src/checkpoints.ts`, `src/cli.ts`, `src/tui.ts`：代码、对话或同时恢复 |
| US-5.3 | Checkpointing and Rewind | Persistent Checkpoints Across Resume | 已实现 | `src/checkpoints.ts`：checkpoint 持久化在用户状态目录，可跨 resume |
| US-5.4 | Checkpointing and Rewind | Explicit Checkpoint Limitations | 待实现/审计 | 尚未登记可执行证据 |
| US-6.1 | Models, Reasoning, Speed, and Response Behavior | Model Selection | 待实现/审计 | 尚未登记可执行证据 |
| US-6.2 | Models, Reasoning, Speed, and Response Behavior | Model Aliases | 待实现/审计 | 尚未登记可执行证据 |
| US-6.3 | Models, Reasoning, Speed, and Response Behavior | Model Version Pinning | 待实现/审计 | 尚未登记可执行证据 |
| US-6.4 | Models, Reasoning, Speed, and Response Behavior | Model Fallback | 待实现/审计 | 尚未登记可执行证据 |
| US-6.5 | Models, Reasoning, Speed, and Response Behavior | Large Context Models | 待实现/审计 | 尚未登记可执行证据 |
| US-6.6 | Models, Reasoning, Speed, and Response Behavior | Reasoning Effort Control | 待实现/审计 | 尚未登记可执行证据 |
| US-6.7 | Models, Reasoning, Speed, and Response Behavior | Fast Mode | 待实现/审计 | 尚未登记可执行证据 |
| US-6.8 | Models, Reasoning, Speed, and Response Behavior | Advisor | 待实现/审计 | 尚未登记可执行证据 |
| US-6.9 | Models, Reasoning, Speed, and Response Behavior | Output Styles | 待实现/审计 | 尚未登记可执行证据 |
| US-6.10 | Models, Reasoning, Speed, and Response Behavior | Custom Output Styles | 待实现/审计 | 尚未登记可执行证据 |
| US-7.1 | Skills and Reusable Engineering Knowledge | Agent Skills | 待实现/审计 | 尚未登记可执行证据 |
| US-7.2 | Skills and Reusable Engineering Knowledge | Automatic Skill Discovery | 待实现/审计 | 尚未登记可执行证据 |
| US-7.3 | Skills and Reusable Engineering Knowledge | Explicit Skill Invocation | 待实现/审计 | 尚未登记可执行证据 |
| US-7.4 | Skills and Reusable Engineering Knowledge | Lazy Skill Loading | 待实现/审计 | 尚未登记可执行证据 |
| US-7.5 | Skills and Reusable Engineering Knowledge | Skill Supporting Files | 待实现/审计 | 尚未登记可执行证据 |
| US-7.6 | Skills and Reusable Engineering Knowledge | Skill Arguments | 待实现/审计 | 尚未登记可执行证据 |
| US-7.7 | Skills and Reusable Engineering Knowledge | Skill Tool Restrictions | 已实现 | `src/agent.ts`：Skill tools 与 Agent tools 取交集后生成模型工具集 |
| US-7.8 | Skills and Reusable Engineering Knowledge | Skills Running in Subagents | 待实现/审计 | 尚未登记可执行证据 |
| US-7.9 | Skills and Reusable Engineering Knowledge | Dynamic Context Injection | 待实现/审计 | 尚未登记可执行证据 |
| US-7.10 | Skills and Reusable Engineering Knowledge | Skill Evaluation | 待实现/审计 | 尚未登记可执行证据 |
| US-7.11 | Skills and Reusable Engineering Knowledge | Shared Skills | 待实现/审计 | 尚未登记可执行证据 |
| US-7.12 | Skills and Reusable Engineering Knowledge | Bundled Skills and Workflows | 待实现/审计 | 尚未登记可执行证据 |
| US-8.1 | Plugins and Extension Packaging | Plugin Packages | 待实现/审计 | 尚未登记可执行证据 |
| US-8.2 | Plugins and Extension Packaging | Plugin Marketplaces | 待实现/审计 | 尚未登记可执行证据 |
| US-8.3 | Plugins and Extension Packaging | Private Organization Marketplaces | 待实现/审计 | 尚未登记可执行证据 |
| US-8.4 | Plugins and Extension Packaging | Plugin Version Management | 待实现/审计 | 尚未登记可执行证据 |
| US-8.5 | Plugins and Extension Packaging | Namespaced Plugin Skills | 待实现/审计 | 尚未登记可执行证据 |
| US-8.6 | Plugins and Extension Packaging | Plugin Development Tools | 待实现/审计 | 尚未登记可执行证据 |
| US-8.7 | Plugins and Extension Packaging | Organization Plugin Recommendations | 待实现/审计 | 尚未登记可执行证据 |
| US-9.1 | MCP External-System Integration | MCP Client | 待实现/审计 | 尚未登记可执行证据 |
| US-9.2 | MCP External-System Integration | Local MCP Servers | 待实现/审计 | 尚未登记可执行证据 |
| US-9.3 | MCP External-System Integration | Remote MCP Servers | 待实现/审计 | 尚未登记可执行证据 |
| US-9.4 | MCP External-System Integration | MCP Tools | 待实现/审计 | 尚未登记可执行证据 |
| US-9.5 | MCP External-System Integration | MCP Resources | 待实现/审计 | 尚未登记可执行证据 |
| US-9.6 | MCP External-System Integration | MCP Prompts | 待实现/审计 | 尚未登记可执行证据 |
| US-9.7 | MCP External-System Integration | MCP OAuth | 待实现/审计 | 尚未登记可执行证据 |
| US-9.8 | MCP External-System Integration | MCP Login and Logout | 待实现/审计 | 尚未登记可执行证据 |
| US-9.9 | MCP External-System Integration | MCP Headers and Authentication Configuration | 待实现/审计 | 尚未登记可执行证据 |
| US-9.10 | MCP External-System Integration | MCP Reconnection | 待实现/审计 | 尚未登记可执行证据 |
| US-9.11 | MCP External-System Integration | MCP Output Limits | 待实现/审计 | 尚未登记可执行证据 |
| US-9.12 | MCP External-System Integration | MCP Tool Search | 待实现/审计 | 尚未登记可执行证据 |
| US-9.13 | MCP External-System Integration | Managed MCP Policy | 待实现/审计 | 尚未登记可执行证据 |
| US-9.14 | MCP External-System Integration | Claude Code as MCP Server | 待实现/审计 | 尚未登记可执行证据 |
| US-10.1 | Hooks and Lifecycle Automation | Lifecycle Hooks | 部分实现 | `src/types.ts`, `src/hooks.ts`：完整事件类型和多形态执行底座；部分 UI/远程事件发射点待接入 |
| US-10.2 | Hooks and Lifecycle Automation | SessionStart Hook | 已实现 | `src/agent.ts`, `src/hooks.ts`：SessionStart 可注入 additionalContext |
| US-10.3 | Hooks and Lifecycle Automation | Setup Hook | 已实现 | `src/cli.ts`, `src/hooks.ts`：Setup 生命周期 Hook |
| US-10.4 | Hooks and Lifecycle Automation | UserPromptSubmit Hook | 待实现/审计 | 尚未登记可执行证据 |
| US-10.5 | Hooks and Lifecycle Automation | UserPromptExpansion Hook | 待实现/审计 | 尚未登记可执行证据 |
| US-10.6 | Hooks and Lifecycle Automation | PreToolUse Hook | 已实现 | `src/tooling.ts`, `src/hooks.ts`：PreToolUse matcher/if、阻断和 updatedInput |
| US-10.7 | Hooks and Lifecycle Automation | PermissionRequest Hook | 待实现/审计 | 尚未登记可执行证据 |
| US-10.8 | Hooks and Lifecycle Automation | PermissionDenied Hook | 待实现/审计 | 尚未登记可执行证据 |
| US-10.9 | Hooks and Lifecycle Automation | PostToolUse Hook | 已实现 | `src/tooling.ts`, `src/hooks.ts`：PostToolUse Hook |
| US-10.10 | Hooks and Lifecycle Automation | PostToolUseFailure Hook | 已实现 | `src/agent.ts`, `src/hooks.ts`：PostToolUseFailure Hook |
| US-10.11 | Hooks and Lifecycle Automation | PostToolBatch Hook | 已实现 | `src/agent.ts`, `src/hooks.ts`：PostToolBatch Hook |
| US-10.12 | Hooks and Lifecycle Automation | Notification Hook | 待实现/审计 | 尚未登记可执行证据 |
| US-10.13 | Hooks and Lifecycle Automation | MessageDisplay Hook | 待实现/审计 | 尚未登记可执行证据 |
| US-10.14 | Hooks and Lifecycle Automation | SubagentStart Hook | 已实现 | `src/agent.ts`：SubagentStart Hook |
| US-10.15 | Hooks and Lifecycle Automation | SubagentStop Hook | 已实现 | `src/agent.ts`：SubagentStop Hook 覆盖成功与失败 |
| US-10.16 | Hooks and Lifecycle Automation | TaskCreated Hook | 部分实现 | `src/tooling.ts`：模型创建任务时触发 TaskCreated；Agent 自动任务创建 Hook 待统一 |
| US-10.17 | Hooks and Lifecycle Automation | TaskCompleted Hook | 已实现 | `src/agent.ts`：任务完成与 Agent 完成同步 |
| US-10.18 | Hooks and Lifecycle Automation | Stop Hook | 待实现/审计 | 尚未登记可执行证据 |
| US-10.19 | Hooks and Lifecycle Automation | StopFailure Hook | 待实现/审计 | 尚未登记可执行证据 |
| US-10.20 | Hooks and Lifecycle Automation | TeammateIdle Hook | 待实现/审计 | 尚未登记可执行证据 |
| US-10.21 | Hooks and Lifecycle Automation | InstructionsLoaded Hook | 待实现/审计 | 尚未登记可执行证据 |
| US-10.22 | Hooks and Lifecycle Automation | ConfigChange Hook | 待实现/审计 | 尚未登记可执行证据 |
| US-10.23 | Hooks and Lifecycle Automation | CwdChanged Hook | 待实现/审计 | 尚未登记可执行证据 |
| US-10.24 | Hooks and Lifecycle Automation | DirectoryAdded Hook | 待实现/审计 | 尚未登记可执行证据 |
| US-10.25 | Hooks and Lifecycle Automation | FileChanged Hook | 待实现/审计 | 尚未登记可执行证据 |
| US-10.26 | Hooks and Lifecycle Automation | WorktreeCreate Hook | 待实现/审计 | 尚未登记可执行证据 |
| US-10.27 | Hooks and Lifecycle Automation | WorktreeRemove Hook | 待实现/审计 | 尚未登记可执行证据 |
| US-10.28 | Hooks and Lifecycle Automation | PreCompact Hook | 待实现/审计 | 尚未登记可执行证据 |
| US-10.29 | Hooks and Lifecycle Automation | PostCompact Hook | 待实现/审计 | 尚未登记可执行证据 |
| US-10.30 | Hooks and Lifecycle Automation | Elicitation Hooks | 待实现/审计 | 尚未登记可执行证据 |
| US-10.31 | Hooks and Lifecycle Automation | SessionEnd Hook | 待实现/审计 | 尚未登记可执行证据 |
| US-10.32 | Hooks and Lifecycle Automation | Multiple Hook Implementations | 已实现 | `src/hooks.ts`：command、HTTP、prompt、agent 四种 Hook；HTTP 含 SSRF 防护和环境变量白名单 |
| US-11.1 | Subagents | Specialized Subagents | 待实现/审计 | 尚未登记可执行证据 |
| US-11.2 | Subagents | Separate Agent Context | 已实现 | `src/agent.ts`：子 Agent 创建独立 session，teamSessionId 只用于团队归属 |
| US-11.3 | Subagents | Built-In Explore Agent | 待实现/审计 | 尚未登记可执行证据 |
| US-11.4 | Subagents | Built-In Plan Agent | 待实现/审计 | 尚未登记可执行证据 |
| US-11.5 | Subagents | General-Purpose Agent | 待实现/审计 | 尚未登记可执行证据 |
| US-11.6 | Subagents | Custom Agent Definitions | 待实现/审计 | 尚未登记可执行证据 |
| US-11.7 | Subagents | Agent-Specific Model | 待实现/审计 | 尚未登记可执行证据 |
| US-11.8 | Subagents | Agent-Specific Tools | 待实现/审计 | 尚未登记可执行证据 |
| US-11.9 | Subagents | Agent-Specific Permissions | 待实现/审计 | 尚未登记可执行证据 |
| US-11.10 | Subagents | Agent-Specific Hooks | 待实现/审计 | 尚未登记可执行证据 |
| US-11.11 | Subagents | Agent-Specific Skills | 待实现/审计 | 尚未登记可执行证据 |
| US-11.12 | Subagents | Agent Turn Limits | 待实现/审计 | 尚未登记可执行证据 |
| US-11.13 | Subagents | Persistent Agent Memory | 待实现/审计 | 尚未登记可执行证据 |
| US-11.14 | Subagents | Background Subagents | 待实现/审计 | 尚未登记可执行证据 |
| US-11.15 | Subagents | Resume Agents | 待实现/审计 | 尚未登记可执行证据 |
| US-11.16 | Subagents | Agent Worktree Isolation | 待实现/审计 | 尚未登记可执行证据 |
| US-11.17 | Subagents | Nested Agent Delegation | 待实现/审计 | 尚未登记可执行证据 |
| US-12.1 | Agent View and Background Agent Management | Agent Dashboard | 待实现/审计 | 尚未登记可执行证据 |
| US-12.2 | Agent View and Background Agent Management | Agent Status | 待实现/审计 | 尚未登记可执行证据 |
| US-12.3 | Agent View and Background Agent Management | Inspect Agent Progress | 待实现/审计 | 尚未登记可执行证据 |
| US-12.4 | Agent View and Background Agent Management | Reply to an Agent | 已实现 | `src/mailbox.ts`, `src/cli.ts`, `src/tui.ts`：可向运行中或持久 Agent 直接发送消息 |
| US-12.5 | Agent View and Background Agent Management | Attach and Detach | 待实现/审计 | 尚未登记可执行证据 |
| US-12.6 | Agent View and Background Agent Management | Persistent Background Supervisor | 待实现/审计 | 尚未登记可执行证据 |
| US-12.7 | Agent View and Background Agent Management | Organize Agents | 待实现/审计 | 尚未登记可执行证据 |
| US-12.8 | Agent View and Background Agent Management | Machine-Readable Agent List | 待实现/审计 | 尚未登记可执行证据 |
| US-13.1 | Agent Teams | Multi-Agent Team | 部分实现 | `src/agent.ts`, `src/mailbox.ts`, `src/tasks.ts`：团队归属、成员发现、共享任务和消息；显示模式与质量门待实现 |
| US-13.2 | Agent Teams | Shared Task List | 部分实现 | `src/tasks.ts`：共享持久任务列表、依赖、状态和原子认领；Supervisor 自动调度待实现 |
| US-13.3 | Agent Teams | Direct Agent-to-Agent Messaging | 已实现 | `src/mailbox.ts`, `src/tooling.ts`：同团队 Agent 间持久直接消息与未读状态 |
| US-13.4 | Agent Teams | Lead Agent | 待实现/审计 | 尚未登记可执行证据 |
| US-13.5 | Agent Teams | Agent Team Display Modes | 待实现/审计 | 尚未登记可执行证据 |
| US-13.6 | Agent Teams | Plan-First Team Members | 待实现/审计 | 尚未登记可执行证据 |
| US-13.7 | Agent Teams | Task Claiming | 已实现 | `src/tasks.ts`：文件锁保护的原子任务认领、依赖检查和唯一 owner |
| US-13.8 | Agent Teams | Controlled Teammate Shutdown | 待实现/审计 | 尚未登记可执行证据 |
| US-13.9 | Agent Teams | Agent Quality Gates | 待实现/审计 | 尚未登记可执行证据 |
| US-13.10 | Agent Teams | Parallel Review | 待实现/审计 | 尚未登记可执行证据 |
| US-13.11 | Agent Teams | Competing Hypotheses | 待实现/审计 | 尚未登记可执行证据 |
| US-14.1 | Cross-Session Agent Communication | Discover Other Agents | 已实现 | `src/mailbox.ts`：按 teamSessionId 发现全部 Agent 及独立 Session |
| US-14.2 | Cross-Session Agent Communication | Send Messages Across Sessions | 已实现 | `src/mailbox.ts`：跨 Session 持久消息收件箱 |
| US-14.3 | Cross-Session Agent Communication | Cross-Worktree Coordination | 已实现 | `src/mailbox.ts`：mailbox 位于共享状态目录，不依赖 Agent worktree |
| US-14.4 | Cross-Session Agent Communication | Cross-Machine Communication | 待实现/审计 | 尚未登记可执行证据 |
| US-14.5 | Cross-Session Agent Communication | Inbound Message Policies | 待实现/审计 | 尚未登记可执行证据 |
| US-15.1 | Dynamic Workflows | Runtime-Generated Workflows | 待实现/审计 | 尚未登记可执行证据 |
| US-15.2 | Dynamic Workflows | Background Workflow Runtime | 待实现/审计 | 尚未登记可执行证据 |
| US-15.3 | Dynamic Workflows | Large Agent Fan-Out | 待实现/审计 | 尚未登记可执行证据 |
| US-15.4 | Dynamic Workflows | Workflow Approval | 待实现/审计 | 尚未登记可执行证据 |
| US-15.5 | Dynamic Workflows | Workflow Re-Run | 待实现/审计 | 尚未登记可执行证据 |
| US-15.6 | Dynamic Workflows | Workflow Distribution | 待实现/审计 | 尚未登记可执行证据 |
| US-15.7 | Dynamic Workflows | Deep Research Workflow | 待实现/审计 | 尚未登记可执行证据 |
| US-15.8 | Dynamic Workflows | Per-File Parallel Operations | 待实现/审计 | 尚未登记可执行证据 |
| US-15.9 | Dynamic Workflows | Iterative Fix-Until-Pass Workflow | 待实现/审计 | 尚未登记可执行证据 |
| US-16.1 | Git Worktrees and Code Isolation | Start Claude in a Worktree | 待实现/审计 | 尚未登记可执行证据 |
| US-16.2 | Git Worktrees and Code Isolation | Agent-Created Worktrees | 待实现/审计 | 尚未登记可执行证据 |
| US-16.3 | Git Worktrees and Code Isolation | Exit and Clean Up Worktrees | 待实现/审计 | 尚未登记可执行证据 |
| US-16.4 | Git Worktrees and Code Isolation | Include Additional Files | 待实现/审计 | 尚未登记可执行证据 |
| US-16.5 | Git Worktrees and Code Isolation | Worktree Environment Hooks | 待实现/审计 | 尚未登记可执行证据 |
| US-16.6 | Git Worktrees and Code Isolation | Alternative VCS Isolation | 待实现/审计 | 尚未登记可执行证据 |
| US-16.7 | Git Worktrees and Code Isolation | Explicit Shared vs Isolated State | 待实现/审计 | 尚未登记可执行证据 |
| US-17.1 | Batch Development | Batch Implementation | 待实现/审计 | 尚未登记可执行证据 |
| US-18.1 | Scheduled and Autonomous Work | In-Session Scheduled Tasks | 待实现/审计 | 尚未登记可执行证据 |
| US-18.2 | Scheduled and Autonomous Work | `/loop` | 待实现/审计 | 尚未登记可执行证据 |
| US-18.3 | Scheduled and Autonomous Work | Cron Scheduling | 待实现/审计 | 尚未登记可执行证据 |
| US-18.4 | Scheduled and Autonomous Work | One-Time Wakeups | 待实现/审计 | 尚未登记可执行证据 |
| US-18.5 | Scheduled and Autonomous Work | `/goal` | 待实现/审计 | 尚未登记可执行证据 |
| US-18.6 | Scheduled and Autonomous Work | Goal Persistence Across Resume | 待实现/审计 | 尚未登记可执行证据 |
| US-18.7 | Scheduled and Autonomous Work | Remote Routines | 待实现/审计 | 尚未登记可执行证据 |
| US-18.8 | Scheduled and Autonomous Work | Routine Inputs | 待实现/审计 | 尚未登记可执行证据 |
| US-18.9 | Scheduled and Autonomous Work | Run History | 待实现/审计 | 尚未登记可执行证据 |
| US-19.1 | Channels and Event-Driven Claude Sessions | External Event Channels | 待实现/审计 | 尚未登记可执行证据 |
| US-19.2 | Channels and Event-Driven Claude Sessions | Two-Way Channel Communication | 待实现/审计 | 尚未登记可执行证据 |
| US-19.3 | Channels and Event-Driven Claude Sessions | Supported Messaging Integrations | 待实现/审计 | 尚未登记可执行证据 |
| US-19.4 | Channels and Event-Driven Claude Sessions | Channel Pairing and Allowlist | 待实现/审计 | 尚未登记可执行证据 |
| US-19.5 | Channels and Event-Driven Claude Sessions | Organization Channel Policy | 待实现/审计 | 尚未登记可执行证据 |
| US-20.1 | Artifacts | Generate Interactive Artifacts | 待实现/审计 | 尚未登记可执行证据 |
| US-20.2 | Artifacts | Artifact Privacy | 待实现/审计 | 尚未登记可执行证据 |
| US-20.3 | Artifacts | Update Existing Artifact | 待实现/审计 | 尚未登记可执行证据 |
| US-20.4 | Artifacts | Artifact Discovery | 待实现/审计 | 尚未登记可执行证据 |
| US-20.5 | Artifacts | Collaborative Comments | 待实现/审计 | 尚未登记可执行证据 |
| US-20.6 | Artifacts | Claude Replies to Comments | 待实现/审计 | 尚未登记可执行证据 |
| US-20.7 | Artifacts | Live MCP Data in Artifacts | 待实现/审计 | 尚未登记可执行证据 |
| US-20.8 | Artifacts | Engineering Visualization | 待实现/审计 | 尚未登记可执行证据 |
| US-20.9 | Artifacts | Organization Artifact Governance | 待实现/审计 | 尚未登记可执行证据 |
| US-21.1 | CLI User Experience | Interactive Terminal Interface | 待实现/审计 | 尚未登记可执行证据 |
| US-21.2 | CLI User Experience | Shell Shortcut | 待实现/审计 | 尚未登记可执行证据 |
| US-21.3 | CLI User Experience | Command History Search | 待实现/审计 | 尚未登记可执行证据 |
| US-21.4 | CLI User Experience | Vim/Editor Input Modes | 待实现/审计 | 尚未登记可执行证据 |
| US-21.5 | CLI User Experience | Multiline Input | 待实现/审计 | 尚未登记可执行证据 |
| US-21.6 | CLI User Experience | Terminal Notifications | 待实现/审计 | 尚未登记可执行证据 |
| US-21.7 | CLI User Experience | Themes | 待实现/审计 | 尚未登记可执行证据 |
| US-21.8 | CLI User Experience | Full-Screen Rendering | 待实现/审计 | 尚未登记可执行证据 |
| US-21.9 | CLI User Experience | Focus Mode | 待实现/审计 | 尚未登记可执行证据 |
| US-21.10 | CLI User Experience | Custom Keybindings | 待实现/审计 | 尚未登记可执行证据 |
| US-21.11 | CLI User Experience | Status Line | 待实现/审计 | 尚未登记可执行证据 |
| US-21.12 | CLI User Experience | Voice Dictation | 待实现/审计 | 尚未登记可执行证据 |
| US-21.13 | CLI User Experience | Accessibility | 待实现/审计 | 尚未登记可执行证据 |
| US-22.1 | VS Code | Native VS Code Experience | 待实现/审计 | 尚未登记可执行证据 |
| US-22.2 | VS Code | File and Folder Mentions | 待实现/审计 | 尚未登记可执行证据 |
| US-22.3 | VS Code | Line-Range Context | 待实现/审计 | 尚未登记可执行证据 |
| US-22.4 | VS Code | Plan Review in IDE | 待实现/审计 | 尚未登记可执行证据 |
| US-22.5 | VS Code | Edit Acceptance | 待实现/审计 | 尚未登记可执行证据 |
| US-22.6 | VS Code | Multiple Conversations | 待实现/审计 | 尚未登记可执行证据 |
| US-22.7 | VS Code | Background Agents in IDE | 待实现/审计 | 尚未登记可执行证据 |
| US-22.8 | VS Code | VS Code Plugin Management | 待实现/审计 | 尚未登记可执行证据 |
| US-22.9 | VS Code | Browser Automation from IDE | 待实现/审计 | 尚未登记可执行证据 |
| US-22.10 | VS Code | IDE Checkpoints | 待实现/审计 | 尚未登记可执行证据 |
| US-22.11 | VS Code | Terminal Output | 待实现/审计 | 尚未登记可执行证据 |
| US-22.12 | VS Code | Git and PR Workflow | 待实现/审计 | 尚未登记可执行证据 |
| US-22.13 | VS Code | Focus View | 待实现/审计 | 尚未登记可执行证据 |
| US-23.1 | JetBrains IDE Support | JetBrains Integration | 待实现/审计 | 尚未登记可执行证据 |
| US-24.1 | Claude Code Desktop | Desktop Application | 待实现/审计 | 尚未登记可执行证据 |
| US-24.2 | Claude Code Desktop | Parallel Desktop Sessions | 待实现/审计 | 尚未登记可执行证据 |
| US-24.3 | Claude Code Desktop | Git Isolation | 待实现/审计 | 尚未登记可执行证据 |
| US-24.4 | Claude Code Desktop | Integrated Terminal | 待实现/审计 | 尚未登记可执行证据 |
| US-24.5 | Claude Code Desktop | Integrated File Editor | 待实现/审计 | 尚未登记可执行证据 |
| US-24.6 | Claude Code Desktop | Visual Diff | 待实现/审计 | 尚未登记可执行证据 |
| US-24.7 | Claude Code Desktop | App Preview | 待实现/审计 | 尚未登记可执行证据 |
| US-24.8 | Claude Code Desktop | Preview Server Management | 待实现/审计 | 尚未登记可执行证据 |
| US-24.9 | Claude Code Desktop | Side Chats | 待实现/审计 | 尚未登记可执行证据 |
| US-24.10 | Claude Code Desktop | Background Tasks | 待实现/审计 | 尚未登记可执行证据 |
| US-24.11 | Claude Code Desktop | PR Monitoring | 待实现/审计 | 尚未登记可执行证据 |
| US-24.12 | Claude Code Desktop | Connectors | 待实现/审计 | 尚未登记可执行证据 |
| US-24.13 | Claude Code Desktop | Computer Use | 待实现/审计 | 尚未登记可执行证据 |
| US-24.14 | Claude Code Desktop | Local, Cloud, and SSH Sessions | 待实现/审计 | 尚未登记可执行证据 |
| US-24.15 | Claude Code Desktop | Managed SSH Hosts | 待实现/审计 | 尚未登记可执行证据 |
| US-24.16 | Claude Code Desktop | Continue Across Surfaces | 待实现/审计 | 尚未登记可执行证据 |
| US-24.17 | Claude Code Desktop | Dispatch | 待实现/审计 | 尚未登记可执行证据 |
| US-24.18 | Claude Code Desktop | Desktop Scheduled Tasks | 待实现/审计 | 尚未登记可执行证据 |
| US-24.19 | Claude Code Desktop | Linux and WSL Support | 待实现/审计 | 尚未登记可执行证据 |
| US-24.20 | Claude Code Desktop | iOS Simulator Integration | 待实现/审计 | 尚未登记可执行证据 |
| US-25.1 | Claude Code Web | Cloud Coding Session | 待实现/审计 | 尚未登记可执行证据 |
| US-25.2 | Claude Code Web | Launch Cloud Work from CLI | 待实现/审计 | 尚未登记可执行证据 |
| US-25.3 | Claude Code Web | Persistent Cloud Session | 待实现/审计 | 尚未登记可执行证据 |
| US-25.4 | Claude Code Web | Multiple Parallel Cloud Tasks | 待实现/审计 | 尚未登记可执行证据 |
| US-25.5 | Claude Code Web | GitHub Repository Integration | 待实现/审计 | 尚未登记可执行证据 |
| US-25.6 | Claude Code Web | Local Repository Upload | 待实现/审计 | 尚未登记可执行证据 |
| US-25.7 | Claude Code Web | Cloud-to-Terminal Teleport | 待实现/审计 | 尚未登记可执行证据 |
| US-25.8 | Claude Code Web | Cloud Session Sharing | 待实现/审计 | 尚未登记可执行证据 |
| US-25.9 | Claude Code Web | Archive/Delete Cloud Sessions | 待实现/审计 | 尚未登记可执行证据 |
| US-25.10 | Claude Code Web | Cloud Diff Review | 待实现/审计 | 尚未登记可执行证据 |
| US-25.11 | Claude Code Web | PR Auto-Fix | 待实现/审计 | 尚未登记可执行证据 |
| US-25.12 | Claude Code Web | Isolated Cloud Environment | 待实现/审计 | 尚未登记可执行证据 |
| US-26.1 | Remote Control and Mobile | Remote Control Local Claude | 待实现/审计 | 尚未登记可执行证据 |
| US-26.2 | Remote Control and Mobile | Keep Tools Local | 待实现/审计 | 尚未登记可执行证据 |
| US-26.3 | Remote Control and Mobile | Start Remote Control from CLI | 待实现/审计 | 尚未登记可执行证据 |
| US-26.4 | Remote Control and Mobile | QR and Session Link | 待实现/审计 | 尚未登记可执行证据 |
| US-26.5 | Remote Control and Mobile | Remote Agent Progress | 待实现/审计 | 尚未登记可执行证据 |
| US-26.6 | Remote Control and Mobile | Upload Photos or Files Remotely | 待实现/审计 | 尚未登记可执行证据 |
| US-26.7 | Remote Control and Mobile | Connection Recovery | 待实现/审计 | 尚未登记可执行证据 |
| US-26.8 | Remote Control and Mobile | Trusted Device Controls | 待实现/审计 | 尚未登记可执行证据 |
| US-26.9 | Remote Control and Mobile | Organization Remote-Control Policy | 待实现/审计 | 尚未登记可执行证据 |
| US-26.10 | Remote Control and Mobile | Mobile Push Notifications | 待实现/审计 | 尚未登记可执行证据 |
| US-27.1 | Chrome Browser Automation | Browser Control | 待实现/审计 | 尚未登记可执行证据 |
| US-27.2 | Chrome Browser Automation | Authenticated Browser Session | 待实现/审计 | 尚未登记可执行证据 |
| US-27.3 | Chrome Browser Automation | DOM Inspection | 待实现/审计 | 尚未登记可执行证据 |
| US-27.4 | Chrome Browser Automation | Console Inspection | 待实现/审计 | 尚未登记可执行证据 |
| US-27.5 | Chrome Browser Automation | Visual Verification | 待实现/审计 | 尚未登记可执行证据 |
| US-27.6 | Chrome Browser Automation | End-to-End Testing | 待实现/审计 | 尚未登记可执行证据 |
| US-27.7 | Chrome Browser Automation | Form Interaction | 待实现/审计 | 尚未登记可执行证据 |
| US-27.8 | Chrome Browser Automation | Data Extraction | 待实现/审计 | 尚未登记可执行证据 |
| US-27.9 | Chrome Browser Automation | Screenshots and Recording | 待实现/审计 | 尚未登记可执行证据 |
| US-27.10 | Chrome Browser Automation | Site Permission Controls | 待实现/审计 | 尚未登记可执行证据 |
| US-28.1 | Computer Use | Desktop GUI Control | 待实现/审计 | 尚未登记可执行证据 |
| US-28.2 | Computer Use | Screen Understanding | 待实现/审计 | 尚未登记可执行证据 |
| US-28.3 | Computer Use | Mouse and Keyboard Interaction | 待实现/审计 | 尚未登记可执行证据 |
| US-28.4 | Computer Use | Application Approval | 待实现/审计 | 尚未登记可执行证据 |
| US-28.5 | Computer Use | Tool Preference | 待实现/审计 | 尚未登记可执行证据 |
| US-28.6 | Computer Use | Visual Bug Reproduction | 待实现/审计 | 尚未登记可执行证据 |
| US-29.1 | Git and Pull Request Workflow | Git Repository Awareness | 待实现/审计 | 尚未登记可执行证据 |
| US-29.2 | Git and Pull Request Workflow | Diff Inspection | 待实现/审计 | 尚未登记可执行证据 |
| US-29.3 | Git and Pull Request Workflow | Commit Assistance | 待实现/审计 | 尚未登记可执行证据 |
| US-29.4 | Git and Pull Request Workflow | Pull Request Creation | 待实现/审计 | 尚未登记可执行证据 |
| US-29.5 | Git and Pull Request Workflow | PR Context | 待实现/审计 | 尚未登记可执行证据 |
| US-30.1 | Code Review | Local `/code-review` | 待实现/审计 | 尚未登记可执行证据 |
| US-30.2 | Code Review | Review Scope Selection | 待实现/审计 | 尚未登记可执行证据 |
| US-30.3 | Code Review | Review Effort | 待实现/审计 | 尚未登记可执行证据 |
| US-30.4 | Code Review | Automatically Fix Review Findings | 待实现/审计 | 尚未登记可执行证据 |
| US-30.5 | Code Review | Comment Findings | 待实现/审计 | 尚未登记可执行证据 |
| US-30.6 | Code Review | Managed Code Review | 待实现/审计 | 尚未登记可执行证据 |
| US-30.7 | Code Review | Repository Review Instructions | 待实现/审计 | 尚未登记可执行证据 |
| US-30.8 | Code Review | Ultrareview | 待实现/审计 | 尚未登记可执行证据 |
| US-31.1 | Security Review | Security Guidance Plugin | 待实现/审计 | 尚未登记可执行证据 |
| US-31.2 | Security Review | Custom Security Rules | 待实现/审计 | 尚未登记可执行证据 |
| US-31.3 | Security Review | Claude Security | 待实现/审计 | 尚未登记可执行证据 |
| US-31.4 | Security Review | Whole Repository Security Review | 待实现/审计 | 尚未登记可执行证据 |
| US-31.5 | Security Review | Diff/PR/Commit Security Scope | 待实现/审计 | 尚未登记可执行证据 |
| US-31.6 | Security Review | Human-Controlled Security Patches | 待实现/审计 | 尚未登记可执行证据 |
| US-32.1 | GitHub and GitLab Automation | GitHub Actions | 待实现/审计 | 尚未登记可执行证据 |
| US-32.2 | GitHub and GitLab Automation | Mention Claude | 待实现/审计 | 尚未登记可执行证据 |
| US-32.3 | GitHub and GitLab Automation | Automatic GitHub Event Prompts | 待实现/审计 | 尚未登记可执行证据 |
| US-32.4 | GitHub and GitLab Automation | Scheduled GitHub Workflows | 待实现/审计 | 尚未登记可执行证据 |
| US-32.5 | GitHub and GitLab Automation | Skills in CI | 待实现/审计 | 尚未登记可执行证据 |
| US-32.6 | GitHub and GitLab Automation | Cloud Provider Authentication | 待实现/审计 | 尚未登记可执行证据 |
| US-32.7 | GitHub and GitLab Automation | GitLab CI/CD | 待实现/审计 | 尚未登记可执行证据 |
| US-32.8 | GitHub and GitLab Automation | GitHub Enterprise Server | 待实现/审计 | 尚未登记可执行证据 |
| US-33.1 | Permissions | Permission Modes | 待实现/审计 | 尚未登记可执行证据 |
| US-33.2 | Permissions | Allow Rules | 待实现/审计 | 尚未登记可执行证据 |
| US-33.3 | Permissions | Ask Rules | 待实现/审计 | 尚未登记可执行证据 |
| US-33.4 | Permissions | Deny Rules | 待实现/审计 | 尚未登记可执行证据 |
| US-33.5 | Permissions | Rule Precedence | 待实现/审计 | 尚未登记可执行证据 |
| US-33.6 | Permissions | Tool-Specific Policies | 待实现/审计 | 尚未登记可执行证据 |
| US-33.7 | Permissions | Tool-Argument Matching | 待实现/审计 | 尚未登记可执行证据 |
| US-33.8 | Permissions | Live Permission Management | 待实现/审计 | 尚未登记可执行证据 |
| US-33.9 | Permissions | Explain Permission Requests | 待实现/审计 | 尚未登记可执行证据 |
| US-34.1 | Sandbox and Credential Protection | OS-Level Bash Sandbox | 待实现/审计 | 尚未登记可执行证据 |
| US-34.2 | Sandbox and Credential Protection | Filesystem Isolation | 待实现/审计 | 尚未登记可执行证据 |
| US-34.3 | Sandbox and Credential Protection | Network Isolation | 待实现/审计 | 尚未登记可执行证据 |
| US-34.4 | Sandbox and Credential Protection | Credential Isolation | 待实现/审计 | 尚未登记可执行证据 |
| US-34.5 | Sandbox and Credential Protection | Protected Paths | 待实现/审计 | 尚未登记可执行证据 |
| US-34.6 | Sandbox and Credential Protection | Controlled Unsandboxed Retry | 待实现/审计 | 尚未登记可执行证据 |
| US-34.7 | Sandbox and Credential Protection | Managed Sandbox Enforcement | 待实现/审计 | 尚未登记可执行证据 |
| US-35.1 | Auto Mode and Autonomous Safety | Auto Mode | 待实现/审计 | 尚未登记可执行证据 |
| US-35.2 | Auto Mode and Autonomous Safety | Hard Safety Boundaries | 待实现/审计 | 尚未登记可执行证据 |
| US-35.3 | Auto Mode and Autonomous Safety | Auto Mode Configuration | 待实现/审计 | 尚未登记可执行证据 |
| US-36.1 | Configuration and `.claude` Workspace | User Settings | 待实现/审计 | 尚未登记可执行证据 |
| US-36.2 | Configuration and `.claude` Workspace | Project Settings | 待实现/审计 | 尚未登记可执行证据 |
| US-36.3 | Configuration and `.claude` Workspace | Local Project Settings | 待实现/审计 | 尚未登记可执行证据 |
| US-36.4 | Configuration and `.claude` Workspace | Managed Settings | 待实现/审计 | 尚未登记可执行证据 |
| US-36.5 | Configuration and `.claude` Workspace | Server-Managed Settings | 待实现/审计 | 尚未登记可执行证据 |
| US-36.6 | Configuration and `.claude` Workspace | `/config` | 待实现/审计 | 尚未登记可执行证据 |
| US-36.7 | Configuration and `.claude` Workspace | Shared `.claude` Structure | 待实现/审计 | 尚未登记可执行证据 |
| US-37.1 | Authentication and Administration | User Authentication | 待实现/审计 | 尚未登记可执行证据 |
| US-37.2 | Authentication and Administration | Enterprise SSO | 待实现/审计 | 尚未登记可执行证据 |
| US-37.3 | Authentication and Administration | Domain and Organization Management | 待实现/审计 | 尚未登记可执行证据 |
| US-37.4 | Authentication and Administration | RBAC | 待实现/审计 | 尚未登记可执行证据 |
| US-37.5 | Authentication and Administration | Central MCP Governance | 待实现/审计 | 尚未登记可执行证据 |
| US-37.6 | Authentication and Administration | Version Management | 待实现/审计 | 尚未登记可执行证据 |
| US-38.1 | Enterprise Model Providers | Anthropic Direct | 待实现/审计 | 尚未登记可执行证据 |
| US-38.2 | Enterprise Model Providers | AWS Bedrock | 待实现/审计 | 尚未登记可执行证据 |
| US-38.3 | Enterprise Model Providers | Claude Platform on AWS | 待实现/审计 | 尚未登记可执行证据 |
| US-38.4 | Enterprise Model Providers | Google Cloud Agent Platform / Vertex Integration | 待实现/审计 | 尚未登记可执行证据 |
| US-38.5 | Enterprise Model Providers | Microsoft Foundry | 待实现/审计 | 尚未登记可执行证据 |
| US-39.1 | Enterprise Networking | HTTP/HTTPS Proxy | 待实现/审计 | 尚未登记可执行证据 |
| US-39.2 | Enterprise Networking | Custom Certificate Authorities | 待实现/审计 | 尚未登记可执行证据 |
| US-39.3 | Enterprise Networking | Mutual TLS | 待实现/审计 | 尚未登记可执行证据 |
| US-39.4 | Enterprise Networking | Corporate Process Launcher | 待实现/审计 | 尚未登记可执行证据 |
| US-40.1 | LLM Gateway | Enterprise LLM Gateway | 待实现/审计 | 尚未登记可执行证据 |
| US-40.2 | LLM Gateway | Authentication and Routing | 待实现/审计 | 尚未登记可执行证据 |
| US-40.3 | LLM Gateway | Spend Limits | 待实现/审计 | 尚未登记可执行证据 |
| US-40.4 | LLM Gateway | SSO-Based Gateway Access | 待实现/审计 | 尚未登记可执行证据 |
| US-40.5 | LLM Gateway | Gateway Deployment | 待实现/审计 | 尚未登记可执行证据 |
| US-41.1 | Development Environments | Local Environment | 待实现/审计 | 尚未登记可执行证据 |
| US-41.2 | Development Environments | Dev Containers | 待实现/审计 | 尚未登记可执行证据 |
| US-41.3 | Development Environments | Cloud Environments | 待实现/审计 | 尚未登记可执行证据 |
| US-41.4 | Development Environments | Self-Hosted Environments | 待实现/审计 | 尚未登记可执行证据 |
| US-41.5 | Development Environments | Self-Hosted Session Orchestrator | 待实现/审计 | 尚未登记可执行证据 |
| US-41.6 | Development Environments | On-Demand Runners | 待实现/审计 | 尚未登记可执行证据 |
| US-41.7 | Development Environments | Per-Session Credentials | 待实现/审计 | 尚未登记可执行证据 |
| US-41.8 | Development Environments | Session Identity | 待实现/审计 | 尚未登记可执行证据 |
| US-41.9 | Development Environments | Self-Hosted Hooks | 待实现/审计 | 尚未登记可执行证据 |
| US-41.10 | Development Environments | E2E Environment Testing | 待实现/审计 | 尚未登记可执行证据 |
| US-42.1 | Monitoring, Analytics, and Cost | Usage Visibility | 待实现/审计 | 尚未登记可执行证据 |
| US-42.2 | Monitoring, Analytics, and Cost | Usage Breakdown | 待实现/审计 | 尚未登记可执行证据 |
| US-42.3 | Monitoring, Analytics, and Cost | Cost Information | 待实现/审计 | 尚未登记可执行证据 |
| US-42.4 | Monitoring, Analytics, and Cost | OpenTelemetry | 待实现/审计 | 尚未登记可执行证据 |
| US-42.5 | Monitoring, Analytics, and Cost | Metrics and Events | 待实现/审计 | 尚未登记可执行证据 |
| US-42.6 | Monitoring, Analytics, and Cost | Analytics Dashboard | 待实现/审计 | 尚未登记可执行证据 |
| US-42.7 | Monitoring, Analytics, and Cost | Personal Insights | 待实现/审计 | 尚未登记可执行证据 |
| US-43.1 | Privacy, Data, and Compliance | Data Usage Transparency | 待实现/审计 | 尚未登记可执行证据 |
| US-43.2 | Privacy, Data, and Compliance | Zero Data Retention Options | 待实现/审计 | 尚未登记可执行证据 |
| US-43.3 | Privacy, Data, and Compliance | Compliance Controls | 待实现/审计 | 尚未登记可执行证据 |
| US-44.1 | Troubleshooting and Self-Diagnosis | `/doctor` | 待实现/审计 | 尚未登记可执行证据 |
| US-44.2 | Troubleshooting and Self-Diagnosis | `/debug` | 待实现/审计 | 尚未登记可执行证据 |
| US-44.3 | Troubleshooting and Self-Diagnosis | Configuration Inspection | 待实现/审计 | 尚未登记可执行证据 |
| US-44.4 | Troubleshooting and Self-Diagnosis | Error Reference | 待实现/审计 | 尚未登记可执行证据 |
| US-45.1 | Onboarding and Adoption | Team Onboarding | 待实现/审计 | 尚未登记可执行证据 |
| US-45.2 | Onboarding and Adoption | In-Product Lessons | 待实现/审计 | 尚未登记可执行证据 |
| US-45.3 | Onboarding and Adoption | Power-Up Guidance | 待实现/审计 | 尚未登记可执行证据 |
| US-45.4 | Onboarding and Adoption | Champion and Communication Materials | 待实现/审计 | 尚未登记可执行证据 |
| US-46.1 | Agent SDK | Embed Claude Code Agent Loop | 待实现/审计 | 尚未登记可执行证据 |
| US-46.2 | Agent SDK | Built-In Tools in SDK | 待实现/审计 | 尚未登记可执行证据 |
| US-46.3 | Agent SDK | SDK Sessions | 待实现/审计 | 尚未登记可执行证据 |
| US-46.4 | Agent SDK | Resume and Fork via SDK | 待实现/审计 | 尚未登记可执行证据 |
| US-46.5 | Agent SDK | External Session Storage | 待实现/审计 | 尚未登记可执行证据 |
| US-46.6 | Agent SDK | Streaming Input | 待实现/审计 | 尚未登记可执行证据 |
| US-46.7 | Agent SDK | Streaming Output | 待实现/审计 | 尚未登记可执行证据 |
| US-46.8 | Agent SDK | User Approval | 待实现/审计 | 尚未登记可执行证据 |
| US-46.9 | Agent SDK | User Questions | 待实现/审计 | 尚未登记可执行证据 |
| US-46.10 | Agent SDK | Structured Output | 待实现/审计 | 尚未登记可执行证据 |
| US-46.11 | Agent SDK | Custom In-Process Tools | 待实现/审计 | 尚未登记可执行证据 |
| US-46.12 | Agent SDK | External MCP in SDK | 待实现/审计 | 尚未登记可执行证据 |
| US-46.13 | Agent SDK | SDK Tool Search | 待实现/审计 | 尚未登记可执行证据 |
| US-46.14 | Agent SDK | SDK Subagents | 待实现/审计 | 尚未登记可执行证据 |
| US-46.15 | Agent SDK | Custom System Prompt | 待实现/审计 | 尚未登记可执行证据 |
| US-46.16 | Agent SDK | Skills in SDK | 待实现/审计 | 尚未登记可执行证据 |
| US-46.17 | Agent SDK | Plugins in SDK | 待实现/审计 | 尚未登记可执行证据 |
| US-46.18 | Agent SDK | SDK Permission System | 待实现/审计 | 尚未登记可执行证据 |
| US-46.19 | Agent SDK | SDK Hooks | 待实现/审计 | 尚未登记可执行证据 |
| US-46.20 | Agent SDK | SDK Checkpointing | 待实现/审计 | 尚未登记可执行证据 |
| US-46.21 | Agent SDK | SDK Cost Tracking | 待实现/审计 | 尚未登记可执行证据 |
| US-46.22 | Agent SDK | SDK OpenTelemetry | 待实现/审计 | 尚未登记可执行证据 |
| US-46.23 | Agent SDK | SDK Todo/Task State | 待实现/审计 | 尚未登记可执行证据 |
| US-46.24 | Agent SDK | Production Hosting Guidance | 待实现/审计 | 尚未登记可执行证据 |
