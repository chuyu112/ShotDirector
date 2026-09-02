import {
  appendFile,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  MANJING_PI_HARNESS_VERSION,
  MANJING_PI_SESSION_PROTOCOL_VERSION,
  manjingHarnessSessionId,
} from "./manjing-pi-harness.mjs";
import { runManjingAgentTurn } from "./manjing-agent-runtime.mjs";

const HISTORY_LIMIT = 50;
const writeQueues = new Map();

function safePart(value, fallback) {
  const normalized = String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "")
    .slice(0, 180);
  return normalized || fallback;
}

function serialized(path, action) {
  const previous = writeQueues.get(path) || Promise.resolve();
  const next = previous.catch(() => undefined).then(action);
  writeQueues.set(path, next);
  return next.finally(() => {
    if (writeQueues.get(path) === next) writeQueues.delete(path);
  });
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function atomicJsonWrite(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${crypto.randomUUID()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

function publicError(error) {
  if (error?.name === "AbortError") return "Agent 已取消";
  return error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000);
}

export class ManjingHarnessStore {
  constructor(root = join(process.cwd(), "work", "manjing-harness")) {
    this.root = root;
    this.sessionsPath = join(root, "sessions");
    this.runsPath = join(root, "runs");
    this.historyPath = join(root, "history");
    this.eventsPath = join(root, "events.jsonl");
  }

  sessionPath(sessionId) {
    return join(this.sessionsPath, `${safePart(sessionId, "session")}.json`);
  }

  runPath(runId) {
    return join(this.runsPath, `${safePart(runId, "run")}.json`);
  }

  async loadSession(job) {
    const expectedSessionId = manjingHarnessSessionId(job);
    const value = await readJson(this.sessionPath(expectedSessionId));
    if (
      !value || value.harnessVersion !== MANJING_PI_HARNESS_VERSION ||
      value.protocolVersion !== MANJING_PI_SESSION_PROTOCOL_VERSION ||
      value.sessionId !== expectedSessionId || !Number.isInteger(value.stateVersion) ||
      value.stateVersion < 0 || !Array.isArray(value.messages)
    ) return null;
    return value;
  }

  async beginRun(job) {
    const startedAt = new Date().toISOString();
    const sessionId = manjingHarnessSessionId(job);
    const record = {
      harnessVersion: MANJING_PI_HARNESS_VERSION,
      protocolVersion: MANJING_PI_SESSION_PROTOCOL_VERSION,
      runId: String(job.id),
      conversationId: String(job.conversationId),
      sessionId,
      agentRole: job.agentRole,
      modelId: job.textModelId || job.modelId || null,
      kind: job.kind || null,
      status: "running",
      startedAt,
      updatedAt: startedAt,
    };
    await serialized(this.runPath(job.id), () => atomicJsonWrite(this.runPath(job.id), record));
    return record;
  }

  async appendEvents(events) {
    if (!Array.isArray(events) || !events.length) return;
    const lines = `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
    await mkdir(this.root, { recursive: true });
    await serialized(this.eventsPath, () => appendFile(this.eventsPath, lines, "utf8"));
  }

  async saveCheckpoint(checkpoint) {
    if (!checkpoint || checkpoint.harnessVersion !== MANJING_PI_HARNESS_VERSION) {
      throw new TypeError("无法保存无效的 Pi Harness 检查点");
    }
    const path = this.sessionPath(checkpoint.sessionId);
    await serialized(path, async () => {
      const current = await readJson(path);
      const expectedVersion = Number(checkpoint.baseStateVersion);
      const currentVersion = current ? Number(current.stateVersion) : 0;
      if (!Number.isInteger(expectedVersion) || expectedVersion !== currentVersion) {
        throw new Error(`Pi Session 版本冲突：期望 ${expectedVersion}，当前 ${currentVersion}`);
      }
      if (current) {
        await mkdir(this.historyPath, { recursive: true });
        const snapshot = join(
          this.historyPath,
          `${safePart(checkpoint.sessionId, "session")}-${String(currentVersion).padStart(6, "0")}-${Date.now()}.json`,
        );
        await copyFile(path, snapshot);
      }
      await atomicJsonWrite(path, {
        harnessVersion: checkpoint.harnessVersion,
        protocolVersion: checkpoint.protocolVersion,
        sessionId: checkpoint.sessionId,
        stateVersion: currentVersion + 1,
        messages: checkpoint.messages,
        ...(checkpoint.compaction ? { compaction: checkpoint.compaction } : {}),
        lastRunId: checkpoint.runId,
        updatedAt: new Date().toISOString(),
      });
      await this.pruneHistory(checkpoint.sessionId);
    });
  }

  async pruneHistory(sessionId) {
    let files = [];
    try {
      files = (await readdir(this.historyPath))
        .filter((name) => name.startsWith(`${safePart(sessionId, "session")}-`) && name.endsWith(".json"))
        .sort();
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    for (const name of files.slice(0, Math.max(0, files.length - HISTORY_LIMIT))) {
      await unlink(join(this.historyPath, basename(name)));
    }
  }

  async finishRun(job, status, detail = {}) {
    const path = this.runPath(job.id);
    await serialized(path, async () => {
      const current = await readJson(path);
      const finishedAt = new Date().toISOString();
      await atomicJsonWrite(path, {
        ...(current || {}),
        runId: String(job.id),
        conversationId: String(job.conversationId),
        sessionId: manjingHarnessSessionId(job),
        status,
        ...detail,
        finishedAt,
        updatedAt: finishedAt,
      });
    });
  }

  async status(limit = 20) {
    let files = [];
    try {
      files = (await readdir(this.runsPath)).filter((name) => name.endsWith(".json"));
    } catch (error) {
      if (error?.code === "ENOENT") return { harnessVersion: MANJING_PI_HARNESS_VERSION, runs: [] };
      throw error;
    }
    const records = (await Promise.all(files.map((name) => readJson(join(this.runsPath, name)))))
      .filter(Boolean)
      .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")))
      .slice(0, Math.max(1, Math.min(100, Number(limit) || 20)));
    return { harnessVersion: MANJING_PI_HARNESS_VERSION, runs: records };
  }
}

/** Execute a durable Session/Run and append its complete redacted event batch. */
export async function runPersistentManjingAgentTurn({
  store = new ManjingHarnessStore(),
  job,
  onHarnessEvent,
  ...options
}) {
  if (!job?.id || !job?.conversationId) throw new TypeError("持久 Harness 任务缺少 Run 或 Session 标识");
  const task = {
    ...job,
    agentRole: job.agentRole === "review" || job.agentRole === "memory" ? job.agentRole : "creator",
  };
  const harnessSession = task.agentRole === "creator" ? await store.loadSession(task) : null;
  const events = [];
  await store.beginRun(task);
  try {
    const result = await runManjingAgentTurn({
      ...options,
      job: { ...task, ...(harnessSession ? { harnessSession } : {}) },
      prompt: options.prompt,
      onHarnessEvent: (event) => {
        events.push(event);
        onHarnessEvent?.(event);
      },
    });
    await store.appendEvents(events);
    await store.saveCheckpoint(result.harnessCheckpoint);
    await store.finishRun(task, "completed", {
      eventCount: events.length,
      checkpointStateVersion: result.harnessCheckpoint.baseStateVersion + 1,
    });
    return result;
  } catch (error) {
    await store.appendEvents(events).catch(() => undefined);
    await store.finishRun(task, error?.name === "AbortError" ? "aborted" : "failed", {
      eventCount: events.length,
      error: publicError(error),
    }).catch(() => undefined);
    throw error;
  }
}
