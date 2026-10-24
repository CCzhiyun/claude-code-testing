# 官方全量文档与更新对照入口

2026-10-17 增量：REL-2.1.301-007 的本地提交保留、010 的搜索错误透传、011 的未支持条件任务拒绝、014 的 Command 展开放大限制、024 的 UTF-8/二进制区分已增加实现与专项测试。它们不是整条功能的全平台验收完成；具体边界见 [可靠性与恢复说明](RELIABILITY-AND-RECOVERY-2026-10-17.zh-CN.md)。以下表保留 2026-10-16 原始分诊状态供追溯。

已归档 228 个唯一英文索引页面，5267 个 Markdown 标题，421 个版本、7863 条历史更新；当前版本 2.1.301 的 51 条更新已逐条人工分诊。

已编写 57 个故事族，各有 Given/When/Then 与边界集。每个文档/标题/更新有稳定 ID。历史更新默认未逐条验证；关键词关联只是分诊，不能计算功能完成率。

原始全文/哈希/完整表在本地 .ccpt/reference-docs/2026-10-16/，不进 npm 发布包；不假定拥有其再分发许可。只归档官方公开英文索引可达页面，不包括其他语言、登录后内容或官方账户服务代码。

## 最新版逐条对照

| 更新 ID | 故事 | 当前处置 / 下一项验收 |
| --- | --- | --- |
| REL-2.1.301-001 | US-OBS-01, US-AUTO-01 | 待测：无人值守限流等待上限，区分用量窗口与瞬时 TPM。 |
| REL-2.1.301-002 | US-SK-01, US-SK-03, US-SK-04, US-OBS-01 | 外部供应商教学内容；CCPT 应提供自有 OTel 配置指引。 |
| REL-2.1.301-003 | US-UI-01, US-UI-02 | 待测：Vim % 以及 d/c/y 组合，不以基础 Vim 实现代替。 |
| REL-2.1.301-004 | US-MOD-01, US-UI-01, US-UI-02 | 未实现完整 Mods 多行 Input；输入行数与提交按键需专项。 |
| REL-2.1.301-005 | US-SEC-01, US-SEC-02, US-OBS-01 | 待测：审计/OTel 需区分分类器与规则决策。 |
| REL-2.1.301-006 | US-SEC-01, US-SEC-02, US-OBS-01 | 待测：分类器类别字段与敏感信息开关。 |
| REL-2.1.301-007 | US-HOOK-01, US-WT-01, US-GIT-01 | P0：worktree 清理前检查未推送提交；需真实 Git 矩阵。 |
| REL-2.1.301-008 | US-ENT-02, US-ENT-03 | 策略差异：不能把某供应商模型 fallback 自动移植到公司部署。 |
| REL-2.1.301-009 | US-DOC-01 | 待测：磁盘满应保留磁盘原因，不误报未登录。 |
| REL-2.1.301-010 | US-TOOL-01 | 待测：搜索底层失败不能作为空结果。 |
| REL-2.1.301-011 | US-WF-01, US-TOOL-01 | 动态工作流缺口：跳步不能被计为成功。 |
| REL-2.1.301-012 | US-HOOK-01 | 待测：artifact 更新仍须通过 Edit/Write Hook。 |
| REL-2.1.301-013 | US-SK-01, US-SK-03, US-SK-04 | 部分已修：Skill 命名参数 64×64 边界有新增测试；Command 独立路径待测。 |
| REL-2.1.301-014 | US-SK-01, US-SK-03, US-SK-04, US-HOOK-01 | 部分加固：Skill 展开超过 1MB 明确拒绝；Hooks/Commands 参数放大待测。 |
| REL-2.1.301-015 | US-UI-01, US-UI-02 | 平台专项：旧 VTE 启停控制序列未验收。 |
| REL-2.1.301-016 | US-DOC-01 | 平台专项：iTerm2 启动响应未验收。 |
| REL-2.1.301-017 | US-HOOK-01, US-ENT-02, US-ENT-03 | 待测：非对应供应商模型不得启动其认证刷新。 |
| REL-2.1.301-018 | US-OBS-01, US-PLUG-01, US-PLUG-02 | 公司凭据续期和短进程退出竞态需真机；未认定完成。 |
| REL-2.1.301-019 | US-SEC-01, US-SEC-02, US-ENT-02, US-ENT-03 | 待测：审批中断不应伪装成人类拒绝。 |
| REL-2.1.301-020 | US-CTX-01, US-CTX-02, US-ENT-02, US-ENT-03, US-OBS-01 | 待测：模型切换的额外付费摘要必须先获得授权。 |
| REL-2.1.301-021 | US-CTX-01, US-CTX-02, US-ENT-02, US-ENT-03, US-SES-01 | 待测：网关返回 model 别名不应导致循环 compact。 |
| REL-2.1.301-022 | US-UI-01, US-UI-02 | 本轮修的是主对话 raw Esc；不据此宣布 Vim INSERT 时序问题修复。 |
| REL-2.1.301-023 | US-UI-01, US-UI-02 | 待测：Vim 提问框 Esc 保留草稿与 NORMAL/INSERT 状态。 |
| REL-2.1.301-024 | US-TOOL-01 | 待测：二进制读取类型识别，不以大小限制代替。 |
| REL-2.1.301-025 | US-UI-01, US-UI-02 | 待测：窄屏仅表头 Markdown table 与 Plan card。 |
| REL-2.1.301-026 | US-SK-01, US-SK-03, US-SK-04 | 供应商专用教学内容，CCPT 自有集成指南另行编写。 |
| REL-2.1.301-027 | US-SK-01, US-SK-03, US-SK-04, US-ENT-02, US-ENT-03 | 待测：rewind 后有效 Skill catalog 仍然存在。 |
| REL-2.1.301-028 | US-CTX-01, US-CTX-02, US-SES-01 | 待测：恢复/compact 档案尚未加载时不提示错误快捷键。 |
| REL-2.1.301-029 | US-OBS-01 | 待测：取消后的任务提示生命周期。 |
| REL-2.1.301-030 | US-SK-01, US-SK-03, US-SK-04, US-HOOK-01, US-SEC-01, US-SEC-02, US-PLUG-01, US-PLUG-02 | 待测：Skill/plugin Hook ask 要显示贡献来源。 |
| REL-2.1.301-031 | US-WT-01, US-GIT-01 | 真实 Git reftable 冲突/超时矩阵待测。 |
| REL-2.1.301-032 | US-WF-01, US-SEC-01, US-SEC-02, US-SES-01, US-TOOL-01, US-TOOL-02 | 动态脚本工作流/cwd 权限继承尚未完整实现。 |
| REL-2.1.301-033 | US-UI-01, US-UI-02 | 待测：16色/ANSI 对比度与焦点高亮。 |
| REL-2.1.301-034 | US-MOD-01, US-CLOUD-01, US-CLOUD-02, US-EXT-01, US-ENT-02, US-ENT-03, US-SES-01, US-TOOL-02 | Mods API 缺口：首次响应完成前 fork 行为未实现。 |
| REL-2.1.301-035 | US-CTX-01, US-CTX-02 | 待测：大历史 compact 重绘期间键盘延迟。 |
| REL-2.1.301-036 | US-MCP-01, US-MCP-02, US-MCP-03, US-CLOUD-01, US-CLOUD-02, US-EXT-01, US-SES-01 | 自托管/Slack/MCP 策略矩阵，非本地模拟可完成。 |
| REL-2.1.301-037 | US-WT-01, US-GIT-01, US-CLOUD-01, US-CLOUD-02, US-EXT-01, US-SES-01 | 自托管错误分类待实现/验收，不用字符串片段猜 missing branch。 |
| REL-2.1.301-038 | US-CLOUD-01, US-CLOUD-02, US-EXT-01, US-AUTO-01, US-SES-01 | 自托管服务退出与重试计数待验收。 |
| REL-2.1.301-039 | US-TOOL-02 | 待测：Windows 后台 PowerShell 取消日志结束标识。 |
| REL-2.1.301-040 | US-CTX-01, US-CTX-02, US-ENT-02, US-ENT-03, US-SES-01 | 待测：切小窗口前压缩策略与付费批准。 |
| REL-2.1.301-041 | US-AG-02, US-VIEW-01, US-TEAM-01, US-UI-01, US-UI-02, US-TOOL-02 | 待测：长子代理输出增量渲染性能基准。 |
| REL-2.1.301-042 | US-CLOUD-01, US-CLOUD-02, US-EXT-01 | 外部托管 artifact 移动端视图，非现有 CLI 交付范围。 |
| REL-2.1.301-043 | US-MOD-01, US-IDE-01, US-IDE-02, US-UI-01, US-UI-02, US-CLOUD-01, US-CLOUD-02, US-EXT-01 | Mods 表面差异未实现：桌面/IDE/移动与终端分别验收。 |
| REL-2.1.301-044 | US-MOD-01, US-HOOK-01 | Mods catch/递归事件语义缺口。 |
| REL-2.1.301-045 | US-MOD-01 | Mods env.set 明确返回允许/拒绝的能力契约尚未实现。 |
| REL-2.1.301-046 | US-IDE-01, US-IDE-02, US-UI-01, US-UI-02 | VS Code LaTeX 渲染需真实扩展测试。 |
| REL-2.1.301-047 | US-MOD-01, US-IDE-01, US-IDE-02, US-OBS-01 | 供应商订阅购买入口不复制；CCPT 应展示公司用量/申请指引。 |
| REL-2.1.301-048 | US-MOD-01, US-IDE-01, US-IDE-02, US-SES-01 | VS Code 崩溃恢复黑名单和恢复入口待验收。 |
| REL-2.1.301-049 | US-MOD-01, US-IDE-01, US-IDE-02 | VS Code 长 thinking 增量渲染待性能测试。 |
| REL-2.1.301-050 | US-IDE-01, US-IDE-02 | 待测：LSP object 诊断代码规范化。 |
| REL-2.1.301-051 | US-SEC-01, US-SEC-02, US-IDE-01, US-IDE-02 | 待测：远程/非支持账户不加载语音原生模块。 |

