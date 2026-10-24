# 0.60 追加验证：2026-10-18

本轮按原始 A1–H4 检查，不重定义分母。新增验证脚本和测试清理改动，没有修改产品运行时、版本、个人配置或交付 tgz。历史验收记录保留，不用本轮结果覆盖之前的失败。

## 已确认的新缺陷

### V060-A1-01：直接恢复依赖先刷新 Agent 清单（P2，待修复）

实际构建的 Node CLI 可以复现，不是只根据源码推断：

1. 在独立临时 home/workspace 中创建已批准 Plan、Goal 和有界 Goal Run。
2. 启动一个自有 Node 子进程并等待它真实退出。只探测该子进程，没有终止无关进程。
3. 注入中断后的持久状态：Goal Run 为 `running`，匹配的执行 Agent 记录仍为 `working`，PID 是上述已退出子进程。此步骤是故障注入，不是物理断电验收。
4. 执行 `goal-run recover ID --expected-version N`，返回退出码 1：`Execution owner is still active`。
5. 执行 `ccpt agents` 后再次使用原版本 N 恢复，成功转成 `unknown`；attempts 仍为 1、模型请求为 0，没有自动重放。
6. 再用过期版本 N 恢复会被 CAS 拒绝。

原因：`recoverGoalWorkflow` 直接 `loadAgent` 读取持久状态；活性核对在 `listAgents`，直接恢复路径没有先做这一步。入口见 `src/goalWorkflow.ts:113`，活性核对见 `src/agent.ts:138`。

影响：异常退出后的恢复入口会误拒绝，用户必须先刷新清单。不是已经证明会丢失对话、重复扣费或自动重放。当前临时操作顺序为：先 `ccpt agents`，再重新检查 Goal Run 的版本并恢复；`unknown` 后仍须人工核验外部结果，不能直接当作失败重试。

后续修复应在直接恢复入口安全核对匹配执行者的活性，而不是把“先打开清单”当作用户前置步骤；继续保留版本 CAS、原会话和共享预算，并且不能从“进程已死”推导“外部操作未发生”。本轮没有实施该运行时修复。

证据：`.ccpt/verification-060-20261018/boundaries/recovery-boundaries.json`。其中 `reproductionCompleted=true` 仅代表复现完成，`allAcceptanceChecksPassed=false` 才是产品验收结论。

## 完整回归与测试清理

本轮第一次完整回归：**636 项、111 文件；635 通过、1 失败，454,315 ms**。唯一失败是 `terminal-responses-integration.test.ts` 的 semantic 模式用例，finally 删除临时目录遇到 Windows `EBUSY`。日志没有功能断言失败，但清理失败仍计入失败，不按“635+专项复验”拼成全绿。

本轮仅修改该测试的 finally：等待自有 TUI 子进程和输出泵结束，改用已有的有界 fixture 清理 helper；不放宽断言、不改变超时、不开新产品功能。

清理调整后的第二次完整回归：**636 通过、0 失败，111 文件、4,591 次断言，455,911 ms，退出码 0**。证据为 `full-after-fixture-cleanup/single-process-regression.json` 和同名 log；最终汇总另存为 `verification-summary.json`。两次运行不相加。现有回归全绿，但 V060-A1-01 仍是独立验证确认的产品缺陷。

8 个 follow-up 脚本均完成：7 个所列路径检查通过，1 个故障注入脚本成功复现上述缺陷、产品验收标记为 false。另行复验实际 tgz 离线安装通过。不能将“脚本退出成功”统一算作验收通过。

## 原编号验证对照

以下“覆盖通过”只指相应本地自动化路径，不等于本项全部实现或目标环境验收。

