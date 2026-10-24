# CCPT 0.67 本地验证交付

沿用 0.66 原 A1–H4 与十个平台领域。本批重点推进 P1–P4、H1–H4、插件、MCP、Git 五个领域的具体代码缺口；领域覆盖不是“剩余功能完成 50%”或企业生产验收。准确回归结果见随包 VALIDATION 与 evidence。

## 安装和配置

```powershell
npm install --global .\ccpt-0.67.0.tgz
ccpt --version
ccpt
```

仍使用 `%USERPROFILE%\.ccpt\settings.json`，项目覆盖在 `.ccpt/settings.json`。公司 OpenAI Responses / Chat Completions 和其他协议须配置独立部署，不把 Chat URL 直接用于 Responses。企业 CA 在 `network.caFile` 或受支持的 CA 环境变量配置；默认构建不打入公司证书/Key。本批未修改个人设置或实际全局安装。包只供所有者本地验证，不代表已获团队重分发批准。

## 1. 提交后恢复：Tasks、Teams、Agent、邮箱

四条生产链与已有 Plan/通知一样，在同一原子快照中提交状态和 outbox。事件日志失败不会把已成功业务动作返回成可自动重试的失败。恢复只发布 topic/sequence/time，绝不再次执行工具、模型、审批、消息发送或任务。

```powershell
ccpt event-outbox recover --cwd D:\your-project
```

IDE reconnect 的 `project/events` 自动恢复；SDK `recoverProjectOutboxes` 保留，新增 `taskStore` 提供任务 API。每个记录/工作区队列最多 256 条，满时在业务快照提交前背压。每项目最多 4096 个稳定 producer checkpoint，不自动淘汰去重信息；可见事件仍保留最近 1024 条。恢复最多发现 8192 个目录条目、4096 个记录、64 MB 内容；单记录最多 8 MB，拒绝链接/越界。达到上限需管理员归档，不能当成无限历史或大规模恢复已验收。

Team 删除改为隐藏墓碑，保留删除的补发意图。邮箱旧数组在首次写入时迁移为 `{format:1,messages,_projectDelivery}`；只读访问不迁移、不标记。不要让旧版本写入新格式。邮箱目标是收件 Agent 及根 Team 会话工作区，不因每个发送者改变而任意重绑。Agent 心跳本身不重复制造状态事件。

状态+意图在一个 JSON rename 内；与工作文件、其他业务快照、跨工作区 journal 仍非一个全局事务。不承诺断电 fsync/exactly-once 外部业务操作。无持久化 print 的异步上下文禁止 Task/Agent 等创建项目 outbox；不会在临时 Agent 配置建立前先绑定项目、随后因 ephemeral 切换而报错。

## 2. 旧单插件和历史迁移

```powershell
ccpt plugin-set migration-preview --json '[{"name":"team-plugin","scope":"project"}]'
ccpt plugin-set migrate --json '[{"name":"team-plugin","scope":"project"}]' --expected-digest REVIEW_SHA256 --confirm
```

选历史版本时加 `revisionId`。最多 32 个不同身份，不能把不同 scope 的同名插件混成一套。审阅绑定当前 active pointer、有效配置、源字节/历史 receipt、overlay；在维护锁内重新校验，再复制到全新 immutable generation。当前签名/锁定/撤销政策适用于旧内容，没有豁免。保留旧文件与历史，不自动 activation，不自动开启 usePluginSets，不下载或执行插件代码。随后仍须正常 preview/apply。跨进程原 active CAS、签名 overlay 校验继续保留。

## 3. 分组 Hooks

兼容格式的 `hooks.json` 不再只留下 command/timeout：保留 once、watchPaths/watchDirectories、timeoutMs、if、statusMessage，以及 HTTP/prompt/agent 类型声明。最终有效配置校验拒绝未知 event/type、缺少必要 command/url/prompt、非法 once/timeout。保留声明不是授予执行权限；原 allowlist、网络规则、签名和 once 规则仍生效。本批不声称所有外部实现事件/退出码完全等价。

## 4. MCP sampling 内置预算与工具声明

```json
{
  "mcpServers": {
    "team": {
      "transport": "http",
      "httpMode": "streamable",
      "url": "https://your-mcp.example/mcp",
      "samplingBudget": {
        "maxRequests": 4,
        "maxReservedTokens": 1000000,
        "tools": true
      }
    }
  }
}
```

```powershell
ccpt mcp call team TOOL --json '{}' --interactive --interactive-tools
ccpt mcp watch team --interactive --interactive-tools
```

必须真实交互终端，服务配置和本次 flag 双重启用工具声明；每次请求前、回传结果前分别审批。使用当前模型的统一适配器和 spending ledger；保守预留完整配置输入窗口+最大输出，HTTP 重试也计入请求上限；取消/失败未知费用不退款。有金额上限时沿用 spending.prices，无价格不绕过。

服务器声明的工具仅让模型产生工具调用，结果发回服务器执行；**不会调用本地文件、shell、Skills、MCP 工具或当前对话**。平衡的 tool_use/tool_result 多轮历史可继续。文本/图片适配器不接受音频和 required toolChoice，而不是悄悄降级。旧协议协商隐藏新 tools 能力。无 samplingBudget 时文本交互默认最多 4 个 HTTP 尝试及对应完整窗口预留量；仍要逐次人工审批。

SDK `createMcpModelSampling(config,budget,approve,{tools:true})` 返回 handlers 和 status，默认缺少回调仍拒绝。首次调用若在父 Agent 的 spending scope 内，会继承父账本、按更严格上限检查并报告实际账本，不另开额度；同一 handler 拒绝在不同账本间复用。独立 handler 的预算仅属于此次生命周期，不是跨 CLI 重启的整套企业账户限额。审批记录沿用现有脱敏交互审计；不是 WORM 或集中正文档案。

## 5. 冲突解决的安全撤回（含 split-index）

```powershell
ccpt agents conflict-restore-preview conflict_ID
ccpt agents conflict-restore conflict_ID --expected-digest REVIEW_SHA256 --confirm
```

TUI `/undo-conflict conflict_ID` 提供本地人工审阅/确认；IDE bridge 支持 `conflict/restore-preview` 和 `conflict/restore`。SDK 同名 API。模型返回的 question JSON 不能创建本地恢复能力。

仅允许新版本的 completed、绑定 HEAD/模式的 receipt，且当前完整 index 与解决时完全相同、当前文件等于当时选定字节/删除、HEAD 未变。后续编辑、其他暂存、损坏备份、旧无 HEAD receipt 均拒绝覆盖。恢复原 working/index 与缺失的 checksum-validated shared-index，恢复前状态也留在 restore-backup；使用 Git index.lock、项目锁、确认摘要和无覆盖文件发布。未知/中断保留收据，不自动重放。

不能用来撤销后续多文件任意改动；不处理 symlink/submodule，不是完整图形 merge 工具，不提交、不 push、不创建 PR。非合作编辑器/恶意文件系统仍可竞态，不保证跨工作文件和 index 的断电原子性。
