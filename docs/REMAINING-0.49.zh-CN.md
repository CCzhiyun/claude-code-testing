# 0.49 尚未完成的企业验收

日期：2026-10-06。MCP 授权码和插件恢复取得实质进展，不改变以下生产边界。

| 领域 | 本批新增 | 仍不能宣布完成 |
| --- | --- | --- |
| MCP | 实际 metadata/issuer pin、S256 PKCE、本机/手动回调、显式 public DCR、绑定续期、CLI/SDK | 企业服务器/协议全矩阵、OIDC fallback/跨域部署、注册管理/撤销、自动永久 worker、sampling/elicitation 完整人工授权执行 |
| 插件 | 持久历史、CLI/TUI/SDK 确认回滚、更新/卸载归档、当前信任/撤销/锁重验、互斥替换和失败恢复 | 签名 Marketplace overlay 无损方案、断电/磁盘故障自动恢复、全面升级/框架互操作、供应链运营与第三方授权 |
| 安全 | 新路径/junction 检查、活跃插件锁不超时抢占，保留 Windows DPAPI MCP 后端 | OS 隔离/逃逸矩阵、其他 OS 与模型凭据后端、许可/NOTICE/品牌兼容彻底清理 |
| 公司接入 | 继续提供三协议/CA/代理/mTLS/Entra/worker 配置 | 公司实际 Azure 部署与 CA/代理/mTLS/Entra 续期/后台 worker 真机矩阵；本批未访问公司端点 |
| 上下文 | 90% 提醒/>95% 压缩、归档和工具边界保留、既有可选语义摘要 | 准确原生 tokenizer/多模态计数、1M 大仓基准、语义摘要质量；不承诺无损，不关闭对话冒充压缩 |
| 自动化 | 延续双向 stream-json、预算、临时配置/会话、续接/分叉 | 参照事件完全等价、所有覆盖层组合、精确账单、零磁盘保证 |
| 多 Agent/Git | 保留 worktree/worker/编排/Plan 权限修复 | 冲突向导、断电恢复、审批压力、真实 push/PR 全链路；无授权不进行远端写入 |
| Hooks/Skills | 三态与现有 Hooks | 全 payload/退出码兼容、真实团队插件互操作 |
| IDE/UI | 历史/确认回滚接 TUI，MCP 面板引导 CLI 授权 | VS Code remote/multiwindow/reconnect/upgrade 真机矩阵、语音/移动/浏览器完整体验；非像素级复刻 |
| TPM/CA | 保留退避、本机限额、公开 CA 显式打包 | 跨机器配额、精确 TPM/账单、公司压力基准；普通包不含公司 CA |

历史证据见 [0.48 清单](REMAINING-0.48.zh-CN.md)，操作/验证见 [0.49 指南](PLATFORM-0.49.zh-CN.md)。公司环境、第三方授权和远端 Git 写入需要真实条件与权限，不能用源码或模拟服务器替代。
