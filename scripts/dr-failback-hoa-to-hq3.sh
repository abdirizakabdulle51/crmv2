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
HOA_CONVEX_SELF_HOSTED_URL="${HOA_CONVEX_SELF_HOSTED_URL:-}"
HOA_CONVEX_SELF_HOSTED_ADMIN_KEY="${HOA_CONVEX_SELF_HOSTED_ADMIN_KEY:-}"
HOA_CONVEX_DEPLOY_KEY="${HOA_CONVEX_DEPLOY_KEY:-}"

SNAPSHOT_DIR="${SNAPSHOT_DIR:-/var/backups/htgcrm-dr-sync}"
LOG_DIR="${LOG_DIR:-/var/log/htgcrm-dr-sync}"
LOCK_FILE="${LOCK_FILE:-/var/lock/htgcrm-dr-sync.lock}"
HQ3_CRM_HEALTH_URL="${HQ3_CRM_HEALTH_URL:-https://crm.102-203-134-106.sslip.io/}"
STATE_FILE="${STATE_FILE:-$LOG_DIR/state}"
FAILBACK_REQUIRED_FILE="${FAILBACK_REQUIRED_FILE:-$LOG_DIR/failback_required}"

mkdir -p "$SNAPSHOT_DIR" "$LOG_DIR" "$(dirname "$LOCK_FILE")"

LOG_FILE="$LOG_DIR/failback.log"
LAST_FAILBACK_SUCCESS_FILE="$LOG_DIR/last_failback_success"

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

if [[ -n "$HOA_CONVEX_SELF_HOSTED_URL" || -n "$HOA_CONVEX_SELF_HOSTED_ADMIN_KEY" ]]; then
  require_env HOA_CONVEX_SELF_HOSTED_URL
  require_env HOA_CONVEX_SELF_HOSTED_ADMIN_KEY
elif [[ -z "$HOA_CONVEX_DEPLOY_KEY" ]]; then
  log "ERROR: set HOA_CONVEX_SELF_HOSTED_URL and HOA_CONVEX_SELF_HOSTED_ADMIN_KEY, or set legacy HOA_CONVEX_DEPLOY_KEY"
  exit 1
fi

if [[ "${CONFIRM_FAILBACK:-}" != "copy-hoa-to-hq3" ]]; then
  log "ERROR: Refusing failback without CONFIRM_FAILBACK=copy-hoa-to-hq3"
  exit 1
fi

(
  if ! flock -n 9; then
    log "Another DR sync/failback job is running; aborting"
    exit 1
  fi

  log "Checking HQ3 CRM health before failback: $HQ3_CRM_HEALTH_URL"
  if ! curl -fsS --max-time 10 "$HQ3_CRM_HEALTH_URL" >/dev/null 2>&1; then
    log "ERROR: HQ3 CRM is not healthy; failback aborted"
    exit 1
  fi

  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  tmp_snapshot="$SNAPSHOT_DIR/.hoa-crm-failback-$timestamp.zip.tmp"
  snapshot="$SNAPSHOT_DIR/hoa-crm-failback-$timestamp.zip"

  log "Exporting HOA Convex snapshot"
  if [[ -n "$HOA_CONVEX_SELF_HOSTED_URL" ]]; then
    if ! CONVEX_SELF_HOSTED_URL="$HOA_CONVEX_SELF_HOSTED_URL" \
      CONVEX_SELF_HOSTED_ADMIN_KEY="$HOA_CONVEX_SELF_HOSTED_ADMIN_KEY" \
      pnpm exec convex export --path "$tmp_snapshot" >>"$LOG_FILE" 2>&1; then
      rm -f "$tmp_snapshot"
      log "ERROR: HOA self-hosted snapshot export failed"
      exit 1
    fi
  elif ! CONVEX_DEPLOY_KEY="$HOA_CONVEX_DEPLOY_KEY" \
    pnpm exec convex export --path "$tmp_snapshot" >>"$LOG_FILE" 2>&1; then
    rm -f "$tmp_snapshot"
    log "ERROR: HOA snapshot export failed"
    exit 1
  fi

  mv "$tmp_snapshot" "$snapshot"
  sha256sum "$snapshot" >"$snapshot.sha256"
  log "Exported HOA snapshot: $snapshot"

  log "Importing HOA snapshot into HQ3 Convex"
  if ! CONVEX_SELF_HOSTED_URL="$HQ3_CONVEX_SELF_HOSTED_URL" \
    CONVEX_SELF_HOSTED_ADMIN_KEY="$HQ3_CONVEX_SELF_HOSTED_ADMIN_KEY" \
    pnpm exec convex import "$snapshot" --replace-all --yes >>"$LOG_FILE" 2>&1; then
    log "ERROR: HQ3 failback import failed"
    exit 1
  fi

  date -Is >"$LAST_FAILBACK_SUCCESS_FILE"
  rm -f "$FAILBACK_REQUIRED_FILE"
  printf 'HQ3_PRIMARY\n' >"$STATE_FILE"
  log "Failback completed successfully; HQ3 is primary again"
) 9>"$LOCK_FILE"
