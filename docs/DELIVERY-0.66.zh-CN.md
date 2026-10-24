# CCPT 0.66：调度迁移、目录监听、split-index 冲突处理

源码 `D:\project\CCPT`。本批交付三组代码补全；不重新计算剩余清单分母，不用本地用例代替企业实机结论。最终数字与日志见候选包旁 VALIDATION/evidence。

## 安装与公司配置

```powershell
npm install --global .\ccpt-0.66.0.tgz
ccpt --version
ccpt
```

此包仅供本地所有者验证，分发需先核实来源权利、NOTICE 与公司批准。不会自动覆盖实际全局安装或个人配置。配置仍在 `%USERPROFILE%\.ccpt\settings.json`；随包 config-templates 分别提供 Responses / Chat Completions / Messages。公司填实际部署名、完整 endpointUrl、认证和 CA；不要混用 Chat 与 Responses 端点。Key 使用凭据后端或环境变量，不进源码/包。CA 用 network.caFile 或 NODE_EXTRA_CA_CERTS，保持 TLS 验证；客户端私钥不打包。沿用 PRODUCT-GUIDE.zh-CN.md。

## 1. 旧调度任务迁移

没有 entrySha256 的旧 job 不再执行 tick/install。`automation status/list` 显示 entryBound 与迁移提示，避免把替换过的旧入口当作批准的代码。预览不执行旧入口，旧入口甚至可以已被卸载。

```powershell
ccpt automation migration-preview scheduler_ID
ccpt automation migrate scheduler_ID --expected-digest PREVIEW_SHA256 --confirm
# 明确检查新 ID 后再注册 OS；迁移本身不调用 manager。
ccpt automation install NEW_SCHEDULER_ID --confirm
```

摘要绑定旧 job、当前 CLI 的精确字节以及配置/扩展授权文件。tick 锁内重新审阅，拒绝旧摘要、重复/并发操作与变化的入口/配置。先禁用旧 ID，再保存 preparing 收据、准备新 ID、保存 prepared 收据。新 job 是 context-only，不执行模型/工具；旧 OS 定义和历史证据保留。不会搬移 job-bound wakeup，不自动取得 paid/read-only/Goal/上传授权。此类旧付费任务须重新 prepare 和人工审阅预算/策略。

保留 preparing 但无 prepared 的未知状态不自动重做，也不删除候选。查看原 job 的 migration.json 与 automation list，逐项核对后重新显式准备；不使用“超时”证明没有创建。manager 注册与本地状态不是跨资源事务；进程崩溃可能留下未注册候选。原已绑定任务仍走 rebind；本批不自动修改任何真实 OS 任务。

## 2. 显式目录 FileChanged

```json
{
  "hooks": [{
    "event": "FileChanged",
    "watchDirectories": [{
      "path": "src",
      "recursive": true,
      "maxDepth": 8,
      "maxFiles": 256,
      "exclude": ["generated", "fixtures/large"]
    }],
    "matcher": "src/*.ts",
    "command": "your-approved-observer-command"
  }]
}
```

目录、exclude 均是工作区相对的字面路径/前缀，不是 glob。只有 matcher 过滤事件可使用既有通配规则。默认不递归；首轮只建 baseline，后续发现新文件、修改和删除。不会读取正文发送给 Hook；payload 保留 path/file_path/relative_path/change/event/source，来源 filesystem-watch。沿用 Hook 运行权限、once 与生命周期 observer 失败处理；监听本身不授予命令权限。

始终跳过 .git、.ccpt、node_modules；不跟随符号链接，显式链接根/越界/受保护路径拒绝。每次完整扫描最多八个目录声明、512 文件、256 目录、2048 条目录项；每声明 maxFiles 默认256，最大512，深度默认8最大16。原64个显式文件限制保留。超限或扫描错误时整轮不发删除/修改事件，不推进 baseline；解除超限后继续比较，或通过已授权注册表重载建立新 baseline。

SDK `startHookFileWatch` 返回可停止函数及 update/status。status 返回 watching/blocked/baselining/stopped、文件数、成功扫描数和失败数，诊断不泄露原始异常。运行中的配置替换清空旧订阅/基线；无效替换停止观察。restricted 不扫描文件。每文件每分钟最多10次，速率表最多4096项。目录观察仅覆盖所选有界子树，轮询会合并/漏掉两次扫描间的短暂修改；非实时撤权、无损文件日志、全部参照触发点或 exactly-once 保证。SDK 停止不强杀已经在运行的 Hook。

## 3. split-index 冲突

沿用 `/conflicts` 及既有 Git 冲突 CLI/SDK/IDE 工作台。新增支持 split-index 的 ours/theirs/working/delete 选择，不提交、不推送、不执行 PR。

在 Git index.lock 下读取原 index，逐项解析 v2/v3/v4 条目、padding/前缀路径与扩展，校验 SHA-1/SHA-256 checksum，再解析真实 link 扩展；不把文件名里出现的 link 或 Git 在配置启用时合成的零 oid 当外部依赖。真实共享 index 还需对象名/内容 checksum 一致。备份 index.original 和完整 sharedindex.OID，收据记录共享对象 SHA-256。

仅在私有 candidate 上 materialize 完整索引并修改目标条目；禁用该私有命令的 Git hooks/fsmonitor/自动 split 偏好，不改仓库 core.splitIndex。再次验证原 index/共享对象/工作文件后才发布工作字节与完整候选 index。保留原共享对象、其他索引项、HEAD 和原工作字节。中断/未知结果保留 receipt、failure 与备份，不自动重放或覆盖并发编辑。

索引最多64 MiB、单文件16 MiB。符号链接/submodule 冲突仍拒绝；非协作编辑器、断电/fsync/NFS 不构成原子事务。暂不提供一键恢复原 split-index：恢复必须同时核对 index.original、共享对象和 working.original，不能只复制小 index 文件。不能把本地二进制/删除选择称为完整多文件可视合并器。

## 其余功能与边界

0.65 的 Plan/通知 outbox、签名插件审阅/中断恢复、审计外部签名 checkpoint 全部保留。公司请求、真实 OS 注册和业务 push/PR 本批均为0。完整剩余清单见 REMAINING-0.66.zh-CN.md。
