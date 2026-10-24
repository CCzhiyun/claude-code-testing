# 0.40 增量验收与剩余事项

本文件更新 [0.39 历史差距审计](REFERENCE-PARITY-GAPS-0.39.zh-CN.md)，不以源码文件分类或菜单存在作为完成证据。

## 本轮关闭/推进

- Azure Responses 第三协议：Settings/CLI/Agent runtime，文本/图片映射、工具往返、流式、JSON schema 配置、可选会话链、显式远端记录查询/删除。
- 每轮完整上下文（含输出/安全预留）达到 90% 提醒，严格超过 95% 自动压缩；旧历史归档；不可压缩和关闭自动压缩时明确提示。
- 统一上下文与低层 compact 的消息估算，排除 Responses 重复正文/本地元数据；Responses 缓存/推理 token 不重复计入总量。
- `-p` / `--print`，text/json/stream-json，stdin 文本、resume/fork、追加 prompt，明确的 0/1/2 退出码。
- `config show/set` 输出脱敏；CLI/TUI doctor 能识别 endpointUrl、指定凭据环境变量、CA 文件有效性；仍不是在线握手证明。
- config/mcp/plugin/agents/sessions/responses/print 子命令独立帮助。
- 顶层帮助、凭据提示和 release notes 去除旧品牌文案；兼容层、历史文件名、市场快照等仍有残留，不能称“全仓库清零”。
- GLM 两种已有协议真实流式文本验证成功；Responses 标准路径 404，记录为不支持/未证实，而非成功。

## 未关闭：必须保留的真实边界

1. **企业安全/分发 P0**：OS 级隔离、进程树取消与逃逸测试、专门凭据后端、第三方来源/许可/NOTICE 与重分发授权、兼容层旧品牌彻底整理。UNLICENSED 不代表已经获得第三方再分发许可。
2. **公司接入 P0**：公司 Azure 部署、CA 链、代理、mTLS、Entra 凭据续期和后台 worker 真机矩阵。当前可提供配置和实现，无法用模拟服务器代替企业环境验收。
3. **上下文质量**：真实 tokenizer、多模态精确计数、模型语义摘要、1M 上下文与大型仓库基准。本版是估算和摘录压缩，不承诺零信息损失。
4. **MCP**：独立 GET SSE 常驻、重连续传、server-initiated sampling/elicitation 完整授权、OAuth metadata/PKCE/dynamic registration 和企业服务器矩阵。
5. **自动化协议**：双向 stream-json 输入、参照实现事件完全等价、金额预算/成本定价、无持久化运行、临时 settings/MCP/plugin/Agent/tools 全部 CLI 覆盖层。已有 print 不是对参照 CLI 的完整协议克隆。
6. **多 Agent / Git**：跨 worktree 冲突向导、断电恢复、并发审批压力测试、真实 push/PR 全流程。不会未经授权替用户推送或创建 PR。
7. **Hooks/Skills/插件**：逐 Hook payload/退出码兼容、Skills 完整三态、供应链签名/锁定/回滚、真实团队插件互操作。未把全部已有框架认定为生产验收完成。
8. **IDE/UI**：VS Code 远程开发/多窗口/断线恢复/升级矩阵，自定义主题、语音、浏览器/移动端等体验。新增测试验证指定终端路径，并不是每个菜单的像素级复刻。

本次可安装版本为 0.40.0。完整公司配置与测试明细见 [Responses 接入说明](AZURE-RESPONSES-0.40.zh-CN.md)。

## 最终本地验收（2026-09-22）

- TypeScript check、Node bundle build 通过。
- 完整测试：293 pass / 0 fail，56 个文件，2025 个断言。测试使用独立临时状态目录；Windows 沙箱下两项 Node Hook 路径检查受限，获准在正常宿主环境重跑后全部通过。
- 终端回归：自动压缩后执行真实读文件工具、收到回复、继续下一条消息，session ID 和归档不变；极端不可压缩状态保持可接续，而不是 failed。
- 本地 npm tgz 安装为全局 0.40.0；CMD 中 `ccpt --version` 和真实终端启动/退出通过，保留原来的 GLM 模型选择。
- 未发布公共 npm，未使用真实公司 Azure 凭据验收，未宣称上述剩余事项完成。
