import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const YAML = require("yaml");
const releaseScript = fileURLToPath(new URL("../deploy/apply-release-systemd.sh", import.meta.url));
const bundleVerifier = fileURLToPath(new URL("../scripts/verify-server-bundle.mjs", import.meta.url));

async function releaseArchive(root, index, entries) {
  const payload = join(root, `payload-${index}`);
  await mkdir(payload, { recursive: true });
  for (const [name, contents = "fixture-only"] of Object.entries(entries)) {
    const destination = join(payload, name);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, contents, "utf8");
  }
  const archive = join(root, `release-${index}.tgz`);
  execFileSync("tar", ["-czf", archive, "-C", payload, "."]);
  return archive;
}

function validateReleaseArchive(archive) {
  return spawnSync("bash", [releaseScript, "--validate-archive", archive], {
    encoding: "utf8",
  });
}

test("compose file has unique keys and the expected three-tier topology", async () => {
  const source = await readFile(new URL("../docker-compose.server.yml", import.meta.url), "utf8");
  const document = YAML.parseDocument(source, { uniqueKeys: true });
  assert.deepEqual(document.errors, []);
  const compose = document.toJS();
  assert.deepEqual(Object.keys(compose.services).sort(), ["gateway", "nginx", "web"]);
  assert.equal(compose.services.gateway.volumes.includes("manjing-data:/data"), true);
  assert.equal(compose.services.gateway.stop_grace_period, "15m30s");
  assert.equal(compose.services.gateway.restart, "unless-stopped");
  assert.equal(compose.services.web.restart, "unless-stopped");
  assert.equal(compose.services.nginx.restart, "unless-stopped");
  assert.match(String(compose.services.web.build.args.LIBTV_VERSION), /1\.1\.3/);
});

test("runtime image pins and verifies both LibTV Linux architectures", async () => {
  const dockerfile = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");
  assert.match(dockerfile, /ARG LIBTV_VERSION=1\.1\.3/);
  assert.match(dockerfile, /\/usr\/local\/bin\/libtv --version/);
  assert.doesNotMatch(dockerfile, /\/usr\/local\/bin\/libtv version/);
  assert.match(dockerfile, /LIBTV_SHA256_AMD64=cf86f462c5aed60f95dca978cc91ece98c60bcfa27337da008ad59953c3ea7da/);
  assert.match(dockerfile, /LIBTV_SHA256_ARM64=369b43f5be1d28dbbde7c1b6711ed746bf9bff1028ba794a6dae4fa01bed601c/);
  assert.match(dockerfile, /sha256sum -c -/);
  assert.match(dockerfile, /cli\/\$\{LIBTV_VERSION\}\/libtv-linux-\$\{libtv_arch\}\.zip/);
  assert.match(dockerfile, /unzip -j "\$libtv_zip" '\*\/libtv'/);
  assert.doesNotMatch(dockerfile, /cli\/latest\/install-libtv-cli/);
});

test("tenant bridge probes the executable version and drains CLI queues on termination", async () => {
  const bridge = await readFile(new URL("../scripts/shotdirector-bridge.mjs", import.meta.url), "utf8");
  assert.match(bridge, /runLibtv\(\["--version"\], \{ parseJson: false \}\)/);
  assert.match(bridge, /await refreshLibtvVersion\(\);[\s\S]*?libtv: publicLibtvStatus\(\)/);
  assert.match(bridge, /process\.once\("SIGTERM", \(\) => \{ void beginBridgeShutdown\("SIGTERM"\); \}\)/);
  assert.match(bridge, /await libtvServerWorker\?\.whenIdle\(\)/);
  assert.match(bridge, /bridge-shutdown-state\.json/);
});

test("nginx preserves the public host and overwrites spoofable forwarded addresses", async () => {
  const nginx = await readFile(new URL("../deploy/nginx.manjing.conf", import.meta.url), "utf8");
  assert.equal((nginx.match(/proxy_set_header Host \$http_host/g) || []).length, 2);
  assert.equal((nginx.match(/proxy_set_header X-Forwarded-For \$remote_addr/g) || []).length, 2);
  assert.doesNotMatch(nginx, /\$proxy_add_x_forwarded_for/);
});

test("systemd nginx serves the Manjing domain only over HTTPS", async () => {
  const nginx = await readFile(new URL("../deploy/nginx.manjing.systemd.conf", import.meta.url), "utf8");
  assert.match(nginx, /server_name manjing\.jadecircle\.cn/);
  assert.match(nginx, /listen 80;/);
  assert.match(nginx, /return 308 https:\/\/manjing\.jadecircle\.cn\$request_uri/);
  assert.match(nginx, /listen 443 ssl;/);
  assert.match(nginx, /ssl_certificate \/etc\/letsencrypt\/live\/manjing\.jadecircle\.cn\/fullchain\.pem/);
  assert.match(nginx, /Strict-Transport-Security/);
  assert.equal((nginx.match(/proxy_set_header X-Forwarded-For \$remote_addr/g) || []).length, 2);
  assert.doesNotMatch(nginx, /listen 5173/);
});

