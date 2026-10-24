# 0.50：交互、Skills、Plan、Subagents 与 Teams

日期：2026-10-06。版本：0.50.0。本批重点是把定义文件和终端操作接到真实 Agent 运行链路，保留现有 Messages / Chat Completions / Responses、公司网络配置及上下文续接能力。

## 安装与升级

```powershell
npm install --global ./ccpt-0.50.0.tgz
cd D:\your-project
ccpt
```

不需要 EXE。Node.js 20+。这是本地安装包，不意味着已发布公共 npm，也不意味着第三方再分发授权已完成。升级不会覆盖已有公司模型、CA 和用户 settings。

## Skills：当前会话与隔离执行

项目路径：`.ccpt/skills/<name>/SKILL.md`。例如：

```markdown
---
name: explain-api
description: 解释 API 边界和调用链
argument-hint: <问题>
disable-model-invocation: true
allowed-tools:
  - Read
  - Grep
---
结合当前对话解释 $ARGUMENTS，不要修改文件。
```

在 TUI 输入 `/explain-api 支付接口如何鉴权`：保持当前 Agent ID、Session ID 和既有对话；Skill 的工具限制只作用于这一轮，下一轮普通聊天恢复原来的工具范围。`/skills explain-api` 查看详情；`/skills explain-api <问题>` 也可执行。

需要独立专家时加：

```yaml
context: fork
agent: api-reviewer
model: inherit
```

它会运行真实子代理，使用独立上下文，不复制主会话历史；完成后界面回到主代理，结果可在 Agent 面板查看，主代理下一轮收到队友结果通知。子代理等待输入时，可在 `/agents` 附加它继续操作。不能把分叉理解成当前会话的完整历史克隆；需要历史分叉应使用已有的会话 fork 功能。

`agent` 必须指向已加载的定义；不存在会明确报错。插件内本地 Agent 名会映射到插件命名空间。Agent 声明 `isolation: worktree` 时，fork Skill 使用该隔离设置；需 Git 仓库和可用基础引用。未声明时 fork Skill 不自动创建 worktree，隔离的是模型上下文。

参数支持 `$ARGUMENTS`、`$ARGUMENTS[0]`、`$0` 等零基序号；未使用占位符时附加参数文本。只进行字面替换，不执行 Skill 内的 `!` shell 插值。

### 可见性与权限不是一回事

`/skills` 面板按 Space 循环四态，Esc 保存可见性：

| 状态 | 模型目录 | 人工斜杠调用 |
| --- | --- | --- |
| `on` | 名称及描述 | 可用 |
| `name-only` | 仅名称 | 可用 |
| `user-invocable-only` | 不提供 | 可用 |
| `off` | 不提供 | 不可用 |

```json
{
  "skillOverrides": { "explain-api": "user-invocable-only" },
  "disableBundledSkills": false
}
```

`user-invocable: false` 隐藏人工入口，`disable-model-invocation: true` 禁止模型调用。它们是定义的约束，不能用 `on` 或旧 `skillModes: auto` 绕过。旧 `auto/manual/disabled` 配置继续保留；不同别名指向同一文件时按更严格的约束组合。

CLI 可管理并运行：

```powershell
ccpt skills list
ccpt skill visibility explain-api name-only
ccpt skill run explain-api "解释支付接口" --agent-id agent_实际ID
```

`allowed-tools` 是能力上限，不是免审批许可；父代理、Agent 定义、配置过滤和多个 Skill 的上限取交集。动态加载 Skill 后，同一批后续工具调用也立即受限。支持精确工具名和常用 Read/Grep/Glob/Bash/Write/Edit/Agent/Skill 映射；不支持 `Bash(git *)` 等模式，应在权限规则中配置。

解析器支持顶层标量、字符串数组、缩进字符串列表和 `>` / `|` 多行字符串；不是完整 YAML 实现，不接受任意嵌套对象、脚本或 YAML 标签。

## Agent 文件、专属记忆和权限继承

创建 `.ccpt/agents/api-reviewer.md`：

```markdown
---
name: api-reviewer
description: 审查 API 的正确性与安全边界
model: inherit
memory: project
permissionMode: normal
maxTurns: 8
tools:
  - Read
  - Grep
  - agent_memory
---
审查代码并报告可定位的问题。使用 agent_memory 保存工程约定，不保存密钥。
```

Markdown、JSON 和 settings 内联定义共享字段校验，非法工具列表、权限模式、记忆范围和轮数会报告诊断。`model: inherit` 使用当前模型，不请求名为 inherit 的模型；轮数受平台总上限约束。

子代理继承父代理的工具上限、只读 Plan 状态和更严格的权限，不能通过 `permissionMode: bypass` 获得父代理没有的权限。恢复父代理已提交但尚未审批的 Plan，也不能以普通聊天或新建子代理方式绕过审批。

显式开启 `memory` 的专家使用专属目录：

| 范围 | 保存位置 |
| --- | --- |
| `project` | `.ccpt/agent-memory/<专家标识>/` |
| `local` | `.ccpt/agent-memory-local/<专家标识>/` |
| `user` | 用户状态目录下，按工作区 hash 和专家标识隔离 |

