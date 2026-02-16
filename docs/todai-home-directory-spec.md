# TODAI_HOME Directory Spec

## Purpose
Define a single root directory layout for todai runtime/config/state files.

## Root resolution
- Primary: `TODAI_HOME`
- Fallback: `~/.todai`

## Directory layout
Under `TODAI_HOME`:

- `config/`
- `data/`
- `logs/`
- `run/`
- `metrics/`
- `tmp/`

## Standard file paths
- `config/config.toml`
- `data/tasks.json`
- `logs/todai.log`
- `run/heartbeat.ts`
- `metrics/todai.prom`

## Path priority rules
For each resolved path:
1. Specific env var (highest)
2. `TODAI_HOME`-derived path
3. Default path

Examples of specific env vars:
- `TODAI_TASKS_PATH`
- `TODAI_CONFIG_PATH`
- `TODAI_LOG_PATH`
- `TODAI_HEARTBEAT_PATH`
- `TODAI_METRICS_PATH`
- `TODAI_CONFIG_DIR`
- `TODAI_DATA_DIR`
- `TODAI_LOGS_DIR`
- `TODAI_RUN_DIR`
- `TODAI_METRICS_DIR`
- `TODAI_TMP_DIR`

## Backward compatibility
If tasks are found at legacy path `~/.todai/tasks.json` and new path `~/.todai/data/tasks.json` is missing, todai migrates once on read.

Migration is skipped when `TODAI_TASKS_PATH` is explicitly set.

## Doctor output expectations
`todai doctor` should report:
- resolved value
- source annotation (`default` / `derived` / `env:VAR`)
- existence check (`✓` / `✗`)
