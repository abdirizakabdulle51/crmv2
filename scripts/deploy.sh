#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

ensure_clean_worktree_for_pull() {
  local status_output
  status_output="$(git status --porcelain --untracked-files=all)"

  if [[ -z "$status_output" ]]; then
    return
  fi

  local generated_only=true
  local dirty_line
  while IFS= read -r dirty_line; do
    local dirty_path="${dirty_line:3}"
    if [[ "$dirty_path" != convex/_generated/* ]]; then
      generated_only=false
      break
    fi
  done <<< "$status_output"

  if [[ "$generated_only" == true ]]; then
    echo "==> Restoring generated Convex files before pull"
    git restore --staged --worktree -- convex/_generated/
    git clean -fd -- convex/_generated/
    return
  fi

  echo "ERROR: Deployment stopped because the working tree has local changes outside convex/_generated/." >&2
  echo "Resolve or commit these files before deploying:" >&2
  git status --short
  exit 1
}

echo "==> Pulling latest code"
ensure_clean_worktree_for_pull
git pull

echo "==> Deploying Convex functions"
pnpm exec convex deploy

echo "==> Building frontend"
pnpm run build

echo "==> Publishing to Nginx (/var/www/crm)"
rm -rf /var/www/crm/*
cp -r dist/* /var/www/crm/

echo "==> Reloading Nginx"
systemctl reload nginx

echo "==> Done. Deployed commit: $(git rev-parse --short HEAD)"
