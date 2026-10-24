# CCPT 0.34.0 中文产品与启动手册

> 本手册对应 `ccpt@0.34.0`。内容以当前仓库中的 CLI、TUI、SDK、模型工具和企业策略实现为准。

> 0.51 更新：模型默认协议已改为 OpenAI Responses；本手册下文的旧模型接入示例仅作历史说明。安装、GLM 显式适配与公司原生 Responses 请优先使用 [最新接入指南](RESPONSES-MIGRATION-0.51.zh-CN.md) 和 README。

## 目录

- [1. 产品简介](#1-产品简介)
- [2. 运行要求](#2-运行要求)
- [3. 安装方式](#3-安装方式)
- [4. 五分钟快速启动](#4-五分钟快速启动)
- [5. 模型与网络配置](#5-模型与网络配置)
- [6. 三种主要运行方式](#6-三种主要运行方式)
- [7. 交互式终端 TUI](#7-交互式终端-tui)
- [8. CLI 命令索引](#8-cli-命令索引)
- [9. 代码与模型工具](#9-代码与模型工具)
- [10. 多 Agent 与后台任务](#10-多-agent-与后台任务)
- [11. Git Worktree 与交付流程](#11-git-worktree-与交付流程)
- [12. Workflow、Tasks 与团队协作](#12-workflowtasks-与团队协作)
- [13. Session、Checkpoint 与 Memory](#13-sessioncheckpoint-与-memory)
- [14. Skills、Agents 与 Plugins](#14-skillsagents-与-plugins)
- [15. MCP 与 LSP](#15-mcp-与-lsp)
- [16. Hooks 生命周期自动化](#16-hooks-生命周期自动化)
- [17. Artifacts、Channels 与 Routines](#17-artifactschannels-与-routines)
- [18. Agent SDK](#18-agent-sdk)
- [19. 企业权限、安全与审计](#19-企业权限安全与审计)
- [20. VS Code 集成](#20-vs-code-集成)
- [21. Direct Connect 与远程运行](#21-direct-connect-与远程运行)
- [22. 数据目录与配置优先级](#22-数据目录与配置优先级)
- [23. 常见使用场景](#23-常见使用场景)
- [24. 故障排查](#24-故障排查)
- [25. 开发、测试与打包](#25-开发测试与打包)
- [26. 已知边界](#26-已知边界)
- [27. 相关文档索引](#27-相关文档索引)

---

## 1. 产品简介

CCPT 是一个企业级多 Agent 软件开发 CLI 和扩展平台。它可以：

- 读取、搜索、创建和修改代码；
- 执行受策略约束的命令、Notebook 操作和 LSP 查询；
- 将工作委派给后台 Agent；
- 使用 Git Worktree 隔离并行开发；
- 保存 Session、Checkpoint、Memory、Task 和审计记录；
- 加载团队 Skills、Agents、Plugins、Hooks 和 MCP；
- 执行依赖感知的多 Agent Workflow；
- 通过 SDK 嵌入应用；
- 在代理、证书、mTLS、进程包装器和托管策略下运行；
- 通过 VS Code 扩展查看 Agent、会话和 Focus View；
- 管理 Artifacts、认证 Channels、Routines、Wakeups 和 Usage Insights。

可以把它理解为以下几层：

```text
工程师
  ├─ CLI / 全屏 TUI / VS Code / SDK
  ├─ Lead Agent
  │   ├─ 专业 Agent
  │   ├─ 后台任务
  │   └─ Worktree Agent
  ├─ 文件、Shell、Git、LSP、Web、MCP 工具
  ├─ Skills、Plugins、Hooks、Memory、Workflow
  └─ 权限策略、Sandbox、网络策略、审计与托管配置
```

### 1.1 0.34.0 统一实时事件与 Agent View

- 新增统一 Runtime Event Bus，将状态、轮次、thinking/text delta、Token、工具开始/完成、等待输入、完成和失败事件按序提供给 TUI、SDK 与 IDE；
- SDK `query()` 在任务结束前持续产出 `runtime` 事件，IDE Bridge 以 JSON-RPC `runtime/event` 通知推送；VS Code 面板会原位增长回答并显示工具与 Token 活动；
- 新增 Claude 风格后台入口 `ccpt --bg <goal>`，以及 `attach`、`logs`、`stop` 顶层命令和对应 `agents` 子命令；attach 可跨进程跟随持久流状态；
- `attach/logs` 保留完整回答和工具轨迹，但不输出 Provider 私有推理原文；TUI 仍可用 `Ctrl+O` 展开本地保留的思考详情；
- Anthropic 与 OpenAI-compatible 传输均继续使用真实 SSE，首个 delta 无需等待完整响应；非流式模型响应自动回退而不破坏界面。

### 1.2 0.33.8 Claude 风格实时 Agent 活动

- 流式回答保留在可变动态区域并随 SSE delta 持续重绘，完成后才写入原生终端滚动历史，修复首个片段被过早固定、后续内容不可见的问题；
- thinking、responding、tool 和 tool-result processing 四个阶段以 120ms 动画持续显示，包含阶段耗时、实时/最终 Token 数和当前工具名称；
- Provider thinking 完成后生成可用 `Ctrl+O` 展开的 `Thought for Ns`，回答文本原位增长，工具调用和后续模型轮次按顺序进入历史；
- `todo_write`/Task 形成的清单在活动区显示 `◼ / ◻ / ✓ / ×` 状态和剩余数量，后台 worker 通过持久 Agent 状态提供相同的实时视图；
- 认证已用实际智谱 Anthropic SSE 请求验证：首个 delta 在请求结束前到达，配置 Token 保存在独立 `.ccpt/settings.json`，不扫描 `.claude` 扩展目录。

### 1.3 0.33.7 Marketplace 热门排序

- Discover 和 Installed 插件列表默认按安装量/受欢迎程度降序排列，不再按插件名称 A–Z 展示；
- 同时识别数字安装量与 `464.9K`、`1.2M installs`、带千位分隔符等 Marketplace 字段，搜索后的候选仍保持热门顺序；
- 官方离线目录为首屏热门插件携带快照热度，联网目录提供统计时优先使用目录中的真实数据；相同或缺失热度时才按名称稳定排序。

### 1.4 0.33.6 模型认证恢复与原生流式回答

- `/brainstorming <请求>`、Plugin Skill 和其他前台/后台 Agent 均在每次 worker 启动时重新加载当前信任工作区与用户设置，恢复 `env.ANTHROPIC_AUTH_TOKEN`；运行时 JSON 继续不保存任何凭据；
- 空字符串 Token 被视为未配置，允许 `settings.json` 的有效 Token 接管；Anthropic 请求继续使用 `Authorization: Bearer <token>`，并保留 `ANTHROPIC_API_KEY` 的 `x-api-key` 兼容路径；
- Anthropic Messages 与 OpenAI-compatible 模型均支持真实 SSE 增量响应；文本片段在网络请求完成前就进入 TUI，不再等待整段结果返回；
- 普通聊天通过 Agent 持久状态跨进程增量刷新，前台 Skill/斜杠命令通过进程内回调即时刷新；最终结果会替换同一条流式消息，不会重复显示；
- SSE 同时保留 thinking、tool call、stop reason、Token usage 和非流式 JSON fallback，代理、TLS、allowlist 与超时仍走统一网络策略。

### 1.5 0.33.5 Claude Code Plugin 安装交互兼容

- 唯一入口 `/plugin` 打开 `Discover / Installed / Marketplaces / Errors` 四页插件管理器；不再重复暴露 `/marketplace` 和 `/plugins`；
- 管理器先立即呈现，再异步加载缓存和同步远端；内置官方目录快照保证首次离线也有 Discover 内容，网络请求支持项目代理和 `HTTP(S)_PROXY`；
- Discover/Installed 页用 `Enter` 或 `Space` 进入完整详情页，展示来源、作者、版本、描述、组件、信任警告和 project/local 安装范围；安装完成后返回聊天并明确提示 `/reload-plugins`；
- Marketplace 只用 `Ctrl+R` 手动刷新目录，普通字符 `r` 可直接参与搜索；列表页和详情页均可刷新；
- Marketplace 主列表采用 Claude 风格五项视窗：`› ○` 选中标记、插件名称/来源/安装量/Community Managed 元数据、第二行简介、项目间留白，以及 `↓ N more below` 溢出提示；
- `frontend-design` 与 `superpowers` 提供随包离线安装种子，网络不可达时仍可完成安装与 reload；其他远端插件会显示持续进度和明确错误；
- reload 后，Plugin Skill 在无冲突时提供 `/frontend-design`、`/brainstorming` 等简洁名称，并保留 `/plugin:skill` 命名空间入口；
- `/reload-plugins` 的成功摘要不再被扩展诊断染成红叉；诊断独立汇总并可用 `Ctrl+O` 查看。运行时 `agent_<id>.json` 任务记录不会再被误读为 Agent 定义；
- Anthropic 官方 `claude-plugins-official` 在受信任会话启动后自动注册并默认开启 auto-update，第三方和本地 Marketplace 默认关闭；Marketplaces 页用 `Space` 切换；
- `/plugin marketplace update [name]` 只刷新目录；`/plugin update <plugin>@<marketplace>` 单独更新已安装 Plugin；后台 auto-update 会更新目录和已安装 Plugin，之后用 `/reload-plugins` 激活到当前会话；
- 直接兼容 `.claude-plugin/marketplace.json`、`.claude-plugin/plugin.json`，以及 Claude 插件的 `skills/`、`commands/`、`agents/`、`hooks/hooks.json`、`.mcp.json` 和 `.lsp.json`；
- 支持本地目录、GitHub `owner/repo`、Git URL、HTTPS `marketplace.json`、git-subdir、npm、经过路径检查的 archive，以及需要二次确认的 command source；
- 安装内容复制到当前工作区 `.ccpt/plugins/`，不会成为用户全局扩展。Claude 插件的 Skill 和命令使用 `/plugin-name:skill-name` 命名空间，并会立即出现在斜杠候选中；
- CLI 同步提供 `ccpt plugin marketplace add/list/plugins/errors/update/auto-update/remove`，以及 `plugin install/update/uninstall`。

### 1.6 0.32.3 受信任工作区扩展边界

- 学习 Claude Code 的“信任工作区后按项目加载”机制，但使用 CCPT 自己的 `.ccpt/skills/`、`.ccpt/agents/`、`.ccpt/rules/`、`.ccpt/plans/` 和 `.ccpt/plugins/`；
- 自定义 Skills、Agents、Rules、Plans 和 Plugins 只从当前确认信任的工作区加载，不合并用户目录、其他项目或其他 CLI 的扩展目录；
- 用户设置仍可保存模型、Token 和 UI 偏好，但其中的扩展目录不能向项目注入可执行扩展；只有项目设置可以添加扩展目录，且路径必须留在受信任工作区内；
- `ccpt agent create <name>` 写入 `.ccpt/agents/<name>/AGENT.md`；Plan mode 的完成结果保存到 `.ccpt/plans/`。

### 1.7 0.32.2 独立项目 Skill 与光标修正

- 空输入框的原生终端光标固定在 `>` 右侧，不再错误落到输入框底边或下一行；
- CCPT 只发现当前已信任工作区的 `.ccpt/skills`，不读取其他 CLI 或用户级扩展目录；
- 需要共享目录时必须通过项目 `settings.json` 的 `skillsDirectories` 显式配置。

### 1.8 0.32.1 工作区 Skill 发现

- 确认信任的当前工作区是项目 Skill 的唯一自动来源，路径为 `<workspace>/.ccpt/skills/<name>/SKILL.md`；不会扫描其他项目；
- 同时兼容当前工作区旧路径 `.ccpt/skills`；同名时标准项目路径优先；
- `ccpt skill create <name>` 直接在当前工作区的 `.ccpt/skills` 下创建；
- `/skills` 每次打开都重新扫描，按 `r` 也可原地刷新，并用 `[project]`、`[plugin]` 标明来源。

### 1.9 0.32.0 原生终端历史、单次命令提交与 CLAUDE.md 初始化

- 输入 `/` 后会保留完整命令与 Skill 候选集，使用 `↑`/`↓` 可以滚动，列表顶部和底部显示剩余数量；Skill 入口统一为 `/skills`，不再同时提供重复的 `/skill`；
- 空参数 `/plan` 只切换当前会话到 Plan mode，不发起模型请求；`/plan <任务>` 才会立即开始只读规划；旧版本项目中遗留的 `ccpt-model` 占位配置不会再覆盖用户级 Claude 模型；
- 模型思考和调用参数默认折叠为 `Thought for Ns`，按 `Ctrl+O` 展开；错误默认显示摘要，详细堆栈也通过 `Ctrl+O` 查看；
- 与 Claude Code 一致，`[1m]`/`[2m]` 只作为客户端上下文窗口标记；Anthropic Messages 请求会自动移除该后缀，例如配置 `glm-5.2[1m]`、实际请求 `glm-5.2`，避免网关返回 `1214 modelCode 不存在`；
- TUI 使用终端主屏幕静态消息区，不进入备用屏幕；每条完成消息只打印一次并进入 Windows Terminal 原生 scrollback，右侧窗口滚动条、鼠标滚轮和触控板双指手势可查看完整聊天历史；
- Slash 候选高亮后，按一次 `Enter` 立即执行对应命令；`Tab` 仍只接受补全，不会误执行；
- 普通首次启动只自动创建同目录的 `~/.ccpt/settings.json` 和 `~/.ccpt/CLAUDE.md`；项目根 `CLAUDE.md` 改为仅由 `/init` 或 `ccpt init` 显式创建；
- Verbose Transcript 模式继续支持 `↑`/`↓`、`PageUp`/`PageDown` 浏览，`Esc` 或 `Ctrl+O` 返回输入框；
- Anthropic thinking block、签名和兼容端点的 `reasoning_content` 会进入会话记录，后续 Tool Use 回合可保持完整上下文。

### 1.10 0.30.0 Claude 配置、记忆与启动身份

本版本补齐 Claude Code 风格的配置和启动链，而不只是生成同名文件：

- 自动创建与用户设置同目录的 `~/.ccpt/CLAUDE.md`；显式初始化后可再创建 `<workspace>/CLAUDE.md`，运行时按“用户 → 项目 → `CLAUDE.local.md`”顺序装入 Agent 系统上下文；
- 用户 `settings.json` 初始化 Claude 兼容的 `env`、`permissions`、模型别名、更新开关和 Shell 字段；已有键值保留，只补缺失项；
- `ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_BASE_URL`、三个默认模型、自动压缩窗口和 API 超时会真实映射到运行配置；
- `provider: anthropic` 使用 Anthropic Messages API、原生 Tool Use/Tool Result 和缓存 Token 统计，不会错误调用 OpenAI `/chat/completions`；
- 启动页使用像素 Agent 标识，并显示版本、模型、工作目录和 `Using <model> (from <settings>) · /model to change`；Token 为空时给出明确配置提示。

### 1.11 0.29.0 工作区入口与终端交互修正

本版本在 0.28.0 的 Epic 与源码收口基础上，补齐三项 Claude Code 风格的入口交互：

- 首次进入一个未信任的工作区时，先显示安全说明和 `Yes, I trust this folder` / `No, exit` 选择；未确认前不会加载项目配置、文件索引或扩展；
- 接受后自动初始化 `~/.ccpt/settings.json` 和 `<workspace>/.ccpt/settings.json`，已有设置只读取、不覆盖，并在 `~/.ccpt/workspace-trust.json` 持久保存绝对工作区路径；
- 输入光标紧跟在提示符右侧的实际文字后方，并按终端显示宽度处理中文；Slash 命令候选会随选中项滚动，不会在 `/channels` 后出现“选中但不可见”。

### 1.12 0.28.0 Epic 与源码收口

本版本补齐了可在本地独立验收的 Epic enhancement：

- 模型 Alias、版本锁定、Fallback、Reasoning Effort、Fast 路由和 Advisor 模型；
- 统一的完整 Hook 生命周期分发；
- 可跨进程重载的 Agent Supervisor、分组、Attach/Detach 和失活检查；
- Team 显示模式、Plan-first 审批、受控退出、质量门和竞争假设；
- 持久 Workflow Run、失败子图重跑、最多 256 路受限 Fan-out、Deep Research 和带 SHA-256 完整性校验的 Workflow Bundle；
- `/goal` 的 Session 目标持久化，以及 Routine 输入和运行历史；
- Review Effort、Managed Review、Security Rule、Analytics Dashboard、产品课程和 Champion Communication Kit；
- 公有/私有 Organization Plugin Marketplace 客户端、推荐和下载完整性验证；
- Worktree 附加文件、Artifact MCP 数据快照，以及 IDE Plan Review、Edit Acceptance 和多会话审查状态。

Epic 矩阵中标记为 `Integration Required` 的能力必须连接真实外部宿主，例如 Desktop、Cloud、Browser、JetBrains、Git Provider、IdP、Runner、APNs/FCM、第三方消息平台或 OS Sandbox Wrapper。未配置时系统保持显式、失败关闭的适配器边界。

参考源码清单也使用相同语义：`Implemented` 表示本地可执行并经过回归验证；`Integration Required` 表示 CCPT 已实现客户端、协议、策略或适配器边界，但必须安装或配置相应外部宿主。`0.28.0` 已消除全部未分类、Partial 和 Missing 源码项，并由 `source-closure.test.ts` 阻止它们重新出现。

## 2. 运行要求

### 必需环境

- Node.js 20 或更高版本；
- 一个支持 OpenAI-compatible Chat Completions 或 Anthropic Messages API，并支持工具调用的模型服务；
- 待操作的项目目录；
- 如果使用 Worktree、Commit、Push 或 PR，需要安装 Git；
- 如果运行源码测试和构建，建议安装 Bun。

检查版本：

```powershell
node --version
npm --version
git --version
bun --version
```

### 可选环境

- `rg`：更快的仓库搜索；
- `gh`：创建 GitHub Draft PR；
- LSP Server：定义、引用、Hover 等语言查询；
- VS Code：使用内置扩展；
- SoX `rec` 或 Linux `arecord`：语音输入；
- 企业 Process Wrapper：启用真正的 `sandbox` 模式。

## 3. 安装方式

### 3.1 使用当前发行包全局安装

```powershell
cd C:\Users\55038\CCPT
npm install --global .\ccpt-0.34.0.tgz
ccpt --version
```

预期输出：

```text
0.34.0
```

### 3.2 在单个项目中安装

```powershell
cd D:\projects\your-project
npm install C:\Users\55038\CCPT\ccpt-0.34.0.tgz
npx ccpt --version
```

此方式不会修改全局 npm 环境。

### 3.3 从源码运行

```powershell
cd C:\Users\55038\CCPT
npm install
npm run check
npm run build
node .\dist\cli.js --version
```

进入其他项目时可以直接指定工作目录：

```powershell
node C:\Users\55038\CCPT\dist\cli.js --cwd D:\projects\your-project
```

## 4. 五分钟快速启动

### 第一步：进入目标项目

```powershell
cd D:\projects\your-project
```

不要在 CCPT 自身源码目录启动，除非你确实要修改 CCPT。

### 第二步：初始化项目平台

```powershell
ccpt init
```

初始化会创建 `.ccpt/`，并安装可编辑的基础 Plugin。典型结构：

```text
.ccpt/
├── settings.json
├── PLATFORM.md
├── plugin.schema.json
├── agents/
├── skills/
├── plugins/
├── mcp/
├── workflows/
└── output-styles/
```

### 第三步：配置模型

本地兼容服务示例：

```powershell
ccpt config set `
  --base-url http://127.0.0.1:11434/v1 `
  --model your-tool-capable-model
```

企业完整端点示例：

```powershell
ccpt config set `
  --endpoint-url "https://models.company.example/v1/chat/completions" `
  --model approved-coding-model `
  --allow-host models.company.example
```

OpenAI-compatible 服务可以通过环境变量设置密钥：

```powershell
$env:CCPT_API_KEY = '<model-api-key>'
```

不要把密钥写入 Skill、Plugin、`CLAUDE.md` 或 Prompt。Claude-compatible 配置也允许把 `ANTHROPIC_AUTH_TOKEN` 放在用户级 `~/.ccpt/settings.json` 的 `env` 中；该文件以用户私有权限创建，但生产环境仍优先使用操作系统或企业 Secret Store 注入。

### 第四步：运行诊断

```powershell
ccpt doctor
ccpt platform inspect
ccpt permissions list
```

### 第五步：启动交互界面

```powershell
ccpt
```

进入全屏 TUI 后直接输入任务，例如：

```text
分析这个项目的架构，找出订单模块的测试缺口，先给计划，不要修改文件。
```

或者直接执行一次任务：

```powershell
ccpt run "实现订单查询接口并补测试"
```

## 5. 模型与网络配置

### 5.1 本地模型

```powershell
ccpt config set `
  --base-url http://127.0.0.1:11434/v1 `
  --model local-coding-model
```

本机 loopback 模型可以在 `restricted` 模式下使用。模型必须支持工具调用；只会输出文本的模型无法完成文件编辑和 Agent 编排。

### 5.2 企业模型网关

```powershell
$env:CCPT_API_KEY = '<short-lived-token>'

ccpt config set `
  --endpoint-url "https://gateway.company.example/ai/chat/completions" `
  --model engineering-agent `
  --allow-host gateway.company.example
```

自定义 API Key Header：

```powershell
ccpt config set `
  --api-key-header api-key `
  --api-key-prefix ""
```

### 5.3 Claude-compatible Anthropic 配置

首次启动会在用户级 `~/.ccpt/settings.json` 中补齐以下模板。只需要把空的 `ANTHROPIC_AUTH_TOKEN` 替换为自己的 Token：

```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "",
    "ANTHROPIC_BASE_URL": "https://open.bigmodel.cn/api/anthropic",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "glm-5.2[1m]",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "glm-5.2[1m]",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "glm-5.2[1m]",
    "CLAUDE_CODE_AUTO_COMPACT_WINDOW": "1000000",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
    "API_TIMEOUT_MS": "3000000"
  },
  "permissions": {
    "allow": [],
    "deny": []
  },
  "model": "opus",
  "autoUpdates": false,
  "DISABLE_UPDATES": 1,
  "shell": "powershell"
}
```

映射规则：

- `model: "opus"` 读取 `ANTHROPIC_DEFAULT_OPUS_MODEL`；`sonnet` 和 `haiku` 同理；
- `ANTHROPIC_AUTH_TOKEN` 作为模型凭据，通过 `Authorization: Bearer` 发送；也支持标准 `ANTHROPIC_API_KEY` 的 `x-api-key`；
- `ANTHROPIC_BASE_URL` 自动拼接 `/v1/messages`，除非配置了完整 `endpointUrl`；
- `[1m]`、`[2m]` 是客户端上下文窗口后缀，不是服务端模型代码。配置和 UI 保留后缀，发送 Anthropic Messages 请求时会自动移除；
- `CLAUDE_CODE_AUTO_COMPACT_WINDOW` 映射为上下文预算；
- `API_TIMEOUT_MS` 映射为模型网络超时；
- 用户级设置先加载，项目 `.ccpt/settings.json` 后加载并覆盖同名运行项。

修改 Token 后，重新启动 CCPT 或在 TUI 中执行 `/reload`。

### 5.4 最大上下文

```powershell
ccpt config set --max-context 1000000
```

这只是 CCPT 的上下文预算上限；模型服务本身也必须支持对应窗口。

### 5.5 Proxy、CA 与 mTLS

在 `.ccpt/settings.json` 中配置：

```json
{
  "network": {
    "proxyUrl": "http://proxy.company.example:8080",
    "allowedHosts": [
      "models.company.example",
      "mcp.company.example"
    ],
    "caFile": "D:\\certs\\enterprise-ca.pem",
    "clientCertFile": "D:\\certs\\developer.pem",
    "clientKeyFile": "D:\\certs\\developer-key.pem",
    "rejectUnauthorized": true,
    "timeoutMs": 120000
  }
}
```

`NO_PROXY` 只决定是否经过代理，不能绕过 `allowedHosts`。

## 6. 三种主要运行方式

### 6.1 交互式 TUI

```powershell
ccpt
```

适合连续对话、查看命令面板、恢复 Session、管理 Agent 和检查状态。

### 6.2 前台单任务

```powershell
ccpt run "检查当前修改并修复测试" --no-worktree
```

命令返回前会等待 Agent 完成或请求输入。

### 6.3 后台隔离任务

```powershell
ccpt run "重构认证模块并运行测试" --background --worktree
```

查看状态：

```powershell
ccpt agents
ccpt agents <agent-id>
ccpt agents wait <agent-id>
```

## 7. 交互式终端 TUI

### 7.1 基本操作

- 直接输入文本：发送开发目标；
- 输入 `/`：打开命令建议；
- 命令建议高亮后按一次 `Enter`：立即执行该 Slash 命令；按 `Tab` 只补全；
- 输入 `@` 或按 `Ctrl+P`：模糊搜索工作区文件并插入文件引用；
- 输入 `! <command>`：启动受同一策略边界约束的持久 Shell Task，前台显示进度，`Ctrl+B` 可转后台；
- 输入 `# 需要长期记住的内容`：写入项目记忆；
- `Enter`：提交；
- `Shift+Enter`、`Ctrl+J` 或输入 `\` 后按 `Enter`：插入换行；
- Agent 工作时继续提交：输入会进入队列，当前回合完成后自动发送；
- `Esc` 或 `Ctrl+C`：中断当前 Agent；空输入时连续按两次 `Ctrl+C` 退出；`Ctrl+D` 直接退出；
- 空输入时连续按两次 `Esc`：打开 Checkpoint 回退选择器；
- `Ctrl+B`：把当前 Agent 或 Shell Task 转到后台，界面立即可以继续输入；
- `Ctrl+T`：显示或隐藏实时任务区，统一展示 Agent、Shell Task 和 Todo；
- `Ctrl+O`：切换聚焦对话视图；
- `Ctrl+R`：搜索持久输入历史，再按一次切换更早结果；搜索时按 `Ctrl+S` 在当前 Session、当前项目和所有项目间切换；
- 普通输入时按 `Ctrl+S`：暂存当前 Prompt；在空输入上再次按下可恢复；
- `Ctrl+G` 或 `Ctrl+X Ctrl+E`：用 `$VISUAL`/`$EDITOR`（Windows 默认记事本）编辑 Prompt；
- `Ctrl+F`：进入当前会话记录搜索；
- `Shift+Tab`：按 Claude Code 当前命名循环切换 default、acceptEdits、plan、bypassPermissions；
- `Alt+P`：打开模型选择器；`Alt+T`：切换扩展思考；`Alt+O`：切换 Fast Mode；
- `Ctrl+V`（Windows 也支持 `Alt+V`）：把剪贴板图片插入为 `[Image #n]`，通过兼容多模态请求发送；
- `Ctrl+X Ctrl+K` 在 3 秒内按两次：停止当前项目全部运行中的后台 Agent；
- 大段或多行粘贴会折叠成 `[Pasted text #n +x lines]`，提交时恢复完整原文；
- 权限确认支持一次允许、当前 Session 允许和拒绝；
- `/theme` 可选择 dark、light、ANSI、无色及两种色觉辅助主题；`NO_COLOR` 同样有效；
- 工具调用会以 `● Tool(input)` 和 `⎿ result` 实时显示，不再等待整个 Agent 完成才出现结果；
- 已完成消息进入终端原生历史；使用窗口右侧滚动条、鼠标滚轮或触控板双指上下滑动查看完整聊天，不需要进入单独的内置滚动面板；
- 使用项目键位配置可以覆盖默认快捷键；
- `/focus`：仅突出任务、决策和结果；
- `/vim on`：启用 Vim 输入模式；
- `/exit`：退出。

### 7.2 交互式设置与模型面板

`/config` 不再输出整段 JSON，而是打开原生设置面板。顶部包含 `Settings / Status / Config / Usage / Stats` 五个页签：

- `←`、`→` 或 `Tab`：切换页签；
- `↑`、`↓`：移动当前配置项；
- 直接输入文字：搜索当前页签；`Backspace` 删除搜索字符；
- `Enter`：切换布尔设置、权限模式或 Worktree 基准，并立即写入项目 `.ccpt/settings.json`；
- `Esc`：关闭，不产生额外修改。

也可以用 `/settings`、`/status`、`/usage`、`/stats` 直接打开对应页签。`/status agent` 保留查看当前 Agent 原始记录的能力。

`/model` 或 `Alt+P` 打开模型选择器：

- `↑`、`↓` 或数字键选择模型；
- `←`、`→` 在 low、medium、high、max reasoning effort 之间调节；
- `Enter` 或 `d`：保存为项目默认模型和 effort；
- `s`：只在当前 TUI Session 使用，不修改项目默认值；
- `Esc`：取消；
- 模型名称中的 ANSI 控制码会在展示和保存前清理。

`/effort` 打开独立 effort 滑杆；`←`/`→` 调节，`Enter` 应用于当前 Session，`d` 保存默认值。也可直接执行 `/effort low|medium|high|max|auto`。`/fast [on|off]` 可直接切换 Fast Mode。

`/permissions` 打开原生权限管理器，包含 `Mode / Allow / Ask / Deny / Directories` 五个页签：

- `←`、`→` 或 `Tab` 切换权限页签；
- `↑`、`↓` 或数字键选择项目；
- Mode 页按 `Enter` 切换 default、acceptEdits、plan、bypassPermissions 或 sandbox；
- 规则和目录页按 `a` 新增，按 `d` 删除当前项；
- 新增状态按 `Enter` 保存、按 `Esc` 取消输入；普通状态按 `Esc` 关闭面板。

### 7.3 常用 Slash 命令

| 命令 | 功能 |
|---|---|
| `/help` | 查看命令和按键帮助 |
| `/advisor [request]` | 分析项目并给出按优先级排序、带证据的下一步建议 |
| `/brief [request]` | 生成目标、约束、风险、验收标准和验证方式完整的工程简报 |
| `/plan [request]` | 只生成实施计划，不修改文件 |
| `/ultraplan [request]` | 生成包含依赖、并行工作流、集成点和验证门的多 Agent 计划 |
| `/review [scope]` | 按严重度审查正确性、回归、可维护性和缺失测试 |
| `/security-review [scope]` | 审查信任边界、注入、SSRF、路径、命令执行和授权风险 |
| `/summary [focus]` | 汇总项目状态、近期改动、验证证据、风险和后续动作 |
| `/goal [set <objective>\|complete\|cancel]` | 查看、设置、完成或取消可跨恢复保留的 Session Goal |
| `/agent [name] [goal]` | 列出或运行专业 Agent |
| `/agents` | 查看、等待、取消或清理 Agent |
| `/background <goal>` | 启动后台 Agent |
| `/worktree <goal>` | 在隔离 Worktree 中启动 Agent |
| `/tasks [output\|stop\|claim] [id]` | 查看并管理 Agent、Shell 和团队 Todo |
| `/team` | 查看成员、收件箱或发送消息 |
| `/sessions` | 查看可恢复 Session |
| `/resume <id> [goal]` | 恢复 Session |
| `/branch [goal]` | 从当前会话分叉 |
| `/checkpoint` | 创建或查看 Checkpoint |
| `/rewind` | 恢复 Checkpoint |
| `/compact` | 压缩活跃上下文 |
| `/context` | 查看上下文占用 |
| `/search <query>` | 搜索当前会话记录 |
| `/theme [name]` | 查看或切换终端主题 |
| `/config` | 打开可搜索、可编辑的 Config 页签 |
| `/settings` | 打开常用设置页签 |
| `/status [agent]` | 打开运行状态页签；`agent` 查看原始 Agent 记录 |
| `/usage` | 打开当前 Session 使用情况页签 |
| `/stats` | 打开 Agent 与任务统计页签 |
| `/insights` | 查看持久 Usage、工具调用和 Agent 分布 |
| `/cost` | 打开上下文与持久 Usage 统计 |
| `/files` | 打开工作区 `@` 文件选择和补全 |
| `/memory` | 查看持久记忆 |
| `/skills` | 查看 Skills |
| `/plugin` | 唯一 Plugin 入口；打开管理器，或执行 install/update/uninstall/enable/disable/marketplace 子命令 |
| `/mcp` | 查看 MCP Servers |
| `/hooks` | 查看生命周期 Hooks |
| `/permissions` | 交互管理权限模式、Allow/Ask/Deny 规则和工作目录 |
| `/mode` | 设置 default/acceptEdits/plan/bypassPermissions |
| `/sandbox-toggle` | 在当前 Session 切换 Sandbox 权限模式 |
| `/privacy-settings` | 直接打开隐私和策略 Config 页签 |
| `/model` | 打开模型与 reasoning effort 选择器 |
| `/effort [level]` | 交互或直接设置当前 Session 的 reasoning effort |
| `/fast [on\|off]` | 切换 Fast Mode |
| `/terminal-setup` | 查看当前终端的多行输入和外部编辑器配置 |
| `/output-style` | 选择输出风格 |
| `/color [name]` | 选择终端颜色或无障碍配色 |
| `/keybindings` | 创建或查看项目级按键绑定文件 |
| `/voice` | 检查语音输入及本机录音依赖是否可用 |
| `/release-notes` | 查看当前版本更新摘要和完整手册路径 |
| `/commit [message guidance]` | 验证当前改动并准备聚焦 Commit，不 Push |
| `/commit-push-pr [request]` | 在策略允许时完成验证、Commit、Push 和 PR 摘要 |
| `/coordinator on` | 启用只编排的 Lead Agent 模式 |
| `/artifacts` | 查看工程 Artifacts |
| `/channels` | 查看认证事件 Channels |
| `/routines` | 查看 Routines 和运行历史 |
| `/doctor` | 运行诊断 |
| `/reload` | 重新加载全部扩展 |
| `/ide install` | 安装 VS Code 扩展 |

`/advisor`、`/brief`、`/plan`、`/ultraplan`、`/review`、`/security-review`、`/summary`、`/commit` 和 `/commit-push-pr` 是可编辑的本地原生工作流；其参数会作为受边界约束的请求上下文交给 Agent。创建 Artifact、Channel 或 Routine 通常通过自然语言让 Agent 调用对应模型工具；对应 Slash 命令主要用于检查状态。

当 `policy.permissionRules.ask` 命中工具时，Agent 会暂停并显示 `Allow once / Deny`。输入 `1`、`y`、`yes` 或 `allow` 只批准完全相同的工具和目标一次；批准有时效、使用后立即删除，并写入审计日志。

## 8. CLI 命令索引

运行完整帮助：

```powershell
ccpt help
```

### 项目与诊断

```powershell
ccpt init
ccpt doctor
ccpt platform inspect
ccpt stats
ccpt audit 2026-08-30
```

### Agent

```powershell
ccpt run <goal> [--background] [--worktree|--no-worktree]
ccpt agents
ccpt agents <id>
ccpt agents wait <id> --timeout 600000
ccpt agents cancel <id>
ccpt agents cleanup <id>
ccpt agents cleanup <id> --merge
```

### Tasks 与 Team

```powershell
ccpt tasks
ccpt tasks show <task-id>
ccpt tasks claim <task-id> <agent-id>
ccpt team <team-session-id> members
ccpt team <team-session-id> inbox <agent-id>
ccpt team <team-session-id> send <from-agent-id> <to-agent-id> "message"
```

### Session 与 Checkpoint

```powershell
ccpt sessions
ccpt sessions show <session-id>
ccpt sessions history <session-id>
ccpt sessions fork <session-id> --title "alternative"
ccpt sessions resume <session-id> "continue the task"
ccpt checkpoint create [files...]
ccpt checkpoint list
ccpt checkpoint restore <checkpoint-id>
ccpt checkpoint restore <checkpoint-id> --conversation
```

### 后台 Shell

```powershell
ccpt shell start node scripts/build.mjs
ccpt shell output <shell-task-id>
ccpt shell stop <shell-task-id>
```

### 平台扩展

```powershell
ccpt skill list
ccpt skill create api-review
ccpt agent list
ccpt agent create security-reviewer
ccpt plugin list
ccpt plugin create team-standards
ccpt plugin validate <plugin-directory>
ccpt plugin hash <plugin-directory>
ccpt plugin install <plugin-directory>
ccpt plugin marketplace add anthropics/claude-plugins-official
ccpt plugin marketplace list
ccpt plugin marketplace update [name]
ccpt plugin install <plugin>@<marketplace>
ccpt plugin uninstall <plugin>
ccpt plugin enable <name>
ccpt plugin disable <name>
```

### 状态型 Epic 命令

```powershell
ccpt insights [session-id]
ccpt usage [session-id]
ccpt artifacts
ccpt channels
ccpt routines
```

## 9. 代码与模型工具

Agent 可根据模型决定调用工具。主要类别：

### 文件与代码

- 文件列举、读取、写入和精确编辑；
- Glob 和 Grep；
- Notebook 读取、替换、插入和删除；
- LSP 定义、引用、Hover、符号、实现与调用层级；
- Checkpoint 创建和恢复。

### 命令和 Git

- 受允许列表约束的可执行文件调用；
- Bash/PowerShell 风格的安全解析；
- 后台 Shell Task；
- Git status、显式文件 commit、push 和 Draft PR；
- Plan Mode 与 Worktree Mode。

### Agent 与团队

- 启动子 Agent；
- 查看或等待 Agent；
- 创建、读取、认领和更新 Task；
- 创建/删除 Team；
- Agent 间发送持久消息；
- Todo 转换为结构化 Task。

### 外部信息

- Web Fetch 与 Web Search；
- MCP Tool、Resource 和 Prompt；
- Remote Trigger；
- LSP；
- Skill 动态加载。

### Epic 产品工具

- `ask_user_question`：结构化问题和选项；
- `artifact`：Artifact 生命周期和评论；
- `monitor`：Agent、Task、Routine、Run、Wakeup；
- `push_notification`：持久通知和 Notification Hook；
- `end_conversation`：主动结束会话；
- `report_findings`：结构化 Review/Security Findings；
- `schedule_wakeup`：一次性唤醒；
- `routine`：Routine 和运行历史；
- `channel`：认证双向事件；
- `send_user_file`：返回经过工作区校验的文件；
- `send_feedback`：本地隐私受限反馈；
- `share_onboarding_guide`：团队上手说明；
- `wait_for_mcp_servers`：检查 MCP 就绪状态；
- `workflow`：执行依赖感知的多 Agent Workflow。

## 10. 多 Agent 与后台任务

### 创建专业 Agent

```powershell
ccpt agent create backend-reviewer
```

编辑：

```text
.ccpt/agents/backend-reviewer/AGENT.md
```

运行：

```powershell
ccpt agent run backend-reviewer "检查后端 API 兼容性"
```

### 并发和深度限制

`.ccpt/settings.json`：

```json
{
  "agents": {
    "maxConcurrent": 4,
    "maxPerSession": 12,
    "maxDepth": 2,
    "defaultIsolation": "worktree",
    "maxTurns": 24,
    "heartbeatTimeoutMs": 30000,
    "worktreeCleanup": "manual"
  }
}
```

限制由父 Agent 和持久状态共同执行，子 Agent 不能通过伪造深度绕过。

### 等待输入

Agent 使用结构化提问工具后会进入 `waiting_for_input`。查看：

```powershell
ccpt agents <agent-id>
```

在 TUI 中恢复该 Agent，或通过 SDK `answer()` 提交答案。

## 11. Git Worktree 与交付流程

### 隔离开发

```powershell
ccpt run "实现支付接口" --background --worktree
```

每个 Agent 获得独立 Worktree 和 `agentic/<id>` 分支，避免覆盖主目录的未提交修改。

### 清理但不合并

```powershell
ccpt agents cleanup <agent-id>
```

### 合并并清理

```powershell
ccpt agents cleanup <agent-id> --merge
```

合并前应该：

1. 查看 Agent 结果；
2. 查看 Worktree Diff；
3. 运行测试；
4. 确认没有冲突；
5. 再执行 `--merge`。

### Push 和 PR

默认关闭：

```powershell
ccpt config set --allow-git-push --allow-pull-requests
```

只应在受信项目和明确审核后开启。

## 12. Workflow、Tasks 与团队协作

Workflow 示例 `.ccpt/workflows/delivery.json`：

```json
{
  "name": "feature-delivery",
  "integration": "merge",
  "tasks": [
    {
      "id": "implementation",
      "goal": "实现功能并运行单元测试",
      "role": "developer",
      "isolation": "worktree"
    },
    {
      "id": "security",
      "goal": "对实现进行安全审查",
      "role": "security-reviewer",
      "dependsOn": ["implementation"],
      "isolation": "none"
    },
    {
      "id": "verification",
      "goal": "运行验收测试并汇总证据",
      "role": "tester",
      "dependsOn": ["implementation", "security"],
      "isolation": "none"
    }
  ]
}
```

执行：

```powershell
ccpt workflow run .ccpt/workflows/delivery.json
```

Workflow 会：

- 校验 Task ID 和依赖；
- 按依赖顺序选择 Ready Task；
- 在并发上限内并行运行；
- 等待批次完成；
- 传播失败；
- 在配置为 `merge` 时按顺序合并 Worktree。

## 13. Session、Checkpoint 与 Memory

### Session

Session 保存消息、摘要、归档消息、标题、项目目录和 Parent ID。

```powershell
ccpt sessions
ccpt sessions resume <id> "继续完成"
ccpt sessions fork <id> --title "替代方案"
```

### Context Compact

上下文接近预算时，旧轮次会进入摘要和归档，原始消息不会因为活跃窗口压缩而直接消失。

### Checkpoint

文件写入、Notebook 修改和每个 Agent Turn 都可以建立恢复点。

```powershell
ccpt checkpoint create src\api.ts test\api.test.ts
ccpt checkpoint restore <id>
```

### Memory

```powershell
ccpt memory set project architecture "服务通过事件总线通信"
ccpt memory get project architecture
ccpt memory list project
```

Memory 用于稳定工程约束，不应保存密码、Token 或临时日志。

## 14. Skills、Agents 与 Plugins

### Skill

路径：

```text
.ccpt/skills/<skill-name>/SKILL.md
```

示例：

```markdown
---
name: api-review
description: Review API compatibility and error contracts.
tools: [read_file, search_text, run_command]
---

Inspect public schemas, validation, status codes and compatibility.
```

### Agent

路径：

```text
.ccpt/agents/<agent-name>/AGENT.md
```

可配置模型、Tools、禁止 Tools、Skills、MCP Servers、权限模式、Worktree、后台执行和最大 Turn。

### Plugin

Plugin 可以贡献：

- Skills；
- Agents；
- Commands；
- Hooks；
- MCP Servers。

Plugin 不会把任意 JavaScript 注入主进程；执行逻辑必须经过 Hook、MCP 和策略边界。

Claude Code Marketplace 与插件也可直接使用。输入 `/plugin` 后通过 `Tab` 切换 Discover、Installed、Marketplaces 和 Errors；文字搜索、方向键移动、`Enter` 查看来源。Discover 页用 `Space` 安装，Installed 页用 `Space` 卸载、`u` 更新，Marketplaces 页用 `Space` 切换 auto-update。Claude 插件安装到当前项目 `.ccpt/plugins/`，其 Skill 和旧式 Command 会以 `/plugin-name:component-name` 出现在斜杠候选中。

```text
/plugin marketplace add anthropics/claude-plugins-official
/plugin install frontend-design@claude-plugins-official
/plugin update frontend-design@claude-plugins-official
/plugin marketplace update claude-plugins-official
/plugin marketplace auto-update team-market on
/reload-plugins
/frontend-design:frontend-design
```

验证：

```powershell
ccpt plugin validate D:\shared\team-standards
ccpt plugin hash D:\shared\team-standards
```

## 15. MCP 与 LSP

### MCP stdio

```powershell
ccpt mcp add internal-tools `
  --command node `
  --args D:\mcp\server.mjs
```

### MCP HTTP

```powershell
ccpt mcp add jira `
  --url https://tools.company.example/mcp `
  --token-env JIRA_MCP_TOKEN
```

### 登录

```powershell
ccpt mcp login jira
ccpt mcp logout jira
```

无浏览器服务器可使用 OAuth Device Flow：

```powershell
ccpt mcp oauth-login jira
```

### Resources 和 Prompts

```powershell
ccpt mcp resources
ccpt mcp read-resource internal-tools resource://guide
ccpt mcp prompts
```

### LSP

```powershell
ccpt lsp add typescript `
  --command typescript-language-server `
  --args --stdio `
  --extensions .ts,.tsx `
  --language-id typescript

ccpt lsp query hover src/index.ts --line 10 --character 5
```

## 16. Hooks 生命周期自动化

Hook 支持 `command`、`http`、`prompt` 和 `agent` 四种执行方式。

示例：

```json
{
  "hooks": [
    {
      "event": "PreToolUse",
      "type": "command",
      "matcher": "write_*",
      "command": "node .ccpt/hooks/check-write.js",
      "timeoutMs": 30000
    },
    {
      "event": "WorktreeCreate",
      "type": "command",
      "command": "npm install",
      "timeoutMs": 300000
    },
    {
      "event": "Stop",
      "type": "prompt",
      "prompt": "Verify completion evidence before stopping: $ARGUMENTS"
    }
  ]
}
```

主要事件包括：

- SessionStart/SessionEnd；
- UserPromptSubmit/UserPromptExpansion；
- PreToolUse/PostToolUse/PostToolUseFailure/PostToolBatch；
- PermissionRequest/PermissionDenied；
- TaskCreated/TaskUpdated/TaskCompleted；
- SubagentStart/SubagentStop/TeammateIdle；
- WorktreeCreate/WorktreeRemove；
- ConfigChange/FileChanged；
- PreCompact/PostCompact；
- Notification、MessageDisplay、Elicitation。

`restricted` 模式禁用 Hook。命令 Hook 不经过 Shell 字符串解释。

## 17. Artifacts、Channels 与 Routines

### Artifacts

支持类型：`markdown`、`html`、`svg`、`json`、`diagram`。

支持：

- private/team 可见性；
- 创建、更新、读取、列举、删除；
- 评论和评论回复；
- MCP/Data Source 元数据；
- Owner 写入控制和大小上限。

对 Agent 说：

```text
把当前架构分析保存成 team 可见的 diagram Artifact，并邀请 reviewer 评论。
```

查看：

```powershell
ccpt artifacts
```

### Channels

Channels 提供：

- 随机配对 Token；
- Token 只在配对时返回，持久层只保存 Hash；
- 发送者白名单；
- inbound/outbound 事件；
- Event ID 幂等；
- 持久收发箱和 Delivered 状态；
- Enable/Disable。

外部 Webhook、Jira、Slack 等系统需要编写相应 Adapter；Channel Core 不会自行申请第三方账号。

### Routines 与 Wakeup

Routine 保存：

- Name 和 Prompt；
- 可选 Cron 表达式；
- 默认 Inputs；
- Run 输入、状态、结果和错误；
- 完整运行历史。

Wakeup 保存未来的 Session Prompt，并确保只交付一次。实际定时唤醒进程需要宿主调度器持续运行。

查看：

```powershell
ccpt routines
```

## 18. Agent SDK

安装项目依赖后：

```typescript
import {
  runAgent,
  query,
  AgentSdkSession,
  InMemorySessionStorage,
  defineInProcessTool,
  InProcessToolRegistry,
  parseStructuredOutput,
  artifacts,
  channels,
  automation,
  usage,
  enterprise,
} from 'ccpt/sdk';
```

### 一次性运行

```typescript
const agent = await runAgent({
  prompt: 'Review the current diff',
  cwd: process.cwd(),
  agent: 'reviewer',
  permissionMode: 'restricted',
  isolation: 'none',
});

console.log(agent.status, agent.result);
```

### 流式生命周期

```typescript
const session = new AgentSdkSession({
  prompt: 'Implement and test the API',
  cwd: process.cwd(),
  background: true,
  isolation: 'worktree',
  systemPrompt: 'Follow the company API compatibility rules.',
});

await session.start();

for await (const event of session.events()) {
  console.log(event.type, event.agent.status);

  if (event.type === 'question') {
    await session.answer('Use the existing database transaction pattern.');
  }
}
```

### 结构化输出

```typescript
const schema = {
  type: 'object',
  required: ['ok', 'findings'],
  properties: {
    ok: { type: 'boolean' },
    findings: { type: 'array', items: { type: 'string' } },
  },
};

const result = parseStructuredOutput(
  '{"ok":true,"findings":[]}',
  schema,
);
```

### 外部 Session Storage 接口

生产系统可以实现：

```typescript
interface ExternalSessionStorage<T> {
  load(id: string): Promise<T | null>;
  save(id: string, value: T): Promise<void>;
  delete(id: string): Promise<void>;
  list(): Promise<string[]>;
}
```

可由 S3、Redis、数据库或公司内部存储实现。

## 19. 企业权限、安全与审计

### 权限模式

| 模式 | 说明 |
|---|---|
| `bypass` | 在已配置范围内最宽松，只适用于隔离受信环境 |
| `normal` | 工作区、保护路径、命令策略、Hook 和审计生效 |
| `sandbox` | 在 normal 基础上强制企业 Process Wrapper |
| `restricted` | 禁止写入、进程、Hook 和外部网络，仅保留工作区只读分析及 loopback 服务 |

运行：

```powershell
ccpt run "只读审查项目" --restricted
ccpt run "执行构建" --permission-mode sandbox
```

### 细粒度规则

```json
{
  "policy": {
    "permissionRules": {
      "allow": ["read_file(*)", "search_text(*)"],
      "ask": ["git_commit(*)"],
      "deny": ["git_push(*)", "run_command(rm *)"]
    }
  }
}
```

优先级：`deny > ask > allow`。

检查：

```powershell
ccpt permissions check git_push --json '{"remote":"origin"}'
```

### 保护机制

- 路径真实化并阻止符号链接逃逸；
- `.env`、`.ssh`、`.aws`、Credentials 等默认保护；
- 保护文件不会出现在枚举、搜索、读取或仓库上下文中；
- 子进程使用环境变量允许列表；
- Token、Authorization、URL 凭据会在审计中脱敏；
- 外部网络受 Host Allowlist、Proxy、CA 和 mTLS 控制；
- Git Push 和 PR 默认关闭；
- Sandbox 未配置 Wrapper 时失败关闭。

### 企业治理 API

SDK 还提供：

- RBAC 和组织隔离；
- Provider Profile；
- Spend Limit；
- Zero Retention；
- Privacy-bounded Feedback；
- 签名 Runner Session Identity；
- External Surface Adapter Registry。

## 20. VS Code 集成

安装：

```powershell
ccpt ide install
```

重启 VS Code，然后执行：

```text
CCPT: Open Agent Panel
```

扩展支持：

- 当前文件和选区作为上下文；
- 文件附件；
- 发送任务；
- Focus View；
- Agent queued/working 状态；
- 取消 Agent；
- Session 恢复；
- Agent 和 Session 侧边栏。

如果扩展无法连接：

```powershell
ccpt ide serve
```

然后检查 VS Code Output 和 `ccpt doctor`。

## 21. Direct Connect 与远程运行

设置短期凭据：

```powershell
$env:CCPT_REMOTE_TOKEN = '<short-lived-token>'
```

创建远程会话：

```powershell
ccpt remote create --url https://remote.company.example
ccpt remote list
```

可信设备：

```powershell
ccpt remote trust laptop-01 '<public-device-identity>'
ccpt remote devices
ccpt remote revoke <device-id>
```

远程层支持：

- Direct Connect 会话协商；
- 重连、心跳和有序 ACK；
- 消息去重；
- 远程权限请求；
- 可信设备；
- 短期 JWT；
- 附件工作区隔离；
- CONNECT-over-WebSocket 上游代理。

远程 Server、Mobile Push 或跨机器控制面需要部署对应服务。

## 22. 数据目录与配置优先级

### 项目数据

```text
<project>/.ccpt/
```

包含 Settings、扩展、Workflows、Artifacts、Channels、Routines、通知、Findings 和项目级状态。

### 用户状态

默认：

```text
Windows: %USERPROFILE%\.ccpt
macOS/Linux: ~/.ccpt
```

可覆盖：

```powershell
$env:CCPT_HOME = 'D:\ccpt-state'
```

用户状态包含运行中的 Agent 记录、Sessions、Usage、Audit 和 Memory；自定义扩展不会从这里注入项目。

### 配置优先级

```text
内置默认
  ↓
用户配置
  ↓
项目配置
  ↓
CCPT_MANAGED_CONFIG
  ↓
操作系统托管配置
```

托管配置最后合并，优先级最高。

支持：

- Windows Registry：`HKLM\Software\Policies\CCPT`；
- macOS Managed Preferences；
- Linux `/etc/ccpt/managed-settings.json`；
- `CCPT_MANAGED_CONFIG` 指向的 JSON。

## 23. 常见使用场景

### 场景一：只读架构分析

```powershell
ccpt run "分析项目架构、依赖边界和技术风险，不要修改文件" --restricted
```

### 场景二：功能开发和测试

```powershell
ccpt run "实现订单取消功能，补单元测试并输出验证结果" --worktree
```

### 场景三：后台安全审查

```powershell
ccpt run "审查当前 Diff 中的认证与输入验证风险" `
  --background `
  --no-worktree `
  --agent security-reviewer
```

### 场景四：多 Agent 交付

```powershell
ccpt workflow run .ccpt/workflows/delivery.json
```

### 场景五：企业 CI 只读检查

```powershell
ccpt run "检查代码规范、安全风险和测试缺口" --restricted
```

### 场景六：使用内部 Jira/Docs MCP

```powershell
$env:JIRA_MCP_TOKEN = '<token>'
ccpt mcp add jira --url https://tools.company.example/mcp --token-env JIRA_MCP_TOKEN
ccpt mcp test jira
ccpt
```

然后在 TUI 中输入：

```text
读取 Jira 中 PAY-1024 的验收标准，对照当前代码给出实施计划。
```

## 24. 故障排查

### `ccpt` 找不到

```powershell
npm config get prefix
npm list --global ccpt
```

确认 npm 全局 Bin 目录已加入 `PATH`，或使用：

```powershell
npx ccpt
```

### 模型请求失败

检查：

```powershell
ccpt config show
ccpt doctor
$env:CCPT_API_KEY
```

常见原因：

- Base URL/Endpoint URL 不正确；
- 模型不支持 Tool Calling；
- Host 未加入 Allowlist；
- Proxy、CA 或 mTLS 配置错误；
- API Key Header/Prefix 不匹配；
- 旧于 `0.31.2` 的 CCPT 会把 `glm-5.2[1m]` 原样发给网关并收到 `1214 modelCode 不存在`；升级后无需修改模型配置；
- `restricted` 阻止了外部模型网络。

### Agent 一直 queued/working

```powershell
ccpt agents
ccpt agents <id>
ccpt audit
```

检查后台 Worker 是否能启动、`CCPT_CLI_ENTRY` 是否正确、进程 Wrapper 是否允许 Node，以及 Heartbeat 是否超时。

### Worktree 失败

```powershell
git status
git worktree list
ccpt doctor
```

确认当前目录是 Git 仓库，并检查分支名或残留 Worktree。

### Sandbox 无法执行命令

这是预期的失败关闭行为。检查：

```json
{
  "policy": {
    "mode": "sandbox",
    "processWrapper": "D:\\enterprise\\ccpt-process-wrapper.exe"
  }
}
```

没有 Wrapper 时请改用 `normal`，不要通过伪造 Wrapper 绕开安全控制。

### MCP 失败

```powershell
ccpt mcp list
ccpt mcp test <server>
ccpt mcp logout <server>
ccpt mcp login <server>
```

stdio MCP 还需要通过命令允许列表；HTTP MCP 需要 Host Allowlist。

### 查看审计

```powershell
ccpt audit
ccpt audit 2026-08-30
```

## 25. 开发、测试与打包

在 CCPT 源码目录：

```powershell
cd C:\Users\55038\CCPT
npm install
npm run check
npm test
npm run coverage
npm run epics
npm run build
npm pack
```

当前 `0.34.0` 验证基线：

- TypeScript 全量检查通过；
- 199 个测试、1,250 个断言，0 失败；
- 1,902 个参考源码文件：Implemented 1,803、Partial 0、Missing 0、Integration Required 99；
- 415 条 User Story 已逐项审计；
- Epic 状态：Implemented 332、Partial 0、Integration Required 83；
- CLI、MCP、SDK 构建及发行入口已通过烟雾测试。

单独测试：

```powershell
bun test .\test\epic-enhancements.test.ts
bun test .\test\agent-operation.test.ts
bun test .\test\policy.test.ts
```

## 26. 已知边界

以下能力不能仅凭本地源码自动获得，必须部署或安装对应系统：

- JetBrains 插件宿主；
- 独立 Desktop 或 Web 云控制面；
- Chrome/Computer Use 适配器；
- GitHub/GitLab App、CI 和企业托管授权；
- 企业 SSO、IdP 和管理后台；
- 自托管 Runner/Orchestrator；
- APNs/FCM Mobile Push；
- Slack、Jira 等第三方 Channel Adapter；
- OS 级 Sandbox Wrapper；
- 云 Provider 的真实凭据链；
- 组织级 Analytics Dashboard。

CCPT 对这些能力提供配置、协议或 Adapter 边界；未安装时会显式失败，不会伪装成可用。

完整状态见 `EPIC-ENHANCEMENT-MATRIX.md`。

## 27. 相关文档索引

| 文档 | 用途 |
|---|---|
| `README.md` | 快速概览 |
| `docs/PRODUCT-GUIDE.zh-CN.md` | 当前完整中文手册 |
| `docs/EXTENSIONS.md` | Skill、Agent、Plugin、MCP、Hook 开发 |
| `docs/ENTERPRISE.md` | 企业网络、权限、托管配置和部署 |
| `docs/ARCHITECTURE.md` | 系统架构 |
| `docs/ACCEPTANCE-MATRIX.md` | 最初 25 项验收矩阵 |
| `docs/EPIC-ENHANCEMENT-MATRIX.md` | 415 条 User Story 最新逐项状态 |
| `docs/SOURCE-COVERAGE.md` | 1,902 个参考源码映射摘要 |
| `docs/UI-COMPATIBILITY-INVENTORY.md` | Commands/Components/Ink 映射 |
| `docs/NATIVE-COMPATIBILITY-INVENTORY.md` | Utils/Hooks/Screens 等映射 |

---

最短启动路径：

```powershell
npm install --global C:\Users\55038\CCPT\ccpt-0.34.0.tgz
cd D:\projects\your-project
ccpt init
ccpt config set --base-url http://127.0.0.1:11434/v1 --model your-model
ccpt doctor
ccpt
```

`0.34.0` 增加统一 Runtime Event Bus 与 Claude 风格 Agent View。终端、SDK 和 IDE 共享有序运行事件；后台任务可用 `--bg` 启动，并通过 `attach`、`logs`、`stop` 观察和控制。模型文本仍按真实 SSE 增量显示，Windows 高频状态写入继续使用按路径串行及原子替换重试。
