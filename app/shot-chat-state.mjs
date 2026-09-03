export function chatReplyCanApply({ projectUid, shotUid, currentPrompt, currentSourceRevision, approved, pending, result }) {
  return Boolean(pending && result?.action === 'revise' && !approved
    && result.projectUid === projectUid && result.shotUid === shotUid
    && result.chatTurnId === pending.turnId && result.sourceRevision === pending.sourceRevision
    && currentSourceRevision === pending.sourceRevision && currentPrompt === pending.basePrompt);
}

// Pure copy formatting: no change to either the Creator draft or review report.
export function reviewSuggestionsText(shotId, report, sourceRevision = '') {
  if (!report) return '';
  return [`请核对以下 Shot ${shotId} 的严格审核建议，按原作证据修改当前提示词讨论稿；有不合理的建议请说明，不要盲改。`, `审核版本：${sourceRevision}`, report.summary || '', ...(report.findings || []).map((finding, index) => `${index + 1}. [${finding.severity}] ${finding.title}\n问题与证据：${finding.detail}\n涉及画格：${(finding.panelIds || []).join('、')}\n建议：${finding.suggestion}`)].join('\n\n');
}
