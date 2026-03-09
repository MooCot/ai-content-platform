#!/usr/bin/env sh
# ──────────────────────────────────────────────────────────────────────────────
# verify-canary.sh
#
# Наблюдает за канарейкой в течение CANARY_VERIFY_DURATION секунд.
# Опрашивает Prometheus каждые 15 секунд и сравнивает:
#   - HTTP error rate канарейки vs stable
#   - p99 latency канарейки vs stable
#
# Переменные из CI:
#   PROMETHEUS_URL            — адрес Prometheus (внутри кластера)
#   CANARY_ERROR_THRESHOLD    — макс. % ошибок (default: 1)
#   CANARY_LATENCY_THRESHOLD  — макс. p99 latency в ms (default: 2000)
#   CANARY_VERIFY_DURATION    — сколько секунд наблюдать (default: 120)
# ──────────────────────────────────────────────────────────────────────────────
set -eu

PROMETHEUS_URL="${PROMETHEUS_URL:-http://prometheus.monitoring.svc:9090}"
ERROR_THRESHOLD="${CANARY_ERROR_THRESHOLD:-1}"
LATENCY_THRESHOLD="${CANARY_LATENCY_THRESHOLD:-2000}"
DURATION="${CANARY_VERIFY_DURATION:-120}"
POLL_INTERVAL=15

log()  { echo "[canary-verify] $*"; }
fail() { echo "[canary-verify] FAIL: $*" >&2; exit 1; }

# ── Query Prometheus ──────────────────────────────────────────────────────────
prom_query() {
  local query="$1"
  local encoded
  encoded=$(printf '%s' "$query" | sed 's/ /%20/g; s/{/%7B/g; s/}/%7D/g; s/"/%22/g; s/=/%3D/g; s/,/%2C/g; s/|/%7C/g')
  curl -sf --max-time 10 \
    "${PROMETHEUS_URL}/api/v1/query?query=${encoded}" \
    | jq -r '.data.result[0].value[1] // "NaN"'
}

# ── Error rate (5xx / total) для track=canary, последние 1m ──────────────────
canary_error_rate() {
  prom_query 'sum(rate(http_requests_total{track="canary",status=~"5.."}[1m])) / sum(rate(http_requests_total{track="canary"}[1m])) * 100'
}

# ── p99 latency для track=canary, последние 1m ────────────────────────────────
canary_latency_p99() {
  prom_query 'histogram_quantile(0.99, sum(rate(http_request_duration_ms_bucket{track="canary"}[1m])) by (le))'
}

# ── Основной цикл наблюдения ──────────────────────────────────────────────────
log "Starting canary verification (${DURATION}s, polling every ${POLL_INTERVAL}s)"
log "Thresholds: error_rate < ${ERROR_THRESHOLD}%,  p99_latency < ${LATENCY_THRESHOLD}ms"

elapsed=0
checks_passed=0

while [ "$elapsed" -lt "$DURATION" ]; do
  error_rate=$(canary_error_rate)
  latency_p99=$(canary_latency_p99)

  log "t+${elapsed}s | error_rate=${error_rate}% | p99=${latency_p99}ms"

  # ── Проверяем error rate ──────────────────────────────────────────────────
  if [ "$error_rate" != "NaN" ]; then
    # bc нужен для float-сравнения
    too_many_errors=$(echo "$error_rate > $ERROR_THRESHOLD" | bc -l 2>/dev/null || echo "0")
    if [ "$too_many_errors" = "1" ]; then
      fail "Error rate ${error_rate}% exceeds threshold ${ERROR_THRESHOLD}%. Triggering rollback."
    fi
  fi

  # ── Проверяем latency ─────────────────────────────────────────────────────
  if [ "$latency_p99" != "NaN" ]; then
    too_slow=$(echo "$latency_p99 > $LATENCY_THRESHOLD" | bc -l 2>/dev/null || echo "0")
    if [ "$too_slow" = "1" ]; then
      fail "p99 latency ${latency_p99}ms exceeds threshold ${LATENCY_THRESHOLD}ms. Triggering rollback."
    fi
  fi

  checks_passed=$((checks_passed + 1))
  elapsed=$((elapsed + POLL_INTERVAL))

  if [ "$elapsed" -lt "$DURATION" ]; then
    sleep "$POLL_INTERVAL"
  fi
done

log "Canary passed all ${checks_passed} checks over ${DURATION}s. Ready for full production rollout."
