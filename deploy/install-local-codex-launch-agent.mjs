import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalCodexRunner } from '../runner/local-codex-runner.mjs';

if (process.platform !== 'darwin') throw new Error('此安装器仅用于当前 Mac 用户的登录启动服务');
const label = 'cloud.kakayiduo.manjing-local-codex';
const root = join(homedir(), 'Library', 'Application Support', 'Manjing', 'local-codex');
const configPath = resolve(process.argv[2] || join(root, 'connection.json'));
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const jobs = resolve(config.stateRoot || join(root, 'jobs'));
if (existsSync(jobs) && readdirSync(jobs).filter(name => /^[a-f0-9-]{36}\.json$/i.test(name)).some(name => JSON.parse(readFileSync(join(jobs, name), 'utf8')).status === 'running')) {
  throw new Error('仍有未确认结果的 Codex 任务，请先检查原任务，再安装连接服务');
}
// Validate the private URL/credential contract without making a model call.
new LocalCodexRunner({ ...config, root: jobs });
chmodSync(configPath, 0o600);
const source = fileURLToPath(new URL('..', import.meta.url));
const staging = join(root, `runtime-${Date.now()}`);
for (const file of ['runner/local-codex-runner.mjs', 'runner/local-codex-executor.mjs', 'server/local-codex-contract.mjs']) {
  const target = join(staging, file);
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  copyFileSync(join(source, file), target);
  chmodSync(target, 0o600);
}
const plistPath = join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
mkdirSync(dirname(plistPath), { recursive: true });
const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const log = join(root, 'connection.log');
writeFileSync(log, '', { flag: 'a', mode: 0o600 });
const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(join(staging, 'runner', 'local-codex-runner.mjs'))}</string><string>--config</string><string>${xml(configPath)}</string></array>
<key>WorkingDirectory</key><string>${xml(staging)}</string>
<key>EnvironmentVariables</key><dict><key>HOME</key><string>${xml(homedir())}</string><key>PATH</key><string>${xml(`${dirname(process.execPath)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`)}</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer>
<key>StandardOutPath</key><string>${xml(log)}</string><key>StandardErrorPath</key><string>${xml(log)}</string>
</dict></plist>
`;
const old = existsSync(plistPath) ? readFileSync(plistPath) : null;
if (old) copyFileSync(plistPath, `${plistPath}.${Date.now()}.bak`);
writeFileSync(`${plistPath}.tmp`, plist, { mode: 0o600 });
execFileSync('/usr/bin/plutil', ['-lint', `${plistPath}.tmp`], { stdio: 'pipe' });
const domain = `gui/${process.getuid()}`;
try { execFileSync('/bin/launchctl', ['bootout', `${domain}/${label}`], { stdio: 'pipe' }); } catch { /* Not previously loaded. */ }
renameSync(`${plistPath}.tmp`, plistPath);
try {
  execFileSync('/bin/launchctl', ['bootstrap', domain, plistPath], { stdio: 'pipe' });
} catch {
  if (old) { writeFileSync(plistPath, old, { mode: 0o600 }); execFileSync('/bin/launchctl', ['bootstrap', domain, plistPath], { stdio: 'pipe' }); }
  else rmSync(plistPath, { force: true });
  throw new Error('本地连接启动失败，已恢复原启动配置');
}
console.log(JSON.stringify({ installed: true, label, configPath, log, runtime: staging }));
