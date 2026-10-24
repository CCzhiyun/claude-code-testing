# 0.51：Responses 主链路迁移

CLI、全屏终端、前台/后台 Agent、SDK、prompt Hooks 和语义压缩都经过同一个 `callModel` 入口。新安装默认选择 OpenAI Responses；只修改 URL、模型或认证头不会再隐式切回 Chat。旧用户明确配置的 Messages/Chat 仍保留为独立兼容模块，不强制改动公司部署。

## 两种 Responses 接入不能混淆

| 配置 | CCPT 主链路 | 实际上游请求 | 服务端存储/结构化输出 |
| --- | --- | --- | --- |
| `apiProtocol: responses`，`responsesTransport: native` | Responses | 真正的 `/responses` | 按部署能力配置 |
| `apiProtocol: responses`，`responsesTransport: chat-completions` | Responses | 显式适配为 `/chat/completions` | 不模拟；开启即拒绝 |

原生请求使用 `instructions`、`input`、平铺 `tools`、`max_output_tokens`、`reasoning`、`text.format`；函数结果用 `function_call_output` 对应原 `call_id`。流式解析使用 Responses 事件，不使用 Chat 的 `choices`。SDK `callModel()` 返回 `response` 标准对象；`content` 仍是旧 UI/工具和持久会话的兼容投影，并非已把所有历史文件改成原生格式。原始 output/reasoning 随会话标记保存，只有同端点/模型/认证/transport 且历史前缀未改动时才回放；压缩、修改或切换后不复用旧链。

这些字段与官方 [迁移指南](https://developers.openai.com/api/docs/guides/migrate-to-responses)、[函数调用](https://developers.openai.com/api/docs/guides/function-calling) 和 [流式指南](https://developers.openai.com/api/docs/guides/streaming-responses) 对齐。没有实现的服务端能力不会假装成功。

## 公司 Azure：原生 Responses

使用 `company-responses.settings.example.json`，保持 `responsesTransport: native`，填写部署名称和公司实际 `/responses` 完整端点、认证头、CA/代理/mTLS。示例不是公司验收结果；本轮没有连接公司服务器。不要把 GLM 的 Chat 地址粘贴到这套配置。

```powershell
$env:AZURE_OPENAI_API_KEY = "<公司的凭据>"
ccpt model test --settings .\company-responses.settings.json --stream --full-tools-check --diagnostics --timeout 60000
```

## GLM：当前需要显式 Chat 适配

本机已保留 `glm-5.3-flash`，从旧用户配置迁移到 `provider: openai`、`apiProtocol: responses`、`responsesTransport: chat-completions`、`apiKeyEnv: OPENAI_API_KEY`。原文件已备份在用户配置旁，不包含在 npm 包中。没有更改其他产品的配置或系统环境变量。

**本轮探测 `https://open.bigmodel.cn/api/paas/v4/responses` 返回 HTTP 404。** 不能由 Chat 或 Messages 可用推断 GLM 原生 Responses 可用。当前可用上游是 `https://open.bigmodel.cn/api/paas/v4/chat/completions`。适配器不启动额外服务、不猜测其他地址、不静默降级；诊断同时显示逻辑 `protocol` 与实际 `wireProtocol`。适配响应 ID 以 `bridge_resp_` 开头，不能用于服务端 response GET/DELETE。

新用户复制 `settings-glm-responses-bridge.example.json` 到用户 `~/.ccpt/settings.json`，通过环境变量提供 GLM 密钥：

```powershell
$env:OPENAI_API_KEY = "<GLM 密钥>"
ccpt model test --stream --full-tools-check --diagnostics --timeout 60000
ccpt
```

也支持现有用户 settings 的 `env.OPENAI_API_KEY`，但它是明文，建议公司按自己的凭据方案分发；绝不提交或打包真实密钥。`network.caFile`/`CCPT_CA_FILE`/`NODE_EXTRA_CA_CERTS` 仍可提供 PEM CA，TLS 校验始终开启。

有源码时可执行 `bun scripts/migrate-glm-responses.ts` 先检查，确认后加 `--apply`。迁移器只接受已配置的 `open.bigmodel.cn` 和原 GLM 型号；遇到冲突凭据会停止，并在写入前生成备份。该脚本不是安装包的运行时依赖。

CLI 临时探测或持久配置可显式传 `--responses-transport native|chat-completions`。选择一个新 API preset 会清除原端点/认证并重置为 native；仅选择 transport 不会替你猜 URL。

## 验证边界

2026-10-16 本轮：`npm run check` 通过；全量 `bun test ./test` 为 **84 个文件、423 项测试通过、0 失败、3236 个断言**。额外的原生/适配 Agent 与终端压缩路径重跑为 14 项通过。本地严格夹具验证协议行为，不能替代真实供应商或公司环境验收。

本轮本机 GLM 已通过：普通问题、多轮记忆、标准响应对象、流式 echo 工具调用/结果回传、80 项完整目录注册（79 内置工具 + 1 安全 echo）、实际 `read_file` 工具执行、同 Agent/会话继续、工具结果落盘、收到流式文本后取消。实测只发送合成提示与临时测试文件，不发送项目源码；没有做公司环境验收。

本地测试还验证原生 Responses 的 Agent、后台 worker、UI、压缩继续、工具配对、错误诊断、不完整流拒绝执行、取消与恢复。旧 Messages/Chat 回归保留，但它们的测试夹具必须明确选择旧协议。

未知 token 用量仍标记未知，不能当作 0；上下文仍是估算，90% 提醒、超过 95% 压缩后在原会话继续。桥接不提供原生加密 reasoning 跨协议迁移、服务端存储、结构化输出或 Azure 企业认证的等价模拟。

## 安装

```powershell
npm install --global .\ccpt-0.51.0.tgz
ccpt --version
ccpt
```

只构建 npm 包，不生成 EXE，也未发布公共 npm。配置与密钥是用户/公司自己的，不随包自动分发。
