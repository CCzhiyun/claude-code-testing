# CCPT 0.58：受限调度 Agent 和跨平台调度

继续保留 0.57 的通知中心、Team 补发、Hook、授权监听和任务管理。新增两条链路；不能据此声称之前所有缺口已关闭。当前状态见 [全部剩余清单](REMAINING-0.58.zh-CN.md)。

## 安装与配置

```powershell
npm install -g .\ccpt-0.58.0.tgz
ccpt --version
cd C:\your-project
ccpt
```

需要 Node.js 20+，无 EXE。公司模型/CA/代理等沿用 `%USERPROFILE%\.ccpt\settings.json`（其他 OS 为用户目录下 `.ccpt/settings.json`）和环境变量。三协议模板在交付目录 config-templates；不要混用请求协议和 URL。

此次未改真实全局安装、个人 settings、公司凭据，未创建/删除 OS 定时任务、调用公司模型、Git push/PR 或发布 npm。所有模型验证都只访问 loopback 测试服务；候选包不携带公司证书、密钥或个人状态。

## 显式只读调度 Agent

默认 `automation prepare` 仍只投递上下文，不执行模型。只有以下明确选择才允许后续 tick 使用配置的付费模型：

```text
ccpt automation prepare --agent-mode read-only --max-requests 6 --max-tokens 300000 --max-runs 3 --minutes 5
ccpt automation install <返回id> --confirm
ccpt automation runs <id>
ccpt automation status <id>
```

手动 `automation tick <id>` 也会按该任务的显式模式执行，可能产生费用；不要对未知任务盲目运行。必须先信任工作区、配置好模型并检查预算。`max-requests` 与 `max-tokens` 不提供隐式默认，`max-runs` 默认 3；合法范围分别为 1–100、1024–10000000、1–20。

该模式只消费已经安排、属于当前工作区且到期的 wakeup，**不因时间到了就自行编造任务或将 active Goal 判为完成**。一次 tick 最多产生一个分析报告。不要同时为同一工作区安排多个不同模式的投递任务：它们共享现有 wakeup 队列，先投递者会消费该上下文，没有实现按 job 分区的唤醒协议。

### 执行边界

- 只开放 `read_file`、`list_files`、`search_text`；模式为 restricted，根限定为当前工作区。Shell、写文件、Git、MCP、插件/Skills 可执行扩展、用户 Hooks、LSP 和递归 Agent 都不开放。
- 普通用户 Hooks 在该模式不加载；管理员托管配置若强制能力与此冲突，则拒绝执行，而不是静默绕过企业要求。worker 启动时再次校验能力上限和当前模型部署绑定。
- 每个报告最多 3 轮，网络单次时限至多 20 秒，90 秒发出取消；OS 定义另有限时。取消是尽力中止，不声称撤销已被服务端计费的请求。
- 模型部署身份绑定在任务内；URL/协议/模型等变更后拒绝静默改用新部署，需重新审查准备任务。凭据值不写入任务参数或预算 scope。
- 请求和 token 账本以 job 为 scope 跨唤醒/独立报告保留。请求次数是持久预约上限；token 按配置窗口/输出上限保守预约，报告用量再核对，不是真实 tokenizer 或精确金额保证。未报告用量和不确定失败不自动退还预约；可选金额预算仍要求真实模型价格。
- 状态在启动前先写 claimed；异常中断的 claimed/started 不自动重放。`automation runs` 提供 Agent/reportSession ID、状态和预算计数，不含原提示正文。不是外部副作用核验/幂等重试中心。
- 原会话只接收原有去重的唤醒上下文，报告写在独立会话，不替换、结束或覆盖原对话。该报告使用有界原摘要和唤醒内容，不是完整原对话的无损继承。

这是无人值守**只读分析**，不是完整的自动修改代码、运行测试、提交、推送或发布引擎。读取权限仍可能让模型看到获准工作区内的数据；这是工具能力限制，不是 OS 级秘密隔离沙箱。

## Linux / macOS 当前用户调度

在目标 OS 上运行相同的 prepare/install/status/uninstall 命令，定义绑定创建时的 OS，不能把 Windows job 直接拿去 Linux 注册。

| OS | 定义和行为 |
| --- | --- |
| Windows | 当前用户 Task Scheduler，原有动作/主体校验继续保留 |
| Linux | `~/.config/systemd/user/ccpt-<id>.service/.timer`；用户 oneshot、启动延迟和周期、NoNewPrivileges/私有 umask；不调用 shell、不设置 root/system 服务 |
| macOS | `~/Library/LaunchAgents/ccpt-<id>.plist`；显式参数数组、当前用户 GUI domain、StartInterval，KeepAlive 为 false；不提升权限 |

prepare 只把定义写入本地 job 目录，install 才向用户管理目录独占创建文件和调用管理器。目录链接、目标已存在、错误 OS、root 运行都会拒绝，不使用 force 覆盖他人定义。

Linux 参数的 `%`、`$`、引号有单元语法转义；macOS 使用 plist XML 编码，不拼接 Shell 命令。安装中断留下 receipt/files，**不自动重试或删除来源不确定的文件**。重复安装遇到既有/中断收据会要求检查；未提供通用一键原子恢复。

卸载先停用本地 job；核对实际文件的原字节和管理器所报定义来源后停止/移除精确任务并移除已核对定义。本地会话/job/结果收据保留。缺文件、变更文件或来源无法核验时拒绝自动清理，不因名字相同就认领任务。

调度服务不保证继承交互 Shell 的 API Key 环境。需要公司认可的用户凭据/配置方式；不把秘密塞进 ExecStart、plist 参数或系统任务 XML。Linux 用户管理器、macOS GUI 登录、企业策略和路径升级仍需真机验收。

本次仅验证生成器、边界和 Windows 上真实 Node tick；未在 Linux/macOS 注册服务，也未宣称其所有版本/发行版组合已验收。`/usr/bin/systemctl`、`/bin/launchctl` 等标准路径不适配某些特殊发行环境时会明确失败。

## 验证入口

- `test/automation-058.test.ts`：14 项，包括真正读取文件/工具结果回传、非法 Shell 工具拒绝、跨唤醒预算、token 预约不足、运行次数上限、未知 claim、模型部署变更、跨平台定义转义。
- `scripts/verify-automation-058.ts`：构建后的真实 Node CLI；显式准备只读任务、工具 roundtrip、第二次唤醒仍受原预算约束。
- 继续运行全量回归、0.57 终端/扩展处理器、0.56 Hook/bridge、实际 npm 包离线安装和包内类型消费者。最终数量和报告在随包 evidence。

实现核对：[systemd service](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html)、[timer](https://www.freedesktop.org/software/systemd/man/latest/systemd.timer.html)、[unit syntax](https://www.freedesktop.org/software/systemd/man/latest/systemd.syntax.html)、[Apple Launch Agents](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html)。这些资料不是本项目真机认证。

来源、第三方许可、NOTICE 和重分发批准仍未完成；本地候选包不等于获准分发，UNLICENSED 不授予第三方权利。
