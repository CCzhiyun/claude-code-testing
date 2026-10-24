# 功能及终端交互对照：User Stories 与验收契约

日期：2026-10-16。目标：先定义可观察契约，再以相同 fixture、输入和按键驱动参照 CLI 与 CCPT。基准固定为本机可运行的参照 2.1.301 与 CCPT 0.51.0，不把历史 2.1.153 的 UI 当作最新版契约。

## 验收证据分层

1. `documented`：官方文档要求，尚未实际执行。
2. `reference-observed`：参照真实二进制/终端的实测，不等于 CCPT 通过。
3. `ccpt-observed`：CCPT 真实终端/运行时结果。
4. `equivalent` / `different`：两边同一步骤已有证据后，才下对照结论。
5. `boundary-tested`：记录输入规模、预期、实际、耗时/异常；单独标出本地 fixture 与真实供应商。
6. `not-run` / `blocked`：保留未测项及理由，不能按“有菜单/有源码”算通过。

本地模型 fixture 只证明客户端控制流、会话/工具协议与 UI，不证明真实模型会自主做出相同行为。公司认证、真实供应商、账户服务、Git push/PR、OS 沙箱另设验收，绝不借遍历菜单执行生产写操作。终端通过 PTY 按键驱动，不使用桌面鼠标点击。

## US-SK-01：发现、筛选与管理 Skills

作为团队开发者，我希望能发现个人、项目和插件提供的 Skills，并在终端搜索、查看及管理其可见性，使配置来源和作者限制清晰且可复现。

验收：

- Given 项目存在有效 SKILL.md，When 打开 `/skills`，Then 展示名称、来源、说明和有效调用限制。
- Given 作者设置禁止模型自动调用，When 用户尝试切换可见性，Then 不得放宽作者限制，且 UI 应明确显示 user-only/作者锁定，而非仅显示普通 on。
- Given 列表有 0、1、多页数量，When 搜索、导航、查看、退出及重开，Then 空状态明确、选择始终可见，持久化行为和文案一致。
- Given 同名定义、无效 Markdown/YAML 或缺失文件，When 刷新，Then 有确定的优先级或诊断，不得无声覆盖/崩溃。

边界集：空列表、唯一项、0 命中、全命中、大小写、中文/emoji、长描述、长路径、首尾导航、超出可视行、作者锁定、插件锁定、四态循环、Esc 各焦点层级、重启后持久化。

