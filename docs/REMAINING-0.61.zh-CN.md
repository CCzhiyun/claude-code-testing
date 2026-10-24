# 0.61：原编号与九个企业领域的剩余项

不使用新的完成率分母；代码实现、自动化测试、目标环境验收分开记录。

## 原 A1–H4

- A1：V060-A1-01 直接恢复误判已修；增加 scoped owner 锁内核对、活 PID 保守拒绝、Plan 中断状态和无重放续行门禁。正常后台 Coding/审批/共享预算保留。Goal Run TUI/IDE 全流程向导、OS 定时 Coding 绑定、长运行/真实断电仍缺/未验收。
- A2：原 claim/人工 CAS/MCP 专用连接器/Git revert 保留；新调用 ID 业务重复、第三方专用补偿和真实外部系统矩阵未完成。
- A3/A4：原 nonce 收据/恢复/CAS 任务管理保留；真实 Windows/Linux/macOS 管理器、非标准路径和升级/中断矩阵仍未验收，跨 OS 注册与本地状态不是原子事务。
- P1/P2：有界通知和指定 Team/邮箱生产者的元数据补发保留；不是无损 outbox/无限历史/完整内部运行日志。
- P3：显式脱敏正文/元数据恢复、512 条有界保留、原生 continuation 留存不变；不提供完整 delta/图片/隐藏推理重放或零泄漏保证。
- P4：本地 Node/TUI/SDK/IDE bridge/扩展脚本可验证；Remote/真实多窗口/多根/长期网络文件系统仍未验收。
- H1/H2：模型边界故障分类、最多八次 Stop 软反馈等保留；非标准云故障样本、全部参照事件字段/退出码并非已对齐。
- H3：配置/授权变化边界暂停保留；新配置受同样的 authority snapshot 约束，不强杀已运行的外部进程。
- H4：已有显示/目录/文件/指令加载观察保留；全部触发源/决策/动态 watchPaths/无停顿热替换/exactly-once 仍未完成。

## 九个企业领域

| 原序号 | 本轮新增 | 仍缺/验收边界 |
| --- | --- | --- |
| 1 插件 | 独立签名 additive overlay；不可变多插件/收据版本集与单指针 CAS 原子切换/回滚，重验当前撤销和锁定；idle/运行中授权失效 | Marketplace 自动 overlay 分发、旧式原地安装的跨资源事务、断电/NFS 持久性、中断来源与团队真实插件矩阵未完成 |
| 2 MCP | 独立 GET 显式人工审批、三层嵌套界限、重复请求/预算/取消门禁；可选 POST SSE GET 续传；审计 HMAC 链 | URL/多模态、全部最新协议互操作、可信集中收集器/不可变外部锚点/审计防回滚存储未完成 |
| 3 凭据 | macOS Keychain、Linux Secret Service 接入模型/MCP，stdin 原生 helper，失败不明文回退 | 真机未验收；不支持全部 headless 企业策略，不是独立 OS 身份/硬件隔离；秘密仍短暂进入主进程 |
| 4 Git/搜索 | 人工解决后的二进制/删除 review → CAS stage；保留具体字节，不自动 commit/push | 自动 ref 保留期/远程备份、自动/图形化完整冲突选择、大仓性能矩阵仍缺 |
| 5 执行安全 | opt-in Linux bubblewrap 命令/stdio/同步 Hook 后端；有限真机探针代码 | Windows/macOS 后端、完整恶意进程树/逃逸评估未完成；本机 Windows 的 Linux 探针为 skip；不是全 Agent 强隔离 |
| 6 公司接入 | 保留三协议/CA/代理/mTLS 配置和显式验收模板；新 native credentialBackend 纳入部署绑定 | 公司 Azure、私有网关行为、CA 链轮换、代理/mTLS、Entra 续期和 worker 真机矩阵未验收；本轮公司请求为 0 |
| 7 上下文 | 新增显式 cl100k_base/o200k_base 实际文本 BPE，接预检/文本预算/TPM；原有 90% 提醒/>95% compact、reported usage/语义摘要能力保留 | GLM/私有部署不能猜编码；provider framing/多模态精确计数、1M 大仓/摘要质量基准仍未完成，不承诺零损失 |
| 8 来源/发布 | 新 CCPT_PLUGIN_ROOT 占位符、更新分发审查说明；已有来源 inventory/审批失效门禁保持 | 来源权利、真实 NOTICE/重分发批准、全部旧品牌兼容整理仍缺；不能伪造材料或去掉版权来完成；变更后旧 digest 审批不可沿用 |
| 9 实际交付 | 本地测试、构建产物、临时前缀离线安装可重复留证 | 真实 push/PR、OS/IDE 升级、长期断电、网络文件系统仍需目标环境和明确授权 |

## 发布/运行注意

这不是“全部生产完成”版本。不要直接在企业 CI 打开未验收的 native/sandbox/interactive MCP 选项；先在受控测试环境按 DELIVERY 中的入口逐项验收。正常模式的既有行为不因这些 opt-in 后端自动切换。

本轮不修改个人 settings，不注册真实 OS 任务，不调用公司服务，不推送、不创建 PR、不发布 npm。任何本地候选包仍受来源/NOTICE/重分发审查限制。
