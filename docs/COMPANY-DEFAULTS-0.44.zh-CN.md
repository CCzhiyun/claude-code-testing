# 公司同事默认使用 gpt-6-luna

版本：0.44.0；日期：2026-09-28。

## 先明确默认值的来源

npm 安装程序不会复制开发者电脑上的 settings、GLM 密钥或公司 CA。0.44 移除了启动时写入 GLM 地址及旧模型别名的逻辑，并且不再往已有 settings 里补这些字段。已有配置原样保留，不自动迁移到另一服务。

公司默认值应设置为一套完整连接：Responses 协议 + 公司完整 endpointUrl + 部署名 gpt-6-luna + 认证环境变量 + CA。只执行 `/model gpt-6-luna` 不会把旧的 GLM 地址改成公司地址。

`gpt-6-luna` 在这里是用户指定的公司部署名；必须由公司管理员确认网关接受这个名称，并不据此声明任何公共服务模型的可用性。

## 方法一：每个同事执行一次初始化命令

以下为 CMD 示例，将 COMPANY_RESPONSES_URL 换成管理员确认的完整 Responses URL（不是 Chat URL，也不是网页文档地址）：

```cmd
npm install -g .\ccpt-0.44.0.tgz
set "COMPANY_RESPONSES_URL=https://your-company-gateway/responses/v1/responses"
ccpt config set --global --api-preset azure-responses --endpoint-url "%COMPANY_RESPONSES_URL%" --model gpt-6-luna --api-key-env AZURE_OPENAI_API_KEY --api-key-header api-key --marketplace disabled
ccpt config set --global --ca-file "C:\company\certs\ca.pem"
ccpt
```

认证头 api-key 是示例。如果公司要求 Bearer，使用 `--api-key-header authorization --api-key-prefix "Bearer "`。密钥由公司认可方式注入 AZURE_OPENAI_API_KEY，不写入分发模板。上面 `set` 设置的 URL 仅用于当前 CMD 的初始化，实际连接配置已由 config set 写入用户 settings；CA 路径必须在同事电脑上存在。

配置默认保存到 `%USERPROFILE%\.ccpt\settings.json`；设置 CCPT_HOME 时使用该目录。以后每次只输入 `ccpt` 即可沿用，不必每次选择模型。项目 settings 和企业托管策略可以覆盖用户默认值，--global 不会强行覆盖这些策略。

## 方法二：管理员分发配置文件

复制 [Responses 示例](company-responses.settings.example.json)，其中 name 已改为 gpt-6-luna。管理员确认 URL、认证头、上下文/输出限制后，按机器填写 CA 路径；不要把示例上下文数值当作已验收规格。示例的 tss 地址来自用户早前截图，不保证适用于所有公司部署。

新机器可将审核后的文件部署为用户 settings。已有 settings 应先备份并有选择地合并，不能无提示覆盖同事配置。

也可不修改默认配置，显式启动：

```cmd
ccpt --settings C:\company\ccpt-responses.json
```

这个 --settings 只对本次进程有效，不会把它永久设置成默认。需要组织强制策略时，使用已有的企业 managed settings 分发机制，而不是在通用 npm 包里硬编码内网地址或凭据。

## 验收

```cmd
ccpt --version
ccpt doctor
ccpt model test --stream --full-tools-check --diagnostics --timeout 60000
```

确认版本 0.44.0、模型 gpt-6-luna、协议 responses、公司目的地址。doctor 的配置检查不是认证连通性证明；model test 会发付费请求并执行限定 echo 往返测试。进一步真实文件工具/多轮/取消测试见 [公司验收步骤](COMPANY-ACCEPTANCE-0.43.zh-CN.md)。
