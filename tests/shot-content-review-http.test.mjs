import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { contentReviewState, contentPanelIds, completedContentWorksheet } from './fixtures/content-review-data.mjs';

test('real Worker manual-review endpoints save and confirm without model jobs, recrops or stale-tab overwrites', { timeout: 25_000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'manjing-content-http-'));
  const state = contentReviewState(), scopeId = state.sourceMangaRequestId;
  const responseDir = join(root, 'work', 'shotdirector-responses');
  const draftDir = join(root, 'work', 'shotdirector-draft-state');
  const cropDir = join(root, 'work', 'shotdirector-media', 'jobs', scopeId, 'panel-crops');
  for (const path of [responseDir, draftDir, cropDir]) mkdirSync(path, { recursive: true });
  const draftPath = join(draftDir, `${scopeId}.json`);
  writeFileSync(draftPath, JSON.stringify({ scopeId, state }));
  const crop = await sharp({ create: { width: 20, height: 30, channels: 3, background: '#ccc' } }).webp().toBuffer();
  for (const id of contentPanelIds) writeFileSync(join(cropDir, `${id}.webp`), crop);
  const analysisPath = join(responseDir, `media-analysis-${scopeId}.committed.json`);
  writeFileSync(analysisPath, JSON.stringify({ requestId: scopeId, kind: 'manga', mangaPages: [{ scanIndex: 1, sourceFile: 'synthetic', panels: contentPanelIds.map(id => ({ id, includeInShots: true, sourceObservation: '旧识别 A', bounds: { x: 0, y: 0, width: 10, height: 10 } })) }], sourceText: [] }));
  const originalAnalysis = readFileSync(analysisPath, 'utf8');
  const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port; await new Promise(resolveClose => reservation.close(resolveClose));
  const token = 'manual-review-test-token', appRoot = resolve('.');
  const child = spawn(process.execPath, ['scripts/shotdirector-bridge.mjs'], { cwd: appRoot, stdio: ['ignore', 'ignore', 'pipe'],
    env: { PATH: process.env.PATH, MANJING_APP_ROOT: appRoot, MANJING_DATA_ROOT: root, MANJING_SERVER_WORKER: '1', MANJING_INTERNAL_TOKEN: token,
      MANJING_BRIDGE_PORT: String(port), MANJING_BRIDGE_HOST: '127.0.0.1', MANJING_ALLOWED_ORIGINS: 'http://localhost:3000',
      MANJING_ALLOWED_HOSTS: `127.0.0.1:${port}`, MANJING_AI_PROVIDER: 'glm', LIBTV_BIN: join(root, 'no-libtv') } });
  let stderr = ''; child.stderr.on('data', data => { stderr += data; });
  t.after(async () => { if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); } rmSync(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { ready = (await fetch(`${base}/health`)).ok; } catch { /* Worker startup only. */ }
    if (ready || child.exitCode !== null) break;
    await new Promise(resolveWait => setTimeout(resolveWait, 80));
  }
  assert.ok(ready, stderr);
  const post = async (operation, body, authorized = true) => {
    const response = await fetch(`${base}/${operation}`, { method: 'POST', headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json', ...(authorized ? { 'X-Manjing-Token': token } : {}) }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const opening = { scopeId, projectUid: state.projectUid, shotUid: state.reviews[0].shot.shotUid };
  assert.equal((await post('shot-content-review/prepare', opening, false)).status, 401);
  const prepared = await post('shot-content-review/prepare', opening);
  assert.equal(prepared.status, 200, JSON.stringify(prepared.body));
  const session = prepared.body;
  const image = await fetch(`${base}${session.evidence[0].imagePath}?hash=${session.evidence[0].cropHash}&token=${token}`);
  assert.equal(image.status, 200); assert.deepEqual(Buffer.from(await image.arrayBuffer()), crop);
  assert.equal((await fetch(`${base}${session.evidence[0].imagePath}?hash=stale&token=${token}`)).status, 409);
  const worksheet = completedContentWorksheet(session);
  const preview = await post('shot-content-review/preview', { id: session.id, worksheet });
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.deepEqual(JSON.parse(readFileSync(draftPath)).state, state);
  const confirmed = await post('shot-content-review/confirm', { id: session.id, proposalHash: preview.body.proposalHash, acknowledge: true });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  assert.equal(confirmed.body.snapshot.state.reviews[0].promptReviewStatus, 'stale');
  assert.equal(confirmed.body.snapshot.state.reviews[0].approved, false);
  assert.equal((await post('draft-state', { scopeId, state, appliedAgentRevision: '' })).status, 202);
  assert.equal(JSON.parse(readFileSync(draftPath)).state.contentReviewHistory.length, 1);
  assert.equal(readFileSync(analysisPath, 'utf8'), originalAnalysis);
  for (const id of contentPanelIds) assert.deepEqual(readFileSync(join(cropDir, `${id}.webp`)), crop);
  assert.deepEqual(readdirSync(responseDir), [`media-analysis-${scopeId}.committed.json`]);
  assert.deepEqual(JSON.parse(readFileSync(draftPath)).state.globalSettings.timeline, worksheet.timeline);
  assert.equal(existsSync(join(root, 'work', 'project-global-settings.json')), false, 'material-draft timeline must not overwrite the main project/global file');
});
