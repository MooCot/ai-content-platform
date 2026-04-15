#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# demo.sh — End-to-end demo: create brand → upload doc → generate content
# Usage:  bash .scripts/demo.sh [BASE_URL]
#         BASE_URL defaults to http://localhost:3000
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

BASE_URL="${1:-http://localhost:3000}"
API_URL="$BASE_URL/api/v1"
FIXTURE_DIR="$(cd "$(dirname "$0")/fixtures" && pwd)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DOC_FILE="$FIXTURE_DIR/acme-tech-knowledge-base.txt"
BRAND_SLUG="acme-tech"
BRAND_NAME="Acme Tech"

# ── colour helpers ────────────────────────────────────────────────────────────
bold=$'\e[1m'; reset=$'\e[0m'
green=$'\e[32m'; yellow=$'\e[33m'; cyan=$'\e[36m'; red=$'\e[31m'

step()  { echo "${bold}${cyan}▶ $*${reset}"; }
ok()    { echo "${green}✓ $*${reset}"; }
warn()  { echo "${yellow}⚠ $*${reset}"; }
die()   { echo "${red}✗ $*${reset}" >&2; exit 1; }

require() { command -v "$1" &>/dev/null || die "Required tool not found: $1"; }
require curl
require jq

# ── 0. load .env and preflight checks ────────────────────────────────────────
ENV_FILE="$SCRIPT_DIR/../.env"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$ENV_FILE"
  set +a
fi

is_placeholder() {
  local val="$1"
  [[ -z "$val" || "$val" == "sk-ant-..."* || "$val" == "sk-..."* || "$val" == "AIza..."* ]]
}

step "Checking required environment variables …"
HAS_LLM=false
declare -A PROVIDER_KEYS=(
  [claude]="${ANTHROPIC_API_KEY:-}"
  [openai]="${OPENAI_API_KEY:-}"
  [gemini]="${GOOGLE_AI_API_KEY:-}"
  [alibaba]="${DASHSCOPE_API_KEY:-}"
)
for name in "${!PROVIDER_KEYS[@]}"; do
  val="${PROVIDER_KEYS[$name]}"
  if ! is_placeholder "$val"; then
    HAS_LLM=true
  fi
done
if [[ "$HAS_LLM" == false ]]; then
  die "No LLM API key configured. Set at least one in .env:\n  ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_AI_API_KEY, or DASHSCOPE_API_KEY"
fi
ok "At least one LLM key is configured"

# ── ping configured providers ─────────────────────────────────────────────────
step "Pinging configured LLM providers …"

ping_provider() {
  local name="$1" url="$2" auth_header="$3"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 -H "$auth_header" "$url" 2>/dev/null || echo "000")
  if [[ "$code" == "200" ]]; then
    ok "$name — reachable"
  elif [[ "$code" == "000" ]]; then
    warn "$name — no response (timeout or connection refused) — this provider will be skipped by the router"
  else
    warn "$name — HTTP $code (key may be invalid or rate-limited)"
  fi
}

if ! is_placeholder "${ANTHROPIC_API_KEY:-}"; then
  ping_provider "claude (Anthropic)" \
    "https://api.anthropic.com/v1/models" \
    "x-api-key: ${ANTHROPIC_API_KEY}"
fi
if ! is_placeholder "${OPENAI_API_KEY:-}"; then
  ping_provider "openai" \
    "https://api.openai.com/v1/models" \
    "Authorization: Bearer ${OPENAI_API_KEY}"
fi
if ! is_placeholder "${GOOGLE_AI_API_KEY:-}"; then
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 \
    "https://generativelanguage.googleapis.com/v1beta/models?key=${GOOGLE_AI_API_KEY}" 2>/dev/null || echo "000")
  if [[ "$code" == "200" ]]; then ok "gemini (Google) — reachable"
  elif [[ "$code" == "000" ]]; then warn "gemini — no response"
  else warn "gemini — HTTP $code"; fi
fi
if ! is_placeholder "${DASHSCOPE_API_KEY:-}"; then
  ping_provider "alibaba (DashScope)" \
    "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models" \
    "Authorization: Bearer ${DASHSCOPE_API_KEY}"
fi

# ── check embedding provider ──────────────────────────────────────────────────
EMBEDDING_PROVIDER="${EMBEDDING_PROVIDER:-openai}"
EMBEDDING_OK=false

