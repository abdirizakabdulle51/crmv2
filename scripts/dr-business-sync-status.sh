#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${DR_SYNC_ENV_FILE:-/etc/htgcrm-dr-sync.env}"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

HOA_SYNC_ENV_FILE="${HOA_SYNC_ENV_FILE:-/etc/htgcrm-hoa-sync.env}"
if [[ -f "$HOA_SYNC_ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$HOA_SYNC_ENV_FILE"
fi

LOG_DIR="${LOG_DIR:-/var/log/htgcrm-dr-sync}"
LOG_FILE="$LOG_DIR/business-sync.log"
LAST_SUCCESS_FILE="$LOG_DIR/business_last_success"
LAST_FAILURE_FILE="$LOG_DIR/business_last_failure"
STATE_FILE="${STATE_FILE:-$LOG_DIR/state}"

echo "HTG CRM HOA business DR sync status"
echo "-----------------------------------"

if [[ -f "$STATE_FILE" ]]; then
  echo "State: $(cat "$STATE_FILE")"
else
  echo "State: HQ3_PRIMARY"
fi

if command -v systemctl >/dev/null 2>&1; then
  timer_state="$(systemctl is-enabled htgcrm-hoa-business-sync.timer 2>/dev/null || true)"
  timer_active="$(systemctl is-active htgcrm-hoa-business-sync.timer 2>/dev/null || true)"
  echo "Business timer enabled: ${timer_state:-unknown}"
  echo "Business timer active: ${timer_active:-unknown}"
fi

echo

if [[ -f "$LAST_SUCCESS_FILE" ]]; then
  echo "Last business success: $(cat "$LAST_SUCCESS_FILE")"
else
  echo "Last business success: never"
fi

if [[ -f "$LAST_FAILURE_FILE" ]]; then
  echo "Last business failure: $(cat "$LAST_FAILURE_FILE")"
else
  echo "Last business failure: none recorded"
fi

if [[ -f "$LOG_FILE" ]]; then
  echo
  echo "Recent business sync log:"
  tail -n 30 "$LOG_FILE"
fi
