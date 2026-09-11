import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { contentReviewTarget, contentReviewGuard, initialContentWorksheet, validateContentWorksheet, contentStructurePatch, retainReviewForContentChange } from '../app/shot-content-review.mjs';

const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const fail = message => { const error = new Error(message); error.statusCode = 409; throw error; };
const read = path => JSON.parse(readFileSync(path, 'utf8'));
function atomicWrite(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}

/** All callbacks are synchronous so the check and draft rename cannot be
 * interleaved by another Worker request. No model, crop creation or network I/O. */
export function createShotContentReviewStore({ directory, draftDirectory, readEvidence, isBusy = () => false }) {
  mkdirSync(directory, { recursive: true });
  const scopePath = scopeId => {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(scopeId || '')) fail('草稿范围无效');
    return join(draftDirectory, `${scopeId}.json`);
  };
  const recordPath = id => {
    if (!/^[a-f0-9-]{36}$/.test(id || '')) fail('核对记录地址无效');
    return join(directory, `${id}.json`);
  };
  function target(state, shotUid) {
    const matches = state.reviews.filter(item => item.shot.shotUid === shotUid);
    if (matches.length !== 1 || !contentReviewTarget(matches[0].shot)) fail('本次同步仅适用于已确定为 26 秒、10 格、止于 P02-R-G08 的 Shot 01');
    return matches[0];
  }
  function evidenceFor(state, shotUid) {
    const review = target(state, shotUid);
    return review.shot.sourcePanels.map(panelId => {
      const panel = readEvidence(state.sourceMangaRequestId, panelId);
      if (!Buffer.isBuffer(panel.bytes) || !panel.bytes.length) fail(`${panelId} 缺少原始裁图，不能确认`);
      const { bytes, ...source } = panel;
      return { ...source, panelId, cropHash: hash(bytes) };
    });
  }
  function assertIdle(state) {
    if (isBusy(state.projectUid) || state.reviews.some(item => item.chat?.pending || item.scriptStatus === 'sending'
      || item.completePromptStatus === 'generating' || item.promptReviewStatus === 'reviewing')) fail('项目中还有运行、排队或待恢复的任务；请先等待原任务结束');
  }
  function current(record) {
    const snapshot = read(scopePath(record.scopeId));
    if (snapshot.state.projectUid !== record.projectUid || hash(contentReviewGuard(snapshot.state)) !== record.baseHash) fail('项目内容已变化，请重新打开核对；旧草稿与原始记录仍保留');
    assertIdle(snapshot.state);
    if (hash(evidenceFor(snapshot.state, record.shotUid)) !== record.evidenceHash) fail('原始裁图或文字证据已变化，请重新逐格核对');
    return snapshot;
  }
  function publicRecord(record) {
    const review = target(record.before.state, record.shotUid);
    return {
      id: record.id, scopeId: record.scopeId, projectUid: record.projectUid, shotUid: record.shotUid,
      createdAt: record.createdAt, status: record.status, baseHash: record.baseHash,
      evidence: record.evidence, worksheet: record.worksheet,
      timelineReference: record.before.state.reviews.map(item => ({ shotId: item.shot.id, timecode: item.shot.timecode, duration: item.shot.duration, panelCount: item.shot.sourcePanels?.length || 0 })),
      before: { shot: review.shot, completePrompt: review.completePrompt, report: review.promptReviewReport,
        reviewerId: review.promptReviewerId, reviewerModel: review.promptReviewerModel,
        reviewRevision: review.promptReviewSourceRevision, requestId: review.promptReviewRequestId,
        runId: review.promptReviewRunId, reviewedAt: review.promptReviewedAt,
        chat: review.chat, timeline: record.before.state.globalSettings.timeline },
    };
  }
  function prepare({ scopeId, projectUid, shotUid }) {
    const before = read(scopePath(scopeId));
    if (before.state.projectUid !== projectUid) fail('项目身份不一致');
    const review = target(before.state, shotUid);
    assertIdle(before.state);
    const evidence = evidenceFor(before.state, shotUid);
    const baseHash = hash(contentReviewGuard(before.state));
    const evidenceHash = hash(evidence);
    const existing = readdirSync(directory).filter(name => /^[a-f0-9-]{36}\.json$/.test(name)).map(name => read(join(directory, name)))
      .find(record => record.scopeId === scopeId && record.projectUid === projectUid && record.shotUid === shotUid && record.status === 'draft' && record.baseHash === baseHash && record.evidenceHash === evidenceHash);
    if (existing) return publicRecord(existing);
    const record = { id: randomUUID(), scopeId, projectUid, shotUid, status: 'draft', createdAt: new Date().toISOString(), before, baseHash, evidenceHash, evidence,
      worksheet: initialContentWorksheet(review, before.state.globalSettings.timeline) };
    atomicWrite(recordPath(record.id), record);
    return publicRecord(record);
  }
  function save({ id, worksheet }) {
    const record = read(recordPath(id));
    if (record.status !== 'draft') fail('已确认的核对记录不可覆盖');
    current(record);
    if (!worksheet || JSON.stringify(worksheet).length > 400_000) fail('核对草稿无效或过长');
    atomicWrite(recordPath(id), { ...record, worksheet, updatedAt: new Date().toISOString() });
    return { status: 'saved' };
  }
  function preview({ id, worksheet }) {
    const record = read(recordPath(id));
    if (record.status !== 'draft') fail('请重新打开核对');
    const snapshot = current(record);
    const errors = validateContentWorksheet(worksheet, target(snapshot.state, record.shotUid).shot.sourcePanels);
    if (errors.length) fail(errors.join('\n'));
    const proposalHash = hash({ baseHash: record.baseHash, evidenceHash: record.evidenceHash, worksheet });
    const proposal = { structure: contentStructurePatch(worksheet), timeline: worksheet.timeline };
    atomicWrite(recordPath(id), { ...record, worksheet, proposalHash, previewedAt: new Date().toISOString() });
    return { proposalHash, proposal, requiresStrictReview: true };
  }
  function confirm({ id, proposalHash, acknowledge }) {
    if (acknowledge !== true) fail('必须人工确认已展示的变更');
    const record = read(recordPath(id));
    const path = scopePath(record.scopeId);
    const latest = read(path);
    // Recover a lost response or a crash between the draft and receipt writes.
    if (latest.state.contentReviewHistory?.some(item => item.id === id)) {
      if (proposalHash !== record.proposalHash) fail('变更预览版本不一致');
      return { status: 'confirmed', snapshot: latest, id, requiresStrictReview: true };
    }
    if (record.status !== 'draft' || !proposalHash || proposalHash !== record.proposalHash
      || proposalHash !== hash({ baseHash: record.baseHash, evidenceHash: record.evidenceHash, worksheet: record.worksheet })) fail('请先检查最新变更预览，再确认同步');
    const snapshot = current(record);
    const original = target(snapshot.state, record.shotUid);
    const errors = validateContentWorksheet(record.worksheet, original.shot.sourcePanels);
    if (errors.length) fail(errors.join('\n'));
    const confirmedAt = new Date().toISOString();
    const revision = `human-content-${proposalHash}`;
    const timelineChanged = JSON.stringify(snapshot.state.globalSettings.timeline) !== JSON.stringify(record.worksheet.timeline);
    const confirmation = { id, revision, confirmedAt, confirmedBy: record.worksheet.confirmedBy, sourceMangaRequestId: snapshot.state.sourceMangaRequestId };
    const state = {
      ...snapshot.state,
      globalSettings: { ...snapshot.state.globalSettings, timeline: record.worksheet.timeline },
      reviews: snapshot.state.reviews.map(item => item.shot.shotUid === record.shotUid ? {
        ...retainReviewForContentChange(item, revision),
        shot: { ...item.shot, ...contentStructurePatch(record.worksheet), contentConfirmation: confirmation },
        scriptStatus: 'draft',
      } : timelineChanged ? retainReviewForContentChange(item, revision) : item),
      contentReviewHistory: [...(snapshot.state.contentReviewHistory || []), {
        ...confirmation, shotUid: record.shotUid, proposalHash, evidenceHash: record.evidenceHash,
        before: { reviews: snapshot.state.reviews, timeline: snapshot.state.globalSettings.timeline },
        evidence: record.evidence, worksheet: record.worksheet,
      }],
    };
    const next = { ...snapshot, state, savedAt: confirmedAt, agentRevision: revision, agentPending: true };
    atomicWrite(path, next);
    atomicWrite(recordPath(id), { ...record, status: 'confirmed', confirmedAt });
    return { status: 'confirmed', snapshot: next, id, requiresStrictReview: true };
  }
  function confirmedEvidence(payload, panels) {
    const confirmation = payload.shot?.contentConfirmation;
    if (!confirmation) {
      // A stale tab must not silently fall back to the disputed model evidence
      // by omitting the newly added confirmation pointer.
      const committed = readdirSync(directory).filter(name => /^[a-f0-9-]{36}\.json$/.test(name)).map(name => read(join(directory, name)))
        .find(item => item.projectUid === payload.projectUid && item.shotUid === payload.shot?.shotUid
          && read(scopePath(item.scopeId)).state.contentReviewHistory?.some(entry => entry.id === item.id));
      if (committed) fail('当前 Shot 已有人工核对结论，请刷新并使用已确认版本');
      return panels;
    }
    const record = read(recordPath(confirmation.id));
    const snapshot = read(scopePath(record.scopeId));
    if (record.projectUid !== payload.projectUid || record.shotUid !== payload.shot.shotUid
      || confirmation.revision !== `human-content-${record.proposalHash}`
      || record.before.state.sourceMangaRequestId !== payload.sourceMangaRequestId
      || JSON.stringify(payload.shot.sourcePanels) !== JSON.stringify(record.evidence.map(p => p.panelId))
      || payload.shot.duration !== 26
      || snapshot.state.reviews.find(item => item.shot.shotUid === record.shotUid)?.shot.contentConfirmation?.id !== record.id
      || !snapshot.state.contentReviewHistory?.some(item => item.id === record.id)) fail('人工核对记录与当前 Shot 不匹配，请重新核对');
    if (hash(evidenceFor(record.before.state, record.shotUid)) !== record.evidenceHash) fail('确认后的原裁图或文字证据已变化，请重新核对');
    if (!panels) return;
    if (JSON.stringify(panels.map(panel => panel.panelId)) !== JSON.stringify(record.evidence.map(panel => panel.panelId))) fail('人工核对证据顺序不一致');
    return panels.map(panel => {
      const human = record.worksheet.panels.find(item => item.panelId === panel.panelId);
      return {
        ...panel,
        machineEvidence: { sourceObservation: panel.sourceObservation, textSummary: panel.textSummary, sourceText: panel.sourceText },
        sourceObservation: human.observation, textSummary: human.observation,
        sourceText: human.sourceText.map(line => ({ ...line, location: panel.panelId, confidence: 'high' })),
        humanConfirmation: { ...confirmation, cropHash: record.evidence.find(item => item.panelId === panel.panelId).cropHash, textStatus: human.textStatus, note: human.note },
      };
    });
  }
  return { prepare, save, preview, confirm, confirmedEvidence, assertCurrentEvidence: payload => confirmedEvidence(payload) };
}
