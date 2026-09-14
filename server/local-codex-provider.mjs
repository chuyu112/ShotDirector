import { randomUUID } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { LOCAL_CODEX_MODEL, LOCAL_CODEX_PROVIDER, normalizeLocalCodexTask, localCodexError } from './local-codex-contract.mjs';

export class LocalCodexProvider {
  constructor({ baseUrl, token, userId, projectId, allowedRoots = [], fetchImpl = globalThis.fetch, pollMs = 1_000 }) {
    this.id = LOCAL_CODEX_PROVIDER;
    this.label = '本地 Codex GPT-6';
    this.model = LOCAL_CODEX_MODEL;
    this.supportsImages = true;
    this.baseUrl = String(baseUrl || '').replace(/\/$/, '');
    this.token = String(token || '');
    this.userId = userId;
    this.projectId = projectId;
    this.allowedRoots = allowedRoots;
    this.fetch = fetchImpl;
    this.pollMs = pollMs;
    this.connection = { ready: false, reason: '正在检查这台 Mac 的本地 Codex' };
    this.configured = Boolean(this.baseUrl && this.token.length >= 32 && userId && projectId);
    if (this.baseUrl) {
      const url = new URL(this.baseUrl);
      if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) || url.username || url.password || url.search || url.hash) throw localCodexError('本地 Codex 中继地址必须是 HTTPS 或本机回环地址');
    }
    this.configurationError = this.configured ? undefined : '当前账户尚未连接本地 Codex';
  }

  async request(path, { payload, signal, timeoutMs = 8_000 } = {}) {
    const response = await this.fetch(`${this.baseUrl}${path}`, {
      method: payload ? 'POST' : 'GET', redirect: 'error',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json', 'X-Manjing-User': this.userId, 'X-Manjing-Project': this.projectId },
      body: payload ? JSON.stringify(payload) : undefined,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs),
    });
    const value = await response.json();
    if (!response.ok) throw localCodexError(value.error || '本地 Codex 连接失败', response.status, value.code);
    return value;
  }

  async refreshStatus() {
    if (!this.configured) return this.connection;
    if (this.statusPromise) return this.statusPromise;
    this.statusPromise = this.request('/status', { timeoutMs: 750 })
      .then(value => { this.connection = { ready: value.ready === true, reason: value.reason, checkedAt: Date.now() }; })
      .catch(() => { this.connection = { ready: false, reason: '这台 Mac 的本地 Codex 未连接', checkedAt: Date.now() }; })
      .finally(() => { this.statusPromise = null; });
    await this.statusPromise;
    return this.connection;
  }

  async generate({ prompt, instructions, model = LOCAL_CODEX_MODEL, schema, schemaName, imagePaths = [], reasoningEffort = 'max', timeoutMs = 900_000, signal, onProgress = () => {} }) {
    if (!this.configured) throw localCodexError(this.configurationError, 503);
    await this.refreshStatus();
    if (!this.connection.ready) throw localCodexError(this.connection.reason || '本地 Codex 未就绪', 503, 'LOCAL_CODEX_OFFLINE');
    const actualRoots = await Promise.all(this.allowedRoots.map(root => realpath(resolve(root))));
    const images = [];
    let size = 0;
    for (const inputPath of imagePaths) {
      const path = await realpath(resolve(inputPath));
      if (!actualRoots.some(root => path === root || path.startsWith(`${root}${sep}`))) throw localCodexError('本地 Codex 图片不属于当前项目');
      const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }[extname(path).toLowerCase()];
      if (!mime) throw localCodexError('本地 Codex 图片格式不支持');
      const data = await readFile(path);
      size += data.length;
      if (size > 24 * 1024 * 1024) throw localCodexError('本地 Codex 图片总量超限');
      images.push({ mime, data: data.toString('base64') });
    }
    const task = normalizeLocalCodexTask({ id: randomUUID(), userId: this.userId, projectId: this.projectId, prompt, instructions, model, schema, schemaName, images, reasoningEffort, timeoutMs });
    const deadlineSignal = AbortSignal.timeout(task.timeoutMs);
    const effectiveSignal = signal ? AbortSignal.any([signal, deadlineSignal]) : deadlineSignal;
    // One submission only. Read-only polling may reconnect to the same durable id.
    await this.request('/jobs', { payload: task, signal: effectiveSignal, timeoutMs: 30_000 });
    onProgress({ phase: 'queued' });
    while (!effectiveSignal.aborted) {
      let record;
      try { record = await this.request(`/jobs/${task.id}`, { signal: effectiveSignal }); }
      catch (error) {
        if (effectiveSignal.aborted) break;
        if (error.statusCode && error.statusCode < 500) throw error;
        await delay(this.pollMs, undefined, { signal: effectiveSignal });
        continue;
      }
      if (record.status === 'completed') return record.result;
      if (record.status === 'failed') throw localCodexError(record.error, 502, 'LOCAL_CODEX_TASK_FAILED');
      onProgress({ phase: record.status });
      await delay(this.pollMs, undefined, { signal: effectiveSignal });
    }
    throw localCodexError('等待本地 Codex 超时或取消；原任务未自动重提', 504, 'LOCAL_CODEX_TIMEOUT');
  }
}
