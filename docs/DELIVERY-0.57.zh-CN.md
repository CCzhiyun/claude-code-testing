# CCPT 0.57：剩余项继续落地

本轮把自动化、Plan/Teams、Skills/Hooks 的剩余工作拆为 12 个可核对工程子项，完成其中 6 个实现。具体定义和仍未完成项见 [REMAINING-0.57.zh-CN.md](REMAINING-0.57.zh-CN.md)；不是声称整个平台完成比例达到 50%。

## 安装

需要 Node.js 20+，无 EXE，安装本地候选包：

```powershell
npm install -g .\ccpt-0.57.0.tgz
ccpt --version
cd C:\your-project
ccpt
```

个人模型 URL、API Key、协议、CA 仍在 `%USERPROFILE%\.ccpt\settings.json` / 环境变量；交付目录包含三协议模板。本轮没有修改真实全局安装/个人配置，没有注册或删除系统任务，没有公司模型请求、Git push/PR 或 npm 发布。包不嵌入公司 CA、密钥或个人状态。

## 1. 定时任务状态、升级和卸载

```text
ccpt automation list
ccpt automation status <scheduler-id>
ccpt automation rebind <scheduler-id> --expected-digest <status返回摘要> --confirm
ccpt automation install <replacement.id> --confirm
ccpt automation status <旧scheduler-id>
ccpt automation uninstall <旧scheduler-id> --expected-digest <旧任务当前摘要> --confirm
```

- list/status 读取当前用户拥有的本地定义，不执行模型或任务。状态文件/大小/目录链接有校验；损坏项显示 invalid，不擅自修复或执行。清单最多 256 项。
- status 在 Windows 查询指定 OS 任务，并核对动作/主体；不可用显示 `unverified-or-unavailable`，不能当作任务不存在。`owned-action-verified` 仅证明核对时动作/主体匹配，不保证已启用、下次一定启动或已完成实际运行验收。
- rebind 检查当前摘要，准备当前 Node/CLI 安装路径的新 ID，然后停用旧本地定义。不会覆盖旧 OS 定义、自动注册替代任务或删除历史。新 ID 必须单独 install；旧定义需要明确 uninstall。新的本地定义准备失败不会先停用旧任务；中断期间应先 list/status 检查，不盲目重复。
- uninstall 需要当前摘要与确认。先持久停用本地投递，再读取指定 OS 任务 XML，核对 Command、Arguments、工作目录、当前用户/可信 SID、登录/权限级别及没有额外动作，才删除精确任务名。拒绝 DTD、外部主体、多 Exec 或其他动作；不使用通配符，不提升权限。
- 查询/删除失败时保留停用状态，不伪报删除成功；重试前 status 获取新摘要。只删除 OS 定义，保留本地 job/结果/管理记录，不删除会话或程序。

此前的 prepare、tick、disable 和 opt-in 检查点恢复保留。调度仍只投递上下文，不会自动执行付费 Agent 或重放外部动作。真实 Windows 注册/卸载矩阵未在本轮运行；Linux/macOS 注册器仍缺。

## 2. 持久通知中心

```text
ccpt notifications list --limit 50
ccpt notifications list --unread
ccpt notifications list --offset 50 --limit 50
ccpt notifications read <notification-id> --expected-version <list返回version> --confirm
```

TUI：

```text
/notifications
/notifications 100
/notifications read <notification-id> <当前version>
```

打开面板只读。新通知到达时，空闲面板自动刷新并按 ID 保持选择；详情提供显式已读命令。Node 的裸 Esc 需要等待终端转义序列解析后才关闭面板。

VS Code 新增 Notifications 视图、纯文本详情、单条 Mark Read、Older Notifications 和刷新入口。预览不标已读；过期版本提示刷新，不自动重试。通知文案不会作为 HTML 渲染，也不送给模型。

