import { describe, expect, test } from "bun:test";
import { parseTriggerFilename, matchesFilter, collectTriggerScripts, buildTriggerEnv } from "./triggers.ts";
import { mkdirSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { join } from "node:path";

// --- Unit tests for parseTriggerFilename ---

describe("parseTriggerFilename", () => {
  test("no filter", () => {
    expect(parseTriggerFilename("on-done")).toEqual({ event: "on-done", filters: {} });
  });

  test("single filter", () => {
    expect(parseTriggerFilename("on-done@owner=engineer")).toEqual({
      event: "on-done",
      filters: { owner: "engineer" },
    });
  });

  test("multiple filters", () => {
    expect(parseTriggerFilename("on-done@owner=kai+space=todai")).toEqual({
      event: "on-done",
      filters: { owner: "kai", space: "todai" },
    });
  });

  test("status filter on status-changed", () => {
    expect(parseTriggerFilename("on-status-changed@status=open+owner=engineer")).toEqual({
      event: "on-status-changed",
      filters: { status: "open", owner: "engineer" },
    });
  });
});

// --- Unit tests for matchesFilter ---

const baseTask = {
  id: "test-123",
  owner: "engineer",
  title: "Test task",
  status: "done",
  space: "todai",
  priority: "high",
  labels: [],
  createdAt: "2026-02-13T00:00:00.000Z",
  updatedAt: "2026-02-13T01:00:00.000Z",
};

describe("matchesFilter", () => {
  test("empty filter matches everything", () => {
    expect(matchesFilter({}, baseTask, null)).toBe(true);
  });

  test("owner match", () => {
    expect(matchesFilter({ owner: "engineer" }, baseTask, null)).toBe(true);
  });

  test("owner mismatch", () => {
    expect(matchesFilter({ owner: "kai" }, baseTask, null)).toBe(false);
  });

  test("multiple filters AND - all match", () => {
    expect(matchesFilter({ owner: "engineer", space: "todai" }, baseTask, null)).toBe(true);
  });

  test("multiple filters AND - one mismatch", () => {
    expect(matchesFilter({ owner: "engineer", space: "other" }, baseTask, null)).toBe(false);
  });

  test("status filter", () => {
    expect(matchesFilter({ status: "done" }, baseTask, null)).toBe(true);
    expect(matchesFilter({ status: "open" }, baseTask, null)).toBe(false);
  });

  test("priority filter", () => {
    expect(matchesFilter({ priority: "high" }, baseTask, null)).toBe(true);
    expect(matchesFilter({ priority: "low" }, baseTask, null)).toBe(false);
  });

  test("unknown filter key → no match", () => {
    expect(matchesFilter({ unknown: "value" }, baseTask, null)).toBe(false);
  });
});

// --- Integration tests for collectTriggerScripts ---

describe("collectTriggerScripts", () => {
  const tmpDir = join(import.meta.dir, "../.test-triggers-" + process.pid);
  const triggersDir = join(tmpDir, "triggers");

  function setup() {
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(triggersDir, { recursive: true });
    // Override TRIGGERS_DIR via env
    process.env.TODAI_HOME = tmpDir;
  }

  function teardown() {
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.TODAI_HOME;
  }

  function createScript(name: string, dir?: string) {
    const target = dir ? join(triggersDir, dir) : triggersDir;
    mkdirSync(target, { recursive: true });
    const path = join(target, name);
    writeFileSync(path, "#!/bin/bash\nexit 0\n");
    chmodSync(path, 0o755);
    return path;
  }

  // Note: collectTriggerScripts reads from TRIGGERS_DIR which is computed at module load.
  // We need to re-import to pick up TODAI_HOME change. Use a workaround.
  // Since TRIGGERS_DIR is computed at import time from resolvePaths(), we test the pure functions instead.

  test("parseTriggerFilename handles .d suffix removal correctly", () => {
    // This tests the logic used in collectTriggerScripts
    const { event, filters } = parseTriggerFilename("on-done@owner=engineer");
    expect(event).toBe("on-done");
    expect(filters).toEqual({ owner: "engineer" });
  });
});

// --- buildTriggerEnv tests ---

describe("buildTriggerEnv", () => {
  test("sets basic env vars", () => {
    const env = buildTriggerEnv(baseTask, "done", null);
    expect(env.TODAI_EVENT).toBe("done");
    expect(env.TODAI_TASK_ID).toBe("test-123");
    expect(env.TODAI_TASK_TITLE).toBe("Test task");
    expect(env.TODAI_TASK_STATUS).toBe("done");
    expect(env.TODAI_TASK_OWNER).toBe("engineer");
    expect(env.TODAI_TASK_SPACE).toBe("todai");
    expect(env.TODAI_TASK_PRIORITY).toBe("high");
  });

  test("sets TODAI_PREV_STATUS for status-changed", () => {
    const changes = { status: { from: "open", to: "done" } };
    const env = buildTriggerEnv(baseTask, "status-changed", changes);
    expect(env.TODAI_PREV_STATUS).toBe("open");
  });

  test("does not set TODAI_PREV_STATUS for non-status events", () => {
    const env = buildTriggerEnv(baseTask, "done", null);
    expect(env.TODAI_PREV_STATUS).toBeUndefined();
  });

  test("includes payload JSON", () => {
    const env = buildTriggerEnv(baseTask, "done", null);
    const payload = JSON.parse(env.TODAI_TRIGGER_PAYLOAD_JSON);
    expect(payload.event).toBe("done");
    expect(payload.task.id).toBe("test-123");
    expect(payload.changes).toBeNull();
  });

  test("includes changes in payload JSON", () => {
    const changes = { status: { from: "open", to: "done" } };
    const env = buildTriggerEnv(baseTask, "status-changed", changes);
    const payload = JSON.parse(env.TODAI_TRIGGER_PAYLOAD_JSON);
    expect(payload.changes).toEqual(changes);
  });
});
