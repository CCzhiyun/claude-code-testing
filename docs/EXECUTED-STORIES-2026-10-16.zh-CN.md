# 文档 → User Story → 双端终端 → 边界验收：执行记录

历史记录说明：下文保留首轮 322/333、11 项失败的观察，不代表后续修复状态。后续结果见 `OFFICIAL-ALIGNMENT-FIXES-2026-10-16.zh-CN.md`。早期 `boundary-results.*` 是可复跑产物、曾被第一次修复回归更新；初始计数仍保留于 `execution-summary.json` 和本报告失败表。后续边界结果已改存独立的 `.ccpt/story-fixes-20261016/evidence/`，不再覆盖首轮操作轨迹。

日期：2026-10-16。参照 CLI **2.1.301**，CCPT **0.51.0**。本轮末尾 `npm view` 返回的参照版本仍为 2.1.301；没有升级用户全局安装，也没有改用户真实模型 URL、密钥或设置。

结论：完成了第一批有真实操作证据的故事验收，**不能认定整个平台已完全对齐**。本轮新增的是验收规范、测试夹具、边界执行器和报告，未改产品运行时实现；以下失败仍待修复。

## 1. 先定义故事，再执行

先阅读官方文档并写入 [User Stories](./USER-STORIES-INTERACTION-PARITY-2026-10-16.zh-CN.md)，随后在同一合成工作区启动两个真实 CLI。依据电脑操作技能的终端限制，使用 PTY 真实按键，不通过桌面 UI 自动点击终端，也不把函数单测冒充鼠标/像素验收。

文档来源：

