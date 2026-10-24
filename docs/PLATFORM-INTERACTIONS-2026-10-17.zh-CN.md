# 2026-10-17 第二批补强：MCP 显式交互与签名产物

后续第三批已补 HTTP 请求所属 POST/SSE 交互、SDK 类型、来源收据修复与分发门禁，见 [最新增量说明](HTTP-SDK-RELEASE-2026-10-17.zh-CN.md)。本文的 stdio-only 范围和 500 项测试为第二批历史记录。

本批没有访问公司模型或修改个人配置。新增能力不是“所有剩余 P0 全部完成”，下面区分可运行入口和未覆盖范围。

## 1. MCP 反向请求：默认拒绝，明确开启才允许人工交互

```powershell
ccpt mcp call your-stdio-server your-tool --interactive --json '{}'
```

这是独立 CLI 的真实 readline 交互入口，需要终端输入和 stderr 均为 TTY。普通 `mcp call`、Agent 内工具调用和 HTTP 常驻监听仍默认拒绝采样与表单。不能只在 settings 配置一个 `allow: true` 来替代人工确认。

stdio 的 `2025-06-18` 协商版本下支持两类受限操作：

- `sampling/createMessage`：展示模型请求，明确输入 `yes` 后才调用当前配置的模型；生成结果再次展示，第二次 `yes` 后才发送给 MCP 服务。前一步拒绝不花模型请求，后一步拒绝不分享生成内容。不是永久授权。
- `elicitation/create`：展示简单表单；用户输入 JSON、`decline` 或 `cancel`。JSON 仍需确认后才能发送，并经过必填、类型、枚举、长度、数字范围和格式校验。不自动共享 schema 的 default 值。

安全约束：

- 不传当前会话、Skills、记忆或源码；不提供本地工具，不允许服务端更改模型端点/凭据；Responses 采样显式 `store: false`。
- 采样仅接受文本，最多 50 条消息、请求 64 KB、单条文本 16,000 字符、输出上限 2,048 tokens 且不超过用户配置值；结果最多 32,000 字符。
- 一个客户端最多 8 个非 ping 反向请求；审批串行，每次总等待默认 60 秒；SDK 可设 1–120,000 ms。外层工具请求仍受其自身超时约束。
- 关闭、取消、超时或原工具请求完成会撤销尚未完成的交互；迟到的审批不能将结果继续分享。SDK 实现的模型回调也应遵守提供的 AbortSignal。
- 表单最多 32 个平面 primitive 字段；拒绝密码/API Key/支付等明显敏感字段；不支持 URL mode、嵌套对象、数组、正则 pattern 等额外 schema 特性。启发式敏感字段检测不是 DLP，用户仍不能输入秘密。
- 交互仅用于已初始化、恰有一个活跃客户端操作的 stdio 连接；初始化期间、无活跃操作、多个操作无法关联时不开放交互。
- 不启用 sampling tools/context/multimodal；不把支持范围外的请求降级执行。

