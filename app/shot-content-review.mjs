// No model calls or inferred story facts. This contract is shared by the
// human-review UI and the authoritative draft transaction on the Worker.
export function contentReviewTarget(shot) {
  return shot?.id === '01' && shot.duration === 26
    && shot.sourcePanels?.length === 10
    && new Set(shot.sourcePanels).size === 10
    && shot.sourcePanels.at(-1) === 'P02-R-G08';
}

export function contentReviewGuard(state) {
  return JSON.stringify({
    projectUid: state.projectUid, projectTitle: state.projectTitle,
    sourceMangaRequestId: state.sourceMangaRequestId,
    sourceMangaPanels: state.sourceMangaPanels,
    sourceMangaPanelAnnotations: state.sourceMangaPanelAnnotations,
    sourceMangaReadingPages: state.sourceMangaReadingPages,
    generationModel: state.generationModel, globalSettings: state.globalSettings,
    structureStatus: state.structureStatus, reviews: state.reviews,
  });
}

export function segmentSeconds(label) {
  const match = String(label).trim().match(/^(\d+(?:\.\d+)?)\s*[–—\-~至]\s*(\d+(?:\.\d+)?)\s*(?:s|秒)?$/i);
  return match ? [Number(match[1]), Number(match[2])] : [null, null];
}

export function initialContentWorksheet(review, timeline) {
  return {
    panels: review.shot.sourcePanels.map(panelId => ({
      panelId, checked: false, decision: '', observation: '', textStatus: '', sourceText: [], note: '',
    })),
    action: review.shot.action,
    segments: review.shot.segments.map(segment => {
      const [start, end] = segmentSeconds(segment.label);
      return { start, end, beat: segment.beat, framing: segment.framing,
        panelIds: segment.mustShow.filter(value => review.shot.sourcePanels.includes(value)),
        mustShow: segment.mustShow.filter(value => !review.shot.sourcePanels.includes(value)) };
    }),
    negative: [...review.shot.negative], continuity: [...review.shot.continuity],
    timeline: [...timeline], confirmedBy: '',
  };
}

