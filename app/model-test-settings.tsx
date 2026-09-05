"use client";

import { useEffect, useRef, useState } from 'react';

type TestRow = { id: string; label: string; model: string; provider: string; available: boolean; reason?: string; result?: { status: string; requestedModel: string; actualModel?: string; startedAt?: string; finishedAt?: string; durationMs?: number; error?: string } };
type TestState = { round?: { id: string; status: string }; models: TestRow[] };
const labels: Record<string, string> = { queued: '排队中', running: '测试中', succeeded: '通过', failed: '失败', skipped: '跳过', interrupted: '已中断' };

export function ModelTestSettings({ base, request, pairingToken }: { base: string; request: (url: string, init?: RequestInit) => Promise<Response>; pairingToken?: string }) {
  const [state, setState] = useState<TestState>({ models: [] });
  const [error, setError] = useState('');
  const [readError, setReadError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const sending = useRef(false);
  const revision = useRef(0);
  const running = state.round?.status === 'running';
  useEffect(() => {
    let disposed = false; let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const poll = async () => {
      const version = revision.current;
      try {
        const response = await request(`${base}/model-tests`, { headers: { 'X-Manjing-Token': pairingToken || '' }, cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || '无法读取模型测试状态');
        if (!disposed && !sending.current && version === revision.current) { setState(result); setReadError(''); }
      } catch (e) { if (!disposed) setReadError(e instanceof Error ? e.message : '状态读取失败'); }
      if (!disposed) timer = setTimeout(poll, 2500);
    };
    void poll();
    return () => { disposed = true; controller.abort(); clearTimeout(timer); };
  }, [base, pairingToken, request]);
  async function start(ids: string[]) {
    if (sending.current || running || !ids.length) return;
    sending.current = true; revision.current++; setSubmitting(true); setError('');
    try {
      const response = await request(`${base}/model-tests`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Manjing-Token': pairingToken || '' }, body: JSON.stringify({ ids, requestId: crypto.randomUUID() }), signal: AbortSignal.timeout(15000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '测试提交失败');
      setState(result);
    } catch (e) { setError(`${e instanceof Error ? e.message : '提交失败'}；请先查看测试状态，不会自动重试。`); }
    finally { revision.current++; sending.current = false; setSubmitting(false); }
  }
  return <section className="model-test-settings" aria-label="LLM 模型测试">
    <header><div><span>API DIAGNOSTICS</span><h2>LLM 模型测试</h2></div><button type="button" className="button primary" disabled={submitting || running || !state.models.some(m => m.available)} onClick={() => void start(state.models.filter(m => m.available).map(m => m.id))}>{running ? '本轮测试中…' : submitting ? '提交中…' : '测试全部模型'}</button></header>
    <p>手动发起真实 API 小请求，会产生少量 Token 用量。LOW 推理 · 每模型一次 · 最多两个并发 · 单模型最长 90 秒。不修改项目、Shot 或当前模型选择，不自动重试。</p>
    <p>通过仅表示本次文字连通性与格式校验正常，不代表图片能力、长任务或 MAX 严格审核已通过。</p>
    {error && <p role="alert" className="model-test-error">{error}</p>}
    {readError && <p role="alert" className="model-test-error">{readError}</p>}
    <div className="model-test-table"><table><thead><tr><th>模型</th><th>测试状态</th><th>请求 / 实际模型</th><th>耗时</th><th>测试时间</th><th>失败原因</th><th>操作</th></tr></thead><tbody>{state.models.map(model => { const r = model.result; return <tr key={model.id}><td>{model.label}<small>{model.provider}</small></td><td>{r ? labels[r.status] || r.status : model.available ? '未测试' : '未配置'}</td><td>{r?.requestedModel || model.model}<small>{r?.actualModel || '尚无实际响应模型'}</small></td><td>{typeof r?.durationMs === 'number' ? `${(r.durationMs / 1000).toFixed(1)} 秒` : '—'}</td><td>{r?.finishedAt || r?.startedAt ? new Date(r.finishedAt || r.startedAt!).toLocaleString('zh-CN') : '—'}</td><td>{r?.error || (!model.available ? model.reason : '') || '—'}</td><td><button type="button" className="button secondary" disabled={submitting || running || !model.available} onClick={() => void start([model.id])}>重测</button></td></tr>; })}</tbody></table></div>
  </section>;
}
