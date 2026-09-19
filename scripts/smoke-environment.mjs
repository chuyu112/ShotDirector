const shellQuote = value => `'${String(value).replaceAll("'", "'\\''")}'`;

/** 在一次远程命令内准备并销毁私有环境文件，密钥不跨步骤留在 /tmp。 */
export function withPrivateSmokeEnvironment(command, { sourcePath = '/opt/manjing/.env.server' } = {}) {
  return `set -eu
umask 077
smoke_env_file=$(mktemp "\${TMPDIR:-/tmp}/manjing-smoke-env.XXXXXXXX")
trap 'rm -f -- "$smoke_env_file"' EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
python3 - ${shellQuote(sourcePath)} "$smoke_env_file" << 'PY'
import sys
lines = []
with open(sys.argv[1]) as source:
    for raw in source:
        line = raw.rstrip('\\n')
        if not line.strip() or line.lstrip().startswith('#') or '=' not in line:
            continue
        key, _, value = line.partition('=')
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
            value = value[1:-1]
        lines.append(f'{key.strip()}={value}')
with open(sys.argv[2], 'w') as target:
    target.write('\\n'.join(lines) + '\\n')
PY
${command}`;
}