## 全部官方文档

| 文档 ID | 官方页面 | 故事 | 单页端到端状态 |
| --- | --- | --- | --- |
| DOC-001 | [Use Claude Code with a screen reader](https://code.claude.com/docs/en/accessibility.md) | US-UI-01 | not-run（页内部分路径见专项报告） |
| DOC-002 | [Set up Claude Code for your organization](https://code.claude.com/docs/en/admin-setup.md) | US-ENT-01 | not-run（页内部分路径见专项报告） |
| DOC-003 | [Escalate hard decisions with the advisor tool](https://code.claude.com/docs/en/advisor.md) | US-DOC-01 | not-run（页内部分路径见专项报告） |
| DOC-004 | [How the agent loop works](https://code.claude.com/docs/en/agent-sdk/agent-loop.md) | US-SDK-01, US-PROTO-01 | not-run（页内部分路径见专项报告） |
| DOC-005 | [Use Claude Code features in the SDK](https://code.claude.com/docs/en/agent-sdk/claude-code-features.md) | US-SDK-01, US-PROTO-01 | not-run（页内部分路径见专项报告） |
| DOC-006 | [Configure your agent](https://code.claude.com/docs/en/agent-sdk/configuration.md) | US-SDK-01, US-PROTO-01 | not-run（页内部分路径见专项报告） |
| DOC-007 | [Track cost and usage](https://code.claude.com/docs/en/agent-sdk/cost-tracking.md) | US-SDK-01, US-PROTO-01 | not-run（页内部分路径见专项报告） |
| DOC-008 | [Give Claude custom tools](https://code.claude.com/docs/en/agent-sdk/custom-tools.md) | US-SDK-01, US-PROTO-01 | not-run（页内部分路径见专项报告） |
| DOC-009 | [Examples](https://code.claude.com/docs/en/agent-sdk/examples.md) | US-SDK-01, US-PROTO-01 | not-run（页内部分路径见专项报告） |
| DOC-010 | [Rewind file changes with checkpointing](https://code.claude.com/docs/en/agent-sdk/file-checkpointing.md) | US-SDK-01, US-PROTO-01 | not-run（页内部分路径见专项报告） |
| DOC-011 | [Intercept and control agent behavior with hooks](https://code.claude.com/docs/en/agent-sdk/hooks.md) | US-SDK-01, US-PROTO-01 | not-run（页内部分路径见专项报告） |
| DOC-012 | [Hosting the Agent SDK](https://code.claude.com/docs/en/agent-sdk/hosting.md) | US-SDK-01, US-PROTO-01 | not-run（页内部分路径见专项报告） |
| DOC-013 | [Connect to external tools with MCP](https://code.claude.com/docs/en/agent-sdk/mcp.md) | US-MCP-02 | not-run（页内部分路径见专项报告） |
| DOC-014 | [Migrate to Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/migration-guide.md) | US-SDK-01, US-PROTO-01 | not-run（页内部分路径见专项报告） |
| DOC-015 | [Modifying system prompts](https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts.md) | US-SDK-01, US-PROTO-01 | not-run（页内部分路径见专项报告） |
| DOC-016 | [Observability with OpenTelemetry](https://code.claude.com/docs/en/agent-sdk/observability.md) | US-SDK-01, US-PROTO-01 | not-run（页内部分路径见专项报告） |
| DOC-017 | [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview.md) | US-SDK-01 | not-run（页内部分路径见专项报告） |
| DOC-018 | [Configure permissions](https://code.claude.com/docs/en/agent-sdk/permissions.md) | US-SDK-01, US-PROTO-01 | not-run（页内部分路径见专项报告） |
| DOC-019 | [Plugins in the SDK](https://code.claude.com/docs/en/agent-sdk/plugins.md) | US-SDK-01, US-PROTO-01 | not-run（页内部分路径见专项报告） |
| DOC-020 | [Agent SDK reference - Python](https://code.claude.com/docs/en/agent-sdk/python.md) | US-SDK-01 | not-run（页内部分路径见专项报告） |
| DOC-021 | [Quickstart](https://code.claude.com/docs/en/agent-sdk/quickstart.md) | US-SDK-01, US-PROTO-01 | not-run（页内部分路径见专项报告） |
| DOC-022 | [Securely deploying AI agents](https://code.claude.com/docs/en/agent-sdk/secure-deployment.md) | US-SEC-02 | not-run（页内部分路径见专项报告） |
| DOC-023 | [Persist sessions to external storage](https://code.claude.com/docs/en/agent-sdk/session-storage.md) | US-SDK-01 | not-run（页内部分路径见专项报告） |
| DOC-024 | [Work with sessions](https://code.claude.com/docs/en/agent-sdk/sessions.md) | US-SDK-01, US-PROTO-01 | not-run（页内部分路径见专项报告） |
| DOC-025 | [Extend agents with skills](https://code.claude.com/docs/en/agent-sdk/skills.md) | US-SDK-01, US-PROTO-01 | not-run（页内部分路径见专项报告） |
| DOC-026 | [Stream responses in real-time](https://code.claude.com/docs/en/agent-sdk/streaming-output.md) | US-PROTO-01 | not-run（页内部分路径见专项报告） |
| DOC-027 | [Streaming Input](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode.md) | US-PROTO-01 | not-run（页内部分路径见专项报告） |
| DOC-028 | [Get structured output from agents](https://code.claude.com/docs/en/agent-sdk/structured-outputs.md) | US-SDK-01 | not-run（页内部分路径见专项报告） |
| DOC-029 | [Subagents in the SDK](https://code.claude.com/docs/en/agent-sdk/subagents.md) | US-SDK-01, US-PROTO-01 | not-run（页内部分路径见专项报告） |
| DOC-030 | [Track todos](https://code.claude.com/docs/en/agent-sdk/todo-tracking.md) | US-SDK-01, US-PROTO-01 | not-run（页内部分路径见专项报告） |
| DOC-031 | [Scale to many tools with tool search](https://code.claude.com/docs/en/agent-sdk/tool-search.md) | US-SDK-01, US-PROTO-01 | not-run（页内部分路径见专项报告） |
| DOC-032 | [Troubleshoot the Agent SDK](https://code.claude.com/docs/en/agent-sdk/troubleshooting.md) | US-SDK-01, US-PROTO-01 | not-run（页内部分路径见专项报告） |
| DOC-033 | [TypeScript SDK V2 session API (removed)](https://code.claude.com/docs/en/agent-sdk/typescript-v2-preview.md) | US-SDK-01, US-PROTO-01 | not-run（页内部分路径见专项报告） |
| DOC-034 | [Agent SDK reference - TypeScript](https://code.claude.com/docs/en/agent-sdk/typescript.md) | US-SDK-01 | not-run（页内部分路径见专项报告） |
| DOC-035 | [Handle approvals and user input](https://code.claude.com/docs/en/agent-sdk/user-input.md) | US-SDK-01, US-PROTO-01 | not-run（页内部分路径见专项报告） |
| DOC-036 | [Orchestrate teams of Claude Code sessions](https://code.claude.com/docs/en/agent-teams.md) | US-TEAM-01, US-TEAM-02 | not-run（页内部分路径见专项报告） |
| DOC-037 | [Manage multiple agents with agent view](https://code.claude.com/docs/en/agent-view.md) | US-AG-03, US-VIEW-01 | not-run（页内部分路径见专项报告） |
| DOC-038 | [Run agents in parallel](https://code.claude.com/docs/en/agents.md) | US-AG-02 | not-run（页内部分路径见专项报告） |
| DOC-039 | [Claude Code on Amazon Bedrock](https://code.claude.com/docs/en/amazon-bedrock.md) | US-ENT-03 | not-run（页内部分路径见专项报告） |
| DOC-040 | [Track team usage with analytics](https://code.claude.com/docs/en/analytics.md) | US-OBS-01 | not-run（页内部分路径见专项报告） |
| DOC-041 | [Share session output as artifacts](https://code.claude.com/docs/en/artifacts.md) | US-ART-01 | not-run（页内部分路径见专项报告） |
| DOC-042 | [Authentication](https://code.claude.com/docs/en/authentication.md) | US-MCP-02 | not-run（页内部分路径见专项报告） |
| DOC-043 | [Auto mode classifier request charges](https://code.claude.com/docs/en/auto-mode-classifier-billing.md) | US-SEC-01 | not-run（页内部分路径见专项报告） |
| DOC-044 | [Configure auto mode](https://code.claude.com/docs/en/auto-mode-config.md) | US-SEC-01 | not-run（页内部分路径见专项报告） |
| DOC-045 | [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices.md) | US-DOC-01 | not-run（页内部分路径见专项报告） |
| DOC-046 | [Champion kit](https://code.claude.com/docs/en/champion-kit.md) | US-DOC-01 | not-run（页内部分路径见专项报告） |
| DOC-047 | [Claude Code changelog](https://code.claude.com/docs/en/changelog.md) | US-SK-03 | not-run（页内部分路径见专项报告） |
| DOC-048 | [Channels reference](https://code.claude.com/docs/en/channels-reference.md) | US-MCP-03 | not-run（页内部分路径见专项报告） |
| DOC-049 | [Push events into a running session with channels](https://code.claude.com/docs/en/channels.md) | US-DOC-01 | not-run（页内部分路径见专项报告） |
| DOC-050 | [Checkpointing](https://code.claude.com/docs/en/checkpointing.md) | US-SES-02 | not-run（页内部分路径见专项报告） |
| DOC-051 | [Use Claude Code with Chrome](https://code.claude.com/docs/en/chrome.md) | US-EXT-01 | not-run（页内部分路径见专项报告） |
| DOC-052 | [Claude apps gateway configuration](https://code.claude.com/docs/en/claude-apps-gateway-config.md) | US-ENT-02, US-ENT-03 | not-run（页内部分路径见专项报告） |
| DOC-053 | [Claude apps gateway deployment and operations](https://code.claude.com/docs/en/claude-apps-gateway-deploy.md) | US-ENT-02, US-ENT-03 | not-run（页内部分路径见专项报告） |
| DOC-054 | [Deploy Claude apps gateway on AWS](https://code.claude.com/docs/en/claude-apps-gateway-on-aws.md) | US-ENT-02, US-ENT-03 | not-run（页内部分路径见专项报告） |
| DOC-055 | [Deploy Claude apps gateway on Google Cloud](https://code.claude.com/docs/en/claude-apps-gateway-on-gcp.md) | US-ENT-02, US-ENT-03 | not-run（页内部分路径见专项报告） |
| DOC-056 | [Claude apps gateway spend limits](https://code.claude.com/docs/en/claude-apps-gateway-spend-limits.md) | US-ENT-02, US-ENT-03 | not-run（页内部分路径见专项报告） |
| DOC-057 | [Claude apps gateway for Amazon Bedrock, Claude Platform on AWS, Google Cloud, and Microsoft Foundry](https://code.claude.com/docs/en/claude-apps-gateway.md) | US-ENT-03 | not-run（页内部分路径见专项报告） |
| DOC-058 | [Use Claude Code in the cloud](https://code.claude.com/docs/en/claude-code-on-the-web.md) | US-CLOUD-01 | not-run（页内部分路径见专项报告） |
| DOC-059 | [Explore the .claude directory](https://code.claude.com/docs/en/claude-directory.md) | US-CFG-01, US-RULE-01 | not-run（页内部分路径见专项报告） |
| DOC-060 | [Claude Code on Claude Platform on AWS](https://code.claude.com/docs/en/claude-platform-on-aws.md) | US-ENT-03 | not-run（页内部分路径见专项报告） |
| DOC-061 | [Let Claude coordinate ongoing work with Projects](https://code.claude.com/docs/en/claude-projects.md) | US-CLOUD-02 | not-run（页内部分路径见专项报告） |
| DOC-062 | [Scan your codebase for vulnerabilities](https://code.claude.com/docs/en/claude-security.md) | US-DOC-01 | not-run（页内部分路径见专项报告） |
| DOC-063 | [Claude Tag](https://code.claude.com/docs/en/claude-tag.md) | US-EXT-01 | not-run（页内部分路径见专项报告） |
| DOC-064 | [CLI reference](https://code.claude.com/docs/en/cli-reference.md) | US-PROTO-01 | not-run（页内部分路径见专项报告） |
| DOC-065 | [Configure cloud environments](https://code.claude.com/docs/en/cloud-environments.md) | US-CLOUD-02 | not-run（页内部分路径见专项报告） |
| DOC-066 | [Code Review costs and usage](https://code.claude.com/docs/en/code-review-costs.md) | US-GIT-01 | not-run（页内部分路径见专项报告） |
| DOC-067 | [Customize Code Review](https://code.claude.com/docs/en/code-review-customize.md) | US-GIT-01 | not-run（页内部分路径见专项报告） |
| DOC-068 | [Review locally with /code-review](https://code.claude.com/docs/en/code-review-local.md) | US-GIT-01 | not-run（页内部分路径见专项报告） |
| DOC-069 | [Read and request reviews on a pull request](https://code.claude.com/docs/en/code-review-pull-requests.md) | US-GIT-01 | not-run（页内部分路径见专项报告） |
| DOC-070 | [Set up Code Review](https://code.claude.com/docs/en/code-review-setup.md) | US-GIT-01 | not-run（页内部分路径见专项报告） |
| DOC-071 | [Troubleshoot Code Review](https://code.claude.com/docs/en/code-review-troubleshooting.md) | US-GIT-01 | not-run（页内部分路径见专项报告） |
| DOC-072 | [Code Review](https://code.claude.com/docs/en/code-review.md) | US-GIT-01 | not-run（页内部分路径见专项报告） |
| DOC-073 | [Commands](https://code.claude.com/docs/en/commands.md) | US-DOC-01 | not-run（页内部分路径见专项报告） |
| DOC-074 | [Common workflows](https://code.claude.com/docs/en/common-workflows.md) | US-PLAN-01, US-DOC-01 | not-run（页内部分路径见专项报告） |
| DOC-075 | [Communications kit](https://code.claude.com/docs/en/communications-kit.md) | US-DOC-01 | not-run（页内部分路径见专项报告） |
| DOC-076 | [Let Claude use your computer from the CLI](https://code.claude.com/docs/en/computer-use.md) | US-EXT-01 | not-run（页内部分路径见专项报告） |
| DOC-077 | [Explore the context window](https://code.claude.com/docs/en/context-window.md) | US-CTX-01 | not-run（页内部分路径见专项报告） |
| DOC-078 | [Run Claude Code behind a corporate launcher](https://code.claude.com/docs/en/corporate-launcher.md) | US-WT-01, US-TOOL-02, US-ENT-02 | not-run（页内部分路径见专项报告） |
| DOC-079 | [Manage costs effectively](https://code.claude.com/docs/en/costs.md) | US-CTX-01, US-CTX-02, US-AUTO-01, US-OBS-01 | not-run（页内部分路径见专项报告） |
| DOC-080 | [Message your other Claude Code sessions](https://code.claude.com/docs/en/cross-session-messaging.md) | US-TEAM-02, US-MSG-01 | not-run（页内部分路径见专项报告） |
| DOC-081 | [Data usage](https://code.claude.com/docs/en/data-usage.md) | US-OBS-01 | not-run（页内部分路径见专项报告） |
| DOC-082 | [Debug your configuration](https://code.claude.com/docs/en/debug-your-config.md) | US-CFG-01, US-RULE-02, US-DOC-01 | not-run（页内部分路径见专项报告） |
| DOC-083 | [Launch sessions from links](https://code.claude.com/docs/en/deep-links.md) | US-DOC-01 | not-run（页内部分路径见专项报告） |
| DOC-084 | [Test iOS apps in the simulator](https://code.claude.com/docs/en/desktop-ios-simulator.md) | US-CLOUD-01 | not-run（页内部分路径见专项报告） |
| DOC-085 | [Claude Desktop on Linux (beta)](https://code.claude.com/docs/en/desktop-linux.md) | US-CLOUD-01 | not-run（页内部分路径见专项报告） |
| DOC-086 | [Get started with the desktop app](https://code.claude.com/docs/en/desktop-quickstart.md) | US-CLOUD-01 | not-run（页内部分路径见专项报告） |
| DOC-087 | [Schedule recurring tasks in Claude Code Desktop](https://code.claude.com/docs/en/desktop-scheduled-tasks.md) | US-CLOUD-01 | not-run（页内部分路径见专项报告） |
| DOC-088 | [Claude Code Desktop in WSL](https://code.claude.com/docs/en/desktop-wsl.md) | US-CLOUD-01 | not-run（页内部分路径见专项报告） |
| DOC-089 | [Desktop application](https://code.claude.com/docs/en/desktop.md) | US-CLOUD-01 | not-run（页内部分路径见专项报告） |
| DOC-090 | [Development containers](https://code.claude.com/docs/en/devcontainer.md) | US-DOC-01 | not-run（页内部分路径见专项报告） |
| DOC-091 | [Environment variables](https://code.claude.com/docs/en/env-vars.md) | US-DOC-01 | not-run（页内部分路径见专项报告） |
| DOC-092 | [Error reference](https://code.claude.com/docs/en/errors.md) | US-DOC-01 | not-run（页内部分路径见专项报告） |
| DOC-093 | [Speed up responses with fast mode](https://code.claude.com/docs/en/fast-mode.md) | US-DOC-01 | not-run（页内部分路径见专项报告） |
| DOC-094 | [Feature availability](https://code.claude.com/docs/en/feature-availability.md) | US-ENT-03 | not-run（页内部分路径见专项报告） |
| DOC-095 | [Extend Claude Code](https://code.claude.com/docs/en/features-overview.md) | US-DOC-01 | not-run（页内部分路径见专项报告） |
| DOC-096 | [Fullscreen rendering](https://code.claude.com/docs/en/fullscreen.md) | US-DOC-01 | not-run（页内部分路径见专项报告） |
| DOC-097 | [Run Claude Code through a gateway](https://code.claude.com/docs/en/gateways.md) | US-ENT-02 | not-run（页内部分路径见专项报告） |
| DOC-098 | [Use Claude Code GitHub Actions with cloud providers](https://code.claude.com/docs/en/github-actions-cloud-providers.md) | US-EXT-01 | not-run（页内部分路径见专项报告） |
| DOC-099 | [Claude Code GitHub Actions](https://code.claude.com/docs/en/github-actions.md) | US-EXT-01 | not-run（页内部分路径见专项报告） |
| DOC-100 | [Claude Code with GitHub Enterprise Server](https://code.claude.com/docs/en/github-enterprise-server.md) | US-GIT-01 | not-run（页内部分路径见专项报告） |
| DOC-101 | [Claude Code GitLab CI/CD](https://code.claude.com/docs/en/gitlab-ci-cd.md) | US-EXT-01 | not-run（页内部分路径见专项报告） |
| DOC-102 | [Glossary](https://code.claude.com/docs/en/glossary.md) | US-DOC-01 | not-run（页内部分路径见专项报告） |
| DOC-103 | [Keep Claude working toward a goal](https://code.claude.com/docs/en/goal.md) | US-AUTO-01 | not-run（页内部分路径见专项报告） |
| DOC-104 | [Claude Code on Google Cloud's Agent Platform](https://code.claude.com/docs/en/google-vertex-ai.md) | US-ENT-03 | not-run（页内部分路径见专项报告） |
| DOC-105 | [Run Claude Code programmatically](https://code.claude.com/docs/en/headless.md) | US-SES-02, US-PROTO-01 | not-run（页内部分路径见专项报告） |
| DOC-106 | [Set up Claude Code (local mode) for a HIPAA-ready organization](https://code.claude.com/docs/en/hipaa-setup.md) | US-DOC-01 | not-run（页内部分路径见专项报告） |
| DOC-107 | [Automate actions with hooks](https://code.claude.com/docs/en/hooks-guide.md) | US-HOOK-01 | not-run（页内部分路径见专项报告） |
| DOC-108 | [Hooks reference](https://code.claude.com/docs/en/hooks.md) | US-HOOK-01, US-HOOK-02 | not-run（页内部分路径见专项报告） |
| DOC-109 | [How Claude Code works](https://code.claude.com/docs/en/how-claude-code-works.md) | US-DOC-01 | not-run（页内部分路径见专项报告） |
| DOC-110 | [Interactive mode](https://code.claude.com/docs/en/interactive-mode.md) | US-SES-01, US-AG-03, US-UI-01, US-UI-02 | not-run（页内部分路径见专项报告） |
| DOC-111 | [JetBrains IDEs](https://code.claude.com/docs/en/jetbrains.md) | US-IDE-02 | not-run（页内部分路径见专项报告） |
| DOC-112 | [Customize keyboard shortcuts](https://code.claude.com/docs/en/keybindings.md) | US-UI-01, US-UI-02 | not-run（页内部分路径见专项报告） |
| DOC-113 | [Set up Claude Code in a monorepo or large codebase](https://code.claude.com/docs/en/large-codebases.md) | US-CTX-01, US-RULE-01 | not-run（页内部分路径见专项报告） |
| DOC-114 | [Legal and compliance](https://code.claude.com/docs/en/legal-and-compliance.md) | US-DOC-01 | not-run（页内部分路径见专项报告） |
| DOC-115 | [Connect Claude Code to an LLM gateway](https://code.claude.com/docs/en/llm-gateway-connect.md) | US-DOC-01 | not-run（页内部分路径见专项报告） |
| DOC-116 | [Claude Code gateway compatibility guide](https://code.claude.com/docs/en/llm-gateway-protocol.md) | US-DOC-01 | not-run（页内部分路径见专项报告） |
| DOC-117 | [Roll out an LLM gateway for your organization](https://code.claude.com/docs/en/llm-gateway-rollout.md) | US-DOC-01 | not-run（页内部分路径见专项报告） |
| DOC-118 | [Other LLM gateways](https://code.claude.com/docs/en/llm-gateway.md) | US-DOC-01 | not-run（页内部分路径见专项报告） |
| DOC-119 | [Control MCP server access for your organization](https://code.claude.com/docs/en/managed-mcp.md) | US-MCP-01, US-ENT-01 | not-run（页内部分路径见专项报告） |
| DOC-120 | [Deploy managed settings](https://code.claude.com/docs/en/managed-settings.md) | US-ENT-01 | not-run（页内部分路径见专项报告） |
| DOC-121 | [Connect to MCP servers](https://code.claude.com/docs/en/mcp-quickstart.md) | US-MCP-01 | not-run（页内部分路径见专项报告） |
| DOC-122 | [Connect Claude Code to tools via MCP](https://code.claude.com/docs/en/mcp.md) | US-MCP-01, US-MCP-02, US-MCP-03 | not-run（页内部分路径见专项报告） |
| DOC-123 | [How Claude remembers your project](https://code.claude.com/docs/en/memory.md) | US-RULE-01, US-RULE-02, US-MEM-01 | not-run（页内部分路径见专项报告） |
| DOC-124 | [Claude Code on Microsoft Foundry](https://code.claude.com/docs/en/microsoft-foundry.md) | US-ENT-02, US-ENT-03 | not-run（页内部分路径见专项报告） |
| DOC-125 | [Claude Code on mobile](https://code.claude.com/docs/en/mobile.md) | US-CLOUD-01 | not-run（页内部分路径见专项报告） |
| DOC-126 | [Model configuration](https://code.claude.com/docs/en/model-config.md) | US-CTX-02, US-AG-04 | not-run（页内部分路径见专项报告） |
| DOC-127 | [Monitoring](https://code.claude.com/docs/en/monitoring-usage.md) | US-OBS-01 | not-run（页内部分路径见专项报告） |
| DOC-128 | [Enterprise network configuration](https://code.claude.com/docs/en/network-config.md) | US-ENT-02 | not-run（页内部分路径见专项报告） |
| DOC-129 | [Output styles](https://code.claude.com/docs/en/output-styles.md) | US-DOC-01 | not-run（页内部分路径见专项报告） |
| DOC-130 | [Overview](https://code.claude.com/docs/en/overview.md) | US-CLI-01 | not-run（页内部分路径见专项报告） |
| DOC-131 | [Choose a permission mode](https://code.claude.com/docs/en/permission-modes.md) | US-PLAN-01, US-SEC-01 | not-run（页内部分路径见专项报告） |
| DOC-132 | [Configure permissions](https://code.claude.com/docs/en/permissions.md) | US-SEC-01 | not-run（页内部分路径见专项报告） |
| DOC-133 | [Platforms and integrations](https://code.claude.com/docs/en/platforms.md) | US-IDE-02 | not-run（页内部分路径见专项报告） |
| DOC-134 | [Test plugins with evals](https://code.claude.com/docs/en/plugin-evals.md) | US-PLUG-03 | not-run（页内部分路径见专项报告） |
| DOC-135 | [Anthropic's marketplaces](https://code.claude.com/docs/en/plugins/anthropic-marketplaces.md) | US-PLUG-01, US-PLUG-02, US-PLUG-03 | not-run（页内部分路径见专项报告） |
| DOC-136 | [Recommend your plugin from your CLI](https://code.claude.com/docs/en/plugins/cli-hints.md) | US-PLUG-03 | not-run（页内部分路径见专项报告） |
| DOC-137 | [Plugin commands reference](https://code.claude.com/docs/en/plugins/cli-reference.md) | US-PLUG-01 | not-run（页内部分路径见专项报告） |
| DOC-138 | [Code intelligence plugins](https://code.claude.com/docs/en/plugins/code-intelligence.md) | US-TOOL-03 | not-run（页内部分路径见专项报告） |
| DOC-139 | [Add components to a plugin](https://code.claude.com/docs/en/plugins/components.md) | US-PLUG-01 | not-run（页内部分路径见专项报告） |
| DOC-140 | [Create a marketplace](https://code.claude.com/docs/en/plugins/create-marketplace.md) | US-PLUG-02 | not-run（页内部分路径见专项报告） |
| DOC-141 | [Create a Claude Code plugin](https://code.claude.com/docs/en/plugins/create.md) | US-PLUG-01 | not-run（页内部分路径见专项报告） |
| DOC-142 | [Plugin dependencies](https://code.claude.com/docs/en/plugins/dependencies.md) | US-PLUG-02 | not-run（页内部分路径见专项报告） |
| DOC-143 | [Host and maintain a marketplace](https://code.claude.com/docs/en/plugins/host-marketplace.md) | US-PLUG-02 | not-run（页内部分路径见专项报告） |
| DOC-144 | [Install and manage plugins](https://code.claude.com/docs/en/plugins/install.md) | US-PLUG-01 | not-run（页内部分路径见专项报告） |
| DOC-145 | [Plugin loading reference](https://code.claude.com/docs/en/plugins/loading.md) | US-SK-01, US-PLUG-01 | not-run（页内部分路径见专项报告） |
| DOC-146 | [Plugin manifest reference](https://code.claude.com/docs/en/plugins/manifest-reference.md) | US-PLUG-01 | not-run（页内部分路径见专项报告） |
| DOC-147 | [Marketplace reference](https://code.claude.com/docs/en/plugins/marketplace-reference.md) | US-PLUG-01, US-PLUG-02, US-PLUG-03 | not-run（页内部分路径见专项报告） |
| DOC-148 | [Measure plugin cost and usage](https://code.claude.com/docs/en/plugins/measure.md) | US-PLUG-03 | not-run（页内部分路径见专项报告） |
| DOC-149 | [Manage mods for your organization](https://code.claude.com/docs/en/plugins/mods/admin.md) | US-MOD-02 | not-run（页内部分路径见专项报告） |
| DOC-150 | [Use the mods API](https://code.claude.com/docs/en/plugins/mods/api.md) | US-MOD-01 | not-run（页内部分路径见专项报告） |
| DOC-151 | [Create a mod](https://code.claude.com/docs/en/plugins/mods/create.md) | US-MOD-01 | not-run（页内部分路径见专项报告） |
| DOC-152 | [React to events with a mod](https://code.claude.com/docs/en/plugins/mods/events.md) | US-MOD-01 | not-run（页内部分路径见专项报告） |
| DOC-153 | [Interface gallery for mods](https://code.claude.com/docs/en/plugins/mods/gallery.md) | US-MOD-01 | not-run（页内部分路径见专项报告） |
| DOC-154 | [Draw in the interface with a mod](https://code.claude.com/docs/en/plugins/mods/interface.md) | US-MOD-01, US-ART-01 | not-run（页内部分路径见专项报告） |
| DOC-155 | [Mods overview](https://code.claude.com/docs/en/plugins/mods/overview.md) | US-MOD-01 | not-run（页内部分路径见专项报告） |
| DOC-156 | [Mods reference](https://code.claude.com/docs/en/plugins/mods/reference.md) | US-MOD-01 | not-run（页内部分路径见专项报告） |
| DOC-157 | [Test a mod](https://code.claude.com/docs/en/plugins/mods/test.md) | US-MOD-02 | not-run（页内部分路径见专项报告） |
| DOC-158 | [Troubleshoot a mod](https://code.claude.com/docs/en/plugins/mods/troubleshoot.md) | US-MOD-02 | not-run（页内部分路径见专项报告） |
| DOC-159 | [Manage Claude Code plugins for your organization](https://code.claude.com/docs/en/plugins/org.md) | US-PLUG-02 | not-run（页内部分路径见专项报告） |
| DOC-160 | [Plugins overview](https://code.claude.com/docs/en/plugins/overview.md) | US-PLUG-01 | not-run（页内部分路径见专项报告） |
| DOC-161 | [Publish and distribute a plugin](https://code.claude.com/docs/en/plugins/publish.md) | US-PLUG-03 | not-run（页内部分路径见专项报告） |
| DOC-162 | [Recommend plugins for your org](https://code.claude.com/docs/en/plugins/relevance.md) | US-PLUG-02 | not-run（页内部分路径见专项报告） |
| DOC-163 | [Plugin security and trust](https://code.claude.com/docs/en/plugins/security.md) | US-PLUG-02 | not-run（页内部分路径见专项报告） |
| DOC-164 | [Troubleshoot plugins](https://code.claude.com/docs/en/plugins/troubleshooting.md) | US-PLUG-01, US-PLUG-02, US-PLUG-03 | not-run（页内部分路径见专项报告） |
| DOC-165 | [How Claude Code uses prompt caching](https://code.claude.com/docs/en/prompt-caching.md) | US-CTX-02 | not-run（页内部分路径见专项报告） |
| DOC-166 | [Prompt library](https://code.claude.com/docs/en/prompt-library.md) | US-DOC-01 | not-run（页内部分路径见专项报告） |
| DOC-167 | [Quickstart](https://code.claude.com/docs/en/quickstart.md) | US-CLI-01 | not-run（页内部分路径见专项报告） |
| DOC-168 | [Continue local sessions from any device with Remote Control](https://code.claude.com/docs/en/remote-control.md) | US-CLOUD-01 | not-run（页内部分路径见专项报告） |
| DOC-169 | [Automate work with routines](https://code.claude.com/docs/en/routines.md) | US-CLOUD-02 | not-run（页内部分路径见专项报告） |
| DOC-170 | [Choose a sandbox environment](https://code.claude.com/docs/en/sandbox-environments.md) | US-SEC-02 | not-run（页内部分路径见专项报告） |
| DOC-171 | [Configure the sandboxed Bash tool](https://code.claude.com/docs/en/sandboxing.md) | US-SEC-02 | not-run（页内部分路径见专项报告） |
| DOC-172 | [Run prompts on a schedule](https://code.claude.com/docs/en/scheduled-tasks.md) | US-AUTO-01 | not-run（页内部分路径见专项报告） |
| DOC-173 | [Catch security issues as Claude writes code](https://code.claude.com/docs/en/security-guidance.md) | US-DOC-01 | not-run（页内部分路径见专项报告） |
| DOC-174 | [Security](https://code.claude.com/docs/en/security.md) | US-SEC-02 | not-run（页内部分路径见专项报告） |
| DOC-175 | [Customize sessions in self-hosted environments](https://code.claude.com/docs/en/self-hosted-environments-configuration.md) | US-CLOUD-02 | not-run（页内部分路径见专项报告） |
| DOC-176 | [Deploy self-hosted environments to production](https://code.claude.com/docs/en/self-hosted-environments-deploy.md) | US-CLOUD-02 | not-run（页内部分路径见专项报告） |
| DOC-177 | [Verify session identity in self-hosted environments](https://code.claude.com/docs/en/self-hosted-environments-identity.md) | US-CLOUD-02 | not-run（页内部分路径见专项报告） |
| DOC-178 | [Self-hosted environments quickstart](https://code.claude.com/docs/en/self-hosted-environments-quickstart.md) | US-CLOUD-02 | not-run（页内部分路径见专项报告） |
| DOC-179 | [Self-hosted environments reference](https://code.claude.com/docs/en/self-hosted-environments-reference.md) | US-CLOUD-02 | not-run（页内部分路径见专项报告） |
| DOC-180 | [Test self-hosted environments end to end](https://code.claude.com/docs/en/self-hosted-environments-testing.md) | US-CLOUD-02 | not-run（页内部分路径见专项报告） |
| DOC-181 | [Self-hosted environments](https://code.claude.com/docs/en/self-hosted-environments.md) | US-CLOUD-02 | not-run（页内部分路径见专项报告） |
| DOC-182 | [Configure server-managed settings](https://code.claude.com/docs/en/server-managed-settings.md) | US-ENT-01 | not-run（页内部分路径见专项报告） |
| DOC-183 | [Manage sessions](https://code.claude.com/docs/en/sessions.md) | US-SES-01, US-SES-02 | not-run（页内部分路径见专项报告） |
| DOC-184 | [Example settings files](https://code.claude.com/docs/en/settings-example.md) | US-CFG-01 | not-run（页内部分路径见专项报告） |
| DOC-185 | [All settings](https://code.claude.com/docs/en/settings-reference.md) | US-CFG-01 | not-run（页内部分路径见专项报告） |
| DOC-186 | [Settings files and precedence](https://code.claude.com/docs/en/settings.md) | US-CFG-01 | not-run（页内部分路径见专项报告） |
| DOC-187 | [Advanced setup](https://code.claude.com/docs/en/setup.md) | US-CLI-01 | not-run（页内部分路径见专项报告） |
| DOC-188 | [Extend Claude with skills](https://code.claude.com/docs/en/skills.md) | US-SK-01, US-SK-02, US-SK-03, US-SK-04, US-SK-05 | not-run（页内部分路径见专项报告） |
| DOC-189 | [Claude Code in Slack](https://code.claude.com/docs/en/slack.md) | US-EXT-01 | not-run（页内部分路径见专项报告） |
| DOC-190 | [Customize your status line](https://code.claude.com/docs/en/statusline.md) | US-UI-02 | not-run（页内部分路径见专项报告） |
| DOC-191 | [Create custom subagents](https://code.claude.com/docs/en/sub-agents.md) | US-MEM-01, US-SK-04, US-AG-01, US-AG-02, US-AG-03, US-AG-04, US-PLAN-01, US-HOOK-02 | not-run（页内部分路径见专项报告） |
| DOC-192 | [Configure your terminal for Claude Code](https://code.claude.com/docs/en/terminal-config.md) | US-UI-01, US-UI-02 | not-run（页内部分路径见专项报告） |
| DOC-193 | [Enterprise deployment overview](https://code.claude.com/docs/en/third-party-integrations.md) | US-ENT-02 | not-run（页内部分路径见专项报告） |
| DOC-194 | [Tools reference](https://code.claude.com/docs/en/tools-reference.md) | US-TOOL-01, US-TOOL-02, US-TOOL-03 | not-run（页内部分路径见专项报告） |
| DOC-195 | [Troubleshoot installation and login](https://code.claude.com/docs/en/troubleshoot-install.md) | US-CLI-01 | not-run（页内部分路径见专项报告） |
| DOC-196 | [Troubleshooting](https://code.claude.com/docs/en/troubleshooting.md) | US-DOC-01 | not-run（页内部分路径见专项报告） |
| DOC-197 | [Find bugs with ultrareview](https://code.claude.com/docs/en/ultrareview.md) | US-GIT-01 | not-run（页内部分路径见专项报告） |
| DOC-198 | [Voice dictation](https://code.claude.com/docs/en/voice-dictation.md) | US-UI-02 | not-run（页内部分路径见专项报告） |
| DOC-199 | [Use Claude Code in VS Code](https://code.claude.com/docs/en/vs-code.md) | US-IDE-01 | not-run（页内部分路径见专项报告） |
| DOC-200 | [Get started with Claude Code in the cloud](https://code.claude.com/docs/en/web-quickstart.md) | US-CLOUD-01 | not-run（页内部分路径见专项报告） |
| DOC-201 | [Week 13 · March 23–27, 2026](https://code.claude.com/docs/en/whats-new/2026-w13.md) | US-DOC-01 | not-run（页内部分路径见专项报告） |
| DOC-202 | [Week 14 · March 30 – April 3, 2026](https://code.claude.com/docs/en/whats-new/2026-w14.md) | US-DOC-01 | not-run（页内部分路径见专项报告） |
| DOC-203 | [Week 15 · April 6–10, 2026](https://code.claude.com/docs/en/whats-new/2026-w15.md) | US-DOC-01 | not-run（页内部分路径见专项报告） |
| DOC-204 | [Week 16 · April 13–17, 2026](https://code.claude.com/docs/en/whats-new/2026-w16.md) | US-DOC-01 | not-run（页内部分路径见专项报告） |
| DOC-205 | [Week 17 · April 20–24, 2026](https://code.claude.com/docs/en/whats-new/2026-w17.md) | US-DOC-01 | not-run（页内部分路径见专项报告） |
| DOC-206 | [Week 18 · April 27 – May 1, 2026](https://code.claude.com/docs/en/whats-new/2026-w18.md) | US-DOC-01 | not-run（页内部分路径见专项报告） |
| DOC-207 | [Week 19 · May 4–8, 2026](https://code.claude.com/docs/en/whats-new/2026-w19.md) | US-DOC-01 | not-run（页内部分路径见专项报告） |
| DOC-208 | [Week 20 · May 11–15, 2026](https://code.claude.com/docs/en/whats-new/2026-w20.md) | US-DOC-01 | not-run（页内部分路径见专项报告） |
| DOC-209 | [Week 21 · May 18–22, 2026](https://code.claude.com/docs/en/whats-new/2026-w21.md) | US-DOC-01 | not-run（页内部分路径见专项报告） |
| DOC-210 | [Week 22 · May 25–29, 2026](https://code.claude.com/docs/en/whats-new/2026-w22.md) | US-DOC-01 | not-run（页内部分路径见专项报告） |
| DOC-211 | [Week 23 · June 1–5, 2026](https://code.claude.com/docs/en/whats-new/2026-w23.md) | US-DOC-01 | not-run（页内部分路径见专项报告） |
| DOC-212 | [Week 24 · June 8–12, 2026](https://code.claude.com/docs/en/whats-new/2026-w24.md) | US-DOC-01 | not-run（页内部分路径见专项报告） |
| DOC-213 | [Week 25 · June 15–19, 2026](https://code.claude.com/docs/en/whats-new/2026-w25.md) | US-DOC-01 | not-run（页内部分路径见专项报告） |
| DOC-214 | [Week 26 · June 22–26, 2026](https://code.claude.com/docs/en/whats-new/2026-w26.md) | US-DOC-01 | not-run（页内部分路径见专项报告） |
| DOC-215 | [Week 27 · June 29 – July 3, 2026](https://code.claude.com/docs/en/whats-new/2026-w27.md) | US-DOC-01 | not-run（页内部分路径见专项报告） |
| DOC-216 | [Week 28 · July 6–10, 2026](https://code.claude.com/docs/en/whats-new/2026-w28.md) | US-DOC-01 | not-run（页内部分路径见专项报告） |
| DOC-217 | [Week 29 · July 13–17, 2026](https://code.claude.com/docs/en/whats-new/2026-w29.md) | US-DOC-01 | not-run（页内部分路径见专项报告） |
| DOC-218 | [Week 30 · July 20–24, 2026](https://code.claude.com/docs/en/whats-new/2026-w30.md) | US-DOC-01 | not-run（页内部分路径见专项报告） |
| DOC-219 | [Week 32 · August 3–7, 2026](https://code.claude.com/docs/en/whats-new/2026-w32.md) | US-DOC-01 | not-run（页内部分路径见专项报告） |
| DOC-220 | [Week 33 · August 10–14, 2026](https://code.claude.com/docs/en/whats-new/2026-w33.md) | US-DOC-01 | not-run（页内部分路径见专项报告） |
| DOC-221 | [Week 34 · August 17–21, 2026](https://code.claude.com/docs/en/whats-new/2026-w34.md) | US-DOC-01 | not-run（页内部分路径见专项报告） |
| DOC-222 | [Week 35 · August 24–28, 2026](https://code.claude.com/docs/en/whats-new/2026-w35.md) | US-DOC-01 | not-run（页内部分路径见专项报告） |
| DOC-223 | [Week 36 · August 31 – September 4, 2026](https://code.claude.com/docs/en/whats-new/2026-w36.md) | US-DOC-01 | not-run（页内部分路径见专项报告） |
| DOC-224 | [Week 37 · September 7–11, 2026](https://code.claude.com/docs/en/whats-new/2026-w37.md) | US-DOC-01 | not-run（页内部分路径见专项报告） |
| DOC-225 | [What's new](https://code.claude.com/docs/en/whats-new/index.md) | US-DOC-01 | not-run（页内部分路径见专项报告） |
| DOC-226 | [Orchestrate subagents at scale with dynamic workflows](https://code.claude.com/docs/en/workflows.md) | US-WF-01 | not-run（页内部分路径见专项报告） |
| DOC-227 | [Run parallel sessions with worktrees](https://code.claude.com/docs/en/worktrees.md) | US-WT-01, US-HOOK-02 | not-run（页内部分路径见专项报告） |
| DOC-228 | [Zero data retention](https://code.claude.com/docs/en/zero-data-retention.md) | US-OBS-01 | not-run（页内部分路径见专项报告） |
