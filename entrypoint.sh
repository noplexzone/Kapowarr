#!/usr/bin/env bash
set -e

PUID=${PUID:-1000}
PGID=${PGID:-1000}

DB_DIR="/app/db"
LOG_DIR="/app/logs"
TD_DIR="/app/temp_downloads"

if [ "$(id -u)" != "0" ]; then
    if [ "$(id -u)" != "$PUID" ] || [ "$(id -g)" != "$PGID" ]; then
        echo "Running as $(id -u):$(id -g); PUID:PGID is applied by the container runtime when needed"
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
