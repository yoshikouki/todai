import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import { mkdirSync, existsSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";

import { resolvePaths } from "../paths.ts";
import { spawnTriggers as spawnTriggersFromModule, getTriggersDoctorInfo } from "../triggers.ts";
import type { Task, Owner, TaskPriority, TaskStatus, Store, TaskListField } from "../types.ts";
import { OWNERS, PRIORITIES, TASK_LIST_FIELDS } from "../types.ts";
import {
  readStore, writeStore, appendEvent, generateId,
  getOpenTasks, listSpaces, addTask, doneTask, updateTask,
  getKnownStatuses, getTerminalStatuses, STORE_PATH,
} from "../store.ts";

const COMMANDS = ["help", "doctor", "task", "metrics", "events", "space", "protocol", "uninstall", "tui"] as const;
type KnownCommand = (typeof COMMANDS)[number];

const SPACE_NAME_RE = /^[a-z0-9-]+$/;
const PATHS = resolvePaths();

interface AppProps {
  args: string[];
}

// --- Trigger wrapper ---
const spawnTriggers = spawnTriggersFromModule;

// --- Validators ---

function isOwner(value: string): value is Owner {
  return (OWNERS as readonly string[]).includes(value);
}

function isStatus(value: string): value is TaskStatus {
  return getKnownStatuses().includes(value);
}

function isPriority(value: string): value is TaskPriority {
  return (PRIORITIES as readonly string[]).includes(value);
}

function isSpaceName(value: string): boolean {
  return SPACE_NAME_RE.test(value);
}

function isTaskListField(value: string): value is TaskListField {
  return (TASK_LIST_FIELDS as readonly string[]).includes(value);
}

// --- Flag parsing ---

function parseFlags(args: string[]) {
  const flags: Record<string, string[]> = {};
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    const key = token.slice(2);
    const value = args[i + 1];
    if (!value || value.startsWith("--")) {
      if (!flags[key]) flags[key] = [];
      flags[key].push("true");
      continue;
    }
    if (!flags[key]) flags[key] = [];
    flags[key].push(value);
    i += 1;
  }
  return flags;
}

function getFlag(flags: Record<string, string[]>, key: string): string | undefined {
  return flags[key]?.[0];
}

function getFlagAll(flags: Record<string, string[]>, key: string): string[] {
  return flags[key] ?? [];
}

function parseTaskListFields(raw: string | undefined): TaskListField[] {
  if (!raw) {
    return ["id", "status", "space", "owner", "priority", "labels", "title"];
  }
  const parsed = raw.split(",").map((v) => v.trim()).filter(Boolean);
  if (parsed.length === 0) throw new Error("--fields must not be empty");
  const invalid = parsed.filter((f) => !isTaskListField(f));
  if (invalid.length > 0) {
    throw new Error(`--fields contains invalid values: ${invalid.join(",")} (allowed: ${TASK_LIST_FIELDS.join(",")})`);
  }
  return parsed as TaskListField[];
}

// --- Help ---

function Help() {
  return (
    <Text>
      {`todai - Task CLI for AI agents

Usage:
  todai [command]

Start here (3 steps):
  1) todai task add --owner you --title "daily"
  2) todai task list --owner you --status open
  3) todai task done --id <id>

Commands:
  help
    Show this help.
    example: todai help

  doctor
    Run a quick environment check.
    example: todai doctor

  task add --owner <you|kai|olga|engineer> --title "..." [--space <name>] [--desc "..."] [--priority <low|medium|high|urgent>] [--status <value>] [--label <label> ...] [--parent <taskId>] [--idempotent]
    Add a task (default status=backlog). --idempotent skips if same title exists (non-terminal).

  task list [--owner <you|kai|olga|engineer>] [--status <value>] [--space <name>] [--priority <low|medium|high|urgent>] [--label <label>] [--format text|json] [--fields <csv>]
    List tasks with optional filters.

  task done --id <id>
    Mark a task as done.

  task update --id <id> [--owner <you|kai|olga|engineer>] [--title "..."] [--desc "..."] [--space <name>] [--priority <low|medium|high|urgent>] [--status <value>] [--parent <taskId>] [--clear-parent] [--label <label> ...] [--clear-labels]
    Update task fields.

  metrics [--textfile <path>]
    Print Prometheus text format metrics.
    with --textfile, also write atomically (tmp -> mv).

  events [--task-id <id>]
    List recorded task events.

  space list
    List all spaces with open/done counts.

  protocol
    Show machine-readable command protocol.

  uninstall --dry-run
    Show files/directories that would be removed.

  tui
    Interactive TUI for open tasks.
    keys: j/k or ↑/↓ move, a add, x done, r reload, f owner-filter, s space-filter, Enter details, q quit.`}
    </Text>
  );
}

