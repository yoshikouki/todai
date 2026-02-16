# Getting Started (5 Minutes)

This is the fastest path to run `task add/list/done` and `metrics --textfile` in about 5 minutes.

## 0) Prerequisites (30 sec)

```bash
cd /home/yoshikouki/src/github.com/yoshikouki/todai
bun --version
```

## 1) Startup Check (1 min)

```bash
# Use bun directly first (most reliable)
bun run src/index.tsx help
```

> If you see `todai: command not found`, installation/linking is not ready yet. Use **`bun run src/index.tsx ...`** for now.

## 2) Task Operations (2 min)

```bash
# Add
bun run src/index.tsx task add --owner you --title "first task"

# List
bun run src/index.tsx task list --owner you --status open

# Mark done (<id> comes from add/list output)
bun run src/index.tsx task done --id <id>
```

## 3) Metrics Output (1 min)

```bash
# Print to stdout
bun run src/index.tsx metrics

# Write to textfile (atomic rename)
mkdir -p ./tmp
bun run src/index.tsx metrics --textfile ./tmp/todai.prom
```

## 4) TUI Check (30 sec)

```bash
bun run src/index.tsx tui
# press q to quit
```

---

## Success Criteria

- `task list --status open` / `done` output looks correct
- `./tmp/todai.prom` exists and includes `todai_tasks_total`
- TUI opens and exits with `q`

## Rollback / Recovery

```bash
# Reset local data (only when needed)
rm -f ~/.todai/tasks.json

# Remove textfile
rm -f ./tmp/todai.prom
```

> To test in isolation, set `TODAI_TASKS_PATH=/tmp/todai-test.json`.
