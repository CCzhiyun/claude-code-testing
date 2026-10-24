# 完整产品面 User Stories：官方 2.1.301 对照

来源为 2026-10-16 官方英文索引快照；不是原有 25 条 US 的简单菜单翻译。每个故事含验收条件、边界、实现候选和测试候选；候选不等于通过。

## US-CLI-01 — 安装、启动与诊断

作为团队开发者，我希望通过 npm 安装后直接在项目目录进入工作界面，并能诊断环境问题。

验收条件：

1. Given 新用户与空配置，When 全局安装后启动，Then 进入设置/信任流程，不预填维护者私人模型或密钥。
2. Given PATH、版本或依赖异常，When doctor，Then 明确问题和修复路径，不能把未认证当已连接。

边界：新装/升级/降级、空 home、Node 最低版本、cmd/PowerShell/bash、无 TTY。

状态：待专项验收；源码候选不代表完成。

实现候选：`src/cli.ts`。测试候选：`test/session-startup.test.ts`、`test/workspace-trust.test.ts`。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[setup](https://code.claude.com/docs/en/setup)、[quickstart](https://code.claude.com/docs/en/quickstart)、[troubleshoot-install](https://code.claude.com/docs/en/troubleshoot-install)、[overview](https://code.claude.com/docs/en/overview)。

## US-CFG-01 — 配置来源、作用域和热重载

作为团队开发者，我希望看清有效配置来自哪里，并避免把个人偏好提交给全团队。

验收条件：

1. Given user/project/local/session/managed 同时存在，When 查看与修改，Then 展示来源和优先级，托管限制不可放宽。
2. Given 无效或冲突字段，When reload，Then 原有效配置不被部分覆盖，错误可脱敏诊断。

边界：空/null/错类型、同名字段、受管字段、重启、并发保存、只读文件、settings.local。

状态：待专项验收；源码候选不代表完成。

实现候选：`src/config.ts`、`src/tui.ts`。测试候选：`test/config.test.ts`、`test/runtime-options.test.ts`。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[settings](https://code.claude.com/docs/en/settings)、[settings-reference](https://code.claude.com/docs/en/settings-reference)、[settings-example](https://code.claude.com/docs/en/settings-example)、[claude-directory](https://code.claude.com/docs/en/claude-directory)、[debug-your-config](https://code.claude.com/docs/en/debug-your-config)。

## US-SES-01 — 会话创建、继续、恢复和切换

作为团队开发者，我希望长期任务能在原会话继续，而不是恢复时自动重做任务。

验收条件：

1. Given 已保存对话，When resume/continue 或 picker 选择，Then 还原历史/目录/身份，不自行发起新任务。
2. Given 取消、退出或较大历史，When 再次启动，Then 可追溯前文，并明确未加载的档案。

边界：0/1/1000 会话、损坏记录、跨项目、空输入、恢复时权限变化、断电。

状态：待专项验收；源码候选不代表完成。

实现候选：`src/sessions.ts`、`src/components/resourceDialog.ts`。测试候选：`test/terminal-resume-integration.test.ts`。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[sessions](https://code.claude.com/docs/en/sessions)、[interactive-mode](https://code.claude.com/docs/en/interactive-mode)。

## US-SES-02 — 分叉、回退、导出与无持久化

作为团队开发者，我希望独立探索替代方案并可恢复代码，而不误删原对话。

验收条件：

1. Given 原会话与文件检查点，When fork/rewind，Then 原分支保留，代码恢复与会话恢复范围分开确认。
2. Given no-persistence，When 运行/退出，Then 不留下可恢复对话、后台 worker 或密钥文件。

边界：未提交文件、检查点后新增文件、非文本、重复恢复、目标存在、失败中断。

状态：待专项验收；源码候选不代表完成。

实现候选：`src/sessions.ts`、`src/checkpoints.ts`、`src/cli.ts`。测试候选：`test/context-lifecycle.test.ts`、`test/runtime-options.test.ts`。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[sessions](https://code.claude.com/docs/en/sessions)、[checkpointing](https://code.claude.com/docs/en/checkpointing)、[headless](https://code.claude.com/docs/en/headless)。

## US-CTX-01 — 上下文占用、预警和连续压缩

作为团队开发者，我希望接近窗口上限时继续同一任务，不关闭会话或截断当前工具交换。

验收条件：

1. Given 当前输入+工具+保留输出达到 90%，When 下一请求准备，Then 提醒且不终止。
2. Given 超过 95%，When 自动压缩开启，Then 归档完整历史并压缩旧回合，保留当前人类请求和配对工具结果；估算必须标明。

边界：89.99/90/95/95.01、单回合超限、压缩失败、连续超限、1M、多模态。

状态：待专项验收；源码候选不代表完成。

实现候选：`src/contextBudget.ts`、`src/contextRecovery.ts`、`src/semanticCompaction.ts`。测试候选：`test/context-pressure.test.ts`、`test/context-continuation.test.ts`。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[context-window](https://code.claude.com/docs/en/context-window)、[large-codebases](https://code.claude.com/docs/en/large-codebases)、[costs](https://code.claude.com/docs/en/costs)。

## US-CTX-02 — 缓存、模型切换与小窗口迁移

作为团队开发者，我希望知道缓存命中与压缩的成本，不在切模型时意外花费或循环压缩。

验收条件：

1. Given 服务返回的模型名与请求不同，When 继续，Then 不擅自换模型或触发无限压缩。
2. Given 换到小窗口模型，When 需要额外付费摘要，Then 先解释并获得允许，不悄悄调用另一个模型。

边界：别名/真实名称不一致、缓存 token、小窗不足、零预算、取消切换。

状态：待专项验收；源码候选不代表完成。

实现候选：`src/modelConnection.ts`、`src/contextRecovery.ts`、`src/usage.ts`。测试候选：`test/token-usage.test.ts`、`test/model-retry.test.ts`。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[prompt-caching](https://code.claude.com/docs/en/prompt-caching)、[model-config](https://code.claude.com/docs/en/model-config)、[costs](https://code.claude.com/docs/en/costs)。

## US-RULE-01 — 工程指令、规则来源和懒加载

作为团队开发者，我希望规则仅在相应文件范围生效，元数据不进入指令正文。

验收条件：

1. Given 无 paths 与全局规则，When 启动，Then 按合法来源加载正文并展示诊断。
2. Given 有 paths，When 尚未访问/访问不匹配/访问匹配文件，Then 分别不加载/不加载/加载一次，下一轮和恢复仍可见。

边界：根文件/深目录、brace/bracket glob、空 paths、中文、Windows 分隔符、损坏 header、外部链接。

状态：本轮针对普通/全局/路径规则有运行时通过证据；外部导入审批仍有差距。

实现候选：`src/scopedRules.ts`、`src/context.ts`、`src/agent.ts`。测试候选：`test/latest-reference-fixes.test.ts`。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[memory](https://code.claude.com/docs/en/memory)、[claude-directory](https://code.claude.com/docs/en/claude-directory)、[large-codebases](https://code.claude.com/docs/en/large-codebases)。

## US-RULE-02 — AGENTS.md、嵌套指令和外部导入

作为团队开发者，我希望团队可以选择指令文件约定，并控制外部导入而不自动相信仓库内容。

验收条件：

1. Given 目录层级与读取文件变化，When 发现指令，Then 最近作用域、来源和已加载列表明确。
2. Given 外部 @import、符号链接或网络路径，When 启动，Then 遵守明确批准边界，不能自动接触网络凭据或循环展开。

边界：AGENTS/项目指令同时存在、重复引用、导入环、UNC、符号链接、托管不可排除。

状态：待实现/验收：不以现有仓库地图代替完整指令加载语义。

实现候选：`src/context.ts`、`src/policy.ts`。测试候选：尚无专项证据。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[memory](https://code.claude.com/docs/en/memory)、[debug-your-config](https://code.claude.com/docs/en/debug-your-config)。

## US-MEM-01 — 自动记忆与专属 Agent 记忆

作为团队开发者，我希望保留工程知识，不保存密钥，也不跨项目污染。

验收条件：

1. Given 专属 memory scope，When 写入/读取，Then 持久化且标来源和项目边界。
2. Given 过大、含凭据或越界 key，When 保存，Then 明确拒绝；普通记忆不能成为人工授权。

边界：0/24999/25000/25001 UTF-8 字节、非法 key、用户/项目/local、软链接。

状态：待专项验收；源码候选不代表完成。

实现候选：`src/agentMemory.ts`、`src/memory.ts`。测试候选：`test/latest-reference-fixes.test.ts`、`test/skills-agents-teams-050.test.ts`。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[memory](https://code.claude.com/docs/en/memory)、[sub-agents](https://code.claude.com/docs/en/sub-agents)。

## US-SK-01 — Skill 发现、来源、搜索和优先级

作为团队开发者，我希望组员可放置自己的 Skill 并知道为什么加载或未加载。

验收条件：

1. Given user/project/plugin/嵌套目录定义，When 发现与 reload，Then 来源/同名优先级和无效定义诊断确定。
2. Given 多页列表与零匹配，When 输入中文/emoji并导航退出，Then 选中项可见且不额外调用模型。

边界：0/1/100 定义、重名、大小写、长路径、目录符号链接、损坏定义、个人与团队作用域。

状态：待专项验收；源码候选不代表完成。

实现候选：`src/skills.ts`、`src/platform.ts`、`src/components/skillsManager.ts`。测试候选：`test/skills-manager.test.ts`、`test/latest-reference-fixes.test.ts`。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[skills](https://code.claude.com/docs/en/skills)、[plugins/loading](https://code.claude.com/docs/en/plugins/loading)。

## US-SK-02 — 作者限制、四态可见性和负向诊断

作为团队开发者，我希望设置 UI 不能误导用户或放宽作者限制。

验收条件：

1. Given 作者禁止自动调用，When 打开/切换设置，Then 标明 author/user-only 并阻止放宽。
2. Given model-only/disabled，When 直接 slash 调用，Then 给出具体原因，不调用模型；别名使用最严格有效策略。

边界：四态×作者开关、同文件别名、插件管理范围、Enter/Space/Esc、保存重开。

状态：作者锁定和诊断已修；保存作用域/Enter 语义仍为已知差异。

实现候选：`src/skills.ts`、`src/components/skillsManager.ts`、`src/tui.ts`。测试候选：`test/latest-reference-fixes.test.ts`、`test/skills-agents-teams-050.test.ts`。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[skills](https://code.claude.com/docs/en/skills)。

## US-SK-03 — Skill 参数、命名替换与展开预算

作为团队开发者，我希望用有名字和有引号的参数调用团队流程，避免提示膨胀。

验收条件：

1. Given arguments 定义，When 调用，Then 按位置替换命名参数；缺失命名参数为空，缺失数字占位保留。
2. Given 替换值含占位文本，When 展开，Then 不递归替换；命名参数最多 64 个、每名最多 64 字符，超大展开明确拒绝。

边界：0/1/64/65 名、64/65 字符、空引号、中文、shell 字符、100K 参数、重复占位放大。

状态：本轮已实现命名参数/when_to_use/展开上限；环境变量替换与完整 shell 引号仍需专项。

实现候选：`src/skills.ts`。测试候选：`test/latest-reference-fixes.test.ts`。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[skills](https://code.claude.com/docs/en/skills)、[changelog](https://code.claude.com/docs/en/changelog)。

## US-SK-04 — Skill 正文生命周期与当轮工具限制

作为团队开发者，我希望Skill 约定持续留在对话，但不会永久扩大或缩窄权限。

验收条件：

1. Given inline Skill，When 下一轮/磁盘恢复/fork，Then 正文仍在 conversation。
2. Given allowed-tools，When 当前轮工具调用和下一次人类输入，Then 当轮限制与下一轮权限分开处理；仓库内容不授予人类批准。

边界：普通问候、明确调用、动态 tool 调用、多个 Skill、压缩后恢复、重复激活。

状态：本轮已修正文持久化；保留 CCPT 工具 ceiling 安全设计差异。

实现候选：`src/skillInvocation.ts`、`src/agent.ts`。测试候选：`test/latest-reference-fixes.test.ts`、`test/greeting-skills.test.ts`。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[skills](https://code.claude.com/docs/en/skills)、[sub-agents](https://code.claude.com/docs/en/sub-agents)。

## US-SK-05 — fork、堆叠、动态上下文和文件资源

作为团队开发者，我希望复杂 Skill 可独立运行并使用自己的资源，不污染主对话。

验收条件：

1. Given context: fork/agent，When 调用与返回，Then 子会话身份和能力边界明确、主会话保留。
2. Given 多 Skill 堆叠、目录变量或动态脚本，When 解析，Then 按明示语义展开，脚本仍需授权和超时。

边界：未知 agent、禁止调用、slash 参数、脚本失败/超时、路径空格、父权限。

状态：fork 有证据；堆叠/脚本/目录变量未完整实现。

实现候选：`src/skillInvocation.ts`、`src/tools/SkillTool/SkillTool.ts`。测试候选：`test/skills-agents-teams-050.test.ts`。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[skills](https://code.claude.com/docs/en/skills)。

## US-AG-01 — 可复用 Agent 定义与递归发现

作为团队开发者，我希望组员按目录组织测试/安全/后端角色，定义错误能看懂。

验收条件：

1. Given Markdown/JSON/临时配置，When 加载，Then 递归发现、校验类型、报告重复/未知字段。
2. Given permissionMode: plan，When 执行，Then 真正只读，不是仅加载成功。

边界：64/65 名字、深度/数量上限、损坏 JSON/YAML、空 prompt、同名、插件命名空间。

状态：本轮递归与 Plan 运行已修；高级元数据仍待完整支持。

实现候选：`src/agents.ts`、`src/platform.ts`、`src/agent.ts`。测试候选：`test/latest-reference-fixes.test.ts`。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[sub-agents](https://code.claude.com/docs/en/sub-agents)。

## US-AG-02 — 嵌套委派、并发和总量限制

作为团队开发者，我希望任务能并行拆解且不失控消耗资源。

验收条件：

1. Given 父 Agent 与策略限制，When 创建子/孙 Agent，Then 继承能力边界并计入并发/深度/总量。
2. Given 达到限制，When 再次请求，Then 确定拒绝且不留下孤儿会话；完成后可释放并发槽。

边界：N/N+1、D/D+1、重复创建、父取消、相同 worktree、资源耗尽。

状态：CCPT 总量上限是明确加固差异；真实压力/孤儿恢复待测。

实现候选：`src/agent.ts`、`src/taskManagement.ts`。测试候选：`test/agent-input-boundary.test.ts`。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[sub-agents](https://code.claude.com/docs/en/sub-agents)、[agents](https://code.claude.com/docs/en/agents)。

## US-AG-03 — 后台执行、状态、取消与继续

作为团队开发者，我希望主界面不阻塞，能确认后台到底运行、等待还是失败。

验收条件：

1. Given 长任务，When background/attach/cancel，Then 状态和输出准确，取消覆盖进程树并保留可恢复历史。
2. Given 流式生成，When Esc 或 Ctrl+C，Then 请求被实际取消，下一轮仍用原会话。

边界：启动中取消、完成后取消、重复取消、无输出、进程退出、断线/重连。

状态：待专项验收；源码候选不代表完成。

实现候选：`src/agent.ts`、`src/executionControl.ts`、`src/tui.ts`。测试候选：`test/latest-reference-fixes.test.ts`、`test/execution-control.test.ts`。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[sub-agents](https://code.claude.com/docs/en/sub-agents)、[agent-view](https://code.claude.com/docs/en/agent-view)、[interactive-mode](https://code.claude.com/docs/en/interactive-mode)。

## US-AG-04 — 模型、effort、压缩窗口与预加载配置

作为团队开发者，我希望角色可以选择模型和上下文策略，且字段不是静默无效。

验收条件：

1. Given model/effort/autoCompactWindow/omit instructions/initialPrompt，When 启动专属 Agent，Then 有效请求与定义一致或明确不支持。
2. Given 父级/托管限制，When 子角色请求放宽，Then 不越过父级能力和模型窗口上限。

边界：inherit、非法 effort、100000/1000000 窗口、初始提示为空、插件不支持字段。

状态：待实现：高级字段仍不能仅凭解析框架算完成。

实现候选：`src/agents.ts`、`src/agent.ts`。测试候选：尚无专项证据。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[sub-agents](https://code.claude.com/docs/en/sub-agents)、[model-config](https://code.claude.com/docs/en/model-config)。

## US-PLAN-01 — 只读规划、审批、修改与恢复

作为团队开发者，我希望先调查和评审计划，再按人工决定实现。

验收条件：

1. Given Plan 模式，When 模型请求写入/委派绕过，Then 强制只读并返回明确工具错误。
2. Given 待审批版本，When 批准/修改/拒绝/取消/恢复，Then 状态迁移合法、旧版审批无效、上下文和工具配对完整。

边界：空计划、100 状态对、两人并发审批、旧版本、取消后批准、非所有者。

状态：待专项验收；源码候选不代表完成。

实现候选：`src/plans.ts`、`src/planExecution.ts`、`src/agent.ts`。测试候选：`test/plan-state.test.ts`、`test/latest-reference-fixes.test.ts`。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[permission-modes](https://code.claude.com/docs/en/permission-modes)、[common-workflows](https://code.claude.com/docs/en/common-workflows)、[sub-agents](https://code.claude.com/docs/en/sub-agents)。

## US-TEAM-01 — 真实团队、成员与共享任务

作为团队开发者，我希望负责人能管理互相协作的工程角色，而非只看到多个对话。

验收条件：

1. Given 团队创建/成员加入，When 查看与认领依赖任务，Then root 身份、归属和状态一致。
2. Given 已活跃成员，When 清理团队，Then 拒绝不安全清理，保留代码、会话与 worktree。

边界：空团队、重复创建、未知 ID、跨项目、依赖环、任务并发认领、活动清理。

状态：待专项验收；源码候选不代表完成。

实现候选：`src/teamStore.ts`、`src/tasks.ts`、`src/taskManagement.ts`。测试候选：`test/skills-agents-teams-050.test.ts`。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[agent-teams](https://code.claude.com/docs/en/agent-teams)。

## US-TEAM-02 — 消息、广播、计划门与关闭恢复

作为团队开发者，我希望团队消息耐久、可追踪，但不能伪造人工授权。

验收条件：

1. Given 消息/广播/重试，When 落盘与读取，Then 已读/未读与部分失败明确。
2. Given 计划审批/质量门或 shutdown，When worker 继续，Then 执行有效门禁，协作关闭后可由人工恢复。

边界：跨团队、Agent permission_response、重复发送、100000/100001、运行中关闭、断电。

状态：消息/shutdown 已有测试；worker 计划门/质量门仍有差距。

实现候选：`src/mailbox.ts`、`src/enhancements/teamOrchestration.ts`。测试候选：`test/latest-reference-fixes.test.ts`、`test/skills-agents-teams-050.test.ts`。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[agent-teams](https://code.claude.com/docs/en/agent-teams)、[cross-session-messaging](https://code.claude.com/docs/en/cross-session-messaging)。

## US-VIEW-01 — Agent View、分组、预览、调度与审批

作为团队开发者，我希望在一个终端管理多会话，看到等待输入和 PR 状态。

验收条件：

1. Given 多项目多会话，When 搜索分组/peek/reply/attach，Then 目标身份明确且不串会话。
2. Given 调度后台新任务，When 选择目录/模型/权限，Then 各设置和工作树生效，审批只授予目标操作。

边界：0/1/1000 会话、跨项目、断线、失效 PR、并发审批、重启后台服务。

状态：现有列表/attach 不等于最新版完整 Agent View。

实现候选：`src/tui.ts`、`src/components/resourceDialog.ts`、`src/agent.ts`。测试候选：`test/agent-view-cli.test.ts`。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[agent-view](https://code.claude.com/docs/en/agent-view)。

## US-MSG-01 — 跨会话和跨机器消息

作为团队开发者，我希望显式授权后联系其他任务，并保留消息来源。

验收条件：

1. Given 同机/远端对话，When 枚举和发送，Then 按明确目标与权限投递，记录来源。
2. Given 代理收到另一任务消息，When 决定后续动作，Then 消息仅是数据，不自动成为用户授权。

边界：离线目标、重发、跨账户、远端重连、授权撤销、同名对话。

状态：团队邮箱不是完整跨会话/跨机器协议。

实现候选：`src/mailbox.ts`、`src/bridge/remoteBridgeCore.ts`。测试候选：尚无专项证据。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[cross-session-messaging](https://code.claude.com/docs/en/cross-session-messaging)。

## US-WF-01 — 动态工作流、可复用脚本与完成判据

作为团队开发者，我希望结构化并行任务可评审、复跑和验收，而不因跳步报告成功。

验收条件：

1. Given 工作流计划，When 人工批准后执行 DAG/循环/汇总，Then 依赖、输入与逐步结果持久化。
2. Given 某步未执行/失败/超时，When 汇总，Then 不得判成功；脚本访问仍走工具权限。

边界：空步骤、依赖环、并发上限、跳步、重试幂等、cwd 变化、断电恢复。

状态：已有编排基础不等于官方动态脚本工作流实现。

实现候选：`src/workflow.ts`、`src/agent.ts`。测试候选：`test/epic-local-completion.test.ts`。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[workflows](https://code.claude.com/docs/en/workflows)。

## US-WT-01 — Worktree 创建、环境准备、合并与清理

作为团队开发者，我希望代理独立修改文件，安全集成而不丢未推送成果。

验收条件：

1. Given 多分支 worktree，When 创建/setup/run，Then base ref 明确、文件隔离、生命周期 Hook 受控。
2. Given 脏文件、未推送提交或冲突，When remove/merge，Then 先报告并确认，不能静默删除。

边界：无 Git、未提交、未 push、冲突、hook 自建 worktree、目录含空格、断电。

状态：待专项验收；源码候选不代表完成。

实现候选：`src/worktree.ts`、`src/hooks.ts`、`src/agent.ts`。测试候选：`test/worktree.test.ts`。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[worktrees](https://code.claude.com/docs/en/worktrees)、[corporate-launcher](https://code.claude.com/docs/en/corporate-launcher)。

## US-GIT-01 — Git/CI/PR 与代码评审

作为团队开发者，我希望审查当前改动并在授权下交付，而不是自动外发代码。

验收条件：

1. Given diff/base/PR，When review，Then 只报告可定位的问题，修改和外发需要对应授权。
2. Given commit/push/draft PR，When 用户批准，Then 测试、分支与目标仓库可追溯；失败不伪称成功。

边界：空 diff、reftable、冲突 cherry-pick/revert、网络失败、未授权 push、私有仓库。

状态：真实 push/PR/云评审未验收。

实现候选：`src/workflow.ts`、`src/tooling.ts`。测试候选：`test/worktree.test.ts`。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[code-review-local](https://code.claude.com/docs/en/code-review-local)、[ultrareview](https://code.claude.com/docs/en/ultrareview)、[code-review](https://code.claude.com/docs/en/code-review)、[github-enterprise-server](https://code.claude.com/docs/en/github-enterprise-server)。

## US-TOOL-01 — 文件读取、搜索、编辑和二进制边界

作为团队开发者，我希望工具错误与零结果区分，避免把二进制当文本破坏。

验收条件：

1. Given Read/Grep/Glob/Edit，When 正常/无匹配/底层失败，Then 三种结果区分，拒绝越界和凭据路径。
2. Given 非文本或大文件，When 读取/编辑，Then 选择安全读取路径或明确拒绝，不返回乱码当成功。

边界：空/2MB/超限、NUL、xlsm/parquet/epub/heic、无匹配、进程失败、symlink race。

状态：待专项验收；源码候选不代表完成。

实现候选：`src/tooling.ts`、`src/policy.ts`。测试候选：`test/model-tool-safety.test.ts`。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[tools-reference](https://code.claude.com/docs/en/tools-reference)。

## US-TOOL-02 — Shell、PowerShell、后台输出和进程树

作为团队开发者，我希望长命令可取消和回看，所有子进程受企业控制。

验收条件：

1. Given shell allowlist/wrapper，When 创建命令，Then 参数不拼 shell、凭据环境清理、超时覆盖后代。
2. Given 停止后台命令，When 查看结果，Then 有结束状态与取消标识，不残留运行进程。

边界：孙进程、逃逸、无输出、输出阻塞、编码、重复 stop、Windows Job Objects。

状态：OS 级隔离与真实逃逸矩阵仍需专项。

实现候选：`src/executionControl.ts`、`src/policy.ts`、`src/tasks/LocalShellTask/LocalShellTask.ts`。测试候选：`test/execution-control.test.ts`。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[tools-reference](https://code.claude.com/docs/en/tools-reference)、[corporate-launcher](https://code.claude.com/docs/en/corporate-launcher)。

## US-TOOL-03 — Notebook、LSP、延迟工具发现与提问

作为团队开发者，我希望语言工具和人工问题有结构化结果及完整控制边界。

验收条件：

1. Given notebook/LSP/tool search，When 操作，Then 保留单元与诊断标识，工具可发现但未授权不能执行。
2. Given AskUserQuestion，When 回答/取消/恢复，Then 草稿、选择、工具结果配对保留，取消不冒充拒绝。

边界：损坏 notebook、未知 cell、无语言服务器、object code、并发提问、vim Esc。

状态：待专项验收；源码候选不代表完成。

实现候选：`src/notebooks.ts`、`src/services/lsp/manager.ts`、`src/components/questionDialog.ts`。测试候选：`test/notebook.test.ts`、`test/question-dialog.test.ts`。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[tools-reference](https://code.claude.com/docs/en/tools-reference)、[plugins/code-intelligence](https://code.claude.com/docs/en/plugins/code-intelligence)。

## US-MCP-01 — MCP 连接、工具、资源、提示与发现

作为团队开发者，我希望组员可接自建 MCP，企业可限制哪些服务器有效。

验收条件：

1. Given stdio/HTTP/SSE 配置，When connect/reload/list/call，Then 认证和工具 schema 经过校验，错误有 request-id。
2. Given 资源/提示/大量工具，When 获取/搜索，Then 分页和延迟加载不漏项，不把服务器内容视为人工命令。

边界：0/1/1000 工具、分页、损坏 schema、超时、断线、受管 deny、工具同名。

状态：待专项验收；源码候选不代表完成。

实现候选：`src/mcp.ts`。测试候选：`test/mcp.test.ts`、`test/mcp-streamable.test.ts`。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[mcp](https://code.claude.com/docs/en/mcp)、[mcp-quickstart](https://code.claude.com/docs/en/mcp-quickstart)、[managed-mcp](https://code.claude.com/docs/en/managed-mcp)。

## US-MCP-02 — OAuth、远端授权与凭据生命周期

作为企业管理员，我希望无浏览器环境也能安全授权，令牌不进入日志或打包产物。

验收条件：

1. Given OAuth metadata/PKCE，When login/refresh/logout，Then 验证 state/redirect/issuer 并隔离服务端凭据。
2. Given headless，When 不能开本地浏览器，Then 提供可用外部授权方式或明确阻塞，不绕过认证。

边界：state 不匹配、过期 refresh、撤销、动态注册、设备模式、并发续期、CA失败。

状态：待专项验收；源码候选不代表完成。

实现候选：`src/mcpOAuth.ts`、`src/mcpCredentials.ts`。测试候选：`test/mcp-oauth-code.test.ts`、`test/mcp-credentials.test.ts`。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[mcp](https://code.claude.com/docs/en/mcp)、[authentication](https://code.claude.com/docs/en/authentication)、[agent-sdk/mcp](https://code.claude.com/docs/en/agent-sdk/mcp)。

## US-MCP-03 — 服务端事件、Sampling、Elicitation 与续传

作为团队开发者，我希望MCP 可回推长任务结果，但不擅自调用付费模型或收集秘密。

验收条件：

1. Given 独立 GET SSE，When 断开重连，Then 按合法 event ID 续传并处理重复/过期事件。
2. Given server-initiated sampling/elicitation，When 需要模型或输入，Then 独立授权，拒绝也能完成协议。

边界：重复 ID、未知会话、重连续传、取消、嵌套提问、凭据字段、恶意服务端。

状态：已有通知测试不代表完整双向授权和企业互操作。

实现候选：`src/mcp.ts`。测试候选：`test/mcp-notifications.test.ts`、`test/mcp-watch-tasks.test.ts`。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[mcp](https://code.claude.com/docs/en/mcp)、[channels-reference](https://code.claude.com/docs/en/channels-reference)。

## US-HOOK-01 — 逐生命周期 Hook 输入、退出码和决策

作为团队开发者，我希望团队可按事件可靠执行检查，明确支持哪些 payload 和返回值。

验收条件：

1. Given 每个官方 Hook 事件，When 触发，Then 传入对应字段并校验 JSON/退出码/超时语义。
2. Given block/ask/continue/additionalContext，When 返回，Then 在对应控制点生效，来源可见，不能跨事件误用。

边界：每个事件×0/2/其他退出码、空stdout、损坏JSON、超时、并行、递归Stop。

状态：必须逐事件验收，不能仅凭 HookEvent 枚举通过。

实现候选：`src/hooks.ts`、`src/types.ts`。测试候选：`test/hooks.test.ts`。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[hooks](https://code.claude.com/docs/en/hooks)、[hooks-guide](https://code.claude.com/docs/en/hooks-guide)。

## US-HOOK-02 — Worktree/配置/压缩/子代理 Hook 与来源

作为团队开发者，我希望环境准备清理和审批能追溯到具体插件或 Skill。

验收条件：

1. Given setup/create/remove/config/compact/subagent，When Hook 执行，Then 顺序、cwd 和受管约束准确。
2. Given Skill/plugin Hook 请求 ask，When 显示批准，Then 清楚标出来源和待操作；Hook 不能批准自身权限。

边界：并发 worktree、未 push 成果、失败 cleanup、插件禁用、cwd改变、Hook递归。

状态：待专项验收；源码候选不代表完成。

实现候选：`src/hooks.ts`、`src/agent.ts`、`src/worktree.ts`。测试候选：`test/hooks.test.ts`、`test/worktree.test.ts`。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[hooks](https://code.claude.com/docs/en/hooks)、[worktrees](https://code.claude.com/docs/en/worktrees)、[sub-agents](https://code.claude.com/docs/en/sub-agents)。

## US-PLUG-01 — 插件制作、安装、作用域与贡献注册

作为团队开发者，我希望组员可以用清晰契约共享 Skill、Agent、MCP 和 Hook。

验收条件：

1. Given 合法 manifest/本地插件，When validate/install/reload，Then 贡献注册一次、命名空间明确、错误不吞掉。
2. Given user/project/local/session scope，When enable/disable/remove，Then 不污染其他项目，不隐式安装未批准插件。

边界：缺文件、未知字段、路径逃逸、名字冲突、重复 reload、临时目录、依赖缺失。

状态：待专项验收；源码候选不代表完成。

实现候选：`src/plugins.ts`、`src/platform.ts`、`src/marketplace.ts`。测试候选：`test/platform.test.ts`、`test/platform-management-cli.test.ts`。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[plugins/overview](https://code.claude.com/docs/en/plugins/overview)、[plugins/create](https://code.claude.com/docs/en/plugins/create)、[plugins/components](https://code.claude.com/docs/en/plugins/components)、[plugins/manifest-reference](https://code.claude.com/docs/en/plugins/manifest-reference)、[plugins/install](https://code.claude.com/docs/en/plugins/install)、[plugins/loading](https://code.claude.com/docs/en/plugins/loading)、[plugins/cli-reference](https://code.claude.com/docs/en/plugins/cli-reference)。

## US-PLUG-02 — 市场、依赖、来源信任与供应链回滚

作为团队开发者，我希望管理员可以禁用市场并固定审查过的插件版本。

验收条件：

1. Given marketplace disabled，When 启动/浏览/后台更新，Then 不发起市场网络请求。
2. Given 依赖/签名/摘要锁，When 安装升级与回滚，Then 验证来源、许可与依赖闭包，不先执行未知代码。

边界：错误签名、hash变更、依赖环、版本冲突、离线缓存、升级失败、私服认证。

状态：待专项验收；源码候选不代表完成。

实现候选：`src/marketplace.ts`、`src/pluginSignatures.ts`、`src/pluginHistory.ts`。测试候选：`test/plugin-signatures.test.ts`、`test/plugin-history.test.ts`。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[plugins/security](https://code.claude.com/docs/en/plugins/security)、[plugins/dependencies](https://code.claude.com/docs/en/plugins/dependencies)、[plugins/create-marketplace](https://code.claude.com/docs/en/plugins/create-marketplace)、[plugins/host-marketplace](https://code.claude.com/docs/en/plugins/host-marketplace)、[plugins/org](https://code.claude.com/docs/en/plugins/org)、[plugins/relevance](https://code.claude.com/docs/en/plugins/relevance)。

## US-PLUG-03 — 插件 Evals、成本和团队推广

作为团队开发者，我希望团队分发前能测试效果、成本与风险，而不是只测试能加载。

验收条件：

1. Given eval cases 与基线，When 执行/评分，Then 结果可复现，失败门阻止发布。
2. Given 团队发布，When 升级推广，Then 有版本/依赖/NOTICE/许可证与成本说明。

边界：无 key、本地 fixture/真模型区分、评分器失败、零预算、未授权再分发。

状态：当前未有与官方 plugin eval 等价的完整闭环。

实现候选：`src/plugins.ts`、`src/spending.ts`。测试候选：尚无专项证据。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[plugin-evals](https://code.claude.com/docs/en/plugin-evals)、[plugins/measure](https://code.claude.com/docs/en/plugins/measure)、[plugins/publish](https://code.claude.com/docs/en/plugins/publish)、[plugins/cli-hints](https://code.claude.com/docs/en/plugins/cli-hints)。

## US-MOD-01 — Mods UI 扩展、命令、事件和能力 API

作为团队开发者，我希望组员能扩展界面与工具，但执行能力仍由企业策略约束。

验收条件：

1. Given mod 定义，When render/events/API，Then 生命周期、作用域、并发和取消有明确契约。
2. Given 多行 Input/提问上方视图，When Enter/Shift+Enter/窄屏，Then 行数限制与表面能力正确，不能把文本渲染当代码执行。

边界：空pane、48/49行、terminal/app差异、循环事件、超时、before-first-response fork。

状态：待实现：现有插件贡献系统不是官方 Mods API。

实现候选：`src/tui.ts`、`src/plugins.ts`。测试候选：尚无专项证据。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[plugins/mods/overview](https://code.claude.com/docs/en/plugins/mods/overview)、[plugins/mods/create](https://code.claude.com/docs/en/plugins/mods/create)、[plugins/mods/interface](https://code.claude.com/docs/en/plugins/mods/interface)、[plugins/mods/gallery](https://code.claude.com/docs/en/plugins/mods/gallery)、[plugins/mods/api](https://code.claude.com/docs/en/plugins/mods/api)、[plugins/mods/events](https://code.claude.com/docs/en/plugins/mods/events)、[plugins/mods/reference](https://code.claude.com/docs/en/plugins/mods/reference)。

## US-MOD-02 — Mods 测试、托管和故障隔离

作为团队开发者，我希望扩展故障不能卡住整个会话，管理员能禁止或限定扩展。

验收条件：

1. Given 无账户/网络测试，When fire events/press buttons/stub model，Then 可复跑且不碰真实状态。
2. Given mod throws/times out/递归调用，When catch/fail，Then 错误边界与管理员限制生效，其他扩展不受污染。

边界：递归自身事件、catch抛错、禁用中加载、签名失败、env.set拒绝。

状态：待实现/专项验收。

实现候选：`src/plugins.ts`。测试候选：尚无专项证据。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[plugins/mods/test](https://code.claude.com/docs/en/plugins/mods/test)、[plugins/mods/troubleshoot](https://code.claude.com/docs/en/plugins/mods/troubleshoot)、[plugins/mods/admin](https://code.claude.com/docs/en/plugins/mods/admin)。

## US-AUTO-01 — 循环、定时、目标和预算

作为团队开发者，我希望无人值守任务持续推进但有可控成本和终止条件。

验收条件：

1. Given loop/goal/schedule，When 运行，Then 有到期、取消、预算和明确成功判据。
2. Given 限流与超远 usage reset，When retry，Then 有最大等待，不无限睡眠，不重复执行已完成任务。

边界：0/负间隔、重启、重叠调度、零预算、TPM/RPM、错误重试、最长等待。

状态：待专项验收；源码候选不代表完成。

实现候选：`src/automation.ts`、`src/modelRetry.ts`、`src/spending.ts`。测试候选：`test/automation-041.test.ts`、`test/model-retry.test.ts`。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[scheduled-tasks](https://code.claude.com/docs/en/scheduled-tasks)、[goal](https://code.claude.com/docs/en/goal)、[costs](https://code.claude.com/docs/en/costs)。

## US-PROTO-01 — Headless、双向 stream-json 和临时覆盖

作为团队开发者，我希望CI 和 IDE 可驱动同一个 Agent 控制流，不靠解析终端文本。

验收条件：

1. Given JSON/stream-json 输入，When 多轮用户/审批/取消消息，Then ID、事件次序和错误边界稳定。
2. Given 临时 settings/MCP/plugins/agents/tools 与 no-persistence，When 启动，Then 不写真实 home，结果可验证。

边界：半包/空包/坏JSON、并发消息、重复ID、关闭stdin、取消、无TTY、临时覆盖优先级。

状态：已有 print 不能当双向协议完全兼容。

实现候选：`src/cli.ts`、`src/runtimeEvents.ts`、`src/entrypoints/sdk.ts`、`src/streamInput.ts`。测试候选：`test/print-mode.test.ts`、`test/sdk-stream.test.ts`。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[headless](https://code.claude.com/docs/en/headless)、[cli-reference](https://code.claude.com/docs/en/cli-reference)、[agent-sdk/streaming-vs-single-mode](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode)、[agent-sdk/streaming-output](https://code.claude.com/docs/en/agent-sdk/streaming-output)。

## US-SDK-01 — 可编程 SDK、会话存储和结构化输出

作为团队开发者，我希望应用可复用平台核心，选择存储后端和严格输出契约。

验收条件：

1. Given SDK query/stream/continue，When 调用，Then 与 CLI 权限、工具、取消和预算一致。
2. Given 自定义存储/输出Schema，When 重放或校验失败，Then 明确错误，不能丢失工具配对或恢复到其他会话。

边界：空存储、事务失败、并发写、坏schema、后端断线、Python/TS范围区分。

状态：CCPT TS SDK 非官方 SDK 的二进制/类型兼容替代。

实现候选：`src/entrypoints/sdk.ts`、`src/sessions.ts`。测试候选：`test/sdk-stream.test.ts`。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[agent-sdk/overview](https://code.claude.com/docs/en/agent-sdk/overview)、[agent-sdk/typescript](https://code.claude.com/docs/en/agent-sdk/typescript)、[agent-sdk/python](https://code.claude.com/docs/en/agent-sdk/python)、[agent-sdk/session-storage](https://code.claude.com/docs/en/agent-sdk/session-storage)、[agent-sdk/structured-outputs](https://code.claude.com/docs/en/agent-sdk/structured-outputs)。

## US-SEC-01 — 默认权限、规则与人工批准

作为团队开发者，我希望高风险动作在正确边界获得批准，不能把自动分类冒充沙箱。

验收条件：

1. Given allow/ask/deny/managed，When 工具调用，Then deny 优先、审批针对实际目标且不可由代理自批。
2. Given auto/manual/plan/bypass 等模式，When 切换，Then UI、实际执行和管理员约束一致。

边界：别名绕过、重定向、批量工具、撤销、并发审批、输入中断、classifier失败。

状态：待专项验收；源码候选不代表完成。

实现候选：`src/utils/permissions/permissions.ts`、`src/permissionApprovals.ts`、`src/policy.ts`。测试候选：`test/permission-safety.test.ts`、`test/terminal-permission-integration.test.ts`。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[permissions](https://code.claude.com/docs/en/permissions)、[permission-modes](https://code.claude.com/docs/en/permission-modes)、[auto-mode-config](https://code.claude.com/docs/en/auto-mode-config)、[auto-mode-classifier-billing](https://code.claude.com/docs/en/auto-mode-classifier-billing)。

## US-SEC-02 — OS 沙箱、凭据后端和逃逸防护

作为企业管理员，我希望不可信代码不能读取宿主秘密或逃逸到未授权网络。

验收条件：

1. Given OS 隔离配置，When 启动 shell/后代进程，Then 文件、网络、环境与进程树受实际边界约束。
2. Given 不支持平台或隔离失败，When 运行，Then fail closed，明确不能用应用层 allowlist 替代 OS 沙箱。

边界：Windows/Linux/macOS、容器、逃逸、凭据文件、SSH/cloud token、wrapper消失。

状态：生产 P0：OS 逃逸矩阵与专用凭据后端仍未完成验收。

实现候选：`src/executionControl.ts`、`src/policy.ts`、`src/environment.ts`、`src/mcpCredentials.ts`。测试候选：`test/policy.test.ts`、`test/mcp-credentials.test.ts`。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[sandboxing](https://code.claude.com/docs/en/sandboxing)、[sandbox-environments](https://code.claude.com/docs/en/sandbox-environments)、[security](https://code.claude.com/docs/en/security)、[agent-sdk/secure-deployment](https://code.claude.com/docs/en/agent-sdk/secure-deployment)。

## US-ENT-01 — 托管策略分发与企业配置

作为企业管理员，我希望管理员统一部署并能审计配置是否生效。

验收条件：

1. Given 文件/Registry/plist/server policy，When 合并，Then 版本、来源、缓存与优先级可验证。
2. Given 本地用户修改/远端策略失败，When 启动或热更新，Then 不能静默放宽强制限制。

边界：离线/过期/撤销策略、Registry32/64、plist、服务端签名、冲突字段。

状态：需要企业真机分发矩阵，不以模拟 JSON 代替。

实现候选：`src/config.ts`。测试候选：`test/config.test.ts`。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[admin-setup](https://code.claude.com/docs/en/admin-setup)、[managed-settings](https://code.claude.com/docs/en/managed-settings)、[server-managed-settings](https://code.claude.com/docs/en/server-managed-settings)、[managed-mcp](https://code.claude.com/docs/en/managed-mcp)。

## US-ENT-02 — 公司模型协议、CA、代理、mTLS 与身份续期

作为团队开发者，我希望同事只填公司 URL/key/CA 就能使用正确协议，不混用部署。

验收条件：

1. Given Messages/Chat/Responses 独立 profile，When 选择，Then endpoint、header、tools/reasoning、流与响应映射正确。
2. Given CA/proxy/mTLS/Entra，When 前台与后台 worker 访问，Then TLS 验证开启、证书与凭据安全继承并续期。

边界：完整URL/基址、api-version、CA链、证书到期、407/401/400、SSE断线、TPM。

状态：本地协议 fixture 有测试；公司环境由同事真机验收。

实现候选：`src/modelConnection.ts`、`src/model.ts`、`src/network.ts`、`src/enterprise.ts`。测试候选：`test/deployment-agent-acceptance.test.ts`、`test/enterprise-connections.test.ts`。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[network-config](https://code.claude.com/docs/en/network-config)、[third-party-integrations](https://code.claude.com/docs/en/third-party-integrations)、[microsoft-foundry](https://code.claude.com/docs/en/microsoft-foundry)、[gateways](https://code.claude.com/docs/en/gateways)、[corporate-launcher](https://code.claude.com/docs/en/corporate-launcher)。

## US-ENT-03 — 供应商、网关和可用性矩阵

作为团队开发者，我希望选择部署前知道模型、认证和功能限制，不自动发往别处。

验收条件：

1. Given 供应商能力配置，When 注册模型，Then 明确上下文、tools/reasoning、多模态与传输能力。
2. Given 某功能不可用，When 请求，Then 报限制及安全替代方案，不跨供应商隐式 fallback。

边界：模型别名、部署不存在、能力冲突、region、CMEK、网关不同返回model名。

状态：待专项验收；源码候选不代表完成。

实现候选：`src/modelConnection.ts`、`src/enhancements/modelRouting.ts`。测试候选：`test/deployment-compatibility.test.ts`。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[feature-availability](https://code.claude.com/docs/en/feature-availability)、[amazon-bedrock](https://code.claude.com/docs/en/amazon-bedrock)、[google-vertex-ai](https://code.claude.com/docs/en/google-vertex-ai)、[microsoft-foundry](https://code.claude.com/docs/en/microsoft-foundry)、[claude-platform-on-aws](https://code.claude.com/docs/en/claude-platform-on-aws)、[claude-apps-gateway](https://code.claude.com/docs/en/claude-apps-gateway)。

## US-OBS-01 — 成本、token、审计、OTel 和数据策略

作为团队开发者，我希望分清上下文占用与账单，并保护日志/遥测中的企业数据。

验收条件：

1. Given reported/estimated/cache tokens，When 展示 usage，Then 来源和定价版本明确，不把累计token当窗口占用。
2. Given 工具权限事件与错误，When 导出审计，Then code/param/message/request-id可追踪，秘密脱敏；无存储策略有实际验证。

边界：缓存去重、reasoning token、无usage、未知价格、预算并发、磁盘满、遥测关闭。

状态：待专项验收；源码候选不代表完成。

实现候选：`src/usage.ts`、`src/tokenUsage.ts`、`src/audit.ts`、`src/modelErrors.ts`。测试候选：`test/token-usage.test.ts`、`test/audit.test.ts`、`test/spending.test.ts`。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[costs](https://code.claude.com/docs/en/costs)、[monitoring-usage](https://code.claude.com/docs/en/monitoring-usage)、[analytics](https://code.claude.com/docs/en/analytics)、[data-usage](https://code.claude.com/docs/en/data-usage)、[zero-data-retention](https://code.claude.com/docs/en/zero-data-retention)。

## US-UI-01 — 终端输入、焦点、快捷键与渲染

作为团队开发者，我希望界面说明的每个按键在真实终端都有效，长内容不阻塞操作。

验收条件：

1. Given prompt/search/list/detail/question，When Enter/Space/Esc/Tab/导航，Then 焦点、保存和取消与文案一致。
2. Given 长流、子代理输出、窄屏与读屏，When 重绘，Then 输入可响应，当前选择与草稿保留。

边界：raw key、粘贴、多行、Unicode grapheme、80/40列、10行、旧VTE、读屏。

状态：待专项验收；源码候选不代表完成。

实现候选：`src/tui.ts`、`src/keybindings/match.ts`、`src/tui/presentation.ts`。测试候选：`test/latest-reference-fixes.test.ts`、`test/terminal-parity.test.ts`。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[interactive-mode](https://code.claude.com/docs/en/interactive-mode)、[terminal-config](https://code.claude.com/docs/en/terminal-config)、[keybindings](https://code.claude.com/docs/en/keybindings)、[accessibility](https://code.claude.com/docs/en/accessibility)。

## US-UI-02 — 主题、Vim、Focus、状态栏和通知

作为团队开发者，我希望可以调整交互密度和输入习惯，同时不丢失决策与结果。

验收条件：

1. Given 自定义主题/Vim/Focus，When 切换，Then 设置作用域明确，Focus 不隐藏必要批准。
2. Given Vim bracket motion、提问草稿或语音，When Escape/取消，Then 不丢输入，平台不支持的能力明确禁用。

边界：16色、ANSI浅/深、emoji、INSERT/NORMAL、%配对、无麦克风、远程窗口。

状态：主题/Vim 基础不等于全部最新版交互。

实现候选：`src/tui.ts`、`src/vim/transitions.ts`、`src/components/theme.ts`。测试候选：`test/editor-config.test.ts`。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[interactive-mode](https://code.claude.com/docs/en/interactive-mode)、[terminal-config](https://code.claude.com/docs/en/terminal-config)、[keybindings](https://code.claude.com/docs/en/keybindings)、[statusline](https://code.claude.com/docs/en/statusline)、[voice-dictation](https://code.claude.com/docs/en/voice-dictation)。

## US-IDE-01 — VS Code 会话、上下文、Plan 和恢复

作为团队开发者，我希望在 IDE 中使用与 CLI 同一 Agent 并能看懂改动。

验收条件：

1. Given 文件/选区/附件/会话，When IDE 发送，Then 来源范围准确，后台状态和待审批可见。
2. Given 多窗口/remote/reload/crash，When 恢复，Then 不重开崩溃会话形成循环，不泄露其他窗口状态。

边界：WSL/SSH/容器、多窗口、断线、长thinking、LaTeX、LSP对象code、语音禁用。

状态：未完成真实 VS Code 远程/升级矩阵。

实现候选：`vscode-extension/package.json`、`src/ide.ts`。测试候选：`test/ide-stream.test.ts`、`test/ide-install.test.ts`。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[vs-code](https://code.claude.com/docs/en/vs-code)。

## US-IDE-02 — JetBrains 和编辑器互操作

作为团队开发者，我希望不同 IDE 的成员可接入同一平台核心。

验收条件：

1. Given JetBrains 与 CLI，When 选择上下文/查看diff/继续会话，Then 协议和权限边界一致。
2. Given 不支持 IDE，When 配置，Then 清晰说明范围，不把 VS Code 扩展当 JetBrains 支持。

边界：不同 IDE版本、远程后端、多个项目、端口冲突、断连。

状态：JetBrains 深度集成待实现/验收。

实现候选：`src/ide.ts`。测试候选：尚无专项证据。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[jetbrains](https://code.claude.com/docs/en/jetbrains)、[platforms](https://code.claude.com/docs/en/platforms)。

## US-ART-01 — Artifacts、安全渲染与分享

作为企业管理员，我希望分享 Agent 产物时明确私有/组织/公开边界。

验收条件：

1. Given 本地文档/交互产物，When 渲染或发布，Then HTML/脚本安全与权限边界明确。
2. Given 更新产物，When 需要文件写入/网络发布，Then Hook 和用户批准都生效，未发布不能显示成功链接。

边界：恶意HTML、路径越界、sticky header、移动视图、重复发布、撤销分享。

状态：本地产物注册不等于官方托管分享服务。

实现候选：`src/artifacts.ts`、`src/tui.ts`。测试候选：尚无专项证据。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[artifacts](https://code.claude.com/docs/en/artifacts)、[plugins/mods/interface](https://code.claude.com/docs/en/plugins/mods/interface)。

## US-CLOUD-01 — 云任务、Remote Control、手机和桌面

作为团队开发者，我希望需要远程继续时有清楚的部署和身份边界。

验收条件：

1. Given 本地↔云会话，When 转移/继续，Then 仓库状态、凭据与权限来源明确，断线不复制任务。
2. Given 移动/桌面专用功能，When 平台不具备，Then 标记外部服务依赖，不用本地假菜单冒充。

边界：离线、跨账户、未push、WSL、浏览器断线、iOS模拟器、窗口恢复。

状态：外部服务/平台专项，不承诺复制官方云账户服务。

实现候选：`src/bridge/remoteBridgeCore.ts`。测试候选：尚无专项证据。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[claude-code-on-the-web](https://code.claude.com/docs/en/claude-code-on-the-web)、[web-quickstart](https://code.claude.com/docs/en/web-quickstart)、[remote-control](https://code.claude.com/docs/en/remote-control)、[mobile](https://code.claude.com/docs/en/mobile)、[desktop](https://code.claude.com/docs/en/desktop)、[desktop-wsl](https://code.claude.com/docs/en/desktop-wsl)、[desktop-linux](https://code.claude.com/docs/en/desktop-linux)、[desktop-ios-simulator](https://code.claude.com/docs/en/desktop-ios-simulator)。

## US-CLOUD-02 — Routines、Projects 和自托管 Runner

作为团队开发者，我希望持续工作在受控环境执行，调度可恢复且不会重复外发。

验收条件：

1. Given schedule/API/Git 事件，When 启动隔离任务，Then 身份、仓库、预算与幂等记录齐备。
2. Given runner输出阻塞/策略失败/断线，When 关闭与重试，Then 有界缓冲、明确健康状态，不伪称已停止。

边界：256KiB日志、SIGTERM、重复事件、网络策略缺失、撤销、孤儿任务。

状态：平台级服务待实现/真实部署。

实现候选：`src/automation.ts`、`src/bridge/remoteBridgeCore.ts`。测试候选：尚无专项证据。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[routines](https://code.claude.com/docs/en/routines)、[claude-projects](https://code.claude.com/docs/en/claude-projects)、[self-hosted-environments](https://code.claude.com/docs/en/self-hosted-environments)、[self-hosted-environments-reference](https://code.claude.com/docs/en/self-hosted-environments-reference)、[self-hosted-environments-deploy](https://code.claude.com/docs/en/self-hosted-environments-deploy)、[cloud-environments](https://code.claude.com/docs/en/cloud-environments)。

## US-EXT-01 — 浏览器、电脑操作和 Slack/CI 连接

作为团队开发者，我希望按需接入工程系统，不因外部消息获得额外权限。

验收条件：

1. Given 浏览器/Slack/CI事件，When 进入会话，Then 认证来源、人工授权和动作范围明确。
2. Given 电脑操作或浏览器控制，When 涉及敏感信息/提交，Then 使用授权能力并保留审计，平台不支持则明确拒绝。

边界：伪造事件、重发、无浏览器、无桌面、跨账户、生产发布、敏感表单。

状态：外部连接器和平台权限依赖，不能仅按 MCP 入口认定完成。

实现候选：`src/channels.ts`、`src/mcp.ts`。测试候选：尚无专项证据。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[chrome](https://code.claude.com/docs/en/chrome)、[computer-use](https://code.claude.com/docs/en/computer-use)、[slack](https://code.claude.com/docs/en/slack)、[claude-tag](https://code.claude.com/docs/en/claude-tag)、[github-actions](https://code.claude.com/docs/en/github-actions)、[github-actions-cloud-providers](https://code.claude.com/docs/en/github-actions-cloud-providers)、[gitlab-ci-cd](https://code.claude.com/docs/en/gitlab-ci-cd)。

## US-DOC-01 — 错误诊断、排障、教学和发布治理

作为团队开发者，我希望同事可自行配置、排障和扩展，发布前有真实许可审查。

验收条件：

1. Given provider/配置/磁盘/工具故障，When 报错，Then 脱敏保留原因、阶段和 request-id，不能一律 login 或 no matches。
2. Given 发布 npm 包，When 检查来源，Then NOTICE、许可和再分发授权有证据；UNLICENSED 不是第三方授权。

边界：字符串error、嵌套error、磁盘满、代理、脱敏、缺NOTICE、安装包混入档案/密钥。

状态：待专项验收；源码候选不代表完成。

实现候选：`src/modelErrors.ts`、`src/cli.ts`、`package.json`。测试候选：`test/model-tool-safety.test.ts`、`test/source-closure.test.ts`。候选路径存在性在 traceability.json 单独记录，不把不存在的路径伪装成实现。

官方来源：[errors](https://code.claude.com/docs/en/errors)、[troubleshooting](https://code.claude.com/docs/en/troubleshooting)、[debug-your-config](https://code.claude.com/docs/en/debug-your-config)、[best-practices](https://code.claude.com/docs/en/best-practices)、[common-workflows](https://code.claude.com/docs/en/common-workflows)、[legal-and-compliance](https://code.claude.com/docs/en/legal-and-compliance)。
