/**
 * Isolated data service for the REAL React workbench's visual acceptance.
 * All text, images, identities and saved states below are synthetic fixtures.
 * No provider, proxy, credential, filesystem persistence or generation exists.
 *
 * Start: node tests/fixtures/workbench-ui.mjs
 * Frontend: NEXT_PUBLIC_MANJING_API_BASE=http://127.0.0.1:3349 npm run dev:site -- --hostname 127.0.0.1 --port 3348
 * Counters: GET http://127.0.0.1:3349/__fixture/status
 * A fixture model may be selected to inspect UI, but invoking it is rejected.
 */
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

export const workbenchFixturePort = 3349;
export const workbenchFixtureOrigin = 'http://127.0.0.1:3348';
const fixtureAt = '2026-09-05T11:20:00.000Z';
const projectId = 'fixture-workbench-project';
const mangaId = '22222222-2222-4222-8222-222222222222';
const globalFileId = 'fixture-global-file';
const fixtureNotice = 'UI 验收测试数据 · 非真实作品、账号或 AI 生成结果';
const panelsPerShot = [4, 3, 5, 2, 4, 3, 2];
const shotTitles = ['雨夜归途', '书店重逢', '一封旧信', '窗边的决定', '车站告别', '清晨启程', '新的旅程'];
const locations = ['雨夜街角', '旧书店', '书店柜台', '二楼窗边', '城郊车站', '清晨站台', '列车车窗'];
const storyLines = [
  '林遥撑伞停在书店门外，透过玻璃看见暖色灯光。',
  '店主将一本旧书放在柜台上，林遥认出了封面的笔迹。',
  '一封信从书页中滑落，两人将它平放在桌面。',
  '林遥站在窗边，把信收进口袋，转身望向门口。',
  '列车即将进站，店主把书交给林遥，两人短暂对视。',
  '林遥登上列车，站台的灯光从车窗外缓慢掠过。',
  '晨光落在翻开的书页上，林遥抬头看向窗外。',
];

const fixtureGlobals = {
  storyBackground: '【UI 测试设定】原创短篇《雨夜书店》。故事发生于一座虚构港口城市，仅用于检查漫画、提示词与视频工作台的界面布局。',
  adaptationFocus: '保留安静、克制的情绪，通过人物停顿和环境变化串联连续画格；所有内容均为界面测试样例。',
  characterProfiles: [
    { id: 'fixture-linyao', name: '林遥（测试角色）', japaneseName: '', biography: '在离开城市前，回到旧书店寻找一本童年的书。独立、安静，习惯观察细节。', identity: '成年旅人，与店主相识多年', appearance: '成年女性，短发，清晰自然的面部轮廓', wardrobe: '深色外套、浅色衬衣、帆布包', performanceBoundary: '情绪通过眼神和动作停顿表达，避免夸张表演', faceRestriction: '允许正脸，仅使用原创测试人物' },
    { id: 'fixture-shopkeeper', name: '店主（测试角色）', japaneseName: '', biography: '经营街角书店的中年人，珍惜旧物，也尊重每个人离开的决定。', identity: '旧书店经营者', appearance: '成年男性，短发，戴细框眼镜', wardrobe: '针织衫、深色长裤', performanceBoundary: '温和、从容，不作夸张喜剧动作', faceRestriction: '允许正脸，仅使用原创测试人物' },
  ],
  characters: ['人物身份和服装在全片保持连续。'],
  props: ['旧书', '折好的信', '深色雨伞'],
  locations: ['街角书店', '城郊车站'],
  timeline: ['傍晚降雨 → 夜间重逢 → 次日清晨出发'],
  continuity: ['旧书的封面、雨伞与人物服装前后保持一致。'],
  finalVideoStyle: '【UI 测试风格】写实电影质感，克制的自然光，低饱和色彩；非真实生成指令。',
  storyboardImageStyle: '【UI 测试风格】黑白线稿，仅用于检查结构参考和排版。',
  modelRules: ['保留人工确定的 Shot 归属、时长与阅读顺序。'],
  negative: ['禁止自动提交生成任务', '禁止未经用户确认提交视频', '不要背景音乐', '不添加中文对白'],
};

