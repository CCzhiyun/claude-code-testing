# 0.49：MCP 授权和插件版本恢复

日期：2026-10-06。本版为增量实现，不代表全部企业 P0 和 AC 均已生产验收。

## 安装、启动与公司模型

```powershell
npm install -g ./ccpt-0.49.0.tgz
cd D:\your-project
ccpt
```

需要 Node.js 20+，无需 EXE。包未公开发布；通过经批准的渠道交给同事。未修改当前全局安装、模型或凭据。构建命令仍是 `npm run check`、`npm test`、`npm run build`、`npm pack`。

公司 Messages、Chat Completions、Responses 继续分别配置实际 URL、认证、部署和能力限制，见 [三协议配置](MODEL-PROTOCOLS-0.45.zh-CN.md)、[公司默认配置](COMPANY-DEFAULTS-0.44.zh-CN.md)。模型名不能证明部署支持哪种协议。本批未访问公司端点或发送付费 GLM 请求。

CA 支持 `network.caFile`、`CCPT_CA_FILE`、`NODE_EXTRA_CA_CERTS`。普通包不含公司 CA；经批准后用 `npm run build -- --ca-file D:\approved\ca.pem` 打包公开 CA 链，不允许嵌 token/API key/mTLS 私钥。代理/mTLS/Entra 见 [公司接入](PLATFORM-0.41.zh-CN.md)。既有 90% 提醒、超过 95% 自动压缩继续保留，不主动关闭对话；保留原始历史与最近工具边界，不承诺零信息损失。

## MCP 授权码登录

项目 `.ccpt/settings.json` 新字段示例，合并而不是覆盖已有 model/network 设置：

```json
{
  "mcpCredentialBackend": "windows-dpapi",
  "mcpServers": {
    "team": {
      "transport": "http",
      "httpMode": "streamable",
      "url": "https://mcp.example.com/mcp",
      "oauth": {
        "issuer": "https://identity.example.com",
        "clientId": "approved-public-client",
        "scopes": ["tools.read"]
      }
    }
  }
}
```

将地址/clientId 替换为管理员注册值。DPAPI 是可选 Windows 后端，默认仍是文件；受保护后端失败不回退明文，不代表其他 OS 已实现系统钥匙串。

```powershell
ccpt mcp oauth-discover team
ccpt mcp oauth-login team --flow code
ccpt mcp logout team
```

发现过程不携带 MCP token：从 401 challenge 或 well-known 读取资源元数据，然后读取显式固定的 issuer 元数据；核对 resource、issuer、S256 和 public-client。资源元数据限定 MCP 同源，发现的授权/token/注册端点限定 issuer 同源，并受网络策略限制。只允许 HTTPS 或 HTTP loopback，不允许 URL 中带账号/密码/fragment；这是本版安全边界，未声称支持所有复杂企业部署。

不需要发现时可明确配置 `oauth.authorizationUrl`、`oauth.tokenUrl`、`clientId`。此时不声称服务端元数据经过发现验证，但仍用 S256，不因发现失败降级为 plain PKCE。

本机模式打印授权 URL，在 `127.0.0.1` 临时端口等回调，不自动打开浏览器。服务端须允许该 public client 使用 loopback 回调；如需固定端口，配置 `oauth.redirectUri` 或 `--redirect-uri http://127.0.0.1:8765/oauth/callback`。回调核对地址、随机 state、唯一 code 和可选 issuer；错误 state 不消耗登录，拒绝/取消/超时关闭监听。

无浏览器/远程环境：

```powershell
ccpt mcp oauth-login team --flow code --manual --redirect-uri https://approved.example.com/callback --timeout 300000
```

在可信浏览器打开打印的 URL，将完整回调 URL 粘贴到 CLI 标准输入。回调页必须由企业预先注册并允许安全取得 URL；CCPT 不部署远程回调页面。不要把 code/token 放命令参数或向他人分享回调 URL。pending state/verifier 仅在内存保存，退出/超时不能恢复旧授权。

没有 clientId 时，只有明确 `--register` 才会调用固定 issuer 的注册端点。只接受 public client，拒绝 client-secret/confidential 响应。不保存注册管理 token、不支持注册撤销；重新登录可能再次注册，企业应优先预注册固定 clientId。

token 绑定原 resource/clientId/tokenUrl 和发现时 issuer；换资源/client/issuer 需重新授权。续期携带原 resource，异常响应不覆盖旧凭据，过期且不能续期要求重登录；错误不传播原始凭据文本。`--flow device` 保留旧 device flow。本版不提供完整 OIDC fallback、所有 MCP 版本等价或 sampling/elicitation 自动授权执行。

