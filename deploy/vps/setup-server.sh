#!/usr/bin/env bash
# One-shot setup of a fresh Ubuntu 24.04 VPS (>= 4GB RAM, x86_64), run as root:
#   curl -fsSL https://raw.githubusercontent.com/anjaa0815/soh-system/feature/mn-locale-base/deploy/vps/setup-server.sh | bash -s -- <public-ip-or-domain>
# Safe to re-run: existing swap, docker, checkout and .env are kept.
set -euo pipefail

HOST="${1:?usage: setup-server.sh <public-ip-or-domain>}"
REPO=https://github.com/anjaa0815/soh-system.git
BRANCH=feature/mn-locale-base
DIR=/opt/soh-system

if ! swapon --show | grep -q .; then
    echo "==> Adding 2GB swap"
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

if ! command -v docker >/dev/null; then
    echo "==> Installing docker"
    curl -fsSL https://get.docker.com | sh
fi

if [ ! -d "$DIR" ]; then
    echo "==> Cloning $REPO"
    apt-get install -y -qq git
    git clone --depth 1 -b "$BRANCH" "$REPO" "$DIR"
fi

cd "$DIR/deploy/vps"
[ -f .env ] || ./init-env.sh "$HOST"

echo "==> Pulling images"
docker compose pull

echo "==> Starting postgres and redis"
docker compose up -d postgres redis

echo "==> Running database migrations"
docker compose run --rm -T condo yarn migrate

echo "==> Starting the app"
docker compose up -d condo

echo
echo "Done. The app is starting at http://${HOST} (first start can take a few minutes)."
echo "Follow logs with: cd $DIR/deploy/vps && docker compose logs -f condo"