function makePrompt(index) {
  return `【UI 验收样例 · 非 AI 生成结果】\n\n【故事背景】\n原创测试短篇《雨夜书店》。${storyLines[index]}\n\n【时代烙印】\n当代虚构港口城市，街灯、书店陈设与列车环境保持统一。\n\n【人物画像】\n林遥：成年旅人，短发、深色外套。店主：成年男性，针织衫、细框眼镜。\n\n【原作剧情依据】\n本镜 ${panelsPerShot[index]} 张测试画格依照既定阅读顺序组织，不补写相邻镜头事件。\n\n【最终美术风格】\n自然光、低饱和色彩和克制的摄影机运动。此文字只用于排版验收。\n\n【本 Shot 执行】\n00:00–00:06 先建立${locations[index]}的空间关系。\n00:06–00:16 ${storyLines[index]}\n00:16–00:24 保留动作结束后的停顿，镜头稳定观察人物。\n00:24–00:30 以环境声和静止构图衔接下一镜。\n\n【声音与连续性】\n不添加背景音乐或中文对白。保留雨声、脚步或列车环境声；不改变人物服装和道具。`;
}

function makeReview(index) {
  const id = String(index + 1).padStart(2, '0');
  const sourcePanels = Array.from({ length: panelsPerShot[index] }, (_, panel) => `P${id}-R-G${String(panel + 1).padStart(2, '0')}`);
  return {
    shot: {
      id, shotUid: `fixture-shot-${id}`, timecode: `00:${String(index * 30 % 60).padStart(2, '0')}–00:30`, duration: 30,
      title: shotTitles[index], story: `【UI 测试样例】${storyLines[index]}`, scene: locations[index],
      characters: index === 0 || index > 4 ? ['林遥（测试角色）'] : ['林遥（测试角色）', '店主（测试角色）'],
      props: ['旧书'], omniReferences: [], composition: '保留人物、门窗和主要道具之间的空间关系。',
      camera: '稳定中景，缓慢推进；以下数据用于 UI 验收。', action: storyLines[index],
      dialogue: [], continuity: ['保持人物服装和道具一致'], negative: ['不要背景音乐', '不要中文对白'],
      segments: [], sourceText: [], sourcePanels, artStyle: fixtureGlobals.finalVideoStyle,
    },
    annotations: {}, scriptStatus: index < 4 ? 'applied' : 'draft', artworkStatus: 'empty', approved: false,
    versions: [], whiteboxScenes: {}, seededAssetReferenceIds: [],
    completePrompt: index < 5 ? makePrompt(index) : '',
    completePromptStatus: index === 3 ? 'stale' : index < 5 ? 'ready' : 'empty',
    completePromptSummary: index === 3 ? '【测试状态】时长已调整，保留旧稿供核对。' : index < 5 ? '【测试状态】已有示例讨论稿，未实际调用模型。' : '【测试状态】尚无讨论稿。',
    completePromptGeneratedAt: index < 5 ? fixtureAt : undefined,
    completePromptSourceRevision: index < 5 ? `fixture-source-${id}` : undefined,
    completePromptGeneratorId: index < 5 ? 'ui-fixture-no-model' : undefined,
    completePromptGeneratorProvider: index < 5 ? 'fixture' : undefined,
    completePromptWarnings: [], completePromptResearch: { used: false, queries: [], sources: [], notes: [] },
    promptReviewerId: 'kimi-k3', promptReviewStatus: index === 1 ? 'ready' : 'empty',
    ...(index === 1 ? {
      promptReviewedAt: fixtureAt, promptReviewerModel: 'ui-fixture-reviewer',
      promptReviewReport: {
        verdict: 'needs-revision', summary: '【UI 测试报告】建议明确动作结束后的停顿；这不是实际审核结果。', strengths: ['测试：剧情与本镜画格边界一致。'],
        checks: { sourceBoundary: true, characterContinuity: true, timingFeasible: false, dialogueFeasible: true, cameraAndActionCoherent: true, soundAndNegativeComplete: true },
        findings: [{ id: 'fixture-finding-1', severity: 'warning', category: 'timing', title: '停顿时长需要明确（测试）', detail: '示例文本的动作停顿尚未量化。', panelIds: sourcePanels.slice(0, 1), suggestion: '在现有时长内注明两秒停顿，不重新编组或改变原图。' }],
      },
    } : {}),
  };
}

