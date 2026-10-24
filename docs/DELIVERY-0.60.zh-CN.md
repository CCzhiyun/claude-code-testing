# CCPT 0.60：原编号 A1–H4 补强

本版沿用用户给出的 A1–H4 编号，不再重新拆分计算完成率。原编号对照见 [验收与剩余](REMAINING-0.60.zh-CN.md)。目标 OS/IDE/公司网络和第三方授权必须另外验收；本地测试不替代这些证据。

## 安装

```powershell
npm install -g .\ccpt-0.60.0.tgz
ccpt --version
cd C:\your-project
ccpt
```

Node.js 20+，无 EXE。保持原 `%USERPROFILE%\.ccpt\settings.json`、模型协议、CA、代理和凭据配置；本轮没有修改真实个人设置或全局安装、注册 OS 任务、调用公司模型、发布 npm、push 或创建 PR。包是本地所有者验证候选，不是已取得来源许可的团队重分发授权。

## A1：明确批准后启动后台 Coding Goal

先准备当前工作区内、绑定原会话且已经批准的 Plan，以及 active Goal。原会话必须空闲；若已有 Agent，Plan 必须属于该原 Agent。不是直接把任意外部提示变成自动执行授权。

```text
ccpt goal-run prepare --goal-id <goal_id> --plan-id <plan_id> --expected-plan-version <N> --tools read_file,write_file,edit_file,run_command,git_commit --max-requests 12 --max-tokens 500000 --max-attempts 3 --confirm
ccpt goal-run show <goalrun_id>
ccpt goal-run start <goalrun_id> --expected-version 1 --confirm
```

默认另起后台 worker，当前终端立即返回；`--foreground` 等待该 worker 结果。模型可按批准 Plan 编码、运行测试、在策略允许且工具明确列出时提交；不隐式授权 push/PR，不自动放开沙箱/网络/审批。原会话与归档仍保留，模型当前请求继续服从上下文预算/压缩，不能理解为一次装入全部历史或零信息损失。

运行有 CAS 版本和 ready/running/waiting/completed/failed/unknown/cancelled 状态；累计请求/token 预算和尝试次数跨人工续行保留，子 Agent 继承能力和同一预算范围。工作流绑定模型部署、策略、Plan 内容和原会话；变更后拒绝静默换部署或扩大权限。

```text
ccpt goal-run resume <goalrun_id> --expected-version <N> --approve-request <准确pendingRequestId> --confirm
ccpt goal-run start <goalrun_id> --expected-version <resume返回版本> --confirm
ccpt goal-run resume <goalrun_id> --expected-version <N> --feedback "人工补充说明" --confirm
ccpt goal-run recover <goalrun_id> --expected-version <N>
ccpt goal-run cancel <goalrun_id> --expected-version <N> --confirm
```

resume 只改为 ready，不隐式付费启动；start 才执行。准确权限请求只批准一次，其余规则不变。failed/unknown 必须核实外部副作用后加 `--verified-unknown` 才可准备继续；不自动重放未知 claim，不重置预算或退款。recover 只核对匹配的原执行 Agent；没有可信 owner 就保留 unknown，不把死亡 PID 当作重试授权。

completed 表示该 Agent 正常结束且经过现有质量门禁；不是独立证明业务需求/所有测试都正确。Goal 状态暂停会在工作流下一模型/工具边界阻止继续；不强行撤回已发送到服务器的操作。需要停 Agent 使用显式取消。

## A2：安全重试与连接器恢复

真实 Agent 的 git_commit/git_push/create_draft_pr/mcp_call 先写入绑定会话+工具调用 ID 的收据，再执行外部动作。记录 input/result 哈希而不是原始参数/结果；重复、换参数、未知结果一律拒绝直接重放。仅人工核实为 not_applied 后允许该 ID 再试。该保护不能识别换一个工具调用 ID 表达的相同业务动作，业务侧仍应维护业务幂等键。

```text
ccpt operations list
ccpt operations show <operation_id>
ccpt operations query <operation_id>
ccpt operations resolve <operation_id> --status not_applied --reason "已在外部系统核验未执行" --expected-version <N> --confirm
ccpt operations compensate <operation_id> --reason "人工批准补偿" --expected-version <N> --confirm
```

MCP 管理员可在**现有服务器配置**增加每个工具的恢复协议，服务器必须实际实现相应字段/工具：

```json
{
  "mcpServers": {
    "billing": {
      "transport": "stdio",
      "command": "your-reviewed-mcp-server",
      "operationRecovery": {
        "charge": {
          "idempotencyArgument": "request_id",
          "statusTool": "charge_status",
          "compensateTool": "refund_charge",
          "operationArgument": "operation_id"
        }
      }
    }
  }
}
```

