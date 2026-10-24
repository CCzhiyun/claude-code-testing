# CCPT 0.40：公司 Responses 接入与验收

## 安装后直接启动

需要 Node.js 20+，不需要 Windows EXE。管理员分享本版本 tgz 后：

```cmd
npm install --global "C:\CompanyShare\ccpt-0.40.0.tgz"
ccpt --version
cd C:\work\your-project
ccpt
```

预期版本 `0.40.0`。这是本地可分发包，尚未发布到公共 npm；不要假定 `npm install -g ccpt` 会安装本项目。企业 registry 发布后使用管理员提供的 registry、包名和固定版本。

源码构建（维护者需要 Bun，安装使用者不需要）：

```cmd
npm ci
npm run check
npm test
npm run build
npm pack
```

## 公司 CA 与凭据

在公司终端设置凭据环境变量；请勿把真实密钥提交进项目，或粘贴到工单。

CMD 当前窗口：

```cmd
set AZURE_OPENAI_API_KEY=替换成你自己的密钥
set CCPT_CA_FILE=C:\Company PKI\ca.pem
```

PowerShell 当前窗口：

```powershell
$env:AZURE_OPENAI_API_KEY = "替换成你自己的密钥"
$env:CCPT_CA_FILE = "C:\Company PKI\ca.pem"
```

也可在 settings 配置 `network.caFile`，或在启动 Node 前配置 `NODE_EXTRA_CA_CERTS`。优先级：显式 settings 的 `network.caFile` 高于环境变量；环境变量中 `CCPT_CA_FILE` 高于 `NODE_EXTRA_CA_CERTS`。证书文件必须包含 PEM 证书，不能包含私钥；后缀可以是 `.pem`、`.per` 或其他名字，解析按内容判断。不要关闭 `rejectUnauthorized` 来绕过公司证书错误。

`config show` 已增加脱敏，但不应把完整业务配置当作可公开材料。`doctor` 仅检查配置/凭据是否存在和证书能否解析，不等于公司 TLS 握手已经通过。

## 三种独立协议

| Settings / CLI 值 | 请求 | 响应 | 用途 |
|---|---|---|---|
| `messages` | `system`, `messages`, `max_tokens` | content blocks / message SSE | 保留现有网关 |
| `chat-completions` | `messages`, nested function tools | choices / delta | 传统兼容接口 |
| `responses` | `instructions`, `input`, flat function tools, `max_output_tokens` | output items / response SSE | Azure Responses 或同协议网关 |

仅改变 URL 不会切换请求格式。UI `/config` → API connection preset 依次循环这三种模式；预设会清空旧 URL、旧认证映射，避免向另一供应商发出旧凭据。必须随后设置新 endpoint、部署名和认证。API protocol 单独切换会保留当前 URL/auth，只适用于同一个可信网关。

### Azure Responses（推荐按完整 URL 配置）

```cmd
ccpt config set --global --api-preset azure-responses --endpoint-url "https://YOUR-RESOURCE.openai.azure.com/openai/v1/responses" --model "YOUR-DEPLOYMENT"
ccpt config set --global --ca-file "C:\Company PKI\ca.pem"
ccpt config set --global --marketplace disabled
ccpt doctor
ccpt
```

`azure-responses` 默认读取 `AZURE_OPENAI_API_KEY`，发送 `api-key`，默认关闭服务端存储和推理参数。模型字段填写公司 **部署名**，不保证等于公开模型商品名。

如果公司网关完整路径类似 `https://GATEWAY:8053/responses/v1/responses`，直接把完整路径交给 `--endpoint-url`；它不会再追加 `/responses`。`--base-url` 则填不带最终 `/responses` 的前缀，如 `https://GATEWAY:8053/responses/v1`。查询串 `?api-version=...` 原样保留，不擅自选择某个 Azure API 版本。不要使用明文 HTTP 传递企业 token。

若公司采用 Entra bearer token 或自定义 token：

```cmd
ccpt config set --global --api-key-env COMPANY_MODEL_TOKEN --api-key-header authorization --api-key-prefix "Bearer "
```