test("server env declares the env-driven model catalog and keeps provider credentials empty", async () => {
  const example = await readFile(new URL("../.env.server.example", import.meta.url), "utf8");
  assert.match(example, /^MANJING_AI_PROVIDER=kimi-k3$/m);
  assert.match(example, /^MANJING_WRITING_REASONING_EFFORT=high$/m);
  assert.match(example, /^MANJING_CODEX_ENABLED=false$/m);
  assert.match(example, /^MANJING_CODEX_BIN=\/usr\/local\/bin\/codex$/m);
  assert.match(example, /^MANJING_CODEX_HOME=\/var\/lib\/manjing\/codex-superadmin$/m);
  assert.match(example, /^MANJING_CODEX_MODEL=gpt-5\.6-sol$/m);
  assert.match(example, /^MANJING_CODEX_ALLOWED_TENANT_IDS=$/m);
  assert.match(example, /^MANJING_MANGA_CROP_MODEL=codex-gpt-5\.6-sol$/m);
  assert.match(example, /^KIMI_API_URL=https:\/\/api\.kimi\.com\/coding\/v1$/m);
  assert.match(example, /^KIMI_MODEL=k3$/m);
  assert.match(example, /^GLM_API_URL=https:\/\/open\.bigmodel\.cn\/api\/paas\/v4$/m);
  assert.match(example, /^GLM_MODEL=glm-5\.3$/m);
  assert.match(example, /^GLM_FLASH_MODEL=glm-5\.3-flash$/m);
  assert.match(example, /^MANJING_GLM_MAX_OUTPUT_TOKENS=16384$/m);
  assert.match(example, /^MANJING_KIMI_MAX_OUTPUT_TOKENS=16384$/m);
  assert.match(example, /^OPENAI_API_URL=https:\/\/www\.moyu\.info\/v1$/m);
  assert.match(example, /^OPENAI_MODEL=gpt-5\.6-luna$/m);
  assert.match(example, /^OPENAI_SOL_MODEL=gpt-5\.6-sol$/m);
  assert.match(example, /^MANJING_OPENAI_SOL_ENABLED=false$/m);
  assert.match(example, /^DEEPSEEK_API_URL=https:\/\/api\.deepseek\.com$/m);
  assert.match(example, /^DEEPSEEK_MODEL=deepseek-v4-flash$/m);
  assert.match(example, /^DEEPSEEK_PRO_MODEL=deepseek-v4-pro$/m);
  assert.match(example, /^DOUBAO_API_URL=https:\/\/ark\.cn-beijing\.volces\.com\/api\/v3$/m);
  assert.match(example, /^DOUBAO_MODEL=doubao-seed-2-1-pro-260628$/m);
  assert.match(example, /^OPENAI_API_KEY=$/m);
  assert.match(example, /^KIMI_API_KEY=$/m);
  assert.match(example, /^GLM_API_KEY=$/m);
  assert.match(example, /^MANJING_OPENAI_API_KEY=$/m);
  assert.match(example, /^DEEPSEEK_API_KEY=$/m);
  assert.match(example, /^DOUBAO_API_KEY=$/m);
});

test("systemd release validates credentials for the selected writing provider", async () => {
  const script = await readFile(new URL("../deploy/apply-release-systemd.sh", import.meta.url), "utf8");
  assert.match(script, /ai_provider="\$\(env_value MANJING_AI_PROVIDER\)"/);
  assert.match(script, /glm\|glm-5\.3-flash\)[\s\S]*?"GLM API key"[\s\S]*?GLM_API_KEY[\s\S]*?"GLM Flash model"/);
  assert.match(script, /kimi\|kimi-k3\)[\s\S]*?"Kimi API key"[\s\S]*?KIMI_API_KEY[\s\S]*?"Kimi model"/);
  assert.match(script, /gpt-5\.6-luna\)[\s\S]*?"OpenAI-compatible API key"[\s\S]*?"GPT-5\.6 Luna model"/);
  assert.match(script, /gpt-5\.6-sol\)[\s\S]*?"OpenAI-compatible API key"[\s\S]*?"GPT-5\.6 Sol model"/);
  assert.match(script, /deepseek-v4-flash\)[\s\S]*?"DeepSeek API key"[\s\S]*?"DeepSeek Flash model"/);
  assert.match(script, /deepseek-v4-pro\)[\s\S]*?"DeepSeek API key"[\s\S]*?"DeepSeek Pro model"/);
  assert.match(script, /seed-2\.1-pro\)[\s\S]*?"Seed API key"[\s\S]*?"Seed model"/);
  assert.doesNotMatch(script, /^\s*openai\)/m);
  assert.match(script, /server writing provider is not registered/);
  assert.doesNotMatch(script, /grep -q '\^OPENAI_API_KEY='/);
});

