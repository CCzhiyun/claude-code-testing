# CCPT 公司模型与 CA 启动说明

本文面向直接使用 npm 安装包的组员。使用者只需要 Node.js 20+，不需要 Bun、源码或 Windows EXE。

## 1. 向公司管理员确认六项信息

开始前先拿到以下信息，不要靠客户端自动试探：

1. CCPT 的内部 npm 包或共享 `ccpt-0.40.0.tgz` 路径。Azure Responses 的配置见 [0.40 专项指南](AZURE-RESPONSES-0.40.zh-CN.md)。
2. 公司模型的完整 HTTPS 地址。
3. 模型名或 Azure deployment 名。
4. 接口协议：`chat-completions` 或 `messages`。
5. 鉴权方式：`api-key`、`x-api-key` 或 `Authorization: Bearer`。
6. 企业根/中间 CA 的 PEM 文件路径，以及实际上下文窗口和最大输出 token。

CA 文件可以叫 `.pem`、`.cer` 或 `.per`，后缀不重要；内容必须是一个或多个 PEM X.509 证书，不能包含私钥。

## 2. 安装与确认命令

从共享 tgz 安装：

```cmd
npm install --global "C:\CompanyShare\CCPT\ccpt-0.40.0.tgz"
ccpt --version
```

预期版本为 `0.40.0`。公司内部 npm registry 发布后，可改为管理员给出的包名与版本：

```cmd
npm install --global ccpt@0.40.0 --registry https://npm.company.example/repository/npm/
```

上述 registry 地址只是格式示例，必须换成公司地址。npm 自身访问内网 registry 所需的 CA、代理和登录由公司的 npm 配置负责；CCPT 的 `network.caFile` 不会替 npm 或 Git 配置证书。

## 3. 在当前终端注入凭据和 CA

推荐让公司的凭据管理工具在启动终端时注入 token。不要把真实 token 写进 settings、命令历史、Skill、Agent 或项目仓库。

CMD：

```cmd
set "COMPANY_MODEL_TOKEN=replace-with-runtime-secret"
set "CCPT_CA_FILE=C:\Company PKI\root-chain.pem"
```

PowerShell：

```powershell
$env:COMPANY_MODEL_TOKEN = 'replace-with-runtime-secret'
$env:CCPT_CA_FILE = 'C:\Company PKI\root-chain.pem'
```

这些变量只在当前终端及其子进程中生效。关闭终端后消失，更适合由公司登录脚本、Vault 或 CI secret 注入。不要用 `setx` 长期保存模型 token。

CA 也可以持久保存路径（只保存路径，不复制证书内容）：

```cmd
ccpt config set --global --ca-file "C:\Company PKI\root-chain.pem"
```

程序会在保存前解析证书；路径不存在、内容不是 PEM 证书或包含私钥时会拒绝。TLS 验证保持开启，公司 CA 会追加到公共信任根。也可使用 `NODE_EXTRA_CA_CERTS`，但推荐 `CCPT_CA_FILE` 或 `network.caFile`，语义更清楚。

## 4. 选择且只选择一种模型协议

### 方案 A：公司 Azure/OpenAI 兼容 Chat Completions

完整 URL 已包含 `/v1/chat/completions` 时，使用 `--endpoint-url`，客户端不会重复追加路径：

```cmd
ccpt config set --global ^
  --marketplace disabled ^
  --api-protocol chat-completions ^
  --endpoint-url "https://model-gateway.company.example/v1/chat/completions" ^
  --model "glm-5.3-flash" ^
  --api-key-env COMPANY_MODEL_TOKEN ^
  --api-key-header api-key ^
  --token-field max_completion_tokens ^
  --max-context 1000000 ^
  --max-output 8192
```

上例的 URL 和 token 上限都是占位/示例，必须采用公司模型说明。如果网关要求 Bearer token，把鉴权项改为：

```cmd
--api-key-header authorization
```

客户端会自动添加 `Bearer `，环境变量中只放原始 token。如果网关要求 `x-api-key`，填写 `--api-key-header x-api-key`。如果服务只接受旧输出字段，把 `--token-field` 改成 `max_tokens`。

### 方案 B：公司 Messages 兼容接口

```cmd
ccpt config set --global ^
  --marketplace disabled ^
  --api-protocol messages ^
  --endpoint-url "https://model-gateway.company.example/v1/messages" ^
  --model "glm-5.3-flash" ^
  --api-key-env COMPANY_MODEL_TOKEN ^
  --api-key-header authorization ^
  --token-field max_tokens ^
  --max-context 1000000 ^
  --max-output 8192
```

