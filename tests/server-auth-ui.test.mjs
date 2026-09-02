import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pagePath = new URL("../app/page.tsx", import.meta.url);
const authPath = new URL("../app/manjing-auth-client.tsx", import.meta.url);
const mediaLabPath = new URL("../app/media-lab.tsx", import.meta.url);
const cssPath = new URL("../app/globals.css", import.meta.url);
const bridgePath = new URL("../scripts/shotdirector-bridge.mjs", import.meta.url);

test("server API base is configurable while localhost remains compatible", async () => {
  const page = await readFile(pagePath, "utf8");
  assert.match(page, /NEXT_PUBLIC_MANJING_API_BASE/);
  assert.match(page, /http:\/\/127\.0\.0\.1:4317/);
  assert.match(page, /<ManjingAuthGate apiBase=\{bridgeBase\}/);
  assert.match(page, /serverGatewayPairingSentinel/);
  assert.match(page, /value\.pairingToken \|\| \(value\.serverMode \? serverGatewayPairingSentinel : undefined\)/);
  assert.match(page, /const path = `\$\{bridgeBase\}\/media-panel\//);
  assert.doesNotMatch(page, /new URL\([^\n]*bridgeBase/);
});

test("all director-desk bridge fetches include the session cookie", async () => {
  const page = await readFile(pagePath, "utf8");
  const bridgeCalls = page.match(/bridgeFetch\(/g) || [];
  assert.ok(bridgeCalls.length >= 20, "expected the existing Bridge requests to use bridgeFetch");
  assert.match(page, /const bridgeFetch = manjingSessionFetch/);
  assert.doesNotMatch(page, /(^|[^.\w])fetch\(/m);
});

test("writing model picker mirrors the env-driven eight-model catalog and only switches through the server", async () => {
  const [page, css, bridge] = await Promise.all([
    readFile(pagePath, "utf8"),
    readFile(cssPath, "utf8"),
    readFile(bridgePath, "utf8"),
  ]);
  for (const label of ["Codex · GPT-5.6 Sol", "GLM-5.3-Flash", "Kimi K3", "GPT-5.6 Luna", "DeepSeek V4 Flash", "Seed 2.1 Pro", "GLM 5.3", "GPT-5.6 Sol", "DeepSeek V4 Pro"]) {
    assert.match(page, new RegExp(label.replace(/[.]/g, "\\.")));
  }
  assert.match(page, /writingModels: Array\.isArray\(value\.writingModels\)/);
  assert.match(page, /bridgeBase}\/writing-model/);
  assert.match(page, /disabled=\{!model\.available \|\| !bridge\.connected \|\| bridge\.busy/);
  assert.match(page, /draggable=\{model\.available && bridge\.connected/);
  assert.match(page, /manjing-writing-model-order:v1/);
  assert.match(page, /moveWritingModelBefore/);
  assert.match(page, /moveWritingModelByOffset/);
  assert.match(page, /onPointerDown=\{\(event\) => beginTouchWritingModelDrag\(event, model\)\}/);
  assert.match(page, /document\.elementFromPoint\(event\.clientX, event\.clientY\)/);
  assert.match(page, /event\.key === "ArrowUp" \|\| event\.key === "ArrowDown"/);
  assert.match(page, /serverSelectableWritingModelIds = new Set<WritingModelId>\(writingModelCatalog\.map\(\(model\) => model\.id\)\)/);
  assert.match(page, /fallback\.id !== "codex-gpt-5\.6-sol" \|\| tenantScope\.mode === "local" \|\| tenantScope\.role === "superadmin"/);
  assert.match(page, /selected: available && Boolean\(remote\?\.selected\)/);
  assert.match(page, /activeWritingModel = writingModelOptions\.find\(\(model\) => model\.selected && model\.available\)/);
  assert.match(page, /activeWritingModel\?\.label \|\| \(bridge\.connected \? "暂无可用模型" : "未连接"\)/);
  assert.match(page, /model\.available \? model\.hint : model\.reason \|\| "待接入"/);
  assert.match(css, /\.writing-model-picker\s*\{/);
  assert.match(css, /\.writing-model-menu\s*\{/);
  assert.match(css, /\.writing-model-menu > button:disabled/);
  assert.match(css, /max-height: min\(420px, calc\(100dvh - 112px\)\)/);
  assert.match(css, /overflow-y: auto/);
  assert.match(css, /\.writing-model-grip[\s\S]*?touch-action: none/);
  assert.match(bridge, /serverWorker && requestedAiProviderValue && !requestedServerProvider[\s\S]*?"server-disabled"/);
  assert.match(bridge, /textModelConfigs\(process\.env\)/);
  assert.match(bridge, /writingModels: publicWritingModelOptions\(\)/);
  assert.match(bridge, /function hasActiveWritingModelWork\(\)[\s\S]*?shuttingDown[\s\S]*?activeArtworkJobs\.size[\s\S]*?activeAssetJobs\.size[\s\S]*?activeMediaJobs\.size[\s\S]*?libtvLoginPromise/);
  assert.match(bridge, /busy: hasActiveWritingModelWork\(\)/);
});

test("auth gate covers session, registration, login and logout", async () => {
  const auth = await readFile(authPath, "utf8");
  for (const route of ["/auth/me", "/auth/register", "/auth/login", "/auth/logout"]) {
    assert.ok(auth.includes(route) || (route === "/auth/register" && auth.includes("/auth/${mode}")) || (route === "/auth/login" && auth.includes("/auth/${mode}")), `missing ${route}`);
  }
  const authenticatedRequests = auth.match(/globalThis\.fetch\(/g) || [];
  assert.ok(authenticatedRequests.length >= 5);
  assert.equal((auth.match(/credentials: "include"/g) || []).length, authenticatedRequests.length);
  assert.match(auth, /response\.status === 404[\s\S]*?status: "local"/);
  assert.match(auth, /serverConfigured[\s\S]*?status: "unavailable"[\s\S]*?status: "local"/);
  assert.match(auth, /password\.length < 8/);
  assert.match(auth, /退出登录/);
  assert.match(auth, /\/projects\/select/);
  assert.match(auth, /新建项目/);
  assert.match(auth, /加载项目/);
  assert.match(auth, /保存项目/);
  assert.match(auth, /MANJING_SAVE_PROJECT_EVENT/);
  assert.match(auth, /gate\.user\.role === "superadmin"/);
  assert.match(auth, /SUPER ADMIN/);
  assert.match(auth, /ManjingWorkspaceScopeContext\.Provider/);
  assert.match(auth, /key=\{workspaceScope\.storageScope\}/);
  assert.match(auth, /new BroadcastChannel\(authChannelName\)/);
  assert.match(auth, /authStorageSignalKey/);
  assert.match(auth, /MANJING_SESSION_INVALID_EVENT/);
  assert.match(auth, /visibilitychange/);
  assert.match(auth, /activeSessionRequest\.current !== null && !force/);
  assert.doesNotMatch(auth, /window\.sessionStorage\.clear/);
});

test("project archive hydration precedes writes and the global file library is explicit", async () => {
  const page = await readFile(pagePath, "utf8");
  assert.match(page, /projectArchiveLoaded/);
  assert.match(page, /if \(hydrated && projectArchiveLoaded\)/);
  assert.match(page, /!projectArchiveLoaded \|\| !bridge\.connected/);
  for (const label of ["新建全局文件", "加载全局文件", "保存全局文件", "视频改编重点", "人物传", "身份与人物关系", "表演边界", "露脸限制"]) {
    assert.match(page, new RegExp(label));
  }
  assert.match(page, /characterProfiles/);
  assert.match(page, /\/global-files\/save/);
  assert.match(page, /\/global-files\/load/);
});

test("browser caches and IndexedDB keys are partitioned by authenticated user and project", async () => {
  const [page, auth, mediaLab] = await Promise.all([
    readFile(pagePath, "utf8"),
    readFile(authPath, "utf8"),
    readFile(mediaLabPath, "utf8"),
  ]);
  assert.match(auth, /storageScope: `server:\$\{safeScopePart\(userId\)\}:project:\$\{safeScopePart\(projectId\)\}`/);
  assert.match(auth, /manjingScopedBrowserStorage/);
  assert.match(page, /useManjingWorkspaceScope\(\)/);
  assert.match(page, /getArtworks\(artworkStorageScope,/);
  assert.match(page, /sessionScope=\{tenantScope\}/);
  assert.match(mediaLab, /readPersistedState\(sessionScope\)/);
  assert.match(mediaLab, /manjingScopedBrowserStorage\(sessionScope\)/);
  assert.doesNotMatch(`${page}\n${mediaLab}`, /pending-session|manjing-browser-storage/);
  assert.match(auth, /response\.status === 401[\s\S]*?MANJING_SESSION_INVALID_EVENT/);
});

test("login and primary workspace controls have a touch layout", async () => {
  const css = await readFile(cssPath, "utf8");
  const mobile = css.slice(css.lastIndexOf("@media (max-width: 768px)"));
  assert.match(css, /\.manjing-auth-page\s*\{/);
  assert.match(css, /\.manjing-auth-tabs button[\s\S]*?min-height: 48px/);
  assert.match(mobile, /\.manjing-auth-page\s*\{\s*grid-template-columns: 1fr/);
  assert.match(mobile, /\.loaded-script-actions\s*\{\s*grid-template-columns: 1fr/);
  assert.match(mobile, /\.workspace\s*\{\s*grid-template-columns: 1fr/);
  assert.match(mobile, /\.top-shot-prompt-bar\s*\{[\s\S]*?display: grid/);
  assert.match(mobile, /\.panel-lightbox-body\s*\{\s*display: block/);
  assert.match(mobile, /min-height: 44px/);
});
