# 0.53.0：按七方向清单继续实现与验收

这是一份实现/缺口对照，不是“所有剩余已完成”的声明。沿用包内 `docs/DELIVERY-0.52.zh-CN.md` 的模型/CA/三协议配置；本版不会改你的 settings、Key 或公司 CA。普通本地包不嵌入证书或个人状态。

## 本版新增入口

```powershell
ccpt wakeups doctor
ccpt hooks matrix
ccpt plugin transactions
ccpt plugin recover <install-or-replace-transaction-id> --confirm
ccpt agents recovery-page --offset 0 --limit 50
ccpt agents conflict-guide <relative-file>
ccpt agents conflict-stage <relative-file> --expected-version <digest> --confirm
ccpt agents recovery-prune <exact-managed-ref> --expected-commit <oid> --confirm
```

终端内 `/reload-skills --watch` 或 `/reload-plugins --watch` 显式开启本项目扩展目录的元数据轮询，`--watch-off` 关闭。最多 2048 项、四层目录、默认 750ms，不跟随链接；不是整个磁盘监听。正在运行工具或打开对话框时只提示变更，不改动进行中的权限，空闲后可手动 reload。自定义/用户全局扩展目录尚不在该监听范围内。

## 七方向的实际状态

| 方向 | 已实现/本版补充 | 仍未实现或未验收 |
| --- | --- | --- |
| 会话与自动化 | Goal 持久化、唤醒去重沿用；新增只读 wakeups doctor，报告孤立/跨工作区会话、过期时间、未完成 routine，不暴露 prompt、不确认投递、不重放操作 | **CLI 全退出后的 OS 定时启动/常驻调度服务未实现**；损坏状态的自动修复与全断电恢复未完成；缺运行 owner 的旧 routine 不能武断当成失败后重试 |
| Plan / Teams | IDE `project/watch`/`project/state` 跨进程失效通知；VS Code Plans/Teams 视图及显式 reviewed-version 决策；TUI 更新已有成员/Plan 状态、保留选中项；审批绑定窗口所见版本，拒绝过期版本 | **Remote/断线自动重连、升级与真实多 VS Code 窗口矩阵未验收**；新增成员/Plan 的 TUI 完整重载仍用 r；不是跨多个状态文件的事务快照 |
| Skills / Hooks | 新增逐声明事件公共 payload/退出码机器表与真实 Node fixture；显式本项目扩展 watch；来源与命名空间校验继续生效 | **逐事件参照 payload/退出码完全等价、全部自动触发点、跨进程 once、动态 shell 插值、所有目录自动热更新未完成**。本表不把手动 dispatch 误算成完整生命周期触发 |
| 插件 | 首次安装也持久化 install journal；显式恢复检查候选摘要、当前签名/锁/撤销规则和目标缺失；更新恢复/快照/回滚/收据修复保留 | **签名产物与未独立签名的 Marketplace overlay 合并仍明确拒绝**，否则会把目录附加代码冒认成发布者签名；无 journal 的早期残留、真实磁盘/断电故障、跨插件原子回滚仍需人工/专项测试 |
| MCP | 审批→模型→共享授权→传输回执新增关联审计；stdio 记录 reply-written，HTTP 空 202 后记录 reply-acknowledged；取消/超时/拒绝分开，日志不含提示词/表单值/远程 ID；审计不可写时不调用模型/分享结果 | **Agent/TUI 内嵌套审批、独立 GET 交互、URL elicitation、多模态 sampling、POST 自动断线续传未实现**；企业互操作未验收；审计文件不是防篡改签名账本，stdio 写管道不证明远端已消费 |
| 凭据与诊断 | Windows 模型/MCP DPAPI、端点绑定、前后台加载、脱敏导出已有；本版没有改动已有凭据 | **macOS/Linux 专用后端、独立凭据进程隔离、公司真实续期/轮换矩阵仍未实现或未验收** |
| Git / 搜索 | 冲突查看/人工编辑/版本校验/显式暂存链路；恢复引用分页与精确 commit 清理保护；清理前必须有 branch/tag 保留提交；目录遍历共享期限、深度/条目限制；Glob 改为非回溯 DP，literal/regex 读取也受限制 | **二进制/删除冲突完整可视化向导、自动选择 ours/theirs 未实现**；ref 自动保留期/跨机器备份未实现；外部 Git 并发/GC 的全事务保障未完成；真实企业大型仓库矩阵未验收 |

## 安全边界

