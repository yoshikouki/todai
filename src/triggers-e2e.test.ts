import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, chmodSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * E2E test: create trigger scripts in a temp dir, run todai commands, verify triggers fired.
 */
describe("triggers e2e", () => {
  const tmpDir = join(import.meta.dir, "../.test-e2e-" + process.pid);
  const triggersDir = join(tmpDir, "triggers");
  const dataDir = join(tmpDir, "data");
  const logsDir = join(tmpDir, "logs");
  const markerFile = join(tmpDir, "trigger-fired.txt");

  beforeEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(triggersDir, { recursive: true });
    mkdirSync(dataDir, { recursive: true });
    mkdirSync(logsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function createTrigger(name: string, script: string, subdir?: string) {
    const dir = subdir ? join(triggersDir, subdir) : triggersDir;
    mkdirSync(dir, { recursive: true });
    const path = join(dir, name);
    writeFileSync(path, script);
    chmodSync(path, 0o755);
  }

  async function runTodai(...args: string[]): Promise<string> {
    const proc = Bun.spawn({
      cmd: ["bun", "run", join(import.meta.dir, "index.tsx"), ...args],
      env: {
        ...process.env,
        TODAI_HOME: tmpDir,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const text = await new Response(proc.stdout).text();
    await proc.exited;
    return text.trim();
  }

  test("on-created trigger fires on task add", async () => {
    createTrigger("on-created", `#!/bin/bash\necho "CREATED: $TODAI_TASK_TITLE" >> "${markerFile}"\n`);

    const out = await runTodai("task", "add", "--owner", "you", "--title", "test-trigger-task");
    expect(out).toContain("added:");

    // Wait for fire-and-forget trigger
    await Bun.sleep(1500);

    expect(existsSync(markerFile)).toBe(true);
    const content = readFileSync(markerFile, "utf-8");
    expect(content).toContain("CREATED: test-trigger-task");
  });

  test("filtered trigger only fires when filter matches", async () => {
    const matchMarker = join(tmpDir, "match.txt");
    const noMatchMarker = join(tmpDir, "nomatch.txt");

    createTrigger("on-created@owner=you", `#!/bin/bash\necho "YES" >> "${matchMarker}"\n`);
    createTrigger("on-created@owner=kai", `#!/bin/bash\necho "NO" >> "${noMatchMarker}"\n`);

    await runTodai("task", "add", "--owner", "you", "--title", "filter-test");
    await Bun.sleep(1500);

    expect(existsSync(matchMarker)).toBe(true);
    expect(existsSync(noMatchMarker)).toBe(false);
  });

  test("on-done and on-status-changed both fire", async () => {
    const doneMarker = join(tmpDir, "done.txt");
    const statusMarker = join(tmpDir, "status.txt");

    createTrigger("on-done", `#!/bin/bash\necho "DONE" >> "${doneMarker}"\n`);
    createTrigger("on-status-changed", `#!/bin/bash\necho "STATUS" >> "${statusMarker}"\n`);

    const addOut = await runTodai("task", "add", "--owner", "you", "--title", "done-test");
    const idMatch = addOut.match(/added: (\S+)/);
    expect(idMatch).not.toBeNull();
    const taskId = idMatch![1];

    await runTodai("task", "done", "--id", taskId);
    await Bun.sleep(1500);

    expect(existsSync(doneMarker)).toBe(true);
    expect(existsSync(statusMarker)).toBe(true);
  });

  test(".d/ directory scripts fire in order", async () => {
    const orderMarker = join(tmpDir, "order.txt");

    mkdirSync(join(triggersDir, "on-created.d"), { recursive: true });
    createTrigger("01-second.sh", `#!/bin/bash\necho "SECOND" >> "${orderMarker}"\n`, "on-created.d");
    createTrigger("00-first.sh", `#!/bin/bash\necho "FIRST" >> "${orderMarker}"\n`, "on-created.d");

    await runTodai("task", "add", "--owner", "you", "--title", "order-test");
    await Bun.sleep(1500);

    expect(existsSync(orderMarker)).toBe(true);
    const content = readFileSync(orderMarker, "utf-8").trim().split("\n");
    expect(content).toEqual(["FIRST", "SECOND"]);
  });

  test("stdin JSON is passed to trigger", async () => {
    createTrigger("on-created", `#!/bin/bash\ncat > "${markerFile}"\n`);

    await runTodai("task", "add", "--owner", "engineer", "--title", "stdin-test");
    await Bun.sleep(1500);

    expect(existsSync(markerFile)).toBe(true);
    const payload = JSON.parse(readFileSync(markerFile, "utf-8"));
    expect(payload.event).toBe("created");
    expect(payload.task.title).toBe("stdin-test");
    expect(payload.task.owner).toBe("engineer");
    expect(payload.changes).toBeNull();
  });
});