// --- Doctor ---

function formatResolvedPath(
  label: string,
  value: string,
  source: string,
  exists: boolean,
): string {
  const status = exists ? "✓" : "✗";
  return `  ${label.padEnd(12, " ")}${value.padEnd(44, " ")} (${source}) ${status}`;
}

function Doctor() {
  const paths = resolvePaths();

  return (
    <Text>
      {`doctor: OK
- runtime: bun ${Bun.version}
- cwd: ${process.cwd()}
paths:
${formatResolvedPath("todai_home:", paths.home.value, paths.home.source, existsSync(paths.home.value))}
${formatResolvedPath("config:", paths.files.configToml.value, paths.files.configToml.source, existsSync(paths.files.configToml.value))}
${formatResolvedPath("tasks:", paths.files.tasksJson.value, paths.files.tasksJson.source, existsSync(paths.files.tasksJson.value))}
${formatResolvedPath("logs:", paths.files.todaiLog.value, paths.files.todaiLog.source, existsSync(paths.files.todaiLog.value))}
${formatResolvedPath("heartbeat:", paths.files.heartbeatTs.value, paths.files.heartbeatTs.source, existsSync(paths.files.heartbeatTs.value))}
${formatResolvedPath("metrics:", paths.files.metricsProm.value, paths.files.metricsProm.source, existsSync(paths.files.metricsProm.value))}
${formatResolvedPath("dir.config:", paths.dirs.config.value, paths.dirs.config.source, existsSync(paths.dirs.config.value))}
${formatResolvedPath("dir.data:", paths.dirs.data.value, paths.dirs.data.source, existsSync(paths.dirs.data.value))}
${formatResolvedPath("dir.logs:", paths.dirs.logs.value, paths.dirs.logs.source, existsSync(paths.dirs.logs.value))}
${formatResolvedPath("dir.run:", paths.dirs.run.value, paths.dirs.run.source, existsSync(paths.dirs.run.value))}
${formatResolvedPath("dir.metrics:", paths.dirs.metrics.value, paths.dirs.metrics.source, existsSync(paths.dirs.metrics.value))}
${formatResolvedPath("dir.tmp:", paths.dirs.tmp.value, paths.dirs.tmp.source, existsSync(paths.dirs.tmp.value))}
${getTriggersDoctorInfo()}
next action: run \`todai help\`.`}
    </Text>
  );
}

// --- Prometheus metrics ---

function escapePrometheusLabelValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll("\"", "\\\"");
}

function formatPrometheusMetrics(store: Store): string {
  const lines: string[] = [];
  const statuses = getKnownStatuses();

  lines.push("# HELP todai_tasks_total Tasks by owner and status.");
  lines.push("# TYPE todai_tasks_total gauge");
  for (const owner of OWNERS) {
    for (const status of statuses) {
      const count = store.tasks.filter(
        (task) => task.owner === owner && task.status === status,
      ).length;
      lines.push(`todai_tasks_total{owner="${escapePrometheusLabelValue(owner)}",status="${escapePrometheusLabelValue(status)}"} ${count}`);
    }
  }

  lines.push("# HELP todai_task_updates_total Task updates by action.");
  lines.push("# TYPE todai_task_updates_total counter");
  const addCount = store.tasks.length;
  const doneCount = store.tasks.filter((task) => task.status === "done").length;
  const cancelledCount = store.tasks.filter((task) => task.status === "cancelled").length;
  lines.push(`todai_task_updates_total{action="add"} ${addCount}`);
  lines.push(`todai_task_updates_total{action="done"} ${doneCount}`);
  lines.push(`todai_task_updates_total{action="cancelled"} ${cancelledCount}`);

  lines.push("# HELP todai_task_oldest_open_seconds Oldest non-terminal task age in seconds.");
  lines.push("# TYPE todai_task_oldest_open_seconds gauge");
  const nowMs = Date.now();
  const terminal = new Set(getTerminalStatuses());
  for (const owner of OWNERS) {
    const openTasks = store.tasks.filter(
      (task) => task.owner === owner && !terminal.has(task.status),
    );
    let value = 0;
    if (openTasks.length > 0) {
      const oldestMs = Math.min(
        ...openTasks.map((task) => Date.parse(task.createdAt)).filter((ms) => Number.isFinite(ms)),
      );
      if (Number.isFinite(oldestMs)) {
        value = Math.max(0, Math.floor((nowMs - oldestMs) / 1000));
      }
    }
    lines.push(`todai_task_oldest_open_seconds{owner="${escapePrometheusLabelValue(owner)}"} ${value}`);
  }

  return lines.join("\n") + "\n";
}

