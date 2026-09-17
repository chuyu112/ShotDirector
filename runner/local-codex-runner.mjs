import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { executeLocalCodexTask, probeLocalCodex } from './local-codex-executor.mjs';
import { LOCAL_CODEX_MODEL, normalizeLocalCodexTask } from '../server/local-codex-contract.mjs';

function save(path, value) {
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(value), { mode: 0o600 });
  renameSync(temp, path);
}

export class LocalCodexRunner {
  constructor({ server, token, ownerId, root, execute = executeLocalCodexTask, probe = probeLocalCodex, fetchImpl = globalThis.fetch }) {
    const url = new URL(server);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) throw new Error('连接漫镜必须使用 HTTPS');
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('请使用不含路径或凭据的漫镜站点地址');
    if (typeof token !== 'string' || token.length < 32 || !ownerId) throw new Error('本地 Codex 连接配置不完整');
    this.base = `${url.origin}/api/local-codex/runner`;
    this.token = token;
    this.ownerId = ownerId;
    this.root = root;
    this.execute = execute;
    this.probe = probe;
    this.fetch = fetchImpl;
    this.connection = { ready: false, model: LOCAL_CODEX_MODEL, models: [] };
    this.lastProbe = 0;
    this.active = null;
    this.abortController = new AbortController();
    this.records = new Map();
    mkdirSync(root, { recursive: true, mode: 0o700 });
    for (const file of readdirSync(root).filter(name => /^[a-f0-9-]{36}\.json$/i.test(name))) {
      const record = JSON.parse(readFileSync(join(root, file), 'utf8'));
      if (record.status === 'running') {
        record.status = 'failed';
        record.reason = 'interrupted-before-confirmed-result';
        save(join(root, file), record);
      }
      this.records.set(record.id, record);
    }
  }

  async request(path, payload) {
    const response = await this.fetch(`${this.base}${path}`, {
      method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw Object.assign(new Error(`漫镜本地连接返回 HTTP ${response.status}`), { statusCode: response.status });
    return response.json();
  }

  persist(record) {
    save(join(this.root, `${record.id}.json`), record);
    this.records.set(record.id, record);
  }

  async flushResults() {
    for (const record of this.records.values()) {
      if (record.status === 'running' || record.acknowledged) continue;
      try {
        await this.request('/result', { id: record.id, status: record.status, result: record.result });
        this.persist({ ...record, acknowledged: true });
      } catch (error) {
        // A result retained locally after the server's retention period must not
        // block the connection forever or cause another model execution.
        if (error.statusCode !== 404) throw error;
        this.persist({ ...record, acknowledged: true, delivery: 'server-task-expired' });
      }
    }
  }

  async tick() {
    if (Date.now() - this.lastProbe > 60_000) {
      try { this.connection = await this.probe(); }
      catch { this.connection = { ready: false, model: LOCAL_CODEX_MODEL, models: [] }; }
      this.lastProbe = Date.now();
    }
    await this.flushResults();
    const response = await this.request('/poll', { ready: this.connection.ready, model: this.connection.model || LOCAL_CODEX_MODEL, models: this.connection.models || [], claim: !this.active && this.connection.ready });
    if (response.task) {
      const task = normalizeLocalCodexTask(response.task);
      if (task.userId !== this.ownerId) throw new Error('拒绝执行其他账户的本地 Codex 任务');
      const existing = this.records.get(task.id);
      if (existing) {
        // The durable local receipt is the execution fence, including failures.
        await this.request('/result', { id: task.id, status: existing.status === 'completed' ? 'completed' : 'failed', result: existing.result });
        return;
      }
      this.persist({ id: task.id, status: 'running', startedAt: new Date().toISOString() });
      this.active = (async () => {
        try {
          const result = await this.execute(task, { scratchRoot: join(this.root, 'scratch'), signal: this.abortController.signal });
          this.persist({ id: task.id, status: 'completed', result, finishedAt: new Date().toISOString() });
        } catch {
          this.persist({ id: task.id, status: 'failed', finishedAt: new Date().toISOString() });
          this.connection = { ready: false, model: LOCAL_CODEX_MODEL, models: [] };
          this.lastProbe = 0;
        }
      })().finally(() => { this.active = null; });
    }
  }

  async stop() {
    this.abortController.abort();
    await this.active;
    await this.flushResults().catch(() => {});
  }
}

async function main() {
  if (process.argv.includes('--check')) {
    console.log(JSON.stringify(await probeLocalCodex(), null, 2));
    return;
  }
  const flag = process.argv.indexOf('--config');
  const configFile = resolve(flag >= 0 ? process.argv[flag + 1] : join(homedir(), 'Library', 'Application Support', 'Manjing', 'local-codex', 'connection.json'));
  const config = JSON.parse(readFileSync(configFile, 'utf8'));
  const root = resolve(config.stateRoot || join(homedir(), 'Library', 'Application Support', 'Manjing', 'local-codex', 'jobs'));
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const lock = join(root, 'runner.lock');
  if (existsSync(lock)) {
    const oldPid = Number(readFileSync(lock, 'utf8'));
    let alive = false;
    try { process.kill(oldPid, 0); alive = true; } catch { /* Previous process exited. */ }
    if (alive) throw new Error('本地 Codex 连接服务已经运行');
    unlinkSync(lock);
  }
  writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 });
  const runner = new LocalCodexRunner({ ...config, root });
  let stopping = false;
  const stop = () => { stopping = true; runner.abortController.abort(); };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  console.log('漫镜本地 Codex 连接服务已启动');
  try {
    while (!stopping) {
      try { await runner.tick(); }
      catch { console.error('漫镜本地连接暂不可用；仅恢复连接，不重复执行模型任务'); }
      await delay(2_000);
    }
  } finally {
    await runner.stop();
    unlinkSync(lock);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error('本地 Codex 连接未启动，请检查本机安装、登录和私有连接配置'); process.exitCode = 1; });
}
