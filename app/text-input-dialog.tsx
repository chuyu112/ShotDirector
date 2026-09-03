"use client";

import { FormEvent, useId } from "react";

type TextInputDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  label: string;
  value: string;
  placeholder?: string;
  confirmLabel?: string;
  busyLabel?: string;
  busy?: boolean;
  error?: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
};

export function TextInputDialog({
  open,
  title,
  description,
  label,
  value,
  placeholder,
  confirmLabel = "确认",
  busyLabel = "处理中…",
  busy = false,
  error = "",
  onChange,
  onCancel,
  onConfirm,
}: TextInputDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const inputId = useId();

  if (!open) return null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!busy && value.trim()) onConfirm();
  }

  return (
    <div
      className="text-input-dialog-backdrop"
      onMouseDown={(event) => {
        if (!busy && event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        className="text-input-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) onCancel();
        }}
      >
        <form onSubmit={submit}>
          <header>
            <span>MANJING</span>
            <h2 id={titleId}>{title}</h2>
            {description ? <p id={descriptionId}>{description}</p> : null}
          </header>
          <label htmlFor={inputId}>{label}</label>
          <input
            id={inputId}
            autoFocus
            type="text"
            value={value}
            placeholder={placeholder}
            disabled={busy}
            onChange={(event) => onChange(event.target.value)}
          />
          {error ? <p className="text-input-dialog-error" role="alert">{error}</p> : null}
          <footer>
            <button type="button" className="button secondary" disabled={busy} onClick={onCancel}>取消</button>
            <button type="submit" className="button primary" disabled={busy || !value.trim()}>
              {busy ? busyLabel : confirmLabel}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
