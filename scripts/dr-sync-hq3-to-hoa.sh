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
KEEP_SNAPSHOTS="${KEEP_SNAPSHOTS:-30}"
HQ3_CRM_HEALTH_URL="${HQ3_CRM_HEALTH_URL:-https://crm.102-203-134-106.sslip.io/}"
DISABLE_HQ3_HEALTH_CHECK="${DISABLE_HQ3_HEALTH_CHECK:-false}"
STATE_FILE="${STATE_FILE:-$LOG_DIR/state}"
FAILBACK_REQUIRED_FILE="${FAILBACK_REQUIRED_FILE:-$LOG_DIR/failback_required}"

mkdir -p "$SNAPSHOT_DIR" "$LOG_DIR" "$(dirname "$LOCK_FILE")"

LOG_FILE="$LOG_DIR/sync.log"
LAST_SUCCESS_FILE="$LOG_DIR/last_success"
LAST_FAILURE_FILE="$LOG_DIR/last_failure"

log() {
  printf '[%s] %s\n' "$(date -Is)" "$*" | tee -a "$LOG_FILE"
}

set_state() {
  printf '%s\n' "$1" >"$STATE_FILE"
}

get_state() {
  if [[ -f "$STATE_FILE" ]]; then
    cat "$STATE_FILE"
  else
    printf 'HQ3_PRIMARY\n'
  fi
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

(
  if ! flock -n 9; then
    log "Previous DR sync still running; skipping this run"
    exit 0
  fi

  current_state="$(get_state)"
  if [[ "$current_state" == "HOA_ACTIVE_FAILOVER" || "$current_state" == "FAILBACK_REQUIRED" ]]; then
    log "DR state is $current_state; skipping HQ3 -> HOA sync to protect HOA changes"
    exit 0
  fi

  if [[ "$DISABLE_HQ3_HEALTH_CHECK" != "true" ]]; then
    log "Checking HQ3 CRM health: $HQ3_CRM_HEALTH_URL"
    if ! curl -fsS --max-time 10 "$HQ3_CRM_HEALTH_URL" >/dev/null 2>&1; then
      set_state "HOA_ACTIVE_FAILOVER"
      date -Is >"$FAILBACK_REQUIRED_FILE"
      log "HQ3 CRM health check failed; marking HOA_ACTIVE_FAILOVER and skipping sync"
      exit 0
    fi
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
  if [[ -n "$HOA_CONVEX_SELF_HOSTED_URL" ]]; then
    if ! CONVEX_SELF_HOSTED_URL="$HOA_CONVEX_SELF_HOSTED_URL" \
      CONVEX_SELF_HOSTED_ADMIN_KEY="$HOA_CONVEX_SELF_HOSTED_ADMIN_KEY" \
      pnpm exec convex import "$snapshot" --replace-all --yes >>"$LOG_FILE" 2>&1; then
      date -Is >"$LAST_FAILURE_FILE"
      log "ERROR: HOA self-hosted snapshot import failed"
      exit 1
    fi
  elif ! CONVEX_DEPLOY_KEY="$HOA_CONVEX_DEPLOY_KEY" \
    pnpm exec convex import "$snapshot" --replace-all --yes >>"$LOG_FILE" 2>&1; then
    date -Is >"$LAST_FAILURE_FILE"
    log "ERROR: HOA snapshot import failed"
    exit 1
  fi

  date -Is >"$LAST_SUCCESS_FILE"
  rm -f "$LAST_FAILURE_FILE"
  set_state "HQ3_PRIMARY"
  log "DR sync completed successfully"

  find "$SNAPSHOT_DIR" -maxdepth 1 -type f -name 'hq3-crm-*.zip' \
    | sort -r \
    | tail -n +"$((KEEP_SNAPSHOTS + 1))" \
    | while read -r old_snapshot; do
      rm -f "$old_snapshot" "$old_snapshot.sha256"
    done
) 9>"$LOCK_FILE"
