# CCPT 0.56：自动化、Plan/Teams、Skills/Hooks

本轮范围按用户确认的详细章节第一至第三项。实现了以下链路，但不将未实现的子项或目标环境验收标成完成。

## 安装与启动

Node.js 20+，不需要 EXE：

```powershell
npm install -g .\ccpt-0.56.0.tgz
ccpt --version
cd C:\your-project
ccpt
```

模型、API Key、三协议和公司 CA 继续使用 `%USERPROFILE%\.ccpt\settings.json` 与原有环境变量。交付目录的 `config-templates` 是三种独立协议模板，不能只换 URL 而不换协议。本轮不修改个人配置、不发送公司模型请求、不把证书/密钥放进包。

## 1. Windows 定时启动与恢复

在已经显式信任的项目目录运行：

```text
ccpt automation prepare --minutes 5
ccpt automation install <返回的scheduler-id> --confirm
ccpt automation tick <scheduler-id>
ccpt automation disable <scheduler-id> --confirm
```

`prepare` 只写当前用户状态目录内的 job/Task Scheduler XML，不注册任务。`install` 才显式注册当前用户、非管理员、仅用户登录时的 Windows 任务；不保存密码、不使用 SYSTEM、不覆盖同名任务。周期为 1–1440 分钟。Node/CLI 安装路径改变后需要重新准备任务，不能假设旧定义自动升级。

tick 使用任务锁和 Agent 启动锁，忙碌/等待审批的会话先跳过。它将到期唤醒上下文持久投递到原会话，继续使用原有去重标记；不结束当前会话，不自动调用模型、Hooks、Shell、Git 或其他工具。后续由原会话恢复/继续执行。**这不是无人值守付费 Agent 的 OS 守护进程。**

需要无人值守的损坏状态恢复时，必须在准备时显式选择：

```text
ccpt automation prepare --minutes 5 --repair-corrupt
```

恢复仅使用校验通过的本地检查点，确认摘要在实际修改前再次检查；保留损坏原始字节，将待执行工作暂停/取消，不自动重放外部动作。没有有效检查点则失败，不伪造空白状态。`last-result.json` 在当前用户状态目录 `schedulers/<id>` 中。

`disable` 让持久定义失效，未来 tick 不工作；Windows 任务定义仍保留，可在任务计划程序中人工删除。本次验证没有注册实际 OS 任务。Linux/macOS 注册器、外部副作用核验后的自动重试尚未实现。

## 2. Plan/Teams 与 IDE 断线补发

项目内新增 `.ccpt/ide-events.json` 元数据日志。Plan、Team 创建、Agent 状态、团队任务、邮箱变更写入刷新意图，IDE bridge 提供 `project/events` 分页游标。扩展保存游标，断线重连和新 bridge 实例按游标补发；过旧/异代游标要求完整刷新。

日志只有递增序号、topic、时间，不含聊天正文、Plan 内容或密钥。它记录的是**刷新意图，不是事务提交证明**，允许后续业务写入失败；消费者必须读取当前真实状态。补发从不构成授权，绝不自动重发聊天、工具、人工审批。原来的版本化审批和过期拒绝继续生效。

日志最多保留 1024 条，每页最多 200 条；文件损坏/有界限制会报错，不能当作无限历史或防篡改审计。部分未接入专用 producer 的变化仍依赖现有工作区监听/重连快照。不是完整的聊天流和系统通知时间线。

本轮实际构建后的 Node bridge 进程测试：断线时新增两个 Plan，重连补发；销毁实例后恢复游标，不重发已确认 Plan 事件。真实 VS Code Remote、多窗口、多根、升级及通知 UI 矩阵仍需目标环境验收。

## 3. 全局 Skills/Agents/Plugins 与 Hook 触发点

项目内路径仍局限在受信任工作区。工作区外的全局扩展必须由用户显式批准，只有用户级 settings 可以选用；项目配置不能借全局批准越界。

```text
ccpt extensions trust C:\team\skills --kind skill --confirm
ccpt extensions trust C:\team\agents --kind agent --confirm
ccpt extensions trust C:\team\plugins --kind plugin --confirm
ccpt extensions list
```

随后在用户 settings 中选择相应目录，例如（片段，保留已有模型配置）：

```json
{
  "skillsDirectories": ["C:\\team\\skills"],
  "agentsDirectories": ["C:\\team\\agents"],
  "pluginDirectories": ["C:\\team\\plugins"]
}
```

批准绑定目录类型与真实路径，根/入口文件拒绝符号链接。撤销：

```text
ccpt extensions untrust C:\team\skills --kind skill --confirm
```

撤销后应同时从 settings 删除该路径；否则后续加载明确失败，不静默恢复旧授权。worker 配置快照同样重新校验全局目录批准。撤销不等于终止已运行的第三方进程，目录信任不等于 OS 沙箱。

TUI 使用已有 `/reload-skills --watch`、`/reload-plugins --watch`；打开监听后新增已批准根也纳入配置重订阅，忙碌/弹窗期间延后至安全空闲刷新。不是任意插件的无停顿热替换。

实际 Agent 链路新增/贯通：`UserPromptSubmit`、激活 Skill 的 `UserPromptExpansion`、仓库上下文 `InstructionsLoaded`、完成前 `Stop`、完成后的 `SessionEnd`。自动阈值压缩、提供方超限恢复和手动压缩运行 `PreCompact`/`PostCompact`；TUI 模型选择和直接 `/model` 运行 `PreModelSwitch`/`PostModelSwitch`。

Hook payload 补常见别名：`tool_name`、`tool_input`、`tool_response`、`session_id`、`agent_id`，matcher 支持 `tool_name`。UserPromptSubmit 拒绝时，在模型调用前等待人工输入；完成后的 SessionEnd 失败记录审计，不把已完成工作回滚成未完成。事件具体字段/返回决策/退出码还没有全部参照兼容，`hooks matrix` 仍标未认证。

## 验证与交付边界

新增 `test/foundation-056.test.ts` 覆盖调度并发去重、忙会话跳过、损坏恢复、XML 参数边界、20 并发事件生产者、游标重置、全局批准/撤销和实际 Agent Hook 拦截。`scripts/verify-foundation-056.ts` 检查构建后的 Node CLI 与真实 bridge 子进程重连。最终数量和实际 npm 包安装结果以随包 evidence 报告为准。

本地候选包不是发布授权。第三方来源、许可、NOTICE 和重分发审批仍必须单独完成；`UNLICENSED` 不提供第三方许可。当前剩余项见 [REMAINING-0.56.zh-CN.md](REMAINING-0.56.zh-CN.md)。

设计核对来源：[官方 Hook 文档](https://code.claude.com/docs/en/hooks)、[Windows schtasks/create](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/schtasks-create)。借鉴事件/调度接口，不宣称逐事件兼容认证或真实 OS 验收。
