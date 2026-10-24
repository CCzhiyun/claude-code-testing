# 0.51 全量回归与功能、终端交互对照

日期：2026-10-16，Asia/Shanghai。CCPT 源码、全局安装均为 0.51.0。对照：本机原全局版本 2.1.153；本轮在独立目录安装、实际启动 2.1.301，未替换全局版本。官方版本依据：[2.1.301 发布记录](https://github.com/anthropics/claude-code/releases/tag/v2.1.301)。

## 结论与边界

**不能认定已实现参照产品的每项功能或全部 UI 交互。** 本轮完成现有全量测试、79 个原生命令的静态路由清点、重点终端按键观察及 10 项差距的可执行复现。已有测试通过，不代表新增兼容要求也通过。

- 逐文件隔离：84 个测试文件，423 通过、0 失败。
- 同进程批量：416 通过、7 失败；失败证据保留，不能用隔离重跑覆盖这个事实。
- TypeScript 检查通过。
- 10 项专项行为审计全部复现差距，不是“10 项功能通过”。
- 两个真实 CLI 均进入终端，实际观察信任选择、Skills、Agents、Config、Plan 模式等关键入口。不是全菜单每个分支的逐像素验收。
- 本轮模型调用全部为本地 fixture；未向对照供应商发送模型提示，未连接公司服务，未执行真实 push/PR。此前 GLM 原生 Responses 的真实验证属于上一轮证据，不混成本轮结果。
- 电脑操作技能不允许自动操作终端窗口，因此采用命令行 PTY 和已有 raw-key 集成测试，没有 Windows 桌面点击或截图像素评估。

## 测试结果及复现方式

| 检查 | 结果 | 说明 |
| --- | --- | --- |
| `npm run check` | 通过 | 现有 src/test 的类型检查 |
| `npm run build` | 通过 | CLI / SDK / MCP 三入口；未嵌入公司 CA，未发布 npm 或改全局安装 |
| `bun test ./test` | 416 通过，7 失败 | 同进程状态与 Windows 清理问题，见下文 |
| `bun scripts/regression-isolated.ts` | 423 通过，0 失败 | 每文件独立进程、独立用户状态，不改断言 |
| `bun scripts/audit-parity-20261016.ts` | 10 个差距复现 | 本地模型 fixture，不是功能通过率 |
| 原生命令静态路由 | 79/79 有路由 | 71 个显式 TUI 分支、8 个通用本地 workflow；不是逐命令 E2E 认证 |

本机原始证据：

- `.ccpt/regression-20261016.log`：同进程失败日志。
- `.ccpt/audit-20261016/isolated-regression/summary.json`：逐文件结果，含每文件退出码与日志路径。
- `.ccpt/audit-20261016/parity-findings.json`：专项复现与全部命令清单。
- `.ccpt/audit-20261016/command-audit.md`：79 个命令与静态测试关联。

这些证据目录默认被忽略，不包含在 npm 包中。测试工具已保存到 scripts，便于下次重跑。

### 同进程的 7 项失败不能直接忽略

6 项在 Marketplace / 脚手架 / 插件操作中遇到 `model.apiKeyEnv must be an environment variable name, not a token`。本机实际用户配置确有这个字段填写问题。`test/agent-operation.test.ts` 的 afterAll 无条件删除 CCPT_HOME 和 CCPT_API_KEY，而非恢复原值，后续不自行设定用户目录的测试会回落到真实用户配置。隔离运行后这些测试通过。

另 1 项为 `responses-migration.test.ts` 的 native 后台 worker 测试：清理临时目录发生 EBUSY。单独进程重跑通过，但这不是已经修复 Windows 后台退出/目录释放竞态的证明。

建议：修正所有环境变量恢复、建立每文件 fixture 生命周期；后台完成状态与进程退出分别等待，再采用有界清理重试。新增隔离 runner 只是让回归不读取个人配置，没有修复上述原测试问题。

### 当前主配置的独立阻断

本轮只作脱敏检查：`model.apiKeyEnv` 不是合法变量名，端点仍为 `/api/paas/v4/responses`。真实密钥不记录在本报告。本轮未修改主配置。这个填写问题与产品功能差距分开：它会阻断直接启动，却不证明模型不支持 Responses。

## 可复现的 10 个差距

| 编号 | 优先级 | 实际行为 | 验证/代码位置 |
| --- | --- | --- | --- |
| RULE-01 | P1 | 带 paths 的 rule 在没有匹配文件操作前已进入启动上下文；frontmatter 没被剥离 | `src/context.ts`，fixture 检查实际 repositoryContext |
| RULE-02 | P1 | 用户目录 rules 未加载 | `src/context.ts`，用户 rule 标记未进入上下文 |
| SCOPE-01 | P1 | 用户目录 skills 默认不被发现 | `src/config.ts` / `src/platform.ts`，实际 registry 缺少用户 fixture |
| SCOPE-02 | P1 | 用户目录 agents 默认不被发现 | 同上；当前明确只信任 workspace 范围，修复需要设计信任边界 |
| AGENT-01 | P1 | 子目录任意 Markdown Agent 不递归发现，当前约定只找 AGENT.md | `src/agents.ts`，nested/reviewer.md 无法注册 |
| AGENT-02 | P1 | Markdown 中 permissionMode: plan 被校验拒绝，不能映射为只读 Plan Agent | `src/agents.ts`；已有 runtime Plan 能力不能代替定义字段支持 |
| AGENT-03 | P2 | effort / omitClaudeMd / autoCompactWindow / initialPrompt 被静默丢弃 | `src/agents.ts`，解析结果缺少字段 |
| SKILL-01 | P0（若宣称兼容导入） | disallowed-tools 被忽略，未形成该 Skill 的拒绝工具上限 | `src/skills.ts` / `src/agent.ts`；不能把这种导入当等价安全策略 |
| SKILL-02 | P1 | Skill paths 被忽略，不按文件作用域约束发现/触发 | `src/skills.ts`，解析结构不保留该字段 |
| SKILL-03 | P1 | inline Skill 正文只进入首轮 system，下一普通轮及持久历史均不含正文 | `src/skillInvocation.ts` / `src/agent.ts`，两轮实际本地 HTTP 请求与持久会话比对 |

SKILL-03 与权限生命周期必须分开：正文应能继续作为任务上下文；一次调用的工具授权/限制不应借此永久延长。当前测试验证了工具限制到下一轮会清除，却没有验证正文仍保留。新增复现补充了这一漏项。

参照依据：[Rules / memory](https://code.claude.com/docs/en/memory)、[Skills](https://code.claude.com/docs/en/skills)、[Subagents](https://code.claude.com/docs/en/sub-agents)。文档描述的是外部可见协议与行为，不是读取到对照产品完整内部实现。

## Teams / Plan：已运行与尚未接通的部分

已有 fixture 回归覆盖：独立专家上下文、父权限与工具上限继承、递归深度限制、后台 worker、持久收件箱、广播、shutdown、真实成员管理、只读 Plan、提交后等待人工批准、批准后继续。

但 `src/enhancements/teamOrchestration.ts` 的 planApproved、QualityGate、hypothesis 和 split/grid 仍主要是存储/辅助函数。源码调用检索没有找到 worker 对这些编排状态的统一强制门。不能把保存 planApproved 或调用 evaluateQualityGates 算作后台工作流强制验收。

参照 Teams 的当前文档也说明实验状态及恢复限制；它还存在 lead session 自动授予 teammate plan approval 的设计。CCPT 的人工批准策略不应为追求外观一致而降低为无条件自动批准。见 [Teams 文档](https://code.claude.com/docs/en/agent-teams)。

下一步应实现：持久协议状态 → 明确授权主体 → worker 每次执行前的强制检查 → 幂等结果/失败恢复。不能只加控制面板按钮。

## 本轮真实终端观察

| 入口 / 交互 | 对照 2.1.301 实际观察 | CCPT 0.51 实际观察 | 结论 |
| --- | --- | --- | --- |
| 工作目录信任 | 默认选中 No, exit | 默认选中 Yes, I trust this folder | 安全默认值不同，建议默认拒绝 |
| 欢迎与输入区 | 默认全屏、状态区、快捷提示 | 独立品牌欢迎区、边框输入、状态栏 | 有同类交互，不是像素级一致 |
| `/agents` | 提醒向导已移除，指向定义文件 | Running / Library / History；Library 能显示 fixture Agent | 版本语义不同；CCPT 管理器可以保留，但应明确定位 |
| `/skills` | 显示 locked by author / user-only；提示 Enter/Space cycle | 显示 on、inline / slash enabled；Enter save | 作者限制提示与 Enter 语义不一致；底层 manual 限制仍存在 |
| `/config` | 搜索先获焦；Esc 从搜索转列表；列表 Enter/Space change | 搜索先获焦；Esc 转列表；Space change、Enter save | 搜索路径近似，修改/保存契约不同 |
| Plan 快捷键 | 实际按 Shift+Tab：auto → manual → accept edits → plan | `/plan` 进入会话 Plan；已有按键测试验证其模式循环 | 不引入自动审批分类器是安全取舍，不是简单漏一个标签 |
| `/teams` | 本轮未启动真实队友；仅核对官方语义 | 空列表管理器可开；后台成员/Tasks/Inbox 由集成测试覆盖 | 不声称两边真实多模型团队行为已全对齐 |
| Skills 配置落盘 | 官方文档为 settings.local.json | `patchProjectSettings` 写 workspace settings.json | UI 个人偏好可能进入共享项目配置，需明确作用域 |

Config 观察中对照还包含动态 workflow、模型自动切换等设置；没有把 CCPT 同名菜单或 helper 文件判定为这些能力已完成。跨终端尺寸、滚动、输入法、无障碍、长 Markdown/diff 和多窗口仍需专项矩阵。

交互依据：[官方终端交互说明](https://code.claude.com/docs/en/interactive-mode)。上表实际观察和文档补充已分别标注。

## 原 25 项 US 的当前验收定位

表中的“本地验证”不等于公司生产验收；完整证据仍需结合每个测试文件与剩余清单。

| AC | 范围 | 本轮/已有可验证部分 | 仍缺或未实测 |
| --- | --- | --- | --- |
| 1 | 大仓 / 长上下文 | 90% 提醒、>95% 压缩、溢出恢复的本地测试 | 真 tokenizer、多模态精确计数、1M/大仓基准 |
| 2 | 多 Agent | 专家调用、隔离上下文、父子权限测试 | 定义兼容与作用域差距见 AGENT/SCOPE |
| 3 | 后台执行 | detached worker、状态、停止、继续测试 | 崩溃/断电矩阵与 Windows 清理竞态 |
| 4 | Worktree | 创建、提交、合并、脏修改检查点测试 | 跨 worktree 冲突向导与故障恢复 |
| 5 | Git 工作流 | 本地 commit/merge、push/PR 权限控制 | 未执行公司真实 push/PR |
| 6 | 编排 | Plan/任务依赖、workflow helper | 统一强制门、真实大型交付演练 |
| 7 | 嵌套限制 | 深度、并发、会话计数与父能力继承测试 | 压力与资源耗尽矩阵 |
| 8 | 持久记忆 | scope、保护、检索、落盘测试 | 大规模质量与跨终端使用体验 |
| 9 | Skills | inline/fork、四态、参数、工具限制测试 | 10 项审计中的 Skill 缺项 |
| 10 | 插件 | 本地插件加载、签名、锁定、回滚测试 | 真实团队互操作、供应链运营与许可授权 |
| 11 | MCP | stdio/HTTP、OAuth PKCE 等 fixture | 公司服务器、真实身份与全认证矩阵 |
| 12 | 双向 MCP | GET SSE、通知、重连与暂停测试 | 长期运行、sampling/elicitation 完整人工授权 |
| 13 | Hooks | matcher、事件、阻断/失败、prompt hook 本地测试 | 全事件 payload/退出码逐项等价 |
| 14 | Worktree Hooks | 生命周期/清理相关实现及测试 | 企业环境安装、失败回滚、资源泄漏实测 |
| 15 | OS 沙箱 | 最小权限、保护路径、wrapper 合约 | OS 级隔离及逃逸测试仍未完成 |
| 16 | restricted | 命令/网络/文件/工具策略测试 | 不等同 OS 沙箱；恶意仓库全矩阵 |
| 17 | 权限 | deny/ask/allow、一次/会话审批、Plan 继承 | 全终端/多窗口并发审批；不复制 AI 自动授权 |
| 18 | 托管配置 | 配置覆盖与只读策略测试 | Registry/plist/MDM 真机分发 |
| 19 | 企业网络 | CA/代理/mTLS 等本地网络测试 | 公司 Azure、Entra 续期和 worker 真机 |
| 20 | 进程控制 | wrapper、取消、进程树相关测试 | 全平台所有进程路径的强制执行矩阵 |
| 21 | VS Code | 扩展安装包、事件桥/流式测试 | Remote、多窗口、断线、升级实际 IDE 验收 |
| 22 | Focus View | 基础过滤与 UI 实现 | 结果质量、长输出与逐交互人工验收 |
| 23 | Fork | 独立会话与继续主会话测试 | 全嵌套/后台/跨协议组合 |
| 24 | Resume | 恢复、分叉、busy/目录边界测试 | 超大历史性能、崩溃恢复 |
| 25 | 长任务 | 恢复、预算等待、压缩后继续 | 小时级真实交付与企业环境稳定性 |

## 建议的修复顺序

1. **P0：导入安全契约与启动阻断。** 不支持的限制字段不能静默忽略；修正实际用户字段但不记录密钥。许可/NOTICE/重分发授权独立处理，UNLICENSED 不等于获授权。
2. **P1：Rules 与 Skill 生命周期。** 有界路径匹配、frontmatter 解析、按文件工具触发、来源标记；Skill 正文持久化与当轮工具能力分离。
3. **P1：定义发现和规范化。** 用户级内容需明确信任入口，不能直接放宽当前 workspace 边界；递归发现和稳定优先级；Agent Plan 映射及未知字段诊断。
4. **P1：Teams worker 协议。** 将已有状态 helper 接到执行门与可恢复事件；审批不能由非授权队友声明代替。
5. **P2：UI 契约与新功能。** Skill 锁定标签、Enter/Space/Esc、个人偏好 local 文件、Plan 审批卡片、后台树与队友切换；再做完整终端尺寸与 IDE 矩阵。
6. **测试基础设施。** 修复同进程状态恢复和 Windows 清理，扩大每个 slash 分支的直接按键测试；不能把“有路由”换算成完成率。

本轮新增的是回归/审计工具与报告，没有修改上述产品运行时缺陷，不把发现问题说成已经修复。
