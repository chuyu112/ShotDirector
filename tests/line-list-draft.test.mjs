import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { editLineListDraft, reconcileLineListDraft } from '../app/line-list-draft.mjs';

test('Enter and repeated blank lines survive the normalized parent echo', () => {
  for (const text of ['歌舞厅老板\n', '歌舞厅老板\n\n', '\n', '歌舞厅老板\n  ']) {
    const draft = editLineListDraft(text);
    assert.equal(reconcileLineListDraft(draft, draft.items), draft);
    assert.equal(draft.text, text);
    assert.ok(draft.items.every(item => item.trim()));
  }
});

test('typing a second person, middle insertion, paste and deletion preserve the list', () => {
  for (const [text, items] of [
    ['歌舞厅老板\n冴羽獠', ['歌舞厅老板', '冴羽獠']],
    ['甲\n\n乙', ['甲', '乙']], ['  甲 \r\n乙\r丙\n', ['甲', '乙', '丙']],
    ['', []], ['日本語\n槇村香 ', ['日本語', '槇村香']],
  ]) {
    const draft = editLineListDraft(text);
    assert.deepEqual(draft.items, items);
    assert.equal(reconcileLineListDraft(draft, items).text, text);
  }
});

test('external changes and a new editor scope replace the raw draft', () => {
  const draft = editLineListDraft('甲\n');
  assert.equal(reconcileLineListDraft(draft, ['乙']).text, '乙');
  assert.equal(reconcileLineListDraft(null, ['甲']).text, '甲');
});

test('all editable newline lists use the scoped list editor, not lossy onChange rendering', () => {
  const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /value=\{lines\(/);
  assert.match(page, /<LineListField[^>]*label="出镜人物（每行一人）"/);
  assert.match(page, /<LineListTextarea[^>]*scopeKey=\{shotListScope\}/);
  const component = readFileSync(new URL('../app/line-list-field.tsx', import.meta.url), 'utf8');
  assert.match(component, /<ListEditor key=\{scopeKey\}/);
});

test('empty whitebox scenes cannot be locked or exported as generated references', () => {
  const editor = readFileSync(new URL('../app/whitebox-stage.tsx', import.meta.url), 'utf8');
  assert.match(editor, /disabled=\{!hasSceneContent && !referenceLocked\}/);
  assert.match(editor, /disabled=\{!hasSceneContent\} className="whitebox-download"/);
  assert.match(editor, /function downloadCleanFrame\(\) \{\s+if \(!hasSceneContent\) return;/);
  assert.match(editor, /async function lockCleanReference\(\) \{\s+if \(!hasSceneContent\) return;/);
});
