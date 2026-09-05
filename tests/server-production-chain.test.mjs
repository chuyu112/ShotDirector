import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { assertHumanLocksPreserved } from "../app/manjing-agent-contract.mjs";
import {
  buildProjectManifest,
  deriveProductionPipeline,
  ensureProjectUid,
  ensureShotUid,
} from "../app/production-core.mjs";
import {
  buildCompleteShotPromptRevision,
  buildPromptReviewRevision,
  buildShotUpstreamRevision,
  buildVideoGenerationPackage,
} from "../app/video-package.ts";
import { ManjingAuthStore } from "../server/auth-store.mjs";
import { createManjingGateway } from "../server/manjing-gateway.mjs";
import { TenantWorkerPool } from "../server/tenant-worker-pool.mjs";

const sourceFileName = "jade-page.png";
const projectTitle = "翡翠裂纹鉴定测试片";
const fakeGlmModel = "fake-glm-5.3-flash";
const fakeKimiModel = "k3";
const finalArtStyle = "SHOWA_JADE_REALISM｜1987年东京写实真人35mm电影，真实演员、真实材质、克制胶片颗粒";
const panelIds = Array.from({ length: 5 }, (_, index) => `P01-G${String(index + 1).padStart(2, "0")}`);

const globalSettings = {
  storyBackground: "1987年东京，一位老鉴定师在安静的珠宝工坊逐步检查一块来历不明的翡翠原石；全部剧情严格服从当前漫画画格。",
  characters: ["老鉴定师：六十岁左右，沉着、专业，动作克制"],
  props: ["翡翠原石：同一块石头贯穿五镜，裂纹位置连续"],
  locations: ["昭和末期东京珠宝工坊，木质工作台与暖色检验灯"],
  timeline: ["Shot 01–05 发生在同一天下午，按检查步骤连续推进"],
  continuity: ["翡翠原石、放大镜、检验灯与人物衣着跨镜保持一致"],
  finalVideoStyle: finalArtStyle,
  storyboardImageStyle: "清晰的导演预演分镜，只表达构图与动作关系",
  modelRules: ["Seedance 2.5 每镜 6–30 秒"],
  negative: ["无字幕、无水印、无BGM、不得增加漫画外剧情"],
};

function box(index) {
  return {
    tempId: `B${String(index + 1).padStart(2, "0")}`,
    bounds: { x: index * 20, y: 0, width: 20, height: 100 },
    role: index === 0 || index === 4 ? "outer" : "regular",
    missingEdges: [],
    detectionOrder: index + 1,
    readingOrder: index + 1,
    confidence: "high",
    rationale: `第 ${index + 1} 格由连续白色沟槽和完整四边共同确认`,
  };
}

function storyboardShot(index) {
  const number = String(index + 1).padStart(2, "0");
  const panelId = panelIds[index];
  const beats = [
    "鉴定师把翡翠放到检验灯下，先观察整体轮廓",
    "鉴定师转动原石，让一道细裂纹进入光线",
    "鉴定师用放大镜确认裂纹走向",
    "鉴定师轻敲工作台，判断裂纹是否贯穿",
    "鉴定师放下放大镜，给出谨慎结论",
  ];
  const dialogue = [
    "鉴定师：先看整体。",
    "鉴定师：这里有一道细纹。",
    "鉴定师：裂纹向内延伸。",
    "鉴定师：声音不够清脆。",
    "鉴定师：需要保守估价。",
  ];
  const start = index * 8;
  const end = start + 8;
  return {
    id: number,
    timecode: `00:${String(start).padStart(2, "0")}–00:${String(end).padStart(2, "0")}`,
    duration: 8,
    title: `鉴定步骤 ${number}`,
    sourceText: [dialogue[index]],
    sourcePanels: [panelId],
    artStyle: finalArtStyle,
    story: beats[index],
    scene: "1987年东京珠宝工坊的木质工作台旁",
    characters: ["老鉴定师"],
    props: ["翡翠原石", "放大镜", "检验灯"],
    omniReferences: [],
    composition: `只依据 ${panelId}：鉴定师在画面左侧，翡翠与检验灯在右侧工作台上`,
    camera: "固定中近景，摄影机位于工作台正前方，轻微向下俯拍",
    action: beats[index],
    dialogue: [dialogue[index]],
    continuity: ["人物衣着、翡翠朝向与上一镜连续", "不得提前出现下一格动作结果"],
    negative: ["不得增加旁人", "不得出现字幕或现代电子设备"],
    segments: [{
      label: "0–8s",
      beat: beats[index],
      framing: "固定中近景，动作完成后保留短暂停顿",
      mustShow: [panelId, "翡翠原石", "鉴定师手部动作"],
    }],
  };
}

function mediaAnalysisFixture() {
  const shots = panelIds.map((_, index) => storyboardShot(index));
  return {
    status: "completed",
    kind: "manga",
    projectTitle,
    summary: "五个漫画画格被逐一映射为五个连续的翡翠鉴定镜头。",
    sourceText: panelIds.map((panelId, index) => ({
      location: panelId,
      speaker: "老鉴定师",
      text: shots[index].dialogue[0].replace(/^鉴定师：/, ""),
      confidence: "high",
    })),
    cameraNotes: ["五镜保持同一轴线", "动作按观察、旋转、放大、轻敲、结论推进"],
    timeline: panelIds.map((panelId, index) => ({
      index: index + 1,
      timecode: panelId,
      story: shots[index].story,
      sourceObservation: `${panelId} 中可见鉴定师、翡翠与检验工具`,
      adaptationSuggestion: "保持固定机位，以手部动作和眼神反应推动节奏",
      shotSize: "中近景",
      camera: "轻微俯拍",
      movement: "固定机位",
      editing: index ? "动作匹配切换" : "建立镜头",
      performance: "动作克制，先看物再说话",
      sound: "工坊环境声、石头与木桌接触声、自然日语对白",
      keep: ["翡翠裂纹", "鉴定师手部动作"],
      issues: [],
    })),
    mangaPages: [{
      scanIndex: 1,
      sourceFile: sourceFileName,
      layout: "single-page",
      classification: "story",
      readingOrder: panelIds,
      includeInShots: true,
      notes: "五个纵向测试画格，按锁定顺序进入五个 Shot。",
      panels: panelIds.map((panelId, index) => ({
        id: panelId,
        bounds: box(index).bounds,
        kind: "story",
        includeInShots: true,
        sourceObservation: `${panelId} 可见老鉴定师正在执行第 ${index + 1} 个翡翠检查动作`,
        textSummary: storyboardShot(index).dialogue[0],
      })),
    }],
    assetPrompts: panelIds.map((panelId, index) => ({
      id: `PROP-${String(index + 1).padStart(2, "0")}`,
      kind: "prop",
      name: `鉴定连续道具 ${index + 1}`,
      sourceObservation: `${panelId} 可见翡翠原石与第 ${index + 1} 个检验步骤所需道具`,
      prompt: `SHOWA_JADE_REALISM，依据 ${panelId} 的翡翠原石与检验道具制作写实资产参考，来源不可确认的颜色不锁定`,
      negative: ["现代电子设备", "文字水印", "凭空添加品牌"],
      sourcePanels: [panelId],
      shotIds: [String(index + 1).padStart(2, "0")],
    })),
    research: { mode: "off", used: false, queries: [], sources: [], notes: [] },
    shots,
    scriptMarkdown: "# 翡翠裂纹鉴定测试片\n\n五个原作画格依次对应观察、转动、放大、轻敲和结论。",
  };
}

