# CCPT 0.64：MCP 交互、签名插件代际、实际指令来源

项目位置 `D:\project\CCPT`。本版保留 0.63 的定时 Goal、原会话预算、人工续行、Git 冲突工作台等能力，新增下面三组实现。测试结果以候选包旁 `VALIDATION.zh-CN.md` 与 evidence 为准；本文不是企业目标环境验收证明。

## 1. MCP 现代 sampling 与 URL 交互

SDK `McpInteractionHandlers` 新增完整的显式回调组合：

```ts
const interactions: McpInteractionHandlers = {
  samplingTools: true,
  confirmModernSampling: async (request, signal) => reviewExactRequest(request, signal),
  sampleModern: async (request, signal) => callYourBoundedModel(request, signal),
  confirmModernSamplingResult: async (result, request, signal) => reviewExactSharing(result, request, signal),
  urlOrigins: ['https://your-approved-service.example'],
  elicitUrl: async (request, signal) => reviewExternalConsent(request, signal),
  onUrlElicitationComplete: (id) => showCompletion(id)
};
```

上例的 review/call/show 函数由接入方实现，不能用常量 `true` 替代真实用户审批。通过 `callMcpServer` / `requestMcpServer` / `watchMcpServer` 传入回调，不接受 settings 或模型文本伪造批准。

三回调齐全才声明 sampling；另外显式 `samplingTools: true` 才声明 `sampling.tools`。现代回调协商 2025-11-25；服务端降级到 2025-06-18 后，现代/URL/媒体能力永久屏蔽，原文本能力按既有明确回调继续。支持 stdio、POST/SSE 和独立 GET。内置 TUI 的既有文本采样不自动升级成工具执行器；本版现代工具采样是 SDK 显式接入能力。

支持内容数组、文本、限定 MIME/大小的 base64 图片/音频、`tool_use`、`tool_result`、`toolChoice`。工具历史必须紧接对应 user 结果、完整匹配、调用 ID 不复用，结果中的工具必须来自服务端提供的清单。服务端工具由服务端执行；客户端只返回经批准的工具请求，绝不偷偷映射成本地 shell/MCP 工具。输入 schema 做结构/边界校验，不声称覆盖完整 JSON Schema 参数语义校验。

每次采样分别审批模型请求和对外分享；所有回调拿到独立副本。单请求至多 50 消息、32 工具、每消息 32 块、2048 maxTokens、750 KB 总体积；模型调用方仍负责真实 token/金额预算和模型能力转换。超时/取消传递 AbortSignal；拒绝、取消、审计失败均不分享结果。

URL 只允许明确固定的 HTTPS origin，无 userinfo/fragment。`accept` 只是同意外部交互，不代表完成；只有本 transport session 已接受且尚未完成的 `elicitationId` 才触发一次完成通知。未知/重复 ID 不展示成功，不触发工具重放。每 session 至多 128 URL ID；重新连接的独立 GET 在同 session 保留关联，关闭后不跨 session 继承。

`McpProtocolError` 保留 RPC `code`；URL required 错误 -32042 的 `elicitations` 只向明确调用方暴露验证过的固定-origin 数据，且非 enumerable。未固定/不合规 URL 标记 `urlElicitationBlocked`，不自动打开 URL 或重试业务。可打印 message 脱敏，不在 stack/JSON 导出 URL 查询串。不是任意数据零泄漏保证，业务 UI 不应直接打印完整错误对象的私有访问字段。

实现参考：[MCP Sampling 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/client/sampling)、[MCP Elicitation 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation)。保留现有嵌套审批、GET cursor 与 POST SSE 的显式续传边界；不把本地审计冒称集中不可变存储。

## 2. Marketplace 独立签名 overlay 和完整代际

catalogue 每个插件可新增 `signedOverlay`，值为 `signPluginOverlay` 生成的完整 envelope。发布方 artifact 签名与团队 overlay 签名分别验证，绑定原插件 name/version/digest，执行当前 key trust/revocation/lock 策略；不修改发布方 artifact 字节。catalogue 中旧式未签名顶层 commands/hooks/MCP 等与此入口不能混合。

```text
ccpt plugin-set stage-marketplace --json '["alpha@team-catalog","beta@team-catalog"]' --confirm
ccpt plugin-set inspect pluginset_ID
ccpt plugin-set activate pluginset_ID --expected-version 0 --confirm
```

Windows CMD 的 JSON 引号需按 shell 转义，可先执行 `ccpt plugin-set --help`。首次 activate 后，在工作区 settings 设置 `"usePluginSets": true`。必须已有明确 workspace trust，Marketplace 启用且不为 restricted。stage 不 activate，不运行插件命令；按明确 ID 读取配置的 catalogue/source，可能触发该源的已有显式获取流程，不是后台自动下载授权。

一份不可变 generation 保存全部选中 artifact 与独立 overlay 收据，一次 active pointer CAS 选择整份 generation。加载时从同一次 pointer 读取目录及 overlay，避免多窗口切换混用。当前 generation 就是完整选中集合，不是增量安装；要保留已有插件须一并选择。每次最多 32 插件，source 深度/文件数/总量有界。

```text
ccpt plugin-set rollback PREVIOUS_PLUGINSET_ID --expected-version CURRENT_VERSION --confirm
```

回滚重新验证当前信任、撤销、摘要和 lock；拒绝篡改收据与冲突的显式 settings overlay。artifact 和 overlay 收据随 generation 一起切换，不自动覆盖 settings。并发只有一个 CAS 获胜。旧单插件 Marketplace 安装路径遇到 `signedOverlay` 会明确拒绝，要求改用 generation 入口。

这解决新代际路径中跨插件/收据的一致选择，不是旧安装历史、OS manager、本地文件、远端系统的全局事务。无 fsync/断电/NFS 持久原子性保证；不自动采用中断 stage；不会静默迁移旧安装或后台自动升级独立签名 overlay。

## 3. 实际纳入上下文的 InstructionsLoaded

在实际包含文本后按来源发出事件：用户/项目指令、架构文档、用户/项目工程规则、激活 Skill、Agent profile、应用补充指令、记忆；lazy scoped rule 只在真实文件访问且实际纳入时触发。保留旧聚合事件以兼容现有 Hook，配置 matcher 时请区分 `source`，不要把聚合与逐来源事件当成一次。

payload 含 `source`、可用的 `path/instruction_id`、`included_characters`、实际纳入片段的 SHA-256 `included_text_digest`，不附正文。超预算未纳入、已加载跳过及普通问候不误发实际来源事件。摘要不是整文件摘要，也不是语义无损证明。初始逐来源 Hook additionalContext 总量限 50000 字符，单次 lazy 加载限 20000 字符。

这些是加载后的信息事件。observer 失败被审计，不回滚已加载文本、不自动重放，不把 exit 2 视为所有来源统一的事前禁止指令。本版没有宣称全部参照事件退出码兼容、任意插件零停顿热替换或 exactly-once。

## 安装与验证边界

候选 tgz 用 `npm install -g <候选路径>` 安装后，任意项目目录运行 `ccpt`。本轮不修改真实全局安装、不修改个人模型设置；保留用户现有三协议配置与企业 CA/代理/mTLS 配置方式。

实际 Node、临时离线 npm 安装、源回归均在自有临时状态/loopback 中执行；公司请求、业务 push/PR、真实 OS 注册、npm publish 均为 0。剩余项单独列在 [REMAINING-0.64.zh-CN.md](REMAINING-0.64.zh-CN.md)。
