# 官方全量资料对照与第一批修复交付

日期：2026-10-16。源码目录：`C:\Users\55038\CCPT`。参照 2.1.301；CCPT 本地开发版 0.51.0。已修改并构建源码，未发布 npm，未替换用户全局安装或真实模型设置。

## 结果摘要

- 归档官方公开英文索引中的 **228 个唯一页面**，全部下载成功并有 SHA-256；提取 **5,267 个非代码块 Markdown 标题**。
- 归档完整公开仓库更新日志：**421 个版本、7,863 条条目**，最新 2.1.301。此轮为同一天快照，重试失败页时复用了已校验的更新日志，未假称重新联网获取了第二份。
- 将原来少量主题扩展为 **57 个 User Story 族**，含 Given/When/Then、边界、代码/测试候选和差距。
- 每个文档、标题、更新条目都有稳定 ID 与故事关联。**最新版 51 条已逐条人工分诊；其余 7,812 条历史更新只完成登记和候选关联，尚未逐条验收。**
- 上轮 11 个边界失败已修复。当前边界 **333/333**；新增专项 **10/10**；85 文件隔离回归 **433/433**，同进程全量回归 **433/433**；check/build 通过。
- 真实 Node 终端新增 **17 步**修复验证，另以参照真实二进制 print 验证缺失参数语义。不是只靠 mock TUI 函数断言。

“下载、分诊、实现、测试通过”是四种不同状态。不会把全部资料已下载，写成全部功能已完成。

## 完整清单与资料位置

1. [全产品面 User Stories](./OFFICIAL-PRODUCT-USER-STORIES-2026-10-16.zh-CN.md)：57 个故事族，覆盖 CLI、配置、会话、上下文、规则、记忆、Skills、Agents、Plan、Teams、Agent View、跨会话消息、动态工作流、Worktree、Git、工具、MCP、Hooks、插件、Mods、自动化、SDK、企业安全、模型接入、遥测、终端、IDE、Artifacts、云端与外部系统。
2. [官网功能矩阵与最新版逐条处置](./OFFICIAL-FEATURE-MATRIX-2026-10-16.zh-CN.md)：228 页逐项映射、51 条最新发布逐项差距/验收方向。
3. 本地原始资料：`.ccpt/reference-docs/2026-10-16/`。

归档目录中的文件：

| 文件 | 用途 |
| --- | --- |
| `llms.txt`、`manifest.json` | 官网索引、下载状态、原始/最终 URL、内容类型、哈希 |
| `pages/` | 228 个索引页面的原始响应，绝不执行其中脚本 |
| `official-repository-CHANGELOG.md` | 官方公开完整发布记录 |
| `release-ledger.json` / `.md` | 每条更新独立 ID、版本与原文行号 |
| `traceability.json` | 故事/页面/标题/更新的完整关联及路径存在性 |
| `section-traceability.md` | 每个标题的待验证项，不把代码示例中的标题误当新功能 |
| `all-release-traceability.md` | 全部 7,863 条更新的分诊索引 |
| `page-index.md` | 可浏览的全文归档入口 |

归档范围是官方公开英文索引可达内容及公开仓库更新日志，不是所有语言、登录后知识库或服务端源码。一个索引页面重定向至官方 `claude.com/docs/claude-tag`，保留实际最终 URL 与内容类型。原文只在本地审计目录保存，未假定第三方再分发授权；打包 dry-run 确认原始归档不进入 npm 包。

