type PromptGenerationNoticeProps = {
  label: string;
  shotId: string;
  model: string;
  startedAtLabel: string;
  message?: string;
  hasPrevious: boolean;
};

export function PromptGenerationNotice({ label, shotId, model, startedAtLabel, message, hasPrevious }: PromptGenerationNoticeProps) {
  return (
    <div className="complete-shot-generation-status" role="status" aria-live="polite" aria-atomic="true">
      <div className="prompt-generation-heading">
        <i className="prompt-generation-spinner" aria-hidden="true" />
        <div><b>{label}</b><p>SHOT {shotId} · {message || "请稍候，完成后会自动显示。"}</p></div>
      </div>
      <span>本次模型：{model}</span>
      <time>{startedAtLabel}</time>
      <small>{hasPrevious ? "下方保留上一版提示词，新版本完成后会自动更新。" : "提示词正在处理中，无需重复点击。"}你可以继续查看其他 Shot。</small>
    </div>
  );
}
