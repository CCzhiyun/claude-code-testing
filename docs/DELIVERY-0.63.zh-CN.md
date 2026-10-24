# CCPT 0.63：定时执行与冲突工作台

源码位置 `D:\project\CCPT`。本轮不修改个人模型配置、不注册真实 OS 任务、不更新真实全局 npm 命令，不执行公司请求/业务 push/PR/npm 发布。最终回归及实际 Node/归档检查以候选旁 VALIDATION/evidence 为准。

## 1. 已批准 Goal 的 OS 定时单次启动

先在原会话设置 active Goal，批准 Plan，使用 `/goal-run prepare` 或 `goal-run prepare` 创建有明确终身请求/token/工具预算的 ready Run，再操作：

```text
ccpt automation prepare-goal goalrun_ID --expected-version N --at 2026-11-01T02:00:00Z --minutes 5 --confirm
ccpt automation status scheduler_ID
ccpt automation install scheduler_ID --confirm
ccpt automation workflow-runs scheduler_ID
```

`--at` 必须在未来；省略默认最早一分钟后，实际到时取决于 OS timer 的分钟周期。prepare 只写本地定义，不安装；install 另需确认。使用既有 Windows 当前用户任务、Linux user systemd、macOS user launchd 入口，因此不依赖 TUI 常驻。到点只启动绑定的那个精确 ready 版本，不分解新任务、不放大预算、不新建脱离原会话的上下文。

启动前落盘 claim；多次唤醒、并发 tick、已写 claim 的异常退出不会重新发起。launch 表示子进程已启动，不等于任务完成。未知启动结果需人工核验，既不自动退款也不自动恢复。Model/政策/授权变化、Plan/Goal/Run 版本改变均拒绝执行；人机权限仍走原审批。waiting/failed/unknown 不会被定时器擅自批准或续行。

原会话中通过 `goal-run resume` 审查权限/反馈并准备新 ready 版本后，**重新 prepare-goal 并明确安装新的 schedule**。所有续行共享原 Run 的预算；旧 schedule 永远不会自动绑定新版本。普通 rebind 对 paid Goal/备份模式拒绝静默重绑。禁用 schedule 阻止下一次唤醒，不声称撤销已经启动的外部动作；取消运行使用既有 Goal cancel。

## 2. 非标准调度器路径与升级门禁

可在 settings 配置：

```json
{
  "schedulerManagers": {
    "systemctl": "/usr/local/libexec/systemctl",
    "launchctl": "/opt/company/bin/launchctl"
  }
}
```

仅当前 native OS 对应项被使用，默认仍是 `/usr/bin/systemctl`、`/bin/launchctl`。prepare 把规范真实路径和 SHA-256 固定在 job 中；native 主机要求 executable 与各级父目录 root-owned、不可 group/world 写。manager 替换后 install/query/recovery/uninstall 拒绝沿用，需显式审阅新定义。不调用 PATH 中同名程序，也不执行 settings 字符串作为 shell。

新 job 另外绑定 CLI 入口文件 SHA-256。包升级后旧入口字节改变，tick/install 不静默执行新代码；需重新准备 job。旧 job 没有该字段则保持旧兼容行为，不伪造已有绑定。nonce 文件来源、精确字节核验及不确定清理保留。跨 OS、发行版和企业策略真机仍另行验收。

## 3. 有界定时远程备份

先配置既有 `recoveryRemote.remote/expectedUrl` 和明确 Git push 权限，再操作：

```text
ccpt automation prepare-backup --max-runs 3 --minutes 60 --at 2026-11-01T02:00:00Z --confirm
ccpt automation status scheduler_ID
ccpt automation install scheduler_ID --confirm
ccpt automation workflow-runs scheduler_ID
ccpt automation backup-reconcile scheduler_ID --expected-digest LEDGER_DIGEST --confirm
```

仅上传 managed recovery refs 对应的**已提交历史**，不上传任意工作区文件。单 job 上限 1–20 次，每次仍受 1–32 exact refs、固定唯一 HTTPS push URL、无 userinfo/query/fragment、新备份命名空间、原子 push 和空 lease 限制。所有成功/不确定 claim 都消耗次数，不重置。无 refs 时不发起上传。

配置/网络/政策、原始授权文件、仓库 config 的摘要逐命令检查。为防无人值守时执行未经审阅的新代码，本版拒绝 executable settings Hooks/processWrapper、custom Git hooksPath、active fsmonitor、local includes 和 pre-push Hook；需要这些企业门禁时使用人工备份路径，不静默绕过。新增或修改仓库 Hook/config 后停止。

每次 prepare remote receipt 后先落盘 job claim，再尝试上传。unknown/claimed 会暂停后续所有唤醒，不换新 ID 偷偷重推。人工 reconcile 只把已由连接器查询到精确目标 OID 的结果标为 completed；查不清则保留 unknown，需人工后续核验。实际网络 Git 远端/凭据互操作尚未在本轮验收；测试只推到自有临时本地 bare 仓库。

## 4. 二进制/删除冲突选择工作台

终端 `/resolve-conflict` 列出冲突，`/resolve-conflict <exact path>` 打开两阶段人工向导；默认取消。可以选择 ours、theirs、手工编辑的 working bytes/deletion，或显式删除。长审阅 PgUp/PgDn。**某侧不存在代表删除，不是空文件**。Model 的 question JSON 不能安装本地 resolution 动作。

VS Code 命令 **CCPT: Resolve Git Conflict (Exact Bytes / Deletion)**：先选文件、打开元数据 JSON、选择结果，再显示明确模态确认。CLI/SDK 入口：

```text
ccpt agents conflict-review binary.dat
ccpt agents conflict-resolve binary.dat --choice theirs --expected-version REVIEW_DIGEST --confirm
```

仅 regular blob/working 文件，单文件 16 MiB、index 64 MiB；拒绝 symlink/submodule mode 和 split index。保留 `.ccpt/conflict-resolutions/conflict_ID/` 中的原 index、原 working 字节/删除信息、选中字节、receipt。原始二进制不经 UTF-8 解码；不调用 Git clean/smudge，也不运行 private index 的 post-index-change Hook。企业 policy 的 PermissionRequest/PreToolUse/PostToolUse 仍保留。

实际 Git `index.lock` 独占期间复核版本，在私有 index 写入 stage 0 后，才发布工作文件并原子替换 index。已有 Git 锁、旧版本、并发审批都拒绝。工作文件采用不覆盖并发新建路径的发布方式；新旧字节独立保存，后续编辑不会改变选中字节备份。异常保留 applying/unknown 证据，不自动回滚用户的后续修改。非协作外部编辑器、断电/NFS 不构成跨资源原子事务承诺。

不会自动 commit、push 或创建 PR。已有手工 stage、恢复 bundle 和 retention 功能继续保留。

实现接口参考：[Git index-info](https://git-scm.com/docs/git-update-index)、[Git 原始 blob 读取](https://git-scm.com/docs/git-cat-file)、[Git 环境与私有 index](https://git-scm.com/docs/git)。这些接口资料不代表本实现通过全部目标环境验收。

## 安装、构建与剩余

本地所有者安装本轮 tgz 后 `ccpt --version` 应为 0.63.0。源码可 `npm run check`、`npm run build`、`node dist/cli.js`；同事运行 tgz 只需 Node.js 20+。公司 API Key/CA/mTLS 私钥不得随包打入。

见 [REMAINING-0.63.zh-CN.md](REMAINING-0.63.zh-CN.md)。来源权利/NOTICE/分发审批门禁没有绕过；本轮没有把三项工程增量换算成全平台完成率。