主调用注入固定 operation_id，查询/补偿传给配置字段，仍受当前限制/deny/网络策略。服务器配置与恢复协议摘要绑定旧收据；变更后拒绝对新目标查询/补偿，需人工核实原系统。SDK 可显式注册可信的专用连接器。配置不是把任意工具自动变成幂等；没有服务器支持不生成虚假保证。

Git 仅对有 commit 收据、干净工作树、准确原 HEAD、非 merge commit 执行新 `git revert --no-edit`；不 reset、不 force-push、不猜测 PR 删除。补偿也先写状态；失败保留 compensation_unknown，不能重复补偿或自动退款。没有连接器的 push/PR 状态需人工外部核验。

## A3/A4：native 调度中断恢复

systemd/launchd 新安装使用随机 nonce 标记定义并先写收据。显式恢复检查目标当前用户、收据路径、精确定义字节和 manager origin；仅删除属于该 nonce 的定义，先禁用本地 job，再停止/删除系统注册。旧无 nonce 或来源不确定文件保留，不自动认领。

```text
ccpt automation recover <scheduler_id>
ccpt automation recover <scheduler_id> --expected-digest <预览摘要> --confirm
```

仅在相应非 root Linux/macOS 主机执行。预览不是注册/安装。恢复不重放付费模型，保留本地状态；随后需要明确重新 prepare/install。manager 缺失、企业策略或来源不符会拒绝/保留现场。没有跨 OS 与本地文件的原子事务保证。

## P3：可控正文恢复

默认不保存运行正文。明确开启：

```json
{ "runtimeHistory": { "mode": "redacted", "maxTextChars": 16000 } }
```

只影响之后执行；不从旧元数据重建丢失正文。保存允许的 assistant_message/tool_started/tool_completed/input_required 文本，先脱敏再持久化；不记录 thinking delta 或 provider continuation payload。最多 512 项且约 7 MiB；逐项 1–64000 字符，淘汰会返回 reset，写入错误可查询。不是无损事务 outbox、防篡改集中审计或任意秘密识别器；工具正文仍可能包含未知私有信息，敏感工作区应保持 metadata。

```text
ccpt sessions preview <session_id> --include-text --text-limit 16000 --limit 50
ccpt sessions activity <session_id> --include-text --limit 100
```

显式 include-text 才返回正文；工作区、路径、分页/游标检查不变，原会话不裁剪。代码块换行保留。IDE Sessions 面板恢复原对话，并有 Saved activity 按钮显式查看已保留的运行记录，使用 textContent 而非 HTML。阅读不执行模型/工具、不批准 Plan，续行仍须明确 Send。

## H1/H3/H4：运行边界

- H1：仅在实际模型凭据/传输边界分类 authentication_failed/network_error/tls_error/timeout/invalid_response；取消不当作 StopFailure，任意工具错误文字不触发模型故障 Hook。
- H3：用户/项目/managed 配置与扩展授权字节变更后，活动 Agent 在下一模型/工具动作前进入 waiting_for_input，保留会话，需审查后用新 worker 继续。不会强杀已经开始的插件/外部进程，也不是跨进程强实时撤权。
- H4：MessageDisplay 只修改表面文字，不能修改原模型/会话结果或阻断执行；失败回退原文。当前完整消息批次，不是交互逐行批次。change_directory 工具限定已有授权根，仅更改本 Agent cwd 并发 CwdChanged，不改进程全局目录。FileChanged 显式 filename matcher 支持外部写入 add/change/unlink，有 64 文件/每文件每分钟 10 事件边界，不读取内容、不跟链接；TUI 空闲监听，Agent 执行期监听。已有内置写入事件继续保留，可能重复，不保证 exactly-once。DirectoryAdded 来源为 slash_command。

参考 Hook 的展示/事实数据分离设计见 [官方 Hook 说明](https://code.claude.com/docs/en/hooks)。本版未宣称全部事件逐字段/退出码、动态 watchPaths、插件任意零停顿热替换兼容。

## 验证与发布限制

测试使用临时 home/工作区、loopback 模型、真实本地 Git/MCP 子进程和实际构建产物；不动真实设置/公司服务。精确通过数、构建与离线 npm/SDK/IDE smoke 见候选目录 evidence 和 VALIDATION。没有证据的真实 OS/IDE/公司/长期断电项目保持未验收。真实来源许可/NOTICE/重分发批准仍阻断正式发布。
