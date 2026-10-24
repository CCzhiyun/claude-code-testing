# CCPT 扩展开发指南

## 1. 加载范围与优先级

CCPT 把用户确认信任的工作区作为完整扩展边界。Skill 和 Agent 文件格式与 Claude Code 的项目级约定兼容，不会把用户主目录或另一个项目中的扩展混入当前项目。

- 项目 Skill：`<project>/.ccpt/skills/`
- 项目 Agent：`<project>/.ccpt/agents/`
- 项目 Rule：`<project>/.ccpt/rules/`
- 项目 Plan：`<project>/.ccpt/plans/`
- 项目 Plugin：`<project>/.ccpt/plugins/`
- 额外目录：项目 `.ccpt/settings.json` 中的 `skillsDirectories`、`agentsDirectories`、`pluginDirectories`，且路径必须仍位于该受信任工作区内

发生重复、格式错误或缺失文件时，运行时不会静默执行可疑内容。问题会显示在 `/reload`、`ccpt platform inspect` 和 `ccpt doctor` 的 diagnostics 中。

## 2. Skill

新项目会在 `.ccpt/plugins/ccpt-foundation` 获得一套可编辑的基础工作流，包括 review、security-review、verify、debug、simplify、run 和 batch。它与团队自建 Plugin 使用完全相同的契约。

Skill 是带 frontmatter 的 Markdown 文档：

```markdown
---
name: api-review
description: Review API compatibility, validation, and error contracts.
tools: [read_file, search_text, run_command]
---

Write the engineering rules and verification workflow here.
```

推荐目录结构为 `.ccpt/skills/api-review/SKILL.md`。`ccpt skill create api-review` 会直接写入启动 CCPT 时确认信任的当前工作区，而不是用户目录、其他项目或其他 CLI 的目录。`/skills` 每次打开都会重新发现，面板内按 `[project]` 或 `[plugin]` 标明来源，也可以按 `r` 手动刷新。项目设置中显式加入的扩展目录也必须位于当前工作区内。Agent 可以通过 `skills` 显式引用；普通会话也会根据任务中的 Skill 名称进行选择。运行时只注入已激活 Skill 的完整内容，并提供其余 Skill 的简短目录，避免上下文无控制增长。

## 3. Agent

项目 Agent 是 `.ccpt/agents/<name>/AGENT.md`：

```markdown
---
name: security-reviewer
description: Review trust boundaries and security-sensitive changes.
tools: [list_files, read_file, search_text, run_command]
disallowedTools: [write_file]
skills: [api-review]
permissionMode: sandbox
isolation: worktree
background: true
maxTurns: 12
---

You are an independent security reviewer. Verify findings and cite evidence.
```

可用字段：

- `name`、`description`：必填。
- `tools`：允许的模型工具；省略表示使用平台工具集。
- `disallowedTools`：从允许集合中进一步排除。
- `skills`：启动时加载的 Skill。
- `mcpServers`：允许该 Agent 使用的 MCP 服务名。
- `model`：为该 Agent 覆盖模型。
- `permissionMode`：`normal`、`sandbox`、`restricted` 或 `bypass`。
- `isolation`：`none` 或 `worktree`。
- `background`：是否默认后台运行。
- `maxTurns`：最大工具循环轮次。

运行 Agent：

```powershell
ccpt agent run security-reviewer "Review the current changes"
```

终端 UI：

```text
/agent security-reviewer Review the current changes
```

## 4. Plugin

Plugin 是一个纯声明式目录。CCPT 不会把 Plugin JavaScript 加载进 CLI 进程；可执行能力通过经过策略检查的 Hook 或 MCP 进程提供。

```text
team-standards/
├── plugin.json
├── agents/
├── skills/
└── mcp/
```

示例 `plugin.json`：

