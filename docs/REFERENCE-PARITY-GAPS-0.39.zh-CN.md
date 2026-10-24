# CCPT 0.39 与参照 CLI 的差距审计

审计时间：2026-09-22。对照对象是本机安装的参照 CLI v2.1.153，以及用户提供源码归档中的 2,205 个文件。检查方式包括只读 `--help`、子命令帮助、现有 PTY 行为记录、CCPT 源码和 276 项测试结果。本轮没有为了制造错误而向真实公司模型发送请求，也没有执行登录、上传、PR、删除项目状态等外部副作用。

结论：CCPT 已是可以安装、聊天、调用工具、多 Agent、Skills、Plugins、MCP、Hooks、会话与 worktree 的独立平台，但还不能说“所有功能和交互均已对齐”。自动生成的文件映射覆盖率只能说明源码有对应分类，不能证明行为等价。

## P0：分享给组员前应优先处理

### 1. 旧品牌和旧供应商残留未清零

排除大型 Marketplace seed 后，`src`、README、扩展和包清单范围仍有 30 个文件命中旧品牌/旧供应商字符串；顶层 `ccpt --help` 也公开显示旧供应商环境变量名。它们来自兼容配置、旧市场、内置 Skill/Agent、生成类型与文案，但仍违反“对外只显示 CCPT”的品牌要求。

需要分层处理：用户界面和帮助必须清零；兼容解析器如必须保留，应隔离到明确的 legacy adapter，不能进入默认 UI、默认环境说明或团队模板；种子市场和插件内容需确认许可及品牌再分发边界。

### 2. 企业安全不是操作系统级沙箱

当前 sandbox/restricted 主要依靠工具白名单、路径检查、环境变量过滤、企业 process wrapper 和网络规则。它不是 Windows Sandbox、容器、低权限 token、Job Object、seccomp 或虚拟机级隔离。模型或第三方进程一旦经批准启动，操作系统层面的最终边界取决于 wrapper 和运行账号。

此外，`config show` 会输出合并后的配置；如果管理员把 secret 错误放进 settings `env`，存在终端泄露风险。生产分发前需要配置输出脱敏、凭据后端/短期 token、真实 wrapper 逃逸测试和受控运行身份。

### 3. 公司模型/CA 尚未真实端到端验收

当前机器模型和凭据已配置，但 CCPT 专用 CA 未配置，尚不能证明公司 TLS 链、代理、mTLS、流式工具调用和后台 worker 在真实环境均可用。现有测试使用本地模拟 HTTP/HTTPS 服务。应在隔离测试项目中覆盖 Chat、流式、工具调用、超限恢复、后台 Agent、MCP、代理重连和证书轮换。

### 4. 分发许可与来源清单尚未完成

项目借鉴了用户提供的源码归档并携带市场快照、文档映射和大量兼容组件。当前包标记为 `UNLICENSED`，但尚未形成第三方来源、许可证、NOTICE、可再分发资产和公司法务批准清单。给组员内部试用前也应完成；更不能仅因技术上可打包就默认可以对外发布。

## P1：参照 CLI 具有、CCPT 缺失或接口不等价

### 非交互与自动化协议

- 缺少与 `-p` 对等的稳定一次性执行接口，以及 text/json/stream-json 输出契约。
- 缺少 realtime stream-json 输入、partial message 事件、用户消息 replay 和 hook event 输出选项。
- 缺少 JSON Schema 结构化输出校验、预算金额上限和无会话持久化模式。
- 缺少 system prompt/append prompt 文件参数、启动文件资源下载及完整的命令行附件契约。
- SDK/事件总线存在，但还没有兼容的进程级标准输入输出协议；企业 CI 不能按参照 CLI 的参数无修改迁移。

### 启动参数与会话入口

- 顶层缺少 `--continue`、`--resume`、`--fork-session`、固定 session ID、PR 来源恢复等同构入口；CCPT 有自己的 `sessions`、`/resume`、`/branch`，语义相近但脚本不兼容。
- 缺少 `--settings` 临时文件/JSON、setting sources、临时 plugin 目录/URL、临时 MCP config/strict MCP、inline Agent JSON 等覆盖层。
- 缺少 `--tools`、allowed/disallowed tools、add-dir 等完整顶层策略参数。CCPT 有配置和交互入口，但不能直接复用参照脚本。
- 缺少 bare/minimal 启动、fallback model、beta header、debug filter/file、tmux worktree、远程控制等同等入口。

### 子命令体验

- `ccpt mcp --help`、`plugin --help`、`agents --help` 当前都只重复顶层帮助，没有逐子命令帮助、例子与退出码契约。
- MCP 缺少 remove/get/import/reset-project-choice/serve 的同构命令；CCPT 有 create/add/test/call/login 等自己的命令。
- Plugin 缺少 projected token cost、prune/autoremove、release tag 等完整体验；安装源信任和错误恢复还没有逐分支行为验收。
- 缺少完整账户登录/登出/状态、自更新/安装通道、项目状态 purge 与 auto-mode classifier 管理。公司自有模型可能不需要供应商账户，但脚本/UI 仍不等价。
- `doctor` 当前只把 `baseUrl` 当作端点健康字段；只配置完整 `endpointUrl` 时可能误报，且不会进行安全的真实模型/CA 握手诊断。