test("systemd release stages production dependencies and keeps health probes inside rollback", async () => {
  const script = await readFile(new URL("../deploy/apply-release-systemd.sh", import.meta.url), "utf8");
  assert.match(script, /verify-server-bundle\.mjs/);
  assert.match(script, /npm ci --omit=dev --no-audit --no-fund/);
  assert.match(script, /npm ls --omit=dev --depth=0/);
  assert.match(script, /deployment-worker-smoke\.mjs/);
  assert.match(script, /curl -fsS --max-time 10 http:\/\/127\.0\.0\.1:3300\//);
  assert.match(script, /curl -fsS --max-time 10 http:\/\/127\.0\.0\.1:8180\/healthz/);
  assert.match(script, /property="og:image"/);
  assert.match(script, /name="twitter:image"/);
  assert.match(script, /parsed\.pathname !== "\/social-preview\.png"/);
  assert.match(script, /\["localhost", "127\.0\.0\.1", "::1"\]/);
  assert.ok(script.indexOf("deployment-worker-smoke.mjs") < script.indexOf("rollback_required=0"));
  assert.ok(script.indexOf("verify-server-bundle.mjs") < script.indexOf("systemctl stop manjing-gateway.service"));
});

test("gateway shutdown drains workers before closing lingering HTTP connections", async () => {
  const gateway = await readFile(new URL("../server/manjing-gateway.mjs", import.meta.url), "utf8");
  assert.match(gateway, /const serverClosed = new Promise/);
  assert.match(gateway, /closeIdleConnections/);
  assert.match(gateway, /await gateway\.close\(\)[\s\S]*?closeAllConnections[\s\S]*?await serverClosed/);
  assert.match(gateway, /if \(shutdownPromise\) return shutdownPromise/);
});

test("server bundle verifier rejects the local Bridge and accepts the same-origin gateway", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "manjing-server-bundle-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const client = join(root, "client");
  await mkdir(client, { recursive: true });

  await writeFile(join(client, "page.js"), 'const base="127.0.0.1:4317";fetch(base+"/auth/me")', "utf8");
  const rejected = spawnSync(process.execPath, [bundleVerifier, root], { encoding: "utf8" });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /local Bridge address/);

  await writeFile(join(client, "page.js"), 'const base="/api";fetch(base+"/auth/me")', "utf8");
  const accepted = spawnSync(process.execPath, [bundleVerifier, root], { encoding: "utf8" });
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.match(accepted.stdout, /Verified server browser bundle/);
});

test("release archive preflight rejects every private env variant and allows only the public env template", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "manjing-release-filter-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const rejected = [
    ".env.server",
    ".env.server.deploy.local",
    ".env.deploy.local",
    "nested/.env.production",
    ".env.server.example.backup",
  ];

  for (const [index, name] of rejected.entries()) {
    const archive = await releaseArchive(root, `env-${index}`, {
      "package.json": "{}",
      [name]: "SENTINEL_SECRET_CONTENT",
    });
    const result = validateReleaseArchive(archive);
    assert.equal(result.status, 2, `${name} must be rejected`);
    assert.match(result.stderr, /unsafe or secret-bearing path/);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /SENTINEL_SECRET_CONTENT/);
  }

  const allowed = await releaseArchive(root, "allowed-example", {
    "package.json": "{}",
    ".env.server.example": "MANJING_GLM_API_KEY=",
  });
  const allowedResult = validateReleaseArchive(allowed);
  assert.equal(allowedResult.status, 0, allowedResult.stderr);
});

test("release archive preflight rejects common credential and private-key files", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "manjing-release-secrets-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const rejected = [
    ".npmrc",
    ".git-credentials",
    ".ssh/id_ed25519",
    ".aws/credentials",
    ".docker/config.json",
    "config/service-account.json",
    "certificates/client.key",
    "backup/operator.p12",
    "terraform/production.tfstate",
  ];

  for (const [index, name] of rejected.entries()) {
    const archive = await releaseArchive(root, `secret-${index}`, {
      "package.json": "{}",
      [name]: "SENTINEL_SECRET_CONTENT",
    });
    const result = validateReleaseArchive(archive);
    assert.equal(result.status, 2, `${name} must be rejected`);
    assert.match(result.stderr, /unsafe or secret-bearing path/);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /SENTINEL_SECRET_CONTENT/);
  }
});
