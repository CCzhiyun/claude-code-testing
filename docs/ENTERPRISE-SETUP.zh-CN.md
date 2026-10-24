# CCPT 0.39 企业接入指南

组员首次安装、公司 CA 和模型配置的最短流程见 [公司模型与 CA 启动说明](COMPANY-MODEL-QUICKSTART.zh-CN.md)。与参照 CLI 的当前差距见 [0.39 差距审计](REFERENCE-PARITY-GAPS-0.39.zh-CN.md)。

## npm 安装与启动

开发者构建需要 Bun；使用者只需要 Node.js 20+ 和 npm，不需要 EXE、Bun 或源码：

```cmd
npm install --global C:\path\to\ccpt-0.39.0.tgz
ccpt --version
ccpt
```

安装后直接在 CMD、PowerShell 或 Windows Terminal 中运行 `ccpt`。组员可以安装共享的 tgz，或由管理员发布到内部 npm registry 后安装对应包名。本版本未发布到公共 npm，不要把公共仓库上的同名包视为本项目。

## Settings 操作

进入 `/config` 的 Settings 页签，输入文字搜索设置，Enter 进入列表，Space 修改。文本项进入编辑器：Ctrl+U 清空、Backspace 删除、Enter 暂存、Esc 丢弃本次编辑；回到列表再 Enter 保存，Esc 退出则丢弃全部未保存修改。

新增项：

- Marketplace enabled
- Custom CA certificate file (PEM)
- API protocol：`messages` / `chat-completions`
- API connection preset：Azure / Chat Completions 与 Messages API 整套切换
- API authentication header：`authorization`（Bearer）/ `api-key` / `x-api-key`（后两者不带前缀）
- API key environment variable：填变量名，不填密钥
- Complete API endpoint URL、API base URL
- Completion token limit field：`max_tokens` / `max_completion_tokens`
- Default model / Azure deployment

TUI 保存到当前项目 `.ccpt/settings.json`。希望所有项目默认使用同样的配置，可用下面带 `--global` 的命令，写入用户目录 `.ccpt/settings.json`。项目配置可以覆盖全局默认；管理员托管配置优先级最高。

### 选择整套 API 接入方式（0.38）

在 `/settings` 搜索 `API connection preset`，Space 切换预设，然后设置 `Complete API endpoint URL` 和 `Default model / Azure deployment`，最后 Enter 保存。预设同时设置协议、鉴权头、密钥环境变量名、输出限制字段，关闭默认思考/加速扩展参数。它会清空旧 URL 和自定义鉴权映射，避免跨服务发送凭据；未填新 URL 时拒绝保存，保留草稿供继续编辑。Esc 取消不改变配置。不自动试探服务、不自动转发失败请求至另一家。

CLI 等效操作（替换占位 URL 与部署名）：

```cmd
set "AZURE_OPENAI_API_KEY=your-key"
ccpt config set --global --api-preset azure-openai --endpoint-url "https://gateway.example.com/v1/chat/completions" --model your-deployment
```

或选择 Messages 协议：

```cmd
set "CCPT_MESSAGES_API_KEY=your-key"
ccpt config set --global --api-preset messages --endpoint-url "https://gateway.example.com/v1/messages" --model your-model
```

Messages 预设使用 `x-api-key`；需要 Bearer 的兼容网关可追加 `--api-key-header authorization`。Azure 默认 `api-key`、`max_completion_tokens`；旧网关可追加 `--token-field max_tokens`。`API protocol` 项只调整协议，保留地址和鉴权，适合需要手动精细配置的网关。

手写 settings 的 Azure 例子（用户级放在 `%USERPROFILE%\.ccpt\settings.json`，项目级放在项目 `.ccpt/settings.json`）：

```json
{
  "marketplaceEnabled": false,
  "model": {
    "provider": "compatible",
    "apiProtocol": "chat-completions",
    "endpointUrl": "https://gateway.example.com/v1/chat/completions",
    "name": "your-deployment",
    "apiKeyEnv": "AZURE_OPENAI_API_KEY",
    "apiKeyHeader": "api-key",
    "apiKeyPrefix": "",
    "completionTokenField": "max_completion_tokens",
    "thinkingEnabled": false,
    "fastMode": false
  },
  "network": { "caFile": "C:\\Corporate Certificates\\ca.per" }
}
```

若手写切换为 Messages，使用 `apiProtocol: "messages"`、对应 `/v1/messages` 地址、`apiKeyEnv: "CCPT_MESSAGES_API_KEY"`、`apiKeyHeader: "x-api-key"`、`completionTokenField: "max_tokens"`。显式 `apiProtocol` 决定请求、工具格式、JSON/SSE 响应解析，优先于旧 `provider` 字段。

## 关闭 Marketplace

```cmd
ccpt config set --global --marketplace disabled
```

