#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$APP_DIR"

load_env_file() {
  local env_file="$1"
  local line key value

  while IFS= read -r line || [ -n "$line" ]; do
    line="${line//$'\r'/}"
    line="${line#$'\ufeff'}"
    line="${line#export }"

    [[ -z "$line" || "$line" == \#* || "$line" != *=* ]] && continue

    key="${line%%=*}"
    value="${line#*=}"

    key="${key#"${key%%[![:space:]]*}"}"
    key="${key%"${key##*[![:space:]]}"}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"

    if [[ "$value" == \'*\' && "$value" == *\' ]]; then
      value="${value:1:${#value}-2}"
    elif [[ "$value" == \"*\" && "$value" == *\" ]]; then
      value="${value:1:${#value}-2}"
    fi

    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] && export "$key=$value"
  done < "$env_file"
}

if [ -f "$APP_DIR/.env" ]; then
  load_env_file "$APP_DIR/.env"
fi

export SERVER_PORT="${SERVER_PORT:-8083}"
export SPRING_PROFILES_ACTIVE="${SPRING_PROFILES_ACTIVE:-dev}"
export REDIS_HOST="${REDIS_HOST:-127.0.0.1}"
export REDIS_PORT="${REDIS_PORT:-6379}"
export REDIS_PASSWORD="${REDIS_PASSWORD:-}"
export REDIS_DATABASE="${REDIS_DATABASE:-0}"

exec java ${JAVA_OPTS:-} -jar "$APP_DIR/youmi-api-0.1.0.jar" \
  --spring.profiles.active="$SPRING_PROFILES_ACTIVE" \
  --spring.config.additional-location="optional:file:$APP_DIR/" \
  --server.port="$SERVER_PORT" \
  "$@"
