#!/usr/bin/env bash
set -euo pipefail

CRM_ROOT="${CRM_ROOT:-/var/www/crm}"
CRM_DOMAIN="${CRM_DOMAIN:-crm.102-203-134-106.sslip.io}"
SNIPPET_PATH="${SNIPPET_PATH:-/etc/nginx/snippets/crm-spa-cache-policy.conf}"
SERVER_CONFIG_PATH="${SERVER_CONFIG_PATH:-/etc/nginx/sites-available/crm}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "ERROR: run as root because this updates Nginx config." >&2
  exit 1
fi

if [[ ! -d "$CRM_ROOT" ]]; then
  echo "ERROR: CRM root does not exist: $CRM_ROOT" >&2
  exit 1
fi

mkdir -p "$(dirname "$SNIPPET_PATH")" "$(dirname "$SERVER_CONFIG_PATH")"

cat > "$SNIPPET_PATH" <<'NGINX'
location = /index.html {
    add_header Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate" always;
    add_header Pragma "no-cache" always;
    add_header Expires "0" always;
    try_files /index.html =404;
}

location /assets/ {
    add_header Cache-Control "public, max-age=31536000, immutable" always;
    try_files $uri =404;
}

location / {
    add_header Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate" always;
    add_header Pragma "no-cache" always;
    add_header Expires "0" always;
    try_files $uri $uri/ /index.html;
}
NGINX

if [[ -f "$SERVER_CONFIG_PATH" ]]; then
  if grep -Fq "$SNIPPET_PATH" "$SERVER_CONFIG_PATH"; then
    echo "==> Cache policy already installed in $SERVER_CONFIG_PATH"
  else
    backup_path="${SERVER_CONFIG_PATH}.bak.$(date +%Y%m%d%H%M%S)"
    cp "$SERVER_CONFIG_PATH" "$backup_path"
    echo "==> Existing CRM Nginx config found."
    echo "==> Backup created: $backup_path"
    echo "ERROR: $SERVER_CONFIG_PATH exists but does not include $SNIPPET_PATH." >&2
    echo "Add this line inside the CRM server block, then run nginx -t && systemctl reload nginx:" >&2
    echo "include $SNIPPET_PATH;" >&2
    exit 1
  fi
else
  cat > "$SERVER_CONFIG_PATH" <<NGINX
server {
    listen 80;
    server_name ${CRM_DOMAIN};

    root ${CRM_ROOT};
    index index.html;

    include ${SNIPPET_PATH};
}
NGINX

  if [[ -d /etc/nginx/sites-enabled && ! -e /etc/nginx/sites-enabled/crm ]]; then
    ln -s "$SERVER_CONFIG_PATH" /etc/nginx/sites-enabled/crm
  fi
fi

nginx -t
systemctl reload nginx

echo "==> CRM Nginx cache policy installed."
echo "==> index.html and SPA routes are no-cache; hashed /assets are immutable."
