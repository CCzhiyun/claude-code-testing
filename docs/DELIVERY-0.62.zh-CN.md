# CCPT 0.62：迁移、Goal 人工向导和恢复/交互增量

这是本地所有者验证候选，不是已取得第三方重分发授权的公开版本。最终测试数字和归档哈希以候选包旁的 VALIDATION/evidence 为准；源码版本号不等于产物已通过测试。

## 项目迁移

源码、隐藏项目状态、依赖、历史证据和旧候选包迁到 `D:\project\CCPT`。5798 个文件、789373835 字节逐文件 SHA-256 校验，复制后再次核对原目录。迁移回执位于 `D:\project\CCPT.migration-20261018.json`。原 C 目录内容已清理，空目录若仍被进程占用则保留，不强杀无关进程。

仅项目 settings 的四个操作性根路径重绑到 D；原始 settings 保存在 `.ccpt/migration-20261018/settings.original.json`，受项目私有 ACL 保护，不进入 npm 包。未修改个人模型 Key、URL、用户配置、全局 npm 安装或历史证据路径。旧证据中的 C 路径是当时来源，不批量改名。旧 Plan/Goal 的部署/策略绑定若因路径变化失效，必须人工重新审阅；不伪造审批迁移。

在新目录构建：

```powershell
cd D:\project\CCPT
npm run check
npm run build
node .\dist\cli.js
```

源码构建需要已有开发依赖与 Bun；安装候选 tgz 后使用 Node.js 20+，同事不必安装 Bun/TypeScript。通过来源/许可审批后才可分发；安装已交付的本地包可用 `npm install --global <ccpt-0.62.0.tgz的完整路径>`，然后在自己的工作目录执行 `ccpt`。本轮没有替换现有全局命令，也没有 npm 发布。

## Goal Run：准备不等于开始

终端输入 `/goal-run prepare`，选择已经批准、绑定原会话且具有 active Goal 的 Plan，填终身请求预算、token 预算和工具列表，再明确确认“Prepare reviewed workflow”。默认选项为取消。请求预算 1–1000、token 预算 1024–100000000，工具 1–64 个。没有批准 Plan 时不会自动批准或生成付费请求。

```text
/goal-run
/goal-run show goalrun_ID
/goal-run start goalrun_ID
/goal-run resume goalrun_ID 核验反馈
/goal-run recover goalrun_ID
/goal-run cancel goalrun_ID
```

每个变更动作打开带精确版本的确认界面，展示剩余预算、工具、待批准权限的完整 JSON；长说明可 PgUp/PgDn。取消/Esc 不发送给模型。start 才启动付费后台执行；resume 只准备续行，仍须再 start。unknown 必须独立核验外部结果并提供反馈，不自动重放。

`/goal-run` 是有界快照列表，重新打开刷新。CLI 另有 `ccpt goal-run list`；VS Code 命令面板新增 **CCPT: Goal Workflows (Prepare / Review / Start)**，先打开 JSON 审查，再显示模态确认。两进程使用同一持久版本 CAS，旧窗口审批不会自动转成新版本批准。Agent 返回的 question JSON 无法注入本地审批动作。

这不是 OS 定时自动 Coding 绑定；断电长运行、真实 Remote/多窗口/多根和 IDE 升级仍需目标环境验收。

## Git 恢复引用保留与备份

显式配置示例（合并到自己的 settings，不覆盖已有配置）：

```json
{
  "recoveryMaintenance": {
    "enabled": true,
    "automatic": false,
    "retentionDays": 30,
    "minKeep": 8,
    "maxPrunePerRun": 4
  },
  "recoveryRemote": {
    "remote": "recovery",
    "expectedUrl": "https://git.example/approved-private-backup.git"
  }
}
```

```text
ccpt agents recovery-maintenance plan
ccpt agents recovery-maintenance run --expected-digest DIGEST --confirm
ccpt agents recovery-remote prepare --confirm
ccpt agents recovery-remote run backup_ID --expected-digest DIGEST --confirm
ccpt agents recovery-remote query backup_ID --confirm
```

