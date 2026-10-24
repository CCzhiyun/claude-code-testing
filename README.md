# CCPT

CCPT 是一个可通过 npm 安装的多 Agent Coding CLI 与团队扩展平台。它提供全屏终端聊天、代码工具、后台 Agent、Git Worktree、会话、记忆、Skills、Plugins、MCP、Hooks、权限策略、审计和 VS Code 集成。

完整安装、启动、命令、功能和故障排查手册见 [docs/PRODUCT-GUIDE.zh-CN.md](docs/PRODUCT-GUIDE.zh-CN.md)。

0.71.0 修复服务端输入计数被本地估算再次拦截、reasoning 子集漏记及终端上下文计数不一致；增加长密集文本 BPE 有界计算、Chat 工具/推理冲突提示，以及 `/doctor errors` 和可导出的脱敏模型错误记录。见 [0.71 安装与排错](docs/DELIVERY-0.71.zh-CN.md)。

0.70.0 优先补 MCP/插件/上下文：遵守 SSE retry 的可取消 GET 续传、真实目标 MCP 只读验收、带认证/流级授权的审计 collector、撤销/损坏插件的签名修复切换、插件读取资源限制、Responses 服务端输入计数驱动 90/95 阈值、摘要关键事实门禁及有预算的模型质量评测。见 [0.70 使用与配置](docs/DELIVERY-0.70.zh-CN.md)、[三个方向与其他平台剩余](docs/REMAINING-0.70.zh-CN.md)。

0.69.0 增加跨调用业务幂等、可审批的签名插件 rollout、可选持久事件重放及 TUI/IDE 查看、launcher 依赖绑定、自定义 BPE 预切分与特殊 token、显式音频输入，以及有预算的部署验收命令和真实 1M 本地计数基准。见 [0.69 使用说明](docs/DELIVERY-0.69.zh-CN.md)、[缺口、环境验收及不可承诺的保证](docs/REMAINING-0.69.zh-CN.md)。不把配置/fixture/本地验证当作公司生产验收，也不将剩余安全和许可事项冒称全部完成。

0.62.0 增加 Goal Run 本地人工审批向导与 IDE 管理入口、Git 恢复引用有界保留/先备份后原子清理/显式远程备份、MCP 固定来源 URL 同意与 SDK 多模态两阶段批准，以及 FileChanged 显式 watchPaths 的授权更新。源码已迁移到 `D:\project\CCPT`。见 [0.62 使用说明](docs/DELIVERY-0.62.zh-CN.md)、[完整剩余与验收边界](docs/REMAINING-0.62.zh-CN.md)。不把本地模拟端点、临时仓库或进程测试称为公司/跨 OS/物理 IDE 验收。

0.61.0 修复直接 Goal 恢复，并新增独立签名 overlay、多插件/收据版本集 CAS 切换/回滚、MCP GET 人工交互/有界嵌套/可选 POST SSE 续传、macOS/Linux 原生凭据、本地 HMAC 审计、二进制/删除冲突暂存、显式真实文本 BPE，以及 opt-in Linux 隔离后端与真机探针。见 [0.61 使用说明](docs/DELIVERY-0.61.zh-CN.md)、[原编号与九领域剩余](docs/REMAINING-0.61.zh-CN.md)。目标 OS/公司环境、集中审计与来源授权仍需独立验收，未称全平台生产完成。

0.60.0 按原始 A1–H4 编号补后台批准 Plan/Goal 工作流（原会话、共享预算、准确一次审批续行）、外部操作写前收据与 MCP 幂等/查询/显式补偿、原 HEAD Git revert、nonce 绑定的 native 调度中断恢复、可选脱敏运行正文、MessageDisplay/CwdChanged/外部文件监听，以及活动 Agent 的撤权边界。见 [0.60 使用说明](docs/DELIVERY-0.60.zh-CN.md)、[原编号验收与剩余](docs/REMAINING-0.60.zh-CN.md)。代码实现与目标环境验收分开记录；不把这些功能称为全平台或 A1–H4 全部生产验收完成。

