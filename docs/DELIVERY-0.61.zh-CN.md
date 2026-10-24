# CCPT 0.61：恢复修复与安全能力增量

本版修复 V060-A1-01，并补充独立签名 overlay、MCP 显式 GET 人工交互/有界嵌套/可选 POST SSE 续传、原生凭据后端、审计完整性和二进制/删除冲突暂存。没有宣称九个企业领域全部完成。

## 修复：直接恢复 Goal

`ccpt goal-run recover ID --expected-version N` 不再要求先执行 `agents`。

- 只核对该 Goal 绑定的 cwd/session/Plan/run 执行者，不刷新或改动其他 Agent。
- 在 Agent 锁内重新读取；只有 OS 明确报告 PID 不存在，或未启动队列超过启动时限，才认定执行者已经中断。活 PID 的过期 heartbeat 不足以授权恢复；探测失败也不当作已退出。
- Agent 记为失败、执行中 Plan 转失败、Goal 转 unknown；原会话和预算保留，不重放。
- 后续仍须人核验外部效果，再用明确的 `--verified-unknown --feedback ... --confirm` 准备续行；准备不等于启动，仍要单独 `start --confirm`。
- 保留 CAS。并发恢复只有一个版本获胜。

## 安装与公司模型配置

本地候选包通过审核后，可使用 `npm install -g <实际 ccpt-0.61.0.tgz 路径>`，再在项目目录运行 `ccpt`。无需 Windows EXE。本轮不向 npm registry 发布，也不修改真实全局安装。

公司同事配置自己的用户目录 `.ccpt/settings.json`，部署名和精确 URL 由公司提供，不能默认猜成某个公开模型别名：

```json
{
  "model": {
    "provider": "openai",
    "apiProtocol": "responses",
    "responsesTransport": "native",
    "name": "YOUR_COMPANY_DEPLOYMENT",
    "endpointUrl": "https://YOUR_APPROVED_GATEWAY/EXACT_ROUTE/v1/responses",
    "apiKeyEnv": "AZURE_OPENAI_API_KEY",
    "apiKeyHeader": "api-key",
    "apiKeyPrefix": ""
  },
  "network": {
    "rejectUnauthorized": true,
    "caFile": "C:/Company/certs/ca.pem"
  },
  "marketplaceEnabled": false
}
```

这是占位模板，不会自动发请求。若公司网关要求 Bearer，请按公司约定改 header/prefix，不能同时混用两套认证。若是 Chat Completions，则另存部署配置并选择 `apiProtocol=chat-completions` 与精确 `/chat/completions` 地址；不能只换 URL 后保留另一协议的 body。Messages 接口同样独立配置。

Key 从公司 secret manager 注入 `AZURE_OPENAI_API_KEY`；CA 也可通过 `CCPT_CA_FILE` 指定。原有 proxyUrl、clientCertFile/clientKeyFile 配置继续支持；不要关闭 TLS 校验，不要把客户端私钥嵌入包。已有构建命令可嵌入经审批的**公开 CA**，这不等于自动获准分发公司证书。

真实 Azure/CA 链/代理/mTLS/Entra 续期和 worker 验收仍需公司同事执行。loopback、HEAD 和单次问候成功都不是完整 Agent 验收。

## 新增：原生凭据后端

模型设置 `model.credentialBackend`，MCP 设置 `mcpCredentialBackend`：

| 值 | 后端 | 说明 |
| --- | --- | --- |
| windows-dpapi | 既有 Windows CurrentUser DPAPI | 模型默认仍为此值，不静默迁移 |
| macos-keychain | `/usr/bin/security`，默认用户 Keychain | 写入通过文档化 stdin 命令模式，密码先做 base64 封装；不进 argv/environment |
| linux-secret-service | `/usr/bin/secret-tool` / Secret Service | 需要已解锁的用户服务、D-Bus 会话和 helper；headless 服务可能不可用 |

原生后端单项限制 5000 字节，读回校验；平台不匹配、锁定、helper 不存在、超时或异常输出均失败，**不退回 file**。模型仍使用 `credentialRef`，`apiKeyEnv` 必须为空；先选择正确 endpoint 和 backend，再通过 `credentials set NAME --stdin` 写入。模型元数据文件只有 backend/scope 等引用，不含原生 Key。

MCP 原生后端按服务器名分项存储，不把全部 token 合成一个大条目。旧 file/DPAPI 不自动迁移到新后端；重新受控登录/设置，检查后再删除旧存储。`mcp migrate-credentials` 的既有显式迁移仍仅适用于 Windows DPAPI。