```json
{
  "$schema": "../../plugin.schema.json",
  "schemaVersion": 1,
  "name": "team-standards",
  "version": "1.0.0",
  "description": "Shared team engineering workflows.",
  "contributes": {
    "skills": ["./skills"],
    "agents": ["./agents"],
    "commands": [
      {
        "name": "team-review",
        "description": "Review changes using team standards",
        "agent": "reviewer",
        "skills": ["review"],
        "prompt": "Review the current changes. Additional focus: {args}",
        "background": false,
        "isolation": "none"
      }
    ],
    "hooks": [],
    "mcpServers": {}
  }
}
```

Plugin 内的 Agent 和 Skill 会注册为 `plugin:component`，避免不同团队包之间重名。CCPT 原生 manifest 的 Plugin 命令使用 `/command`；Claude Code manifest 的 Skill 与命令遵循官方命名空间，使用 `/plugin-name:component-name`。`{args}` 会替换为用户参数，`{cwd}` 会替换为工作目录。

所有贡献路径必须是以 Plugin 根目录为边界的相对路径，不能使用绝对路径或 `..` 逃逸。安装本地 Plugin：

```powershell
ccpt plugin validate D:\shared\team-standards
ccpt plugin install D:\shared\team-standards
```

团队可以使用 `ccpt plugin hash <directory>` 计算内容摘要，然后把返回值写入 manifest 的 `integrity` 字段。运行时和安装时都会重新校验。`ccpt plugin disable <name>` 与 `enable` 可在项目级控制加载状态；管理员也可以通过托管配置下发 `disabledPlugins`。

### 4.1 Claude Code Marketplace

CCPT 可直接注册 Claude Code Marketplace：

```text
/plugin
/plugin marketplace add anthropics/claude-plugins-official
/plugin install frontend-design@claude-plugins-official
/frontend-design:frontend-design
```

`/plugin` 会先立即打开管理器并加载当前工作区缓存；不会等待 GitHub。发行包内置公开官方目录快照，因此首次离线进入也能立即看到 Discover 列表。随后后台刷新会使用项目网络设置以及 `HTTPS_PROXY`/`HTTP_PROXY`；失败时保留快照或上一次成功缓存，并在 Marketplaces/Errors 页显示可重试诊断。

Discover 或 Installed 页按 `Enter`/`Space` 进入完整详情页，再选择 project/local 安装范围、更新、卸载、查看主页或返回。安装不会偷偷改变当前会话；成功后回到聊天并提示 `/reload-plugins`。reload 后，新 Skill 同时注册无冲突简洁名（如 `/frontend-design`、`/brainstorming`）和稳定命名空间名。`frontend-design`、`superpowers` 带有随包离线安装种子，保证本产品的参考验收路径不依赖 GitHub 是否可达。

对应 CLI：

```powershell
ccpt plugin marketplace add anthropics/claude-plugins-official
ccpt plugin marketplace add owner/repository
ccpt plugin marketplace add https://plugins.example.com/marketplace.json
ccpt plugin marketplace add .\team-marketplace
ccpt plugin marketplace list
ccpt plugin marketplace plugins
ccpt plugin marketplace errors
ccpt plugin marketplace update [name]
ccpt plugin marketplace auto-update <name> <on|off>
ccpt plugin marketplace remove <name>
ccpt plugin install <plugin>@<marketplace>
ccpt plugin update <plugin>@<marketplace>
ccpt plugin uninstall <plugin>@<marketplace>
```

斜杠入口只有 `/plugin` 一个：无参数时打开 `Discover / Installed / Marketplaces / Errors`，其他功能通过子命令进入。官方 `claude-plugins-official` 首次受信任会话会自动注册，auto-update 默认开启；第三方和本地 Marketplace 默认关闭，可在 Marketplaces 页用 `Space` 切换，或运行 `/plugin marketplace auto-update <name> <on|off>`。

手动 `/plugin marketplace update [name]` 只刷新 Marketplace 目录，不替换已安装 Plugin；`/plugin update <plugin>@<marketplace>` 才立即更新指定 Plugin。后台 auto-update 与 Claude Code 一致，会刷新已启用的 Marketplace 并更新其中已安装 Plugin 到磁盘，但当前会话保持已加载版本，需运行 `/reload-plugins` 激活。设置 `DISABLE_AUTOUPDATER=1` 可关闭后台更新；同时设置 `FORCE_AUTOUPDATE_PLUGINS=1` 可只保留 Plugin 更新。

