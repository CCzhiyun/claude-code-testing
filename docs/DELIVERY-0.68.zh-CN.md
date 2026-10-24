# CCPT 0.68 本地验证交付

本轮固定六项代码交付，沿用原 A1–H4 与平台领域，不把六项当作全平台剩余的 50%，不把 loopback/临时仓库称作公司、真实 SSH 或跨 OS 生产验收。测试结果、构建快照、安装验证见随包 VALIDATION 与 evidence。

## 安装、启动

```powershell
npm install --global .\ccpt-0.68.0.tgz
ccpt --version
ccpt
```

配置仍在 `%USERPROFILE%\.ccpt\settings.json`，项目覆盖 `.ccpt/settings.json`。本次没有改个人设置或实际全局安装。此包仅供所有者本地验证；重分发仍需真实来源权利、NOTICE、许可和企业批准。

## 1. MCP sampling 的 required 工具选择

Responses 与 Chat Completions 的统一模型边界支持 `auto`、`none`、`required`，包括 JSON、SSE 和显式 Chat bridge。`required` 原样发送 `tool_choice: "required"`，不转换成提示词。服务端没有返回调用、返回未声明工具，或在 none 下返回工具时拒绝分享结果。空 required 工具列表和 Messages 协议的显式 required 在 HTTP 前拒绝，不自动换部署/协议。

仍需服务端 `samplingBudget.tools=true`、本次 `--interactive-tools`，请求和结果两次人工审批；工具只回传给服务器执行，不执行本地工具或读取当前聊天。原有取消、旧协议协商、请求/token/金额预算继续适用。音频仍明确不支持。

