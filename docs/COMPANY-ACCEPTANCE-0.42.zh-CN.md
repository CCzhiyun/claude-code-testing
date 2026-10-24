# 0.42 公司接入验收：与 GLM 公网分开测试

## 结论与真实记录（2026-09-23）

使用本机已配置的 `glm-5.3-flash` 和对应 GLM 凭据，由 CCPT 新增的 CLI 模型测试入口发出请求，得到：

| 网关/协议 | 实测结果 |
|---|---|
| GLM `/api/anthropic/v1/messages` | 流式回复、一次安全 echo 工具调用和工具结果回传成功 |
| GLM `/api/paas/v4/chat/completions` | 流式回复、一次安全 echo 工具调用和工具结果回传成功 |
| GLM `/api/paas/v4/responses` | HTTP 404，不能标记为可用；不据此断言所有 GLM 产品/私有网关都不支持 |
| 公司 `tss-aicode-sit.ccptazure.biz:8053` | 本机 Node DNS 检查返回 ENOTFOUND；未到鉴权/模型阶段。按用户要求，后续交由公司同事在内网验证 |

GLM 的两种已通过协议不能证明公司 Responses 已通过。Responses 与 Chat Completions 的请求和返回格式不同，见 [OpenAI 官方迁移说明](https://developers.openai.com/api/docs/guides/migrate-to-responses)。不要通过偷偷切换协议把失败显示成成功。

截图中的 HTTPS 完整地址是：

```text
https://tss-aicode-sit.ccptazure.biz:8053/responses/v1/responses
```

截图另有 HTTP 8050 入口；本诊断拒绝向非 loopback HTTP 地址发起模型测试，避免明文传输密钥。没有使用 GLM 密钥请求公司网关，也没有发送仓库代码。

## 给公司同事的步骤

此包仅是技术测试候选。第三方源码/插件的重分发许可审核仍未关闭；先走公司授权流程，不要公开发布。

1. 安装 Node.js 20+ 和已获授权的测试包：

```powershell
npm install --global ./ccpt-0.42.0.tgz
ccpt --version
```

2. 连接公司网络/VPN。将同目录的 `company-responses.settings.example.json` 复制为 `company-responses.settings.json`，核对字段：

- `name` 当前按用户要求填 `gpt-5.6-luna`，必须是公司网关真实配置的部署名；不是看到模型名字就保证有该部署。
- `endpointUrl` 填完整接口，不再加 `/responses`。如果管理员要求 `api-version`，在此 URL 加上准确查询参数，不猜测版本。
- 默认按 `api-key` 鉴权；若网关要求 Bearer，将 `apiKeyHeader` 改成 `authorization`，`apiKeyPrefix` 改成 `Bearer `。不要同时盲目发送两种密钥头。
- `maxContextTokens: 128000` 是模板占位值，不是该部署窗口的事实；请按管理员给出的限制调整。
- CA 从 `CCPT_CA_FILE` 环境变量或 `network.caFile` 获取。代理/mTLS 可按 [0.41 指南](PLATFORM-0.41.zh-CN.md) 添加，不能关闭证书校验凑成功。

3. 在本机安全配置 `AZURE_OPENAI_API_KEY`，不要把密钥发到聊天或提交进仓库。PowerShell 可从隐藏输入设置当前进程环境：

```powershell
$secureApiKey = Read-Host 'Company API key' -AsSecureString
$env:AZURE_OPENAI_API_KEY = [System.Net.NetworkCredential]::new('', $secureApiKey).Password
$env:CCPT_CA_FILE = 'C:\Company PKI\ca.pem'
```

没有自定义 CA 时省略最后一行。环境变量依然是进程可读的凭据载体，不是 OS 凭据保险库；用后关闭终端或移除变量。

4. 分层验收：

```powershell
ccpt model test --settings ./company-responses.settings.json --connectivity-only
ccpt model test --settings ./company-responses.settings.json
ccpt model test --settings ./company-responses.settings.json --stream --tools-check --timeout 60000
```

第一条只发送不带模型鉴权的 HEAD，不计作模型通过；即便返回 401/404/405，`http-reachable` 仅表示收到了 HTTP 响应。后两条分别调用一次、两次模型，可能计费；输出应为 `ok: true`，工具测试另应有 `toolRoundTrip: true`。诊断用固定短文本和本地 echo，不读取仓库、不运行 Skills/Hooks/MCP/真实代码工具，也不修改选中的默认模型或保存的聊天。

`--stream` 请求流式处理；`textDeltaCallbacks` 是回调次数，不能单凭它断定服务端一定用了 SSE（兼容服务器也可能回 JSON）。成功只说明该次部署与请求成功，不代表所有多模态、超长上下文、企业矩阵都已验收。

失败分层：`dns` / `connection` 查 VPN、DNS、端口、代理；`tls` / `certificate-files` 查 CA 和 mTLS；`credentials` 查缺失环境变量；`authentication` 查密钥/头/权限；`route-or-deployment` 查完整路径和部署名；`capacity` 查配额。错误报告不输出原始服务端正文或凭据。

5. 验收通过后，在实际项目启动：

```powershell
cd D:\your-project
ccpt --settings C:\config\company-responses.settings.json
```

临时配置优先于普通设置，但企业受管配置最终生效。完成测试后向维护者提供脱敏的诊断 JSON，不需要提供 API key。

## 0.42 新增插件发布者签名

插件现支持 Ed25519 发布者签名，配合现有版本/摘要锁使用：

```powershell
ccpt plugin sign ./.ccpt/plugins/team-kit --key-file C:\secure-signing\team-private.pem --key-id team-2026
ccpt plugin lock ./.ccpt/plugins/team-kit
ccpt plugin verify
```

仅在已审核插件上签名。签名私钥必须位于插件目录之外，绝不能打包。由管理员在受管 settings 配置：

```json
{
  "requirePluginSignatures": true,
  "requirePluginLocks": true,
  "pluginTrustKeys": {
    "team-2026": "-----BEGIN PUBLIC KEY-----\n实际Ed25519公钥内容\n-----END PUBLIC KEY-----\n"
  },
  "revokedPluginKeys": [],
  "pluginLocks": {
    "team-kit": { "version": "1.0.0", "digest": "实际审核得到的64位SHA256" }
  }
}
```

以上公钥/摘要占位文本必须替换，否则校验故意失败。高优先级的 `pluginTrustKeys` 整张表替换低优先级表，防止项目给受管信任表追加自己的发布者。撤销时将 key ID 加进 `revokedPluginKeys`，重新加载平台时该签名插件被拒绝。不会追溯取消已经启动的外部进程。

未签名（启用强制时）、未知/撤销发布者、签名伪造和内容篡改均不得激活贡献。该实现不包含硬件签名服务、自动密钥轮换、时间戳服务或一键版本回滚。签名只证明可信密钥对内容的认可，不证明代码安全或授予第三方许可。

## 尚未完成

本轮本地验证：TypeScript check、Node bundle build 通过；全量 323 项测试通过、0 失败（65 个文件、2180 个断言）。最后加入的 TLS 校验保护另经 8 项针对性测试复测通过（39 个断言）。这不等于公司环境验收。

本轮补的是独立诊断与插件签名/撤销，其他 [0.41 剩余清单](REMAINING-0.41.zh-CN.md) 继续有效：OS 级沙箱、专用凭据后端、许可/NOTICE、精准 tokenizer/语义摘要/1M 基准、MCP 常驻 SSE 与完整 OAuth/授权、多 Agent 断电/冲突/审批压力、完整 IDE 实机矩阵等，不能标成“全部完成”。
