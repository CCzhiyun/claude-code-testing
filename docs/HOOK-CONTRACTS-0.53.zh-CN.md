# Hook payload / 退出码契约表

历史 0.53 契约记录，下面的表不是最新版。0.54 已增加跨进程 once 持久收据；0.60 补 MessageDisplay 表面替换、CwdChanged、外部显式文件监听、模型边界 StopFailure 和活动撤权暂停。当前说明见 [0.60](DELIVERY-0.60.zh-CN.md)，实际契约以 `ccpt hooks matrix` 为准；失败/崩溃不自动重放，不承诺外部副作用 exactly-once。

本表描述 CCPT 0.53 的实际 dispatcher，不宣称与任何其他 CLI 的逐事件行为完全等价。机器可读表：`ccpt hooks matrix`；SDK：`hookCompatibilityMatrix()`。类型新增事件但未加入表时，TypeScript 检查会失败。

## 公共输入与结果

同步 command hook 从 stdin 读取 UTF-8 JSON：必有 `hook_event_name`、`cwd`；调用者传 `sessionId`/`agentId` 时补 `session_id`/`agent_id`。其余字段来自真实调用方，保留原样，**不是所有事件都具有完整会话/工具/任务字段**。环境 `CCPT_HOOK_PAYLOAD` 是脱敏投影，不能代替 stdin 完整 payload。

| 事件 | 公共字段以外的边界 |
| --- | --- |
| SessionStart / SessionEnd | 会话启动/结束调用者提供的上下文；字段不是第三方完整协议的镜像 |
| UserPromptSubmit / UserPromptExpansion | 调用方提交的 prompt 上下文，不应在审计日志中写原文 |
| PreToolUse / PostToolUse / PostToolUseFailure / PostToolBatch | 按实际路径提供 `tool`/`input`/结果；兼容命名来自调用方，不自动承诺所有 alias 都注入 |
| PermissionRequest / PermissionDenied | 原请求与权限原因；Hook 返回 allow 不替代人工授权或管理员规则 |
| TaskCompleted / TeammateIdle | 实际完成门禁携带 task_id/agent_id/session_id/task_subject；验证失败反馈后才能再次尝试完成 |
| WorktreeCreate | repo/worktree/branch/agentId/includedFiles |
| WorktreeRemove | repo/worktree；不保证所有第三方自定义环境变量 |
| ConfigChange | path/keys；失败阻止当前设置保存 |
| Notification / MessageDisplay | 原通知/显示调用者数据；不是自动授权来源 |
| Setup / Stop / StopFailure | 当前 CCPT 调用链上下文；事件级退出码与参照完整等价尚未认证 |
| InstructionsLoaded / CwdChanged / DirectoryAdded / FileChanged | dispatcher/扩展入口支持；不保证每次底层文件系统变化都自动发出这些 Hooks |
| PreCompact / PostCompact | 当前压缩调用链数据；不意味着零信息损失 |
| Elicitation / ElicitationResult | 生命周期扩展事件；MCP 的人工审批由专用可信 handler 执行，不能拿这些事件自动批准 |
| TaskCreated / TaskUpdated / SubagentStart / SubagentStop | 具体调用方提供的任务/Agent 数据；不是覆盖所有辅助模块的自动触发保证 |
| CheckpointCreated / CheckpointRestored | 当前 checkpoint/扩展调用链数据 |

## command 退出码与 stdout

| 情况 | 本版实际行为 |
| --- | --- |
| exit 0 | 解析 stdout；纯文本作为 additionalContext；JSON 支持顶层/嵌套 hookSpecificOutput 的 additionalContext、updatedInput、deny 等 |
| exit 2 | 抛 HookDecisionError，retry=true；完成门禁将反馈给原 Agent，不假完成 |
| 其他非零 / signal / timeout | 错误向上传递，失败关闭；**当前不是参照工具所有事件的“仅警告”语义** |
| continue=false | 明确停止，retry=false |
| decision=block / permissionDecision=deny | 阻止，不获得额外权限 |
| prompt / agent verifier | 必须返回显式 JSON verdict，缺失/非法结论拒绝 |
| async command | 后台派发不能提供同步判定；TaskCompleted、TeammateIdle、SubagentStop 拒绝 async |

插件 Hook 的来源标签是 `plugin:<name>`；同样显示在错误中，不是信任凭据。Restricted 模式禁用 Hooks；sandbox command hook 仍要求受控 process wrapper。命令不接受 shell 运算符。

`once` 去重目前限当前进程与调用身份，不承诺跨进程/断电 exactly-once。动态 shell 插值、全部事件级退出码等价、全量自动触发点、跨进程 once 与第三方团队插件互操作仍未实现或未完整验收。

测试：`test/table-followup.test.ts` 对全部声明事件直接执行真实 Node command fixture，检查公共 payload 与 updatedInput；另覆盖退出码 2/3 与插件来源标签。该测试不等于每个事件都在真实 SDLC 位置自动触发。