启动时加载 `MEMORY.md` 前 200 行，其他知识通过 `agent_memory` 的 list/read/write 获取。每个文件限制 25 KB，键名不允许路径，拒绝 junction/symlink，原子写入并检查已知秘密格式。Plan 和 restricted 模式禁止写记忆。检查是尽力检测，不是凭据保险箱；不要存放企业密钥。建议把 `agent-memory-local/` 加入项目忽略规则。未显式声明 memory 的旧配置仍保留旧版记忆路径，不声称完成所有历史迁移。

## Plan：提交不等于批准

终端空闲时 Shift+Tab 循环正常 → acceptEdits → Plan → 正常；已配置 sandbox/restricted 等模式不会被快捷键降级，受管策略仍优先。不会用此快捷键进入 bypass，也未启用参照实现的 AI 自动审批分类器。

Plan 状态会传到实际 worker：请求只提供只读工具，执行层也校验。模型调用 `exit_plan_mode` 表示**提交计划并等待审批**，不是自行取得编辑权限。计划保存为 `pending_approval`，会话完整保存工具结果，后续同批写入不会执行。

```text
/plan approve plan_实际ID
/plan changes plan_实际ID 先补测试范围
```

批准是人工操作；执行器确认计划归属和状态后才继续原 Agent。参考产品可能提供自动审批选择，本版刻意保留企业明确授权边界。

## Teams：使用真实运行组

先发出一个普通任务形成主 Agent，再使用：

```text
/team create Payment Engineering
/team spawn --plan api-reviewer 审查支付接口并提交计划
/teams
/team broadcast 重点检查幂等性；这不是审批授权
/team shutdown agent_实际ID
/team cleanup team_实际ID confirm
```

`/teams` 是 Members / Tasks / Inbox 面板；读 Inbox 不消耗未读通知。没有当前 Agent 时展示当前工作区命名团队。`spawn` 启动后台队友，主会话可以继续聊天；配置隔离的专家可使用 worktree。

命名团队绑定实际 root Session，同一运行组复用团队；成员不能跨团队发消息，Agent 消息不能批准人工权限。只有 root lead 可以请求停止队友。后台 worker 在模型推理期间也轮询停止请求，取消后发送持久确认；停止控制被确认消费，不会在人工恢复时重复取消。普通消息文本不能触发停止。

清理先检查真实运行组中是否还有 queued/working/waiting_for_input 的 Agent；有则拒绝。清理仅删除命名团队登记，不删除对话、任务、文件和 worktree，不推送、不自动合并、不创建 PR。停止不是回滚修改。

```powershell
ccpt teams list
ccpt teams create agent_主代理ID "Payment Engineering"
ccpt teams members agent_主代理ID
ccpt teams broadcast agent_主代理ID "共享分析证据"
ccpt teams shutdown agent_主代理ID agent_队友ID
ccpt teams cleanup team_实际ID confirm
```

团队消息可以在下一轮模型请求中作为带来源的数据读取，但不是用户指令，不能替人审批。未实现收到普通消息自动唤醒任意空闲队友，避免隐式模型费用。

## SDK 与验证

`ccpt/sdk` 新增 `invokeUserSkill`、`continueAgent`、`loadAgent`、`loadSession`，及 `teams`、`teamMailbox`、`agentMemory` 命名空间。扩展作者可复用同一执行服务，不需要自行复制 UI 逻辑。

验证命令：

```powershell
npm run check
bun test ./test
npm run build
npm pack
node scripts/smoke-platform-050.mjs <独立npm安装目录>
```

完整回归：415 项 / 83 文件 / 0 失败。新增实际 Agent 回归覆盖 inline/fork、完整工具列表、结果回传、工具范围下一轮恢复、记忆工具、Plan 审批与子代理只读、Teams 取消和恢复。原始按键 TUI 测试覆盖连续会话、Teams 三页、fork 后返回主代理与 Shift+Tab。安装包另用原生 Node 20 的独立 npm 安装测试 CLI/SDK，不依赖 Bun 才能运行；模型服务为本机协议 fixture，不替代公司部署验收。

最终完整回归为 3151 次断言，独立安装的 `ccpt.cmd --version` 返回 0.50.0；原生 Node 20.9 的新功能 smoke 和旧 MCP OAuth/Windows DPAPI/插件回滚 smoke 都通过。实际 Windows PTY 启动也检查了信任门、欢迎界面、Skills 空态和 Teams 面板，并正常退出。已完成的队友收到 shutdown 会保留 completed 状态而非改写历史；活跃队友的取消另外由真实 worker 回归验证。

快捷键验证边界：自动化 PTY 工具在 Windows 把发送的 Shift+Tab 转成普通 Tab（用原生 readline 输出键事件确认），因此 Shift+Tab 循环由保留原始键序列的 TUI 集成测试验证，不将这个自动化通道的按键传输等同于所有 Windows 终端真机验收。

最新版对比记录见 [交互核对](UI-COMPARISON-0.50.zh-CN.md)。未完成边界见 [0.50 清单](REMAINING-0.50.zh-CN.md)。公司连接配置继续看 [三协议指南](MODEL-PROTOCOLS-0.45.zh-CN.md) 和 [公司默认配置](COMPANY-DEFAULTS-0.44.zh-CN.md)。
