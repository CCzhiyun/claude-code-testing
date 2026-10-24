# CCPT 0.41：限流恢复、团队控制与公司 CA 打包

本版是可测试的增量，不是所有企业验收项已关闭。剩余风险见 [验收清单](REMAINING-0.41.zh-CN.md)。公司模型三种协议与 Responses 配置继续参考 [接入指南](AZURE-RESPONSES-0.40.zh-CN.md)。

## 安装与启动

```powershell
npm install --global ./ccpt-0.41.0.tgz
cd D:\your-project
ccpt
```

运行需要 Node.js 20+，不需要 EXE；从源码构建另需 Bun 和项目依赖。安装不会替你更换现有模型或公司凭据。包尚未发布到公共 npm registry。

## 可以把 ca.pem 放进安装包吗？可以，但仅限公开 CA

在源码根目录执行：

```powershell
npm ci
npm run check
npm run build -- --ca-file "C:\Company PKI\ca.pem"
npm pack
```

构建生成 `dist/certs/company-ca.pem` 与证书摘要文件；npm 包包含它们。CLI、SDK、MCP 入口在没有外部 CA 配置时自动使用它。构建会检查 PEM、CA 属性、当前有效期，拒绝私钥和其他混入内容；运行时检查文件 SHA-256。该摘要不是数字签名，不能抵御同时篡改包和摘要。

不要把 mTLS 客户端私钥、API key、访问令牌打入包。公开 CA 证书不含私钥，但嵌入它会向所有安装者分发企业信任根，须经过公司批准，通过私有 registry 或内部包渠道分发。它也不意味着第三方源码已获重分发授权。

普通 `npm run build` 会移除上述两个生成文件，避免意外带入旧公司 CA；不会删除你提供的原始证书。证书轮换时应重建包，或使用外部配置覆盖：

```powershell
$env:CCPT_CA_FILE = 'C:\Company PKI\ca.pem'
ccpt
```

也可在用户或项目 settings 中配置：

```json
{
  "network": {
    "caFile": "C:/Company PKI/ca.pem",
    "proxyUrl": "http://proxy.company.example:8080",
    "clientCertFile": "C:/Company PKI/client.pem",
    "clientKeyFile": "C:/Company PKI/client-key.pem"
  }
}
```

只填写公司确实需要的字段。外部 settings 的 `caFile` 优先于 `CCPT_CA_FILE` / `NODE_EXTRA_CA_CERTS`，受管配置最后应用；内置证书仅为缺省回退。`CCPT_DISABLE_BUNDLED_CA=1` 禁用内置回退，也可显式设置 `network.caFile: ""`。TLS 校验仍开启。这不能替代公司 CA 链、代理、mTLS、Azure 和后台 worker 的真实握手验收。

## TPM / RPM：等待，不关闭会话

TPM 是每分钟 token 配额，不是上下文窗口。90% 提醒、严格超过 95% 自动 compact 的逻辑保持不变；不会因为一个 TPM 错误就清空聊天或自动压缩历史。

三种模型协议共用以下逻辑：

- HTTP 429、502、503、529 的可重试错误进行有界等待；尊重 `Retry-After`、毫秒重试头，没有时使用指数退避和随机抖动。
- 默认最多 3 次重试、累计等待 120 秒；等待可以取消，TUI 和 stream-json 会显示重试事件。
- 不把账户额度耗尽、明确禁止重试的响应当作普通限流；服务端要求的等待超出预算时不提前重试。
- 已输出正文/思考片段的请求不自动重放，防止重复输出或执行。
- 重试耗尽或配额需要处理时，Agent 进入 `waiting_for_input`，保留会话，修正配额后可继续。

可选配置示例（数字只是示例，必须按实际部署额度调整）：

```json
{
  "modelRetry": {
    "maxRetries": 3,
    "maxWaitMs": 120000,
    "baseDelayMs": 500,
    "requestsPerMinute": 30,
    "tokensPerMinute": 200000
  }
}
```

本地 RPM/TPM 按端点、模型和凭据作用域通过文件锁在共享 `CCPT_HOME` 的 worker 间协调。不是跨机器配额服务器。TPM 使用输入估算加最大输出预留，可能偏保守；单次请求已超过本地 TPM 时会说明原因并保留会话，盲目等待无法使它变小。

