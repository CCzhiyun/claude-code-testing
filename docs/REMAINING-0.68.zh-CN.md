# 0.68 剩余与验收边界

沿用 0.67 原 A1–H4 与平台领域，不重新计算“全部剩余一半”。本批固定的六项代码交付为：required 工具选择、本地共享账户、逐行展示、私有 BPE、framing、显式 SSH-wrapper 备份；六项各有边界，并不消除下表其他缺口。准确测试结果见随包 VALIDATION/evidence。

| 原领域 | 本批进展 | 仍缺代码/能力与真实验收 |
| --- | --- | --- |
| A1–A4 | 后台 worker 沿用模型共享边界；可用本地命名预算 | 通用业务幂等、专用第三方补偿；未知任务人核验，付费旧任务新审批。OS manager/本地非全局事务；真实发行版、GUI、策略、升级/长期断电未验收。 |
| P1–P4 | 既有状态+outbox、分页、reconnect 保留 | 其他 runtime 细节/workspace watcher 非完整事务事件；无限历史、精确 delta/图片/provider 重放仍缺。跨工作区与工作文件不是一个事务，Remote/多窗口/多根/NFS/长期断电未验收。 |
| H1–H4 | 可选逐行 MessageDisplay，稳定消息 ID/批次/末批；失败整条回退 | 不是实时 token Hook。全部参照触发点、逐事件决策/退出码、瞬时文件变化、强实时撤权/插件无停顿替换/exactly-once 仍未保证。 |
| 插件 | 原迁移/签名 overlay/generation 保留 | 后台更新/分发策略、跨 host/NFS、中断/真实团队源站/密钥矩阵；不采用不完整/不可信来源，未获重分发权利不能分享。 |
| MCP/审计 | Responses/Chat/bridge 的 required 原生字段与结果校验；沿用双审批，命名预算可跨 CLI | 音频采样及更多可选扩展未补；服务器工具不在本地自动执行。共享账本只是同状态目录的本地账户，不是企业中央账务。checkpoint 不是集中正文/WORM/硬件隔离。企业 OAuth/媒体/代理/collector 真实矩阵未验收。 |
| 凭据/OS | 原专用后端/进程/沙箱实现保留 | 独立 OS 身份/硬件隔离、Windows/macOS 完整沙箱/逃逸防护；原生/headless 凭据与恶意进程树真机安全评估未完成。 |
| Git/搜索 | 新显式 SSH-wrapper 路径、wrapper 摘要审批绑定；已有 Hook/wrapper/审计、精确 refs 与 unknown 查询沿用 | SSH host key/凭据/策略由企业 wrapper 实现，本地 bare fixture 不算真实 SSH。wrapper 的依赖/配置变更未作完整递归签名。symlink/submodule、完整多文件图形合并、其他远端拓扑/自动上传审批、大仓/NFS/业务 push/PR 未验收。 |
| 公司接入 | 公司请求为 0，独立协议/CA/代理/mTLS/Entra 实现保留 | 私有部署差异需真实响应样本。Azure/CA 轮换/代理/mTLS/Entra 续期、worker 公司真机矩阵仍未验收。 |
| 上下文质量 | 摘要固定私有 packed BPE、内置预切分模式、framing 保守配置参与 90/95 阈值 | 不支持任意私有预切分正则/特殊 token 模式；不是自动识别模型 tokenizer。多模态/提供方 framing 精确计数、1M 大仓和语义摘要质量基准仍缺，不保证零信息损失。 |
| 发布/来源 | 新 inventory，不沿用旧审批；仅所有者本地验证包 | 真实来源权利、NOTICE、重分发批准、registry 范围、旧品牌法律/协议兼容整理仍需材料。UNLICENSED/改名/npm 安装不产生授权。OS/IDE 真升级与长期故障未验收。 |

预算多文件预留不是跨资源事务，中断可能留保守预留；损坏不重置、未知不重放不退款。共享账户配置可被同 OS 身份管理员改变，不是恶意同身份进程的安全边界。真实环境项不能用 fixture 标记为完成。