| 原 ID | 本轮验证范围 | 结论与未覆盖边界 |
| --- | --- | --- |
| A1 | approved Plan 后台 Coding、准确人工审批续行、同一 Agent/session、累计请求预算、变更部署拒绝、取消/CAS；另做真实退出 PID 的直接恢复故障注入 | 正常路径覆盖通过；新增 V060-A1-01 待修。TUI/IDE Goal Run 向导、OS 定时 Coding、长运行/物理断电仍未验收/未接入 |
| A2 | 写前 claim、12 个并发同 ID claim 单胜者、人工结果核验 CAS、MCP 配置绑定、实际本地 Git revert；补偿结果不明后拒绝重放 | 本地边界覆盖通过。新调用 ID 仍能产生另一 claim，不能当作业务幂等；第三方 push/PR/支付等需要专用真实连接器 |
| A3 | nonce 收据、缺失/变更定义和来源检查、恢复摘要；测试不注册真实调度器 | 纯逻辑和 fixture 有覆盖；非标准 manager 路径、Linux/macOS 真机和跨资源原子性未验收 |
| A4 | 清单、状态、CAS 升级/rebind、校验卸载及恢复入口 | 本地覆盖；未安装真实 Windows Task Scheduler 任务，升级故障矩阵未验收 |
| P1 | 并发通知、500 条保留、分页边界、source key 去重、CAS 已读、元数据事件 | 本地覆盖；不是无限历史或事务 outbox |
| P2 | 指定 Team/邮箱/成员/任务通知生产者、元数据补发、恢复后的状态刷新 | 本地覆盖；不能据此认定完整内部事件流或集中审计 |
| P3 | 默认 metadata、显式脱敏捕获与读取、长度限制、隐藏推理不显示、512 条保留缺口、错误游标/伪造行拒绝、Saved activity、原生 Responses continuation 保留 | 本地 Node SDK/CLI/IDE bridge 和扩展脚本覆盖通过；查看历史不调用模型或重放工具。没有无损 delta/图片重放保证 |
| P4 | 实际 Node 构建产物、临时 npm 全局前缀、命令 shim、SDK 类型与导入、原始按键 TUI、扩展/webview 脚本 | 本地验证通过；TUI 为受控 TTY 属性和按键输入，扩展为 DOM/VS Code fixture，不是物理终端、真实 Remote/多窗口/多根验收 |
| H1 | 模型边界凭据/网络/TLS/超时分类、字符串错误诊断、取消和普通工具错误不误触发 | 已有用例覆盖；云适配器真实错误样本仍不足 |
| H2 | 有界 Stop 软反馈继续、最多八次反馈、保留权限和预算限制 | 已有用例覆盖；不证明业务质量或所有参照 payload/退出码完全等价 |
| H3 | 配置/授权摘要变化，实际 Node 429 后下一 HTTP 尝试被阻止，保留会话并等待人工 | 本轮实测通过，只有一次模型 HTTP 请求；不强杀已经运行的外部进程，不是 OS 级实时撤权 |
| H4 | MessageDisplay 仅改表面、失败回退、Agent 局部 cwd、FileChanged 内置与外部写入、DirectoryAdded、懒加载 scoped InstructionsLoaded、65 文件拒绝 | 本地边界覆盖；逐行批次、动态 watchPaths、全部指令源和事件语义、零停顿热替换/exactly-once 仍缺 |

## 实际交付包和协议路径

验证对象仍是 `releases/local-0.60.0-VmfPF1/ccpt-0.60.0.tgz`：

- SHA-256：`5645ad596df5d1aab27d3d169612f7c7768d204f8013bb3bb402c5cbb3698da1`。
- 实际 tgz 在临时全局前缀、空缓存中离线 npm 安装；执行 npm 生成的命令 shim、后台 worker、SDK 流和文件工具往返。真实全局安装未变。
- 严格 Node TypeScript 消费者检查传递声明、负类型断言和 Node ESM 导入。
- 实际 Node 原生 Responses loopback 验证 `input`、函数调用、结果回传、多轮续行和提供方 continuation 保留；另有显式 Chat 兼容层安装用例。没有把兼容 Chat 证明当作任意供应商原生 Responses 支持证明。
- 实际 Node CLI → detached Goal launcher → detached Agent，三次请求完成“请求写入→人工批准→结果回传”，未重置会话或预算。
- MessageDisplay 替换只出现在显示结果，原始模型/历史结果不被污染。

产品源码快照仍是 **828 文件**，摘要 `154e4e10344c533b94439aa669aa485017fd2249e16c4b67c862d3559131ff51`。快照的明确范围包含产品源文件/扩展/指定清单文档，不包含本轮验证脚本、测试清理和本报告；不得把这个摘要说成整个目录逐字节不变。

