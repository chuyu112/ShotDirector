#!/usr/bin/env node
/**
 * 漫镜生产冒烟（发版后必跑，约 1 分钟、消耗少量真实模型额度）。
 *
 * 用刚发布的镜像起一个一次性 scratch 容器（tmpfs 数据目录，绝不碰生产数据）：
 *   1. 健康检查
 *   2. 注册临时账户（每次随机邮箱）
 *   3. Creator 链路：POST /api/load-script 真实拆镜（HTTP → 额度 → worker → pi harness → 真模型）
 *   4. Reviewer 隔离：容器内真模型跑一轮 review，金丝雀验证创作者历史不泄漏
 * 结束后自动销毁容器。任何一步失败以非零码退出。
 *
 * 运行：node scripts/smoke-production.mjs [镜像tag，默认 current 指向的镜像]
 * 依赖：工作区 .env.deploy.local（sshpass 部署凭据）。
 * 注意：docker run --env-file 不像 compose 那样剥离引号，脚本会先清洗服务器
 * .env.server 的引号再注入（2026-09-19 冒烟曾因引号污染模型配置失败）。
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { withPrivateSmokeEnvironment } from "./smoke-environment.mjs";

const workspace = join(dirname(fileURLToPath(import.meta.url)), "..");
const deployEnvPath = join(workspace, ".env.deploy.local");
const REMOTE = { host: null, port: "22", user: null, password: null };
for (const line of readFileSync(deployEnvPath, "utf8").split("\n")) {
  const [key, ...rest] = line.split("=");
  const value = rest.join("=").trim().replace(/^["']|["']$/g, "");
  if (key === "MANJING_DEPLOY_HOST") REMOTE.host = value;
  if (key === "MANJING_DEPLOY_PORT") REMOTE.port = value || "22";
  if (key === "MANJING_DEPLOY_USER") REMOTE.user = value;
  if (key === "MANJING_DEPLOY_PASSWORD") REMOTE.password = value;
}
if (!REMOTE.host || !REMOTE.user || !REMOTE.password) {
  throw new Error("缺少 .env.deploy.local 部署凭据");
}

const SMOKE_PORT = "18199";
const SMOKE_NAME = "manjing-smoke";
const runId = randomUUID().slice(0, 8);
const SMOKE_EMAIL = `smoke-${runId}@manjing.local`;
const IMAGE_TAG = process.argv[2] || null;

function ssh(command) {
  const result = spawnSync("sshpass", [
    "-p", REMOTE.password, "ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=15",
    "-p", REMOTE.port, `${REMOTE.user}@${REMOTE.host}`, command,
  ], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`远程命令失败（exit ${result.status}）：${command.slice(0, 120)}\n${result.stderr || result.stdout}`);
  }
  return result.stdout;
}
const shq = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;

const steps = [];
function step(name, fn) {
  steps.push([name, fn]);
}

step("解析线上镜像 tag", () => {
  const tag = IMAGE_TAG || ssh("readlink /opt/manjing/current | xargs basename").trim();
  if (!/^[0-9T-Zz-]+-[0-9a-f]{7}$/.test(tag)) throw new Error(`无法解析发布版本目录：${tag}`);
  return { image: `manjing-server:release-${tag.toLowerCase()}` };
});

step("启动 scratch 冒烟容器（tmpfs 数据，临时 env 权限 0600）", ({ image }) => {
  ssh(withPrivateSmokeEnvironment(`docker rm -f ${SMOKE_NAME} >/dev/null 2>&1 || true
docker run -d --name ${SMOKE_NAME} \
  --tmpfs /data:rw,nosuid,nodev,uid=1000,gid=1000,mode=755 \
  -p 127.0.0.1:${SMOKE_PORT}:8080 \
  --env-file "$smoke_env_file" \
  -e MANJING_GATEWAY_HOST=0.0.0.0 -e MANJING_GATEWAY_PORT=8080 \
  -e MANJING_DATA_ROOT=/data -e MANJING_APP_ROOT=/app \
  -e MANJING_PUBLIC_API_BASE=/api -e MANJING_COOKIE_SECURE=0 \
  -e MANJING_REGISTRATION_ENABLED=1 \
  -e MANJING_ALLOWED_ORIGINS=http://127.0.0.1:${SMOKE_PORT} \
  ${image} npm run start:gateway >/dev/null`));
  for (let i = 0; i < 30; i += 1) {
    try {
      const out = ssh(`curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:${SMOKE_PORT}/healthz || true`);
      if (out.trim() === "200") return { image };
    } catch { /* retry */ }
  }
  throw new Error("冒烟容器健康检查超时");
});

