# 2026-10-17 平台补强：恢复、审批、凭据、诊断与搜索

这一批继续补实际运行链路，不将功能菜单、协议 fixture 或本地回归等同于完整企业验收。没有修改真实用户 settings、密钥或 CA，没有请求公司服务，也没有安装全局包、推送 Git 或创建 PR。

## 本轮实现

| 范围 | 可使用的变化 | 仍有的边界 |
| --- | --- | --- |
| Goal / 唤醒 | 每轮重新加载当前会话的持久 Goal；唤醒查询只读，先保存消息再确认投递；确认中断后按消息标识去重 | 下一次 worker/继续会话时投递，不是 OS 定时服务；不凭模型自述自动完成目标，不新增权限 |
| Plan / IDE | TUI 审批使用所见版本；核心 IDE 审批必须带 `expectedVersion`；并发决策仅一个成功；旧 IDE review 决策不可二次覆盖 | CLI 可显式指定版本；未指定时审批当前版本。VS Code Remote/断线/升级矩阵仍需真机测试 |
| 模型凭据 | Windows DPAPI、端点绑定、引用式配置、前台/后台 worker 统一加载、下一次调用发现删除/轮换 | 仅 Windows；不是凭据进程隔离，也不是 OS 沙箱；同一 Windows 用户下的恶意程序仍可能解密 |
| 本地诊断 | CLI/TUI 导出白名单脱敏报告；不含原始配置、环境变量值、对话、源码、CA/私钥内容；拒绝覆盖 | 只做本地检查，不证明 TLS 握手、公司认证或模型调用成功；转发前仍应检查报告 |
| Hooks | 通用事件/会话/Agent 字段、嵌套 `additionalContext` / `updatedInput` / deny、插件来源错误标签、匹配 payload 上限 1 MB | 不是所有参照 Hook 的 payload/退出码等价；不会把 `allow` 自动提升成人工授权 |
| 插件恢复 | 替换前持久 journal；显式恢复经摘要及当前信任规则校验的旧备份；活进程锁不回收 | 不覆盖现有安装；保留恢复证据。未完成真实断电/磁盘故障全矩阵及签名 Marketplace overlay 无损迁移 |
| Git | 查看真实 unmerged stages；从保留恢复引用创建新的本地恢复分支 | 不自动选择 ours/theirs，不切换/覆盖当前分支，不推送、不创建 PR；不是完整冲突向导 |
| 正则搜索 | 独立 worker 匹配，单文件 500 ms、单次搜索 10 秒、可取消，阻断灾难性正则冻结主线程 | 只覆盖正则内容匹配；不是所有搜索路径/大仓性能的承诺；worker 也不等于 OS 安全沙箱 |
| MCP | 反向请求被拒绝时记录有限方法名及原因，不带原始请求参数 | sampling/elicitation 仍拒绝；完整人工授权与执行尚未打通，不假装支持 |

## Windows 模型凭据配置

配置仍放在用户级 `C:\Users\<你>\.ccpt\settings.json`，或者 `CCPT_HOME` 指定目录中的 `settings.json`。项目/受管理配置可覆盖用户值，诊断时检查最终生效设置。

先选好正确端点和协议。下面是公司 Responses 配置的结构示例；域名、部署名、版本和证书路径均须替换为公司提供的实际值，不能把 Chat 端点直接当作 Responses：

```json
{
  "model": {
    "provider": "openai",
    "apiProtocol": "responses",
    "name": "your-deployment-name",
    "endpointUrl": "https://models.company.example/v1/responses",
    "apiKeyHeader": "api-key",
    "apiKeyPrefix": "",
    "apiKeyEnv": "",
    "credentialRef": "company-responses"
  },
  "network": {
    "caFile": "C:\\company-certs\\ca.pem",
    "rejectUnauthorized": true,
    "allowedHosts": ["models.company.example"]
  }
}
```

若网关使用 `Authorization: Bearer`，按公司说明修改请求头配置。查询参数、API 版本和网关部署路径均可保留在完整 `endpointUrl` 中。现有三协议及网络配置保持兼容，参见 [三协议指南](MODEL-PROTOCOLS-0.45.zh-CN.md)。

在同一工作目录和同一最终配置下，先用安全方式在当前进程设置 `COMPANY_API_KEY`，再导入。不要在命令行参数、日志或源码中填写密钥：

