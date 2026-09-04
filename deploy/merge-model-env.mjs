#!/usr/bin/env node

import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function usage() {
  console.error("usage: node deploy/merge-model-env.mjs <base-env> <runner-env> <runner-example-env> <output-env> [deploy-env] [allowed-origin] [jiekou-env]");
  process.exit(2);
}

function parseValue(rawValue) {
  const value = String(rawValue || "").trim();
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value); } catch { return value.slice(1, -1); }
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  return value;
}

function parseEnv(text) {
  const values = new Map();
  for (const line of String(text || "").split(/\r?\n/u)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/u);
    if (match) values.set(match[1], parseValue(match[2]));
  }
  return values;
}

function requiredValue(values, key, sourceLabel) {
  const value = String(values.get(key) || "").trim();
  if (!value) throw new Error(`${sourceLabel} 缺少 ${key}`);
  return value;
}

function quoted(value) {
  return JSON.stringify(String(value));
}

function normalizedJiekouOpenAiBase(value) {
  const url = new URL(String(value || "https://api.highwayapi.ai/openai").trim());
  if (url.protocol !== "https:" || !["api.jiekou.ai", "api.highwayapi.ai"].includes(url.hostname) || url.username || url.password) {
    throw new Error("JK 服务地址必须使用受信的 HTTPS 域名");
  }
  return `${url.origin}/openai`;
}

function mergeLines(baseText, updates) {
  const emitted = new Set();
  const lines = String(baseText || "").split(/\r?\n/u).flatMap((line) => {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/u);
    const key = match?.[1];
    if (!key || !updates.has(key)) return [line];
    if (emitted.has(key)) return [];
    emitted.add(key);
    return [`${key}=${quoted(updates.get(key))}`];
  });
  const additions = [...updates.entries()]
    .filter(([key]) => !emitted.has(key))
    .map(([key, value]) => `${key}=${quoted(value)}`);
  return `${lines.join("\n").replace(/\n+$/u, "")}\n\n# 漫镜文字模型：从翠易 runner env 白名单映射。\n${additions.join("\n")}\n`;
}

const [, , basePath, runnerPath, runnerExamplePath, outputPath, deployEnvPath, allowedOrigin, jiekouEnvPath] = process.argv;
if (!basePath || !runnerPath || !runnerExamplePath || !outputPath) usage();

const baseText = readFileSync(resolve(basePath), "utf8");
const base = parseEnv(baseText);
const runner = parseEnv(readFileSync(resolve(runnerPath), "utf8"));
const runnerExample = parseEnv(readFileSync(resolve(runnerExamplePath), "utf8"));
const deployEnv = deployEnvPath ? parseEnv(readFileSync(resolve(deployEnvPath), "utf8")) : new Map();
const jiekouEnv = jiekouEnvPath ? parseEnv(readFileSync(resolve(jiekouEnvPath), "utf8")) : new Map();
if (!base.get("MANJING_ALLOWED_ORIGINS") || !base.has("MANJING_COOKIE_SECURE")) {
  throw new Error("基础 env 不是已部署的漫镜服务器配置");
}

const updates = new Map([
  ["MANJING_AI_PROVIDER", "glm-5.3-flash"],
  ["MANJING_MANGA_CROP_MODEL", "glm-5.3-flash"],
  ["MANJING_KIMI_BASE_URL", requiredValue(runner, "KIMI_API_URL", "翠易 .env.runner")],
  ["MANJING_KIMI_API_KEY", requiredValue(runner, "KIMI_API_KEY", "翠易 .env.runner")],
  ["MANJING_KIMI_MODEL", requiredValue(runner, "KIMI_MODEL", "翠易 .env.runner")],
  ["MANJING_KIMI_REASONING_EFFORT", requiredValue(runner, "KIMI_REASONING_EFFORT", "翠易 .env.runner")],
  ["MANJING_DOUBAO_BASE_URL", requiredValue(runner, "DOUBAO_API_URL", "翠易 .env.runner")],
  ["MANJING_DOUBAO_API_KEY", requiredValue(runner, "DOUBAO_API_KEY", "翠易 .env.runner")],
  ["MANJING_DOUBAO_MODEL", requiredValue(runner, "DOUBAO_MODEL", "翠易 .env.runner")],
  ["MANJING_GLM_BASE_URL", requiredValue(runnerExample, "GLM_API_URL", "翠易 .env.runner.example")],
  ["MANJING_GLM_FLASH_MODEL", requiredValue(runnerExample, "GLM_FLASH_MODEL", "翠易 .env.runner.example")],
  ["MANJING_GLM_REVIEW_MODEL", requiredValue(runnerExample, "GLM_MODEL", "翠易 .env.runner.example")],
  ["MANJING_DEEPSEEK_BASE_URL", requiredValue(runnerExample, "DEEPSEEK_API_URL", "翠易 .env.runner.example")],
  ["MANJING_DEEPSEEK_MODEL", requiredValue(runnerExample, "DEEPSEEK_MODEL", "翠易 .env.runner.example")],
  ["MANJING_DEEPSEEK_PRO_MODEL", requiredValue(runnerExample, "DEEPSEEK_PRO_MODEL", "翠易 .env.runner.example")],
]);

