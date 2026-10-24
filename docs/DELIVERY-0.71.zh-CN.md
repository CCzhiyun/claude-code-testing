# CCPT 0.71：token、上下文与错误诊断修复

## 安装与启动

这是本地所有者验证包；没有发布到 npm，也不代表已获得第三方再分发许可。安装本目录里的 tgz：

```powershell
npm install -g "完整路径\ccpt-0.71.0.tgz"
ccpt --version
cd D:\project\ccpt-cli
ccpt
```

版本应为 `0.71.0`。若仍显示旧版本，在 PowerShell 执行 `Get-Command ccpt -All`，在 CMD 执行 `where ccpt` 检查 PATH 中的重复安装。退出并重新打开已经运行的旧 CLI；旧进程不会热替换成新代码。

不需要 EXE，也不需要在每个工作目录复制 settings。默认用户配置是 `%USERPROFILE%\.ccpt\settings.json`；项目内 `.ccpt\settings.json` 会覆盖用户配置。`CCPT_HOME`/`--state-home` 会改变用户状态目录。本轮没有修改你的用户配置、模型地址、Key 或全局安装。

## token 统计的含义

- 以生成响应的 `usage` 为准；缓存 token 是输入总量的子集，不再相加。Chat 与 Responses 的 reasoning token 是输出的子集，也不重复加总。
- `/usage` 和设置面板显示累计输入、输出、reasoning 子集与已知/估算来源。未报告 reasoning 的请求显示不可用，不假装为零；旧历史不会被重写。
- 没有 usage 时，输出只估算生成的文本/工具参数，不把本地 ID、签名等元数据算进去；使用显式配置的文本 tokenizer。隐藏推理、图片和音频的精确费用不能从可见文字推算。
- 流式进行中的数字仍是可见文本的快速估算，收到最终 usage 后才使用服务端数字。失败或取消后服务端未返回的消耗无法准确追补；账单以提供方为准。
- GLM 或公司部署不要随便当成某个 OpenAI tokenizer。`model.tokenizer` 只有在明确适用时才配置；`o200k_base` 的真实 BPE 不等于所有模型的真实计费。长密集文本的内置 BPE 使用最多 5 秒的子进程保护，超限保留会话并提示，不悄悄用错误分块计数冒充精确值。

## 上下文

`/context` 的容量不是 `/usage` 的累计消耗。占用判断 = 当前请求输入 + 最大输出预留 + 安全预留。

- 达到 90% 提醒；超过 95% 且 autoCompact 开启时压缩旧的完整轮次。
- 最新用户轮次及其工具调用/结果保留；原始被压缩消息归档，不关闭对话，不直接清空历史。摘要不承诺零信息损失。
- 手动和自动压缩统一使用已配置的 tokenizer；当前会话估算不重复计算 Responses 的本地回放元数据。
- 服务端精确输入计数现在能到达真正的查询校验层，不会随后又被较大的本地估算值误拦截；计数绑定完整输入、模型、部署、凭据作用域和工具选择，变化后不可复用。
- 若部署**明确支持** `POST .../responses/input_tokens`，可在同一 `model` 中增加 `"inputTokenCounting": { "mode": "responses", "onError": "stop", "timeoutMs": 10000 }`。默认不开启，每次增加一次请求；不代表 GLM/公司网关必定提供该接口。`onError: "estimate"` 为显式允许估算回退，不能绕过权限/取消/预算。原生 Responses 模式适用，Chat 适配模式不适用。

## 截图中的 400 与完整错误

截图不是 token 耗尽：服务端拒绝了 Chat Completions 的 `tools + reasoning_effort` 组合。简单问候可能不携带工具；后续普通请求携带工具后才失败，所以看起来像“用一段时间才报错”。具体每次失败仍要看对应 request-id，不能用旧截图诊断所有故障。

公司继续使用 Chat 时，在该部署自己的 `model` 内配置：

```json
{ "chatToolReasoning": "none" }
```

这是合并字段示例，不要拿它替换整个 settings。它只对携带工具的 Chat 请求发送 `reasoning_effort: "none"`，不切地址、不删工具。若业务需要工具与推理同时使用，使用公司**另行提供**的完整 Responses URL、匹配 Key/部署名，配置 `apiProtocol: "responses"`、`responsesTransport: "native"`。不要把 `/chat/completions` 的 URL 填进 Responses 配置。本版遇到该 400 会直接提示这两个处理方向，不私自重放失败请求。

终端中：

```text
Ctrl+O                         展开当前错误
/doctor errors                 最近十条脱敏模型错误
/doctor errors 50              最近五十条
/doctor export diagnostics.json 导出环境检查和最近十条错误
```

终端外（CMD/PowerShell）：

```powershell
ccpt doctor errors --limit 20
ccpt doctor export diagnostics.json
```

新版本的持久化错误文件默认在 `%USERPROFILE%\.ccpt\diagnostics\model-errors.json`。最多保留 100 条、4 MiB，记录时间、协议、去 query 的 endpoint、工具数量、HTTP 状态、脱敏 code/param/message/request-id、堆栈和有界 cause 链。只记录最终模型失败，不是每次重试，不是整台机器所有日志；日志写入失败不替换原始错误。凭据准备前的本地配置错误可能只有当前终端/Agent 记录。`--no-session-persistence` 不写此文件。

旧版本不会凭空产生新日志。旧失败先用 Ctrl+O 或对应状态目录 `agents-runtime\agent_*.json` 的 `error` 字段取回。向公司排查时提供失败时刻、版本、协议、HTTP 状态、request-id 和脱敏错误；不要发 Key、证书私钥或整个 settings。导出前人工复核，脱敏不能保证服务端错误文字里绝无业务敏感信息。

## 验证边界

本轮回归使用本地隔离 fixture；真实公司 Azure、CA/代理/mTLS、部署能力及长期运行仍需目标机验收。本包不包含个人配置、公司证书或 Key。最终测试与包校验见 `VALIDATION-0.71.zh-CN.md` 和交付目录收据。
