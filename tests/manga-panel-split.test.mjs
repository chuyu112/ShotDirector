import assert from 'node:assert/strict';
import test from 'node:test';
import { splitConfirmedMangaPanel } from '../server/manga-panel-split.mjs';

const fixture = () => ({
  parentId: 'P02-R-G04',
  analysis: { sourceFiles: [{ width: 1000, height: 800 }], mangaPages: [{ scanIndex: 1, readingOrder: ['P02-R-G03', 'P02-R-G04'], panels: [
    { id: 'P02-R-G03', includeInShots: true }, { id: 'P02-R-G04', includeInShots: true, bounds: { x: 10, y: 10, width: 80, height: 80 } },
  ] }], shots: [{ sourcePanels: ['P02-R-G03', 'P02-R-G04'] }] },
  state: { reviews: [
    { shot: { id: '01', shotUid: 'stable-1', duration: 22, sourcePanels: ['P02-R-G03', 'P02-R-G04'] }, completePrompt: 'keep old draft', completePromptStatus: 'ready', annotations: { story: 'keep' } },
    { shot: { id: '02', shotUid: 'stable-2', duration: 30, sourcePanels: ['P03-L-G01'] }, completePrompt: 'other ready', completePromptStatus: 'ready', approved: true },
  ] },
  children: [
    { id: 'P02-R-G07', bbox_px: [500, 100, 900, 700], source_width: 1000, source_height: 800, sourceObservation: 'right', textSummary: 'right first' },
    { id: 'P02-R-G08', bbox_px: [100, 100, 490, 700], source_width: 1000, source_height: 800, sourceObservation: 'left', textSummary: 'left next' },
  ],
});
test('split replaces exactly one panel with right then left, retaining groups, identities and old draft', () => {
  const input = fixture(), before = JSON.stringify(input);
  const result = splitConfirmedMangaPanel(input);
  assert.equal(result.state.reviews.length, 2);
  assert.deepEqual(result.state.reviews[0].shot.sourcePanels, ['P02-R-G03', 'P02-R-G07', 'P02-R-G08']);
  assert.equal(result.state.reviews[0].shot.shotUid, 'stable-1');
  assert.equal(result.state.reviews[0].shot.duration, 22);
  assert.equal(result.state.reviews[0].completePrompt, 'keep old draft');
  assert.equal(result.state.reviews[0].completePromptStatus, 'stale');
  assert.deepEqual(result.state.reviews[1], input.state.reviews[1]);
  assert.equal(result.analysis.mangaPages[0].panels.find(p => p.id === 'P02-R-G04').includeInShots, false);
  assert.equal(JSON.stringify(input), before);
});
test('approved, generating and reviewing owners cannot be silently split', () => {
  for (const patch of [{ approved: true }, { completePromptStatus: 'generating' }, { promptReviewStatus: 'reviewing' }]) {
    const input = fixture(); Object.assign(input.state.reviews[0], patch);
    assert.throws(() => splitConfirmedMangaPanel(input), /不可修改/);
  }
});
test('duplicate IDs, wrong image dimensions and repeat applications are rejected', () => {
  const duplicate = fixture(); duplicate.children[1].id = duplicate.children[0].id;
  assert.throws(() => splitConfirmedMangaPanel(duplicate), /重复/);
  const bad = fixture(); bad.children[0].source_width = 500;
  assert.throws(() => splitConfirmedMangaPanel(bad), /尺寸已改变/);
  const input = fixture(); const changed = splitConfirmedMangaPanel(input);
  assert.throws(() => splitConfirmedMangaPanel({ ...input, ...changed }), /已经拆分/);
});
