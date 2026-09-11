"use client";

import { useEffect, useRef, useState } from "react";
import { WorkStatusNotice } from "./work-status-notice";
import { ShotChatRecoveryPoller, type ShotChatRecoveryTarget, type ShotChatRecover } from './shot-chat-recovery.mjs';

export type ShotChatPending = { turnId: string; sourceRevision: string; basePrompt: string; startedAt: string; writingModelId?: string; stage?: string; status?: "queued" | "running"; recovering?: boolean };
export type ShotChatMessage = { id: string; role: "user" | "assistant"; text: string; at: string };
export type ShotChatState = { draft?: string; messages?: ShotChatMessage[]; pending?: ShotChatPending; error?: string; previousPrompt?: string; candidate?: string };
export type ShotChatResult = { status: string; chatTurnId: string; projectUid: string; shotUid: string; sourceRevision: string; action: "reply" | "revise"; reply: string; prompt: string; generatedAt: string; generatorId: string; generatorProvider: string; stage?: string; message?: string; error?: string };

export function useShotChatRecovery(targets: ShotChatRecoveryTarget[], onRecover: ShotChatRecover) {
  const [poller] = useState(() => new ShotChatRecoveryPoller());
  useEffect(() => { poller.update(targets, onRecover); }, [poller, targets, onRecover]);
  useEffect(() => () => poller.dispose(), [poller]);
}

export function ShotChat({ shotId, model, chat, activity, disabledReason, approved, onDraft, onSend, onCopy }: {
  shotId: string; model: string; chat: ShotChatState; disabledReason?: string; approved: boolean;
  activity?: { label: string; message?: string; timeLabel: string };
  onDraft: (value: string) => void; onSend: () => Promise<void>;
  onCopy: (text: string) => void;
}) {
  const submitting = useRef(false);
  const [sending, setSending] = useState(false);
  const [localError, setLocalError] = useState("");
  const pending = chat.pending;
  const send = async () => {
    if (submitting.current || pending || activity || disabledReason || !chat.draft?.trim()) return;
    submitting.current = true; setSending(true); setLocalError("");
    try { await onSend(); } catch (error) { setLocalError(error instanceof Error ? error.message : "发送失败"); }
    finally { submitting.current = false; setSending(false); }
  };
  return <section id="shot-chat" className="shot-chat" aria-label={`Shot ${shotId} Chat`}>
    <header><div><span>SHOT CHAT · 主力 AGENT</span><h2>Shot {shotId} 对话与改稿</h2></div><small>{model}</small></header>
    <p>粘贴严格审核的建议，或直接提出修改要求。主力 Agent 修改本镜提示词讨论稿；审核只给建议，不改稿。</p>
    {activity ? <WorkStatusNotice label={activity.label} message={`SHOT ${shotId} · ${activity.message || "正在核对原作画格、当前提示词和你的消息，完成后会显示回复。"}`} model={model} timeLabel={activity.timeLabel}>原提示词保留。你可以查看其他 Shot，无需重复发送；改稿完成后需要重新严格审核。</WorkStatusNotice> : null}
    {approved ? <p className="shot-chat-notice">当前 Shot 已批准，只能讨论。请先解除批准，再要求修改。</p> : null}
    <div className="shot-chat-messages" role="log" aria-label={`Shot ${shotId} 聊天记录`} aria-live="polite">
      {(chat.messages || []).map(message => <article key={message.id} className={message.role}><b>{message.role === "user" ? "你" : "主力 Agent"}</b><time>{new Date(message.at).toLocaleTimeString("zh-CN", { hour12: false })}</time><p>{message.text}</p></article>)}
      {!chat.messages?.length ? <p className="shot-chat-empty">聊天记录随当前项目保存，其他 Shot 不会混入这里。</p> : null}
    </div>
    {chat.candidate ? <details><summary>有一份未覆盖当前正文的候选稿</summary><pre>{chat.candidate}</pre><button type="button" className="text-button" onClick={() => onCopy(chat.candidate!)}>复制候选稿</button></details> : null}
    {chat.previousPrompt ? <details><summary>上次修改前的提示词</summary><pre>{chat.previousPrompt}</pre><button type="button" className="text-button" onClick={() => onCopy(chat.previousPrompt!)}>复制旧稿</button></details> : null}
    <label><span>给主力 Agent 的消息</span><textarea aria-label={`Shot ${shotId} Chat 消息`} rows={5} maxLength={16000} value={chat.draft || ""} onChange={event => onDraft(event.target.value)} placeholder="例如：请按下面的审核建议修改当前提示词，保留没有问题的部分……" onKeyDown={event => { if (!event.nativeEvent.isComposing && event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void send(); } }} /></label>
    <footer><small data-working={Boolean(activity)}>{activity?.label || disabledReason || "Enter 换行 · ⌘/Ctrl+Enter 发送"}</small><button type="button" className="button primary" data-working={Boolean(activity) || sending} disabled={sending || Boolean(pending) || Boolean(activity) || Boolean(disabledReason) || !chat.draft?.trim()} onClick={() => void send()}>{activity ? "主力 Agent 工作中…" : sending ? "正在发送…" : "发送"}</button></footer>
    {chat.error || localError ? <p className="inline-error" role="alert">{chat.error || localError}</p> : null}
  </section>;
}