这些原生 helper 是独立进程，但不是独立 OS 身份、硬件隔离或“主进程永远看不到秘密”。macOS/Linux 真机及企业 Keychain/Secret Service 策略尚未验收。

## 新增：独立签名 overlay

```text
ccpt plugin overlay-sign ARTIFACT_PATH --json CONTRIBUTIONS_JSON --key-file EXTERNAL_PRIVATE_PEM --key-id OVERLAY_PUBLISHER
```

输出 envelope，由管理员审阅后放进 `settings.pluginOverlays[插件名]`。原 artifact 必须先通过自身 integrity、publisher signature 和当前锁定/撤销规则；overlay 再以独立签名域验证 name/version/artifactDigest/contributes。公钥来自 `pluginTrustKeys`，撤销仍用 `revokedPluginKeys`。

合并是确定性的增补：Skills/Agents 路径限定 artifact 内，commands/hooks 追加，服务器名不可悄悄覆盖已有项；重复命令拒绝加载。原 artifact 字节不变，不能借用 artifact 签名给 overlay 授权。支持新的 `${CCPT_PLUGIN_ROOT}`；旧占位符仅保留兼容，未把第三方版权或历史来源改名抹除。

overlay 本身不是事务，也没有放开 Marketplace 对签名 artifact 的原地覆写。另新增以下版本集机制。

### 插件与收据作为一个不可变版本集切换

```text
ccpt plugin-set stage --json '["./plugin-a","./plugin-b"]' --confirm
ccpt plugin-set inspect
ccpt plugin-set activate pluginset_ID --expected-version 0 --confirm
ccpt plugin-set rollback PREVIOUS_pluginset_ID --expected-version CURRENT_VERSION --confirm
```

`--json` 的 shell 引号按终端调整。先 stage/activate，再设置 `usePluginSets=true`。每代包含所有选定插件及 receipt，单个 CAS active 指针是切换点；不会逐个覆盖活动插件。此模式不读取可变的项目 plugins/plugins-local；已批准的外部插件目录仍可补充，版本集优先。切换会使授权快照与 idle watcher 失效。

只接受 1–32 个本地来源，总计 5000 条目/128 MiB/16 层，不执行插件或自动联网；复制前后摘要、签名、锁定均检查。回滚重新检查**当前**信任/撤销规则，不是恢复过期授权。中断留下的 `.pending-*` 不会自动激活或猜测清理。保留版本和收据是同一代目录，但不声称 fsync 断电持久性、网络文件系统原子性或旧式 Marketplace 原地安装已变成跨资源事务。团队真实插件和中断来源矩阵仍待验收。

## 新增：显式真实文本 tokenizer

可选 `model.tokenizer=cl100k_base` 或 `o200k_base`，使用锁定版本 `js-tiktoken` 的实际 BPE，而不是字符数除以常量。上下文预检、分项、文本预算和本地 TPM 预估使用所选编码；默认维持兼容估算。编码仅在启用时加载，随 npm 包离线携带。

不要根据 GLM/公司私有部署名猜编码，必须由部署方确认；不确认就不要设置。`/context` 会标注 text BPE，同时明确 provider framing/images/billing 仍为估算。对序列化文本做 BPE 不等于线上 wire request 的精确 token，图片/文件尤其不能按 base64 文本计作真实多模态计数。输入限制 16 MiB、连续非空白/空白片段 65536 字符，超限提示缩小输入，不静默截断。没有由此证明 1M 大仓摘要质量或零信息损失。