协议决定请求体、工具调用及 JSON/SSE 响应解析，不能只改 URL。填写 `1000000` 不会让不支持 1M 的模型自动扩容；必须填公司部署实际支持的窗口。若服务端报告更小窗口，0.39 会在当前 Agent 内降低窗口、归档旧历史并有限重试，但不会改写全局配置。

## 5. 使用 JSON 配置（适合管理员分发）

用户默认配置位于 `%USERPROFILE%\.ccpt\settings.json`，项目配置位于 `<项目>\.ccpt\settings.json`。项目覆盖用户默认，企业托管配置优先级最高。

Chat Completions 示例：

```json
{
  "marketplaceEnabled": false,
  "model": {
    "provider": "compatible",
    "apiProtocol": "chat-completions",
    "endpointUrl": "https://model-gateway.company.example/v1/chat/completions",
    "name": "glm-5.3-flash",
    "apiKeyEnv": "COMPANY_MODEL_TOKEN",
    "apiKeyHeader": "api-key",
    "apiKeyPrefix": "",
    "completionTokenField": "max_completion_tokens",
    "maxContextTokens": 1000000,
    "maxOutputTokens": 8192,
    "thinkingEnabled": false,
    "fastMode": false
  },
  "network": {
    "caFile": "C:\\Company PKI\\root-chain.pem",
    "rejectUnauthorized": true,
    "allowedHosts": ["model-gateway.company.example"]
  }
}
```

settings 只保存环境变量名 `COMPANY_MODEL_TOKEN`，绝不能把实际值写入 `env` 或其他字段。`allowedHosts` 非空时是网络目标白名单；如果公司还使用外部 MCP，需要把批准的 MCP 主机分别加入。

管理员可通过 `CCPT_MANAGED_CONFIG` 指向只读托管 JSON；项目和用户设置不能覆盖随后应用的托管策略。Windows Registry、macOS managed preferences 和 Linux managed file 也有接入层，但仍应先在企业镜像中验证优先级及更新流程。

## 6. 启动和界面配置

切换到项目目录再启动：

```cmd
cd C:\work\your-project
ccpt
```

首次进入确认工作区信任。之后可输入：

```text
/config
/status
/context
```

`/config` 中输入字段名过滤，Enter 进入列表，Space 编辑，Enter 暂存，再按 Enter 保存。常用字段：Custom CA certificate file、API protocol、API authentication header、API key environment variable、Complete API endpoint URL、Default model、Maximum context tokens、Maximum output tokens、Marketplace enabled。

修改父终端环境变量、CA 或模型连接后，关闭并重新启动 CCPT。先发送一个不要求工具的短问题确认聊天，再在测试仓库验证读文件、写文件和命令审批。不要用生产仓库作为第一次联调环境。

## 7. 故障定位

| 现象 | 检查 |
|---|---|
| `credential environment variable is not configured` | 变量名配置是否正确；token 是否注入到启动 CCPT 的同一个终端 |
| `unable to verify the first certificate` / `self signed certificate` | CA 路径是否存在；是否是完整 PEM 根/中间链；重启 CLI |
| 401 / 403 | header 是 `api-key`、`x-api-key` 还是 Bearer；变量中不要重复写 `Bearer ` |
| 404 | 完整 endpoint 路径与 Azure `api-version` 查询参数是否正确 |
| `max_tokens` 参数错误 | 在 `max_tokens` 与 `max_completion_tokens` 间按公司网关要求切换 |
| 上下文超限 | `/context` 查看估算；降低输出预留、减少工具/Skills、执行 `/compact`，或填写真实支持的窗口 |
| npm/Git 仍然证书失败 | 分别配置 npm/Git 的 CA；CCPT CA 只控制共享 HTTP/TLS 网络层 |
| MCP 连接失败 | `/mcp` 打开详情后按 `t`，确认后执行发现；检查主机白名单、CA、token 与 direct/streamable 模式 |

安全提醒：0.40 的 `config show` 对 settings.env、凭据字段、URL 凭据和已知环境密钥增加脱敏。公司环境仍不应把 token 写进 settings，也不要未经检查把配置输出粘贴到工单或聊天。

## 8. 升级前配置检查结果（2026-09-22）

- CCPT：0.39.0。
- 模型：`glm-5.3-flash`。
- 当前协议：Messages。
- 模型端点：已配置。
- 模型凭据环境变量：当前进程可见。
- TLS 验证：开启。
- CCPT 专用 CA：未配置，因此尚未验证公司证书链。
- Marketplace：仍开启。

此配置检查没有输出 token 或证书路径。0.40 增加的 GLM 两协议真实验证和 Responses 路径 404 记录见专项指南；仍未向公司内网接口发送请求。按公司要求配置 CA 和 Marketplace 后再完成企业连通验收。