线协议依据 [OpenAI function calling 的 tool choice](https://developers.openai.com/api/docs/guides/function-calling)。兼容网关是否实现此字段，仍要用目标部署验证；不因模型名推定支持。

## 2. 跨 CLI 的本地共享预算

```json
{
  "spending": {
    "account": "team-dev",
    "maxRequests": 100,
    "maxTokens": 5000000,
    "maxCostUsd": 10,
    "prices": {
      "your-deployment": {"inputPerMillion": 1, "outputPerMillion": 4}
    }
  }
}
```

价格只是示例，必须由管理员填写部署实际价格，未配置价格的金额上限会阻止请求。未设置 account 保留原会话行为；设置后同时检查、预留并结算父会话和同一 `CCPT_HOME` 下的命名账户。重启、新会话、MCP sampling、后台 worker 都不能仅靠新会话 ID 重置账户。`--no-session-persistence` 仍将命名账户记在原用户状态目录，只有临时会话账本被清理。

```powershell
ccpt budget account:team-dev
```

多个进程按固定顺序锁定各账本，全部检查通过后才写入预留并请求模型。失败/取消的未知支出保留；只有明确生成前拒绝才释放 token/金额预留，请求次数不退。损坏账本、负数/非法用量、预留过多时拒绝，不自动归零。跨文件写入/断电不是一个事务：中断可能保守多留预留，但不会在未完成全部预留时发送 HTTP，需人工核验。无自动退款/重放命令。

这是本地协作预算，不是企业服务端账务或防同身份管理员篡改机制。更换状态目录、账户或放宽配置需要管理员治理；不宣称跨机器/跨身份全局限额。

## 3. 逐行 MessageDisplay

```json
{"messageDisplay":{"mode":"lines","linesPerBatch":1,"maxBatches":128}}
```

默认 `message` 保留整条消息。lines 模式按完整行批处理，保留 CRLF/换行；一个消息固定 `message_id`，`index` 从零递增，只有末批 `final=true`。`delta` 是该批原文。每批依次执行已有权限/once/Hook 机制，只拼接 displayContent；不改模型历史、工具结果或存档正文。

任一批失败时整条展示回退原文，不留下半条替换；超过 maxBatches 时不执行该消息的展示 Hook，直接用原文。linesPerBatch 1–100、maxBatches 1–256。这不是模型每个 token 的实时展示 Hook，不承诺全部第三方逐字段兼容或无副作用回滚。

## 4. 私有 BPE 词表

```json
{
  "model": {
    "tokenizerVocabulary": {
      "file": "D:\\company-config\\text-vocab.json",
      "sha256": "填入该文件的64位SHA256",
      "patternEncoding": "cl100k_base"
    }
  }
}
```

管理员提供本地 JSON：`{"bpe_ranks":"js-tiktoken 的 packed ranks 字符串","special_tokens":{}}`。仅接受这两项，不接受任意 pat_str/代码/远程加载器；patternEncoding 可选 cl100k_base 或 o200k_base 的内置正则。必须覆盖 256 个基础字节、rank/token 唯一，最多 500000 tokens、16 MiB 文件。路径不可经过链接。每次计数先重读校验摘要，再使用缓存，故同大小替换也被拒绝。

此配置优先于 tokenizer，若私有模型的预切分正则不同，不应使用这个适配器假装精确。不会打包私有词表；不承诺与指定模型完全等价、图片/音频精确计数、计费准确或摘要零损失。

## 5. 可配置上下文 framing 预留

```json
{"model":{"contextFraming":{"baseTokens":32,"perMessageTokens":6,"perToolTokens":12}}}
```

数值仅为示例。额外预留 = base + 每消息 × 消息数 + 每工具 × 工具数，叠加在现有序列化文本计数之上。三项为 0–1000000 整数，参与 90% 提醒、超过 95% 自动 compact 和压缩预算；`/context` 显示额外预留、词表摘要。不会用累计账单 token 当上下文占用，不会因为达到阈值关闭会话或截断当前轮。

这是管理员按真实提供方用量校准的保守余量，不是宣称精确协议 token。原始会话/归档保留；没有可压缩旧完整轮时明确提示，不丢弃当前输入。

## 6. 受控 SSH 恢复备份入口

```json
{
  "recoveryRemote": {
    "remote": "team-backup",
    "expectedUrl": "ssh://git@backup.example/recovery.git",
    "transport": "ssh-wrapper"
  },
  "policy": {"allowGitPush":true,"allowNetwork":true,"processWrapper":"D:\\company-config\\enterprise-launcher.exe"},
  "network": {"allowedHosts":["backup.example"]}
}
```

只接受显式 ssh:// URL，不猜测 scp 风格地址。用户、文字仓库路径、允许主机、绝对非链接 launcher 都必须明确。准备收据绑定 URL、精确源/目标 ref、wrapper 路径及 SHA-256；执行/查询在启动 launcher 前重新核对 wrapper。修改 launcher 后旧审批失效，应重新准备，不能沿用旧摘要。

```powershell
ccpt agents recovery-remote prepare --confirm
ccpt agents recovery-remote run backup_ID --expected-digest REVIEW_SHA256 --confirm
ccpt agents recovery-remote query backup_ID --confirm
```

沿用已有 Hooks/命令权限/审计、目标不存在核验、atomic Git push、unknown 后仅查询不重放。企业 launcher 必须自己执行严格 host-key 校验、专用凭据、禁止交互、网络/SSH 配置与 Git URL rewrite 管控。此功能不是内置 SSH 凭据或 host-key 管理器，也不提供完整 launcher 依赖图签名/OS 隔离。测试 launcher 仅把精确 fixture SSH URL 改到自有本地 bare 仓库，验证了真实子进程/receipt/Git 操作，不是实际 SSH 网络验收。

## 沿用与未完成

0.67 的 outbox、插件迁移、分组 Hooks、冲突撤回及此前能力保留。原清单的剩余项没有删除；详见 [REMAINING-0.68.zh-CN.md](REMAINING-0.68.zh-CN.md)。公司 API 请求为 0；不注册真实 OS 任务、不发布 registry、不执行业务 push/PR、不自动采用旧审批。
