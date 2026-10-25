#!/usr/bin/env bash
# Brings the server back from the latest snapshot made by ./hutuch-stop.sh.
# The new droplet gets a new IP: if the domain's DNS is hosted by DigitalOcean (Networking -> Domains)
# its A records are updated here, otherwise update them at the registrar (Namecheap).
#
# Runs on YOUR computer (not on the server), needs doctl logged in: doctl auth init
# Usage: ./hutuch-start.sh
set -euo pipefail

DROPLET_NAME="${DROPLET_NAME:-hutuch}"
SNAPSHOT_PREFIX="${SNAPSHOT_PREFIX:-hutuch-}"
# 4GB RAM is the minimum for the app
SIZE="${SIZE:-s-2vcpu-4gb}"
DOMAIN="${DOMAIN:-hutuch.homes}"

command -v doctl >/dev/null || { echo "doctl is not installed: https://docs.digitalocean.com/reference/doctl/how-to/install/"; exit 1; }
# doctl.exe on Windows (Git Bash) may print CRLF line endings
doctl () { command doctl "$@" | tr -d '\r'; }

if doctl compute droplet list --format Name --no-header | grep -qx "$DROPLET_NAME"; then
    echo "Droplet \"$DROPLET_NAME\" already exists:"
    doctl compute droplet list --format Name,PublicIPv4,Status | awk -v n="$DROPLET_NAME" 'NR == 1 || $1 == n'
    exit 0
fi

# snapshot names end with the date (hutuch-YYYYMMDD-HHMM), so the last one by name is the newest
LATEST=$(doctl compute snapshot list --resource droplet --format ID,Name,Regions --no-header \
    | awk -v p="$SNAPSHOT_PREFIX" 'index($2, p) == 1' | sort -k2 | tail -n 1)
if [ -z "$LATEST" ]; then
    echo "No snapshot named ${SNAPSHOT_PREFIX}* found. Check Backups & Snapshots in DigitalOcean."
    exit 1
fi
SNAP_ID=$(echo "$LATEST" | awk '{ print $1 }')
SNAP_NAME=$(echo "$LATEST" | awk '{ print $2 }')
REGION=$(echo "$LATEST" | awk '{ print $3 }' | tr -d '[]' | cut -d, -f1)

echo "==> Creating $DROPLET_NAME from $SNAP_NAME ($SIZE, $REGION), a few minutes"
IP=$(doctl compute droplet create "$DROPLET_NAME" --image "$SNAP_ID" --size "$SIZE" --region "$REGION" \
    --wait --format PublicIPv4 --no-header)
echo "    New IP: $IP"

if doctl compute domain get "$DOMAIN" >/dev/null 2>&1; then
    echo "==> Pointing $DOMAIN and www.$DOMAIN to $IP (DigitalOcean DNS)"
    doctl compute domain records list "$DOMAIN" --format ID,Type,Name --no-header \
        | awk '$2 == "A" && ($3 == "@" || $3 == "www") { print $1 }' \
        | while read -r RECORD; do doctl compute domain records delete "$DOMAIN" "$RECORD" --force; done
    doctl compute domain records create "$DOMAIN" --record-type A --record-name @ --record-data "$IP" --record-ttl 300 >/dev/null
    doctl compute domain records create "$DOMAIN" --record-type A --record-name www --record-data "$IP" --record-ttl 300 >/dev/null
else
    echo
    echo "!!! Update DNS by hand: Namecheap -> $DOMAIN -> Advanced DNS,"
    echo "!!! set both A records (@ and www) to $IP"
fi

echo
echo "==> Waiting for https://$DOMAIN (the containers start by themselves; DNS may take a few minutes)"
for _ in $(seq 1 60); do
    if curl -fs -o /dev/null --max-time 10 "https://$DOMAIN"; then
        echo "Done. https://$DOMAIN is up."
        exit 0
    fi
    sleep 20
done
echo "Not reachable yet. If DNS was updated, give it a few more minutes, or check on the server:"
echo "  ssh root@$IP 'cd /opt/soh-system/deploy/vps && docker compose ps'"
