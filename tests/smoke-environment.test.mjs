import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { withPrivateSmokeEnvironment } from '../scripts/smoke-environment.mjs';

test('冒烟环境文件随机命名、权限 0600，成功、失败和终止均清理', async t => {
  const root = await mkdtemp(join(tmpdir(), 'manjing-smoke-env-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourcePath = join(root, "fixture's config.env");
  await writeFile(sourcePath, ' # 注释\n FAKE_KEY="fixture=value"\nPLAIN=normal\n', { mode: 0o600 });
  const seenPaths = new Set();
  for (const [ending, status] of [['true', 0], ['exit 19', 19], ['kill -TERM $$', 143]]) {
    const command = withPrivateSmokeEnvironment(`python3 - "$smoke_env_file" << 'PY'
import json, os, sys
with open(sys.argv[1]) as source:
    content = source.read()
print(json.dumps({'path': sys.argv[1], 'mode': os.stat(sys.argv[1]).st_mode & 0o777, 'content': content}))
PY
${ending}`, { sourcePath });
    const result = spawnSync('sh', ['-c', command], { env: { ...process.env, TMPDIR: root }, encoding: 'utf8' });
    assert.equal(result.status, status, result.stderr);
    const observed = JSON.parse(result.stdout);
    assert.equal(observed.mode, 0o600);
    assert.equal(observed.content, 'FAKE_KEY=fixture=value\nPLAIN=normal\n');
    assert.equal(seenPaths.has(observed.path), false);
    seenPaths.add(observed.path);
    assert.deepEqual(await readdir(root), ["fixture's config.env"]);
  }
  const failedSetup = spawnSync('sh', ['-c', withPrivateSmokeEnvironment('exit 0', { sourcePath: join(root, 'missing') })], {
    env: { ...process.env, TMPDIR: root }, encoding: 'utf8',
  });
  assert.notEqual(failedSetup.status, 0);
  assert.deepEqual(await readdir(root), ["fixture's config.env"]);
});
