import { confirmedMangaPixelBounds } from './manga-native-box.mjs';

// Targeted human correction: never rerun detection, regroup Shots or renumber
// existing IDs. The retired composite stays available for audit/undo.
export function splitConfirmedMangaPanel({ analysis, state, parentId, children }) {
  const nextAnalysis = structuredClone(analysis);
  const nextState = structuredClone(state);
  const page = nextAnalysis.mangaPages.find(p => p.panels.some(p => p.id === parentId));
  const parent = page?.panels.find(p => p.id === parentId);
  if (!parent?.includeInShots) throw new Error('目标画格不存在或已经拆分');
  const owners = nextState.reviews.filter(r => r.shot.sourcePanels?.includes(parentId));
  if (owners.length !== 1) throw new Error('目标画格必须且仅属于一个 Shot');
  if (owners[0].approved || owners[0].completePromptStatus === 'generating' || owners[0].promptReviewStatus === 'reviewing') throw new Error('已批准或正在生成/审核的 Shot 不可修改');
  const ids = new Set(nextAnalysis.mangaPages.flatMap(p => p.panels.map(p => p.id)));
  if (!Array.isArray(children) || children.length !== 2) throw new Error('需要两个按阅读顺序排列的人工确认框');
  const source = nextAnalysis.sourceFiles[page.scanIndex - 1];
  for (const child of children) {
    if (!/^P\d{2}-(?:[RL]-)?G\d{2}$/.test(child.id) || ids.has(child.id)) throw new Error('新画格 ID 无效或重复');
    ids.add(child.id);
    if (!confirmedMangaPixelBounds(child, source.width, source.height)) throw new Error('缺少原图像素坐标');
  }
  const childIds = children.map(c => c.id);
  const replace = values => values.flatMap(id => id === parentId ? childIds : [id]);
  const panels = children.map(child => ({
    ...child,
    kind: parent.kind, includeInShots: true, parentPanelId: parentId,
    bounds: { x: child.bbox_px[0] * 100 / source.width, y: child.bbox_px[1] * 100 / source.height,
      width: (child.bbox_px[2] - child.bbox_px[0]) * 100 / source.width,
      height: (child.bbox_px[3] - child.bbox_px[1]) * 100 / source.height },
    cropConfidence: 'high', cropReviewRequired: false,
  }));
  parent.includeInShots = false;
  parent.supersededBy = childIds;
  page.panels.splice(page.panels.indexOf(parent) + 1, 0, ...panels);
  page.readingOrder = replace(page.readingOrder);
  for (const item of [...(nextAnalysis.shots || []), ...(nextAnalysis.assetPrompts || [])]) {
    if (item.sourcePanels) item.sourcePanels = replace(item.sourcePanels);
  }
  const owner = owners[0];
  owner.shot.sourcePanels = replace(owner.shot.sourcePanels);
  owner.completePromptStatus = owner.completePrompt?.trim() ? 'stale' : 'empty';
  owner.completePromptSummary = '人工校正：原合并画格已拆为两张，先右后左。旧提示词保留，需按新画格证据重新复核；Shot 分组与时长未改。';
  owner.completePromptConfirmedAt = undefined;
  owner.completePromptSourceRevision = undefined;
  owner.promptReviewStatus = owner.promptReviewReport ? 'stale' : 'empty';
  owner.promptReviewSourceRevision = undefined;
  nextState.structureStatus = 'draft';
  nextState.structureConfirmedAt = undefined;
  nextState.sourceMangaPanels ||= {};
  for (const panel of panels) nextState.sourceMangaPanels[panel.id] = {
    sourceObservation: panel.sourceObservation, textSummary: panel.textSummary,
    dialogue: [], characters: ['受拘束男子'], relationAndPlot: panel.textSummary,
  };
  const geometry = nextState.sourceMangaReadingPages?.find(p => p.scanIndex === page.scanIndex);
  if (geometry) {
    geometry.panels = structuredClone(page.panels);
    geometry.readingOrder = [...page.readingOrder];
  }
  const boxPage = nextAnalysis.panelBoxPlan?.pages?.find(p => p.scanIndex === page.scanIndex);
  if (boxPage) {
    const oldIndex = boxPage.boxes.findIndex(b => JSON.stringify(b.bounds) === JSON.stringify(parent.bounds));
    if (oldIndex >= 0) {
      const oldBox = boxPage.boxes[oldIndex];
      boxPage.retiredBoxes = [...(boxPage.retiredBoxes || []), { ...oldBox, supersededBy: childIds }];
      let number = Math.max(0, ...boxPage.boxes.map(b => Number(b.tempId.replace(/^B/, '')) || 0));
      boxPage.boxes.splice(oldIndex, 1, ...panels.map(p => ({
        tempId: `B${String(++number).padStart(2, '0')}`, panelId: p.id,
        bounds: p.bounds, bbox_px: p.bbox_px, source_width: source.width, source_height: source.height,
        role: 'regular', missingEdges: p.missingEdges || [], detectionOrder: number,
        readingOrder: page.readingOrder.indexOf(p.id) + 1, confidence: 'high', rationale: p.boxToBoxRationale,
      })));
    }
  }
  return { analysis: nextAnalysis, state: nextState, panels, shotId: owner.shot.id };
}
