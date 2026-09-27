#!/usr/bin/env bash
# Serves the app on a domain with https (www.<domain> redirects to it).
# Point the DNS A records of the domain and of www.<domain> to this server first.
#   ./set-domain.sh hutuch.homes
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
set_env WWW_DOMAIN "www.$DOMAIN"
set_env SERVER_URL "https://$DOMAIN"

docker compose up -d
# caddy reads the Caddyfile only on start
docker compose restart caddy
echo "Done. Open https://$DOMAIN (the certificate is issued on the first request, give it a minute)."
echo "Certificate logs: docker compose logs -f caddy"