step "Checking embedding provider '$EMBEDDING_PROVIDER' …"
case "$EMBEDDING_PROVIDER" in
  openai)
    if is_placeholder "${OPENAI_API_KEY:-}"; then
      warn "OPENAI_API_KEY is not set — RAG indexing will be skipped"
    else
      code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 \
        -H "Authorization: Bearer ${OPENAI_API_KEY}" \
        "https://api.openai.com/v1/models" 2>/dev/null || echo "000")
      if [[ "$code" == "200" ]]; then
        ok "openai embedding provider is reachable"
        EMBEDDING_OK=true
      else
        warn "openai returned HTTP $code — RAG indexing will be skipped"
      fi
    fi ;;
  alibaba)
    if is_placeholder "${DASHSCOPE_API_KEY:-}"; then
      warn "DASHSCOPE_API_KEY is not set — RAG indexing will be skipped"
    else
      code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 \
        -H "Authorization: Bearer ${DASHSCOPE_API_KEY}" \
        "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models" 2>/dev/null || echo "000")
      if [[ "$code" == "200" ]]; then
        ok "alibaba embedding provider is reachable"
        EMBEDDING_OK=true
      else
        warn "alibaba (DashScope) returned HTTP $code — RAG indexing will be skipped"
      fi
    fi ;;
  *)
    warn "Unknown EMBEDDING_PROVIDER='$EMBEDDING_PROVIDER' — RAG indexing will be skipped" ;;
esac

# ── 1. health check ───────────────────────────────────────────────────────────
step "Checking API health at $BASE_URL …"
for i in $(seq 1 10); do
  STATUS=$(curl -sf "$API_URL/health" | jq -r '.status' 2>/dev/null || true)
  if [[ "$STATUS" == "ok" ]]; then
    ok "API is healthy"
    break
  fi
  if [[ $i -eq 10 ]]; then
    die "API not responding after 10 attempts. Is the server running?\n  → npm run start:dev"
  fi
  warn "Attempt $i/10 — retrying in 3 s …"
  sleep 3
done

# ── 2. create (or reuse) brand ────────────────────────────────────────────────
step "Looking for existing brand '$BRAND_SLUG' …"
BRAND_ID=$(curl -sf "$API_URL/brands" | jq -r --arg slug "$BRAND_SLUG" '.[] | select(.slug==$slug) | .id' 2>/dev/null || true)

if [[ -n "$BRAND_ID" ]]; then
  ok "Brand already exists: $BRAND_ID"
else
  step "Creating brand '$BRAND_NAME' …"
  BRAND_RESP=$(curl -sf -X POST "$API_URL/brands" \
    -H "Content-Type: application/json" \
    -d '{
      "slug": "'"$BRAND_SLUG"'",
      "name": "'"$BRAND_NAME"'",
      "config": {
        "defaultTone": "FORMAL",
        "allowedModels": ["gpt-4o", "gpt-4o-mini"],
        "preferredProvider": "openai",
        "ragEnabled": true,
        "maxContentLength": 2000
      }
    }')
  BRAND_ID=$(echo "$BRAND_RESP" | jq -r '.id')
  [[ -n "$BRAND_ID" && "$BRAND_ID" != "null" ]] || die "Failed to create brand: $BRAND_RESP"
  ok "Brand created: $BRAND_ID"
fi

echo "  BRAND_ID = $BRAND_ID"

# ── 3. upload knowledge-base document ────────────────────────────────────────
if [[ "$EMBEDDING_OK" == true ]]; then
  step "Uploading knowledge-base document …"
  [[ -f "$DOC_FILE" ]] || die "Fixture file not found: $DOC_FILE"

  UPLOAD_RESP=$(curl -sf -X POST "$API_URL/brands/$BRAND_ID/rag/upload" \
    -F "file=@$DOC_FILE;type=text/plain" 2>&1) || true
  DOC_ID=$(echo "$UPLOAD_RESP" | jq -r '.id' 2>/dev/null || true)

  if [[ -n "$DOC_ID" && "$DOC_ID" != "null" ]]; then
    ok "Document accepted: $DOC_ID"
  else
    warn "Upload response: $UPLOAD_RESP"
    warn "Continuing without fresh upload (document may already exist)"
    DOC_ID=""
  fi
else
  warn "Skipping document upload — embedding provider not configured"
  DOC_ID=""
fi

# ── 4. wait for document to reach READY ──────────────────────────────────────
if [[ -n "${DOC_ID:-}" && "$DOC_ID" != "null" ]]; then
  step "Waiting for document to be indexed …"
  for i in $(seq 1 30); do
    DOC_STATUS=$(curl -sf "$API_URL/brands/$BRAND_ID/rag/documents" \
      | jq -r --arg id "$DOC_ID" '.[] | select(.id==$id) | .status' 2>/dev/null || true)
    case "$DOC_STATUS" in
      READY)   ok "Document indexed (READY)"; break ;;
      FAILED)  warn "Document indexing failed — RAG will be skipped" ; break ;;
      "")      warn "Document not visible yet — retrying ($i/30) …" ;;
      *)       echo "  status: $DOC_STATUS ($i/30) …" ;;
    esac
    [[ $i -eq 30 ]] && warn "Timeout waiting for READY — continuing anyway"
    sleep 2
  done
fi

