import { join } from "node:path";

type PathSource = "default" | "derived" | `env:${string}`;

type ResolvedPath = {
  value: string;
  source: PathSource;
};

type Paths = {
  home: ResolvedPath;
  dirs: {
    config: ResolvedPath;
    data: ResolvedPath;
    logs: ResolvedPath;
    run: ResolvedPath;
    metrics: ResolvedPath;
    tmp: ResolvedPath;
  };
  files: {
    configToml: ResolvedPath;
    tasksJson: ResolvedPath;
    todaiLog: ResolvedPath;
    heartbeatTs: ResolvedPath;
    metricsProm: ResolvedPath;
  };
};

const FALLBACK_HOME = join(
  Bun.env.HOME ?? process.env.HOME ?? ".",
  ".todai",
);

function pickHome(): ResolvedPath {
  const fromEnv = Bun.env.TODAI_HOME ?? process.env.TODAI_HOME;
  if (fromEnv) {
    return { value: fromEnv, source: "env:TODAI_HOME" };
  }
  return { value: FALLBACK_HOME, source: "default" };
}

function pickPath(
  envName: string,
  derivedValue: string,
  homeSource: PathSource,
): ResolvedPath {
  const envValue = Bun.env[envName] ?? process.env[envName];
  if (envValue) {
    return { value: envValue, source: `env:${envName}` };
  }

  if (homeSource === "default") {
    return { value: derivedValue, source: "default" };
  }

  return { value: derivedValue, source: "derived" };
}

export function resolvePaths(): Paths {
  const home = pickHome();

  const dirs = {
    config: pickPath("TODAI_CONFIG_DIR", join(home.value, "config"), home.source),
    data: pickPath("TODAI_DATA_DIR", join(home.value, "data"), home.source),
    logs: pickPath("TODAI_LOGS_DIR", join(home.value, "logs"), home.source),
    run: pickPath("TODAI_RUN_DIR", join(home.value, "run"), home.source),
    metrics: pickPath("TODAI_METRICS_DIR", join(home.value, "metrics"), home.source),
    tmp: pickPath("TODAI_TMP_DIR", join(home.value, "tmp"), home.source),
  };

  const files = {
    configToml: pickPath(
      "TODAI_CONFIG_PATH",
      join(dirs.config.value, "config.toml"),
      home.source,
    ),
    tasksJson: pickPath(
      "TODAI_TASKS_PATH",
      join(dirs.data.value, "tasks.json"),
      home.source,
    ),
    todaiLog: pickPath(
      "TODAI_LOG_PATH",
      join(dirs.logs.value, "todai.log"),
      home.source,
    ),
    heartbeatTs: pickPath(
      "TODAI_HEARTBEAT_PATH",
      join(dirs.run.value, "heartbeat.ts"),
      home.source,
    ),
    metricsProm: pickPath(
      "TODAI_METRICS_PATH",
      join(dirs.metrics.value, "todai.prom"),
      home.source,
    ),
  };

  return { home, dirs, files };
}
