#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE="${DR_SYNC_ENV_FILE:-/etc/htgcrm-dr-sync.env}"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

HQ3_CONVEX_SELF_HOSTED_URL="${HQ3_CONVEX_SELF_HOSTED_URL:-}"
HQ3_CONVEX_SELF_HOSTED_ADMIN_KEY="${HQ3_CONVEX_SELF_HOSTED_ADMIN_KEY:-}"
HOA_CONVEX_DEPLOY_KEY="${HOA_CONVEX_DEPLOY_KEY:-}"

SNAPSHOT_DIR="${SNAPSHOT_DIR:-/var/backups/htgcrm-dr-sync}"
LOG_DIR="${LOG_DIR:-/var/log/htgcrm-dr-sync}"
LOCK_FILE="${LOCK_FILE:-/var/lock/htgcrm-dr-sync.lock}"
KEEP_SNAPSHOTS="${KEEP_SNAPSHOTS:-30}"

mkdir -p "$SNAPSHOT_DIR" "$LOG_DIR" "$(dirname "$LOCK_FILE")"

LOG_FILE="$LOG_DIR/sync.log"
LAST_SUCCESS_FILE="$LOG_DIR/last_success"
LAST_FAILURE_FILE="$LOG_DIR/last_failure"

log() {
  printf '[%s] %s\n' "$(date -Is)" "$*" | tee -a "$LOG_FILE"
}

require_env() {
  local name="$1"
  local value="${!name:-}"
  if [[ -z "$value" ]]; then
    log "ERROR: $name is not set"
    exit 1
  fi
}

require_env HQ3_CONVEX_SELF_HOSTED_URL
require_env HQ3_CONVEX_SELF_HOSTED_ADMIN_KEY
require_env HOA_CONVEX_DEPLOY_KEY

(
  if ! flock -n 9; then
    log "Previous DR sync still running; skipping this run"
    exit 0
  fi

  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  tmp_snapshot="$SNAPSHOT_DIR/.hq3-crm-$timestamp.zip.tmp"
  snapshot="$SNAPSHOT_DIR/hq3-crm-$timestamp.zip"

  log "Starting HQ3 -> HOA CRM snapshot sync"
  log "Exporting HQ3 Convex snapshot"
  if ! CONVEX_SELF_HOSTED_URL="$HQ3_CONVEX_SELF_HOSTED_URL" \
    CONVEX_SELF_HOSTED_ADMIN_KEY="$HQ3_CONVEX_SELF_HOSTED_ADMIN_KEY" \
    pnpm exec convex export --path "$tmp_snapshot" >>"$LOG_FILE" 2>&1; then
    rm -f "$tmp_snapshot"
    date -Is >"$LAST_FAILURE_FILE"
    log "ERROR: HQ3 snapshot export failed"
    exit 1
  fi

  mv "$tmp_snapshot" "$snapshot"
  sha256sum "$snapshot" >"$snapshot.sha256"
  ln -sfn "$snapshot" "$SNAPSHOT_DIR/latest.zip"
  ln -sfn "$snapshot.sha256" "$SNAPSHOT_DIR/latest.zip.sha256"
  log "Exported snapshot: $snapshot"

  log "Importing snapshot into HOA Convex deployment"
  if ! CONVEX_DEPLOY_KEY="$HOA_CONVEX_DEPLOY_KEY" \
    pnpm exec convex import "$snapshot" --replace-all --yes >>"$LOG_FILE" 2>&1; then
    date -Is >"$LAST_FAILURE_FILE"
    log "ERROR: HOA snapshot import failed"
    exit 1
  fi

  date -Is >"$LAST_SUCCESS_FILE"
  rm -f "$LAST_FAILURE_FILE"
  log "DR sync completed successfully"

  find "$SNAPSHOT_DIR" -maxdepth 1 -type f -name 'hq3-crm-*.zip' \
    | sort -r \
    | tail -n +"$((KEEP_SNAPSHOTS + 1))" \
    | while read -r old_snapshot; do
      rm -f "$old_snapshot" "$old_snapshot.sha256"
    done
) 9>"$LOCK_FILE"
