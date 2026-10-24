# 0.61.0 验证记录（2026-10-18）

这是本机可重复的代码与安装验证，不是九个企业领域的全部生产验收。

## 最终结果

| 检查 | 结果 | 范围 |
| --- | --- | --- |
| `npm run check` | 通过 | strict / exactOptionalPropertyTypes 的源码和测试检查 |
| `npm run build` | 通过 | Node CLI / SDK / MCP 与 Node 声明图；无内嵌公司 CA |
| 最终隔离全量 | **662 pass / 0 fail / 2 skip** | 115 个测试文件、4730 次断言；独立用户状态目录，模型请求使用 fixtures |
| 冻结摘要 | 通过，1410 文件 | src/dist/test/scripts/扩展与明确列出的清单/文档，不包含全部 docs 或 node_modules |
| 实际 Node Goal | 通过 | 原生 Responses loopback；3 请求、实际写文件、人工审批后同 Agent/原会话续行、共享预算、正文历史和显示 Hook |
| 实际 Node 权限边界 | 通过 | 429 后撤销网络权限，无第二次请求；拒绝不支持的临时参数 |
| 实际 Node 恢复 | 通过 | V060-A1-01 直接 recover 修复，不先列 Agents；unknown、0 请求、不重放；并发 claim / 手工 CAS |
| 实际 Node 插件集 | 通过 | 两个签名插件、两代 staging、激活、更新、回滚、完整 platform 加载及签名保留 |
| 实际 npm archive 安装 | 通过 | 临时 prefix、空 cache、offline、实际 npm shim、SDK/工具回传/后台 worker/显式 Chat 适配；7 次 loopback 请求 |
| archive Node 类型与 BPE | 通过 | 实际 tgz 解包，strict Node-only TS、全部传递声明，SDK 运行导出和两种 BPE 编码 |

两项 skip 是当前 Windows 不执行的 **Linux 真机 sandbox 探针**，不是通过。macOS/Linux Keychain/Secret Service 的命令构造和失败关闭用例，不等于对应真机服务验收。

冻结摘要：`45c3befd8aa7b8c74d79c1cf563ead96ca097b33ea8f0d6076ff6ad1c25f9057`。

本地候选 archive：`releases/local-0.61.0-5oqtM6/ccpt-0.61.0.tgz`，13,260,547 字节。

SHA-256：`8d23afe4cebc5d994260d42b20c1c3c54c83d52ace0d780d3be4db94bd32fbef`。

## 发现并修复的问题

- V060-A1-01：Goal 直接恢复在执行者退出后仍认为 active；改为作用域绑定的锁内 PID 核对、Plan 失败及 unknown 收据，不自动重放。
- MCP：续传期间人工审批不能独立于原操作 deadline 无限等待；总 timer 同时撤销审批和传输，补 deadline/cancel 用例，确保不采样、不分享、不重发原工具 POST。
- BPE：空白与非空白连续超长片段都在编码前拒绝；不静默截断、不猜公司部署的编码。
- Windows TUI 测试：第一轮 659 pass / 1 fail / 2 skip 的唯一失败是最终 cleanup `EBUSY`，28 个交互断言已通过。改为校验临时路径后的有界重试，定向与最终全量均通过。第一轮期间还有补充代码修改，**不把它作为最终冻结验收**。

最终定向补测另有 27 pass / 0 fail，非在 662 外重复累加宣称更多独立用例。

## 证据位置与复现

原始日志和 JSON 位于 `.ccpt/implementation-061/`，交付目录 `evidence/` 保留最终全量、Node、恢复、archive、冻结摘要；旧 0.60 候选和历史证据没有被覆盖。

```text
npm run check
npm run build
CCPT_REGRESSION_OUTPUT=.ccpt/implementation-061/full-final bun scripts/regression-isolated.ts
node scripts/validation-snapshot-061.mjs verify
bun scripts/verify-original-061.ts
bun scripts/verify-guards-061.ts
bun scripts/verify-recovery-boundaries-061.ts
bun scripts/verify-plugin-sets-061.ts
npm run verify:package -- releases/local-0.61.0-5oqtM6/ccpt-0.61.0.tgz
bun scripts/verify-packed-types.ts releases/local-0.61.0-5oqtM6/ccpt-0.61.0.tgz
```

环境变量示例按自己的 shell 语法设置。`verify` 仅在与捕获时相同的工作区有效；修改源码/构建后应建立新验证记录，不能把新字节冒充旧摘要。报告脚本没有安装真实 OS 定时任务，也没有改变真实全局 npm。

## 不能据此关闭的项目

仍有代码缺口：Marketplace 自动 overlay 分发、URL/多模态 MCP、可信集中审计/外部不可变锚点、独立身份/硬件凭据隔离、Git ref 自动保留/远程备份、Windows/macOS 沙箱、精确多模态计数、部分 Goal/Hook 全流程等。逐项见 [REMAINING-0.61.zh-CN.md](REMAINING-0.61.zh-CN.md)。

公司 Azure/CA/代理/mTLS/Entra/worker 请求为 **0**；真实 OS/Remote IDE/长期断电/NFS/大仓及真实团队插件矩阵未验收。没有 push、PR、npm 发布。

`docs/third-party/` 补留 npm 元数据 gitHead 对应的 js-tiktoken 上游许可证；包内 ws/base64-js 保留自带许可证。它们不是整个项目的完整 NOTICE 或来源授权。**候选包仅供本机所有者验证；来源/NOTICE/重分发门禁未通过，不能当作已批准企业分发。** 不生成假审批，也不把 UNLICENSED/改名视为授权。