应先在环境中设置 `COMPANY_MODEL_TOKEN`。本版读取现成 token，不自动代替公司完成 Entra 登录/续期。

### settings 示例

用户级 `%USERPROFILE%\.ccpt\settings.json`，项目级 `<项目>\.ccpt\settings.json`；企业 managed settings 最终生效。

```json
{
  "marketplaceEnabled": false,
  "model": {
    "provider": "compatible",
    "apiProtocol": "responses",
    "endpointUrl": "https://GATEWAY/responses/v1/responses",
    "name": "YOUR-DEPLOYMENT",
    "apiKeyEnv": "AZURE_OPENAI_API_KEY",
    "apiKeyHeader": "api-key",
    "apiKeyPrefix": "",
    "maxContextTokens": 128000,
    "maxOutputTokens": 8192,
    "thinkingEnabled": false,
    "responsesStore": false
  },
  "network": {
    "caFile": "C:\\Company PKI\\ca.pem",
    "rejectUnauthorized": true,
    "allowedHosts": ["GATEWAY"]
  },
  "ui": { "autoCompact": true }
}
```

128000 只是示例，必须改为该部署的真实窗口；填写 1M 不能扩容服务端模型。

## 上下文 90% / 95%

每轮模型请求前计算：

`占用率 =（当前完整输入估算 + 输出预留 + 安全预留）/ 配置窗口`

- 达到 90% 提醒；同一区间不重复刷屏。
- **严格超过 95%** 且 Auto compact 开启时，在发请求前压缩。
- 恰好 95% 只提醒；低于 90% 后可再次提醒。
- 旧完整轮次归档到本地，最新用户轮次及其工具调用/结果保持完整。
- 正常自动压缩在同一 Agent 循环中继续，不关闭终端、不新建对话、不需要输入“继续”。工具往返和下一条用户消息仍使用同一个 session。
- 只剩一个超大轮次或系统/工具定义太大时，提示无法压缩，不偷偷截断；后续预算守卫会阻止超预算请求。
- 关闭 Auto compact 后仍会提示，但不会主动压缩。`/compact` 仍可手动操作。
- 极端情况下无法安全恢复（例如只有一个超大轮次），保留 Agent/session 为可接续的 waiting_for_input，而不是 failed 或退出窗口。调整真实模型窗口/输入后仍可在原会话继续；不会无限重试收费请求。
- 输入估算不是 tokenizer，也不是累计账单。Responses 缓存 token 是输入 token 的子集，不能再次相加；推理 token 同样不重复加到总输出。
- 本地压缩是有上限的原文摘录，不是高保真的模型语义摘要。`/export` 可导出完整原始历史。

安全预留为窗口的 5%，下限 128，上限 8192 token。因此 UI 的占用率包含预留，与服务端仅报告的 input tokens 不会相等。

## 图片所示 Responses 能力

| 图片能力 | 0.40 行为 |
|---|---|
| input / instructions | 会话转换为 input items；每轮重发 instructions |
| 文本 / 图片 | 文本、现有图片附件映射为 input_text / input_image；是否支持图片取决于部署 |
| function tools | 扁平 schema；使用 call_id 回传 function_call_output，不误用 item id |
| Streaming | response.output_text.delta、refusal、reasoning summary；完成事件作为工具执行边界 |
| 错误与截断 | failed/incomplete/缺少 completed/非法工具 JSON 都不会执行部分工具调用 |
| JSON Schema | model.responsesTextFormat → text.format；约束由服务端执行，本地验证配置形状，不充当完整 JSON Schema 验证器 |
| store / previous_response_id | 显式开启后使用；默认 false，完整本地会话仍保留 |
| reasoning items | 同目标重放 provider output 与 encrypted reasoning；不会伪造其他协议的思考签名 |
| 删除服务端记录 | 显式 CLI delete + --confirm；本地压缩不自动删除远端记录 |
| 内置搜索/托管代码执行 | 不自动启用；现有本地工具、MCP 和权限链继续负责执行 |

图片里的某个函数定义示例把 Chat Completions 的嵌套 `function` 格式混入了 Responses。本实现根据官方文档采用扁平函数定义，没有照抄该混合格式。

### 服务端存储和会话链

