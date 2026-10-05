#!/usr/bin/env bash
# Creates deploy/oracle/.env from env.template with freshly generated secrets.
# Usage: ./init-env.sh <public-ip-or-domain>
set -euo pipefail
cd "$(dirname "$0")"

HOST="${1:?usage: ./init-env.sh <public-ip-or-domain>}"

if [ -f .env ]; then
    echo ".env already exists — not overwriting it (secrets would change and break existing data)."
    exit 1
fi

rand () { openssl rand -hex "$1"; }

sed \
    -e "s|__SERVER_URL__|http://${HOST}|g" \
    -e "s|__POSTGRES_PASSWORD__|$(rand 16)|g" \
    -e "s|__COOKIE_SECRET__|$(rand 32)|g" \
    -e "s|__ENCRYPTION_SECRET__|$(rand 32)|g" \
    -e "s|__FILE_SECRET__|$(rand 16)|g" \
    env.template > .env

chmod 600 .env
echo "Created $(pwd)/.env for http://${HOST}"