0.59.0 将本轮限定的 12 个工程子项中 8 项接入实际路径：job 绑定唤醒、版本化 Goal 暂停/阻塞/恢复、工作区隔离聊天预览、持久运行元数据游标、IDE 历史恢复，以及目录加入、内置文件修改、懒加载规则 Hook。见 [0.59 操作说明](docs/DELIVERY-0.59.zh-CN.md)、[剩余清单](docs/REMAINING-0.59.zh-CN.md)。这是本轮范围的 8/12，不是整个平台完成率；历史恢复不重放模型/工具，不是无损完整运行流。

0.58.0 继续补显式受限调度 Agent 与 Linux/macOS 当前用户调度：跨唤醒共享请求/token 预算、运行次数上限、独立只读报告、未知执行不重放；systemd/launchd 定义及显式注册/校验卸载。见 [0.58 操作说明](docs/DELIVERY-0.58.zh-CN.md)、[当前全部剩余](docs/REMAINING-0.58.zh-CN.md)。不是通用无人值守 Coding/Goal 引擎，也没有把跨 OS 实机或公司环境当作已验收。

0.57.0 按 12 个剩余工程子项落地其中 6 项：定时任务清单/状态/CAS 升级重绑/校验卸载；持久通知中心与 CLI/TUI/IDE 入口；Team 清理/邮箱读回执/成员元数据补发；真实 StopFailure；Stop 补充反馈的有界继续执行；授权注册表变更监听。见 [0.57 操作说明](docs/DELIVERY-0.57.zh-CN.md)、[当时的 12 项对照](docs/REMAINING-0.57.zh-CN.md)。这不是整个平台“完成 50%”或企业环境验收声明。

0.56.0 继续补自动化、Plan/Teams、Skills/Hooks：显式 Windows 定时启动定义及安全上下文投递、IDE 元数据事件游标补发、全局扩展根授权/撤销，以及真实 Agent/压缩/模型切换 Hook 触发点。见 [0.56 安装与功能](docs/DELIVERY-0.56.zh-CN.md)。定时器不自动执行付费模型或工具，元数据补发不重放聊天/审批，未宣称全部参照事件兼容。

0.55.0 补离线 Git 恢复备份/异仓库新分支导入、扩展变更空闲后重载与 settings 根重订阅、Teams 任务/只读邮箱刷新，以及无 journal 插件残留的可恢复隔离。见 [0.55 安装与功能](docs/DELIVERY-0.55.zh-CN.md)。没有自动上传备份或推断残留安装授权。

0.54.0 补跨进程 Hook once、IDE 退避重连/快照恢复、Teams 新成员/Plan 自动同步、配置内自定义目录监听、检查点恢复和二进制/删除冲突检查。见 [本轮安装与功能](docs/DELIVERY-0.54.zh-CN.md) 和 [仍未完成清单](docs/REMAINING-0.54.zh-CN.md)。重连不会重发聊天/审批，状态恢复不会自动重放外部动作。

0.53.0 按七方向清单补 MCP 关联审计、跨进程 Plan 状态订阅/版本化 IDE 视图、扩展目录显式 watch、Hook 契约表、首次安装 journal、自动化诊断、Git 冲突暂存/恢复引用管理和目录搜索预算。逐项实现及未完成内容见 [0.53 对照表](docs/DELIVERY-0.53.zh-CN.md)，不宣称所有剩余均已生产验收。

0.52.0 本地交付候选：增加 `model acceptance --confirm` 分阶段部署检查，普通聊天、多轮、完整内置 schema/安全 echo 回传、流式与取消；npm 包携带运行时 `ws` 及其许可文件，支持隔离前缀离线安装验证。安装、公司配置和未完成验收见 [交付说明](docs/DELIVERY-0.52.zh-CN.md)。这是本地测试包，不代表已取得第三方重分发授权。

2026-10-17 第三批补请求所属 HTTP POST/SSE 的两阶段采样审批/简单表单、SDK Node 类型声明、签名来源收据检查/显式修复和发布前来源/NOTICE 门禁，见 [HTTP/SDK/分发说明](docs/HTTP-SDK-RELEASE-2026-10-17.zh-CN.md)。独立 GET 反向交互、OS 级隔离和真实分发授权仍未完成。

