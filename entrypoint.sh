#!/usr/bin/env bash
set -e

PUID=${PUID:-99}
PGID=${PGID:-100}

DB_DIR="/app/db"
LOG_DIR="/app/logs"
TD_DIR="/app/temp_downloads"

if [ "$(id -u)" != "0" ]; then
    if [ "$(id -u)" != "$PUID" ] || [ "$(id -g)" != "$PGID" ]; then
        echo "ERROR: runtime identity $(id -u):$(id -g) does not match PUID:PGID $PUID:$PGID." >&2
        echo "Set the container runtime user to $PUID:$PGID, or remove the PUID/PGID overrides." >&2
        exit 64
    fi
    exec "$@"
fi

if [ "$PUID" = "0" ]; then
    echo "Running as root by explicit request"
    exec "$@"
fi

echo "Preparing Kapowarr to run as $PUID:$PGID..."
groupmod -o -g "$PGID" kapowarr
usermod -o -u "$PUID" -g "$PGID" kapowarr

chown -R kapowarr:kapowarr "$DB_DIR" "$LOG_DIR" "$TD_DIR" || {
    echo "Failed to update ownership to $PUID:$PGID"
    exit 1
}

exec gosu kapowarr "$@"
