# CCPT 0.69 本地验证交付

本次继续实际补代码，不把模拟端点、配置项或本地成功等同于公司/跨 OS 生产验收。准确结果见随包 VALIDATION 与 evidence；尚未实现的代码、目标环境验收、无法由 CLI 独自提供的保证分别列在 [REMAINING-0.69.zh-CN.md](REMAINING-0.69.zh-CN.md)，不重新计算全平台完成百分比。

## 安装与原配置

```powershell
npm install --global .\ccpt-0.69.0.tgz
ccpt --version
ccpt
```

继续使用 `%USERPROFILE%\.ccpt\settings.json` 和项目 `.ccpt/settings.json`。没有更改个人配置或实际 global prefix，不生成产品 EXE。公司部署仍独立配置 `model.apiProtocol` 为 responses / chat-completions / messages、模型部署名、URL 和凭据；不按模型名猜协议、不自动换 endpoint。CA 在 `network.caFile` 或现有 CA 环境变量，mTLS/代理沿用现有配置；默认包不嵌入公司 CA/Key。公开 CA 的显式构建选项不等于获得公司重分发授权。

## 1. 显式业务幂等与安全续行

```json
{
  "mcpServers": {
    "payments": {
      "transport": "http", "url": "https://your-mcp.example/mcp",
      "operationRecovery": {
        "charge": {
          "idempotencyArgument": "idempotency_key",
          "statusTool": "query_charge",
          "compensateTool": "refund_charge",
          "operationArgument": "operation_id",
          "businessScope": "payment-v1",
          "businessKeyFields": ["order_id"]
        }
      }
    }
  }
}
```

这是一份管理员与服务器约定的协议，不是按工具名猜含义。businessScope/businessKeyFields 成对配置，选择 1–8 个顶层非空字符串/安全整数参数；不接受对象、浮点数或原型字段。业务 ID 绑定服务器部署、工具、命名空间和选定字段，只持久化摘要，不存业务键明文。同一业务不能仅靠换 provider call ID、Agent 或 session 再执行；同业务键改金额等其他参数也会拒绝。

原 claimed/completed/unknown 收据不重放；只有人工到真实系统核实并 CAS 标成 not_applied 后，才允许同一键再次 claim。查询/补偿沿用部署摘要和当前权限验证，未知补偿不自动再试、不退款。不同工作区的客户端记录不是一个事务，跨工作区/机器仍依赖服务器实际兑现 idempotency_key。更改命名空间/部署是管理员改变合同，不能用来声称通用业务自动去重已证明。

## 2. 可选持久事件日志与 UI 重放

默认不创建新日志。启用元数据或完整消息脱敏捕获：

```json
{"runtimeReplay":{"mode":"redacted","maxBytes":8388608,"maxEvents":50000,"maxTextChars":64000}}
```

redacted 不持久化实时 delta 正文，避免把跨 chunk 的未知秘密错误当作已脱敏；最终消息/工具文本按现有脱敏器处理，不承诺识别所有敏感信息。需要原始文本增量边界时必须明确接受本地明文风险：

```json
{"runtimeReplay":{"mode":"verbatim","acknowledgement":"I_ACCEPT_LOCAL_PLAINTEXT_TRANSCRIPTS","maxBytes":33554432,"maxEvents":100000,"maxTextChars":100000}}
```

verbatim 会存本来显示给用户的明文消息/工具输入输出，可能含秘密；不是脱敏模式。切回 metadata/redacted 不会清洗以前的日志。隐藏推理始终排除，不存网络认证头或模拟 provider 执行状态。无持久化 print 不捕获。

```powershell
ccpt sessions replay SESSION_ID --limit 100
ccpt sessions replay SESSION_ID --cursor GENERATION:SEQUENCE --include-text
```

TUI `/replay [session-id] [cursor] [--include-text]`；VS Code 恢复会话后可点 Replay journal / More journal；IDE `runtime/replay` 与 SDK `runtimeReplay` 使用同一分页日志。只显示事件，从不重跑模型、工具、审批或插件。恢复聊天正文继续使用既有 canonical session/history，不把历史事件当成新提示。

