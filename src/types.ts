export type Owner = "you" | "kai" | "olga" | "engineer";
export type TaskStatus = string;
export type TaskPriority = "low" | "medium" | "high" | "urgent";

export type Task = {
  id: string;
  owner: Owner;
  title: string;
  desc?: string;
  status: TaskStatus;
  space: string;
  priority: TaskPriority;
  labels: string[];
  parentId?: string;
  createdAt: string;
  updatedAt: string;
};

export type TaskEvent = {
  type: string;
  taskId: string;
  timestamp: string;
  actor?: string;
  payload?: Record<string, unknown>;
};

export type Store = { tasks: Task[]; events: TaskEvent[] };

export const OWNERS = ["you", "kai", "olga", "engineer"] as const;
export const DEFAULT_STATUSES = ["backlog", "open", "in-progress", "blocked", "done", "cancelled"] as const;
export const DEFAULT_TERMINAL_STATUSES = ["done", "cancelled"] as const;
export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export const TASK_LIST_FIELDS = ["id", "status", "space", "owner", "priority", "labels", "title", "parentId", "desc", "createdAt", "updatedAt"] as const;
export type TaskListField = (typeof TASK_LIST_FIELDS)[number];
