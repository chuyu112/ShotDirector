#!/usr/bin/env node
// 漫镜模型一键复测：对线上 gateway 容器内全部创作/审核模型发真实最小诊断请求，输出结果表。
// 用法：
//   node scripts/probe-models.mjs               # 全部创作 + 审核模型（走 .env.deploy.local 连服务器）
//   node scripts/probe-models.mjs --kind review # 只测审核模型
//   node scripts/probe-models.mjs --ids glm-5.3-flash,seed-2.1-pro
// 退出码：有任一「已配置」模型失败时为 1；置灰/未配置只报告不计失败。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const workspace = process.cwd();
const args = process.argv.slice(2);
function argValue(name) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}
const kind = ["writing", "review", "all"].includes(argValue("kind")) ? argValue("kind") : "all";
const onlyIds = String(argValue("ids") || "").split(",").map((s) => s.trim()).filter(Boolean);
const timeoutMs = Math.max(10_000, Number(argValue("timeout-ms")) || 60_000);

const deployEnvPath = join(workspace, ".env.deploy.local");
let host = "", user = "", password = "";
for (const line of readFileSync(deployEnvPath, "utf8").split("\n")) {
  const index = line.indexOf("=");
  if (index < 0) continue;
  const key = line.slice(0, index).trim();
  const value = line.slice(index + 1).trim().replace(/^["']|["']$/g, "");
  if (key === "MANJING_DEPLOY_HOST") host = value;
  if (key === "MANJING_DEPLOY_USER") user = value;
  if (key === "MANJING_DEPLOY_PASSWORD") password = value;
}
if (!host || !user || !password) throw new Error("缺少 .env.deploy.local 部署凭据");

// 容器内运行的探测脚本：复用 /app 生产模块（catalog + 各 transport provider + 模型测试协议）
const runner = `import { writingModelConfigs, reviewModelConfigs } from 'file:///app/server/text-model-catalog.mjs';
import { CompatibleChatStructuredProvider } from 'file:///app/server/compatible-chat-structured-provider.mjs';
import { OpenAIResponsesProvider } from 'file:///app/server/openai-responses-provider.mjs';
import { AnthropicStructuredProvider } from 'file:///app/server/anthropic-structured-provider.mjs';
import { DoubaoResponsesProvider } from 'file:///app/server/doubao-responses-provider.mjs';
import { MODEL_TEST_PROMPT as prompt, MODEL_TEST_SCHEMA as schema, MODEL_TEST_RULES, modelTestFormatMatches } from 'file:///app/app/model-test-contract.mjs';
import { modelTestFailureMessage } from 'file:///app/server/model-tests.mjs';

const KIND = ${JSON.stringify(kind)};
const ONLY = ${JSON.stringify(onlyIds)};
const TIMEOUT_MS = ${JSON.stringify(timeoutMs)};

function compatibleProviderOrUnavailable(options) {
  try { return new CompatibleChatStructuredProvider(options); }
  catch (error) {
    const message = error instanceof Error ? error.message : '文字模型配置无效';
    return { id: String(options.kind || 'unknown'), model: options.model, configured: false, configurationError: message,
      async generate() { throw new Error(message); } };
  }
}
function runtimeProvider(config) {
  try {
    if (config.transport === 'chat-completions') {
      return compatibleProviderOrUnavailable({
        kind: config.compatibleKind, apiKey: config.apiKey, baseUrl: config.baseUrl,
        model: config.model, label: config.label, supportsImages: config.supportsImages, allowedRoots: ['/tmp'],
      });
    }
    if (config.transport === 'responses') {
      return new OpenAIResponsesProvider({
        apiKey: config.apiKey, baseUrl: config.baseUrl, providerId: config.provider, label: config.label,
        allowedHosts: config.allowedHosts || [],
        includeOpenAIExtensions: !['jiekou-responses', 'konjac-responses'].includes(config.provider),
        allowedRoots: ['/tmp'],
      });
    }
    if (config.transport === 'anthropic-messages') {
      return new AnthropicStructuredProvider({
        apiKey: config.apiKey, baseUrl: config.baseUrl, model: config.model,
        providerId: config.provider, label: config.label, allowedHosts: config.allowedHosts,
      });
    }
    if (config.transport === 'doubao-responses') {
      return new DoubaoResponsesProvider({ apiKey: config.apiKey, baseUrl: config.baseUrl, model: config.model });
    }
    throw new Error('不支持的文字传输：' + config.transport);
  } catch (error) {
    const message = error instanceof Error ? error.message : '文字模型配置无效';
    return { id: config.provider, model: config.model, configured: false, configurationError: message,
      async generate() { throw new Error(message); } };
  }
}

const byId = new Map();
for (const config of writingModelConfigs(process.env)) byId.set(config.id, { ...config, role: '创作' });
for (const config of reviewModelConfigs(process.env)) {
  const existing = byId.get(config.id);
  byId.set(config.id, existing ? { ...config, role: existing.role + '+审核' } : { ...config, role: '审核' });
}
const models = [...byId.values()]
  .filter((config) => KIND === 'all' || (KIND === 'review' ? config.reviewEnabled : config.writingEnabled))
  .filter((config) => !ONLY.length || ONLY.includes(config.id));
console.log(JSON.stringify({ event: 'catalog', total: models.length, ids: models.map((m) => m.id) }));

async function probeOne(config) {
  const startedAt = Date.now();
  const provider = runtimeProvider(config);
  const base = { id: config.id, label: config.label, role: config.role, provider: config.provider,
    transport: config.transport, requestedModel: config.model,
    configured: config.configured === true && provider.configured !== false };
  if (!base.configured) {
    return { ...base, status: 'skipped', reason: config.reason || provider.configurationError, ms: 0 };
  }
  try {
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    const response = await provider.generate({
      prompt,
      instructions: '你是漫镜文字模型连通性诊断员。\\n' + MODEL_TEST_RULES,
      model: config.model, schema, schemaName: 'model_connectivity_test',
      diagnosticRawText: true, reasoningEffort: 'low', maxOutputTokens: 2048,
      stream: true, signal, timeoutMs: TIMEOUT_MS,
    });
    const formatStatus = modelTestFormatMatches(response.text) ? 'passed' : 'failed';
    return { ...base, status: formatStatus === 'passed' ? 'passed' : 'format-failed', formatStatus,
      reportedModel: response.reportedModel || null, responseId: response.responseId || null, ms: Date.now() - startedAt };
  } catch (error) {
    return { ...base, status: 'failed', error: modelTestFailureMessage(error),
      reportedModel: error?.reportedModel || null, ms: Date.now() - startedAt };
  }
}

const results = [];
let cursor = 0;
async function worker() {
  while (cursor < models.length) {
    const config = models[cursor++];
    const result = await probeOne(config);
    results.push(result);
    console.log(JSON.stringify({ event: 'result', ...result }));
  }
}
await Promise.all(Array.from({ length: Math.min(3, models.length) }, worker));
console.log(JSON.stringify({ event: 'summary', total: results.length,
  passed: results.filter((r) => r.status === 'passed').length,
  failed: results.filter((r) => r.status === 'failed' || r.status === 'format-failed').length,
  skipped: results.filter((r) => r.status === 'skipped').length }));
`;

console.log(`漫镜模型复测  目标 ${host}  范围 ${kind}${onlyIds.length ? `  筛选 ${onlyIds.join(",")}` : ""}`);
const startedAt = Date.now();
const remote = spawnSync("sshpass", [
  "-p", password, "ssh", "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null",
  `${user}@${host}`, "docker exec -i manjing-gateway-1 node --input-type=module -",
], { input: runner, encoding: "utf8", timeout: 10 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 });

const lines = String(remote.stdout || "").split("\n").map((line) => line.trim()).filter(Boolean);
const results = [];
let summary = null;
for (const line of lines) {
  let parsed;
  try { parsed = JSON.parse(line); } catch { continue; }
  if (parsed.event === "result") results.push(parsed);
  if (parsed.event === "summary") summary = parsed;
}
if (remote.error || remote.status !== 0 || !summary) {
  console.error("复测执行失败：", remote.error?.message || remote.stderr?.slice(-400) || "无输出");
  process.exit(2);
}

const icon = { passed: "✅", failed: "❌", "format-failed": "⚠️", skipped: "⬜" };
for (const result of results) {
  const detail = result.status === "passed" ? `${result.ms / 1000}s`
    : result.status === "skipped" ? (result.reason || "未配置")
    : (result.error || result.formatStatus || "");
  console.log(`  ${icon[result.status] || "?"} ${result.label}  [${result.role}]  ${detail}`);
}
console.log(`共 ${summary.total} 个：通过 ${summary.passed}，失败 ${summary.failed}，置灰/未配置 ${summary.skipped}  (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
process.exit(summary.failed > 0 ? 1 : 0);
