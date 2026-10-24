# 0.72 验证范围

日期：2026-10-22。源码目录：`D:\project\CCPT`。

## 已完成的针对性验证

- TypeScript `npm run check` 退出码 0。
- `npm run build` 退出码 0；471 modules；生成 Node CLI、SDK、MCP 与类型声明；没有嵌入公司 CA。
- Responses 新增六项回归：stateless/stored 压缩、连续两次工具调用、摘要替换后再续聊、无效旧绑定/跨部署拒绝、不修改原始记录及旧 compactMessages 路径。与 Responses/semantic 原有回归合跑：22 pass / 0 fail / 174 assertions。
- GLM 真实原生 Responses：两次付费请求，第一次工具调用后压缩历史，第二次接收工具结果并准确回答。当前轮一项原生 reasoning 与全部 provider output 原样保留；旧 previous_response_id 不复用。输入 usage 从首请求 3464 降至续聊请求 297，输出分别 50 / 28；不能据此推断所有长会话或 1M 质量。
- GLM 实测使用编译 SDK 的请求/响应层与源码 compactSession；安装包另作隔离 npm 安装、CLI/worker/SDK loopback 验证，不能把两者混称为已经使用安装包访问公司接口。

## 全量与交付证据

隔离全量回归由 `scripts/regression-isolated.ts` 执行，每个文件独立进程/状态目录。最终数字、逐文件日志、安装包验证和 SHA-256 见交付目录的 VALIDATION.zh-CN.md、evidence 与 DELIVERY.json；不沿用 0.71 的测试数字。

`scripts/validation-snapshot-072.mjs capture|verify` 绑定 1544 个产品源文件、测试、脚本、产物、清单及本版安装说明。快照摘要：`6bea5c2c4ff3dc08fa6351ddb9bbfa9baee812ef05c98ca892bcf4a923bb3fec`。本验证说明不在快照枚举中；最终 tgz 自身哈希以交付收据为准。

- CLI SHA-256：`3ec43c1f823c51f0b60351297eab8940c0c25466923d050a8210c68f7fdd92ec`
- SDK SHA-256：`875cc21b7445ad40c78398679ce3b4b8cca94d28bc1c3e508fd615c29f6aa9b5`
- 用户和项目 settings 摘要仍为 `544af0098c20fe997d72ef3689b03e8553317f8da3f94e3cef71f2bd35e03a4b`，未改动 URL/模型/Key/CA 或用户真实全局安装。

## 未由本版验收的范围

公司 Azure 请求为 0；公司 CA/代理/mTLS/Entra、跨 OS/远程 IDE、长期故障、1M 上下文质量、真实 push/PR、来源权利及再分发审批不由本修复替代。Windows 上跳过的 Linux 沙箱测试不计为验收通过。模型错误日志是有界脱敏诊断，不是所有过程的无损历史。
