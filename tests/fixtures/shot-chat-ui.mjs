// Local UI-only fixture. Never routes to a real model or production data.
import { createServer } from 'node:http';
import { ShotWorkScheduler } from '../../server/shot-work-scheduler.mjs';
const scheduler = new ShotWorkScheduler();
const mangaId = '11111111-1111-4111-8111-111111111111';
const oldPrompt = '【故事背景】测试项目。\n【时代烙印】测试年代。\n【人物画像】测试人物。\n【原作剧情依据】测试画格。\n【最终美术风格】测试风格。\n【本Shot执行】保持原作顺序，不增加对白，人物转身后停顿，固定摄影机，只保留环境声。';
const globals = { storyBackground: 'UI fixture only', adaptationFocus: '', characterProfiles: [], characters: [], props: [], locations: [], timeline: [], continuity: [], finalVideoStyle: 'test', storyboardImageStyle: 'test', modelRules: [], negative: [] };
const makeReport = () => ({ verdict: 'needs-revision', summary: '停顿需要明确', strengths: [], checks: { sourceBoundary: true, characterContinuity: true, timingFeasible: false, dialogueFeasible: true, cameraAndActionCoherent: true, soundAndNegativeComplete: true }, findings: [{ id: 'f1', severity: 'warning', category: 'timing', title: '停顿', detail: '没有标明停顿时长', panelIds: ['P01-R-G01'], suggestion: '增加两秒停顿' }] });
let snapshot = { projectUid: 'ui-project', projectTitle: 'Chat 与五槽队列测试', globalSettings: globals, generationModel: 'seedance-2.5', reviews: Array.from({ length: 7 }, (_, i) => ({ shot: { id: String(i + 1).padStart(2, '0'), shotUid: `ui-shot-${i + 1}`, timecode: '00:00–00:30', duration: 30, title: `测试镜头 ${i + 1}`, story: 'test', scene: 'test', characters: ['测试人物'], props: [], omniReferences: [], composition: 'test', camera: 'test', action: 'test', dialogue: [], continuity: [], negative: [], segments: [], sourceText: [], sourcePanels: ['P01-R-G01'], artStyle: 'test' }, versions: [], annotations: { characters: '保留的历史批注' }, scriptStatus: 'draft', artworkStatus: 'empty', approved: false, completePrompt: oldPrompt, completePromptStatus: 'ready', completePromptSourceRevision: 'ui-v1', completePromptGeneratorId: 'fixture-model', promptReviewerId: 'kimi-k3', promptReviewStatus: 'ready', promptReviewReport: makeReport() })), currentShot: 0, view: 'script', workspaceMode: 'shots', structureStatus: 'draft', sourceMangaRequestId: mangaId, sourceDocument: 'test', sourceMangaPanels: {}, sourceMangaPanelAnnotations: { 'P01-R-G01': '历史画格批注' }, assetPrompts: [], globalStatus: 'applied' };
const turns = new Map(), jobs = new Map(), log = [];
let delay = 350;
createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:3338');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Manjing-Token');
  if (req.method === 'OPTIONS') { res.end(); return; }
  const url = new URL(req.url, 'http://127.0.0.1');
  let text = ''; for await (const chunk of req) text += chunk;
  const json = (value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
  if (url.pathname === '/control') { delay = Number(url.searchParams.get('delay') || 350); json({ ok: true }); return; }
  if (url.pathname === '/log') { json(log); return; }
  if (url.pathname === '/auth/me') { json({ serverMode: true, authenticated: true, user: { id: 'ui-user', email: 'fixture@example.test', role: 'superadmin' }, projects: [{ id: 'ui-project', name: snapshot.projectTitle }], activeProject: { id: 'ui-project', name: snapshot.projectTitle } }); return; }
  if (url.pathname === '/health') { json({ connected: true, serverMode: true, busy: jobs.size > 0, shotWork: scheduler.snapshot(), promptJobs: [...jobs.values()], modelProvider: { configured: true, id: 'glm', label: 'Fixture 主力 Agent' }, reviewers: [{ id: 'kimi-k3', label: 'Fixture Reviewer', available: true, evidenceMode: 'direct-images' }] }); return; }
  if (url.pathname === '/draft-state') {
    if (req.method === 'POST') { snapshot = JSON.parse(text).state; json({ status: 'saved' }); return; }
    json({ state: snapshot }); return;
  }
  if (['/projects/rename', '/source-global-settings', '/source-shot'].includes(url.pathname)) { json({ status: 'saved' }); return; }
  if (url.pathname === '/job-result' && url.searchParams.get('type') === 'shot-chat') { const result = turns.get(url.searchParams.get('chatTurnId')); json(result || { status: 'running' }, result ? 200 : 202); return; }
  if (['/shot-chat', '/review-shot-prompt', '/complete-shot-prompt'].includes(url.pathname)) {
    const p = JSON.parse(text), type = url.pathname.slice(1) === 'review-shot-prompt' ? 'prompt-review' : url.pathname.slice(1);
    const job = { projectUid: p.projectUid, shotUid: p.shot.shotUid, shotId: p.shot.id, type, status: 'running', stage: 'queued', message: '排队中' };
    const key = p.chatTurnId || `${type}-${p.shot.shotUid}`; jobs.set(key, job);
    log.push({ type, shotUid: p.shot.shotUid, message: p.message, history: p.history });
    try {
      const result = await scheduler.run(job, async () => {
        await new Promise(resolve => setTimeout(resolve, delay));
        if (type === 'shot-chat') {
          const replyOnly = /只讨论/.test(p.message);
          return { status: 'completed', projectUid: p.projectUid, shotUid: p.shot.shotUid, sourceRevision: p.sourceRevision, chatTurnId: p.chatTurnId, action: replyOnly ? 'reply' : 'revise', reply: replyOnly ? '这里只解释，没有改稿。' : '已补充两秒停顿，其他内容保持。', prompt: replyOnly ? '' : p.currentPrompt + '\n测试修改：人物转身后停顿两秒。', generatedAt: new Date().toISOString(), generatorId: 'fixture-model', generatorProvider: 'fixture' };
        }
        if (type === 'prompt-review') return { status: 'completed', shotId: p.shot.id, projectUid: p.projectUid, shotUid: p.shot.shotUid, reviewerId: p.reviewerId, sourceRevision: p.sourceRevision, report: { ...makeReport(), verdict: 'discussion-ready', findings: [] }, reviewedAt: new Date().toISOString(), reviewerModel: 'fixture-reviewer', requestId: crypto.randomUUID() };
        return { status: 'completed', projectUid: p.projectUid, shotId: p.shot.id, shotUid: p.shot.shotUid, sourceRevision: p.sourceRevision, prompt: oldPrompt, summary: '测试生成', research: { used: false, queries: [], sources: [], notes: [] }, warnings: [], generatedAt: new Date().toISOString(), generatorId: 'fixture-model' };
      }, () => { job.stage = 'running'; job.message = '正在处理'; });
      if (p.chatTurnId) turns.set(p.chatTurnId, result); json(result);
    } catch (error) { json({ error: error.message }, 409); }
    finally { jobs.delete(key); }
    return;
  }
  if (url.pathname.startsWith('/media-panel/')) { res.writeHead(200, { 'Content-Type': 'image/svg+xml' }); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="180"><text x="20" y="90">TEST PANEL</text></svg>'); return; }
  json({ error: 'not a fixture route' }, 404);
}).listen(3339, '127.0.0.1', () => console.log('shot chat fixture ready'));
