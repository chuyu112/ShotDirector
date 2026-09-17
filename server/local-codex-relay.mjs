import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL_CODEX_MODEL, LOCAL_CODEX_MAX_BYTES, isSupportedLocalCodexModel, localCodexCredentialMatches, localCodexError, localCodexWorkerToken, normalizeLocalCodexTask } from './local-codex-contract.mjs';

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

async function body(req) {
  let size = 0;
  const parts = [];
  for await (const part of req) {
    size += part.length;
    if (size > LOCAL_CODEX_MAX_BYTES) throw localCodexError('本地 Codex 请求过大', 413);
    parts.push(part);
  }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8') || '{}'); }
  catch { throw localCodexError('本地 Codex 请求格式无效'); }
}

export class LocalCodexRelay {
  constructor({ root, ownerId, token, now = Date.now, offlineAfterMs = 20_000 }) {
    this.root = root;
    this.ownerId = ownerId;
    this.token = token;
    this.now = now;
    this.offlineAfterMs = offlineAfterMs;
    this.lastSeen = 0;
    this.device = { ready: false, models: [], reason: '等待这台 Mac 的本地 Codex 连接' };
    this.jobs = new Map();
    mkdirSync(root, { recursive: true, mode: 0o700 });
    for (const file of readdirSync(root).filter(name => /^[a-f0-9-]{36}\.json$/i.test(name))) {
      try {
        const record = JSON.parse(readFileSync(join(root, file), 'utf8'));
        if (record.task?.id && record.task.userId === ownerId) this.jobs.set(record.task.id, record);
      } catch { /* An unreadable ledger cannot authorize another execution. */ }
    }
  }

  status() {
    const online = this.lastSeen > 0 && this.now() - this.lastSeen < this.offlineAfterMs;
    return { online, ready: online && this.device.ready === true, model: this.device.models?.[0] || LOCAL_CODEX_MODEL, models: this.device.models || [],
      reason: !online ? '这台 Mac 的本地 Codex 离线，请启动本地连接服务' : this.device.ready ? undefined : this.device.reason,
      lastSeenAt: this.lastSeen ? new Date(this.lastSeen).toISOString() : null,
      running: [...this.jobs.values()].filter(job => job.status === 'running').length };
  }

