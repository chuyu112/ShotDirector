import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function modelTestIds(payload) {
  const ids = payload?.ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > 16 || ids.some(id => typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(id)) || new Set(ids).size !== ids.length) {
    throw Object.assign(new Error('请选择 1–16 个不重复的模型'), { statusCode: 400 });
  }
  if (typeof payload.requestId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(payload.requestId)) throw Object.assign(new Error('缺少有效测试请求编号'), { statusCode: 400 });
  return ids;
}

export function modelTestFailureMessage(error) {
  const status = error?.diagnostics?.httpStatus || error?.statusCode;
  if (status === 401 || status === 403) return 'API 认证或访问权限失败';
  if (status === 429) return '上游限流或额度不足';
  if (status === 504) return '上游网关超时';
  if (error?.code === 'output_limit') return '小额测试输出预算用尽，尚未验证成功';
  if (error?.code === 'invalid_probe') return '返回内容未通过测试格式校验';
  if (error?.code === 'incomplete_stream') return '上游响应流中断，未收到完整结果';
  if (error?.code === 'probe_timeout' || /timeout|abort|超时/i.test(String(error?.name) + String(error?.message))) return '测试超时（90 秒），未自动重试';
  return status ? `API 请求失败（HTTP ${Number(status) || 502}）` : 'API 请求失败或连接中断，未自动重试';
}

export class ModelTests {
  constructor({ filename, catalog, invoke, timeoutMs = 90_000 }) {
    this.filename = filename; this.catalog = catalog; this.invoke = invoke; this.timeoutMs = timeoutMs;
    this.state = { round: null, results: {}, seenIds: [] };
    if (filename && existsSync(filename)) {
      try {
        const saved = JSON.parse(readFileSync(filename, 'utf8'));
        if (saved && typeof saved.results === 'object' && saved.results && Array.isArray(saved.seenIds)) this.state = saved;
      } catch { /* Start with no cached tests. */ }
    }
    if (this.state.round?.status === 'running') {
      this.state.round.status = 'interrupted';
      for (const result of Object.values(this.state.results)) if (['running', 'queued'].includes(result.status)) Object.assign(result, { status: 'interrupted', error: '服务已重启，测试结果未知；不会自动重试', finishedAt: new Date().toISOString() });
      this.save();
    }
  }
  get active() { return this.state.round?.status === 'running'; }
  save() {
    if (!this.filename) return;
    mkdirSync(dirname(this.filename), { recursive: true });
    const temp = `${this.filename}.tmp`;
    writeFileSync(temp, JSON.stringify(this.state), { mode: 0o600 });
    renameSync(temp, this.filename);
  }
  snapshot() {
    return { round: this.state.round, models: this.catalog().map(m => ({ id: m.id, label: m.label, provider: m.provider, model: m.model, available: m.available, reason: m.available ? undefined : '当前模型未配置或不可用', result: this.state.results[m.id] || null })) };
  }
  start(payload) {
    const ids = modelTestIds(payload);
    if (this.state.round?.id === payload.requestId) return this.snapshot();
    if (this.active || this.state.seenIds.includes(payload.requestId)) throw Object.assign(new Error('测试已经提交，请查看现有结果，不要重复提交'), { statusCode: 409 });
    if (this.state.round && Date.now() - Date.parse(this.state.round.startedAt) < 30_000) throw Object.assign(new Error('两轮测试至少间隔 30 秒'), { statusCode: 429 });
    const catalog = new Map(this.catalog().map(m => [m.id, m]));
    if (ids.some(id => !catalog.has(id))) throw Object.assign(new Error('模型不在当前目录中'), { statusCode: 400 });
    const startedAt = new Date().toISOString();
    this.state.round = { id: payload.requestId, status: 'running', ids, startedAt };
    this.state.seenIds = [...this.state.seenIds, payload.requestId].slice(-100);
    for (const id of ids) this.state.results[id] = { status: 'queued', requestedModel: catalog.get(id).model, provider: catalog.get(id).provider, startedAt: null, finishedAt: null, durationMs: null };
    this.save();
    this.pending = this.run(ids, catalog).catch(() => {
      this.state.round.status = 'interrupted';
      for (const result of Object.values(this.state.results)) if (['running', 'queued'].includes(result.status)) Object.assign(result, { status: 'interrupted', error: '测试执行中断，未自动重试' });
      try { this.save(); } catch { /* Never create an unhandled rejection. */ }
    });
    return this.snapshot();
  }
  async run(ids, catalog) {
    let cursor = 0;
    const worker = async () => {
      while (cursor < ids.length) {
        const id = ids[cursor++]; const model = catalog.get(id); const row = this.state.results[id];
        const start = Date.now(); row.startedAt = new Date(start).toISOString();
        if (!model.available) { Object.assign(row, { status: 'skipped', error: '当前模型未配置或不可用', finishedAt: row.startedAt, durationMs: 0 }); this.save(); continue; }
        row.status = 'running'; this.save();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(Object.assign(new Error('测试超时'), { code: 'probe_timeout' })), this.timeoutMs);
        try {
          // invoke must propagate this signal through the provider; no retry/fallback.
          const result = await this.invoke(model, { signal: controller.signal, requestId: randomUUID(), timeoutMs: this.timeoutMs });
          if (controller.signal.aborted) throw controller.signal.reason;
          const actualModel = typeof result.model === 'string' && /^[\w./:@-]{1,160}$/.test(result.model) ? result.model : '';
          Object.assign(row, { status: 'succeeded', actualModel: actualModel || null, responseId: typeof result.responseId === 'string' && /^[\w-]{1,160}$/.test(result.responseId) ? result.responseId : null });
        } catch (error) { Object.assign(row, { status: 'failed', error: error?.safeProbeMessage || modelTestFailureMessage(controller.signal.aborted ? controller.signal.reason : error) }); }
        finally { clearTimeout(timer); row.finishedAt = new Date().toISOString(); row.durationMs = Date.now() - start; this.save(); }
      }
    };
    await Promise.all([worker(), worker()]);
    this.state.round.status = 'completed'; this.state.round.finishedAt = new Date().toISOString(); this.save();
  }
}
