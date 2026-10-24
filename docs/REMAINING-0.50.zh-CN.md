# 0.50 剩余验收：不能用菜单或 fixture 代替生产验证

当前增量与尚未完成项见 [0.53 对照](DELIVERY-0.53.zh-CN.md) 和 [0.53 剩余列表](REMAINING-0.53.zh-CN.md)。以下为历史记录，不能把旧表中的每项重新认定为完全未实现。

0.52.0 本地交付候选补充显式 `model acceptance --confirm`（五阶段最多七次请求）、随包运行依赖及真实离线 npm shim/已安装 Agent/后台 worker 验证，并修复 Windows 配置共享冲突处理。见 [安装与验收](DELIVERY-0.52.zh-CN.md)。这些增量不等于下列外部环境和授权条件已完成。

最新第三批：[HTTP/SDK/分发门禁](HTTP-SDK-RELEASE-2026-10-17.zh-CN.md) 已补请求所属 POST/SSE 的显式反向交互、npm SDK 声明、签名来源收据修复和本地发布审核门禁。独立 GET 交互、完整互操作、OS 级隔离、公司真机和分发权利仍未验收；下面是历史表，不应逐项误读为当前完全未实现。

后续增量：2026-10-16 的 [会话恢复](SESSION-RECOVERY-STATE-2026-10-16.zh-CN.md)、[Plan/Teams 完成门禁](PLAN-TEAMS-QUALITY-2026-10-16.zh-CN.md)，以及 2026-10-17 的 [清理恢复与可靠性](RELIABILITY-AND-RECOVERY-2026-10-17.zh-CN.md) 已补充本地实现与专项测试。下面保留 0.50 当时的剩余表；同名项应结合增量说明阅读，不代表企业真机或全平台验收已完成。

日期：2026-10-06。本批推进 Skills/Plan/实际 Teams，不宣称整个企业平台所有 P0 已完成。前版已完成的 OAuth PKCE、插件恢复、三协议、90% 提醒/>95% 压缩继续保留。

2026-10-17 后续增量：[平台补强说明](PLATFORM-CLOSEOUT-2026-10-17.zh-CN.md) 增加 Goal/唤醒恢复、Plan/IDE 版本化决策、Windows 模型凭据后端、诊断导出、插件事务恢复、Git 冲突/恢复分支和正则执行隔离。本地回归 483 项通过；本表的跨平台、公司环境、完整互操作与许可验收要求继续有效。

同日第二批：[交互与签名说明](PLATFORM-INTERACTIONS-2026-10-17.zh-CN.md) 补受限 stdio MCP 两阶段人工审批、签名原始产物 Marketplace 路径、stdin 凭据导入及真实普通进程树取消测试；仍不等于完整反向 MCP、任意签名 overlay 或 OS 逃逸矩阵完成。

| 领域 | 本批进展 | 仍需完成或真实验收 |
| --- | --- | --- |
| Skills | 四态可见性、inline/fork、参数、文件校验、当前轮工具交集、插件 Agent 命名空间 | 完整 YAML/动态 shell 插值/路径模式、完整渐进发现与大型 Skills 库性能、真实团队插件互操作；不启用危险插值冒充兼容 |
| Plan | 模型提交后持久暂停、明确人工审批、主/子代理只读、Shift+Tab 实际运行模式 | 完整 IDE/多窗口审批同步和并发审批压力；不实现默认自动授权 |
| Agent/Teams | 独立专家、权限继承、专属记忆、后台队友、实际成员面板、广播、取消后可恢复、安全清理 | 跨 worktree 冲突向导、断电恢复全矩阵、自动闲置唤醒策略、peer 计划审批协议；部分编排框架质量门/假设/planApproved 尚非 worker 强制门 |
| 安全/分发 P0 | 收紧子代理能力、Plan 不能代理逃逸、路径与秘密格式检查 | OS 级隔离/逃逸与进程树矩阵、全平台/模型凭据后端、来源/许可/NOTICE/第三方重分发授权、旧品牌兼容全面清理。UNLICENSED 不提供第三方授权 |
| 公司接入 P0 | 保留独立 Chat/Responses/Messages 配置、CA、代理、mTLS、Entra | 公司 Azure 部署、CA 链、代理、mTLS、Entra 续期、后台 worker 真机验收；本批未访问公司端点 |
| 上下文质量 | 同一会话续接，fork 隔离，记忆只注入限定索引 | 原生准确 tokenizer、多模态精确计数、1M/大仓基准和摘要质量；摘录/可选语义摘要都不承诺零损失 |
| MCP | 延续实际 GET SSE/续传、PKCE、issuer pin、显式 DCR/手动回调 | 企业全矩阵、sampling/elicitation 完整人工授权执行、长期 worker/注册撤销运维 |
| 自动化/费用 | 保留双向 stream-json、覆盖层、共享预算/退避 | 参照事件完全等价、所有 CLI 临时覆盖层组合、精确 TPM/账单/跨机器配额、零磁盘保证 |
| Hooks/插件 | 四态 Skills 与现有 Hooks/签名/锁/恢复并存 | 全 payload/退出码兼容、断电/磁盘恢复、签名 Marketplace overlay 无损、供应链运营 |
| IDE/UI | 终端按键实测与功能运行链路连接 | VS Code remote/multiwindow/reconnect/upgrade 真机矩阵、主题/语音/浏览器/移动全体验；没有像素级复刻保证 |
| Git | 现有隔离 worktree 与审批策略 | 公司真实 push/PR 全链路；未获授权不会替用户推送/建 PR |
| CA 打包 | 继续支持显式嵌入公开 CA | 普通包不含公司 CA；不能把私钥/密钥打包；企业内部包分发授权和证书轮换需管理 |

验证证据和操作见 [0.50 指南](PLATFORM-0.50.zh-CN.md)，参照直接观察见 [本轮核对](UI-COMPARISON-0.50.zh-CN.md)。历史 P0 与授权边界见 [0.49 清单](REMAINING-0.49.zh-CN.md)。
