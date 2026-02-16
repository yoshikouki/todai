import { existsSync, mkdirSync, readdirSync, statSync, appendFileSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { resolvePaths } from "./paths.ts";
import type { Task } from "./types.ts";

const PATHS = resolvePaths();
const TRIGGERS_DIR = join(PATHS.home.value, "triggers");
const TRIGGERS_LOG = join(PATHS.dirs.logs.value, "triggers.log");

// --- Filter parsing ---

export type TriggerFilter = Record<string, string>;

/**
 * Parse a trigger filename into { event, filters }.
 * e.g. "on-done@owner=engineer+space=todai" → { event: "on-done", filters: { owner: "engineer", space: "todai" } }
 */
export function parseTriggerFilename(name: string): { event: string; filters: TriggerFilter } {
  const atIdx = name.indexOf("@");
  if (atIdx === -1) {
    return { event: name, filters: {} };
  }
  const event = name.slice(0, atIdx);
  const filterStr = name.slice(atIdx + 1);
  const filters: TriggerFilter = {};
  for (const part of filterStr.split("+")) {
    const eqIdx = part.indexOf("=");
    if (eqIdx > 0) {
      filters[part.slice(0, eqIdx)] = part.slice(eqIdx + 1);
    }
  }
  return { event, filters };
}

/**
 * Check if a task matches all filter conditions.
 */
export function matchesFilter(filters: TriggerFilter, task: Task, changes: unknown): boolean {
  for (const [key, value] of Object.entries(filters)) {
    switch (key) {
      case "owner":
        if (task.owner !== value) return false;
        break;
      case "space":
        if (task.space !== value) return false;
        break;
      case "status":
        if (task.status !== value) return false;
        break;
      case "priority":
        if (task.priority !== value) return false;
        break;
      default:
        return false; // unknown filter key → no match
    }
  }
  return true;
}

// --- Script discovery ---

function isExecutable(path: string): boolean {
  try {
    const st = statSync(path);
    return st.isFile() && (st.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function isValidDEntry(name: string): boolean {
  return !name.startsWith(".") && !name.endsWith("~");
}

/**
 * List all trigger scripts that should fire for a given event + task context.
 * Scans TRIGGERS_DIR for files/dirs matching the event, applying filter logic.
 */
export function collectTriggerScripts(
  eventFileBase: string,
  task: Task,
  changes: unknown,
): { label: string; path: string }[] {
  if (!existsSync(TRIGGERS_DIR)) return [];

  const scripts: { label: string; path: string }[] = [];

  let entries: string[];
  try {
    entries = readdirSync(TRIGGERS_DIR);
  } catch {
    return [];
  }

  // Collect matching single files and .d/ directories
  // A file/dir matches if its event part equals eventFileBase AND filters match
  const matchingSingles: { label: string; path: string; name: string }[] = [];
  const matchingDirs: { label: string; path: string; name: string }[] = [];

  for (const entry of entries) {
    const fullPath = join(TRIGGERS_DIR, entry);

    // Check .d/ directories
    if (entry.endsWith(".d")) {
      const baseName = entry.slice(0, -2); // remove .d
      const { event, filters } = parseTriggerFilename(baseName);
      if (event !== eventFileBase) continue;
      if (!matchesFilter(filters, task, changes)) continue;

      try {
        const st = statSync(fullPath);
        if (st.isDirectory()) {
          matchingDirs.push({ label: entry, path: fullPath, name: baseName });
        }
      } catch {
        continue;
      }
      continue;
    }

    // Check single files
    const { event, filters } = parseTriggerFilename(entry);
    if (event !== eventFileBase) continue;
    if (!matchesFilter(filters, task, changes)) continue;

    if (isExecutable(fullPath)) {
      matchingSingles.push({ label: entry, path: fullPath, name: entry });
    }
  }

  // Sort: unfiltered first, then by name for stability
  const sortByName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
  matchingSingles.sort(sortByName);
  matchingDirs.sort(sortByName);

  // For each matching single + its .d, add in order: single → .d entries
  // Group by base event+filter: single file then .d
  const seen = new Set<string>();

  // Add all singles
  for (const s of matchingSingles) {
    scripts.push({ label: s.label, path: s.path });
    seen.add(s.name);
  }

  // Add all .d entries
  for (const d of matchingDirs) {
    try {
      const dirEntries = readdirSync(d.path, { withFileTypes: true })
        .filter((e) => e.isFile() && isValidDEntry(e.name))
        .map((e) => e.name)
        .sort();

      for (const name of dirEntries) {
        const p = join(d.path, name);
        if (isExecutable(p)) {
          scripts.push({ label: `${d.label}/${name}`, path: p });
        }
      }
    } catch {
      // ignore
    }
  }

  return scripts;
}

// --- Environment + stdin payload ---

export function buildTriggerEnv(task: Task, event: string, changes: unknown): Record<string, string> {
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    TODAI_EVENT: event,
    TODAI_TASK_ID: task.id,
    TODAI_TASK_TITLE: task.title,
    TODAI_TASK_STATUS: task.status,
    TODAI_TASK_OWNER: task.owner,
    TODAI_TASK_SPACE: task.space,
    TODAI_TASK_PRIORITY: task.priority,
    TODAI_TASK_CREATED_AT: task.createdAt,
    TODAI_TASK_UPDATED_AT: task.updatedAt,
  };

  if (event === "status-changed" && changes && typeof changes === "object") {
    const c = changes as any;
    if (c.status?.from) env.TODAI_PREV_STATUS = String(c.status.from);
  }

  env.TODAI_TRIGGER_PAYLOAD_JSON = JSON.stringify({
    event,
    task: {
      id: task.id,
      owner: task.owner,
      title: task.title,
      desc: task.desc ?? null,
      status: task.status,
      space: task.space,
      priority: task.priority,
      labels: task.labels,
      parentId: task.parentId ?? null,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    },
    changes,
  });

  return env;
}

// --- Spawn ---

export function spawnTriggers(eventFileBase: string, event: string, task: Task, changes: unknown): void {
  const scripts = collectTriggerScripts(eventFileBase, task, changes);
  if (scripts.length === 0) return;

  mkdirSync(dirname(TRIGGERS_LOG), { recursive: true });

  const bashBodyLines: string[] = [
    "set +e",
  ];

  for (const s of scripts) {
    const scriptPath = s.path.replaceAll("'", "'\\''");
    const scriptLabel = s.label.replaceAll("'", "'\\''");
    const logPath = TRIGGERS_LOG.replaceAll("'", "'\\''");
    bashBodyLines.push(
      `START_MS=$(date +%s%3N)`,
      `printf "%s" "$TODAI_TRIGGER_PAYLOAD_JSON" | timeout 30 '${scriptPath}' >/tmp/todai-trigger-out.$$ 2>/tmp/todai-trigger-err.$$`,
      `CODE=$?`,
      `END_MS=$(date +%s%3N)`,
      `DUR_MS=$((END_MS-START_MS))`,
      `ERR=$(tr -d '\\n' < /tmp/todai-trigger-err.$$ | head -c 500)`,
      `NOW_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)`,
      `if [ "$CODE" -eq 124 ]; then`,
      `  echo "$NOW_ISO | ${scriptLabel} | ${task.id} | exit=timeout | \${DUR_MS}ms" >> '${logPath}'`,
      `elif [ "$CODE" -eq 0 ]; then`,
      `  echo "$NOW_ISO | ${scriptLabel} | ${task.id} | exit=0 | \${DUR_MS}ms" >> '${logPath}'`,
      `else`,
      `  echo "$NOW_ISO | ${scriptLabel} | ${task.id} | exit=$CODE | \${DUR_MS}ms | stderr: $ERR" >> '${logPath}'`,
      `fi`,
      `rm -f /tmp/todai-trigger-out.$$ /tmp/todai-trigger-err.$$`,
    );
  }

  const bashBody = bashBodyLines.join("\n");

  try {
    const child = Bun.spawn({
      cmd: ["bash", "-lc", bashBody],
      env: buildTriggerEnv(task, event, changes),
      stdout: "ignore",
      stderr: "ignore",
    });
    child.unref();
  } catch {
    try {
      appendFileSync(TRIGGERS_LOG, `${new Date().toISOString()} | ${eventFileBase} | ${task.id} | spawn_error\n`, "utf-8");
    } catch {
      // ignore
    }
  }
}

// --- Doctor info ---

export function getTriggersDoctorInfo(): string {
  const lines: string[] = [];
  const dirExists = existsSync(TRIGGERS_DIR);
  const dirSource = PATHS.home.source === "default" ? "(default)" : `(${PATHS.home.source})`;
  lines.push(`triggers:`);
  lines.push(`  dir:          ${TRIGGERS_DIR.padEnd(40)} ${dirSource} ${dirExists ? "✓" : "✗"}`);

  const events = ["on-created", "on-status-changed", "on-done", "on-cancelled", "on-updated"];

  if (!dirExists) {
    for (const ev of events) {
      lines.push(`  ${ev.padEnd(22)}(not found)`);
    }
    return lines.join("\n");
  }

  let allEntries: string[];
  try {
    allEntries = readdirSync(TRIGGERS_DIR);
  } catch {
    allEntries = [];
  }

  for (const ev of events) {
    // Find matching singles and .d dirs
    const singles: string[] = [];
    const dirs: string[] = [];

    for (const entry of allEntries) {
      if (entry.endsWith(".d")) {
        const base = entry.slice(0, -2);
        const { event } = parseTriggerFilename(base);
        if (event === ev) {
          dirs.push(entry);
        }
      } else {
        const { event } = parseTriggerFilename(entry);
        if (event === ev) {
          const fullPath = join(TRIGGERS_DIR, entry);
          if (isExecutable(fullPath)) {
            singles.push(entry);
          }
        }
      }
    }

    if (singles.length === 0 && dirs.length === 0) {
      lines.push(`  ${ev.padEnd(22)}(not found)`);
      continue;
    }

    for (const s of singles.sort()) {
      const fullPath = join(TRIGGERS_DIR, s);
      lines.push(`  ${s.padEnd(22)}${fullPath.padEnd(44)} ✓ (executable)`);
    }

    for (const d of dirs.sort()) {
      const fullPath = join(TRIGGERS_DIR, d);
      try {
        const count = readdirSync(fullPath)
          .filter((n) => !n.startsWith(".") && !n.endsWith("~"))
          .length;
        lines.push(`  ${d.padEnd(22)}${count} script${count !== 1 ? "s" : ""}`);
      } catch {
        lines.push(`  ${d.padEnd(22)}(error reading)`);
      }
    }
  }

  return lines.join("\n");
}

export { TRIGGERS_DIR };