同日第二批增加显式 stdio MCP 两阶段采样审批/简单表单、反向请求 ID 隔离与读取边界、保持签名原字节的 Marketplace 安装/升级/回滚、密钥 stdin 导入以及 CLI/SDK 参数与版本一致性，历史记录见 [交互与签名说明](docs/PLATFORM-INTERACTIONS-2026-10-17.zh-CN.md)。

2026-10-17 再补持久 Goal/唤醒投递去重、Plan/IDE 并发版本校验、Windows 模型凭据保护、本地脱敏诊断、Hook 来源/嵌套结果、插件中断恢复、Git 冲突/恢复分支与正则 worker 超时。配置、命令及未完成边界见 [本轮平台补强说明](docs/PLATFORM-CLOSEOUT-2026-10-17.zh-CN.md)。

2026-10-17 增加 worktree 清理恢复引用、活进程锁保护、二进制/搜索错误诊断、工作流图预检与部分启动失败清理。见 [可靠性与恢复说明](docs/RELIABILITY-AND-RECOVERY-2026-10-17.zh-CN.md)。

2026-10-16 补齐本轮 Plan 执行预约/恢复、Teams 计划列表与后台审批、完成质量检查反馈，以及并发 Hook/任务状态修复。使用方法和验收边界见 [Plan / Teams / 质量检查说明](docs/PLAN-TEAMS-QUALITY-2026-10-16.zh-CN.md)。

0.51.0 将新安装的模型调用默认切到 OpenAI Responses，贯通终端、Agent、SDK、Hooks 和压缩；GLM 使用显式 Chat 适配，原生 Responses 与适配模式不会混淆。配置、实测结果和迁移边界见 [Responses 迁移说明](docs/RESPONSES-MIGRATION-0.51.zh-CN.md)。

0.50.0 增加四态 Skills、保留当前会话的 inline 执行和真实 fork 子代理、专家专属记忆、严格权限继承、Plan 提交后明确审批，以及实际 Teams 成员/任务/收件箱、后台队友、广播、停止恢复和安全清理。见 [本版操作说明](docs/PLATFORM-0.50.zh-CN.md)、[最新版交互核对](docs/UI-COMPARISON-0.50.zh-CN.md) 和 [当前剩余清单](docs/REMAINING-0.50.zh-CN.md)。

0.49.0 的 MCP 授权码登录（可信 issuer、PKCE S256、本机/手动回调、显式动态注册和绑定续期）与插件历史/确认回滚继续保留，见 [0.49 指南](docs/PLATFORM-0.49.zh-CN.md)。

0.47.0 增加显式 `mcp watch` 与 SDK 通知监听：协商 2025 系列 Streamable HTTP 后独立 GET/SSE、同会话续传、去重、有界重连、取消清理；拒绝未授权的反向采样/输入请求。见 [MCP 监听说明与边界](docs/MCP-NOTIFICATIONS-0.47.zh-CN.md)。

0.46.0 增加显式开启的自动语义摘要：先归档再请求模型、限制输入/输出/时限、失败回退、取消保护、共享预算与用量记录，压缩后原会话继续。默认仍是本地摘录。见 [上下文质量说明](docs/CONTEXT-QUALITY-0.46.zh-CN.md)。

0.45.0 提供 Messages / Responses / Chat Completions 三种协议的明确配置入口、通用与 Azure 认证预设、模板及编辑器 Schema，并校验端点与协议冲突。见 [三协议配置指南](docs/MODEL-PROTOCOLS-0.45.zh-CN.md)。

0.44.0 改进终端命令列表、快捷键帮助与中文/emoji 编辑，并移除首次启动的隐式 GLM 配置注入。见 [终端对比记录](docs/UI-COMPARISON-0.44.zh-CN.md)；公司同事默认使用 gpt-6-luna 的步骤见 [公司默认配置](docs/COMPANY-DEFAULTS-0.44.zh-CN.md)。

0.43.1 安全修复：非法工具参数不再替换为空对象；不完整的 Chat/Messages 工具流禁止执行；修复中文/emoji 跨 UTF-8 分包解码。见 [修复说明与验收边界](docs/FIXES-0.43.1.zh-CN.md)。