依赖 `js-tiktoken@1.0.21` 的 npm 元数据标注 MIT；实际许可证/传递依赖仍须纳入发布清单和 NOTICE/来源审查。参照 [OpenAI token counting 边界](https://developers.openai.com/api/docs/guides/token-counting)，本版没有调用付费服务端计数接口。

## 新增：MCP GET 人工交互与续传

```text
ccpt mcp watch SERVER --interactive --max-interactions 8 --timeout 60000
```

- 不带 interactive：仍是只接收通知，sampling/elicitation 不获授权。
- 带 interactive：必须真实 TTY；sampling 需要请求确认和结果分享确认，表单需要人工回答；restricted 拒绝启用。SDK 可提供显式运行时 callbacks，不能从 settings/远端请求伪造批准。
- GET 断线按同 session 的 cursor 重连；重复 event/request IDs 不重复批准。交互数默认 8、可配置 1–32；回调嵌套最多 3 层。取消、超时、撤销分享都不发送生成正文。
- 服务器配置 `resumePostSse=true` 后，工具 POST 的 SSE 中断可用**原端点 GET + Last-Event-ID** 续传，最多两次，仍共享原总 deadline/8 MB/帧边界。无 cursor、会话过期或协议错误不重新 initialize、不重发工具 POST。默认关闭。
- 交互能力仍按当前实现协商的 2025-06-18 开启；不是全部新协议/URL/多模态完整互操作。

## 新增：本地审计完整性

由管理员通过安全环境注入 `CCPT_AUDIT_HMAC_KEY`（32–64 字节的 hex Key），并设置 `CCPT_AUDIT_INTEGRITY=required`。不要在 shell 历史或配置示例中写真实 Key。

```text
ccpt audit
ccpt audit verify --day YYYY-MM-DD
ccpt audit verify --day YYYY-MM-DD --anchor EXTERNALLY_SAVED_TAIL_MAC
```

脱敏后再签链；并发写入加锁，校验序号/previous/MAC。修改、乱序、不完整尾部及错误锚点都会拒绝。每个日期 segment 最多 10,000 行/8 MB，满后要求管理员归档，不静默丢弃。原有未启用完整性时的 JSONL 行为保持。

只验证链、不提供外部锚点，不能检测整个合法尾部被删去。拥有 HMAC Key 的攻击者可重签。**可信集中收集器、外部不可变锚点/硬件密钥和防回滚存储仍未完成**；不要把本地 HMAC 链叫作已经完成的集中防篡改审计。

## 新增：二进制/删除冲突 review → stage

```text
ccpt agents conflict-versions PATH
ccpt agents conflict-review PATH
ccpt agents conflict-stage-binary PATH --expected-version REVIEW_VERSION --confirm
```

先在编辑器/Git 客户端人工决定最终字节或删除，再 review 和显式暂存。review 限 16 MiB，保留原始字节哈希；删除不当作空 blob；路径不跨链接，index/working bytes 变化会拒绝旧版本。文本仍拒绝遗留冲突标记。没有自动选择 ours/theirs、覆盖工作文件、commit/push/PR；也不承诺对外部编辑器并发写入的跨进程事务隔离。

ref 自动保留期、自动远程备份及完整图形化二进制解决器仍缺，真实大仓矩阵未验收。

## 新增：Linux OS 隔离代码与真机探针

可选 `policy.osSandbox=linux-bubblewrap`，要求 Linux 的 `/usr/bin/bwrap` 非用户可写 regular file、内核/企业策略允许 namespace。命令、MCP stdio 和同步 command Hook 经此路径；不支持 detached async Hook，不支持的 OS 或后端直接失败，不退回普通执行。

本版隔离 PID/network 等 namespace、去能力、清环境；只挂载系统二进制/库和专用 workspace，隐藏 `.git`、`.ccpt` 和扫描命中的 protected paths。**网络始终隔离，Git 元数据不可见**，因此不支持依赖宿主网络/凭据或 Git 元数据的这类命令。扫描最多 10,000 条/24 层，超过就拒绝，不能把它当作大仓已可用的生产沙箱。

在受控 Linux 真机上显式执行探针（仅使用自己的临时 sentinel、host loopback 和 heartbeat，不读真实机密）：

```bash
CCPT_RUN_OS_SANDBOX_TESTS=1 bun test test/linux-sandbox-061.test.ts
```

涵盖 workspace 外 sentinel、`.env`、环境凭据、host loopback 和 detached 子进程取消。Windows/macOS 默认 skip；**skip 不计为通过**。这些有限探针不是完整逃逸测试、Windows/macOS backend 或整个 Agent/IDE 的强身份隔离。

## 证据与未完成项

TypeScript、构建、定向测试、完整回归和实际 tgz 安装结果以本版随附 VALIDATION/evidence 为准。局部检查通过不关闭剩余领域。见 [REMAINING-0.61.zh-CN.md](REMAINING-0.61.zh-CN.md)。

实现对照的原始资料：[MCP transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)、[Apple security stdin 模式](https://github.com/apple-oss-distributions/Security/blob/main/SecurityTool/macOS/security.1)、[GNOME secret-tool](https://github.com/GNOME/libsecret/blob/main/tool/secret-tool.c)、[bubblewrap 参数](https://github.com/containers/bubblewrap/blob/main/bwrap.xml)。资料只支持具体接口约定，不证明本实现通过目标环境验收。
