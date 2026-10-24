# CCPT 0.70：MCP、插件、上下文质量优先交付

准确构建、完整测试与 npm 安装结果见包旁 VALIDATION/evidence。本版补可验证代码，并提供目标环境验收入口；不将本机 loopback 等同于公司服务器、真实团队来源或 1M 语义质量验收。完整边界见 [REMAINING-0.70.zh-CN.md](REMAINING-0.70.zh-CN.md)。

## 安装

```powershell
npm install --global .\ccpt-0.70.0.tgz
ccpt --version
ccpt
```

不生成产品 EXE，不修改个人 settings 或实际 global prefix。继续使用 `%USERPROFILE%\.ccpt\settings.json` 和项目 `.ccpt/settings.json`，保留公司部署名、URL、Key、CA/代理/mTLS。没有自动换模型、切协议、降级 TLS 或调用公司地址。

## 一、MCP

### 1. 真正的 SSE retry 与安全续传

SSE decoder 支持只有 retry 字段的控制帧、跨 chunk CRLF、零间隔与无效数字处理。POST SSE 的续传仍只用 GET + Last-Event-ID，不重发 tools/call；现在遵守服务端 retry，最多两次 GET，可恢复一次暂时的 502/503/504/连接故障。认证/会话失效及格式错误不当成可重放许可。

独立 GET watcher 同样遵守服务端 retry，不会因为本地 backoff 较小而提前重连。服务端要求的等待超出总时限时，不提前发请求；总时限和取消仍能中断等待。重连不是审批继承，不会重复自动执行服务器工具。

依据：[MCP 2025-11-25 Transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)。旧的 stdio、双审批、URL 同意、POST 游标续传、sampling/elicitation、OAuth 与审计链保留。

### 2. 目标服务器只读验收

```powershell
ccpt mcp acceptance team --confirm --max-requests 8 --timeout 20000
```

当前 trusted workspace 的配置服务器，一次会话完成 ping、分页 tools/resources/prompts catalog、工具 schema 检查、重复身份/游标检查。返回目录数量与摘要，不导出目录正文；optional resources/prompts 的 -32601 明确标 unsupported，不当作空的成功实现。缺 items 等非法工具定义会失败。

`max-requests` 限制探测 RPC，不含 initialize/initialized/DELETE 及必要的认证调用；总时限上限 120 秒。没有 tools/call、读取资源正文、取得 prompt 内容、模型请求、浏览器启动或审批自动接受。stdio 会启动真正的服务器进程，仍需工作区信任、明确确认、命令策略与 Hooks；“只读探测”不证明任意外部服务器内部绝无副作用。

反向 sampling/elicitation 的真实业务场景仍需公司服务器实际发送请求，用既有 `mcp call/watch ... --interactive` 逐项批准并核验取消/超时；catalog 验收不能替代这些测试。

### 3. 管理员可部署的集中审计 collector

新增 `createAuditCollectorServer` SDK 工厂和前台 CLI。每个 stream 单独授权 Bearer token 环境变量；签名私钥在服务端本地文件中，不通过 HTTP 上传。TLS 默认必需，可配客户端 CA 与 mTLS。仅明确开发选项允许 HTTP，且同时检查 socket 本地和远端地址都是 loopback；拒绝浏览器 Origin。

管理员配置示例（路径必须替换为真实绝对路径）：

```json
{
  "administratorControlledStorage": true,
  "storageDirectory": "D:\\audit-collector\\receipts",
  "signingKeyFile": "D:\\audit-secrets\\ed25519-private.pem",
  "keyId": "audit-team-v1",
  "streams": {"team": {"tokenEnv": "CCPT_AUDIT_TEAM_TOKEN"}},
  "tls": {
    "certFile": "D:\\audit-secrets\\server-chain.pem",
    "keyFile": "D:\\audit-secrets\\server-private.key",
    "caFile": "D:\\audit-secrets\\client-ca.pem",
    "requireClientCert": true
  }
}
```

Token 16–8000 字符，不允许空白；环境变量缺失/失效时拒绝访问，不回退匿名。私钥需要 Ed25519；POSIX 私钥须 owner-only，Windows ACL 由管理员配置。配置和签名/TLS 私钥不打入 npm 包。

