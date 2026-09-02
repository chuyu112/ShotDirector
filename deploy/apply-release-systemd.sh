#!/usr/bin/env bash
set -Eeuo pipefail

validate_release_archive() {
  local candidate_archive="$1"
  if tar -tzf "$candidate_archive" | awk '
    function is_secret_component(name, lower) {
      lower = tolower(name)
      if (lower ~ /^\.env/) return 1
      if (lower == ".npmrc" || lower == ".netrc" || lower == ".pypirc" || lower == ".htpasswd" || lower == ".git-credentials" || lower == "auth.json") return 1
      if (lower ~ /^id_(rsa|dsa|ecdsa|ed25519)$/) return 1
      if (lower ~ /\.(pem|key|p12|pfx|jks|keystore|kdbx|ovpn|tfstate)$/ || lower ~ /\.tfstate\.backup$/) return 1
      if (lower ~ /^(credentials|secrets?|service[-_]account)(\.(json|ya?ml|toml|ini|conf|txt))?$/) return 1
      return 0
    }
    {
      path = $0
      while (substr(path, 1, 2) == "./") path = substr(path, 3)
      sub(/\/+$/, "", path)
      if (path == "") next
      if (substr(path, 1, 1) == "/") exit 1

      count = split(path, components, "/")
      for (i = 1; i <= count; i += 1) {
        if (components[i] == "..") exit 1
      }

      # This checked-in, credential-free template is the sole .env* release allowlist.
      if (path == ".env.server.example") next

      lower_path = tolower(path)
      if (lower_path ~ /(^|\/)\.(ssh|aws|gnupg)(\/|$)/) exit 1
      if (lower_path ~ /(^|\/)\.docker\/config\.json$/) exit 1
      for (i = 1; i <= count; i += 1) {
        if (is_secret_component(components[i])) exit 1
      }
    }
  '; then
    return 0
  fi
  echo "archive contains an unsafe or secret-bearing path" >&2
  return 2
}