存储在项目 `.ccpt/notifications.json`，最多 500 条/8 MB，每页最多 100 条；合法旧记录可读取，未知字段不返回接口。并发写入使用锁；内部 sourceKey 支持保留窗口内去重。已读是整个当前集合版本的 CAS 操作，只处理明确选中的 1–100 个 ID，不批量误标新到通知；绝不构成人工审批或工具授权。

显式 `push_notification` 使用同一存储并保留 Notification Hook。Agent 完成、失败、取消、等待输入生成只含 ID/状态的简短通知，不复制目标、结果、隐藏思考、错误堆栈；无持久化模式不新增这些自动状态通知。重复保存相同状态不重复通知。通知写失败不能推翻已持久化的 Agent 结果；这不是跨 Agent/通知两份文件的原子事务或永不丢失审计。

通知可以包含显式工具提供的私密正文，按公司本地数据保留策略管理；这是有限通知中心，不是完整聊天/运行时事件存档或无限历史。

## 3. Team / 邮箱补发范围

Team 清理、邮箱消费读回执、shutdown 确认、成员 role/parent/team/task/plan 绑定变更，接入持久元数据失效事件。跨工作区队友收信时双方工作区收到 inbox 失效；事件内不带邮件内容。

依旧是“请刷新当前状态”的意图，不是业务提交证明或授权。看邮箱不标已读的既有路径不变。没有声称所有运行时细节生产者或聊天流均支持补发。

## 4. API 失败 Hook

真实 Agent 的最终结构化提供方错误触发 StopFailure，支持 error 类型 matcher。payload 提供脱敏 `error_details`、`last_assistant_message` 及会话/Agent ID；本地预算、取消、普通工具错误不冒充 API 错误。

失败 Hook 的输出、阻止决定和退出码不能覆盖原错误或请求重试；一个观察者失败会记审计，继续其他观察者。仍遵守 restricted/sandbox、进程允许列表等安全策略，不因“通知型”事件绕过策略。模型适配器没有归类为结构化提供方错误的未知网络故障仍需补强。

## 5. Stop / SubagentStop 的补充反馈

成功返回 `hookSpecificOutput.additionalContext` 时，反馈进入原会话，继续下一轮，而不是被丢弃或立即接受完成。与原有阻止反馈共用 `stop_hook_active` 和连续 8 次上限，受 maxTurns/预算/权限约束；触顶等待人工输入，原会话保留。

Stop、SubagentStop 等完成门禁拒绝 async 模式，防止异步结果被误认为同步检查通过。本轮不提供 Hook 对工具/权限的隐式提权。

## 6. 全局授权变更监听

开启 `/reload-skills --watch` 或 `/reload-plugins --watch` 后，用户级 `extension-trust.json` 也进入监听；批准/撤销会使注册表等待安全空闲重新校验。撤销的根若仍留在 settings，重载明确失败，worker 下一次加载也拒绝；需要从 settings 删除或重新审阅批准，不静默恢复权限。撤销不会强行终止已经运行的第三方程序。

## 验证

- `test/foundation-057.test.ts`：18 项新增定向测试。
- `scripts/verify-platform-057.ts`：构建后的实际 Node CLI + TUI 原始按键；调度只准备/重绑，未改 OS 任务。
- `scripts/verify-extension-057.mjs`：实际 extension activate/provider/command 处理器 + stub VS Code host + 已构建 SDK；不是实际 VS Code Remote。
- 继续运行全量回归、实际 npm archive 离线安装、类型消费者、Hook 子进程、bridge 重连和旧终端监听测试。最终数量以随包 evidence 为准。

参考：[官方 Hooks 文档](https://code.claude.com/docs/en/hooks)、[Microsoft schtasks query](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/schtasks-query)、[Microsoft schtasks delete](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/schtasks-delete)。仅核对指定接口，不宣称全部参照语义或 OS 环境认证。

候选包与校验摘要不是许可授权。来源/第三方权利/NOTICE/重分发审核未完成，发布门禁仍保持关闭。
