# todai (working title)

Self-hosted task management built for AI-agent-first operations.

## Concept

Most existing task tools assume a human-operated UI. todai is designed with **agents as first-class actors**.

- Humans and agents are equal actors
- CLI-first / API-first
- Self-hosted

## Requirements

### Must

- Operable from CLI (directly callable by AI agents)
- Flexible assignee registration (agent and/or human)
- Event-driven execution on changes (task create/state change/due date, etc.)

### Should

- MCP server support (direct calls from Claude Code / Gemini CLI, etc.)
- Webhook-based event notifications
- Web UI (dashboard and progress visibility)
- Integrations (e.g., Apple Reminders via CalDAV)

## Differentiation

- Flat handling of human assignees, agent assignees, or mixed ownership
- Agent execution logs and decision history linked to tasks
- Event-driven command execution for flexible external integrations

## Documentation (for current operations)

To avoid duplication, procedures are consolidated into these three docs:

- [Getting Started (5 Minutes)](docs/getting-started.md)
- [Dogfooding Runbook (Human TUI + Agent CLI)](docs/runbook-dogfooding.md)
- [Ops Runbook (cron / heartbeat / Prometheus / Grafana + rollback)](docs/runbook-ops.md)

## Architecture

```
src/
  index.tsx        — entrypoint (renders Ink App)
  types.ts         — shared type definitions (Task, Store, Owner, etc.)
  store.ts         — store layer (readStore/writeStore, addTask/doneTask/updateTask)
  paths.ts         — path resolution (TODAI_HOME, env overrides)
  triggers.ts      — event trigger system (convention-based scripts)
  cli/
    app.tsx         — CLI command handlers + TUI (Ink/React)
```

## Decision Log

- 2026-02-11: Project started; requirements clarified.
- 2026-02-11: Added Prometheus pull MVP (`todai metrics` + `--textfile`).
- 2026-02-16: Refactored app.tsx — extracted types.ts, store.ts; removed dead code (db/index.ts, archive/schema.ts).