日志在用户状态目录 runtime-replay/，逐条 hash-chain、文件锁、先 sync 日志再写索引。完整已追加记录可在索引丢失/滞后后重建；半条尾记录拒绝继续，不自动擦掉。达到容量、队列压力或写失败时保留已有记录并报告 captureFailure；不是“完整记录”假象，也不会因展示日志失败重试业务操作。默认 8 MiB/50000，最多 64 MiB/200000，队列 4096。不是无限历史、跨业务快照 outbox、WORM 或断电零丢失承诺。explicit verbatim 的 exactText 仅描述该页未截断的文本，不包括隐藏推理/图片/provider 状态。

## 3. 签名插件分发与 expiring rollout

```json
{"pluginRollout":{"allowedVersions":{"team-plugin":["1.0.0","1.1.0"]},"allowRemovals":false,"maxApprovalMinutes":30,"checkOnStartup":true}}
```

先用既有 stage/stage-marketplace 明确选源并构建完整 generation，再走：

```powershell
ccpt plugin-set rollout-preview pluginset_ID
ccpt plugin-set rollout-prepare pluginset_ID --expected-digest REVIEW_SHA256 --confirm
ccpt plugin-set rollout-apply rollout_ID --expected-version 1 --confirm
ccpt plugin-set rollouts
ccpt plugin-set rollout-reconcile rollout_ID --expected-version N --confirm
```

每个候选都必须是当前信任且未撤销的 publisher 签名，版本在精确允许列表；默认拒绝删除旧插件。审批绑定配置、当前 pointer、完整 artifact/overlay receipt，并在 1–1440 分钟内有效。旧 activate/apply/rollback API 不能绕过已配置的 rollout 门禁；回滚同样准备新的审批。

先写 applying 再 CAS 原子切换原 generation，完成后写 completed。断电/写入异常留下 applying/unknown，只能显式 reconcile；仅当候选 digest 和精确 pointer 版本吻合才确认完成，不能根据“当前有个类似版本”猜成功。收据与 pointer 仍不是跨文件/跨 host 全局事务。

checkOnStartup 后台仅检查本地收据并发去重提醒，不拉源、不下载/自动激活。启用 pluginRollout 或 usePluginSets 后，旧单插件后台自动更新链路被禁用。真实获取团队来源、密钥轮换/撤销、跨机器/NFS/断电分发仍需目标矩阵。

## 4. Launcher 声明依赖绑定

```json
{"recoveryRemote":{"remote":"team-backup","expectedUrl":"ssh://git@backup.example/recovery.git","transport":"ssh-wrapper","launcherDependencies":["D:\\company-config\\launcher-config","D:\\company-config\\known_hosts"]}}
```

除 wrapper 本体，还递归绑定明确声明的 helpers、策略、known_hosts 等文件路径、字节数与 SHA-256。修改/增删声明树中的文件都会使旧备份收据失效，检查在启动 launcher 前进行。不允许链接、UNC/device 网络路径或重叠树；最多 16 roots、16 层、1024 entries、256 files、合计 32 MiB。不要把可变日志目录放入依赖树。

这不是自动证明 wrapper 没有未声明的 DLL、环境配置、网络代码或其他凭据来源。企业应把 launcher 及声明依赖作为只读受控部署，自己严格执行 host-key、专用身份、权限和网络隔离。完整 OS 依赖/硬件信任仍需平台部署。

## 5. 自定义 BPE 正则及特殊 token

```json
{"model":{"tokenizerVocabulary":{"file":"D:\\company-config\\vocabulary.json","sha256":"填入文件64位SHA256","patternEncoding":"custom","specialTokenMode":"ordinary","timeoutMs":5000}}}
```

文件内容为 `bpe_ranks`、可选 `special_tokens` 映射，以及 custom 模式的 `pat_str`。基础 256 bytes、rank/token 唯一等校验保留；特殊 token 最多 1000 个且不能与基础 rank 冲突。普通模式将特殊字面量当普通文本；只有确认与真实 provider 处理一致时才选 allowed。自定义预切分正则最多 4096 字符，单独子进程执行，100–30000ms 硬超时，不继承 API Key/NODE_OPTIONS 等；超时不会杀掉主会话。依然不是 OS 安全沙箱。

