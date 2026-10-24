# CCPT Architecture

## Runtime flow

```text
CLI / Full-screen UI / IDE bridge
              │
              ▼
       Platform registry
  ┌───────────┼────────────┐
  │           │            │
Plugins     Project      User-wide
  │       extensions    extensions
  ├── Commands
  ├── Agents ───────┐
  ├── Skills        │
  ├── Hooks         ▼
  └── MCP       Agent runtime
                    │
           Policy + Tool boundary
                    │
        Files / Commands / MCP / Git
```

The registry is rebuilt on startup and `/reload`. It validates manifests, keeps deterministic precedence, namespaces Plugin components, merges declarative contributions, and returns diagnostics. Agent execution receives the resolved registry instead of reading unrelated directories independently.

## Source map

| File | Responsibility |
|---|---|
| `src/cli.ts` | npm executable entry, non-interactive commands, scaffolding, workflows and bridges. |
| `src/tui.ts` | Full-screen terminal rendering, input editor, command palette, chat history and dynamic extension commands. |
| `src/platform.ts` | Central extension registry; merges Plugin, Skill, Agent, Hook, MCP and command contributions. |
| `src/plugins.ts` | Plugin manifest contract, path/symlink safety, SHA-256 integrity, enable/disable, validation and local installation. |
| `src/skills.ts` | Skill discovery, metadata parsing and task/profile-based activation. |
| `src/agents.ts` | Agent Markdown/JSON parsing and per-Agent runtime settings. |
| `src/frontmatter.ts` | Dependency-free frontmatter parser used by Agent and Skill documents. |
| `src/scaffold.ts` | Team-facing generators for platform layout, Skills, Agents, Plugins, schema and MCP servers. |
| `src/agent.ts` | Agent lifecycle, bounded delegation, background workers, profile resolution and model/tool loop. |
| `src/tooling.ts` | Model-visible tools for files, search, commands, memory, delegation, MCP and user questions. |
| `src/model.ts` | Tool-calling chat adapter for local, hosted, and enterprise-compatible model endpoints. |
| `src/network.ts` | Proxy, custom CA, TLS validation, mTLS, timeout and loopback-aware HTTP transport. |
| `src/context.ts` | Bounded repository map and architecture/document context collection. |
| `src/mcp.ts` | stdio/HTTP MCP client, authentication storage, notifications, discovery and tool calls. |
| `src/hooks.ts` | Lifecycle Hook dispatch with allowlist, timeout, payload redaction and audit integration. |
| `src/policy.ts` | Workspace boundaries, protected paths, command authorization and controlled process execution. |
| `src/environment.ts` | Credential filtering for child processes. |
| `src/config.ts` | Global, project and managed configuration merge with deterministic extension paths. |
| `src/sessions.ts` | Persistent conversations, resume/fork and context compaction. |
| `src/memory.ts` | Durable scoped engineering knowledge. |
| `src/worktree.ts` | Managed Git Worktree isolation, commit/merge/cleanup and lifecycle Hooks. |
| `src/workflow.ts` | Dependency-aware deterministic multi-Agent workflow execution. |
| `src/ide.ts` | JSON-RPC bridge for chat, sessions, background Agents and editor context. |
| `src/ide-install.ts` | Installs the bundled VS Code extension from the npm package. |
| `src/audit.ts` | Append-only daily JSONL audit records. |
| `src/storage.ts` | Atomic private JSON persistence, identifiers, and cross-worker state reservation locks. |
| `src/paths.ts` | State directories and workspace path containment. |
| `src/types.ts` | Shared runtime and configuration contracts. |

## Trust model

Plugins are data, not in-process executable modules. Their paths remain inside the Plugin root, symbolic links are rejected, and optional integrity digests detect changes. Any process they request must enter through MCP or Hooks, where permission mode, command allowlists, network policy, environment filtering and auditing apply. Agent tool lists can only reduce the platform tool surface; enterprise managed configuration remains the final authority.

## Extension precedence

1. Project components.
2. Explicitly configured directories.
3. User-wide components.

The first valid direct component wins. Plugin Agent and Skill identities are namespaced as `plugin:component`. Slash-command collisions are reported and the first valid registration wins.
