import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

// アクター: 人間もエージェントも対等な存在
export const actors = sqliteTable("actors", {
  id: text("id").primaryKey(), // ULID
  name: text("name").notNull(),
  type: text("type", { enum: ["human", "agent"] }).notNull(),
  metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
  createdAt: text("created_at").notNull().default("(datetime('now'))"),
  updatedAt: text("updated_at").notNull().default("(datetime('now'))"),
});

// タスク本体
export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(), // ULID
  title: text("title").notNull(),
  description: text("description"),
  status: text("status", {
    enum: ["pending", "in_progress", "done", "cancelled"],
  })
    .notNull()
    .default("pending"),
  priority: text("priority", {
    enum: ["low", "medium", "high", "urgent"],
  })
    .notNull()
    .default("medium"),
  parentId: text("parent_id").references((): ReturnType<typeof text> => tasks.id),
  dueAt: text("due_at"),
  createdBy: text("created_by")
    .notNull()
    .references(() => actors.id),
  createdAt: text("created_at").notNull().default("(datetime('now'))"),
  updatedAt: text("updated_at").notNull().default("(datetime('now'))"),
});

// タスクのアサイン（多対多）
export const taskAssignments = sqliteTable("task_assignments", {
  id: text("id").primaryKey(), // ULID
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  actorId: text("actor_id")
    .notNull()
    .references(() => actors.id, { onDelete: "cascade" }),
  assignedAt: text("assigned_at").notNull().default("(datetime('now'))"),
});

// タスクイベント: 状態変更やアクションの履歴
export const taskEvents = sqliteTable("task_events", {
  id: text("id").primaryKey(), // ULID
  taskId: text("task_id")
    .notNull()
    .references(() => tasks.id, { onDelete: "cascade" }),
  actorId: text("actor_id")
    .notNull()
    .references(() => actors.id),
  type: text("type", {
    enum: [
      "created",
      "status_changed",
      "assigned",
      "unassigned",
      "commented",
      "due_date_changed",
      "priority_changed",
    ],
  }).notNull(),
  payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>(),
  createdAt: text("created_at").notNull().default("(datetime('now'))"),
});

// イベントトリガー: イベント発火時のコマンド実行定義
export const eventTriggers = sqliteTable("event_triggers", {
  id: text("id").primaryKey(), // ULID
  name: text("name").notNull(),
  eventType: text("event_type").notNull(), // taskEvents.type と対応
  filter: text("filter", { mode: "json" }).$type<Record<string, unknown>>(), // 条件フィルタ
  command: text("command").notNull(), // 実行するコマンド
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default("(datetime('now'))"),
  updatedAt: text("updated_at").notNull().default("(datetime('now'))"),
});

// リレーション定義
export const actorsRelations = relations(actors, ({ many }) => ({
  createdTasks: many(tasks, { relationName: "createdTasks" }),
  assignments: many(taskAssignments),
  events: many(taskEvents),
}));

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  createdBy: one(actors, {
    fields: [tasks.createdBy],
    references: [actors.id],
    relationName: "createdTasks",
  }),
  parent: one(tasks, {
    fields: [tasks.parentId],
    references: [tasks.id],
    relationName: "subtasks",
  }),
  subtasks: many(tasks, { relationName: "subtasks" }),
  assignments: many(taskAssignments),
  events: many(taskEvents),
}));

export const taskAssignmentsRelations = relations(
  taskAssignments,
  ({ one }) => ({
    task: one(tasks, {
      fields: [taskAssignments.taskId],
      references: [tasks.id],
    }),
    actor: one(actors, {
      fields: [taskAssignments.actorId],
      references: [actors.id],
    }),
  }),
);

export const taskEventsRelations = relations(taskEvents, ({ one }) => ({
  task: one(tasks, {
    fields: [taskEvents.taskId],
    references: [tasks.id],
  }),
  actor: one(actors, {
    fields: [taskEvents.actorId],
    references: [actors.id],
  }),
}));
