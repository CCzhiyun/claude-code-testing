# CCPT 0.55：剩余清单续补

本版继续完成若干子链路，不把尚缺能力、模拟测试或第三方授权标成完成。

## 本轮实现

| 方向 | 已实现 | 边界 |
| --- | --- | --- |
| Git 恢复 | 导出完整 Git bundle、SHA-256 校验、清单与实际 refs 对照；复制到另一仓库后仅创建一个全新本地分支 | 用户通过获准渠道搬运备份目录；没有自动上传/云备份。只包含恢复 refs 可达的已提交历史，不含未提交/未跟踪文件 |
| Skills / 插件监听 | 忙碌或弹窗期间保留变更，空闲后合并重载；重载中收到新变更再补一轮；失败不无限重试 | 显式开启 watch；仍受目录信任、数量/深度/条目限制。没有放宽全局可执行目录授权 |
| settings 变更 | 监听项目/用户 settings，安全空闲时重新载入配置；配置内的自定义扩展根重新订阅 | 配置加载失败保留先前注册表；环境变量仍遵守原有配置机制。不是所有插件的无停顿热替换 |
| Teams | 新成员/Plan 基础上，继续实时合并任务和嵌套邮箱变化；按 ID 保留选择，忙碌时延后刷新 | 只读邮箱不建立读回执、不标已读，不推进 Plan 人工审批版本。超限/损坏需显式刷新 |
| 插件残留 | `plugin orphans` 检查无 journal 的原始残留；确认摘要后移动到可恢复隔离区 | 不推断安装来源、不加载半写 manifest、不执行脚本，不把隔离称为成功安装 |
| 安装并发 | 受管理的插件修改与残留隔离共用 maintenance 锁；未知/遗留操作锁阻止隔离 | 跨插件修改会被串行化；这不是跨多个目录/来源收据的原子回滚，也不是 OS 沙箱 |

0.54 已有的 IDE 重连、Hook 跨进程 once、状态检查点恢复和冲突元数据检查继续保留。

## 安装与启动

需要 Node.js 20+，无需 EXE。下载本地候选包后：

```powershell
npm install -g .\ccpt-0.55.0.tgz
ccpt --version
cd C:\your-project
ccpt
```

本轮未改变本机全局安装、个人模型/API Key/CA 配置，没有发送真实公司模型请求。

公司配置沿用 `%USERPROFILE%\.ccpt\settings.json`；Responses、Chat Completions 与 Messages 的模板分别放在交付目录 `config-templates`。不要混用 URL 和协议。CA 仍由 `network.caFile` 或环境变量提供；本包不携带公司证书或密钥。

## 离线恢复备份

```text
ccpt agents recovery-backup --confirm
```

命令返回备份目录、refs 和 `sha256`。目录中有 `recovery.bundle`、`manifest.json`。通过公司认可的渠道复制整个目录；摘要要从独立可信的导出结果核对，而不是只信同目录内可编辑的 manifest。

在目标机器的 Git 仓库中，将目录放进允许的工作区，然后：

```text
ccpt agents recovery-backup-check .\incoming --expected-sha256 <可信摘要>
ccpt agents recovery-import .\incoming --expected-sha256 <可信摘要> --ref <导出中的完整managed-ref> --branch recovered/team --confirm
```

限制：1–128 个 managed refs、bundle 至多 512 MiB，拒绝外部前置对象依赖、链接和不匹配的 Git 对象格式。导入不 checkout、不合并、不覆盖已有分支、不联网。若对象写入后创建分支失败，对象会保留，先检查再重试。SHA-256 校验不是来源签名；同用户恶意并发修改仍需 OS 级隔离解决。

注意：已提交历史可能包含历史敏感信息。导出需要明确确认；不把“未包含 settings 文件”当作“没有历史秘密”的保证。

## 延迟热更新

终端内执行：

```text
/reload-skills --watch
/reload-plugins --watch
/reload-skills --watch-off
```

watch 打开后，忙碌变更会合并，空闲后自动生效；settings 的自定义根变化会重新订阅。加载失败会提示，等待新修改或手动 `/reload-plugins`，不会反复自动执行。关闭后停止后续监听/重载；已经开始的只读加载可能完成。

## 无 journal 残留

```text
ccpt plugin orphans
ccpt plugin quarantine <transaction-id> --expected-digest <检查给出的摘要> --confirm
```

隔离保留原始内容与收据，位置是 `.ccpt/plugin-quarantine/<随机ID>/staging`。目录不在插件发现路径内，不被加载。具有 journal 的事务仍使用原来的 `plugin recover`。活跃/未知 legacy 锁、变化的摘要、链接、超大文件都不会被自动忽略。

## 测试和交付边界

新增测试在 `test/platform-followup-055.test.ts`，实际按键/构建入口检查在 `scripts/verify-followup-055.ts`；全量结果和包验证报告随交付目录提供。

包仍是所有者本地验证候选。第三方来源、许可、NOTICE 和重分发审批未完成，发布门禁不会因此解除。完整剩余项见 `REMAINING-0.55.zh-CN.md`。