function writeTextfileAtomically(path: string, content: string): void {
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(tmpPath, content, "utf-8");
  renameSync(tmpPath, path);
}

// --- Command handlers ---

function runMetricsCommand(args: string[]): string {
  const flags = parseFlags(args);
  const allowed = new Set(["textfile"]);
  for (const key of Object.keys(flags)) {
    if (!allowed.has(key)) throw new Error(`Unknown option: --${key}`);
  }
  const metrics = formatPrometheusMetrics(readStore());
  const textfile = getFlag(flags, "textfile");
  if (textfile) writeTextfileAtomically(textfile, metrics);
  return metrics.trimEnd();
}

function runTaskCommand(args: string[]): string {
  const sub = args[0];

  if (sub === "add") {
    const flags = parseFlags(args.slice(1));
    const allowed = new Set(["owner", "title", "space", "desc", "priority", "label", "parent", "status", "idempotent"]);
    for (const key of Object.keys(flags)) {
      if (!allowed.has(key)) throw new Error(`Unknown option: --${key}`);
    }

    const owner = getFlag(flags, "owner");
    const title = getFlag(flags, "title");
    const space = getFlag(flags, "space") ?? "default";
    const desc = getFlag(flags, "desc");
    const priority = getFlag(flags, "priority") ?? "medium";
    const status = getFlag(flags, "status") ?? "backlog";
    const labels = getFlagAll(flags, "label");
    const parentId = getFlag(flags, "parent");
    const idempotent = Boolean(getFlag(flags, "idempotent"));

    if (!owner) throw new Error("--owner is required");
    if (!title) throw new Error("--title is required");
    if (!isOwner(owner)) throw new Error(`--owner must be one of: ${OWNERS.join("|")}`);
    if (!isPriority(priority)) throw new Error(`--priority must be one of: ${PRIORITIES.join("|")}`);
    if (!isStatus(status)) throw new Error(`--status must be one of: ${getKnownStatuses().join("|")}`);
    if (!isSpaceName(space)) throw new Error("--space must match: lowercase alphanumeric + hyphens");

    if (idempotent) {
      const store = readStore();
      const terminal = new Set(getTerminalStatuses());
      const existing = store.tasks.find(
        (task) => task.title === title && !terminal.has(task.status),
      );
      if (existing) return "";
    }

    if (parentId) {
      const store = readStore();
      const parentExists = store.tasks.some((task) => task.id === parentId);
      if (!parentExists) throw new Error(`parent task not found: ${parentId}`);
    }

    const task = addTask(owner, title, { desc, space, priority, labels, parentId });

    // Fire triggers
    spawnTriggers("on-created", "created", task, null);

    if (status !== task.status) {
      const store = readStore();
      const t = store.tasks.find((x) => x.id === task.id);
      if (t) {
        const beforeStatus = t.status;
        t.status = status;
        t.updatedAt = new Date().toISOString();
        appendEvent(store, {
          type: "status_changed",
          taskId: t.id,
          actor: t.owner,
          payload: { from: beforeStatus, to: status },
        });
        writeStore(store);
      }
    }
    return `added: ${task.id} owner=${task.owner} space=${task.space} priority=${task.priority} title=${task.title}`;
  }

  if (sub === "list") {
    const flags = parseFlags(args.slice(1));
    const allowed = new Set(["owner", "status", "space", "priority", "label", "format", "fields"]);
    for (const key of Object.keys(flags)) {
      if (!allowed.has(key)) throw new Error(`Unknown option: --${key}`);
    }

    const owner = getFlag(flags, "owner");
    const status = getFlag(flags, "status");
    const space = getFlag(flags, "space");
    const priority = getFlag(flags, "priority");
    const label = getFlag(flags, "label");
    const format = getFlag(flags, "format") ?? "text";
    const fields = parseTaskListFields(getFlag(flags, "fields"));

    if (owner && !isOwner(owner)) throw new Error(`--owner must be one of: ${OWNERS.join("|")}`);
    if (status && !isStatus(status)) throw new Error(`--status must be one of: ${getKnownStatuses().join("|")}`);
    if (space && !isSpaceName(space)) throw new Error("--space must match: lowercase alphanumeric + hyphens");
    if (priority && !isPriority(priority)) throw new Error(`--priority must be one of: ${PRIORITIES.join("|")}`);
    if (!["text", "json"].includes(format)) throw new Error("--format must be one of: text|json");

    const store = readStore();
    const terminal = new Set(getTerminalStatuses());
    const filtered = store.tasks.filter((task) => {
      if (owner && task.owner !== owner) return false;
      if (status) {
        if (status === "open") {
          if (terminal.has(task.status)) return false;
        } else if (task.status !== status) return false;
      }
      if (space && task.space !== space) return false;
      if (priority && task.priority !== priority) return false;
      if (label && !task.labels.includes(label)) return false;
      return true;
    });

    if (format === "json") {
      const rows = filtered.map((task) => {
        const row: Record<string, unknown> = {};
        for (const field of fields) {
          if (field === "labels") row[field] = task.labels;
          else if (field === "parentId") row[field] = task.parentId ?? null;
          else if (field === "desc") row[field] = task.desc ?? null;
          else row[field] = task[field as keyof Task];
        }
        return row;
      });
      return JSON.stringify(rows, null, 2);
    }

    if (filtered.length === 0) return "no tasks";

    return filtered
      .map((task) => {
        const cells = fields.map((field) => {
          if (field === "labels") {
            const labelsText = task.labels.length > 0 ? task.labels.join(",") : "-";
            return `[${labelsText}]`;
          }
          if (field === "parentId") return task.parentId ?? "-";
          if (field === "desc") return task.desc?.trim() || "-";
          const value = task[field as keyof Task];
          return value === undefined || value === null || value === "" ? "-" : String(value);
        });
        return cells.join(" | ");
      })
      .join("\n");
  }

  if (sub === "done") {
    const flags = parseFlags(args.slice(1));
    const allowed = new Set(["id"]);
    for (const key of Object.keys(flags)) {
      if (!allowed.has(key)) throw new Error(`Unknown option: --${key}`);
    }
    const id = getFlag(flags, "id");
    if (!id) throw new Error("--id is required");

    const { task, beforeStatus, changes } = doneTask(id);

    // triggers
    if (beforeStatus !== "done") {
      spawnTriggers("on-status-changed", "status-changed", task, changes);
    }
    spawnTriggers("on-done", "done", task, changes);
    spawnTriggers("on-updated", "updated", task, changes);

    return `done: ${task.id}`;
  }

  if (sub === "update") {
    const flags = parseFlags(args.slice(1));
    const allowed = new Set([
      "id", "owner", "title", "desc", "space", "priority", "status",
      "parent", "clear-parent", "label", "clear-labels",
    ]);
    for (const key of Object.keys(flags)) {
      if (!allowed.has(key)) throw new Error(`Unknown option: --${key}`);
    }

    const id = getFlag(flags, "id");
    if (!id) throw new Error("--id is required");

    const owner = getFlag(flags, "owner");
    const title = getFlag(flags, "title");
    const desc = getFlag(flags, "desc");
    const space = getFlag(flags, "space");
    const priority = getFlag(flags, "priority");
    const status = getFlag(flags, "status");
    const parent = getFlag(flags, "parent");
    const clearParent = Boolean(getFlag(flags, "clear-parent"));
    const labels = getFlagAll(flags, "label");
    const clearLabels = Boolean(getFlag(flags, "clear-labels"));

    if (owner && !isOwner(owner)) throw new Error(`--owner must be one of: ${OWNERS.join("|")}`);
    if (space && !isSpaceName(space)) throw new Error("--space must match: lowercase alphanumeric + hyphens");
    if (priority && !isPriority(priority)) throw new Error(`--priority must be one of: ${PRIORITIES.join("|")}`);
    if (status && !isStatus(status)) throw new Error(`--status must be one of: ${getKnownStatuses().join("|")}`);
    if (parent && clearParent) throw new Error("--parent and --clear-parent are mutually exclusive");
    if (labels.length > 0 && clearLabels) throw new Error("--label and --clear-labels are mutually exclusive");

    const patch: {
      owner?: Owner; title?: string; desc?: string; space?: string;
      priority?: TaskPriority; status?: TaskStatus; parentId?: string; labels?: string[];
    } = {};

    if (owner) patch.owner = owner;
    if (title !== undefined) patch.title = title;
    if (desc !== undefined) patch.desc = desc;
    if (space) patch.space = space;
    if (priority) patch.priority = priority;
    if (status) patch.status = status;
    if (parent) patch.parentId = parent;
    if (clearParent) patch.parentId = undefined;
    if (labels.length > 0) patch.labels = labels;
    if (clearLabels) patch.labels = [];

    if (Object.keys(patch).length === 0) throw new Error("no update fields specified");

    const { task, before, changes } = updateTask(id, patch);

    // triggers
    if ((before as any).status !== task.status) {
      const statusChanges = { status: { from: (before as any).status, to: task.status } };
      spawnTriggers("on-status-changed", "status-changed", task, statusChanges);
      if (task.status === "done") spawnTriggers("on-done", "done", task, statusChanges);
      if (task.status === "cancelled") spawnTriggers("on-cancelled", "cancelled", task, statusChanges);
    }
    spawnTriggers("on-updated", "updated", task, changes);

    return `updated: ${task.id}`;
  }

  throw new Error("task subcommand must be one of: add, list, done, update (run `todai help`)");
}