```cmd
ccpt config set --global --responses-store enabled
ccpt responses get resp_ID
ccpt responses delete resp_ID --confirm
```

启用前确认公司的留存政策。CCPT 不承诺网关一定保存 30 天；实际支持与期限由公司服务决定。切换端点/认证/模型，或历史发生改写/压缩后，旧链不会继续使用。明确的 previous_response_id 过期错误会在尚无文本输出时重试一次完整无状态历史；鉴权、限流等错误不触发这种回退。

### 结构化输出

`format.json` 内容示例：

```json
{"type":"json_schema","name":"result","strict":true,"schema":{"type":"object","properties":{"ok":{"type":"boolean"}},"required":["ok"],"additionalProperties":false}}
```

```cmd
ccpt config set --response-schema format.json
ccpt -p "Return ok=true" --output-format json
ccpt config set --clear-response-schema
```

`--output-format json` 是 CLI 外层结果信封；模型生成的 JSON 仍在 `result` 字符串内。这两种 JSON 不是同一个层级。清除配置写入 null，可覆盖上层继承的 schema。

## CI / 一次性执行

```cmd
ccpt -p "Read README.md and summarize" --restricted --output-format json
ccpt --print "Review the current changes" --output-format stream-json
ccpt -p "Continue reviewing" --resume session_ID
ccpt -p "Explore an alternative" --resume session_ID --fork-session
```

支持省略 prompt 从 stdin 接收 UTF-8 文本（最多 1 MiB）。输出格式为 text、单个 JSON result、或逐行 runtime 事件加最后一个 result，`schema_version: 1`。退出码 0=完成、2=需要人工输入/权限、1=失败。权限不会因 print 模式而跳过；默认不创建 worktree，可显式 `--worktree`。会话持久化与普通 Agent 一致，不是无痕模式。`--resume` 不接管正在运行或等待审批的会话。

`--append-system-prompt` / `--append-system-prompt-file` 为追加约束，不覆盖安全策略。不支持参照产品的完整双向 stream-json 输入、所有参数别名或所有事件格式。

## 本次验证记录（2026-09-22）

- GLM `glm-5.3-flash`，原有 Messages 端点：真实流式请求成功，end_turn，测试文本正确；服务端报告输入 33、输出 555。
- 同源标准 `/api/paas/v4/chat/completions`：真实流式请求成功，stop，测试文本正确；报告输入 33、输出 496。
- 同源标准 `/api/paas/v4/responses`：HTTP 404。这只说明此路径不可用，不能推断所有其他 GLM 网关/产品均不支持 Responses。
- 上述完整复测使用 2048 输出上限；最初 256 上限的探测耗尽输出额度，不算完整成功。未改写用户的模型/协议/密钥/CA 配置。
- 公司 Azure endpoint、公司 CA 链、VPN/代理及 mTLS：**未真实验证**。本机未配置 CCPT 专用公司 CA，不得用 GLM 成功替代这项验收。
- 本地测试覆盖三种协议、Responses 工具真实读文件往返、token/错误/流式分片/链失效、上下文阈值、终端提示和 print JSON/退出码。测试服务器不是 Azure 服务本身。

维护者可运行 `bun scripts/verify-model-protocols.ts --live` 对当前配置发送一个小额度测试；仅现有 GLM 源可额外指定 `--probe-glm-alternatives` 探测标准路径。脚本不输出密钥，不上传项目内容，不改 settings，但会消耗模型调用额度。

## 尚不能宣布整个平台全部完成

OS 级沙箱、公司 OAuth/代理/mTLS 的真实互操作、MCP 常驻双向事件/完整主动请求、IDE 多窗口/远程开发全矩阵、插件许可与来源审计、超大仓库与多 Agent 压力测试仍需独立完成。详见 [最新差距说明](REMAINING-0.40.zh-CN.md)。

实现时使用 OpenAI Docs 核对了官方 [Responses 迁移指南](https://developers.openai.com/api/docs/guides/migrate-to-responses) 与 [Azure Responses REST 参考](https://learn.microsoft.com/en-us/rest/api/microsoft-foundry/azureopenai/responses)。模型部署支持的参数仍以公司端点为准。