function makeSnapshot() {
  const reviews = shotTitles.map((_, index) => makeReview(index));
  return {
    stateSchemaVersion: 16, projectUid: projectId, projectTitle: '雨夜书店 · UI 验收测试', sourceName: '原创 SVG 测试素材',
    sourceDocument: storyLines.map((line, index) => `${index + 1}. ${line}`).join('\n'),
    selectedRecipeId: '', generationModel: 'seedance-2.5', workspaceMode: 'shots', currentShot: 0, view: 'script',
    globalSettings: structuredClone(fixtureGlobals), globalFileId, globalFileName: '雨夜书店 · 测试全局文件',
    globalAnnotation: '', globalStatus: 'applied', globalSummary: fixtureNotice, globalUpdatedAt: fixtureAt,
    assetPrompts: [], structureStatus: 'draft', sourceMangaRequestId: mangaId, sourceMangaReadingDirection: 'right-to-left',
    sourceMangaPanelAnnotations: {}, sourceMangaPanelUnderstandingVersion: 2,
    sourceMangaPanels: Object.fromEntries(reviews.flatMap((review, index) => review.shot.sourcePanels.map(panelId => [panelId, {
      sourceObservation: `【测试素材】${storyLines[index]}`, textSummary: `测试画格 · ${shotTitles[index]}`,
      dialogue: [], characters: review.shot.characters, relationAndPlot: `【测试素材】本格属于「${shotTitles[index]}」。`,
    }]))), reviews,
  };
}

const models = [
  ['glm-5.3-flash', 'GLM-5.3-Flash', 'glm', 'glm-5.3-flash'],
  ['kimi-k3', 'Kimi K3', 'kimi', 'k3'],
  ['deepseek-v4-flash', 'DeepSeek V4 Flash', 'deepseek', 'deepseek-v4-flash'],
  ['deepseek-v4-pro', 'DeepSeek V4 Pro', 'deepseek', 'deepseek-v4-pro'],
  ['seed-2.1-pro', 'Seed 2.1 Pro', 'doubao-responses', 'doubao-seed-2-1-pro-260628'],
  ['jk-gpt-5.6-sol', 'JK GPT-5.6 Sol', 'jiekou-responses', 'gpt-5.6-sol'],
  ['ko-gpt-5.6-luna', 'KO GPT-5.6 Luna', 'konjac-responses', 'gpt-5.6-luna'],
  ['jk-gpt-5.6-luna', 'JK GPT-5.6 Luna', 'jiekou-responses', 'gpt-5.6-luna'],
  ['jk-gemini-3.8-flash', 'JK Gemini 3.8 Flash', 'jiekou-chat', 'gemini-3.8-flash'],
  ['jk-claude-opus-5', 'JK Claude Opus 5', 'jiekou-anthropic', 'claude-opus-5'],
  ['jk-claude-sonnet-5', 'JK Claude Sonnet 5', 'jiekou-anthropic', 'claude-sonnet-5'],
].map(([id, label, provider, model]) => ({ id, label, provider, model, available: true, supportsImages: true, hint: 'UI 测试选项 · 不可实际调用' }));