step("注册冒烟账户", () => {
  const out = ssh(`curl -sS -c /tmp/manjing-smoke-cookies -X POST http://127.0.0.1:${SMOKE_PORT}/api/auth/register \
    -H 'Content-Type: application/json' -H 'Origin: http://127.0.0.1:${SMOKE_PORT}' \
    -d ${shq(JSON.stringify({ email: SMOKE_EMAIL, displayName: "发版冒烟", password: `Smoke-${runId}-pass`, defaultProjectName: "冒烟项目" }))}`);
  const parsed = JSON.parse(out);
  if (!parsed.authenticated) throw new Error(`注册失败：${out.slice(0, 200)}`);
  return { userId: parsed.user.id, projectId: parsed.activeProject.id };
});

step("Creator 链路：真实 /load-script 拆镜", () => {
  const payload = Buffer.from(JSON.stringify({
    content: "《巷口》第一镜：清晨的巷口，晨光斜照。老王推开面摊的卷帘门，招呼第一拨客人。第二镜：特写，热气从汤锅升起，老板娘手腕翻飞，下面、捞面、浇头一气呵成。",
    fileName: `smoke-${runId}.txt`,
  })).toString("base64");
  const out = ssh(`echo ${payload} | base64 -d > /tmp/manjing-smoke-payload.json
curl -sS -b /tmp/manjing-smoke-cookies -X POST http://127.0.0.1:${SMOKE_PORT}/api/load-script \
  -H 'Content-Type: application/json' -H 'Origin: http://127.0.0.1:${SMOKE_PORT}' \
  -d @/tmp/manjing-smoke-payload.json`);
  const parsed = JSON.parse(out);
  if (!parsed.projectTitle || !Array.isArray(parsed.shots) || !parsed.shots.length) {
    throw new Error(`load-script 未返回有效拆镜结果：${out.slice(0, 300)}`);
  }
  return { shots: parsed.shots.length, title: parsed.projectTitle };
});

step("Reviewer 隔离：真模型金丝雀", () => {
  const script = `const { runManjingAgentTurn } = await import("/app/runner/manjing-agent-runtime.mjs");
const BASE = process.env.GLM_API_URL || process.env.MANJING_GLM_BASE_URL;
const KEY = process.env.GLM_API_KEY || process.env.MANJING_GLM_API_KEY;
const MODEL = process.env.GLM_FLASH_MODEL || process.env.MANJING_GLM_FLASH_MODEL || process.env.GLM_MODEL;
const CANARY = "创作者机密-${runId}-不得泄漏";
async function runModel({ prompt }) {
  const url = BASE.endsWith("/chat/completions") ? BASE : BASE.replace(/\\/$/, "") + "/chat/completions";
  const response = await fetch(url, { method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + KEY },
    body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: prompt.slice(0, 12000) }], max_tokens: 800 }),
    signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error("GLM HTTP " + response.status);
  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}
await runManjingAgentTurn({ runId: "smoke-creator", conversationId: "conv-smoke", agentRole: "creator",
  prompt: "用一句话总结项目状态。", runModel,
  conversationHistory: [{ role: "user", content: CANARY }] });
const review = await runManjingAgentTurn({ runId: "smoke-review", conversationId: "conv-smoke", agentRole: "review",
  prompt: "你是独立 Reviewer。请只回复四个字：审查完成。", runModel,
  conversationHistory: [{ role: "user", content: CANARY }] });
if (review.finalText.includes("创作者机密")) { console.error("REVIEW_LEAK_DETECTED"); process.exit(1); }
if (!/审查完成/.test(review.finalText)) { console.error("REVIEW_UNEXPECTED: " + review.finalText.slice(0, 120)); process.exit(1); }
console.log("REVIEW_ISOLATED " + review.harnessSessionId);`;
  ssh(`echo ${Buffer.from(script).toString("base64")} | base64 -d > /tmp/manjing-review-smoke.mjs
docker cp /tmp/manjing-review-smoke.mjs ${SMOKE_NAME}:/tmp/review-smoke.mjs
docker exec ${SMOKE_NAME} node /tmp/review-smoke.mjs`);
});

let context = {};
let failed = null;
console.log(`\n漫镜生产冒烟  目标 ${REMOTE.host}  账户 ${SMOKE_EMAIL}`);
for (const [name, fn] of steps) {
  process.stdout.write(`  ${name} ... `);
  const start = Date.now();
  try {
    context = { ...context, ...fn(context) };
    console.log(`OK (${((Date.now() - start) / 1000).toFixed(1)}s)`);
  } catch (error) {
    failed = error;
    console.log(`FAIL`);
    break;
  }
}
console.log(`  清理冒烟容器 ... `);
try { ssh(`docker rm -f ${SMOKE_NAME} >/dev/null 2>&1; rm -f /tmp/manjing-smoke-cookies /tmp/manjing-smoke-payload.json /tmp/manjing-review-smoke.mjs`); console.log("OK"); } catch { console.log("（请手动 docker rm -f manjing-smoke）"); }
if (failed) {
  console.error(`\n冒烟失败：${failed.message}\n`);
  process.exit(1);
}
console.log(`\n冒烟全部通过：Creator 拆镜 ${context.shots} 个（《${context.title}》），Reviewer 隔离验证通过，镜像 ${context.image}\n`);