```powershell
ccpt audit-collector serve --collector-file D:\ops\collector.json --port 8443 --confirm
```

CLI 仅绑定 loopback，前台退出即停止，不注册 OS 服务。远程部署应由管理员用经过审阅的 TLS 网关或 SDK 的 server.listen 接入专用主机，并配置真实认证、访问控制、备份及 key custody。工厂不自动 listen。

服务实现 `/checkpoints` POST/GET，严格限制方法/查询、每流授权、请求正文 800000 bytes、并发 32、最多 128 个 IP 槽/每分钟 120 请求、header/请求超时。POST 在写入前校验 Idempotency-Key，重复提交返回同一 Ed25519 receipt，拒绝分叉/回退。错误不回显源正文/私钥。现有 `audit-checkpoint publish|query --collector-file ... --confirm` 客户端可直接互操作；客户端 collector URL 为根 base URL，自动追加 /checkpoints。

传输的是 HMAC anchors，不是审计正文，不传客户端 HMAC Key。客户端以 pinned Ed25519 公钥校验收据并检查回退；不确定 POST 先 query，不自动重发。服务端是可运行的认证接收服务，但不是 WORM、HSM、不可变对象存储或企业 collector 上线批准；这些仍由基础设施实现与实机验证。

## 二、插件

### 1. 被撤销/损坏的 active generation 可修复

以前普通 rollout 会重新验证旧 active generation；旧 key 已撤销或旧内容损坏时，普通 preview 无法继续。新增专门修复路径，不执行旧插件，不删旧内容，也不降低新候选验证：

```powershell
ccpt plugin-set health
ccpt plugin-set remediation-preview pluginset_TRUSTED_CANDIDATE
ccpt plugin-set remediate pluginset_TRUSTED_CANDIDATE --expected-digest REVIEW_SHA256 --confirm
```

仅当前代际不可信时使用；可信当前版本仍走普通 rollout。替代代际必须逐字节校验 artifact/receipt/overlay/lock，并具有当前受信任、未撤销的 publisher 签名，即使常规配置原本允许 unsigned 也不放松。配置了 pluginRollout 时继续限制精确渠道版本和移除政策；无法建立旧名称且禁止移除时拒绝猜测。

审批绑定当前 pointer、候选 digest 与全部有效配置。并发 CAS 一个胜者；配置/候选/指针变化需重新审阅。旧插件字节保留以供管理员调查，不自动执行/恢复。签名不等于来源权利，修复不代替发行商身份核实。

### 2. 插件读取限额

加载 manifest/贡献前先验证 canonical 非链接目录树。流式遍历拒绝 links/junctions、非普通文件、大小写冲突；深度 16、entries 5000、单文件 16 MiB、合计 128 MiB。digest 读取时再次计实际字节，防止盘点后增长绕过上限；不先把任意大目录全部读入数组。

这是资源保护与摘要完整性，不是抵御恶意同 OS 身份进程的 openat/只读挂载安全边界；大型合法插件需拆分后按签名代际发布，不能静默跳过文件。

## 三、上下文质量

### 1. 原生 Responses 服务端输入计数

合并以下片段到现有 settings，保留原模型/URL/凭据。仅用于实际支持原生 Responses input_tokens 的部署：

```json
{
  "model": {
    "apiProtocol": "responses",
    "responsesTransport": "native",
    "inputTokenCounting": {"mode": "responses", "onError": "stop", "timeoutMs": 10000}
  }
}
```

