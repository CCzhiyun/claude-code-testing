# 0.48 清单复核：实现不等于生产验收

这是历史快照；MCP 授权码和插件历史恢复已在下一版推进，当前状态见 [0.49 清单](REMAINING-0.49.zh-CN.md)。

日期：2026-10-05。此清单优先于旧验收矩阵中的宽泛“已实现”。源码覆盖率、菜单数量和 415 项映射不能代表行为完全等价或生产安全已验收。

| 用户清单 | 当前本地实现/证据 | 未关闭事项 |
|---|---|---|
| 企业安全/分发 P0 | 工作区/保护路径/环境/命令策略，wrapper 契约；Windows 所属进程树取消实测；0.48 新增 DPAPI MCP token、迁移、并发刷新与失败关闭 | 真实 OS 隔离、跨 OS 逃逸与进程压力矩阵；模型凭据与跨平台专用后端；第三方来源、许可、NOTICE、重分发授权；兼容层品牌残留 |
| 公司接入 P0 | 三种协议、端点/能力校验、CA/代理/mTLS 配置、公开 CA 打包、后台 worker 配置传递；本地 TLS 与测试服务器覆盖 | 公司 Azure 各部署、CA 链、代理、mTLS、Entra 续期及 worker 真机矩阵。没有用模拟服务冒充公司通过 |
| 上下文质量 | 90% 提醒，严格超过 95% 自动压缩；全文归档、同会话继续；0.46 可选有界模型语义摘要及失败回退 | 真实 tokenizer、多模态精确计数、1M/大型仓库基准、语义摘要质量和分块摘要；不保证零损失 |
| MCP | 工具/资源/提示词，device flow；0.47 独立 GET/SSE 同会话续传/去重/有界重连；0.48 非阻塞 TUI 监听管理 | 自动永久常驻 worker；sampling/elicitation 完整授权执行；OAuth metadata/PKCE/dynamic registration 与当前协议全矩阵；企业服务器互操作 |
| 自动化协议 | 文本双向 NDJSON、取消/续接、临时 settings/MCP/plugin/Agent/tools、金额/请求预算和临时状态；0.48 新增启动续接/分叉与工具默认重置 | 不与参照事件完全等价；无精确账单/零磁盘承诺；全部 CLI 参数/组合与无持久化长任务仍未全面覆盖 |
| 多 Agent/Git | 独立 worker/worktree、限深/限并发、持久任务、共享预算；0.48 Plan 完成发布顺序与 restricted 权限保持 | 跨 worktree 冲突向导、断电恢复、并发审批压力和真实 push/Draft PR 全流程；未授权不执行远端写入 |
| Hooks/Skills/插件 | Skills auto/manual/disabled；版本/摘要锁；Ed25519 发布者签名、管理员信任根、撤销验证；插件更新失败恢复旧目录 | 每个 Hook payload/退出码完整兼容；完整版本回滚/升级矩阵、真实团队框架互操作与供应链运营；签名不授予重分发权 |
| IDE/UI | 终端设置/模型/权限/技能/任务/会话/Focus；0.48 增加 MCP 监听和启动恢复；VS Code 本地桥接/附件/流式事件 | VS Code 远程/多窗口/重连/升级真机矩阵，自定义主题、语音、移动/浏览器完整产品体验；非像素级克隆 |
| TPM | 三协议 429/瞬态退避、Retry-After、有界等待、取消；共享本机 RPM/TPM 与预算，不重放部分输出 | token 估算与跨机器限流协调、公司特定网关码和压力基准 |
| CA 嵌包 | 显式构建公开 CA 链、拒绝私钥、摘要校验、外部覆盖、普通构建去除旧生成证书 | 本交付不含公司 CA；需企业批准和合法分发渠道，不能嵌 token/mTLS 私钥 |

## 对最初 AC1–AC25 的判断

AC2–10、AC13–14、AC16–18、AC20、AC22–25 有本地可执行路径与回归证据；仍受上表压力、互操作、平台矩阵限制。AC1（真实大窗口/质量）、AC11–12（完整 MCP/OAuth）、AC15（OS 沙箱）、AC19（公司网络）和 AC21（IDE 真机矩阵）不能宣布全面完成。

尤其 AC15 的 wrapper 与路径过滤不是内核隔离；`UNLICENSED` 不是第三方授权。本次没有删除法定署名来假装完成品牌整理，也没有公开发布 npm 包。

## 本次新增行为验收

- `test/mcp-watch-tasks.test.ts`：生命周期/限额/快照、100 条通知环、脱敏、加载配置撤销、即时退出不握手。
- `test/terminal-mcp-watch-integration.test.ts`：真实输入驱动终端、监听中聊天、详情停止确认、通知不进入模型、刷新撤销、退出清理。
- `test/mcp-credentials.test.ts`：本机真实 Windows DPAPI 存取/迁移/篡改/路径变更失败关闭；并发写入与单次刷新；device-flow 等待取消。
- `test/plan-publication.test.ts`：延迟 Plan 锁下不提前发布 completed；获批 Plan 的 worker 保持 restricted。
- `test/session-startup.test.ts`、`test/runtime-options.test.ts`：实际 CLI continue/fork、上下文继承、独立原会话、完整工具目录/禁用、临时模型/effort、参数冲突与受管优先。
- `test/terminal-resume-integration.test.ts`：启动恢复无模型请求，后续真实工具执行与分叉。

本地提供方回归采用测试服务器；公司生产部署与 GLM 的 Responses 支持未在本次验证。历史 GLM Responses 曾返回 404，不能因兼容 Chat/Messages 推断它支持 Responses。

最终本地全量回归：384 项通过、0 失败，77 个测试文件、2892 个断言；TypeScript check 与 Node bundle build 通过。构建后的 0.48.0 在 Windows PTY 中启动、Settings 搜索、模型选择、MCP 空配置、任务列表和退出已实际检查，见 [终端对比](UI-COMPARISON-0.48.zh-CN.md)。普通构建未嵌入公司 CA。tgz 在独立目录 npm 安装通过，Windows 命令 shim 的版本/帮助、SDK 导入及原生 Node DPAPI 登录/退出通过，使用的只是隔离测试 token。未覆盖用户全局安装。操作见 [0.48 指南](PLATFORM-0.48.zh-CN.md)。