- `conflict-guide` 不覆盖文件；手工解决后重新获取 digest，`conflict-stage` 要求当前文件/index 与已看版本一致且无冲突标记。只暂存，不 commit/push/PR。UTF-8 上限 2MB，二进制/删除冲突转人工。外部进程仍可能在检查后改文件，不宣称完整 TOCTOU 防护。
- `recovery-prune` 只删除一个精确 managed ref，必须 `--confirm`、匹配预期 commit，且 branch/tag 仍保留提交。没有按提交年龄自动删除历史，避免把 commit 时间误当保存时间；外部进程同时删保留分支仍不受本地检查完整控制。
- 安装恢复只完成已验证候选的原子 rename，不运行插件脚本、不联网、不覆盖现有安装；活 owner/未知 lock/篡改或撤销的产物仍拒绝。进程在写 journal 之前崩溃的残留不能自动猜测恢复。
- 审批审计只含本地 operationId/interactionId、服务器名摘要、阶段和结果。模型回调开始/完成和共享同意是不同事件；回执阶段与授权阶段区分。审核失败/磁盘权限失败不能变成静默放行。
- 授权日志在调用/分享前写入；回执日志写失败或断电不能撤回已经发出的回复，stdio 写入不证明服务端消费。没有把磁盘日志与外部网络动作当成原子事务。
- 元数据通知不是权限授予，VS Code 选择旧版本会要求重新选择；决策请求还必须通过后端 expectedVersion 检查。批准与执行分开。
- 搜索默认最多 20000 遍历项、64 层、约 10 秒共享截止，Glob 匹配不再使用可回溯正则。达到边界失败或按显式结果上限截断，不是全仓无遗漏索引；文件系统调用自身的永久挂起仍需 OS/网络文件系统测试。

Hook 详细语义见 `docs/HOOK-CONTRACTS-0.53.zh-CN.md`。

全量回归还发现并修复了“等待输入先发布、Task/Plan 后阻塞”的跨文件竞态：现在在 Agent 锁内先持久化 Task blocked 与 Plan blocked，再发布 waiting_for_input；阻塞状态写入失败会向上传递。移除发布后的重复 blocked 写入，避免迟到写入覆盖恢复后的新回合。新增故意延迟 Task 锁的测试，不用 sleep 重试断言来掩盖窗口。

精简的未完成列表见 `docs/REMAINING-0.53.zh-CN.md`，明确区分代码缺口、需要企业环境验收和表外 P0。

## 验证范围

`test/table-followup.test.ts` 覆盖审计无内容泄露/不可写失败关闭、双订阅者原子替换、所有声明 Hook 公共 payload、退出码/来源、自动化只读诊断、真实 Git 冲突/引用清理、64 路同版本审批以及首次安装篡改/恢复。

`test/ide-live-state.test.ts` 启动两个真实 bridge 子进程、订阅变化并竞争 16 次同版本审批，只有一个成功；不是两个实际 VS Code GUI/Remote 环境认证。`test/search-bounds.test.ts` 覆盖 Glob 语义、恶意 wildcard、遍历超时和取消。

`bun scripts/benchmark-search-bounds.ts` 创建合成 5000 文件，本机扫描约 1.5 秒且恶意正则可终止；这是可重跑性能证据，不是企业大仓或 1M 上下文验收。

最终全量：**535 通过、0 失败，102 个测试文件**，约 277 秒，证据 `.ccpt/table-followup-053/complete/`。类型检查、407 模块构建、编译后 Node CLI/SDK、HTTP/stdio 审批、Plan 质量门和凭据后端冒烟通过。首次真实 blocked 发布竞态失败保留在 `final/`，修复后另一次终端测试把流式文本当完成导致的夹具竞态保留在 `verified/`；测试已改为等待持久化 completed，而不是放宽用量计数。失败记录没有覆盖或伪装成通过。

## 安装本地候选包

```powershell
npm install -g --offline --ignore-scripts .\ccpt-0.53.0.tgz
ccpt --version
ccpt
```

源码构建：`npm run pack:delivery`。不需要 Windows EXE，不会替你执行真实全局安装。包内沿用三协议模板，模型 Key/URL/CA 必须由使用者配置，不能拿模型名猜协议端点。

**仍不具备生产分发批准**：来源权利、正式 NOTICE、旧品牌兼容层整理与第三方重分发授权没有凭空解决。OS 级 sandbox/逃逸、公司 Azure/代理/CA/mTLS/Entra、精确 tokenizer/多模态计数/1M 基准及已授权真实 push/PR 仍是独立 P0。发布门禁保留，本地候选只供所有者验收，不表示获准团队再分发。