function runSpaceCommand(args: string[]): string {
  const sub = args[0];
  if (sub !== "list") throw new Error("space subcommand must be: list");

  const store = readStore();
  const spaces = listSpaces(store);

  return spaces
    .map((space) => {
      const terminal = new Set(getTerminalStatuses());
      const open = store.tasks.filter((task) => task.space === space && !terminal.has(task.status)).length;
      const done = store.tasks.filter((task) => task.space === space && terminal.has(task.status)).length;
      return `${space} | open=${open} | done=${done}`;
    })
    .join("\n");
}

function runProtocolCommand(): string {
  const protocol = {
    name: "todai",
    version: "1",
    task_statuses: {
      statuses: getKnownStatuses(),
      terminal_statuses: getTerminalStatuses(),
      notes: [
        "--status open is treated as a backward-compatible alias for non-terminal tasks (excludes terminal_statuses).",
      ],
    },
    commands: {
      task: {
        add: { required: ["owner", "title"], optional: ["space", "desc", "priority", "status", "label", "parent", "idempotent"] },
        list: { optional: ["owner", "status", "space", "priority", "label", "format", "fields"], format: ["text", "json"], fields: TASK_LIST_FIELDS },
        done: { required: ["id"] },
        update: { required: ["id"], optional: ["owner", "title", "desc", "space", "priority", "status", "parent", "clear-parent", "label", "clear-labels"] },
      },
      metrics: { optional: ["textfile"] },
      events: { optional: ["task-id"] },
      space: { subcommands: ["list"] },
    },
  };
  return JSON.stringify(protocol, null, 2);
}

