import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

function values(text) {
  return Object.fromEntries(String(text).trim().split(/\r?\n/u).flatMap((line) => {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u);
    if (!match) return [];
    let value = match[2].trim();
    if (value.startsWith('"')) value = JSON.parse(value);
    return [[match[1], value]];
  }));
}

test("deployment model env merge maps only the Cuiyi allowlist and preserves server settings", () => {
  const root = mkdtempSync(join(tmpdir(), "manjing-env-merge-"));
  try {
    const basePath = join(root, "base.env");
    const runnerPath = join(root, "runner.env");
    const examplePath = join(root, "runner.example.env");
    const outputPath = join(root, "merged.env");
    const deployPath = join(root, "deploy.env");
    writeFileSync(basePath, [
      "MANJING_AI_PROVIDER=kimi",
      "MANJING_ALLOWED_ORIGINS=https://manjing.jadecircle.cn",
      "MANJING_COOKIE_SECURE=false",
      "MANJING_GLM_API_KEY=existing-glm-secret",
      "OPENAI_API_KEY=existing-image-secret",
      "MANJING_DAILY_AI_REQUESTS=10",
    ].join("\n"));
    writeFileSync(runnerPath, [
      "KIMI_API_URL=https://api.kimi.com/coding/v1",
      "KIMI_API_KEY=kimi-secret",
      "KIMI_MODEL=k3",
      "KIMI_REASONING_EFFORT=high",
      "OPENAI_API_URL=https://text-proxy.example/v1",
      "OPENAI_API_KEY=text-secret",
      "OPENAI_MODEL=gpt-luna-from-env",
      "DOUBAO_API_URL=https://ark.cn-beijing.volces.com/api/v3",
      "DOUBAO_API_KEY=seed-secret",
      "DOUBAO_MODEL=seed-from-env",
    ].join("\n"));
    writeFileSync(examplePath, [
      "GLM_API_URL=https://open.bigmodel.cn/api/paas/v4",
      "GLM_API_KEY=",
      "GLM_FLASH_MODEL=glm-flash-from-env",
      "GLM_MODEL=glm-review-from-env",
      "OPENAI_SOL_MODEL=gpt-sol-from-env",
      "DEEPSEEK_API_URL=https://api.deepseek.com",
      "DEEPSEEK_API_KEY=",
      "DEEPSEEK_MODEL=deepseek-flash-from-env",
      "DEEPSEEK_PRO_MODEL=deepseek-pro-from-env",
    ].join("\n"));
    writeFileSync(deployPath, "MANJING_OPENAI_API_KEY=new-image-secret\n");

    const result = spawnSync(process.execPath, [
      resolve("deploy/merge-model-env.mjs"), basePath, runnerPath, examplePath, outputPath,
      deployPath, "https://manjing.jadecircle.cn",
    ], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const merged = values(readFileSync(outputPath, "utf8"));
    assert.equal(merged.MANJING_AI_PROVIDER, "kimi-k3");
    assert.equal(merged.MANJING_OPENAI_API_KEY, "text-secret");
    assert.equal(merged.MANJING_OPENAI_MODEL, "gpt-luna-from-env");
    assert.equal(merged.MANJING_OPENAI_SOL_MODEL, "gpt-sol-from-env");
    assert.equal(merged.MANJING_DOUBAO_MODEL, "seed-from-env");
    assert.equal(merged.MANJING_GLM_REVIEW_MODEL, "glm-review-from-env");
    assert.equal(merged.MANJING_DEEPSEEK_PRO_MODEL, "deepseek-pro-from-env");
    assert.equal(merged.MANJING_GLM_API_KEY, "existing-glm-secret");
    assert.equal(merged.MANJING_DEEPSEEK_API_KEY, undefined);
    assert.equal(merged.OPENAI_API_KEY, "new-image-secret");
    assert.equal(merged.MANJING_ALLOWED_ORIGINS, "https://manjing.jadecircle.cn");
    assert.equal(merged.MANJING_COOKIE_SECURE, "true");
    assert.equal(merged.MANJING_DAILY_AI_REQUESTS, "10");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
