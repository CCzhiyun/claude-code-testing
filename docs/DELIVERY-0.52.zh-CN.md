# CCPT 0.52.0 本地安装与部署验收

这是本地交付候选，不是“全部企业 P0 已生产验收”的声明。普通包不含你的 settings、API key、公司 CA、会话、审计或临时测试文件，也不修改已有用户配置。

## 安装和打开

准备 Node.js 20 或以上。在包所在目录打开 CMD 或 PowerShell：

```powershell
npm install --global --offline --ignore-scripts .\ccpt-0.52.0.tgz
ccpt --version
cd D:\your-project
ccpt
```

包内携带运行依赖 `ws` 和原始许可文件，使用者不需要安装 Bun/TypeScript。`--ignore-scripts` 不影响本包命令入口；源码开发构建另需 Bun 和开发依赖。安装需要你对所选 npm prefix 有写权限；企业机器应使用管理员批准的用户 prefix，不建议为此提升系统权限。

若提示找不到命令，用 `npm prefix -g` 检查 npm 命令目录是否在 PATH，重新打开终端。更新不会覆盖 `用户目录\.ccpt\settings.json`，也不会替你重置旧配置。

## 公司配置：完整 URL、部署名和认证头分别填写

用户配置是 `%USERPROFILE%\.ccpt\settings.json`（复数 settings）；也可用项目 `.ccpt/settings.json`。管理员 managed settings 优先，项目设置可能覆盖用户默认。不要把个人凭据提交到项目 Git 或发给同事。

复制 `docs/settings-responses.example.json` 修改，Azure 原生 Responses 可参考：

```json
{
  "env": { "CCPT_API_KEY": "请只在自己的用户settings填写密钥" },
  "model": {
    "provider": "openai",
    "apiProtocol": "responses",
    "responsesTransport": "native",
    "name": "公司实际部署名",
    "baseUrl": "",
    "endpointUrl": "https://公司网关/完整路径/v1/responses",
    "apiKeyEnv": "CCPT_API_KEY",
    "apiKeyHeader": "api-key",
    "apiKeyPrefix": "",
    "responsesStore": false,
    "thinkingEnabled": false,
    "maxContextTokens": 128000,
    "maxOutputTokens": 8192
  },
  "marketplaceEnabled": false,
  "network": {
    "caFile": "C:/company/certs/ca.pem",
    "rejectUnauthorized": true,
    "timeoutMs": 120000
  }
}
```

这只是模板，URL/模型名/窗口长度必须由公司部署负责人确认，不能照抄占位符。`endpointUrl` 填最终完整端点，避免重复拼 `/responses`。公司若要求 `api-version`，把已确认的查询参数保留在完整 URL 中。如果网关用 Bearer，改 `apiKeyHeader` 为 `authorization`，`apiKeyPrefix` 为 `Bearer `（结尾有空格）；模型名本身不决定认证方式。

`apiKeyEnv` 是**变量名**，不是 key 内容。上述 `env.CCPT_API_KEY` 在个人 settings 中提供值；更安全的方式是删除 `env`，在当前进程/企业秘密管理器中设置同名变量，或用 `credentials set NAME --stdin` 导入 Windows 端点绑定 DPAPI 后端，再配置 `credentialRef`。不要用 `echo 真密钥` 写入命令历史。不要把未设置的 `apiKeyEnv: "dev"` 当作 key；空值也不能绕过公司端点的认证要求。

保留其他协议时使用独立模板/文件：

- 原生 Responses：`settings-responses.example.json`，`apiProtocol: "responses"`。
- Chat Completions：`settings-chat-completions.example.json`，`apiProtocol: "chat-completions"`；有工具/reasoning 组合限制的部署明确设 `chatToolReasoning: "none"` 或 `"omit"`，不要试错切协议/换路径发送密钥。
- Messages：`settings-messages.example.json`，`apiProtocol: "messages"`。

GLM 支持 Chat 不代表当前服务器支持原生 Responses；只有明确需要适配时才设 `responsesTransport: "chat-completions"`，报告会显示实际 wire protocol，不冒充原生验证。切换文件不会自动更改公司部署能力。

