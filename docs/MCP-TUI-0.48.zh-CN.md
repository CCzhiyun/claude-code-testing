# 0.48：在交互终端管理 MCP 通知

日期：2026-10-05。本版在 0.47 的独立 GET/SSE 监听上增加 TUI 任务管理，不自动唤醒模型、不开启反向采样或运行工具。

## 启动与操作

```powershell
npm install -g ./ccpt-0.48.0.tgz
cd D:\your-project
ccpt
```

先按 [0.47 MCP 配置说明](MCP-NOTIFICATIONS-0.47.zh-CN.md) 配置支持 Streamable HTTP 的服务器。在界面中输入：

```text
/mcp
/mcp watch team-events
/mcp watches
```

- `/mcp` 查看配置不连接；Configured 和 Listeners 标签页分别展示服务器与本终端监听记录。
- `/mcp watch <server> [milliseconds]` 显式启动监听，立即返回输入框，继续聊天不受监听阻塞。默认 60 秒，最长 1 小时；例如 `/mcp watch team-events 1800000` 监听 30 分钟。
- `/mcp watches` 查看连接状态和通知计数；Enter 看详情，Ctrl+R 刷新，Esc 返回。
- `/mcp events <id>` 查看脱敏后的最近通知。启动提示或详情中的 `mcpwatch_...` 是任务 ID。
- `/mcp stop <id>` 直接停止；在详情中按 x，再 Enter 确认停止，Esc 取消确认。
- `/tasks` 的 Running/History 标签页也列出监听任务；`/tasks output <id>`、`/tasks stop <id>` 同样可用。
- Ctrl+T 切换紧凑任务面板，显示活动监听状态和通知数；详情列表通过 Ctrl+R 刷新。
- `/exit`、Ctrl+D 或终端正常退出流程会取消监听并等待有界清理。不是脱离终端存活的 worker。

状态包括 connecting、connected、reconnecting、stopping、completed、cancelled、failed。握手或认证失败会记录 failed，可在监听列表/任务 History 中查看错误，不阻塞主对话。

## 配额与配置变化

同一终端最多同时 4 个监听，同一服务器只允许一个活动监听。最多保留 16 个任务记录，每个任务保留最后 100 条通知；旧记录或通知会淘汰，并显示通知淘汰数量。每条展示最多 4000 字符，原始 JSON 超过 8000 字符会以省略标记显示，而不是把大对象遍历/渲染到屏幕。

网络时限、重连、流量、事件上限和不重放工具调用的边界沿用 0.47。监听结束不会自动重启；需要重新输入 watch。

加载后的服务器配置、policy、network（含 CA 配置）或 Hooks 改变时，停止使用旧配置的监听。`/reload` 可加载磁盘上的设置变化；没有后台自动监视 settings 文件。只改变模型不会主动撤销 MCP 连接。每次重新 watch 都从当前配置创建独立快照。

## 数据与安全

通知作为外部数据存于本终端内存缓冲区；不会写入 Agent 的对话消息，也不会仅因收到通知就发送模型请求、执行工具或自动派生 Agent。查看通知后再聊天也不会把通知隐式拼入模型输入。需要模型分析时，应由用户明确选择合适的信息另行提交。

显示沿用敏感字段和已知环境秘密脱敏，并限制长度和控制字符。这不是完整 DLP；业务信息仍可能显示在终端中。已显示文本可留在终端滚动历史、截图或操作系统日志中。退出清理内存任务不等于擦除所有终端历史。

不支持跨进程恢复监听，硬杀进程/断电无法保证发送 DELETE；服务器必须自行处理断连/会话过期。反向 sampling/elicitation 仍明确拒绝，而不是未经确认调用模型或询问凭据。

## 本地验收与未关闭项

新增测试覆盖：并发/重复启动限制、配置快照、权限/CA/Hook/端点变化撤销、关闭前取消握手、失败脱敏、缓冲淘汰、终端按键操作、监听同时聊天、查看通知后聊天不含通知、停止确认和撤销确认、任务列表、reload 撤销、正常退出后的断连和 DELETE。

终端测试使用真实 TUI 输入处理与本地协议服务器，不是公司生产 MCP 验收或全终端兼容证明。

本版关闭的是“终端内显式通知任务管理”，不是“自动通知驱动 Agent 工作流”。仍需后续完成：带授权的事件选择/路由、完整 OAuth metadata/PKCE/dynamic registration、sampling/elicitation 授权、企业服务器与代理/mTLS 实机矩阵。

其他项目仍按 [历史剩余清单](REMAINING-0.41.zh-CN.md) 及后续增量说明跟踪。OS 级隔离、凭据后端、再分发许可、精确 tokenizer/多模态与 1M 基准、Git 冲突/断电恢复等未因此认定完成。
