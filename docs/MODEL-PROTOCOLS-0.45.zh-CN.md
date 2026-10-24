# 三种模型协议配置（0.45）

CCPT 不需要额外部署一个对话代理。已有三套内部适配器，统一聊天、工具调用、工具结果回传和界面事件。现在通过 `model.apiProtocol` 明确选择，不根据模型名称猜协议，也不在请求失败时偷偷切换接口。

| 接口格式 | `model.apiProtocol` | 完整端点常见结尾 |
| --- | --- | --- |
| Messages 格式 | `messages` | `/v1/messages` |
| Responses 格式 | `responses` | `/v1/responses` |
| Chat Completions 格式 | `chat-completions` | `/v1/chat/completions` |

同一个模型是否开放这三种接口由服务端决定。修改配置不能使仅支持 Chat 的服务自动支持 Responses。公司的模型部署名也必须由管理员提供，安装包不会默认选择某个 GPT 或 GLM 模型。

## 配置文件位置与示例

用户默认配置：`%USERPROFILE%\.ccpt\settings.json`；若设置了 `CCPT_HOME`，则为该目录下的 `settings.json`。项目配置为 `<项目>\.ccpt\settings.json`。项目配置可以覆盖用户配置，企业 managed policy 最后生效。

三份可编辑模板随 npm 包分发：

- [Messages](settings-messages.example.json)
- [Responses](settings-responses.example.json)
- [Chat Completions](settings-chat-completions.example.json)

请填入真实的 endpoint、部署名、密钥环境变量名。模板的上下文 128000 / 输出 8192 只是示例，必须按实际部署调整。模板没有密钥、CA 文件或公司内部网址。

例如公司 Responses 配置的核心部分：

```json
{
  "model": {
    "apiProtocol": "responses",
    "name": "YOUR_COMPANY_DEPLOYMENT",
    "baseUrl": "",
    "endpointUrl": "https://gateway.example/responses/v1/responses",
    "apiKeyEnv": "AZURE_OPENAI_API_KEY",
    "apiKeyHeader": "api-key",
    "apiKeyPrefix": "",
    "headersFromEnvironment": {},
    "thinkingEnabled": false,
    "responsesStore": false,
    "responsesTextFormat": null
  },
  "network": {
    "caFile": "C:\\Company\\certs\\ca.pem",
    "rejectUnauthorized": true
  }
}
```

认证方式由网关决定，不由协议决定。需要 Bearer 时设置 `apiKeyHeader: "authorization"` 和 `apiKeyPrefix: "Bearer "`（末尾有空格），密钥只放对应环境变量。需要 Entra 时可由外部凭据流程更新该环境变量；本轮没有新增 Entra 自动刷新后端。

CA 也可通过 `CCPT_CA_FILE` 或 `NODE_EXTRA_CA_CERTS` 提供；显式 `network.caFile` 优先。不要通过关闭 TLS 校验解决证书问题。代理使用 `network.proxyUrl`，mTLS 使用 `clientCertFile` 和 `clientKeyFile`。

`endpointUrl` 是完整地址，保留部署路径和查询参数；优先于 `baseUrl`。建议公司接入使用完整地址。选了 Responses 却提供以 `/chat/completions` 结尾的地址会在本地拒绝，提示修正配置；不自动更改目的地。

## 临时试用与保存默认值

```powershell
# 仅本次运行覆盖，不更改默认文件
ccpt --settings C:\Company\ccpt-responses.json

# 持久化用户默认协议、完整端点和部署名
ccpt config set --global --api-preset azure-responses --endpoint-url "https://gateway.example/responses/v1/responses" --model YOUR_COMPANY_DEPLOYMENT
ccpt config set --global --ca-file "C:\Company\certs\ca.pem"
ccpt
```

可用 `--api-preset`：`messages`、`chat-completions`、`responses`、`azure-openai`（Azure Chat）、`azure-responses`。通用 Chat/Responses 预设使用 `CCPT_API_KEY` + Bearer；Azure 预设使用 `AZURE_OPENAI_API_KEY` + api-key；Messages 预设使用 `CCPT_MESSAGES_API_KEY` + x-api-key。以上都是可修改的预设，不是服务端强制规则。

`/config` 的 API connection preset 可在上述五种预设间选择。更换预设会清空旧地址和旧认证映射，保留模型名及网络配置，因此还必须核对部署名、CA、代理。CLI 更换预设必须同时给出新地址。直接编辑 `apiProtocol` 只改变协议，不自动清理其他字段；切换到另一服务应使用完整模板或预设，避免继承旧的认证头。

可把 [settings.schema.json](settings.schema.json) 复制到 settings 旁，并在 settings 顶层增加 `"$schema": "./settings.schema.json"`，获得支持 JSON Schema 的编辑器提示。它覆盖模型/网络连接字段，未声明的其他平台字段仍由运行时校验。

## 工具与推理能力

三种协议的请求、响应、流式事件及工具结果都由各自适配器处理，并不是只替换 URL。Chat 使用 `messages`，Responses 使用 `instructions` / `input` 及 `function_call_output`；参见 [官方迁移说明](https://developers.openai.com/api/docs/guides/migrate-to-responses)。

模板默认关闭 `thinkingEnabled`，不假设部署支持 tools + reasoning。确认支持后再启用。Chat 的 `chatToolReasoning` 可设置 `preserve` / `none` / `omit` / `responses-only`，应按照公司的实际能力契约选择。Responses 不发送 Chat 的 `reasoning_effort` 字段。旧服务若仅接受 `max_tokens`，请调整 Chat 的 `completionTokenField`。

本轮本地测试验证模板加载、三协议请求形状、认证隔离和工具往返；真实公司部署、CA/代理/mTLS、并发与凭据续期仍需公司环境验收。先运行 `ccpt model test --full-tools-check --stream --diagnostics`（会产生模型调用费用），诊断信息分享前仍应人工检查。