兼容格式和默认发现位置：

- Marketplace：`.claude-plugin/marketplace.json`；
- Plugin manifest：`.claude-plugin/plugin.json`，manifest 缺失时也会按默认目录发现；
- Skill：`skills/<name>/SKILL.md` 或根 `SKILL.md`；
- 旧式命令：`commands/*.md`，自动转换为带 `$ARGUMENTS` 的命名空间斜杠工作流；
- Agent：`agents/*.md`；
- Hook：`hooks/hooks.json`；
- MCP：`.mcp.json`；LSP：`.lsp.json`。

Marketplace source 支持本地路径、GitHub `owner/repo`、Git URL、HTTPS 目录文件、`git-subdir`、npm、archive 和 command。archive 在解压前检查绝对路径、`..` 逃逸、文件数量和总下载大小；command source 默认拒绝，必须先在详情页查看命令再确认，CLI 则要求 `--yes`。所有 Marketplace 状态、缓存和安装结果都在当前受信任工作区 `.ccpt/`，不会恢复为全局扩展。

## 5. MCP

创建可运行的 stdio 示例：

```powershell
ccpt mcp create internal-tools
ccpt mcp test internal-tools
```

配置现有服务：

```powershell
ccpt mcp add docs --command node --args D:\mcp\server.mjs
ccpt mcp add jira --url https://internal.example/mcp --token-env JIRA_MCP_TOKEN
```

无浏览器远程环境可配置 OAuth device flow：

```powershell
ccpt mcp add work-items --url https://tools.company.example/mcp `
  --oauth-client-id ccpt-cli `
  --oauth-device-url https://identity.company.example/device `
  --oauth-token-url https://identity.company.example/token `
  --oauth-scopes tools.read,tools.write
ccpt mcp oauth-login work-items
ccpt mcp logout work-items
```

stdio 进程会经过命令允许列表与 restricted 模式检查，并使用过滤后的环境变量。HTTP 服务受 `allowNetwork` 策略控制。凭据使用 `tokenEnv` 或 `mcp login`，不要写入 Plugin 清单。

## 6. Hook

Hooks 支持四种持久化执行形态，并可使用 `matcher` 或 `if` 在启动前过滤：

```json
[
  { "event": "PreToolUse", "type": "command", "matcher": "write_*", "command": "node .ccpt/hooks/check-write.js" },
  { "event": "Setup", "type": "http", "url": "https://policy.example/hooks/setup", "headers": { "Authorization": "Bearer $HOOK_TOKEN" }, "allowedEnvVars": ["HOOK_TOKEN"] },
  { "event": "Stop", "type": "prompt", "prompt": "Verify completion: $ARGUMENTS" },
  { "event": "Stop", "type": "agent", "prompt": "Run an independent completion verification: $ARGUMENTS" }
]
```

同步 Hook 可以返回 JSON：`continue`、`decision`、`reason`、`additionalContext` 和 `updatedInput`。HTTP Hook 统一使用企业代理、CA、mTLS 与目标白名单，并额外拒绝私网、链路本地和云元数据地址；loopback 保留给本地策略服务。

Plugin 或项目配置可以贡献生命周期 Hook：

```json
{
  "event": "PostToolUse",
  "command": "node scripts/audit.mjs",
  "timeoutMs": 30000
}
```

Hook 不通过 Shell 解释器执行，命令必须在允许列表中，危险操作符会被拒绝，敏感环境变量和 payload 字段会被过滤。`restricted` 模式禁用 Hook。

## 7. 团队分发建议

将 Plugin 放在独立仓库并使用语义版本。合并前运行：

```powershell
ccpt plugin validate .
ccpt platform inspect
ccpt doctor
```

企业管理员可通过托管配置固定允许的命令、网络策略、工作目录、Agent 并发/深度以及扩展目录。团队仓库只保存不含凭据的声明文件。
