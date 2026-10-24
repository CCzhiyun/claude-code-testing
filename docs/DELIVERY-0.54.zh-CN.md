# CCPT 0.54 本地交付说明

本轮针对剩余表继续实现，不是全功能、企业环境或第三方重分发验收完成声明。

## 新增实现

| 方向 | 本轮落实 | 安全边界 |
| --- | --- | --- |
| Hooks | `once` 改用跨进程文件锁与持久收据；六个真实进程竞争只执行一次 | 收据仅保存摘要、状态和时间。失败/崩溃遗留不会自动重试；异步 once 被拒绝。不是外部副作用 exactly-once |
| IDE | bridge 退出后指数退避重连，重新订阅 project/watch，并使当前 Plan/Teams/Agents/Sessions 视图失效刷新 | 最多连续尝试八次；不重发聊天、工具或审批。超时/断线告知结果可能不确定，必须先检查状态 |
| Teams TUI | 新增/删除成员、命名团队和 Plan 自动同步，按 ID 保留筛选后的选择 | 不推进此前人工审阅的 Plan 版本；确认、搜索、重命名、前台执行中不替换面板。任务/邮箱独立刷新仍需显式操作 |
| Skills/插件监听 | `/reload-skills --watch`、`/reload-plugins --watch` 覆盖配置实际接纳的自定义目录 | 仍须明确开启；32 根、2048 元数据项、深度 4 的有界监听，不穿越链接。全局目录授权没有放宽 |
| 自动化恢复 | 每次自动化状态写入先生成带 SHA-256 检查点；新增 `wakeups repair` 预览和 CAS 确认恢复 | 损坏原件按字节保留，验证检查点后恢复；停用 Routine、取消待投递 Wakeup/活动 Goal、失败化未完成 Run。不重放外部操作 |
| Git | `agents conflict-versions <path>` 显示 base/ours/theirs 是否存在、对象 ID、模式、字节数和工作文件状态 | 支持检查二进制/删除冲突；只读，不解码二进制、不自动选边、不覆盖/暂存/提交/推送 |

代码测试包含正常、错误、并发、断线和恢复边界；真实公司 Azure、Remote/多窗口、跨 OS 凭据以及第三方服务矩阵仍需各自环境验证。

## 安装和启动

只需 Node.js 20+，无需 EXE，终端执行：

```powershell
npm install -g .\ccpt-0.54.0.tgz
ccpt --version
cd C:\your-project
ccpt
```

这是包所有者的本地验证候选，不会发布到 npm，也不自动全局安装。第三方来源、许可、NOTICE 和企业审批完成前不能据此声称已有重分发授权。`UNLICENSED`、校验哈希和测试通过均不构成许可。

## 公司模型、API Key 和 CA

沿用 `%USERPROFILE%\.ccpt\settings.json`；本次不会改个人配置或模型，也不会读取/打包公司 CA、API Key。模板：

- `settings-responses.example.json`：原生 Responses；公司部署名、完整端点和认证头按实际网关填写。
- `settings-chat-completions.example.json`：显式 Chat Completions，不能与 Responses URL/参数混用。
- `settings-messages.example.json`：Messages 协议兼容入口。

具体字段见 `PRODUCT-GUIDE.zh-CN.md` 与模板；CA 使用已有 `network.caFile` 或 `NODE_EXTRA_CA_CERTS`。不要关闭 TLS 校验。GLM 的 Chat 适配通过不等于任意 GLM URL 已原生支持 Responses。

## 新命令

```text
ccpt wakeups doctor
ccpt wakeups repair
ccpt wakeups repair --confirm --expected-digest <预览给出的 SHA-256>
ccpt agents conflict-versions path/to/file
```

`repair` 只接受损坏主文件和可验证检查点，不接受完整性校验失败的检查点。确认前先检查 `.ccpt/automation.json.checkpoint`；它含任务文本，不能分享诊断原件。恢复副本位于 `.ccpt/automation-recovery/<随机目录>`，同样按敏感项目状态保护。

恢复后如需继续，先核对原会话和外部副作用，再明确创建新任务/Goal/Wakeup。不要为了重试随意删除 Hook once 收据；失败收据意味着此前动作的结果可能不确定。

## 测试与未完成项

定向新增测试：`test/remaining-batch.test.ts`。全量回归、编译产物和实际 npm 包验证的报告随本地交付目录提供；以报告实际结果为准。

仍未完成的代码和环境验收统一列在 `REMAINING-0.54.zh-CN.md`，没有把本次增加的子集称为完整平台收尾。