来源：[Skills 文档](https://code.claude.com/docs/en/skills)。

## US-SK-02：Skill 调用、正文与权限生命周期

作为开发者，我希望显式调用 Skill 能携带参数、保持当前对话或明确 fork，同时其正文约定持续有效，而当轮工具权限不会永久延长。

验收：

- Given 普通问候，When 提交，Then 不强制触发工程 Skill，也不猜测不存在的名称。
- Given 手动 Skill，When `/skill-name <args>`，Then 只在明确调用时加载其正文，正确替换参数。
- Given inline Skill 已调用，When 下一轮普通问题，Then 相关正文仍可作为对话上下文；原始当轮工具权限/限制生命周期单独验证。
- Given fork Skill，When 调用与返回，Then 主会话身份/历史保留，独立上下文、角色和权限按定义执行。
- Given 定义包含看起来影响安全的非受支持字段，When 加载，Then CCPT 的企业加固目标是明确诊断，不让作者误以为限制已生效。特别注意：Skills 的 disallowed-tools / paths 不在本轮核实的官方 Skill 字段契约中；不能把它们误写成参照原生支持的功能，paths 的正式范围契约属于 Rules。

边界集：0/1/多参数、引号、空字符串、$0/$1/$ARGUMENTS[n]、缺失参数、重复占位、64/65 个参数、64/65 字符参数名、中文/组合字符/emoji、10K/100K 参数、特殊 shell 字符不执行、未知 Skill、关闭/手动/模型独享、多个 Skill 能力交集、恢复/压缩后的正文与权限。

来源：[Skills 文档](https://code.claude.com/docs/en/skills)。

## US-AG-01：可复用 Agent 定义与安全委派

作为 Tech Lead，我希望个人、项目、插件和临时 Agent 定义有明确来源与优先级，支持只读规划、专属记忆和后台运行，并受父权限及资源限制约束。

验收：

- Given 定义文件与子目录，When 加载/刷新，Then 有效定义可发现，无效/同名/不支持字段得到明确处理。
- Given permissionMode: plan，When 运行，Then 只读规划语义有效，而不是直接拒绝该定义或允许修改。
- Given 后台、maxTurns、深度和并发限制，When 触及边界，Then 状态、部分结果和恢复方式明确，不无限生成后代。
- Given 父 Agent 已受限，When 子代理请求更宽工具或权限，Then 不得获得更高权限。

边界集：空目录、0/1/嵌套定义、损坏 JSON/YAML、缺少必填、未知字段、同名、model inherit、maxTurns -1/0/1/上限/非整数、并发 N/N+1、深度 D/D+1、取消/重复取消/完成后取消、身份和项目越界。

来源：[Subagents 文档](https://code.claude.com/docs/en/sub-agents)。最新版 `/agents` 的实际交互以运行记录为准，不预设存在旧版创建向导。

## US-TM-01：团队协作、消息与恢复

作为负责人，我希望能管理真实队友、共享任务和消息，明确区分空闲、运行、等待输入、失败与结束，并安全停止或恢复工作。

验收：

- Given 无队伍/有队伍，When 打开管理入口，Then 展示准确空状态或成员/任务/收件箱。
- Given 消息或广播，When 发送/读取/重试，Then 只有落盘成功才能报告发送，未读语义一致，外部 Agent 消息不视为人工授权。
- Given 待审批计划或质量门，When worker 即将执行，Then 强制检查有效状态，不能仅保存一个 planApproved 标签。
- Given 活跃成员，When 清理团队，Then 不误删代码、会话和 worktree；拒绝不安全清理。

边界集：空成员、1/多成员、重复创建、未知 ID、跨项目/跨团队、重复消息、长消息、无未读/重复已读、活动/等待/完成状态清理、空闲 shutdown、运行中 shutdown、终止后恢复、断开/重连。真实 split-pane/tmux、断电与公司环境未执行时必须标 not-run。

来源：[Teams 文档](https://code.claude.com/docs/en/agent-teams)。对照的自动计划批准不自动成为 CCPT 的安全要求；保留人工审批属于明确的策略差异。

## US-PL-01：只读规划、审批与继续实现

作为工程师，我希望可以进入 Plan 模式，调查后查看计划并明确批准或修改，再在原上下文继续实现，避免代理自行提升权限。

验收：

- Given 空闲会话，When 通过命令/快捷键切换模式，Then 状态栏、有效工具和实际执行模式一致。
- Given 计划提交，When 模型请求退出 Plan，Then 持久化 pending approval 并暂停；未经授权不能修改代码或派子代理绕过。
- Given 拒绝、修改要求或批准，When 再继续，Then 状态迁移合法、完整工具结果配对、旧上下文可追溯。

边界集：无计划、空计划、重复提交、过期版本、非所有者批准、重复批准、已拒绝/取消计划执行、并发批准、恢复后继续、关闭终端后保留、托管策略不可放宽、子代理继承 Plan。

来源：[交互文档](https://code.claude.com/docs/en/interactive-mode)、[权限模式](https://code.claude.com/docs/en/permission-modes)、[Subagents](https://code.claude.com/docs/en/sub-agents)。

## US-RL-01：有来源、按范围生效的工程规则

作为团队成员，我希望全局及项目规则按文件范围加载，并明确哪些规则正在生效，使大仓库规则不混淆、不泄露或跨项目污染。

验收：

- Given 无 paths 规则，When 开始会话，Then 按合法作用域加载。
- Given 有 paths 规则，When 尚未访问匹配文件，Then 不应无条件注入；匹配文件操作后再生效。
- Given frontmatter、递归目录、重名、符号链接及外部引用，When 加载，Then 去掉元数据并执行来源/路径/信任边界。

边界集：0/1/多规则、匹配/不匹配、Windows 路径分隔符、大小写、根文件、深目录、brace glob、非法 glob、空 paths、循环链接、外部链接、超长文件、规则数量上限、被保护凭据路径、跨 worktree。

来源：[Memory / Rules 文档](https://code.claude.com/docs/en/memory)。

## US-UI-01：可预测的终端键盘契约

作为开发者，我希望搜索、选择、切换、保存、取消、恢复和退出具有一致且清楚的按键语义，且本地浏览菜单不额外发起模型请求。

验收：

- Given 未信任目录，When 启动，Then 默认选择及确认行为被实测记录；CCPT 的安全取舍不伪装成参照相同。
- Given picker/search/detail，When Enter/Space/Esc/Tab/方向键，Then 文案、焦点、选中项、持久化与有效运行行为一致。
- Given 长列表、窄终端、Unicode 输入，When 编辑/滚动/重开，Then 不拆分字符、不丢草稿、不误选、不隐藏当前项。
- Given `/resume`、`/branch`、`/compact` 等会话动作，When 执行，Then 恢复/分叉本身不自行开始新任务，压缩不中断原会话。

边界集：空输入、只输 /、未知命令、精确/模糊搜索、0/1/N 项、Home/End/PageUp/PageDown、Esc 分层、Ctrl+C、双字节/组合字符/emoji、贴入、多行、80/40 列、24/10 行、长文本、退出时进行中任务。

来源：[交互文档](https://code.claude.com/docs/en/interactive-mode)。不宣称账号订阅、云端、移动端、语音等未运行功能已验收。

## 执行顺序与完成判据

先执行 Skills 发现/锁定/搜索/切换/正文生命周期的双端按键故事，再执行 Agent、Plan、Teams、Rules 和通用会话路径。每步记录 case ID、fixture、输入/按键、预期、参照实际、CCPT 实际、请求次数/写盘差异和结论。可在纯本地 fixture 下重复的边界进入自动化测试；真实供应商与企业环境单独标识。

这份文件是验收规范，不是通过声明。逐步执行记录与边界测试产物另存；任何 not-run 项都不算完成。

## 补充：本轮从真实按键发现的回归条件

- 原始 Esc 必须经 readline 解析后仍能匹配中断；不能用手工构造的 `{ name: 'escape', meta: false }` 代替实际按键。
- 搜索退格以 grapheme 为单位，覆盖组合字符与 ZWJ emoji，不只验证一个 Unicode code point。
- 未闭合 frontmatter、重复限制字段与带引号逗号列表纳入企业解析器加固测试。它们是显式加固要求，不冒充已经在参照二进制逐项验证过的行为。
- 两个产品启动策略、默认确认项、作者锁定显示、保存文件作用域及禁用 Skill 的错误文案均记录为可比较结果，不以“有菜单”作为等价证明。
