# CCPT 0.43.1 工具流安全修复

日期：2026-09-24。沿用 0.43 的公司 Chat / Responses 独立配置和 CA 配置，无需更换认证信息。

## 修复内容

1. 工具参数缺失、截断 JSON、null、数组和标量不再替换为 `{}`。仅接受显式对象；真正的无参调用 `{}` 仍可使用。错误提示不包含原始参数或代码内容。
2. 工具调用 ID、名称必须为非空字符串；同一个响应中的重复调用 ID 被拒绝。整个响应验证成功前，不向执行器交付其中任何一个工具。
3. Chat SSE 工具响应必须同时收到 `finish_reason: tool_calls` 和 `[DONE]`。Messages SSE 工具响应必须收到对应的 `content_block_stop`、`stop_reason: tool_use` 和 `message_stop`。缺失标记、错误结束原因、结束后的额外增量、冲突 ID、畸形事件和残留半帧均不会执行工具。
4. Chat / Messages 改用增量 UTF-8 解码，避免中文或 emoji 的字节分布在多个网络包中时出现替代字符。文本、思考摘要和工具 JSON 字符串都使用同一增量解码通道。
5. JSON 响应及流式请求退回 JSON 的路径也检查参数对象与调用 ID；明确的 `length` / `max_tokens` / `content_filter` 等未完成原因不会执行工具。为了兼容已有完整 JSON 网关，仍允许缺省结束原因或正常 `stop` / `end_turn`；这不适用于 SSE 工具流的严格结束校验。
6. 修复重复全量测试发现的后台 Agent 完成状态竞争：在发布 Agent 完成状态前，先持久化关联任务的完成状态；已生效的取消不能被随后到达的完成写入覆盖。此处不是跨文件事务或断电恢复承诺。

## 会话行为

异常只让当前 Agent 回合失败，不退出终端、不删除会话、不执行该响应中的工具，也不自动重放畸形响应。用户可以在同一个会话明确继续。已有流式显示的文本可能是部分输出，不等于模型已完成任务。

本次不是完整 JSON Schema 参数实例验证器，也不保证所有供应商在纯文本流中都提供结束标记；新增严格结束检查针对可执行工具响应。Responses 保留原来的 `response.completed` / 参数对象检查，并增加共享的重复调用 ID 检查。

## 测试与安装

新增 test/model-tool-safety.test.ts 覆盖三协议 JSON 参数异常、重复 ID、工具 SSE 截断、事件顺序、中文/emoji 字节拆分、完整合法结束、usage 尾帧，以及真实 Agent 的“第一个调用合法、第二个非法时都不执行”和原会话继续。服务端是本地测试夹具，文件工具与 Agent 为真实实现，不代表公司 Azure 环境验收。

本机另以 `glm-5.3-flash` 对 Messages、Chat Completions 两条真实接口执行流式全工具目录探测：两条均携带 77 个工具定义，完成诊断 echo 调用、结果回传和最终回答。探测仅允许诊断 echo 实际执行，不运行项目工具。该结果不等于 GLM Responses 支持证明，也不替代公司 Azure Responses、CA、代理或 mTLS 实测。

```cmd
npm install -g .\ccpt-0.43.1.tgz
ccpt --version
ccpt
```

公司接口继续使用 [0.43 配置与验收步骤](COMPANY-ACCEPTANCE-0.43.zh-CN.md)，需要分别对 Chat、Responses 执行 `model test --stream --full-tools-check --diagnostics`。若公司网关省略结束标记，应修正网关协议输出，不要关闭工具安全检查来绕过错误。

OpenAI Docs 核对来源：[Function calling — Streaming](https://developers.openai.com/api/docs/guides/function-calling)。本版未发布到公网 npm，未包含公司密钥或私有 CA，其他企业验收与第三方许可剩余项不因此关闭。
