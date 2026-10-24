# 0.67 剩余与验收边界

沿用 0.66 原 A1–H4 与十个平台领域，不重新设分母、不将五领域有代码进展称为全平台剩余完成一半。

| 原领域 | 本批变化 | 仍缺代码/能力与真实验收 |
| --- | --- | --- |
| A1–A4 | 原 Goal/安全重试/调度能力保留 | 通用业务幂等、专用第三方补偿；未知任务需人核验，付费旧任务新审批；OS manager/本地非全局事务。真实发行版/GUI/策略/长期断电矩阵未验收。 |
| P1–P4 | 新 Tasks/Team 删除墓碑/Agent 状态/邮箱提交后 outbox，与 Plan/通知共同 reconnect 补发 | 其他 runtime 细节、workspace watcher 仍非完整事务事件；无限历史、精确 delta/图片/provider 重放仍缺。4096 checkpoint、每队列256、恢复扫描上限；不允许旧写入器混写新邮箱。Remote/多窗口/多根/NFS/长期断电未验收。 |
| H1–H4 | 分组插件 Hooks 保留 once/watch/HTTP/prompt/agent 声明；有效配置拒绝未知声明 | 全参照触发点、逐事件决策/退出码一致性、瞬时文件变化、强实时撤权/无停顿插件替换/exactly-once 不保证；真实企业互操作未验收。 |
| 插件 | 旧单插件及历史的显式摘要审阅迁移，完整 generation，保留历史、不自动启用 | 后台更新/分发策略、跨 host/NFS、中断/真实团队源站/密钥矩阵。不可自动采用不完整/不可信来源。 |
| MCP/审计 | 内置共享模型 sampling、请求/token 预算、交互工具声明双 opt-in、请求/分享双审批、真实模型 HTTP/stdio 联测 | 服务器工具不在客户端自动执行；required toolChoice/音频本适配器明确拒绝。跨 CLI 企业账户限额、更多可选协议扩展；checkpoint 非集中正文/WORM/硬件隔离。企业 OAuth/媒体/代理/collector 未真实验收。 |
| 凭据/OS | 原实现保留 | 独立身份/硬件隔离，Windows/macOS 完整沙箱/逃逸防护；原生/headless凭据和恶意进程树真机安全评估未完成。 |
| Git/搜索 | 新 completed resolution 精确撤回、HEAD/index/working CAS、完整 split/shared-index 校验恢复；CLI/TUI/IDE/SDK | 旧无 HEAD receipt 不能自动恢复，后续暂存/编辑拒绝整体覆盖；symlink/submodule、完整多文件图形合并、更多远端/SSH/Hook/wrapper 自动备份未补。真实大仓/NFS/业务 push/PR 未验收。 |
| 公司接入 | 无公司请求，原协议/CA/代理/mTLS/Entra 实现保留 | 私有部署差异要真实响应样本。公司 Azure/CA轮换/代理/mTLS/Entra续期和worker真机矩阵仍需目标环境。 |
| 上下文质量 | 既有 BPE/语义摘要/压缩恢复保留 | 私有词表/framing/多模态精确计数、1M仓库与真实摘要质量基准；不承诺零信息损失。 |
| 发布/来源 | 新版本 inventory 不沿用旧审批；本地验证包 | 真实来源权利/NOTICE/再分发批准及 registry 范围，旧品牌法律/协议兼容整理；UNLICENSED/改名/本地安装不是授权。真实OS/IDE升级/长期故障未验收。 |

代码、回归、实际编译后运行、目标公司/OS环境验收分别记录；模拟/loopback不能当公司部署已验证。未自动改个人配置、实际全局安装，未注册真实 OS 任务、请求公司 API、发布 registry 或执行业务 push/PR。