本地清理最多检查 128 个引用、单批最多 32 个。新引用记录实际创建时间；旧引用没有收据则保留，不根据旧 commit 时间推断可删。必须仍有 branch/tag 保留对应 commit；先写完整 bundle，复核摘要，再用 Git 事务同时核验保留引用和待删 OID，失败不删除。`automatic=true` 仅在成功清理 managed worktree 后触发本地有界维护，不是 OS 定时器；不做 Git GC。

远程备份会上传提交历史，需 trusted workspace、`policy.allowGitPush=true`、网络策略及固定唯一 push URL。prepare 只生成审查收据，run 才发送。仅 HTTPS 无内嵌凭据/查询/片段，或工作区内真实本地临时 bare 仓库；不支持 SSH/ext helper。新目标引用必须不存在，使用原子 push 和空 lease，绝不覆盖现有备份。写前持久化 unknown，失败后只查询，不自动重推或补偿。真实远端服务与公司凭据未验收；本轮只有自有临时本地 bare 仓库的 Git 测试，没有业务 push/PR。

## MCP URL / 多模态：独立批准而非隐式联网

服务器可配置 `elicitationOrigins: ["https://approved.example"]`。`mcp call` / `mcp watch` 显式同时带 `--interactive --interactive-url`，真实 TTY 下人工同意。仅固定 HTTPS origin、无 userinfo/fragment；不会自动打开浏览器、提交凭据、抓取 URL，accept 只代表同意而非站外流程完成。

SDK 的 `McpInteractionHandlers` 增加 `elicitUrl`、`urlOrigins`，以及 `confirmMultimodalSampling` / `sampleMultimodal` / `confirmMultimodalSamplingResult`。模型前和发回前独立批准；拒绝分享或取消不发送结果正文。支持每消息一个 inline text/image/audio 内容，16 条消息、maxTokens 2048、单媒体 512000 字节、总请求 750000 字节；MIME/base64 严格限制。SDK 回调自行实现模型转换；终端采样仍为文本，不自动把图片/音频发到模型服务。

有 URL/多模态回调时请求协议 2025-11-25，服务器降级到 2025-06-18 则移除这些回调，不以旧能力偷偷执行。保留既有嵌套界限、总 deadline、取消和审计路径。未覆盖所有最新协议形态、内容数组、工具采样、站外完成通知相关联及企业服务器矩阵；本地 HMAC 审计不等于集中防回滚存储。

完整回归发现并修复降级视图复制旧批准回调的回归：现在始终读取调用方实时的批准/撤销函数，同时永久屏蔽旧协议不支持的 URL/多模态回调；连接后新增回调也不会越过协议限制。

## FileChanged 显式 watchPaths

FileChanged Hook 可设 `watchPaths: ["src/example.ts", "config.json"]`，matcher 仍按事件匹配；相对路径上限 64，禁止 glob、链接与越界文件。授权注册表可以调用 watcher.update 替换监听集合；新增路径只建立基线，不把历史变化当新事件。更新失败清空目标，不继续运行部分新配置。每文件 10 次/分钟，非递归扫描。

这不是任意 settings 修改即授权执行：TUI 仍通过既有安全空闲重载；活动 Agent 在授权边界暂停复核。不强杀已启动 Hook，不声称零停顿/exactly-once 或全部参照触发点兼容。

## 模型、CA 与验收

三协议配置继续分开：`model.apiProtocol` 为 `responses` / `chat-completions` / `messages`。公司原生 Responses 使用 `responsesTransport=native` 与准确 `/v1/responses` 端点；GLM 的 Chat 兼容不等于部署支持原生 Responses，不能改路径后当成功。模板见 `settings-responses.example.json` 等。

API Key 可用 settings 的 `model.apiKey`，并清空 `apiKeyEnv`；或 `apiKeyEnv` 填实际环境变量名称，不是 Key 内容。专用凭据后端仍可用。公司 CA 走 `network.caFile` 或已支持的 CA 环境变量，TLS 校验保持启用。不要把公司 Key/mTLS 私钥放进 tgz。公共 CA 内嵌继续用已有显式构建入口，需公司审批。

接近 90% 提醒、超过 95% 压缩后继续原会话不退出的策略保留；实际 BPE 仅明确部署编码后启用，图片/framing/billing 非精确。完整剩余见 [REMAINING-0.62.zh-CN.md](REMAINING-0.62.zh-CN.md)。