按 [OpenAI token counting 文档](https://developers.openai.com/api/docs/guides/token-counting)，向同一 `/responses/input_tokens` 发完整 input、instructions、tools、reasoning/text 等受支持字段；保留 api-version 查询、同一身份、CA、代理和 mTLS。不会自动下载图片、换地址或回落 Chat。使用 generation 同一序列化，保留合法的 opaque Responses items；启用计数时不使用 previous_response_id 链，以完整输入重现计数。

Agent 用服务端 `input_tokens` + 输出/安全预留决定 ≥90% 提醒、>95% 压缩。压缩后重新计数，快照显示 provider 来源/请求摘要，分段和预留仍标估算。计数接口先报上下文超限时，同样先归档、压缩旧完整轮次，再有界重计，不关闭对话或截断当前轮次。不能压缩时给出可继续操作的错误，历史仍保留。

不是所有 Responses 兼容网关（包括私有部署）都提供此路由。默认 stop 保留错误，不暗中猜协议；明确选择 `onError:"estimate"` 才允许带 estimate-fallback 标识的本地估算。取消、预算耗尽及执行边界撤权不被当作降级许可。单次 count deadline 100–30000ms，payload 最多 32 MiB，无自动重试。

设 `inputTokenCounting:null` 可明确关闭。切换 API preset 时会清空此部署能力，避免把原生计数配置带进 Chat/Messages 或另一个未知部署；新部署需要重新显式启用。

计数也是 HTTP 请求：遵守共享 RPM/TPM 等待/取消规则（不自动重试），占共享 request 额度，按计数值/配置费率保守占 input token/成本预算，不宣称该接口实际按生成价格收费。失败未知预留保留；usage 的生成回报与保守预算账本不应混为实际账单。没有原生接口时，原本的私有 BPE/framing 仍可用。

### 2. 摘要关键事实门禁

```json
{
  "contextCompaction": {
    "mode": "semantic", "maxInputTokens": 32000, "maxOutputTokens": 1500,
    "quality": {"requiredTerms": ["src/payment.ts", "PAYMENT_ID", "tests failed"], "minimumCoverage": 1}
  }
}
```

配置 1–64 个真实、非敏感、≤256 字符的关键 literal anchors。只要求源归档/旧 summary 里确实出现的项，不把无关新 terms 强塞给模型。Windows 路径按原字符串核对，不因 JSON 转义漏检。候选 semantic handoff 未达覆盖率时保留已持久化 extractive checkpoint，记录 quality-gate 与 missing hashes，不冒称语义摘要成功。通过的结果同样记录覆盖数据。

摘要请求省略图片、音频和隐藏推理，使用明确 no-tool 上下文，不继承父调用的 required tool choice；长度检查使用所配置 BPE（未配置时估算）。所有原始轮次仍在 archive，当前工具轮次保持精确。literal 覆盖不是事实正确、语义等价或零信息损失证明，extractive fallback 仍可能没有带上所有需要的细节。

### 3. 代表性语料的真实模型评测

创建经过授权可发送给所选模型的 JSON fixture：

```json
[
  {"id":"payment","source":"Architecture: PAYMENT_ID lives in src/payment.ts. tests failed; not released.","requiredTerms":["PAYMENT_ID","src/payment.ts","tests failed","not released"]}
]
```

```powershell
ccpt context-eval --fixture .\cases.json --confirm --max-requests 4 --max-tokens 16000000
```

读取需 trusted workspace、workspace/protected-path 和 read_file 权限；deny/ask 不因诊断而绕过。显式确认才共享 fixture 原文给当前部署，可能计费；不自动采集全仓、使用聊天历史、换 endpoint、执行工具或写业务文件。1–16 cases，每 case ≤8 MiB，总文件 ≤16 MiB；本次请求/token 上限同时收紧已有共享预算，不逃逸父作用域。

报告只包含 case ID、源文件摘要、sourceBytes、耗时、provider 回报的 input/output tokens（若有）、生成 summary 哈希、required/preserved/coverage/missing hashes 与预算；不导出源/摘要正文。失败报告不反射 provider 原文，避免把源片段通过错误回显。它允许同事放入真实大仓/长对话语料，测实际部署的保留质量，不将重复文本吞吐当语义评测。真正 1M 能力和质量必须由实际部署+代表性语料的报告证明；本地 fixture 不能替代。

## 交付限制

本机自动化与实际 Node 进程验证包括 collector 的私有 CA TLS/mTLS、真实签名代际修复、MCP 重连/目录和 native count/质量门禁。公司模型请求为 0，未注册 OS 服务、业务 push/PR、发布 registry 或覆盖旧包。其余平台未因本轮优先项自动标完成；团队分享/正式发布仍受来源权利、NOTICE 与重分发门禁约束。