  save(record) {
    const filename = join(this.root, `${record.task.id}.json`);
    const temp = `${filename}.${randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify(record), { mode: 0o600 });
    renameSync(temp, filename);
    this.jobs.set(record.task.id, record);
  }

  expire() {
    for (const [id, record] of this.jobs) {
      if (['queued', 'running'].includes(record.status) && record.deadline <= this.now()) {
        this.save({ ...record, status: 'failed', error: '本地 Codex 任务超时；未自动重提，请检查原任务', finishedAt: this.now() });
      }
      if (record.finishedAt && this.now() - record.finishedAt > 24 * 60 * 60 * 1000) {
        this.jobs.delete(id);
        try { unlinkSync(join(this.root, `${id}.json`)); } catch { /* Best effort retention cleanup. */ }
      }
    }
  }

  async handle(req, res, path) {
    if (!path.startsWith('/local-codex/')) return false;
    try {
      if (req.headers.origin) throw localCodexError('本地 Codex 连接仅供受认证的服务使用', 403);
      this.expire();
      const runner = path.startsWith('/local-codex/runner/');
      const userId = String(req.headers['x-manjing-user'] || '');
      const projectId = String(req.headers['x-manjing-project'] || '');
      const bearer = String(req.headers.authorization || '').replace(/^Bearer /, '');
      const expected = runner ? this.token : userId === this.ownerId ? localCodexWorkerToken(this.token, userId, projectId) : '';
      if (!localCodexCredentialMatches(bearer, expected)) throw localCodexError('本地 Codex 连接身份无效', 401);
      if (runner && req.method === 'POST' && path === '/local-codex/runner/poll') {
        const input = await body(req);
        this.lastSeen = this.now();
        const models = Array.isArray(input.models)
          ? input.models.filter(isSupportedLocalCodexModel)
          : [input.model].filter(isSupportedLocalCodexModel);
        this.device = { ready: input.ready === true && models.length > 0, models,
          reason: input.ready ? undefined : '本地 Codex 登录、模型或额度尚未就绪，请在 Mac 检查连接服务' };
        const record = input.claim === true && this.device.ready
          ? [...this.jobs.values()].find(job => job.status === 'queued') : null;
        if (record) this.save({ ...record, status: 'running', startedAt: this.now() });
        json(res, 200, { status: this.status(), task: record?.task || null });
      } else if (runner && req.method === 'POST' && path === '/local-codex/runner/result') {
        const input = await body(req);
        const record = this.jobs.get(input.id);
        if (!record || record.task.userId !== this.ownerId) throw localCodexError('本地 Codex 任务不存在', 404);
        if (['completed', 'failed'].includes(record.status)) {
          json(res, 200, { accepted: true, status: record.status });
          return true;
        }
        if (record.status !== 'running') throw localCodexError('本地 Codex 任务尚未领取', 409);
        if (input.status === 'completed') {
          const result = input.result;
          if (!isSupportedLocalCodexModel(result?.model) || typeof result.text !== 'string' || !result.text.trim() || result.text.length > 2_000_000) throw localCodexError('本地 Codex 返回结果不完整');
          try { JSON.parse(result.text); } catch { throw localCodexError('本地 Codex 未返回完整 JSON'); }
          const usage = Object.fromEntries(Object.entries(result.usage || {}).filter(([key, value]) => /^(input_tokens|output_tokens|total_tokens|cached_input_tokens)$/.test(key) && Number.isFinite(value) && value >= 0));
          this.save({ ...record, status: 'completed', finishedAt: this.now(), result: {
            text: result.text, model: result.model, reportedModel: isSupportedLocalCodexModel(result.reportedModel) ? result.reportedModel : null,
            provider: 'local-codex', responseId: String(result.responseId || '').slice(0, 160), usage,
          } });
        } else {
          this.save({ ...record, status: 'failed', finishedAt: this.now(), error: '本地 Codex 任务未完成；未自动重提，请检查 Mac 上的登录、额度或原任务' });
        }
        json(res, 200, { accepted: true, status: this.jobs.get(input.id).status });
      } else if (!runner && req.method === 'GET' && path === '/local-codex/status') {
        json(res, 200, this.status());
      } else if (!runner && req.method === 'POST' && path === '/local-codex/jobs') {
        const task = normalizeLocalCodexTask(await body(req));
        if (task.userId !== userId || task.projectId !== projectId) throw localCodexError('本地 Codex 任务与项目不匹配', 403);
        const fingerprint = createHash('sha256').update(JSON.stringify(task)).digest('hex');
        const existing = this.jobs.get(task.id);
        if (existing && existing.fingerprint !== fingerprint) throw localCodexError('本地 Codex 请求编号已属于另一份内容', 409);
        if (!existing) {
          if (existsSync(join(this.root, `${task.id}.json`))) throw localCodexError('本地 Codex 原任务账本需要人工检查', 409);
          if (!this.status().ready) throw localCodexError(this.status().reason, 503, 'LOCAL_CODEX_OFFLINE');
          if ([...this.jobs.values()].filter(job => ['queued', 'running'].includes(job.status)).length >= 10) throw localCodexError('本地 Codex 队列已满，请等待已有任务', 429);
          this.save({ task, fingerprint, status: 'queued', createdAt: this.now(), deadline: this.now() + task.timeoutMs });
        }
        json(res, 202, { id: task.id, status: this.jobs.get(task.id).status });
      } else if (!runner && req.method === 'GET' && /^\/local-codex\/jobs\/[a-f0-9-]{36}$/i.test(path)) {
        const record = this.jobs.get(path.split('/').at(-1));
        if (!record || record.task.userId !== userId || record.task.projectId !== projectId) throw localCodexError('本地 Codex 任务不存在', 404);
        json(res, 200, { id: record.task.id, status: record.status, result: record.result, error: record.error });
      } else throw localCodexError('本地 Codex 路由不存在', 404);
    } catch (error) {
      json(res, error.statusCode || 500, { error: error.statusCode ? error.message : '本地 Codex 连接处理失败', code: error.code || 'LOCAL_CODEX_ERROR' });
    }
    return true;
  }
}

export function localCodexRelayFromEnvironment(env = process.env) {
  if (!env.MANJING_LOCAL_CODEX_OWNER_ID || String(env.MANJING_LOCAL_CODEX_TOKEN || '').length < 32) return null;
  return new LocalCodexRelay({ root: join(env.MANJING_DATA_ROOT || join(process.cwd(), 'work', 'manjing-server'), 'local-codex-relay'), ownerId: env.MANJING_LOCAL_CODEX_OWNER_ID, token: env.MANJING_LOCAL_CODEX_TOKEN });
}
