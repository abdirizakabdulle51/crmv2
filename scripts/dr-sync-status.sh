#!/usr/bin/env bash
set -euo pipefail

LOG_DIR="${LOG_DIR:-/var/log/htgcrm-dr-sync}"
LAST_SUCCESS_FILE="$LOG_DIR/last_success"
LAST_FAILURE_FILE="$LOG_DIR/last_failure"
LOG_FILE="$LOG_DIR/sync.log"

echo "HTG CRM DR sync status"
echo "----------------------"

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
