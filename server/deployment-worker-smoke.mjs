import { mkdtemp, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { TenantWorkerPool } from "./tenant-worker-pool.mjs";

const appRoot = resolve(process.env.MANJING_APP_ROOT || process.cwd());
const parentRoot = resolve(process.env.MANJING_DEPLOY_SMOKE_PARENT || "/var/lib/manjing");
const smokeRoot = await mkdtemp(join(parentRoot, ".deploy-worker-smoke-"));
const workerPool = new TenantWorkerPool({
  appRoot,
  dataRoot: smokeRoot,
  maxWorkers: 1,
  maxWorkersPerUser: 1,
  idleTimeoutMs: 60_000,
  idleSweepIntervalMs: 60_000,
  shutdownWaitMs: 5_000,
  terminateTimeoutMs: 2_000,
  killTimeoutMs: 1_000,
  startupTimeoutMs: 30_000,
});

try {
  const worker = await workerPool.get({ userId: "deploy-smoke", projectId: "deploy-smoke" });
  const response = await fetch(`http://127.0.0.1:${worker.port}/health`, {
    headers: {
      Origin: "http://localhost:3000",
      "X-Manjing-Token": worker.token,
    },
    signal: AbortSignal.timeout(2_000),
  });
  if (!response.ok) throw new Error(`worker health returned HTTP ${response.status}`);
  const health = await response.json();
  if (health?.connected !== true || health?.modelProvider?.configured !== true) {
    throw new Error("worker health did not confirm a configured writing provider");
  }
  process.stdout.write(`${JSON.stringify({
    ok: true,
    provider: health.modelProvider.id,
    model: health.modelProvider.model,
  })}\n`);
} finally {
  await workerPool.stopAll();
  await rm(smokeRoot, { recursive: true, force: true });
}