function runUninstallCommand(args: string[]): string {
  const flags = parseFlags(args);
  const allowed = new Set(["dry-run"]);
  for (const key of Object.keys(flags)) {
    if (!allowed.has(key)) throw new Error(`Unknown option: --${key}`);
  }
  const dryRun = Boolean(getFlag(flags, "dry-run"));
  if (!dryRun) throw new Error("uninstall requires --dry-run (safe preview only)");

  const paths = resolvePaths();
  const targets = [
    paths.home.value, paths.files.configToml.value, paths.files.tasksJson.value,
    paths.files.todaiLog.value, paths.files.heartbeatTs.value, paths.files.metricsProm.value,
  ];
  const uniqueTargets = [...new Set(targets)];
  return ["uninstall dry-run: would remove", ...uniqueTargets.map((p) => `- ${p}`)].join("\n");
}

function runEventsCommand(args: string[]): string {
  const flags = parseFlags(args);
  const allowed = new Set(["task-id"]);
  for (const key of Object.keys(flags)) {
    if (!allowed.has(key)) throw new Error(`Unknown option: --${key}`);
  }
  const taskId = getFlag(flags, "task-id");
  const store = readStore();
  const events = taskId ? store.events.filter((event) => event.taskId === taskId) : store.events;
  if (events.length === 0) return "no events";
  return events
    .map((event) => `${event.timestamp} | ${event.type} | ${event.taskId} | ${event.actor ?? "-"}`)
    .join("\n");
}

