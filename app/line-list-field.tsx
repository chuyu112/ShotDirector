"use client";

import { useState, type TextareaHTMLAttributes } from "react";
import { editLineListDraft, reconcileLineListDraft } from "./line-list-draft.mjs";

type ListProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "defaultValue" | "onChange"> & {
  value: string[];
  onChange: (items: string[]) => void;
  scopeKey: string;
};

function ListEditor({ value, onChange, onBlur, ...props }: Omit<ListProps, "scopeKey">) {
  const [draft, setDraft] = useState(() => reconcileLineListDraft(null, value));
  const current = reconcileLineListDraft(draft, value);
  // A real external update replaces the draft; our own normalized echo does not.
  if (current !== draft) setDraft(current);
  return <textarea {...props} value={current.text} onChange={event => {
    const next = editLineListDraft(event.target.value);
    setDraft(next);
    // Blank lines/spaces alone must not invalidate an approved prompt or assets.
    if (next.source !== value.join("\n")) onChange(next.items);
  }} onBlur={event => {
    setDraft(reconcileLineListDraft(null, value));
    onBlur?.(event);
  }} />;
}

export function LineListTextarea({ scopeKey, ...props }: ListProps) {
  // Do not carry unfinished editing text between projects, Shots or global files.
  return <ListEditor key={scopeKey} {...props} />;
}

export function LineListField({ label, rows = 4, ...props }: ListProps & { label: string }) {
  return <label className="sheet-field"><span>{label}</span><LineListTextarea {...props} rows={rows} /></label>;
}