function completePromptFixture(shotId) {
  const panelId = panelIds[Number(shotId) - 1];
  return {
    status: "completed",
    shotId,
    summary: `Shot ${shotId} 只使用 ${panelId}，把鉴定动作、日语对白和固定机位整合为八秒可执行镜头。`,
    prompt: `【故事背景】1987年东京的珠宝工坊，老鉴定师连续检查同一块翡翠原石。\n【时代烙印】昭和末期木质工作台、暖色检验灯、真实手工工具，不出现现代电子设备。\n【人物画像】老鉴定师沉着克制，先把视线落到翡翠，再移动手部和身体重心。\n【原作剧情依据】严格只使用 ${panelId}：${storyboardShot(Number(shotId) - 1).story}，不提前泄漏相邻画格。\n【最终美术风格】${finalArtStyle}。\n【本Shot执行】Shot ${shotId}，8秒，16:9。0–2秒建立固定中近景；2–6秒完成触发—执行—结果动作链；6–8秒说日语台词并让情绪停留在眼神和肩颈。角色（日语）：まず、この石を見ます。｜中文备注：先看这块石头（仅制作备注，不朗读、不上字幕）。只保留工坊环境声、石头接触声和自然日语对白，全程无BGM、无旁白、无字幕、无水印。`,
    research: { used: false, queries: [], sources: [], notes: [] },
    evidence: {
      sourcePanels: [panelId],
      imagesInspected: [panelId],
      dialogueCount: 1,
      panelAnnotationCount: 0,
      backgroundUsed: true,
      artStyleUsed: true,
    },
    warnings: [],
  };
}

function promptReviewFixture(shotId) {
  const panelId = panelIds[Number(shotId) - 1];
  return {
    status: "completed",
    shotId,
    reviewerId: "kimi-k3",
    report: {
      verdict: "discussion-ready",
      summary: `提示词严格停留在 ${panelId}，人物、动作、对白和八秒时长均可执行；最终批准仍由用户完成。`,
      strengths: ["来源边界清楚", "动作链可执行", "无BGM和无字幕约束完整"],
      checks: {
        sourceBoundary: true,
        characterContinuity: true,
        timingFeasible: true,
        dialogueFeasible: true,
        cameraAndActionCoherent: true,
        soundAndNegativeComplete: true,
      },
      findings: [],
    },
    evidence: {
      mode: "direct-images",
      sourcePanels: [panelId],
      imagesInspected: [panelId],
      promptHashMatched: true,
      independentRun: true,
    },
  };
}

function chatPrompt(body) {
  return (Array.isArray(body?.messages) ? body.messages : []).flatMap((message) => {
    if (typeof message?.content === "string") return [message.content];
    if (!Array.isArray(message?.content)) return [];
    return message.content
      .filter((item) => item?.type === "text" || item?.type === "input_text")
      .map((item) => item.text);
  }).join("\n");
}

function requestedShotId(prompt) {
  const matches = [...String(prompt || "").matchAll(/shotId=(\d{2})/g)];
  const shotId = matches.at(-1)?.[1];
  if (!shotId || !panelIds[Number(shotId) - 1]) throw new Error(`无法从模型提示词识别 Shot：${shotId || "missing"}`);
  return shotId;
}

function fakeStructuredResult(schemaName, prompt) {
  schemaName = String(schemaName || "").replace(/_schema$/, "");
  if (schemaName === 'model_connectivity_test') return { ok: true };
  if (schemaName === "manga-panel-boxes") {
    return {
      status: "completed",
      pages: [{ scanIndex: 1, sourceFile: sourceFileName, notes: "五格测试页", boxes: panelIds.map((_, index) => box(index)) }],
    };
  }
  if (schemaName === "media-analysis") return mediaAnalysisFixture();
  if (schemaName === "script-load") return { projectTitle, shots: panelIds.map((_, index) => storyboardShot(index)) };
  if (schemaName === "complete-shot-prompt") return completePromptFixture(requestedShotId(prompt));
  if (schemaName === "shot-chat") {
    const turns = String(prompt).split("\n").filter(line => line.startsWith('{"role"')).map(line => JSON.parse(line)).filter(turn => turn.role === "user");
    const current = turns.at(-1)?.content || String(prompt);
    const contextLine = current.split("\n").find(line => line.startsWith('{"projectUid"'));
    const context = JSON.parse(contextLine);
    const replyOnly = current.includes("只讨论，不改稿");
    return { action: replyOnly ? "reply" : "revise", reply: "已核对当前画格。", prompt: replyOnly ? "" : context.currentPrompt + "\n补充：保持两秒停顿。", sourcePanels: context.shot.sourcePanels };
  }
  if (schemaName === "prompt-review") {
    const result = promptReviewFixture(requestedShotId(prompt));
    // Real GLM output can omit server-owned identity despite complete judgments.
    delete result.reviewerId;
    return result;
  }
  throw new Error(`测试模型不支持 schema：${schemaName}`);
}

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

async function closeServer(server) {
  if (!server.listening) return;
  server.close();
  await once(server, "close");
}

function sessionCookies(response) {
  const raw = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie().join(",")
    : response.headers.get("set-cookie") || "";
  return ["manjing_session", "manjing_project"].flatMap((name) => {
    const value = raw.match(new RegExp(`(?:^|[, ])${name}=([^;]+)`))?.[1];
    return value ? [`${name}=${value}`] : [];
  }).join("; ");
}

