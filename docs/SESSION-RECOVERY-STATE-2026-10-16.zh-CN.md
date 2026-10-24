# CCPT 会话恢复第二批：后台连接、状态与安全（2026-10-16）

本报告接续 `SESSION-RECOVERY-ENHANCEMENTS-2026-10-16.zh-CN.md`。行为参照 [官方会话说明](https://code.claude.com/docs/en/sessions)，不声明所有产品功能已经完成。

## 已实现

### 接回原 Agent，不只是读回文本

- `/resume` 优先选择会话原有 Agent；运行中或待输入的 owner 优先于较新的已结束记录。
- 拒绝两个活跃 owner、会话/Agent 目录不一致等不明确状态，避免任意选择一个写入者。
- 同目录的运行中 worker 可以在 TUI 内连接并观察，完成后继续使用同一个 Agent 和会话；连接本身不发送模型请求、不启动第二个 worker。
- 原有待审批/待回答对话会重新显示对应面板；从选择器选择时不会再把新出现的审批面板清掉。
- `ccpt attach <agent-id>` 在交互终端进入会话，在重定向/管道环境保留只读输出行为。
- `--resume <id-or-name>` 的运行中接管仅在交互终端且没有会话覆盖参数时启用。带 `--model`、`--settings`、权限或工具等覆盖层时拒绝接管正在运行的 worker，而不是修改其配置。
- 现有前台任务仍需先 Ctrl+B 再切换；不是自动后台化的完整 Agent View 复刻。

### 恢复身份和能力边界

- 会话记录增加版本化 `resume` 元数据：角色、模型名称、effort、Plan 标志、工具允许/禁止列表和 profile 名称。
- 不保存 API Key、认证 Header、服务 URL、CA 内容、绕过权限模式或新的授权。
- 恢复原 Agent 保留其角色、待审批 Plan 和长期工具上限。分叉携带角色/能力/Plan 的只读约束，但不继承原 Plan 的审批 ID 或执行授权。
- 新 Agent 从会话恢复时应用原能力上限与当前 profile 的交集；禁止工具列表不会因 profile 修改而消失。
- 已知 profile 缺失时明确失败，不静默回退到工具更广的默认 Lead。
- TUI 恢复已保存的模型名称和 effort；显式 CLI `--model` / `--effort` 和管理员模型字段优先。API URL/认证始终来自当前配置，切换部署时应显式指定对应部署名。
- 推理开关单独保存和恢复，不会因为恢复了 effort 就自动改变 Chat 请求是否携带推理参数。
- worker 启动时重新叠加当前管理员配置，避免旧 runtime 快照冻结管理员策略；profile 模型不能覆盖管理员指定模型，工作区上限也不会因恢复而自行放大。这不是对运行中每个请求实时刷新全部策略的承诺。
- print 恢复会话时保留角色和能力约束；其模型仍以本次配置为准，不声称已实现参照实现的所有恢复优先级。
- 旧版记录没有保存的 profile/历史分支信息无法凭空还原。

### Git 会话筛选

- 新会话保存 Git common-dir、worktree 和当时的分支；只读查询有超时、输出上限，不运行仓库 Hooks，也不依赖网络。
- `/resume` 的 Ctrl+W 切换当前 worktree/同仓库所有 worktree；Ctrl+B 筛选当前分支；Ctrl+A 扩大到所有项目。
- Detached HEAD、非 Git 目录、Git 不可用时明确降级。
- 为旧会话补查仓库身份时只在视图内使用、有目录数量和并发上限，不把当前分支伪装成历史分支。
- 选择其他目录时显示经过单引号转义的 PowerShell 启动命令，保留当前会话，不自动改变 cwd、执行命令或授信。完整的同仓库跨 worktree 原地切换仍未实现。

### 并发和中断恢复

- `continueAgent` 在跨进程预约锁下检查状态、并发配额和持久化下一轮，防止两个恢复请求同时开始同一 Agent。
- `spawnAgent` 不允许给已有活跃会话启动第二个 Agent；在锁内重新读取历史，避免用旧快照覆盖刚完成的消息。
- 对缺失结果的历史工具调用补入 `is_error` 记录，明确说明结果 UNKNOWN，要求先核实文件、进程或外部状态。
- 此修复只补协议记录，不执行、不重放、不认定原操作一定失败；重复恢复不会反复补同一结果。
- 后台化时不把尚未发送的排队提示移交给另一会话；提示保留在终端上并说明需要重新输入。
- 后台观察不重复制造 Plan 审批记录，也不会自动批准待审批动作。
- 资源详情页明确显示滚动/返回列表提示，避免把详情页和列表页的通用页脚误当成同一交互状态。

## 验证

新增测试：

- `test/session-recovery-state.test.ts`：owner 冲突、工作区边界、真实 Git/worktree、历史分支、profile 消失、Plan/工具上限、崩溃记录修复和并发续聊。
- `test/terminal-background-resume.test.ts`：真实分离 worker + 本地模拟模型 + 实际 CLI 入口/原始按键，验证连接零额外请求、原 Agent 续聊和待审批面板恢复。

定向测试已通过；全量日志与汇总位于 `.ccpt/session-recovery-20261016/`。这些是隔离本机测试，不是公司 Azure/CA/代理/mTLS/Entra 或全部终端的实机验收。

全量复测结果：**445 通过 / 0 失败**，88 个测试文件，耗时约 177 秒（`final-regression.json`）。首轮发现的两处失败保留在 `regression.log`，没有删除失败证据：运行中 attach 的旧断言已改为验证明确确认流程，MCP 的连续 Esc 测试改为确认真正返回列表后再关闭。
TypeScript 检查、394 模块构建和 npm dry-run 打包通过；没有执行全局安装或 npm 发布。

## 尚未声称完成

- 跨 worktree 原地切换、PR URL 筛选、分组、原始 JSONL 导入和完整的 Agent View。
- 全部 Plan/权限恢复优先级、CLI 临时参数恢复表、Goal/定时任务的完整跨进程恢复矩阵。
- 多终端并发审批的完整压力矩阵、断电/存储损坏恢复和 OS 级隔离/逃逸验收。
- 企业接入真机矩阵、完整 MCP/OAuth 互操作、真实 tokenizer/1M 上下文基准、供应链授权与签名、全部 IDE/远程/语音体验。

不修改真实用户 settings、模型 Key 或 CA，不自动发布 npm、不 push、不创建 PR。用户安装本地构建后使用：

```powershell
cd C:\Users\55038\CCPT
npm run build
npm install -g .
ccpt --resume
```
