"use client";

import { useEffect, useRef, useState } from 'react';
import { modelTestStatusLabel } from './model-test-status.mjs';
import { MODEL_TEST_CASE_ID, MODEL_TEST_EXPECTED, MODEL_TEST_RULES } from './model-test-contract.mjs';

type TestRow = { id: string; label: string; model: string; provider: string; available: boolean; reason?: string; result?: { status: string; requestedModel: string; actualModel?: string; startedAt?: string; finishedAt?: string; durationMs?: number; error?: string } };
type TestState = { round?: { id: string; status: string }; models: TestRow[] };

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
    <p>接口正常　格式正常✅ · 接口正常　格式错误⚠️ · 接口错误　格式错误❌。接口正常只表示收到本次完整响应；格式错误不会禁用模型。接口报错时无法完成格式校验。结果不代表图片能力、长任务或 MAX 严格审核已通过。</p>
    {error && <p role="alert" className="model-test-error">{error}</p>}
    {readError && <p role="alert" className="model-test-error">{readError}</p>}
    <details><summary>测试题与回答要求（{MODEL_TEST_CASE_ID}）</summary><p>{MODEL_TEST_RULES}</p><pre>{MODEL_TEST_EXPECTED}</pre><p>仅判断本次响应；历史测试使用的规则可能不同，不会自动重发测试。</p></details>
    {state.models.length ? <div className="model-test-table" role="region" aria-label="模型测试结果，可横向滚动" tabIndex={0}>
      <table>
        <caption className="model-test-visually-hidden">各模型最近一次手动测试的接口、格式、耗时和响应模型。</caption>
        <thead><tr><th scope="col">模型</th><th scope="col">测试状态</th><th scope="col">请求 / 实际模型</th><th scope="col">耗时</th><th scope="col">测试时间</th><th scope="col">结果说明</th><th scope="col">操作</th></tr></thead>
        <tbody>{state.models.map(model => {
          const r = model.result;
          const statusLabel = modelTestStatusLabel(r, model.available);
          return <tr key={model.id}>
            <th scope="row">{model.label}<small>{model.provider}</small></th>
            <td><span className="model-test-status" data-label={statusLabel}>{statusLabel}</span></td>
            <td>{r?.requestedModel || model.model}<small>{r?.actualModel || '尚无实际响应模型'}</small></td>
            <td>{typeof r?.durationMs === 'number' ? `${(r.durationMs / 1000).toFixed(1)} 秒` : '—'}</td>
            <td>{r?.finishedAt || r?.startedAt ? new Date(r.finishedAt || r.startedAt!).toLocaleString('zh-CN') : '—'}</td>
            <td>{r?.error || (!model.available ? model.reason : '') || '—'}</td>
            <td><button type="button" className="button secondary" aria-label={`重测 ${model.label}`} disabled={submitting || running || !model.available} onClick={() => void start([model.id])}>重测</button></td>
          </tr>;
        })}</tbody>
      </table>
    </div> : <div className="model-test-empty" role="status">暂未读取到模型目录。目录读取后会显示在这里，不会自动发起测试。</div>}
  </section>;
}