实现参考了用户提供的参照源码中的等待/取消思路，并独立实现；错误分类依据 [API 错误指南](https://developers.openai.com/api/docs/guides/error-codes) 和 [速率限制说明](https://platform.claude.com/docs/en/api/rate-limits)。没有复制整个重试实现，也不声称行为完全等价。

## 请求、token、金额预算

```json
{
  "spending": {
    "maxRequests": 100,
    "maxTokens": 1000000,
    "maxCostUsd": 5,
    "prices": {
      "your-deployment-name": { "inputPerMillion": 1, "outputPerMillion": 3 }
    }
  }
}
```

价格以 USD/百万 token 为单位，上面是虚构示例，不是任何模型报价。设置金额上限必须为准确的模型/部署名提供价格，否则拒绝启动该请求。预算以团队会话为作用域，worker 使用文件锁共享预留；请求前预留最坏配置量，完成后按服务端 usage 结算。HTTP 429 明确拒绝生成时释放 token/金额预留，但请求次数仍计入；网络结果未知、取消或缺少 usage 时保守保留预留。

`ccpt budget <team-session-id>` 查看账本；`--max-requests 20`、`--budget-usd 2` 是临时覆盖。`/usage` 标明配置价格估算。它不是供应商账单：缓存折扣、额外工具费用和其他应用用量不在精确核算范围。耗尽时等待处理，不关闭聊天。

## 双向 stream-json 与临时配置

```powershell
ccpt -p --input-format stream-json --output-format stream-json --settings ./run-settings.json --mcp-config ./run-mcp.json --strict-mcp-config --tools read_file,search_text
```

stdin 每行一个 JSON，程序运行期间可继续写入：

```jsonl
{"type":"user","message":{"role":"user","content":"分析当前模块"}}
{"type":"user","message":{"role":"user","content":"基于刚才的结论继续"}}
{"type":"cancel"}
```

同一次启动中的顺序消息延续同一 Agent/会话；cancel 在当前工作期间处理，不排队等模型完成。最多积压 16 条消息，单帧 1 MiB；当前仅支持文本用户输入，不接受伪造 system/tool 消息。输出是 CCPT `schema_version: 1` 的 runtime/result/control_result 事件，不承诺与其他 CLI 协议完全等价。

临时覆盖不会写回 settings，受管策略最后生效：

- `--settings <JSON或文件>`：一般配置，不允许通过该入口注入 `env`。
- `--mcp-config <JSON或文件>`：`{"mcpServers":{...}}`，可重复；`--strict-mcp-config` 排除非受管的已有/插件 MCP。
- `--plugin-dir <目录>`：插件集合目录，必须处于受信任工作区。
- `--agents <JSON或文件>`：按名称映射 Agent 定义，例如 `{"reviewer":{"description":"只读审查","prompt":"检查问题，不改文件","tools":["read_file","search_text"]}}`。
- `--tools read_file,search_text`：与 Agent 自身权限求交集，不授予额外能力。

`-p --no-session-persistence` 使用临时状态目录，正常结束或抛错后清理，不留下可恢复会话；Responses `store` 被关闭。不能与 resume/fork/worktree 一起使用，不允许后台 Agent、后台 shell 或异步 Hook。不是“全过程不落盘”：运行期间有临时文件，强制杀进程可能残留；代码改动、外部日志和供应商保留策略不会被抹掉。

## Skills 与插件

```powershell
ccpt skill mode team-review auto
ccpt skill mode team-review manual
ccpt skill mode team-review disabled
ccpt plugin lock ./.ccpt/plugins/team-kit
ccpt plugin verify
```

Skill 三态分别为自动匹配、仅显式调用、完全禁用；`disable-model-invocation: true` 的 Skill 默认 manual。终端 `/skills` 保留 Space 开关、Enter 保存，并增加 `m` 切换 auto/manual。

`plugin lock` 将审核过的本地插件版本和 SHA-256 写入 settings 的 `pluginLocks`；加载前核验，复制安装也先在暂存目录核验再启用。管理员应设置 `requirePluginLocks: true` 并管理锁清单，否则未锁定的新名字仍可按通常策略加载。摘要锁不是发布者签名，不提供来源身份、许可授权或完整回滚机制。

## 取消与隔离边界

前台模型 HTTP、同步 Hook、MCP stdio 和受控命令响应 Agent 取消；后台 worker 读取持久化取消状态。Windows 对当前进程实际拥有的 ChildProcess 调用进程树终止，POSIX 使用独立进程组，不再根据磁盘里的旧 PID 随意杀进程。MCP 关闭等待进程与管道退出。

这不是 OS 安全沙箱，也不等于任意恶意子进程无法逃逸。异步 Hook 是独立后台工作。Windows 的实际父子进程取消已有本地测试，其他 OS、主动脱离进程树、容器/Job Object 等仍需补充验收。
