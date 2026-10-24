# 0.50：最新版交互核对与取舍

2026-10-06：用户全局参照版本仍是 2.1.153；本次另在独立目录下载并启动 **2.1.289** 原生 Windows 终端二进制，核对本地菜单后退出，没有修改用户全局版本，没有发送模型请求或访问公司端点。最新版依据 npm registry 与[官方 2.1.289 发布记录](https://github.com/anthropics/claude-code/releases/tag/v2.1.289)。

终端直接观察：`/skills` 空列表显示文件目录；`/agents` 提示创建向导已移除，转向定义文件；Shift+Tab 可切换其自动/手动/acceptEdits/Plan 模式。没有据此声称验证模型端自动委派或全部团队行为。定义语义另核对[Skills 文档](https://code.claude.com/docs/en/skills)、[Subagents 文档](https://code.claude.com/docs/en/sub-agents)、[Teams 文档](https://code.claude.com/docs/en/agent-teams)和[交互文档](https://code.claude.com/docs/en/interactive-mode)。

| 重点 | CCPT 原有差距 | 0.50 已接到实际运行的改进 |
| --- | --- | --- |
| Slash Skill | 容易变成新会话，丢当前语境 | inline 保留当前 Agent/Session；fork 创建独立专家并返回主界面 |
| Skills 管理 | 旧三态与菜单可见性混用 | 四态可见性，Space 循环、Esc 保存，前置定义限制不能被配置放宽 |
| Skill 参数 | 参数占位支持不足 | 全参数与零基序号替换、argument-hint、顶层 YAML 字符串列表 |
| Agent 定义 | JSON/Markdown 校验不统一 | 共享校验、model inherit、专属 memory、轮数上限 |
| 子代理权限 | 专家配置可能放宽父代理 | 父工具上限、父 Plan、权限模式继承，多个上限取交集 |
| Plan | 模型提交后可能自动退出只读 | 保存 pending_approval 并暂停，人工批准后继续，完整工具边界保存 |
| 团队 | 框架元数据与实际成员组易错位 | root Session 绑定、Members/Tasks/Inbox、后台 spawn、广播、实际停止/恢复 |
| 清理 | 把 team ID 当 session ID 可能漏检活跃成员 | 检查真实运行组；只清登记，保留代码/对话/worktree |

CCPT 不启用参照的 AI 自动批准分类器，不复制账号/订阅/云服务品牌能力，不声称像素级或 wire-event 完全等价。Skill 的 allowed-tools 只收紧能力，不自动免除审批；不执行 `!` 动态 shell 插值。新增团队功能不代表现有假设竞争、质量门、自动计划审批等编排辅助模块已经全部和后台 worker 强制执行链路绑定。生产缺项继续公开记录。

本次对比没有读写其他产品的账户凭据；独立安装仅用于本机核对，不包含在 CCPT 的 npm 发行文件内。
