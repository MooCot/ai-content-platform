#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# seed.sh — Create demo brands and upload knowledge-base documents
# Usage:  bash .scripts/seed.sh [BASE_URL]
#         BASE_URL defaults to http://localhost:3000
#
# Idempotent: brands and documents that already exist are skipped.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

BASE_URL="${1:-http://localhost:3000}"
FIXTURE_DIR="$(cd "$(dirname "$0")/fixtures" && pwd)"

bold=$'\e[1m'; reset=$'\e[0m'
green=$'\e[32m'; yellow=$'\e[33m'; cyan=$'\e[36m'; red=$'\e[31m'
step()  { echo "${bold}${cyan}▶ $*${reset}"; }
ok()    { echo "${green}✓ $*${reset}"; }
warn()  { echo "${yellow}⚠ $*${reset}"; }
die()   { echo "${red}✗ $*${reset}" >&2; exit 1; }

require() { command -v "$1" &>/dev/null || die "Required: $1"; }
require curl
require jq

# ─── helpers ──────────────────────────────────────────────────────────────────

create_brand() {
  local slug="$1" name="$2" tone="$3" provider="$4"
  local existing
  existing=$(curl -sf "$BASE_URL/brands" \
    | jq -r --arg s "$slug" '.[] | select(.slug==$s) | .id')
  if [[ -n "$existing" ]]; then
    warn "Brand '$slug' already exists ($existing) — skipping"
    echo "$existing"
    return
  fi
  local resp
  resp=$(curl -sf -X POST "$BASE_URL/brands" \
    -H "Content-Type: application/json" \
    -d '{
      "slug": "'"$slug"'",
      "name": "'"$name"'",
      "config": {
        "defaultTone": "'"$tone"'",
        "allowedModels": ["gpt-4o", "gpt-4o-mini"],
        "preferredProvider": "'"$provider"'",
        "ragEnabled": true,
        "maxContentLength": 2500
      }
    }')
  local id
  id=$(echo "$resp" | jq -r '.id')
  [[ -n "$id" && "$id" != "null" ]] || die "Failed to create brand '$slug': $resp"
  ok "Created brand '$slug' → $id"
  echo "$id"
}

upload_doc() {
  local brand_id="$1" file_path="$2"
  local filename
  filename=$(basename "$file_path")
  [[ -f "$file_path" ]] || { warn "File not found: $file_path"; return; }
  local resp
  resp=$(curl -sf -X POST "$BASE_URL/brands/$brand_id/rag/upload" \
    -F "file=@$file_path;type=text/plain")
  local doc_id doc_status
  doc_id=$(echo "$resp" | jq -r '.id' 2>/dev/null || true)
  doc_status=$(echo "$resp" | jq -r '.status' 2>/dev/null || true)
  if [[ -n "$doc_id" && "$doc_id" != "null" ]]; then
    ok "Uploaded '$filename' → doc $doc_id ($doc_status)"
  else
    warn "Upload response: $resp"
  fi
}

# ─── health check ──────────────────────────────────────────────────────────────
step "Health check …"
for i in $(seq 1 10); do
  STATUS=$(curl -sf "$BASE_URL/health" | jq -r '.status' 2>/dev/null || true)
  [[ "$STATUS" == "ok" ]] && { ok "API healthy"; break; }
  [[ $i -eq 10 ]] && die "API not responding. Start the server first:\n  npm run start:dev"
  warn "Retry $i/10 …"; sleep 3
done

# ─── brand 1: Acme Tech (B2B SaaS) ───────────────────────────────────────────
step "Seeding brand: Acme Tech …"
ACME_ID=$(create_brand "acme-tech" "Acme Tech" "FORMAL" "OPENAI")
upload_doc "$ACME_ID" "$FIXTURE_DIR/acme-tech-knowledge-base.txt"

# ─── brand 2: Bright Bites (consumer food, casual tone) ──────────────────────
step "Seeding brand: Bright Bites …"
BRIGHT_ID=$(create_brand "bright-bites" "Bright Bites" "FRIENDLY" "OPENAI")

# Inline fixture for brand 2 (no separate file needed)
BRIGHT_DOC="$FIXTURE_DIR/bright-bites-knowledge-base.txt"
if [[ ! -f "$BRIGHT_DOC" ]]; then
  cat > "$BRIGHT_DOC" <<'EOF'
# Bright Bites — Brand Guide

## Who We Are
Bright Bites makes plant-based snacks for people who refuse to choose between taste and nutrition.
Founded in 2021 in Austin, TX. 100% vegan, non-GMO, B-Corp certified.

## Products
- **Chili Mango Bark** — dark chocolate bark with mango and a chili kick. 140 kcal, 4g protein.
- **Peanut Butter Puffs** — air-puffed corn snack, 3g sugar, 7g protein per bag.
- **Matcha Oat Bites** — energy balls with oats, dates, and ceremonial matcha.

Available at Whole Foods, Sprouts, and direct on brightbites.com. Free shipping over $30.

## Audience
Health-conscious 25–40 year olds who snack intentionally. They read ingredient lists, care
about sourcing, and share food content on Instagram and TikTok.

## Voice
Upbeat, honest, and a little playful. We don't preach about health — we celebrate good taste.
Use short sentences. Humor is welcome. Avoid: "guilt-free", "clean", "superfood" clichés.

## Key Numbers
- 3 million snack bags sold in 2023
- 4.7 / 5 average rating across 12,000 reviews
- Carbon-neutral shipping since March 2023
- 1% of revenue donated to urban agriculture nonprofits
EOF
fi
upload_doc "$BRIGHT_ID" "$BRIGHT_DOC"

# ─── summary ──────────────────────────────────────────────────────────────────
echo ""
ok "Seed complete"
echo ""
echo "  ${bold}Acme Tech${reset}    : $ACME_ID"
echo "  ${bold}Bright Bites${reset} : $BRIGHT_ID"
echo ""
echo "  All brands: ${bold}$BASE_URL/brands${reset}"
echo ""
echo "Next steps:"
echo "  1. Wait ~10 s for documents to finish indexing"
echo "  2. Generate content:"
echo "       curl -X POST $BASE_URL/brands/$ACME_ID/content/generate \\"
echo "         -H 'Content-Type: application/json' \\"
echo "         -d '{\"topic\": \"How FlowBot saves 18 hours a week\", \"contentType\": \"BLOG\"}'"
echo "  3. Or run the full demo:  ${bold}npm run demo${reset}"