## 其余平台项仍然不能改成“完成”

1. 插件签名 overlay、跨插件/收据原子回滚、团队真实插件和中断来源矩阵：本轮未补代码，也未完成实机互操作。
2. MCP 独立 GET 反向人工交互、嵌套审批、URL/多模态、POST 自动续传、防篡改集中审计：A2 专用连接器用例不能替代。
3. macOS/Linux 专用凭据后端和独立凭据进程/硬件隔离：没有目标机验收。
4. Git ref 自动保留/远程备份、二进制/删除冲突完整解决器、大仓性能：没有真实完整矩阵。未执行 push/PR。
5. OS 沙箱、恶意进程树及逃逸：本轮没有声称验证。restricted、白名单、NoNewPrivileges 都不是完整替代。
6. 公司 Azure、CA/代理/mTLS/Entra 续期和公司后台 worker：公司请求为 0，仍需同事在目标环境验收。
7. 真实 tokenizer、多模态精确计数、1M 大仓摘要质量：现有用例不证明这一点，也不保证零信息损失。
8. 来源权利、NOTICE、重分发批准、旧品牌兼容整理：发布门禁仍需真实材料；本地 npm 安装不等于发布许可。脚本变化后 inventory digest 会变化，旧审批不能沿用。
9. 真实 OS/IDE 升级、长期断电、网络文件系统和真实 push/PR：未执行，仍保留环境/授权边界。

### 目标环境验收仍需留下什么证据

| 环境 | 必测场景 | 合格证据/停止条件 |
| --- | --- | --- |
| Windows Task Scheduler | 注册、用户身份、正常触发、CLI 全退出后唤醒、禁用/重绑定/升级中断恢复 | 系统实际任务定义、进程与本地收据相符；来源不明或摘要变化必须停下，不得猜测删除/重放 |
| Linux/macOS | 实际用户管理器、登录/GUI/企业策略、重启、缺失 manager、部分安装、非标准路径 | 实际 manager 查询结果与 nonce 文件匹配；fixture 定义不能替代；不支持的路径应明确拒绝 |
| IDE Remote/多窗口 | 两窗口并发 Plan 决策、过期审批、断线重连和通知补发、多根、升级 | 只接受一次合法版本决策，重连不重复执行工具，不显示另一工作区的敏感正文 |
| 公司模型链路 | 分开保存 Chat/Responses 配置，普通问答、多轮、完整工具目录、实际工具调用与结果回传、流式取消、429/TPM | 脱敏协议/部署摘要、状态码/code/param/request-id、usage 和取消结果；不能通过偷偷切换协议或跳过工具来宣称通过 |
| 公司网络与凭据 | 完整 CA 链、证书过期/轮换、HTTP/HTTPS 代理、mTLS、Entra 续期、主进程与后台 worker | TLS 校验保持开启；未知证书必须失败；凭据不进入日志/包；续期后 worker 仍使用正确身份 |
| 长期/故障 | 服务端已成功但客户端断线、进程中断、真实重启、网络文件系统延迟/锁冲突 | claim/预算/会话保留；未知结果要求人工核验，不能自动退款、重复提交或从头重跑 |

这些是待执行的验收条件，不是本轮通过项目；涉及真实注册、计费、外部写入的步骤需在目标环境明确授权后执行。

## 可重复验证入口

从项目根目录运行，均只使用隔离临时状态与 loopback：

```powershell
npm run check
node scripts/validation-snapshot-060.mjs verify
$env:CCPT_REGRESSION_OUTPUT = 'C:\Users\55038\CCPT\.ccpt\verification-060-next\full'
bun scripts/regression-single-process.ts
$env:CCPT_VERIFICATION_OUTPUT = 'C:\Users\55038\CCPT\.ccpt\verification-060-next'
node scripts/verification-followup-060.mjs
npm run verify:package -- releases/local-0.60.0-VmfPF1/ccpt-0.60.0.tgz
```

顺序执行，不与其他全量回归或构建并行。follow-up 会保存旧的生成报告再运行，逐项记录退出码；复现脚本成功退出不代表没有缺陷，须同时读取 `acceptancePassed` 和 `findings`。重跑输出选择新目录，避免覆盖本次原始日志。
