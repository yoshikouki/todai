# Ops Runbook (cron / heartbeat / Prometheus / Grafana + rollback)

This is the minimum production setup centered on `metrics --textfile`.

## 1) Pre-flight Check

```bash
cd /home/yoshikouki/src/github.com/yoshikouki/todai
bun run src/index.tsx doctor
bun run src/index.tsx metrics | head -n 20
```

## 2) Create textfile Collector Directory

```bash
sudo mkdir -p /var/lib/node_exporter/textfile_collector
sudo chown -R $USER:$USER /var/lib/node_exporter/textfile_collector
```

## 3) Configure cron (metrics + heartbeat)

```bash
crontab -l > /tmp/todai.cron.$$.bak 2>/dev/null || true

cat <<'EOF' >> /tmp/todai.cron.$$.new
* * * * * cd /home/yoshikouki/src/github.com/yoshikouki/todai && bun run src/index.tsx metrics --textfile /var/lib/node_exporter/textfile_collector/todai.prom >/tmp/todai-metrics.log 2>&1
* * * * * date +\%s > /tmp/todai-heartbeat.ts
EOF

( crontab -l 2>/dev/null; cat /tmp/todai.cron.$$.new ) | crontab -
crontab -l
```

> Heartbeat is a minimal liveness marker for cron.

## 4) Verify Prometheus Intake

```bash
# Check ingestion via node_exporter metrics endpoint (example)
curl -fsSL http://localhost:9100/metrics | rg 'todai_tasks_total|node_textfile_scrape_error'
```

Expected:
- `todai_tasks_total{...}` is present
- `node_textfile_scrape_error 0`

## 5) Minimum Grafana Setup

1. Add Prometheus as a data source
2. Example panels:
   - `sum(todai_tasks_total{status="open"})`
   - `sum by (owner) (todai_tasks_total{status="open"})`
   - `todai_task_oldest_open_seconds`
3. Example alerts:
   - open task total exceeds threshold
   - `max(todai_task_oldest_open_seconds) > 86400`

## 6) Common Pitfalls

### `todai` command not found

Even in cron, prefer **`bun run src/index.tsx ...`** directly to avoid PATH dependency.

### Bun execution failure

```bash
# Use full-path fallback
~/.bun/bin/bun run /home/yoshikouki/src/github.com/yoshikouki/todai/src/index.tsx metrics --textfile /var/lib/node_exporter/textfile_collector/todai.prom
```

---

## Success Criteria

```bash
test -s /var/lib/node_exporter/textfile_collector/todai.prom && echo ok
stat /tmp/todai-heartbeat.ts
curl -fsSL http://localhost:9100/metrics | rg 'todai_tasks_total|node_textfile_scrape_error'
```

- `.prom` is updated every minute
- heartbeat timestamp advances
- scrape error remains 0

## Rollback / Recovery

```bash
# 1) Restore crontab from backup (if saved)
# crontab /tmp/todai.cron.<pid>.bak

# 2) Remove added lines manually
crontab -e

# 3) Remove generated files
rm -f /var/lib/node_exporter/textfile_collector/todai.prom
rm -f /tmp/todai-heartbeat.ts /tmp/todai-metrics.log

# 4) Re-generate once and verify recovery
cd /home/yoshikouki/src/github.com/yoshikouki/todai
bun run src/index.tsx metrics --textfile /var/lib/node_exporter/textfile_collector/todai.prom
```
