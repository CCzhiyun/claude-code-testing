# CCPT 0.72.0：Responses 压缩后续聊修复

本地所有者验证包，未发布 npm；第三方再分发仍需完成来源/许可审批。本包不包含用户 settings、API Key、公司 CA 或私钥，也不自动修改全局安装。

## 安装

```powershell
npm install -g "本交付目录的完整路径\ccpt-0.72.0.tgz"
ccpt --version
cd D:\project\ccpt-cli
ccpt
```

版本应为 `0.72.0`。退出并重新启动旧进程；若仍显示旧版本，PowerShell 用 `Get-Command ccpt -All`、CMD 用 `where ccpt` 检查 PATH。安装后在任何项目目录都能启动，无需每个目录重复安装。

默认用户配置：`%USERPROFILE%\.ccpt\settings.json`。项目 `.ccpt\settings.json` 覆盖用户配置，`CCPT_HOME`/`--state-home` 改变用户状态目录。保留自己现有 URL/部署名/API Key/CA；公司 Chat 和 Responses 应分别配置，不能只换协议名称却保留另一套端点。随包 config-templates 只作字段参考，不含可用凭据。

## 本版修复

- 手动/自动 extractive compact、semantic 摘要替换、compactMessages 路径，保持未经修改的保留轮次中的原生 reasoning、function_call、function_call_output 和 call_id。
- 压缩前先验证旧历史绑定，只为顺序及对象均未改变的完整后缀重建本地绑定；不为先前已编辑/失效的数据授信。
- 压缩后废弃旧 previous_response_id，通过原生完整项目回放；新请求成功后的 ID 才可用于后续增量会话。
- 不修改归档/原始 provider 输出、不放宽跨端点/凭据/部署的作用域验证。任意手工改写历史仍会让旧 marker 失效。
- 保留 0.71 的 token 子集统计、90% 提醒、超过 95% 自动压缩和有界错误诊断。不保证摘要零信息损失。

## 查日志

```text
Ctrl+O
/doctor errors 20
/doctor export diagnostics.json
```

终端外：

```powershell
ccpt doctor errors --limit 20
ccpt doctor export diagnostics.json
```

模型错误默认在 `%USERPROFILE%\.ccpt\diagnostics\model-errors.json`，最近最多 100 条/4 MiB；保留脱敏 code、param、message、requestId 和有界堆栈。只记录新版最终模型失败，不是全部进程日志、每次重试或旧版历史。读取为空不证明旧运行没有错误。Agent 记录位于 `agents\agent_*.json`；`agents-runtime` 存储 worker 配置，不应当作错误日志发送。诊断导出前仍应人工复核业务敏感信息。

## 上下文与验证边界

maxContextTokens 必须符合真实部署上限；配置为 1M 不等于服务端支持 1M。未启用准确 tokenizer/服务端计数时，当前上下文仍为估算；服务端 usage 与累计消耗是另一类数字。reasoning 是输出 token 子集，不重复相加。

0.71 的当前 GLM 原生 Responses 普通聊天、多轮、工具回传、流式/取消已经实测；不自动等同于 0.72 的新实测。0.72 的验证结果和测试范围见随包 VALIDATION/evidence。公司 Azure、CA/代理/mTLS、真实长会话/1M 质量和跨 OS 环境未因本修复自动通过。
