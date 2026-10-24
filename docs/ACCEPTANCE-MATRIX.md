# CCPT 25 项验收矩阵

> 0.48（2026-10-05）复核：下表是历史实现映射，不是最新企业验收结论。MCP 独立 SSE/TUI、语义摘要和 Windows DPAPI 已新增；OS 沙箱、公司真机及许可授权仍未完成。以 [当前剩余清单](REMAINING-0.48.zh-CN.md) 为准。

> 0.39 复核：历史“已实现”仅表示存在本地实现，不等于逐项企业验收通过。当前增量证据与明确未完成事项以 [0.39 验收说明](RELEASE-0.39.zh-CN.md) 和 [行为验收记录](TERMINAL-BEHAVIOR-AUDIT.zh-CN.md) 为准，不能从本表推断已完整复现参照产品。

> 兼容性说明：本表只对应最初的 25 项验收范围，不代表后续 45 个 Epic、415 条 User Story 已全部完成。完整规格必须以 `USER-STORY-TRACEABILITY.md` 为准。

本表对照旧目标 User Story。状态“已实现”表示 CLI 中存在可运行实现并进入构建；外部模型、身份系统、Git 托管和企业 wrapper 仍需要部署方提供对应服务或凭据。

| AC | 状态 | 实现证据与边界 |
|---|---|---|
| AC1 大型仓库理解 | 部分验收 | 0.39 验证完整请求预算、可编辑输入/输出上限、归档与本地/服务端超限恢复；最大两次恢复重试，当前轮次不截断。1M 原生窗口和大型仓库长时性能仍需真实部署验证；填写参数不能扩容模型。 |
| AC2 多 Agent | 已实现 | Lead 可用 `delegate` 创建角色化子 Agent，Agent/Skill 定义由平台注册表解析。 |
| AC3 后台执行 | 本地验收 | 独立 worker、持久状态与并发槽；0.39 验证 TUI 停止/接续二次确认、跨工作区拒绝与取消状态防覆盖。停止不回滚文件，也不保证中断已进入的单个工具；全并发压力验收仍待完成。 |
| AC4 Worktree 隔离 | 已实现 | 每个 Agent 使用受管目录和独立 `agentic/<id>` 分支，创建/移除均触发生命周期 Hook。 |
| AC5 Git 自动化 | 已实现 | 模型工具支持 status、显式文件 commit、push、Draft PR；push/PR 默认关闭，需项目或托管策略显式授权，所有进程通过权限策略和 wrapper。 |
| AC6 工作流编排 | 已实现 | JSON 工作流支持依赖图、并发批次、等待、失败传播和可选顺序合并。 |
| AC7 嵌套委派 | 已实现 | `maxConcurrent`、`maxPerSession`、`maxDepth`、`maxTurns` 四层约束阻止失控扩张；父 Agent 决定真实深度，文件锁保证跨 worker 并发预留不会超额。 |
| AC8 持久记忆 | 已实现 | project/role scope 的 durable memory 工具，并在 Agent 启动时自动注入。 |
| AC9 Skills | 已实现 | 当前受信任工作区及其项目 Plugin Skills；按任务/角色激活，支持 `/reload`，不跨项目读取用户目录。 |
| AC10 Plugins | 已实现 | 声明式 Plugin 可贡献 Skills、Agents、命令、Hooks、MCP；支持生成、安装、启停、校验和 SHA-256 完整性。 |
| AC11 MCP | 部分验收 | stdio/HTTP、令牌和 device flow 路径；0.39 本地验证 Streamable HTTP 初始化、会话头、JSON/SSE、工具/资源/提示词分页与清理。真实企业 OAuth、代理/mTLS 和所有服务器兼容性尚待联调。 |
| AC12 双向 MCP | 部分实现 | 活跃 stdio 和 HTTP 响应可收通知；没有独立常驻 SSE 订阅、断线续传或服务端 sampling/elicitation 执行。HTTP 通知在本次响应完成后交付，不能宣称完整双向实时协议。 |
| AC13 Hooks | 已实现 | 10 个目标事件全部可配置，含权限请求、Agent 空闲、配置和 Worktree 生命周期。 |
| AC14 Worktree 自动准备 | 已实现 | WorktreeCreate/Remove Hook 可安装依赖、准备环境和回收资源；清理策略可选 manual/on-success/always，脏 worktree 清理前自动 checkpoint，避免丢失 Agent 产物。 |
| AC15 企业 sandbox | 已实现 | sandbox 强制企业 wrapper、环境显式允许列表、真实路径边界、保护文件（读/枚举/搜索/上下文统一过滤）、命令 allow/deny、审计脱敏和超时；无 wrapper 时失败关闭。 |
| AC16 restricted | 已实现 | 禁止写入、进程、Hook、外部网络和高风险工具；保留工作区只读分析及 loopback 模型/MCP。 |
| AC17 权限模型 | 已实现 | bypass、normal、sandbox、restricted 四级模式，支持 CLI、Agent profile、项目和托管配置。 |
| AC18 托管配置 | 已实现 | Windows Registry、macOS managed plist、Linux `/etc` 文件和跨平台托管 JSON；最后合并，优先级最高。 |
| AC19 企业网络 | 已实现 | HTTP/HTTPS proxy、NO_PROXY、外部目标白名单、自定义 CA、TLS 检查、mTLS、超时；企业模型平台经批准的兼容端点/网关接入。 |
| AC20 进程控制 | 已实现 | 命令、Hook、stdio MCP 和后台 worker 统一支持 `processWrapper`，使用参数数组而非 Shell 字符串。 |
| AC21 VS Code | 已实现 | npm 包内置扩展：聊天、当前文件/选区、受大小限制的附件内容、Agent queued/working 状态与取消、会话恢复和平台桥接。 |
| AC22 Focus View | 已实现 | 默认仅显示用户请求与最终结果；关闭后可查看完整 Agent 记录。 |
| AC23 会话 Fork | 已实现 | Fork 深拷贝消息、归档和摘要，并保留 parentId，允许独立继续。 |
| AC24 会话 Resume | 已实现 | CLI、TUI 和 VS Code 可恢复持久会话；压缩只移动活跃窗口，原消息保存在归档。 |
| AC25 长任务 | 已实现 | 后台 worker、多轮工具循环、等待人工输入、嵌套 Agent、工作流依赖、持久会话与失败状态共同支持长任务。 |

## 自动验证

测试覆盖实际模型工具写文件、独立后台 worker 与状态竞态、跨进程并发槽、嵌套深度防绕过、独立子 Agent Session、持久任务依赖和状态同步、代码/对话 checkpoint 与 rewind、stdio MCP notification、MCP 工作目录边界、网络目标白名单、loopback 代理绕过、审计脱敏、Plugin 注册/完整性、受限环境、保护文件的枚举/搜索/上下文隔离、符号链接逃逸、会话归档/Fork、VS Code 附件安装，以及真实 Git Worktree 创建/提交/合并/checkpoint/清理。发布前统一执行 `npm run check && npm test && npm run build && npm pack`。
