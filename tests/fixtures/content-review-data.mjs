// Synthetic contract fixture. No production story claims or real model output.
export const contentPanelIds = ['P01-L-G01', 'P01-L-G02', ...Array.from({ length: 8 }, (_, i) => `P02-R-G${String(i + 1).padStart(2, '0')}`)];
export function contentReviewState() {
  const shot = {
    id: '01', shotUid: 'shot-content-fixture01', duration: 26, timecode: '00:00–00:26', sourcePanels: [...contentPanelIds],
    title: '人工核对测试', artStyle: '原创测试', story: '保留原故事', scene: '保留原场景', characters: ['测试人物'], props: ['测试物品'],
    omniReferences: [], composition: '保留原构图', camera: '保留机位', dialogue: ['保留原对白'], sourceText: ['保留原文字'],
    action: '旧稿：本镜 8 秒，结束 G04', segments: [{ label: '0–8s', beat: '旧节拍', framing: '旧构图', mustShow: contentPanelIds.slice(0, 9) }],
    negative: ['旧稿：不得超出 G06', '无 BGM'], continuity: ['旧稿：止于 G04'],
  };
  const review = {
    shot, annotations: {}, scriptStatus: 'applied', completePrompt: '测试当前 26 秒提示词，正文必须完整保留。', completePromptStatus: 'ready',
    completePromptSourceRevision: 'complete-old', completePromptGeneratorId: 'fixture-creator', completePromptGeneratorProvider: 'fixture', completePromptGeneratedAt: '2026-09-10T00:00:00Z',
    promptReviewStatus: 'ready', promptReviewReport: { verdict: 'discussion-ready', summary: '旧报告的证据与 Creator 说法冲突（合成测试）', strengths: [],
      checks: { sourceBoundary: true, characterContinuity: true, timingFeasible: false, dialogueFeasible: true, cameraAndActionCoherent: true, soundAndNegativeComplete: true },
      findings: [{ id: 'conflict', severity: 'warning', category: 'source', title: '识别冲突', detail: '旧识别认为是图案 A，Creator 认为是图案 B，待人确认。', suggestion: '对照原裁图人工核对。', panelIds: ['P02-R-G05'] }] },
    promptReviewRequestId: 'old-request', promptReviewRunId: 'old-run', promptReviewSourceRevision: 'old-review', promptReviewedAt: '2026-09-10T01:00:00Z',
    approved: true, approvedAt: '2026-09-10T02:00:00Z', artworkStatus: 'ready', artworkNames: ['retained.webp'], whiteboxScenes: {}, versions: [],
    chat: { messages: [{ id: 'creator-old', role: 'assistant', createdAt: '2026-09-10T02:00:00Z', text: '图中是 B（仅为合成待核对说法）' }], promptHistory: [{ prompt: '更早的旧提示词' }] },
  };
  return {
    stateSchemaVersion: 16, projectUid: 'project-content-fixture', projectTitle: '人工核对合成测试', sourceName: '原创测试图', sourceDocument: '测试来源必须保留', generationModel: 'seedance-2.5',
    currentShot: 0, view: 'script', workspaceMode: 'shots', structureStatus: 'confirmed', sourceMangaRequestId: '22222222-2222-4222-8222-222222222222',
    globalSettings: { storyBackground: '测试世界观', adaptationFocus: '', characterProfiles: [], characters: [], props: [], locations: [], timeline: ['Shot 01 旧 8 秒，止于 G04', 'Shot 02 的原事件保留'], continuity: ['全局连续性原样'], finalVideoStyle: '测试风格', storyboardImageStyle: '', modelRules: [], negative: [] },
    sourceMangaPanels: Object.fromEntries(contentPanelIds.map(id => [id, { sourceObservation: '旧模型识别 A', dialogue: [], characters: [], textSummary: '', relationAndPlot: '' }])),
    reviews: [review, { ...structuredClone(review), shot: { ...structuredClone(shot), id: '02', shotUid: 'shot-content-fixture02', sourcePanels: ['P03-R-G01'], duration: 8, timecode: '00:26–00:34' } }],
  };
}
export function completedContentWorksheet(session) {
  return { ...structuredClone(session.worksheet),
    confirmedBy: '人工测试替身（非真实内容裁定）', action: '本镜总时长 26 秒，覆盖 10 格，止于 P02-R-G08',
    panels: contentPanelIds.map(panelId => ({ panelId, checked: true, decision: 'corrected', observation: `${panelId} 合成图案 B`, textStatus: 'none', sourceText: [], note: '合成测试的人工输入' })),
    segments: [{ start: 0, end: 10, beat: '人工节拍一', framing: '人工构图一', panelIds: contentPanelIds.slice(0, 3) }, { start: 10, end: 26, beat: '人工节拍二', framing: '人工构图二', panelIds: contentPanelIds.slice(3) }],
    negative: ['边界止于 P02-R-G08，不得带入下一格', '无 BGM'], continuity: ['本镜 10 格按原顺序连续至 P02-R-G08'],
    timeline: ['Shot 01：26 秒、10 格、止于 P02-R-G08', session.worksheet.timeline[1]],
  };
}
