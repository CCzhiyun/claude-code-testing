# CCPT 0.65：提交后事件恢复、插件更新审阅、外部审计锚定

源码 `D:\project\CCPT`。本批补三组可验证代码，不改变既有剩余清单的分母，不将模拟用例称为企业环境验收。测试数量、构建与真实 Node 进程结果见候选包旁 VALIDATION/evidence。

## 安装、模型与 CA

本地所有者验证包（不是已批准的企业再分发包）：

```powershell
npm install --global .\ccpt-0.65.0.tgz
ccpt --version
ccpt
```

不自动覆盖全局安装或个人 settings。公司同事在完成分发权利审批后再安装。用户配置仍为 `%USERPROFILE%\.ccpt\settings.json`，使用附带三份 config-templates 选择 Responses / Chat Completions / Messages；实际部署名、完整端点、认证和 CA 由公司填写。API key 不放源码/压缩包，优先凭据后端或环境变量。CA 可用 network.caFile / NODE_EXTRA_CA_CERTS；保留 TLS 校验。不要把客户端私钥打包。已有配置说明见 PRODUCT-GUIDE.zh-CN.md。

## 1. Plan 与通知的提交后 outbox

Plan index 和 notification envelope 将状态与元数据 intent 放在同一次原子文件替换中。只有提交后才发布事件，日志损坏不会把已经成功的批准伪装成可重试失败。投递失败时保留 intent；恢复不运行模型、不重放工具，也不授予审批。

```powershell
ccpt event-outbox recover --cwd D:\your-project
```

IDE `project/events` 自动补发；`project/outbox-recover` 可显式重试。每个 producer 的 generation/sequence 检查点随事件日志一起写入。进程在“发布成功、尚未确认”之间退出，重新投递不会重复入日志。错代恢复、序号缺口、损坏队列被拒绝，CLI 返回逐 producer 诊断；IDE 桥接只在失败集合变化时发通知。

每 producer 最多 256 条待投递；队列满后在业务修改前施加背压，绝不丢掉未投递事件换空间。事件环仍是 1024 条，超出保留期的消费者必须刷新快照。通知仍只保留 500 条。Plan Markdown 是派生展示文件，不与 index 构成跨文件事务。原子 rename 不代表 fsync/断电/NFS 全局原子性。

旧通知数组在下一次修改时迁移到 format=1 envelope；读取仍支持旧数组。不要在同一状态目录混用旧版本写入，也不要删除 outbox generation 来“修复”恢复错误。本版只将 Plan/通知接为提交后 producer，其余 topic、完整聊天/delta 与无限历史尚未完成。

## 2. 整组插件更新与签名中断恢复

先用既有 stage / stage-marketplace 明确选择全部插件，再审阅完整更新：

```powershell
ccpt plugin-set stage-marketplace --json '["plugin-a@catalog","plugin-b@catalog"]' --confirm
ccpt plugin-set preview pluginset_ID
ccpt plugin-set apply pluginset_ID --expected-digest REVIEW_SHA256 --confirm
ccpt plugin-set inventory
```

preview 显示新增/删除、版本、artifactChanged 和 overlayChanged，覆盖“只有团队 overlay 变化、发布者字节不变”的情况。reviewDigest 同时绑定活动 pointer、候选 receipt、差异和完整有效配置摘要。apply 在维护锁内重新验证；另一个窗口已切换、授权/配置变化或候选被改动都使旧审阅失效。仍用单 pointer 原子选择 artifact+receipt+overlay，不执行插件代码，不自动后台下载/激活。

安装中断留下 `.pending-*` 时，inventory 只把完整 receipt、完整 artifact、当前可信发布者签名和有效 overlay 都通过的条目标为 recoverable：

```powershell
ccpt plugin-set recover .pending-NAME --expected-digest INVENTORY_REVIEW_SHA256 --confirm
```

恢复只将经过重新验证的目录改名为候选 generation，不激活、不覆盖同名目标。未完成、无签名、撤销密钥、错误 receipt/链接均保留供人工核查；不自动删除证据、不自动认领未知来源。签名证明受信 key 签过对应字节，不证明法律再分发许可或原安装人的业务意图。旧单插件历史迁移、跨机器团队矩阵、自动更新分发策略仍不算完成。

## 3. 独立收集端的审计签名锚定

先启用本地 HMAC 链（管理员独立管理至少 32-byte hex 密钥），再配置独立收集端：

```json
{
  "url": "https://approved-audit.example/ccpt",
  "stream": "team-workstation-unique-id",
  "keyId": "collector",
  "publicKey": "-----BEGIN PUBLIC KEY-----\nADMINISTRATOR_PINNED_ED25519_PUBLIC_KEY\n-----END PUBLIC KEY-----",
  "tokenEnv": "COMPANY_AUDIT_TOKEN"
}
```

这是配置模板，公钥占位符不能直接运行。不同机器/审计 home 必须使用不同 stream；同一 stream/day 只能继续同一历史。collector 配置不含明文 token，发布必须显式确认、工作区可信、允许网络且 TLS 校验开启；沿用公司 CA/代理/mTLS 网络设置。配置里的 allowLoopbackHttp 仅供显式本机开发测试，不能放行企业 HTTP。

```powershell
$env:CCPT_AUDIT_INTEGRITY='required'
# HMAC key 与 COMPANY_AUDIT_TOKEN 从公司秘密管理器注入，不写命令历史。
ccpt audit-checkpoint publish --collector-file .\collector.json --day 2026-10-19 --confirm
ccpt audit-checkpoint query --collector-file .\collector.json --day 2026-10-19 --confirm
```

仅上传经本地 HMAC 校验的序号/MAC 前缀，不传提示词、审计正文或 HMAC 密钥。收集端对已锚定前缀拒绝截断/分叉，稳定请求摘要实现重复发布去重，并返回带域分离的 Ed25519 签名回执。客户端固定公钥/stream/day 验签，再对本地当前链检查。POST 超时或 5xx 不自动重发；先 query 核对未知结果。已保留回执的远端降级/丢失也不会静默接受。

SDK 提供 `acceptAuditCheckpoint` / `readCollectorCheckpoint` 存储原语和 `syncAuditCheckpoint` 客户端。`docs/examples/audit-collector.mjs` 是可运行的本机 HTTP 参考实现（需要本地 npm install ccpt 后解析 SDK）：在另一台受信服务器上配置独立 token、签名私钥文件、存储路径和允许的 stream，经管理员管理的 HTTPS 反向代理暴露。参考实现自身只监听 loopback，有认证、stream allowlist、请求/并发/时间边界。必须自行完成服务部署、访问控制、备份、密钥轮换与防删除存储。

此实现是防篡改证据/外部签名锚定，不是 WORM、硬件密钥隔离或合规认证；拥有收集端密钥和存储管理员权限的人不在该信任模型内。正文集中归档、密钥硬件隔离、企业收集器真机矩阵仍需后续工作。现有每日 10k/8MB 链边界未扩大，不自动清理证据。