关闭后不启动目录初始化、自动刷新或插件更新；手动添加市场、从市场安装和更新也会被拒绝。已安装本地插件、Skills、Agents 保留且仍可使用。不是卸载插件，也不是关闭所有网络；模型、MCP 和已有插件仍按各自权限运行。切换时已发出的网络请求不保证撤销，下一次操作会检查最新配置。重新开启可将 `disabled` 改为 `enabled`；重新启动 CLI 后恢复自动更新调度。

## 企业 CA 证书

三种配置入口均可用，证书必须已存在于本机：

```cmd
set "CCPT_CA_FILE=C:\Corporate Certificates\ca.per"
ccpt
```

或 settings 文件：

```json
{ "network": { "caFile": "C:\\Corporate Certificates\\ca.per" } }
```

也支持 `{"env":{"CCPT_CA_FILE":"C:\\Corporate Certificates\\ca.per"}}`，以及已有的 `NODE_EXTRA_CA_CERTS` 环境变量。推荐明确使用 `network.caFile` 或 `CCPT_CA_FILE`。实际进程环境优先于 settings.env 的同名默认值；应用 CA 路径优先级为：托管 `network.caFile` → 项目 `network.caFile` → 用户 `network.caFile` → `CCPT_CA_FILE` → `NODE_EXTRA_CA_CERTS`。环境默认值每次重新加载配置时解析。settings.env 不会让已启动 Node 进程重新加载其全局根证书，只影响 CCPT 共享网络层。修改父终端环境后需重启 CLI 才能继承新值。

```cmd
ccpt config set --global --ca-file "C:\Corporate Certificates\ca.per"
```

`.per`、`.pem` 等后缀均可，实际内容必须是 PEM 格式的 X.509 证书，可包含一条证书链。不要选择私钥文件。使用绝对路径；证书内容不会复制到配置文件。私有 CA 追加到公共信任根，TLS 验证保持开启。共享网络层中的模型请求、HTTP MCP 等使用该设置；插件自行运行的 Git/npm/其他程序并不自动继承这套 CA，需单独配置其企业网络。

取消自定义 CA：

```cmd
ccpt config set --global --clear-ca
```

清空后恢复运行时默认信任设置；已由启动环境配置的系统证书机制不受此命令控制。

## Azure / 企业 Chat Completions

公司提供完整地址时原样填写，例如 `/v1/chat/completions`，不会再追加一遍路径。以下占位地址必须替换为公司实际地址：

```cmd
set "AZURE_OPENAI_API_KEY=your-key"
ccpt config set --global --api-protocol chat-completions --endpoint-url "https://gateway.example.com/v1/chat/completions" --api-key-env AZURE_OPENAI_API_KEY --api-key-header api-key --token-field max_completion_tokens --model your-deployment-name
ccpt
```

`set` 是 CMD 当前窗口变量，子 Agent 能继承；新开窗口需重新注入或使用企业凭据管理。PowerShell 中使用 `$env:AZURE_OPENAI_API_KEY = 'your-key'`。密钥不会由这条配置命令写入 settings，仅保存变量名。普通命令工具不会默认继承指定的模型凭据变量；bypass 模式不提供这种隔离。

完整 Azure v1 URL 通常形如 `https://RESOURCE.openai.azure.com/openai/v1/chat/completions`；旧部署地址也可使用完整的 `/openai/deployments/DEPLOYMENT/chat/completions?api-version=...`，查询参数会被保留。`model` 按公司要求填写，通常为部署名。

如公司使用 Bearer token，将 `--api-key-header api-key` 改为 `--api-key-header authorization`，变量中只放原始 token，不包含 `Bearer `。这不自动获取或刷新 Entra ID token，需要公司现有凭据流程提供有效 token。

较新的推理模型可能需要 `max_completion_tokens`；只接受旧参数的网关可改为 `--token-field max_tokens`。`thinkingEnabled`、effort、fast 模式及工具调用是否支持仍取决于部署；平台不会失败后自动重发另一种协议来试探。

## Messages API

```cmd
ccpt config set --global --api-protocol messages --endpoint-url "https://gateway.example.com/v1/messages" --api-key-env COMPANY_MODEL_TOKEN --api-key-header authorization --model your-model
```

协议切换决定请求与流式响应格式，不只是改 URL。Messages 使用其原有输出预算字段，Chat Completions 使用选定的 token 字段。原有配置保持兼容；本次没有改动你现用的 `glm-5.3-flash`、端点或凭据。

标准字段按 [OpenAI Chat Completions 官方接口](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) 核对。Azure 专属资源路径、认证要求和部署支持范围请以公司网关说明为准。

## 验证范围

测试覆盖两种协议的本地请求、流式 Chat Completions、Messages 原有流式解析回归、完整路径/查询参数、两种鉴权头、后台 Agent 凭据传递、Marketplace 禁用、真实 HTTPS 私有 CA 信任、Settings 键盘编辑和全局配置落盘。未连接你的公司 Azure 实例；需要实际地址、可访问的证书文件和你在本地设置的凭据才能完成公司环境验收。