CA 也可由既有 `CCPT_CA_FILE` / `NODE_EXTRA_CA_CERTS` 环境入口提供（具体优先级见公司配置指南）；不要关闭 TLS 验证。代理使用 `network.proxyUrl`，mTLS 用 `network.clientCertFile`/`clientKeyFile`，私钥仅放本机受控路径。嵌入公开 CA 必须由授权人员审核并用 `npm run build -- --ca-file <public-ca.pem>` 重建，私钥/密钥/pfx 不得打包。

## 一次运行部署协议验收

先做不花模型调用的静态检查：

```powershell
ccpt doctor
```

真正验收当前部署：

```powershell
ccpt model acceptance --confirm --diagnostics --timeout 20000
```

它最多产生 **7 次可能计费的模型请求**，每阶段单独超时，遇错立即停止，不自动回退其他协议：普通聊天 1 次、多轮 2 次、完整内置 schema 加固定安全 echo 回传 2 次、文本流 1 次、流取消 1 次。实际用量/成本取决于公司部署，完整 schema 会占输入 token；仍受现有权限和预算约束。

不发送仓库文件、项目规则、Skills、MCP、插件或当前聊天，不执行模型生成的 shell/文件操作；只允许预设 echo，其他工具调用即失败。当前会话与 settings 不修改，但现有费用/预算元数据可能记录。Ctrl+C 停止当前请求和后续阶段。`--timeout` 是每阶段总时限，不是每条 HTTP 的额外重试时限。

报告保留脱敏后的 code/param/message/request-id。模型原文不会直接输出；分享前仍须人工检查。终止流通过客户端取消观测，不代表服务端一定停止计费。该命令不能代替后台 worker、真实 Agent 文件变更、公司代理/证书轮换、Entra 续期、跨机器配额和长期负载验收。

## 本地包校验

交付目录含 `SHA256SUMS.txt`、本说明和 npm `.tgz`。可以运行 `Get-FileHash .\ccpt-0.52.0.tgz -Algorithm SHA256` 比对。哈希用于发现文件变化，不是发布者数字签名。

源码 checkout 可复验：

```powershell
npm run verify:package -- <包路径>
bun scripts/verify-packed-types.ts <包路径>
```

前者在全新临时 prefix、空缓存中离线 npm 安装，并执行 npm 生成的真实命令 shim；不会改真实全局安装。后者检查严格 Node TypeScript 消费者与 SDK ESM 导入。包内完整文档仍可在安装目录 `docs/` 阅读。

安装验证还运行已安装包的 SDK 文本流、实际临时文件读取/工具结果回传、后台 worker 和显式 Chat 适配；仅使用本机 loopback 模型 fixture，不访问公司或公共模型。首次打包回归发现 Windows 间歇性文件占用：本版对 JSON 读取、临时文件写入/清理增加最多 8 次有界共享冲突重试，权限错误最终仍会抛出，不退回默认配置。Plan 临时夹具清理也改用已校验目标路径的重试清理，不忽略失败。

0.52.0 修复后全量回归：**523 项通过、0 失败，99 个测试文件**；类型检查、构建、编译后的部署验收命令/HTTP MCP、实际 npm 包的离线安装与命令 shim、已安装 SDK/真实临时文件工具/后台 worker、严格 Node TypeScript 类型解析通过。测试没有访问公司端点，也没有修改你的真实全局安装或个人 settings。原始报告在源码目录 `.ccpt/delivery-052/final/`。

## 仍未完成的外部条件

OS 级隔离与逃逸矩阵、全平台专用凭据后端、企业 Azure/CA/代理/mTLS/Entra/后台 worker 真机矩阵、真实 tokenizer/精确多模态计数/1M 大仓基准、完整 MCP/团队插件互操作、IDE 远程/多窗口，以及已授权的真实 push/PR 等仍需对应环境或专项实现，不能因打包完成而销项。独立 GET SSE 交互、URL elicitation、自动 POST 续传与完整嵌套人工审批尚不在已实现子集内。

来源权利、旧品牌兼容层清理、正式 NOTICE 和第三方再分发授权仍未完成。保留 `prepublishOnly` 发布拦截，未向 npm registry 发布。这个包仅交给当前所有者做本地验证；在授权审查通过前不要对外或向团队分发。`ws` 许可随依赖保留，不代表整个项目的来源权利问题已解决。历史细项见 [剩余清单](REMAINING-0.50.zh-CN.md)。
