# CCPT：清理恢复与运行可靠性增强（2026-10-17）

本轮接续 Plan/Teams 质量检查，处理可在本机实际验证的剩余风险。没有访问公司网关、修改真实用户 settings/Key/CA、执行 push 或创建 PR。

## Worktree 清理不依赖分支名来保留提交

清理前确认目标 Git common-dir 与所属仓库一致；不是仅凭目录叫 `agent_…` 就删除。原有脏文件 checkpoint 行为继续受 Git/命令权限和 Hooks 控制。

删除前为最终 HEAD 创建一个独立本地引用：

```text
refs/ccpt/recovery/agent_<id>/save_<id>
```

建立恢复引用失败时，不继续删除。恢复引用不依赖原工作分支存在，保护未推送和 detached HEAD 的提交；不执行网络请求，也不把本地恢复引用误当成“已经推送”。Git 对 worktree 与引用的定义参考 [worktree 文档](https://git-scm.com/docs/git-worktree)、[update-ref 文档](https://git-scm.com/docs/git-update-ref)。

查看保留内容：

```powershell
ccpt agents recovery-list
```

交互界面可输入 `/agents recovery-list`。输出包含 `ref` 和 `commit`。可先在原仓库查看内容，再由人决定是否创建恢复分支：

```powershell
git show <commit>
git branch recovered-work <commit>
```

CLI 的 `agents cleanup` 现在与 TUI 一样，拒绝删除尚未结束或仍在等待输入的 Agent 工作区。先明确完成或停止该 Agent。

如果工作区存在 ignored 文件，Git checkpoint 无法保留这些文件；清理会拒绝，目录保持原样。包括 ignored 配置和依赖目录，均需先人工检查、迁移或删除确认不再需要的内容。不提供静默强制清理，也不自动把潜在秘密打包进恢复档案。

显式复制附加文件到 worktree 时，既检查源/目标的实际路径，也执行受保护路径策略。不能通过中间目录 junction/symlink 把仓库外文件读进来或写出去；`.env` 等受保护路径不会因“附加文件”功能而绕过策略。

边界：恢复 refs 是本地 Git 数据，未实现跨机器备份、恢复列表分页/保留期管理；手工删除 refs 或整个仓库仍可能丢数据。清理检查不构成对并发外部文件修改的完整事务保护。没有用本机测试代替真实 push/PR 和 Git reftable 平台矩阵。

## 状态锁不再仅按时间删除

旧实现可能删除仍由活进程持有、但年龄超过等待超时的锁。本轮改为：

- 进程仍存活或无权确认其状态时，不抢锁。
- 只回收能确认 owner 进程已退出的锁；竞争回收者串行并重新读取 owner。
- 新锁带随机 token；释放前验证 token，不删除其他 owner 的替代记录。
- 损坏/未知 owner 记录不会自动删除，等待有界超时，保留人工诊断机会。
- 兼容旧版只含 PID 的锁；PID 已复用时宁可阻塞，不凭旧时间戳猜测安全。

边界：不宣称完成全平台断电恢复。极端情况下损坏锁或遗留 `.reclaim` 文件仍需人工确认没有活动进程后处理；网络文件系统、跨机器 PID、PID namespace 的共享状态目录尚未验收。

## 文本读取和搜索

- 统一有界 UTF-8 读取，避免 stat 后文件增长导致无界读入。
- 二进制、NUL、非法 UTF-8、终端控制内容明确拒绝；中文、emoji、UTF-8 BOM 和常见换行/Tab 正常读取。
- UTF-16/其他编码不做猜测转换，明确告知不是受支持的 UTF-8 文本。图片/PDF 需合适工具，不把字节乱码塞进模型上下文。
- `read_file` 与直接 FileRead 路径使用同一检查；offset/limit 拒绝 NaN、Infinity、负数和无效小数。
- `search_text` 支持单文件目标。只有已识别的非文本/超大文件会跳过，真正的读取、磁盘、目录错误向上传递，不再静默变成“No matches”。
- Glob 默认 `**/*` 也匹配根目录文件，跳过 symlink，递归共享全局数量上限；Grep 重新验证实际读取路径。

边界：搜索有文件数/大小上限，不是无遗漏索引；Grep 的 JS 正则路径尚未完成完整 ReDoS/大仓性能矩阵，不声称所有恶意模式都能有界执行。路径检查也不是 OS 级隔离或对所有 TOCTOU 竞争的解决方案。

## 工作流和 Command

- 无论从文件加载还是直接调用 `runWorkflow`，在启动任何 worker 前校验完整图：任务 ID、必填目标、枚举、依赖、重复 ID、自依赖、未知依赖和环。
- 空工作流不再伪装成成功；最多 200 个任务。
- `skip` / `when` / `if` 这样的尚未支持的条件任务字段明确拒绝，不悄悄忽略后把流程记为成功。完整动态条件工作流仍是未完成项。
- 一批部分启动失败时，停止本批已成功启动的 Agent，并在错误里保留它们的 ID，避免调用失败后留下无人管理的 worker。
- 自定义 Command 展开前按 UTF-8 字节预估，限制约 1 MB；只替换原模板占位符，参数里的 `{cwd}` 不二次展开，不运行动态 shell 插值。

## 回归证据

- `test/reliability-boundaries.test.ts`：活锁、死进程回收、独立进程读改写、未知 owner、二进制/Unicode/数值边界、根文件搜索、DAG 预检和 Command 放大。
- `test/worktree.test.ts`：真实 Git 创建/合并/清理、脏文件 checkpoint、detached 未推送提交、删除原分支并 GC 后恢复、ignored 文件、伪装仓库和中间链接边界。
- `test/workflow-runtime.test.ts`：实际分离 worker 的依赖顺序与部分启动失败清理。
- 定向测试通过；全量日志保存在 `.ccpt/reliability-20261017/`，最终数字以最终回归报告为准。

回归过程中保留了失败记录：`initial/` 全量 467 通过；`final/` 的 470 个用例通过，但测试夹具清理在 Windows 上遇到一次 `EBUSY`，整体报告为失败。后台命令已结束不等于 worker 的末尾审计/进程退出也已经结束，因此测试只对自身临时目录增加有界清理重试；不忽略永久占用，也不根据持久化 PID 强制杀进程。最终复测存放在 `verified/`。

测试夹具使用显式重试循环，不依赖本机 Bun/Windows 对 `fs.rm(maxRetries)` 的处理；最多约 3 秒，超过上限仍失败。该辅助函数只接受系统临时目录内的目标，不用于清理用户项目。打包 Node 入口的恢复列表/活跃 Agent 清理保护也通过独立 smoke 验证，证据为 `final/packaged-recovery-smoke.json`。

最终复测结果：**470 通过 / 0 失败**，91 个测试文件，约 219 秒（`verified/single-process-regression.json`）。TypeScript 检查通过，395 模块构建通过，打包 Node CLI smoke 通过；npm dry-run 为 73 条目、约 1.76 MB。没有全局安装或发布新包。

本轮修复不代表 OS 级 sandbox/逃逸、专用凭据后端、第三方重分发授权、公司 CA/代理/mTLS/Entra 真机、全部 MCP/OAuth、准确 tokenizer/1M 基准、完整 IDE/远程/语音能力已经完成。它们仍需要各自的实现、授权或真实环境验收，不能由模拟服务器或 `UNLICENSED` 代替。

## 更新 CLI

```powershell
cd C:\Users\55038\CCPT
npm run build
npm install -g .
ccpt
```

本轮不自动全局安装、不发布 npm。现有模型协议与公司 CA 配置不变。