if [[ ${1:-} == "--validate-archive" ]]; then
  if [[ $# -ne 2 ]]; then
    echo "usage: $0 --validate-archive <runtime.tgz>" >&2
    exit 2
  fi
  validate_release_archive "$2"
  exit $?
fi

if [[ $# -ne 3 ]]; then
  echo "usage: $0 <runtime.tgz> <env-file> <sha256>" >&2
  exit 2
fi
if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "this deploy script must run as root" >&2
  exit 2
fi

archive="$1"
env_file="$2"
expected_sha="$3"
app_root="/opt/manjing"
data_root="/var/lib/manjing"
release_id="$(date -u +%Y%m%dT%H%M%SZ)"
backup_root="$app_root/backups/$release_id"
release_dirs=(dist server scripts runner app config deploy docs)
runtime_dirs=("${release_dirs[@]}" node_modules)
runtime_files=(package.json package-lock.json next.config.ts vite.config.ts tsconfig.json .env.server.example README.md agent.md memory.md)
release_stage=""

cleanup_release_stage() {
  if [[ -n "$release_stage" && -d "$release_stage" && "$release_stage" == "$app_root"/.release-stage-* ]]; then
    rm -rf -- "$release_stage"
  fi
}

printf '%s  %s\n' "$expected_sha" "$archive" | sha256sum -c -
validate_release_archive "$archive"
env_value() {
  local key="$1"
  awk -v expected="$key" '
    {
      line = $0
      sub(/^[[:space:]]+/, "", line)
      if (line == "" || line ~ /^#/) next
      sub(/^export[[:space:]]+/, "", line)
      separator = index(line, "=")
      if (separator == 0) next
      name = substr(line, 1, separator - 1)
      gsub(/[[:space:]]/, "", name)
      if (name != expected) next
      value = substr(line, separator + 1)
      sub(/^[[:space:]]+/, "", value)
      sub(/[[:space:]]+$/, "", value)
      if (length(value) >= 2) {
        first = substr(value, 1, 1)
        last = substr(value, length(value), 1)
        if ((first == "\"" && last == "\"") || (first == "\047" && last == "\047")) {
          value = substr(value, 2, length(value) - 2)
        }
      }
      print value
      exit
    }
  ' "$env_file"
}

require_env_value() {
  local key="$1"
  [[ -n "$(env_value "$key")" ]] || {
    echo "missing non-empty deployment setting: $key" >&2
    exit 2
  }
}

require_any_env_value() {
  local label="$1"
  shift
  local key
  for key in "$@"; do
    if [[ -n "$(env_value "$key")" ]]; then
      return 0
    fi
  done
  echo "missing non-empty deployment setting for $label: $*" >&2
  exit 2
}

ai_provider="$(env_value MANJING_AI_PROVIDER)"
[[ -n "$ai_provider" ]] || ai_provider=glm-5.3-flash
require_env_value MANJING_ALLOWED_ORIGINS

case "$ai_provider" in
  glm|glm-5.3-flash)
    require_any_env_value "GLM API key" MANJING_GLM_API_KEY GLM_API_KEY
    require_any_env_value "GLM API URL" MANJING_GLM_BASE_URL MANJING_GLM_API_URL GLM_API_URL
    require_any_env_value "GLM Flash model" MANJING_GLM_FLASH_MODEL GLM_FLASH_MODEL MANJING_GLM_MODEL
    ;;
  kimi|kimi-k3)
    require_any_env_value "Kimi API key" MANJING_KIMI_API_KEY KIMI_API_KEY
    require_any_env_value "Kimi API URL" MANJING_KIMI_BASE_URL MANJING_KIMI_API_URL KIMI_API_URL
    require_any_env_value "Kimi model" MANJING_KIMI_MODEL KIMI_MODEL
    ;;
  gpt-5.6-luna)
    require_any_env_value "OpenAI-compatible API key" MANJING_OPENAI_API_KEY OPENAI_API_KEY
    require_any_env_value "OpenAI-compatible API URL" MANJING_OPENAI_API_URL MANJING_OPENAI_BASE_URL OPENAI_API_URL OPENAI_BASE_URL
    require_any_env_value "GPT-5.6 Luna model" MANJING_OPENAI_MODEL OPENAI_MODEL
    ;;
  gpt-5.6-sol)
    require_any_env_value "OpenAI-compatible API key" MANJING_OPENAI_API_KEY OPENAI_API_KEY
    require_any_env_value "OpenAI-compatible API URL" MANJING_OPENAI_API_URL MANJING_OPENAI_BASE_URL OPENAI_API_URL OPENAI_BASE_URL
    require_any_env_value "GPT-5.6 Sol model" MANJING_OPENAI_SOL_MODEL OPENAI_SOL_MODEL
    ;;
  deepseek-v4-flash)
    require_any_env_value "DeepSeek API key" MANJING_DEEPSEEK_API_KEY DEEPSEEK_API_KEY
    require_any_env_value "DeepSeek API URL" MANJING_DEEPSEEK_BASE_URL MANJING_DEEPSEEK_API_URL DEEPSEEK_API_URL
    require_any_env_value "DeepSeek Flash model" MANJING_DEEPSEEK_MODEL DEEPSEEK_MODEL
    ;;
  deepseek-v4-pro)
    require_any_env_value "DeepSeek API key" MANJING_DEEPSEEK_API_KEY DEEPSEEK_API_KEY
    require_any_env_value "DeepSeek API URL" MANJING_DEEPSEEK_BASE_URL MANJING_DEEPSEEK_API_URL DEEPSEEK_API_URL
    require_any_env_value "DeepSeek Pro model" MANJING_DEEPSEEK_PRO_MODEL DEEPSEEK_PRO_MODEL
    ;;
  seed-2.1-pro)
    require_any_env_value "Seed API key" MANJING_DOUBAO_API_KEY DOUBAO_API_KEY
    require_any_env_value "Seed API URL" MANJING_DOUBAO_BASE_URL MANJING_DOUBAO_API_URL DOUBAO_API_URL
    require_any_env_value "Seed model" MANJING_DOUBAO_MODEL DOUBAO_MODEL
    ;;
  *)
    echo "server writing provider is not registered: $ai_provider" >&2
    exit 2
    ;;
