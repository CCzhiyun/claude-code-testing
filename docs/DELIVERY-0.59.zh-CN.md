# CCPT 0.59：恢复可见性、调度隔离与真实 Hook 触发

## 本轮范围

从上一版剩余项拆出 12 个可独立验收的工程子项，前 8 项已接入实际调用路径，后 4 项未完成。8/12 只表示这个明确范围，不表示整个平台、所有历史要求或企业生产验收完成率。

| 子项 | 本轮结果 |
| --- | --- |
| 1 job 绑定的唤醒队列 | schedule/bind 校验 job 与会话工作区，绑定不可改；付费 reader 只消费自己队列；前台不偷取消费 job 队列 |
| 2 Goal 状态转换 | active/paused/blocked/completed/cancelled；CAS 版本；暂停/阻塞需原因；终态不可重开；TUI/CLI/IDE/SDK 入口 |
| 3 隐私可控聊天历史 | 默认无正文；显式正文预览、分页、版本游标、工作区验证；不返回隐藏推理/提供方状态/工具原始数据/图片字节 |
| 4 持久运行元数据补发 | worker 实际写入；每会话保留 512 项、单调序号、分页游标及缺口 reset；不保存流式文字、推理、工具输入输出或堆栈 |
| 5 IDE 历史恢复 | Sessions 单击只预览；旧页/刷新/重开面板可恢复；恢复不执行，下一次明确发送才继续原会话及原 Agent 能力上限 |
| 6 DirectoryAdded 自动触发 | 真实 /add-dir，验证已存在目录，重复加入不重复发；已完成的配置变更不被事后观察器撤销 |
| 7 FileChanged 自动触发 | write_file、notebook_edit、exact-edit helper、checkpoint restore；created/modified/deleted；观察失败不伪装写入失败 |
| 8 懒加载 InstructionsLoaded | Agent 访问匹配文件、首次注入 scoped rule 时触发；rule_ids/source/file/session；同一会话已加载规则不重复发 |
| 9 调度安装完整中断恢复 | 未完成，仍 fail closed 保留收据，不自动认领或删除来源不确定定义 |
| 10 跨插件原子事务 | 未完成，单插件 journal/签名校验不等于跨插件与 Marketplace 收据原子提交 |
| 11 MCP 独立 GET/POST 续传 | 未完成，不能把已有请求所属 POST/SSE 人工交互当成完整实现 |
| 12 macOS/Linux 专用凭据与独立凭据进程 | 未完成，Windows DPAPI 路径保留，未虚构跨 OS 验收 |

## 安装与保持原配置

```powershell
npm install -g .\ccpt-0.59.0.tgz
ccpt --version
cd C:\your-project
ccpt
```

需要 Node.js 20+，无 EXE。本轮没有改个人 settings、模型 URL/Key 或 CA、真实全局安装，没有注册 OS 任务、请求公司模型或发布 npm。公司协议/CA 配置仍在 `%USERPROFILE%\.ccpt\settings.json` 与环境变量。候选包不嵌公司秘密或证书；已有公开 CA 编译选项保持不变。

## 有意收紧：付费调度必须绑定唤醒

旧版本付费 reader 会竞争工作区未绑定队列；现在不会自动消费旧 wakeup。准备任务与真实 OS 注册仍分开：

```text
ccpt automation prepare --agent-mode read-only --max-requests 6 --max-tokens 300000 --max-runs 3
ccpt wakeups schedule <session_id> --job <scheduler_id> --at <未来ISO时间> --prompt "只读检查并报告"
ccpt wakeups bind <旧wakeup_id> <scheduler_id> --confirm
ccpt automation runs <scheduler_id>
```

只选择 schedule 或 bind 其一。bind 是显式迁移，绑定之后不能改到别的任务。需要改绑时取消旧 wakeup，检查旧任务是否有未知运行，再明确创建新 wakeup。rebind 调度器创建新 ID 后，旧队列不会静默转移，也不会隐式扩大预算。不能借新 ID 绕过组织费用审批。

未绑定 wakeup 保持普通前台/上下文投递语义，不授权付费模型或工具。只读预算、能力上限、未知 claim 不重放沿用 0.58。Goal 暂停只暂停目标注入，不是强行撤销已运行的 Agent/服务端请求；要停止 Agent 需显式取消。恢复 Goal 不会自动调用模型、执行任务或视为审批。

## Goal 与历史命令

```text
/goal pause 等待人工评审
/goal block 外部依赖尚未就绪
/goal resume
/goal complete
ccpt goals list <session_id>
ccpt goals decide <session_id> <goal_id> --status paused --expected-version 1 --reason "等待评审"
ccpt sessions preview <session_id> --include-text --limit 50
ccpt sessions activity <session_id> --limit 100
```

preview 默认不带正文，--include-text 才显示脱敏预览。每条正文至多 2000 字符、每页至多 100 条，原会话不裁剪。较旧页使用返回的 nextCursor；对话变化后旧正文游标拒绝，需刷新。脱敏是尽力策略，不能保证任意用户文本中的未知秘密均可识别；不应向模型/会话提供不必要的秘密。

IDE/SDK 新接口：session/history、runtime/history、goal/list、goal/set、goal/decide。IDE session/Agent 清单、继续与取消都限定桥接工作区；Agent/session 不匹配拒绝。历史数据不是权限令牌。runtime/history 明确 complete=false：仅保留元数据，容量淘汰/代际变化会 reset，观察写入失败不会逆转已经执行的工具，不是事务 outbox 或集中防篡改审计。

## VS Code

重新安装本版附带扩展后，Sessions 点击打开历史预览，而不是立刻执行。面板有 Restore saved conversation / Older messages / Refresh saved history。正文通过 textContent 渲染，不作为 HTML。隐藏推理、工具原始输入输出、图片、提供方响应状态不会进入历史视图。

`ccpt.restoreSessionHistory` 默认 false。明确开启后，重开面板恢复最近选择会话预览；扩展 workspaceState 只保存会话 ID，不复制正文。默认通过显式选取 Sessions/Restore 恢复。下一次 Send 才继续原会话，历史阅读不会触发模型、工具或批准 Plan。真实 Remote/多窗口/多根/物理终端矩阵仍未认证。

## Hook 边界

FileChanged/DirectoryAdded 按 path 匹配 matcher，InstructionsLoaded 按 source 匹配。payload 包含路径/类型/来源/关联 ID，不附文件正文。生产调用点把这些事后事件作为观察通知：失败会审计并给出提示，不能把已成功的写入误报成失败，不能靠 updatedInput 事后改写动作。

不追踪任意 Shell/外部编辑器/第三方程序的一切文件变化；MessageDisplay/CwdChanged 等全触发点、全参照事件逐字段/退出码一致性仍未完成。不是任意插件无停顿替换、exactly-once 或 OS 沙箱。

## 验证

本版增加独立历史/隐私/游标/并发 Goal/job 分区/文件 Hook/真实 Agent 测试，以及重启 IDE bridge、Node 构建 CLI/TUI 与扩展处理器验证。全量回归数量、离线 npm 安装、声明消费者和各 smoke 结果以随包 evidence 为准，不用 loopback 或 stub VS Code 代替公司/真实 Remote 验收。

来源权利、第三方许可/NOTICE 和重分发批准仍是发布阻断；本地候选包不是已获准分发的团队成品。详见 [仍未完成](REMAINING-0.59.zh-CN.md)。
