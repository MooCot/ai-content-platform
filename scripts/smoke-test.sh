#!/usr/bin/env sh
# ──────────────────────────────────────────────────────────────────────────────
# smoke-test.sh <BASE_URL>
#
# Проверяет базовую доступность API после деплоя.
# Завершается с кодом 1 при любой ошибке.
# ──────────────────────────────────────────────────────────────────────────────
set -eu

BASE_URL="${1:-}"
MAX_RETRIES=10
RETRY_DELAY=6  # seconds

if [ -z "$BASE_URL" ]; then
  echo "Usage: smoke-test.sh <BASE_URL>"
  exit 1
fi

log() { echo "[smoke] $*"; }
fail() { echo "[smoke] FAIL: $*" >&2; exit 1; }

# ── Helper: HTTP GET with status check ───────────────────────────────────────
check() {
  local url="$BASE_URL$1"
  local expected="${2:-200}"
  local actual

  actual=$(curl -sf -o /dev/null -w "%{http_code}" --max-time 10 "$url" 2>/dev/null || echo "000")

  if [ "$actual" = "$expected" ]; then
    log "OK  $url → $actual"
  else
    fail "$url expected $expected, got $actual"
  fi
}

# ── Wait for app to come up ───────────────────────────────────────────────────
log "Waiting for $BASE_URL to respond..."
i=0
until curl -sf --max-time 5 "$BASE_URL/api/v1/health" > /dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge "$MAX_RETRIES" ]; then
    fail "App did not respond after $((MAX_RETRIES * RETRY_DELAY))s"
  fi
  log "Attempt $i/$MAX_RETRIES — retrying in ${RETRY_DELAY}s..."
  sleep "$RETRY_DELAY"
done

log "App is up. Running smoke tests..."

# ── Checks ───────────────────────────────────────────────────────────────────
check "/api/v1/health"          "200"
check "/api/v1/brands"          "200"
check "/docs"                   "404"   # Swagger отключён в production

# Проверяем корректный 404 для несуществующего бренда
check "/api/v1/brands/00000000-0000-0000-0000-000000000000" "404"

# Проверяем что невалидный запрос возвращает 400 (ValidationPipe работает)
VALIDATION_CODE=$(curl -sf -o /dev/null -w "%{http_code}" --max-time 10 \
  -X POST "$BASE_URL/api/v1/brands" \
  -H "Content-Type: application/json" \
  -d '{"slug":""}' 2>/dev/null || echo "000")

if [ "$VALIDATION_CODE" = "400" ]; then
  log "OK  ValidationPipe → 400"
else
  fail "ValidationPipe expected 400, got $VALIDATION_CODE"
fi

log "All smoke tests passed."
