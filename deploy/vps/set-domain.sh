#!/usr/bin/env bash
# Serves the app on a domain with https. Point the domain's DNS A record to this server first.
#   ./set-domain.sh hutuch.ai
set -euo pipefail
cd "$(dirname "$0")"

DOMAIN="${1:?usage: set-domain.sh <domain>}"

set_env () {
    if grep -q "^$1=" .env; then
        sed -i "s|^$1=.*|$1=$2|" .env
    else
        echo "$1=$2" >> .env
    fi
}

set_env DOMAIN "$DOMAIN"
set_env SERVER_URL "https://$DOMAIN"

docker compose up -d
echo "Done. Open https://$DOMAIN (the certificate is issued on the first request, give it a minute)."
echo "Certificate logs: docker compose logs -f caddy"