```powershell
ccpt credentials set company-responses --from-env COMPANY_API_KEY
ccpt credentials list
```

导入后可移除当前终端的临时环境变量；前台及后台 worker 都通过引用读取受保护凭据。该命令不会自动修改 settings。`credentialRef` 模式须令 `apiKeyEnv` 为空，且不能同时配置认证头的 `headersFromEnvironment`。它与原有环境变量模式是两种选择，不是自动混用。

凭据绑定完整有效 URL（包括路径/查询参数），换网关、协议端点或 API 版本后须显式重新导入；Chat 和 Responses 建议使用不同引用。删除后下一次请求失败关闭，已在途的请求不会被远端撤销：

```powershell
ccpt credentials remove company-responses
```

密文在用户状态目录 `model-credentials.dpapi.json`；只能在相应 Windows 用户/机器条件下读取。不要把它当作团队共享密钥分发方案。macOS/Linux 本轮没有实现模型受保护凭据后端，不会静默降级为明文文件。

## 诊断、唤醒、插件与 Git

```powershell
ccpt doctor export support-20261017.json
ccpt wakeups
ccpt wakeups cancel wakeup_ID
ccpt plan approve plan_ID --expected-version 3
ccpt plugin transactions
ccpt plugin recover replace-TRANSACTION --confirm
ccpt agents conflicts
ccpt agents recovery-list
ccpt agents recover refs/ccpt/recovery/RETAINED_REF recovery/my-task --confirm
```

`agents recover` 必须使用 `recovery-list` 实际返回的完整引用；示例不是可直接使用的引用。恢复只新建本地分支，之后由工程师审查内容并决定是否整合。

终端内可用 `/doctor export support.json`、`/wakeups`、`/wakeups cancel ID`、`/agents conflicts`。插件事务恢复和 Git 恢复分支本轮通过 CLI/SDK 提供，不宣称所有入口均有独立 TUI 面板。

插件恢复仅处理有合法 journal、已验证旧备份且目标安装缺失的事务。拒绝活进程、未知状态的锁、被篡改备份或已有目标；不强删锁、不清除证据、不执行恢复插件脚本。

## 验证与仍未完成的 P0

本轮完整回归：**483 通过，0 失败**，使用隔离用户状态、真实本地 Git 与本机模型/MCP fixtures。新增专项覆盖 Windows 实际 DPAPI、前台/后台 worker、Azure 风格 `api-key` 原生 Responses、Plan 12 路并发 CAS、实际 CLI/IDE、恶意正则、唤醒确认中断去重及插件事务/锁恢复。

可重跑：

```powershell
npm run check
npm run build
bun scripts/regression-single-process.ts
bun scripts/verify-packaged-closeout.ts
npm pack --dry-run
```

编译后 `node dist/cli.js` 验证已通过：加密导入、诊断脱敏/不覆盖、Azure 风格请求头的原生 Responses、前台和独立后台 worker、运行配置不含明文密钥、删除凭据后不发送请求。只产生两次本机模型 fixture 请求，不是公司接入验收。证据写入 `.ccpt/platform-closeout-20261017/final/`。类型检查、构建和 npm 打包预检也通过；未新增真实 TPM、tokenizer 或账单准确性声明。

仍需专门推进：OS 级隔离及逃逸/进程树矩阵、跨平台凭据后端、第三方来源/许可/NOTICE 与重分发授权、公司 Azure/CA/代理/mTLS/Entra 续期真机矩阵、准确多模态计数与 1M 大仓质量基准、MCP 反向人工授权、完整 Hook/插件互操作与 IDE 远程多窗口矩阵。`UNLICENSED` 不提供第三方再分发许可。

## 更新本机 CLI

本轮没有替你执行全局安装。要让 CMD/PowerShell 的 `ccpt` 使用最新源码：

```powershell
cd C:\Users\55038\CCPT
npm run build
npm install -g .
ccpt
```

向团队分发前应完成许可审查；批准后可 `npm pack` 生成 npm 包，团队通过 `npm install -g <实际包路径.tgz>` 安装。仍不需要 Windows EXE。普通构建不嵌入公司证书；如要嵌入，只能使用已获批准分发的公开 CA，绝不能嵌入私钥/API Key。