### 交互 UI

- 欢迎页、Focus View、diff 审批、键位说明、状态栏、弹窗层级和逐工具审批时机不是像素/行为级一致。
- `/theme` 没有完整自定义主题编辑/预览；`/hooks` 没有所有未配置事件的同级导航；Skills 的自动/手动/禁用三态语义未完整复制。
- keybindings、terminal setup、statusline、clipboard、mobile、feedback、release notes、浏览器协作、语音等入口缺失或仅有底层/占位实现。
- `/context` 是模型无关估算和最近请求快照，不是服务端 tokenizer，也不是完全相同的分区图。
- 菜单中既有内置实现，也有插件 Skill。命令名称存在或源码文件被映射不能作为功能完成证据。

## P1：已有实现但仍是“部分对齐”

### Agent View、多 Agent 与 worktree

CCPT 已支持后台 worker、状态、停止/接续确认、嵌套深度、团队邮箱、任务图和 worktree。仍缺：大规模并发压力测试、跨 worktree 冲突向导、运行中工具的可靠取消、跨进程审批聚合、tmux/多窗格体验、断电恢复和真实 Git push/PR 全流程验收。停止不会回滚已改文件，进入外部进程的单个工具可能继续运行。

### MCP

0.39 已有 stdio、HTTP direct/streamable、初始化、会话头、JSON/SSE、分页、OAuth device flow 和响应通知。仍缺：独立 GET SSE 长连接、断线续传、服务器主动请求处理、sampling/elicitation、完整 OAuth metadata/PKCE/dynamic registration、跨调用常驻会话及多种企业服务器互操作矩阵。

### Hooks

事件名称和本地执行链较丰富，但还没有逐事件对照 payload、stdout JSON、退出码、异步/同步、超时、修改输入、阻止工具和失败传播语义。企业 Hook 脚本兼容不能只按事件名判断。

### Permissions 与受限模式

已有 allow/ask/deny、一次/会话授权、拒绝历史、路径/命令/网络规则和 managed settings。仍需逐工具审批矩阵、符号链接与竞态攻击测试、外部进程继承验证、默认策略对照和真正 OS 级隔离。`bypass` 仍是高风险模式。

### Context 与长会话

0.39 已实现预算预留、完整旧历史归档、最新轮次保护、本地/服务端超限有限恢复和 `/context`。仍缺实际 tokenizer、多模态精确计数、超大仓库性能测试、模型生成的高保真语义摘要、跨百万 token 的真实验证及失败请求的精确计费数据。

### IDE

npm 包包含 VS Code 扩展和桥接，但尚未逐项验证多窗口、远程 SSH/WSL/容器、选择区/附件、权限弹窗、Agent View、会话续接、扩展升级和断线恢复。不能称为与参照 IDE 扩展深度等价。

### Plugins、Skills 与 Marketplace

支持脚手架、注册、启停和本地市场；但真实团队插件兼容、更新/回滚、依赖、锁定、签名/来源信任、供应链扫描与全部 UI 分支未完成。Marketplace disabled 只阻止市场操作，不会卸载已有插件，也不会关闭模型/MCP 网络。

## P2：有意不同，不应机械复制

- CCPT 面向公司自有模型和多协议网关，不应引入供应商账户强绑定。
- 分发目标是 npm + Node.js 20，而不是原生 EXE/自动更新器；如公司需要更新通道，应由内部 registry、版本锁定和回滚策略实现。
- CCPT 增加了 JSON 工作流、团队邮箱、显式企业策略和通用 API 预设；这些是独立产品能力，不必为了“长得一样”删掉。
- 品牌、默认市场和远程服务必须保持 CCPT 自有，交互模式可以借鉴，但不能把旧产品资源直接当成可分发资产。

## 建议实施顺序

1. 品牌/供应商字符串清零、配置输出脱敏、许可证与第三方来源清单。
2. 公司 CA/模型/代理/mTLS 的真实验收，并修正 doctor 为安全诊断命令。
3. 稳定的 `--print` + JSON/stream-json 自动化接口和结构化输出。
4. 完整的 CLI 覆盖层与逐子命令帮助，包括 tools/settings/MCP/plugins/session 参数。
5. OS 级隔离方案、取消/进程树治理、权限与 Hook 语义矩阵。
6. MCP 常驻双向能力和企业 OAuth 互操作。
7. Agent View/IDE/主题/键位/审批体验的行为级验收。
8. 真实大型仓库、并发 Agent、worktree 冲突、Git/PR 和长上下文压力测试。

每项完成时需要记录：版本、前置条件、输入/按键、输出、副作用、失败/取消路径、源码证据和自动化测试。不要再用“文件已分类”“菜单中有名字”替代行为验收。