const jiekouApiKey = String(
  jiekouEnv.get("MANJING_JIEKOU_API_KEY")
  || jiekouEnv.get("JIEKOU_API_KEY")
  || deployEnv.get("MANJING_JIEKOU_API_KEY")
  || deployEnv.get("JIEKOU_API_KEY")
  || runner.get("JIEKOU_API_KEY")
  || base.get("MANJING_JIEKOU_API_KEY")
  || base.get("JIEKOU_API_KEY")
  || "",
).trim();
if (jiekouApiKey) {
  const jiekouOpenAiBase = normalizedJiekouOpenAiBase(jiekouEnv.get("JIEKOU_BASE_URL") || deployEnv.get("JIEKOU_BASE_URL") || runner.get("JIEKOU_BASE_URL") || base.get("JIEKOU_BASE_URL"));
  updates.set("MANJING_JIEKOU_API_KEY", jiekouApiKey);
  updates.set("MANJING_JIEKOU_BASE_URL", jiekouOpenAiBase);
  updates.set("MANJING_JIEKOU_RESPONSES_BASE_URL", `${jiekouOpenAiBase}/v1`);
}

if (allowedOrigin) {
  const origin = new URL(allowedOrigin);
  if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("生产 MANJING_ALLOWED_ORIGINS 必须是 HTTPS Origin");
  }
  updates.set("MANJING_ALLOWED_ORIGINS", origin.origin);
  updates.set("MANJING_COOKIE_SECURE", "true");
}

const imageApiKey = String(deployEnv.get("MANJING_OPENAI_API_KEY") || "").trim();
if (imageApiKey) updates.set("OPENAI_API_KEY", imageApiKey);

for (const [sourceKey, targetKey] of [
  ["GLM_API_KEY", "MANJING_GLM_API_KEY"],
  ["DEEPSEEK_API_KEY", "MANJING_DEEPSEEK_API_KEY"],
]) {
  const value = String(runner.get(sourceKey) || runnerExample.get(sourceKey) || "").trim();
  if (value) updates.set(targetKey, value);
}

for (const key of [
  "MANJING_OPENAI_MAX_OUTPUT_TOKENS",
  "MANJING_JIEKOU_MAX_OUTPUT_TOKENS",
  "MANJING_DEEPSEEK_MAX_OUTPUT_TOKENS",
  "MANJING_DOUBAO_MAX_OUTPUT_TOKENS",
]) {
  const value = String(base.get(key) || "").trim();
  if (value) updates.set(key, value);
}

const merged = mergeLines(baseText, updates);
writeFileSync(resolve(outputPath), merged, { encoding: "utf8", mode: 0o600 });
chmodSync(resolve(outputPath), 0o600);

const mergedValues = parseEnv(merged);
const statusKeys = [
  "MANJING_KIMI_API_KEY",
  "MANJING_GLM_API_KEY",
  "MANJING_OPENAI_API_KEY",
  "MANJING_JIEKOU_API_KEY",
  "MANJING_DOUBAO_API_KEY",
  "MANJING_DEEPSEEK_API_KEY",
];
console.log(JSON.stringify({
  output: resolve(outputPath),
  provider: mergedValues.get("MANJING_AI_PROVIDER"),
  credentials: Object.fromEntries(statusKeys.map((key) => [key, Boolean(String(mergedValues.get(key) || "").trim())])),
  preserved: {
    allowedOrigins: allowedOrigin
      ? mergedValues.get("MANJING_ALLOWED_ORIGINS") === new URL(allowedOrigin).origin
      : mergedValues.get("MANJING_ALLOWED_ORIGINS") === base.get("MANJING_ALLOWED_ORIGINS"),
    cookieSecure: allowedOrigin
      ? mergedValues.get("MANJING_COOKIE_SECURE") === "true"
      : mergedValues.get("MANJING_COOKIE_SECURE") === base.get("MANJING_COOKIE_SECURE"),
    imageApiKey: imageApiKey
      ? mergedValues.get("OPENAI_API_KEY") === imageApiKey
      : mergedValues.get("OPENAI_API_KEY") === base.get("OPENAI_API_KEY"),
  },
}, null, 2));
