#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE="${DR_SYNC_ENV_FILE:-/etc/htgcrm-dr-sync.env}"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

HOA_SYNC_ENV_FILE="${HOA_SYNC_ENV_FILE:-/etc/htgcrm-hoa-sync.env}"
HOA_CONVEX_ENV_FILE="${HOA_CONVEX_ENV_FILE:-/etc/htgcrm-hoa-convex.env}"
if [[ -f "$HOA_SYNC_ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$HOA_SYNC_ENV_FILE"
fi
if [[ -f "$HOA_CONVEX_ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$HOA_CONVEX_ENV_FILE"
fi

HQ3_CONVEX_SELF_HOSTED_URL="${HQ3_CONVEX_SELF_HOSTED_URL:-}"
HQ3_CONVEX_SELF_HOSTED_ADMIN_KEY="${HQ3_CONVEX_SELF_HOSTED_ADMIN_KEY:-}"
HOA_CONVEX_SELF_HOSTED_URL="${HOA_CONVEX_SELF_HOSTED_URL:-}"
HOA_CONVEX_SELF_HOSTED_ADMIN_KEY="${HOA_CONVEX_SELF_HOSTED_ADMIN_KEY:-${CONVEX_SELF_HOSTED_ADMIN_KEY:-}}"
HOA_CONVEX_IMPORT_URL="${HOA_CONVEX_IMPORT_URL:-http://127.0.0.1:3210}"

SNAPSHOT_DIR="${SNAPSHOT_DIR:-/var/backups/htgcrm-dr-sync}"
LOG_DIR="${LOG_DIR:-/var/log/htgcrm-dr-sync}"
LOCK_FILE="${BUSINESS_LOCK_FILE:-/var/lock/htgcrm-dr-business-sync.lock}"
KEEP_BUSINESS_SNAPSHOTS="${KEEP_BUSINESS_SNAPSHOTS:-12}"
HQ3_CRM_HEALTH_URL="${HQ3_CRM_HEALTH_URL:-https://crm.102-203-134-106.sslip.io/}"
DISABLE_HQ3_HEALTH_CHECK="${DISABLE_HQ3_HEALTH_CHECK:-false}"
STATE_FILE="${STATE_FILE:-$LOG_DIR/state}"
FAILBACK_REQUIRED_FILE="${FAILBACK_REQUIRED_FILE:-$LOG_DIR/failback_required}"
MIN_AVAILABLE_MEM_MB="${BUSINESS_SYNC_MIN_AVAILABLE_MEM_MB:-2048}"
FAILURE_BACKOFF_SECONDS="${BUSINESS_SYNC_FAILURE_BACKOFF_SECONDS:-900}"

BUSINESS_TABLES="${BUSINESS_SYNC_TABLES:-countries sectors users companies leads salesTargets manageOneTenants tenantUsageHistory dailyUsageSnapshots activities tasks taskComments taskAttachments notifications consumption serviceCatalog aiRecommendations cloudAdvisorStatuses invoices invoicePayments invoiceEvents expenseCategories expenseRequests expenseEvents expenseReceipts financeSettings invoiceProfiles customerContracts customerContractEvents customerContractAmendments customerContractLineItems quotes}"

mkdir -p "$SNAPSHOT_DIR" "$LOG_DIR" "$(dirname "$LOCK_FILE")"

LOG_FILE="$LOG_DIR/business-sync.log"
LAST_SUCCESS_FILE="$LOG_DIR/business_last_success"
LAST_FAILURE_FILE="$LOG_DIR/business_last_failure"

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

available_mem_mb() {
  awk '/MemAvailable:/ { printf "%d", $2 / 1024 }' /proc/meminfo
}

should_backoff_after_failure() {
  [[ -f "$LAST_FAILURE_FILE" ]] || return 1
  local now last age
  now="$(date +%s)"
  last="$(date -d "$(cat "$LAST_FAILURE_FILE")" +%s 2>/dev/null || echo 0)"
  age=$((now - last))
  [[ "$age" -lt "$FAILURE_BACKOFF_SECONDS" ]]
}

filter_snapshot() {
  local source_zip="$1"
  local filtered_zip="$2"
  local tables="$3"

  python3 - "$source_zip" "$filtered_zip" "$tables" <<'PY'
import sys
from zipfile import ZipFile, ZIP_DEFLATED

source_zip, filtered_zip, tables_arg = sys.argv[1:4]
allowed_tables = set(tables_arg.split())
copied_tables = set()

with ZipFile(source_zip, "r") as src, ZipFile(filtered_zip, "w", ZIP_DEFLATED) as dst:
    for info in src.infolist():
        parts = info.filename.split("/", 1)
        if len(parts) < 2:
            continue
        table, rest = parts
        if table not in allowed_tables:
            continue
        if rest != "documents.jsonl":
            continue
        dst.writestr(info, src.read(info.filename))
        copied_tables.add(table)

missing = sorted(allowed_tables - copied_tables)
print("copied_tables=" + ",".join(sorted(copied_tables)))
if missing:
    print("missing_tables=" + ",".join(missing))
PY
}

require_env HQ3_CONVEX_SELF_HOSTED_URL
require_env HQ3_CONVEX_SELF_HOSTED_ADMIN_KEY
require_env HOA_CONVEX_SELF_HOSTED_ADMIN_KEY
require_env HOA_CONVEX_IMPORT_URL

(
  if ! flock -n 9; then
    log "Previous business DR sync still running; skipping this run"
    exit 0
  fi

  current_state="$(get_state)"
  if [[ "$current_state" == "HOA_ACTIVE_FAILOVER" || "$current_state" == "FAILBACK_REQUIRED" ]]; then
    log "DR state is $current_state; skipping business sync to protect HOA changes"
    exit 0
  fi

  if should_backoff_after_failure; then
    log "Recent business sync failure exists; delaying retry"
    exit 0
  fi

  mem_mb="$(available_mem_mb)"
  if [[ "$mem_mb" -lt "$MIN_AVAILABLE_MEM_MB" ]]; then
    date -Is >"$LAST_FAILURE_FILE"
    log "ERROR: available memory ${mem_mb}MiB is below guard ${MIN_AVAILABLE_MEM_MB}MiB; skipping business sync"
    exit 1
  fi

  if [[ "$DISABLE_HQ3_HEALTH_CHECK" != "true" ]]; then
    log "Checking HQ3 CRM health: $HQ3_CRM_HEALTH_URL"
    if ! curl -fsS --max-time 10 "$HQ3_CRM_HEALTH_URL" >/dev/null 2>&1; then
      set_state "HOA_ACTIVE_FAILOVER"
      date -Is >"$FAILBACK_REQUIRED_FILE"
      log "HQ3 CRM health check failed; marking HOA_ACTIVE_FAILOVER and skipping business sync"
      exit 0
    fi
  fi

  if [[ -n "${HTGWEB_SYNC_STATUS_URL:-}" ]]; then
    status="$(curl -fsS --max-time 10 "$HTGWEB_SYNC_STATUS_URL" || true)"
    if echo "$status" | grep -Eiq 'busy|running|in_progress|syncing'; then
      log "skip: HTGweb -> HQ3 push is running"
      exit 0
    fi
  fi

  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  source_tmp="$SNAPSHOT_DIR/.hq3-business-source-$timestamp.zip.tmp"
  source_snapshot="$SNAPSHOT_DIR/hq3-business-source-$timestamp.zip"
  filtered_tmp="$SNAPSHOT_DIR/.hq3-business-filtered-$timestamp.zip.tmp"
  filtered_snapshot="$SNAPSHOT_DIR/hq3-business-filtered-$timestamp.zip"

  log "Starting HQ3 -> HOA business-table sync"
  log "Exporting HQ3 Convex snapshot"
  if ! CONVEX_SELF_HOSTED_URL="$HQ3_CONVEX_SELF_HOSTED_URL" \
    CONVEX_SELF_HOSTED_ADMIN_KEY="$HQ3_CONVEX_SELF_HOSTED_ADMIN_KEY" \
    pnpm exec convex export --path "$source_tmp" >>"$LOG_FILE" 2>&1; then
    rm -f "$source_tmp"
    date -Is >"$LAST_FAILURE_FILE"
    log "ERROR: HQ3 snapshot export failed"
    exit 1
  fi

  mv "$source_tmp" "$source_snapshot"
  log "Filtering snapshot to business tables"
  if ! filter_snapshot "$source_snapshot" "$filtered_tmp" "$BUSINESS_TABLES" >>"$LOG_FILE" 2>&1; then
    rm -f "$filtered_tmp"
    date -Is >"$LAST_FAILURE_FILE"
    log "ERROR: business snapshot filter failed"
    exit 1
  fi
  mv "$filtered_tmp" "$filtered_snapshot"
  sha256sum "$filtered_snapshot" >"$filtered_snapshot.sha256"
  ln -sfn "$filtered_snapshot" "$SNAPSHOT_DIR/latest-business.zip"
  ln -sfn "$filtered_snapshot.sha256" "$SNAPSHOT_DIR/latest-business.zip.sha256"
  log "Filtered business snapshot: $filtered_snapshot"

  mem_mb="$(available_mem_mb)"
  if [[ "$mem_mb" -lt "$MIN_AVAILABLE_MEM_MB" ]]; then
    date -Is >"$LAST_FAILURE_FILE"
    log "ERROR: available memory ${mem_mb}MiB fell below guard before import; skipping HOA import"
    exit 1
  fi

  log "Importing business tables into HOA Convex deployment through $HOA_CONVEX_IMPORT_URL"
  if ! CONVEX_SELF_HOSTED_URL="$HOA_CONVEX_IMPORT_URL" \
    CONVEX_SELF_HOSTED_ADMIN_KEY="$HOA_CONVEX_SELF_HOSTED_ADMIN_KEY" \
    pnpm exec convex import "$filtered_snapshot" --replace --yes >>"$LOG_FILE" 2>&1; then
    date -Is >"$LAST_FAILURE_FILE"
    log "ERROR: HOA business-table import failed"
    exit 1
  fi

  date -Is >"$LAST_SUCCESS_FILE"
  rm -f "$LAST_FAILURE_FILE"
  set_state "HQ3_PRIMARY"
  log "Business DR sync completed successfully"

  find "$SNAPSHOT_DIR" -maxdepth 1 -type f \( -name 'hq3-business-source-*.zip' -o -name 'hq3-business-filtered-*.zip' \) \
    | sort -r \
    | tail -n +"$((KEEP_BUSINESS_SNAPSHOTS + 1))" \
    | while read -r old_snapshot; do
      rm -f "$old_snapshot" "$old_snapshot.sha256"
    done
) 9>"$LOCK_FILE"