0.43.0 修复工具数组 schema、增加 Chat 工具/reasoning 部署策略、脱敏错误诊断与完整工具目录探测。先看 [公司双协议配置与 Agent 验收说明](docs/COMPANY-ACCEPTANCE-0.43.zh-CN.md)。此前 GLM 测试见 [0.42 记录](docs/COMPANY-ACCEPTANCE-0.42.zh-CN.md)。原有功能与 CA 打包见 [0.41 操作说明](docs/PLATFORM-0.41.zh-CN.md)，[剩余清单](docs/REMAINING-0.41.zh-CN.md) 除本轮推进项外仍有效。公司模型三种协议见 [Responses 指南](docs/AZURE-RESPONSES-0.40.zh-CN.md)。90% 提醒／超过 95% 自动压缩继续适用。

## 安装和启动

```powershell
npm install --global ./ccpt-0.67.0.tgz
cd D:\your-project
ccpt
```

项目内安装可以使用：

```powershell
npm install ./ccpt-0.67.0.tgz
npx ccpt
```

需要 Node.js 20 或更高版本。运行时使用的 `ws` 随本地包携带，不需要同事另装 Bun 或 TypeScript；源码构建仍需要开发依赖。

安装后，在任意项目目录直接输入 `ccpt` 即可进入全屏交互界面。无需生成 Windows EXE。

## 初始化

```powershell
ccpt init
ccpt config set --api-preset responses --base-url https://your-gateway.example/v1 --model your-tool-capable-model
```

首次启动不会自动选择公司的模型或远程网关。新安装默认 Responses；请先配置用户级 `~/.ccpt/settings.json`（设置 `CCPT_HOME` 时为该目录下的 `settings.json`）。旧 Messages/Chat 配置继续显式兼容，详见 [最新迁移指南](docs/RESPONSES-MIGRATION-0.51.zh-CN.md)。已有用户设置不会被首次启动覆盖。

Responses 预设使用 `OPENAI_API_KEY`；Azure 预设使用 `AZURE_OPENAI_API_KEY`，也可用 `model.apiKeyEnv` 显式选择其他环境变量。密钥不要写入项目配置。

外部 Git 操作默认关闭；按项目显式启用，并可限制网络目标主机：

```powershell
ccpt config set --allow-host models.company.example
ccpt config set --allow-git-push --allow-pull-requests
```

完整端点（例如企业平台带部署路径和 API 版本的地址）可以配置为：

```powershell
ccpt config set --api-preset azure-responses --endpoint-url "https://models.company.example/v1/responses" --model team-coding-model
```

如果平台使用其他密钥请求头，可加 `--api-key-header api-key --api-key-prefix ""`。代理、自定义 CA 和 mTLS 在 `.ccpt/settings.json` 的 `network` 段配置。

## 扩展平台

初始化后，项目扩展位于 `.ccpt/`：

```text
.ccpt/
├── settings.json
├── PLATFORM.md
├── plugin.schema.json
├── agents/
├── skills/
├── plugins/
├── mcp/
└── workflows/
```

`init` 会安装一个可编辑的 `ccpt-foundation` Plugin，立即提供 `/review`、`/security-review`、`/verify`、`/debug`、`/simplify`、`/run` 和 `/batch`。这些工作流不是 UI 特例，可以按团队标准直接修改或替换。

运行时还会加载产品内置能力；自定义 Skill、Agent、Rule、Plan 和 Plugin 只从当前受信任工作区的 `.ccpt` 目录加载，不读取其他 CLI 或其他项目的扩展目录。项目定义可覆盖同名内置工作流。

生成扩展模板：

```powershell
ccpt skill create api-review
ccpt agent create security-reviewer
ccpt plugin create team-standards
ccpt mcp create internal-tools
```

检查和调试：

```powershell
ccpt platform inspect
ccpt plugin validate .ccpt/plugins/team-standards
ccpt plugin hash .ccpt/plugins/team-standards
ccpt mcp test internal-tools
ccpt doctor
```

终端 UI 中输入 `/reload` 可重新加载 Plugin、Skill、Agent、Hook、MCP 和扩展命令，无需重启。

## Claude Code Marketplace 兼容

在 TUI 输入唯一入口 `/plugin` 会立即打开 Claude 风格的 `Discover / Installed / Marketplaces / Errors` 管理器，不等待网络。发行包内置官方目录快照，后台再通过代理感知的请求刷新；刷新失败保留可用缓存。官方 Marketplace 默认更新，第三方 Marketplace 默认关闭自动更新；输入文字搜索，方向键选择，`Enter` 查看详情，按页签使用 `Space` 安装、卸载或切换自动更新。安装后的 Skill 和命令以 `/plugin-name:skill-name` 形式出现在斜杠候选中。

