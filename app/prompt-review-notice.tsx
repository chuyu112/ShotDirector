type PromptReviewNoticeProps = {
  label: string;
  shotId: string;
  model: string;
  startedAtLabel: string;
  message?: string;
  hasPrevious?: boolean;
  completed?: boolean;
};

export function PromptReviewNotice({ label, shotId, model, startedAtLabel, message, hasPrevious, completed = false }: PromptReviewNoticeProps) {
  return (
    <div className={`prompt-review-status ${completed ? "completed" : "reviewing"}`} role="status" aria-live="polite" aria-atomic="true">
      <div className="prompt-review-heading">
        <i className={completed ? "prompt-review-complete-icon" : "prompt-review-spinner"} aria-hidden="true">{completed ? "✓" : null}</i>
        <div><b>{label}</b><p>SHOT {shotId} · {message || "审核报告完成后会自动显示，请稍候。"}</p></div>
      </div>
      <span>本次审核模型：{model}</span>
      <time>{startedAtLabel}</time>
      <small>{completed ? "完整报告已保存。请阅读下方问题与建议，返回创作台讨论修改，再由你确认。" : <>{hasPrevious ? "下方保留上一版审核报告，本次报告完成后会自动更新。" : "审核只输出问题与建议，不会改写提示词。"}你可以继续查看其他 Shot，无需重复提交。</>}</small>
    </div>
  );
}
