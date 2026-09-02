// Reviewer selection is local to a Shot. It is NOT a writing-model switch.
// The legacy withJob slot is exclusive, but per-Shot Creator jobs are not.
export function promptReviewControls({ review, reviewer, bridge, hasSource }) {
  const reviewing = review.promptReviewStatus === "reviewing"
    || (bridge.activeJob?.type === "prompt-review"
      && bridge.activeJob.status === "running"
      && bridge.activeJob.shotId === review.shot.id);
  let reason = "";
  let action = "";
  if (reviewing) reason = "当前 Shot 正在严格审核，请等待本次报告。";
  else if (!bridge.connected || !bridge.pairingToken) reason = "审核服务未连接，正在尝试重连。";
  else if (bridge.draining) reason = "服务正在维护，请稍后再提交；现有任务和内容保留。";
  else if (review.completePromptStatus === "generating") reason = "当前 Shot 的提示词正在生成，完成后即可审核；其他 Shot 的生成不会阻塞这里。";
  else if (!review.completePrompt?.trim()) {
    reason = "当前 Shot 尚无完整提示词，请先到创作台生成讨论稿。";
    action = "creator";
  } else if (review.completePromptStatus !== "ready" || !review.completePromptSourceRevision) {
    reason = "当前提示词尚未就绪或已过期，请到创作台处理。旧稿保留，不会自动改写。";
    action = "creator";
  } else if (!hasSource) reason = "当前 Shot 缺少关联漫画画格，无法核对原作证据。";
  else if (!reviewer?.available) reason = reviewer?.reason || "正在加载审核模型；暂不可提交。";
  else if (bridge.activeJob?.status === "running") reason = "另一个审核或批注任务正在使用审核通道，完成后可提交。";
  return { selectingDisabled: reviewing, submitDisabled: Boolean(reason), reason, action };
}

export function promptReviewShotLabel(review) {
  if (review.promptReviewStatus === "reviewing") return "审核中";
  if (review.completePromptStatus === "generating") return "提示词生成中";
  if (review.completePromptStatus === "stale") return "提示词需更新";
  if (!review.completePrompt?.trim()) return "等待 Creator 提示词";
  if (review.completePromptStatus !== "ready" || !review.completePromptSourceRevision) return "提示词需处理";
  if (review.promptReviewStatus === "ready") return "已有审核";
  return "待审核";
}