// --- TUI ---

function fitCell(value: string, width: number): string {
  if (width <= 0) return "";
  if (value.length <= width) return value.padEnd(width, " ");
  if (width === 1) return "…";
  return `${value.slice(0, width - 1)}…`;
}

function didYouMean(input: string): KnownCommand | null {
  if (!input) return null;
  const normalized = input.toLowerCase();
  if (normalized.startsWith("hel")) return "help";
  if (normalized.startsWith("doc")) return "doctor";
  if (normalized.startsWith("tas")) return "task";
  if (normalized.startsWith("met")) return "metrics";
  if (normalized.startsWith("ev")) return "events";
  if (normalized.startsWith("sp")) return "space";
  if (normalized.startsWith("pro")) return "protocol";
  if (normalized.startsWith("uni")) return "uninstall";
  if (normalized.startsWith("tu")) return "tui";
  return null;
}

type InputMode = "normal" | "add-owner" | "add-title";
type OwnerFilter = Owner | "all";
type SpaceFilter = string | "all";

function Tui() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mode, setMode] = useState<InputMode>("normal");
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>("all");
  const [spaceFilter, setSpaceFilter] = useState<SpaceFilter>("all");
  const [showDetails, setShowDetails] = useState(false);
  const [draftOwner, setDraftOwner] = useState("");
  const [draftTitle, setDraftTitle] = useState("");
  const [message, setMessage] = useState("ready");

  const selectedTask = tasks[selectedIndex] ?? null;

  const reload = useCallback(() => {
    const store = readStore();
    const terminal = new Set(getTerminalStatuses());
    const openTasks = store.tasks.filter((task) => !terminal.has(task.status));
    const filteredTasks = openTasks.filter((task) => {
      if (ownerFilter !== "all" && task.owner !== ownerFilter) return false;
      if (spaceFilter !== "all" && task.space !== spaceFilter) return false;
      return true;
    });
    setTasks(filteredTasks);
    setSelectedIndex((prev) => {
      if (filteredTasks.length === 0) return 0;
      return Math.min(prev, filteredTasks.length - 1);
    });
  }, [ownerFilter, spaceFilter]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { if (!selectedTask) setShowDetails(false); }, [selectedTask]);

  const prompt = useMemo(() => {
    if (mode === "add-owner") return `owner (${OWNERS.join("/")}): ${draftOwner}`;
    if (mode === "add-title") return `title: ${draftTitle}`;
    return "";
  }, [mode, draftOwner, draftTitle]);

  const cycleOwnerFilter = useCallback(() => {
    const sequence: OwnerFilter[] = ["all", ...OWNERS];
    const currentIndex = sequence.indexOf(ownerFilter);
    const next = sequence[(currentIndex + 1) % sequence.length];
    setOwnerFilter(next);
    setMessage(`owner filter: ${next}`);
  }, [ownerFilter]);

  const cycleSpaceFilter = useCallback(() => {
    const store = readStore();
    const spaces = listSpaces(store);
    const sequence: SpaceFilter[] = ["all", ...spaces];
    const currentIndex = sequence.indexOf(spaceFilter);
    const next = sequence[(currentIndex + 1) % sequence.length];
    setSpaceFilter(next);
    setMessage(`space filter: ${next}`);
  }, [spaceFilter]);

  useInput((input, key) => {
    if (mode === "normal") {
      if (input === "q") { exit(); return; }
      if (input === "j" || key.downArrow) { setSelectedIndex((prev) => Math.min(prev + 1, Math.max(tasks.length - 1, 0))); return; }
      if (input === "k" || key.upArrow) { setSelectedIndex((prev) => Math.max(prev - 1, 0)); return; }
      if (input === "f") { cycleOwnerFilter(); return; }
      if (input === "s") { cycleSpaceFilter(); return; }
      if (key.return) {
        if (!selectedTask) { setMessage("no task selected"); return; }
        setShowDetails((prev) => !prev);
        return;
      }
      if (input === "r") { reload(); setMessage("reloaded"); return; }
      if (input === "x") {
        if (!selectedTask) { setMessage("no task selected"); return; }
        try {
          const { task, beforeStatus, changes } = doneTask(selectedTask.id);
          if (beforeStatus !== "done") spawnTriggers("on-status-changed", "status-changed", task, changes);
          spawnTriggers("on-done", "done", task, changes);
          spawnTriggers("on-updated", "updated", task, changes);
          reload();
          setShowDetails(false);
          setMessage(`done: ${selectedTask.id}`);
        } catch (error: unknown) {
          setMessage(`error: ${error instanceof Error ? error.message : String(error)}`);
        }
        return;
      }
      if (input === "a") {
        setMode("add-owner");
        setShowDetails(false);
        setDraftOwner("");
        setDraftTitle("");
        setMessage("add mode");
      }
      return;
    }

    if (key.escape) { setMode("normal"); setDraftOwner(""); setDraftTitle(""); setMessage("cancelled"); return; }

    if (key.return) {
      if (mode === "add-owner") {
        if (!isOwner(draftOwner.trim())) { setMessage(`invalid owner (${OWNERS.join("/")})`); return; }
        setMode("add-title");
        setMessage("enter title");
        return;
      }
      const owner = draftOwner.trim();
      const title = draftTitle.trim();
      if (!isOwner(owner)) { setMessage(`invalid owner (${OWNERS.join("/")})`); setMode("add-owner"); return; }
      if (!title) { setMessage("title is required"); return; }
      const task = addTask(owner, title);
      spawnTriggers("on-created", "created", task, null);
      setMode("normal");
      setDraftOwner("");
      setDraftTitle("");
      reload();
      setSelectedIndex(tasks.length);
      setMessage(`added: ${task.id}`);
      return;
    }

    if (key.backspace || key.delete) {
      if (mode === "add-owner") setDraftOwner((prev) => prev.slice(0, -1));
      else setDraftTitle((prev) => prev.slice(0, -1));
      return;
    }

    if (!input || key.ctrl || key.meta) return;

    if (mode === "add-owner") setDraftOwner((prev) => prev + input);
    else setDraftTitle((prev) => prev + input);
  });

  const viewportWidth = stdout.columns || 80;
  const markerWidth = 2;
  const spacingWidth = 2;
  const idWidth = 14;
  const spaceWidth = 10;
  const ownerWidth = 10;
  const priorityWidth = 8;
  const minTitleWidth = 18;
  const titleWidth = Math.max(minTitleWidth, viewportWidth - markerWidth - spacingWidth - idWidth - spaceWidth - ownerWidth - priorityWidth);

  const selectedId = selectedTask ? selectedTask.id : "-";
  const selectedOwner = selectedTask ? selectedTask.owner : "-";

  return (
    <Box flexDirection="column">
      <Text color="cyanBright">{`TODAI TUI  Open Tasks: ${tasks.length}`}</Text>
      <Text color="magenta">
        {`bar: open=${tasks.length} | selected=${selectedId} | owner=${selectedOwner} | ownerFilter=${ownerFilter} | spaceFilter=${spaceFilter}`}
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Text color="gray">
          {`  ${fitCell("ID", idWidth)}${fitCell("SPACE", spaceWidth)}${fitCell("OWNER", ownerWidth)}${fitCell("PRIOR", priorityWidth)}${fitCell("TITLE", titleWidth)}`}
        </Text>
        <Text color="gray">{"  " + "─".repeat(Math.max(idWidth + spaceWidth + ownerWidth + priorityWidth + titleWidth, 20))}</Text>
        {tasks.length === 0 ? (
          <Text color="gray">(no open tasks)</Text>
        ) : (
          tasks.map((task, index) => {
            const marker = index === selectedIndex ? "> " : "  ";
            return (
              <Text key={task.id} color={index === selectedIndex ? "cyan" : undefined}>
                {`${marker}${fitCell(task.id, idWidth)}${fitCell(task.space, spaceWidth)}${fitCell(task.owner, ownerWidth)}${fitCell(task.priority, priorityWidth)}${fitCell(task.parentId ? `↳ ${task.title}` : task.title, titleWidth)}`}
              </Text>
            );
          })
        )}
      </Box>
      {showDetails && selectedTask ? (
        <Box marginTop={1} flexDirection="column">
          <Text color="yellowBright">{"details"}</Text>
          <Text>{`id: ${selectedTask.id}`}</Text>
          <Text>{`owner: ${selectedTask.owner}`}</Text>
          <Text>{`space: ${selectedTask.space}`}</Text>
          <Text>{`title: ${selectedTask.title}`}</Text>
          <Text>{`priority: ${selectedTask.priority}`}</Text>
          <Text>{`labels: ${selectedTask.labels.length > 0 ? selectedTask.labels.join(", ") : "(none)"}`}</Text>
          <Text>{`parentId: ${selectedTask.parentId ?? "(none)"}`}</Text>
          <Text>{`desc: ${selectedTask.desc?.trim() || "(none)"}`}</Text>
          <Text>{`createdAt: ${selectedTask.createdAt}`}</Text>
          <Text>{`updatedAt: ${selectedTask.updatedAt}`}</Text>
        </Box>
      ) : null}
      <Box marginTop={1} flexDirection="column">
        <Text color="gray">
          {"keys: j/k or ↑/↓ move | a add | x done | r reload | f owner-filter | s space-filter | Enter details | q quit"}
        </Text>
        {mode !== "normal" ? <Text color="yellow">{prompt}</Text> : null}
        <Text color="green">{`status: ${message}`}</Text>
      </Box>
    </Box>
  );
}

