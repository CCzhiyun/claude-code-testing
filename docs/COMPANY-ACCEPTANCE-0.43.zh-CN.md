# CCPT 0.43：Chat / Responses 工具兼容验收

## 本次修复和边界

截图引用的服务端错误为：Chat Completions 不接受当前部署的 function tools + 非 none reasoning_effort 组合。这不表示证书错误，也不表示所有 Chat 部署都不能用工具。CCPT 已有 Responses 实现，本版补部署能力策略、工具定义和诊断。

- todo_write.todos、workflow.tasks 补齐 items 及实际执行器支持的字段。
- 完整内置工具 schema 在发请求前检查嵌套数组 items、重复名称等。不是完整 JSON Schema 实例校验器，也不会任意补写第三方 schema。
- HTTP 文本/JSON、HTTP 200 中的错误、SSE 错误保留脱敏后的 message/code/param/requestId。凭据、URL 查询参数和控制字符清理，不保存完整错误 body。普通对话直接显示；model test 需 --diagnostics 才显示。
- 错误信息仍可能含业务描述，分享前人工检查。字段未由服务端提供时不会编造。
- 显式 endpointUrl 的已知协议路径若不匹配，会本地拒绝；不自动改路由、不删除工具、不发送旧凭据到新地址。

## 部署能力配置

在 settings 的 model 中新增 chatToolReasoning：

| 值 | 带工具的 Chat 请求 | 使用场景 |
|---|---|---|
| preserve | 保留既有 thinkingEnabled/reasoningEffort 行为 | 默认兼容旧部署，不猜测私人部署名 |
| none | 明确发送 reasoning_effort: "none"，即使 thinkingEnabled=false | 本次截图所示支持 none 的 Chat 部署 |
| omit | 完全省略 reasoning_effort | 网关明确不支持此字段；不等于 none |
| responses-only | 发请求前报错，要求选择独立 Responses 配置 | 管理员要求工具只能走 Responses 的部署 |

这项策略不影响 Responses 的 reasoning.effort。不能把 none 通用化到所有模型。没有工具的 Chat 请求维持原有推理设置。

现有公司 Chat 配置的最小修复，在项目目录执行：

```cmd
ccpt config set --chat-tool-reasoning none
```

或用 --global 修改全局设置；项目设置与企业托管策略可能覆盖全局。终端 /config 中也有 Chat tools: reasoning compatibility，回车循环选择。不要在不确认服务端限制时盲目选择 omit。

## 两套配置分别保存、启动

复制本目录的 company-chat.settings.example.json、company-responses.settings.example.json 为自己的文件，不要把两套 model 字段拼在一起。

- Chat 示例来自最新 APIM 截图的路径。
- Responses 示例来自此前独立部署截图，不是把 Chat URL 后缀机械替换。
- URL、部署名、认证头、API 版本以公司平台管理员提供的值为准。图片中的 api_version 查询参数不完整，本版不猜填；如网关需要查询参数，补到完整 endpointUrl。
- api-key 只是示例，若网关要求 Bearer 或其他头请配置 apiKeyHeader/apiKeyPrefix/headersFromEnvironment。
- 128000 上下文、4096 输出是示例值，不代表公司部署规格。
- templates 清空旧 baseUrl 和额外认证头映射；保留完整 endpointUrl。Responses 默认 store=false，不启用服务端保存。

CMD 中设置公司 CA（文件必须是 PEM 证书链，不能是私钥）：

```cmd
set "CCPT_CA_FILE=C:\company\certs\ca.pem"
```

AZURE_OPENAI_API_KEY 由公司批准的安全方式注入环境，不写进模板、仓库或共享日志。也可在各文件的 network.caFile 中配置绝对 CA 路径；显式 settings 优先于 CA 环境变量。不要关闭 TLS 验证。

```cmd
ccpt --settings C:\company\ccpt-chat.json
ccpt --settings C:\company\ccpt-responses.json
```

两个命令分别启动新终端会话。--settings 是临时覆盖，不改默认 settings；托管配置始终优先。切换到另一后端时建议开启新会话；不会复用其他目的地的 previous_response_id。

## 公司同事验收（不是本地模拟结果）

先确认版本和实际有效配置：

```cmd
ccpt --version
ccpt doctor --settings C:\company\ccpt-chat.json
ccpt model test --settings C:\company\ccpt-chat.json --stream --diagnostics
ccpt model test --settings C:\company\ccpt-chat.json --stream --full-tools-check --diagnostics --timeout 60000
```

对 ccpt-responses.json 重复上述检查。doctor 只有静态配置/证书解析，不是连接与工具验收。model test 是付费请求，full-tools-check 通常两次，并包含完整内置工具目录；只执行固定 echo，其他工具调用立即拒绝。不会加载项目上下文、执行插件、MCP、Hooks、shell 或改文件；不覆盖第三方动态工具目录。

接着在一个专用测试项目里放置 fixture.txt（无机密），实际启动终端，逐项验收：

1. 问“你可以做什么？”：普通非问候请求成功，无 400。
2. 问“读取 fixture.txt 并说明内容”：出现 read_file 调用；结果返回模型后得到回答。
3. 问“刚刚那个文件里是什么？”：同会话正确续聊，保留工具历史。
4. 请求较长回答，流式开始后按终端取消键；确认停止当前生成，没有额外执行未完成工具。
5. 在原会话继续提问：终端不退出，会话历史保留。
6. 若失败，收集版本、协议、部署名、脱敏错误 code/param/message/request-id；不要发送密钥/完整 settings/业务上下文。

两套部署分别记录：时间、机器、VPN/代理/mTLS 配置情况、部署与接口版本、每项结果及 request-id。公司 CA/代理/mTLS/Entra 续期和真实网关验收必须在公司环境完成。

## 本地开发验证

2026-09-23 真实 GLM 探测：glm-5.3-flash 在原 Messages 接口和 /api/paas/v4/chat/completions 接口均通过 --stream --full-tools-check：注册 76 个内置工具 + 1 个诊断 echo，完成工具结果回传及最终回答。两次探测分别约 9.5 秒、9.7 秒。此结果不是公司 Azure 网关测试，也不是 GLM Responses 支持证明；Chat 使用其原生兼容设置，不据此推断公司部署支持 reasoning+tools。未更改本机默认模型或公司配置。

```cmd
npm ci
npm run check
bun test ./test
npm run build
npm pack
npm install -g .\ccpt-0.43.0.tgz
ccpt --version
```

运行 CLI 不要求 Bun；Bun 仅用于本仓库测试。测试 deployment-agent-acceptance 使用严格本地接口，但运行真实 Agent、多轮历史和本地 read_file，并验证取消后同会话恢复。它不冒充 Azure 生产验收。

官方协议依据：https://developers.openai.com/api/docs/guides/migrate-to-responses （工具格式、reasoning 与 Chat/Responses 差异）。本版不宣称其余企业安全、许可、OS 沙箱或所有第三方插件已经完成验收。
