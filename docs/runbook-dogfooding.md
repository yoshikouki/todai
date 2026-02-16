# Dogfooding Runbook (Human TUI + Agent CLI)

Use this runbook for daily operation with humans on TUI and agents on CLI.

## 1) Shared Prerequisite

```bash
cd /home/yoshikouki/src/github.com/yoshikouki/todai
```

> If `todai` is not found, run all commands as `bun run src/index.tsx ...`.

## 2) Human Operation (TUI)

```bash
bun run src/index.tsx tui
```

Keys:
- `j/k` or `↑/↓`: move selection
- `a`: add task (`owner` then `title`)
- `x`: mark selected task as done
- `r`: reload
- `q`: quit

## 3) Agent Operation (CLI)

```bash
# Add
bun run src/index.tsx task add --owner engineer --title "triage alerts"

# List open
bun run src/index.tsx task list --owner engineer --status open

# Mark done
bun run src/index.tsx task done --id <id>
```

## 4) Minimal Role Rules

- Human: priority decisions and final completion judgment (TUI)
- Agents: add, triage, and completion reporting (CLI)
- Allowed owners are fixed: `you|kai|olga|engineer`

## 5) Common Blockers

### `todai: command not found`

```bash
# Recommended fallback
bun run src/index.tsx task list
```

### Owner validation error

```bash
# Re-check allowed owners and command format
bun run src/index.tsx help
```

### Cannot run done (missing ID)

```bash
bun run src/index.tsx task list --status open
```

---

## Success Criteria

- Add 1 task in TUI and confirm it from CLI
- Mark done from CLI and confirm it disappears from open tasks in TUI
- Invalid owner returns a clear error message

## Rollback / Recovery

```bash
# Practical rollback: re-add with the same content
bun run src/index.tsx task add --owner <owner> --title "<title>"

# If store is corrupted, move it aside and recreate
mv ~/.todai/tasks.json ~/.todai/tasks.json.bak.$(date +%s) 2>/dev/null || true
bun run src/index.tsx task list
```

> Running `task list` recreates an empty store if missing.