官方来源：[完整索引](https://code.claude.com/docs/llms.txt)、[发布日志](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)、[Skills](https://code.claude.com/docs/en/skills)、[Subagents](https://code.claude.com/docs/en/sub-agents)、[Memory / Rules](https://code.claude.com/docs/en/memory)。

## 已落地修复

| 项目 | 代码行为与证据 |
| --- | --- |
| Esc 无法取消 | 仅对单独 ESC 的 readline `meta:true` 做归一化，保留 Alt 组合含义。真实 SSE 请求 #1 被 Esc 取消，服务端有取消记录；#2 在原会话继续。 |
| 损坏 frontmatter | 未闭合 header、重复键、危险键、损坏引号明确报错；支持 CRLF/BOM/空 header/EOF 结束符。不是声称实现了完整 YAML 规范。 |
| 引号内逗号 | 字符串列表按引号分组解析，保留实际标量类型，避免把一个参数拆成两项。 |
| 非支持的限制字段 | Skill 的 `disallowed-tools` / `paths` 明确拒绝并说明未执行；不再静默接受。它们不是已确认的官方 Skill 字段，属于 CCPT 加固诊断。 |
| Unicode 退格 | Skill 搜索按 grapheme 删除，覆盖 ZWJ emoji、组合重音与旗帜。 |
| 递归 Agent | 有界递归发现分类目录中的 Markdown/JSON；限制深度/数量，自动扫描不跟随符号链接。 |
| Plan Agent | `permissionMode: plan` 不仅可加载，而且进入实际只读模式；专项模型恶意请求 Write 被拒绝，delegate 不暴露。Library 已能展示 planner。 |
| Skill 跨轮正文 | 正文进入当前用户回合并落盘，下一轮、加载会话、fork 仍保留。工具 ceiling 独立在下一轮结束；没有将 Skill 文本变成永久权限。 |
| Rules 作用域 | 全局和无 paths 规则启动加载，元数据不作为正文；paths 规则在匹配文件工具成功访问后加入上下文，并去重/随历史保留。真实请求 #6 前无规则，#7 工具结果回传后含规则。 |
| Rules 模式安全 | brace 展开有数量/体积边界；glob 用有界状态转移而非可能指数回溯的整条正则；支持常用 `**`、`*`、`?`、字符类、Windows 文件分隔符。非法模式不扩大范围。 |
| 作者限制显示 | 标明 `[author] user-only`，Space/m 不能放宽，给出原因；保存补丁也跳过作者锁定项。 |
| 禁用/模型专用诊断 | 直接调用时分别说明 disabled/model-only 及下一步，不再一律 Unknown command，且不调用模型。 |
| 命名参数 | 支持 `arguments` 字符串/列表的 `$name`；限制前 64 名、每名最多 64 字符；值不递归展开。合并 `when_to_use` 到描述，并按当前文档的 1,536 字符上限裁剪。 |
| 参数展开预算 | Skill 文件、输入及展开有明确的大小上限，重复占位放大时快速拒绝，不无限分配内存。该 CCPT 上限是安全策略，不冒充参照完全相同的内存实现。 |
| 测试环境污染 | `agent-operation.test.ts` 保存并恢复原来的 home/key 环境变量；Windows 测试临时目录清理增加有界重试。全量同进程测试已实跑通过，不再只有进程隔离 workaround。 |

### 修正了一个旧验收预期，而不是放宽测试

新文档规定：缺失的数字/索引占位保留为字面量，命名参数缺失才替换为空。本轮运行真实参照二进制 `/story-echo single`，实际请求含 `First=single. Second=$ARGUMENTS[1].`。据此更新实现和旧边界预期；没有为了绿灯把失败断言删除。相关原生 Messages 请求 #3 与 CCPT Responses 请求 #4/#5 保留在本轮 UI 证据目录。

第一轮没有验证过的完整 shell 引号、动态脚本、环境变量和多 Skill 堆叠，仍单列为待实现/待验收，不因基础参数替换通过而宣称完整兼容。

### Shift+Tab 的定位结果

本轮最小真实 Node PTY 探针显示：测试链路输入 `ESC [ Z` 后，Node 实际收到 `sequence:'\t', shift:false`。因此这条 Windows PTY 路径丢失了 Shift 信息。纯 readline/绑定解析对真正带 Shift 的输入通过；不把传输丢失硬改成“所有 Tab 都切权限”。当前可用 `/plan`，正常终端 Shift+Tab 仍需独立平台矩阵。证据：`evidence/raw-shift-tab-probe.json`。

## 验收产物与复跑

本轮证据：`.ccpt/story-fixes-20261016/evidence/`：

- `boundary-results.json` / `.md`：333 项，当前全部通过。
- `single-process-regression.json` / `.log`：433 项，退出码 0，约 143 秒。
- `pty-fix-steps.json`：17 步真实终端操作片段。
- `raw-shift-tab-probe.json`：真实按键传输差异。

UI 的模型请求、取消和合成会话：`.ccpt/story-fixes-20261016/ui/`。CCPT 首轮 Skill 请求 #4 为 1 个工具，下一轮 #5 为 79 个工具且正文仍在；规则则到 #7 才出现。模型服务仅监听本机，未使用真实 key 或公司 URL。

现有隔离全量结果：`.ccpt/audit-20261016/isolated-regression/summary.json`，85 文件、433 pass / 0 fail。第一次本轮全量检查抓到了旧断言要求的 Project rule 来源标签缺失，已恢复稳定来源标题，未删除该断言。

```powershell
cd C:\Users\55038\CCPT
bun scripts/snapshot-official-reference.ts
# 仅重试失败页：末尾加 --retry-failed；本地校验/重建标题：--reindex
bun scripts/reference-story-catalog.ts
bun scripts/story-boundaries-20261016.ts
bun scripts/regression-isolated.ts
bun scripts/regression-single-process.ts
npm run check
npm run build
```

原始资料会保留来源/哈希，不执行下载内容。`reference-story-catalog.ts` 的关键词关联只是候选分诊；它不会将关联的测试文件当成通过证据。每条故事已检查代码/测试候选路径存在性。

本轮 `npm pack --dry-run --json` 通过：原始参考档案、测试文件和 `.reference` 二进制未进入发布包。**这不代表第三方来源、NOTICE、品牌清理和再分发许可已完成法律/生产验收。**

源码构建后如要更新本机 CLI，可显式执行：

```powershell
npm install -g .
ccpt
```

本轮没有代为执行全局安装或 npm publish，也没有改真实用户 settings/CA/key。

## 未完成项目保持显式

下一批按功能矩阵优先处理：Agent 高级字段与插件作用域、用户/多目录来源策略；完整 Agent View；Teams 执行时计划/质量门与恢复压力；动态脚本工作流；逐 Hook payload/退出码；MCP 独立 SSE/续传/完整双向授权；Mods API/测试；企业接入真机矩阵与 OS 隔离；IDE 远程/多窗口/升级；模型窗口/语义摘要与 1M 基准；历史发布逐条用例。

仍保留明确差异：Skill allowed-tools 为 CCPT 的能力 ceiling，非免审批授权；外部规则 symlink 自动扫描拒绝，尚无完整外部导入批准流程；个人 Skills/Agents 默认来源、local settings 保存、作者以外的插件管理语义和部分按键仍未完整对齐。云端、移动、官方账号/订阅购买等是外部服务/平台能力，不会用一个本地命令假装完成。

所有本轮测试 CLI 与本地模型服务已关闭，合成会话、资料与证据保留，可继续逐项修复。上一轮 11 失败的历史观察见 [初始对照报告](./EXECUTED-STORIES-2026-10-16.zh-CN.md)。
