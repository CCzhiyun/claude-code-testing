# 0.48：终端管理、会话启动和 Windows MCP 凭据

日期：2026-10-05。此版是增量实现，不是整个企业平台全部生产验收完成。

## 安装与公司模型

```powershell
npm install -g ./ccpt-0.48.0.tgz
cd D:\your-project
ccpt
```

Node.js 20+，无需 EXE。包尚未公开发布；同事拿到本地 tgz 后可直接全局安装。在项目目录启动，先确认工作区信任。

公司模型继续使用现有 settings，详见 [三协议指南](MODEL-PROTOCOLS-0.45.zh-CN.md) 和 [公司默认配置](COMPANY-DEFAULTS-0.44.zh-CN.md)。模型名只是部署标识，不决定协议；Messages、Chat Completions、Responses 必须分别配置实际受信任的 URL、认证和部署能力。没有强制改为任何公司模型。公司 Chat / Responses 不可直接共用错误的端点；不会因为一次 400 就暗中切换到另一个服务器。

CA 可以通过 `network.caFile` 或启动前的 `CCPT_CA_FILE` / `NODE_EXTRA_CA_CERTS` 设置；显式 settings 优先。只接受公开 CA，不能把 mTLS 私钥、API key 或 token 嵌入包。已有构建命令 `npm run build -- --ca-file <public-ca.pem>` 支持经批准的公开 CA 链；普通构建不含公司 CA。代理与 mTLS 继续按既有网络配置。参考 [企业接入/CA 打包](PLATFORM-0.41.zh-CN.md)。

## 启动与临时参数

```powershell
ccpt -c
ccpt -r session_0123456789abcdef
ccpt -c --fork-session
ccpt --model your-deployment --effort low
ccpt --tools default
ccpt --tools "read_file,search_files"
ccpt -p "回答这个问题" --tools "" --output-format json
ccpt -p "继续任务" -c --fork-session --output-format stream-json
```

- `-c` / `--continue` 选择当前工作区最近保存的会话；无历史时明确报错。`-r` / `--resume` 需要完整 ID，拒绝其他工作区和仍有活跃 Agent 的会话。
- 交互启动只恢复历史，不调用模型；用户输入新消息才继续。`--fork-session` 保留原会话，复制历史、归档与摘要，独立继续。它必须配合 resume 或 continue。
- `--tools default` 恢复默认目录；空字符串禁用工具；名称列表采用 CCPT 的精确工具名。Agent 自身限制和受管策略依然生效。配置里的 `toolFilter: null` 表示默认目录，`[]` 表示无工具；后台 worker 序列化保留这一区别。
- `--model`、`--base-url`、`--endpoint-url`、`--api-protocol`、`--effort` 为临时运行参数，不重写 settings。显式 effort 开启推理；仍遵守 `chatToolReasoning` 配置，不绕过公司对工具与 reasoning 的限制。切换部署优先使用完整且独立的 settings 文件。
- `--max-budget-usd` 是已有 `--budget-usd` 的别名，不能同时传入；需要配置实际部署的成本价格。预算不是供应商精确账单。
- 既有 `--settings`、`--mcp-config`、`--agents`、`--plugin-dir` 临时覆盖继续可用。管理员配置最后应用。`--no-session-persistence` 仅 print 可用，不能续接/分叉；它使用可清理的临时本地状态，不承诺零磁盘或供应商零保留。

## Windows MCP 凭据保护

用户 settings（默认 `%USERPROFILE%\.ccpt\settings.json`；配置 `CCPT_HOME` 时位于该目录）增加：

```json
{
  "mcpCredentialBackend": "windows-dpapi"
}
```

`/config` 可搜索 `MCP credential storage`，Windows 上切换后保存。项目/管理员设置仍可覆盖用户设置。为防混淆，团队应统一选择全局或管理员策略，不能不同项目反复切换后端。

旧版 token 明文存储在 `mcp-tokens.json`。切换设置不会自动迁移，也不会自动回退。显式执行：

```powershell
ccpt mcp migrate-credentials
ccpt mcp oauth-login your-server
ccpt mcp logout your-server
```

迁移先写 `mcp-tokens.dpapi.json`，成功后清空旧文件记录；已有 protected token 优先，旧副本不覆盖已续期凭据。中途断电可能留下旧明文副本，需检查并再次迁移。备份文件也应按凭据政策处理。迁移不包括模型 API key，后者继续使用环境变量/公司身份系统。

凭据 helper 使用固定系统 PowerShell 脚本和 Windows DPAPI `CurrentUser`；秘密只经 stdin，不进命令行参数、环境或临时明文文件。保护/解密失败、篡改、不可用的平台均失败关闭，不降级明文。迁移/登录/刷新/退出统一使用选定后端；同服务器刷新和跨服务器写入使用文件锁，避免并发 token 丢失。device-flow 轮询等待可取消，拒绝非法时序，单次授权最长一小时，拒绝 HTTP 错误响应中混入的 token。

Windows `.cmd` 对内联 JSON 引号可能进行二次解析，团队脚本优先 `--settings path/to/settings.json`，不要在命令行放密钥或 token。

默认仍是 `file`，以保持跨平台兼容。`windows-dpapi` 是用户绑定的加密文件，**不是 Windows Credential Manager，也不是 OS 沙箱**。同用户恶意进程可能解密；不能靠它阻止已经能以该身份执行的任意命令。更换 Windows 用户/用户配置文件或状态路径后可能无法解密，应重新授权；不保证跨机器备份可直接使用。不承诺 JavaScript 内存中的秘密彻底擦除。参考 [Microsoft DPAPI 文档](https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.protecteddata?view=netframework-4.8)。

## 终端 MCP 与 Plan

MCP 通知可通过 `/mcp watch <server>` 启动，`/mcp watches`、`/tasks`、Ctrl+T 查看，详情页确认停止；`/mcp events <id>` 查看脱敏通知。监听不阻塞聊天，通知不自动进入模型。加载新的网络/权限/Hook/服务器/凭据后端配置时撤销旧连接，退出终端等待清理。范围和限制见 [MCP TUI](MCP-TUI-0.48.zh-CN.md)。

Plan 执行已修复完成状态发布顺序：先保存关联 Plan，再发布 Agent completed。取消仍不被过期 worker 覆盖。获批计划不会把 restricted 自动升级 normal。此修复不构成跨文件 ACID 事务或断电恢复保证。

验收结果和明确的未完成项见 [0.48 剩余清单](REMAINING-0.48.zh-CN.md)。