```text
/plugin
/plugin marketplace add anthropics/claude-plugins-official
/plugin install frontend-design@claude-plugins-official
/frontend-design:frontend-design
```

非交互式 CLI：

```powershell
ccpt plugin marketplace add anthropics/claude-plugins-official
ccpt plugin marketplace list
ccpt plugin marketplace update claude-plugins-official
ccpt plugin install frontend-design@claude-plugins-official
ccpt plugin uninstall frontend-design
```

兼容 Claude Code 的 `.claude-plugin/marketplace.json` 和 `.claude-plugin/plugin.json`，以及插件根目录下的 `skills/`、`commands/`、`agents/`、`hooks/hooks.json`、`.mcp.json`、`.lsp.json`。Marketplace 缓存、注册信息和已安装插件全部保存在当前工作区 `.ccpt/` 内，不会注入其他项目。

原生 UI 兼容层将参考源码的 `commands`、`components` 和 `ink` 三大目录映射到共享命令目录、类型化组件模型/注册表，以及布局、事件、TermIO 和增量渲染运行时。`npm run coverage:ui` 会逐文件分类并拒绝未匹配项；详见 `docs/UI-COMPATIBILITY-INVENTORY.md`。Ink 的终端行为层已完成，命令和厂商专属组件仍按文件保留 `partial`，不把尚未验证的路径误报为完成。

剩余原生兼容层将参考源码的 `utils`、`hooks`、`screens`、CLI/Sandbox entrypoints 和 Voice 开关逐文件分类到 CCPT 的公共工具、无 React 控制器、原生 Screen 与服务架构。`npm run coverage:native` 固定校验这批原先未映射的 667 个路径并拒绝遗漏；详见 `docs/NATIVE-COMPATIBILITY-INVENTORY.md`。

详细开发说明见 [docs/EXTENSIONS.md](docs/EXTENSIONS.md)。

## 多 Agent、Git 和企业模式

```powershell
ccpt run "实现并测试订单接口" --background --worktree
ccpt agents
ccpt tasks
ccpt team <team-session-id> members
ccpt team <team-session-id> send <from-agent-id> <to-agent-id> "message"
ccpt checkpoint create
ccpt checkpoint list
ccpt checkpoint restore <checkpoint-id> --conversation
ccpt agents wait <agent-id>
ccpt agents cleanup <agent-id> --merge
ccpt workflow run .ccpt/workflows/delivery.json
ccpt shell start node -e "console.log('background')"
ccpt shell output <shell-task-id>
ccpt shell stop <shell-task-id>
ccpt --restricted
```

## LSP、MCP Resources 与 SDK

MCP 服务层支持环境变量展开、名称规范化、连接生命周期、通道权限与通知、elicitation、in-process/SDK transport、官方 registry 发现及 OAuth 辅助流程。API 服务层提供统一错误与重试、二进制安全文件下载、用量和会话入口；OAuth 使用 PKCE、随机 state 与本机回调监听。

服务基础层还包含 Magic Docs 自动维护、带进程锁和秘密检测的 AutoDream 记忆整合、完整 LSP 服务生命周期与被动诊断、作用域 Plugin 安装/启停/回滚更新、MCP 配置指纹审批，以及可选的本地录音与显式配置 WebSocket STT。

前台命令工具提供 Bash/PowerShell 风格的安全引号解析，但不会调用任意 shell 解释器；命令最终仍以可执行文件与参数数组进入企业白名单、审计、Hooks、环境清洗和超时边界。Config、Plan Mode 和 Worktree Mode 也作为正式模型工具注册。

完整工具层还注册了 Agent、Skill、MCP/Auth、Brief 附件、Remote Trigger、持久 Cron、WebFetch 和 WebSearch。Epic enhancement 进一步增加结构化提问、Artifacts/评论、Monitor、通知、主动结束会话、结构化 Review Findings、一次性 Wakeup、Routines/运行历史、双向认证 Channels、发送用户文件、反馈、Onboarding、MCP 就绪检查和动态 Workflow。Web 工具服从企业代理/TLS/目标白名单，WebFetch 额外拒绝凭据 URL、元数据地址、非授权私网和不安全重定向。

