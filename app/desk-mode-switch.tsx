export type DeskMode = "creator" | "strict-review";

export function DeskModeSwitch({ mode, onChange }: { mode: DeskMode; onChange: (mode: DeskMode) => void }) {
  return (
    <div className="desk-mode-switch compact" role="tablist" aria-label="漫镜工作版本">
      <button type="button" role="tab" aria-selected={mode === "creator"} className={mode === "creator" ? "active" : undefined} onClick={mode === "creator" ? undefined : () => onChange("creator")}>
        <b>创作台</b><small>拆图 · 分析 · 重组 · 提示词</small>
      </button>
      <button type="button" role="tab" aria-selected={mode === "strict-review"} className={mode === "strict-review" ? "active" : undefined} onClick={mode === "strict-review" ? undefined : () => onChange("strict-review")}>
        <b>严格审核台</b><small>只审不改</small>
      </button>
    </div>
  );
}
