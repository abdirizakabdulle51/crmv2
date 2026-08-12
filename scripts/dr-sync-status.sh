#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${DR_SYNC_ENV_FILE:-/etc/htgcrm-dr-sync.env}"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

LOG_DIR="${LOG_DIR:-/var/log/htgcrm-dr-sync}"
LAST_SUCCESS_FILE="$LOG_DIR/last_success"
LAST_FAILURE_FILE="$LOG_DIR/last_failure"
LAST_FAILBACK_SUCCESS_FILE="$LOG_DIR/last_failback_success"
STATE_FILE="$LOG_DIR/state"
FAILBACK_REQUIRED_FILE="$LOG_DIR/failback_required"
LOG_FILE="$LOG_DIR/sync.log"

echo "HTG CRM DR sync status"
echo "----------------------"

if [[ -f "$STATE_FILE" ]]; then
  echo "State: $(cat "$STATE_FILE")"
else
  echo "State: HQ3_PRIMARY"
fi

if [[ -f "$FAILBACK_REQUIRED_FILE" ]]; then
  echo "Failback required since: $(cat "$FAILBACK_REQUIRED_FILE")"
fi

if [[ -f "$LAST_FAILBACK_SUCCESS_FILE" ]]; then
  echo "Last failback success: $(cat "$LAST_FAILBACK_SUCCESS_FILE")"
fi

echo

if [[ -f "$LAST_SUCCESS_FILE" ]]; then
  echo "Last success: $(cat "$LAST_SUCCESS_FILE")"
else
  echo "Last success: never"
fi

if [[ -f "$LAST_FAILURE_FILE" ]]; then
  echo "Last failure: $(cat "$LAST_FAILURE_FILE")"
else
  echo "Last failure: none recorded"
fi

if [[ -f "$LOG_FILE" ]]; then
  echo
  echo "Recent log:"
  tail -n 20 "$LOG_FILE"
fi
