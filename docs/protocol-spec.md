# todai Protocol Spec

## Overview

Role-based behavioral protocols for AI agents using todai.
Each role defines how an agent interacts with todai during heartbeats, task execution, and task creation.

Goal: an agent only needs `todai protocol show --role <role>` to know how to operate. No per-agent AGENTS.md todai instructions required.

## Concepts

- **Role**: one of `engineer`, `olga`, `kai`, `you` (human proxy)
- **Protocol**: a set of rules for heartbeat, task pickup, completion, creation, and blocked handling
- **Owner**: the todai `--owner` value mapped to each role

## Roles

| Role | Owner | Description |
|------|-------|-------------|
| engineer | engineer | Implements code, tests, docs |
| olga | olga | Org design, review, protocol design |
| kai | kai | Orchestration, daily routines, coordination |
| you | you | Human tasks (reminders, decisions needed) |

## Protocol Rules

### 1. Heartbeat

On heartbeat, every agent MUST:

```
1. Run: todai task list --owner <own-owner> --status open
2. If tasks exist → pick the highest-priority one and start working
3. If no tasks → HEARTBEAT_OK
```

Rules:
- Always filter by own `--owner`. Never pick up another owner's tasks.
- If multiple open tasks, pick by priority (urgent > high > medium > low), then oldest first.
- Do NOT ask for confirmation. Start immediately.

### 2. Task Pickup

When starting a task:

```
1. Read the task title and desc
2. Execute the work to completion
3. Run: todai task done --id <id>
4. Report completion briefly (one message)
```

Rules:
- Complete the task in the same session if possible.
- If the task requires information you don't have, check memory/files/sessions first.
- Do not create sub-tasks unless the work genuinely decomposes into independent pieces.

### 3. Completion

After finishing a task:

```
1. todai task done --id <id>
2. One-line summary of what was done
```

Rules:
- Mark done ONLY when the work is fully complete (code written, config applied, verified).
- "Designed but not implemented" is NOT done unless the task explicitly says "design only".

### 4. Task Creation

Any agent MAY create tasks for any owner when:
- A problem is discovered that another role should handle
- Work naturally decomposes into a piece for another role

```
todai task add --owner <target-owner> --title "..." [--desc "..."] [--priority <p>] [--space <s>] [--label <l> ...]
```

Rules:
- Title must be actionable (verb + object). Bad: "Memory issue". Good: "Fix memory search returning stale results".
- Desc is optional but recommended for non-obvious tasks.
- Don't create tasks for work you can do yourself right now.
- Don't create tasks as "reminders" — use cron for that.

### 5. Blocked Handling

If a task cannot be completed because of a dependency:

```
1. todai task update --id <id> --desc "BLOCKED: <reason>. Original: <original-desc>"
2. If blocked on another role's work, create a task for that role
3. Move on to the next task or HEARTBEAT_OK
```

Rules:
- Do not wait. Either unblock yourself or hand off and move on.
- Re-check blocked tasks on next heartbeat (they remain open).

## Storage

Protocol definitions live at: `TODAI_HOME/config/protocols/`

Files:
- `default.md` — base protocol (this spec)
- `engineer.md` — overrides for engineer role (if any)
- `olga.md` — overrides for olga role (if any)
- `kai.md` — overrides for kai role (if any)
- `you.md` — overrides for you role (if any)

Override files only need to contain sections that differ from default. Missing sections inherit from default.

## CLI Interface

```
todai protocol show [--role <role>]
```

- Without `--role`: shows default protocol
- With `--role`: shows merged protocol (default + role overrides)
- Output: plain text that an agent can follow directly

## Migration Path

1. Deploy this spec as `TODAI_HOME/config/protocols/default.md`
2. Implement `todai protocol show` command (engineer task already created)
3. Replace per-agent HEARTBEAT.md todai instructions with: `todai protocol show --role <role>`
4. Each agent's HEARTBEAT.md becomes: "Run `todai protocol show --role <role>` and follow it"