esac

# Build the production dependency tree before stopping the live services. The
# staged tree is swapped together with the runtime so rollback never leaves a
# half-written node_modules behind.
release_stage="$(mktemp -d "$app_root/.release-stage-$release_id.XXXXXX")"
trap cleanup_release_stage EXIT
tar -xzf "$archive" -C "$release_stage"
node "$release_stage/scripts/verify-server-bundle.mjs" "$release_stage/dist"
(
  cd "$release_stage"
  npm ci --omit=dev --no-audit --no-fund
  npm ls --omit=dev --depth=0
  node --input-type=module -e 'await Promise.all([import("vinext/server/prod-server"), import("@earendil-works/pi-agent-core"), import("@earendil-works/pi-ai"), import("@earendil-works/pi-coding-agent"), import("sharp")])'
)

install -d -o root -g manjing -m 0750 "$app_root/backups"
install -d -o root -g root -m 0700 "$backup_root" "$backup_root/runtime" "$backup_root/system" "$backup_root/database"

systemctl stop manjing-gateway.service
systemctl stop manjing-web.service

rollback_required=1
rollback() {
  local status=$?
  if [[ $status -eq 0 || $rollback_required -ne 1 ]]; then
    return
  fi
  trap - ERR
  echo "deployment failed; restoring the previous runtime" >&2
  systemctl stop manjing-gateway.service manjing-web.service 2>/dev/null || true
  for directory in "${runtime_dirs[@]}"; do
    if [[ -e "$app_root/$directory" ]]; then
      rm -rf -- "$app_root/$directory"
    fi
    if [[ -d "$backup_root/runtime/$directory" ]]; then
      mv "$backup_root/runtime/$directory" "$app_root/$directory"
    fi
  done
  for filename in "${runtime_files[@]}"; do
    rm -f -- "$app_root/$filename"
    if [[ -f "$backup_root/runtime/$filename" ]]; then
      install -o root -g manjing -m 0640 "$backup_root/runtime/$filename" "$app_root/$filename"
    fi
  done
  if [[ -f "$backup_root/system/.env.server" ]]; then
    install -o root -g manjing -m 0640 "$backup_root/system/.env.server" "$app_root/.env.server"
  fi
  for unit in manjing-web.service manjing-gateway.service; do
    if [[ -f "$backup_root/system/$unit" ]]; then
      install -o root -g root -m 0644 "$backup_root/system/$unit" "/etc/systemd/system/$unit"
    fi
  done
  if [[ -f "$backup_root/system/manjing.conf" ]]; then
    install -o root -g root -m 0644 "$backup_root/system/manjing.conf" /etc/nginx/conf.d/manjing.conf
  fi
  systemctl daemon-reload
  nginx -t
  systemctl start manjing-web.service manjing-gateway.service
  systemctl reload nginx
  cleanup_release_stage
  exit "$status"
}
trap rollback ERR

for directory in "${runtime_dirs[@]}"; do
  if [[ -d "$app_root/$directory" ]]; then
    mv "$app_root/$directory" "$backup_root/runtime/$directory"
  fi
done
for filename in "${runtime_files[@]}"; do
  if [[ -f "$app_root/$filename" ]]; then
    install -o root -g root -m 0600 "$app_root/$filename" "$backup_root/runtime/$filename"
  fi
