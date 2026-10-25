#!/usr/bin/env bash
# Stops paying for the server while it is not used: shuts the droplet down, takes a snapshot
# (all data: database, uploaded files, certificates) and deletes the droplet.
# Bring it back with ./hutuch-start.sh.
#
# Runs on YOUR computer (not on the server), needs doctl logged in: doctl auth init
# Usage: ./hutuch-stop.sh [--yes]
set -euo pipefail

DROPLET_NAME="${DROPLET_NAME:-hutuch}"
SNAPSHOT_PREFIX="${SNAPSHOT_PREFIX:-hutuch-}"
# older snapshots are deleted, each one costs ~$0.06 per GB a month
KEEP_SNAPSHOTS="${KEEP_SNAPSHOTS:-2}"
YES="${1:-}"

command -v doctl >/dev/null || { echo "doctl is not installed: https://docs.digitalocean.com/reference/doctl/how-to/install/"; exit 1; }
# doctl.exe on Windows (Git Bash) may print CRLF line endings
doctl () { command doctl "$@" | tr -d '\r'; }

ID=$(doctl compute droplet list --format ID,Name --no-header | awk -v n="$DROPLET_NAME" '$2 == n { print $1 }')
if [ -z "$ID" ]; then
    echo "No droplet named \"$DROPLET_NAME\" (already stopped?). Set DROPLET_NAME=<name> if it is named differently."
    exit 1
fi
if [ "$(echo "$ID" | wc -l)" -gt 1 ]; then
    echo "Several droplets are named \"$DROPLET_NAME\", stop the right one by hand:"; echo "$ID"; exit 1
fi

STATUS=$(doctl compute droplet get "$ID" --format Status --no-header)
if [ "$STATUS" = "active" ]; then
    echo "==> Shutting down $DROPLET_NAME ($ID)"
    # a clean shutdown stops the containers, so the database is saved consistently
    doctl compute droplet-action shutdown "$ID" --wait >/dev/null
fi

SNAPSHOT_NAME="${SNAPSHOT_PREFIX}$(date -u +%Y%m%d-%H%M)"
echo "==> Taking snapshot $SNAPSHOT_NAME (a few minutes)"
doctl compute droplet-action snapshot "$ID" --snapshot-name "$SNAPSHOT_NAME" --wait >/dev/null

if ! doctl compute snapshot list --resource droplet --format Name --no-header | grep -qx "$SNAPSHOT_NAME"; then
    echo "Snapshot $SNAPSHOT_NAME was not found, the droplet is NOT deleted. Check Backups & Snapshots in DigitalOcean."
    exit 1
fi
echo "    Snapshot is ready."

if [ "$YES" != "--yes" ]; then
    read -r -p "Delete droplet $DROPLET_NAME now? The site stays offline until ./hutuch-start.sh [y/N] " ANSWER
    case "$ANSWER" in y|Y|yes) ;; *) echo "The droplet is kept (switched off, still billed). Run again to delete it."; exit 0 ;; esac
fi

echo "==> Deleting droplet $DROPLET_NAME"
doctl compute droplet delete "$ID" --force

OLD=$(doctl compute snapshot list --resource droplet --format ID,Name --no-header \
    | awk -v p="$SNAPSHOT_PREFIX" 'index($2, p) == 1' | sort -k2 | head -n -"$KEEP_SNAPSHOTS" | awk '{ print $1 }')
for SNAP in $OLD; do
    echo "==> Deleting old snapshot $SNAP"
    doctl compute snapshot delete "$SNAP" --force
done

echo
echo "Done. Only the snapshot is billed now. Start again with: ./hutuch-start.sh"