// --- Main App ---

export function App({ args }: AppProps) {
  const command = args[0];

  if (!command || command === "help" || command === "--help" || command === "-h") return <Help />;
  if (command === "doctor") return <Doctor />;

  if (command === "task") {
    try { return <Text>{runTaskCommand(args.slice(1))}</Text>; }
    catch (error: unknown) { return <Text>{`error: ${error instanceof Error ? error.message : String(error)}`}</Text>; }
  }

  if (command === "metrics") {
    try { return <Text>{runMetricsCommand(args.slice(1))}</Text>; }
    catch (error: unknown) { return <Text>{`error: ${error instanceof Error ? error.message : String(error)}`}</Text>; }
  }

  if (command === "events") {
    try { return <Text>{runEventsCommand(args.slice(1))}</Text>; }
    catch (error: unknown) { return <Text>{`error: ${error instanceof Error ? error.message : String(error)}`}</Text>; }
  }

  if (command === "space") {
    try { return <Text>{runSpaceCommand(args.slice(1))}</Text>; }
    catch (error: unknown) { return <Text>{`error: ${error instanceof Error ? error.message : String(error)}`}</Text>; }
  }

  if (command === "protocol") {
    try { return <Text>{runProtocolCommand()}</Text>; }
    catch (error: unknown) { return <Text>{`error: ${error instanceof Error ? error.message : String(error)}`}</Text>; }
  }

  if (command === "uninstall") {
    try { return <Text>{runUninstallCommand(args.slice(1))}</Text>; }
    catch (error: unknown) { return <Text>{`error: ${error instanceof Error ? error.message : String(error)}`}</Text>; }
  }

  if (command === "tui") return <Tui />;

  const suggestion = didYouMean(command);
  return (
    <Text>
      {`Unknown command: ${command}${suggestion ? `\nDid you mean \`${suggestion}\`?` : ""}
Run \`todai help\``}
    </Text>
  );
}
