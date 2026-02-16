import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";

import { resolvePaths } from "./paths.ts";
import type { Task, TaskEvent, Store, Owner, TaskPriority, TaskStatus } from "./types.ts";
import { DEFAULT_STATUSES, DEFAULT_TERMINAL_STATUSES } from "./types.ts";

const PATHS = resolvePaths();
export const STORE_PATH = PATHS.files.tasksJson.value;
const LEGACY_STORE_PATH = join(
  Bun.env.HOME ?? process.env.HOME ?? ".",
  ".todai",
  "tasks.json",
);
const DEFAULT_STORE_PATH = join(
  Bun.env.HOME ?? process.env.HOME ?? ".",
  ".todai",
  "data",
  "tasks.json",
);
let migrationNoticePrinted = false;

// --- Config ---

function readConfigToml(): string {
  try {
    if (!existsSync(PATHS.files.configToml.value)) return "";
    return readFileSync(PATHS.files.configToml.value, "utf-8");
  } catch {
    return "";
  }
}

function parseTomlStringArray(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    throw new Error("expected TOML array syntax: [..]");
  }
  return JSON.parse(trimmed) as string[];
}

function resolveStatusesFromConfig(): { statuses: string[]; terminal: string[] } {
  const defaults = {
    statuses: [...DEFAULT_STATUSES],
    terminal: [...DEFAULT_TERMINAL_STATUSES],
  };

  const toml = readConfigToml();
  if (!toml.trim()) return defaults;

  try {
    const statusLine = toml
      .split("\n")
      .map((l) => l.replace(/#.*/g, "").trim())
      .find((l) => l.startsWith("statuses"));
    const terminalLine = toml
      .split("\n")
      .map((l) => l.replace(/#.*/g, "").trim())
      .find((l) => l.startsWith("terminal_statuses"));

    let statuses = defaults.statuses;
    let terminal = defaults.terminal;

    if (statusLine) {
      const rhs = statusLine.split("=").slice(1).join("=").trim();
      const parsed = parseTomlStringArray(rhs);
      if (parsed.length > 0) statuses = parsed;
    }

    if (terminalLine) {
      const rhs = terminalLine.split("=").slice(1).join("=").trim();
      const parsed = parseTomlStringArray(rhs);
      if (parsed.length > 0) terminal = parsed;
    }

    terminal = terminal.filter((s) => statuses.includes(s));
    return { statuses, terminal };
  } catch {
    return defaults;
  }
}

export function getKnownStatuses(): string[] {
  return resolveStatusesFromConfig().statuses;
}

export function getTerminalStatuses(): string[] {
  return resolveStatusesFromConfig().terminal;
}

// --- Migration ---

function migrateLegacyStoreIfNeeded(): void {
  const explicitTasksPath = Boolean(Bun.env.TODAI_TASKS_PATH ?? process.env.TODAI_TASKS_PATH);
  if (explicitTasksPath) return;
  if (STORE_PATH !== DEFAULT_STORE_PATH) return;
  if (!existsSync(LEGACY_STORE_PATH) || existsSync(DEFAULT_STORE_PATH)) return;

  mkdirSync(dirname(DEFAULT_STORE_PATH), { recursive: true });
  renameSync(LEGACY_STORE_PATH, DEFAULT_STORE_PATH);

  if (!migrationNoticePrinted) {
    migrationNoticePrinted = true;
    console.log("Migrated tasks.json to ~/.todai/data/tasks.json");
  }
}

// --- Store CRUD ---

export function readStore(): Store {
  migrateLegacyStoreIfNeeded();

  if (!existsSync(STORE_PATH)) {
    return { tasks: [], events: [] };
  }

  const raw = readFileSync(STORE_PATH, "utf-8");
  const parsed = JSON.parse(raw) as Partial<Store>;
  if (!parsed || !Array.isArray(parsed.tasks)) return { tasks: [], events: [] };

  const tasks = parsed.tasks.map((task) => ({
    ...task,
    space: task.space ?? "default",
    priority: task.priority ?? "medium",
    labels: Array.isArray(task.labels) ? task.labels : [],
  })) as Task[];

  const events = Array.isArray(parsed.events) ? parsed.events : [];
  return { tasks, events };
}

export function writeStore(store: Store): void {
  mkdirSync(dirname(STORE_PATH), { recursive: true });
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2) + "\n", "utf-8");
}

export function appendEvent(
  store: Store,
  event: Omit<TaskEvent, "timestamp"> & { timestamp?: string },
): void {
  store.events.push({
    timestamp: event.timestamp ?? new Date().toISOString(),
    ...event,
  });
}

export function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getOpenTasks(): Task[] {
  const terminal = new Set(getTerminalStatuses());
  return readStore().tasks.filter((task) => !terminal.has(task.status));
}

export function listSpaces(store: Store): string[] {
  const spaces = new Set<string>();
  for (const task of store.tasks) {
    spaces.add(task.space || "default");
  }
  if (spaces.size === 0) spaces.add("default");
  return [...spaces].sort();
}

// --- Task operations ---

export function addTask(
  owner: Owner,
  title: string,
  opts?: {
    desc?: string;
    space?: string;
    priority?: TaskPriority;
    labels?: string[];
    parentId?: string;
  },
): Task {
  const now = new Date().toISOString();
  const task: Task = {
    id: generateId(),
    owner,
    title,
    desc: opts?.desc,
    space: opts?.space ?? "default",
    priority: opts?.priority ?? "medium",
    labels: opts?.labels ?? [],
    parentId: opts?.parentId,
    status: "backlog",
    createdAt: now,
    updatedAt: now,
  };

  const store = readStore();
  store.tasks.push(task);
  appendEvent(store, {
    type: "created",
    taskId: task.id,
    actor: owner,
    payload: {
      title: task.title,
      space: task.space,
      priority: task.priority,
      parentId: task.parentId ?? null,
      labels: task.labels,
    },
  });
  writeStore(store);
  return task;
}

export function doneTask(id: string): { task: Task; beforeStatus: string; changes: Record<string, { from: unknown; to: unknown }> } {
  const store = readStore();
  const task = store.tasks.find((x) => x.id === id);
  if (!task) throw new Error(`task not found: ${id}`);

  const beforeStatus = task.status;
  task.status = "done";
  task.updatedAt = new Date().toISOString();

  const changes = { status: { from: beforeStatus, to: "done" } };

  if (beforeStatus !== "done") {
    appendEvent(store, {
      type: "status_changed",
      taskId: task.id,
      actor: task.owner,
      payload: { from: beforeStatus, to: "done" },
    });
  }

  appendEvent(store, {
    type: "completed",
    taskId: task.id,
    actor: task.owner,
  });
  writeStore(store);

  return { task, beforeStatus, changes };
}

export function updateTask(
  id: string,
  patch: {
    owner?: Owner;
    title?: string;
    desc?: string;
    space?: string;
    priority?: TaskPriority;
    status?: TaskStatus;
    parentId?: string;
    labels?: string[];
  },
): { task: Task; before: Record<string, unknown>; changes: Record<string, { from: unknown; to: unknown }> } {
  const store = readStore();
  const task = store.tasks.find((x) => x.id === id);
  if (!task) throw new Error(`task not found: ${id}`);

  if (patch.parentId) {
    if (patch.parentId === id) throw new Error("--parent cannot reference itself");
    const parentExists = store.tasks.some((t) => t.id === patch.parentId);
    if (!parentExists) throw new Error(`parent task not found: ${patch.parentId}`);
  }

  const before = {
    owner: task.owner,
    title: task.title,
    desc: task.desc,
    space: task.space,
    priority: task.priority,
    status: task.status,
    parentId: task.parentId,
    labels: [...task.labels],
  };

  if (patch.owner !== undefined) task.owner = patch.owner;
  if (patch.title !== undefined) task.title = patch.title;
  if (patch.desc !== undefined) task.desc = patch.desc;
  if (patch.space !== undefined) task.space = patch.space;
  if (patch.priority !== undefined) task.priority = patch.priority;
  if (patch.status !== undefined) task.status = patch.status;
  if (patch.parentId !== undefined) task.parentId = patch.parentId;
  if (patch.labels !== undefined) task.labels = patch.labels;

  task.updatedAt = new Date().toISOString();

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(before) as (keyof typeof before)[]) {
    const beforeVal = (before as any)[key];
    const afterVal = (task as any)[key];
    if (JSON.stringify(beforeVal) !== JSON.stringify(afterVal)) {
      changes[String(key)] = { from: beforeVal ?? null, to: afterVal ?? null };
    }
  }

  if (before.status !== task.status) {
    appendEvent(store, {
      type: "status_changed",
      taskId: task.id,
      actor: task.owner,
      payload: { from: before.status, to: task.status },
    });
  }

  appendEvent(store, {
    type: "updated",
    taskId: task.id,
    actor: task.owner,
    payload: {
      before,
      after: {
        owner: task.owner,
        title: task.title,
        desc: task.desc,
        space: task.space,
        priority: task.priority,
        status: task.status,
        parentId: task.parentId,
        labels: task.labels,
      },
    },
  });

  writeStore(store);

  return { task, before, changes };
}
