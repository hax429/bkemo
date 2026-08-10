# Agent navigation

This file is an index, not a duplicate project guide. Read the document that
matches the work before changing the repository:

- [`docs/agents/PROJECT.md`](docs/agents/PROJECT.md) — what bkemo is, current
  product behavior, architecture, data model, and local engineering conventions.
- [`docs/agents/UI.md`](docs/agents/UI.md) — design tokens, `.bkemo` theme scope,
  AI shell / dialog patterns, and what to avoid when changing UI.
- [`docs/agents/DEPLOYMENT.md`](docs/agents/DEPLOYMENT.md) — local test workflow,
  production topology, deployment approval gate, release steps, and verification.
- [`docs/agents/MCP.md`](docs/agents/MCP.md) — current inbound MCP/OAuth contract,
  outbound connector policy, configuration, and verification.
- [`docs/agents/OBSIDIAN.md`](docs/agents/OBSIDIAN.md) — Obsidian pairing and
  `/api/v1/obsidian/*` contract. Plugin sources: [hax429/como](https://github.com/hax429/como).
- [`docs/plans/README.md`](docs/plans/README.md) — potential integration roadmap,
  including MCP hardening, Obsidian sync, and later connectors.
- [`docs/plans/IOS.md`](docs/plans/IOS.md) — future iOS native, offline, OTA,
  build, and release work.
- [`docs/plans/mac.md`](docs/plans/mac.md) — macOS Tauri shell; ⌃W → quicknote
  capture.
- [`docs/plans/MCP.md`](docs/plans/MCP.md) — historical MCP server design context.
- [`docs/plans/bkemo-ai-and-discovery-implementation.md`](docs/plans/bkemo-ai-and-discovery-implementation.md)
  — AI chat and discovery implementation plan.
- [`docs/plans/PARSING.md`](docs/plans/PARSING.md) — proposed deterministic
  attachment parsing into editable Markdown.

Schedule Task (Settings → System) is documented in PROJECT.md: pinned
auto-archive and scheduled `.bk` backups via pg-boss. AI automations and custom
scripts on that page are deferred.

Treat `docs/agents/` as current project memory. Treat `docs/plans/` as proposed
or unfinished feature work (including the integration roadmap). Verify every
plan against the source before assuming it exists.
Do not commit, push, connect to production, or deploy until the user explicitly
authorizes that action.
