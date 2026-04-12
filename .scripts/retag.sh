#!/usr/bin/env sh
# ──────────────────────────────────────────────────────────────────────────────
# retag.sh <SOURCE_IMAGE> <TARGET_TAG>
#
# Re-tags an image in the registry without pulling it locally.
# Uses skopeo if available, falls back to docker pull/tag/push.
# ──────────────────────────────────────────────────────────────────────────────
set -eu

SOURCE="$1"
TARGET="$2"

log() { echo "[retag] $*"; }

if command -v skopeo > /dev/null 2>&1; then
  log "Using skopeo to retag $SOURCE → $TARGET"
  skopeo copy \
    --src-creds  "$CI_REGISTRY_USER:$CI_REGISTRY_PASSWORD" \
    --dest-creds "$CI_REGISTRY_USER:$CI_REGISTRY_PASSWORD" \
    "docker://$SOURCE" \
    "docker://$TARGET"
else
  log "skopeo not found, falling back to docker pull/tag/push"
  docker pull  "$SOURCE"
  docker tag   "$SOURCE" "$TARGET"
  docker push  "$TARGET"
fi

log "Done: $TARGET"