# ── 5. generate content ───────────────────────────────────────────────────────
TOPIC="How Acme Tech's FlowBot reduces lead response time from hours to minutes"
CONTENT_TYPE="BLOG"

step "Starting content generation …"
echo "  topic       : $TOPIC"
echo "  contentType : $CONTENT_TYPE"

CORR_ID="demo-$(date +%s)"
GEN_RESP=$(curl -sf -X POST "$API_URL/brands/$BRAND_ID/content/generate" \
  -H "Content-Type: application/json" \
  -H "x-correlation-id: $CORR_ID" \
  -d '{
    "topic": "'"$TOPIC"'",
    "contentType": "'"$CONTENT_TYPE"'"
  }')

JOB_ID=$(echo "$GEN_RESP" | jq -r '.jobId')
STREAM_URL=$(echo "$GEN_RESP" | jq -r '.streamUrl')
[[ -n "$JOB_ID" && "$JOB_ID" != "null" ]] || die "Failed to start job: $GEN_RESP"
ok "Job created: $JOB_ID"
echo "  streamUrl: $BASE_URL$STREAM_URL"

# ── 6. stream SSE output ──────────────────────────────────────────────────────
step "Streaming live output (Ctrl+C to stop early) …"
echo "──────────────────────────────────────────────────────"

DONE_SEEN=false
FINAL_CONTENT=""

# curl SSE stream; extract token deltas and print inline
while IFS= read -r line; do
  if [[ "$line" == data:* ]]; then
    payload="${line#data: }"
    event_type=$(echo "$payload" | jq -r '.type' 2>/dev/null || true)
    case "$event_type" in
      agent_step)
        agent=$(echo "$payload" | jq -r '.agent' 2>/dev/null || true)
        agent_status=$(echo "$payload" | jq -r '.status' 2>/dev/null || true)
        echo ""
        echo "${bold}[${agent}] ${agent_status}${reset}"
        ;;
      token)
        delta=$(echo "$payload" | jq -r '.delta' 2>/dev/null || true)
        printf '%s' "$delta"
        FINAL_CONTENT+="$delta"
        ;;
      done)
        echo ""
        DONE_SEEN=true
        ;;
      error)
        echo ""
        err_msg=$(echo "$payload" | jq -r '.message' 2>/dev/null || echo "$payload")
        warn "Stream error: $err_msg"
        DONE_SEEN=true
        ;;
    esac
  fi
done < <(curl -sf --no-buffer -H "Accept: text/event-stream" "$BASE_URL$STREAM_URL" 2>&1 || true)

echo "──────────────────────────────────────────────────────"

# ── 7. fetch final job result ─────────────────────────────────────────────────
step "Fetching job result …"
sleep 1
JOB_RESULT=$(curl -sf "$API_URL/brands/$BRAND_ID/content/$JOB_ID" 2>/dev/null || true)
JOB_STATUS=$(echo "$JOB_RESULT" | jq -r '.status' 2>/dev/null || true)

if [[ "$JOB_STATUS" == "DONE" ]]; then
  ok "Job completed successfully"
  WORD_COUNT=$(echo "$JOB_RESULT" | jq -r '.result.wordCount // "unknown"')
  MODEL=$(echo "$JOB_RESULT" | jq -r '.result.model // "unknown"')
  PROVIDER=$(echo "$JOB_RESULT" | jq -r '.result.provider // "unknown"')
  echo ""
  echo "  ${bold}Word count${reset} : $WORD_COUNT"
  echo "  ${bold}Model${reset}      : $MODEL ($PROVIDER)"
else
  warn "Job status: ${JOB_STATUS:-unknown}"
fi

# ── 8. summary ────────────────────────────────────────────────────────────────
echo ""
ok "Demo complete! Brand ID: $BRAND_ID"
echo ""
echo "────────────────────────────────────────────────────────"
echo "${bold}What to open and in what order:${reset}"
echo ""
echo "  ${bold}1. Job result${reset} — check that status is DONE and read the generated content:"
echo "     ${bold}$API_URL/brands/$BRAND_ID/content/$JOB_ID${reset}"
echo "     ${yellow}(refresh until status changes from RUNNING → DONE)${reset}"
echo ""
if [[ "$EMBEDDING_OK" == true ]]; then
  echo "  ${bold}2. RAG documents${reset} — verify the knowledge-base document was indexed:"
  echo "     ${bold}$API_URL/brands/$BRAND_ID/rag/documents${reset}"
  echo "     ${yellow}(wait ~10–15 s after seed; status should reach READY)${reset}"
  echo ""
else
  warn "RAG documents link skipped — configure EMBEDDING_PROVIDER and its API key to enable RAG indexing"
  echo ""
fi
echo "  ${bold}3. Swagger UI${reset} — explore all API endpoints interactively:"
echo "     ${bold}$BASE_URL/docs${reset}"
echo "────────────────────────────────────────────────────────"