不接受网络词表/代码 loader；每次先检查文件 SHA 再查缓存，文件最多 16 MiB，文本/segment 仍有边界。词表、正则、特殊模式必须由部署方提供真实值；不能仅凭模型名证明对应关系。多模态及 provider 私有 framing 计数仍不能声称精确。

```powershell
ccpt context-benchmark --tokens 1000000 --encoding cl100k_base
```

这是实际 1M 本地文本 BPE 吞吐基准，零模型请求，输出计数/耗时/RSS 增长；不是“模型原生 1M”“真实大仓理解”“语义摘要质量”证明。

## 6. MCP 音频输入的明确边界

```json
{"model":{"apiProtocol":"chat-completions","audioInputFormats":["wav","mp3"]},"mcpServers":{"team":{"transport":"http","url":"https://your-mcp.example/mcp","samplingBudget":{"maxRequests":4,"maxReservedTokens":1000000,"audio":true}}}}
```

实际部署必须支持音频；配置里保留它真正的模型/URL/Key，不把上述片段当作自动连接模板。

```powershell
ccpt mcp call team TOOL --interactive --interactive-audio --json '{}'
```

服务配置 audio、本次 audio flag、模型 input formats 三重启用，仍逐次请求/分享双审批。现代 sampling 的 WAV/MP3 转成 Chat input_audio，只输出文本或服务器工具调用，不播放音频、不执行服务器工具。缺能力、超限、非 user 音频、ogg/flac、音频工具结果或 Responses/Messages 协议明确拒绝，不猜 URL 不换模型。模型音频计价必须用管理员正确的预算费率；不声称自动获取价格。

实现依据 [OpenAI 音频 Chat 文档](https://developers.openai.com/api/docs/guides/audio-chat-completions)：此模式不是给 Responses 填一个 input_audio 就能兼容。音频输出和其他格式仍需单独适配。

## 7. 公司实际部署验收入口

```powershell
ccpt model enterprise-acceptance --confirm --max-requests 12 --max-tokens 16000000 --timeout 60000
```

只有显式确认和有限请求/token 上限才运行；会调用当前配置模型，可能计费。沿用并收紧已有预算/账户，禁用重试，失败即止，不自动换协议/模型/URL、关闭 CA 验证或改代理/mTLS。完整工具 schema、多轮、echo、流式、真实取消沿用已有 suite，再创建一个新的本地 fixture，通过真正 read_file dispatcher 读取并回传精确内容。该阶段遵守当前权限和 Hooks；不是用模拟工具结果替代文件工具。最多约 9 个正常请求，HTTP 上限取显式预算。公司同事应在允许创建临时 fixture 的项目目录运行。

输出只含结果、配置摘要、平台、预算及脱敏 code/param/message/request-id；不导出 Key、历史会话、仓库正文或 fixture 随机正文。审阅后再分享报告。调用耗费记账保留，取消的未知费用不自动退；不是无成本 doctor。当前开发机只跑 loopback，不能替同事确认公司 Azure、CA 轮换、Entra 长期续期或后台 worker。

## 8. 权限与展示边界修复

Read/Write/Edit/Bash/Grep/Glob 的 deny/ask 别名保守映射到 native 工具，文件/Notebook/Edit 使用路径 subject，不再因为叫法不同忽略拒绝。多文件 apply_patch 在这类别名拒绝/询问下保守整项限制；不会把 legacy allow 自动扩大为新工具权限，原生命名允许规则应明确写出。原执行 allowlist、workspace roots 和保护路径仍生效。

逐行 MessageDisplay 现在只扫描到配置的批次上限，不先创建任意大小的行数组。任何展示替换仍不修改 canonical 历史。

## 发布与剩余

仅所有者本地验证包，未发布 registry、未改个人全局安装、未执行业务 push/PR 或 OS 账户/服务安装。来源权利、NOTICE、重分发批准未提供，发布门禁继续阻止正式发布；不能通过改名或 UNLICENSED 获得授权。请查看剩余清单的具体代码缺口和所需材料，不能把这些都填写成“实现并验收通过”。