export function validateContentWorksheet(sheet, panelIds) {
  const errors = [];
  if (!sheet || typeof sheet !== 'object') return ['核对草稿缺失'];
  const allowed = ['panels', 'action', 'segments', 'negative', 'continuity', 'timeline', 'confirmedBy'];
  if (Object.keys(sheet).some(key => !allowed.includes(key))) errors.push('核对草稿包含同步范围之外的字段');
  const nonempty = value => typeof value === 'string' && Boolean(value.trim());
  if (!nonempty(sheet.confirmedBy)) errors.push('请填写核对人');
  if (!Array.isArray(sheet.panels) || JSON.stringify(sheet.panels.map(p => p?.panelId)) !== JSON.stringify(panelIds)) {
    errors.push('必须按已保存顺序核对全部 10 个画格，结束于 P02-R-G08');
  } else for (const panel of sheet.panels) {
    if (panel.checked !== true || !['confirmed', 'corrected', 'uncertain'].includes(panel.decision)
      || !nonempty(panel.observation)) errors.push(`${panel.panelId} 尚未完成人工核对`);
    if (panel.decision === 'uncertain') errors.push(`${panel.panelId} 仍有未裁定的事实冲突，请保留草稿，暂不确认同步`);
    if (panel.decision === 'corrected' && !nonempty(panel.note)) errors.push(`${panel.panelId} 请说明纠正依据`);
    if (!['transcribed', 'none', 'unreadable'].includes(panel.textStatus)
      || !Array.isArray(panel.sourceText) || panel.sourceText.some(line => !nonempty(line.text) || typeof line.speaker !== 'string')
      || (panel.textStatus === 'transcribed' ? !panel.sourceText.length : panel.sourceText.length !== 0)) {
      errors.push(`${panel.panelId} 请明确原文核对结果；无文字或无法辨读时不能补写台词`);
    }
    if (panel.textStatus === 'unreadable' && !nonempty(panel.note)) errors.push(`${panel.panelId} 请记录无法辨读的范围`);
  }
  if (!nonempty(sheet.action)) errors.push('请核对动作与时长结构说明');
  for (const field of ['negative', 'continuity', 'timeline']) {
    if (!Array.isArray(sheet[field]) || !sheet[field].length || sheet[field].some(value => !nonempty(value))) errors.push(`${field} 必须逐项核对并保留有效条目`);
  }
  // Flag explicit legacy scope declarations, never rewrite prose or treat an
  // ordinary reference to G04/G06 (or an internal 8-second beat) as an error.
  const oldDuration = /(?:本镜|全镜|总时长|当前设置为|Shot\s*0?1(?:\s|[:：]))[^。；\n\d]{0,12}8\s*秒/i;
  if (oldDuration.test(sheet.action || '')) errors.push('action 仍声明本镜为旧 8 秒，请人工核对后修正');
  const actionOutside = [...String(sheet.action || '').matchAll(/P\d{2}-(?:[RL]-)?G\d{2}/g)].map(([id]) => id).filter(id => !panelIds.includes(id));
  if (actionOutside.length) errors.push(`action 引用了本镜范围外画格 ${[...new Set(actionOutside)].join('、')}，请人工核对边界`);
  const oldBoundary = /(?:止于|截止(?:于|到)?|结束[于在]?|不得超出|不能超出|不要超出|禁止超出)[\s：:]*(?:P\d{2}-(?:[RL]-)?)?G0[1-7](?!\d)/i;
  for (const field of ['negative', 'continuity']) {
    if (Array.isArray(sheet[field]) && sheet[field].some(value => oldBoundary.test(value))) errors.push(`${field} 仍声明旧画格终点，请按 G08 人工核对后修正`);
  }
  if (Array.isArray(sheet.timeline) && sheet.timeline.some(value => /Shot\s*0?1\b/i.test(value) && (oldDuration.test(value) || oldBoundary.test(value)))) errors.push('全局时间线仍声明 Shot 01 的旧时长或终点，请人工核对');
  let elapsed = 0;
  const covered = [];
  if (!Array.isArray(sheet.segments) || !sheet.segments.length) errors.push('请填写覆盖 0–26 秒的 segments');
  else for (const [index, segment] of sheet.segments.entries()) {
    if (!Number.isFinite(segment.start) || !Number.isFinite(segment.end)
      || Math.abs(segment.start - elapsed) > 0.000001 || segment.end <= segment.start || segment.end > 26) {
      errors.push(`第 ${index + 1} 段必须连续、无重叠且在 0–26 秒内`);
    }
    elapsed = segment.end;
    if (!nonempty(segment.beat) || !nonempty(segment.framing)) errors.push(`第 ${index + 1} 段缺少人工核对后的动作或构图`);
    if (segment.mustShow !== undefined && (!Array.isArray(segment.mustShow) || segment.mustShow.some(value => !nonempty(value)
      || [...value.matchAll(/P\d{2}-(?:[RL]-)?G\d{2}/g)].some(([id]) => !panelIds.includes(id))))) errors.push(`第 ${index + 1} 段的必须呈现内容为空或引用了范围外画格`);
    if (!Array.isArray(segment.panelIds) || !segment.panelIds.length || segment.panelIds.some(id => !panelIds.includes(id))) {
      errors.push(`第 ${index + 1} 段引用了未知画格或没有来源画格`);
    } else covered.push(...segment.panelIds);
  }
  if (elapsed !== 26) errors.push('segments 必须准确结束在 26 秒');
  // Allow consecutive segments to dwell on a panel, never skip or reorder one.
  const ordered = covered.filter((id, index) => !index || covered[index - 1] !== id);
  if (JSON.stringify(ordered) !== JSON.stringify(panelIds)) errors.push('segments 必须依原顺序覆盖全部 10 格，止于 G08；不能越界、漏格或重排');
  return errors;
}

export function contentStructurePatch(sheet) {
  return {
    action: sheet.action,
    segments: sheet.segments.map(segment => ({ label: `${segment.start}–${segment.end}s`, beat: segment.beat, framing: segment.framing, mustShow: [...segment.panelIds, ...(segment.mustShow || [])] })),
    negative: [...sheet.negative], continuity: [...sheet.continuity],
  };
}

export function retainReviewForContentChange(review, revision) {
  return {
    ...review,
    completePromptStatus: review.completePrompt ? 'stale' : review.completePromptStatus,
    completePromptSourceRevision: revision,
    completePromptConfirmedAt: undefined,
    promptReviewStatus: review.promptReviewReport ? 'stale' : 'empty',
    // Keep the report's original revision, request/run ids and timestamps.
    approved: false, approvedAt: undefined,
  };
}