语言服务器按文件扩展名配置，支持定义、引用、悬停、文档/工作区符号、实现和调用层级：

```powershell
ccpt lsp add typescript --command typescript-language-server --args --stdio --extensions .ts,.tsx --language-id typescript
ccpt lsp query hover src/index.ts --line 10 --character 5
ccpt mcp resources
ccpt mcp read-resource internal-tools resource://guide
ccpt mcp prompts
```

包同时导出 `ccpt/sdk` 的 `runAgent()` / `query()`，以及流式 `AgentSdkSession`、外部 Session Storage、自定义系统指令、结构化输出校验、进程内工具注册、Artifacts、Channels、Automation、Usage/OpenTelemetry 和 Enterprise Governance API，并提供 `ccpt-mcp` stdio 服务入口。

终端和 CLI 可通过 `/insights`、`/artifacts`、`/channels`、`/routines`（CLI 去掉 `/`）检查新增运行状态。模型工具负责创建、更新和执行这些受策略约束的对象。

## Direct Connect 与 Remote Bridge

远程凭据只从环境变量读取，不写入会话索引或项目设置：

```powershell
$env:CCPT_REMOTE_TOKEN = '<short-lived-token>'
ccpt remote create --url https://remote.company.example
ccpt remote list
ccpt remote trust laptop-01 '<public-device-identity>'
ccpt remote devices
```

Remote Bridge 复用代理、自定义 CA、mTLS、目标主机白名单、审计与权限规则；实现了 Direct Connect 会话协商、带上限重连、心跳、行分隔消息、远程权限请求/响应、可信设备指纹、短期 JWT、消息去重、有序 ACK、附件工作区隔离和 CONNECT-over-WebSocket 上游代理。

`0.13` 继续补齐参考运行服务：API-round 会话压缩、旧 Tool Result 微压缩、签名远程托管设置、策略限额、团队记忆 Secret Guard、Session Memory、提示建议、诊断差异与限流状态。FileRead/FileWrite/FileEdit/Glob/Grep/NotebookEdit 以及 Task/Team/Todo 工具均提供参考源码同路径实现，并接入工作区策略或主工具注册表。

## 输出风格、键位、Vim 与协调器

项目可在 `.ccpt/output-styles/*.md` 定义带 frontmatter 的输出风格，在 `.ccpt/keybindings.json` 覆盖键位或定义 Chord。终端内可使用 `/output-style`、`/vim on` 和 `/coordinator on`；CLI 对应 `output-style` 与 `coordinator` 命令。

细粒度权限规则配置在 `policy.permissionRules.allow/ask/deny`，语法为 `tool_name(pattern)`，支持 `*`、转义括号和旧式 `:*` 前缀。`deny` 优先于 `ask`，`ask` 优先于 `allow`：

```powershell
ccpt permissions check run_command --json '{"command":"git","args":["push","origin","main"]}'
```

`sandbox` 模式必须配置企业 `processWrapper`，否则所有命令执行都会失败关闭。`restricted` 模式禁止代码写入、任意进程、Hook 和外部网络，只允许工作区内只读分析以及本机模型/MCP 服务。

## VS Code

```powershell
ccpt ide install
```

重启 VS Code 后运行 `CCPT: Open Agent Panel`。扩展支持当前文件和选区上下文、额外文件附件、聊天、Focus View、后台 Agent 状态、取消任务和恢复会话。

参考源码的 1,902 个文件逐项覆盖状态见 [docs/SOURCE-COVERAGE.md](docs/SOURCE-COVERAGE.md) 和机器可读的 `docs/SOURCE-COVERAGE.json`。旧 25 项验收标准见 [docs/ACCEPTANCE-MATRIX.md](docs/ACCEPTANCE-MATRIX.md)；完整 415 条需求的最新逐项证据、状态和外部集成边界见 [docs/EPIC-ENHANCEMENT-MATRIX.md](docs/EPIC-ENHANCEMENT-MATRIX.md)。部署与托管配置见 [docs/ENTERPRISE.md](docs/ENTERPRISE.md)。