function panelSvg(panelId) {
  const number = Number(panelId.match(/G(\d+)/)?.[1] || 1);
  const portrait = number % 3 === 0;
  const width = portrait ? 360 : 600, height = portrait ? 520 : 380;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 600 480" role="img" aria-label="原创 UI 测试画格 ${panelId}">
  <rect width="600" height="480" fill="#eeeae2"/><rect x="20" y="20" width="560" height="440" fill="#faf9f6" stroke="#303b44" stroke-width="5"/>
  <path d="M40 380H560M45 175H555M90 175V380M505 175V380M45 80L90 60M135 95L185 70M390 93L425 70M510 100L545 77" fill="none" stroke="#9aa4aa" stroke-width="3"/>
  <rect x="335" y="190" width="145" height="180" fill="#dfe3e3" stroke="#495762" stroke-width="4"/><path d="M405 190V370M335 280H480" stroke="#687882" stroke-width="3"/>
  <circle cx="210" cy="231" r="38" fill="#c4cbcc" stroke="#33414b" stroke-width="4"/><path d="M174 268Q208 252 246 271L264 370H155Z" fill="#52636b" stroke="#33414b" stroke-width="4"/>
  <path d="M173 284L135 330M240 287L288 327M178 370L173 410M238 370L247 410" stroke="#33414b" stroke-width="12" fill="none" stroke-linecap="round"/>
  <rect x="62" y="48" width="230" height="70" rx="8" fill="#fff" stroke="#495762" stroke-width="2"/><text x="82" y="79" font-family="sans-serif" font-size="20" fill="#303b44">UI 验收测试素材</text><text x="82" y="104" font-family="monospace" font-size="16" fill="#687882">${panelId}</text>
  <text x="300" y="440" text-anchor="middle" font-family="sans-serif" font-size="17" fill="#52636b">原创示意 · 非漫画裁图 / 非 AI 生成结果</text></svg>`;
}

export function createWorkbenchFixtureServer() {
  let snapshot = makeSnapshot();
  let selectedModel = 'jk-gpt-5.6-sol';
  let selectedEffort = 'high';
  const files = new Map([[globalFileId, { id: globalFileId, name: '雨夜书店 · 测试全局文件', updatedAt: fixtureAt, payload: { schemaVersion: 1, settings: structuredClone(fixtureGlobals), assetPrompts: [], referenceAssets: [] } }]]);
  const requests = new Map();
  const counters = { requests: 0, draftSaves: 0, modelTestReads: 0, modelTestAttempts: 0, generationAttempts: 0, blockedWrites: 0, outboundRequests: 0 };
  const denied = [];
  const health = () => ({
    connected: true, serverMode: true, busy: false, fixture: true, notice: fixtureNotice,
    shotWork: { limit: 5, active: 0, queued: 0 }, promptJobs: [], lastPromptJobs: [], artworkJobs: [], assetJobs: [],
    modelProvider: { ...models.find(model => model.id === selectedModel), id: 'fixture', selectionId: selectedModel, configured: true, supportsWebSearch: false },
    writingModels: models.map(model => ({ ...model, selected: model.id === selectedModel })),
    reasoningPolicy: { selected: selectedEffort, options: ['low', 'high', 'max'], taskOverrides: { mangaSplit: 'low', completeShotPrompt: 'max', strictReview: 'max' } },
    reviewers: models.filter(model => ['kimi-k3', 'glm-5.3-flash', 'jk-gpt-5.6-sol', 'jk-gemini-3.8-flash', 'jk-claude-opus-5'].includes(model.id)).map(model => ({ ...model, evidenceMode: 'direct-images', lastCall: { status: 'untested', message: 'UI 测试选项，没有实际调用' } })),
    harness: { harnessVersion: 'ui-fixture', runs: [] },
    libtv: { installed: false, status: 'missing', message: 'UI 验收环境：无视频服务，禁止提交生成任务。' },
  });
  const session = () => ({ serverMode: true, authenticated: true, fixture: true, user: { id: 'fixture-user', email: 'ui-fixture@example.test', displayName: 'UI 验收测试', role: 'superadmin' }, projects: [{ id: projectId, name: snapshot.projectTitle }], activeProject: { id: projectId, name: snapshot.projectTitle } });

  return createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', workbenchFixtureOrigin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Manjing-Token,X-ShotDirector-Token');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Cache-Control', 'no-store');
    const json = (value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    if (req.headers.origin && req.headers.origin !== workbenchFixtureOrigin) { json({ error: 'Fixture origin is not allowed' }, 403); return; }
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const url = new URL(req.url || '/', 'http://127.0.0.1:3349');
    const method = req.method || 'GET', path = url.pathname;
    counters.requests++;
    const requestKey = `${method} ${path}`;
    requests.set(requestKey, (requests.get(requestKey) || 0) + 1);
    const block = (reason, kind = 'blockedWrites') => {
      counters[kind]++;
      denied.push({ method, path, reason, at: new Date().toISOString() });
      if (denied.length > 100) denied.shift();
      json({ error: reason, fixture: true, retryPolicy: 'never' }, 403);
    };
    try {
      if (path === '/__fixture/status' && method === 'GET') {
        json({ notice: fixtureNotice, counters, requests: Object.fromEntries(requests), denied, stateSavedInMemoryOnly: true }); return;
      }
      if (path === '/model-tests' && method !== 'GET') { block('UI 验收环境禁止调用 LLM 测试；没有发起真实请求。', 'modelTestAttempts'); return; }
      if (/^\/(?:shot-chat|review-shot-prompt|complete-shot-prompt|generate|analyze|annotation|artwork|asset-artwork|video|libtv|load-script|media-analysis)/.test(path) && method !== 'GET') {
        block('UI 验收环境禁止 LLM、图片与视频生成；没有发起真实请求。', 'generationAttempts'); return;
      }
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 8 * 1024 * 1024) { json({ error: 'Fixture payload too large' }, 413); return; }
      }
      const payload = body ? JSON.parse(body) : {};
      if (path === '/auth/me' && method === 'GET') { json(session()); return; }
      if (path === '/health' && method === 'GET') { json(health()); return; }
      if (path === '/draft-state-recent' && method === 'GET') { json({ scopeId: mangaId, projectTitle: snapshot.projectTitle, savedAt: fixtureAt, fixture: true }); return; }
      if (path === '/draft-state') {
        if (method === 'POST') {
          if (!payload.state || payload.state.projectUid !== projectId || !Array.isArray(payload.state.reviews)) { json({ error: 'Only this synthetic fixture project may be saved' }, 400); return; }
          snapshot = structuredClone(payload.state); counters.draftSaves++; json({ status: 'saved', savedAt: new Date().toISOString(), fixture: true }); return;
        }
        if (method === 'GET') { json({ state: snapshot, fixture: true }); return; }
      }
      if (path === '/model-tests' && method === 'GET') {
        counters.modelTestReads++;
        json({ fixture: true, models: models.map((model, index) => ({ ...model, result: index < 3 ? {
          status: ['succeeded', 'format_warning', 'failed'][index], requestedModel: `fixture:${model.model}`, actualModel: index < 2 ? 'ui-fixture-no-model' : undefined,
          startedAt: fixtureAt, finishedAt: fixtureAt, durationMs: [2400, 3510, 9000][index],
          error: ['【UI 样例】接口与格式均正常，未实际测试。', '【UI 样例】完整响应、格式不符，未实际测试。', '【UI 样例】请求超时，未实际测试。'][index],
        } : undefined })) }); return;
      }
      if (path === '/global-files' && method === 'GET') { json({ files: [...files.values()].map(({ id, name, updatedAt }) => ({ id, name, updatedAt })) }); return; }
      if (path === '/global-files/load' && method === 'GET') { const file = files.get(url.searchParams.get('id')); json(file ? { file } : { error: 'Fixture global file not found' }, file ? 200 : 404); return; }
      if (path === '/global-files/save' && method === 'POST') {
        if (typeof payload.name !== 'string' || !payload.payload?.settings) { json({ error: 'Invalid fixture global file' }, 400); return; }
        const id = payload.globalFileId || `fixture-global-${files.size + 1}`;
        const file = { id, name: payload.name, payload: payload.payload, updatedAt: new Date().toISOString() };
        files.set(id, file); json({ file, fixture: true }); return;
      }
      if (path === '/writing-model' && method === 'POST') {
        if (!models.some(model => model.id === payload.id)) { json({ error: 'Unknown fixture selection' }, 400); return; }
        selectedModel = payload.id; json(health()); return;
      }
      if (path === '/reasoning-effort' && method === 'POST') {
        if (!['low', 'high', 'max'].includes(payload.effort)) { json({ error: 'Invalid fixture effort' }, 400); return; }
        selectedEffort = payload.effort; json({ reasoningPolicy: health().reasoningPolicy }); return;
      }
      if (['/source-global-settings', '/projects/rename', '/source-shot'].includes(path) && method === 'POST') {
        if (path === '/projects/rename' && typeof payload.name === 'string') snapshot.projectTitle = payload.name;
        if (path === '/source-global-settings' && payload.settings) snapshot.globalSettings = structuredClone(payload.settings);
        json({ status: 'saved', savedAt: new Date().toISOString(), fixture: true }); return;
      }
      if (path === '/projects/select' && method === 'POST' && payload.projectId === projectId) { json(session()); return; }
      if (path === '/job-result' && method === 'GET') { json({ status: 'not-found', fixture: true }, 404); return; }
      const panelMatch = path.match(/^\/media-panel\/([a-f0-9-]+)\/(P\d{2}-R-G\d{2})$/i);
      if (panelMatch && method === 'GET' && panelMatch[1] === mangaId && snapshot.sourceMangaPanels[panelMatch[2]]) {
        res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8' }); res.end(panelSvg(panelMatch[2])); return;
      }
      if (method !== 'GET') { block('该操作不在隔离 UI 验收服务允许范围内；无外部请求。'); return; }
      json({ error: 'Unknown isolated fixture read route', fixture: true }, 404);
    } catch (error) {
      json({ error: error instanceof SyntaxError ? 'Invalid fixture JSON' : 'Fixture request failed' }, 400);
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createWorkbenchFixtureServer().listen(workbenchFixturePort, '127.0.0.1', () => {
    console.log(`Isolated UI fixture ready: http://127.0.0.1:${workbenchFixturePort} — ${fixtureNotice}`);
  });
}
