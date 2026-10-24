# 2026-10-17 第三批：HTTP MCP、SDK 类型和分发门禁

本批继续补平台缺口，没有访问公司端点、调用付费模型、修改个人 settings、全局安装或发布 npm 包。下述验收使用临时目录和本机 loopback 服务，不代替公司 Azure/代理/证书/身份环境验收。

## HTTP MCP：处理尚未结束的 POST/SSE

原先 stdio 的显式交互现已扩展到协商 `2025-06-18` 的 Streamable HTTP **请求所属 POST/SSE**：

```powershell
ccpt mcp call company-server tool-name --interactive --json '{}'
```

服务器须在 settings 中配置 `transport: "http"`、`httpMode: "streamable"` 和经过审核的 `url`。需要真实终端输入和 stderr TTY；重定向或普通工具调用不自动获得授权。

- 文本 sampling：先展示请求、批准后调用当前配置模型，再展示结果、第二次批准后才发给 MCP 服务。前一步拒绝不调用模型，后一步拒绝不分享生成文本。
- 简单非敏感表单 elicitation：人工提供内容并确认，仍校验字段、必填、类型等约束。不自动提交默认值。
- 模型采样不携带本地工具、当前对话或已有服务端 response 链，且关闭响应存储，限制输出 token。
- 请求/响应方向分开匹配，同数值 client/server ID 不再冲突。回复只能发回原始认证端点，携带原会话和协议头，不信任服务器指定的另一个回复 URL。
- 完整结果到达后结束读取并撤销等待中的审批，不等待服务端永久关闭 SSE。取消/超时尽力发送 `notifications/cancelled`，随后清理会话，不重放原工具。

边界：每会话最多 8 个非 ping 反向请求、同时最多 16 个待处理请求、4096 帧、8 MB 响应，单 SSE 帧限制 100 万字符。重复请求 ID、超限、无效 UTF-8/JSON、截断帧和非法响应封套失败关闭。回复要求服务器返回空 HTTP 202。

**仍未覆盖**：独立 GET 常驻流的交互、POST 自动断线续传、URL elicitation、多模态 sampling、TUI/Agent 内嵌套审批路由。普通 Agent 工具路径、旧版直接 HTTP 和未提供 handler 的 SDK 默认拒绝。GET `mcp watch` 仍是通知读取，不是可以自动调用模型的授权通道。

