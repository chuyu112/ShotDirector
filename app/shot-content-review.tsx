'use client';

import { useEffect, useRef, useState } from 'react';
import { contentStructurePatch, validateContentWorksheet, type ContentReviewSession, type ContentWorksheet, type HumanPanelCheck } from './shot-content-review.mjs';

type Props = {
  session: ContentReviewSession;
  imageUrl: (path: string, hash: string) => string;
  request: (operation: string, body: unknown) => Promise<unknown>;
  onConfirmed: (result: unknown) => void;
  onClose: () => void;
};
const pretty = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value, null, 2) || '未记录';

export function ShotContentReview({ session, imageUrl, request, onConfirmed, onClose }: Props) {
  const [sheet, setSheet] = useState<ContentWorksheet>(() => structuredClone(session.worksheet));
  const [stage, setStage] = useState<'panels' | 'structure' | 'preview'>('panels');
  const [loaded, setLoaded] = useState<string[]>([]);
  const [proposalHash, setProposalHash] = useState('');
  const [acknowledge, setAcknowledge] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => { dialogRef.current?.scrollIntoView({ block: 'start' }); }, []);
  const mutate = (next: ContentWorksheet) => { setSheet(next); setProposalHash(''); setAcknowledge(false); setMessage(''); };
  const panelChange = (index: number, patch: Partial<HumanPanelCheck>) => mutate({ ...sheet, panels: sheet.panels.map((p, i) => i === index ? { ...p, ...patch, checked: false } : p) });
  const run = async (action: () => Promise<void>) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage('');
    try { await action(); } catch (error) { setMessage(error instanceof Error ? error.message : '操作失败'); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const save = async () => { await request('save', { id: session.id, worksheet: sheet }); setMessage('核对草稿已保存；项目正文尚未修改。'); };
  const changeStage = (next: typeof stage) => { setStage(next); dialogRef.current?.scrollIntoView({ block: 'start' }); };
  const preview = () => run(async () => {
    const errors = validateContentWorksheet(sheet, session.evidence.map(p => p.panelId));
    if (errors.length) throw new Error(errors.join('\n'));
    const result = await request('preview', { id: session.id, worksheet: sheet }) as { proposalHash: string };
    setProposalHash(result.proposalHash); setAcknowledge(false); changeStage('preview');
  });
  const structure = contentStructurePatch(sheet);
  return <main className="content-review-page" ref={dialogRef} aria-label="Shot 01 人工内容核对">
    <header className="content-review-header">
      <div><h1>Shot 01 · 原裁图人工核对</h1><p>26 秒 · 10 个画格 · 结束于 P02-R-G08。逐格裁定后，检查结构变更并确认同步。</p></div>
      <div className="content-review-actions">
        <button type="button" className="button secondary" disabled={busy} onClick={() => run(save)}>保存核对草稿</button>
        <button type="button" className="button secondary" disabled={busy} onClick={() => run(async () => { await save(); onClose(); })}>保存并返回</button>
      </div>
    </header>
    <p>以原始裁图为准。旧识别、审核意见与 Creator 回复均为待核对说法。没有预选答案；无法确认的事实可以暂存，不能进入同步。</p>
    <nav className="content-review-actions" aria-label="人工核对步骤">
      <button className="button secondary" aria-current={stage === 'panels' ? 'step' : undefined} onClick={() => changeStage('panels')}>1. 逐格核对（{sheet.panels.filter(p => p.checked).length}/10）</button>
      <button className="button secondary" aria-current={stage === 'structure' ? 'step' : undefined} onClick={() => changeStage('structure')}>2. 核对结构与时间线</button>
      <button className="button primary" disabled={busy} onClick={preview}>3. 检查变更预览</button>
    </nav>
    <details><summary>旧稿、审核和 Creator 回复（原样保留）</summary>
      <p>Reviewer：{session.before.reviewerModel || session.before.reviewerId || '未记录'} · 完成时间：{session.before.reviewedAt || '未记录'}</p>
      <p>审核版本：{session.before.reviewRevision || '未记录'} · 请求：{session.before.requestId || '未记录'} · Run：{session.before.runId || '未记录'}</p>
      <h3>当前完整提示词</h3><pre>{session.before.completePrompt || '未记录'}</pre>
      <h3>原审核报告</h3><pre>{pretty(session.before.report)}</pre>
      <h3>Creator 对话与历史稿</h3><pre>{pretty(session.before.chat)}</pre>
    </details>
    {busy && <p role="status" className="content-review-working">正在保存并检查核对版本…</p>}
    {message && <p role="status" className="content-review-message">{message}</p>}
    {stage === 'panels' && <fieldset disabled={busy}>
      {session.evidence.map((evidence, index) => {
        const panel = sheet.panels[index];
        const findings = (session.before.report as { findings?: Array<{ panelIds: string[]; title: string; detail: string }> } | undefined)?.findings?.filter(f => f.panelIds.includes(panel.panelId));
        return <article key={panel.panelId} className="content-review-panel">
          <div><h2>{index + 1}. {panel.panelId}</h2>
            <a href={imageUrl(evidence.imagePath, evidence.cropHash)} target="_blank" rel="noreferrer">打开原始尺寸裁图</a>
            {/* Existing pixels only; image endpoint refuses a changed hash. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl(evidence.imagePath, evidence.cropHash)} alt={`${panel.panelId} 原始裁图`} onLoad={() => setLoaded(ids => ids.includes(panel.panelId) ? ids : [...ids, panel.panelId])} onError={() => { setLoaded(ids => ids.filter(id => id !== panel.panelId)); panelChange(index, { checked: false }); setMessage(`${panel.panelId} 原始裁图未加载，请重新打开核对。`); }} />
            <details><summary>裁图校验与原始识别</summary><p>SHA-256：{evidence.cropHash}</p><pre>{pretty({ sourceObservation: evidence.sourceObservation, textSummary: evidence.textSummary, sourceText: evidence.sourceText })}</pre></details>
          </div>
          <div className="content-review-fields">
            {findings?.length ? <div><h3>涉及本格的审核说法</h3>{findings.map((f, i) => <p key={i}>{f.title}：{f.detail}</p>)}</div> : <p>当前报告未单列本格问题，仍需对照裁图核对。</p>}
            <label>核对结果<select value={panel.decision} onChange={e => panelChange(index, { decision: e.target.value })}><option value="">请选择</option><option value="confirmed">原识别与裁图一致</option><option value="corrected">人工纠正了原识别</option><option value="uncertain">尚有事实冲突，保留待核对</option></select></label>
            <label>人工确认的可见事实<textarea rows={4} value={panel.observation} onChange={e => panelChange(index, { observation: e.target.value })} placeholder="只写裁图中可见的人物、动作、关系与构图；不推测画外事实" /></label>
            <label>原文情况<select value={panel.textStatus} onChange={e => panelChange(index, { textStatus: e.target.value, sourceText: [] })}><option value="">请选择</option><option value="transcribed">已逐字核对可见原文</option><option value="none">图中无文字</option><option value="unreadable">文字无法辨读，保持未知</option></select></label>
            {panel.textStatus === 'transcribed' && <div>{panel.sourceText.map((line, lineIndex) => <div key={lineIndex} className="content-review-line">
              <label>说话人（不明可留空）<input value={line.speaker} onChange={e => panelChange(index, { sourceText: panel.sourceText.map((v, i) => i === lineIndex ? { ...v, speaker: e.target.value } : v) })} /></label>
              <label>可见原文<input value={line.text} onChange={e => panelChange(index, { sourceText: panel.sourceText.map((v, i) => i === lineIndex ? { ...v, text: e.target.value } : v) })} /></label>
              <button className="button secondary" onClick={() => panelChange(index, { sourceText: panel.sourceText.filter((_, i) => i !== lineIndex) })}>删除此句</button>
            </div>)}<button className="button secondary" onClick={() => panelChange(index, { sourceText: [...panel.sourceText, { speaker: '', text: '' }] })}>添加原文</button></div>}
            <label>纠正依据 / 未知范围<textarea rows={2} value={panel.note} onChange={e => panelChange(index, { note: e.target.value })} /></label>
            <label className="content-review-check"><input type="checkbox" checked={panel.checked} disabled={!loaded.includes(panel.panelId)} onChange={e => mutate({ ...sheet, panels: sheet.panels.map((p, i) => i === index ? { ...p, checked: e.target.checked } : p) })} />我已对照本格原裁图核对以上内容</label>
          </div>
        </article>;
      })}
    </fieldset>}
    {stage === 'structure' && <fieldset className="content-review-fields" disabled={busy}>
      <p>下方文字沿用当前稿，需由核对人手动修正旧的 8 秒和旧画格边界。按内容安排节拍，不按画格数平均分秒。</p>
      <details><summary>已保存的全局时间码（只读核对依据）</summary>
        <table><thead><tr><th>Shot</th><th>时间码</th><th>时长</th><th>画格数</th></tr></thead><tbody>{session.timelineReference?.map(item => <tr key={item.shotId}><td>{item.shotId}</td><td>{item.timecode}</td><td>{item.duration} 秒</td><td>{item.panelCount}</td></tr>)}</tbody></table>
      </details>
      <label>动作与时长结构说明（action）<textarea rows={5} value={sheet.action} onChange={e => mutate({ ...sheet, action: e.target.value })} /></label>
      <h2>Segments · 0–26 秒</h2>
      {sheet.segments.map((segment, index) => <section className="content-review-segment" key={index}><h3>第 {index + 1} 段</h3>
        {(['start', 'end'] as const).map(field => <label key={field}>{field === 'start' ? '开始秒数' : '结束秒数'}<input type="number" min="0" max="26" step="0.1" value={segment[field] ?? ''} onChange={e => mutate({ ...sheet, segments: sheet.segments.map((s, i) => i === index ? { ...s, [field]: e.target.value === '' ? null : Number(e.target.value) } : s) })} /></label>)}
        {(['beat', 'framing'] as const).map(field => <label key={field}>{field === 'beat' ? '动作节拍' : '构图'}<textarea rows={2} value={segment[field]} onChange={e => mutate({ ...sheet, segments: sheet.segments.map((s, i) => i === index ? { ...s, [field]: e.target.value } : s) })} /></label>)}
        <label>来源画格（按原顺序，一行一个完整 ID）<textarea rows={3} value={segment.panelIds.join('\n')} onChange={e => mutate({ ...sheet, segments: sheet.segments.map((s, i) => i === index ? { ...s, panelIds: e.target.value.split('\n') } : s) })} /></label>
        <label>必须呈现的内容（一行一项，保留原有事实约束）<textarea rows={3} value={(segment.mustShow || []).join('\n')} onChange={e => mutate({ ...sheet, segments: sheet.segments.map((s, i) => i === index ? { ...s, mustShow: e.target.value ? e.target.value.split('\n') : [] } : s) })} /></label>
        <button className="button secondary" onClick={() => mutate({ ...sheet, segments: sheet.segments.filter((_, i) => i !== index) })}>删除本段</button>
      </section>)}
      <button className="button secondary" onClick={() => mutate({ ...sheet, segments: [...sheet.segments, { start: null, end: null, beat: '', framing: '', panelIds: [] }] })}>添加一段</button>
      {(['negative', 'continuity', 'timeline'] as const).map(field => <label key={field}>{({ negative: '禁止项（negative）', continuity: '连续性（continuity）', timeline: '全局时间线（仅修正本次关联条目，其余原样保留）' })[field]}<textarea rows={6} value={sheet[field].join('\n')} onChange={e => mutate({ ...sheet, [field]: e.target.value.split('\n') })} /></label>)}
      <label>核对人<input value={sheet.confirmedBy} onChange={e => mutate({ ...sheet, confirmedBy: e.target.value })} /></label>
      <button className="button primary" onClick={preview}>检查变更预览</button>
    </fieldset>}
    {stage === 'preview' && <section>
      <h2>确认前检查</h2><p>仅同步 action、segments、negative、continuity 和全局时间线。26 秒、10 个来源画格及原顺序保持锁定。人工核对事实单独保存，原识别保留溯源。</p>
      {Object.entries({ ...structure, timeline: sheet.timeline }).map(([field, after]) => <section key={field}><h3>{field}</h3><div className="content-review-diff"><div><strong>同步前</strong><pre>{pretty(field === 'timeline' ? session.before.timeline : session.before.shot[field as keyof typeof structure])}</pre></div><div><strong>确认后</strong><pre>{pretty(after)}</pre></div></div></section>)}
      <h3>逐格人工结论</h3>{sheet.panels.map(panel => <p key={panel.panelId}><strong>{panel.panelId}</strong> · {panel.observation} · 原文状态：{{ transcribed: '已逐字核对', none: '无文字', unreadable: '无法辨读' }[panel.textStatus]} {panel.sourceText.map(line => `${line.speaker || '说话人未确认'}：${line.text}`).join('；')} {panel.note}</p>)}
      <p>保留完整提示词、旧稿、审核报告及请求溯源。同步后撤销旧批准并标记需重新严格审核；全局时间线有改动时，其他 Shot 的审核也需重新核对。</p>
      <label className="content-review-check"><input type="checkbox" checked={acknowledge} onChange={e => setAcknowledge(e.target.checked)} />我确认以上人工结论与变更，接受同步后必须重新严格审核</label>
      <button className="button primary" disabled={busy || !acknowledge || !proposalHash} onClick={() => run(async () => onConfirmed(await request('confirm', { id: session.id, proposalHash, acknowledge: true })))}>确认并同步结构</button>
    </section>}
    <p>记录 {session.id} · 创建于 {session.createdAt} · 同步不会调用任何生成或审核模型。</p>
  </main>;
}