实现依据是已协商版本的 [MCP Sampling](https://modelcontextprotocol.io/specification/2025-06-18/client/sampling) 与 [Elicitation](https://modelcontextprotocol.io/specification/2025-06-18/client/elicitation)；没有宣称完整覆盖更新版本的能力。

### SDK

`ccpt/sdk` 新增运行时函数 `callMcpServer`、`requestMcpServer`；源码 `src/mcpInteraction.ts` 定义 `McpInteractionHandlers` 等类型（完整 npm SDK `.d.ts` 分发仍待补齐）。最后一个运行时参数可以传入：

```ts
const handlers: McpInteractionHandlers = {
  confirmSampling: (request, signal) => showRequestApproval(request, signal),
  sample: (request, signal) => sampleUsingYourApprovedModel(request, signal),
  confirmSamplingResult: (result, request, signal) => showSharingApproval(result, request, signal),
  elicit: (request, signal) => showNonSensitiveForm(request, signal),
};
```

示例函数由嵌入应用实现，不是内置函数。只有三个 sampling 回调齐全时才声明 sampling capability；form 回调是应用提供人工表单交互的可信边界，不能交给模型自动批准。回调不是可序列化 settings，也不产生磁盘上的通用权限 grant。

### 顺手修复的传输问题

服务端请求与客户端请求的 ID 空间分离；服务端同 ID 的反向请求不再被误认为工具结果。增加重复 ID、JSON-RPC envelope、UTF-8、1 MB 单帧和 8 MB 会话 stdout 边界；`error: null`、错误对象缺少 code、非法 method 或 result/error 同时存在都显式失败，不会变成空的成功结果。超限会终止拥有的 MCP 子进程，不自动重放工具请求。特别大的工具目录可能被这个有界限制拒绝，需拆分服务或后续单独评估受控限额。

HTTP direct/Streamable POST、独立 GET SSE、URL elicitation、Agent/TUI 中嵌套审批等仍未完成这条交互链路。不能将本轮 stdio 子集称为完整 MCP 反向授权验收。

## 2. 签名 Marketplace 安装、升级和回滚

现在可以通过已有的 `plugin install <name>@<marketplace>` 和 `plugin update` 路径安装具备 integrity/signature 的原始插件产物，前提是通过当前信任密钥、撤销列表及锁校验。

只有经过可信公钥验签才能认定发布者签名；只有 SHA-256 integrity 的插件不因此获得发布者身份认证。组织仍须按风险显式启用 `requirePluginSignatures` / `requirePluginLocks`。

- 保持产物原始文件及签名，不重写 manifest，不向签名目录加入 `.ccpt-marketplace.json`。
- 安装来源收据放在项目状态 `.ccpt/plugin-installations/<scope>/<name>.json`，与插件签名内容分离。
- 目录声明的插件名/版本必须与签名产物一致；目录中若试图覆盖 commands、Skills、Agents、Hooks 或 MCP contributions，拒绝安装，不借用原签名给 overlay 背书。
- 安装、升级、回滚仍走原有签名/锁/历史门禁；卸载清除来源收据。自动更新对比实际安装版本，不把可能过期的收据版本当作运行版本。
- 未签名旧插件继续兼容原来源元数据；没有自动给第三方插件签名或批准其版权。

外部收据不是授权凭据，也不是产物与收据跨文件原子事务的保证。磁盘断电全矩阵、安装收据修复、完整团队插件互操作仍需专门测试。

同时收紧远程 Marketplace 保存记录的路径边界：刷新和移除前校验 root/catalogPath 必须留在该项目专用缓存、不能是缓存总根且不能穿过符号链接。伪造状态不能让刷新覆盖或删除任意本地目录；移除关联插件仍保留原历史。

## 3. 密钥 stdin 导入、CLI/IDE 一致性与进程取消

```powershell
your-approved-secret-manager-command | ccpt credentials set company-responses --stdin
```

上面是示意管道，左侧须换成公司批准的安全取密命令，不要 `echo` 一个真实 Key 到命令历史。`--stdin` 与 `--from-env` 二选一；输入为最多 16,000 字节的严格 UTF-8，拒绝可见终端输入。后端仍是上一批的 Windows DPAPI，密钥不放 argv 或 settings。字符串在进程内存中的生命周期不等于硬件或独立凭据进程隔离。

CLI 与公开 SDK parser 共享最新 value-taking 参数表，SDK 的版本号从 package metadata 读取，修复旧值 `0.34.0`；补齐 print/短别名、裸 resume、覆盖层、审批版本、stdin 等参数解析。旧 IDE review 的非法决策值现在显式拒绝，不再默认为“请求修改”或“拒绝”。

新增真实父/子/孙进程取消和超时测试，覆盖当前 Windows 普通继承进程树。**这不是 Windows Job Object、OS 沙箱或恶意脱离进程树的逃逸测试完成证明。**

## 4. 验证和更新

新增测试：`mcp-interaction.test.ts`、`signed-marketplace.test.ts`、`safety-followup.test.ts`。包括真实 stdio 子进程、两阶段审批/拒绝、原生 Responses 回传、超限、取消、签名不变、被篡改/撤销/overlay 拒绝及受保护密钥 stdin 导入。

最终完整回归：**500 通过，0 失败**（隔离用户状态，耗时约 244 秒）。类型检查、构建、npm 打包预检均通过。编译后的 Node CLI/SDK 另行通过 stdin DPAPI、两阶段采样拒绝/批准、原生 Responses 隔离、表单回调、参数/版本，以及签名 Marketplace 安装/升级/验签/卸载验证；只发生两次本机模型 fixture 请求，没有公司或付费模型调用。

```powershell
npm run check
npm run build
bun scripts/regression-single-process.ts
bun scripts/verify-packaged-interactions.ts
npm pack --dry-run
```

独立证据位于 `.ccpt/platform-interactions-20261017/complete/`。Node 终端验证用受控 `isTTY` fixture 驱动真实 readline 路径，不等于物理 ConPTY、所有终端或像素交互矩阵验收。

要更新本机全局命令，关闭旧 CLI 后：

```powershell
cd C:\Users\55038\CCPT
npm run build
npm install -g .
ccpt
```

上一批 [平台补强说明](PLATFORM-CLOSEOUT-2026-10-17.zh-CN.md) 和 [剩余清单](REMAINING-0.50.zh-CN.md) 的公司真机、跨平台凭据、OS 隔离、来源/许可/NOTICE、完整 MCP/Hook/IDE 矩阵边界继续适用。本批不会自动获得第三方重分发授权。
