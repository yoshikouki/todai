import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// We need to set TODAI_HOME before importing store
const tmpDir = join(import.meta.dir, "../.test-store-" + process.pid);

beforeEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(join(tmpDir, "data"), { recursive: true });
  process.env.TODAI_HOME = tmpDir;
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.TODAI_HOME;
});

// Dynamic import to pick up env
async function getStore() {
  // Clear module cache to get fresh TODAI_HOME
  const mod = await import("./store.ts");
  return mod;
}

describe("store CRUD", () => {
  test("readStore returns empty store when no file", async () => {
    const { readStore } = await getStore();
    const store = readStore();
    expect(store.tasks).toEqual([]);
    expect(store.events).toEqual([]);
  });

  test("addTask creates a task and persists", async () => {
    const { addTask, readStore } = await getStore();
    const task = addTask("engineer", "test task", { space: "test", priority: "high" });

    expect(task.owner).toBe("engineer");
    expect(task.title).toBe("test task");
    expect(task.space).toBe("test");
    expect(task.priority).toBe("high");
    expect(task.status).toBe("backlog");
    expect(task.id).toBeTruthy();

    const store = readStore();
    expect(store.tasks.length).toBe(1);
    expect(store.tasks[0].id).toBe(task.id);
    expect(store.events.length).toBe(1);
    expect(store.events[0].type).toBe("created");
  });

  test("doneTask marks task as done", async () => {
    const { addTask, doneTask, readStore } = await getStore();
    const task = addTask("you", "done test");
    const { task: doneT, beforeStatus } = doneTask(task.id);

    expect(doneT.status).toBe("done");
    expect(beforeStatus).toBe("backlog");

    const store = readStore();
    expect(store.tasks[0].status).toBe("done");
  });

  test("doneTask throws for nonexistent id", async () => {
    const { doneTask } = await getStore();
    expect(() => doneTask("nonexistent")).toThrow("task not found");
  });

  test("updateTask updates fields", async () => {
    const { addTask, updateTask, readStore } = await getStore();
    const task = addTask("you", "update test");
    const { task: updated } = updateTask(task.id, { title: "updated title", priority: "urgent" });

    expect(updated.title).toBe("updated title");
    expect(updated.priority).toBe("urgent");

    const store = readStore();
    expect(store.tasks[0].title).toBe("updated title");
  });

  test("updateTask rejects self-referencing parent", async () => {
    const { addTask, updateTask } = await getStore();
    const task = addTask("you", "self ref");
    expect(() => updateTask(task.id, { parentId: task.id })).toThrow("cannot reference itself");
  });

  test("listSpaces returns unique sorted spaces", async () => {
    const { addTask, readStore, listSpaces } = await getStore();
    addTask("you", "a", { space: "beta" });
    addTask("you", "b", { space: "alpha" });
    addTask("you", "c", { space: "beta" });

    const spaces = listSpaces(readStore());
    expect(spaces).toEqual(["alpha", "beta"]);
  });

  test("getOpenTasks excludes done/cancelled", async () => {
    const { addTask, doneTask, getOpenTasks } = await getStore();
    addTask("you", "open task");
    const t2 = addTask("you", "done task");
    doneTask(t2.id);

    const open = getOpenTasks();
    expect(open.length).toBe(1);
    expect(open[0].title).toBe("open task");
  });
});
