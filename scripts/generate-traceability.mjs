import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const source = process.argv[2];
const destination = process.argv[3] ?? 'docs/USER-STORY-TRACEABILITY.md';
if (!source) throw new Error('Usage: node scripts/generate-traceability.mjs <user-stories.txt> [output.md]');

const evidence = {
  'US-2.8': ['已实现', '`src/notebooks.ts`, `src/tooling.ts`, `test/notebook.test.ts`：读取、替换、插入、删除并清理代码单元旧输出'],
  'US-2.14': ['部分实现', '`src/tasks.ts`, `src/tooling.ts`：持久任务、依赖、状态更新；自动调度仍待实现'],
  'US-5.1': ['部分实现', '`src/checkpoints.ts`, `src/tooling.ts`：write_file 前自动快照；Shell/IDE 编辑自动捕获仍待实现'],
  'US-5.2': ['已实现', '`src/checkpoints.ts`, `src/cli.ts`, `src/tui.ts`：代码、对话或同时恢复'],
  'US-5.3': ['已实现', '`src/checkpoints.ts`：checkpoint 持久化在用户状态目录，可跨 resume'],
  'US-7.7': ['已实现', '`src/agent.ts`：Skill tools 与 Agent tools 取交集后生成模型工具集'],
  'US-10.14': ['已实现', '`src/agent.ts`：SubagentStart Hook'],
  'US-10.15': ['已实现', '`src/agent.ts`：SubagentStop Hook 覆盖成功与失败'],
  'US-10.16': ['部分实现', '`src/tooling.ts`：模型创建任务时触发 TaskCreated；Agent 自动任务创建 Hook 待统一'],
  'US-10.17': ['已实现', '`src/agent.ts`：任务完成与 Agent 完成同步'],
  'US-10.1': ['部分实现', '`src/types.ts`, `src/hooks.ts`：完整事件类型和多形态执行底座；部分 UI/远程事件发射点待接入'],
  'US-10.2': ['已实现', '`src/agent.ts`, `src/hooks.ts`：SessionStart 可注入 additionalContext'],
  'US-10.3': ['已实现', '`src/cli.ts`, `src/hooks.ts`：Setup 生命周期 Hook'],
  'US-10.6': ['已实现', '`src/tooling.ts`, `src/hooks.ts`：PreToolUse matcher/if、阻断和 updatedInput'],
  'US-10.9': ['已实现', '`src/tooling.ts`, `src/hooks.ts`：PostToolUse Hook'],
  'US-10.10': ['已实现', '`src/agent.ts`, `src/hooks.ts`：PostToolUseFailure Hook'],
  'US-10.11': ['已实现', '`src/agent.ts`, `src/hooks.ts`：PostToolBatch Hook'],
  'US-10.32': ['已实现', '`src/hooks.ts`：command、HTTP、prompt、agent 四种 Hook；HTTP 含 SSRF 防护和环境变量白名单'],
  'US-11.2': ['已实现', '`src/agent.ts`：子 Agent 创建独立 session，teamSessionId 只用于团队归属'],
  'US-4.9': ['已实现', '`src/agent.ts`：fork 模式复制父会话到独立后台 Session，并阻止递归 fork'],
  'US-12.4': ['已实现', '`src/mailbox.ts`, `src/cli.ts`, `src/tui.ts`：可向运行中或持久 Agent 直接发送消息'],
  'US-13.1': ['部分实现', '`src/agent.ts`, `src/mailbox.ts`, `src/tasks.ts`：团队归属、成员发现、共享任务和消息；显示模式与质量门待实现'],
  'US-13.2': ['部分实现', '`src/tasks.ts`：共享持久任务列表、依赖、状态和原子认领；Supervisor 自动调度待实现'],
  'US-13.3': ['已实现', '`src/mailbox.ts`, `src/tooling.ts`：同团队 Agent 间持久直接消息与未读状态'],
  'US-13.7': ['已实现', '`src/tasks.ts`：文件锁保护的原子任务认领、依赖检查和唯一 owner'],
  'US-14.1': ['已实现', '`src/mailbox.ts`：按 teamSessionId 发现全部 Agent 及独立 Session'],
  'US-14.2': ['已实现', '`src/mailbox.ts`：跨 Session 持久消息收件箱'],
  'US-14.3': ['已实现', '`src/mailbox.ts`：mailbox 位于共享状态目录，不依赖 Agent worktree'],
};

const text = await readFile(resolve(source), 'utf8');
const rows = [];
let epic = '';
for (const line of text.split(/\r?\n/)) {
  const epicMatch = line.match(/^# EPIC (\d+) — (.+)$/);
  if (epicMatch) { epic = `EPIC ${epicMatch[1]} — ${epicMatch[2]}`; continue; }
  const story = line.match(/^## (US-\d+\.\d+) — (.+)$/);
  if (!story) continue;
  const [status, implementation] = evidence[story[1]] ?? ['待实现/审计', '尚未登记可执行证据'];
  rows.push(`| ${story[1]} | ${epic.replace(/^EPIC \d+ — /, '')} | ${story[2]} | ${status} | ${implementation} |`);
}

const counts = rows.reduce((result, row) => {
  if (row.includes('| 已实现 |')) result.complete += 1;
  else if (row.includes('| 部分实现 |')) result.partial += 1;
  else result.pending += 1;
  return result;
}, { complete: 0, partial: 0, pending: 0 });

const output = `# 完整 User Story 可追踪矩阵

生成来源：用户提供的 Claude Code Complete Product User Stories（2026-08-28 scope）。本表与旧版 25 项验收矩阵并存，但不把旧矩阵的通过状态外推到新需求。

- User Story 总数：${rows.length}
- 已登记“已实现”：${counts.complete}
- 已登记“部分实现”：${counts.partial}
- 待实现或待逐条审计：${counts.pending}

“待实现/审计”不表示一定完全缺失，而是表示尚未有逐条测试证据，不能宣称完成。每次实现必须同时更新状态、源码证据和测试证据。

| User Story | Epic | 标题 | 状态 | 实现证据与剩余边界 |
|---|---|---|---|---|
${rows.join('\n')}
`;

await writeFile(resolve(destination), output, 'utf8');
process.stdout.write(`Generated ${destination}: ${rows.length} stories\n`);
