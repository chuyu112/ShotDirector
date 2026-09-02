#!/usr/bin/env node
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const [payloadBase64, expectedCountText, targetUser, targetProject] = process.argv.slice(2);
const expectedCount = Number(expectedCountText);
if (!payloadBase64 || !Number.isInteger(expectedCount) || expectedCount < 1 || !targetUser || !targetProject) {
  throw new Error("usage: resume-media-job-admin.mjs <payload-base64> <expected-count> <user-id> <project-id>");
}

function processEnvironment(pid) {
  const entries = readFileSync(`/proc/${pid}/environ`, "utf8").split("\0").filter(Boolean);
  return Object.fromEntries(entries.map((entry) => {
    const separator = entry.indexOf("=");
    return separator < 1 ? [entry, ""] : [entry.slice(0, separator), entry.slice(separator + 1)];
  }));
}

let worker;
for (const name of readdirSync("/proc")) {
  if (!/^\d+$/.test(name)) continue;
  try {
    const environment = processEnvironment(name);
    if (environment.MANJING_TENANT_ID === targetUser
      && environment.MANJING_PROJECT_ID === targetProject
      && environment.MANJING_INTERNAL_TOKEN
      && environment.MANJING_BRIDGE_PORT) {
      worker = environment;
      break;
    }
  } catch {
    // Processes may disappear while /proc is being scanned.
  }
}
if (!worker) throw new Error("没有找到当前项目 Worker");

const uploadDirectory = join(worker.MANJING_DATA_ROOT, "work", "shotdirector-media", "uploads");
const files = readdirSync(uploadDirectory)
  .filter((name) => /^[a-f0-9-]{36}\.json$/i.test(name))
  .map((name) => JSON.parse(readFileSync(join(uploadDirectory, name), "utf8")))
  .filter((value) => value.kind === "manga" && Number.isFinite(Date.parse(value.uploadedAt)))
  .sort((left, right) => Date.parse(right.uploadedAt) - Date.parse(left.uploadedAt));
if (!files.length) throw new Error("没有找到漫画上传记录");

const batch = [files[0]];
let previous = Date.parse(files[0].uploadedAt);
for (const file of files.slice(1)) {
  const uploadedAt = Date.parse(file.uploadedAt);
  if (previous - uploadedAt > 120_000 || batch.length >= 40) break;
  batch.push(file);
  previous = uploadedAt;
}
batch.reverse();
if (batch.length !== expectedCount) {
  throw new Error(`最新上传批次不是 ${expectedCount} 张，而是 ${batch.length} 张`);
}

const payload = JSON.parse(Buffer.from(payloadBase64, "base64").toString("utf8"));
payload.mediaIds = batch.map((file) => file.mediaId);
const response = await fetch(`http://127.0.0.1:${worker.MANJING_BRIDGE_PORT}/media-analyze`, {
  method: "POST",
  headers: {
    Origin: "http://localhost:3000",
    "Content-Type": "application/json",
    "X-Manjing-Token": worker.MANJING_INTERNAL_TOKEN,
  },
  body: JSON.stringify(payload),
});
const body = await response.json().catch(() => ({}));
process.stdout.write(`${JSON.stringify({
  httpStatus: response.status,
  uploadCount: batch.length,
  requestId: body.job?.requestId,
  status: body.job?.status,
  stage: body.job?.stage,
  message: body.job?.message,
  error: body.error,
})}\n`);
if (response.status !== 202) process.exitCode = 2;
