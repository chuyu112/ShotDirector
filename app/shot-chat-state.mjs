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

export function shotChatWorkLabel(chat, { status, connected = true, approved = false } = {}) {
  if (!connected || chat?.pending?.recovering) return '正在恢复主力 Agent 任务';
  if ((status || chat?.pending?.status) === 'queued') return '主力 Agent 排队中';
  if (approved) return '主力 Agent 正在讨论';
  const message = chat?.messages?.find(item => item.id === chat.pending?.turnId && item.role === 'user')?.text || '';
  if (/只讨论|仅讨论|不要改|不改稿|先别改/.test(message)) return '主力 Agent 正在讨论';
  if (/审核|采纳/.test(message)) return /采纳|修改|改稿|调整|重写|重出|处理/.test(message)
    ? '主力 Agent 正在核对并选择采纳建议' : '主力 Agent 正在核对审核意见';
  return '主力 Agent 正在处理消息与改稿要求';
}

// An HTTP timeout or conflict does not prove the durable model turn failed.
export function shotChatSubmissionDecision(httpStatus, result) {
  if (httpStatus >= 200 && httpStatus < 300 && result?.status === 'completed') return 'completed';
  if (result?.status === 'failed' || [400, 401, 403, 404, 413, 422, 429].includes(httpStatus)) return 'failed';
  return 'recover';
}