done
[[ -f "$app_root/.env.server" ]] && install -o root -g root -m 0600 "$app_root/.env.server" "$backup_root/system/.env.server"
[[ -f /etc/systemd/system/manjing-web.service ]] && install -o root -g root -m 0600 /etc/systemd/system/manjing-web.service "$backup_root/system/manjing-web.service"
[[ -f /etc/systemd/system/manjing-gateway.service ]] && install -o root -g root -m 0600 /etc/systemd/system/manjing-gateway.service "$backup_root/system/manjing-gateway.service"
[[ -f /etc/nginx/conf.d/manjing.conf ]] && install -o root -g root -m 0600 /etc/nginx/conf.d/manjing.conf "$backup_root/system/manjing.conf"
shopt -s nullglob
for database_file in "$data_root"/auth.sqlite*; do
  install -o root -g root -m 0600 "$database_file" "$backup_root/database/$(basename "$database_file")"
done
shopt -u nullglob

for directory in "${release_dirs[@]}"; do
  mv "$release_stage/$directory" "$app_root/$directory"
done
for filename in "${runtime_files[@]}"; do
  mv "$release_stage/$filename" "$app_root/$filename"
done
mv "$release_stage/node_modules" "$app_root/node_modules"
install -o root -g manjing -m 0640 "$env_file" "$app_root/.env.server"
install -o root -g root -m 0644 "$app_root/deploy/manjing-web.service" /etc/systemd/system/manjing-web.service
install -o root -g root -m 0644 "$app_root/deploy/manjing-gateway.service" /etc/systemd/system/manjing-gateway.service
install -o root -g root -m 0644 "$app_root/deploy/nginx.manjing.systemd.conf" /etc/nginx/conf.d/manjing.conf
chown -R root:manjing "${runtime_dirs[@]/#/$app_root/}"
chmod -R g+rX,o-rwx "${runtime_dirs[@]/#/$app_root/}"
chmod 0755 "$app_root/deploy/apply-release-systemd.sh" "$app_root/deploy/install-ffmpeg-static.sh"
chmod 0700 "$data_root"

systemctl daemon-reload
nginx -t
systemctl start manjing-web.service
systemctl start manjing-gateway.service
systemctl reload nginx
systemctl is-active --quiet manjing-web.service
systemctl is-active --quiet manjing-gateway.service

wait_for_endpoint() {
  local url="$1"
  local attempt
  for attempt in $(seq 1 30); do
    if curl -fsS --max-time 10 "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

wait_for_endpoint http://127.0.0.1:3300/
wait_for_endpoint http://127.0.0.1:8180/healthz
curl -fsS --max-time 10 http://127.0.0.1:3300/ | node -e '
  let body = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { body += chunk; });
  process.stdin.on("end", () => {
    const ogImage = body.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
    const twitterImage = body.match(/<meta name="twitter:image" content="([^"]+)"/)?.[1];
    let parsed;
    try {
      parsed = new URL(ogImage);
    } catch {
      process.exit(2);
    }
    if (ogImage !== twitterImage
      || !["http:", "https:"].includes(parsed.protocol)
      || parsed.pathname !== "/social-preview.png"
      || ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)) process.exit(2);
  });
'
curl -fsS --max-time 10 http://127.0.0.1:8180/healthz | node -e '
  let body = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { body += chunk; });
  process.stdin.on("end", () => {
    const health = JSON.parse(body);
    if (health?.ok !== true
      || health?.database?.journalMode !== "wal"
      || !Number.isInteger(health?.database?.schemaVersion)) process.exit(2);
  });
'
runuser -u manjing -- env \
  MANJING_APP_ROOT="$app_root" \
  MANJING_DEPLOY_SMOKE_PARENT="$data_root" \
  MANJING_PUBLIC_API_BASE=/api \
  MANJING_PYTHON=/usr/bin/python3 \
  FFMPEG_PATH=/usr/local/bin/ffmpeg \
  LIBTV_BIN=/usr/local/bin/libtv \
  /usr/local/bin/node --env-file="$app_root/.env.server" "$app_root/server/deployment-worker-smoke.mjs"

rollback_required=0
trap - ERR
cleanup_release_stage
trap - EXIT
echo "deployed release $release_id; backup: $backup_root"
