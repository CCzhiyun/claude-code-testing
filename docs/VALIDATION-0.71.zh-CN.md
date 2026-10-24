# 0.71 本地验证记录

日期：2026-10-22。源码 `D:\project\CCPT`；版本 `0.71.0`。

## 最终验证

- `npm run check`：退出码 0。
- `npm run build`：退出码 0，470 modules，CLI、SDK、MCP 与 SDK 类型声明生成；不嵌入公司 CA。
- 最终隔离全量回归：148 个测试文件，**857 pass / 0 fail / 2 skip / 5728 assertions**。
- 两项 skip 是当前 Windows 上不能执行的 Linux 沙箱测试，不视为已经验收。
- 最终全量原始证据：`.ccpt/implementation-071/regression-verified/summary.json` 及同目录逐文件日志。早期失败日志保留在 `regression-initial`，没有覆盖成通过。
- 首轮出现的 Responses usage 断言需要增加新保留的 reasoning 子集；更新后 JSON/流式分支均通过。另一个失败是测试结束后 Windows 临时 cwd 的 EBUSY；改用已有的有界临时目录清理助手，保留所有产品交互断言，最终重跑通过。

## 本轮重点

- Responses/Chat 的 reasoning usage 子集与零值，不重复累加缓存、reasoning。
- QueryEngine 与 TPM 节流使用当前作用域有效的服务端输入计数；改变 system/部署后的旧计数不能绕过本地检查。
- 显式 tokenizer 的输出估算、密集文本子进程计数与同编码结果一致。
- 90% / 95% 边界，压缩后原始消息完整归档，当前轮次保留。
- 嵌套及字符串网关错误的 code/param/message/request-id 保留与脱敏；Chat 工具+推理不兼容的提示与显式 none 路径。
- 有界持久诊断、脱敏、无持久化模式不写日志、损坏日志不覆盖且不掩盖原始错误。
- 实际 raw-key TUI 的 `/doctor errors`、导出、非法 limit 后继续操作；已有上下文溢出恢复、Agent/MCP/审批/会话回归。

## 构建绑定

`scripts/validation-snapshot-071.mjs capture|verify` 校验其列出的 1540 个源文件、测试、脚本、产物、扩展、清单及本版安装说明。完整清单见 `.ccpt/implementation-071/source-snapshot.json`。

- Snapshot SHA-256：`8736dfb5651ae82af08cf94e6d3b248acec84cf0719f9055e60304fdcd8fbfe5`
- `dist/cli.js`：`4b7864d6b95f182a78028d6f9decbe44bc38199362fb7d975847ee098d071d01`
- `dist/entrypoints/sdk.js`：`614d3e24ff71842e77944c507c73837f3471e0df10342d890f800ea1bb54a5b1`
- 用户与工作项目 settings 的 SHA-256 均仍为 `544af0098c20fe997d72ef3689b03e8553317f8da3f94e3cef71f2bd35e03a4b`；本轮未修改其内容，未做真实公司/GLM 模型请求。

本文件不在上述快照枚举中，包哈希以交付目录 `SHA256SUMS.txt` / `DELIVERY.json` 为准。安装包核验另有安装后收据，不把源码测试等同于安装后验证。

## 边界

测试模型请求均为本地 fixture。公司 Azure、CA/代理/mTLS/Entra、GLM 当前服务能力、长期运行及其他操作系统实机未由这些测试验收。历史错误无法凭空补录；新日志最多 100 条、4 MiB，不是原始请求/响应抓包或无限历史。

提供方 usage 与 reasoning 的子集语义参考 [OpenAI reasoning 指南](https://developers.openai.com/api/docs/guides/reasoning)，可选准备输入计数参考 [OpenAI token counting 指南](https://developers.openai.com/api/docs/guides/token-counting)。特定公司网关的支持范围仍以其部署实测为准。

真实来源权利、NOTICE 与再分发审批仍不由本轮验证替代。只生成本地所有者验证包，不发布 npm、不 push、不创建 PR。