async function jsonRequest(base, path, { method = "GET", cookie = "", body, headers = {} } = {}) {
  const requestHeaders = { ...headers };
  if (cookie) requestHeaders.Cookie = cookie;
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) requestHeaders.Origin = base;
  let requestBody = body;
  if (body !== undefined && !Buffer.isBuffer(body) && typeof body !== "string") {
    requestHeaders["Content-Type"] ||= "application/json";
    requestBody = JSON.stringify(body);
  }
  const response = await fetch(`${base}${path}`, { method, headers: requestHeaders, body: requestBody });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function pollMediaJob(base, cookie, requestId, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await jsonRequest(base, `/api/media-job-result?requestId=${encodeURIComponent(requestId)}`, { cookie });
    if (last.response.status === 200 && last.payload.status === "completed") return last.payload;
    if (last.response.status !== 202) {
      throw new Error(`素材任务 ${requestId} 失败（HTTP ${last.response.status}）：${JSON.stringify(last.payload)}`);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error(`素材任务 ${requestId} 超时：${JSON.stringify(last?.payload || {})}`);
}

function readyVideoPackage(shot, approved = true, artworkStatus = "ready") {
  const upstreamRevision = buildShotUpstreamRevision({
    projectTitle,
    modelId: "seedance-2.5",
    globalSettings,
    shot,
  });
  return buildVideoGenerationPackage({
    projectTitle,
    modelId: "seedance-2.5",
    modelLabel: "Seedance 2.5",
    referenceLimit: 50,
    minDuration: 6,
    maxDuration: 30,
    globalSettings,
    shot,
    approved,
    approvedAt: approved ? "2026-08-29T08:00:00.000Z" : undefined,
    promptReviewCurrent: true,
    layoutViewKeys: [`shot-${shot.id}-top-view`],
    directorViewKeys: [`shot-${shot.id}-top-view`],
    whiteboxLocks: [{ key: `shot-${shot.id}-whitebox`, lockedAt: "2026-08-29T07:55:00.000Z", sourceRevision: upstreamRevision }],
    artworkStatus,
    artworkNames: [`shot-${shot.id}-storyboard.webp`],
    selectedArtworkIndex: 0,
    artworkDependencyRevision: upstreamRevision,
  });
}

test("server production chain covers five-shot manga workflow without paid APIs", { timeout: 120_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "manjing-production-chain-"));
  const dataRoot = join(root, "data");
  const modelCalls = [];
  const fakeModel = createServer((req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try {
        assert.equal(req.method, "POST");
        assert.equal(req.url, "/v1/chat/completions");
        const body = JSON.parse(raw || "{}");
        const tools = Array.isArray(body.tools) ? body.tools : [];
        assert.equal(tools.length, 1);
        assert.equal(tools[0]?.type, "function");
        const schemaName = String(tools[0]?.function?.name || "").replace(/_schema$/, "");
        const prompt = chatPrompt(body);
        const schemaAttempt = modelCalls.filter((call) => call.schemaName === schemaName).length + 1;
        let output = fakeStructuredResult(schemaName, prompt);
        if (schemaName === "media-analysis" && schemaAttempt === 1) {
          output = {
            ...output,
            research: {
              mode: "off",
              used: true,
              queries: ["伪造联网查询"],
              sources: [{ title: "伪造来源", url: "https://invalid.example/research", usedFor: "测试必须拒绝" }],
              notes: [{ fact: "伪造网络事实", sourceUrls: ["https://invalid.example/research"], confidence: "high" }],
            },
          };
        }
        if (schemaName === "complete-shot-prompt" && schemaAttempt === 1) {
          output = {
            ...output,
            research: {
              used: true,
              queries: ["伪造提示词查询"],
              sources: [{ title: "伪造来源", url: "https://invalid.example/prompt", usedFor: "测试必须拒绝" }],
              notes: ["这条编造来源不能在无联网工具时通过校验"],
            },
          };
        }
        const imageCount = (raw.match(/data:image\//g) || []).length;
        const systemText = (body.messages || [])
          .filter((message) => message?.role === "system")
          .map((message) => String(message.content || ""))
          .join("\n");
        modelCalls.push({
          schemaName,
          model: body.model,
          imageCount,
          toolCount: tools.length,
          systemText,
          maxTokens: body.max_tokens,
          maxCompletionTokens: body.max_completion_tokens,
          reasoningEffort: body.reasoning_effort,
          prompt,
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          id: `chatcmpl-${modelCalls.length}`,
          model: body.model,
          choices: [{
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{
                id: `call-${modelCalls.length}`,
                type: "function",
                function: { name: tools[0].function.name, arguments: JSON.stringify(output) },
              }],
            },
            finish_reason: "tool_calls",
          }],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        }));
      } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: error instanceof Error ? error.message : "fake model failure" } }));
      }
    });
  });
  const modelPort = await listen(fakeModel);
  const store = new ManjingAuthStore({ filename: join(dataRoot, "auth.sqlite") });
  const workerPool = new TenantWorkerPool({
    appRoot: resolve(fileURLToPath(new URL("..", import.meta.url))),
    dataRoot,
    maxWorkers: 3,
    maxWorkersPerUser: 1,
    shutdownWaitMs: 2_000,
    startupTimeoutMs: 20_000,
    baseEnv: {
      ...process.env,
      OPENAI_API_KEY: "",
      MANJING_AI_PROVIDER: "glm",
      MANJING_GLM_API_KEY: "test-only-not-a-real-glm-key",
      MANJING_GLM_BASE_URL: `http://127.0.0.1:${modelPort}/v1`,
      MANJING_GLM_MODEL: fakeGlmModel,
      MANJING_GLM_REASONING_EFFORT: "medium",
      MANJING_KIMI_API_KEY: "test-only-not-a-real-kimi-key",
      MANJING_KIMI_BASE_URL: `http://127.0.0.1:${modelPort}/v1`,
      MANJING_KIMI_MODEL: fakeKimiModel,
      LIBTV_BIN: "/usr/bin/false",
    },
  });
  const gateway = createManjingGateway({
    store,
    workerPool,
    cookieSecure: false,
    dailyLimits: {
      ai: 100,
      globalAi: 100,
      image: 0,
      globalImage: 0,
      libtv: 0,
      globalLibtv: 0,
      libtvLogin: 1,
      globalLibtvLogin: 1,
      upload: 10,
      globalUpload: 10,
      uploadBytes: 10_000_000,
      globalUploadBytes: 10_000_000,
    },
  });
  const gatewayPort = await listen(gateway.server);
  const base = `http://127.0.0.1:${gatewayPort}`;

  try {
    let result = await jsonRequest(base, "/api/auth/me");
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.payload, { authenticated: false, serverMode: true });

    result = await jsonRequest(base, "/api/auth/register", {
      method: "POST",
      body: { email: "jade-director@example.com", displayName: "翡翠导演", password: "jade-chain-password" },
    });
    assert.equal(result.response.status, 201);
    const ownerCookie = sessionCookies(result.response);
    const owner = result.payload;
    assert.match(ownerCookie, /manjing_session=/);
    assert.match(ownerCookie, /manjing_project=/);

    result = await jsonRequest(base, "/api/auth/me", { cookie: ownerCookie });
    assert.equal(result.payload.authenticated, true);
    assert.equal(result.payload.activeProject.id, owner.activeProject.id);

    result = await jsonRequest(base, "/api/health", { cookie: ownerCookie });
    assert.equal(result.response.status, 200);
    assert.equal(result.payload.connected, true);
    assert.equal(result.payload.serverMode, true);
    assert.equal(result.payload.modelProvider.id, "glm");
    assert.equal(result.payload.modelProvider.model, fakeGlmModel);
    assert.equal(result.payload.pairingToken, undefined, "internal worker token must never reach the browser");

    const png = await sharp({
      create: { width: 1000, height: 1000, channels: 3, background: "#d7c59a" },
    }).png().toBuffer();
    result = await jsonRequest(base, `/api/media-upload?kind=manga&name=${encodeURIComponent(sourceFileName)}&mime=image%2Fpng`, {
      method: "POST",
      cookie: ownerCookie,
      body: png,
      headers: { "Content-Type": "image/png", "Content-Length": String(png.length) },
    });
    assert.equal(result.response.status, 201);
    const mediaId = result.payload.mediaId;
    assert.match(mediaId, /^[a-f0-9-]{36}$/i);
    assert.equal(result.payload.width, 1000);
    assert.equal(result.payload.height, 1000);

    result = await jsonRequest(base, "/api/media-analyze", {
      method: "POST",
      cookie: ownerCookie,
      body: {
        kind: "manga",
        mediaIds: [mediaId],
        generationModel: "seedance-2.5",
        storyBackground: globalSettings.storyBackground,
        defaultArtStyle: finalArtStyle,
        webResearch: "supplement",
        readingDirection: "right-to-left",
        brief: "逐格确认翡翠裂纹、检验动作和对白边界",
        submittedAt: "2026-08-29T07:00:00.000Z",
      },
    });
    assert.equal(result.response.status, 202);
    const analysisJobId = result.payload.job.requestId;
    const analyzed = await pollMediaJob(base, ownerCookie, analysisJobId);
    assert.equal(analyzed.result.shots.length, 5);
    assert.equal(analyzed.result.mangaPages[0].panels.length, 5);
    assert.equal(analyzed.result.panelBoxPlan.sourceIdentity.version, "ordered-sha256-v1");
    assert.equal(analyzed.result.panelBoxPlan.sourceIdentity.pages[0].scanIndex, 1);
    assert.match(analyzed.result.panelBoxPlan.sourceIdentity.pages[0].sha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(analyzed.result.shots.flatMap((shot) => shot.sourcePanels), panelIds);
    assert.deepEqual(analyzed.result.research, { mode: "off", used: false, queries: [], sources: [], notes: [] });
    assert.deepEqual(analyzed.result.researchPolicy, {
      requestedMode: "supplement",
      effectiveMode: "off",
      supportsWebSearch: false,
      downgraded: true,
      provider: "glm",
    });
    assert.deepEqual(analyzed.result.previewUrls, [`/api/media-source/${mediaId}`]);
    assert.ok(analyzed.result.previewUrls.every((url) => !url.includes("127.0.0.1")), "public previews must route through the gateway");

    const sourceResponse = await fetch(`${base}${analyzed.result.previewUrls[0]}`, { headers: { Cookie: ownerCookie } });
    assert.equal(sourceResponse.status, 200);
    assert.equal(sourceResponse.headers.get("content-type"), "image/png");

    const panelResponse = await fetch(`${base}/api/media-panel/${analysisJobId}/${panelIds[0]}`, { headers: { Cookie: ownerCookie } });
    assert.equal(panelResponse.status, 200);
    assert.equal(panelResponse.headers.get("content-type"), "image/webp");
    const panelMetadata = await sharp(Buffer.from(await panelResponse.arrayBuffer())).metadata();
    assert.ok(Number(panelMetadata.width) > 0 && Number(panelMetadata.height) > 0);

    result = await jsonRequest(base, "/api/auth/register", {
      method: "POST",
      body: { email: "isolated-director@example.com", displayName: "隔离导演", password: "isolated-password" },
    });
    assert.equal(result.response.status, 201);
    const otherCookie = sessionCookies(result.response);

    result = await jsonRequest(base, `/api/media-job-result?requestId=${analysisJobId}`, { cookie: otherCookie });
    assert.equal(result.response.status, 404, "another user must not recover the owner's analysis");
    const isolatedPanel = await fetch(`${base}/api/media-panel/${analysisJobId}/${panelIds[0]}`, { headers: { Cookie: otherCookie } });
    assert.equal(isolatedPanel.status, 404, "another user's worker must not see the owner's crop");
    result = await jsonRequest(base, "/api/health", {
      cookie: otherCookie,
      headers: { "X-Manjing-Project": owner.activeProject.id },
    });
    assert.equal(result.response.status, 403, "a project id cannot cross account boundaries");

    result = await jsonRequest(base, "/api/manga-recut-boxes", {
      method: "POST",
      cookie: ownerCookie,
      body: { sourceRequestId: analysisJobId, mediaIds: [mediaId] },
    });
    assert.equal(result.response.status, 202);
    const recut = await pollMediaJob(base, ownerCookie, result.payload.job.requestId);
    assert.equal(recut.result.panelCount, 5);
    assert.equal(recut.result.shotCount, 5);

    result = await jsonRequest(base, "/api/load-script", {
      method: "POST",
      cookie: ownerCookie,
      body: {
        fileName: "jade-chain.md",
        content: analyzed.result.scriptMarkdown,
        sourceType: "file",
        generationModel: "seedance-2.5",
        defaultArtStyle: finalArtStyle,
      },
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.payload.projectTitle, projectTitle);
    assert.equal(result.payload.shots.length, 5);

    const projectUid = ensureProjectUid("", `${projectTitle}::${sourceFileName}`);
    const shots = result.payload.shots.map((shot) => ({
      ...shot,
      shotUid: ensureShotUid("", projectUid, `${shot.id}::${shot.sourcePanels.join("|")}`),
    }));
    const promptResults = [];
    const reviewResults = [];

    for (const shot of shots) {
      result = await jsonRequest(base, "/api/source-shot", {
        method: "POST",
        cookie: ownerCookie,
        body: { projectTitle, workspaceScope: "material-draft", generationModel: "seedance-2.5", shot },
      });
      assert.equal(result.response.status, 200);
      assert.equal(result.payload.status, "draft-only");

      const sourceRevision = buildCompleteShotPromptRevision({
        projectTitle,
        modelId: "seedance-2.5",
        writingModelId: "glm-5.3-flash",
        globalSettings,
        shot,
        shotAnnotations: {},
        panelAnnotations: {},
        sourceMangaRequestId: analysisJobId,
      });
      result = await jsonRequest(base, "/api/complete-shot-prompt", {
        method: "POST",
        cookie: ownerCookie,
        body: {
          projectUid,
          projectTitle,
          generationModel: "seedance-2.5",
          writingModelId: "glm-5.3-flash",
          globalSettings,
          sourceMangaRequestId: analysisJobId,
          sourceRevision,
          shot,
          shotAnnotations: {},
          panelAnnotations: {},
        },
      });
      assert.equal(result.response.status, 200);
      assert.equal(result.payload.status, "completed");
      assert.equal(result.payload.projectUid, projectUid);
      assert.equal(result.payload.shotUid, shot.shotUid);
      assert.equal(result.payload.sourceRevision, sourceRevision);
      assert.equal(result.payload.generatorId, fakeGlmModel);
      assert.equal(result.payload.generatorProvider, "glm");
      assert.equal(result.payload.requestedGeneratorId, fakeGlmModel);
      assert.equal(result.payload.generatorUsage?.total_tokens, 20);
      assert.deepEqual(result.payload.evidence.sourcePanels, shot.sourcePanels);
      promptResults.push(result.payload);

      const reviewRevision = buildPromptReviewRevision({
        shotId: shot.id,
        completePrompt: result.payload.prompt,
        completePromptSourceRevision: result.payload.sourceRevision,
        completePromptGeneratorId: result.payload.generatorId,
        reviewerId: "kimi-k3",
      });
      result = await jsonRequest(base, "/api/review-shot-prompt", {
        method: "POST",
        cookie: ownerCookie,
        body: {
          operationMode: "strict-review",
          projectUid,
          projectTitle,
          generationModel: "seedance-2.5",
          globalSettings,
          sourceMangaRequestId: analysisJobId,
          sourceRevision: reviewRevision,
          completePromptSourceRevision: result.payload.sourceRevision,
          reviewerId: "kimi-k3",
          completePromptGeneratorId: fakeGlmModel,
          completePrompt: promptResults.at(-1).prompt,
          shot,
          shotAnnotations: {},
          panelAnnotations: {},
        },
      });
      assert.equal(result.response.status, 200);
      assert.equal(result.payload.status, "completed");
      assert.equal(result.payload.reviewerId, "kimi-k3");
      assert.equal(result.payload.reviewerProvider, "kimi");
      assert.equal(result.payload.reviewerRequestedModel, fakeKimiModel);
      assert.equal(result.payload.reviewerModel, fakeKimiModel);
      assert.equal(result.payload.reviewerUsage?.total_tokens, 20);
      assert.equal(result.payload.completePromptGeneratorId, fakeGlmModel);
      assert.equal(result.payload.report.verdict, "discussion-ready");
      assert.equal(result.payload.sourceRevision, reviewRevision);
      assert.equal(result.payload.evidence.independentRun, true);
      reviewResults.push(result.payload);
    }

    const beforeApproval = deriveProductionPipeline({
      hasMangaSource: true,
      structureConfirmed: true,
      shotCount: shots.length,
      scriptAppliedCount: shots.length,
      promptReadyCount: promptResults.length,
      promptReviewedCount: reviewResults.length,
      approvedCount: 0,
      videoReadyCount: 0,
    });
    assert.equal(beforeApproval.find((stage) => stage.id === "review").status, "completed");
    assert.equal(beforeApproval.find((stage) => stage.id === "video").status, "blocked");

    const impossibleApproval = deriveProductionPipeline({
      hasMangaSource: true,
      structureConfirmed: true,
      shotCount: shots.length,
      scriptAppliedCount: shots.length,
      promptReadyCount: shots.length,
      promptReviewedCount: 0,
      approvedCount: shots.length,
      videoReadyCount: 0,
    });
    assert.equal(impossibleApproval.find((stage) => stage.id === "video").status, "blocked", "approval counts cannot bypass independent review");

    const unapprovedGeneratingPackage = readyVideoPackage(shots[0], false, "generating");
    assert.equal(unapprovedGeneratingPackage.status, "blocked", "an in-flight artwork must not bypass user approval");
    const videoPackages = shots.map((shot) => readyVideoPackage(shot));
    assert.ok(videoPackages.every((item) => item.status === "ready"));

    const approvedPipeline = deriveProductionPipeline({
      hasMangaSource: true,
      structureConfirmed: true,
      shotCount: shots.length,
      scriptAppliedCount: shots.length,
      promptReadyCount: promptResults.length,
      promptReviewedCount: reviewResults.length,
      approvedCount: shots.length,
      videoReadyCount: videoPackages.length,
    });
    assert.equal(approvedPipeline.find((stage) => stage.id === "video").status, "ready");

    const manifest = buildProjectManifest({
      projectUid,
      projectTitle,
      sourceName: sourceFileName,
      generationModel: "seedance-2.5",
      sourceMangaRequestId: analysisJobId,
      pipeline: approvedPipeline,
      shots: shots.map((shot, index) => ({
        shotUid: shot.shotUid,
        displayNumber: shot.id,
        title: shot.title,
        sourcePanels: shot.sourcePanels,
        scriptStatus: "applied",
        completePromptStatus: "ready",
        promptReviewStatus: "ready",
        promptReviewVerdict: reviewResults[index].report.verdict,
        approved: true,
        approvedAt: "2026-08-29T08:00:00.000Z",
        videoPackageStatus: videoPackages[index].status,
        sourceRevision: videoPackages[index].sourceRevision,
      })),
    });
    assert.deepEqual(manifest.agentContract.validation.issues, []);
    assert.ok(manifest.agentContract.shots.every((shot) => shot.humanLocked));
    const silentlyChanged = structuredClone(manifest.agentContract);
    silentlyChanged.shots[0].title = "Agent 静默改写";
    assert.throws(() => assertHumanLocksPreserved(manifest.agentContract, silentlyChanged), /不能修改人工锁定/);
    assert.equal(assertHumanLocksPreserved(manifest.agentContract, silentlyChanged, {
      explicitlyUnlockedShotUids: [shots[0].shotUid],
    }), true);

    const draftState = {
      stateSchemaVersion: 16,
      projectUid,
      projectTitle,
      sourceName: sourceFileName,
      reviews: shots.map((shot, index) => ({
        shot,
        scriptStatus: "applied",
        completePromptStatus: "ready",
        completePrompt: promptResults[index].prompt,
        promptReviewStatus: "ready",
        promptReviewReport: reviewResults[index].report,
        approved: true,
        approvedAt: "2026-08-29T08:00:00.000Z",
      })),
    };
    result = await jsonRequest(base, "/api/draft-state", {
      method: "POST",
      cookie: ownerCookie,
      body: { scopeId: "jade-production-chain", storageKey: "e2e", state: draftState },
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.payload.status, "saved");
    result = await jsonRequest(base, "/api/draft-state?scopeId=jade-production-chain", { cookie: ownerCookie });
    assert.equal(result.response.status, 200);
    assert.equal(result.payload.state.projectUid, projectUid);
    assert.equal(result.payload.state.reviews.length, 5);

    result = await jsonRequest(base, "/api/generate", {
      method: "POST",
      cookie: ownerCookie,
      body: { shot: shots[0], prompt: videoPackages[0].prompt, approved: true },
    });
    assert.equal(result.response.status, 402);
    assert.equal(result.payload.code, "USAGE_NOT_ENABLED");

    result = await jsonRequest(base, "/api/harness/status?limit=50", { cookie: ownerCookie });
    assert.equal(result.response.status, 200);
    assert.equal(result.payload.runs.filter((run) => run.agentRole === "creator" && run.status === "completed").length, 11);
    assert.equal(result.payload.runs.filter((run) => run.agentRole === "review" && run.status === "completed").length, 5);

    const callCounts = Object.fromEntries([...new Set(modelCalls.map((call) => call.schemaName))].map((name) => [
      name,
      modelCalls.filter((call) => call.schemaName === name).length,
    ]));
    assert.deepEqual(callCounts, {
      "manga-panel-boxes": 2,
      "media-analysis": 2,
      "script-load": 1,
      "complete-shot-prompt": 6,
      "prompt-review": 5,
    });
    const creatorCalls = modelCalls.filter((call) => call.schemaName !== "prompt-review");
    const reviewerCalls = modelCalls.filter((call) => call.schemaName === "prompt-review");
    assert.ok(creatorCalls.every((call) => call.model === fakeGlmModel && call.toolCount === 1));
    assert.ok(reviewerCalls.every((call) => call.model === fakeKimiModel && call.toolCount === 1));
    assert.ok(creatorCalls.every((call) => call.maxTokens === 16_384 && call.maxCompletionTokens === undefined));
    assert.ok(reviewerCalls.every((call) => call.maxCompletionTokens === 32_768 && call.maxTokens === undefined));
    assert.ok(modelCalls.every((call) => /\u4e0d\u53ef\u4fe1\u4efb\u52a1\u6570\u636e/.test(call.systemText)));
    assert.ok(modelCalls.filter((call) => call.schemaName !== "script-load").every((call) => call.imageCount >= 1));
    const attachmentOnlyCalls = modelCalls.filter((call) => [
      "manga-panel-boxes",
      "media-analysis",
      "complete-shot-prompt",
      "prompt-review",
    ].includes(call.schemaName));
    assert.ok(attachmentOnlyCalls.every((call) => /图片附件|附件\s+\d+\s+→/.test(call.prompt)));
    assert.ok(attachmentOnlyCalls.every((call) => /当前 API 不提供 view_image 或本地路径读取工具/.test(call.prompt)));
    assert.ok(attachmentOnlyCalls.every((call) => !call.prompt.includes(dataRoot)), "compatible prompts must not expose unusable tenant-local paths");
    const mediaPrompts = modelCalls.filter((call) => call.schemaName === "media-analysis").map((call) => call.prompt).join("\n");
    assert.match(mediaPrompts, /不是“一格机械等于一镜”/);
    assert.match(mediaPrompts, /相同地点、时间和摄影机意图下的连续反应格可合并/);
    assert.match(mediaPrompts, /技术限制只能在 provider 适配层解决/);
    assert.doesNotMatch(mediaPrompts, /短促动作、单一反应或信息点可以独立设计为 6 秒/);
    assert.doesNotMatch(mediaPrompts, /主要出镜人物组合改变/);
    assert.match(mediaPrompts, /用户请求了 supplement[\s\S]*本次已明确降级为 off/);
    assert.match(mediaPrompts, /research 必须返回 \{"mode":"off","used":false,"queries":\[\],"sources":\[\],"notes":\[\]\}/);
    assert.ok(modelCalls.some((call) => call.schemaName === "media-analysis" && /(?:联网背景记录与本次分析模式不一致|联网背景已关闭，但写作模型返回了网络资料)/.test(call.prompt)), "fabricated media research must trigger repair");
    assert.ok(modelCalls.some((call) => call.schemaName === "complete-shot-prompt" && /当前写作模型没有联网工具/.test(call.prompt)), "fabricated prompt research must trigger repair");

    // Full Chat API path: gateway -> isolated Worker -> Creator -> committed recovery.
    const chatPayload = {
      projectUid, projectTitle, generationModel: "seedance-2.5", globalSettings,
      sourceMangaRequestId: analysisJobId, sourceRevision: promptResults[0].sourceRevision,
      shot: shots[0], currentPrompt: promptResults[0].prompt, allowRevision: true,
      chatTurnId: "11111111-2222-4333-8444-555555555555",
      message: "请按审核建议修改：增加两秒停顿。", history: [],
    };
    result = await jsonRequest(base, "/api/shot-chat", { cookie: ownerCookie, method: "POST", body: chatPayload });
    assert.equal(result.response.status, 200, JSON.stringify(result.payload));
    assert.equal(result.payload.action, "revise");
    assert.equal(result.payload.shotUid, shots[0].shotUid);
    assert.equal(result.payload.projectUid, projectUid);
    assert.equal(result.payload.generatorId, fakeGlmModel);
    assert.equal(result.payload.generatorProvider, "glm");
    assert.match(result.payload.prompt, /两秒停顿/);
    assert.equal(result.payload.approved, undefined);
    const chatResult = result.payload;
    const query = new URLSearchParams({ type: "shot-chat", chatTurnId: chatPayload.chatTurnId, projectUid, shotUid: shots[0].shotUid, sourceRevision: chatPayload.sourceRevision });
    result = await jsonRequest(base, `/api/job-result?${query}`, { cookie: ownerCookie });
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.payload, chatResult);
    const callsAfterChat = modelCalls.length;
    result = await jsonRequest(base, "/api/shot-chat", { cookie: ownerCookie, method: "POST", body: chatPayload });
    assert.equal(result.response.status, 200);
    assert.equal(modelCalls.length, callsAfterChat, "same turn must never submit a second model call");
    query.set("shotUid", "shot-unrelated");
    result = await jsonRequest(base, `/api/job-result?${query}`, { cookie: ownerCookie });
    assert.equal(result.response.status, 404);
    result = await jsonRequest(base, "/api/shot-chat", { cookie: ownerCookie, method: "POST", body: {
      ...chatPayload, chatTurnId: "22222222-2222-4333-8444-555555555555", allowRevision: false,
      currentPrompt: chatResult.prompt, message: "只讨论，不改稿", history: [{ role: "user", text: chatPayload.message }, { role: "assistant", text: chatResult.reply }],
    } });
    assert.equal(result.response.status, 200, JSON.stringify(result.payload));
    assert.equal(result.payload.action, "reply");
    assert.equal(result.payload.prompt, "");
    const chatCalls = modelCalls.filter(call => call.schemaName === "shot-chat");
    assert.equal(chatCalls.length, 2);
    assert.ok(chatCalls.every(call => call.model === fakeGlmModel && call.imageCount >= 1 && call.reasoningEffort === "max"));
    result = await jsonRequest(base, "/api/health", { cookie: ownerCookie });
    assert.deepEqual(result.payload.shotWork, { limit: 5, active: 0, queued: 0 });

    const callsBeforeSwitch = modelCalls.length;
    result = await jsonRequest(base, "/api/writing-model", {
      method: "POST",
      cookie: ownerCookie,
      body: { id: "kimi-k3" },
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.payload.modelProvider.id, "kimi");
    assert.equal(result.payload.writingModels.find(({ id }) => id === "kimi-k3").selected, true);

    result = await jsonRequest(base, "/api/load-script", {
      method: "POST",
      cookie: ownerCookie,
      body: {
        fileName: "kimi-route-check.md",
        content: analyzed.result.scriptMarkdown,
        sourceType: "file",
        generationModel: "seedance-2.5",
        defaultArtStyle: finalArtStyle,
      },
    });
    assert.equal(result.response.status, 200);
    assert.equal(result.payload.projectTitle, projectTitle);
    const switchedCalls = modelCalls.slice(callsBeforeSwitch);
    assert.equal(switchedCalls.length, 1);
    assert.equal(switchedCalls[0].schemaName, "script-load");
    assert.equal(switchedCalls[0].model, fakeKimiModel);
    assert.equal(switchedCalls[0].maxTokens, undefined);
    assert.equal(switchedCalls[0].maxCompletionTokens, 16_384);

    result = await jsonRequest(base, "/api/health", { cookie: otherCookie });
    assert.equal(result.response.status, 200);
    assert.equal(result.payload.modelProvider.id, "glm", "another user's project must keep its own writing-model selection");

    // Manual diagnostic uses the selected catalog entries, not the project's current Kimi selection.
    result = await jsonRequest(base, '/api/model-tests', { method: 'POST', cookie: ownerCookie, body: { ids: ['glm-5.3-flash'], requestId: '11111111-2222-4333-8444-777777777777' } });
    assert.equal(result.response.status, 202, JSON.stringify(result.payload));
    for (let attempt = 0; attempt < 100; attempt++) {
      result = await jsonRequest(base, '/api/model-tests', { cookie: ownerCookie });
      if (result.payload.round.status !== 'running') break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    const probe = result.payload.models.find(model => model.id === 'glm-5.3-flash').result;
    assert.equal(probe.status, 'succeeded', JSON.stringify(probe));
    assert.equal(probe.actualModel, fakeGlmModel);
    assert.ok(probe.finishedAt);
    const probeCalls = modelCalls.filter(call => call.schemaName === 'model_connectivity_test');
    assert.equal(probeCalls.length, 1);
    assert.equal(probeCalls[0].reasoningEffort, 'low');
    assert.equal(probeCalls[0].maxTokens, 2048);
    assert.equal(probeCalls[0].imageCount, 0);
    result = await jsonRequest(base, '/api/health', { cookie: ownerCookie });
    assert.equal(result.payload.modelProvider.id, 'kimi');
    result = await jsonRequest(base, '/api/model-tests', { cookie: otherCookie });
    assert.equal(result.payload.round, null, 'diagnostic results must remain tenant-isolated');

    result = await jsonRequest(base, "/api/auth/logout", { method: "POST", cookie: otherCookie });
    assert.equal(result.response.status, 200);
    result = await jsonRequest(base, "/api/auth/logout", { method: "POST", cookie: ownerCookie });
    assert.equal(result.response.status, 200);
    result = await jsonRequest(base, "/api/health", { cookie: ownerCookie });
    assert.equal(result.response.status, 401);
    result = await jsonRequest(base, "/api/auth/me", { cookie: ownerCookie });
    assert.deepEqual(result.payload, { authenticated: false, serverMode: true });
  } finally {
    await closeServer(gateway.server);
    await gateway.close();
    await closeServer(fakeModel);
    rmSync(root, { recursive: true, force: true });
  }
});

const largeBatchPageCount = 40;
const largeBatchPanelsPerPage = 2;
const largeBatchStyle = "BATCH_TEST_STYLE｜写实真人电影测试风格";

function largeBatchPageName(scanIndex) {
  return `batch-page-${String(scanIndex).padStart(2, "0")}.png`;
}

function largeBatchPanelIds(scanIndex) {
  const prefix = `P${String(scanIndex).padStart(2, "0")}`;
  return Array.from({ length: largeBatchPanelsPerPage }, (_, index) => `${prefix}-G${String(index + 1).padStart(2, "0")}`);
}

function parseMangaBatchScope(prompt) {
  const match = String(prompt || "").match(/<manga_batch_scope>\s*(\{[^\n]+\})\s*<\/manga_batch_scope>/u);
  if (!match) throw new Error("fake model did not receive manga_batch_scope");
  return JSON.parse(match[1]);
}

function largeBatchBox(index) {
  return {
    tempId: `B${String(index + 1).padStart(2, "0")}`,
    bounds: { x: index * 50, y: 0, width: 50, height: 100 },
    role: "regular",
    missingEdges: [],
    detectionOrder: index + 1,
    readingOrder: index + 1,
    confidence: "high",
    rationale: "测试框",
  };
}

function largeBatchPanelBoxFixture(scope) {
  const boxCount = scope.stage === "panel-recut" ? largeBatchPanelsPerPage : 1;
  return {
    status: "completed",
    pages: scope.pages.map((page) => ({
      scanIndex: page.scanIndex,
      sourceFile: page.sourceFile,
      notes: scope.stage,
      boxes: Array.from({ length: boxCount }, (_, index) => largeBatchBox(index)),
    })),
  };
}

function largeBatchShot(localIndex, panelId) {
  const id = String(localIndex + 1).padStart(2, "0");
  return {
    id,
    timecode: `00:${String(localIndex * 6).padStart(2, "0")}–00:${String((localIndex + 1) * 6).padStart(2, "0")}`,
    duration: 6,
    title: panelId,
    sourceText: [`${panelId} 台词`],
    sourcePanels: [panelId],
    artStyle: largeBatchStyle,
    story: `${panelId} 剧情`,
    scene: "测试场景",
    characters: ["主人公"],
    props: [],
    omniReferences: [],
    composition: "固定构图",
    camera: "固定机位",
    action: "完成动作",
    dialogue: [],
    continuity: [],
    negative: [],
    segments: [],
  };
}

function largeBatchMediaFixture(scope) {
  const pages = scope.pages.map((page) => {
    const panelIds = largeBatchPanelIds(page.scanIndex);
    return {
      scanIndex: page.scanIndex,
      sourceFile: page.sourceFile,
      layout: "single-page",
      classification: "story",
      readingOrder: panelIds,
      includeInShots: true,
      notes: "两格测试页",
      panels: panelIds.map((panelId, index) => ({
        id: panelId,
        bounds: largeBatchBox(index).bounds,
        kind: "story",
        includeInShots: true,
        sourceObservation: `${panelId} 可见动作`,
        textSummary: `${panelId} 台词`,
      })),
    };
  });
  const panelIds = pages.flatMap((page) => page.readingOrder);
  const shots = panelIds.map((panelId, index) => largeBatchShot(index, panelId));
  return {
    status: "completed",
    kind: "manga",
    projectTitle: "四十页分批测试",
    summary: `第 ${scope.startScanIndex}–${scope.endScanIndex} 页`,
    sourceText: panelIds.map((panelId) => ({ location: panelId, speaker: "主人公", text: "测试台词", confidence: "high" })),
    cameraNotes: ["固定轴线"],
    timeline: panelIds.map((panelId, index) => ({
      index: index + 1,
      timecode: panelId,
      story: "剧情",
      sourceObservation: "画格证据",
      adaptationSuggestion: "固定机位",
      shotSize: "中景",
      camera: "正面",
      movement: "固定",
      editing: "顺切",
      performance: "自然",
      sound: "环境声",
      keep: [],
      issues: [],
    })),
    mangaPages: pages,
    assetPrompts: [{
      id: "CHAR-01",
      kind: "character",
      name: "主人公",
      sourceObservation: `可见于 ${panelIds.join("、")}`,
      prompt: `${largeBatchStyle}，主人公定妆，来源不可确认处不锁定`,
      negative: [],
      sourcePanels: panelIds,
      shotIds: shots.map((shot) => shot.id),
    }],
    research: { mode: "off", used: false, queries: [], sources: [], notes: [] },
    shots,
    scriptMarkdown: `# 第 ${scope.startScanIndex}–${scope.endScanIndex} 页`,
  };
}

test("forty manga pages stay within four-page model batches and merge into stable global ids", { timeout: 120_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "manjing-forty-page-batch-"));
  const dataRoot = join(root, "data");
  const modelCalls = [];
  const fakeModel = createServer((req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try {
        const body = JSON.parse(raw || "{}");
        const tool = body.tools?.[0];
        const schemaName = String(tool?.function?.name || "").replace(/_schema$/, "");
        const prompt = chatPrompt(body);
        const scope = parseMangaBatchScope(prompt);
        const output = schemaName === "manga-panel-boxes"
          ? largeBatchPanelBoxFixture(scope)
          : schemaName === "media-analysis"
            ? largeBatchMediaFixture(scope)
            : null;
        if (!output) throw new Error(`unsupported schema ${schemaName}`);
        const outputBytes = Buffer.byteLength(JSON.stringify(output), "utf8");
        modelCalls.push({
          schemaName,
          stage: scope.stage,
          scope,
          imageCount: (raw.match(/data:image\//g) || []).length,
          outputBytes,
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          id: `chatcmpl-batch-${modelCalls.length}`,
          model: body.model,
          choices: [{
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{
                id: `call-batch-${modelCalls.length}`,
                type: "function",
                function: { name: tool.function.name, arguments: JSON.stringify(output) },
              }],
            },
            finish_reason: "tool_calls",
          }],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        }));
      } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: error instanceof Error ? error.message : "fake model failure" } }));
      }
    });
  });
  const modelPort = await listen(fakeModel);
  const store = new ManjingAuthStore({ filename: join(dataRoot, "auth.sqlite") });
  const workerPool = new TenantWorkerPool({
    appRoot: resolve(fileURLToPath(new URL("..", import.meta.url))),
    dataRoot,
    maxWorkers: 1,
    maxWorkersPerUser: 1,
    shutdownWaitMs: 2_000,
    startupTimeoutMs: 20_000,
    baseEnv: {
      ...process.env,
      OPENAI_API_KEY: "",
      MANJING_AI_PROVIDER: "glm",
      MANJING_GLM_API_KEY: "test-only-not-a-real-glm-key",
      MANJING_GLM_BASE_URL: `http://127.0.0.1:${modelPort}/v1`,
      MANJING_GLM_MODEL: fakeGlmModel,
      MANJING_GLM_MAX_OUTPUT_TOKENS: "16384",
      LIBTV_BIN: "/usr/bin/false",
    },
  });
  const gateway = createManjingGateway({
    store,
    workerPool,
    cookieSecure: false,
    dailyLimits: {
      ai: 1_000,
      globalAi: 1_000,
      image: 0,
      globalImage: 0,
      libtv: 0,
      globalLibtv: 0,
      libtvLogin: 1,
      globalLibtvLogin: 1,
      upload: 100,
      globalUpload: 100,
      uploadBytes: 50_000_000,
      globalUploadBytes: 50_000_000,
    },
  });
  const gatewayPort = await listen(gateway.server);
  const base = `http://127.0.0.1:${gatewayPort}`;

  try {
    let result = await jsonRequest(base, "/api/auth/register", {
      method: "POST",
      body: { email: "forty-pages@example.com", displayName: "四十页导演", password: "forty-page-test-password" },
    });
    assert.equal(result.response.status, 201);
    const cookie = sessionCookies(result.response);
    const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#eee" } }).png().toBuffer();
    const mediaIds = [];
    for (let scanIndex = 1; scanIndex <= largeBatchPageCount; scanIndex += 1) {
      result = await jsonRequest(base, `/api/media-upload?kind=manga&name=${largeBatchPageName(scanIndex)}&mime=image%2Fpng`, {
        method: "POST",
        cookie,
        body: png,
        headers: { "Content-Type": "image/png", "Content-Length": String(png.length) },
      });
      assert.equal(result.response.status, 201);
      mediaIds.push(result.payload.mediaId);
    }

    result = await jsonRequest(base, "/api/media-analyze", {
      method: "POST",
      cookie,
      body: {
        kind: "manga",
        mediaIds,
        generationModel: "seedance-2.5",
        storyBackground: "四十页连续剧情，仅用于验证分批后顺序保持。",
        defaultArtStyle: largeBatchStyle,
        webResearch: "off",
        readingDirection: "right-to-left",
        brief: "验证四十页安全分批",
      },
    });
    assert.equal(result.response.status, 202);
    const analyzed = await pollMediaJob(base, cookie, result.payload.job.requestId, 90_000);
    const finalResult = analyzed.result;
    const expectedPanelIds = Array.from({ length: largeBatchPageCount }, (_, index) => largeBatchPanelIds(index + 1)).flat();
    assert.equal(finalResult.mangaPages.length, largeBatchPageCount);
    assert.equal(finalResult.panelBoxPlan.pages.length, largeBatchPageCount);
    assert.ok(finalResult.panelBoxPlan.pages.every((page) => page.boxes.length === largeBatchPanelsPerPage));
    assert.deepEqual(finalResult.mangaPages.map((page) => page.scanIndex), Array.from({ length: largeBatchPageCount }, (_, index) => index + 1));
    assert.deepEqual(finalResult.mangaPages.flatMap((page) => page.panels.map((panel) => panel.id)), expectedPanelIds);
    assert.deepEqual(finalResult.shots.map((shot) => shot.id), expectedPanelIds.map((_, index) => String(index + 1).padStart(2, "0")));
    assert.deepEqual(finalResult.shots.flatMap((shot) => shot.sourcePanels), expectedPanelIds);
    assert.equal(finalResult.assetPrompts.length, 1, "same named character asset must merge across all batches");
    assert.deepEqual(finalResult.assetPrompts[0].shotIds, finalResult.shots.map((shot) => shot.id));
    assert.equal(finalResult.shots[0].timecode, "00:00–00:06");
    assert.equal(finalResult.shots.at(-1).timecode, "07:54–08:00");

    assert.equal(modelCalls.filter((call) => call.stage === "panel-boxes").length, 10);
    assert.equal(modelCalls.filter((call) => call.stage === "media-analysis").length, 40);
    assert.equal(modelCalls.filter((call) => call.stage === "panel-recut").length, 10);
    assert.ok(modelCalls.every((call) => call.imageCount >= 1 && call.imageCount <= 4));
    assert.ok(modelCalls.every((call) => call.scope.pages.length >= 1 && call.scope.pages.length <= 4));
    assert.ok(modelCalls.every((call) => call.outputBytes < 16_384), "each fake structured response must fit below 16k bytes");
    for (const stage of ["panel-boxes", "panel-recut"]) {
      const calls = modelCalls.filter((call) => call.stage === stage);
      assert.deepEqual(calls.map((call) => [call.scope.startScanIndex, call.scope.endScanIndex]), Array.from({ length: 10 }, (_, index) => [index * 4 + 1, index * 4 + 4]));
    }
    const analysisCalls = modelCalls.filter((call) => call.stage === "media-analysis");
    assert.deepEqual(analysisCalls.map((call) => [call.scope.startScanIndex, call.scope.endScanIndex]), Array.from({ length: 40 }, (_, index) => [index + 1, index + 1]));
  } finally {
    await closeServer(gateway.server);
    await gateway.close();
    await closeServer(fakeModel);
    rmSync(root, { recursive: true, force: true });
  }
});
