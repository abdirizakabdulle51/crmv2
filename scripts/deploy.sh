#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Pulling latest code"
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
