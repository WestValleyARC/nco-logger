#!/bin/sh
set -eu

key_file=/data/configdb/hamlive-replica.key
if [ -z "${MONGO_REPLICA_KEY:-}" ]; then
    echo "MONGO_REPLICA_KEY is required" >&2
    exit 1
fi
mkdir -p /data/configdb
umask 077
printf '%s' "$MONGO_REPLICA_KEY" > "$key_file"
chown mongodb:mongodb "$key_file"
chmod 400 "$key_file"

exec /usr/local/bin/docker-entrypoint.sh mongod --replSet rs0 --bind_ip_all --auth --keyFile "$key_file"
