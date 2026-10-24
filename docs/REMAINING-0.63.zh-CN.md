# 0.63 剩余记录

本轮已补：OS 定时已批准 Goal 绑定（原会话/预算/单次 claim/人工续行）、非标准 native manager 和入口摘要、上限受控定时远程备份、TUI/IDE 二进制/删除冲突结果选择及原 index/文件备份。代码和本地进程验证不替代目标环境。

| 领域 | 仍缺 |
| --- | --- |
| 自动化 A1–A4 | Windows/Linux/macOS 真实注册/升级/断电矩阵；未知结果的通用业务证明与专用第三方补偿；外部 manager 和本地状态非跨资源原子事务。旧未绑定入口 job 不自动迁移 |
| 通知/历史/Teams | 无损 outbox、无限历史、全部细粒度运行事件；完整 delta/图片/provider 状态重放；真实 Remote/多窗口/多根/升级/长期 NFS |
| Hooks | 全部指令来源、第三方写入触发、每事件决策/退出码参照一致性；强实时撤权、任意插件零停顿替换、exactly-once |
| 插件 | Marketplace 自动分发独立签名 overlay、旧安装跨资源事务；团队真实插件/中断来源与 NFS 断电矩阵 |
| MCP | URL 完成关联/协议错误处理、内容数组/工具 sampling 等全部最新形态；集中不可变审计/防回滚存储；企业互操作 |
| 凭据/执行隔离 | macOS/Linux 企业/headless 真机；独立 OS 身份/硬件隔离；Windows/macOS 沙箱、完整恶意进程树/逃逸评估。Linux 探针在 Windows 上仍 skip |
| Git/搜索 | SSH/全部远端类型、需要自定义 Git Hooks/processWrapper 的无人值守备份；split index/symlink/submodule 冲突；完整像素级/多文件合并器；真实大仓、跨机恢复/NFS。新 resolver 无自动 commit/push/PR |
| 公司接入 | 公司私有 Azure/CA 轮换/代理/mTLS/Entra 续期/worker 真实矩阵；本轮公司请求 0 |
| 上下文 | 私有部署正确 tokenizer、framing/多模态精确 token、1M 大仓和语义摘要质量；不承诺零信息损失 |
| 来源与交付 | 真实来源权利、依赖/NOTICE/重分发批准、旧品牌兼容层整理；真实业务 push/PR、IDE/OS 升级和长期故障验收。新 inventory digest 不能沿用旧审批 |

未注册真实 OS 任务、未发公司请求、未执行业务 push/PR/npm 发布；定时远程备份与 Git 冲突验收均使用自有临时仓库。更早原编号细节见 REMAINING-0.62.zh-CN.md；本文件上述已实现项取代旧条目中的对应代码缺口，其他边界继续有效。