- [Skills](https://code.claude.com/docs/en/skills)：发现、调用限制、四态可见性、参数、inline/fork 及正文/权限的不同生命周期。
- [Subagents](https://code.claude.com/docs/en/sub-agents)：定义、Plan 权限、委派与配置来源。
- [Agent teams](https://code.claude.com/docs/en/agent-teams)：实验性团队、共享任务与协作边界。
- [Memory / Rules](https://code.claude.com/docs/en/memory)：规则作用域与按路径加载。
- [Interactive mode](https://code.claude.com/docs/en/interactive-mode)、[Permission modes](https://code.claude.com/docs/en/permission-modes)：终端操作和权限语义。

与参照不完全相同但可能合理的产品设计，标记为差异，不自动判作 bug。Skills 的 `disallowed-tools` / `paths` 不是这里核实的官方 Skill 字段：相关用例属于 CCPT 企业加固目标，不是已经证明的原生兼容缺口。

## 2. 测试条件与证据

- 真实 PTY 操作/观察 **99 步**：参照 48、CCPT 51。步数不是功能数，也不是 99 个独立验收通过。
- 两边各发现 19 个镜像 Skill 定义，包含手动、模型专用、关闭、fork 与多页列表。
- 仅合成代码文件与本地模型服务；24 条模型 HTTP 请求，其中包含参照的会话标题辅助请求，不把辅助请求误计为用户 Agent 回合。
- 参照走原生 Messages，CCPT 走原生 Responses。验证的是客户端 UI、控制流和各自工具协议映射，不证明真实模型自主行为相同，也不证明公司 Azure 可用。
- 普通菜单、可见性管理、禁止用户调用/关闭 Skill 的负向尝试未增加模型请求；请求索引保留了可核对的顺序。
- 本地服务观察到两次客户端断开：参照请求 #20（Esc）、CCPT 请求 #23（Ctrl+C）。

证据文件位于 `.ccpt/story-20261016/evidence/`：

- `pty-steps.json`：逐步输入、操作说明、工具返回的 ANSI 输出片段与退出状态。
- `pty-step-index.md`：99 步可读索引。
- `model-requests.ndjson` / `request-index.md`：合成模型请求及正文、规则、工具结果标记。
- `stream-cancels.ndjson`：服务端实际观察到的流取消。
- `boundary-results.json` / `.md`：333 条逐项预期和结果。
- `execution-summary.json`：从以上文件派生的汇总。

注意：终端工具会截断高频重绘输出，因此保存的是返回片段，不声称完整终端录屏或逐像素一致。

## 3. 双端逐步故事结果

| 故事/操作 | 参照实际 | CCPT 实际 | 判断 |
| --- | --- | --- | --- |
| 启动未信任目录 | 默认 No, exit | 默认 Yes | 安全默认值不同；仅确认了自建夹具 |
| `/skills` 发现 | 19 个，展示来源、token 估算与锁定 | 19 个，展示来源与 token 估算 | 发现数量一致，显示语义不同 |
| 中文零匹配、大小写筛选、Esc 清空 | 正常 | 正常 | 此路径通过 |
| 列表 End 到末项 | story-page-13 可见 | 同一末项可见 | 此路径通过 |
| 可见性 Space 切换、Esc 保存、重开 | name-only 保留 | name-only 保留 | 有效行为一致；保存作用域不同 |
| 保存文件 | `.claude/settings.local.json` | `.ccpt/settings.json` | CCPT 的个人交互偏好可能写入团队共享配置 |
| 作者禁止自动调用 | 显示 locked by author / user-only，Space 无变化 | 显示 on，可改为 name-only | CCPT 显示误导；策略矩阵证明作者限制仍不被放宽 |
| Enter 的语义 | Skills 行上切换 | 行上保存退出 | 交互差异，不能声称按键等价 |
| 禁止用户调用 / 关闭 Skill | 给出原因与重新启用方法 | Unknown command | 均未调用模型，但 CCPT 诊断欠缺 |
| 手动 Skill 参数 | 请求包含展开后的中文/emoji 参数 | 同样包含 | 此输入通过，不代表所有引号语法都验证 |
| inline 下一轮正文 | #2、#5 均含正文 | #1 含正文，#3 不含 | CCPT 正文跨轮丢失；权限当轮结束是另一个问题 |
| `/agents` | 提示旧向导已移除，转编辑定义文件 | Running / Library / History | 最新版真实设计差异，不照旧截图造向导 |
| `permissionMode: plan` 定义 | 请求中可见 story-planner 配置 | Library 只有 story-reviewer，planner 被解析器拒绝 | CCPT 定义兼容缺口 |
| fork Skill | 后台 @story-fork，任务完成并返回主对话 | 独立子 Agent/session，完成后 Returned to lead | 两边真实子代理控制流通过；调度体验不同 |
| 团队/任务查看 | `/tasks` 展示后台已完成 fork | `/teams` Members/Tasks/Inbox 可切换，含 lead 与子代理 | 两边路径已观察；不等于完整多人 Teams 互操作验收 |
| Plan 切换与运行 | Shift+Tab 手动→accept edits→plan | `/plan` 可启用并只读调用工具、保存待审批记录 | CCPT 的 Shift+Tab 本轮未改变状态，待进一步定位 |
| Plan 修改意见 | 未执行同构审批流程 | `/plan changes <id>` 进入 changes_requested 并保存意见 | CCPT 实际通过；参照批准/修改闭环仍 not-run |
| Rules 非匹配文件 | #12/#13 读 UI 文件不含 API 规则 | 首请求起就包含 API 规则 | CCPT 错误提前加载 |
| Rules 匹配文件 | #14 读 API，#15 回传结果后才含规则，UI 显示 Loaded | 已无条件加载 | 延迟加载差异已由双端实际工具链确认 |
| Read→结果回传→最终回答 | #12/#13、#14/#15 完成 | #6/#7、#10/#11 完成 | 原生各自协议的该工具闭环通过 |
| 慢流取消与继续 | Esc 中断 #20，#21 在原会话继续 | Esc 两次无效；Ctrl+C 中断 #23，#24 在原会话继续 | Esc 回归失败，Ctrl+C 和会话保留通过 |
| Config 中文零匹配、Esc 分层 | 清空→回列表→退出 | 清空→回列表→退出 | 此焦点链通过；行上 Enter/Space 仍不同 |
| 退出 | 正常退出并打印原会话恢复 ID | 正常退出，历史保留 | 未留下运行中的测试 CLI |

## 4. 新增边界集：333 项，322 通过 / 11 失败

这些是参数化验收用例，不是 333 个产品功能。明确保留失败，执行器遇到失败返回退出码 1。

覆盖：0/1/多参数、缺失占位、单双引号与空引号、中文/emoji/组合字符、63/64/65/1000 参数、10K/100K 长参数、shell 字符只作数据；作者限制与四态可见性的组合、同源别名最严格策略、非法工具名；64/65 字符定义名、布尔字段类型、空正文、损坏元数据；0/1/2/19/100 项列表导航、0/1/8/20/40/80 列、1/5/10/24 行；真实 readline 按键；maxTurns 与父子权限 25 种组合；Plan 全部 10×10 状态对、并发旧版本审批、空计划与已批准计划修改；团队身份、跨团队消息、Agent 冒充授权、100000/100001 长消息、未读确认、活动成员清理、shutdown/恢复；持久记忆 24999/25000/25001 字节与路径越界。

| 失败 ID | 实际问题 | 类型/修复优先级 |
| --- | --- | --- |
| YAML-unterminated-fail-closed | 未闭合 header 当普通正文加载，作者限制不生效 | CCPT 解析安全加固，高 |
| YAML-duplicate-security-key | 同名限制字段后写覆盖前写，无诊断 | CCPT 解析安全加固，高 |
| YAML-quoted-comma-list | `['a,b', 'c']` 等价输入被错误拆分 | YAML 解析正确性，中 |
| SK-unsupported-disallowed-tools | 看似安全限制的非支持字段被静默丢弃 | CCPT 诊断加固，中；不冒充参照支持 |
| SK-unsupported-paths | 同上；正式 paths 范围语义在 Rules | CCPT 诊断加固，中 |
| UI-search-grapheme-backspace | 👩‍💻 退格留下半个组合 emoji | UI 正确性，中 |
| UI-RAW-escape | readline 的 Esc 带 meta:true，默认 matcher 返回 none | 原始按键回归，高 |
| AG-plan-mode | 合法参照 Plan 定义被拒绝 | 兼容缺口，高 |
| AG-recursive-md | 分类子目录下 reviewer.md 未发现 | 兼容缺口，中 |
| SK-inline-body-next-turn | 首轮正文不进入下一轮/持久历史 | 会话质量兼容缺口，高 |
| RL-scoped-before-read | 未读匹配文件就注入 paths 规则 | 规则作用域兼容缺口，高 |

Esc 根因有独立最小复现：Node 20 与 Bun 的 readline 都为单独 `\u001b` 产生 `{name:'escape', meta:true}`；`matchesKeystroke` 严格比较默认绑定的 meta:false，因而未匹配。组件直接检查 `name === 'escape'` 的菜单仍能退出，所以会出现“菜单 Esc 正常、主对话 Esc 不中断”的现象。Shift+Tab 的纯 resolver 用例通过，但实际 Windows PTY 未改变模式：保留为未定位的集成差异，不能用单测通过覆盖观察结果。

## 5. 现有回归与构建

- 本轮重新运行现有 84 个测试文件：独立进程/独立用户状态 **423 pass / 0 fail**。详见 `.ccpt/audit-20261016/isolated-regression/summary.json`。
- `npm run check` 通过；`npm run build` 通过，391 modules；未嵌入公司 CA。
- 本轮没有改旧断言来忽略失败。例如旧 Skill 测试本就断言下一轮 system 不含正文，不能据此证明正文存在于 conversation；新契约验证的是完整下一轮请求与持久化。
- 上一轮同进程测试的 7 项失败仍保留在旧日志，隔离回归不等于已修复环境清理污染/EBUSY 根因。参见 [全量回归报告](./REGRESSION-PARITY-2026-10-16.zh-CN.md)。

## 6. 可复跑命令

在源码目录使用 Bun；无需生产 key：

```powershell
cd C:\Users\55038\CCPT
bun scripts/story-boundaries-20261016.ts
bun scripts/regression-isolated.ts
npm run check
npm run build
```

第一条预期当前退出码为 1，并生成逐项失败清单；不是安装或模型连接错误。

双端 UI 的服务脚本是 `scripts/story-fixture-server.ts`。首次运行会创建/重置**专用测试 fixture 的**镜像定义与 home；不要指向真实用户 home。服务打印随机本地 endpoint，随后用隔离 `CLAUDE_CONFIG_DIR` / `CCPT_HOME` 启动两端并按 `pty-step-index.md` 重放。再次绑定同一端口时传入端口参数以保留 home 确认状态/请求编号。本轮修复过测试夹具的 system 元数据/邮箱通知识别；修正前未触发 Read 的请求不算工具验收。一次夹具重启误重置了参照测试 home，产生 Not logged in，已重新确认虚拟 key 并用原 session ID 恢复重跑；这不是公司认证故障证据。

`bun scripts/story-evidence-summary-20261016.ts` 可从已有证据重建请求/步骤索引。

## 7. 下一批验收和未测项

优先用上面的失败用例驱动修复：Esc → 解析器明确失败 → Skill 正文持久化/权限分离 → Rules 按文件懒加载 → Plan Agent 定义 → UI 来源/锁定/诊断。

仍未完成的双端端到端项：完整多人 Teams 创建/广播/计划门/崩溃恢复；并发 N/N+1、委派深度 D/D+1 的真实后台压力；参照完整 Plan 审批/修改闭环；工作树冲突及断电恢复；所有命令全部键位分支；真实技能插件团队互操作；1M/多模态 tokenizer 基准；OS 逃逸与企业凭据/网络/CA/mTLS/Entra 真机矩阵；真实 push/PR、账号/云端/移动/语音服务。没有用本地模拟服务器或静态菜单统计宣布这些完成。

本轮退出两端并停止自己的本地服务，保留合成文件、会话和审计证据供下一轮重放。未触及生产代码仓库的 Git 操作，也未发送任何项目源码给真实模型。
