import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const bridgePath = new URL("../scripts/shotdirector-bridge.mjs", import.meta.url);
const mediaLabPath = new URL("../app/media-lab.tsx", import.meta.url);

test("interrupted media jobs preserve uploads and expose a continue action", async () => {
  const source = await readFile(mediaLabPath, "utf8");

  assert.match(source, /已完成的拆图进度仍已保留/);
  assert.match(source, /无需清空或重新上传/);
  assert.match(source, /startAnalysis\(job\.requestId\)/);
  assert.match(source, /\.\.\.\(resumeRequestId \? \{ resumeRequestId \} : \{\}\)/);
  assert.doesNotMatch(source, /请清空当前任务后重新开始/);
});

test("server checkpoints media jobs and resumes the same request id", async () => {
  const source = await readFile(bridgePath, "utf8");

  assert.match(source, /restoreInterruptedMediaJobs\(\)/);
  assert.match(source, /analysis-request\.json/);
  assert.match(source, /analysis-job\.json/);
  assert.match(source, /const requestId = resumeRequestId \|\| randomUUID\(\)/);
  assert.match(source, /retryPolicy = "resume-from-checkpoint"/);
  assert.match(source, /persistMediaAnalysisJob\(job, analysisPayload\)/);
  assert.match(source, /persistMediaAnalysisJob\(job\)/);
});

test("resume reuses each valid batch checkpoint before making another model call", async () => {
  const source = await readFile(bridgePath, "utf8");

  assert.match(source, /function reusableStructuredCheckpoint\(/);
  assert.match(source, /checkpoint-reused/);
  assert.match(source, /reusableStructuredCheckpoint\(batchOutputPath, \(candidate\) => validateMangaPanelBoxes/);
  assert.match(source, /const validateBatch = \(candidate\) => validateMediaAnalysisResult\(/);
  assert.match(source, /normalizeMangaAnalysisBatchNumbering\(candidate, scope\)/);
  assert.match(source, /reusableStructuredCheckpoint\(batchOutputPath, validateBatch\)/);
  assert.match(source, /reusableStructuredCheckpoint\(batchOutputPath, \(candidate\) => validateMangaPanelRecut/);
});
