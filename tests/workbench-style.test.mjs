import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('workbench theme uses equal header controls and responsive layout without changing media geometry', async () => {
  const css = await readFile(new URL('../app/workbench.css', import.meta.url), 'utf8');
  const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
  const layout = await readFile(new URL('../app/layout.tsx', import.meta.url), 'utf8');
  assert.ok(layout.indexOf('"./workbench.css"') > layout.indexOf('"./globals.css"'));
  assert.match(page, /className="topbar-control-group"/);
  assert.match(css, /\.topbar-control-group \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /height: var\(--header-control-height\)/);
  assert.match(css, /\.app-shell \.desk-mode-switch button\.active,[\s\S]*?background: var\(--blue\);[\s\S]*?color: #fff/);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*\.topbar-control-group \{ grid-template-columns: 1fr/);
  assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch(css, /(?:object-fit|transform:\s*scale|\.media-panel-box[^\n]*\{)/);
});

test('model tests remain click-only: polling is read-only and no automatic retry exists', async () => {
  const source = await readFile(new URL('../app/model-test-settings.tsx', import.meta.url), 'utf8');
  const effect = source.slice(source.indexOf('useEffect(() =>'), source.indexOf('async function start'));
  assert.doesNotMatch(effect, /method:\s*['"]POST|\bstart\(/);
  assert.equal((source.match(/method: 'POST'/g) || []).length, 1);
  assert.match(source, /onClick=\{\(\) => void start/);
  assert.match(source, /不自动重试/);
});

test('review styles preserve semantic states and avoid the brand selector collision', async () => {
  const css = await readFile(new URL('../app/workbench.css', import.meta.url), 'utf8');
  const legacy = await readFile(new URL('../app/globals.css', import.meta.url), 'utf8');
  const page = await readFile(new URL('../app/page.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(legacy, /\.strict-review-shell header span\s*\{/);
  assert.match(css, /\.strict-review-topbar\s*\{[^}]*grid-template-columns/);
  assert.match(css, /\.complete-shot-prompt-panel\.error\s*\{[^}]*#fff2ef/);
  assert.match(css, /\.prompt-review-config\[data-call-status="succeeded"\]/);
  assert.match(css, /\.prompt-review-config\[data-call-status="failed"\]/);
  assert.match(page, /data-call-status=\{selectedPromptReviewer\.lastCall\?\.status/);
});

test('small screens retain a horizontal pipeline and readable stacked generation metadata', async () => {
  const css = await readFile(new URL('../app/workbench.css', import.meta.url), 'utf8');
  assert.match(css, /--text-body:\s*14px/);
  assert.match(css, /--text-help:\s*12px/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.production-pipeline ol\s*\{[^}]*repeat\(7, 156px\)/);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*\.complete-shot-generation-status\s*\{[^}]*grid-template-columns: 1fr/);
  assert.match(css, /\.director-recipe-grid button\.active\s*\{[^}]*background: var\(--blue-soft\)/);
});
