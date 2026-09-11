import type { ReactNode } from "react";

export function WorkStatusNotice({ label, message, model, timeLabel, children }: {
  label: string; message?: string; model?: string; timeLabel?: string; children?: ReactNode;
}) {
  return <div className="work-status-notice" role="status" aria-live="polite" aria-atomic="true">
    <div className="work-status-heading"><i className="work-status-spinner" aria-hidden="true" /><div><b>{label}</b>{message ? <p>{message}</p> : null}</div></div>
    {model ? <span>本次模型：{model}</span> : null}
    {timeLabel ? <time>{timeLabel}</time> : null}
    {children ? <small>{children}</small> : null}
  </div>;
}