`mcp add` 新增 `--oauth-issuer`、`--oauth-client-id`、`--oauth-authorization-url`、`--oauth-token-url`、`--oauth-metadata-url`，所有新字段参与 settings 校验。SDK 导出 `discoverMcpOAuth`、`loginMcpAuthorizationCode` 及回调接口。

## 插件历史和回滚

```powershell
ccpt plugin snapshot team
ccpt plugin history team
ccpt plugin rollback team revision_0123456789abcdef --confirm
```

`--scope local` 访问仓库 local 安装，不是用户全局目录；SDK 导出相同操作。终端内：

```text
/plugin snapshot team
/plugin history team
/plugin rollback team revision_0123456789abcdef confirm
/reload-plugins
```

local 用 `/plugin history team local` 和 `/plugin rollback team revision_0123456789abcdef confirm local`。TUI 前台任务运行时拒绝回滚，不为此中断对话；恢复后显式 reload 激活贡献，已启动的后台 Agent 不会被追溯改写。

更新/卸载前保存完整旧字节，回滚前也保存当前版本。历史位于 `.ccpt/plugin-history/<scope>/<name>/<revision>/content`，记录在旁边 `record.json`，不改变插件签名覆盖字节。最多 256 条，不自动删除；达到上限需人工归档已审核旧条目。快照可能含插件配置，插件中不应保存凭据。

回滚不恢复权限：核对历史版本/摘要和当下锁、信任公钥、签名、撤销列表。签名撤销或企业只批准新版本时拒绝回滚，保持当前插件。安装和更新也在激活前检查这些策略。目录名/ID/scope 校验、祖先链接检查和插件互斥减少路径逃逸/并发风险，不是 OS 隔离，不能抵御同权限恶意进程任意改文件。

旧 SDK `pluginOperations` 的安装/更新/卸载也改走同一事务和信任检查。启用/禁用现在写实际的 `disabledPlugins` settings，平台 reload 真正生效，不再仅写旁路 registry 后误报禁用；受管策略仍优先。以前只在 `.registry.json` 保存的 SDK 状态不会自动迁移，请用新 SDK 启用/禁用重新确认预期状态，原文件没有删除。

替换失败恢复旧目录；恢复本身失败则保留备份并报告位置。活跃插件锁不因超时被抢走；断电遗留锁需先确认 owner PID 再人工处理，不承诺自动断电恢复/完整磁盘事务。卸载保留历史，但 rollback 需要有效安装；卸载后可审核历史 content 再直接安装。

Marketplace overlay 修改 manifest/附加元数据，无法保留原 integrity envelope 时明确拒绝重打包。签名原包请 `plugin install ./reviewed-artifact`，不会剥离签名绕过策略。签名 Marketplace 无损发布/收据仍待完善；签名/UNLICENSED 不授予第三方再分发权。

## 新增验证

本地 OAuth HTTP 交换、PKCE/resource、元数据错配、回调重放/重复 code、loopback 关闭、拒绝/取消/超时、显式 public 注册、绑定刷新；实际 CLI 手动授权和确认回滚；插件精确字节恢复、历史篡改、锁/撤销、scope、并发、Windows junction 拒绝与更新/卸载历史均有测试。

它们是本机测试服务器与受控插件，不是公司授权服务器或生产 Marketplace 验收。剩余见 [0.49 清单](REMAINING-0.49.zh-CN.md)。

本次全量回归 401 项通过、0 失败，81 个测试文件、3022 个断言；TypeScript 检查与 Node bundle 构建通过。npm tgz 在隔离目录安装成功，原生 Node 20.9.0 下完成 SDK loopback 和 CLI manual OAuth、PKCE/resource 校验、插件历史/确认回滚及实际启停 settings；Windows npm 命令 shim 的版本/帮助通过。验证脚本为 `scripts/smoke-platform-049.mjs <isolated-npm-prefix>`，只访问本机测试 HTTP 服务，不使用公司端点或凭据。

源码验证脚本附加 `--protected` 时使用真实 Windows DPAPI 后端，已验证原生 Node 下连续 SDK/CLI 登录的加密存取；默认文件后端也通过。源码脚本不包含在 npm 的 dist-only 文件集合中。最终包的公司 CA 仍为空；全量回归后追加 OAuth/凭据/CLI 14 项复测通过。

实现参考 [MCP 2025-06-18 授权规范](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization) 和 [PKCE RFC 7636](https://www.rfc-editor.org/rfc/rfc7636)。本版的 issuer 固定/同源限制属于实现边界，不声明覆盖未来协议版本全部行为。