传输与授权设计参照 [MCP transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports) 和 [sampling](https://modelcontextprotocol.io/specification/2025-06-18/client/sampling)，这里只声称上面列明的子集。

## npm SDK：Node TypeScript 可实际解析的声明

`ccpt/sdk` 现在提供条件 `types` 导出。构建时从 SDK 入口生成完整声明依赖图，SDK 可直接导入 `PlatformConfig`、`AgentRecord`、`McpInteractionHandlers` 等类型：

```typescript
import { callMcpServer, loadSettings, type McpInteractionHandlers } from 'ccpt/sdk';

const config = await loadSettings(process.cwd());
// 必须自行实现可信的人机审批，不能用固定 true 替代审批。
declare const reviewedHandlers: McpInteractionHandlers;
await callMcpServer('company', config.mcpServers.company!, 'approved-tool', {},
  true, undefined, config, reviewedHandlers);
```

消费者需要正常的 Node ESM/TypeScript 环境和 `@types/node`，不需要 Bun 类型。验证脚本会解开**实际 npm tgz**，在独立消费者目录以 strict NodeNext、`skipLibCheck=false` 检查声明及负向类型断言，而不是通过源码路径绕过包导出。

```powershell
npm run build
npm pack --pack-destination <本地目录>
bun scripts/verify-packed-types.ts <实际生成的tgz>
```

## 插件来源收据：只读检查与显式修复

```powershell
ccpt plugin sources
ccpt plugin repair-source team@reviewed-catalog --confirm --scope project
```

`sources` 只检查本地来源收据和当前信任状态，不下载、不根据插件名猜来源。缺失、损坏、过期、未信任与已验证状态分别报告。

修复要求用户明确选择 Marketplace，且选中的本地/缓存产物与已安装版本、内容摘要、完整签名封套完全一致，并通过当前签名/锁定/撤销策略。拒绝路径链接和 manifest overlay，不运行 Git、安装命令或网络下载。只修复外部收据，不改插件原字节，不新增授权。两个不同发布者即使签了相同内容也不能互相冒认来源。

Marketplace 删除不再吞掉卸载错误：失败会报错并保留 Marketplace 记录，已删除插件仍有历史备份。多插件清理仍不是跨文件原子事务，前面成功的清理不会因后面失败自动全部回滚。

## 分发门禁：先核对权利，再发布

```powershell
npm run distribution:inventory
npm run release:check
```

在源码 checkout/CI 中运行：清单记录源码/构建/文档/锁文件摘要及依赖声明，拒绝链接、超大文件并检查私钥标记。`prepublishOnly` 接入检查；普通本地 `npm pack` 不表示获准发布。

参考 `docs/distribution-review.example.json` 建立项目根目录的真实 `distribution-review.json`。只有经授权人员审核来源、依赖、实际 NOTICE、目标 registry、内部/公开范围和嵌入证书后才能填写。内容或依赖变化会使摘要不匹配，须重新审核；内部授权不能用于公开 npm registry。示例默认全部不批准，不是本项目的真实授权结论。

**本项目当前没有提供已审核授权记录和正式 NOTICE，发布检查应阻止发布。** `UNLICENSED`、签名、来源收据、摘要以及人工填写本地 JSON 都不产生第三方重分发权利；该门禁不认证审核人身份，不是法律意见，也不是防恶意管理员篡改的签名证明。

公开 CA 可以按既有显式构建选项嵌入内部包，但必须另行审核分发与轮换；普通包不含公司 CA，私钥/API key/pfx 不得打包。现有兼容层中的旧品牌、第三方种子来源和许可问题仍需独立审查，不能因为技术门禁存在就认定已解决。

## 本批验证与剩余条件

专项测试覆盖实时流、UTF-8 分片、两阶段拒绝、早到终态、取消、超时、同值/重复 ID、错误 ACK、恶意回复 URL、超限/截断，以及来源收据缺失/损坏/发布者不匹配/信任撤销和删除失败恢复。

`bun scripts/verify-http-sdk.ts` 运行编译后的 Node CLI/SDK，实际经过 readline 审批路径、原生 Responses 采样、表单回传和来源修复。TTY 标志仅在测试子进程模拟，因此不是物理 ConPTY/全部终端认证。报告位于 `.ccpt/http-sdk-20261017/final/`；模型请求只到 loopback fixture。

本批最终结果：全量 **516 项通过、0 失败（97 个测试文件）**，TypeScript 检查与构建通过，编译后的 stdio/HTTP CLI 与 SDK 冒烟、实际 npm tgz 的严格类型消费者及 Node ESM 导入通过。首次回归发现旧 CA 构建夹具缺少新增声明阶段需要的真实 TypeScript 编译器；补齐夹具并保留 CA/声明校验后重新全量通过。发布门禁因缺少真实授权记录与 NOTICE 按预期拒绝发布，不把此拒绝计作产品功能测试失败。

仍需真实环境/额外授权的主要项：OS 级隔离与逃逸矩阵、跨平台专用凭据后端、公司 Azure/CA/代理/mTLS/Entra 续期和后台 worker、第三方权利与旧品牌清理、真实 tokenizer/多模态精确计数/1M 大仓基准、完整 MCP 与插件互操作、IDE remote/多窗口，以及获授权的真实 push/PR。不能把这些标为“所有剩余已生产验收”。历史清单见 [剩余表](REMAINING-0.50.zh-CN.md)。
