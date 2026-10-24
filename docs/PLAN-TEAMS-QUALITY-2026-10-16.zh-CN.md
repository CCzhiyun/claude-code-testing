# CCPT：Plan 执行恢复、Teams 与完成质量检查（2026-10-16）

接续会话恢复的两轮增强。本轮聚焦真实运行链路，不把独立状态辅助函数视为已完成的平台能力。

行为参考：[官方 Teams 文档](https://code.claude.com/docs/en/agent-teams)、[TaskCompleted 与 TeammateIdle Hooks](https://code.claude.com/docs/en/hooks)。公开文档是行为参考，不代表逐菜单、逐事件完全等价。

## 本轮修复

### 一个 Plan 不应同时启动多个执行者

- `executeProjectPlan` 使用版本比较，在状态锁内预约执行。并发点击、CLI 或 IDE 同时执行同一版本时只有一个请求可以取得预约。
- worker 启动前记录执行 Agent 身份；worker 在首次模型请求前核对 Plan 状态与执行身份。
- 另一个 Agent 不能覆盖已绑定的执行者；完成回写核对身份，不能悄悄替其他执行者结案。
- 等待结果超时不再把仍在工作的 Plan 写为失败。
- 被阻塞的执行显式恢复时复用原 Agent、会话和工具历史，不创建一个丢失上下文的新执行者。已经完成的 Plan 后续普通聊天不会继续携带过期的 Plan 执行身份。
- 修改尚未批准的计划时清除旧审批/执行时间和身份元数据，等待重新审批。

### 先检查，再发布完成

- Agent 返回最终文本后，先运行同步 `TaskCompleted`、`TeammateIdle` 以及子 Agent 的 `SubagentStop` 检查，再持久化和发布 Agent/任务/Plan 完成。
- 退出码 `2` 将 stderr 作为反馈加入当前会话，Agent 在原权限边界内继续处理。旧格式 `decision:block` 也作为阻止完成的反馈处理。
- 不无限重试：单次 worker 最多进行 8 次连续完成检查，且不超过该 Agent 的 `maxTurns`。仍不通过时保留会话为 `waiting_for_input`，关联任务/Plan 为 `blocked`，不冒充成功。
- `continue:false` 和 `stopReason` 停止当前自动处理，保留会话等待人工继续；不是把对话关闭或删除。
- 检查程序启动失败、超时、异常退出或模型验证器没有明确 JSON 结论时，不放行完成。
- prompt/agent 验证器支持 `ok:false`。返回普通文字或空对象不再被当成通过；现有 `decision` / `continue` 显式格式继续兼容。
- `task_update(status:completed)` 同样在写状态前执行完成检查，避免通过该工具绕开检查。
- Hook payload 补充 `hook_event_name`、`agent_id`、`session_id`、`task_id`、`task_subject`、`task_description`、`cwd`、`permission_mode` 等字段，保留旧 camelCase 字段。

质量检查必须同步配置；本实现拒绝将上述完成检查配置为 async，避免启动检查后立刻声称成功。不要把只用于异步通知的脚本误配为验收门禁。

### 多 Agent 并发不能跳过质量检查

- Hook 递归检测从进程全局集合改为按异步调用链隔离。两个队友同时运行同一个 Hook 时都会检查，而不会将第二个当成递归直接跳过。
- `once` 缓存按工作目录、会话、Agent 与 Hook 身份区分，不让某个队友的成功检查替另一个队友免检。它仍是进程内缓存，不是跨重启的持久化执行凭证。
- 任务 claim 和 update 共享同一个跨进程锁，减少并发更新结果、owner 等字段时的丢失写入；在构造锁路径前校验任务 ID。

## Teams 操作

```text
/team members
/team plans
/plan show plan_<id>
/plan approve plan_<id> --background
/plan changes plan_<id> 请补充回滚方案
```

`/team` 面板增加 Plans 标签；`/team plans` 只显示本团队成员提交的计划，不发送模型请求。

审批当前团队其他成员的 Plan 时，自动后台执行，主 Agent 身份和主对话不切换。显式 `--background` 也可保留当前对话。通过 `/tasks` 检查执行状态，通过 `/resume` 或 `/agents` 显式连接需要查看的成员。

这仍然是人工审批：队友消息、广播和收件箱中的“已批准”不是人工授权，不能批准 Plan、授予工具或放宽企业策略。

## 中断后的检查和继续

```text
/plan recover plan_<id>
/plan show plan_<id>
/plan execute plan_<id> --background
```

命令行也可以使用：

```powershell
ccpt plan recover plan_<id>
ccpt plan execute plan_<id> --foreground
```

IDE bridge 增加 `plan/recover`，沿用 `plan/list`、`plan/show`、`plan/execute`。

recover 只检查状态：活跃 worker 保持运行；已有终态按现有 Agent 状态收敛；未完成启动或等待输入的执行变成可检查的阻塞状态。它不启动模型、不重放工具、不自动创建 worker。继续前应检查原会话和外部操作是否已经完成。

## 配置示例

在现有 settings 保留模型、URL、认证和 CA 配置，增加项目自己的同步验证脚本即可：

```json
{
  "hooks": [
    {
      "event": "TaskCompleted",
      "type": "command",
      "command": "node tools/verify-completion.cjs",
      "timeoutMs": 60000
    }
  ]
}
```

验证脚本从 stdin 读取 JSON；通过返回 0，未通过将反馈写入 stderr 并返回 2。脚本来自可信团队配置，需要通过原有命令/网络/环境权限检查；restricted 模式不会因此获得执行脚本的权限。不要让模型自己提交一个“测试已通过”的数字就视为可信验证结果。

## 验证与明确边界

- 新增 `test/plan-quality-gates.test.ts`：并发预约、真实分离 worker、质量反馈、持续失败、停止、恢复原会话、任务工具门禁、并发 Hook、任务丢失写入和只读恢复检查。
- 扩展 `test/hooks.test.ts`：验证器拒绝和无有效结论的边界。
- 扩展 `test/terminal-team-skills-050.test.ts`：实际 CLI/原始按键的队友提交 → 团队计划列表 → 人工批准 → 后台执行 → 主对话继续，验证主上下文和执行身份。
- 验证使用隔离用户状态与本机模型 fixture，没有调用公司接口，没有修改个人 settings/API Key/CA。
- 本轮最终全量证据目录：`.ccpt/plan-teams-quality-final-20261016/`；首轮 453 项通过的记录在 `.ccpt/plan-teams-quality-20261016/`。最终数字以最终目录中的报告为准。

最终全量结果：**455 通过 / 0 失败**，耗时约 180 秒。TypeScript 检查、394 模块构建、打包后的 Node CLI 冒烟和 npm dry-run 均通过。试打包为 72 个条目、约 1.75 MB；没有生成/发布新的 npm 包，也没有执行全局安装。

`bun scripts/verify-packaged-plan-quality.ts` 可复跑打包入口的本机冒烟：验证审批零请求、分离 Node worker、退出码 2 的反馈回合、关联任务/Plan 完成、recover 零重放；报告为最终证据目录中的 `packaged-cli-smoke.json`。

仍不声称完成：真实断电与损坏磁盘恢复、跨多个状态文件的原子事务、外部副作用 exactly-once、所有 Hook payload/退出码与参照实现完全一致、独立辅助模块中全部质量指标的可信采集和强制执行。底层 SDK 状态写入函数属于可信内部 API，不应直接作为不可信远程授权接口。

本实现选择检查失败时保留会话并阻塞，不会在重试次数耗尽后强行视为完成。其他事件的退出码兼容、匹配器、跨进程 once 等仍需继续逐项验收。

企业 OS 隔离/逃逸、真实公司 CA/代理/mTLS/Entra、MCP/OAuth 企业矩阵、第三方重分发授权、精确 tokenizer/1M 基准、完整 IDE/远程开发仍是独立未完成项，不能由本机测试替代。

## 更新本地 CLI

```powershell
cd C:\Users\55038\CCPT
npm run build
npm install -g .
cd D:\your-project
ccpt --resume
```

本轮不自动全局安装、不发布 npm、不 push、不创建 PR。
