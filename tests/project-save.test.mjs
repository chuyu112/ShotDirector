import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { persistProjectSnapshot, requestProjectSave } from "../app/project-save.mjs";

const setup = () => ({
  apiBase: "/api", snapshot: { projectTitle: "城市猎人", globalSettings: { storyBackground: "keep" }, reviews: [{ completePrompt: "keep" }] },
  scopeId: "chapter", storageKey: "draft", appliedAgentRevision: "v2", pairingToken: "test-only",
  materialDraftMode: true, workspaceScope: "material-draft", serverProjectId: "project-1", signal: new AbortController().signal,
});

test("successful save acknowledges writes only, preserves snapshots and reports stages", async () => {
  const input = setup();
  const before = JSON.stringify(input.snapshot);
  const calls = [], stages = [];
  const result = await persistProjectSnapshot({ ...input, onProgress: stage => stages.push(stage), fetcher: async (url, init) => {
    calls.push(url);
    assert.equal(init.signal, input.signal);
    const body = JSON.parse(init.body);
    if (url.endsWith("draft-state")) {
      assert.equal(body.state.reviews[0].completePrompt, "keep");
      assert.equal(body.appliedAgentRevision, "v2");
    }
    return Response.json({ status: "saved" });
  } });
  assert.match(result, /已保存到服务器/);
  assert.deepEqual(calls, ["/api/draft-state", "/api/projects/rename"]);
  assert.equal(stages.length, 2);
  assert.equal(JSON.stringify(input.snapshot), before);
});

test("main workspace saves global settings and failures stop later writes", async () => {
  const calls = [];
  await assert.rejects(persistProjectSnapshot({ ...setup(), materialDraftMode: false, fetcher: async url => {
    calls.push(url);
    return url.endsWith("source-global-settings") ? Response.json({ error: "specific failure" }, { status: 500 }) : Response.json({ status: "saved" });
  } }), /specific failure/);
  assert.deepEqual(calls, ["/api/draft-state", "/api/source-global-settings"]);
});

test("Agent revision conflict is never reported as saved", async () => {
  await assert.rejects(persistProjectSnapshot({ ...setup(), fetcher: async () => Response.json({ status: "agent-revision-required" }) }), /失败/);
});

test("missing save listener rejects immediately", async () => {
  await assert.rejects(requestProjectSave(new EventTarget(), "save", { timeoutMs: 100 }), /尚未准备好/);
});

test("a hung handler unlocks with timeout, aborts pending IO and ignores late completion", async () => {
  const target = new EventTarget();
  let detail;
  const stages = [];
  target.addEventListener("save", event => { detail = event.detail; detail.handled = true; });
  await assert.rejects(requestProjectSave(target, "save", { timeoutMs: 15, onProgress: v => stages.push(v) }), /保存超时/);
  assert.equal(detail.signal.aborted, true);
  detail.resolve("late success");
  detail.onProgress("late stage");
  assert.deepEqual(stages, []);
});

test("deadline includes response body consumption and prevents subsequent writes", async () => {
  const target = new EventTarget();
  const calls = [];
  let release;
  let pendingSave;
  target.addEventListener("save", event => {
    const detail = event.detail;
    detail.handled = true;
    pendingSave = persistProjectSnapshot({ ...setup(), signal: detail.signal, fetcher: async url => {
      calls.push(url);
      return { ok: true, json: () => new Promise(resolve => { release = resolve; }) };
    } }).then(detail.resolve, error => detail.reject(error.message));
  });
  await assert.rejects(requestProjectSave(target, "save", { timeoutMs: 15 }), /保存超时/);
  release({ status: "saved" });
  await pendingSave;
  assert.deepEqual(calls, ["/api/draft-state"]);
});

test("manual save neither reapplies stale UI state nor waits for account refresh", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const handler = page.slice(page.indexOf("async function persistProjectNow"), page.indexOf("async function saveGlobalSettings"));
  assert.doesNotMatch(handler, /setState\(|scopedBrowserStorage\.setItem|globalUpdatedAt:/);
  const auth = await readFile(new URL("../app/manjing-auth-client.tsx", import.meta.url), "utf8");
  const save = auth.slice(auth.indexOf("async function saveProject()"), auth.indexOf('if (gate.status === "local")'));
  assert.match(save, /void loadSession/);
  assert.doesNotMatch(save, /await loadSession/);
  assert.match(save, /finally[\s\S]*setProjectBusy\(false\)/);
});
